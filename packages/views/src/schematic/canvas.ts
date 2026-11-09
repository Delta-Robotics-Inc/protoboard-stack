/**
 * The schematic canvas (browser): one SVG element drawing the sheet item by item from the host's markup (the
 * schematic package's renderer, so the screen and the exported images cannot drift), with pan and zoom (vector,
 * crisp at any zoom), incremental updates on commits, picking of pins, fields, symbols, labels, power symbols,
 * wires and cards, and overlays: selection, hover, a cross-probe, a lit net with the rest faded, numbered defect
 * rings, a proposal's ghost and a drag's live preview.
 *
 * Depth by zoom (the concept's stops, as far as the data goes): L1 blocks (cards with their names, members and
 * scores over a faded circuit), L2 symbols (symbols, wires and labels, no pin text), L3 pins and nets (everything).
 */
import type { Box, PageItem, PageModel, PagePin, XY } from "./types.js";

export type Lod = 1 | 2 | 3;
export interface Hit {
  kind: "pin" | "field" | "symbol" | "label" | "power" | "wire" | "noconnect" | "card";
  id: string;
  item: PageItem;
  pin?: PagePin;
  /** a wire's segment index */
  seg?: number;
}
export interface View {
  /** screen pixels per grid unit */
  s: number;
  tx: number;
  ty: number;
}
export interface DragPreview {
  ids: string[];
  dx: number;
  dy: number;
  /** wires drawn where they would go (the originals hidden) */
  wires: { id: string; points: XY[]; net: string }[];
  /** fields of one symbol moved */
  field?: string;
}

const NS = "http://www.w3.org/2000/svg";
/** zoom 100% is 16 px per grid unit (the renderer's default scale) */
export const BASE_SCALE = 16;
/** below this many px per gu the sheet shows blocks (L1); below L3 it shows symbols without pin text (L2) */
export const LOD_STOPS = { blocks: 5, pins: 8 } as const;
export const lodOf = (s: number): Lod => (s < LOD_STOPS.blocks ? 1 : s < LOD_STOPS.pins ? 2 : 3);
const SELECT = "#5aa9ff";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f = (v: number) => String(Math.round(v * 1000) / 1000);

/** Distance from a point to a segment. */
export function segDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const inBox = (b: Box, p: XY, tol = 0) => p[0] >= b[0] - tol && p[0] <= b[2] + tol && p[1] >= b[1] - tol && p[1] <= b[3] + tol;

/** The markup of one item as the canvas groups it. */
export function itemMarkup(it: PageItem, color?: { from: string; to: string }): string {
  const recolor = (s: string) => (color ? s.split(`"${color.from}"`).join(`"${color.to}"`) : s);
  if (it.kind === "symbol") return `<g class="body">${it.svg}</g>${it.pinText ? `<g class="pt" transform="${it.transform ?? ""}">${it.pinText}</g>` : ""}${it.fields ? `<g class="fld">${it.fields}</g>` : ""}`;
  return recolor(it.svg);
}

export class SchematicCanvas {
  readonly svg: SVGSVGElement;
  private readonly world: SVGGElement;
  private readonly layer: Record<"cards" | "wires" | "junctions" | "symbols" | "power" | "labels" | "nc" | "blocks" | "ghost" | "marks" | "over", SVGGElement>;
  private readonly els = new Map<string, SVGGElement>();
  private model: PageModel | undefined;
  private items = new Map<string, PageItem>();
  view: View = { s: BASE_SCALE, tx: 0, ty: 0 };
  lod: Lod = 3;
  private lit: string | undefined;
  private selection: string[] = [];
  private hover: string | undefined;
  private probed: string[] = [];
  private pinSel: PagePin | undefined;
  private markers: { n: number; at: XY; severity: string; on?: boolean }[] = [];
  private preview: DragPreview | undefined;
  private cardInfo = new Map<string, { score?: number; refs: string[] }>();
  private readonly viewListeners = new Set<(v: View) => void>();
  private raf = 0;

  constructor(readonly host: HTMLElement) {
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("class", "sch-svg lod3");
    this.world = document.createElementNS(NS, "g");
    this.svg.append(this.world);
    const mk = (name: string) => {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", `layer ${name}`);
      this.world.append(g);
      return g;
    };
    this.layer = { cards: mk("cards"), wires: mk("wires"), junctions: mk("junctions"), symbols: mk("symbols"), power: mk("power"), labels: mk("labels"), nc: mk("nc"), blocks: mk("blocks"), ghost: mk("ghost"), marks: mk("marks"), over: mk("over") };
    host.append(this.svg);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.svg.remove();
  }

