/**
 * TEST FIXTURE: fake circuit provider A. Its native design is one JSON file;
 * it exports metric Gerber (KiCad-like layer names) and a .drl drill file.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NETLIST_SCHEMA, type CapabilityContext, type CapabilityOperationFn, type ExtractedFacts, type NetlistReport } from "@protoboardai/core";
import { drift, holes, netsOf, place, type Net, type Placed, type Size } from "../_shared/board.ts";
import { csvField, excellon, gerber, glb, step } from "../_shared/fab.ts";

interface Design {
  provider: "fake-circuit-a";
  module: string;
  size: Size;
  layers: number;
  components: Placed[];
  nets: Net[];
}

const designFile = (ctx: CapabilityContext) => `${ctx.module.native}/design.json`;
const read = (ctx: CapabilityContext): Design | undefined => {
  const f = join(ctx.project.root, designFile(ctx));
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;
};

export const generate: CapabilityOperationFn = (ctx) => {
  const def = ctx.module.definition;
  const { size, components } = place(def, ctx.constraints);
  const design: Design = { provider: "fake-circuit-a", module: def.id, size, layers: Number(ctx.constraints.layers ?? 2), components, nets: netsOf(def) };
  ctx.writeOutput(designFile(ctx), JSON.stringify(design, null, 2) + "\n", "native design (fake)");
  return { status: "succeeded", summary: `${components.length} components, ${design.nets.length} nets` };
};

export const exportOutputs: CapabilityOperationFn = (ctx) => {
  const d = read(ctx);
  if (!d) return { status: "failed", summary: `no design; run circuit:generate first` };
  const out = ctx.module.out;
  const top = d.components.filter((c) => c.side === "top");
  ctx.writeOutput(`${out}/gerber/F_Cu.gbr`, gerber({ units: "mm", fileFunction: "Copper,L1,Top", pads: top }));
  ctx.writeOutput(`${out}/gerber/B_Cu.gbr`, gerber({ units: "mm", fileFunction: `Copper,L${d.layers},Bot` }));
  ctx.writeOutput(`${out}/gerber/Edge_Cuts.gbr`, gerber({ units: "mm", fileFunction: "Profile,NP", outline: d.size }));
  ctx.writeOutput(`${out}/gerber/board.drl`, excellon({ units: "mm", diameter_mm: 2.2, holes: holes(d.size) }));
  ctx.writeOutput(`${out}/bom.csv`, ["instance,definition,quantity", ...d.components.map((c) => [c.instance, c.definition, 1].map(csvField).join(","))].join("\n") + "\n");
  ctx.writeOutput(`${out}/pnp.csv`, ["instance,x_mm,y_mm,rotation_deg,side", ...d.components.map((c) => [c.instance, c.x, c.y, c.rotation, c.side].join(","))].join("\n") + "\n");
  ctx.writeOutput(`${out}/board.glb`, glb({ asset: { version: "2.0", generator: "fake-circuit-a (test fixture)" }, scenes: [{ nodes: d.components.map((_, i) => i) }], nodes: d.components.map((c) => ({ name: c.instance, translation: [c.x, c.y, 1.6] })) }));
  ctx.writeOutput(`${out}/board.step`, step("board.step", [{ name: "outline", x: 0, y: 0, z: 0 }, ...d.components.map((c) => ({ name: c.instance, x: c.x, y: c.y, z: 1.6 }))]));
  const features: Record<string, { area_mm2: number; centroid: [number, number, number]; normal: [number, number, number] }> = {
    outline: { area_mm2: d.size.w * d.size.h, centroid: [d.size.w / 2, d.size.h / 2, 0], normal: [0, 0, -1] },
  };
  holes(d.size).forEach((h, i) => (features[`hole_${i + 1}`] = { area_mm2: Math.PI * 1.1 ** 2, centroid: [h.x, h.y, 0], normal: [0, 0, -1] }));
  for (const c of d.components) features[c.instance] = { area_mm2: 1, centroid: [c.x, c.y, 1.6], normal: [0, 0, 1] };
  ctx.writeOutput(`${out}/board.manifest.json`, JSON.stringify({ artifact: "board", tool: "fake-circuit-a", units: "mm", features }, null, 2) + "\n");
  const netlist: NetlistReport = { schema: NETLIST_SCHEMA, nets: d.nets };
  ctx.writeOutput(`${out}/netlist.json`, JSON.stringify(netlist, null, 2) + "\n");
  return { status: "succeeded", summary: `exported ${d.components.length} components` };
};

export const extract: CapabilityOperationFn = (ctx) => {
  const d = read(ctx);
  if (!d) return { status: "failed", summary: "no design; run circuit:generate first" };
  const def = ctx.module.definition;
  const facts: ExtractedFacts = {
    frames: Object.fromEntries([
      ...def.interfaces.filter((i) => i.domain === "mechanical").map((i) => [i.id, { origin: [d.size.w / 2, d.size.h / 2, 0], normal: [0, 0, -1] }]),
      ...(def.exports ?? []).flatMap((e) => {
        const from = e.from;
        const c = "child" in from ? d.components.find((x) => x.instance === from.child) : undefined;
        return c ? [[e.id, { origin: [c.x, c.y, 1.6], normal: [0, 1, 0] }]] : [];
      }),
    ]),
    artifacts: [
      { id: "board_glb", name: "Board", type: "pcb", role: "body", format: "glb", units: "mm", filePath: `${ctx.module.out}/board.glb` },
      { id: "board_step", name: "Board", type: "pcb", role: "body", format: "step", units: "mm", filePath: `${ctx.module.out}/board.step` },
      { id: "board_source", name: "Board design", type: "pcb", role: "source", format: "fake-a-json", filePath: designFile(ctx) },
    ],
  };
  return { status: "succeeded", summary: `${Object.keys(facts.frames!).length} frames`, data: facts };
};

export const check: CapabilityOperationFn = (ctx) => {
  const d = read(ctx);
  if (!d) return { status: "succeeded", summary: "not generated", diagnostics: [{ code: "FAKE_A_NOT_GENERATED", severity: "info", entity: { kind: "definition", id: ctx.module.id }, message: "no design yet" }] };
  const diagnostics = drift(ctx.module.definition, d.components.map((c) => c.instance), d.nets.map((n) => n.link), "FAKE_A_DRIFT", designFile(ctx));
  return { status: "succeeded", summary: diagnostics.length ? `${diagnostics.length} difference(s)` : "design matches the model", diagnostics };
};

/** A provider's own operation beside the four (core runs it like them, with its declared effect). */
export const stamp: CapabilityOperationFn = (ctx) => {
  ctx.writeOutput(`${ctx.module.native}/stamp.txt`, `${ctx.operation} ${ctx.module.id}${ctx.inputs.force ? " forced" : ""}\n`);
  return { status: "succeeded", summary: `stamped ${ctx.module.id}` };
};
