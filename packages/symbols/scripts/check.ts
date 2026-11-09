#!/usr/bin/env node
/**
 * Check the pack (and the code-built samples): node packages/symbols/scripts/check.ts [--json] [--warnings]
 * Exits 1 on any error. The same checks run as a test (test/pack.test.ts).
 */
import { checkPack } from "../src/pack.ts";
import { checkSymbol, formatFindings } from "../src/check.ts";
import { SAMPLES } from "../src/generate/samples.ts";

const json = process.argv.includes("--json");
const { files, findings } = checkPack();
const generated = SAMPLES.flatMap((s) => checkSymbol(s.build()));
const all = [...findings, ...generated];
const errors = all.filter((f) => f.severity === "error");
if (json) console.log(JSON.stringify({ symbols: files.length, generatedSamples: SAMPLES.length, findings: all }, null, 2));
else {
  if (all.length) console.log(formatFindings(all));
  console.log(`${files.length} drawn symbols, ${SAMPLES.length} code-built samples: ${errors.length} errors, ${all.length - errors.length} warnings`);
}
process.exit(errors.length ? 1 : 0);
