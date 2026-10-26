/**
 * export: the built board → the circuit capability's standard outputs
 * (tool-integrations.md §3, §8), plus three renders the viewer shows:
 *
 *   gerber/*.gbr, gerber/*.drl   Gerber RS-274X (X2 attributes) and Excellon
 *   bom.csv, pnp.csv             keyed by UHD instance path, with the part's MPN
 *   board.glb, board.step        board and component bodies (see models.ts)
 *   board.manifest.json          UHD geometry manifest: outline, holes, a feature
 *                                per component instance and per board export
 *   netlist.json                 protoboard.netlist/v0, the nets as the copper joins them
 *   schematic.svg, pcb-top.svg, pcb-bottom.svg
 *
 * Everything runs locally from @tscircuit's converter libraries, with the
 * offline fetch guard installed.
 */
import { formatPassiveValue, NETLIST_SCHEMA, type BoardNetlist, type NetlistReport } from "@protoboardai/core";
import type { GeometryFrame } from "@deltarobotics/uhd";
import { convertCircuitJsonToExcellonDrillCommandLayers, convertCircuitJsonToGerberCommands, stringifyExcellonDrill, stringifyGerberCommandLayers } from "circuit-json-to-gerber";
import { convertCircuitJsonToGltf } from "circuit-json-to-gltf";
import { circuitJsonToStep } from "circuit-json-to-step";
import { convertCircuitJsonToPcbSvg, convertCircuitJsonToSchematicSvg } from "circuit-to-svg";
import { readFileSync } from "node:fs";
import { polygonArea, polygonCentroid, type BoardConstraints, type Vec2 } from "./config.ts";
import { boardGeometry, copperNets, ofType, portPins, type BoardGeometry } from "./layout.ts";
import { offline, quietly, type CircuitElement, type FileRequests } from "./runtime.ts";
import { stepEntities } from "./stepfile.ts";
import { supplierColumns, type SupplierNumbers } from "./suppliers.ts";
import type { NameMap } from "./source.ts";

type Vec3 = [number, number, number];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** RFC 4180 field. */
export const csvField = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: unknown[][]) => [header.join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\n") + "\n";

/** Engineering notation for a passive value: 4.7 kΩ, 100 nF, 1.5 µH (core's formatter). */
export const formatValue = formatPassiveValue;

/**
 * Gerber and Excellon files with their creation timestamps removed, so an
 * unchanged board exports byte-identical files (X2 attributes are optional).
 */
export function fabricationFiles(cj: CircuitElement[]): Record<string, string> {
  const out: Record<string, string> = {};
  // circuit-json-to-gerber flashes a rotated paste aperture unrotated: those are written here as regions
  const rotated = cj.filter((e) => e.type === "pcb_solder_paste" && e.shape === "rotated_rect" && Math.abs(((e.ccw_rotation ?? 0) % 90)) > 1e-6);
  const gerbers = stringifyGerberCommandLayers(convertCircuitJsonToGerberCommands(cj.filter((e) => !rotated.includes(e)) as never)) as Record<string, string>;
  for (const [name, text] of Object.entries(gerbers)) out[`gerber/${name}.gbr`] = withRotatedPaste(name, withPours(name, text, cj), rotated).replace(/^%TF\.CreationDate,[^*]*\*%\r?\n/gm, "").replace(/^(G04 Created by [^*]*?) date [^*]*\*/gm, "$1*");
  const drills = convertCircuitJsonToExcellonDrillCommandLayers({ circuitJson: cj as never }) as Record<string, unknown>;
  for (const [name, cmds] of Object.entries(drills)) {
    const text = stringifyExcellonDrill(cmds as never)
      .replace(/^; #@! TF\.CreationDate,.*\r?\n/gm, "")
      .replace(/^(; DRILL file \{[^}]*\}) date .*$/gm, "$1");
    out[`gerber/${name.endsWith(".drl") ? name : `${name}.drl`}`] = text;
  }
  return out;
}

const PASTE_LAYER: Record<string, string> = { F_Paste: "top", B_Paste: "bottom" };

/** Paste apertures turned by other than a multiple of 90°, as Gerber regions on their paste layer. */
export function withRotatedPaste(layerName: string, text: string, rotated: CircuitElement[]): string {
  const layer = PASTE_LAYER[layerName];
  const mine = rotated.filter((e) => e.layer === layer);
  if (!layer || !mine.length) return text;
  const xy = (v: number) => String(Math.round(v * 1e6));
  const block = [
    "G04 rotated paste apertures (ext-tscircuit)*",
    "%LPD*%",
    ...mine.flatMap((e) => {
      const a = ((e.ccw_rotation ?? 0) * Math.PI) / 180;
      const [hw, hh] = [e.width / 2, e.height / 2];
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]].map(([x, y]) => [e.x + x * Math.cos(a) - y * Math.sin(a), e.y + x * Math.sin(a) + y * Math.cos(a)]);
      return ["G36*", `X${xy(pts[0][0])}Y${xy(pts[0][1])}D02*`, ...pts.slice(1).map(([x, y]) => `X${xy(x)}Y${xy(y)}D01*`), "G37*"];
    }),
  ].join("\n");
  return text.replace(/M02\*\s*$/, `${block}\nM02*\n`);
}

