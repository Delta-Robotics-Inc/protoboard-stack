/**
 * Drilling: the holes of a board (vias, plated pads, non-plated holes, slots), the Excellon files that carry them
 * (one per plating and layer span, or merged as a profile asks), their reader, and the drill map.
 *
 * The Excellon text follows the common dialect fabs read (decimal millimeters, absolute, `M48` header, tool table,
 * `%` end of header) with X2 attributes in comments (`; #@! TF.FileFunction,Plated,1,4,PTH`,
 * `; #@! TA.AperFunction,Plated,PTH,ViaDrill`), as Ucamco's XNC specification and the Gerber specification's drill
 * functions describe. Slots are routed paths (`G00`, `M15`, `G01`, `M16`, `G05`) or, when a profile asks, `G85`.
 */
import { copperLayers, normAngle, padsOf, recordsOfKind, rotatePoint, viaLayers, type BoardDocument, type CopperLayer } from "@protoboardai/board";
import { mmText } from "./format.js";
import type { Pt } from "./geom.js";

export interface Hole {
  x: number;
  y: number;
  /** Tool diameter (the slot's width for a slot), nm. */
  d: number;
  plated: boolean;
  /** Drill function: a via, a component lead, or a mechanical hole. */
  fn: "ViaDrill" | "ComponentDrill" | "MechanicalDrill";
  /** Copper layers the hole spans, top first. */
  span: [CopperLayer, CopperLayer];
  /** A slot: the end points of its center line (the hole's x, y is the middle). */
  slot?: { a: Pt; b: Pt };
  src: string;
  ref?: string;
  pin?: string;
  net?: string;
}

export interface DrillFile {
  /** `pth`, `npth`, `mixed`, or `pth-<i>-<j>` for a blind or buried span. */
  key: string;
  fileFunction: string;
  plated: "plated" | "nonplated" | "mixed";
  span: [number, number];
  holes: Hole[];
}

export interface DrillOptions {
  /** `separate` (default): plated and non-plated holes in their own files; `merged`: one file per span. */
  split?: "separate" | "merged";
  /** Slots as routed paths (default) or as `G85` slots. */
  slotMode?: "route" | "g85";
}

/** Every hole of a board, sorted by position (x, then y, then id). */
export function boardHoles(doc: BoardDocument): Hole[] {
  const stack = copperLayers(doc);
  const through: [CopperLayer, CopperLayer] = [stack[0], stack[stack.length - 1]];
  const holes: Hole[] = [];
  for (const v of recordsOfKind(doc, "via")) {
    const span = viaLayers(doc, v.from_layer, v.to_layer);
    holes.push({ x: v.x, y: v.y, d: v.hole_diameter, plated: true, fn: "ViaDrill", span: [span[0], span[span.length - 1]], src: v.id, ...(v.net ? { net: v.net } : {}) });
  }
  for (const fp of recordsOfKind(doc, "footprint")) {
    for (const wp of padsOf(fp, stack)) {
      const p = wp.pad;
      if (p.type === "smd") continue;
      const net = doc.padNets.get(wp.id);
      const base = { x: wp.x, y: wp.y, plated: p.type === "th", fn: (p.type === "th" ? "ComponentDrill" : "MechanicalDrill") as Hole["fn"], span: through, src: wp.id, ref: fp.ref, pin: p.number, ...(net ? { net } : {}) };
      if (p.type === "th" && p.hole_diameter === undefined && p.hole_width !== undefined && p.hole_height !== undefined) {
        const w = p.hole_width;
        const h = p.hole_height;
        const d = Math.min(w, h);
        if (w === h) {
          holes.push({ ...base, d });
          continue;
        }
        const along = normAngle(wp.rotation + (w >= h ? 0 : 90_000));
        const half = (Math.max(w, h) - d) / 2;
        const off = rotatePoint({ x: half, y: 0 }, along);
        holes.push({ ...base, d, slot: { a: { x: Math.round(wp.x - off.x), y: Math.round(wp.y - off.y) }, b: { x: Math.round(wp.x + off.x), y: Math.round(wp.y + off.y) } } });
      } else holes.push({ ...base, d: p.hole_diameter! });
    }
  }
  return holes.sort((a, b) => a.x - b.x || a.y - b.y || (a.src < b.src ? -1 : a.src > b.src ? 1 : 0));
}

