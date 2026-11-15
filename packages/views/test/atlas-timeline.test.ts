/**
 * The Atlas time-lapse's data (atlas/timeline.ts): each node's time from the
 * creation times the index records, borrowed from a neighbor when a node has
 * none; the strict arrival order (ties broken owners first, then by kind,
 * folder and path); the pacing by sequence with gaps compressed; the run's
 * length; the date shown; and the arrival curves (the pop, the measured
 * entry fade, a link's delay and fade, its spring's ramp).
 */
import { readFileSync } from "node:fs";
import type { AtlasEdge, AtlasGraph, AtlasNode } from "@protoboardai/core/atlas";
import { describe, expect, it } from "vitest";
import { TIMELAPSE, arrivedAt, arrivedBy, buildTimeline, dateAt, entryOpacity, fadeIn, formatDay, gapSteps, linkAlpha, linkTime, playbackLength, popScale, springRamp } from "../src/atlas/timeline.js";

const GRAPH: AtlasGraph = JSON.parse(readFileSync(new URL("./fixtures/atlas-graph.json", import.meta.url), "utf8"));
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 3);

const node = (id: string, created?: AtlasNode["created"], more: Partial<AtlasNode> = {}): AtlasNode => ({ id, kind: "doc", label: id, folder: "", status: "ok", degree: 0, ...(created ? { created } : {}), ...more });
const git = (at: number) => ({ at, from: "git" as const });

/** One module at T0, then a batch of `parts` parts with `files` files each, all from one commit two weeks later (the round-4 report's 184-node batch: 23 x 8). */
function batchGraph(parts = 23, files = 7, shuffle = false) {
  const nodes: AtlasNode[] = [node("def:drone", git(T0), { kind: "module", definition: { id: "drone", root: true } as AtlasNode["definition"] })];
  const edges: AtlasEdge[] = [];
  const at = T0 + 14 * DAY;
  for (let p = 0; p < parts; p++) {
    const pid = `def:part-${String(p).padStart(2, "0")}`;
    nodes.push(node(pid, git(at), { kind: "part", folder: "parts/catalog", path: `parts/catalog/part-${String(p).padStart(2, "0")}.json` }));
    edges.push({ from: "def:drone", to: pid, type: "uses" });
    for (let f = 0; f < files; f++) {
      const fid = `file:parts/catalog/part-${String(p).padStart(2, "0")}/f${f}.step`;
      nodes.push(node(fid, git(at), { kind: "cad", folder: `parts/catalog/part-${String(p).padStart(2, "0")}`, path: fid.slice(5) }));
      edges.push({ from: pid, to: fid, type: "has" });
    }
  }
  if (shuffle) {
    // a deterministic shuffle: the order the index lists nodes in must not matter
    nodes.sort((a, b) => ((a.id.length * 7919 + a.id.charCodeAt(a.id.length - 1)) % 13) - ((b.id.length * 7919 + b.id.charCodeAt(b.id.length - 1)) % 13) || (a.id < b.id ? 1 : -1));
    edges.reverse();
  }
  return { nodes, edges };
}

