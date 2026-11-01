/**
 * The scene index written beside every view sidecar (`X.view.json`), and the
 * context the build passes in to name what is inside a GLB.
 *
 * Units and frames: everything here is in the GLB's own frame, glTF metres
 * and Y-up (UHD is mm and Z-up; the GLB exporters convert at their boundary,
 * and this index does not convert back).
 */
import type { VIEW_SIDECAR_SCHEMA } from "./names.js";

/** What the build knows about a component inside a GLB (a part on a board). */
export interface ViewComponent {
  /** UHD instance path relative to the GLB's owner module ("controller/sensors/r18"). */
  instancePath: string;
  /** The component's definition id. */
  definition?: string;
  /** Vendor key: `lcsc:C25804`, else `mpn:<manufacturer> <part number>`. */
  vendorKey?: string;
  /** Coarse kind for default materials and filters ("resistor", "ic", "connector", ...). */
  partKind?: string;
  placeholder?: boolean;
}

/** The owner of a GLB: the definition whose body it is. */
export interface ViewOwner {
  definition?: string;
  partKind?: string;
  vendorKey?: string;
  placeholder?: boolean;
}

export interface ViewContext {
  owner?: ViewOwner;
  /**
   * Components inside the GLB, keyed by lower-case reference designator
   * (the instance id's last segment, "r18") and by lower-case instance path.
   * A key that two components share is left out by the caller.
   */
  components?: Map<string, ViewComponent>;
  /**
   * Node names the GLB's geometry manifest gives (`features`: interface pads; `bodies`: named bodies). Each such
   * node stays its own node with its own name in the sidecar, as does any node with its own extras.protoboard id.
   */
  features?: string[];
  bodies?: string[];
  /** The source is a mesh (STL, scan): simplify it for display (decision 3, DEFAULT). */
  meshOrigin?: boolean;
}

/** Axis-aligned bounds in the GLB's world frame (metres, Y-up). */
export interface ViewBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * One part in the sidecar. `faces` is the face-range table: per primitive of
 * the part's mesh, `[feature, firstTriangle, triangleCount]` triples. Feature
 * ids are the source's primitive ordinal within the part (one primitive per
 * B-rep face in an OCCT export), also carried per vertex as `_FEATURE_ID_0`
 * (EXT_mesh_features).
 */
export interface ViewNode {
  /**
   * Stable id: the instance path, "." for the owner's merged remainder, `refdes:<R>` for an unmatched designator,
   * `feature:<name>` / `body:<name>` for a node the geometry manifest names, `node:<name>` for one with its own id.
   */
  id: string;
  /** UHD instance path relative to the owner ("" = the owner itself). Same as `extras.protoboard.partInstanceId`. */
  instancePath: string;
  refdes?: string;
  definition?: string;
  vendorKey?: string;
  partKind?: string;
  placeholder?: boolean;
  /** "feature" or "body" (named by the geometry manifest), "node" (own extras.protoboard id). */
  role?: "feature" | "body" | "node";
  /** Source node name (the part's root node in X.glb; the same name in X.view.glb for a named node). */
  name?: string;
  /** Where it is in X.view.glb: the node index, and the instance index when the node is GPU-instanced. */
  node: number;
  instance?: number;
  bounds: ViewBounds;
  /** The tier the face-range table describes. */
  tier: "fine";
  triangles: { fine: number; coarse: number };
  /** Number of source primitives (faces) merged into the part. */
  featureCount: number;
  /** Per primitive of the node's mesh: `[feature, firstTriangle, triangleCount]` triples, flattened. */
  faces: number[][];
}

export interface ViewCounts {
  /** Draw calls one placement of the file costs (one per primitive per mesh node; a GPU-instanced node is one). */
  draws: number;
  triangles: number;
  nodes: number;
  materials: number;
  primitives: number;
}

export interface ViewTier {
  file: string;
  sha256: string;
  bytes: number;
  draws: number;
  triangles: number;
  /** How it was made. */
  method: "merged" | "kernel-coarse" | "simplified" | "same-as-fine";
  /** Simplification error target (fraction of a part's extent), when simplified (or tried, for same-as-fine). */
  error?: number;
}

export interface ViewSidecarIndex {
  schema: typeof VIEW_SIDECAR_SCHEMA;
  pipeline: number;
  /** Instance paths in this file are relative to its owner; the viewer joins them with the placement's path. */
  idScope: "relative-to-owner";
  owner?: ViewOwner;
  /** The source's wrapper node, kept as node 0 of X.view.glb: every part is its child, by the source's names. */
  root?: { node: number; name: string };
  source: { file: string; sha256: string; bytes: number; coarse?: { file: string; sha256: string } };
  /** Hash of the options that change the output. */
  options: string;
  tiers: { fine: ViewTier; coarse: ViewTier };
  counts: { before: ViewCounts; after: ViewCounts };
  instancing: { groups: number; instances: number; extension: "EXT_mesh_gpu_instancing" };
  nodes: ViewNode[];
  /** How ids travel, as verified by test/view-model.test.ts. */
  design: Record<string, string>;
  warnings?: string[];
}
