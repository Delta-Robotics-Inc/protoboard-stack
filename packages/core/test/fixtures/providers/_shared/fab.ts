/**
 * TEST FIXTURE. Minimal, syntactically valid manufacturing files for the fake
 * providers: enough to exercise standard-output validation, nothing more.
 * None of this describes a manufacturable board or part.
 */
import { crc32 } from "node:zlib";

export interface Pad {
  x: number;
  y: number;
}

const coord = (v: number) => Math.round(v * 1e6).toString();

/** A Gerber RS-274X layer: a 0.1 mm outline (when given) and 1 mm square pads, format 4.6 (mm) or 2.6 (inch). */
export function gerber(o: { units: "mm" | "in"; fileFunction: string; outline?: { w: number; h: number }; pads?: Pad[] }): string {
  const k = o.units === "mm" ? 1 : 1 / 25.4;
  const lines = [
    "G04 TEST FIXTURE: fake provider output, not a real board*",
    `%TF.FileFunction,${o.fileFunction}*%`,
    o.units === "mm" ? "%FSLAX46Y46*%" : "%FSLAX26Y26*%",
    o.units === "mm" ? "%MOMM*%" : "%MOIN*%",
    `%ADD10C,${(0.1 * k).toFixed(6)}*%`,
    `%ADD11R,${(1 * k).toFixed(6)}X${(1 * k).toFixed(6)}*%`,
  ];
  if (o.outline) {
    const { w, h } = o.outline;
    lines.push("D10*", "X0Y0D02*", `X${coord(w * k)}Y0D01*`, `X${coord(w * k)}Y${coord(h * k)}D01*`, `X0Y${coord(h * k)}D01*`, "X0Y0D01*");
  }
  if (o.pads?.length) lines.push("D11*", ...o.pads.map((p) => `X${coord(p.x * k)}Y${coord(p.y * k)}D03*`));
  lines.push("M02*");
  return lines.join("\n") + "\n";
}

/** An Excellon drill file with one tool. */
export function excellon(o: { units: "mm" | "in"; diameter_mm: number; holes: Pad[] }): string {
  const k = o.units === "mm" ? 1 : 1 / 25.4;
  const d = o.units === "mm" ? 3 : 4;
  return [
    "M48",
    "; TEST FIXTURE: fake provider drill file",
    o.units === "mm" ? "METRIC,TZ" : "INCH,TZ",
    `T1C${(o.diameter_mm * k).toFixed(d)}`,
    "%",
    "G90",
    "G05",
    "T1",
    ...o.holes.map((h) => `X${(h.x * k).toFixed(d)}Y${(h.y * k).toFixed(d)}`),
    "M30",
    "",
  ].join("\n");
}

/** A GLB holding only a glTF JSON chunk (named nodes, no meshes). */
export function glb(json: object): Buffer {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const chunk = Buffer.from(text, "utf8");
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + chunk.length, 8);
  header.writeUInt32LE(chunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, chunk]);
}

/** A STEP file with a header and one point per named location. */
export function step(name: string, points: { name: string; x: number; y: number; z: number }[]): string {
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('TEST FIXTURE: fake provider output'),'2;1');",
    `FILE_NAME('${name}','2026-10-02T00:00:00',(''),(''),'fixture','fixture','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    "ENDSEC;",
    "DATA;",
    ...points.map((p, i) => `#${i + 1}=CARTESIAN_POINT('${p.name}',(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}));`),
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

/** A binary STL of an axis-aligned box (12 triangles). */
export function stlBox(w: number, d: number, h: number): Buffer {
  const v = (i: number): [number, number, number] => [i & 1 ? w : 0, i & 2 ? d : 0, i & 4 ? h : 0];
  const faces = [
    [0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4],
    [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5],
  ];
  const b = Buffer.alloc(84 + 50 * faces.length);
  b.write("TEST FIXTURE: fake provider box", 0, "latin1");
  b.writeUInt32LE(faces.length, 80);
  faces.forEach((f, t) => {
    let at = 84 + 50 * t + 12; // normal left zero: readers recompute it
    for (const i of f) for (const c of v(i)) (b.writeFloatLE(c, at), (at += 4));
  });
  return b;
}

/** A ZIP archive with stored (uncompressed) entries, e.g. a 3MF package. */
export function zipStored(entries: { name: string; data: Buffer | string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data);
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** RFC 4180 field quoting. */
export const csvField = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
