/**
 * The `cad` capability (tool-integrations §2–§4, PB-822, PB-836):
 * `protoboard run cad:<generate|export|extract|check> --module <id>` on a
 * module whose `cad.config.ts` names @protoboardai/ext-frame-cad. Two kinds of
 * module: plates (mechanical metadata plate_thickness_mm; lib/plate.ts,
 * shared with the `frame-cad` alias) and mounting hardware (tagged fastener
 * and screw, nut, standoff or spacer; lib/hardware-cad.ts, shared with the
 * `hardware-cad` alias).
 */
import type { CapabilityContext, CapabilityOperationFn, ExtractedFacts } from "@protoboardai/core";
import { HARDWARE_KINDS, hardwareKind } from "../lib/hardware.ts";
import { exportHardware, extractHardware, generateHardware, hardwareDiagnostics, type HardwareTarget } from "../lib/hardware-cad.ts";
import { isPlateModule } from "../lib/params.ts";
import { exportPlate, extractPlate, generatePlate, plateDiagnostics, type PlateTarget } from "../lib/plate.ts";

type Target = { kind: "plate"; t: PlateTarget } | { kind: "hardware"; t: HardwareTarget };

function target(ctx: CapabilityContext): Target | string {
  const def = ctx.module.definition;
  if (ctx.project.definitions.get(def.id)?.origin.kind !== "local") return `${def.id} is not a local definition; ext-frame-cad designs local modules only (derive a local variant)`;
  const config = ctx.project.capabilities.find((b) => b.capability === "cad" && b.module === def.id)!.config;
  const binding = { dir: ctx.module.dir, native: ctx.module.native, out: ctx.module.out, constraints: ctx.constraints, process: ctx.process, config };
  if (isPlateModule(def)) return { kind: "plate", t: { def, binding } };
  if (hardwareKind(def)) return { kind: "hardware", t: { def, binding } };
  return `${def.id} is neither a plate (mechanical metadata plate_thickness_mm) nor mounting hardware (tags fastener and one of ${HARDWARE_KINDS.join(", ")}), so ext-frame-cad cannot design it`;
}

export const generate: CapabilityOperationFn = async (ctx) => {
  const x = target(ctx);
  if (typeof x === "string") return { status: "failed", summary: x };
  if (x.kind === "hardware") {
    const r = generateHardware(ctx, x.t);
    if (!r.ok) return { status: "failed", summary: r.summary, ...(r.problems ? { data: { problems: r.problems } } : {}) };
    return { status: "succeeded", summary: `${r.value.module}: ${r.value.kind} parameters in ${r.value.native}; run cad:export for the body`, data: { ...r.value, generator: "@protoboardai/ext-frame-cad/py/hardware_cad.py" } };
  }
  const t = x.t;
  const r = await generatePlate(ctx, t);
  if (!r.ok) return { status: "failed", summary: r.summary, ...(r.problems ? { data: { problems: r.problems } } : {}) };
  const stale = r.value.rebind.signatures.length + r.value.rebind.frames.length;
  return {
    status: "succeeded",
    summary: `${t.def.id}: ${Object.keys(r.value.features).length} features; ${stale ? `${stale} binding(s) changed: review, then run frame-cad-rebind after cad:export` : "all bindings still match"}`,
    data: { ...r.value, generator: "@protoboardai/ext-frame-cad/py/frame_cad.py" },
  };
};

export const exportOutputs: CapabilityOperationFn = async (ctx) => {
  const x = target(ctx);
  if (typeof x === "string") return { status: "failed", summary: x };
  if (x.kind === "hardware") {
    const r = await exportHardware(ctx, x.t);
    if (!r.ok) return { status: "failed", summary: r.summary };
    return { status: "succeeded", summary: `${r.value.module}: body.step, body.glb, body.manifest.json in ${r.value.out} (${r.value.volume_mm3} mm³)`, data: r.value };
  }
  const t = x.t;
  const r = await exportPlate(ctx, t);
  if (!r.ok) return { status: "failed", summary: r.summary };
  return { status: "succeeded", summary: `${t.def.id}: body.step, body.glb, body.manifest.json, body.dxf and ${r.value.interfaces.length} interface GLBs in ${ctx.module.out}`, data: r.value };
};

export const extract: CapabilityOperationFn = (ctx) => {
  const x = target(ctx);
  if (typeof x === "string") return { status: "failed", summary: x };
  const r = x.kind === "hardware" ? extractHardware(ctx.project.root, x.t) : extractPlate(ctx.project.root, x.t);
  if (!r.ok) return { status: "failed", summary: r.summary };
  const facts: ExtractedFacts = r.value;
  return { status: "succeeded", summary: x.kind === "hardware" ? `${facts.artifacts!.length} artifacts (a fastener's place comes from its fastener stack)` : `${Object.keys(facts.frames!).length} frames, ${facts.artifacts!.length} artifacts; re-bind with frame-cad-rebind`, data: facts };
};

export const check: CapabilityOperationFn = (ctx) => {
  const x = target(ctx);
  if (typeof x === "string") {
    return { status: "succeeded", summary: x, diagnostics: [{ code: "FRAME_CAD_NOT_A_PLATE", severity: "error", entity: { kind: "definition", id: ctx.module.id }, message: x }] };
  }
  const source = ctx.project.definitions.get(x.t.def.id)!.origin.source;
  const diagnostics = x.kind === "hardware" ? hardwareDiagnostics(ctx.project.root, x.t, source) : plateDiagnostics(ctx.project.root, x.t, source);
  return { status: "succeeded", summary: `${diagnostics.length} finding(s)`, diagnostics };
};
