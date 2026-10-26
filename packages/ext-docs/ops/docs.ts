import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OperationFn } from "@protoboardai/core";
import { buildDocs, DOC_TYPES, type DocType } from "../lib/build.ts";
import { DOCS_DIR } from "../lib/model.ts";
import { verifyDocs } from "../lib/verify.ts";

const docType = (v?: string): DocType | undefined | Error => {
  if (!v) return undefined;
  return v in DOC_TYPES ? (v as DocType) : new Error(`only must be ${Object.keys(DOC_TYPES).join(" or ")}, not "${v}"`);
};
const flag = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : !/^(false|no|0)$/i.test(v));

/**
 * tech-docs: build the datasheet and assembly guide for the project's root
 * system from its model, its CAD artifacts and docs/docspec.ts. Every file
 * the documents use is recorded as an output; run tech-docs-verify next.
 */
export const techDocs: OperationFn = async (ctx) => {
  const only = docType(ctx.inputs.only);
  if (only instanceof Error) return { status: "failed", summary: only.message };
  const report = await buildDocs(ctx.project, { only, pdf: flag(ctx.inputs.pdf, true), standins: flag(ctx.inputs.standins, true), log: ctx.log });
  const files = [...report.docs.flatMap((d) => [d.html, d.values, ...(d.pdf ? [d.pdf] : [])]), ...report.files];
  for (const f of files) ctx.writeOutput(f, readFileSync(join(ctx.project.root, f)), "technical document");
  const overflow = report.docs.filter((d) => d.overflow.length);
  return {
    status: overflow.length ? "failed" : "succeeded",
    summary: `${report.docs.map((d) => `${d.type}: ${d.pages} pages, ${d.boundValues} bound values`).join("; ")}${overflow.length ? `; page overflow in ${overflow.map((d) => d.type).join(", ")}` : ""}${report.fonts ? "" : "; no document fonts found, system monospace used"}`,
    data: report,
  };
};

/**
 * tech-docs-verify: re-resolve every bound value against the live model and
 * check units, placeholders, stand-in marking, images, layout, typography,
 * the BOM and assembly coverage. Fails on any error; writes the report and
 * page PNGs for the visual review under docs/.review/ (gitignored).
 */
export const techDocsVerify: OperationFn = async (ctx) => {
  const only = docType(ctx.inputs.only);
  if (only instanceof Error) return { status: "failed", summary: only.message };
  const findings = await verifyDocs(ctx.project, { only });
  const reportFile = `${DOCS_DIR}/.review/verify-report.json`;
  ctx.writeOutput(reportFile, readFileSync(join(ctx.project.root, reportFile)), "verification report");
  const count = (s: string) => findings.filter((f) => f.severity === s).length;
  for (const f of findings.filter((x) => x.severity !== "info")) ctx.log(`${f.severity.toUpperCase().padEnd(7)} ${f.doc} · ${f.check}${f.page ? ` · p${f.page}` : ""} — ${f.message}`);
  return {
    status: count("error") ? "failed" : "succeeded",
    summary: `${count("error")} error(s), ${count("warning")} warning(s), ${count("info")} info`,
    data: { findings },
  };
};
