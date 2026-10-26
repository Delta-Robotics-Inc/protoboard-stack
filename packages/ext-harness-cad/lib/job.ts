/**
 * UHD project → harness routing job.
 *
 * The job is everything the Python router needs and nothing it has to know
 * about UHD: the assembled model as placed GLB bodies (obstacles), and for
 * each wire harness its conductors, length and ends, each end resolved to
 * the world positions its conductors land on (the linked part's pads, or the
 * pins of the socket its plug goes into).
 *
 * Placement is UHD `assemble`, with the project's display placements for
 * modules no mechanical link reaches (battery, receiver, capacitor): the same
 * assembly the viewer draws.
 *
 * The job always holds every routable harness of the system: the router
 * routes them in the system's order, each around the ones before it, and
 * writes routes only for the job's `targets`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assemble,
  bodyKey,
  combineFrames,
  isConnector,
  linkEndFrames,
  type Assembly,
  type GeometryFrame,
  type InterfaceDef,
  type InterfaceLink,
  type Mat4,
  type ModuleDef,
} from "@deltarobotics/uhd";
import type { Project } from "@protoboardai/core";
import { SILICONE_OD_MM, WIRE_COLORS, termination, type Termination } from "./connectors.ts";

export const JOB_SCHEMA = "protoboard.harness-cad.job/v0";
type Vec3 = [number, number, number];

export interface CableBuild {
  /** Insulation colour per position of the first end (names from WIRE_COLORS or #rrggbb). */
  colors: string[];
  /** twisted: helix around the route; parallel: side by side (ribbon-like). */
  bundle: "twisted" | "parallel";
  /** mm per full turn when twisted. */
  twist_pitch_mm?: number;
  /** Conductor outside diameter override (mm); default from wire_gauge_awg. */
  od_mm?: number;
  /** Bare (uninsulated) conductors: component leads. */
  bare?: boolean;
  /** Stripped, tinned length at a soldered end (mm). */
  strip_mm?: number;
  /** Centre spacing of parallel conductors (mm); default: touching. */
  spacing_mm?: number;
}

export interface JobEnd {
  interfaceId: string;
  linkId: string;
  counterpart: string;
  connector: string;
  termination: Termination;
  /** Where each position lands (world, mm) and the direction the conductor arrives from (outward from the part). */
  pins: { position: string; at: Vec3; out: Vec3 }[];
  /** The frame the harness end must carry: the counterpart's combined frame, normal reversed. */
  frame: GeometryFrame;
  /** Counterpart frame (outward). */
  counterpartFrame: GeometryFrame;
}

export interface JobHarness {
  id: string;
  path: string;
  name: string;
  length_mm: number;
  awg?: number;
  conductors: { position: string; color: string; od: number; bare: boolean }[];
  /** Conductor k connects ends[0].pins[k] to ends[1].pins[pair[k]]. */
  pairs: number[];
  build: Required<Pick<CableBuild, "bundle">> & CableBuild;
  ends: JobEnd[];
}

export interface Job {
  schema: typeof JOB_SCHEMA;
  bodies: { key: string; glb: string; matrix: Mat4 }[];
  harnesses: JobHarness[];
  /** Harness definition ids whose routes the router writes (default: all). */
  targets?: string[];
  problems: string[];
}

const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export function displayHints(p: Project): { root?: string; fixed: Record<string, Mat4> } {
  const file = join(p.root, p.config.display ?? ".protoboard/display.json");
  if (!existsSync(file)) return { fixed: {} };
  const d = JSON.parse(readFileSync(file, "utf8")) as { spatial?: { root?: string; placements?: Record<string, { matrix: Mat4 }> } };
  return { root: d.spatial?.root, fixed: Object.fromEntries(Object.entries(d.spatial?.placements ?? {}).map(([k, v]) => [k, v.matrix])) };
}

/** The assembly the viewer draws: UHD assemble from the display root, with display placements. */
export function projectAssembly(p: Project): Assembly {
  const { root, fixed } = displayHints(p);
  const rootPath = root ? root.split("/") : [p.instances.find((i) => i.parent === "" && p.lookup(i.definition)?.interfaces.some((f) => f.geometry?.frame))?.path ?? ""];
  return assemble(p.rootDef!, p.lookup, { root: rootPath, fixed });
}

