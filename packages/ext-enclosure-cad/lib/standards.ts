/**
 * Standard dimensions the enclosure provider designs to, each with its
 * source. These are the provider's own tables (tool-integrations.md §4): a
 * module states which O-ring, insert or spring bar it uses; the numbers
 * behind the name come from here, and a module may override any of them.
 *
 * Values marked `assumption` are design choices, not read from a source.
 */

export interface Cited {
  source: string;
  assumption?: string;
}

/** Parker O-Ring Handbook, catalog ORD 5700A/US (2001 edition). */
export const PARKER_ORD_5700 = "Parker O-Ring Handbook ORD 5700A/US (2001), http://robots.engin.umich.edu/uploads/ORD5700.pdf";

const IN = 25.4;
const mm = (inches: number) => Math.round(inches * IN * 1000) / 1000;

/** One row of a gland table, in mm (ranges are [min, max]). */
export interface GlandRow extends Cited {
  /** O-ring cross-section W, nominal and ± tolerance. */
  w_mm: number;
  w_tol_mm: number;
  /** Gland depth L. */
  depth_mm: [number, number];
  /** Squeeze, as the table states it (% of W). */
  squeeze_pct: [number, number];
  /** Groove width G (no back-up ring; liquids for face seals). */
  width_mm: [number, number];
  /** Diametral clearance E (radial glands). */
  clearance_mm?: [number, number];
  /** Groove radius R. */
  radius_mm: [number, number];
}

const row = (source: string, w: number, wt: number, l: [number, number], sq: [number, number], g: [number, number], r: [number, number], e?: [number, number]): GlandRow => ({
  source,
  w_mm: mm(w),
  w_tol_mm: mm(wt),
  depth_mm: [mm(l[0]), mm(l[1])],
  squeeze_pct: sq,
  width_mm: [mm(g[0]), mm(g[1])],
  radius_mm: [mm(r[0]), mm(r[1])],
  ...(e ? { clearance_mm: [mm(e[0]), mm(e[1])] as [number, number] } : {}),
});

/**
 * Face seal glands: Parker ORD 5700 Design Chart 4-2 (p. 4-14), "intended
 * primarily for face type O-ring seals". Groove width for liquids.
 */
export const FACE_GLANDS: GlandRow[] = [
  row(`${PARKER_ORD_5700}, Design Chart 4-2`, 0.07, 0.003, [0.05, 0.054], [19, 32], [0.101, 0.107], [0.005, 0.015]),
  row(`${PARKER_ORD_5700}, Design Chart 4-2`, 0.103, 0.003, [0.074, 0.08], [20, 30], [0.136, 0.142], [0.005, 0.015]),
  row(`${PARKER_ORD_5700}, Design Chart 4-2`, 0.139, 0.004, [0.101, 0.107], [20, 30], [0.177, 0.187], [0.01, 0.025]),
  row(`${PARKER_ORD_5700}, Design Chart 4-2`, 0.21, 0.005, [0.152, 0.162], [21, 30], [0.27, 0.29], [0.02, 0.035]),
  row(`${PARKER_ORD_5700}, Design Chart 4-2`, 0.275, 0.006, [0.201, 0.211], [21, 29], [0.342, 0.362], [0.02, 0.035]),
];

/**
 * Static radial glands (male or female): Parker ORD 5700 Design Chart 4-1
 * (p. 4-5), "Industrial O-Ring Static Seal Glands". Groove width without a
 * back-up ring.
 */
export const RADIAL_GLANDS: GlandRow[] = [
  row(`${PARKER_ORD_5700}, Design Chart 4-1`, 0.07, 0.003, [0.05, 0.052], [22, 32], [0.093, 0.098], [0.005, 0.015], [0.002, 0.005]),
  row(`${PARKER_ORD_5700}, Design Chart 4-1`, 0.103, 0.003, [0.081, 0.083], [17, 24], [0.14, 0.145], [0.005, 0.015], [0.002, 0.005]),
  row(`${PARKER_ORD_5700}, Design Chart 4-1`, 0.139, 0.004, [0.111, 0.113], [16, 23], [0.187, 0.192], [0.01, 0.025], [0.003, 0.006]),
  row(`${PARKER_ORD_5700}, Design Chart 4-1`, 0.21, 0.005, [0.17, 0.173], [15, 21], [0.281, 0.286], [0.02, 0.035], [0.003, 0.006]),
  row(`${PARKER_ORD_5700}, Design Chart 4-1`, 0.275, 0.006, [0.226, 0.229], [15, 20], [0.375, 0.38], [0.02, 0.035], [0.004, 0.007]),
];

