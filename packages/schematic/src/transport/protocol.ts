/**
 * The schematic service's wire protocol (contract section 10, after the board core's): JSON-RPC 2.0 over
 * WebSocket on 127.0.0.1, methods mirroring the service one to one, `schematic.event` notifications, and the shapes
 * each method takes and returns. Browser-safe: no Node module is imported here; the server (`serveSchematic`) and
 * the client (`connectSchematic`) are in Node-only files beside it.
 */
import { z } from "zod";
import { agentActor, byCodeUnit, RPC_ERRORS, toJsonSchema, TOKEN_PROTOCOL_PREFIX, WireActor, type JsonSchema } from "@protoboardai/board/browser";
import { CLEANUP_TOOLS } from "../cleanup.ts";
import { createSchematic, type SchematicDocument } from "../document.ts";
import { listOperations } from "../ops/index.ts";
import { guBoxesMeet, recordBox, type GuBox } from "../record-box.ts";
import type { SchematicRecord } from "../schema.ts";
import type { SchematicCircuit } from "../circuit.ts";
import type { DescribeResult } from "../scene.ts";
import type { SchematicSnapshot } from "../service.ts";

export { agentActor, RPC_ERRORS, TOKEN_PROTOCOL_PREFIX, WireActor };

/** The WebSocket subprotocol a client offers (and the server echoes). */
export const SCHEMATIC_PROTOCOL = "protoboard.schematic.v1";
/** The file a live service writes in the schematic's local folder (`.protoboard/local/schematic/<key>/`). */
export const SCHEMATIC_SERVICE_FILE = "service.json";
/** The notification every connected client gets for each service event. */
export const SCHEMATIC_EVENT = "schematic.event";

/** What `service.json` holds: pid, port, token, epoch; the rest is informative. */
export interface SchematicServiceFile {
  pid: number;
  port: number;
  token: string;
  epoch: string;
  host: "127.0.0.1";
  protocol: typeof SCHEMATIC_PROTOCOL;
  dir?: string;
}

/** A failed call, as the client raises it. */
export class SchematicRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "SchematicRpcError";
  }
}

// ---------------------------------------------------------------- method params

const Meta = z.object({ batchId: z.string().min(1).max(200).optional(), leaseToken: z.number().int().optional() }).strict().optional();
const Id = z.string().min(1).max(300);
const GuBoxP = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** A query: records by id, the records drawing a net, a card's records, or the records whose boxes meet a box (grid units). */
export const SchematicQueryParams = z.discriminatedUnion("by", [
  z.object({ by: z.literal("id"), ids: z.array(Id).min(1).max(1000) }).strict(),
  z.object({ by: z.literal("net"), name: z.string().min(1).max(200) }).strict(),
  z.object({ by: z.literal("card"), id: Id }).strict(),
  z.object({ by: z.literal("region"), box: GuBoxP, kinds: z.array(z.string().min(1).max(20)).max(16).optional() }).strict(),
]);
export type SchematicQueryParams = z.infer<typeof SchematicQueryParams>;

const cleanupInput = <N extends (typeof CLEANUP_TOOLS)[number]["name"]>(name: N) => CLEANUP_TOOLS.find((t) => t.name === name)!.input as Extract<(typeof CLEANUP_TOOLS)[number], { name: N }>["input"];
const ChangeSetP = z.object({ id: z.string().min(1).max(200), title: z.string().max(200).optional() }).strict();

