/**
 * Assembly sequence (PB-1183): one order that both assembles and explodes a
 * model, read by the 3D viewer, the docs and agents. SHARED FILE: kept byte
 * for byte identical in protoboard-stack `packages/core/src/sequence/` and
 * uhd-viewer `src/cad/sequence/` (a core test compares them when the viewer
 * checkout is linked). Edit both or neither.
 *
 * Shape after `docs/specs/cad-view-research/review-round-1/explode-sequencing.md`
 * section 5.2, trimmed to what the generator and the player use. It is a
 * tooling-side build output (`.protoboard/build/sequence.json`), not UHD
 * (plan.md overnight default "Assembly sequence location").
 *
 * Steps are stored in ASSEMBLY order. Exploding plays them backwards, last
 * step first. Units: mm and degrees, in the assembly root's coordinates
 * (UHD's Z-up frame); the viewer converts at its own boundary.
 */

export const SEQUENCE_SCHEMA = "protoboard.sequence/v0";

export type Vec3 = [number, number, number];

/**
 * What a step moves:
 * - a placed body, by its placement key ("frame", "arm_fl/motor", "video#cad_camera_step");
 * - a fastener-stack part, `<harness path>/<child>#<n>` (n counts from 1 in assemble() order, as ext-docs keys them);
 * - a named body of one artifact, `<body key>::<node name>` (an enclosure's lid);
 * - a group, `@<group id>`, which expands to the group's members.
 */
export type PartRef = string;

/** Where a direction comes from: the viewer resolves it to a world axis at the assembled pose. */
export type FrameRef =
  /**
   * A mate's frame, by link id. `parent`: the end that was placed first (the
   * body the mover goes onto; default); `child`: the mover's own end;
   * `structure`: the bolt pattern's structure end (else end a), along whose
   * normal fastener stacks are measured; `a`/`b`: the link's ends.
   */
  | { mate: string; end?: "parent" | "child" | "structure" | "a" | "b" }
  | { world: Vec3 }
  /**
   * A line in the assembly root's coordinates (mm, Z up): a point on it and its direction. Written for a mate
   * the mates module declares (a `protoboard.mate` trait or a `<model>.mates.json` sidecar, PB-1185) that no
   * UHD link carries, so there is no link frame to name.
   */
  | { at: Vec3; axis: Vec3 }
  /** The display up axis. */
  | "up";

export interface Motion {
  along: FrameRef;
  /** Along the frame normal (default) or against it. */
  axis?: "normal" | "-normal";
  /** mm; "auto": the member's rank along its joint times the view's explode gap (or one gap without a rank). */
  distance?: number | "auto";
  /** Threaded parts: turns about the member's own axis while it backs out at `pitchMm` per turn (positive loosens for `hand`). */
  turns?: number;
  pitchMm?: number;
  hand?: "right" | "left";
}

export interface Member {
  ref: PartRef;
  /**
   * Signed stacking rank along the joint axis, as ext-docs figures rank a
   * joint's parts (1 = the first position out from the frame, -1 the first
   * behind it). "auto" distances are |rank| gaps.
   */
  rank?: number;
  /** The part whose displacement this one rides on (hierarchical offsets: lid screws move with the lid). */
  parent?: PartRef;
  /** Per-member override of the step motion (a nut that leaves the other way). */
  motion?: Partial<Motion>;
}

export interface Group {
  /** "@arm_fl_hardware/screws". */
  id: string;
  members: PartRef[];
  title?: string;
}

export type StepKind = "place" | "insert" | "fasten" | "subassembly" | "action";

export interface SeqStep {
  /** Stable, from link ids: `fit:<link>`, `fasten:<link>`, `place:<key>`; or authored. */
  id: string;
  /** Verb phrase: "Fit the motor", "Fasten the stack". */
  title: string;
  kind: StepKind;
  members: Member[];
  /** Default motion for every member. */
  motion?: Motion;
  /** A sub-assembly built first (another sequence in the same file) and fitted as one unit. */
  sequence?: string;
  /** UHD link ids this step makes (coverage; ext-docs `mates`). */
  links?: string[];
  /** The link's harness as UHD names it (ext-docs groups automatic steps by it). */
  harness?: string;
  /** Seconds this step takes when played (default `defaults.durationS`). */
  durationS?: number;
  ease?: "cubic" | "linear";
  /** Seconds between members (screws one after another). */
  stagger?: number;
  camera?: { dir?: Vec3; up?: Vec3; margin?: number };
  /** Instruction text. */
  callout?: string;
  notes?: { kind: "tip" | "caution" | "warning"; text: string }[];
  /**
   * The stack planner orders and spaces these members at view time
   * (parts no mate places: display hints, a bare multi-body GLB); the
   * step's position among other planned steps follows the plan.
   */
  plan?: "stack";
  /**
   * Joint values this step leaves once it is assembled (a keyframe: "open the lid to 90"), degrees or mm by
   * joint id. Played in assembly order, so the assembled model shows the last keyframe of each joint; a value
   * outside the joint's stops is held at the stop and flagged in `limits` (PB-1185).
   */
  joints?: Record<string, number>;
  /** Keyframe values the joint stops held (written by the build, or found by the viewer when it resolves). */
  limits?: JointLimitFlag[];
  source: "generated" | "authored";
}

