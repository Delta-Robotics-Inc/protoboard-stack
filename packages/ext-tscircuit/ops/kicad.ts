/**
 * The KiCad handoff (docs/specs/pcb-kicad-handoff.md): the `circuit`
 * capability's own operations kicad, lock and unlock, and what generate,
 * export and check do on a locked board.
 *
 *   circuit:kicad    a KiCad project of the current build in tscircuit/kicad/ (preview)
 *   circuit:lock     the KiCad project into <board dir>/kicad/ with handoff.json: KiCad
 *                    becomes the layout of record
 *   circuit:unlock   kicad/ moves to kicad-archive/<stamp>/; tscircuit is the layout again
 *
 * Locked: generate refuses without --force, export makes the fabrication
 * outputs with kicad-cli from kicad/, and check compares the model, the
 * record and the KiCad files (handoff.ts). Nothing is written back.
 */
import { boardNetlist, boardOptions, NETLIST_SCHEMA, type BoardNetlist, type CapabilityContext, type CapabilityOperationFn, type CapabilityResult, type NetlistReport } from "@protoboardai/core";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { readConstraints, type BoardConstraints } from "../lib/config.ts";
import { boardLands } from "../lib/footprints.ts";
import { chooseBodies, applyBodies, boxStep } from "../lib/models.ts";
import { digestOf, files as nativeFiles, readNative, readOverrides, sourceDigest, type Native } from "../lib/native.ts";
import { boardManifest, bomCsv, renders, type PartEdgeFrame } from "../lib/outputs.ts";
import { projectOffers, supplierColumns, supplierNumbers } from "../lib/suppliers.ts";
import { packageVersion } from "../lib/runtime.ts";
import { shiftStepAssembly, withoutShapes } from "../lib/stepfile.ts";
import { kicadCli, kicadVersion, mustKicad, reframeKicadGlb, runKicad } from "../lib/kicad/cli.ts";
import { DRC_COMMAND, drcLine, runDrc, summariseDrc, type DrcReport } from "../lib/kicad/drc.ts";
import { componentFields, lcscNumbers, type ComponentFields } from "../lib/kicad/fields.ts";
import { compare, comparisonDiagnostics, handoffFile, HANDOFF_SCHEMA, kicadDir, readHandoff, type Handoff } from "../lib/kicad/handoff.ts";
import { modelNetlist, netParity, parityProblems, readBoardNetlist, readKicadNetlist, readSchematicParts, type Netlist } from "../lib/kicad/netlists.ts";
import { kicadProject, libraryName, stabiliseUuids } from "../lib/kicad/project.ts";
import { kicadPinType, type KicadPinType } from "../lib/kicad/schematic.ts";
import { assignRefdes, parseRefdes, prefixFromPart, refdesFile, type RefdesRecord } from "../lib/kicad/refdes.ts";

type Diagnostic = NonNullable<CapabilityResult["diagnostics"]>[number];

const PROVIDER_VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
})();

const netlistOf = (ctx: CapabilityContext) => boardNetlist(ctx.module.definition, ctx.project.lookup, boardOptions(ctx.project));
const constraintsOf = (ctx: CapabilityContext, netlist: BoardNetlist) => readConstraints(ctx.constraints, netlist.envelope).constraints;
const read = (root: string, path: string) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined);
const failed = (summary: string, data?: unknown): CapabilityResult => ({ status: "failed", summary, ...(data ? { data } : {}) });

/** Outline, holes, layers and thickness: what a KiCad layout must be redone for. */
export const boardShapeDigest = (c: BoardConstraints | undefined) => digestOf(JSON.stringify(c ? { outline: c.outline, holes: c.holes, layers: c.layers, thickness: c.thickness_mm } : null));

/** A part's conventional designator prefix (D, Q, Y, F, BT, LS) from its UHD definition. */
export const partPrefix = (ctx: CapabilityContext, netlist: BoardNetlist) => {
  const parts = new Map(netlist.components.map((c) => [c.instance, c.part]));
  return (c: { instance: string }) => prefixFromPart(ctx.project.lookup(parts.get(c.instance) ?? "") as never);
};

/** Designators for the board's components, extending tscircuit/refdes.json (written when it grew; generate, circuit:kicad and lock write it). */
type Write = (path: string, content: string | Buffer, description?: string) => void;

export function refdesFor(ctx: CapabilityContext, netlist: BoardNetlist, write: boolean | Write): RefdesRecord {
  const file = refdesFile(ctx.module.native);
  const before = parseRefdes(read(ctx.project.root, file));
  const { record, added } = assignRefdes(netlist.components, before, partPrefix(ctx, netlist));
  if (write && (!before || added.length)) (typeof write === "function" ? write : ctx.writeOutput)(file, JSON.stringify(record, null, 2) + "\n", "reference designators by UHD instance (kept between KiCad exports)");
  return record;
}

const fieldsFor = (ctx: CapabilityContext, netlist: BoardNetlist): Record<string, ComponentFields> => {
  const lcsc = lcscNumbers(ctx.project.root, projectOffers(ctx.project));
  return Object.fromEntries(netlist.components.map((c) => [c.instance, componentFields(c, lcsc)]));
};

/** Each pin's KiCad electrical type, from its UHD leaf interface (power in/out, input, output, open collector, bidirectional, passive). */
const pinTypesFor = (ctx: CapabilityContext, netlist: BoardNetlist): Record<string, Record<string, KicadPinType>> =>
  Object.fromEntries(
    netlist.components.map((c) => {
      const def = ctx.project.lookup(c.part);
      return [c.instance, Object.fromEntries(c.pins.map((p) => [p.interface, kicadPinType(p.kind, def?.interfaces.find((i) => i.id === p.interface))]))];
    }),
  );