const POUR_LAYER: Record<string, string> = { F_Cu: "top", B_Cu: "bottom", In1_Cu: "inner1", In2_Cu: "inner2" };

/**
 * Copper pours as Gerber regions. circuit-json-to-gerber leaves
 * `pcb_copper_pour` out, so each pour on the file's layer is written here:
 * its outer ring dark, its inner rings (the clearances around other nets)
 * clear, before any pad or trace is drawn, so the clears never cut them.
 */
export function withPours(layerName: string, text: string, cj: CircuitElement[]): string {
  const layer = POUR_LAYER[layerName];
  const pours = cj.filter((e) => e.type === "pcb_copper_pour" && e.layer === layer && e.shape === "brep");
  if (!layer || !pours.length) return text;
  const xy = (v: number) => String(Math.round(v * 1e6));
  const region = (vs: { x: number; y: number }[]) => {
    const pts = [...vs, vs[0]];
    return ["G36*", `X${xy(pts[0].x)}Y${xy(pts[0].y)}D02*`, ...pts.slice(1).map((p) => `X${xy(p.x)}Y${xy(p.y)}D01*`), "G37*"].join("\n");
  };
  const block = [
    "G04 copper pours (ext-tscircuit)*",
    ...pours.flatMap((p) => ["%LPD*%", region(p.brep_shape.outer_ring.vertices), ...(p.brep_shape.inner_rings ?? []).flatMap((r: { vertices: { x: number; y: number }[] }) => ["%LPC*%", region(r.vertices)]), "%LPD*%"]),
  ].join("\n");
  const at = text.indexOf("G04 aperture END LIST*");
  if (at < 0) return text.replace(/M02\*\s*$/, `${block}\nM02*\n`);
  const end = text.indexOf("\n", at) + 1;
  return text.slice(0, end) + block + "\n" + text.slice(end);
}

/** The bill of materials: one row per component, with its supplier part numbers (LCSC first) when the project holds them. */
export const bomCsv = (netlist: BoardNetlist, suppliers: Record<string, SupplierNumbers> = {}) =>
  csv(
    ["instance", "part", "name", "kind", "manufacturer", "mpn", "value", "package", "quantity", "lcsc", "supplier_part_numbers"],
    netlist.components.map((c) => {
      const s = supplierColumns(suppliers[c.instance]);
      return [c.instance, c.part, c.name, c.kind, c.manufacturer, c.mpn, c.value ? formatValue(c.value) : "", c.package?.name, 1, s.lcsc, s.suppliers];
    }),
  );

/** Pick-and-place at the pad bounding-box centre (what assembly houses take), board frame, with the LCSC number an assembler places from. */
export const pnpCsv = (netlist: BoardNetlist, geometry: BoardGeometry, suppliers: Record<string, SupplierNumbers> = {}) =>
  csv(
    ["instance", "x_mm", "y_mm", "rotation_deg", "side", "part", "mpn", "package", "lcsc"],
    geometry.components.map((g) => {
      const c = netlist.components.find((x) => x.instance === g.instance);
      return [g.instance, g.center[0], g.center[1], g.rotation_deg, g.side, g.part, c?.mpn, c?.package?.name, supplierColumns(suppliers[g.instance]).lcsc];
    }),
  );

/** The nets as the copper joins them, named by the UHD net each piece carries. */
export function laidOutNetlist(cj: CircuitElement[], map: NameMap, netlist: BoardNetlist): NetlistReport {
  const { nets } = copperNets(cj, map);
  const netOf = new Map<string, string>();
  for (const n of netlist.nets) for (const p of n.pins) netOf.set(p, n.id);
  const used = new Set<string>();
  let unnamed = 0;
  const out: NetlistReport["nets"] = [];
  for (const g of nets) {
    const ids = [...new Set(g.pins.map((p) => netOf.get(p)).filter((x): x is string => !!x))];
    let id = ids.length === 1 ? ids[0] : ids.length ? ids.sort().join("+") : `copper_${++unnamed}`;
    while (used.has(id)) id += "_piece";
    used.add(id);
    const intended = ids.length === 1 ? netlist.nets.find((n) => n.id === ids[0]) : undefined;
    out.push({ id, ...(intended?.links.length === 1 ? { link: intended.links[0] } : {}), pins: g.pins });
  }
  return { schema: NETLIST_SCHEMA, nets: out.sort((a, b) => a.id.localeCompare(b.id)) };
}

