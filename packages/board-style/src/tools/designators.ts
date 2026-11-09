/**
 * Designator policy: which reference designators show on the silkscreen and where.
 *
 * Shown designators are board text the tool owns (text = the reference), placed by a scored search around the part:
 * above, below, left and right of its courtyard, horizontal first, then vertical reading bottom-up from its own side,
 * nearest first, never on pads, vias, holes, other silk, other parts' courtyards or past the edge clearance. The
 * footprints' own reference texts leave the silkscreen (moved to the fabrication layer, where assembly drawings keep
 * them): that is a footprint change the board core has no ordinary operation for yet, so it comes back as `hostOps`.
 */
import { padsOf, recordsOfKind, withChanges, type BoardDocument, type FootprintRec, type OpCall, type Side } from "@protoboardai/board";
import { changeSet, HIDDEN_MARK, ignoredByTool, type Desired, type Skipped, type StyleChangeSet } from "../changeset.js";
import { nm } from "../geom.js";
import { tok, tokNum, type ResolvedStyle } from "../resolve.js";
import { BoardSpace } from "../space.js";
import { cased, courtyardRing, ringBox, silkClearances, silkLayer, textBox, textClassNm, textShape, type DrawOptions } from "./common.js";

export interface DesignatorOptions extends DrawOptions {
  /** References to show whatever the policy says. */
  show?: string[];
  /** References to hide whatever the policy says. */
  hide?: string[];
}

const prefixOf = (ref: string): string => ref.replace(/[0-9_].*$/, "").toUpperCase();

/** The references the policy shows, in placement order (bench classes first). */
export function wantedDesignators(doc: BoardDocument, style: ResolvedStyle, o: { show?: string[]; hide?: string[] } = {}): { shown: FootprintRec[]; hidden: { fp: FootprintRec; reason: string }[] } {
  const fps = recordsOfKind(doc, "footprint");
  const policy = tok<string>(style, "designator.policy");
  const classes = tok<string[]>(style, "designator.classes").map((c) => c.toUpperCase());
  const share = tokNum(style, "designator.targetShare");
  const area = (f: FootprintRec) => {
    const b = ringBox(courtyardRing(f));
    return (b.maxX - b.minX) * (b.maxY - b.minY);
  };
  const byRef = (a: FootprintRec, b: FootprintRec) => a.ref.localeCompare(b.ref, "en", { numeric: true });
  const hide = new Set(o.hide ?? []);
  const show = new Set(o.show ?? []);
  let shown: FootprintRec[];
  const hidden: { fp: FootprintRec; reason: string }[] = [];
  if (policy === "none") shown = [];
  else if (policy === "all") shown = [...fps].sort((a, b) => area(b) - area(a) || byRef(a, b));
  else {
    const rank = (f: FootprintRec) => {
      const i = classes.indexOf(prefixOf(f.ref));
      return i < 0 ? classes.length : i;
    };
    const bench = fps.filter((f) => rank(f) < classes.length).sort((a, b) => rank(a) - rank(b) || byRef(a, b));
    const rest = fps.filter((f) => rank(f) === classes.length).sort((a, b) => area(b) - area(a) || byRef(a, b));
    const target = Math.ceil(share * fps.length);
    shown = [...bench, ...rest.slice(0, Math.max(0, target - bench.length))];
  }
  const shownSet = new Set(shown.map((f) => f.id));
  for (const f of fps) if (show.has(f.ref) && !shownSet.has(f.id)) shown.push(f);
  shown = shown.filter((f) => !hide.has(f.ref));
  const finalSet = new Set(shown.map((f) => f.id));
  for (const f of fps) if (!finalSet.has(f.id)) hidden.push({ fp: f, reason: hide.has(f.ref) ? "hidden on request" : `designator.policy ${policy}` });
  return { shown, hidden };
}

