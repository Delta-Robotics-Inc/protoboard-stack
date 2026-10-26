#!/usr/bin/env node
/**
 * Whether the UHD and UHD viewer checkouts beside this repository (the tags
 * .github/actions/workspace/action.yml pins) satisfy what the stack's
 * packages ask for. Run from the repository root after `npm ci`, with tsx
 * (the range check is core's own, `satisfies` in packages/core/src/stack.ts):
 *
 *   node --import tsx .github/scripts/siblings.mjs
 *
 * Exit 1, naming each package and range, when a checkout does not fit.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { satisfies } from "@protoboardai/core/stack";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const have = {
  "@deltarobotics/uhd": read(join(ROOT, "..", "uhd", "package.json")).version,
  "@deltarobotics/uhd-viewer": read(join(ROOT, "..", "uhd-viewer", "package.json")).version,
};
console.log(`uhd ${have["@deltarobotics/uhd"]}, uhd-viewer ${have["@deltarobotics/uhd-viewer"]}`);
let bad = 0;
for (const d of readdirSync(join(ROOT, "packages")).sort()) {
  const f = join(ROOT, "packages", d, "package.json");
  if (!existsSync(f)) continue;
  const p = read(f);
  for (const [name, version] of Object.entries(have)) {
    const range = p.dependencies?.[name] ?? p.peerDependencies?.[name];
    if (!range || range.startsWith("file:")) continue;
    if (satisfies(version, range) === false) {
      console.log(`::error::${p.name} asks for ${name} ${range}; the checkout pinned in .github/actions/workspace/action.yml is ${version}`);
      bad++;
    }
  }
}
process.exit(bad ? 1 : 0);
