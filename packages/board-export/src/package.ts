/**
 * The export commands: one function per export (`exportGerbers`, `exportDrill`, `exportBom`, `exportPlacement`,
 * `exportIpc356`, `exportDxf`, `exportIpc2581`) and `exportFabPackage`, which writes them all into one deterministic
 * folder with a manifest (hashes, the board revision), the paired images, and the pre-flight report. Every export
 * validates what it wrote by reading it back; a package is called ready only when no check fails and the zone fill is
 * current, unless an override with a reason is given, which the manifest records.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { copperLayers, dxfOutline, filesHash, loadBoardDir, serializeDocument, type BoardDocument, type BoardSnapshot } from "@protoboardai/board";
import { bomLines, placements, writeBom, writeCpl, type BomLine, type PartData, type PlacementRow } from "./assembly.js";
import { costDrivers, type CostDriver } from "./costs.js";
import { boardHoles, drillFiles, readExcellon, writeExcellon, type ExcellonRead, type Hole } from "./drill.js";
import { writeDxf, type DxfOptions } from "./dxf.js";
import { resolveFill, type FillChoice, type ResolvedFill } from "./fill.js";
import { mmText, safeName, sha256, utf8 } from "./format.js";
import { flattenContour, ringArea, type Pt } from "./geom.js";
import { readGerber, type GerberRead } from "./gerber/read.js";
import { gerbersToSvg, LAYER_COLORS } from "./gerber/svg.js";
import { writeGerber } from "./gerber/write.js";
import { bomTableSvg, cplOverlaySvg, drillMapSvg, dxfSvg, ipc356Svg, pngOf, preflightSvg } from "./images.js";
import { ipc356Records, readIpc356, writeIpc356 } from "./ipc356.js";
import { kicadAvailability, kicadCrossCheck, kicadExport, type CrossCheck, type KicadSource } from "./kicad.js";
import { plotBoard, type Plot, type PlotLayer } from "./plot.js";
import { nameOf, profileOf, type FabProfile, type RotationEntry } from "./profiles.js";
import { checkBoardRules, checkBomData, checkCapability, checkDrill, checkExtraLimits, checkGerbers, checkIpc356, checkNetAttributes, checkPlacement, checkProfile, type LayerStats, type PreflightItem, type Status, type WrittenGerber } from "./validate.js";
import { zip } from "./zip.js";

export const GENERATOR: [string, string, string] = ["Protoboard", "board-export", "0.2.2"];
export const PACKAGE_SCHEMA = "protoboard.fab-package/v1";
export const PREFLIGHT_SCHEMA = "protoboard.preflight/v1";

/** A board: a document, a snapshot, or a board folder (`board.jsonl` and its siblings). */
export type BoardInput = BoardDocument | BoardSnapshot | string;

export type OutputKind = "gerber" | "drill" | "bom" | "cpl" | "ipc356" | "dxf" | "ipc2581" | "odb" | "crossCheck";

export interface ExportOptions {
  /** The folder written. A folder holding an earlier export's manifest is cleared of that export's files first. */
  outDir: string;
  /** File name stem (default: the board's name, made file-safe). */
  name?: string;
  /** The board revision recorded in the manifest and Gerber `.ProjectId`. */
  revision?: string;
  /** Origin of every file: `center` (default, the outline's box center), `lower-left`, or a board-frame point in nm. */
  origin?: "center" | "lower-left" | Pt;
  /** Which zone fill to draw (default: a current fill cached beside a board folder, else computed). */
  fill?: FillChoice;
  /** Part data: LCSC numbers, library class, MPN, consigned, DNP, hand placement (by footprint id, UHD path or reference). */
  parts?: PartData;
  /** Rotation corrections added to the profile's table. */
  rotations?: RotationEntry[];
  /** Solder mask color (default: the profile's default). */
  maskColor?: string;
  /** `.CreationDate` in Gerber and drill files; left out unless given, so output is byte-identical. */
  creationDate?: string;
  /** Override the profile's X2 form. */
  x2?: "attributes" | "comments" | "none";
  clipSilkToMask?: boolean;
  maskExpansion?: number;
  pasteExpansion?: number;
  tentVias?: boolean;
  /** Net, pin and component attributes on copper (default true). */
  netAttributes?: boolean;
  dxf?: DxfOptions;
  /** Toggles for the package (default: every output; IPC-2581 and ODB++ for profiles that upload them; the KiCad cross-check when KiCad can run). */
  outputs?: Partial<Record<OutputKind, boolean>>;
  /** PNG beside every SVG (default true when available). */
  png?: boolean;
  /** KiCad steps: the `.kicad_pcb` the board was imported from, and a kicad-cli path. */
  kicad?: KicadSource;
  /** Call the package ready although checks fail or the fill is stale; recorded in the manifest. */
  override?: { reason: string; by: string };
}

export interface ExportedFile {
  /** Relative to the export folder, `/` separated. */
  path: string;
  role: string;
  sha256: string;
  bytes: number;
  /** The paired image (SVG and, when available, PNG), relative paths. */
  image?: { svg: string; svgSha256: string; png?: string; pngSha256?: string };
}

