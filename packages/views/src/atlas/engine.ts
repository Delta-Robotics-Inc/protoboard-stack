/**
 * The engine behind the Atlas view and the System Map: the simulation
 * (sim.ts), the camera (camera.ts), the canvases (draw.ts) and the pointer,
 * outside React, so a frame never re-renders anything. Moved out of
 * AtlasView.tsx so both views run the same one; AtlasView.tsx's header says
 * how it behaves.
 */
import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { readToken, tokenColor, useTheme } from "@deltarobotics/uhd-viewer/components";
import { fitTo, fling, newCamera, panBy, snapCamera, stepCamera, stopCamera, toScreen, wheelImpulse, zoomBy, ZOOM, type Camera, type FitInsets } from "./camera.js";
import type { PullBy } from "./data.js";
import { ATLAS_KIND_TABLE, lookOf, type AtlasAppearance, type KindTable } from "./appearance.js";
import { MINIMAP, createDrawState, drawAtlas, drawMinimap, groupMembers, groupName, hitGroupLabel, hitNode, type DrawState } from "./draw.js";
import { ATLAS_SPEC, type MapGraph, type MapNode, type MapSpec } from "./graph.js";
import type { LabelBox } from "./labels.js";
import { isHighContrast, paletteFrom, type AtlasPalette } from "./palette.js";
import { AtlasSimulation, SIM } from "./sim.js";
import type { Timeline, TimelapseSpeed } from "./timeline.js";
import { TimelapseRun } from "./timelapse.js";

/** Frames the loop keeps running once nothing moves (a little slack for a pointer about to move). */
export const IDLE_FRAMES = 40;
export const SAVE_DELAY_MS = 800;
export const FIT_PAD = 46;
export const CLICK_SLOP = 4;
/** How long a click waits before it slides its node into view: past a double-click's second click. */
export const REVEAL_DELAY_MS = 350;
/** The canvas width from which a fit keeps clear of the side panels. */
export const WIDE = 900;
/** The inspector card's width plus its inset (a fit made before the card shows keeps clear of it). */
export const CARD_W = 304;
/** Room above a group for its title (Kind and Folder). */
export const GROUP_LABEL_H = 22;
/** A pan let go after the pointer rested this long does not fling; the pointer's speed is measured over this window. */
export const FLING_REST_MS = 80;
export const FLING_WINDOW_MS = 100;

/** The colors the canvas draws with, resolved on `el` (inside the themed root) whenever the theme or the appearance changes. */
export function useAtlasPalette(el: HTMLElement | null, appearance: AtlasAppearance, table: KindTable = ATLAS_KIND_TABLE): AtlasPalette {
  const { theme } = useTheme();
  return useMemo(
    () => paletteFrom((t) => tokenColor(el, t, theme.tokens[t]), (el && readToken(el, "fontMono")) || theme.tokens.fontMono, isHighContrast(theme), lookOf(appearance, table)),
    [el, theme, appearance, table],
  );
}

export interface Session {
  pullBy?: PullBy;
  cam?: { x: number; y: number; k: number };
}

/** Per tab (session storage): the Atlas per project, the System Map under its own name. */
export const sessionKey = (project: string) => `protoboard.atlas:${project}`;

export function readSession(project: string, key: string = sessionKey(project)): Session | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    const v = raw ? (JSON.parse(raw) as Session) : null;
    if (!v || typeof v !== "object") return null;
    const pullBy = v.pullBy === "links" || v.pullBy === "kind" || v.pullBy === "folder" ? v.pullBy : undefined;
    const c = v.cam;
    const cam = c && [c.x, c.y, c.k].every((n) => typeof n === "number" && Number.isFinite(n)) ? { x: c.x, y: c.y, k: Math.max(ZOOM.min, Math.min(ZOOM.max, c.k)) } : undefined;
    return { pullBy, cam };
  } catch {
    return null;
  }
}

export function writeSession(project: string, s: Session, key: string = sessionKey(project)) {
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(s));
  } catch {
    // storage refused (a sandboxed webview): the tab just forgets
  }
}

/** Where the time-lapse is, for the controls (the engine writes it to the DOM directly while it plays: no React per frame). */
export interface PlaybackState {
  /** The playback clock (ms at 1x since play: the scrubber). */
  ms: number;
  /** The calendar date it has reached (ms since the epoch). */
  date: number;
  playing: boolean;
  /** How many nodes have arrived. */
  shown: number;
}

