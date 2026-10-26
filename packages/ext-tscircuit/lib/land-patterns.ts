/**
 * The provider's land-pattern table (tool-integrations.md §4): package → copper,
 * authored from the manufacturers' recommended land patterns. Each authored
 * entry carries its verification record (land-geometry.ts, LandVerification):
 * the drawing it was read from (document, page, figure) and the values the
 * drawing gives, which footprints.ts `verifyEntry` compares with the copper.
 *
 * An entry's frame is the part's mounting frame (top view, mm): where the
 * part's body origin goes on the board, so the copper and the 3D body agree.
 * The geometry helpers are in land-geometry.ts; lookup and verification in
 * footprints.ts.
 */
import { dualPads, quadPads, type FootprintEntry, type LandHole, type LandPad, type LandVerification } from "./land-geometry.ts";

const CHECKED = "2026-10-03";

/** Courtyard basis when a drawing gives none (IPC-7351B, nominal density). */
const IPC_COURTYARD = "IPC-7351B nominal density: 0.25 mm beyond the pads, holes and body (the drawing gives no courtyard)";
/** Mask basis when a drawing gives none. */
const MASK_005 = "non-solder-mask-defined, 0.05 mm all round (the drawing states no mask; the usual fab clearance)";
const PASTE_1TO1 = "1:1 on every pad (the drawing gives no stencil)";

/**
 * The courtyard round the pads, holes and the body (a box in the entry's frame), 0.25 mm beyond,
 * rounded up to 0.05 mm; and its centre when that is not the origin.
 */
function courtyard(pads: LandPad[], holes: LandHole[] = [], body?: { x: [number, number]; y: [number, number] }): { courtyard_mm: [number, number]; courtyard_at?: [number, number] } {
  const xs = [...pads.flatMap((p) => [p.x - p.w / 2, p.x + p.w / 2]), ...holes.flatMap((h) => [h.x - h.diameter_mm / 2, h.x + h.diameter_mm / 2]), ...(body?.x ?? [])];
  const ys = [...pads.flatMap((p) => [p.y - p.h / 2, p.y + p.h / 2]), ...holes.flatMap((h) => [h.y - h.diameter_mm / 2, h.y + h.diameter_mm / 2]), ...(body?.y ?? [])];
  const up = (v: number) => Math.ceil(v / 0.05 - 1e-6) * 0.05;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const [x0, x1, y0, y1] = [Math.min(...xs) - 0.25, Math.max(...xs) + 0.25, Math.min(...ys) - 0.25, Math.max(...ys) + 0.25];
  const size: [number, number] = [r(up(x1 - x0)), r(up(y1 - y0))];
  const at: [number, number] = [r((x0 + x1) / 2), r((y0 + y1) / 2)];
  return { courtyard_mm: size, ...(Math.abs(at[0]) > 1e-6 || Math.abs(at[1]) > 1e-6 ? { courtyard_at: at } : {}) };
}

/** Body box centred on the origin. */
const box = (l: number, w: number) => ({ x: [-l / 2, l / 2] as [number, number], y: [-w / 2, w / 2] as [number, number] });

/** An authored entry: courtyard from the pads, holes and body; the record's courtyard is the same. */
function authored(e: Omit<FootprintEntry, "courtyard_mm" | "courtyard_at" | "verification"> & { body?: { x: [number, number]; y: [number, number] }; record: Omit<LandVerification, "courtyard" | "checked"> & { courtyard?: LandVerification["courtyard"] } }): FootprintEntry {
  const { body, record, ...entry } = e;
  const c = courtyard(entry.pads ?? [], entry.holes ?? [], body);
  return { ...entry, ...c, verification: { ...record, checked: CHECKED, courtyard: record.courtyard ?? { size_mm: c.courtyard_mm, basis: IPC_COURTYARD } } };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const pin = (p: string | number, x: number, y: number, w: number, h: number, extra: Partial<LandPad> = {}): LandPad => ({ pin: String(p), x: r4(x), y: r4(y), w, h, ...extra });
const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(i + from));

const RP2040_DS = "https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf";
const BMI270_DS = "https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmi270-ds000.pdf";
const TPS63020_DS = "https://www.ti.com/lit/ds/symlink/tps63020.pdf";

const builtin = (pkg: string, footprinter: string, extra: Partial<FootprintEntry> = {}): FootprintEntry => ({
  id: `builtin-${footprinter}`,
  match: { package: pkg },
  footprinter,
  source: `tscircuit footprinter "${footprinter}" (@tscircuit/footprinter, MIT, built in)`,
  ...extra,
});

// ---- two-terminal chips

/** Yageo "Chip resistors mounting" Table 1, reflow: A overall, B gap, C land length, D land width. */
const YAGEO_MOUNT = { document: "Yageo data sheet Chip Resistors Mounting (referenced by the RC_L series data sheet, \"Footprint and soldering profiles\")", url: "https://sigma.octopart.com/138820526/technical_drawing/Yageo-RC0402FR-1310KL.pdf", page: 3, figure: "Table 1 \"Reflow soldering footprint dimensions\" with Fig. 4" };
/** Murata GRM specification sheets, "Land Dimensions", Table 2 (reflow). */
const MURATA_LAND = { document: "Murata GRM specification sheets, Caution \"2. Land Dimensions\" (e.g. GRM155R71C104KA88-01A, GRM188R61A106ME69)", url: "https://www.murata.com/en-us/products/productdetail?partno=GRM155R71C104KA88%23", page: "26 (GRM155R71C104KA88-01A)", figure: "Table 2 \"Reflow Soldering Method\": a (gap), b (land length), c (land width)" };

