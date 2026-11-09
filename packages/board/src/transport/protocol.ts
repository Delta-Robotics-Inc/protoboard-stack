/**
 * The board service's wire protocol (contract section 10): JSON-RPC 2.0 over WebSocket, methods mirroring the
 * service API one to one, `board.event` notifications, and what each method takes and returns. Shared by the
 * server (`serveBoard`) and the client (`connectBoard`).
 */
import { z } from "zod";
import { createDocument, type BoardDocument } from "../document.js";
import { BoardIndex, type IndexItem } from "../index-spatial.js";
import { listOperations, PLANNED_OPERATIONS } from "../ops/index.js";
import type { Actor } from "../ops/registry.js";
import type { BoardRecord, Netlist } from "../schema.js";
import type { BoardService, BoardSnapshot } from "../service.js";
import { byCodeUnit } from "../canonical.js";
import { toJsonSchema, type JsonSchema } from "./json-schema.js";

/** The WebSocket subprotocol a client offers (and the server echoes). */
export const BOARD_PROTOCOL = "protoboard.board.v1";
/** A browser client, which cannot set headers, may carry the token as a second subprotocol: this prefix plus the token. */
export const TOKEN_PROTOCOL_PREFIX = "protoboard.token.";
/** The file a live service writes in the board's local folder. */
export const SERVICE_FILE = "service.json";
/** DEFAULT: the largest message a server accepts (4 MiB; a 200-operation transaction is far smaller). */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
/** DEFAULT: connections a server holds at once. */
export const MAX_CONNECTIONS = 32;
/** Requests one JSON-RPC batch may hold. */
export const MAX_BATCH = 64;
/** Sockets a server accepts beyond `maxConnections`, for handshakes in progress and refusals being answered. */
export const HANDSHAKE_SLACK = 8;
/** How long a socket may take to send its upgrade request (headers and all) before it is dropped. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
/** DEFAULT: a keepalive ping this often; a client that sent nothing since the last one is dropped (0 turns it off). */
export const KEEPALIVE_MS = 30_000;
/** DEFAULT: bytes a connection may hold unsent (a client that does not read) before it is dropped. */
export const MAX_SEND_BUFFER_BYTES = 32 * 1024 * 1024;

/** What `service.json` holds (contract section 7: pid, port, token, epoch; the rest is informative). */
export interface ServiceFile {
  pid: number;
  port: number;
  token: string;
  epoch: string;
  host: "127.0.0.1";
  protocol: typeof BOARD_PROTOCOL;
  dir?: string;
}

/** JSON-RPC 2.0 error codes: the standard ones and the service's own. */
export const RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** The service threw (a closed service, saving an in-memory board, a refused actor). */
  service: -32000,
  /** The actor is not allowed on this connection. */
  actor: -32001,
} as const;

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** A failed call, as the client raises it. */
export class BoardRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "BoardRpcError";
  }
}

// ---------------------------------------------------------------- actors on the wire

const NAME = /^[A-Za-z0-9_.@-]{1,64}$/;
/**
 * An actor a client may name. `system` never crosses the wire. Agents are `agent:<name>`, routers `router:<name>`,
 * hosts `host:<name>` or `import:<id>`; a person is `human`. Which kinds a connection may use is the server's
 * policy (`ServeOptions.actors`); an agent's entry points (the MCP tools, the CLI under an agent) never offer
 * `human`.
 */
export const WireActor = z
  .object({ kind: z.enum(["human", "agent", "router", "host"]), id: z.string().min(1).max(80), name: z.string().max(64).optional() })
  .strict()
  .superRefine((a, ctx) => {
    const [prefix, ...rest] = a.id.split(":");
    const key = rest.join(":");
    const ok =
      a.kind === "human"
        ? NAME.test(a.id)
        : a.kind === "agent"
          ? prefix === "agent" && NAME.test(key)
          : a.kind === "router"
            ? prefix === "router" && NAME.test(key)
            : (prefix === "host" || prefix === "import") && NAME.test(key);
    if (!ok) ctx.addIssue({ code: "custom", message: `a ${a.kind} actor's id must be ${a.kind === "human" ? "a plain name" : a.kind === "host" ? "host:<name> or import:<id>" : `${a.kind}:<name>`} (letters, digits, _ . @ -)` });
  });

