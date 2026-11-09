/**
 * Units of the board document: lengths are integer nanometers, angles integer millidegrees (counterclockwise
 * positive, seen from the top). Circuit JSON uses millimeters and degrees; these convert at that boundary.
 */

export const NM_PER_MM = 1_000_000;
export const MDEG_PER_DEG = 1000;
/** A full turn in millidegrees. */
export const TURN = 360_000;

/** Millimeters to integer nanometers (rounded to the nearest nanometer). */
export const mm = (value: number): number => Math.round(value * NM_PER_MM);
/** Mils (thousandths of an inch) to integer nanometers. */
export const mil = (value: number): number => Math.round(value * 25_400);
/** Integer nanometers to millimeters. */
export const toMm = (nm: number): number => nm / NM_PER_MM;
/** Degrees to integer millidegrees. */
export const deg = (value: number): number => Math.round(value * MDEG_PER_DEG);
/** Integer millidegrees to degrees. */
export const toDeg = (mdeg: number): number => mdeg / MDEG_PER_DEG;

/** A rotation normalized to [0, 360000). */
export function normAngle(mdeg: number): number {
  const r = mdeg % TURN;
  return r < 0 ? r + TURN : r === 0 ? 0 : r;
}

/** The cosine and sine of an angle in millidegrees; exact for multiples of 90 degrees. */
export function cosSin(mdeg: number): [number, number] {
  const a = normAngle(mdeg);
  if (a === 0) return [1, 0];
  if (a === 90_000) return [0, 1];
  if (a === 180_000) return [-1, 0];
  if (a === 270_000) return [0, -1];
  const r = (a / MDEG_PER_DEG) * (Math.PI / 180);
  return [Math.cos(r), Math.sin(r)];
}
