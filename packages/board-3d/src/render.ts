/**
 * Images of an export, in plain Node, with no GPU: the same triangles the files hold, drawn with a depth buffer at
 * twice the size and averaged down, flat shaded, with dark lines where the surface turns or a body ends (CAD style).
 * Labels (reference designators on the top view) are stroke paths over the picture, rasterized with resvg as
 * @protoboardai/board-scene does. Views: isometric (from the front right, above), top and bottom.
 */
import { deflateSync } from "node:zlib";
import { svgToPng, textPath } from "@protoboardai/board-scene";
import { cross, dot, normalize, type Vec3 } from "./math.js";
import { exportedComponents, type Board3d } from "./scene.js";
import type { WorldMesh } from "./writers/mesh.js";
import { crc32 } from "./writers/zip.js";

export type View = "iso" | "top" | "bottom";

export interface RenderOptions {
  view: View;
  /** Image width in pixels (default 1400). */
  width?: number;
  /** Label parts with their reference designators (default: top and bottom views). */
  labels?: boolean;
  /** Background, `#rrggbb` (default dark). */
  background?: string;
  title?: string;
}

interface Camera {
  right: Vec3;
  up: Vec3;
  view: Vec3;
}

function camera(view: View): Camera {
  if (view === "top") return { right: [1, 0, 0], up: [0, 1, 0], view: [0, 0, -1] };
  if (view === "bottom") return { right: [-1, 0, 0], up: [0, 1, 0], view: [0, 0, 1] };
  const eye = normalize([1, -1.25, 1.15]);
  const v: Vec3 = [-eye[0], -eye[1], -eye[2]];
  const right = normalize(cross(v, [0, 0, 1]));
  return { right, up: cross(right, v), view: v };
}

const rgbOf = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** Encode 8-bit RGB pixels as PNG. */
export function encodePng(rgb: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

export interface Raster {
  png: Buffer;
  width: number;
  height: number;
  /** World point to image pixel. */
  toPixel: (p: Vec3) => [number, number];
}

/** Draw meshes with a depth buffer. */
export function rasterize(meshes: readonly WorldMesh[], options: RenderOptions): Raster {
  const width = options.width ?? 1400;
  const cam = camera(options.view);
  const light = normalize([0.35, -0.55, options.view === "bottom" ? -0.9 : 0.9]);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of meshes) {
    for (let i = 0; i < m.pos.length; i += 3) {
      const p: Vec3 = [m.pos[i], m.pos[i + 1], m.pos[i + 2]];
      const x = dot(p, cam.right);
      const y = -dot(p, cam.up);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const pad = 0.06 * Math.max(maxX - minX, maxY - minY);
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const height = Math.max(1, Math.round((width * (maxY - minY)) / (maxX - minX)));
  const ss = 2;
  const W = width * ss;
  const H = height * ss;
  const k = W / (maxX - minX);
  const depth = new Float32Array(W * H).fill(Infinity);
  const color = new Uint8Array(W * H * 3);
  const ids = new Uint32Array(W * H);
  const bg = rgbOf(options.background ?? "#16181b");
  for (let i = 0; i < W * H; i++) color.set(bg, i * 3);
  meshes.forEach((m, mi) => {
    const p = m.pos;
    for (let t = 0; t < p.length / 9; t++) {
      const o = t * 9;
      const a: Vec3 = [p[o], p[o + 1], p[o + 2]];
      const b: Vec3 = [p[o + 3], p[o + 4], p[o + 5]];
      const c: Vec3 = [p[o + 6], p[o + 7], p[o + 8]];
      const n = normalize(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
      if (dot(n, cam.view) >= -1e-9) continue;
      const lit = 0.42 + 0.58 * Math.max(0, dot(n, light));
      const base = rgbOf(m.palette[m.color[t]] ?? m.palette[0]);
      const col = base.map((x) => Math.min(255, Math.round(x * lit * 1.08)));
      // a face id: the body and its normal direction, so lines appear where either changes
      const nq = (Math.round(n[0] * 8) + 9) * 400 + (Math.round(n[1] * 8) + 9) * 20 + (Math.round(n[2] * 8) + 9);
      const id = (mi + 1) * 8192 + nq;
      const P = [a, b, c].map((q) => [(dot(q, cam.right) - minX) * k, (-dot(q, cam.up) - minY) * k, dot(q, cam.view)]);
      const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[1][1] - P[0][1]) * (P[2][0] - P[0][0]);
      if (Math.abs(area) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[1][1] - py) * (P[2][0] - px)) / area;
          const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[2][1] - py) * (P[0][0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const d = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2];
          const idx = y * W + x;
          if (d >= depth[idx] - 1e-5) continue;
          depth[idx] = d;
          ids[idx] = id;
          color[idx * 3] = col[0];
          color[idx * 3 + 1] = col[1];
          color[idx * 3 + 2] = col[2];
        }
      }
    }
  });
  // lines where the face id changes between neighbors (body edges and creases)
  const edge = new Uint8Array(W * H);
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      if (ids[i] !== ids[i + 1] || ids[i] !== ids[i + W]) edge[i] = 1;
    }
  }
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let e = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const i = (y * ss + dy) * W + x * ss + dx;
          r += color[i * 3];
          g += color[i * 3 + 1];
          b += color[i * 3 + 2];
          e += edge[i] && ids[i] ? 1 : 0;
        }
      }
      const f = (1 - 0.45 * (e / (ss * ss))) / (ss * ss);
      out[(y * width + x) * 3] = Math.round(r * f);
      out[(y * width + x) * 3 + 1] = Math.round(g * f);
      out[(y * width + x) * 3 + 2] = Math.round(b * f);
    }
  }
  return { png: encodePng(out, width, height), width, height, toPixel: (q) => [(dot(q, cam.right) - minX) * (width / (maxX - minX)), (-dot(q, cam.up) - minY) * (width / (maxX - minX))] };
}

/** The image of an export as PNG, with labels. */
export function renderPng(scene: Board3d, meshes: readonly WorldMesh[], options: RenderOptions): { png: Uint8Array; width: number; height: number } {
  const r = rasterize(meshes, options);
  const labels = options.labels ?? options.view !== "iso";
  if (!labels && !options.title) return { png: r.png, width: r.width, height: r.height };
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">`, `<image width="${r.width}" height="${r.height}" xlink:href="data:image/png;base64,${r.png.toString("base64")}"/>`];
  const f = (v: number) => (Math.round(v * 10) / 10).toString();
  if (labels) {
    const h = Math.max(9, Math.min(14, r.width / 110));
    for (const c of exportedComponents(scene)) {
      if (!c.bounds) continue;
      if ((options.view === "top" && c.side !== "top") || (options.view === "bottom" && c.side !== "bottom")) continue;
      const [x, y] = r.toPixel([(c.bounds.min[0] + c.bounds.max[0]) / 2, (c.bounds.min[1] + c.bounds.max[1]) / 2, c.bounds.max[2]]);
      const d = textPath(c.ref, x, y, h, "center");
      parts.push(`<path d="${d}" fill="none" stroke="#000000" stroke-opacity="0.7" stroke-width="${f(h * 0.3)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="#8fdcff" stroke-width="${f(h * 0.12)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  if (options.title) parts.push(`<path d="${textPath(options.title, 16, 22, 14, "left")}" fill="none" stroke="#c8ccd2" stroke-width="1.6" stroke-linecap="round"/>`);
  parts.push("</svg>");
  const p = svgToPng(parts.join("\n"));
  return { png: p.png, width: p.width, height: p.height };
}
