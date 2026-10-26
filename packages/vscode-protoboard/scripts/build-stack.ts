#!/usr/bin/env -S npx tsx
/**
 * `npm run build:stack` (PB-929): the stack the .vsix carries, in dist/stack/.
 *
 * It is the stack as npm would install it for a project that uses every
 * extension: the nineteen packages (packed from this workspace's checkouts;
 * UHD from npmjs, where its release is) and everything they depend on, in one
 * `node_modules` tree with one copy of UHD. docs/specs/distribution.md says
 * why it is carried this way and what a project does with it.
 *
 *   dist/stack/stack.json            what is carried: version, packages, platforms, sizes, digest, and the build
 *                                    (the protoboard-stack commit, dirty, branch: build-info.ts), which the CLI
 *                                    package carries too, as build-info.json
 *   dist/stack/stack.pbar.br         the tree, without native modules (src/pbar.ts is the format)
 *   dist/stack/native-<os>-<cpu>.pbar.br   the native modules of one platform (esbuild, resvg)
 *
 *   tsx scripts/build-stack.ts [--platforms linux-x64,darwin-arm64,…] [--quality 9] [--keep] [--workspace <dir>]
 *
 *   --platforms  the platforms whose native modules are carried (default: the six below).
 *                Fewer platforms make a smaller .vsix that works only on those.
 *   --quality    Brotli quality, 0-11 (default 9; 11 is about 8 % smaller and takes many minutes)
 *   --keep       keep the staging folder (.stack-build/) to look at
 *   --workspace  the folder holding uhd-viewer/ beside this repository
 *
 * Needs the web viewer and the UHD viewer built (the root `npm install` does both) and the npm registry
 * (npmjs) for the third-party packages. Nothing is published and no checkout is changed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BUILD_INFO, gitStamp, type BuildStamp } from "@protoboardai/core/build-info";
import { buildVersion } from "../../../scripts/build-version.mjs";
// npm as this Node with npm-cli.js: no npm.cmd, which Node does not start without a shell on Windows (PB-1047)
import { npmCommand } from "../../../scripts/npm-cli.mjs";
import { entriesOf, pack } from "../src/pbar.js";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(here, "..", "..");
const { values } = parseArgs({ options: { platforms: { type: "string" }, quality: { type: "string" }, keep: { type: "boolean" }, workspace: { type: "string" }, help: { type: "boolean", short: "h" } } });
if (values.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
const workspace = resolve(values.workspace ?? join(repo, ".."));
/** The platforms VS Code desktop and its remote servers run on with glibc. Alpine (musl) is not carried. */
const DEFAULT_PLATFORMS = ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64", "win32-x64", "win32-arm64"];
const platforms = (values.platforms ?? DEFAULT_PLATFORMS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const quality = Number(values.quality ?? 9);
const host = `${process.platform}-${process.arch}`;
const npm = "npm";
/** Windows' own tar (bsdtar), which reads C:\ paths: Git Bash's GNU tar, first on PATH there, takes "C:" for a remote host. */
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const NPMJS = "https://registry.npmjs.org/";
const say = (s: string) => console.log(`[stack] ${s}`);
const run = (cmd: string, args: string[], cwd: string, quiet = true) => {
  const c = cmd === npm ? npmCommand(args) : { command: cmd, args, shell: false };
  return execFileSync(c.command, c.args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", quiet ? "pipe" : "inherit"], shell: c.shell, maxBuffer: 64 << 20 });
};

/**
 * Dependencies left out of the CARRIED copies' manifests, because the files
 * these packages ship never load them in Node:
 *
 * - The viewers ship built browser bundles; their browser-only dependencies
 *   are inside those bundles already.
 *
 * (@protoboardai/cloud, packages/cloud, has no dependencies at all.)
 *
 * Whatever another package still needs stays: only the edge is removed, npm
 * decides the rest. This took the tree from about 500 MB to about 330 MB.
 * The packages published to a registry are not changed.
 */
const NOT_CARRIED: Record<string, string[]> = {
  "@deltarobotics/uhd-viewer": ["lucide-react", "@xyflow/react", "@radix-ui/react-scroll-area", "@types/three", "react-dom"],
  "@protoboardai/web-viewer": ["lucide-react", "@xyflow/react", "@radix-ui/react-scroll-area", "react-dom"],
  "@protoboardai/views": ["@radix-ui/react-select"],
};

const stage = join(here, ".stack-build");
const out = join(here, "dist", "stack");
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "tgz"), { recursive: true });
// npm must not read a user or project configuration that points the stack's scopes somewhere else
const npmrc = join(stage, "npmrc");
writeFileSync(npmrc, `registry=${NPMJS}\nlegacy-peer-deps=true\n`);
const npmArgs = ["--userconfig", npmrc, "--registry", NPMJS];

