/**
 * Filling every zone of a board, and refilling only what a commit touched.
 *
 * `fillZones` returns the shared derived fill (`protoboard.zone-fill/v1`, source `computed`, stamped with the
 * core's zone input hash) and an inputs record (`protoboard.zone-fill-inputs/v1`): for every zone and layer, the
 * hash of every record it read, the higher-priority fills it kept clear of, and the area it searched. The inputs
 * record is what makes a computed fill checkable for staleness after any commit (stale.ts), not only after a zone
 * edit. Zones fill in priority order (higher first; equal priorities by id).
 *
 * `refillZones` takes the previous result and the ids a commit changed, created or removed, and recomputes only the
 * zone layers whose searched area those objects touch (before or after the change), then any lower-priority zone
 * layer whose higher-priority neighbor's fill actually changed.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  byCodeUnit,
  canonical,
  canonicalRecord,
  copperLayers,
  createZoneFill,
  recordsOfKind,
  sha1Hex,
  sha256Hex,
  writeZoneFill,
  zoneFillPath,
  type BoardDocument,
  type BoardSnapshot,
  type CopperLayer,
  type DerivedZoneFill,
  type ZoneFillEntry,
  type ZoneRec,
} from "@protoboardai/board";
import { clip, polygonRings, type Polygon } from "./clip.js";
import { cleanWindow, patchPolygons } from "./patch.js";
import { collectBoardShapes, type BoardShapes } from "./collect.js";
import { fillZoneLayer, removeIslands, zoneConnectors, zoneNearBox, zoneRange, type FillContext, type HigherFill, type ZoneLayerFill, type ZoneLayerStats } from "./fill.js";
import { FillRules, type FillRuleOptions } from "./rules.js";
import { boxesMeet, inflateBox, type Box } from "./shapes.js";

export const FILL_INPUTS_SCHEMA = "protoboard.zone-fill-inputs/v1";
export const FILL_INPUTS_FILE = "zone-fill-inputs.json";
/** Default maximum distance between a curve and its straight-segment approximation: 5 micrometers. */
export const DEFAULT_MAX_ERROR = 5000;
/** Default growth of every clearance beyond the rule: 10 nm, larger than grid rounding (0.71 nm) and snapping. */
export const DEFAULT_MARGIN = 10;

export interface FillZonesOptions {
  /** Zone ids to fill (default: every zone). Higher-priority zones they depend on are filled too but not returned. */
  zones?: readonly string[];
  /** Copper layers to fill (default: each zone's layers). */
  layers?: readonly CopperLayer[];
  /** How clearances come from the rules. */
  rules?: FillRuleOptions;
  /** Curve approximation error, nm (default 5000). */
  maxError?: number;
  /** Safety margin added to every clearance, nm (default 10). */
  margin?: number;
}

export interface FillInputsEntry {
  zone: string;
  layer: CopperLayer;
  /** SHA-256 over everything below and the board-wide inputs. */
  hash: string;
  /** Record id -> SHA-1 of its canonical JSON, for every record the fill read. */
  reads: Record<string, string>;
  /** Higher-priority zone id -> SHA-1 of its fill on this layer, for every fill it kept clear of. */
  deps: Record<string, string>;
  /** The area searched (the zone's box grown by the largest clearance): new copper here makes the fill stale. */
  near: Box;
  /** SHA-1 of this entry's polygons. */
  fill: string;
}

export interface FillInputs {
  schema: typeof FILL_INPUTS_SCHEMA;
  /** The core's zone input hash of the document (the fill's `inputHash`). */
  inputHash: string;
  /** SHA-256 over the board-wide inputs: board and layer records, rules, net classes, the netlist and the settings. */
  global: string;
  settings: { maxError: number; margin: number; rules: FillRuleOptions };
  entries: FillInputsEntry[];
}

export interface FillZonesResult {
  fill: DerivedZoneFill;
  inputs: FillInputs;
  /** The zone layers computed in this call (all of them for `fillZones`). */
  recomputed: { zone: string; layer: CopperLayer }[];
  stats: Record<string, ZoneLayerStats>;
  ms: number;
  /** In memory only (not written): what a later `refillZones` patches from. */
  cache?: FillCache;
}

