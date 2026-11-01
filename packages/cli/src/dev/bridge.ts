/**
 * The live-tab bridge (PB-1178; docs/reference/viewer-bridge.md): how the
 * CLI's MCP server, or any local agent, reaches the viewer tab a person has
 * open, through the project's `protoboard dev` server.
 *
 * - Discovery: the server's record `.protoboard/local/dev.json` (git-ignored)
 *   carries `bridge.key`, a random key made per run. Holding it proves the
 *   caller can read the project's local files as this user.
 * - Sessions: the key mints a session token per agent session
 *   (`POST /__protoboard/bridge/session`); every batch carries the token,
 *   and the token names the actor the viewer logs (an agent, never the
 *   person). Tokens expire after 8 h without use (DEFAULT) and end with the
 *   server.
 * - Tabs: the dev page (its event stream, `?tab=`) and the VS Code
 *   extension's tabs (relayed by the extension host over
 *   `GET /__protoboard/bridge/relay` with the key) are the live tabs. A
 *   batch goes to the tab it names, else the one the person used last.
 * - Outcomes: the tab's own reply (applied, read, refused with what the
 *   agent missed, invalid), or, when the bridge cannot know, `not-run` (no
 *   tab, or the delivery failed before it left: nothing happened) or
 *   `may-have-run` (delivered, no answer in time, or the tab closed: resend
 *   with the same batchId; the tab answers a batchId it already applied
 *   from memory and never applies it twice).
 *
 * No DOM, no HTTP here: server.ts wires the routes; the tests drive this
 * directly.
 */
import { randomBytes } from "node:crypto";

export const BRIDGE_ROUTES = {
  /** POST, key: mint a session token for an agent session. */
  session: "/__protoboard/bridge/session",
  /** POST, session token: deliver a batch to a live tab and wait for its reply. */
  batch: "/__protoboard/bridge",
  /** GET, session token: the live tabs and the bridge's own state. */
  state: "/__protoboard/bridge/state",
  /** POST, page token or key: a tab's reply to a delivery. */
  reply: "/__protoboard/bridge/reply",
  /** POST, page token or key: a tab was used (focus) or closed. */
  presence: "/__protoboard/bridge/presence",
  /** GET (event stream), key: the VS Code extension host relays its tabs. */
  relay: "/__protoboard/bridge/relay",
} as const;

/** Header carrying the bridge key (session minting, a relay). */
export const BRIDGE_KEY_HEADER = "x-protoboard-bridge-key";
/** Header carrying an agent session's token. */
export const BRIDGE_SESSION_HEADER = "x-protoboard-bridge";

/** How long a tab has to answer before the bridge says `may-have-run` (default; a call may ask for 1 to 60 s). */
export const DEFAULT_REPLY_MS = 8000;
/** A session unused this long expires (DEFAULT 8 h). */
export const SESSION_IDLE_MS = 8 * 3600 * 1000;
/** Batch bodies above this are refused (collaboration D14: batches stay small). */
export const MAX_BATCH_BYTES = 256 * 1024;
/** Batch ids remembered per server (a resend after this many newer ones is delivered again; the tab still dedupes). */
const REMEMBERED = 512;

export interface Actor {
  kind: "agent" | "host";
  id: string;
  session?: string;
}

export interface BridgeSession {
  id: string;
  token: string;
  actor: Actor;
  /** What the agent calls itself (data, shown in logs; never an instruction). */
  name: string;
  created: number;
  lastUsed: number;
}

export interface BatchBody {
  batchId: string;
  label: string;
  ops: unknown[];
  expectSeq?: number;
  expectVersions?: Record<string, number>;
  state?: boolean;
}

/** What goes to the tab (as uhd-viewer's `BridgeRequest`). */
export interface BridgeEnvelope {
  type: "uhd-viewer:bridge";
  id: string;
  batch: BatchBody;
  actor: Actor;
  observe?: boolean;
}

