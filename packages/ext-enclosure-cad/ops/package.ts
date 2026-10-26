/**
 * Contributions to the Manufacturing Package (@protoboardai/ext-release section
 * contract) for the enclosures this provider designs: the print order of
 * each printed enclosure in its unit's work order (material, printer
 * profile, each part's orientation and supports, post-processing: supports
 * off, inserts set, light pipes filled), and the enclosure's own checks in
 * the test plan (seal squeeze, buttons, plugs, the lid joint, tight fits).
 *
 * The print order ends at the printed parts with their inserts set: the
 * O-rings, plungers and lid screws go in during assembly, once what the
 * enclosure holds is inside (the assembly guide's steps). When the enclosure
 * is a unit of its own, built before the unit it is assembled into, its test
 * plan keeps the checks a bare housing allows (a plug through its opening)
 * and the unit it goes into gets the ones that need it assembled (seals,
 * buttons, the lid joint, fits). Values
 * come from the module's features, its cad.config.ts and the build report
 * (build123d/<id>.report.json); the files are the standard outputs.
 */
import { join } from "node:path";
import type { CapabilityBinding, Project } from "@protoboardai/core";
import type { Block, SectionContext, SectionFn } from "@protoboardai/ext-release";
import { perBuild, providerModules } from "@protoboardai/ext-release/helpers";
import { nativePaths, readJson, type Report } from "../lib/check.ts";
import { glandRow } from "../lib/standards.ts";

const PROVIDER = "@protoboardai/ext-enclosure-cad";
/** Printer profile assumptions (stated in the order): the minimum print wall is two 0.4 mm extrusions (README). */
const NOZZLE_MM = 0.4;
const LAYER_MM = 0.2;
/** Widest side-wall opening printed without supports (a bridge); an assumption for a tuned FDM printer. */
const BRIDGE_MM = 10;

const n = (v: number, d = 1) => String(Number(v.toFixed(d)));

interface Enclosure {
  b: CapabilityBinding;
  name: string;
  id: string;
  report?: Report;
  constraints: { wall_mm?: number; material?: string; fasteners?: string };
  per: number;
}

export function enclosures(p: Project, unit: SectionContext["unit"]): Enclosure[] {
  return toEnclosures(p, unit, providerModules(p, unit, PROVIDER));
}

/** Enclosures built as units of their own and assembled into this unit (its sub-unit members). */
export function enclosuresAssembledIn(p: Project, unit: SectionContext["unit"]): Enclosure[] {
  const subs = new Set(unit.members.filter((m) => m.unit).map((m) => m.definition));
  return toEnclosures(p, unit, p.capabilities.filter((b) => !b.problem && b.module && b.provider === PROVIDER && subs.has(b.module)));
}

/** The enclosure is this unit's own module, assembled into another unit (its parents). */
const ownUnit = (unit: SectionContext["unit"], e: Enclosure) => unit.kind !== "root" && unit.definition === e.id && unit.parents.length > 0;

function toEnclosures(p: Project, unit: SectionContext["unit"], bs: CapabilityBinding[]): Enclosure[] {
  return bs.map((b) => {
    const def = p.definitions.get(b.module!)!.def;
    const report = b.native ? readJson<Report>(join(p.root, nativePaths(b.native, def.id).report)) : undefined;
    return { b, name: def.name ?? def.id, id: def.id, report, constraints: b.constraints as Enclosure["constraints"], per: perBuild(unit, def.id) };
  });
}

const sideways = (f: { frame?: { normal: number[] } }) => !!f.frame && Math.abs(f.frame.normal[2]) < 0.7;

function orientation(part: string, e?: Enclosure): string {
  // a twist lid states how its base and lid print without supports under their lock faces
  const twist = Object.values(e?.report?.features ?? {}).find((f) => f.kind === "twist_lid");
  const said = (twist?.print as Record<string, string> | undefined)?.[part];
  if (said) return said;
  if (part === "base") return "floor on the bed, open side up";
  if (part === "lid") return "outer face on the bed";
  if (part.startsWith("plunger")) return "flange on the bed";
  return "largest flat face on the bed";
}

function supports(e: Enclosure, part: string): string {
  const feats = Object.entries(e.report?.features ?? {}).filter(([, f]) => f.parts.includes(part) && sideways(f) && ["opening", "button", "light_pipe", "window"].includes(f.kind));
  const wide = feats.filter(([, f]) => {
    const size = (f.size_mm ?? f.aperture_mm) as number[] | undefined;
    const d = (f.hole_d_mm as number | undefined) ?? (size ? Math.max(size[0], size[1]) : 0);
    return d > BRIDGE_MM;
  });
  if (wide.length) return `under ${wide.map(([id]) => id).join(", ")} (wider than ${BRIDGE_MM} mm)`;
  return feats.length ? `none: ${feats.length} side-wall cut${feats.length === 1 ? "" : "s"} bridge ≤ ${BRIDGE_MM} mm` : "none";
}

