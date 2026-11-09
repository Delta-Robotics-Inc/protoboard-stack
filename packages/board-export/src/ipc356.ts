/**
 * IPC-D-356A netlist for bare-board electrical test: one fixed-column test record per pad and via, from the board
 * document. Column layout (1-based): 1-3 record type (`317` drilled, `327` surface, `367` non-plated hole), 4-17 net
 * name, 21-26 reference designator (`VIA` for vias), 27 `-`, 28-31 pin, 32 `M` for a via, 33-38 hole (`D` + 4 digits,
 * `P` plated or `U` not), 39-41 access (`A00` both sides, `A01` top, `A0n` layer n), 42-49 and 50-57 X and Y (sign + 6
 * digits), 58-62 and 63-67 feature width and height, 68-71 rotation, 72-73 solder mask (`S0` exposed both sides,
 * `S1` covered on the top, `S2` covered on the bottom, `S3` both). Units `CUST 0`: 0.0001 inch and degrees, the form
 * kicad-cli also writes, so the two can be compared column by column. Net names longer than 14 characters, or with
 * spaces, go through `NNAME` aliases.
 */
import { copperLayers, normAngle, padsOf, recordsOfKind, toDeg, viaLayers, type BoardDocument } from "@protoboardai/board";
import type { Pt } from "./geom.js";

const TENTH_MIL = 2540; // nm per 0.0001 inch

const num = (nm: number, digits: number, signed: boolean): string => {
  const v = Math.round(Math.abs(nm) / TENTH_MIL);
  const s = String(Math.min(v, 10 ** digits - 1)).padStart(digits, "0");
  return signed ? `${nm < 0 && v !== 0 ? "-" : "+"}${s}` : s;
};
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

export interface Ipc356Record {
  type: "317" | "327" | "367";
  net: string;
  ref: string;
  pin: string;
  via: boolean;
  /** Hole diameter nm (drilled records). */
  hole?: number;
  plated?: boolean;
  access: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  mask: number;
}

/** The test records of a board (pads by footprint then pad order, vias by id). */
export function ipc356Records(doc: BoardDocument): Ipc356Record[] {
  const stack = copperLayers(doc);
  const n = stack.length;
  const out: Ipc356Record[] = [];
  const fps = recordsOfKind(doc, "footprint").sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  for (const fp of fps) {
    for (const wp of padsOf(fp, stack)) {
      const p = wp.pad;
      const net = doc.padNets.get(wp.id) ?? "N/C";
      const rot = Math.round(toDeg(normAngle(wp.rotation))) % 360;
      if (p.type === "smd") {
        const top = wp.layers[0] === stack[0];
        const [w, h] = p.shape === "circle" ? [2 * p.radius!, 2 * p.radius!] : p.shape === "polygon" ? polygonSize(p.points ?? []) : [p.width!, p.height!];
        out.push({ type: "327", net, ref: fp.ref, pin: p.number, via: false, access: top ? 1 : n, x: wp.x, y: wp.y, w, h, rotation: rot, mask: top ? 2 : 1 });
      } else if (p.type === "th") {
        const [w, h] = p.shape === "circle" ? [p.outer_diameter!, p.outer_diameter!] : [p.outer_width!, p.outer_height!];
        const hole = p.hole_diameter ?? Math.min(p.hole_width ?? 0, p.hole_height ?? 0);
        out.push({ type: "317", net, ref: fp.ref, pin: p.number, via: false, hole, plated: true, access: 0, x: wp.x, y: wp.y, w, h, rotation: rot, mask: 0 });
      } else out.push({ type: "367", net: "N/C", ref: fp.ref, pin: p.number, via: false, hole: p.hole_diameter!, plated: false, access: 0, x: wp.x, y: wp.y, w: p.hole_diameter!, h: p.hole_diameter!, rotation: 0, mask: 0 });
    }
  }
  const vias = recordsOfKind(doc, "via").sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const v of vias) {
    const span = viaLayers(doc, v.from_layer, v.to_layer);
    const top = span[0] === stack[0];
    const bot = span[span.length - 1] === stack[n - 1];
    const tent = v.tented ?? "both";
    const covTop = !top || tent === "both" || tent === "top";
    const covBot = !bot || tent === "both" || tent === "bottom";
    const access = top && bot ? 0 : top ? 1 : bot ? n : stack.indexOf(span[0]) + 1;
    out.push({ type: "317", net: v.net ?? "N/C", ref: "VIA", pin: "", via: true, hole: v.hole_diameter, plated: true, access, x: v.x, y: v.y, w: v.outer_diameter, h: v.outer_diameter, rotation: 0, mask: (covTop ? 1 : 0) + (covBot ? 2 : 0) });
  }
  return out;
}

