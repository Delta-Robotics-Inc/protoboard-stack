/**
 * check: protoboard/model-size (PB_MODEL_SIZE_MISMATCH, warning).
 *
 * For every drawn instance whose part states a package body size (UHD
 * `partPackage(def).size_mm`: length, width, height in mm, the size the
 * Inspector's Package section shows) and whose 3D model has been placed by a
 * build (a view sidecar index `X.view.json` beside the body GLB `X.glb`),
 * compare the model's extent with the package body. A model more than
 * MODEL_SIZE_RATIO times larger or smaller on any compared side is reported:
 * the classic case is a vendor model exported in the wrong unit or scale
 * (ClientX's USB-C receptacle drawn about 5 times too big, walkthrough
 * 2026-11-01).
 *
 * Where the model comes from (the one resolver's model table, part-files.ts):
 *   - a board's component (an instance drawn inside its holder's body): the
 *     holder's sidecar node(s) whose instancePath is the component's path
 *     below the holder;
 *   - a part with its own body: the union of every node of that body's sidecar
 *     (the owner's remainder "." plus any named feature or body nodes).
 *
 * Silent when there is nothing honest to compare: no package size (all three
 * sides), a placeholder (the resolver's amber box or a declared stand-in), no
 * sidecar yet (no build), a sidecar that describes another version of the GLB
 * (its source sha256 differs), or a sidecar over the size cap.
 *
 * Axis matching (DEFAULT, revisit):
 *   - a board's component, when the holder's own remainder "." is a slab whose
 *     thinnest side is glTF Y (the board normal): the two sides on the board
 *     are compared sorted (a part turned 90 degrees on the board swaps them),
 *     and the height is compared along the normal. The height passes when
 *     either the full extent (tails and shell legs through and under the board
 *     included, as UHD's `dimensions_mm` asks for leads) or the extent on the
 *     mounting side alone (above the board's top for a top-side part) is
 *     within the ratio: a through-hole leg or a header tail cannot fail an
 *     honest model, and a model that is too big above the board still does.
 *   - anything else: the three sides sorted, longest with longest.
 *   - a part turned by an angle that is not a multiple of 90 degrees has a
 *     larger axis-aligned box: up to 1.41 times for a square part (under the
 *     ratio), more for a long thin one, which may then be reported. The
 *     sidecar index does not carry the node's rotation.
 *
 * Units: the sidecar index is in the GLB's own frame, glTF metres and Y-up;
 * UHD is mm and Z-up. The extents are converted at the boundary here
 * (`toUhdMm`): x stays x, glTF -Z is UHD +Y, glTF +Y is UHD +Z, metres times
 * 1000. Only extents are compared, so the sign of an axis does not matter.
 *
 * Security: index paths are derived from the resolver's file (never from the
 * index), must stay inside the project (or the part's package folder) once
 * links are followed, and are read with a size cap.
 */
import { dirname, join } from "node:path";
import { partPackage, type ModuleDef } from "@deltarobotics/uhd";
import { artifactBaseDir } from "./load.js";
import { modelTable, projectHas3d, readJsonCapped, type ModelTableEntry } from "./part-files.js";
import { isInsideReal } from "./paths.js";
import type { Project } from "./project.js";
import type { ProjectDiagnostic, Severity } from "./types.js";
import { viewSidecarPaths } from "./view-model/names.js";
import type { ViewBounds, ViewNode, ViewSidecarIndex } from "./view-model/types.js";

export const MODEL_SIZE_VALIDATOR = "protoboard/model-size";
export const MODEL_SIZE_CODE = "PB_MODEL_SIZE_MISMATCH";

/** DEFAULT (revisit): a side more than this many times larger, or smaller, than the package body is reported. */
export const MODEL_SIZE_RATIO = 1.5;

/** DEFAULT (revisit): view sidecar indexes over this size are not read (ClientX's board index, 197 nodes, is 0.8 MB). */
export const MAX_VIEW_INDEX_BYTES = 64 * 1024 * 1024;

export interface ModelSizeOptions {
  ratio?: number;
  maxIndexBytes?: number;
}

/** One compared side: its name, the model's and the package's size in mm, and model / package. */
export interface SideComparison {
  side: string;
  model: number;
  pkg: number;
  ratio: number;
}

