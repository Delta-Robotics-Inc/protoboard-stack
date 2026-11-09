/**
 * Package recognition and the height table. A footprint is classified from its library name, its reference
 * designator prefix and its pad geometry (counts, rows, pitch, extents); the body's plan size comes from the pads (or
 * from a size in the library name such as `2.0x1.6mm`, which KiCad-style names carry), and its height from the table
 * below. Every height says where it came from. Heights are typical maxima of the package outline or of common series;
 * they were not checked against the part on a given board, so a part's own height (an override) always wins.
 */
import { toMm, type FootprintRec, type Pad } from "@protoboardai/board";

export type PackageKind =
  | "chip" // two-terminal chip (resistor, capacitor, inductor, ferrite, fuse)
  | "chip-led"
  | "chip-diode"
  | "sot" // small outline transistor family, gull-wing leads on two sides
  | "so" // SOIC, SSOP, TSSOP, MSOP: gull-wing leads on two sides
  | "qfp" // gull-wing leads on four sides
  | "no-lead" // SON, DFN, QFN, LGA, WLCSP: terminals under the body
  | "box" // a rectangular body without visible leads (LED packages, crystals, inductors, sensors)
  | "module" // a radio or processor module: carrier board and shield can
  | "usb-c"
  | "usb-micro"
  | "header" // pin header or socket, through hole
  | "switch-tact"
  | "pads-only" // test points, solder jumpers, wire lands, fiducials, mounting holes: no body
  | "unknown";

export interface PadGeom {
  number: string;
  type: Pad["type"];
  /** Center and axis-aligned size in the footprint frame, mm. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  hole?: { w: number; h: number };
}

export interface PackageInfo {
  kind: PackageKind;
  /** How it was recognized, in words: "library name 'SOT-23-5'", "two equal SMD pads". */
  reason: string;
  /** Body height above the seating plane, mm. */
  height: number;
  /** Where the height came from. */
  heightSource: string;
  /** Plan size of the body (x, y in the footprint frame), mm, and its center. */
  body: { cx: number; cy: number; w: number; h: number };
  /** Whether the body is a stand-in sized from the courtyard with a default height. */
  placeholder: boolean;
  /** Size class for chips (EIA inch code) or the family name. */
  family?: string;
}

/** Padded rectangle of a pad in the footprint frame (rotation of the pad applied as a box). */
export function padGeom(p: Pad): PadGeom {
  let w: number;
  let h: number;
  if (p.type === "np") w = h = toMm(p.hole_diameter ?? 0);
  else if (p.type === "th") {
    w = toMm(p.outer_width ?? p.outer_diameter ?? 0);
    h = toMm(p.outer_height ?? p.outer_diameter ?? 0);
  } else if (p.shape === "circle") w = h = 2 * toMm(p.radius ?? 0);
  else if (p.shape === "polygon" && p.points?.length) {
    const xs = p.points.map((q) => toMm(q.x));
    const ys = p.points.map((q) => toMm(q.y));
    w = Math.max(...xs) - Math.min(...xs);
    h = Math.max(...ys) - Math.min(...ys);
  } else {
    w = toMm(p.width ?? 0);
    h = toMm(p.height ?? 0);
  }
  const rot = (((p.rotation ?? 0) / 1000) % 180 + 180) % 180;
  if (Math.abs(rot - 90) < 1e-6) [w, h] = [h, w];
  else if (rot > 1e-6) {
    const a = (rot * Math.PI) / 180;
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    [w, h] = [w * c + h * s, w * s + h * c];
  }
  const hole =
    p.type === "th" ? { w: toMm(p.hole_width ?? p.hole_diameter ?? 0), h: toMm(p.hole_height ?? p.hole_diameter ?? 0) } : p.type === "np" ? { w: toMm(p.hole_diameter ?? 0), h: toMm(p.hole_diameter ?? 0) } : undefined;
  return { number: p.number, type: p.type, cx: toMm(p.x), cy: toMm(p.y), w, h, ...(hole ? { hole } : {}) };
}

