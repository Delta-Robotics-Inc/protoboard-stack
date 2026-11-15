/**
 * The Atlas layout: a force-directed simulation of the project graph, pure
 * (no DOM, no clock, no randomness), so the same graph gives the same
 * positions on every machine and the tests can run it.
 *
 * One simulation lives as long as the view: switching what pulls nodes
 * together, a drag, a time-lapse and a rebuild of the index all act on it,
 * and none of them re-seeds it. Every tick, in this order:
 * - a centering force pulls each node toward the origin (a little harder
 *   vertically, so the map is wider than tall);
 * - when pulling by kind or folder, each node is also pulled toward its
 *   group's centroid, and the link springs are weakened, so groups emerge
 *   from the forces alone (no fixed anchor points). A switch between Links,
 *   Kind and Folder blends these parameters over `SIM.blendTicks` (about a
 *   second): the old grouping's pull fades out as the new one fades in;
 * - every pair of nodes repels with a 1/r force, softened at close range,
 *   scaled by the other node's mass (heavier hubs push harder), and nodes
 *   closer than their radii plus a padding are pushed apart; exact below
 *   `SIM.exactBelow` nodes, a Barnes-Hut quadtree above;
 * - each link is a spring toward its rest length (which depends on the
 *   link's type), its strength divided by the smaller endpoint degree and
 *   shared by a degree bias, so hubs stay put and leaves move;
 * - velocities are damped and positions advance; a pinned node (dragged)
 *   stays where it is held;
 * - alpha, which scales every force but the collision, eases toward its
 *   target: from 1 it falls below `SIM.alphaMin` in about 300 ticks.
 *
 * A node's radius and mass grow with its link count (`degreeScale`: a square
 * root, clamped), so hubs read as heavier and keep more room around them.
 *
 * Files with no links have no springs, so the repulsion carries them to
 * the perimeter.
 *
 * Two eased motions steer nodes toward given positions without a jump
 * (`startIntro`, `glideTo`): an anchor force that grows over the motion,
 * then a final blend that lands every node exactly on its target. The view
 * uses the first to open the map from a gathered center, the second to
 * return from a time-lapse to the layout it left.
 */
import type { AtlasNode, EdgeType } from "@protoboardai/core/atlas";
import type { PullBy } from "./data.js";
import type { MapGraph, MapNode } from "./graph.js";
import { TIMELAPSE } from "./timeline.js";

export const SIM = {
  centerX: 0.06,
  centerY: 0.075, // vx -= x*0.060*a; vy -= y*0.075*a
  repulsion: 85,
  softening: 30, // f = 85a/d²; d² < 30 -> sqrt(30 d²)
  collisionPad: 7,
  collisionK: 0.35,
  damping: 0.6, // v *= 0.6
  alphaDecay: 0.0228,
  alphaMin: 0.001, // alpha += (target - alpha)*0.0228 -> about 300 ticks from 1 to 0.001
  dragAlphaTarget: 0.3,
  reheat: 0.7,
  /** A change of grouping warms the layout to this (velocities and positions kept). */
  modeReheat: 0.8,
  /** Ticks over which a change of grouping blends the forces (about a second at 60 frames a second). */
  blendTicks: 60,
  affinity: 0.25,
  linkScaleGrouped: 0.04, // Kind/Folder: springs at 4 %, pull to the group centroid
  lengths: { "made-from": 24, harness: 110, link: 110, root: 130, default: 44 },
  /** By link type (a type not named here, as the System Map's are, is 1). */
  linkStrengthByType: { link: 1, harness: 1, "made-from": 1, has: 1, contains: 1, uses: 1 } as Record<EdgeType, number> & Record<string, number | undefined>,
  preTicks: 320,
  theta: 0.9,
  exactBelow: 500,
  /**
   * Every node has a saved position: nothing moves until the person does
   * something. (Any reheat drifts a cooled layout by several units, so each
   * reopening would move nodes and make a save due: churn in display.json.)
   */
  warmAlpha: 0,
  /** Some nodes are new: they settle in at this alpha while the saved ones are held. */
  warmAlphaWithNew: 0.3,
  /** The opening: ticks (about 2 s), and how far from the center nodes start (a share of where they end). */
  introTicks: 120,
  introGather: 0.05,
  /** A node that appears in a time-lapse warms the layout to at least this. */
  appearAlpha: 0.25,
  /** No node moves more than this many units in a tick (a dragged node excepted: it is where the pointer is). */
  maxSpeed: 14,
  /** A glide (the return from a time-lapse) moves a node at most about this far a tick, taking up to `glideMaxTicks`. */
  glideStep: 10,
  glideMaxTicks: 300,
} as const;

/** How a node's radius and mass grow with its links: 1 + k·sqrt(degree), at most `max`. */
export const DEGREE_SCALE = { k: 0.3, max: 2.4 } as const;

/** A node's size and mass factor from its link count (1 with no link, at most `DEGREE_SCALE.max`). */
export function degreeScale(deg: number): number {
  return Math.min(DEGREE_SCALE.max, 1 + DEGREE_SCALE.k * Math.sqrt(Math.max(0, deg)));
}

/** Each kind's radius with no link, in graph units (the root system is never smaller than `ROOT_MIN_R`). */
export const BASE_RADIUS = { module: 5.2, part: 3.4, file: 3.8 } as const;
export const ROOT_MIN_R = 12;

/**
 * How a simulation starts: `fresh` (no saved positions, or fewer than half
 * the nodes have one: a full layout from alpha 1), `joined` (new nodes
 * settle in beside the saved ones, which are held until the layout cools),
 * `kept` (every node is where it was saved; nothing moves).
 */
export type SimStart = "fresh" | "joined" | "kept";

export interface SimNode {
  id: string;
  index: number;
  kind: string;
  folder: string;
  root: boolean;
  /** A hub (the Atlas's modules, a node the graph marks `hub`): its label in capitals, two pixels on the minimap. */
  hub: boolean;
  /** Has at least one link (an unlinked file has none and drifts to the edge). */
  linked: boolean;
  r: number;
  /** Mass: the degree scale (a hub is heavier: it pushes harder and is pushed less). */
  m: number;
  deg: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
}

