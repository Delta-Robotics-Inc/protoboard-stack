/**
 * check: protoboard/model-orientation (PB_MODEL_ORIENTATION, warning). Wave R2, I2 of the 2026-11-01 walkthrough
 * (2:51 to 3:47, frame 182-1; Kevin: "the pins point up and not through the board; Protoboard should flag this").
 *
 * For every component drawn inside a board's body (a board's part: an instance whose model is a node of its holder's
 * view sidecar, as model-size.ts reads it), compare the model's bounds along the board normal with the board slab
 * (the holder's remainder node "."; glTF Y is the normal, model-size.ts `boardSlab`):
 *
 *   - the side it is mounted on is the side most of the model is on (DEFAULT: neither the sidecar nor UHD records a
 *     component's side, so it is inferred; a part mounted on the bottom, such as ClientX's 12V_DCJ, is then not
 *     taken for an upside-down top part);
 *   - "through": the model passes the opposite face by more than THROUGH_MAX_MM (DEFAULT 4 mm). A through-hole
 *     part's tails pass it by less (ClientX's headers: 1.3 to 1.8 mm), so an honest through-hole part is not
 *     flagged; long pins or a body poking out of the far side are;
 *   - "sunk": the model's centre sits more than SUNK_SHARE (DEFAULT 0.4) of its own height from its mounting face
 *     toward the far side (most of the body inside or behind the board).
 *
 * Either is reported as "Model may be upside down" with the part and the numbers. Silent for placeholders, for a
 * holder without a board slab (not a board), and before a build wrote the sidecar (model-size.ts's rules).
 *
 * Limits: the bounds are axis-aligned boxes. A model turned upside down as a whole on the inferred side reads as a
 * part mounted on the other side; pins pointing the wrong way inside an otherwise upright box are not seen (the
 * sidecar index carries no per-pin geometry).
 *
 * Units: the sidecar index is glTF metres, Y-up (the board normal); the numbers in the message are mm along that
 * normal, converted at the boundary here (x 1000). The sign of the axis is kept: +Y is the board's top face.
 */
import { modelTable, projectHas3d } from "./part-files.js";
import { MAX_VIEW_INDEX_BYTES, boardSlab, glbOf, readIndex, unionBounds } from "./model-size.js";
import type { Project } from "./project.js";
import type { ProjectDiagnostic, Severity } from "./types.js";
import type { ViewBounds, ViewSidecarIndex } from "./view-model/types.js";

export const MODEL_ORIENTATION_VALIDATOR = "protoboard/model-orientation";
export const MODEL_ORIENTATION_CODE = "PB_MODEL_ORIENTATION";

/** DEFAULT (R2-D brief): a model whose centre is more than this share of its height past its mounting face is flagged. */
export const SUNK_SHARE = 0.4;
/** DEFAULT (R2-D brief): a through-hole part's tails pass the far face by less than this (mm); more is flagged. */
export const THROUGH_MAX_MM = 4;

export interface OrientationOptions {
  sunkShare?: number;
  throughMaxMm?: number;
  maxIndexBytes?: number;
}

/** A model measured against its board, mm along the board normal (glTF Y x 1000). */
export interface Orientation {
  side: "top" | "bottom";
  /** The model's extent beyond the board's top face, and beyond its bottom face (0 when it does not pass it). */
  above: number;
  below: number;
  /** How far it passes the face opposite its mounting side. */
  far: number;
  /** Centre past the mounting face toward the far side, as a share of the model's height (negative: outward). */
  sunk: number;
  height: number;
  through: boolean;
  sunken: boolean;
  /** The model and the board along the normal, mm. */
  model: [number, number];
  board: [number, number];
}

/** Measure a model's bounds (glTF metres, Y-up) against a board slab (glTF Y, metres). */
export function orientationOf(model: ViewBounds, slab: { bottom: number; top: number }, options: OrientationOptions = {}): Orientation | undefined {
  const sunkShare = options.sunkShare ?? SUNK_SHARE;
  const throughMax = options.throughMaxMm ?? THROUGH_MAX_MM;
  // glTF metres to mm at the boundary; Y is the board normal
  const lo = model.min[1] * 1000;
  const hi = model.max[1] * 1000;
  const top = slab.top * 1000;
  const bottom = slab.bottom * 1000;
  const height = hi - lo;
  if (!(height > 0) || !Number.isFinite(height)) return undefined;
  const above = Math.max(0, hi - top);
  const below = Math.max(0, bottom - lo);
  const side = above >= below ? "top" : "bottom";
  const far = side === "top" ? below : above;
  const centre = (hi + lo) / 2;
  const sunk = (side === "top" ? top - centre : centre - bottom) / height;
  return { side, above, below, far, sunk, height, through: far > throughMax, sunken: sunk > sunkShare, model: [lo, hi], board: [bottom, top] };
}

