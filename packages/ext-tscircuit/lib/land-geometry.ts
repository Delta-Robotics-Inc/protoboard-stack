/**
 * Land-pattern geometry: the entry format, the stencil and mask specs, the
 * verification record, and helpers that lay out pad rows. No table here
 * (land-patterns.ts) and no lookup (footprints.ts).
 */

/** One copper pad, top view, mm, origin at the package centre (pin 1 where the drawing puts it). */
export interface LandPad {
  /** Pin designator as the part states it ("1", "57", "EP"); `""` for a mechanical pad with no pin. */
  pin: string;
  x: number;
  y: number;
  /** Size along X and Y before any part rotation. */
  w: number;
  h: number;
  shape?: "rect" | "pill";
  /**
   * A plated hole through the board inside the pad (a through-hole lead, a
   * connector's shell stake): its size along X and Y, a round hole when equal,
   * a slot otherwise. The pad (w × h) is then the copper ring on every layer.
   */
  drill?: { w: number; h: number };
}

/** A non-plated hole of the land pattern (a locating peg), top view, mm, from the package centre. */
export interface LandHole {
  x: number;
  y: number;
  diameter_mm: number;
}

/** One stencil aperture, footprint frame (top view, mm). */
export interface PasteWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The stencil. Every SMD pad gets an aperture the size of the pad grown by
 * `margin_mm` (0: 1:1, negative: smaller), unless `pins` says otherwise for a
 * pin: its own margin, explicit windows (a thermal pad's window-pane), or none.
 * `plated: true` prints paste on the component's side of its plated holes
 * (pin-in-paste); otherwise they get none.
 */
export interface PasteSpec {
  margin_mm?: number;
  pins?: Record<string, { margin_mm: number } | { windows: PasteWindow[] } | "none">;
  plated?: boolean;
}

/** The solder-mask opening: every pad's opening is the pad grown by `margin_mm` (non-solder-mask-defined). */
export interface MaskSpec {
  margin_mm: number;
}

/** A dimension read off a drawing: exact (±0.01 mm) or a range the drawing allows ([min, max]). */
export type Dim = number | [number, number];

/**
 * What the manufacturer's recommended land pattern states, transcribed from
 * the drawing and cited. `verifyEntry` compares the entry's geometry with it:
 * the pads, their pitch and row spacing, the holes and slots, the courtyard,
 * the paste and the mask. An entry is verified when it has this record and
 * every comparison holds.
 */
export interface LandVerification {
  /** The document: title with revision (or document number), and its URL. */
  document: string;
  url?: string;
  /** Page and figure (or table, or section) the values were read from. */
  page: number | string;
  figure: string;
  /** Who compared it and when (ISO date). */
  checked: string;
  /**
   * Pad groups. Every SMD pad of the entry belongs to exactly one group by
   * its pin (`""` for mechanical pads). `size` is [X, Y] in the entry's frame
   * (either way round is accepted, a rotated row); `merged` means the listed
   * pins' pads together make one land of that size (a connector's paired
   * contacts on one pad, drawn as two halves so each designator has a pad).
   * `pitch_mm`: centre spacing along a row; `row_mm`: centre distance between
   * the outermost parallel rows of the group.
   */
  pads: { pins: string[]; size: [Dim, Dim]; merged?: boolean; pitch_mm?: Dim; row_mm?: Dim }[];
  /** Every pad centre the drawing dimensions, in the drawing's own origin (`origin` is the entry origin in drawing coordinates). */
  centres?: { origin: [number, number]; points: [number, number][] };
  /**
   * Plated slots (drill and copper ring sizes, [X, Y], either way round) and their count; `at`: their
   * centres as the drawing dimensions them, in the entry's frame (one per slot).
   */
  slots?: { drill: [number, number]; pad: [number, number]; count: number; at?: [number, number][] }[];
  /** Round holes: plated (with their pad's diameter) or not; `at` as for slots. */
  holes?: { diameter_mm: number; count: number; plated: boolean; pad_mm?: number; at?: [number, number][] }[];
  /** Courtyard size [X, Y]: the drawing's, or how it was set when the drawing gives none. */
  courtyard: { size_mm: [number, number]; basis: string };
  /** Stencil: the margin for ordinary pads, window counts and sizes per pin, coverage of the pin's pad (fraction). */
  paste: { margin_mm: number; windows?: Record<string, { count: number; size: [number, number]; coverage?: Dim }>; none?: string[]; plated?: boolean; basis: string };
  mask: { margin_mm: number; basis: string };
  notes?: string;
}

/** Where a mating part enters a connector, in the footprint's own frame (tscircuit's names). */
export type Insertion = "from_left" | "from_right" | "from_top" | "from_bottom" | "from_above";

export interface FootprintEntry {
  id: string;
  /**
   * Which UHD packages the entry fits. `package` is compared with the part's
   * package name ignoring case, spaces and dashes; the other fields, when
   * given, must match the part's facts (size within 0.15 mm, either way round;
   * `manufacturer` as a case-blind prefix of the part's manufacturer, for a
   * land pattern one maker recommends for its own parts).
   */
  match: { package: string; pin_count?: number; pitch_mm?: number; size_mm?: [number, number]; manufacturer?: string };
  footprinter?: string;
  pads?: LandPad[];
  /** Non-plated holes the part needs (locating pegs), authored entries only. */
  holes?: LandHole[];
  /** Built-in pad number for a part designator, where they differ. */
  padMap?: Record<string, string>;
  insertion?: Insertion;
  /** Courtyard (keep-clear rectangle around pads and body), mm. Default: pads and body plus 0.25 mm. */
  courtyard_mm?: [number, number];
  /** Centre of the courtyard in the entry's frame when it is not the origin (a module whose body overhangs its pads). */
  courtyard_at?: [number, number];
  /** Stencil apertures; default: 1:1 on every SMD pad, none on plated holes. */
  paste?: PasteSpec;
  /** Solder-mask openings; default: the pad (margin 0). */
  mask?: MaskSpec;
  /** Where the land pattern comes from. */
  source: string;
  /** The checked record against the manufacturer's drawing (see LandVerification); absent: unverified. */
  verification?: LandVerification;
  /** @deprecated free-text note from before structured verification; ignored (an entry without `verification` is unverified). */
  verified?: string | false;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Quad no-lead (QFN/LGA) perimeter pads, pin 1 at the top of the left side,
 * numbered counter-clockwise viewed from the top: left (top → bottom), bottom
 * (left → right), right (bottom → top), top (right → left).
 *
 * `row` is the distance between the centres of opposite pad rows.
 */
export function quadPads(o: { perSide: number; pitch: number; row: number; padLength: number; padWidth: number }): LandPad[] {
  const pads: LandPad[] = [];
  const span = (o.perSide - 1) * o.pitch;
  const c = o.row / 2;
  for (let i = 0; i < o.perSide; i++) {
    const t = span / 2 - i * o.pitch;
    const n = (side: number) => String(side * o.perSide + i + 1);
    pads.push({ pin: n(0), x: r4(-c), y: r4(t), w: o.padLength, h: o.padWidth });
    pads.push({ pin: n(1), x: r4(-t), y: r4(-c), w: o.padWidth, h: o.padLength });
    pads.push({ pin: n(2), x: r4(c), y: r4(-t), w: o.padLength, h: o.padWidth });
    pads.push({ pin: n(3), x: r4(t), y: r4(c), w: o.padWidth, h: o.padLength });
  }
  return pads.sort((a, b) => Number(a.pin) - Number(b.pin));
}

/**
 * Dual no-lead (SON/DFN) pads along X, pin 1 at the left of the bottom row,
 * numbered counter-clockwise viewed from the top.
 */
export function dualPads(o: { perSide: number; pitch: number; row: number; padLength: number; padWidth: number; shape?: LandPad["shape"] }): LandPad[] {
  const pads: LandPad[] = [];
  const span = (o.perSide - 1) * o.pitch;
  for (let i = 0; i < o.perSide; i++) {
    const x = -span / 2 + i * o.pitch;
    pads.push({ pin: String(i + 1), x: r4(x), y: r4(-o.row / 2), w: o.padWidth, h: o.padLength, ...(o.shape ? { shape: o.shape } : {}) });
    pads.push({ pin: String(2 * o.perSide - i), x: r4(x), y: r4(o.row / 2), w: o.padWidth, h: o.padLength, ...(o.shape ? { shape: o.shape } : {}) });
  }
  return pads.sort((a, b) => Number(a.pin) - Number(b.pin));
}
