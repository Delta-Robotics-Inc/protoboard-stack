import { loadProject, operationRecordFile, runCapabilityOperation, runCapabilityStep, type OperationFn, type OperationRecord } from "@protoboardai/core";
import { projectAssembly, wireHarnesses } from "../lib/job.ts";
import { PROVIDER, harnessBinding, harnessFiles, routeHarnesses, type HarnessTarget, type RouteResult } from "../lib/route.ts";

const GENERATOR_ID = "@protoboardai/ext-harness-cad/py/harness_cad.py";

/** One harness's step, as the alias reports it. */
interface AliasStep {
  module: string;
  operation: string;
  status: OperationRecord["status"];
  summary: string;
  /** The step's operation record (project-relative). */
  record: string;
  outputs: string[];
}
const aliasStep = (module: string, r: OperationRecord): AliasStep => ({ module, operation: r.operation, status: r.status, summary: r.summary, record: operationRecordFile(r), outputs: r.outputs.map((o) => o.path) });

export { GENERATOR, python } from "../lib/route.ts";

/**
 * harness-cad: the `cad` capability's generate and export for every wire
 * harness (or the named ones), in one routing run. Each harness needs a
 * `cad.config.ts` naming @protoboardai/ext-harness-cad; its route goes to
 * `<dir>/harness-cad/route.json` and its bodies to `<dir>/out/`, exactly as
 * `protoboard run cad:generate` and `cad:export --module <id>` write them,
 * and each is recorded as that harness's own `cad:generate` and `cad:export`
 * run, so the release traces every cable's `out/` (the alias's own record
 * writes nothing and lists them). The routes are written first; the project
 * is then loaded anew, so each export records the harness as its new route
 * makes it.
 * The `routes` check and each harness's `cad:check` then confirm that every
 * routed end still meets its part.
 */
export const harnessCad: OperationFn = async (ctx) => {
  const p = ctx.project;
  if (!p.rootDef) return { status: "failed", summary: "the project has no root system" };
  const only = ctx.inputs.harness?.split(",").map((s) => s.trim()).filter(Boolean);
  const found = wireHarnesses(projectAssembly(p), only);
  if (!found.length) return { status: "failed", summary: only?.length ? `no wire harness ${only.join(", ")} (definition id or instance path) with a cable_build trait` : "no wire harness with a cable_build trait to route" };
  const targets: HarnessTarget[] = [];
  const unbound: string[] = [];
  for (const inst of found) {
    if (targets.some((t) => t.id === inst.def.id)) continue;
    const binding = harnessBinding(p, inst.def.id);
    if (binding) targets.push({ id: inst.def.id, binding });
    else unbound.push(`${inst.path.join("/")} (${inst.def.id}) has no cad.config.ts naming ${PROVIDER}; add one in its provider directory, e.g. src/harnesses/${inst.def.id}/cad.config.ts: export default defineCapabilityConfig({ provider: "${PROVIDER}", module: "${inst.def.id}" })`);
  }
  if (!targets.length) return { status: "failed", summary: unbound[0], data: { problems: unbound } };

  // one routing run over every target, held in memory; then each target's route is written by its own cad:generate step
  const held = new Map<string, { content: string | Buffer; description?: string }>();
  const routed = routeHarnesses({ project: p, log: ctx.log, writeOutput: (path, content, description) => held.set(path, { content, description }) }, targets);
  if (!routed.ok) return { status: "failed", summary: routed.summary, data: { problems: [...(routed.problems ?? []), ...unbound] } };
  const steps: AliasStep[] = [];
  const generated = new Set<string>();
  for (const r of routed.value.harnesses) {
    const t = targets.find((x) => x.id === r.id)!;
    const rec = await runCapabilityStep(p, "cad", "generate", t.id, (sctx) => {
      const route = harnessFiles(t.binding).route;
      const file = held.get(route);
      if (r.status === "failed" || !file) return { status: "failed", summary: `${r.path}: failed${r.notes.length ? ` (${r.notes.join("; ")})` : ""}`, data: { generator: GENERATOR_ID, harnesses: [r] } };
      sctx.writeOutput(route, file.content, file.description);
      return { status: "succeeded", summary: `${r.path}: ${r.status}${r.notes.length ? ` (${r.notes.join("; ")})` : ""}; routed in one run with ${targets.length - 1} other cable(s) (run harness-cad)`, data: { generator: GENERATOR_ID, harnesses: [r], problems: routed.value.problems } };
    });
    steps.push(aliasStep(t.id, rec));
    if (rec.status === "succeeded") generated.add(t.id);
  }
  // the routes just written are what each harness definition reads (routedHarness): export from the project as it is now
  const now = generated.size ? await loadProject(p.root, { checks: false, fresh: true }) : p;
  const exported = new Map<string, RouteResult>();
  for (const t of targets.filter((x) => generated.has(x.id))) {
    const rec = await runCapabilityOperation(now, "cad", "export", t.id);
    steps.push(aliasStep(t.id, rec));
    if (rec.status === "succeeded") exported.set(t.id, rec.data as RouteResult);
  }

  const results = routed.value.harnesses.map((r) => {
    const e = exported.get(r.id);
    if (e) return { ...e, search_s: r.search_s };
    return generated.has(r.id) ? { ...r, status: "failed" as const, notes: [...r.notes, "export failed (see its cad:export record)"] } : r;
  });
  const failed = results.filter((h) => h.status === "failed");
  const warned = results.filter((h) => h.status === "warning");
  const problems = [...routed.value.problems, ...unbound];
  return {
    status: failed.length === results.length ? "failed" : "succeeded",
    summary: `${results.length - failed.length}/${results.length} harness(es) routed and exported, each with its cad:generate and cad:export record${warned.length ? `; ${warned.length} with warnings (${warned.map((h) => h.path).join(", ")})` : ""}${failed.length ? `; failed: ${failed.map((h) => h.path).join(", ")}` : ""}${problems.length ? `; ${problems.length} problem(s) in the model` : ""}`,
    data: { generator: GENERATOR_ID, problems, map: routed.value.map, harnesses: results, outputs: Object.fromEntries(targets.map((t) => [t.id, t.binding.dir])), steps },
  };
};
