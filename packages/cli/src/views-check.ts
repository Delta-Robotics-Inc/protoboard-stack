/**
 * `protoboard views check [--module <path or id>] [--out <dir>] [--no-render]`
 * (PB-1030): which tabs each level of the project gets in the viewer, and
 * whether each one draws. The tabs come from the same rules the shells use
 * (@protoboardai/views/tabs); each is then opened once in the web viewer
 * `protoboard dev` serves, in a headless browser, as a person would open it:
 * the level by the URL, the tab by its button. A tab fails when the page
 * throws or logs an error while it is shown, or when nothing is drawn
 * (an empty state, or a blank view). `--out` keeps a PNG of every tab, so an
 * agent can look at the board without the editor (F13).
 *
 * The levels are the root and every module with modules inside it (the
 * levels a person drills into: a board, an enclosure, an assembly);
 * `--module` picks one (an instance path, or a module id: its first
 * instance), parts included.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ModuleDef } from "@deltarobotics/uhd";
import { findProjectRoot, loadProject, resolveViews, uhdBundle } from "@protoboardai/core";
import { tabsFor } from "@protoboardai/views/tabs";

export type TabStatus = "ok" | "empty" | "error" | "not-rendered";

export interface TabResult {
  id: string;
  title: string;
  status: TabStatus;
  /** Why it failed, or what was seen. */
  detail?: string;
  /** Share of the view's pixels that differ from its background (0–1). */
  ink?: number;
  /** The PNG written for it (`--out`). */
  shot?: string;
}

export interface LevelResult {
  /** Instance path ("" is the root). */
  path: string;
  module: string;
  name: string;
  tabs: TabResult[];
  /** Tabs the viewer showed that the rules did not list, or the other way round (should be none). */
  mismatch?: string;
}

export interface ViewsCheckReport {
  root: string;
  levels: LevelResult[];
  rendered: boolean;
  /** Why nothing was rendered (no browser, --no-render). */
  reason?: string;
  failed: number;
}

export interface ViewsCheckOptions {
  cwd: string;
  module?: string;
  /** Folder for one PNG per tab. */
  out?: string;
  render?: boolean;
  /** Seconds to wait for a tab to draw (default 45: a board's GLB in a software renderer takes a while). */
  timeout?: number;
  log?: (line: string) => void;
}

const W = 1440;
const H = 900;
/** The floating header the shell draws over the top of the view. */
const HEADER = 52;
/**
 * Where ink is measured: the middle of the view, clear of the floating cards
 * every view has (the title card top left, the toolbar at the bottom, an
 * inspector on the right), which would count as ink on a blank view.
 */
const MIDDLE = { x: Math.round(W * 0.16), y: HEADER + 70, width: Math.round(W * 0.56), height: H - HEADER - 170, scale: 0.5 };
/** Below this share of differing pixels, a view counts as blank. */
const MIN_INK = 0.002;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, "_") || "root";

/** The levels to check: the root and every module with modules inside it, or the one `--module` names. */
function levels(p: Awaited<ReturnType<typeof loadProject>>, module?: string): { path: string; def: ModuleDef }[] {
  const at = (path: string, id: string) => ({ path, def: p.lookup(id)! });
  if (module !== undefined) {
    const byPath = p.instances.find((i) => i.path === module);
    const byId = p.instances.find((i) => i.definition === module);
    const hit = byPath ?? byId;
    if (!hit) throw new Error(`no instance path or module "${module}" (paths look like board or cap/board; see \`protoboard inspect\`)`);
    return [at(hit.path, hit.definition)];
  }
  const seen = new Set<string>();
  const out: { path: string; def: ModuleDef }[] = [];
  for (const i of p.instances) {
    const def = p.lookup(i.definition);
    if (!def) continue;
    if (i.path !== "" && !(def.children ?? []).length) continue;
    // a module used several times is checked once, at its first instance
    if (i.path !== "" && seen.has(def.id)) continue;
    seen.add(def.id);
    out.push({ path: i.path, def });
  }
  return out;
}

/** In the page: a tab button's view title (its tooltip is "<title>[ · planned][: description]"). */
const TITLE = `(b.getAttribute('data-tooltip') || '').split(/ · |: /)[0].trim()`;
const TABS = `[...document.querySelectorAll('[role=tablist] [role=tab]')].map((b) => ${TITLE})`;