/** Each method's params. The transaction and the lease claim are checked by the engine itself. */
export const SCHEMATIC_METHOD_PARAMS = {
  "schematic.snapshot": z.object({}).strict().optional(),
  "schematic.apply": z.object({ tx: z.record(z.unknown()), actor: WireActor }).strict(),
  "schematic.undo": z.object({ actor: WireActor, meta: Meta }).strict(),
  "schematic.redo": z.object({ actor: WireActor, meta: Meta }).strict(),
  "schematic.revertChangeSet": z.object({ actor: WireActor, id: z.string().min(1).max(200), meta: Meta }).strict(),
  "schematic.claim": z.object({ actor: WireActor, claim: z.record(z.unknown()) }).strict(),
  "schematic.release": z.object({ actor: WireActor, leaseId: z.string().min(1).max(200).optional() }).strict(),
  "schematic.takeOver": z.object({ by: WireActor.optional() }).strict().optional(),
  "schematic.presence": z.object({}).strict().optional(),
  "schematic.save": z.object({}).strict().optional(),
  "schematic.checkpoint": z.object({ label: z.string().max(200) }).strict(),
  "schematic.operations": z.object({ all: z.boolean().optional() }).strict().optional(),
  "schematic.log": z.object({ since: z.number().int().nonnegative().optional() }).strict().optional(),
  "schematic.changeSets": z.object({}).strict().optional(),
  "schematic.score": z.object({}).strict().optional(),
  "schematic.checks": z.object({}).strict().optional(),
  "schematic.scene": z.object({ card: z.string().max(300).optional(), net: z.string().max(200).optional(), image: z.enum(["svg", "png", "both", "none"]).optional(), theme: z.enum(["dark", "paper"]).optional(), scale: z.number().positive().max(64).optional() }).strict().optional(),
  "schematic.query": SchematicQueryParams,
  // the cleanup tools (contract section 8.4): inputs from CLEANUP_TOOLS, plus the actor for those that write
  "schematic.listDefects": cleanupInput("schematic_list_defects"),
  "schematic.proposeFixes": cleanupInput("schematic_propose_fixes"),
  "schematic.applyFix": cleanupInput("schematic_apply_fix").extend({ actor: WireActor, batchId: z.string().min(1).max(200).optional() }),
  "schematic.explainDefect": cleanupInput("schematic_explain_defect"),
  "schematic.cleanupPass": cleanupInput("schematic_cleanup_pass").extend({ actor: WireActor, perPass: z.number().int().positive().max(1000).optional(), changeSet: ChangeSetP.optional() }),
  "schematic.revertCleanup": z.object({ actor: WireActor, changeSet: z.object({ id: z.string().min(1).max(200), title: z.string().max(200).optional(), transactions: z.number().int().nonnegative().max(10_000), ops: z.number().int().nonnegative().optional() }).strict() }).strict(),
  /** Stop the serving process (it saves and closes the schematic). Offered only by a server given `onShutdown` (`protoboard schematic serve`). */
  "schematic.shutdown": z.object({}).strict().optional(),
} as const;
export type SchematicMethod = keyof typeof SCHEMATIC_METHOD_PARAMS;
export const SCHEMATIC_METHODS = Object.keys(SCHEMATIC_METHOD_PARAMS) as SchematicMethod[];

/** Methods that change the schematic (a client opened here saves on close after one applied). */
export const SCHEMATIC_WRITES: ReadonlySet<SchematicMethod> = new Set(["schematic.apply", "schematic.undo", "schematic.redo", "schematic.revertChangeSet", "schematic.applyFix", "schematic.cleanupPass", "schematic.revertCleanup"]);

// ---------------------------------------------------------------- snapshots

/** A snapshot as it crosses the wire: every record (sorted by id), the circuit it draws, and every record's version. */
export interface WireSchematicSnapshot {
  epoch: string;
  seq: number;
  records: SchematicRecord[];
  circuit: SchematicCircuit;
  versions: Record<string, number>;
}

export function snapshotToWire(s: SchematicSnapshot): WireSchematicSnapshot {
  const ids = [...s.doc.records.keys()].sort(byCodeUnit);
  return { epoch: s.epoch, seq: s.seq, records: ids.map((id) => s.doc.records.get(id)!), circuit: s.doc.circuit, versions: Object.fromEntries(ids.map((id) => [id, s.version(id)])) };
}

/** A snapshot rebuilt from the wire: `createSchematic(records, circuit)` and the versions. */
export function snapshotFromWire(w: WireSchematicSnapshot): SchematicSnapshot {
  const doc: SchematicDocument = createSchematic(w.records, w.circuit);
  return { epoch: w.epoch, seq: w.seq, doc, version: (id) => w.versions[id] ?? 0 };
}

// ---------------------------------------------------------------- scene

/** The agent scene on the wire: the PNG as base64. */
export interface WireScene {
  json: Record<string, unknown>;
  svg?: string;
  /** base64 */
  png?: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : "=") + (i + 2 < bytes.length ? B64[c & 63] : "=");
  }
  return out;
}
function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let n = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    const bits = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (n < out.length) out[n++] = (bits >> 16) & 255;
    if (n < out.length && i + 2 < clean.length) out[n++] = (bits >> 8) & 255;
    if (n < out.length && i + 3 < clean.length) out[n++] = bits & 255;
  }
  return out.subarray(0, n);
}

