/**
 * The VS Code viewer page's small host plumbing (R2-E, 2026-11-02), without React: the viewer settings the view hub
 * applies itself, the in-tab BOM's data asked of the extension, and downloads handed to the extension. Tests import
 * this file directly.
 */
import type { FromWebview, PartsOp, ToWebview, ViewerSettings } from "./protocol.js";

/**
 * The part of @protoboardai/views' `PartsData` the in-tab BOM uses, typed here so this file loads without the views
 * (the shell passes it on as `PartsData`; the library's routes refuse: it is the Library side bar's).
 */
export interface HostPartsData {
  search(query: unknown, cursor?: string): Promise<never>;
  part(key: string, revision?: number): Promise<never>;
  bom(): Promise<unknown>;
  saveBom(change: { units: number } | { line: string; offer: string | null }): Promise<void>;
  refreshOffers(): Promise<string>;
  openLink(url: string): void;
  openSource(file: string, line?: number): void;
  /** The BOM's Export CSV, to the export folder (R2 integration). */
  exportCsv(name: string, text: string): void;
}

/**
 * The viewer settings the view hub applies itself (R2-E, J1): `zoomToCursor` through the hub's camera controls
 * (R1-A, E1), for the view mounted now and any mounted later. `modelInfo` and `hoverLongDelayMs` reach the viewer as
 * its `settings` option (R2-A reads them).
 */
// typed without the DOM library (the extension's own type check reads this file too)
const pageGlobals = globalThis as { window?: unknown; HTMLAnchorElement?: { prototype: { click: () => void } } };

export function applyHubSettings(settings: ViewerSettings, win: unknown = pageGlobals.window) {
  const holder = (win ?? globalThis) as Record<string, unknown>;
  const hub = holder.__uhdViewHub as { controls?: (o: { zoomToCursor?: boolean }) => unknown; controlOptions?: { zoomToCursor?: boolean } } | undefined;
  if (!hub) return;
  hub.controlOptions = { ...hub.controlOptions, zoomToCursor: settings.zoomToCursor };
  hub.controls?.({ zoomToCursor: settings.zoomToCursor });
}

/** DEFAULT (R2-E): how long a `parts` request waits for the extension's answer. */
export const PARTS_TIMEOUT_MS = 120_000;

/**
 * The BOM view's data through the extension (R2-E): the extension reads and writes the project's bill of materials as
 * its BOM editor does. The library is the Library side bar's: its routes say so.
 */
export function extensionPartsData(post: (m: FromWebview) => void): { data: HostPartsData; answer: (m: Extract<ToWebview, { type: "partsAnswer" }>) => void } {
  let next = 0;
  const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const ask = <T>(op: PartsOp, args?: Record<string, unknown>): Promise<T> =>
    new Promise<T>((ok, fail) => {
      const id = ++next;
      const timer = setTimeout(() => {
        waiting.delete(id);
        fail(new Error("the extension did not answer"));
      }, PARTS_TIMEOUT_MS);
      waiting.set(id, { ok: ok as (v: unknown) => void, fail, timer });
      post({ type: "parts", ask: id, op, ...(args ? { args } : {}) });
    });
  const elsewhere = () => Promise.reject(new Error("The parts library is in the Library side bar."));
  const data: HostPartsData = {
    search: elsewhere,
    part: elsewhere,
    bom: () => ask("bom"),
    saveBom: (change) => ask<void>("saveBom", change as Record<string, unknown>),
    refreshOffers: () => ask<string>("refreshOffers"),
    openLink: (url) => void ask("openLink", { url }).catch(() => undefined),
    openSource: (file, line) => void ask("openSource", { file, ...(line ? { line } : {}) }).catch(() => undefined),
    // the BOM's Export CSV (R2-E's handoff, R2 integration): to the extension, which writes it to the export folder
    exportCsv: (name, text) => post({ type: "download", name: safeDownloadName(name), data: base64Utf8(text) }),
  };
  const answer = (m: Extract<ToWebview, { type: "partsAnswer" }>) => {
    const w = waiting.get(m.ask);
    if (!w) return;
    waiting.delete(m.ask);
    clearTimeout(w.timer);
    if (m.ok) w.ok(m.value);
    else w.fail(new Error(m.error ?? "the extension could not do it"));
  };
  return { data, answer };
}

/** A download's name as the extension takes it: no folder separators, at most 200 characters. */
export const safeDownloadName = (name: string) => name.replace(/[\\/]/g, "-").slice(0, 200);

/** Text as base64 of its UTF-8 bytes (what a `download` message carries). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * A download the page starts (an anchor with `download` on a blob: or data: URL, as the BOM's Export CSV makes):
 * VS Code webviews do not save files, so it goes to the extension, which writes it to the export folder (R2-E, G3).
 * Returns the restore.
 */
export function interceptDownloads(post: (m: FromWebview) => void, proto: { click: () => void } | undefined = pageGlobals.HTMLAnchorElement?.prototype): () => void {
  if (!proto) return () => undefined;
  const original = proto.click;
  proto.click = function (this: { download: string; href: string }) {
    const name = this.download;
    const href = this.href;
    if (!name || !/^(blob|data):/.test(href)) return original.call(this);
    void fetch(href)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        post({ type: "download", name: name.replace(/[\\/]/g, "-").slice(0, 200), data: btoa(bin) });
      })
      .catch((e: Error) => post({ type: "log", level: "warn", message: `a download (${name}) could not be read: ${e.message}` }));
  };
  return () => {
    proto.click = original;
  };
}

