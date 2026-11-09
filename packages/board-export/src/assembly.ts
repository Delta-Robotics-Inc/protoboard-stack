/**
 * Assembly data: one placement row per footprint and one BOM line per group of identical parts, from the board
 * document and the part data the board and project carry (`PartInfo`). Nothing is looked up: an LCSC number, a
 * library class (Basic or Extended), a manufacturer part number is written only when the footprint record or the part
 * data says so. A line without a supplier part number is flagged, never guessed; a part the user supplies is marked
 * consigned.
 *
 * Writers: the generic BOM and placement CSVs, JLCPCB's BOM and CPL, and CircuitHub's BOM.
 */
import { copperLayers, normAngle, padsOf, recordsOfKind, rotatePoint, toDeg, type BoardDocument, type FootprintRec } from "@protoboardai/board";
import { byDesignator, csvLine, degText, mmFixed } from "./format.js";
import type { Pt } from "./geom.js";
import type { BomFormat, CplFormat, FabProfile, RotationEntry } from "./profiles.js";

/** What the board and project know about a part, beyond the footprint record. */
export interface PartInfo {
  /** LCSC part number (`C` and digits); the footprint's `supplier_part` is used when absent. */
  lcsc?: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  /** JLCPCB library class, when the part data carries it. */
  libraryClass?: "basic" | "extended" | "preferred";
  /** Supplied by the user to the assembler; a string gives the reason. */
  consigned?: boolean | string;
  /** Do not place. */
  dnp?: boolean;
  /** Placed by hand after assembly (left out of the placement file). */
  hand?: boolean;
  /** Not a BOM line at all (fiducial, test pad, mounting hole). */
  noBom?: boolean;
  /** A rotation correction verified for this one part, degrees. */
  rotation?: number;
  /** Grouping fields for a later whole-system BOM. */
  scope?: "pcb" | "board-hand" | "consigned" | "system" | "tooling";
  function?: string;
}

/** Part data keyed by footprint id (`fp:...`), UHD path, or reference designator; looked up in that order. */
export type PartData = Record<string, PartInfo>;

export type Process = "smt" | "tht" | "mixed" | "none";

export interface PlacementRow {
  ref: string;
  id: string;
  value?: string;
  footprint: string;
  /** The footprint name after the library prefix. */
  package: string;
  side: "top" | "bottom";
  /** Position relative to the package origin, nm. */
  x: number;
  y: number;
  /** The board document's rotation, millidegrees. */
  rotation: number;
  /** Rotation written for the fab: convention applied, correction added, millidegrees. */
  rotationOut: number;
  correction: { degrees: number; source: "lcsc" | "package" | "part" | "fab-library" | "none"; entry?: RotationEntry };
  lcsc?: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  libraryClass?: "basic" | "extended" | "preferred";
  process: Process;
  dnp: boolean;
  consigned: boolean;
  consignedReason?: string;
  hand: boolean;
  noBom: boolean;
  noBomReason?: string;
  scope?: string;
  function?: string;
  pads: number;
  /** What to look at (plain words). */
  flags: string[];
}

export interface BomLine {
  item: number;
  refs: string[];
  quantity: number;
  value: string;
  footprint: string;
  package: string;
  lcsc?: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  libraryClass?: "basic" | "extended" | "preferred";
  process: Process;
  sides: ("top" | "bottom")[];
  dnp: boolean;
  consigned: boolean;
  hand: boolean;
  /** Grouping fields for a whole-system BOM: the board this line belongs to, its scope and function. */
  board: string;
  scope: string;
  function?: string;
  flags: string[];
}

export interface AssemblyOptions {
  origin?: Pt;
  parts?: PartData;
  /** Rotation corrections added to the profile's table (user entries win over shipped ones with the same key). */
  rotations?: RotationEntry[];
  /** Board name for the BOM's grouping fields. */
  board?: string;
}

const NO_BOM_FOOTPRINT = /fiducial|mountinghole|mounting_hole|testpoint|test_point|logo/i;

function partOf(parts: PartData | undefined, fp: FootprintRec): PartInfo {
  if (!parts) return {};
  return parts[fp.id] ?? (fp.path ? parts[fp.path] : undefined) ?? parts[fp.ref] ?? {};
}

/** The correction for a part: its own verified value, then an exact LCSC entry, then the longest matching package pattern. */
export function rotationCorrection(fp: FootprintRec, info: PartInfo, lcsc: string | undefined, entries: RotationEntry[], fabLibraries: string[] = []): PlacementRow["correction"] {
  if (info.rotation !== undefined) return { degrees: info.rotation, source: "part" };
  if (lcsc) {
    const e = entries.find((x) => x.lcsc && x.lcsc.trim().toUpperCase() === lcsc.toUpperCase());
    if (e) return { degrees: e.rotation, source: "lcsc", entry: e };
  }
  const name = fp.footprint;
  const pkg = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
  let best: { e: RotationEntry; len: number } | undefined;
  for (const e of entries) {
    if (!e.package) continue;
    let m: RegExpExecArray | null = null;
    try {
      m = new RegExp(e.package, "i").exec(pkg);
    } catch {
      m = null;
    }
    if (m && (!best || m[0].length > best.len)) best = { e, len: m[0].length };
  }
  if (best) return { degrees: best.e.rotation, source: "package", entry: best.e };
  if (fabLibraries.some((p) => new RegExp(p, "i").test(name))) return { degrees: 0, source: "fab-library" };
  return { degrees: 0, source: "none" };
}

