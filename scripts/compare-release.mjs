#!/usr/bin/env node
/**
 * Compare a Manufacturing Package built here with the one the project's
 * committed release record describes (a reference project rebuilt on a new machine).
 *
 *   node scripts/compare-release.mjs <project dir> [version]
 *
 * The record is the newest `operations/*-release.json` git tracks; the
 * package is `release/<version>/` (default: the record's version). Every file
 * the record lists is compared by digest. The documents (PDF, index.html) and
 * manifest.json carry the source commit and its date, so they differ whenever
 * the commit does; they are reported separately and do not fail the
 * comparison. Any other difference (a BOM, an ordering list, a Gerber, a STEP,
 * a firmware file, a figure, a font) exits 1.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const [dirArg, versionArg] = process.argv.slice(2);
if (!dirArg) {
  console.error("usage: node scripts/compare-release.mjs <project dir> [version]");
  process.exit(2);
}
const root = resolve(dirArg);
const tracked = execFileSync("git", ["ls-files", "operations"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /-release\.json$/.test(f))
  .sort();
if (!tracked.length) {
  console.error(`${root}: no committed release record in operations/`);
  process.exit(2);
}
const recordFile = tracked[tracked.length - 1];
const record = JSON.parse(readFileSync(join(root, recordFile), "utf8"));
const listed = (record.outputs ?? []).filter((o) => o.path?.startsWith("release/") && o.digest);
const version = versionArg ?? /^release\/([^/]+)\//.exec(listed[0]?.path ?? "")?.[1];
const pkg = join(root, "release", version ?? "");
if (!version || !existsSync(pkg)) {
  console.error(`${root}: no release/${version ?? "<version>"}/ here; run \`npx protoboard release\` first`);
  process.exit(2);
}

const sha = (f) => "sha256:" + createHash("sha256").update(readFileSync(f)).digest("hex");
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const here = new Map(walk(pkg).map((f) => [relative(root, f).split("\\").join("/"), f]));
const commitBound = (p) => /\.(pdf|html)$/.test(p) || p.endsWith("/manifest.json");

const same = [];
const documents = [];
const differ = [];
for (const o of listed) {
  const f = here.get(o.path);
  here.delete(o.path);
  if (!f) differ.push(`missing   ${o.path}`);
  else if (sha(f) === o.digest) same.push(o.path);
  else if (commitBound(o.path)) documents.push(o.path);
  else differ.push(`differs   ${o.path}`);
}
for (const p of here.keys()) differ.push(`extra     ${p}`);

console.log(`${relative(process.cwd(), root) || "."}: release/${version} against ${recordFile} (${record.summary ?? ""})`);
console.log(`  ${same.length} file(s) identical, ${documents.length} document(s) that carry the commit differ (expected on another commit), ${differ.length} other difference(s)`);
for (const d of differ) console.log(`  ${d}`);
process.exitCode = differ.length ? 1 : 0;
