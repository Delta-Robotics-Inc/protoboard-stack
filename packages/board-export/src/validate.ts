/**
 * Validation after writing, never skipped: every written file is read back with this package's own readers and
 * compared with the board document (not with the plot the writer drew from), the fab profile's capability limits run
 * through `@protoboardai/board-checks` and the checks below, placement rows are checked against the footprints, and
 * the results become pre-flight items (pass, warn, fail, info, skip).
 */
import {
  copperLayers,
  padsOf,
  recordsOfKind,
  viaLayers,
  withChanges,
  type BoardDocument,
  type BoardRecord,
  type Finding,
} from "@protoboardai/board";
import { runBoardChecks } from "@protoboardai/board-checks";
import { bomLines, type BomLine, type PlacementRow } from "./assembly.js";
import type { ExcellonRead, Hole } from "./drill.js";
import type { ResolvedFill } from "./fill.js";
import { mmText, parseCsvLine } from "./format.js";
import { flattenContour, ringArea, ringOf, type Pt } from "./geom.js";
import { apertureShapes, areaOf, countObjects, inRing, type GerberRead } from "./gerber/read.js";
import { extentOf } from "./gerber/svg.js";
import type { Ipc356Read, Ipc356Record } from "./ipc356.js";
import { apertureRing, type Plot, type PlotLayer } from "./plot.js";
import { capabilityRules, type FabProfile } from "./profiles.js";

export type Status = "pass" | "warn" | "fail" | "info" | "skip";
export type Group = "board" | "copper and nets" | "silk and mask" | "parts and BOM" | "placement and files" | "fab capability" | "cross-check";

export interface PreflightItem {
  id: string;
  group: Group;
  title: string;
  status: Status;
  /** Facts behind the status (one line each). */
  detail?: string[];
  counts?: Record<string, number>;
  /** The paired image, relative to the package folder. */
  image?: string;
}

export interface LayerStats {
  file: string;
  layer: string;
  fileFunction: string;
  flashes: number;
  draws: number;
  arcs: number;
  regions: number;
  clear: number;
}

const fmt = (nm: number) => `${mmText(nm, 3)} mm`;
const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;

// ------------------------------------------------------------------- Gerber read-back against the document

export interface WrittenGerber {
  layer: PlotLayer;
  file: string;
  text: string;
  read: GerberRead;
}

const fnOf = (read: GerberRead, ap: number): string => (read.apertures.get(ap)?.attrs[".AperFunction"] ?? [])[0] ?? "";

