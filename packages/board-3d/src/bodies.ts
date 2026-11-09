/**
 * Parametric part bodies made in code from a recognized package (`packages.ts`) and the footprint's pads. Each body is
 * one solid in the footprint frame: x, y as the footprint's own (mm), z up from the seating plane (z = 0 sits on the
 * board face). Leads are placed under their pads, so pin 1 and the pad pattern line up by construction; the seating
 * check (`seating.ts`) measures that from the geometry anyway, the same way it measures a supplied model.
 */
import type { FootprintRec } from "@protoboardai/board";
import { boxUnion, extrudeRegion, transformSolid, type Box3, type Solid } from "./brep.js";
import { compose, rotationX, rotationZ, translation, type Affine, type Vec3 } from "./math.js";
import { padGeom, type PackageInfo, type PadGeom } from "./packages.js";
import { stadiumLoop } from "./profile.js";

/** Colors of parts (sRGB). */
export const PART_COLORS = {
  icBody: "#1f1f1f",
  resistorBody: "#161616",
  capacitorBody: "#b8956a",
  inductorBody: "#3b3b3b",
  ledBody: "#f1f1ec",
  diodeBody: "#202020",
  metal: "#c9c9c9",
  tin: "#d6d6d6",
  gold: "#d4af37",
  mark: "#e8e8e8",
  band: "#9a9a9a",
  moduleBoard: "#26343d",
  can: "#c4c6c8",
  usbMouth: "#2a2a2a",
  switchBody: "#2b2b2b",
  plunger: "#8c8c8c",
  headerBase: "#1c1c1c",
  crystal: "#c0c0c0",
  placeholder: "#e0a030",
};

/** Lens colors of chip LEDs by value words. */
function ledColor(value: string): string {
  const v = value.toLowerCase();
  if (/green/.test(v)) return "#3fc46a";
  if (/amber|orange|yellow/.test(v)) return "#ffb21f";
  if (/red/.test(v)) return "#e5392f";
  if (/blue/.test(v)) return "#3a7bff";
  if (/rgb|ws28|sk68/.test(v)) return "#f5f5f5";
  return "#fff6d5";
}

/** A mating point or functional axis of a body, in the footprint frame. */
export interface BodyInterface {
  kind: "connector-mouth" | "header-pins" | "button" | "antenna";
  /** Origin and unit axes: `zAxis` points out of the part along the mating (insertion) or actuation axis. */
  origin: Vec3;
  zAxis: Vec3;
  xAxis: Vec3;
  /** Opening or pin field size, mm, when it has one. */
  size?: [number, number];
  note: string;
}

export interface ParametricBody {
  solid: Solid;
  interfaces: BodyInterface[];
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): Box3 => ({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], color });

function pin1(fp: FootprintRec): PadGeom | undefined {
  const pads = fp.pads.map(padGeom);
  return pads.find((p) => p.number === "1") ?? pads.find((p) => p.number === "A1") ?? pads.find((p) => /^1$|^A1$|^1[^0-9]/.test(p.number));
}

/** A small square mark on the top face near pin 1 (a color patch; no geometry). */
function pin1Mark(fp: FootprintRec, b: PackageInfo["body"], top: number, color: number): Box3[] {
  const p = pin1(fp);
  if (!p) return [];
  const s = Math.min(0.5, Math.max(0.12, Math.min(b.w, b.h) * 0.18));
  const inset = Math.min(0.25, Math.min(b.w, b.h) * 0.12);
  const sx = p.cx < b.cx ? -1 : 1;
  const sy = p.cy < b.cy ? -1 : 1;
  const x = b.cx + sx * (b.w / 2 - inset - s / 2);
  const y = b.cy + sy * (b.h / 2 - inset - s / 2);
  return [box(x - s / 2, y - s / 2, top - 1e-4, x + s / 2, y + s / 2, top + 1e-4, color)];
}

