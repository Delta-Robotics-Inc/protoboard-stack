/**
 * Findings to 3D anchors (PB-1184, marker-first DRC): where on the 3D model a
 * finding from `protoboard check` sits, so the viewer can put a severity
 * marker there. SHARED FILE: kept byte for byte identical in protoboard-stack
 * `packages/core/src/findings-anchors.ts` and uhd-viewer
 * `src/cad/annot/findings-anchors.ts` (a core test compares them when the
 * viewer checkout is linked). Edit both or neither. Pure: no three.js, no IO.
 *
 * Inputs:
 * - findings: `ProjectDiagnostic`-shaped records (code, severity, message,
 *   entity, validator) with an optional `location` (`DiagnosticLocation`,
 *   core `types.ts`: board-frame mm, +X right, +Y up in the top view);
 * - the placed bodies: each body's placement key (its instance path from the
 *   root, `#artifact` for a named artifact body) and, when the body was built
 *   with a view sidecar, the sidecar index's nodes (`X.view.json`: instance
 *   paths relative to the body, reference designators, bounds).
 *
 * Output per finding: a deterministic id, a severity for the marker, the
 * anchors (a body, a component inside it, a point in the body's own frame) and
 * the instance paths it names (what "isolate" shows). A finding with nothing
 * placed to stand on has no anchors and a `reason`: the Findings control lists
 * it with "no location", it is never pinned somewhere else.
 *
 * Units and frames: sidecar bounds are glTF (metres, +Y up, the GLB's own
 * frame). Anchors are returned in the body's CAD frame (mm, +Z up), the frame
 * the viewer draws a body in before its placement: (x, y, z)body =
 * (x, -z, y)glTF x 1000 (the viewer's `cadWrapper`; ext-tscircuit writes its
 * board.glb the same way, so a board's frame is its body frame and a
 * `DiagnosticLocation.at` needs no conversion beyond adding the layer's z).
 */

export type Vec3 = [number, number, number];

/** Where a finding sits on a design (core `DiagnosticLocation`). */
export interface FindingLocation {
  scope?: "design";
  at?: [number, number];
  points?: [number, number][];
  layer?: string;
  components?: string[];
  pads?: string[];
  nets?: string[];
  items?: string[];
}

/** One finding (core `ProjectDiagnostic`, or a bundle diagnostic with the location kept). */
export interface FindingInput {
  code: string;
  severity: string;
  message: string;
  entity?: { kind: string; id: string };
  validator?: string;
  location?: FindingLocation;
  /** A warning a provider marks as "may be bad" (Kevin's orange risk). Absent today in every validator. */
  risk?: boolean;
}

export type Bounds = { min: Vec3; max: Vec3 } | [Vec3, Vec3];

/** One node of a body's view sidecar index (`X.view.json` `nodes[]`). */
export interface SceneNode {
  /** Instance path relative to the body ("" = the body itself). */
  instancePath?: string;
  refdes?: string;
  /** glTF metres, +Y up, the GLB's own frame. */
  bounds?: Bounds;
}

export interface SceneBody {
  /** Placement key: instance path from the root, `<path>#<artifact>` for a named artifact body. */
  key: string;
  /** The body's sidecar nodes, when it has a sidecar. */
  nodes?: SceneNode[];
  /** The body's definition id (a board's own checks name their design by definition). */
  definition?: string;
  /** Copper surfaces in the body frame (mm), when known; else read from the body's own node bounds. */
  surface?: { top: number; bottom: number };
}

export interface FindingAnchorPoint {
  /** The body's placement key. */
  body: string;
  /** A component drawn inside the body, by instance path from the root. */
  component?: string;
  /** The point, in the body's CAD frame (mm, Z up); absent: the component's or the body's own surface. */
  local?: Vec3;
  layer?: string;
}

/** Marker severity: shape and colour per the callout sheet (fail octagon, risk diamond, warn triangle, info circle). */
export type FindingSeverity = "fail" | "risk" | "warn" | "info" | "pass" | "unknown";

export interface FindingAnchors {
  /** Deterministic: `drc:<code>:<entity kind>:<entity id>`, `#<n>` from the second repeat on. */
  id: string;
  code: string;
  severity: FindingSeverity;
  message: string;
  validator?: string;
  entity?: { kind: string; id: string };
  anchors: FindingAnchorPoint[];
  /** Instance paths the finding names (components first), from the root. */
  refs: string[];
  /** How the anchors were found. */
  how: "components" | "points" | "design" | "entity" | "none";
  /** Why there is no anchor (how "none"). */
  reason?: string;
}

/** DEFAULT (PB-1184): at most this many point anchors per finding (a finding over 200 vias shows the first 16). */
export const MAX_POINTS_PER_FINDING = 16;

