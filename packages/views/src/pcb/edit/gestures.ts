/**
 * A person's gestures on the layout screen as the core's operations (pure, no DOM): move, rotate, flip, delete,
 * lock and unlock a selection, and the inspector's numeric edits. One gesture is one transaction. Operations of
 * the Phase 2 kernel (footprint.move with attached copper, track.set_width, text and graphic edits) are used when
 * the page's copy of the core has them, and are reported as not available otherwise.
 */
import { mm, parsePadId, type BoardDocument, type BoardRecord, type Vertex } from "../board.js";
import type { PageOpCall } from "../types.js";
import { applyLocally, hasOperation, takesInput } from "./session.js";

export type Movable = "footprint" | "track" | "via" | "zone" | "keepout" | "text" | "graphic";

/** Selection ids as the records a gesture acts on: a pad stands for its footprint. */
export function targets(doc: BoardDocument, ids: readonly string[]): BoardRecord[] {
  const out = new Map<string, BoardRecord>();
  for (const id of ids) {
    const pad = parsePadId(id);
    const rid = pad ? pad.footprint : id;
    const r = doc.records.get(rid);
    if (r) out.set(rid, r);
  }
  return [...out.values()];
}

let attached: boolean | undefined;
/**
 * Whether footprint.move moves attached copper (`tracks: "attached"`, the Phase 2 kernel's default) in this core:
 * its schema takes the option and a trial move on a copy of the board applies (a core can name the option before it
 * is built).
 */
export function attachedTracks(doc?: BoardDocument): boolean {
  if (attached !== undefined) return attached;
  if (!takesInput("footprint.move", { ids: ["fp:x"], dx: 0, dy: 0, tracks: "attached" })) return (attached = false);
  const fp = doc ? [...doc.records.values()].find((r) => r.kind === "footprint" && !r.locked) : undefined;
  if (!doc || !fp) return false;
  return (attached = applyLocally(doc, [{ ops: [{ op: "footprint.move", ids: [fp.id], dx: 1000, dy: 0, tracks: "attached" }] }]).failed.length === 0);
}

const shift = (v: Vertex, dx: number, dy: number): Vertex => ({ ...v, x: v.x + dx, y: v.y + dy });

/**
 * Move the selection by (dx, dy) nanometers: one op per kind. One track segment or via alone is dragged with its
 * connected copper following (`track.drag`, when the core has it); otherwise tracks and vias translate rigidly.
 * Returns what it could not move.
 */
export function moveOps(doc: BoardDocument, ids: readonly string[], dx: number, dy: number): { ops: PageOpCall[]; skipped: string[] } {
  const rs = targets(doc, ids);
  if (rs.length === 1 && (rs[0].kind === "track" || rs[0].kind === "via") && hasOperation("track.drag") && !(rs[0].kind === "track" && rs[0].sweep)) return { ops: [{ op: "track.drag", id: rs[0].id, dx, dy, posture: "45" }], skipped: [] };
  const ops: PageOpCall[] = [];
  const skipped: string[] = [];
  const fps = rs.filter((r) => r.kind === "footprint").map((r) => r.id);
  const tracks = rs.filter((r) => r.kind === "track").map((r) => r.id);
  const vias = rs.filter((r) => r.kind === "via").map((r) => r.id);
  if (fps.length) ops.push({ op: "footprint.move", ids: fps, dx, dy, tracks: attachedTracks(doc) ? "attached" : "stay" });
  if (tracks.length) ops.push({ op: "track.move", ids: tracks, dx, dy });
  if (vias.length) ops.push({ op: "via.move", ids: vias, dx, dy });
  for (const r of rs) {
    if (r.kind === "zone" || r.kind === "keepout") ops.push({ op: `${r.kind}.edit`, id: r.id, patch: { outline: r.outline.map((v) => shift(v, dx, dy)), ...(r.holes ? { holes: r.holes.map((h) => h.map((v) => shift(v, dx, dy))) } : {}) } });
    else if (r.kind === "text" && hasOperation("text.edit")) ops.push({ op: "text.edit", id: r.id, patch: { x: r.x + dx, y: r.y + dy } });
    else if (r.kind === "graphic" && hasOperation("graphic.edit")) {
      const p: Record<string, unknown> = {};
      if (r.start) p.start = { x: r.start.x + dx, y: r.start.y + dy };
      if (r.end) p.end = { x: r.end.x + dx, y: r.end.y + dy };
      if (r.center) p.center = { x: r.center.x + dx, y: r.center.y + dy };
      if (r.points) p.points = r.points.map((v) => shift(v, dx, dy));
      ops.push({ op: "graphic.edit", id: r.id, patch: p });
    } else if (!["footprint", "track", "via", "zone", "keepout"].includes(r.kind)) skipped.push(r.id);
  }
  return { ops, skipped };
}