/** The gland row for an O-ring cross-section (mm), or undefined when the table has none. */
export function glandRow(type: "face" | "radial", w_mm: number): GlandRow | undefined {
  return (type === "face" ? FACE_GLANDS : RADIAL_GLANDS).find((r) => Math.abs(r.w_mm - w_mm) <= r.w_tol_mm);
}

/**
 * Parker ORD 5700 §3.3 Assembly: "The I.D. stretch, as installed in the
 * groove, should not be more than 5%."
 */
export const MAX_INSTALLED_STRETCH = { pct: 5, source: `${PARKER_ORD_5700}, §3.3 Assembly` };

/**
 * Parker ORD 5700 Design Chart 4-2 notes: for external (inward) pressure the
 * groove's inside diameter is the O-ring's mean I.D., tolerance plus 1 %; for
 * internal pressure its outside diameter is the O-ring's mean O.D., minus 1 %.
 */
export const FACE_GROOVE_FIT = { pct: 1, source: `${PARKER_ORD_5700}, Design Chart 4-2` };

/**
 * AS568 O-ring sizes in mm: "dash id id_tol w w_tol", from the Parker
 * Series 2-XXX table (ORD 5700 p. 9-2 onward, metric columns, per AS 568A).
 */
const AS568_ROWS = [
  "001 0.74 0.10 1.02 0.08,002 1.07 0.10 1.27 0.08,003 1.42 0.10 1.52 0.08,004 1.78 0.13 1.78 0.08,005 2.57 0.13 1.78 0.08,006 2.90 0.13 1.78 0.08",
  "007 3.68 0.13 1.78 0.08,008 4.47 0.13 1.78 0.08,009 5.28 0.13 1.78 0.08,010 6.07 0.13 1.78 0.08,011 7.65 0.13 1.78 0.08,012 9.25 0.13 1.78 0.08",
  "013 10.82 0.13 1.78 0.08,014 12.42 0.13 1.78 0.08,015 14.00 0.18 1.78 0.08,016 15.60 0.23 1.78 0.08,017 17.17 0.23 1.78 0.08,018 18.77 0.23 1.78 0.08",
  "019 20.35 0.23 1.78 0.08,020 21.95 0.23 1.78 0.08,021 23.52 0.23 1.78 0.08,022 25.12 0.25 1.78 0.08,023 26.70 0.25 1.78 0.08,024 28.30 0.25 1.78 0.08",
  "025 29.87 0.28 1.78 0.08,026 31.47 0.28 1.78 0.08,027 33.05 0.28 1.78 0.08,028 34.65 0.33 1.78 0.08,029 37.82 0.33 1.78 0.08,030 41.00 0.33 1.78 0.08",
  "031 44.17 0.38 1.78 0.08,032 47.35 0.38 1.78 0.08,033 50.52 0.46 1.78 0.08,034 53.70 0.46 1.78 0.08,035 56.87 0.46 1.78 0.08,036 60.05 0.46 1.78 0.08",
  "037 63.22 0.46 1.78 0.08,038 66.40 0.51 1.78 0.08,039 69.57 0.51 1.78 0.08,040 72.75 0.51 1.78 0.08,041 75.92 0.61 1.78 0.08,042 82.27 0.61 1.78 0.08",
  "043 88.62 0.61 1.78 0.08,044 94.97 0.69 1.78 0.08,045 101.32 0.69 1.78 0.08,046 107.67 0.76 1.78 0.08,047 114.02 0.76 1.78 0.08,048 120.37 0.76 1.78 0.08",
  "049 126.72 0.94 1.78 0.08,050 133.07 0.94 1.78 0.08,102 1.24 0.13 2.62 0.08,103 2.06 0.13 2.62 0.08,104 2.84 0.13 2.62 0.08,105 3.63 0.13 2.62 0.08",
  "106 4.42 0.13 2.62 0.08,107 5.23 0.13 2.62 0.08,108 6.02 0.13 2.62 0.08,109 7.59 0.13 2.62 0.08,110 9.19 0.13 2.62 0.08,111 10.77 0.13 2.62 0.08",
  "112 12.37 0.13 2.62 0.08,113 13.94 0.18 2.62 0.08,114 15.54 0.23 2.62 0.08,115 17.12 0.23 2.62 0.08,116 18.72 0.23 2.62 0.08,117 20.30 0.25 2.62 0.08",
  "118 21.89 0.25 2.62 0.08,119 23.47 0.25 2.62 0.08,120 25.07 0.25 2.62 0.08,121 26.64 0.25 2.62 0.08,122 28.24 0.25 2.62 0.08,123 29.82 0.30 2.62 0.08",
  "124 31.42 0.30 2.62 0.08,125 32.99 0.30 2.62 0.08,126 34.59 0.30 2.62 0.08,127 36.17 0.30 2.62 0.08,128 37.77 0.30 2.62 0.08,129 39.34 0.38 2.62 0.08",
  "130 40.94 0.38 2.62 0.08,131 42.52 0.38 2.62 0.08,132 44.12 0.38 2.62 0.08,133 45.69 0.38 2.62 0.08,134 47.29 0.38 2.62 0.08,135 48.90 0.43 2.62 0.08",
  "136 50.47 0.43 2.62 0.08,137 52.07 0.43 2.62 0.08,138 53.64 0.43 2.62 0.08,139 55.25 0.43 2.62 0.08,140 56.82 0.43 2.62 0.08,141 58.42 0.51 2.62 0.08",
  "142 59.99 0.51 2.62 0.08,143 61.60 0.51 2.62 0.08,144 63.17 0.51 2.62 0.08,145 64.77 0.51 2.62 0.08,146 66.34 0.51 2.62 0.08,147 67.95 0.56 2.62 0.08",
  "148 69.52 0.56 2.62 0.08,149 71.12 0.56 2.62 0.08,150 72.69 0.56 2.62 0.08,151 75.87 0.61 2.62 0.08,152 82.22 0.61 2.62 0.08,153 88.57 0.61 2.62 0.08",
  "154 94.92 0.71 2.62 0.08,155 101.27 0.71 2.62 0.08,156 107.62 0.76 2.62 0.08,157 113.97 0.76 2.62 0.08,158 120.32 0.76 2.62 0.08,159 126.67 0.89 2.62 0.08",
  "160 133.02 0.89 2.62 0.08,161 139.37 0.89 2.62 0.08,162 145.72 0.89 2.62 0.08,163 152.07 0.89 2.62 0.08,164 158.42 1.02 2.62 0.08,165 164.77 1.02 2.62 0.08",
  "166 171.12 1.02 2.62 0.08,167 177.47 1.02 2.62 0.08,168 183.82 1.14 2.62 0.08,169 190.17 1.14 2.62 0.08,170 196.52 1.14 2.62 0.08,171 202.87 1.14 2.62 0.08",
  "172 209.22 1.27 2.62 0.08,173 215.57 1.27 2.62 0.08,174 221.92 1.27 2.62 0.08,175 228.27 1.27 2.62 0.08,176 234.62 1.40 2.62 0.08,177 240.97 1.40 2.62 0.08",
  "178 247.32 1.40 2.62 0.08,201 4.34 0.13 3.53 0.10,202 5.94 0.13 3.53 0.10,203 7.52 0.13 3.53 0.10,204 9.12 0.13 3.53 0.10,205 10.69 0.13 3.53 0.10",
  "206 12.29 0.13 3.53 0.10,207 13.87 0.18 3.53 0.10,208 15.47 0.23 3.53 0.10,209 17.04 0.23 3.53 0.10,210 18.64 0.25 3.53 0.10,211 20.22 0.25 3.53 0.10",
  "212 21.82 0.25 3.53 0.10,213 23.39 0.25 3.53 0.10,214 24.99 0.25 3.53 0.10,215 26.57 0.25 3.53 0.10,216 28.17 0.30 3.53 0.10,217 29.74 0.30 3.53 0.10",
  "218 31.34 0.30 3.53 0.10,219 32.92 0.30 3.53 0.10,220 34.52 0.30 3.53 0.10,221 36.09 0.30 3.53 0.10,222 37.69 0.38 3.53 0.10,223 40.87 0.38 3.53 0.10",
  "224 44.04 0.38 3.53 0.10,225 47.22 0.46 3.53 0.10,226 50.39 0.46 3.53 0.10,227 53.57 0.46 3.53 0.10,228 56.74 0.51 3.53 0.10,229 59.92 0.51 3.53 0.10",
  "230 63.09 0.51 3.53 0.10,231 66.27 0.51 3.53 0.10,232 69.44 0.61 3.53 0.10,233 72.62 0.61 3.53 0.10,234 75.79 0.61 3.53 0.10,235 78.97 0.61 3.53 0.10",
  "236 82.14 0.61 3.53 0.10,237 85.32 0.61 3.53 0.10,238 88.49 0.61 3.53 0.10,239 91.67 0.71 3.53 0.10,240 94.84 0.71 3.53 0.10,241 98.02 0.71 3.53 0.10",
  "242 101.19 0.71 3.53 0.10,243 104.37 0.71 3.53 0.10,244 107.54 0.76 3.53 0.10,245 110.72 0.76 3.53 0.10,246 113.89 0.76 3.53 0.10,247 117.07 0.76 3.53 0.10",
  "248 120.24 0.76 3.53 0.10,249 123.42 0.89 3.53 0.10,250 126.59 0.89 3.53 0.10,251 129.77 0.89 3.53 0.10,252 132.94 0.89 3.53 0.10,253 136.12 0.89 3.53 0.10",
  "254 139.29 0.89 3.53 0.10,255 142.47 0.89 3.53 0.10,256 145.64 0.89 3.53 0.10,257 148.82 0.89 3.53 0.10,258 151.99 0.89 3.53 0.10,259 158.34 1.02 3.53 0.10",
  "260 164.69 1.02 3.53 0.10,261 171.04 1.02 3.53 0.10,262 177.39 1.02 3.53 0.10,263 183.74 1.14 3.53 0.10,264 190.09 1.14 3.53 0.10,265 196.44 1.14 3.53 0.10",
  "266 202.79 1.14 3.53 0.10,267 209.14 1.27 3.53 0.10,268 215.49 1.27 3.53 0.10,269 221.84 1.27 3.53 0.10,270 228.19 1.27 3.53 0.10,271 234.54 1.40 3.53 0.10",
  "272 240.89 1.40 3.53 0.10,273 247.24 1.40 3.53 0.10,274 253.59 1.40 3.53 0.10,275 266.29 1.40 3.53 0.10,276 278.99 1.65 3.53 0.10,277 291.69 1.65 3.53 0.10",
  "278 304.39 1.65 3.53 0.10,279 329.79 1.65 3.53 0.10,280 355.19 1.65 3.53 0.10,281 380.59 1.65 3.53 0.10,282 405.26 1.91 3.53 0.10,283 430.66 2.03 3.53 0.10",
  "284 456.06 2.16 3.53 0.10,309 10.46 0.13 5.33 0.13,310 12.07 0.13 5.33 0.13,311 13.64 0.18 5.33 0.13,312 15.24 0.23 5.33 0.13,313 16.81 0.23 5.33 0.13",
  "314 18.42 0.25 5.33 0.13,315 19.99 0.25 5.33 0.13,316 21.59 0.25 5.33 0.13,317 23.16 0.25 5.33 0.13,318 24.77 0.25 5.33 0.13,319 26.34 0.25 5.33 0.13",
  "320 27.94 0.30 5.33 0.13,321 29.51 0.30 5.33 0.13,322 31.12 0.30 5.33 0.13,323 32.69 0.30 5.33 0.13,324 34.29 0.30 5.33 0.13,325 37.47 0.38 5.33 0.13",
  "326 40.64 0.38 5.33 0.13,327 43.82 0.38 5.33 0.13,328 46.99 0.38 5.33 0.13,329 50.17 0.46 5.33 0.13,330 53.34 0.46 5.33 0.13,331 56.52 0.46 5.33 0.13",
  "332 59.69 0.46 5.33 0.13,333 62.87 0.51 5.33 0.13,334 66.04 0.51 5.33 0.13,335 69.22 0.51 5.33 0.13,336 72.39 0.51 5.33 0.13,337 75.57 0.61 5.33 0.13",
  "338 78.74 0.61 5.33 0.13,339 81.92 0.61 5.33 0.13,340 85.09 0.61 5.33 0.13,341 88.27 0.61 5.33 0.13,342 91.44 0.71 5.33 0.13,343 94.62 0.71 5.33 0.13",
  "344 97.79 0.71 5.33 0.13,345 100.97 0.71 5.33 0.13,346 104.14 0.71 5.33 0.13,347 107.32 0.76 5.33 0.13,348 110.49 0.76 5.33 0.13,349 113.67 0.76 5.33 0.13",
  "350 116.84 0.76 5.33 0.13,351 120.02 0.76 5.33 0.13,352 123.19 0.76 5.33 0.13,353 126.37 0.94 5.33 0.13,354 129.54 0.94 5.33 0.13,355 132.72 0.94 5.33 0.13",
  "356 135.89 0.94 5.33 0.13,357 139.07 0.94 5.33 0.13,358 142.24 0.94 5.33 0.13,359 145.42 0.94 5.33 0.13,360 148.59 0.94 5.33 0.13,361 151.77 0.94 5.33 0.13",
  "362 158.12 1.02 5.33 0.13,363 164.47 1.02 5.33 0.13,364 170.82 1.02 5.33 0.13,365 177.17 1.02 5.33 0.13,366 183.52 1.14 5.33 0.13,367 189.87 1.14 5.33 0.13",
  "368 196.22 1.14 5.33 0.13,369 202.57 1.14 5.33 0.13,370 208.92 1.27 5.33 0.13,371 215.27 1.27 5.33 0.13,372 221.62 1.27 5.33 0.13,373 227.97 1.27 5.33 0.13",
  "374 234.32 1.40 5.33 0.13,375 240.67 1.40 5.33 0.13,376 247.02 1.40 5.33 0.13,377 253.37 1.40 5.33 0.13,378 266.07 1.52 5.33 0.13,379 278.77 1.52 5.33 0.13",
  "380 291.47 1.65 5.33 0.13,381 304.17 1.65 5.33 0.13,382 329.57 1.65 5.33 0.13,383 354.97 1.78 5.33 0.13,384 380.37 1.78 5.33 0.13,385 405.26 1.91 5.33 0.13",
  "386 430.66 2.03 5.33 0.13,387 456.06 2.16 5.33 0.13,388 481.41 2.29 5.33 0.13,389 506.81 2.41 5.33 0.13,390 532.21 2.41 5.33 0.13,391 557.61 2.54 5.33 0.13",
  "392 582.68 2.67 5.33 0.13,393 608.08 2.79 5.33 0.13,394 633.48 2.92 5.33 0.13,395 658.88 3.05 5.33 0.13,425 113.67 0.84 6.99 0.15,426 116.84 0.84 6.99 0.15",
  "427 120.02 0.84 6.99 0.15,428 123.19 0.84 6.99 0.15,429 126.37 0.94 6.99 0.15,430 129.54 0.94 6.99 0.15,431 132.72 0.94 6.99 0.15,432 135.89 0.94 6.99 0.15",
  "433 139.07 0.94 6.99 0.15,434 142.24 0.94 6.99 0.15,435 145.42 0.94 6.99 0.15,436 148.59 0.94 6.99 0.15,437 151.77 0.94 6.99 0.15,438 158.12 1.02 6.99 0.15",
  "439 164.47 1.02 6.99 0.15,440 170.82 1.02 6.99 0.15,441 177.17 1.02 6.99 0.15,442 183.52 1.14 6.99 0.15,443 189.87 1.14 6.99 0.15,444 196.22 1.14 6.99 0.15",
  "445 202.57 1.14 6.99 0.15,446 215.27 1.40 6.99 0.15,447 227.97 1.40 6.99 0.15,448 240.67 1.40 6.99 0.15,449 253.37 1.40 6.99 0.15,450 266.07 1.52 6.99 0.15",
  "451 278.77 1.52 6.99 0.15,452 291.47 1.52 6.99 0.15,453 304.17 1.52 6.99 0.15,454 316.87 1.52 6.99 0.15,455 329.57 1.52 6.99 0.15,456 342.27 1.78 6.99 0.15",
  "457 354.97 1.78 6.99 0.15,458 367.67 1.78 6.99 0.15,459 380.37 1.78 6.99 0.15,460 393.07 1.78 6.99 0.15,461 405.26 1.91 6.99 0.15,462 417.96 1.91 6.99 0.15",
  "463 430.66 2.03 6.99 0.15,464 443.36 2.16 6.99 0.15,465 456.06 2.16 6.99 0.15,466 468.76 2.16 6.99 0.15,467 481.46 2.29 6.99 0.15,468 494.16 2.29 6.99 0.15",
  "469 506.86 2.41 6.99 0.15,470 532.26 2.41 6.99 0.15,471 557.66 2.54 6.99 0.15,472 582.68 2.67 6.99 0.15,473 608.08 2.79 6.99 0.15,474 633.48 2.92 6.99 0.15",
  "475 658.88 3.05 6.99 0.15",].join(",");

