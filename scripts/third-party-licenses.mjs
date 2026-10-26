#!/usr/bin/env node
/**
 * THIRD_PARTY_LICENSES.md for what a bundle carries (PB-941): every third-party package whose code is inside
 * a shipped bundle, with its version, licence and the licence text it ships. A bundle's packages come from
 * its esbuild metafile (exact) or, for a bundle another tool built (Vite), from the runtime dependency closure
 * of the packages it is built from (a superset: listing a package tree-shaking dropped costs nothing).
 *
 *   node scripts/third-party-licenses.mjs web-viewer   packages/web-viewer/dist/THIRD_PARTY_LICENSES.md
 *                                                       (the web viewer's bundles: React, three.js, the viewer)
 *   node scripts/third-party-licenses.mjs extension    packages/vscode-protoboard/THIRD_PARTY_LICENSES.md
 *                                                       (the extension's bundles, from esbuild.mjs's .bundle-meta.json
 *                                                       and the webviews' packages), shipped in the .vsix
 *
 * build-web-viewer.mjs and the extension's package.mjs run it. The packages that run from their sources
 * (the CLI, core, the extensions) bundle nothing: npm installs their dependencies with their own licences.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The package folder that holds a file under node_modules, or undefined. */
export function packageDirOf(file) {
  const i = file.lastIndexOf("node_modules/");
  if (i < 0) return undefined;
  const rest = file.slice(i + 13).split("/");
  return file.slice(0, i + 13) + (rest[0].startsWith("@") ? rest.slice(0, 2).join("/") : rest[0]);
}

/** Package folders of the node_modules inputs of esbuild metafiles. */
export function fromMetafiles(metafiles, base) {
  const dirs = new Set();
  for (const m of metafiles) for (const input of Object.keys(m.inputs ?? {})) {
    const abs = input.startsWith("/") ? input : join(base, input);
    const d = packageDirOf(abs);
    if (d) dirs.add(d);
  }
  return dirs;
}

