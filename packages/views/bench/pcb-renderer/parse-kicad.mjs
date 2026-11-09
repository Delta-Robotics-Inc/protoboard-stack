/**
 * Throwaway KiCad board reader for the Phase 0 renderer benchmark (not product code).
 *
 *   node parse-kicad.mjs <board.kicad_pcb> <out.json> [name]
 *
 * Reads a KiCad 8 to 10 `.kicad_pcb` (S-expressions) into the neutral scene JSON the
 * candidates draw: tracks, arcs, vias, pads with their shapes, zone fills, board graphics
 * (silkscreen, edge cuts, fabrication) and designators. Millimeters, y down, as KiCad stores
 * them. Rotations are KiCad's (degrees, counterclockwise on screen).
 *
 * Confidential boards stay on this machine: write the JSON outside the repository (the
 * benchmark's data folder is under %TEMP%), never into it.
 */
import { readFileSync, writeFileSync } from "node:fs";

// ---------- S-expression reader ----------
function parseSexpr(src) {
  let i = 0;
  const n = src.length;
  const stack = [[]];
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 40) { // (
      const list = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
    } else if (c === 41) { // )
      stack.pop();
      i++;
    } else if (c === 34) { // "
      let j = i + 1;
      let s = "";
      while (j < n) {
        const d = src.charCodeAt(j);
        if (d === 92) { s += src[j + 1]; j += 2; continue; }
        if (d === 34) break;
        s += src[j];
        j++;
      }
      stack[stack.length - 1].push({ s });
      i = j + 1;
    } else if (c <= 32) {
      i++;
    } else {
      let j = i;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (d <= 32 || d === 40 || d === 41) break;
        j++;
      }
      stack[stack.length - 1].push(src.slice(i, j));
      i = j;
    }
  }
  return stack[0][0];
}

const head = (l) => (Array.isArray(l) ? l[0] : undefined);
const str = (v) => (v && typeof v === "object" && "s" in v ? v.s : v);
const kids = (l, k) => l.filter((x) => Array.isArray(x) && x[0] === k);
const kid = (l, k) => l.find((x) => Array.isArray(x) && x[0] === k);
const num = (v) => Number(str(v));
const xy = (l) => [num(l[1]), num(l[2])];

