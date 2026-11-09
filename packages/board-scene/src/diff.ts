/**
 * What a transaction (or any edit) changed, in plain structured terms: footprints moved, rotated, flipped; copper
 * added, removed, moved, grouped by net as rerouted, with lengths and completion before and after; areas added,
 * removed or edited; locks set or cleared. With an image of the same change: the old state dashed in gray, the new
 * in the highlight color, a numbered marker on each change.
 */
import { diffIds, type BoardDocument, type BoardSnapshot } from "@protoboardai/board";
import { connectivityOf, type ConnectivityInput } from "./connectivity.js";
import { buildModel, isSnapshot, objectBox, type BoardModel } from "./model.js";
import { svgToPng } from "./png.js";
import type { MarkerItem } from "./scene.js";
import { renderSvg } from "./svg.js";
import { boxArr, byStr, dist, inflateBox, natCmp, ptArr, r2, r3, unite, type BoxMm } from "./util.js";

export const DIFF_SCHEMA = "protoboard.board-scene-diff/v1";

export interface DiffOptions {
  image?: "svg" | "png" | "both" | "none";
  /** Draw the whole board instead of the changed area. */
  whole?: boolean;
  maxPx?: number;
  connectivity?: { before?: ConnectivityInput; after?: ConnectivityInput };
}

export interface DiffResult {
  diff: Record<string, unknown>;
  json: string;
  svg?: string;
  png?: Uint8Array;
  markers: MarkerItem[];
  changed: string[];
}

const docOf = (v: BoardSnapshot | BoardDocument): BoardDocument => (isSnapshot(v) ? v.doc : v);