export interface SimEdge {
  s: number;
  t: number;
  type: string;
  length: number;
}

/** A node's drawn radius, in graph units: its kind's base times its degree scale (the root at least 12). */
export function nodeRadius(n: { kind: string; root: boolean; deg: number }): number {
  const base = n.kind === "module" ? BASE_RADIUS.module : n.kind === "part" ? BASE_RADIUS.part : BASE_RADIUS.file;
  const r = base * degreeScale(n.deg);
  return n.root ? Math.max(ROOT_MIN_R, r) : r;
}

/** FNV-1a, 32 bits, over the UTF-16 code units of `text`. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A number in [0, 1) from the hash of `text`. */
const unit = (text: string) => fnv1a(text) / 4294967296;

/**
 * Where a node starts. Deterministic: the hash of its id gives an angle and
 * a radius (sqrt(u) * 320, so the disc fills evenly; y squeezed to 0.8). A
 * node whose neighbors are already placed starts at their mean, 10 to 20
 * units off in a hashed direction.
 */
export function seedPosition(id: string, neighbors: readonly (readonly [number, number])[]): [number, number] {
  if (neighbors.length) {
    let mx = 0;
    let my = 0;
    for (const [x, y] of neighbors) {
      mx += x;
      my += y;
    }
    mx /= neighbors.length;
    my /= neighbors.length;
    const a = unit(`${id}#a`) * Math.PI * 2;
    const r = 10 + unit(`${id}#j`) * 10;
    return [mx + Math.cos(a) * r, my + Math.sin(a) * r];
  }
  const a = unit(id) * Math.PI * 2;
  const r = Math.sqrt(unit(`${id}#r`)) * 320;
  return [Math.cos(a) * r, Math.sin(a) * r * 0.8];
}

/** A node's identity in a graph's shape: its id, then its edges (a rebuild with the same shape keeps the simulation as it is). */
export function graphShape(graph: Pick<MapGraph, "nodes" | "edges">): string {
  let h = 0x811c9dc5;
  const mix = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const n of graph.nodes) mix(n.id);
  for (const e of graph.edges) mix(`${e.from}\u0000${e.to}\u0000${e.type}`);
  return `${graph.nodes.length}:${graph.edges.length}:${h >>> 0}`;
}

/** The positions a force acts on (the tests build these directly); the charge is `q`, else the mass `m`, else 1. */
export interface Body {
  x: number;
  y: number;
  q?: number;
  m?: number;
}

const charge = (b: Body) => b.q ?? b.m ?? 1;

/** Force between two bodies: `(dx, dy) * f` on the first, the opposite on the second. */
function repulse(d2: number, alpha: number): number {
  const d = d2 < SIM.softening ? Math.sqrt(SIM.softening * d2) : d2;
  return (SIM.repulsion * alpha) / d;
}

interface Cell {
  x0: number;
  y0: number;
  size: number;
  count: number;
  /** The total charge below, and its charge-weighted center. */
  q: number;
  cx: number;
  cy: number;
  /** The largest radius of a body below (for the collision search). */
  maxR: number;
  kids: (Cell | null)[] | null;
  points: number[] | null;
}

const cell = (x0: number, y0: number, size: number): Cell => ({ x0, y0, size, count: 0, q: 0, cx: 0, cy: 0, maxR: 0, kids: null, points: null });

/** A quadtree over the bodies, with each cell's count, charge, center of charge and largest radius. */
function quadtree(bodies: readonly Body[], radius: (i: number) => number): Cell {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of bodies) {
    if (b.x < x0) x0 = b.x;
    if (b.y < y0) y0 = b.y;
    if (b.x > x1) x1 = b.x;
    if (b.y > y1) y1 = b.y;
  }
  const size = Math.max(x1 - x0, y1 - y0, 1) * 1.0001 + 1e-6;
  const root = cell(x0, y0, size);
  const insert = (c: Cell, i: number, depth: number): void => {
    const b = bodies[i]!;
    const q = charge(b);
    c.count++;
    c.q += q;
    c.cx += b.x * q;
    c.cy += b.y * q;
    c.maxR = Math.max(c.maxR, radius(i));
    if (!c.kids) {
      if (!c.points) {
        c.points = [i];
        return;
      }
      const first = bodies[c.points[0]!]!;
      // bodies on the same spot (or a tree this deep) share one leaf
      if (depth >= 32 || (first.x === b.x && first.y === b.y)) {
        c.points.push(i);
        return;
      }
      const old = c.points;
      c.points = null;
      c.kids = [null, null, null, null];
      for (const j of old) into(c, j, depth);
    }
    into(c, i, depth);
  };
  const into = (c: Cell, i: number, depth: number) => {
    const b = bodies[i]!;
    const h = c.size / 2;
    const qx = b.x >= c.x0 + h ? 1 : 0;
    const qy = b.y >= c.y0 + h ? 1 : 0;
    const q = qx + qy * 2;
    const kid = (c.kids![q] ??= cell(c.x0 + qx * h, c.y0 + qy * h, h));
    // a split moves a leaf's bodies into its kids only: the cell's own totals already hold them
    insert(kid, i, depth + 1);
  };
  for (let i = 0; i < bodies.length; i++) insert(root, i, 0);
  const finish = (c: Cell) => {
    c.cx /= c.q || 1;
    c.cy /= c.q || 1;
    if (c.kids) for (const k of c.kids) if (k) finish(k);
  };
  finish(root);
  return root;
}

/**
 * The 1/r repulsion on every body (added to `out` as x, y pairs, already
 * scaled by alpha), each push scaled by the charge of the body pushing
 * (`q`, default 1): exact when `theta` is 0, else Barnes-Hut (a cell seen
 * at less than `theta` of its distance acts as one body of its total charge
 * at its center of charge). The simulation uses the exact pairwise loop
 * below `SIM.exactBelow` bodies and this, with `SIM.theta`, above.
 */
