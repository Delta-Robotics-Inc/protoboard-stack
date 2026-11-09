/**
 * The seating check: how a body sits on its footprint, measured from the body's geometry (never assumed). It works on
 * any body, parametric or a supplied model, in the footprint frame (z = 0 is the board face it should sit on):
 *
 * - seating plane: the lowest downward-facing surface; for a through-hole part, ignoring surfaces inside the drilled
 *   holes (lead tips), so a header's plane is the underside of its base;
 * - contacts: the patches of the body that touch the seating plane; each should land on a pad;
 * - orientation: the contact pattern is also tried turned 90, 180 and 270 degrees and mirrored; a clearly better fit
 *   means the model's axes do not match the footprint;
 * - a body that touches the plane in one patch (a chip, a QFN) is checked by its outline against the pads instead.
 */
import type { Mesh } from "./brep.js";
import type { Vec2 } from "./math.js";
import type { PadGeom } from "./packages.js";

export interface Seating {
  /** "contacts" when lead or terminal patches were matched to pads, "bounds" when the body outline was used. */
  method: "contacts" | "bounds" | "none";
  /** Seating plane found in the footprint frame before any fix, mm (0 is on the board face). */
  planeMm: number;
  /** Plane minus the expected contact height (the board face, or the override's mid-mount depth), mm. */
  gapMm: number;
  /** Contacts: RMS distance of contact centers outside their nearest pad (0 when every contact is on a pad). Bounds: distance of the body center from the pad pattern's center. */
  xyResidualMm: number;
  /** Contact patches found, and surface-mount pads with a terminal contact on them (contacts method) or under the body (bounds method). */
  contacts: number;
  padsHit: number;
  pads: number;
  /** The turn of the contact pattern that fits best (0 when it fits as placed). */
  rotationDeg: number;
  mirrored: boolean;
  /** Whether the body's plan outline stays inside the courtyard (null without a courtyard). */
  inCourtyard: boolean | null;
  heightMm: number;
  status: "ok" | "floating" | "sunk" | "rotated" | "mirrored" | "offset" | "none";
  /** Translation along Z applied to seat the body (seat: "fix"), mm. */
  fixedMm?: number;
  notes: string[];
}

