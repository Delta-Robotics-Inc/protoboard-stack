/**
 * Where an agent's view batch goes (PB-1179; collaboration D1): the person's
 * live tab when one is open (the `protoboard dev` server's bridge, which also
 * relays VS Code tabs), else the project's headless render service, which is
 * the scene's owner when nobody looks (plan.md DEFAULT: headless by default).
 * Either way the batch reaches a view store (uhd-viewer `src/cad/state/`)
 * that checks it, logs it and answers; every answer says which path it took.
 *
 * - Live: `connectBridge` (./../dev/bridgeClient.ts), one session per MCP
 *   server and project, reconnected when the dev server restarted.
 * - Headless: `ensureRenderService` starts the service when none runs; its
 *   `/batch` route (`sceneBatchRoute`, served by `protoboard views service`)
 *   hands the batch to the warm page's viewer (`viewer.bridge`), mirrors the
 *   op log to `.protoboard/local/scene-oplog.jsonl`, and puts the last state
 *   it saw back into a page that was reloaded (a new epoch).
 *
 * No tool here evaluates code: batches are typed verbs, and text an agent
 * writes travels as data with its author.
 */
import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { BridgeClient } from "../dev/bridgeClient.js";
import type { Journal } from "../dev/journal.js";

export type Route = "live-tab" | "headless";

/** A batch as the view store takes it (uhd-viewer `Batch`). */
export interface SceneBatch {
  batchId: string;
  label: string;
  ops: unknown[];
  expectSeq?: number;
  expectVersions?: Record<string, number>;
  leaseToken?: number;
  state?: boolean;
}

/** What came back, and which way it went. */
export type SceneOutcome = Record<string, unknown> & { status: string; route: Route; via: Record<string, unknown> };

export interface SceneTarget {
  route?: "auto" | "live" | "headless";
  /** A live tab id (`protoboard dev` page or VS Code tab); default: the one the person used last. */
  tab?: string;
  /** Headless: the level (instance path) whose 3D view owns the scene; default the whole assembly. */
  level?: string;
  timeoutMs?: number;
}

export interface SceneDeps {
  connectBridge(root: string, options: { name: string }): Promise<BridgeClient>;
  /** The render service client (started when none runs). */
  renderService(root: string): Promise<{ stream<T>(path: string, body: unknown): Promise<T>; record: { url: string } }>;
  agentName(): string;
}

interface Session {
  live?: { client: BridgeClient; url: string };
  /** The headless actor of this MCP server for this project. */
  actor: { kind: "agent"; id: string; session: string; name: string };
}

const sessions = new Map<string, Session>();

function sessionFor(root: string, name: string): Session {
  let s = sessions.get(root);
  if (!s) {
    const id = randomBytes(6).toString("base64url");
    s = { actor: { kind: "agent", id: `agent:${id}`, session: id, name } };
    sessions.set(root, s);
  }
  return s;
}

/** Forget cached sessions (tests). */
export function resetSceneSessions(): void {
  sessions.clear();
}

async function liveClient(root: string, deps: SceneDeps, s: Session, fresh = false): Promise<BridgeClient | undefined> {
  if (s.live && !fresh) return s.live.client;
  try {
    const client = await deps.connectBridge(root, { name: deps.agentName() });
    s.live = { client, url: client.url };
    return client;
  } catch {
    s.live = undefined;
    return undefined;
  }
}

/**
 * Send a batch to the scene's owner. `observe` asks for what is drawn
 * (`"components"`: with the parts inside bodies, a board's U3).
 */
export async function sendScene(root: string, batch: SceneBatch, target: SceneTarget, deps: SceneDeps, observe?: boolean | "components"): Promise<SceneOutcome> {
  const s = sessionFor(root, deps.agentName());
  const want = target.route ?? "auto";
  if (want !== "headless") {
    let client = await liveClient(root, deps, s);
    let tabs = client ? await client.tabs().catch(() => undefined) : undefined;
    // a restarted dev server: its key and sessions are new
    if (client && tabs === undefined) {
      client = await liveClient(root, deps, s, true);
      tabs = client ? await client.tabs().catch(() => undefined) : undefined;
    }
    const usable = (tabs ?? []).filter((t) => !target.tab || t.id === target.tab);
    if (client && usable.length) {
      let out = (await client.call({ ...batch, ...(target.tab ? { tab: target.tab } : {}), ...(observe ? { observe } : {}), ...(target.timeoutMs ? { timeoutMs: target.timeoutMs } : {}) })) as Record<string, unknown>;
      // an expired session (8 h idle) or a restarted server: mint a new one and send once more (the batch id is per session)
      if (out.status === "not-run" && /session token|HTTP 401/.test(String(out.reason ?? ""))) {
        client = await liveClient(root, deps, s, true);
        if (client) out = (await client.call({ ...batch, ...(target.tab ? { tab: target.tab } : {}), ...(observe ? { observe } : {}) })) as Record<string, unknown>;
      }
      return { ...out, status: String(out.status), route: "live-tab", via: { devServer: s.live?.url, tab: out.tab ?? target.tab ?? usable.find((t) => t.default)?.id } } as SceneOutcome;
    }
    if (want === "live") {
      return { status: "not-run", batchId: batch.batchId, reason: client ? `no live tab${target.tab ? ` ${target.tab}` : ""} is open on this project` : "no protoboard dev server with a bridge runs for this project (start `protoboard dev`, or open the viewer in VS Code)", route: "live-tab", via: {} };
    }
  }
  const service = await deps.renderService(root);
  const out = await service.stream<Record<string, unknown>>("/batch", { level: target.level ?? "", batch: { ...batch, batchId: `${s.actor.session}:${batch.batchId}` }, actor: s.actor, ...(observe ? { observe } : {}) });
  if (typeof out?.batchId === "string") out.batchId = out.batchId.slice(out.batchId.indexOf(":") + 1);
  return { ...out, status: String(out?.status ?? "may-have-run"), route: "headless", via: { renderService: service.record.url, level: target.level ?? "", tab: out?.tab } } as SceneOutcome;
}