/** An agent actor from a name (`claude-code` or `agent:claude-code`), cleaned to the wire's form. */
export function agentActor(name: string): Actor {
  const clean = name.replace(/^agent:/, "").replace(/[^A-Za-z0-9_.@-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "agent";
  return { kind: "agent", id: `agent:${clean}`, name: clean };
}

// ---------------------------------------------------------------- method params

const Meta = z.object({ batchId: z.string().min(1).max(200).optional(), leaseToken: z.number().int().optional() }).strict().optional();
const BoxP = z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }).strict();
const Layers = z.array(z.string().min(1).max(40)).max(64).optional();
const Kinds = z.array(z.string().min(1).max(40)).max(32).optional();

export const QueryParams = z.discriminatedUnion("by", [
  z.object({ by: z.literal("region"), box: BoxP, layers: Layers, kinds: Kinds, records: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("at"), point: z.object({ x: z.number(), y: z.number() }).strict(), tolerance: z.number().nonnegative().optional(), layers: Layers, kinds: Kinds, records: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("net"), name: z.string().min(1).max(200), records: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("id"), ids: z.array(z.string().min(1).max(300)).min(1).max(1000), records: z.boolean().optional() }).strict(),
]);
export type QueryParams = z.infer<typeof QueryParams>;

/** Each method's params. The transaction and the lease claim are checked by the engine itself. */
export const METHOD_PARAMS = {
  "board.snapshot": z.object({}).strict().optional(),
  "board.query": QueryParams,
  "board.apply": z.object({ tx: z.record(z.unknown()), actor: WireActor }).strict(),
  "board.undo": z.object({ actor: WireActor, meta: Meta }).strict(),
  "board.redo": z.object({ actor: WireActor, meta: Meta }).strict(),
  "board.revertChangeSet": z.object({ actor: WireActor, id: z.string().min(1).max(200), meta: Meta }).strict(),
  "board.claim": z.object({ actor: WireActor, claim: z.record(z.unknown()) }).strict(),
  "board.release": z.object({ actor: WireActor, leaseId: z.string().min(1).max(200).optional() }).strict(),
  "board.takeOver": z.object({ by: WireActor.optional() }).strict().optional(),
  "board.presence": z.object({}).strict().optional(),
  "board.save": z.object({}).strict().optional(),
  "board.checkpoint": z.object({ label: z.string().max(200) }).strict(),
  "board.operations": z.object({ all: z.boolean().optional() }).strict().optional(),
  "board.log": z.object({ since: z.number().int().nonnegative().optional() }).strict().optional(),
  "board.changeSets": z.object({}).strict().optional(),
  /** Stop the serving process (it saves and closes the board). Offered only by a server given `onShutdown` (`protoboard board serve`). */
  "board.shutdown": z.object({}).strict().optional(),
} as const;
export type BoardMethod = keyof typeof METHOD_PARAMS;
export const BOARD_METHODS = Object.keys(METHOD_PARAMS) as BoardMethod[];

// ---------------------------------------------------------------- results

/** A snapshot as it crosses the wire: every record (sorted by id), the netlist and every record's version. */
export interface WireSnapshot {
  epoch: string;
  seq: number;
  records: BoardRecord[];
  netlist?: Netlist;
  versions: Record<string, number>;
}

export function snapshotToWire(s: BoardSnapshot): WireSnapshot {
  const ids = [...s.doc.records.keys()].sort(byCodeUnit);
  return {
    epoch: s.epoch,
    seq: s.seq,
    records: ids.map((id) => s.doc.records.get(id)!),
    ...(s.doc.netlist ? { netlist: s.doc.netlist } : {}),
    versions: Object.fromEntries(ids.map((id) => [id, s.version(id)])),
  };
}

/** A snapshot rebuilt from the wire: the document, its derived nets and a query index of its own. */
export function snapshotFromWire(w: WireSnapshot): BoardSnapshot {
  const doc: BoardDocument = createDocument(w.records, w.netlist);
  let index: BoardIndex | undefined;
  return {
    epoch: w.epoch,
    seq: w.seq,
    doc,
    version: (id) => w.versions[id] ?? 0,
    get query() {
      return (index ??= BoardIndex.build(doc));
    },
  };
}

export interface QueryResult {
  epoch: string;
  seq: number;
  items: IndexItem[];
  /** For `by: "id"`: ids that are neither a record nor a pad on this board. */
  missing?: string[];
  /**
   * The stored records behind the items (pads give their footprint), sorted by id, with versions: when asked
   * (`records: true`), and always for ids asked by `by: "id"` that have no place on the board (rules, layers).
   */
  records?: BoardRecord[];
  versions?: Record<string, number>;
}

