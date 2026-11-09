/**
 * Pagination for print (contract section 13, paper theme): whole cards packed onto paper sheets. A card is never
 * split; cards keep their sheet coordinates, so a page is a window (its `crop`) onto the sheet and labels that
 * join cards read the same on every page. Pages follow the cards' sheet positions in reading order: columns left
 * to right, each column top to bottom.
 */
import { byCodeUnit } from "@protoboardai/board";
import { recordsOfKind, type SchematicDocument } from "../document.ts";
import { geometryOf, labelBox, powerBoxes, unionBoxes } from "../geometry.ts";
import type { LBox } from "../symbols.ts";
import { GU_MM } from "../units.ts";

export type PaperSize = "A4" | "A3" | "A2";

/** ISO 216 sheet sizes in millimeters, long side first. */
export const PAPER_MM: Record<PaperSize, readonly [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420] };

/** The paper theme's clearance between the sheet edge and the cards (grid units): frame margin, zone strip and air. */
export const PAPER_PAD = 6;
/** The height the paper theme reserves under the cards for the title block (grid units). */
export const TITLE_BLOCK_H = 9;

export interface PaginateOptions {
  /** default A4 */
  paper?: PaperSize;
  /** default landscape */
  orientation?: "landscape" | "portrait";
  /** clearance between the paper edge and the cards in grid units (default `PAPER_PAD`, 6) */
  margin?: number;
}

export interface SchematicPage {
  /** 1-based page number */
  n: number;
  /** page count */
  of: number;
  /** the page's window onto the sheet (grid units, +Y down); paper sized unless `oversize` */
  crop: LBox;
  /** card ids on this page, in reading order */
  cards: string[];
  /** a single card larger than the paper: the page is that card's size, not the paper's */
  oversize?: true;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0;

/** Each card's drawn extent: its frame plus whatever of its own content reaches past it (fields, labels, power symbols, wires). */
export function cardExtents(doc: SchematicDocument): Map<string, LBox> {
  const g = geometryOf(doc);
  const parts = new Map<string, LBox[]>();
  const add = (card: string | undefined, b: LBox) => {
    if (!card) return;
    const l = parts.get(card);
    if (l) l.push(b);
  };
  for (const c of recordsOfKind(doc, "card")) parts.set(c.id, [{ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h }]);
  for (const s of g.symbols.values()) {
    add(s.rec.card, s.full);
    add(s.rec.card, s.ref);
    if (s.value) add(s.rec.card, s.value);
  }
  for (const l of recordsOfKind(doc, "label")) add(l.card, labelBox(l, doc));
  for (const p of recordsOfKind(doc, "power")) {
    const b = powerBoxes(p, doc);
    add(p.card, b.glyph);
    if (b.text) add(p.card, b.text);
  }
  for (const w of recordsOfKind(doc, "wire")) {
    const xs = w.points.map((p) => p[0]);
    const ys = w.points.map((p) => p[1]);
    add(w.card, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
  }
  return new Map([...parts].map(([id, bs]) => [id, unionBoxes(bs)]));
}

/** Card ids in reading order: columns (cards whose x spans overlap) left to right, each column top to bottom. */
export function readingOrder(extents: ReadonlyMap<string, LBox>): string[] {
  const ids = [...extents.keys()].sort((a, b) => extents.get(a)!.x0 - extents.get(b)!.x0 || extents.get(a)!.y0 - extents.get(b)!.y0 || byCodeUnit(a, b));
  const cols: { x1: number; ids: string[] }[] = [];
  for (const id of ids) {
    const b = extents.get(id)!;
    const col = cols[cols.length - 1];
    if (col && b.x0 < col.x1) {
      col.ids.push(id);
      col.x1 = Math.max(col.x1, b.x1);
    } else cols.push({ x1: b.x1, ids: [id] });
  }
  return cols.flatMap((c) => c.ids.sort((a, b) => extents.get(a)!.y0 - extents.get(b)!.y0 || extents.get(a)!.x0 - extents.get(b)!.x0 || byCodeUnit(a, b)));
}

/** The paper's size in grid units, width first. */
export function paperGu(paper: PaperSize = "A4", orientation: "landscape" | "portrait" = "landscape"): [number, number] {
  const [long, short] = PAPER_MM[paper];
  const [w, h] = orientation === "landscape" ? [long, short] : [short, long];
  return [w / GU_MM, h / GU_MM];
}

/**
 * Pack whole cards onto pages of one paper size. Cards are taken in reading order and added to the current page
 * while the union of their extents fits the paper less the margin on every side and the title block below; a card
 * that does not fit starts a new page, and a card larger than the usable area gets a page of its own at its own
 * size (`oversize`). A page's crop centers its cards in the usable area. Always at least one page.
 */
export function paginateSchematic(doc: SchematicDocument, options: PaginateOptions = {}): SchematicPage[] {
  const [W, H] = paperGu(options.paper ?? "A4", options.orientation ?? "landscape");
  const pad = options.margin ?? PAPER_PAD;
  const UW = W - 2 * pad;
  const UH = H - 2 * pad - TITLE_BLOCK_H;
  const ext = cardExtents(doc);
  const order = readingOrder(ext);
  const fits = (b: LBox) => b.x1 - b.x0 <= UW + 1e-9 && b.y1 - b.y0 <= UH + 1e-9;
  const groups: { cards: string[]; box: LBox; oversize: boolean }[] = [];
  let cur: { cards: string[]; box: LBox; oversize: boolean } | undefined;
  for (const id of order) {
    const b = ext.get(id)!;
    if (!fits(b)) {
      cur = undefined;
      groups.push({ cards: [id], box: b, oversize: true });
      continue;
    }
    const joined = cur ? unionBoxes([cur.box, b]) : b;
    if (cur && fits(joined)) {
      cur.cards.push(id);
      cur.box = joined;
    } else {
      cur = { cards: [id], box: b, oversize: false };
      groups.push(cur);
    }
  }
  if (!groups.length) groups.push({ cards: [], box: { x0: 0, y0: 0, x1: 0, y1: 0 }, oversize: false });
  return groups.map((grp, i) => {
    const b = grp.box;
    const crop = grp.oversize
      ? { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad + TITLE_BLOCK_H }
      : (() => {
          const x0 = b.x0 - pad - (UW - (b.x1 - b.x0)) / 2;
          const y0 = b.y0 - pad - (UH - (b.y1 - b.y0)) / 2;
          return { x0, y0, x1: x0 + W, y1: y0 + H };
        })();
    return {
      n: i + 1,
      of: groups.length,
      crop: { x0: r3(crop.x0), y0: r3(crop.y0), x1: r3(crop.x1), y1: r3(crop.y1) },
      cards: grp.cards,
      ...(grp.oversize ? { oversize: true as const } : {}),
    };
  });
}
