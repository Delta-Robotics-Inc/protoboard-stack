/**
 * Waivers: a finding a person marked "not a problem", with the reason. Two forms are read:
 *
 * - **Waiver records** (`kind: "waiver"`, id `waiver:<key>`, stored with the rules; contract Phase 2): a `finding`
 *   id, or a `rule` (a rule id or a check name) with the `objects` it covers, the `reason`, and `by` (who waived).
 *   They are written with `waiver.add` and taken back with `waiver.remove`, as the person, and the checks
 *   themselves leave the waived findings out (`result.waived`).
 * - **Older disabled rules entries** (`rule:waiver.*`, `enabled: false`, check `disallow`, severity `ignore`, the
 *   finding id and the reason in the note), from before the core had a waiver record. The host leaves their
 *   findings out itself and converts them to waiver records in one person transaction on the first write
 *   (`legacyWaiverMigration`).
 *
 * A finding id is stable for the same check, rule, objects and location (contract section 11): when the objects
 * move, the finding is a new one and a finding waiver no longer covers it (it is reviewed again). Pure; no DOM, no
 * Node.
 */
import type { BoardDocument, BoardRecord } from "./board.js";
import type { PageOpCall, PcbFinding, WaivedFinding } from "./types.js";

export const WAIVER_ID_PREFIX = "rule:waiver.";
const NOTE = /^waiver (f:[^\s]+): ([\s\S]+)$/;

/** A waiver record as the core stores it (read loosely: a core without the kind never has one). */
export interface WaiverRecord {
  kind: "waiver";
  id: string;
  finding?: string;
  rule?: string;
  objects: string[];
  reason: string;
  by?: { kind: string; id: string; name?: string };
  at?: string;
}

/** One waiver on a board, in either form. */
export interface BoardWaiver {
  /** The record id: `waiver:...`, or `rule:waiver.*` for the older form. */
  id: string;
  finding?: string;
  rule?: string;
  objects: string[];
  reason: string;
  by?: string;
  at?: string;
  legacy?: true;
}

/** The older form's rule id for a finding id (`f:clearance:0123456789ab` gives `rule:waiver.clearance.0123456789ab`). */
export function waiverRuleId(findingId: string): string {
  const key = findingId.replace(/^f:/, "").replace(/[^A-Za-z0-9_.\-/+~]+/g, ".").replace(/:/g, ".").slice(0, 120);
  return `${WAIVER_ID_PREFIX}${key}`;
}

const tidy = (reason: string, max: number) => reason.trim().replace(/\s+/g, " ").slice(0, max);

/** The older form's `rule.set` input (kept for cores without `waiver.add`). */
export function waiverRule(finding: Pick<PcbFinding, "id">, reason: string): Record<string, unknown> {
  return { id: waiverRuleId(finding.id), tier: "policy", check: "disallow", applies: {}, enabled: false, severity: "ignore", note: `waiver ${finding.id}: ${tidy(reason, 400)}`.slice(0, 500) };
}

/** The `waiver.add` operation that waives one finding (its objects ride along for the record). */
export function waiverAddOp(finding: Pick<PcbFinding, "id" | "objects">, reason: string): PageOpCall {
  return { op: "waiver.add", waiver: { finding: finding.id, objects: finding.objects.slice(0, 50), reason: tidy(reason, 500) } };
}

const isWaiver = (r: BoardRecord | { kind: string }): r is BoardRecord & WaiverRecord => (r as { kind: string }).kind === "waiver";

/** Every waiver on a board, both forms. */
export function boardWaivers(doc: BoardDocument): BoardWaiver[] {
  const out: BoardWaiver[] = [];
  for (const r of doc.records.values()) {
    if (isWaiver(r)) {
      const by = r.by ? (r.by.name ?? r.by.id) : undefined;
      out.push({ id: r.id, ...(r.finding ? { finding: r.finding } : {}), ...(r.rule ? { rule: r.rule } : {}), objects: [...(r.objects ?? [])], reason: r.reason, ...(by ? { by } : {}), ...(r.at ? { at: r.at } : {}) });
      continue;
    }
    if (r.kind !== "rule" || !r.id.startsWith(WAIVER_ID_PREFIX) || r.enabled !== false || !r.note) continue;
    const m = NOTE.exec(r.note);
    if (m) out.push({ id: r.id, finding: m[1], objects: [], reason: m[2], legacy: true });
  }
  return out;
}