/** Rotate footprints by `angle` millidegrees (each about its origin; a group about its box center). */
export function rotateOps(doc: BoardDocument, ids: readonly string[], angle: number): { ops: PageOpCall[]; skipped: string[] } {
  const rs = targets(doc, ids);
  const fps = rs.filter((r) => r.kind === "footprint").map((r) => r.id);
  return { ops: fps.length ? [{ op: "footprint.rotate", ids: fps, angle, about: fps.length > 1 ? "center" : "each" }] : [], skipped: rs.filter((r) => r.kind !== "footprint").map((r) => r.id) };
}

/** Flip footprints to the other side. */
export function flipOps(doc: BoardDocument, ids: readonly string[]): { ops: PageOpCall[]; skipped: string[] } {
  const rs = targets(doc, ids);
  const fps = rs.filter((r) => r.kind === "footprint").map((r) => r.id);
  return { ops: fps.length ? [{ op: "footprint.flip", ids: fps, about: fps.length > 1 ? "center" : "each" }] : [], skipped: rs.filter((r) => r.kind !== "footprint").map((r) => r.id) };
}

const DELETE_OP: Partial<Record<BoardRecord["kind"], string>> = { track: "track.delete", via: "via.delete", zone: "zone.delete", keepout: "keepout.delete", text: "text.delete", graphic: "graphic.delete", footprint: "footprint.remove" };

/** Delete the selection: one op per kind the core can delete. */
export function deleteOps(doc: BoardDocument, ids: readonly string[]): { ops: PageOpCall[]; skipped: string[] } {
  const by = new Map<string, string[]>();
  const skipped: string[] = [];
  for (const r of targets(doc, ids)) {
    const op = DELETE_OP[r.kind];
    if (!op || !hasOperation(op)) {
      skipped.push(r.id);
      continue;
    }
    by.set(op, [...(by.get(op) ?? []), r.id]);
  }
  return { ops: [...by].map(([op, list]) => ({ op, ids: list })), skipped };
}

const LOCKABLE = new Set(["footprint", "track", "via", "zone", "keepout", "outline", "graphic", "text"]);

/** Lock or unlock the selection (what is already in that state is left out). */
export function lockOps(doc: BoardDocument, ids: readonly string[], lock: boolean): PageOpCall[] {
  const list = targets(doc, ids)
    .filter((r) => LOCKABLE.has(r.kind) && !!(r as { locked?: true }).locked !== lock)
    .map((r) => r.id);
  return list.length ? [{ op: lock ? "lock" : "unlock", ids: list }] : [];
}

/** Whether every lockable record of the selection is locked. */
export function allLocked(doc: BoardDocument, ids: readonly string[]): boolean {
  const rs = targets(doc, ids).filter((r) => LOCKABLE.has(r.kind));
  return rs.length > 0 && rs.every((r) => (r as { locked?: true }).locked);
}

/** The point a drag snaps (a footprint's origin, a via's center, a track's start), nanometers. */
export function anchorOf(doc: BoardDocument, ids: readonly string[]): { x: number; y: number } | undefined {
  for (const r of targets(doc, ids)) {
    if (r.kind === "footprint" || r.kind === "via" || r.kind === "text") return { x: r.x, y: r.y };
    if (r.kind === "track") return { ...r.start };
  }
  return undefined;
}

