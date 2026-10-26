/**
 * The `circuit` capability with tscircuit (docs/specs/tool-integrations.md,
 * docs/research/tscircuit-spike.md §9):
 *
 *   generate  UHD board → board netlist (core, tool-neutral) → tscircuit source
 *             in tscircuit/, then a local build and route → circuit.json
 *   export    circuit.json (rebuilt first if the source changed) → standard outputs in out/
 *   extract   circuit.json → frames for the board's exports and interfaces, artifacts
 *   check     tscircuit DRC + drift between the built board and the UHD board (pure)
 */
import { boardNetlist, boardOptions, declaredArtifacts, type BoardNetlist, type CapabilityDecl, type CapabilityContext, type CapabilityOperationFn, type ExtractedFacts } from "@protoboardai/core";
import type { ArtifactDef, GeometryFrame } from "@deltarobotics/uhd";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkBoard } from "../lib/checks.ts";
import { handPadJoins } from "../lib/layout.ts";
import { readConstraints, type BoardConstraints } from "../lib/config.ts";
import { boardDigest, boardProjection, EXPORT_SCHEMA, exportDrift, exportFile, exportInputs, fingerprintFormatChanged, readExportRecord, type ExportRecord } from "../lib/fingerprint.ts";
import { applyBodies, boxStep, cadModels, chooseBodies, withMeshes, type ComponentBody } from "../lib/models.ts";
import { projectOffers, supplierNumbers } from "../lib/suppliers.ts";
import { buildAndRecord, buildErrors, digestOf, files, inputsDigest, readLayout, readNative, readOverrides, sourceDigest, type Native } from "../lib/native.ts";
import { boardGlb, boardManifest, boardStep, bomCsv, fabricationFiles, laidOutNetlist, pnpCsv, renders, type PartEdgeFrame } from "../lib/outputs.ts";
import { ENTRY_SOURCE, generateSource } from "../lib/source.ts";
import { withoutShapes } from "../lib/stepfile.ts";
import { isLocked } from "../lib/kicad/handoff.ts";
import { checkLocked, exportLocked, lockedGenerate, refdesFor } from "./kicad.ts";

/** The circuit capability as the manifest declares it: its artifacts are the ones extract reports. */
const CIRCUIT_DECL = (JSON.parse(readFileSync(new URL("../protoboard-extension.json", import.meta.url), "utf8")) as { capabilities: CapabilityDecl[] }).capabilities.find((c) => c.id === "circuit")!;

const netlistOf = (ctx: CapabilityContext): { netlist: BoardNetlist; digest: string } => {
  const netlist = boardNetlist(ctx.module.definition, ctx.project.lookup, boardOptions(ctx.project));
  return { netlist, digest: digestOf(JSON.stringify(netlist)) };
};

/** The mating frame each board export's part states for the exported interface (part coordinates), with the part's mount origin. */
const edgeFrames = (ctx: CapabilityContext, netlist: BoardNetlist): Record<string, PartEdgeFrame> => {
  const out: Record<string, PartEdgeFrame> = {};
  for (const e of netlist.edge) {
    const comp = netlist.components.find((c) => c.instance === e.instance);
    const frame = ctx.project.lookup(comp?.part ?? "")?.interfaces.find((i) => i.id === e.interface)?.geometry?.frame;
    if (!comp || !frame) continue;
    const mount = comp.bodies.find((b) => b.mount)?.mount?.origin;
    out[e.id] = { frame, ...(mount ? { mount: [mount[0], mount[1], mount[2]] as [number, number, number] } : {}) };
  }
  return out;
};

/** Digest of what the board depends on in UHD (fingerprint.ts boardProjection). */
const boardFingerprint = (ctx: CapabilityContext, netlist: BoardNetlist) =>
  boardDigest(boardProjection(netlist, edgeFrames(ctx, netlist), Object.fromEntries(netlist.components.map((c) => [c.part, (ctx.project.lookup(c.part)?.interfaces ?? []).map((i) => i.id)]))));

/**
 * Write what the chosen bodies need in the native folder: a box STEP for each package box, and a
 * copy of each part STEP without its interface feature shapes; point each body at its copy.
 */