/** Run a query against a snapshot (the server's, or a local one). */
export function runQuery(s: BoardSnapshot, q: QueryParams): QueryResult {
  let items: IndexItem[];
  let missing: string[] | undefined;
  const extra: string[] = [];
  const opts = (o: { layers?: string[]; kinds?: string[] }) => ({ ...(o.layers ? { layers: o.layers } : {}), ...(o.kinds ? { kinds: o.kinds as never } : {}) });
  switch (q.by) {
    case "region":
      items = s.query.region(q.box, opts(q));
      break;
    case "at":
      items = s.query.at(q.point, { ...opts(q), ...(q.tolerance !== undefined ? { tolerance: q.tolerance } : {}) });
      break;
    case "net": {
      const m = s.query.net(q.name);
      items = [...m.pads, ...m.tracks, ...m.vias, ...m.zones].map((id) => s.query.byId(id)).filter((x): x is IndexItem => !!x);
      break;
    }
    case "id": {
      // records without a place on the board (rules, net classes, layers) have no item; asked by id they still
      // come back as records
      items = [];
      missing = [];
      for (const id of q.ids) {
        const it = s.query.byId(id);
        if (it) items.push(it);
        else if (s.doc.records.has(id)) extra.push(id);
        else missing.push(id);
      }
      break;
    }
  }
  const out: QueryResult = { epoch: s.epoch, seq: s.seq, items, ...(missing?.length ? { missing } : {}) };
  if (q.records || extra.length) {
    const ids = [...new Set([...items.map((i) => (i.kind === "pad" ? i.footprint! : i.id)), ...extra])].filter((id) => s.doc.records.has(id)).sort(byCodeUnit);
    out.records = ids.map((id) => s.doc.records.get(id)!);
    out.versions = Object.fromEntries(ids.map((id) => [id, s.version(id)]));
  }
  return out;
}

/** One operation as `board.operations` describes it: the registry entry with its input as JSON Schema. */
export interface OperationInfo {
  name: string;
  title: string;
  description: string;
  audience: "all" | "system";
  phase: 1 | 2;
  example: Record<string, unknown>;
  input: JsonSchema;
}

/** The registry for bindings: operations open to every actor (all of them with `all: true`), and the planned ones. */
export function describeOperations(options: { all?: boolean } = {}): { operations: OperationInfo[]; planned: { name: string; description: string }[] } {
  return {
    operations: listOperations()
      .filter((d) => options.all || d.audience === "all")
      .map((d) => ({ name: d.name, title: d.title, description: d.description, audience: d.audience, phase: d.phase, example: d.example, input: toJsonSchema(d.input) })),
    planned: PLANNED_OPERATIONS.map((p) => ({ ...p })),
  };
}

/** Dispatch one method on a service (params already checked). Shared by the server and a client's local mode. */
export function callService(svc: BoardService, method: BoardMethod, params: unknown): unknown {
  const p = (params ?? {}) as Record<string, never>;
  switch (method) {
    case "board.snapshot":
      return snapshotToWire(svc.snapshot());
    case "board.query":
      return runQuery(svc.snapshot(), params as QueryParams);
    case "board.apply":
      return svc.apply(p.tx, p.actor);
    case "board.undo":
      return svc.undo(p.actor, p.meta);
    case "board.redo":
      return svc.redo(p.actor, p.meta);
    case "board.revertChangeSet":
      return svc.revertChangeSet(p.actor, p.id, p.meta);
    case "board.claim":
      return svc.claim(p.actor, p.claim);
    case "board.release":
      return svc.release(p.actor, p.leaseId);
    case "board.takeOver":
      return svc.takeOver(p.by);
    case "board.presence":
      return svc.presence();
    case "board.save":
      return svc.save();
    case "board.checkpoint":
      return svc.checkpoint(p.label);
    case "board.operations":
      return describeOperations({ all: (p as { all?: boolean }).all });
    case "board.log":
      return svc.log((p as { since?: number }).since);
    case "board.changeSets":
      return svc.changeSets();
    case "board.shutdown":
      throw new Error("only a serving process can be stopped (protoboard board serve); this board is open in this process");
  }
}
