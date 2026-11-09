/**
 * Fab profiles as data: file naming, which files form the upload, drill conventions, BOM and placement columns, the
 * fab's published capability limits (which become `floor` rules run through `@protoboardai/board-checks`), the cost
 * drivers to report (counts and implications, never prices), and the rotation corrections table. Updating a fab rule
 * is a data change here; a user adds rotation corrections without touching code (`ExportOptions.rotations`).
 *
 * Every number carries the page it came from and the date it was read. A limit a fab does not publish is left out
 * and reported as "not stated by the fab", never guessed.
 */
import type { RuleCondition, RuleRec } from "@protoboardai/board";

type RuleCheckName = RuleRec["check"];

export interface SourceNote {
  title: string;
  url: string;
  /** The day the page was read (ISO date). */
  checked: string;
  note?: string;
}

/** A capability limit that becomes a board-checks rule (nm), for boards whose copper layer count is in range. */
export interface CapabilityRule {
  key: string;
  check: RuleCheckName;
  tier: "floor" | "target";
  min: number;
  layers?: [number, number];
  between?: ["pad" | "via" | "track" | "zone" | "hole", "pad" | "via" | "track" | "zone" | "hole"];
  when?: RuleCondition;
  priority?: number;
  note: string;
}

/** Limits the board-checks rules do not cover, checked by this package (nm unless stated). */
export interface ExtraLimits {
  /** Minimum solder mask web between openings, by mask color (`*` for any other color). */
  maskWeb?: Record<string, number>;
  silkMinLineWidth?: number;
  silkMinTextHeight?: number;
  npthMinHole?: number;
  platedSlotMinWidth?: { layers: [number, number]; min: number }[];
  nonPlatedSlotMinWidth?: number;
  /** Plated pad annular ring (vias are checked by board-checks), floor and recommended, by layer count. */
  padAnnularRing?: { layers: [number, number]; min: number; recommended?: number }[];
  /** Board size limits (mm x mm as nm), by layer count. */
  minBoardSize?: [number, number];
  maxBoardSize?: { layers: [number, number]; size: [number, number] }[];
  maxLayers?: number;
}

/** A rotation correction: by exact LCSC number (wins) or by a package pattern (a regular expression over the footprint name). */
export interface RotationEntry {
  lcsc?: string;
  package?: string;
  /** Degrees added (counterclockwise) to the placement rotation. */
  rotation: number;
  /** Offset added to the placement, mm, in the part's frame. */
  offset?: { x: number; y: number };
  /** Who verified it and how (for example "JLC placement preview, order 2026-10-22"). */
  source: string;
}

export interface RotationTable {
  about: string;
  entries: RotationEntry[];
  /**
   * Footprint library patterns whose land patterns come from the fab's own library (EasyEDA/LCSC), so their zero
   * orientation is the fab's by construction and the correction is 0.
   */
  fabLibraries: string[];
}

export type BomFormat = "jlcpcb" | "circuithub" | "generic";
export type CplFormat = "jlcpcb" | "generic";

export interface FabProfile {
  id: string;
  title: string;
  sources: SourceNote[];
  /** What the fab takes as the board upload. */
  upload: "gerber-zip" | "ipc2581-or-kicad";
  gerber: {
    x2: "attributes" | "comments";
    /** File names by layer id, `{board}` and `{i}` (inner copper number) substituted. */
    names: Record<string, string>;
    clipSilkToMask: boolean;
  };
  drill: {
    split: "separate" | "merged";
    slotMode: "route" | "g85";
    names: { pth: string; npth: string; mixed: string; span: string };
  };
  assembly: {
    bom: BomFormat;
    cpl: CplFormat;
    /** Rotation convention written: `kicad` (bottom parts as KiCad's position file reports them) or `document`. */
    rotationConvention: "kicad" | "document";
    /** Consigned parts appear in the fab's BOM with an empty supplier part number and the word consigned. */
    consignedInBom: boolean;
  };
  rules: CapabilityRule[];
  limits: ExtraLimits;
  maskColorDefault: string;
  /** Mask colors this fab offers (for the web rule). */
  maskColors: string[];
  rotations?: RotationTable;
  /** Notes the pre-flight shows as info. */
  notes: string[];
}

