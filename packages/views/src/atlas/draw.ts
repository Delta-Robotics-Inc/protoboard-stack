/**
 * Drawing the Atlas on a 2D canvas, and hit-testing it (no React, no DOM
 * beyond the context it is given, so the tests draw on a recording fake).
 *
 * A frame: the dot grid; the links (by default only the core ones, see
 * below; made-from dashed); the focused nodes' links in the accent on top;
 * the nodes, each a hexagon by default (or the shape chosen for its kind,
 * Appearance) in its kind's color (an unlinked file, one the census calls
 * unlinked, hollow with a dashed outline; in high contrast every node is an
 * outline); the hover and selection outlines; the labels. The minimap is
 * drawn on a canvas of its own (`drawMinimap`).
 *
 * Links: the core links are drawn always: in Links the structure (`has`,
 * `contains`), in Kind and Folder the links within a group (`isCoreLink`).
 * "All links" (`allLinks`) adds the rest as a thinner, muted web. A hovered
 * or selected node's links are all drawn in the accent, whatever the
 * toggle. The physics uses every link either way.
 *
 * Highlight: the hovered node keeps its color and gets an accent outline in
 * its own shape, just outside it (the selected node a slightly wider,
 * thicker one); its links turn the accent, its direct neighbors stay lit and
 * everything else dims (to `DIM`). Orange (the accent) is for the hover and
 * the selection only. The dimming eases with time constant `HOVER.dimTauMs`
 * and back to rest with `HOVER.restoreTauMs`; the outline comes in within
 * `HOVER.accentInMs` and goes with the restore (hover.ts: exponential, real
 * elapsed time); hover intent holds the dimming a moment when the pointer
 * leaves a node (`HOVER.holdMs`) so a sweeping pointer does not flicker.
 * The highlight's fade always runs: it is not tied to the system's
 * reduced-motion setting.
 *
 * Labels (labels.ts) come in zoom tiers: far out and in the middle, only
 * the titles of groups large enough on screen (the kind in Kind, the
 * folder's last segment in Folder, a module's cluster in Links), centered on
 * the group far out and above it closer in; close in, file labels fade in,
 * muted, as a node's on-screen radius grows across a bounded range. A label
 * sits to the right of its node, vertically centered, on a backing plate in
 * the canvas color; at the closest tier (or on the focus) a boxed chip
 * follows the name (the version, else the extension). The hovered or
 * selected node is always labeled, whole, in the accent; search matches too.
 * Labels are placed greedily in screen space by priority (larger group or
 * higher degree first), never over each other or the floating panels
 * (`reserved`). Widths are measured once per text and font, and only for
 * labels that may be drawn.
 *
 * A node the simulation does not show (a time-lapse that has not reached
 * it) is neither drawn, labeled nor hit, and neither are its links. While a
 * time-lapse runs (timelapse.ts) each node is drawn at its arrival's opacity
 * and scale (`vis`, `scale`: the fade, the pop and its size for the links
 * shown so far) and each link at its opacity (`linkVis`: full length,
 * fading in).
 *
 * The same renderer draws the System Map (sysmap/): its graph is any
 * `MapGraph` (graph.ts), its vocabulary a `MapSpec` (`spec`: kind names,
 * group titles), each node's look its own (`look`: filled, hollow dashed,
 * hollow solid), and `mark` rings the nodes a view points out (the System
 * Map's "Show changes": an outer outline in the text color; the rest dims as
 * for a search, which wins while one is typed).
 */
import { isUnlinkedFile } from "@protoboardai/core/atlas";
import { toScreen, toWorld, type Camera } from "./camera.js";
import type { PullBy } from "./data.js";
import { Ease, HOVER, HoverIntent } from "./hover.js";
import { LABEL_MAX_CHARS, LABEL_TIER, chipShown, chipText, fileLabelAlpha, folderTitles, groupTitled, labelPriority, placeLabels, titleAbove, truncateLabel, truncatePath, type LabelBox, type LabelCandidate } from "./labels.js";
import { ATLAS_SPEC, type MapNode, type MapSpec, type NodeLook } from "./graph.js";
import { nodeColor, type AtlasPalette, type Shape } from "./palette.js";
import { BASE_RADIUS, type AtlasSimulation, type SimEdge, type SimNode } from "./sim.js";

/** A group label's eased place (graph units: its center), its width and text height in CSS pixels, and whether the last frame drew it. */
export interface GroupLabel {
  x: number;
  y: number;
  wpx: number;
  hpx: number;
  shown: boolean;
}