export const workOrder: SectionFn = ({ project: p, unit, release }: SectionContext) => {
  const es = enclosures(p, unit).filter((e) => e.b.process === "print");
  if (!es.length) return undefined;
  const builds = unit.perProduct * release.build;
  const blocks: Block[] = [];
  for (const e of es) {
    const wall = e.constraints.wall_mm;
    const perimeters = wall ? Math.max(2, Math.round(wall / (NOZZLE_MM + 0.05))) : undefined;
    const parts = Object.entries(e.report?.parts ?? {});
    blocks.push({ kind: "heading", text: e.name });
    blocks.push({
      kind: "keyvalues",
      rows: [
        { label: "Process", value: "FDM printing", note: `${e.b.config}: process print` },
        { label: "Material", value: e.constraints.material ?? "not stated: state it on the order (cad.config.ts material)" },
        { label: "Profile", value: `${NOZZLE_MM} mm nozzle, ${LAYER_MM} mm layers${perimeters ? `, ${perimeters} perimeters (walls ${wall} mm)` : ""}, solid infill`, note: "assumption: the design's 0.8 mm minimum wall is two 0.4 mm extrusions; walls this thin print as perimeters only" },
        { label: "Quantity", value: `${e.per * builds} set${e.per * builds === 1 ? "" : "s"} of ${parts.length || "?"} part${parts.length === 1 ? "" : "s"}`, note: `${e.per} per build × ${builds}` },
        ...(e.report?.overall ? [{ label: "Overall", value: [0, 1, 2].map((k) => n(e.report!.overall.max[k] - e.report!.overall.min[k])).join(" × ") + " mm" }] : []),
      ],
    });
    if (parts.length)
      blocks.push({
        kind: "table",
        columns: [{ key: "part", label: "Part" }, { key: "vol", label: "Volume", align: "right" }, { key: "orient", label: "Orientation" }, { key: "sup", label: "Supports" }, { key: "file", label: "File" }],
        rows: parts.map(([k, v]) => ({ part: k, vol: `${n(v.volume_mm3 / 1000, 2)} cm³`, orient: orientation(k, e), sup: supports(e, k), file: `files/mechanical/${e.id}/${k}.3mf` })),
        caption: `${e.name}: parts`,
      });
    const def = p.definitions.get(e.id)!.def;
    const post: string[] = ["Remove brim and any supports; deburr every opening and bore."];
    let inserts = 0;
    let insertName = "";
    for (const f of Object.values(e.report?.features ?? {})) {
      const ins = f.insert as { name?: string } | undefined;
      if (f.kind === "boss") {
        inserts += (f.holes as unknown[] | undefined)?.length ?? 0;
        insertName ||= ins?.name ?? "";
      }
      if (f.kind === "joint" && Array.isArray(f.columns)) {
        inserts += f.columns.length;
        insertName ||= ins?.name ?? "";
      }
    }
    if (inserts) post.push(`Set ${inserts} heat-set insert${inserts === 1 ? "" : "s"}${insertName ? ` (${insertName})` : ""} with a soldering iron and insert tip at the material's insert temperature; each flush and square.`);
    // light pipes the module says are filled after printing (LightPipe fill)
    const fills = new Map<string, string[]>();
    for (const [id, f] of Object.entries(e.report?.features ?? {}).filter(([, f]) => f.kind === "light_pipe")) {
      const fill = featureParams(def, id)?.fill;
      if (typeof fill === "string") fills.set(fill, [...(fills.get(fill) ?? []), id]);
    }
    for (const [fill, ids] of fills) post.push(`Fill the ${ids.length === 1 ? `${ids[0]} light pipe` : `${ids.length} light pipes (${ids.join(", ")})`} with ${fill}, flush with the outer face; cure fully before handling.`);
    // fitted during assembly, once the contents are in: named here so the print order does not do them
    const later: string[] = [];
    const glands = Object.values(e.report?.features ?? {}).filter((f) => f.kind === "seal_gland").map((f) => String(f.oring ?? "O-ring"));
    if (glands.length) later.push(`the O-ring${glands.length === 1 ? "" : "s"} (${glands.join(", ")})`);
    const plungers = Object.values(e.report?.features ?? {}).filter((f) => f.kind === "button").length;
    if (plungers) later.push(plungers === 1 ? "the button plunger" : `the ${plungers} button plungers`);
    const joint = Object.values(e.report?.features ?? {}).find((f) => f.kind === "joint" && f.screw);
    if (joint) later.push(`the lid and its ${Array.isArray(joint.columns) ? `${joint.columns.length} × ` : ""}${(joint.screw as { name?: string }).name ?? "screws"}`);
    const twist = Object.values(e.report?.features ?? {}).find((f) => f.kind === "twist_lid");
    if (twist) later.push(`the lid (${twist.lock === "bayonet" ? `a bayonet: ${twist.lugs} lugs, ${twist.twist_deg}° turn` : `threaded: ${twist.turns} turns at ${twist.pitch_mm} mm`})`);
    if (later.length) {
      const where = ownUnit(unit, e) ? `at assembly in ${unit.parents.map((x) => (x === "system" ? "final assembly (system/)" : `unit ${x} (units/${x}/)`)).join(", ")}` : "during assembly, once what the enclosure holds is inside (the assembly operations)";
      post.push(`Keep the parts open and unassembled: ${later.join(", ")} ${later.length === 1 && !/s$/.test(later[0]) ? "is" : "are"} fitted ${where}.`);
    }
    blocks.push({ kind: "list", items: post });
  }
  return { title: "Printed parts", order: 30, blocks };
};

