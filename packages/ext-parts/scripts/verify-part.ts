/**
 * Automated verification for one purchased part (the uhd-part-verify skill,
 * stage 1), in a Protoboard project or in the part library:
 *
 *   npx tsx <ext-parts>/scripts/verify-part.ts <id> [--mate <id>[,<id>…]]… [--all]
 *     [--refetch] [--no-typecheck] [--json] [--root <dir>]
 *
 * --root (default: the current directory) is a project (protoboard.config.ts:
 * the part is any local definition, evidence in parts/evidence/<id>/) or a
 * library (library/parts/index.ts: library/parts/<id>.ts and
 * library/parts/<id>/). The part's own file is imported fresh, so
 * defineModule runs on it, and the root is typechecked with its own tsc (type
 * errors in the part's files are errors; --no-typecheck skips it). In a
 * library, the part's source closure (its file and the library modules it
 * imports) is linted as library source (lib/source-lint.ts, PB-910). Each --mate
 * (a list, comma-separated or repeated) runs validatePair against another
 * part of the same root; --all tries every other part and reports the pairs
 * that form a connection. --refetch downloads every sha256-pinned source in
 * sources.json again and compares the bytes (lib/refetch.ts): a changed or
 * unreachable file is a warning; an HTML page that differs (most pages do on
 * every request) is listed for a re-read of its text. Exits 1 when any error is found, 2 on bad
 * usage. In a project, `protoboard run part-verify --input part=<id>` runs
 * the same checks without the typecheck and the re-fetch.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ModuleDef } from "@deltarobotics/uhd";
import { importPart, loadParts } from "../lib/layout.ts";
import { formatRefetch, refetchSources, type RefetchResult } from "../lib/refetch.ts";
import { lintPartSource } from "../lib/source-lint.ts";
import { typecheckPart } from "../lib/typecheck.ts";
import { formatReport, verifyPart, type Finding } from "../lib/verify.ts";

const USAGE = "usage: npx tsx scripts/verify-part.ts <id> [--mate <id>[,<id>…]]… [--all] [--refetch] [--no-typecheck] [--json] [--root <dir>]";
let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: {
      mate: { type: "string", multiple: true },
      all: { type: "boolean" },
      refetch: { type: "boolean" },
      typecheck: { type: "boolean", default: true },
      json: { type: "boolean" },
      root: { type: "string" },
    },
  });
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`);
  process.exit(2);
}
const { values, positionals } = parsed;
const [id] = positionals;
if (!id) {
  console.error(USAGE);
  process.exit(2);
}

const set = await loadParts(resolve(values.root ?? process.cwd()));
let def: ModuleDef;
try {
  if (set.layout === "project" && !set.defs.has(id)) throw new Error(`the project declares no definition "${id}" (is its file in the config's sources?)`);
  def = await importPart(set.files(id));
} catch (e) {
  console.error(`error [load] ${(e as Error).message}`);
  process.exit(1);
}

const extra: Finding[] = [];
if (values.typecheck) for (const t of typecheckPart(set.files(id))) extra.push({ level: t.level, check: "typecheck", message: t.message });
// library parts ship their source (PB-910): it must pass UHD's lint for library source
for (const t of lintPartSource(set.files(id))) extra.push({ level: t.level, check: "source", message: t.message });
let refetch: RefetchResult[] | undefined;
if (values.refetch) {
  refetch = await refetchSources(set.files(id));
  for (const r of refetch) {
    if (r.status === "changed") extra.push({ level: "warning", check: "refetch", message: `${r.id}: the source now serves other bytes (${r.detail}); re-check the facts it supports, then update its sha256 (${r.url})` });
    if (r.status === "failed") extra.push({ level: "warning", check: "refetch", message: `${r.id}: could not re-fetch (${r.detail}); the pinned download is the evidence (${r.url})` });
  }
}

const report = verifyPart(set, def, values.mate ?? [], { allMates: values.all, extra });
if (values.json) {
  const { findings: _ordered, ...rest } = report;
  console.log(JSON.stringify({ ...rest, ...(refetch ? { refetch } : {}) }, null, 2));
} else {
  const lines = formatReport(report, def);
  if (refetch) lines.splice(lines.length - 1, 0, ...formatRefetch(refetch));
  for (const line of lines) console.log(line);
}
process.exit(report.errors.length ? 1 : 0);
