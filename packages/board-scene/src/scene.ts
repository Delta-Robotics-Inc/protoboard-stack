/**
 * The scene description: compact JSON sized for a language model's context, at three levels of detail
 * (overview, region, object), with filters by region, net, layer and kind, a stated size budget, deterministic
 * ordering, and the core's ids on every object. Items that also appear as numbered markers in the image carry
 * `m`, and `markers` lists them in order, so marker 7 in the picture is the item with `m: 7`.
 */
import { toMm, type Finding } from "@protoboardai/board";
import { connectivityOf, type ConnectivityInput, type ConnectivityResult, type RatLink } from "./connectivity.js";
import { padSdf, type BoardModel, type MArea, type MFootprint, type MPad, type MTrack, type MVia, netBox, objectBox, objectKind } from "./model.js";
import { congestion, copperNear, DIRECTIONS, findCorridor, nearestByDirection, neighborsOf, niceCell, ratCrossings, type Corridor, type CorridorQuery, type RatCrossing } from "./relations.js";
import { boxArr, byStr, clipSegment, inBox, inflateBox, intersectBox, overlaps, polyDist, polyMidpoint, polyPolyDist, ptArr, r2, r3, type BoxMm, type Pt } from "./util.js";

export const SCENE_SCHEMA = "protoboard.board-scene/v1";

export type Detail = "overview" | "region" | "object";
export type SceneKind = "footprint" | "pad" | "track" | "via" | "zone" | "keepout" | "net" | "rat" | "finding" | "congestion" | "corridor";

/** Size budgets in characters of compact JSON (about 3 characters per token for this kind of JSON; see the README). */
export const BUDGETS: Record<Detail, number> = { overview: 24_000, region: 40_000, object: 16_000 };

export interface SceneOptions {
  detail: Detail;
  /** The view box (mm); objects whose boxes meet it are in the scene. */
  region?: BoxMm;
  nets?: string[];
  /** Copper layers in view (default all). */
  layers?: string[];
  kinds?: SceneKind[];
  /** For detail "object": a core id (footprint, pad, track, via, zone, keep-out), `net:<name>`, or a finding id. */
  focus?: string;
  findings?: Finding[];
  connectivity?: ConnectivityInput | ConnectivityResult;
  corridors?: CorridorQuery[];
  /** Track detail: polylines per net (default) or every segment. */
  tracks?: "polylines" | "segments";
  /** Override the level's character budget. */
  budget?: number;
  /** Congestion cell size, mm (default: a round size giving about 8 cells across). */
  cell?: number;
  /**
   * Which items get numbered markers (default findings, rats, corridors, keep-outs, zones). Footprints are matched
   * by the reference drawn on them; add "footprint" to number them too.
   */
  markerKinds?: SceneKind[];
  /** Rats get markers only when at most this many are in view (default 20); more are drawn as plain dashed lines. */
  ratMarkers?: number;
}

export interface MarkerItem {
  n: number;
  id: string;
  kind: SceneKind | "change";
  label: string;
  at: Pt;
  severity?: "error" | "warning" | "info";
}

export interface SceneBuild {
  scene: Record<string, unknown>;
  json: string;
  markers: MarkerItem[];
  view: BoxMm;
  layers: string[];
  conn: ConnectivityResult;
  rats: RatLink[];
  corridors: Corridor[];
  findings: Finding[];
  /** Nets and object ids the image should highlight (the focus). */
  highlight: { nets: string[]; ids: string[] };
}

const isResult = (c: ConnectivityInput | ConnectivityResult): c is ConnectivityResult => (c as ConnectivityResult).nets instanceof Map;

const prov = (p: { by: string; edited?: string }): string => (p.edited ? `${p.by}+${p.edited}` : p.by);

/** Footprint ids in view under the filters. */
function footprintsInView(model: BoardModel, view: BoxMm, o: SceneOptions): MFootprint[] {
  return model.footprints.filter((f) => {
    if (!overlaps(f.box, view)) return false;
    if (o.nets && !f.nets.some((n) => o.nets!.includes(n))) return false;
    if (o.layers && !f.copper.some((l) => o.layers!.includes(l)) && !o.layers.includes(f.side)) return false;
    return true;
  });
}

function trackInView(t: MTrack, view: BoxMm, o: SceneOptions): boolean {
  if (!overlaps(t.box, view)) return false;
  if (o.nets && (!t.net || !o.nets.includes(t.net))) return false;
  if (o.layers && !o.layers.includes(t.layer)) return false;
  return true;
}
function viaInView(v: MVia, view: BoxMm, o: SceneOptions): boolean {
  if (!overlaps(v.box, view)) return false;
  if (o.nets && (!v.net || !o.nets.includes(v.net))) return false;
  if (o.layers && !v.layers.some((l) => o.layers!.includes(l))) return false;
  return true;
}
function areaInView(a: MArea, view: BoxMm, o: SceneOptions): boolean {
  if (!overlaps(a.box, view)) return false;
  if (o.nets && a.kind === "zone" && (!a.net || !o.nets.includes(a.net))) return false;
  if (o.layers && !a.layers.some((l) => o.layers!.includes(l))) return false;
  return true;
}

// ---------------------------------------------------------------- polylines

export interface Polyline {
  net?: string;
  layer: string;
  w: number;
  pts: Pt[];
  ids: string[];
  arcs: string[];
  len: number;
  locked: number;
  by: string[];
}

const key = (p: Pt) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