const span = (ps: PadGeom[]) => ({
  minX: Math.min(...ps.map((p) => p.cx - p.w / 2)),
  maxX: Math.max(...ps.map((p) => p.cx + p.w / 2)),
  minY: Math.min(...ps.map((p) => p.cy - p.h / 2)),
  maxY: Math.max(...ps.map((p) => p.cy + p.h / 2)),
});

// ----------------------------------------------------------------- height table

/** EIA chip size classes: span of the pad centers (upper bound), body length and width (mm, EIA nominal). */
const CHIP_CLASSES: { code: string; maxSpan: number; L: number; W: number }[] = [
  { code: "01005", maxSpan: 0.5, L: 0.4, W: 0.2 },
  { code: "0201", maxSpan: 0.8, L: 0.6, W: 0.3 },
  { code: "0402", maxSpan: 1.25, L: 1.0, W: 0.5 },
  { code: "0603", maxSpan: 1.8, L: 1.6, W: 0.8 },
  { code: "0805", maxSpan: 2.45, L: 2.0, W: 1.25 },
  { code: "1206", maxSpan: 3.6, L: 3.2, W: 1.6 },
  { code: "1812", maxSpan: 4.3, L: 4.5, W: 3.2 },
  { code: "2010", maxSpan: 5.4, L: 5.0, W: 2.5 },
  { code: "2512", maxSpan: Infinity, L: 6.3, W: 3.2 },
];

/**
 * Chip heights (mm) by kind and EIA size: the thickness a common series lists as nominal plus tolerance. Sources are
 * the series' published outlines (thick-film chip resistors: Yageo RC series; MLCC: Murata GRM series, the most
 * common thickness for the size; chip LEDs: Kingbright APT/APTD series). Typical values: a given part can differ.
 */
export const CHIP_HEIGHTS: Record<"R" | "C" | "L" | "LED", Record<string, number>> = {
  R: { "01005": 0.15, "0201": 0.28, "0402": 0.4, "0603": 0.55, "0805": 0.6, "1206": 0.65, "1812": 0.65, "2010": 0.7, "2512": 0.7 },
  C: { "01005": 0.22, "0201": 0.33, "0402": 0.55, "0603": 0.9, "0805": 1.35, "1206": 1.8, "1812": 2.7, "2010": 2.7, "2512": 2.7 },
  L: { "01005": 0.22, "0201": 0.33, "0402": 0.6, "0603": 0.9, "0805": 1.35, "1206": 1.8, "1812": 2.7, "2010": 2.7, "2512": 2.7 },
  LED: { "01005": 0.25, "0201": 0.3, "0402": 0.45, "0603": 0.8, "0805": 1.1, "1206": 1.1, "1812": 1.5, "2010": 1.5, "2512": 1.5 },
};
const CHIP_SOURCE = {
  R: "thick-film chip resistor, nominal thickness plus tolerance (Yageo RC series outline); typical",
  C: "MLCC, most common thickness for the size plus tolerance (Murata GRM series outline); typical, capacitors of high value are thicker",
  L: "chip inductor or ferrite bead, MLCC-like thickness (Murata BLM and LQG series outlines); typical",
  LED: "chip LED (Kingbright APT and APTD series outlines); typical",
};

