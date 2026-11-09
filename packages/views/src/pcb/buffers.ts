/**
 * The CPU side of the GPU buffers: per draw layer, one packed array of instanced boxes and one of triangle
 * vertices, built from the scene's objects. Each object's flattened geometry is cached per layer with its range in
 * the packed arrays, so a commit rewrites only the changed objects' ranges in place (and the renderer uploads only
 * those ranges); a layer is repacked only when an object's size on it changed or an object came or went. No WebGL
 * here: the renderer reads `layers` and each layer's dirty ranges.
 */
import { flattenPart, INSTANCE_FLOATS, VERTEX_FLOATS } from "./geom.js";
import type { DrawLayerId } from "./layers.js";
import type { Scene, SceneObject } from "./scene.js";

export type Triangulate = (flat: number[], holes: number[]) => number[];

interface Piece {
  boxes: Float32Array;
  tris: Float32Array;
}

export interface LayerBuffer {
  id: DrawLayerId;
  boxes: Float32Array;
  tris: Float32Array;
  /** Object order in the packed arrays. */
  order: string[];
  boxRange: Map<string, [number, number]>;
  triRange: Map<string, [number, number]>;
  /** Float ranges changed since the renderer last uploaded (`all`: the arrays were replaced). */
  dirtyBoxes: [number, number][] | "all";
  dirtyTris: [number, number][] | "all";
}

/** The layers labels and the ratsnest live on: never part of a selection outline. */
const NO_OUTLINE = new Set(["labels:pads", "labels:tracks", "ratsnest", "holes", "mask:top", "mask:bottom", "paste:top", "paste:bottom"]);

const EMPTY = new Float32Array(0);

