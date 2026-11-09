/**
 * Scripted sessions on the schematic screen (the dev page, serve.ts), driven as a person drives it: real mouse and
 * key events through DevTools, on the Airnode C3 sample served through the schematic service. After each step the
 * script reads the service's own document (the host's feed, not the page) and says whether it holds what the step
 * should have done, and saves a screenshot.
 *
 *   npx tsx packages/views/bench/schematic-screen/session.ts --out <folder> [--only <name,...>] [--local <label>]
 *
 * Steps: the first open (laid out in memory, nothing written) with a pin's datasheet facts and the voltage path;
 * a symbol moved with its wires, then undone; a wire turned into labels; a part pinned and its card laid out again
 * (it stays); a cleanup fix accepted, and a bounded cleanup pass previewed, applied and reverted; the cross-probe to
 * the layout screen and back; the depth stops; a wire deleted and drawn again; save. `--local` opens a real board
 * from the Git-ignored local list and measures first paint and pan frame time (label only). Exit 1 when a check fails.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser, type Browser } from "@protoboardai/core/cdp";
import { canonicalRecord } from "@protoboardai/board/node";
import { geometryOf, recordsOfKind, type SchematicDocument, type SymbolRecT, type WireRecT } from "@protoboardai/schematic";
import { startSchematicDevServer } from "./serve.js";

const { values } = parseArgs({ options: { out: { type: "string" }, only: { type: "string" }, local: { type: "string" }, backend: { type: "string" } } });
if (!values.out) throw new Error("give --out <folder>");
const OUT = resolve(values.out);
mkdirSync(OUT, { recursive: true });
const ONLY = values.only ? new Set(values.only.split(",")) : undefined;
const W = 1440;
const H = 900;

const dev = await startSchematicDevServer(0, { ...(values.local ? { local: values.local } : {}) });
const browser: Browser = await launchBrowser({ backend: (values.backend as "auto") ?? "auto", purpose: "Scripted sessions on the schematic screen", echoErrors: true });
await browser.setViewport(W, H, 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function waitFor<T>(expr: string, test: (v: T) => boolean, ms = 30_000, step = 100): Promise<T> {
  const t0 = Date.now();
  let v: T = await browser.evaluate<T>(expr);
  while (!test(v) && Date.now() - t0 < ms) {
    await sleep(step);
    v = await browser.evaluate<T>(expr);
  }
  return v;
}
async function open(key: string, extra = "") {
  await browser.navigate(`${dev.url}?schematic=${key}${extra}`);
  const s = await waitFor<{ ready: boolean; error?: string }>("({ ready: !!window.__dev?.ready, error: window.__dev?.error })", (x) => x.ready || !!x.error, 120_000);
  if (s.error) throw new Error(s.error);
  await waitFor<boolean>("!!window.__dev.source?.derived", (x) => x, 60_000);
  await browser.evaluate("document.fonts.ready.then(() => true)");
  await sleep(400);
}
async function shot(name: string) {
  await sleep(350);
  writeFileSync(join(OUT, `${name}.png`), await browser.screenshot({ x: 0, y: 0, width: W, height: H }));
  console.log(`      ${name}.png`);
}
const doc = async (key: string): Promise<SchematicDocument> => (await dev.routes.feed(key)).snapshot().doc;
const seqOf = (): Promise<number> => browser.evaluate<number>("window.__dev.source.model.seq");
async function waitSeq(after: number, ms = 20_000) {
  return waitFor<number>("window.__dev.source.model.seq", (s) => s > after, ms);
}
async function screenOf(p: [number, number]): Promise<{ x: number; y: number }> {
  return browser.evaluate(`(() => { const c = window.__dev.api.canvas; const r = c.host.getBoundingClientRect(); const q = c.toScreen([${p[0]}, ${p[1]}]); return { x: r.left + q[0], y: r.top + q[1] }; })()`);
}
async function mouse(type: "mousePressed" | "mouseReleased" | "mouseMoved", x: number, y: number, extra: Record<string, unknown> = {}) {
  await browser.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !extra.buttons ? "none" : "left", clickCount: 1, ...extra });
}
async function click(p: { x: number; y: number }, extra: Record<string, unknown> = {}) {
  await mouse("mouseMoved", p.x, p.y);
  await mouse("mousePressed", p.x, p.y, extra);
  await mouse("mouseReleased", p.x, p.y, extra);
  await sleep(120);
}
async function drag(from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await mouse("mouseMoved", from.x, from.y);
  await mouse("mousePressed", from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { buttons: 1 });
    await sleep(16);
  }
  await mouse("mouseReleased", to.x, to.y);
}
async function key(k: string, code: string, modifiers = 0, keyCode = 0) {
  await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, modifiers, windowsVirtualKeyCode: keyCode || k.toUpperCase().charCodeAt(0) });
  await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers, windowsVirtualKeyCode: keyCode || k.toUpperCase().charCodeAt(0) });
  await sleep(100);
}
async function clickSelector(sel: string) {
  const r = await browser.evaluate<{ x: number; y: number } | null>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "nearest" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${sel}`);
  await click(r);
}
async function zoomTo(box: [number, number, number, number]) {
  await browser.evaluate(`window.__dev.api.canvas.fit([${box.join(",")}], { left: 60, right: 380, top: 70, bottom: 170 })`);
  await sleep(150);
}
const symOf = (d: SchematicDocument, part: string) => d.records.get(`sym:${part}`) as SymbolRecT;
const center = (d: SchematicDocument, id: string): [number, number] => geometryOf(d).symbols.get(id)!.center;
const wireEndsAt = (d: SchematicDocument, at: readonly number[]) => recordsOfKind(d, "wire").filter((w) => [w.points[0], w.points[w.points.length - 1]].some((p) => p[0] === at[0] && p[1] === at[1]));
const run = (name: string) => !ONLY || ONLY.has(name);

try {
  // ------------------------------------------------------------------ first open, pin facts, voltage path
  if (run("open")) {
    await open("airnode-fault");
    const d = await doc("airnode-fault");
    check("first open lays the sheet out in memory", recordsOfKind(d, "symbol").length === d.circuit.parts.length, `${recordsOfKind(d, "symbol").length} symbols, ${recordsOfKind(d, "card").length} cards`);
    check("first open writes nothing", !existsSync(join(dev.root, "fault", "schematic", "schematic.jsonl")));
    await browser.evaluate(`window.__dev.api.canvas.fit(undefined, { left: 60, right: 380, top: 70, bottom: 170 })`);
    await shot("01-first-open");
    // U1's IO9 (the BOOT strap): the voltage check's conflict
    const u1 = geometryOf(d).symbols.get("sym:mcu/module")!;
    const io9 = u1.pins.find((p) => p.name === "IO9")!;
    await zoomTo([u1.body.x0 - 14, u1.body.y0 - 6, u1.body.x1 + 24, u1.body.y1 + 6]);
    await click(await screenOf(io9.at));
    const tab = await browser.evaluate<string | null>(`document.querySelector("[data-inspect=pin] h4")?.textContent ?? null`);
    check("a pin shows its facts with status chips", !!tab && /IO9/.test(tab) && (await browser.evaluate<number>(`document.querySelectorAll("[data-inspect=pin] .sch-chip").length`)) >= 3, tab ?? "no pin card");
    check("the voltage finding's path is shown", await browser.evaluate<boolean>(`[...document.querySelectorAll("[data-inspect=pin] .sch-path li")].some((li) => /VBUS/.test(li.textContent))`));
    await shot("02-pin-facts-voltage");
    // the part card (S5): a part selected by its body
    const u2 = geometryOf(d).symbols.get("sym:power/ldo")!;
    await zoomTo([u2.body.x0 - 16, u2.body.y0 - 10, u2.body.x1 + 16, u2.body.y1 + 10]);
    await click(await screenOf(u2.center));
    check("a part shows its card: symbol, facts with chips, pins", await browser.evaluate<boolean>(`!!document.querySelector("[data-inspect=part] .sch-partsvg") && document.querySelectorAll(".sch-pins tbody tr").length > 0`));
    await shot("02b-part-card");
  }

  // ------------------------------------------------------------------ move a symbol with its wires, then undo
  if (run("move")) {
    await open("airnode-1");
    const before = await doc("airnode-1");
    const id = "sym:sensor/r_sda";
    const s0 = geometryOf(before).symbols.get(id)!;
    const ends0 = s0.pins.map((p) => wireEndsAt(before, p.at).length);
    const c = s0.center;
    await zoomTo([c[0] - 16, c[1] - 12, c[0] + 16, c[1] + 12]);
    const from = await screenOf(c);
    const to = await screenOf([c[0], c[1] - 4]);
    const seq0 = await seqOf();
    await drag(from, to);
    await waitSeq(seq0);
    const after = await doc("airnode-1");
    const s1 = geometryOf(after).symbols.get(id)!;
    const moved = s1.rec.x === s0.rec.x && s1.rec.y === s0.rec.y - 4;
    const follow = s1.pins.every((p, i) => wireEndsAt(after, p.at).length >= ends0[i]);
    const orth = recordsOfKind(after, "wire").every((w) => w.points.every((p, i) => i === 0 || p[0] === w.points[i - 1][0] || p[1] === w.points[i - 1][1]));
    check("a symbol moves by the drag, as one transaction", moved && (await seqOf()) === seq0 + 1, `${s0.rec.x},${s0.rec.y} -> ${s1.rec.x},${s1.rec.y}`);
    check("its wires follow orthogonally", follow && orth, `wire ends at its pins ${ends0.join("/")} -> ${s1.pins.map((p) => wireEndsAt(after, p.at).length).join("/")}`);
    check("a person's move pins it", !!s1.rec.pinned);
    await shot("03-moved-with-wires");
        await key("z", "KeyZ", 2);
    await waitSeq(seq0 + 1);
    const back = await doc("airnode-1");
    const same = [...before.records.values()].filter((r) => r.kind === "symbol" || r.kind === "wire").every((r) => back.records.has(r.id) && canonicalRecord(back.records.get(r.id)!) === canonicalRecord(r));
    check("undo restores the symbol and its wires", same && recordsOfKind(back, "wire").length === recordsOfKind(before, "wire").length);
    await shot("04-move-undone");
  }

  // ------------------------------------------------------------------ a wire to labels
  if (run("label")) {
    await open("airnode-2");
    const d = await doc("airnode-2");
    // a signal wire whose first segment's middle is clear of every other wire (so the click picks it alone)
    const midOf = (x: WireRecT): [number, number] => [(x.points[0][0] + x.points[1][0]) / 2, (x.points[0][1] + x.points[1][1]) / 2];
    const clear = (x: WireRecT) => recordsOfKind(d, "wire").every((o) => o.id === x.id || o.points.slice(1).every((q, i) => segDist(midOf(x), o.points[i] as [number, number], q as [number, number]) > 1.5));
    const w = recordsOfKind(d, "wire").find((x) => d.nets.get(x.net)?.kind === "signal" && clear(x))!;
    const mid = midOf(w);
    await zoomTo([mid[0] - 14, mid[1] - 10, mid[0] + 14, mid[1] + 10]);
    await click(await screenOf(mid));
    const sel = await browser.evaluate<string[]>("[...document.querySelectorAll('.sch-svg .layer.over polyline.sel-w')].map(() => 'w')");
    const seq0 = await seqOf();
    const labels0 = recordsOfKind(d, "label").filter((l) => l.net === w.net && l.card === w.card).length;
    await key("l", "KeyL");
    await waitSeq(seq0);
    const after = await doc("airnode-2");
    const labels1 = recordsOfKind(after, "label").filter((l) => l.net === w.net && l.card === w.card).length;
    check("a selected wire turns into labels (L)", sel.length > 0 && !after.records.has(w.id) && labels1 > labels0, `${w.net}: labels ${labels0} -> ${labels1}`);
    await shot("05-wire-to-label");
  }

  // ------------------------------------------------------------------ pin a part and lay its card out again
  if (run("pin")) {
    await open("airnode-3");
    const d = await doc("airnode-3");
    const id = "sym:status/led1";
    const s = symOf(d, "status/led1");
    const c = center(d, id);
    await zoomTo([c[0] - 18, c[1] - 12, c[0] + 18, c[1] + 12]);
    await click(await screenOf(c));
    let seq0 = await seqOf();
    await key("p", "KeyP");
    await waitSeq(seq0);
    const pinned = symOf(await doc("airnode-3"), "status/led1");
    check("P pins the selected part", !!pinned.pinned);
    // the rail's layout button runs the layout on the selection's card (fresh: unpinned parts placed anew)
    seq0 = await seqOf();
    await clickSelector('.pcb-rail button[data-tool="reroute"]');
    await waitFor<number>("window.__dev.source.model.seq", (x) => x >= seq0, 10_000);
    await sleep(800);
    const after = symOf(await doc("airnode-3"), "status/led1");
    check("the card's layout leaves the pinned part where it was", after.x === s.x && after.y === s.y && after.rotation === s.rotation, `${s.x},${s.y} -> ${after.x},${after.y}`);
    await shot("06-pinned-relayout");
  }

  // ------------------------------------------------------------------ cleanup: a fix accepted, a pass previewed, applied, reverted
  if (run("cleanup")) {
    await open("airnode-4");
    // an agent drafts quickly: three parts moved off their pins (as an agent, so nothing is pinned)
    const seqD = await seqOf();
    await browser.evaluate(`fetch("/api/agent-draft?schematic=airnode-4", { method: "POST" }).then((r) => r.json())`);
    await waitSeq(seqD);
    await waitFor<number>("window.__dev.source.derived.seq", (x) => x > seqD, 20_000);
    await browser.evaluate(`window.__dev.api.canvas.fit(undefined, { left: 60, right: 380, top: 70, bottom: 170 })`);
    await clickSelector('.pcb-tabs button[data-tab="readability"]');
    await sleep(200);
    const defects = await browser.evaluate<number>("document.querySelectorAll('[data-defect]').length");
    let accepted = false;
    for (let i = 0; i < Math.min(defects, 8) && !accepted; i++) {
      await clickSelector(`[data-defect]:nth-of-type(${i + 1}) .sch-defect`);
      const n = await waitFor<number>("document.querySelectorAll('[data-fix]').length + (document.querySelector('.sch-fix.mute') && !/Proposing/.test(document.querySelector('.sch-fix.mute').textContent) ? 100 : 0)", (x) => x > 0, 20_000);
      if (n === 0 || n >= 100) continue;
      await sleep(300);
      await shot("07-fix-ghost");
      const seq0 = await seqOf();
      const label = await browser.evaluate<string>("document.querySelector('[data-fix] .t').childNodes[0].textContent");
      await clickSelector('[data-fix] [data-action="accept-fix"]');
      await waitSeq(seq0);
      const log = await browser.evaluate<{ label: string; actor: { kind: string } }>("window.__dev.source.log.at(-1)");
      accepted = /accept the fix/.test(log.label) && log.actor.kind === "human";
      check("a candidate fix is accepted as the person's change", accepted, `${label} · seq ${seq0} -> ${await seqOf()}`);
      await shot("08-fix-accepted");
    }
    if (!accepted) check("a candidate fix is accepted as the person's change", false, "no defect offered an improving fix");
    const score0 = await browser.evaluate<number>("window.__dev.source.derived.score");
    await clickSelector('[data-action="cleanup-preview"]');
    await waitFor<boolean>("!!document.querySelector('[data-action=cleanup-apply]') || !!document.querySelector('[data-action=cleanup-discard]')", (x) => x, 60_000);
    await sleep(300);
    const seqP = await seqOf();
    check("a cleanup pass previews on a copy (nothing written)", seqP === (await seqOf()) && (await browser.evaluate<boolean>("!!document.querySelector('.sch-svg .layer.ghost g')")));
    await shot("09-cleanup-preview");
    const canApply = await browser.evaluate<boolean>("!document.querySelector('[data-action=cleanup-apply]')?.disabled");
    if (canApply) {
      await clickSelector('[data-action="cleanup-apply"]');
      await waitSeq(seqP, 30_000);
      await sleep(600);
      const score1 = await browser.evaluate<number>("window.__dev.source.derived.score");
      check("the person applies the pass as one change set", (await seqOf()) > seqP, `score ${score0} -> ${score1}`);
      await shot("10-cleanup-applied");
      const seqA = await seqOf();
      await clickSelector('[data-action="cleanup-revert"]');
      await waitSeq(seqA, 30_000);
      await sleep(600);
      check("revert undoes the whole pass", (await browser.evaluate<number>("window.__dev.source.derived.score")) === score0, `score back to ${await browser.evaluate<number>("window.__dev.source.derived.score")}`);
    } else check("the pass found fixes to apply", false, "the preview has no step (the sheet scores as the layout left it)");
  }

  // ------------------------------------------------------------------ cross-probe to the layout screen and back
  if (run("probe")) {
    await open("airnode-5");
    const d = await doc("airnode-5");
    const c = center(d, "sym:mcu/module");
    await zoomTo([c[0] - 30, c[1] - 20, c[0] + 30, c[1] + 20]);
    await click(await screenOf(c));
    await shot("11-schematic-selected-u1");
    await clickSelector('.pcb-switch button[data-depth="layout"]');
    await waitFor<boolean>("!!window.__dev.layoutReady", (x) => x, 30_000);
    await sleep(800);
    const sel = await browser.evaluate<string[]>("window.__dev.layout.selection");
    check("selecting U1 in the schematic selects it in the layout", sel.includes("fp:mcu/module"), sel.join(","));
    await shot("12-layout-probed");
    // the reverse: a footprint selected in the layout, then the switcher back
    await browser.evaluate(`(() => { const v = window.__dev.layout; const fp = window.__dev.layoutSource.snapshot().doc.records.get("fp:sensor/ic"); const p = v.toScreen(fp.x * 1e-6, fp.y * 1e-6); const r = document.querySelector(".pcb-canvas").getBoundingClientRect(); window.__fp = { x: r.left + p.x, y: r.top + p.y }; })()`);
    await click(await browser.evaluate<{ x: number; y: number }>("window.__fp"));
    await sleep(300);
    await clickSelector('.pcb-switch button:not(.on)[title^="Schematic"]');
    await waitFor<boolean>("!!window.__dev.api && window.__dev.view === 'schematic'", (x) => x, 30_000);
    await sleep(800);
    const probed = await browser.evaluate<number>("document.querySelectorAll('.sch-svg .layer.over rect.probe').length");
    const p = await browser.evaluate<{ parts: { path?: string }[] }>("window.__dev.probe()");
    check("selecting a footprint in the layout probes its symbol in the schematic", probed > 0 && p.parts.some((x) => x.path === "sensor/ic"), `${probed} probed, last probe ${JSON.stringify(p.parts)}`);
    await zoomTo([center(d, "sym:sensor/ic")[0] - 20, center(d, "sym:sensor/ic")[1] - 14, center(d, "sym:sensor/ic")[0] + 20, center(d, "sym:sensor/ic")[1] + 14]);
    await shot("13-schematic-probed");
  }

  // ------------------------------------------------------------------ depth stops
  if (run("depth")) {
    await open("airnode-6");
    await clickSelector('.pcb-tabs button[data-tab="blocks"]');
    await clickSelector('.sch-depth button:nth-child(2)');
    await sleep(300);
    check("the blocks stop (L1) shows cards", (await browser.evaluate<string>("document.querySelector('[data-zoom]').dataset.zoom")) === "1");
    await shot("14-depth-blocks");
    await clickSelector('.sch-depth button:nth-child(3)');
    await sleep(300);
    check("the symbols stop (L2)", (await browser.evaluate<string>("document.querySelector('[data-zoom]').dataset.zoom")) === "2");
    await shot("15-depth-symbols");
  }

  // ------------------------------------------------------------------ delete a wire and draw it again; save
  if (run("wire")) {
    await open("airnode-7");
    const d = await doc("airnode-7");
    const g = geometryOf(d);
    const w = recordsOfKind(d, "wire").find((x) => x.points.length === 2 && new Set([...g.pins.values()].filter((p) => p.net === x.net && (sameAt(p.at, x.points[0]) || sameAt(p.at, x.points[1]))).map((p) => `${p.part}@${p.at}`)).size === 2) as WireRecT | undefined;
    if (!w) check("a wire between two pins to redraw", false, "none found");
    else {
      const mid: [number, number] = [(w.points[0][0] + w.points[1][0]) / 2, (w.points[0][1] + w.points[1][1]) / 2];
      await zoomTo([mid[0] - 12, mid[1] - 9, mid[0] + 12, mid[1] + 9]);
      await click(await screenOf(mid));
      let seq0 = await seqOf();
      await key("Delete", "Delete", 0, 46);
      await waitSeq(seq0);
      check("Delete removes the selected wire", !(await doc("airnode-7")).records.has(w.id));
      await key("w", "KeyW");
      seq0 = await seqOf();
      await click(await screenOf(w.points[0] as [number, number]));
      await click(await screenOf(w.points[1] as [number, number]));
      await waitSeq(seq0);
      const after = await doc("airnode-7");
      const drawn = recordsOfKind(after, "wire").find((x) => x.net === w.net && sameAt(x.points[0], w.points[0]) && sameAt(x.points[x.points.length - 1], w.points[1]));
      check("the wire tool draws it again on its UHD net", !!drawn, drawn ? `${drawn.net} ${JSON.stringify(drawn.points)}` : `no wire; toast: ${await browser.evaluate<string | null>("document.querySelector('[data-toast]')?.textContent ?? null")}; ${w.net} ${JSON.stringify(w.points)}`);
      await shot("16-wire-redrawn");
      await key("s", "KeyS", 2);
      await sleep(1000);
      check("Ctrl+S saves the schematic files", existsSync(join(dev.root, "copy7", "schematic", "wires.jsonl")));
    }
  }

  // ------------------------------------------------------------------ a real board: first paint and pan frame time
  if (values.local) {
    const key = `local-${values.local}`;
    const t0 = Date.now();
    await open(key);
    const wall = Date.now() - t0;
    const fp = await browser.evaluate<number>("window.__dev.firstPaintMs");
    const counts = await browser.evaluate<{ items: number; parts: number }>("({ items: window.__dev.source.model.items.length, parts: window.__dev.source.model.parts.length })");
    const canvasPaint = await browser.evaluate<number>("window.__dev.api.firstPaintMs ?? -1");
    const pan = async (zoom: "fit" | "100") =>
      browser.evaluate<number[]>(`(async () => { const c = window.__dev.api.canvas; c.fit(undefined, { left: 60, right: 380, top: 70, bottom: 170 }); ${zoom === "100" ? "c.zoomAt(700, 450, 16 / c.view.s);" : ""} await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r)); const out = []; let last = performance.now(); for (let i = 0; i < 90; i++) { c.panBy(i < 45 ? 9 : -9, 3); await new Promise((r) => requestAnimationFrame(r)); const now = performance.now(); out.push(now - last); last = now; } return out; })()`);
    const stat = (frames: number[]) => {
      const sorted = [...frames].sort((a, b) => a - b);
      return `median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms`;
    };
    const atFit = stat(await pan("fit"));
    const at100 = stat(await pan("100"));
    console.log(`board ${values.local}: ${counts.parts} parts, ${counts.items} drawn items; open to ready ${wall} ms (host layout and drawing included); page ready ${Math.round(fp)} ms after the page script started; canvas first paint ${Math.round(canvasPaint)} ms; pan frame at fit ${atFit}; at 100% ${at100}`);
    await browser.evaluate(`window.__dev.api.canvas.fit(undefined, { left: 60, right: 380, top: 70, bottom: 170 })`);
    await shot(`20-local-${values.local}`);
  }
} catch (e) {
  check("the session ran to the end", false, String((e as Error).stack ?? e));
} finally {
  const errs = browser.takeErrors();
  if (errs.length) console.log(`page errors:\n${errs.join("\n")}`);
  await browser.close();
  await dev.close();
}

function segDist(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function sameAt(a: readonly number[], b: readonly number[]) {
  return a[0] === b[0] && a[1] === b[1];
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