export interface ORing extends Cited {
  size: string;
  id_mm: number;
  id_tol_mm: number;
  w_mm: number;
  w_tol_mm: number;
}

const AS568 = new Map(
  AS568_ROWS.split(",").map((r) => {
    const [dash, id, idt, w, wt] = r.trim().split(/\s+/);
    return [dash, { id_mm: Number(id), id_tol_mm: Number(idt), w_mm: Number(w), w_tol_mm: Number(wt) }] as const;
  }),
);

/** An AS568 size ("AS568-138", "-138", "2-138" or "138"). */
export function as568(size: string): ORing | undefined {
  const dash = /(\d{3})$/.exec(size.trim())?.[1];
  const r = dash ? AS568.get(dash) : undefined;
  return r && { size: `AS568-${dash}`, ...r, source: `${PARKER_ORD_5700}, Parker Series 2-XXX O-Ring Sizes (AS 568A)` };
}

/** A heat-set insert and the hole it goes into (mm). */
export interface Insert extends Cited {
  name: string;
  thread: string;
  outer_d_mm: number;
  length_mm: number;
  hole_d_mm: number;
  hole_depth_mm: number;
  min_wall_mm: number;
}

/**
 * ruthex RX-M2x4: M2, outer Ø3.6 (D1), length 4.0, recommended hole Ø3.2
 * (D3), minimum wall 1.3 (product data as read by the watch and bottle
 * projects, their sources W19 / B24). The hole depth is not stated.
 */
