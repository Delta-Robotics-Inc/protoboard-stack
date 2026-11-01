/**
 * The resolver's placeholder body (PB-1174, README §2 item 4): a box the
 * size of the part's footprint or package and as tall as the package, in a
 * hatched amber material that can never pass for a real part, tagged
 * `extras.protoboard.placeholder: true` on its node, mesh and scene so the
 * viewer can count "N of M components are placeholders".
 *
 * Units: the box is given in mm in the UHD frame (Z up, the mounting face at
 * z = 0); the GLB is glTF, metres and Y up, converted here at the boundary:
 * (x, y, z) mm → (x / 1000, z / 1000, -y / 1000) m.
 *
 * Plain glTF 2.0 with no extensions (float32 positions, uint16 indices, one
 * embedded PNG), so every GLB reader in the stack can read it (codebase-map
 * §1.3). Deterministic: the same box gives the same bytes.
 */
import { deflateSync } from "node:zlib";

export interface PlaceholderSpec {
  /** Node name: the part id. */
  name: string;
  /** Length (X), width (Y), height (Z) in mm. */
  size_mm: [number, number, number];
  /** Written under `extras.protoboard`; `placeholder: true` is always set. */
  extras?: Record<string, unknown>;
}

/** The amber of the placeholder and its darker hatch stripe (sRGB, 0-255). */
export const PLACEHOLDER_AMBER = [255, 176, 0] as const;
const HATCH = [140, 82, 0] as const;
/** Hatch period on the faces, mm. */
const HATCH_MM = 2;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A 16 x 16 RGBA PNG of diagonal stripes: amber with a darker hatch. */
export function hatchPng(size = 16): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const stripe = (x + y) % size < size / 4;
      const c = stripe ? HATCH : PLACEHOLDER_AMBER;
      row.set([c[0], c[1], c[2], 255], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}

const pad4 = (b: Buffer, fill = 0) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);

/** The placeholder box as GLB bytes. */
export function placeholderGlb(spec: PlaceholderSpec): Buffer {
  const [l, w, h] = spec.size_mm.map((v) => (Number.isFinite(v) && v > 0 ? v : 1));
  // corners in mm, UHD frame: X centred, Y centred, Z from 0 (mounting face) to h
  const faces: { n: [number, number, number]; c: [number, number, number][]; u: number; v: number }[] = [
    { n: [0, 0, 1], c: [[-l / 2, -w / 2, h], [l / 2, -w / 2, h], [l / 2, w / 2, h], [-l / 2, w / 2, h]], u: l, v: w },
    { n: [0, 0, -1], c: [[-l / 2, w / 2, 0], [l / 2, w / 2, 0], [l / 2, -w / 2, 0], [-l / 2, -w / 2, 0]], u: l, v: w },
    { n: [1, 0, 0], c: [[l / 2, -w / 2, 0], [l / 2, w / 2, 0], [l / 2, w / 2, h], [l / 2, -w / 2, h]], u: w, v: h },
    { n: [-1, 0, 0], c: [[-l / 2, w / 2, 0], [-l / 2, -w / 2, 0], [-l / 2, -w / 2, h], [-l / 2, w / 2, h]], u: w, v: h },
    { n: [0, 1, 0], c: [[l / 2, w / 2, 0], [-l / 2, w / 2, 0], [-l / 2, w / 2, h], [l / 2, w / 2, h]], u: l, v: h },
    { n: [0, -1, 0], c: [[-l / 2, -w / 2, 0], [l / 2, -w / 2, 0], [l / 2, -w / 2, h], [-l / 2, -w / 2, h]], u: l, v: h },
  ];
  // UHD mm, Z up → glTF m, Y up
  const toGltf = ([x, y, z]: [number, number, number]): [number, number, number] => [x / 1000, z / 1000, -y / 1000];
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  faces.forEach((f, i) => {
    const n = toGltf(f.n).map((v) => v * 1000);
    const uvs = [[0, 0], [f.u / HATCH_MM, 0], [f.u / HATCH_MM, f.v / HATCH_MM], [0, f.v / HATCH_MM]];
    f.c.forEach((c, k) => {
      pos.push(...toGltf(c));
      nrm.push(...n);
      uv.push(...uvs[k]);
    });
    // CCW seen from outside in the UHD frame; the frame change (a rotation) keeps the winding
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const f32 = (a: number[]) => Buffer.from(new Float32Array(a).buffer);
  const posBuf = f32(pos);
  const nrmBuf = f32(nrm);
  const uvBuf = f32(uv);
  const idxBuf = pad4(Buffer.from(new Uint16Array(idx).buffer));
  const png = pad4(hatchPng());
  const pngLen = hatchPng().length;
  const views: { byteOffset: number; byteLength: number; target?: number }[] = [];
  let offset = 0;
  for (const [b, target, len] of [[posBuf, 34962], [nrmBuf, 34962], [uvBuf, 34962], [idxBuf, 34963, idx.length * 2], [png, undefined, pngLen]] as [Buffer, number | undefined, number?][]) {
    views.push({ byteOffset: offset, byteLength: len ?? b.length, ...(target ? { target } : {}) });
    offset += b.length;
  }
  const bin = Buffer.concat([posBuf, nrmBuf, uvBuf, idxBuf, png]);
  const xs = [0, 1, 2].map((k) => pos.filter((_, i) => i % 3 === k));
  const extras = { protoboard: { ...(spec.extras ?? {}), placeholder: true, size_mm: [l, w, h] } };
  const gltf = {
    asset: { version: "2.0", generator: "@protoboardai/core part-files (placeholder)" },
    scene: 0,
    scenes: [{ name: spec.name, nodes: [0], extras }],
    nodes: [{ name: spec.name, mesh: 0, extras }],
    meshes: [{ name: `${spec.name} (placeholder)`, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }], extras }],
    materials: [
      {
        name: "protoboard-placeholder",
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 0.8], metallicFactor: 0, roughnessFactor: 0.9 },
        alphaMode: "BLEND",
        doubleSided: true,
        extras: { protoboard: { placeholder: true } },
      },
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }],
    images: [{ bufferView: 4, mimeType: "image/png" }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: "VEC3", min: xs.map((a) => Math.min(...a)), max: xs.map((a) => Math.max(...a)) },
      { bufferView: 1, componentType: 5126, count: nrm.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: uv.length / 2, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: idx.length, type: "SCALAR" },
    ],
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    buffers: [{ byteLength: bin.length }],
  };
  const json = pad4(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (type: number, data: Buffer) => {
    const h2 = Buffer.alloc(8);
    h2.writeUInt32LE(data.length, 0);
    h2.writeUInt32LE(type, 4);
    return Buffer.concat([h2, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]);
}

/** Read a GLB's JSON chunk (for tests and for counting placeholders). */
export function glbJson(bytes: Buffer): Record<string, unknown> {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  const len = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error("GLB has no JSON chunk first");
  return JSON.parse(bytes.subarray(20, 20 + len).toString("utf8"));
}