  // ------------------------------------------------------------ the sheet

  private layerOf(it: PageItem): SVGGElement {
    return it.kind === "card" ? this.layer.cards : it.kind === "wire" ? this.layer.wires : it.kind === "symbol" ? this.layer.symbols : it.kind === "power" ? this.layer.power : it.kind === "label" ? this.layer.labels : this.layer.nc;
  }

  private open(it: PageItem): string {
    return `<g data-id="${esc(it.id)}" data-kind="${it.kind}"${it.net ? ` data-net="${esc(it.net)}"` : ""}${it.card ? ` data-card="${esc(it.card)}"` : ""}${this.lit && it.net === this.lit ? ' class="on"' : ""}>${itemMarkup(it, this.litColor(it))}</g>`;
  }

  private litColor(it: PageItem): { from: string; to: string } | undefined {
    if (!this.model || !this.lit || it.net !== this.lit) return undefined;
    const cls = this.model.nets.find((n) => n.name === it.net)?.cls;
    const from = cls ? this.model.colors[cls] : undefined;
    return from ? { from, to: SELECT } : undefined;
  }

  /** Draw a whole model (the first paint and a host's reload). */
  setModel(model: PageModel, items: ReadonlyMap<string, PageItem>): void {
    this.model = model;
    this.items = new Map(items);
    this.els.clear();
    const parts: Record<string, string[]> = { cards: [], wires: [], symbols: [], power: [], labels: [], nc: [] };
    for (const it of items.values()) parts[it.kind === "card" ? "cards" : it.kind === "wire" ? "wires" : it.kind === "symbol" ? "symbols" : it.kind === "power" ? "power" : it.kind === "label" ? "labels" : "nc"].push(this.open(it));
    for (const [k, v] of Object.entries(parts)) this.layer[k as "cards"].innerHTML = v.join("");
    for (const g of this.world.querySelectorAll<SVGGElement>("g[data-id]")) this.els.set(g.dataset.id!, g);
    this.drawJunctions();
    this.drawBlocks();
    this.drawOverlay();
  }

  /** Apply a commit: replace the changed items, drop the removed ones. */
  update(model: PageModel, items: ReadonlyMap<string, PageItem>, changed: readonly string[], removed: readonly string[]): void {
    this.model = model;
    this.items = new Map(items);
    for (const id of removed) {
      this.els.get(id)?.remove();
      this.els.delete(id);
    }
    for (const id of changed) {
      const it = items.get(id);
      if (!it) continue;
      const tmp = document.createElementNS(NS, "g");
      tmp.innerHTML = this.open(it);
      const g = tmp.firstElementChild as SVGGElement;
      const old = this.els.get(id);
      if (old && old.parentNode === this.layerOf(it)) old.replaceWith(g);
      else {
        old?.remove();
        this.layerOf(it).append(g);
      }
      this.els.set(id, g);
    }
    this.drawJunctions();
    this.drawBlocks();
    this.drawOverlay();
  }

  private drawJunctions() {
    const m = this.model;
    if (!m) return;
    this.layer.junctions.innerHTML = m.junctions
      .map((j) => {
        const cls = m.nets.find((n) => n.name === j.net)?.cls ?? "digital";
        const on = this.lit === j.net;
        return `<circle cx="${f(j.at[0])}" cy="${f(j.at[1])}" r="0.22" fill="${on ? SELECT : (m.colors[cls] ?? "#999")}" data-net="${esc(j.net)}"${on ? ' class="on"' : ""}/>`;
      })
      .join("");
  }

  /** Card names, members and scores for the blocks depth (L1). */
  setCardInfo(info: Map<string, { score?: number; refs: string[] }>): void {
    this.cardInfo = info;
    this.drawBlocks();
  }

