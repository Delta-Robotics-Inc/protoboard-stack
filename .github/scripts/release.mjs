#!/usr/bin/env node
/**
 * What the release workflow (.github/workflows/release.yml) asks of the
 * repository, in one place so it runs the same on a laptop:
 *
 *   node .github/scripts/release.mjs version [--tag v<version>]
 *       The one version every published package and the VS Code extension
 *       share. Fails when they differ, or when --tag names another version.
 *   node .github/scripts/release.mjs packages [--repository <owner/name>]
 *       The npm packages to publish, one folder per line, dependencies first
 *       (a package is published after the packages of this repository it
 *       depends on). Fails, naming each problem, when a package cannot be
 *       published to npmjs with provenance from this repository: it is
 *       private, its publishConfig names another registry, its repository
 *       is another, or its files leave out LICENSE or NOTICE.
 *   node .github/scripts/release.mjs notes <version>
 *       The changelog's section for that version (CHANGELOG.md at the root,
 *       else the first file in docs/releases/ with a "## <version>" heading).
 *   node .github/scripts/release.mjs dist-tag <version>
 *       "latest" for a release, "next" for a prerelease (1.2.0-rc.1).
 *   node .github/scripts/release.mjs stamp
 *       Writes packages/cli/build-info.json (what `protoboard --version
 *       --json` and `doctor` report for a packaged build): the commit is
 *       GITHUB_SHA, else git's HEAD.
 *
 * The published packages are the root package.json's workspaces under
 * packages/ whose name starts with @protoboardai/. The VS Code extension
 * (packages/vscode-protoboard) is not an npm package; its version is checked
 * with theirs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCOPE = "@protoboardai/";
const EXTENSION = "packages/vscode-protoboard";
const NPMJS = /^https:\/\/registry\.npmjs\.org\/?$/;

const readJson = (file) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));
const fail = (lines) => {
  for (const l of [].concat(lines)) process.stderr.write(`release: ${l}\n`);
  process.exit(1);
};
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** The workspace packages that go to npmjs, as { dir, pkg }. */
function published() {
  const root = readJson("package.json");
  return (root.workspaces ?? [])
    .filter((w) => w.startsWith("packages/"))
    .map((dir) => ({ dir, pkg: readJson(join(dir, "package.json")) }))
    .filter(({ pkg }) => typeof pkg.name === "string" && pkg.name.startsWith(SCOPE));
}

function version() {
  const all = [...published(), { dir: EXTENSION, pkg: readJson(join(EXTENSION, "package.json")) }];
  const versions = new Map();
  for (const { dir, pkg } of all) versions.set(pkg.version, [...(versions.get(pkg.version) ?? []), `${pkg.name} (${dir})`]);
  if (versions.size !== 1) fail(["the packages do not share one version:", ...[...versions].map(([v, names]) => `  ${v}: ${names.join(", ")}`)]);
  const [v] = versions.keys();
  const tag = arg("--tag");
  if (tag !== undefined && tag !== `v${v}`) fail(`the tag ${tag} is not v${v}, the version of the packages (${all.length} of them, the extension included). Tag the commit that sets the version, as v${v}.`);
  return v;
}