const docOf = (s: BoardSnapshot | BoardDocument): BoardDocument => ("doc" in s && (s as BoardSnapshot).doc ? (s as BoardSnapshot).doc : (s as BoardDocument));

/** Zones in fill order: higher priority first, then by id. */
export const fillOrder = (zones: readonly ZoneRec[]): ZoneRec[] => [...zones].sort((a, b) => b.priority - a.priority || byCodeUnit(a.id, b.id));

/** Records are immutable and shared between document versions, so their hashes are kept per record object. */
const recordHashes = new WeakMap<object, string>();
export const recordHash = (doc: BoardDocument, id: string): string | undefined => {
  const r = doc.records.get(id);
  if (!r) return undefined;
  let h = recordHashes.get(r);
  if (h === undefined) {
    h = sha1Hex(canonicalRecord(r));
    recordHashes.set(r, h);
  }
  return h;
};

/** SHA-1 of polygons: ring counts, ring lengths and coordinates as 64-bit floats, in order. */
export function polygonsHash(polys: readonly Polygon[]): string {
  const h = createHash("sha1");
  const head = new Float64Array(1);
  const put = (v: number) => {
    head[0] = v;
    h.update(new Uint8Array(head.buffer));
  };
  for (const p of polys) {
    put(1 + p.holes.length);
    for (const r of [p.outer, ...p.holes]) {
      put(r.length);
      h.update(new Uint8Array(Float64Array.from(r).buffer));
    }
  }
  return h.digest("hex");
}

/** The board-wide inputs every fill depends on. */
export function globalInputsHash(doc: BoardDocument, settings: FillInputs["settings"]): string {
  const ids: string[] = [];
  for (const r of doc.records.values()) if (r.kind === "board" || r.kind === "layer" || r.kind === "rule" || r.kind === "netclass") ids.push(r.id);
  ids.sort(byCodeUnit);
  return sha256Hex(canonical({ records: ids.map((id) => [id, recordHash(doc, id)]), netlist: doc.netlist ?? null, settings }));
}

const settingsOf = (o: FillZonesOptions): FillInputs["settings"] => ({ maxError: o.maxError ?? DEFAULT_MAX_ERROR, margin: o.margin ?? DEFAULT_MARGIN, rules: o.rules ?? {} });

interface Job {
  zone: ZoneRec;
  layer: CopperLayer;
  key: string;
  box: Box;
}

function jobsOf(doc: BoardDocument, ctx: FillContext, options: FillZonesOptions): { jobs: Job[]; wanted: Set<string> } {
  const stack = copperLayers(doc);
  const zones = fillOrder(recordsOfKind(doc, "zone"));
  const jobs: Job[] = [];
  for (const z of zones) for (const l of z.layers) if (stack.includes(l)) jobs.push({ zone: z, layer: l, key: `${z.id}\u0000${l}`, box: zoneNearBox(ctx, z) });
  const wantZones = options.zones ? new Set(options.zones) : undefined;
  const wantLayers = options.layers ? new Set(options.layers) : undefined;
  const wanted = new Set<string>();
  for (const j of jobs) if ((!wantZones || wantZones.has(j.zone.id)) && (!wantLayers || wantLayers.has(j.layer))) wanted.add(j.key);
  // higher-priority zone layers the wanted ones depend on
  const need = new Set(wanted);
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (!need.has(j.key)) continue;
    for (let h = 0; h < i; h++) if (jobs[h].layer === j.layer && boxesMeet(jobs[h].box, j.box)) need.add(jobs[h].key);
  }
  return { jobs: jobs.filter((j) => need.has(j.key)), wanted };
}

