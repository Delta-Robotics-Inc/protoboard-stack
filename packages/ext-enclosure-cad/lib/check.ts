/**
 * cad:check for enclosures: the generated design against the model and
 * against what goes inside it. Pure: it reads the native design
 * (build123d/<id>.job.json and <id>.report.json) and the project, and may
 * run the fit analysis in Python (which writes nothing).
 *
 * Drift
 *   ENCLOSURE_NOT_GENERATED     no generated design yet (info)
 *   ENCLOSURE_FEATURE_INVALID   a feature interface the provider cannot read
 *   ENCLOSURE_INPUT             the model does not say enough to design it (a served part has no frame, …)
 *   ENCLOSURE_STALE             what goes inside, the features or the config changed since generate
 *   ENCLOSURE_NATIVE_EDITED     the native design was edited by hand (info: export builds from it)
 *   ENCLOSURE_GENERATOR_STALE   the design was built by another version of the generator (py/enclosure_cad.py or py/fit.py changed)
 *   ENCLOSURE_FEATURE_MISSING   an interface with no generated feature, or a generated feature with no interface
 *   ENCLOSURE_FRAME_MISMATCH    a declared frame differs from the generated one (re-bind after review)
 * Fit (Python, ext-harness-cad's voxel clearance field; exact cavity containment)
 *   ENCLOSURE_COLLISION         a body inside intersects a wall, boss or column; a plunger intersects a wall or a body inside
 *   ENCLOSURE_NOT_CONTAINED     a body reaches outside the cavity
 *   ENCLOSURE_CLEARANCE         a body (or a plunger) is closer to a wall (or a body) than the design clearance
 *   ENCLOSURE_FIT_UNCHECKED     the fit could not be analysed (no Python)
 * Features
 *   ENCLOSURE_THIN_WALL         wall below the minimum: exact per feature, or from the voxel field
 *   ENCLOSURE_MISALIGNED        an opening, window, light pipe or plunger off the axis of what it serves
 *   ENCLOSURE_RECESS            what an opening serves sits deeper than it may
 *   ENCLOSURE_PLUNGER           a plunger presses its switch at rest, cannot reach it, or its flange (trimmed to clear what is near it) no longer holds it in
 *   ENCLOSURE_PLUG_FIT          the plug a socket opening takes does not pass, or its overmold has no flat seat
 *   ENCLOSURE_SEAL_SQUEEZE      O-ring squeeze outside the range of the gland table for its cross-section
 *   ENCLOSURE_SEAL_FIT          O-ring stretched past 5 %, or the groove not sized to it
 *   ENCLOSURE_ENVELOPE          bigger than the module's design envelope
 *   ENCLOSURE_GENERATOR         a problem the generator reported
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeometryFrame, ModuleDef, Vec3 } from "@deltarobotics/uhd";
import type { Project, ProjectDiagnostic } from "@protoboardai/core";
import { readFeatures } from "./features.ts";
import { type BuiltJob, type Job } from "./job.ts";
import { pyJsonDumps } from "./pyjson.ts";
import { FACE_GROOVE_FIT, MAX_INSTALLED_STRETCH, glandRow } from "./standards.ts";

type Diagnostic = Omit<ProjectDiagnostic, "validator">;

export interface FitBody {
  key: string;
  label: string;
  min_clearance_mm?: number;
  at?: number[];
  near?: string;
  /** Which analysis found the worst point: exact (the cavity and the solids in it) or voxel (the parts as built, ±1 cell). */
  basis?: "exact" | "voxel";
  outside_cavity_mm?: number;
  outside_at?: number[];
  status: "clear" | "tight" | "collision" | "no_geometry";
}

export interface FitPlunger {
  key: string;
  feature: string;
  min_clearance_mm?: number;
  at?: number[];
  near?: string | null;
  /** Exact intersection with each wall part (mm³). */
  wall_overlap_mm3?: Record<string, number>;
  resolution_mm?: number;
  status: "clear" | "tight" | "collision";
}

