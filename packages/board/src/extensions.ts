/**
 * Extension points (contract section 11): importers turn a source into a document or operations, checks turn a
 * snapshot into findings with a stable shape, and renderers read snapshots and change events.
 */
import { z } from "zod";
import { byCodeUnit, canonical, sha1Hex } from "./canonical.js";
import type { BoardDocument } from "./document.js";
import type { Box } from "./geometry.js";
import type { OpCall } from "./ops/registry.js";
import { RuleTier, type Netlist } from "./schema.js";
import type { BoardEvent, BoardSnapshot } from "./service.js";
import type { Transaction } from "./transaction.js";

// ---------------------------------------------------------------- importers

export interface ImportSource {
  path?: string;
  bytes?: Uint8Array;
  text?: string;
  /** A hint such as "kicad_pcb", "circuit-json", "epro2". */
  kind?: string;
}

export interface ImportContext {
  /** The board being imported into, when the import adds to an existing one. */
  current?: BoardDocument;
}

export interface ImportReportItem {
  level: "dropped" | "approximated" | "info";
  message: string;
  /** Where in the source (an element id, a line). */
  source?: string;
  ids?: string[];
}

export interface ImportResult {
  /** A whole board (a new board), or */
  document?: BoardDocument;
  /** operations applied as host actor `import:<id>`. */
  ops?: OpCall[];
  netlist?: Netlist;
  report: ImportReportItem[];
}

export interface Importer {
  id: string;
  title: string;
  accepts(source: ImportSource): boolean;
  import(source: ImportSource, ctx: ImportContext): Promise<ImportResult>;
}

/** The host transaction for an import's operations (a batch id from the content, so a resend is idempotent). */
export function importResultToTransaction(importerId: string, result: ImportResult, label = "import board objects from source"): Transaction {
  if (!result.ops?.length) throw new Error("this import result has no operations");
  return { batchId: `import-${importerId.replace(/[^\w.-]/g, "_")}-${sha1Hex(canonical(result.ops)).slice(0, 16)}`, label, ops: result.ops, provenance: { by: "imported", tool: importerId } };
}

// ---------------------------------------------------------------- checks

export const FindingSchema = z
  .object({
    id: z.string().regex(/^f:[\w.-]+:[0-9a-f]{12}$/),
    check: z.string().regex(/^[\w.-]+$/),
    rule: z.string().min(1).optional(),
    tier: RuleTier.optional(),
    severity: z.enum(["error", "warning", "info"]),
    objects: z.array(z.string().min(1)).max(1000),
    location: z.object({ x: z.number().int(), y: z.number().int(), layer: z.string().optional() }).strict(),
    box: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }).strict().optional(),
    measured: z.number().int().optional(),
    required: z.number().int().optional(),
    message: z.string().min(1).max(500),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

export interface CheckContext {
  /** Checks may skip work outside this box (live checks after an edit); absent: the whole board. */
  region?: Box;
}

export interface Check {
  id: string;
  title: string;
  run(snapshot: BoardSnapshot, ctx: CheckContext): Finding[];
}

/** A finding's stable id: the check, the rule, the sorted objects and the location rounded to 1 micrometer. */
export function findingId(check: string, rule: string | undefined, objects: readonly string[], location: { x: number; y: number; layer?: string }): string {
  const key = canonical({ check, rule: rule ?? "", objects: [...objects].sort(byCodeUnit), x: Math.round(location.x / 1000), y: Math.round(location.y / 1000), layer: location.layer ?? "" });
  return `f:${check}:${sha1Hex(key).slice(0, 12)}`;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/** Run checks: validate every finding's shape, drop repeats by id, sort by severity then id. */
export function runChecks(snapshot: BoardSnapshot, checks: readonly Check[], ctx: CheckContext = {}): Finding[] {
  const out = new Map<string, Finding>();
  for (const c of checks) {
    for (const f of c.run(snapshot, ctx)) {
      const r = FindingSchema.safeParse(f);
      if (!r.success) throw new Error(`check ${c.id} returned a malformed finding: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      if (f.check !== c.id) throw new Error(`check ${c.id} returned a finding of check ${f.check}`);
      if (!out.has(f.id)) out.set(f.id, { ...f, objects: [...f.objects].sort(byCodeUnit) });
    }
  }
  return [...out.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || byCodeUnit(a.id, b.id));
}

// ---------------------------------------------------------------- renderers

/** A renderer or scene exporter: reads snapshots and events, never writes. */
export interface Renderer {
  /** Draw (or export) a whole snapshot. */
  render(snapshot: BoardSnapshot): void;
  /** Bring the drawing up to date after a change event (the snapshot is the new one). */
  update?(event: Extract<BoardEvent, { type: "commit" }>, snapshot: BoardSnapshot): void;
}
