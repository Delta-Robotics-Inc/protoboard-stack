/**
 * The router interface: a job (a board snapshot, a scope, constraints resolved from the four rule tiers, locked
 * copper, a budget and a seed) goes to a router; the router returns operations for the board core, never a changed
 * document. The orchestrator (orchestrator.ts) runs routers on copies, verifies and scores what they return, and
 * turns it into a proposal.
 */
import type { Actor, BoardDocument, CopperLayer, KeepoutRec, OpCall, Provenance, RuleRec, Vertex } from "@protoboardai/board";

// ---------------------------------------------------------------- scope

/**
 * What to route: every net with open connections, a list of nets, or the open connections inside a region. `layers`
 * limits the copper layers new copper may use (absent: every layer of the stackup).
 */
export type RouteScope =
  | { kind: "open"; layers?: CopperLayer[]; includePourNets?: boolean }
  | { kind: "nets"; nets: string[]; layers?: CopperLayer[] }
  | { kind: "region"; region: Vertex[]; layers?: CopperLayer[]; includePourNets?: boolean };

/** One piece of a net to join: a pad (or copper) island, represented by one anchor. */
export interface IslandAnchor {
  /** The object the anchor is on (a pad id, or a track or via id when the island has no pad). */
  object: string;
  x: number;
  y: number;
  /** Copper layers the anchor can be reached on. */
  layers: CopperLayer[];
}

/** A net in scope and the islands it still has to join (two or more). */
export interface NetToRoute {
  net: string;
  /** One anchor per island, sorted by object id. */
  islands: IslandAnchor[];
  /** Every object of the net (pads, tracks, vias), for obstacles that may be touched by this net. */
  objects: string[];
}

// ---------------------------------------------------------------- constraints

/** A value the router plans at (`plan`) and the hard limit it may never go below (`floor`), nanometers. */
export interface PlanFloor {
  plan: number;
  floor: number;
}

export interface NetConstraint {
  net: string;
  class: string;
  width: PlanFloor;
  clearance: PlanFloor;
  /** Rule ids whose values set the plan (target tier), for the rules-or-placement diagnostic. */
  targetRules: string[];
  /** The target rule that set each plan (absent: a built-in default). */
  sources: { width?: string; clearance?: string };
}

export interface ViaConstraint {
  outer: PlanFloor;
  hole: PlanFloor;
}

/** A keep-out as the router should see it. Only `no_go` keep-outs are walls; `policy` ones are costs. */
export interface KeepoutConstraint {
  id: string;
  tier: KeepoutRec["tier"];
  layers: CopperLayer[];
  blocks: KeepoutRec["blocks"];
  outline: Vertex[];
}

/** A rule that is a cost per violation, never a wall (policy tier). */
export interface PolicyCost {
  id: string;
  check: RuleRec["check"];
  cost: number;
  region?: Vertex[];
}

/** Rules resolved from the four tiers for routing. Lengths are nanometers. */
export interface ResolvedConstraints {
  /** Which tiers were used: all four, or `floor` and `no_go` only (the diagnostic rerun). */
  tiers: "all" | "floor-and-no-go";
  /** The board-wide plan and floor (nets without their own rules use these). */
  defaults: { width: PlanFloor; clearance: PlanFloor };
  /** Per net in scope. */
  nets: Record<string, NetConstraint>;
  via: ViaConstraint;
  edgeClearance: PlanFloor;
  keepouts: KeepoutConstraint[];
  /** `no_go` rules other than keep-outs (via in pad for a class, for example). */
  noGoRules: { id: string; check: RuleRec["check"]; nets?: string[]; classes?: string[] }[];
  policies: PolicyCost[];
  /** Rules that apply only to a region, a layer or a pair of object kinds: no router input takes them; checked after. */
  localRules: string[];
  /** Values that came from built-in defaults because no rule gave them. */
  defaulted: string[];
}

// ---------------------------------------------------------------- jobs and results

export interface RouteBudget {
  /** Wall clock for one router run, milliseconds. */
  timeMs: number;
  /** Threads the router may use. */
  threads: number;
  /** Memory cap, megabytes (a worker heap limit or a JVM heap limit). */
  memoryMb: number;
}