export interface EngineEvents {
  /** A node (by id) or nothing was clicked. */
  pick(id: string | null): void;
  /** A group label was clicked. */
  pickGroup(key: string): void;
  /** The layout cooled (the moment a save may be due). */
  settled(): void;
  /** The loop went idle (the moment to remember the camera). */
  idle(): void;
  /** The time-lapse moved (every frame while it plays): update the controls without React. */
  playbackTick(p: PlaybackState): void;
  /** The time-lapse started, paused, resumed, ended or was left (React re-renders the controls). */
  playbackChanged(p: PlaybackState | null): void;
  /** The pointer is on a group title whose tooltip adds something (a folder's whole path), at a canvas point; or on none. */
  groupTip(tip: { text: string; x: number; y: number } | null): void;
}

/** The app's tooltips wait this long on a hover (uhd-viewer's Tooltips). */
export const TIP_DELAY_MS = 250;

/** The time-lapse in progress. */
interface Playback {
  run: TimelapseRun;
  /** Where every node was when it started: where leaving it glides back to. */
  snapshot: Record<string, [number, number]>;
  /** Whether a save was due before it started. */
  changed: boolean;
}

/**
 * The simulation, camera, canvas and pointer state of one map view, outside
 * React: the Atlas's, and the System Map's (sysmap/SystemMapView.tsx), which
 * gives it another graph (`load`), its vocabulary (`spec`) and the nodes it
 * points out (`setMark`), and never plays a time-lapse.
 */
export class AtlasEngine {
  sim: AtlasSimulation<MapNode> | null = null;
  /** The graph's vocabulary (kind names, group titles): the Atlas's unless a view says otherwise before `load`. */
  spec: MapSpec = ATLAS_SPEC;
  s: DrawState | null = null;
  readonly cam: Camera = newCamera();
  canvas: HTMLCanvasElement | null = null;
  /** The minimap's own canvas (null while hidden). */
  mini: HTMLCanvasElement | null = null;
  palette: AtlasPalette | null = null;
  /** No larger motion: the opening, fits and flies jump to their end, and the time-lapse fades nodes in where they are. Never set by a view (animations always play, and there is no switch); the tests use it for a map that is at rest at once. */
  reduced = false;
  /** Draw every link, not only the core ones ("All links"). */
  allLinks = false;
  w = 1;
  h = 1;
  dpr = 1;
  private raf = 0;
  private idleFrames = 0;
  private pendingFit = false;
  private wasActive = false;
  private drag: { id: string; index: number; moved: boolean } | null = null;
  private pan: { x: number; y: number; samples: { t: number; x: number; y: number }[] } | null = null;
  private press: { x: number; y: number; moved: boolean } | null = null;
  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  /** The group title the pointer is on (its tooltip's). */
  private tipFor: string | null = null;
  playback: Playback | null = null;
  /** The pointer moved a node, panned, or changed the grouping since the last save. */
  changed = false;
  /** The view shows the inspector or group card (right): fits made before it renders keep clear of it. */
  cardOpen = false;
  /** The host's bar over the top of the canvas (`--uhd-inset-top`, CSS pixels). */
  insetTop = 0;
  /** What floats over the canvas, in canvas pixels (measured by the view after each render): fits keep clear of it. */
  floats: { left: number; right: number; top: number; bottom: number } = { left: 0, right: 0, top: 0, bottom: 0 };
  /** The same, as boxes labels keep off. */
  reserved: LabelBox[] = [];

  constructor(private readonly events: EngineEvents) {}