/** Leaded and no-lead package heights (mm): the JEDEC outline's maximum seated height where one applies. */
const FAMILY_HEIGHTS: { test: RegExp; family: string; height: number; source: string; kind: PackageKind }[] = [
  { test: /sot-?23-?3|sot-?23(?![-_]?\d)|to-?236|sot23(?![-_]?\d)|sot-?23w/i, family: "SOT-23", height: 1.12, source: "JEDEC TO-236 (SOT-23), A max 1.12 mm", kind: "sot" },
  { test: /tsot|thin|ddc|sot-?23-?thin|dck|sc-?70|sot-?3[2-6]3|sot-?353|sot-?363|sc-?88/i, family: "SC-70 / thin SOT", height: 1.1, source: "JEDEC MO-203 (SC-70) and MO-193 (thin SOT), A max 1.1 mm", kind: "sot" },
  { test: /sot-?23-?[568]|sot-?26|sot-?25|dbv|sot-?457|sot-?23[a-z_-]*6/i, family: "SOT-23-5/6", height: 1.45, source: "JEDEC MO-178 (SOT-23-5, -6), A max 1.45 mm", kind: "sot" },
  { test: /sot-?89/i, family: "SOT-89", height: 1.6, source: "JEDEC TO-243 (SOT-89), A max 1.6 mm", kind: "sot" },
  { test: /sot-?223/i, family: "SOT-223", height: 1.8, source: "JEDEC TO-261 (SOT-223), A max 1.8 mm", kind: "sot" },
  { test: /sod-?123f|sod123fl|sod-?123fl/i, family: "SOD-123F", height: 1.0, source: "SOD-123F flat-lead outline, A max about 1.0 mm (Nexperia and Diodes outlines); typical", kind: "chip-diode" },
  { test: /sod-?123/i, family: "SOD-123", height: 1.35, source: "JEDEC SOD-123 outline, A max 1.35 mm", kind: "chip-diode" },
  { test: /sod-?323/i, family: "SOD-323", height: 1.1, source: "JEDEC SOD-323 outline, A max 1.1 mm", kind: "chip-diode" },
  { test: /sod-?523/i, family: "SOD-523", height: 0.7, source: "SOD-523 outline, A max 0.7 mm; typical", kind: "chip-diode" },
  { test: /sma|do-?214ac/i, family: "SMA", height: 2.3, source: "JEDEC DO-214AC (SMA), A max 2.3 mm", kind: "chip-diode" },
  { test: /tssop|htssop/i, family: "TSSOP", height: 1.2, source: "JEDEC MO-153 (TSSOP), A max 1.2 mm", kind: "so" },
  { test: /msop|vssop|dgs|dgk|ddf/i, family: "MSOP", height: 1.1, source: "JEDEC MO-187 (MSOP/VSSOP), A max 1.1 mm", kind: "so" },
  { test: /ssop/i, family: "SSOP", height: 2.0, source: "JEDEC MO-150 (SSOP), A max 2.0 mm", kind: "so" },
  { test: /soic|so-?\d|sop/i, family: "SOIC", height: 1.75, source: "JEDEC MS-012 (SOIC), A max 1.75 mm", kind: "so" },
  { test: /lqfp/i, family: "LQFP", height: 1.6, source: "JEDEC MS-026 (LQFP), A max 1.6 mm", kind: "qfp" },
  { test: /tqfp|qfp/i, family: "TQFP", height: 1.2, source: "JEDEC MS-026 (TQFP), A max 1.2 mm", kind: "qfp" },
  { test: /x2son|x2-?son|xson/i, family: "X2SON", height: 0.4, source: "X2SON outlines, A max 0.4 mm (TI package drawings); typical", kind: "no-lead" },
  { test: /wlp|wlcsp|csp|bga/i, family: "WLCSP", height: 0.6, source: "wafer-level and chip-scale packages, A max about 0.6 mm; typical", kind: "no-lead" },
  { test: /uson|uqfn|udfn/i, family: "USON/UQFN", height: 0.6, source: "JEDEC MO-288 ultra-thin outline, A max 0.6 mm", kind: "no-lead" },
  { test: /wson|wqfn|wdfn|dsg|drl|dlc|dnp/i, family: "WSON/WQFN", height: 0.8, source: "JEDEC MO-220 very-very-thin (W) outline, A max 0.8 mm", kind: "no-lead" },
  { test: /vson|vqfn|vdfn|hvqfn|tdfn|dfn|son|qfn|mlf|mlp/i, family: "QFN/DFN", height: 1.0, source: "JEDEC MO-220 and MO-229 very-thin (V) outline, A max 1.0 mm", kind: "no-lead" },
  { test: /lga|vlga/i, family: "LGA", height: 1.0, source: "sensor LGA outlines, about 1.0 mm (ST, Bosch, Infineon drawings); typical", kind: "no-lead" },
];

