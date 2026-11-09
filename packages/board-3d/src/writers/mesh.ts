/**
 * Mesh writers: binary STL (one mesh, or one file per body in a ZIP), 3MF with named objects and per-triangle colors
 * (3MF Core Specification base materials), and shared helpers. All meshes are the same tessellation the B-rep was
 * built with, placed in the board frame (millimeters, Z up).
 */
import { apply, type Affine } from "../math.js";
import { sceneSolids, type Board3d, type NamedSolid } from "../scene.js";
import { writeZip } from "./zip.js";

/** A body's triangles in the board frame. */
export interface WorldMesh {
  name: string;
  id: string;
  group: NamedSolid["group"];
  pos: Float32Array;
  color: Uint16Array;
  palette: string[];
}

export function worldMesh(s: NamedSolid): WorldMesh {
  const src = s.solid.mesh.pos;
  const pos = new Float32Array(src.length);
  const m: Affine = s.transform;
  for (let i = 0; i < src.length; i += 3) {
    const q = apply(m, [src[i], src[i + 1], src[i + 2]]);
    pos[i] = q[0];
    pos[i + 1] = q[1];
    pos[i + 2] = q[2];
  }
  return { name: s.name, id: s.id, group: s.group, pos, color: Uint16Array.from(s.solid.mesh.color), palette: s.solid.palette };
}

/** Meshes of a scene, render layers merged into one mesh per layer. */
export function sceneMeshes(scene: Board3d): WorldMesh[] {
  const out: WorldMesh[] = [];
  const layers = new Map<string, WorldMesh[]>();
  for (const s of sceneSolids(scene)) {
    const w = worldMesh(s);
    if (s.group === "layer") {
      const l = layers.get(s.name) ?? [];
      l.push(w);
      layers.set(s.name, l);
    } else out.push(w);
  }
  for (const [name, list] of layers) out.push(mergeMeshes(name, `layer:${name}`, "layer", list));
  return out;
}

export function mergeMeshes(name: string, id: string, group: NamedSolid["group"], list: WorldMesh[]): WorldMesh {
  const palette: string[] = [];
  const idx = new Map<string, number>();
  let n = 0;
  for (const m of list) n += m.pos.length;
  const pos = new Float32Array(n);
  const color = new Uint16Array(n / 9);
  let o = 0;
  let t = 0;
  for (const m of list) {
    pos.set(m.pos, o);
    o += m.pos.length;
    for (let k = 0; k < m.color.length; k++) {
      const c = m.palette[m.color[k]] ?? m.palette[0];
      let i = idx.get(c);
      if (i === undefined) {
        i = palette.push(c) - 1;
        idx.set(c, i);
      }
      color[t++] = i;
    }
  }
  return { name, id, group, pos, color, palette };
}

/** A file name safe on every system: no Windows-forbidden characters, no trailing dot or space. */
export function safeFileName(name: string): string {
  let s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").trim();
  if (!s) s = "body";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = `_${s}`;
  return s;
}

/** Binary STL of one or more meshes (no colors: STL has no standard for them; the sidecar carries them). */
export function writeStl(meshes: readonly WorldMesh[], header = "Protoboard board-3d"): Buffer {
  let tris = 0;
  for (const m of meshes) tris += m.pos.length / 9;
  const buf = Buffer.alloc(84 + tris * 50);
  buf.write(header.slice(0, 79).replace(/^solid/i, "board"), 0, "ascii");
  buf.writeUInt32LE(tris, 80);
  let o = 84;
  for (const m of meshes) {
    const p = m.pos;
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i];
      const uy = p[i + 4] - p[i + 1];
      const uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i];
      const vy = p[i + 7] - p[i + 1];
      const vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      buf.writeFloatLE(nx, o);
      buf.writeFloatLE(ny, o + 4);
      buf.writeFloatLE(nz, o + 8);
      for (let k = 0; k < 9; k++) buf.writeFloatLE(p[i + k], o + 12 + k * 4);
      buf.writeUInt16LE(0, o + 48);
      o += 50;
    }
  }
  return buf;
}

/** One STL per body in a ZIP, named after the body (`R1 10k.stl`), plus `bodies.json` with each body's color. */
export function writeStlZip(meshes: readonly WorldMesh[]): Buffer {
  const used = new Set<string>();
  const entries = meshes.map((m) => {
    let base = safeFileName(m.name);
    let k = 2;
    while (used.has(base.toLowerCase())) base = `${safeFileName(m.name)} ${k++}`;
    used.add(base.toLowerCase());
    return { name: `${base}.stl`, data: writeStl([m], m.name), body: { file: `${base}.stl`, name: m.name, id: m.id, color: m.palette[0], triangles: m.pos.length / 9 } };
  });
  const index = Buffer.from(`${JSON.stringify({ units: "mm", frame: "board frame, Z up", bodies: entries.map((e) => e.body) }, null, 2)}\n`, "utf8");
  return writeZip([...entries.map((e) => ({ name: e.name, data: e.data })), { name: "bodies.json", data: index }]);
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) => {
  const r = Math.round(v * 1e5) / 1e5;
  return r === 0 ? "0" : String(r);
};

/**
 * 3MF (Core Specification 1.3): one named object per body with welded vertices, colors as base materials (each
 * object's main color, and a per-triangle property where a face differs), every object in the build. Coordinates in
 * the board frame, millimeters.
 */
export function write3mf(meshes: readonly WorldMesh[], title: string): Buffer {
  const colors: string[] = [];
  const cidx = new Map<string, number>();
  const colorId = (c: string) => {
    let i = cidx.get(c);
    if (i === undefined) {
      i = colors.push(c) - 1;
      cidx.set(c, i);
    }
    return i;
  };
  for (const m of meshes) for (const c of m.palette) colorId(c);
  const objs: string[] = [];
  const items: string[] = [];
  let id = 2;
  for (const m of meshes) {
    const vid = new Map<string, number>();
    const verts: string[] = [];
    const tris: string[] = [];
    const main = colorId(m.palette[0]);
    const v = (i: number) => {
      const key = `${num(m.pos[i])},${num(m.pos[i + 1])},${num(m.pos[i + 2])}`;
      let k = vid.get(key);
      if (k === undefined) {
        k = verts.push(`<vertex x="${num(m.pos[i])}" y="${num(m.pos[i + 1])}" z="${num(m.pos[i + 2])}"/>`) - 1;
        vid.set(key, k);
      }
      return k;
    };
    for (let t = 0; t < m.pos.length / 9; t++) {
      const a = v(t * 9);
      const b = v(t * 9 + 3);
      const c = v(t * 9 + 6);
      if (a === b || b === c || a === c) continue;
      const col = colorId(m.palette[m.color[t]] ?? m.palette[0]);
      tris.push(col === main ? `<triangle v1="${a}" v2="${b}" v3="${c}"/>` : `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${col}"/>`);
    }
    objs.push(`<object id="${id}" name="${xmlEsc(m.name)}" type="model" pid="1" pindex="${main}"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}"/>`);
    id++;
  }
  const base = colors.map((c, i) => `<base name="color ${i + 1}" displaycolor="${c.toUpperCase()}FF"/>`).join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${xmlEsc(title)}</metadata><metadata name="Application">Protoboard board-3d</metadata><resources><basematerials id="1">${base}</basematerials>${objs.join("")}</resources><build>${items.join("")}</build></model>\n`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n`;
  const enc = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));
  return writeZip([
    { name: "[Content_Types].xml", data: enc(types) },
    { name: "_rels/.rels", data: enc(rels) },
    { name: "3D/3dmodel.model", data: enc(model) },
  ]);
}