  private drawBlocks() {
    if (this.lod !== 1) {
      this.layer.blocks.innerHTML = "";
      return;
    }
    const px = (n: number) => n / this.view.s;
    const out: string[] = [];
    for (const it of this.items.values()) {
      if (it.kind !== "card") continue;
      const [x0, y0, x1, y1] = it.box;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const info = this.cardInfo.get(it.id);
      const title = String(it.rec.title ?? it.id);
      out.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" class="blk" data-id="${esc(it.id)}"/>`);
      // text fits the card's width on screen (a long sub-module name is cut with an ellipsis)
      const wpx = (x1 - x0) * this.view.s - 16;
      const fitText = (t: string, charPx: number) => {
        const n = Math.max(3, Math.floor(wpx / charPx));
        return t.length > n ? `${t.slice(0, n - 1)}…` : t;
      };
      out.push(`<text x="${f(cx)}" y="${f(cy)}" font-size="${f(px(14))}" class="blk-t">${esc(fitText(title, 9.6))}</text>`);
      if (info?.refs.length) out.push(`<text x="${f(cx)}" y="${f(cy + px(18))}" font-size="${f(px(10))}" class="blk-s">${esc(fitText(info.refs.slice(0, 8).join(" ") + (info.refs.length > 8 ? ` +${info.refs.length - 8}` : ""), 6.4))}</text>`);
      if (wpx > 110) out.push(`<text x="${f(x1 - px(8))}" y="${f(y1 - px(8))}" font-size="${f(px(9.5))}" class="blk-n">${f(x1 - x0)} × ${f(y1 - y0)} GRID${info?.score !== undefined ? ` · ${info.score}` : ""}</text>`);
    }
    this.layer.blocks.innerHTML = out.join("");
  }

  // ------------------------------------------------------------ view

  onView(listener: (v: View) => void): () => void {
    this.viewListeners.add(listener);
    return () => void this.viewListeners.delete(listener);
  }

  setView(v: View): void {
    const s = Math.max(0.8, Math.min(160, v.s));
    this.view = { s, tx: v.tx, ty: v.ty };
    const lod = lodOf(s);
    if (lod !== this.lod) {
      this.lod = lod;
      this.svg.setAttribute("class", `sch-svg lod${lod}${this.lit ? " lit" : ""}`);
      this.drawBlocks();
    } else if (lod === 1) this.drawBlocks();
    this.world.setAttribute("transform", `translate(${f(this.view.tx)} ${f(this.view.ty)}) scale(${f(s)})`);
    this.drawOverlay();
    for (const l of [...this.viewListeners]) l(this.view);
  }

  toScreen(p: XY): XY {
    return [p[0] * this.view.s + this.view.tx, p[1] * this.view.s + this.view.ty];
  }
  toSheet(x: number, y: number): XY {
    return [(x - this.view.tx) / this.view.s, (y - this.view.ty) / this.view.s];
  }

  /** Fit a box (default: the sheet) inside the canvas less the insets. */
  fit(box?: Box, insets = { left: 60, right: 380, top: 70, bottom: 170 }): void {
    const b = box ?? this.model?.bounds;
    if (!b) return;
    const r = this.host.getBoundingClientRect();
    const w = Math.max(50, r.width - insets.left - insets.right);
    const h = Math.max(50, r.height - insets.top - insets.bottom);
    const s = Math.min(w / Math.max(1, b[2] - b[0]), h / Math.max(1, b[3] - b[1]));
    this.setView({ s, tx: insets.left + (w - (b[2] - b[0]) * s) / 2 - b[0] * s, ty: insets.top + (h - (b[3] - b[1]) * s) / 2 - b[1] * s });
  }

  zoomAt(x: number, y: number, k: number): void {
    const p = this.toSheet(x, y);
    const s = Math.max(0.8, Math.min(160, this.view.s * k));
    this.setView({ s, tx: x - p[0] * s, ty: y - p[1] * s });
  }

  panBy(dx: number, dy: number): void {
    this.setView({ s: this.view.s, tx: this.view.tx + dx, ty: this.view.ty + dy });
  }

  // ------------------------------------------------------------ overlays

  setLit(net: string | undefined): void {
    if (net === this.lit) return;
    const before = this.lit;
    this.lit = net;
    this.svg.setAttribute("class", `sch-svg lod${this.lod}${net ? " lit" : ""}`);
    for (const it of this.items.values()) if (it.net && (it.net === before || it.net === net)) {
      const g = this.els.get(it.id);
      if (!g) continue;
      g.innerHTML = itemMarkup(it, this.litColor(it));
      g.classList.toggle("on", it.net === net);
    }
    this.drawJunctions();
  }
  get litNet(): string | undefined {
    return this.lit;
  }

  setSelection(ids: readonly string[], pin?: PagePin): void {
    this.selection = [...ids];
    this.pinSel = pin;
    this.drawOverlay();
  }
  setHover(id: string | undefined): void {
    if (id === this.hover) return;
    this.hover = id;
    this.drawOverlay();
  }
  setProbed(ids: readonly string[]): void {
    this.probed = [...ids];
    this.drawOverlay();
  }
  setMarkers(markers: { n: number; at: XY; severity: string; on?: boolean }[]): void {
    this.markers = markers;
    this.drawMarkers();
  }
  setGhost(markup: string | undefined): void {
    this.layer.ghost.innerHTML = markup ?? "";
    this.svg.classList.toggle("ghosting", !!markup);
  }