/** Module heights (mm) by series, from the series' datasheet outline. */
const MODULE_HEIGHTS: { test: RegExp; family: string; height: number; source: string }[] = [
  { test: /esp32-?[cs]\d-?mini|mini-?1/i, family: "ESP32 MINI-1", height: 2.4, source: "Espressif ESP32-C3/S3-MINI-1 datasheet outline, 2.4 mm" },
  { test: /wroom|wrover/i, family: "ESP32 WROOM", height: 3.1, source: "Espressif ESP32-WROOM-32E datasheet outline, 3.1 mm" },
  { test: /bmd-?3\d\d/i, family: "u-blox BMD-3xx", height: 1.9, source: "u-blox BMD-340 datasheet outline, 1.9 mm; typical" },
  { test: /module|esp32|nrf52|xbee|rfm9/i, family: "module", height: 2.5, source: "default module height 2.5 mm (assumption: no series match)" },
];

const DEFAULT_HEIGHT = 1.0;

/** Metric chip codes and their EIA inch codes. */
const METRIC: Record<string, string> = { "0402": "01005", "0603": "0201", "1005": "0402", "1608": "0603", "2012": "0805", "3216": "1206", "3225": "1206", "4532": "1812", "5025": "2010", "6332": "2512" };
/** The EIA inch size code a library name states (`C_0603_1608Metric`, `samsung-mlcc-1608`, `R0402`). */
export function chipCodeFromName(name: string): string | undefined {
  const metric = /(\d{4})[_-]?metric/i.exec(name);
  if (metric && METRIC[metric[1]]) return METRIC[metric[1]];
  for (const m of name.matchAll(/(?<!\d)(\d{4,5})(?!\d)/g)) {
    const c = m[1];
    if (["01005", "0201", "0402", "0603", "0805", "1206", "1812", "2010", "2512"].includes(c)) return c;
    if (["1005", "1608", "2012", "3216", "3225", "4532", "6332"].includes(c)) return METRIC[c];
  }
  return undefined;
}

/** A size written in a library name, such as `3x3mm`, `2.0x1.6mm` or `3.2x2.5x0.8mm`. */
export function sizeFromName(name: string): { a: number; b: number; c?: number } | undefined {
  const m = /(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?mm/i.exec(name);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!(a > 0 && b > 0 && a < 80 && b < 80)) return undefined;
  return { a, b, ...(m[3] ? { c: Number(m[3]) } : {}) };
}

const refPrefix = (ref: string) => (/^[A-Za-z]+/.exec(ref)?.[0] ?? "").toUpperCase();

