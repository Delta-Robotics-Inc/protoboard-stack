/**
 * The sidecar written beside every export (`<name>.board3d.json`, schema `protoboard.board-3d/v0`): the frame and
 * units, the board (outline, thickness, stackup, holes and mounting holes), and for every component its transform,
 * name, color, where its body came from, its seating result and its mating points, so the 3D viewer's mates, origins
 * and interfaces can use them. Numbers only: it carries no model geometry, so it can be shared when a model cannot.
 */
import { r6, roundBounds, roundVec } from "./math.js";
import { bodyCount, type Board3d, type Component3d } from "./scene.js";

export const SIDECAR_SCHEMA = "protoboard.board-3d/v0";

export interface SidecarFile {
  format: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface SidecarInput {
  scene: Board3d;
  files: SidecarFile[];
  images: SidecarFile[];
  /** Product, object, node and file names per component id, as each writer named them. */
  names?: Record<string, { step?: string; stl?: string; "3mf"?: string; glb?: string }>;
  stepSolids?: number;
  validation?: unknown;
  timing?: Record<string, number>;
  options?: Record<string, unknown>;
}

const xf = (m: number[]) => m.map(r6);

function component(c: Component3d, names: SidecarInput["names"], T: number) {
  const b = c.bounds;
  const face = c.side === "top" ? T : 0;
  return {
    id: c.id,
    ref: c.ref,
    ...(c.path ? { path: c.path } : {}),
    name: c.name,
    ...(c.value ? { value: c.value } : {}),
    footprint: c.footprint,
    side: c.side,
    transform: xf(c.transform),
    color: c.color,
    body: {
      source: c.body.source,
      kind: c.body.kind,
      detail: c.body.detail,
      heightMm: c.body.heightMm,
      heightSource: c.body.heightSource,
      placeholder: c.body.placeholder,
      ...(c.body.model ? { model: c.body.model } : {}),
    },
    seating: c.seating,
    ...(b ? { bounds: roundBounds(b), heightAboveFaceMm: r6(c.side === "top" ? b.max[2] - face : face - b.min[2]) } : {}),
    interfaces: c.interfaces.map((i) => ({ kind: i.kind, note: i.note, ...(i.size ? { sizeMm: i.size.map(r6) } : {}), frame: { origin: roundVec(i.world.origin), zAxis: roundVec(i.world.zAxis), xAxis: roundVec(i.world.xAxis) }, local: { origin: roundVec(i.origin), zAxis: roundVec(i.zAxis), xAxis: roundVec(i.xAxis) } })),
    ...(c.override ? { override: c.override } : {}),
    ...(names?.[c.id] ? { files: names[c.id] } : {}),
  };
}

export function buildSidecar(input: SidecarInput) {
  const s = input.scene;
  const T = s.board.thicknessMm;
  const comps = s.components;
  const bySource: Record<string, number> = {};
  for (const c of comps) bySource[c.body.source] = (bySource[c.body.source] ?? 0) + 1;
  const restricted = comps.filter((c) => c.body.model?.terms && c.body.model.terms !== "redistributable").map((c) => c.id);
  const unknown = comps.some((c) => c.body.model && !c.body.model.terms);
  return {
    schema: SIDECAR_SCHEMA,
    generator: "@protoboardai/board-3d",
    board: s.name,
    tier: s.tier,
    render: s.render,
    options: input.options ?? {},
    frame: {
      units: s.frame.units,
      up: s.frame.up,
      origin: s.frame.origin,
      z0: s.frame.z0,
      note: "X right and Y up seen from the top; z = 0 on the board's bottom face, the top face at z = thicknessMm; a component's transform maps its footprint frame (z up from its seating plane) into this frame; bottom-side parts are turned 180 degrees about Y",
      /** Add to a point here to get board document coordinates (mm). */
      toDocument: roundVec(s.frame.toDocument),
    },
    outline: {
      thicknessMm: T,
      outer: s.board.outline[0].map((p) => [r6(p[0]), r6(p[1])]),
      cutouts: s.board.outline.slice(1).map((l) => l.map((p) => [r6(p[0]), r6(p[1])])),
      bounds: roundBounds(s.board.bounds),
      stackup: s.board.stackup,
      colors: s.colors,
    },
    holes: s.board.holes.map((h) => ({ id: h.id, kind: h.kind, at: [r6(h.at[0]), r6(h.at[1])], d: r6(h.d), ...(h.slot ? { slot: { w: r6(h.slot.w), h: r6(h.slot.h), rotationDeg: r6(h.slot.rotationDeg) } } : {}), plated: h.plated, drilled: h.drilled })),
    mountingHoles: s.board.holes.filter((h) => h.kind === "mounting" || h.kind === "unplated").map((h) => ({ id: h.id, at: [r6(h.at[0]), r6(h.at[1])], d: r6(h.d), plated: h.plated })),
    counts: {
      bodies: bodyCount(s),
      components: comps.length,
      withBody: comps.filter((c) => c.solid).length,
      bySource,
      renderSolids: s.layers.reduce((a, l) => a + l.solids.length, 0),
      ...(input.stepSolids !== undefined ? { stepSolids: input.stepSolids } : {}),
    },
    components: comps.map((c) => component(c, input.names, T)),
    interfaces: comps.flatMap((c) => c.interfaces.map((i) => ({ component: c.id, ref: c.ref, kind: i.kind, origin: roundVec(i.world.origin), zAxis: roundVec(i.world.zAxis), xAxis: roundVec(i.world.xAxis), ...(i.size ? { sizeMm: i.size.map(r6) } : {}) }))),
    ...(s.heightMap ? { heightMap: { ...s.heightMap, note: "per side, the tallest part over each cell (part bounding boxes), mm above the face; row-major from origin, x first" } } : {}),
    ...(s.slabs.length ? { slabs: s.slabs.map((x) => ({ side: x.side, heightMm: r6(x.heightMm) })) } : {}),
    findings: s.findings,
    terms: {
      distribution: restricted.length ? "internal" : unknown ? "unknown" : "redistributable",
      note: restricted.length || unknown ? "bodies from supplied models carry their files' terms; the export inherits the most restrictive" : "every body was made in code from the board: no third-party geometry",
      restricted,
    },
    files: input.files,
    images: input.images,
    ...(input.validation ? { validation: input.validation } : {}),
    ...(input.timing ? { timing: input.timing } : {}),
  };
}

export type Sidecar = ReturnType<typeof buildSidecar>;
