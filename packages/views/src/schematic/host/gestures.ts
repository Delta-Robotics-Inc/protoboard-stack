/**
 * A person's gestures as operation lists (Node: the schematic core's geometry): a symbol moved, rotated or mirrored
 * with its wires following orthogonally, the labels and power symbols on its pins coming along, and a field moved.
 * Each list is one transaction (one undo step). Pure: the document in, the calls out.
 *
 * Wires follow by their ends: a wire whose end sits on a pin of a moved symbol gets that end at the pin's new place
 * and one elbow to the wire's next vertex (leaving along the pin's own direction), then collinear and repeated
 * points are dropped. A wire with both ends on symbols that moved by the same amount moves whole. A stub (a wire
 * from a moved pin to nothing but labels or power symbols) moves whole with them.
 */
import { applyCalls, geometryOf, recordsOfKind, type ApplyContext, type SchematicDocument } from "@protoboardai/schematic";
import type { OpCall } from "@protoboardai/board";
import type { Dir, XY } from "../types.js";
import { reattach } from "../paths.js";

export { orthogonal, orthogonalize, reattach, simplifyPath } from "../paths.js";

const key = (p: readonly number[]) => `${p[0]},${p[1]}`;
const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];

const ctx: ApplyContext = { actor: { kind: "human", id: "user" }, issueId: (k) => `${k}:preview.0`, provenance: { by: "hand" }, edited: "hand", pinMoves: true };

/** Calls that bring the wires, labels and power symbols on the moved symbols' pins along, given the document before and after. */
export function followCalls(before: SchematicDocument, after: SchematicDocument, symbolIds: readonly string[]): OpCall[] {
  const gb = geometryOf(before);
  const ga = geometryOf(after);
  const moved = new Map<string, { to: XY; dir: Dir; d: XY }>();
  for (const id of symbolIds) {
    const a = gb.symbols.get(id);
    const b = ga.symbols.get(id);
    if (!a || !b) continue;
    for (const p of a.pins) {
      const q = b.pins.find((x) => x.key === p.key);
      // a pin that did not move brings nothing along
      if (q && (q.at[0] !== p.at[0] || q.at[1] !== p.at[1])) moved.set(key(p.at), { to: q.at, dir: q.dir, d: [q.at[0] - p.at[0], q.at[1] - p.at[1]] });
    }
  }
  if (!moved.size) return [];
  // what sits at each point: other wires' points, pins that do not move, labels and power symbols
  const fixedPins = new Set<string>();
  for (const s of gb.symbols.values()) if (!symbolIds.includes(s.rec.id)) for (const p of s.pins) fixedPins.add(key(p.at));
  const wirePoints = new Map<string, number>();
  const wires = recordsOfKind(before, "wire");
  for (const w of wires) for (const p of w.points) wirePoints.set(key(p), (wirePoints.get(key(p)) ?? 0) + 1);
  const tags = [...recordsOfKind(before, "label"), ...recordsOfKind(before, "power")];
  const tagsAt = new Map<string, string[]>();
  for (const t of tags) (tagsAt.get(key([t.x, t.y])) ?? tagsAt.set(key([t.x, t.y]), []).get(key([t.x, t.y]))!).push(t.id);
  const out: OpCall[] = [];
  const movedTags = new Map<string, XY>();
  const moveTag = (id: string, d: XY) => {
    if (!movedTags.has(id) && (d[0] || d[1])) movedTags.set(id, d);
  };
  for (const w of wires) {
    const pts = w.points as XY[];
    const a0 = moved.get(key(pts[0]));
    const an = moved.get(key(pts[pts.length - 1]));
    if (!a0 && !an) continue;
    if (a0 && an && same(a0.d, an.d)) {
      out.push({ op: "wire.edit", id: w.id, points: pts.map((p) => [p[0] + a0.d[0], p[1] + a0.d[1]]) });
      continue;
    }
    // a stub: the far end touches nothing but labels or power symbols
    const far = a0 ? pts[pts.length - 1] : pts[0];
    const near = a0 ?? an!;
    if (!(a0 && an) && !fixedPins.has(key(far)) && (wirePoints.get(key(far)) ?? 0) <= 1 && (tagsAt.get(key(far)) ?? []).length && pts.every((p, i) => i === 0 || i === pts.length - 1 || (wirePoints.get(key(p)) ?? 0) <= 1)) {
      out.push({ op: "wire.edit", id: w.id, points: pts.map((p) => [p[0] + near.d[0], p[1] + near.d[1]]) });
      for (const t of tagsAt.get(key(far)) ?? []) moveTag(t, near.d);
      continue;
    }
    let next = pts;
    if (a0) next = reattach(next, a0.to, a0.dir);
    if (an) next = reattach([...next].reverse(), an.to, an.dir).reverse();
    if (next.length < 2) out.push({ op: "wire.delete", ids: [w.id] });
    else out.push({ op: "wire.edit", id: w.id, points: next });
  }
  // labels and power symbols sitting right on a moved pin
  for (const [at, m] of moved) for (const t of tagsAt.get(at) ?? []) moveTag(t, m.d);
  for (const [id, d] of movedTags) out.push({ op: "item.move", ids: [id], dx: d[0], dy: d[1], pin: false });
  return out;
}

/** A symbol gesture (`item.move`, `symbol.rotate`, `symbol.mirror` of symbols) and what follows it, as one call list. */
export function gestureCalls(doc: SchematicDocument, primary: OpCall[], symbolIds: readonly string[]): OpCall[] {
  const after = applyCalls(doc, primary, ctx);
  return [...primary, ...followCalls(doc, after, symbolIds)];
}

export function moveCalls(doc: SchematicDocument, ids: string[], dx: number, dy: number): OpCall[] {
  const syms = ids.filter((id) => doc.records.get(id)?.kind === "symbol");
  // a card moves with its members and their wires (item.move does that); the wires of moved symbols follow
  return gestureCalls(doc, [{ op: "item.move", ids, dx, dy }], syms);
}

export function rotateCalls(doc: SchematicDocument, ids: string[], angle: 90 | 180 | 270): OpCall[] {
  return gestureCalls(doc, [{ op: "symbol.rotate", ids, angle }], ids);
}

export function mirrorCalls(doc: SchematicDocument, ids: string[]): OpCall[] {
  return gestureCalls(doc, [{ op: "symbol.mirror", ids }], ids);
}

/** A symbol's reference and value moved by whole grid units (`symbol.place` with `fields`). */
export function fieldCalls(doc: SchematicDocument, id: string, dx: number, dy: number): OpCall[] {
  const s = geometryOf(doc).symbols.get(id);
  if (!s) return [];
  const anchor = s.ref.anchor === "right" ? "right" : "left";
  const x = anchor === "right" ? s.ref.x1 : s.ref.x0;
  return [{ op: "symbol.place", id, fields: { dx: Math.round(x + dx) - s.rec.x, dy: Math.round(s.ref.y + dy) - s.rec.y, anchor } }];
}
