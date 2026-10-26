/**
 * generate's writer: board netlist + land patterns + constraints → tscircuit
 * source (TSX), plus the map from tscircuit names back to UHD instance paths
 * and interfaces.
 *
 * The generated file is the provider's native design. Hand work goes in
 * `layout.json` (positions for parts the enclosure does not fix), in
 * `footprints.json` (land-pattern overrides) or in `board.tsx`, which imports
 * the generated board and is never overwritten.
 */
import type { BoardComponent, BoardNetlist } from "@protoboardai/core";
import { traceWidthOf, type BoardConstraints, type Placement } from "./config.ts";
import polygonClipping from "polygon-clipping";
import type { CadModelProp } from "./models.ts";
import type { SupplierNumbers } from "./suppliers.ts";
import { builtinPads, resolveFootprint, type FootprintEntry, type FootprintOverrides, type LandPad } from "./footprints.ts";

/** One stencil aperture in the land pattern's frame (mm); `pill` rounds its short ends. */
export interface PasteAperture {
  x: number;
  y: number;
  w: number;
  h: number;
  pill?: boolean;
}

export const MAP_SCHEMA = "protoboard.tscircuit-map/v0";

/** How the native design's names relate to the UHD board (written as `tscircuit/build.json`). */
export interface NameMap {
  schema: typeof MAP_SCHEMA;
  board: string;
  components: Record<
    string,
    {
      /** UHD instance path. */
      instance: string;
      part: string;
      /** tscircuit pad number (`pinN`) → UHD leaf interface id; null for a mechanical pad with no pin. */
      ports: Record<string, string | null>;
      footprint: string;
      footprintFrom: "instance" | "project" | "provider";
      placement: "fixed" | "layout" | "auto";
      /**
       * Centre of the land pattern's pad extents in its own frame (mm), when it is not the
       * origin. tscircuit centres a component on its pads, so the body's origin (the pattern's)
       * is this far from the component's centre (models.ts).
       */
      padCentre?: [number, number];
      /**
       * The stencil this land pattern asks for (authored entries): every aperture in the
       * pattern's frame, and a pad with a port hint no other pad has, whose position ties the
       * frame to the board (paste.ts). Absent for built-in footprint strings.
       */
      paste?: { apertures: PasteAperture[]; anchor: { hint: string; x: number; y: number } };
      /**
       * Straight copper between the pads of a pin with several (tscircuit port names: `pin49` and its
       * internal ports `pin49_internal_k`), laid on the built board after routing (native.ts joinPads):
       * the router never sees them, so they cannot move the rest of the routing.
       */
      padJoins?: { a: string; b: string; width: number }[];
    }
  >;
  /** tscircuit net name → UHD net id. */
  nets: Record<string, string>;
}

export interface GenerateInput {
  netlist: BoardNetlist;
  constraints: BoardConstraints;
  overrides?: FootprintOverrides;
  /** Positions from `layout.json`, by instance path. */
  layout?: Record<string, Placement>;
  /** Supplier part numbers by instance (suppliers.ts), written as `supplierPartNumbers`. */
  suppliers?: Record<string, SupplierNumbers>;
  /** Body models by instance (models.ts cadModels), written as `cadModel`. */
  models?: Record<string, CadModelProp>;
}

