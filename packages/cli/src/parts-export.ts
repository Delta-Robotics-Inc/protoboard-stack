/**
 * `protoboard parts export <part | instance> --format step|stl|3mf|glb [--out <file or folder>] [--from glb|step]`
 * (PB-1191): a part's body as a file for another tool: a slicer, BumpMesh (a print variant), ScanRuler (a
 * reference to compare a scan with), a colleague's CAD.
 *
 * Where the body comes from (core part-files.ts, the one model resolver; core view-model):
 *   - a part or instance with a body of its own: the resolver's GLB and STEP (`resolvePartFile`, as `parts models`
 *     and the build use). Never the view sidecar: `X.view.glb` is simplified and quantised for display (decision 3,
 *     DEFAULT: simplify for display only in the view sidecar), so the exported file is the full-resolution body.
 *   - a component drawn inside its holder's body (a board's U13 in the board's GLB): the holder's full GLB, and the
 *     component's node in it found through the holder's view index (`X.view.json`: instance path to source node name).
 *     Its mesh exports as GLB, STL or 3MF; it has no STEP of its own (DEFAULT: export the holder's STEP for that).
 *
 * Formats:
 *   glb   the body GLB as it is (glTF metres, Y up), or the component's meshes with their placement baked in.
 *   step  the body STEP as it is (mm, Z up).
 *   stl   binary STL, mm, Z up (converted from glTF at this boundary: x, -z, y, times 1000).
 *   3mf   3MF core (unit millimeter, Z up), one object for the whole body, vertices welded across its meshes.
 *   STL and 3MF are made from the full-resolution GLB by default (the build's tessellation, 0.05 mm chordal for
 *   build123d bodies). `--from step` tessellates the STEP again on the CAD runtime at print resolution (DEFAULT
 *   0.01 mm linear, 0.1 rad angular) instead.
 *
 * Output: `--out` (a file, or a folder for `<name>.<format>`), default `.protoboard/exports/<name>.<format>`, and
 * `<name>.export.json` beside it: source file, its sha256, the output's sha256, units, frame and resolution.
 *
 * Security basics: inputs come from the resolver (inside the project or a package), GLBs are size-capped
 * (512 MB) and read as data; a GLB that requires an extension this reader does not know is refused.
 *
 * Registration (`case "export"`, `--from` for parts, `--format` read as the file format here) belongs to W4-D;
 * see phase-1/handoffs.md (2026-11-01, W4-B).
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import {
  fileSlug,
  isViewSidecarFile,
  loadProject,
  modelTable,
  projectRelative,
  resolvePartFile,
  sha256OfFile,
  viewSidecarPaths,
  type Project,
} from "@protoboardai/core";
import { cadRuntimePython, type Out } from "./parts-import-step.js";

export const EXPORT_FORMATS = ["step", "stl", "3mf", "glb"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
/** Same cap as the view sidecars (core view-model MAX_GLB_BYTES). */
export const MAX_EXPORT_GLB_BYTES = 512 * 1024 * 1024;
/** DEFAULT print resolution for `--from step`. */
export const PRINT_LINEAR_MM = 0.01;
export const PRINT_ANGULAR_RAD = 0.1;

export interface ExportFlags {
  format?: string;
  out?: string;
  from?: string;
}

// ---------------------------------------------------------------------------
// GLB: a small reader (float positions, indexed or not) and writer, written here; no glTF code copied
// ---------------------------------------------------------------------------

type M4 = number[];
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a: M4, b: M4): M4 => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function trs(n: GltfNode): M4 {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: unknown;
}
interface Gltf {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  extensionsRequired?: string[];
}

/** One mesh's triangles in world space (glTF metres, Y up). */
export interface WorldMesh {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
}