const chip = (o: { id: string; pkg: string; manufacturer: string; gap: number; length: number; width: number; body: [number, number]; record: Omit<LandVerification, "courtyard" | "checked" | "pads" | "paste" | "mask"> & { size: [[number, number], [number, number]]; row: [number, number] }; source: string }): FootprintEntry => {
  const c = o.gap / 2 + o.length / 2;
  return authored({
    id: o.id,
    match: { package: o.pkg, pin_count: 2, manufacturer: o.manufacturer },
    pads: [pin(1, -c, 0, o.length, o.width), pin(2, c, 0, o.length, o.width)],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(...o.body),
    source: o.source,
    record: {
      document: o.record.document,
      url: o.record.url,
      page: o.record.page,
      figure: o.record.figure,
      pads: [{ pins: ["1", "2"], size: o.record.size, row_mm: o.record.row }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: o.record.notes,
    },
  });
};

// ---- SOT-23 family: pins in two columns along Y (the parts' CAD frame), pin 1 at the top left

const sot = (pins: { pin: string; col: -1 | 1; y: number }[], row: number, w: number, h: number) => pins.map((p) => pin(p.pin, (p.col * row) / 2, p.y, w, h));
const SOT5 = [
  { pin: "1", col: -1, y: 0.95 },
  { pin: "2", col: -1, y: 0 },
  { pin: "3", col: -1, y: -0.95 },
  { pin: "4", col: 1, y: -0.95 },
  { pin: "5", col: 1, y: 0.95 },
] as const;
const SOT6 = [...SOT5.slice(0, 4), { pin: "5", col: 1, y: 0 }, { pin: "6", col: 1, y: 0.95 }] as const;

// ---- GCT USB-C receptacles: paired contacts are one land, drawn as two touching halves so each designator has a pad

const tails = (y: number, h: number, singles: { x: number; w: number }, pairs: { inner: number; outer: number; w: number }) => {
  const half = pairs.w / 2;
  const at = (c: number, side: -1 | 1, outer: boolean) => side * (c + (outer ? half / 2 : -half / 2));
  const single = ["B8", "A5", "B7", "A6", "A7", "B6", "A8", "B5"].map((p, i) => pin(p, -1.75 + i * singles.x, y, singles.w, h));
  const paired = [
    pin("A1", at(pairs.outer, -1, true), y, half, h),
    pin("B12", at(pairs.outer, -1, false), y, half, h),
    pin("A4", at(pairs.inner, -1, true), y, half, h),
    pin("B9", at(pairs.inner, -1, false), y, half, h),
    pin("B4", at(pairs.inner, 1, false), y, half, h),
    pin("A9", at(pairs.inner, 1, true), y, half, h),
    pin("B1", at(pairs.outer, 1, false), y, half, h),
    pin("A12", at(pairs.outer, 1, true), y, half, h),
  ];
  return [...paired, ...single];
};
const PAIRS = [["A1", "B12"], ["A4", "B9"], ["B4", "A9"], ["B1", "A12"]];
const SINGLES = ["B8", "A5", "B7", "A6", "A7", "B6", "A8", "B5"];

const USB4720 = "https://gct.co/files/drawings/usb4720.pdf";
const USB4720_TAIL_Y = 2.3; // tail-row and grounding-tag centre line, 0.30 mm behind the rear stake slots' centres (stakes at y = ±2.0)
const usb4720Pads: LandPad[] = [
  ...tails(USB4720_TAIL_Y, 0.8, { x: 0.5, w: 0.3 }, { inner: 2.43, outer: 3.28, w: 0.65 }),
  ...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => pin("SHELL", sx * 5.65, sy * 2.0, 1.0, 2.15, { drill: { w: 0.5, h: 1.65 } }))),
  pin("TAG", -4.1, USB4720_TAIL_Y, 0.8, 0.8, { drill: { w: 0.5, h: 0.5 } }),
  pin("TAG", 4.1, USB4720_TAIL_Y, 0.8, 0.8, { drill: { w: 0.5, h: 0.5 } }),
];

const USB4105 = "https://gct.co/files/drawings/usb4105.pdf";
const usb4105Pads: LandPad[] = [
  // tail inner edges 4.18 mm behind the front stake slots' centres (y = -1.075), pads 1.15 long
  ...tails(3.68, 1.15, { x: 0.5, w: 0.3 }, { inner: 2.4, outer: 3.2, w: 0.6 }),
  pin("SHELL", -4.32, -1.075, 1.0, 1.8, { drill: { w: 0.6, h: 1.4 } }),
  pin("SHELL", 4.32, -1.075, 1.0, 1.8, { drill: { w: 0.6, h: 1.4 } }),
  pin("SHELL", -4.32, 3.105, 1.0, 2.1, { drill: { w: 0.6, h: 1.7 } }),
  pin("SHELL", 4.32, 3.105, 1.0, 2.1, { drill: { w: 0.6, h: 1.7 } }),
];

// ---- Raytac MDBT50Q: pad centres from §2.2 (origin at the module's lower-left corner), the module centre at (5.25, 7.75)
const RAYTAC_POINTS: [string, number, number][] = [
  ["1", 0.6, 11.5], ["2", 0.6, 10.4], ["3", 0.6, 9.6], ["4", 0.6, 8], ["5", 1.5, 7.6], ["6", 0.6, 7.2], ["7", 1.5, 6.8], ["8", 0.6, 6.4], ["9", 1.5, 6], ["10", 0.6, 5.6],
  ["11", 1.5, 5.2], ["12", 0.6, 4.8], ["13", 1.5, 4.4], ["14", 0.6, 4], ["15", 0.45, 0.6], ["16", 1.25, 0.6], ["17", 2.05, 0.6], ["18", 2.85, 0.6], ["19", 3.25, 1.5], ["20", 3.65, 0.6],
  ["21", 4.05, 1.5], ["22", 4.45, 0.6], ["23", 4.85, 1.5], ["24", 5.25, 0.6], ["25", 5.65, 1.5], ["26", 6.05, 0.6], ["27", 6.45, 1.5], ["28", 6.85, 0.6], ["29", 7.25, 1.5], ["30", 7.65, 0.6],
  ["31", 8.45, 0.6], ["32", 9.25, 0.6], ["33", 10.05, 0.6], ["34", 9.9, 1.6], ["35", 9.9, 2.4], ["36", 9, 2.8], ["37", 9.9, 3.2], ["38", 9, 3.6], ["39", 9.9, 4], ["40", 9, 4.4],
  ["41", 9.9, 4.8], ["42", 9, 5.2], ["43", 9, 6], ["44", 9.9, 6.4], ["45", 9, 6.8], ["46", 9.9, 7.2], ["47", 9, 7.6], ["48", 9.9, 8], ["49", 9, 8.4], ["50", 9, 9.2],
  ["51", 9.9, 9.6], ["52", 9, 10], ["53", 9.9, 10.4], ["54", 9, 10.8], ["55", 9.9, 11.5], ["56", 3.25, 7.2], ["57", 4.05, 7.2], ["58", 4.85, 7.2], ["59", 5.65, 7.2], ["60", 6.45, 7.2], ["61", 7.25, 7.2],
];
// the drawing's dimension labels, transcribed independently of the pin table: left columns, right columns, rows
const RAYTAC_DRAWING: [number, number][] = [
  ...[11.5, 10.4, 9.6, 8, 7.2, 6.4, 5.6, 4.8, 4].map((y) => [0.6, y] as [number, number]),
  ...[7.6, 6.8, 6, 5.2, 4.4].map((y) => [1.5, y] as [number, number]),
  ...[10.8, 10, 9.2, 8.4, 7.6, 6.8, 6, 5.2, 4.4, 3.6, 2.8].map((y) => [9, y] as [number, number]),
  ...[11.5, 10.4, 9.6, 8, 7.2, 6.4, 4.8, 4, 3.2, 2.4, 1.6].map((y) => [9.9, y] as [number, number]),
  ...[3.25, 4.05, 4.85, 5.65, 6.45, 7.25].flatMap((x) => [[x, 7.2], [x, 1.5]] as [number, number][]),
  ...[0.45, 1.25, 2.05, 2.85, 3.65, 4.45, 5.25, 6.05, 6.85, 7.65, 8.45, 9.25, 10.05].map((x) => [x, 0.6] as [number, number]),
];
// pads in the side columns lie along X (0.6 × 0.4); pads in the rows (y = 0.6, 1.5, 7.2) are turned (0.4 × 0.6)
const raytacPads = RAYTAC_POINTS.map(([p, x, y]) => ([0.6, 1.5, 7.2].includes(y) && ![0.6, 1.5, 9, 9.9].includes(x) ? pin(p, x - 5.25, y - 7.75, 0.4, 0.6) : pin(p, x - 5.25, y - 7.75, 0.6, 0.4)));