/** KiCad rotation: degrees, counterclockwise on a y-down screen. */
function rot(p, deg) {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const P = (p) => [r4(p[0]), r4(p[1])];

export function readBoard(src, name) {
  const root = parseSexpr(src);
  const copper = [];
  for (const l of kid(root, "layers").slice(1)) {
    const nm = str(l[1]);
    if (/\.Cu$/.test(nm)) copper.push(nm);
  }
  // physical order: F.Cu, In1..InN, B.Cu
  copper.sort((a, b) => rank(a) - rank(b));
  function rank(l) {
    if (l === "F.Cu") return -1;
    if (l === "B.Cu") return 1e6;
    return Number(l.replace(/\D/g, ""));
  }

  const netIndex = new Map([["", 0]]);
  const nets = [""];
  const netOf = (l) => {
    const e = kid(l, "net");
    if (!e) return 0;
    const nm = str(e[e.length - 1]);
    if (typeof nm !== "string" || /^\d+$/.test(nm) && e.length === 2) {
      // KiCad 8/9: (net 3 "NAME"); a bare number resolves through the header table
      return netIndex.get(headerNets.get(Number(nm)) ?? "") ?? 0;
    }
    if (!netIndex.has(nm)) { netIndex.set(nm, nets.length); nets.push(nm); }
    return netIndex.get(nm);
  };
  const headerNets = new Map();
  for (const e of kids(root, "net")) if (e.length >= 3) headerNets.set(Number(e[1]), str(e[2]));

  const expandLayers = (names) => {
    const out = new Set();
    for (const nm of names) {
      if (nm === "*.Cu") copper.forEach((c) => out.add(c));
      else if (nm === "F&B.Cu") { out.add("F.Cu"); out.add("B.Cu"); }
      else if (copper.includes(nm)) out.add(nm);
      else out.add(nm);
    }
    return [...out];
  };

  const tracks = [];
  const arcs = [];
  const vias = [];
  const pads = [];
  const zones = [];
  const graphics = [];
  const texts = [];
  const footprints = [];

  for (const e of root.slice(1)) {
    const h = head(e);
    if (h === "segment") {
      const a = xy(kid(e, "start")), b = xy(kid(e, "end"));
      tracks.push({ l: str(kid(e, "layer")[1]), a: P(a), b: P(b), w: num(kid(e, "width")[1]), n: netOf(e) });
    } else if (h === "arc") {
      arcs.push({ l: str(kid(e, "layer")[1]), a: P(xy(kid(e, "start"))), m: P(xy(kid(e, "mid"))), b: P(xy(kid(e, "end"))), w: num(kid(e, "width")[1]), n: netOf(e) });
    } else if (h === "via") {
      const ls = kid(e, "layers").slice(1).map(str);
      vias.push({ p: P(xy(kid(e, "at"))), d: num(kid(e, "size")[1]), drill: num(kid(e, "drill")[1]), ls: [ls[0], ls[ls.length - 1]], n: netOf(e) });
    } else if (h === "zone") {
      if (kid(e, "keepout")) {
        const poly = kid(e, "polygon");
        if (poly) graphics.push({ l: "Keepout", k: "poly", pts: kid(poly, "pts").filter((x) => head(x) === "xy").map((x) => P(xy(x))), w: 0.05, fill: false });
        continue;
      }
      const n = netOf(e);
      for (const fp of kids(e, "filled_polygon")) {
        const l = str(kid(fp, "layer")[1]);
        const pts = kid(fp, "pts").filter((x) => head(x) === "xy").map((x) => P(xy(x)));
        if (pts.length >= 3) zones.push({ l, n, pts });
      }
    } else if (h === "footprint") {
      readFootprint(e);
    } else if (h && h.startsWith("gr_")) {
      const g = readGraphic(e, [0, 0], 0);
      if (g) (g.k === "text" ? texts : graphics).push(g);
    }
  }

  function readGraphic(e, at, frot) {
    const h = head(e);
    const T = (p) => { const q = rot(p, frot); return P([q[0] + at[0], q[1] + at[1]]); };
    const layerE = kid(e, "layer");
    const l = layerE ? str(layerE[1]) : undefined;
    if (!l) return undefined;
    const stroke = kid(e, "stroke");
    const w = stroke ? num(kid(stroke, "width")?.[1] ?? 0.1) : num(kid(e, "width")?.[1] ?? 0.1);
    const fillE = kid(e, "fill");
    const fill = fillE ? ["yes", "solid"].includes(str(fillE[1])) : false;
    const kind = h.slice(3);
    if (kind === "line") return { l, k: "line", pts: [T(xy(kid(e, "start"))), T(xy(kid(e, "end")))], w };
    if (kind === "arc") return { l, k: "arc", a: T(xy(kid(e, "start"))), m: T(xy(kid(e, "mid"))), b: T(xy(kid(e, "end"))), w };
    if (kind === "circle") {
      const c = T(xy(kid(e, "center"))), q = T(xy(kid(e, "end")));
      return { l, k: "circle", c, r: r4(Math.hypot(q[0] - c[0], q[1] - c[1])), w, fill };
    }
    if (kind === "rect") {
      const a = xy(kid(e, "start")), b = xy(kid(e, "end"));
      return { l, k: "poly", pts: [T(a), T([b[0], a[1]]), T(b), T([a[0], b[1]])], w, fill };
    }
    if (kind === "poly") {
      const pts = kid(e, "pts").filter((x) => head(x) === "xy").map((x) => T(xy(x)));
      return { l, k: "poly", pts, w, fill };
    }
    if (kind === "text") {
      const atE = kid(e, "at");
      return textOf(str(e[1]), e, l, T(xy(atE)), num(atE[3] ?? 0));
    }
    return undefined;
  }

  function textOf(text, e, l, p, angle) {
    const eff = kid(e, "effects");
    const font = eff && kid(eff, "font");
    const size = font && kid(font, "size") ? num(kid(font, "size")[1]) : 1;
    const th = font && kid(font, "thickness") ? num(kid(font, "thickness")[1]) : size * 0.15;
    const just = eff && kid(eff, "justify");
    const mirror = !!(just && just.includes("mirror"));
    const hidden = !!kid(e, "hide") && str(kid(e, "hide")[1]) !== "no" || e.includes("hide");
    return { l, k: "text", t: text, p, s: size, th, r: angle, mirror, hidden };
  }

  function readFootprint(e) {
    const atE = kid(e, "at");
    const at = xy(atE);
    const frot = num(atE[3] ?? 0);
    const side = str(kid(e, "layer")[1]) === "B.Cu" ? "B" : "F";
    let ref = "";
    const fpIndex = footprints.length;
    const T = (p) => { const q = rot(p, frot); return [q[0] + at[0], q[1] + at[1]]; };
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const grow = (p, r = 0) => { minx = Math.min(minx, p[0] - r); miny = Math.min(miny, p[1] - r); maxx = Math.max(maxx, p[0] + r); maxy = Math.max(maxy, p[1] + r); };
    for (const c of e.slice(1)) {
      const h = head(c);
      if (h === "property" && str(c[1]) === "Reference") {
        ref = str(c[2]);
        const a = kid(c, "at");
        const t = textOf(ref, c, str(kid(c, "layer")?.[1] ?? (side === "F" ? "F.SilkS" : "B.SilkS")), P(T(xy(a))), num(a[3] ?? 0));
        t.fp = fpIndex;
        t.designator = true;
        texts.push(t);
      } else if (h === "fp_text" && str(c[1]) === "reference") {
        ref = str(c[2]);
        const a = kid(c, "at");
        const t = textOf(ref, c, str(kid(c, "layer")[1]), P(T(xy(a))), num(a[3] ?? 0));
        t.fp = fpIndex;
        t.designator = true;
        texts.push(t);
      } else if (h && (h.startsWith("fp_") || h.startsWith("gr_")) && h !== "fp_text") {
        const g = readGraphic(["gr_" + h.slice(3), ...c.slice(1)], at, frot);
        if (g) { g.fp = fpIndex; graphics.push(g); }
      } else if (h === "pad") {
        const kind = str(c[2]);
        const shape = str(c[3]);
        const pa = kid(c, "at");
        const local = xy(pa);
        const p = T(local);
        const prot = num(pa[3] ?? 0); // absolute in the file (footprint angle included)
        const size = kid(c, "size");
        const w = num(size[1]), hh = num(size[2]);
        const ls = expandLayers(kid(c, "layers").slice(1).map(str)).filter((x) => copper.includes(x));
        const drillE = kid(c, "drill");
        let drill;
        if (drillE) {
          const vals = drillE.slice(1).filter((x) => x !== "oval" && !Array.isArray(x)).map(num);
          if (vals.length) drill = vals.length > 1 ? [vals[0], vals[1]] : [vals[0], vals[0]];
        }
        if (!ls.length && !drill) continue; // paste or mask only
        const pad = { fp: fpIndex, num: str(c[1]), shape, p: P(p), w, h: hh, r: prot, ls, n: netOf(c), kind };
        if (shape === "roundrect") pad.rr = num(kid(c, "roundrect_rratio")?.[1] ?? 0.25);
        if (drill) pad.drill = drill;
        if (shape === "custom") {
          // primitives in pad-local coordinates, rotated by the pad angle: kept as polygons
          const prims = kid(c, "primitives");
          pad.polys = [];
          for (const pr of prims ? prims.slice(1) : []) {
            if (head(pr) === "gr_poly") {
              const pts = kid(pr, "pts").filter((x) => head(x) === "xy").map((x) => { const q = rot(xy(x), prot); return P([q[0] + p[0], q[1] + p[1]]); });
              pad.polys.push(pts);
            } else if (head(pr) === "gr_rect") {
              const a = xy(kid(pr, "start")), b = xy(kid(pr, "end"));
              pad.polys.push([a, [b[0], a[1]], b, [a[0], b[1]]].map((q0) => { const q = rot(q0, prot); return P([q[0] + p[0], q[1] + p[1]]); }));
            }
          }
          const anchor = kid(c, "options") && kid(kid(c, "options"), "anchor");
          pad.anchor = anchor ? str(anchor[1]) : "rect";
        }
        pads.push(pad);
        grow(p, Math.max(w, hh) / 2);
      }
    }
    for (const g of graphics) if (g.fp === fpIndex && /SilkS|Fab|CrtYd/.test(g.l)) for (const q of g.pts ?? [g.a, g.b, g.c].filter(Boolean)) grow(q);
    if (!isFinite(minx)) grow(at, 0.5);
    footprints.push({ ref, p: P(at), r: frot, side, box: [r4(minx), r4(miny), r4(maxx), r4(maxy)] });
  }

  // board box from the edge
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const g of graphics) {
    if (g.l !== "Edge.Cuts") continue;
    const pts = g.pts ?? [g.a, g.m, g.b].filter(Boolean);
    if (g.k === "circle") pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]);
    for (const q of pts) { minx = Math.min(minx, q[0]); miny = Math.min(miny, q[1]); maxx = Math.max(maxx, q[0]); maxy = Math.max(maxy, q[1]); }
  }
  return {
    name,
    source: "kicad_pcb",
    copper,
    box: [r4(minx), r4(miny), r4(maxx), r4(maxy)],
    nets,
    footprints,
    pads,
    tracks,
    arcs,
    vias,
    zones,
    graphics,
    texts,
  };
}

