/**
 * The spec sheet of one Manufacturing Package unit (`package:spec`): what is
 * made for the unit, from the capability providers' standard outputs and
 * the model. One part per custom module the unit builds:
 *
 *   - a board (circuit): layers, thickness, size, components by side, nets
 *     and rails, mounting holes, files;
 *   - a mechanical part (cad): process, material, size, volume, printed or
 *     cut bodies, the features that carry its interfaces, files;
 *   - a cable (cad on a harness): conductors, gauge, length and routed
 *     length, bundle, bend radius, terminations at each end.
 *
 * Each has a line-art figure of its GLB standard output. The release's own
 * spec (identity, contents, interfaces) comes before it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleDef } from "@deltarobotics/uhd";
import { IDENTITY, netVoltageRange } from "@deltarobotics/uhd";
import { parseCsv, type CapabilityBinding, type Project } from "@protoboardai/core";
import type { Block, SectionContext, SectionContribution, SectionFn } from "@protoboardai/ext-release";
import { classify, cutList, fileGroup, glbBox, includedWith, inUnit, moduleFiles, perBuild, readOutput, unitModules } from "@protoboardai/ext-release/helpers";
import { projectPath } from "../render/server.ts";
import { slug } from "./common.ts";

const n = (v: number, d = 1) => String(Number(v.toFixed(d)));
const size3 = (s: number[]) => `${n(s[0])} × ${n(s[1])} × ${n(s[2])} mm`;
const params = (def: ModuleDef, type: string, kind?: string) =>
  (def.traits ?? []).find((t) => t.type === type && (!kind || (t.params as Record<string, unknown> | undefined)?.kind === kind))?.params as Record<string, unknown> | undefined;

interface CadManifest {
  volume_mm3?: number;
  bodies?: Record<string, number>;
  features?: Record<string, unknown>;
  material?: string;
  process?: string;
  manufacturing?: { thickness_mm?: Record<string, number>; quantities?: Record<string, number>; layers?: string[] };
  length_mm?: number;
  route_length_mm?: number;
  conductor_lengths_mm?: number[];
  bundle?: { kind?: string; conductors?: number; conductor_od_mm?: number; bundle_od_mm?: number; twist_pitch_mm?: number };
  bend_radius_mm?: { target?: number; minimum?: number; centreline?: number };
  ends?: Record<string, { counterpart?: string; termination?: string; link?: string }>;
}

export const spec: SectionFn = async (s) => {
  const { project: p, unit: u } = s;
  const out: SectionContribution[] = [];
  const bound = unitModules(p, u);
  if (!bound.length) return undefined;
  const made = bound.filter((b) => classify(p, p.definitions.get(b.module!)!.def).action === "fabricate").length;
  const blocks: Block[] = [
    {
      kind: "paragraph",
      text: `${bound.length} part${bound.length === 1 ? " of this unit is" : "s of this unit are"} designed in the project${made < bound.length ? ` (${made} made, ${bound.length - made} bought or included, routed and cut to length here)` : ""}. Facts below are read from each provider's standard outputs (out/) and the model; figures are drawn from the GLB output. Manufacturing files are in files/ of this unit's folder.`,
    },
  ];
  const cables: CapabilityBinding[] = [];
  for (const b of bound) {
    const def = p.definitions.get(b.module!)?.def;
    if (!def) continue;
    const group = fileGroup(p, b);
    if (group === "harnesses") {
      cables.push(b);
      continue;
    }
    if (group === "firmware") {
      const files = moduleFiles(s.files, u, def.id).filter((f) => f.role === "firmware-config");
      blocks.push({ kind: "heading", text: `${def.name ?? def.id}: firmware configuration` });
      blocks.push({
        kind: "keyvalues",
        rows: [
          { label: "Designed by", value: `${b.provider} (${b.capability})`, note: b.config },
          ...(files.length ? [{ label: "Files", value: [...new Set(files.map((f) => inUnit(u, f.path).split("/").slice(0, 3).join("/") + "/"))].join(", "), note: `${files.length} file(s): the board definition and configuration the firmware builds against` }] : []),
        ],
      });
      continue;
    }
    blocks.push({ kind: "heading", text: `${def.name ?? def.id}` });
    const fig = await figureOf(p, s, b, group);
    if (fig) blocks.push(fig);
    const rows = [
      { label: "Module", value: def.id, note: `${perBuild(u, def.id)} per build` },
      { label: "Supply", value: supply(p, def) },
      { label: "Designed by", value: `${b.provider} (${b.capability}${b.process ? `, ${b.process}` : ""})`, note: b.config },
      ...(group === "boards" ? boardFacts(p, b, def) : mechanicalFacts(p, b, def)),
    ];
    const files = [...new Set(moduleFiles(s.files, u, def.id).map((f) => inUnit(u, f.path).split("/").slice(0, 3).join("/") + "/"))];
    if (files.length) rows.push({ label: "Files", value: files.join(", "), note: `${moduleFiles(s.files, u, def.id).length} file(s) from the standard outputs` });
    blocks.push({ kind: "keyvalues", rows });
  }
  if (cables.length) {
    // cables: one table, and their routed shapes as a strip of thumbnails
    blocks.push({ kind: "heading", text: `Cables (${cables.length})` });
    const items = [];
    for (const b of cables) {
      const def = p.definitions.get(b.module!)!.def;
      const th = existsSync(join(p.root, b.out, "body.glb"))
        ? await s.figure(`made-${slug(b.module!)}`, { width: 480, height: 360, mode: "lineart", lineScale: 1.25, bodies: [{ key: b.module!, glb: projectPath(`${b.out}/body.glb`), matrix: IDENTITY, style: "accent", category: "generic" }], camera: { dir: [0.5, -0.8, 1.2], margin: 0.08 } })
        : undefined;
      items.push({ name: def.name ?? def.id, quantity: perBuild(u, def.id), ref: def.id, ...(th ? { image: th.file } : { placeholder: "not routed" }) });
    }
    blocks.push({ kind: "kit", items, note: "Each cable as routed in the assembly (ext-harness-cad's body.glb), not to scale." });
    blocks.push({
      kind: "table",
      columns: [{ key: "cable", label: "Cable" }, { key: "supply", label: "Supply" }, { key: "cond", label: "Conductors" }, { key: "len", label: "Length" }, { key: "route", label: "Routed" }, { key: "bend", label: "Min bend" }, { key: "ends", label: "Ends" }],
      rows: cables.map((b) => cableRow(p, b, p.definitions.get(b.module!)!.def)),
      note: "Length: the installed length the model states (supplied length where it is cut down); routed: the centreline of the routed CAD; min bend: the smallest allowed bend radius. Cut lists are in files/harnesses/<cable>/cut-list.csv.",
    });
  }
  out.push({ title: "Designed for this unit", order: 10, blocks });
  return out;
};

function supply(p: Project, def: ModuleDef): string {
  const c = classify(p, def);
  if (c.action === "fabricate") return `made: ${c.process}`;
  if (c.action === "included") return `ships with ${includedWith(def)}; the model gives its route and cut length`;
  return "bought";
}

async function figureOf(p: Project, s: SectionContext, b: CapabilityBinding, group: string): Promise<Block | undefined> {
  const file = group === "boards" ? "board.glb" : "body.glb";
  if (!existsSync(join(p.root, b.out, file))) return undefined;
  const cable = group === "harnesses";
  const r = await s.figure(`made-${slug(b.module!)}`, {
    width: 1600,
    height: 900,
    mode: "lineart",
    bodies: [{ key: b.module!, glb: projectPath(`${b.out}/${file}`), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], style: cable ? "accent" : "normal", category: group === "boards" ? "fc" : "generic" }],
    camera: { dir: group === "boards" ? [0.6, -0.9, 1.6] : cable ? [0.5, -0.8, 1.2] : [0.8, -1, 1.4], margin: 0.08 },
  });
  return { kind: "image", file: r.file, width: r.width, height: r.height, size: "small", caption: `${b.module}: ${b.out}/${file}${cable ? " (routed in the assembly)" : ""}.` };
}

function boardFacts(p: Project, b: CapabilityBinding, def: ModuleDef) {
  const c = b.constraints as { layers?: number; thickness_mm?: number; outline?: { circle?: { diameter_mm: number }; rect?: { width_mm: number; height_mm: number } }; mounting_holes?: unknown[] };
  const rows: { label: string; value: string; note?: string }[] = [];
  const box = glbBox(join(p.root, b.out, "board.glb"));
  if (c.layers || c.thickness_mm) rows.push({ label: "Board", value: `${c.layers ?? "?"} copper layers, ${c.thickness_mm ?? "?"} mm`, note: "circuit.config.ts constraints" });
  const outline = c.outline?.circle ? `round, Ø${c.outline.circle.diameter_mm} mm` : c.outline?.rect ? `${c.outline.rect.width_mm} × ${c.outline.rect.height_mm} mm` : undefined;
  if (outline || box) rows.push({ label: "Outline", value: outline ?? `${n(box!.size[0])} × ${n(box!.size[1])} mm`, ...(box ? { note: `with components: ${size3(box.size)} (board.glb)` } : {}) });
  const pnp = readCsv(p, b, "pnp.csv");
  if (pnp.length) {
    const sides = new Map<string, number>();
    for (const r of pnp) sides.set(r.side || "top", (sides.get(r.side || "top") ?? 0) + 1);
    rows.push({ label: "Components", value: `${pnp.length} placed`, note: [...sides].map(([k, v]) => `${v} ${k}`).join(", ") + " (pnp.csv)" });
  } else rows.push({ label: "Components", value: `${def.children?.length ?? 0} in the model` });
  const nets = def.interfaces.filter((i) => i.protocols.some((x) => x.type === "net"));
  const rails = nets.map((i) => ({ i, r: netVoltageRange(i) })).filter((x) => x.r && x.r[1] > 0);
  if (nets.length) rows.push({ label: "Nets", value: `${nets.length}`, note: rails.length ? `rails ${rails.map((x) => `${x.i.name ?? x.i.id} ${x.r![0] === x.r![1] ? `${x.r![0]} V` : `${x.r![0]}–${x.r![1]} V`}`).join(", ")}` : undefined });
  if (c.mounting_holes?.length) rows.push({ label: "Mounting holes", value: String(c.mounting_holes.length) });
  const edge = (def.exports ?? []).map((e) => e.name ?? e.id);
  if (edge.length) rows.push({ label: "Board edge", value: edge.join(", ") });
  return rows;
}

function mechanicalFacts(p: Project, b: CapabilityBinding, def: ModuleDef) {
  const m = readOutput<CadManifest>(p, b, "body.manifest.json") ?? {};
  const rows: { label: string; value: string; note?: string }[] = [];
  const mech = def.domains?.find((d) => d.domain === "mechanical") as { material?: string | { name?: string; density_g_cm3?: number } } | undefined;
  const mat = (b.constraints as { material?: string }).material ?? m.material ?? mech?.material;
  const material = typeof mat === "object" ? mat?.name : mat;
  if (material) rows.push({ label: "Material", value: String(material), ...(typeof mat === "object" && mat?.density_g_cm3 ? { note: `${mat.density_g_cm3} g/cm³` } : {}) });
  const box = glbBox(join(p.root, b.out, "body.glb"));
  if (box) rows.push({ label: "Overall size", value: size3(box.size), note: "bounding box of body.glb" });
  const t = m.manufacturing?.thickness_mm;
  if (t) rows.push({ label: "Thickness", value: Object.entries(t).map(([k, v]) => `${k} ${v} mm`).join(", ") });
  const density = typeof mat === "object" ? mat?.density_g_cm3 : undefined;
  if (m.volume_mm3) rows.push({ label: "Volume", value: `${n(m.volume_mm3 / 1000, 2)} cm³${density ? ` (${n((m.volume_mm3 / 1000) * density, 1)} g)` : ""}`, ...(m.bodies ? { note: Object.entries(m.bodies).map(([k, v]) => `${k} ${n(v / 1000, 2)} cm³`).join(", ") } : {}) });
  const q = m.manufacturing?.quantities;
  if (q) rows.push({ label: "Pieces", value: Object.entries(q).map(([k, v]) => `${v} × ${k}`).join(", ") });
  const features = Object.keys(m.features ?? {});
  if (features.length) {
    const named = features.map((f) => def.interfaces.find((i) => i.id === f)?.name ?? f);
    rows.push({ label: "Interface features", value: String(features.length), note: named.join(", ") });
  }
  return rows;
}

function cableRow(p: Project, b: CapabilityBinding, def: ModuleDef) {
  const m = readOutput<CadManifest>(p, b, "body.manifest.json") ?? {};
  const cable = params(def, "performance", "cable") ?? {};
  const cut = cutList(def);
  const c = classify(p, def);
  return {
    cable: def.name ?? def.id,
    supply: c.action === "fabricate" ? "made" : c.action === "included" ? `with ${includedWith(def)}` : "bought",
    cond: [String(cut.length || m.bundle?.conductors || "?"), cable.wire_gauge_awg ? `${cable.wire_gauge_awg} AWG` : "", m.bundle?.kind ?? ""].filter(Boolean).join(" · "),
    len: typeof cable.length_mm === "number" ? `${cable.length_mm} mm${typeof cable.supplied_length_mm === "number" && cable.supplied_length_mm !== cable.length_mm ? ` (of ${cable.supplied_length_mm})` : ""}` : "",
    route: m.route_length_mm ? `${n(m.route_length_mm)} mm` : "",
    bend: m.bend_radius_mm?.minimum ? `${n(m.bend_radius_mm.minimum, 1)} mm` : "",
    ends: Object.entries(m.ends ?? {}).map(([, e]) => `${e.termination ?? "?"} to ${e.counterpart ?? "?"}`).join("; "),
  };
}

function readCsv(p: Project, b: CapabilityBinding, file: string): Record<string, string>[] {
  const f = join(p.root, b.out, file);
  if (!existsSync(f)) return [];
  const [header = [], ...rows] = parseCsv(readFileSync(f, "utf8")).rows;
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