  /**
   * A graph: the first, or again after a rebuild. A rebuild of the same
   * shape (same nodes and links) keeps the simulation as it is and only
   * takes the new details. One that changed builds a new simulation from
   * every node's live position (and velocity): the nodes that stayed do not
   * move, the new ones settle in. Only the first opens with the intro.
   */
  load(graph: MapGraph, saved: Record<string, [number, number]> | undefined, pullBy: PullBy, keepCamera: boolean) {
    const prev = this.sim;
    if (prev && this.s && prev.adopt(graph)) {
      // the same graph (a save, a rebuild that changed no link): nothing on the map moves
      this.s.lit = undefined;
      this.s.loose = undefined;
      this.wake();
      return;
    }
    if (this.playback) this.stopPlayback(true);
    const start = prev ? { ...saved, ...prev.livePositions() } : saved;
    const sim = new AtlasSimulation<MapNode>(graph, { pullBy, saved: start });
    const s = createDrawState(sim, {
      spec: this.spec,
      mark: null,
      cam: this.cam,
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      pullBy,
      highContrast: this.palette?.highContrast ?? false,
      allLinks: this.allLinks,
      time: this.s?.time ?? Number.NaN,
      query: this.s?.query ?? "",
      group: this.s?.group ?? null,
      reserved: this.reserved,
    });
    this.sim = sim;
    this.s = s;
    if (prev) {
      sim.inherit(prev);
      // a drag under way goes on, on the new simulation
      const d = this.drag;
      const at = d ? sim.indexOf(d.id) : undefined;
      if (d && at !== undefined) {
        const old = prev.nodes[d.index]!;
        this.drag = { ...d, index: at };
        if (d.moved && old.fx !== null && old.fy !== null) sim.pin(d.id, old.fx, old.fy);
      } else this.drag = null;
      if (sim.start === "joined" && this.reduced) sim.settle();
    } else {
      this.drag = null;
      if (!keepCamera) this.fitAll(true);
      if (this.reduced) {
        // the end state at once: a fresh layout settled before the first frame
        if (sim.start === "fresh") {
          sim.settle(SIM.preTicks);
          sim.cool();
          if (!keepCamera) this.fitAll(true);
        } else if (sim.start === "joined") sim.settle();
      } else {
        // the intro: from the center out to the saved layout, or settling freely (then a glide to fit it)
        sim.startIntro();
        if (sim.start === "fresh" && !keepCamera) this.pendingFit = true;
      }
    }
    if (sim.start !== "kept") this.changed = true;
    this.wasActive = sim.active;
    if (!sim.active) this.events.settled();
    this.wake();
  }

  resize(w: number, h: number, dpr: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.dpr = dpr;
    if (this.canvas) {
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
    }
    this.sizeMini();
    if (this.s) Object.assign(this.s, { w: this.w, h: this.h, dpr });
    this.wake();
  }

  sizeMini() {
    if (!this.mini) return;
    const w = Math.round(MINIMAP.w * this.dpr);
    const h = Math.round(MINIMAP.h * this.dpr);
    if (this.mini.width !== w) this.mini.width = w;
    if (this.mini.height !== h) this.mini.height = h;
  }

