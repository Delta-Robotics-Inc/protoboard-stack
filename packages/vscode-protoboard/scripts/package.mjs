#!/usr/bin/env node
// `npm run package` (PB-907): the extension as a .vsix, built from source the same way every time, never published.
//
//   1. the viewer tabs' shell: @protoboardai/web-viewer (needs @deltarobotics/uhd-viewer built), from the repository root
//   2. the extension bundle, minified (esbuild.mjs --production), which copies the shell and codicons into dist/webview
//   3. the stack the extension carries (PB-929, scripts/build-stack.ts) into dist/stack: the CLI, core, every
//      ext-* extension, the viewers and UHD with everything they depend on, for six platforms (about 65 MB).
//      --platforms <list> carries fewer platforms; --no-stack leaves it out (a .vsix that needs the project's
//      own npm install, as before PB-929; about 6 MB)
//   4. `vsce package` into dist/vscode-protoboard.vsix (and dist/vscode-protoboard-<version>.vsix), no dependencies
//      (everything is bundled), files as .vscodeignore lists them
//
// --target <vscode-target> (linux-x64, darwin-arm64, win32-x64, …; PB-1047): a platform-specific package, as the
// release makes one per platform. It carries only that platform's native stack (build-stack.ts --platforms <target>)
// and passes --target to `vsce package`, into dist/vscode-protoboard-<version>-<target>.vsix (and
// dist/vscode-protoboard.vsix). The last line it prints is `vsix: <full path>`.
//
// It runs the same on Windows: npm, tsx and vsce are started as this Node with their JavaScript entry points
// (scripts/npm-cli.mjs), never a .cmd file, which Node does not start without a shell.
//
// Publishing (the Marketplace, Open VSX) is a separate, owner-approved step; this script never does it.
// The downloads site's build (protoboard-cloud hosting/build-site.mjs) runs this script and serves the .vsix with its checksum.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { npmCommand } from "../../../scripts/npm-cli.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(here, "..", "..");
const run = (cmd, args, cwd, shell = false) => {
  console.log(`$ ${[cmd, ...args].join(" ")}${cwd === here ? "" : `   (in ${cwd})`}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell, env: { ...process.env, NODE_ENV: "production" } });
};
const npm = (args, cwd) => {
  const c = npmCommand(args);
  run(c.command, c.args, cwd, c.shell);
};
/** A package's command-line program, as the JavaScript file its bin names (run with this Node: no .cmd shim). */
const binOf = (from, name, bin = name.split("/").pop()) => {
  const req = createRequire(join(from, "package.json"));
  const manifest = req.resolve(`${name}/package.json`);
  const b = JSON.parse(readFileSync(manifest, "utf8")).bin;
  return join(dirname(manifest), typeof b === "string" ? b : b[bin]);
};
const option = (name) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) throw new Error(`${name} needs a value`);
  return v;
};

/** The targets whose native stack the extension can carry (build-stack.ts, DEFAULT_PLATFORMS): VS Code's names for them. */
const TARGETS = ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64", "win32-x64", "win32-arm64"];
const target = option("--target");
if (target !== undefined) {
  if (!TARGETS.includes(target)) throw new Error(`--target ${target}: the extension carries a native stack for ${TARGETS.join(", ")} only`);
  if (process.argv.includes("--no-stack")) throw new Error("--target packages that platform's native stack; --no-stack carries none: leave one out");
  const p = option("--platforms");
  if (p !== undefined && p !== target) throw new Error(`--target ${target} carries ${target}'s stack only; --platforms ${p} says otherwise: leave --platforms out`);
}

if (!process.argv.includes("--skip-shell")) npm(["run", "build", "-w", "@protoboardai/web-viewer"], repo);
// --reuse-stack: keep the dist/stack an earlier run built (the same stack version), to repackage after an
// extension-only change without the two minutes the stack takes. A release is packaged without it.
const kept = join(here, ".stack-kept");
const reuse = process.argv.includes("--reuse-stack") && existsSync(join(here, "dist", "stack", "stack.json"));
rmSync(kept, { recursive: true, force: true });
if (reuse) renameSync(join(here, "dist", "stack"), kept);
rmSync(join(here, "dist"), { recursive: true, force: true });
run(process.execPath, ["esbuild.mjs", "--production"], here);
// the third-party packages inside the bundles, with their licences (THIRD_PARTY_LICENSES.md, in the .vsix)
run(process.execPath, [join(repo, "scripts", "third-party-licenses.mjs"), "extension"], repo);
if (reuse) {
  renameSync(kept, join(here, "dist", "stack"));
  const carried = JSON.parse(readFileSync(join(here, "dist", "stack", "stack.json"), "utf8")).version;
  const core = JSON.parse(readFileSync(join(repo, "packages", "core", "package.json"), "utf8")).version;
  if (carried !== core) throw new Error(`--reuse-stack: dist/stack is the stack ${carried} and the packages are ${core}: package without --reuse-stack`);
  const platforms = JSON.parse(readFileSync(join(here, "dist", "stack", "stack.json"), "utf8")).platforms;
  if (target && (platforms?.length !== 1 || platforms[0] !== target)) throw new Error(`--reuse-stack: dist/stack carries ${platforms?.join(", ") ?? "unknown platforms"}, not ${target} alone: package --target ${target} without --reuse-stack`);
  console.log(`--reuse-stack: carrying the stack ${carried} built earlier (NOT rebuilt from the packages as they are now)`);
} else if (process.argv.includes("--no-stack")) console.log("--no-stack: this .vsix carries no stack; a project needs its own npm install");
else {
  const platforms = target ?? option("--platforms");
  run(process.execPath, [binOf(repo, "tsx"), "scripts/build-stack.ts", ...(platforms ? ["--platforms", platforms] : [])], here);
}
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
// where the carried stack was built from (build-stack.ts stamps it into stack.json): said here, so a .vsix made from a
// working tree with changes is never mistaken for a release build
const carriedBuild = existsSync(join(here, "dist", "stack", "stack.json")) ? JSON.parse(readFileSync(join(here, "dist", "stack", "stack.json"), "utf8")).build : undefined;
if (carriedBuild) console.log(`carried stack built from ${carriedBuild.commit ? `${carriedBuild.commit.slice(0, 12)}${carriedBuild.dirty ? " with uncommitted changes" : ""}` : "an unknown commit"}`);
else if (existsSync(join(here, "dist", "stack", "stack.json"))) console.log("the carried stack has no build stamp (built before build-info.ts): protoboard doctor will say its commit is unknown");
// the licence and notice ship in the .vsix (.vscodeignore lists them); vsce runs with --skip-license, so check here
for (const f of ["LICENSE", "NOTICE"]) if (!existsSync(join(here, f))) throw new Error(`${f} is missing from packages/vscode-protoboard: the .vsix must carry it`);
const out = join(here, "dist", "vscode-protoboard.vsix");
run(process.execPath, [binOf(here, "@vscode/vsce"), "package", ...(target ? ["--target", target] : []), "--no-dependencies", "--skip-license", "--allow-missing-repository", "--no-update-package-json", "-o", out], here);
const named = join(here, "dist", `vscode-protoboard-${version}${target ? `-${target}` : ""}.vsix`);
copyFileSync(out, named);
console.log(`packaged ${out} (version ${version}${target ? `, for ${target} only` : ""}); not published`);
console.log(`vsix: ${named}`);
