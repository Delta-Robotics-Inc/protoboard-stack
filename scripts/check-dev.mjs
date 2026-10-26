#!/usr/bin/env node
/**
 * End-to-end check of `protoboard dev` in headless Chrome:
 *
 *   node scripts/check-dev.mjs <project dir> <out dir> [work dir]
 *
 * Copies the project into the work dir (default <out dir>/project; its
 * node_modules linked, not copied), so the project itself is never edited. Then it starts
 * `protoboard dev` on the copy and, in the page:
 *
 * 1. waits for the diagram and saves 01-dev-diagram.png;
 * 2. drags a top-level module (DRAG_NODE, default gnss) and checks that
 *    .protoboard/display.json changed for that node (02-dev-dragged.png);
 * 3. renames that module in its .uhd.ts source (EDIT_FILE, EDIT_FROM,
 *    EDIT_TO) and checks the page shows the new name without a reload and
 *    without moving the dragged node (03-dev-source-edit.png);
 * 4. moves the node in display.json on disk and checks the page follows
 *    (04-dev-display-edit.png);
 * 5. drills into a level with no saved layout (DRILL, default stack), drags
 *    a node there, and checks the level is saved with every node it shows,
 *    so a reload draws it exactly as before (05-dev-drill-saved.png);
 * 6. relays a framing host's messages (PB-855): frames the page in a page on
 *    another origin, allowed with --host-origin as the VS Code webview is by
 *    default, and checks that the host hears ready, that focus on
 *    FOCUS_PATH (default arm_fl/motor) comes back as the selection, and that
 *    OPEN SOURCE comes back with the definition's and the instance's file
 *    and line (06-dev-framed.png); in the tab of its own, OPEN SOURCE shows
 *    the place in the page's badge;
 * 7. stops the server with SIGINT and checks it exits cleanly.
 *
 * Writes summary.json and exits 1 on any failed step. Needs Google Chrome
 * (CHROME, default /usr/bin/google-chrome) and puppeteer-core, taken from the
 * installed @deltarobotics/uhd-viewer's dependencies (it uses the same for
 * its own render checks), and the viewer's library build (`npm run build` in
 * uhd-viewer).
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const CLI = join(REPO, "packages/cli/bin/protoboard.mjs");
const [source, outArg, workArg] = process.argv.slice(2);
if (!source || !outArg) {
  console.error("usage: node scripts/check-dev.mjs <project dir> <out dir> [work dir]");
  process.exit(2);
}
const out = resolve(outArg);
const DRAG_NODE = process.env.DRAG_NODE ?? "gnss";
const EDIT_FILE = process.env.EDIT_FILE ?? "src/quadcopter.uhd.ts";
const EDIT_FROM = process.env.EDIT_FROM ?? `name: "GNSS + compass"`;
const EDIT_TO = process.env.EDIT_TO ?? `name: "GNSS + compass (edited live)"`;

const viewerRoot = dirname(createRequire(join(REPO, "packages/cli/package.json")).resolve("@deltarobotics/uhd-viewer/package.json"));
const puppeteer = createRequire(join(viewerRoot, "package.json"))("puppeteer-core");

// ---- a copy of the project, with the workspace's node_modules
const project = resolve(workArg ?? join(out, "project"));
rmSync(project, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(source), project, { recursive: true, filter: (f) => !/[\\/](node_modules|operations)$|[\\/]\.protoboard[\\/](build|tools)$/.test(f) });
let modules = resolve(source);
while (!existsSync(join(modules, "node_modules", "@protoboardai", "core")) && dirname(modules) !== modules) modules = dirname(modules);
symlinkSync(join(modules, "node_modules"), join(project, "node_modules"));

const results = [];
const expect = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${JSON.stringify(detail)}`}`);
};
const displayFile = join(project, ".protoboard/display.json");
const readDisplay = () => JSON.parse(readFileSync(displayFile, "utf8"));
const nodeIn = (d, id) => d.diagram?.layouts?.[""]?.nodes?.[id];
const wait = async (what, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await what();
    if (v) return v;
    if (Date.now() - t0 > timeout) return undefined;
    await new Promise((r) => setTimeout(r, 100));
  }
};

// ---- a host page on another origin that frames the dev page (step 6), as the VS Code webview does
const FOCUS_PATH = process.env.FOCUS_PATH ?? "arm_fl/motor";
const host = createServer((req, res) => {
  const src = new URL(req.url ?? "/", "http://x").searchParams.get("src") ?? "";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html>
<body style="margin:0">
  <iframe id="dev" src="${src.replace(/"/g, "&quot;")}" style="border:0;width:100vw;height:100vh;display:block"></iframe>
  <script>
    const frame = document.getElementById("dev");
    window.events = [];
    addEventListener("message", (e) => e.source === frame.contentWindow && window.events.push({ ...e.data, origin: e.origin }));
    window.send = (m) => frame.contentWindow.postMessage(m, new URL(frame.src).origin);
  </script>
</body>`);
});
await new Promise((ok) => host.listen(0, "127.0.0.1", () => ok(undefined)));
const hostOrigin = `http://127.0.0.1:${host.address().port}`;

// ---- the dev server, logging JSON lines
const logs = [];
const dev = spawn(process.execPath, [CLI, "dev", "--port", "0", "--format", "json", "--host-origin", hostOrigin], { cwd: project, stdio: ["ignore", "pipe", "inherit"] });
let buf = "";
dev.stdout.on("data", (d) => {
  buf += d;
  for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try {
      logs.push(JSON.parse(line));
    } catch {
      logs.push({ raw: line });
    }
  }
});
const exited = new Promise((ok) => dev.on("exit", (code, signal) => ok({ code, signal })));
const listening = await wait(() => logs.find((l) => l.event === "listening"), 120000);
if (!listening) {
  console.error("protoboard dev did not start", logs);
  dev.kill();
  process.exit(1);
}
const url = listening.url;
console.log(`dev server ${url}`);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  headless: true,
  // no SwiftShader (this check draws no WebGL); raster and compositing on the CPU so screenshots of moved
  // or zoomed nodes never keep stale tiles (PB-873)
  args: ["--no-sandbox", "--disable-gpu-rasterization", "--disable-partial-raster", "--disable-gpu-compositing"],
});
const failed = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.url()} ${r.status()}`));
  page.on("pageerror", (e) => failed.push(`page error: ${e.message}`));

  // 1. the diagram
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 5 && window.protoboardDev, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  const nodes = await page.evaluate(() => document.querySelectorAll(".react-flow__node").length);
  expect("diagram renders", nodes > 5, { nodes });
  await page.screenshot({ path: join(out, "01-dev-diagram.png") });

  // 2. drag a module: display.json changes for it
  const before = nodeIn(readDisplay(), DRAG_NODE);
  const transform = () => page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.style.transform, DRAG_NODE);
  const box = await page.evaluate((id) => {
    const r = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect();
    return r && { x: r.x + r.width / 2, y: r.y + 10 };
  }, DRAG_NODE);
  if (!box) throw new Error(`no node ${DRAG_NODE} on the canvas`);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) await page.mouse.move(box.x + i * 10, box.y + i * 4, { steps: 2 });
  await page.mouse.up();
  const after = await wait(() => {
    const n = nodeIn(readDisplay(), DRAG_NODE);
    return n && (n.x !== before?.x || n.y !== before?.y) ? n : undefined;
  });
  expect(`dragging ${DRAG_NODE} updates display.json`, after, { before, after });
  const badge = await wait(() => page.evaluate(() => document.getElementById("pb-dev-text")?.textContent?.includes("layout saved") && document.getElementById("pb-dev-text").textContent));
  expect("the page reports the layout saved", badge, { badge });
  const dragged = await transform();
  await page.screenshot({ path: join(out, "02-dev-dragged.png") });

  // 3. edit a source: the page updates in place, the dragged node stays
  const file = join(project, EDIT_FILE);
  const text = readFileSync(file, "utf8");
  if (!text.includes(EDIT_FROM)) throw new Error(`${EDIT_FILE} does not contain ${EDIT_FROM}`);
  const updates = await page.evaluate(() => window.protoboardDev.updates);
  const marker = /"(.*)"/.exec(EDIT_TO)[1];
  const t0 = Date.now();
  writeFileSync(file, text.replace(EDIT_FROM, EDIT_TO));
  // the viewer upper-cases module labels
  const shown = await wait(() => page.evaluate((m) => document.body.textContent.toUpperCase().includes(m.toUpperCase()), marker), 30000);
  const ms = Date.now() - t0;
  expect("a .uhd.ts edit shows in the page without a reload", shown, { ms, marker });
  expect("the update arrived within seconds", shown && ms < 10000, { ms });
  expect("pushed through update(), not a reload", (await page.evaluate(() => window.protoboardDev.updates)) > updates, {});
  await new Promise((r) => setTimeout(r, 500));
  expect("the dragged layout survives the rebuild", (await transform()) === dragged, { dragged, now: await transform() });
  await page.screenshot({ path: join(out, "03-dev-source-edit.png") });

  // 4. display.json edited on disk: the page follows
  const d = readDisplay();
  const target = { ...nodeIn(d, DRAG_NODE), x: nodeIn(d, DRAG_NODE).x + 320 };
  d.diagram.layouts[""].nodes[DRAG_NODE] = target;
  writeFileSync(displayFile, JSON.stringify(d, null, 2) + "\n");
  const moved = await wait(() => transform().then((t) => t !== dragged && t));
  expect("a display.json edit on disk moves the node", moved && moved.includes(`${target.x}px`), { target, transform: moved });
  await page.screenshot({ path: join(out, "04-dev-display-edit.png") });

  // 5. a level laid out automatically: the first save names every node, and a reload draws the same
  const DRILL = process.env.DRILL ?? "stack";
  if (readDisplay().diagram?.layouts?.[DRILL]) throw new Error(`level ${DRILL} already has a saved layout`);
  const drill = await browser.newPage();
  await drill.setViewport({ width: 1600, height: 1000 });
  const drillUrl = `${url}?drill=${encodeURIComponent(DRILL)}`;
  await drill.goto(drillUrl, { waitUntil: "domcontentloaded" });
  await drill.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 1 && window.protoboardDev, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1000));
  const placements = () =>
    drill.evaluate(() => Object.fromEntries([...document.querySelectorAll(".react-flow__node[data-id]")].map((n) => [n.dataset.id, n.style.transform])));
  const leaf = await drill.evaluate(() => {
    const n = [...document.querySelectorAll(".react-flow__node[data-id]")].find((x) => !x.dataset.id.startsWith("@") && x.getBoundingClientRect().width > 60);
    const r = n?.getBoundingClientRect();
    return r && { id: n.dataset.id, x: r.x + r.width / 2, y: r.y + 10 };
  });
  if (!leaf) throw new Error(`no node to drag on level ${DRILL}`);
  await drill.mouse.move(leaf.x, leaf.y);
  await drill.mouse.down();
  for (let i = 1; i <= 12; i++) await drill.mouse.move(leaf.x + i * 10, leaf.y + i * 6, { steps: 2 });
  await drill.mouse.up();
  const level = await wait(() => readDisplay().diagram?.layouts?.[DRILL]);
  await wait(() => drill.evaluate(() => document.getElementById("pb-dev-text")?.textContent?.includes("layout saved")));
  await new Promise((r) => setTimeout(r, 1000));
  const shownBefore = await placements();
  expect(`dragging on level ${DRILL} saves that level with every node it shows`, level && Object.keys(shownBefore).every((id) => level.nodes[id]), { saved: level && Object.keys(level.nodes), shown: Object.keys(shownBefore) });
  await drill.screenshot({ path: join(out, "05-dev-drill-saved.png") });
  await drill.reload({ waitUntil: "domcontentloaded" });
  await drill.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 1 && window.protoboardDev, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1000));
  const shownAfter = await placements();
  const jumped = Object.keys(shownBefore).filter((id) => shownBefore[id] !== shownAfter[id]);
  expect(`level ${DRILL} reloads from display.json exactly as it was`, jumped.length === 0, { jumped, before: shownBefore, after: shownAfter });
  await drill.close();

  // 6. a framing host drives the viewer through the page, and hears where sources are
  const framed = await browser.newPage();
  await framed.setViewport({ width: 1600, height: 1000 });
  framed.on("pageerror", (e) => failed.push(`page error: ${e.message}`));
  await framed.goto(`${hostOrigin}/?src=${encodeURIComponent(url)}`, { waitUntil: "domcontentloaded" });
  const heard = (pred, arg, timeout = 30000) => framed.waitForFunction(pred, { timeout }, arg).then(() => true, () => false);
  const events = () => framed.evaluate(() => window.events);
  expect("a framing host hears ready, at the page's origin", await heard(() => window.events.some((e) => e.type === "uhd-viewer:ready"), undefined, 60000), await events());
  await framed.evaluate((path) => window.send({ type: "uhd-viewer:focus", path }), FOCUS_PATH);
  const focused = await heard((path) => window.events.some((e) => e.type === "uhd-viewer:selectionChanged" && e.selection?.id === path), FOCUS_PATH);
  expect(`focus ${FOCUS_PATH} through the page comes back as the selection`, focused, (await events()).slice(-3));
  const inner = framed.frames().find((f) => f.url().startsWith(url));
  await new Promise((r) => setTimeout(r, 1000));
  const clicked = await inner?.evaluate(() => {
    const b = document.querySelector(".open-source");
    b?.click();
    return Boolean(b);
  });
  await heard(() => window.events.some((e) => e.type === "uhd-viewer:openSource"), undefined, 10000);
  const opened = (await events()).find((e) => e.type === "uhd-viewer:openSource");
  const sourceOk = opened?.source?.file && opened.source.path?.startsWith(project) && opened.instanceSource?.line > 0 && opened.instancePath === FOCUS_PATH;
  expect("OPEN SOURCE reaches the host with the file and line", clicked && sourceOk, opened);
  await framed.screenshot({ path: join(out, "06-dev-framed.png") });
  await framed.close();
  // the tab of its own: no host, the page shows the place
  await page.bringToFront();
  await page.evaluate(() => window.protoboardDev.viewer.focus("battery"));
  await wait(() => page.evaluate(() => Boolean(document.querySelector(".open-source"))));
  await page.evaluate(() => document.querySelector(".open-source")?.click());
  const local = await wait(() => page.evaluate(() => /^source · /.test(document.getElementById("pb-dev-text")?.textContent ?? "") && document.getElementById("pb-dev-text").textContent));
  expect("in a tab of its own, OPEN SOURCE shows the place", local, { local });

  const unexpected = failed.filter((f) => !/favicon/.test(f));
  expect("no failed requests or page errors", unexpected.length === 0, unexpected);
} catch (e) {
  expect("run", false, String(e?.stack ?? e));
} finally {
  await browser.close();
  host.close();
  dev.kill("SIGINT");
  const end = await Promise.race([exited, new Promise((r) => setTimeout(() => r({ timeout: true }), 10000))]);
  expect("SIGINT stops the server cleanly", end.code === 0 && logs.some((l) => l.event === "stopped"), end);
}

writeFileSync(
  join(out, "summary.json"),
  JSON.stringify({ project: relative(REPO, resolve(source)), url, results, logs: logs.map(({ time, ...l }) => l) }, null, 2) + "\n",
);
console.log(join(out, "summary.json"));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
