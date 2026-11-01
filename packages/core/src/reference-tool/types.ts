/**
 * The reference-tool registry's record, `protoboard.reference-tool/v0` (PB-1191).
 *
 * A reference tool is something Protoboard knows about and measures against,
 * but does not ship:
 *
 *   - a PHYSICAL reference of known size: a scan ruler (a scale bar laid in a
 *     photo or a scan), a calibration cube, a gauge block, a printed test part.
 *     Its nominal dimensions (value, unit, tolerance) are what a measurement
 *     taken against it is checked with, and its model file (when it has one,
 *     e.g. the STL a test part was printed from) is pinned by sha256;
 *   - an external PROGRAM used by file handoff only (`kind: "software"`):
 *     ScanRuler and BumpMesh (CNC Kitchen, AGPL-3.0-only), never bundled,
 *     proxied or hosted (round-2-notes/bumpmesh-scanruler.md §5, §6).
 *
 * Evidence taken with a tool lands in the part's folder,
 * `parts/local/<part>/evidence/<date>-<tool>/` (photos, the measured values
 * with provenance `measured-from-reference-tool`, the tool id), written by
 * ./evidence.ts. UHD does not change: the registry and the evidence are
 * tooling-side records (build-rules.md: no schema change).
 */

export const REFERENCE_TOOL_SCHEMA = "protoboard.reference-tool/v0";
export const REFERENCE_EVIDENCE_SCHEMA = "protoboard.reference-evidence/v0";
/** The provenance method of a value measured against a reference tool (or a body made through one). */
export const MEASURED_FROM_REFERENCE_TOOL = "measured-from-reference-tool";

/** Physical references, then external programs. */
export const REFERENCE_TOOL_KINDS = ["scan-ruler", "calibration-cube", "gauge-block", "printed-test-part", "software"] as const;
export type ReferenceToolKind = (typeof REFERENCE_TOOL_KINDS)[number];

export const LENGTH_UNITS = ["mm", "um", "in"] as const;
export const UNITS = [...LENGTH_UNITS, "deg"] as const;
export type DimensionUnit = (typeof UNITS)[number];

/** Millimetres per unit (angles are not lengths: deg converts to itself). */
export const TO_MM: Record<DimensionUnit, number> = { mm: 1, um: 0.001, in: 25.4, deg: 1 };

export interface Tolerance {
  /** How far above the nominal a value may be (same unit, >= 0). */
  plus: number;
  /** How far below (>= 0). */
  minus: number;
}

/** One dimension the tool is known to have. */
export interface NominalDimension {
  /** "length", "edge-x", "hole-diameter", ...: what a measurement names to be checked against it. */
  name: string;
  value: number;
  unit: DimensionUnit;
  tolerance: Tolerance;
  /** Where the number comes from (a certificate, the maker's datasheet, the model file). Required unless `assumption`. */
  source?: string;
  /** True when the number is not from a source (say why in `source` or `note`). */
  assumption?: boolean;
  note?: string;
}

export interface ReferenceToolSource {
  /** builtin: shipped in this module; project: parts/reference-tools/; user: <home>/reference-tools/. Set by the loader. */
  origin?: "builtin" | "project" | "user";
  /** Who makes it, or who printed it. */
  maker?: string;
  partNumber?: string;
  /** LCSC C number when the tool is a part one can buy there (LCSC-first rule). */
  lcsc?: string;
  url?: string;
  /** A certificate or datasheet reference, for calibrated references. */
  certificate?: string;
}

/** The model a physical tool was made from (a printed test part's STL), pinned by sha256. */
export interface ReferenceToolModel {
  /** Relative to the registry file's folder (project entries: the project root). Never absolute, never `..`. */
  path: string;
  sha256: string;
  format: "step" | "stl" | "3mf" | "glb";
  units: "mm" | "m";
}

/** What a piece of evidence taken with the tool holds, and where it goes. */
export interface ReferenceToolEvidence {
  /** The layout, with `<part>`, `<date>` and `<tool>` placeholders. Default EVIDENCE_LAYOUT. */
  layout: string;
  /** Photos are expected (a scan ruler in frame, a part on a gauge block). */
  photos: boolean;
  /** Names of the values a session measures (e.g. "length", "diameter"); free text, for prompts and checks. */
  measures?: string[];
}

/** An external program used by file handoff (kind "software"). */
export interface ReferenceSoftware {
  homepage: string;
  repository?: string;
  author?: string;
  license: string;
  /** Always "reference": never bundled, never hosted, never proxied by Protoboard. */
  relationship: "reference";
  runs: "browser" | "desktop" | "docker";
  selfHost?: string;
  /** Its MCP server, pinned to an exact version and with self-update off. */
  mcp?: { command: string; args: string[]; transport: "stdio" };
  reads: string[];
  writes: string[];
  handoffs: string[];
  /** The provenance method of what comes back from it. */
  provenanceMethod: string;
  testedVersions: string[];
  notes?: string;
}

export interface ReferenceTool {
  schema: typeof REFERENCE_TOOL_SCHEMA;
  /** File-name safe: lower case letters, digits and hyphens. */
  id: string;
  name: string;
  kind: ReferenceToolKind;
  description?: string;
  /** Required (at least one) for physical kinds; empty for software. */
  nominal: NominalDimension[];
  source: ReferenceToolSource;
  model?: ReferenceToolModel;
  evidence: ReferenceToolEvidence;
  software?: ReferenceSoftware;
}

/** DEFAULT (PB-1191 brief): evidence goes in the part's own folder, one folder per session. */
export const EVIDENCE_LAYOUT = "parts/local/<part>/evidence/<date>-<tool>/";
