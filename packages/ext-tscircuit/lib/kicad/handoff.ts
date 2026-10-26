/**
 * The handoff record of a locked board, `<board dir>/kicad/handoff.json`
 * (docs/specs/pcb-kicad-handoff.md §3), and the comparison check makes with
 * it (§4).
 *
 * A board is locked exactly when the record exists with state "locked". It
 * holds the model and the KiCad files as netlists at lock, so check can tell
 * a model change (record → model) from a hand edit in KiCad (record → KiCad),
 * and a change made on both sides (applied) from one still pending.
 */
import type { CapabilityResult } from "@protoboardai/core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { diffNetlists, type Change, type Netlist } from "./netlists.ts";

export const HANDOFF_SCHEMA = "protoboard.kicad-handoff/v0";

export interface Handoff {
  schema: typeof HANDOFF_SCHEMA;
  state: "locked" | "unlocked";
  /** UHD board module id. */
  board: string;
  lockedAt: string;
  unlockedAt?: string;
  /** Re-recorded by circuit:lock --input refresh=true. */
  refreshedAt?: string;
  /** Digest of the board projection (core boardNetlist) at lock. */
  netlistDigest: string;
  /** Digest of the outline, holes, layers and thickness at lock. */
  boardShape: string;
  /** The model at lock, as the export named it. */
  model: Netlist;
  /** The KiCad board as exported (read back from the files written). */
  kicad: Netlist;
  /** Differences between the two at lock (converter limits), so they are not reported as hand edits later. */
  exportedWith?: string[];
  /** Where the exported schematic and board disagreed at lock (KiCad parity), so check reports only new ones. */
  parityAtLock?: string[];
  tscircuit: { sourceDigest: string; circuit: string; core: string };
  tools: { kicad?: string; converter: string; provider: string };
  /** Where KiCad had each footprint at lock (board frame, by instance): export measures moves made in KiCad from here (PB-1027). */
  positions?: Record<string, { x: number; y: number; rot: number; side: "top" | "bottom" }>;
  /** Digest of each KiCad file as exported, by path relative to kicad/. */
  files: Record<string, string>;
}

export const kicadDir = (dir: string) => `${dir}/kicad`;
export const handoffFile = (dir: string) => `${kicadDir(dir)}/handoff.json`;

export function readHandoff(root: string, dir: string): Handoff | undefined {
  const f = join(root, handoffFile(dir));
  if (!existsSync(f)) return undefined;
  try {
    const h = JSON.parse(readFileSync(f, "utf8")) as Handoff;
    return h?.schema === HANDOFF_SCHEMA ? h : undefined;
  } catch {
    return undefined;
  }
}

export const isLocked = (root: string, dir: string) => readHandoff(root, dir)?.state === "locked";

type Diagnostic = NonNullable<CapabilityResult["diagnostics"]>[number];

export interface Comparison {
  /** Model changes since lock not yet in KiCad. */
  pending: Change[];
  /** Model changes since lock that KiCad has too. */
  applied: Change[];
  /** KiCad changes since lock that are not model changes (hand edits). */
  handEdits: Change[];
}

/** Three-way: record → model and record → KiCad, matched by change key. */
export function compare(record: Handoff, model: Netlist, kicad: Netlist): Comparison {
  const dm = diffNetlists(record.model, model);
  const dk = diffNetlists(record.kicad, kicad);
  const km = new Set(dm.map((c) => c.key));
  const kk = new Set(dk.map((c) => c.key));
  return { pending: dm.filter((c) => !kk.has(c.key)), applied: dm.filter((c) => kk.has(c.key)), handEdits: dk.filter((c) => !km.has(c.key)) };
}

const few = (cs: Change[], n = 6) => `${cs.slice(0, n).map((c) => c.message).join("; ")}${cs.length > n ? `; (+${cs.length - n} more)` : ""}`;

/** The comparison as check findings (spec §4 codes). */
export function comparisonDiagnostics(c: Comparison, ctx: { board: string; file: string; shapeChanged: boolean; module: string }): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (severity: Diagnostic["severity"], code: string, message: string, file = ctx.file) => out.push({ code, severity, message, entity: { kind: "definition", id: ctx.module }, source: { file } });
  const pend = (k: Change["kind"][]) => c.pending.filter((x) => k.includes(x.kind));
  const hand = (k: Change["kind"][]) => c.handEdits.filter((x) => k.includes(x.kind));
  const stale = pend(["part_added", "part_removed", "footprint"]);
  if (stale.length) add("error", "CIRCUIT_KICAD_STALE", `the model changed since lock and the KiCad layout does not have it yet: ${few(stale)}. Update the board in KiCad (add or remove the parts, swap the footprint), or unlock and regenerate`);
  if (ctx.shapeChanged) add("error", "CIRCUIT_KICAD_STALE", "the outline, mounting holes, layer count or thickness in circuit.config.ts changed since lock; change the board in KiCad to match, or unlock and regenerate");
  const conn = pend(["connection", "net_renamed"]);
  if (conn.length) add("warning", "CIRCUIT_KICAD_MODEL_CHANGED", `connections between existing parts changed in the model since lock, not yet in KiCad: ${few(conn)}`);
  const fields = pend(["field"]);
  if (fields.length) add("warning", "CIRCUIT_KICAD_FIELDS", `part fields changed in the model since lock: ${few(fields)}; update the symbols' fields in KiCad`);
  if (c.applied.length) add("info", "CIRCUIT_KICAD_APPLIED", `${c.applied.length} model change(s) since lock are already in KiCad (${few(c.applied, 3)}); record them with \`protoboard run circuit:lock --module ${ctx.board} --input refresh=true\``);
  const missing = hand(["part_removed"]);
  if (missing.length) add("error", "CIRCUIT_KICAD_PART_MISSING", `KiCad lacks part(s) the model has: ${few(missing)} (deleted in KiCad?)`);
  const extra = hand(["part_added"]);
  if (extra.length) add("warning", "CIRCUIT_KICAD_PART_EXTRA", `KiCad has part(s) the model does not: ${few(extra)}; a fiducial, test point or added part belongs in the UHD board module first`);
  const fp = hand(["footprint"]);
  if (fp.length) add("warning", "CIRCUIT_KICAD_FOOTPRINT_CHANGED", `footprint(s) changed in KiCad: ${few(fp)}; the land pattern of record is the provider's (footprints.json for a project override)`);
  const ren = hand(["net_renamed"]);
  if (ren.length) add("warning", "CIRCUIT_KICAD_NET_RENAMED", `net(s) renamed in KiCad: ${few(ren)}; the names of record are the UHD board's nets`);
  const moved = hand(["connection"]);
  if (moved.length) add("error", "CIRCUIT_KICAD_NET_CHANGED", `connections changed in KiCad that the model does not have: ${few(moved)}. Change the UHD board module if the change is wanted; nothing is written back`);
  const hf = hand(["field"]);
  if (hf.length) add("warning", "CIRCUIT_KICAD_FIELDS", `part fields edited in KiCad: ${few(hf)}; the values of record are the UHD parts'`);
  return out;
}
