/**
 * The Atlas simulation (atlas/sim.ts): a port of the force-directed layout,
 * checked on a quadcopter-like fixture graph for what a person sees: no
 * overlaps, files beside their module, loose files at the edge, groups when
 * pulling by kind or folder, the same picture every time, and saved
 * positions kept.
 */
import { readFileSync } from "node:fs";
import type { AtlasGraph } from "@protoboardai/core/atlas";
import { describe, expect, it } from "vitest";
import { AtlasSimulation, BASE_RADIUS, DEGREE_SCALE, SIM, degreeScale, graphShape, manyBody, nodeRadius, seedPosition, type SimNode } from "../src/atlas/sim.js";

const GRAPH: AtlasGraph = JSON.parse(readFileSync(new URL("./fixtures/atlas-graph.json", import.meta.url), "utf8"));

const settled = (pullBy: "links" | "kind" | "folder" = "links", saved?: Record<string, [number, number]>) => {
  const sim = new AtlasSimulation(GRAPH, { pullBy, saved });
  sim.settle();
  return sim;
};

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const centroid = (ns: readonly { x: number; y: number }[]) => ({ x: ns.reduce((s, n) => s + n.x, 0) / ns.length, y: ns.reduce((s, n) => s + n.y, 0) / ns.length });
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** The share of nodes whose nearest group centroid is their own group's. */
function nearestOwnCentroid(sim: AtlasSimulation): number {
  const groups = sim.groups().filter((g) => g.members.length > 1);
  const centers = groups.map((g) => centroid(g.members.map((i) => sim.nodes[i]!)));
  let own = 0;
  let total = 0;
  groups.forEach((g, k) => {
    for (const i of g.members) {
      const n = sim.nodes[i]!;
      let best = -1;
      let bd = Infinity;
      centers.forEach((c, j) => {
        const d = dist(n, c);
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      total++;
      if (best === k) own++;
    }
  });
  return own / total;
}

describe("Atlas simulation: the settled layout of the fixture", () => {
  it("has finite positions and no two nodes overlapping", () => {
    const sim = settled();
    for (const n of sim.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
    let worst = Infinity;
    for (let i = 0; i < sim.nodes.length; i++)
      for (let j = i + 1; j < sim.nodes.length; j++) {
        const a = sim.nodes[i]!;
        const b = sim.nodes[j]!;
        worst = Math.min(worst, dist(a, b) - (a.r + b.r));
      }
    // the discs never touch: at least a unit of clear space between any two
    expect(worst).toBeGreaterThan(1);
  });

  it("Links: most files end up nearest their own module", () => {
    const sim = settled("links");
    const modules = sim.nodes.filter((n) => n.kind === "module");
    let own = 0;
    let owned = 0;
    for (const [i, n] of GRAPH.nodes.entries()) {
      const owners = n.file?.owners ?? [];
      if (owners.length !== 1) continue;
      owned++;
      const p = sim.nodes[i]!;
      const nearest = modules.reduce((best, m) => (dist(p, m) < dist(p, best) ? m : best));
      if (nearest.id === `def:${owners[0]}`) own++;
    }
    expect(owned).toBeGreaterThan(60);
    expect(own / owned).toBeGreaterThanOrEqual(0.75);
  });

  it("nodes with no links end up farther from the center than linked ones", () => {
    const spread = (mode: "links" | "kind" | "folder") => {
      const sim = settled(mode);
      const c = centroid(sim.nodes);
      const loose = sim.nodes.filter((n) => !n.linked).map((n) => dist(n, c));
      const linked = sim.nodes
        .filter((n) => n.linked)
        .map((n) => dist(n, c))
        .sort((a, b) => a - b);
      expect(loose.length).toBe(GRAPH.counts.census.unlinked);
      return { loose, linked };
    };
    // by links: the loose files ring the map, every one farther out than three quarters of the linked nodes
    const links = spread("links");
    expect(mean(links.loose)).toBeGreaterThan(mean(links.linked) * 1.5);
    expect(Math.min(...links.loose)).toBeGreaterThan(links.linked[Math.floor(links.linked.length * 0.75)]!);
    // pulled by kind or folder, a loose file also joins its group, yet still sits farther out on average
    for (const mode of ["kind", "folder"] as const) {
      const s = spread(mode);
      expect(mean(s.loose)).toBeGreaterThan(mean(s.linked));
    }
  });

  it("Kind and Folder: nodes end up nearest their own group's centroid", () => {
    const kind = settled("kind");
    const folder = settled("folder");
    const links = settled("links");
    expect(nearestOwnCentroid(kind)).toBeGreaterThanOrEqual(0.9);
    expect(nearestOwnCentroid(folder)).toBeGreaterThanOrEqual(0.9);
    // the extra pull is what groups them: by links alone, kinds are mixed
    const linksByKind = new AtlasSimulation(GRAPH, { pullBy: "links" });
    linksByKind.settle();
    linksByKind.setPullBy("kind");
    // regrouped without a tick: the positions are the Links layout's
    expect(nearestOwnCentroid(linksByKind)).toBeLessThan(nearestOwnCentroid(kind));
    // and members of a kind are closer together than in Links mode
    const spread = (sim: AtlasSimulation) => mean(new AtlasSimulation(GRAPH, { pullBy: "kind" }).groups().map((g) => mean(g.members.map((i) => dist(sim.nodes[i]!, centroid(g.members.map((j) => sim.nodes[j]!)))))));
    expect(spread(kind)).toBeLessThan(spread(links));
  });

  it("is deterministic: the same graph gives identical positions", () => {
    for (const mode of ["links", "kind"] as const) {
      const a = settled(mode).livePositions();
      const b = settled(mode).livePositions();
      expect(b).toEqual(a);
    }
  });

  it("honors saved positions: nothing moves more than 2 units, and a new node joins its neighbors without the others jumping", () => {
    const first = settled("links");
    const saved = first.positions();
    const again = new AtlasSimulation(GRAPH, { saved });
    expect(again.placed).toBe(GRAPH.nodes.length);
    expect(again.start).toBe("kept");
    expect(again.alpha).toBe(SIM.warmAlpha);
    for (const n of again.nodes) expect([n.x, n.y]).toEqual(saved[n.id]);
    again.settle();
    for (const n of again.nodes) expect(dist(n, { x: saved[n.id]![0], y: saved[n.id]![1] })).toBeLessThanOrEqual(2);
    // reopening is no reason to save
    expect(again.changedSince(saved)).toBe(false);

    // one more render of the frame, made from its model
    const grown: AtlasGraph = {
      ...GRAPH,
      nodes: [...GRAPH.nodes, { id: "file:docs/renders/frame-9.png", kind: "render", label: "frame-9.png", path: "docs/renders/frame-9.png", folder: "docs/renders", status: "ok", degree: 2, file: { ext: "png", size: 10, kindFrom: "path", artifacts: [], owners: ["frame"] } }],
      edges: [...GRAPH.edges, { from: "def:frame", to: "file:docs/renders/frame-9.png", type: "has" }, { from: "file:docs/renders/frame-9.png", to: "file:models/frame.glb", type: "made-from" }],
    };
    const added = new AtlasSimulation(grown, { saved });
    expect(added.placed).toBe(GRAPH.nodes.length);
    expect(added.start).toBe("joined");
    expect(added.alpha).toBe(SIM.warmAlphaWithNew);
    const fresh = added.nodes[added.indexOf("file:docs/renders/frame-9.png")!]!;
    const near = [saved["def:frame"]!, saved["file:models/frame.glb"]!];
    const mid = { x: (near[0]![0] + near[1]![0]) / 2, y: (near[0]![1] + near[1]![1]) / 2 };
    expect(dist(fresh, mid)).toBeLessThanOrEqual(30);
    expect(added.isHeld(added.indexOf("def:frame")!)).toBe(true);
    expect(added.isHeld(fresh.index)).toBe(false);
    added.settle();
    // the rest stays exactly where it was; the new render settles beside the frame, clear of everything
    for (const n of added.nodes) if (n !== fresh) expect([n.x, n.y]).toEqual(saved[n.id]);
    const frame = added.nodes[added.indexOf("def:frame")!]!;
    expect(dist(fresh, frame)).toBeLessThan(80);
    for (const n of added.nodes) if (n !== fresh) expect(dist(fresh, n)).toBeGreaterThan(fresh.r + n.r);
    // cooled: nothing is held any more, and a save is due (a node has no saved position)
    expect(added.isHeld(frame.index)).toBe(false);
    expect(added.changedSince(saved)).toBe(true);
  });

  it("a graph where most nodes are new starts fresh, from its saved positions", () => {
    const first = settled("links");
    const some = Object.fromEntries(Object.entries(first.positions()).slice(0, 10));
    const sim = new AtlasSimulation(GRAPH, { saved: some });
    expect(sim.start).toBe("fresh");
    expect(sim.alpha).toBe(1);
    const [id, at] = Object.entries(some)[0]!;
    expect([sim.nodes[sim.indexOf(id)!]!.x, sim.nodes[sim.indexOf(id)!]!.y]).toEqual(at);
  });
});

describe("Atlas simulation: the mechanics", () => {
  it("from alpha 1, alpha falls below 0.001 in 300 ±2 ticks", () => {
    const sim = new AtlasSimulation(GRAPH);
    expect(sim.alpha).toBe(1);
    const ticks = sim.settle();
    expect(Math.abs(ticks - 300)).toBeLessThanOrEqual(2);
    expect(sim.alpha).toBeLessThan(SIM.alphaMin);
    expect(sim.active).toBe(false);
  });

  it("a pinned node does not move, and moves again once released", () => {
    const sim = new AtlasSimulation(GRAPH);
    sim.pin("def:frame", 40, -25);
    for (let i = 0; i < 50; i++) sim.tick();
    const frame = sim.nodes[sim.indexOf("def:frame")!]!;
    expect([frame.x, frame.y]).toEqual([40, -25]);
    sim.release("def:frame");
    sim.reheat(0.5);
    sim.tick();
    expect([frame.x, frame.y]).not.toEqual([40, -25]);
  });

  it("velocity is multiplied by 0.6 each tick when no force acts", () => {
    const sim = new AtlasSimulation({ ...GRAPH, nodes: [GRAPH.nodes[0]!], edges: [] });
    const n = sim.nodes[0]!;
    n.x = 0;
    n.y = 0;
    n.vx = 10;
    n.vy = -5;
    sim.tick();
    expect(n.vx).toBeCloseTo(6, 12);
    expect(n.vy).toBeCloseTo(-3, 12);
    expect(n.x).toBeCloseTo(6, 12);
  });

  it("alpha eases toward a raised target while a node is dragged, and a shake reheats", () => {
    const sim = new AtlasSimulation(GRAPH);
    sim.settle();
    sim.alphaTarget = SIM.dragAlphaTarget;
    expect(sim.active).toBe(true);
    for (let i = 0; i < 400; i++) sim.tick();
    expect(sim.alpha).toBeCloseTo(SIM.dragAlphaTarget, 2);
    sim.alphaTarget = 0;
    sim.settle();
    sim.reheat();
    expect(sim.alpha).toBe(SIM.reheat);
    sim.settle();
    sim.setPullBy("folder");
    // a change of grouping warms the layout gently; it does not restart it
    expect(sim.alpha).toBe(SIM.modeReheat);
    expect(sim.pullBy).toBe("folder");
  });

  // Per node, the error is measured against the typical force (the mean magnitude): a node near the middle
  // feels pushes from every side that nearly cancel, so its own net force is close to zero and a relative
  // error against it says nothing (at theta 0.9 the worst such node is off by about 30 % of almost nothing).
  it("Barnes-Hut and the exact repulsion agree within 5 % per node on 600 random bodies", () => {
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296), s / 4294967296);
    const bodies = Array.from({ length: 600 }, () => {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 400;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8 };
    });
    const exact = manyBody(bodies, 1, 0);
    const approx = manyBody(bodies, 1, SIM.theta);
    const errors: number[] = [];
    const magnitudes: number[] = [];
    for (let i = 0; i < bodies.length; i++) {
      const ex = exact[i * 2]!;
      const ey = exact[i * 2 + 1]!;
      errors.push(Math.hypot(approx[i * 2]! - ex, approx[i * 2 + 1]! - ey));
      magnitudes.push(Math.hypot(ex, ey));
    }
    const typical = mean(magnitudes);
    // every node within 5 % of the typical force
    expect(Math.max(...errors) / typical).toBeLessThan(0.05);
    // and 95 % of nodes within 5 % of their own force
    const own = errors.map((e, i) => e / magnitudes[i]!).sort((a, b) => a - b);
    expect(own[Math.floor(own.length * 0.95)]!).toBeLessThan(0.05);
    // the approximation does approximate: it differs from the exact sum
    expect(Math.max(...errors)).toBeGreaterThan(0);
  });

  it("the large-graph path (Barnes-Hut) settles a 700-node graph without overlaps", () => {
    const nodes = Array.from({ length: 700 }, (_, i) => ({ id: `file:f/${i}.png`, kind: "image" as const, label: `${i}.png`, path: `f/${i}.png`, folder: "f", status: "ok" as const, degree: 0 }));
    const edges = nodes.slice(1, 300).map((n, i) => ({ from: nodes[Math.floor(i / 6)]!.id, to: n.id, type: "has" as const }));
    const sim = new AtlasSimulation({ ...GRAPH, nodes, edges });
    sim.settle();
    let worst = Infinity;
    for (let i = 0; i < sim.nodes.length; i++)
      for (let j = i + 1; j < sim.nodes.length; j++) worst = Math.min(worst, dist(sim.nodes[i]!, sim.nodes[j]!) - sim.nodes[i]!.r - sim.nodes[j]!.r);
    expect(sim.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(worst).toBeGreaterThan(0);
  });

  it("size and mass grow with the link count: a square root, clamped; the root is never smaller than 12", () => {
    expect(degreeScale(0)).toBe(1);
    expect(degreeScale(4)).toBeCloseTo(1 + DEGREE_SCALE.k * 2);
    expect(degreeScale(1e6)).toBe(DEGREE_SCALE.max);
    // monotonic, with diminishing steps (sqrt)
    const steps = [0, 1, 2, 3, 4].map(degreeScale);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
    // each further link adds less (a square root)
    expect(steps[1]! - steps[0]!).toBeGreaterThan(steps[4]! - steps[3]!);
    expect(nodeRadius({ kind: "module", root: false, deg: 0 })).toBe(BASE_RADIUS.module);
    expect(nodeRadius({ kind: "part", root: false, deg: 0 })).toBe(BASE_RADIUS.part);
    expect(nodeRadius({ kind: "render", root: false, deg: 0 })).toBe(BASE_RADIUS.file);
    expect(nodeRadius({ kind: "render", root: false, deg: 9 })).toBeCloseTo(BASE_RADIUS.file * (1 + DEGREE_SCALE.k * 3));
    expect(nodeRadius({ kind: "module", root: false, deg: 1e6 })).toBeCloseTo(BASE_RADIUS.module * DEGREE_SCALE.max);
    expect(nodeRadius({ kind: "module", root: true, deg: 0 })).toBe(12);
    const sim = new AtlasSimulation(GRAPH);
    const root = sim.nodes.find((n) => n.root)!;
    expect(root.id).toBe("def:quadcopter-5in");
    expect(root.r).toBeGreaterThanOrEqual(12);
    // the mass follows the same scale
    for (const n of sim.nodes) expect(n.m).toBe(degreeScale(n.deg));
  });

  it("a heavier body pushes harder: the repulsion it gives scales with its mass", () => {
    const light = manyBody([{ x: 0, y: 0 }, { x: 40, y: 0, m: 1 }], 1, 0);
    const heavy = manyBody([{ x: 0, y: 0 }, { x: 40, y: 0, m: 2 }], 1, 0);
    expect(Math.abs(heavy[0]!)).toBeCloseTo(Math.abs(light[0]!) * 2, 9);
    // and the push it feels does not change
    expect(Math.abs(heavy[2]!)).toBeCloseTo(Math.abs(light[2]!), 9);
  });

  it("drag and release: no teleport, ever; the released node eases back and the layout comes to rest", () => {
    const sim = new AtlasSimulation(GRAPH);
    sim.settle();
    const id = "def:frame";
    const i = sim.indexOf(id)!;
    const n = sim.nodes[i]!;
    sim.alphaTarget = SIM.dragAlphaTarget;
    sim.reheat(SIM.dragAlphaTarget);
    // a drag of 200 units, in small steps
    const [x0, y0] = [n.x, n.y];
    for (let k = 1; k <= 40; k++) {
      sim.pin(id, x0 + k * 5, y0 - k * 2);
      sim.tick();
    }
    const at = [n.x, n.y];
    sim.release(id);
    sim.alphaTarget = 0;
    let prev = sim.nodes.map((m) => [m.x, m.y] as const);
    let worst = 0;
    let first = 0;
    for (let t = 0; t < 600 && sim.active; t++) {
      sim.tick();
      for (const m of sim.nodes) {
        const d = Math.hypot(m.x - prev[m.index]![0], m.y - prev[m.index]![1]);
        worst = Math.max(worst, d);
        if (t === 0 && m.index === i) first = d;
      }
      prev = sim.nodes.map((m) => [m.x, m.y] as const);
    }
    // the first tick after the release moves the node a little from where it was let go, never back to its old place
    expect(first).toBeLessThan(6);
    expect(Math.hypot(at[0]! - x0, at[1]! - y0)).toBeGreaterThan(150);
    // no node ever moves more than a few units a tick
    expect(worst).toBeLessThan(12);
    expect(sim.active).toBe(false);
  });

  it("one simulation for every grouping: a switch keeps every position and velocity, blends the forces over about a second, and nothing jumps", () => {
    const sim = new AtlasSimulation(GRAPH, { pullBy: "links" });
    sim.settle();
    sim.reheat(0.2);
    sim.tick();
    const before = sim.nodes.map((n) => ({ x: n.x, y: n.y, vx: n.vx, vy: n.vy }));
    sim.setPullBy("kind");
    // the switch itself moves nothing and keeps the velocities
    sim.nodes.forEach((n, i) => expect({ x: n.x, y: n.y, vx: n.vx, vy: n.vy }).toEqual(before[i]));
    expect(sim.groupedness).toBe(0);
    expect(sim.blending).toBe(true);
    let prev = sim.nodes.map((n) => [n.x, n.y] as const);
    let worst = 0;
    for (let t = 0; t < SIM.blendTicks; t++) {
      sim.tick();
      for (const n of sim.nodes) worst = Math.max(worst, Math.hypot(n.x - prev[n.index]![0], n.y - prev[n.index]![1]));
      prev = sim.nodes.map((n) => [n.x, n.y] as const);
      if (t === Math.floor(SIM.blendTicks / 2)) expect(sim.groupedness).toBeGreaterThan(0.3);
    }
    expect(sim.groupedness).toBe(1);
    expect(sim.blending).toBe(false);
    // the nodes drift (damped velocities): never more than a few units a tick
    expect(worst).toBeLessThan(16);
    sim.settle();
    // the groups formed from where the nodes were
    expect(nearestOwnCentroid(sim)).toBeGreaterThanOrEqual(0.85);
    // a change back blends the same way
    sim.setPullBy("folder");
    sim.setPullBy("links");
    expect(sim.pullBy).toBe("links");
    sim.settle();
    expect(sim.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it("the intro: nodes start gathered at the center and land exactly on their saved positions, without a jump", () => {
    const saved = settled("links").positions();
    const sim = new AtlasSimulation(GRAPH, { saved });
    expect(sim.start).toBe("kept");
    sim.startIntro();
    const spread = Math.max(...sim.nodes.map((n) => Math.hypot(n.x, n.y)));
    const final = Math.max(...Object.values(saved).map(([x, y]) => Math.hypot(x, y)));
    expect(spread).toBeLessThan(final * 0.2);
    expect(sim.active).toBe(true);
    let prev = sim.nodes.map((n) => [n.x, n.y] as const);
    let worst = 0;
    let ticks = 0;
    while (sim.active && ticks < 1000) {
      sim.tick();
      ticks++;
      for (const n of sim.nodes) worst = Math.max(worst, Math.hypot(n.x - prev[n.index]![0], n.y - prev[n.index]![1]));
      prev = sim.nodes.map((n) => [n.x, n.y] as const);
    }
    expect(ticks).toBe(SIM.introTicks);
    for (const n of sim.nodes) expect([n.x, n.y]).toEqual(saved[n.id]);
    // no save is due, and it rests
    expect(sim.changedSince(saved)).toBe(false);
    expect(sim.alpha).toBe(0);
    expect(worst).toBeLessThan(20);
    // a fresh layout opens from the center and settles freely
    const fresh = new AtlasSimulation(GRAPH);
    fresh.startIntro();
    expect(Math.max(...fresh.nodes.map((n) => Math.hypot(n.x, n.y)))).toBeLessThan(30);
    fresh.settle();
    expect(Math.max(...fresh.nodes.map((n) => Math.hypot(n.x, n.y)))).toBeGreaterThan(100);
  });

  it("a time-lapse shows nodes as they appear, beside what they connect to; the rest neither moves nor pushes", () => {
    const sim = new AtlasSimulation(GRAPH);
    sim.settle();
    const snapshot = sim.livePositions();
    const mask = new Uint8Array(sim.nodes.length);
    const frame = sim.indexOf("def:frame")!;
    mask[frame] = 1;
    sim.setShown(mask);
    expect(sim.isShown(frame)).toBe(true);
    const hidden = sim.nodes.find((n) => !mask[n.index])!;
    const keep = [hidden.x, hidden.y];
    for (let t = 0; t < 30; t++) sim.tick();
    expect([hidden.x, hidden.y]).toEqual(keep);
    // a neighbor appears beside it
    const glb = sim.indexOf("file:models/frame.glb")!;
    mask[glb] = 1;
    sim.setShown(mask);
    const f = sim.nodes[frame]!;
    const g = sim.nodes[glb]!;
    expect(Math.hypot(f.x - g.x, f.y - g.y)).toBeLessThanOrEqual(20);
    expect(sim.alpha).toBeGreaterThanOrEqual(SIM.appearAlpha);
    // a time-lapse leaves the layout far from where it was (here: every node 300 units off)
    for (const n of sim.nodes) {
      n.x += 300;
      n.y -= 200;
    }
    // leaving: everything shown again, gliding back to where it was, exactly, and never more than a few units a tick
    sim.setShown(null);
    sim.glideTo(snapshot);
    let prev = sim.nodes.map((n) => [n.x, n.y] as const);
    let worst = 0;
    let ticks = 0;
    while (sim.active && ticks < 1000) {
      sim.tick();
      ticks++;
      for (const n of sim.nodes) worst = Math.max(worst, Math.hypot(n.x - prev[n.index]![0], n.y - prev[n.index]![1]));
      prev = sim.nodes.map((n) => [n.x, n.y] as const);
    }
    expect(ticks).toBeGreaterThanOrEqual(SIM.blendTicks);
    expect(worst).toBeLessThan(25);
    for (const n of sim.nodes) expect([n.x, n.y]).toEqual(snapshot[n.id]);
  });

  it("a rebuild of the same shape is adopted as it is; another shape is not", () => {
    const sim = new AtlasSimulation(GRAPH);
    sim.settle();
    const before = sim.livePositions();
    const renamed: AtlasGraph = { ...GRAPH, nodes: GRAPH.nodes.map((n) => ({ ...n, label: `${n.label}!` })) };
    expect(sim.adopt(renamed)).toBe(true);
    expect(sim.source[0]!.label.endsWith("!")).toBe(true);
    expect(sim.livePositions()).toEqual(before);
    expect(sim.adopt({ ...GRAPH, edges: GRAPH.edges.slice(1) })).toBe(false);
    expect(graphShape(GRAPH)).toBe(graphShape(renamed));
  });

  it("seeds: the same id lands in the same place inside the seed disc; with neighbors, within 20 units of their mean", () => {
    expect(seedPosition("file:a.png", [])).toEqual(seedPosition("file:a.png", []));
    expect(seedPosition("file:a.png", [])).not.toEqual(seedPosition("file:b.png", []));
    for (const id of ["a", "b", "c", "def:frame", "file:docs/x.md"]) {
      const [x, y] = seedPosition(id, []);
      expect(Math.hypot(x, y / 0.8)).toBeLessThanOrEqual(320);
      const [nx, ny] = seedPosition(id, [[100, 50], [140, 90]]);
      const d = Math.hypot(nx - 120, ny - 70);
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(20);
    }
  });

  it("changedSince: a missing, moved or removed node makes a save due; equal positions do not", () => {
    const sim = settled();
    const saved = sim.positions();
    expect(Object.values(saved).every(([x, y]) => Number.isInteger(x) && Number.isInteger(y))).toBe(true);
    expect(sim.changedSince(saved)).toBe(false);
    expect(sim.changedSince(undefined)).toBe(true);
    const [first] = Object.keys(saved);
    const { [first!]: _gone, ...missing } = saved;
    expect(sim.changedSince(missing)).toBe(true);
    expect(sim.changedSince({ ...saved, [first!]: [saved[first!]![0] + 5, saved[first!]![1]] })).toBe(true);
    expect(sim.changedSince({ ...saved, "file:removed.md": [0, 0] })).toBe(true);
  });

  it("neighbors and groups", () => {
    const sim = new AtlasSimulation(GRAPH, { pullBy: "kind" });
    const n = sim.neighbors("file:models/frame.glb");
    expect(n).toContainEqual({ id: "def:frame", type: "has", out: false });
    expect(n).toContainEqual({ id: "file:cad/frame.step", type: "made-from", out: true });
    expect(sim.groups().map((g) => g.key).sort()).toEqual(Object.keys(GRAPH.counts.byKind).sort());
    expect(sim.groupOf(sim.indexOf("file:models/frame.glb")!)).toBe("kind:model");
    sim.setPullBy("links");
    expect(sim.groups()).toEqual([]);
    expect(sim.groupOf(0)).toBeNull();
  });

  it("an edge to a node the graph does not hold is left out", () => {
    const sim = new AtlasSimulation({ ...GRAPH, edges: [...GRAPH.edges, { from: "def:frame", to: "file:nowhere.md", type: "has" }] });
    expect(sim.edges.length).toBe(GRAPH.edges.length);
    sim.settle();
    expect(sim.nodes.every((n: SimNode) => Number.isFinite(n.x))).toBe(true);
  });
});
