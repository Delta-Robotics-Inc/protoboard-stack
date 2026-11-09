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
  presence?(): Presence | undefined;
  /** The transaction log (the timeline). Absent (or undefined): the timeline says it has no log. */
  log?(since?: number): LogEntry[] | undefined;
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
  /**
   * Where the fill came from and whether it matches the board's zones now; absent when there is none. `seq`: the
   * board version it was filled at (a fill older than the board is stale, and the screen says so); `ms`: how long a
   * computed fill took.
   */
  fill?: { source: string; current: boolean; seq?: number; ms?: number };
  /** What the host could not do (no checks package, a cross-check that failed), for the screen to show. */
  notes?: string[];
  /** The counts of each check run this session, by the board version it read (the timeline's error line). */
  history?: CheckPoint[];
  /** Findings a person marked "not a problem", with the reason (they are left out of `findings` and the counts). */
  waived?: WaivedFinding[];
}

/** One check run's counts at one board version. */
export interface CheckPoint {
  seq: number;
  errors: number;
  warnings: number;
  unconnected: number;
}

/** A finding a waiver covers: the finding as the checks found it, the waiver's rule record and its reason. */
export interface WaivedFinding {
  finding: PcbFinding;
  rule: string;
  reason: string;
}

// ---------------------------------------------------------------- writes and runs a page asks its host for

/** An operation call as the core takes it (`{ op: "footprint.move", ids, dx, dy }`). */
export type PageOpCall = { op: string } & Record<string, unknown>;

/** A transaction as a page sends it: no actor and no provenance (the host decides who acts). */
export interface PageTransaction {
  batchId: string;
  label: string;
  ops: PageOpCall[];
  changeSet?: { id: string; title?: string };
  expectEpoch?: string;
  expectSeq?: number;
  expectVersions?: Record<string, number>;
  dryRun?: boolean;
}

/** What to route: open nets, chosen nets, or a drawn region (nanometers, board frame). */
export type PageRouteScope = { kind: "open" } | { kind: "nets"; nets: string[] } | { kind: "region"; region: { x: number; y: number }[] };

/**
 * What a page asks its host to do with a board. A request never names an actor: the host decides who acts (a person
 * at the screen acts as `human`), so a page can never pass itself off as an agent, a router or a host.
 */
export type BoardRequest =
  | { method: "apply"; tx: PageTransaction }
  | { method: "undo"; batchId?: string }
  | { method: "redo"; batchId?: string }
  | { method: "revertChangeSet"; id: string; batchId?: string }
  /** Revoke every agent and router lease (Take over). */
  | { method: "takeOver" }
  | { method: "save" }
  /** Save and prepare a checkpoint's commit message (the service's `checkpoint`); nothing is committed. */
  | { method: "checkpoint"; label: string }
  /** `git add` and `git commit` of the board folder only, with this message; never a push. */
  | { method: "commit"; message: string }
  /** The board as it was at an earlier version, read only (the timeline's replay). */
  | { method: "at"; seq: number }
  /** Which routers this host can run, in order, and whether each is available. */
  | { method: "routers" }
  /** Start an autoroute run; progress and the proposal come on the feed (`route` messages). */
  | { method: "route"; scope: PageRouteScope; budgetMs?: number; preset?: "balanced" }
  | { method: "routeCancel"; run: string }
  /** Apply a proposal the host holds, each step as its router; the reply has every step's reply. */
  | { method: "routeAccept"; run: string }
  | { method: "routeReject"; run: string }
  /** Why a net does not route: attempts, the probe with the fab floor and no-go areas only, and test-run relaxations. */
  | { method: "diagnose"; net: string; budgetMs?: number }
  /** Mark a finding "not a problem" with a reason (a waiver rule entry, applied as a transaction). */
  | { method: "waive"; finding: string; reason: string }
  | { method: "unwaive"; finding: string };

export type BoardRequestMethod = BoardRequest["method"];

