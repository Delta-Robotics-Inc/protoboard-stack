/**
 * What the Inspect tab and the selection callout say about a selected object: fields read from the snapshot, with
 * lengths in millimeters and angles in degrees. Pure, so it is tested without a browser.
 */
import { padsOf, parsePadId, recordsOfKind, toDeg, toMm, netClassOf, type BoardDocument, type FootprintRec, type Provenance } from "./board.js";

export interface Field {
  label: string;
  value: string;
  unit?: string;
}

export interface Inspection {
  kind: string;
  title: string;
  /** The UHD path or the id, under the title. */
  subtitle?: string;
  fields: Field[];
  chips: { text: string; tone?: "solid" | "on" | "pass" | "warn" | "fail" }[];
}

/** A length in nanometers as millimeters: up to three decimals, trailing zeros dropped. */
export function fmtMm(nm: number, digits = 3): string {
  const v = toMm(nm);
  return Number(v.toFixed(digits)).toString();
}
export const fmtDeg = (mdeg: number): string => Number(toDeg(mdeg).toFixed(2)).toString();
const xy = (p: { x: number; y: number }) => `${fmtMm(p.x)}, ${fmtMm(p.y)}`;

export function madeBy(p: Provenance | undefined): string {
  if (!p) return "unknown";
  const by = { generated: "generated", imported: "imported", routed: "router", hand: "a person", agent: "an agent", system: "the system" }[p.by] ?? p.by;
  const tool = p.tool ? ` (${p.tool})` : p.actor ? ` (${p.actor})` : "";
  const edited = p.edited ? `, edited by ${p.edited === "hand" ? "a person" : p.edited === "agent" ? "an agent" : p.edited}` : "";
  return `${by}${tool}${edited}`;
}

function provenanceChip(p: Provenance | undefined, locked: boolean | undefined): Inspection["chips"] {
  const chips: Inspection["chips"] = [];
  if (p?.by === "hand" || p?.edited === "hand") chips.push({ text: "Placed by a person", tone: "solid" });
  else if (p?.by === "routed") chips.push({ text: "Autorouted" });
  else if (p?.by === "agent") chips.push({ text: "Agent", tone: "on" });
  else if (p?.by) chips.push({ text: p.by });
  if (locked) chips.push({ text: "Locked", tone: "solid" });
  return chips;
}

function footprintFields(doc: BoardDocument, fp: FootprintRec): Inspection {
  const fields: Field[] = [
    { label: "Reference", value: fp.ref },
    ...(fp.value ? [{ label: "Value", value: fp.value }] : []),
    { label: "Footprint", value: fp.footprint },
    ...(fp.supplier_part ? [{ label: "LCSC", value: fp.supplier_part }] : []),
    { label: "At", value: xy(fp), unit: "mm" },
    { label: "Rotation", value: fmtDeg(fp.rotation), unit: "°" },
    { label: "Side", value: fp.side },
    { label: "Pads", value: String(fp.pads.length) },
    { label: "Made by", value: madeBy(fp.provenance) },
  ];
  if (fp.courtyard) {
    const xs = fp.courtyard.map((v) => v.x);
    const ys = fp.courtyard.map((v) => v.y);
    fields.splice(5, 0, { label: "Courtyard", value: `${fmtMm(Math.max(...xs) - Math.min(...xs))} × ${fmtMm(Math.max(...ys) - Math.min(...ys))}`, unit: "mm" });
  }
  const nets = new Set(padsOf(fp).map((p) => doc.padNets.get(p.id)).filter(Boolean));
  fields.push({ label: "Nets", value: nets.size ? [...nets].join(", ") : "none" });
  return { kind: "footprint", title: `${fp.ref}${fp.value ? ` · ${fp.value}` : ""}`, ...(fp.path ? { subtitle: fp.path } : { subtitle: fp.id }), fields, chips: provenanceChip(fp.provenance, fp.locked) };
}

