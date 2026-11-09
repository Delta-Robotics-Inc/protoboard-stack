/**
 * Waivers: a finding a person marked "not a problem", with the reason. The core has no waiver record yet, so a
 * waiver is stored as a rules entry the checks cannot apply as a rule: a disabled rule (`enabled: false`, check
 * `disallow`, severity `ignore`, applies to nothing) whose id names the finding and whose note carries the finding
 * id and the reason. It lives in rules.jsonl with the board, is written and undone as an ordinary transaction, and
 * the host's analysis leaves the waived findings out of the counts and lists them apart.
 *
 * A finding id is stable for the same check, rule, objects and location (contract section 11): when the objects
 * move, the finding is a new one and the waiver no longer covers it (it is reviewed again). Pure; no DOM, no Node.
 */
import type { BoardDocument } from "./board.js";
import type { PcbFinding, WaivedFinding } from "./types.js";

export const WAIVER_ID_PREFIX = "rule:waiver.";
const NOTE = /^waiver (f:[^\s]+): ([\s\S]+)$/;

/** The waiver rule id for a finding id (`f:clearance:0123456789ab` gives `rule:waiver.clearance.0123456789ab`). */
export function waiverRuleId(findingId: string): string {
  const key = findingId.replace(/^f:/, "").replace(/[^A-Za-z0-9_.\-/+~]+/g, ".").replace(/:/g, ".").slice(0, 120);
  return `${WAIVER_ID_PREFIX}${key}`;
}

/** The `rule.set` input that records a waiver. */
export function waiverRule(finding: Pick<PcbFinding, "id">, reason: string): Record<string, unknown> {
  const why = reason.trim().replace(/\s+/g, " ").slice(0, 400);
  return { id: waiverRuleId(finding.id), tier: "policy", check: "disallow", applies: {}, enabled: false, severity: "ignore", note: `waiver ${finding.id}: ${why}`.slice(0, 500) };
}

/** The waivers on a board: finding id to its rule and reason. */
export function readWaivers(doc: BoardDocument): Map<string, { rule: string; reason: string }> {
  const out = new Map<string, { rule: string; reason: string }>();
  for (const r of doc.records.values()) {
    if (r.kind !== "rule" || !r.id.startsWith(WAIVER_ID_PREFIX) || r.enabled !== false || !r.note) continue;
    const m = NOTE.exec(r.note);
    if (m) out.set(m[1], { rule: r.id, reason: m[2] });
  }
  return out;
}

/** Split findings into those still open and those a waiver covers. */
export function applyWaivers(findings: readonly PcbFinding[], waivers: ReadonlyMap<string, { rule: string; reason: string }>): { open: PcbFinding[]; waived: WaivedFinding[] } {
  const open: PcbFinding[] = [];
  const waived: WaivedFinding[] = [];
  for (const f of findings) {
    const w = waivers.get(f.id);
    if (w) waived.push({ finding: f, rule: w.rule, reason: w.reason });
    else open.push(f);
  }
  return { open, waived };
}