function packages() {
  const repository = arg("--repository") ?? process.env.GITHUB_REPOSITORY;
  const list = published();
  const problems = [];
  for (const { dir, pkg } of list) {
    const where = `${pkg.name} (${dir}/package.json)`;
    if (pkg.private) problems.push(`${where} is "private": true; npm refuses to publish it`);
    const registry = pkg.publishConfig?.registry;
    if (registry && !NPMJS.test(registry)) problems.push(`${where} has publishConfig.registry ${registry}; remove it (or name https://registry.npmjs.org/)`);
    if (pkg.license !== "Apache-2.0") problems.push(`${where} has license ${JSON.stringify(pkg.license)}, not "Apache-2.0"`);
    for (const f of ["LICENSE", "NOTICE"]) {
      if (!(pkg.files ?? []).includes(f)) problems.push(`${where} does not list ${f} in files`);
      if (!existsSync(join(ROOT, dir, f))) problems.push(`${where}: ${dir}/${f} is missing`);
    }
    if (repository) {
      // npm checks a provenance statement against the package's repository: they must name this repository
      const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
      const want = `https://github.com/${repository}`;
      const got = (url ?? "").replace(/^git\+/, "").replace(/\.git$/, "");
      if (got.toLowerCase() !== want.toLowerCase()) problems.push(`${where} has repository ${url ?? "(none)"}; provenance needs git+${want}.git`);
    }
  }
  if (problems.length) fail([`${problems.length} problem(s) stop the npm publish:`, ...problems.map((p) => `  - ${p}`)]);
  // dependencies first: each package after the packages of this repository it depends on. Only `dependencies`
  // order them: a peer can point back (ext-docs names ext-release as a peer, which depends on ext-docs)
  const names = new Map(list.map((p) => [p.pkg.name, p]));
  const order = [];
  const state = new Map();
  const visit = (p, path) => {
    if (state.get(p.pkg.name) === "done") return;
    if (state.get(p.pkg.name) === "visiting") fail(`a cycle of dependencies: ${[...path, p.pkg.name].join(" -> ")}`);
    state.set(p.pkg.name, "visiting");
    const deps = { ...(p.pkg.dependencies ?? {}), ...(p.pkg.optionalDependencies ?? {}) };
    for (const d of Object.keys(deps).sort()) if (names.has(d)) visit(names.get(d), [...path, p.pkg.name]);
    state.set(p.pkg.name, "done");
    order.push(p);
  };
  for (const p of [...list].sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))) visit(p, []);
  return order.map((p) => p.dir);
}

/** The lines of a changelog's section for `v`: from its "## <v>" heading to the next "## ". */
function section(text, v) {
  const lines = text.split(/\r?\n/);
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`^## \\[?v?${esc}\\]?(?:\\s|$)`);
  const at = lines.findIndex((l) => head.test(l));
  if (at < 0) return undefined;
  const end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end).join("\n").trim();
}

function notes(v) {
  if (!v) fail("usage: release.mjs notes <version>");
  const files = ["CHANGELOG.md", ...(existsSync(join(ROOT, "docs/releases")) ? readdirSync(join(ROOT, "docs/releases")).filter((f) => f.endsWith(".md")).sort().map((f) => `docs/releases/${f}`) : [])];
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) continue;
    const body = section(readFileSync(join(ROOT, f), "utf8"), v);
    if (body) return body;
  }
  fail(`no changelog section "## ${v}" in ${files.join(", ")}: write the release's notes there first`);
}

function stamp() {
  const v = version();
  let commit = process.env.GITHUB_SHA ?? null;
  if (!commit) {
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
      commit = null;
    }
  }
  const stamp = { schema: "protoboard.build-info/v1", version: v, commit, dirty: false, branch: null, builtAt: new Date().toISOString() };
  writeFileSync(join(ROOT, "packages/cli/build-info.json"), JSON.stringify(stamp, null, 2) + "\n");
  return `packages/cli/build-info.json: ${v} from ${commit ?? "an unknown commit"}`;
}

const [cmd, value] = process.argv.slice(2);
switch (cmd) {
  case "version":
    console.log(version());
    break;
  case "packages":
    console.log(packages().join("\n"));
    break;
  case "notes":
    console.log(notes(value));
    break;
  case "dist-tag":
    if (!value) fail("usage: release.mjs dist-tag <version>");
    console.log(value.includes("-") ? "next" : "latest");
    break;
  case "stamp":
    console.log(stamp());
    break;
  default:
    fail("usage: release.mjs version [--tag v<version>] | packages [--repository <owner/name>] | notes <version> | dist-tag <version> | stamp");
}
