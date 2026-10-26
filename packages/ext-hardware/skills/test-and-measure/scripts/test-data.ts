/**
 * Validate test-data files (UHD tech-docs convention, schema uhd-test-data/1:
 * @protoboardai/ext-docs skills/uhd-tech-docs/templates/test-data.schema.json).
 *
 *   npx tsx <this file> <file-or-dir> [--replaces <standin-file-or-dir>] [--json]
 *
 * Checks every <id>.json: required fields, id == file name, status
 * standin|measured, measured files carry provenance.date (and operator or
 * instruments), rows match the columns, units present, no placeholder zeros
 * left in a measured file's summary. With --replaces, a measured file must
 * keep the stand-in's id, column ids and units so documents pick it up
 * unchanged. Exit 1 on any error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

interface TestData {
  id: string;
  title: string;
  status: "standin" | "measured";
  subject: { system: string; modules?: string[] };
  conditions: { name: string; value: number | string; unit: string }[];
  provenance: { method: string; date?: string; operator?: string; instruments?: string[]; rawFiles?: string[]; derivedFrom?: string[]; assumptions?: string[] };
  columns: { id: string; label: string; unit: string }[];
  rows: (number | string)[][];
  summary: { id: string; label: string; value: number | string; unit: string }[];
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const replacesAt = args.indexOf("--replaces");
const replaces = replacesAt >= 0 ? args[replacesAt + 1] : undefined;
const target = args.find((a, k) => !a.startsWith("--") && (replacesAt < 0 || k !== replacesAt + 1));
if (!target) throw new Error("usage: test-data.ts <file-or-dir> [--replaces <standin-file-or-dir>] [--json]");

const files = (path: string) => (statSync(path).isDirectory() ? readdirSync(path).filter((f) => f.endsWith(".json")).sort().map((f) => join(path, f)) : [path]);

function validate(file: string): string[] {
  const errs: string[] = [];
  let d: TestData;
  try {
    d = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return [`not JSON: ${(e as Error).message}`];
  }
  for (const k of ["id", "title", "status", "subject", "conditions", "provenance", "columns", "rows", "summary"] as const) if (d[k] === undefined) errs.push(`missing ${k}`);
  if (errs.length) return errs;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(d.id)) errs.push(`id "${d.id}" must be kebab-case`);
  if (d.id !== basename(file, ".json")) errs.push(`id "${d.id}" must equal the file name`);
  if (d.status !== "standin" && d.status !== "measured") errs.push(`status must be standin or measured, not "${d.status}"`);
  if (!d.subject.system) errs.push("subject.system is required");
  if (!d.provenance.method) errs.push("provenance.method is required");
  if (!d.columns.length) errs.push("at least one column");
  for (const c of [...d.columns, ...d.summary, ...d.conditions]) if (typeof c.unit !== "string") errs.push(`"${"id" in c ? c.id : c.name}" has no unit (use "" for text)`);
  d.rows.forEach((r, k) => {
    if (r.length !== d.columns.length) errs.push(`row ${k} has ${r.length} values for ${d.columns.length} columns`);
  });
  if (d.status === "measured") {
    if (!d.provenance.date || !/^\d{4}-\d\d-\d\d/.test(d.provenance.date)) errs.push("a measured file needs provenance.date (ISO date of the test)");
    if (!d.provenance.operator && !d.provenance.instruments?.length) errs.push("a measured file needs provenance.operator or provenance.instruments");
    if (/EXAMPLE ONLY/i.test(d.provenance.method)) errs.push("provenance.method is still the template's EXAMPLE ONLY text");
    if (d.summary.length && d.summary.every((s) => s.value === 0)) errs.push("every summary value is 0: template placeholders, not measurements");
    if (d.provenance.derivedFrom?.length) errs.push("a measured file must not carry derivedFrom (that is stand-in provenance)");
  } else if (!d.provenance.derivedFrom?.length) {
    errs.push("a stand-in needs provenance.derivedFrom (the model queries it was derived from)");
  }
  return errs;
}

function compare(measured: string, standin: string): string[] {
  const m = JSON.parse(readFileSync(measured, "utf8")) as TestData;
  const s = JSON.parse(readFileSync(standin, "utf8")) as TestData;
  const errs: string[] = [];
  if (m.id !== s.id) errs.push(`id ${m.id} vs stand-in ${s.id}`);
  const cols = (d: TestData) => d.columns.map((c) => `${c.id}[${c.unit}]`).join(", ");
  if (cols(m) !== cols(s)) errs.push(`columns ${cols(m)} vs stand-in ${cols(s)}`);
  const sums = (d: TestData) => new Map(d.summary.map((x) => [x.id, x.unit]));
  for (const [id, unit] of sums(s)) if (sums(m).get(id) !== unit) errs.push(`summary ${id} [${unit}] missing or in other units`);
  return errs;
}

const results = files(target).map((f) => {
  const errors = validate(f);
  if (replaces && !errors.length) {
    const other = statSync(replaces).isDirectory() ? join(replaces, basename(f)) : replaces;
    if (existsSync(other)) errors.push(...compare(f, other).map((e) => `replaces ${other}: ${e}`));
    else errors.push(`no stand-in ${other} to replace`);
  }
  return { file: f, status: (() => { try { return JSON.parse(readFileSync(f, "utf8")).status; } catch { return undefined; } })(), errors };
});

if (json) console.log(JSON.stringify(results, null, 2));
else for (const r of results) console.log(`${r.errors.length ? "FAIL" : "ok  "} ${r.file} (${r.status ?? "?"})${r.errors.map((e) => `\n       ${e}`).join("")}`);
process.exitCode = results.some((r) => r.errors.length) ? 1 : 0;
