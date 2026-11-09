/**
 * The schematic tab in the app: `protoboard dev` on a project with a UHD board (default: the wearable watch
 * example), the web viewer's Schematic tab opened by a click, and the editor drawn from the dev server's schematic
 * routes. The first open lays the board out in memory and writes nothing; the script checks that the project's
 * schematic folder is still absent afterwards, and removes the ignored local state (journal) the run left.
 *
 *   npx tsx packages/views/bench/schematic-screen/app.ts --out <folder> [--project <folder>]
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser } from "@protoboardai/core/cdp";
import { startDev } from "../../../cli/src/dev/server.js";
import { schematicTargets } from "../../../cli/src/schematic.js";

const { values } = parseArgs({ options: { out: { type: "string" }, project: { type: "string" } } });
if (!values.out) throw new Error("give --out <folder>");
const OUT = resolve(values.out);
mkdirSync(OUT, { recursive: true });
const ROOT = resolve(values.project ?? join(import.meta.dirname, "..", "..", "..", "..", "examples", "wearable-watch"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const targets = await schematicTargets(ROOT);
const had = targets.map((t) => existsSync(t.dir));
const dev = await startDev({ root: ROOT, port: 0, watch: false });
const browser = await launchBrowser({ purpose: "The schematic tab in the app", echoErrors: true });
let ok = true;
try {
  await browser.setViewport(1440, 900, 1);
  await browser.navigate(dev.url);
  const t0 = Date.now();
  let tab: { x: number; y: number } | null = null;
  while (!tab && Date.now() - t0 < 120_000) {
    tab = await browser.evaluate<{ x: number; y: number } | null>(`(() => { const b = [...document.querySelectorAll("button, [role=tab]")].find((e) => /^\\s*Schematic\\s*$/.test(e.textContent ?? "") && !e.closest(".pcb-screen")); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!tab) await sleep(500);
  }
  if (!tab) throw new Error("the viewer offers no Schematic tab");
  for (const type of ["mousePressed", "mouseReleased"]) await browser.send("Input.dispatchMouseEvent", { type, x: tab.x, y: tab.y, button: "left", clickCount: 1 });
  // a project with several boards lists them: open the first (the main board)
  await sleep(1500);
  const pick = await browser.evaluate<{ x: number; y: number } | null>(`(() => { const b = [...document.querySelectorAll("button")].find((e) => /schematic$/.test(e.textContent ?? "") && !e.closest(".pcb-screen")); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (pick) for (const type of ["mousePressed", "mouseReleased"]) await browser.send("Input.dispatchMouseEvent", { type, x: pick.x, y: pick.y, button: "left", clickCount: 1 });
  const t1 = Date.now();
  let seq: string | null = null;
  while (!seq && Date.now() - t1 < 120_000) {
    seq = await browser.evaluate<string | null>(`document.querySelectorAll(".sch-svg g[data-kind=symbol]").length ? (document.querySelector(".pcb-top [data-save-state]")?.textContent ?? "drawn") : null`);
    if (!seq) await sleep(300);
  }
  await sleep(1500);
  writeFileSync(join(OUT, "17-app-schematic-tab.png"), await browser.screenshot({ x: 0, y: 0, width: 1440, height: 900 }));
  const items = await browser.evaluate<number>(`document.querySelectorAll(".sch-svg g[data-kind=symbol]").length`);
  console.log(`${seq ? "PASS" : "FAIL"}  the Schematic tab opens the editor in the app  (${seq}, ${items} symbols drawn, ${Date.now() - t1} ms from the click)`);
  const untouched = targets.every((t, i) => existsSync(t.dir) === had[i]);
  console.log(`${untouched ? "PASS" : "FAIL"}  the first open writes nothing into the project`);
  ok = !!seq && items > 0 && untouched;
} catch (e) {
  ok = false;
  console.log(`FAIL  ${(e as Error).message}`);
} finally {
  const errs = browser.takeErrors();
  if (errs.length) console.log(`page errors:\n${errs.slice(0, 10).join("\n")}`);
  await browser.close();
  await dev.close();
  // the run's ignored local state: the journal of an open nobody saved
  rmSync(join(ROOT, ".protoboard", "local", "schematic"), { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
