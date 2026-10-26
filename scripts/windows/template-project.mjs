#!/usr/bin/env node
/**
 * `protoboard init`, `check` and `build` on a project template in a folder
 * whose path has spaces: what the Windows workflow runs
 * (.github/workflows/windows.yml, docs/ci.md § Windows), and it runs the
 * same on any system.
 *
 *   node scripts/windows/template-project.mjs [template ...]     (default: drone iot wearable)
 *
 * For each template:
 *
 *   1. `protoboard init "<repo>/.scratch/win ci/my <template> project" --template <id> --no-parts`.
 *      The folder is inside this checkout so that the project finds the stack's
 *      packages in the checkout's node_modules, as the examples do; nothing is
 *      installed.
 *   2. The template's catalog parts come from a parts service, which CI has
 *      none of: the vendored parts of the reference project the template is
 *      derived from (`derivedFrom` in its template.json) are copied in, with
 *      their entries of parts/origins.json. They are the same parts, possibly
 *      at an earlier revision than the template pins.
 *   3. `protoboard check` must report no error, and `protoboard build` must
 *      write .protoboard/build/resolved.json and uhd-bundle.json.
 *
 * Every path the CLI gets has a space in it, and the commands run with the
 * project as their working directory, as a person's terminal would.
 * Exit code 1 when any template fails; the others still run.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(REPO, "packages", "cli", "bin", "protoboard.mjs");
const BASE = join(REPO, ".scratch", "win ci");
const templates = process.argv.slice(2).length ? process.argv.slice(2) : ["drone", "iot", "wearable"];

const pb = (cwd, args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
};
const tail = (text, n = 25) => text.trimEnd().split(/\r?\n/).slice(-n).join("\n");

rmSync(BASE, { recursive: true, force: true });
mkdirSync(BASE, { recursive: true });
const failed = [];
for (const id of templates) {
  const problems = [];
  const dir = join(BASE, `my ${id} project`);
  console.log(`\n== ${id}: ${dir}`);
  const template = JSON.parse(readFileSync(join(REPO, "packages", "core", "templates", id, "template.json"), "utf8"));

  const init = pb(BASE, ["init", dir, "--template", id, "--no-parts"]);
  if (init.status !== 0) problems.push(`init exited ${init.status}${init.error ? ` (${init.error.message})` : ""}:\n${tail(init.out)}`);
  for (const f of ["protoboard.config.ts", "package.json", "AGENTS.md", "src/system.uhd.ts"]) if (!existsSync(join(dir, f))) problems.push(`init did not write ${f}`);

  if (!problems.length) {
    const reference = join(REPO, template.derivedFrom, "parts");
    cpSync(join(reference, "catalog"), join(dir, "parts", "catalog"), { recursive: true });
    const theirs = JSON.parse(readFileSync(join(reference, "origins.json"), "utf8"));
    const mine = JSON.parse(readFileSync(join(dir, "parts", "origins.json"), "utf8"));
    for (const [part, origin] of Object.entries(theirs.definitions ?? {})) if (origin.tier === "catalog") mine.definitions[part] = origin;
    writeFileSync(join(dir, "parts", "origins.json"), JSON.stringify(mine, null, 2) + "\n");
    const wanted = template.catalogParts.map((p) => p.split("@")[0]);
    const missing = wanted.filter((p) => !mine.definitions[p]);
    if (missing.length) problems.push(`${template.derivedFrom} does not vendor ${missing.join(", ")}: the template's parts are no longer the reference project's`);

    const check = pb(dir, ["check"]);
    console.log(tail(check.out, 4));
    if (check.status !== 0 || !/\b0 error\(s\)/.test(check.out)) problems.push(`check exited ${check.status}:\n${tail(check.out, 40)}`);
    const json = pb(dir, ["check", "--format", "json"]);
    try {
      const report = JSON.parse(json.out);
      const errors = (report.diagnostics ?? []).filter((d) => d.severity === "error");
      if (errors.length) problems.push(`check --format json lists ${errors.length} error(s): ${errors.map((d) => d.code).join(", ")}`);
    } catch {
      problems.push(`check --format json did not print JSON:\n${tail(json.out, 10)}`);
    }

    const build = pb(dir, ["build"]);
    console.log(tail(build.out, 3));
    if (build.status !== 0) problems.push(`build exited ${build.status}:\n${tail(build.out, 40)}`);
    for (const f of ["resolved.json", "uhd-bundle.json"]) {
      const file = join(dir, ".protoboard", "build", f);
      if (!existsSync(file) || statSync(file).size < 1000) problems.push(`build did not write .protoboard/build/${f}`);
    }
  }
  if (problems.length) {
    failed.push(id);
    for (const p of problems) console.log(`${process.env.GITHUB_ACTIONS ? `::error title=${id} template in a path with spaces::` : "FAILED: "}${p.split("\n")[0]}\n${p.split("\n").slice(1).join("\n")}`);
  } else console.log(`ok: ${id} initialised, checked with no error and built in a path with spaces`);
}
if (failed.length) {
  console.log(`\n${failed.length} of ${templates.length} template(s) failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\n${templates.length} template(s) initialised, checked and built in "${BASE}"`);
rmSync(BASE, { recursive: true, force: true });
