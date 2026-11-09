/**
 * A minimal Gerber RS-274X reader, written from the Gerber Layer Format Specification, for reading back what the
 * writer produced (and Gerbers from other tools, for comparison): format and units, standard apertures and aperture
 * macros (primitives 1, 4, 5, 7, 20, 21 with arithmetic), flashes, linear and circular draws, regions, polarity, and
 * X2 attributes in both the extended and the comment form. Coordinates come out as integer nanometers.
 *
 * Not supported (reported as warnings when met): step and repeat (`SR`), block apertures (`AB`), and the object
 * transformations `LM`, `LR`, `LS`.
 */
import type { Pt } from "../geom.js";

export type Attrs = Record<string, string[]>;

export interface GAperture {
  code: number;
  /** `C`, `R`, `O`, `P` or a macro name. */
  template: string;
  /** Parameters in millimeters (or degrees and counts, as the template defines). */
  params: number[];
  attrs: Attrs;
}

/** A macro primitive. */
export interface GPrimitive {
  code: number;
  /** Expressions per field. */
  fields: string[];
}
export interface GMacro {
  name: string;
  /** Primitives and variable definitions in order. */
  items: ({ kind: "prim"; prim: GPrimitive } | { kind: "var"; index: number; expr: string })[];
}

interface ObjBase {
  dark: boolean;
  /** Object attributes in effect (`.N`, `.P`, `.C`, ...) plus, for regions, the aperture attributes in the dictionary. */
  attrs: Attrs;
}
export interface GFlash extends ObjBase {
  k: "flash";
  ap: number;
  x: number;
  y: number;
}
export interface GDraw extends ObjBase {
  k: "draw";
  ap: number;
  from: Pt;
  to: Pt;
  /** Circular: the center and direction. */
  arc?: { cx: number; cy: number; ccw: boolean };
}
export interface GRegion extends ObjBase {
  k: "region";
  /** The contour, arcs flattened, closed implicitly (the last point is the first). */
  ring: Pt[];
}
export type GObject = GFlash | GDraw | GRegion;

export interface GerberRead {
  fileAttrs: Attrs;
  apertures: Map<number, GAperture>;
  macros: Map<string, GMacro>;
  objects: GObject[];
  units: "mm" | "in";
  format?: { int: number; dec: number };
  /** `M02` was read. */
  ended: boolean;
  warnings: string[];
  errors: string[];
}

/** Split a Gerber text into commands: extended blocks (`%...%`) and word commands (`...*`). */
function commands(text: string): { ext: boolean; body: string }[] {
  const out: { ext: boolean; body: string }[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "\r" || c === "\n" || c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "%") {
      const j = text.indexOf("%", i + 1);
      if (j < 0) {
        out.push({ ext: true, body: text.slice(i + 1) });
        break;
      }
      out.push({ ext: true, body: text.slice(i + 1, j).replace(/[\r\n]/g, "") });
      i = j + 1;
      continue;
    }
    const j = text.indexOf("*", i);
    if (j < 0) {
      out.push({ ext: false, body: text.slice(i).trim() });
      break;
    }
    out.push({ ext: false, body: text.slice(i, j).replace(/[\r\n]/g, "") });
    i = j + 1;
  }
  return out;
}

/** Unescape `\uXXXX` and `\UXXXXXXXX` in an attribute field. */
const unescape = (s: string): string => s.replace(/\\u([0-9A-Fa-f]{4})|\\U([0-9A-Fa-f]{8})/g, (_m, a: string | undefined, b: string | undefined) => String.fromCodePoint(parseInt(a ?? b!, 16)));

function parseAttr(s: string): { name: string; values: string[] } {
  const parts = s.split(",");
  return { name: parts[0], values: parts.slice(1).map(unescape) };
}

