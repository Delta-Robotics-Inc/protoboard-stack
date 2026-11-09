/**
 * What passes between the schematic screen (a page) and its host (Node: the dev server, the schematic dev page's
 * server, the VS Code extension host). Pure types; no DOM, no Node. The host is the schematic service's client and
 * draws every item with the schematic package's own renderer (`drawRecord`), so the screen and the exported images
 * cannot drift; the page holds plain records, geometry and markup, and never runs the schematic core itself.
 *
 * Units are grid units (gu, 2.54 mm), +Y down, boxes `[x0, y0, x1, y1]`.
 */

export type XY = [number, number];
export type Box = [number, number, number, number];
export type Dir = "left" | "right" | "up" | "down";

/** A schematic the host can open: one per UHD board of the project. */
export interface SchematicEntry {
  key: string;
  /** the schematic folder relative to the project root */
  dir: string;
  name: string;
  /** the UHD board module id */
  board: string;
  /** the layout board folder's key (board routes) when the board has one: the switcher's Layout goes there */
  layoutKey?: string;
  /** whether the folder holds a schematic yet (absent: the first open lays it out, and nothing is saved until a person saves) */
  saved?: boolean;
}

/** One pin as the page sees it. */
export interface PagePin {
  key: string;
  /** every part pin on this symbol pin */
  keys: string[];
  part: string;
  pin: string;
  at: XY;
  dir: Dir;
  net?: string;
  name: string;
  number: string;
  type: string;
}

/** A drawn record with its markup and the geometry the page needs to pick, select and drag it. */
export interface PageItem {
  id: string;
  kind: "card" | "symbol" | "wire" | "label" | "power" | "noconnect";
  /** the stored record, as the service holds it */
  rec: Record<string, unknown> & { kind: string; id: string };
  card?: string;
  net?: string;
  pinned?: boolean;
  /** the pick box */
  box: Box;
  /** markup in sheet coordinates (a symbol's body only) */
  svg: string;
  /** a symbol's pin names and numbers, in its own frame (`transform`) */
  pinText?: string;
  transform?: string;
  /** a symbol's reference and value */
  fields?: string;
  fieldBox?: Box;
  /** a symbol's body box */
  body?: Box;
  pins?: PagePin[];
  /** a card's title tag box */
  tag?: Box;
}

/** A part of the circuit (from UHD), for the panels. */
export interface PagePart {
  path: string;
  ref: string;
  name: string;
  part: string;
  class: string;
  value?: string;
  mpn?: string;
  categories?: string[];
  group: string;
  pins: { id: string; number: string; name: string; type: string; voltage?: { min?: number; max?: number; nominal?: number }; functions?: string; capabilities?: string[]; net?: string; open?: string }[];
  /** where its symbol came from: `pack:<id>` or a generated family */
  symbol: { source: "pack" | "generated"; id: string; variant?: string };
}

export interface PageNet {
  name: string;
  /** what labels and power symbols show */
  shown: string;
  kind: "ground" | "power" | "signal";
  cls: string;
  voltage?: { min?: number; max?: number; nominal?: number };
  pins: string[];
  cards: string[];
}

/** Everything the page draws, at one seq. */
export interface PageModel {
  epoch: string;
  seq: number;
  theme: "dark";
  /** the drawn sheet's bounds */
  bounds: Box;
  items: PageItem[];
  junctions: { at: XY; net: string }[];
  /** signal class colors and the highlight, from the renderer's tokens */
  colors: Record<string, string>;
  highlight: string;
  ghost: { before: string; after: string };
  severity: Record<"gate" | "error" | "warning" | "info", string>;
  parts: PagePart[];
  nets: PageNet[];
  name: string;
  board: string;
  /** the circuit's hash differs from the one the layout was made against */
  stale?: boolean;
  /** nothing laid out yet in the folder: the host laid it out in memory and has saved nothing */
  firstOpen?: boolean;
}