/** Build the body for a recognized package. Returns undefined for `pads-only`. */
export function parametricBody(fp: FootprintRec, info: PackageInfo, boardThickness: number): ParametricBody | undefined {
  const b = info.body;
  const H = info.height;
  const x0 = b.cx - b.w / 2;
  const x1 = b.cx + b.w / 2;
  const y0 = b.cy - b.h / 2;
  const y1 = b.cy + b.h / 2;
  const pads = fp.pads.map(padGeom);
  const value = fp.value ?? "";
  switch (info.kind) {
    case "pads-only":
      return undefined;
    case "chip":
    case "chip-led":
    case "chip-diode": {
      const pre = (/^[A-Za-z]+/.exec(fp.ref)?.[0] ?? "").toUpperCase();
      const led = info.kind === "chip-led";
      const diode = info.kind === "chip-diode";
      const bodyColor = led ? PART_COLORS.ledBody : diode ? PART_COLORS.diodeBody : pre === "C" ? PART_COLORS.capacitorBody : pre === "L" || pre === "FB" ? PART_COLORS.inductorBody : PART_COLORS.resistorBody;
      const palette = [bodyColor, PART_COLORS.tin, led ? ledColor(value) : PART_COLORS.band];
      const alongX = b.w >= b.h;
      const L = alongX ? b.w : b.h;
      const end = Math.min(0.35 * L, Math.max(0.1, L * 0.2));
      const paints: Box3[] = [];
      // terminations at both ends (every face inside the end slabs)
      if (alongX) paints.push(box(x0 - 1, y0 - 1, -1, x0 + end, y1 + 1, H + 1, 1), box(x1 - end, y0 - 1, -1, x1 + 1, y1 + 1, H + 1, 1));
      else paints.push(box(x0 - 1, y0 - 1, -1, x1 + 1, y0 + end, H + 1, 1), box(x0 - 1, y1 - end, -1, x1 + 1, y1 + 1, H + 1, 1));
      if (led) paints.unshift(box(b.cx - (alongX ? L * 0.25 : b.w * 0.35), b.cy - (alongX ? b.h * 0.35 : L * 0.25), H - 1e-4, b.cx + (alongX ? L * 0.25 : b.w * 0.35), b.cy + (alongX ? b.h * 0.35 : L * 0.25), H + 1e-4, 2));
      if (diode || led) {
        // a band at the pin 1 end
        const p = pin1(fp);
        if (p) {
          const t = Math.max(0.08, L * 0.1);
          if (alongX) {
            const xa = p.cx < b.cx ? x0 + end : x1 - end - t;
            paints.unshift(box(xa, y0 - 1, H - 1e-4, xa + t, y1 + 1, H + 1e-4, led ? 1 : 2));
          } else {
            const ya = p.cy < b.cy ? y0 + end : y1 - end - t;
            paints.unshift(box(x0 - 1, ya, H - 1e-4, x1 + 1, ya + t, H + 1e-4, led ? 1 : 2));
          }
        }
      }
      return { solid: boxUnion([box(x0, y0, 0, x1, y1, H, 0)], palette, paints)!, interfaces: [] };
    }
    case "sot":
    case "so":
    case "qfp":
      return { solid: leaded(fp, info, pads), interfaces: [] };
    case "no-lead": {
      const palette = [PART_COLORS.icBody, PART_COLORS.tin, PART_COLORS.mark];
      const paints: Box3[] = [...pin1Mark(fp, b, H, 2)];
      // terminals reaching the body edge show on its sides
      for (const p of pads) {
        if (p.type !== "smd") continue;
        paints.push(box(p.cx - p.w / 2, p.cy - p.h / 2, -1, p.cx + p.w / 2, p.cy + p.h / 2, Math.min(0.2, H * 0.3), 1));
      }
      return { solid: boxUnion([box(x0, y0, 0, x1, y1, H, 0)], palette, paints)!, interfaces: [] };
    }
    case "box":
    case "unknown": {
      const crystal = info.family === "crystal";
      const led = info.family === "led";
      const palette = [info.placeholder ? PART_COLORS.placeholder : crystal ? "#3a3a3a" : led ? PART_COLORS.ledBody : PART_COLORS.icBody, crystal ? PART_COLORS.crystal : PART_COLORS.mark, ledColor(value)];
      const paints: Box3[] = [];
      if (crystal) paints.push(box(x0 + Math.min(0.15, b.w * 0.05), y0 + Math.min(0.15, b.h * 0.05), H * 0.25, x1 - Math.min(0.15, b.w * 0.05), y1 - Math.min(0.15, b.h * 0.05), H + 1, 1));
      else if (led) paints.push(box(b.cx - b.w * 0.3, b.cy - b.h * 0.3, H - 1e-4, b.cx + b.w * 0.3, b.cy + b.h * 0.3, H + 1e-4, 2));
      else if (!info.placeholder && pads.length >= 3) paints.push(...pin1Mark(fp, b, H, 1));
      return { solid: boxUnion([box(x0, y0, 0, x1, y1, H, 0)], palette, paints)!, interfaces: [] };
    }
    case "module":
      return module(fp, info, pads);
    case "usb-c":
      return usbC(fp, info, pads);
    case "usb-micro": {
      const palette = [PART_COLORS.metal, PART_COLORS.usbMouth];
      return { solid: boxUnion([box(x0, y0, 0, x1, y1, H, 0)], palette)!, interfaces: [] };
    }
    case "header":
      return header(fp, info, pads, boardThickness);
    case "switch-tact": {
      const palette = [PART_COLORS.switchBody, PART_COLORS.plunger];
      const side = info.family === "side switch";
      const hb = side ? H : Math.max(0.6, H * 0.6);
      const boxes = [box(x0, y0, 0, x1, y1, hb, 0)];
      const interfaces: BodyInterface[] = [];
      if (!side) {
        const s = Math.min(b.w, b.h) * 0.4;
        boxes.push(box(b.cx - s / 2, b.cy - s / 2, hb - 0.05, b.cx + s / 2, b.cy + s / 2, H, 1));
        interfaces.push({ kind: "button", origin: [b.cx, b.cy, H], zAxis: [0, 0, 1], xAxis: [1, 0, 0], size: [s, s], note: "plunger top, actuation along -Z" });
      }
      return { solid: boxUnion(boxes, palette)!, interfaces };
    }
  }
}