export interface Fit {
  resolution_mm: number;
  bodies: FitBody[];
  plungers?: FitPlunger[];
  walls: Record<string, { min_mm: number; at: number[] }>;
}

export interface Report {
  schema: string;
  module: string;
  inputsDigest: string;
  sourceDigest: string;
  toolVersion: string;
  cavity: { shape: string; min: Vec3; max: Vec3; centre?: number[]; radius?: number };
  outer: { min: Vec3; max: Vec3 };
  overall: { min: Vec3; max: Vec3 };
  levels: Record<string, number>;
  parts: Record<string, { volume_mm3: number; printed: boolean }>;
  features: Record<string, Record<string, unknown> & { kind: string; frame?: GeometryFrame; parts: string[] }>;
  walls: { feature: string; what: string; mm: number; min_mm: number }[];
  /** Window covers (outside windows): each its own STEP, GLB and DXF outline, in its own frame. */
  covers?: Record<string, { part: string; shape: string; size_mm: number[]; thickness_mm: number; material?: string; volume_mm3: number; frame: GeometryFrame }>;
  problems: string[];
  fit: Fit;
}

/** Where a module's native design lives. */
export function nativePaths(native: string, id: string) {
  return { script: `${native}/${id}.py`, job: `${native}/${id}.job.json`, build: `${native}/build`, report: `${native}/${id}.report.json`, source: `${native}/${id}.source.json` };
}

export function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const len = (a: number[]) => Math.hypot(...a);
const unit = (a: number[]) => a.map((v) => v / (len(a) || 1));
const fmt = (v?: number[]) => (v ? `[${v.map((n) => Number(n.toFixed(2))).join(", ")}]` : "—");
const mm = (n: number) => `${Number(n.toFixed(2))} mm`;

/** Lateral offset of a point from an axis, and the angle between two directions. */
export function axisOffset(axis: GeometryFrame, point: GeometryFrame): { lateral: number; along: number; angleDeg: number } {
  const n = unit(axis.normal);
  const d = sub(point.origin, axis.origin);
  const along = dot(d, n);
  const lateral = len(sub(d, n.map((v) => v * along)));
  const c = Math.max(-1, Math.min(1, dot(n, unit(point.normal))));
  return { lateral, along, angleDeg: (Math.acos(c) * 180) / Math.PI };
}

/** Alignment tolerance between a feature's axis and the part it serves (assumption: printed-hole positional tolerance). */
export const ALIGN_MM = 0.3;
export const ALIGN_DEG = 2;

/** The generator's own files: the sourceDigest of a design covers them and the job it was built from. */
export const GENERATOR_FILES = ["enclosure_cad.py", "fit.py"].map((f) => fileURLToPath(new URL(`../py/${f}`, import.meta.url)));

/**
 * The sourceDigest the generator here would record for a job: sha256 over
 * py/enclosure_cad.py, py/fit.py and `json.dumps(job, sort_keys=True)`, as
 * enclosure_cad.py computes it.
 */
export function generatorSourceDigest(job: unknown, files: string[] = GENERATOR_FILES): string {
  const h = createHash("sha256");
  for (const f of files) h.update(readFileSync(f));
  return h.update(pyJsonDumps(job)).digest("hex");
}

