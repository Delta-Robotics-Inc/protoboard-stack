#!/usr/bin/env node
/**
 * packages/cli/npm-shrinkwrap.json: the exact dependency tree `npm i -g
 * @protoboardai/cli` installs, so a published CLI runs with the third-party
 * versions it was tested with. npm packs the file into the CLI's tarball and
 * honours it when the CLI is installed.
 *
 * NOT COMMITTED (2026-10-25): a dependency's shrinkwrap makes npm install that
 * package's whole tree nested under it. Every project depends on the CLI
 * (devDependencies), so with a shrinkwrap a project would get a second copy of
 * core and of UHD under node_modules/@protoboardai/cli, where the stack needs
 * exactly one UHD. The script stays for a release that decides to ship one
 * (for example a CLI-only package for global installs).
 *
 *   node scripts/cli-shrinkwrap.mjs           write it
 *   node scripts/cli-shrinkwrap.mjs --check   exit 1 when it does not match the CLI's dependencies
 *
 * How: this repository's packages (and the uhd-viewer checkout beside it)
 * are packed as they would be published; a scratch project that depends on
 * the CLI's dependencies, with those tarballs in place of the stack's names,
 * is resolved by `npm install --package-lock-only` against npmjs, the same
 * resolution a user's install makes. Then every package of the stack is
 * written as the registry package it will be at this version (`resolved` on
 * npmjs, no integrity: it is not published yet). The third-party entries keep the
 * versions and integrity npm resolved.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./npm-cli.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli");
const OUT = join(CLI, "npm-shrinkwrap.json");
const check = process.argv.includes("--check");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const cli = read(join(CLI, "package.json"));

// the stack's own packages, by name → folder
const own = new Map();
for (const d of readdirSync(join(ROOT, "packages"))) {
  const f = join(ROOT, "packages", d, "package.json");
  if (existsSync(f) && read(f).name?.startsWith("@protoboardai/")) own.set(read(f).name, join(ROOT, "packages", d));
}
const viewer = resolve(ROOT, "..", "uhd-viewer");
if (existsSync(join(viewer, "package.json"))) own.set("@deltarobotics/uhd-viewer", viewer);

const tarball = (name, version) => `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;

if (check) {
  if (!existsSync(OUT)) fail("packages/cli/npm-shrinkwrap.json is missing: run node scripts/cli-shrinkwrap.mjs");
  const lock = read(OUT);
  const root = lock.packages?.[""] ?? {};
  const problems = [];
  if (lock.version !== cli.version || root.version !== cli.version) problems.push(`it is for ${lock.version}, the CLI is ${cli.version}`);
  if (JSON.stringify(root.dependencies ?? {}) !== JSON.stringify(cli.dependencies ?? {})) problems.push("its dependencies are not the CLI's");
  for (const [name, dir] of own) {
    const e = lock.packages[`node_modules/${name}`];
    if (e && e.version !== read(join(dir, "package.json")).version) problems.push(`${name} is ${e.version} in it, ${read(join(dir, "package.json")).version} here`);
  }
  if (problems.length) fail(`packages/cli/npm-shrinkwrap.json is out of date (${problems.join("; ")}): run node scripts/cli-shrinkwrap.mjs`);
  console.log(`cli-shrinkwrap: packages/cli/npm-shrinkwrap.json matches @protoboardai/cli ${cli.version} (${Object.keys(lock.packages).length - 1} packages)`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "pb-cli-shrinkwrap-"));
try {
  // each package of the stack packed as it would be published (no scripts: what is built is taken as it is)
  mkdirSync(join(tmp, "tgz"));
  const packed = new Map();
  for (const [name, dir] of own) {
    const out = runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", join(tmp, "tgz")], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    packed.set(name, `file:tgz/${JSON.parse(out)[0].filename}`);
  }
  const deps = Object.fromEntries(Object.entries(cli.dependencies).map(([n, s]) => [n, packed.get(n) ?? s]));
  const overrides = Object.fromEntries([...packed].map(([n, f]) => [n, deps[n] ? `$${n}` : f]));
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "cli-shrinkwrap", version: "0.0.0", private: true, dependencies: deps, overrides }, null, 2));
  writeFileSync(join(tmp, ".npmrc"), "registry=https://registry.npmjs.org/\n");
  runNpm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--userconfig", join(tmp, ".npmrc")], { cwd: tmp, stdio: ["ignore", "inherit", "inherit"] });
  const lock = read(join(tmp, "package-lock.json"));
  const packages = {};
  packages[""] = { name: cli.name, version: cli.version, license: cli.license, dependencies: cli.dependencies, ...(cli.bin ? { bin: cli.bin } : {}), ...(cli.engines ? { engines: cli.engines } : {}) };
  for (const [k, v] of Object.entries(lock.packages)) {
    if (!k) continue;
    const name = k.slice(k.lastIndexOf("node_modules/") + "node_modules/".length);
    if (own.has(name)) {
      // the registry package it will be: npmjs, at its version; no integrity until it is published
      const { resolved, integrity, ...rest } = v;
      packages[k] = { ...rest, resolved: tarball(name, v.version) };
    } else packages[k] = v;
  }
  const missing = ["@protoboardai/core", "@protoboardai/cloud", "@deltarobotics/uhd"].filter((n) => !packages[`node_modules/${n}`]);
  if (missing.length) fail(`the resolved tree has no ${missing.join(", ")}`);
  const leak = Object.entries(packages).filter(([, v]) => typeof v.resolved === "string" && v.resolved.startsWith("file:"));
  if (leak.length) fail(`entries still resolved from local files: ${leak.map(([k]) => k).join(", ")}`);
  const out = { name: cli.name, version: cli.version, lockfileVersion: 3, requires: true, packages };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`cli-shrinkwrap: wrote packages/cli/npm-shrinkwrap.json (${Object.keys(packages).length - 1} packages)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function fail(message) {
  console.error(`cli-shrinkwrap: ${message}`);
  process.exit(1);
}