export interface Preflight {
  schema: typeof PREFLIGHT_SCHEMA;
  board: string;
  profile: string;
  /** `ready`, `overridden` or `not-ready`. */
  verdict: "ready" | "overridden" | "not-ready";
  counts: Record<Status, number>;
  items: PreflightItem[];
  costDrivers: CostDriver[];
  override?: { reason: string; by: string; failed: string[] };
}

export interface ExportResult {
  outDir: string;
  files: ExportedFile[];
  preflight: Preflight;
  /** Per Gerber file: object counts read back. */
  layers?: LayerStats[];
  crossCheck?: CrossCheck;
}

// ------------------------------------------------------------------- context

interface OutFile {
  path: string;
  role: string;
  data: Uint8Array;
  svg?: string;
}

interface Ctx {
  doc: BoardDocument;
  profile: FabProfile;
  name: string;
  origin: Pt;
  originMode: string;
  fill: ResolvedFill | undefined;
  plot: Plot;
  holes: Hole[];
  rows: PlacementRow[];
  lines: BomLine[];
  maskColor: string;
  options: ExportOptions;
  files: OutFile[];
  items: PreflightItem[];
  profileRead?: GerberRead;
  gerbers?: WrittenGerber[];
  layerStats?: LayerStats[];
  drillReads?: { file: string; read: ExcellonRead; plated: string }[];
  cross?: CrossCheck;
}

function docOf(board: BoardInput, options: ExportOptions): { doc: BoardDocument; fill: FillChoice } {
  if (typeof board === "string") {
    const loaded = loadBoardDir(board);
    return { doc: loaded.doc, fill: { boardDir: board, ...options.fill } };
  }
  const doc = "doc" in board && (board as BoardSnapshot).doc ? (board as BoardSnapshot).doc : (board as BoardDocument);
  return { doc, fill: options.fill ?? {} };
}

function originOf(doc: BoardDocument, mode: ExportOptions["origin"]): { origin: Pt; mode: string } {
  if (mode && typeof mode === "object") return { origin: { x: Math.round(mode.x), y: Math.round(mode.y) }, mode: "point" };
  const o = doc.records.get("outline");
  if (o?.kind !== "outline") return { origin: { x: 0, y: 0 }, mode: "center (no outline: the board frame's origin)" };
  const pts = flattenContour(o.outline, 1000);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  if (mode === "lower-left") return { origin: { x: minX, y: minY }, mode: "lower-left" };
  return { origin: { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) }, mode: "center" };
}

function prepare(board: BoardInput, profileIn: string | FabProfile, options: ExportOptions): Ctx {
  const profile = profileOf(profileIn);
  const { doc, fill: choice } = docOf(board, options);
  const b = doc.records.get("board");
  const name = safeName(options.name ?? (b?.kind === "board" ? b.name : "board"));
  const { origin, mode } = originOf(doc, options.origin);
  const fill = resolveFill(doc, choice);
  const plot = plotBoard(doc, fill, {
    clipSilkToMask: options.clipSilkToMask ?? profile.gerber.clipSilkToMask,
    ...(options.maskExpansion !== undefined ? { maskExpansion: options.maskExpansion } : {}),
    ...(options.pasteExpansion !== undefined ? { pasteExpansion: options.pasteExpansion } : {}),
    ...(options.tentVias !== undefined ? { tentVias: options.tentVias } : {}),
    netAttributes: options.netAttributes !== false,
  });
  const holes = boardHoles(doc);
  const rows = placements(doc, profile, { origin, ...(options.parts ? { parts: options.parts } : {}), ...(options.rotations ? { rotations: options.rotations } : {}) });
  const lines = bomLines(rows, name);
  return { doc, profile, name, origin, originMode: mode, fill, plot, holes, rows, lines, maskColor: options.maskColor ?? profile.maskColorDefault, options, files: [], items: [] };
}

const layerColor = (l: PlotLayer) => (l.kind === "copper" ? (l.side ? LAYER_COLORS.copper : LAYER_COLORS.inner) : LAYER_COLORS[l.kind]);

function layerName(ctx: Ctx, l: PlotLayer): string {
  const names = ctx.profile.gerber.names;
  if (l.kind === "copper" && !l.side) return nameOf(names.inner, { board: ctx.name, i: l.index! - 1 });
  if (l.kind === "copper" && l.side === "bottom" && copperLayers(ctx.doc).length === 1) return nameOf(names["copper:bottom"], { board: ctx.name });
  return nameOf(names[l.id], { board: ctx.name });
}

function projectId(ctx: Ctx): [string, string, string] {
  const h = sha256(`${ctx.name}|${ctx.options.revision ?? ""}`);
  const guid = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return [ctx.name, guid, ctx.options.revision ?? "rev?"];
}

// ------------------------------------------------------------------- generators

