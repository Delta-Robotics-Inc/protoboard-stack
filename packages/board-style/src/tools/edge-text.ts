/**
 * The edge text ring: text runs laid along the board outline, inset by `edgeText.inset`, on the nameplate's side.
 * `feetOut`: letters stand on the edge and read counterclockwise as seen from that side; `feetIn`: tops toward the
 * edge, reading clockwise. Each character sits at its arc length along the inset outline, turned to the local
 * direction; characters on one straight run become one text record. A run that would come near pads, vias, other
 * silk, parts or a sharp bend slides along the edge until it fits, or is left out (logged). Bottom-side text is
 * laid out as seen from below, then mirrored onto the board.
 */
import { type BoardDocument, type Side } from "@protoboardai/board";
import { textWidth } from "@protoboardai/board-scene";
import { changeSet, ignoredByTool, type Desired, type Skipped, type StyleChangeSet } from "../changeset.js";
import { nm, ringsOf, type Ring } from "../geom.js";
import { tok, tokNum, type ResolvedStyle } from "../resolve.js";
import { BoardSpace } from "../space.js";
import { boardInset, boardRings, cased, fillTemplate, reverseRing, silkClearances, silkLayer, textClassNm, textShape, type DrawOptions } from "./common.js";

export interface EdgeTextOptions extends DrawOptions {
  /** Values for ${NAME}, ${REV}, ${MOTTO} (default: the board name, revision 1, the motto token). */
  vars?: Record<string, string>;
}

/** Whether an outline is round enough for `auto`: arcs make at least half of its length. */
export function outlineIsRound(doc: BoardDocument): boolean {
  const o = doc.records.get("outline");
  if (o?.kind !== "outline") return false;
  let arc = 0;
  let total = 0;
  const v = o.outline;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (a.sweep) {
      const th = Math.abs(a.sweep / 1000) * (Math.PI / 180);
      const len = th >= 2 * Math.PI - 1e-9 ? 0 : (chord * th) / (2 * Math.sin(th / 2));
      arc += len;
      total += len;
    } else total += chord;
  }
  return total > 0 && arc / total >= 0.5;
}

/** Whether the edge ring is on for this board. */
export const edgeTextActive = (doc: BoardDocument, style: ResolvedStyle): boolean => {
  const m = tok<string>(style, "edgeText.mode");
  return m === "on" || (m === "auto" && outlineIsRound(doc));
};

type P = [number, number];