/** Chain a net's segments on each layer and width into polylines (arcs contribute their midpoint). */
export function polylines(tracks: readonly MTrack[]): Polyline[] {
  const groups = new Map<string, MTrack[]>();
  for (const t of [...tracks].sort((a, b) => byStr(a.id, b.id))) {
    const k = `${t.net ?? ""}|${t.layer}|${r3(t.w)}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(t);
  }
  const out: Polyline[] = [];
  for (const g of [...groups.keys()].sort(byStr).map((k) => groups.get(k)!)) {
    const ends = new Map<string, number[]>();
    g.forEach((t, i) => {
      for (const p of [t.a, t.b]) {
        const k = key(p);
        const l = ends.get(k) ?? [];
        l.push(i);
        ends.set(k, l);
      }
    });
    const used = new Uint8Array(g.length);
    const walk = (start: number, from: Pt) => {
      const chain: { t: MTrack; fwd: boolean }[] = [];
      let cur = start;
      let at = from;
      for (;;) {
        used[cur] = 1;
        const t = g[cur];
        const fwd = key(t.a) === key(at);
        chain.push({ t, fwd });
        at = fwd ? t.b : t.a;
        const next = (ends.get(key(at)) ?? []).filter((i) => !used[i]);
        if ((ends.get(key(at)) ?? []).length !== 2 || next.length !== 1) break;
        cur = next[0];
      }
      const pts: Pt[] = [];
      const first = chain[0];
      pts.push(first.fwd ? first.t.a : first.t.b);
      for (const { t, fwd } of chain) {
        if (t.sweep !== undefined) pts.push(polyMidpoint(t.pts));
        pts.push(fwd ? t.b : t.a);
      }
      const ts = chain.map((c) => c.t);
      out.push({
        ...(g[0].net ? { net: g[0].net } : {}),
        layer: g[0].layer,
        w: g[0].w,
        pts,
        ids: ts.map((t) => t.id).sort(byStr),
        arcs: ts.filter((t) => t.sweep !== undefined).map((t) => t.id).sort(byStr),
        len: ts.reduce((s, t) => s + t.len, 0),
        locked: ts.filter((t) => t.locked).length,
        by: [...new Set(ts.map((t) => prov(t.prov)))].sort(byStr),
      });
    };
    // start at chain ends (an endpoint not shared by exactly two segments), then whatever is left (loops)
    g.forEach((t, i) => {
      if (used[i]) return;
      for (const p of [t.a, t.b]) if (!used[i] && (ends.get(key(p)) ?? []).length !== 2) walk(i, p);
    });
    g.forEach((t, i) => {
      if (!used[i]) walk(i, t.a);
    });
  }
  return out;
}

// ---------------------------------------------------------------- per-object helpers

/** Copper of the pad's net that touches the pad on one of its layers. */
export function padCopper(model: BoardModel, pad: MPad): string[] {
  const out: string[] = [];
  for (const t of model.tracks) {
    if (!pad.net || t.net !== pad.net || !pad.layers.includes(t.layer) || !overlaps(inflateBox(t.box, 0.01), pad.box)) continue;
    if (padSdf(pad.shape, t.a) <= t.w / 2 + 0.001 || padSdf(pad.shape, t.b) <= t.w / 2 + 0.001 || polyDist({ x: pad.x, y: pad.y }, t.pts) <= t.w / 2) out.push(t.id);
  }
  for (const v of model.vias) if (pad.net && v.net === pad.net && v.layers.some((l) => pad.layers.includes(l)) && padSdf(pad.shape, v) <= v.d / 2) out.push(v.id);
  return out.sort(byStr);
}

/** Copper of other nets within `radius` of a track or via, nearest first: [id, net, gap]. */
function foreignNear(model: BoardModel, pts: Pt[], halfWidth: number, layers: string[], net: string | undefined, radius = 1.0): [string, string, number][] {
  const out: [string, string, number][] = [];
  const box = inflateBox({ minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) }, radius + halfWidth + 2);
  for (const t of model.tracks) {
    if (!layers.includes(t.layer) || (net && t.net === net) || !overlaps(t.box, box)) continue;
    const g = polyPolyDist(pts, t.pts) - halfWidth - t.w / 2;
    if (g <= radius && pts !== t.pts) out.push([t.id, t.net ?? "(no net)", Math.max(0, g)]);
  }
  for (const v of model.vias) {
    if (!v.layers.some((l) => layers.includes(l)) || (net && v.net === net) || !overlaps(v.box, box)) continue;
    const g = polyDist(v, pts) - halfWidth - v.d / 2;
    if (g <= radius) out.push([v.id, v.net ?? "(no net)", Math.max(0, g)]);
  }
  for (const p of model.pads) {
    if ((!p.layers.some((l) => layers.includes(l)) && p.type !== "np") || (net && p.net === net) || !overlaps(p.box, box)) continue;
    let g = Infinity;
    for (const q of pts) g = Math.min(g, padSdf(p.shape, q));
    for (let i = 0; i + 1 < pts.length; i++) {
      const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      g = Math.min(g, padSdf(p.shape, m), polyDist({ x: p.x, y: p.y }, pts) - Math.min(p.w, p.h) / 2);
    }
    g -= halfWidth;
    if (g <= radius) out.push([p.id, p.net ?? "(no net)", Math.max(0, g)]);
  }
  return out.sort((a, b) => a[2] - b[2] || byStr(a[0], b[0])).slice(0, 8).map(([i, n, g]) => [i, n, r3(g)]);
}

function fpOverview(model: BoardModel, f: MFootprint): Record<string, unknown> {
  const near = nearestByDirection(model, f);
  const n: Record<string, [string, number]> = {};
  for (const d of DIRECTIONS) if (near[d]) n[d] = [near[d]!.ref, r2(near[d]!.gap)];
  return {
    id: f.id,
    ref: f.ref,
    ...(f.value ? { value: f.value } : {}),
    side: f.side,
    at: ptArr(f),
    rot: r3(f.rot),
    box: boxArr(f.box),
    pads: f.pads.length,
    near: n,
    ...(f.locked ? { lock: true } : {}),
    by: prov(f.prov),
  };
}

function padRow(p: MPad): (string | number | null)[] {
  const row: (string | number | null)[] = [p.number, r3(p.x), r3(p.y), p.net ?? null];
  if (p.pin) row.push(p.pin);
  return row;
}

function fpRegion(model: BoardModel, f: MFootprint, tracks: readonly MTrack[]): Record<string, unknown> {
  const e = fpOverview(model, f);
  e.footprint = f.footprint;
  e.pads = f.pads.map(padRow);
  const cu = copperNear(model, f, 1.0, tracks).map((c) => [c.rel, c.net, c.layer, r2(c.gap)]);
  if (cu.length) e.copper = cu;
  return e;
}

function netEntry(model: BoardModel, name: string, conn: ConnectivityResult, level: Detail): Record<string, unknown> {
  const n = model.netByName.get(name)!;
  const len: Record<string, number> = {};
  for (const l of model.copper) {
    const s = model.tracks.filter((t) => t.net === name && t.layer === l).reduce((a, t) => a + t.len, 0);
    if (s > 0) len[l] = r2(s);
  }
  const st = conn.nets.get(name);
  const e: Record<string, unknown> = {
    name,
    class: n.class,
    pads: n.pads.length,
    ...(Object.keys(len).length ? { len } : {}),
    vias: model.vias.filter((v) => v.net === name).length,
    status: st?.status ?? "empty",
    ...(st && st.missing ? { missing: st.missing } : {}),
  };
  if (n.missingPins.length) e.notOnBoard = n.missingPins;
  if (model.zones.some((z) => z.net === name)) e.zones = model.zones.filter((z) => z.net === name).map((z) => z.id);
  if (level !== "overview" && st) {
    e.islands = st.islands.length;
    if (st.floating.length) e.floating = st.floating.length;
  }
  return e;
}

function areaEntry(a: MArea): Record<string, unknown> {
  if (a.kind === "zone")
    return { id: a.id, ...(a.name ? { name: a.name } : {}), ...(a.net ? { net: a.net } : {}), layers: a.layers, priority: a.priority, box: boxArr(a.box), area: r2(a.area), fill: a.fill, connect: a.connect, filled: "not computed", ...(a.locked ? { lock: true } : {}), by: prov(a.prov) };
  const blocks = (["tracks", "vias", "pours", "footprints"] as const).filter((k) => a.blocks?.[k]);
  return { id: a.id, ...(a.name ? { name: a.name } : {}), layers: a.layers, blocks, tier: a.tier, box: boxArr(a.box), ...(a.owner ? { owner: a.owner } : {}), ...(a.description ? { note: a.description } : {}), ...(a.locked ? { lock: true } : {}), by: prov(a.prov) };
}

/** Overview form: [id, from id, to id, length, crossed track ids]. */
function ratRow(r: RatLink, crossings: RatCrossing[]): unknown[] {
  const x = crossings.filter((c) => c.rat === r.id).map((c) => c.track);
  return [r.id, r.from.id, r.to.id, r2(r.len), ...(x.length ? [x] : [])];
}

function ratEntry(r: RatLink, crossings: RatCrossing[]): Record<string, unknown> {
  const x = crossings.filter((c) => c.rat === r.id).map((c) => [c.track, c.net, c.layer]);
  return { id: r.id, net: r.net, from: [r.from.id, ...ptArr(r.from.at)], to: [r.to.id, ...ptArr(r.to.at)], len: r2(r.len), ...(x.length ? { crosses: x } : {}) };
}

function findingEntry(f: Finding): Record<string, unknown> {
  return {
    id: f.id,
    check: f.check,
    severity: f.severity,
    ...(f.rule ? { rule: f.rule } : {}),
    at: [r3(toMm(f.location.x)), r3(toMm(f.location.y))],
    ...(f.location.layer ? { layer: f.location.layer } : {}),
    objects: f.objects,
    ...(f.measured !== undefined ? { measured: r3(toMm(f.measured)) } : {}),
    ...(f.required !== undefined ? { required: r3(toMm(f.required)) } : {}),
    message: f.message,
  };
}

function polyEntry(p: Polyline): Record<string, unknown> {
  return {
    ...(p.net ? { net: p.net } : { net: null }),
    layer: p.layer,
    w: r3(p.w),
    pts: p.pts.map(ptArr),
    len: r2(p.len),
    ids: p.ids,
    ...(p.arcs.length ? { arcs: p.arcs } : {}),
    ...(p.locked ? { locked: p.locked } : {}),
    by: p.by.length === 1 ? p.by[0] : p.by,
  };
}

function segEntry(t: MTrack): Record<string, unknown> {
  return { id: t.id, net: t.net ?? null, layer: t.layer, w: r3(t.w), a: ptArr(t.a), b: ptArr(t.b), ...(t.sweep !== undefined ? { sweep: r3(t.sweep) } : {}), len: r3(t.len), ...(t.locked ? { lock: true } : {}), by: prov(t.prov) };
}

function viaEntry(v: MVia): Record<string, unknown> {
  return { id: v.id, net: v.net ?? null, at: ptArr(v), d: r3(v.d), hole: r3(v.hole), span: [v.from, v.to], ...(v.locked ? { lock: true } : {}), by: prov(v.prov) };
}

function corridorEntry(c: Corridor): Record<string, unknown> {
  return {
    from: ptArr(c.from),
    to: ptArr(c.to),
    layer: c.layer,
    ...(c.net ? { net: c.net } : {}),
    w: r3(c.width),
    clearance: r3(c.clearance),
    found: c.found,
    ...(c.found ? { len: r2(c.length!), maxWidth: r2(c.maxWidth!), path: c.path!.map(ptArr) } : { stuckAt: ptArr(c.stuckAt!), blockedBy: c.blockedBy }),
    ...(c.startShift > 0.001 || c.endShift > 0.001 ? { shift: [r3(c.startShift), r3(c.endShift)] } : {}),
    res: r3(c.res),
  };
}

function congestionEntry(model: BoardModel, box: BoxMm, layers: string[], cell?: number): Record<string, unknown> {
  const c = congestion(model, box, { layers, ...(cell ? { cell } : {}) });
  const ls: Record<string, unknown> = {};
  for (const l of layers) ls[l] = c.layers[l];
  return { box: boxArr(c.box), cell: c.cell, cols: c.cols, rows: c.rows, res: r3(c.res), w: r3(c.width), clearance: r3(c.clearance), layers: ls };
}

// ---------------------------------------------------------------- the scene

const LEGEND_BASE: Record<string, string> = {
  units: "mm and degrees; +X right, +Y up; origin at the board center; boxes are [minX, minY, maxX, maxY]",
  ids: "the board core's ids; rat:<net>:<n> ratsnest lines are scene-only",
  m: "marker number: the same number is drawn in the image; markers lists [n, id] for every marker; footprints are found in the image by the reference drawn on them",
  near: "nearest footprint in each direction: [ref, edge-to-edge gap mm] (direction by center offset, 90 degree cones)",
  by: "provenance: generated, imported, routed, hand, agent, system (+ how it was edited later)",
  status: "complete | partial (some copper, links missing) | unrouted (no copper) | single (one pad) | empty",
};

function legendFor(detail: Detail): Record<string, string> {
  const l = { ...LEGEND_BASE };
  if (detail === "overview") l.rats = "missing links: [id, from id, to id, length mm, ids of other nets' tracks the line crosses]";
  if (detail !== "overview") {
    l.pads = "[number, x, y, net or null, pin name when known]";
    l.copper = "other nets' tracks at this footprint: [under | through | beside, net, layer, gap mm]; under = on a layer the part has no pads on";
    l.tracks = "one polyline per chained run of a net on one layer and width; arcs add their midpoint; ids are the segments";
  }
  l.congestion = "per layer, rows top (max Y) to bottom, columns left to right: copper = % of board area; hFree / vFree = tracks of width w with the clearance that fit across the cell left to right / bottom to top";
  return l;
}

/** Where the scene's completion numbers come from, in one line: the checks' result, or the scene's own estimate. */
export function connectivityNote(conn: ConnectivityResult): string {
  const ESTIMATE = "estimated from geometry by the scene (copper overlap on a shared layer; zone fill not computed: an item inside a zone of its net on a zone layer counts as joined)";
  if (conn.source === "estimate") return `${ESTIMATE}; no checks result was given`;
  const fill =
    conn.zoneFill === "provided"
      ? "; zone fill given to the checks"
      : conn.zoneFill === "partial"
        ? `; zone fill given for some zones (none for ${conn.zonesWithoutFill?.join(", ") ?? "some"})`
        : conn.zoneFill === "absent"
          ? "; no zone fill was given: zones connect nothing in these numbers"
          : "";
  const rest = conn.estimated?.length ? `; nets the checks did not report (${conn.estimated.slice(0, 8).join(", ")}${conn.estimated.length > 8 ? ", ..." : ""}) are ${ESTIMATE}` : "";
  return `from the board checks${conn.source === "checks" ? "" : ` (${conn.source})`}${fill}${rest}`;
}

export function buildScene(model: BoardModel, options: SceneOptions): SceneBuild {
  const o = options;
  const detail = o.detail;
  const conn = o.connectivity ? (isResult(o.connectivity) ? o.connectivity : connectivityOf(model, o.connectivity)) : connectivityOf(model);
  const findings = o.findings ?? [];
  const focusFinding = o.focus ? findings.find((f) => f.id === o.focus) : undefined;
  const focusKind = o.focus && !focusFinding ? objectKind(model, o.focus) : undefined;
  if (o.focus && !focusFinding && !focusKind) throw new Error(`unknown object or finding: ${o.focus}`);
  const boardView = inflateBox(model.box, 0.5);
  let view = o.region ?? boardView;
  if (detail === "object" && !o.region) {
    const b = focusFinding ? (focusFinding.box ? { minX: toMm(focusFinding.box.minX), minY: toMm(focusFinding.box.minY), maxX: toMm(focusFinding.box.maxX), maxY: toMm(focusFinding.box.maxY) } : { minX: toMm(focusFinding.location.x), minY: toMm(focusFinding.location.y), maxX: toMm(focusFinding.location.x), maxY: toMm(focusFinding.location.y) }) : objectBox(model, o.focus!);
    view = inflateBox(b ?? model.box, 3);
  }
  const layers = (o.layers ?? model.copper).filter((l) => model.copper.includes(l));
  const filters: SceneOptions = { ...o, ...(o.layers ? { layers } : {}) };
  const want = (k: SceneKind) => !o.kinds || o.kinds.includes(k);

  const fps = footprintsInView(model, view, filters);
  const tracks = model.tracks.filter((t) => trackInView(t, view, filters));
  const vias = model.vias.filter((v) => viaInView(v, view, filters));
  const zones = model.zones.filter((a) => areaInView(a, view, filters));
  const keepouts = model.keepouts.filter((a) => areaInView(a, view, filters));
  const ratsAll = conn.rats.filter((r) => !o.nets || o.nets.includes(r.net));
  const rats = ratsAll.filter((r) => overlaps(view, { minX: Math.min(r.from.at.x, r.to.at.x), minY: Math.min(r.from.at.y, r.to.at.y), maxX: Math.max(r.from.at.x, r.to.at.x), maxY: Math.max(r.from.at.y, r.to.at.y) }));
  const crossings = ratCrossings(model, rats);
  const findingsIn = findings.filter((f) => inBox(view, { x: toMm(f.location.x), y: toMm(f.location.y) }) || f.id === o.focus);
  const netNames = model.nets
    .map((n) => n.name)
    .filter((name) => {
      if (o.nets) return o.nets.includes(name);
      if (detail === "overview" && !o.region) return true;
      return fps.some((f) => f.nets.includes(name)) || tracks.some((t) => t.net === name) || vias.some((v) => v.net === name);
    });
  const corridors = (o.corridors ?? []).map((q) => findCorridor(model, q));

  const scene: Record<string, unknown> = { schema: SCENE_SCHEMA, detail, legend: legendFor(detail) };
  scene.board = {
    name: model.name,
    box: boxArr(model.box),
    size: [r3(model.box.maxX - model.box.minX), r3(model.box.maxY - model.box.minY)],
    thickness: r3(model.thickness),
    copper: model.copper,
    rules: { trackWidth: r3(model.rules.trackWidth), clearance: r3(model.rules.clearance), edgeClearance: r3(model.rules.edgeClearance) },
    ...(model.epoch !== undefined ? { epoch: model.epoch, seq: model.seq } : {}),
  };
  const filt: Record<string, unknown> = {};
  if (o.region) filt.region = boxArr(o.region);
  if (o.nets) filt.nets = o.nets;
  if (o.layers) filt.layers = layers;
  if (o.kinds) filt.kinds = o.kinds;
  if (o.focus) filt.focus = o.focus;
  scene.view = { box: boxArr(view), layers, ...(Object.keys(filt).length ? { filters: filt } : {}) };
  scene.counts = {
    footprints: model.footprints.length,
    pads: model.pads.length,
    tracks: model.tracks.length,
    vias: model.vias.length,
    nets: model.nets.length,
    zones: model.zones.length,
    keepouts: model.keepouts.length,
    incomplete: [...conn.nets.values()].filter((s) => s.status === "partial" || s.status === "unrouted").length,
    missingLinks: [...conn.nets.values()].reduce((s, n) => s + n.missing, 0),
    ...(findings.length ? { findings: findings.length } : {}),
    inView: { footprints: fps.length, tracks: tracks.length, vias: vias.length, rats: rats.length },
  };
  scene.markers = [];
  scene.connectivity = connectivityNote(conn);

  // the focus object
  if (detail === "object") scene.focus = focusEntry(model, o.focus!, focusFinding, conn, crossings, findings);

  if (want("finding") && findingsIn.length) scene.findings = findingsIn.map(findingEntry);
  if (want("footprint")) scene.footprints = fps.map((f) => (detail === "region" ? fpRegion(model, f, model.tracks) : fpOverview(model, f)));
  if (want("net")) scene.nets = netNames.map((n) => netEntry(model, n, conn, detail));
  if (want("rat") && rats.length) scene.rats = detail === "overview" ? rats.map((r) => ratRow(r, crossings)) : rats.map((r) => ratEntry(r, crossings));
  if (want("track")) {
    if (detail === "overview" && !o.region && !o.nets) {
      const cu: Record<string, unknown> = {};
      for (const l of layers) {
        const ts = model.tracks.filter((t) => t.layer === l);
        cu[l] = { segments: ts.length, len: r2(ts.reduce((s, t) => s + t.len, 0)), nets: new Set(ts.map((t) => t.net ?? "")).size };
      }
      scene.copper = cu;
    } else scene.tracks = o.tracks === "segments" ? tracks.map(segEntry) : polylines(tracks).map(polyEntry);
  }
  if (want("via")) {
    if (detail === "overview" && !o.region && !o.nets) {
      const spans = new Map<string, number>();
      for (const v of model.vias) spans.set(`${v.from}-${v.to}`, (spans.get(`${v.from}-${v.to}`) ?? 0) + 1);
      if (spans.size) scene.vias = Object.fromEntries([...spans.entries()].sort((a, b) => byStr(a[0], b[0])));
    } else if (vias.length) scene.vias = vias.map(viaEntry);
  }
  if (want("zone") && zones.length) scene.zones = zones.map(areaEntry);
  if (want("keepout") && keepouts.length) scene.keepouts = keepouts.map(areaEntry);
  if (detail === "overview") {
    const under: unknown[] = [];
    for (const f of fps) for (const c of copperNear(model, f, 0)) if (c.rel !== "beside") under.push([f.ref, c.rel, c.net, c.layer]);
    if (under.length) scene.under = under;
    scene.locks = lockSummary(model);
  }
  if (want("corridor") && corridors.length) scene.corridors = corridors.map(corridorEntry);
  if (want("congestion") && detail !== "object") scene.congestion = congestionEntry(model, detail === "overview" && !o.region ? model.box : view, layers, o.cell ?? (detail === "overview" ? niceCell(model.box, 8) : niceCell(view, 6)));

  // markers before trimming (so the size counts them), then trim, then number what is left
  const budget = o.budget ?? BUDGETS[detail];
  const kinds = new Set(o.markerKinds ?? (["finding", "rat", "corridor", "keepout", "zone"] as SceneKind[]));
  if (rats.length > (o.ratMarkers ?? 20)) kinds.delete("rat");
  numberMarkers(scene, kinds);
  const truncated = trim(scene, budget, detail);
  const markers = numberMarkers(scene, kinds, model, rats, corridors, findings, view);
  scene.budget = { chars: budget, ...(truncated.length ? { truncated } : {}) };
  // the markers index goes last but before the budget note
  const json = JSON.stringify(scene);
  const highlight = { nets: [] as string[], ids: [] as string[] };
  if (o.nets) highlight.nets.push(...o.nets);
  if (focusKind === "net") highlight.nets.push(o.focus!.slice(4));
  else if (focusKind) highlight.ids.push(o.focus!);
  if (focusFinding) highlight.ids.push(...focusFinding.objects);
  const ratIds = new Set(((scene.rats as ({ id: string } | string[])[] | undefined) ?? []).map((r) => (Array.isArray(r) ? r[0] : r.id)));
  const findingIds = new Set(((scene.findings as { id: string }[] | undefined) ?? []).map((f) => f.id));
  const corridorsShown = scene.corridors ? corridors.slice(0, (scene.corridors as unknown[]).length) : [];
  return { scene, json, markers, view, layers, conn, rats: rats.filter((r) => ratIds.has(r.id)), corridors: corridorsShown, findings: findingsIn.filter((f) => findingIds.has(f.id)), highlight };
}

function lockSummary(model: BoardModel): Record<string, unknown> {
  const count = (xs: { locked: boolean; prov: { by: string; edited?: string } }[]) => {
    const by: Record<string, number> = {};
    for (const x of xs) by[prov(x.prov)] = (by[prov(x.prov)] ?? 0) + 1;
    return { locked: xs.filter((x) => x.locked).length, by: Object.fromEntries(Object.entries(by).sort((a, b) => byStr(a[0], b[0]))) };
  };
  return { footprints: count(model.footprints), tracks: count(model.tracks), vias: count(model.vias), zones: count(model.zones), keepouts: count(model.keepouts) };
}

/** Give marker numbers in a fixed order: findings, footprints, rats, corridors, keep-outs, zones. */
function numberMarkers(scene: Record<string, unknown>, kinds: Set<SceneKind>, model?: BoardModel, rats?: RatLink[], corridors?: Corridor[], findings?: Finding[], view?: BoxMm): MarkerItem[] {
  const out: MarkerItem[] = [];
  let n = 0;
  const idOf = (e: Record<string, unknown> | unknown[]) => String(Array.isArray(e) ? e[0] : e.id);
  // anchors stay inside the view, so a marker sits on what it names
  const inset = view ? Math.min(view.maxX - view.minX, view.maxY - view.minY) * 0.03 : 0;
  const clamp = (p: Pt): Pt => (view ? { x: Math.min(view.maxX - inset, Math.max(view.minX + inset, p.x)), y: Math.min(view.maxY - inset, Math.max(view.minY + inset, p.y)) } : p);
  const give = (e: Record<string, unknown> | unknown[], kind: SceneKind, label: string, at: () => Pt, severity?: MarkerItem["severity"]) => {
    n++;
    if (!Array.isArray(e)) e.m = n;
    if (model) out.push({ n, id: idOf(e), kind, label, at: clamp(at()), ...(severity ? { severity } : {}) });
  };
  const list = (k: string) => (scene[k] as (Record<string, unknown> | unknown[])[] | undefined) ?? [];
  if (kinds.has("finding"))
    for (const e of list("findings")) {
      const f = findings?.find((x) => x.id === idOf(e));
      give(e, "finding", String((e as Record<string, unknown>).check), () => ({ x: toMm(f!.location.x), y: toMm(f!.location.y) }), f?.severity);
    }
  if (kinds.has("footprint"))
    for (const e of list("footprints"))
      give(e, "footprint", String((e as Record<string, unknown>).ref), () => {
        const f = model!.fpById.get(idOf(e))!;
        return { x: f.box.maxX, y: f.box.maxY };
      });
  if (kinds.has("rat"))
    for (const e of list("rats"))
      give(e, "rat", idOf(e), () => {
        const r = rats!.find((x) => x.id === idOf(e))!;
        const c = view ? clipSegment(r.from.at, r.to.at, view) : undefined;
        const [a, b] = c ?? [r.from.at, r.to.at];
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      });
  list("corridors").forEach((e, i) => {
    (e as Record<string, unknown>).id = `corridor:${i + 1}`;
    if (kinds.has("corridor"))
      give(e, "corridor", `corridor ${i + 1}`, () => {
        const c = corridors![i];
        return c.found && c.path ? polyMidpoint(c.path) : c.stuckAt!;
      });
  });
  if (kinds.has("keepout"))
    for (const e of list("keepouts"))
      give(e, "keepout", idOf(e), () => {
        const a = model!.areaById.get(idOf(e))!;
        const b = view ? intersectBox(a.box, view) : a.box;
        return { x: b.minX, y: b.maxY };
      });
  if (kinds.has("zone"))
    for (const e of list("zones"))
      give(e, "zone", idOf(e), () => {
        const a = model!.areaById.get(idOf(e))!;
        const b = view ? intersectBox(a.box, view) : a.box;
        return { x: b.minX + (b.maxX - b.minX) * 0.1, y: b.minY };
      });
  if (model) scene.markers = out.map((m) => [m.n, m.id]);
  else scene.markers = new Array(n).fill(0).map((_, i) => [i + 1, "x".repeat(24)]);
  return out;
}

type Entry = Record<string, unknown>;

/** A footprint entry as a row: [id, ref, value, side, x, y, rot, width, height]. */
function fpRow(e: Entry): unknown[] {
  const at = e.at as number[];
  const b = e.box as number[];
  return [e.id, e.ref, e.value ?? null, e.side, at[0], at[1], e.rot, r3(b[2] - b[0]), r3(b[3] - b[1])];
}
/** A net entry as a row: [name, class, pads, status, missing, vias, routed mm]. */
function netRow(e: Entry): unknown[] {
  const len = Object.values((e.len as Record<string, number> | undefined) ?? {}).reduce((a, b) => a + b, 0);
  return [e.name, e.class, e.pads, e.status, e.missing ?? 0, e.vias, r2(len)];
}

/** Shrink a scene to its budget: compact forms first, then whole sections, then list tails. Returns what was cut. */
function trim(scene: Record<string, unknown>, budget: number, detail: Detail): string[] {
  const notes: string[] = [];
  // the budget note is added after trimming: count it, with room for one more list note
  const size = () => JSON.stringify(scene).length + JSON.stringify(notes).length + 140;
  if (size() <= budget) return notes;
  const legend = scene.legend as Record<string, string>;
  const list = (k: string) => scene[k] as Entry[] | undefined;
  const cong = scene.congestion as { layers: Record<string, { copper: unknown; hFree?: unknown; vFree?: unknown }> } | undefined;
  const step = {
    channels: (): string | undefined => {
      if (!cong) return undefined;
      for (const l of Object.values(cong.layers)) {
        delete l.hFree;
        delete l.vFree;
      }
      return "congestion free channels left out (copper density kept)";
    },
    near: (): string | undefined => {
      const fs = list("footprints");
      if (!fs?.some((f) => !Array.isArray(f) && f.near)) return undefined;
      for (const f of fs) if (!Array.isArray(f)) delete f.near;
      delete legend.near;
      return "footprint neighbors left out (ask for a region or an object)";
    },
    fpCopper: (): string | undefined => {
      const fs = list("footprints");
      if (!fs?.some((f) => !Array.isArray(f) && f.copper)) return undefined;
      for (const f of fs) if (!Array.isArray(f)) delete f.copper;
      delete legend.copper;
      return "per-footprint copper relations left out (ask for an object)";
    },
    fpRows: (): string | undefined => {
      const fs = list("footprints");
      if (!fs?.length || Array.isArray(fs[0])) return undefined;
      scene.footprints = fs.map(fpRow);
      legend.footprints = "rows: [id, ref, value, side, x, y, rot, box width, box height]";
      return "footprints as rows";
    },
    netRows: (): string | undefined => {
      const ns = list("nets");
      if (!ns?.length || Array.isArray(ns[0])) return undefined;
      scene.nets = ns.map(netRow);
      legend.nets = "rows: [name, class, pads, status, missing links, vias, routed mm]";
      return "nets as rows";
    },
    under: (): string | undefined => (scene.under ? (delete scene.under, "under-part copper list left out (ask for a region)") : undefined),
    congestion: (): string | undefined => (scene.congestion ? (delete scene.congestion, delete legend.congestion, "congestion left out (ask for a smaller region)") : undefined),
    rats: (): string | undefined => (scene.rats ? (delete scene.rats, delete legend.rats, "rats left out: each net's missing links are counted in nets; ask for a region or a net to see them") : undefined),
    contextTracks: (): string | undefined => (scene.tracks ? (delete scene.tracks, delete legend.tracks, "context tracks left out (the focus lists its own copper; ask for a region for the rest)") : undefined),
    contextVias: (): string | undefined => (scene.vias ? (delete scene.vias, "context vias left out (ask for a region)") : undefined),
  };
  const order: Record<Detail, (keyof typeof step)[]> = {
    overview: ["near", "fpRows", "netRows", "channels", "under", "rats", "congestion"],
    region: ["channels", "fpCopper", "near", "netRows"],
    object: ["contextTracks", "netRows", "contextVias", "fpRows", "near"],
  };
  for (const k of order[detail]) {
    if (size() <= budget) return notes;
    const note = step[k]();
    if (note) notes.push(note);
  }
  // then cut list tails, longest list first, keeping order (incomplete nets kept before complete ones)
  const lists = ["tracks", "footprints", "nets", "rats", "vias", "findings", "zones", "keepouts"];
  const totals = new Map<string, number>();
  let guard = 0;
  while (size() > budget && guard++ < 60) {
    let longest: string | undefined;
    let len = 0;
    for (const k of lists) {
      const v = scene[k];
      if (Array.isArray(v) && v.length > 1 && JSON.stringify(v).length > len) {
        len = JSON.stringify(v).length;
        longest = k;
      }
    }
    if (!longest) break;
    const arr = scene[longest] as unknown[];
    if (!totals.has(longest)) totals.set(longest, arr.length);
    const keep = Math.max(1, Math.min(arr.length - 1, Math.floor(arr.length - (size() - budget) / (len / arr.length) - 1)));
    if (longest === "nets") {
      const bad = (e: unknown) => {
        const st = Array.isArray(e) ? e[3] : (e as Entry).status;
        return st === "partial" || st === "unrouted";
      };
      scene.nets = arr
        .map((e, i) => ({ e, i, b: bad(e) ? 0 : 1 }))
        .sort((a, b) => a.b - b.b || a.i - b.i)
        .slice(0, keep)
        .sort((a, b) => a.i - b.i)
        .map((x) => x.e);
    } else scene[longest] = arr.slice(0, keep);
  }
  for (const k of lists) if (totals.has(k)) notes.push(`${k}: ${(scene[k] as unknown[]).length} of ${totals.get(k)} shown (${detail === "overview" ? "ask for a region, net or layer" : "narrow the filter"})`);
  // the focus itself, last
  const focus = scene.focus as Entry | undefined;
  if (focus && size() > budget)
    for (const k of ["segments", "padList", "viaList", "pads", "islandIds", "rats", "outline", "tracksInBox"]) {
      const v = focus[k];
      if (!Array.isArray(v) || v.length < 2) continue;
      const over = size() - budget;
      if (over <= 0) break;
      const per = JSON.stringify(v).length / v.length;
      const keep = Math.max(1, Math.floor(v.length - over / per - 1));
      if (keep < v.length) {
        notes.push(`focus.${k}: ${keep} of ${v.length} shown (raise the budget or ask for a region)`);
        focus[k] = v.slice(0, keep);
      }
    }
  if (size() > budget) {
    scene.legend = Object.fromEntries(Object.entries(legend).filter(([k]) => ["units", "m", "footprints", "nets", "rats", "pads"].includes(k)));
    notes.push("legend shortened");
  }
  return notes;
}

// ---------------------------------------------------------------- object detail

function focusEntry(model: BoardModel, id: string, finding: Finding | undefined, conn: ConnectivityResult, crossings: RatCrossing[], findings: Finding[]): Record<string, unknown> {
  const related = (ids: string[]) => findings.filter((f) => f.objects.some((o) => ids.includes(o))).map((f) => f.id);
  if (finding) {
    const objs = finding.objects.map((oid) => briefOf(model, oid));
    return { kind: "finding", ...findingEntry(finding), described: objs };
  }
  const kind = objectKind(model, id)!;
  if (kind === "footprint") {
    const f = model.fpById.get(id)!;
    const e = fpRegion(model, f, model.tracks);
    const near = nearestByDirection(model, f);
    const n: Record<string, unknown> = {};
    for (const d of DIRECTIONS) if (near[d]) n[d] = { id: near[d]!.id, ref: near[d]!.ref, gap: r3(near[d]!.gap), dx: r3(near[d]!.dx), dy: r3(near[d]!.dy), ...(near[d]!.side !== f.side ? { side: near[d]!.side } : {}) };
    e.near = n;
    // a part on the other side overlaps in plan view without touching: its side says so
    e.nearest = neighborsOf(model, f).slice(0, 6).map((x) => [x.ref, x.dir, r3(x.gap), ...(x.side !== f.side ? [x.side] : [])]);
    e.pads = f.pads.map((p) => padDetail(model, p));
    e.nets = f.nets.map((name) => ({ name, status: conn.nets.get(name)?.status ?? "empty", ...(conn.nets.get(name)?.missing ? { missing: conn.nets.get(name)!.missing } : {}) }));
    const padIds = new Set(f.pads.map((p) => p.id));
    const rats = conn.rats.filter((r) => padIds.has(r.from.id) || padIds.has(r.to.id));
    if (rats.length) e.rats = rats.map((r) => ratEntry(r, crossings));
    const ks = model.keepouts.filter((k) => overlaps(k.box, f.box)).map((k) => k.id);
    if (ks.length) e.keepouts = ks;
    if (f.path) e.path = f.path;
    const fs = related([id, ...padIds]);
    if (fs.length) e.findings = fs;
    return { kind, ...e };
  }
  if (kind === "pad") {
    const p = model.padById.get(id)!;
    return { kind, footprint: p.footprint, ref: p.ref, ...padDetail(model, p), nearOtherNets: foreignNear(model, [{ x: p.x, y: p.y }], Math.min(p.w, p.h) / 2, p.layers, p.net) };
  }
  if (kind === "track") {
    const t = model.trackById.get(id)!;
    const chain = polylines(model.tracks.filter((x) => x.net === t.net && x.layer === t.layer && r3(x.w) === r3(t.w))).find((pl) => pl.ids.includes(id));
    const pads = model.pads.filter((p) => p.net && p.net === t.net && padCopper(model, p).includes(id)).map((p) => p.id);
    return { kind, ...segEntry(t), touches: pads, ...(chain ? { chain: polyEntry(chain) } : {}), nearOtherNets: foreignNear(model, t.pts, t.w / 2, [t.layer], t.net), findings: related([id]) };
  }
  if (kind === "via") {
    const v = model.viaById.get(id)!;
    return { kind, ...viaEntry(v), layers: v.layers, nearOtherNets: foreignNear(model, [{ x: v.x, y: v.y }], v.d / 2, v.layers, v.net), findings: related([id]) };
  }
  if (kind === "zone" || kind === "keepout") {
    const a = model.areaById.get(id)!;
    const inside = model.footprints.filter((f) => overlaps(f.box, a.box)).map((f) => f.ref);
    const trs = model.tracks.filter((t) => a.layers.includes(t.layer) && overlaps(t.box, a.box)).map((t) => t.id);
    return { kind, ...areaEntry(a), outline: a.outline.slice(0, 64).map(ptArr), footprintsInBox: inside, tracksInBox: trs.length > 40 ? trs.length : trs };
  }
  // net
  const name = id.slice(4);
  const e = netEntry(model, name, conn, "object");
  const st = conn.nets.get(name);
  e.padList = model.netByName.get(name)!.pads.map((pid) => {
    const p = model.padById.get(pid)!;
    return [pid, p.ref, p.number, r3(p.x), r3(p.y), p.layers.join("+")];
  });
  e.segments = model.tracks.filter((t) => t.net === name).map(segEntry);
  e.viaList = model.vias.filter((v) => v.net === name).map(viaEntry);
  if (st) {
    e.islandIds = st.islands;
    if (st.floating.length) e.floatingIds = st.floating;
  }
  const rats = conn.rats.filter((r) => r.net === name);
  if (rats.length) e.rats = rats.map((r) => ratEntry(r, crossings));
  const b = netBox(model, name);
  if (b) e.box = boxArr(b);
  return { kind, id, ...e };
}

function padDetail(model: BoardModel, p: MPad): Record<string, unknown> {
  return {
    number: p.number,
    id: p.id,
    at: [r3(p.x), r3(p.y)],
    net: p.net ?? null,
    ...(p.pin ? { pin: p.pin } : {}),
    type: p.type,
    shape: p.shapeName,
    size: [r3(p.w), r3(p.h)],
    ...(p.rot ? { rot: r3(p.rot) } : {}),
    layers: p.layers,
    ...(p.hole !== undefined ? { hole: Array.isArray(p.hole) ? p.hole.map(r3) : r3(p.hole) } : {}),
    copper: padCopper(model, p),
  };
}

function briefOf(model: BoardModel, id: string): Record<string, unknown> {
  const k = objectKind(model, id);
  if (k === "footprint") {
    const f = model.fpById.get(id)!;
    return { id, ref: f.ref, at: ptArr(f), box: boxArr(f.box) };
  }
  if (k === "pad") {
    const p = model.padById.get(id)!;
    return { id, ref: p.ref, number: p.number, net: p.net ?? null, at: [r3(p.x), r3(p.y)] };
  }
  if (k === "track") return segEntry(model.trackById.get(id)!);
  if (k === "via") return viaEntry(model.viaById.get(id)!);
  if (k === "zone" || k === "keepout") return areaEntry(model.areaById.get(id)!);
  return { id, unknown: true };
}