export interface LiveTab {
  id: string;
  kind: "web" | "vscode";
  /** What the tab shows (the VS Code tab's title or module), for the agent's choice. */
  label?: string;
  /** Hand the envelope to the tab; false when it could not leave (the stream is gone). */
  deliver(envelope: BridgeEnvelope): boolean;
  connected: number;
  lastActive: number;
  /** The relay a VS Code tab comes through. */
  relay?: string;
}

/** The bridge's answer to a batch: the tab's reply, or why the bridge cannot know. */
export type BridgeOutcome =
  | ({ status: "applied" | "read" | "refused" | "invalid"; tab: string; duplicate?: true } & Record<string, unknown>)
  | { status: "not-run"; batchId: string; reason: string }
  | { status: "may-have-run"; batchId: string; tab: string; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A batch body, checked as far as the bridge needs (the tab checks the ops), or a reason to refuse it. */
export function parseBatchBody(body: unknown): { batch: BatchBody; tab?: string; observe?: boolean; timeoutMs?: number } | { error: string } {
  if (!isObj(body)) return { error: "expected a JSON object" };
  const { batchId, label, ops } = body;
  if (typeof batchId !== "string" || !/^[\w.:-]{1,128}$/.test(batchId)) return { error: "batchId must be 1 to 128 letters, digits, '.', ':', '_' or '-'" };
  if (typeof label !== "string" || label.length > 120) return { error: "label must be a short text (3 to 8 words)" };
  const words = label.trim().split(/\s+/).filter(Boolean).length;
  if (words < 3 || words > 8) return { error: "label must be 3 to 8 words" };
  if (!Array.isArray(ops) || ops.length > 200 || !ops.every(isObj)) return { error: "ops must be a list of at most 200 operations" };
  if (body.expectSeq !== undefined && !(Number.isInteger(body.expectSeq) && (body.expectSeq as number) >= 0)) return { error: "expectSeq must be a seq number" };
  if (body.expectVersions !== undefined && !(isObj(body.expectVersions) && Object.values(body.expectVersions).every((v) => Number.isInteger(v)))) return { error: "expectVersions must map keys to version numbers" };
  if (body.tab !== undefined && typeof body.tab !== "string") return { error: "tab must be a tab id" };
  const timeoutMs = body.timeoutMs === undefined ? undefined : Number(body.timeoutMs);
  if (timeoutMs !== undefined && !(Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 60000)) return { error: "timeoutMs must be between 1000 and 60000" };
  const batch: BatchBody = {
    batchId,
    label: label.trim(),
    ops: ops as unknown[],
    ...(body.expectSeq !== undefined ? { expectSeq: body.expectSeq as number } : {}),
    ...(body.expectVersions !== undefined ? { expectVersions: body.expectVersions as Record<string, number> } : {}),
    ...(body.state === false ? { state: false } : {}),
  };
  return { batch, ...(typeof body.tab === "string" ? { tab: body.tab } : {}), ...(body.observe === true ? { observe: true } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

interface Pending {
  batchId: string;
  tab: string;
  resolve: (o: BridgeOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<BridgeOutcome>;
}

export interface LiveBridgeOptions {
  /** The key the record carries (default: 32 random bytes). */
  key?: string;
  now?: () => number;
  log?: (message: string) => void;
}

export class LiveBridge {
  readonly key: string;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly sessions = new Map<string, BridgeSession>();
  private readonly tabs = new Map<string, LiveTab>();
  /** Deliveries waiting for a reply, by delivery id. */
  private readonly pending = new Map<string, Pending>();
  /** The same, by batchId (a resend while in flight waits for the same reply). */
  private readonly inFlight = new Map<string, Pending>();
  /** Final outcomes by batchId (a resend gets the first answer). */
  private readonly results = new Map<string, BridgeOutcome>();
  /** Deliveries that timed out, by delivery id: a late reply is still kept for a resend. */
  private readonly late = new Map<string, string>();

  constructor(options: LiveBridgeOptions = {}) {
    this.key = options.key ?? randomBytes(32).toString("base64url");
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? (() => {});
  }

  /** A header value matches the key (constant time over equal lengths). */
  keyMatches(value: unknown): boolean {
    if (typeof value !== "string" || value.length !== this.key.length) return false;
    let diff = 0;
    for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ this.key.charCodeAt(i);
    return diff === 0;
  }

  /** A session for an agent (`name`: what it calls itself, kept as data). */
  mintSession(name: unknown): BridgeSession {
    const id = randomBytes(6).toString("base64url");
    const clean = typeof name === "string" ? name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 64) : "";
    const shown = clean || "agent";
    const s: BridgeSession = { id, token: randomBytes(24).toString("base64url"), actor: { kind: "agent", id: `agent:${id}`, session: id }, name: shown, created: this.now(), lastUsed: this.now() };
    this.sessions.set(s.token, s);
    this.log(`bridge: session ${id} for "${shown}"`);
    return s;
  }

  /** The live session a token names (its use extends it), or undefined. */
  session(token: unknown): BridgeSession | undefined {
    if (typeof token !== "string") return undefined;
    const s = this.sessions.get(token);
    if (!s) return undefined;
    if (this.now() - s.lastUsed > SESSION_IDLE_MS) {
      this.sessions.delete(token);
      return undefined;
    }
    s.lastUsed = this.now();
    return s;
  }

  addTab(tab: Omit<LiveTab, "connected" | "lastActive"> & { lastActive?: number }): LiveTab {
    const t: LiveTab = { ...tab, connected: this.now(), lastActive: tab.lastActive ?? this.now() };
    this.tabs.set(t.id, t);
    return t;
  }

  /** A tab went away: what was waiting on it may have run. */
  removeTab(id: string): void {
    if (!this.tabs.delete(id)) return;
    for (const [delivery, p] of this.pending) if (p.tab === id) this.settle(delivery, { status: "may-have-run", batchId: p.batchId, tab: id, reason: "the tab closed before it answered; resend with the same batchId to learn the outcome" }, false);
  }

  /** The tabs a relay brought: all go when the relay does. */
  removeRelay(relay: string): void {
    for (const t of [...this.tabs.values()]) if (t.relay === relay) this.removeTab(t.id);
  }

  /** The person used a tab (focus, a click): it becomes the default target. */
  touch(id: string): boolean {
    const t = this.tabs.get(id);
    if (!t) return false;
    t.lastActive = this.now();
    return true;
  }

  listTabs(): { id: string; kind: LiveTab["kind"]; label?: string; lastActive: number; default: boolean }[] {
    const target = this.target();
    return [...this.tabs.values()].map((t) => ({ id: t.id, kind: t.kind, ...(t.label ? { label: t.label } : {}), lastActive: t.lastActive, default: t.id === target?.id }));
  }

  /** The tab a batch goes to: the named one, else the one used last (then the newest). */
  target(name?: string): LiveTab | undefined {
    if (name) return this.tabs.get(name);
    return [...this.tabs.values()].sort((a, b) => b.lastActive - a.lastActive || b.connected - a.connected)[0];
  }

  /** Deliver a batch for a session and wait for the outcome. */
  async submit(session: BridgeSession, request: { batch: BatchBody; tab?: string; observe?: boolean; timeoutMs?: number }): Promise<BridgeOutcome> {
    const { batch } = request;
    // the batch id space is per session: two agents choosing the same id do not collide
    const key = `${session.id}:${batch.batchId}`;
    const done = this.results.get(key);
    if (done) return { ...done, ...(done.status !== "not-run" && done.status !== "may-have-run" ? { duplicate: true } : {}) } as BridgeOutcome;
    const running = this.inFlight.get(key);
    if (running) return running.promise;
    const tab = this.target(request.tab);
    if (!tab) {
      return { status: "not-run", batchId: batch.batchId, reason: request.tab ? `no live tab ${request.tab}` : "no viewer tab is open on this project (open it with `protoboard dev --open` or in VS Code)" };
    }
    const delivery = randomBytes(9).toString("base64url");
    // the tab remembers batch ids too: it sees them qualified by the session, so two agents never collide there either
    const envelope: BridgeEnvelope = { type: "uhd-viewer:bridge", id: delivery, batch: { ...batch, batchId: key }, actor: session.actor, ...(request.observe ? { observe: true } : {}) };
    let resolve!: (o: BridgeOutcome) => void;
    const promise = new Promise<BridgeOutcome>((ok) => (resolve = ok));
    const ms = request.timeoutMs ?? DEFAULT_REPLY_MS;
    const timer = setTimeout(() => {
      this.late.set(delivery, key);
      this.settle(delivery, { status: "may-have-run", batchId: batch.batchId, tab: tab.id, reason: `the tab did not answer within ${ms} ms; resend with the same batchId to learn the outcome` }, false);
    }, ms);
    const p: Pending = { batchId: batch.batchId, tab: tab.id, resolve, timer, promise };
    this.pending.set(delivery, p);
    this.inFlight.set(key, p);
    let sent = false;
    try {
      sent = tab.deliver(envelope);
    } catch {
      sent = false;
    }
    if (!sent) {
      // it never left: nothing ran
      this.settle(delivery, { status: "not-run", batchId: batch.batchId, reason: `the delivery to tab ${tab.id} failed (its connection is gone)` }, false);
      this.removeTab(tab.id);
    } else this.log(`bridge: "${batch.label}" (${batch.batchId}) from ${session.actor.id} to tab ${tab.id}`);
    return promise;
  }

  /** A tab's reply to a delivery. False when nothing waited for it. */
  reply(delivery: string, reply: unknown, fromTab?: string): boolean {
    const p = this.pending.get(delivery);
    if (!p) {
      // a reply after the timeout: kept, so a resend of that batchId gets it
      const key = this.late.get(delivery);
      if (!key || !isObj(reply)) return false;
      this.late.delete(delivery);
      this.results.set(key, { ...(reply as Record<string, unknown>), batchId: key.slice(key.indexOf(":") + 1), tab: fromTab ?? "?" } as BridgeOutcome);
      this.trim();
      return true;
    }
    if (fromTab && fromTab !== p.tab) return false;
    if (!isObj(reply) || !["applied", "read", "refused", "invalid"].includes(reply.status as string)) {
      this.settle(delivery, { status: "may-have-run", batchId: p.batchId, tab: p.tab, reason: "the tab answered with something that is not a reply" }, false);
      return true;
    }
    this.settle(delivery, { ...(reply as Record<string, unknown>), batchId: p.batchId, tab: p.tab } as BridgeOutcome, true);
    return true;
  }

  private settle(delivery: string, outcome: BridgeOutcome, final: boolean) {
    const p = this.pending.get(delivery);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(delivery);
    const key = [...this.inFlight].find(([, v]) => v === p)?.[0];
    if (key) {
      this.inFlight.delete(key);
      // only a tab's own answer is final; `not-run` and `may-have-run` let a resend try again
      if (final) this.results.set(key, outcome);
      this.trim();
    }
    p.resolve(outcome);
  }

  private trim() {
    while (this.results.size > REMEMBERED) this.results.delete(this.results.keys().next().value as string);
    while (this.late.size > REMEMBERED) this.late.delete(this.late.keys().next().value as string);
  }

  /** The server stops: everything waiting may have run. */
  close(): void {
    for (const [delivery, p] of [...this.pending]) this.settle(delivery, { status: "may-have-run", batchId: p.batchId, tab: p.tab, reason: "the dev server stopped" }, false);
    this.tabs.clear();
    this.sessions.clear();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}
