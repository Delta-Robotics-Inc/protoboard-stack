/**
 * The neutral 3D scene of a board: the board body (outline, cutouts, drilled holes, stackup thickness), one placed
 * component per footprint with its body and where the body came from, the seating result of each, and, on request,
 * thin colored bodies for copper and silkscreen. Writers (STEP, STL, 3MF, GLB) and the sidecar read only this.
 *
 * Frame: millimeters; origin at the board center (the center of the outline's box) unless `origin: "document"`;
 * X right and Y up seen from the top; Z out of the top face; z = 0 on the bottom face of the board.
 */
import {
  arcCenter,
  footprintToWorld,
  padsOf,
  toMm,
  type BoardDocument,
  type BoardRecord,
  type CopperLayer,
  type DerivedZoneFill,
  type FootprintGraphic,
  type FootprintRec,
  type FootprintText,
  type GraphicRec,
  type TextRec,
  type Vertex,
} from "@protoboardai/board";
import { textPath } from "@protoboardai/board-scene";
import { PART_COLORS, parametricBody, type BodyInterface } from "./bodies.js";
import { boxUnion, extrudeRegion, meshBounds, transformSolid, type Solid } from "./brep.js";
import { apply, applyDir, compose, emptyBounds, growBounds, rotationXYZ, rotationY, rotationZ, translation, type Affine, type Bounds, type Vec2, type Vec3 } from "./math.js";
import { classify, padGeom, type PackageInfo } from "./packages.js";
import { arcStrokeLoop, circleLoop, loopFromVertices, mapLoop, pointInPolygon, roundRectLoop, stadiumLoop, strokeLoop, tessellateLoop, rectLoop, type Loop } from "./profile.js";
import { measureSeating, type Seating } from "./seating.js";

export type Tier = "full" | "mechanical" | "envelope" | "board";
export const TIERS: readonly Tier[] = ["full", "mechanical", "envelope", "board"];

export interface RenderLayers {
  copper?: boolean;
  silkscreen?: boolean;
  /** Solder mask openings: pads drawn in exposed-copper color, copper under mask in mask-tinted color. */
  mask?: boolean;
}

export interface PartOverride {
  /** Body height above the board face, mm (a parametric or box body). */
  height?: number;
  /** Move the body in the footprint frame, mm, after it is built or loaded. */
  offset?: Vec3;
  /** Turn the body in the footprint frame, degrees about X, Y, Z (applied Z, then Y, then X). */
  rotate?: Vec3;
  /** `none`: no body; `box`: a box from the courtyard (or pads) and `height`. */
  body?: "none" | "box";
  /** The part sits this deep below the board face in a cutout (mid-mount), mm, positive down. */
  midMountMm?: number;
  color?: string;
  note?: string;
}

/** A supplied model mesh for a part, already in millimeters in the footprint frame (see models.ts). */
export interface ModelMesh {
  solid: Solid;
  source: string;
  /** Solids in the model as supplied (a vendor model can be hundreds). */
  solids?: number;
  path?: string;
  sha256?: string;
  /** Distribution terms of the file, when known. */
  terms?: "redistributable" | "internal" | "unknown";
  /** Whether `solid.palette` is the model's own color; when not, the part takes the color its package would have. */
  colored?: boolean;
}

export interface BoardColors {
  mask: string;
  silkscreen: string;
  copper: string;
  copperUnderMask: string;
  substrateEdge: string;
}
export const DEFAULT_COLORS: BoardColors = { mask: "#1e5a3c", silkscreen: "#f2f2ee", copper: "#c9a24b", copperUnderMask: "#2f7a52", substrateEdge: "#c8b88a" };

export interface Board3dOptions {
  /** Detail tier, default `full`. */
  tier?: Tier;
  /** Thin colored bodies for copper, silkscreen and mask openings (for renders). `true` turns all three on. Off by default. */
  render?: boolean | RenderLayers;
  /** Drill via holes in the board (`full` and `board` tiers; default true). */
  vias?: boolean;
  /** `mechanical` and `envelope`: plated holes at least this wide are kept (default 1.5 mm); unplated holes always are. */
  minHoleMm?: number;
  origin?: "board-center" | "document";
  /** Per-part overrides by reference designator, footprint id or UHD instance path. */
  overrides?: Record<string, PartOverride>;
  /** Supplied models by footprint id (loaded beforehand with `loadModels`). Used before parametric bodies. */
  models?: ReadonlyMap<string, ModelMesh>;
  /** `fix` (default) moves a supplied model so its seating plane is on the board face and records the move. */
  seat?: "fix" | "as-modelled";
  colors?: Partial<BoardColors>;
  /** Derived zone fill for the copper render layer (`loadZoneFill`); zones are drawn only with it. */
  fill?: DerivedZoneFill;
  /** Mesh chord tolerance, mm (default 0.01). */
  tolerance?: number;
  /** Envelope tier height map cell, mm (default 1). */
  heightMapCellMm?: number;
}

export interface HoleInfo {
  id: string;
  kind: "via" | "pad" | "unplated" | "mounting";
  at: Vec2;
  /** Diameter, or slot width and length. */
  d: number;
  slot?: { w: number; h: number; rotationDeg: number };
  plated: boolean;
  /** Whether the hole is cut in the exported board body (tiers drop small holes). */
  drilled: boolean;
}

