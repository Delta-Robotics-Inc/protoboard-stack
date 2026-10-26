/**
 * The release's own contributions to every section, derived from the model
 * and the collected files only. Other extensions add to the same sections
 * (the circuit provider's board fabrication orders, ext-harness-cad's harness
 * operations, ext-drone's flight-controller configuration); these are the
 * parts every project has.
 */
import { sectionBom } from "./bom.ts";
import { unitPlan } from "@protoboardai/ext-docs/plan";
import { grams, unitDef, unitMass } from "./model.ts";
import { testPlanSection } from "./testplan.ts";
import { workOrderSection } from "./workorder.ts";
import { resolveExports, type InterfaceDef } from "@deltarobotics/uhd";
import { classify, originLabel, unitBom } from "../bom.ts";
import { num } from "../util.ts";
import type { Block, SectionFn, Unit } from "../types.ts";

const EXTENSION = "@protoboardai/ext-release";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Voltage, current and clock an interface states ("5 V · 2 A"). */
function rating(i: InterfaceDef): string {
  const out: string[] = [];
  for (const p of i.parameters ?? []) {
    const v = p.value !== undefined ? num(p.value) : p.range ? `${num(p.range[0])}–${num(p.range[1])}` : undefined;
    if (v === undefined) continue;
    if (p.id === "voltage") out.push(`${v} V`);
    else if (p.id === "max_current") out.push(`${v} ${p.unit === "mA" ? "mA" : "A"} max`);
    else if (p.id === "clock_freq") out.push(`${p.value !== undefined && p.value >= 1e6 ? `${num(p.value / 1e6)} MHz` : p.value !== undefined ? `${num(p.value / 1e3)} kHz` : v}`);
    else if (p.id === "i2c_address" && p.value !== undefined) out.push(`0x${p.value.toString(16).toUpperCase().padStart(2, "0")}`);
  }
  return out.join(" · ");
}
const unitRef = (u: Unit) => (u.kind === "root" ? "system/" : `${u.folder}/`);

// ---------------------------------------------------------------------------
// spec
// ---------------------------------------------------------------------------

export const spec: SectionFn = ({ project: p, unit: u, units }) => {
  const def = unitDef(p, u);
  const rows = unitBom(p, u);
  const leaves = rows.filter((r) => r.action !== "build");
  const mass = unitMass(p, u);
  const custom = rows.filter((r) => r.action === "fabricate");
  const blocks: Block[] = [];
  if (def.description) blocks.push({ kind: "paragraph", text: def.description });
  blocks.push({
    kind: "figures",
    items: [
      { label: u.kind === "root" ? "Builds" : "Per product", value: u.kind === "root" ? "1" : `× ${u.perProduct}`, sub: u.kind === "root" ? "the product" : `assembled into ${u.parents.join(", ")}` },
      { label: "Parts per build", value: String(leaves.reduce((s, r) => s + r.qty_per_unit, 0)), sub: plural(new Set(leaves.map((r) => r.definition)).size, "line item") },
      { label: "Mass", value: mass.totalG ? grams(mass.totalG) : "—", sub: mass.missing.length ? `${plural(mass.missing.length, "instance")} without a mass not counted` : mass.assumedG ? `${grams(mass.assumedG)} from assumed materials` : "stated weights and CAD volume" },
      { label: "Made here", value: String(custom.length), sub: custom.length ? custom.map((r) => r.item).join(", ") : "no custom parts" },
    ],
  });
  const o = originLabel(p, def.id);
  blocks.push({ kind: "heading", text: "Identity" });
  blocks.push({
    kind: "keyvalues",
    rows: [
      { label: "Module", value: def.id },
      ...(u.kind !== "root" ? [{ label: u.kind === "module" ? "Every instance of" : "Instance", value: u.kind === "module" ? def.id : u.representative, note: u.kind === "module" ? u.instances.join(", ") : undefined }] : []),
      ...(def.manufacturer ? [{ label: "Manufacturer", value: def.manufacturer }] : []),
      ...(def.part_number ? [{ label: "Part number", value: def.part_number }] : []),
      ...(def.version ? [{ label: "Version", value: def.version }] : []),
      { label: "Source", value: `${o.tier} · ${o.origin}` },
    ],
  });
  blocks.push({ kind: "heading", text: "What one build contains" });
  blocks.push({
    kind: "table",
    columns: [
      { key: "item", label: "Item" },
      { key: "qty", label: "Qty", align: "right" },
      { key: "kind", label: "Kind" },
      { key: "ref", label: "Instance" },
    ],
    rows: u.members.filter((m) => m.depth === 0).map((m) => ({ item: m.name, qty: m.quantity, kind: m.unit ? `unit ${m.unit}` : classify(p, p.lookup(m.definition)!).kind, ref: m.path })),
  });
  const exported = new Map<string, InterfaceDef>();
  try {
    for (const e of resolveExports(def, p.lookup)) {
      const i = e.childDef.interfaces.find((x) => x.id === e.from.interfaceId);
      if (i) exported.set(e.id, i);
    }
  } catch {
    // an unresolvable export is reported by protoboard check
  }
  const boundary = [
    ...def.interfaces.filter((i) => i.exposed !== false).map((i) => ({ id: i.id, name: i.name ?? i.id, what: [i.domain, ...(i.protocols ?? []).map((x) => x.type)].filter(Boolean).join(" · "), rating: rating(i) })),
    ...(def.exports ?? []).map((e) => ({ id: e.id, name: e.name ?? e.id, what: `${exported.get(e.id)?.protocols.map((x) => x.type).join(" · ") ?? ""} from ${"child" in e.from ? `${e.from.child}:` : ""}${e.from.interfaceId}`.trim(), rating: exported.has(e.id) ? rating(exported.get(e.id)!) : "" })),
  ];
  if (boundary.length) {
    blocks.push({ kind: "heading", text: "Interfaces to the rest of the product" });
    blocks.push({ kind: "table", columns: [{ key: "id", label: "Interface" }, { key: "name", label: "Name" }, { key: "what", label: "Kind / source" }, { key: "rating", label: "Rating" }], rows: boundary, note: "Ratings are the model's values for the interface (voltage, current, bus clock); an empty cell means the model states none." });
  }
  if (u.kind === "root" && units.length > 1) {
    blocks.push({ kind: "heading", text: "Units" });
    blocks.push({ kind: "table", columns: [{ key: "unit", label: "Unit" }, { key: "name", label: "Module" }, { key: "qty", label: "Per product", align: "right" }, { key: "folder", label: "Folder" }], rows: units.map((x) => ({ unit: x.id, name: x.name, qty: x.perProduct, folder: unitRef(x) })) });
  }
  if (mass.missing.length) blocks.push({ kind: "note", level: "tip", text: `Mass leaves out ${mass.missing.map((e) => e.path).slice(0, 8).join(", ")}${mass.missing.length > 8 ? ", …" : ""}: the model states no weight or material for them.` });
  return { blocks };
};

