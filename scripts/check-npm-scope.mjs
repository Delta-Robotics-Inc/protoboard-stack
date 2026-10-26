#!/usr/bin/env node
/**
 * npm scope guard (PB-941): the stack's packages are `@protoboardai/…`. The
 * `@protoboard` organisation on npmjs belongs to someone else, so a machine
 * without the private-registry line in its npm configuration could install
 * that owner's code under a name written `@protoboard/…`. The scope was
 * renamed on 2026-10-06, before 0.1.1 was published. This fails on the old
 * scope (`@protoboard/…`, `@protoboard:registry=`, a quoted or escaped
 * `@protoboard`) in any text file git tracks, as it is in the working tree.
 * Other scopes that only start the same way are not it (`@protoboardai`,
 * `@protoboard-test`, an address `…@protoboard-cloud.iam…`).
 *
 *   node scripts/check-npm-scope.mjs [--root <repo>] [--allowlist <file>] [--json]
 *
 * The allowlist (default `<root>/scripts/npm-scope-allowlist.json` when it
 * exists) names each class of occurrence kept on purpose, with its reason:
 * records of what ran under the old names, the 0.1.0 release notes, and the
 * code that recognises the old scope to explain the rename. Its entries are
 * those of the brand-spelling guard (`path` with `*` and `**`, optional
 * `contains` on the same line, `reason`); an entry that keeps nothing fails.
 * Binary files are not read (a generated .glb may carry its generator's name).
 * The same script checks any repository of the stack with --root.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findPattern } from "./check-brand-spelling.mjs";

export const NEW_SCOPE = "@protoboardai";
/** The old scope as a whole word: not `@protoboardai`, `@protoboard-test`, `…@protoboard-cloud.iam…` or an address at protoboard.ai (`trademarks@protoboard.ai`). */
export const OLD_SCOPE = /(?<![\w.+-])@protoboard(?![\w-])/;

/** Every occurrence of the old scope under `root` that the allowlist does not keep. */
export const findOldScope = (root, allowlist = { entries: [] }, allowlistPath) => findPattern(root, OLD_SCOPE, allowlist, allowlistPath);

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(arg("--root") ?? join(here, ".."));
  const listPath = arg("--allowlist") ?? join(root, "scripts", "npm-scope-allowlist.json");
  const allowlist = existsSync(listPath) ? JSON.parse(readFileSync(listPath, "utf8")) : { entries: [] };
  const { found, unused } = findOldScope(root, allowlist, listPath);
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ root, found, unused }, null, 2) + "\n");
  } else {
    for (const f of found) process.stderr.write(`${f.path}:${f.line}: the npm scope is ${NEW_SCOPE}, not @protoboard (PB-941): ${f.text}\n`);
    for (const e of unused) process.stderr.write(`allowlist entry no longer matches anything, remove it: ${e.path}${e.contains ? ` (${e.contains})` : ""}\n`);
    if (found.length === 0 && unused.length === 0) process.stdout.write(`npm scope: no @protoboard outside ${NEW_SCOPE} in ${root} (${(allowlist.entries ?? []).length} kept on purpose)\n`);
  }
  return found.length === 0 && unused.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