export const RUTHEX_RX_M2X4: Insert = {
  name: "ruthex RX-M2x4",
  thread: "M2",
  outer_d_mm: 3.6,
  length_mm: 4.0,
  hole_d_mm: 3.2,
  hole_depth_mm: 5.0,
  min_wall_mm: 1.3,
  source: "https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m2-70-stuck-rx-m2x4-messing-gewindebuchsen (dimensions: https://www.3djake.com/ruthex/threaded-insert-m2-70-pieces)",
  assumption: "hole depth = insert length + 1.0 mm, room for the plastic the insert displaces",
};

/**
 * CNC Kitchen M2 standard insert: length 3.0, outer Ø3.6 (D1), hole Ø3.2
 * (D3), minimum wall 1.3.
 */
export const CNC_KITCHEN_M2: Insert = {
  name: "CNC Kitchen M2 standard",
  thread: "M2",
  outer_d_mm: 3.6,
  length_mm: 3.0,
  hole_d_mm: 3.2,
  hole_depth_mm: 4.0,
  min_wall_mm: 1.3,
  source: "https://www.3djake.com/cnc-kitchen/threaded-inserts-m2-standard",
  assumption: "hole depth = insert length + 1.0 mm, room for the plastic the insert displaces",
};

export const INSERTS: Record<string, Insert> = { "ruthex-rx-m2x4": RUTHEX_RX_M2X4, "cnc-kitchen-m2": CNC_KITCHEN_M2 };