export interface SizeComparison {
  sides: SideComparison[];
  /** Model's longest compared side over the package's longest side. */
  longest: number;
  /** The sides beyond the ratio. */
  off: SideComparison[];
  /** Every side beyond the ratio in the same direction: a uniform scale error. */
  uniform: boolean;
  /** "board" when the board frame was used, "sorted" when the three sides were sorted. */
  frame: "board" | "sorted";
}

type Vec3 = [number, number, number];

/** Union of axis-aligned bounds in the GLB's frame (glTF metres, Y-up); undefined when one is malformed. */
export function unionBounds(bounds: ViewBounds[]): ViewBounds | undefined {
  if (!bounds.length) return undefined;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of bounds) {
    if (!Array.isArray(b?.min) || !Array.isArray(b?.max) || b.min.length !== 3 || b.max.length !== 3) return undefined;
    for (let i = 0; i < 3; i++) {
      const lo = b.min[i];
      const hi = b.max[i];
      if (typeof lo !== "number" || typeof hi !== "number" || !Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return undefined;
      min[i] = Math.min(min[i], lo);
      max[i] = Math.max(max[i], hi);
    }
  }
  return { min, max };
}

/**
 * Extents of glTF bounds (metres, Y-up) as UHD mm, Z-up: [x, y, z] = [gx, gz, gy] * 1000.
 * The unit and axis conversion happens here, at the boundary, and nowhere else in this check.
 */
export function toUhdMm(b: ViewBounds): Vec3 {
  return [(b.max[0] - b.min[0]) * 1000, (b.max[2] - b.min[2]) * 1000, (b.max[1] - b.min[1]) * 1000];
}

/**
 * Thicker than this (mm), the remainder node "." is not the bare board: it also holds components the export did
 * not map to parts (a tall capacitor), and its top is no board face to measure a part's height from (gate R1,
 * DEFAULT: 3.5 mm, a 3.2 mm board, the thickest common one, plus its layers and some slack).
 */
export const MAX_SLAB_MM = 3.5;

/** The board slab of a holder, from its remainder node ".": glTF Y extent [bottom, top], when Y is its thinnest side and the node is board-thin. */
export function boardSlab(index: ViewSidecarIndex): { bottom: number; top: number } | undefined {
  const own = unionBounds(index.nodes.filter((n) => n.id === ".").map((n) => n.bounds));
  if (!own) return undefined;
  const [x, y, z] = [own.max[0] - own.min[0], own.max[1] - own.min[1], own.max[2] - own.min[2]];
  if (!(y > 0) || y >= x || y >= z || y * 1000 > MAX_SLAB_MM) return undefined;
  return { bottom: own.min[1], top: own.max[1] };
}

const logOff = (r: number) => Math.abs(Math.log(r));
const sortDesc = (v: number[]) => [...v].sort((a, b) => b - a);

/**
 * Compare a model's bounds (glTF metres, Y-up) with a package body (mm: length, width, height).
 * With `slab` (the holder's board, glTF Y), the model is a component on that board.
 */
export function compareSize(model: ViewBounds, pkg: { length: number; width: number; height: number }, slab?: { bottom: number; top: number }, ratio = MODEL_SIZE_RATIO): SizeComparison {
  const ext = toUhdMm(model);
  let sides: SideComparison[];
  let frame: SizeComparison["frame"];
  if (slab) {
    frame = "board";
    const [ma, mb] = sortDesc([ext[0], ext[1]]);
    const [pa, pb] = sortDesc([pkg.length, pkg.width]);
    // height along the board normal (glTF Y; UHD Z after toUhdMm): the full extent, or the mounting side's alone
    const full = ext[2];
    const above = Math.max(0, model.max[1] - Math.max(model.min[1], slab.top)) * 1000;
    const below = Math.max(0, Math.min(model.max[1], slab.bottom) - model.min[1]) * 1000;
    const side = Math.max(above, below);
    const candidates = [full, side].filter((h) => h > 0);
    const height = candidates.sort((a, b) => logOff(a / pkg.height) - logOff(b / pkg.height))[0] ?? full;
    sides = [
      { side: "longer side on the board", model: ma, pkg: pa, ratio: ma / pa },
      { side: "shorter side on the board", model: mb, pkg: pb, ratio: mb / pb },
      { side: "height", model: height, pkg: pkg.height, ratio: height / pkg.height },
    ];
  } else {
    frame = "sorted";
    const m = sortDesc(ext);
    const p = sortDesc([pkg.length, pkg.width, pkg.height]);
    const names = ["longest side", "middle side", "shortest side"];
    sides = m.map((v, i) => ({ side: names[i], model: v, pkg: p[i], ratio: v / p[i] }));
  }
  const off = sides.filter((s) => !(s.ratio <= ratio && s.ratio >= 1 / ratio));
  const uniform = off.length === sides.length && (off.every((s) => s.ratio > 1) || off.every((s) => s.ratio < 1));
  const longest = Math.max(...sides.map((s) => s.model)) / Math.max(pkg.length, pkg.width, pkg.height);
  return { sides, longest, off, uniform, frame };
}

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const mm = (v: number) => `${+v.toFixed(2)}`;
const times = (r: number) => (r >= 1 ? r.toFixed(1) : r.toFixed(2));

