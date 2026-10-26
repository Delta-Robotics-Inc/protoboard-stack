/**
 * Contributions to the Manufacturing Package (@protoboardai/ext-release section
 * contract) for the plates this provider designs: the cut order of each
 * plate in its unit's work order (process, material, stock thickness and
 * size, quantities by DXF layer, hole sizes, the smallest feature the
 * router bit must cut, what the DXF leaves out, edge finish), and the
 * inspection of what the cut order asks for in the test plan. Values come
 * from the module (material, interfaces), its cad.config.ts, the generator
 * parameters (frame-cad/params.json) and the standard outputs (out/).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityBinding, Project } from "@protoboardai/core";
import type { Block, SectionContext, SectionFn } from "@protoboardai/ext-release";
import { glbBox, perBuild, providerModules, readOutput } from "@protoboardai/ext-release/helpers";
import { DEFAULTS, mechanical, PROVIDER } from "../lib/params.ts";

interface Manifest {
  dxf?: string;
  layers?: string[];
  quantities?: Record<string, number>;
  notInDxf?: string[];
  thickness_mm?: Record<string, number>;
}

const n = (v: number, d = 1) => String(Number(v.toFixed(d)));

/** What the cut order needs for one plate module. */
export function cutOrder(p: Project, b: CapabilityBinding) {
  const def = p.definitions.get(b.module!)!.def;
  const m = readOutput<{ manufacturing?: Manifest }>(p, b, "body.manifest.json")?.manufacturing ?? {};
  const c = { ...DEFAULTS, ...Object.fromEntries(Object.entries(b.constraints).map(([k, v]) => [k.replace(/_mm$/, ""), v])) } as Record<string, unknown>;
  const mat = mechanical(def).material ?? (def.domains?.find((d) => d.domain === "mechanical") as { material?: unknown } | undefined)?.material;
  const material = typeof mat === "object" && mat ? ((mat as { name?: string }).name ?? "") : typeof mat === "string" ? mat : "";
  const params = b.native && existsSync(join(p.root, b.native, "params.json")) ? (JSON.parse(readFileSync(join(p.root, b.native, "params.json"), "utf8")) as { interfaces?: { fastener_d: number; hole_count: number; placement: string }[] }) : undefined;
  const clearance = Number(c.hole_clearance ?? DEFAULTS.hole_clearance);
  const holes = new Map<number, number>();
  for (const i of params?.interfaces ?? []) if (i.placement !== "clamp") holes.set(i.fastener_d, (holes.get(i.fastener_d) ?? 0) + i.hole_count);
  const slots = (Array.isArray(c.slots) ? (c.slots as { size: [number, number] }[]) : []).map((s) => Math.min(...s.size));
  const armSlot = Number(c.arm_slot_width ?? 0);
  const smallest = Math.min(...[...slots, ...(armSlot > 0 ? [armSlot] : [])].filter((x) => x > 0));
  const box = glbBox(join(p.root, b.out, "body.glb"));
  return { def, m, material, holes, clearance, smallest: Number.isFinite(smallest) ? smallest : undefined, corner: Number(c.corner_radius ?? DEFAULTS.corner_radius), box, carbon: /carbon/i.test(material) };
}

export const workOrder: SectionFn = ({ project: p, unit, release }: SectionContext) => {
  const plates = providerModules(p, unit, PROVIDER).filter((b) => b.process === "cut");
  if (!plates.length) return undefined;
  const builds = unit.perProduct * release.build;
  const blocks: Block[] = [{ kind: "paragraph", text: "Plates cut from sheet on a CNC router. Send the shop the DXF (one layer per profile) and the STEP for reference, with the values below. Quantities are for every build of this unit; order the shop's minimum or a spare if a plate is critical." }];
  for (const b of plates) {
    const o = cutOrder(p, b);
    const per = perBuild(unit, o.def.id);
    const layers = o.m.layers ?? [];
    blocks.push({ kind: "heading", text: o.def.name ?? o.def.id });
    blocks.push({
      kind: "keyvalues",
      rows: [
        { label: "Process", value: "CNC routing from sheet", note: `${b.config}: process cut` },
        { label: "Material", value: o.material || "not stated in the model: state it on the order" },
        ...Object.entries(o.m.thickness_mm ?? {}).map(([k, t]) => ({ label: `Stock: ${k}`, value: `${t} mm sheet`, note: "a stock thickness the shop lists; check before ordering" })),
        ...(o.box ? [{ label: "Plate size", value: `${n(o.box.size[0])} × ${n(o.box.size[1])} mm overall`, note: "bounding box of the body, clamps included; nest on the shop's sheet" }] : []),
        { label: "Quantity", value: layers.map((l) => `${(o.m.quantities?.[l] ?? 1) * per * builds} × ${l}`).join(", ") || `${per * builds}`, note: `${per} per build × ${builds} build${builds === 1 ? "" : "s"}` },
        ...[...o.holes].map(([d, count]) => ({ label: `Holes M${n(d)}`, value: `Ø${n(d + 2 * o.clearance, 2)} mm, ${count} per plate`, note: `fastener + 2 × ${o.clearance} mm clearance (hole_clearance_mm); hold the routing tolerance inside it` })),
        ...(o.smallest ? [{ label: "Router bit", value: `≤ ${n(o.smallest)} mm`, note: `the narrowest slot; inside corners take the bit's radius (outline corners ${o.corner} mm)` }] : []),
        { label: "Files", value: `files/mechanical/${o.def.id}/${o.def.id}.dxf (layers ${layers.join(", ") || "—"}), ${o.def.id}.step` },
        ...(o.m.notInDxf ?? []).map((x) => ({ label: "Not in the DXF", value: x, note: "agree with the shop how it is made, and record it" })),
        { label: "Edges", value: o.carbon ? "chamfer or sand every edge and hole, then seal the cut edges (thin CA or epoxy)" : "deburr every edge and hole", ...(o.carbon ? { note: "carbon edges fray and cut wires" } : {}) },
        { label: "Marking", value: "the release version on each plate" },
      ],
    });
  }
  return { title: "Cut parts", order: 30, blocks };
};

export const testPlan: SectionFn = ({ project: p, unit }: SectionContext) => {
  const plates = providerModules(p, unit, PROVIDER).filter((b) => b.process === "cut");
  if (!plates.length) return undefined;
  const rows = plates.flatMap((b) => {
    const o = cutOrder(p, b);
    const name = o.def.name ?? o.def.id;
    return [
      ...[...o.holes].map(([d]) => ({ check: `Hole size M${n(d)}: ${name}`, how: `Pin gauge Ø${n(d + 2 * o.clearance, 2)} mm`, pass: `every M${n(d)} hole takes the gauge; the screw passes without force` })),
      { check: `Edges: ${name}`, how: "Visual and by touch", pass: o.carbon ? "edges chamfered or sanded and sealed; no fraying or delamination" : "no burrs" },
      { check: `Edge distance: ${name}`, how: "Visual around every hole", pass: "no breakout or crack between a hole and the edge" },
    ];
  });
  return {
    title: "Cut parts",
    order: 30,
    blocks: [
      { kind: "paragraph", text: "With the first-article inspection, before the plates are used: what the cut order asked for.", keep: true },
      { kind: "table", columns: [{ key: "check", label: "Check" }, { key: "how", label: "How" }, { key: "pass", label: "Pass" }], rows },
    ],
  };
};