export function manyBody(bodies: readonly Body[], alpha: number, theta: number, out = new Float64Array(bodies.length * 2)): Float64Array {
  const n = bodies.length;
  if (theta <= 0) {
    for (let i = 0; i < n; i++) {
      const a = bodies[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        if (dx === 0 && dy === 0) {
          dx = 0.5;
          dy = 0.3;
        }
        const f = repulse(dx * dx + dy * dy, alpha);
        const qa = charge(a);
        const qb = charge(b);
        out[i * 2] += dx * f * qb;
        out[i * 2 + 1] += dy * f * qb;
        out[j * 2] -= dx * f * qa;
        out[j * 2 + 1] -= dy * f * qa;
      }
    }
    return out;
  }
  const tree = quadtree(bodies, () => 0);
  const t2 = theta * theta;
  for (let i = 0; i < n; i++) {
    const a = bodies[i]!;
    let fx = 0;
    let fy = 0;
    const visit = (c: Cell) => {
      if (!c.kids) {
        for (const j of c.points!) {
          if (j === i) continue;
          const b = bodies[j]!;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          if (dx === 0 && dy === 0) {
            dx = i < j ? 0.5 : -0.5;
            dy = i < j ? 0.3 : -0.3;
          }
          const f = repulse(dx * dx + dy * dy, alpha) * charge(b);
          fx += dx * f;
          fy += dy * f;
        }
        return;
      }
      const dx = a.x - c.cx;
      const dy = a.y - c.cy;
      const d2 = dx * dx + dy * dy;
      const inside = a.x >= c.x0 && a.x < c.x0 + c.size && a.y >= c.y0 && a.y < c.y0 + c.size;
      if (!inside && c.size * c.size < t2 * d2) {
        const f = repulse(d2, alpha) * c.q;
        fx += dx * f;
        fy += dy * f;
        return;
      }
      for (const k of c.kids) if (k) visit(k);
    };
    visit(tree);
    out[i * 2] += fx;
    out[i * 2 + 1] += fy;
  }
  return out;
}

/** The push apart of bodies closer than their radii plus the padding, through a quadtree (the large-graph path). */
function collideTree(nodes: readonly SimNode[]) {
  const tree = quadtree(nodes, (i) => nodes[i]!.r);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    let vx = 0;
    let vy = 0;
    const visit = (c: Cell) => {
      const reach = n.r + c.maxR + SIM.collisionPad;
      // the cell's box, grown by the reach, does not hold the node: nothing below can touch it
      if (n.x < c.x0 - reach || n.x > c.x0 + c.size + reach || n.y < c.y0 - reach || n.y > c.y0 + c.size + reach) return;
      if (!c.kids) {
        for (const j of c.points!) {
          if (j === i) continue;
          const m = nodes[j]!;
          let dx = n.x - m.x;
          let dy = n.y - m.y;
          if (dx === 0 && dy === 0) {
            dx = i < j ? 0.5 : -0.5;
            dy = i < j ? 0.3 : -0.3;
          }
          const raw = dx * dx + dy * dy;
          const need = n.r + m.r + SIM.collisionPad;
          if (raw < need * need) {
            const d = Math.sqrt(raw) || 0.1;
            const f = ((need - d) / d) * SIM.collisionK;
            vx += dx * f;
            vy += dy * f;
          }
        }
        return;
      }
      for (const k of c.kids) if (k) visit(k);
    };
    visit(tree);
    n.vx += vx;
    n.vy += vy;
  }
}

export interface SimOptions {
  pullBy?: PullBy;
  /** Positions kept from an earlier session (or the graph before a reload): honored as the start. */
  saved?: Record<string, readonly [number, number]>;
}

export interface Neighbor {
  id: string;
  type: string;
  /** The link starts at the node asked about. */
  out: boolean;
}

/** A grouping: each node's group (-1: none), and each group's key and members. */
interface Grouping {
  index: Int32Array;
  list: { key: string; members: number[] }[];
}

/** The pull toward the group centroid and the spring scale of a grouping. */
const affinityOf = (p: PullBy) => (p === "links" ? 0 : SIM.affinity);
const linkScaleOf = (p: PullBy) => (p === "links" ? 1 : SIM.linkScaleGrouped);
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** An eased motion toward target positions: the opening, or the return from a time-lapse. */
interface Steer {
  /** Target x, y per node (NaN: free, the physics alone moves it). */
  home: Float64Array;
  tick: number;
  ticks: number;
  /** The share of the motion from which the blend onto the targets starts (the opening lets the physics expand first). */
  from: number;
  /** How much of the way the blend has covered (0 to 1). */
  w: number;
  /** After the motion: `rest` cools the layout on its targets; `hold` holds the targeted nodes while the free ones settle in. */
  then: "rest" | "hold" | "free";
}

/** The simulation of a graph: the Atlas's project index by default, or any `MapGraph` (the System Map). */
export class AtlasSimulation<N extends MapNode = AtlasNode> {
  readonly nodes: SimNode[];
  readonly edges: SimEdge[];
  /** The graph's nodes, index for index with `nodes` (replaced, never reshaped, by `adopt`). */
  source: readonly N[];
  /** How many nodes started at a saved position. */
  readonly placed: number;
  /** How the layout started (a `fresh` one is settled by the view before it is drawn). */
  readonly start: SimStart;
  /** The shape of the graph it was built from (`graphShape`). */
  readonly shape: string;
  /** What alpha eases toward (raised while a node is dragged). */
  alphaTarget = 0;
  private a: number;
  /** Nodes held at their saved position while new ones settle in (`joined`); cleared once the layout cools. */
  private held: Uint8Array | null = null;
  private mode: PullBy = "links";
  /** The grouping being left, while a change of grouping blends (null: none). */
  private from: { mode: PullBy; grouping: Grouping } | null = null;
  /** 0 to 1 through the blend toward the current grouping. */
  private blend = 1;
  private readonly byId = new Map<string, number>();
  private readonly adjacent: { j: number; type: string; out: boolean; e: number }[][];
  private grouping: Grouping;
  /** Which nodes are on the map (a time-lapse hides those not yet made); null: all of them. */
  private shown: Uint8Array | null = null;
  /** The indices of the nodes shown, while some are hidden. */
  private shownList: number[] | null = null;
  private steer: Steer | null = null;
  /** Each link's spring strength, 0 to 1, index for index with `edges` (a time-lapse ramps new links in); null: all full. */
  edgeScale: Float32Array | null = null;
  /** Each node's damping (the velocity kept a tick), index for index with `nodes` (a time-lapse damps the map hard and loosens its arrivals); null: `SIM.damping`. */
  damping: Float32Array | null = null;
  /**
   * A lone newcomer's drift (a time-lapse): x, y per node, added to its step and shrinking by
   * `TIMELAPSE.loneDamping` a tick, an exponential ease-out of its own beside the physics (so the
   * forces on it are not amplified by a light damping); null: none.
   */
  private drift: Float64Array | null = null;
  /** A reused buffer for the large-graph repulsion. */
  private force: Float64Array<ArrayBuffer> | null = null;