/** Evaluate a macro expression with the given variables. */
export function evalExpr(expr: string, vars: number[]): number {
  const s = expr.replace(/\s+/g, "");
  let i = 0;
  const peek = () => s[i];
  function primary(): number {
    const c = peek();
    if (c === "(") {
      i++;
      const v = sum();
      if (peek() === ")") i++;
      return v;
    }
    if (c === "-") {
      i++;
      return -primary();
    }
    if (c === "+") {
      i++;
      return primary();
    }
    if (c === "$") {
      i++;
      const m = /^\d+/.exec(s.slice(i))!;
      i += m[0].length;
      return vars[Number(m[0])] ?? 0;
    }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) throw new Error(`bad macro expression: ${expr}`);
    i += m[0].length;
    return Number(m[0]);
  }
  function product(): number {
    let v = primary();
    for (;;) {
      const c = peek();
      if (c === "x" || c === "X") {
        i++;
        v *= primary();
      } else if (c === "/") {
        i++;
        v /= primary();
      } else return v;
    }
  }
  function sum(): number {
    let v = product();
    for (;;) {
      const c = peek();
      if (c === "+") {
        i++;
        v += product();
      } else if (c === "-") {
        i++;
        v -= product();
      } else return v;
    }
  }
  return sum();
}

/** Read a Gerber file. */
export function readGerber(text: string): GerberRead {
  const r: GerberRead = { fileAttrs: {}, apertures: new Map(), macros: new Map(), objects: [], units: "mm", ended: false, warnings: [], errors: [] };
  const apDict: Attrs = {};
  const objDict: Attrs = {};
  let fmt = { int: 4, dec: 6 };
  let x = 0;
  let y = 0;
  let ap: number | undefined;
  let interp: "G01" | "G02" | "G03" = "G01";
  let quadrant: "G74" | "G75" = "G75";
  let dark = true;
  let region: Pt[] | undefined;
  let inRegion = false;
  const warned = new Set<string>();
  const warn = (w: string) => {
    if (!warned.has(w)) {
      warned.add(w);
      r.warnings.push(w);
    }
  };
  const toNm = (v: string): number => {
    const neg = v.startsWith("-");
    const digits = v.replace(/^[+-]/, "");
    let val: number;
    if (digits.includes(".")) val = Number(digits);
    else val = Number(digits) / 10 ** fmt.dec;
    if (neg) val = -val;
    return Math.round(r.units === "mm" ? val * 1e6 : val * 25.4e6);
  };
  const unitNm = (mmOrIn: number) => (r.units === "mm" ? mmOrIn * 1e6 : mmOrIn * 25.4e6);
  const closeContour = () => {
    if (region && region.length >= 3) {
      const ring = [...region];
      const a = ring[0];
      const b = ring[ring.length - 1];
      if (a.x === b.x && a.y === b.y) ring.pop();
      else r.warnings.push("a region contour is not closed");
      r.objects.push({ k: "region", ring, dark, attrs: { ...apDict, ...objDict } });
    }
    region = undefined;
  };
  const attrStmt = (body: string) => {
    const kind = body.slice(0, 2);
    const rest = body.slice(2);
    if (kind === "TF") {
      const a = parseAttr(rest);
      r.fileAttrs[a.name] = a.values;
    } else if (kind === "TA") {
      const a = parseAttr(rest);
      apDict[a.name] = a.values;
    } else if (kind === "TO") {
      const a = parseAttr(rest);
      objDict[a.name] = a.values;
    } else if (kind === "TD") {
      if (!rest) {
        for (const k of Object.keys(apDict)) delete apDict[k];
        for (const k of Object.keys(objDict)) delete objDict[k];
      } else {
        delete apDict[rest];
        delete objDict[rest];
      }
    }
  };
  for (const cmd of commands(text)) {
    const b = cmd.body;
    if (cmd.ext) {
      if (b.startsWith("AM")) {
        const parts = b.slice(2).split("*");
        const name = parts[0];
        const items: GMacro["items"] = [];
        for (const p of parts.slice(1)) {
          const t = p.trim();
          if (!t || t.startsWith("0")) continue;
          const v = /^\$(\d+)=(.*)$/.exec(t);
          if (v) items.push({ kind: "var", index: Number(v[1]), expr: v[2] });
          else {
            const f = t.split(",");
            items.push({ kind: "prim", prim: { code: Number(f[0]), fields: f.slice(1) } });
          }
        }
        r.macros.set(name, { name, items });
        continue;
      }
      for (const part of b.split("*")) {
        const s = part.trim();
        if (!s) continue;
        if (s.startsWith("FS")) {
          const m = /^FS([LT])([AI])X(\d)(\d)Y(\d)(\d)/.exec(s);
          if (!m) r.errors.push(`unreadable format statement ${s}`);
          else {
            fmt = { int: Number(m[3]), dec: Number(m[4]) };
            r.format = fmt;
            if (m[1] === "T") warn("trailing-zero format (deprecated) read as leading-zero omission");
            if (m[2] === "I") r.errors.push("incremental coordinates are not supported");
          }
        } else if (s.startsWith("MO")) r.units = s.slice(2) === "IN" ? "in" : "mm";
        else if (s.startsWith("AD")) {
          const m = /^ADD(\d+)([A-Za-z_$.][^,]*)(?:,(.*))?$/.exec(s);
          if (!m) r.errors.push(`unreadable aperture ${s}`);
          else r.apertures.set(Number(m[1]), { code: Number(m[1]), template: m[2], params: m[3] ? m[3].split("X").map(Number) : [], attrs: { ...apDict } });
        } else if (s.startsWith("LP")) dark = s[2] !== "C";
        else if (s.startsWith("TF") || s.startsWith("TA") || s.startsWith("TO") || s.startsWith("TD")) attrStmt(s);
        else if (s.startsWith("SR")) {
          if (s !== "SR") warn("step and repeat (SR) is not supported");
        } else if (s.startsWith("AB")) warn("block apertures (AB) are not supported");
        else if (s.startsWith("LM") || s.startsWith("LR") || s.startsWith("LS")) {
          if (!/^LM N$|^LMN$|^LR0(\.0*)?$|^LS1(\.0*)?$/.test(s)) warn(`object transformation ${s.slice(0, 2)} is not supported`);
        } else if (s.startsWith("IP") || s.startsWith("IN") || s.startsWith("OF") || s.startsWith("SF") || s.startsWith("MI") || s.startsWith("IR") || s.startsWith("AS") || s.startsWith("LN")) warn(`deprecated command ${s.slice(0, 2)} ignored`);
        else warn(`unknown extended command ${s.slice(0, 2)}`);
      }
      continue;
    }
    if (b.startsWith("G04")) {
      const c = b.slice(3).trim();
      if (c.startsWith("#@!")) attrStmt(c.slice(3).trim());
      continue;
    }
    if (b === "M02" || b === "M00" || b === "M01") {
      r.ended = true;
      continue;
    }
    // a word command: G codes, D code, coordinates
    let s = b;
    for (;;) {
      const g = /^G0*(\d+)/.exec(s);
      if (!g) break;
      const code = Number(g[1]);
      s = s.slice(g[0].length);
      if (code === 1) interp = "G01";
      else if (code === 2) interp = "G02";
      else if (code === 3) interp = "G03";
      else if (code === 74) {
        quadrant = "G74";
        warn("single-quadrant arcs (G74) are read as multi-quadrant");
      } else if (code === 75) quadrant = "G75";
      else if (code === 36) {
        inRegion = true;
        region = undefined;
      } else if (code === 37) {
        closeContour();
        inRegion = false;
      } else if (code === 54 || code === 55) {
        /* aperture select prefix (deprecated) */
      } else if (code === 70) r.units = "in";
      else if (code === 71) r.units = "mm";
      else if (code === 90) {
        /* absolute */
      } else if (code === 91) r.errors.push("incremental mode (G91) is not supported");
      else warn(`G${code} ignored`);
    }
    if (!s) continue;
    const m = /^(?:X([+-]?[\d.]+))?(?:Y([+-]?[\d.]+))?(?:I([+-]?[\d.]+))?(?:J([+-]?[\d.]+))?(?:D0*(\d+))?$/.exec(s);
    if (!m) {
      r.errors.push(`unreadable command ${s}`);
      continue;
    }
    const nx = m[1] !== undefined ? toNm(m[1]) : x;
    const ny = m[2] !== undefined ? toNm(m[2]) : y;
    const ii = m[3] !== undefined ? toNm(m[3]) : 0;
    const jj = m[4] !== undefined ? toNm(m[4]) : 0;
    const d = m[5] !== undefined ? Number(m[5]) : m[1] !== undefined || m[2] !== undefined ? 1 : undefined;
    if (d === undefined) continue;
    if (d >= 10) {
      ap = d;
      if (!r.apertures.has(d)) r.errors.push(`aperture D${d} selected but not defined`);
      continue;
    }
    if (d === 2) {
      if (inRegion) {
        closeContour();
        region = [{ x: nx, y: ny }];
      }
      x = nx;
      y = ny;
      continue;
    }
    if (d === 3) {
      if (inRegion) r.errors.push("a flash inside a region");
      else if (ap === undefined) r.errors.push("a flash with no aperture selected");
      else r.objects.push({ k: "flash", ap, x: nx, y: ny, dark, attrs: { ...objDict } });
      x = nx;
      y = ny;
      continue;
    }
    if (d === 1) {
      const from = { x, y };
      const to = { x: nx, y: ny };
      let arc: GDraw["arc"];
      if (interp !== "G01") {
        if (quadrant === "G74") {
          // single quadrant: pick the signs of I, J that put the center at equal distance from both ends
          let best: { cx: number; cy: number } | undefined;
          let err = Infinity;
          for (const sx of [1, -1]) for (const sy of [1, -1]) {
            const cx = from.x + sx * Math.abs(ii);
            const cy = from.y + sy * Math.abs(jj);
            const e = Math.abs(Math.hypot(from.x - cx, from.y - cy) - Math.hypot(to.x - cx, to.y - cy));
            if (e < err) {
              err = e;
              best = { cx, cy };
            }
          }
          arc = { ...best!, ccw: interp === "G03" };
        } else arc = { cx: from.x + ii, cy: from.y + jj, ccw: interp === "G03" };
      }
      if (inRegion) {
        if (!region) region = [from];
        if (arc) for (const p of arcPoints(from, to, arc).slice(1)) region.push(p);
        else region.push(to);
      } else if (ap === undefined) r.errors.push("a draw with no aperture selected");
      else r.objects.push({ k: "draw", ap, from, to, ...(arc ? { arc } : {}), dark, attrs: { ...objDict } });
      x = nx;
      y = ny;
    }
  }
  void unitNm;
  if (!r.ended) r.errors.push("no M02 at the end of the file");
  return r;
}