/** The older entries only (what the first write converts). */
export const legacyWaivers = (doc: BoardDocument): BoardWaiver[] => boardWaivers(doc).filter((w) => w.legacy);

/** The waivers on a board by the finding id they name: finding id to the record and reason. */
export function readWaivers(doc: BoardDocument): Map<string, { rule: string; reason: string; legacy?: true; by?: string; at?: string }> {
  const out = new Map<string, { rule: string; reason: string; legacy?: true; by?: string; at?: string }>();
  for (const w of boardWaivers(doc)) if (w.finding && !out.has(w.finding)) out.set(w.finding, { rule: w.id, reason: w.reason, ...(w.legacy ? { legacy: true as const } : {}), ...(w.by ? { by: w.by } : {}), ...(w.at ? { at: w.at } : {}) });
  return out;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** Whether a waiver covers a finding: its finding id, or its rule (or check) with exactly these objects (or none named). */
export function waiverCovers(w: BoardWaiver, f: PcbFinding): boolean {
  if (w.finding) return w.finding === f.id;
  if (!w.rule || (w.rule !== f.rule && w.rule !== f.check)) return false;
  return !w.objects.length || sameSet(w.objects, f.objects);
}

/** The waiver that covers a finding, if any. */
export function waiverFor(waivers: readonly BoardWaiver[], f: PcbFinding): BoardWaiver | undefined {
  return waivers.find((w) => waiverCovers(w, f));
}

/** Split findings into those still open and those a waiver covers. Takes the map `readWaivers` gives, or the list `boardWaivers` gives. */
export function applyWaivers(findings: readonly PcbFinding[], waivers: ReadonlyMap<string, { rule: string; reason: string; legacy?: true; by?: string; at?: string }> | readonly BoardWaiver[]): { open: PcbFinding[]; waived: WaivedFinding[] } {
  const open: PcbFinding[] = [];
  const waived: WaivedFinding[] = [];
  const list = Array.isArray(waivers) ? (waivers as readonly BoardWaiver[]) : undefined;
  const map = list ? undefined : (waivers as ReadonlyMap<string, { rule: string; reason: string; legacy?: true; by?: string; at?: string }>);
  for (const f of findings) {
    const w = list ? waiverFor(list, f) : map!.get(f.id);
    if (!w) {
      open.push(f);
      continue;
    }
    const rule = list ? (w as BoardWaiver).id : (w as { rule: string }).rule;
    waived.push({ finding: f, rule, reason: w.reason, ...(w.by ? { by: w.by } : {}), ...(w.at ? { at: w.at } : {}), ...(w.legacy ? { legacy: true as const } : {}) });
  }
  return { open, waived };
}

/**
 * The operations that convert the older entries to waiver records: one `waiver.add` per entry (its finding id and
 * reason) and one `rule.delete` of the entries, for one transaction by a person. Empty when there is nothing to
 * convert.
 */
export function legacyWaiverMigration(doc: BoardDocument): PageOpCall[] {
  const old = legacyWaivers(doc).filter((w) => w.finding && /^f:[\w.-]+:[0-9a-f]{12}$/.test(w.finding));
  if (!old.length) return [];
  return [...old.map((w) => ({ op: "waiver.add", waiver: { finding: w.finding!, reason: tidy(w.reason, 500) } })), { op: "rule.delete", ids: old.map((w) => w.id) }];
}

/** The operation that takes back the waivers of a finding (both forms): `waiver.remove` for records, `rule.delete` for older entries. */
export function unwaiveOps(doc: BoardDocument, finding: PcbFinding | string): PageOpCall[] {
  const all = boardWaivers(doc);
  const hit = typeof finding === "string" ? all.filter((w) => w.finding === finding || w.id === finding) : all.filter((w) => waiverCovers(w, finding));
  const records = hit.filter((w) => !w.legacy).map((w) => w.id);
  const legacy = hit.filter((w) => w.legacy).map((w) => w.id);
  return [...(records.length ? [{ op: "waiver.remove", ids: records }] : []), ...(legacy.length ? [{ op: "rule.delete", ids: legacy }] : [])];
}
