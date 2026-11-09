/**
 * Bundle the benchmark candidates into the scratch folder (never into the repository).
 *
 *   node build.mjs
 *
 * three.js and flatbush come from protoboard-stack's node_modules. PixiJS is NOT a repo
 * dependency: it is loaded from the scratch install at %TEMP%\pcb-editor-research\p0-bench\pixi
 * (pixi.js 8.22.0, `npm install pixi.js@8.22.0 --ignore-scripts` there). React for the current
 * view comes from uhd-viewer (19.3.0; the stack root has react 19 with react-dom 18).
 */
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SCRATCH = process.env.P0_BENCH ?? join(process.env.TEMP ?? process.env.TMP ?? "/tmp", "pcb-editor-research", "p0-bench");
const OUT = join(SCRATCH, "site");
const PIXI = join(SCRATCH, "pixi", "node_modules", "pixi.js");
const UHDV = join(here, "..", "..", "..", "..", "..", "uhd-viewer", "node_modules");
mkdirSync(OUT, { recursive: true });

const entries = { three: "r-three.js", canvas: "r-canvas.js", pixi: "r-pixi.js", svg: "r-svg.js", view: "r-view.jsx" };
for (const [name, file] of Object.entries(entries)) {
  const t0 = Date.now();
  const res = await build({
    entryPoints: [join(here, "src", file)],
    bundle: true,
    format: "esm",
    outfile: join(OUT, `${name}.js`),
    minify: true,
    sourcemap: false,
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    alias: {
      "pixi.js": PIXI,
      react: join(UHDV, "react"),
      "react-dom": join(UHDV, "react-dom"),
    },
    metafile: true,
    logLevel: "warning",
  });
  const bytes = Object.values(res.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
  console.log(`${name}: ${(bytes / 1024).toFixed(0)} KiB in ${Date.now() - t0} ms`);
}
writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><title>pcb renderer bench</title>
<style>html,body{margin:0;background:#131416;overflow:hidden}#host{width:1600px;height:1000px;position:relative}canvas{display:block}</style></head>
<body><div id="host"></div><script type="module">
const r = new URLSearchParams(location.search).get("r") ?? "three";
import("./" + r + ".js");
</script></body></html>`,
);
console.log("site:", OUT);