/** A screw that closes a joint (mm). */
export interface Screw extends Cited {
  name: string;
  d_mm: number;
  length_mm: number;
  head_d_mm: number;
  head_h_mm: number;
  clearance_d_mm: number;
}

/**
 * Accu SPP-M2-6-A2, M2 × 6 pan head: head Ø4.0, head height 1.72 (as read
 * by the watch project, source W20). Clearance hole Ø2.4: ISO 273 medium
 * series for M2.
 */
export const M2X6_PAN: Screw = {
  name: "M2 × 6 pan head (ISO 7045)",
  d_mm: 2,
  length_mm: 6,
  head_d_mm: 4.0,
  head_h_mm: 1.72,
  clearance_d_mm: 2.4,
  source: "Accu SPP-M2-6-A2 product data (watch project source W20); clearance hole: ISO 273 medium series",
};

/** A watch spring bar (mm). */
export interface SpringBar extends Cited {
  name: string;
  bar_d_mm: number;
  tip_d_mm: number;
  /** How far each tip stands beyond the lug gap when the bar is fitted. */
  tip_length_mm: number;
  lug_gap_mm: number;
}

/**
 * Esslinger 82.2225 (22 mm, Ø1.5 mm, double flange): overall 25.0,
 * compressed 21.8, tip Ø0.80 (the watch project's source W18). Each tip
 * stands (25.0 − 22) / 2 = 1.5 mm into its lug.
 */