export interface RouteJob {
  /** Deterministic from the inputs and the seed: provenance `run` of what the router adds. */
  runId: string;
  /** The board to route (an immutable copy; the router never changes it). */
  doc: BoardDocument;
  scope: RouteScope;
  /** The nets the router should join, with their islands. */
  nets: NetToRoute[];
  /** Copper layers new copper may use. */
  layers: CopperLayer[];
  /** For a region scope: the region (routers that cannot bound copper to it say so in `unexpressed`). */
  region?: Vertex[];
  constraints: ResolvedConstraints;
  /** Ids of locked records (copper, footprints, zones, keep-outs, outline) that must come back unchanged. */
  locked: string[];
  budget: RouteBudget;
  seed: number;
  /** What this router cannot express of the constraints and scope: checked after, never silently dropped. */
  unexpressed: string[];
  /** Router-specific options (passes, effort, via cost). */
  options?: Record<string, unknown>;
}

export interface RouteProgress {
  router: string;
  /** A phase name from the router (a pipeline stage, a routing pass). */
  phase: string;
  /** 0 to 1 when the router reports it. */
  fraction?: number;
  elapsedMs: number;
  message?: string;
}

export type RouteStatus = "complete" | "partial" | "failed" | "timeout" | "cancelled" | "unavailable";

export interface RouteStats {
  durationMs: number;
  /** Track segments and vias in the result. */
  segments: number;
  vias: number;
  /** Total length of the added track, nanometers. */
  length: number;
  /** Connections the router itself says it left open, when it says. */
  routerReportedOpen?: number;
  /** Router-specific numbers (passes, iterations, phase times). */
  extra?: Record<string, number | string>;
}

export interface RouteResult {
  status: RouteStatus;
  /** Operations for the core, to be applied by the router actor; never a mutated document. */
  ops: OpCall[];
  /** Provenance for what the ops create: `routed`, the tool with its version, the run id. */
  provenance: Provenance;
  stats: RouteStats;
  /** What the router could not express (the job's list plus anything found while converting). */
  unexpressed: string[];
  /** Plain messages from the run (errors, warnings), built from facts. */
  messages: string[];
  /** The router's version as it ran. */
  version: string;
}

export interface RouterCapabilities {
  /** Copper layer counts it can route. */
  layers: { min: number; max: number };
  /** Whether new copper can be bound to a region. */
  region: boolean;
  /** Whether a subset of nets can be routed with the rest left alone. */
  netSubset: boolean;
  /** Whether locked copper is guaranteed untouched (the orchestrator verifies it either way). */
  respectsLockedCopper: boolean;
  /** Whether it can add to existing copper (route only what is open). */
  incremental: boolean;
  /** Threads it can use. */
  maxThreads: number;
}

export type Availability = { ok: true } | { ok: false; reason: string };

export interface Router {
  id: string;
  title: string;
  version(): string;
  available(): Availability;
  capabilities: RouterCapabilities;
  /** What this router cannot express of a job's constraints and scope (filled into `job.unexpressed`). */
  express(job: Omit<RouteJob, "unexpressed">): string[];
  route(job: RouteJob, signal: AbortSignal | undefined, onProgress: (p: RouteProgress) => void): Promise<RouteResult>;
}

// ---------------------------------------------------------------- scoring

/** What an injected scorer reports about a board (a check run): open connections and error findings. */
export interface ScorerReport {
  /** Missing connections (the ratsnest count). */
  open: number;
  /** Error findings other than open connections. */
  errors: number;
  /** Nets with open connections, when the scorer knows them. */
  openNets?: string[];
  /** Error finding ids, for the proposal's report. */
  errorIds?: string[];
}

/** The injected checks: a function from a board to its open connections and errors. */
export type BoardScorer = (doc: BoardDocument) => ScorerReport | Promise<ScorerReport>;

/** A board's score: open connections first, then errors, then vias, then track length. Lower is better. */
export interface BoardScore {
  open: number;
  errors: number;
  vias: number;
  length: number;
  openNets: string[];
}

export const ROUTER_ACTOR = (router: Router): Actor => ({ kind: "router", id: `router:${router.id}`, name: router.id });