const frameFeature = (area: number, frame: GeometryFrame) => ({ area_mm2: r4(area), centroid: frame.origin, normal: frame.normal, frame });

/**
 * The UHD geometry manifest of the board. Features: `outline` (the bottom
 * face: the board's mounting side), `board_top`, each mounting hole by its
 * config id, each component by instance path, each board export by its id.
 * Every feature also carries `frame` (origin, normal, xAxis): proposed for
 * UHD's manifest so interface frames can be bound from it (spike §9).
 */
/** A board export's mating frame as its part states it (part coordinates), and the part's mount origin. */
export interface PartEdgeFrame {
  frame: GeometryFrame;
  /** The part's mounting frame origin (where its body meets the board), part coordinates. */
  mount?: [number, number, number];
}

/**
 * A part-coordinates frame placed on the board: the part's mount origin goes
 * to the footprint origin on the surface (as the bodies are placed), rotated
 * by the placement; a bottom-side part is mirrored in X and Z.
 */
export function placePartFrame(f: PartEdgeFrame, comp: { origin: Vec2; rotation_deg: number; side: string }, half: number): GeometryFrame {
  const a = (comp.rotation_deg * Math.PI) / 180;
  const flip = comp.side === "bottom" ? -1 : 1;
  const m = f.mount ?? [0, 0, 0];
  const turn = (v: number[]): Vec3 => {
    const x = v[0] * Math.cos(a) - v[1] * Math.sin(a);
    const y = v[0] * Math.sin(a) + v[1] * Math.cos(a);
    return [r4(x * flip) + 0, r4(y) + 0, r4(v[2] * flip) + 0];
  };
  const o = turn([f.frame.origin[0] - m[0], f.frame.origin[1] - m[1], f.frame.origin[2] - m[2]]);
  return {
    origin: [r4(comp.origin[0] + o[0]), r4(comp.origin[1] + o[1]), r4(flip * half + o[2])],
    normal: turn(f.frame.normal),
    ...(f.frame.xAxis ? { xAxis: turn(f.frame.xAxis) } : {}),
  };
}