export interface PageLogEntry {
  seq: number;
  label: string;
  actor: { kind: string; id: string; name?: string };
  changeSet?: string;
  undoOf?: number;
  redoOf?: number;
  changed: number;
}

export interface PageDefect {
  n: number;
  id: string;
  rule: string;
  title: string;
  severity: "gate" | "error" | "warning" | "info";
  card?: string;
  cardTitle?: string;
  at: XY;
  objects: string[];
  message: string;
  points: number;
}

export interface PageFinding {
  id: string;
  check: string;
  severity: "error" | "warning" | "info";
  objects: string[];
  at?: XY;
  card?: string;
  path?: string[];
  message: string;
}

/** The score, the gates and the findings at one seq. */
export interface PageDerived {
  seq: number;
  score: number;
  presentable: boolean;
  gates: { open: number; rules: string[] };
  rules: { id: string; title: string; severity: string; count: number; opportunities: number }[];
  /** the six gates C01 to C06 with their counts */
  gateRules: { id: string; title: string; count: number }[];
  defects: PageDefect[];
  findings: PageFinding[];
  cards: Record<string, number>;
  ms: number;
}

/** A candidate fix for a defect, with its ghost. */
export interface PageFix {
  index: number;
  title: string;
  rule: string;
  ops: { op: string; [k: string]: unknown }[];
  before: number;
  after: number;
  delta: number;
  resolved: boolean;
  ghost: string;
}

/** A bounded cleanup pass run on a copy: what it would change, as one ghost, before anything is written. */
export interface PageCleanup {
  id: string;
  before: { score: number; gates: number };
  after: { score: number; gates: number };
  passes: number;
  steps: { defect: string; rule: string; title: string; ops: number; before: number; after: number }[];
  stopped: string;
  ghost: string;
  /** set once a person applied it: the change set `revert` undoes */
  applied?: { changeSet: string; seq: number };
}

export type SchematicFeedMessage =
  | { type: "snapshot"; key: string; model: PageModel; log: PageLogEntry[]; saved?: number; mode: "service" | "local" }
  | { type: "commit"; key: string; seq: number; epoch: string; entry: PageLogEntry; puts: PageItem[]; removes: string[]; junctions: PageModel["junctions"]; bounds: Box; parts?: PagePart[] }
  | { type: "derived"; key: string; derived: PageDerived }
  | { type: "saved"; key: string; seq: number; files: string[] }
  | { type: "checkpoint"; key: string; seq: number; label: string; committed?: string; error?: string }
  | { type: "presence"; key: string; leases: { holder: string; purpose: string; expiresAt: number }[] }
  | { type: "error"; key: string; message: string };

/** What a page may ask its host; the host decides who acts (a person). */
export type SchematicRequest =
  | { method: "apply"; tx: { batchId: string; label: string; ops: { op: string; [k: string]: unknown }[] } }
  | { method: "move"; ids: string[]; dx: number; dy: number }
  | { method: "rotate"; ids: string[]; angle: 90 | 180 | 270 }
  | { method: "mirror"; ids: string[] }
  | { method: "moveField"; id: string; dx: number; dy: number }
  | { method: "drawWire"; net: string; card: string; points: XY[] }
  | { method: "editWire"; id: string; points: XY[] }
  | { method: "undo" }
  | { method: "redo" }
  | { method: "save" }
  | { method: "checkpoint"; label: string }
  | { method: "fixes"; defect: string }
  | { method: "acceptFix"; defect: string; index: number }
  | { method: "cleanupPreview"; budget?: number; card?: string }
  | { method: "cleanupApply"; id: string }
  | { method: "cleanupRevert"; id: string };

export interface SchematicReply {
  ok: boolean;
  status?: string;
  message?: string;
  error?: string;
  seq?: number;
  fixes?: PageFix[];
  cleanup?: PageCleanup;
  svg?: string;
  committed?: string;
}
