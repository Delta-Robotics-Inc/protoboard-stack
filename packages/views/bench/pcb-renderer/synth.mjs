/**
 * Synthetic stress boards for the renderer benchmark: N copies of a parsed board tiled in a
 * grid, each copy with its own nets (so a net highlight touches one copy), footprints and
 * designators. 5x and 20x the source board's object count.
 *
 *   node synth.mjs <board.json> <copies> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { stats } from "./parse-kicad.mjs";

const [, , inp, copiesArg, out] = process.argv;
const src = JSON.parse(readFileSync(inp, "utf8"));
const copies = Number(copiesArg);
const cols = Math.ceil(Math.sqrt(copies));
const [x0, y0, x1, y1] = src.box;
const dx = (x1 - x0) * 1.1, dy = (y1 - y0) * 1.1;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

const b = { name: `${src.name}-x${copies}`, source: "synthetic", copper: src.copper, box: [x0, y0, x0 + dx * cols - (dx - (x1 - x0)), y0 + dy * Math.ceil(copies / cols) - (dy - (y1 - y0))], nets: [""], footprints: [], pads: [], tracks: [], arcs: [], vias: [], zones: [], graphics: [], texts: [] };
for (let k = 0; k < copies; k++) {
  const ox = (k % cols) * dx, oy = Math.floor(k / cols) * dy;
  const T = (p) => [r4(p[0] + ox), r4(p[1] + oy)];
  const netBase = b.nets.length - 1;
  for (let i = 1; i < src.nets.length; i++) b.nets.push(`${src.nets[i]}#${k}`);
  const N = (n) => (n ? n + netBase : 0);
  const fpBase = b.footprints.length;
  for (const f of src.footprints) b.footprints.push({ ...f, ref: `${f.ref}_${k}`, p: T(f.p), box: [r4(f.box[0] + ox), r4(f.box[1] + oy), r4(f.box[2] + ox), r4(f.box[3] + oy)] });
  const F = (fp) => (fp === undefined ? undefined : fp + fpBase);
  for (const p of src.pads) b.pads.push({ ...p, fp: F(p.fp), p: T(p.p), n: N(p.n), ...(p.polys ? { polys: p.polys.map((r) => r.map(T)) } : {}) });
  for (const t of src.tracks) b.tracks.push({ ...t, a: T(t.a), b: T(t.b), n: N(t.n) });
  for (const t of src.arcs) b.arcs.push({ ...t, a: T(t.a), m: T(t.m), b: T(t.b), n: N(t.n) });
  for (const v of src.vias) b.vias.push({ ...v, p: T(v.p), n: N(v.n) });
  for (const z of src.zones) b.zones.push({ ...z, n: N(z.n), pts: z.pts.map(T) });
  for (const g of src.graphics) {
    const c = { ...g, fp: F(g.fp) };
    if (g.pts) c.pts = g.pts.map(T);
    for (const key of ["a", "m", "b", "c"]) if (g[key]) c[key] = T(g[key]);
    b.graphics.push(c);
  }
  for (const t of src.texts) b.texts.push({ ...t, fp: F(t.fp), p: T(t.p), t: t.designator ? `${t.t}` : t.t });
}
writeFileSync(out, JSON.stringify(b));
console.log(JSON.stringify({ name: b.name, ...stats(b) }));