function genGerbers(ctx: Ctx): void {
  const x2 = ctx.options.x2 ?? ctx.profile.gerber.x2;
  const written: WrittenGerber[] = [];
  for (const l of ctx.plot.layers) {
    // empty paste and legend layers of a side with nothing on it are still written: the set of files is fixed
    const text = writeGerber(l, { origin: ctx.origin, x2, generator: GENERATOR, projectId: projectId(ctx), ...(ctx.options.creationDate ? { creationDate: ctx.options.creationDate } : {}) });
    const file = `fab/files/${layerName(ctx, l)}`;
    const read = readGerber(text);
    written.push({ layer: l, file, text, read });
  }
  ctx.gerbers = written;
  ctx.profileRead = written.find((w) => w.layer.kind === "profile")?.read;
  for (const w of written) {
    const under = w.layer.kind === "profile" ? [] : ctx.profileRead ? [{ read: ctx.profileRead, color: LAYER_COLORS.profile, opacity: 0.6 }] : [];
    const svg = gerbersToSvg([...under, { read: w.read, color: layerColor(w.layer) }], { caption: `${w.file.split("/").pop()} ${w.layer.fileFunction} ${w.layer.polarity}`, mirror: w.layer.side === "bottom" });
    ctx.files.push({ path: w.file, role: `gerber ${w.layer.fileFunction}`, data: utf8(w.text), svg });
  }
  // composite views (images only)
  const pick = (id: string) => written.find((w) => w.layer.id === id);
  for (const side of ["top", "bottom"] as const) {
    const c = written.find((w) => w.layer.kind === "copper" && w.layer.side === side);
    const parts = [c && { read: c.read, color: LAYER_COLORS.copper }, pick(`soldermask:${side}`) && { read: pick(`soldermask:${side}`)!.read, color: LAYER_COLORS.soldermask, opacity: 0.55 }, pick(`legend:${side}`) && { read: pick(`legend:${side}`)!.read, color: LAYER_COLORS.legend }, ctx.profileRead && { read: ctx.profileRead, color: LAYER_COLORS.profile }].filter(Boolean) as { read: GerberRead; color: string; opacity?: number }[];
    ctx.files.push({ path: `images/${side}-composite`, role: "image", data: new Uint8Array(), svg: gerbersToSvg(parts, { caption: `${ctx.name} ${side.toUpperCase()} (COPPER, MASK OPENINGS, SILKSCREEN, OUTLINE) AS WRITTEN`, mirror: side === "bottom" }) });
  }
  const copper = written.filter((w) => w.layer.kind === "copper");
  const g = checkGerbers(ctx.doc, written, ctx.fill, ctx.origin, ctx.options.netAttributes !== false);
  ctx.layerStats = g.stats;
  ctx.items.push(...g.items);
  if (ctx.options.netAttributes !== false) ctx.items.push(checkNetAttributes(ctx.doc, copper, ctx.origin));
  ctx.items.push(...checkProfile(ctx.doc, written.find((w) => w.layer.kind === "profile"), written.filter((w) => w.layer.kind !== "profile")));
  for (const n of ctx.plot.notes) ctx.items.push({ id: "plot.note", group: "placement and files", title: n, status: "info" });
}

function genDrill(ctx: Ctx): void {
  const files = drillFiles(ctx.doc, ctx.holes, { split: ctx.profile.drill.split });
  const reads: { file: string; read: ExcellonRead; plated: string }[] = [];
  for (const f of files) {
    const names = ctx.profile.drill.names;
    const nm = f.key === "pth" ? names.pth : f.key === "npth" ? names.npth : f.key === "mixed" ? names.mixed : names.span;
    const path = `fab/files/${nameOf(nm, { board: ctx.name, i: f.span[0], j: f.span[1] })}`;
    const text = writeExcellon(f, { origin: ctx.origin, generator: GENERATOR, slotMode: ctx.profile.drill.slotMode, x2: (ctx.options.x2 ?? ctx.profile.gerber.x2) !== "none", ...(ctx.options.creationDate ? { creationDate: ctx.options.creationDate } : {}) });
    const read = readExcellon(text);
    reads.push({ file: path.split("/").pop()!, read, plated: f.plated });
    ctx.files.push({ path, role: `drill ${f.fileFunction}`, data: utf8(text), svg: drillMapSvg([{ name: path.split("/").pop()!, read, plated: f.plated }], ctx.profileRead, `DRILL MAP ${path.split("/").pop()} ${f.fileFunction}`) });
  }
  if (files.length) ctx.files.push({ path: "images/drill-map", role: "image", data: new Uint8Array(), svg: drillMapSvg(reads.map((r) => ({ name: r.file, read: r.read, plated: r.plated })), ctx.profileRead, `${ctx.name} DRILL MAP, ALL FILES`) });
  ctx.drillReads = reads;
  const copper = (ctx.gerbers ?? []).filter((w) => w.layer.kind === "copper");
  const items = checkDrill(ctx.holes, reads, copper, ctx.origin);
  if (!copper.length) items.splice(1, 1);
  ctx.items.push(...items);
}

