/**
 * The plain inputs the renderer and the layout screen take besides the board itself. The renderer is a read-only
 * client of the board service: it holds a snapshot and applies commit events. Derived data (ratsnest, zone fills,
 * check findings) is computed elsewhere and handed in with these types, so the renderer never depends on the
 * packages that compute them.
 */
import type { BoardEvent, BoardSnapshot, LogEntry, Presence } from "./board.js";

/** What the screen reads the board through: the board service itself, or a wire client with the same calls. */
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

/** The derived fill of a zone on one layer: polygons with holes, nanometers (first ring outer, the rest holes). */
export interface ZoneFill {
  zone: string;
  layer: string;
  polygons: { x: number; y: number }[][][];
}

/**
 * What the status line says about checks. `ran: false` is the truthful default: the line then says that no check
 * has run, instead of showing zeros.
 */
export type CheckSummary =
  | { ran: false }
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
      /** A second tool's counts beside ours (KiCad's DRC), with the difference named by the host. */
      crossCheck?: { tool: string; unconnected: number; errors: number; warnings: number; difference?: string };
    };

/** The four depths of the shell's switcher. */
export type DepthView = "system" | "schematic" | "layout" | "3d";