/** The inspection of one object id (record or pad), or undefined when the id is not on the board. */
export function inspect(doc: BoardDocument, id: string): Inspection | undefined {
  const padRef = parsePadId(id);
  if (padRef) {
    const fp = doc.records.get(padRef.footprint);
    if (fp?.kind !== "footprint") return undefined;
    const wp = padsOf(fp).find((p) => p.id === id);
    if (!wp) return undefined;
    const p = wp.pad;
    const size =
      p.type === "np"
        ? `hole ${fmtMm(p.hole_diameter ?? 0)}`
        : p.shape === "circle"
          ? `Ø ${fmtMm(p.radius !== undefined ? p.radius * 2 : (p.outer_diameter ?? 0))}`
          : p.shape === "polygon"
            ? `polygon, ${p.points?.length ?? 0} vertices`
            : `${fmtMm(p.width ?? p.outer_width ?? 0)} × ${fmtMm(p.height ?? p.outer_height ?? 0)}`;
    const net = doc.padNets.get(id);
    const fields: Field[] = [
      { label: "Pad", value: `${fp.ref}.${p.number}` },
      { label: "Net", value: net ?? "no net" },
      ...(net ? [{ label: "Class", value: netClassOf(doc, net) }] : []),
      { label: "Type", value: p.type === "smd" ? "surface mount" : p.type === "th" ? "plated through" : "non-plated hole" },
      { label: "Shape", value: p.shape },
      { label: "Size", value: size, unit: p.shape === "polygon" ? undefined : "mm" },
      ...(p.hole_diameter !== undefined && p.type === "th" ? [{ label: "Drill", value: fmtMm(p.hole_diameter), unit: "mm" }] : []),
      ...(p.hole_width !== undefined ? [{ label: "Slot", value: `${fmtMm(p.hole_width)} × ${fmtMm(p.hole_height ?? 0)}`, unit: "mm" }] : []),
      ...(p.corner_radius !== undefined ? [{ label: "Corner", value: fmtMm(p.corner_radius), unit: "mm" }] : []),
      { label: "Layers", value: wp.layers.join(", ") || "none" },
      { label: "At", value: xy(wp), unit: "mm" },
      { label: "Rotation", value: fmtDeg(wp.rotation), unit: "°" },
      ...(p.pin ? [{ label: "Pin", value: p.pin }] : []),
      ...(p.mask_margin !== undefined ? [{ label: "Mask margin", value: fmtMm(p.mask_margin), unit: "mm" }] : []),
    ];
    return { kind: "pad", title: `Pad ${fp.ref}.${p.number}`, subtitle: id, fields, chips: provenanceChip(fp.provenance, fp.locked) };
  }
  const r = doc.records.get(id);
  if (!r) return undefined;
  switch (r.kind) {
    case "footprint":
      return footprintFields(doc, r);
    case "track": {
      const len = r.sweep === undefined ? Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y) : arcLength(r.start, r.end, r.sweep);
      return {
        kind: "track",
        title: `Track · ${r.net ?? "no net"}`,
        subtitle: r.id,
        fields: [
          { label: "Net", value: r.net ?? "no net" },
          ...(r.net ? [{ label: "Class", value: netClassOf(doc, r.net) }] : []),
          { label: "Layer", value: r.layer },
          { label: "Width", value: fmtMm(r.width), unit: "mm" },
          { label: "Length", value: fmtMm(len), unit: "mm" },
          { label: "Start", value: xy(r.start), unit: "mm" },
          { label: "End", value: xy(r.end), unit: "mm" },
          ...(r.sweep !== undefined ? [{ label: "Arc", value: fmtDeg(r.sweep), unit: "°" }] : []),
          { label: "Made by", value: madeBy(r.provenance) },
        ],
        chips: provenanceChip(r.provenance, r.locked),
      };
    }
    case "via":
      return {
        kind: "via",
        title: `Via · ${r.net ?? "no net"}`,
        subtitle: r.id,
        fields: [
          { label: "Net", value: r.net ?? "no net" },
          { label: "Diameter", value: fmtMm(r.outer_diameter), unit: "mm" },
          { label: "Drill", value: fmtMm(r.hole_diameter), unit: "mm" },
          { label: "Annular ring", value: fmtMm((r.outer_diameter - r.hole_diameter) / 2), unit: "mm" },
          { label: "Span", value: `${r.from_layer} to ${r.to_layer}` },
          { label: "At", value: xy(r), unit: "mm" },
          { label: "Tented", value: r.tented ?? "not stated" },
          { label: "Made by", value: madeBy(r.provenance) },
        ],
        chips: provenanceChip(r.provenance, r.locked),
      };
    case "zone":
      return {
        kind: "zone",
        title: `Zone · ${r.name ?? r.net ?? r.id}`,
        subtitle: r.id,
        fields: [
          { label: "Net", value: r.net ?? "no net" },
          { label: "Layers", value: r.layers.join(", ") },
          { label: "Priority", value: String(r.priority) },
          ...(r.clearance !== undefined ? [{ label: "Clearance", value: fmtMm(r.clearance), unit: "mm" }] : []),
          ...(r.min_width !== undefined ? [{ label: "Min width", value: fmtMm(r.min_width), unit: "mm" }] : []),
          { label: "Pads", value: r.pad_connection + (r.thermal_gap !== undefined ? `, gap ${fmtMm(r.thermal_gap)} mm` : "") + (r.thermal_spoke_width !== undefined ? `, spoke ${fmtMm(r.thermal_spoke_width)} mm` : "") },
          { label: "Fill", value: r.fill_mode },
          { label: "Islands", value: r.remove_islands },
          { label: "Vertices", value: String(r.outline.length) },
          { label: "Made by", value: madeBy(r.provenance) },
        ],
        chips: provenanceChip(r.provenance, r.locked),
      };
    case "keepout":
      return {
        kind: "keep-out",
        title: `Keep-out · ${r.name ?? r.id}`,
        subtitle: r.id,
        fields: [
          { label: "Tier", value: r.tier === "no_go" ? "no-go" : "policy" },
          { label: "Layers", value: r.layers.join(", ") },
          { label: "Blocks", value: Object.entries(r.blocks).filter(([, v]) => v).map(([k]) => k).join(", ") || "nothing" },
          ...(r.footprint ? [{ label: "Belongs to", value: r.footprint }] : []),
          ...(r.description ? [{ label: "Why", value: r.description }] : []),
          { label: "Made by", value: madeBy(r.provenance) },
        ],
        chips: [{ text: r.tier === "no_go" ? "No-go" : "Policy", tone: r.tier === "no_go" ? "fail" : "warn" }, ...(r.locked ? [{ text: "Locked", tone: "solid" as const }] : [])],
      };
    case "outline": {
      const xs = r.outline.map((v) => v.x);
      const ys = r.outline.map((v) => v.y);
      return {
        kind: "outline",
        title: "Board outline",
        subtitle: r.source.kind === "cad" ? `from CAD: ${r.source.ref}` : "drawn on the board",
        fields: [
          { label: "Size", value: `${fmtMm(Math.max(...xs) - Math.min(...xs))} × ${fmtMm(Math.max(...ys) - Math.min(...ys))}`, unit: "mm" },
          { label: "Vertices", value: String(r.outline.length) },
          { label: "Cutouts", value: String(recordsOfKind(doc, "cutout").length) },
        ],
        chips: r.locked ? [{ text: "Locked", tone: "solid" }] : [],
      };
    }
    case "graphic":
      return { kind: "graphic", title: `Graphic · ${r.shape}`, subtitle: r.id, fields: [{ label: "Layer", value: r.layer }, { label: "Stroke", value: fmtMm(r.stroke_width), unit: "mm" }, { label: "Made by", value: madeBy(r.provenance) }], chips: provenanceChip(r.provenance, r.locked) };
    case "text":
      return {
        kind: "text",
        title: `Text · ${r.text}`,
        subtitle: r.id,
        fields: [{ label: "Layer", value: r.layer }, { label: "Height", value: fmtMm(r.height), unit: "mm" }, { label: "At", value: xy(r), unit: "mm" }, { label: "Rotation", value: fmtDeg(r.rotation ?? 0), unit: "°" }, { label: "Made by", value: madeBy(r.provenance) }],
        chips: provenanceChip(r.provenance, r.locked),
      };
    case "cutout":
      return { kind: "cutout", title: "Cutout", subtitle: r.id, fields: [{ label: "Vertices", value: String(r.outline.length) }], chips: [] };
    default:
      return undefined;
  }
}