function entryOf(doc: BoardDocument, global: string, r: ReturnType<typeof fillZoneLayer>, depFills: Map<string, string>): FillInputsEntry {
  const reads: Record<string, string> = {};
  for (const id of r.reads) {
    const h = recordHash(doc, id);
    if (h) reads[id] = h;
  }
  for (const rec of doc.records.values()) if (rec.kind === "board" || rec.kind === "layer" || rec.kind === "rule" || rec.kind === "netclass") reads[rec.id] = recordHash(doc, rec.id)!;
  const sorted: Record<string, string> = {};
  for (const id of Object.keys(reads).sort(byCodeUnit)) sorted[id] = reads[id];
  const deps: Record<string, string> = {};
  for (const d of r.deps) deps[d] = depFills.get(`${d}\u0000${r.layer}`) ?? "";
  const fill = polygonsHash(r.polygons);
  return { zone: r.zone, layer: r.layer, hash: sha256Hex(canonical({ global, reads: sorted, deps })), reads: sorted, deps, near: r.near, fill };
}

function assemble(doc: BoardDocument, jobs: Job[], wanted: Set<string>, polys: Map<string, Polygon[]>, entries: Map<string, FillInputsEntry>, settings: FillInputs["settings"], global: string): { fill: DerivedZoneFill; inputs: FillInputs } {
  const stack = copperLayers(doc);
  const out: ZoneFillEntry[] = [];
  const ins: FillInputsEntry[] = [];
  const keep = jobs.filter((j) => wanted.has(j.key)).sort((a, b) => byCodeUnit(a.zone.id, b.zone.id) || stack.indexOf(a.layer) - stack.indexOf(b.layer));
  for (const j of keep) {
    const p = polys.get(j.key) ?? [];
    out.push({ zone: j.zone.id, source: j.zone.id, ...(j.zone.net !== undefined ? { net: j.zone.net } : {}), layer: j.layer, polygons: p.map((q) => ({ outer: q.outer, holes: q.holes })) });
    const e = entries.get(j.key);
    if (e) ins.push(e);
  }
  const { fill } = createZoneFill(doc, "computed", out);
  return { fill, inputs: { schema: FILL_INPUTS_SCHEMA, inputHash: fill.inputHash, global, settings, entries: ins } };
}

/**
 * What a result keeps in memory for a later partial refill (never written to disk): the board's shapes it was
 * computed from and each zone layer's fill before island removal and hatching.
 */
export interface FillCache {
  shapes: BoardShapes;
  pre: Map<string, Polygon[]>;
}

/** Compute the fill of every zone (or of the given zones and layers) of a board. */
export function fillZones(source: BoardSnapshot | BoardDocument, options: FillZonesOptions = {}): FillZonesResult {
  const t0 = performance.now();
  const doc = docOf(source);
  const settings = settingsOf(options);
  const ctx: FillContext = { doc, shapes: collectBoardShapes(doc), rules: new FillRules(doc, settings.rules), maxError: settings.maxError, margin: settings.margin };
  const global = globalInputsHash(doc, settings);
  const { jobs, wanted } = jobsOf(doc, ctx, options);
  const polys = new Map<string, Polygon[]>();
  const pre = new Map<string, Polygon[]>();
  const fillHash = new Map<string, string>();
  const entries = new Map<string, FillInputsEntry>();
  const stats: Record<string, ZoneLayerStats> = {};
  const recomputed: { zone: string; layer: CopperLayer }[] = [];
  jobs.forEach((j, i) => {
    const higher: HigherFill[] = [];
    for (let h = 0; h < i; h++) if (jobs[h].layer === j.layer && boxesMeet(jobs[h].box, j.box)) higher.push({ zone: jobs[h].zone, polygons: polys.get(jobs[h].key) ?? [] });
    const r = fillZoneLayer(ctx, j.zone, j.layer, higher);
    polys.set(j.key, r.polygons);
    pre.set(j.key, r.pre);
    fillHash.set(j.key, polygonsHash(r.polygons));
    entries.set(j.key, entryOf(doc, global, r, fillHash));
    stats[`${j.zone.id}@${j.layer}`] = r.stats;
    recomputed.push({ zone: j.zone.id, layer: j.layer });
  });
  const { fill, inputs } = assemble(doc, jobs, wanted, polys, entries, settings, global);
  return { fill, inputs, recomputed, stats, ms: performance.now() - t0, cache: { shapes: ctx.shapes, pre } };
}

