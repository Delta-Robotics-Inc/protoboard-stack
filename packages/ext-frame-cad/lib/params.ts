/**
 * UHD module → frame-cad parameters.
 *
 * A "plate module" is a local custom structure whose mechanical domain
 * metadata states `plate_thickness_mm`. Its bolt-pattern interfaces with
 * frames are the whole input: where each pattern sits (frame origin and axes,
 * module coordinates, mm, Z up, origin on the plate underside) and what it is
 * (shape, spacing, hole count, fastener). Optional design values are the
 * constraints in the module's `cad.config.ts` (see DEFAULTS); they are this
 * provider's, so they stay out of the UHD module. Nothing about a particular
 * vehicle is hard-coded; the defaults are the reference quadcopter's design
 * values.
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import type { CapabilityBinding, Project } from "@protoboardai/core";

export const PARAMS_SCHEMA = "protoboard.frame-cad.params/v0";

type Vec3 = [number, number, number];

export type Placement = "holes_top" | "holes_bottom" | "pad" | "clamp";

export interface PlateInterface {
  id: string;
  shape: "square" | "rectangle" | "circle";
  spacing: number;
  spacing_y: number | null;
  hole_count: number;
  fastener_d: number;
  placement: Placement;
  /** Frame origin XY as declared (module coordinates, mm); Z follows from the placement and height. */
  origin: [number, number];
  normal: Vec3;
  x_axis: Vec3;
  symmetry: number | null;
  /** pad: pad height above the plate top; clamp: frame origin height above the plate top. */
  height: number;
  /** World XY hole centres for plate patterns (UHD boltPatternHoles convention). */
  holes: [number, number][];
}

export interface PlateParams {
  schema: typeof PARAMS_SCHEMA;
  module: string;
  name: string;
  plate: {
    thickness: number;
    margin: number;
    corner_radius: number;
    arm_width: number;
    arm_slot_width: number;
    hub_extra: number;
    pad_margin: number;
    pad_center_relief: number;
    hole_clearance: number;
    clamp_wall: number;
    clamp_margin: number;
    outline: { x: [number, number]; y: [number, number] } | null;
    slots: { center: [number, number]; size: [number, number] }[];
  };
  interfaces: PlateInterface[];
}

/**
 * Design defaults (mm) and the `cad.config.ts` constraints that override them.
 * Holes are fastener diameter + 2 × hole_clearance (M3 → Ø3.2).
 */
export const DEFAULTS = {
  margin: 3, // outline margin around core holes and clamps          (margin_mm)
  corner_radius: 1.5, // vertical edge fillet                          (corner_radius_mm)
  arm_width: 14, // arm to each raised pad                              (arm_width_mm)
  arm_slot_width: 5, // lightening slot down each arm; 0 = none         (arm_slot_width_mm)
  hub_extra: 1, // hub disc radius beyond the pad                       (hub_extra_mm)
  pad_margin: 3, // pad radius beyond the pattern                       (pad_margin_mm)
  pad_height: 0.5, // raised pad: its own planar mating face            (pad_height_mm)
  pad_center_relief: 3.5, // centre hole in circle pads (shaft/circlip)  (pad_center_relief_mm)
  hole_clearance: 0.1, // radial clearance over the fastener            (hole_clearance_mm)
  clamp_wall: 2, // side-plate thickness                                (clamp_wall_mm)
  clamp_margin: 4, // side-plate width = spacing + margin; top = origin + spacing/2 + margin (clamp_margin_mm)
} as const;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function mechanical(def: ModuleDef): Record<string, unknown> {
  return ((def.domains ?? []).find((d) => d.domain === "mechanical")?.metadata ?? {}) as Record<string, unknown>;
}

export const isPlateModule = (def: ModuleDef) => num(mechanical(def).plate_thickness_mm) !== undefined;