  constructor(graph: MapGraph<N>, options: SimOptions = {}) {
    this.source = graph.nodes;
    this.shape = graphShape(graph);
    graph.nodes.forEach((n, i) => this.byId.set(n.id, i));
    const count = graph.nodes.length;
    const deg = new Array<number>(count).fill(0);
    this.adjacent = graph.nodes.map(() => []);
    const raw: { s: number; t: number; type: string }[] = [];
    for (const e of graph.edges) {
      const s = this.byId.get(e.from);
      const t = this.byId.get(e.to);
      // an edge to a node the graph does not hold, or to itself, has no spring
      if (s === undefined || t === undefined || s === t) continue;
      const k = raw.length;
      raw.push({ s, t, type: e.type });
      deg[s]!++;
      deg[t]!++;
      this.adjacent[s]!.push({ j: t, type: e.type, out: true, e: k });
      this.adjacent[t]!.push({ j: s, type: e.type, out: false, e: k });
    }
    const saved = options.saved ?? {};
    let placed = 0;
    this.nodes = graph.nodes.map((n, index) => {
      const root = n.definition?.root === true;
      const at = saved[n.id];
      const ok = at && Number.isFinite(at[0]) && Number.isFinite(at[1]);
      if (ok) placed++;
      const node: SimNode = { id: n.id, index, kind: n.kind, folder: n.folder, root, hub: n.kind === "module" || n.hub === true, linked: deg[index]! > 0, r: 0, m: degreeScale(deg[index]!), deg: deg[index]!, x: ok ? at[0] : 0, y: ok ? at[1] : 0, vx: 0, vy: 0, fx: null, fy: null };
      node.r = nodeRadius(node);
      return node;
    });
    // nodes without a saved position: next to their placed neighbors, else where their id puts them
    for (const node of this.nodes) {
      const at = saved[node.id];
      if (at && Number.isFinite(at[0]) && Number.isFinite(at[1])) continue;
      const near = this.adjacent[node.index]!.map((x) => saved[this.nodes[x.j]!.id]).filter((p): p is readonly [number, number] => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
      [node.x, node.y] = seedPosition(node.id, near);
    }
    this.placed = placed;
    this.edges = raw.map((e) => ({ ...e, length: this.restLength(e.type, this.nodes[e.s]!, this.nodes[e.t]!) }));
    this.start = placed === count && count > 0 ? "kept" : placed > 0 && placed * 2 >= count ? "joined" : "fresh";
    this.a = this.start === "fresh" ? 1 : this.start === "joined" ? SIM.warmAlphaWithNew : SIM.warmAlpha;
    if (this.start === "joined") {
      this.held = new Uint8Array(count);
      for (const n of this.nodes) {
        const at = saved[n.id];
        if (at && Number.isFinite(at[0]) && Number.isFinite(at[1])) this.held[n.index] = 1;
      }
    }
    this.mode = options.pullBy ?? "links";
    this.grouping = this.groupBy(this.mode);
  }

  private restLength(type: string, s: SimNode, t: SimNode): number {
    if (type === "made-from") return SIM.lengths["made-from"];
    if (type === "harness") return SIM.lengths.harness;
    if (type === "link") return SIM.lengths.link;
    if (s.root || t.root) return SIM.lengths.root;
    return SIM.lengths.default;
  }

  private groupBy(p: PullBy): Grouping {
    const index = new Int32Array(this.nodes.length).fill(-1);
    const list: Grouping["list"] = [];
    if (p === "links") return { index, list };
    const at = new Map<string, number>();
    for (const n of this.nodes) {
      const key = p === "kind" ? n.kind : n.folder;
      let g = at.get(key);
      if (g === undefined) {
        g = list.length;
        at.set(key, g);
        list.push({ key, members: [] });
      }
      list[g]!.members.push(n.index);
      index[n.index] = g;
    }
    return { index, list };
  }

  get alpha(): number {
    return this.a;
  }

  get pullBy(): PullBy {
    return this.mode;
  }

  /** How grouped the forces are now, 0 (Links) to 1 (Kind or Folder), eased through a change of grouping. */
  get groupedness(): number {
    const s = smooth(this.blend);
    const to = this.mode === "links" ? 0 : 1;
    const from = this.from ? (this.from.mode === "links" ? 0 : 1) : to;
    return from + (to - from) * s;
  }

  /** Whether a change of grouping is still blending. */
  get blending(): boolean {
    return this.blend < 1;
  }

  /** Whether a tick would still move anything (the view's loop stops when it would not). */
  get active(): boolean {
    return this.a >= SIM.alphaMin || this.alphaTarget > 0 || this.steer !== null || this.blend < 1;
  }

  /** Whether an opening or a glide is under way. */
  get steering(): boolean {
    return this.steer !== null;
  }

  /** A node's index by id (undefined: not in the graph). */
  indexOf(id: string): number | undefined {
    return this.byId.get(id);
  }

  /** Whether a node is on the map (a time-lapse hides the nodes not yet made). */
  isShown(index: number): boolean {
    return !this.shown || this.shown[index] === 1;
  }

  /** The group a node is in ("kind:render", "folder:docs"), or null in Links mode. */
  groupOf(index: number): string | null {
    const g = this.grouping.index[index] ?? -1;
    return g < 0 ? null : `${this.mode}:${this.grouping.list[g]!.key}`;
  }

  /** The graph's nodes again after a rebuild of the same shape (same ids and edges): new details, the same layout. */
  adopt(graph: MapGraph<N>): boolean {
    if (graphShape(graph) !== this.shape) return false;
    this.source = graph.nodes;
    return true;
  }

  /** The group centroids of a grouping, over the nodes shown. */
  private centroids(g: Grouping): [Float64Array, Float64Array] {
    const gx = new Float64Array(g.list.length);
    const gy = new Float64Array(g.list.length);
    g.list.forEach((grp, k) => {
      let sx = 0;
      let sy = 0;
      let c = 0;
      for (const i of grp.members) {
        if (this.shown && !this.shown[i]) continue;
        sx += this.nodes[i]!.x;
        sy += this.nodes[i]!.y;
        c++;
      }
      gx[k] = c ? sx / c : 0;
      gy[k] = c ? sy / c : 0;
    });
    return [gx, gy];
  }

  tick(): void {
    const nodes = this.nodes;
    const list = this.shownList;
    const count = list ? list.length : nodes.length;
    const at = (k: number) => (list ? list[k]! : k);
    const a = this.a;
    const s = smooth(this.blend);
    const fromMode = this.from?.mode ?? this.mode;
    const linkK = linkScaleOf(fromMode) + (linkScaleOf(this.mode) - linkScaleOf(fromMode)) * s;
    const affNew = affinityOf(this.mode) * s;
    const affOld = this.from ? affinityOf(this.from.mode) * (1 - s) : 0;

    // centering, and the pull toward the group's centroid (the old grouping's fading out while a change blends)
    const [gx, gy] = affNew ? this.centroids(this.grouping) : [undefined, undefined];
    const [ox, oy] = affOld ? this.centroids(this.from!.grouping) : [undefined, undefined];
    for (let k = 0; k < count; k++) {
      const i = at(k);
      const p = nodes[i]!;
      p.vx -= p.x * SIM.centerX * a;
      p.vy -= p.y * SIM.centerY * a;
      if (affNew) {
        const g = this.grouping.index[i]!;
        p.vx += (gx![g]! - p.x) * affNew * a;
        p.vy += (gy![g]! - p.y) * affNew * a;
      }
      if (affOld) {
        const g = this.from!.grouping.index[i]!;
        p.vx += (ox![g]! - p.x) * affOld * a;
        p.vy += (oy![g]! - p.y) * affOld * a;
      }
    }

    // repulsion (scaled by the pushing node's mass) and collision
    if (count < SIM.exactBelow) {
      for (let k = 0; k < count; k++) {
        const p = nodes[at(k)]!;
        for (let l = k + 1; l < count; l++) {
          const m = nodes[at(l)]!;
          let dx = p.x - m.x;
          let dy = p.y - m.y;
          if (dx === 0 && dy === 0) {
            dx = 0.5;
            dy = 0.3;
          }
          const raw = dx * dx + dy * dy;
          let f = repulse(raw, a);
          p.vx += dx * f * m.m;
          p.vy += dy * f * m.m;
          m.vx -= dx * f * p.m;
          m.vy -= dy * f * p.m;
          const need = p.r + m.r + SIM.collisionPad;
          if (raw < need * need) {
            const d = Math.sqrt(raw) || 0.1;
            f = ((need - d) / d) * SIM.collisionK;
            p.vx += dx * f;
            p.vy += dy * f;
            m.vx -= dx * f;
            m.vy -= dy * f;
          }
        }
      }
    } else {
      const bodies = list ? list.map((i) => nodes[i]!) : nodes;
      if (!this.force || this.force.length !== bodies.length * 2) this.force = new Float64Array(bodies.length * 2);
      else this.force.fill(0);
      const force = manyBody(bodies, a, SIM.theta, this.force);
      for (let k = 0; k < bodies.length; k++) {
        bodies[k]!.vx += force[k * 2]!;
        bodies[k]!.vy += force[k * 2 + 1]!;
      }
      collideTree(bodies);
    }

    // link springs: strength over the smaller degree, shared by the degree bias (only between nodes shown;
    // in a time-lapse each scaled by its ramp, `edgeScale`, so a new link's pull grows in instead of snapping)
    const scale = this.edgeScale;
    for (let ei = 0; ei < this.edges.length; ei++) {
      const e = this.edges[ei]!;
      if (this.shown && (!this.shown[e.s] || !this.shown[e.t])) continue;
      const w = scale ? scale[ei]! : 1;
      if (!(w > 0)) continue;
      const s = nodes[e.s]!;
      const t = nodes[e.t]!;
      const dx = t.x + t.vx - (s.x + s.vx);
      const dy = t.y + t.vy - (s.y + s.vy);
      const d = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const k = ((((a * linkK * (SIM.linkStrengthByType[e.type] ?? 1)) * (d - e.length)) / d) / Math.min(s.deg, t.deg)) * w;
      const bias = s.deg / (s.deg + t.deg);
      t.vx -= dx * k * bias;
      t.vy -= dy * k * bias;
      s.vx += dx * k * (1 - bias);
      s.vy += dy * k * (1 - bias);
    }

    // an opening or a glide: an anchor toward each target, growing over the motion
    const steer = this.steer;
    let p01 = 0;
    if (steer) {
      steer.tick++;
      p01 = Math.min(1, steer.tick / steer.ticks);
      const pull = 0.004 + 0.1 * p01 * p01;
      for (let k = 0; k < count; k++) {
        const i = at(k);
        const hx = steer.home[i * 2]!;
        if (Number.isNaN(hx)) continue;
        const p = nodes[i]!;
        p.vx += (hx - p.x) * pull;
        p.vy += (steer.home[i * 2 + 1]! - p.y) * pull;
      }
    }

    // damping and the step; a pinned node (dragged) or a held one (saved, while new ones settle in) stays
    const held = steer ? null : this.held;
    for (let k = 0; k < count; k++) {
      const i = at(k);
      const p = nodes[i]!;
      if (p.fx !== null && p.fy !== null) {
        p.x = p.fx;
        p.y = p.fy;
        p.vx = 0;
        p.vy = 0;
      } else if (held?.[i]) {
        p.vx = 0;
        p.vy = 0;
      } else {
        const damp = this.damping ? this.damping[i]! : SIM.damping;
        p.vx *= damp;
        p.vy *= damp;
        // a speed limit: a crowd of nodes (the gathered start, many appearing at once) never bursts apart in one tick
        const v2 = p.vx * p.vx + p.vy * p.vy;
        if (v2 > SIM.maxSpeed * SIM.maxSpeed) {
          const f = SIM.maxSpeed / Math.sqrt(v2);
          p.vx *= f;
          p.vy *= f;
        }
        p.x += p.vx;
        p.y += p.vy;
        const dr = this.drift;
        if (dr && (dr[i * 2] !== 0 || dr[i * 2 + 1] !== 0)) {
          dr[i * 2] *= TIMELAPSE.loneDamping;
          dr[i * 2 + 1] *= TIMELAPSE.loneDamping;
          p.x += dr[i * 2]!;
          p.y += dr[i * 2 + 1]!;
          if (Math.abs(dr[i * 2]!) + Math.abs(dr[i * 2 + 1]!) < 1e-3) dr[i * 2] = dr[i * 2 + 1] = 0;
        }
      }
    }

    // from `steer.from` on, a steered motion blends each targeted node onto its target: what is left of the way
    // shrinks as 1 - smoothstep, so each tick moves a node a small share of a bounded distance, and the last
    // lands it exactly on its target
    if (steer) {
      const W = p01 >= 1 ? 1 : smooth((p01 - steer.from) / (1 - steer.from));
      const w = W >= 1 ? 1 : steer.w >= 1 ? 1 : (W - steer.w) / (1 - steer.w);
      steer.w = W;
      if (w > 0) {
        for (let k = 0; k < count; k++) {
          const i = at(k);
          const hx = steer.home[i * 2]!;
          const p = nodes[i]!;
          if (Number.isNaN(hx) || p.fx !== null) continue;
          const hy = steer.home[i * 2 + 1]!;
          if (w === 1) {
            // exactly on target (the very numbers given: a saved -0 stays -0)
            p.x = hx;
            p.y = hy;
            p.vx = 0;
            p.vy = 0;
          } else {
            p.x += (hx - p.x) * w;
            p.y += (hy - p.y) * w;
          }
        }
      }
      if (p01 >= 1) this.endSteer(steer);
    }

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + 1 / SIM.blendTicks);
      if (this.blend >= 1) this.from = null;
    }
    this.a += (this.alphaTarget - this.a) * SIM.alphaDecay;
    if (this.held && this.a < SIM.alphaMin) this.held = null;
  }

  private endSteer(steer: Steer) {
    this.steer = null;
    if (steer.then === "rest") {
      this.a = 0;
      for (const n of this.nodes) {
        n.vx = 0;
        n.vy = 0;
      }
    } else if (steer.then === "hold") {
      const held = new Uint8Array(this.nodes.length);
      for (let i = 0; i < this.nodes.length; i++) if (!Number.isNaN(steer.home[i * 2]!)) held[i] = 1;
      this.held = held;
      this.a = Math.max(this.a, SIM.warmAlphaWithNew);
    }
  }

  /** Whether a node is held at its saved position while new ones settle in. */
  isHeld(index: number): boolean {
    return !!this.held?.[index];
  }

  /** Ticks until alpha falls below `SIM.alphaMin` (or `maxTicks` while a target holds it up); returns the ticks run. */
  settle(maxTicks = 2000): number {
    let k = 0;
    while (k < maxTicks && (this.a >= SIM.alphaMin || this.steer || this.blend < 1)) {
      this.tick();
      k++;
    }
    return k;
  }

  /**
   * The opening: every node starts gathered near the center (a small share of
   * where it is now, so the map keeps its shape as it grows) and the physics
   * expands it. Nodes with a saved position (`start` kept or joined) are
   * steered onto it, landing exactly there after `ticks`; a fresh layout
   * settles freely. Velocities start at zero.
   */
  startIntro(ticks: number = SIM.introTicks): void {
    const home = new Float64Array(this.nodes.length * 2).fill(Number.NaN);
    const steered = this.start !== "fresh";
    for (const n of this.nodes) {
      if (steered && (this.start === "kept" || this.held?.[n.index])) {
        home[n.index * 2] = n.x;
        home[n.index * 2 + 1] = n.y;
      }
      const j = (unit(`${n.id}#g`) - 0.5) * 6;
      n.x = n.x * SIM.introGather + j;
      n.y = n.y * SIM.introGather - j * 0.6;
      n.vx = 0;
      n.vy = 0;
    }
    this.held = null;
    this.a = 1;
    if (steered) this.steer = { home, tick: 0, ticks: Math.max(1, ticks), from: 0.3, w: 0, then: this.start === "kept" ? "rest" : "hold" };
  }

  /** Steer every node to `positions` over at least `ticks` (longer for a long way: the return from a time-lapse), then rest there. Nodes it does not name move freely. */
  glideTo(positions: Record<string, readonly [number, number]>, ticks: number = SIM.blendTicks): void {
    const home = new Float64Array(this.nodes.length * 2).fill(Number.NaN);
    let all = true;
    let far = 0;
    for (const n of this.nodes) {
      const at = positions[n.id];
      if (!at) {
        all = false;
        continue;
      }
      home[n.index * 2] = at[0];
      home[n.index * 2 + 1] = at[1];
      far = Math.max(far, Math.hypot(at[0] - n.x, at[1] - n.y));
    }
    // a long way takes longer: the blend's steepest tick (1.5 / ticks of the way) stays under `SIM.glideStep` units
    const need = Math.ceil((far * 1.5) / SIM.glideStep);
    this.held = null;
    this.a = Math.max(this.a, 0.15);
    this.steer = { home, tick: 0, ticks: Math.max(1, ticks, Math.min(need, SIM.glideMaxTicks)), from: 0, w: 0, then: all ? "rest" : "free" };
  }

  /**
   * Show only some nodes (a time-lapse), or all of them again (null). A node
   * that appears starts beside its shown neighbors (or near the center when
   * none is shown yet), at rest, and the layout warms so it settles in.
   * Nodes that stay shown keep their places and velocities.
   */
  setShown(mask: Uint8Array | null): void {
    const before = this.shown;
    let appeared = false;
    for (const n of this.nodes) {
      const was = !before || before[n.index] === 1;
      const now = !mask || mask[n.index] === 1;
      if (!now || was) continue;
      const near: [number, number][] = [];
      for (const x of this.adjacent[n.index]!) {
        const m = this.nodes[x.j]!;
        if ((!before || before[x.j]) && (!mask || mask[x.j])) near.push([m.x, m.y]);
      }
      if (near.length) [n.x, n.y] = seedPosition(n.id, near);
      else {
        const [sx, sy] = seedPosition(n.id, []);
        n.x = sx * 0.35;
        n.y = sy * 0.35;
      }
      n.vx = 0;
      n.vy = 0;
      appeared = true;
    }
    this.shown = mask ? Uint8Array.from(mask) : null;
    if (!mask) this.drift = null;
    this.shownList = mask ? this.nodes.filter((n) => mask[n.index]).map((n) => n.index) : null;
    if (appeared) {
      this.held = null;
      this.a = Math.max(this.a, SIM.appearAlpha);
    }
  }

  /**
   * Nodes arriving in a time-lapse, in the order given (an earlier one can
   * be the next one's neighbor); returns, for each, the node it was born
   * beside (-1: none). `live`: a node with a present neighbor is born beside
   * the one it belongs to (the one that owns it, else its best-linked
   * present neighbor), just past both radii, heading outward from the map's
   * center through that neighbor (turned a little, by its id's hash) at
   * `TIMELAPSE.birthSpeed`; the new link's spring then carries it out to the
   * link's length. A node with no present neighbor is born just outside the
   * cloud (its group's in Kind and Folder, else the map's: `loneEdge` times
   * the cloud's `loneQuantile` radius) and drifts inward about
   * `loneDriftDiameters` of its diameters (its speed set so the loose
   * damping, `loneDamping`, stops it there). Each arrival warms the layout
   * a little (`TIMELAPSE.arrivalKick`). Not `live` (not live): each
   * appears where it is, at rest, and nothing warms. Deterministic.
   */
  arrive(indices: readonly number[], live: boolean): number[] {
    const anchors: number[] = [];
    if (!indices.length) return anchors;
    const shown = (this.shown ??= new Uint8Array(this.nodes.length).fill(1));
    for (const i of indices) {
      const n = this.nodes[i];
      if (!n || shown[i]) {
        anchors.push(-1);
        continue;
      }
      n.vx = 0;
      n.vy = 0;
      n.fx = null;
      n.fy = null;
      if (this.drift) this.drift[i * 2] = this.drift[i * 2 + 1] = 0;
      let anchor: number | null = null;
      if (live) {
        anchor = this.birthAnchor(i, shown);
        const jitter = unit(`${n.id}#bd`) * TIMELAPSE.birthJitter;
        if (anchor !== null) {
          const m = this.nodes[anchor]!;
          const turn = (unit(`${n.id}#bs`) - 0.5) * 2 * TIMELAPSE.birthSpread;
          const ang = (m.x === 0 && m.y === 0 ? unit(`${n.id}#ba`) * Math.PI * 2 : Math.atan2(m.y, m.x)) + turn;
          const dist = m.r + n.r + TIMELAPSE.birthGap + jitter;
          const cx = Math.cos(ang);
          const cy = Math.sin(ang);
          n.x = m.x + cx * dist;
          n.y = m.y + cy * dist;
          n.vx = cx * TIMELAPSE.birthSpeed;
          n.vy = cy * TIMELAPSE.birthSpeed;
        } else this.bornAlone(n, shown, jitter);
      }
      anchors.push(anchor ?? -1);
      shown[i] = 1;
    }
    this.shownList = this.nodes.filter((m) => shown[m.index]).map((m) => m.index);
    this.held = null;
    if (live) this.a = Math.max(this.a, Math.min(TIMELAPSE.kickMax, Math.max(this.a, TIMELAPSE.playAlpha) + TIMELAPSE.arrivalKick * indices.length));
    return anchors;
  }

  /** A node with no present neighbor: just outside its cloud's edge, drifting inward (`arrive`). */
  private bornAlone(n: SimNode, shown: Uint8Array, jitter: number): void {
    // the cloud: its group's present members (Kind, Folder), else every present node
    const g = this.grouping.index[n.index] ?? -1;
    let cloud = g >= 0 ? this.grouping.list[g]!.members.filter((j) => shown[j]) : [];
    if (!cloud.length) cloud = this.nodes.filter((m) => shown[m.index]).map((m) => m.index);
    const ang = unit(`${n.id}#ba`) * Math.PI * 2;
    const cx = Math.cos(ang);
    const cy = Math.sin(ang);
    if (!cloud.length) {
      // the very first: at the center, a little off, at rest
      n.x = cx * (TIMELAPSE.birthLoneOffset + jitter);
      n.y = cy * (TIMELAPSE.birthLoneOffset + jitter);
      return;
    }
    let mx = 0;
    let my = 0;
    for (const j of cloud) {
      mx += this.nodes[j]!.x;
      my += this.nodes[j]!.y;
    }
    mx /= cloud.length;
    my /= cloud.length;
    const radii = cloud.map((j) => Math.hypot(this.nodes[j]!.x - mx, this.nodes[j]!.y - my)).sort((a, b) => a - b);
    const edge = radii[Math.min(radii.length - 1, Math.floor(TIMELAPSE.loneQuantile * (radii.length - 1)))]!;
    const travel = TIMELAPSE.loneDriftDiameters * 2 * n.r;
    // just outside the edge (never so near the center that the drift would cross it)
    const dist = Math.max(TIMELAPSE.loneEdge * edge, travel + 2 * n.r) + jitter;
    n.x = mx + cx * dist;
    n.y = my + cy * dist;
    // inward, as a drift of its own: shrinking by d each tick, a drift v covers v d / (1 - d) in all
    const d = TIMELAPSE.loneDamping;
    const v = (travel * (1 - d)) / d;
    const dr = (this.drift ??= new Float64Array(this.nodes.length * 2));
    dr[n.index * 2] = -cx * v;
    dr[n.index * 2 + 1] = -cy * v;
  }

  /** A node's drift (`arrive`: a lone newcomer's way in), x and y, units a tick. */
  driftOf(index: number): [number, number] {
    return this.drift ? [this.drift[index * 2]!, this.drift[index * 2 + 1]!] : [0, 0];
  }

  /** Nodes leaving the map (a time-lapse scrubbed back): hidden at once, at rest. */
  depart(indices: readonly number[]): void {
    if (!indices.length) return;
    const shown = (this.shown ??= new Uint8Array(this.nodes.length).fill(1));
    for (const i of indices) {
      const n = this.nodes[i];
      if (!n) continue;
      shown[i] = 0;
      n.vx = 0;
      n.vy = 0;
      if (this.drift) this.drift[i * 2] = this.drift[i * 2 + 1] = 0;
      n.fx = null;
      n.fy = null;
    }
    this.shownList = this.nodes.filter((m) => shown[m.index]).map((m) => m.index);
  }

  /** The present neighbor a new node is born beside: one that owns it, else the best linked; ties to the lower index. */
  private birthAnchor(i: number, shown: Uint8Array): number | null {
    let best: number | null = null;
    let bestOwner = false;
    for (const x of this.adjacent[i]!) {
      if (!shown[x.j]) continue;
      // x.out: the link starts at i. j owns i through has, contains or uses into i, or a made-from out of i
      const owner = x.type === "made-from" ? x.out : !x.out && (x.type === "has" || x.type === "contains" || x.type === "uses");
      if (best === null || (owner && !bestOwner) || (owner === bestOwner && (this.nodes[x.j]!.deg > this.nodes[best]!.deg || (this.nodes[x.j]!.deg === this.nodes[best]!.deg && x.j < best)))) {
        best = x.j;
        bestOwner = owner;
      }
    }
    return best;
  }

  /**
   * Pull by links, kind or folder: one continuous simulation. Positions and
   * velocities stay; the forces blend from the old grouping to the new over
   * `SIM.blendTicks`, and the layout warms to `SIM.modeReheat` so the nodes
   * drift into their new groups.
   */
  setPullBy(p: PullBy): void {
    if (p === this.mode) return;
    // a change while another blends: leave from where the forces are now (the nearer grouping)
    const leaving = this.from && this.blend < 0.5 ? this.from : { mode: this.mode, grouping: this.grouping };
    this.from = leaving;
    this.mode = p;
    this.grouping = this.groupBy(p);
    this.blend = 0;
    this.held = null;
    this.a = Math.max(this.a, SIM.modeReheat);
  }

  /** Raise alpha to at least `alpha` (a shake: `SIM.reheat`; a drag); the whole layout moves again. */
  reheat(alpha: number = SIM.reheat): void {
    this.held = null;
    this.a = Math.max(this.a, alpha);
  }

  /** Carry velocities and warmth over from an earlier simulation of the same project (a rebuild that changed the graph). */
  inherit(prev: AtlasSimulation<MapNode>): void {
    for (const n of this.nodes) {
      const i = prev.indexOf(n.id);
      if (i === undefined) continue;
      const p = prev.nodes[i]!;
      n.vx = p.vx;
      n.vy = p.vy;
    }
    if (prev.active) this.reheat(Math.max(prev.alpha, SIM.alphaMin * 2));
    this.alphaTarget = prev.alphaTarget;
  }

  /** Stop at once (a time-lapse that is not live; a test). */
  cool(): void {
    this.a = 0;
    this.steer = null;
    for (const n of this.nodes) {
      n.vx = 0;
      n.vy = 0;
    }
  }

  /** Hold a node at (x, y) (a drag). */
  pin(id: string, x: number, y: number): void {
    const i = this.byId.get(id);
    if (i === undefined) return;
    this.nodes[i]!.fx = x;
    this.nodes[i]!.fy = y;
  }

  /** Let a node go: it keeps its place and the physics moves it from there (no jump). */
  release(id: string): void {
    const i = this.byId.get(id);
    if (i === undefined) return;
    const n = this.nodes[i]!;
    n.fx = null;
    n.fy = null;
    n.vx = 0;
    n.vy = 0;
  }

  neighbors(id: string): Neighbor[] {
    const i = this.byId.get(id);
    if (i === undefined) return [];
    return this.adjacent[i]!.map((x) => ({ id: this.nodes[x.j]!.id, type: x.type, out: x.out }));
  }

  /** Neighbor indices of a node (the renderer's focus set). */
  neighborIndices(index: number): number[] {
    return (this.adjacent[index] ?? []).map((x) => x.j);
  }

  /** The indices (into `edges`) of a node's links. */
  edgesOf(index: number): readonly number[] {
    return (this.adjacent[index] ?? []).map((x) => x.e);
  }

  /** The groups pulled together, in order of first member; empty in Links mode. (The simulation's own lists: read only.) */
  groups(): readonly { readonly key: string; readonly members: readonly number[] }[] {
    return this.grouping.list;
  }

  /** Every node's position, rounded to integers (what is saved). */
  positions(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const n of this.nodes) out[n.id] = [Math.round(n.x), Math.round(n.y)];
    return out;
  }

  /** Every node's position as it is (what a reload starts from). */
  livePositions(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const n of this.nodes) out[n.id] = [n.x, n.y];
    return out;
  }

  /**
   * Whether a save is due: a node without a saved position, one more than
   * `eps` from it, or a saved id the graph no longer holds (so the file
   * forgets removed files).
   */
  changedSince(saved: Record<string, readonly [number, number]> | undefined, eps = 1): boolean {
    if (!saved) return this.nodes.length > 0;
    let held = 0;
    for (const n of this.nodes) {
      const at = saved[n.id];
      if (!at) return true;
      held++;
      if (Math.abs(at[0] - n.x) > eps || Math.abs(at[1] - n.y) > eps) return true;
    }
    return Object.keys(saved).length !== held;
  }
}