/** A partial refill is used only when its window covers less than this share of the zone's searched area. */
const PATCH_SHARE = 0.4;

const unionBox = (a: Box | undefined, b: Box): Box => (a ? { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) } : { ...b });
const boxArea = (b: Box) => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
const intersectBox = (a: Box, b: Box): Box => ({ minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) });

/**
 * Refill after a commit: `changed` lists every id the commit changed, created or removed (a commit event's
 * `changed`, `created` values and `removed`). Recomputes only zone layers whose searched area those objects touch
 * before (they were read) or after (their new box meets it), then lower-priority neighbors whose dependency's fill
 * changed. Board-wide changes (rules, net classes, layers, the netlist, settings) refill everything.
 *
 * With the in-memory cache of the previous result (`cache`, from `fillZones` or `refillZones` in this process),
 * a touched zone layer is refilled only inside a window around the change (the change's boxes before and after,
 * grown by everything that can reach from them: clearances, the minimum-width opening, thermal spokes) and the
 * window is patched into the previous fill; island removal then runs again on the whole layer. Without the cache,
 * or when the window would cover much of the zone, or for a hatched zone, the zone layer is filled whole.
 */
export function refillZones(source: BoardSnapshot | BoardDocument, previous: Pick<FillZonesResult, "fill" | "inputs" | "cache">, changed: readonly string[], options: FillZonesOptions = {}): FillZonesResult {
  const t0 = performance.now();
  const doc = docOf(source);
  const settings = settingsOf(options);
  const global = globalInputsHash(doc, settings);
  if (global !== previous.inputs.global || canonical(settings) !== canonical(previous.inputs.settings)) return fillZones(doc, options);
  const ctx: FillContext = { doc, shapes: collectBoardShapes(doc), rules: new FillRules(doc, settings.rules), maxError: settings.maxError, margin: settings.margin };
  const { jobs, wanted } = jobsOf(doc, ctx, options);
  const prevEntry = new Map(previous.inputs.entries.map((e) => [`${e.zone}\u0000${e.layer}`, e]));
  const prevPolys = new Map(previous.fill.fills.filter((f) => f.zone).map((f) => [`${f.zone}\u0000${f.layer}`, f.polygons as Polygon[]]));
  const changedSet = new Set(changed);
  const cache = previous.cache;

  // boxes of the changed objects, before (from the cached shapes) and after, with the layers they are on
  const changeBoxes: { box: Box; layers: readonly CopperLayer[] | "all" }[] = [];
  let boardWide = false;
  const collectBoxes = (shapes: BoardShapes) => {
    for (const it of shapes.items) if (changedSet.has(it.record) || changedSet.has(it.id)) changeBoxes.push({ box: it.box, layers: it.layers });
    for (const h of shapes.holes) if (changedSet.has(h.record)) changeBoxes.push({ box: h.box, layers: "all" });
    for (const a of shapes.cutouts) if (changedSet.has(a.id)) changeBoxes.push({ box: a.box, layers: "all" });
    for (const k of shapes.keepouts) if (changedSet.has(k.id)) changeBoxes.push({ box: k.box, layers: k.layers });
  };
  collectBoxes(ctx.shapes);
  if (cache) collectBoxes(cache.shapes);
  if (changedSet.has("outline")) boardWide = true;
  // an object that was or is somewhere we cannot box (a removed keep-out without the cache) refills its readers whole
  const unboxed = !cache;

  const polys = new Map<string, Polygon[]>();
  const pre = new Map<string, Polygon[]>();
  const fillHash = new Map<string, string>();
  const entries = new Map<string, FillInputsEntry>();
  const stats: Record<string, ZoneLayerStats> = {};
  const recomputed: { zone: string; layer: CopperLayer }[] = [];
  /** Per job: the box its fill may have changed in (undefined: unchanged), or "all" (refilled whole). */
  const changedIn = new Map<string, Box | "all">();
  const zoneChanged = (id: string) => changedSet.has(id);

  jobs.forEach((j, i) => {
    const higherJobs = jobs.slice(0, i).filter((h) => h.layer === j.layer && boxesMeet(h.box, j.box));
    const pe = prevEntry.get(j.key);
    const prevFinal = prevPolys.get(j.key) ?? (pe && pe.fill === polygonsHash([]) ? [] : undefined);
    const prevPre = cache?.pre.get(j.key);
    let whole = !pe || prevFinal === undefined || boardWide || zoneChanged(j.zone.id);
    // a changed, added or removed zone of higher priority on this layer
    for (const h of higherJobs) {
      const ci = changedIn.get(h.key);
      if (ci === "all" && (j.zone.net === undefined || h.zone.net !== j.zone.net)) whole = true;
    }
    for (const id of changedSet) {
      const old = prevEntry.get(`${id}\u0000${j.layer}`);
      if (old && id !== j.zone.id && boxesMeet(old.near, j.box) && !jobs.some((k) => k.zone.id === id && k.layer === j.layer)) whole = true;
    }
    // where this job's inputs changed
    let box: Box | undefined;
    if (!whole && pe) {
      const readsChanged = Object.keys(pe.reads).some((id) => changedSet.has(id));
      for (const b of changeBoxes) if ((b.layers === "all" || b.layers.includes(j.layer)) && boxesMeet(b.box, j.box)) box = unionBox(box, b.box);
      if (readsChanged && !box && unboxed) whole = true;
      if (readsChanged && !box && !unboxed) {
        // a record it read changed without a box on this layer (a footprint whose pads are elsewhere): nothing here moved
      }
      for (const h of higherJobs) {
        const ci = changedIn.get(h.key);
        if (ci && ci !== "all" && (j.zone.net === undefined || h.zone.net !== j.zone.net)) box = unionBox(box, ci);
      }
      if (box && (unboxed || !prevPre || j.zone.fill_mode === "hatch")) whole = true;
    }
    const higher: HigherFill[] = higherJobs.map((h) => ({ zone: h.zone, polygons: polys.get(h.key) ?? [] }));
    if (!whole && !box && pe) {
      polys.set(j.key, prevFinal ?? []);
      if (prevPre) pre.set(j.key, prevPre);
      fillHash.set(j.key, pe.fill);
      entries.set(j.key, pe);
      return;
    }
    if (!whole && box && prevPre && pe) {
      const patched = patchJob(ctx, j, higher, box, prevPre, pe);
      if (patched) {
        polys.set(j.key, patched.r.polygons);
        pre.set(j.key, patched.r.pre);
        fillHash.set(j.key, polygonsHash(patched.r.polygons));
        entries.set(j.key, entryOf(doc, global, patched.r, fillHash));
        stats[`${j.zone.id}@${j.layer}`] = patched.r.stats;
        recomputed.push({ zone: j.zone.id, layer: j.layer });
        changedIn.set(j.key, patched.window);
        return;
      }
    }
    const r = fillZoneLayer(ctx, j.zone, j.layer, higher);
    polys.set(j.key, r.polygons);
    pre.set(j.key, r.pre);
    fillHash.set(j.key, polygonsHash(r.polygons));
    entries.set(j.key, entryOf(doc, global, r, fillHash));
    stats[`${j.zone.id}@${j.layer}`] = r.stats;
    recomputed.push({ zone: j.zone.id, layer: j.layer });
    changedIn.set(j.key, "all");
  });
  const { fill, inputs } = assemble(doc, jobs, wanted, polys, entries, settings, global);
  return { fill, inputs, recomputed, stats, ms: performance.now() - t0, cache: { shapes: ctx.shapes, pre } };
}

