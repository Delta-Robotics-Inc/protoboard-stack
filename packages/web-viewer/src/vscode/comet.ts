/**
 * The loading comet's geometry (Loading.tsx): a string of dots running round
 * the chamfered triangle the Protoboard mark sits in. The keyframes in
 * styles.css (`pb-comet-travel`) put a dot at each corner at the fraction of
 * the loop that the length run so far is of the whole; `trianglePoint` is the
 * same walk, for the frame a dot stands on without motion.
 */

/** Dots in the comet: more is a smoother trail. */
export const COMET_DOTS = 30;
/** The time between two dots (s): with the loop's duration it sets the trail's length. */
export const COMET_STEP_S = 0.016;
/** One loop round the triangle (s): the keyframes' duration in styles.css. */
export const COMET_DUR_S = 1.6;
/** How fast the tail fades: opacity = e^(-FADE · t), t from 0 at the head to 1 at the tail's end. */
export const COMET_FADE = 3;

/**
 * The chamfered triangle's corners in the comet's 100 × 100 box, closed back
 * to the first: the same points as the keyframes in styles.css.
 */
export const TRIANGLE: ReadonlyArray<readonly [number, number]> = [
  [81.2, 83.78],
  [18.8, 83.78],
  [11, 70.26],
  [18.8, 56.75],
  [42.2, 16.22],
  [57.8, 16.22],
  [65.6, 29.73],
  [89, 70.26],
];

/** The point a fraction [0, 1) of the way round the triangle, by length (the keyframes are timed the same way). */
export function trianglePoint(frac: number): [number, number] {
  const n = TRIANGLE.length;
  const seg = TRIANGLE.map((a, i) => {
    const b = TRIANGLE[(i + 1) % n];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const total = seg.reduce((s, l) => s + l, 0);
  let target = (((frac % 1) + 1) % 1) * total;
  for (let i = 0; i < n; i++) {
    if (target <= seg[i] || i === n - 1) {
      const a = TRIANGLE[i];
      const b = TRIANGLE[(i + 1) % n];
      const t = seg[i] ? target / seg[i] : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    target -= seg[i];
  }
  return [TRIANGLE[0][0], TRIANGLE[0][1]];
}

/** Each dot of the comet, head first: its size, opacity, delay and where it stands without motion. */
export function cometDots(): { size: number; opacity: number; delay: number; at: [number, number] }[] {
  return Array.from({ length: COMET_DOTS }, (_, k) => {
    const behind = (COMET_DOTS - 1 - k) * COMET_STEP_S;
    return {
      size: k === 0 ? 5 : 4,
      opacity: Math.exp(-COMET_FADE * (k / (COMET_DOTS - 1))),
      delay: -behind,
      at: trianglePoint(behind / COMET_DUR_S),
    };
  });
}
