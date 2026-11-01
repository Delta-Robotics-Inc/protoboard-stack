/**
 * The extension host's part in the 3D view's state and the live-tab bridge
 * (PB-1178; docs/reference/viewer-bridge.md):
 *
 * - it saves a tab's live view state to `.protoboard/local/viewer-state.json`
 *   (per user, git-ignored), merged by scope, and only when it changed;
 * - it hands a tab's saved named views to the project's dev server, which
 *   writes them to the display file only when they changed (no dev server:
 *   written here the same way);
 * - it relays the bridge for its tabs: one event stream per project to the
 *   dev server (`/__protoboard/bridge/relay`, with the bridge key from the
 *   server's record), each tab announced by id, batches posted into the
 *   tab's webview and its reply posted back. The dev server is the one
 *   endpoint agents call; the extension host opens no port of its own
 *   (DEFAULT).
 *
 * No VS Code API here: the editors (viewerEditor.ts) give it what it needs.
 */
import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import { BRIDGE_KEY_HEADER, BRIDGE_ROUTES } from "../../cli/src/dev/bridge.js";
import { parsePresentation, presentationToWrite, saveViewerState, withPresentation, type ViewerStateFile } from "../../cli/src/dev/viewState.js";
import { backendOf, checkSnapshotMeta, writeSnapshot } from "../../core/src/render-service/files.js";
import { createHash } from "node:crypto";

export { readViewerState, saveViewerState } from "../../cli/src/dev/viewState.js";

/** `.protoboard/local/dev.json` as far as the relay reads it. */
interface DevRecord {
  url: string;
  session: string;
  bridge?: { key: string };
}

export function readBridgeRecord(root: string): DevRecord | undefined {
  try {
    const r = JSON.parse(readFileSync(join(root, ".protoboard", "local", "dev.json"), "utf8")) as DevRecord;
    // the relay only ever talks to this machine: a record naming another host is not used (wave 2 gate)
    return typeof r.url === "string" && isLoopbackUrl(r.url) && typeof r.bridge?.key === "string" ? r : undefined;
  } catch {
    return undefined;
  }
}

/** `http://` on 127.0.0.1, ::1 or localhost. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** A tab the relay serves. */
export interface RelayTab {
  /** The bridge's id for it (`vscode:<random>`). */
  id: string;
  label: string;
  active: boolean;
  /** Post a bridge request into the tab's webview. */
  deliver(request: Record<string, unknown>): void;
}

/** How the relay talks HTTP (tests pass their own). */
export interface RelayTransport {
  post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; body: unknown }>;
  /** Open an event stream; `onEvent` for each event, `onClose` once. Returns the stop. */
  stream(url: string, headers: Record<string, string>, onEvent: (event: string, data: unknown) => void, onClose: () => void): () => void;
}

/** Node's own HTTP, loopback only (the dev server's record names a loopback URL). */
export const nodeTransport: RelayTransport = {
  post(url, headers, body) {
    return new Promise((ok, fail) => {
      const data = JSON.stringify(body);
      const req = httpRequest(url, { method: "POST", headers: { ...headers, "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            parsed = undefined;
          }
          ok({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      req.on("error", fail);
      req.setTimeout(10000, () => req.destroy(new Error("timed out")));
      req.end(data);
    });
  },
  stream(url, headers, onEvent, onClose) {
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      onClose();
    };
    const req = httpRequest(url, { method: "GET", headers: { ...headers, accept: "text/event-stream" } }, (res: IncomingMessage) => {
      if (res.statusCode !== 200) {
        res.resume();
        return done();
      }
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          let event = "message";
          const data: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (!data.length) continue;
          try {
            onEvent(event, JSON.parse(data.join("\n")));
          } catch {
            // not JSON: not ours
          }
        }
      });
      res.on("end", done);
      res.on("close", done);
    });
    req.on("error", done);
    req.end();
    return () => {
      req.destroy();
      done();
    };
  },
};

/**
 * The relay of one project: connects while it has tabs and the dev server's
 * record offers the bridge, and reconnects (2 s) when the stream drops.
 */
