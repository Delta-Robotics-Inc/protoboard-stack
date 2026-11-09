/**
 * One board drawn on one canvas: the scene, its buffers, the renderer, the view, which layers show, which copper
 * layer is active, net highlight, selection and hover. A read-only client of the board service: it holds the last
 * snapshot and applies commit events (`applyCommit`), re-flattening only the objects a commit changed. No React
 * here: the layout screen (BoardCanvas.tsx) and the headless render page both drive it.
 */
import type { BoardEvent, BoardSnapshot, CopperLayer } from "./board.js";
import { SceneBuffers } from "./buffers.js";
import { NM, type Rect } from "./geom.js";
import { defaultGroups, drawLayers, type DrawLayerDef, type DrawLayerId } from "./layers.js";
import { pickAt, pickBox, type Hit, type PickContext } from "./pick.js";
import { BoardRenderer } from "./renderer.js";
import { triangulate } from "./triangulate.js";
import { buildScene, setFills, setRatsnest, updateScene, type Scene } from "./scene.js";
import type { RatsnestPair, ZoneFill } from "./types.js";
import { fitRect, toScreen, toWorld, type Insets, type View } from "./view.js";

export interface BoardViewOptions {
  preserveDrawingBuffer?: boolean;
  ratsnest?: readonly RatsnestPair[];
  fills?: readonly ZoneFill[];
}