/** What changed between the job the design was generated from and the current one. */
export function jobChanges(was: Job, now: Job): string[] {
  const out: string[] = [];
  const s = (x: unknown) => JSON.stringify(x);
  if (was.process !== now.process) out.push(`process ${was.process} → ${now.process}`);
  if (was.material !== now.material) out.push(`material ${was.material} → ${now.material}`);
  for (const k of Object.keys(now.design) as (keyof Job["design"])[]) if (s(was.design[k]) !== s(now.design[k])) out.push(`design ${k}`);
  const wc = new Map(was.contents.map((c) => [c.key, c]));
  const nc = new Map(now.contents.map((c) => [c.key, c]));
  for (const [k, c] of nc) {
    const w = wc.get(k);
    if (!w) out.push(`${k} added inside`);
    else if (w.digest !== c.digest) out.push(`${k} body changed`);
    else if (s(w.matrix) !== s(c.matrix)) out.push(`${k} moved`);
  }
  for (const k of wc.keys()) if (!nc.has(k)) out.push(`${k} no longer inside`);
  const wf = new Map(was.features.map((f) => [f.id, f]));
  for (const f of now.features) {
    const w = wf.get(f.id);
    if (!w) out.push(`feature ${f.id} added`);
    else if (s(w) !== s(f)) out.push(`feature ${f.id} changed${s(w.served) !== s(f.served) ? " (what it serves moved)" : ""}`);
  }
  for (const id of wf.keys()) if (!now.features.some((f) => f.id === id)) out.push(`feature ${id} removed`);
  return out;
}

export interface CheckInput {
  p: Project;
  def: ModuleDef;
  native: string;
  config: string;
  /** The job as the project stands now. */
  current: BuiltJob;
  /** Fit analysis of the current contents against the built parts (when the design is stale); undefined when it could not run. */
  refit?: () => Promise<Fit | { error: string }> | Fit | { error: string };
}

