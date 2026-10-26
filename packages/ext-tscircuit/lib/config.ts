/**
 * Design constraints from `circuit.config.ts` (the `constraints` object),
 * read into one checked shape. They are the provider's inputs that UHD does
 * not hold: the board outline and thickness, mounting holes, where the
 * enclosure fixes connectors, buttons, displays and sensor windows, keep-outs
 * and the copper rules. Later the enclosure's geometry manifest supplies the
 * fixed placements; today they are written in the config.
 *
 * Coordinates are the board frame: mm, +X right and +Y up in the top view,
 * origin where the outline puts it, rotations counter-clockwise in degrees,
 * z = 0 on the board's mid-plane. It is also the board module's own frame, so
 * UHD regions on the board (design_envelope keep-outs) are read in it as they
 * are: when the outline comes from the envelope it spans [0, length] ×
 * [0, width] (the corner origin of UHD's own example, docs/boards-and-nets.md),
 * and a keep-out applies to each copper layer its z range reaches (top copper
 * at z = +thickness/2, bottom at −thickness/2).
 */
import type { DesignEnvelopeTrait } from "@deltarobotics/uhd";

export type Vec2 = [number, number];
export type Side = "top" | "bottom";

export interface Placement {
  at: Vec2;
  rotation_deg: number;
  side: Side;
}

export interface Keepout {
  name: string;
  /** Axis-aligned rectangle (centre and size) or circle. */
  shape: { rect: { at: Vec2; size: Vec2 } } | { circle: { at: Vec2; diameter_mm: number } };
  /** Layers the router keeps clear; copper pours stay out of every keep-out on every layer. */
  layers: CopperLayer[];
  reason?: string;
  /**
   * Components whose bodies may lie over the keep-out (their courtyard is not a placement error
   * there): the module whose own antenna the keep-out clears. Their copper must still stay out.
   */
  allow_bodies?: string[];
  /** Where it was stated. */
  from?: "config" | "envelope";
}

export interface Hole {
  id: string;
  at: Vec2;
  diameter_mm: number;
}

/** Copper rules handed to tscircuit's local router. */
export interface Rules {
  trace_width_mm: number;
  power_trace_width_mm: number;
  via_drill_mm: number;
  via_pad_mm: number;
  edge_clearance_mm: number;
  /** Least distance from a non-plated hole's wall to copper of any net (check only; no default: unchecked beyond touching). */
  hole_clearance_mm?: number;
}

export interface BoardConstraints {
  layers: 2 | 4;
  thickness_mm: number;
  /** Closed polygon, counter-clockwise, no repeated first point. */
  outline: Vec2[];
  /** How the outline was given, for reports. */
  outlineKind: "circle" | "rect" | "polygon" | "envelope";
  holes: Hole[];
  /** Positions the enclosure fixes, by instance path. tscircuit does not move these. */
  placements: Record<string, Placement>;
  keepouts: Keepout[];
  rules: Rules;
  /** Local autorouter preset (never the cloud). */
  autorouter: (typeof LOCAL_AUTOROUTERS)[number];
  /** Copper pours (planes) filled after routing: a net on whole layers, clear of other nets' copper. */
  pours: Pour[];
  /**
   * Vias inside SMD pads: `avoid` (default: the router keeps them out, and check reports any as an
   * error) or `fill_and_cap` (allowed; the fabrication order asks the fab to fill and cap them,
   * IPC-4761 type VII, so they cannot wick solder from the joint).
   */
  via_in_pad: "avoid" | "fill_and_cap";
  /** Vias whose ring touches an SMD pad they do not sit in: `allow` (default) or `avoid` (check reports each). */
  via_touching_pad: "avoid" | "allow";
  /** Vias inside a component's courtyard (under its body): `allow` (default) or `avoid` (check reports each). */
  via_under_body: "avoid" | "allow";
  /** `on` (default) or `off`: no autorouting, placement only (check reports unrouted nets as info). */
  routing: "on" | "off";
  /** Trace width per UHD net id, else per net class (signal, power, ground), else the rules' widths. */
  trace_widths: { nets: Record<string, number>; classes: Partial<Record<"signal" | "power" | "ground", number>> };
}