function arcLength(a: { x: number; y: number }, b: { x: number; y: number }, sweep: number): number {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const t = ((Math.abs(sweep) / 1000) * Math.PI) / 180;
  const r = chord / 2 / Math.sin(t / 2);
  return r * t;
}

/** The target track width and clearance a net class plans with (contract section 5: the most specific matching target rule). */
export function classTargets(doc: BoardDocument, cls: string): { width?: number; clearance?: number; widthTier?: string } {
  const rules = recordsOfKind(doc, "rule").filter((r) => r.enabled !== false);
  const pick = (check: string, tier: string) => {
    const matching = rules.filter((r) => r.check === check && r.tier === tier && (!r.applies.classes || r.applies.classes.includes(cls)) && !r.applies.nets && !r.applies.region);
    const specific = matching.filter((r) => r.applies.classes);
    const list = specific.length ? specific : matching;
    return list.sort((a, b) => (b.min ?? 0) - (a.min ?? 0))[0];
  };
  const w = pick("track_width", "target") ?? pick("track_width", "floor");
  const c = pick("clearance", "target") ?? pick("clearance", "floor");
  return { ...(w ? { width: w.preferred ?? w.min, widthTier: w.tier } : {}), ...(c ? { clearance: c.preferred ?? c.min } : {}) };
}
