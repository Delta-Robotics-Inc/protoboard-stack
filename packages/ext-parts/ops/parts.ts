import type { OperationFn } from "@protoboardai/core";
import { projectParts } from "../lib/layout.ts";
import { AuditRecordError, recordSummary, verificationRecord, type VerificationRecord } from "../lib/record.ts";
import { formatReport, mateList, verifyPart } from "../lib/verify.ts";

const partInput = (inputs: Record<string, string>) => inputs.part?.trim();

/**
 * part-verify: the uhd-part-verify skill's automated checks (stage 1) on one
 * of the project's definitions, with its evidence in parts/evidence/<id>/.
 * Pure: it reads, and reports. Fails when any error is found.
 */
export const partVerify: OperationFn = (ctx) => {
  const id = partInput(ctx.inputs);
  if (!id) return { status: "failed", summary: "give the part: --input part=<id>" };
  const set = projectParts(ctx.project);
  const def = set.defs.get(id);
  if (!def) return { status: "failed", summary: `the project declares no definition "${id}"` };
  const rec = ctx.project.definitions.get(id)!;
  if (rec.origin.kind !== "local") return { status: "failed", summary: `${id} is a ${rec.origin.kind} definition; its evidence travels with its catalog revision (verify it where it is authored)` };
  const report = verifyPart(set, def, mateList(ctx.inputs.mate ? [ctx.inputs.mate] : []), { allMates: ctx.inputs.all?.trim() === "true" });
  for (const line of formatReport(report, def)) ctx.log(line);
  return {
    status: report.errors.length ? "failed" : "succeeded",
    summary: report.errors.length ? `${id}: ${report.errors.length} error(s), ${report.warnings.length} warning(s)` : `${id}: 0 errors, ${report.warnings.length} warning(s)`,
    data: report,
  };
};

/**
 * part-verification: write parts/evidence/<id>/verification.json from the
 * gitignored working notes (.research/audit.json, gaps.json) and the part's
 * traits, after the audit (uhd-part-verify stage 2). `--input
 * independent=true|false` (or audit.json's `independent`) says whether an
 * agent that did not author the part ran it; `auditor` and `method` say who
 * and how (lib/record.ts).
 */
export const partVerification: OperationFn = (ctx) => {
  const id = partInput(ctx.inputs);
  if (!id) return { status: "failed", summary: "give the part: --input part=<id>" };
  const set = projectParts(ctx.project);
  const def = set.defs.get(id);
  if (!def) return { status: "failed", summary: `the project declares no definition "${id}"` };
  const f = set.files(id);
  const flag = ctx.inputs.independent?.trim().toLowerCase();
  if (flag !== undefined && !["true", "false"].includes(flag)) return { status: "failed", summary: "independent must be true or false" };
  let record: VerificationRecord;
  try {
    record = verificationRecord(f, def, {
      repairs: ctx.inputs.repairs,
      independent: flag === undefined ? undefined : flag === "true",
      auditor: ctx.inputs.auditor,
      method: ctx.inputs.method,
    });
  } catch (e) {
    if (e instanceof AuditRecordError) return { status: "failed", summary: `${id}: ${e.message}` };
    throw e;
  }
  ctx.writeOutput(`${f.evidence}/verification.json`, JSON.stringify(record, null, 2) + "\n", `${id}: verification record`);
  return { status: "succeeded", summary: recordSummary(record), data: record };
};