/** Every link below the root with the module that declares it and its path. */
function allLinks(root: ModuleDef, lookup: Project["lookup"]) {
  const out: { owner: ModuleDef; prefix: string[]; link: InterfaceLink }[] = [];
  const walk = (d: ModuleDef, prefix: string[]) => {
    for (const link of d.links ?? []) out.push({ owner: d, prefix, link });
    for (const c of d.children ?? []) {
      const def = lookup(c.moduleDefId);
      if (def && def.kind !== "harness" && def.children?.length) walk(def, [...prefix, c.id]);
    }
  };
  walk(root, []);
  return out;
}

export const cableBuild = (def: ModuleDef): CableBuild | undefined => def.traits?.find((t) => t.type === "cable_build")?.params as CableBuild | undefined;
export const cableLength = (def: ModuleDef): number | undefined => {
  const t = def.traits?.find((x) => x.type === "performance" && x.params?.kind === "cable");
  return typeof t?.params?.length_mm === "number" ? (t.params.length_mm as number) : undefined;
};
const cableAwg = (def: ModuleDef): number | undefined => {
  const t = def.traits?.find((x) => x.type === "performance" && x.params?.kind === "cable");
  return typeof t?.params?.wire_gauge_awg === "number" ? (t.params.wire_gauge_awg as number) : undefined;
};
const connectorType = (i: InterfaceDef) => String(i.traits?.find((t) => t.type === "connector")?.params?.connector_type ?? "");

/** Wire harness instances: kind harness with connector-composite ends and a cable_build trait. */
export function wireHarnesses(asm: Assembly, only?: string[]) {
  return asm.instances.filter(
    (i) => i.kind === "harness" && i.def.interfaces.some(isConnector) && cableBuild(i.def) && (!only?.length || only.includes(i.def.id) || only.includes(i.path.join("/"))),
  );
}

