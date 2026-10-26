/**
 * Component bodies for board.glb and board.step. In order of preference:
 *
 *   1. the part's own UHD body artifact (STEP), placed on its footprint by the
 *      part's mounting frame (the face that meets the board), without the
 *      interface feature shapes UHD bodies carry (see stepfile.ts)
 *   2. a box from the part's package body facts (UHD `dimensions_mm`),
 *      written here as a small STEP solid
 *   3. nothing from us: tscircuit's own generated body for built-in
 *      footprints, or no body (reported)
 *
 * The models are set on the built circuit JSON (cad_component) just before
 * the 3D exporters run, so the native source never carries model paths.
 */
import { join, relative, sep } from "node:path";
import type { BoardComponent, Project } from "@protoboardai/core";
import type { CircuitElement } from "./runtime.ts";
import type { NameMap } from "./source.ts";

export type BodySource = "part" | "box" | "tscircuit" | "none";

export interface ComponentBody {
  instance: string;
  source: BodySource;
  /** Absolute path of the STEP model used. */
  step?: string;
  /** Machine-independent name of the model, for outputs: `<part>#<artifact>`, or the box's project-relative path. */
  label?: string;
  /** Artifact id when the part's own body was used. */
  artifact?: string;
  /** Project-relative path of a generated box model, when one is needed. */
  box?: { path: string; size: [number, number, number] };
  /** Named sub-shapes to strip from the part's STEP: the part's interface ids (UHD feature shapes). */
  strip?: string[];
  /** Project-relative path of the stripped copy, when stripping removes anything. */
  stripped?: string;
  /** Mount origin offset in the model's own frame (mm), applied on placement. */
  mountOrigin?: [number, number, number];
  /**
   * A mesh body (GLB or OBJ) for a part with no STEP artifact: board.glb uses it, board.step
   * the package box when the part states its size. `units` is the file's ("m" for UHD GLBs,
   * which are glTF metres, +Y up).
   */
  mesh?: { format: "glb" | "obj"; path: string; label: string; units?: string; mount?: [number, number, number] };
}

/** Choose the body for each component. Box models and stripped copies are named here; writing them is the caller's. */
export function chooseBodies(p: Project, components: BoardComponent[], nativeDir: string): ComponentBody[] {
  return components.map((c) => {
    for (const b of c.bodies) {
      if (b.format !== "step") continue;
      const art = p.artifacts.find((a) => a.definition === c.part && a.id === b.artifact);
      if (art?.resolved && art.present === true) {
        const strip = (p.lookup(c.part)?.interfaces ?? []).map((i) => i.id);
        return { instance: c.instance, source: "part", step: art.resolved, label: `${c.part}#${b.artifact}`, artifact: b.artifact, strip, stripped: `${nativeDir}/models/${c.part}-${b.artifact}.step`, ...(b.mount ? { mountOrigin: b.mount.origin } : {}) };
      }
    }
    // no STEP: a GLB or OBJ body for board.glb (board.step falls back to the package box)
    let mesh: ComponentBody["mesh"];
    for (const b of c.bodies) {
      if (b.format !== "glb" && b.format !== "obj") continue;
      const art = p.artifacts.find((a) => a.definition === c.part && a.id === b.artifact);
      if (art?.resolved && art.present === true) {
        mesh = { format: b.format, path: art.resolved, label: `${c.part}#${b.artifact}`, ...(b.units ? { units: b.units } : {}), ...(b.mount ? { mount: b.mount.origin } : {}) };
        break;
      }
    }
    const s = c.package?.size_mm;
    if (s?.length && s.width && s.height) {
      const size: [number, number, number] = [s.length, s.width, s.height];
      const path = `${nativeDir}/models/box-${size.join("x")}.step`;
      return { instance: c.instance, source: mesh ? "part" : "box", label: path, box: { path, size }, ...(mesh ? { mesh, artifact: mesh.label.split("#")[1] } : {}) };
    }
    return mesh ? { instance: c.instance, source: "part", mesh, artifact: mesh.label.split("#")[1] } : { instance: c.instance, source: "none" };
  });
}