export interface DrawState {
  sim: AtlasSimulation<MapNode>;
  /** The graph's vocabulary (kind names, group titles); the Atlas's by default. */
  spec: MapSpec;
  /** Nodes a view points out (the System Map's changes), ringed in the text color, the rest dimmed; null: none. */
  mark: Uint8Array | null;
  cam: Camera;
  /** The canvas's size in CSS pixels, and its device pixel ratio. */
  w: number;
  h: number;
  dpr: number;
  pullBy: PullBy;
  hover: number | null;
  selected: number | null;
  /** A selected group: "kind:<kind>", "folder:<folder>", or "unlinked". */
  group: string | null;
  query: string;
  /** Each node's drawn opacity, easing toward 1 (lit) or `DIM` (dimmed). */
  alpha: Float32Array;
  /** Each node's outline (0 to 1), easing toward 1 for the hovered and the selected node: its outline and its links in the accent. */
  accent: Float32Array;
  highContrast: boolean;
  /** Draw every link (else the core ones only, plus the focus's). */
  allLinks: boolean;
  /** A time-lapse's look (null outside one): each node's opacity and scale, each link's opacity. */
  vis: Float32Array | null;
  scale: Float32Array | null;
  linkVis: Float32Array | null;
  /** The clock of the last frame drawn (ms); not finite after the loop idled (the next frame then counts as one frame). */
  time: number;
  /** The eased values behind `alpha` and `accent`, and which node drives the dimming. */
  fade: { alpha: Ease; accent: Ease };
  intent: HoverIntent;
  /** Group labels as last drawn (what `hitGroupLabel` tests). */
  labels: Map<string, GroupLabel>;
  /** Label widths in CSS pixels, by font and text (each measured once). */
  widths: Map<string, number>;
  /** Screen boxes no label may cover: the panels and the minimap floating over the canvas. */
  reserved: LabelBox[];
  /** The search's matches, kept while the query is the same. */
  lit?: { query: string; nodes: Uint8Array };
  /** Each node's look (0 filled, 1 hollow dashed, 2 hollow solid: `nodeLook`), worked out once per graph. */
  loose?: Uint8Array;
  /** Scratch: the focus's neighborhood and a selected group's members (reused, frame to frame). */
  near?: Uint8Array;
  inGroup?: Uint8Array;
}

/** How far a node away from the focus, the selected group or the search dims. */
export const DIM = 0.12;
/** Below this opacity a time-lapse's arriving node is not drawn, labeled or hit yet. */
const VIS_MIN = 0.02;
/** One frame at 60 frames a second: the clock's step when a frame is drawn without one (the tests), or the first after the loop idled. */
export const FRAME_MS = 1000 / 60;
/** The longest step the highlight takes in one frame (a stalled tab does not jump to the end). */
const MAX_STEP_MS = 100;
/**
 * The hover and selection outlines: on screen, how far outside the node's
 * own outline (`r` plus this many CSS pixels) and how thick.
 */
export const OUTLINE = { hover: { gap: 2.5, width: 1.5 }, selected: { gap: 3.5, width: 2 }, mark: { gap: 3.2, width: 1.6 } } as const;
const LABEL_PX = 11.5;
const TITLE_FAR_PX = 13;
const NODE_LABEL_PX = 10.5;
const FOCUS_LABEL_PX = 12;
const CHIP_PX = 9.5;
/** The label's backing plate: the canvas color at this opacity. */
const PLATE_ALPHA = 0.82;
/** How far right of its center a shape reaches, in radii (a hexagon's side vertex, a dot's edge): a label starts 5 px past it. */
const REACH: Record<Shape, number> = { hex: 1.12 * Math.cos(Math.PI / 6), dot: 1, square: 0.92, diamond: 1.15 };

export function createDrawState(sim: AtlasSimulation<MapNode>, init: Partial<Omit<DrawState, "sim">> = {}): DrawState {
  const n = sim.nodes.length;
  const fade = { alpha: new Ease(n, 1), accent: new Ease(n, 0) };
  return {
    sim,
    spec: ATLAS_SPEC,
    mark: null,
    cam: { x: 0, y: 0, k: 1, tx: 0, ty: 0, tk: 1 },
    w: 1,
    h: 1,
    dpr: 1,
    pullBy: sim.pullBy,
    hover: null,
    selected: null,
    group: null,
    query: "",
    alpha: fade.alpha.value,
    accent: fade.accent.value,
    highContrast: false,
    allLinks: false,
    vis: null,
    scale: null,
    linkVis: null,
    time: 0,
    fade,
    intent: new HoverIntent(),
    labels: new Map(),
    widths: new Map(),
    reserved: [],
    ...init,
  };
}

/**
 * An unlinked file, as the census counts them: no artifact, folder artifact
 * or operation record points to it (core's `isUnlinkedFile`). A file an
 * operation produced but no module names is linked, though it has no link
 * on the map.
 */
export const isLooseFile = (n: MapNode): boolean => isUnlinkedFile(n as unknown as Parameters<typeof isUnlinkedFile>[0]);