function genAssembly(ctx: Ctx, which: { bom: boolean; cpl: boolean }): void {
  const p = ctx.profile;
  const bomText = writeBom(ctx.lines, p.assembly.bom, { consignedInBom: p.assembly.consignedInBom });
  const cplText = writeCpl(ctx.rows, p.assembly.cpl);
  const pid = p.id;
  if (which.bom) {
    ctx.files.push({ path: `assembly/${ctx.name}-bom-${pid}.csv`, role: `BOM (${p.assembly.bom} format)`, data: utf8(bomText), svg: bomTableSvg(ctx.lines, `${ctx.name} BOM ${pid.toUpperCase()} FORMAT, ${ctx.lines.length} LINES`) });
    if (p.assembly.bom !== "generic") ctx.files.push({ path: `assembly/${ctx.name}-bom.csv`, role: "BOM (generic, designator-grouped)", data: utf8(writeBom(ctx.lines, "generic")), svg: bomTableSvg(ctx.lines, `${ctx.name} BOM GENERIC FORMAT`) });
    ctx.files.push({ path: `data/${ctx.name}-bom.json`, role: "BOM data (JSON)", data: utf8(`${JSON.stringify(ctx.lines, null, 2)}\n`) });
  }
  if (which.cpl) {
    const hasTable = !!p.rotations;
    ctx.files.push({ path: `assembly/${ctx.name}-cpl-${pid}.csv`, role: `placement (${p.assembly.cpl} format)`, data: utf8(cplText), svg: cplOverlaySvg(ctx.rows, ctx.profileRead, ctx.origin, `${ctx.name} PLACEMENT ${pid.toUpperCase()}, ORIGIN ${ctx.originMode.toUpperCase()}`, hasTable) });
    if (p.assembly.cpl !== "generic") ctx.files.push({ path: `assembly/${ctx.name}-pnp.csv`, role: "placement (generic)", data: utf8(writeCpl(ctx.rows, "generic")), svg: cplOverlaySvg(ctx.rows, ctx.profileRead, ctx.origin, `${ctx.name} PLACEMENT GENERIC`, hasTable) });
    ctx.files.push({ path: `data/${ctx.name}-placements.json`, role: "placement data (JSON)", data: utf8(`${JSON.stringify(ctx.rows, null, 2)}\n`) });
  }
  if (which.bom || which.cpl) {
    ctx.items.push(...checkBomData(ctx.lines, ctx.rows, p));
    ctx.items.push(...checkPlacement(ctx.doc, ctx.rows, cplText, p.assembly.cpl, bomText, p.assembly.bom));
  }
}

function genIpc356(ctx: Ctx): void {
  const text = writeIpc356(ctx.doc, { origin: ctx.origin, job: ctx.name });
  const read = readIpc356(text);
  const path = `netlist/${ctx.name}.ipc356`;
  ctx.files.push({ path, role: "IPC-D-356A netlist (bare-board test)", data: utf8(text), svg: ipc356Svg(read, ctx.profileRead, ctx.origin, `${ctx.name} IPC-D-356A TEST POINTS`) });
  ctx.items.push(checkIpc356(ipc356Records(ctx.doc), read, ctx.origin));
}