function changedKeys(a: object | undefined, b: object | undefined): string[] {
  const out: string[] = [];
  const x = (a ?? {}) as Record<string, unknown>;
  const y = (b ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (k !== "id" && k !== "kind" && JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(k);
  return out.sort(byStr);
}

/** Describe what changed between two snapshots or documents of one board. */
export function diffScene(before: BoardSnapshot | BoardDocument, after: BoardSnapshot | BoardDocument, options: DiffOptions = {}): DiffResult {
  const A = buildModel(before);
  const B = buildModel(after);
  const da = docOf(before);
  const db = docOf(after);
  const ids = diffIds(da, db);
  const ca = connectivityOf(A, options.connectivity?.before);
  const cb = connectivityOf(B, options.connectivity?.after);

  const footprints: Record<string, unknown>[] = [];
  const nets = new Map<string, { added: string[]; removed: string[]; moved: string[]; edited: string[] }>();
  const areas: Record<string, unknown>[] = [];
  const locks: Record<string, unknown>[] = [];
  const other: Record<string, unknown>[] = [];
  const netOf = (m: BoardModel, id: string) => m.trackById.get(id)?.net ?? m.viaById.get(id)?.net;
  const bucket = (net: string | undefined) => {
    const k = net ?? "(no net)";
    let e = nets.get(k);
    if (!e) nets.set(k, (e = { added: [], removed: [], moved: [], edited: [] }));
    return e;
  };

  for (const id of ids) {
    const ra = da.records.get(id);
    const rb = db.records.get(id);
    const change = !ra ? "added" : !rb ? "removed" : "changed";
    const keys = change === "changed" ? changedKeys(ra, rb) : [];
    if (keys.length === 1 && keys[0] === "locked") {
      locks.push({ id, locked: [ra && "locked" in ra && ra.locked === true, rb && "locked" in rb && rb.locked === true] });
      continue;
    }
    if (keys.includes("locked")) locks.push({ id, locked: [ra && "locked" in ra && ra.locked === true, rb && "locked" in rb && rb.locked === true] });
    const kind = (rb ?? ra)!.kind;
    if (kind === "footprint") {
      const fa = A.fpById.get(id);
      const fb = B.fpById.get(id);
      const e: Record<string, unknown> = { id, ref: (fb ?? fa)!.ref, change };
      if (fa && fb) {
        const d = dist(fa, fb);
        if (d > 0) Object.assign(e, { change: "moved", from: ptArr(fa), to: ptArr(fb), dx: r3(fb.x - fa.x), dy: r3(fb.y - fa.y), distance: r3(d) });
        if (fa.rot !== fb.rot) Object.assign(e, { rotated: r3((((fb.rot - fa.rot) % 360) + 540) % 360 - 180), rot: [r3(fa.rot), r3(fb.rot)] });
        if (fa.side !== fb.side) Object.assign(e, { flipped: [fa.side, fb.side] });
        const rest = keys.filter((k) => !["x", "y", "rotation", "side", "locked", "provenance"].includes(k));
        if (rest.length) e.fields = rest;
        if (d === 0 && fa.rot === fb.rot && fa.side === fb.side) e.change = "edited";
      } else if (fb) Object.assign(e, { at: ptArr(fb) });
      else if (fa) Object.assign(e, { at: ptArr(fa) });
      footprints.push(e);
    } else if (kind === "track" || kind === "via") {
      const na = ra ? netOf(A, id) : undefined;
      const nb = rb ? netOf(B, id) : undefined;
      if (change === "added") bucket(nb).added.push(id);
      else if (change === "removed") bucket(na).removed.push(id);
      else if (na !== nb) {
        bucket(na).removed.push(id);
        bucket(nb).added.push(id);
      } else {
        const geo = keys.some((k) => ["start", "end", "x", "y", "sweep", "layer", "width", "from_layer", "to_layer", "outer_diameter"].includes(k));
        (geo ? bucket(nb).moved : bucket(nb).edited).push(id);
      }
    } else if (kind === "zone" || kind === "keepout") {
      areas.push({ id, kind, change: change === "changed" ? "edited" : change, ...(keys.length ? { fields: keys } : {}) });
    } else other.push({ id, kind, change: change === "changed" ? "edited" : change, ...(keys.length ? { fields: keys } : {}) });
  }

  const lenOf = (m: BoardModel, net: string) => {
    const out: Record<string, number> = {};
    for (const l of m.copper) {
      const s = m.tracks.filter((t) => (t.net ?? "(no net)") === net && t.layer === l).reduce((a, t) => a + t.len, 0);
      if (s > 0) out[l] = r2(s);
    }
    return out;
  };
  const copper: Record<string, unknown>[] = [...nets.keys()].sort(byStr).map((net) => {
    const e = nets.get(net)!;
    const sa = ca.nets.get(net);
    const sb = cb.nets.get(net);
    const kind = e.added.length && !e.removed.length && !e.moved.length ? (sb?.status === "complete" && sa?.status !== "complete" ? "routed" : "added") : e.removed.length && !e.added.length && !e.moved.length ? "removed" : "rerouted";
    return {
      net,
      change: kind,
      ...(e.added.length ? { added: e.added.sort(byStr) } : {}),
      ...(e.removed.length ? { removed: e.removed.sort(byStr) } : {}),
      ...(e.moved.length ? { moved: e.moved.sort(byStr) } : {}),
      ...(e.edited.length ? { edited: e.edited.sort(byStr) } : {}),
      len: [lenOf(A, net), lenOf(B, net)],
      vias: [A.vias.filter((v) => (v.net ?? "(no net)") === net).length, B.vias.filter((v) => (v.net ?? "(no net)") === net).length],
      ...(sa || sb ? { status: [sa?.status ?? "empty", sb?.status ?? "empty"], missing: [sa?.missing ?? 0, sb?.missing ?? 0] } : {}),
    };
  });
  // completion changes of nets whose copper did not change (a footprint move can connect or break them)
  const completion: Record<string, unknown>[] = [];
  for (const [net, sb] of cb.nets) {
    const sa = ca.nets.get(net);
    if (nets.has(net)) continue;
    if (!sa || sa.status !== sb.status || sa.missing !== sb.missing) completion.push({ net, status: [sa?.status ?? "empty", sb.status], missing: [sa?.missing ?? 0, sb.missing] });
  }
  footprints.sort((a, b) => natCmp(String(a.ref), String(b.ref)));

  // markers, in the order of the lists
  const markers: MarkerItem[] = [];
  let n = 0;
  const mark = (e: Record<string, unknown>, id: string, label: string, box: BoxMm | undefined) => {
    if (!box) return;
    e.m = ++n;
    markers.push({ n, id, kind: "change", label, at: { x: box.maxX, y: box.maxY } });
  };
  const boxIn = (id: string) => objectBox(B, id) ?? objectBox(A, id);
  for (const e of footprints) mark(e, String(e.id), String(e.ref), boxIn(String(e.id)));
  for (const e of copper) {
    const all = [...((e.added as string[]) ?? []), ...((e.moved as string[]) ?? []), ...((e.removed as string[]) ?? []), ...((e.edited as string[]) ?? [])];
    let b: BoxMm | undefined;
    for (const id of all) {
      const x = boxIn(id);
      if (x) b = b ? unite(b, x) : x;
    }
    e.id = `net:${e.net}`;
    mark(e, `net:${e.net}`, String(e.net), b);
  }
  for (const e of areas) mark(e, String(e.id), String(e.id), boxIn(String(e.id)));

  const summary = {
    footprints: { moved: footprints.filter((f) => f.change === "moved").length, added: footprints.filter((f) => f.change === "added").length, removed: footprints.filter((f) => f.change === "removed").length, edited: footprints.filter((f) => f.change === "edited").length },
    copper: { nets: copper.length, segmentsAdded: copper.reduce((s, c) => s + (((c.added as string[]) ?? []).length), 0), segmentsRemoved: copper.reduce((s, c) => s + (((c.removed as string[]) ?? []).length), 0), segmentsMoved: copper.reduce((s, c) => s + (((c.moved as string[]) ?? []).length), 0) },
    areas: areas.length,
    locks: locks.length,
    other: other.length,
    missingLinks: [[...ca.nets.values()].reduce((s, x) => s + x.missing, 0), [...cb.nets.values()].reduce((s, x) => s + x.missing, 0)],
  };
  const sa = isSnapshot(before) ? { epoch: before.epoch, seq: before.seq } : undefined;
  const sb = isSnapshot(after) ? { epoch: after.epoch, seq: after.seq } : undefined;
  const diff: Record<string, unknown> = {
    schema: DIFF_SCHEMA,
    units: "mm and degrees; +Y up; [before, after] pairs",
    ...(sa || sb ? { versions: [sa ?? null, sb ?? null] } : {}),
    changed: ids.length,
    summary,
    ...(footprints.length ? { footprints } : {}),
    ...(copper.length ? { copper } : {}),
    ...(completion.length ? { completion } : {}),
    ...(areas.length ? { areas } : {}),
    ...(locks.length ? { locks } : {}),
    ...(other.length ? { other } : {}),
    markers: markers.map((m) => [m.n, m.id]),
    connectivity: ca.source === "estimate" ? "estimated from geometry by the scene" : `from ${ca.source}`,
  };
  const json = JSON.stringify(diff);
  const result: DiffResult = { diff, json, markers, changed: ids };
  const image = options.image ?? "svg";
  if (image !== "none") {
    let box: BoxMm | undefined;
    for (const id of ids) {
      for (const m of [A, B]) {
        const x = objectBox(m, id);
        if (x) box = box ? unite(box, x) : x;
      }
    }
    const view = options.whole || !box ? inflateBox(B.box, 1) : inflateBox(box, 3);
    const svg = renderSvg(B, { box: view, ghost: { before: A, changed: ids }, markers, labels: "refs", ...(options.maxPx ? { maxPx: options.maxPx } : {}), title: `${B.name}  change: ${ids.length} objects  view ${boxArr(view).join(" ")}` });
    if (image === "svg" || image === "both") result.svg = svg;
    if (image === "png" || image === "both") result.png = svgToPng(svg).png;
  }
  return result;
}