/** How a node is drawn: its own `look`, else the Atlas's rule (an unlinked file hollow and dashed, the rest filled). */
export const nodeLook = (n: MapNode): NodeLook => n.look ?? (isLooseFile(n) ? "dashed" : "fill");

const LOOK_CODE: Record<NodeLook, number> = { fill: 0, dashed: 1, hollow: 2 };

function looseNodes(s: DrawState): Uint8Array {
  if (s.loose?.length === s.sim.nodes.length) return s.loose;
  const loose = new Uint8Array(s.sim.nodes.length);
  s.sim.source.forEach((n, i) => {
    loose[i] = LOOK_CODE[nodeLook(n)];
  });
  return (s.loose = loose);
}

/**
 * A core link, drawn whatever "All links" says: in Links the structure (a
 * definition's artifacts and a folder's files, `has`; a module's child
 * modules, `contains`); in Kind and Folder a link whose two ends are in one
 * group.
 */
export function isCoreLink(sim: AtlasSimulation<MapNode>, pullBy: PullBy, e: Pick<SimEdge, "s" | "t" | "type">): boolean {
  if (pullBy === "links") return e.type === "has" || e.type === "contains";
  const a = sim.nodes[e.s]!;
  const b = sim.nodes[e.t]!;
  return pullBy === "kind" ? a.kind === b.kind : a.folder === b.folder;
}

/** Whether a node answers a search: its label, its path, or its kind's name (and what the spec adds: the System Map's purposes). */
export function matches(node: Pick<MapNode, "label" | "path" | "kind">, query: string, spec: MapSpec = ATLAS_SPEC): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const kind = spec.kind(node.kind);
  if (node.label.toLowerCase().includes(q) || (node.path ?? "").toLowerCase().includes(q)) return true;
  if (kind && (kind.label.toLowerCase().includes(q) || kind.one.toLowerCase().includes(q))) return true;
  return !!spec.searchText && spec.searchText(node as MapNode).toLowerCase().includes(q);
}

/** What a group is called in the inspector and the tooltip: a kind's name, a folder's whole path (the spec's: an island's name). */
export function groupName(key: string, spec: MapSpec = ATLAS_SPEC): string {
  return spec.groupName(key);
}

/** The node indices of a group key ("kind:render", "folder:docs", "unlinked"). */
export function groupMembers(sim: AtlasSimulation<MapNode>, key: string): number[] {
  if (key === "unlinked") return sim.nodes.filter((n) => isLooseFile(sim.source[n.index]!)).map((n) => n.index);
  const at = key.indexOf(":");
  const type = key.slice(0, at);
  const value = key.slice(at + 1);
  return sim.nodes.filter((n) => (type === "kind" ? n.kind : n.folder) === value).map((n) => n.index);
}

/** The minimap's size in CSS pixels (its own canvas, in a floating panel). */
export const MINIMAP = { w: 132, h: 84 } as const;