function genDxf(ctx: Ctx): void {
  const text = writeDxf(ctx.doc, { origin: ctx.origin, ...(ctx.options.dxf ?? {}) });
  const path = `mech/${ctx.name}-outline.dxf`;
  ctx.files.push({ path, role: "DXF outline for mechanical CAD", data: utf8(text), svg: dxfSvg(text, `${ctx.name} DXF ${ctx.options.dxf?.pads ? "OUTLINE AND PADS" : "OUTLINE"}`) });
  // read back with the board package's DXF reader
  const outline = ctx.doc.records.get("outline");
  if (outline?.kind !== "outline") {
    ctx.items.push({ id: "dxf.readback", group: "placement and files", title: "DXF: the board has no outline", status: "warn" });
    return;
  }
  try {
    const r = dxfOutline(text, { layers: ["OUTLINE", "CUTOUTS"], origin: "keep" });
    const want = Math.abs(ringArea(flattenContour(outline.outline, 500)));
    const got = Math.abs(ringArea(flattenContour(r.outline, 500)));
    const cut = ctx.doc.records.size ? [...ctx.doc.records.values()].filter((x) => x.kind === "cutout").length : 0;
    const ok = Math.abs(got - want) / want < 1e-4 && r.cutouts.length === cut;
    ctx.items.push({ id: "dxf.readback", group: "placement and files", title: ok ? `DXF read back: outline ${(got / 1e12).toFixed(1)} mm2 and ${plural(cut, "cutout")}, as on the board` : `DXF read back differs: area ${(got / 1e12).toFixed(2)} mm2 versus ${(want / 1e12).toFixed(2)}, ${r.cutouts.length} cutouts versus ${cut}`, status: ok ? "pass" : "fail" });
  } catch (e) {
    ctx.items.push({ id: "dxf.readback", group: "placement and files", title: `DXF read back failed: ${(e as Error).message}`, status: "fail" });
  }
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function genKicad(ctx: Ctx, which: { ipc2581: boolean; odb: boolean; cross: boolean }): Promise<void> {
  const av = await kicadAvailability(ctx.doc, ctx.options.kicad);
  for (const kind of ["ipc2581", "odb"] as const) {
    if (!which[kind]) continue;
    const title = kind === "ipc2581" ? "IPC-2581 (revision C)" : "ODB++";
    const r = kicadExport(av, kind);
    if (r.ok && r.bytes) {
      const path = kind === "ipc2581" ? `intelligent/${ctx.name}.ipc2581.xml` : `intelligent/${ctx.name}-odb.zip`;
      ctx.files.push({ path, role: `${title} through kicad-cli`, data: r.bytes });
      ctx.items.push({ id: `kicad.${kind}`, group: "placement and files", title: `${title} ${r.message}`, status: "pass", detail: ["kicad-cli output carries its own timestamps: this file is not byte-stable between runs"] });
    } else ctx.items.push({ id: `kicad.${kind}`, group: "placement and files", title: `${title}: ${r.message}`, status: ctx.profile.upload === "ipc2581-or-kicad" ? "fail" : "skip" });
  }
  if (which.cross) {
    const ours = (ctx.gerbers ?? []).map((w) => ({ fileFunction: w.layer.fileFunction, read: w.read }));
    const holes = { holes: ctx.holes.length, sizes: [...new Set(ctx.holes.map((h) => h.d))].sort((a, b) => a - b) };
    const cc = kicadCrossCheck(av, ours, holes);
    ctx.cross = cc;
    if (!cc.ok) ctx.items.push({ id: "kicad.cross", group: "cross-check", title: `KiCad cross-check: ${cc.message}`, status: "skip" });
    else {
      const diff = cc.rows.filter((r) => r.note && r.ours);
      const fmtC = (c: CrossCheck["rows"][number]["ours"]) => (c ? `${c.flashes} flashes, ${c.draws + c.arcs} draws, ${c.regions} regions` : "none");
      ctx.items.push({ id: "kicad.cross", group: "cross-check", title: diff.length ? `KiCad cross-check: object counts differ on ${plural(diff.length, "layer")} (each explained)` : `KiCad cross-check: object counts equal on every layer`, status: diff.length ? "info" : "pass", detail: cc.rows.map((r) => `${r.fileFunction}: ours ${fmtC(r.ours)}; KiCad ${fmtC(r.kicad)}${r.note ? ` (${r.note})` : ""}`) });
      if (cc.drill) {
        const same = cc.drill.ours.holes === cc.drill.kicad.holes;
        ctx.items.push({ id: "kicad.cross.drill", group: "cross-check", title: same ? `KiCad cross-check: ${cc.drill.ours.holes} holes in both drill sets` : `KiCad cross-check: ${cc.drill.ours.holes} holes ours, ${cc.drill.kicad.holes} KiCad's`, status: same ? "pass" : "warn", detail: [`sizes ours ${cc.drill.ours.sizes.map((d) => mmText(d, 3)).join(", ")}; KiCad ${cc.drill.kicad.sizes.map((d) => mmText(d, 3)).join(", ")} (KiCad rounds sizes to 3 decimals)`] });
      }
    }
  }
}

// ------------------------------------------------------------------- writing

/** Remove the files an earlier export listed in its manifest (and folders left empty); refuse a folder that is not an export's. */
function clearOut(outDir: string): void {
  if (!existsSync(outDir)) return;
  const entries = readdirSync(outDir);
  if (!entries.length) return;
  const mpath = join(outDir, "manifest.json");
  if (!existsSync(mpath)) throw new Error(`refusing to write into ${outDir}: it is not empty and holds no export manifest`);
  const m = JSON.parse(readFileSync(mpath, "utf8")) as { schema?: string; files?: { path: string; image?: { svg: string; png?: string } }[]; written?: string[] };
  if (m.schema !== PACKAGE_SCHEMA) throw new Error(`refusing to write into ${outDir}: its manifest.json is not a ${PACKAGE_SCHEMA} manifest`);
  const paths = new Set<string>(m.written ?? []);
  for (const p of paths) {
    const full = join(outDir, ...p.split("/"));
    if (existsSync(full)) unlinkSync(full);
  }
  const prune = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) prune(join(dir, e.name));
    if (dir !== outDir && !readdirSync(dir).length) rmdirSync(dir);
  };
  prune(outDir);
}

function writeAll(outDir: string, files: OutFile[], png: boolean): { exported: ExportedFile[]; written: string[]; images: NonNullable<ExportedFile["image"]>[] } {
  const exported: ExportedFile[] = [];
  const images: NonNullable<ExportedFile["image"]>[] = [];
  const written: string[] = [];
  const put = (rel: string, data: Uint8Array) => {
    const full = join(outDir, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
    written.push(rel);
  };
  for (const f of files) {
    let image: ExportedFile["image"];
    if (f.svg) {
      const base = f.path.startsWith("images/") ? f.path : `images/${f.path}`;
      const svgBytes = utf8(f.svg);
      put(`${base}.svg`, svgBytes);
      image = { svg: `${base}.svg`, svgSha256: sha256(svgBytes) };
      const p = png ? pngOf(f.svg) : undefined;
      if (p) {
        put(`${base}.png`, p);
        image.png = `${base}.png`;
        image.pngSha256 = sha256(p);
      }
    }
    if (f.role === "image") {
      if (image) images.push(image);
      continue;
    }
    put(f.path, f.data);
    exported.push({ path: f.path, role: f.role, sha256: sha256(f.data), bytes: f.data.length, ...(image ? { image } : {}) });
  }
  return { exported, written, images };
}

function verdictOf(items: PreflightItem[], fill: ResolvedFill | undefined, override: ExportOptions["override"]): { verdict: Preflight["verdict"]; failed: string[] } {
  const failed = items.filter((i) => i.status === "fail").map((i) => i.id);
  if (fill && !fill.current) failed.push("fill.stale");
  if (!failed.length) return { verdict: "ready", failed };
  return { verdict: override ? "overridden" : "not-ready", failed };
}

function counts(items: PreflightItem[]): Record<Status, number> {
  const c: Record<Status, number> = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const i of items) c[i.status]++;
  return c;
}