export const testPlan: SectionFn = ({ project: p, unit }: SectionContext) => {
  // this unit's enclosures, and those built as sub-units and assembled here (their assembled checks are made here)
  const own = enclosures(p, unit).filter((e) => e.report);
  const es = [...own, ...enclosuresAssembledIn(p, unit).filter((e) => e.report)];
  if (!es.length) return undefined;
  const rows: { check: string; how: string; pass: string }[] = [];
  let bare = false;
  for (const e of es) {
    // a housing built as its own unit: only what a bare housing shows here; the rest where it is assembled
    const housingOnly = own.includes(e) && ownUnit(unit, e);
    const assembledOnly = !own.includes(e);
    bare ||= housingOnly;
    for (const [id, f] of Object.entries(e.report!.features)) {
      const needsAssembly = f.kind !== "opening";
      if ((housingOnly && needsAssembly) || (assembledOnly && !needsAssembly)) continue;
      if (f.kind === "seal_gland") {
        const w = f.w_mm as number;
        const depth = (f.gland_depth_mm as number) + ((f.gap_mm as number) ?? 0);
        const row = glandRow(f.type as "face" | "radial", w);
        rows.push({ check: `Seal ${id}: ${e.name}`, how: "Close the joint on the O-ring; inspect the squeeze line through the gap or by a witness mark", pass: `O-ring seated all round, not pinched; design squeeze ${n(((w - depth) / w) * 100)} %${row ? ` (${row.squeeze_pct[0]}–${row.squeeze_pct[1]} %, ${row.source})` : ""}` });
      }
      if (f.kind === "button") rows.push({ check: `Button ${id}: ${e.name}`, how: "Press the plunger; release", pass: `the switch actuates within the plunger's travel and the plunger returns${f.gap_mm !== undefined ? ` (design gap ${f.gap_mm} mm at rest)` : ""}` });
      if (f.kind === "opening" && f.plug) rows.push({ check: `Opening ${id}: ${e.name}`, how: `Insert ${(f.plug as { name?: string }).name ?? "the mating plug"}`, pass: "it goes fully home and the overmold seats against the wall" });
      if (f.kind === "joint") rows.push({ check: `Lid joint: ${e.name}`, how: "Close the lid and fit its screws", pass: "the lid closes flush all round; screws seat without bottoming in the inserts" });
      if (f.kind === "twist_lid")
        rows.push(
          f.lock === "bayonet"
            ? { check: `Lid joint: ${e.name}`, how: `Push the lid down with its lugs in the slots and turn it ${f.twist_deg}°; try to lift it; turn it back`, pass: `it seats on the rim and turns to the slots' ends by hand, features in the lid line up with what they serve, it cannot be lifted when turned, and it opens again; skirt bore Ø${f.bore_d_mm} mm` }
            : { check: `Lid joint: ${e.name}`, how: `Screw the lid down by hand (${f.turns} turns); unscrew it`, pass: `it runs without binding and seats on the rim; it comes off again; thread ${f.major_d_mm} mm × ${f.pitch_mm} mm` },
        );
    }
    if (housingOnly) continue;
    for (const b of e.report!.fit.bodies.filter((x) => x.status === "tight" || x.status === "collision"))
      rows.push({ check: `Fit of ${b.label}: ${e.name}`, how: "Assemble and look for contact", pass: `no contact${b.near ? ` near ${b.near}` : ""} (the design leaves ${b.min_clearance_mm !== undefined ? `${n(b.min_clearance_mm, 2)} mm` : "little clearance"} here)` });
  }
  if (!rows.length) return undefined;
  return {
    title: "Enclosure",
    order: 30,
    blocks: [
      {
        kind: "paragraph",
        text: bare
          ? `With the first-article inspection, on the bare housing; the seals, buttons, the lid joint and the fits are checked where it is assembled (${unit.parents.map((x) => (x === "system" ? "system/" : `units/${x}/`)).join(", ")}).`
          : "With the first-article inspection and again after final assembly: what the enclosure's design depends on.",
        keep: true,
      },
      { kind: "table", columns: [{ key: "check", label: "Check" }, { key: "how", label: "How" }, { key: "pass", label: "Pass" }], rows },
    ],
  };
};

/** The enclosure_feature parameters of one of the module's feature interfaces. */
function featureParams(def: { interfaces: { id: string; traits?: { type: string; params?: Record<string, unknown> }[] }[] }, id: string): Record<string, unknown> | undefined {
  return def.interfaces.find((i) => i.id === id)?.traits?.find((t) => t.type === "enclosure_feature")?.params;
}