/** The package body size a part states (all three sides), or undefined. */
export function packageBody(def: ModuleDef | undefined): { length: number; width: number; height: number } | undefined {
  const s = def ? partPackage(def)?.size_mm : undefined;
  return s && pos(s.length) && pos(s.width) && pos(s.height) ? { length: s.length, width: s.width, height: s.height } : undefined;
}

/** The finding's message: the part, the package body, the model's size and the ratio, in plain words. */
export function sizeMessage(instance: string, part: string, pkg: { length: number; width: number; height: number }, c: SizeComparison, drawnBy?: string, ratio = MODEL_SIZE_RATIO): string {
  const body = `the package body is ${mm(pkg.length)} x ${mm(pkg.width)} x ${mm(pkg.height)} mm (length x width x height)`;
  const model =
    c.frame === "board"
      ? `the model measures ${mm(c.sides[0].model)} x ${mm(c.sides[1].model)} mm on the board and ${mm(c.sides[2].model)} mm high`
      : `the model measures ${c.sides.map((s) => mm(s.model)).join(" x ")} mm`;
  const ratios = `model / package: ${c.sides.map((s) => `${s.side} ${s.ratio.toFixed(2)}`).join(", ")}; reported beyond ${ratio}x either way`;
  const where = drawnBy !== undefined ? `It is drawn inside ${drawnBy}'s body: check the model that body's export used for it.` : `Check the model file's units (glTF is metres) and scale, or whether it is the model of another part.`;
  if (c.uniform) {
    return `${instance} (${part}): the 3D model is ${times(c.longest)} times the package body on its longest side; the model's scale may be wrong. ${upper(body)}; ${model} (${ratios}). ${where}`;
  }
  const worst = [...c.off].sort((a, b) => logOff(b.ratio) - logOff(a.ratio))[0];
  return `${instance} (${part}): the 3D model does not match the package body: its ${worst.side} is ${times(worst.ratio)} times the package's (${mm(worst.model)} mm against ${mm(worst.pkg)} mm). ${upper(body)}; ${model} (${ratios}). Check that the model is of this part and variant (pins, shell, legs) and that the package size is right. ${where}`;
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The body GLB a table entry draws, absolute, and the folder its sidecar must stay inside; undefined for a machine-cache file. */
export function glbOf(p: Project, e: ModelTableEntry): { glb: string; base: string } | undefined {
  if (!e.file || (e.format && e.format !== "glb") || e.file.startsWith("cache:")) return undefined;
  if (e.file.startsWith("package:")) {
    const art = p.artifacts.find((a) => a.definition === e.part && a.id === e.artifact && a.resolved);
    const rec = p.definitions.get(e.part);
    const base = rec ? artifactBaseDir(p.root, rec.origin.artifactBase) : undefined;
    if (!art?.resolved || !base || !isInsideReal(base, art.resolved)) return undefined;
    return { glb: art.resolved, base };
  }
  const glb = join(p.root, e.file);
  return isInsideReal(p.root, glb) ? { glb, base: p.root } : undefined;
}

/** The view sidecar index of a body GLB, when it exists, is inside `base`, under the cap and names this GLB (by sha256). */
export function readIndex(glb: { glb: string; base: string }, sha256: string | undefined, cap: number, cache: Map<string, ViewSidecarIndex | undefined>): ViewSidecarIndex | undefined {
  const file = viewSidecarPaths(glb.glb).index;
  if (cache.has(file)) return cache.get(file);
  let idx: ViewSidecarIndex | undefined;
  try {
    if (isInsideReal(glb.base, file) && isInsideReal(dirname(glb.glb), file)) idx = readJsonCapped<ViewSidecarIndex>(file, cap);
  } catch {
    idx = undefined; // over the cap or not JSON: nothing to compare (the sidecar writer reports its own problems)
  }
  // a sidecar of another version of the GLB describes other geometry (a stale build): silent until the next build
  if (idx && (!Array.isArray(idx.nodes) || (sha256 && idx.source?.sha256 && idx.source.sha256 !== sha256))) idx = undefined;
  cache.set(file, idx);
  return idx;
}

/** PB_MODEL_SIZE_MISMATCH findings for every drawn instance with a package body size and a placed 3D model. */
export function modelSizeDiagnostics(p: Project, options: ModelSizeOptions = {}): { diagnostics: ProjectDiagnostic[]; ran: boolean; reason?: string } {
  if (!projectHas3d(p)) return { diagnostics: [], ran: false, reason: "no body models in the project" };
  const ratio = options.ratio ?? MODEL_SIZE_RATIO;
  const cap = options.maxIndexBytes ?? MAX_VIEW_INDEX_BYTES;
  const table = modelTable(p);
  const own = new Map(table.instances.filter((e) => !e.drawnBy).map((e) => [e.instance, e]));
  const cache = new Map<string, ViewSidecarIndex | undefined>();
  const out: ProjectDiagnostic[] = [];
  for (const e of table.instances) {
    const pkg = packageBody(p.lookup(e.part));
    if (!pkg) continue;
    let nodes: ViewNode[];
    let slab: { bottom: number; top: number } | undefined;
    if (e.drawnBy !== undefined) {
      const holder = own.get(e.drawnBy);
      const g = holder && !holder.placeholder ? glbOf(p, holder) : undefined;
      const idx = g ? readIndex(g, holder!.sha256, cap, cache) : undefined;
      if (!idx) continue;
      const rel = e.instance.slice(e.drawnBy.length + 1);
      nodes = idx.nodes.filter((n) => n.instancePath === rel);
      slab = boardSlab(idx);
    } else {
      if (e.placeholder || e.source === "placeholder" || e.source === "none") continue;
      const g = glbOf(p, e);
      const idx = g ? readIndex(g, e.sha256, cap, cache) : undefined;
      if (!idx || idx.owner?.placeholder) continue;
      nodes = idx.nodes;
    }
    if (!nodes.length || nodes.some((n) => n.placeholder)) continue;
    const bounds = unionBounds(nodes.map((n) => n.bounds));
    if (!bounds) continue;
    const c = compareSize(bounds, pkg, slab, ratio);
    if (!c.off.length || c.sides.some((s) => !(s.model > 0))) continue;
    // wave R3 gate: the side furthest off as the card's VALUE, measured on the view meshes (tier mesh)
    const worst = [...c.off].sort((a, b) => logOff(b.ratio) - logOff(a.ratio))[0];
    out.push({
      code: MODEL_SIZE_CODE,
      severity: "warning",
      entity: { kind: "instance", id: e.instance },
      message: sizeMessage(e.instance, e.part, pkg, c, e.drawnBy, ratio),
      source: p.definitions.get(e.part)?.origin.source,
      validator: MODEL_SIZE_VALIDATOR,
      value: `${worst.side === "height" ? "height " : ""}${mm(worst.model)} mm against ${mm(worst.pkg)} mm`.slice(0, 40),
      tier: "mesh",
    });
  }
  return { diagnostics: out, ran: true };
}

/** Run the check on a loaded project: its findings and its check run (project.ts calls this after the part-files check). */
export function runModelSizeCheck(p: Project): void {
  const zero: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  let r: ReturnType<typeof modelSizeDiagnostics>;
  try {
    r = modelSizeDiagnostics(p);
  } catch (e) {
    p.checks.push({ validator: MODEL_SIZE_VALIDATOR, status: "skipped", reason: (e as Error).message, counts: zero });
    return;
  }
  p.diagnostics.push(...r.diagnostics);
  p.checks.push({ validator: MODEL_SIZE_VALIDATOR, status: r.ran ? "ran" : "skipped", ...(r.reason ? { reason: r.reason } : {}), counts: { ...zero, warning: r.diagnostics.length } });
}
