/**
 * The frame-cad and hardware-cad aliases run `cad:generate` then
 * `cad:export` for each module through core, so every module gets the
 * operation records its own runs would give it: the release traces each
 * module's `out/` to its own `cad:export` record (PB-836). The alias's own
 * record writes nothing; it lists the records it made.
 *
 * Every module is generated first; the project is then loaded anew, so each
 * export records the module as its generated design leaves it.
 */
import { loadProject, operationRecordFile, runCapabilityOperation, type OperationRecord, type Project } from "@protoboardai/core";

/** One module's step, as the alias reports it. */
export interface AliasStep {
  module: string;
  operation: string;
  status: OperationRecord["status"];
  summary: string;
  /** The step's operation record (project-relative). */
  record: string;
  outputs: string[];
}

export const aliasStep = (module: string, r: OperationRecord): AliasStep => ({
  module,
  operation: r.operation,
  status: r.status,
  summary: r.summary,
  record: operationRecordFile(r),
  outputs: r.outputs.map((o) => o.path),
});

export type AliasRun =
  | { ok: true; steps: AliasStep[]; generated: Map<string, OperationRecord>; exported: Map<string, OperationRecord> }
  | { ok: false; summary: string; module: string; steps: AliasStep[]; problems?: unknown };

/** `cad:generate` for every module, then `cad:export` for every module, each recorded as its own run. */
export async function generateThenExport(p: Project, modules: string[]): Promise<AliasRun> {
  const steps: AliasStep[] = [];
  const generated = new Map<string, OperationRecord>();
  const exported = new Map<string, OperationRecord>();
  for (const id of modules) {
    const r = await runCapabilityOperation(p, "cad", "generate", id);
    steps.push(aliasStep(id, r));
    if (r.status !== "succeeded") return { ok: false, summary: r.summary, module: id, steps, problems: (r.data as { problems?: unknown } | undefined)?.problems };
    generated.set(id, r);
  }
  // generate may write what a definition reads: export from the project as it is now
  const now = await loadProject(p.root, { checks: false, fresh: true });
  for (const id of modules) {
    const r = await runCapabilityOperation(now, "cad", "export", id);
    steps.push(aliasStep(id, r));
    if (r.status !== "succeeded") return { ok: false, summary: r.summary, module: id, steps };
    exported.set(id, r);
  }
  return { ok: true, steps, generated, exported };
}
