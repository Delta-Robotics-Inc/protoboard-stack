/**
 * The Atlas highlight's timing (atlas/hover.ts and draw.ts): exponential
 * easing by real elapsed time (frame-rate independent, turning back from
 * wherever it is), no enter delay, the hold on leaving a node for empty
 * canvas, the direct handoff between nodes, and a fade that always runs
 * (never tied to reduced motion).
 */
import { readFileSync } from "node:fs";
import type { AtlasGraph } from "@protoboardai/core/atlas";
import { describe, expect, it } from "vitest";
import { fitTo } from "../src/atlas/camera.js";
import { DIM, createDrawState, drawAtlas, type DrawState } from "../src/atlas/draw.js";
import { Ease, HOVER, HoverIntent, easeShare } from "../src/atlas/hover.js";
import { paletteFrom } from "../src/atlas/palette.js";
import { AtlasSimulation } from "../src/atlas/sim.js";

const GRAPH: AtlasGraph = JSON.parse(readFileSync(new URL("./fixtures/atlas-graph.json", import.meta.url), "utf8"));
const P = paletteFrom((t) => `token:${t}`, "mono-test", false);

/** A context that ignores everything (the timing is what is tested here). */
const ctx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? (text: string) => ({ width: text.length * 7 }) : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;

function state(init: Partial<DrawState> = {}): DrawState {
  const sim = new AtlasSimulation(GRAPH, { pullBy: "links" });
  sim.settle();
  const s = createDrawState(sim, { w: 1200, h: 800, time: 0, ...init });
  fitTo(s.cam, sim.nodes, s.w, s.h, 46, true);
  return s;
}

/** Draw frames `ms` apart for `total` ms. */
function run(s: DrawState, total: number, ms = 1000 / 60) {
  for (let t = 0; t < total - 1e-9; t += ms) drawAtlas(ctx, s, P, s.time + ms);
}

const idx = (s: DrawState, id: string) => s.sim.indexOf(id)!;
/** A node far from `def:frame`'s neighborhood, and one next to it. */
const FAR = "file:models/gps.glb";
const NEAR = "file:cad/frame.step";
/** The share of the way to DIM a node has gone (0 lit, 1 dimmed). */
const dimShare = (s: DrawState, i: number) => (1 - s.alpha[i]!) / (1 - DIM);