/**
 * Point each component's cad_component at its chosen model. Returns the
 * patched circuit JSON (a copy), per instance what was used, and the label
 * of each model file (absolute path → label) for outputs that name models.
 *
 * A cad_component's position is where the model's own origin goes: the
 * footprint origin on the board surface (z = ±thickness/2), moved by the
 * part's mount origin when it has one.
 */
export function applyBodies(cj: CircuitElement[], map: NameMap, bodies: ComponentBody[], root: string): { circuitJson: CircuitElement[]; used: Record<string, BodySource>; labels: Record<string, string> } {
  const out = cj.map((e) => ({ ...e }));
  const byInstance = new Map(bodies.map((b) => [b.instance, b]));
  const sources = new Map(out.filter((e) => e.type === "source_component").map((s) => [s.source_component_id, s]));
  const pcbOf = new Map(out.filter((e) => e.type === "pcb_component").map((c) => [c.pcb_component_id, c]));
  const used: Record<string, BodySource> = {};
  const labels: Record<string, string> = {};
  for (const cad of out.filter((e) => e.type === "cad_component")) {
    const name = sources.get(cad.source_component_id)?.name as string | undefined;
    const m = name ? map.components[name] : undefined;
    if (!m) continue;
    const body = byInstance.get(m.instance);
    const step = body?.step ?? (body?.box ? `${root}/${body.box.path}` : undefined);
    if (!body || (!step && !body.mesh)) {
      used[m.instance] = cad.model_jscad || cad.footprinter_string || cad.model_step_url || cad.model_glb_url ? "tscircuit" : "none";
      continue;
    }
    for (const k of ["model_obj_url", "model_stl_url", "model_glb_url", "model_gltf_url", "model_wrl_url", "model_jscad", "footprinter_string", "model_step_url"]) delete cad[k];
    // a mesh with no size to box: board.glb draws the mesh (withMeshes), board.step has no body for it
    if (step) {
      cad.model_step_url = step;
      labels[step] = body.label ?? body.box?.path ?? body.instance;
    }
    cad.show_as_bounding_box = false;
    // tscircuit puts a cad_component at the pads' bounding-box centre and infers the model's origin from
    // its contact faces; both differ from the footprint origin for a part whose pads are not centred on
    // it (a module with its antenna end bare, a USB-C receptacle). The model's own origin (its mounting
    // point, or the box's bottom centre) goes to the footprint origin instead, stated explicitly: where
    // tscircuit placed it (pcbX/pcbY), else the pads' centre less their offset from the origin.
    cad.model_origin_position = { x: 0, y: 0, z: 0 };
    const pcb = pcbOf.get(cad.pcb_component_id);
    if (pcb && typeof pcb.display_offset_x === "number" && typeof pcb.display_offset_y === "number") cad.position = { ...cad.position, x: pcb.display_offset_x, y: pcb.display_offset_y };
    else if (m.padCentre) {
      const a = ((cad.rotation?.z ?? 0) * Math.PI) / 180;
      const flip = (cad.position?.z ?? 0) < 0 ? -1 : 1;
      const [cx, cy] = [m.padCentre[0] * flip, m.padCentre[1]];
      cad.position = { ...cad.position, x: cad.position.x - (cx * Math.cos(a) - cy * Math.sin(a)), y: cad.position.y - (cx * Math.sin(a) + cy * Math.cos(a)) };
    }
    const o = body.step ? body.mountOrigin : undefined;
    if (o && (o[0] || o[1] || o[2])) {
      // the model's mount point goes to the footprint origin on the board surface
      const a = ((cad.rotation?.z ?? 0) * Math.PI) / 180;
      const flip = (cad.position?.z ?? 0) < 0 ? -1 : 1;
      cad.position = { x: cad.position.x - (o[0] * Math.cos(a) - o[1] * Math.sin(a)) * flip, y: cad.position.y - (o[0] * Math.sin(a) + o[1] * Math.cos(a)), z: cad.position.z - o[2] * flip };
    }
    used[m.instance] = body.source;
  }
  return { circuitJson: out, used, labels };
}

/**
 * A rectangular body as an ISO 10303-21 (AP214) solid: length along X, width
 * along Y, height up +Z from z = 0, centred on the origin in X and Y (the
 * face at z = 0 is the one that sits on the board).
 */
