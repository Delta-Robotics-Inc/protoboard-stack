/**
 * The board's stroke font: board text (silkscreen, fabrication, net names on copper) is drawn as strokes, like
 * the text a fab plots, so it stays sharp at any zoom and goes through the same instanced shapes as copper.
 * Glyphs sit on a 4 x 6 grid, y down, baseline at 6. Lowercase letters are drawn as capitals.
 */
const G: Record<string, string> = {
  0: "0,0 4,0 4,6 0,6 0,0;4,0 0,6",
  1: "1,1 2,0 2,6;1,6 3,6",
  2: "0,1 1,0 3,0 4,1 4,2 0,6 4,6",
  3: "0,0 4,0 2,2.5 3,2.5 4,3.5 4,5 3,6 1,6 0,5",
  4: "3,6 3,0 0,4 4,4",
  5: "4,0 0,0 0,2.5 3,2.5 4,3.5 4,5 3,6 0,6",
  6: "3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3.5 3,2.5 0,2.5",
  7: "0,0 4,0 1.5,6",
  8: "1,0 3,0 4,1 4,2 3,3 1,3 0,2 0,1 1,0;1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3",
  9: "4,3.5 1,3.5 0,2.5 0,1 1,0 3,0 4,1 4,5 3,6 1,6",
  A: "0,6 0,2 2,0 4,2 4,6;0,3.5 4,3.5",
  B: "0,0 0,6 3,6 4,5 4,4 3,3 0,3;0,0 3,0 4,1 4,2 3,3",
  C: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5",
  D: "0,0 0,6 2.5,6 4,4.5 4,1.5 2.5,0 0,0",
  E: "4,0 0,0 0,6 4,6;0,3 3,3",
  F: "4,0 0,0 0,6;0,3 3,3",
  G: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3.5 2,3.5",
  H: "0,0 0,6;4,0 4,6;0,3 4,3",
  I: "1,0 3,0;2,0 2,6;1,6 3,6",
  J: "1,0 4,0;3,0 3,5 2,6 1,6 0,5",
  K: "0,0 0,6;4,0 0,3.5;1.2,2.8 4,6",
  L: "0,0 0,6 4,6",
  M: "0,6 0,0 2,3 4,0 4,6",
  N: "0,6 0,0 4,6 4,0",
  O: "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0",
  P: "0,6 0,0 3,0 4,1 4,2 3,3 0,3",
  Q: "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0;2.5,4.5 4,6",
  R: "0,6 0,0 3,0 4,1 4,2 3,3 0,3;2,3 4,6",
  S: "4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5",
  T: "0,0 4,0;2,0 2,6",
  U: "0,0 0,5 1,6 3,6 4,5 4,0",
  V: "0,0 2,6 4,0",
  W: "0,0 1,6 2,3 3,6 4,0",
  X: "0,0 4,6;4,0 0,6",
  Y: "0,0 2,3 4,0;2,3 2,6",
  Z: "0,0 4,0 0,6 4,6",
  "-": "0.5,3 3.5,3",
  _: "0,6 4,6",
  "+": "0.5,3 3.5,3;2,1.5 2,4.5",
  ".": "1.8,5.6 2.2,6",
  "/": "0,6 4,0",
  "\\": "0,0 4,6",
  "(": "3,0 1.5,1.5 1.5,4.5 3,6",
  ")": "1,0 2.5,1.5 2.5,4.5 1,6",
  "[": "3,0 1.5,0 1.5,6 3,6",
  "]": "1,0 2.5,0 2.5,6 1,6",
  ":": "2,1.5 2,2;2,4.5 2,5",
  "=": "0.5,2 3.5,2;0.5,4 3.5,4",
  ",": "2,5.5 1.5,7",
  "#": "1,0 1,6;3,0 3,6;0,2 4,2;0,4 4,4",
  "*": "2,1 2,5;0.5,2 3.5,4;3.5,2 0.5,4",
  "~": "0,3.5 1,2.5 3,3.5 4,2.5",
  "?": "0,1 1,0 3,0 4,1 4,2 2,3.5 2,4.5;2,5.6 2,6",
  "!": "2,0 2,4.5;2,5.6 2,6",
  "'": "2,0 2,1.5",
  '"': "1,0 1,1.5;3,0 3,1.5",
  "%": "0,6 4,0;0.5,0.5 1,1;3,5 3.5,5.5",
  "&": "4,6 0.5,2 0.5,1 1.5,0 2.5,1 2.5,2 0,4.5 0,5 1,6 2.5,6 4,4",
  "<": "4,0.5 0,3 4,5.5",
  ">": "0,0.5 4,3 0,5.5",
  $: "4,1 0,1 0,3 4,3 4,5 0,5;2,0 2,6",
  "@": "3,4 3,2 1,2 1,4 4,4 4,1 3,0 1,0 0,1 0,5 1,6 4,6",
  "|": "2,0 2,6",
  "°": "1.5,0 2.5,0 2.5,1 1.5,1 1.5,0",
  µ: "0,2 0,7;0,5 1,6 3,6 4,5 4,2",
  Ω: "0,6 1.5,6 1.5,5 0,3.5 0,1.5 1,0 3,0 4,1.5 4,3.5 2.5,5 2.5,6 4,6",
};
const PARSED: Record<string, number[][][]> = {};
for (const [ch, s] of Object.entries(G)) PARSED[ch] = s.split(";").map((pl) => pl.trim().split(" ").map((xy) => xy.split(",").map(Number)));
const BOX = [
  [
    [0, 0],
    [4, 0],
    [4, 6],
    [0, 6],
    [0, 0],
  ],
];
/** Advance per character, in grid units (glyph 4 wide plus spacing). */
const ADVANCE = 5.6;
/** Character advance as a fraction of the cap height (the board core's text box assumes 0.6 per character). */
const ASPECT = 0.68;

/** The width of a line of text, in the units of `height` (the cap height). */
export function textWidth(text: string, height: number): number {
  const n = [...text].length;
  return n ? ((n * ADVANCE - 1.6) * height * ASPECT) / ADVANCE : 0;
}

/**
 * The strokes of one line of text as polylines (flat [x, y, ...] in millimeters, +Y up). `height` is the cap
 * height; the line is anchored at (x, y) (its vertical middle), rotated by `angle` radians counterclockwise, and
 * mirrored left to right when `mirror` (bottom-side text read from the top).
 */
export function strokeText(text: string, x: number, y: number, height: number, angle = 0, anchor: "center" | "left" | "right" = "center", mirror = false): number[][] {
  const u = height / 6;
  const ux = (height * ASPECT) / ADVANCE;
  const chars = [...text.toUpperCase()];
  const width = chars.length * ADVANCE - 1.6;
  const ox = anchor === "left" ? 0 : anchor === "right" ? -width : -width / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out: number[][] = [];
  chars.forEach((ch, i) => {
    if (ch === " ") return;
    const glyph = PARSED[ch] ?? BOX;
    for (const pl of glyph) {
      const flat: number[] = [];
      for (const [gx, gy] of pl) {
        let lx = (ox + i * ADVANCE + gx) * ux;
        const ly = (3 - gy) * u;
        if (mirror) lx = -lx;
        flat.push(x + lx * c - ly * s, y + lx * s + ly * c);
      }
      out.push(flat);
    }
  });
  return out;
}