export class ProjectRelay {
  private readonly tabs = new Map<string, RelayTab>();
  private stop: (() => void) | undefined;
  private relayId: string | undefined;
  private url: string | undefined;
  private key: string | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    readonly root: string,
    private readonly transport: RelayTransport = nodeTransport,
    private readonly log: (message: string) => void = () => {},
  ) {}

  /** A new id for a tab. */
  static tabId(): string {
    return `vscode:${randomBytes(8).toString("base64url")}`;
  }

  /** Connect (again) to the project's dev server as its record says now. */
  connect(): void {
    if (this.disposed || !this.tabs.size) return;
    const record = readBridgeRecord(this.root);
    if (!record) return;
    if (this.stop && this.url === record.url && this.key === record.bridge!.key) return;
    this.stop?.();
    this.relayId = undefined;
    this.url = record.url;
    this.key = record.bridge!.key;
    const at = new URL(BRIDGE_ROUTES.relay.slice(1), record.url).href;
    this.stop = this.transport.stream(
      at,
      { [BRIDGE_KEY_HEADER]: this.key },
      (event, data) => this.onEvent(event, data),
      () => {
        this.stop = undefined;
        this.relayId = undefined;
        if (this.disposed || !this.tabs.size) return;
        clearTimeout(this.retry);
        this.retry = setTimeout(() => this.connect(), 2000);
      },
    );
  }

  private onEvent(event: string, data: unknown) {
    const d = data as { relay?: string; tab?: string; envelope?: Record<string, unknown> };
    if (event === "relay" && typeof d.relay === "string") {
      this.relayId = d.relay;
      this.log(`bridge relay ${d.relay} for ${this.root}: announcing ${this.tabs.size} tab(s)`);
      for (const t of this.tabs.values()) void this.presence(t, { label: t.label, active: t.active });
      return;
    }
    if (event === "bridge" && typeof d.tab === "string" && d.envelope) {
      const tab = this.tabs.get(d.tab);
      if (tab) tab.deliver(d.envelope);
      else void this.presence({ id: d.tab } as RelayTab, { closed: true });
    }
  }

  private async presence(tab: Pick<RelayTab, "id">, extra: Record<string, unknown>) {
    if (!this.url || !this.key || !this.relayId) return;
    try {
      await this.transport.post(new URL(BRIDGE_ROUTES.presence.slice(1), this.url).href, { [BRIDGE_KEY_HEADER]: this.key }, { tab: tab.id, relay: this.relayId, ...extra });
    } catch (e) {
      this.log(`bridge presence for ${tab.id}: ${(e as Error).message}`);
    }
  }

  add(tab: RelayTab): void {
    this.tabs.set(tab.id, tab);
    if (this.relayId) void this.presence(tab, { label: tab.label, active: tab.active });
    else this.connect();
  }

  remove(id: string): void {
    if (!this.tabs.delete(id)) return;
    void this.presence({ id }, { closed: true });
    if (!this.tabs.size) this.close();
  }

  /** The person turned to a tab: agents reach it by default now. */
  activate(id: string): void {
    for (const t of this.tabs.values()) t.active = t.id === id;
    const tab = this.tabs.get(id);
    if (tab) void this.presence(tab, { active: true });
  }

  /** A tab's reply to a delivery. */
  async reply(tabId: string, delivery: string, reply: Record<string, unknown>): Promise<void> {
    if (!this.url || !this.key) return;
    try {
      await this.transport.post(new URL(BRIDGE_ROUTES.reply.slice(1), this.url).href, { [BRIDGE_KEY_HEADER]: this.key }, { id: delivery, tab: tabId, reply });
    } catch (e) {
      this.log(`bridge reply from ${tabId}: ${(e as Error).message}`);
    }
  }

  get connected(): boolean {
    return Boolean(this.relayId);
  }

  close(): void {
    clearTimeout(this.retry);
    this.stop?.();
    this.stop = undefined;
    this.relayId = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.close();
    this.tabs.clear();
  }
}

/**
 * The project's display file without running its code (wave 2 gate): a static string `display: "..."` in
 * `protoboard.config.ts` (relative, inside the project), else `.protoboard/display.json`. A config that computes
 * the path is not evaluated here; the dev server, which loads the config, is asked first anyway.
 */
