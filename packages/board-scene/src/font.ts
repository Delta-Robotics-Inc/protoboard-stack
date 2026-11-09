/**
 * A small single-stroke font, original to this package, so labels draw as paths: the SVG needs no fonts and the
 * PNG is the same on every machine. Glyphs sit on a 4 by 6 grid (y up, baseline 0); lowercase letters draw as
 * capitals; anything missing draws as `?`.
 */

const G: Record<string, string> = {
  "0": "0,0 4,0 4,6 0,6 0,0|0,0 4,6",
  "1": "1,5 2,6 2,0|1,0 3,0",
  "2": "0,5 1,6 3,6 4,5 4,4 0,0 4,0",
  "3": "0,5 1,6 3,6 4,5 4,4 3,3 4,2 4,1 3,0 1,0 0,1|1.5,3 3,3",
  "4": "3,0 3,6 0,2 4,2",
  "5": "4,6 0,6 0,3.5 3,3.5 4,2.5 4,1 3,0 0,0",
  "6": "4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2.5 3,3.5 0,3.5",
  "7": "0,6 4,6 1.5,0",
  "8": "1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3",
  "9": "0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,3.5 1,2.5 4,2.5",
  A: "0,0 0,4 2,6 4,4 4,0|0,3 4,3",
  B: "0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0",
  C: "4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1",
  D: "0,0 0,6 2.5,6 4,4.5 4,1.5 2.5,0 0,0",
  E: "4,6 0,6 0,0 4,0|0,3 3,3",
  F: "4,6 0,6 0,0|0,3 3,3",
  G: "4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3",
  H: "0,0 0,6|4,0 4,6|0,3 4,3",
  I: "1,6 3,6|2,6 2,0|1,0 3,0",
  J: "1,6 4,6|3,6 3,1 2,0 1,0 0,1",
  K: "0,0 0,6|4,6 0,2|1.3,3.3 4,0",
  L: "0,6 0,0 4,0",
  M: "0,0 0,6 2,3 4,6 4,0",
  N: "0,0 0,6 4,0 4,6",
  O: "1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0",
  P: "0,0 0,6 3,6 4,5 4,4 3,3 0,3",
  Q: "1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|2.5,1.5 4,0",
  R: "0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0",
  S: "4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1",
  T: "0,6 4,6|2,6 2,0",
  U: "0,6 0,1 1,0 3,0 4,1 4,6",
  V: "0,6 2,0 4,6",
  W: "0,6 1,0 2,3 3,0 4,6",
  X: "0,0 4,6|0,6 4,0",
  Y: "0,6 2,3 4,6|2,3 2,0",
  Z: "0,6 4,6 0,0 4,0",
  "+": "2,1 2,5|0,3 4,3",
  "-": "0.5,3 3.5,3",
  _: "0,0 4,0",
  ".": "1.7,0 2.3,0 2.3,0.6 1.7,0.6 1.7,0",
  ",": "2,0.6 2,0 1.4,-1",
  ":": "1.7,1 2.3,1 2.3,1.6 1.7,1.6 1.7,1|1.7,4 2.3,4 2.3,4.6 1.7,4.6 1.7,4",
  "/": "0,0 4,6",
  "\\": "0,6 4,0",
  "(": "3,6 1.5,4.5 1.5,1.5 3,0",
  ")": "1,6 2.5,4.5 2.5,1.5 1,0",
  "[": "3,6 1.5,6 1.5,0 3,0",
  "]": "1,6 2.5,6 2.5,0 1,0",
  "#": "1,0 1.5,6|2.5,0 3,6|0,2 4,2|0,4 4,4",
  "%": "0,0 4,6|0,6 1,6 1,5 0,5 0,6|3,1 4,1 4,0 3,0 3,1",
  "=": "0.5,2 3.5,2|0.5,4 3.5,4",
  "?": "0,5 1,6 3,6 4,5 4,4 2,2.5 2,1.5|2,0.4 2,0",
  "!": "2,6 2,1.5|2,0.4 2,0",
  "~": "0,3 1,4 3,2 4,3",
  "*": "2,1 2,5|0.5,2 3.5,4|0.5,4 3.5,2",
  ">": "0,5 4,3 0,1",
  "<": "4,5 0,3 4,1",
  "'": "2,6 2,4.5",
  '"': "1.5,6 1.5,4.5|2.5,6 2.5,4.5",
  "&": "4,0 1,4.5 1,5.5 1.5,6 2.5,6 3,5.5 3,4.5 0,2 0,1 1,0 2.5,0 4,2",
  "@": "3,2 3,4 1,4 1,2 3,2 4,2 4,5 3,6 1,6 0,5 0,1 1,0 4,0",
  "|": "2,-1 2,7",
  "^": "0,4 2,6 4,4",
  "{": "3,6 2,5.5 2,3.5 1,3 2,2.5 2,0.5 3,0",
  "}": "1,6 2,5.5 2,3.5 3,3 2,2.5 2,0.5 1,0",
  "$": "4,5 3,5.5 1,5.5 0,4.5 1,3 3,3 4,1.5 3,0.5 1,0.5 0,1|2,6.5 2,-0.5",
  " ": "",
};

const parsed = new Map<string, [number, number][][]>();
function glyph(ch: string): [number, number][][] {
  const key = G[ch] !== undefined ? ch : G[ch.toUpperCase()] !== undefined ? ch.toUpperCase() : "?";
  let g = parsed.get(key);
  if (!g) {
    g = G[key]
      ? G[key].split("|").map((s) =>
          s
            .trim()
            .split(/\s+/)
            .map((xy) => xy.split(",").map(Number) as [number, number]),
        )
      : [];
    parsed.set(key, g);
  }
  return g;
}

/** Glyph advance in grid units (glyph width 4, gap 1.5). */
export const ADVANCE = 5.5;

/** Width of a string at cap height `h`. */
export function textWidth(text: string, h: number): number {
  return text.length ? ((text.length * ADVANCE - 1.5) * h) / 6 : 0;
}

const f = (v: number): string => {
  const s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};

/**
 * Path data for `text` in screen coordinates (y down): `x`, `y` is the anchor point at the vertical middle of the
 * capitals; `anchor` aligns left, center or right; `angle` rotates clockwise on screen in degrees.
 */
export function textPath(text: string, x: number, y: number, h: number, anchor: "left" | "center" | "right" = "left", angle = 0): string {
  const u = h / 6;
  const w = textWidth(text, h);
  const x0 = anchor === "left" ? 0 : anchor === "right" ? -w : -w / 2;
  const c = Math.cos((angle * Math.PI) / 180);
  const s = Math.sin((angle * Math.PI) / 180);
  const parts: string[] = [];
  for (let k = 0; k < text.length; k++) {
    const ox = x0 + k * ADVANCE * u;
    for (const line of glyph(text[k])) {
      line.forEach(([gx, gy], i) => {
        const lx = ox + gx * u;
        const ly = -(gy - 3) * u;
        const px = x + lx * c - ly * s;
        const py = y + lx * s + ly * c;
        parts.push(`${i === 0 ? "M" : "L"}${f(px)} ${f(py)}`);
      });
    }
  }
  return parts.join("");
}
