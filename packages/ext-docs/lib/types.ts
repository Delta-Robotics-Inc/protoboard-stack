/**
 * Per-system documentation config: `<system>/docs/docspec.ts` default-exports
 * a DocConfig. It says how to *present* the model (step order, cameras,
 * which parameters are "key"), never what the values are: every value in a
 * document is a query into the model (see values.ts).
 */
import type { Mat4 } from "@deltarobotics/uhd";

export type Vec = [number, number, number];

export interface CameraSpec {
  /** Direction from the target toward the camera (world, Z up). */
  dir?: number[];
  up?: number[];
  margin?: number;
  shiftX?: number;
  shiftY?: number;
}

export interface StepGroupSpec {
  /** Stable id, used in file names. */
  id: string;
  /** Verb-phrase title, e.g. "Mount the motors". */
  title: string;
  /** Mate link ids (as in assemble().mates[].linkId) covered by this step; `*` wildcards allowed. */
  mates?: string[];
  /** Wiring link ids (wiringChecklist linkId, with the sub-assembly prefix, e.g. "stack/fc_esc_cable"); wildcards allowed. */
  wiring?: string[];
  /** Instance paths placed in this step without a mate (placement hints, strapped parts). */
  place?: string[];
  /**
   * Hand-written actions done first in the step, for work the model does not
   * carry as an instance or a mate (a printed part of an enclosure fitted
   * before what covers it, such as a button plunger). Value queries in
   * {{…}} as in notes. The generated actions follow.
   */
  before?: string[];
  /**
   * Actions the model cannot generate, appended after the step's generated ones (the guide's list and the
   * release's work order): a fold, a part laid in place last.
   */
  actions?: string[];
  /** Presentation notes shown under the step (tips / cautions). Model-derived notes are added automatically. */
  notes?: { kind: "tip" | "caution" | "warning"; text: string }[];
  camera?: CameraSpec;
  /** Explode distance for this step (mm). */
  explode?: number;
  /** Instances drawn as context from this step on even when not yet assembled (e.g. hidden until later). */
  hideContext?: string[];
  /** Figure style: exploded assembly (default) or a wiring figure. */
  figure?: "assembly" | "wiring" | "none";
  /**
   * "test": done only after the unit's bench test and configuration (a
   * battery strapped on for use). The Manufacturing Package's work order runs
   * the test before such steps and a final check after them. Steps that fit
   * propellers are treated this way without the flag.
   */
  after?: "test";
}

export interface KeySpec {
  label: string;
  /** Value query (values.ts). */
  q: string;
  /** Format options (format.ts). */
  f?: string;
  sub?: string;
}

export interface DocConfig {
  title?: string;
  subtitle?: string;
  docId?: string;
  revision?: string;
  /** Root instance path for assemble() (default []). */
  root?: string[];
  /** Placements for modules no mate reaches (strapped/free), from model constants. */
  placementHints?: { path: string[]; matrix: Mat4; note: string }[];
  /** Default iso camera for the system. */
  camera?: CameraSpec;
  datasheet?: {
    keyFigures?: KeySpec[];
    specGroups?: { title: string; rows: KeySpec[] }[];
    /** Interfaces to call out on the mechanical figure: "<instance path>.<interface id>". */
    mechanicalCallouts?: string[];
    /** Module whose pinout / interface allocation is tabulated (instance path). */
    hub?: string;
    /**
     * Draw the bodies placed by placement hints on the cover (default false: a
     * strapped battery is left off). True for parts held inside an enclosure.
     */
    heroHints?: boolean;
    /**
     * The Mechanical section's envelope table and figure captions. Omitted: the
     * multirotor recipe (wheelbase, arm spacing, plates, props, motors),
     * dimensioned on the drawings.
     */
    envelope?: { rows: KeySpec[]; note?: string; topCaption?: string; sideCaption?: string };
    /**
     * Performance figures as model queries, for a system whose parts state no performance table (not a
     * multirotor): a summary table and bar charts (each item a query; `refs` draw target lines).
     */
    performance?: {
      title?: string;
      rows?: KeySpec[];
      note?: string;
      charts?: { title: string; y: string; unit: string; items: { label: string; q: string }[]; refs?: { label: string; q: string }[]; caption?: string; decimals?: number }[];
    };
  };
  assembly?: {
    steps: StepGroupSpec[];
    explode?: number;
    /** Instance path prefixes never drawn in step figures (e.g. props until their step). */
    lateParts?: string[];
  };
  testData?: {
    /** Stand-in recipe: a module name under lib/standins/ of @protoboardai/ext-docs ("multirotor"). */
    standins?: string;
  };
}
