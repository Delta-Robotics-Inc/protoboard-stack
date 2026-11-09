/**
 * Running the checks: analyze a board once (model, rules, one pair scan, connectivity), then each check turns the
 * analysis into findings. `runBoardChecks` returns findings, connectivity and the status-line summary, all keyed
 * by the input hash. `createBoardChecks` gives the same checks as contract `Check` objects for `runChecks`.
 */
import { boxesMeet, runChecks, type BoardDocument, type BoardSnapshot, type Box, type Check, type CheckContext, type Finding } from "@protoboardai/board";
import { CHECKS, coverage, type Analysis } from "./checks.js";
import { computeConnectivity, scanPairs, type ConnectivityResult, type JoinRule } from "./connectivity.js";
import { normalizeFills, type ZoneFillInput, type ZoneFillSet } from "./fills.js";
import { inputHash } from "./hash.js";
import { buildModel } from "./model.js";
import { RuleBook } from "./rules.js";
import { summarize, type Summary, type Timing } from "./summary.js";

export interface RunOptions {
  /** Derived zone fill (fills.ts). Without it, zones connect nothing and the result says so. */
  fills?: ZoneFillInput;
  /** Keep only findings whose box (or location) meets this box. Connectivity is still whole-board. */
  region?: Box;
  /** How touching copper of one net joins (connectivity.ts): `ends` (default, as KiCad counts) or `overlap`. */
  join?: JoinRule;
}

export interface BoardCheckResult {
  /** The hash of every record, the netlist and the fill this result read (contract section 4.3). */
  inputHash: string;
  /** The snapshot's epoch and seq when run on a snapshot. */
  epoch?: string;
  seq?: number;
  findings: Finding[];
  connectivity: ConnectivityResult;
  summary: Summary;
  /** Checks that did not run and why; checks that ran on a built-in default. */
  notRun: { check: string; reason: string }[];
  defaults: { check: string; reason: string }[];
  /** Approximations the model made. */
  notes: string[];
}

const now = () => performance.now();

const cache = new WeakMap<BoardDocument, Map<string, { analysis: Analysis; stages: Record<string, number> }>>();

/** Analyze a board (cached per document and fill). */
export function analyzeBoard(doc: BoardDocument, fills?: ZoneFillSet, join: JoinRule = "ends"): { analysis: Analysis; stages: Record<string, number> } {
  const hash = inputHash(doc, fills);
  const key = `${hash}|${join}`;
  let byFill = cache.get(doc);
  const hit = byFill?.get(key);
  if (hit) return hit;
  const stages: Record<string, number> = {};
  let t = now();
  const lap = (name: string) => {
    const n = now();
    stages[name] = Math.round((n - t) * 100) / 100;
    t = n;
  };
  const model = buildModel(doc, fills);
  const rules = new RuleBook(doc);
  lap("model");
  // the search radius covers every clearance rule and every filled zone's own clearance
  let zoneClearance = 0;
  for (const id of model.filledZones) {
    const z = doc.records.get(id);
    if (z?.kind === "zone" && z.clearance !== undefined) zoneClearance = Math.max(zoneClearance, z.clearance);
  }
  const scan = scanPairs(model, Math.max(rules.maxMin("clearance"), zoneClearance));
  lap("pairs");
  const connectivity = computeConnectivity(model, scan, hash, join);
  lap("connectivity");
  const cov = coverage({ rules, model });
  const analysis: Analysis = { model, rules, scan, connectivity, inputHash: hash, notRun: cov.notRun, notes: [...model.notes, ...cov.defaults.map((d) => `${d.check}: ${d.reason}`)] };
  const entry = { analysis, stages };
  if (!byFill) cache.set(doc, (byFill = new Map()));
  byFill.clear();
  byFill.set(key, entry);
  return entry;
}

const isSnapshot = (x: BoardSnapshot | BoardDocument): x is BoardSnapshot => "doc" in x && "seq" in x;

function inRegion(f: Finding, region: Box | undefined): boolean {
  if (!region) return true;
  const b = f.box ?? { minX: f.location.x, minY: f.location.y, maxX: f.location.x, maxY: f.location.y };
  return boxesMeet(b, region);
}

/** Run every check on a snapshot or document. */
export function runBoardChecks(input: BoardSnapshot | BoardDocument, options: RunOptions = {}): BoardCheckResult {
  const t0 = now();
  const doc = isSnapshot(input) ? input.doc : input;
  const fills = normalizeFills(options.fills);
  const { analysis, stages: base } = analyzeBoard(doc, fills, options.join);
  const stages: Record<string, number> = { ...base };
  const all: Finding[] = [];
  for (const c of CHECKS) {
    const t = now();
    for (const f of c.run(analysis)) if (inRegion(f, options.region)) all.push(f);
    stages[c.id] = Math.round((now() - t) * 100) / 100;
  }
  const validated = validate(all);
  const timing: Timing = { totalMs: Math.round((now() - t0) * 100) / 100, stages };
  const cov = coverage(analysis);
  return {
    inputHash: analysis.inputHash,
    ...(isSnapshot(input) ? { epoch: input.epoch, seq: input.seq } : {}),
    findings: validated,
    connectivity: analysis.connectivity,
    summary: summarize(validated, analysis.connectivity, { timing, notRun: analysis.notRun }),
    notRun: analysis.notRun,
    defaults: cov.defaults,
    notes: analysis.notes,
  };
}

/** Validate the findings' shape and sort them as `runChecks` does (severity, then id), dropping repeats by id. */
function validate(findings: Finding[]): Finding[] {
  const byCheck = new Map<string, Finding[]>();
  for (const f of findings) {
    const l = byCheck.get(f.check) ?? [];
    l.push(f);
    byCheck.set(f.check, l);
  }
  const checks: Check[] = [...byCheck].map(([id, list]) => ({ id, title: id, run: () => list }));
  return runChecks(EMPTY_SNAPSHOT, checks);
}

/** `runChecks` only passes the snapshot to each check's `run`; the validating wrappers above ignore it. */
const EMPTY_SNAPSHOT = { epoch: "", seq: 0, doc: undefined as unknown as BoardDocument, version: () => 0, query: undefined as never } as BoardSnapshot;

/**
 * The checks as contract `Check` objects (one per finding type), sharing one analysis per document. Give them
 * to `runChecks(snapshot, checks, ctx)`; `ctx.region` keeps findings meeting that box.
 */
export function createBoardChecks(options: { fills?: ZoneFillInput; join?: JoinRule } = {}): Check[] {
  const fills = normalizeFills(options.fills);
  return CHECKS.map((c) => ({
    id: c.id,
    title: c.title,
    run(snapshot: BoardSnapshot, ctx: CheckContext): Finding[] {
      const { analysis } = analyzeBoard(snapshot.doc, fills, options.join);
      return c.run(analysis).filter((f) => inRegion(f, ctx.region));
    },
  }));
}