export type BodySource = "model" | "parametric" | "courtyard-box" | "envelope" | "none";

export interface Component3d {
  /** Footprint record id (`fp:...`). */
  id: string;
  ref: string;
  path?: string;
  value?: string;
  footprint: string;
  side: "top" | "bottom";
  /** Display name: reference designator and value. */
  name: string;
  /** Footprint frame (mm, z up from the seating plane) to board frame. */
  transform: Affine;
  /** The body in the footprint frame (after overrides and the seating fix); undefined when the part has none. */
  solid?: Solid;
  body: {
    source: BodySource;
    /** What the body was made from, in words. */
    detail: string;
    kind: PackageInfo["kind"] | "model";
    heightMm: number;
    heightSource: string;
    placeholder: boolean;
    /** For `model`: file, solids as supplied, terms. */
    model?: { path?: string; sha256?: string; solids?: number; terms?: string };
  };
  seating: Seating;
  color: string;
  interfaces: (BodyInterface & { world: { origin: Vec3; zAxis: Vec3; xAxis: Vec3 } })[];
  override?: PartOverride;
  /** Bounds in the board frame. */
  bounds?: Bounds;
}

export interface LayerBody {
  /** `copper top`, `silkscreen bottom`, ... */
  name: string;
  kind: "copper" | "silkscreen";
  side: "top" | "bottom";
  solids: Solid[];
  color: string;
}

export interface Finding3d {
  code: "PCB3D_FLOATING" | "PCB3D_SUNK" | "PCB3D_ROTATED" | "PCB3D_MIRRORED" | "PCB3D_OFFSET" | "PCB3D_OVERHANG" | "PCB3D_COURTYARD" | "PCB3D_PLACEHOLDER" | "PCB3D_HOLE_SKIPPED" | "PCB3D_NO_BODY";
  severity: "error" | "warning" | "info";
  id?: string;
  ref?: string;
  message: string;
  value?: number;
  limit?: number;
}

export interface Board3d {
  name: string;
  tier: Tier;
  render: Required<RenderLayers>;
  frame: { units: "mm"; up: "+Z"; origin: "board-center" | "document"; z0: "board bottom face"; toDocument: Vec3 };
  board: { solid: Solid; thicknessMm: number; outline: Vec2[][]; holes: HoleInfo[]; bounds: Bounds; color: string; stackup: { name: string; type: string; thicknessMm: number }[] };
  components: Component3d[];
  /** Envelope tier: the keep-out slab of each side. */
  slabs: { side: "top" | "bottom"; solid: Solid; heightMm: number }[];
  heightMap?: { cellMm: number; origin: Vec2; nx: number; ny: number; top: number[]; bottom: number[] };
  layers: LayerBody[];
  findings: Finding3d[];
  colors: BoardColors;
  ms: number;
}

const CONNECTOR_KINDS = new Set(["usb-c", "usb-micro", "header"]);
const isConnector = (fp: FootprintRec, kind: string) => CONNECTOR_KINDS.has(kind) || /^(J|P|CN|USB|X)\d/i.test(fp.ref);

function renderLayers(r: Board3dOptions["render"]): Required<RenderLayers> {
  if (r === true) return { copper: true, silkscreen: true, mask: true };
  if (!r) return { copper: false, silkscreen: false, mask: false };
  return { copper: !!r.copper, silkscreen: !!r.silkscreen, mask: !!r.mask };
}