function fillItem(ctx: Ctx): PreflightItem | undefined {
  if (!ctx.fill) return undefined;
  return { id: "fill.state", group: "board", title: ctx.fill.current ? `Zone fill: ${ctx.fill.note}` : `Zone fill is stale: ${ctx.fill.note}`, status: ctx.fill.current ? "pass" : "fail" };
}

function boardItems(ctx: Ctx): PreflightItem[] {
  const stack = copperLayers(ctx.doc);
  const board = ctx.doc.records.get("board");
  const thick = board?.kind === "board" ? `${mmText(board.thickness, 2)} mm` : "?";
  const items: PreflightItem[] = [{ id: "board.stackup", group: "board", title: `Stackup: ${stack.length} copper layers, ${thick} thick`, status: "info" }];
  items.push({ id: "board.origin", group: "placement and files", title: `Origin of every file: ${ctx.originMode}, board point (${mmText(ctx.origin.x, 4)}, ${mmText(ctx.origin.y, 4)}) mm; +Y up, seen from the top`, status: "info" });
  const f = fillItem(ctx);
  if (f) items.push(f);
  return items;
}

function makePreflight(ctx: Ctx, drivers: CostDriver[]): Preflight {
  const order = ["board", "copper and nets", "silk and mask", "parts and BOM", "placement and files", "fab capability", "cross-check"];
  const items = [...boardItems(ctx), ...ctx.items, ...ctx.profile.notes.map((n, i): PreflightItem => ({ id: `profile.note.${i}`, group: "placement and files", title: n, status: "info" }))]
    .map((it, i) => ({ it, i }))
    .sort((a, b) => order.indexOf(a.it.group) - order.indexOf(b.it.group) || a.i - b.i)
    .map((x) => x.it);
  // the proof image beside each check (the export screen shows it)
  const paths = new Set(ctx.files.filter((f) => f.svg).map((f) => (f.path.startsWith("images/") ? f.path : `images/${f.path}`)));
  const has = (p: string) => (paths.has(p) ? `${p}.svg` : undefined);
  const first = (re: RegExp) => [...paths].find((p) => re.test(p));
  const proof: [RegExp, string | undefined][] = [
    [/^(gerber\.|nets\.|board\.|layers\.|fab\.(clearance|track_width|edge|hole_to_hole))/, has("images/top-composite")],
    [/^(profile\.|dxf\.)/, first(/\.dxf$/) ? `${first(/\.dxf$/)}.svg` : undefined],
    [/^(drill\.|fab\.holes|fab\.pad_ring|fab\.hole_size|fab\.via)/, has("images/drill-map")],
    [/^(placement\.)/, first(/cpl-[a-z]+\.csv$/) ? `${first(/cpl-[a-z]+\.csv$/)}.svg` : undefined],
    [/^(bom\.)/, first(/bom-[a-z]+\.csv$/) ? `${first(/bom-[a-z]+\.csv$/)}.svg` : undefined],
    [/^(netlist\.)/, first(/\.ipc356$/) ? `${first(/\.ipc356$/)}.svg` : undefined],
    [/^(mask\.|silk\.|fab\.silk)/, has("images/top-composite")],
  ];
  for (const it of items) {
    const hit = proof.find(([re, img]) => img && re.test(it.id));
    if (hit && !it.image) it.image = hit[1];
  }
  const { verdict, failed } = verdictOf(items, ctx.fill, ctx.options.override);
  return { schema: PREFLIGHT_SCHEMA, board: ctx.name, profile: ctx.profile.id, verdict, counts: counts(items), items, costDrivers: drivers, ...(verdict === "overridden" ? { override: { ...ctx.options.override!, failed } } : {}) };
}

