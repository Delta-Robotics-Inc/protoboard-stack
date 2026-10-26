/**
 * What an export reads, recorded with it (PB-869), so a board's outputs can
 * be shown to follow from their inputs: the same inputs give the same
 * board.step and board.glb byte for byte, and when they differ check says
 * which input changed (CIRCUIT_STALE) instead of leaving a re-export to
 * surprise whoever reads the outputs next (an enclosure built around the
 * board, a release).
 *
 * `tscircuit/export.json`, written by every export:
 *
 *   circuit      the built board (circuit.json) the outputs are made from
 *   board        what the board depends on in UHD, not the whole module: its
 *                components (part, name, maker, MPN, value, package, pins, body
 *                artifacts and mount frames, interface ids the bodies are
 *                stripped of), its nets, its edge and the edge parts' mating
 *                frames, and its design envelope (outline, keep-outs). A part's
 *                description, price or documents are not in it, so editing them
 *                does not make out/ stale. Mounting holes and the outline given
 *                in circuit.config.ts are in `constraints`.
 *                Records before 0.1.7 hold `module` (a digest of every definition
 *                the module reaches) instead: check says once that the format
 *                changed and compares the rest, until the next export.
 *   constraints  the circuit.config.ts constraints (outline, keep-outs, fab keys)
 *   models       each component body file used, by label: a part's STEP, or a box size
 *   provider     this provider's export code
 *   converters   the versions of the converter libraries that write the files
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BoardNetlist } from "@protoboardai/core";
import type { ComponentBody } from "./models.ts";
import { digestOf, files } from "./native.ts";
import { packageVersion } from "./runtime.ts";

export const EXPORT_SCHEMA = "protoboard.tscircuit-export/v0";

export interface ExportInputs {
  circuit: string;
  /** Digest of the board projection (boardProjection). */
  board?: string;
  /** Records before 0.1.7: digest of the whole module and every definition it reaches. */
  module?: string;
  constraints: string;
  models: Record<string, string>;
  provider: string;
  converters: Record<string, string>;
}

export interface ExportRecord {
  schema: typeof EXPORT_SCHEMA;
  inputs: ExportInputs;
}

export const exportFile = (native: string) => `${native}/export.json`;

const CONVERTERS = ["circuit-json-to-gerber", "circuit-json-to-gltf", "circuit-json-to-step", "circuit-to-svg"];
const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");

let providerDigest: string | undefined;
/** Digest of the code an export runs: ops/circuit.ts and lib/ (not the check, which writes nothing). */
function providerCode(): string {
  if (providerDigest) return providerDigest;
  const lib = readdirSync(join(PACKAGE, "lib"))
    .filter((f) => /\.(ts|cjs)$/.test(f) && f !== "checks.ts" && f !== "probe.cjs")
    .sort()
    .map((f) => `lib/${f}`);
  const parts = ["ops/circuit.ts", ...lib].map((f) => `${f}\n${readFileSync(join(PACKAGE, f), "utf8")}`);
  providerDigest = digestOf(parts.join("\n\0"));
  return providerDigest;
}

/**
 * The part of the UHD board an export depends on (see `board` above): the board netlist (which
 * already leaves out descriptions, prices and documents), the mating frame each board export's part
 * states, and each part's interface ids (the feature shapes stripped from its body).
 */
export function boardProjection(netlist: BoardNetlist, edgeFrames: Record<string, unknown>, interfaces: Record<string, string[]>): unknown {
  const { problems: _problems, ...rest } = netlist;
  const parts = [...new Set(netlist.components.map((c) => c.part))].sort();
  return { ...rest, edgeFrames: Object.fromEntries(Object.entries(edgeFrames).sort(([a], [b]) => a.localeCompare(b))), interfaces: Object.fromEntries(parts.map((p) => [p, [...(interfaces[p] ?? [])].sort()])) };
}

export const boardDigest = (projection: unknown) => digestOf(stableJson(projection));

/** JSON with object keys sorted, so equal projections digest equally whatever order they were built in. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** The inputs an export of this board reads, now. */
export function exportInputs(root: string, native: string, boardDigest: string, constraints: Record<string, unknown>, bodies: ComponentBody[]): ExportInputs {
  const circuit = join(root, files(native).circuit);
  const models: Record<string, string> = {};
  for (const b of bodies) {
    if (b.source === "part" && b.step && b.label) models[b.label] = existsSync(b.step) ? digestOf(readFileSync(b.step)) : "missing";
    if (b.mesh) models[b.mesh.label] = existsSync(b.mesh.path) ? digestOf(readFileSync(b.mesh.path)) : "missing";
    if ((b.source === "box" || b.mesh) && b.box) models[b.box.path] = `box ${b.box.size.join(" x ")}`;
  }
  return {
    circuit: existsSync(circuit) ? digestOf(readFileSync(circuit)) : "missing",
    board: boardDigest,
    constraints: digestOf(JSON.stringify(constraints ?? {})),
    models: Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b))),
    provider: providerCode(),
    converters: Object.fromEntries(CONVERTERS.map((c) => [c, packageVersion(c)])),
  };
}

export function readExportRecord(root: string, native: string): ExportRecord | undefined {
  const f = join(root, exportFile(native));
  if (!existsSync(f)) return undefined;
  try {
    const r = JSON.parse(readFileSync(f, "utf8")) as ExportRecord;
    return r?.schema === EXPORT_SCHEMA && r.inputs ? r : undefined;
  } catch {
    return undefined;
  }
}

/** What differs between the inputs an export recorded and the inputs now, in words. */
export function exportDrift(was: ExportInputs, now: ExportInputs): string[] {
  const out: string[] = [];
  if (was.circuit !== now.circuit) out.push("the built board (circuit.json)");
  // a record before 0.1.7 fingerprinted the whole module: it cannot be compared with the board projection
  // (fingerprintFormatChanged says so), and is not reported as a change
  if (was.board !== undefined && was.board !== now.board) out.push("the UHD board (its parts, pins, nets, packages, bodies, edge or envelope)");
  if (was.constraints !== now.constraints) out.push("the circuit.config.ts constraints");
  for (const k of [...new Set([...Object.keys(was.models ?? {}), ...Object.keys(now.models ?? {})])].sort()) {
    const [a, b] = [was.models?.[k], now.models?.[k]];
    if (a === b) continue;
    out.push(a === undefined ? `a body now used: ${k}` : b === undefined ? `a body no longer used: ${k}` : `the body ${k}`);
  }
  if (was.provider !== now.provider) out.push("the provider's export code (@protoboardai/ext-tscircuit)");
  for (const c of [...new Set([...Object.keys(was.converters ?? {}), ...Object.keys(now.converters ?? {})])].sort()) {
    if (was.converters?.[c] !== now.converters?.[c]) out.push(`${c} ${was.converters?.[c] ?? "-"} → ${now.converters?.[c] ?? "-"}`);
  }
  return out;
}

/** Whether a record was written in the fingerprint format before 0.1.7 (the whole module, not the board projection). */
export const fingerprintFormatChanged = (was: ExportInputs) => was.board === undefined && was.module !== undefined;
