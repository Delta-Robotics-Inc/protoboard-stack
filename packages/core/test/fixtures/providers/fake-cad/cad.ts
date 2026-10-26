/**
 * TEST FIXTURE: fake cad provider. Designs a box around an inner volume with
 * one feature per interface, spread along the +y wall. Exports STEP, GLB, a
 * binary STL and a geometry manifest.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityContext, CapabilityOperationFn, ExtractedFacts } from "@protoboardai/core";
import { glb, step, stlBox } from "../_shared/fab.ts";

type V3 = [number, number, number];
interface Design {
  outer: V3;
  features: { interface: string; centroid: V3; normal: V3; area_mm2: number }[];
}

const designFile = (ctx: CapabilityContext) => `${ctx.module.native}/box.json`;
const read = (ctx: CapabilityContext): Design | undefined => {
  const f = join(ctx.project.root, designFile(ctx));
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;
};

export const generate: CapabilityOperationFn = (ctx) => {
  const wall = Number(ctx.constraints.wall_mm);
  const inner = (ctx.constraints.inner_mm as V3 | undefined) ?? [40, 30, 10];
  const outer: V3 = [inner[0] + 2 * wall, inner[1] + 2 * wall, inner[2] + 2 * wall];
  const ifaces = ctx.module.definition.interfaces;
  const features = ifaces.map((i, n) => ({ interface: i.id, centroid: [(outer[0] * (n + 1)) / (ifaces.length + 1), outer[1], outer[2] / 2] as V3, normal: [0, 1, 0] as V3, area_mm2: 20 }));
  ctx.writeOutput(designFile(ctx), JSON.stringify({ outer, features }, null, 2) + "\n");
  return { status: "succeeded", summary: `box ${outer.join(" × ")} mm, ${features.length} features` };
};

export const exportOutputs: CapabilityOperationFn = (ctx) => {
  const d = read(ctx);
  if (!d) return { status: "failed", summary: "no design" };
  const out = ctx.module.out;
  ctx.writeOutput(`${out}/body.step`, step("body.step", d.features.map((f) => ({ name: f.interface, x: f.centroid[0], y: f.centroid[1], z: f.centroid[2] }))));
  ctx.writeOutput(`${out}/body.glb`, glb({ asset: { version: "2.0", generator: "fake-cad (test fixture)" }, nodes: d.features.map((f) => ({ name: f.interface, translation: f.centroid })) }));
  if (ctx.process === "print") ctx.writeOutput(`${out}/body.stl`, stlBox(...d.outer));
  const features = Object.fromEntries(d.features.map((f) => [f.interface, { area_mm2: f.area_mm2, centroid: f.centroid, normal: f.normal }]));
  ctx.writeOutput(`${out}/body.manifest.json`, JSON.stringify({ artifact: "body", tool: "fake-cad", units: "mm", volume_mm3: d.outer[0] * d.outer[1] * d.outer[2], features }, null, 2) + "\n");
  return { status: "succeeded", summary: `exported ${ctx.process ?? "no process"}` };
};

export const extract: CapabilityOperationFn = (ctx) => {
  const d = read(ctx);
  if (!d) return { status: "failed", summary: "no design" };
  const facts: ExtractedFacts = {
    frames: Object.fromEntries(d.features.map((f) => [f.interface, { origin: f.centroid, normal: f.normal }])),
    artifacts: [{ id: "body_glb", name: "Body", type: "cad", role: "body", format: "glb", units: "mm", filePath: `${ctx.module.out}/body.glb` }],
  };
  return { status: "succeeded", summary: `${d.features.length} frames`, data: facts };
};

export const check: CapabilityOperationFn = (ctx) => {
  const d = read(ctx);
  if (!d) return { status: "succeeded", summary: "not generated", diagnostics: [] };
  const have = d.features.map((f) => f.interface);
  const diagnostics = ctx.module.definition.interfaces
    .filter((i) => !have.includes(i.id))
    .map((i) => ({ code: "FAKE_CAD_DRIFT", severity: "error" as const, entity: { kind: "interface" as const, id: `${ctx.module.id}:${i.id}` }, message: `${i.id} has no feature in the box; regenerate`, source: { file: designFile(ctx) } }));
  return { status: "succeeded", summary: `${diagnostics.length} difference(s)`, diagnostics };
};