/** Local, used definitions that are plate modules (optionally only the named ones). */
export function plateModules(p: Project, only?: string[]): { def: ModuleDef; problems: string[] }[] {
  const used = new Set(p.instances.map((i) => i.definition));
  const out: { def: ModuleDef; problems: string[] }[] = [];
  if (only?.length) {
    for (const id of only) {
      const rec = p.definitions.get(id);
      if (!rec) out.push({ def: { id, interfaces: [] } as unknown as ModuleDef, problems: [`no definition "${id}" in the project`] });
      else if (rec.origin.kind !== "local") out.push({ def: rec.def, problems: [`${id} is a ${rec.origin.kind} definition; frame-cad generates local custom modules only (derive a local variant)`] });
      else if (!isPlateModule(rec.def)) out.push({ def: rec.def, problems: [`${id} has no mechanical metadata plate_thickness_mm, so it is not a plate module`] });
      else out.push({ def: rec.def, problems: [] });
    }
    return out;
  }
  for (const [id, rec] of [...p.definitions.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (used.has(id) && rec.origin.kind === "local" && isPlateModule(rec.def)) out.push({ def: rec.def, problems: [] });
  }
  return out;
}

export const PROVIDER = "@protoboardai/ext-frame-cad";

/** The module's cad binding to this provider (its `cad.config.ts`), when it has a usable one. */
export function plateBinding(p: Project, id: string): CapabilityBinding | undefined {
  return p.capabilities.find((b) => b.capability === "cad" && b.module === id && b.provider === PROVIDER && !b.problem && b.native);
}

/**
 * Where a bound plate module's files are (tool-integrations §4): the native
 * design in `<dir>/frame-cad/` (params.json, frames.json), the standard
 * outputs in `<dir>/out/` (body.step, body.glb, body.manifest.json, body.dxf,
 * interfaces/<id>.glb).
 */
export function plateFiles(b: Pick<CapabilityBinding, "native" | "out">) {
  return { params: `${b.native}/params.json`, frames: `${b.native}/frames.json`, manifest: `${b.out}/body.manifest.json` };
}

const param = (i: InterfaceDef, id: string) => {
  const v = i.parameters?.find((x) => x.id === id);
  return v?.value ?? (v?.range ? (v.range[0] + v.range[1]) / 2 : undefined);
};
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r6 = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** Local hole positions of a pattern (same convention as UHD boltPatternHoles). */
function localHoles(shape: string, spacing: number, sy: number, count: number): [number, number][] {
  if (shape === "circle") {
    return Array.from({ length: count }, (_, k) => {
      const a = (2 * Math.PI * k) / count;
      return [(Math.cos(a) * spacing) / 2, (Math.sin(a) * spacing) / 2];
    });
  }
  return [
    [-spacing / 2, -sy / 2],
    [spacing / 2, -sy / 2],
    [spacing / 2, sy / 2],
    [-spacing / 2, sy / 2],
  ];
}

/** Generator parameters from the module's interfaces and its config's constraints (design values). */
export function buildParams(def: ModuleDef, name: string, constraints: Record<string, unknown> = {}): { params?: PlateParams; problems: string[] } {
  const meta = mechanical(def);
  const fc = constraints;
  const T = num(meta.plate_thickness_mm);
  const problems: string[] = [];
  if (T === undefined || T <= 0) return { problems: [`${def.id}: mechanical metadata plate_thickness_mm must be a positive number`] };
  const opt = (key: keyof typeof DEFAULTS) => num(fc[`${key}_mm`]) ?? DEFAULTS[key];
  const padIds = Array.isArray(fc.pads) ? (fc.pads as string[]) : undefined;
  const clampHeight = num(fc.clamp_height_mm);

  const interfaces: PlateInterface[] = [];
  for (const i of def.interfaces) {
    const trait = i.traits?.find((t) => t.type === "bolt_pattern");
    const isPattern = trait || i.protocols.some((p) => p.type === "bolt_pattern");
    if (!isPattern) continue;
    const frame = i.geometry?.frame;
    if (!frame) {
      problems.push(`${def.id}.${i.id}: bolt pattern has no frame, so it cannot be placed (add geometry.frame)`);
      continue;
    }
    const shape = (trait?.params?.shape as PlateInterface["shape"]) ?? "square";
    const spacing = param(i, "hole_spacing");
    const d = param(i, "fastener_diameter");
    if (spacing === undefined || d === undefined) {
      problems.push(`${def.id}.${i.id}: needs hole_spacing and fastener_diameter parameters`);
      continue;
    }
    const sy = param(i, "hole_spacing_y") ?? null;
    const count = param(i, "hole_count") ?? 4;
    const n = norm(frame.normal);
    let x = norm(frame.xAxis ?? (Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const y = cross(n, x);
    x = cross(y, n);
    const o = frame.origin;
    let placement: Placement;
    let height = 0;
    if (Math.abs(n[2]) > 0.999) {
      const pad = padIds ? padIds.includes(i.id) : shape === "circle" && n[2] > 0;
      if (pad) {
        placement = "pad";
        height = num(fc.pad_height_mm) ?? DEFAULTS.pad_height;
      } else placement = n[2] > 0 ? "holes_top" : "holes_bottom";
    } else if (Math.abs(n[2]) < 1e-3 && Math.abs(x[2]) < 1e-3) {
      placement = "clamp";
      height = clampHeight ?? o[2] - T;
      if (!(sy && sy > 0)) problems.push(`${def.id}.${i.id}: a side clamp (horizontal normal) needs hole_spacing_y, the clamped width`);
    } else {
      problems.push(`${def.id}.${i.id}: frame normal [${n.map((v) => v.toFixed(2))}] is neither vertical nor horizontal; frame-cad generates plates and vertical side clamps only`);
      continue;
    }
    const holes = placement === "clamp" ? [] : localHoles(shape, spacing, sy ?? spacing, count).map(([hx, hy]) => [r6(o[0] + hx * x[0] + hy * y[0]), r6(o[1] + hx * x[1] + hy * y[1])] as [number, number]);
    interfaces.push({
      id: i.id,
      shape,
      spacing,
      spacing_y: sy,
      hole_count: count,
      fastener_d: d,
      placement,
      origin: [o[0], o[1]],
      normal: [r6(n[0]), r6(n[1]), r6(n[2])],
      x_axis: [r6(x[0]), r6(x[1]), r6(x[2])],
      symmetry: frame.symmetryDeg ?? null,
      height: r6(height),
      holes,
    });
  }
  if (!interfaces.length) problems.push(`${def.id}: no bolt-pattern interfaces with frames; nothing to generate`);
  const outline = fc.outline_mm as { x: [number, number]; y: [number, number] } | undefined;
  const slots = (fc.slots_mm ?? []) as { center: [number, number]; size: [number, number] }[];
  return {
    problems,
    params: {
      schema: PARAMS_SCHEMA,
      module: def.id,
      name,
      plate: {
        thickness: T,
        margin: opt("margin"),
        corner_radius: opt("corner_radius"),
        arm_width: opt("arm_width"),
        arm_slot_width: opt("arm_slot_width"),
        hub_extra: opt("hub_extra"),
        pad_margin: opt("pad_margin"),
        pad_center_relief: opt("pad_center_relief"),
        hole_clearance: opt("hole_clearance"),
        clamp_wall: opt("clamp_wall"),
        clamp_margin: opt("clamp_margin"),
        outline: outline ?? null,
        slots,
      },
      interfaces,
    },
  };
}

/** Frames as the generator writes them: interface id → frame. */
export type FramesFile = Record<string, { origin: Vec3; normal: Vec3; xAxis?: Vec3; symmetryDeg?: number }>;

export const sameVec = (a: number[] | undefined, b: number[] | undefined, tol = 0.01) =>
  !!a && !!b && a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) <= tol);
