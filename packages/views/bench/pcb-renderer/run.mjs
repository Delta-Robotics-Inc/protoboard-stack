/**
 * Run the renderer benchmark in Chrome through puppeteer-core (uhd-viewer's copy).
 *
 *   node run.mjs <mode> [candidates] [datasets] [--shots <dir>]
 *
 * mode:       headed | headless | swiftshader   (headless uses the GPU; swiftshader is the
 *             software path the repo's capture scripts use for agents and CI)
 * candidates: comma list of three,canvas,canvas-full,pixi,svg,view (default all)
 * datasets:   comma list of dataset names, the JSON files from parse-kicad.mjs and synth.mjs
 *             in <scratch>/data without .json (default: every file there)
 * --shots:    write screenshots of the first dataset to this folder
 *
 * Chrome runs without vsync or the frame-rate cap, so requestAnimationFrame deltas are frame
 * cost, not the display's refresh. Results go to <scratch>/results-<mode>.json.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCRATCH } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "..", "..", "..", "uhd-viewer", "package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const args = process.argv.slice(2);
const mode = args[0] ?? "headed";
const shotsAt = args.indexOf("--shots");
const shots = shotsAt >= 0 ? args[shotsAt + 1] : undefined;
const pos = args.filter((a, i) => !a.startsWith("--") && (shotsAt < 0 || i !== shotsAt + 1));
const candidates = (pos[1] ?? "three,canvas,canvas-full,pixi,svg,view").split(",");
const SITE = join(SCRATCH, "site");
const DATA = join(SCRATCH, "data");
const datasets = pos[2] ? pos[2].split(",") : readdirSync(DATA).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
const SHOT = datasets[0];
if (shots) mkdirSync(shots, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = url.pathname.startsWith("/data/") ? join(DATA, url.pathname.slice(6)) : join(SITE, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

const UNCAPPED = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--enable-precise-memory-info", "--force-device-scale-factor=1", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];
const DGPU = args.includes("--dgpu") ? ["--force_high_performance_gpu"] : [];
const FLAGS = {
  headed: [...UNCAPPED, "--window-size=1640,1140"],
  vsync: ["--enable-precise-memory-info", "--force-device-scale-factor=1", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--window-size=1640,1140"],
  headless: [...UNCAPPED, "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--window-size=1640,1140"],
  swiftshader: [...UNCAPPED, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-rasterization", "--disable-partial-raster", "--disable-gpu-compositing", "--window-size=1640,1140"],
};

/** Private bytes of every process of this Chrome (by its user-data folder), and of its GPU process. */
function processMemory(udd) {
  try {
    const ps = `$p = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${udd.replace(/'/g, "''")}*' }; $t = ($p | Measure-Object -Property PrivatePageCount -Sum).Sum; $g = ($p | Where-Object { $_.CommandLine -like '*--type=gpu-process*' } | Measure-Object -Property PrivatePageCount -Sum).Sum; $r = ($p | Where-Object { $_.CommandLine -like '*--type=renderer*' } | Measure-Object -Property PrivatePageCount -Sum).Sum; "$t $g $r"`;
    const [t, g, r] = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
    return { totalMB: +(t / 1048576).toFixed(0), gpuProcessMB: +(g / 1048576).toFixed(0), rendererMB: +(r / 1048576).toFixed(0) };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}

const results = [];
const outFile = join(SCRATCH, `results-${mode}${DGPU.length ? "-dgpu" : ""}${process.env.TAG ? "-" + process.env.TAG : ""}.json`);
let n = 0;
for (const cand of candidates) {
  for (const ds of datasets) {
    const udd = join(SCRATCH, "chrome-profiles", `${mode}-${cand}-${ds}-${Date.now()}`);
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: mode !== "headed", userDataDir: udd, args: ["--no-first-run", "--no-default-browser-check", ...FLAGS[mode], ...DGPU], defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 }, protocolTimeout: 900000 });
    const page = await browser.newPage();
    page.setDefaultTimeout(900000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text().slice(0, 300)));
    const r = { mode, candidate: cand, dataset: ds };
    const label = `[${++n}/${candidates.length * datasets.length}] ${mode} ${cand} ${ds}`;
    try {
      // a variant: "canvas-full", or "three@msaa=0&direct=1" (query options after @)
      const [rr, qs] = cand === "canvas-full" ? ["canvas", "&mode=full"] : cand.includes("@") ? [cand.split("@")[0], "&" + cand.split("@")[1]] : [cand, ""];
      await page.goto(`http://127.0.0.1:${PORT}/index.html?r=${rr}${qs}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.bench, { timeout: 30000 });
      await page.evaluate((d) => window.bench.load(d), ds);
      r.init = await page.evaluate(() => window.bench.init());
      await page.evaluate(() => window.bench.settle());
      const m = await page.metrics();
      r.memory = { jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), domNodes: m.Nodes, ...processMemory(udd) };
      r.info = await page.evaluate(() => window.bench.info());
      const slow = r.init.firstPaintMs > 4000 || cand === "svg" || cand === "view" || cand === "canvas-full" || mode === "swiftshader";
      const F = slow ? (ds.includes("x20") ? 30 : 60) : 190;
      const shot = async (name) => shots && ds === SHOT && page.screenshot({ path: join(shots, `renderer-${cand}-${ds}${name}.png`), clip: { x: 0, y: 0, width: 1600, height: 1000 } });
      await shot("");
      r.pan = await page.evaluate((f) => window.bench.pan(f), F);
      r.panFit = await page.evaluate((f) => window.bench.panFit(f), F);
      r.zoom = await page.evaluate((f) => window.bench.zoom(f), F);
      r.drag = await page.evaluate((f) => window.bench.drag(f), F);
      r.highlight = await page.evaluate((c) => window.bench.highlight(c), slow ? 4 : 12);
      if (shots && ds === SHOT) {
        // the largest net lit with the rest dimmed
        // the second-largest net lit with the rest dimmed (the largest is usually the ground pour)
        r.litNet = await page.evaluate(() => window.bench.lightNet(2));
        await new Promise((res) => setTimeout(res, 300));
        await shot("-highlight");
        await page.evaluate(() => window.bench.lightNet(0));
      }
      r.hit = await page.evaluate(() => window.bench.hitTest(20000));
      if (shots && ds === SHOT) {
        const v = await page.evaluate(() => window.bench.designatorView("U1", 160));
        await page.evaluate((v) => window.bench.setView(v), v);
        await page.evaluate(() => window.bench.settle());
        await new Promise((res) => setTimeout(res, 300));
        await page.evaluate(() => window.bench.settle());
        await page.screenshot({ path: join(shots, `renderer-${cand}-${ds}-text.png`), clip: { x: 500, y: 350, width: 600, height: 300 } });
        r.textShot = v.ref;
        // detail: 60 px per mm on the densest footprint
        const d = await page.evaluate(() => { const sc = window.__scene; let best, most = -1; for (const [k, ids] of sc.byFp) { const c = ids.filter((i) => sc.objects[i].type === "pad").length; if (c > most) { most = c; best = k; } } const f = sc.board.footprints[best]; return { cx: f.p[0], cy: f.p[1], s: 60, ref: f.ref }; });
        await page.evaluate((v) => window.bench.setView(v), d);
        await new Promise((res) => setTimeout(res, 300));
        await page.evaluate(() => window.bench.settle());
        await page.screenshot({ path: join(shots, `renderer-${cand}-${ds}-detail.png`), clip: { x: 400, y: 200, width: 800, height: 600 } });
      }
      r.infoAfter = await page.evaluate(() => window.bench.info());
    } catch (e) {
      r.error = String(e).slice(0, 500);
    }
    r.pageErrors = errors.slice(0, 5);
    results.push(r);
    writeFileSync(outFile, JSON.stringify(results, null, 1));
    const fmt = (x) => (x?.frame ? `${x.frame.median}/${x.frame.p95}${x.synced ? ` [sync ${x.synced.median}/${x.synced.p95}]` : ""}` : x?.unsupported ? "n/a" : "-");
    console.log(`${label}: paint ${r.init?.firstPaintMs ?? "ERR"} ms, pan ${fmt(r.pan)}, panFit ${fmt(r.panFit)}, zoom ${fmt(r.zoom)}, drag ${fmt(r.drag)}, hl ${r.highlight?.latency?.median ?? "-"} ms, hit ${r.hit?.perQueryUs ?? "-"} us, mem ${r.memory?.totalMB ?? "-"} MB${r.error ? " ERROR " + r.error : ""}${errors.length ? " pageErrors " + errors[0] : ""}`);
    await browser.close();
  }
}
server.close();
console.log("results:", outFile);