function polygonSize(pts: readonly Pt[]): [number, number] {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/** Write an IPC-D-356A file. */
export function writeIpc356(doc: BoardDocument, options: { origin?: Pt; job?: string } = {}): string {
  const ox = options.origin?.x ?? 0;
  const oy = options.origin?.y ?? 0;
  const recs = ipc356Records(doc);
  const lines = ["C  IPC-D-356A netlist, written by Protoboard board-export", "C  coordinates relative to the package origin, +Y up, seen from the top"];
  if (options.job) lines.push(`P  JOB ${options.job.replace(/[^\x20-\x7e]/g, "?").slice(0, 60)}`);
  lines.push("P  CODE 00", "P  UNITS CUST 0");
  // aliases for names that do not fit
  const alias = new Map<string, string>();
  const names = [...new Set(recs.map((r) => r.net))].sort();
  for (const nm of names) if (nm.length > 14 || /\s|[^\x20-\x7e]/.test(nm)) alias.set(nm, `NNAME${alias.size + 1}`);
  for (const [nm, a] of alias) lines.push(`P  ${a.padEnd(10)} ${nm.replace(/[^\x20-\x7e]/g, "?")}`);
  for (const r of recs) {
    const net = alias.get(r.net) ?? r.net;
    let s = r.type + pad(net, 14) + "   " + pad(r.ref, 6) + (r.via ? " " : "-") + pad(r.pin, 4) + (r.via ? "M" : " ");
    s += r.hole !== undefined ? `D${num(r.hole, 4, false)}${r.plated ? "P" : "U"}` : "      ";
    s += `A${String(r.access).padStart(2, "0")}`;
    s += `X${num(r.x - ox, 6, true)}Y${num(r.y - oy, 6, true)}`;
    s += `X${num(r.w, 4, false)}Y${num(r.h, 4, false)}R${String(r.rotation).padStart(3, "0")}S${r.mask}`;
    lines.push(s);
  }
  lines.push("999");
  return `${lines.join("\n")}\n`;
}

export interface Ipc356Read {
  aliases: Map<string, string>;
  records: { type: string; net: string; ref: string; pin: string; via: boolean; hole?: number; plated?: boolean; access: number; x: number; y: number; w: number; h: number; rotation: number; mask: string }[];
  units: string;
  ended: boolean;
  errors: string[];
}

/** Read an IPC-D-356A file by its columns (lengths come back in nm). */
export function readIpc356(text: string): Ipc356Read {
  const r: Ipc356Read = { aliases: new Map(), records: [], units: "", ended: false, errors: [] };
  const v = (s: string, nm = true) => {
    const t = s.trim();
    if (!t) return 0;
    const n = Number(t);
    return nm ? n * TENTH_MIL : n;
  };
  for (const raw of text.split(/\r?\n/)) {
    if (!raw) continue;
    if (raw.startsWith("999")) {
      r.ended = true;
      continue;
    }
    if (raw.startsWith("C")) continue;
    if (raw.startsWith("P")) {
      const m = /^P\s+(NNAME\d+)\s+(.*)$/.exec(raw);
      if (m) r.aliases.set(m[1], m[2].trim());
      const u = /^P\s+UNITS\s+(.*)$/.exec(raw);
      if (u) r.units = u[1].trim();
      continue;
    }
    const type = raw.slice(0, 3);
    if (!/^3[0-9]7$/.test(type)) continue;
    const netRaw = raw.slice(3, 17).trim();
    const hole = raw.slice(32, 38);
    const rec = {
      type,
      net: r.aliases.get(netRaw) ?? netRaw,
      ref: raw.slice(20, 26).trim(),
      pin: raw.slice(27, 31).trim(),
      via: raw[31] === "M",
      ...(hole[0] === "D" ? { hole: v(hole.slice(1, 5)), plated: hole[5] === "P" } : {}),
      access: Number(raw.slice(39, 41)),
      x: v(raw.slice(42, 49)),
      y: v(raw.slice(50, 57)),
      w: v(raw.slice(58, 62)),
      h: v(raw.slice(63, 67)),
      rotation: Number(raw.slice(68, 71)),
      mask: raw.slice(72, 74).trim(),
    };
    if (raw[41] !== "X" || raw[49] !== "Y") r.errors.push(`record with coordinates out of their columns: ${raw.slice(0, 30)}`);
    r.records.push(rec);
  }
  if (!r.ended) r.errors.push("no 999 end record");
  return r;
}