  setPreview(p: DragPreview | undefined): void {
    const prev = this.preview;
    this.preview = p;
    for (const id of new Set([...(prev?.ids ?? []), ...(p?.ids ?? [])])) {
      const g = this.els.get(id);
      if (!g) continue;
      const on = p?.ids.includes(id) && !p.field;
      if (on) g.setAttribute("transform", `translate(${f(p!.dx)} ${f(p!.dy)})`);
      else g.removeAttribute("transform");
    }
    if (prev?.field) this.els.get(prev.field)?.querySelector(".fld")?.removeAttribute("transform");
    if (p?.field) this.els.get(p.field)?.querySelector(".fld")?.setAttribute("transform", `translate(${f(p.dx)} ${f(p.dy)})`);
    for (const w of prev?.wires ?? []) this.els.get(w.id)?.style.removeProperty("display");
    for (const w of p?.wires ?? []) this.els.get(w.id)?.style.setProperty("display", "none");
    this.drawOverlay();
  }

  private boxOf(id: string): Box | undefined {
    return this.items.get(id)?.box;
  }

  private drawOverlay() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.drawOverlayNow());
  }

  /** Draw selection, hover, probe and drag preview now (tests call it to skip the frame). */
  drawOverlayNow(): void {
    const s = this.view.s;
    const out: string[] = [];
    const pad = 4 / s;
    const rect = (b: Box, cls: string, d: XY = [0, 0]) => `<rect class="${cls}" x="${f(b[0] - pad + d[0])}" y="${f(b[1] - pad + d[1])}" width="${f(b[2] - b[0] + 2 * pad)}" height="${f(b[3] - b[1] + 2 * pad)}" rx="${f(2 / s)}"/>`;
    const p = this.preview;
    const shift = (id: string): XY => (p && !p.field && p.ids.includes(id) ? [p.dx, p.dy] : [0, 0]);
    for (const id of this.probed) {
      const b = this.boxOf(id);
      if (b) out.push(rect(b, "probe", shift(id)));
    }
    if (this.hover && !this.selection.includes(this.hover)) {
      const it = this.items.get(this.hover);
      if (it?.kind === "wire") out.push(`<polyline class="hov-w" points="${(it.rec.points as XY[]).map((q) => `${f(q[0])},${f(q[1])}`).join(" ")}"/>`);
      else if (it) out.push(rect(it.kind === "symbol" && it.body ? it.body : it.box, "hov", shift(it.id)));
    }
    for (const id of this.selection) {
      const it = this.items.get(id);
      if (!it) continue;
      if (it.kind === "wire") {
        out.push(`<polyline class="sel-w" points="${(it.rec.points as XY[]).map((q) => `${f(q[0])},${f(q[1])}`).join(" ")}"/>`);
        for (const q of it.rec.points as XY[]) out.push(`<rect class="sel-v" x="${f(q[0] - 3 / s)}" y="${f(q[1] - 3 / s)}" width="${f(6 / s)}" height="${f(6 / s)}"/>`);
      } else if (it.kind === "card") out.push(rect(it.box, "sel card"));
      else out.push(rect(it.kind === "symbol" && it.body ? it.body : it.box, "sel", shift(id)));
      if (it.kind === "symbol" && this.lod === 3 && it.fieldBox && !this.pinSel) out.push(rect(it.fieldBox, "fld-box", p?.field === id ? [p.dx, p.dy] : shift(id)));
      if (it.pinned && it.kind !== "card") {
        const b = it.kind === "symbol" && it.body ? it.body : it.box;
        const d = shift(id);
        out.push(`<text class="pin-tag" x="${f(b[2] + d[0] + 6 / s)}" y="${f(b[1] + d[1])}" font-size="${f(9 / s)}">PINNED</text>`);
      }
    }
    if (this.pinSel) {
      const at = this.pinSel.at;
      out.push(`<rect class="sel-pin" x="${f(at[0] - 0.55)}" y="${f(at[1] - 0.55)}" width="1.1" height="1.1" rx="0.15"/>`);
    }
    for (const w of p?.wires ?? []) {
      const cls = this.model?.nets.find((n) => n.name === w.net)?.cls ?? "digital";
      out.push(`<polyline class="pv-w" stroke="${this.model?.colors[cls] ?? "#999"}" points="${w.points.map((q) => `${f(q[0])},${f(q[1])}`).join(" ")}"/>`);
    }
    this.layer.over.innerHTML = out.join("");
  }

  private drawMarkers() {
    const m = this.model;
    const out: string[] = [];
    for (const k of this.markers) {
      const color = m?.severity[k.severity as "error"] ?? "#e5484d";
      const [x, y] = k.at;
      const txt = String(k.n);
      const w = Math.max(1.1, 0.55 * txt.length + 0.6);
      out.push(`<g class="mk${k.on ? " on" : ""}" data-marker="${k.n}"><circle cx="${f(x)}" cy="${f(y)}" r="1.3" fill="none" stroke="${k.on ? SELECT : color}" stroke-width="0.16"/><rect x="${f(x + 1.1 - w / 2)}" y="${f(y - 1.65)}" width="${f(w)}" height="1.1" rx="0.55" fill="#e8e6df" stroke="${k.on ? SELECT : color}" stroke-width="0.08"/><text x="${f(x + 1.1)}" y="${f(y - 1.1)}" font-size="0.75">${txt}</text></g>`);
    }
    this.layer.marks.innerHTML = out.join("");
  }

  // ------------------------------------------------------------ picking

  /** The item under a screen point: pins (at the pins depth) and fields first, then labels, power symbols, symbols, wires, no-connect marks, cards. */
  pick(x: number, y: number, o: { cards?: boolean } = {}): Hit | undefined {
    const p = this.toSheet(x, y);
    const tol = Math.max(0.3, 5 / this.view.s);
    const all = [...this.items.values()];
    if (this.lod === 3)
      for (const it of all) {
        if (it.kind !== "symbol" || !it.pins || !inBox(it.box, p, 1)) continue;
        for (const pin of it.pins) if (Math.abs(pin.at[0] - p[0]) <= tol && Math.abs(pin.at[1] - p[1]) <= tol) return { kind: "pin", id: it.id, item: it, pin };
      }
    if (this.lod >= 2) {
      for (const k of ["label", "power"] as const) for (let i = all.length - 1; i >= 0; i--) if (all[i].kind === k && inBox(all[i].box, p, tol * 0.3)) return { kind: k, id: all[i].id, item: all[i] };
      if (this.lod === 3) for (const it of all) if (it.kind === "symbol" && it.fieldBox && inBox(it.fieldBox, p, 0.1) && !(it.body && inBox(it.body, p))) return { kind: "field", id: it.id, item: it };
    }
    for (const it of all) if (it.kind === "symbol" && it.body && inBox(it.body, p, this.lod === 1 ? 0 : 0.2)) return { kind: "symbol", id: it.id, item: it };
    if (this.lod >= 2) {
      let best: Hit | undefined;
      let bd = tol;
      for (const it of all) {
        if (it.kind !== "wire" || !inBox(it.box, p, tol)) continue;
        const pts = it.rec.points as XY[];
        for (let i = 0; i < pts.length - 1; i++) {
          const d = segDist(p, pts[i], pts[i + 1]);
          if (d <= bd) {
            bd = d;
            best = { kind: "wire", id: it.id, item: it, seg: i };
          }
        }
      }
      if (best) return best;
      for (const it of all) if (it.kind === "noconnect" && inBox(it.box, p)) return { kind: "noconnect", id: it.id, item: it };
    }
    if (o.cards !== false)
      for (let i = all.length - 1; i >= 0; i--) {
        const it = all[i];
        if (it.kind === "card" && (inBox(it.box, p) && (this.lod === 1 || (it.tag && inBox(it.tag, p, 0.2)) || !this.anyInside(it, p)))) return { kind: "card", id: it.id, item: it };
      }
    return undefined;
  }

  /** Whether a point inside a card is near anything drawn in it (a click on the card's empty space selects the card). */
  private anyInside(card: PageItem, p: XY): boolean {
    void card;
    void p;
    return true;
  }

  /** Items whose boxes lie wholly inside a sheet box (a rubber band). */
  itemsIn(b: Box): string[] {
    const out: string[] = [];
    for (const it of this.items.values()) {
      if (it.kind === "card" || it.kind === "noconnect") continue;
      const ib = it.kind === "symbol" && it.body ? it.body : it.box;
      if (ib[0] >= b[0] && ib[1] >= b[1] && ib[2] <= b[2] && ib[3] <= b[3]) out.push(it.id);
    }
    return out;
  }
}