/** Refill one zone layer inside a window around `change` and patch it into the previous fill; undefined when a whole refill is better. */
function patchJob(ctx: FillContext, j: Job, higher: HigherFill[], change: Box, prevPre: Polygon[], pe: FillInputsEntry): { r: ZoneLayerFill; window: Box } | undefined {
  const t0 = performance.now();
  const z = j.zone;
  const minW = z.min_width ?? 0;
  const err = ctx.maxError;
  const spokeW = Math.max(z.thermal_spoke_width ?? ctx.rules.defaults.thermal_spoke_width, minW);
  const gap = z.thermal_gap ?? ctx.rules.defaults.thermal_gap;
  // everything a change can reach: the clearance it is kept at, the opening (twice the half width), the margin
  const reach = zoneRange(ctx, z) + minW + err;
  let w = inflateBox(change, reach);
  // thermal spokes of pads near the window are decided whole: grow the window over their reach
  const spokeReach = gap + spokeW * 1.5 + ctx.margin + 2 * err + 1000;
  const thermal = z.net !== undefined && z.pad_connection === "thermal" ? ctx.shapes.items.filter((it) => it.kind === "pad" && it.net === z.net && it.layers.includes(j.layer)) : [];
  for (let pass = 0; pass < 4; pass++) {
    let grew = false;
    for (const t of thermal) {
      const tb = inflateBox(t.box, spokeReach);
      if (!boxesMeet(tb, w)) continue;
      if (tb.minX < w.minX || tb.minY < w.minY || tb.maxX > w.maxX || tb.maxY > w.maxY) {
        w = unionBox(w, tb);
        grew = true;
      }
    }
    if (!grew) break;
  }
  w = intersectBox(w, inflateBox(j.box, 1000));
  if (w.minX >= w.maxX || w.minY >= w.maxY) return undefined;
  if (boxArea(w) > PATCH_SHARE * boxArea(j.box)) return undefined;
  const win = cleanWindow(prevPre, w);
  const winBox: Box = { minX: win.x0, minY: win.y0, maxX: win.x1, maxY: win.y1 };
  // the local fill runs in a larger box so that the opening and the spokes inside the window see all they need
  const outer = inflateBox(winBox, minW + 2 * err + 2000);
  const local = fillZoneLayer(ctx, z, j.layer, higher, { window: outer });
  const rect = [win.x0, win.y0, win.x1, win.y0, win.x1, win.y1, win.x0, win.y1];
  const inside = clip([{ rings: polygonRings(local.pre) }, { rings: [rect] }], (i) => i[0] && i[1]);
  const patchedPre = patchPolygons(prevPre, win, inside);
  const isl = removeIslands(z, patchedPre, zoneConnectors(ctx, z, j.layer, j.box));
  const reads = new Set([...Object.keys(pe.reads).filter((id) => ctx.doc.records.has(id)), ...local.reads]);
  const deps = higher.filter((h) => h.polygons.length && (z.net === undefined || h.zone.net !== z.net)).map((h) => h.zone.id).sort();
  return {
    window: winBox,
    r: {
      zone: z.id,
      layer: j.layer,
      polygons: isl.kept,
      pre: patchedPre,
      reads: [...reads].sort(),
      deps,
      near: j.box,
      stats: { ...local.stats, islandsRemoved: isl.removed, ms: performance.now() - t0 },
    },
  };
}
// ---------------------------------------------------------------- cache files

