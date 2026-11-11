/**
 * Mates between part instances (PB-1185, the zero-schema-change part): what
 * mates to what, how it may move, and where the claim comes from. UHD is not
 * changed (build-rules.md; plan.md DEFAULT "Fusion, CAD as Code, Mark's UHD
 * fields": trait plus sidecar only). Three sources, merged in this order of
 * precedence (the merge rule, `mergeMates`):
 *
 *   1. trait    a `protoboard.mate` trait in the project's UHD (on the
 *               definition that declares the two instances or the link, or on
 *               an interface as the part's own joint hint): written by people;
 *   2. sidecar  `<model>.mates.json` next to a model file, bound to that
 *               file's bytes by sha256 (a vendor or a measuring tool writes it);
 *   3. inferred the heuristic suggestions (`protoboard mates suggest`), written
 *               only to `.protoboard/build/mates-suggested.json`, never into
 *               source, and never driving anything until a person promotes one.
 *
 * Trait beats sidecar beats inferred: for the same mate id the higher source
 * wins, and an inferred suggestion between two instances that a trait or a
 * sidecar already mates is dropped as shadowed.
 *
 * Units and frames: mm and Z up, in the instance's own body frame, the frame
 * UHD's `GeometryFrame` uses. glTF (metres, Y up) is converted at the boundary
 * only (`./frames.ts`, `gltfPointToUhd`), where face geometry is read from a
 * GLB and where a sidecar says its frames were measured in glTF space.
 * Angles are degrees, lengths mm, after `normalizeLimit`.
 */

export const MATES_SCHEMA = "protoboard.mates/v0";
export const MATES_SUGGESTED_SCHEMA = "protoboard.mates-suggested/v0";
/** The trait type, on a module definition (naming instances or a link) or on an interface (a joint hint). */
export const MATE_TRAIT = "protoboard.mate";
/** Where suggestions are written, project-relative (a build output; never source). */
export const MATES_SUGGESTED_FILE = ".protoboard/build/mates-suggested.json";
export const MATES_VALIDATOR = "protoboard/mates";

export const MATE_KINDS = ["fixed", "revolute", "prismatic", "cylindrical", "coaxial", "planar"] as const;
export type MateKind = (typeof MATE_KINDS)[number];
export const MATE_PROVENANCE = ["declared", "inferred", "measured"] as const;
export type MateProvenance = (typeof MATE_PROVENANCE)[number];
export type MateSource = "trait" | "sidecar" | "inferred";

export type Vec3 = [number, number, number];

/**
 * A rigid transform as a frame: an origin and two axes. `zAxis` is the joint
 * axis (revolute, prismatic, cylindrical, coaxial) or the contact normal
 * (planar), pointing out of the part toward its mate, like UHD's
 * `GeometryFrame.normal`; `xAxis` is the in-plane zero of a rotation. mm,
 * Z up, in the instance's own body frame.
 */
export interface MateFrame {
  origin: Vec3;
  zAxis: Vec3;
  xAxis?: Vec3;
}

export interface MateEnd {
  /** Instance path from the system root ("arm_fl/motor"). */
  instance: string;
  /** A body artifact of a multi-body module (as assemble() names its placement), when not the main body. */
  body?: string;
  /** The interface whose geometry frame this end uses, when it came from one. */
  interface?: string;
  frame: MateFrame;
}

export type Dof = "rotate" | "slide";
/** Rotation limits in deg or rad, slide limits in mm or m; `normalizeLimit` turns them into deg and mm. */
export interface MateLimit {
  dof: Dof;
  min?: number;
  max?: number;
  /** The pose the assembled model shows (Fusion's "rest"); default 0. */
  rest?: number;
  unit: "deg" | "rad" | "mm" | "m";
  /** Where the numbers come from (a datasheet, a measurement), or why they are believed. */
  source?: string;
  assumption?: string;
}

