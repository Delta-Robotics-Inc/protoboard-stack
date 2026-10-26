#!/usr/bin/env node
// Builds @protoboardai/web-viewer (packages/web-viewer/dist): the page `protoboard dev` serves and the VS Code
// shell the extension copies. Run by the root `postinstall`, so a fresh checkout's `protoboard dev` works after
// `npm install`, and by `npm run build`.
//
//   node scripts/build-web-viewer.mjs            build (from postinstall: only when dist is missing or older than src)
//   node scripts/build-web-viewer.mjs --force    build whatever the state
//
// From postinstall a failure never fails the install: it says what is missing (most often the sibling
// uhd-viewer's own build, `npm run build` in ../uhd-viewer) and how to build the viewer afterwards.
// PROTOBOARD_SKIP_WEB_BUILD=1 skips it.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./npm-cli.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(repo, "packages", "web-viewer");
const fromInstall = process.env.npm_lifecycle_event === "postinstall";
const force = process.argv.includes("--force");
const say = (s) => console.log(`[web-viewer] ${s}`);

function fail(message) {
  if (!fromInstall) {
    console.error(`[web-viewer] ${message}`);
    process.exit(1);
  }
  say(`not built: ${message}`);
  say("build it later with `npm run build` from the repository root; `protoboard dev` needs it.");
  process.exit(0);
}

if (process.env.PROTOBOARD_SKIP_WEB_BUILD) {
  say("PROTOBOARD_SKIP_WEB_BUILD is set: not building");
  process.exit(0);
}
if (!existsSync(join(pkg, "package.json"))) process.exit(0);

/** The newest modification time below a folder (skipping node_modules and dist). */
function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

// the viewer's component library is a sibling checkout: its dist must exist first
let uhdViewer;
try {
  uhdViewer = dirname(createRequire(join(pkg, "package.json")).resolve("@deltarobotics/uhd-viewer/package.json"));
} catch {
  fail("@deltarobotics/uhd-viewer is not installed (the ../uhd-viewer checkout, linked by npm install)");
}
if (!existsSync(join(uhdViewer, "dist", "components", "index.js"))) fail(`${uhdViewer} is not built: run \`npm install && npm run build\` there first`);

const outputs = [join(pkg, "dist", "web-viewer.js"), join(pkg, "dist", "vscode", "protoboard-viewer.js")];
if (fromInstall && !force && outputs.every(existsSync)) {
  const built = Math.min(...outputs.map((f) => statSync(f).mtimeMs));
  const sources = Math.max(newest(join(pkg, "src")), newest(join(repo, "packages", "views", "src")), statSync(join(uhdViewer, "dist", "components", "index.js")).mtimeMs);
  if (built >= sources) {
    say("up to date");
    process.exit(0);
  }
}

say("building packages/web-viewer (vite)…");
try {
  // npm as this Node with npm-cli.js: on Windows npm is npm.cmd, which Node does not start without a shell (EINVAL)
  runNpm(["run", "build", "-w", "@protoboardai/web-viewer"], { cwd: repo, stdio: "inherit" });
} catch (e) {
  fail(`the build failed (${e.message.split("\n")[0]})`);
}
say("built packages/web-viewer/dist");
// the bundles carry their dependencies: their licences ship beside them in dist/
try {
  execFileSync(process.execPath, [join(repo, "scripts", "third-party-licenses.mjs"), "web-viewer"], { cwd: repo, stdio: "inherit" });
} catch (e) {
  fail(`the third-party licences were not written (${e.message.split("\n")[0]})`);
}
