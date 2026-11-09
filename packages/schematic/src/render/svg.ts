/**
 * The pure SVG renderer (contract section 13): no DOM and no fonts (text is stroke paths from the board scene's
 * font), so the same document gives the same bytes. Two themes share the geometry and differ only in tokens:
 * `dark` (on screen: chamfered cards with a knockout title tag, wires colored by signal class, pill labels, IEC
 * resistors) and `paper` (print: one ink on paper, thin frames with the title inside, flag labels, US resistors,
 * zones and a title block).
 *
 * Two overlays: a proposal's ghost (`ghost`: the records it would change, dashed, before and after) and print
 * pages (`page`, or `renderSchematicPages`: whole cards per paper sheet, each with its frame and title block).
 */
import { textPath, textWidth } from "@protoboardai/board-scene";
import { byCodeUnit, canonical, type OpCall } from "@protoboardai/board";
import { MARGIN, UNIT, type BodyElement } from "@protoboardai/symbols";
import { splitPinKey } from "../circuit.ts";
import { recordsOfKind, type SchematicDocument } from "../document.ts";
import { cardTitleBoxes, geometryOf, inflateBox, labelBox, powerBoxes, showGroundName, unionBoxes, type PlacedSymbol, type TextBox } from "../geometry.ts";
import { applyCalls, type ApplyContext } from "../ops/index.ts";
import { ID_PREFIX, type CardRecT, type LabelRecT, type PowerRecT, type SchematicRecord } from "../schema.ts";
import { packSymbols, resolveSymbol, type LBox } from "../symbols.ts";
import type { Rotation, XY } from "../units.ts";
import { paginateSchematic, PAPER_PAD, TITLE_BLOCK_H, type PaginateOptions, type SchematicPage } from "./pages.ts";

export * from "./pages.ts";

export type SignalClass = "power" | "ground" | "digital" | "i2c" | "usb" | "analog";

export interface ThemeTokens {
  name: "dark" | "paper";
  background: string;
  ink: string;
  dim: string;
  faint: string;
  card: { fill: string; stroke: string; strokeWidth: number; chamfer: number; tagFill?: string; tagInk: string; subtitle: string };
  wire: Record<SignalClass, string>;
  wireWidth: number;
  symbolStroke: number;
  ref: string;
  value: string;
  pinName: string;
  pinNumber: string;
  label: { style: "pill" | "flag"; fill: string };
  nc: string;
  /** symbol variant per class drawn in this theme (`iec` resistors on screen) */
  variants: Record<string, string>;
  severity: { error: string; warning: string; info: string; gate: string };
  highlight: string;
  frame: boolean;
  /** a proposal's ghost: `before` strokes where changed or removed items are now, `after` where they would go; `dash` is an SVG dash array in grid units */
  ghost: { before: string; after: string; dash: string };
}

export const THEMES: Record<"dark" | "paper", ThemeTokens> = {
  dark: {
    name: "dark",
    background: "#131313",
    ink: "#d9d6cf",
    dim: "#8f8c86",
    faint: "#3a3a3a",
    card: { fill: "#171717", stroke: "#3a3a3a", strokeWidth: 0.08, chamfer: 0.9, tagFill: "#e8e6df", tagInk: "#131313", subtitle: "#6f6c66" },
    wire: { power: "#e07a9b", ground: "#9a948a", digital: "#4fc3b5", i2c: "#a58cf0", usb: "#d9bf8c", analog: "#b5c48a" },
    wireWidth: 0.12,
    symbolStroke: 0.5,
    ref: "#e8e6df",
    value: "#8f8c86",
    pinName: "#b5b2aa",
    pinNumber: "#6f6c66",
    label: { style: "pill", fill: "#131313" },
    nc: "#c9665f",
    variants: { resistor: "iec" },
    severity: { error: "#e5484d", warning: "#f0b429", info: "#8f8c86", gate: "#e5484d" },
    highlight: "#4ea1ff",
    frame: false,
    ghost: { before: "#8f8c86", after: "#4c8dff", dash: "0.5 0.3" },
  },
  paper: {
    name: "paper",
    background: "#f6f3ea",
    ink: "#24452f",
    dim: "#6b7a6f",
    faint: "#c9c4b4",
    card: { fill: "none", stroke: "#24452f", strokeWidth: 0.06, chamfer: 0, tagInk: "#24452f", subtitle: "#6b7a6f" },
    wire: { power: "#24452f", ground: "#24452f", digital: "#24452f", i2c: "#24452f", usb: "#24452f", analog: "#24452f" },
    wireWidth: 0.1,
    symbolStroke: 0.5,
    ref: "#24452f",
    value: "#4b5f50",
    pinName: "#24452f",
    pinNumber: "#6b7a6f",
    label: { style: "flag", fill: "none" },
    nc: "#24452f",
    variants: {},
    severity: { error: "#b3261e", warning: "#a66a00", info: "#6b7a6f", gate: "#b3261e" },
    highlight: "#1d5fbf",
    frame: true,
    ghost: { before: "#a39e8e", after: "#2b6fd6", dash: "0.5 0.3" },
  },
};

