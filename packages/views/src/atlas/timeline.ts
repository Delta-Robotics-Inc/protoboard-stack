/**
 * The Atlas time-lapse's data and timing (pure, so the tests can check it):
 * when each node came into being, the strict order the nodes arrive in, when
 * each arrives on the playback clock, and the curves a node and a link come
 * in with. The run itself (physics, births) is timelapse.ts.
 *
 * Times come from the index (`AtlasNode.created`: git's first add, else the
 * file's birth time, else its mtime; docs/specs/atlas.md, "Creation
 * times"). A node without one (a URL artifact, which has no file) comes in
 * with the earliest neighbor that has one (a URL artifact's part), and a
 * node with neither at the very start.
 *
 * Order: by time, then, within a batch that shares a timestamp (one commit),
 * parents before what they own (a module before its child modules and its
 * artifacts, a part before its files, a CAD source before the models made
 * from it), each owner followed by its own files so a cluster grows in one
 * place; ties by kind (the root, modules, parts, then files), folder and
 * path. Every node gets its own position (`order`, `seq`).
 *
 * Pacing: playback runs by sequence, with the calendar as a guide. Each
 * arrival is one step; a gap in the calendar adds a few steps, growing with
 * the logarithm of its length and capped, so a month without files is a
 * short pause, not most of the run, and a batch of hundreds of files from
 * one commit arrives one after another. The run's length grows with the
 * square root of the node count (about 20 s for 400 nodes at 1x).
 *
 * Every number is in `TIMELAPSE`, in one place.
 */
import type { AtlasGraph, AtlasNode, CreatedSource, EdgeType } from "@protoboardai/core/atlas";

/** The time-lapse's timing and feel. Times are milliseconds at 1x, lengths graph units, speeds units a tick. */
export const TIMELAPSE = {
  /** The run's length: this times the square root of the node count, clamped to [`minMs`, `maxMs`] (411 nodes: about 20 s). */
  msPerSqrtNode: 1000,
  minMs: 6000,
  maxMs: 30000,
  /** The first node arrives this long after play starts (the map starts empty). */
  leadInMs: 500,
  /** A calendar gap of `d` days between two arrivals adds `gapStepsPerLog * ln(1 + d)` arrivals' worth of time, at most `gapMaxSteps`. */
  gapStepsPerLog: 4,
  gapMaxSteps: 14,

  /**
   * A node's opacity on arrival (measured from Obsidian's graph time-lapse): half at once, then
   * 1 - 0.5 e^(-t / `fadeTauMs`) (80 % at about 230 ms, 95 % at about 570 ms), full from `fadeFullMs`.
   */
  fadeFrom: 0.5,
  fadeTauMs: 230,
  fadeFullMs: 750,
  /**
   * The pop, a subtle touch on top of the fade (Obsidian does not scale nodes in; the owner asked for
   * one): from `popFrom` of full size to full over `popMs`, one overshoot of about 8 % on the way
   * (an ease-out-back with constant `popOvershoot`).
   */
  popFrom: 0.6,
  popMs: 300,
  popOvershoot: 2.59,
  /** A link starts this long after both its ends are on the map, at full length, and fades in over `linkFadeMs`; its spring ramps in over `springRampMs` from then. */
  linkDelayMs: 150,
  linkFadeMs: 500,
  springRampMs: 500,

  /** A node with a present neighbor is born beside it, faint: past both radii plus this gap, plus up to `birthJitter` (hashed). */
  birthGap: 2,
  birthJitter: 4,
  /** It leaves at this speed (units a tick), outward from the map's center through its neighbor, turned by up to `birthSpread` radians (hashed); its spring carries it out to the link's length. */
  birthSpeed: 1.5,
  birthSpread: 1.1,
  /**
   * A node with no present neighbor is born just outside the cloud (its group's, else the whole
   * map's): `loneEdge` times the `loneQuantile` radius of the nodes there from their center, and
   * drifts inward about `loneDriftDiameters` of its diameters with an exponential ease-out (half
   * the way in about 140 ms), with no bounce of its own. The very first node starts within
   * `birthLoneOffset` of the center.
   */
  loneEdge: 1.1,
  loneQuantile: 0.95,
  loneDriftDiameters: 4,
  birthLoneOffset: 4,

  /**
   * The physics while a time-lapse runs: the map heavily damped (velocity kept a tick: `restDamping`;
   * nodes far from an arrival barely move), a new node and the neighbor it is born beside loose for
   * `looseMs`: a lone newcomer coasts in (`loneDamping`: no spring acts on it), one on a new link
   * and its neighbor less loose (`linkedDamping`) so the spring carries the newcomer out with
   * momentum and the neighbor, yanked, wobbles once and settles: real spring physics.
   */
  restDamping: 0.5,
  loneDamping: 0.92,
  linkedDamping: 0.75,
  looseMs: 600,
  /** While arrivals run the layout stays at least this warm (alpha target), so the physics runs live the whole time. */
  playAlpha: 0.03,
  /** Each arrival warms it by this, up to `kickMax`: the nodes near it get pushed aside to make room. */
  arrivalKick: 0.002,
  kickMax: 0.1,

  /** When not live: nodes appear in place (the layout as it was), fading in over this; links fade in after both ends, no physics. */
  revealFadeMs: 160,

  /** The run steps on a fixed clock: one simulation tick per step, at most this many steps a frame (a stalled tab does not race). */
  stepMs: 1000 / 60,
  maxStepsPerFrame: 4,
} as const;