/** Gull-wing leads under each pad and a body between the rows. */
function leaded(fp: FootprintRec, info: PackageInfo, pads: PadGeom[]): Solid {
  const b = info.body;
  const H = info.height;
  const standoff = info.family === "MSOP" || info.family === "TSSOP" ? 0.05 : 0.1;
  const t = 0.15;
  const palette = [PART_COLORS.icBody, PART_COLORS.tin, PART_COLORS.mark];
  const boxes: Box3[] = [box(b.cx - b.w / 2, b.cy - b.h / 2, standoff, b.cx + b.w / 2, b.cy + b.h / 2, H, 0)];
  const zs = standoff + Math.max(t + 0.05, (H - standoff) * 0.4);
  for (const p of pads) {
    if (p.type !== "smd") continue;
    const dx = p.cx - b.cx;
    const dy = p.cy - b.cy;
    // the lead points out of the nearest body side
    const outX = Math.abs(dx) - b.w / 2;
    const outY = Math.abs(dy) - b.h / 2;
    const alongX = outX > outY;
    const s = alongX ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
    const padLen = alongX ? p.w : p.h;
    const padWid = alongX ? p.h : p.w;
    const edge = alongX ? b.w / 2 : b.h / 2;
    const c = alongX ? Math.abs(dx) : Math.abs(dy);
    const tip = Math.max(edge + 0.1, c + padLen * 0.25);
    const footLen = Math.max(0.12, Math.min(0.6, (tip - edge) * 0.55));
    const fs = tip - footLen;
    const lw = Math.max(0.1, Math.min(padWid * 0.75, 0.5));
    const along = (u0: number, u1: number, z0: number, z1: number): Box3 => {
      // u measured outward from the body center along the lead axis
      const a0 = s * u0;
      const a1 = s * u1;
      return alongX ? box(b.cx + a0, p.cy - lw / 2, z0, b.cx + a1, p.cy + lw / 2, z1, 1) : box(p.cx - lw / 2, b.cy + a0, z0, p.cx + lw / 2, b.cy + a1, z1, 1);
    };
    if (fs - t <= edge - 0.05) {
      // a short lead: one foot reaching under the body edge
      boxes.push(along(edge - 0.1, tip, 0, Math.max(t, standoff + 0.05)));
    } else {
      boxes.push(along(fs - t, tip, 0, t));
      boxes.push(along(fs - t, fs, 0, zs));
      boxes.push(along(edge - 0.1, fs, zs - t, zs));
    }
  }
  return boxUnion(boxes, palette, pin1Mark(fp, b, H, 2))!;
}