async function single(board: BoardInput, profile: string | FabProfile, options: ExportOptions, kinds: OutputKind[]): Promise<ExportResult> {
  const ctx = prepare(board, profile, options);
  const want = new Set(kinds);
  if (want.has("gerber") || want.has("drill") || want.has("cpl") || want.has("ipc356") || want.has("crossCheck")) {
    // the profile file is needed for every image; Gerbers are written only when asked
    genGerbers(ctx);
    if (!want.has("gerber")) {
      ctx.files = ctx.files.filter((f) => !f.path.startsWith("fab/") && !f.path.startsWith("images/"));
      ctx.items = [];
    }
  }
  if (want.has("drill")) genDrill(ctx);
  if (want.has("bom") || want.has("cpl")) genAssembly(ctx, { bom: want.has("bom"), cpl: want.has("cpl") });
  if (want.has("ipc356")) genIpc356(ctx);
  if (want.has("dxf")) genDxf(ctx);
  if (want.has("ipc2581") || want.has("odb") || want.has("crossCheck")) await genKicad(ctx, { ipc2581: want.has("ipc2581"), odb: want.has("odb"), cross: want.has("crossCheck") });
  const pre = makePreflight(ctx, []);
  clearOut(options.outDir);
  const { exported, written, images } = writeAll(options.outDir, ctx.files, options.png !== false);
  const manifest = manifestOf(ctx, exported, written, pre, undefined, images);
  writeFileSync(join(options.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { outDir: options.outDir, files: exported, preflight: pre, ...(ctx.layerStats ? { layers: ctx.layerStats } : {}), ...(ctx.cross ? { crossCheck: ctx.cross } : {}) };
}

function manifestOf(ctx: Ctx, files: ExportedFile[], written: string[], pre: Preflight, upload: { path: string; entries: string[]; sha256: string } | undefined, images: NonNullable<ExportedFile["image"]>[]) {
  const board = ctx.doc.records.get("board");
  const texts = serializeDocument(ctx.doc);
  const outline = ctx.doc.records.get("outline");
  let size: [string, string] | undefined;
  if (outline?.kind === "outline") {
    const pts = flattenContour(outline.outline, 1000);
    size = [mmText(Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), 3), mmText(Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)), 3)];
  }
  const o = ctx.options;
  return {
    schema: PACKAGE_SCHEMA,
    generator: { vendor: GENERATOR[0], name: GENERATOR[1], version: GENERATOR[2] },
    board: { name: board?.kind === "board" ? board.name : ctx.name, fileStem: ctx.name, revision: o.revision ?? null, documentHash: filesHash(texts), copperLayers: copperLayers(ctx.doc).length, ...(size ? { sizeMm: size } : {}) },
    profile: { id: ctx.profile.id, title: ctx.profile.title, sources: ctx.profile.sources },
    units: { files: "mm", coordinates: "file = board - origin, +Y up, seen from the top" },
    origin: { mode: ctx.originMode, boardPointNm: ctx.origin },
    fill: ctx.fill ? { source: ctx.fill.source, current: ctx.fill.current, note: ctx.fill.note } : null,
    settings: {
      x2: o.x2 ?? ctx.profile.gerber.x2,
      clipSilkToMask: o.clipSilkToMask ?? ctx.profile.gerber.clipSilkToMask,
      maskColor: ctx.maskColor,
      maskExpansionNm: o.maskExpansion ?? 0,
      pasteExpansionNm: o.pasteExpansion ?? 0,
      tentVias: o.tentVias ?? true,
      netAttributes: o.netAttributes !== false,
      drill: ctx.profile.drill,
      rotationConvention: ctx.profile.assembly.rotationConvention,
      userRotations: o.rotations?.length ?? 0,
      creationDate: o.creationDate ?? null,
    },
    upload: upload ?? null,
    files,
    images,
    written,
    preflight: { verdict: pre.verdict, counts: pre.counts, file: "preflight.json" },
    ...(pre.override ? { override: pre.override } : {}),
    costDrivers: pre.costDrivers,
  };
}

