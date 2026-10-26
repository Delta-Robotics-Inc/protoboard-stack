/**
 * Write the committed verification summary for a part from its working notes
 * (the uhd-part-verify skill): <evidence>/verification.json.
 *
 *   npx tsx <ext-parts>/scripts/record-verification.ts <id> (--independent | --self-audit)
 *     [--auditor "<who>"] [--method "<how>"] [--repairs "<text>"] [--root <dir>]
 *
 * The record says whether the audit was independent (an agent that did not
 * author the part) or a self-audit, who ran it and how (lib/record.ts). The
 * flags may be left out when .research/audit.json states `independent`,
 * `auditor` and `method` itself; a flag that contradicts it is an error, and
 * so is an audit whose independence nobody states (exit 2).
 *
 * The evidence folder is parts/evidence/<id>/ in a project and
 * library/parts/<id>/ in the part library (lib/layout.ts). .research/ is
 * gitignored working memory; this summary is the part's committed evidence
 * record (audit counts, repairs, assumptions, open data gaps). In a project,
 * `protoboard run part-verification --input part=<id>` does the same and
 * leaves an operation record.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ModuleDef } from "@deltarobotics/uhd";
import { importPart, loadParts } from "../lib/layout.ts";
import { AuditRecordError, recordSummary, verificationRecord, type VerificationRecord } from "../lib/record.ts";

const USAGE = 'usage: npx tsx scripts/record-verification.ts <id> (--independent | --self-audit) [--auditor "<who>"] [--method "<how>"] [--repairs "<text>"] [--root <dir>]';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repairs: { type: "string" },
    root: { type: "string" },
    independent: { type: "boolean" },
    "self-audit": { type: "boolean" },
    auditor: { type: "string" },
    method: { type: "string" },
  },
});
const [id] = positionals;
if (!id || (values.independent && values["self-audit"])) {
  console.error(id ? "--independent and --self-audit contradict each other" : USAGE);
  process.exit(2);
}
const set = await loadParts(resolve(values.root ?? process.cwd()));
const f = set.files(id);
let def: ModuleDef | undefined;
try {
  def = await importPart(f);
} catch {
  def = set.defs.get(id);
}
let record: VerificationRecord;
try {
  record = verificationRecord(f, def, {
    repairs: values.repairs,
    independent: values.independent ? true : values["self-audit"] ? false : undefined,
    auditor: values.auditor,
    method: values.method,
  });
} catch (e) {
  if (!(e instanceof AuditRecordError)) throw e;
  console.error(`${id}: ${e.message}`);
  process.exit(2);
}
mkdirSync(join(f.root, f.evidence), { recursive: true });
writeFileSync(join(f.root, f.evidence, "verification.json"), JSON.stringify(record, null, 2) + "\n");
console.log(recordSummary(record));