/** A copper pour: `net` (a UHD net id of the board) over the whole outline of each layer. */
export interface Pour {
  net: string;
  layers: CopperLayer[];
  /** Clearance to other nets' copper (mm); defaults to the trace rule's 0.2 mm. */
  clearance_mm?: number;
  reason?: string;
}

export type CopperLayer = "top" | "bottom" | "inner1" | "inner2";

/** tscircuit autorouter presets that run in this process. `auto_cloud`, `freerouting` and the like upload the design and are refused. */
export const LOCAL_AUTOROUTERS = ["auto_local", "sequential_trace"] as const;

/** Defaults: a common low-cost 2-layer process (0.15 mm traces, 0.3/0.6 mm vias), stated as an assumption in the README. */
export const DEFAULT_RULES: Rules = { trace_width_mm: 0.15, power_trace_width_mm: 0.3, via_drill_mm: 0.3, via_pad_mm: 0.6, edge_clearance_mm: 0.3 };

/** The constraint keys the provider declares (protoboard-extension.json lists the same). */
export const CONSTRAINT_KEYS = ["layers", "thickness_mm", "outline", "mounting_holes", "placements", "keepouts", "rules", "autorouter", "pours", "copper_oz", "finish", "solder_mask", "silkscreen", "assembly", "fab_notes", "via_in_pad", "via_touching_pad", "via_under_body", "routing", "trace_widths"] as const;

/** The width a net's traces get: its own, its class's, else the rules' (power and ground nets the power width; signals tscircuit's default). */
export function traceWidthOf(c: Pick<BoardConstraints, "trace_widths" | "rules">, net: { id: string; kind: "signal" | "power" | "ground" }): number | undefined {
  return c.trace_widths.nets[net.id] ?? c.trace_widths.classes[net.kind] ?? (net.kind !== "signal" ? c.rules.power_trace_width_mm : undefined);
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec2 = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && v.every(isNum);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Signed area of a polygon (positive when counter-clockwise). */
export function polygonArea(points: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Area centroid of a simple polygon. */
export function polygonCentroid(points: Vec2[]): Vec2 {
  const a = polygonArea(points);
  if (Math.abs(a) < 1e-12) return points[0] ?? [0, 0];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [r4(cx / (6 * a)), r4(cy / (6 * a))];
}

/** Point in polygon (even-odd rule). */
export function inside(p: Vec2, poly: Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Circle as a polygon whose edges stay within `tolerance` mm of the true circle (at least 32 segments). */
export function circlePolygon(diameter: number, centre: Vec2 = [0, 0], tolerance = 0.01): Vec2[] {
  const r = diameter / 2;
  const n = Math.max(32, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolerance / r))));
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [r4(centre[0] + r * Math.cos(a)), r4(centre[1] + r * Math.sin(a))] as Vec2;
  });
}

/** Point strictly inside a keep-out's shape. */
export const insideKeepout = (p: Vec2, k: Keepout) => {
  if ("rect" in k.shape) {
    const { at, size } = k.shape.rect;
    return Math.abs(p[0] - at[0]) < size[0] / 2 && Math.abs(p[1] - at[1]) < size[1] / 2;
  }
  return Math.hypot(p[0] - k.shape.circle.at[0], p[1] - k.shape.circle.at[1]) < k.shape.circle.diameter_mm / 2;
};

/** Whether a keep-out and the outline share any area (sampled on a 21 × 21 grid over the keep-out, plus the outline's vertices). */
export function keepoutOverlaps(k: Keepout, outline: Vec2[]): boolean {
  const [[cx, cy], [sx, sy]] = "rect" in k.shape ? [k.shape.rect.at, k.shape.rect.size] : [k.shape.circle.at, [k.shape.circle.diameter_mm, k.shape.circle.diameter_mm]];
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const p: Vec2 = [cx + sx * (i / 20 - 0.5) * 0.999, cy + sy * (j / 20 - 0.5) * 0.999];
      if (insideKeepout(p, k) && inside(p, outline)) return true;
    }
  }
  return outline.some((p) => insideKeepout(p, k));
}

