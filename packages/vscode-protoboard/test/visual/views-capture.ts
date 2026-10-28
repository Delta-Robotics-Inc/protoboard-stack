/**
 * The schematic and PCB views driven as a person drives them, checked and
 * captured, in both hosts: the extension's viewer tab (its webview page, in
 * the token sets VS Code gives a webview) and the web viewer `protoboard dev`
 * serves. For each board of each project, in each theme:
 *
 * - the view is captured as it first opens (it must draw something: the
 *   drawing area is checked pixel by pixel against the view's background);
 * - in the first theme it is driven: the wheel zooms about the pointer (the
 *   point under it stays), the middle button, Space and the Pan tool pan, a
 *   Select drag draws a selection box and does not pan, F + - 0 and the
 *   toolbar's buttons fit and zoom, a net lights under the pointer, a click
 *   picks a component (the extension is told), the board turns over, and
 *   the drawing is still there after each; every step that does not hold is
 *   a problem in the report.
 *
 *   npx tsx test/visual/views-capture.ts --projects smart-bottle,wearable-watch,/path/to/project --out /tmp/views
 *     [--tokens /tmp/tokens.json]     token sets from a real VS Code (PROTOBOARD_TOKENS_OUT=… npm run test:integration);
 *                                     without them, Protoboard Dark and Light are made from themes/*.json
 *     [--themes protoboard-dark,protoboard-light,vscode-hc-dark] [--hosts vscode,web] [--views schematic,pcb]
 *     [--webview <dir>]               the extension's built webview files (default dist/webview)
 *     [--frames]                      also a frame sequence of the pan and zoom on each board's PCB (frames/)
 *     [--strict]                      exit 1 when anything did not hold (the integration step, run-views.mjs)
 *
 * A project is an example's name or a folder; `protoboard dev` (this
 * checkout's CLI) serves each on its own port. Chrome: $CHROME or
 * an installed Chrome, Chromium, Edge or Brave.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, extname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findBrowser, noBrowserMessage } from "@protoboardai/core/browser";
import { devOrigins, viewerPageHtml } from "../../src/viewerPage.js";
import { tokensFromTheme, webviewPage, type TokenSet } from "./webview-page.js";

// $CHROME, else an installed Chrome, Chromium, Edge or Brave on this OS (core's lookup)
const chromePath = (): string => findBrowser()?.path ?? (() => { throw new Error(noBrowserMessage()); })();

const PKG = fileURLToPath(new URL("../../", import.meta.url));
const REPO = resolve(PKG, "..", "..");
const { values } = parseArgs({
  options: {
    projects: { type: "string" },
    out: { type: "string" },
    tokens: { type: "string" },
    themes: { type: "string" },
    hosts: { type: "string" },
    views: { type: "string" },
    webview: { type: "string" },
    port: { type: "string" },
    frames: { type: "boolean" },
    strict: { type: "boolean" },
  },
});
if (!values.out || !values.projects) throw new Error("give --projects <names or folders> and --out <dir>");
const OUT = resolve(values.out);
mkdirSync(OUT, { recursive: true });
const PROJECTS = values.projects.split(",").map((p) => (isAbsolute(p) || p.startsWith(".") ? resolve(p) : join(REPO, "examples", p)));
const THEMES = (values.themes ?? "protoboard-dark,protoboard-light,vscode-hc-dark").split(",");
const HOSTS = (values.hosts ?? "vscode,web").split(",") as ("vscode" | "web")[];
const VIEWS = (values.views ?? "schematic,pcb").split(",");
const WEBVIEW = resolve(values.webview ?? join(PKG, "dist", "webview"));
const PORT = Number(values.port ?? 5460);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const THEME_NAMES: Record<string, string> = { "vscode-dark": "Default Dark Modern", "vscode-light": "Default Light Modern", "vscode-hc-dark": "Default High Contrast", "vscode-hc-light": "Default High Contrast Light", "protoboard-dark": "Protoboard Dark", "protoboard-light": "Protoboard Light" };
const TOKENS: Record<string, TokenSet> = values.tokens
  ? JSON.parse(readFileSync(values.tokens, "utf8"))
  : Object.fromEntries(["protoboard-dark", "protoboard-light"].map((t) => [THEME_NAMES[t], tokensFromTheme(JSON.parse(readFileSync(join(PKG, "themes", `${t}-color-theme.json`), "utf8")))]));
/** The web viewer's own theme for a tag (it has no high contrast: that is the extension's, from VS Code's theme). */
const WEB_THEME: Record<string, string | undefined> = { "protoboard-dark": "protoboard-dark", "protoboard-light": "protoboard-light" };