export function boardManifest(cj: CircuitElement[], map: NameMap, netlist: BoardNetlist, constraints: BoardConstraints | undefined, sourceDigest: string, partFrames: Record<string, PartEdgeFrame> = {}) {
  const g = boardGeometry(cj, map);
  const half = g.thickness_mm / 2;
  const area = Math.abs(polygonArea(g.outline));
  const [cx, cy] = polygonCentroid(g.outline);
  const features: Record<string, ReturnType<typeof frameFeature>> = {
    outline: frameFeature(area, { origin: [cx, cy, -half], normal: [0, 0, -1], xAxis: [1, 0, 0] }),
    board_top: frameFeature(area, { origin: [cx, cy, half], normal: [0, 0, 1], xAxis: [1, 0, 0] }),
  };
  for (const h of g.holes) {
    const id = constraints?.holes.find((c) => Math.hypot(c.at[0] - h.at[0], c.at[1] - h.at[1]) < 0.01)?.id ?? h.name;
    features[id] = frameFeature(Math.PI * (h.diameter_mm / 2) ** 2, { origin: [h.at[0], h.at[1], -half], normal: [0, 0, -1], xAxis: [1, 0, 0] });
  }
  for (const c of g.components) {
    const { source: _source, ...frame } = c.frame;
    features[c.instance] = frameFeature(c.size[0] * c.size[1], frame);
  }
  const pads = new Map<string, Vec2>();
  for (const [portId, pin] of portPins(cj, map)) {
    const p = ofType(cj, "pcb_port").find((x) => x.pcb_port_id === portId);
    if (p) pads.set(pin, [r4(p.x), r4(p.y)]);
  }
  const notes: string[] = [];
  for (const e of netlist.edge) {
    if (features[e.id]) {
      notes.push(`export ${e.id} shares its name with another feature; not listed`);
      continue;
    }
    const comp = g.components.find((c) => c.instance === e.instance);
    if (!comp) continue;
    const leaf = e.pins.length === 1 && e.pins[0] === `${e.instance}:${e.interface}` ? pads.get(e.pins[0]) : undefined;
    const z = comp.side === "bottom" ? -half : half;
    const { source: _source, ...frame } = comp.frame;
    // a composite or mechanical export takes the mating frame its part states (a connector's mouth at its axis height,
    // a side-push switch's stem), placed like the body; else the component frame tscircuit gives
    const stated = !leaf && partFrames[e.id] ? placePartFrame(partFrames[e.id], comp, half) : undefined;
    features[e.id] = leaf
      ? frameFeature(0, { origin: [leaf[0], leaf[1], z] as Vec3, normal: [0, 0, comp.side === "bottom" ? -1 : 1], xAxis: frame.xAxis })
      : stated
        ? frameFeature(comp.size[0] * comp.size[1], stated)
        : frameFeature(comp.size[0] * comp.size[1], frame);
  }
  return {
    manifest: {
      artifact: "board.glb",
      tool: "tscircuit",
      ...(g.toolVersion ? { toolVersion: g.toolVersion } : {}),
      sourceDigest,
      units: "mm" as const,
      frame: "board: mm; +X right and +Y up in the top view; +Z out of the top copper; z = 0 on the mid-plane",
      features,
    },
    geometry: g,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------

/**
 * board.glb in glTF's own convention (metres, +Y up), so it loads like every
 * other UHD body: the viewer maps it back to mm, Z-up board coordinates.
 * circuit-json-to-gltf writes millimetres with (x, y, z)glb = (−x, z, y)board;
 * one root node undoes that. Nodes keep the instance paths as names.
 */
export function reframeGlb(glb: Uint8Array, map: NameMap): Buffer {
  const b = Buffer.from(glb);
  const jsonLength = b.readUInt32LE(12);
  const json = JSON.parse(b.toString("utf8", 20, 20 + jsonLength));
  const rest = b.subarray(20 + jsonLength);
  const s = 0.001;
  const scene = json.scenes[json.scene ?? 0];
  for (const n of json.nodes ?? []) if (n.name && map.components[n.name]) n.name = map.components[n.name].instance;
  json.nodes.push({ name: "board", matrix: [-s, 0, 0, 0, 0, s, 0, 0, 0, 0, -s, 0, 0, 0, 0, 1], children: scene.nodes });
  scene.nodes = [json.nodes.length - 1];
  json.asset = { ...json.asset, generator: `${json.asset?.generator ?? "circuit-json-to-gltf"} via @protoboardai/ext-tscircuit`, extras: { frame: "glTF: metres, +Y up; board frame (mm, Z up) = (x, -z, y) × 1000" } };
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += " ";
  const head = Buffer.alloc(20);
  const body = Buffer.from(text);
  head.write("glTF", 0, "latin1");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + body.length + rest.length, 8);
  head.writeUInt32LE(body.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, body, rest]);
}

/**
 * board.glb, and which body files the converter could not load. It falls back to a box for
 * such a body and says so only on the console, so the console is read here: a body that
 * was chosen is not a body that was loaded (on Windows every one failed, PB-1013).
 */
export async function boardGlb(cj: CircuitElement[], map: NameMap, platform?: NodeJS.Platform): Promise<{ glb: Buffer; failed: string[] }> {
  const files: FileRequests = { read: [], missing: [] };
  const log: string[] = [];
  const glb = await quietly(() => offline(() => convertCircuitJsonToGltf(cj as never, { format: "glb" }) as Promise<ArrayBuffer>, { files, ...(platform ? { platform } : {}) }), log, (line) => line.startsWith("Failed to load STEP from "));
  const failed = new Set(files.missing);
  for (const line of log) {
    const m = /Failed to load STEP from (.+?): /.exec(line);
    if (m) failed.add(m[1]);
  }
  return { glb: reframeGlb(new Uint8Array(glb), map), failed: [...failed].sort() };
}

/**
 * The first entity id above every id in use. A loop, not Math.max(...ids): a large board's STEP has
 * hundreds of thousands of entities, more arguments than the stack holds ("Maximum call stack size
 * exceeded" on a 137-part board, PB-1013).
 */
export function nextEntityId(ids: Iterable<number>): number {
  let next = 1;
  for (const id of ids) if (id >= next) next = id + 1;
  return next;
}

const stepString = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** A STEP REAL to 1 nm: always with a decimal point. */
const stepReal = (v: number) => {
  const s = (Math.round(v * 1e6) / 1e6 || 0).toString();
  return s.includes(".") ? s : `${s}.`;
};