/** A node's outline as the current path: a hexagon (pointed top and bottom), a rounded square, a diamond or a dot. */
export function shapePath(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number): void {
  ctx.beginPath();
  if (shape === "dot") {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === "square") {
    const q = r * 0.92;
    const rr = r * 0.32;
    ctx.moveTo(x - q + rr, y - q);
    ctx.arcTo(x + q, y - q, x + q, y + q, rr);
    ctx.arcTo(x + q, y + q, x - q, y + q, rr);
    ctx.arcTo(x - q, y + q, x - q, y - q, rr);
    ctx.arcTo(x - q, y - q, x + q, y - q, rr);
    ctx.closePath();
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - r * 1.15);
    ctx.lineTo(x + r * 1.15, y);
    ctx.lineTo(x, y + r * 1.15);
    ctx.lineTo(x - r * 1.15, y);
    ctx.closePath();
  } else {
    for (let i = 0; i < 6; i++) {
      const a = i * (Math.PI / 3) + Math.PI / 6;
      const px = x + Math.cos(a) * r * 1.12;
      const py = y + Math.sin(a) * r * 1.12;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
}

function litNodes(s: DrawState, q: string): Uint8Array {
  if (s.lit?.query === q) return s.lit.nodes;
  const nodes = new Uint8Array(s.sim.nodes.length);
  s.sim.source.forEach((n, i) => {
    nodes[i] = matches(n, q, s.spec) ? 1 : 0;
  });
  s.lit = { query: q, nodes };
  return nodes;
}

const scratch = (s: DrawState, key: "near" | "inGroup"): Uint8Array => {
  const n = s.sim.nodes.length;
  const a = s[key];
  if (a && a.length === n) return a.fill(0);
  return (s[key] = new Uint8Array(n));
};

/**
 * Draw one frame at `now` (ms, the animation frame's clock; one 60 Hz frame
 * after the last when absent); true while something is still easing or
 * waiting (the highlight, the hover's delay or hold, a group label).
 */
export function drawAtlas(ctx: CanvasRenderingContext2D, s: DrawState, p: AtlasPalette, now?: number): boolean {
  const { sim, cam: c, w: W, h: H, dpr } = s;
  const k = c.k;
  const nodes = sim.nodes;
  const vis = s.vis;
  const shown = (i: number) => sim.isShown(i) && (!vis || vis[i]! > VIS_MIN);
  const last = Number.isFinite(s.time) ? s.time : null;
  const t = now ?? (last ?? 0) + FRAME_MS;
  // real elapsed time (one frame's worth after an idle loop restarts)
  const dt = last === null || !(t > last) ? FRAME_MS : Math.min(t - last, MAX_STEP_MS);
  s.time = t;
  let easing = false;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.canvas;
  ctx.fillRect(0, 0, W, H);

  // the dot grid, in screen space
  let step = 22 * k;
  while (step < 14) step *= 2;
  const ox = (((W / 2 - c.x * k) % step) + step) % step;
  const oy = (((H / 2 - c.y * k) % step) + step) % step;
  ctx.fillStyle = p.canvasDot;
  for (let gx = ox; gx < W; gx += step) for (let gy = oy; gy < H; gy += step) ctx.fillRect(gx - 1, gy - 1, 2, 2);

  ctx.translate(W / 2, H / 2);
  ctx.scale(k, k);
  ctx.translate(-c.x, -c.y);

  // what is on screen (graph units), with room for outlines and labels
  const margin = 60 / k;
  const vx0 = c.x - W / 2 / k - margin;
  const vx1 = c.x + W / 2 / k + margin;
  const vy0 = c.y - H / 2 / k - margin;
  const vy1 = c.y + H / 2 / k + margin;
  const visible = (n: SimNode) => n.x >= vx0 && n.x <= vx1 && n.y >= vy0 && n.y <= vy1;

  // the pointer's node and the selection answer at once (outline, label); the dimming follows hover intent
  const hovered = s.hover !== null && shown(s.hover) ? s.hover : null;
  const sel = s.selected !== null && shown(s.selected) ? s.selected : null;
  const focus = hovered ?? sel;
  // the highlight's easing always runs (never tied to reduced motion)
  const intent = s.intent.update(hovered, sel, t, false);
  if (intent.waiting) easing = true;
  const dimFocus = intent.focus !== null && shown(intent.focus) ? intent.focus : null;
  const q = s.query.trim().toLowerCase();
  let near: Uint8Array | null = null;
  let inGroup: Uint8Array | null = null;
  if (dimFocus !== null) {
    near = scratch(s, "near");
    near[dimFocus] = 1;
    for (const j of sim.neighborIndices(dimFocus)) near[j] = 1;
  } else if (s.group) {
    inGroup = scratch(s, "inGroup");
    for (const i of groupMembers(sim, s.group)) inGroup[i] = 1;
  }
  // a search's matches, else the nodes the view points out (Show changes)
  const lit = q ? litNodes(s, q) : s.mark && s.mark.length === nodes.length ? s.mark : null;
  const dimmed = !!(near || inGroup || lit);

  // the highlight: each node's opacity and outline ease toward their targets (exponential, real time); the nodes with any outline are few
  const fadeTau = dimmed ? HOVER.dimTauMs : HOVER.restoreTauMs;
  const accented: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const on = lit ? !!lit[i] : near ? !!near[i] : inGroup ? !!inGroup[i] : true;
    const a = on ? 1 : DIM;
    const ac = i === hovered || i === sel ? 1 : 0;
    if (s.fade.alpha.step(i, a, dt, fadeTau)) easing = true;
    if (s.fade.accent.step(i, ac, dt, ac ? HOVER.accentInMs / 3 : HOVER.restoreTauMs)) easing = true;
    if (s.accent[i]! > 0) accented.push(i);
  }

  // links: the muted web (All links) under the core ones (fainter while grouped), then the focused nodes' in the accent on top
  ctx.strokeStyle = p.textMuted;
  const g = sim.groupedness;
  const baseA = (0.62 + (0.3 - 0.62) * g) * (dimmed ? 0.35 : 1);
  let dashed = false;
  for (const pass of s.allLinks ? [false, true] : [true]) {
    ctx.lineWidth = (pass ? 1 : 0.6) / k;
    for (let ei = 0; ei < sim.edges.length; ei++) {
      const e = sim.edges[ei]!;
      if (!shown(e.s) || !shown(e.t)) continue;
      if (isCoreLink(sim, s.pullBy, e) !== pass) continue;
      const lv = linkIn(s, ei);
      if (!lv) continue;
      const a = nodes[e.s]!;
      const b = nodes[e.t]!;
      if ((a.x < vx0 && b.x < vx0) || (a.x > vx1 && b.x > vx1) || (a.y < vy0 && b.y < vy0) || (a.y > vy1 && b.y > vy1)) continue;
      const la = Math.min(s.alpha[e.s]!, s.alpha[e.t]!);
      ctx.globalAlpha = baseA * (la < 0.5 ? la * 0.6 : la) * (pass ? 1 : 0.45) * lv;
      const dash = e.type === "made-from";
      if (dash !== dashed) {
        ctx.setLineDash(dash ? [3 / k, 3 / k] : []);
        dashed = dash;
      }
      line(ctx, a, b);
    }
  }
  ctx.setLineDash([]);
  if (accented.length) {
    ctx.strokeStyle = p.accent;
    for (const i of accented) {
      const mix = s.accent[i]!;
      // every link of a hovered or selected node, core or not
      for (const ei of sim.edgesOf(i)) {
        const e = sim.edges[ei]!;
        if (!shown(e.s) || !shown(e.t)) continue;
        const lv = linkIn(s, ei);
        if (!lv) continue;
        const a = nodes[e.s]!;
        const b = nodes[e.t]!;
        // the halo, then the line
        ctx.globalAlpha = 0.26 * mix * lv;
        ctx.lineWidth = 6 / k;
        line(ctx, a, b);
        ctx.globalAlpha = 0.95 * mix * lv;
        ctx.lineWidth = 1.6 / k;
        if (e.type === "made-from") ctx.setLineDash([4 / k, 3 / k]);
        line(ctx, a, b);
        ctx.setLineDash([]);
      }
    }
  }

  // nodes: each in its own color whatever the highlight; the hover and the selection add an accent outline in the node's shape
  const loose = looseNodes(s);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (!shown(i) || !visible(n)) continue;
    const color = nodeColor(p, n);
    const shape = p.shapes[n.kind];
    // a time-lapse's arrival: its fade and its pop
    const fadeV = vis ? vis[i]! : 1;
    const r = n.r * (s.scale ? Math.max(0, s.scale[i]!) : 1);
    if (r <= 0.01) continue;
    ctx.globalAlpha = s.alpha[i]! * fadeV;
    shapePath(ctx, shape, n.x, n.y, r);
    if (loose[i]) {
      // hollow: dashed (an unlinked file, unreleased work) or solid (outside this repository)
      ctx.fillStyle = p.canvas;
      ctx.fill();
      ctx.lineWidth = 1.4 / k;
      ctx.strokeStyle = color;
      if (loose[i] === 1) ctx.setLineDash([2.5 / k, 2 / k]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (s.highContrast) {
      ctx.fillStyle = p.canvas;
      ctx.fill();
      ctx.lineWidth = 1.6 / k;
      ctx.strokeStyle = color;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (s.mark?.[i]) {
      // pointed out (Show changes): an outer outline in the text color
      ctx.globalAlpha = s.alpha[i]! * fadeV;
      shapePath(ctx, shape, n.x, n.y, r + OUTLINE.mark.gap / k);
      ctx.lineWidth = OUTLINE.mark.width / k;
      ctx.strokeStyle = p.text;
      ctx.stroke();
    }
    const mix = s.accent[i]!;
    if (mix > 0) {
      const o = i === s.selected ? OUTLINE.selected : OUTLINE.hover;
      ctx.globalAlpha = mix * s.alpha[i]! * fadeV;
      shapePath(ctx, shape, n.x, n.y, r + o.gap / k);
      ctx.lineWidth = o.width / k;
      ctx.strokeStyle = p.accent;
      ctx.stroke();
    }
  }

  // labels, in screen space: the candidates, placed greedily (labels.ts), then drawn
  ctx.globalAlpha = 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const candidates: LabelCandidate<Label>[] = [];
  const seen = new Set<string>();

  // group titles (Kind, Folder): on each group large enough on screen far out, above it closer in, easing after it (always measured: hit areas too)
  const above = titleAbove(BASE_RADIUS.file * k);
  const titlePx = above ? LABEL_PX : TITLE_FAR_PX;
  const groupFont = `600 ${titlePx}px ${p.font}`;
  type Titled = { key: string; value: string; gx: number; gy: number; count: number };
  const titled: Titled[] = [];
  for (const grp of sim.groups()) {
    const key = `${s.pullBy}:${grp.key}`;
    let count = 0;
    let top = Infinity;
    let x0 = Infinity;
    let x1 = -Infinity;
    let bottom = -Infinity;
    for (const i of grp.members) {
      if (!shown(i)) continue;
      const n = nodes[i]!;
      count++;
      if (n.y - n.r < top) top = n.y - n.r;
      if (n.y + n.r > bottom) bottom = n.y + n.r;
      if (n.x - n.r < x0) x0 = n.x - n.r;
      if (n.x + n.r > x1) x1 = n.x + n.r;
    }
    if (!count) continue;
    const span = Math.max(x1 - x0, bottom - top) * k;
    if (!groupTitled(span) && s.group !== key && !s.spec.titleAll) continue;
    titled.push({ key, value: grp.key, gx: (x0 + x1) / 2, gy: above ? top - (titlePx / 2 + 6) / k : (top + bottom) / 2, count });
  }
  const folders = s.pullBy === "folder" && s.spec.folderTitles === "paths" ? folderTitles(titled.map((t) => t.value)) : null;
  for (const tt of titled) {
    seen.add(tt.key);
    let label = s.labels.get(tt.key);
    if (!label) {
      label = { x: tt.gx, y: tt.gy, wpx: 0, hpx: titlePx, shown: false };
      s.labels.set(tt.key, label);
    }
    if (Math.abs(label.x - tt.gx) + Math.abs(label.y - tt.gy) > 0.4) easing = true;
    label.x += (tt.gx - label.x) * 0.12;
    label.y += (tt.gy - label.y) * 0.12;
    label.hpx = titlePx;
    label.shown = false;
    const f = folders?.get(tt.value);
    const parent = f ? f.parent.toUpperCase() : "";
    const name = f ? (f.leaf ? truncatePath(f.leaf.toUpperCase(), GROUP_MAX_CHARS) : "(PROJECT FOLDER)") : truncatePath(groupName(tt.key, s.spec).toUpperCase(), GROUP_MAX_CHARS);
    const count = `  ${tt.count}`;
    const w0 = parent ? measure(ctx, s, groupFont, parent) : 0;
    const w1 = measure(ctx, s, groupFont, name);
    label.wpx = w0 + w1 + measure(ctx, s, groupFont, count);
    const [cx, cy] = toScreen(c, label.x, label.y, W, H);
    if (cx + label.wpx / 2 < 0 || cx - label.wpx / 2 > W || cy + titlePx / 2 < 0 || cy - titlePx / 2 > H) continue;
    const on = s.group === tt.key;
    const box = { x0: cx - label.wpx / 2 - 3, y0: cy - titlePx / 2 - 2, x1: cx + label.wpx / 2 + 3, y1: cy + titlePx / 2 + 2 };
    candidates.push({
      priority: labelPriority(on ? LABEL_TIER.focus : LABEL_TIER.group, false, tt.count),
      anchor: box,
      box: () => box,
      item: {
        group: label,
        font: groupFont,
        parent,
        w0,
        name,
        count,
        w1,
        x: cx - label.wpx / 2,
        y: cy,
        alpha: dimmed && !on ? 0.45 : 1,
        color: on ? p.accentHover : s.pullBy === "kind" && p.byType ? p.kinds[tt.value as SimNode["kind"]] : p.text,
      },
    });
  }
  for (const key of [...s.labels.keys()]) if (!seen.has(key)) s.labels.delete(key);

  // node labels: the focus, the search's matches, a module's cluster title (Links), then files by zoom
  const links = s.pullBy === "links";
  const chipFont = `${CHIP_PX}px ${p.font}`;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (!shown(i) || !visible(n)) continue;
    const hub = n.hub;
    const isFocus = i === focus;
    const matched = !!lit && !!lit[i] && s.alpha[i]! > 0.5;
    const rpx = n.r * k;
    const fileA = fileLabelAlpha(rpx);
    // in Links, a module whose cluster is large enough on screen is titled like a group
    const cluster = links && hub && !isFocus && !matched && fileA < 1 && groupTitled(clusterSpan(sim, i) * k);
    let tier = 0;
    let alpha = 0;
    if (isFocus) {
      tier = LABEL_TIER.focus;
      alpha = 1;
    } else if (matched) {
      tier = LABEL_TIER.near;
      alpha = 1;
    } else if (cluster) {
      tier = LABEL_TIER.group;
      alpha = Math.max(0.85, fileA) * s.alpha[i]!;
    } else if (fileA > 0) {
      tier = near?.[i] ? LABEL_TIER.near : inGroup?.[i] ? LABEL_TIER.member : LABEL_TIER.rest;
      alpha = fileA * s.alpha[i]!;
    }
    if (vis) alpha *= vis[i]!;
    if (!tier || alpha < 0.05) continue;
    const src = sim.source[i]!;
    const full = src.label;
    // the hovered or selected node's whole name; the others cut short
    const shownText = isFocus ? full : truncateLabel(full, LABEL_MAX_CHARS);
    const text = hub ? shownText.toUpperCase() : shownText;
    const px = isFocus ? FOCUS_LABEL_PX : hub ? LABEL_PX : NODE_LABEL_PX;
    const font = `${hub || isFocus ? "600 " : ""}${px}px ${p.font}`;
    // a pointed-out node (Show changes) carries its chip at every zoom: it says what changed
    const chip = chipShown(rpx, isFocus) || (!!s.mark?.[i] && !q) ? chipText(src) : "";
    const [sx, sy] = toScreen(c, n.x, n.y, W, H);
    // beside the node: 5 px past its right side, centered on it
    const lx = sx + rpx * REACH[p.shapes[n.kind]] + 5;
    const nameBox = (w: number) => ({ x0: lx - 3, y0: sy - px / 2 - 2, x1: lx + w + 3, y1: sy + px / 2 + 2 });
    candidates.push({
      priority: labelPriority(tier, hub, cluster ? sim.neighborIndices(i).length : n.deg),
      anchor: { x0: lx, y0: sy - px / 2, x1: lx + 2, y1: sy + px / 2 },
      box: () => {
        const w = measure(ctx, s, font, text);
        const b = nameBox(w);
        if (!chip) return b;
        const cw = measure(ctx, s, chipFont, chip);
        return { x0: b.x0, y0: Math.min(b.y0, sy - 7), x1: lx + w + 6 + cw + 3, y1: Math.max(b.y1, sy + 7) };
      },
      alt: chip ? () => nameBox(measure(ctx, s, font, text)) : undefined,
      // files fade in muted; the modules in the text color; the focus in the accent
      item: { text, font, chip, x: lx, y: sy, px, alpha, color: isFocus ? p.accentHover : hub ? p.text : p.textMuted },
    });
  }

  let font = "";
  for (const { item, alt } of placeLabels(candidates, s.reserved)) {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if ("group" in item) {
      item.group.shown = true;
      if (font !== item.font) ctx.font = font = item.font;
      plate(ctx, p, item.alpha, item.x - 3, item.y - item.group.hpx / 2 - 2, item.group.wpx + 6, item.group.hpx + 4);
      ctx.globalAlpha = item.alpha;
      if (item.parent) {
        // a parent folder, only to tell two folders of one name apart: dimmer
        ctx.fillStyle = p.textFaint;
        ctx.fillText(item.parent, item.x, item.y);
      }
      ctx.fillStyle = item.color;
      ctx.fillText(item.name, item.x + item.w0, item.y);
      ctx.fillStyle = p.textMuted;
      ctx.fillText(item.count, item.x + item.w0 + item.w1, item.y);
    } else {
      // (measured when it was placed: this reads the cache, and never sets the font)
      const w = measure(ctx, s, item.font, item.text);
      if (font !== item.font) ctx.font = font = item.font;
      plate(ctx, p, item.alpha, item.x - 3, item.y - item.px / 2 - 2, w + 6, item.px + 4);
      ctx.globalAlpha = item.alpha;
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, item.x, item.y);
      if (item.chip && !alt) {
        // the chip: boxed, after the name
        const cw = measure(ctx, s, chipFont, item.chip);
        const vx = item.x + w + 6;
        ctx.fillStyle = p.surface;
        ctx.fillRect(vx - 3, item.y - 7, cw + 6, 14);
        ctx.strokeStyle = p.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(vx - 3 + 0.5, item.y - 7 + 0.5, cw + 5, 13);
        if (font !== chipFont) ctx.font = font = chipFont;
        ctx.fillStyle = p.textMuted;
        ctx.fillText(item.chip, vx, item.y + 0.5);
      }
    }
  }
  ctx.globalAlpha = 1;
  return easing;
}

