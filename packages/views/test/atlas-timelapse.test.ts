/**
 * A time-lapse run (atlas/timelapse.ts with the simulation's `arrive`):
 * play always animates (live in the views; fading in place when not
 * live, which only the tests ask for), nodes arrive in sequence and are born beside a present neighbor
 * with outward momentum, links start a moment after both ends and their
 * springs ramp in, every node is on the map by the end and the layout then
 * cools on its own, pausing freezes arrivals but not the physics, scrubbing
 * back takes nodes off cleanly, and the same project gives the same run.
 */
import { readFileSync } from "node:fs";
import type { AtlasGraph } from "@protoboardai/core/atlas";
import { describe, expect, it } from "vitest";
import { AtlasSimulation } from "../src/atlas/sim.js";
import { TimelapseRun } from "../src/atlas/timelapse.js";
import { TIMELAPSE, buildTimeline } from "../src/atlas/timeline.js";

const FIXTURE: AtlasGraph = JSON.parse(readFileSync(new URL("./fixtures/atlas-graph.json", import.meta.url), "utf8"));
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 3);
/** The fixture with creation times in five commits a week apart (modules first, then parts, then files in three batches). */
const GRAPH: AtlasGraph = {
  ...FIXTURE,
  nodes: FIXTURE.nodes.map((n, i) => ({ ...n, created: { at: T0 + (n.kind === "module" ? 0 : n.kind === "part" ? 1 : 2 + (i % 3)) * 7 * DAY, from: "git" as const } })),
};

function start(live: boolean) {
  const sim = new AtlasSimulation(GRAPH, { pullBy: "links" });
  sim.settle();
  sim.cool();
  const before = sim.livePositions();
  const timeline = buildTimeline(GRAPH);
  const run = new TimelapseRun(sim, timeline, live);
  return { sim, timeline, run, before };
}

/** Frames of `ms` each for `total` ms (the view's frame times). */
function play(run: TimelapseRun, total: number, ms = 1000 / 60, from = { t: 1000 }) {
  for (let t = 0; t < total - 1e-9; t += ms) {
    from.t += ms;
    run.frame(from.t);
  }
}

const shownCount = (sim: AtlasSimulation) => sim.nodes.filter((n) => sim.isShown(n.index)).length;