/** Build the scene. Pure: reads the document, writes nothing. */
export function buildBoard3d(doc: BoardDocument, options: Board3dOptions = {}): Board3d {
  const t0 = performance.now();
  const tier = options.tier ?? "full";
  const render = renderLayers(options.render);
  const colors: BoardColors = { ...DEFAULT_COLORS, ...options.colors };
  const tol = options.tolerance ?? 0.01;
  const recs = [...doc.records.values()];
  const boardRec = recs.find((r) => r.kind === "board") as Extract<BoardRecord, { kind: "board" }> | undefined;
  const outlineRec = recs.find((r) => r.kind === "outline") as Extract<BoardRecord, { kind: "outline" }> | undefined;
  if (!outlineRec) throw new Error("buildBoard3d: the board has no outline");
  const T = toMm(boardRec?.thickness ?? 1_600_000);
  // origin
  let origin: Vec2 = [0, 0];
  const ob = emptyBounds();
  for (const p of tessellateLoop(loopFromVertices(outlineRec.outline), 0.01)) growBounds(ob, [p[0], p[1], 0]);
  if ((options.origin ?? "board-center") === "board-center") origin = [(ob.min[0] + ob.max[0]) / 2, (ob.min[1] + ob.max[1]) / 2];
  const toLocal = (x: number, y: number): Vec2 => [toMm(x) - origin[0], toMm(y) - origin[1]];
  const findings: Finding3d[] = [];

  // ---------------------------------------------------------------- holes
  const outerLoop = loopFromVertices(outlineRec.outline, origin);
  const outerPoly = tessellateLoop(outerLoop, 0.02);
  const cutouts = recs.filter((r) => r.kind === "cutout") as Extract<BoardRecord, { kind: "cutout" }>[];
  const cutLoops = cutouts.map((c) => loopFromVertices(c.outline, origin));
  const fps = (recs.filter((r) => r.kind === "footprint") as FootprintRec[]).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const infos = new Map<string, PackageInfo>();
  const courtyards = new Map<string, { minX: number; maxX: number; minY: number; maxY: number }>();
  for (const fp of fps) {
    if (fp.courtyard?.length) {
      const pts = tessellateLoop(loopFromVertices(fp.courtyard), 0.02);
      courtyards.set(fp.id, { minX: Math.min(...pts.map((q) => q[0])), maxX: Math.max(...pts.map((q) => q[0])), minY: Math.min(...pts.map((q) => q[1])), maxY: Math.max(...pts.map((q) => q[1])) });
    }
    infos.set(fp.id, classify(fp, courtyards.get(fp.id)));
  }
  const holes: HoleInfo[] = [];
  const minHole = options.minHoleMm ?? 1.5;
  const allHoles = tier === "full" || tier === "board";
  const viasDrilled = allHoles && options.vias !== false;
  for (const fp of fps) {
    const connector = isConnector(fp, infos.get(fp.id)!.kind);
    for (const wp of padsOf(fp)) {
      const p = wp.pad;
      if (p.type === "smd") continue;
      const w = toMm(p.type === "np" ? p.hole_diameter! : p.hole_width ?? p.hole_diameter ?? 0);
      const h = toMm(p.type === "np" ? p.hole_diameter! : p.hole_height ?? p.hole_diameter ?? 0);
      if (!(w > 0 && h > 0)) continue;
      const plated = p.type === "th";
      const mounting = !plated || Math.max(w, h) >= 2.0 || /^(MH|H)\d/i.test(fp.ref) || /mounting/i.test(fp.footprint);
      const keep = allHoles || !plated || Math.max(w, h) >= minHole || connector;
      holes.push({ id: wp.id, kind: mounting && Math.max(w, h) >= 2.0 ? "mounting" : plated ? "pad" : "unplated", at: toLocal(wp.x, wp.y), d: Math.min(w, h), ...(Math.abs(w - h) > 1e-6 ? { slot: { w, h, rotationDeg: wp.rotation / 1000 } } : {}), plated, drilled: keep });
    }
  }
  for (const r of recs) {
    if (r.kind !== "via") continue;
    holes.push({ id: r.id, kind: "via", at: toLocal(r.x, r.y), d: toMm(r.hole_diameter), plated: true, drilled: viasDrilled });
  }
  holes.sort((a, b) => (a.id < b.id ? -1 : 1));
  const holeLoop = (h: HoleInfo): Loop => {
    if (!h.slot) return circleLoop(h.d / 2, h.at[0], h.at[1]);
    const base = stadiumLoop(h.slot.w, h.slot.h, 0, 0);
    const a = (h.slot.rotationDeg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return mapLoop(base, (q) => [h.at[0] + q[0] * c - q[1] * s, h.at[1] + q[0] * s + q[1] * c]);
  };
  // holes must sit inside the outline and must not overlap one another or a cutout
  const kept: { h: HoleInfo; r: number }[] = [];
  const cutPolys = cutLoops.map((l) => tessellateLoop(l, 0.02));
  for (const h of holes) {
    if (!h.drilled) continue;
    const r = (h.slot ? Math.max(h.slot.w, h.slot.h) : h.d) / 2;
    const ring = tessellateLoop(holeLoop(h), 0.05);
    const inside = ring.every((q) => pointInPolygon(q, outerPoly)) && !cutPolys.some((cp) => ring.some((q) => pointInPolygon(q, cp)) || cp.some((q) => pointInPolygon(q, ring)));
    const clash = kept.find((k) => Math.hypot(k.h.at[0] - h.at[0], k.h.at[1] - h.at[1]) < k.r + r + 1e-4);
    if (!inside || clash) {
      h.drilled = false;
      findings.push({ code: "PCB3D_HOLE_SKIPPED", severity: "info", id: h.id, message: `${h.id}: hole not cut in the board body (${!inside ? "it crosses the outline or a cutout" : `it overlaps ${clash!.h.id}`})` });
      continue;
    }
    kept.push({ h, r });
  }
  const boardRegion = { outer: outerLoop, holes: [...cutLoops, ...kept.map((k) => holeLoop(k.h))] };
  const boardSolid = extrudeRegion(boardRegion, 0, T, 0, [colors.mask], tol);

  // ---------------------------------------------------------------- components
  const components: Component3d[] = [];
  if (tier !== "board") {
    for (const fp of fps) {
      const info0 = infos.get(fp.id)!;
      const ov = options.overrides?.[fp.ref] ?? options.overrides?.[fp.id] ?? (fp.path ? options.overrides?.[fp.path] : undefined);
      const info: PackageInfo = ov?.height !== undefined ? { ...info0, height: ov.height, heightSource: `override: ${ov.note ?? "part height"}` } : info0;
      const pads = fp.pads.map(padGeom);
      const court = courtyards.get(fp.id);
      const side = fp.side;
      const zFace = side === "top" ? T : 0;
      const transform = compose(translation([toMm(fp.x) - origin[0], toMm(fp.y) - origin[1], zFace]), compose(rotationZ(fp.rotation / 1000), side === "bottom" ? rotationY(180) : rotationXYZ([0, 0, 0])));
      const name = fp.value ? `${fp.ref} ${fp.value}` : fp.ref;
      const base = { id: fp.id, ref: fp.ref, ...(fp.path ? { path: fp.path } : {}), ...(fp.value ? { value: fp.value } : {}), footprint: fp.footprint, side, name, transform, ...(ov ? { override: ov } : {}) };
      // resolve the body: supplied model, parametric, courtyard box
      let solid: Solid | undefined;
      let interfaces: BodyInterface[] = [];
      let source: BodySource;
      let detail: string;
      let kind: Component3d["body"]["kind"] = info.kind;
      let placeholder = false;
      let heightSource = info.heightSource;
      let modelInfo: Component3d["body"]["model"];
      const model = options.models?.get(fp.id);
      if (ov?.body === "none" || (info.kind === "pads-only" && !model)) {
        source = "none";
        detail = ov?.body === "none" ? "override: no body" : info.reason;
      } else if (model && ov?.body !== "box") {
        solid = model.solid;
        if (!model.colored) {
          // a tessellated model carries no colors: give it the color its recognized package has
          const main = info.kind !== "unknown" && info.kind !== "pads-only" ? parametricBody(fp, info, T)?.solid.palette[0] : undefined;
          solid = { ...solid, palette: [main ?? PART_COLORS.icBody] };
        }
        source = "model";
        kind = "model";
        detail = model.source;
        heightSource = "measured from the model";
        modelInfo = { ...(model.path ? { path: model.path } : {}), ...(model.sha256 ? { sha256: model.sha256 } : {}), ...(model.solids !== undefined ? { solids: model.solids } : {}), ...(model.terms ? { terms: model.terms } : {}) };
      } else if (ov?.body !== "box" && info.kind !== "unknown") {
        const built = parametricBody(fp, info, T);
        solid = built?.solid;
        interfaces = built?.interfaces ?? [];
        source = solid ? "parametric" : "none";
        detail = `${info.kind}${info.family ? ` ${info.family}` : ""}: ${info.reason}`;
        placeholder = info.placeholder;
      } else {
        const b = court ?? { minX: info.body.cx - info.body.w / 2, maxX: info.body.cx + info.body.w / 2, minY: info.body.cy - info.body.h / 2, maxY: info.body.cy + info.body.h / 2 };
        const inset = court ? 0.2 : 0;
        solid = boxUnion([{ min: [b.minX + inset, b.minY + inset, 0], max: [b.maxX - inset, b.maxY - inset, info.height], color: 0 }], [ov?.color ?? PART_COLORS.placeholder]);
        source = "courtyard-box";
        detail = `box from the ${court ? "courtyard" : "pads"}, height ${info.height} mm`;
        placeholder = ov?.height === undefined;
        kind = info.kind;
      }
      if (solid && ov?.color) solid = { ...solid, palette: [ov.color, ...solid.palette.slice(1)] };
      // overrides move the body in the footprint frame
      if (solid && (ov?.offset || ov?.rotate)) solid = transformSolid(solid, compose(translation(ov.offset ?? [0, 0, 0]), rotationXYZ(ov.rotate ?? [0, 0, 0])));
      const expect = -(ov?.midMountMm ?? 0);
      let seating: Seating;
      if (solid) {
        seating = measureSeating({ mesh: solid.mesh, pads, ...(court ? { courtyard: court } : {}), expectMm: expect });
        if (source === "model" && (options.seat ?? "fix") === "fix" && Math.abs(seating.gapMm) > 1e-6) {
          const dz = -seating.gapMm;
          solid = transformSolid(solid, translation([0, 0, dz]));
          seating = { ...seating, fixedMm: dz, notes: [...seating.notes, `moved ${dz > 0 ? "up" : "down"} ${Math.abs(dz).toFixed(3)} mm onto the board face`] };
        }
      } else {
        seating = { method: "none", planeMm: 0, gapMm: 0, xyResidualMm: 0, contacts: 0, padsHit: 0, pads: pads.length, rotationDeg: 0, mirrored: false, inCourtyard: null, heightMm: 0, status: "none", notes: [] };
      }
      // tiers: mechanical keeps connectors as they are and makes every other body its envelope box
      if (solid && tier === "mechanical" && !isConnector(fp, info.kind)) {
        const b = meshBounds(solid.mesh);
        solid = boxUnion([{ min: [b.min[0], b.min[1], Math.max(b.min[2], expect)], max: b.max, color: 0 }], [solid.palette[0]]);
        detail = `envelope of the ${source} body (${detail})`;
        source = "envelope";
      }
      const worldIf = interfaces.map((i) => ({ ...i, world: { origin: apply(transform, i.origin), zAxis: applyDir(transform, i.zAxis), xAxis: applyDir(transform, i.xAxis) } }));
      const comp: Component3d = {
        ...base,
        ...(solid ? { solid } : {}),
        body: { source, detail, kind, heightMm: seating.heightMm, heightSource, placeholder, ...(modelInfo ? { model: modelInfo } : {}) },
        seating,
        color: solid?.palette[0] ?? "#000000",
        interfaces: worldIf,
        ...(solid ? { bounds: meshBounds(solid.mesh, transform) } : {}),
      };
      components.push(comp);
      // findings from the seating check
      const at = { id: fp.id, ref: fp.ref };
      if (seating.status === "floating") findings.push({ code: "PCB3D_FLOATING", severity: "warning", ...at, message: `${fp.ref}: body floats ${seating.gapMm} mm above the board face`, value: seating.gapMm, limit: 0.05 });
      if (seating.status === "sunk") findings.push({ code: "PCB3D_SUNK", severity: "warning", ...at, message: `${fp.ref}: body sits ${-seating.gapMm} mm below the board face (declare a mid-mount part with midMountMm)`, value: seating.gapMm, limit: -0.05 });
      if (seating.status === "rotated") findings.push({ code: "PCB3D_ROTATED", severity: "error", ...at, message: `${fp.ref}: ${seating.notes[0] ?? "the body is turned against its pads"}`, value: seating.rotationDeg });
      if (seating.status === "mirrored") findings.push({ code: "PCB3D_MIRRORED", severity: "error", ...at, message: `${fp.ref}: ${seating.notes[0] ?? "the body is mirrored against its pads"}` });
      if (seating.status === "offset") findings.push({ code: "PCB3D_OFFSET", severity: "warning", ...at, message: `${fp.ref}: ${seating.notes[0] ?? "the body is offset from its pads"}`, value: seating.xyResidualMm, limit: 0.1 });
      if (seating.inCourtyard === false && source !== "envelope") findings.push({ code: "PCB3D_COURTYARD", severity: "info", ...at, message: `${fp.ref}: the body reaches outside the courtyard` });
      if (placeholder) findings.push({ code: "PCB3D_PLACEHOLDER", severity: "info", ...at, message: `${fp.ref}: stand-in body (${detail}); give the part a model or a height` });
      if (source === "none" && info.kind !== "pads-only") findings.push({ code: "PCB3D_NO_BODY", severity: "info", ...at, message: `${fp.ref}: no body (${detail})` });
      if (comp.bounds) {
        const b = comp.bounds;
        const corners: Vec2[] = [
          [b.min[0], b.min[1]],
          [b.max[0], b.min[1]],
          [b.max[0], b.max[1]],
          [b.min[0], b.max[1]],
        ];
        const out = corners.filter((q) => !pointInPolygon(q, outerPoly));
        if (out.length) findings.push({ code: "PCB3D_OVERHANG", severity: isConnector(fp, info.kind) ? "info" : "warning", ...at, message: `${fp.ref}: the body reaches past the board outline${isConnector(fp, info.kind) ? " (expected for an edge connector)" : ""}` });
      }
    }
  }

  // ---------------------------------------------------------------- envelope slabs and height map
  const slabs: Board3d["slabs"] = [];
  let heightMap: Board3d["heightMap"];
  if (tier === "envelope") {
    const cell = options.heightMapCellMm ?? 1;
    const ox = ob.min[0] - origin[0];
    const oy = ob.min[1] - origin[1];
    const nx = Math.max(1, Math.ceil((ob.max[0] - ob.min[0]) / cell));
    const ny = Math.max(1, Math.ceil((ob.max[1] - ob.min[1]) / cell));
    const top = new Array<number>(nx * ny).fill(0);
    const bottom = new Array<number>(nx * ny).fill(0);
    let maxTop = 0;
    let maxBottom = 0;
    for (const c of components) {
      if (!c.bounds) continue;
      const b = c.bounds;
      const hTop = Math.max(0, b.max[2] - T);
      const hBot = Math.max(0, -b.min[2]);
      const i0 = Math.max(0, Math.floor((b.min[0] - ox) / cell));
      const i1 = Math.min(nx - 1, Math.floor((b.max[0] - ox) / cell));
      const j0 = Math.max(0, Math.floor((b.min[1] - oy) / cell));
      const j1 = Math.min(ny - 1, Math.floor((b.max[1] - oy) / cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          // a through-hole part's leads below the board count on the bottom side
          if (b.max[2] > T + 1e-6) top[i + j * nx] = Math.max(top[i + j * nx], Math.round(hTop * 1000) / 1000);
          if (b.min[2] < -1e-6) bottom[i + j * nx] = Math.max(bottom[i + j * nx], Math.round(hBot * 1000) / 1000);
        }
      }
      if (b.max[2] > T + 1e-6) maxTop = Math.max(maxTop, hTop);
      if (b.min[2] < -1e-6) maxBottom = Math.max(maxBottom, hBot);
    }
    heightMap = { cellMm: cell, origin: [ox, oy], nx, ny, top, bottom };
    const outline = { outer: outerLoop, holes: cutLoops };
    if (maxTop > 0) slabs.push({ side: "top", heightMm: maxTop, solid: extrudeRegion(outline, T, T + maxTop, 0, ["#7f8fa6"], tol) });
    if (maxBottom > 0) slabs.push({ side: "bottom", heightMm: maxBottom, solid: extrudeRegion(outline, -maxBottom, 0, 0, ["#7f8fa6"], tol) });
  }

  // ---------------------------------------------------------------- render layers
  const layers: LayerBody[] = [];
  if (render.copper || render.silkscreen || render.mask) layers.push(...renderBodies(doc, fps, origin, T, colors, render, options.fill, tol));

  const thicknessOf = recs.filter((r) => r.kind === "layer").sort((a, b) => (a as { order: number }).order - (b as { order: number }).order) as Extract<BoardRecord, { kind: "layer" }>[];
  return {
    name: boardRec?.name ?? "board",
    tier,
    render,
    frame: { units: "mm", up: "+Z", origin: options.origin ?? "board-center", z0: "board bottom face", toDocument: [origin[0], origin[1], 0] },
    board: {
      solid: boardSolid,
      thicknessMm: T,
      outline: [outerPoly, ...cutPolys],
      holes,
      bounds: meshBounds(boardSolid.mesh),
      color: colors.mask,
      stackup: thicknessOf.map((l) => ({ name: l.name, type: l.type, thicknessMm: toMm(l.thickness) })),
    },
    components,
    slabs,
    ...(heightMap ? { heightMap } : {}),
    layers,
    findings,
    colors,
    ms: Math.round((performance.now() - t0) * 10) / 10,
  };
}

// ---------------------------------------------------------------- copper and silkscreen

const COPPER_T = 0.035;
const SILK_T = 0.02;

function renderBodies(doc: BoardDocument, fps: FootprintRec[], origin: Vec2, T: number, colors: BoardColors, render: Required<RenderLayers>, fill: DerivedZoneFill | undefined, tol: number): LayerBody[] {
  const out: LayerBody[] = [];
  const zOf = (side: "top" | "bottom", kind: "copper" | "silkscreen"): [number, number] => {
    const t = kind === "copper" ? COPPER_T : SILK_T;
    const lift = kind === "silkscreen" ? COPPER_T : 0;
    return side === "top" ? [T + lift, T + lift + t] : [-lift - t, -lift];
  };
  const L = (x: number, y: number): Vec2 => [toMm(x) - origin[0], toMm(y) - origin[1]];
  const recs = [...doc.records.values()];
  if (render.copper || render.mask) {
    for (const side of ["top", "bottom"] as const) {
      const [z0, z1] = zOf(side, "copper");
      const exposed: Solid[] = [];
      const covered: Solid[] = [];
      for (const fp of fps) {
        for (const wp of padsOf(fp)) {
          const p = wp.pad;
          if (!wp.layers.includes(side as CopperLayer)) continue;
          const c = L(wp.x, wp.y);
          const rot = (wp.rotation / 1000) * (Math.PI / 180);
          let loop: Loop;
          const w = toMm(p.type === "th" ? p.outer_width ?? p.outer_diameter ?? 0 : p.width ?? 0);
          const h = toMm(p.type === "th" ? p.outer_height ?? p.outer_diameter ?? 0 : p.height ?? 0);
          if (p.shape === "circle" || (p.type === "th" && p.outer_diameter && !p.outer_width)) loop = circleLoop(p.type === "th" ? toMm(p.outer_diameter!) / 2 : toMm(p.radius ?? 0), 0, 0);
          else if (p.shape === "oval") loop = stadiumLoop(w, h);
          else if (p.shape === "roundrect") loop = roundRectLoop(w, h, toMm(p.corner_radius ?? 0));
          else if (p.shape === "polygon" && p.points?.length) loop = loopFromVertices(p.points);
          else loop = rectLoop(w, h);
          const mirror = fp.side === "bottom" && p.shape === "polygon";
          const place = (q: Vec2): Vec2 => {
            const x = mirror ? -q[0] : q[0];
            return [c[0] + x * Math.cos(rot) - q[1] * Math.sin(rot), c[1] + x * Math.sin(rot) + q[1] * Math.cos(rot)];
          };
          const holes: Loop[] = [];
          if (p.type === "th") {
            const hw = toMm(p.hole_width ?? p.hole_diameter ?? 0);
            const hh = toMm(p.hole_height ?? p.hole_diameter ?? 0);
            if (hw > 0) holes.push(mapLoop(Math.abs(hw - hh) < 1e-6 ? circleLoop(hw / 2) : stadiumLoop(hw, hh), place));
          }
          try {
            exposed.push(extrudeRegion({ outer: mapLoop(loop, place, mirror), holes }, z0, z1, 0, [colors.copper], tol));
          } catch {
            /* a degenerate pad shape: skipped */
          }
        }
      }
      for (const r of recs) {
        if (r.kind === "track" && r.layer === side) {
          const a = L(r.start.x, r.start.y);
          const b = L(r.end.x, r.end.y);
          const w = toMm(r.width);
          if (r.sweep) {
            const c = arcCenter(r.start, r.end, r.sweep);
            const cc = L(c.x, c.y);
            const a0 = Math.atan2(a[1] - cc[1], a[0] - cc[0]);
            covered.push(extrudeRegion({ outer: arcStrokeLoop(cc, toMm(c.r), a0, (r.sweep / 1000) * (Math.PI / 180), w), holes: [] }, z0, z1, 0, [colors.copperUnderMask], tol));
          } else covered.push(extrudeRegion({ outer: strokeLoop(a, b, w), holes: [] }, z0, z1, 0, [colors.copperUnderMask], tol));
        }
        if (r.kind === "via") {
          const tented = r.tented === "both" || r.tented === side;
          const ring = { outer: circleLoop(toMm(r.outer_diameter) / 2, ...L(r.x, r.y)), holes: [circleLoop(toMm(r.hole_diameter) / 2, ...L(r.x, r.y))] };
          (tented ? covered : exposed).push(extrudeRegion(ring, z0, z1, 0, [tented ? colors.copperUnderMask : colors.copper], tol));
        }
      }
      if (fill) {
        for (const f of fill.fills) {
          if (f.layer !== side) continue;
          for (const poly of f.polygons) {
            const ring = (flat: number[]): Loop => {
              const pts: Vec2[] = [];
              for (let k = 0; k + 1 < flat.length; k += 2) pts.push(L(flat[k], flat[k + 1]));
              return { pts, arcs: pts.map(() => undefined) };
            };
            try {
              covered.push(extrudeRegion({ outer: ring(poly.outer), holes: poly.holes.map(ring) }, z0, z1, 0, [colors.copperUnderMask], tol));
            } catch {
              /* skipped */
            }
          }
        }
      }
      const name = `copper ${side}`;
      // with mask openings, pads show as bare copper and covered copper takes the mask's tint; without, all copper is copper colored
      if (render.copper) {
        const all = render.mask ? [...exposed, ...covered] : [...exposed, ...covered].map((s) => ({ ...s, palette: [colors.copper] }));
        if (all.length) out.push({ name, kind: "copper", side, solids: all, color: colors.copper });
      } else if (render.mask && exposed.length) out.push({ name: `mask openings ${side}`, kind: "copper", side, solids: exposed, color: colors.copper });
    }
  }
  if (render.silkscreen) {
    for (const side of ["top", "bottom"] as const) {
      const [z0, z1] = zOf(side, "silkscreen");
      const layer = `${side}_silkscreen`;
      const solids: Solid[] = [];
      const add = (loop: Loop, holes: Loop[] = []) => {
        try {
          solids.push(extrudeRegion({ outer: loop, holes }, z0, z1, 0, [colors.silkscreen], tol));
        } catch {
          /* skipped */
        }
      };
      const strokeShape = (g: Pick<GraphicRec, "shape" | "start" | "end" | "sweep" | "center" | "radius" | "width" | "height" | "rotation" | "points" | "stroke_width" | "filled">, map: (x: number, y: number) => Vec2) => {
        const w = toMm(g.stroke_width);
        const seg = (a: Vertex, b: Vertex, sweep?: number) => {
          const pa = map(a.x, a.y);
          const pb = map(b.x, b.y);
          if (sweep) {
            const c = arcCenter(a, b, sweep);
            const pc = map(c.x, c.y);
            const a0 = Math.atan2(pa[1] - pc[1], pa[0] - pc[0]);
            const a1 = Math.atan2(pb[1] - pc[1], pb[0] - pc[0]);
            let s = a1 - a0;
            const ccwWorld = (sweep > 0) === mapKeepsOrientation(map);
            if (ccwWorld) while (s <= 0) s += 2 * Math.PI;
            else while (s >= 0) s -= 2 * Math.PI;
            add(arcStrokeLoop(pc, Math.hypot(pa[0] - pc[0], pa[1] - pc[1]), a0, s, w));
          } else add(strokeLoop(pa, pb, w));
        };
        if (g.shape === "line" || g.shape === "arc") seg(g.start!, g.end!, g.sweep);
        else if (g.shape === "circle") {
          const c = map(g.center!.x, g.center!.y);
          const r = toMm(g.radius!);
          if (g.filled) add(circleLoop(r + w / 2, c[0], c[1]));
          else if (r > w / 2) add(circleLoop(r + w / 2, c[0], c[1]), [circleLoop(r - w / 2, c[0], c[1])]);
          else add(circleLoop(r + w / 2, c[0], c[1]));
        } else if (g.shape === "rect") {
          const hw = g.width! / 2;
          const hh = g.height! / 2;
          const rot = ((g.rotation ?? 0) / 1000) * (Math.PI / 180);
          const pts: Vertex[] = [
            [-hw, -hh],
            [hw, -hh],
            [hw, hh],
            [-hw, hh],
          ].map(([x, y]) => ({ x: g.center!.x + x * Math.cos(rot) - y * Math.sin(rot), y: g.center!.y + x * Math.sin(rot) + y * Math.cos(rot) }));
          if (g.filled) add({ pts: pts.map((q) => map(q.x, q.y)), arcs: [undefined, undefined, undefined, undefined] });
          else for (let k = 0; k < 4; k++) seg(pts[k], pts[(k + 1) % 4]);
        } else if ((g.shape === "polygon" || g.shape === "path") && g.points?.length) {
          const n = g.points.length;
          const closed = g.shape === "polygon";
          if (closed && g.filled) add({ pts: g.points.map((q) => map(q.x, q.y)), arcs: g.points.map(() => undefined) });
          else for (let k = 0; k < (closed ? n : n - 1); k++) seg(g.points[k], g.points[(k + 1) % n], g.points[k].sweep);
        }
      };
      const textShape = (t: Pick<TextRec, "text" | "x" | "y" | "height" | "stroke_width" | "rotation" | "anchor" | "mirrored">, map: (x: number, y: number) => Vec2, extraAngle: number, mirrorText: boolean) => {
        const hmm = toMm(t.height);
        const w = toMm(t.stroke_width ?? Math.round(t.height / 8));
        // textPath works in screen coordinates (y down) with a clockwise angle; draw in a local text frame and map
        const d = textPath(t.text, 0, 0, hmm, t.anchor ?? "center", 0);
        const ang = ((t.rotation ?? 0) / 1000 + extraAngle) * (Math.PI / 180);
        const flip = mirrorText !== !!t.mirrored;
        const polys: Vec2[][] = [];
        for (const m of d.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)) {
          const x = Number(m[2]) * (flip ? -1 : 1);
          const y = -Number(m[3]);
          const q: Vec2 = [x * Math.cos(ang) - y * Math.sin(ang), x * Math.sin(ang) + y * Math.cos(ang)];
          if (m[1] === "M") polys.push([q]);
          else polys[polys.length - 1]?.push(q);
        }
        const c = map(t.x, t.y);
        for (const pl of polys) for (let k = 0; k + 1 < pl.length; k++) add(strokeLoop([c[0] + pl[k][0], c[1] + pl[k][1]], [c[0] + pl[k + 1][0], c[1] + pl[k + 1][1]], w));
      };
      for (const r of recs) {
        if (r.kind === "graphic" && r.layer === layer) strokeShape(r, L);
        if (r.kind === "text" && r.layer === layer) textShape(r, L, 0, false);
      }
      for (const fp of fps) {
        const map = (x: number, y: number): Vec2 => {
          const w = footprintToWorld(fp, { x, y });
          return L(w.x, w.y);
        };
        const onSide = (l: string) => (fp.side === "top" ? l : l.startsWith("top_") ? `bottom_${l.slice(4)}` : l.startsWith("bottom_") ? `top_${l.slice(7)}` : l) === layer;
        for (const g of (fp.graphics ?? []) as FootprintGraphic[]) if (onSide(g.layer)) strokeShape(g as never, map);
        for (const t of (fp.texts ?? []) as FootprintText[]) {
          if (!onSide(t.layer)) continue;
          const text = t.role === "ref" ? fp.ref : t.role === "value" ? fp.value ?? t.text : t.text;
          textShape({ ...t, text }, map, (fp.side === "bottom" ? -1 : 1) * (fp.rotation / 1000), fp.side === "bottom");
        }
      }
      if (solids.length) out.push({ name: `silkscreen ${side}`, kind: "silkscreen", side, solids, color: colors.silkscreen });
    }
  }
  return out;
}