// ---- 1. the nineteen packages, as tarballs
const core = JSON.parse(readFileSync(join(repo, "packages", "core", "package.json"), "utf8")) as { version: string; protoboard: { toolchain: { uhd: string } } };
const dirs = [
  join(workspace, "uhd-viewer"),
  ...readdirSync(join(repo, "packages"))
    .map((d) => join(repo, "packages", d))
    .filter((d) => existsSync(join(d, "package.json")) && (JSON.parse(readFileSync(join(d, "package.json"), "utf8")) as { name?: string }).name?.startsWith("@protoboardai/")),
];
for (const [dir, built] of [
  [join(workspace, "uhd-viewer"), "dist/lib"],
  [join(repo, "packages", "web-viewer"), "dist/web-viewer.js"],
] as const) {
  if (!existsSync(join(dir, built))) {
    console.error(`[stack] ${join(dir, built)} is missing: build it first (npm install at the root of protoboard-stack builds the web viewer; npm run build in uhd-viewer builds the viewer)`);
    process.exit(1);
  }
}
const packages: Record<string, string> = {};
const tarballs: Record<string, string> = {};
// the version the carried stack is (scripts/build-version.mjs, PB-1062): a release build (the release workflow on a
// tag, whose `release.mjs stamp` wrote packages/cli/build-info.json) keeps the committed version and that stamp;
// any other build is a development build with a prerelease version (0.2.1-dev.7.g1a2b3c4), written into the carried
// packages' manifests, so it never takes a release's folder in <home>/stack. The committed package.json files are
// not changed.
const bv = buildVersion(repo);
// where this build comes from (`protoboard --version --json`, doctor): the commit of this checkout and whether it had
// changes, and for a release build the release stamp (build-info.ts)
const build: BuildStamp = bv.stamp ?? gitStamp(repo, bv.version);
say(`build: ${bv.release ? `release ${bv.version}` : `development build ${bv.version}`}, ${build.commit ? `${build.commit.slice(0, 12)}${build.dirty ? " with uncommitted changes" : ""}${build.branch ? ` on ${build.branch}` : ""}` : "not a git checkout: commit unknown"}`);
/** This repository's packages take the build's version, and so do their ranges for each other. */
const OURS = "@protoboardai/";
const stampVersion = (pkg: { name: string; version: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }) => {
  if (!pkg.name.startsWith(OURS) || bv.version === pkg.version) return;
  if (pkg.version !== bv.base) throw new Error(`${pkg.name} is ${pkg.version} and the stack is ${bv.base}: the stack's packages share one version`);
  pkg.version = bv.version;
  for (const deps of [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies]) for (const n of Object.keys(deps ?? {})) if (n.startsWith(OURS)) deps![n] = bv.version;
};
/** Pack a package folder without running its scripts (nothing is built into a checkout), with the carried manifest. */
function packDir(dir: string) {
  const tmp = join(stage, "pack");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const [info] = JSON.parse(run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", tmp], dir)) as { filename: string }[];
  run(tar, ["-xzf", join(tmp, info.filename.replace("/", "-").replace("@", "")), "-C", tmp], tmp);
  const pkgFile = join(tmp, "package", "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { name: string; version: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; scripts?: unknown; publishConfig?: unknown; private?: boolean };
  for (const dep of NOT_CARRIED[pkg.name] ?? []) delete pkg.dependencies?.[dep];
  stampVersion(pkg);
  delete pkg.scripts;
  delete pkg.publishConfig;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  if (pkg.name === "@protoboardai/cli") writeFileSync(join(tmp, "package", BUILD_INFO), JSON.stringify(build, null, 2) + "\n");
  const tgz = join(stage, "tgz", `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`);
  run(tar, ["-czf", tgz, "-C", tmp, "package"], tmp);
  packages[pkg.name] = pkg.version;
  tarballs[pkg.name] = tgz;
}
say(`packing ${dirs.length} packages from ${workspace}`);
for (const d of dirs) packDir(d);
// UHD is the public protocol, released from its own repository: the carried copy is the published one
const uhd = core.protoboard.toolchain.uhd;
{
  const [info] = JSON.parse(run(npm, ["pack", `@deltarobotics/uhd@${uhd}`, "--json", "--pack-destination", join(stage, "tgz"), ...npmArgs], stage)) as { filename: string }[];
  packages["@deltarobotics/uhd"] = uhd;
  tarballs["@deltarobotics/uhd"] = join(stage, "tgz", info.filename.replace("/", "-").replace("@", ""));
  say(`@deltarobotics/uhd@${uhd} from ${NPMJS}`);
}
const version = packages["@protoboardai/cli"];
if (version !== bv.version || packages["@protoboardai/core"] !== bv.version) throw new Error(`@protoboardai/cli is ${version} and @protoboardai/core is ${packages["@protoboardai/core"]}, not ${bv.version}: the stack's packages share one version`);

// ---- 2. one installed tree, as a project that uses every extension would have it
// (a folder without a template.json is not a template: `_agents` holds what every template's AGENTS.md shares)
const templates = readdirSync(join(repo, "packages", "core", "templates"))
  .map((t) => join(repo, "packages", "core", "templates", t, "template.json"))
  .filter((f) => existsSync(f))
  .map((f) => JSON.parse(readFileSync(f, "utf8")) as { overrides?: Record<string, string> });
if (!templates.length) throw new Error("no project template found in packages/core/templates: the tree would be installed without their overrides");
const overrides = Object.assign({}, ...templates.map((t) => t.overrides ?? {})) as Record<string, string>;
const tree = join(stage, "tree");
mkdirSync(tree, { recursive: true });
const deps = Object.fromEntries(Object.entries(tarballs).map(([n, f]) => [n, `file:${f}`]));
writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "protoboard-stack", version, private: true, description: "The Protoboard stack carried by the VS Code extension", dependencies: deps, overrides: { ...deps, ...overrides } }, null, 2) + "\n");
say("npm install of the tree (third-party packages from npmjs)");
run(npm, ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", ...npmArgs], tree, false);

// ---- 3. native modules: one folder per platform, from the lockfile's os/cpu entries
interface LockEntry {
  version?: string;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  optional?: boolean;
}
const lock = (JSON.parse(readFileSync(join(tree, "package-lock.json"), "utf8")) as { packages: Record<string, LockEntry> }).packages;
const natives = join(stage, "natives");
const nativePaths = new Set<string>();
for (const [path, e] of Object.entries(lock)) {
  if (!path || !e.version || (!e.os && !e.cpu)) continue;
  nativePaths.add(path);
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  for (const key of platforms) {
    const [os, cpu] = key.split("-");
    if ((e.os && !e.os.includes(os)) || (e.cpu && !e.cpu.includes(cpu))) continue;
    // Linux: the glibc build (VS Code's own requirement); musl builds are not carried
    if (e.libc && !e.libc.includes("glibc")) continue;
    const to = join(natives, key, path);
    mkdirSync(dirname(to), { recursive: true });
    if (key === host && existsSync(join(tree, path))) {
      cpSync(join(tree, path), to, { recursive: true });
      continue;
    }
    const tmp = join(stage, "pack");
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const [info] = JSON.parse(run(npm, ["pack", `${name}@${e.version}`, "--json", "--pack-destination", tmp, ...npmArgs], stage)) as { filename: string }[];
    run(tar, ["-xzf", join(tmp, info.filename.replace("/", "-").replace("@", "")), "-C", tmp], tmp);
    renameSync(join(tmp, "package"), to);
  }
}
// the tree itself carries none: each platform gets its own from its archive
for (const p of nativePaths) rmSync(join(tree, p), { recursive: true, force: true });
for (const key of platforms) if (!existsSync(join(natives, key))) throw new Error(`no native modules were found for ${key}: is it a platform esbuild publishes for?`);

// ---- 4. the archives
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
/** Not carried: source maps (no code reads them), npm's own bookkeeping, and command links (the extension writes its own). */
const skip = (path: string) => path.endsWith(".map") || path === "node_modules/.bin" || path.includes("/node_modules/.bin") || path === "node_modules/.package-lock.json" || path === "package-lock.json";
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const describe = async (name: string, dir: string) => {
  const file = join(out, name);
  const t0 = Date.now();
  const r = await pack(entriesOf(dir, skip), file, { quality });
  const size = statSync(file).size;
  say(`${name}: ${r.files} files, ${(r.bytes / 1e6).toFixed(1)} MB unpacked, ${(size / 1e6).toFixed(1)} MB packed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return { file: name, files: r.files, unpacked: r.bytes, bytes: size, sha256: sha(file) };
};
const main = await describe("stack.pbar.br", tree);
const native: Record<string, Awaited<ReturnType<typeof describe>>> = {};
for (const key of platforms) native[key] = await describe(`native-${key}.pbar.br`, join(natives, key));
const digest = createHash("sha256").update([main.sha256, ...platforms.map((k) => native[k].sha256)].join("\n")).digest("hex");
const manifest = { schema: "protoboard.carried-stack/v1", version, uhd, packages: Object.fromEntries(Object.entries(packages).sort()), platforms, digest, archives: { main, native }, build };
writeFileSync(join(out, "stack.json"), JSON.stringify(manifest, null, 2) + "\n");
const total = main.bytes + Object.values(native).reduce((n, a) => n + a.bytes, 0);
say(`dist/stack: stack ${version} for ${platforms.join(", ")}: ${(total / 1e6).toFixed(1)} MB in the .vsix; one platform unpacks to ${((main.unpacked + native[platforms[0]].unpacked) / 1e6).toFixed(0)} MB`);
if (!values.keep) rmSync(stage, { recursive: true, force: true });
