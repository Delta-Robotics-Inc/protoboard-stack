/**
 * Contributions to the Manufacturing Package (@protoboardai/ext-release section
 * contract) for the boards this provider designs: each board's fabrication
 * and assembly order in its unit's work order. The fab profile (layers,
 * thickness, copper, finish, solder mask, silkscreen) comes from
 * circuit.config.ts, with the defaults below stated as such; the stack-up
 * follows from the layer count and thickness; the assembly sides and
 * placements from out/pnp.csv; leadless packages (which want a flat finish,
 * a stencil and X-ray inspection) from the parts' package facts; the files
 * are the standard outputs.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { boardNetlist, boardOptions, parseCsv, type CapabilityBinding, type Project } from "@protoboardai/core";
import type { Block, SectionContext, SectionFn } from "@protoboardai/ext-release";
import { perBuild, providerModules } from "@protoboardai/ext-release/helpers";
import { viasInPads } from "../lib/checks.ts";
import { boardLands } from "../lib/footprints.ts";
import { readNative, readOverrides } from "../lib/native.ts";

const PROVIDER = "@protoboardai/ext-tscircuit";
/** Package names (as the maker states them) with joints under the body. */
const LEADLESS = /QFN|DFN|LGA|BGA|CSP|\bW?SON\b/i;

export interface FabProfile {
  layers: number;
  thickness_mm: number;
  copper: string;
  finish: string;
  finishWhy: string;
  mask: string;
  silk: string;
  assembly: "fab" | "hand";
  /** Notes for the fabricator: the provider's own (a hold while land patterns are unverified, via-in-pad fill), then circuit.config.ts's. */
  notes: string[];
  /** How many of `notes` are the provider's own (they come first). */
  ownNotes: number;
  /** Land patterns the board uses, and those not verified against their makers' drawings (entry id: instances). */
  lands: { total: number; unverified: string[] };
  /** Vias inside SMD pads in the built board, and what the config says about them. */
  viaInPad: { count: number; policy: "avoid" | "fill_and_cap" };
  leadless: string[];
  sides: Record<string, number>;
  placed: number;
  gerbers: string[];
  drills: string[];
}

/** The fabrication and assembly profile of one board: its config, its parts and its standard outputs. */
export function fabProfile(p: Project, b: CapabilityBinding): FabProfile {
  const c = b.constraints as { layers?: number; thickness_mm?: number; copper_oz?: number; finish?: string; solder_mask?: string; silkscreen?: string; assembly?: "fab" | "hand"; fab_notes?: string[]; via_in_pad?: "avoid" | "fill_and_cap" };
  const def = p.definitions.get(b.module!)!.def;
  const netlist = boardNetlist(def, p.lookup, boardOptions(p));
  const lands = boardLands(netlist.components, b.native ? readOverrides(p.root, b.native).overrides : {});
  const unverified = lands.filter((l) => l.problems.length).map((l) => `${l.entry.id} (${l.instances.join(", ")})`);
  const native = b.native ? readNative(p.root, b.native) : undefined;
  const viaCount = native ? viasInPads(native.circuitJson).length : 0;
  const policy = c.via_in_pad ?? "avoid";
  const own: string[] = [];
  if (unverified.length)
    own.push(`HOLD: do not order this revision. ${unverified.length} of ${lands.length} land patterns are not verified against the makers' recommended land patterns (circuit:check CIRCUIT_FOOTPRINT_UNVERIFIED): ${unverified.join("; ")}.`);
  if (viaCount && policy === "fill_and_cap") own.push(`Vias in pads (${viaCount}): fill with non-conductive epoxy and cap-plate them flat (IPC-4761 type VII), so they do not wick solder from the joints.`);
  const leadless = [...new Set(netlist.components.filter((x) => x.package?.name && LEADLESS.test(x.package.name)).map((x) => `${x.instance} (${x.package!.name})`))];
  const pnpFile = join(p.root, b.out, "pnp.csv");
  const sides: Record<string, number> = {};
  let placed = 0;
  if (existsSync(pnpFile)) {
    const [head = [], ...rows] = parseCsv(readFileSync(pnpFile, "utf8")).rows;
    const k = head.indexOf("side");
    for (const r of rows.filter((r) => r.length > 1)) {
      const side = (k >= 0 && r[k]) || "top";
      sides[side] = (sides[side] ?? 0) + 1;
      placed++;
    }
  }
  const gdir = join(p.root, b.out, "gerber");
  const g = existsSync(gdir) ? readdirSync(gdir).sort() : [];
  return {
    ownNotes: own.length,
    layers: c.layers ?? 2,
    thickness_mm: c.thickness_mm ?? 1.6,
    copper: c.copper_oz ? `${c.copper_oz} oz outer layers` : "1 oz outer layers (default: the fab's standard)",
    finish: c.finish ?? (leadless.length ? "ENIG" : "lead-free HASL"),
    finishWhy: c.finish ? "circuit.config.ts" : leadless.length ? `default: leadless packages want a flat finish (${leadless.length})` : "default: no leadless packages",
    mask: c.solder_mask ?? "green (default)",
    silk: c.silkscreen ?? "white (default)",
    assembly: c.assembly ?? "fab",
    notes: [...own, ...(c.fab_notes ?? [])],
    lands: { total: lands.length, unverified },
    viaInPad: { count: viaCount, policy },
    leadless,
    sides,
    placed,
    gerbers: g.filter((f) => !/\.(drl|xln)$/i.test(f)),
    drills: g.filter((f) => /\.(drl|xln)$/i.test(f)),
  };
}

