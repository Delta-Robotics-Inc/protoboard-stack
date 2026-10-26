/**
 * The committed verification summary for a part (the uhd-part-verify skill):
 * `<evidence>/verification.json`, written from the gitignored working notes in
 * `<evidence>/.research/` (audit.json, gaps.json) and the part's own traits.
 * Moved from UHD's scripts/record-verification.ts (PB-801).
 *
 * The record says who audited the part and how (PB-862): `audit.independent`
 * is true only for a stage-2 audit by an agent that did not author the part,
 * `audit.method` is the auditor's own account of what it did (audit.json
 * `method`), and `audit.auditor` names the auditor. Nothing is assumed: when
 * neither audit.json nor the caller says whether the audit was independent,
 * no record is written. A self-audit is recorded as one, and the migration's
 * `audited` stage needs an independent audit.
 */
import { join } from "node:path";
import type { ModuleDef } from "@deltarobotics/uhd";
import { readJson, type PartFiles } from "./layout.ts";

export interface AuditSummary {
  /** What the auditor did, in its own words (audit.json `method`). */
  method: string;
  /** True only when an agent that did not author the part ran the audit. */
  independent: boolean;
  /** Who audited: an agent, a session or a person (audit.json `auditor`). */
  auditor: string | null;
  checked: number;
  confirmed: number;
  wrong: number;
  unsupported: number;
}

export interface VerificationRecord {
  partId: string;
  recorded_at: string;
  audit: AuditSummary | null;
  repairs: string | null;
  assumptions: unknown[];
  data_gaps: string[];
  vocabulary_gaps: unknown[];
}

export interface RecordOptions {
  repairs?: string;
  now?: Date;
  /** --independent (true) or --self-audit (false); overrides nothing, contradicting audit.json is an error. */
  independent?: boolean;
  auditor?: string;
  method?: string;
}

// gap files use several shapes ({field}, {item, reason}, {note}); record a readable line, never raw JSON
const describeGap = (g: Record<string, unknown>) => {
  const what = g.field ?? g.item ?? g.term ?? g.description ?? g.note;
  if (what === undefined) return JSON.stringify(g);
  return g.reason && g.reason !== what ? `${what} (${g.reason})` : String(what);
};

/** Wording that says the author checked its own work. */
const SELF_WORDING = /\bself[- ]?(audit|check)|\bnot an independent\b|\bno independent (stage-2 )?(agent|audit)/i;

export class AuditRecordError extends Error {}

/**
 * Who audited and how, from audit.json and the caller's flags. Throws
 * AuditRecordError when independence is not stated or the statements disagree.
 */
export function auditProvenance(audit: Record<string, unknown>, options: RecordOptions = {}): Pick<AuditSummary, "method" | "independent" | "auditor"> {
  const fromFile = typeof audit.independent === "boolean" ? audit.independent : undefined;
  if (audit.independent !== undefined && fromFile === undefined) throw new AuditRecordError("audit.json: independent must be true or false");
  if (options.independent !== undefined && fromFile !== undefined && options.independent !== fromFile) {
    throw new AuditRecordError(`audit.json says independent: ${fromFile}, but the flag says ${options.independent ? "--independent" : "--self-audit"}`);
  }
  const independent = options.independent ?? fromFile;
  if (independent === undefined) {
    throw new AuditRecordError(
      "say who audited: pass --independent (an agent that did not author the part ran the audit) or --self-audit, or set \"independent\" in .research/audit.json",
    );
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const auditor = options.auditor ?? str(audit.auditor) ?? null;
  const method =
    options.method ??
    str(audit.method) ??
    (independent
      ? "independent stage-2 audit by an agent that did not author the part (uhd-part-verify); audit.json does not say how the sources were checked"
      : "self-audit by the authoring agent, not independent (an independent stage-2 audit is still owed); audit.json does not say how the sources were checked");
  if (independent && (SELF_WORDING.test(method) || (auditor && SELF_WORDING.test(auditor)))) {
    throw new AuditRecordError(`the audit is marked independent, but its method or auditor describes a self-audit: "${(SELF_WORDING.test(method) ? method : auditor)!.slice(0, 160)}"`);
  }
  return { method, independent, auditor };
}

export function verificationRecord(f: PartFiles, def: ModuleDef | undefined, options: RecordOptions = {}): VerificationRecord {
  const research = join(f.root, f.research);
  const audit = readJson<Record<string, any>>(join(research, "audit.json"));
  const gaps = readJson<Array<Record<string, unknown>>>(join(research, "gaps.json")) ?? [];
  const facts = (Array.isArray(audit) ? audit : (audit?.facts ?? audit?.checks ?? audit?.results ?? [])) as Array<{ verdict?: string }>;
  const count = (v: string) => facts.filter((x) => String(x.verdict ?? "").toLowerCase() === v).length;
  const summary = (Array.isArray(audit) ? {} : (audit?.summary ?? audit?.counts)) ?? {};
  const traits = def ? [def, ...def.interfaces].flatMap((x) => x.traits ?? []) : [];
  return {
    partId: f.id,
    recorded_at: (options.now ?? new Date()).toISOString(),
    audit: audit
      ? {
          ...auditProvenance(Array.isArray(audit) ? {} : audit, options),
          checked: summary.checked ?? facts.length,
          confirmed: summary.confirmed ?? count("confirmed"),
          wrong: summary.wrong ?? count("wrong"),
          unsupported: summary.unsupported ?? count("unsupported"),
        }
      : null,
    repairs: options.repairs ?? null,
    assumptions: traits
      .filter((t) => t.type === "assumption")
      .map((t) => (t.params as Record<string, unknown>)?.field ?? (t.params as Record<string, unknown>)?.note ?? "assumption"),
    data_gaps: gaps.filter((g) => g.type === "data").map((g) => describeGap(g)),
    vocabulary_gaps: gaps.filter((g) => g.type === "vocabulary").map((g) => g.term ?? g.note ?? g.description ?? JSON.stringify(g)),
  };
}

export const recordSummary = (r: VerificationRecord) =>
  `${r.partId}: audit ${r.audit ? `${r.audit.confirmed}/${r.audit.checked} (${r.audit.independent ? "independent" : "self-audit"})` : "none"}, ${r.assumptions.length} assumption(s), ${r.data_gaps.length} data gap(s)`;