export const sceneToWire = (d: DescribeResult): WireScene => ({ json: d.json, ...(d.svg !== undefined ? { svg: d.svg } : {}), ...(d.png ? { png: toBase64(d.png) } : {}) });
export const sceneFromWire = (w: WireScene): DescribeResult => ({ json: w.json, ...(w.svg !== undefined ? { svg: w.svg } : {}), ...(w.png ? { png: fromBase64(w.png) } : {}) });

// ---------------------------------------------------------------- query

/** One record a query found, with its box in grid units. */
export interface SchematicQueryItem {
  id: string;
  kind: SchematicRecord["kind"];
  box?: GuBox;
  card?: string;
  net?: string;
}

export interface SchematicQueryResult {
  epoch: string;
  seq: number;
  items: SchematicQueryItem[];
  /** The stored records behind the items, sorted by id, with their versions. */
  records: SchematicRecord[];
  versions: Record<string, number>;
  /** For `by: "id"`: ids that are no record of this schematic. */
  missing?: string[];
}

/** Run a query against a snapshot (the server's, or a local one). */
export function runQuery(s: SchematicSnapshot, q: SchematicQueryParams): SchematicQueryResult {
  const doc = s.doc;
  const ids = new Set<string>();
  let missing: string[] | undefined;
  switch (q.by) {
    case "id":
      missing = [];
      for (const id of q.ids) {
        if (doc.records.has(id)) ids.add(id);
        else missing.push(id);
      }
      break;
    case "net": {
      const parts = new Set((doc.nets.get(q.name)?.pins ?? []).map((k) => k.slice(0, k.lastIndexOf(":"))));
      for (const r of doc.records.values()) {
        if ((r.kind === "wire" || r.kind === "label" || r.kind === "power") && r.net === q.name) ids.add(r.id);
        else if (r.kind === "symbol" && parts.has(r.part)) ids.add(r.id);
      }
      break;
    }
    case "card":
      if (doc.records.has(q.id)) ids.add(q.id);
      for (const r of doc.records.values()) if ("card" in r && r.card === q.id) ids.add(r.id);
      break;
    case "region": {
      const box: GuBox = [Math.min(q.box[0], q.box[2]), Math.min(q.box[1], q.box[3]), Math.max(q.box[0], q.box[2]), Math.max(q.box[1], q.box[3])];
      for (const r of doc.records.values()) {
        if (q.kinds && !q.kinds.includes(r.kind)) continue;
        const b = recordBox(doc, r);
        if (b && guBoxesMeet(b, box)) ids.add(r.id);
      }
      break;
    }
  }
  const sorted = [...ids].sort(byCodeUnit);
  const records = sorted.map((id) => doc.records.get(id)!);
  const items = records.map((r): SchematicQueryItem => {
    const b = recordBox(doc, r);
    const card = "card" in r && typeof r.card === "string" ? r.card : undefined;
    const net = "net" in r && typeof r.net === "string" ? r.net : undefined;
    return { id: r.id, kind: r.kind, ...(b ? { box: b } : {}), ...(card ? { card } : {}), ...(net ? { net } : {}) };
  });
  return { epoch: s.epoch, seq: s.seq, items, records, versions: Object.fromEntries(sorted.map((id) => [id, s.version(id)])), ...(missing?.length ? { missing } : {}) };
}

// ---------------------------------------------------------------- the operation registry

/** One operation as `schematic.operations` describes it: the registry entry with its input as JSON Schema. */
export interface SchematicOperationInfo {
  name: string;
  title: string;
  description: string;
  audience: "all" | "system";
  phase: 3;
  example: Record<string, unknown>;
  input: JsonSchema;
}

/** The registry for bindings: operations open to every actor (all of them with `all: true`). */
export function describeSchematicOperations(options: { all?: boolean } = {}): { operations: SchematicOperationInfo[] } {
  return {
    operations: listOperations()
      .filter((d) => options.all || d.audience === "all")
      .map((d) => ({ name: d.name, title: d.title, description: d.description, audience: d.audience, phase: d.phase, example: d.example, input: toJsonSchema(d.input) })),
  };
}