/** Compare the copper, mask and paste Gerbers read back with what the board document says each layer holds. */
export function checkGerbers(doc: BoardDocument, written: WrittenGerber[], fill: ResolvedFill | undefined, origin: Pt, netAttributes: boolean): { items: PreflightItem[]; stats: LayerStats[] } {
  const items: PreflightItem[] = [];
  const stats: LayerStats[] = [];
  const stack = copperLayers(doc);
  const parseIssues: string[] = [];
  for (const w of written) {
    const c = countObjects(w.read);
    stats.push({ file: w.file, layer: w.layer.id, fileFunction: w.layer.fileFunction, ...c });
    for (const e of w.read.errors) parseIssues.push(`${w.file}: ${e}`);
    const ff = (w.read.fileAttrs[".FileFunction"] ?? []).join(",");
    if (ff !== w.layer.fileFunction) parseIssues.push(`${w.file}: file function reads ${ff || "nothing"}, expected ${w.layer.fileFunction}`);
    if (w.read.format && (w.read.format.int !== 4 || w.read.format.dec !== 6)) parseIssues.push(`${w.file}: format ${w.read.format.int}.${w.read.format.dec}`);
  }
  items.push({ id: "gerber.parse", group: "placement and files", title: parseIssues.length ? `Gerber read-back: ${plural(parseIssues.length, "problem")}` : `Gerber read-back: ${written.length} files parse, file functions and 4.6 mm format as written`, status: parseIssues.length ? "fail" : "pass", ...(parseIssues.length ? { detail: parseIssues.slice(0, 20) } : {}) });

  // expected copper objects per layer, from the document through the board core's geometry
  const ox = origin.x;
  const oy = origin.y;
  const missing: string[] = [];
  const dupes: string[] = [];
  const extras: string[] = [];
  let expectedTotal = 0;
  let matchedTotal = 0;
  for (const c of stack) {
    const w = written.find((x) => x.layer.copper === c);
    if (!w) continue;
    const want = new Map<string, number>();
    const add = (k: string) => {
      want.set(k, (want.get(k) ?? 0) + 1);
      expectedTotal++;
    };
    for (const fp of recordsOfKind(doc, "footprint"))
      for (const wp of padsOf(fp, stack)) if (wp.pad.type !== "np" && wp.layers.includes(c)) add(`pad|${netAttributes ? `${fp.ref}|${wp.pad.number}` : "?"}|${wp.x - ox}|${wp.y - oy}`);
    for (const v of recordsOfKind(doc, "via")) if (viaLayers(doc, v.from_layer, v.to_layer).includes(c)) add(`via|${v.x - ox}|${v.y - oy}`);
    for (const t of recordsOfKind(doc, "track")) if (t.layer === c) add(trackKey(t.start.x - ox, t.start.y - oy, t.end.x - ox, t.end.y - oy, t.sweep !== undefined, t.width));
    const got = new Map<string, number>();
    for (const o of w.read.objects) {
      let k: string | undefined;
      if (o.k === "flash") {
        const fn = fnOf(w.read, o.ap);
        if (fn === "ViaPad") k = `via|${o.x}|${o.y}`;
        else if (fn === "SMDPad" || fn === "ComponentPad") k = `pad|${netAttributes ? `${o.attrs[".P"]?.[0]}|${o.attrs[".P"]?.[1]}` : "?"}|${o.x}|${o.y}`;
        else k = `flash:${fn}|${o.x}|${o.y}`;
      } else if (o.k === "draw" && fnOf(w.read, o.ap) === "Conductor") {
        const ap = w.read.apertures.get(o.ap);
        k = trackKey(o.from.x, o.from.y, o.to.x, o.to.y, !!o.arc, ap?.template === "C" ? Math.round(ap.params[0] * 1e6) : -1);
      }
      if (k) got.set(k, (got.get(k) ?? 0) + 1);
    }
    for (const [k, n] of want) {
      const g = got.get(k) ?? 0;
      matchedTotal += Math.min(g, n);
      if (g < n) missing.push(`${w.file}: ${describeKey(k)} missing (${n - g})`);
      if (g > n) dupes.push(`${w.file}: ${describeKey(k)} drawn ${g} times`);
    }
    for (const [k, n] of got) if (!want.has(k)) extras.push(`${w.file}: unexpected ${describeKey(k)} (${n})`);
  }
  const bad = missing.length + dupes.length + extras.length;
  items.push({
    id: "gerber.copper",
    group: "copper and nets",
    title: bad ? `Copper read-back: ${missing.length} missing, ${dupes.length} drawn twice, ${extras.length} unexpected` : `Copper read-back: all ${expectedTotal} pads, vias and tracks present once, on the right layers`,
    status: bad ? "fail" : "pass",
    counts: { expected: expectedTotal, matched: matchedTotal, missing: missing.length, duplicated: dupes.length, unexpected: extras.length },
    ...(bad ? { detail: [...missing, ...dupes, ...extras].slice(0, 30) } : {}),
  });

  // zone fill: region count and area per layer
  if (fill) {
    const rows: string[] = [];
    let ok = true;
    for (const c of stack) {
      const w = written.find((x) => x.layer.copper === c);
      if (!w) continue;
      const fills = fill.fills.filter((f) => f.layer === c);
      const wantN = fills.reduce((s, f) => s + f.polygons.length, 0);
      const wantA = fills.reduce((s, f) => s + f.polygons.reduce((a, p) => a + Math.abs(ringArea(ringOf(p.outer))) - p.holes.reduce((h, r) => h + Math.abs(ringArea(ringOf(r))), 0), 0), 0);
      const regs = w.read.objects.filter((o) => o.k === "region" && o.dark && (o.attrs[".AperFunction"] ?? [])[0] === "Conductor");
      const gotA = regs.reduce((s, o) => s + (o.k === "region" ? areaOf(o.ring) : 0), 0);
      if (!wantN && !regs.length) continue;
      const rel = wantA ? Math.abs(gotA - wantA) / wantA : gotA ? 1 : 0;
      if (regs.length !== wantN || rel > 1e-4) ok = false;
      rows.push(`${w.file}: ${regs.length} regions (fill has ${wantN}), area ${(gotA / 1e12).toFixed(3)} mm2 (fill ${(wantA / 1e12).toFixed(3)} mm2)`);
    }
    items.push({ id: "gerber.fill", group: "copper and nets", title: ok ? `Zone fill drawn once as regions: area equal to the ${fill.source} fill on every layer` : "Zone fill regions differ from the fill", status: ok ? "pass" : "fail", detail: rows });
  }
  return { items, stats };
}

function trackKey(ax: number, ay: number, bx: number, by: number, arc: boolean, width: number): string {
  // segments are unordered; arcs keep their direction (a reversed arc has the opposite sweep)
  if (!arc && (ax > bx || (ax === bx && ay > by))) [ax, ay, bx, by] = [bx, by, ax, ay];
  return `track|${arc ? "arc" : "seg"}|${ax}|${ay}|${bx}|${by}|${width}`;
}
function describeKey(k: string): string {
  const p = k.split("|");
  if (p[0] === "pad") return `pad ${p[1]}${p[2] ? `.${p[2]}` : ""} at (${mmText(Number(p[p.length - 2]), 3)}, ${mmText(Number(p[p.length - 1]), 3)})`;
  if (p[0] === "via") return `via at (${mmText(Number(p[1]), 3)}, ${mmText(Number(p[2]), 3)})`;
  if (p[0] === "track") return `track ${p[1]} (${mmText(Number(p[2]), 3)}, ${mmText(Number(p[3]), 3)}) to (${mmText(Number(p[4]), 3)}, ${mmText(Number(p[5]), 3)})`;
  return k;
}