/** glTF (metres, +Y up) to the body's CAD frame (mm, +Z up). */
export function glbToBody(v: Vec3): Vec3 {
  const r = (n: number) => Math.round(n * 1e6) / 1e3 + 0;
  return [r(v[0]), r(-v[2]), r(v[1])];
}

/** A finding's marker severity. DEFAULT: a warning is "warn" (yellow) unless it says `risk`; info stays info. */
export function severityOf(d: Pick<FindingInput, "severity" | "risk">): FindingSeverity {
  if (d.severity === "error") return "fail";
  if (d.severity === "warning") return d.risk ? "risk" : "warn";
  if (d.severity === "info") return "info";
  if (d.severity === "risk" || d.severity === "pass" || d.severity === "unknown" || d.severity === "fail" || d.severity === "warn") return d.severity;
  return "unknown";
}

/** Worst first: the order markers, counts and badges use. */
export const SEVERITY_ORDER: FindingSeverity[] = ["fail", "risk", "warn", "unknown", "info", "pass"];
export const worst = (list: FindingSeverity[]): FindingSeverity | undefined =>
  list.length ? list.reduce((a, b) => (SEVERITY_ORDER.indexOf(b) < SEVERITY_ORDER.indexOf(a) ? b : a)) : undefined;

const boundsOf = (b: Bounds | undefined): [Vec3, Vec3] | undefined => {
  if (!b) return undefined;
  const pair = Array.isArray(b) ? b : [b.min, b.max];
  const ok = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
  return ok(pair[0]) && ok(pair[1]) ? [pair[0], pair[1]] : undefined;
};

/** A node's bounds in the body frame (mm, Z up): min and max corners. */
function bodyBox(n: SceneNode): [Vec3, Vec3] | undefined {
  const b = boundsOf(n.bounds);
  if (!b) return undefined;
  const a = glbToBody(b[0]);
  const c = glbToBody(b[1]);
  return [
    [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.min(a[2], c[2])],
    [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])],
  ];
}

const keyPath = (key: string) => key.split("#")[0];
const under = (path: string, holder: string) => holder === "" || path === holder || path.startsWith(`${holder}/`);

/** The body that holds an instance path: the placed body with the longest path that is it or above it. */
export function bodyFor(bodies: SceneBody[], path: string): SceneBody | undefined {
  let best: SceneBody | undefined;
  for (const b of bodies) {
    const p = keyPath(b.key);
    if (b.key.includes("#") && p !== path) continue;
    if (!under(path, p)) continue;
    if (!best || p.length > keyPath(best.key).length || (p.length === keyPath(best.key).length && !b.key.includes("#") && best.key.includes("#"))) best = b;
  }
  return best;
}

/** The sidecar node of a component, by its path relative to the body or its reference designator. */
function nodeFor(body: SceneBody, rel: string): SceneNode | undefined {
  const nodes = body.nodes ?? [];
  const low = rel.toLowerCase();
  return nodes.find((n) => n.instancePath === rel) ?? nodes.find((n) => n.instancePath !== undefined && n.instancePath.toLowerCase() === low) ?? (rel.includes("/") ? undefined : nodes.find((n) => n.refdes?.toLowerCase() === low));
}

/** The copper surface z for a layer (body frame, mm). DEFAULT: inner layers and unknown names at mid-thickness. */
function layerZ(body: SceneBody, layer: string | undefined): number {
  let top = body.surface?.top;
  let bottom = body.surface?.bottom;
  if (top === undefined || bottom === undefined) {
    const own = (body.nodes ?? []).find((n) => n.instancePath === "" || n.instancePath === ".");
    const box = own ? bodyBox(own) : undefined;
    // DEFAULT: without a surface or the body's own node, the board's mid-plane is z = 0 (ext-tscircuit's frame)
    top = box ? box[1][2] : 0;
    bottom = box ? box[0][2] : 0;
  }
  if (!layer || layer === "top" || layer === "top_copper" || layer === "F.Cu") return top;
  if (layer === "bottom" || layer === "bottom_copper" || layer === "B.Cu") return bottom;
  return (top + bottom) / 2;
}

/** A component's anchor: on top of its sidecar bounds when known (a marker sits on the part, not inside it). */
function componentAnchor(bodies: SceneBody[], design: SceneBody | undefined, c: string): FindingAnchorPoint | undefined {
  const designPath = design ? keyPath(design.key) : undefined;
  const full = designPath !== undefined && !under(c, designPath) ? (designPath ? `${designPath}/${c}` : c) : c;
  const body = bodyFor(bodies, full) ?? design;
  if (!body) return undefined;
  const holder = keyPath(body.key);
  const rel = holder && full.startsWith(`${holder}/`) ? full.slice(holder.length + 1) : full === holder ? "" : full;
  if (rel === "") return { body: body.key };
  const node = nodeFor(body, rel);
  const box = node ? bodyBox(node) : undefined;
  const component = node?.instancePath && holder ? `${holder}/${node.instancePath}` : node?.instancePath ? node.instancePath : full;
  return { body: body.key, component, ...(box ? { local: [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, box[1][2]] as Vec3 } : {}) };
}

