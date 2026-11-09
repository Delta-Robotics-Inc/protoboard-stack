/**
 * Validation after writing: each file is read back (STL, 3MF, GLB and STEP by this package's own readers; STEP also by
 * OCCT through the CAD runtime when it is installed), its solids or objects counted against what the tier should give,
 * its names and bounding box compared with the scene, and every component checked for overlap with the board body.
 */
import { pointInPolygon } from "./profile.js";
import { apply, emptyBounds, growBounds, type Bounds, type Vec3 } from "./math.js";
import { findCadPython, runCadPython } from "./python.js";
import { bodyCount, exportedComponents, type Board3d } from "./scene.js";
import { readZip } from "./writers/zip.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface FileValidation {
  format: string;
  path: string;
  reader: string;
  checks: Check[];
  ok: boolean;
}

// ------------------------------------------------------------------ readers

export function readStl(buf: Uint8Array): { triangles: number; bounds: Bounds } {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = b.readUInt32LE(80);
  if (84 + n * 50 !== b.length) throw new Error(`STL size ${b.length} does not match ${n} triangles`);
  const bounds = emptyBounds();
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) growBounds(bounds, [b.readFloatLE(84 + t * 50 + 12 + k * 12), b.readFloatLE(84 + t * 50 + 16 + k * 12), b.readFloatLE(84 + t * 50 + 20 + k * 12)]);
  return { triangles: n, bounds };
}

export function read3mf(buf: Uint8Array): { objects: { name: string; vertices: number; triangles: number }[]; items: number; colors: string[]; bounds: Bounds; unit: string } {
  const entries = readZip(buf);
  const model = entries.find((e) => e.name === "3D/3dmodel.model");
  if (!model) throw new Error("3MF without 3D/3dmodel.model");
  if (!entries.some((e) => e.name === "[Content_Types].xml") || !entries.some((e) => e.name === "_rels/.rels")) throw new Error("3MF package parts missing");
  const xml = Buffer.from(model.data).toString("utf8");
  const unit = /<model[^>]*unit="([^"]+)"/.exec(xml)?.[1] ?? "millimeter";
  const objects: { name: string; vertices: number; triangles: number }[] = [];
  const bounds = emptyBounds();
  for (const m of xml.matchAll(/<object id="(\d+)" name="([^"]*)"[^>]*>([\s\S]*?)<\/object>/g)) {
    const body = m[3];
    let vertices = 0;
    for (const v of body.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)) {
      growBounds(bounds, [Number(v[1]), Number(v[2]), Number(v[3])]);
      vertices++;
    }
    const triangles = (body.match(/<triangle /g) ?? []).length;
    objects.push({ name: m[2].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), vertices, triangles });
  }
  const colors = [...xml.matchAll(/displaycolor="(#[0-9A-Fa-f]{6,8})"/g)].map((m) => m[1]);
  const items = (xml.match(/<item /g) ?? []).length;
  return { objects, items, colors, bounds, unit };
}