/** Placement rows for every footprint, sorted by designator. */
export function placements(doc: BoardDocument, profile: FabProfile, options: AssemblyOptions = {}): PlacementRow[] {
  const ox = options.origin?.x ?? 0;
  const oy = options.origin?.y ?? 0;
  const stack = copperLayers(doc);
  const shipped = profile.rotations?.entries ?? [];
  const user = options.rotations ?? [];
  const keyOf = (e: RotationEntry) => (e.lcsc ? `lcsc:${e.lcsc.toUpperCase()}` : `pkg:${e.package}`);
  const userKeys = new Set(user.map(keyOf));
  const entries = [...user, ...shipped.filter((e) => !userKeys.has(keyOf(e)))];
  const rows: PlacementRow[] = [];
  for (const fp of recordsOfKind(doc, "footprint")) {
    const info = partOf(options.parts, fp);
    const lcsc = info.lcsc ?? fp.supplier_part;
    const pads = padsOf(fp, stack);
    const smd = pads.filter((p) => p.pad.type === "smd").length;
    const th = pads.filter((p) => p.pad.type === "th").length;
    const process: Process = smd && th ? "mixed" : th ? "tht" : smd ? "smt" : "none";
    const pkg = fp.footprint.includes(":") ? fp.footprint.slice(fp.footprint.indexOf(":") + 1) : fp.footprint;
    let noBomReason: string | undefined;
    if (info.noBom) noBomReason = "marked not a BOM part in the part data";
    else if (process === "none") noBomReason = "no copper pads (holes or graphics only)";
    else if (!info.lcsc && !fp.supplier_part && !info.mpn && NO_BOM_FOOTPRINT.test(fp.footprint)) noBomReason = `footprint ${pkg} is a fiducial, test point, mounting hole or logo`;
    const consigned = info.consigned !== undefined && info.consigned !== false;
    const correction = rotationCorrection(fp, info, lcsc, entries, profile.rotations?.fabLibraries ?? []);
    const base = profile.assembly.rotationConvention === "kicad" && fp.side === "bottom" ? normAngle(fp.rotation - 180_000) : fp.rotation;
    let x = fp.x;
    let y = fp.y;
    const off = correction.entry?.offset;
    if (off) {
      const r = rotatePoint({ x: off.x * 1e6, y: off.y * 1e6 }, fp.rotation);
      x = Math.round(x + r.x);
      y = Math.round(y + r.y);
    }
    const flags: string[] = [];
    if (!noBomReason && !info.dnp && !consigned && !lcsc) flags.push("no LCSC part number");
    if (!noBomReason && !info.dnp && correction.source === "none" && profile.rotations) flags.push("rotation not verified for this fab: check the placement preview");
    if (!noBomReason && !info.dnp && fp.side === "bottom" && profile.rotations) flags.push("bottom side: check rotation and mirroring in the placement preview");
    if (lcsc && !/^C\d+$/i.test(lcsc)) flags.push(`supplier part ${lcsc} is not an LCSC number (C and digits)`);
    rows.push({
      ref: fp.ref,
      id: fp.id,
      ...(fp.value ? { value: fp.value } : {}),
      footprint: fp.footprint,
      package: pkg,
      side: fp.side,
      x: x - ox,
      y: y - oy,
      rotation: fp.rotation,
      rotationOut: normAngle(base + Math.round(correction.degrees * 1000)),
      correction,
      ...(lcsc ? { lcsc } : {}),
      ...(info.mpn ? { mpn: info.mpn } : {}),
      ...(info.manufacturer ? { manufacturer: info.manufacturer } : {}),
      ...(info.description ? { description: info.description } : {}),
      ...(info.libraryClass ? { libraryClass: info.libraryClass } : {}),
      process,
      dnp: info.dnp === true,
      consigned,
      ...(typeof info.consigned === "string" ? { consignedReason: info.consigned } : {}),
      hand: info.hand === true,
      noBom: !!noBomReason,
      ...(noBomReason ? { noBomReason } : {}),
      ...(info.scope ? { scope: info.scope } : {}),
      ...(info.function ? { function: info.function } : {}),
      pads: pads.length,
      flags,
    });
  }
  return rows.sort((a, b) => byDesignator(a.ref, b.ref));
}