export const TIMELAPSE_SPEEDS = [0.5, 1, 2, 4] as const;
export type TimelapseSpeed = (typeof TIMELAPSE_SPEEDS)[number];

const DAY_MS = 86_400_000;

export interface Timeline {
  /** Each node's time (ms since the epoch), index for index with the graph's nodes. */
  times: Float64Array;
  /** The earliest and latest times. */
  start: number;
  end: number;
  /** How many nodes carry a time of their own, by source, and how many borrowed one or have none. */
  sources: Record<CreatedSource, number> & { borrowed: number; none: number };
  /** Whether any node carries a time of its own (without one there is nothing to replay). */
  usable: boolean;
  /** The node indices in the order they arrive. */
  order: Int32Array;
  /** Each node's position in `order`. */
  seq: Int32Array;
  /** Each node's arrival on the playback clock (ms at 1x from play), index for index with the nodes; rises with `seq`. */
  arrive: Float64Array;
  /** The playback clock's length at 1x: the last arrival. */
  duration: number;
}

/** The run's length at 1x for `n` nodes (ms). */
export function playbackLength(n: number): number {
  return Math.max(TIMELAPSE.minMs, Math.min(TIMELAPSE.maxMs, TIMELAPSE.msPerSqrtNode * Math.sqrt(Math.max(0, n))));
}

/** The steps a calendar gap of `ms` adds between two arrivals (0 for none). */
export function gapSteps(ms: number): number {
  if (!(ms > 0)) return 0;
  return Math.min(TIMELAPSE.gapMaxSteps, TIMELAPSE.gapStepsPerLog * Math.log1p(ms / DAY_MS));
}

/** Edges whose `from` owns its `to`: what comes first in a batch. made-from runs the other way (the source before what is made from it). */
const OWNS: Partial<Record<EdgeType, "from" | "to">> = { has: "from", contains: "from", uses: "from", "made-from": "to" };