const mm = (v: number) => `${+v.toFixed(2)}`;

/** The finding's message: the part, which face, the numbers, and where to fix it. */
export function orientationMessage(instance: string, part: string, o: Orientation, drawnBy: string, options: OrientationOptions = {}): string {
  const throughMax = options.throughMaxMm ?? THROUGH_MAX_MM;
  const sunkShare = options.sunkShare ?? SUNK_SHARE;
  const farFace = o.side === "top" ? "bottom" : "top";
  const what = o.through
    ? `the 3D model passes ${mm(o.far)} mm through the board's ${farFace} face (a through-hole part's tails pass it by less than ${throughMax} mm)`
    : `the 3D model sits ${Math.round(o.sunk * 100)}% of its height inside the board, past its ${o.side} face (more than ${Math.round(sunkShare * 100)}% is reported)`;
  const also = o.through && o.sunken ? `; it also sits ${Math.round(o.sunk * 100)}% of its height past its ${o.side} face` : "";
  const numbers = `Along the board normal the model spans ${mm(o.model[0])} to ${mm(o.model[1])} mm (${mm(o.height)} mm) and the board ${mm(o.board[0])} to ${mm(o.board[1])} mm: ${mm(o.above)} mm above the top face, ${mm(o.below)} mm below the bottom face; taken as mounted on the ${o.side} side, where most of it is.`;
  return `${instance} (${part}): ${what}${also}; the model may be upside down or mirrored. ${numbers} It is drawn inside ${drawnBy}'s body: check the part's rotation in that body's 3D export, then build again.`;
}

/** PB_MODEL_ORIENTATION findings for every board part with a placed model; `measured` counts the parts compared. */
export function modelOrientationDiagnostics(p: Project, options: OrientationOptions = {}): { diagnostics: ProjectDiagnostic[]; ran: boolean; reason?: string; measured: number } {
  if (!projectHas3d(p)) return { diagnostics: [], ran: false, reason: "no body models in the project", measured: 0 };
  const cap = options.maxIndexBytes ?? MAX_VIEW_INDEX_BYTES;
  const table = modelTable(p);
  const own = new Map(table.instances.filter((e) => !e.drawnBy).map((e) => [e.instance, e]));
  const cache = new Map<string, ViewSidecarIndex | undefined>();
  const out: ProjectDiagnostic[] = [];
  let measured = 0;
  for (const e of table.instances) {
    if (e.drawnBy === undefined) continue;
    const holder = own.get(e.drawnBy);
    const g = holder && !holder.placeholder ? glbOf(p, holder) : undefined;
    const idx = g ? readIndex(g, holder!.sha256, cap, cache) : undefined;
    if (!idx) continue;
    const slab = boardSlab(idx);
    if (!slab) continue;
    const rel = e.instance.slice(e.drawnBy.length + 1);
    const nodes = idx.nodes.filter((n) => n.instancePath === rel);
    if (!nodes.length || nodes.some((n) => n.placeholder)) continue;
    const bounds = unionBounds(nodes.map((n) => n.bounds));
    const o = bounds ? orientationOf(bounds, slab, options) : undefined;
    if (!o) continue;
    measured++;
    if (!o.through && !o.sunken) continue;
    out.push({
      code: MODEL_ORIENTATION_CODE,
      severity: "warning",
      entity: { kind: "instance", id: e.instance },
      message: orientationMessage(e.instance, e.part, o, e.drawnBy, options),
      source: p.definitions.get(e.part)?.origin.source,
      validator: MODEL_ORIENTATION_VALIDATOR,
    });
  }
  return { diagnostics: out, ran: true, measured };
}

/** Run the check on a loaded project (project.ts calls it after the model-size check). */
export function runModelOrientationCheck(p: Project): void {
  const zero: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  let r: ReturnType<typeof modelOrientationDiagnostics>;
  try {
    r = modelOrientationDiagnostics(p);
  } catch (e) {
    p.checks.push({ validator: MODEL_ORIENTATION_VALIDATOR, status: "skipped", reason: (e as Error).message, counts: zero });
    return;
  }
  p.diagnostics.push(...r.diagnostics);
  p.checks.push({
    validator: MODEL_ORIENTATION_VALIDATOR,
    status: r.ran ? "ran" : "skipped",
    ...(r.reason ? { reason: r.reason } : r.ran ? { subject: `${r.measured} board part(s) measured` } : {}),
    counts: { ...zero, warning: r.diagnostics.length },
  });
}