const mm = (v: number) => Math.round(v * 1e6);
const READ = "2026-11-09";

const KICAD_STYLE_NAMES: Record<string, string> = {
  "copper:top": "{board}-F_Cu.gtl",
  "copper:bottom": "{board}-B_Cu.gbl",
  inner: "{board}-In{i}_Cu.g{i}",
  "soldermask:top": "{board}-F_Mask.gts",
  "soldermask:bottom": "{board}-B_Mask.gbs",
  "paste:top": "{board}-F_Paste.gtp",
  "paste:bottom": "{board}-B_Paste.gbp",
  "legend:top": "{board}-F_Silkscreen.gto",
  "legend:bottom": "{board}-B_Silkscreen.gbo",
  profile: "{board}-Edge_Cuts.gm1",
};

/** The JLCPCB rotation table shipped with the profile. */
export const JLCPCB_ROTATIONS: RotationTable = {
  about:
    "Rotation corrections for JLCPCB placement, keyed by exact LCSC number (wins) or by package pattern. The shipped table holds no numeric corrections: none has been verified against JLCPCB's placement preview for this stack yet, and corrections copied from other tools' lists differ between them. Add verified entries through ExportOptions.rotations; a part with no entry is placed at its board rotation and flagged for a check in the preview, unless its footprint comes from the fab's own library.",
  entries: [],
  fabLibraries: ["^easyeda", "^lcsc", "^jlc"],
};