/** The board's model netlist for the comparisons, as an export of it would name everything. */
export function modelSide(ctx: CapabilityContext, netlist: BoardNetlist, native: Native | undefined, refdes: RefdesRecord): Netlist {
  return modelNetlist({ netlist, map: native?.build.map, refdes: refdes.assigned, fields: fieldsFor(ctx, netlist), lib: libraryName(ctx.module.id), overrides: readOverrides(ctx.project.root, ctx.module.native).overrides });
}

interface Written {
  /** Project-relative folder. */
  folder: string;
  files: Record<string, string>;
  notes: string[];
  kicad?: string;
}

/**
 * Write the KiCad project of the current build into `folder`: the converter's
 * files with the provider's edits (project.ts), saved by kicad-cli in KiCad 10's
 * format when KiCad is installed, the part bodies under 3d/.
 */
function writeProject(ctx: CapabilityContext, netlist: BoardNetlist, native: Native, folder: string, write: Write = ctx.writeOutput): Written {
  const root = ctx.project.root;
  const board = ctx.module.id;
  const refdes = refdesFor(ctx, netlist, write);
  // bodies as circuit:export chooses them: the part's STEP without its interface feature shapes, else a box
  const bodies = chooseBodies(ctx.project, netlist.components, ctx.module.native);
  for (const b of bodies) if (b.box && !existsSync(join(root, b.box.path))) ctx.writeOutput(b.box.path, boxStep(`box ${b.box.size.join(" x ")} mm`, b.box.size), "component body box from package facts");
  for (const b of bodies) {
    if (!b.step || !b.stripped || !b.strip?.length) continue;
    if (!existsSync(join(root, b.stripped))) {
      const { text, removed } = withoutShapes(readFileSync(b.step, "utf8"), b.strip);
      if (removed.length) ctx.writeOutput(b.stripped, text, `${b.label} without its interface feature shapes`);
    }
    if (existsSync(join(root, b.stripped))) b.step = join(root, b.stripped);
  }
  // a body file that is not a STEP file (a Git LFS pointer never fetched) is left out, and said so
  const notStep: string[] = [];
  for (const b of bodies) {
    if (!b.step || !existsSync(b.step)) continue;
    const head = readFileSync(b.step).subarray(0, 64).toString("latin1");
    if (!/ISO-10303-21/.test(head)) {
      notStep.push(`${b.instance} (${b.label}${/git-lfs/.test(head) ? ": a Git LFS pointer, not fetched" : ""})`);
      b.step = undefined;
    }
  }
  const { circuitJson } = applyBodies(native.circuitJson, native.build.map, bodies, root);
  const constraints = constraintsOf(ctx, netlist);
  const oz = typeof ctx.constraints.copper_oz === "number" ? ctx.constraints.copper_oz : undefined;
  const modelOk = (abs: string) => existsSync(abs) && /ISO-10303-21/.test(readFileSync(abs).subarray(0, 64).toString("latin1"));
  const project = kicadProject({ board, circuitJson, map: native.build.map, netlist, refdes: refdes.assigned, fields: fieldsFor(ctx, netlist), pinTypes: pinTypesFor(ctx, netlist), constraints, copperOz: oz, modelBase: join(root, ctx.module.native), modelOk });
  if (notStep.length) project.notes.push(`${notStep.length} body file(s) are not STEP files and have no 3D model in KiCad: ${notStep.slice(0, 4).join(", ")}${notStep.length > 4 ? ", …" : ""}`);

  // KiCad 10 saves both files in its own format (and proves it can read them)
  let kicad: string | undefined;
  if (kicadCli()) {
    kicad = kicadVersion();
    const tmp = mkdtempSync(join(tmpdir(), "pb-kicad-"));
    try {
      for (const [p, t] of Object.entries(project.files)) {
        mkdirSync(join(tmp, p, ".."), { recursive: true });
        writeFileSync(join(tmp, p), t);
      }
      mustKicad(["pcb", "upgrade", "--force", join(tmp, `${board}.kicad_pcb`)]);
      mustKicad(["sch", "upgrade", "--force", join(tmp, `${board}.kicad_sch`)]);
      // KiCad gives a new UUID to every item it reads without one: number them again, so an unchanged board exports the same files
      const names = [`${board}.kicad_sch`, `${board}.kicad_pcb`];
      const [sch, pcb, pro] = stabiliseUuids(board, [...names.map((f) => readFileSync(join(tmp, f), "utf8")), project.files[`${board}.kicad_pro`]], project.keep, "k");
      Object.assign(project.files, { [names[0]]: sch, [names[1]]: pcb, [`${board}.kicad_pro`]: pro });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else project.notes.push("kicad-cli not found: the files are in circuit-json-to-kicad's format (KiCad 9), not saved by KiCad 10");

  const files: Record<string, string> = {};
  for (const [p, t] of Object.entries(project.files).sort(([a], [b]) => a.localeCompare(b))) {
    write(`${folder}/${p}`, t, p.endsWith(".kicad_pcb") ? "KiCad board" : p.endsWith(".kicad_sch") ? "KiCad schematic" : undefined);
    files[p] = digestOf(t);
  }
  for (const [p, src] of Object.entries(project.models).sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = readFileSync(src);
    write(`${folder}/${p}`, bytes, "3D model");
    files[p] = digestOf(bytes);
  }
  return { folder, files, notes: project.notes, kicad };
}

/** The KiCad side read from a project folder: the board's nets and parts, the schematic's parts and (with kicad-cli) nets. */
export function readKicadSide(root: string, folder: string, board: string, refdes: Record<string, string>): { pcb: Netlist; sch?: Netlist; schParts?: Record<string, import("../lib/kicad/netlists.ts").PartRecord>; problems: string[] } {
  const problems: string[] = [];
  const pcbText = read(root, `${folder}/${board}.kicad_pcb`);
  if (!pcbText) throw new Error(`${folder}/${board}.kicad_pcb is missing`);
  const pcb = readBoardNetlist(pcbText, refdes);
  const schText = read(root, `${folder}/${board}.kicad_sch`);
  let schParts: ReturnType<typeof readSchematicParts> | undefined;
  let sch: Netlist | undefined;
  if (!schText) problems.push(`${folder}/${board}.kicad_sch is missing`);
  else {
    schParts = readSchematicParts(schText, refdes);
    if (kicadCli()) {
      // on a copy: KiCad writes its local settings (.kicad_prl) beside a project it opens, and check writes nothing
      const tmp = mkdtempSync(join(tmpdir(), "pb-kicad-net-"));
      try {
        for (const f of readdirSync(join(root, folder))) if (/\.(kicad_sch|kicad_pro|kicad_sym)$|^sym-lib-table$/.test(f)) cpSync(join(root, folder, f), join(tmp, f));
        const out = join(tmp, "netlist.net");
        const r = runKicad(["sch", "export", "netlist", "--format", "kicadsexpr", "--output", out, join(tmp, `${board}.kicad_sch`)]);
        if (r.status === 0 && existsSync(out)) sch = readKicadNetlist(readFileSync(out, "utf8"), refdes);
        else problems.push(`kicad-cli could not export the schematic's netlist: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  }
  return { pcb, sch, schParts, problems };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** circuit:kicad: a KiCad project of the current build, in tscircuit/kicad/ (rewritten each time). */
export const kicad: CapabilityOperationFn = async (ctx) => {
  const netlist = netlistOf(ctx);
  if (netlist.problems.length) return failed(`${ctx.module.id} cannot be read as a board: ${netlist.problems[0]}`);
  const native = readNative(ctx.project.root, ctx.module.native);
  if (!native) return failed(`no built board in ${ctx.module.native}/; run circuit:generate first`);
  const w = writeProject(ctx, netlist, native, `${ctx.module.native}/kicad`);
  const n = Object.keys(w.files).length;
  return { status: "succeeded", summary: `KiCad project (${w.kicad ? `KiCad ${w.kicad} format` : "converter format"}) in ${w.folder}/: ${n} files. A preview: the layout of record stays tscircuit until circuit:lock${w.notes.length ? `; ${w.notes.join("; ")}` : ""}`, data: { folder: w.folder, files: Object.keys(w.files), notes: w.notes } };
};

/** circuit:lock: hand the board to KiCad (or, with refresh=true, re-record a locked board's handoff). */
export const lock: CapabilityOperationFn = async (ctx) => {
  const root = ctx.project.root;
  const dir = ctx.module.dir;
  const board = ctx.module.id;
  const netlist = netlistOf(ctx);
  if (netlist.problems.length) return failed(`${board} cannot be read as a board: ${netlist.problems[0]}`);
  const existing = readHandoff(root, dir);
  const native = readNative(root, ctx.module.native);
  const constraints = constraintsOf(ctx, netlist);
  const now = new Date().toISOString();

  if (existing?.state === "locked") {
    if (ctx.inputs.refresh !== "true") return failed(`${board} is already locked (since ${existing.lockedAt}; ${handoffFile(dir)}). To record the model and KiCad as they are now, after updating KiCad by hand: --input refresh=true; to go back to tscircuit: circuit:unlock`);
    const refdes = refdesFor(ctx, netlist, true);
    const k = readKicadSide(root, kicadDir(dir), board, refdes.assigned);
    const record: Handoff = { ...existing, refreshedAt: now, netlistDigest: digestOf(JSON.stringify(netlist)), boardShape: boardShapeDigest(constraints), model: modelSide(ctx, netlist, native, refdes), kicad: k.pcb };
    ctx.writeOutput(handoffFile(dir), JSON.stringify(record, null, 2) + "\n", "KiCad handoff record (re-recorded)");
    return { status: "succeeded", summary: `${board}: handoff re-recorded from the model and ${kicadDir(dir)}/ as they are now; the board stays locked` };
  }
  if (!kicadCli()) return failed("circuit:lock needs kicad-cli (KiCad 10): install KiCad 10, or set PROTOBOARD_KICAD_CLI");
  if (!native) return failed(`no built board in ${ctx.module.native}/; run circuit:generate first`);
  // lock what tscircuit has now: refuse a build that no longer follows the model or its source
  const digest = digestOf(JSON.stringify(netlist));
  if (native.build.netlistDigest !== digest) return failed(`the UHD board changed since the last circuit:generate; generate (and check) before locking`);
  if (native.build.sourceDigest !== sourceDigest(root, ctx.module.native, native.build.sourceFiles)) return failed(`the tscircuit source changed since the last build; run circuit:export (it rebuilds) or circuit:generate before locking`);
  if (existsSync(join(root, kicadDir(dir))) && readdirSync(join(root, kicadDir(dir))).length) return failed(`${kicadDir(dir)}/ already has files and no lock record; move them away (they may be hand work) before locking`);

  // all or nothing: the project, the designators and the record are written to a staging folder first, read back
  // there, and moved into place only when every step has succeeded; a lock that fails leaves the board unlocked,
  // with no half-written kicad/ to move away before trying again
  const stage = mkdtempSync(join(tmpdir(), "pb-kicad-lock-"));
  const staged = new Map<string, { content: string | Buffer; description?: string }>();
  const stageWrite: Write = (path, content, description) => {
    mkdirSync(join(stage, path, ".."), { recursive: true });
    writeFileSync(join(stage, path), content);
    staged.set(path, { content, ...(description ? { description } : {}) });
  };
  let w: Written, refdes: RefdesRecord, model: Netlist, k: Netlist, side: ReturnType<typeof readKicadSide>, positions: Record<string, KicadPos>;
  try {
    w = writeProject(ctx, netlist, native, kicadDir(dir), stageWrite);
    refdes = staged.has(refdesFile(ctx.module.native)) ? (parseRefdes(staged.get(refdesFile(ctx.module.native))!.content.toString()) ?? refdesFor(ctx, netlist, false)) : refdesFor(ctx, netlist, false);
    model = modelSide(ctx, netlist, native, refdes);
    // the KiCad side as written, read back: later differences from it are hand edits
    k = readBoardNetlist(readFileSync(join(stage, w.folder, `${board}.kicad_pcb`), "utf8"), refdes.assigned);
    // what KiCad's schematic and board already disagree on as exported (the converter's limits): not reported as new later
    side = readKicadSide(stage, kicadDir(dir), board, refdes.assigned);
    // where KiCad has each footprint now: export measures later moves from here (F26)
    const byRef = new Map(Object.entries(refdes.assigned).map(([i, r]) => [r, i]));
    positions = Object.fromEntries([...kicadPositions(join(stage, w.folder, `${board}.kicad_pcb`))].filter(([ref]) => byRef.has(ref)).map(([ref, p]): [string, KicadPos] => [byRef.get(ref)!, p]).sort(([a], [b]) => a.localeCompare(b)));
  } catch (e) {
    rmSync(stage, { recursive: true, force: true });
    return failed(`${board} was not locked (nothing written to ${kicadDir(dir)}/): ${(e as Error).message.split("\n")[0]}`);
  }
  rmSync(stage, { recursive: true, force: true });
  const { diffNetlists } = await import("../lib/kicad/netlists.ts");
  const exportedWith = diffNetlists(model, k).map((c) => c.message);
  const parityAtLock = [...(side.schParts ? parityProblems(side.schParts, side.pcb.parts) : []), ...(side.sch ? netParity(side.sch, side.pcb) : [])];
  const record: Handoff = {
    schema: HANDOFF_SCHEMA,
    state: "locked",
    board,
    lockedAt: now,
    netlistDigest: digest,
    boardShape: boardShapeDigest(constraints),
    model,
    kicad: k,
    ...(exportedWith.length ? { exportedWith } : {}),
    ...(parityAtLock.length ? { parityAtLock } : {}),
    positions,
    tscircuit: { sourceDigest: native.build.sourceDigest, circuit: digestOf(readFileSync(join(root, nativeFiles(ctx.module.native).circuit))), core: native.build.tscircuit.core },
    tools: { ...(w.kicad ? { kicad: w.kicad } : {}), converter: packageVersion("circuit-json-to-kicad"), provider: PROVIDER_VERSION },
    files: w.files,
  };
  for (const [path, f] of staged) ctx.writeOutput(path, f.content, f.description);
  ctx.writeOutput(handoffFile(dir), JSON.stringify(record, null, 2) + "\n", "KiCad handoff record: the board is locked");
  return {
    status: "succeeded",
    summary: `${board} locked: KiCad ${w.kicad} project in ${kicadDir(dir)}/ (${Object.keys(record.model.parts).length} parts, ${Object.keys(record.kicad.nets).length} nets); KiCad is now the layout of record. circuit:generate refuses without --force; circuit:export makes the fabrication outputs with kicad-cli${w.notes.length ? `. ${w.notes.join("; ")}` : ""}${exportedWith.length ? `. The exported board differs from the model in ${exportedWith.length} place(s) (converter limits, recorded in handoff.json: ${exportedWith.slice(0, 2).join("; ")})` : ""}`,
    data: { folder: w.folder, files: Object.keys(w.files), notes: w.notes, exportedWith },
  };
};

/** circuit:unlock: kicad/ becomes kicad-archive/<stamp>/ (its record saying when), and tscircuit is the layout of record again. */
export const unlock: CapabilityOperationFn = async (ctx) => {
  const root = ctx.project.root;
  const dir = ctx.module.dir;
  const h = readHandoff(root, dir);
  if (h?.state !== "locked") return failed(`${ctx.module.id} is not locked (no ${handoffFile(dir)} with state "locked")`);
  const now = new Date().toISOString();
  const stamp = now.replace(/[:.]/g, "-");
  const from = join(root, kicadDir(dir));
  const to = `${dir}/kicad-archive/${stamp}`;
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  for (const f of walk(from).sort()) {
    const rel = relative(from, f).split("\\").join("/");
    if (rel === "handoff.json") continue;
    ctx.writeOutput(`${to}/${rel}`, readFileSync(f), "archived KiCad file");
  }
  ctx.writeOutput(`${to}/handoff.json`, JSON.stringify({ ...h, state: "unlocked", unlockedAt: now }, null, 2) + "\n", "handoff record of the archived lock");
  rmSync(from, { recursive: true, force: true });
  ctx.log(`removed ${kicadDir(dir)}/ (archived in ${to}/)`);
  return { status: "succeeded", summary: `${ctx.module.id} unlocked: ${kicadDir(dir)}/ archived in ${to}/ (hand work in it is kept there); tscircuit is the layout of record again. circuit:generate, then circuit:lock when the design is settled` };
};

// ---------------------------------------------------------------------------
// Hooks for generate, export and check (ops/circuit.ts)
// ---------------------------------------------------------------------------

/** generate on a locked board: refused unless --force. */
export function lockedGenerate(ctx: CapabilityContext): CapabilityResult | undefined {
  const h = readHandoff(ctx.project.root, ctx.module.dir);
  if (h?.state !== "locked") return undefined;
  if (ctx.inputs.force === "true") {
    ctx.log(`warning: ${ctx.module.id} is locked (KiCad is the layout of record since ${h.lockedAt}); generating anyway (--force). The KiCad files are not touched`);
    return undefined;
  }
  return failed(`${ctx.module.id} is locked: KiCad (${kicadDir(ctx.module.dir)}/) is the layout of record since ${h.lockedAt}, and generate would replace tscircuit's routing. Change the layout in KiCad, or circuit:unlock first (a human decision), or pass --force to rebuild tscircuit's copy anyway`);
}

/** A footprint's place in the board frame, as KiCad's position file gives it (drill/place origin = the board's). */
export interface KicadPos {
  x: number;
  y: number;
  rot: number;
  side: "top" | "bottom";
}

/** KiCad's position file (`pcb export pos --format csv --units mm`), by reference. */
export function readPosCsv(text: string): Map<string, KicadPos> {
  const rows = text.split(/\r?\n/).filter(Boolean);
  const out = new Map<string, KicadPos>();
  if (!rows.length) return out;
  const head = splitCsv(rows[0]).map((h) => h.toLowerCase());
  const col = (n: string) => head.indexOf(n);
  for (const r of rows.slice(1)) {
    const f = splitCsv(r);
    out.set(f[col("ref")], { x: Number(f[col("posx")]), y: Number(f[col("posy")]), rot: (((Number(f[col("rot")]) % 360) + 360) % 360) + 0, side: /bottom/i.test(f[col("side")]) ? "bottom" : "top" });
  }
  return out;
}

/** The footprints' positions on a KiCad board, by reference (kicad-cli). */
function kicadPositions(pcb: string): Map<string, KicadPos> {
  const tmp = mkdtempSync(join(tmpdir(), "pb-kicad-pos-"));
  try {
    mustKicad(["pcb", "export", "pos", "--format", "csv", "--units", "mm", "--side", "both", "--use-drill-file-origin", "--output", join(tmp, "pos.csv"), pcb]);
    return readPosCsv(readFileSync(join(tmp, "pos.csv"), "utf8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * How a component moved in KiCad since the lock (PB-1027, F26): against the
 * position KiCad had at lock when the record has it (the footprint origin,
 * which can differ from tscircuit's body origin by the pads' centre), else
 * against the tscircuit build's. Undefined when it did not move or turn.
 */
export function movedSinceLock(now: KicadPos, atLock: KicadPos | undefined, built: { origin: number[]; rotation_deg: number }): { from: [number, number]; to: [number, number]; turn: number } | undefined {
  const from: [number, number] = atLock ? [atLock.x, atLock.y] : [built.origin[0], built.origin[1]];
  const turn = ((((now.rot - (atLock ? atLock.rot : built.rotation_deg)) % 360) + 540) % 360) - 180;
  if (Math.hypot(now.x - from[0], now.y - from[1]) < 1e-3 && Math.abs(turn) < 0.1) return undefined;
  return { from, to: [now.x, now.y], turn };
}

const PNP_HEADER = ["instance", "x_mm", "y_mm", "rotation_deg", "side", "part", "mpn", "package", "lcsc"];
const csvField = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Split one CSV line (KiCad's position file quotes every field). */
const splitCsv = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
};

/** export on a locked board: the fabrication outputs from KiCad (spec §5). */
export async function exportLocked(ctx: CapabilityContext): Promise<CapabilityResult> {
  const root = ctx.project.root;
  const board = ctx.module.id;
  const out = ctx.module.out;
  const folder = kicadDir(ctx.module.dir);
  if (!kicadCli()) return failed(`${board} is locked and its fabrication outputs come from KiCad, but kicad-cli (KiCad 10) is not installed; install KiCad 10, or set PROTOBOARD_KICAD_CLI`);
  if (!existsSync(join(root, folder, `${board}.kicad_pcb`))) return failed(`${board} is locked but ${folder}/${board}.kicad_pcb is missing`);
  const netlist = netlistOf(ctx);
  const native = readNative(root, ctx.module.native);
  const refdes = refdesFor(ctx, netlist, false);
  const byRef = new Map(Object.entries(refdes.assigned).map(([i, r]) => [r, i]));
  const handoff = readHandoff(root, ctx.module.dir);
  // the supplier numbers the unlocked export gives too (one offer reader: library offers and the project's evidence)
  const suppliers = supplierNumbers(root, netlist.components, projectOffers(ctx.project));
  const tmp = mkdtempSync(join(tmpdir(), "pb-kicad-fab-"));
  const notes: string[] = [];
  // kicad-cli works on a copy: it writes its local settings beside the project, and kicad/ is the user's
  cpSync(join(root, folder), join(tmp, "project"), { recursive: true });
  const pcb = join(tmp, "project", `${board}.kicad_pcb`);
  const sch = join(tmp, "project", `${board}.kicad_sch`);
  try {
    // ---- DRC first: an error stops the export unless --force
    // one runner and one count for export and check (lib/kicad/drc.ts; F24, F25)
    const { report: drcReport, raw } = runDrc(join(root, folder), board);
    const sum = summariseDrc(drcReport);
    const { unconnected, parity, first } = sum;
    const drcSummary = drcLine(sum);
    if ((sum.errors || unconnected) && ctx.inputs.force !== "true") {
      return failed(
        `${board} is locked and KiCad's DRC stops the export: ${drcSummary}${first.length ? ` (first: ${first.join("; ")})` : ""}. ` +
          `To fix: open ${folder}/${board}.kicad_pcb in KiCad, run Inspect > Design Rules Checker, correct the layout (the kicad-layout-review skill walks through it), save, and run \`protoboard run circuit:export --module ${ctx.module.id}\` again. ` +
          `To export as it is (a prototype you accept with these findings): \`protoboard run circuit:export --module ${ctx.module.id} --force\`; out/drc.json then records them`,
        { drc: { errors: sum.errors, unconnected, parity, first } },
      );
    }
    ctx.writeOutput(`${out}/drc.json`, raw, `KiCad DRC report of the locked board (${DRC_COMMAND})`);

    // ---- Gerber and drill
    const copper = readFileSync(pcb, "utf8").match(/"In\d+\.Cu"/g) ? ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"] : ["F.Cu", "B.Cu"];
    const layers = [...copper, "F.Paste", "B.Paste", "F.SilkS", "B.SilkS", "F.Mask", "B.Mask", "Edge.Cuts"].join(",");
    mustKicad(["pcb", "export", "gerbers", "--no-protel-ext", "--layers", layers, "--output", join(tmp, "gerber") + "/", pcb]);
    mustKicad(["pcb", "export", "drill", "--format", "excellon", "--excellon-units", "mm", "--excellon-separate-th", "--output", join(tmp, "gerber") + "/", pcb]);
    for (const f of readdirSync(join(tmp, "gerber")).sort()) {
      if (f.endsWith(".gbrjob")) continue;
      // KiCad dates every file; drop the date so an unchanged board exports identical files
      const t = readFileSync(join(tmp, "gerber", f), "utf8").replace(/^(G04 Created by KiCad.*date|%TF\.CreationDate,|; DRILL file .* date|; #@! TF\.CreationDate,).*$/gm, "");
      // a drill file with no tool (no unplated holes on the board): KiCad writes its header anyway; there is nothing to drill
      if (/\.drl$/i.test(f) && !/^T\d+C/m.test(t)) {
        notes.push(`${f} left out: KiCad wrote it with no hole to drill`);
        continue;
      }
      ctx.writeOutput(`${out}/gerber/${f}`, t, "from KiCad");
    }

    // ---- pick-and-place, keyed by UHD instance, in the board frame (KiCad's place origin is the board's)
    mustKicad(["pcb", "export", "pos", "--format", "csv", "--units", "mm", "--side", "both", "--use-drill-file-origin", "--output", join(tmp, "pos.csv"), pcb]);
    const kicadPos = new Map<string, KicadPos>();
    const pnp = [PNP_HEADER.join(",")];
    for (const [ref, pos] of readPosCsv(readFileSync(join(tmp, "pos.csv"), "utf8"))) {
      const inst = byRef.get(ref) ?? ref;
      const c = netlist.components.find((x) => x.instance === inst);
      kicadPos.set(inst, pos);
      pnp.push([inst, pos.x, pos.y, pos.rot, pos.side, c?.part, c?.mpn, c?.package?.name, supplierColumns(suppliers[inst]).lcsc].map(csvField).join(","));
    }
    ctx.writeOutput(`${out}/pnp.csv`, pnp.join("\n") + "\n", "pick-and-place from KiCad (footprint origins), by UHD instance");

    // ---- bodies in the stack's board frame (z = 0 on the mid-plane, as tscircuit's), renders
    // KiCad puts z = 0 on the board's bottom face: both files are moved down by half the board's thickness (KiCad's own)
    const thickness = Number(/\(general[\s\S]*?\(thickness\s+([\d.]+)\)/.exec(readFileSync(pcb, "utf8"))?.[1] ?? constraintsOf(ctx, netlist)?.thickness_mm ?? 1.6);
    mustKicad(["pcb", "export", "step", "--force", "--drill-origin", "--subst-models", "--output", join(tmp, "board.step"), pcb]);
    const stepped = shiftStepAssembly(readFileSync(join(tmp, "board.step"), "utf8"), -thickness / 2);
    if (!stepped.moved) notes.push("board.step: KiCad's assembly root was not found, so the file is in KiCad's frame (z = 0 on the board's bottom face)");
    ctx.writeOutput(`${out}/board.step`, stepped.text.replace(/^(FILE_NAME\('[^']*',)'[^']*'/m, "$1'1970-01-01T00:00:00'"), "board with component bodies, from KiCad (board frame: z = 0 on the mid-plane)");
    mustKicad(["pcb", "export", "glb", "--force", "--drill-origin", "--subst-models", "--output", join(tmp, "board.glb"), pcb]);
    ctx.writeOutput(`${out}/board.glb`, reframeKicadGlb(readFileSync(join(tmp, "board.glb")), thickness, (ref) => byRef.get(ref)), "board with component bodies, from KiCad (board frame: z = 0 on the mid-plane)");
    for (const [name, ls, mirror] of [["pcb-top.svg", "F.Cu,F.SilkS,F.Mask,Edge.Cuts", false], ["pcb-bottom.svg", "B.Cu,B.SilkS,B.Mask,Edge.Cuts", true]] as const) {
      mustKicad(["pcb", "export", "svg", "--mode-single", "--exclude-drawing-sheet", "--page-size-mode", "2", "--layers", ls, ...(mirror ? ["--mirror"] : []), "--output", join(tmp, name), pcb]);
      ctx.writeOutput(`${out}/${name}`, readFileSync(join(tmp, name)), "render, from KiCad");
    }
    if (existsSync(sch)) {
      mustKicad(["sch", "export", "svg", "--exclude-drawing-sheet", "--output", join(tmp, "sch") + "/", sch]);
      const svg = readdirSync(join(tmp, "sch")).find((f) => f.endsWith(".svg"));
      if (svg) ctx.writeOutput(`${out}/schematic.svg`, readFileSync(join(tmp, "sch", svg)), "schematic, from KiCad");
    } else if (native) for (const [name, svg] of Object.entries(renders(native.circuitJson))) if (name === "schematic.svg") ctx.writeOutput(`${out}/${name}`, svg, "render (tscircuit)");

    // ---- netlist as laid out: the KiCad board's copper nets, by UHD instance and interface
    const k = readBoardNetlist(readFileSync(pcb, "utf8"), refdes.assigned);
    const ifaceOf = new Map<string, string>();
    for (const m of Object.values(native?.build.map.components ?? {})) for (const [port, iface] of Object.entries(m.ports)) if (iface) ifaceOf.set(`${m.instance}.${port.replace(/^pin/, "")}`, iface);
    const report: NetlistReport = {
      schema: NETLIST_SCHEMA,
      nets: Object.entries(k.nets).map(([id, pins]) => ({ id, pins: [...new Set(pins.map((p) => `${p.slice(0, p.lastIndexOf("."))}:${ifaceOf.get(p) ?? `pad_${p.slice(p.lastIndexOf(".") + 1)}`}`))].sort() })),
    };
    ctx.writeOutput(`${out}/netlist.json`, JSON.stringify(report, null, 2) + "\n", "nets as laid out in KiCad");
    ctx.writeOutput(`${out}/bom.csv`, bomCsv(netlist, suppliers), "bill of materials by UHD instance");

    // ---- manifest: the locked build's, components moved to where KiCad has them
    if (native) {
      const constraints = constraintsOf(ctx, netlist);
      const { manifest, geometry } = boardManifest(native.circuitJson, native.build.map, netlist, constraints, native.build.sourceDigest, edgeFrames(ctx, netlist));
      const features = manifest.features as Record<string, { centroid: number[]; frame: { origin: number[] } }>;
      let moved = 0;
      let turned = 0;
      const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
      for (const g of geometry.components) {
        const p = kicadPos.get(g.instance);
        if (!p) continue;
        // the component's feature and the features of the board exports it carries, carried from where tscircuit
        // put the part to where KiCad has it: moved, and turned about its origin by the difference in rotation
        const own = [features[g.instance], ...netlist.edge.filter((e) => e.instance === g.instance).map((e) => features[e.id])].filter(Boolean) as { centroid: number[]; normal?: number[]; frame: { origin: number[]; normal?: number[]; xAxis?: number[] } }[];
        if (!own.length) continue;
        // measured from where KiCad had it at lock (F26: a footprint origin is not the body origin, so a part that did
        // not move must not read as moved); a record from before 0.2.0 has no positions: tscircuit's then
        const move = movedSinceLock(p, handoff?.positions?.[g.instance], g);
        if (!move) continue;
        const [dx, dy] = [move.to[0] - move.from[0], move.to[1] - move.from[1]];
        const turn = move.turn;
        if (p.side !== g.side) notes.push(`${g.instance} moved to the ${p.side} side in KiCad: its manifest feature keeps tscircuit's side`);
        const a = (turn * Math.PI) / 180;
        const rot = (x: number, y: number) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
        const point = (v: number[]) => {
          const [x, y] = rot(v[0] - move.from[0], v[1] - move.from[1]);
          [v[0], v[1]] = [r4(p.x + x), r4(p.y + y)];
        };
        const vector = (v?: number[]) => {
          if (!v) return;
          const [x, y] = rot(v[0], v[1]);
          [v[0], v[1]] = [r4(x), r4(y)];
        };
        const seen = new Set<unknown>();
        for (const f of own) {
          for (const v of [f.centroid, f.frame.origin]) if (!seen.has(v)) (seen.add(v), point(v));
          for (const v of [f.normal, f.frame.normal, f.frame.xAxis]) if (v && !seen.has(v)) (seen.add(v), vector(v));
        }
        if (Math.hypot(dx, dy) >= 1e-3) moved++;
        if (Math.abs(turn) >= 0.1) turned++;
      }
      ctx.writeOutput(`${out}/board.manifest.json`, JSON.stringify({ ...manifest, tool: "kicad", toolVersion: kicadVersion(), frame: manifest.frame }, null, 2) + "\n", "geometry manifest (tscircuit build at lock, positions from KiCad)");
      if (moved) notes.push(`manifest positions of ${moved} component(s) taken from KiCad (their footprint origin differs from the locked tscircuit build)`);
      if (turned) notes.push(`${turned} component(s) turned in KiCad: their manifest features carry KiCad's orientation`);
    }
    return { status: "succeeded", summary: `${board} is locked: fabrication outputs from KiCad ${kicadVersion()} (${folder}/): Gerber + drill, pick-and-place, STEP, GLB, renders, netlist; BOM from the model. ${drcSummary}${sum.errors || unconnected ? " (exported with --force)" : ""}${notes.length ? `; ${notes.join("; ")}` : ""}`, data: { locked: true, drc: { errors: sum.errors, warnings: sum.warnings, unconnected, parity }, notes } };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The mating frame each board export's part states (as ops/circuit.ts gives the manifest). */
function edgeFrames(ctx: CapabilityContext, netlist: BoardNetlist): Record<string, PartEdgeFrame> {
  const out: Record<string, PartEdgeFrame> = {};
  for (const e of netlist.edge) {
    const comp = netlist.components.find((c) => c.instance === e.instance);
    const frame = ctx.project.lookup(comp?.part ?? "")?.interfaces.find((i) => i.id === e.interface)?.geometry?.frame;
    if (!comp || !frame) continue;
    const mount = comp.bodies.find((b) => b.mount)?.mount?.origin;
    out[e.id] = { frame, ...(mount ? { mount: [mount[0], mount[1], mount[2]] as [number, number, number] } : {}) };
  }
  return out;
}

/**
 * CIRCUIT_KICAD_DRC: KiCad's DRC of the locked board, run with kicad-cli when
 * it is installed (cached by the files' digest), else read from the last
 * export's out/drc.json, said to be older than the board when it is. Errors
 * or unconnected items are an error; warnings alone a warning; a clean board
 * says nothing.
 */
export function kicadDrcFinding(root: string, folder: string, board: string, out: string, module: string): { severity: "error" | "warning" | "info"; message: string } | undefined {
  const fix = `open ${folder}/${board}.kicad_pcb in KiCad, run Inspect > Design Rules Checker and correct the layout (the kicad-layout-review skill walks through it)`;
  let report: DrcReport | undefined;
  let from: string;
  if (kicadCli()) {
    try {
      report = runDrc(join(root, folder), board, { cache: true }).report;
      from = `run now (${DRC_COMMAND})`;
    } catch (e) {
      return { severity: "warning", message: `KiCad's DRC of ${board} did not run: ${(e as Error).message.split("\n")[0]}` };
    }
  } else if (existsSync(join(root, out, "drc.json"))) {
    try {
      report = JSON.parse(readFileSync(join(root, out, "drc.json"), "utf8")) as DrcReport;
    } catch {
      return { severity: "warning", message: `${out}/drc.json cannot be read, and kicad-cli is not installed to run KiCad's DRC of ${board}` };
    }
    const stale = statSync(join(root, folder, `${board}.kicad_pcb`)).mtimeMs > statSync(join(root, out, "drc.json")).mtimeMs;
    from = `from ${out}/drc.json, the last circuit:export${stale ? "; the board changed since, so it may be out of date (install KiCad 10 for check to run it)" : ""}`;
  } else return { severity: "info", message: `KiCad's DRC of ${board} was not run: kicad-cli is not installed and there is no ${out}/drc.json (circuit:export writes one)` };
  const s = summariseDrc(report);
  if (!s.errors && !s.unconnected && !s.warnings) return undefined;
  const bad = s.errors > 0 || s.unconnected > 0;
  return {
    severity: bad ? "error" : "warning",
    message: `${drcLine(s)}, ${from}${s.first.length ? `. First: ${s.first.join("; ")}` : ""}. ${bad ? `To fix: ${fix}; circuit:export stops on these unless --force (\`protoboard run circuit:export --module ${module}\`)` : "Warnings only; review them in KiCad"}`,
  };
}

/** check on a locked board (spec §4): model, record and KiCad compared, and the land patterns' verification. Pure. */
export function checkLocked(ctx: CapabilityContext, netlist: BoardNetlist): Diagnostic[] | undefined {
  const root = ctx.project.root;
  const h = readHandoff(root, ctx.module.dir);
  if (h?.state !== "locked") return undefined;
  const board = ctx.module.id;
  const folder = kicadDir(ctx.module.dir);
  const out: Diagnostic[] = [];
  const add = (severity: Diagnostic["severity"], code: string, message: string, file = handoffFile(ctx.module.dir)) => out.push({ code, severity, message, entity: { kind: "definition", id: ctx.module.id }, source: { file } });
  add("info", "CIRCUIT_LOCKED", `${board} is locked: KiCad (${folder}/) is the layout of record since ${h.lockedAt}${h.refreshedAt ? ` (re-recorded ${h.refreshedAt})` : ""}; tscircuit's build is not checked`);
  for (const l of boardLands(netlist.components, readOverrides(root, ctx.module.native).overrides)) {
    if (!l.problems.length) continue;
    add("warning", "CIRCUIT_FOOTPRINT_UNVERIFIED", `land pattern ${l.entry.id} for ${l.instances.slice(0, 6).join(", ")} is not verified: ${l.problems[0]}`, ctx.module.native);
  }
  // designators as recorded (check writes nothing: new instances get theirs in memory)
  const refdes = assignRefdes(netlist.components, parseRefdes(read(root, refdesFile(ctx.module.native))), partPrefix(ctx, netlist)).record;
  const model = modelSide(ctx, netlist, readNative(root, ctx.module.native), refdes);
  let k: ReturnType<typeof readKicadSide>;
  try {
    k = readKicadSide(root, folder, board, refdes.assigned);
  } catch (e) {
    add("error", "CIRCUIT_KICAD_UNREADABLE", `${(e as Error).message}; the locked board's KiCad files cannot be read`, folder);
    return out;
  }
  for (const p of k.problems) add("warning", "CIRCUIT_KICAD_UNREADABLE", p, folder);
  const shapeChanged = h.boardShape !== boardShapeDigest(constraintsOf(ctx, netlist));
  out.push(...comparisonDiagnostics(compare(h, model, k.pcb), { board, file: `${folder}/${board}.kicad_pcb`, shapeChanged, module: ctx.module.id }));
  // the schematic against the board (KiCad's own parity, without running DRC)
  const known = new Set(h.parityAtLock ?? []);
  const parity = [...(k.schParts ? parityProblems(k.schParts, k.pcb.parts) : []), ...(k.sch ? netParity(k.sch, k.pcb) : [])].filter((p) => !known.has(p));
  // KiCad's own DRC (PB-1027, F24): a forced export does not pass check unnoticed
  const drc = kicadDrcFinding(root, folder, board, ctx.module.out, ctx.module.id);
  if (drc) add(drc.severity, "CIRCUIT_KICAD_DRC", drc.message, `${folder}/${board}.kicad_pcb`);
  if (parity.length) add("warning", "CIRCUIT_KICAD_PARITY", `the KiCad schematic and board disagree (${parity.length}): ${parity.slice(0, 4).join("; ")}${parity.length > 4 ? "; …" : ""}. Update PCB from Schematic in KiCad, or fix the schematic`, `${folder}/${board}.kicad_sch`);
  return out;
}
