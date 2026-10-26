/**
 * TEST FIXTURE: fake circuit provider B. Its native design is a line-based
 * text file (`board.fkb`); it exports inch Gerber with Protel-style file
 * extensions and an .xln drill file. Its native folder takes the default name
 * (`fake-circuit-b`), unlike provider A's declared `fake-a`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NETLIST_SCHEMA, type CapabilityContext, type CapabilityOperationFn, type NetlistReport } from "@protoboardai/core";
import { drift, holes, netsOf, place, type Net, type Placed, type Size } from "../_shared/board.ts";
import { csvField, excellon, gerber, glb, step } from "../_shared/fab.ts";

const designFile = (ctx: CapabilityContext) => `${ctx.module.native}/board.fkb`;

function parse(text: string): { size: Size; components: Placed[]; nets: Net[] } {
  const r = { size: { w: 0, h: 0 }, components: [] as Placed[], nets: [] as Net[] };
  for (const line of text.split("\n")) {
    const [kind, ...f] = line.trim().split(/\s+/);
    if (kind === "BOARD") r.size = { w: Number(f[0]), h: Number(f[1]) };
    if (kind === "COMP") r.components.push({ instance: f[0], definition: f[1], x: Number(f[2]), y: Number(f[3]), rotation: Number(f[4]), side: f[5] as Placed["side"] });
    if (kind === "NET") r.nets.push({ id: f[0], link: f[1], pins: f.slice(2) });
  }
  return r;
}

const read = (ctx: CapabilityContext) => {
  const f = join(ctx.project.root, designFile(ctx));
  return existsSync(f) ? parse(readFileSync(f, "utf8")) : undefined;
};

export const generate: CapabilityOperationFn = (ctx) => {
  const def = ctx.module.definition;
  const { size, components } = place(def, ctx.constraints);
  const nets = netsOf(def);
  const text = [
    `# fake-circuit-b design for ${def.id} (TEST FIXTURE)`,
    `BOARD ${size.w} ${size.h}`,
    ...components.map((c) => `COMP ${c.instance} ${c.definition} ${c.x} ${c.y} ${c.rotation} ${c.side}`),
    ...nets.map((n) => `NET ${n.id} ${n.link} ${n.pins.join(" ")}`),
  ].join("\n");
  ctx.writeOutput(designFile(ctx), text + "\n", "native design (fake)");
  return { status: "succeeded", summary: `placed ${components.length}` };
};

export const exportOutputs: CapabilityOperationFn = (ctx) => {
  const d = read(ctx);
  if (!d) return { status: "failed", summary: "no board.fkb; run circuit:generate first" };
  const out = ctx.module.out;
  ctx.writeOutput(`${out}/gerber/board.gtl`, gerber({ units: "in", fileFunction: "Copper,L1,Top", pads: d.components }));
  ctx.writeOutput(`${out}/gerber/board.gbl`, gerber({ units: "in", fileFunction: "Copper,L2,Bot" }));
  ctx.writeOutput(`${out}/gerber/board.gko`, gerber({ units: "in", fileFunction: "Profile,NP", outline: d.size }));
  ctx.writeOutput(`${out}/gerber/board.xln`, excellon({ units: "in", diameter_mm: 2.2, holes: holes(d.size) }));
  const defs = ctx.module.definition.children ?? [];
  const name = (inst: string) => defs.find((c) => c.id === inst)?.name ?? inst;
  ctx.writeOutput(`${out}/bom.csv`, ["definition,instance,description", ...d.components.map((c) => [c.definition, c.instance, `${name(c.instance)}, as modelled`].map(csvField).join(","))].join("\r\n") + "\r\n");
  ctx.writeOutput(`${out}/pnp.csv`, ["side,instance,rotation_deg,x_mm,y_mm,package", ...d.components.map((c) => [c.side, c.instance, c.rotation, c.x.toFixed(3), c.y.toFixed(3), csvField("as stated, by the part")].join(","))].join("\r\n") + "\r\n");
  ctx.writeOutput(`${out}/board.glb`, glb({ asset: { version: "2.0", generator: "fake-circuit-b (test fixture)" }, nodes: [{ name: "board" }] }));
  ctx.writeOutput(`${out}/board.step`, step("board.step", d.components.map((c) => ({ name: c.instance, x: c.x, y: c.y, z: 1.6 }))));
  const features = Object.fromEntries([
    ["outline", { area_mm2: d.size.w * d.size.h, centroid: [d.size.w / 2, d.size.h / 2, 0], normal: [0, 0, -1] }],
    ...d.components.map((c) => [c.instance, { area_mm2: 4, centroid: [c.x, c.y, 1.6], normal: [0, 0, 1], faces: 1 }]),
  ]);
  ctx.writeOutput(`${out}/board.manifest.json`, JSON.stringify({ artifact: "board", tool: "fake-circuit-b", toolVersion: "0.2.0", units: "mm", features }) + "\n");
  const netlist: NetlistReport = { schema: NETLIST_SCHEMA, nets: d.nets };
  ctx.writeOutput(`${out}/netlist.json`, JSON.stringify(netlist) + "\n");
  return { status: "succeeded", summary: "exported" };
};

export const extract: CapabilityOperationFn = (ctx) => {
  const d = read(ctx);
  if (!d) return { status: "failed", summary: "no board.fkb" };
  const frames = Object.fromEntries(
    (ctx.module.definition.exports ?? []).flatMap((e) => {
      const from = e.from;
      const c = "child" in from ? d.components.find((x) => x.instance === from.child) : undefined;
      return c ? [[e.id, { origin: [c.x, d.size.h, 1.6] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }]] : [];
    }),
  );
  return { status: "succeeded", summary: `${Object.keys(frames).length} frames`, data: { frames, artifacts: [{ id: "board_glb", name: "Board", type: "pcb", role: "body", format: "glb", filePath: `${ctx.module.out}/board.glb` }] } };
};

export const check: CapabilityOperationFn = (ctx) => {
  const d = read(ctx);
  if (!d) return { status: "succeeded", summary: "not generated", diagnostics: [] };
  const diagnostics = drift(ctx.module.definition, d.components.map((c) => c.instance), d.nets.map((n) => n.link), "FAKE_B_DRIFT", designFile(ctx));
  return { status: "succeeded", summary: `${diagnostics.length} difference(s)`, diagnostics };
};