export function readGlb(file: string): { json: Gltf; bin: Buffer } {
  const size = statSync(file).size;
  if (size > MAX_EXPORT_GLB_BYTES) throw new Error(`${file}: ${size} bytes is over the ${MAX_EXPORT_GLB_BYTES}-byte limit`);
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${basename(file)} is not a GLB`);
  const total = b.readUInt32LE(8);
  let at = 12;
  let json: Gltf | undefined;
  let bin: Buffer = Buffer.alloc(0);
  while (at + 8 <= Math.min(total, b.length)) {
    const len = b.readUInt32LE(at);
    const type = b.readUInt32LE(at + 4);
    const data = b.subarray(at + 8, at + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8")) as Gltf;
    else if (type === 0x004e4942) bin = data;
    at += 8 + len;
  }
  if (!json) throw new Error(`${basename(file)} has no JSON chunk`);
  const unknown = (json.extensionsRequired ?? []).filter(Boolean);
  // security basics: a required extension this reader does not implement is an error, never a guess
  if (unknown.length) throw new Error(`${basename(file)} requires ${unknown.join(", ")}, which parts export does not read (the full-resolution body GLB never does; a view sidecar does)`);
  return { json, bin };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(g: Gltf, bin: Buffer, index: number): Float32Array | Uint32Array {
  const a = g.accessors?.[index];
  if (!a) throw new Error(`accessor ${index} is missing`);
  if (a.sparse) throw new Error(`accessor ${index} is sparse, which parts export does not read`);
  const n = COMPONENTS[a.type];
  if (!n) throw new Error(`accessor ${index} has type ${a.type}`);
  const view = a.bufferView !== undefined ? g.bufferViews?.[a.bufferView] : undefined;
  const base = (view?.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const size: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const cs = size[a.componentType];
  if (!cs) throw new Error(`accessor ${index} has component type ${a.componentType}`);
  const stride = view?.byteStride || cs * n;
  if (view && base + stride * (a.count - 1) + cs * n > (view.byteOffset ?? 0) + view.byteLength) throw new Error(`accessor ${index} runs past its buffer view`);
  if (base + stride * Math.max(0, a.count - 1) + cs * n > bin.length) throw new Error(`accessor ${index} runs past the binary chunk`);
  const out = a.componentType === 5126 ? new Float32Array(a.count * n) : new Uint32Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) {
      const o = base + i * stride + k * cs;
      out[i * n + k] =
        a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : a.componentType === 5121 ? bin.readUInt8(o) : a.componentType === 5122 ? bin.readInt16LE(o) : bin.readInt8(o);
    }
  }
  return out;
}

/** The world-space triangle meshes under the scene, or under the node named `under` (with its placement). */
export function worldMeshes(g: Gltf, bin: Buffer, under?: string): WorldMesh[] {
  const nodes = g.nodes ?? [];
  const roots = g.scenes?.[g.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  const out: WorldMesh[] = [];
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));
  const world = (i: number): M4 => {
    const p = parentOf.get(i);
    return p === undefined ? trs(nodes[i]) : mul(world(p), trs(nodes[i]));
  };
  const visit = (i: number, m: M4, depth: number) => {
    if (depth > 256) throw new Error("node tree deeper than 256 levels");
    const n = nodes[i];
    if (!n) return;
    if (n.mesh !== undefined) {
      const mesh = g.meshes?.[n.mesh];
      for (const prim of mesh?.primitives ?? []) {
        if (prim.mode !== undefined && prim.mode !== 4) continue; // triangles only
        if (prim.attributes.POSITION === undefined) continue;
        const acc = g.accessors?.[prim.attributes.POSITION];
        if (acc?.componentType !== 5126) throw new Error(`${n.name ?? `node ${i}`}: positions are not float32 (a quantised GLB); parts export reads the full-resolution body`);
        const local = readAccessor(g, bin, prim.attributes.POSITION) as Float32Array;
        const pos = new Float32Array(local.length);
        for (let v = 0; v < local.length; v += 3) {
          const x = local[v];
          const y = local[v + 1];
          const z = local[v + 2];
          pos[v] = m[0] * x + m[4] * y + m[8] * z + m[12];
          pos[v + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          pos[v + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        const idx = prim.indices !== undefined ? Uint32Array.from(readAccessor(g, bin, prim.indices)) : Uint32Array.from({ length: local.length / 3 }, (_, k) => k);
        // a mirroring placement flips the winding: keep the faces pointing out
        const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
        if (det < 0) for (let t = 0; t + 2 < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
        out.push({ name: n.name ?? mesh?.name ?? `mesh ${n.mesh}`, positions: pos, indices: idx });
      }
    }
    for (const c of n.children ?? []) visit(c, mul(m, trs(nodes[c])), depth + 1);
  };
  if (under !== undefined) {
    const i = nodes.findIndex((n) => n.name === under);
    if (i < 0) throw new Error(`no node named "${under}" in the GLB`);
    visit(i, world(i), 0);
  } else for (const r of roots) visit(r, trs(nodes[r]), 0);
  return out;
}

/** glTF metres Y-up to mm Z-up (UHD's frame): (x, y, z) m → (1000 x, -1000 z, 1000 y) mm. */
export function toMmZUp(p: Float32Array): Float32Array {
  const o = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    o[i] = p[i] * 1000;
    o[i + 1] = -p[i + 2] * 1000;
    o[i + 2] = p[i + 1] * 1000;
  }
  return o;
}

export function stlBytes(meshes: WorldMesh[]): Buffer {
  const tris = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const b = Buffer.alloc(84 + tris * 50);
  b.write("binary STL from protoboard parts export, mm, Z up", 0, "ascii");
  b.writeUInt32LE(tris, 80);
  let at = 84;
  for (const m of meshes) {
    const p = toMmZUp(m.positions);
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, c, d] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
      const ux = p[c] - p[a], uy = p[c + 1] - p[a + 1], uz = p[c + 2] - p[a + 2];
      const vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const v of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[c], p[c + 1], p[c + 2], p[d], p[d + 1], p[d + 2]]) {
        b.writeFloatLE(v, at);
        at += 4;
      }
      b.writeUInt16LE(0, at);
      at += 2;
    }
  }
  return b;
}

/** A zip of `files` (deflated), as 3MF needs. Written here (no zip dependency). */
export function zipBytes(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(8, 8); // deflate
    h.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00 (fixed: the same body gives the same bytes)
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(packed.length, 18);
    h.writeUInt32LE(f.data.length, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    local.push(h, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0x00210000, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

const xmlAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 3MF core: ONE object for the whole body (a build123d GLB has one primitive per B-rep face, and a slicer would take
 * each object as a separate part), vertices welded across meshes at 1e-5 mm, millimetres, Z up.
 */
export function threeMfBytes(meshes: WorldMesh[], title: string): Buffer {
  const objects: string[] = [];
  const items: string[] = [];
  const key = new Map<string, number>();
  const verts: string[] = [];
  const tris: string[] = [];
  for (const m of meshes) {
    const p = toMmZUp(m.positions);
    const remap = new Uint32Array(p.length / 3);
    for (let v = 0; v < p.length / 3; v++) {
      const x = +p[v * 3].toFixed(5), y = +p[v * 3 + 1].toFixed(5), z = +p[v * 3 + 2].toFixed(5);
      const s = `${x},${y},${z}`;
      let i = key.get(s);
      if (i === undefined) {
        i = verts.length;
        key.set(s, i);
        verts.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
      }
      remap[v] = i;
    }
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = remap[m.indices[t]], b = remap[m.indices[t + 1]], c = remap[m.indices[t + 2]];
      if (a === b || b === c || a === c) continue; // degenerate after welding
      tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
    }
  }
  objects.push(`<object id="1" type="model" name="${xmlAttr(title)}"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`);
  items.push(`<item objectid="1"/>`);
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${xmlAttr(title)}</metadata><metadata name="Application">protoboard parts export</metadata><resources>${objects.join("")}</resources><build>${items.join("")}</build></model>\n`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n`;
  return zipBytes([
    { name: "[Content_Types].xml", data: Buffer.from(types) },
    { name: "_rels/.rels", data: Buffer.from(rels) },
    { name: "3D/3dmodel.model", data: Buffer.from(model) },
  ]);
}

/** A GLB of world-space meshes (glTF metres, Y up), one node per mesh, a neutral material. */
export function glbBytes(meshes: WorldMesh[]): Buffer {
  const parts: Buffer[] = [];
  const views: object[] = [];
  const accessors: object[] = [];
  const gmeshes: object[] = [];
  let off = 0;
  const pushView = (buf: Buffer, target: number) => {
    const pad = (4 - (buf.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, target });
    parts.push(buf, Buffer.alloc(pad));
    off += buf.length + pad;
    return views.length - 1;
  };
  meshes.forEach((m) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], m.positions[i]);
      max[i % 3] = Math.max(max[i % 3], m.positions[i]);
    }
    const pv = pushView(Buffer.from(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength), 34962);
    accessors.push({ bufferView: pv, componentType: 5126, count: m.positions.length / 3, type: "VEC3", min, max });
    const iv = pushView(Buffer.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength), 34963);
    accessors.push({ bufferView: iv, componentType: 5125, count: m.indices.length, type: "SCALAR" });
    gmeshes.push({ name: m.name, primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, material: 0 }] });
  });
  const bin = Buffer.concat(parts);
  const json = {
    asset: { version: "2.0", generator: "protoboard parts export" },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes: gmeshes,
    materials: [{ name: "neutral", pbrMetallicRoughness: { baseColorFactor: [0.55, 0.55, 0.55, 1], metallicFactor: 0.1, roughnessFactor: 0.6 } }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  let jb = Buffer.from(JSON.stringify(json), "utf8");
  jb = Buffer.concat([jb, Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jb.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jb.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jb, bh, bin]);
}

// ---------------------------------------------------------------------------
// What to export
// ---------------------------------------------------------------------------

export interface ExportSource {
  part: string;
  instance?: string;
  /** Absolute paths of the body's own files (absent when it has none). */
  glb?: string;
  step?: string;
  placeholder: boolean;
  /** A component drawn inside a holder's body: the holder's GLB and the node that draws it. */
  inHolder?: { holder: string; holderPart: string; glb: string; node: string; index: string };
}

/** The part (definition id) or instance (path) to export, through the resolver and, for a component, the holder's view index. */
export function exportSource(p: Project, ref: string): ExportSource {
  const inst = p.instances.find((i) => i.path === ref);
  const part = inst?.definition ?? (p.definitions.get(ref) || p.lookup(ref) ? ref : undefined);
  if (!part) throw new Error(`no part or instance "${ref}" in the project (\`protoboard parts models\` lists the drawn instances)`);
  const table = modelTable(p);
  const row = inst ? table.instances.find((e) => e.instance === inst.path) : table.instances.find((e) => e.part === part && !e.drawnBy) ?? table.instances.find((e) => e.part === part);
  if (row?.drawnBy) {
    const holderRow = table.instances.find((e) => e.instance === row.drawnBy);
    if (!holderRow) throw new Error(`${row.instance} is drawn by ${row.drawnBy}, which has no row in the model table`);
    const hg = resolvePartFile(p, { part: holderRow.part, instance: holderRow.instance }, "model", { formats: ["glb"], noPlaceholder: true });
    if (!hg.file || !existsSync(hg.file)) throw new Error(`${row.instance} is drawn inside ${row.drawnBy}'s body, and that body has no GLB on this machine (run its cad:export)`);
    const index = viewSidecarPaths(hg.file).index;
    let node = row.node?.name;
    if (existsSync(index)) {
      if (statSync(index).size > 64 * 1024 * 1024) throw new Error(`${index} is over 64 MB`);
      const ix = JSON.parse(readFileSync(index, "utf8")) as { nodes?: { instancePath?: string; name?: string; id?: string }[] };
      const rel = row.instance.slice(row.drawnBy.length + 1);
      const hit = ix.nodes?.find((n) => n.instancePath === rel || n.id === rel);
      if (hit?.name) node = hit.name;
    }
    if (!node) throw new Error(`${row.instance} is drawn inside ${row.drawnBy}'s body, but nothing names its node there (build first: \`protoboard build\` writes ${projectRelative(p.root, index)})`);
    return { part, instance: row.instance, placeholder: false, inHolder: { holder: row.drawnBy, holderPart: holderRow.part, glb: hg.file, node, index } };
  }
  const ref2 = inst ? { part, instance: inst.path } : part;
  const glb = resolvePartFile(p, ref2, "model", { formats: ["glb"], noPlaceholder: true });
  const step = resolvePartFile(p, ref2, "model", { formats: ["step"], noPlaceholder: true });
  const placeholder = !!row?.placeholder || glb.placeholder;
  return {
    part,
    ...(inst ? { instance: inst.path } : {}),
    ...(glb.file && existsSync(glb.file) && glb.format === "glb" ? { glb: glb.file } : {}),
    ...(step.file && existsSync(step.file) && step.format === "step" ? { step: step.file } : {}),
    placeholder,
  };
}

