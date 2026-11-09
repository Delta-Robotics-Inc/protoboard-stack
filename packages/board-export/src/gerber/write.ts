/**
 * Gerber RS-274X writer with X2 attributes, written from Ucamco's Gerber Layer Format Specification (revision
 * 2026.05). One plot layer in, one file's text out:
 *
 * - format 4.6 in millimeters (`%FSLAX46Y46*%`, `%MOMM*%`): a coordinate's integer is the length in nanometers, so
 *   the board's integers are written exactly;
 * - file attributes `.GenerationSoftware`, `.ProjectId`, `.SameCoordinates`, `.FileFunction`, `.FilePolarity`,
 *   `.Part`, and `.CreationDate` only when given (output is byte-identical for the same input);
 * - every pad is a flash (spec section 6.4), with `.AperFunction` on its aperture and `.N`, `.P`, `.C` object
 *   attributes (the CAD netlist of section 6.8); tracks are draws and arcs (`G75` with `I`, `J`); fills are regions,
 *   one contour each, holes joined by cut-ins;
 * - aperture macros for rotated rectangles and ovals, rounded rectangles and polygon pads;
 * - attributes either as extended commands (`%TF...*%`) or in the comment form the specification defines for legacy
 *   readers (`G04 #@! TF...*`), or left out.
 */
import { normAngle } from "@protoboardai/board";
import { degText, mmText } from "../format.js";
import type { PathPt, Pt } from "../geom.js";
import { arcCenterNm } from "../geom.js";
import type { ApertureShape, ObjAttrs, PlotLayer, PlotObj } from "../plot.js";

export interface GerberWriteOptions {
  /** Subtracted from every coordinate: the package's origin in the board frame (nm). */
  origin?: Pt;
  /** X2 attributes as extended commands (default), in the comment form, or none. */
  x2?: "attributes" | "comments" | "none";
  /** `.GenerationSoftware` vendor, application, version. */
  generator?: [string, string, string];
  /** `.ProjectId`: name, GUID, revision. */
  projectId?: [string, string, string];
  /** `.CreationDate`, written only when given (ISO 8601 with offset). */
  creationDate?: string;
  /** Plain comment lines at the top (`G04 ...*`). */
  comments?: string[];
}

/** Escape a string field of an attribute: the characters the syntax reserves become `\uXXXX`. */
export function attrText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "%" || ch === "*" || ch === "," || ch === "\\" || c < 32 || c > 126) {
      if (c > 0xffff) out += `\\U${c.toString(16).toUpperCase().padStart(8, "0")}`;
      else out += `\\u${c.toString(16).toUpperCase().padStart(4, "0")}`;
    } else out += ch;
  }
  return out;
}

const MACROS: Record<string, string[]> = {
  RoundRect: [
    "0 Rounded rectangle. $1 corner radius, $2 width, $3 height, $4 rotation in degrees",
    "21,1,$2,$3-$1-$1,0,0,$4",
    "21,1,$2-$1-$1,$3,0,0,$4",
    "1,1,$1+$1,$2/2-$1,$3/2-$1,$4",
    "1,1,$1+$1,$1-$2/2,$3/2-$1,$4",
    "1,1,$1+$1,$1-$2/2,$1-$3/2,$4",
    "1,1,$1+$1,$2/2-$1,$1-$3/2,$4",
  ],
  RotRect: ["0 Rotated rectangle. $1 width, $2 height, $3 rotation in degrees", "21,1,$1,$2,0,0,$3"],
  RotOval: ["0 Rotated oval. $1 length, $2 width (not above the length), $3 rotation in degrees", "21,1,$1-$2,$2,0,0,$3", "1,1,$2,$1/2-$2/2,0,$3", "1,1,$2,$2/2-$1/2,0,$3"],
};

const L = (nm: number) => mmText(nm, 6);

/** The aperture definition after `%ADDnn` and the macro it needs, if any. */
function apDef(ap: ApertureShape, outlineName: () => string): { def: string; macro?: { name: string; body: string[] } } {
  switch (ap.t) {
    case "C":
      return { def: `C,${L(ap.d)}` };
    case "R":
      return { def: `R,${L(ap.w)}X${L(ap.h)}` };
    case "O":
      return { def: `O,${L(ap.w)}X${L(ap.h)}` };
    case "RoundRect":
      return { def: `RoundRect,${L(ap.r)}X${L(ap.w)}X${L(ap.h)}X${degText(normAngle(ap.rot))}`, macro: { name: "RoundRect", body: MACROS.RoundRect } };
    case "RotRect":
      return { def: `RotRect,${L(ap.w)}X${L(ap.h)}X${degText(normAngle(ap.rot))}`, macro: { name: "RotRect", body: MACROS.RotRect } };
    case "RotOval":
      return { def: `RotOval,${L(ap.w)}X${L(ap.h)}X${degText(normAngle(ap.rot))}`, macro: { name: "RotOval", body: MACROS.RotOval } };
    case "Outline": {
      const name = outlineName();
      const n = ap.pts.length / 2;
      const coords: string[] = [];
      for (let i = 0; i <= n; i++) coords.push(L(ap.pts[(i % n) * 2]), L(ap.pts[(i % n) * 2 + 1]));
      return { def: name, macro: { name, body: ["0 Polygon pad outline, relative to the flash point", `4,1,${n},${coords.join(",")},0`] } };
    }
  }
}

const apKey = (ap: ApertureShape, fn: string | undefined): string => `${fn ?? ""}|${JSON.stringify(ap)}`;