/** A net's color class: rails and ground by kind, then I2C, USB and analog by the pins on it, else digital. */
export function signalClassOf(doc: SchematicDocument, net: string): SignalClass {
  const n = doc.nets.get(net);
  if (!n) return "digital";
  if (n.kind === "ground") return "ground";
  if (n.kind === "power") return "power";
  const pins = n.pins.map((k) => {
    const { part, pin } = splitPinKey(k);
    return doc.parts.get(part)?.pins.find((p) => p.id === pin);
  });
  const caps = pins.flatMap((p) => p?.capabilities ?? []);
  if (caps.some((c) => /^i2c/.test(c)) || /I2C|SDA|SCL/i.test(net)) return "i2c";
  if (caps.some((c) => /^usb/.test(c)) || /USB|D[PN+-]$/i.test(net)) return "usb";
  if (pins.some((p) => p?.type === "analog_in" || p?.type === "analog_out")) return "analog";
  return "digital";
}

export interface Marker {
  n: number;
  at: XY;
  severity: "gate" | "error" | "warning" | "info";
}

export interface RenderOptions {
  theme?: "dark" | "paper";
  tokens?: Partial<ThemeTokens>;
  /** screen pixels per grid unit (default 16) */
  scale?: number;
  /** draw only this box (grid units), e.g. a card with a halo */
  crop?: LBox;
  /** numbered rings (defects and findings) */
  markers?: Marker[];
  /** one net highlighted, the rest faded */
  highlight?: string;
  /** title block fields (paper) */
  titleBlock?: { title?: string; rev?: string; date?: string; sheet?: string; source?: string; generator?: string; checked?: string };
  notes?: string[];
  /**
   * Draw a proposal as a ghost on top of the sheet: `{ proposal: "prop:..." }` names a proposal record in the
   * document, `{ ops }` gives operation calls directly. The calls are applied to a copy (as `proposal.add`'s dry
   * run does) and the result is compared with the document: each changed or removed symbol, wire, label, power
   * symbol, card and no-connect mark is outlined where it is now (`ghost.before`, faint dashed), each added or
   * changed one is drawn where it would be (`ghost.after`, dashed blue), and a moved symbol gets a dashed arrow
   * from its old body center to its new one. Changes to `pinned` or provenance alone draw nothing. The ghost is
   * one `<g data-ghost="...">` group added after the sheet's own content; without a crop or page the view grows
   * to hold it. A call that the document refuses throws its `OpError`.
   */
  ghost?: GhostSource;
  /**
   * Draw one print page (from `paginateSchematic`): the view is the page's crop, only the page's cards and their
   * content are drawn, and in a theme with a frame (paper) the frame, zones and title block are drawn on the page
   * with the sheet field set to "n of N". Notes are not drawn on pages. Takes precedence over `crop`.
   */
  page?: SchematicPage;
}

/** What a ghost draws: a proposal record in the document by id, or operation calls. */
export type GhostSource = { proposal: string } | { ops: OpCall[] };

/** The ids a proposal changes, by drawn record kind (sorted), and the document it would give. */
export interface GhostDiff {
  after: SchematicDocument;
  added: string[];
  changed: string[];
  removed: string[];
}

const GHOST_KINDS: ReadonlySet<SchematicRecord["kind"]> = new Set(["card", "symbol", "wire", "label", "power", "noconnect"]);

/** How a record looks: everything but `pinned` and provenance. */
const looks = (r: SchematicRecord): string => {
  const { pinned: _p, provenance: _v, ...rest } = r as SchematicRecord & { pinned?: true; provenance?: unknown };
  return canonical(rest);
};

