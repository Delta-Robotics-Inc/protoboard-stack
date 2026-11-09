#!/usr/bin/env node
/**
 * Rewrite every pack file in the canonical form: node packages/symbols/scripts/format.ts [--check]
 * With --check it only lists the files that are not canonical (exit 1 when any).
 */
import { writeFileSync } from "node:fs";
import { formatSymbol } from "../src/format.ts";
import { PACK_DIR, readPack } from "../src/pack.ts";

const check = process.argv.includes("--check");
const off = readPack().filter((f) => formatSymbol(f.def) !== f.text);
for (const f of off) {
  if (check) console.log(`not canonical: ${f.file}`);
  else writeFileSync(PACK_DIR + f.file, formatSymbol(f.def));
}
console.log(check ? `${off.length} files not canonical` : `rewrote ${off.length} files`);
process.exit(check && off.length ? 1 : 0);
