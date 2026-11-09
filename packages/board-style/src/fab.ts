/**
 * Fab profiles for the guard rails: what each fab offers and its published minimums, each value with where it came
 * from. `verified` values were read on the fab's capability page; `reported` ones come from secondary sources and
 * are marked so in every message that uses them; `assumed` ones are not stated by the fab and fall back to another
 * fab's value, said so.
 */

export type Evidence = "verified" | "reported" | "assumed";

export interface FabValue<T> {
  value: T;
  evidence: Evidence;
  source: string;
}

export interface FabProfile {
  id: "jlcpcb" | "circuithub";
  name: string;
  /** Mask colors the fab offers (token values). */
  maskColors: FabValue<readonly string[]>;
  finishes: FabValue<readonly string[]>;
  /** Cost class of each finish: base, plus (a surcharge), quote (on request). */
  finishCost: Record<string, { cost: "base" | "plus" | "quote"; evidence: Evidence; note?: string }>;
  silk: {
    minLine: FabValue<number>;
    minTextHeight: FabValue<number>;
    /** Least stroke to height ratio (1/6 means a 1.0 mm text needs at least a 0.167 mm stroke). */
    strokeRatio: FabValue<number>;
    padClearance: FabValue<number>;
  };
  /** Minimum mask web between openings (mm) for a mask color and outer copper weight. */
  maskWeb(color: string, copperOz: number): FabValue<number>;
  /** Black silk needs a white mask. */
  blackSilkNeedsWhiteMask: FabValue<boolean>;
  /** Full-color silk, when offered: its conditions. */
  fullColor?: { maskColor: string; finish: string; minLayers: number; maxLayers: number; export: string; evidence: Evidence; source: string };
}

const JLC_CAP = "jlcpcb.com/capabilities/pcb-capabilities";
const CH_CAP = "circuithub.com/capabilities/design-rules";

export const FAB_PROFILES: Record<FabProfile["id"], FabProfile> = {
  jlcpcb: {
    id: "jlcpcb",
    name: "JLCPCB",
    // matte black is how JLCPCB's black is ordered and described on order records; the capability page says "Black"
    maskColors: { value: ["green", "purple", "red", "yellow", "blue", "white", "black", "matteBlack"], evidence: "verified", source: JLC_CAP },
    finishes: { value: ["HASL", "HASL-LF", "ENIG", "OSP"], evidence: "verified", source: JLC_CAP },
    finishCost: {
      HASL: { cost: "base", evidence: "verified" },
      "HASL-LF": { cost: "base", evidence: "verified" },
      ENIG: { cost: "plus", evidence: "reported", note: "a surcharge on small runs (reported)" },
      OSP: { cost: "base", evidence: "reported" },
    },
    silk: {
      minLine: { value: 0.15, evidence: "verified", source: JLC_CAP },
      minTextHeight: { value: 1.0, evidence: "verified", source: JLC_CAP },
      strokeRatio: { value: 1 / 6, evidence: "verified", source: JLC_CAP },
      padClearance: { value: 0.15, evidence: "verified", source: JLC_CAP },
    },
    maskWeb(color, oz) {
      if (oz >= 2) return { value: 0.2, evidence: "verified", source: `${JLC_CAP} (2 oz copper)` };
      if (color === "black" || color === "matteBlack" || color === "white") return { value: 0.13, evidence: "verified", source: `${JLC_CAP} (black and white mask, 1 oz)` };
      return { value: 0.1, evidence: "verified", source: `${JLC_CAP} (green, red, yellow, blue, purple mask, 1 oz)` };
    },
    blackSilkNeedsWhiteMask: { value: true, evidence: "reported", source: "secondary sources (not on the capability page)" },
    fullColor: { maskColor: "white", finish: "ENIG", minLayers: 2, maxLayers: 4, export: "EasyEDA Pro (two extra files in the Gerber zip)", evidence: "verified", source: "prodocs.easyeda.com/en/pcb/other-draw-colorful-silkscreen" },
  },
  circuithub: {
    id: "circuithub",
    name: "CircuitHub",
    maskColors: { value: ["red", "yellow", "green", "blue", "purple", "black", "white", "matteGreen", "matteBlack"], evidence: "verified", source: CH_CAP },
    finishes: { value: ["ENIG", "HASL-LF", "OSP"], evidence: "reported", source: `${CH_CAP} (ENIG preferred and default; others on request)` },
    finishCost: {
      ENIG: { cost: "base", evidence: "verified", note: "the default finish" },
      "HASL-LF": { cost: "quote", evidence: "reported", note: "on request" },
      OSP: { cost: "quote", evidence: "reported", note: "on request" },
    },
    silk: {
      minLine: { value: 0.15, evidence: "assumed", source: `not stated on ${CH_CAP}; JLCPCB's value used` },
      minTextHeight: { value: 1.0, evidence: "assumed", source: `not stated on ${CH_CAP}; JLCPCB's value used` },
      strokeRatio: { value: 1 / 6, evidence: "assumed", source: `not stated on ${CH_CAP}; JLCPCB's value used` },
      padClearance: { value: 0.15, evidence: "assumed", source: `not stated on ${CH_CAP}; JLCPCB's value used` },
    },
    maskWeb(color, oz) {
      const jlc = FAB_PROFILES.jlcpcb.maskWeb(color, oz);
      return { value: jlc.value, evidence: "assumed", source: `not stated on ${CH_CAP}; JLCPCB's value used` };
    },
    blackSilkNeedsWhiteMask: { value: true, evidence: "assumed", source: "not stated; JLCPCB's reported rule used" },
  },
};

export const fabProfile = (id: string): FabProfile => FAB_PROFILES[id as FabProfile["id"]] ?? FAB_PROFILES.jlcpcb;

/** Preview colors for mask colors, silk colors and finishes (renders only). */
export const MASK_HEX: Record<string, string> = {
  green: "#1E5631",
  matteGreen: "#2A5A3A",
  black: "#141414",
  matteBlack: "#0E0E0E",
  white: "#EDEDE8",
  blue: "#173E7A",
  red: "#8E1B1B",
  purple: "#4A2475",
  yellow: "#C9A320",
};
export const SILK_HEX: Record<string, string> = { white: "#F4F4F0", black: "#1A1A1A", fullColor: "#F4F4F0" };
export const FINISH_HEX: Record<string, string> = { ENIG: "#D9B45A", ENEPIG: "#D2B871", HASL: "#C9CDD1", "HASL-LF": "#C4C8CC", OSP: "#C27A45" };
