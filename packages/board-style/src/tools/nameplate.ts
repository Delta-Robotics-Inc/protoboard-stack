/**
 * The nameplate: the board's name and revision (and the date when the theme asks for one) on the theme's side, as a
 * solid knockout tag or plain text, with optional decor: a decorative barcode under it and crosshairs either side.
 * Placed at the free spot nearest the board's center that clears pads, vias, other silk, parts and the edge; a plain
 * name that does not fit on one line tries two. The date comes from the call, never from the clock.
 */
import { mm, sha1Hex, type BoardDocument, type Side } from "@protoboardai/board";
import { changeSet, ignoredByTool, type Desired, type Skipped, type StyleChangeSet } from "../changeset.js";
import { knockoutTag, nm, rectRing, simplifyRing, type Ring } from "../geom.js";
import { tok, tokNum, type ResolvedStyle } from "../resolve.js";
import { BoardSpace } from "../space.js";
import { boardPoint, cased, fillTemplate, findSpot, silkClearances, silkLayer, textBox, textClassNm, vertices, type DrawOptions } from "./common.js";

export interface NameplateOptions extends DrawOptions {
  /** The revision (default "1"). */
  rev?: string;
  /** YYYY-MM-DD, used when nameplate.date is year or full. */
  date?: string;
  /** The board name (default: the board record's name). */
  name?: string;
}

const TAG_PAD = 250_000;

