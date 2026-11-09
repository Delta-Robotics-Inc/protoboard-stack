/**
 * Screenshots of the running layout screen (the dev page) for review, driven as a person drives it: real mouse
 * and key events through DevTools.
 *
 *   npx tsx packages/views/bench/pcb-screen/shots.ts --out <folder> [--backend auto|gpu|swiftshader] [--board <folder>]
 *
 * The page reads the board through the dev server's board feed (serve.ts): the checks, the ratsnest and the zone
 * fill are the real ones (@protoboardai/board-checks), and each shot waits until they arrived.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser, type Browser } from "@protoboardai/core/cdp";
import { startDevServer } from "./serve.js";

const { values } = parseArgs({ options: { out: { type: "string" }, backend: { type: "string" }, board: { type: "string" }, port: { type: "string" } } });
if (!values.out) throw new Error("give --out <folder>");
const OUT = resolve(values.out);
mkdirSync(OUT, { recursive: true });
const W = 1440;
const H = 900;

const dev = await startDevServer(Number(values.port ?? 0));
const { url } = dev;
const browser: Browser = await launchBrowser({ backend: (values.backend as "auto") ?? "auto", purpose: "Screenshots of the layout screen", echoErrors: true });
console.log(`browser: ${browser.backend.kind}${browser.backend.gl ? ` (${browser.backend.gl.renderer})` : ""}`);
await browser.setViewport(W, H, 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(query: string) {
  await browser.navigate(`${url}?${query}${values.board ? `&board=${encodeURIComponent(values.board)}` : ""}`);
  for (let i = 0; i < 200; i++) {
    const s = await browser.evaluate<{ ready: boolean; error?: string }>("({ ready: !!window.__dev?.ready, error: window.__dev?.error })");
    if (s.error) throw new Error(s.error);
    if (s.ready) break;
    await sleep(100);
  }
  // the derived data (checks, ratsnest) follows the snapshot
  for (let i = 0; i < 300; i++) {
    if (await browser.evaluate<boolean>("!!window.__dev?.derived")) break;
    await sleep(100);
  }
  await browser.evaluate("document.fonts.ready.then(() => true)");
  await sleep(400);
}
async function shot(name: string) {
  await sleep(250);
  const png = await browser.screenshot({ x: 0, y: 0, width: W, height: H });
  writeFileSync(join(OUT, `${name}.png`), png);
  console.log(`  ${name}.png`);
}
/** Board millimeters to page pixels. */
async function at(xMm: number, yMm: number): Promise<{ x: number; y: number }> {
  return browser.evaluate(`(() => { const v = window.__dev.view; const r = document.querySelector(".pcb-canvas").getBoundingClientRect(); const p = v.toScreen(${xMm}, ${yMm}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
}
async function mouse(type: "mousePressed" | "mouseReleased" | "mouseMoved", x: number, y: number, extra: Record<string, unknown> = {}) {
  await browser.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1, ...extra });
}
async function click(x: number, y: number) {
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
}
async function clickSel(selector: string, text?: string) {
  const p = await browser.evaluate<{ x: number; y: number } | null>(
    `(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = els.find((e) => ${text ? `e.textContent.trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})` : "true"}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  );
  if (!p) throw new Error(`no ${selector} ${text ?? ""}`);
  await click(p.x, p.y);
}
async function key(k: string, code: string, modifiers = 0) {
  await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, modifiers, ...(k.length === 1 && !modifiers ? { text: k } : {}) });
  await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers });
}

try {
  console.log(`dev page ${url}`);
  await open("");
  await shot("01-layout-default-no-check");

  await open("");
  let p = await at(-10, -3);
  await click(p.x, p.y);
  await shot("02-selected-u2-callout-findings-ratsnest");

  await clickSel(".pcb-tabs button", "nets");
  await clickSel(".pcb-panel .pcb-row", "VBUS");
  await shot("03-nets-vbus-lit-dim-others");

  await open("");
  await clickSel(".pcb-btn.main");
  await shot("04-review-first-finding");

  await open("");
  p = await at(0, 0);
  await click(p.x, p.y);
  await key("PageDown", "PageDown");
  await key("b", "KeyB");
  await shot("05-bottom-view-bottom-active");

  await open("");
  await browser.evaluate(`(() => { const v = window.__dev.view; v.setView({ cx: -10.5, cy: -4, s: 95, flip: false }); return true; })()`);
  p = await at(-10, -4.1);
  await mouse("mouseMoved", p.x, p.y);
  await shot("06-zoomed-u2-net-names-hover");

  await open("");
  p = await at(-10, -3);
  await click(p.x, p.y);
  await key("m", "KeyM");
  const a = await at(-12.5, -3);
  const b = await at(10, 6.5);
  await mouse("mouseMoved", a.x, a.y);
  await mouse("mousePressed", a.x, a.y);
  await mouse("mouseMoved", b.x, b.y, { buttons: 1 });
  await mouse("mouseReleased", b.x, b.y);
  await shot("07-measure-c1-to-u1");

  await open("");
  await key("4", "Digit4", 1);
  await shot("08-fab-check-preset");

  await open("");
  await browser.evaluate(`window.__dev.move("fp:power/ldo", 2, 0)`);
  await browser.evaluate(`window.__dev.move("fp:sensor/ic", 0, -1.5)`);
  await sleep(1200);
  await clickSel(".pcb-block");
  await clickSel(".pcb-tabs button", "inspect");
  await shot("09-after-two-commits-timeline-block-selected");

  const errors = browser.takeErrors();
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
} finally {
  await browser.close();
  await dev.close();
}