/** Whether a 2D map keeps orientation (not mirrored), tested on a small triangle. */
function mapKeepsOrientation(map: (x: number, y: number) => Vec2): boolean {
  const a = map(0, 0);
  const b = map(1_000_000, 0);
  const c = map(0, 1_000_000);
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
}

/** Every solid of the scene with its name, in export order: the board, components, slabs, render layers. */
export interface NamedSolid {
  /** Product or object name. */
  name: string;
  /** Stable id: `board`, the footprint id, `slab:top`, `layer:copper top:<n>`. */
  id: string;
  group: "board" | "component" | "slab" | "layer";
  solid: Solid;
  /** Placement of the solid (identity for solids already in the board frame). */
  transform: Affine;
  component?: Component3d;
}

export function sceneSolids(scene: Board3d): NamedSolid[] {
  const I: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const out: NamedSolid[] = [{ name: `${scene.name} PCB`, id: "board", group: "board", solid: scene.board.solid, transform: I }];
  for (const c of exportedComponents(scene)) out.push({ name: c.name, id: c.id, group: "component", solid: c.solid!, transform: c.transform, component: c });
  for (const s of scene.slabs) out.push({ name: `keep-out ${s.side} ${s.heightMm.toFixed(2)} mm`, id: `slab:${s.side}`, group: "slab", solid: s.solid, transform: I });
  for (const l of scene.layers) l.solids.forEach((s, i) => out.push({ name: l.name, id: `layer:${l.name}:${i}`, group: "layer", solid: s, transform: I }));
  return out;
}

/** The scene's mechanical body count: the board, one per component with a body, and slabs (render layers excluded). */
export const bodyCount = (scene: Board3d): number => 1 + exportedComponents(scene).length + scene.slabs.length;

/** Components whose bodies the files hold: every one with a body, except in the envelope tier (only its slabs). */
export const exportedComponents = (scene: Board3d): Component3d[] => (scene.tier === "envelope" ? [] : scene.components.filter((c) => c.solid));

