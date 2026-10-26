/**
 * The `cad` capability for a project-researched part whose body a
 * build123d script draws (lib/part-cad.ts): `protoboard run
 * cad:<generate|export|extract|check> --module <id>` on a part whose
 * `cad.config.ts` names @protoboardai/ext-parts.
 */
import type { CapabilityContext, CapabilityOperationFn, ExtractedFacts } from "@protoboardai/core";
import { exportPart, extractPart, generatePart, partCadDiagnostics, type PartCadTarget } from "../lib/part-cad.ts";

function target(ctx: CapabilityContext): PartCadTarget | string {
  const def = ctx.module.definition;
  const rec = ctx.project.definitions.get(def.id);
  if (rec?.origin.kind !== "local") return `${def.id} is not a local definition; a catalog part's body comes with its revision`;
  const config = ctx.project.capabilities.find((b) => b.capability === "cad" && b.module === def.id)!.config;
  return { def, binding: { dir: ctx.module.dir, native: ctx.module.native, out: ctx.module.out, constraints: ctx.constraints, config } };
}

export const generate: CapabilityOperationFn = async (ctx) => {
  const t = target(ctx);
  if (typeof t === "string") return { status: "failed", summary: t };
  const r = await generatePart(ctx, t);
  if (!r.ok) return { status: "failed", summary: r.summary };
  const n = r.value.rebind.length;
  return {
    status: "succeeded",
    summary: `${t.def.id}: ${Object.keys(r.value.features).length} features from ${r.value.generator}; ${n ? `${n} bound signature(s) differ: copy them from the manifest into the part after cad:export` : "every bound signature matches"}`,
    data: r.value,
  };
};

export const exportOutputs: CapabilityOperationFn = async (ctx) => {
  const t = target(ctx);
  if (typeof t === "string") return { status: "failed", summary: t };
  const r = await exportPart(ctx, t);
  if (!r.ok) return { status: "failed", summary: r.summary };
  return { status: "succeeded", summary: `${t.def.id}: body.step, body.glb, body.manifest.json${r.value.interfaces.length ? ` and ${r.value.interfaces.length} interface GLBs` : ""} in ${r.value.out}`, data: r.value };
};

export const extract: CapabilityOperationFn = (ctx) => {
  const t = target(ctx);
  if (typeof t === "string") return { status: "failed", summary: t };
  const r = extractPart(ctx.project.root, t);
  if (!r.ok) return { status: "failed", summary: r.summary };
  const facts: ExtractedFacts = r.value;
  return { status: "succeeded", summary: `${facts.artifacts!.length} artifacts`, data: facts };
};

export const check: CapabilityOperationFn = (ctx) => {
  const t = target(ctx);
  if (typeof t === "string") return { status: "succeeded", summary: t, diagnostics: [{ code: "PART_CAD_NOT_LOCAL", severity: "error", entity: { kind: "definition", id: ctx.module.id }, message: t }] };
  const diagnostics = partCadDiagnostics(ctx.project.root, t, ctx.project.definitions.get(t.def.id)!.origin.source);
  return { status: "succeeded", summary: `${diagnostics.length} finding(s)`, diagnostics };
};
