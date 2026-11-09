/**
 * Waivers in the checks (Phase 2, P2-E): a person's "not a problem" on a finding (`waiver` records, stored with the
 * rules). A waived finding is left out of `findings` and the summary's counts and listed in `result.waived` with the
 * waiver that covers it. A waiver covers a finding when it names the finding's id, or when it names the finding's
 * rule (a rule id or a check name) and either lists no objects (every finding of that rule) or lists exactly the
 * finding's objects (in any order).
 */
import { byCodeUnit, type BoardDocument, type Finding, type WaiverRec } from "@protoboardai/board";
import type { BoardCheckResult } from "./run.js";
import { summarize } from "./summary.js";

/** A finding a waiver covers, and that waiver's id. */
export interface WaivedFinding {
  finding: Finding;
  waiver: string;
}

/** The board's waiver records, sorted by id (the first that covers a finding is the one listed). */
export function waiversOf(doc: BoardDocument): WaiverRec[] {
  const out: WaiverRec[] = [];
  for (const r of doc.records.values()) if (r.kind === "waiver") out.push(r);
  return out.sort((a, b) => byCodeUnit(a.id, b.id));
}

/** The waiver covering a finding, if any. */
export function waiverFor(f: Finding, waivers: readonly WaiverRec[]): WaiverRec | undefined {
  for (const w of waivers) {
    if (w.finding !== undefined && w.finding !== f.id) continue;
    if (w.rule !== undefined) {
      if (w.rule !== f.check && w.rule !== f.rule) continue;
      if (w.objects.length && !sameObjects(w.objects, f.objects)) continue;
    }
    if (w.finding === undefined && w.rule === undefined) continue;
    return w;
  }
  return undefined;
}

function sameObjects(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== new Set(b).size) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/** Split findings into those that count and those waived. */
export function splitWaived(findings: readonly Finding[], waivers: readonly WaiverRec[]): { findings: Finding[]; waived: WaivedFinding[] } {
  if (!waivers.length) return { findings: [...findings], waived: [] };
  const kept: Finding[] = [];
  const waived: WaivedFinding[] = [];
  for (const f of findings) {
    const w = waiverFor(f, waivers);
    if (w) waived.push({ finding: f, waiver: w.id });
    else kept.push(f);
  }
  return { findings: kept, waived };
}

/**
 * A result with the board's waivers applied: waived findings out of `findings` and the counts, listed in `waived`,
 * and the summary recounted (its line says how many are waived). The same object back when nothing is waived.
 */
export function applyWaivers(result: BoardCheckResult, doc: BoardDocument): BoardCheckResult {
  const waivers = waiversOf(doc);
  if (!waivers.length) return result;
  const { findings, waived } = splitWaived(result.findings, waivers);
  if (!waived.length) return result;
  return {
    ...result,
    findings,
    waived,
    summary: summarize(findings, result.connectivity, { ...(result.summary.timing ? { timing: result.summary.timing } : {}), notRun: result.notRun, waived: waived.map((w) => w.finding) }),
  };
}