/** The profile file: closed loops, one per outline and cutout, and every layer inside it. */
export function checkProfile(doc: BoardDocument, profile: WrittenGerber | undefined, others: WrittenGerber[]): PreflightItem[] {
  const items: PreflightItem[] = [];
  if (!profile) return [{ id: "profile.closed", group: "board", title: "No profile file was written", status: "fail" }];
  const ends = new Map<string, number>();
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const key = (p: Pt) => `${p.x},${p.y}`;
  for (const o of profile.read.objects) {
    if (o.k !== "draw") continue;
    for (const p of [o.from, o.to]) {
      const k = key(p);
      ends.set(k, (ends.get(k) ?? 0) + 1);
      if (!parent.has(k)) parent.set(k, k);
    }
    parent.set(find(key(o.from)), find(key(o.to)));
  }
  const open = [...ends.values()].filter((n) => n % 2 === 1).length;
  const loops = new Set([...parent.keys()].map(find)).size;
  const want = (doc.records.has("outline") ? 1 : 0) + recordsOfKind(doc, "cutout").length;
  const outline = doc.records.get("outline");
  const area = outline?.kind === "outline" ? Math.abs(ringArea(flattenContour(outline.outline, 500))) : 0;
  const detail = [`${plural(loops, "closed chain")} of ${plural(profile.read.objects.length, "edge")}; the board has ${plural(want, "outline and cutout", "outlines and cutouts")}`];
  const ok = open === 0 && loops === want && want > 0;
  items.push({ id: "profile.closed", group: "board", title: ok ? `Outline closed: ${want === 1 ? "one loop" : `${want} loops (outline and ${want - 1} cutouts)`}${area ? `, ${(area / 1e12).toFixed(1)} mm2` : ""}` : `Outline not closed: ${open} open ends, ${loops} loops for ${want} expected`, status: ok ? "pass" : "fail", detail });
  // alignment: every copper, mask and paste layer lies within the profile's box
  const pb = extentOf(profile.read);
  const tol = 1_000_000;
  const outside: string[] = [];
  for (const w of others) {
    if (w.layer.kind === "legend" || !w.read.objects.length) continue;
    const e = extentOf(w.read);
    if (e.minX < pb.minX - tol || e.minY < pb.minY - tol || e.maxX > pb.maxX + tol || e.maxY > pb.maxY + tol) outside.push(`${w.file}: content reaches (${mmText(e.minX, 2)}, ${mmText(e.minY, 2)}) to (${mmText(e.maxX, 2)}, ${mmText(e.maxY, 2)}) mm, profile (${mmText(pb.minX, 2)}, ${mmText(pb.minY, 2)}) to (${mmText(pb.maxX, 2)}, ${mmText(pb.maxY, 2)}) mm`);
  }
  items.push({ id: "layers.aligned", group: "placement and files", title: outside.length ? `${plural(outside.length, "layer")} reach outside the outline` : "All layers share the profile's origin and lie within the outline", status: outside.length ? "warn" : "pass", ...(outside.length ? { detail: outside } : {}) });
  return items;
}

// ------------------------------------------------------------------- drill read-back

export function checkDrill(holes: Hole[], reads: { file: string; read: ExcellonRead }[], copper: WrittenGerber[], origin: Pt): PreflightItem[] {
  const items: PreflightItem[] = [];
  const problems: string[] = [];
  for (const r of reads) for (const e of r.read.errors) problems.push(`${r.file}: ${e}`);
  // compare as the file writes them: millimeters with 4 decimals
  const q = (v: number) => mmText(v, 4);
  const k = (x: number, y: number, d: number, slot?: { a: Pt; b: Pt }) => (slot ? `slot|${q(slot.a.x)}|${q(slot.a.y)}|${q(slot.b.x)}|${q(slot.b.y)}|${d}` : `hole|${q(x)}|${q(y)}|${d}`);
  const want = new Map<string, number>();
  for (const h of holes) {
    const key = k(h.x - origin.x, h.y - origin.y, h.d, h.slot && { a: { x: h.slot.a.x - origin.x, y: h.slot.a.y - origin.y }, b: { x: h.slot.b.x - origin.x, y: h.slot.b.y - origin.y } });
    want.set(key, (want.get(key) ?? 0) + 1);
  }
  const got = new Map<string, number>();
  let read = 0;
  for (const r of reads)
    for (const h of r.read.holes) {
      read++;
      const key = k(h.x, h.y, h.d, h.slot);
      got.set(key, (got.get(key) ?? 0) + 1);
    }
  let miss = 0;
  let extra = 0;
  for (const [key, n] of want) miss += Math.max(0, n - (got.get(key) ?? 0));
  for (const [key, n] of got) extra += Math.max(0, n - (want.get(key) ?? 0));
  const sizesWant = [...new Set(holes.map((h) => h.d))].sort((a, b) => a - b);
  const sizesGot = [...new Set(reads.flatMap((r) => [...r.read.tools.values()].map((t) => t.d)))].sort((a, b) => a - b);
  const sameSizes = sizesWant.join(",") === sizesGot.join(",");
  const ok = !problems.length && !miss && !extra && read === holes.length && sameSizes;
  items.push({
    id: "drill.readback",
    group: "board",
    title: ok ? `Drill read-back: ${plural(holes.length, "hole")} (${holes.filter((h) => h.slot).length} slots) in ${plural(sizesGot.length, "tool size")}, positions and sizes equal` : `Drill read-back differs: ${miss} missing, ${extra} unexpected${sameSizes ? "" : ", tool sizes differ"}`,
    status: ok ? "pass" : "fail",
    counts: { holes: holes.length, read, missing: miss, unexpected: extra, plated: holes.filter((h) => h.plated).length, nonPlated: holes.filter((h) => !h.plated).length },
    detail: [`tool sizes: ${sizesGot.map((d) => mmText(d, 3)).join(", ")} mm`, ...problems.slice(0, 10)],
  });
  // registration: each plated hole lies inside a copper flash on every layer of its span that was written
  const notIn: string[] = [];
  for (const h of holes.filter((x) => x.plated)) {
    for (const w of copper) {
      const c = w.layer.copper!;
      const stackIdx = w.layer.index!;
      const span = [copper.find((x) => x.layer.copper === h.span[0])?.layer.index ?? 0, copper.find((x) => x.layer.copper === h.span[1])?.layer.index ?? 0];
      if (stackIdx < span[0] || stackIdx > span[1]) continue;
      const p = { x: h.x - origin.x, y: h.y - origin.y };
      if (!flashCovers(w.read, p)) notIn.push(`${h.src} at (${mmText(p.x, 3)}, ${mmText(p.y, 3)}) mm: no pad on ${c}`);
    }
  }
  items.push({ id: "drill.registration", group: "board", title: notIn.length ? `${plural(notIn.length, "plated hole")} not inside a pad on a layer of its span` : "Every plated hole lies inside its pad or via on each layer of its span", status: notIn.length ? "fail" : "pass", ...(notIn.length ? { detail: notIn.slice(0, 20) } : {}) });
  return items;
}