/** Classify a footprint. `courtyard` is its courtyard box (mm) when it has one. */
export function classify(fp: FootprintRec, courtyard?: { minX: number; maxX: number; minY: number; maxY: number }): PackageInfo {
  const name = `${fp.footprint} ${fp.value ?? ""}`;
  const lib = fp.footprint;
  const pre = refPrefix(fp.ref);
  // pads on the part's own face (a pad on the opposite face, such as an edge finger's twin, is not under the body)
  const pads = fp.pads.filter((p) => !(p.type === "smd" && p.layer === "bottom")).map(padGeom);
  const smd = pads.filter((p) => p.type === "smd");
  const th = pads.filter((p) => p.type === "th");
  const copper = pads.filter((p) => p.type !== "np");
  const ext = copper.length ? span(copper) : courtyard ?? { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 };
  const fromCourtyard = (reason: string, height = DEFAULT_HEIGHT, heightSource = `default ${DEFAULT_HEIGHT} mm (assumption: package not recognized)`, kind: PackageKind = "unknown"): PackageInfo => {
    const b = courtyard ?? { minX: ext.minX - 0.25, maxX: ext.maxX + 0.25, minY: ext.minY - 0.25, maxY: ext.maxY + 0.25 };
    // the courtyard has a clearance of about 0.25 mm around the body; keep the body inside it
    const inset = courtyard ? 0.2 : 0;
    return { kind, reason, height, heightSource, body: { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: Math.max(0.2, b.maxX - b.minX - 2 * inset), h: Math.max(0.2, b.maxY - b.minY - 2 * inset) }, placeholder: kind === "unknown" };
  };

  if (/test.?point|fiducial|mounting.?hole|logo|battery.?pad|batterypads|hand.?solder|net.?tie|solder.?jumper|_leads_|antennaleads|cellleads|lraleads|land_swd|tag-?connect/i.test(lib) || ["TP", "FID", "MH", "LOGO", "NT", "JP"].includes(pre) || (pads.length > 0 && !copper.length)) {
    return { kind: "pads-only", reason: "no component body: test point, land, jumper or hole", height: 0, heightSource: "none", body: { cx: 0, cy: 0, w: 0, h: 0 }, placeholder: false };
  }
  if (!pads.length && !courtyard) return { kind: "pads-only", reason: "no pads and no courtyard", height: 0, heightSource: "none", body: { cx: 0, cy: 0, w: 0, h: 0 }, placeholder: false };
  if (copper.length === 1 && !th.length && !courtyard) return { kind: "pads-only", reason: "a single pad and no courtyard: a land or an edge finger, not a part", height: 0, heightSource: "none", body: { cx: 0, cy: 0, w: 0, h: 0 }, placeholder: false };

  if (/usb.?c\b|usb.?c[-_ ]|type.?c|typec|usb_c/i.test(name)) {
    const b = courtyard ?? { minX: ext.minX, maxX: ext.maxX, minY: ext.minY - 3, maxY: ext.maxY };
    return { kind: "usb-c", reason: "library name says USB Type-C", height: 3.26, heightSource: "USB Type-C receptacle shell 8.94 x 3.26 mm (USB Type-C specification receptacle outline, typical top-mount)", body: { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: b.maxX - b.minX, h: b.maxY - b.minY }, placeholder: false, family: "USB-C" };
  }
  if (/micro.?usb|usb.?micro/i.test(name)) {
    return { ...fromCourtyard("library name says micro USB", 2.8, "micro-B receptacle, about 2.8 mm (USB 2.0 micro-B outline); typical", "usb-micro"), placeholder: false };
  }
  const moduleHit = MODULE_HEIGHTS.find((m) => m.test.test(name));
  if (moduleHit && (copper.length >= 10 || /module/i.test(name))) {
    const b = courtyard ? { minX: courtyard.minX + 0.2, maxX: courtyard.maxX - 0.2, minY: courtyard.minY + 0.2, maxY: courtyard.maxY - 0.2 } : ext;
    const size = sizeFromName(lib);
    let w = b.maxX - b.minX;
    let h = b.maxY - b.minY;
    if (size) [w, h] = w >= h === size.a >= size.b ? [size.a, size.b] : [size.b, size.a];
    return { kind: "module", reason: `library name matches ${moduleHit.family}`, height: size?.c ?? moduleHit.height, heightSource: size?.c ? "height in the library name" : moduleHit.source, body: { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w, h }, placeholder: false, family: moduleHit.family };
  }
  if (th.length >= 2 && (/header|pin.?socket|pinheader|pin_header|conn_\d+x\d+|socket_strip|pin_?strip|idc/i.test(name) || ["J", "P", "CN", "X"].includes(pre))) {
    const pitch = gridPitch(th);
    if (pitch) {
      const socket = /socket|female/i.test(name);
      return { kind: "header", reason: `through-hole pins on a ${pitch} mm grid`, height: socket ? 8.5 : 2.5, heightSource: socket ? "2.54 mm pin socket body 8.5 mm (common female header outline); typical" : "2.54 mm pin header plastic base 2.5 mm, pins 6.0 mm above it (common male header outline); typical", body: { cx: (ext.minX + ext.maxX) / 2, cy: (ext.minY + ext.maxY) / 2, w: ext.maxX - ext.minX - (th[0].w - pitch), h: ext.maxY - ext.minY - (th[0].h - pitch) }, placeholder: false, family: socket ? "socket" : "header" };
    }
  }
  if (/tact|switch|button|evqp|kmr|ts-?\d{3,4}|pts\d/i.test(name) || pre === "SW" || pre === "S") {
    const size = sizeFromName(lib);
    const side = /side|edge/i.test(lib);
    const info = fromCourtyard(side ? "switch actuated from the side" : "tactile switch", side ? 1.8 : 2.5, side ? "side-actuated SMD switch, about 1.8 mm (Panasonic EVQP7 series outline); typical" : "small SMD tactile switch with plunger, 2.5 mm (common 4 x 3 mm and 5.2 x 5.2 mm outlines); typical", "switch-tact");
    if (size) [info.body.w, info.body.h] = info.body.w >= info.body.h === size.a >= size.b ? [size.a, size.b] : [size.b, size.a];
    return { ...info, placeholder: false, family: side ? "side switch" : "tact switch" };
  }
  // the library name only: values carry words such as "DNP" (do not place) that are also package codes
  const fam = FAMILY_HEIGHTS.find((f) => f.test.test(lib));
  // two equal SMD pads: a chip part
  const pairSpan = smd.length === 2 ? Math.hypot(smd[0].cx - smd[1].cx, smd[0].cy - smd[1].cy) : 0;
  if (smd.length === 2 && !th.length && pairSpan >= 0.2 && pairSpan <= 7 && Math.abs(smd[0].w - smd[1].w) < 1e-3 && Math.abs(smd[0].h - smd[1].h) < 1e-3 && (!fam || fam.kind === "chip-diode")) {
    const alongX = Math.abs(smd[0].cx - smd[1].cx) >= Math.abs(smd[0].cy - smd[1].cy);
    const d = Math.hypot(smd[0].cx - smd[1].cx, smd[0].cy - smd[1].cy);
    // the size code in the library name when it has one, else the smallest size whose body covers both pad centers
    const hinted = chipCodeFromName(lib);
    const cls = (hinted && CHIP_CLASSES.find((c) => c.code === hinted)) || CHIP_CLASSES.find((c) => c.L >= d + 0.1) || CHIP_CLASSES[CHIP_CLASSES.length - 1];
    const across = alongX ? smd[0].h : smd[0].w;
    // a wide pad on a short span (1210, 2220): widen the body
    const W = Math.max(cls.W, Math.min(across * 0.95, cls.L));
    const isLed = pre === "LED" || (pre === "D" && /led/i.test(name)) || /led/i.test(lib);
    const isDiode = !isLed && (pre === "D" || fam?.kind === "chip-diode");
    const k: "R" | "C" | "L" | "LED" = isLed ? "LED" : pre === "C" ? "C" : pre === "L" || pre === "FB" ? "L" : "R";
    const cx = (smd[0].cx + smd[1].cx) / 2;
    const cy = (smd[0].cy + smd[1].cy) / 2;
    if (isDiode && fam) {
      const L = Math.min(d + 0.6, cls.L + 1.2);
      return { kind: "chip-diode", reason: `library name matches ${fam.family}`, height: fam.height, heightSource: fam.source, body: { cx, cy, w: alongX ? L : W, h: alongX ? W : L }, placeholder: false, family: fam.family };
    }
    return {
      kind: isLed ? "chip-led" : isDiode ? "chip-diode" : "chip",
      reason: `two equal SMD pads ${d.toFixed(2)} mm apart: EIA ${cls.code}${hinted ? " (size in the library name)" : ""}`,
      height: CHIP_HEIGHTS[isDiode ? "LED" : k][cls.code],
      heightSource: `EIA ${cls.code}: ${CHIP_SOURCE[isDiode ? "LED" : k]}`,
      body: { cx, cy, w: alongX ? cls.L : W, h: alongX ? W : cls.L },
      placeholder: false,
      family: cls.code,
    };
  }
  if (fam && smd.length >= 3) {
    const size = sizeFromName(lib);
    const geo = leadedBody(smd, fam.kind, fam.family);
    if (fam.kind === "no-lead") {
      let w = ext.maxX - ext.minX;
      let h = ext.maxY - ext.minY;
      if (size) [w, h] = w >= h === size.a >= size.b ? [size.a, size.b] : [size.b, size.a];
      return { kind: "no-lead", reason: `library name matches ${fam.family}`, height: size?.c ?? fam.height, heightSource: size?.c ? "height in the library name" : fam.source, body: { cx: (ext.minX + ext.maxX) / 2, cy: (ext.minY + ext.maxY) / 2, w, h }, placeholder: false, family: fam.family };
    }
    if (geo) return { kind: fam.kind, reason: `library name matches ${fam.family}; leads from the pad rows`, height: fam.height, heightSource: fam.source, body: geo, placeholder: false, family: fam.family };
  }
  const size = sizeFromName(lib);
  if (/crystal|xtal|osc/i.test(name) || ["Y", "X"].includes(pre)) {
    const info = fromCourtyard("crystal or oscillator", size?.c ?? 0.9, size?.c ? "height in the library name" : "SMD crystal, about 0.9 mm (common 3.2 x 2.5 and 3.2 x 1.5 mm outlines); typical", "box");
    if (size) [info.body.w, info.body.h] = info.body.w >= info.body.h === size.a >= size.b ? [size.a, size.b] : [size.b, size.a];
    return { ...info, placeholder: false, family: "crystal" };
  }
  if (size && copper.length >= 2) {
    let w = Math.max(ext.maxX - ext.minX, 0.1);
    let h = Math.max(ext.maxY - ext.minY, 0.1);
    [w, h] = w >= h === size.a >= size.b ? [size.a, size.b] : [size.b, size.a];
    const height = size.c ?? (pre === "L" ? Math.min(2.0, Math.min(w, h) * 0.6) : DEFAULT_HEIGHT);
    return { kind: "box", reason: `body size ${size.a} x ${size.b} mm from the library name`, height, heightSource: size.c ? "height in the library name" : pre === "L" ? "power inductor, 0.6 x the short side up to 2 mm (assumption)" : `default ${DEFAULT_HEIGHT} mm (assumption: no height known)`, body: { cx: (ext.minX + ext.maxX) / 2, cy: (ext.minY + ext.maxY) / 2, w, h }, placeholder: !size.c && pre !== "L" };
  }
  if (fam) {
    const geo = leadedBody(smd, fam.kind, fam.family);
    if (geo) return { kind: fam.kind, reason: `library name matches ${fam.family}`, height: fam.height, heightSource: fam.source, body: geo, placeholder: false, family: fam.family };
  }
  if ((pre === "D" || pre === "LED") && copper.length >= 3) {
    return { ...fromCourtyard("LED package with several pads", 1.0, "multi-pad LED package, about 1.0 mm (assumption)", "box"), placeholder: true, family: "led" };
  }
  return fromCourtyard(courtyard ? "package not recognized: box from the courtyard" : "package not recognized: box from the pads");
}