export function styleDesignators(doc: BoardDocument, style: ResolvedStyle, o: DesignatorOptions = {}): StyleChangeSet {
  const { shown, hidden } = wantedDesignators(doc, style, o);
  const skipped: Skipped[] = [];
  // footprints' own reference texts leave the silkscreen (host operation)
  const puts: FootprintRec[] = [];
  for (const fp of recordsOfKind(doc, "footprint")) {
    if (!fp.texts?.some((t) => t.role === "ref" && (t.layer === "top_silkscreen" || t.layer === "bottom_silkscreen"))) continue;
    puts.push({ ...fp, texts: fp.texts.map((t) => (t.role === "ref" && (t.layer === "top_silkscreen" || t.layer === "bottom_silkscreen") ? { ...t, layer: t.layer === "top_silkscreen" ? ("top_fabrication" as const) : ("bottom_fabrication" as const), text: HIDDEN_MARK } : t)) });
  }
  const hostOps: OpCall[] = puts.length ? [{ op: "record.put", records: puts }] : [];
  const plan = puts.length ? withChanges(doc, puts) : doc;
  const space = new BoardSpace(plan, { ignoreSilk: ignoredByTool(plan, "designators") });
  const { height, stroke, cls } = textClassNm(style, "type.class.designator");
  const orient = tok<string[]>(style, "designator.orientation");
  const maxD = nm(tokNum(style, "designator.maxDistance"));
  const clr = silkClearances(style, { silk: true, courtyard: true });
  const desired: Desired[] = [];
  const placed: { ref: string; x: number; y: number; vertical: boolean }[] = [];
  const bodies = recordsOfKind(plan, "footprint").map((f) => ({ id: f.id, side: f.side, b: ringBox(courtyardRing(f)) }));
  const boxDist = (b: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number) => Math.hypot(Math.max(0, b.minX - x, x - b.maxX), Math.max(0, b.minY - y, y - b.maxY));
  for (const fp of shown) {
    const side: Side = fp.side;
    const text = cased(fp.ref, cls);
    const box = textBox(text, height, stroke);
    const body = ringBox(courtyardRing(fp));
    const padBox = padsOf(fp).reduce((b, p) => ({ minX: Math.min(b.minX, p.box.minX), minY: Math.min(b.minY, p.box.minY), maxX: Math.max(b.maxX, p.box.maxX), maxY: Math.max(b.maxY, p.box.maxY) }), body);
    const bx = { minX: Math.min(body.minX, padBox.minX), minY: Math.min(body.minY, padBox.minY), maxX: Math.max(body.maxX, padBox.maxX), maxY: Math.max(body.maxY, padBox.maxY) };
    const cx = (bx.minX + bx.maxX) / 2;
    const cy = (bx.minY + bx.maxY) / 2;
    type Cand = { x: number; y: number; vertical: boolean; score: number };
    const cands: Cand[] = [];
    const g0 = (clr.courtyard ?? 0) + 20_000;
    for (const vertical of [false, true]) {
      if (!orient.includes(vertical ? "vertical" : "horizontal")) continue;
      const w = vertical ? box.h : box.w;
      const h = vertical ? box.w : box.h;
      for (let d = g0; d <= maxD; d += 100_000) {
        const shifts = [0, -0.5, 0.5, -1, 1];
        for (const k of shifts) {
          const sx = ((bx.maxX - bx.minX) / 2 + w / 2) * k;
          const sy = ((bx.maxY - bx.minY) / 2 + h / 2) * k;
          const pen = (vertical ? 400_000 : 0) + Math.abs(k) * 300_000 + d;
          cands.push({ x: cx + sx, y: bx.maxY + d + h / 2, vertical, score: pen });
          cands.push({ x: cx + sx, y: bx.minY - d - h / 2, vertical, score: pen + 100_000 });
          cands.push({ x: bx.minX - d - w / 2, y: cy + sy, vertical, score: pen + 150_000 });
          cands.push({ x: bx.maxX + d + w / 2, y: cy + sy, vertical, score: pen + 200_000 });
        }
      }
    }
    // a label nearer another part's body than its own reads as that part's: push it down the list
    for (const c of cands) {
      const ownD = boxDist(body, c.x, c.y);
      if (bodies.some((o2) => o2.id !== fp.id && o2.side === side && boxDist(o2.b, c.x, c.y) < ownD)) c.score += 2_000_000;
    }
    cands.sort((a, b) => a.score - b.score);
    let done = false;
    for (const c of cands) {
      const x = Math.round(c.x);
      const y = Math.round(c.y);
      const s = textShape(x, y, c.vertical ? box.h : box.w, c.vertical ? box.w : box.h);
      if (space.blocker(s, side, clr)) continue;
      const rotation = c.vertical ? (side === "top" ? 90_000 : 270_000) : 0;
      desired.push({ kind: "text", layer: silkLayer(side), text, x, y, height, stroke_width: stroke, ...(rotation ? { rotation } : {}), anchor: "center", ...(side === "bottom" ? { mirrored: true as const } : {}) });
      space.addSilk(`ref:${fp.ref}`, side, [s]);
      placed.push({ ref: fp.ref, x, y, vertical: c.vertical });
      done = true;
      break;
    }
    if (!done) skipped.push({ what: fp.ref, reason: `no spot within ${tokNum(style, "designator.maxDistance")} mm clears pads, vias, other silk, other parts and the edge`, objects: [fp.id] });
  }
  const total = recordsOfKind(doc, "footprint").length;
  const notes = [`${placed.length} of ${total} designators shown (${Math.round((100 * placed.length) / Math.max(1, total))} percent); policy ${tok<string>(style, "designator.policy")}`];
  if (hostOps.length) notes.push(`${puts.length} footprint reference text(s) move from the silkscreen to the fabrication layer (a host operation: the board core has no footprint text operation yet)`);
  return changeSet("designators", `Show ${placed.length} designators by the ${style.theme.name} policy`, "place designators by policy", doc, desired, {
    hostOps,
    skipped,
    notes,
    report: { shown: placed, hidden: hidden.map((h) => ({ ref: h.fp.ref, reason: h.reason })), total },
    ...(o.force ? { force: true } : {}),
  });
}
