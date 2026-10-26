#!/usr/bin/env node
/**
 * The whole test suite's result on Windows as a job summary (Markdown on
 * stdout): the counts, and every failed test with the first lines of its
 * message, grouped by file. Reads the file vitest's JSON reporter wrote
 * (.github/workflows/windows.yml). Never fails: a missing or broken file is
 * said in the summary.
 *
 *   node scripts/windows/suite-summary.mjs <vitest.json>
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const file = process.argv[2];
const lines = ["## The whole test suite on Windows", ""];
try {
  if (!file || !existsSync(file)) throw new Error(`no results file${file ? ` at ${file}` : ""}: the run stopped before vitest wrote one (see the step's log)`);
  const r = JSON.parse(readFileSync(file, "utf8"));
  const root = resolve(".");
  lines.push(`${r.numPassedTests} passed, ${r.numFailedTests} failed, ${r.numPendingTests ?? 0} skipped, in ${r.numTotalTestSuites} suites (${r.numFailedTestSuites} with a failure).`, "");
  const failedFiles = (r.testResults ?? []).filter((f) => f.status !== "passed");
  if (!failedFiles.length) lines.push("Nothing failed. Remove `continue-on-error` from the step in `.github/workflows/windows.yml` so that it is required from now on (docs/ci.md, section \"Windows\").");
  else lines.push("This step reports and does not fail the run yet (docs/ci.md, section \"Windows\").", "");
  for (const f of failedFiles) {
    const name = relative(root, f.name).split("\\").join("/");
    const failed = (f.assertionResults ?? []).filter((t) => t.status === "failed");
    lines.push(`### \`${name}\``, "");
    // a file that could not be loaded has no tests, only a message
    if (!failed.length && f.message) lines.push("```", ...String(f.message).split(/\r?\n/).slice(0, 8), "```", "");
    for (const t of failed) {
      lines.push(`- **${t.fullName ?? t.title}**`, "", "  ```", ...String((t.failureMessages ?? [])[0] ?? "").split(/\r?\n/).slice(0, 6).map((l) => `  ${l}`), "  ```", "");
    }
  }
} catch (e) {
  lines.push(`The results could not be read: ${e.message}`);
}
console.log(lines.join("\n"));