// ---------------------------------------------------------------------------
// bom
// ---------------------------------------------------------------------------

export const bom: SectionFn = (ctx) => sectionBom(ctx);

// ---------------------------------------------------------------------------
// work order (./workorder.ts) and test plan (./testplan.ts)
// ---------------------------------------------------------------------------

export const workOrder: SectionFn = (ctx) => workOrderSection(ctx);
export const testPlan: SectionFn = (ctx) => testPlanSection(ctx);

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/**
 * Plain steps from the same plan as the work order (ext-docs' unitPlan: the
 * order, parts, actions, soldering of parts that ship with loose connectors,
 * and connection tables), so "Assembly guide step N" in the work order is
 * step N here. A richer contributor (ext-docs: the same steps illustrated)
 * replaces it.
 */
export const assembly: SectionFn = async ({ project: p, unit: u, contributors }) => {
  if (contributors.some((c) => c !== EXTENSION)) return undefined;
  const rows = unitBom(p, u);
  const kit = rows.filter((r) => r.level === 0 || r.kind === "unit");
  const { steps: planned } = await unitPlan(p, u);
  const blocks: Block[] = [
    { kind: "heading", text: "Kit" },
    { kind: "paragraph", text: `Check every item against the bill of materials (bom.pdf) before starting.${u.members.some((m) => m.unit) ? " Bring the finished sub-units listed; each has its own folder in this package." : ""}` },
    { kind: "kit", items: kit.map((r) => ({ name: r.item, quantity: r.qty_per_unit, ref: r.path })) },
  ];
  const steps: Extract<Block, { kind: "steps" }>["steps"] = planned.map((st) => ({
    title: st.title,
    actions: st.actions,
    ...(st.parts.length ? { parts: st.parts.map((pt) => ({ name: pt.def.name ?? pt.def.id, quantity: pt.count, ref: pt.def.id })) } : {}),
    ...(st.connections.length
      ? {
          table: {
            columns: [{ key: "name", label: "Link" }, { key: "from", label: "From" }, { key: "to", label: "To" }, { key: "x", label: "" }, { key: "term", label: "Termination" }],
            rows: st.connections.map((c) => ({ name: c.name, from: c.from, to: c.to, x: c.crossover ? "× crossover" : "", term: c.termination })),
          },
        }
      : {}),
    ...(st.torque ? { torque: st.torque } : {}),
    ...(st.tools.length ? { tools: st.tools } : {}),
    ...(st.materials.length ? { materials: st.materials } : {}),
    ...(st.notes.length ? { notes: st.notes } : {}),
    trace: st.trace,
  }));
  if (steps.length) blocks.push({ kind: "heading", text: "Steps" }, { kind: "steps", steps });
  else blocks.push({ kind: "paragraph", text: "This unit makes no joints: its parts are used as they come." });
  return { blocks };
};

export const BASELINE: Record<string, SectionFn> = { spec, bom, "work-order": workOrder, assembly, "test-plan": testPlan };