/** The table shipped with the provider. */
export const FOOTPRINTS: FootprintEntry[] = [
  // ---- chip passives and SOT-23: tscircuit's generated patterns, the fallback for a maker with no entry below (unverified)
  builtin("0201", "0201"),
  builtin("0402", "0402"),
  builtin("0603", "0603"),
  builtin("0805", "0805"),
  builtin("1206", "1206"),
  builtin("SOT-23-5", "sot23_5", { match: { package: "SOT-23-5", pin_count: 5 } }),
  builtin("SOT-23", "sot23", { match: { package: "SOT-23", pin_count: 3 } }),
  // mating direction left to tscircuit's own inference from the pattern (+Y, the mechanical-tab side); not checked against JST's drawing
  builtin("JST SH 4-pin side entry", "jst4_p1mm_sh", { match: { package: "JST SH 4-pin side entry", pin_count: 4, pitch_mm: 1 } }),

  // ---- chip passives by maker
  chip({
    id: "yageo-rc0402-reflow",
    pkg: "0402",
    manufacturer: "Yageo",
    gap: 0.5,
    length: 0.5,
    width: 0.6,
    body: [1.0, 0.5],
    source: `${YAGEO_MOUNT.url} Table 1, 0402: A 1.5, B 0.5, C 0.5, D 0.6 (reflow)`,
    record: { ...YAGEO_MOUNT, size: [[0.5, 0.5], [0.6, 0.6]], row: [1.0, 1.0], notes: "A (1.5 overall) = B + 2C: the pad centres are 1.0 mm apart" },
  }),
  chip({
    id: "murata-grm15-reflow",
    pkg: "0402",
    manufacturer: "Murata",
    gap: 0.5,
    length: 0.4,
    width: 0.5,
    body: [1.0, 0.5],
    source: `Murata GRM15 (1.0 × 0.5) reflow land, Table 2: a 0.3-0.5 / 0.4-0.6, b 0.35-0.45 / 0.4-0.5, c 0.4-0.6 / 0.5-0.7 (dimension tolerance within ±0.10 / ±0.15-0.20); a 0.5, b 0.4, c 0.5 lies in both rows`,
    record: { ...MURATA_LAND, size: [[0.4, 0.45], [0.5, 0.6]], row: [0.8, 0.95], notes: "One land for both tolerance rows (every GRM15 part): b and c within both rows' ranges; row = a + b with a in 0.4-0.5" },
  }),
  chip({
    id: "murata-grm18-reflow",
    pkg: "0603",
    manufacturer: "Murata",
    gap: 0.8,
    length: 0.7,
    width: 0.8,
    body: [1.6, 0.8],
    source: `Murata GRM18 (1.6 × 0.8) reflow land, Table 2: a 0.6-0.8 / 0.7-0.9, b 0.6-0.7 / 0.7-0.8, c 0.6-0.8 / 0.8-1.0 (within ±0.10 / ±0.15-0.20); a 0.8, b 0.7, c 0.8 lies in both rows`,
    record: { ...MURATA_LAND, size: [[0.7, 0.7], [0.8, 0.8]], row: [1.4, 1.5], notes: "One land for both tolerance rows (every GRM18 part); row = a + b with a in 0.7-0.8" },
  }),

  // ---- RP2040 (test fixture part): pads only, no record yet
  {
    id: "qfn-56-7x7-p0.4-ep3.2",
    match: { package: "QFN-56", pin_count: 56, pitch_mm: 0.4, size_mm: [7, 7] },
    pads: [...quadPads({ perSide: 14, pitch: 0.4, row: 6.875, padLength: 0.875, padWidth: 0.2 }), { pin: "57", x: 0, y: 0, w: 3.2, h: 3.2 }],
    source: `${RP2040_DS} §5.1.2 Figure 167 "Recommended PCB Footprint for the RP2040 QFN-56 package": pads 0.20 × 0.875 at 0.40 pitch, rows 6.00 mm inside / 7.75 mm outside, centre pad 3.20 × 3.20`,
  },
  authored({
    id: "lga-14-3x2.5-p0.5-bosch",
    match: { package: "LGA-14", pin_count: 14, pitch_mm: 0.5, size_mm: [3, 2.5] },
    pads: [
      ...[1, 2, 3, 4].map((p, i) => ({ pin: String(p), x: -1.1625, y: 0.75 - i * 0.5, w: 0.475, h: 0.25 })),
      ...[5, 6, 7].map((p, i) => ({ pin: String(p), x: -0.5 + i * 0.5, y: -0.9125, w: 0.25, h: 0.475 })),
      ...[8, 9, 10, 11].map((p, i) => ({ pin: String(p), x: 1.1625, y: -0.75 + i * 0.5, w: 0.475, h: 0.25 })),
      ...[12, 13, 14].map((p, i) => ({ pin: String(p), x: 0.5 - i * 0.5, y: 0.9125, w: 0.25, h: 0.475 })),
    ],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(3.0, 2.5),
    source: `${BMI270_DS} §8.3 "Landing pattern recommendation" (BST-BMI270-DS000-08): pads 0.475 × 0.25 at 0.5 pitch, side pads' inner edges 0.925 from the centre, end pads' inner edges 0.675 from the centre, body 3.0 × 2.5`,
    record: {
      document: "Bosch Sensortec BMI270 data sheet BST-BMI270-DS000-08",
      url: BMI270_DS,
      page: 145,
      figure: "§8.3 \"Landing pattern recommendation\"",
      pads: [
        { pins: ["1", "2", "3", "4", "8", "9", "10", "11"], size: [0.475, 0.25], pitch_mm: 0.5, row_mm: 2.325 },
        { pins: ["5", "6", "7", "12", "13", "14"], size: [0.475, 0.25], pitch_mm: 0.5, row_mm: 1.825 },
      ],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "side pads' inner edges 0.925 and end pads' 0.675 from the centre: rows 2.325 (side) and 1.825 (end) apart",
    },
  }),
  authored({
    id: "vson-14-dsj-4x3-p0.5",
    match: { package: "VSON-14", pin_count: 14, pitch_mm: 0.5, size_mm: [4, 3] },
    pads: [...dualPads({ perSide: 7, pitch: 0.5, row: 2.8, padLength: 0.6, padWidth: 0.24, shape: "pill" }), { pin: "EP", x: 0, y: 0, w: 2.85, h: 1.58 }],
    paste: { margin_mm: 0, pins: { EP: { windows: [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: sx * 0.725, y: sy * 0.43, w: 1.25, h: 0.66 }))) } } },
    mask: { margin_mm: 0.07 },
    body: box(4.0, 3.0),
    source: `${TPS63020_DS} (SLVS916I) "LAND PATTERN DATA" DSJ (R-PVSON-N14), 4210895-2/E: pads 0.24 × 0.6 (R0.12) at 0.5 pitch on rows 2.8 apart; thermal pad 2.85 × 1.58 from "THERMAL PAD MECHANICAL DATA" 4208549-3/G; stencil: four 1.25 × 0.66 windows 0.2 apart`,
    record: {
      document: "TI TPS63020 data sheet SLVS916I, land pattern data 4210895-2/E and thermal pad data 4208549-3/G",
      url: TPS63020_DS,
      page: "32-33",
      figure: "DSJ (R-PVSON-N14) Example Board Layout and Example Stencil Design (0.125 mm stencil)",
      pads: [
        { pins: range(14), size: [0.24, 0.6], pitch_mm: 0.5, row_mm: 2.8 },
        { pins: ["EP"], size: [2.85, 1.58] },
      ],
      paste: { margin_mm: 0, windows: { EP: { count: 4, size: [1.25, 0.66] } }, basis: "Example Stencil Design: pin apertures 0.24 × 0.6 (1:1); the thermal pad as four 1.25 × 0.66 windows 0.2 mm apart (TI: 81 % of its centre pad)" },
      mask: { margin_mm: 0.07, basis: "Non solder mask defined pad, 0.07 all round (Example Via Layout Design)" },
      notes: "The board layout's thermal-pad side tabs (8 × 0.2) are not reproduced: the pad is the 2.85 × 1.58 exposed pad.",
    },
  }),

  // ---- TI packages
  authored({
    id: "ti-dbv0005a",
    match: { package: "SOT-23-5", pin_count: 5, manufacturer: "Texas Instruments" },
    pads: sot([...SOT5], 2.6, 1.1, 0.6),
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.07 },
    body: box(1.6, 2.9),
    source: "TI DBV0005A land pattern example 4214839/K (TPS7A02 data sheet): 5 × 1.1 × 0.6 pads, 0.95 pitch, rows 2.6 apart",
    record: {
      document: "TI DBV0005A SOT-23 package drawing 4214839/K (in the TPS7A02 data sheet SBVS277)",
      url: "https://www.ti.com/lit/ds/symlink/tps7a02.pdf",
      page: "46-47",
      figure: "Example Board Layout, Land Pattern Example (15X), and Example Stencil Design",
      pads: [{ pins: range(5), size: [1.1, 0.6], pitch_mm: 0.95, row_mm: 2.6 }],
      paste: { margin_mm: 0, basis: "Example Stencil Design: apertures the size of the pads" },
      mask: { margin_mm: 0.07, basis: "Solder mask details: non solder mask defined, 0.07 max all around (preferred)" },
    },
  }),
  authored({
    id: "ti-dgs0010a",
    match: { package: "VSSOP-10", pin_count: 10, pitch_mm: 0.5, manufacturer: "Texas Instruments" },
    pads: [...range(5).map((p, i) => pin(p, -2.2, 1.0 - i * 0.5, 1.45, 0.3)), ...range(5, 6).map((p, i) => pin(p, 2.2, -1.0 + i * 0.5, 1.45, 0.3))],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(3.0, 3.0),
    source: "TI DGS0010A land pattern example 4221984/A (DRV2605L data sheet): 10 × 1.45 × 0.3 pads, 0.5 pitch, rows 4.4 apart",
    record: {
      document: "TI DGS0010A VSSOP package drawing 4221984/A (in the DRV2605L data sheet SLOS854)",
      url: "https://www.ti.com/lit/ds/symlink/drv2605l.pdf",
      page: "71-72",
      figure: "Example Board Layout, Land Pattern Example (10X), and Example Stencil Design",
      pads: [{ pins: range(10), size: [1.45, 0.3], pitch_mm: 0.5, row_mm: 4.4 }],
      paste: { margin_mm: 0, basis: "Example Stencil Design: apertures the size of the pads" },
      mask: { margin_mm: 0.05, basis: "Solder mask details: non solder mask defined, 0.05 max all around" },
    },
  }),
  authored({
    id: "ti-rsm0032b",
    match: { package: "VQFN-32", pin_count: 32, pitch_mm: 0.4, manufacturer: "Texas Instruments" },
    pads: [...quadPads({ perSide: 8, pitch: 0.4, row: 3.85, padLength: 0.55, padWidth: 0.2 }), { pin: "33", x: 0, y: 0, w: 2.8, h: 2.8 }],
    paste: { margin_mm: 0, pins: { "33": { windows: [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: sx * 0.715, y: sy * 0.715, w: 1.23, h: 1.23 }))) } } },
    mask: { margin_mm: 0.05 },
    body: box(4.0, 4.0),
    source: "TI RSM0032B land pattern 4219108/B (LP5024 data sheet): 32 × 0.2 × 0.55 pads at 0.4 pitch, rows 3.85 apart, thermal pad 2.8 × 2.8; stencil: four 1.23 mm squares at ±0.715 (77 %)",
    record: {
      document: "TI RSM0032B VQFN package drawing 4219108/B (in the LP5024 data sheet SNVSB82)",
      url: "https://www.ti.com/lit/ds/symlink/lp5024.pdf",
      page: "54-55",
      figure: "Example Board Layout (Land Pattern Example, 20X) and Example Stencil Design (0.1 mm stencil)",
      pads: [
        { pins: range(32), size: [0.55, 0.2], pitch_mm: 0.4, row_mm: 3.85 },
        { pins: ["33"], size: [2.8, 2.8] },
      ],
      paste: { margin_mm: 0, windows: { "33": { count: 4, size: [1.23, 1.23], coverage: 0.77 } }, basis: "Solder paste example: pin apertures 1:1; exposed pad 33 as 4 × 1.23 mm squares, 77 % printed coverage" },
      mask: { margin_mm: 0.05, basis: "Non solder mask defined (preferred), 0.05 max all around" },
    },
  }),

  // ---- Microchip
  authored({
    id: "microchip-c04-2091-ot",
    match: { package: "SOT-23-5", pin_count: 5, manufacturer: "Microchip" },
    pads: sot([...SOT5], 2.8, 1.1, 0.6),
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(1.6, 2.9),
    source: "Microchip C04-2091-OT Rev F recommended land pattern (MCP73831 data sheet DS20001984H p. 24): X 0.60, Y 1.10, C 2.80, E 0.95, Z 3.90",
    record: {
      document: "Microchip MCP73831/2 data sheet DS20001984H, drawing C04-2091-OT Rev F",
      url: "https://ww1.microchip.com/downloads/en/DeviceDoc/MCP73831-Family-Data-Sheet-DS20001984H.pdf",
      page: 24,
      figure: "5-Lead SOT-23 (OT) Recommended Land Pattern",
      pads: [{ pins: range(5), size: [1.1, 0.6], pitch_mm: 0.95, row_mm: 2.8 }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "Z 3.90 overall = C + Y; G 1.70 and GX 0.35 (minimum gaps) hold",
    },
  }),
  authored({
    id: "microchip-c04-2123b-mc",
    match: { package: "DFN-8", pin_count: 8, pitch_mm: 0.5, manufacturer: "Microchip" },
    pads: [...dualPads({ perSide: 4, pitch: 0.5, row: 2.9, padLength: 0.75, padWidth: 0.3 }), { pin: "9", x: 0, y: 0, w: 1.45, h: 1.75 }],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(2.0, 3.0),
    source: "Microchip C04-2123B recommended land pattern (MCP73831 data sheet p. 21): X1 0.30, Y1 0.75, C1 2.90, E 0.50, centre pad W2 1.45 × T2 1.75 (maximum), G 0.20",
    record: {
      document: "Microchip MCP73831/2 data sheet DS20001984H, drawing C04-2123B",
      url: "https://ww1.microchip.com/downloads/en/DeviceDoc/MCP73831-Family-Data-Sheet-DS20001984H.pdf",
      page: 21,
      figure: "8-Lead DFN (MC) 2×3 Recommended Land Pattern",
      pads: [
        { pins: range(8), size: [0.3, 0.75], pitch_mm: 0.5, row_mm: 2.9 },
        { pins: ["9"], size: [[1.3, 1.45], [1.6, 1.75]] },
      ],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "W2 and T2 are maxima; the centre pad is drawn at the maxima, which leaves G = 0.20 to the pin lands",
    },
  }),

  // ---- Analog Devices (Maxim)
  authored({
    id: "maxim-90-0065-tdfn8",
    match: { package: "TDFN-8", pin_count: 8, pitch_mm: 0.5, manufacturer: "Analog Devices" },
    pads: [...dualPads({ perSide: 4, pitch: 0.5, row: 1.98, padLength: 0.7, padWidth: 0.3 }), { pin: "EP", x: 0, y: 0, w: 1.38, h: 0.8 }],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(2.0, 2.0),
    source: "Maxim land pattern 90-0065 rev E (8L TDFN 2×2, package codes T822-2/-3C/-5): 0.30 × 0.70 pads at 0.50 pitch, rows 1.98 apart, exposed pad 1.38 × 0.80",
    record: {
      document: "Maxim Integrated package land pattern 90-0065 rev E, 8L TDFN 2×2 mm (MAX17048 data sheet: package T822+3, land pattern 90-0065)",
      url: "https://www.analog.com/media/en/package-pcb-resources/land-pattern/tdfn-ep/90-0065.pdf",
      page: 1,
      figure: "Package land pattern drawing",
      pads: [
        { pins: range(8), size: [0.3, 0.7], pitch_mm: 0.5, row_mm: 1.98 },
        { pins: ["EP"], size: [1.38, 0.8] },
      ],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "Drawn with the pin rows vertical; here the rows run along X as in the part's body (pins 1-4 at -Y). The list of package codes names T822-3C; the MAX17048G+T10's T822+3 has the same outline (21-0168).",
    },
  }),
  authored({
    id: "maxim-90-0602-olga14",
    match: { package: "OESIP-14", pin_count: 14, pitch_mm: 0.8, manufacturer: "Analog Devices" },
    pads: [...range(7).map((p, i) => pin(p, -1.2, 2.4 - i * 0.8, 0.75, 0.35)), ...range(7, 8).map((p, i) => pin(p, 1.2, -2.4 + i * 0.8, 0.75, 0.35))],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(3.3, 5.6),
    source: "Maxim land pattern 90-0602 rev F (14L OLGA 3.3 × 5.6, MAX30102 package F143A5MK+1): 14 × 0.75 × 0.35 pads at 0.80 pitch, columns 2.40 apart",
    record: {
      document: "Maxim Integrated package land pattern 90-0602 rev F, 14L OLGA 3.3 × 5.6 mm (MAX30102 data sheet: land pattern 90-0602)",
      url: "https://www.analog.com/media/en/package-pcb-resources/land-pattern/olga/90-0602.pdf",
      page: 1,
      figure: "Package land pattern drawing",
      pads: [{ pins: range(14), size: [0.75, 0.35], pitch_mm: 0.8, row_mm: 2.4 }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "Span 4.80 (7 pads at 0.80) holds",
    },
  }),

  // ---- discretes
  authored({
    id: "st-sot23-6l",
    match: { package: "SOT23-6L", pin_count: 6, manufacturer: "STMicroelectronics" },
    pads: sot([...SOT6], 2.3, 1.2, 0.6),
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(1.6, 2.9),
    source: "ST USBLC6-2 data sheet DS4260 rev 6 Figure 19 \"Footprint recommendations\" (SOT23-6L): 0.60 × 1.20 pads, 0.95 pitch, rows 2.30 apart, 3.50 overall",
    record: {
      document: "ST USBLC6-2 data sheet DS4260 rev 6",
      url: "https://www.st.com/resource/en/datasheet/usblc6-2.pdf",
      page: 13,
      figure: "Figure 19. Footprint recommendations (SOT23-6L)",
      pads: [{ pins: range(6), size: [1.2, 0.6], pitch_mm: 0.95, row_mm: 2.3 }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "3.50 overall = 2.30 + 1.20",
    },
  }),
  authored({
    id: "aos-sot23-po00001",
    match: { package: "SOT23", pin_count: 3, manufacturer: "Alpha & Omega" },
    pads: [pin(1, -1.2, 0.95, 0.8, 0.8), pin(2, -1.2, -0.95, 0.8, 0.8), pin(3, 1.2, 0, 0.8, 0.8)],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(1.6, 2.9),
    source: "AOS SOT23 package outline PO-00001 rev N, recommended land pattern: 0.80 × 0.80 pads, 0.95 from the centre line, rows 2.40 apart",
    record: {
      document: "Alpha & Omega Semiconductor SOT23 package outline PO-00001 version N",
      url: "https://www.aosmd.com/res/packaging_information/SOT23.pdf",
      page: 1,
      figure: "Recommended land pattern",
      pads: [{ pins: ["1", "2", "3"], size: [0.8, 0.8], pitch_mm: 1.9, row_mm: 2.4 }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "pins 1 and 2 are 0.95 either side of the centre line (e1 1.90)",
    },
  }),
  authored({
    id: "coilcraft-xfl4020",
    match: { package: "XFL4020 4.0 x 4.0 mm SMD", pin_count: 2, manufacturer: "Coilcraft" },
    pads: [pin(1, -1.185, 0, 0.98, 3.4), pin(2, 1.185, 0, 0.98, 3.4)],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(4.0, 4.0),
    source: "Coilcraft XFL4020 document 745-3 (rev. 03/10/26) Recommended Land Pattern: 0.98 × 3.4 pads, centres 2.37 apart",
    record: {
      document: "Coilcraft XFL4020 Series, Document 745-3 (revised 03/10/26)",
      url: "https://www.coilcraft.com/getmedia/xfl4020.pdf",
      page: 3,
      figure: "Recommended Land Pattern",
      pads: [{ pins: ["1", "2"], size: [0.98, 3.4], row_mm: 2.37 }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
    },
  }),
  authored({
    id: "epson-fc-135",
    match: { package: "3.2 x 1.5 mm SMD", pin_count: 2, manufacturer: "Seiko Epson" },
    pads: [pin(1, -1.25, 0, 1.0, 1.8), pin(2, 1.25, 0, 1.0, 1.8)],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(3.2, 1.5),
    source: "Epson FC-135 application manual FC-135_E_Ver2.0 [7] Recommended Footprint: 1.0 × 1.8 pads, centres 2.5 apart; no circuit patterns between the pads",
    record: {
      document: "Seiko Epson FC-135 data sheet, Document No FC-135_E_Ver2.0",
      url: "https://download.epsondevice.com/td/pdf/app/FC-135_en.pdf",
      page: 4,
      figure: "[7] Outline Drawing and Recommended Footprint",
      pads: [{ pins: ["1", "2"], size: [1.0, 1.8], row_mm: 2.5 }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "The drawing asks for no circuit patterns in the shaded area between the pads; the provider does not enforce it (route review).",
    },
  }),
  authored({
    id: "kingbright-aptf1616",
    match: { package: "1.6 x 1.6 mm SMD LED, 4 castellated pads", pin_count: 4, manufacturer: "Kingbright" },
    pads: [pin(1, 0.85, -0.5, 0.9, 0.5), pin(2, -0.85, -0.5, 0.9, 0.5), pin(3, -0.85, 0.5, 0.9, 0.5), pin(4, 0.85, 0.5, 0.9, 0.5)],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(1.6, 1.6),
    source: "Kingbright APTF1616LSEEZGKQBKC spec DSAO4453 rev V.9B, Recommended Soldering Pattern: 4 × 0.9 × 0.5 pads, 2.6 overall in X, 1.5 in Y",
    record: {
      document: "Kingbright APTF1616LSEEZGKQBKC data sheet, Spec No DSAO4453 Rev V.9B (03/19/2025)",
      url: "https://www.kingbrightusa.com/images/catalog/SPEC/APTF1616LSEEZGKQBKC.pdf",
      page: 1,
      figure: "Recommended Soldering Pattern",
      pads: [{ pins: ["1", "2", "3", "4"], size: [0.9, 0.5], row_mm: 1.7 }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "Pad centres ±0.85 (2.6 overall less a 0.9 pad) and ±0.5 (1.5 overall less a 0.5 pad); pins as the package's top view: 3 and 4 at +Y, 2 and 1 at -Y, 1 at +X",
    },
  }),
  authored({
    id: "st-vl53l4cd-lga12",
    match: { package: "Optical LGA12", pin_count: 12, pitch_mm: 0.8, manufacturer: "STMicroelectronics" },
    pads: [
      ...[1, 2, 3, 4, 5].map((p, i) => pin(p, 1.6 - i * 0.8, -0.8, 0.5, 0.5)),
      pin(6, -1.6, 0, 0.5, 0.5),
      ...[7, 8, 9, 10, 11].map((p, i) => pin(p, -1.6 + i * 0.8, 0.8, 0.5, 0.5)),
      pin(12, 1.6, 0, 0.5, 0.5),
    ],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(4.4, 2.4),
    source: "ST VL53L4CD data sheet DS13812 rev 8 Figure 19 (outline drawing 3/5): 12 pads 0.50 square on a 0.80 grid; ST gives no separate land pattern, so the lands are the package pads 1:1 (the figure is the bottom view, mirrored here to the top view: pin 1 at +X, -Y)",
    record: {
      document: "ST VL53L4CD data sheet DS13812 rev 8 (module drawing DM00726192 rev 4.0)",
      url: "https://www.st.com/resource/en/datasheet/vl53l4cd.pdf",
      page: 23,
      figure: "Figure 19. Outline drawing (3/5): pad positions 0 / 0.80 / 1.60 / 2.40 / 3.20 and 0 / 0.80 / 1.60, □0.50 in 12 positions",
      pads: [{ pins: range(12), size: [0.5, 0.5], pitch_mm: 0.8, row_mm: 1.6 }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "The data sheet gives the module's pads, not a separate land pattern: lands equal to the pads (1:1), as ST's LGA modules are usually laid out",
    },
  }),

  // ---- switches and connectors
  authored({
    id: "alps-skrt-guide-bosses",
    match: { package: "SMD side-push TACT switch, 4.5 × 3.4 mm, with guide bosses", pin_count: 3, manufacturer: "Alps" },
    pads: [pin(1, -1.225, 0.9, 0.75, 1.8), pin(2, 0, 0.9, 0.6, 1.8), pin(3, 1.225, 0.9, 0.75, 1.8), pin("", -1.85, -1.05, 1.3, 0.9), pin("", 1.85, -1.05, 1.3, 0.9)],
    holes: [
      { x: -2.125, y: 0, diameter_mm: 0.9 },
      { x: 2.125, y: 0, diameter_mm: 0.9 },
    ],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    // the body (4.5 wide, 3.4 deep with the stem 0.84 beyond its front) from the part's CAD, in this frame
    body: { x: [-2.25, 2.25], y: [-2.05, 1.35] },
    source: "Alps Alpine SKRT series catalog (update 2510), Drawing No.1 Land Dimensions (viewed from the switch mounting face): terminal lands 0.75 / 0.6 / 0.75 × 1.8 (3.2 over pins 1 and 3), fixing-leg lands 1.3 × 0.9 (5 overall, 2.4 between), 2 × Ø0.9 holes 4.25 apart for the guide bosses on the terminal lands' lower edge; no copper tracks in the 2 × 1.2 area between the legs. Origin: the bosses' centre line, as the part's CAD mounts",
    record: {
      document: "Alps Alpine TACT Switch SKRT series catalog (update 2510)",
      url: "https://tech.alpsalpine.com/cms.media/product_catalog_ta_02_skrt_en_01ec237785.pdf",
      page: 1,
      figure: "Drawing No.1, Land Dimensions (viewed from switch mounting face)",
      pads: [
        { pins: ["1", "3"], size: [0.75, 1.8], row_mm: 2.45 },
        { pins: ["2"], size: [0.6, 1.8] },
        { pins: [""], size: [1.3, 0.9], row_mm: 3.7 },
      ],
      // 4.25 apart on the origin's line (the bosses' centre line)
      holes: [{ diameter_mm: 0.9, count: 2, plated: false, at: [[-2.125, 0], [2.125, 0]] }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "3.2 over the outer terminal lands' outer edges, so their centres are 2.45 apart; 5 over the leg lands with 2.4 between them, so their centres are 3.7 apart; the terminal lands run 1.8 up from the holes' centre line, the leg lands from 0.6 to 1.5 below it (1.5 + 1.8 = 3.3 overall). The prohibited copper area (2 × 1.2 between the legs) is not enforced by the provider (route review).",
    },
  }),
  authored({
    id: "gct-usb4720-midmount",
    match: { package: "USB4720 (USB Type-C receptacle, USB 2.0, SMT mid-mount, IP67)", pin_count: 18, manufacturer: "GCT" },
    pads: usb4720Pads,
    paste: { margin_mm: 0, plated: true },
    mask: { margin_mm: 0.05 },
    insertion: "from_bottom",
    // the body: 11.30 wide over the stake legs, from the tail lands' rear edge to the tongue tip 0.80 in front of the gasket face (y = -4.15)
    body: { x: [-5.65, 5.65], y: [-4.95, 2.7] },
    source: `${USB4720} (customer drawing USB4720 rev B, sheet 1/3) Recommended PCB Layout, 0.6 ± 0.1 mm board: 12 tail lands 0.80 long, 8 × 0.30 at 0.50 pitch and 4 × 0.65 pair lands (centres 2.43 and 3.28 from the centre line), 2 × Ø0.50 plated holes (Ø0.80 solder area) 8.20 apart on the tail line, 4 plated stake slots 0.50 × 1.65 in 1.00 × 2.15 solder areas on 11.30 mm, the rear pair 0.30 and the front pair 4.30 in front of the tail line, the board edge 1.28 in front of the front pair, the 9.05 mm cut-out's rear edge 0.55 in front of the tail line`,
    record: {
      document: "GCT USB4720 customer drawing, revision B (B PCN, 02/01/25), sheet 1/3",
      url: USB4720,
      page: 1,
      figure: "Recommended PCB Layout (Thickness 0.6 ± 0.10 mm; tolerance ±0.05)",
      pads: [
        { pins: SINGLES, size: [0.3, 0.8], pitch_mm: 0.5 },
        ...PAIRS.map((pins) => ({ pins, size: [0.65, 0.8] as [number, number], merged: true })),
      ],
      // the drawing's tail line at y = 2.30: the rear slots 0.30 and the front ones 4.30 in front of it (toward -Y), on 11.30;
      // the tag holes 8.20 apart on the tail line
      slots: [{ drill: [0.5, 1.65], pad: [1.0, 2.15], count: 4, at: [[-5.65, 2.0], [5.65, 2.0], [-5.65, -2.0], [5.65, -2.0]] }],
      holes: [{ diameter_mm: 0.5, count: 2, plated: true, pad_mm: 0.8, at: [[-4.1, 2.3], [4.1, 2.3]] }],
      paste: { margin_mm: 0, plated: true, basis: "Solder Area hatched on the tail lands, the stake slots and the tag holes: 1:1 on the lands, pin-in-paste on the slots and holes (top side)" },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "Board frame here: the stake slots' centre at the origin (the part's mount), mouth toward -Y. The 9.05 mm cut-out (rear edge at y = 1.75) and the board edge 1.28 in front of the front slots (y = -3.28) belong to the board outline (circuit.config.ts), not to the land pattern.",
    },
  }),
  authored({
    id: "gct-usb4105-topmount",
    match: { package: "USB4105 (USB Type-C receptacle, USB 2.0, SMT top mount)", pin_count: 17, manufacturer: "GCT" },
    pads: usb4105Pads,
    holes: [
      { x: -2.89, y: 2.605, diameter_mm: 0.65 },
      { x: 2.89, y: 2.605, diameter_mm: 0.65 },
    ],
    paste: { margin_mm: 0, plated: true },
    mask: { margin_mm: 0.05 },
    insertion: "from_bottom",
    body: { x: [-4.47, 4.47], y: [-3.675, 4.255] },
    source: `${USB4105} (drawing USB4105 rev B4, 18/12/23) Recommended PCB Layout, viewed from the component side: 12 tail lands 1.15 long, 8 × 0.30 at 0.50 pitch and 4 × 0.60 pair lands (centres 4.80 and 6.40 apart), 4 plated stake slots 0.60 wide on 8.64 mm (front pair 0.60 × 1.40 in 1.00 × 1.80, rear pair 0.60 × 1.70 in 1.00 × 2.10, 4.18 apart), 2 × Ø0.65 holes 5.78 apart 3.68 behind the front slots, the board edge 2.60 in front of them`,
    record: {
      document: "GCT USB4105 drawing, revision B4 (18/12/23), sheet 1/2",
      url: USB4105,
      page: 1,
      figure: "Recommended PCB Layout (as viewed from component side; tolerance ±0.05)",
      pads: [
        { pins: SINGLES, size: [0.3, 1.15], pitch_mm: 0.5 },
        ...PAIRS.map((pins) => ({ pins, size: [0.6, 1.15] as [number, number], merged: true })),
      ],
      // on 8.64: the front pair at y = -1.075 (2.60 behind the board edge at -3.675), the rear pair 4.18 behind it;
      // the peg holes 5.78 apart, 3.68 behind the front slots
      slots: [
        { drill: [0.6, 1.4], pad: [1.0, 1.8], count: 2, at: [[-4.32, -1.075], [4.32, -1.075]] },
        { drill: [0.6, 1.7], pad: [1.0, 2.1], count: 2, at: [[-4.32, 3.105], [4.32, 3.105]] },
      ],
      holes: [{ diameter_mm: 0.65, count: 2, plated: false, at: [[-2.89, 2.605], [2.89, 2.605]] }],
      paste: { margin_mm: 0, plated: true, basis: "Solder Area hatched on the tail lands and the stake slots: 1:1 on the lands, pin-in-paste on the slots (top side); the peg holes are bare" },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "Frame: the part's mount (front slots at y = -1.075, the board edge at y = -3.675). The tail lands' inner edge is on the rear slots' centre line (4.18 behind the front pair).",
    },
  }),

  // ---- modules
  authored({
    id: "espressif-esp32-c3-mini-1",
    match: { package: "ESP32-C3-MINI-1 module, 53 pins", pin_count: 53, manufacturer: "Espressif" },
    pads: [
      ...range(11).map((p, i) => pin(p, -5.9, 1.3 - i * 0.8, 0.8, 0.4)),
      ...range(13, 12).map((p, i) => pin(p, -4.8 + i * 0.8, -7.6, 0.4, 0.8)),
      ...range(11, 25).map((p, i) => pin(p, 5.9, -6.7 + i * 0.8, 0.8, 0.4)),
      ...range(13, 36).map((p, i) => pin(p, 4.8 - i * 0.8, 2.2, 0.4, 0.8)),
      pin(50, 5.95, 2.25, 0.7, 0.7),
      pin(51, 5.95, -7.65, 0.7, 0.7),
      pin(52, -5.95, -7.65, 0.7, 0.7),
      pin(53, -5.95, 2.25, 0.7, 0.7),
      // the ground pad as Espressif draws it: a 3 × 3 grid of 1.45 mm squares over 5.4 mm
      ...[-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => pin(49, i * 1.975, -2.7 + j * 1.975, 1.45, 1.45))),
    ],
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    // the module: 13.2 wide, 16.6 tall, its bottom edge 0.8 below the bottom pad row
    body: { x: [-6.6, 6.6], y: [-8.4, 8.2] },
    source: "Espressif ESP32-C3-MINI-1 & MINI-1U data sheet v2.2 Figure 11-1 Recommended PCB Land Pattern: 48 pads 0.4 × 0.8 at 0.8 pitch (columns 11.8 apart, rows 9.8 apart), 4 corner pads 0.7 × 0.7 (11.9 and 9.9 apart), 9 ground pads 1.45 × 1.45 in a 5.4 mm square; module 13.2 × 16.6 with its antenna area beyond the pads",
    record: {
      document: "Espressif ESP32-C3-MINI-1 & MINI-1U Datasheet v2.2",
      url: "https://www.espressif.com/sites/default/files/documentation/esp32-c3-mini-1_datasheet_en.pdf",
      page: 38,
      figure: "Figure 11-1. ESP32-C3-MINI-1 Recommended PCB Land Pattern",
      pads: [
        { pins: [...range(11), ...range(11, 25)], size: [0.8, 0.4], pitch_mm: 0.8, row_mm: 11.8 },
        { pins: [...range(13, 12), ...range(13, 36)], size: [0.4, 0.8], pitch_mm: 0.8, row_mm: 9.8 },
        { pins: ["50", "51", "52", "53"], size: [0.7, 0.7], row_mm: 11.9 },
        { pins: ["49"], size: [1.45, 1.45], pitch_mm: 1.975 },
      ],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "The 9 ground pads: 1.45 squares over 5.4 (pitch (5.4 - 1.45) / 2 = 1.975); the pin-1 pad's 0.6 chamfer is drawn square here. Espressif's thermal vias sit between the ground pads, not in them. Corner pads 9.9 apart in Y.",
    },
  }),
  authored({
    id: "raytac-mdbt50q",
    match: { package: "MDBT50Q module, 61 pads", pin_count: 61, manufacturer: "Raytac" },
    pads: raytacPads,
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    body: box(10.5, 15.5),
    source: "Raytac MDBT50Q-1MV2 specification Ver. L §2.2 Recommended Layout of Solder Pad (top view): 61 pads 0.6 × 0.4 mm, centres dimensioned from the module's lower-left corner; module 10.5 × 15.5 (origin here: the module centre, (5.25, 7.75) in the drawing)",
    record: {
      document: "Raytac MDBT50Q-1MV2 module specification, Ver. L",
      url: "https://www.raytac.com/download/index.php?index_id=43",
      page: 10,
      figure: "§2.2 Recommended Layout of Solder Pad, Top View (Unit: mm), x61 pad 0.6 × 0.4",
      pads: [{ pins: range(61), size: [0.6, 0.4], pitch_mm: 0.8 }],
      centres: { origin: [5.25, 7.75], points: RAYTAC_DRAWING },
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "Pads in the side columns lie along X; pads in the two inner rows and the bottom row are turned 90°. The antenna keep-out (3.8 mm, page 9) is a board keep-out in circuit.config.ts.",
    },
  }),
  authored({
    id: "eastrising-er-tft128-1-fpc",
    match: { package: "Hollow out FPC, 12 pins", pin_count: 12, pitch_mm: 0.7, manufacturer: "EastRising" },
    pads: range(12).map((p, i) => pin(p, 0, 3.85 - i * 0.7, 2.0, 0.35)),
    paste: { margin_mm: 0 },
    mask: { margin_mm: 0.05 },
    source: "EastRising ER-TFT1.28-1 data sheet §3.1 outline drawing, FPC tail: 12 contacts 0.35 wide at P0.7 (7.7 over 12), exposed in a 2.00 mm hollow-out window; EastRising gives the contacts, not a board land, so the lands equal the contacts (hot-bar soldering)",
    record: {
      document: "EastRising ER-TFT1.28-1 TFT LCD Display Datasheet (outline drawing dated Dec-02-19)",
      url: "https://www.buydisplay.com/download/manual/ER-TFT1.28-1_Datasheet.pdf",
      page: 6,
      figure: "3.1 ER-TFT1.28-1 with No Touch Panel Outline Drawing, FPC tail detail: 0.35, P0.7*(12-1)=7.7, 2.00",
      pads: [{ pins: range(12), size: [2.0, 0.35], pitch_mm: 0.7 }],
      paste: { margin_mm: 0, basis: PASTE_1TO1 },
      mask: { margin_mm: 0.05, basis: MASK_005 },
      notes: "No board land in the data sheet: the lands are the FPC's contacts (0.35 × 2.00 window) 1:1, pin 1 at +Y as the contacts number. The tail's two Ø1.0 alignment holes (10.00 apart) are not drilled in the board.",
    },
  }),
];