export function stats(b) {
  const zonePts = b.zones.reduce((s, z) => s + z.pts.length, 0);
  return {
    copperLayers: b.copper.length,
    footprints: b.footprints.length,
    pads: b.pads.length,
    tracks: b.tracks.length,
    arcs: b.arcs.length,
    vias: b.vias.length,
    zoneFills: b.zones.length,
    zoneVertices: zonePts,
    graphics: b.graphics.length,
    texts: b.texts.length,
    nets: b.nets.length - 1,
    objects: b.pads.length + b.tracks.length + b.arcs.length + b.vias.length + b.zones.length + b.graphics.length + b.texts.length,
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/^\//, "")}` || process.argv[1]?.endsWith("parse-kicad.mjs")) {
  const [, , inp, out, name] = process.argv;
  if (!inp || !out) {
    console.error("usage: node parse-kicad.mjs <board.kicad_pcb> <out.json> [name]");
    process.exit(2);
  }
  const t0 = performance.now();
  const b = readBoard(readFileSync(inp, "utf8"), name ?? inp);
  const ms = performance.now() - t0;
  writeFileSync(out, JSON.stringify(b));
  console.log(JSON.stringify({ name: b.name, parseMs: Math.round(ms), box: b.box, copper: b.copper, ...stats(b) }));
}