function stackup(layers: number, t: number): { layer: string; what: string }[] {
  if (layers === 4)
    return [
      { layer: "Top copper", what: "signal, components" },
      { layer: "Prepreg", what: "" },
      { layer: "Inner 1", what: "copper" },
      { layer: "Core", what: "FR-4" },
      { layer: "Inner 2", what: "copper" },
      { layer: "Prepreg", what: "" },
      { layer: "Bottom copper", what: "signal" },
    ].map((x) => ({ ...x, what: x.what || `the fab's standard 4-layer build for ${t} mm` }));
  return [
    { layer: "Top copper", what: "signal, components" },
    { layer: "Core", what: `FR-4, ${t} mm finished board` },
    { layer: "Bottom copper", what: "signal" },
  ];
}

export const workOrder: SectionFn = ({ project: p, unit, release }: SectionContext) => {
  const boards = providerModules(p, unit, PROVIDER);
  if (!boards.length) return undefined;
  const builds = unit.perProduct * release.build;
  const blocks: Block[] = [];
  for (const b of boards) {
    const def = p.definitions.get(b.module!)!.def;
    const f = fabProfile(p, b);
    const qty = perBuild(unit, def.id) * builds;
    const sides = Object.entries(f.sides).map(([s, k]) => `${k} ${s}`).join(", ");
    blocks.push({ kind: "heading", text: def.name ?? def.id });
    blocks.push({
      kind: "keyvalues",
      rows: [
        { label: "Quantity", value: `${qty} board${qty === 1 ? "" : "s"}`, note: "for every build of this unit; fabs often have a minimum panel, order it" },
        { label: "Layers", value: `${f.layers} copper`, note: b.config },
        { label: "Thickness", value: `${f.thickness_mm} mm` },
        { label: "Copper", value: f.copper },
        { label: "Finish", value: f.finish, note: f.finishWhy },
        { label: "Solder mask / silkscreen", value: `${f.mask} / ${f.silk}` },
        { label: "Assembly", value: f.assembly === "fab" ? `by the fab: ${f.placed} placements${sides ? ` (${sides})` : ""}` : `by hand: ${f.placed} placements${sides ? ` (${sides})` : ""}`, note: Object.keys(f.sides).length > 1 ? "double-sided: two reflow passes" : "single-sided: one reflow pass" },
        { label: "Land patterns", value: f.lands.unverified.length ? `${f.lands.unverified.length} of ${f.lands.total} not verified` : `${f.lands.total} of ${f.lands.total} verified`, note: "against the makers' recommended land patterns (pads, pitch, holes and slots, courtyard, paste, mask)" },
        { label: "Vias in pads", value: f.viaInPad.count ? `${f.viaInPad.count}, ${f.viaInPad.policy === "fill_and_cap" ? "filled and capped (IPC-4761 type VII)" : "not allowed: check reports them"}` : "none" },
        ...(f.leadless.length ? [{ label: "Leadless packages", value: f.leadless.join(", "), note: "stencil paste; X-ray or careful inspection of the hidden joints" }] : []),
        { label: "Files", value: `files/boards/${def.id}/gerber/ (${f.gerbers.length} layers, ${f.drills.length} drill), bom.csv, pnp.csv, board.step` },
      ],
    });
    if (f.notes.length) blocks.push({ kind: "table", columns: [{ key: "n", label: "No.", align: "right" }, { key: "note", label: "Fabrication notes" }], rows: f.notes.map((note, i) => ({ n: i + 1, note })), caption: `${def.name ?? def.id}: fabrication notes`, note: f.ownNotes ? `${f.ownNotes === f.notes.length ? "the provider's own" : `the provider's own (${f.ownNotes}), then ${b.config}: fab_notes`}` : `${b.config}: fab_notes` });
    blocks.push({ kind: "table", columns: [{ key: "layer", label: "Stack-up" }, { key: "what", label: "" }], rows: stackup(f.layers, f.thickness_mm), caption: `${def.name ?? def.id}: stack-up` });
    blocks.push({
      kind: "list",
      items: [
        "Send the fab the Gerber and drill files with the values above and the fabrication notes; for assembly also bom.csv and pnp.csv (rows keyed by the model's instance paths; MPNs from the parts).",
        "Ask for the fab's DFM report before production and keep it with this release.",
        ...(f.assembly === "hand" ? ["Hand assembly: stencil and solder paste, place from pnp.csv, reflow; check each leadless part's joints."] : []),
      ],
    });
  }
  return { title: "Boards", order: 20, blocks };
};