/** A node's rank in a batch: the root system, modules, parts, then files. */
const kindRank = (n: AtlasNode): number => (n.definition?.root ? 0 : n.kind === "module" ? 1 : n.kind === "part" ? 2 : 3);

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Each node's time (borrowed from its neighbors when it has none), its arrival order and its place on the playback clock. */
export function buildTimeline(graph: Pick<AtlasGraph, "nodes" | "edges">): Timeline {
  const n = graph.nodes.length;
  const times = new Float64Array(n).fill(Number.NaN);
  const sources = { git: 0, birthtime: 0, mtime: 0, borrowed: 0, none: 0 };
  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
  graph.nodes.forEach((node, i) => {
    const at = node.created?.at;
    if (typeof at === "number" && Number.isFinite(at)) {
      times[i] = at;
      sources[node.created!.from]++;
    }
  });
  const usable = times.some((t) => !Number.isNaN(t));
  // borrow: repeatedly, a node without a time takes the earliest time among its neighbors
  const adjacent: number[][] = graph.nodes.map(() => []);
  const children: number[][] = graph.nodes.map(() => []);
  const parents: number[][] = graph.nodes.map(() => []);
  for (const e of graph.edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    adjacent[a]!.push(b);
    adjacent[b]!.push(a);
    const owner = OWNS[e.type];
    if (owner) {
      const [p, c] = owner === "from" ? [a, b] : [b, a];
      children[p]!.push(c);
      parents[c]!.push(p);
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < n; i++) {
      let best = Number.NaN;
      for (const j of adjacent[i]!) if (!Number.isNaN(times[j]!) && (Number.isNaN(best) || times[j]! < best)) best = times[j]!;
      if (Number.isNaN(best)) continue;
      if (Number.isNaN(times[i]!) || (graph.nodes[i]!.created === undefined && best < times[i]!)) {
        times[i] = best;
        changed = true;
      }
    }
  }
  let start = Infinity;
  let end = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = times[i]!;
    if (Number.isNaN(t)) continue;
    if (t < start) start = t;
    if (t > end) end = t;
  }
  if (!Number.isFinite(start)) start = end = 0;
  for (let i = 0; i < n; i++) {
    if (graph.nodes[i]!.created) continue;
    if (Number.isNaN(times[i]!)) {
      times[i] = start;
      sources.none++;
    } else sources.borrowed++;
  }

  // the order: batch by batch (one timestamp each), owners before what they own, each followed by its own
  const byKey = (a: number, b: number) => {
    const na = graph.nodes[a]!;
    const nb = graph.nodes[b]!;
    return kindRank(na) - kindRank(nb) || cmp(na.folder, nb.folder) || cmp(na.path ?? na.id, nb.path ?? nb.id) || cmp(na.id, nb.id);
  };
  const all = Array.from({ length: n }, (_, i) => i).sort((a, b) => times[a]! - times[b]! || byKey(a, b));
  const order = new Int32Array(n);
  const placed = new Uint8Array(n);
  let k = 0;
  for (let b0 = 0; b0 < n; ) {
    let b1 = b0;
    const t = times[all[b0]!]!;
    while (b1 < n && times[all[b1]!] === t) b1++;
    const batch = all.slice(b0, b1);
    const visit = (i: number) => {
      // depth first: a node, then what it owns from the same batch
      const stack = [i];
      while (stack.length) {
        const j = stack.pop()!;
        if (placed[j]) continue;
        placed[j] = 1;
        order[k++] = j;
        const own = children[j]!.filter((c) => !placed[c] && times[c] === t).sort(byKey);
        for (let q = own.length - 1; q >= 0; q--) stack.push(own[q]!);
      }
    };
    // the batch's owners first (nothing in the batch owns them), then whatever a cycle left
    for (const i of batch) if (!parents[i]!.some((p) => times[p] === t)) visit(i);
    for (const i of batch) visit(i);
    b0 = b1;
  }
  const seq = new Int32Array(n);
  for (let q = 0; q < n; q++) seq[order[q]!] = q;

  // the playback clock: one step an arrival, more for a gap in the calendar, scaled to the run's length
  const arrive = new Float64Array(n);
  const steps = new Float64Array(n);
  for (let q = 1; q < n; q++) steps[q] = steps[q - 1]! + 1 + gapSteps(times[order[q]!]! - times[order[q - 1]!]!);
  const total = n > 1 ? steps[n - 1]! : 0;
  const length = playbackLength(n);
  const lead = TIMELAPSE.leadInMs;
  for (let q = 0; q < n; q++) arrive[order[q]!] = total > 0 ? lead + ((length - lead) * steps[q]!) / total : lead;
  const duration = n ? arrive[order[n - 1]!]! : 0;
  return { times, start, end, sources, usable, order, seq, arrive, duration };
}