// ---- the pages (the extension's webview pages) and the extension's built files
const pages = new Map<string, string>();
const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", ORIGIN).pathname;
  const page = pages.get(path);
  if (page) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(page);
  }
  for (const [prefix, dir] of Object.entries({ "/webview/": WEBVIEW, "/media/": join(PKG, "media") })) {
    if (!path.startsWith(prefix)) continue;
    const file = normalize(join(dir, decodeURIComponent(path.slice(prefix.length))));
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) break;
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    return createReadStream(file).pipe(res);
  }
  res.writeHead(path === "/favicon.ico" ? 204 : 404);
  res.end();
});
await new Promise<void>((ok) => server.listen(PORT, "127.0.0.1", ok));

const cli = join(REPO, "packages", "cli", "bin", "protoboard.mjs");
const devs: ChildProcess[] = [];
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function dev(root: string, port: number): Promise<string> {
  const p = spawn(process.execPath, [cli, "dev", "--port", String(port), "--no-watch", "--host-origin", ORIGIN], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  devs.push(p);
  let log = "";
  p.stdout?.on("data", (d) => (log += d));
  p.stderr?.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 480; i++) {
    try {
      if ((await fetch(url + "uhd-bundle.json")).ok) return url;
    } catch {
      /* not yet */
    }
    if (p.exitCode !== null) break;
    await settle(500);
  }
  throw new Error(`protoboard dev for ${root} did not start:\n${log.slice(-2000)}`);
}

type Def = { id: string; artifacts?: { filePath?: string }[]; children?: { id: string; moduleDefId: string }[] };
/** The boards of a bundle with a drawing, at their first instance path, and which views each has. */
function boardsOf(bundle: { root: string; definitions: Def[] }): { path: string; def: string; views: string[] }[] {
  const defs = new Map(bundle.definitions.map((d) => [d.id, d]));
  const out: { path: string; def: string; views: string[] }[] = [];
  const seen = new Set<string>();
  const walk = (d: Def, at: string) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    const files = (d.artifacts ?? []).map((a) => basename(a.filePath ?? ""));
    const views = [files.includes("schematic.svg") && "schematic", (files.includes("pcb-top.svg") || files.includes("circuit.json")) && "pcb"].filter((v): v is string => !!v);
    if (views.length) out.push({ path: at, def: d.id, views });
    for (const c of d.children ?? []) {
      const child = defs.get(c.moduleDefId);
      if (child) walk(child, at ? `${at}/${c.id}` : c.id);
    }
  };
  const root = defs.get(bundle.root);
  if (root) walk(root, "");
  return out;
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
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,1000"],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
const report: Record<string, string[]> = {};
const timings: Record<string, number> = {};
const shots: string[] = [];
const W = 1400;
const H = 860;