export interface FindingsAnchorsOptions {
  /** Anchor for an entity-only finding (the viewer's own resolver: links, interface frames, manifest features). */
  entityAnchor?: (ref: string, d: FindingInput) => FindingAnchorPoint | undefined;
  /** Keep info findings (default false: info is not pinned to the model). */
  includeInfo?: boolean;
}

const refOf = (e: { kind: string; id: string } | undefined) => (!e ? undefined : e.kind === "link" ? `link:${e.id}` : e.id);

/**
 * Anchors for every finding, in input order. Pure and deterministic: the same
 * findings and bodies give the same ids and anchors, so a rebuild patches
 * markers in place (same id), adds new ones and drops gone ones.
 */
export function findingsAnchors(findings: FindingInput[], bodies: SceneBody[], options: FindingsAnchorsOptions = {}): FindingAnchors[] {
  const seen = new Map<string, number>();
  const out: FindingAnchors[] = [];
  for (const d of findings) {
    const severity = severityOf(d);
    if (severity === "info" && !options.includeInfo) continue;
    const base = `drc:${d.code}:${d.entity?.kind ?? "none"}:${d.entity?.id ?? ""}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}#${n}`;
    const entityRef = refOf(d.entity);
    const entityPath = d.entity && (d.entity.kind === "instance" || d.entity.kind === "interface" || d.entity.kind === "artifact") ? d.entity.id.split(":")[0] : undefined;
    // the design the location's coordinates are in: the instance it names, or (a provider's own check) the first
    // placed body of the definition it names (DEFAULT: one marker set, on the first instance of a repeated board)
    const design = entityPath !== undefined ? bodyFor(bodies, entityPath) : d.entity?.kind === "definition" ? bodies.find((b) => b.definition === d.entity!.id && !b.key.includes("#")) : undefined;
    const loc = d.location;
    const record = (anchors: FindingAnchorPoint[], refs: string[], how: FindingAnchors["how"], reason?: string): FindingAnchors => ({
      id,
      code: d.code,
      severity,
      message: d.message,
      ...(d.validator ? { validator: d.validator } : {}),
      ...(d.entity ? { entity: { kind: d.entity.kind, id: d.entity.id } } : {}),
      anchors,
      refs: [...new Set(refs)],
      how,
      ...(reason ? { reason } : {}),
    });
    // the components it names (a pin's instance before its colon)
    const parts = (loc?.components ?? []).map((c) => componentAnchor(bodies, design, c.split(":")[0])).filter((a): a is FindingAnchorPoint => !!a);
    const partRefs = parts.map((a) => a.component ?? keyPath(a.body));
    // 1. points on the design (board-frame mm, the most specific: a pad, a via): on the copper surface of the layer
    const pts = [...(loc?.at ? [loc.at] : []), ...(loc?.points ?? [])].filter((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "number" && Number.isFinite(x)));
    if (pts.length && design) {
      const z = layerZ(design, loc?.layer);
      const unique = [...new Map(pts.map((p) => [`${p[0]},${p[1]}`, p])).values()];
      const anchors = unique.slice(0, MAX_POINTS_PER_FINDING).map((p) => ({ body: design.key, local: [p[0], p[1], z] as Vec3, ...(loc?.layer ? { layer: loc.layer } : {}) }));
      out.push(record(anchors, partRefs.length ? partRefs : [keyPath(design.key)], "points"));
      continue;
    }
    // 2. a marker on each component it names
    if (parts.length) {
      out.push(record(parts, partRefs, "components"));
      continue;
    }
    // 3. the whole design
    if (loc?.scope === "design" && design) {
      out.push(record([{ body: design.key }], [keyPath(design.key)], "design"));
      continue;
    }
    // 4. what the entity names (a part, a pin, an interface, a link)
    if (entityRef !== undefined && d.entity!.kind !== "project" && d.entity!.kind !== "definition") {
      const viaResolver = options.entityAnchor?.(entityRef, d);
      const a = viaResolver ?? (entityPath !== undefined ? componentAnchor(bodies, undefined, entityPath) : undefined);
      if (a) {
        out.push(record([a], [a.component ?? (entityPath && bodyFor(bodies, entityPath) ? entityPath : keyPath(a.body))], "entity"));
        continue;
      }
    }
    const reason = !d.entity
      ? "the finding names nothing"
      : d.entity.kind === "project"
        ? `it is about the project (${d.entity.id}), not a placed part`
        : d.entity.kind === "definition"
          ? `no placed part is made from ${d.entity.id}`
          : `nothing placed in the 3D view holds ${d.entity.id}`;
    out.push(record([], entityPath ? [entityPath] : [], "none", reason));
  }
  return out;
}