export function buildJob(p: Project): Job {
  const problems: string[] = [];
  const asm = projectAssembly(p);
  const placed = new Map(asm.placements.map((x) => [x.key, x]));
  const art = (def: string, id: string) => p.artifacts.find((a) => a.definition === def && a.id === id);

  // obstacles: every placed body with a GLB, and every placed piece of hardware
  const bodies: Job["bodies"] = [];
  const defAt = new Map(asm.instances.map((i) => [bodyKey(i.path), i.def]));
  // a placed module with children (a board carrying its components, a housing carrying its inserts) is not a leaf instance
  const innerAt = (path: string[]): ModuleDef | undefined => {
    let d: ModuleDef | undefined = p.rootDef;
    for (const id of path) {
      const ref: { moduleDefId: string } | undefined = d?.children?.find((c) => c.id === id);
      d = ref ? p.lookup(ref.moduleDefId) : undefined;
    }
    return d;
  };
  for (const pl of asm.placements) {
    const inner = defAt.has(bodyKey(pl.path)) ? undefined : innerAt(pl.path);
    const def = defAt.get(bodyKey(pl.path)) ?? (inner?.artifacts?.some((a) => a.format === "glb" && a.role === "body") ? inner : undefined);
    if (!def) continue;
    const glb = (def.artifacts ?? []).find((a) => a.format === "glb" && a.role === "body" && (pl.body ? a.id === pl.body || a.provenance?.generatedFrom === pl.body : true));
    const file = glb && art(def.id, glb.id);
    if (file?.resolved && existsSync(file.resolved)) bodies.push({ key: pl.key, glb: file.resolved, matrix: pl.matrix });
    else problems.push(`${pl.key}: no GLB body to route around (${glb?.filePath ?? "none declared"})`);
  }
  for (const hw of asm.hardware) {
    const glb = (hw.def.artifacts ?? []).find((a) => a.format === "glb" && a.role === "body");
    const file = glb && art(hw.def.id, glb.id);
    if (file?.resolved && existsSync(file.resolved)) bodies.push({ key: `${hw.harness}/${hw.child}`, glb: file.resolved, matrix: hw.matrix });
  }

  const links = allLinks(p.rootDef!, p.lookup);
  const harnesses: JobHarness[] = [];
  for (const inst of wireHarnesses(asm)) {
    const def = inst.def;
    const build = cableBuild(def)!;
    const length = cableLength(def);
    const pathKey = inst.path.join("/");
    if (!length) {
      problems.push(`${pathKey} (${def.id}): no cable length (performance trait { kind: "cable", length_mm })`);
      continue;
    }
    const parent = inst.path.slice(0, -1).join("/");
    const childId = inst.path[inst.path.length - 1];
    const ends: JobEnd[] = [];
    for (const { owner, prefix, link } of links) {
      if (prefix.join("/") !== parent) continue;
      for (const [mine, theirs] of [[link.a, link.b], [link.b, link.a]] as const) {
        if (!("child" in mine) || mine.child !== childId) continue;
        const own = def.interfaces.find((i) => i.id === mine.interfaceId);
        if (!own || !isConnector(own)) continue;
        const other = linkEndFrames(owner, theirs, p.lookup, prefix, placed);
        const linkId = [...prefix, link.id].join("/");
        if (!other || !other.frames.length || !other.combined) {
          problems.push(`${pathKey}.${own.id}: ${other?.label ?? "its counterpart"} has no geometry frame (link ${linkId})`);
          continue;
        }
        if (!other.placed) {
          problems.push(`${pathKey}.${own.id}: ${other.label} is not placed (no mate and no display placement)`);
          continue;
        }
        const positions = (own.slots ?? []).map((s) => s.id);
        const t = termination(connectorType(own), positions.length);
        const c = other.combined;
        let pins: JobEnd["pins"];
        if (other.frames.length === positions.length) {
          // one frame per position: a composed end (pads in slot order) or a parent port's leaves
          pins = positions.map((pos, k) => ({ position: pos, at: other.frames[k].frame.origin as Vec3, out: other.frames[k].frame.normal as Vec3 }));
        } else if (other.frames.length === 1 && c.xAxis) {
          // a socket: positions along its xAxis at the connector's pitch
          const pitch = t.pitch ?? 1;
          pins = positions.map((pos, k) => ({ position: pos, at: add(c.origin as Vec3, c.xAxis as Vec3, (k - (positions.length - 1) / 2) * pitch), out: c.normal as Vec3 }));
        } else {
          problems.push(`${pathKey}.${own.id}: ${other.frames.length} frame(s) on ${other.label} for ${positions.length} position(s)`);
          continue;
        }
        ends.push({
          interfaceId: own.id,
          linkId,
          counterpart: other.label,
          connector: connectorType(own),
          termination: t,
          pins,
          counterpartFrame: c,
          frame: { origin: c.origin, normal: neg(c.normal as Vec3), ...(c.xAxis ? { xAxis: c.xAxis } : {}) },
        });
      }
    }
    if (ends.length !== 2) {
      problems.push(`${pathKey} (${def.id}): ${ends.length} routable end(s); the router handles point-to-point cables (2)`);
      continue;
    }
    // conductor pairing from the harness's internal link (straight through unless childLinks say otherwise)
    const wires = (def.links ?? []).find((l) => "self" in l.a && "self" in l.b);
    const [ea, eb] = "self" in (wires?.a ?? {}) && wires!.a.interfaceId === ends[1].interfaceId ? [ends[1], ends[0]] : [ends[0], ends[1]];
    const pairs = ea.pins.map((pin, k) => {
      const cl = wires?.childLinks?.find((x) => x.a === pin.position);
      const target = cl?.b ?? pin.position;
      const idx = eb.pins.findIndex((q) => q.position === target);
      return idx < 0 ? k : idx;
    });
    const awg = cableAwg(def);
    const od = build.od_mm ?? (awg ? SILICONE_OD_MM[awg] : undefined);
    if (!od) {
      problems.push(`${pathKey} (${def.id}): no conductor diameter (wire_gauge_awg or cable_build.od_mm)`);
      continue;
    }
    if (build.colors.length !== ea.pins.length) problems.push(`${pathKey}: ${build.colors.length} colour(s) for ${ea.pins.length} conductor(s)`);
    harnesses.push({
      id: def.id,
      path: pathKey,
      name: def.name ?? def.id,
      length_mm: length,
      awg,
      conductors: ea.pins.map((pin, k) => ({ position: pin.position, color: WIRE_COLORS[build.colors[k]] ?? build.colors[k] ?? "#888888", od, bare: !!build.bare })),
      pairs,
      build: { ...build, bundle: build.bundle ?? "parallel" },
      ends: [ea, eb],
    });
  }
  // thickest cables first: they have the fewest ways through
  harnesses.sort((a, b) => b.conductors[0].od * b.conductors.length - a.conductors[0].od * a.conductors.length);
  return { schema: JOB_SCHEMA, bodies, harnesses, problems };
}

/** The harness end frames a route manifest records, as UHD frames. */
export function endFrames(h: JobHarness): Record<string, GeometryFrame> {
  return Object.fromEntries(h.ends.map((e) => [e.interfaceId, e.frame]));
}

export { combineFrames };
