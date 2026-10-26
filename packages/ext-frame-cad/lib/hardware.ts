/**
 * UHD fastener module → hardware-cad parameters.
 *
 * A hardware module is a local definition tagged `fastener` and one of
 * `screw`, `nut`, `standoff`, `spacer` (the tags UHD's fastener stacks use).
 * It is designed through the `cad` capability (lib/hardware-cad.ts) when a
 * `cad.config.ts` in its folder names this provider. Its thread or bore interface states `fastener_diameter` and `length`; its
 * mechanical metadata states the rest: `head_diameter_mm` and
 * `head_height_mm` for a screw, `outer_mm` (across flats, or the tube
 * diameter) for the others, and `bore_mm` when the maker states the bore of
 * a nut, standoff or spacer (otherwise the generator's nominal bore). Nothing
 * else is read, and nothing is assumed: a missing size is a problem, not a
 * default.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import type { CapabilityBinding, Project } from "@protoboardai/core";
import { mechanical } from "./params.ts";

export const HARDWARE_PARAMS_SCHEMA = "protoboard.hardware-cad.params/v0";

export const HARDWARE_KINDS = ["screw", "nut", "standoff", "spacer"] as const;
export type HardwareKind = (typeof HARDWARE_KINDS)[number];

export interface HardwareParams {
  schema: typeof HARDWARE_PARAMS_SCHEMA;
  module: string;
  name: string;
  part: {
    kind: HardwareKind;
    diameter: number;
    length: number;
    head_diameter: number | null;
    head_height: number | null;
    outer: number | null;
    /** The bore the maker states (nut, standoff, spacer); absent: the generator's nominal bore. */
    bore?: number;
  };
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

export function hardwareKind(def: ModuleDef): HardwareKind | undefined {
  const tags = def.tags ?? [];
  return tags.includes("fastener") ? HARDWARE_KINDS.find((k) => tags.includes(k)) : undefined;
}

/** Local, used definitions that are hardware modules (optionally only the named ones). */
export function hardwareModules(p: Project, only?: string[]): { def: ModuleDef; problems: string[] }[] {
  if (only?.length) {
    return only.map((id) => {
      const rec = p.definitions.get(id);
      if (!rec) return { def: { id, interfaces: [] } as unknown as ModuleDef, problems: [`no definition "${id}" in the project`] };
      if (rec.origin.kind !== "local") return { def: rec.def, problems: [`${id} is a ${rec.origin.kind} definition; its CAD comes with it (hardware-cad generates local modules only)`] };
      if (!hardwareKind(rec.def)) return { def: rec.def, problems: [`${id} is not tagged fastener plus one of ${HARDWARE_KINDS.join(", ")}`] };
      return { def: rec.def, problems: [] };
    });
  }
  const used = new Set(p.instances.map((i) => i.definition));
  return [...p.definitions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([id, rec]) => used.has(id) && rec.origin.kind === "local" && hardwareKind(rec.def))
    .map(([, rec]) => ({ def: rec.def, problems: [] }));
}

/** The module's cad binding to this provider (its `cad.config.ts`), when it has a usable one. */
export function hardwareBinding(p: Project, id: string): CapabilityBinding | undefined {
  return p.capabilities.find((b) => b.capability === "cad" && b.module === id && b.provider === "@protoboardai/ext-frame-cad" && !b.problem && b.native);
}

export function buildHardwareParams(def: ModuleDef, name: string): { params?: HardwareParams; problems: string[] } {
  const kind = hardwareKind(def);
  if (!kind) return { problems: [`${def.id}: not a hardware module (tags fastener plus ${HARDWARE_KINDS.join("|")})`] };
  const param = (id: string) =>
    def.interfaces
      .map((i) => i.parameters?.find((x) => x.id === id))
      .find((x) => x?.value !== undefined)?.value;
  const meta = mechanical(def);
  const diameter = num(param("fastener_diameter"));
  const length = num(param("length"));
  const headDiameter = num(meta.head_diameter_mm);
  const headHeight = num(meta.head_height_mm);
  const outer = num(meta.outer_mm);
  const bore = num(meta.bore_mm);
  const problems: string[] = [];
  if (diameter === undefined) problems.push(`${def.id}: no interface states fastener_diameter`);
  if (length === undefined) problems.push(`${def.id}: no interface states length`);
  if (kind === "screw" && (headDiameter === undefined || headHeight === undefined)) problems.push(`${def.id}: a screw needs mechanical metadata head_diameter_mm and head_height_mm`);
  if (kind !== "screw" && outer === undefined) problems.push(`${def.id}: a ${kind} needs mechanical metadata outer_mm`);
  if (bore !== undefined && (kind === "screw" || bore >= outer!)) problems.push(`${def.id}: bore_mm ${bore} ${kind === "screw" ? "does not apply to a screw" : `is not inside outer_mm ${outer}`}`);
  if (problems.length) return { problems };
  return {
    problems,
    params: {
      schema: HARDWARE_PARAMS_SCHEMA,
      module: def.id,
      name,
      part: { kind, diameter: diameter!, length: length!, head_diameter: headDiameter ?? null, head_height: headHeight ?? null, outer: outer ?? null, ...(bore !== undefined ? { bore } : {}) },
    },
  };
}
