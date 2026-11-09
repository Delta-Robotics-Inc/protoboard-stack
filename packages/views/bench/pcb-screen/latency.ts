/**
 * Input-to-paint latency of a footprint drag on the layout screen (the dev page, serve.ts), in headless Chrome: a
 * person's drag of one footprint, as real mouse events through DevTools, on the synthetic 6-layer board (synth.ts)
 * or a board folder. For each pointer move it measures, in the page, from the event's time stamp to the end of the
 * first frame drawn after it, with a one-pixel readback so the GPU's work counts (the same sync perf.ts uses):
 * that is the time from the input to a frame the display can show, without the compositor's own last step.
 *
 * The footprint drag runs through the editing kernel (a footprint with its attached tracks: the kernel's drag
 * session previews what `footprint.move` will do); `kernelMs` is the kernel's own time per step.
 *
 * `--tool route` measures the interactive route tool instead: the route tool (X) on a pad near the middle of the
 * view, then the cursor swept across the board with no button held. Per cursor move: the kernel's walk-around step
 * (`kernelMs`) and the time from the pointer event to the draft drawn in the page (`inputToDraftMs`: the draft
 * layer written in the next animation frame; the compositor's paint follows it).
 *
 *   npx tsx packages/views/bench/pcb-screen/latency.ts [--tool drag|route] [--airnode | --board <folder>] [--backend auto|gpu|swiftshader] [--moves 120] [--json out.json]
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser } from "@protoboardai/core/cdp";
import { copperLayers, writeBoardDir, writeNetlist } from "@protoboardai/board/node";
import { padsOf, type BoardDocument, type FootprintRec } from "@protoboardai/board";
import { latencyStats } from "../../src/pcb/edit/tools.js";
import { startDevServer } from "./serve.js";
import { synthBoard } from "./synth.js";

const { values } = parseArgs({ options: { board: { type: "string" }, airnode: { type: "boolean" }, tool: { type: "string" }, backend: { type: "string" }, moves: { type: "string" }, json: { type: "string" } } });
const TOOL = values.tool === "route" ? "route" : "drag";
const MOVES = Number(values.moves ?? 120);
let dir = values.board;
let tmp: string | undefined;
let doc = undefined as ReturnType<typeof synthBoard> | undefined;
if (!dir && !values.airnode) {
  tmp = mkdtempSync(join(tmpdir(), "pcb-latency-"));
  dir = join(tmp, "synth6");
  doc = synthBoard();
  writeBoardDir(dir, doc);
  if (doc.netlist) writeNetlist(dir, doc.netlist);
}

const dev = await startDevServer(0);
const browser = await launchBrowser({ backend: (values.backend as "auto") ?? "auto", purpose: "Input-to-paint latency of a footprint drag", echoErrors: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  await browser.setViewport(1440, 900, 1);
  await browser.navigate(dir ? `${dev.url}?board=${encodeURIComponent(dir)}` : dev.url);
  for (let i = 0; i < 300; i++) {
    const s = await browser.evaluate<{ ready: boolean; error?: string }>("({ ready: !!window.__dev?.ready, error: window.__dev?.error })");
    if (s.error) throw new Error(s.error);
    if (s.ready) break;
    await sleep(100);
  }
  for (let i = 0; i < 300 && !(await browser.evaluate<boolean>("!!window.__dev?.derived")); i++) await sleep(100);
  await sleep(500);
  if (TOOL === "route") {
    await routeLatency(doc ?? dev.fixture.snapshot().doc);
    process.exit(0);
  }
  // a footprint near the middle of the view, one with tracks attached to its pads first (they follow it)
  const board = doc ?? dev.fixture.snapshot().doc;
  const withTracks: Record<string, number> = {};
  for (const r of board.records.values()) {
    if (r.kind !== "footprint") continue;
    const boxes = padsOf(r as FootprintRec).map((p) => p.box);
    let n = 0;
    for (const t of board.records.values()) if (t.kind === "track" && [t.start, t.end].some((e) => boxes.some((b) => e.x >= b.minX && e.x <= b.maxX && e.y >= b.minY && e.y <= b.maxY))) n++;
    if (n) withTracks[r.id] = n;
  }
  const target = await browser.evaluate<{ id: string; x: number; y: number; px: number; py: number; counts: Record<string, number>; hits: unknown[]; writable: boolean }>(`(() => {
    const s = window.__dev.session.snapshot();
    const v = window.__dev.view;
    const fps = [...s.doc.records.values()].filter((r) => r.kind === "footprint" && !r.locked);
    const counts = {};
    for (const r of s.doc.records.values()) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    const attached = ${JSON.stringify(withTracks)};
    fps.sort((a, b) => (attached[b.id] ? 1 : 0) - (attached[a.id] ? 1 : 0) || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    const r = document.querySelector(".pcb-canvas").getBoundingClientRect();
    // the nearest footprint a press reaches (not under a finding marker or a card)
    const f = fps.find((f) => { const q = v.toScreen(f.x / 1e6, f.y / 1e6); return document.elementFromPoint(r.left + q.x, r.top + q.y)?.tagName === "CANVAS"; }) ?? fps[0];
    const p = v.toScreen(f.x / 1e6, f.y / 1e6);
    return { id: f.id, x: f.x, y: f.y, px: r.left + p.x, py: r.top + p.y, counts, hits: v.pickScreen(p.x, p.y).slice(0, 3), writable: window.__dev.session.writable };
  })()`);
  // instrument: each pointer move's time stamp, and the end of the first frame (GPU-synced) drawn after it
  await browser.evaluate(`(() => {
    const v = window.__dev.view;
    const lat = (window.__lat = { pending: [], samples: [], frames: 0 });
    document.querySelector(".pcb-canvas").addEventListener("pointermove", (e) => { if (e.buttons) lat.pending.push(e.timeStamp); }, { capture: true });
    const timed = (o, name) => { const f = o[name].bind(o); lat[name] = []; o[name] = (...a) => { const t = performance.now(); const r = f(...a); lat[name].push(performance.now() - t); return r; }; };
    timed(window.__dev.session, "preview");
    timed(window.__dev.session, "previewRecords");
    timed(v, "applyCommit");
    const orig = v.renderNow.bind(v);
    v.renderNow = () => {
      orig();
      if (!lat.pending.length) return;
      v.renderer.finish();
      const t = performance.now();
      for (const ts of lat.pending) lat.samples.push(t - ts);
      lat.pending = [];
      lat.frames++;
    };
    return true;
  })()`);
  const mouse = (type: string, x: number, y: number, buttons = 0) => browser.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1 });
  await mouse("mouseMoved", target.px, target.py);
  await mouse("mousePressed", target.px, target.py);
  for (let i = 1; i <= MOVES; i++) {
    // a slow, steady drag: one move per 16 ms, 1.5 px each (the grid snaps it to 0.25 mm steps)
    await mouse("mouseMoved", target.px + i * 1.5, target.py + Math.sin(i / 10) * 8, 1);
    await sleep(16);
  }
  await sleep(200);
  const r = await browser.evaluate<{ samples: number[]; frames: number; preview: number[]; applyCommit: number[]; kernel: number[]; kernelDrag: boolean }>("({ samples: window.__lat.samples, frames: window.__lat.frames, preview: window.__lat.preview.concat(window.__lat.previewRecords), applyCommit: window.__lat.applyCommit, kernel: window.__pcbTools?.controller.timings.drag ?? [], kernelDrag: (window.__pcbTools?.controller.timings.drag ?? []).length > 0 })");
  const med = (a: number[]) => (a.length ? Number([...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(1)) : null);
  await mouse("mouseReleased", target.px + MOVES * 1.5, target.py, 0);
  // the commit: the service's reply and the feed (a large board's live checks can take a moment)
  let committed = 0;
  for (let i = 0; i < 100 && !committed; i++) {
    await sleep(100);
    committed = await browser.evaluate<number>("window.__dev.session.confirmed().seq");
  }
  const lastWrite = await browser.evaluate<unknown>("window.__dev.session.status().last ?? null");
  const s = [...r.samples].sort((a, b) => a - b);
  const q = (f: number) => (s.length ? Number(s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(1)) : null);
  const out = {
    board: dir === values.board ? dir : "synthetic (synth.ts)",
    copperLayers: doc ? copperLayers(doc).length : undefined,
    footprints: target.counts.footprint,
    tracks: target.counts.track,
    vias: target.counts.via,
    zones: target.counts.zone,
    footprint: target.id,
    attachedTracks: withTracks[target.id] ?? 0,
    pressedOn: target.hits[0],
    writable: target.writable,
    backend: browser.backend.kind,
    gpu: browser.backend.gl?.renderer,
    moves: MOVES,
    framesWithInput: r.frames,
    samples: s.length,
    kernelDrag: r.kernelDrag,
    kernelMs: latencyStats(r.kernel),
    inputToPaintStats: latencyStats(r.samples),
    previewMs: { median: med(r.preview), count: r.preview.length },
    redrawMs: { median: med(r.applyCommit), count: r.applyCommit.length },
    inputToPaintMs: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: s.length ? Number(s[s.length - 1].toFixed(1)) : null },
    committedSeq: committed,
    lastWrite,
    pageErrors: browser.takeErrors(),
  };
  console.log(JSON.stringify(out, null, 2));
  if (values.json) writeFileSync(values.json, JSON.stringify(out, null, 2));
} finally {
  await finish();
}

async function finish() {
  await browser.close();
  await dev.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

/** The route tool: a pad near the view's middle, then the cursor swept with no button (one move per 16 ms). */
async function routeLatency(board: BoardDocument) {
  const view = await browser.evaluate<{ cx: number; cy: number; left: number; top: number }>(`(() => { const v = window.__dev.view; const r = document.querySelector(".pcb-canvas").getBoundingClientRect(); const c = v.toWorld(r.width * 0.42, r.height * 0.48); return { cx: c.x, cy: c.y, left: r.left, top: r.top }; })()`);
  const pads: { id: string; x: number; y: number }[] = [];
  for (const r of board.records.values()) if (r.kind === "footprint") for (const p of padsOf(r as FootprintRec)) if (board.padNets.get(p.id)) pads.push({ id: p.id, x: p.x / 1e6, y: p.y / 1e6 });
  pads.sort((a, b) => Math.hypot(a.x - view.cx, a.y - view.cy) - Math.hypot(b.x - view.cx, b.y - view.cy));
  const screenOf = (x: number, y: number) => browser.evaluate<{ x: number; y: number; free: boolean }>(`(() => { const v = window.__dev.view; const r = document.querySelector(".pcb-canvas").getBoundingClientRect(); const p = v.toScreen(${x}, ${y}); return { x: r.left + p.x, y: r.top + p.y, free: document.elementFromPoint(r.left + p.x, r.top + p.y)?.tagName === "CANVAS" }; })()`);
  const key = async (k: string, code: string, modifiers = 0) => {
    await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, modifiers, ...(k.length === 1 ? { text: k } : {}) });
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers });
  };
  const mouse = (type: string, x: number, y: number) => browser.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await key("x", "KeyX");
  await sleep(100);
  let start: { id: string; x: number; y: number; sx: number; sy: number; dir: number } | undefined;
  const drafted = () => browser.evaluate<number>("window.__pcbTools?.controller.route?.candidate?.length.total ?? 0");
  for (const p of pads.slice(0, 60)) {
    const s = await screenOf(p.x, p.y);
    if (!s.free) continue;
    await mouse("mouseMoved", s.x, s.y);
    await mouse("mousePressed", s.x, s.y);
    await mouse("mouseReleased", s.x, s.y);
    await sleep(120);
    if (!(await browser.evaluate<boolean>("!!window.__pcbTools?.controller.route"))) continue;
    // a start whose neighborhood lets the head move (a pad boxed in by other nets' pads makes a poor sample)
    for (const dir of [1, -1]) {
      await mouse("mouseMoved", s.x + dir * 60, s.y - 20);
      await sleep(60);
      if ((await drafted()) > 0) {
        start = { ...p, sx: s.x, sy: s.y, dir };
        break;
      }
    }
    if (start) break;
    await key("Escape", "Escape");
    await sleep(60);
  }
  if (!start) throw new Error("no pad started a route");
  await browser.evaluate(`(() => {
    const lat = (window.__rlat = { pending: [], samples: [] });
    document.querySelector(".pcb-canvas").addEventListener("pointermove", (e) => lat.pending.push(e.timeStamp), { capture: true });
    const svg = document.querySelector(".pcb-draft");
    new MutationObserver(() => { const t = performance.now(); for (const ts of lat.pending) lat.samples.push(t - ts); lat.pending = []; const c = window.__pcbTools.controller.route?.candidate; if (c) { lat.maxLen = Math.max(lat.maxLen ?? 0, c.length.total); lat.budget = (lat.budget ?? 0) + (c.timing.budgetHit ? 1 : 0); lat.stuck = (lat.stuck ?? 0) + (c.stuck ? 1 : 0); } }).observe(svg, { childList: true });
    return true;
  })()`);
  const at = (i: number) => ({ x: start!.sx + start!.dir * i * 2, y: start!.sy - 20 - Math.sin(i / 9) * 60 });
  // ten moves to warm up (not timed), then the timed sweep: 2 px per move, a slow wave across the neighborhood
  for (let i = -10; i < 0; i++) {
    await mouse("mouseMoved", at(i + 10).x, at(i + 10).y);
    await sleep(16);
  }
  await browser.evaluate("(window.__rlat.samples = [], window.__rlat.pending = [], window.__rlat.maxLen = 0, window.__rlat.budget = 0, window.__rlat.stuck = 0, window.__pcbTools.controller.timings.route.length = 0, true)");
  for (let i = 1; i <= MOVES; i++) {
    const p = at(i + 10);
    await mouse("mouseMoved", p.x, p.y);
    await sleep(16);
  }
  await sleep(300);
  const r = await browser.evaluate<{ samples: number[]; kernel: number[]; budget: number; stuck: number; net: string; len: number }>("({ samples: window.__rlat.samples, kernel: window.__pcbTools.controller.timings.route, budget: window.__rlat.budget, stuck: window.__rlat.stuck, net: window.__pcbTools.controller.route?.net, len: window.__rlat.maxLen })");
  await key("Escape", "Escape");
  const counts: Record<string, number> = {};
  for (const x of board.records.values()) counts[x.kind] = (counts[x.kind] ?? 0) + 1;
  const out = {
    tool: "route",
    board: values.airnode ? "Airnode C3 (fixture)" : dir === values.board ? dir : "synthetic (synth.ts)",
    copperLayers: copperLayers(board).length,
    footprints: counts.footprint,
    tracks: counts.track,
    vias: counts.via,
    start: start.id,
    net: r.net,
    longestDraftMm: Number((r.len / 1e6).toFixed(2)),
    framesBudgetHit: r.budget,
    framesStuck: r.stuck,
    backend: browser.backend.kind,
    moves: MOVES,
    kernelMs: latencyStats(r.kernel),
    inputToDraftMs: latencyStats(r.samples),
    pageErrors: browser.takeErrors(),
  };
  console.log(JSON.stringify(out, null, 2));
  if (values.json) writeFileSync(values.json, JSON.stringify(out, null, 2));
  await finish();
}