describe("the time-lapse run", () => {
  it("starts empty and brings nodes in one after another, never all at once (live)", () => {
    const { sim, run, timeline } = start(true);
    expect(shownCount(sim)).toBe(0);
    const n = sim.nodes.length;
    const counts: number[] = [];
    const clock = { t: 1000 };
    for (let s = 0; s < 20; s++) {
      play(run, timeline.duration / 20, 1000 / 60, clock);
      counts.push(run.count);
    }
    play(run, 2000, 1000 / 60, clock);
    // steadily up: each twentieth of the run brings some, none brings most
    for (let k = 1; k < counts.length; k++) expect(counts[k]!).toBeGreaterThanOrEqual(counts[k - 1]!);
    const jumps = counts.map((c, k) => c - (k ? counts[k - 1]! : 0));
    expect(Math.max(...jumps)).toBeLessThan(n * 0.15);
    expect(jumps.filter((j) => j > 0).length).toBeGreaterThan(15);
    expect(run.count).toBe(n);
    expect(shownCount(sim)).toBe(n);
    expect(run.done).toBe(true);
  });

  it("not live (`reduced`, which no view sets) play still animates: in sequence, each node fading in where it was, no physics", () => {
    const { sim, run, timeline, before } = start(false);
    const clock = { t: 1000 };
    play(run, timeline.duration * 0.5, 1000 / 60, clock);
    const half = run.count;
    expect(half).toBeGreaterThan(sim.nodes.length * 0.25);
    expect(half).toBeLessThan(sim.nodes.length * 0.85);
    // the newest arrival is still fading in
    const newest = timeline.order[run.count - 1]!;
    expect(run.vis[newest]).toBeLessThan(1);
    // no pop: only its size for the links shown so far
    expect([...run.scale].every((v) => v <= 1 + 1e-6)).toBe(true);
    play(run, timeline.duration * 0.5 + 1000, 1000 / 60, clock);
    expect(run.count).toBe(sim.nodes.length);
    for (const node of sim.nodes) {
      expect(node.x).toBe(before[node.id]![0]);
      expect(node.y).toBe(before[node.id]![1]);
    }
    expect([...run.vis].every((v) => v === 1)).toBe(true);
    expect([...run.linkVis].every((v) => v === 1)).toBe(true);
  });

  it("a node is born beside a present neighbor it links to, heading outward; one with none just outside the cloud, drifting in", () => {
    const { sim, run, timeline } = start(true);
    let checked = 0;
    let lone = 0;
    for (let q = 1; q < timeline.order.length && (checked < 25 || lone < 3); q++) {
      run.seek(timeline.arrive[timeline.order[q - 1]!]!);
      const i = timeline.order[q]!;
      const present = sim.neighborIndices(i).filter((j) => sim.isShown(j));
      const cloud = sim.nodes.filter((m) => sim.isShown(m.index));
      run.seek(timeline.arrive[i]!);
      expect(sim.isShown(i)).toBe(true);
      const n = sim.nodes[i]!;
      const speed = Math.hypot(n.vx, n.vy);
      if (!present.length) {
        // outside the cloud's 95th-percentile radius, heading in, set to drift about 4 diameters
        const cx = cloud.reduce((a, m) => a + m.x, 0) / cloud.length;
        const cy = cloud.reduce((a, m) => a + m.y, 0) / cloud.length;
        const radii = cloud.map((m) => Math.hypot(m.x - cx, m.y - cy)).sort((a, b) => a - b);
        const r95 = radii[Math.floor(0.95 * (radii.length - 1))]!;
        expect(Math.hypot(n.x - cx, n.y - cy)).toBeGreaterThanOrEqual(TIMELAPSE.loneEdge * r95 - 1e-6);
        const [dx, dy] = sim.driftOf(i);
        expect(speed).toBe(0);
        expect((cx - n.x) * dx + (cy - n.y) * dy).toBeGreaterThan(0);
        const d = TIMELAPSE.loneDamping;
        expect((Math.hypot(dx, dy) * d) / (1 - d)).toBeCloseTo(TIMELAPSE.loneDriftDiameters * 2 * n.r, 6);
        lone++;
        continue;
      }
      expect(speed).toBeCloseTo(TIMELAPSE.birthSpeed, 6);
      // just past the radii of the neighbor it is born beside (the nearest present one is at most that far)
      const near = Math.min(...present.map((j) => Math.hypot(sim.nodes[j]!.x - n.x, sim.nodes[j]!.y - n.y) - sim.nodes[j]!.r - n.r));
      expect(near).toBeLessThanOrEqual(TIMELAPSE.birthGap + TIMELAPSE.birthJitter + 1e-6);
      // heading straight away from the neighbor it was born beside
      const away = present.some((j) => {
        const m = sim.nodes[j]!;
        const dx = n.x - m.x;
        const dy = n.y - m.y;
        return dx * n.vx + dy * n.vy > 0 && Math.abs(dx * n.vy - dy * n.vx) < 1e-6 * Math.hypot(dx, dy) * speed + 1e-9;
      });
      expect(away).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    expect(lone).toBeGreaterThan(0);
  });

  it("pops in (from 0.6 of its size, one small overshoot) and fades in as measured: half at once, then the tail", () => {
    const { run, timeline } = start(true);
    const first = timeline.order[0]!;
    const clock = { t: 1000 };
    play(run, TIMELAPSE.leadInMs + 1, 1000 / 60, clock);
    expect(run.count).toBe(1);
    run.setPlaying(false);
    const scales: number[] = [run.scale[first]!];
    const vis: number[] = [run.vis[first]!];
    for (let k = 0; k < 60; k++) {
      play(run, 1000 / 60, 1000 / 60, clock);
      scales.push(run.scale[first]!);
      vis.push(run.vis[first]!);
    }
    // alone on the map (no link shown), its size is its smallest: the pop is the scale over that
    const size = scales[scales.length - 1]!;
    expect(scales[0]! / size).toBeGreaterThan(0.6);
    expect(scales[0]! / size).toBeLessThan(0.85);
    expect(Math.max(...scales) / size).toBeGreaterThan(1.05);
    expect(Math.max(...scales) / size).toBeLessThan(1.09);
    // the pop is done by about 300 ms
    expect(scales[Math.ceil(TIMELAPSE.popMs / (1000 / 60))]).toBe(size);
    expect(vis[0]).toBeGreaterThanOrEqual(0.5);
    expect(vis[Math.round(230 / (1000 / 60))]).toBeGreaterThan(0.78);
    expect(vis[vis.length - 1]).toBe(1);
  });

  it("a node is drawn at its size for the links shown so far: smallest on arrival, growing as its links fade in", () => {
    const { sim, run, timeline } = start(true);
    // the best-linked node, and its size as its links come in
    const hub = sim.nodes.reduce((a, b) => (b.deg > a.deg ? b : a));
    run.seek(timeline.arrive[hub.index]!);
    run.setPlaying(false);
    const at0 = run.scale[hub.index]!;
    const clock = { t: 1000 };
    play(run, 300, 1000 / 60, clock);
    run.setPlaying(true);
    play(run, timeline.duration, 1000 / 60, clock);
    expect(run.done).toBe(true);
    play(run, 1500, 1000 / 60, clock);
    expect(run.scale[hub.index]).toBeCloseTo(1, 5);
    expect(at0).toBeLessThan(0.8);
  });

  it("a link starts linkDelayMs after both its ends are in, and its spring ramps in rather than snapping", () => {
    const { sim, run, timeline } = start(true);
    // a link whose later end arrives mid-run
    const e = sim.edges.findIndex((x) => Math.max(timeline.seq[x.s]!, timeline.seq[x.t]!) > 20);
    const edge = sim.edges[e]!;
    const later = timeline.seq[edge.s]! > timeline.seq[edge.t]! ? edge.s : edge.t;
    run.seek(timeline.arrive[later]! - 1);
    expect(run.linkVis[e]).toBe(0);
    expect(run.edgeScale[e]).toBe(0);
    run.seek(timeline.arrive[later]!);
    run.setPlaying(false);
    const clock = { t: 5000 };
    const vis: number[] = [];
    const spring: number[] = [];
    for (let ms = 0; ms < TIMELAPSE.linkDelayMs + TIMELAPSE.springRampMs + 100; ms += 1000 / 60) {
      play(run, 1000 / 60, 1000 / 60, clock);
      vis.push(run.linkVis[e]!);
      spring.push(run.edgeScale[e]!);
    }
    const startsAt = vis.findIndex((v) => v > 0) * (1000 / 60);
    expect(startsAt).toBeGreaterThanOrEqual(TIMELAPSE.linkDelayMs - 20);
    expect(startsAt).toBeLessThanOrEqual(TIMELAPSE.linkDelayMs + 40);
    // the spring: from nothing, through the middle, to full
    expect(spring[0]).toBe(0);
    expect(spring.some((v) => v > 0.2 && v < 0.8)).toBe(true);
    expect(spring[spring.length - 1]).toBe(1);
    for (let k = 1; k < spring.length; k++) expect(spring[k]!).toBeGreaterThanOrEqual(spring[k - 1]!);
  });

  it("after the last arrival the layout cools on its own: no snap to the saved layout", () => {
    const { sim, run, timeline, before } = start(true);
    const clock = { t: 1000 };
    play(run, timeline.duration + 50, 1000 / 60, clock);
    expect(run.done).toBe(true);
    expect(run.playing).toBe(false);
    expect(sim.alphaTarget).toBe(0);
    const at = sim.livePositions();
    play(run, 50, 1000 / 60, clock);
    // still moving, a little: easing toward rest, never a jump
    let most = 0;
    for (const n of sim.nodes) most = Math.max(most, Math.hypot(n.x - at[n.id]![0], n.y - at[n.id]![1]));
    expect(most).toBeLessThan(40);
    play(run, 12_000, 1000 / 60, clock);
    expect(sim.active).toBe(false);
    // its own layout, not the saved one
    const far = sim.nodes.filter((n) => Math.hypot(n.x - before[n.id]![0], n.y - before[n.id]![1]) > 5).length;
    expect(far).toBeGreaterThan(sim.nodes.length / 2);
  });

  it("pause freezes the arrivals but lets the physics settle; scrubbing back takes nodes off cleanly", () => {
    const { sim, run, timeline } = start(true);
    const clock = { t: 1000 };
    play(run, timeline.duration * 0.6, 1000 / 60, clock);
    run.setPlaying(false);
    const count = run.count;
    const at = sim.livePositions();
    play(run, 3000, 1000 / 60, clock);
    expect(run.count).toBe(count);
    expect(sim.nodes.some((n) => sim.isShown(n.index) && Math.hypot(n.x - at[n.id]![0], n.y - at[n.id]![1]) > 0.5)).toBe(true);
    play(run, 15_000, 1000 / 60, clock);
    expect(sim.active).toBe(false);
    // back to a third of the way
    run.seek(timeline.duration / 3);
    const k = run.count;
    expect(k).toBeLessThan(count);
    for (let q = 0; q < timeline.order.length; q++) {
      const i = timeline.order[q]!;
      expect(sim.isShown(i)).toBe(q < k);
      if (q >= k) {
        expect(run.vis[i]).toBe(0);
        expect(Number.isNaN(run.born[i]!)).toBe(true);
      }
    }
    for (let e = 0; e < sim.edges.length; e++) {
      const ed = sim.edges[e]!;
      if (!sim.isShown(ed.s) || !sim.isShown(ed.t)) {
        expect(run.linkVis[e]).toBe(0);
        expect(run.edgeScale[e]).toBe(0);
      }
    }
    // play from the end starts again from an empty map
    run.seek(timeline.duration);
    run.setPlaying(true);
    expect(run.count).toBe(0);
    expect(run.playing).toBe(true);
  });

  it("deterministic: the same project gives the same run, at any frame rate", () => {
    const a = start(true);
    const b = start(true);
    play(a.run, 9000, 1000 / 60);
    // the same time in frames of another rate: the fixed step makes it the same run
    play(b.run, 9000, 1000 / 120);
    expect(b.run.count).toBe(a.run.count);
    expect(b.run.ms).toBeCloseTo(a.run.ms, 6);
    for (let i = 0; i < a.sim.nodes.length; i++) {
      expect(b.sim.nodes[i]!.x).toBeCloseTo(a.sim.nodes[i]!.x, 6);
      expect(b.sim.nodes[i]!.y).toBeCloseTo(a.sim.nodes[i]!.y, 6);
    }
  });

  it("leaving gives the simulation its full springs back", () => {
    const { sim, run } = start(true);
    expect(sim.edgeScale).toBe(run.edgeScale);
    run.dispose();
    expect(sim.edgeScale).toBeNull();
  });
});
