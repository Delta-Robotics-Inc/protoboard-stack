/**
 * The plain inputs the renderer and the layout screen take besides the board itself. The renderer is a read-only
 * client of the board service: it holds a snapshot and applies commit events. Derived data (ratsnest, zone fills,
 * check findings and counts) is computed by the host (./host, Node) and handed in with these types, so the renderer
 * never depends on the packages that compute them. Pure types: no DOM, no Node.
 */
import type { BoardEvent, BoardRecord, BoardSnapshot, LogEntry, Presence, WireSnapshot, ZoneFillEntry } from "./board.js";

/** What the screen reads the board through: the board service itself, or a client with the same calls. */
export interface BoardSource {
  snapshot(): BoardSnapshot;
  subscribe(listener: (e: BoardEvent) => void): () => void;
  /** Leases and recent agent intents (the agent bar). Absent: the bar says it has no presence feed. */
  presence?(): Presence;
  /** The transaction log (the timeline). Absent: the timeline says it has no log. */
  log?(since?: number): LogEntry[];
}

/** One ratsnest line: an unrouted connection between two points of a net (nanometers, board coordinates). */
export interface RatsnestPair {
  net: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Pad or object ids at the two ends, when known. */
  from?: string;
  to?: string;
}

/**
 * A check finding as the screen draws it: the contract's `Finding` (docs/specs/pcb-editor/phase1-board-core.md,
 * section 11), field for field. Restated here so the screen does not import the checks package.
 */
export interface PcbFinding {
  id: string;
  check: string;
  rule?: string;
  tier?: "floor" | "target" | "policy" | "no_go";
  severity: "error" | "warning" | "info";
  objects: string[];
  location: { x: number; y: number; layer?: string };
  box?: { minX: number; minY: number; maxX: number; maxY: number };
  measured?: number;
  required?: number;
  message: string;
}

/**
 * The derived fill of a zone on one layer as the scene draws it: polygons with holes, nanometers (first ring outer,
 * the rest holes). The host hands in the core's shared type (`ZoneFillEntry`, `protoboard.zone-fill/v1`);
 * `zoneFillsFromEntries` (./fills.ts) turns it into this.
 */
export interface ZoneFill {
  zone: string;
  layer: string;
  polygons: { x: number; y: number }[][][];
}

/** A second tool's counts beside ours (KiCad's DRC), or why it did not run. */
export type CrossCheckSummary =
  | {
      ran: true;
      /** `KiCad 10.0.5`. */
      tool: string;
      /** KiCad's comparable counts (the categories both tools check, KiCad's items counted once). */
      unconnected: number;
      errors: number;
      warnings: number;
      /** Our comparable counts, beside KiCad's (absent from older hosts: compare with our totals then). */
      ours?: { unconnected: number; errors: number; warnings: number };
      /** Findings of ours KiCad has no counterpart for, KiCad items of types we do not check, and the source's rules the import could not express (KiCad's items under them are counted nowhere). */
      oursOnly?: { count: number; what: string[] };
      kicadOnly?: { count: number; what: string[] };
      notEvaluated?: { rules: number; kicadItems: number; what: string[] };
      /** Each tool's raw totals, as each reports them. */
      raw?: { ours: { unconnected: number; errors: number; warnings: number }; kicad: { unconnected: number; errors: number; warnings: number } };
      /** What differs among the comparable counts, named ("errors: ours 3, KiCad 2"); absent when they agree. */
      difference?: string;
      /** Every difference the comparison lists. */
      differences?: string[];
      /** The board seq it compared against (stale when the board moved on: KiCad read the source file). */
      seq?: number;
    }
  | { ran: false; tool: string; reason: string };

/**
 * What the status line says about checks. `ran: false` is the truthful default: the line then says that no check
 * has run, instead of showing zeros.
 */
export type CheckSummary =
  | { ran: false; reason?: string }
  | {
      ran: true;
      /** When the counts were computed (a clock time the host formats, or an ISO string). */
      at?: string;
      /** How long the run took. */
      ms?: number;
      /** At which board seq the run read the snapshot (stale when the board moved on). */
      seq?: number;
      unconnected: number;
      errors: number;
      warnings: number;
      /** True when the numbers leave something out (zones without fill, no netlist): `caveats` says what. */
      incomplete?: boolean;
      caveats?: string[];
      /** KiCad's counts beside ours, or why there are none. Absent: the host did not try. */
      crossCheck?: CrossCheckSummary;
    };

/** The four depths of the shell's switcher. */
export type DepthView = "system" | "schematic" | "layout" | "3d";

/** Everything derived the host computes for the screen, at one board version. */
export interface BoardDerived {
  epoch: string;
  seq: number;
  checks: CheckSummary;
  findings: PcbFinding[];
  ratsnest: RatsnestPair[];
  /** The board's zone fill in the core's shared form (imported from the source tool, or computed). */
  fills: ZoneFillEntry[];
  /** Where the fill came from and whether it matches the board's zones now; absent when there is none. */
  fill?: { source: string; current: boolean };
  /** What the host could not do (no checks package, a cross-check that failed), for the screen to show. */
  notes?: string[];
}

/** A board folder the host can open. */
export interface BoardEntry {
  /** The board key (contract section 7): the folder relative to the project root, `/` as `__`. */
  key: string;
  /** The board folder relative to the project root, with `/`. */
  dir: string;
  name: string;
  /** `service`: a live board service (`protoboard board serve`); `files`: read from its files. */
  mode?: "service" | "files";
}

/**
 * The host-to-page feed of one board, the same over the dev server's event stream and VS Code's postMessage.
 * `snapshot` comes first (and again when the host reloads the board); `commit` carries the changed records so the
 * page applies it without asking for the whole board; `derived` follows each commit once the checks have run.
 */
export type BoardFeedMessage =
  | { type: "snapshot"; board: string; mode: "service" | "files"; snapshot: WireSnapshot; presence?: Presence; log?: LogEntry[] }
  | { type: "commit"; board: string; event: Extract<BoardEvent, { type: "commit" }>; puts: BoardRecord[]; removes: string[]; versions: Record<string, number>; log?: LogEntry[] }
  | { type: "presence"; board: string; presence: Presence }
  | { type: "saved"; board: string; seq: number; files: string[] }
  | { type: "derived"; board: string; derived: BoardDerived }
  | { type: "error"; board: string; message: string };