/**
 * board.step in the board frame (mm): the board solid and one mapped item per
 * component body, named by instance path.
 *
 * circuit-json-to-step 0.0.43 places a model by recentring it on the bounding
 * box of every CARTESIAN_POINT in its file (axis placements included, so not
 * the solid's own box) and lifts it by half the board thickness on top of a
 * position that is already the board surface. Both move bodies off their
 * pads. Each mapped item's target origin is therefore set back to the
 * cad_component position afterwards (where the model's origin belongs, as in
 * board.glb); its axes, which the converter gets right, are kept.
 *
 * The converter names each shape representation after the key it read the
 * model under; models are passed under `labels` (the artifact, or the box's
 * project-relative path), so no local path reaches the file, and the header
 * date is fixed so an unchanged board writes the same file.
 */
export async function boardStep(cj: CircuitElement[], map: NameMap, labels: Record<string, string> = {}): Promise<string> {
  const fsMap: Record<string, string> = {};
  const patched = cj.map((e) => {
    if (e.type !== "cad_component" || typeof e.model_step_url !== "string") return e;
    const key = labels[e.model_step_url] ?? e.model_step_url;
    fsMap[key] ??= readFileSync(e.model_step_url, "utf8");
    return { ...e, model_step_url: key };
  });
  const raw = await offline(() => circuitJsonToStep(patched as never, { includeComponents: true, includeExternalMeshes: true, fsMap } as never) as Promise<string>);

  // each body's cad_components in circuit order, by the model they use
  const sources = new Map(ofType(cj, "source_component").map((s) => [s.source_component_id, s.name as string]));
  const queue = new Map<string, CircuitElement[]>();
  for (const c of ofType(patched, "cad_component").filter((c) => typeof c.model_step_url === "string")) {
    queue.set(c.model_step_url, [...(queue.get(c.model_step_url) ?? []), c]);
  }
  const entities = stepEntities(raw);
  const refs = new Map<number, number>();
  for (const body of entities.values()) for (const m of body.matchAll(/#(\d+)/g)) refs.set(Number(m[1]), (refs.get(Number(m[1])) ?? 0) + 1);
  const rewrite = new Map<number, string>();
  let next = nextEntityId(entities.keys());
  const added: string[] = [];
  for (const [id, body] of entities) {
    const item = /^MAPPED_ITEM\('[^']*',#(\d+),#(\d+)\)$/.exec(body);
    if (!item) continue;
    const rep = /^REPRESENTATION_MAP\(#\d+,#(\d+)\)$/.exec(entities.get(Number(item[1])) ?? "");
    const model = /^ADVANCED_BREP_SHAPE_REPRESENTATION\('((?:[^']|'')*)'/.exec(entities.get(Number(rep?.[1])) ?? "")?.[1].replace(/''/g, "'");
    const cad = model !== undefined ? queue.get(model)?.shift() : undefined;
    if (!cad) continue;
    const instance = map.components[sources.get(cad.source_component_id) ?? ""]?.instance ?? "";
    rewrite.set(id, `MAPPED_ITEM(${stepString(instance)},#${item[1]},#${item[2]})`);
    const target = /^AXIS2_PLACEMENT_3D\('[^']*',#(\d+),(#\d+),(#\d+)\)$/.exec(entities.get(Number(item[2])) ?? "");
    if (!target) continue;
    const { x = 0, y = 0, z = 0 } = cad.position ?? {};
    const point = `CARTESIAN_POINT('',(${[x, y, z].map(stepReal).join(",")}))`;
    if (refs.get(Number(target[1])) === 1) rewrite.set(Number(target[1]), point);
    else {
      added.push(`#${next} = ${point};`);
      rewrite.set(Number(item[2]), `AXIS2_PLACEMENT_3D('',#${next++},${target[2]},${target[3]})`);
    }
  }
  const text = raw.replace(/^#(\d+) = [^\n]*;$/gm, (line, id) => (rewrite.has(Number(id)) ? `#${id} = ${rewrite.get(Number(id))};` : line)).replace(/^(FILE_NAME\('[^']*',)'[^']*'/m, "$1'1970-01-01T00:00:00'");
  if (!added.length) return text;
  const end = text.lastIndexOf("ENDSEC;");
  return text.slice(0, end) + added.join("\n") + "\n" + text.slice(end);
}

export function renders(cj: CircuitElement[]): Record<string, string> {
  return {
    "schematic.svg": convertCircuitJsonToSchematicSvg(cj as never),
    "pcb-top.svg": convertCircuitJsonToPcbSvg(cj as never, { layer: "top" } as never),
    "pcb-bottom.svg": convertCircuitJsonToPcbSvg(cj as never, { layer: "bottom" } as never),
  };
}