const shapeCache = new WeakMap<GerberRead, Map<number, Pt[][]>>();
function flashCovers(read: GerberRead, p: Pt): boolean {
  let cache = shapeCache.get(read);
  if (!cache) shapeCache.set(read, (cache = new Map()));
  for (const o of read.objects) {
    if (o.k !== "flash" || !o.dark) continue;
    if (Math.abs(o.x - p.x) > 20e6 || Math.abs(o.y - p.y) > 20e6) continue;
    let rings = cache.get(o.ap);
    if (!rings) {
      const ap = read.apertures.get(o.ap);
      rings = ap ? apertureShapes(read, ap).filter((s) => !s.clear).map((s) => s.ring) : [];
      cache.set(o.ap, rings);
    }
    const local = { x: p.x - o.x, y: p.y - o.y };
    if (rings.some((r) => inRing(local, r))) return true;
  }
  return false;
}

// ------------------------------------------------------------------- netlist

export function checkNetAttributes(doc: BoardDocument, copper: WrittenGerber[], origin: Pt): PreflightItem {
  const wrong: string[] = [];
  let pads = 0;
  const byPad = new Map<string, string>();
  for (const fp of recordsOfKind(doc, "footprint")) for (const wp of padsOf(fp)) byPad.set(`${fp.ref}|${wp.pad.number}|${wp.x - origin.x}|${wp.y - origin.y}`, doc.padNets.get(wp.id) ?? "N/C");
  for (const w of copper)
    for (const o of w.read.objects) {
      if (o.k !== "flash" || !o.attrs[".P"]) continue;
      pads++;
      const n = o.attrs[".N"]?.[0];
      const p = o.attrs[".P"];
      const want = byPad.get(`${p[0]}|${p[1]}|${o.x}|${o.y}`);
      if (want === undefined) wrong.push(`${w.file}: ${p[0]}.${p[1]} flashed where the board has no such pad`);
      else if (n !== want) wrong.push(`${w.file}: ${p[0]}.${p[1]} carries net ${n ?? "none"}, the board says ${want}`);
    }
  return { id: "nets.attributes", group: "copper and nets", title: wrong.length ? `${plural(wrong.length, "pad")} with a wrong net attribute` : `CAD netlist in the Gerbers: ${pads} pad flashes carry the board's net (.N) and pin (.P)`, status: wrong.length ? "fail" : pads ? "pass" : "info", ...(wrong.length ? { detail: wrong.slice(0, 20) } : {}) };
}

export function checkIpc356(records: Ipc356Record[], read: Ipc356Read, origin: Pt): PreflightItem {
  const issues: string[] = [...read.errors];
  if (read.records.length !== records.length) issues.push(`${read.records.length} records read, ${records.length} written`);
  const tol = 2540;
  read.records.forEach((r, i) => {
    const w = records[i];
    if (!w) return;
    if (r.net !== w.net || r.ref !== w.ref || r.pin !== w.pin) issues.push(`record ${i + 1}: ${r.ref}-${r.pin} net ${r.net}, written ${w.ref}-${w.pin} net ${w.net}`);
    else if (Math.abs(r.x - (w.x - origin.x)) > tol || Math.abs(r.y - (w.y - origin.y)) > tol) issues.push(`record ${i + 1}: ${r.ref}-${r.pin} position differs`);
  });
  const nets = new Set(records.map((r) => r.net).filter((n) => n !== "N/C")).size;
  return { id: "netlist.ipc356", group: "copper and nets", title: issues.length ? `IPC-D-356 read-back: ${plural(issues.length, "difference")}` : `IPC-D-356 netlist: ${records.length} test records, ${nets} nets, read back equal`, status: issues.length ? "fail" : "pass", ...(issues.length ? { detail: issues.slice(0, 20) } : {}) };
}