/** How many nodes have arrived by playback time `ms` (they are the first that many in `order`). */
export function arrivedBy(timeline: Timeline, ms: number): number {
  const { order, arrive } = timeline;
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arrive[order[mid]!]! <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Which nodes have arrived by playback time `ms` (1: on the map), written into `out`; returns how many. */
export function arrivedAt(timeline: Timeline, ms: number, out: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < timeline.arrive.length; i++) {
    const on = timeline.arrive[i]! <= ms ? 1 : 0;
    out[i] = on;
    count += on;
  }
  return count;
}

/** The calendar date at playback time `ms`: the last arrival's, moving on through a gap toward the next one's. */
export function dateAt(timeline: Timeline, ms: number): number {
  const { order, arrive, times } = timeline;
  const n = order.length;
  if (!n) return timeline.start;
  const k = arrivedBy(timeline, ms) - 1;
  if (k < 0) return times[order[0]!]!;
  if (k >= n - 1) return times[order[n - 1]!]!;
  const a0 = arrive[order[k]!]!;
  const a1 = arrive[order[k + 1]!]!;
  const t0 = times[order[k]!]!;
  const t1 = times[order[k + 1]!]!;
  return a1 > a0 ? t0 + ((t1 - t0) * Math.min(1, Math.max(0, (ms - a0) / (a1 - a0)))) : t0;
}

/** A link's time: the later of its two ends' (it can start once both exist). */
export const linkTime = (timeline: Timeline, s: number, t: number): number => Math.max(timeline.times[s]!, timeline.times[t]!);

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/**
 * A node's scale `ageMs` after it arrived (the pop): from `popFrom` (at the arrival) to 1 over `popMs`,
 * past 1 by the overshoot on the way (ease-out-back), then 1; 0 before it arrives.
 */
export function popScale(ageMs: number, popMs: number = TIMELAPSE.popMs, overshoot: number = TIMELAPSE.popOvershoot, from: number = TIMELAPSE.popFrom): number {
  if (!(ageMs >= 0)) return 0;
  if (ageMs >= popMs) return 1;
  const x = ageMs / popMs - 1;
  return from + (1 - from) * (1 + (overshoot + 1) * x * x * x + overshoot * x * x);
}

/** A node's opacity `ageMs` after it arrived, as measured: half at once, then 1 - 0.5 e^(-t/tau), full from `fadeFullMs`; 0 before it arrives. */
export function entryOpacity(ageMs: number): number {
  if (!(ageMs >= 0)) return 0;
  if (ageMs >= TIMELAPSE.fadeFullMs) return 1;
  return 1 - (1 - TIMELAPSE.fadeFrom) * Math.exp(-ageMs / TIMELAPSE.fadeTauMs);
}

/** An ease-out from 0 to 1 over `fadeMs` (the time-lapse when not live). */
export function fadeIn(ageMs: number, fadeMs: number = TIMELAPSE.revealFadeMs): number {
  const x = clamp01(ageMs / Math.max(1, fadeMs));
  return 1 - (1 - x) * (1 - x);
}

/** A link's opacity (0 to 1), `ageMs` after both its ends were on the map: nothing for `delayMs`, then a smooth fade over `fadeMs`. It is always drawn at full length. */
export function linkAlpha(ageMs: number, delayMs: number = TIMELAPSE.linkDelayMs, fadeMs: number = TIMELAPSE.linkFadeMs): number {
  const x = clamp01((ageMs - delayMs) / Math.max(1, fadeMs));
  return x * x * (3 - 2 * x);
}

/** A link's spring strength (0 to 1), `ageMs` after both its ends were on the map: from when it starts, a smooth ramp over `springRampMs`. */
export function springRamp(ageMs: number): number {
  const x = clamp01((ageMs - TIMELAPSE.linkDelayMs) / TIMELAPSE.springRampMs);
  return x * x * (3 - 2 * x);
}

/** A date as the time-lapse shows it: "Nov 3, 2026" (UTC, so every machine shows the day the index recorded). */
export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
