/**
 * The symbol file format, `protoboard.symbol/v0`: one file per symbol, holding the body drawing, the pins and the
 * metadata. A drawn symbol and a code-built one (src/generate) are the same shape; STYLE.md is the rule book.
 *
 * Coordinates are frame pixels: the frame is Lucide's 24 px box (34 px for the few glyphs that need seven lattice
 * points, any multiple of 5 plus 4 for code-built symbols). Pins sit on the lattice 2, 7, 12, … (one grid unit is
 * 5 frame px), given in lattice units [col, row] from the top-left lattice point.
 */

export const SCHEMA = "protoboard.symbol/v0";

/** One grid unit in frame pixels. */
export const UNIT = 5;
/** The first lattice line, in frame pixels (the frame's 2 px margin). */
export const MARGIN = 2;

/** Which way a pin's lead leaves the body: the outward normal of the frame edge it sits on. `none`: a marker (no-connect, junction). */
export type PinDir = "left" | "right" | "up" | "down" | "none";

/** Electrical pin types (KiCad's, as the stack's KiCad export uses them). */
export type PinType = "input" | "output" | "bidirectional" | "open_collector" | "passive" | "power_in" | "power_out" | "no_connect";

export const PIN_TYPES: readonly PinType[] = ["input", "output", "bidirectional", "open_collector", "passive", "power_in", "power_out", "no_connect"];

export interface SymbolPin {
  /** Stable id the body's leads refer to (`1`, `A`, `K`, `G`, `+`). */
  id: string;
  /** The name shown (code-built symbols) or used for binding (`anode`). */
  name: string;
  /** The usual pin number, where one is standard (two-terminal passives, diodes K=1 A=2). */
  number?: string;
  /** Pads bound to this one pin (a USB-C receptacle's VBUS is A4 A9 B4 B9). */
  pads?: string[];
  /** Lattice point [col, row]. */
  at: [number, number];
  dir: PinDir;
  type: PinType;
  /** Other names a part's pin may carry and still bind here (`gate`, `g`). */
  names?: string[];
  /** Function group (code-built symbols): pins of a group sit together, a blank row between groups. */
  group?: string;
}

/**
 * What a stroke is. The renderer and the checker read roles: leads end on anchors, icons may omit roles, dots are
 * filled.
 *
 *   lead     the stroke from a pin anchor to the body (exactly one per pin, straight segments only)
 *   body     the component's own outline
 *   arrow    a light, motion or adjustment arrow that is part of the convention (LED, photodiode, potentiometer)
 *   mark     a polarity or qualifier mark (+, −, hysteresis, the motor's M): drawn on the schematic, omitted from
 *            an icon when it cannot keep 2 px clear there
 *   link     a magnetic core or mechanical link (transformer core, relay link); same icon rule as `mark`
 *   dot      a filled dot (junction); the only filled shape
 *   pin-name, pin-number, label   text, code-built symbols only
 */
export type Role = "lead" | "body" | "arrow" | "mark" | "link" | "dot" | "pin-name" | "pin-number" | "label";

export const ROLES: readonly Role[] = ["lead", "body", "arrow", "mark", "link", "dot", "pin-name", "pin-number", "label"];

export type ElementKind = "path" | "line" | "polyline" | "polygon" | "circle" | "ellipse" | "rect" | "text";

/** One body element: Lucide's element set (plus text in code-built symbols), no fills, no transforms, no styles. */
export interface BodyElement {
  el: ElementKind;
  d?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: string;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** text only */
  text?: string;
  anchor?: "start" | "middle" | "end";
  size?: number;
  role: Role;
  /** lead only: the pin it belongs to */
  pin?: string;
}

/** The attributes each element kind may carry (besides el, role, pin). Anything else is a format error. */
export const ELEMENT_ATTRS: Record<ElementKind, readonly string[]> = {
  path: ["d"],
  line: ["x1", "y1", "x2", "y2"],
  polyline: ["points"],
  polygon: ["points"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx"],
  text: ["x", "y", "text", "anchor", "size"],
};

export interface Frame {
  w: number;
  h: number;
}

export interface Field {
  /** Lattice units, may be fractional. */
  at: [number, number];
  anchor: "start" | "middle" | "end";
}

export interface Variant {
  name: string;
  /** The drawing convention of this form. */
  convention?: Convention;
  /** A variant may change the frame and the pins (the op amp with power pins); else it keeps the symbol's. */
  frame?: Frame;
  pins?: SymbolPin[];
  body?: BodyElement[];
  /** A variant built by code instead of drawn: the IEC rectangular logic gates. */
  generator?: { name: string; args: Record<string, unknown> };
}

/** ieee: US (IEEE 315 / ANSI Y32.2) form; iec: international (IEC 60617) form; common: both standards draw it alike. */
export type Convention = "ieee" | "iec" | "common";

export interface IconSpec {
  /** `body` (the default form) or a variant's name. */
  from: string;
  /** Roles left out of the icon rendering. */
  omitRoles: Role[];
}

export type Category =
  | "passive"
  | "diode"
  | "transistor"
  | "amplifier"
  | "logic"
  | "reference"
  | "timing"
  | "switch"
  | "transducer"
  | "antenna"
  | "power"
  | "net"
  | "source"
  | "electromechanical"
  | "board"
  | "connector"
  | "ic"
  | "module"
  | "sheet";

export const CATEGORIES: readonly Category[] = [
  "passive",
  "diode",
  "transistor",
  "amplifier",
  "logic",
  "reference",
  "timing",
  "switch",
  "transducer",
  "antenna",
  "power",
  "net",
  "source",
  "electromechanical",
  "board",
  "connector",
  "ic",
  "module",
  "sheet",
];

export interface SymbolDef {
  schema: typeof SCHEMA;
  id: string;
  name: string;
  category: Category;
  /** Reference designator prefix (`R`, `Q`, `#PWR` for power symbols that are not parts). */
  refdes: string;
  /** The convention of the default body. */
  convention: Convention;
  /** `drawn` (a file in pack/) or `generated` (made by src/generate from pin data). */
  origin: "drawn" | "generated";
  frame: Frame;
  pins: SymbolPin[];
  body: BodyElement[];
  variants: Record<string, Variant>;
  fields: { refdes: Field; value: Field };
  icon: IconSpec;
  tags: string[];
  /** Words and pin names that make a part match this symbol. */
  match: { keywords: string[]; pinNames?: string[][] };
  license: string;
  provenance: { author: string; date: string; basis: string; review: "draft" | "approved" };
  /** Anything worth knowing that the drawing cannot say. */
  notes?: string;
}