describe("the time-lapse's timeline", () => {
  it("takes each node's own time, and records where it came from", () => {
    const g = {
      nodes: [node("file:a.md", { at: T0, from: "git" }), node("file:b.md", { at: T0 + 3 * DAY, from: "birthtime" }), node("file:c.md", { at: T0 + 9 * DAY, from: "mtime" })],
      edges: [],
    };
    const t = buildTimeline(g);
    expect([...t.times]).toEqual([T0, T0 + 3 * DAY, T0 + 9 * DAY]);
    expect(t.start).toBe(T0);
    expect(t.end).toBe(T0 + 9 * DAY);
    expect(t.sources).toEqual({ git: 1, birthtime: 1, mtime: 1, borrowed: 0, none: 0 });
    expect(t.usable).toBe(true);
    expect([...t.order]).toEqual([0, 1, 2]);
  });

  it("a node without a time comes in with its earliest neighbor (a URL artifact with its part), one with no neighbor at the start", () => {
    const g = {
      nodes: [node("def:frame", { at: T0 + 5 * DAY, from: "git" }), node("file:x.step", { at: T0 + 2 * DAY, from: "git" }), node("url:frame#doc"), node("url:lonely#doc"), node("file:far.md", { at: T0, from: "git" })],
      edges: [
        { from: "def:frame", to: "url:frame#doc", type: "has" as const },
        { from: "url:frame#doc", to: "file:x.step", type: "has" as const },
      ],
    };
    const t = buildTimeline(g);
    expect(t.times[2]).toBe(T0 + 2 * DAY);
    expect(t.times[3]).toBe(T0);
    expect(t.sources.borrowed).toBe(1);
    expect(t.sources.none).toBe(1);
    // every node, dated or not, has a place in the run
    expect(arrivedBy(t, t.duration)).toBe(5);
  });

  it("an index without creation times is not usable (the Animate control says to build)", () => {
    const t = buildTimeline(GRAPH);
    expect(GRAPH.nodes.some((n) => n.created)).toBe(false);
    expect(t.usable).toBe(false);
  });

  it("a 184-node batch from one commit arrives one by one, spread out, each part followed by its own files", () => {
    const g = batchGraph();
    const t = buildTimeline(g);
    const ids = [...t.order].map((i) => g.nodes[i]!.id);
    expect(ids.length).toBe(185);
    expect(ids[0]).toBe("def:drone");
    // a strict sequence: every node its own position and its own moment
    for (let q = 1; q < t.order.length; q++) expect(t.arrive[t.order[q]!]!).toBeGreaterThan(t.arrive[t.order[q - 1]!]!);
    expect(new Set(t.arrive).size).toBe(185);
    // owners first, each followed by its own files (by path), parts by path
    for (let p = 0; p < 23; p++) {
      const pid = `def:part-${String(p).padStart(2, "0")}`;
      const at = ids.indexOf(pid);
      expect(at).toBe(1 + p * 8);
      for (let f = 0; f < 7; f++) expect(ids[at + 1 + f]).toBe(`file:parts/catalog/part-${String(p).padStart(2, "0")}/f${f}.step`);
    }
    // spread out: the batch takes most of the run, at an even, watchable rate
    const first = t.arrive[t.order[1]!]!;
    const last = t.arrive[t.order[184]!]!;
    expect((last - first) / t.duration).toBeGreaterThan(0.7);
    const steps = [];
    for (let q = 2; q <= 184; q++) steps.push(t.arrive[t.order[q]!]! - t.arrive[t.order[q - 1]!]!);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-6);
    const perSecond = 1000 / steps[0]!;
    expect(perSecond).toBeGreaterThan(5);
    expect(perSecond).toBeLessThan(25);
  });

  it("the order is deterministic: the same project in any listing order gives the same sequence", () => {
    const a = batchGraph();
    const b = batchGraph(23, 7, true);
    expect(b.nodes.map((n) => n.id)).not.toEqual(a.nodes.map((n) => n.id));
    const ta = buildTimeline(a);
    const tb = buildTimeline(b);
    expect([...tb.order].map((i) => b.nodes[i]!.id)).toEqual([...ta.order].map((i) => a.nodes[i]!.id));
    expect([...tb.order].map((i) => tb.arrive[i])).toEqual([...ta.order].map((i) => ta.arrive[i]));
  });

  it("within a batch: the root, modules, parts, then files; a CAD source before the model made from it; then folder and path", () => {
    const at = git(T0);
    const g = {
      nodes: [
        node("file:z/model.glb", at, { kind: "model", folder: "z", path: "z/model.glb" }),
        node("file:a/source.step", at, { kind: "cad", folder: "a", path: "a/source.step" }),
        node("file:b/notes.md", at, { kind: "doc", folder: "b", path: "b/notes.md" }),
        node("def:part", at, { kind: "part", folder: "parts", path: "parts/part.json" }),
        node("def:sub", at, { kind: "module", folder: "src", path: "src/sub.uhd.ts" }),
        node("def:root", at, { kind: "module", folder: "src", path: "src/root.uhd.ts", definition: { id: "root", root: true } as AtlasNode["definition"] }),
      ],
      edges: [{ from: "file:z/model.glb", to: "file:a/source.step", type: "made-from" as const }],
    };
    const t = buildTimeline(g);
    expect([...t.order].map((i) => g.nodes[i]!.id)).toEqual(["def:root", "def:sub", "def:part", "file:a/source.step", "file:z/model.glb", "file:b/notes.md"]);
  });

  it("long empty gaps are compressed: a year without files is a short pause, not most of the run", () => {
    expect(gapSteps(0)).toBe(0);
    expect(gapSteps(-5)).toBe(0);
    expect(gapSteps(DAY)).toBeCloseTo(TIMELAPSE.gapStepsPerLog * Math.log(2), 9);
    expect(gapSteps(365 * DAY)).toBe(TIMELAPSE.gapMaxSteps);
    expect(gapSteps(14 * DAY)).toBeLessThan(gapSteps(28 * DAY));
    // 60 files on day 0, 60 a year later: the pause between is the cap, a small share of the run
    const nodes = [...Array.from({ length: 60 }, (_, i) => node(`file:a${String(i).padStart(2, "0")}`, git(T0))), ...Array.from({ length: 60 }, (_, i) => node(`file:b${String(i).padStart(2, "0")}`, git(T0 + 365 * DAY)))];
    const t = buildTimeline({ nodes, edges: [] });
    const pause = t.arrive[60]! - t.arrive[59]!;
    const step = t.arrive[1]! - t.arrive[0]!;
    expect(pause / step).toBeCloseTo(1 + TIMELAPSE.gapMaxSteps, 6);
    expect(pause / t.duration).toBeLessThan(0.15);
  });

  it("the run's length scales gently with the node count", () => {
    expect(playbackLength(411)).toBeGreaterThan(10_000);
    expect(playbackLength(411)).toBeLessThan(25_000);
    expect(playbackLength(200)).toBeGreaterThan(10_000);
    expect(playbackLength(3)).toBe(TIMELAPSE.minMs);
    expect(playbackLength(100_000)).toBe(TIMELAPSE.maxMs);
    const t = buildTimeline(batchGraph());
    expect(t.duration).toBeCloseTo(playbackLength(185), 6);
    expect(t.arrive[t.order[0]!]).toBe(TIMELAPSE.leadInMs);
  });

  it("every node is on the map by the end, none before its arrival, and the date passes through the gaps", () => {
    // the index's shape: dated batches and undated URL artifacts that borrow their part's time
    const g = { nodes: GRAPH.nodes.map((n, i) => ({ ...n, created: i % 9 === 4 ? undefined : git(T0 + (i % 5) * 7 * DAY) })), edges: GRAPH.edges };
    const t = buildTimeline(g);
    const out = new Uint8Array(g.nodes.length);
    expect(arrivedAt(t, 0, out)).toBe(0);
    expect(arrivedAt(t, t.duration, out)).toBe(g.nodes.length);
    expect([...out].every((v) => v === 1)).toBe(true);
    let prev = -1;
    for (let ms = 0; ms <= t.duration; ms += t.duration / 50) {
      const k = arrivedBy(t, ms);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
    expect(dateAt(t, 0)).toBe(t.start);
    expect(dateAt(t, t.duration)).toBe(t.end);
    // the date never runs backward
    let d = -Infinity;
    for (let ms = 0; ms <= t.duration; ms += 25) {
      const x = dateAt(t, ms);
      expect(x).toBeGreaterThanOrEqual(d);
      d = x;
    }
  });

  it("a link's time is the later of its ends'", () => {
    const g = { nodes: [node("a", git(T0)), node("b", git(T0 + DAY)), node("c", git(T0 + 2 * DAY))], edges: [] };
    const t = buildTimeline(g);
    expect(linkTime(t, 0, 2)).toBe(T0 + 2 * DAY);
    expect(linkTime(t, 1, 0)).toBe(T0 + DAY);
  });

  it("dates read the same on every machine (UTC)", () => {
    expect(formatDay(Date.UTC(2026, 10, 3, 23, 59))).toBe("Nov 3, 2026");
  });
});