// ---------------------------------------------------------------------------------------------
// The render service's side: `POST /batch` (served by `protoboard views service`)

/** What the route needs of the render service (core `RenderService.withScene`). */
export interface SceneService {
  withScene<T>(level: string, job: (browser: { evaluate<R>(expression: string): Promise<R> }, info: { fresh: boolean; url: string }) => Promise<T>): Promise<T>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** The keys a host may write back into a reloaded page. */
const WRITABLE = ["camera", "selection", "highlight", "isolation", "visibility", "direction", "sections", "explode", "namedViews", "annotations"];

/** The last state the route saw per level, to put back into a page that was reloaded (a new epoch). */
const mirrors = new Map<string, { epoch: string; state: Record<string, unknown> }>();

/**
 * Runs one agent batch in the headless page: the page's viewer applies it
 * (`viewer.bridge`, as a live tab would), the reply's log goes to the
 * journal, and the agent gets the reply without it.
 */
export async function runHeadlessBatch(service: SceneService, journal: Journal | undefined, body: unknown): Promise<Record<string, unknown>> {
  if (!isObj(body) || !isObj(body.batch) || !isObj(body.actor)) return { status: "invalid", error: "expected { level, batch, actor, observe? }" };
  const a = body.actor;
  if (a.kind !== "agent" || typeof a.id !== "string" || !/^agent:[\w-]{1,64}$/.test(a.id) || typeof a.session !== "string" || (a.name !== undefined && typeof a.name !== "string")) return { status: "invalid", error: "actor must be an agent session ({ kind: agent, id: agent:<session>, session, name? })" };
  // DEFAULT: a level is an instance path of at most 512 characters; an agent's name at most 64
  const level = typeof body.level === "string" && body.level.length <= 512 && !/(^|\/)\.\.?(\/|$)|\\/.test(body.level) ? body.level.replace(/^\/+|\/+$/g, "") : "";
  const tab = `headless:${level || "root"}`;
  const reply = await service.withScene(level, async (b) => {
    const epoch = await b.evaluate<string | null>(`(() => { const h = window.__uhdViewHub; return h && h.store ? h.store.epoch : null; })()`);
    const mirror = mirrors.get(level);
    let restored = false;
    if (epoch && mirror && mirror.epoch !== epoch) {
      // the page was reloaded (a rebuild, views check, another level): put back what the agents had set, as the host
      const state = Object.fromEntries(Object.entries(mirror.state).filter(([k]) => WRITABLE.includes(k)));
      restored = await b.evaluate<boolean>(`(() => { try { const v = window.protoboardDev && window.protoboardDev.viewer; if (!v || !v.setViewState) return false; v.setViewState(${JSON.stringify(state)}); return true; } catch (e) { return false; } })()`);
    }
    const envelope = {
      type: "uhd-viewer:bridge",
      id: randomBytes(9).toString("base64url"),
      batch: body.batch,
      actor: { kind: "agent", id: a.id, session: a.session, ...(typeof a.name === "string" ? { name: a.name.slice(0, 64) } : {}) },
      ...(body.observe === true || body.observe === "components" ? { observe: body.observe } : {}),
      ...(journal ? { since: journal.since(tab) ?? { epoch: "", seq: 0 }, ...(journal.wantCheckpoint(tab) ? { checkpoint: true } : {}) } : {}),
    };
    const msg = await b.evaluate<{ reply?: Record<string, unknown>; error?: string } | null>(
      `(() => { const v = window.protoboardDev && window.protoboardDev.viewer; if (!v || typeof v.bridge !== "function") return { error: "the headless page has no viewer bridge (an older viewer build?)" }; return v.bridge(${JSON.stringify(envelope)}) || { error: "the viewer did not take the batch" }; })()`,
    );
    return { msg, restored };
  });
  if (!reply.msg || !isObj(reply.msg.reply)) return { status: "may-have-run", batchId: String(body.batch.batchId ?? ""), reason: reply.msg?.error ?? "no reply from the headless page", tab };
  const { log, checkpoint, ...rest } = reply.msg.reply;
  let logged: number | undefined;
  if (journal && (log || checkpoint)) {
    try {
      logged = journal.record(tab, { ...(isObj(log) ? { log: log as { epoch: string; entries: unknown[] } } : {}), ...(checkpoint ? { checkpoint } : {}) });
    } catch {
      logged = undefined;
    }
  }
  if (typeof rest.epoch === "string" && isObj(rest.state)) mirrors.set(level, { epoch: rest.epoch, state: rest.state });
  else if (typeof rest.epoch === "string" && mirrors.get(level)) mirrors.get(level)!.epoch = rest.epoch;
  return { ...rest, tab, ...(logged !== undefined ? { logged } : {}), ...(reply.restored ? { restored: true } : {}) };
}

/** The `/batch` route for `serveRenderService`'s routes. */
export function sceneBatchRoute(service: SceneService, journal: Journal | undefined) {
  return async (body: unknown, res: ServerResponse) => {
    let out: Record<string, unknown>;
    try {
      out = await runHeadlessBatch(service, journal, body);
    } catch (e) {
      out = { status: "may-have-run", reason: `the headless page failed: ${(e as Error).message.split("\n")[0]}` };
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(`${JSON.stringify(out)}\n`);
  };
}