/** Object attributes as name/value pairs (`.N`, `.P`, `.C`). */
function attrPairs(a: ObjAttrs | undefined): [string, string][] {
  if (!a) return [];
  const out: [string, string][] = [];
  if (a.C !== undefined) out.push([".C", attrText(a.C)]);
  if (a.N !== undefined) out.push([".N", attrText(a.N)]);
  if (a.P) out.push([".P", a.P.filter((x): x is string => x !== undefined).map(attrText).join(",")]);
  return out;
}

/** Write one plot layer as a Gerber file. */
export function writeGerber(layer: PlotLayer, options: GerberWriteOptions = {}): string {
  const ox = options.origin?.x ?? 0;
  const oy = options.origin?.y ?? 0;
  const x2 = options.x2 ?? "attributes";
  const out: string[] = [];
  const attr = (cmd: string) => {
    if (x2 === "attributes") out.push(`%${cmd}*%`);
    else if (x2 === "comments") out.push(`G04 #@! ${cmd}*`);
  };
  for (const c of options.comments ?? []) out.push(`G04 ${c.replace(/[*%]/g, " ")}*`);
  const gen = options.generator ?? ["Protoboard", "board-export", "0"];
  attr(`TF.GenerationSoftware,${gen.map(attrText).join(",")}`);
  if (options.creationDate) attr(`TF.CreationDate,${options.creationDate}`);
  if (options.projectId) attr(`TF.ProjectId,${options.projectId.map(attrText).join(",")}`);
  attr("TF.SameCoordinates,Original");
  attr(`TF.FileFunction,${layer.fileFunction}`);
  attr(`TF.FilePolarity,${layer.polarity}`);
  attr("TF.Part,Single");
  out.push("%FSLAX46Y46*%", "%MOMM*%", "%LPD*%");

  // apertures in order of first use
  const aps = new Map<string, { code: number; def: string; fn?: string }>();
  const macros = new Map<string, string[]>();
  let outlines = 0;
  let next = 10;
  const apOf = (o: PlotObj): string | undefined => {
    if (o.k === "region") return undefined;
    const shape: ApertureShape = o.k === "draw" ? { t: "C", d: o.width } : o.ap;
    const key = apKey(shape, o.fn);
    if (!aps.has(key)) {
      const d = apDef(shape, () => `Outline${outlines++}`);
      if (d.macro && !macros.has(d.macro.name)) macros.set(d.macro.name, d.macro.body);
      aps.set(key, { code: next++, def: d.def, ...(o.fn ? { fn: o.fn } : {}) });
    }
    return key;
  };
  for (const o of layer.objects) apOf(o);
  for (const [name, body] of macros) out.push(`%AM${name}*`, ...body.map((l, i) => `${l}*${i === body.length - 1 ? "%" : ""}`));
  for (const a of aps.values()) {
    if (a.fn) attr(`TA.AperFunction,${a.fn}`);
    out.push(`%ADD${a.code}${a.def}*%`);
    if (a.fn) attr("TD.AperFunction");
  }

  // body
  const xy = (p: Pt) => `X${p.x - ox}Y${p.y - oy}`;
  let cur: number | undefined;
  let mode: "G01" | "G02" | "G03" | undefined;
  let clear = false;
  let multi = false;
  const dict = new Map<string, string>();
  const setDict = (want: [string, string][]) => {
    const w = new Map(want);
    for (const k of [...dict.keys()]) if (!w.has(k)) {
      attr(k === ".AperFunction" ? "TD.AperFunction" : `TD${k}`);
      dict.delete(k);
    }
    for (const [k, v] of want) if (dict.get(k) !== v) {
      attr(k === ".AperFunction" ? `TA.AperFunction,${v}` : `TO${k},${v}`);
      dict.set(k, v);
    }
  };
  const setMode = (m: "G01" | "G02" | "G03") => {
    if (mode !== m) out.push(`${m}*`);
    mode = m;
  };
  const segment = (from: Pt, p: PathPt) => {
    if (p.sweep === undefined) {
      setMode("G01");
      out.push(`${xy(p)}D01*`);
      return;
    }
    if (!multi) {
      out.push("G75*");
      multi = true;
    }
    const c = arcCenterNm(from, p, p.sweep);
    setMode(p.sweep > 0 ? "G03" : "G02");
    out.push(`${xy(p)}I${c.x - from.x}J${c.y - from.y}D01*`);
  };
  for (const o of layer.objects) {
    if (!!o.clear !== clear) {
      clear = !!o.clear;
      out.push(clear ? "%LPC*%" : "%LPD*%");
    }
    if (o.k === "region") {
      setDict([...(o.fn ? ([[".AperFunction", o.fn]] as [string, string][]) : []), ...attrPairs(o.attrs)]);
      out.push("G36*");
      out.push(`${xy(o.ring[0])}D02*`);
      setMode("G01");
      for (let i = 1; i < o.ring.length; i++) out.push(`${xy(o.ring[i])}D01*`);
      out.push(`${xy(o.ring[0])}D01*`);
      out.push("G37*");
      continue;
    }
    setDict(attrPairs(o.attrs));
    const code = aps.get(apOf(o)!)!.code;
    if (cur !== code) {
      out.push(`D${code}*`);
      cur = code;
    }
    if (o.k === "flash") {
      out.push(`${xy(o)}D03*`);
      continue;
    }
    out.push(`${xy(o.path[0])}D02*`);
    for (let i = 1; i < o.path.length; i++) segment(o.path[i - 1], o.path[i]);
  }
  if (dict.size) attr("TD");
  if (clear) out.push("%LPD*%");
  out.push("M02*");
  return `${out.join("\n")}\n`;
}