export const JLCPCB: FabProfile = {
  id: "jlcpcb",
  title: "JLCPCB (PCB and PCBA)",
  sources: [
    { title: "JLCPCB PCB capabilities (rigid)", url: "https://jlcpcb.com/capabilities/pcb-capabilities", checked: READ, note: "trace/space, via, drill, annular ring, slots, hole spacing, edge clearance, mask bridge by color, silkscreen, board size" },
    { title: "JLCPCB: generate the BOM and centroid file from KiCad", url: "https://jlcpcb.com/help/article/how-to-generate-the-bom-and-centroid-file-from-kicad", checked: "2026-11-08", note: "BOM columns Comment, Designator, Footprint, LCSC Part #; CPL columns Designator, Mid X, Mid Y, Layer, Rotation" },
    { title: "JLCPCB: generate Gerber and drill files in KiCad 8", url: "https://jlcpcb.com/help/article/how-to-generate-gerber-and-drill-files-in-kicad-8", checked: "2026-11-08", note: "Protel extensions, subtract mask from silkscreen, alternate drill mode for oval holes (G85), absolute origin, millimeters" },
  ],
  upload: "gerber-zip",
  gerber: { x2: "comments", names: KICAD_STYLE_NAMES, clipSilkToMask: true },
  drill: { split: "separate", slotMode: "g85", names: { pth: "{board}-PTH.drl", npth: "{board}-NPTH.drl", mixed: "{board}.drl", span: "{board}-PTH-{i}-{j}.drl" } },
  assembly: { bom: "jlcpcb", cpl: "jlcpcb", rotationConvention: "kicad", consignedInBom: true },
  rules: [
    { key: "track_width.1-2", check: "track_width", tier: "floor", min: mm(0.1), layers: [1, 2], note: "min trace width 0.10 mm (1 oz, 1-2 layers)" },
    { key: "track_width.4+", check: "track_width", tier: "floor", min: mm(0.09), layers: [3, 64], note: "min trace width 0.09 mm (multilayer)" },
    { key: "clearance.1-2", check: "clearance", tier: "floor", min: mm(0.1), layers: [1, 2], note: "min spacing 0.10 mm (1 oz, 1-2 layers)" },
    { key: "clearance.4+", check: "clearance", tier: "floor", min: mm(0.09), layers: [3, 64], note: "min spacing 0.09 mm (multilayer)" },
    { key: "via_diameter", check: "via_diameter", tier: "floor", min: mm(0.25), note: "min via diameter 0.25 mm (0.2 mm only for boards up to 1 mm thick with ENIG or OSP)" },
    { key: "hole_size", check: "hole_size", tier: "floor", min: mm(0.15), note: "min drill 0.15 mm, vias and plated holes (0.1 mm only for thin boards with ENIG or OSP)" },
    { key: "hole_to_hole", check: "hole_to_hole", tier: "floor", min: mm(0.2), note: "via hole to hole 0.2 mm" },
    { key: "pad_hole_to_hole", check: "hole_to_hole", tier: "floor", min: mm(0.45), priority: 1, when: { all: [{ side: "A", kind: ["pad"] }, { side: "B", kind: ["pad"] }] }, note: "pad hole to hole 0.45 mm" },
    { key: "edge_clearance", check: "edge_clearance", tier: "floor", min: mm(0.2), note: "routed board edge to copper 0.2 mm" },
    { key: "silk_to_pad", check: "silk_to_pad", tier: "target", min: mm(0.15), note: "pad to silkscreen 0.15 mm (JLCPCB clips silkscreen that is nearer)" },
  ],
  limits: {
    maskWeb: { green: mm(0.1), red: mm(0.1), yellow: mm(0.1), blue: mm(0.1), purple: mm(0.1), black: mm(0.13), white: mm(0.13), "*": mm(0.13) },
    silkMinLineWidth: mm(0.15),
    silkMinTextHeight: mm(1.0),
    npthMinHole: mm(0.5),
    platedSlotMinWidth: [
      { layers: [1, 2], min: mm(0.5) },
      { layers: [3, 64], min: mm(0.35) },
    ],
    nonPlatedSlotMinWidth: mm(1.0),
    padAnnularRing: [
      { layers: [1, 2], min: mm(0.18), recommended: mm(0.25) },
      { layers: [3, 64], min: mm(0.15), recommended: mm(0.2) },
    ],
    minBoardSize: [mm(3), mm(3)],
    maxBoardSize: [
      { layers: [1, 1], size: [mm(606), mm(510)] },
      { layers: [2, 2], size: [mm(670), mm(600)] },
      { layers: [3, 4], size: [mm(663), mm(593)] },
      { layers: [5, 64], size: [mm(656), mm(586)] },
    ],
  },
  maskColorDefault: "green",
  maskColors: ["green", "red", "yellow", "blue", "purple", "black", "white"],
  rotations: JLCPCB_ROTATIONS,
  notes: [
    "JLCPCB places each part from its CPL row and lets you check every rotation in its placement preview before paying; check the parts flagged here there.",
    "X2 attributes are written in the comment form (G04 #@! ...), as KiCad writes them by default; JLCPCB's guide is based on that output.",
  ],
};

export const CIRCUITHUB: FabProfile = {
  id: "circuithub",
  title: "CircuitHub (turnkey assembly, US)",
  sources: [
    { title: "CircuitHub: files required for import", url: "https://docs.circuithub.com/importing-a-project/files-required-for-import", checked: READ, note: "KiCad project (.kicad_pro, .kicad_sch, .kicad_pcb), ODB++ or IPC-2581; Gerber files are not accepted on their own, only alongside ODB++ or IPC-2581" },
    { title: "CircuitHub: BOM reconciliation", url: "https://docs.circuithub.com/managing-projects/bom-reconciliation-how-to-complete-your-project-bom", checked: READ, note: "a BOM uploads as .CSV or .TSV; the page names no columns" },
    { title: "CircuitHub: board", url: "https://docs.circuithub.com/board", checked: READ, note: "defaults 1.6 mm, 1 oz, FR4 TG 130-135, black mask, white silkscreen; vias up to 0.3 mm can be filled with mask, larger ones need epoxy or resin fill" },
    { title: "CircuitHub capabilities", url: "https://circuithub.com/capabilities", checked: READ, note: "ENIG default; mask colors listed; no numeric minimums published" },
  ],
  upload: "ipc2581-or-kicad",
  gerber: { x2: "attributes", names: KICAD_STYLE_NAMES, clipSilkToMask: false },
  drill: { split: "separate", slotMode: "route", names: { pth: "{board}-PTH.drl", npth: "{board}-NPTH.drl", mixed: "{board}.drl", span: "{board}-PTH-{i}-{j}.drl" } },
  assembly: { bom: "circuithub", cpl: "generic", rotationConvention: "kicad", consignedInBom: true },
  rules: [],
  limits: {},
  maskColorDefault: "black",
  maskColors: ["red", "yellow", "green", "blue", "purple", "black", "white", "matte-green", "matte-black"],
  notes: [
    "CircuitHub publishes no numeric fabrication minimums on the pages read: no capability rules are checked for it, and the pre-flight says so.",
    "CircuitHub's BOM columns are not named in its documentation; this BOM uses self-describing column names (Designators, Quantity, Manufacturer, MPN, ...).",
  ],
};