/** The grid pitch of through-hole pads (2.54, 2.0, 1.27 mm) when they sit on one. */
function gridPitch(ps: PadGeom[]): number | undefined {
  for (const pitch of [2.54, 2.0, 1.27, 1.25, 1.0]) {
    const x0 = ps[0].cx;
    const y0 = ps[0].cy;
    if (ps.every((p) => isMultiple(p.cx - x0, pitch) && isMultiple(p.cy - y0, pitch))) return pitch;
  }
  return undefined;
}
const isMultiple = (v: number, p: number) => Math.abs(v / p - Math.round(v / p)) < 0.02;

/** Body of a leaded package from its two (or four) pad rows: inside the inner pad edges, as long as the rows. */
function leadedBody(smd: PadGeom[], kind: PackageKind, family = ""): { cx: number; cy: number; w: number; h: number } | undefined {
  if (smd.length < 3) return undefined;
  // body edge beyond the inner pad edges: SOIC pads stop well short of the body (MS-012: body 3.9 mm, pads' inner
  // edges about 3.0 mm apart); the smaller outlines' pads come close to it
  const grow = family === "SOIC" ? 0.9 : 0.3;
  const e = span(smd);
  const cx = (e.minX + e.maxX) / 2;
  const cy = (e.minY + e.maxY) / 2;
  // which axis the leads point along: the axis with the larger pad-center spread relative to pad length
  const ysTop = smd.filter((p) => p.cy > cy + 1e-6);
  const ysBot = smd.filter((p) => p.cy < cy - 1e-6);
  const xsR = smd.filter((p) => p.cx > cx + 1e-6);
  const xsL = smd.filter((p) => p.cx < cx - 1e-6);
  const rowsY = ysTop.length && ysBot.length && ysTop.length + ysBot.length >= smd.length - 1 && smd.every((p) => p.h >= p.w * 0.9 || Math.abs(p.cy - cy) > 0.3);
  const rowsX = xsR.length && xsL.length && xsR.length + xsL.length >= smd.length - 1 && smd.every((p) => p.w >= p.h * 0.9 || Math.abs(p.cx - cx) > 0.3);
  const pitchAlong = (ps: PadGeom[], axis: "cx" | "cy") => {
    const v = ps.map((p) => p[axis]).sort((a, b) => a - b);
    let m = Infinity;
    for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] > 1e-3) m = Math.min(m, v[i] - v[i - 1]);
    return Number.isFinite(m) ? m : 1;
  };
  if (kind === "qfp") {
    const inner = Math.min(...smd.map((p) => Math.max(Math.abs(p.cx - cx) - p.w / 2, Math.abs(p.cy - cy) - p.h / 2)));
    const s = 2 * (inner - 0.25);
    return { cx, cy, w: s, h: s };
  }
  if (rowsY && (!rowsX || ysTop.length >= xsR.length)) {
    const innerTop = Math.min(...ysTop.map((p) => p.cy - p.h / 2));
    const innerBot = Math.max(...ysBot.map((p) => p.cy + p.h / 2));
    const pitch = pitchAlong(smd, "cx");
    const rowSpan = Math.max(...smd.map((p) => p.cx)) - Math.min(...smd.map((p) => p.cx));
    const w = rowSpan + Math.min(pitch, 1.27) * 0.9 + 0.15;
    const h = Math.max(0.6, innerTop - innerBot + grow);
    return { cx, cy: (innerTop + innerBot) / 2, w, h };
  }
  if (rowsX) {
    const innerR = Math.min(...xsR.map((p) => p.cx - p.w / 2));
    const innerL = Math.max(...xsL.map((p) => p.cx + p.w / 2));
    const pitch = pitchAlong(smd, "cy");
    const rowSpan = Math.max(...smd.map((p) => p.cy)) - Math.min(...smd.map((p) => p.cy));
    const h = rowSpan + Math.min(pitch, 1.27) * 0.9 + 0.15;
    const w = Math.max(0.6, innerR - innerL + grow);
    return { cx: (innerR + innerL) / 2, cy, w, h };
  }
  return undefined;
}
