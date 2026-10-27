// Bundles the extension into one CommonJS file (VS Code loads it with require); `vscode` is provided by the host.
// The CAD viewer tab's webview (cad-viewer.tsx) is bundled separately; the React webviews (with the part detail's three.js
// model preview) are built by Vite below. The viewer tabs' shell (@protoboardai/web-viewer's VS Code shell, built by Vite)
// is copied into dist/webview: every webview loads only files the extension ships, never a CDN.
import { context, build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// The CAD viewer's webview uses the viewer's component library: React and Three
// come from the library's own copies, so the bundle holds one of each.
const require = createRequire(import.meta.url);
const viewer = dirname(realpathSync(require.resolve("@deltarobotics/uhd-viewer/package.json")));
const fromViewer = (name) => join(viewer, "node_modules", name);
// the STEP reader (occt-import-js, LGPL-2.1, shipped unmodified beside the bundle)
const occt = dirname(require.resolve("occt-import-js/package.json"));

const here = dirname(fileURLToPath(import.meta.url));
// @protoboardai/core's agents code (PB-930) reads and edits JSON with comments
const jsoncParser = join(dirname(createRequire(join(here, "..", "core", "package.json")).resolve("jsonc-parser/package.json")), "lib", "esm", "main.js");
const production = process.argv.includes("--production");
// outputs earlier builds wrote and this one does not: the DOM pages' GLB preview script and the Inspector's model
// thumbnails, both inside views-app.js now, and VS Code's codicons, which only the Inspector's and the DRC panel's
// former pages drew with (PB-940: both are React pages with the viewer's icons)
for (const stale of ["dist/glb-preview.js", "dist/glb-preview.js.map", "dist/webview/model-thumbs.js", "dist/webview/codicons"]) rmSync(new URL(stale, import.meta.url), { force: true, recursive: true });
const common = { bundle: true, sourcemap: !production, minify: production, logLevel: "info", metafile: production };
// one version number (src/versions.ts, PB-944): the extension shares the stack's, read from the workspace, and a
// different number in this package stops the build rather than ship a .vsix that names two
const stackVersion = JSON.parse(readFileSync(join(here, "..", "core", "package.json"), "utf8")).version;
const ownVersion = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version;
if (ownVersion !== stackVersion) {
  console.error(`packages/vscode-protoboard is ${ownVersion} and the stack (packages/core) is ${stackVersion}: the extension and the stack share one version number. Set "version" in packages/vscode-protoboard/package.json and package-lock.json to ${stackVersion}.`);
  process.exit(1);
}
// scripts/package.mjs gives the version the .vsix is built as (PB-1062): the committed one for a release build, a
// development build's prerelease of it (0.2.1-dev.7.g1a2b3c4) otherwise (scripts/build-version.mjs)
const buildVersion = process.env.PROTOBOARD_BUILD_VERSION || stackVersion;
if (buildVersion !== stackVersion && !/^\d+\.\d+\.\d+-dev\./.test(buildVersion)) {
  console.error(`PROTOBOARD_BUILD_VERSION is ${buildVersion}: a build is the stack's version (${stackVersion}) or a development build of it (x.y.z-dev.…)`);
  process.exit(1);
}

const targets = [
  {
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.cjs",
    format: "cjs",
    platform: "node",
    target: "node20",
    external: ["vscode"],
    // CommonJS has no import.meta: core's stack.ts asks for its own URL only to learn whether it runs from a stack
    // copy (carriedStack), which the bundled extension never does, and it takes "no URL" as that answer
    // jsonc-parser's default entry is a UMD file whose requires a bundler cannot follow: take its ES modules
    alias: { "jsonc-parser": jsoncParser },
    define: { __PB_STACK_VERSION__: JSON.stringify(buildVersion), "import.meta.url": "undefined" },
  },
  {
    ...common,
    entryPoints: ["webview/cad-viewer.tsx"],
    outfile: "dist/cad-viewer.js",
    format: "iife",
    platform: "browser",
    target: "chrome114",
    jsx: "automatic",
    sourcemap: false,
    minify: true,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
    alias: { react: fromViewer("react"), "react-dom": fromViewer("react-dom"), three: fromViewer("three") },
  },
];

/** The webviews' own files: the viewer shell (built first: `npm run build -w @protoboardai/web-viewer`). */
function copyWebviewAssets() {
  const out = join(here, "dist", "webview");
  mkdirSync(out, { recursive: true });
  const shell = join(here, "..", "web-viewer", "dist", "vscode");
  for (const f of ["protoboard-viewer.js", "protoboard-viewer.css"]) {
    const from = join(shell, f);
    if (!existsSync(from)) throw new Error(`${from} is missing: build the viewer shell first (npm run build -w @protoboardai/web-viewer, from the repository root)`);
    copyFileSync(from, join(out, f));
  }
}

copyWebviewAssets();

// the STEP reader beside the CAD viewer's bundle
mkdirSync(join(here, "dist"), { recursive: true });
for (const f of ["occt-import-js.js", "occt-import-js.wasm", "license.occt-import-js.txt", "license.occt.txt"]) copyFileSync(join(occt, "dist", f), join(here, "dist", f));

if (process.argv.includes("--watch")) for (const t of targets) await (await context(t)).watch();
else {
  const results = await Promise.all(targets.map((t) => build(t)));
  // what the bundles carry, for THIRD_PARTY_LICENSES.md (scripts/third-party-licenses.mjs extension); not shipped
  if (production) writeFileSync(join(here, ".bundle-meta.json"), JSON.stringify(results.map((r) => r.metafile).filter(Boolean)));
}

// The React webviews (Library, part detail, libraries, Cloud, BOM, the Inspector's selection, the DRC panel): Vite with Tailwind, as the web shell is built
// (vite.webview.config.mjs); Vite is the web shell's, so both shells build with the same one.
if (!process.argv.includes("--no-webviews")) {
  const shell = createRequire(new URL("../web-viewer/package.json", import.meta.url));
  const vite = await import(pathToFileURL(shell.resolve("vite")).href);
  await vite.build({ configFile: fileURLToPath(new URL("./vite.webview.config.mjs", import.meta.url)), logLevel: "error" });
}
