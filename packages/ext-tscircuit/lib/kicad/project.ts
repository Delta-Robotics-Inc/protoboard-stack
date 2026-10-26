/**
 * The KiCad project of a built board (docs/specs/pcb-kicad-handoff.md §2).
 *
 * tscircuit's own circuit-json-to-kicad writes the board, the schematic and
 * the project file from circuit.json. This module wraps it:
 *
 *   before   components are renamed to their reference designators (refdes.ts),
 *            and their bodies are set on the circuit JSON as circuit:export
 *            sets them (models.ts), so the converter places each 3D model
 *   after    the S-expressions are edited: footprints and symbols move to the
 *            project's own libraries (<b>.pretty, <b>.kicad_sym), 3D models
 *            to ${KIPRJMOD}/3d/, fields (MPN, manufacturer, LCSC, UHD identity)
 *            are set, each footprint is linked to its symbol, UUIDs are derived
 *            from the board and the instance paths, the copper layers, board
 *            thickness and stack-up follow the config, and the board frame's
 *            origin is KiCad's drill/place origin
 *
 * `kicad-cli pcb upgrade` / `sch upgrade` then save both in KiCad 10's own
 * format (upgrade.ts); without KiCad the converter's format is kept.
 */
import { createHash } from "node:crypto";
import { basename, isAbsolute, resolve } from "node:path";
import type { BoardNetlist } from "@protoboardai/core";
import { CircuitJsonToKicadPcbConverter, CircuitJsonToKicadProConverter } from "circuit-json-to-kicad";
import type { BoardConstraints, Keepout } from "../config.ts";
import type { CircuitElement } from "../runtime.ts";
import type { NameMap } from "../source.ts";
import { EXTRA_FIELDS, type ComponentFields } from "./fields.ts";
import { buildSchematic, type KicadPinType } from "./schematic.ts";
import { child, children, head, isList, isStr, list, parse, print, printDocument, propertyNode, str, text, type List, type Node } from "./sexpr.ts";

/** The converter places the board frame's origin here, with Y down (its c2kMatPcb). */
export const KICAD_ORIGIN: [number, number] = [100, 100];

export interface KicadProjectInput {
  /** Board module id: the file stem and the library name. */
  board: string;
  /** The built board, with bodies applied (cad_component.model_step_url: absolute STEP paths). */
  circuitJson: CircuitElement[];
  map: NameMap;
  netlist: BoardNetlist;
  /** instance → designator */
  refdes: Record<string, string>;
  /** instance → fields */
  fields: Record<string, ComponentFields>;
  constraints?: BoardConstraints;
  /** Absolute folder a relative model path is read from (the native folder: a cadModel in board.tsx). */
  modelBase?: string;
  /** Whether a model file can be used (exists, is a STEP file); a model that cannot is left off its footprint. */
  modelOk?: (abs: string) => boolean;
  /** Outer copper in oz (stack-up; default 1). */
  copperOz?: number;
  /** instance → leaf interface → KiCad electrical type, from the UHD leaf types (schematic.ts `kicadPinType`). */
  pinTypes?: Record<string, Record<string, KicadPinType>>;
}

/**
 * UUIDs renumbered in document order (the texts in the order given), except
 * those in `keep`: what KiCad or the converter made up becomes the same on
 * every export of the same board. References between the texts stay
 * consistent (the schematic's root UUID in the project file).
 */
export function stabiliseUuids(board: string, texts: string[], keep: Set<string>, salt = "n"): string[] {
  const renumber = new Map<string, string>();
  let n = 0;
  return texts.map((t) =>
    t.replace(UUID, (u) => {
      if (keep.has(u)) return u;
      if (!renumber.has(u)) renumber.set(u, stableUuid(board, `${salt}:${n++}`));
      return renumber.get(u)!;
    }),
  );
}

export interface KicadProject {
  /** Files relative to the KiCad folder. */
  files: Record<string, string>;
  /** 3D models to copy: path relative to the KiCad folder → absolute source. */
  models: Record<string, string>;
  /** Symbol UUID per instance (footprints link to it: Update PCB from Schematic). */
  symbols: Record<string, string>;
  /** The UUIDs derived from instance paths (symbols, footprints): kept when the files are renumbered again. */
  keep: Set<string>;
  notes: string[];
}