export function boxStep(name: string, [l, w, h]: [number, number, number]): string {
  const lines: string[] = [];
  let id = 0;
  const add = (s: string) => {
    lines.push(`#${++id}=${s};`);
    return `#${id}`;
  };
  const f = (v: number) => {
    const s = (Math.round(v * 1e6) / 1e6).toString();
    return s.includes(".") || s.includes("e") ? s.toUpperCase() : `${s}.`;
  };
  const pt = (p: number[]) => add(`CARTESIAN_POINT('',(${p.map(f).join(",")}))`);
  const dir = (d: number[]) => add(`DIRECTION('',(${d.map(f).join(",")}))`);

  const ctx = add("APPLICATION_CONTEXT('automotive design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctx})`);
  const pctx = add(`PRODUCT_CONTEXT('',${ctx},'mechanical')`);
  const product = add(`PRODUCT('${name}','${name}','',(${pctx}))`);
  const formation = add(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const dctx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctx},'design')`);
  const pdef = add(`PRODUCT_DEFINITION('design','',${formation},${dctx})`);
  const shape = add(`PRODUCT_DEFINITION_SHAPE('','',${pdef})`);
  const len = add("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))");
  const ang = add("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))");
  const sol = add("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())");
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${len},'distance_accuracy_value','confusion accuracy')`);
  const gctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${len},${ang},${sol})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);

  // vertices: index = x + 2y + 4z over the box corners
  const corner = (i: number) => [(i & 1 ? 0.5 : -0.5) * l, (i & 2 ? 0.5 : -0.5) * w, i & 4 ? h : 0];
  const vertex = Array.from({ length: 8 }, (_, i) => add(`VERTEX_POINT('',${pt(corner(i))})`));
  const edges = new Map<string, string>();
  const edge = (a: number, b: number): { ref: string; forward: boolean } => {
    const [s, e] = a < b ? [a, b] : [b, a];
    const key = `${s}-${e}`;
    if (!edges.has(key)) {
      const ps = corner(s);
      const pe = corner(e);
      const d = pe.map((v, k) => v - ps[k]);
      const n = Math.hypot(...d);
      const line = add(`LINE('',${pt(ps)},${add(`VECTOR('',${dir(d.map((v) => v / n))},${f(n)})`)})`);
      edges.set(key, add(`EDGE_CURVE('',${vertex[s]},${vertex[e]},${line},.T.)`));
    }
    return { ref: edges.get(key)!, forward: a < b };
  };
  // faces: corners counter-clockwise seen from outside, with the outward normal
  const faces: [number[], number[], number[]][] = [
    [[0, 2, 3, 1], [0, 0, -1], [1, 0, 0]],
    [[4, 5, 7, 6], [0, 0, 1], [1, 0, 0]],
    [[0, 1, 5, 4], [0, -1, 0], [1, 0, 0]],
    [[2, 6, 7, 3], [0, 1, 0], [-1, 0, 0]],
    [[0, 4, 6, 2], [-1, 0, 0], [0, 1, 0]],
    [[1, 3, 7, 5], [1, 0, 0], [0, -1, 0]],
  ];
  const faceRefs = faces.map(([loop, normal, ref]) => {
    const oriented = loop.map((a, i) => {
      const e = edge(a, loop[(i + 1) % 4]);
      return add(`ORIENTED_EDGE('',*,*,${e.ref},${e.forward ? ".T." : ".F."})`);
    });
    const bound = add(`FACE_OUTER_BOUND('',${add(`EDGE_LOOP('',(${oriented.join(",")}))`)},.T.)`);
    const plane = add(`PLANE('',${add(`AXIS2_PLACEMENT_3D('',${pt(corner(loop[0]))},${dir(normal)},${dir(ref)})`)})`);
    return add(`ADVANCED_FACE('',(${bound}),${plane},.T.)`);
  });
  const solid = add(`MANIFOLD_SOLID_BREP('${name}',${add(`CLOSED_SHELL('',(${faceRefs.join(",")}))`)})`);
  const axis = add(`AXIS2_PLACEMENT_3D('',${pt([0, 0, 0])},${dir([0, 0, 1])},${dir([1, 0, 0])})`);
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('${name}',(${axis},${solid}),${gctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${rep})`);

  return [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('${name}: box from package body facts'),'2;1');`,
    `FILE_NAME('${name}.step','1970-01-01T00:00:00',(''),(''),'@protoboardai/ext-tscircuit','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

/**
 * board.glb's copy of the bodied circuit JSON: a component whose body is a mesh (a part with a GLB
 * or OBJ body and no STEP) gets the mesh instead of its package box. A UHD GLB is glTF: metres,
 * +Y up, so it is scaled to millimetres and its +Y is the board normal; the part's mount origin
 * (mm, part frame) goes to the footprint origin as for a STEP body.
 */
export function withMeshes(cj: CircuitElement[], map: NameMap, bodies: ComponentBody[]): CircuitElement[] {
  const byInstance = new Map(bodies.map((b) => [b.instance, b]));
  const sources = new Map(cj.filter((e) => e.type === "source_component").map((s) => [s.source_component_id, s.name as string]));
  return cj.map((e) => {
    if (e.type !== "cad_component") return e;
    const mesh = byInstance.get(map.components[sources.get(e.source_component_id) ?? ""]?.instance ?? "")?.mesh;
    if (!mesh) return e;
    const { model_step_url: _step, ...rest } = e;
    const metres = mesh.units === "m" || (mesh.format === "glb" && mesh.units === undefined);
    const out: CircuitElement = { ...rest, [mesh.format === "glb" ? "model_glb_url" : "model_obj_url"]: mesh.path, model_unit_to_mm_scale_factor: metres ? 1000 : 1, ...(mesh.format === "glb" ? { model_board_normal_direction: "y+" } : {}), model_origin_position: { x: 0, y: 0, z: 0 }, show_as_bounding_box: false };
    const o = mesh.mount;
    if (o && (o[0] || o[1] || o[2])) {
      const a = ((e.rotation?.z ?? 0) * Math.PI) / 180;
      const flip = (e.position?.z ?? 0) < 0 ? -1 : 1;
      out.position = { x: e.position.x - (o[0] * Math.cos(a) - o[1] * Math.sin(a)) * flip, y: e.position.y - (o[0] * Math.sin(a) + o[1] * Math.cos(a)), z: e.position.z - o[2] * flip };
    }
    return out;
  });
}

/** A tscircuit `cadModel` prop: the model file relative to the board's source folder, and how it sits on the board. */
export interface CadModelProp {
  stepUrl?: string;
  glbUrl?: string;
  objUrl?: string;
  modelOriginPosition?: { x: number; y: number; z: number };
  modelUnitToMmScale?: number;
  modelBoardNormalDirection?: "y+";
}

/**
 * The `cadModel` generate writes for each component whose part has a body artifact: the STEP
 * (the stripped copy in models/ when stripping removed anything), else the GLB or OBJ. Paths are
 * relative to the native folder with forward slashes, so they mean the same on every OS and on
 * every machine; the provider's exports resolve them against that folder (and set absolute paths
 * on a copy of the circuit JSON, applyBodies). Package boxes are export's own and not written here.
 */
export function cadModels(root: string, nativeDir: string, bodies: ComponentBody[]): Record<string, CadModelProp> {
  const rel = (abs: string) => {
    const r = relative(join(root, nativeDir), abs).split(sep).join("/");
    return r.startsWith(".") ? r : `./${r}`;
  };
  const origin = (o?: [number, number, number]) => (o && (o[0] || o[1] || o[2]) ? { modelOriginPosition: { x: o[0], y: o[1], z: o[2] } } : {});
  const out: Record<string, CadModelProp> = {};
  for (const b of bodies) {
    if (b.source !== "part") continue;
    if (b.step) out[b.instance] = { stepUrl: rel(b.step), ...origin(b.mountOrigin) };
    else if (b.mesh) {
      const metres = b.mesh.units === "m" || (b.mesh.format === "glb" && b.mesh.units === undefined);
      out[b.instance] = { [b.mesh.format === "glb" ? "glbUrl" : "objUrl"]: rel(b.mesh.path), ...origin(b.mesh.mount), ...(metres ? { modelUnitToMmScale: 1000 } : {}), ...(b.mesh.format === "glb" ? { modelBoardNormalDirection: "y+" as const } : {}) };
    }
  }
  return out;
}