export class BoardView {
  readonly renderer: BoardRenderer;
  snapshot?: BoardSnapshot;
  scene?: Scene;
  buffers?: SceneBuffers;
  groups = new Set<string>();
  private defs: DrawLayerDef[] = [];
  private groupOf = new Map<DrawLayerId, string>();
  selection: string[] = [];
  hover: string | undefined;
  highlight: string[] = [];
  dim = true;
  width = 1;
  height = 1;
  private frame = 0;
  private listeners = new Set<() => void>();
  private ratsnest: readonly RatsnestPair[];
  private fills: readonly ZoneFill[];

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: BoardViewOptions = {},
  ) {
    this.renderer = new BoardRenderer(canvas, options);
    this.renderer.state.visible = (l) => this.isVisible(l);
    this.ratsnest = options.ratsnest ?? [];
    this.fills = options.fills ?? [];
  }

  get view(): View {
    return this.renderer.state.view;
  }
  get active(): CopperLayer {
    return this.renderer.state.active;
  }

  /** Called after anything that moves or restyles the drawing (overlays re-lay out). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed(): void {
    for (const l of [...this.listeners]) l();
  }

  isVisible(layer: DrawLayerId): boolean {
    if (layer === "holes") return this.groups.has("pads") || this.groups.has("vias");
    return this.groups.has(this.groupOf.get(layer) ?? layer);
  }

  /** Take a whole snapshot (a new board, or a new epoch). */
  setSnapshot(snapshot: BoardSnapshot): void {
    const first = !this.scene;
    this.snapshot = snapshot;
    this.scene = buildScene(snapshot.doc, { ratsnest: this.ratsnest, fills: this.fills });
    this.buffers = new SceneBuffers(this.scene, triangulate);
    this.defs = drawLayers(this.scene.copper);
    this.groupOf = new Map(this.defs.map((d) => [d.id, d.group]));
    if (first || !this.groups.size) this.groups = defaultGroups(this.scene.copper);
    if (!this.scene.copper.includes(this.active)) this.renderer.state.active = this.scene.copper[0] ?? "top";
    this.renderer.setScene(this.scene, this.buffers);
    this.selection = this.selection.filter((id) => this.scene!.objects.has(id));
    this.refreshStyles();
    this.requestRender();
  }

  /** Apply a commit event with the snapshot after it: only changed objects are rebuilt and re-uploaded. */
  applyCommit(event: Extract<BoardEvent, { type: "commit" }>, snapshot: BoardSnapshot): void {
    if (!this.scene || !this.buffers || !this.snapshot || event.epoch !== this.snapshot.epoch) return this.setSnapshot(snapshot);
    this.snapshot = snapshot;
    const ids = [...new Set([...event.changed, ...Object.values(event.created), ...event.removed])];
    const changed = updateScene(this.scene, snapshot.doc, ids);
    const touched = this.buffers.update(changed, this.scene);
    if (changed === "all") {
      this.defs = drawLayers(this.scene.copper);
      this.groupOf = new Map(this.defs.map((d) => [d.id, d.group]));
      this.renderer.setScene(this.scene, this.buffers);
    } else this.renderer.sync(touched);
    this.selection = this.selection.filter((id) => this.scene!.objects.has(id));
    if (this.hover && !this.scene.objects.has(this.hover)) this.hover = undefined;
    this.refreshStyles();
    this.requestRender();
  }

  setRatsnest(pairs: readonly RatsnestPair[]): void {
    this.ratsnest = pairs;
    if (!this.scene || !this.buffers) return;
    this.renderer.sync(this.buffers.update(setRatsnest(this.scene, pairs), this.scene));
    this.requestRender();
  }

  setFills(fills: readonly ZoneFill[]): void {
    this.fills = fills;
    if (!this.scene || !this.buffers) return;
    this.renderer.sync(this.buffers.update(setFills(this.scene, fills), this.scene));
    this.requestRender();
  }

  setLayers(next: { groups?: Set<string>; active?: CopperLayer; grayInactive?: boolean }): void {
    if (next.groups) this.groups = new Set(next.groups);
    if (next.active) this.renderer.state.active = next.active;
    if (next.grayInactive !== undefined) this.renderer.state.grayInactive = next.grayInactive;
    this.refreshStyles();
    this.requestRender();
  }

  setGrid(mm: number): void {
    this.renderer.state.grid = mm;
    this.requestRender();
  }

  resize(width: number, height: number, dpr?: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.resize(this.width, this.height, dpr);
    // a fitted view stays fitted as the canvas changes size, until someone pans or zooms
    if (this.fitted) this.fit(this.fitted.insets, this.fitted.rect);
    this.renderNow();
  }

  private fitted?: { insets?: Insets; rect?: Rect };

  setView(v: View): void {
    this.fitted = undefined;
    this.renderer.state.view = v;
    this.requestRender();
  }

  /** Fit a rectangle (millimeters; default the board) into the canvas clear of the insets. */
  fit(insets?: Insets, rect?: Rect): void {
    const r = rect ?? this.scene?.rect ?? [-10, -10, 10, 10];
    this.setView(fitRect(r, this.width, this.height, insets, this.view.flip));
    this.fitted = { ...(insets ? { insets } : {}), ...(rect ? { rect } : {}) };
  }

  flip(): void {
    const v = this.view;
    const keep = this.fitted;
    // mirror about the canvas center: the board point there stays there
    this.setView({ ...v, flip: !v.flip });
    if (keep) this.fit(keep.insets, keep.rect);
  }

  /** Light nets by name. */
  setHighlight(nets: readonly string[], dim = true): void {
    this.highlight = [...nets];
    this.dim = dim;
    this.refreshStyles();
    this.requestRender();
  }

  setSelection(ids: readonly string[]): void {
    this.selection = ids.filter((id) => this.scene?.objects.has(id));
    this.refreshOutlines();
    this.requestRender();
  }

  setHover(id: string | undefined): void {
    if (id === this.hover) return;
    this.hover = id;
    this.refreshOutlines();
    this.requestRender();
  }

  private refreshStyles(): void {
    const idx = this.highlight.map((n) => this.scene?.netIndex.get(n) ?? 0).filter((i) => i > 0);
    this.renderer.setHighlight(idx, this.dim);
    this.refreshOutlines();
  }

  /** Selected ids expand to what draws them: a footprint brings its pads. */
  private expand(ids: readonly string[]): string[] {
    const out: string[] = [];
    for (const id of ids) {
      out.push(id);
      for (const p of this.scene?.padsOf.get(id) ?? []) out.push(p);
    }
    return out;
  }

  private refreshOutlines(): void {
    const sel = this.expand(this.selection);
    this.renderer.setOutlines(sel, this.hover && !this.selection.includes(this.hover) ? this.expand([this.hover]) : []);
  }

  pickContext(): PickContext | undefined {
    if (!this.scene || !this.snapshot) return undefined;
    return { scene: this.scene, query: this.snapshot.query, visible: (l) => this.isVisible(l), active: this.active };
  }

  /** What is under a screen point (CSS pixels), best first; `tolPx` grows small targets. */
  pickScreen(sx: number, sy: number, tolPx = 4): Hit[] {
    const ctx = this.pickContext();
    if (!ctx) return [];
    const p = this.toWorld(sx, sy);
    return pickAt(ctx, p.x, p.y, tolPx / this.view.s);
  }

  /** Objects in a screen rectangle (CSS pixels): window when dragged left to right, crossing when right to left. */
  pickScreenBox(x0: number, y0: number, x1: number, y1: number): string[] {
    const ctx = this.pickContext();
    if (!ctx) return [];
    const a = this.toWorld(x0, y0);
    const b = this.toWorld(x1, y1);
    const rect: Rect = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
    // seen from below, a left-to-right drag on screen runs right to left on the board: the gesture decides, not the board
    return pickBox(ctx, rect, x1 >= x0 ? "window" : "crossing");
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return toWorld(this.view, this.width, this.height, sx, sy);
  }
  toScreen(x: number, y: number): { x: number; y: number } {
    return toScreen(this.view, this.width, this.height, x, y);
  }
  /** Nanometer point to screen. */
  nmToScreen(p: { x: number; y: number }): { x: number; y: number } {
    return this.toScreen(p.x * NM, p.y * NM);
  }

  requestRender(): void {
    if (this.frame || typeof requestAnimationFrame === "undefined") {
      if (typeof requestAnimationFrame === "undefined") this.renderNow();
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  renderNow(): void {
    this.renderer.render();
    this.changed();
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.listeners.clear();
    this.renderer.dispose();
  }
}