function prepareBodies(ctx: CapabilityContext, bodies: ComponentBody[]): void {
  const root = ctx.project.root;
  for (const b of bodies) if (b.box && !existsSync(join(root, b.box.path))) ctx.writeOutput(b.box.path, boxStep(`box ${b.box.size.join(" x ")} mm`, b.box.size), "component body box from package facts");
  const copies = new Map<string, boolean>();
  for (const b of bodies) {
    if (!b.step || !b.stripped || !b.strip?.length) continue;
    if (!copies.has(b.stripped)) {
      const { text, removed } = withoutShapes(readFileSync(b.step, "utf8"), b.strip);
      if (removed.length) ctx.writeOutput(b.stripped, text, `${b.label} without its interface feature shapes (${removed.join(", ")})`);
      copies.set(b.stripped, removed.length > 0);
    }
    if (copies.get(b.stripped)) b.step = join(root, b.stripped);
  }
}

/** Generate's inputs besides the board: layout.json, footprints.json, the constraints and the supplier numbers (native.ts). */
const generateInputs = (ctx: CapabilityContext, netlist: BoardNetlist) => inputsDigest(ctx.project.root, ctx.module.native, ctx.constraints, supplierNumbers(ctx.project.root, netlist.components, projectOffers(ctx.project)));

const constraintsOf = (ctx: CapabilityContext, netlist: BoardNetlist) => readConstraints(ctx.constraints, netlist.envelope);

const failed = (summary: string, problems: string[]) => ({ status: "failed" as const, summary: `${summary}: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`, data: { problems } });

/** Errors that mean the router never ran: the layout needs work before anything else is meaningful. */
const blocking = (errors: { type: string; message: string }[]) => errors.filter((e) => e.type === "pcb_packing_error" || (e.type === "pcb_autorouting_error" && /skipped/.test(e.message)) || e.type === "pcb_missing_footprint_error");

export const generate: CapabilityOperationFn = async (ctx) => {
  const locked = lockedGenerate(ctx); // KiCad is the layout of record (ops/kicad.ts)
  if (locked) return locked;
  const root = ctx.project.root;
  const f = files(ctx.module.native);
  const { netlist, digest } = netlistOf(ctx);
  if (netlist.problems.length) return failed(`${ctx.module.id} cannot be read as a board`, netlist.problems);
  for (const n of netlist.notes ?? []) ctx.log(`warning: ${n}`);
  const { constraints, problems, notes } = constraintsOf(ctx, netlist);
  if (!constraints) return failed("circuit.config.ts constraints", problems);
  for (const n of notes) ctx.log(`warning: ${n}`);
  const { overrides, problems: fp } = readOverrides(root, ctx.module.native);
  const { layout, problems: lp } = readLayout(root, ctx.module.native);
  if (fp.length || lp.length) return failed("provider files", [...fp, ...lp]);

  // each part's body as a cadModel (relative paths), and its supplier part numbers (LCSC first)
  const bodies = chooseBodies(ctx.project, netlist.components, ctx.module.native);
  prepareBodies(ctx, bodies);
  const suppliers = supplierNumbers(root, netlist.components, projectOffers(ctx.project));
  const g = generateSource({ netlist, constraints, overrides, layout, suppliers, models: cadModels(root, ctx.module.native, bodies) });
  if (g.problems.length) return failed("no source written", g.problems);
  for (const n of g.notes) ctx.log(`warning: ${n}`);
  ctx.writeOutput(f.gen, g.source, "generated tscircuit source (rewritten by generate)");
  if (!existsSync(join(root, f.entry))) ctx.writeOutput(f.entry, ENTRY_SOURCE, "tscircuit entry (written once; hand edits go here)");
  if (!existsSync(join(root, f.layout))) {
    ctx.writeOutput(f.layout, JSON.stringify({ $comment: "Positions for parts circuit.config.ts does not fix: { <instance>: { at: [x, y], rotation_deg, side } } (mm, board frame). Parts not listed are placed by tscircuit." }, null, 2) + "\n", "layout tweaks (hand-owned)");
  }

  // designators recorded per instance from the first build (F07), so the silkscreen prints them (F14) and a later KiCad lock keeps them
  const designators = refdesFor(ctx, netlist, true).assigned;
  const built = await buildAndRecord(ctx, g.map, digest, generateInputs(ctx, netlist), designators);
  // traces written by hand between pads of one pin: generate joins them itself now (PB-1027, F22)
  for (const h of handPadJoins(built.circuitJson, g.map, g.source)) ctx.log(`warning: a trace written by hand (${h.trace}) joins pads of ${h.instance}:${h.pin}, which generate joins itself; remove it from ${f.entry} (in KiCad it becomes copper on no net)`);
  const errors = buildErrors(built.circuitJson);
  const stop = blocking(errors);
  const placement = Object.values(g.map.components).reduce((n, c) => ({ ...n, [c.placement]: (n[c.placement] ?? 0) + 1 }), {} as Record<string, number>);
  const n = (t: string) => built.circuitJson.filter((e) => e.type === t).length;
  const summary = `${netlist.components.length} components (${Object.entries(placement).map(([k, v]) => `${v} ${k}`).join(", ")}), ${netlist.nets.length} nets → ${n("pcb_trace")} traces, ${n("pcb_via")} vias in ${(built.build.build_ms / 1000).toFixed(1)} s${constraints.routing === "off" ? " (routing: off, placement only)" : ""}; ${errors.length} tscircuit error(s)`;
  const data = { components: netlist.components.length, nets: netlist.nets.length, ...(notes.length ? { notes } : {}), placement, traces: n("pcb_trace"), vias: n("pcb_via"), build_ms: built.build.build_ms, errors: errors.map((e) => `${e.type}: ${e.message}`) };
  if (stop.length) {
    return { status: "failed", summary: `${summary}. Not routed: ${stop[0].message}. Move parts in ${f.layout} (or fix them in circuit.config.ts) and generate again`, data };
  }
  return { status: "succeeded", summary, data };
};