async function shot(page: Page, name: string, dir = OUT) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.png`);
  await page.screenshot({ path });
  shots.push(path);
}

/** The drawing's viewBox: what a pan or a zoom changes. */
const viewBox = (page: Page): Promise<number[] | null> =>
  page.evaluate(() => {
    const v = document.querySelector(".pb-drawing svg")?.getAttribute("viewBox");
    return v ? v.split(/[\s,]+/).map(Number) : null;
  });

/**
 * The share of the drawing's middle (clear of the floating panels) that is not
 * the view's background: a blank or a covered drawing is near 0.
 */
async function inked(page: Page): Promise<number> {
  const clip = { x: Math.round(W * 0.3), y: Math.round(H * 0.22), width: Math.round(W * 0.4), height: Math.round(H * 0.5) };
  const b64 = (await page.screenshot({ encoding: "base64", clip })) as string;
  return page.evaluate(async (data: string) => {
    const host = document.querySelector(".pb-drawing") as HTMLElement | null;
    const bg = getComputedStyle(host ?? document.body).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement("canvas");
    [c.width, c.height] = [img.width, img.height];
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 36) n++;
    return n / (px.length / 4);
  }, b64);
}

/** Open a board's view in a host and wait until it has drawn. */
async function openView(host: "vscode" | "web", url: string, board: string, view: string, theme: string, nonce: string) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && !/favicon|ERR_ABORTED/.test(m.text()) && errors.push(m.text()));
  // tsx names the functions this script hands to the page with a helper of its own: the page gets a stand-in
  await page.evaluateOnNewDocument("globalThis.__name = (f) => f;");
  const t0 = Date.now();
  if (host === "vscode") {
    const name = `/view-${nonce}.html`;
    pages.set(
      name,
      webviewPage(
        viewerPageHtml({ cspSource: ORIGIN, script: `${ORIGIN}/webview/protoboard-viewer.js`, style: `${ORIGIN}/webview/protoboard-viewer.css`, nonce, title: board, origins: devOrigins(url), config: { path: board, view, media: `${ORIGIN}/media`, dev: { url, session: "" } } }),
        TOKENS[THEME_NAMES[theme]],
        nonce,
      ),
    );
    await page.goto(`${ORIGIN}${name}`, { waitUntil: "load" });
  } else {
    // the web viewer: the board's level by the URL, then its tab (the dev page keeps an event stream open: wait for what is drawn)
    await page.goto(`${url}?drill=${board.split("/").join(",")}&theme=${WEB_THEME[theme]}`, { waitUntil: "load" });
    const title = view === "pcb" ? "PCB" : "Schematic";
    await page.waitForFunction((t: string) => [...document.querySelectorAll("[role=tablist] button")].some((b) => b.textContent?.trim() === t), { timeout: 120000 }, title);
    await page.evaluate((t: string) => ([...document.querySelectorAll("[role=tablist] button")].find((b) => b.textContent?.trim() === t) as HTMLButtonElement).click(), title);
  }
  try {
    await page.waitForFunction(() => {
      const svg = document.querySelector(".pb-drawing svg");
      return !!svg && svg.getAttribute("viewBox") && svg.querySelectorAll("*").length > 50;
    }, { timeout: 120000 });
  } catch {
    errors.push("the drawing was not drawn");
  }
  const drawnMs = Date.now() - t0;
  await settle(1200);
  return { page, errors, drawnMs };
}

/** Drive a drawn view as a person does; what did not hold goes to `errors`. */
async function exercise(page: Page, errors: string[], view: string, frames?: string) {
  const check = (ok: unknown, what: string) => void (ok ? undefined : errors.push(what));
  let frame = 0;
  const still = async () => frames && (await shot(page, `${String(frame++).padStart(3, "0")}`, frames));
  const same = (a: number[] | null, b: number[] | null) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 1e-6 * Math.max(1, Math.abs(v)));
  const cx = W / 2;
  const cy = H / 2 - 20;
  const fit0 = await viewBox(page);
  check(fit0, "the drawing has no viewBox");
  check((await inked(page)) > 0.01, "blank: nothing is drawn in the middle of the view as it opens");
  await still();
  // the wheel zooms about the pointer: the drawing point under it stays put
  const under = (x: number, y: number): Promise<number[] | null> =>
    page.evaluate(
      (x: number, y: number) => {
        const svg = document.querySelector(".pb-drawing svg");
        const v = svg?.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
        if (!svg || !v) return null;
        const r = svg.getBoundingClientRect();
        return [v[0] + ((x - r.left) / r.width) * v[2], v[1] + ((y - r.top) / r.height) * v[3]];
      },
      x,
      y,
    );
  const svgW = (await page.evaluate(() => document.querySelector(".pb-drawing svg")?.getBoundingClientRect().width ?? 0)) as number;
  const px = cx + 120;
  const py = cy - 60;
  const before = await under(px, py);
  await page.mouse.move(px, py);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel({ deltaY: -200 });
    await settle(40);
    await still();
  }
  await settle(300);
  const zoomed = await viewBox(page);
  check(zoomed && fit0 && zoomed[2] < fit0[2] * 0.6, `the wheel did not zoom in: ${fit0} → ${zoomed}`);
  const after = await under(px, py);
  check(before && after && Math.hypot(before[0] - after[0], before[1] - after[1]) < (zoomed?.[2] ?? 1) * 0.02, `the wheel did not zoom about the pointer: ${before} → ${after}`);
  check((await inked(page)) > 0.005, "blank after zooming in");
  // the middle button pans with either tool
  const drag = async (button: "left" | "middle", dx: number, dy: number) => {
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button });
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8);
      await settle(16);
      if (i % 4 === 0) await still();
    }
    await page.mouse.up({ button });
    await settle(250);
  };
  let vb = await viewBox(page);
  await drag("middle", 200, 100);
  let next = await viewBox(page);
  const moved = (a: number[] | null, b: number[] | null, dx: number) => !!a && !!b && svgW > 0 && Math.abs(a[0] - b[0] - (dx * a[2]) / svgW) < Math.abs((dx * a[2]) / svgW) * 0.15;
  check(moved(vb, next, 200), `a middle-button drag did not pan by the pointer's move: ${vb} → ${next}`);
  // with Select (the default), a left-drag draws a selection box and does not pan
  vb = next;
  await page.mouse.move(cx - 150, cy - 80);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy - 30, { steps: 4 });
  const boxShown = await page.evaluate(() => !!document.querySelector("[data-pb-selecting]"));
  await page.mouse.move(cx + 40, cy + 40, { steps: 4 });
  await page.mouse.up();
  await settle(250);
  check(boxShown, "a left-drag with Select drew no selection box");
  check(same(vb, await viewBox(page)), "a left-drag with Select panned the view");
  await page.keyboard.press("Escape");
  // Space held: a left-drag pans
  vb = await viewBox(page);
  await page.keyboard.down("Space");
  await drag("left", -160, 60);
  await page.keyboard.up("Space");
  check(moved(vb, await viewBox(page), -160), "a left-drag with Space held did not pan");
  // the Pan tool (H): a left-drag pans; V goes back to Select
  await page.keyboard.press("h");
  vb = await viewBox(page);
  await drag("left", 120, -80);
  check(moved(vb, await viewBox(page), 120), "a left-drag with the Pan tool (H) did not pan");
  check(await page.evaluate(() => document.querySelector("[aria-label='Pan']")?.getAttribute("aria-pressed") === "true"), "the Pan tool is not shown as chosen");
  await page.keyboard.press("v");
  // the keys and the toolbar
  await page.keyboard.press("f");
  await settle(200);
  check(same(fit0, await viewBox(page)), "F did not fit the drawing as it first opened");
  await page.keyboard.press("+");
  await settle(150);
  const plus = await viewBox(page);
  check(plus && fit0 && plus[2] < fit0[2], "+ did not zoom in");
  await page.keyboard.press("-");
  await settle(150);
  const minus = await viewBox(page);
  check(minus && plus && minus[2] > plus[2], "- did not zoom out");
  await page.keyboard.press("0");
  await page.evaluate(() => (document.querySelector("[aria-label='Zoom in']") as HTMLButtonElement | null)?.click());
  await settle(150);
  const button = await viewBox(page);
  check(button && fit0 && button[2] < fit0[2], "the toolbar's Zoom in did not zoom");
  await page.evaluate(() => (document.querySelector("[aria-label='Fit']") as HTMLButtonElement | null)?.click());
  await settle(200);
  check(same(fit0, await viewBox(page)), "the toolbar's Fit did not fit");
  await still();

  // a net under the pointer lights end to end, and a click picks a component
  const routed = await page.evaluate(() => !!document.querySelector("[data-pb-pcb]"));
  const target = (await page.evaluate((routedBoard: boolean) => {
    // an element in the middle of the view that is the topmost thing at its centre (a pad under a drill is not clickable there)
    const pick = (els: Element[]) => {
      for (const e of els) {
        const r = e.getBoundingClientRect();
        if (!(r.width + r.height > 6 && r.left > 300 && r.right < 1100 && r.top > 120 && r.bottom < 700)) continue;
        const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
        const top = document.elementFromPoint(x, y);
        if (top && (top === e || e.contains(top) || top.closest("[data-ref]")?.getAttribute("data-ref") === e.getAttribute("data-ref"))) return [x, y];
      }
      return null;
    };
    const net = routedBoard
      ? pick([...document.querySelectorAll("[data-layer='copper:top'] polyline[data-net], [data-layer^='copper:'] polyline[data-net]")])
      : pick([...document.querySelectorAll("[data-subcircuit-connectivity-map-key] path, [data-pb-stroke='wire'] path, path[data-pb-stroke='wire']")]);
    const part = routedBoard ? pick([...document.querySelectorAll("[data-layer^='copper:'] rect[data-ref]")]) : pick([...document.querySelectorAll("[data-pb-part], [data-pb-fill='body']")]);
    return { net, part };
  }, routed)) as { net: number[] | null; part: number[] | null };
  const kicad = await page.evaluate(() => !!document.querySelector(".pb-kicad, [data-pb-drawing] svg desc") && /Pcbnew|PCBNEW|Eeschema/.test(document.querySelector(".pb-drawing svg desc")?.textContent ?? ""));
  const kicadPcb = kicad && view === "pcb";
  if (!kicadPcb) {
    if (target.net) {
      await page.mouse.move(target.net[0], target.net[1]);
      await settle(300);
      const lit = await page.evaluate(() => document.querySelectorAll(".pb-net-on, .pb-kicad-net, .pb-pad-on").length + (document.querySelector("[data-pb-net]") ? 1 : 0));
      check(lit > 0, "no net lit under the pointer");
      await still();
    } else errors.push("no net to hover in the middle of the view");
    if (target.part) {
      await page.mouse.click(target.part[0], target.part[1]);
      await settle(400);
      check(await page.evaluate(() => !!document.querySelector("[data-pb-component]")), "a click on a component showed no component card");
      await still();
    } else errors.push("no component to click in the middle of the view");
  }
  await page.keyboard.press("Escape");
  // the board seen from below: still drawn (the board's own fill never covers it)
  if (view === "pcb") {
    const below = await page.evaluate(() => {
      const b = document.querySelector("[aria-label='Seen from below'], [aria-label='Bottom side, seen from below']") as HTMLButtonElement | null;
      b?.click();
      return !!b;
    });
    if (below) {
      await settle(routed ? 800 : 2500);
      check((await inked(page)) > 0.01, "blank: the board seen from below shows nothing");
      await still();
    }
  }
  // nothing scrolls with the browser's own bars
  const bars = (await page.evaluate(
    () =>
      [...document.querySelectorAll("*")].filter((e) => {
        const c = getComputedStyle(e);
        return /(auto|scroll)/.test(c.overflowY + c.overflowX) && e.scrollHeight > e.clientHeight + 1 && !e.closest("[data-radix-scroll-area-viewport]") && !e.matches("[data-radix-scroll-area-viewport]");
      }).length,
  )) as number;
  check(bars === 0, `${bars} element(s) scroll with the browser's own bars`);
}