export async function checkEnclosure(c: CheckInput): Promise<Diagnostic[]> {
  const { p, def } = c;
  const out: Diagnostic[] = [];
  const paths = nativePaths(c.native, def.id);
  const src = p.definitions.get(def.id)?.origin.source ?? { file: c.config };
  const ent = (iface?: string) => (iface ? { kind: "interface" as const, id: `${def.id}:${iface}` } : { kind: "definition" as const, id: def.id });
  const push = (code: string, severity: Diagnostic["severity"], message: string, iface?: string, source = src) => out.push({ code, severity, entity: ent(iface), message, source });

  for (const x of readFeatures(def).problems) push("ENCLOSURE_FEATURE_INVALID", "error", `${def.id}.${x.interface}: ${x.message}`, x.interface);
  for (const x of c.current.input) push("ENCLOSURE_INPUT", "error", x);

  const report = readJson<Report>(join(p.root, paths.report));
  const recorded = readJson<Job>(join(p.root, paths.job));
  if (!report || !recorded) {
    push("ENCLOSURE_NOT_GENERATED", "info", `${def.id} has no generated design (${paths.report}); run \`protoboard run cad:generate --module ${def.id}\``, undefined, { file: c.config });
    return out;
  }
  const rsrc = { file: paths.report };

  // ---- drift: inputs, native edits, features and frames
  const now = c.current.job;
  const changes = now ? jobChanges(recorded, now) : [];
  const stale = !!now && (changes.length > 0 || now.inputsDigest !== recorded.inputsDigest || recorded.inputsDigest !== report.inputsDigest);
  if (now && stale) {
    push("ENCLOSURE_STALE", "warning", `${def.id}: the design was generated from different inputs (${changes.join("; ") || "inputs changed"}) — the model or the assembly changed, or ${paths.job} was edited by hand; review, then \`protoboard run cad:generate --module ${def.id}\``);
  }
  const source = readJson<{ script: string; job: string }>(join(p.root, paths.source));
  const onDisk = (f: string) => (existsSync(join(p.root, f)) ? "sha256:" + createHash("sha256").update(readFileSync(join(p.root, f))).digest("hex") : undefined);
  if (source && (source.script !== onDisk(paths.script) || source.job !== onDisk(paths.job))) {
    push("ENCLOSURE_NATIVE_EDITED", "info", `the native design in ${c.native}/ was edited after its last build; \`protoboard run cad:export\` rebuilds from it`, undefined, { file: source.job !== onDisk(paths.job) ? paths.job : paths.script });
  }
  // the generator itself: a design built from this job by today's generator records another digest (PB-809).
  // Only when the job is the one it was built from: a hand-edited job is ENCLOSURE_NATIVE_EDITED above.
  const jobEdited = !!source && source.job !== onDisk(paths.job);
  if (!jobEdited && report.sourceDigest && generatorSourceDigest(recorded) !== report.sourceDigest) {
    push(
      "ENCLOSURE_GENERATOR_STALE",
      "warning",
      `${def.id}: the design was built by another version of the generator (@protoboardai/ext-enclosure-cad py/enclosure_cad.py or py/fit.py changed since ${paths.report} was written); run \`protoboard run cad:generate --module ${def.id}\` and \`cad:export\`, then review the diff`,
      undefined,
      rsrc,
    );
  }
  const generated = report.features;
  for (const f of readFeatures(def).features) {
    const g = generated[f.id];
    if (!g || !g.parts?.length) {
      push("ENCLOSURE_FEATURE_MISSING", "error", `${def.id}.${f.id} (${f.kind}) has no generated feature${g ? " (it produced no faces)" : ""}; regenerate`, f.id);
      continue;
    }
    if (f.frame && g.frame) {
      const d = [
        len(sub(f.frame.origin, g.frame.origin)) > 0.01 && `origin ${fmt(f.frame.origin)} vs generated ${fmt(g.frame.origin)}`,
        len(sub(unit(f.frame.normal), unit(g.frame.normal))) > 1e-3 && `normal ${fmt(f.frame.normal)} vs generated ${fmt(g.frame.normal)}`,
      ].filter(Boolean);
      if (d.length) push("ENCLOSURE_FRAME_MISMATCH", "error", `${f.id}: ${d.join("; ")} — the model and the enclosure disagree; review, then re-bind the frame`, f.id);
    }
  }
  for (const id of Object.keys(generated)) {
    if (!def.interfaces.some((i) => i.id === id)) push("ENCLOSURE_FEATURE_MISSING", "error", `the generated design has feature ${id}, which ${def.id} does not have (renamed or removed? regenerate)`, undefined, rsrc);
  }
  for (const m of report.problems) {
    const id = m.split(":")[0];
    push("ENCLOSURE_GENERATOR", "error", `${def.id}: ${m}`, def.interfaces.some((i) => i.id === id) ? id : undefined, rsrc);
  }

  // ---- walls (exact, per feature)
  for (const w of report.walls) {
    if (w.mm < w.min_mm - 1e-6) push("ENCLOSURE_THIN_WALL", "error", `${w.feature}: ${w.what} is ${mm(w.mm)}, below the ${mm(w.min_mm)} minimum`, def.interfaces.some((i) => i.id === w.feature) ? w.feature : undefined);
  }

  // ---- fit: recorded at generation, or re-analysed against what is inside now
  let fit: Fit | undefined = report.fit;
  let fitNote = "";
  if (stale && c.refit) {
    const r = await c.refit();
    if ("error" in r) {
      push("ENCLOSURE_FIT_UNCHECKED", "warning", `${def.id}: what goes inside changed and the fit could not be re-analysed (${r.error}); the results below are from generation`);
      fitNote = " (at generation)";
    } else {
      fit = r;
      fitNote = " (re-analysed against the current contents)";
    }
  }
  const res = fit.resolution_mm;
  const basis = (b: { basis?: string }, r = res) => (b.basis === "exact" ? "exact" : `±${r} mm voxels`);
  for (const b of fit.bodies) {
    if ((b.outside_cavity_mm ?? 0) > 1e-3) {
      push("ENCLOSURE_NOT_CONTAINED", "error", `${b.key} (${b.label}) reaches ${mm(b.outside_cavity_mm!)} outside the cavity at ${fmt(b.outside_at)}${fitNote}`);
    }
    if (b.status === "collision" && (b.min_clearance_mm ?? 0) < 0) {
      push("ENCLOSURE_COLLISION", "error", `${b.key} (${b.label}) intersects the ${b.near} by ${mm(-(b.min_clearance_mm ?? 0))} at ${fmt(b.at)}${fitNote} (${basis(b)})`);
    } else if (b.status === "tight") {
      push("ENCLOSURE_CLEARANCE", "warning", `${b.key} (${b.label}) is ${mm(b.min_clearance_mm ?? 0)} from the ${b.near} at ${fmt(b.at)}, under the ${mm(recorded.design.clearance)} design clearance${fitNote} (${basis(b)})`);
    }
  }
  // plungers: against the walls exactly (at generation: the walls are what was built), against what is inside now
  const wallOverlap = new Map((report.fit.plungers ?? []).map((x) => [x.key, x.wall_overlap_mm3 ?? {}]));
  for (const x of fit.plungers ?? []) {
    for (const [part, v] of Object.entries(wallOverlap.get(x.key) ?? {})) {
      if (v > 1e-3) push("ENCLOSURE_COLLISION", "error", `${x.key} intersects the ${part} (${Number(v.toFixed(3))} mm³, exact): it cannot be assembled`, x.feature);
    }
    const r = x.resolution_mm ?? res;
    if (x.status === "collision" && (x.min_clearance_mm ?? 0) < 0) push("ENCLOSURE_COLLISION", "error", `${x.key} intersects ${x.near} by ${mm(-(x.min_clearance_mm ?? 0))} at ${fmt(x.at)}${fitNote} (±${r} mm voxels)`, x.feature);
    else if (x.status === "tight" && x.near) push("ENCLOSURE_CLEARANCE", "warning", `${x.key} is ${mm(x.min_clearance_mm ?? 0)} from ${x.near} at ${fmt(x.at)}, under the ${mm(recorded.design.clearance)} design clearance${fitNote} (±${r} mm voxels)`, x.feature);
  }
  for (const [part, w] of Object.entries(fit.walls ?? {})) {
    if (w.min_mm < recorded.design.min_wall - res) push("ENCLOSURE_THIN_WALL", "warning", `${part}: a wall about ${mm(w.min_mm)} thick at ${fmt(w.at)}, below the ${mm(recorded.design.min_wall)} minimum (voxel estimate, ±${res} mm)`, undefined, rsrc);
  }

  // ---- features against what they serve, now
  const servedNow = new Map((now ?? recorded).features.map((f) => [f.id, f.served]));
  for (const [id, g] of Object.entries(generated)) {
    const served = servedNow.get(id);
    const spec = recorded.features.find((f) => f.id === id);
    if (served && g.frame && ["opening", "window", "light_pipe", "button"].includes(g.kind)) {
      const a = axisOffset(g.frame, served.frame);
      if (a.lateral > ALIGN_MM || a.angleDeg > ALIGN_DEG) {
        push("ENCLOSURE_MISALIGNED", "error", `${id} is ${mm(a.lateral)} / ${a.angleDeg.toFixed(1)}° off the axis of ${served.label} (allowed ${ALIGN_MM} mm / ${ALIGN_DEG}°)`, id);
      }
      const recess = -a.along;
      const max = spec?.params.max_recess_mm as number | undefined;
      if (g.kind === "opening" && max !== undefined && recess > max + 1e-6) push("ENCLOSURE_RECESS", "error", `${served.label} sits ${mm(recess)} behind the outer surface of ${id}; at most ${mm(max)} is allowed`, id);
      if (g.kind === "button") {
        const tip = g.tip as number[];
        const gap = dot(sub(tip, served.frame.origin), unit(g.frame.normal));
        const travel = (g.travel_mm as number | undefined) ?? 0;
        const reach = (spec?.params.protrude_mm as number | undefined) ?? 1.0;
        if (gap < -1e-3) push("ENCLOSURE_PLUNGER", "error", `${id}: the plunger presses ${served.label} by ${mm(-gap)} at rest`, id);
        else if (gap + travel > reach + 1e-6) push("ENCLOSURE_PLUNGER", "error", `${id}: ${mm(gap)} gap + ${mm(travel)} travel is more than the ${mm(reach)} the plunger stands out; it cannot press ${served.label}`, id);
      }
    }
    if (g.kind === "button" && g.flange_hold_pct !== undefined) {
      const rule = g.flange_hold_rule as { overlap_mm: number; pct: number };
      const held = g.flange_hold_pct as number;
      const by = (g.flange_trimmed_by as string[] | undefined) ?? [];
      if (held < rule.pct - 1e-6) {
        push("ENCLOSURE_PLUNGER", "error", `${id}: ${by.length ? `trimmed to clear ${by.join(", ")}, ` : ""}the plunger's flange overlaps the wall by ${mm(rule.overlap_mm)} over only ${held.toFixed(0)} % of its edge (it needs ${rule.pct} % to stay in); move the switch away from what is near it, or retain the plunger another way`, id);
      }
    }
    if (g.kind === "opening" && g.plug) {
      const pf = g.plug as { name?: string; passes: boolean; plug_mm: number[]; overmold_mm?: number[]; seat_mm?: number; seat_gap_mm?: number; edge_overhang_mm?: number; seat?: { proud_mm: number } };
      const name = pf.name ?? "the plug";
      const size = g.size_mm as number[];
      if (!pf.passes) push("ENCLOSURE_PLUG_FIT", "error", `${id}: ${name} (${pf.plug_mm.join(" × ")} mm) does not pass through the ${size.join(" × ")} mm opening`, id);
      if (pf.seat_mm !== undefined && pf.seat_mm < -1e-6) push("ENCLOSURE_PLUG_FIT", "warning", `${id}: the overmold of ${name} (${pf.overmold_mm?.join(" × ")} mm) overhangs the flat face around the opening by ${mm(-pf.seat_mm)}; it will not seat against the wall`, id);
      if (pf.seat_gap_mm !== undefined && pf.seat_gap_mm > ALIGN_MM) push("ENCLOSURE_PLUG_FIT", "warning", `${id}: the curved wall leaves ${mm(pf.seat_gap_mm)} under the ends of the overmold of ${name}; flatten a seat for it (Opening seat: "flat")`, id);
      if (pf.edge_overhang_mm !== undefined && pf.edge_overhang_mm > ALIGN_MM) push("ENCLOSURE_PLUG_FIT", "info", `${id}: the overmold of ${name} reaches ${mm(pf.edge_overhang_mm)} past the case's front or back face; it seats on the face and overhangs the edge`, id);
    }
    if (g.kind === "seal_gland" && spec) {
      // against the cited table for this cross-section, not the copy in the job (which a hand edit moves with the groove)
      const w = g.w_mm as number;
      const table = glandRow(g.type as "face" | "radial", w);
      const depth = (g.gland_depth_mm as number) + (g.gap_mm as number);
      const off = (g.rod_offset_mm as number | undefined) ?? 0;
      const squeezes = [depth - off, depth + off].map((d) => ((w - d) / w) * 100);
      const [lo, hi] = [Math.min(...squeezes), Math.max(...squeezes)];
      const basisNote = g.gap_basis ? `; ${g.gap_basis}` : "";
      const range = off > 0 ? `${lo.toFixed(1)}–${hi.toFixed(1)} %` : `${lo.toFixed(1)} %`;
      // a printed bore drawn oversize: if it prints at its drawn size the gland is deeper and the collar freer
      const allow = (g.bore_allowance_mm as number | undefined) ?? 0;
      if (table && allow > 0) {
        const s = [depth + allow - off - allow, depth + allow + off + allow].map((d) => ((w - d) / w) * 100);
        push("ENCLOSURE_SEAL_SQUEEZE", "info", `${id}: the skirt's bore is drawn ${mm(allow)} (radial) over the Ø${g.printed_bore_d_mm} it should print at; if it prints at its drawn Ø${g.bore_d_mm}, ${g.oring} is squeezed ${Math.min(...s).toFixed(1)}–${Math.max(...s).toFixed(1)} % (${table.squeeze_pct[0]}–${table.squeeze_pct[1]} % wanted): measure the printed bore on the first print`, id);
      }
      if (!table) push("ENCLOSURE_SEAL_SQUEEZE", "error", `${id}: no ${g.type} gland row for a ${w} mm cross-section, so the squeeze cannot be checked`, id);
      else if (lo < table.squeeze_pct[0] - 0.05 || hi > table.squeeze_pct[1] + 0.05) {
        push("ENCLOSURE_SEAL_SQUEEZE", "error", `${id}: ${g.oring} squeezed ${range}, outside ${table.squeeze_pct[0]}–${table.squeeze_pct[1]} % (${table.source})${basisNote}`, id);
      }
      if (g.type === "face") {
        const ext = g.pressure !== "internal";
        const ratio = ext ? (g.groove_inner_perimeter_mm as number) / (g.oring_inner_perimeter_mm as number) - 1 : 1 - (g.groove_outer_perimeter_mm as number) / (g.oring_outer_perimeter_mm as number);
        const pct = ratio * 100;
        if (ext && pct > MAX_INSTALLED_STRETCH.pct) push("ENCLOSURE_SEAL_FIT", "error", `${id}: the groove stretches ${g.oring} ${pct.toFixed(1)} % (more than ${MAX_INSTALLED_STRETCH.pct} %, ${MAX_INSTALLED_STRETCH.source}); choose a larger O-ring or a smaller groove`, id);
        else if (pct < -1e-6 || pct > FACE_GROOVE_FIT.pct + 1e-6) {
          push("ENCLOSURE_SEAL_FIT", "warning", `${id}: the groove's ${ext ? "inside" : "outside"} perimeter is ${pct >= 0 ? "+" : ""}${pct.toFixed(1)} % from ${g.oring}'s ${ext ? "I.D." : "O.D."} (${FACE_GROOVE_FIT.source}: within ${ext ? "+" : "−"}${FACE_GROOVE_FIT.pct} % for ${ext ? "external" : "internal"} pressure)`, id);
        }
      } else {
        const o = spec.params.oring as { id_mm: number };
        // a rod seal sits on its rod; a twist lid's collar seal on its groove's bottom
        const seat = (g.seat_d_mm as number | undefined) ?? (g.rod_d_mm as number);
        const what = g.seat_d_mm !== undefined ? "the collar's groove" : "the rod";
        const stretch = (seat / o.id_mm - 1) * 100;
        if (stretch > MAX_INSTALLED_STRETCH.pct) push("ENCLOSURE_SEAL_FIT", "error", `${id}: ${what} stretches ${g.oring} ${stretch.toFixed(1)} % (more than ${MAX_INSTALLED_STRETCH.pct} %, ${MAX_INSTALLED_STRETCH.source})`, id);
        else if (g.seat_d_mm !== undefined && stretch < -1e-6) push("ENCLOSURE_SEAL_FIT", "error", `${id}: ${what} (Ø${seat}) is smaller than ${g.oring}'s I.D. (${o.id_mm} mm): the O-ring would sit loose in its groove; choose a smaller O-ring`, id);
      }
    }
  }

  // ---- envelope
  const env = def.traits?.find((t) => t.type === "design_envelope")?.params?.max_mm as { length?: number; width?: number; height?: number } | undefined;
  if (env && report.overall) {
    const size = sub(report.overall.max, report.overall.min);
    const over = [env.length !== undefined && size[0] > env.length + 1e-6 && `length ${mm(size[0])} > ${mm(env.length)}`, env.width !== undefined && size[1] > env.width + 1e-6 && `width ${mm(size[1])} > ${mm(env.width)}`, env.height !== undefined && size[2] > env.height + 1e-6 && `height ${mm(size[2])} > ${mm(env.height)}`].filter(Boolean);
    if (over.length) push("ENCLOSURE_ENVELOPE", "error", `${def.id} is bigger than its design envelope: ${over.join(", ")}`);
  }
  return out;
}