/** A link's opacity in a time-lapse (0: not started, not drawn); 1 outside one. */
function linkIn(s: DrawState, ei: number): number {
  return s.linkVis ? s.linkVis[ei]! : 1;
}

/** A link as a line, at full length. */
function line(ctx: CanvasRenderingContext2D, a: SimNode, b: SimNode): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** A label's backing plate: the canvas color, a little see-through, under the text. */
function plate(ctx: CanvasRenderingContext2D, p: AtlasPalette, alpha: number, x: number, y: number, w: number, h: number): void {
  ctx.globalAlpha = PLATE_ALPHA * alpha;
  ctx.fillStyle = p.canvas;
  ctx.fillRect(x, y, w, h);
}

/** How far a module's shown neighbors reach from it, both ways (graph units): its cluster's span. */
function clusterSpan(sim: AtlasSimulation<MapNode>, i: number): number {
  const n = sim.nodes[i]!;
  let far = n.r;
  for (const j of sim.neighborIndices(i)) {
    if (!sim.isShown(j)) continue;
    const m = sim.nodes[j]!;
    const d = Math.hypot(m.x - n.x, m.y - n.y) + m.r;
    if (d > far) far = d;
  }
  return far * 2;
}

/**
 * The minimap, on its own canvas (`w` by `h` CSS pixels): the links faint
 * (the core ones, or all of them with "All links"), every node a pixel in
 * its color (a module two; at this size no shape shows), and the view a
 * framed box in the accent. The panel around it is the view's (HTML).
 */
