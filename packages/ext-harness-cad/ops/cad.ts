/**
 * The `cad` capability for routed wire harnesses (tool-integrations §2–§4,
 * PB-822): `protoboard run cad:<generate|export|extract|check> --module <id>`
 * on a harness whose `cad.config.ts` names @protoboardai/ext-harness-cad. The
 * work is in lib/route.ts, shared with the `harness-cad` alias.
 */
import type { CapabilityContext, CapabilityOperationFn, ExtractedFacts } from "@protoboardai/core";
import { exportHarnesses, extractHarness, harnessDiagnostics, routeHarnesses, type HarnessTarget } from "../lib/route.ts";

const target = (ctx: CapabilityContext): HarnessTarget => ({ id: ctx.module.id, binding: { dir: ctx.module.dir, native: ctx.module.native, out: ctx.module.out } });

export const generate: CapabilityOperationFn = (ctx) => {
  const r = routeHarnesses(ctx, [target(ctx)]);
  if (!r.ok) return { status: "failed", summary: r.summary, ...(r.problems ? { data: { problems: r.problems } } : {}) };
  const h = r.value.harnesses[0];
  const before = r.value.context ?? [];
  return {
    status: h.status === "failed" ? "failed" : "succeeded",
    summary: `${h.path}: ${h.status}${h.notes.length ? ` (${h.notes.join("; ")})` : ""}; routed around the parts${before.length ? ` and ${before.length} cable(s) routed before it` : ""}`,
    data: { generator: "@protoboardai/ext-harness-cad/py/harness_cad.py", ...r.value },
  };
};

export const exportOutputs: CapabilityOperationFn = (ctx) => {
  const r = exportHarnesses(ctx, [target(ctx)]);
  if (!r.ok) return { status: "failed", summary: r.summary };
  const h = r.value.harnesses[0];
  return {
    status: h.status === "failed" ? "failed" : "succeeded",
    summary: h.status === "failed" ? `${ctx.module.id}: ${h.notes.join("; ")}` : `${h.path}: body.glb, body.step${h.step === "ok" ? "" : ` (${h.step})`} and body.manifest.json in ${ctx.module.out}`,
    data: h,
  };
};

export const extract: CapabilityOperationFn = (ctx) => {
  const r = extractHarness(ctx.project.root, target(ctx));
  if (!r.ok) return { status: "failed", summary: r.summary };
  const facts: ExtractedFacts = r.value;
  return { status: "succeeded", summary: `${Object.keys(facts.frames!).length} end frames, ${facts.artifacts!.length} artifacts`, data: facts };
};

export const check: CapabilityOperationFn = (ctx) => {
  const diagnostics = harnessDiagnostics(ctx.project, ctx.module.definition, target(ctx));
  return { status: "succeeded", summary: `${diagnostics.length} finding(s)`, diagnostics };
};