/**
 * A board with both its exported drawings and its routed build: the PCB view drawn from the other one (the
 * header's "Drawn from"). What it switched to (`routed` or `export`), or undefined when the board has one.
 */
async function switchSource(page: Page): Promise<string | undefined> {
  const trigger = await page.$("[aria-label='Drawn from']");
  if (!trigger) return undefined;
  await page.keyboard.press("Escape");
  await trigger.click();
  await page.waitForSelector("[role=option]", { timeout: 5000 }).catch(() => undefined);
  const other = (await page.evaluate(() => {
    const o = [...document.querySelectorAll("[role=option]")].find((e) => e.getAttribute("data-state") !== "checked") as HTMLElement | undefined;
    o?.click();
    return o?.textContent ?? undefined;
  })) as string | undefined;
  if (!other) return undefined;
  await page.waitForFunction(() => (document.querySelector(".pb-drawing svg")?.querySelectorAll("*").length ?? 0) > 50, { timeout: 120000 }).catch(() => undefined);
  await settle(2500);
  return /routed|build/i.test(other) ? "routed" : "export";
}

let port = PORT + 1;
try {
  for (const root of PROJECTS) {
    const project = basename(root);
    const url = await dev(root, port++);
    const bundle = await (await fetch(url + "uhd-bundle.json")).json();
    const boards = boardsOf(bundle);
    if (!boards.length) report[project] = ["no board with a schematic or PCB drawing"];
    for (const board of boards)
      for (const view of VIEWS.filter((v) => board.views.includes(v)))
        for (const host of HOSTS)
          for (const [i, theme] of THEMES.entries()) {
            if (host === "web" && !WEB_THEME[theme]) continue;
            if (host === "vscode" && !TOKENS[THEME_NAMES[theme]]) continue;
            const name = `${host}-${project}-${view}-${theme}`;
            const nonce = `n${Math.random().toString(36).slice(2)}`;
            const { page, errors, drawnMs } = await openView(host, url, board.path, view, theme, nonce);
            timings[name] = drawnMs;
            await shot(page, name);
            if (i === 0) {
              const frames = values.frames && view === "pcb" ? join(OUT, "frames", `${host}-${project}-${view}`) : undefined;
              await exercise(page, errors, view, frames).catch((e: Error) => errors.push(`stopped: ${e.message}`));
              await shot(page, `${name}-driven`);
            }
            // the other drawing of a board that has both (a locked board's KiCad export and its routed build)
            if (view === "pcb") {
              await page.evaluate(() => (document.querySelector("[aria-label='Seen from the top'], [aria-label='Top side']") as HTMLButtonElement | null)?.click());
              const other = await switchSource(page).catch(() => undefined);
              if (other) {
                await shot(page, `${name}-${other}`);
                const check = (ok: unknown, what: string) => void (ok ? undefined : errors.push(`${other}: ${what}`));
                check((await inked(page)) > 0.01, "blank: nothing is drawn in the middle of the view");
                const a = await viewBox(page);
                await page.mouse.move(W / 2, H / 2);
                for (let k = 0; k < 4; k++) await page.mouse.wheel({ deltaY: -200 });
                await settle(300);
                const b = await viewBox(page);
                check(a && b && b[2] < a[2], "the wheel did not zoom");
              }
            }
            report[name] = errors;
            await page.close();
          }
  }
} finally {
  await browser.close();
  for (const p of devs) p.kill("SIGINT");
  server.close();
}
const problems = Object.fromEntries(Object.entries(report).filter(([, e]) => e.length));
console.log(JSON.stringify({ out: OUT, captures: shots.length, drawnMs: timings, problems }, null, 1));
if (values.strict && Object.keys(problems).length) process.exitCode = 1;