/** What a suggestion saw: faces by instance, view-sidecar node and feature (B-rep face) id. */
export interface MateEvidence {
  instance: string;
  /** The view sidecar node id ("." for the owner's merged part, an instance path inside a board GLB). */
  node?: string;
  /** Feature id: the source primitive (one B-rep face in an OCCT export), as the face-range table names it. */
  feature?: number;
  surface: "plane" | "cylinder" | "hole-pattern";
  /** Fitted numbers: radius, area, coverage in degrees, residual, count. */
  detail?: Record<string, number | string | boolean>;
}

/**
 * One mate. `b` moves relative to `a`: a revolute joint turns `b` about `a`'s
 * z axis through `a`'s origin, a prismatic one slides it along that axis. At
 * the assembled pose the two frames meet with opposing z axes (UHD's
 * `mateTransform` convention).
 */
export interface Mate {
  id: string;
  kind: MateKind;
  a: MateEnd;
  b: MateEnd;
  /** The UHD link this mate qualifies (its id as assemble() names it, prefixed by the declaring module's path). */
  link?: string;
  limits?: MateLimit[];
  provenance: MateProvenance;
  /** Inferred only: 0..1. */
  confidence?: number;
  evidence?: (MateEvidence | string)[];
  /** The toggle (research E.2): kept, but moves and places nothing. */
  suppressed?: boolean;
  /** Which source it came from (set by the readers). */
  from?: MateSource;
  /** The file or the definition (and trait index) it was read from. */
  origin?: string;
  note?: string;
}

/** A part's own joint hint for any link that mates one of its interfaces (an interface trait, or a sidecar's `interfaces`). */
export interface InterfaceMateHint {
  kind: MateKind;
  /** Overrides the interface's geometry frame (mm, Z up, body frame). */
  frame?: MateFrame;
  limits?: MateLimit[];
  provenance?: MateProvenance;
  evidence?: (MateEvidence | string)[];
  note?: string;
}

/** `<model>.mates.json`. Instance paths in `mates` are relative to the model's owner instance ("." is the owner). */
export interface MatesSidecar {
  schema: typeof MATES_SCHEMA;
  target: {
    /** The model file's name, in the same folder (no path). */
    file: string;
    /** "sha256:<hex>" (or bare hex) of the model file's bytes: the binding. */
    sha256: string;
    /** Units and up axis the frames below are written in. DEFAULT mm and +Z (UHD); "m" with "+Y" is glTF space. */
    units?: "mm" | "m";
    upAxis?: "+Z" | "+Y";
  };
  /** The part (definition id) it describes. */
  part?: string;
  interfaces?: Record<string, InterfaceMateHint>;
  mates?: Mate[];
  /** Optional signatures (research F.4); not checked in v0. */
  signatures?: unknown[];
}

export interface MateProblem {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  mate?: string;
  file?: string;
}

export interface MateSet {
  mates: Mate[];
  /** Mates a higher source replaced, with what replaced them. */
  shadowed: { id: string; from: MateSource; by: string; byFrom: MateSource }[];
  problems: MateProblem[];
}

/** `.protoboard/build/mates-suggested.json`. */
export interface SuggestedMatesFile {
  schema: typeof MATES_SUGGESTED_SCHEMA;
  generated: { by: string; at: string };
  /** Tolerances used (all DEFAULT, see suggest.ts). */
  tolerances: Record<string, number>;
  counts: {
    bodies: number;
    faces: number;
    planes: number;
    cylinders: number;
    patterns: number;
    suggestions: number;
    /** Suggestions between instances a UHD link already mates (left out of `suggestions`). */
    covered: number;
    /** Suggestions a trait or sidecar mate shadows (left out). */
    shadowed: number;
    byKind: Record<string, number>;
  };
  /** readMs: resolving and reading faces; suggestMs: fitting and pairing; mergeMs: covered and shadowed filtering. */
  timings: { readMs: number; suggestMs: number; mergeMs: number; totalMs: number };
  suggestions: Mate[];
  covered?: { id: string; link: string }[];
  skipped: { instance: string; reason: string }[];
}
