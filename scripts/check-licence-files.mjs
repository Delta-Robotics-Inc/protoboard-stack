#!/usr/bin/env node
/**
 * Licence files guard (2026-10-21): Protoboard Stack is open source under
 * Apache-2.0 (LICENSE, NOTICE, TRADEMARKS.md). This fails when a repository
 * of the stack, or a package it ships, does not say so:
 *
 *   - the repository has LICENSE (the Apache-2.0 text, unchanged), NOTICE,
 *     CONTRIBUTING.md, DCO and TRADEMARKS.md at its root;
 *   - every package.json git tracks outside tests, fixtures, evals and
 *     examples states `"license": "Apache-2.0"`;
 *   - a package that ships (it has a `files` list, or it is the VS Code
 *     extension) carries LICENSE and NOTICE: in its folder when it is not the
 *     repository root (npm packs only the package's own folder), with LICENSE
 *     identical to the root's, and named in `files` (npm always packs
 *     LICENSE, never NOTICE unless listed); the extension's .vscodeignore
 *     keeps both.
 *
 *   node scripts/check-licence-files.mjs [--root <repo>] [--package <dir>]… [--json]
 *
 * The same script checks any repository of the stack with --root
 * (this one and uhd-viewer).
 *
 * --package <dir> (repeatable; relative to --root) checks only those package
 * folders, for a repository that is not open source as a whole (one that
 * keeps a vendored copy of an Apache-2.0 package of the stack, such as the
 * client in packages/cloud, beside code under other terms). Each package states `"license": "Apache-2.0"`, has the
 * unchanged Apache-2.0 LICENSE and a NOTICE in its folder, and lists both in
 * `files`. The repository root need carry no licence, but a root package that
 * is not Apache-2.0 must be `"private": true` and ship nothing (no `files`).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LICENSE_ID = "Apache-2.0";
/** sha256 of the Apache License 2.0 text as https://www.apache.org/licenses/LICENSE-2.0.txt publishes it. */
export const APACHE_2_SHA256 = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";
export const ROOT_FILES = ["LICENSE", "NOTICE", "CONTRIBUTING.md", "DCO", "TRADEMARKS.md"];
const NOT_A_PACKAGE = /(^|\/)(test|tests|fixtures|evals|examples|node_modules|scripts\/macos)\//;

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** The problems under `root`, as `{ path, problem }`. */
export function checkLicenceFiles(root) {
  const problems = [];
  const add = (path, problem) => problems.push({ path, problem });
  for (const f of ROOT_FILES) if (!existsSync(join(root, f))) add(f, "missing at the repository root");
  if (existsSync(join(root, "LICENSE")) && sha256(join(root, "LICENSE")) !== APACHE_2_SHA256) add("LICENSE", "is not the unchanged Apache License 2.0 text");
  const rootLicense = existsSync(join(root, "LICENSE")) ? readFileSync(join(root, "LICENSE")) : undefined;
  const manifests = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "package.json", "**/package.json"], { encoding: "utf8" })
    .split("\0")
    .filter((p) => p && !NOT_A_PACKAGE.test(p));
  for (const path of manifests) {
    if (!existsSync(join(root, path))) continue;
    const m = JSON.parse(readFileSync(join(root, path), "utf8"));
    const dir = dirname(path);
    if (m.license !== LICENSE_ID) add(path, `"license" is ${JSON.stringify(m.license)}, not "${LICENSE_ID}"`);
    const isExtension = m.name === "vscode-protoboard";
    if (!Array.isArray(m.files) && !isExtension) continue; // not packed (the workspace root, the downloads site)
    for (const f of ["LICENSE", "NOTICE"]) {
      const file = join(root, dir, f);
      if (!existsSync(file)) add(join(dir, f), `missing: ${m.name} must ship it`);
      else if (f === "LICENSE" && rootLicense && !readFileSync(file).equals(rootLicense)) add(join(dir, f), "differs from the repository's LICENSE");
      if (Array.isArray(m.files) && !m.files.includes(f)) add(path, `"files" does not list ${f}`);
    }
    if (isExtension) {
      const ignore = existsSync(join(root, dir, ".vscodeignore")) ? readFileSync(join(root, dir, ".vscodeignore"), "utf8").split(/\r?\n/) : [];
      for (const f of ["LICENSE", "NOTICE"]) if (!ignore.includes(`!${f}`)) add(join(dir, ".vscodeignore"), `does not keep ${f} in the .vsix (add !${f})`);
    }
  }
  return problems;
}

/** The problems of the Apache-2.0 packages `dirs` (relative to `root`) in a repository that is not open source as a whole. */
export function checkPackageLicences(root, dirs) {
  const problems = [];
  const add = (path, problem) => problems.push({ path, problem });
  for (const dir of dirs) {
    const path = join(dir, "package.json");
    if (!existsSync(join(root, path))) {
      add(path, "missing: no package in this folder");
      continue;
    }
    const m = JSON.parse(readFileSync(join(root, path), "utf8"));
    if (m.license !== LICENSE_ID) add(path, `"license" is ${JSON.stringify(m.license)}, not "${LICENSE_ID}"`);
    if (!Array.isArray(m.files)) add(path, `no "files" list: the package would ship the whole folder`);
    for (const f of ["LICENSE", "NOTICE"]) {
      if (!existsSync(join(root, dir, f))) add(join(dir, f), `missing: ${m.name} must ship it`);
      if (Array.isArray(m.files) && !m.files.includes(f)) add(path, `"files" does not list ${f}`);
    }
    if (existsSync(join(root, dir, "LICENSE")) && sha256(join(root, dir, "LICENSE")) !== APACHE_2_SHA256) add(join(dir, "LICENSE"), "is not the unchanged Apache License 2.0 text");
  }
  // the rest of the repository keeps its own terms; what is not Apache-2.0 at the root never ships
  if (existsSync(join(root, "package.json")) && !dirs.some((d) => resolve(root, d) === resolve(root))) {
    const m = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (m.license !== LICENSE_ID) {
      if (m.private !== true) add("package.json", `${m.name} is not ${LICENSE_ID}, so it must be "private": true`);
      if (m.files !== undefined) add("package.json", `${m.name} is not ${LICENSE_ID}, so it must not ship anything (a "files" list)`);
    }
  }
  return problems;
}

function main(argv) {
  const i = argv.indexOf("--root");
  const root = resolve(i >= 0 ? argv[i + 1] : join(dirname(fileURLToPath(import.meta.url)), ".."));
  const packages = argv.flatMap((a, j) => (a === "--package" && argv[j + 1] ? [argv[j + 1]] : []));
  const problems = packages.length ? checkPackageLicences(root, packages) : checkLicenceFiles(root);
  if (argv.includes("--json")) process.stdout.write(JSON.stringify({ root, problems }, null, 2) + "\n");
  else {
    for (const p of problems) process.stderr.write(`${p.path}: ${p.problem}\n`);
    if (problems.length === 0 && packages.length) process.stdout.write(`licence files: ${packages.join(", ")} in ${root} ${packages.length === 1 ? "is" : "are"} ${LICENSE_ID}, with LICENSE and NOTICE; the root package ships nothing\n`);
    else if (problems.length === 0) process.stdout.write(`licence files: ${root} is ${LICENSE_ID}, with LICENSE and NOTICE in every package it ships\n`);
  }
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
