/**
 * The board renderer's performance on a synthetic board (synth.ts: 6 copper layers, about 1,000 tracks, 230 vias),
 * or on a board folder (`--board`, drawn with its cached zone fill), in headless Chrome: first paint, and the
 * GPU-synced cost of pan frames over the whole board and at 2x zoom.
 *
 *   npx tsx packages/views/bench/pcb-screen/perf.ts [--board <folder>] [--backend gpu|auto|swiftshader] [--width 1600] [--height 1000] [--frames 120] [--json out.json]
 *
 * Frame cost here is render plus a one-pixel readback per frame (the GPU finishes the frame before the clock
 * stops), not requestAnimationFrame intervals: headless frame pacing does not measure display frames. GPU (the
 * default `auto`) is what a person's machine uses; SwiftShader is the CPU path agents and CI use.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { launchBrowser } from "@protoboardai/core/cdp";
import { copperLayers, loadBoardDir, loadZoneFill } from "@protoboardai/board/node";
import { zoneFillsFromEntries } from "../../src/pcb/fills.js";
import { pageScript } from "../../src/pcb/headless/render.js";
import { synthBoard } from "./synth.js";

const { values } = parseArgs({ options: { board: { type: "string" }, backend: { type: "string" }, width: { type: "string" }, height: { type: "string" }, frames: { type: "string" }, json: { type: "string" } } });
const width = Number(values.width ?? 1600);
const height = Number(values.height ?? 1000);
const doc = values.board ? loadBoardDir(values.board).doc : synthBoard();
const fill = values.board ? loadZoneFill(values.board, doc) : undefined;
const fills = zoneFillsFromEntries(fill?.fill.fills).fills;
const counts: Record<string, number> = {};
for (const r of doc.records.values()) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
let pads = 0;
for (const r of doc.records.values()) if (r.kind === "footprint") pads += r.pads.length;

const browser = await launchBrowser({ backend: (values.backend as "auto") ?? "auto", purpose: "The renderer's performance script", echoErrors: true });
try {
  await browser.setViewport(width, height, 1);
  await browser.navigate("about:blank");
  await browser.evaluate(`${await pageScript()};true`);
  const payload = { records: [...doc.records.values()], ...(doc.netlist ? { netlist: doc.netlist } : {}) };
  const r = await browser.evaluate<Record<string, unknown>>(`window.__pcb.perf(${JSON.stringify(payload)}, ${JSON.stringify({ width, height, frames: Number(values.frames ?? 120), fills })})`);
  const out = { board: { copperLayers: copperLayers(doc).length, tracks: counts.track, vias: counts.via, footprints: counts.footprint, pads, zones: counts.zone, fillPolygons: fills.reduce((n, f) => n + f.polygons.length, 0) }, backend: browser.backend.kind, fallback: browser.backend.fallback, viewport: `${width}x${height}`, ...r };
  console.log(JSON.stringify(out, null, 2));
  if (values.json) writeFileSync(values.json, JSON.stringify(out, null, 2));
} finally {
  await browser.close();
}