/** A joint value asked beyond a hard stop: what was asked, what is held, and which stop (PB-1185). */
export interface JointLimitFlag {
  joint: string;
  asked: number;
  held: number;
  stop: "min" | "max";
}

/** A joint a part can be driven along (revolute or slider), with hard stops. */
export interface JointDef {
  /** Id, usually the link id. */
  id: string;
  type: "revolute" | "slider";
  /** The part that moves (its subtree rides along). */
  part: PartRef;
  /** Axis: the frame's normal through the frame's origin. */
  along: FrameRef;
  /** Degrees (revolute) or mm (slider). Missing limits mean no stop on that side. */
  min?: number;
  max?: number;
  /** The pose the assembled model shows (default 0). */
  rest?: number;
  /** Where the limits come from: "sequence" (authored), "uhd" (hardware data), "mate:trait", "mate:sidecar", or a note. */
  limitsFrom?: string;
  /** Set when `rest` lay outside the stops and was held at one (PB-1185). */
  limited?: JointLimitFlag;
}

export interface AssemblySequence {
  /** "main", or a sub-assembly's instance path. */
  id: string;
  title?: string;
  /** Instance path this sequence assembles ("" = the whole system). */
  scope: string;
  /** Parts that never move in this sequence. */
  base: PartRef[];
  groups?: Group[];
  /** ASSEMBLY order. */
  steps: SeqStep[];
  joints?: JointDef[];
}

export interface SequenceDefaults {
  /** Seconds per step when played. */
  durationS: number;
  /** Cap on screw turns shown when backing out (a presentation choice). */
  maxTurns: number;
  /** Part of a threaded member's step spent unscrewing before it lifts (0..1). */
  unscrewShare: number;
}

export interface SequenceProblem {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  /** The step or patch edit it is about. */
  step?: string;
  edit?: number;
  patch?: string;
}

/** `.protoboard/build/sequence.json`. */
export interface SequenceFile {
  schema: typeof SEQUENCE_SCHEMA;
  /** The sequence a viewer plays: "main". */
  main: string;
  sequences: AssemblySequence[];
  defaults: SequenceDefaults;
  /** Root instance path the generator placed from (assemble's `root`). */
  root: string[];
  generated: { by: string; modelDigest?: string };
  /** Patches applied on top of the generated default, and what they could not do. */
  patches?: { files: string[]; applied: number; problems: SequenceProblem[] };
}

/** One edit of a patch, keyed by step id so it survives regeneration. */
export type SequenceEdit =
  /** Change fields of a step: title (rename), callout, camera, motion, duration, notes. */
  | { step: string; set: Partial<Omit<SeqStep, "id" | "members" | "source">> }
  /** Give a step a new id (later edits use the new id). */
  | { rename: string; to: string }
  /** Move a step before or after another. */
  | { move: string; before?: string; after?: string }
  /** Fuse steps into one (fit and fasten together), at the first one's place. */
  | { merge: string[]; into: string; title?: string }
  /** Split a step's members into several steps (a stack into screws, spacers, nuts); refs may be groups. */
  | { split: string; by: PartRef[][]; ids?: string[]; titles?: string[] }
  /** A manual action or any hand-written step. */
  | { insert: Omit<SeqStep, "source"> & { source?: SeqStep["source"] }; before?: string; after?: string }
  | { remove: string }
  /** Add or replace a drivable joint (limits as hard stops). */
  | { joint: JointDef };

export interface SequencePatch {
  /** Default: the main sequence. */
  sequence?: string;
  edits: SequenceEdit[];
}

/** DEFAULT (overnight, revisit): 1.2 s per step, at most 3 turns shown, 45 % of a screw's step spent unscrewing. */
export const DEFAULTS: SequenceDefaults = { durationS: 1.2, maxTurns: 3, unscrewShare: 0.45 };