/** Module: carrier board and a shield can, leaving the antenna end (the body side without pads) uncovered. */
function module(fp: FootprintRec, info: PackageInfo, pads: PadGeom[]): ParametricBody {
  const b = info.body;
  const H = info.height;
  const slab = Math.min(0.8, H * 0.35);
  const palette = [PART_COLORS.moduleBoard, PART_COLORS.can];
  const x0 = b.cx - b.w / 2;
  const x1 = b.cx + b.w / 2;
  const y0 = b.cy - b.h / 2;
  const y1 = b.cy + b.h / 2;
  // count pads near each side
  const near = (f: (p: PadGeom) => boolean) => pads.filter(f).length;
  const tol = Math.min(b.w, b.h) * 0.2;
  const sides = [
    { side: "top", n: near((p) => p.cy > y1 - tol) },
    { side: "bottom", n: near((p) => p.cy < y0 + tol) },
    { side: "left", n: near((p) => p.cx < x0 + tol) },
    { side: "right", n: near((p) => p.cx > x1 - tol) },
  ];
  const empty = sides.filter((s) => s.n === 0);
  let cx0 = x0 + 0.3;
  let cx1 = x1 - 0.3;
  let cy0 = y0 + 0.3;
  let cy1 = y1 - 0.3;
  const interfaces: BodyInterface[] = [];
  if (empty.length === 1) {
    const s = empty[0].side;
    const long = s === "top" || s === "bottom" ? b.h : b.w;
    const ant = Math.min(6, long * 0.3);
    if (s === "top") cy1 = y1 - ant;
    if (s === "bottom") cy0 = y0 + ant;
    if (s === "left") cx0 = x0 + ant;
    if (s === "right") cx1 = x1 - ant;
    const o: Vec3 = s === "top" ? [b.cx, y1 - ant / 2, slab] : s === "bottom" ? [b.cx, y0 + ant / 2, slab] : s === "left" ? [x0 + ant / 2, b.cy, slab] : [x1 - ant / 2, b.cy, slab];
    interfaces.push({ kind: "antenna", origin: o, zAxis: [0, 0, 1], xAxis: [1, 0, 0], size: s === "top" || s === "bottom" ? [b.w, ant] : [ant, b.h], note: "antenna end of the module (the side without pads); keep metal and copper away" });
  }
  const boxes = [box(x0, y0, 0, x1, y1, slab, 0), box(cx0, cy0, slab - 0.05, cx1, cy1, H, 1)];
  return { solid: boxUnion(boxes, palette)!, interfaces };
}