/** A drag delta snapped so the anchor lands on the grid (nanometers; grid in millimeters, 0 for none). */
export function snapDelta(anchor: { x: number; y: number } | undefined, dx: number, dy: number, gridMm: number): { dx: number; dy: number } {
  if (!gridMm || !anchor) return { dx: Math.round(dx), dy: Math.round(dy) };
  const g = mm(gridMm);
  const sx = Math.round((anchor.x + dx) / g) * g - anchor.x;
  const sy = Math.round((anchor.y + dy) / g) * g - anchor.y;
  return { dx: Math.round(sx), dy: Math.round(sy) };
}

export type NumericField = "x" | "y" | "rotation" | "width";

/** The inspector's numeric fields for one record, in millimeters and degrees, and whether each can be edited now. */
export function numericFields(r: BoardRecord | undefined): { field: NumericField; label: string; value: number; unit: string; editable: boolean; why?: string }[] {
  if (!r) return [];
  if (r.kind === "footprint")
    return [
      { field: "x", label: "X", value: r.x / 1e6, unit: "mm", editable: true },
      { field: "y", label: "Y", value: r.y / 1e6, unit: "mm", editable: true },
      { field: "rotation", label: "Rotation", value: r.rotation / 1000, unit: "°", editable: true },
    ];
  if (r.kind === "via")
    return [
      { field: "x", label: "X", value: r.x / 1e6, unit: "mm", editable: true },
      { field: "y", label: "Y", value: r.y / 1e6, unit: "mm", editable: true },
    ];
  if (r.kind === "track") {
    const can = hasOperation("track.set_width");
    return [{ field: "width", label: "Width", value: r.width / 1e6, unit: "mm", editable: can, ...(can ? {} : { why: "track.set_width is not in this core yet (kernel not available)" }) }];
  }
  if (r.kind === "text" && hasOperation("text.edit"))
    return [
      { field: "x", label: "X", value: r.x / 1e6, unit: "mm", editable: true },
      { field: "y", label: "Y", value: r.y / 1e6, unit: "mm", editable: true },
    ];
  return [];
}

/** The transaction for one numeric edit (value in millimeters or degrees as shown). */
export function numericOps(r: BoardRecord, field: NumericField, value: number): PageOpCall[] {
  if (!Number.isFinite(value)) return [];
  if (r.kind === "footprint") {
    if (field === "x") return [{ op: "footprint.place", id: r.id, x: mm(value) }];
    if (field === "y") return [{ op: "footprint.place", id: r.id, y: mm(value) }];
    if (field === "rotation") return [{ op: "footprint.place", id: r.id, rotation: Math.round(value * 1000) }];
  }
  if (r.kind === "via" && (field === "x" || field === "y")) return [{ op: "via.move", ids: [r.id], dx: field === "x" ? mm(value) - r.x : 0, dy: field === "y" ? mm(value) - r.y : 0 }];
  if (r.kind === "track" && field === "width" && hasOperation("track.set_width")) return [{ op: "track.set_width", ids: [r.id], width: mm(value) }];
  if (r.kind === "text" && (field === "x" || field === "y") && hasOperation("text.edit")) return [{ op: "text.edit", id: r.id, patch: field === "x" ? { x: mm(value) } : { y: mm(value) } }];
  return [];
}

/** A short label for a gesture's transaction (3 to 8 words, as the core asks). */
export function gestureLabel(verb: string, doc: BoardDocument, ids: readonly string[]): string {
  const rs = targets(doc, ids);
  const what = rs.length === 1 ? (rs[0].kind === "footprint" ? rs[0].ref : rs[0].kind === "track" || rs[0].kind === "via" ? `${rs[0].net ?? "unassigned"} ${rs[0].kind}` : rs[0].kind) : `${rs.length} objects`;
  return `${verb} ${what} by hand`.replace(/\s+/g, " ").split(" ").slice(0, 8).join(" ");
}