/** In the page: the share of a PNG's pixels that differ from its most common colour. */
const INK = `async (b64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const counts = new Map();
  for (let i = 0; i < d.length; i += 4) { const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3); counts.set(k, (counts.get(k) || 0) + 1); }
  let bg = 0, most = -1;
  for (const [k, n] of counts) if (n > most) { most = n; bg = k; }
  const br = (bg >> 10) << 3, bgG = ((bg >> 5) & 31) << 3, bb = (bg & 31) << 3;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - br) > 24 || Math.abs(d[i + 1] - bgG) > 24 || Math.abs(d[i + 2] - bb) > 24) ink++;
  return ink / (d.length / 4);
}`;

/**
 * In the page: what the active tab's panel holds. An empty state is the
 * viewer's EmptyState (a centred column with an upper-case title) standing
 * alone: no drawing (an SVG or a canvas of some size) beside it.
 */
const PANEL = `(() => {
  const panel = document.querySelector('[role=tabpanel]');
  if (!panel) return { panel: false };
  const big = (el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 150; };
  const drawings = panel.querySelectorAll('.react-flow__node').length + [...panel.querySelectorAll('svg')].filter((s) => big(s) && s.querySelectorAll('*').length > 20).length
    + [...panel.querySelectorAll('canvas')].filter(big).length;
  const rows = panel.querySelectorAll('[role=row], tr, [data-line]').length;
  const empties = [...panel.querySelectorAll('div.flex.flex-col.items-center.justify-center.text-center')]
    .filter((e) => e.offsetParent !== null && e.querySelector('.uppercase'))
    .map((e) => e.querySelector('.uppercase').textContent.trim());
  return { panel: true, drawings, rows, empties, text: panel.innerText.slice(0, 160) };
})()`;