/** The current build, rebuilt first when the native source changed since it. */
async function current(ctx: CapabilityContext, netlistDigest: string): Promise<Native | undefined> {
  const root = ctx.project.root;
  const native = readNative(root, ctx.module.native);
  if (!native) return undefined;
  if (native.build.sourceDigest === sourceDigest(root, ctx.module.native, native.build.sourceFiles)) return native;
  ctx.log(`native source changed since the last build: rebuilding`);
  return buildAndRecord(ctx, native.build.map, native.build.netlistDigest ?? netlistDigest, native.build.inputsDigest ?? "", refdesFor(ctx, netlistOf(ctx).netlist, false).assigned);
}

export const exportOutputs: CapabilityOperationFn = async (ctx) => {
  if (isLocked(ctx.project.root, ctx.module.dir)) return exportLocked(ctx); // from KiCad (ops/kicad.ts)
  const root = ctx.project.root;
  const out = ctx.module.out;
  const { netlist, digest } = netlistOf(ctx);
  const native = await current(ctx, digest);
  if (!native) return { status: "failed", summary: `no built board in ${ctx.module.native}/; run circuit:generate first` };
  const { constraints } = constraintsOf(ctx, netlist);
  const { circuitJson: cj, build } = native;
  const stale = build.inputsDigest !== generateInputs(ctx, netlist);
  if (stale) ctx.log(`layout.json, footprints.json or the circuit.config.ts constraints changed since generate; these outputs show the last generated layout. Run circuit:generate`);

  // bodies: the part's own STEP, else a box from its package facts
  const bodies = chooseBodies(ctx.project, netlist.components, ctx.module.native);
  // what this export reads, before the bodies are pointed at their stripped copies (fingerprint.ts)
  const inputs = exportInputs(root, ctx.module.native, boardFingerprint(ctx, netlist), ctx.constraints, bodies);
  prepareBodies(ctx, bodies);
  const { circuitJson: withBodies, used, labels } = applyBodies(cj, build.map, bodies, root);

  // every output is made before any is written: a converter that throws leaves the last export's out/ as it was
  // (core stages an export's out/ and swaps it in only when the export succeeds)
  const fabrication = fabricationFiles(cj);
  const { manifest, geometry, notes } = boardManifest(cj, build.map, netlist, constraints, build.sourceDigest, edgeFrames(ctx, netlist));
  const glb = await boardGlb(withMeshes(withBodies, build.map, bodies), build.map);
  const step = await boardStep(withBodies, build.map, labels);
  const svgs = renders(cj);

  for (const [path, text] of Object.entries(fabrication)) ctx.writeOutput(`${out}/${path}`, text);
  const suppliers = supplierNumbers(root, netlist.components, projectOffers(ctx.project));
  ctx.writeOutput(`${out}/bom.csv`, bomCsv(netlist, suppliers), "bill of materials by UHD instance, with supplier part numbers");
  ctx.writeOutput(`${out}/pnp.csv`, pnpCsv(netlist, geometry, suppliers), "pick-and-place by UHD instance");
  ctx.writeOutput(`${out}/board.manifest.json`, JSON.stringify(manifest, null, 2) + "\n", "geometry manifest");
  ctx.writeOutput(`${out}/netlist.json`, JSON.stringify(laidOutNetlist(cj, build.map, netlist), null, 2) + "\n", "nets as laid out");
  ctx.writeOutput(`${out}/board.glb`, glb.glb, "board with component bodies (glTF binary, metres, Y up)");
  ctx.writeOutput(`${out}/board.step`, step, "board with component bodies (STEP, mm, board frame)");
  for (const [name, svg] of Object.entries(svgs)) ctx.writeOutput(`${out}/${name}`, svg, "render");
  const record: ExportRecord = { schema: EXPORT_SCHEMA, inputs };
  ctx.writeOutput(exportFile(ctx.module.native), JSON.stringify(record, null, 2) + "\n", "export record: the inputs these outputs were made from");

  // bodies chosen for board.glb that its converter could not load (it drew a box instead): named, not counted as bodies
  const failed = new Set(glb.failed);
  // applyBodies points each cad_component at the body's STEP, or at `${root}/${box path}`
  const unloaded = bodies.filter((b) => (used[b.instance] === "part" || used[b.instance] === "box") && (failed.has(b.step ?? `${root}/${b.box?.path}`) || (!!b.mesh && failed.has(b.mesh.path)))).map((b) => b.instance);
  for (const f of glb.failed) ctx.log(`warning: board.glb: could not load the body ${f}; the converter drew a box in its place`);
  const count = (s: string) => Object.entries(used).filter(([i, u]) => u === s && !unloaded.includes(i)).length;
  const summary = `exported ${netlist.components.length} components: Gerber + drill, BOM, PnP, GLB/STEP (${count("part")} part bodies, ${count("box")} package boxes${count("tscircuit") ? `, ${count("tscircuit")} tscircuit bodies` : ""}${count("none") ? `, ${count("none")} without a body` : ""}${unloaded.length ? `; board.glb could not load ${unloaded.length} bodies and drew boxes for ${unloaded.slice(0, 5).join(", ")}${unloaded.length > 5 ? ", …" : ""}` : ""}), manifest, netlist, renders`;
  const data = { bodies: used, ...(unloaded.length ? { bodiesNotLoaded: unloaded, filesNotLoaded: glb.failed } : {}), notes, ...(stale ? { stale: "generate inputs changed since the last generate" } : {}) };
  return { status: "succeeded", summary: stale ? `${summary}. Stale: generate inputs changed since the last generate; run circuit:generate` : summary, data };
};