/** Apply a ghost's calls to a copy of the document (deterministic ids `<prefix>:ghost.<n>`) and diff the drawn records. */
export function ghostDiff(doc: SchematicDocument, source: GhostSource): GhostDiff {
  let ops: OpCall[];
  if ("proposal" in source) {
    const p = doc.records.get(source.proposal);
    if (p?.kind !== "proposal") throw new Error(`no proposal ${source.proposal} on this schematic`);
    ops = p.ops as OpCall[];
  } else ops = source.ops;
  let n = 0;
  const ctx: ApplyContext = { actor: { kind: "agent", id: "ghost" }, issueId: (kind) => `${ID_PREFIX[kind]}:ghost.${++n}`, provenance: { by: "agent", actor: "agent:ghost" }, edited: "agent", pinMoves: false };
  const after = applyCalls(doc, ops, ctx);
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, r] of after.records) {
    if (!GHOST_KINDS.has(r.kind)) continue;
    const o = doc.records.get(id);
    if (!o) added.push(id);
    else if (o !== r && looks(o) !== looks(r)) changed.push(id);
  }
  for (const [id, r] of doc.records) if (GHOST_KINDS.has(r.kind) && !after.records.has(id)) removed.push(id);
  return { after, added: added.sort(byCodeUnit), changed: changed.sort(byCodeUnit), removed: removed.sort(byCodeUnit) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const f = (v: number) => {
  const s = (Math.round(v * 1000) / 1000).toString();
  return s === "-0" ? "0" : s;
};

const ROT: Record<Rotation, [number, number, number, number]> = { 0: [1, 0, 0, 1], 90: [0, -1, 1, 0], 180: [-1, 0, 0, -1], 270: [0, 1, -1, 0] };

/** The SVG transform that maps symbol frame pixels to the sheet: at + R * M * ((px - 2) / 5). */
function symbolTransform(at: XY, rot: Rotation, mirror: boolean): string {
  const [a, b, c, d] = ROT[rot];
  const m = mirror ? -1 : 1;
  // R * M: columns of R with the first one negated when mirrored
  return `translate(${f(at[0])} ${f(at[1])}) matrix(${f(a * m)} ${f(b * m)} ${f(c)} ${f(d)} 0 0) scale(${f(1 / UNIT)}) translate(${-MARGIN} ${-MARGIN})`;
}

function elementMarkup(el: BodyElement, ink: string, sw: number, colors: { pinName: string; pinNumber: string; ink: string }): string {
  const stroke = `fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (el.el) {
    case "path":
      return `<path d="${el.d}" ${el.role === "dot" ? `fill="${ink}" stroke="none"` : stroke}/>`;
    case "line":
      return `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" ${stroke}/>`;
    case "polyline":
      return `<polyline points="${el.points}" ${stroke}/>`;
    case "polygon":
      return `<polygon points="${el.points}" ${stroke}/>`;
    case "circle":
      return `<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}" ${el.role === "dot" ? `fill="${ink}" stroke="none"` : stroke}/>`;
    case "ellipse":
      return `<ellipse cx="${el.cx}" cy="${el.cy}" rx="${el.rx}" ry="${el.ry}" ${stroke}/>`;
    case "rect":
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}"${el.rx ? ` rx="${el.rx}"` : ""} ${stroke}/>`;
    case "text": {
      const size = el.size ?? 3;
      const h = size * 0.72;
      const color = el.role === "pin-number" ? colors.pinNumber : el.role === "pin-name" ? colors.pinName : colors.ink;
      const anchor = el.anchor === "middle" ? "center" : el.anchor === "end" ? "right" : "left";
      return `<path d="${textPath(el.text ?? "", el.x!, el.y! - h / 2, h, anchor)}" fill="none" stroke="${color}" stroke-width="${f(h * 0.12)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
}

const textMark = (t: TextBox, color: string, weight = 0.11): string => `<path d="${textPath(t.text, t.x, t.y, t.h, t.anchor, t.angle ?? 0)}" fill="none" stroke="${color}" stroke-width="${f(t.h * weight)}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Render a schematic as SVG. */
export function renderSchematicSvg(doc: SchematicDocument, options: RenderOptions = {}): string {
  const T: ThemeTokens = { ...THEMES[options.theme ?? "dark"], ...(options.tokens ?? {}) } as ThemeTokens;
  const scale = options.scale ?? 16;
  const g = geometryOf(doc);
  const page = options.page;
  const pageCards = page ? new Set(page.cards) : undefined;
  const inPage = (card: string | undefined): boolean => !pageCards || (card !== undefined && pageCards.has(card));
  const cards = recordsOfKind(doc, "card").filter((c) => inPage(c.id));
  const cardBoxes = cards.map((c) => ({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h }));
  const onPage = (p: XY, tol: number): boolean => !pageCards || cardBoxes.some((b) => p[0] >= b.x0 - tol && p[0] <= b.x1 + tol && p[1] >= b.y0 - tol && p[1] <= b.y1 + tol);
  const wires = recordsOfKind(doc, "wire").filter((w) => inPage(w.card));
  const labels = recordsOfKind(doc, "label").filter((l) => inPage(l.card));
  const powers = recordsOfKind(doc, "power").filter((p) => inPage(p.card));
  const symbols = [...g.symbols.values()].filter((s) => inPage(s.rec.card)).sort((a, b) => byCodeUnit(a.rec.id, b.rec.id));
  const ghost = options.ghost ? ghostDiff(doc, options.ghost) : undefined;
  const ghostExtent = ghost && !page && !options.crop ? ghostBoxes(ghost) : [];
  const sheetBox = unionBoxes([...cardBoxes, ...symbols.map((s) => s.full), ...ghostExtent]);
  const pad = T.frame ? PAPER_PAD : 3;
  const tbH = T.frame ? TITLE_BLOCK_H : 0;
  const notesH = T.frame && !page && options.notes?.length ? 2 + options.notes.length * 1.4 : 0;
  const view = page?.crop ?? options.crop ?? { x0: sheetBox.x0 - pad, y0: sheetBox.y0 - pad, x1: sheetBox.x1 + pad, y1: sheetBox.y1 + pad + tbH + notesH };
  const W = view.x1 - view.x0;
  const H = view.y1 - view.y0;
  const cls = (net: string) => signalClassOf(doc, net);
  const dimmed = (net: string) => options.highlight !== undefined && net !== options.highlight;
  const colorOf = (net: string) => (options.highlight === net ? T.highlight : T.wire[cls(net)]);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f(W * scale)}" height="${f(H * scale)}" viewBox="${f(view.x0)} ${f(view.y0)} ${f(W)} ${f(H)}"${page ? ` data-page="${page.n}" data-pages="${page.of}"` : ""}>`);
  out.push(`<rect x="${f(view.x0)}" y="${f(view.y0)}" width="${f(W)}" height="${f(H)}" fill="${T.background}"/>`);

  // print frame with zones and title block (a plain crop has none; a page has its own)
  if (T.frame && (page || !options.crop)) {
    const head = doc.records.get("schematic");
    const rec = head?.kind === "schematic" ? head.title_block : undefined;
    const tb = { ...(rec?.title ? { title: rec.title } : {}), ...(rec?.rev ? { rev: rec.rev } : {}), ...(rec?.date ? { date: rec.date } : {}), source: head?.kind === "schematic" ? head.source.board : "", ...(options.titleBlock ?? {}), ...(page ? { sheet: `${page.n} of ${page.of}` } : {}) };
    const { notes: _n, ...rest } = options;
    out.push(printFrame(view, T, page ? { ...rest, titleBlock: tb } : { ...options, titleBlock: tb }, notesH));
  }

  // cards
  for (const c of cards) out.push(cardMarkup(c, T));

  // wires
  const wireMarks: string[] = [];
  for (const w of wires) {
    const pts = w.points.map((p) => `${f(p[0])},${f(p[1])}`).join(" ");
    wireMarks.push(`<polyline points="${pts}" fill="none" stroke="${colorOf(w.net)}" stroke-width="${T.wireWidth}" stroke-linecap="round" stroke-linejoin="round"${dimmed(w.net) ? ' opacity="0.25"' : ""}/>`);
  }
  out.push(`<g>${wireMarks.join("")}</g>`);
  for (const j of g.junctions) if (onPage(j.at, 0.5)) out.push(`<circle cx="${f(j.at[0])}" cy="${f(j.at[1])}" r="0.22" fill="${colorOf(j.net)}"${dimmed(j.net) ? ' opacity="0.25"' : ""}/>`);

  // symbols
  const pack = packSymbols();
  for (const s of symbols) out.push(symbolMarkup(doc, s, T));

  // power symbols
  for (const p of powers) out.push(powerMarkup(doc, p, T, colorOf(p.net), dimmed(p.net), pack));
  // labels
  for (const l of labels) out.push(labelMarkup(doc, l, T, colorOf(l.net), dimmed(l.net)));
  // no-connect marks
  for (const nc of recordsOfKind(doc, "noconnect")) {
    const p = g.pins.get(nc.pin);
    if (!p) continue;
    if (pageCards && !inPage(g.symbols.get(`sym:${p.part}`)?.rec.card)) continue;
    out.push(ncMark(p.at, T.nc));
  }
  // the proposal's ghost, on top of the sheet
  if (ghost) out.push(ghostMarkup(doc, ghost, T, options.ghost!, inPage, pack));
  // markers
  for (const m of options.markers ?? []) {
    if (!onPage(m.at, 2)) continue;
    const color = T.severity[m.severity];
    const [x, y] = m.at;
    out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="1.3" fill="none" stroke="${color}" stroke-width="0.16"/>`);
    const bx = x + 1.1;
    const by = y - 1.1;
    const txt = String(m.n);
    const w = Math.max(1.1, textWidth(txt, 0.7) + 0.6);
    out.push(`<rect x="${f(bx - w / 2)}" y="${f(by - 0.55)}" width="${f(w)}" height="1.1" rx="0.55" fill="${T.name === "dark" ? "#e8e6df" : "#ffffff"}" stroke="${color}" stroke-width="0.08"/>`);
    out.push(`<path d="${textPath(txt, bx, by, 0.6, "center")}" fill="none" stroke="#131313" stroke-width="0.09" stroke-linecap="round"/>`);
  }
  out.push("</svg>");
  return out.join("");
}

/**
 * Print pages: `paginateSchematic(doc, options)` and one SVG per page in the paper theme (unless `theme` says
 * otherwise), each with its frame, zones and a title block whose sheet field reads "n of N". The root element
 * carries `data-page` and `data-pages`; the title block group carries `data-sheet`.
 */
export function renderSchematicPages(doc: SchematicDocument, options: Omit<RenderOptions, "page" | "crop"> & PaginateOptions = {}): string[] {
  const { paper, orientation, margin, ...render } = options;
  const pages = paginateSchematic(doc, { ...(paper ? { paper } : {}), ...(orientation ? { orientation } : {}), ...(margin !== undefined ? { margin } : {}) });
  return pages.map((page) => renderSchematicSvg(doc, { ...render, theme: render.theme ?? "paper", page }));
}

function ncMark(at: XY, color: string, extra = ""): string {
  const [x, y] = at;
  const s = 0.45;
  return `<path d="M${f(x - s)} ${f(y - s)}L${f(x + s)} ${f(y + s)}M${f(x - s)} ${f(y + s)}L${f(x + s)} ${f(y - s)}" stroke="${color}" stroke-width="0.1" stroke-linecap="round"${extra}/>`;
}

// ------------------------------------------------------------------ proposal ghosts

/** The boxes a ghost's after state covers (so the view can hold it). */
function ghostBoxes(d: GhostDiff): LBox[] {
  const ga = geometryOf(d.after);
  const out: LBox[] = [];
  for (const id of [...d.added, ...d.changed]) {
    const r = d.after.records.get(id)!;
    switch (r.kind) {
      case "symbol": {
        const s = ga.symbols.get(id);
        if (s) out.push(s.full, s.ref, ...(s.value ? [s.value] : []));
        break;
      }
      case "card":
        out.push({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
        break;
      case "wire": {
        const xs = r.points.map((p) => p[0]);
        const ys = r.points.map((p) => p[1]);
        out.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
        break;
      }
      case "label":
        out.push(labelBox(r, d.after));
        break;
      case "power": {
        const b = powerBoxes(r, d.after);
        out.push(b.glyph, ...(b.text ? [b.text] : []));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** A dash array in grid units scaled to another frame (symbol frame pixels are `UNIT` per grid unit). */
const scaleDash = (dash: string, k: number): string =>
  dash
    .trim()
    .split(/[\s,]+/)
    .map((v) => f(Number(v) * k))
    .join(" ");

const rectOf = (b: LBox, attrs: string): string => `<rect x="${f(b.x0)}" y="${f(b.y0)}" width="${f(b.x1 - b.x0)}" height="${f(b.y1 - b.y0)}" ${attrs}/>`;

/** A symbol where it is now: its body box and pin leads, dashed. */
function ghostBefore(s: PlacedSymbol, attrs: string): string {
  const parts = [rectOf(s.body, attrs)];
  for (const p of s.pins) {
    const [x, y] = p.at;
    const e: XY = p.dir === "left" ? [s.body.x0, y] : p.dir === "right" ? [s.body.x1, y] : p.dir === "up" ? [x, s.body.y0] : [x, s.body.y1];
    if (Math.abs(e[0] - x) + Math.abs(e[1] - y) > 1e-6) parts.push(`<path d="M${f(x)} ${f(y)}L${f(e[0])} ${f(e[1])}" ${attrs}/>`);
  }
  return parts.join("");
}

/** A symbol where it would be: its drawn body (no pin text) dashed, and its reference. */
function ghostAfter(s: PlacedSymbol, T: ThemeTokens, color: string): string {
  const variant = s.rec.variant ?? T.variants[s.part.class];
  const r = variant && variant !== s.resolved.variant ? resolveSymbol(s.part, { variant, ...(s.rec.symbol ? { symbol: s.rec.symbol } : {}) }) : s.resolved;
  const els = r.body.filter((e) => e.el !== "text").map((e) => elementMarkup(e, color, T.symbolStroke, { pinName: color, pinNumber: color, ink: color }));
  return `<g transform="${symbolTransform([s.rec.x, s.rec.y], s.rec.rotation, !!s.rec.mirror)}" stroke-dasharray="${scaleDash(T.ghost.dash, UNIT)}">${els.join("")}</g>${textMark(s.ref, color, 0.13)}`;
}

function ghostArrow(from: XY, to: XY, color: string, dash: string): string {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return "";
  const [ux, uy] = [dx / len, dy / len];
  const head = Math.min(0.8, len / 2);
  const w = head * 0.5;
  const bx = to[0] - ux * head;
  const by = to[1] - uy * head;
  return (
    `<path d="M${f(from[0])} ${f(from[1])}L${f(bx)} ${f(by)}" fill="none" stroke="${color}" stroke-width="0.07" stroke-dasharray="${dash}" stroke-linecap="round"/>` +
    `<path d="M${f(to[0])} ${f(to[1])}L${f(bx - uy * w)} ${f(by + ux * w)}L${f(bx + uy * w)} ${f(by - ux * w)}Z" fill="${color}" stroke="none"/>`
  );
}

function ghostMarkup(doc: SchematicDocument, d: GhostDiff, T: ThemeTokens, source: GhostSource, inPage: (card: string | undefined) => boolean, pack: ReturnType<typeof packSymbols>): string {
  const gb = geometryOf(doc);
  const ga = geometryOf(d.after);
  const { before: cb, after: ca, dash } = T.ghost;
  const thin = `fill="none" stroke="${cb}" stroke-width="0.07" stroke-dasharray="${dash}" stroke-linecap="round" stroke-linejoin="round"`;
  const bold = `fill="none" stroke="${ca}" stroke-width="0.09" stroke-dasharray="${dash}" stroke-linecap="round" stroke-linejoin="round"`;
  const cardOf = (r: SchematicRecord | undefined, g: ReturnType<typeof geometryOf>): string | undefined => {
    if (!r) return undefined;
    if (r.kind === "card") return r.id;
    if (r.kind === "noconnect") {
      const p = g.pins.get(r.pin);
      return p ? g.symbols.get(`sym:${p.part}`)?.rec.card : undefined;
    }
    return "card" in r ? r.card : undefined;
  };
  const before: string[] = [];
  for (const id of [...d.changed, ...d.removed]) {
    const r = doc.records.get(id)!;
    if (!inPage(cardOf(r, gb))) continue;
    switch (r.kind) {
      case "symbol": {
        const s = gb.symbols.get(id);
        if (s) before.push(ghostBefore(s, thin));
        break;
      }
      case "card":
        before.push(rectOf({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }, thin));
        break;
      case "wire":
        before.push(`<polyline points="${r.points.map((p) => `${f(p[0])},${f(p[1])}`).join(" ")}" ${thin}/>`);
        break;
      case "label":
        before.push(rectOf(labelBox(r, doc), thin));
        break;
      case "power":
        before.push(rectOf(powerBoxes(r, doc).glyph, thin));
        break;
      case "noconnect": {
        const p = gb.pins.get(r.pin);
        if (p) before.push(ncMark(p.at, cb, ` stroke-dasharray="${dash}"`));
        break;
      }
      default:
        break;
    }
  }
  const after: string[] = [];
  const arrows: string[] = [];
  for (const id of [...d.added, ...d.changed]) {
    const r = d.after.records.get(id)!;
    if (!inPage(cardOf(r, ga))) continue;
    switch (r.kind) {
      case "symbol": {
        const s = ga.symbols.get(id);
        if (!s) break;
        after.push(ghostAfter(s, T, ca));
        const old = gb.symbols.get(id);
        if (old && (old.center[0] !== s.center[0] || old.center[1] !== s.center[1])) arrows.push(ghostArrow(old.center, s.center, ca, dash));
        break;
      }
      case "card":
        after.push(rectOf({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }, bold));
        break;
      case "wire":
        after.push(`<polyline points="${r.points.map((p) => `${f(p[0])},${f(p[1])}`).join(" ")}" fill="none" stroke="${ca}" stroke-width="${f(T.wireWidth * 1.2)}" stroke-dasharray="${dash}" stroke-linecap="round" stroke-linejoin="round"/>`);
        break;
      case "label": {
        const b = labelBox(r, doc);
        const rx = T.label.style === "pill" && r.scope === "port" ? ` rx="${f(Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2)}"` : "";
        after.push(`<rect x="${f(b.x0)}" y="${f(b.y0)}" width="${f(b.x1 - b.x0)}" height="${f(b.y1 - b.y0)}"${rx} ${bold}/>`, textMark(b, ca));
        break;
      }
      case "power": {
        const def = pack.get(r.style === "ground" ? "ground" : "power-rail")!;
        const pin = def.pins[0];
        const natural = r.style === "ground" ? "down" : "up";
        const rot: Rotation = r.dir === natural ? 0 : 180;
        const at: XY = rot === 0 ? [r.x - pin.at[0], r.y - pin.at[1]] : [r.x + pin.at[0], r.y + pin.at[1]];
        const els = def.body.map((e) => elementMarkup(e, ca, T.symbolStroke, { pinName: ca, pinNumber: ca, ink: ca })).join("");
        after.push(`<g transform="${symbolTransform(at, rot, false)}" stroke-dasharray="${scaleDash(dash, UNIT)}">${els}</g>`);
        const b = powerBoxes(r, doc);
        if (b.text && (r.style !== "ground" || showGroundName(r.net))) after.push(textMark(b.text, ca));
        break;
      }
      case "noconnect": {
        const p = ga.pins.get(r.pin);
        if (p) after.push(ncMark(p.at, ca));
        break;
      }
      default:
        break;
    }
  }
  const label = "proposal" in source ? source.proposal : "ops";
  return `<g data-ghost="${esc(label)}"><g data-ghost-layer="before" opacity="0.85">${before.join("")}</g><g data-ghost-layer="after">${after.join("")}${arrows.join("")}</g></g>`;
}

function cardMarkup(c: CardRecT, T: ThemeTokens): string {
  const { x, y, w, h } = c;
  const k = T.card.chamfer;
  const shape = k
    ? `<path d="M${f(x + k)} ${f(y)}H${f(x + w - k)}L${f(x + w)} ${f(y + k)}V${f(y + h - k)}L${f(x + w - k)} ${f(y + h)}H${f(x + k)}L${f(x)} ${f(y + h - k)}V${f(y + k)}Z" fill="${T.card.fill}" stroke="${T.card.stroke}" stroke-width="${T.card.strokeWidth}"/>`
    : `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${T.card.fill}" stroke="${T.card.stroke}" stroke-width="${T.card.strokeWidth}"/>`;
  const tb = cardTitleBoxes(c);
  const parts = [shape];
  if (T.card.tagFill) parts.push(`<rect x="${f(tb.tag.x0)}" y="${f(tb.tag.y0)}" width="${f(tb.tag.x1 - tb.tag.x0)}" height="${f(tb.tag.y1 - tb.tag.y0)}" fill="${T.card.tagFill}"/>`);
  parts.push(textMark(tb.title, T.card.tagInk, 0.13));
  if (tb.subtitle) parts.push(textMark(tb.subtitle, T.card.subtitle));
  return parts.join("");
}

/** A symbol's markup in its three layers: the drawn body, the text inside its frame (pin names and numbers), and its fields. */
function symbolParts(s: PlacedSymbol, T: ThemeTokens): { transform: string; body: string; pinText: string; fields: string } {
  const variant = s.rec.variant ?? T.variants[s.part.class];
  const r = variant && variant !== s.resolved.variant ? resolveSymbol(s.part, { variant, ...(s.rec.symbol ? { symbol: s.rec.symbol } : {}) }) : s.resolved;
  const tr = symbolTransform([s.rec.x, s.rec.y], s.rec.rotation, !!s.rec.mirror);
  const ink = T.ink;
  const drawn = r.body.filter((e) => e.el !== "text").map((e) => elementMarkup(e, ink, T.symbolStroke, { pinName: T.pinName, pinNumber: T.pinNumber, ink }));
  const text = r.body.filter((e) => e.el === "text").map((e) => elementMarkup(e, ink, T.symbolStroke, { pinName: T.pinName, pinNumber: T.pinNumber, ink }));
  return { transform: tr, body: drawn.join(""), pinText: text.join(""), fields: textMark(s.ref, T.ref, 0.13) + (s.value ? textMark(s.value, T.value) : "") };
}

function symbolMarkup(doc: SchematicDocument, s: PlacedSymbol, T: ThemeTokens): string {
  const p = symbolParts(s, T);
  return `<g transform="${p.transform}">${p.body}${p.pinText}</g>${p.fields}`;
}

// ------------------------------------------------------------------ item by item (the editor screen)

/** What `drawRecord` and `drawGhost` take: the theme and token overrides, as `renderSchematicSvg` does. */
export interface DrawOptions {
  theme?: "dark" | "paper";
  tokens?: Partial<ThemeTokens>;
}

/** The tokens a theme and its overrides give. */
export const themeTokens = (o: DrawOptions = {}): ThemeTokens => ({ ...THEMES[o.theme ?? "dark"], ...(o.tokens ?? {}) }) as ThemeTokens;

/**
 * One drawn record's markup in sheet coordinates (grid units), exactly as `renderSchematicSvg` draws it, so a screen
 * that draws the sheet item by item and the exported image cannot drift. A symbol comes in layers (`svg` is the
 * body, `pinText` its pin names and numbers in the symbol's own frame, `fields` its reference and value); `color`
 * overrides a net item's class color (a highlighted net). Text notes, frames and proposals are not drawn (as the
 * full render does not draw them); undefined for those and for records the document cannot place.
 */
export function drawRecord(doc: SchematicDocument, rec: SchematicRecord, o: DrawOptions & { color?: string } = {}): { svg: string; pinText?: string; transform?: string; fields?: string } | undefined {
  const T = themeTokens(o);
  const colorOf = (net: string) => o.color ?? T.wire[signalClassOf(doc, net)];
  switch (rec.kind) {
    case "card":
      return { svg: cardMarkup(rec, T) };
    case "symbol": {
      const s = geometryOf(doc).symbols.get(rec.id);
      if (!s) return undefined;
      const p = symbolParts(s, T);
      return { svg: `<g transform="${p.transform}">${p.body}</g>`, pinText: p.pinText, transform: p.transform, fields: p.fields };
    }
    case "wire":
      return { svg: `<polyline points="${rec.points.map((p) => `${f(p[0])},${f(p[1])}`).join(" ")}" fill="none" stroke="${colorOf(rec.net)}" stroke-width="${T.wireWidth}" stroke-linecap="round" stroke-linejoin="round"/>` };
    case "label":
      return { svg: labelMarkup(doc, rec, T, colorOf(rec.net), false) };
    case "power":
      return { svg: powerMarkup(doc, rec, T, colorOf(rec.net), false, packSymbols()) };
    case "noconnect": {
      const p = geometryOf(doc).pins.get(rec.pin);
      return p ? { svg: ncMark(p.at, T.nc) } : undefined;
    }
    default:
      return undefined;
  }
}

/** A ghost's group (`<g data-ghost>`) for a diff from `ghostDiff`, or between two documents, as `renderSchematicSvg`'s `ghost` draws it. */
export function drawGhost(doc: SchematicDocument, diff: GhostDiff, o: DrawOptions & { label?: string } = {}): string {
  return ghostMarkup(doc, diff, themeTokens(o), o.label ? { proposal: o.label } : { ops: [] }, () => true, packSymbols());
}

/** The drawn records two documents differ in (`after` is the second), in `ghostDiff`'s form: what a ghost of the change draws. */
export function diffDrawn(before: SchematicDocument, after: SchematicDocument): GhostDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, r] of after.records) {
    if (!GHOST_KINDS.has(r.kind)) continue;
    const o = before.records.get(id);
    if (!o) added.push(id);
    else if (o !== r && looks(o) !== looks(r)) changed.push(id);
  }
  for (const [id, r] of before.records) if (GHOST_KINDS.has(r.kind) && !after.records.has(id)) removed.push(id);
  return { after, added: added.sort(byCodeUnit), changed: changed.sort(byCodeUnit), removed: removed.sort(byCodeUnit) };
}

function powerMarkup(doc: SchematicDocument, p: PowerRecT, T: ThemeTokens, color: string, dim: boolean, pack: ReturnType<typeof packSymbols>): string {
  const def = pack.get(p.style === "ground" ? "ground" : "power-rail")!;
  const pin = def.pins[0];
  // the glyph's own direction: ground points down, the rail up; turn it when the record says otherwise
  const natural = p.style === "ground" ? "down" : "up";
  const rot: Rotation = p.dir === natural ? 0 : 180;
  const at: XY = rot === 0 ? [p.x - pin.at[0], p.y - pin.at[1]] : [p.x + pin.at[0], p.y + pin.at[1]];
  const els = def.body.map((e) => elementMarkup(e, color, T.symbolStroke, { pinName: color, pinNumber: color, ink: color })).join("");
  const parts = [`<g transform="${symbolTransform(at, rot, false)}"${dim ? ' opacity="0.25"' : ""}>${els}</g>`];
  const b = powerBoxes(p, doc);
  if (b.text) parts.push(textMark(b.text, color));
  return parts.join("");
}

function labelMarkup(doc: SchematicDocument, l: LabelRecT, T: ThemeTokens, color: string, dim: boolean): string {
  const b = labelBox(l, doc);
  const op = dim ? ' opacity="0.25"' : "";
  const parts: string[] = [];
  if (T.label.style === "pill" && l.scope === "port") {
    const r = Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2;
    parts.push(`<rect x="${f(b.x0)}" y="${f(b.y0)}" width="${f(b.x1 - b.x0)}" height="${f(b.y1 - b.y0)}" rx="${f(r)}" fill="${T.label.fill}" stroke="${color}" stroke-width="0.09"${op}/>`);
  } else if (l.scope === "port") {
    // a flag pointing at its anchor
    const { x0, y0, x1, y1 } = b;
    const k = 0.6;
    const d =
      l.side === "right"
        ? `M${f(x0)} ${f((y0 + y1) / 2)}L${f(x0 + k)} ${f(y0)}H${f(x1)}V${f(y1)}H${f(x0 + k)}Z`
        : l.side === "left"
          ? `M${f(x1)} ${f((y0 + y1) / 2)}L${f(x1 - k)} ${f(y0)}H${f(x0)}V${f(y1)}H${f(x1 - k)}Z`
          : l.side === "up"
            ? `M${f((x0 + x1) / 2)} ${f(y1)}L${f(x0)} ${f(y1 - k)}V${f(y0)}H${f(x1)}V${f(y1 - k)}Z`
            : `M${f((x0 + x1) / 2)} ${f(y0)}L${f(x0)} ${f(y0 + k)}V${f(y1)}H${f(x1)}V${f(y0 + k)}Z`;
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="0.07"${op}/>`);
  }
  parts.push(`<g${op}>${textMark(b, color)}</g>`);
  return parts.join("");
}

function printFrame(view: LBox, T: ThemeTokens, o: RenderOptions, notesH: number): string {
  const m = 1.5;
  const x0 = view.x0 + m;
  const y0 = view.y0 + m;
  const x1 = view.x1 - m;
  const y1 = view.y1 - m;
  const z = 1.6;
  const parts: string[] = [];
  const st = `fill="none" stroke="${T.ink}" stroke-width="0.08"`;
  parts.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" ${st}/>`);
  parts.push(`<rect x="${f(x0 + z)}" y="${f(y0 + z)}" width="${f(x1 - x0 - 2 * z)}" height="${f(y1 - y0 - 2 * z)}" ${st}/>`);
  const cols = 6;
  const rows = 4;
  for (let i = 0; i <= cols; i++) {
    const x = x0 + z + ((x1 - x0 - 2 * z) * i) / cols;
    if (i > 0 && i < cols) parts.push(`<path d="M${f(x)} ${f(y0)}V${f(y0 + z)}M${f(x)} ${f(y1 - z)}V${f(y1)}" ${st}/>`);
    if (i < cols) {
      const cx = x + (x1 - x0 - 2 * z) / cols / 2;
      parts.push(textMark({ text: String(i + 1), h: 0.7, x: cx, y: y0 + z / 2, anchor: "center", x0: 0, y0: 0, x1: 0, y1: 0 }, T.ink));
      parts.push(textMark({ text: String(i + 1), h: 0.7, x: cx, y: y1 - z / 2, anchor: "center", x0: 0, y0: 0, x1: 0, y1: 0 }, T.ink));
    }
  }
  for (let j = 0; j <= rows; j++) {
    const y = y0 + z + ((y1 - y0 - 2 * z) * j) / rows;
    if (j > 0 && j < rows) parts.push(`<path d="M${f(x0)} ${f(y)}H${f(x0 + z)}M${f(x1 - z)} ${f(y)}H${f(x1)}" ${st}/>`);
    if (j < rows) {
      const cy = y + (y1 - y0 - 2 * z) / rows / 2;
      const ch = "ABCD"[j];
      parts.push(textMark({ text: ch, h: 0.7, x: x0 + z / 2, y: cy, anchor: "center", x0: 0, y0: 0, x1: 0, y1: 0 }, T.ink));
      parts.push(textMark({ text: ch, h: 0.7, x: x1 - z / 2, y: cy, anchor: "center", x0: 0, y0: 0, x1: 0, y1: 0 }, T.ink));
    }
  }
  // title block, bottom right
  const tb = o.titleBlock ?? {};
  const bw = 46;
  const bh = 8;
  const bx = x1 - z - bw;
  const by = y1 - z - bh;
  parts.push(`<g data-title-block="" data-sheet="${esc(tb.sheet ?? "1 of 1")}">`);
  parts.push(`<rect x="${f(bx)}" y="${f(by)}" width="${bw}" height="${bh}" ${st}/>`);
  parts.push(`<path d="M${f(bx)} ${f(by + 3)}H${f(bx + bw)}M${f(bx)} ${f(by + 5.5)}H${f(bx + bw)}M${f(bx + 30)} ${f(by)}V${f(by + 3)}M${f(bx + 38)} ${f(by)}V${f(by + 3)}M${f(bx + 30)} ${f(by + 5.5)}V${f(by + bh)}" ${st}/>`);
  const small = (t: string, x: number, y: number) => textMark({ text: t, h: 0.45, x, y, anchor: "left", x0: 0, y0: 0, x1: 0, y1: 0 }, T.dim);
  const big = (t: string, x: number, y: number, h = 0.8) => textMark({ text: t, h, x, y, anchor: "left", x0: 0, y0: 0, x1: 0, y1: 0 }, T.ink, 0.12);
  parts.push(small("PROJECT", bx + 0.6, by + 0.7), big(tb.title ?? "", bx + 0.6, by + 1.9, 0.9));
  parts.push(small("REV", bx + 30.6, by + 0.7), big(tb.rev ?? "", bx + 30.6, by + 1.9));
  parts.push(small("SHEET", bx + 38.6, by + 0.7), big(tb.sheet ?? "1 of 1", bx + 38.6, by + 1.9));
  parts.push(small("SOURCE", bx + 0.6, by + 3.6), big(tb.source ?? "", bx + 0.6, by + 4.7, 0.6));
  parts.push(small("DRAWN", bx + 0.6, by + 6.1), big(tb.generator ?? "rules and forces", bx + 0.6, by + 7.2, 0.6));
  parts.push(small("DATE", bx + 30.6, by + 6.1), big(tb.date ?? "", bx + 30.6, by + 7.2, 0.6));
  if (tb.checked) parts.push(small("CHECKED", bx + 0.6 + 15, by + 6.1), big(tb.checked, bx + 15.6, by + 7.2, 0.6));
  parts.push("</g>");
  // notes, bottom left
  if (o.notes?.length) {
    const nx = x0 + z + 1;
    let ny = y1 - z - notesH + 1;
    parts.push(big("NOTES", nx, ny, 0.7));
    for (const [i, n] of o.notes.entries()) {
      ny += 1.4;
      parts.push(textMark({ text: `${i + 1}. ${n}`, h: 0.55, x: nx, y: ny, anchor: "left", x0: 0, y0: 0, x1: 0, y1: 0 }, T.ink));
    }
  }
  return parts.join("");
}

/** A card's crop box with a halo (one card's width of neighbors is not drawn; `halo` grid units are). */
export function cardCrop(doc: SchematicDocument, card: string, halo = 4): LBox | undefined {
  const c = doc.records.get(card);
  if (c?.kind !== "card") return undefined;
  return inflateBox({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h }, halo);
}