export const GENERIC: FabProfile = {
  id: "generic",
  title: "Generic (standard Gerber X2, Excellon, CSV)",
  sources: [{ title: "Gerber Layer Format Specification, revision 2026.05", url: "https://www.ucamco.com/en/gerber/downloads", checked: "2026-11-08" }],
  upload: "gerber-zip",
  gerber: {
    x2: "attributes",
    names: {
      "copper:top": "{board}-Cu-L1-Top.gbr",
      "copper:bottom": "{board}-Cu-Bot.gbr",
      inner: "{board}-Cu-In{i}.gbr",
      "soldermask:top": "{board}-Mask-Top.gbr",
      "soldermask:bottom": "{board}-Mask-Bot.gbr",
      "paste:top": "{board}-Paste-Top.gbr",
      "paste:bottom": "{board}-Paste-Bot.gbr",
      "legend:top": "{board}-Legend-Top.gbr",
      "legend:bottom": "{board}-Legend-Bot.gbr",
      profile: "{board}-Profile.gbr",
    },
    clipSilkToMask: false,
  },
  drill: { split: "separate", slotMode: "route", names: { pth: "{board}-PTH.drl", npth: "{board}-NPTH.drl", mixed: "{board}.drl", span: "{board}-PTH-{i}-{j}.drl" } },
  assembly: { bom: "generic", cpl: "generic", rotationConvention: "kicad", consignedInBom: true },
  rules: [],
  limits: {},
  maskColorDefault: "green",
  maskColors: ["green", "red", "yellow", "blue", "purple", "black", "white"],
  notes: ["The generic profile checks no fab capability: the board's own rules are the only design rules run."],
};

export const PROFILES: Record<string, FabProfile> = { jlcpcb: JLCPCB, circuithub: CIRCUITHUB, generic: GENERIC };

/** A profile by id (or the profile itself). */
export function profileOf(p: string | FabProfile): FabProfile {
  if (typeof p !== "string") return p;
  const found = PROFILES[p.toLowerCase()];
  if (!found) throw new Error(`unknown fab profile ${p} (known: ${Object.keys(PROFILES).join(", ")})`);
  return found;
}

/** The capability rules that apply to a board with `layers` copper layers, as board rule records. */
export function capabilityRules(profile: FabProfile, layers: number): { id: string; kind: "rule"; tier: "floor" | "target"; check: RuleCheckName; min: number; applies: Record<string, unknown>; priority?: number; note: string }[] {
  return profile.rules
    .filter((r) => !r.layers || (layers >= r.layers[0] && layers <= r.layers[1]))
    .map((r) => ({
      kind: "rule" as const,
      id: `rule:fab.${profile.id}.${r.key}`,
      tier: r.tier,
      check: r.check,
      min: r.min,
      applies: { ...(r.between ? { between: r.between } : {}), ...(r.when ? { when: r.when } : {}) },
      ...(r.priority ? { priority: r.priority } : {}),
      note: r.note.slice(0, 500),
    }));
}

/** A profile file name with `{board}`, `{i}`, `{j}` substituted. */
export function nameOf(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}