export const extract: CapabilityOperationFn = async (ctx) => {
  const root = ctx.project.root;
  const { netlist, digest } = netlistOf(ctx);
  const native = await current(ctx, digest);
  if (!native) return { status: "failed", summary: `no built board in ${ctx.module.native}/; run circuit:generate first` };
  const { constraints } = constraintsOf(ctx, netlist);
  const { manifest, geometry } = boardManifest(native.circuitJson, native.build.map, netlist, constraints, native.build.sourceDigest, edgeFrames(ctx, netlist));
  const def = ctx.module.definition;

  // frames for the board's own exports and interfaces, from the manifest features of the same id
  const frames: Record<string, GeometryFrame> = {};
  const ids = new Set([...(def.exports ?? []).map((e) => e.id), ...def.interfaces.map((i) => i.id)]);
  for (const [id, feature] of Object.entries(manifest.features)) if (ids.has(id)) frames[id] = feature.frame;
  // a mechanical mounting interface of the board binds to its underside
  for (const i of def.interfaces) if (i.domain === "mechanical" && !frames[i.id]) frames[i.id] = manifest.features.outline.frame;

  const out = ctx.module.out;
  const provenance = { tool: "tscircuit", toolVersion: geometry.toolVersion, sourceDigest: native.build.sourceDigest };
  // the artifacts the manifest declares (core attaches them to the board at load: PB-1030), with this build's provenance
  const candidates: ArtifactDef[] = declaredArtifacts({ dir: ctx.module.dir, out, native: ctx.module.native, module: def.id }, CIRCUIT_DECL, "tscircuit").map((a) => ({
    ...a,
    provenance: a.provenance?.generatedFrom ? { ...provenance, generatedFrom: a.provenance.generatedFrom } : { tool: "tscircuit", toolVersion: geometry.toolVersion },
  }));
  const artifacts = candidates.filter((a) => existsSync(join(root, a.filePath!)));
  const facts: ExtractedFacts & { geometry: unknown } = {
    frames,
    artifacts,
    // the layout itself, for re-binding steps and reports (not UHD)
    geometry: {
      outline: geometry.outline,
      thickness_mm: geometry.thickness_mm,
      layers: geometry.layers,
      holes: geometry.holes,
      components: Object.fromEntries(geometry.components.map((c) => [c.instance, { at: c.origin, center: c.center, rotation_deg: c.rotation_deg, side: c.side, frame: c.frame }])),
      routing: geometry.routing,
    },
  };
  return { status: "succeeded", summary: `${Object.keys(frames).length} frame(s) (${Object.keys(frames).join(", ")}), ${artifacts.length} artifact(s), ${geometry.components.length} placements`, data: facts };
};