/** Package folders of `names` and of everything they depend on at run time, resolved from `fromDir`. */
export function dependencyClosure(names, fromDir, skip = (n) => false) {
  const dirs = new Set();
  const visit = (name, from) => {
    if (skip(name)) return;
    let pj;
    try {
      pj = createRequire(join(from, "x.js")).resolve(`${name}/package.json`);
    } catch {
      // a package without an exported package.json: walk up from its entry
      try {
        let d = dirname(createRequire(join(from, "x.js")).resolve(name));
        while (!existsSync(join(d, "package.json")) || JSON.parse(readFileSync(join(d, "package.json"), "utf8")).name !== name) d = dirname(d);
        pj = join(d, "package.json");
      } catch {
        return;
      }
    }
    const dir = dirname(pj);
    if (dirs.has(dir)) return;
    dirs.add(dir);
    const m = JSON.parse(readFileSync(pj, "utf8"));
    for (const dep of Object.keys(m.dependencies ?? {})) visit(dep, dir);
  };
  for (const n of names) visit(n, fromDir);
  return dirs;
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/** The fonts the viewer's stylesheets carry (uhd-viewer src/styles/fonts), which no package.json lists. */
export function viewerFonts(fontDir) {
  const ofl = join(fontDir, "OFL.txt");
  if (!existsSync(ofl)) return [];
  const files = readdirSync(fontDir).filter((f) => /^KodeMono-.*\.(woff2|ttf)$/.test(f)).sort();
  return [{ name: "Kode Mono", license: "OFL-1.1", homepage: "https://github.com/isaozler/kode-mono", files, text: readFileSync(ofl, "utf8").trim() }];
}

/**
 * Write the file: one section per package, then one per font. Ours are left out: `@protoboardai/*` and
 * `@deltarobotics/uhd-viewer` are Delta Robotics' and Apache-2.0 under the same copyright and NOTICE as the
 * bundle itself. That includes `@protoboardai/cloud` (packages/cloud), the parts service's client, which the
 * extension bundles.
 */
export function writeThirdPartyLicenses(dirs, outFile, { title, fonts = [], ours = (n) => n.startsWith("@protoboardai/") || n === "@deltarobotics/uhd-viewer" || n === "vscode-protoboard" } = {}) {
  const pkgs = new Map();
  for (const d of dirs) {
    if (!existsSync(join(d, "package.json"))) continue;
    const m = JSON.parse(readFileSync(join(d, "package.json"), "utf8"));
    if (!m.name || ours(m.name)) continue;
    const key = `${m.name}@${m.version}`;
    if (pkgs.has(key)) continue;
    const files = readdirSync(d).filter((f) => LICENSE_FILE.test(f)).sort();
    const license = typeof m.license === "string" ? m.license : m.license?.type ?? (Array.isArray(m.licenses) ? m.licenses.map((l) => l.type ?? l).join(" OR ") : "UNKNOWN");
    pkgs.set(key, { name: m.name, version: m.version, license, homepage: m.homepage ?? (typeof m.repository === "string" ? m.repository : m.repository?.url), texts: files.map((f) => ({ file: f, text: readFileSync(join(d, f), "utf8").trim() })) });
  }
  const list = [...pkgs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    `# Third-party licences${title ? `: ${title}` : ""}`,
    "",
    "The bundled code of this package contains the following third-party packages, each under its own licence. Their licences, not the licence of this package, apply to them.",
    "",
    "| Package | Version | Licence |",
    "| --- | --- | --- |",
    ...list.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`),
    "",
  ];
  for (const p of list) {
    lines.push(`## ${p.name} ${p.version}`, "", `Licence: ${p.license}${p.homepage ? `  \nSource: ${p.homepage}` : ""}`, "");
    if (!p.texts.length) lines.push("(The package ships no licence file; its package.json states the licence above.)", "");
    for (const t of p.texts) lines.push(`### ${t.file}`, "", "```", t.text, "```", "");
  }
  for (const f of fonts) lines.push(`## Font: ${f.name}`, "", `Licence: ${f.license}  \nSource: ${f.homepage}  \nFiles: ${f.files.join(", ")} (glyphs unchanged; .woff2 converted from the released .ttf)`, "", "```", f.text, "```", "");
  writeFileSync(outFile, lines.join("\n"));
  return { packages: list.length, unknown: list.filter((p) => p.license === "UNKNOWN" || !p.license).map((p) => `${p.name}@${p.version}`) };
}

// ---------------------------------------------------------------- command line
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
  const target = process.argv[2];
  if (target === "web-viewer") {
    const pkg = join(repo, "packages", "web-viewer");
    const deps = Object.keys(JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).dependencies ?? {});
    const fonts = viewerFonts(join(dirname(createRequire(join(pkg, "x.js")).resolve("@deltarobotics/uhd-viewer/package.json")), "src", "styles", "fonts"));
    const r = writeThirdPartyLicenses(dependencyClosure(deps, pkg), join(pkg, "dist", "THIRD_PARTY_LICENSES.md"), { title: "@protoboardai/web-viewer (dist/)", fonts });
    console.log(`[third-party] packages/web-viewer/dist/THIRD_PARTY_LICENSES.md: ${r.packages} packages${r.unknown.length ? `; no licence stated: ${r.unknown.join(", ")}` : ""}`);
  } else if (target === "extension") {
    const ext = join(repo, "packages", "vscode-protoboard");
    const meta = join(ext, ".bundle-meta.json");
    const metas = existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")) : [];
    const dirs = new Set([...fromMetafiles(metas, ext), ...dependencyClosure(["@protoboardai/views", "@protoboardai/web-viewer", "@deltarobotics/uhd-viewer", "react", "react-dom"], ext)]);
    const fonts = viewerFonts(join(ext, "media", "fonts"));
    const r = writeThirdPartyLicenses(dirs, join(ext, "THIRD_PARTY_LICENSES.md"), { title: "the Protoboard extension for VS Code", fonts });
    console.log(`[third-party] packages/vscode-protoboard/THIRD_PARTY_LICENSES.md: ${r.packages} packages${metas.length ? "" : " (no .bundle-meta.json: run esbuild.mjs --production first for the exact list)"}${r.unknown.length ? `; no licence stated: ${r.unknown.join(", ")}` : ""}`);
  } else {
    console.error("usage: node scripts/third-party-licenses.mjs web-viewer|extension");
    process.exit(2);
  }
}