  wake = () => {
    this.idleFrames = 0;
    if (!this.raf && this.canvas && typeof requestAnimationFrame === "function") {
      // the loop restarts: its first frame eases by one frame's time, not by how long it idled
      if (this.s) this.s.time = Number.NaN;
      this.playback?.run.resetClock();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  stop() {
    clearTimeout(this.revealTimer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number) => {
    this.raf = 0;
    const { sim, s, canvas, palette } = this;
    if (!sim || !s || !canvas || !palette) return;
    let moving = false;
    const p = this.playback;
    if (p) {
      // the time-lapse steps the physics itself, on its fixed clock
      const wasPlaying = p.run.playing;
      if (p.run.frame(now)) moving = true;
      this.events.playbackTick(this.playbackState()!);
      if (p.run.playing !== wasPlaying) this.events.playbackChanged(this.playbackState());
    } else if (sim.active) {
      sim.tick();
      moving = true;
    }
    // (never during a time-lapse: its camera stays where it was)
    if (this.pendingFit && !p && sim.alpha < 0.14 && !sim.steering) {
      this.pendingFit = false;
      this.fitAll(false);
    }
    if (stepCamera(this.cam, this.w, this.h)) moving = true;
    if (this.reduced) snapCamera(this.cam);
    const ctx = canvas.getContext("2d");
    s.allLinks = this.allLinks;
    if (ctx && drawAtlas(ctx, s, palette, now)) moving = true;
    const mctx = this.mini?.getContext("2d");
    if (mctx) drawMinimap(mctx, s, palette, MINIMAP.w, MINIMAP.h, this.dpr);
    const active = sim.active;
    if (this.wasActive && !active) this.events.settled();
    this.wasActive = active;
    this.idleFrames = moving ? 0 : this.idleFrames + 1;
    // one chain of frames: something this frame did may have woken the loop already (a fit, a seek), and a second
    // request would fork it (each fork forking again every frame: the frozen time-lapse of round 3)
    if (this.idleFrames < IDLE_FRAMES) {
      if (!this.raf) this.raf = requestAnimationFrame(this.frame);
    } else this.events.idle();
  };

  /**
   * What a fit keeps clear: on a wide canvas the left panel and the right
   * column (the minimap, the card when one shows); the toolbar and the
   * time-lapse controls (bottom); the host's bar, the stale notice, and room
   * for the group titles (top).
   */
  insets(card: boolean): FitInsets {
    const wide = this.w >= WIDE;
    const f = this.floats;
    return {
      left: wide ? f.left : 0,
      right: wide ? Math.max(f.right, card ? CARD_W : 0) : 0,
      top: Math.max(this.insetTop, f.top) + (this.sim && this.sim.pullBy !== "links" ? GROUP_LABEL_H : 0),
      bottom: f.bottom,
    };
  }

  /** Aim at some nodes (all of them by default), gliding unless `instant` or reduced motion; `card`: a card will show at the right. */
  fit(indices?: readonly number[], pad = FIT_PAD, instant = false, card = this.cardOpen) {
    const sim = this.sim;
    if (!sim) return;
    const nodes = (indices ? indices.map((i) => sim.nodes[i]!).filter(Boolean) : sim.nodes).filter((n) => sim.isShown(n.index));
    fitTo(this.cam, nodes, this.w, this.h, pad, instant || this.reduced, this.insets(card));
    this.wake();
  }

  fitAll(instant = false) {
    this.fit(undefined, FIT_PAD, instant);
  }

  /** A node with its neighbors, filling the view (beside the inspector it opens). */
  fitNode(index: number) {
    if (!this.sim) return;
    this.fit([index, ...this.sim.neighborIndices(index)], 130, false, true);
  }

  /** Pan, without zooming, just enough that a node shows clear of the panels and of the card its selection opens. */
  reveal(index: number) {
    const n = this.sim?.nodes[index];
    if (!n) return;
    const ins = this.insets(true);
    const k = this.cam.tk;
    const sx = (n.x - this.cam.tx) * k + this.w / 2;
    const sy = (n.y - this.cam.ty) * k + this.h / 2;
    // room for the node's label, beside it
    const mx = 120;
    const my = 50;
    const x0 = (ins.left ?? 0) + mx;
    const x1 = this.w - (ins.right ?? 0) - mx;
    const y0 = (ins.top ?? 0) + my;
    const y1 = this.h - (ins.bottom ?? 0) - my;
    // a canvas too small for the panels: leave the camera alone
    if (x1 <= x0 || y1 <= y0) return;
    const dx = sx < x0 ? sx - x0 : sx > x1 ? sx - x1 : 0;
    const dy = sy < y0 ? sy - y0 : sy > y1 ? sy - y1 : 0;
    if (!dx && !dy) return;
    stopCamera(this.cam);
    this.cam.tx += dx / k;
    this.cam.ty += dy / k;
    this.wake();
  }

  /**
   * Reveal a clicked node once a double-click can no longer follow (it's
   * cancelled by one): the camera must not move between the two clicks.
   */
  revealSoon(index: number) {
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => this.reveal(index), REVEAL_DELAY_MS);
  }

  fitGroup(key: string) {
    if (!this.sim) return;
    const members = groupMembers(this.sim, key);
    if (members.length) this.fit(members, key === "unlinked" ? FIT_PAD : 120, false, true);
  }

  zoom(factor: number | "reset") {
    if (factor === "reset") {
      stopCamera(this.cam);
      this.cam.tk = 1;
    } else zoomBy(this.cam, factor);
    this.wake();
  }

  /** Pull together by links, kind or folder: the same simulation, its forces blended to the new rule; nodes drift, the camera stays. */
  setPullBy(p: PullBy) {
    const { sim, s } = this;
    if (!sim || !s) return;
    sim.setPullBy(p);
    s.pullBy = p;
    s.labels.clear();
    this.changed = true;
    this.wake();
  }

  /** Point out some nodes by id (the System Map's changes: ringed, the rest dimmed), or none. */
  setMark(ids: ReadonlySet<string> | null) {
    const { sim, s } = this;
    if (!sim || !s) return;
    if (!ids || !ids.size) s.mark = null;
    else {
      const mark = new Uint8Array(sim.nodes.length);
      for (const n of sim.nodes) if (ids.has(n.id)) mark[n.index] = 1;
      s.mark = mark;
    }
    this.wake();
  }

  shake() {
    const sim = this.sim;
    if (!sim) return;
    sim.reheat(SIM.reheat);
    this.changed = true;
    this.wake();
  }

  // ---- the time-lapse

  /**
   * Start the time-lapse: an empty map, then each node in sequence (timeline.ts), live in the physics
   * (fading in where it is when `reduced`, which no view sets; timelapse.ts). Play always animates.
   */
  startPlayback(timeline: Timeline, speed: TimelapseSpeed) {
    const { sim, s } = this;
    if (!sim || !s || !timeline.usable || this.playback) return;
    this.cancelDrag();
    const snapshot = sim.livePositions();
    // (only the Atlas plays one: its simulation is of the project index)
    const run = new TimelapseRun(sim as AtlasSimulation, timeline, !this.reduced, speed);
    this.playback = { run, snapshot, changed: this.changed };
    Object.assign(s, { vis: run.vis, scale: run.scale, linkVis: run.linkVis });
    this.events.playbackChanged(this.playbackState());
    this.wake();
  }

  private playbackState(): PlaybackState | null {
    const r = this.playback?.run;
    return r ? { ms: r.ms, date: r.date, playing: r.playing, shown: r.count } : null;
  }

  /** Show the map as it is at playback time `ms` (the scrubber). */
  seek(ms: number) {
    const p = this.playback;
    if (!p) return;
    p.run.seek(ms);
    this.events.playbackTick(this.playbackState()!);
    this.wake();
  }

  setPlaying(playing: boolean) {
    const p = this.playback;
    if (!p) return;
    // played to the end: play again from an empty map
    p.run.setPlaying(playing);
    this.events.playbackChanged(this.playbackState());
    this.wake();
  }

  setSpeed(speed: TimelapseSpeed) {
    this.playback?.run.setSpeed(speed);
  }

  /** Leave the time-lapse: every node shown again, gliding back to where it was when it started (no jump, nothing saved). */
  stopPlayback(quiet = false) {
    const p = this.playback;
    const sim = this.sim;
    if (!p || !sim) return;
    this.playback = null;
    this.cancelDrag();
    p.run.dispose();
    if (this.s) Object.assign(this.s, { vis: null, scale: null, linkVis: null });
    sim.setShown(null);
    sim.alphaTarget = 0;
    sim.glideTo(p.snapshot);
    this.changed = p.changed;
    if (!quiet) this.events.playbackChanged(null);
    this.wake();
  }

  private cancelDrag() {
    if (this.drag && this.sim) {
      this.sim.release(this.drag.id);
      this.sim.alphaTarget = this.playback?.run.restAlpha ?? 0;
    }
    this.drag = null;
  }

  // ---- the pointer

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas?.getBoundingClientRect();
    return r ? [e.clientX - r.left, e.clientY - r.top] : [0, 0];
  }

  pointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const { sim, s } = this;
    if (!sim || !s || (e.button !== 0 && e.button !== 1 && e.button !== 2)) return;
    const [x, y] = this.local(e);
    // a press takes the camera: any coasting stops where it is
    stopCamera(this.cam);
    this.cam.tx = this.cam.x;
    this.cam.ty = this.cam.y;
    this.cam.tk = this.cam.k;
    this.press = { x, y, moved: false };
    const hit = e.button === 0 ? hitNode(s, x, y) : null;
    // a press on a node is a click until the pointer moves past the slop: only a drag pins it and wakes the layout
    if (hit !== null) this.drag = { id: sim.nodes[hit]!.id, index: hit, moved: false };
    else this.pan = { x, y, samples: [{ t: e.timeStamp, x, y }] };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic event: no capture
    }
    this.wake();
  }

  pointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const { sim, s, canvas } = this;
    if (!sim || !s || !canvas) return;
    const [x, y] = this.local(e);
    if (this.press && Math.abs(x - this.press.x) + Math.abs(y - this.press.y) > CLICK_SLOP) this.press.moved = true;
    if (this.drag) {
      if (!this.press?.moved) return;
      if (!this.drag.moved) {
        // the drag starts: the rest of the layout answers it
        this.drag.moved = true;
        sim.alphaTarget = SIM.dragAlphaTarget;
        sim.reheat(SIM.dragAlphaTarget);
      }
      const wx = (x - this.w / 2) / this.cam.k + this.cam.x;
      const wy = (y - this.h / 2) / this.cam.k + this.cam.y;
      sim.pin(this.drag.id, wx, wy);
      canvas.style.cursor = "grabbing";
    } else if (this.pan) {
      panBy(this.cam, x - this.pan.x, y - this.pan.y);
      this.pan.x = x;
      this.pan.y = y;
      const samples = this.pan.samples;
      samples.push({ t: e.timeStamp, x, y });
      if (samples.length > 8) samples.shift();
      canvas.style.cursor = "grabbing";
    } else {
      const h = hitNode(s, x, y);
      const g = h === null ? hitGroupLabel(s, x, y) : null;
      canvas.style.cursor = h !== null || g ? "pointer" : "grab";
      // a folder's title draws its last segment: the whole path in a tooltip above the title (never over it)
      if (g !== this.tipFor) {
        this.tipFor = g;
        const label = g ? s.labels.get(g) : undefined;
        const full = g ? groupName(g, this.spec) : "";
        if (g && label && g.startsWith("folder:") && full.includes("/")) {
          const [cx, cy] = toScreen(this.cam, label.x, label.y, this.w, this.h);
          this.events.groupTip({ text: full, x: cx, y: cy - label.hpx / 2 - 6 });
        } else this.events.groupTip(null);
      }
      // nothing changed under the pointer: no frame needed
      if (h === s.hover) return;
      s.hover = h;
    }
    this.wake();
  }

  pointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    const { sim, s, canvas } = this;
    if (!sim || !s) return;
    const [x, y] = this.local(e);
    const press = this.press;
    if (this.drag?.moved) {
      // let go where it is: the physics eases everything back to rest from here (never a settle at once: that jumps)
      sim.release(this.drag.id);
      // a time-lapse still arriving keeps its warmth
      sim.alphaTarget = this.playback?.run.restAlpha ?? 0;
      this.changed = true;
    }
    if (this.pan && press?.moved && e.type === "pointerup") {
      // a pan let go while moving flings on
      const samples = this.pan.samples;
      const last = samples[samples.length - 1]!;
      const first = samples.find((p) => last.t - p.t <= FLING_WINDOW_MS) ?? last;
      const rested = e.timeStamp - last.t > FLING_REST_MS;
      const span = last.t - first.t;
      if (!rested && span > 0) fling(this.cam, ((last.x - first.x) / span) * 16.7, ((last.y - first.y) / span) * 16.7);
    }
    if (press && !press.moved && e.type === "pointerup" && e.button === 0) {
      const n = hitNode(s, x, y);
      if (n !== null) this.events.pick(sim.nodes[n]!.id);
      else {
        const g = hitGroupLabel(s, x, y);
        if (g) this.events.pickGroup(g);
        else this.events.pick(null);
      }
    }
    this.drag = null;
    this.pan = null;
    this.press = null;
    if (canvas) canvas.style.cursor = "grab";
    this.wake();
  }

  pointerLeave() {
    if (this.tipFor) {
      this.tipFor = null;
      this.events.groupTip(null);
    }
    if (this.s && this.s.hover !== null && !this.drag) {
      this.s.hover = null;
      this.wake();
    }
  }

  /** Double-click: a node fits with its neighbors; a group label fits its group. */
  doubleClick(e: { clientX: number; clientY: number }): { node?: string; group?: string } {
    const { sim, s } = this;
    if (!sim || !s) return {};
    clearTimeout(this.revealTimer);
    const [x, y] = this.local(e);
    const n = hitNode(s, x, y);
    if (n !== null) {
      this.fitNode(n);
      return { node: sim.nodes[n]!.id };
    }
    const g = hitGroupLabel(s, x, y);
    if (g) {
      this.fitGroup(g);
      return { group: g };
    }
    return {};
  }

  wheel(e: WheelEvent) {
    e.preventDefault();
    const [x, y] = this.local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    wheelImpulse(this.cam, x, y, dy);
    this.wake();
  }
}


/** The look of a folded panel's button (the hierarchy's), without its place: the view places it. */
export const REOPEN = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-fg-muted transition-[background-color,color,box-shadow] duration-200 ease-out motion-reduce:transition-none hover:bg-hover hover:text-fg hover:shadow-[0_0_10px_1px_var(--uhd-hover)] hover:outline hover:outline-1 hover:outline-dashed hover:-outline-offset-1 hover:outline-contrast-active focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus";
/** A floating card, as the app's panels draw it. */
export const CARD = "rounded-panel border border-line bg-surface shadow-panel outline outline-1 -outline-offset-1 outline-contrast";
/** The app's floating panels sit this far in from the canvas's edges (the hierarchy dock's inset: `left-1`, below the host's bar). */
export const TOP = "top-[calc(var(--uhd-inset-top,0px)+4px)]";