/** Group holes into drill files. */
export function drillFiles(doc: BoardDocument, holes: Hole[], options: DrillOptions = {}): DrillFile[] {
  const stack = copperLayers(doc);
  const n = stack.length;
  const idx = (l: CopperLayer) => stack.indexOf(l) + 1;
  const files = new Map<string, DrillFile>();
  for (const h of holes) {
    const i = idx(h.span[0]);
    const j = idx(h.span[1]);
    const through = i === 1 && j === n;
    let key: string;
    let ff: string;
    let plating: DrillFile["plated"];
    if (!through) {
      key = `pth-${i}-${j}`;
      ff = `Plated,${i},${j},${i === 1 || j === n ? "Blind" : "Buried"}`;
      plating = "plated";
    } else if (options.split === "merged") {
      key = "mixed";
      ff = `MixedPlating,1,${n}`;
      plating = "mixed";
    } else if (h.plated) {
      key = "pth";
      ff = `Plated,1,${n},PTH`;
      plating = "plated";
    } else {
      key = "npth";
      ff = `NonPlated,1,${n},NPTH`;
      plating = "nonplated";
    }
    let f = files.get(key);
    if (!f) files.set(key, (f = { key, fileFunction: ff, plated: plating, span: [i, j], holes: [] }));
    f.holes.push(h);
  }
  const order = (k: string) => (k === "pth" ? 0 : k === "mixed" ? 0 : k === "npth" ? 1 : 2);
  return [...files.values()].sort((a, b) => order(a.key) - order(b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The drill aperture function of a hole in a file (`Plated,PTH,ViaDrill`, ...). */
export function holeFunction(file: DrillFile, h: Hole): string {
  if (file.key.startsWith("pth-")) return `Plated,${file.fileFunction.split(",")[3]},${h.fn}`;
  return h.plated ? `Plated,PTH,${h.fn}` : `NonPlated,NPTH,${h.fn}`;
}

export interface Tool {
  n: number;
  d: number;
  fn: string;
  holes: Hole[];
}

/** The tool table of a drill file: one tool per diameter and function, by diameter. */
export function toolsOf(file: DrillFile): Tool[] {
  const by = new Map<string, Tool>();
  for (const h of file.holes) {
    const fn = holeFunction(file, h);
    const k = `${String(h.d).padStart(12, "0")}|${fn}`;
    let t = by.get(k);
    if (!t) by.set(k, (t = { n: 0, d: h.d, fn, holes: [] }));
    t.holes.push(h);
  }
  const tools = [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, t]) => t);
  tools.forEach((t, i) => (t.n = i + 1));
  return tools;
}

/** Millimeters with up to 4 decimals and always a decimal point (a number without one reads as implied decimals). */
const dec = (nm: number): string => {
  const t = mmText(nm, 4);
  return t.includes(".") ? t : `${t}.0`;
};

/** Write one Excellon file. */
export function writeExcellon(file: DrillFile, options: { origin?: Pt; generator?: [string, string, string]; creationDate?: string; slotMode?: "route" | "g85"; x2?: boolean } = {}): string {
  const ox = options.origin?.x ?? 0;
  const oy = options.origin?.y ?? 0;
  const x2 = options.x2 !== false;
  const gen = options.generator ?? ["Protoboard", "board-export", "0"];
  const out = ["M48", "; DRILL file, Protoboard board-export"];
  out.push("; FORMAT={-:-/ absolute / metric / decimal}");
  if (x2) {
    if (options.creationDate) out.push(`; #@! TF.CreationDate,${options.creationDate}`);
    out.push(`; #@! TF.GenerationSoftware,${gen.join(",")}`);
    out.push(`; #@! TF.FileFunction,${file.fileFunction}`);
  }
  out.push("FMAT,2", "METRIC");
  const tools = toolsOf(file);
  for (const t of tools) {
    if (x2) out.push(`; #@! TA.AperFunction,${t.fn}`);
    out.push(`T${t.n}C${dec(t.d)}`);
  }
  out.push("%", "G90", "G05");
  const P = (p: Pt) => `X${dec(p.x - ox)}Y${dec(p.y - oy)}`;
  for (const t of tools) {
    out.push(`T${t.n}`);
    for (const h of t.holes) if (!h.slot) out.push(P(h));
    for (const h of t.holes) {
      if (!h.slot) continue;
      if (options.slotMode === "g85") out.push(`${P(h.slot.a)}G85${P(h.slot.b)}`);
      else out.push(`G00${P(h.slot.a)}`, "M15", `G01${P(h.slot.b)}`, "M16", "G05");
    }
  }
  out.push("M30");
  return `${out.join("\n")}\n`;
}

// ------------------------------------------------------------------- reading Excellon back

export interface ReadHole {
  tool: number;
  d: number;
  x: number;
  y: number;
  slot?: { a: Pt; b: Pt };
}
export interface ExcellonRead {
  fileAttrs: Record<string, string[]>;
  tools: Map<number, { d: number; attrs: Record<string, string[]> }>;
  holes: ReadHole[];
  units: "mm" | "in";
  ended: boolean;
  warnings: string[];
  errors: string[];
}

/** Read an Excellon drill file (decimal coordinates; implied-decimal coordinates read as 3.3 metric or 2.4 inch). */
export function readExcellon(text: string): ExcellonRead {
  const r: ExcellonRead = { fileAttrs: {}, tools: new Map(), holes: [], units: "mm", ended: false, warnings: [], errors: [] };
  let header = false;
  let pendingAttrs: Record<string, string[]> = {};
  let tool: number | undefined;
  let routeFrom: Pt | undefined;
  let plunged = false;
  let x = 0;
  let y = 0;
  const num = (v: string): number => {
    let val: number;
    if (v.includes(".")) val = Number(v);
    else val = Number(v) / (r.units === "mm" ? 1000 : 10_000);
    return Math.round(r.units === "mm" ? val * 1e6 : val * 25.4e6);
  };
  const coords = (s: string): Pt => {
    const mx = /X([+-]?[\d.]+)/.exec(s);
    const my = /Y([+-]?[\d.]+)/.exec(s);
    if (mx) x = num(mx[1]);
    if (my) y = num(my[1]);
    return { x, y };
  };
  const dOf = (t: number | undefined) => (t !== undefined ? (r.tools.get(t)?.d ?? 0) : 0);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(";")) {
      const c = line.slice(1).trim();
      if (c.startsWith("#@!")) {
        const a = c.slice(3).trim();
        const parts = a.slice(2).split(",");
        if (a.startsWith("TF")) r.fileAttrs[parts[0]] = parts.slice(1);
        else if (a.startsWith("TA")) pendingAttrs[parts[0]] = parts.slice(1);
      }
      continue;
    }
    if (line === "M48") {
      header = true;
      continue;
    }
    if (header) {
      if (line === "%" || line === "M95") {
        header = false;
        continue;
      }
      if (/^METRIC/.test(line)) r.units = "mm";
      else if (/^INCH/.test(line)) r.units = "in";
      const t = /^T(\d+)(?:F\d+)?(?:S\d+)?C([\d.]+)/.exec(line);
      if (t) {
        const d = Number(t[2]);
        r.tools.set(Number(t[1]), { d: Math.round(r.units === "mm" ? d * 1e6 : d * 25.4e6), attrs: pendingAttrs });
        pendingAttrs = {};
      }
      continue;
    }
    if (line === "M30" || line === "M00") {
      r.ended = true;
      continue;
    }
    const tsel = /^T(\d+)$/.exec(line);
    if (tsel) {
      tool = Number(tsel[1]);
      if (tool !== 0 && !r.tools.has(tool)) r.errors.push(`tool T${tool} used but not defined`);
      continue;
    }
    if (line === "G90" || line === "G05" || line === "G05" || line === "M71" || line === "M72") continue;
    if (line === "M15") {
      plunged = true;
      continue;
    }
    if (line === "M16" || line === "M17") {
      plunged = false;
      routeFrom = undefined;
      continue;
    }
    if (line.includes("G85")) {
      const [a, b] = line.split("G85");
      const pa = coords(a);
      const pb = coords(b);
      r.holes.push({ tool: tool ?? 0, d: dOf(tool), x: Math.round((pa.x + pb.x) / 2), y: Math.round((pa.y + pb.y) / 2), slot: { a: pa, b: pb } });
      continue;
    }
    if (line.startsWith("G00")) {
      routeFrom = coords(line);
      continue;
    }
    if (line.startsWith("G01")) {
      const p = coords(line);
      if (plunged && routeFrom) {
        r.holes.push({ tool: tool ?? 0, d: dOf(tool), x: Math.round((routeFrom.x + p.x) / 2), y: Math.round((routeFrom.y + p.y) / 2), slot: { a: routeFrom, b: p } });
        routeFrom = p;
      } else r.warnings.push("a route move outside a plunge");
      continue;
    }
    if (/^[XY]/.test(line)) {
      const p = coords(line);
      if (tool === undefined) r.errors.push("a hole with no tool selected");
      else r.holes.push({ tool, d: dOf(tool), x: p.x, y: p.y });
      continue;
    }
    r.warnings.push(`unread line: ${line.slice(0, 40)}`);
  }
  if (!r.ended) r.errors.push("no M30 at the end of the file");
  return r;
}