function concat(parts: Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export class SceneBuffers {
  readonly layers = new Map<DrawLayerId, LayerBuffer>();
  /** Per object: its flattened geometry per layer. */
  private readonly pieces = new Map<string, Map<DrawLayerId, Piece>>();
  /** Floats written since construction (tests read it: an in-place update writes only the changed object). */
  floatsWritten = 0;
  layersRepacked = 0;

  constructor(
    private scene: Scene,
    private readonly triangulate: Triangulate,
  ) {
    this.rebuild();
  }

  private flatten(o: SceneObject): Map<DrawLayerId, Piece> {
    const acc = new Map<DrawLayerId, { boxes: number[]; tris: number[] }>();
    for (const it of o.items) {
      let a = acc.get(it.layer);
      if (!a) acc.set(it.layer, (a = { boxes: [], tris: [] }));
      const meta = { net: it.net ?? o.net, fp: o.fp, obj: o.index, flags: it.flags, minScale: it.minScale };
      for (const p of it.parts) flattenPart(p, meta, a.boxes, a.tris, this.triangulate);
    }
    const out = new Map<DrawLayerId, Piece>();
    for (const [l, a] of acc) out.set(l, { boxes: new Float32Array(a.boxes), tris: new Float32Array(a.tris) });
    return out;
  }

  /** Repack every layer from scratch (a new scene, or a stackup change). */
  rebuild(scene: Scene = this.scene): void {
    this.scene = scene;
    this.pieces.clear();
    this.layers.clear();
    const lists = new Map<DrawLayerId, string[]>();
    for (const o of scene.objects.values()) {
      const m = this.flatten(o);
      this.pieces.set(o.id, m);
      for (const l of m.keys()) (lists.get(l) ?? lists.set(l, []).get(l)!).push(o.id);
    }
    for (const def of scene.layers) this.repack(def.id, lists.get(def.id) ?? []);
    for (const [l, ids] of lists) if (!this.layers.has(l)) this.repack(l, ids);
  }

  private repack(layer: DrawLayerId, order: string[]): void {
    const boxRange = new Map<string, [number, number]>();
    const triRange = new Map<string, [number, number]>();
    const bp: Float32Array[] = [];
    const tp: Float32Array[] = [];
    let bo = 0;
    let to = 0;
    for (const id of order) {
      const p = this.pieces.get(id)?.get(layer);
      if (!p) continue;
      boxRange.set(id, [bo, p.boxes.length]);
      triRange.set(id, [to, p.tris.length]);
      bp.push(p.boxes);
      tp.push(p.tris);
      bo += p.boxes.length;
      to += p.tris.length;
    }
    const boxes = concat(bp);
    const tris = concat(tp);
    this.floatsWritten += boxes.length + tris.length;
    this.layersRepacked++;
    this.layers.set(layer, { id: layer, boxes, tris, order: order.filter((id) => boxRange.has(id)), boxRange, triRange, dirtyBoxes: "all", dirtyTris: "all" });
  }

  /** Apply changed scene objects (ids from updateScene); returns the layers whose buffers changed. */
  update(changed: Set<string> | "all", scene: Scene = this.scene): Set<DrawLayerId> {
    if (changed === "all") {
      this.rebuild(scene);
      return new Set(this.layers.keys());
    }
    this.scene = scene;
    const touched = new Set<DrawLayerId>();
    const repack = new Set<DrawLayerId>();
    const fresh = new Map<string, Map<DrawLayerId, Piece>>();
    for (const id of changed) {
      const o = scene.objects.get(id);
      const before = this.pieces.get(id) ?? new Map<DrawLayerId, Piece>();
      const after = o ? this.flatten(o) : new Map<DrawLayerId, Piece>();
      fresh.set(id, after);
      for (const l of new Set([...before.keys(), ...after.keys()])) {
        touched.add(l);
        const b = before.get(l);
        const a = after.get(l);
        const buf = this.layers.get(l);
        if (!b || !a || !buf || b.boxes.length !== a.boxes.length || b.tris.length !== a.tris.length || !buf.boxRange.has(id)) repack.add(l);
      }
    }
    for (const [id, m] of fresh) {
      if (m.size || scene.objects.has(id)) this.pieces.set(id, m);
      else this.pieces.delete(id);
    }
    for (const l of touched) {
      const buf = this.layers.get(l);
      if (repack.has(l) || !buf) {
        const order = buf ? buf.order.filter((id) => this.pieces.get(id)?.has(l)) : [];
        for (const id of changed) if (this.pieces.get(id)?.has(l) && !order.includes(id)) order.push(id);
        this.repack(l, order);
        continue;
      }
      // same sizes: write the changed objects' ranges in place
      for (const id of changed) {
        const p = this.pieces.get(id)?.get(l);
        if (!p) continue;
        const [bs] = buf.boxRange.get(id)!;
        const [ts] = buf.triRange.get(id)!;
        buf.boxes.set(p.boxes, bs);
        buf.tris.set(p.tris, ts);
        this.floatsWritten += p.boxes.length + p.tris.length;
        if (p.boxes.length && buf.dirtyBoxes !== "all") buf.dirtyBoxes.push([bs, p.boxes.length]);
        if (p.tris.length && buf.dirtyTris !== "all") buf.dirtyTris.push([ts, p.tris.length]);
      }
    }
    return touched;
  }

  /** The renderer uploaded a layer: clear its dirty ranges. */
  uploaded(layer: DrawLayerId): void {
    const b = this.layers.get(layer);
    if (b) {
      b.dirtyBoxes = [];
      b.dirtyTris = [];
    }
  }

  /**
   * The geometry of some objects on the layers `visible` accepts (selection and hover outlines), labels, holes
   * and openings left out.
   */
  geometryOf(ids: Iterable<string>, visible: (layer: DrawLayerId) => boolean): { boxes: Float32Array; tris: Float32Array } {
    const bp: Float32Array[] = [];
    const tp: Float32Array[] = [];
    for (const id of ids)
      for (const [l, p] of this.pieces.get(id) ?? []) {
        if (NO_OUTLINE.has(l) || !visible(l)) continue;
        bp.push(p.boxes);
        tp.push(p.tris);
      }
    return { boxes: bp.length ? concat(bp) : EMPTY, tris: tp.length ? concat(tp) : EMPTY };
  }

  /** Instance and vertex counts, for the perf script and tests. */
  counts(): { instances: number; vertices: number; layers: number } {
    let instances = 0;
    let vertices = 0;
    for (const b of this.layers.values()) {
      instances += b.boxes.length / INSTANCE_FLOATS;
      vertices += b.tris.length / VERTEX_FLOATS;
    }
    return { instances, vertices, layers: [...this.layers.values()].filter((b) => b.boxes.length || b.tris.length).length };
  }
}