export function drawMinimap(ctx: CanvasRenderingContext2D, s: DrawState, p: AtlasPalette, w: number, h: number, dpr: number): void {
  const { sim, cam: c } = s;
  const nodes = sim.nodes;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.surface;
  ctx.fillRect(0, 0, w, h);
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let by0 = Infinity;
  let by1 = -Infinity;
  for (const n of nodes) {
    if (!sim.isShown(n.index)) continue;
    if (n.x < bx0) bx0 = n.x;
    if (n.x > bx1) bx1 = n.x;
    if (n.y < by0) by0 = n.y;
    if (n.y > by1) by1 = n.y;
  }
  if (!Number.isFinite(bx0)) return;
  const ms = Math.min((w - 14) / Math.max(bx1 - bx0, 1), (h - 14) / Math.max(by1 - by0, 1));
  const mox = w / 2 - ((bx0 + bx1) / 2) * ms;
  const moy = h / 2 - ((by0 + by1) / 2) * ms;
  // one CSS pixel on whole device pixels
  const px = Math.max(1, Math.round(dpr)) / dpr;
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = p.textFaint;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  for (const e of sim.edges) {
    if (!sim.isShown(e.s) || !sim.isShown(e.t)) continue;
    if (!s.allLinks && !isCoreLink(sim, s.pullBy, e)) continue;
    const a = nodes[e.s]!;
    const b = nodes[e.t]!;
    ctx.moveTo(mox + a.x * ms, moy + a.y * ms);
    ctx.lineTo(mox + b.x * ms, moy + b.y * ms);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  let fill = "";
  for (const n of nodes) {
    if (!sim.isShown(n.index)) continue;
    const color = nodeColor(p, n);
    if (color !== fill) ctx.fillStyle = fill = color;
    const d = n.hub ? px * 2 : px;
    ctx.fillRect(snap(mox + n.x * ms - d / 2), snap(moy + n.y * ms - d / 2), d, d);
  }
  // the view, kept inside the frame so its edges always show
  const vx0 = Math.max(2, mox + (c.x - s.w / 2 / c.k) * ms);
  const vy0 = Math.max(2, moy + (c.y - s.h / 2 / c.k) * ms);
  const vx1 = Math.min(w - 2, mox + (c.x + s.w / 2 / c.k) * ms);
  const vy1 = Math.min(h - 2, moy + (c.y + s.h / 2 / c.k) * ms);
  if (vx1 > vx0 && vy1 > vy0) {
    ctx.fillStyle = p.accent;
    ctx.globalAlpha = 0.07;
    ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = px;
    ctx.strokeRect(snap(vx0) + px / 2, snap(vy0) + px / 2, Math.max(px, snap(vx1 - vx0) - px), Math.max(px, snap(vy1 - vy0) - px));
  }
}

/** What a placed label draws: a node's name (and its chip), or a group's name (a folder's parent first, dimmer, when needed) and count. */
type Label =
  | { text: string; font: string; chip: string; x: number; y: number; px: number; alpha: number; color: string }
  | { group: GroupLabel; font: string; parent: string; w0: number; name: string; count: string; w1: number; x: number; y: number; alpha: number; color: string };

/** The longest group name drawn (a folder keeps its end). */
const GROUP_MAX_CHARS = 32;

/** A label's width in CSS pixels in `font`, measured once per font and text. */
function measure(ctx: CanvasRenderingContext2D, s: DrawState, font: string, text: string): number {
  const key = `${font}\u0000${text}`;
  let w = s.widths.get(key);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(text).width;
    s.widths.set(key, w);
  }
  return w;
}

/** The node under a canvas point (CSS pixels), reaching 5 pixels past its edge; the nearest wins. Hidden nodes are never hit. */
export function hitNode(s: DrawState, sx: number, sy: number): number | null {
  const [wx, wy] = toWorld(s.cam, sx, sy, s.w, s.h);
  const reachPx = 5 / s.cam.k;
  let best: number | null = null;
  let bd = Infinity;
  for (const n of s.sim.nodes) {
    if (!s.sim.isShown(n.index) || (s.vis && s.vis[n.index]! < 0.5)) continue;
    const d = Math.hypot(n.x - wx, n.y - wy);
    if (d < n.r + reachPx && d < bd) {
      bd = d;
      best = n.index;
    }
  }
  return best;
}

/** The group whose label is under a canvas point ("kind:render"), as last drawn. */
export function hitGroupLabel(s: DrawState, sx: number, sy: number): string | null {
  const [wx, wy] = toWorld(s.cam, sx, sy, s.w, s.h);
  const k = s.cam.k;
  for (const [key, l] of s.labels) {
    if (l.shown && Math.abs(wx - l.x) < l.wpx / k / 2 + 6 / k && Math.abs(wy - l.y) < (l.hpx / 2 + 5) / k) return key;
  }
  return null;
}
