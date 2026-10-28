/**
 * Headless captures of the extension's webviews as standalone pages, in the
 * token sets VS Code gives a webview (PB-895, PB-896, PB-900, PB-901): the
 * viewer tab (diagram, 3D, narrow, and the domain views it offers:
 * schematic, PCB, pair), the Inspector's selection card, the DRC panel and
 * the CAD viewer tab (a GLB, and a STEP drawn from the GLB beside it), each
 * in Dark Modern, Light Modern, High Contrast (dark and light), Protoboard
 * Dark and Protoboard Light. The parts views (Library, part detail, Cloud,
 * BOM) are @protoboardai/views components with captures of their own.
 *
 *   # 1. the token sets, read from a real VS Code by the integration test
 *   PROTOBOARD_TOKENS_OUT=/tmp/tokens.json npm run test:integration
 *   # 2. the captures (needs the shell built: npm run build -w @protoboardai/web-viewer, then node esbuild.mjs)
 *   npx tsx test/visual/capture.ts --tokens /tmp/tokens.json --out /tmp/captures [--examples smart-bottle,quadcopter-5in] [--port 5390]
 *   # only some of them (viewer, devproblem, inspector, cad, drc, isolate, module3d); isolate and module3d (PB-946,
 *   # PB-897) open a module's own tab: [--only isolate,module3d] [--module <instance path>]
 *   # a project that names parts it does not hold (PB-931), never by default: --only missing --examples <such a project>
 *   # the canvas driven as a person drives it (round 5: selection box, tools, keys, menus, chevron, tooltips, the
 *   # source path, the first view), each step checked and captured, never by default: --only interactions
 *
 * The pages get what a webview gets: VS Code's default webview styles, the
 * `--vscode-*` variables on <html>, the body's theme class and theme id, and
 * an `acquireVsCodeApi` stand-in. The viewer tab reads a real `protoboard
 * dev` started here on its own ports. Chrome: $CHROME or an installed Chrome, Chromium, Edge or Brave.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findBrowser, noBrowserMessage } from "@protoboardai/core/browser";
import { DEFAULT_QUERY, drcModel, findings, pageModel } from "../../src/drc.js";
import { appHtml } from "../../src/appPage.js";
import { interfaceCard, libraryPartCard, linkHarnessDefs, moduleCard, linkCard, partCard } from "../../src/inspector.js";
import { detailFiles, interfaceArtifacts, resourceRoots, smallModel } from "../../src/inspectorFiles.js";
import { pageContent, type InspectorContent } from "../../src/inspector.js";
import { indexProject, readBuild } from "../../src/model.js";
import { loadCodeReference } from "../../src/codes.js";
import { buildTree, nodeMap, walk } from "../../src/tree.js";
import { devOrigins, viewerPageHtml } from "../../src/viewerPage.js";
import { cadSource, cadViewerHtml } from "../../src/cadFiles.js";
import { webviewPage, type TokenSet } from "./webview-page.js";

// $CHROME, else an installed Chrome, Chromium, Edge or Brave on this OS (core's lookup)
const chromePath = (): string => findBrowser()?.path ?? (() => { throw new Error(noBrowserMessage()); })();

const PKG = fileURLToPath(new URL("../../", import.meta.url));
const REPO = resolve(PKG, "..", "..");
const { values } = parseArgs({ options: { tokens: { type: "string" }, out: { type: "string" }, examples: { type: "string" }, port: { type: "string" }, only: { type: "string" }, module: { type: "string" } } });
if (!values.tokens || !values.out) throw new Error("give --tokens <file> (from the integration test) and --out <dir>");
const OUT = resolve(values.out);
mkdirSync(OUT, { recursive: true });
const TOKENS = JSON.parse(readFileSync(values.tokens, "utf8")) as Record<string, TokenSet>;
const THEMES: [string, string][] = [
  ["vscode-dark", "Default Dark Modern"],
  ["vscode-light", "Default Light Modern"],
  ["vscode-hc-dark", "Default High Contrast"],
  ["vscode-hc-light", "Default High Contrast Light"],
  ["protoboard-dark", "Protoboard Dark"],
  ["protoboard-light", "Protoboard Light"],
];
const EXAMPLES = (values.examples ?? "smart-bottle,quadcopter-5in").split(",");
const PORT = Number(values.port ?? 5390);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const only = values.only?.split(",");
const want = (what: string) => !only || only.includes(what);

/** What VS Code adds to a webview page (webview-page.ts), in this run's token set for `theme`. */
function asWebview(html: string, theme: string, nonce: string, surface: "editor" | "sideBar" | "panel" = "editor"): string {
  const t = TOKENS[theme];
  if (!t) throw new Error(`no token set for ${theme} in ${values.tokens}`);
  return webviewPage(html, t, nonce, surface);
}

/** Files a build wrote below `dir` (in `out` folders). */
function outputsOf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : outputsOf(p);
    return dir.endsWith(`${sep}out`) ? [p] : [];
  });
}

// ---- the pages, by URL
const pages = new Map<string, string>();
const files: Record<string, string> = { "/webview/": join(PKG, "dist", "webview"), "/media/": join(PKG, "media"), "/dist/": join(PKG, "dist"), "/examples/": join(REPO, "examples") };
const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".html": "text/html", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };
/** Files by absolute path, as a webview's local resource roots give them: only below `fsRoots`. */
let fsRoots: string[] = [];
const fileUrl = (file: string) => `${ORIGIN}/fs${file.split(sep).map(encodeURIComponent).join("/")}`;
const refused: string[] = [];
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", ORIGIN).pathname;
  if (path.startsWith("/fs/")) {
    const file = normalize(decodeURIComponent(path.slice(3)));
    if (!fsRoots.some((r) => file === r || file.startsWith(r + sep)) || !existsSync(file) || !statSync(file).isFile()) {
      refused.push(file);
      res.writeHead(403);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" });
    return createReadStream(file).pipe(res);
  }
  if (path === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }
  const page = pages.get(path);
  if (page) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(page);
  }
  for (const [prefix, dir] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue;
    const file = normalize(join(dir, decodeURIComponent(path.slice(prefix.length))));
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) break;
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    return createReadStream(file).pipe(res);
  }
  res.writeHead(404);
  res.end();
});
await new Promise<void>((ok) => server.listen(PORT, "127.0.0.1", ok));

// ---- the examples: built, and served by protoboard dev on their own ports
const cli = join(REPO, "packages", "cli", "bin", "protoboard.mjs");
// the CAD runtime: PROTOBOARD_PYTHON, else the quadcopter's project runtime (`protoboard tools install cad`), else the CLI's own lookup
const quadCad = join(REPO, "examples", "quadcopter-5in", ".protoboard", "tools", "cad", "bin", "python");
const env = { ...process.env, ...(process.env.PROTOBOARD_PYTHON || !existsSync(quadCad) ? {} : { PROTOBOARD_PYTHON: quadCad }) };
const devs: ChildProcess[] = [];
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function dev(example: string, port: number): Promise<string> {
  const root = join(REPO, "examples", example);
  try {
    execFileSync(process.execPath, [cli, "build", "--format", "json"], { cwd: root, env, stdio: ["ignore", "ignore", "inherit"] });
  } catch (e) {
    // a build with findings exits 1 and still writes its bundle (a project that lacks parts is captured as it is)
    if ((e as { status?: number }).status !== 1 || !readBuild(root)) throw e;
  }
  const p = spawn(process.execPath, [cli, "dev", "--port", String(port), "--no-watch", "--host-origin", ORIGIN], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  devs.push(p);
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(url + "uhd-bundle.json")).ok) return url;
    } catch {
      /* not yet */
    }
    await settle(500);
  }
  throw new Error(`protoboard dev for ${example} did not start`);
}