export function styleNameplate(doc: BoardDocument, style: ResolvedStyle, o: NameplateOptions = {}): StyleChangeSet {
  const skipped: Skipped[] = [];
  const notes: string[] = [];
  if (!tok<boolean>(style, "nameplate.enabled")) return changeSet("nameplate", "Remove the nameplate (theme draws none)", "remove the nameplate", doc, [], { notes: ["nameplate.enabled is false"] });
  const side = tok<string>(style, "nameplate.side") as Side;
  const layer = silkLayer(side);
  const board = doc.records.get("board");
  const name = o.name ?? (board?.kind === "board" ? board.name : "BOARD");
  const dateMode = tok<string>(style, "nameplate.date");
  let text = fillTemplate(tok<string>(style, "nameplate.text"), { NAME: name, REV: o.rev ?? "1" });
  if (dateMode !== "off") {
    if (o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) text += ` ${dateMode === "year" ? o.date.slice(0, 4) : o.date}`;
    else notes.push(`nameplate.date is ${dateMode} but the call gave no date: left out`);
  }
  const { height, stroke, cls } = textClassNm(style, "type.class.nameplate");
  text = cased(text, cls);
  const line = nm(tokNum(style, "silk.line"));
  const decor = tok<string[]>(style, "nameplate.decor");
  const tagStyle = tok<string>(style, "nameplate.style") === "tag";
  const space = new BoardSpace(doc, { ignoreSilk: ignoredByTool(doc, "nameplate") });
  const clr = silkClearances(style, { silk: true, courtyard: true });
  const prefer = boardPoint(space, side, 0.5, 0.5);
  const mirrored = side === "bottom";
  const desired: Desired[] = [];

  type Layout = { lines: string[]; tag: boolean };
  const layouts: Layout[] = [];
  if (tagStyle) layouts.push({ lines: [text], tag: true });
  layouts.push({ lines: [text], tag: false });
  const words = text.split(" ");
  if (words.length > 1) {
    let best = 1;
    for (let k = 1; k < words.length; k++) if (Math.abs(words.slice(0, k).join(" ").length - words.slice(k).join(" ").length) < Math.abs(words.slice(0, best).join(" ").length - words.slice(best).join(" ").length)) best = k;
    layouts.push({ lines: [words.slice(0, best).join(" "), words.slice(best).join(" ")], tag: false });
  }
  const barH = mm(1.0);
  const barGap = mm(0.3);
  const crossR = mm(0.6);
  const crossArm = mm(0.8);
  const crossGap = mm(0.5);
  for (const lay of layouts) {
    const lineBoxes = lay.lines.map((l) => textBox(l, height, stroke));
    const mainW = Math.max(...lineBoxes.map((b) => b.w)) + (lay.tag ? 2 * TAG_PAD : 0);
    const lineGap = Math.round(height * 0.5);
    const mainH = lineBoxes.reduce((s, b) => s + b.h, 0) + (lay.lines.length - 1) * lineGap + (lay.tag ? 2 * TAG_PAD : 0);
    const withBars = decor.includes("barcode");
    const withCross = decor.includes("crosshairs");
    const W = mainW + (withCross ? 2 * (crossGap + crossArm * 2) : 0);
    const H = mainH + (withBars ? barGap + barH : 0);
    const spot = findSpot(space, side, W + 2 * mm(0.1), H + 2 * mm(0.1), prefer, clr);
    if (!spot) continue;
    const [cx, cy] = spot;
    const mainY = Math.round(cy + H / 2 - mainH / 2);
    if (lay.tag) {
      const t = knockoutTag(lay.lines[0], { x: cx, y: mainY, height, stroke, pad: TAG_PAD, ...(mirrored ? { mirrored: true } : {}) });
      for (const c of t.contours) desired.push({ kind: "graphic", layer, shape: "polygon", points: vertices(pairs(c)), stroke_width: 0, filled: true });
    } else {
      let y = mainY + mainH / 2;
      lay.lines.forEach((l, i) => {
        y -= lineBoxes[i].h / 2;
        desired.push({ kind: "text", layer, text: l, x: cx, y: Math.round(y), height, stroke_width: stroke, anchor: "center", ...(mirrored ? { mirrored: true as const } : {}) });
        y -= lineBoxes[i].h / 2 + lineGap;
      });
    }
    if (withBars) {
      const bars = barcode(text, mainW, line);
      const by = Math.round(cy - H / 2 + barH / 2);
      for (const [x0, w] of bars) {
        const x = mirrored ? cx + mainW / 2 - x0 - w / 2 : cx - mainW / 2 + x0 + w / 2;
        desired.push({ kind: "graphic", layer, shape: "polygon", points: vertices(pairs(rectRing(Math.round(x), by, w, barH))), stroke_width: 0, filled: true });
      }
    }
    if (withCross)
      for (const sgn of [-1, 1]) {
        const x = Math.round(cx + sgn * (mainW / 2 + crossGap + crossArm));
        desired.push({ kind: "graphic", layer, shape: "circle", center: { x, y: mainY }, radius: crossR, stroke_width: line });
        desired.push({ kind: "graphic", layer, shape: "line", start: { x: x - crossArm, y: mainY }, end: { x: x + crossArm, y: mainY }, stroke_width: line });
        desired.push({ kind: "graphic", layer, shape: "line", start: { x, y: mainY - crossArm }, end: { x, y: mainY + crossArm }, stroke_width: line });
      }
    if (!lay.tag && tagStyle) notes.push("no room for a knockout tag: plain text instead");
    if (lay.lines.length > 1) notes.push("set on two lines to fit");
    return changeSet("nameplate", `Nameplate ${text} on the ${side}`, "place the board nameplate", doc, desired, { skipped, notes, report: { text, side, at: { x: cx, y: cy }, tag: lay.tag, lines: lay.lines.length }, ...(o.force ? { force: true } : {}) });
  }
  skipped.push({ what: "nameplate", reason: `no free spot on the ${side} for ${text} (with its decor) clears pads, silk, parts and the edge` });
  return changeSet("nameplate", "Nameplate does not fit", "place the board nameplate", doc, [], { skipped, notes, ...(o.force ? { force: true } : {}) });
}

const pairs = (r: Ring): [number, number][] => {
  const s = simplifyRing(r);
  const out: [number, number][] = [];
  for (let i = 0; i < s.length; i += 2) out.push([s[i], s[i + 1]]);
  return out;
};

/**
 * A decorative barcode as [left offset, width] bars across `width`, from the text's hash (no data is encoded). Bars
 * are one or two silk lines wide, gaps one and a half; bars that do not fit are dropped and the rest centered.
 */
function barcode(text: string, width: number, line: number): [number, number][] {
  const bits = parseInt(sha1Hex(text).slice(0, 12), 16);
  const gap = Math.round(line * 1.5);
  const out: [number, number][] = [];
  let x = 0;
  for (let i = 0; i < 23; i++) {
    const w = (bits / 2 ** i) % 2 >= 1 ? 2 * line : line;
    if (x + w > width) break;
    out.push([x, w]);
    x += w + gap;
  }
  const used = x - gap;
  const shift = Math.round((width - used) / 2);
  return out.map(([x0, w]) => [x0 + shift, w]);
}