export function configuredDisplayFile(root: string): string {
  const fallback = join(root, ".protoboard", "display.json");
  try {
    const text = readFileSync(join(root, "protoboard.config.ts"), "utf8");
    const m = /\bdisplay\s*:\s*(["'`])([^"'`\n$]+)\1/.exec(text);
    if (!m) return fallback;
    const rel = m[2].trim();
    if (!rel || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split(/[\\/]/).includes("..") || !/\.json$/i.test(rel)) return fallback;
    return join(root, rel);
  } catch {
    return fallback;
  }
}

/** Thrown when the dev server answered and refused the save: the file is NOT written here then. */
export class PresentationRefused extends Error {}

/**
 * Named views and annotations from a tab, into the display file: through the
 * dev server when it runs (it owns the file and rebuilds), else written here.
 * Nothing is written when they did not change.
 *
 * Wave 2 gate: the fallback writes the project's configured display file (not
 * always `.protoboard/display.json`), through a temp file and a rename, and is
 * taken only when the server cannot be reached (a transport error). A server
 * that answers and refuses (403, 409 for a display file that is not valid
 * JSON, 413...) is reported, never worked around.
 */
export async function savePresentation(root: string, presentation: unknown, options: { transport?: RelayTransport; displayFile?: string; format?: (display: unknown, previous?: string) => string; write?: (file: string, text: string) => void; saveAnnotations?: boolean } = {}): Promise<{ written: boolean; via: "dev" | "file" }> {
  const pres = parsePresentation(presentation);
  if ("error" in pres) throw new Error(pres.error);
  const record = readBridgeRecord(root);
  if (record) {
    let r: { status: number; body: unknown } | undefined;
    try {
      r = await (options.transport ?? nodeTransport).post(new URL("__protoboard/display-views", record.url).href, { [BRIDGE_KEY_HEADER]: record.bridge!.key }, { presentation, ...(options.saveAnnotations ? { saveAnnotations: true } : {}) });
    } catch {
      // the server went away (a transport error): write the file here
      r = undefined;
    }
    if (r) {
      if (r.status === 200) return { written: Boolean((r.body as { written?: boolean })?.written), via: "dev" };
      throw new PresentationRefused(`the dev server refused the save (HTTP ${r.status}): ${String((r.body as { error?: unknown })?.error ?? "no reason given")}`);
    }
  }
  const file = options.displayFile ?? configuredDisplayFile(root);
  let previous: string | undefined;
  let display: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      display = JSON.parse((previous = readFileSync(file, "utf8"))) as Record<string, unknown>;
    } catch (e) {
      throw new PresentationRefused(`${file} is not valid JSON (${(e as Error).message}); fix it before saving views`);
    }
  }
  // annotations only on an explicit save of them (DEFAULT, W3-A; the dev server's rule)
  const merged = withPresentation(display as { spatial?: Record<string, unknown> }, presentationToWrite(pres, display as { spatial?: Record<string, unknown> }, options.saveAnnotations));
  if (!merged.changed) return { written: false, via: "file" };
  const text = options.format ? options.format(merged.display, previous) : JSON.stringify(merged.display, null, 2) + "\n";
  if (options.write) options.write(file, text);
  else {
    const { writeFileSync, mkdirSync, renameSync, rmSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(file), { recursive: true });
    // temp and rename: a reader (the dev server's watcher, git) never sees half a file
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    writeFileSync(tmp, text);
    try {
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  }
  return { written: true, via: "file" };
}

/** Save a tab's live view state (the extension host writes it on the viewer's behalf). */
export function saveTabViewState(root: string, file: ViewerStateFile): boolean {
  return saveViewerState(root, file).written;
}

/**
 * A save point from a tab's 3D view (PB-1180): written as the render service writes its own
 * (`.protoboard/local/snapshots/<level>__<view>.png` and `.json`), with `source: "viewer"`.
 */
export function saveViewerSnapshot(root: string, pngBase64: string, meta: Record<string, unknown>): string {
  const png = Buffer.from(pngBase64, "base64");
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG");
  // the meta's shapes and sizes checked as the dev server checks them (css, camera, viewState capped, gpu, theme)
  const checked = checkSnapshotMeta(meta);
  if ("error" in checked) throw new Error(checked.error);
  const m = checked.meta;
  let bundleHash = "";
  try {
    bundleHash = `sha256:${createHash("sha256").update(readFileSync(join(root, ".protoboard", "build", "uhd-bundle.json"))).digest("hex")}`;
  } catch {
    // no bundle yet
  }
  const out = writeSnapshot(root, png, {
    ...m,
    bundleHash,
    revision: 0,
    // the backend the viewer drew with (its renderer string), not an assumed GPU
    backend: backendOf(m.gpu),
    takenAt: m.takenAt ?? new Date().toISOString(),
    source: "viewer",
  } as unknown as Parameters<typeof writeSnapshot>[2]);
  return out.meta.key;
}