/** Where a board's fill inputs record is cached: beside `zone-fill.json`. */
export const fillInputsPath = (boardDir: string, projectRoot?: string): string => join(dirname(zoneFillPath(boardDir, projectRoot)), FILL_INPUTS_FILE);

export function parseFillInputs(value: unknown, where = "fill inputs"): FillInputs {
  const v = value as Partial<FillInputs> | undefined;
  if (!v || v.schema !== FILL_INPUTS_SCHEMA || typeof v.inputHash !== "string" || typeof v.global !== "string" || !Array.isArray(v.entries)) throw new Error(`${where} is not a valid ${FILL_INPUTS_SCHEMA}`);
  return v as FillInputs;
}

export const readFillInputs = (path: string): FillInputs => parseFillInputs(JSON.parse(readFileSync(path, "utf8")) as unknown, path);

/** Write a computed fill and its inputs record to the board's derived data folder; returns both paths. */
export function writeComputedFill(boardDir: string, result: Pick<FillZonesResult, "fill" | "inputs">, projectRoot?: string): { fill: string; inputs: string } {
  const fillPath = writeZoneFill(boardDir, result.fill, projectRoot);
  const path = fillInputsPath(boardDir, projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${canonical(result.inputs)}\n`);
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return { fill: fillPath, inputs: path };
}