function summaryMd(ctx: Ctx, pre: Preflight, files: ExportedFile[], upload: string | undefined): string {
  const L: string[] = [];
  const st = (s: Status) => ({ pass: "ok", warn: "WARN", fail: "FAIL", info: "info", skip: "skip" })[s];
  L.push(`# ${ctx.name}: ${ctx.profile.title}`, "");
  L.push(`Verdict: **${pre.verdict}**. ${pre.counts.pass} ok, ${pre.counts.warn} warn, ${pre.counts.fail} fail.${pre.override ? ` Override by ${pre.override.by}: ${pre.override.reason}` : ""}`, "");
  if (upload) L.push(`Upload: \`${upload}\``, "");
  const bad = pre.items.filter((i) => i.status === "fail" || i.status === "warn");
  if (bad.length) {
    L.push("## Needs attention", "");
    for (const i of bad) L.push(`- ${st(i.status)}: ${i.title}`);
    L.push("");
  }
  if (pre.costDrivers.length) {
    L.push("## Cost drivers", "");
    for (const c of pre.costDrivers) L.push(`- ${c.title}: ${c.value}. ${c.implication}.`);
    L.push("");
  }
  L.push("## Files", "");
  for (const f of files) L.push(`- \`${f.path}\` (${f.role})${f.image ? `, image \`${f.image.png ?? f.image.svg}\`` : ""}`);
  L.push("", "Look first: `images/top-composite`, `images/bottom-composite`, the placement overlay and `images/preflight`.", "");
  return L.join("\n");
}

// ------------------------------------------------------------------- the public commands

/** Gerber X2 files of every fab layer (copper, mask, paste, legend, profile), each with its image; read back and checked. */
export const exportGerbers = (board: BoardInput, profile: string | FabProfile, options: ExportOptions) => single(board, profile, options, ["gerber"]);
/** Excellon drill files (plated, non-plated, blind and buried spans) with drill maps; read back and checked. */
export const exportDrill = (board: BoardInput, profile: string | FabProfile, options: ExportOptions) => single(board, profile, options, ["drill"]);
/** The BOM in the profile's format and the generic one, with a table image and data JSON. */
export const exportBom = (board: BoardInput, profile: string | FabProfile, options: ExportOptions) => single(board, profile, options, ["bom"]);
/** The placement (pick and place) file in the profile's format and the generic one, with an overlay image. */
export const exportPlacement = (board: BoardInput, profile: string | FabProfile, options: ExportOptions) => single(board, profile, options, ["cpl"]);
/** The IPC-D-356A netlist for bare-board test, with a test point image. */
export const exportIpc356 = (board: BoardInput, profile: string | FabProfile, options: ExportOptions) => single(board, profile, options, ["ipc356"]);
/** The DXF outline (optionally pads, holes, courtyards) for mechanical CAD, with its image. */
export const exportDxf = (board: BoardInput, profile: string | FabProfile, options: ExportOptions) => single(board, profile, options, ["dxf"]);
/** IPC-2581 and ODB++ through kicad-cli (needs KiCad and the KiCad board the document came from). */
export const exportIpc2581 = (board: BoardInput, profile: string | FabProfile, options: ExportOptions) => single(board, profile, options, ["ipc2581", "odb"]);

/** Every output of a fab profile in one deterministic folder: files, paired images, manifest, pre-flight, summary, upload zip. */
export async function exportFabPackage(board: BoardInput, profileIn: string | FabProfile, options: ExportOptions): Promise<ExportResult> {
  const ctx = prepare(board, profileIn, options);
  const on = (k: OutputKind, def = true) => options.outputs?.[k] ?? def;
  const kicadUpload = ctx.profile.upload === "ipc2581-or-kicad";
  genGerbers(ctx);
  if (!on("gerber")) ctx.files = ctx.files.filter((f) => !f.path.startsWith("fab/"));
  if (on("drill")) genDrill(ctx);
  if (on("bom") || on("cpl")) genAssembly(ctx, { bom: on("bom"), cpl: on("cpl") });
  if (on("ipc356")) genIpc356(ctx);
  if (on("dxf")) genDxf(ctx);
  // the fab's capability limits and the board's own rules
  if (on("gerber")) {
    const cap = checkCapability(ctx.doc, ctx.profile, ctx.fill);
    ctx.items.push(...cap.items);
    ctx.items.push(...checkExtraLimits(ctx.doc, ctx.plot, ctx.holes, ctx.profile, ctx.maskColor));
  }
  ctx.items.push(...checkBoardRules(ctx.doc, ctx.fill));
  await genKicad(ctx, { ipc2581: on("ipc2581", kicadUpload), odb: on("odb", false), cross: on("crossCheck", true) });
  const drivers = costDrivers(ctx.doc, ctx.profile, ctx.lines, ctx.holes, ctx.maskColor);
  const pre = makePreflight(ctx, drivers);
  ctx.files.push({ path: "images/preflight", role: "image", data: new Uint8Array(), svg: preflightSvg(pre.items, `${ctx.name} PRE-FLIGHT, ${ctx.profile.title.toUpperCase()}`, pre.verdict === "ready" ? "READY" : pre.verdict === "overridden" ? `OVERRIDDEN BY ${pre.override!.by.toUpperCase()}: ${pre.override!.failed.length} FAILED CHECKS` : `NOT READY: ${pre.counts.fail} FAILED CHECKS${ctx.fill && !ctx.fill.current ? ", FILL STALE" : ""}`) });
  // the upload zip: fab files only (Gerbers and drill), only when ready or overridden
  let upload: { path: string; entries: string[]; sha256: string } | undefined;
  if (pre.verdict !== "not-ready" && on("gerber")) {
    const entries = ctx.files.filter((f) => f.path.startsWith("fab/files/")).map((f) => ({ name: f.path.slice("fab/files/".length), data: f.data }));
    const z = zip(entries);
    const path = `fab/${ctx.name}-${ctx.profile.id}-upload.zip`;
    ctx.files.push({ path, role: ctx.profile.upload === "gerber-zip" ? "fab upload (Gerbers and drill)" : "Gerbers and drill (reference beside the IPC-2581 or KiCad upload)", data: z });
    upload = { path, entries: entries.map((e) => e.name), sha256: sha256(z) };
  }
  clearOut(options.outDir);
  const { exported, written, images } = writeAll(options.outDir, ctx.files, options.png !== false);
  const preText = `${JSON.stringify(pre, null, 2)}\n`;
  const sumText = summaryMd(ctx, pre, exported, upload?.path);
  writeFileSync(join(options.outDir, "preflight.json"), preText);
  writeFileSync(join(options.outDir, "summary.md"), sumText);
  written.push("preflight.json", "summary.md", "manifest.json");
  const manifest = manifestOf(ctx, exported, written, pre, upload, images);
  writeFileSync(join(options.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { outDir: options.outDir, files: exported, preflight: pre, ...(ctx.layerStats ? { layers: ctx.layerStats } : {}), ...(ctx.cross ? { crossCheck: ctx.cross } : {}) };
}

/** Plot and write in memory only (no files): the Gerber texts of a board by layer id, for tests and previews. */
export function gerberTexts(board: BoardInput, profile: string | FabProfile, options: Omit<ExportOptions, "outDir"> = {}): Record<string, string> {
  const ctx = prepare(board, profile, { ...options, outDir: "" });
  genGerbers(ctx);
  return Object.fromEntries((ctx.gerbers ?? []).map((w) => [w.layer.id, w.text]));
}