export function styleEdgeText(doc: BoardDocument, style: ResolvedStyle, o: EdgeTextOptions = {}): StyleChangeSet {
  const mode = tok<string>(style, "edgeText.mode");
  if (!edgeTextActive(doc, style)) return changeSet("edgeText", "No edge text ring", "remove the edge text ring", doc, [], { notes: [mode === "auto" ? "edgeText.mode is auto and the outline is not round" : "edgeText.mode is off"], ...(o.force ? { force: true } : {}) });
  const side = tok<string>(style, "nameplate.side") as Side;
  const board = doc.records.get("board");
  const vars = { NAME: board?.kind === "board" ? board.name : "", REV: "1", MOTTO: tok<string>(style, "marks.motto"), ...(o.vars ?? {}) };
  const { height, stroke, cls } = textClassNm(style, "type.class.edge");
  const items = tok<string[]>(style, "edgeText.items")
    .map((t) => cased(fillTemplate(t, vars), cls))
    .filter(Boolean);
  const skipped: Skipped[] = [];
  const notes: string[] = [];
  if (!items.length) return changeSet("edgeText", "No edge text items", "remove the edge text ring", doc, [], { notes: ["edgeText.items is empty after filling in"], ...(o.force ? { force: true } : {}) });
  const insetD = nm(tokNum(style, "edgeText.inset"));
  const clr = silkClearances(style, { silk: true, courtyard: true });
  if (insetD - stroke / 2 < clr.edge) notes.push(`edgeText.inset ${tokNum(style, "edgeText.inset")} mm puts the text closer to the edge than silk.clearance.edge; the edge clearance is relaxed to the inset for the ring`);
  const edgeClr = Math.min(clr.edge, Math.max(0, insetD - stroke / 2 - 10_000));
  const feetOut = tok<string>(style, "edgeText.orientation") === "feetOut";
  const mirror = side === "bottom";
  // the baseline (feet out) or the cap line (feet in): the outline inset by insetD, in view coordinates
  const inset = boardInset(doc, insetD);
  const { outline } = boardRings(doc);
  if (!outline || !inset.length) return changeSet("edgeText", "No room for an edge text ring", "remove the edge text ring", doc, [], { skipped: [{ what: "edge text", reason: "the board has no outline, or none is left after the inset" }] });
  const biggest = inset.reduce((a, b) => (area(b.outer) > area(a.outer) ? b : a));
  let path: Ring = biggest.outer; // counterclockwise from the top
  const view = (r: Ring): Ring => {
    const out: number[] = [];
    for (let i = 0; i < r.length; i += 2) out.push(mirror ? -r[i] : r[i], r[i + 1]);
    return mirror ? reverseRing(out) : out;
  };
  path = view(path); // counterclockwise as seen from the side
  if (!feetOut) path = reverseRing(path);
  const pts: P[] = [];
  for (let i = 0; i < path.length; i += 2) pts.push([path[i], path[i + 1]]);
  pts.push(pts[0]);
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  const at = (s: number): { x: number; y: number; dir: number; seg: number } => {
    s = ((s % L) + L) % L;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k++;
    const t = (s - cum[k - 1]) / Math.max(1, cum[k] - cum[k - 1]);
    const [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dir: Math.atan2(by - ay, bx - ax), seg: k };
  };
  const space = new BoardSpace(doc, { ignoreSilk: ignoredByTool(doc, "edgeText") });
  const adv = textWidth("AA", height) - textWidth("A", height); // one character's advance
  const glyphW = textWidth("A", height) + stroke;
  const up = feetOut ? 1 : -1; // the text's up: inward when feet out (left of travel), outward when feet in
  type Char = { ch: string; x: number; y: number; dir: number; seg: number };
  const layoutRun = (text: string, s0: number): Char[] | undefined => {
    const out: Char[] = [];
    for (let i = 0; i < text.length; i++) {
      const s = s0 + i * adv + glyphW / 2;
      const a = at(s - glyphW / 2);
      const b = at(s + glyphW / 2);
      const m = at(s);
      let turn = Math.abs(b.dir - a.dir);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > (20 * Math.PI) / 180) return undefined;
      // the character's center: half a height off the line toward the text's up
      const nx = -Math.sin(m.dir) * up;
      const ny = Math.cos(m.dir) * up;
      const off = height / 2 + stroke / 2;
      out.push({ ch: text[i], x: m.x + nx * off, y: m.y + ny * off, dir: m.dir, seg: m.seg });
    }
    return out;
  };
  const world = (c: { x: number; y: number }): P => [Math.round(mirror ? -c.x : c.x), Math.round(c.y)];
  const clearRun = (run: Char[]): boolean =>
    run.every((c) => {
      if (c.ch === " ") return true;
      const [x, y] = world(c);
      const rot = mirror ? -c.dir : c.dir;
      const sh = textShape(x, y, glyphW, height + stroke, (rot * 180 * 1000) / Math.PI);
      return !space.blocker(sh, side, { ...clr, edge: edgeClr });
    });
  const desired: Desired[] = [];
  const placedRuns: { text: string; at: number }[] = [];
  const gapS = nm(tokNum(style, "edgeText.gap"));
  // start at the middle of the side's bottom edge (as seen) and walk around
  let s = startNear(pts, cum);
  const end = s + L;
  for (const text of items) {
    const len = text.length * adv;
    let placed = false;
    for (let s0 = s; s0 + len <= end; s0 += nm(0.25)) {
      const run = layoutRun(text, s0);
      if (!run || !clearRun(run)) continue;
      // characters on one straight segment become one text record
      let i = 0;
      while (i < run.length) {
        let j = i;
        while (j + 1 < run.length && run[j + 1].seg === run[i].seg) j++;
        const piece = run.slice(i, j + 1);
        const trimmed = piece.map((c) => c.ch).join("");
        if (trimmed.trim()) {
          const first = piece[0];
          const [x, y] = world(first);
          const rotRad = mirror ? -first.dir : first.dir;
          const rotation = ((Math.round((rotRad * 180 * 1000) / Math.PI) % 360_000) + 360_000) % 360_000;
          // anchor left at the first character's left edge
          const half = (glyphW - stroke) / 2;
          const lx = x - Math.cos(rotRad) * half * (mirror ? -1 : 1);
          const ly = y - Math.sin(rotRad) * half * (mirror ? -1 : 1);
          desired.push({ kind: "text", layer: silkLayer(side), text: trimmed, x: Math.round(lx), y: Math.round(ly), height, stroke_width: stroke, ...(rotation ? { rotation } : {}), anchor: "left", ...(mirror ? { mirrored: true as const } : {}) });
        }
        i = j + 1;
      }
      for (const c of run) {
        if (c.ch === " ") continue;
        const [x, y] = world(c);
        space.addSilk(`edge:${text}`, side, [textShape(x, y, glyphW, height + stroke, (((mirror ? -c.dir : c.dir) * 180) / Math.PI) * 1000)]);
      }
      placedRuns.push({ text, at: Math.round(s0 - (end - L)) });
      s = s0 + len + gapS;
      placed = true;
      break;
    }
    if (!placed) skipped.push({ what: `edge text "${text}"`, reason: "no stretch of the edge is clear of pads, parts, other silk and sharp bends for it" });
  }
  return changeSet("edgeText", `Edge text ring with ${placedRuns.length} run${placedRuns.length === 1 ? "" : "s"}`, "lay text along the edge", doc, desired, { skipped, notes, report: { runs: placedRuns, side, perimeter: Math.round(L) }, ...(o.force ? { force: true } : {}) });
}

const area = (r: Ring): number => {
  let s = 0;
  const n = r.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1];
  }
  return Math.abs(s / 2);
};

/** Arc length of the path point lowest on the board (the bottom middle, as seen), where runs start. */
function startNear(pts: P[], cum: number[]): number {
  let best = 0;
  let bestY = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
  }
  const mid = (minX + maxX) / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const score = pts[i][1] + Math.abs(pts[i][0] - mid) * 0.5;
    if (score < bestY) {
      bestY = score;
      best = cum[i];
    }
  }
  return best;
}

export const _test = { ringsOf };