export interface SeatingInput {
  mesh: Mesh;
  pads: PadGeom[];
  courtyard?: { minX: number; maxX: number; minY: number; maxY: number };
  /** Expected seating plane (0, or negative for a mid-mount part sunk into a cutout). */
  expectMm?: number;
  /** Tolerance on the gap, mm (default 0.05). */
  gapTol?: number;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

export function measureSeating(input: SeatingInput): Seating {
  const { mesh, pads } = input;
  const expect = input.expectMm ?? 0;
  const gapTol = input.gapTol ?? 0.05;
  const p = mesh.pos;
  const nTri = p.length / 9;
  const holes = pads.filter((q) => q.hole && q.hole.w > 0).map((q) => ({ cx: q.cx, cy: q.cy, rx: q.hole!.w / 2 + 0.05, ry: q.hole!.h / 2 + 0.05 }));
  const inHole = (x: number, y: number) => holes.some((h) => Math.abs(x - h.cx) <= h.rx && Math.abs(y - h.cy) <= h.ry);
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const down: number[] = [];
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const ux = p[o + 3] - p[o];
    const uy = p[o + 4] - p[o + 1];
    const uz = p[o + 5] - p[o + 2];
    const vx = p[o + 6] - p[o];
    const vy = p[o + 7] - p[o + 1];
    const vz = p[o + 8] - p[o + 2];
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
    for (let k = 0; k < 3; k++) {
      const z = p[o + k * 3 + 2];
      const x = p[o + k * 3];
      const y = p[o + k * 3 + 1];
      if (z > maxZ) maxZ = z;
      if (z < minZ) minZ = z;
      // plan outline above the board face only (through-hole leads below it are not the body)
      if (z >= expect - 1e-6) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (len > 0 && nz / len < -0.9) {
      const cx = (p[o] + p[o + 3] + p[o + 6]) / 3;
      const cy = (p[o + 1] + p[o + 4] + p[o + 7]) / 3;
      if (!holes.length || !inHole(cx, cy)) down.push(t);
    }
  }
  if (!nTri) return { method: "none", planeMm: 0, gapMm: 0, xyResidualMm: 0, contacts: 0, padsHit: 0, pads: pads.length, rotationDeg: 0, mirrored: false, inCourtyard: null, heightMm: 0, status: "none", notes: ["no body"] };
  let plane = Infinity;
  for (const t of down) for (let k = 0; k < 3; k++) plane = Math.min(plane, p[t * 9 + k * 3 + 2]);
  if (!Number.isFinite(plane)) plane = minZ;
  if (!Number.isFinite(minX)) {
    minX = maxX = minY = maxY = 0;
  }
  // contact patches: downward triangles on the plane, grouped by shared corners
  const onPlane = down.filter((t) => [0, 1, 2].every((k) => p[t * 9 + k * 3 + 2] <= plane + 0.02));
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = a;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const corner = new Map<string, number>();
  for (const t of onPlane) parent.set(t, t);
  for (const t of onPlane) {
    for (let k = 0; k < 3; k++) {
      const key = `${Math.round(p[t * 9 + k * 3] * 1e5)},${Math.round(p[t * 9 + k * 3 + 1] * 1e5)}`;
      const o = corner.get(key);
      if (o === undefined) corner.set(key, t);
      else {
        const a = find(o);
        const b = find(t);
        if (a !== b) parent.set(a, b);
      }
    }
  }
  const patches = new Map<number, { a: number; x: number; y: number }>();
  for (const t of onPlane) {
    const o = t * 9;
    const area = Math.abs((p[o + 3] - p[o]) * (p[o + 7] - p[o + 1]) - (p[o + 4] - p[o + 1]) * (p[o + 6] - p[o])) / 2;
    const r = find(t);
    const q = patches.get(r) ?? { a: 0, x: 0, y: 0 };
    q.a += area;
    q.x += ((p[o] + p[o + 3] + p[o + 6]) / 3) * area;
    q.y += ((p[o + 1] + p[o + 4] + p[o + 7]) / 3) * area;
    patches.set(r, q);
  }
  const patchList = [...patches.values()].filter((q) => q.a > 1e-6);
  const contacts: Vec2[] = patchList.map((q) => [q.x / q.a, q.y / q.a]);
  const copper = pads.filter((q) => q.type !== "np");
  const pc: Vec2 = copper.length ? [(Math.min(...copper.map((q) => q.cx - q.w / 2)) + Math.max(...copper.map((q) => q.cx + q.w / 2))) / 2, (Math.min(...copper.map((q) => q.cy - q.h / 2)) + Math.max(...copper.map((q) => q.cy + q.h / 2))) / 2] : [0, 0];
  const notes: string[] = [];
  const gap = plane - expect;
  let status: Seating["status"] = gap > gapTol ? "floating" : gap < -gapTol ? "sunk" : "ok";
  let method: Seating["method"] = "bounds";
  let residual = 0;
  let rotationDeg = 0;
  let mirrored = false;
  let padsHit = 0;
  const outside = (c: Vec2, q: PadGeom) => Math.hypot(Math.max(0, Math.abs(c[0] - q.cx) - q.w / 2), Math.max(0, Math.abs(c[1] - q.cy) - q.h / 2));
  const fit = (cs: Vec2[]) => {
    let s = 0;
    for (const c of cs) {
      let d = Infinity;
      for (const q of copper) d = Math.min(d, outside(c, q));
      s += d * d;
    }
    return Math.sqrt(s / Math.max(1, cs.length));
  };
  // surface-mount pads must each carry a contact; through-hole pads are judged by their holes, not contacts
  const smdPads = copper.filter((q) => q.type === "smd");
  const maxPad = Math.max(0, ...copper.map((q) => q.w * q.h));
  // a patch far larger than any pad is the body's underside resting on the board, not a terminal
  const terminals = contacts.filter((_, i) => patchList[i].a <= 4 * maxPad + 1e-9);
  if (terminals.length >= 2 && smdPads.length >= 2) {
    method = "contacts";
    residual = fit(terminals);
    const hits = (cs: Vec2[]) => smdPads.filter((q) => cs.some((c) => outside(c, q) <= 0.05)).length;
    padsHit = hits(terminals);
    // other orientations about the pad pattern's center
    const turned = (deg: number, mirror: boolean) =>
      terminals.map(([x, y]): Vec2 => {
        let dx = x - pc[0];
        const dy = y - pc[1];
        if (mirror) dx = -dx;
        const a = (deg * Math.PI) / 180;
        return [pc[0] + dx * Math.cos(a) - dy * Math.sin(a), pc[1] + dx * Math.sin(a) + dy * Math.cos(a)];
      });
    if (padsHit < smdPads.length) {
      // a turn or mirror that puts a contact on more pads means the model's axes or pin 1 do not match the footprint
      let best = padsHit;
      let bestRes = residual;
      for (const mirror of [false, true]) {
        for (const deg of [0, 90, 180, 270]) {
          if (!mirror && deg === 0) continue;
          const t = turned(deg, mirror);
          const h = hits(t);
          const r = fit(t);
          if (h > best || (h === best && h === smdPads.length && r < bestRes * 0.5)) {
            best = h;
            bestRes = r;
            rotationDeg = deg;
            mirrored = mirror;
          }
        }
      }
      if (rotationDeg || mirrored) {
        status = mirrored ? "mirrored" : "rotated";
        notes.push(`contacts land on ${padsHit} of ${smdPads.length} pads as placed and on ${best} ${mirrored ? "mirrored" : ""}${mirrored && rotationDeg ? " and " : ""}${rotationDeg ? `turned ${rotationDeg} degrees` : ""}`);
      } else if (status === "ok") {
        status = "offset";
        notes.push(`contacts land on ${padsHit} of ${smdPads.length} pads (RMS ${r4(residual)} mm outside)`);
      }
    }
  } else {
    const bc: Vec2 = [(minX + maxX) / 2, (minY + maxY) / 2];
    residual = Math.hypot(bc[0] - pc[0], bc[1] - pc[1]);
    // a pad is under the body when at least a quarter of it is (pads reach past a body for the solder toe)
    const overlap = (q: PadGeom) => Math.max(0, Math.min(maxX, q.cx + q.w / 2) - Math.max(minX, q.cx - q.w / 2)) * Math.max(0, Math.min(maxY, q.cy + q.h / 2) - Math.max(minY, q.cy - q.h / 2));
    padsHit = copper.filter((q) => overlap(q) >= 0.25 * q.w * q.h).length;
    const bw = maxX - minX;
    const bh = maxY - minY;
    const pw = copper.length ? Math.max(...copper.map((q) => q.cx)) - Math.min(...copper.map((q) => q.cx)) : 0;
    const ph = copper.length ? Math.max(...copper.map((q) => q.cy)) - Math.min(...copper.map((q) => q.cy)) : 0;
    if (copper.length === 2 && bw > 0 && bh > 0 && Math.max(bw, bh) / Math.min(bw, bh) > 1.3 && (pw > ph) !== (bw > bh) && Math.max(pw, ph) > 0.1) {
      status = "rotated";
      rotationDeg = 90;
      notes.push("the body's long axis is across the pad pair: it is turned 90 degrees");
    } else if (copper.length && padsHit < copper.length / 2 && pads.every((q) => q.type === "smd") && status === "ok") {
      status = "offset";
      notes.push(`only ${padsHit} of ${copper.length} pads are under the body`);
    }
  }
  const cy = input.courtyard;
  const inCourtyard = cy ? minX >= cy.minX - 0.05 && maxX <= cy.maxX + 0.05 && minY >= cy.minY - 0.05 && maxY <= cy.maxY + 0.05 : null;
  return {
    method,
    planeMm: r4(plane),
    gapMm: r4(gap),
    xyResidualMm: r4(residual),
    contacts: contacts.length,
    padsHit,
    pads: copper.length,
    rotationDeg,
    mirrored,
    inCourtyard,
    heightMm: r4(maxZ),
    status,
    notes,
  };
}