/** BOM lines grouped by supplier part (else MPN, else value and footprint), DNP and consigned apart. */
export function bomLines(rows: PlacementRow[], board = "board"): BomLine[] {
  const groups = new Map<string, PlacementRow[]>();
  for (const r of rows) {
    if (r.noBom) continue;
    const id = r.lcsc ? `lcsc:${r.lcsc.toUpperCase()}` : r.mpn ? `mpn:${r.manufacturer ?? ""}:${r.mpn}` : `val:${r.value ?? ""}|${r.package}`;
    const key = `${id}|${r.dnp}|${r.consigned}|${r.hand}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }
  const lines: BomLine[] = [...groups.values()].map((g) => {
    const f = g[0];
    const refs = g.map((r) => r.ref).sort(byDesignator);
    const flags: string[] = [];
    if (!f.dnp && !f.consigned && !f.lcsc) flags.push("no LCSC part number");
    const values = new Set(g.map((r) => r.value ?? ""));
    if (values.size > 1) flags.push(`values differ within the line: ${[...values].join(", ")}`);
    const pk = new Set(g.map((r) => r.package));
    if (pk.size > 1) flags.push(`footprints differ within the line: ${[...pk].join(", ")}`);
    return {
      item: 0,
      refs,
      quantity: g.length,
      value: f.value ?? "",
      footprint: f.footprint,
      package: f.package,
      ...(f.lcsc ? { lcsc: f.lcsc } : {}),
      ...(f.mpn ? { mpn: f.mpn } : {}),
      ...(f.manufacturer ? { manufacturer: f.manufacturer } : {}),
      ...(f.description ? { description: f.description } : {}),
      ...(f.libraryClass ? { libraryClass: f.libraryClass } : {}),
      process: f.process,
      sides: [...new Set(g.map((r) => r.side))].sort() as ("top" | "bottom")[],
      dnp: f.dnp,
      consigned: f.consigned,
      hand: f.hand,
      board,
      scope: f.scope ?? (f.consigned ? "consigned" : f.hand ? "board-hand" : "pcb"),
      ...(f.function ? { function: f.function } : {}),
      flags,
    };
  });
  lines.sort((a, b) => byDesignator(a.refs[0], b.refs[0]));
  lines.forEach((l, i) => (l.item = i + 1));
  return lines;
}

const side = (s: "top" | "bottom") => (s === "top" ? "Top" : "Bottom");
const yes = (b: boolean) => (b ? "yes" : "");

/** BOM CSV in a profile's format. */
export function writeBom(lines: BomLine[], format: BomFormat, options: { consignedInBom?: boolean } = {}): string {
  const out: string[] = [];
  if (format === "jlcpcb") {
    out.push(csvLine(["Comment", "Designator", "Footprint", "LCSC Part #"]));
    for (const l of lines) {
      if (l.dnp || l.hand) continue;
      if (l.consigned && options.consignedInBom === false) continue;
      out.push(csvLine([l.consigned ? `${l.value || l.package} (consigned)` : l.value || l.package, l.refs.join(","), l.package, l.consigned ? "" : (l.lcsc ?? "")]));
    }
  } else if (format === "circuithub") {
    out.push(csvLine(["Designators", "Quantity", "Manufacturer", "MPN", "Description", "Value", "Footprint", "DNP", "Consigned", "Supplier", "Supplier Part Number"]));
    for (const l of lines) out.push(csvLine([l.refs.join(","), l.quantity, l.manufacturer, l.mpn, l.description, l.value, l.package, yes(l.dnp), yes(l.consigned), l.lcsc ? "LCSC" : "", l.lcsc]));
  } else {
    out.push(csvLine(["Item", "Quantity", "Designators", "Value", "Footprint", "Manufacturer", "MPN", "Supplier", "Supplier Part", "Library Class", "Process", "Side", "DNP", "Consigned", "Hand", "Board", "Scope", "Function", "Flags"]));
    for (const l of lines)
      out.push(
        csvLine([l.item, l.quantity, l.refs.join(","), l.value, l.package, l.manufacturer, l.mpn, l.lcsc ? "LCSC" : "", l.lcsc, l.libraryClass, l.process, l.sides.map(side).join("+"), yes(l.dnp), yes(l.consigned), yes(l.hand), l.board, l.scope, l.function, l.flags.join("; ")]),
      );
  }
  return `${out.join("\n")}\n`;
}

/** Placement (pick and place) CSV in a profile's format. */
export function writeCpl(rows: PlacementRow[], format: CplFormat): string {
  const out: string[] = [];
  const placed = rows.filter((r) => !r.noBom && !r.dnp && !r.hand);
  if (format === "jlcpcb") {
    out.push(csvLine(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"]));
    for (const r of placed) out.push(csvLine([r.ref, `${mmFixed(r.x, 4)}mm`, `${mmFixed(r.y, 4)}mm`, side(r.side), degText(r.rotationOut)]));
  } else {
    out.push(csvLine(["Designator", "Value", "Footprint", "X (mm)", "Y (mm)", "Rotation (deg)", "Side", "Process"]));
    for (const r of placed) out.push(csvLine([r.ref, r.value, r.package, mmFixed(r.x, 4), mmFixed(r.y, 4), degText(r.rotationOut), side(r.side), r.process]));
  }
  return `${out.join("\n")}\n`;
}

/** Degrees as a plain number for reports. */
export const rotationDegrees = (mdeg: number): number => toDeg(mdeg);