/** The host's answer to a request: the result, or why it was not done. */
export type BoardReplyMessage = { ok: true; result: unknown } | { ok: false; error: string };

/** One router as the autoroute panel lists it. */
export interface RouterInfo {
  id: string;
  title: string;
  version: string;
  available: boolean;
  reason?: string;
}

/** A score the router orchestrator gives a board: open connections, then errors, then vias, then length (nm). */
export interface PageScore {
  open: number;
  errors: number;
  vias: number;
  length: number;
  openNets: string[];
}

/** The copper a proposal adds, for the blue ghost (nanometers). */
export interface GhostCopper {
  segments: { net?: string; layer: string; width: number; start: { x: number; y: number }; end: { x: number; y: number } }[];
  vias: { net?: string; x: number; y: number; outer_diameter: number }[];
}

/** An autoroute run's result as the page draws and scores it (the host keeps the transactions to apply). */
export interface ProposalView {
  run: string;
  /** The change set its transactions carry (the orchestrator's run id): reverting it takes the whole run back. */
  changeSet: string;
  status: "proposed" | "rejected" | "unchanged" | "failed" | "cancelled";
  reasons: string[];
  base: { epoch?: string; seq?: number };
  current: PageScore;
  candidate: PageScore;
  nets: string[];
  openNets: string[];
  stages: { router: string; version: string; status: string; kept: boolean; reason?: string; durationMs: number; added: { segments: number; vias: number; length: number } }[];
  fallback?: { from: string; to: string[]; reasons: string[] };
  added: { segments: number; vias: number; length: number };
  lockCheck: { ok: boolean; changed: string[]; checked: number };
  ghost: GhostCopper;
  unexpressed: string[];
  notes: string[];
  ms: number;
}

/** A route run's progress as the feed sends it. */
export interface RouteProgressView {
  run: string;
  stage: number;
  router: string;
  phase: string;
  fraction?: number;
  elapsedMs: number;
  message?: string;
  fallback?: { from: string; to: string; reason: string };
}

/** A rule area as the diagnosis shades it: its tier, outline (nm) and what it blocks. */
export interface DiagnosisArea {
  id: string;
  name: string;
  tier: "floor" | "target" | "policy" | "no_go";
  outline: { x: number; y: number }[];
  blocks: string;
}

/** One relaxation the diagnosis test-ran: the rule change, and what routing did with it. */
export interface RelaxOption {
  id: string;
  title: string;
  detail: string;
  /** The rule records it writes (`rule.set` inputs), applied as the person's transaction when accepted. */
  rules: Record<string, unknown>[];
  result: { routed: boolean; open: number; errors: number; vias: number; length: number; newFindings: number; ms: number; note?: string };
}

/** Why a net does not route (L4). */
export interface DiagnosisView {
  net: string;
  seq: number;
  /** `routes`: it routes with every rule as it is (no diagnosis needed); `rules`: rules block it; `placement`: the parts or a no-go area do. */
  verdict: "routes" | "rules" | "placement";
  summary: string;
  attempts: { router: string; status: string; reason?: string; ghost: GhostCopper; ms: number }[];
  probe?: { router: string; routed: boolean; ghost: GhostCopper; length: number; vias: number; floorViolations: number; ms: number };
  blockers: { rule: string; tier: string; what: string; blocks: string }[];
  areas: DiagnosisArea[];
  options: RelaxOption[];
  ms: number;
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
  | { type: "error"; board: string; message: string }
  /** A checkpoint was prepared (the service saved and wrote its marker) or committed to Git. */
  | { type: "checkpoint"; board: string; seq: number; label: string; committed?: string }
  /** An autoroute run: progress while it runs, then its proposal (or why there is none). */
  | { type: "route"; board: string; run: string; progress?: RouteProgressView; proposal?: ProposalView; error?: string; ended?: "accepted" | "rejected" | "cancelled" };