/** A UUID derived from the board and a key: the same board exports the same UUIDs. */
export function stableUuid(board: string, key: string): string {
  const h = createHash("sha256").update(`${board}\0${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A library item name KiCad accepts (no colon or slash). */
export const libItemName = (s: string) => s.replace(/[:/\\\s"]+/g, "_");

/** The library (footprint and symbol) of a board's project. */
export const libraryName = (board: string) => libItemName(board);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** The circuit JSON as the converter should see it: references for names, the part numbers on each component. */
function prepare(input: KicadProjectInput): { cj: CircuitElement[]; nameOf: Map<string, string> } {
  const nameOf = new Map<string, string>(); // refdes → tscircuit name
  const renamed = new Map<string, string>(); // tscircuit name → refdes
  for (const [name, m] of Object.entries(input.map.components)) {
    const r = input.refdes[m.instance];
    if (r) {
      renamed.set(name, r);
      nameOf.set(r, name);
    }
  }
  const pcbOfSource = new Map<string, string>();
  for (const e of input.circuitJson) if (e.type === "pcb_component") pcbOfSource.set(e.pcb_component_id, e.source_component_id);
  const sourceName = new Map(input.circuitJson.filter((e) => e.type === "source_component").map((s) => [s.source_component_id, s.name as string]));
  const cj = input.circuitJson.map((e) => {
    if (e.type === "source_component" && renamed.has(e.name)) {
      const inst = input.map.components[e.name].instance;
      const f = input.fields[inst];
      return { ...e, name: renamed.get(e.name), ...(f?.MPN ? { manufacturer_part_number: f.MPN } : {}) };
    }
    // the reference silk.ts printed for an authored land pattern
    if (e.type === "pcb_silkscreen_text" && e.pcb_component_id) {
      const old = sourceName.get(pcbOfSource.get(e.pcb_component_id) ?? "");
      if (old && e.text === old && renamed.has(old)) return { ...e, text: renamed.get(old) };
    }
    return e;
  });
  return { cj, nameOf };
}

const hidden = (at: Node[]) => list("effects", list("font", list("size", "1.27", "1.27")), list("hide", "yes"));

/** Set (or add) a hidden property on a footprint or symbol. */
function setProperty(n: List, name: string, value: string, layer?: string) {
  const p = propertyNode(n, name);
  if (p) {
    p.items[2] = str(value);
    return;
  }
  const at = child(n, "at");
  const pos = at ? [at.items[1] ?? "0", at.items[2] ?? "0", "0"] : ["0", "0", "0"];
  const prop = list("property", str(name), str(value), list("at", ...(layer ? ["0", "0", "0"] : pos)), ...(layer ? [list("layer", str(layer)), list("hide", "yes")] : []), hidden([]));
  // after the last property
  const last = n.items.reduce((k, c, i) => (head(c) === "property" ? i : k), -1);
  n.items.splice(last >= 0 ? last + 1 : n.items.length, 0, prop);
}

const fieldsOf = (f: ComponentFields): [string, string][] => EXTRA_FIELDS.filter((k) => f[k]).map((k) => [k, f[k] as string]);

/** KiCad's layer list and stack-up for 2 or 4 copper layers. */
function stackup(layers: 2 | 4, thickness: number, oz: number): List {
  const cu = Math.round(0.035 * oz * 10000) / 10000;
  const mask = 0.01;
  const copper = layers === 4 ? ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"] : ["F.Cu", "B.Cu"];
  const dielectric = Math.max(0.05, (thickness - copper.length * cu - 2 * mask) / (copper.length - 1));
  const r = (v: number) => String(Math.round(v * 10000) / 10000);
  const items: Node[] = [
    list("layer", str("F.SilkS"), list("type", str("Top Silk Screen"))),
    list("layer", str("F.Paste"), list("type", str("Top Solder Paste"))),
    list("layer", str("F.Mask"), list("type", str("Top Solder Mask")), list("thickness", r(mask))),
  ];
  copper.forEach((l, i) => {
    items.push(list("layer", str(l), list("type", str("copper")), list("thickness", r(cu))));
    if (i < copper.length - 1) items.push(list("layer", str(`dielectric ${i + 1}`), list("type", str(i === 1 || layers === 2 ? "core" : "prepreg")), list("thickness", r(dielectric)), list("material", str("FR4")), list("epsilon_r", "4.5"), list("loss_tangent", "0.02")));
  });
  items.push(list("layer", str("B.Mask"), list("type", str("Bottom Solder Mask")), list("thickness", r(mask))), list("layer", str("B.Paste"), list("type", str("Bottom Solder Paste"))), list("layer", str("B.SilkS"), list("type", str("Bottom Silk Screen"))));
  return list("stackup", ...items, list("copper_finish", str("None")), list("dielectric_constraints", "no"));
}

/**
 * A footprint as its library holds it: placed geometry and nets removed. KiCad
 * stores pad and text angles relative to the footprint, so they stay; a
 * bottom-side copy is flipped back to the top.
 */
function libraryFootprint(fp: List, name: string): List {
  const out = list("footprint", str(name), list("version", "20241229"), list("generator", str("protoboard")));
  const bottom = text(child(fp, "layer")?.items[1]) === "B.Cu";
  const rot = Number(text(child(fp, "at")?.items[3]) ?? 0) || 0;
  const flipLayer = (s: string) => (s.startsWith("F.") ? `B.${s.slice(2)}` : s.startsWith("B.") ? `F.${s.slice(2)}` : s);
  const unflip = (n: Node): Node => {
    if (!isList(n)) return n;
    const h = head(n);
    if (h === "layer" || h === "layers") return { items: n.items.map((c, i) => (i === 0 ? c : isStr(c) ? str(flipLayer(c.str)) : typeof c === "string" ? flipLayer(c) : c)) };
    if (h === "at" || h === "start" || h === "end" || h === "mid" || h === "center" || h === "xy") {
      const items = [...n.items];
      if (items[1] !== undefined) items[1] = String(-Number(text(items[1])));
      if (h === "at" && items[3] !== undefined) items[3] = String(-Number(text(items[3])));
      return { items };
    }
    if (h === "justify") return { items: n.items.filter((c) => text(c) !== "mirror") };
    return { items: n.items.map(unflip) };
  };
  for (const c of fp.items.slice(2)) {
    if (!isList(c)) continue;
    const h = head(c);
    if (h === "at" || h === "uuid" || h === "path" || h === "sheetname" || h === "sheetfile" || h === "locked") continue;
    if (h === "property" && (EXTRA_FIELDS as readonly string[]).includes(text(c.items[1]) ?? "")) continue;
    if (h === "layer") {
      out.items.push(list("layer", str("F.Cu")));
      continue;
    }
    const strip = (n: Node): Node => (isList(n) ? { items: n.items.filter((x) => !(isList(x) && (head(x) === "net" || head(x) === "uuid"))).map(strip) } : n);
    let item = strip(c) as List;
    // board files hold pad and text angles absolute; a library's are the footprint's own
    if (rot && (h === "pad" || h === "property" || h === "fp_text")) {
      const at = child(item, "at");
      if (at && at.items[3] !== undefined) {
        const a = (((Number(text(at.items[3])) - rot) % 360) + 360) % 360;
        at.items[3] = String(Math.round(a * 1e6) / 1e6);
      }
    }
    if (bottom) item = unflip(item) as List;
    if (h === "property" && text(item.items[1]) === "Reference") item.items[2] = str("REF**");
    out.items.push(item);
  }
  return out;
}

/** A symbol library from the schematic's embedded symbols, names without the library prefix. */
function symbolLibrary(libSymbols: List[]): string {
  const lib = list("kicad_symbol_lib", list("version", "20241209"), list("generator", str("protoboard")), list("generator_version", str("0.1")));
  const seen = new Set<string>();
  for (const s of libSymbols) {
    if (seen.has(text(s.items[1]) ?? "")) continue;
    seen.add(text(s.items[1]) ?? "");
    const copy = JSON.parse(JSON.stringify(s)) as List;
    const name = text(copy.items[1]) ?? "";
    copy.items[1] = str(name.includes(":") ? name.slice(name.indexOf(":") + 1) : name);
    lib.items.push(copy);
  }
  return printDocument(lib);
}

/** The footprint's reference node: a Reference property, or (older files) `(fp_text reference …)`; its value is item 2. */
const referenceNode = (fp: List): List | undefined => propertyNode(fp, "Reference") ?? children(fp, "fp_text").find((t) => text(t.items[1]) === "reference");

/** Set a footprint's attributes (`(attr smd)`, `(attr board_only exclude_from_bom …)`). */
function setAttr(fp: List, flags: string[]) {
  const i = fp.items.findIndex((c) => head(c) === "attr");
  const node = list("attr", ...flags);
  if (i >= 0) fp.items[i] = node;
  else fp.items.splice(fp.items.findIndex((c) => head(c) === "at") + 1, 0, node);
}

const num = (n: Node | undefined) => Number(text(n) ?? 0);
const fmt = (v: number) => String(Math.round(v * 1e6) / 1e6);

/**
 * Pads turned with their footprint. In a board file KiCad reads a pad's angle
 * as absolute; the converter writes 0 and gives the board-aligned size, which
 * is the right copper but not the library's pad turned (so KiCad reports the
 * footprint as differing from its library copy). For a footprint turned by a
 * right angle the pad gets the footprint's angle and its own size back.
 */
function normalisePads(fp: List) {
  const at = child(fp, "at");
  const rot = (((num(at?.items[3]) % 360) + 360) % 360);
  if (!rot || rot % 90) return;
  for (const p of children(fp, "pad")) {
    if (child(p, "primitives")) continue;
    const pat = child(p, "at");
    if (!pat || num(pat.items[3])) continue;
    if (rot % 180) {
      const size = child(p, "size");
      if (size) [size.items[1], size.items[2]] = [size.items[2], size.items[1]];
      const drill = child(p, "drill");
      if (drill && text(drill.items[1]) === "oval" && drill.items.length >= 4) [drill.items[2], drill.items[3]] = [drill.items[3], drill.items[2]];
    }
    pat.items[3] = fmt(rot);
  }
}

/**
 * The file a part body is copied to under `3d/` (PB-1027): each source file
 * gets its own name. Bodies are often all called `body.step` (a project's
 * parts/<id>/cad/body.step), so the name is the part id and the file's name;
 * a name already taken by another file gets the source path's digest too.
 * `taken` maps the names given so far to their sources.
 */
export function modelFileName(src: string, part: string | undefined, taken: Map<string, string>): string {
  for (const [name, from] of taken) if (from === src) return name;
  const base = libItemName(basename(src));
  const stem = part && !base.startsWith(`${libItemName(part)}-`) && base !== `${libItemName(part)}.step` ? `${libItemName(part)}-${base}` : base;
  let name = `3d/${stem}`;
  if (taken.has(name)) {
    const dot = stem.lastIndexOf(".");
    const tag = createHash("sha256").update(src).digest("hex").slice(0, 8);
    name = `3d/${dot > 0 ? `${stem.slice(0, dot)}-${tag}${stem.slice(dot)}` : `${stem}-${tag}`}`;
  }
  taken.set(name, src);
  return name;
}

/** A footprint with nothing in it: no pad, no drawing, no model (the converter's "Unknown" for a pcb_component with no source). */
export function emptyFootprint(fp: List): boolean {
  return !fp.items.some((c) => isList(c) && /^(pad|fp_line|fp_rect|fp_circle|fp_arc|fp_poly|fp_curve|model|zone)$/.test(head(c) ?? ""));
}

/** A keep-out's corners in KiCad's frame (origin KICAD_ORIGIN, Y down), as a bounding box. */
function keepoutBox(k: Keepout): [number, number, number, number] {
  const [cx, cy, w, h] = "rect" in k.shape ? [k.shape.rect.at[0], k.shape.rect.at[1], k.shape.rect.size[0], k.shape.rect.size[1]] : [k.shape.circle.at[0], k.shape.circle.at[1], k.shape.circle.diameter_mm, k.shape.circle.diameter_mm];
  return [KICAD_ORIGIN[0] + cx - w / 2, KICAD_ORIGIN[1] - cy - h / 2, KICAD_ORIGIN[0] + cx + w / 2, KICAD_ORIGIN[1] - cy + h / 2];
}

/**
 * Keep-outs that let some components' bodies over them (`allow_bodies`: the
 * module whose own antenna the keep-out clears) in KiCad (PB-1027, F23).
 * KiCad's keep-out areas forbid every footprint or none, so each such zone is
 * named after its keep-out and allows footprints, and a custom rule in the
 * project's `<b>.kicad_dru` forbids every footprint but the allowed ones
 * there. Tracks, vias, pads and pours stay forbidden. Returns the rules file
 * (undefined when no keep-out has exceptions).
 */
export function keepoutExceptions(pcb: List, keepouts: Keepout[], refdes: Record<string, string>): { rules?: string; notes: string[] } {
  const notes: string[] = [];
  const rules: string[] = [];
  const zones = children(pcb, "zone").filter((z) => child(z, "keepout"));
  for (const k of keepouts) {
    if (!k.allow_bodies?.length) continue;
    const [x0, y0, x1, y1] = keepoutBox(k);
    const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
    const mine = zones.filter((z) => {
      const pts = children(child(child(z, "polygon") ?? list("polygon"), "pts") ?? list("pts"), "xy").map((p) => [num(p.items[1]), num(p.items[2])] as const);
      if (!pts.length) return false;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return near(Math.min(...xs), x0) && near(Math.max(...xs), x1) && near(Math.min(...ys), y0) && near(Math.max(...ys), y1);
    });
    if (!mine.length) {
      notes.push(`keep-out ${k.name}: no KiCad keep-out area was found for it, so its exception for ${k.allow_bodies.join(", ")} is not in KiCad`);
      continue;
    }
    const name = libItemName(k.name);
    for (const z of mine) {
      const at = z.items.findIndex((c) => head(c) === "name");
      if (at >= 0) z.items[at] = list("name", str(name));
      else z.items.splice(z.items.findIndex((c) => head(c) === "uuid") + 1 || 1, 0, list("name", str(name)));
      const fps = child(child(z, "keepout")!, "footprints");
      if (fps) fps.items[1] = "allowed";
    }
    const refs = k.allow_bodies.map((i) => refdes[i] ?? i);
    rules.push(`\t(rule "keepout ${name}: no footprint but ${refs.join(", ")}"\n\t\t(constraint disallow footprint)\n\t\t(condition "A.intersectsArea('${name}')${refs.map((r) => ` && A.Reference != '${r}'`).join("")}"))`);
  }
  return { ...(rules.length ? { rules: rules.join("\n") } : {}), notes };
}

/**
 * The project's custom DRC rules (`<b>.kicad_dru`): the config's via size as a
 * minimum for every via (PB-1027, F31: KiCad's net class via size is what new
 * vias get, not a limit, so a via made smaller by hand passed), and the
 * keep-out exceptions (keepoutExceptions).
 */
export function customRules(constraints: BoardConstraints | undefined, keepoutRules?: string): string | undefined {
  const r = constraints?.rules;
  const lines: string[] = [];
  if (r) lines.push(`\t(rule "via size (circuit.config.ts rules)"\n\t\t(condition "A.Type == 'Via'")\n\t\t(constraint via_diameter (min ${r.via_pad_mm}mm))\n\t\t(constraint hole_size (min ${r.via_drill_mm}mm)))`);
  if (keepoutRules) lines.push(keepoutRules);
  if (!lines.length) return undefined;
  return `(version 1)\n# Written by @protoboardai/ext-tscircuit from circuit.config.ts: the via rules as minimums, and keep-outs that\n# let named bodies over them (allow_bodies; their KiCad areas allow footprints and a rule forbids all others).\n${lines.join("\n")}\n`;
}

export function kicadProject(input: KicadProjectInput): KicadProject {
  const { board } = input;
  const lib = libraryName(board);
  const notes: string[] = [];
  const { cj, nameOf } = prepare(input);
  const instanceOf = (ref: string) => {
    const name = nameOf.get(ref);
    return name ? input.map.components[name] : undefined;
  };

  const pcbConv = new CircuitJsonToKicadPcbConverter(cj as never, { projectName: board });
  pcbConv.runUntilFinished();
  const proConv = new CircuitJsonToKicadProConverter(cj as never, { projectName: board, schematicFilename: `${board}.kicad_sch`, pcbFilename: `${board}.kicad_pcb` });
  proConv.runUntilFinished();
  const pcb = parse(pcbConv.getOutputString());

  const keep = new Set<string>(); // UUIDs derived on purpose: not renumbered below
  const symbols: Record<string, string> = {};
  for (const c of input.netlist.components) {
    symbols[c.instance] = stableUuid(board, `symbol:${c.instance}`);
    keep.add(symbols[c.instance]);
  }

  const fpByInstance = new Map<string, string>();
  for (const m of Object.values(input.map.components)) fpByInstance.set(m.instance, `${lib}:${libItemName(m.footprint)}`);
  const footprintOf = (inst: string) => fpByInstance.get(inst) ?? `${lib}:${libItemName(inst)}`;
  // the footprint carries the symbol's description (the part's name) and datasheet
  const symbolText = new Map<string, Record<string, string>>(input.netlist.components.map((c) => [c.instance, { Description: c.name, Datasheet: "" }]));

  // ---- board: footprints, fields, models, links to the symbols, layers, thickness, origin
  const models: Record<string, string> = {};
  const modelNames = new Map<string, string>(); // 3d/<file> → source
  const library = new Map<string, List>();
  let empty = 0;
  const padNets = new Map<string, Map<string, string>>(); // refdes → pad → net
  let holes = 0;
  const dropped = new Set<string>();
  const unnetted: { ref: string; fp: List }[] = [];
  for (const fp of children(pcb, "footprint")) {
    const refNode = referenceNode(fp);
    let ref = text(refNode?.items[2]) ?? "";
    // a footprint with nothing in it and no component (the converter's "Unknown" for a pcb_component without a
    // source component): left out, not written as an empty "MountingHole" (PB-1027, F21)
    if (!instanceOf(ref) && emptyFootprint(fp)) {
      pcb.items = pcb.items.filter((c) => c !== fp);
      empty++;
      continue;
    }
    // a footprint with no component (a mounting hole): a designator, and nothing in the schematic, BOM or placement
    if (!ref) {
      ref = `H${++holes}`;
      if (refNode) refNode.items[2] = str(ref);
      else {
        setProperty(fp, "Reference", ref, "F.Fab");
        setProperty(fp, "Value", "MountingHole", "F.Fab");
      }
      setAttr(fp, ["board_only", "exclude_from_pos_files", "exclude_from_bom"]);
    }
    normalisePads(fp);
    const m = instanceOf(ref);
    const entry = m ? libItemName(m.footprint) : libItemName((text(fp.items[1]) ?? "footprint").replace(/^[^:]*:/, ""));
    fp.items[1] = str(`${lib}:${entry}`);
    if (m) {
      const f = input.fields[m.instance];
      if (f) {
        setProperty(fp, "Value", f.Value);
        for (const [k, v] of fieldsOf(f)) setProperty(fp, k, v, "F.Fab");
      }
      for (const [k, v] of Object.entries(symbolText.get(m.instance) ?? {})) setProperty(fp, k, v, "F.Fab");
      const pads = children(fp, "pad");
      setAttr(fp, [pads.length && pads.every((p) => text(p.items[2]) === "smd") ? "smd" : "through_hole"]);
      const nets = new Map<string, string>();
      for (const p of pads) {
        const net = child(p, "net");
        const name = net ? text(net.items[net.items.length - 1]) : undefined;
        if (name && text(p.items[1]) && !nets.has(text(p.items[1])!)) nets.set(text(p.items[1])!, name);
      }
      padNets.set(ref, nets);
      unnetted.push({ ref, fp });
      const uuid = child(fp, "uuid");
      const fpUuid = stableUuid(board, `footprint:${m.instance}`);
      keep.add(fpUuid);
      if (uuid) uuid.items[1] = fpUuid;
      // the symbol this footprint belongs to (root sheet)
      const at = fp.items.findIndex((c) => head(c) === "at");
      fp.items.splice(at + 1, 0, list("path", str(`/${symbols[m.instance]}`)), list("sheetname", str("/")), list("sheetfile", str(`${board}.kicad_sch`)));
    }
    for (const model of children(fp, "model")) {
      const raw = text(model.items[1]) ?? "";
      if (!raw || raw.startsWith("${KIPRJMOD}")) continue;
      const src = isAbsolute(raw) || !input.modelBase ? raw : resolve(input.modelBase, raw);
      if (input.modelOk && !input.modelOk(src)) {
        fp.items = fp.items.filter((c) => c !== model);
        dropped.add(`${ref} (${basename(src)})`);
        continue;
      }
      const file = modelFileName(src, m ? input.fields[m.instance]?.UHD_Part : undefined, modelNames);
      models[file] = src;
      model.items[1] = str(`\${KIPRJMOD}/${file}`);
    }
    // the library's copy: an unturned top-side instance when there is one, else a top-side one
    const rank = (f: List) => (text(child(f, "layer")?.items[1]) === "B.Cu" ? 2 : num(child(f, "at")?.items[3]) % 360 ? 1 : 0);
    const prev = library.get(entry);
    if (!prev || rank(fp) < rank(prev)) library.set(entry, fp);
  }

  // ---- one KiCad group per sub-module, named by its path and nested as the sub-modules nest (docs/specs/nested-boards.md §8)
  const placed = new Set(children(pcb, "footprint").map((fp) => instanceOf(text(referenceNode(fp)?.items[2]) ?? "")?.instance).filter(Boolean));
  const made = new Set<string>();
  const groupNodes: List[] = [];
  // innermost first, so a group lists only the sub-groups that exist
  for (const g of [...(input.netlist.groups ?? [])].reverse()) {
    const members = [
      ...input.netlist.components.filter((c) => c.group === g.path && placed.has(c.instance)).map((c) => stableUuid(board, `footprint:${c.instance}`)),
      ...(input.netlist.groups ?? []).filter((x) => x.parent === g.path && made.has(x.path)).map((x) => stableUuid(board, `group:${x.path}`)),
    ];
    if (!members.length) continue;
    made.add(g.path);
    const uuid = stableUuid(board, `group:${g.path}`);
    keep.add(uuid);
    groupNodes.unshift(list("group", str(g.path), list("uuid", uuid), list("members", ...members)));
  }
  pcb.items.push(...groupNodes);

  const general = child(pcb, "general");
  const thickness = input.constraints?.thickness_mm;
  if (general && thickness) {
    const t = child(general, "thickness");
    if (t) t.items[1] = String(thickness);
    else general.items.push(list("thickness", String(thickness)));
  }
  const want = input.constraints?.layers;
  const layersNode = child(pcb, "layers");
  if (layersNode && want === 2) {
    const before = layersNode.items.length;
    layersNode.items = layersNode.items.filter((l) => !(isList(l) && /^In\d+\.Cu$/.test(text(l.items[1]) ?? "")));
    if (layersNode.items.length !== before) notes.push("inner copper layers removed: the config states 2 layers");
  }
  const setup = child(pcb, "setup") ?? (pcb.items.splice(pcb.items.findIndex((c) => head(c) === "layers") + 1, 0, list("setup")), child(pcb, "setup")!);
  setup.items = setup.items.filter((c) => !["stackup", "aux_axis_origin", "grid_origin"].includes(head(c) ?? ""));
  const copperLayers = layersNode ? layersNode.items.filter((l) => isList(l) && /\.Cu$/.test(text(l.items[1]) ?? "")).length : 2;
  setup.items.splice(1, 0, stackup(copperLayers >= 4 ? 4 : 2, thickness ?? 1.6, input.copperOz ?? 1));
  setup.items.push(list("aux_axis_origin", String(KICAD_ORIGIN[0]), String(KICAD_ORIGIN[1])), list("grid_origin", String(KICAD_ORIGIN[0]), String(KICAD_ORIGIN[1])));

  if (empty) notes.push(`${empty} empty footprint(s) with no component left out (the converter writes one for a tscircuit pcb_component with no source component)`);
  // ---- keep-outs whose exceptions KiCad's areas cannot hold: a custom rule (PB-1027, F23)
  const exceptions = keepoutExceptions(pcb, input.constraints?.keepouts ?? [], input.refdes);
  notes.push(...exceptions.notes);
  if (dropped.size) notes.push(`${dropped.size} footprint(s) have no 3D model: their body file is missing or not a STEP file (${[...dropped].slice(0, 4).join(", ")}${dropped.size > 4 ? ", …" : ""})`);

  // ---- pads without a net: a pad numbered like a netted one is the same pin (several lands of one
  // pin: a module's ground pads, a receptacle's shield) and takes its net; a pin on no net takes
  // KiCad's own "unconnected-(…)" net, as Update PCB from Schematic would give it
  // ---- the schematic (schematic.ts): written from the model and the board's pad nets, not converted
  const pads = new Map<string, Map<string, string>>();
  for (const m of Object.values(input.map.components)) {
    const byPad = new Map<string, string>();
    for (const [port, iface] of Object.entries(m.ports)) if (iface) byPad.set(port.replace(/^pin/, ""), iface);
    pads.set(m.instance, byPad);
  }
  const schematic = buildSchematic({
    board,
    lib,
    netlist: input.netlist,
    pads,
    refdes: input.refdes,
    fields: Object.fromEntries(Object.entries(input.fields).map(([inst, f]) => [inst, [["Value", f.Value] as [string, string], ...fieldsOf(f)]])),
    footprint: footprintOf,
    padNets,
    pinTypes: input.pinTypes,
    symbolUuid: symbols,
    uuid: (key) => stableUuid(board, `sch:${key}`),
  });
  const sch = schematic.sch;
  const libSymbols = schematic.libSymbols;
  const refOf = new Map(Object.entries(input.refdes).map(([i, r]) => [r, i]));
  const pinNames = schematic.pinNames;
  const symbolOf = new Map([...refOf].map(([r, i]) => [r, schematic.symbolOf[i] ?? ""]));
  const header = children(pcb, "net");
  const netNumber = new Map(header.map((n) => [text(n.items[2]) ?? "", text(n.items[1]) ?? ""]));
  let next = Math.max(0, ...header.map((n) => Number(text(n.items[1]) ?? 0))) + 1;
  const numbered = header.length > 0 && /^\d+$/.test(text(header[0].items[1]) ?? "");
  const joined: string[] = [];
  const added: List[] = [];
  for (const { ref, fp } of unnetted) {
    const nets = padNets.get(ref)!;
    for (const p of children(fp, "pad")) {
      const n = text(p.items[1]) ?? "";
      if (!n || child(p, "net")) continue;
      let name = nets.get(n);
      if (name) joined.push(`${ref}.${n}`);
      else {
        const pin = pinNames.get(symbolOf.get(ref) ?? "")?.get(n);
        if (pin === undefined) continue; // a mechanical pad with no pin
        name = `unconnected-(${ref}${pin && pin !== "~" ? `-${pin}` : ""}-Pad${n})`;
      }
      if (numbered && !netNumber.has(name)) {
        netNumber.set(name, String(next));
        added.push(list("net", String(next++), str(name)));
      }
      const net = numbered ? list("net", netNumber.get(name)!, str(name)) : list("net", str(name));
      const after = p.items.findIndex((c) => head(c) === "layers");
      p.items.splice(after >= 0 ? after + 1 : p.items.length, 0, net);
    }
  }
  if (added.length) pcb.items.splice(pcb.items.indexOf(header[header.length - 1]) + 1, 0, ...added);
  if (joined.length) notes.push(`${joined.length} pad(s) sharing a pin number with a netted pad were given its net (${joined.slice(0, 4).join(", ")}${joined.length > 4 ? ", …" : ""}); tscircuit had left them off the net, so KiCad's DRC may report them unrouted`);

  // ---- the project's libraries
  const files: Record<string, string> = {};
  for (const [entry, fp] of [...library.entries()].sort(([a], [b]) => a.localeCompare(b))) files[`${lib}.pretty/${entry}.kicad_mod`] = printDocument(libraryFootprint(fp, entry));
  files[`${lib}.kicad_sym`] = symbolLibrary(libSymbols);
  const dru = customRules(input.constraints, exceptions.rules);
  if (dru) files[`${board}.kicad_dru`] = dru;
  files["fp-lib-table"] = `(fp_lib_table\n\t(version 7)\n\t(lib (name "${lib}") (type "KiCad") (uri "\${KIPRJMOD}/${lib}.pretty") (options "") (descr "${board}: footprints exported by @protoboardai/ext-tscircuit"))\n)\n`;
  files["sym-lib-table"] = `(sym_lib_table\n\t(version 7)\n\t(lib (name "${lib}") (type "KiCad") (uri "\${KIPRJMOD}/${lib}.kicad_sym") (options "") (descr "${board}: symbols exported by @protoboardai/ext-tscircuit"))\n)\n`;

  // ---- stable UUIDs everywhere else: renumbered in document order (schematic, board, project)
  const [schText, pcbText, proText] = stabiliseUuids(board, [printDocument(sch), printDocument(pcb), proConv.getOutputString()], keep);
  const pro = JSON.parse(proText) as Record<string, unknown> & { head?: Record<string, unknown>; meta?: Record<string, unknown>; net_settings?: { classes?: Record<string, unknown>[] } };
  // a project file without dates: the same board exports the same file
  if (pro.head) for (const k of ["created", "modified"]) delete pro.head[k];
  const rules = input.constraints?.rules;
  if (rules && pro.net_settings?.classes?.[0]) Object.assign(pro.net_settings.classes[0], { track_width: rules.trace_width_mm, via_diameter: rules.via_pad_mm, via_drill: rules.via_drill_mm });
  // the config's edge clearance is the board's rule (KiCad's default is 0.5 mm)
  const board_ = (pro as { board?: { design_settings?: { rules?: Record<string, number> } } }).board;
  if (rules && board_?.design_settings) board_.design_settings.rules = { ...(board_.design_settings.rules ?? {}), min_copper_edge_clearance: rules.edge_clearance_mm };
  files[`${board}.kicad_sch`] = schText;
  files[`${board}.kicad_pcb`] = pcbText;
  files[`${board}.kicad_pro`] = JSON.stringify(pro, null, 2) + "\n";
  void print;
  return { files, models, symbols, keep, notes };
}
