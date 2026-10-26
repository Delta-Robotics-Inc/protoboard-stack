import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCheck, ProjectDiagnostic } from "@protoboardai/core";
import { validateSourcing } from "../lib/sourcing.ts";

/**
 * Every sourcing record in the project (`parts/evidence/<id>/sourcing.json`)
 * is well formed, dated, free of orders and credentials, and states its
 * disqualifiers: single source, stock under 10× the need with no alternate,
 * a lifecycle other than active, unless a named person accepted the risk.
 * Parts without a record are not reported; the record is evidence when it exists.
 */
export const sourcing: ExtensionCheck = (p) => {
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  const root = join(p.root, "parts", "evidence");
  if (!existsSync(root)) return out;
  for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const file = join(root, dir, "sourcing.json");
    if (!existsSync(file)) continue;
    const source = { file: `parts/evidence/${dir}/sourcing.json` };
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      out.push({ code: "SRC_RECORD_INVALID", severity: "error", entity: { kind: "definition", id: dir }, message: `${source.file}: ${(e as Error).message}`, source });
      continue;
    }
    const part = (record as { part?: unknown }).part;
    const id = typeof part === "string" && part ? part : dir;
    if (id !== dir) out.push({ code: "SRC_PART_MISMATCH", severity: "warning", entity: { kind: "definition", id }, message: `${source.file} is about "${id}"; evidence lives in the folder named by the part id`, source });
    for (const issue of validateSourcing(record, { knownPart: (x) => p.definitions.has(x) }))
      out.push({ code: issue.code, severity: issue.severity, entity: { kind: "definition", id }, message: `${id}: ${issue.message}`, source });
  }
  return out;
};