export const check: CapabilityOperationFn = async (ctx) => {
  const root = ctx.project.root;
  const { netlist, digest } = netlistOf(ctx);
  const f = files(ctx.module.native);
  let constraints: BoardConstraints | undefined;
  if (netlist.problems.length) return { status: "succeeded", summary: "board cannot be read", diagnostics: netlist.problems.map((m) => ({ code: "CIRCUIT_BOARD_UNREADABLE", severity: "error" as const, message: m, entity: { kind: "definition" as const, id: ctx.module.id } })) };
  // the grouping's warnings: an unused export of a sub-module, a sub-module with no parts (docs/specs/nested-boards.md §11)
  const grouping = (netlist.notes ?? []).map((m) => ({ code: "CIRCUIT_BOARD_GROUPING", severity: "warning" as const, message: m, entity: { kind: "definition" as const, id: ctx.module.id } }));
  const locked = checkLocked(ctx, netlist); // model, handoff record and KiCad compared (ops/kicad.ts)
  if (locked) return { status: "succeeded", summary: `locked: ${locked.filter((d) => d.severity === "error").length} error(s)`, diagnostics: [...locked, ...grouping] };
  const read = constraintsOf(ctx, netlist);
  constraints = read.constraints;
  const notes = read.notes;
  const diagnostics = await checkBoard({
    native: readNative(root, ctx.module.native),
    netlist,
    netlistDigest: digest,
    sourceDigest: sourceDigest(root, ctx.module.native, readNative(root, ctx.module.native)?.build.sourceFiles),
    inputsDigest: generateInputs(ctx, netlist),
    constraints,
    constraintNotes: notes,
    file: existsSync(join(root, f.gen)) ? f.gen : f.entry,
    module: ctx.module.id,
    overrides: readOverrides(root, ctx.module.native).overrides,
    ...(existsSync(join(root, f.gen)) ? { generatedSource: readFileSync(join(root, f.gen), "utf8") } : {}),
  });
  // outputs made from other inputs than the current ones: a re-export would change them (fingerprint.ts)
  if (existsSync(join(root, ctx.module.out, "board.step")) || existsSync(join(root, ctx.module.out, "board.glb"))) {
    const recorded = readExportRecord(root, ctx.module.native);
    const rerun = `run \`protoboard run circuit:export --module ${ctx.module.id}\``;
    if (!recorded) diagnostics.push({ code: "CIRCUIT_STALE", severity: "warning", message: `${ctx.module.out}/ has no record of the inputs it was exported from (${exportFile(ctx.module.native)}): it was exported by an earlier provider, and a re-export may change board.step and board.glb; ${rerun}`, entity: { kind: "definition", id: ctx.module.id }, source: { file: ctx.module.out } });
    else {
      const now = exportInputs(root, ctx.module.native, boardFingerprint(ctx, netlist), ctx.constraints, chooseBodies(ctx.project, netlist.components, ctx.module.native));
      const drift = exportDrift(recorded.inputs, now);
      if (fingerprintFormatChanged(recorded.inputs)) diagnostics.push({ code: "CIRCUIT_FINGERPRINT_FORMAT", severity: "info", message: `${exportFile(ctx.module.native)} was written by an earlier provider, which fingerprinted the whole UHD module (a description or a price edit counted as a change); the board's own dependencies are fingerprinted now. A change to the board since that export cannot be told from the record, so it is not reported as stale; the next \`protoboard run circuit:export --module ${ctx.module.id}\` records the new format`, entity: { kind: "definition", id: ctx.module.id }, source: { file: exportFile(ctx.module.native) } });
      if (drift.length) diagnostics.push({ code: "CIRCUIT_STALE", severity: "warning", message: `${ctx.module.out}/ was exported from other inputs than the current ones (${drift.join("; ")}): a re-export will change its outputs (board.step, board.glb and the rest); ${rerun}`, entity: { kind: "definition", id: ctx.module.id }, source: { file: exportFile(ctx.module.native) } });
    }
  }
  diagnostics.push(...grouping);
  // constraints generate would refuse (and fab-order keys the release would print wrong)
  for (const m of read.problems) diagnostics.push({ code: "CIRCUIT_CONFIG_INVALID", severity: "error", message: `circuit.config.ts constraints: ${m}`, entity: { kind: "definition", id: ctx.module.id } });
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  return { status: "succeeded", summary: errors ? `${errors} error(s)` : "board matches the UHD module; no tscircuit errors", diagnostics };
};