export async function viewsCheck(options: ViewsCheckOptions): Promise<ViewsCheckReport> {
  const log = options.log ?? (() => {});
  const root = findProjectRoot(options.cwd);
  if (!root) throw new Error(`no protoboard.config.ts in ${options.cwd} or its parents (run \`protoboard init\`)`);
  const p = await loadProject(root, { checks: false });
  const bundle = await uhdBundle(p);
  const { views } = resolveViews(p.extensions);
  const result: LevelResult[] = levels(p, options.module).map(({ path, def }) => ({
    path,
    module: def.id,
    name: def.name ?? def.id,
    tabs: tabsFor(bundle.definitions.find((d) => d.id === def.id) ?? def, bundle, path, views).map((v) => ({ id: v.id, title: v.title, status: "not-rendered" as TabStatus })),
  }));
  const report: ViewsCheckReport = { root, levels: result, rendered: false, failed: 0 };
  if (options.render === false) return { ...report, reason: "not rendered (--no-render)" };

  const { launchBrowser } = await import("@protoboardai/core/cdp");
  const { startDev } = await import("./dev/server.js");
  let browser: Awaited<ReturnType<typeof launchBrowser>>;
  try {
    browser = await launchBrowser({ purpose: "`protoboard views check` opens each tab in a headless Chromium-family browser", echoErrors: false });
  } catch (e) {
    return { ...report, reason: (e as Error).message.split("\n")[0], failed: result.reduce((n, l) => n + l.tabs.length, 0) };
  }
  const dev = await startDev({ root, port: 0, watch: false, record: false });
  const out = options.out ? resolve(options.cwd, options.out) : undefined;
  if (out) mkdirSync(out, { recursive: true });
  const timeout = (options.timeout ?? 45) * 1000;
  try {
    await browser.setViewport(W, H);
    for (const level of result) {
      const url = `${dev.url}?theme=protoboard-dark${level.path ? `&drill=${encodeURIComponent(level.path.split("/").join(","))}` : ""}`;
      log(`${level.path || "(root)"} ${level.module}: ${level.tabs.map((t) => t.title).join(", ")}`);
      await browser.navigate(url);
      // the shell's tabs, once it has mounted the level
      // the shell's tabs, once it has mounted the level (the same as the rules', or settled for 3 s)
      const expected = level.tabs.map((t) => t.title);
      let shown: string[] = [];
      let first = 0;
      for (const t0 = Date.now(); Date.now() - t0 < timeout; await sleep(250)) {
        shown = await browser.evaluate<string[]>(TABS);
        if (!shown.length) continue;
        first ||= Date.now();
        if ((shown.length === expected.length && shown.every((t) => expected.includes(t))) || Date.now() - first > 3000) break;
      }
      const extra = shown.filter((t) => !expected.includes(t));
      const missing = expected.filter((t) => !shown.includes(t));
      if (extra.length || missing.length) level.mismatch = `${missing.length ? `not shown: ${missing.join(", ")}` : ""}${extra.length && missing.length ? "; " : ""}${extra.length ? `shown besides: ${extra.join(", ")}` : ""}`;
      browser.takeErrors();
      for (const tab of level.tabs) {
        if (!shown.includes(tab.title)) {
          tab.status = "error";
          tab.detail = "the viewer does not offer this tab here";
          continue;
        }
        await browser.evaluate(`[...document.querySelectorAll('[role=tablist] [role=tab]')].find((b) => ${TITLE} === ${JSON.stringify(tab.title)}).click()`);
        // wait for it to draw: something inked and a drawing or rows in the panel, or until the time is up
        // wait for it to draw: inked and unchanged across two looks (a model still loading changes), or an
        // empty state that stays, or until the time is up
        let panel: { panel: boolean; drawings?: number; rows?: number; empties?: string[]; text?: string } = { panel: false };
        let ink = 0;
        let before = -1;
        for (const t0 = Date.now(); Date.now() - t0 < timeout; await sleep(600)) {
          panel = await browser.evaluate(PANEL);
          const png = await browser.screenshot(MIDDLE);
          ink = await browser.evaluate<number>(`(${INK})(${JSON.stringify(png.toString("base64"))})`);
          const settled = Math.abs(ink - before) < 0.0005;
          before = ink;
          if ((panel.empties ?? []).length && !(panel.drawings ?? 0) && Date.now() - t0 > 3000) break;
          if (ink >= MIN_INK && settled && ((panel.drawings ?? 0) > 0 || (panel.rows ?? 0) > 0 || Date.now() - t0 > 4000)) break;
        }
        await sleep(600);
        const errors = browser.takeErrors().filter((e) => !/favicon|ERR_ABORTED|EventSource/i.test(e));
        tab.ink = Math.round(ink * 10000) / 10000;
        if (errors.length) {
          tab.status = "error";
          tab.detail = errors[0].split("\n")[0].slice(0, 300);
        } else if (!panel.panel) {
          tab.status = "error";
          tab.detail = "no view panel";
        } else if ((panel.empties ?? []).length && !(panel.drawings ?? 0)) {
          tab.status = "empty";
          tab.detail = `shows "${panel.empties![0]}"`;
        } else if (ink < MIN_INK) {
          tab.status = "empty";
          tab.detail = "blank: nothing is drawn";
        } else if (!(panel.drawings ?? 0) && !(panel.rows ?? 0)) {
          tab.status = "ok";
          tab.detail = `no drawing or table; shows "${(panel.text ?? "").split("\n")[0]}"`;
        } else tab.status = "ok";
        if (out) {
          const file = join(out, `${slug(level.path)}__${tab.id}.png`);
          writeFileSync(file, await browser.screenshot());
          tab.shot = file;
        }
        log(`  ${tab.status.padEnd(5)} ${tab.title}${tab.detail ? `: ${tab.detail}` : ""}`);
      }
    }
  } finally {
    await browser.close();
    await dev.close();
  }
  const failed = result.reduce((n, l) => n + l.tabs.filter((t) => t.status === "empty" || t.status === "error").length, 0);
  return { ...report, rendered: true, failed };
}

/** The report for people. */
export function formatViewsCheck(r: ViewsCheckReport): string {
  const lines: string[] = [];
  for (const l of r.levels) {
    lines.push(`${l.path || "(root)"}  ${l.module}`);
    for (const t of l.tabs) lines.push(`  ${t.status === "ok" ? "✓" : t.status === "not-rendered" ? "·" : "✗"} ${t.title.padEnd(10)} ${t.status === "ok" || t.status === "not-rendered" ? "" : t.status}${t.detail ? `${t.status === "ok" ? "" : ": "}${t.detail}` : ""}${t.shot ? `  ${t.shot}` : ""}`.trimEnd());
    if (l.mismatch) lines.push(`  ! the viewer's tabs differ from the rules: ${l.mismatch}`);
  }
  const tabs = r.levels.reduce((n, l) => n + l.tabs.length, 0);
  lines.push("");
  lines.push(r.rendered ? `${tabs} tab(s) on ${r.levels.length} level(s): ${r.failed ? `${r.failed} failed` : "every one draws"}` : `${tabs} tab(s) on ${r.levels.length} level(s), not rendered: ${r.reason}`);
  return lines.join("\n");
}
