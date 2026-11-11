/**
 * The agent's end of the live-tab bridge (PB-1178; docs/reference/viewer-bridge.md):
 * what the CLI's MCP server (W3-A's view tools) calls to reach the viewer tab
 * a person has open. It finds the project's running `protoboard dev` from its
 * record (`.protoboard/local/dev.json`), mints a session with the record's
 * bridge key, and sends batches.
 *
 * Every call answers with an outcome, never by throwing for a transport
 * problem: the tab's reply (applied, read, refused, invalid), or `not-run`
 * (nothing reached a tab: no server, no tab, the connection was refused) or
 * `may-have-run` (the request may have reached the tab: resend with the same
 * batchId to learn what happened; the tab never applies a batchId twice).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIDGE_KEY_HEADER, BRIDGE_ROUTES, BRIDGE_SESSION_HEADER, type BatchBody, type BridgeOutcome, type Probe } from "./bridge.js";
import { DEV_RECORD, type DevRecord } from "./server.js";

export interface BridgeClient {
  /** The dev server's URL. */
  url: string;
  /** This session's id and the actor the viewer logs for it. */
  session: string;
  actor: { kind: "agent"; id: string; session: string };
  /** Send a batch (empty `ops`: read the view state). */
  call(batch: BatchBody & { tab?: string; observe?: boolean | "components"; probe?: Probe; timeoutMs?: number }): Promise<BridgeOutcome>;
  /** The live tabs (the default one marked). */
  tabs(): Promise<{ id: string; kind: string; label?: string; lastActive: number; default: boolean }[]>;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The running dev server's record, when it offers the bridge. */
export function readDevRecord(root: string): DevRecord | undefined {
  try {
    const r = JSON.parse(readFileSync(join(root, DEV_RECORD), "utf8")) as DevRecord;
    return r.schema === "protoboard.dev/v0" && typeof r.url === "string" ? r : undefined;
  } catch {
    return undefined;
  }
}

/** A transport failure as an outcome: refused before anything was sent is `not-run`; anything later may have run. */
function transportOutcome(batchId: string, e: unknown): BridgeOutcome {
  const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") return { status: "not-run", batchId, reason: `the dev server is not reachable (${code})` };
  return { status: "may-have-run", batchId, tab: "?", reason: `the request failed after it was sent (${(e as Error)?.message ?? String(e)}); resend with the same batchId` };
}

/**
 * Connect to a project's live tab bridge. Throws only when there is nothing to
 * connect to (no running dev server with a bridge, or the key was refused),
 * with what to do.
 */
export async function connectBridge(root: string, options: { name?: string; fetch?: Fetch } = {}): Promise<BridgeClient> {
  const f: Fetch = options.fetch ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<Fetch>);
  const record = readDevRecord(root);
  if (!record) throw new Error("no protoboard dev server is running for this project (start one with `protoboard dev`, or open the project's viewer in VS Code)");
  if (!record.bridge?.key) throw new Error("the running dev server offers no live-tab bridge (it is older than PB-1178): restart it");
  const at = (route: string) => new URL(route.replace(/^\//, ""), record.url).href;
  const res = await f(at(BRIDGE_ROUTES.session), { method: "POST", headers: { "content-type": "application/json", [BRIDGE_KEY_HEADER]: record.bridge.key }, body: JSON.stringify({ name: options.name ?? "agent" }) });
  const body = (await res.json()) as { token?: string; session?: string; actor?: BridgeClient["actor"]; error?: string };
  if (!res.ok || !body.token || !body.session || !body.actor) throw new Error(`the dev server refused a bridge session: ${body.error ?? res.status}`);
  const token = body.token;
  return {
    url: record.url,
    session: body.session,
    actor: body.actor,
    async call(batch) {
      try {
        const r = await f(at(BRIDGE_ROUTES.batch), { method: "POST", headers: { "content-type": "application/json", [BRIDGE_SESSION_HEADER]: token }, body: JSON.stringify(batch) });
        const out = (await r.json()) as BridgeOutcome & { error?: string };
        if (r.status === 400) return { status: "invalid", tab: "-", batchId: batch.batchId, error: out.error ?? "invalid" } as BridgeOutcome;
        if (!r.ok) return { status: "not-run", batchId: batch.batchId, reason: out.error ?? `HTTP ${r.status}` };
        return out;
      } catch (e) {
        return transportOutcome(batch.batchId, e);
      }
    },
    async tabs() {
      const r = await f(at(BRIDGE_ROUTES.state), { headers: { [BRIDGE_SESSION_HEADER]: token } });
      const out = (await r.json()) as { tabs?: Awaited<ReturnType<BridgeClient["tabs"]>> };
      return out.tabs ?? [];
    },
  };
}