/** Points along a circular draw (including both ends), about 1 degree apart or 2 micrometers of sagitta. */
export function arcPoints(from: Pt, to: Pt, arc: { cx: number; cy: number; ccw: boolean }): Pt[] {
  const r0 = Math.hypot(from.x - arc.cx, from.y - arc.cy);
  const a0 = Math.atan2(from.y - arc.cy, from.x - arc.cx);
  let a1 = Math.atan2(to.y - arc.cy, to.x - arc.cx);
  let sweep = a1 - a0;
  if (arc.ccw) {
    while (sweep <= 0) sweep += 2 * Math.PI;
  } else while (sweep >= 0) sweep -= 2 * Math.PI;
  if (from.x === to.x && from.y === to.y) sweep = arc.ccw ? 2 * Math.PI : -2 * Math.PI;
  else if (Math.abs(sweep) > 2 * Math.PI - 1e-9) sweep = 0;
  a1 = a0 + sweep;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / Math.min(Math.PI / 180, 2 * Math.acos(Math.max(-1, 1 - 2000 / Math.max(r0, 1))))));
  const out: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = a0 + (sweep * k) / steps;
    out.push(k === steps ? { x: to.x, y: to.y } : { x: Math.round(arc.cx + r0 * Math.cos(a)), y: Math.round(arc.cy + r0 * Math.sin(a)) });
  }
  return out;
}