interface GltfNode {
  name?: string;
  mesh?: number;
  matrix?: number[];
  children?: number[];
  extras?: { protoboard?: Record<string, unknown> };
}
export function readGlb(buf: Uint8Array): { nodes: GltfNode[]; components: { name: string; partInstanceId: string; refdes?: string; placeholder?: boolean }[]; materials: number; boundsMm: Bounds } {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  const jlen = b.readUInt32LE(12);
  const gltf = JSON.parse(b.toString("utf8", 20, 20 + jlen)) as { nodes: GltfNode[]; meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { min?: number[]; max?: number[] }[]; materials?: unknown[]; scenes: { nodes: number[] }[] };
  const root = gltf.nodes[gltf.scenes[0].nodes[0]];
  const comps = (root.children ?? []).map((i) => gltf.nodes[i]).filter((n) => n.extras?.protoboard && typeof n.extras.protoboard.partInstanceId === "string");
  // bounds in the board frame: undo the root's meters and Y-up
  const boundsMm = emptyBounds();
  const mul = (a: number[], c: number[]) => {
    const r = new Array<number>(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * c[j * 4 + k];
    return r;
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const walk = (ni: number, parent: number[]) => {
    const n = gltf.nodes[ni];
    const m = mul(parent, n.matrix ?? I);
    if (n.mesh !== undefined) {
      for (const p of gltf.meshes[n.mesh].primitives) {
        const a = gltf.accessors[p.attributes.POSITION];
        if (!a.min || !a.max) continue;
        for (const x of [a.min[0], a.max[0]]) for (const y of [a.min[1], a.max[1]]) for (const z of [a.min[2], a.max[2]]) {
          const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
          // glTF meters Y up -> board mm Z up: (x, -z, y) * 1000
          growBounds(boundsMm, [w[0] * 1000, -w[2] * 1000, w[1] * 1000]);
        }
      }
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  walk(gltf.scenes[0].nodes[0], I);
  return {
    nodes: gltf.nodes,
    components: comps.map((n) => ({ name: n.name ?? "", partInstanceId: String(n.extras!.protoboard!.partInstanceId), ...(n.extras!.protoboard!.refdes ? { refdes: String(n.extras!.protoboard!.refdes) } : {}), ...(n.extras!.protoboard!.placeholder ? { placeholder: true } : {}) })),
    materials: gltf.materials?.length ?? 0,
    boundsMm,
  };
}

/** A light STEP reader: entity counts, product names, occurrences and solid instances through the assembly. */
export function readStepText(text: string): { schema: string; products: string[]; occurrences: string[]; solidEntities: number; solidInstances: number; colors: number; entities: number } {
  const schema = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/.exec(text)?.[1] ?? "";
  const ent = new Map<number, { type: string; args: string }>();
  for (const m of text.matchAll(/#(\d+)\s*=\s*([A-Z0-9_]+)?\s*\(([\s\S]*?)\);\s*(?=#\d+\s*=|ENDSEC)/g)) ent.set(Number(m[1]), { type: m[2] ?? "(complex)", args: m[3] });
  const strs = (args: string) =>
    [...args.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
      m[1]
        .replace(/''/g, "'")
        .replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/g, (_, h: string) => String.fromCharCode(...(h.match(/.{4}/g) ?? []).map((x) => parseInt(x, 16))))
        .replace(/\\\\/g, "\\"),
    );
  const refs = (args: string) => [...args.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  const products: string[] = [];
  const occurrences: string[] = [];
  let solidEntities = 0;
  let colors = 0;
  const pdOfPds = new Map<number, number>();
  const repOfPd = new Map<number, number>();
  const solidsOfRep = new Map<number, number>();
  const nauo: { parent: number; child: number }[] = [];
  for (const [id, e] of ent) {
    if (e.type === "PRODUCT") products.push(strs(e.args)[1] ?? "");
    else if (e.type === "MANIFOLD_SOLID_BREP") solidEntities++;
    else if (e.type === "COLOUR_RGB") colors++;
    else if (e.type === "PRODUCT_DEFINITION_SHAPE") {
      const r = refs(e.args);
      if (r.length) pdOfPds.set(id, r[0]);
    } else if (e.type === "NEXT_ASSEMBLY_USAGE_OCCURRENCE") {
      occurrences.push(strs(e.args)[1] ?? "");
      const r = refs(e.args);
      nauo.push({ parent: r[0], child: r[1] });
    } else if (e.type === "ADVANCED_BREP_SHAPE_REPRESENTATION" || e.type === "SHAPE_REPRESENTATION") {
      solidsOfRep.set(id, refs(e.args).filter((r) => ent.get(r)?.type === "MANIFOLD_SOLID_BREP").length);
    }
  }
  for (const e of ent.values()) {
    if (e.type !== "SHAPE_DEFINITION_REPRESENTATION") continue;
    const [pds, rep] = refs(e.args);
    const pd = pdOfPds.get(pds);
    if (pd !== undefined) repOfPd.set(pd, rep);
  }
  const children = new Map<number, number[]>();
  for (const n of nauo) children.set(n.parent, [...(children.get(n.parent) ?? []), n.child]);
  const childSet = new Set(nauo.map((n) => n.child));
  const count = (pd: number, depth = 0): number => (depth > 20 ? 0 : (solidsOfRep.get(repOfPd.get(pd) ?? -1) ?? 0) + (children.get(pd) ?? []).reduce((a, c) => a + count(c, depth + 1), 0));
  let solidInstances = 0;
  for (const pd of repOfPd.keys()) if (!childSet.has(pd)) solidInstances += count(pd);
  return { schema, products, occurrences, solidEntities, solidInstances, colors, entities: ent.size };
}

// ------------------------------------------------------------------ checks

const near = (a: Bounds, b: Bounds, tol: number) => [0, 1, 2].every((i) => Math.abs(a.min[i] - b.min[i]) <= tol && Math.abs(a.max[i] - b.max[i]) <= tol);
const fmtB = (b: Bounds) => `[${b.min.map((v) => v.toFixed(3)).join(", ")}] to [${b.max.map((v) => v.toFixed(3)).join(", ")}]`;

/** Bounds of everything a scene writes (its meshes, placed). */
export function sceneBounds(scene: Board3d): Bounds {
  const b = emptyBounds();
  const add = (pos: number[], m?: number[]) => {
    for (let i = 0; i < pos.length; i += 3) growBounds(b, m ? apply(m, [pos[i], pos[i + 1], pos[i + 2]]) : [pos[i], pos[i + 1], pos[i + 2]]);
  };
  add(scene.board.solid.mesh.pos);
  for (const c of exportedComponents(scene)) add(c.solid!.mesh.pos, c.transform);
  for (const s of scene.slabs) add(s.solid.mesh.pos);
  for (const l of scene.layers) for (const s of l.solids) add(s.mesh.pos);
  return b;
}

/** Expected solids in a STEP file of this scene: the mechanical bodies plus every render solid. */
export const expectedSolids = (scene: Board3d) => bodyCount(scene) + scene.layers.reduce((a, l) => a + l.solids.length, 0);
/** Expected objects in a mesh file: mechanical bodies plus one per render layer. */
export const expectedObjects = (scene: Board3d) => bodyCount(scene) + scene.layers.length;

/**
 * Components whose body reaches into the board volume (by more than `tol` mm): any body vertex strictly inside the
 * board slab, inside the outline and not in a drilled hole. A vertex test, exact for the box-like bodies made here;
 * OCCT's boolean check (validateStep with intersect) covers curved model geometry.
 */
export function boardIntersections(scene: Board3d, tol = 0.01): { ref: string; id: string; depthMm: number }[] {
  const T = scene.board.thicknessMm;
  const outer = scene.board.outline[0];
  const cuts = scene.board.outline.slice(1);
  const holes = scene.board.holes.filter((h) => h.drilled);
  const inHole = (x: number, y: number) =>
    holes.some((h) => {
      if (!h.slot) return Math.hypot(x - h.at[0], y - h.at[1]) < h.d / 2 - 1e-6;
      const a = (-h.slot.rotationDeg * Math.PI) / 180;
      const lx = (x - h.at[0]) * Math.cos(a) - (y - h.at[1]) * Math.sin(a);
      const ly = (x - h.at[0]) * Math.sin(a) + (y - h.at[1]) * Math.cos(a);
      const r = Math.min(h.slot.w, h.slot.h) / 2;
      const ex = Math.max(0, Math.abs(lx) - (h.slot.w / 2 - r));
      const ey = Math.max(0, Math.abs(ly) - (h.slot.h / 2 - r));
      return Math.hypot(ex, ey) < r - 1e-6;
    });
  const out: { ref: string; id: string; depthMm: number }[] = [];
  for (const c of exportedComponents(scene)) {
    let depth = 0;
    const p = c.solid!.mesh.pos;
    const seen = new Set<string>();
    for (let i = 0; i < p.length; i += 3) {
      const key = `${p[i]},${p[i + 1]},${p[i + 2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const q: Vec3 = apply(c.transform, [p[i], p[i + 1], p[i + 2]]);
      if (q[2] <= tol || q[2] >= T - tol) continue;
      if (!pointInPolygon([q[0], q[1]], outer) || cuts.some((cp) => pointInPolygon([q[0], q[1]], cp)) || inHole(q[0], q[1])) continue;
      depth = Math.max(depth, Math.min(q[2], T - q[2]));
    }
    if (depth > 0) out.push({ ref: c.ref, id: c.id, depthMm: Math.round(depth * 1e4) / 1e4 });
  }
  return out;
}

export interface OcctInspect {
  solids: number;
  faces: number;
  invalid: number;
  colors: string[];
  bbox?: [Vec3, Vec3];
  roots: string[];
  components: { occurrence: string; product: string; solids: number; color: string | null; bbox: [Vec3, Vec3] | null; invalid: number }[];
  intersections?: { occurrence: string; volume: number }[];
  readSeconds: number;
  intersectSeconds?: number;
  seconds: number;
}

/** Validate one written file. `python` (the CAD runtime) adds OCCT's reading of a STEP file. */
export async function validateFile(scene: Board3d, format: string, path: string, data: Uint8Array, options: { python?: string; intersect?: boolean } = {}): Promise<FileValidation> {
  const checks: Check[] = [];
  const sb = sceneBounds(scene);
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  let reader = "board-3d";
  const names = exportedComponents(scene).map((c) => c.name);
  const mainColors = new Set([scene.board.solid.palette[0], ...exportedComponents(scene).map((c) => c.solid!.palette[0]), ...scene.slabs.map((x) => x.solid.palette[0])]).size;
  try {
    if (format === "stl") {
      const r = readStl(data);
      const tris = scene.board.solid.mesh.pos.length / 9 + exportedComponents(scene).reduce((a, c) => a + c.solid!.mesh.pos.length / 9, 0) + scene.slabs.reduce((a, s) => a + s.solid.mesh.pos.length / 9, 0) + scene.layers.reduce((a, l) => a + l.solids.reduce((x, s) => x + s.mesh.pos.length / 9, 0), 0);
      add("triangles", r.triangles === tris, `${r.triangles} read, ${tris} written`);
      add("bounding box", near(r.bounds, sb, 1e-3), `read ${fmtB(r.bounds)}; scene ${fmtB(sb)}`);
    } else if (format === "stl-zip") {
      const entries = readZip(data);
      const stls = entries.filter((e) => e.name.endsWith(".stl"));
      add("bodies", stls.length === expectedObjects(scene), `${stls.length} STL files, ${expectedObjects(scene)} expected`);
      const b = emptyBounds();
      for (const e of stls) {
        const r = readStl(e.data);
        growBounds(b, r.bounds.min);
        growBounds(b, r.bounds.max);
      }
      add("bounding box", near(b, sb, 1e-3), `read ${fmtB(b)}; scene ${fmtB(sb)}`);
      add("names", names.every((n) => entries.some((e) => e.name.startsWith(n.replace(/[<>:"/\\|?*]/g, "_")))), "every component has its own file");
    } else if (format === "3mf") {
      const r = read3mf(data);
      add("objects", r.objects.length === expectedObjects(scene) && r.items === r.objects.length, `${r.objects.length} objects, ${r.items} build items, ${expectedObjects(scene)} expected`);
      add("names", names.every((n) => r.objects.some((o) => o.name === n)), "every component is a named object");
      add("colors", r.colors.length >= mainColors, `${r.colors.length} base colors, at least ${mainColors} expected`);
      add("units", r.unit === "millimeter", r.unit);
      add("bounding box", near(r.bounds, sb, 1e-4), `read ${fmtB(r.bounds)}; scene ${fmtB(sb)}`);
    } else if (format === "glb") {
      const r = readGlb(data);
      const withBody = exportedComponents(scene);
      add("component nodes", r.components.length === withBody.length, `${r.components.length} nodes with a partInstanceId, ${withBody.length} expected`);
      add("ids", withBody.every((c) => r.components.some((n) => n.partInstanceId === (c.path ?? c.ref) && n.refdes === c.ref)), "every component node carries its instance path and refdes");
      add("bounding box", near(r.boundsMm, sb, 1e-3), `read ${fmtB(r.boundsMm)}; scene ${fmtB(sb)}`);
    } else if (format === "step") {
      const text = Buffer.from(data).toString("utf8");
      const r = readStepText(text);
      add("schema", r.schema.startsWith("AUTOMOTIVE_DESIGN"), r.schema);
      add("solids (text)", r.solidInstances === expectedSolids(scene), `${r.solidInstances} solid instances (${r.solidEntities} MANIFOLD_SOLID_BREP), ${expectedSolids(scene)} expected`);
      add("names (text)", names.every((n) => r.occurrences.includes(n)), "every component is a named occurrence");
      if (options.python) {
        reader = "board-3d + OCCT";
        const o = await runCadPython<OcctInspect>(options.python, ["inspect", path, ...(options.intersect ? ["--intersect"] : [])]);
        add("solids (OCCT)", o.solids === expectedSolids(scene), `${o.solids} solids read by OCCT, ${expectedSolids(scene)} expected`);
        add("valid B-rep (OCCT)", o.invalid === 0, `${o.invalid} invalid solids`);
        add("names (OCCT)", names.every((n) => o.components.some((c) => c.occurrence === n || c.product === n)), `${o.components.length} components`);
        add("colors (OCCT)", o.colors.length >= Math.min(mainColors, 2), `${o.colors.length} distinct colors read, ${mainColors} main colors written`);
        if (o.bbox) {
          const ob: Bounds = { min: o.bbox[0], max: o.bbox[1] };
          add("bounding box (OCCT)", near(ob, sb, 0.02), `read ${fmtB(ob)}; scene ${fmtB(sb)}`);
        }
        if (o.intersections) add("no overlap with the board (OCCT)", o.intersections.length === 0, o.intersections.length ? o.intersections.map((x) => `${x.occurrence} ${x.volume} mm3`).join(", ") : `none (${o.intersectSeconds} s)`);
        add("read time (OCCT)", true, `${o.readSeconds} s to read, ${o.seconds} s in all`);
      }
    }
  } catch (e) {
    add("read", false, (e as Error).message);
  }
  return { format, path, reader, checks, ok: checks.every((c) => c.ok) };
}

export { findCadPython };
