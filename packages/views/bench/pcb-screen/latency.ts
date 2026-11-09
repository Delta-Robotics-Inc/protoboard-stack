/**
 * Input-to-paint latency of a footprint drag on the layout screen (the dev page, serve.ts), in headless Chrome: a
 * person's drag of one footprint, as real mouse events through DevTools, on the synthetic 6-layer board (synth.ts)
 * or a board folder. For each pointer move it measures, in the page, from the event's time stamp to the end of the
 * first frame drawn after it, with a one-pixel readback so the GPU's work counts (the same sync perf.ts uses):
 * that is the time from the input to a frame the display can show, without the compositor's own last step.
 *
 *   npx tsx packages/views/bench/pcb-screen/latency.ts [--board <folder>] [--backend auto|gpu|swiftshader] [--moves 120] [--json out.json]
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser } from "@protoboardai/core/cdp";
import { copperLayers, writeBoardDir, writeNetlist } from "@protoboardai/board/node";
import { startDevServer } from "./serve.js";
import { synthBoard } from "./synth.js";

const { values } = parseArgs({ options: { board: { type: "string" }, backend: { type: "string" }, moves: { type: "string" }, json: { type: "string" } } });
const MOVES = Number(values.moves ?? 120);
let dir = values.board;
let tmp: string | undefined;
let doc = undefined as ReturnType<typeof synthBoard> | undefined;
if (!dir) {
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
  await browser.navigate(`${dev.url}?board=${encodeURIComponent(dir)}`);
  for (let i = 0; i < 300; i++) {
    const s = await browser.evaluate<{ ready: boolean; error?: string }>("({ ready: !!window.__dev?.ready, error: window.__dev?.error })");
    if (s.error) throw new Error(s.error);
    if (s.ready) break;
    await sleep(100);
  }
  for (let i = 0; i < 300 && !(await browser.evaluate<boolean>("!!window.__dev?.derived")); i++) await sleep(100);
  await sleep(500);
  // a footprint near the middle of the view
  const target = await browser.evaluate<{ id: string; x: number; y: number; px: number; py: number; counts: Record<string, number>; hits: unknown[]; writable: boolean }>(`(() => {
    const s = window.__dev.session.snapshot();
    const v = window.__dev.view;
    const fps = [...s.doc.records.values()].filter((r) => r.kind === "footprint" && !r.locked);
    const counts = {};
    for (const r of s.doc.records.values()) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    fps.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
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
  const r = await browser.evaluate<{ samples: number[]; frames: number; preview: number[]; applyCommit: number[] }>("({ samples: window.__lat.samples, frames: window.__lat.frames, preview: window.__lat.preview, applyCommit: window.__lat.applyCommit })");
  const med = (a: number[]) => (a.length ? Number([...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(1)) : null);
  await mouse("mouseReleased", target.px + MOVES * 1.5, target.py, 0);
  await sleep(1500);
  const committed = await browser.evaluate<number>("window.__dev.session.confirmed().seq");
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
    pressedOn: target.hits[0],
    writable: target.writable,
    backend: browser.backend.kind,
    gpu: browser.backend.gl?.renderer,
    moves: MOVES,
    framesWithInput: r.frames,
    samples: s.length,
    previewMs: { median: med(r.preview), count: r.preview.length },
    redrawMs: { median: med(r.applyCommit), count: r.applyCommit.length },
    inputToPaintMs: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: s.length ? Number(s[s.length - 1].toFixed(1)) : null },
    committedSeq: committed,
    pageErrors: browser.takeErrors(),
  };
  console.log(JSON.stringify(out, null, 2));
  if (values.json) writeFileSync(values.json, JSON.stringify(out, null, 2));
} finally {
  await browser.close();
  await dev.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
