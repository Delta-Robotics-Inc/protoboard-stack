#!/usr/bin/env node
/**
 * Viewer screenshots for the README (docs/images/viewer-*.png): the system
 * diagram, the cap board drilled into, and the assembled 3D with labels,
 * taken in headless Chrome from a running `protoboard dev` (the UHD viewer).
 *
 *   npx protoboard dev --port 5197 --no-watch &
 *   node scripts/viewer-screenshots.mjs http://127.0.0.1:5197/
 *
 * Needs Google Chrome ($CHROME) and puppeteer-core (the uhd-viewer package's
 * dev dependency; PUPPETEER_CORE points at another copy).
 */
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE ?? require.resolve("puppeteer-core", { paths: [join(dirname(require.resolve("@deltarobotics/uhd-viewer/package.json")), "node_modules"), process.cwd()] }));
const base = process.argv[2] ?? "http://127.0.0.1:5197/";
const out = join(dirname(fileURLToPath(import.meta.url)), "../docs/images");
const W = 1600;
const H = 1000;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (q) => {
  const u = new URL(base);
  for (const [k, v] of new URLSearchParams(q)) u.searchParams.set(k, v);
  return u.href;
};

const SHOTS = [
  { file: "viewer-system.png", query: "", ready: () => document.querySelectorAll(".react-flow__node").length > 5 },
  { file: "viewer-board.png", query: "drill=board", ready: () => document.querySelectorAll(".react-flow__node").length > 20 },
  { file: "viewer-3d.png", query: "view=3d&labels=1&az=-50&el=26&dist=260", ready: () => window.__cad?.ready() >= 10 },
  { file: "viewer-3d-exploded.png", query: "view=3d&labels=1&explode=1&az=-50&el=22&dist=300", ready: () => window.__cad?.ready() >= 10 },
  { file: "viewer-3d-section.png", query: "view=3d&section=x&at=0.5&az=0&el=12&dist=190", ready: () => window.__cad?.ready() >= 10 },
];

/** Software WebGL (SwiftShader) with CPU raster and compositing: without the last three, zoomed diagrams keep stale tiles (PB-873). */
const HEADLESS_GL = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-rasterization", "--disable-partial-raster", "--disable-gpu-compositing"];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", ...HEADLESS_GL, "--hide-scrollbars", `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
try {
  for (const s of SHOTS) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => localStorage.clear());
    await page.goto(at(s.query), { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(s.ready, { timeout: 180000 });
    await settle(3000);
    // the dev server's build status chip floats over the diagram's top node: not part of the picture
    await page.addStyleTag({ content: "#pb-dev { display: none !important; }" });
    await page.screenshot({ path: join(out, s.file) });
    console.log(`${s.file}`);
    await page.close();
  }
} finally {
  await browser.close();
}