/** USB Type-C receptacle shell: a stadium prism from the courtyard's open end, mouth facing away from the signal pads. */
function usbC(fp: FootprintRec, info: PackageInfo, pads: PadGeom[]): ParametricBody {
  const b = info.body;
  const W = 8.94;
  const Hs = 3.26;
  const smd = pads.filter((p) => p.type === "smd");
  const sx = smd.length ? smd.reduce((a, p) => a + p.cx, 0) / smd.length : b.cx;
  const sy = smd.length ? smd.reduce((a, p) => a + p.cy, 0) / smd.length : b.cy + 1;
  // the mouth points away from the signal pad row, along the axis where they are offset most
  const alongY = Math.abs(sy - b.cy) >= Math.abs(sx - b.cx);
  const dir = alongY ? (sy > b.cy ? -1 : 1) : sx > b.cx ? -1 : 1;
  const depth = Math.min(7.35, alongY ? b.h : b.w);
  const front = alongY ? b.cy + (dir * b.h) / 2 : b.cx + (dir * b.w) / 2;
  const palette = [PART_COLORS.metal, PART_COLORS.usbMouth];
  // profile in local XY (x across, y up), swept along local +Z, then turned so local Z points out of the mouth
  const prof = extrudeRegion({ outer: stadiumLoop(W, Hs, 0, Hs / 2), holes: [] }, -depth, 0, 0, palette);
  // color the front cap (local z = 0) as the mouth
  const capIdx = prof.brep.faces.length - 2;
  prof.brep.faces[capIdx].color = 1;
  for (let k = 0; k < prof.mesh.color.length; k++) {
    const z = [prof.mesh.pos[k * 9 + 2], prof.mesh.pos[k * 9 + 5], prof.mesh.pos[k * 9 + 8]];
    if (z.every((v) => Math.abs(v) < 1e-9)) prof.mesh.color[k] = 1;
  }
  // local y -> footprint z and local z -> out of the mouth (footprint `dir` along y or x). rotationX(90) maps
  // (x, y, z) to (x, -z, y): the mouth then faces -y; a turn about Z points it where it belongs.
  const turn = alongY ? (dir < 0 ? 0 : 180) : dir < 0 ? -90 : 90;
  let m: Affine = compose(rotationZ(turn), rotationX(90));
  const cx = alongY ? b.cx : front;
  const cy = alongY ? front : b.cy;
  m = compose(translation([cx, cy, 0]), m);
  const solid = transformSolid(prof, m);
  const zAxis: Vec3 = alongY ? [0, dir, 0] : [dir, 0, 0];
  const xAxis: Vec3 = alongY ? [1, 0, 0] : [0, 1, 0];
  return { solid, interfaces: [{ kind: "connector-mouth", origin: [cx, cy, Hs / 2], zAxis, xAxis, size: [8.34, 2.56], note: "USB Type-C receptacle mouth: plug inserts along -zAxis; opening 8.34 x 2.56 mm, shell 8.94 x 3.26 mm" }] };
}

/** Pin header or socket: a plastic base and square pins through the board. */
function header(fp: FootprintRec, info: PackageInfo, pads: PadGeom[], T: number): ParametricBody {
  const b = info.body;
  const socket = info.family === "socket";
  const H = info.height;
  const palette = [PART_COLORS.headerBase, PART_COLORS.gold];
  const boxes: Box3[] = [box(b.cx - b.w / 2, b.cy - b.h / 2, 0, b.cx + b.w / 2, b.cy + b.h / 2, H, 0)];
  const s = 0.64;
  const tail = -(T + 3.0);
  const top = socket ? H - 0.5 : H + 6.0;
  const th = pads.filter((p) => p.type === "th");
  for (const p of th) boxes.push(box(p.cx - s / 2, p.cy - s / 2, tail, p.cx + s / 2, p.cy + s / 2, top, 1));
  const p1 = th.find((p) => p.number === "1") ?? th[0];
  return {
    solid: boxUnion(boxes, palette)!,
    interfaces: p1 ? [{ kind: "header-pins", origin: [p1.cx, p1.cy, socket ? H : top], zAxis: [0, 0, 1], xAxis: [1, 0, 0], size: [b.w, b.h], note: socket ? "socket face; pins of the mating header insert along -zAxis; origin over pin 1" : "pin tips; a socket mates along -zAxis; origin over pin 1" }] : [],
  };
}