export const ESSLINGER_82_2225: SpringBar = {
  name: "Esslinger 82.2225",
  bar_d_mm: 1.5,
  tip_d_mm: 0.8,
  tip_length_mm: 1.5,
  lug_gap_mm: 22,
  source: "https://www.esslinger.com/stainless-steel-1-5mm-double-flange-watch-band-spring-bar-assortment-900-pc/",
};

/** Lug hole for a spring-bar tip: Ø tip + 0.2, depth tip length + 0.3 (printed-hole allowances; assumption). */
export const lugHole = (bar: SpringBar) => ({ hole_d_mm: Math.round((bar.tip_d_mm + 0.2) * 100) / 100, hole_depth_mm: Math.round((bar.tip_length_mm + 0.3) * 100) / 100 });

/**
 * USB Type-C plug (USB Type-C Connectors and Cable Assemblies Compliance
 * Document rev 1.2, 2017-08-22, Appendix B, Figure B-1): overmold width
 * 12.35 max, overmold height 6.5 max, plug length 6.65 ± 0.10, plug width
 * 8.25, plug thickness 2.40.
 */
/** A cable plug a socket opening must pass, and the overmold that butts the wall around it. */
export interface Plug {
  name: string;
  overmold_width_mm: number;
  overmold_height_mm: number;
  plug_length_mm: number;
  plug_width_mm: number;
  plug_thickness_mm: number;
  source: string;
}

export const USB_C_PLUG: Plug = {
  name: "USB Type-C plug",
  overmold_width_mm: 12.35,
  overmold_height_mm: 6.5,
  plug_length_mm: 6.65,
  plug_width_mm: 8.25,
  plug_thickness_mm: 2.4,
  source: "https://www.usb.org/sites/default/files/USB_Type-C_Compliance_Document_rev_1_2.pdf, Appendix B, Figure B-1",
};