// ------------------------------------------------------------------- placement and BOM

export function checkPlacement(doc: BoardDocument, rows: PlacementRow[], cplText: string, cplFormat: "jlcpcb" | "generic", bomText: string, bomFormat: string): PreflightItem[] {
  const items: PreflightItem[] = [];
  const lines = cplText.trim().split("\n").slice(1).map(parseCsvLine);
  const placed = rows.filter((r) => !r.noBom && !r.dnp && !r.hand);
  const issues: string[] = [];
  if (lines.length !== placed.length) issues.push(`${lines.length} rows, ${placed.length} parts to place`);
  const seen = new Set<string>();
  const byRef = new Map(placed.map((r) => [r.ref, r]));
  for (const l of lines) {
    const ref = l[0];
    if (seen.has(ref)) issues.push(`${ref} appears twice`);
    seen.add(ref);
    const r = byRef.get(ref);
    if (!r) {
      issues.push(`${ref} is not a placed footprint`);
      continue;
    }
    const xs = cplFormat === "jlcpcb" ? l[1].replace(/mm$/, "") : l[3];
    const ys = cplFormat === "jlcpcb" ? l[2].replace(/mm$/, "") : l[4];
    const x = Math.round(Number(xs) * 1e6);
    const y = Math.round(Number(ys) * 1e6);
    if (Math.abs(x - r.x) > 50 || Math.abs(y - r.y) > 50) issues.push(`${ref} at (${xs}, ${ys}) mm, footprint at (${mmText(r.x, 4)}, ${mmText(r.y, 4)}) mm`);
  }
  items.push({ id: "placement.rows", group: "placement and files", title: issues.length ? `Placement file: ${plural(issues.length, "problem")}` : `Placement file: ${lines.length} rows, one per placed footprint, positions equal to the board`, status: issues.length ? "fail" : "pass", ...(issues.length ? { detail: issues.slice(0, 20) } : {}) });
  // placement point inside the part's pads (the assembler places by this point)
  const off: string[] = [];
  const stack = copperLayers(doc);
  for (const fp of recordsOfKind(doc, "footprint")) {
    const r = byRef.get(fp.ref);
    if (!r) continue;
    const pads = padsOf(fp, stack);
    if (!pads.length) continue;
    const b = pads.reduce((a, p) => ({ minX: Math.min(a.minX, p.box.minX), minY: Math.min(a.minY, p.box.minY), maxX: Math.max(a.maxX, p.box.maxX), maxY: Math.max(a.maxY, p.box.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    if (fp.x < b.minX || fp.x > b.maxX || fp.y < b.minY || fp.y > b.maxY) off.push(`${fp.ref}: placement point outside its pads' box`);
  }
  items.push({ id: "placement.centroid", group: "placement and files", title: off.length ? `${plural(off.length, "part")} placed at a point outside its pads` : "Every placement point lies within its part's pads", status: off.length ? "warn" : "pass", ...(off.length ? { detail: off } : {}) });
  // BOM designators against the placement
  const bomRows = bomText.trim().split("\n").slice(1).map(parseCsvLine);
  const desCol = bomFormat === "jlcpcb" ? 1 : bomFormat === "circuithub" ? 0 : 2;
  const bomRefs = bomRows.flatMap((l) => (l[desCol] ?? "").split(",").filter(Boolean));
  const dup = bomRefs.filter((r, i) => bomRefs.indexOf(r) !== i);
  const notOnBoard = bomRefs.filter((r) => !rows.some((x) => x.ref === r));
  const placedNotInBom = bomFormat === "jlcpcb" ? placed.filter((r) => !bomRefs.includes(r.ref)).map((r) => r.ref) : [];
  const bi = [...dup.map((r) => `${r} twice in the BOM`), ...notOnBoard.map((r) => `${r} in the BOM but not on the board`), ...placedNotInBom.map((r) => `${r} placed but not in the BOM`)];
  items.push({ id: "bom.designators", group: "parts and BOM", title: bi.length ? `BOM designators: ${plural(bi.length, "problem")}` : `BOM and placement designators agree (${bomRows.length} lines)`, status: bi.length ? "fail" : "pass", ...(bi.length ? { detail: bi.slice(0, 20) } : {}) });
  return items;
}

export function checkBomData(lines: BomLine[], rows: PlacementRow[], profile: FabProfile): PreflightItem[] {
  const items: PreflightItem[] = [];
  const active = lines.filter((l) => !l.dnp);
  const noLcsc = active.filter((l) => !l.consigned && !l.lcsc);
  items.push({
    id: "bom.supplier",
    group: "parts and BOM",
    title: noLcsc.length ? `${plural(noLcsc.length, "BOM line")} without an LCSC part number: ${noLcsc.flatMap((l) => l.refs).slice(0, 12).join(", ")}${noLcsc.flatMap((l) => l.refs).length > 12 ? ", ..." : ""}` : `${active.length} lines, every line has an LCSC part number or is consigned`,
    status: noLcsc.length ? (profile.id === "jlcpcb" ? "fail" : "warn") : "pass",
    detail: noLcsc.map((l) => `line ${l.item} (${l.refs.join(",")}, ${l.value || l.package}): no supplier part number; not guessed`),
  });
  const consigned = active.filter((l) => l.consigned);
  if (consigned.length) items.push({ id: "bom.consigned", group: "parts and BOM", title: `${plural(consigned.length, "consigned line")} (supplied by you): ${consigned.flatMap((l) => l.refs).join(", ")}`, status: "info" });
  const dnp = lines.filter((l) => l.dnp);
  if (dnp.length) items.push({ id: "bom.dnp", group: "parts and BOM", title: `${dnp.flatMap((l) => l.refs).length} parts not placed (DNP): ${dnp.flatMap((l) => l.refs).join(", ")}`, status: "info" });
  const excluded = rows.filter((r) => r.noBom);
  if (excluded.length) items.push({ id: "bom.excluded", group: "parts and BOM", title: `${plural(excluded.length, "footprint")} left out of the BOM: ${excluded.map((r) => `${r.ref} (${r.noBomReason})`).join("; ")}`, status: "info" });
  if (profile.rotations) {
    const placed = rows.filter((r) => !r.noBom && !r.dnp && !r.hand);
    const corrected = placed.filter((r) => r.correction.source !== "none" && r.correction.degrees !== 0);
    const unverified = placed.filter((r) => r.correction.source === "none");
    items.push({
      id: "placement.rotations",
      group: "placement and files",
      title: unverified.length ? `${plural(unverified.length, "part")} with rotations not verified for ${profile.title.split(" ")[0]}${corrected.length ? `; ${corrected.length} corrected` : ""}` : `Rotations: ${corrected.length} corrected, the rest verified or from the fab's library`,
      status: unverified.length ? "warn" : "pass",
      detail: [...corrected.map((r) => `${r.ref}: ${r.correction.degrees > 0 ? "+" : ""}${r.correction.degrees} deg (${r.correction.source}${r.correction.entry ? `, ${r.correction.entry.source}` : ""})`), ...(unverified.length ? [`check in the placement preview: ${unverified.map((r) => r.ref).join(", ")}`] : [])],
    });
  }
  return items;
}

// ------------------------------------------------------------------- fab capability

/** The fab's capability rules run through board-checks on the board with its own rules set aside. */
export function checkCapability(doc: BoardDocument, profile: FabProfile, fills: ResolvedFill | undefined): { items: PreflightItem[]; findings: Finding[] } {
  const layers = copperLayers(doc).length;
  const rules = capabilityRules(profile, layers);
  if (!rules.length) return { items: [{ id: "fab.rules", group: "fab capability", title: `${profile.title}: no numeric capability limits published; none checked`, status: "info" }], findings: [] };
  const own = recordsOfKind(doc, "rule").map((r) => r.id);
  const fabDoc = withChanges(doc, rules as unknown as BoardRecord[], own);
  const r = runBoardChecks(fabDoc, fills ? { fills: { schema: "protoboard.zone-fill/v1", fills: fills.fills } } : {});
  const findings = r.findings.filter((x) => x.rule?.startsWith("rule:fab."));
  const items: PreflightItem[] = [];
  for (const rule of rules) {
    const fs = findings.filter((x) => x.rule === rule.id);
    const errs = fs.filter((x) => x.severity === "error");
    const worst = fs.reduce<number | undefined>((m, x) => (x.measured !== undefined && (m === undefined || x.measured < m) ? x.measured : m), undefined);
    const status: Status = errs.length ? "fail" : fs.length ? "warn" : "pass";
    items.push({ id: `fab.${rule.check}.${rule.id.split(".").pop()}`, group: "fab capability", title: fs.length ? `${rule.note}: ${plural(fs.length, "finding")}${worst !== undefined ? `, worst ${fmt(worst)}` : ""}` : `${rule.note}: met`, status, ...(fs.length ? { detail: fs.slice(0, 10).map((x) => x.message) } : {}), counts: { findings: fs.length } });
  }
  const notRun = r.notRun.filter((n) => rules.some((x) => x.check === n.check));
  if (notRun.length) items.push({ id: "fab.notrun", group: "fab capability", title: `Capability checks not run: ${notRun.map((n) => n.check).join(", ")}`, status: "info", detail: notRun.map((n) => `${n.check}: ${n.reason}`) });
  return { items, findings };
}

/** Limits the board-checks rules do not cover: mask web, silkscreen, slots, plated pad rings, board size, layer count. */
export function checkExtraLimits(doc: BoardDocument, plot: Plot, holes: Hole[], profile: FabProfile, maskColor: string): PreflightItem[] {
  const L = profile.limits;
  const items: PreflightItem[] = [];
  const layers = copperLayers(doc).length;
  const inRange = (r: [number, number]) => layers >= r[0] && layers <= r[1];
  // mask web
  const web = L.maskWeb ? (L.maskWeb[maskColor] ?? L.maskWeb["*"]) : undefined;
  if (web !== undefined) {
    let pairs = 0;
    let worst = Infinity;
    const refs = new Set<string>();
    for (const side of ["top", "bottom"] as const) {
      const ops = plot.layers.find((l) => l.id === `soldermask:${side}`)!.objects.filter((o) => o.k === "flash");
      const shapes = ops.map((o) => {
        const ring = apertureRing((o as { ap: Parameters<typeof apertureRing>[0] }).ap).map((p) => ({ x: p.x + (o as { x: number }).x, y: p.y + (o as { y: number }).y }));
        const b = ring.reduce((a, p) => ({ minX: Math.min(a.minX, p.x), minY: Math.min(a.minY, p.y), maxX: Math.max(a.maxX, p.x), maxY: Math.max(a.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        return { ring, b, src: o.src };
      });
      shapes.sort((a, b) => a.b.minX - b.b.minX);
      for (let i = 0; i < shapes.length; i++) {
        const a = shapes[i];
        for (let j = i + 1; j < shapes.length && shapes[j].b.minX <= a.b.maxX + web; j++) {
          const b = shapes[j];
          if (b.b.minY > a.b.maxY + web || a.b.minY > b.b.maxY + web) continue;
          if (a.src === b.src) continue;
          const g = ringGap(a.ring, b.ring);
          if (g > 0 && g < web) {
            pairs++;
            worst = Math.min(worst, g);
            refs.add(a.src.split(":")[1] ?? a.src);
          }
        }
      }
    }
    items.push({ id: "mask.web", group: "silk and mask", title: pairs ? `${maskColor} mask needs a ${fmt(web)} web: ${plural(pairs, "pair")} of openings closer (smallest ${fmt(worst)}), the fab removes those webs` : `Mask web at least ${fmt(web)} (${maskColor} mask) between every pair of openings`, status: pairs ? "warn" : "pass", ...(pairs ? { detail: [`footprints: ${[...refs].slice(0, 20).join(", ")}`] } : {}) });
  }
  // silkscreen line width and text height
  if (L.silkMinLineWidth !== undefined || L.silkMinTextHeight !== undefined) {
    let thin = 0;
    let narrowest = Infinity;
    for (const l of plot.layers.filter((x) => x.kind === "legend"))
      for (const o of l.objects)
        if (o.k === "draw" && !o.clear && L.silkMinLineWidth !== undefined && o.width < L.silkMinLineWidth) {
          thin++;
          narrowest = Math.min(narrowest, o.width);
        }
    const small: string[] = [];
    const silk = (layer: string) => /silkscreen$/.test(layer);
    for (const t of recordsOfKind(doc, "text")) if (silk(t.layer) && L.silkMinTextHeight !== undefined && t.height < L.silkMinTextHeight) small.push(`${t.id} ${fmt(t.height)}`);
    for (const fp of recordsOfKind(doc, "footprint")) for (const t of fp.texts ?? []) if (silk(t.layer) && L.silkMinTextHeight !== undefined && t.height < L.silkMinTextHeight) small.push(`${fp.ref} ${t.role ?? "text"} ${fmt(t.height)}`);
    const st: Status = thin || small.length ? "warn" : "pass";
    items.push({ id: "silk.size", group: "silk and mask", title: st === "pass" ? `Silkscreen lines ${fmt(L.silkMinLineWidth ?? 0)} and up, text ${fmt(L.silkMinTextHeight ?? 0)} and up` : `Silkscreen: ${plural(thin, "stroke")} under ${fmt(L.silkMinLineWidth ?? 0)}${thin ? ` (narrowest ${fmt(narrowest)})` : ""}, ${plural(small.length, "text")} under ${fmt(L.silkMinTextHeight ?? 0)}`, status: st, ...(small.length ? { detail: small.slice(0, 20) } : {}) });
  }
  // holes: NPTH size, slot widths
  const hp: string[] = [];
  if (L.npthMinHole !== undefined) for (const h of holes) if (!h.plated && !h.slot && h.d < L.npthMinHole) hp.push(`${h.src}: non-plated hole ${fmt(h.d)} under ${fmt(L.npthMinHole)}`);
  const ps = L.platedSlotMinWidth?.find((x) => inRange(x.layers));
  for (const h of holes) {
    if (!h.slot) continue;
    if (h.plated && ps && h.d < ps.min) hp.push(`${h.src}: plated slot ${fmt(h.d)} wide, under ${fmt(ps.min)}`);
    if (!h.plated && L.nonPlatedSlotMinWidth !== undefined && h.d < L.nonPlatedSlotMinWidth) hp.push(`${h.src}: non-plated slot ${fmt(h.d)} wide, under ${fmt(L.nonPlatedSlotMinWidth)}`);
  }
  if (L.npthMinHole !== undefined || ps || L.nonPlatedSlotMinWidth !== undefined) items.push({ id: "fab.holes", group: "fab capability", title: hp.length ? `${plural(hp.length, "hole")} under the fab's hole or slot minimum` : "Non-plated holes and slots within the fab's minimums", status: hp.length ? "fail" : "pass", ...(hp.length ? { detail: hp.slice(0, 20) } : {}) });
  // plated pad annular ring
  const ar = L.padAnnularRing?.find((x) => inRange(x.layers));
  if (ar) {
    const under: string[] = [];
    const below: string[] = [];
    for (const fp of recordsOfKind(doc, "footprint"))
      for (const p of fp.pads) {
        if (p.type !== "th") continue;
        const outer = p.shape === "circle" ? p.outer_diameter! : Math.min(p.outer_width!, p.outer_height!);
        const hole = p.hole_diameter ?? Math.min(p.hole_width ?? 0, p.hole_height ?? 0);
        const ring = (outer - hole) / 2;
        if (ring < ar.min) under.push(`${fp.ref}.${p.number}: ring ${fmt(ring)}`);
        else if (ar.recommended !== undefined && ring < ar.recommended) below.push(`${fp.ref}.${p.number}: ring ${fmt(ring)}`);
      }
    items.push({ id: "fab.pad_ring", group: "fab capability", title: under.length ? `${plural(under.length, "plated pad")} with an annular ring under ${fmt(ar.min)}` : below.length ? `${plural(below.length, "plated pad")} under the recommended ${fmt(ar.recommended!)} ring (above the ${fmt(ar.min)} minimum)` : `Plated pad rings ${fmt(ar.recommended ?? ar.min)} and up`, status: under.length ? "fail" : below.length ? "warn" : "pass", ...(under.length || below.length ? { detail: [...under, ...below].slice(0, 20) } : {}) });
  }
  // board size and layer count
  const outline = doc.records.get("outline");
  if (outline?.kind === "outline" && (L.minBoardSize || L.maxBoardSize)) {
    const pts = flattenContour(outline.outline, 1000);
    const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    const max = L.maxBoardSize?.find((x) => inRange(x.layers))?.size;
    const big = Math.max(w, h);
    const small = Math.min(w, h);
    const tooSmall = L.minBoardSize && (big < Math.max(...L.minBoardSize) || small < Math.min(...L.minBoardSize));
    const tooBig = max && (big > Math.max(...max) || small > Math.min(...max));
    items.push({ id: "fab.size", group: "board", title: `Board ${mmText(w, 2)} x ${mmText(h, 2)} mm${tooSmall ? ", under the fab's minimum" : tooBig ? ", over the fab's maximum" : ", within the fab's size range"}`, status: tooSmall || tooBig ? "fail" : "pass" });
  }
  if (L.maxLayers !== undefined && layers > L.maxLayers) items.push({ id: "fab.layers", group: "board", title: `${layers} copper layers, over the fab's ${L.maxLayers}`, status: "fail" });
  return items;
}

/** Smallest distance between two rings (0 when they overlap). */
function ringGap(a: Pt[], b: Pt[]): number {
  if (inRing(a[0], b) || inRing(b[0], a)) return 0;
  let m = Infinity;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const r = b[j];
      const s = b[(j + 1) % b.length];
      m = Math.min(m, segDist(p, q, r, s));
      if (m === 0) return 0;
    }
  }
  return m;
}
function segDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const cr = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cr(c, d, a);
  const d2 = cr(c, d, b);
  const d3 = cr(a, b, c);
  const d4 = cr(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(ps(a, c, d), ps(b, c, d), ps(c, a, b), ps(d, a, b));
}
function ps(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ------------------------------------------------------------------- the board's own checks

export function checkBoardRules(doc: BoardDocument, fills: ResolvedFill | undefined): PreflightItem[] {
  const r = runBoardChecks(doc, fills ? { fills: { schema: "protoboard.zone-fill/v1", fills: fills.fills } } : {});
  const s = r.summary;
  const items: PreflightItem[] = [];
  const unconnected = r.findings.filter((f) => f.check === "unconnected");
  const nets = new Set(unconnected.flatMap((f) => f.objects.map((o) => doc.padNets.get(o)).filter((x): x is string => !!x)));
  items.push({ id: "board.unconnected", group: "copper and nets", title: s.unconnected ? `${plural(s.unconnected, "unconnected item")}${nets.size ? ` on ${plural(nets.size, "net")}: ${[...nets].slice(0, 6).join(", ")}${nets.size > 6 ? ", ..." : ""}` : ""}` : "Every net is connected", status: s.unconnected ? "fail" : "pass" });
  const errs = r.findings.filter((f) => f.severity === "error" && f.check !== "unconnected");
  const byCheck = (fs: Finding[]) => {
    const m = new Map<string, number>();
    for (const f of fs) m.set(f.check, (m.get(f.check) ?? 0) + 1);
    return [...m].map(([k, n]) => `${k} ${n}`).join(", ");
  };
  items.push({ id: "board.errors", group: "copper and nets", title: errs.length ? `Board rule check: ${plural(errs.length, "error")} (${byCheck(errs)})` : "Board rule check: no errors at the board's floor rules", status: errs.length ? "fail" : "pass", ...(errs.length ? { detail: errs.slice(0, 10).map((f) => f.message) } : {}) });
  const warns = r.findings.filter((f) => f.severity === "warning");
  if (warns.length) items.push({ id: "board.warnings", group: "copper and nets", title: `Board rule check: ${plural(warns.length, "warning")} (${byCheck(warns)})`, status: "warn", detail: warns.slice(0, 10).map((f) => f.message) });
  if (s.caveats.length) items.push({ id: "board.caveats", group: "copper and nets", title: "What the board check did not cover", status: "info", detail: s.caveats });
  return items;
}

export { bomLines };