/**
 * An aperture's shape as polygons (rings of points, nm) around its flash point: what a flash of it covers. Circles
 * become 64-gons. Exposure-off primitives are returned with `clear: true`.
 */
export function apertureShapes(read: Pick<GerberRead, "macros" | "units">, ap: GAperture): { ring: Pt[]; clear?: boolean }[] {
  const u = (v: number) => (read.units === "mm" ? v * 1e6 : v * 25.4e6);
  const circle = (cx: number, cy: number, d: number, k = 64): Pt[] => Array.from({ length: k }, (_, i) => ({ x: cx + (d / 2) * Math.cos((2 * Math.PI * i) / k), y: cy + (d / 2) * Math.sin((2 * Math.PI * i) / k) }));
  const rot = (p: Pt, deg: number): Pt => {
    const a = (deg * Math.PI) / 180;
    return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
  };
  const rect = (w: number, h: number, cx = 0, cy = 0): Pt[] => [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
  const p = ap.params;
  switch (ap.template) {
    case "C":
      return [{ ring: circle(0, 0, u(p[0])) }];
    case "R":
      return [{ ring: rect(u(p[0]), u(p[1])) }];
    case "O": {
      const w = u(p[0]);
      const h = u(p[1]);
      const r = Math.min(w, h) / 2;
      const ring: Pt[] = [];
      const k = 32;
      const [c1, c2] = w >= h ? [{ x: w / 2 - r, y: 0 }, { x: r - w / 2, y: 0 }] : [{ x: 0, y: h / 2 - r }, { x: 0, y: r - h / 2 }];
      const start = w >= h ? -Math.PI / 2 : 0;
      for (let i = 0; i <= k; i++) {
        const a = start + (Math.PI * i) / k;
        ring.push({ x: c1.x + r * Math.cos(a), y: c1.y + r * Math.sin(a) });
      }
      for (let i = 0; i <= k; i++) {
        const a = start + Math.PI + (Math.PI * i) / k;
        ring.push({ x: c2.x + r * Math.cos(a), y: c2.y + r * Math.sin(a) });
      }
      return [{ ring }];
    }
    case "P": {
      const d = u(p[0]);
      const n = Math.max(3, Math.round(p[1]));
      const a0 = p[2] ?? 0;
      return [{ ring: Array.from({ length: n }, (_, i) => rot({ x: d / 2, y: 0 }, a0 + (360 * i) / n)) }];
    }
  }
  const macro = read.macros.get(ap.template);
  if (!macro) return [];
  const vars: number[] = [];
  p.forEach((v, i) => (vars[i + 1] = v));
  const out: { ring: Pt[]; clear?: boolean }[] = [];
  for (const it of macro.items) {
    if (it.kind === "var") {
      vars[it.index] = evalExpr(it.expr, vars);
      continue;
    }
    const f = it.prim.fields.map((e) => evalExpr(e, vars));
    const clear = f[0] === 0 ? { clear: true as const } : {};
    switch (it.prim.code) {
      case 1: {
        const c = rot({ x: u(f[2]), y: u(f[3]) }, f[4] ?? 0);
        out.push({ ring: circle(c.x, c.y, u(f[1])), ...clear });
        break;
      }
      case 20: {
        const w = u(f[1]);
        const a = { x: u(f[2]), y: u(f[3]) };
        const b = { x: u(f[4]), y: u(f[5]) };
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = (-(b.y - a.y) / len) * (w / 2);
        const ny = ((b.x - a.x) / len) * (w / 2);
        out.push({ ring: [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }].map((q) => rot(q, f[6] ?? 0)), ...clear });
        break;
      }
      case 21:
        out.push({ ring: rect(u(f[1]), u(f[2]), u(f[3]), u(f[4])).map((q) => rot(q, f[5] ?? 0)), ...clear });
        break;
      case 4: {
        const n = Math.round(f[1]);
        const ring: Pt[] = [];
        for (let i = 0; i < n; i++) ring.push(rot({ x: u(f[2 + 2 * i]), y: u(f[3 + 2 * i]) }, f[2 + 2 * (n + 1)] ?? 0));
        out.push({ ring, ...clear });
        break;
      }
      case 5: {
        const n = Math.round(f[1]);
        const c = { x: u(f[2]), y: u(f[3]) };
        const d = u(f[4]);
        out.push({ ring: Array.from({ length: n }, (_, i) => rot({ x: c.x + (d / 2) * Math.cos((2 * Math.PI * i) / n), y: c.y + (d / 2) * Math.sin((2 * Math.PI * i) / n) }, f[5] ?? 0)), ...clear });
        break;
      }
      case 7: {
        // thermal: outer ring approximated as a disc with the inner disc clear (gaps not drawn)
        const c = { x: u(f[0]), y: u(f[1]) };
        out.push({ ring: circle(c.x, c.y, u(f[2])) });
        out.push({ ring: circle(c.x, c.y, u(f[3])), clear: true });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Shoelace area of a ring (absolute), square nanometers. */
export function areaOf(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return Math.abs(a / 2);
}

/** Even-odd point in ring. */
export function inRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Count of objects by kind. */
export function countObjects(read: GerberRead): { flashes: number; draws: number; arcs: number; regions: number; clear: number } {
  let flashes = 0;
  let draws = 0;
  let arcs = 0;
  let regions = 0;
  let clear = 0;
  for (const o of read.objects) {
    if (!o.dark) clear++;
    if (o.k === "flash") flashes++;
    else if (o.k === "region") regions++;
    else if (o.arc) arcs++;
    else draws++;
  }
  return { flashes, draws, arcs, regions, clear };
}