describe("Atlas highlight timing", () => {
  it("HOVER holds the measured time constants (in one place), with no enter delay", () => {
    expect(HOVER).toEqual({ dimTauMs: 220, restoreTauMs: 250, accentInMs: 150, holdMs: 160 });
  });

  it("an exponential ease: the share covered in dt is 1 - e^(-dt/tau), and two half steps make one whole", () => {
    expect(easeShare(220, 220)).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(easeShare(0, 220)).toBe(0);
    expect(easeShare(10, 0)).toBe(1);
    const a = new Ease(1, 0);
    const b = new Ease(1, 0);
    a.step(0, 1, 100, 220);
    b.step(0, 1, 50, 220);
    b.step(0, 1, 50, 220);
    expect(a.value[0]).toBeCloseTo(b.value[0]!, 5);
    // a change of target turns back from where it is: no snap
    const c = new Ease(1, 1);
    c.step(0, 0, 100, 220);
    const mid = c.value[0]!;
    c.step(0, 1, 16, 250);
    expect(c.value[0]).toBeGreaterThan(mid);
    expect(c.value[0]).toBeLessThan(mid + 0.1);
  });

  it("dimming follows dimTauMs by real time: 90 % at about 550 ms, settled by about 900 ms, the same at 30, 60 and 144 frames a second", () => {
    const shares = [30, 60, 144].map((fps) => {
      const s = state();
      s.hover = idx(s, "def:frame");
      const far = idx(s, FAR);
      run(s, 220, 1000 / fps);
      const tau = dimShare(s, far);
      run(s, 330, 1000 / fps);
      const at550 = dimShare(s, far);
      run(s, 350, 1000 / fps);
      return { tau, at550, at900: dimShare(s, far) };
    });
    for (const x of shares) {
      expect(x.tau).toBeCloseTo(1 - Math.exp(-1), 1);
      expect(x.at550).toBeGreaterThan(0.89);
      expect(x.at900).toBeGreaterThan(0.98);
    }
    expect(Math.abs(shares[0]!.at550 - shares[2]!.at550)).toBeLessThan(0.01);
  });

  it("no enter delay: the dimming, the outline and the label start on the frame the pointer reaches a node", () => {
    const s = state();
    const i = idx(s, "def:frame");
    s.hover = i;
    drawAtlas(ctx, s, P, s.time + 16);
    expect(s.alpha[idx(s, FAR)]).toBeLessThan(1);
    expect(s.accent[i]).toBeGreaterThan(0);
    expect(s.intent.focus).toBe(i);
  });

  it("leaving a node for empty canvas holds the dimming for holdMs, then restores with restoreTauMs", () => {
    const s = state();
    s.hover = idx(s, "def:frame");
    const far = idx(s, FAR);
    run(s, 1200);
    expect(s.alpha[far]).toBeCloseTo(DIM, 2);
    s.hover = null;
    run(s, HOVER.holdMs - 20);
    // still dimmed through the hold
    expect(s.alpha[far]).toBeCloseTo(DIM, 2);
    run(s, 20 + HOVER.restoreTauMs);
    // about one restore time constant after the hold ended: 63 % of the way back
    const back = (s.alpha[far]! - DIM) / (1 - DIM);
    expect(back).toBeGreaterThan(0.5);
    expect(back).toBeLessThan(0.75);
    run(s, 2000);
    expect(s.alpha[far]).toBe(1);
  });

  it("moving to another node within the hold hands the focus straight over: a node dimmed under both never brightens", () => {
    const s = state();
    s.hover = idx(s, "def:frame");
    const far = idx(s, FAR);
    run(s, 1200);
    // a node outside both neighborhoods: def:frame's and its neighbor's
    const b = idx(s, NEAR);
    const both = s.sim.nodes.find((n) => n.index !== idx(s, "def:frame") && n.index !== b && !s.sim.neighborIndices(idx(s, "def:frame")).includes(n.index) && !s.sim.neighborIndices(b).includes(n.index))!.index;
    const low = s.alpha[both]!;
    s.hover = null;
    let peak = 0;
    for (let t = 0; t < HOVER.holdMs - 40; t += 16) {
      drawAtlas(ctx, s, P, s.time + 16);
      peak = Math.max(peak, s.alpha[both]!);
    }
    s.hover = b;
    for (let t = 0; t < 600; t += 16) {
      drawAtlas(ctx, s, P, s.time + 16);
      peak = Math.max(peak, s.alpha[both]!);
    }
    expect(peak).toBeLessThan(low + 0.01);
    expect(s.intent.focus).toBe(b);
    expect(far).toBeGreaterThanOrEqual(0);
  });

  it("from node to node directly: the focus switches at once, no hold", () => {
    const it = new HoverIntent();
    expect(it.update(3, null, 0, false)).toEqual({ focus: 3, waiting: false });
    expect(it.update(7, null, 16, false)).toEqual({ focus: 7, waiting: false });
    // left for the canvas: held, and a frame is due
    expect(it.update(null, null, 32, false)).toEqual({ focus: 7, waiting: true });
    expect(it.update(null, null, 32 + HOVER.holdMs - 1, false).focus).toBe(7);
    expect(it.update(null, null, 32 + HOVER.holdMs, false)).toEqual({ focus: null, waiting: false });
    // with a selection the map rests on it after the hold
    it.update(4, 9, 1000, false);
    expect(it.update(null, 9, 1016, false).focus).toBe(4);
    expect(it.update(null, 9, 1016 + HOVER.holdMs, false).focus).toBe(9);
    // the selection itself is never held
    expect(it.update(null, 9, 2000, false)).toEqual({ focus: 9, waiting: false });
  });

  it("the fade always runs: the renderer has no instant mode, so reduced motion never touches it", () => {
    const s = state();
    // nothing in the draw state can turn the easing off
    expect("instant" in s).toBe(false);
    const i = idx(s, "def:frame");
    s.hover = i;
    // one frame in: on its way down, not there (an instant change would land on DIM at once)
    expect(drawAtlas(ctx, s, P, s.time + 16)).toBe(true);
    expect(s.alpha[idx(s, FAR)]).toBeGreaterThan(DIM + 0.5);
    run(s, 1200);
    expect(s.alpha[idx(s, FAR)]).toBeCloseTo(DIM, 2);
    // and the hold, then the restore, on leaving
    s.hover = null;
    run(s, HOVER.holdMs - 20);
    expect(s.alpha[idx(s, FAR)]).toBeCloseTo(DIM, 2);
    run(s, 60);
    expect(s.alpha[idx(s, FAR)]).toBeGreaterThan(DIM + 0.01);
    expect(s.alpha[idx(s, FAR)]).toBeLessThan(1);
  });

  it("a frame after the loop idled counts as one frame: a long pause does not jump the fade to its end", () => {
    const s = state();
    s.hover = idx(s, "def:frame");
    s.time = Number.NaN;
    drawAtlas(ctx, s, P, 1_000_000);
    expect(dimShare(s, idx(s, FAR))).toBeLessThan(0.1);
    // nor does a stalled frame (a long gap is capped)
    drawAtlas(ctx, s, P, 1_010_000);
    expect(dimShare(s, idx(s, FAR))).toBeLessThan(0.5);
  });
});