const require = createRequire(import.meta.url);
const puppeteer = (() => {
  for (const from of [join(REPO, "..", "uhd-viewer", "package.json"), import.meta.url]) {
    try {
      return createRequire(from)("puppeteer-core");
    } catch {
      /* next */
    }
  }
  return require("puppeteer-core");
})();
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-rasterization", "--window-size=1600,1000"],
});
const report: Record<string, string[]> = {};
/** The artifact cards each selection drew: `<kind>:<image|model|icon>`. */
const cardReport: Record<string, string[]> = {};
/** A stand-in for the library's cache (nothing is in it here). */
const CACHE = join(OUT, ".cache");
const shots: string[] = [];

async function open(url: string, size: { width: number; height: number }) {
  const page = await browser.newPage();
  await page.setViewport({ ...size, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url, { waitUntil: "load" });
  return { page, errors };
}
async function shot(page: { screenshot(o: { path: string }): Promise<unknown> }, name: string) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  shots.push(path);
}

let port = PORT + 1;
try {
  for (const example of EXAMPLES) {
    const root = join(REPO, "examples", example);
    const url = await dev(example, port++);
    const build = readBuild(root);
    if (!build) throw new Error(`${example} has no build`);
    const index = indexProject(build.resolved, build.bundle);
    const tree = buildTree(index);
    const nodes = nodeMap(tree);
    const list = findings(index, build.resolved.diagnostics, loadCodeReference(root));
    // the module the Inspector shows: the first with modules and interfaces below the root, else the root's first
    const picked =
      [...walk(tree)].find((n) => n.type === "instance" && n.path && n.children.some((c) => c.type === "instance") && (index.bundleDefs.get(n.defId ?? "")?.interfaces?.length ?? 0) > 0) ??
      [...walk(tree)].find((n) => n.type === "instance" && n.path);
    const link = [...index.links.values()][0];
    for (const [tag, theme] of THEMES) {
      const nonce = `n${Math.random().toString(36).slice(2)}`;
      // the viewer tab: the top-level system, wide and narrow; the 3D view
      if (want("viewer")) {
        pages.set(
          `/viewer-${example}-${tag}.html`,
          asWebview(
            viewerPageHtml({ cspSource: ORIGIN, script: `${ORIGIN}/webview/protoboard-viewer.js`, style: `${ORIGIN}/webview/protoboard-viewer.css`, nonce, title: example, origins: devOrigins(url), config: { path: "", view: "diagram", media: `${ORIGIN}/media`, dev: { url, session: "" } } }),
            theme,
            nonce,
          ),
        );
        for (const size of [{ width: 1400, height: 860, tag: "" }, { width: 720, height: 560, tag: "-narrow" }]) {
          const { page, errors } = await open(`${ORIGIN}/viewer-${example}-${tag}.html`, size);
          try {
            await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 2, { timeout: 120000 });
          } catch {
            errors.push("diagram not drawn");
          }
          await settle(2500);
          await shot(page, `viewer-${example}-${tag}${size.tag}-diagram`);
          if (!size.tag) {
            // a module selected, as the Inspector shows it
            if (picked) {
              await page.evaluate((path: string) => window.postMessage({ type: "command", command: { type: "uhd-viewer:focus", path } }, "*"), picked.path);
              await settle(1500);
              await shot(page, `viewer-${example}-${tag}-selected`);
            }
            await page.evaluate(() => window.postMessage({ type: "showView", view: "3d" }, "*"));
            try {
              await page.waitForFunction(() => document.querySelector(".cad-canvas canvas"), { timeout: 60000 });
            } catch {
              errors.push("3d not drawn");
            }
            await settle(8000);
            await shot(page, `viewer-${example}-${tag}-3d`);
            // the domain views the tab offers at this level (PB-898, PB-905)
            const offered = (await page.evaluate(() => {
              const states = (window as unknown as { __posted: { type: string; views?: { id: string }[] }[] }).__posted.filter((m) => m.type === "state");
              return (states[states.length - 1]?.views ?? []).map((v) => v.id);
            })) as string[];
            for (const view of ["schematic", "pcb", "pair"].filter((v) => offered.includes(v))) {
              await page.evaluate((v: string) => window.postMessage({ type: "showView", view: v }, "*"), view);
              await settle(view === "pair" ? 2500 : 4000);
              await shot(page, `viewer-${example}-${tag}-${view}`);
            }
          }
          const posted = (await page.evaluate(() => (window as unknown as { __posted: { type: string }[] }).__posted.map((m) => m.type))) as string[];
          if (!posted.includes("state")) errors.push("the tab never reported its state");
          report[`viewer-${example}-${tag}${size.tag}`] = errors;
          await page.close();
        }
      }
      // PB-1018: the PCB tab of a routed board, driven as a person drives it, each step checked and captured
      if (only?.includes("pcb") && ["protoboard-dark", "protoboard-light", "vscode-hc-dark"].includes(tag)) {
        const boardDef = [...index.artifacts.entries()].find(([, list]) => list.some((a) => a.present === true && a.resolved?.endsWith("/circuit.json")))?.[0];
        const boardAt = boardDef ? [...index.instances.values()].find((i) => i.definition === boardDef)?.path : undefined;
        if (boardAt === undefined) report[`pcb-${example}-${tag}`] = ["no routed board in this example"];
        else {
          const name = (step: string) => `pcb-${example}-${tag}-${step}`;
          for (const view of ["pcb", "schematic"]) {
            pages.set(
              `/${view}-${example}-${tag}.html`,
              asWebview(viewerPageHtml({ cspSource: ORIGIN, script: `${ORIGIN}/webview/protoboard-viewer.js`, style: `${ORIGIN}/webview/protoboard-viewer.css`, nonce, title: example, origins: devOrigins(url), config: { path: boardAt, view, media: `${ORIGIN}/media`, dev: { url, session: "" } } }), theme, nonce),
            );
          }
          const { page, errors } = await open(`${ORIGIN}/pcb-${example}-${tag}.html`, { width: 1400, height: 860 });
          const check = (ok: unknown, what: string) => void (ok ? undefined : errors.push(what));
          const count = (sel: string) => page.evaluate((q: string) => document.querySelectorAll(q).length, sel) as Promise<number>;
          try {
            await page.waitForFunction(() => document.querySelectorAll("[data-pb-pcb] [data-layer^='copper:'] > *").length > 50, { timeout: 120000 });
          } catch {
            errors.push("the routed board was not drawn");
          }
          await settle(1500);
          await shot(page, name("board"));
          // the layers, each its own toggle: every copper layer of the board is listed
          const toggles = (await page.evaluate(() => [...document.querySelectorAll("[data-layer-toggle]")].map((b) => b.getAttribute("data-layer-toggle")))) as string[];
          check(["copper:top", "copper:inner1", "copper:inner2", "copper:bottom", "silk:top", "courtyard:top", "fab:top"].every((l) => toggles.includes(l)), `layer toggles: ${toggles.join(", ")}`);
          await page.click("[data-layer-toggle='copper:top']");
          await page.click("[data-layer-toggle='silk:top']");
          await settle(500);
          check((await count("[data-layer='copper:top']")) === 0 && (await count("[data-layer='copper:inner1']")) === 1, "top copper did not turn off alone");
          await shot(page, name("layers-inner"));
          await page.click("[data-layer-toggle='copper:top']");
          await page.click("[data-layer-toggle='silk:top']");
          await page.click("[data-layer-toggle='courtyard:top']");
          await page.click("[data-layer-toggle='fab:top']").catch(() => undefined);
          await settle(500);
          check((await count("[data-layer='courtyard:top'] > *")) > 0, "the courtyard layer did not turn on");
          await shot(page, name("layers-courtyard-fab"));
          await page.click("[data-layer-toggle='courtyard:top']");
          // a net: a click on a trace holds it, lit across the board, with its name
          const trace = await page.$("[data-layer='copper:top'] polyline[data-net]");
          if (trace) {
            await trace.click().catch((e: Error) => errors.push(`a trace could not be clicked: ${e.message}`));
            await settle(600);
            const netName = (await page.evaluate(() => document.querySelector("[data-pb-net]")?.textContent ?? "")) as string;
            check(netName.length > 0, "no net name shown for a clicked trace");
            await shot(page, name("net"));
          } else errors.push("no trace to click");
          // a component: a click on one of its pads shows its reference, part and footprint, and posts the selection
          // dispatched on the pad itself: at a pad's centre another piece may lie above it (a via, a drill)
          const clicked = (await page.evaluate(() => {
            const pad = document.querySelector("[data-layer='copper:top'] rect[data-ref='u1']");
            pad?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return !!pad;
          })) as boolean;
          check(clicked, "no pad of u1 to click");
          await settle(800);
          const card = (await page.evaluate(() => document.querySelector("[data-pb-component]")?.textContent ?? "")) as string;
          check(/Reference/.test(card) && /Footprint/.test(card) && /Part/.test(card), `the component card says: ${card.slice(0, 160)}`);
          const posted = (await page.evaluate(() => JSON.stringify((window as unknown as { __posted: unknown[] }).__posted))) as string;
          check(/uhd-viewer:selectionChanged[^]*"id":"[^"]*u1"/.test(posted), "the selection was not posted to the extension");
          await shot(page, name("component"));
          // the board check's findings, at their place
          const located = await count("[data-finding]");
          check((await count("[data-pb-findings]")) === 1 && located > 0, `findings listed and placed: ${located}`);
          await page.click("[data-pb-findings] button[data-tooltip='Show it on the board']").catch(() => errors.push("no finding to show"));
          await settle(700);
          await shot(page, name("finding"));
          // zoom as on the canvas (the wheel about the pointer), then the board seen from below
          await page.evaluate(() => (document.querySelector("[aria-label='Fit']") as HTMLButtonElement | null)?.click());
          await page.mouse.move(700, 430);
          for (let i = 0; i < 6; i++) await page.mouse.wheel({ deltaY: -240 });
          await settle(600);
          await shot(page, name("zoom"));
          await page.evaluate(() => (document.querySelector("[aria-label='Fit']") as HTMLButtonElement | null)?.click());
          await page.evaluate(() => (document.querySelector("[aria-label='Seen from below']") as HTMLButtonElement | null)?.click());
          await settle(800);
          await shot(page, name("below"));
          // nothing scrolls with the browser's own bars
          const bars = (await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => { const c = getComputedStyle(e); return /(auto|scroll)/.test(c.overflowY + c.overflowX) && e.scrollHeight > e.clientHeight + 1 && !e.closest("[data-radix-scroll-area-viewport]") && !e.matches("[data-radix-scroll-area-viewport]"); }).length)) as number;
          check(bars === 0, `${bars} element(s) scroll with the browser's own bars`);
          report[`pcb-${example}-${tag}`] = errors;
          await page.close();
          // the schematic tab of the same board: the same routed build's drawing
          const sch = await open(`${ORIGIN}/schematic-${example}-${tag}.html`, { width: 1400, height: 860 });
          await sch.page.waitForFunction(() => document.querySelector(".pb-drawing svg"), { timeout: 60000 }).catch(() => sch.errors.push("the schematic was not drawn"));
          await settle(2000);
          await shot(sch.page, `schematic-${example}-${tag}`);
          report[`schematic-${example}-${tag}`] = sch.errors;
          await sch.page.close();
        }
      }
      // Round 5 (the 2026-10-08 first builds, items 10, 13, 29, 30, 31, 32): the canvas driven as a person drives it.
      // Each step checks what it did and is captured; what did not hold is in the report. Only when asked for
      // (`--only interactions`).
      if (only?.includes("interactions")) {
        pages.set(
          `/interact-${example}-${tag}.html`,
          asWebview(viewerPageHtml({ cspSource: ORIGIN, script: `${ORIGIN}/webview/protoboard-viewer.js`, style: `${ORIGIN}/webview/protoboard-viewer.css`, nonce, title: example, origins: devOrigins(url), config: { path: "", view: "diagram", media: `${ORIGIN}/media`, dev: { url, session: "" } } }), theme, nonce),
        );
        const { page, errors } = await open(`${ORIGIN}/interact-${example}-${tag}.html`, { width: 1400, height: 860 });
        const name = (step: string) => `interact-${example}-${tag}-${step}`;
        const check = (ok: unknown, what: string) => void (ok ? undefined : errors.push(what));
        const drawn = async () => {
          try {
            await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 1, { timeout: 120000 });
          } catch {
            errors.push("diagram not drawn");
          }
          await settle(1500);
        };
        await drawn();
        type Rect = { x: number; y: number; w: number; h: number; id: string; holds: boolean; described: boolean };
        const rects = () =>
          page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((el) => {
              const r = el.getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height, id: el.dataset.id ?? "", holds: !!el.querySelector(".node-chevron"), described: !!el.querySelector(".node-info") };
            }),
          ) as Promise<Rect[]>;
        const selected = () => page.evaluate(() => document.querySelectorAll(".react-flow__node .selected").length) as Promise<number>;
        const transform = () => page.evaluate(() => (document.querySelector(".react-flow__viewport") as HTMLElement | null)?.style.transform ?? "") as Promise<string>;
        const posted = (type: string) => page.evaluate((t: string) => (window as unknown as { __posted: { type: string; event?: { type: string }; action?: string }[] }).__posted.filter((m) => m.type === t || m.event?.type === t).length, type) as Promise<number>;
        /** A point of the empty canvas near (x, y): the nearest on a coarse grid where nothing else is under the pointer. */
        const empty = (x: number, y: number) =>
          page.evaluate(
            (x0: number, y0: number) => {
              let best: { x: number; y: number; d: number } | undefined;
              for (let x = 40; x < innerWidth - 40; x += 20)
                for (let y = 70; y < innerHeight - 90; y += 20) {
                  if (!document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) continue;
                  const d = Math.hypot(x - x0, y - y0);
                  if (!best || d < best.d) best = { x, y, d };
                }
              return best ?? { x: x0, y: y0 };
            },
            x,
            y,
          ) as Promise<{ x: number; y: number }>;
        const drag = async (from: { x: number; y: number }, to: { x: number; y: number }, button: "left" | "middle" = "left", during?: () => Promise<void>) => {
          await page.mouse.move(from.x, from.y);
          await page.mouse.down({ button });
          await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
          await page.mouse.move(to.x, to.y, { steps: 6 });
          if (during) await during();
          await page.mouse.up({ button });
          await settle(350);
        };

        // item 32: a level with no saved viewport opens fitted: every module is inside the tab
        const first = await rects();
        check(first.length > 1 && first.every((r) => r.x >= 0 && r.y >= 40 && r.x + r.w <= 1400 && r.y + r.h <= 860), "first open: the diagram is not fitted to the tab");
        check(first.some((r) => r.holds), "no module shows the chevron of one that holds modules");
        check((await page.evaluate(() => document.querySelectorAll(".react-flow__node [title]").length)) === 0, "a node still has a browser tooltip (title)");

        // item 30: a description on hover, in the theme's tooltip, two lines at most
        const described = first.find((r) => r.described);
        if (described) {
          await page.mouse.move(described.x + described.w / 2, described.y + described.h / 2);
          await settle(1100);
          const tip = (await page.evaluate(() => {
            const t = document.querySelector<HTMLElement>(".uhd-tooltip");
            const text = t?.querySelector<HTMLElement>(".uhd-tooltip-text");
            return t && text ? { lines: Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)), width: t.getBoundingClientRect().width } : null;
          })) as { lines: number; width: number } | null;
          check(tip, "no themed tooltip for a module's description");
          check(!tip || (tip.lines <= 2 && tip.width <= 312), `the description's tooltip is not capped (${tip?.lines} lines, ${tip?.width}px)`);
          await shot(page, name("tooltip"));
        } else errors.push("no module with a description to hover");
        await page.mouse.move(700, 60);

        // item 10: a left-drag on the empty canvas draws a selection box (captured while it is drawn)
        const before = await transform();
        const box = first.reduce((a, r) => ({ x0: Math.min(a.x0, r.x), y0: Math.min(a.y0, r.y), x1: Math.max(a.x1, r.x + r.w), y1: Math.max(a.y1, r.y + r.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        const corner = await empty(box.x0 - 30, box.y0 - 10);
        await drag(corner, { x: Math.min(1380, box.x1 + 20), y: Math.min(760, box.y1 + 20) }, "left", async () => {
          check(await page.evaluate(() => !!document.querySelector(".react-flow__selection")), "a left-drag on the empty canvas draws no selection box");
          await shot(page, name("box-select"));
        });
        check((await selected()) >= 2, `the selection box selected ${await selected()} modules`);
        check((await transform()) === before, "the selection box moved the view");
        await page.keyboard.press("Escape");
        await settle(200);
        check((await selected()) === 0, "Escape does not clear the selection");

        // Shift+click adds to the selection; Ctrl+A selects every module
        const plain = first.filter((r) => !r.holds).slice(0, 2);
        if (plain.length === 2) {
          await page.mouse.click(plain[0].x + plain[0].w / 2, plain[0].y + plain[0].h - 10);
          await page.keyboard.down("Shift");
          await page.mouse.click(plain[1].x + plain[1].w / 2, plain[1].y + plain[1].h - 10);
          await page.keyboard.up("Shift");
          await settle(250);
          check((await selected()) === 2, `Shift+click selected ${await selected()} modules, not 2`);
        }
        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
        await settle(250);
        check((await selected()) >= first.length - 1, `Ctrl+A selected ${await selected()} of ${first.length}`);
        await shot(page, name("select-all"));
        // the arrow keys nudge what is selected: the layout is edited (the tab would turn dirty)
        const edits = await posted("edit");
        await page.keyboard.press("ArrowRight");
        await settle(700);
        check((await posted("edit")) > edits, "an arrow key does not nudge the selected modules");
        await page.keyboard.press("Escape");
        await settle(200);
        check((await selected()) === 0, "Escape does not clear a selection of several");

        // the middle button pans; Space held makes a left-drag pan; so does the pan tool
        const from = await empty(120, 300);
        let at = await transform();
        await drag(from, { x: from.x + 90, y: from.y + 50 }, "middle");
        check((await transform()) !== at, "a middle-button drag does not pan");
        at = await transform();
        await page.keyboard.down("Space");
        await drag(await empty(120, 300), { x: 220, y: 380 });
        await page.keyboard.up("Space");
        check((await transform()) !== at && (await selected()) === 0, "Space + left-drag does not pan");
        await page.click("[aria-label^='Pan']");
        at = await transform();
        const grab = await empty(120, 300);
        await drag(grab, { x: grab.x - 60, y: grab.y - 40 });
        check((await transform()) !== at && (await selected()) === 0, "the pan tool does not pan with a left-drag");
        check(await page.evaluate(() => document.querySelector("[aria-label^='Pan']")?.getAttribute("aria-pressed") === "true"), "the pan tool's button is not pressed");
        await page.mouse.move(700, 800);
        await settle(600);
        await shot(page, name("pan-tool"));
        await page.keyboard.press("v");
        await settle(150);
        check(await page.evaluate(() => document.querySelector("[aria-label^='Select']")?.getAttribute("aria-pressed") === "true"), "V does not choose the select tool");

        // item 32: the view the user left is kept with the tab and comes back when its page loads again
        const left = await transform();
        await page.reload({ waitUntil: "load" });
        await drawn();
        const numbers = (t: string) => (t.match(/-?[\d.]+/g) ?? []).map(Number);
        const back = numbers(await transform());
        check(back.length === 3 && numbers(left).every((n, i) => Math.abs(n - back[i]) < 0.02), `a saved viewport is not put back (left at ${left}, back at ${await transform()})`);
        // a fit asked for (F) is the diagram's own view again
        await page.keyboard.press("f");
        await settle(700);
        const fitted = await rects();
        check(fitted.every((r) => r.x >= 0 && r.y >= 40 && r.x + r.w <= 1400 && r.y + r.h <= 860), "F does not fit the diagram");

        // the empty canvas's menu; a module's menu has Inspect, which goes to the extension
        const pane = await empty(120, 300);
        await page.mouse.click(pane.x, pane.y, { button: "right" });
        await settle(250);
        const paneMenu = (await page.evaluate(() => [...document.querySelectorAll(".context-menu .context-menu-label")].map((b) => b.textContent))) as string[];
        check(paneMenu.includes("Fit view") && paneMenu.includes("Select all"), `the empty canvas's menu is ${JSON.stringify(paneMenu)}`);
        await page.keyboard.press("Escape");
        const leaf = fitted.find((r) => !r.holds && r.w > 100);
        const holder = fitted.find((r) => r.holds);
        if (leaf) {
          await page.mouse.click(leaf.x + leaf.w / 2, leaf.y + leaf.h - 10, { button: "right" });
          await settle(300);
          const menu = (await page.evaluate(() => [...document.querySelectorAll(".context-menu .context-menu-label")].map((b) => b.textContent))) as string[];
          check(menu[0] === "Inspect", `a module's menu is ${JSON.stringify(menu)}`);
          check(!menu.includes("Open in new tab"), "a part with nothing inside offers Open in new tab");
          await shot(page, name("node-menu"));
          await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".context-menu button")].find((b) => b.querySelector(".context-menu-label")?.textContent === "Inspect")?.click());
          await settle(200);
          check((await posted("uhd-viewer:inspect")) === 1, "Inspect did not reach the extension");
          // item 13 (D8): a double-click on a part with nothing inside opens nothing
          await page.mouse.click(leaf.x + leaf.w / 2, leaf.y + leaf.h - 10, { count: 2 });
          await settle(300);
          check((await posted("uhd-viewer:openModule")) === 0, "a double-click on a part with nothing inside asked for a tab");
        }
        if (holder) {
          // a double-click on a module that holds modules opens it; a click on its chevron expands it in place
          await page.mouse.click(holder.x + holder.w / 2, holder.y + holder.h - 10, { count: 2 });
          await settle(300);
          check((await posted("uhd-viewer:openModule")) === 1, "a double-click on a module that holds modules did not ask for its tab");
          const opened = await posted("uhd-viewer:openModule");
          await page.mouse.move(holder.x + 12, holder.y + 12);
          await settle(700);
          await shot(page, name("chevron"));
          await page.mouse.click(holder.x + 12, holder.y + 12);
          await settle(1200);
          check(await page.evaluate(() => !!document.querySelector(".module-container")), "a click on the chevron did not expand the module in place");
          check((await posted("uhd-viewer:openModule")) === opened, "a click on the chevron asked for a tab");
          await page.mouse.move(700, 800);
          await page.keyboard.press("f");
          await settle(900);
          await shot(page, name("expanded"));
        }

        // item 29: the module's source file in the header, once the extension says it; a click asks to open it
        await page.evaluate(() => window.postMessage({ type: "source", path: "", source: { file: "src/system.uhd.ts", line: 12 } }, "*"));
        await settle(300);
        check(await page.evaluate(() => document.querySelector("[data-source-path]")?.getAttribute("data-source-path") === "src/system.uhd.ts"), "the header does not show the module's source file");
        await page.click("[data-source-path] button").catch(() => errors.push("the source path is not a button"));
        check(await page.evaluate(() => (window as unknown as { __posted: { type: string; action?: string }[] }).__posted.some((m) => m.type === "source" && m.action === "open")), "a click on the source path did not ask to open it");
        await page.hover("[data-source-path] button").catch(() => undefined);
        await settle(700);
        await shot(page, name("source-path"));
        check((await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight)) === false, "the page scrolls");
        report[`interact-${example}-${tag}`] = errors;
        await page.close();
      }
      // PB-946, PB-897: a legend entry isolated on a module's level, and that module's own 3D tab (the module
      // alone, the card that says what is shown, X-ray where it has something to see through), wide and narrow.
      // `--module <instance path>` picks the module (default: the first board, else the first module with modules).
      if (want("isolate") || want("module3d")) {
        const safe = example.replace(/[^\w-]+/g, "_");
        const top = [...walk(tree)].filter((n) => n.type === "instance" && n.path && !n.path.includes("/") && n.children.some((c) => c.type === "instance"));
        const modulePath = values.module ?? (top.find((n) => /board/i.test(`${n.defId} ${n.label}`)) ?? top[0] ?? picked)?.path ?? "";
        const pageFor = (view: string) =>
          asWebview(viewerPageHtml({ cspSource: ORIGIN, script: `${ORIGIN}/webview/protoboard-viewer.js`, style: `${ORIGIN}/webview/protoboard-viewer.css`, nonce, title: example, origins: devOrigins(url), config: { path: modulePath, view, media: `${ORIGIN}/media`, dev: { url, session: "" } } }), theme, nonce);
        pages.set(`/isolate-${safe}-${tag}.html`, pageFor("diagram"));
        pages.set(`/module3d-${safe}-${tag}.html`, pageFor("3d"));
        for (const size of [{ width: 1400, height: 860, tag: "" }, { width: 720, height: 560, tag: "-narrow" }]) {
          if (want("isolate")) {
            const { page, errors } = await open(`${ORIGIN}/isolate-${safe}-${tag}.html`, size);
            try {
              await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 2, { timeout: 120000 });
            } catch {
              errors.push("diagram not drawn");
            }
            await settle(2000);
            // the legend is folded on a narrow tab: open it, colour by signal type, isolate the first entry the level has;
            // where it has no room beside the toolbar it is the toolbar's legend button, which opens it as a popover
            // (the legend's hidden measuring copies are inert: never clicked)
            // (a string, not a function: the test runner's transform adds helpers to named functions that the page does not have)
            const isolated = (await page.evaluate(`(async () => {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const live = (sel) => [...document.querySelectorAll(sel)].filter((e) => !e.closest("[inert]"));
              const click = (sel) => { const el = live(sel)[0]; if (el) el.click(); };
              click('[data-legend-slot] button');
              await wait(300);
              click('[aria-label="Legend"][data-legend-tab]');
              await wait(200);
              click('[aria-label="Colour by signal type"]');
              await wait(400);
              const items = live(".uhd-legend-item");
              const entry = items.find((b) => b.getAttribute("aria-disabled") !== "true");
              if (entry) entry.click();
              await wait(500);
              const nodes = document.querySelectorAll(".react-flow__node").length;
              const out = document.querySelectorAll(".react-flow__node.isolated-out").length;
              const legend = live(".legend, .legend-popover")[0].getBoundingClientRect();
              return { entry: entry ? entry.textContent || entry.getAttribute("aria-label") : undefined, pressed: entry ? entry.getAttribute("aria-pressed") : undefined, items: items.length, nodes, out, clear: !!document.querySelector('[aria-label="Show all"]'), legend: { left: legend.left, right: legend.right, top: legend.top, bottom: legend.bottom }, w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth };
            })()`)) as { entry?: string; pressed?: string; items: number; nodes: number; out: number; clear: boolean; legend: { left: number; right: number; top: number; bottom: number }; w: number; h: number; sw: number };
            if (!isolated.entry || isolated.pressed !== "true") errors.push(`no legend entry was isolated: ${JSON.stringify(isolated)}`);
            if (!(isolated.out > 0 && isolated.out < isolated.nodes)) errors.push(`isolating ${isolated.entry} faded ${isolated.out} of ${isolated.nodes} nodes`);
            if (!isolated.clear) errors.push("no control to show everything again");
            if (isolated.legend.left < 0 || isolated.legend.right > isolated.w || isolated.legend.top < 0 || isolated.legend.bottom > isolated.h || isolated.sw > isolated.w) errors.push(`the legend overflows the tab: ${JSON.stringify(isolated)}`);
            await shot(page, `isolate-${safe}-${tag}${size.tag}`);
            if (!size.tag) {
              // an entry's tooltip, then Escape: everything is back
              await page.hover(".uhd-legend-item[aria-pressed='true']").catch(() => undefined);
              await settle(900);
              await shot(page, `isolate-${safe}-${tag}-tooltip`);
            }
            await page.keyboard.press("Escape");
            await settle(400);
            // (the popover closes on the first Escape and keeps the isolation; a second one clears it)
            if ((await page.evaluate(() => !!document.querySelector(".legend-popover"))) as boolean) {
              await page.keyboard.press("Escape");
              await settle(400);
            }
            const left = (await page.evaluate(() => document.querySelectorAll(".react-flow__node.isolated-out").length + [...document.querySelectorAll(".uhd-legend-item[aria-pressed='true']")].filter((e) => !e.closest("[inert]")).length)) as number;
            if (left) errors.push(`Escape left ${left} things isolated`);
            report[`isolate-${safe}-${tag}${size.tag}`] = errors;
            await page.close();
          }
          if (want("module3d")) {
            const { page, errors } = await open(`${ORIGIN}/module3d-${safe}-${tag}.html`, size);
            try {
              await page.waitForFunction(() => document.querySelector(".cad-canvas canvas") && (document.querySelector(".cad-scope") || document.querySelector(".cad-empty")), { timeout: 90000 });
            } catch {
              errors.push("the module's 3D view did not say what it shows");
            }
            await settle(7000);
            const said = (await page.evaluate(`(() => {
              const r = (el) => { if (!el) return undefined; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
              const xray = document.querySelector('[aria-label^="X-ray"]');
              const text = (sel) => { const el = document.querySelector(sel); return el ? el.textContent : undefined; };
              return { scope: text(".cad-scope"), empty: text(".cad-empty"), xray: xray ? xray.getAttribute("aria-label") : undefined, xrayOff: !!xray && xray.getAttribute("aria-disabled") === "true", card: r(document.querySelector(".cad-scope") || document.querySelector(".cad-empty")), toolbar: r(document.querySelector(".cad-toolbar")), w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth };
            })()`)) as { scope?: string; empty?: string; xray?: string; xrayOff: boolean; card?: { left: number; right: number; top: number; bottom: number }; toolbar?: { left: number; right: number }; w: number; h: number; sw: number };
            if (!said.scope && !said.empty) errors.push("neither a card that says what is shown nor an empty state");
            if (!said.xray) errors.push("no X-ray control");
            if (said.card && (said.card.left < 0 || said.card.right > said.w || said.sw > said.w)) errors.push(`the card overflows the tab: ${JSON.stringify(said)}`);
            console.log(`[capture] ${safe} ${modulePath || "(root)"} 3D, ${tag}${size.tag}: ${said.scope ?? said.empty}; ${said.xray}`);
            await shot(page, `module3d-${safe}-${tag}${size.tag}`);
            if (!size.tag) {
              await page.hover('[aria-label^="X-ray"]').catch(() => undefined);
              await settle(900);
              await shot(page, `module3d-${safe}-${tag}-xray-tooltip`);
            }
            report[`module3d-${safe}-${tag}${size.tag}`] = errors;
            await page.close();
          }
        }
      }
      // PB-931: a project that names parts it does not hold (a template made with the part library out of reach):
      // the tab draws, the notice says what is missing and fits the tab, and the module's level shows the
      // placeholders. Only when asked for (`--only missing`), on a project that lacks parts.
      if (only?.includes("missing")) {
        const safe = example.replace(/[^\w-]+/g, "_");
        const top = [...walk(tree)].filter((n) => n.type === "instance" && n.path && !n.path.includes("/") && n.children.some((c) => c.type === "instance"));
        const modulePath = values.module ?? (top.find((n) => /board/i.test(`${n.defId} ${n.label}`)) ?? top[0])?.path ?? "";
        for (const [level, path] of [["top", ""], ["module", modulePath]] as const) {
          pages.set(
            `/missing-${level}-${safe}-${tag}.html`,
            asWebview(viewerPageHtml({ cspSource: ORIGIN, script: `${ORIGIN}/webview/protoboard-viewer.js`, style: `${ORIGIN}/webview/protoboard-viewer.css`, nonce, title: example, origins: devOrigins(url), config: { path, view: "diagram", media: `${ORIGIN}/media`, dev: { url, session: "" } } }), theme, nonce),
          );
          for (const size of [{ width: 1400, height: 860, tag: "" }, { width: 720, height: 560, tag: "-narrow" }]) {
            const { page, errors } = await open(`${ORIGIN}/missing-${level}-${safe}-${tag}.html`, size);
            try {
              await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 2 && document.querySelector(".missing-notice"), { timeout: 120000 });
            } catch {
              errors.push("the tab did not draw a project that lacks parts, or did not say so");
            }
            await settle(2000);
            const seen = (await page.evaluate(`(() => {
              const n = document.querySelector(".missing-notice");
              const r = n ? n.getBoundingClientRect() : undefined;
              const states = window.__posted.filter((m) => m.type === "state");
              return {
                notice: n ? n.innerText.replace(/\\s+/g, " ").slice(0, 160) : "",
                count: n ? Number(n.dataset.missing) : 0,
                box: r ? { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) } : undefined,
                w: window.innerWidth, h: window.innerHeight, sw: document.documentElement.scrollWidth,
                placeholders: document.querySelectorAll(".module-card.missing").length,
                cards: document.querySelectorAll(".module-card").length,
                failed: !!document.querySelector(".draw-error"),
                posted: states.length ? states[states.length - 1].missing : undefined,
              };
            })()`)) as { notice: string; count: number; box?: { left: number; right: number; top: number; bottom: number }; w: number; h: number; sw: number; placeholders: number; cards: number; failed: boolean; posted?: number };
            if (seen.failed) errors.push("the tab says the bundle could not be drawn");
            if (!(seen.count > 0)) errors.push(`the notice names no missing definitions: ${JSON.stringify(seen)}`);
            if (seen.posted !== seen.count) errors.push(`the tab told the extension ${seen.posted} are missing; the notice says ${seen.count}`);
            if (seen.box && (seen.box.left < 0 || seen.box.right > seen.w || seen.box.top < 0 || seen.box.bottom > seen.h || seen.sw > seen.w)) errors.push(`the notice overflows the tab: ${JSON.stringify(seen)}`);
            if (level === "module" && !(seen.placeholders > 0 && seen.placeholders <= seen.cards)) errors.push(`the module's level shows ${seen.placeholders} placeholders among ${seen.cards} cards`);
            if (tag === THEMES[0][0]) console.error(`[capture] ${example} ${level} level, ${tag}${size.tag}: ${seen.cards} cards, ${seen.placeholders} placeholders; "${seen.notice}"`);
            await shot(page, `missing-${level}-${safe}-${tag}${size.tag}`);
            if (!size.tag && level === "top") {
              // put away: the notice goes, the diagram stays
              await page.click(".missing-notice button");
              await settle(400);
              if (await page.evaluate(() => !!document.querySelector(".missing-notice"))) errors.push("the notice could not be put away");
            }
            report[`missing-${level}-${safe}-${tag}${size.tag}`] = errors;
            await page.close();
          }
        }
      }
      // the dev server message (PB-943): in the middle of the tab, with what the dev server is and what to try
      if (want("devproblem") && example === EXAMPLES[0]) {
        const page0 = (dev: { url: string; session: string } | undefined) =>
          asWebview(viewerPageHtml({ cspSource: ORIGIN, script: `${ORIGIN}/webview/protoboard-viewer.js`, style: `${ORIGIN}/webview/protoboard-viewer.css`, nonce, title: example, origins: devOrigins(url), config: { path: "", view: "diagram", media: `${ORIGIN}/media`, ...(dev ? { dev } : {}) } }), theme, nonce);
        // nothing listens on the port the tab was given: no drawing yet
        pages.set(`/devproblem-none-${tag}.html`, page0({ url: "http://127.0.0.1:9/", session: "" }));
        pages.set(`/devproblem-lost-${tag}.html`, page0({ url, session: "" }));
        const errorsOf: string[] = [];
        for (const size of [{ width: 1400, height: 860, tag: "" }, { width: 360, height: 300, tag: "-small" }]) {
          const { page } = await open(`${ORIGIN}/devproblem-none-${tag}.html`, size);
          try {
            await page.waitForSelector("[data-dev-problem]", { timeout: 30000 });
          } catch {
            errorsOf.push("no dev server message for an unreachable server");
          }
          await settle(600);
          await shot(page, `devproblem-unreachable-${tag}${size.tag}`);
          const box = (await page.evaluate(() => {
            const r = document.querySelector("[data-dev-problem]")?.getBoundingClientRect();
            const head = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
            return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: innerWidth, h: innerHeight, head, left: r.left, right: r.right, top: r.top, bottom: r.bottom, sw: document.documentElement.scrollWidth } : undefined;
          })) as { cx: number; cy: number; w: number; h: number; head: number; left: number; right: number; top: number; bottom: number; sw: number } | undefined;
          if (!box || Math.abs(box.cx - box.w / 2) > 2 || Math.abs(box.cy - (box.head + box.h) / 2) > 6) errorsOf.push(`the message is not centred under the header at ${size.width}x${size.height}: ${JSON.stringify(box)}`);
          if (box && (box.left < 0 || box.right > box.w || box.top < box.head || box.bottom > box.h || box.sw > box.w)) errorsOf.push(`the message overflows or sits under the header at ${size.width}x${size.height}: ${JSON.stringify(box)}`);
          const pressed = (await page.evaluate(() => {
            for (const b of document.querySelectorAll<HTMLButtonElement>("[data-dev-problem] button")) b.click();
            return (window as unknown as { __posted: { type: string; action?: string }[] }).__posted.filter((m) => m.type === "devAction").map((m) => m.action);
          })) as string[];
          if (pressed.join() !== "retry,reload,showLog") errorsOf.push(`the buttons posted ${pressed.join()}`);
          await page.close();
        }
        {
          // the drawing is there and the extension says the server exited: the message is over the middle of it
          const { page } = await open(`${ORIGIN}/devproblem-lost-${tag}.html`, { width: 1400, height: 860 });
          try {
            await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 2, { timeout: 120000 });
          } catch {
            errorsOf.push("diagram not drawn");
          }
          await settle(1500);
          await page.evaluate(() => window.postMessage({ type: "dev", dev: null, message: "The dev server exited (code 1); the Protoboard log has its output." }, "*"));
          await settle(500);
          await shot(page, `devproblem-exited-${tag}`);
          await page.hover("[data-dev-problem] button:nth-of-type(3)");
          await settle(900);
          await shot(page, `devproblem-exited-${tag}-tooltip`);
          const box = (await page.evaluate(() => {
            const r = document.querySelector("[data-dev-problem]")?.getBoundingClientRect();
            const head = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
            return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: innerWidth, h: innerHeight, head } : undefined;
          })) as { cx: number; cy: number; w: number; h: number; head: number } | undefined;
          if (!box || Math.abs(box.cx - box.w / 2) > 2 || Math.abs(box.cy - (box.head + box.h) / 2) > 6) errorsOf.push(`the message over the drawing is not centred: ${JSON.stringify(box)}`);
          // a rebuild's note stays at the bottom, out of the drawing's way
          await page.evaluate((u: string) => window.postMessage({ type: "dev", dev: { url: u, session: "" } }, "*"), url);
          await settle(2500);
          await page.close();
        }
        report[`devproblem-${tag}`] = errorsOf;
      }
      // the Inspector's selection (PB-940): a module, a library part's module, a researched part, a project part, a part from the
      // Library, an interface and a link, each as the view posts it (files as URLs below the page's roots only)
      const app = (screen: "inspector" | "drc", title: string) => appHtml({ screen, title, cspSource: ORIGIN, script: `${ORIGIN}/dist/views-app.js`, style: `${ORIGIN}/dist/views-app.css`, nonce });
      if (want("inspector")) {
        pages.set(`/inspector-${tag}.html`, asWebview(app("inspector", "Selection"), theme, nonce, "sideBar"));
        fsRoots = resourceRoots([{ root, index }], CACHE);
        const filesOf = (defId: string) => detailFiles(root, index, [defId]);
        const bundle = { bundle: { file: join(root, ".protoboard", "build", "uhd-bundle.json"), version: String(build.at.getTime()) } };
        const instances = [...walk(tree)].filter((n) => n.type === "instance" && n.path);
        const leaf = instances.find((n) => n.tier === "catalog" && n.trust && (index.artifacts.get(n.defId ?? "") ?? []).some((a) => a.present === true));
        const researched = instances.find((n) => n.tier === "project-researched" && detailFiles(root, index, [n.defId ?? ""]).evidence);
        const lib = build.resolved.definitions.find((d) => d.origin.tier === "catalog" && typeof d.origin.revision === "number" && index.bundleDefs.has(d.id) && (index.usedBy.get(d.id) ?? []).length > 0);
        const libGlb = lib ? (index.artifacts.get(lib.id) ?? []).find((a) => a.present === true && a.role === "body" && a.resolved?.endsWith(".glb")) : undefined;
        const withIface = [...walk(tree)].find((n) => n.type === "interface" && n.path && (index.linksByOwner.get(index.instances.get(n.path)?.parent ?? "") ?? []).some((l) => l.a === `${n.path.split("/").pop()}:${n.interfaceId}` || l.b === `${n.path.split("/").pop()}:${n.interfaceId}`));
        const linkId = link ? (link.owner ? `${link.owner}/${link.id.slice(link.owner.length + 1)}` : link.id) : undefined;
        const contents: { name: string; content: InspectorContent | undefined }[] = [
          { name: "module", content: picked && nodes.get(picked.key) ? { card: moduleCard(index, nodes.get(picked.key)!, list, false, filesOf(picked.defId ?? "")), project: example, ...bundle } : undefined },
          { name: "catalog-module", content: leaf ? { card: moduleCard(index, leaf, list, false, filesOf(leaf.defId ?? "")), project: example, ...bundle } : undefined },
          { name: "researched-part", content: researched ? { card: moduleCard(index, researched, list, false, filesOf(researched.defId ?? "")), project: example, ...bundle } : undefined },
          {
            name: "project-part",
            content: lib
              ? {
                  card: partCard(index, { id: lib.id, name: lib.name ?? lib.id, library: lib.origin.library ?? "protoboard", revision: lib.origin.revision, recommended: Number(lib.origin.revision) + 2, status: "update-available", tier: "catalog", ...(lib.partStatus ? { trust: lib.partStatus.trust, trustBasis: lib.partStatus.basis } : {}) }, list, filesOf(lib.id)),
                  project: example,
                  ...bundle,
                }
              : undefined,
          },
          {
            // a part from the Library: its revision's definition (here the build's copy of it), its body model from the cache, no project bundle
            name: "library-part",
            content: lib
              ? {
                  card: libraryPartCard({
                    partId: lib.id,
                    name: lib.name ?? lib.id,
                    library: "protoboard",
                    revision: 4,
                    recommended: true,
                    used: "used v2 here",
                    facts: [{ label: "Supply", value: "2.5 to 4.5 V" }, { label: "Package", value: "TDFN-8" }],
                    interfaceCount: index.bundleDefs.get(lib.id)?.interfaces?.length ?? 0,
                    definition: index.bundleDefs.get(lib.id),
                    ...(libGlb?.resolved && smallModel(join(root, libGlb.resolved)) ? { model: join(root, libGlb.resolved) } : {}),
                    trust: "verified",
                    trustBasis: "independent audit recorded",
                  }),
                  project: example,
                }
              : undefined,
          },
          { name: "interface", content: withIface ? { card: interfaceCard(index, withIface, interfaceArtifacts(root, index, withIface.defId ?? "", withIface.interfaceId ?? ""))!, project: example } : undefined },
          { name: "link", content: linkId && linkCard(index, linkId, list) ? { card: linkCard(index, linkId, list, detailFiles(root, index, linkHarnessDefs(index, linkId)))!, project: example, ...bundle } : undefined },
          { name: "empty", content: { empty: "Select a module or a link in the viewer.", project: example } },
        ];
        for (const { name, content } of contents) {
          if (!content) continue;
          for (const size of [{ width: 320, height: 900, tag: "" }, { width: 220, height: 900, tag: "-narrow" }]) {
            const { page, errors } = await open(`${ORIGIN}/inspector-${tag}.html`, size);
            await page.waitForFunction(() => (window as unknown as { __posted: { type: string }[] }).__posted.some((m) => m.type === "ready"), { timeout: 30000 });
            await page.evaluate((model: unknown) => window.postMessage({ type: "model", model }, "*"), pageContent(content, fileUrl));
            if ("card" in content && content.card.details) await page.waitForSelector(".uhd-selection-details .details, .uhd-artifact-card", { timeout: 30000 }).catch(() => errors.push("the details were not drawn"));
            await settle(900);
            const id = `inspector-${example}-${name}-${tag}${size.tag}`;
            await shot(page, id);
            // nothing may be wider than the view (no sideways scroll), and no browser scrollbar
            const fit = (await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, sh: document.documentElement.scrollHeight, h: innerHeight }))) as { sw: number; w: number; sh: number; h: number };
            if (fit.sw > fit.w || fit.sh > fit.h) errors.push(`the page overflows the view: ${JSON.stringify(fit)}`);
            // the whole of it, scrolled, as further captures (the wide one of each selection)
            const scroll = (await page.evaluate(() => {
              const v = document.querySelector("[data-radix-scroll-area-viewport]");
              return v ? [v.scrollHeight, v.clientHeight] : [0, 0];
            })) as [number, number];
            if (scroll[0] > scroll[1] && (!size.tag || tag === "vscode-dark" || tag === "vscode-light"))
              for (let y = scroll[1] - 80, n = 2; y < scroll[0] && n <= 6; y += scroll[1] - 80, n++) {
                await page.evaluate((to: number) => document.querySelector("[data-radix-scroll-area-viewport]")!.scrollTo(0, to), y);
                await settle(900);
                await shot(page, `${id}-${n}`);
              }
            if (!size.tag && "card" in content) {
              // what the cards are: every artifact one, with a picture or an icon; and what the page asked the host for when one is clicked
              const cards = (await page.evaluate(() => [...document.querySelectorAll(".uhd-artifact-card")].map((c) => `${c.getAttribute("data-artifact-kind")}:${c.querySelector("[data-artifact-picture]")?.getAttribute("data-artifact-picture")}`))) as string[];
              const rows = (await page.evaluate(() => document.querySelectorAll(".artifact-file").length)) as number;
              if (rows) errors.push(`${rows} artifacts are still plain rows`);
              cardReport[`${example}-${name}`] = cards;
              if (tag === "vscode-dark" && cards.length) {
                await page.evaluate(() => document.querySelector("[data-radix-scroll-area-viewport]")?.scrollTo(0, 0));
                await page.evaluate(() => (document.querySelector(".uhd-artifact-card") as HTMLElement).click());
                const posted = (await page.evaluate(() => (window as unknown as { __posted: { type: string }[] }).__posted.filter((m) => m.type === "openArtifact" || m.type === "openLink"))) as { type: string }[];
                if (!posted.length && content.card.kind !== "part") errors.push("a click on an artifact card asked the host for nothing");
              }
            }
            report[id] = errors;
            await page.close();
          }
        }
        if (refused.length) report[`inspector-${example}-${tag}-refused`] = [...new Set(refused.splice(0))].map((f) => `refused (outside the roots): ${f}`);
      }
      // the CAD viewer tab (PB-906): the first GLB the build wrote, and its STEP when there is one
      if (want("cad")) {
        const glb = outputsOf(join(root, "src")).filter((f) => f.endsWith(".glb")).sort()[0]?.slice(root.length + 1);
        for (const file of glb ? [glb, glb.replace(/\.glb$/, ".step")].filter((f) => existsSync(join(root, f))) : []) {
          const source = cadSource(join(root, file));
          const drawn = (source.via ?? source.file).slice(REPO.length + "/examples/".length);
          const name = `/cad-${example}-${extname(file).slice(1)}-${tag}.html`;
          pages.set(
            name,
            asWebview(
              cadViewerHtml({ script: `${ORIGIN}/dist/cad-viewer.js`, style: `${ORIGIN}/dist/cad-viewer.css`, occt: `${ORIGIN}/dist/occt-import-js.js`, wasm: `${ORIGIN}/dist/occt-import-js.wasm`, model: `${ORIGIN}/examples/${drawn}`, source, name: file.split("/").pop()!, cspSource: ORIGIN, nonce }),
              theme,
              nonce,
            ),
          );
          const { page, errors } = await open(`${ORIGIN}${name}`, { width: 1100, height: 720 });
          try {
            await page.waitForFunction(() => document.querySelector("#root canvas"), { timeout: 60000 });
          } catch {
            errors.push("cad not drawn");
          }
          await settle(6000);
          await shot(page, `cad-${example}-${extname(file).slice(1)}-${tag}`);
          report[`cad-${example}-${extname(file).slice(1)}-${tag}`] = errors;
          await page.close();
        }
      }
      // the DRC panel, wide and narrow, with information shown
      if (want("drc")) {
        pages.set(`/drc-${tag}.html`, asWebview(app("drc", "DRC"), theme, nonce, "panel"));
        const query = { ...DEFAULT_QUERY, info: true };
        const model = pageModel(drcModel(list, query, { links: build.resolved.links.length, checks: build.resolved.checks }));
        for (const size of [{ width: 1280, height: 360, tag: "" }, { width: 520, height: 420, tag: "-narrow" }]) {
          const { page, errors } = await open(`${ORIGIN}/drc-${tag}.html`, size);
          await page.waitForFunction(() => (window as unknown as { __posted: { type: string }[] }).__posted.some((m) => m.type === "ready"), { timeout: 30000 });
          await page.evaluate((m: unknown) => window.postMessage({ type: "model", model: m }, "*"), { state: "idle", project: example, at: "12:00:00", query, model });
          await page.waitForSelector("[data-lane]", { timeout: 20000 }).catch(() => errors.push("the lanes were not drawn"));
          await settle(400);
          // a row opened, its actions as on hover, with a tooltip
          await page.click("[data-finding] [role=button]").catch(() => errors.push("no finding row to open"));
          await page.hover("[data-finding] [role=button] button").catch(() => undefined);
          await settle(700);
          await shot(page, `drc-${example}-${tag}${size.tag}`);
          const fit = (await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, sh: document.documentElement.scrollHeight, h: innerHeight }))) as { sw: number; w: number; sh: number; h: number };
          if (fit.sw > fit.w || fit.sh > fit.h) errors.push(`the page overflows the view: ${JSON.stringify(fit)}`);
          if (!size.tag && tag === "vscode-dark") {
            // the filters and the row actions post what the extension expects
            await page.click('[aria-label="Group by"] [data-value="rule"]');
            await page.click("[data-finding] [aria-label^='Explain']").catch(() => errors.push("no explain action"));
            await page.click("[data-finding] [aria-label='Locate in the viewer']").catch(() => errors.push("no locate action"));
            const posted = (await page.evaluate(() => (window as unknown as { __posted: { type: string; query?: { groupBy?: string } }[] }).__posted)) as { type: string; query?: { groupBy?: string } }[];
            if (!posted.some((m) => m.type === "query" && m.query?.groupBy === "rule")) errors.push("group by rule was not posted");
            if (!posted.some((m) => m.type === "explain") || !posted.some((m) => m.type === "locate")) errors.push(`row actions posted ${posted.map((m) => m.type).join()}`);
          }
          report[`drc-${example}-${tag}${size.tag}`] = errors;
          await page.close();
        }
      }
    }
  }
} finally {
  await browser.close();
  for (const p of devs) p.kill("SIGINT");
  server.close();
}
console.log(JSON.stringify({ out: OUT, captures: shots.length, cards: cardReport, problems: Object.fromEntries(Object.entries(report).filter(([, e]) => e.length)) }, null, 1));