/**
 * Read the config's constraints. Without an outline, the board's
 * `design_envelope` (length × width) gives the rectangle [0, length] ×
 * [0, width], and its keep-outs become copper keep-outs on the layers their
 * z range reaches. `notes` are findings that do not stop generate: a
 * keep-out off the board or between the copper layers.
 */
export function readConstraints(raw: Record<string, unknown>, envelope?: DesignEnvelopeTrait["params"]): { constraints?: BoardConstraints; problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const layers = raw.layers ?? 2;
  if (layers !== 2 && layers !== 4) problems.push(`layers must be 2 or 4 (got ${JSON.stringify(layers)})`);
  const thickness = raw.thickness_mm ?? 1.6;
  if (!isNum(thickness) || thickness <= 0) problems.push("thickness_mm must be a positive number");

  // ---- outline
  let outline: Vec2[] = [];
  let outlineKind: BoardConstraints["outlineKind"] = "polygon";
  const o = raw.outline as Record<string, unknown> | undefined;
  if (o === undefined) {
    const l = envelope?.max_mm.length;
    const w = envelope?.max_mm.width;
    if (isNum(l) && isNum(w)) {
      outline = [[0, 0], [l, 0], [l, w], [0, w]];
      outlineKind = "envelope";
    } else problems.push("no outline: give constraints.outline ({ circle | rect | polygon }) or a design_envelope with length and width on the board");
  } else if (o && typeof o === "object" && "circle" in o) {
    const c = o.circle as { diameter_mm?: unknown; at?: unknown };
    if (!isNum(c?.diameter_mm) || c.diameter_mm <= 0) problems.push("outline.circle needs diameter_mm");
    else {
      outline = circlePolygon(c.diameter_mm, isVec2(c.at) ? c.at : [0, 0]);
      outlineKind = "circle";
    }
  } else if (o && typeof o === "object" && "rect" in o) {
    const r = o.rect as { width_mm?: unknown; height_mm?: unknown; at?: unknown };
    if (!isNum(r?.width_mm) || !isNum(r?.height_mm)) problems.push("outline.rect needs width_mm and height_mm");
    else {
      const [cx, cy] = isVec2(r.at) ? r.at : [0, 0];
      const [hw, hh] = [r.width_mm / 2, r.height_mm / 2];
      outline = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
      outlineKind = "rect";
    }
  } else if (o && typeof o === "object" && "polygon" in o) {
    const p = o.polygon as unknown[];
    if (!Array.isArray(p) || p.length < 3 || !p.every(isVec2)) problems.push("outline.polygon needs at least three [x, y] points (mm)");
    else outline = polygonArea(p as Vec2[]) < 0 ? [...(p as Vec2[])].reverse() : (p as Vec2[]);
  } else problems.push("outline must be { circle: { diameter_mm } }, { rect: { width_mm, height_mm } } or { polygon: [[x, y], …] }");

  // ---- envelope: the outline must fit what the board module requires
  if (outline.length && envelope?.max_mm) {
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    const dx = Math.max(...xs) - Math.min(...xs);
    const dy = Math.max(...ys) - Math.min(...ys);
    const [big, small] = [Math.max(dx, dy), Math.min(dx, dy)];
    const { length, width } = envelope.max_mm;
    const lim = [length, width].filter(isNum).sort((a, b) => b - a);
    if ((lim[0] !== undefined && big > lim[0] + 1e-6) || (lim[1] !== undefined && small > lim[1] + 1e-6)) {
      problems.push(`outline ${r4(dx)} × ${r4(dy)} mm exceeds the board's design envelope ${[length, width].filter(isNum).join(" × ")} mm${envelope.reason ? ` (${envelope.reason})` : ""}`);
    }
  }

  // ---- holes
  const holes: Hole[] = [];
  const rawHoles = (raw.mounting_holes ?? []) as unknown[];
  if (!Array.isArray(rawHoles)) problems.push("mounting_holes must be a list of { id, at: [x, y], diameter_mm }");
  else
    rawHoles.forEach((h, i) => {
      const x = h as Partial<Hole>;
      if (!isVec2(x?.at) || !isNum(x?.diameter_mm)) problems.push(`mounting_holes[${i}] needs at: [x, y] and diameter_mm`);
      else holes.push({ id: typeof x.id === "string" && x.id ? x.id : `hole_${i + 1}`, at: x.at, diameter_mm: x.diameter_mm });
    });

  // ---- fixed placements
  const placements: Record<string, Placement> = {};
  const rawPlacements = (raw.placements ?? {}) as Record<string, unknown>;
  for (const [inst, v] of Object.entries(rawPlacements)) {
    const p = v as { at?: unknown; rotation_deg?: unknown; side?: unknown };
    if (!isVec2(p?.at)) problems.push(`placements.${inst} needs at: [x, y] (mm)`);
    else if (p.rotation_deg !== undefined && !isNum(p.rotation_deg)) problems.push(`placements.${inst}.rotation_deg must be a number`);
    else if (p.side !== undefined && p.side !== "top" && p.side !== "bottom") problems.push(`placements.${inst}.side must be top or bottom`);
    else placements[inst] = { at: p.at, rotation_deg: (p.rotation_deg as number | undefined) ?? 0, side: (p.side as Side | undefined) ?? "top" };
  }

  // ---- keep-outs: the config's, then the envelope's
  const keepouts: Keepout[] = [];
  // config entries with a name and allow_bodies but no shape: bodies allowed over the board module's
  // design_envelope keep-out of that name (UHD keep-outs carry no such list: the module whose own
  // antenna the keep-out clears may lie over it)
  const allowOnEnvelope = new Map<string, { index: number; bodies: string[] }>();
  const rawKeepouts = (raw.keepouts ?? []) as unknown[];
  (Array.isArray(rawKeepouts) ? rawKeepouts : []).forEach((k, i) => {
    const y = k as { name?: unknown; rect?: unknown; circle?: unknown; allow_bodies?: unknown };
    if (y && typeof y === "object" && y.rect === undefined && y.circle === undefined && typeof y.name === "string" && y.allow_bodies !== undefined) {
      if (!Array.isArray(y.allow_bodies) || !y.allow_bodies.length || y.allow_bodies.some((a) => typeof a !== "string")) problems.push(`keepouts[${i}].allow_bodies must be a list of instance paths`);
      else allowOnEnvelope.set(y.name, { index: i, bodies: y.allow_bodies as string[] });
      return;
    }
    const x = k as { name?: unknown; rect?: { at?: unknown; size?: unknown }; circle?: { at?: unknown; diameter_mm?: unknown }; layers?: unknown; reason?: unknown; allow_bodies?: unknown };
    const allow = x?.allow_bodies;
    if (allow !== undefined && (!Array.isArray(allow) || allow.some((a) => typeof a !== "string"))) problems.push(`keepouts[${i}].allow_bodies must be a list of instance paths`);
    const extra = { ...(typeof x?.reason === "string" ? { reason: x.reason } : {}), ...(Array.isArray(allow) && allow.length ? { allow_bodies: allow as string[] } : {}) };
    const name = typeof x?.name === "string" ? x.name : `keepout_${i + 1}`;
    const layers = (Array.isArray(x?.layers) ? x.layers : ["top", "bottom"]) as CopperLayer[];
    const known: CopperLayer[] = raw.layers === 4 ? ["top", "bottom", "inner1", "inner2"] : ["top", "bottom"];
    if (!layers.length || !layers.every((l) => known.includes(l))) problems.push(`keepouts[${i}].layers must list layers of this board (${known.join(", ")})`);
    else if (x?.rect && isVec2(x.rect.at) && isVec2(x.rect.size)) keepouts.push({ name, shape: { rect: { at: x.rect.at, size: x.rect.size } }, layers, ...extra, from: "config" });
    else if (x?.circle && isVec2(x.circle.at) && isNum(x.circle.diameter_mm)) keepouts.push({ name, shape: { circle: { at: x.circle.at, diameter_mm: x.circle.diameter_mm } }, layers, ...extra, from: "config" });
    else problems.push(`keepouts[${i}] needs rect: { at, size } or circle: { at, diameter_mm }`);
  });
  for (const k of envelope?.keep_outs ?? []) {
    const [x0, y0, z0] = k.region.min;
    const [x1, y1, z1] = k.region.max;
    const t = isNum(thickness) ? thickness : 1.6;
    const reaches = (z: number) => Math.min(z0, z1) <= z + 1e-9 && Math.max(z0, z1) >= z - 1e-9;
    const layers: Side[] = [...(reaches(t / 2) ? ["top" as const] : []), ...(reaches(-t / 2) ? ["bottom" as const] : [])];
    if (!layers.length) {
      notes.push(`design_envelope keep-out ${k.name} (z ${Math.min(z0, z1)} to ${Math.max(z0, z1)} mm) reaches neither copper layer (top z = ${t / 2}, bottom z = ${-t / 2} in the board frame); it is not applied`);
      continue;
    }
    const allow = allowOnEnvelope.get(k.name)?.bodies;
    keepouts.push({ name: k.name, shape: { rect: { at: [r4((x0 + x1) / 2), r4((y0 + y1) / 2)], size: [r4(Math.abs(x1 - x0)), r4(Math.abs(y1 - y0))] } }, layers, ...(k.reason ? { reason: k.reason } : {}), ...(allow ? { allow_bodies: allow } : {}), from: "envelope" });
  }
  const envelopeNames = new Set((envelope?.keep_outs ?? []).map((k) => k.name));
  for (const [name, { index }] of allowOnEnvelope) {
    if (!envelopeNames.has(name)) problems.push(`keepouts[${index}] (${name}) gives allow_bodies without a shape, which names a keep-out of the board's design_envelope, and the board has none called ${name}${envelopeNames.size ? ` (it has ${[...envelopeNames].join(", ")})` : ""}`);
  }
  // a keep-out that misses the board protects nothing: most likely stated in another frame
  if (outline.length) {
    for (const k of keepouts) {
      if (!keepoutOverlaps(k, outline)) notes.push(`keep-out ${k.name}${k.from === "envelope" ? " (design_envelope)" : ""} lies entirely outside the board outline, so it protects nothing; keep-outs are in the board frame (${outlineKind === "envelope" ? "the envelope outline spans [0, length] × [0, width]" : "the frame circuit.config.ts gives the outline in"})`);
    }
  }

  // ---- rules and router
  const rules: Rules = { ...DEFAULT_RULES };
  const rawRules = (raw.rules ?? {}) as Record<string, unknown>;
  const ruleKeys = [...Object.keys(DEFAULT_RULES), "hole_clearance_mm"];
  for (const [k, v] of Object.entries(rawRules)) {
    if (!ruleKeys.includes(k)) problems.push(`rules.${k} is not a rule (rules: ${ruleKeys.join(", ")})`);
    else if (!isNum(v) || v <= 0) problems.push(`rules.${k} must be a positive number (mm)`);
    else rules[k as keyof Rules] = v;
  }
  const autorouter = (raw.autorouter ?? "auto_local") as BoardConstraints["autorouter"];
  if (!(LOCAL_AUTOROUTERS as readonly string[]).includes(autorouter)) {
    problems.push(`autorouter ${JSON.stringify(raw.autorouter)} is not a local preset (${LOCAL_AUTOROUTERS.join(", ")}); cloud routing uploads the design and is never used`);
  }

  // ---- copper pours
  const pours: Pour[] = [];
  const rawPours = (raw.pours ?? []) as unknown[];
  if (!Array.isArray(rawPours)) problems.push("pours must be a list of { net, layers }");
  else
    rawPours.forEach((x, i) => {
      const q = x as { net?: unknown; layers?: unknown; clearance_mm?: unknown; reason?: unknown };
      const ok: CopperLayer[] = isNum(layers) && layers === 4 ? ["top", "bottom", "inner1", "inner2"] : ["top", "bottom"];
      if (typeof q?.net !== "string" || !q.net) problems.push(`pours[${i}] needs net: the UHD net id to pour`);
      else if (!Array.isArray(q.layers) || !q.layers.length || !q.layers.every((l) => ok.includes(l as CopperLayer))) problems.push(`pours[${i}].layers must list layers of this board (${ok.join(", ")})`);
      else if (q.clearance_mm !== undefined && (!isNum(q.clearance_mm) || q.clearance_mm <= 0)) problems.push(`pours[${i}].clearance_mm must be a positive number`);
      else pours.push({ net: q.net, layers: q.layers as CopperLayer[], ...(isNum(q.clearance_mm) ? { clearance_mm: q.clearance_mm } : {}), ...(typeof q.reason === "string" ? { reason: q.reason } : {}) });
    });

  // ---- fabrication and assembly order (the Manufacturing Package's board order; optional, defaults stated there)
  if (raw.copper_oz !== undefined && (!isNum(raw.copper_oz) || raw.copper_oz <= 0)) problems.push(`copper_oz must be a positive number (oz/ft² of the outer layers; got ${JSON.stringify(raw.copper_oz)})`);
  for (const k of ["finish", "solder_mask", "silkscreen"] as const) {
    if (raw[k] !== undefined && (typeof raw[k] !== "string" || !(raw[k] as string).trim())) problems.push(`${k} must be a non-empty string (got ${JSON.stringify(raw[k])})`);
  }
  if (raw.fab_notes !== undefined && (!Array.isArray(raw.fab_notes) || raw.fab_notes.some((n) => typeof n !== "string" || !n.trim()))) problems.push(`fab_notes must be a list of non-empty strings (got ${JSON.stringify(raw.fab_notes)})`);
  if (raw.assembly !== undefined && raw.assembly !== "fab" && raw.assembly !== "hand") problems.push(`assembly must be "fab" or "hand" (got ${JSON.stringify(raw.assembly)})`);
  if (raw.via_in_pad !== undefined && raw.via_in_pad !== "avoid" && raw.via_in_pad !== "fill_and_cap") problems.push(`via_in_pad must be "avoid" or "fill_and_cap" (got ${JSON.stringify(raw.via_in_pad)})`);
  for (const k of ["via_touching_pad", "via_under_body"] as const) if (raw[k] !== undefined && raw[k] !== "avoid" && raw[k] !== "allow") problems.push(`${k} must be "avoid" or "allow" (got ${JSON.stringify(raw[k])})`);
  if (raw.routing !== undefined && raw.routing !== "on" && raw.routing !== "off") problems.push(`routing must be "on" or "off" (got ${JSON.stringify(raw.routing)})`);
  // ---- trace widths per net and per class
  const trace_widths: BoardConstraints["trace_widths"] = { nets: {}, classes: {} };
  const tw = raw.trace_widths as { nets?: unknown; classes?: unknown } | undefined;
  if (tw !== undefined) {
    if (!tw || typeof tw !== "object" || Array.isArray(tw) || Object.keys(tw).some((k) => k !== "nets" && k !== "classes")) problems.push("trace_widths must be { nets?: { <net id>: mm }, classes?: { signal?, power?, ground?: mm } }");
    else {
      for (const [k, v] of Object.entries((tw.nets ?? {}) as Record<string, unknown>)) {
        if (!isNum(v) || v <= 0) problems.push(`trace_widths.nets.${k} must be a positive number (mm)`);
        else trace_widths.nets[k] = v;
      }
      for (const [k, v] of Object.entries((tw.classes ?? {}) as Record<string, unknown>)) {
        if (k !== "signal" && k !== "power" && k !== "ground") problems.push(`trace_widths.classes.${k} is not a net class (signal, power, ground)`);
        else if (!isNum(v) || v <= 0) problems.push(`trace_widths.classes.${k} must be a positive number (mm)`);
        else trace_widths.classes[k] = v;
      }
    }
  }

  if (problems.length) return { problems, notes };
  return { constraints: { layers: layers as 2 | 4, thickness_mm: thickness as number, outline: outline.map(([x, y]) => [r4(x), r4(y)]), outlineKind, holes, placements, keepouts, rules, autorouter, pours, via_in_pad: (raw.via_in_pad as "avoid" | "fill_and_cap" | undefined) ?? "avoid", via_touching_pad: (raw.via_touching_pad as "avoid" | "allow" | undefined) ?? "allow", via_under_body: (raw.via_under_body as "avoid" | "allow" | undefined) ?? "allow", routing: (raw.routing as "on" | "off" | undefined) ?? "on", trace_widths }, problems, notes };
}