export interface GenerateOutput {
  source: string;
  map: NameMap;
  problems: string[];
  /** Warnings that do not stop generate (a layout.json key that names nothing on the board). */
  notes: string[];
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

/**
 * A part's placement in a sub-module's frame, carried to the board (docs/specs/nested-boards.md §7):
 * a frame on the bottom turns the sub-module over about its own Y axis (x mirrored, rotation negated,
 * side swapped), then the frame's rotation and position apply.
 */
export function inFrame(frame: Placement, local: Placement): Placement {
  const bottom = frame.side === "bottom";
  const [x0, y0] = [bottom ? -local.at[0] : local.at[0], local.at[1]];
  const r0 = bottom ? -local.rotation_deg : local.rotation_deg;
  const a = (frame.rotation_deg * Math.PI) / 180;
  const at: [number, number] = [r4(frame.at[0] + x0 * Math.cos(a) - y0 * Math.sin(a)), r4(frame.at[1] + x0 * Math.sin(a) + y0 * Math.cos(a))];
  const rotation_deg = r4((((r0 + frame.rotation_deg) % 360) + 360) % 360);
  const side = bottom ? (local.side === "bottom" ? "top" : "bottom") : local.side;
  return { at, rotation_deg, side };
}

/**
 * Where a component goes: its own placement (the config's, else layout.json's), carried through the
 * frame of every enclosing sub-module that has one (`groups`: the sub-module paths). Undefined when
 * the component has no placement of its own (tscircuit places it).
 */
export function placementOf(instance: string, groups: Set<string>, own: (key: string) => Placement | undefined): Placement | undefined {
  let p = own(instance);
  if (!p) return undefined;
  const segs = instance.split("/");
  for (let k = segs.length - 1; k >= 1; k--) {
    const path = segs.slice(0, k).join("/");
    const frame = groups.has(path) ? own(path) : undefined;
    if (frame) p = inFrame(frame, p);
  }
  return p;
}

/** The component or sub-module a stale key (a part since moved into a group) most likely means. */
const movedTo = (key: string, paths: string[]) => {
  const hits = paths.filter((p) => p.endsWith(`/${key}`));
  return hits.length === 1 ? hits[0] : undefined;
};

/** A tscircuit-safe identifier (component and net names are CSS-like selectors). */
export function safeName(s: string, prefix: string): string {
  const n = s.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(n) ? n : `${prefix}${n}`;
}

const js = (v: unknown) => JSON.stringify(v);
const mm = (v: number) => `"${+v.toFixed(4)}mm"`;

/** Pad numbers: numeric designators keep their number; others ("EP", "A7") follow the highest one. */
function padNumbers(component: BoardComponent, entry: FootprintEntry): Map<string, string> {
  const designators = new Set([...component.pins.map((p) => p.pin), ...(entry.pads ?? []).map((p) => p.pin).filter(Boolean)]);
  const out = new Map<string, string>();
  if (entry.footprinter) {
    for (const d of designators) out.set(d, entry.padMap?.[d] ?? d);
    return out;
  }
  let next = Math.max(0, ...[...designators].filter((d) => /^\d+$/.test(d)).map(Number)) + 1;
  for (const d of [...designators].sort()) out.set(d, /^\d+$/.test(d) ? d : String(next++));
  return out;
}

function courtyard(pads: LandPad[], component: BoardComponent, entry: FootprintEntry): [number, number] {
  if (entry.courtyard_mm) return entry.courtyard_mm;
  const ext = (k: "x" | "y", s: "w" | "h") => Math.max(...pads.map((p) => Math.abs(p[k]) + p[s] / 2));
  const size = component.package?.size_mm;
  const w = Math.max(2 * ext("x", "w"), size?.length ?? 0) + 0.5;
  const h = Math.max(2 * ext("y", "h"), size?.width ?? 0) + 0.5;
  return [+w.toFixed(3), +h.toFixed(3)];
}

/** Centre of the pads' extents (pad size included), in the pattern's frame. */
function padsCentre(pads: LandPad[]): [number, number] {
  const xs = pads.flatMap((p) => [p.x - p.w / 2, p.x + p.w / 2]);
  const ys = pads.flatMap((p) => [p.y - p.h / 2, p.y + p.h / 2]);
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [r((Math.min(...xs) + Math.max(...xs)) / 2), r((Math.min(...ys) + Math.max(...ys)) / 2)];
}

function footprintJsx(entry: FootprintEntry, numbers: Map<string, string>, component: BoardComponent): string {
  const insertion = entry.insertion ? ` insertionDirection=${js(entry.insertion)}` : "";
  if (entry.footprinter) return entry.insertion ? `<footprint src=${js(entry.footprinter)}${insertion} />` : js(entry.footprinter);
  const pads = entry.pads!;
  const mask = entry.mask ? ` solderMaskMargin=${mm(entry.mask.margin_mm)}` : "";
  let mech = 0;
  const lines = pads.map((p) => {
    const hint = p.pin ? `pin${numbers.get(p.pin)}` : `mp${++mech}`;
    if (p.drill) {
      const hole = p.drill.w === p.drill.h && p.w === p.h
        ? `shape="circle" outerDiameter=${mm(p.w)} holeDiameter=${mm(p.drill.w)}`
        : `shape="pill" outerWidth=${mm(p.w)} outerHeight=${mm(p.h)} holeWidth=${mm(p.drill.w)} holeHeight=${mm(p.drill.h)}`;
      return `          <platedhole ${hole} pcbX=${mm(p.x)} pcbY=${mm(p.y)} portHints={[${js(hint)}]}${mask} />`;
    }
    const shape = p.shape === "pill" ? `shape="pill" width=${mm(p.w)} height=${mm(p.h)} radius=${mm(Math.min(p.w, p.h) / 2)}` : `shape="rect" width=${mm(p.w)} height=${mm(p.h)}`;
    return `          <smtpad ${shape} pcbX=${mm(p.x)} pcbY=${mm(p.y)} portHints={[${js(hint)}]}${mask} />`;
  });
  for (const h of entry.holes ?? []) lines.push(`          <hole diameter=${mm(h.diameter_mm)} pcbX=${mm(h.x)} pcbY=${mm(h.y)} />`);
  const [cw, ch] = courtyard(pads, component, entry);
  const at = entry.courtyard_mm && entry.courtyard_at ? ` pcbX=${mm(entry.courtyard_at[0])} pcbY=${mm(entry.courtyard_at[1])}` : "";
  lines.push(`          <courtyardrect width=${mm(cw)} height=${mm(ch)}${at} />`);
  return `{\n        <footprint${insertion}>\n${lines.join("\n")}\n        </footprint>\n      }`;
}

/**
 * The stencil of an authored land pattern (footprints.ts PasteSpec): each SMD pad's aperture
 * (the pad grown by the margin, the pin's own margin, its windows, or none), and plated holes'
 * rings when the pattern prints pin-in-paste. The anchor is a pad whose port hint is unique.
 */
export function pastePlan(entry: FootprintEntry, numbers: Map<string, string>): { apertures: PasteAperture[]; anchor: { hint: string; x: number; y: number } } {
  const spec = entry.paste ?? {};
  const apertures: PasteAperture[] = [];
  for (const p of entry.pads ?? []) {
    if (p.drill) {
      // the ring: round for a round hole, a pill for a slot
      if (spec.plated) apertures.push({ x: p.x, y: p.y, w: p.w, h: p.h, pill: true });
      continue;
    }
    const own = p.pin ? spec.pins?.[p.pin] : undefined;
    if (own === "none") continue;
    if (own && "windows" in own) {
      apertures.push(...own.windows.map((w) => ({ ...w })));
      continue;
    }
    const m = own && "margin_mm" in own ? own.margin_mm : (spec.margin_mm ?? 0);
    const [w, h] = [p.w + 2 * m, p.h + 2 * m];
    if (w > 0 && h > 0) apertures.push({ x: p.x, y: p.y, w: +w.toFixed(4), h: +h.toFixed(4), ...(p.shape === "pill" ? { pill: true } : {}) });
  }
  const hints = (entry.pads ?? []).map((p) => (p.pin ? `pin${numbers.get(p.pin)}` : ""));
  const i = hints.findIndex((h, k) => h && hints.indexOf(h) === k && hints.lastIndexOf(h) === k);
  const a = (entry.pads ?? [])[Math.max(0, i)];
  return { apertures, anchor: { hint: i >= 0 ? hints[i] : "", x: a.x, y: a.y } };
}

/** Write the tscircuit source for a board netlist. */
export function generateSource(input: GenerateInput): GenerateOutput {
  const { netlist, constraints: c } = input;
  const problems: string[] = [];
  const map: NameMap = { schema: MAP_SCHEMA, board: netlist.board, components: {}, nets: {} };
  const notes: string[] = [];
  const parts: string[] = [];
  const portOf = new Map<string, string>(); // "<instance>:<interface>" → ".name > .pinN"
  const groupPaths = new Set((netlist.groups ?? []).map((g) => g.path));
  const own = (key: string) => c.placements[key] ?? input.layout?.[key];
  const names = new Set<string>();
  const padJoins = new Map<string, [string, string, boolean, string, string][]>(); // "<instance>:<interface>" → joins of the pin's pads (straight when clear)

  for (const comp of netlist.components) {
    // a sub-module path is not a tscircuit name: `led1/r1` is `led1_r1`, and a collision gets `_` appended
    let name = safeName(comp.instance, "c_");
    while (names.has(name)) name += "_";
    names.add(name);
    const { entry, from, near } = resolveFootprint(comp.instance, comp.package ? { ...comp.package, name: comp.package.name, manufacturer: comp.manufacturer } : undefined, input.overrides);
    if (!entry) {
      problems.push(
        comp.package
          ? `${comp.instance} (${comp.part}): no land pattern for package ${comp.package.name} (${comp.package.pin_count} pins${comp.package.pitch_mm ? `, ${comp.package.pitch_mm} mm pitch` : ""})${near?.length ? `; entries of that package do not fit its facts: ${near.join("; ")}` : ""}; add one to tscircuit/footprints.json`
          : `${comp.instance} (${comp.part}): the part states no package (UHD mechanical domain \`package\`), so no land pattern can be chosen; add the package fact to the part, or an instance entry to tscircuit/footprints.json`,
      );
      continue;
    }
    const numbers = padNumbers(comp, entry);
    const builtin = entry.footprinter ? builtinPads(entry.footprinter) : undefined;
    const ports: Record<string, string | null> = {};
    for (const p of comp.pins) {
      const n = numbers.get(p.pin)!;
      if (entry.pads && !entry.pads.some((x) => x.pin === p.pin)) problems.push(`${comp.instance}: land pattern ${entry.id} has no pad for pin ${p.pin} (${p.name})`);
      if (entry.footprinter && !builtin!.has(n)) problems.push(`${comp.instance}: land pattern ${entry.id} (built-in "${entry.footprinter}", pads ${[...builtin!].join(", ") || "none"}) has no pad ${n} for pin ${p.pin} (${p.name})`);
      ports[n] = p.interface;
      portOf.set(`${comp.instance}:${p.interface}`, `.${name} > .pin${n}`);
    }
    for (const p of entry.pads ?? []) if (p.pin && !comp.pins.some((x) => x.pin === p.pin)) ports[numbers.get(p.pin)!] = null;
    // a pin with several pads (a module's grid of exposed ground pads): tscircuit binds the pin's port to its
    // first pad and gives each other pad an internal port, pinN_internal_1…, in pad order. The pads are joined to
    // each other by the shortest tree over their centres (each pad to its nearest already joined one). A join
    // clear of every other pad is straight copper laid on the built board after routing (NameMap padJoins,
    // native.ts): the router never sees it, so the rest of the board routes as before; the pin's own port
    // carries the net
    // Only SMD pads: a pin's plated holes (a receptacle's shell stakes) are joined by the part's own metal.
    // A join whose straight line would pass another pin's pad is left to the router instead.
    for (const p of comp.pins) {
      const all = (entry.pads ?? []).filter((x) => x.pin === p.pin);
      if (all.length < 2 || !portOf.has(`${comp.instance}:${p.interface}`)) continue;
      const n = numbers.get(p.pin)!;
      const index = new Map(all.map((x, k) => [x, k]));
      const pads = all.filter((x) => !x.drill);
      if (pads.length < 2) continue;
      const port = (k: number) => (k === 0 ? `pin${n}` : `pin${n}_internal_${k}`);
      const sel = (k: number) => `.${name} > .${port(k)}`;
      const others = (entry.pads ?? []).filter((x) => x.pin !== p.pin);
      const clear = (a: LandPad, b: LandPad) => {
        for (let t = 0; t <= 20; t++) {
          const [x, y] = [a.x + ((b.x - a.x) * t) / 20, a.y + ((b.y - a.y) * t) / 20];
          if (others.some((o) => Math.abs(x - o.x) < o.w / 2 + 0.3 && Math.abs(y - o.y) < o.h / 2 + 0.3)) return false;
        }
        return true;
      };
      const joined = [0];
      const joins: [string, string, boolean, string, string][] = [];
      while (joined.length < pads.length) {
        let best: [number, number, number] | undefined;
        for (let k = 0; k < pads.length; k++) {
          if (joined.includes(k)) continue;
          for (const j of joined) {
            const d = Math.hypot(pads[k].x - pads[j].x, pads[k].y - pads[j].y);
            if (!best || d < best[2] - 1e-9) best = [k, j, d];
          }
        }
        joined.push(best![0]);
        const [a, b] = [pads[best![0]], pads[best![1]]];
        joins.push([sel(index.get(a)!), sel(index.get(b)!), clear(a, b), port(index.get(a)!), port(index.get(b)!)]);
      }
      padJoins.set(`${comp.instance}:${p.interface}`, joins);
    }

    const fixed = c.placements[comp.instance];
    const place = groupPaths.size ? placementOf(comp.instance, groupPaths, own) : (fixed ?? input.layout?.[comp.instance]);
    const padCentre = entry.pads?.length ? padsCentre(entry.pads) : undefined;
    map.components[name] = {
      instance: comp.instance,
      part: comp.part,
      ports,
      footprint: entry.id,
      footprintFrom: from!,
      placement: fixed ? "fixed" : place ? "layout" : "auto",
      ...(padCentre && (Math.abs(padCentre[0]) > 1e-6 || Math.abs(padCentre[1]) > 1e-6) ? { padCentre } : {}),
      ...(entry.pads?.length ? { paste: pastePlan(entry, numbers) } : {}),
    };

    const props: string[] = [`name=${js(name)}`];
    if (place) props.push(`pcbX={${place.at[0]}}`, `pcbY={${place.at[1]}}`, `pcbRotation={${place.rotation_deg}}`, ...(place.side === "bottom" ? [`layer="bottom"`] : []));
    if (comp.mpn) props.push(`manufacturerPartNumber=${js(comp.mpn)}`);
    const suppliers = input.suppliers?.[comp.instance];
    if (suppliers && Object.keys(suppliers).length) props.push(`supplierPartNumbers={${js(suppliers)}}`);
    const model = input.models?.[comp.instance];
    if (model) props.push(`cadModel={${js(model)}}`);
    const passive = comp.value && ["resistor", "capacitor", "inductor"].includes(comp.kind);
    if (passive) {
      const key = { resistor: "resistance", capacitor: "capacitance", inductor: "inductance" }[comp.kind as "resistor"];
      props.push(`${key}={${comp.value!.value}}`);
    } else {
      const labels: Record<string, string> = {};
      const attrs: Record<string, Record<string, boolean | undefined>> = {};
      const used = new Set<string>();
      for (const p of comp.pins) {
        const n = numbers.get(p.pin)!;
        let label = safeName(p.name, "P_");
        if (used.has(label) || /^pin\d+$/.test(label)) label = `${label}_${safeName(p.pin, "")}`;
        used.add(label);
        labels[`pin${n}`] = label;
        const a = { power_in: { requiresPower: true }, power_out: { providesPower: true }, ground: { requiresGround: true }, nc: { doNotConnect: true }, passive: { isPassive: true }, signal: undefined }[p.kind];
        if (a) attrs[`pin${n}`] = a;
      }
      props.push(`pinLabels={${js(labels)}}`);
      if (Object.keys(attrs).length) props.push(`pinAttributes={${js(attrs)}}`);
    }
    const tag = passive ? comp.kind : comp.kind === "connector" ? "connector" : "chip";
    parts.push(`      {/* ${comp.instance}: ${comp.part}${comp.package ? `, ${comp.package.name}` : ""}; land pattern ${entry.id} (${from}) */}\n      <${tag}\n        ${props.join("\n        ")}\n        footprint=${footprintJsx(entry, numbers, comp)}\n      />`);
  }

  const paths = [...netlist.components.map((x) => x.instance), ...groupPaths];
  for (const inst of Object.keys(c.placements)) {
    if (netlist.components.some((x) => x.instance === inst) || groupPaths.has(inst)) continue;
    const moved = movedTo(inst, paths);
    problems.push(`placements.${inst}: the board has no component ${inst}${moved ? ` (it is ${moved} now: a part in a sub-module is keyed by its path)` : ""}`);
  }
  for (const key of Object.keys(input.layout ?? {})) {
    if (paths.includes(key)) continue;
    const moved = movedTo(key, paths);
    notes.push(`layout.json: ${key} names no component or sub-module of the board${moved ? `; it is ${moved} now (a part in a sub-module is keyed by its path)` : ""}, so it places nothing`);
  }

  // ---- nets: every pin joins its net by name, so the native netlist stays keyed to UHD
  const nets: string[] = [];
  const traces: string[] = [];
  const used = new Set<string>();
  for (const net of netlist.nets) {
    let name = safeName(net.id, "N_");
    while (used.has(name)) name += "_";
    used.add(name);
    map.nets[name] = net.id;
    const width = traceWidthOf(c, net);
    const attrs = [net.kind === "ground" ? "isGroundNet" : net.kind === "power" ? "isPowerNet" : "", width !== undefined ? `nominalTraceWidth=${mm(width)}` : ""].filter(Boolean);
    nets.push(`      <net name=${js(name)}${attrs.length ? " " + attrs.join(" ") : ""} />`);
    for (const pin of net.pins) {
      const sel = portOf.get(pin);
      if (sel) traces.push(`      <trace from=${js(sel)} to=${js(`net.${name}`)} />`);
      // straight copper between neighbouring pads of the pin, laid by core and never handed to the router
      for (const [a, b, straight, pa, pb] of padJoins.get(pin) ?? []) {
        if (!straight) traces.push(`      <trace from=${js(a)} to=${js(b)}${width !== undefined ? ` thickness=${mm(width)}` : ""} />`);
        else {
          const comp = map.components[a.split(" > ")[0].slice(1)];
          (comp.padJoins ??= []).push({ a: pa, b: pb, width: width ?? c.rules.trace_width_mm });
        }
      }
    }
  }

  for (const id of Object.keys(c.trace_widths.nets)) if (!netlist.nets.some((n) => n.id === id)) problems.push(`trace_widths.nets.${id}: the board has no net ${id}`);

  // ---- copper pours: filled after routing around the other nets' copper, inside the outline less every
  // keep-out (a keep-out is no copper on any layer, so an antenna clearance holds on the planes too)
  const pours: string[] = [];
  const pourAreas = pourOutlines(c);
  if (c.pours?.length && pourAreas.holes) problems.push("pours: a keep-out lies wholly inside the board, which a pour outline cannot leave out; move it to the edge or drop the pour");
  for (const [i, pour] of (c.pours ?? []).entries()) {
    const name = Object.entries(map.nets).find(([, id]) => id === pour.net)?.[0];
    if (!name) {
      problems.push(`pours[${i}]: the board has no net ${pour.net}`);
      continue;
    }
    for (const layer of pour.layers)
      pourAreas.outlines.forEach((ring, k) =>
        pours.push(
          `      <copperpour name=${js(`pour_${name}_${layer}${pourAreas.outlines.length > 1 ? `_${k + 1}` : ""}`)} layer=${js(layer)} connectsTo=${js(`net.${name}`)} boardEdgeMargin=${mm(c.rules.edge_clearance_mm + 0.02)}${pour.clearance_mm ? ` clearance=${mm(pour.clearance_mm)}` : ""} outline={${js(ring.map(([x, y]) => ({ x, y })))}} />`,
        ),
      );
  }

  const holes = c.holes.map((h) => `      <hole name=${js(safeName(h.id, "H_"))} diameter=${mm(h.diameter_mm)} pcbX={${h.at[0]}} pcbY={${h.at[1]}} />`);
  const keepouts = c.keepouts.flatMap((k) => {
    const exclude = k.allow_bodies?.length ? ` excludeRefs={${js(k.allow_bodies.map((i) => `.${safeName(i, "c_")}`))}}` : "";
    return k.layers.map((layer) =>
      "rect" in k.shape
        ? `      <keepout shape="rect" width=${mm(k.shape.rect.size[0])} height=${mm(k.shape.rect.size[1])} pcbX={${k.shape.rect.at[0]}} pcbY={${k.shape.rect.at[1]}} layer=${js(layer)}${exclude} />`
        : `      <keepout shape="circle" radius=${mm(k.shape.circle.diameter_mm / 2)} pcbX={${k.shape.circle.at[0]}} pcbY={${k.shape.circle.at[1]}} layer=${js(layer)}${exclude} />`,
    );
  });

  const outline = c.outline.map(([x, y]) => ({ x, y }));
  const source = `// @ts-nocheck
// GENERATED by @protoboardai/ext-tscircuit (circuit:generate) from the UHD board module ${netlist.board}.
// Do not edit: it is rewritten on every generate. Change the board module, circuit.config.ts,
// tscircuit/layout.json or tscircuit/footprints.json instead, or hand-edit tscircuit/board.tsx.
// Board frame: mm, +X right, +Y up (top view), origin at the outline's origin.

export const OUTLINE = ${js(outline)}

export default function Board() {
  return (
    <board
      outline={OUTLINE}
      layers={${c.layers}}
      thickness=${mm(c.thickness_mm)}
      minTraceWidth=${mm(c.rules.trace_width_mm)}
      minViaHoleDiameter=${mm(c.rules.via_drill_mm)}
      minViaPadDiameter=${mm(c.rules.via_pad_mm)}
      minBoardEdgeClearance=${mm(c.rules.edge_clearance_mm)}
      autorouter=${js(c.autorouter)}${c.via_in_pad === "fill_and_cap" ? "\n      isViaInPadAllowed" : ""}${c.routing === "off" ? "\n      routingDisabled" : ""}
    >
${[...holes, ...keepouts, ...parts, ...nets, ...traces, ...pours].join("\n")}
    </board>
  )
}
`;
  return { source, map, problems, notes };
}

/** The entry file written once next to the generated source; hand edits go here. */
export const ENTRY_SOURCE = `// @ts-nocheck
// The board's tscircuit entry. circuit:generate writes this file once and never overwrites it:
// edit it to wrap or replace the generated board (board.gen.tsx), which is rewritten on every generate.
export { default } from "./board.gen.tsx"
`;

/** The areas a pour may fill: the board outline less every keep-out, as simple rings (`holes` when a keep-out is enclosed). */
export function pourOutlines(c: Pick<BoardConstraints, "outline" | "keepouts">): { outlines: [number, number][][]; holes: boolean } {
  const ring = (pts: [number, number][]) => [...pts, pts[0]];
  const cut = c.keepouts.map((k) => {
    if ("rect" in k.shape) {
      const { at, size } = k.shape.rect;
      const [x0, x1, y0, y1] = [at[0] - size[0] / 2, at[0] + size[0] / 2, at[1] - size[1] / 2, at[1] + size[1] / 2];
      return [ring([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])];
    }
    const { at, diameter_mm } = k.shape.circle;
    return [ring(Array.from({ length: 48 }, (_, i) => [at[0] + (diameter_mm / 2) * Math.cos((2 * Math.PI * i) / 48), at[1] + (diameter_mm / 2) * Math.sin((2 * Math.PI * i) / 48)] as [number, number]))];
  });
  const outline = [ring(c.outline as [number, number][])];
  const result = cut.length ? polygonClipping.difference(outline as never, ...(cut as never[])) : [outline];
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    outlines: (result as [number, number][][][]).map((poly) => poly[0].slice(0, -1).map(([x, y]) => [r4(x), r4(y)] as [number, number])),
    holes: (result as unknown[][]).some((poly) => poly.length > 1),
  };
}