const PRINT_SCRIPT = [
  // Tessellates a STEP at print resolution on the CAD runtime (build123d): argv = step, out, format, linear mm, angular rad
  "import sys",
  "from build123d import import_step, export_stl, Mesher",
  "src, out, fmt, lin, ang = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5])",
  "shape = import_step(src)",
  "if fmt == 'stl':",
  "    export_stl(shape, out, tolerance=lin, angular_tolerance=ang)",
  "else:",
  "    m = Mesher()",
  "    m.add_shape(shape, linear_deflection=lin, angular_deflection=ang)",
  "    m.write(out)",
].join("\n");

function runPython(python: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) =>
    execFile(python, args, { encoding: "utf8", timeout: 20 * 60 * 1000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, _o, stderr) => (err ? fail(new Error((stderr || err.message).trim().split("\n").pop())) : ok())),
  );
}

export async function partsExport(cwd: string, rest: string[], flags: ExportFlags, out: Out): Promise<number> {
  const ref = rest[0];
  const usage = "usage: protoboard parts export <part | instance> --format step|stl|3mf|glb [--out <file or folder>] [--from glb|step]";
  // `--format text|json` is the CLI's output switch: not a file format
  const format = (flags.format && !["text", "json"].includes(flags.format) ? flags.format.toLowerCase() : undefined) as ExportFormat | undefined;
  if (!ref || !format) throw new Error(usage);
  if (!EXPORT_FORMATS.includes(format)) throw new Error(`--format is one of ${EXPORT_FORMATS.join(", ")}`);
  if (flags.from && !["glb", "step"].includes(flags.from)) throw new Error("--from is glb or step");
  const t0 = performance.now();
  const p = await loadProject(cwd, { checks: false });
  const src = exportSource(p, ref);
  if (src.placeholder) throw new Error(`${ref} has only a placeholder body (an amber box): there is nothing real to export; give it a model first (\`protoboard parts fetch\`, \`parts import\`)`);

  const name = fileSlug((src.instance ?? src.part).replace(/\//g, "-"));
  let target: string;
  if (flags.out) {
    const o = isAbsolute(flags.out) ? flags.out : resolve(cwd, flags.out);
    target = extname(o).toLowerCase() === `.${format}` ? o : join(o, `${name}.${format}`);
  } else target = join(p.root, ".protoboard", "exports", `${name}.${format}`);
  mkdirSync(dirname(target), { recursive: true });

  let from: string;
  let how: string;
  if (src.inHolder) {
    if (format === "step") throw new Error(`${src.instance} is drawn inside ${src.inHolder.holder}'s body and has no STEP of its own: export ${src.inHolder.holder} as STEP, or this component as glb, stl or 3mf (DEFAULT)`);
    if (flags.from === "step") throw new Error(`--from step needs the part's own STEP; ${src.instance} is drawn inside ${src.inHolder.holder}'s body`);
    const { json, bin } = readGlb(src.inHolder.glb);
    const meshes = worldMeshes(json, bin, src.inHolder.node);
    if (!meshes.length) throw new Error(`the node ${src.inHolder.node} in ${basename(src.inHolder.glb)} has no triangles`);
    writeFileSync(target, format === "glb" ? glbBytes(meshes) : format === "stl" ? stlBytes(meshes) : threeMfBytes(meshes, src.instance ?? src.part));
    from = src.inHolder.glb;
    how = `node "${src.inHolder.node}" of ${src.inHolder.holder}'s full-resolution GLB (found through ${basename(src.inHolder.index)}), placement baked in`;
  } else if (format === "step") {
    if (!src.step) throw new Error(`${ref} has no STEP body (its body is ${src.glb ? "a GLB only" : "missing"}); export it as glb, stl or 3mf`);
    copyFileSync(src.step, target);
    from = src.step;
    how = "the body STEP, copied as it is";
  } else if (format === "glb" && flags.from !== "step") {
    if (!src.glb) throw new Error(`${ref} has no GLB body`);
    if (isViewSidecarFile(src.glb)) throw new Error(`${src.glb} is a view sidecar (simplified for display); parts export writes the full-resolution body`);
    copyFileSync(src.glb, target);
    from = src.glb;
    how = "the full-resolution body GLB, copied as it is";
  } else if (flags.from === "step" || (!src.glb && src.step && format !== "glb")) {
    if (!src.step) throw new Error(`--from step: ${ref} has no STEP body`);
    if (format === "glb") throw new Error("--from step makes stl or 3mf; for glb the build's GLB is the body");
    const rt = await cadRuntimePython(p.root);
    if (!rt.python) throw new Error(`--from step needs the CAD runtime: ${rt.problem}`);
    const script = join(p.root, ".protoboard", "cache", "parts-export-print.py");
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(script, PRINT_SCRIPT + "\n");
    // -I (wave 4 gate): isolated: neither the script's folder nor the user site nor PYTHONPATH is on the path
    await runPython(rt.python, ["-I", script, src.step, target, format, String(PRINT_LINEAR_MM), String(PRINT_ANGULAR_RAD)]);
    from = src.step;
    how = `the body STEP tessellated at print resolution (${PRINT_LINEAR_MM} mm, ${PRINT_ANGULAR_RAD} rad) on ${rt.python}`;
  } else {
    if (!src.glb) throw new Error(`${ref} has no GLB body`);
    const { json, bin } = readGlb(src.glb);
    const meshes = worldMeshes(json, bin);
    if (!meshes.length) throw new Error(`${basename(src.glb)} has no triangles`);
    writeFileSync(target, format === "stl" ? stlBytes(meshes) : threeMfBytes(meshes, src.instance ?? src.part));
    from = src.glb;
    how = "the full-resolution body GLB's triangles (the build's tessellation), converted to mm and Z up";
  }
  const ms = Math.round(performance.now() - t0);
  const record = {
    schema: "protoboard.part-export/v0",
    part: src.part,
    ...(src.instance ? { instance: src.instance } : {}),
    format,
    file: basename(target),
    sha256: sha256OfFile(target),
    bytes: statSync(target).size,
    source: { file: projectRelative(p.root, from).startsWith("..") ? basename(from) : projectRelative(p.root, from), sha256: sha256OfFile(from) },
    how,
    units: format === "glb" ? "m (glTF), Y up" : "mm, Z up",
    exportedAt: new Date().toISOString(),
    ms,
  };
  const sidecar = join(dirname(target), `${basename(target, extname(target))}.export.json`);
  writeFileSync(sidecar, JSON.stringify(record, null, 2) + "\n");
  out({ ...record, path: target, sidecar }, () => [`${ref}: ${format.toUpperCase()} written to ${target} (${record.bytes} bytes, ${ms} ms)`, `  from ${how}`, `  record: ${sidecar}`].join("\n"));
  return 0;
}