describe("an arrival's curves (the measured parameters)", () => {
  it("the pop: from popFrom of full size, one overshoot of about 8 %, landing on exactly 1 at popMs (about 300 ms)", () => {
    expect(TIMELAPSE.popFrom).toBe(0.6);
    expect(popScale(0)).toBeCloseTo(TIMELAPSE.popFrom, 9);
    expect(popScale(-10)).toBe(0);
    expect(popScale(TIMELAPSE.popMs)).toBe(1);
    expect(popScale(TIMELAPSE.popMs * 3)).toBe(1);
    let peak = 0;
    let peakAt = 0;
    let turns = 0;
    let prev = popScale(0);
    let rising = true;
    for (let ms = 1; ms <= TIMELAPSE.popMs; ms += 1) {
      const v = popScale(ms);
      if (v > peak) {
        peak = v;
        peakAt = ms;
      }
      if (rising && v < prev) {
        rising = false;
        turns++;
      } else if (!rising && v > prev) {
        rising = true;
        turns++;
      }
      prev = v;
    }
    // one overshoot (one turn, no second bounce), about 8 % past full size, a little after half way
    expect(turns).toBe(1);
    expect(peak).toBeGreaterThan(1.07);
    expect(peak).toBeLessThan(1.09);
    expect(peakAt / TIMELAPSE.popMs).toBeGreaterThan(0.45);
    expect(peakAt / TIMELAPSE.popMs).toBeLessThan(0.65);
  });

  it("the entry fade: half at once, 80 % at about 230 ms, 95 % at about 570 ms, full by 750 ms", () => {
    expect(entryOpacity(-1)).toBe(0);
    expect(entryOpacity(0)).toBeCloseTo(0.5, 9);
    expect(entryOpacity(230)).toBeCloseTo(0.816, 2);
    expect(entryOpacity(570)).toBeGreaterThan(0.95);
    expect(entryOpacity(570)).toBeLessThan(0.97);
    expect(entryOpacity(TIMELAPSE.fadeFullMs)).toBe(1);
    // when not live: a plain short ease-out
    expect(fadeIn(0)).toBe(0);
    expect(fadeIn(TIMELAPSE.revealFadeMs)).toBe(1);
    expect(fadeIn(TIMELAPSE.revealFadeMs / 2)).toBeCloseTo(0.75, 6);
  });

  it("a link waits linkDelayMs after both its ends are in, then fades in at full length over linkFadeMs while its spring ramps in", () => {
    expect(TIMELAPSE.linkDelayMs).toBe(150);
    expect(TIMELAPSE.linkFadeMs).toBe(500);
    expect(linkAlpha(0)).toBe(0);
    expect(linkAlpha(TIMELAPSE.linkDelayMs)).toBe(0);
    expect(linkAlpha(TIMELAPSE.linkDelayMs + TIMELAPSE.linkFadeMs / 2)).toBeCloseTo(0.5, 6);
    expect(linkAlpha(TIMELAPSE.linkDelayMs + TIMELAPSE.linkFadeMs)).toBe(1);
    expect(springRamp(TIMELAPSE.linkDelayMs)).toBe(0);
    expect(springRamp(TIMELAPSE.linkDelayMs + TIMELAPSE.springRampMs / 2)).toBeCloseTo(0.5, 6);
    expect(springRamp(TIMELAPSE.linkDelayMs + TIMELAPSE.springRampMs)).toBe(1);
  });
});
