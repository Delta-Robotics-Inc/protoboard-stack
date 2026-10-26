/**
 * The DRC view's model: the build's findings in two lanes, Blocking (errors)
 * and Warnings, information behind a toggle, grouped by module, rule or
 * source and filtered by text and severity. Kept short: one line per finding,
 * the detail and "what to do" only when a row is expanded. No VS Code API here.
 */
import type { CheckDiagnostic, CheckRun, Severity } from "./check.js";
import { lookupCode, type CodeReference } from "./codes.js";
import { diagnosticTarget, SEVERITY_RANK, type ProjectIndex, type SourceLocation, type Target } from "./model.js";

export type FindingSource = "uhd" | "extension" | "provider" | "protoboard";

export const SOURCE_LABEL: Record<FindingSource, string> = { uhd: "UHD", extension: "Extension", provider: "Provider", protoboard: "Protoboard" };

export interface Finding {
  /** Stable within one build: index in the build's diagnostics. */
  key: string;
  code: string;
  severity: Severity;
  /** One line. */
  summary: string;
  /** The rest of the message, clause by clause. */
  reasons: string[];
  message: string;
  validator: string;
  source: FindingSource;
  target: Target;
  location?: SourceLocation;
  /** From the extension's diagnostic-codes reference. */
  means?: string;
  todo?: string;
  /** The reference row, for Explain. */
  reference?: { file: string; line: number };
}

/** Who reported a finding: UHD's validators, an extension's check, a capability provider's check, or the framework. */
export function findingSource(validator: string): FindingSource {
  if (validator.startsWith("uhd/")) return "uhd";
  if (validator.startsWith("ext:")) return /\/[a-z-]+:check$/.test(validator) ? "provider" : "extension";
  return "protoboard";
}

/** Split at "; " outside brackets, and at sentence ends (". " before a capital) outside brackets. */
function clauses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (depth === 0 && text[i + 1] === " " && (c === ";" || (c === "." && /[A-Z(]/.test(text[i + 2] ?? "")))) {
      out.push(text.slice(start, i).trim());
      start = i + 2;
      i++;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

/**
 * A message as one line plus reasons: the first clause (up to "; " or the end
 * of the first sentence, outside brackets) and the remaining clauses. A short
 * first clause keeps the next one with it.
 */
export function splitMessage(message: string): { summary: string; reasons: string[] } {
  const parts = clauses(message.replace(/\s+/g, " ").trim());
  if (parts.length > 1 && parts[0].length < 12) parts.splice(0, 2, `${parts[0]}; ${parts[1]}`);
  return { summary: parts[0] ?? "", reasons: parts.slice(1) };
}

export function findings(index: ProjectIndex, diagnostics: CheckDiagnostic[], ref?: CodeReference): Finding[] {
  return diagnostics.map((d, i) => {
    const entry = lookupCode(ref, d.code);
    const { summary, reasons } = splitMessage(d.message);
    return {
      key: String(i),
      code: d.code,
      severity: d.severity,
      summary,
      reasons,
      message: d.message,
      validator: d.validator,
      source: findingSource(d.validator),
      target: diagnosticTarget(index, d),
      location: d.source,
      means: entry?.means,
      todo: entry?.todo,
      reference: entry && { file: entry.file, line: entry.line },
    };
  });
}

export type GroupBy = "module" | "rule" | "source";

export interface DrcQuery {
  groupBy: GroupBy;
  /** Words that must all appear in the code, message, module or validator. */
  text: string;
  /** Which lanes: both, or one. */
  severity: "all" | "error" | "warning";
  /** Show information findings (a third lane). */
  info: boolean;
}

export const DEFAULT_QUERY: DrcQuery = { groupBy: "module", text: "", severity: "all", info: false };

export interface DrcGroup {
  key: string;
  label: string;
  items: Finding[];
}

export interface DrcLane {
  id: "blocking" | "warnings" | "info";
  title: string;
  /** All findings of the lane, before the text filter. */
  total: number;
  groups: DrcGroup[];
  /** Shown after the text filter. */
  shown: number;
}

export interface DrcModel {
  lanes: DrcLane[];
  counts: Record<Severity, number>;
  /** Links with no error or warning, and validators that ran, counted rather than listed. */
  configured: { links: number; linksTotal: number; checksRan: number; checksSkipped: number };
}

const groupOf = (f: Finding, by: GroupBy): { key: string; label: string } => {
  if (by === "rule") return { key: f.code, label: f.code };
  if (by === "source") return { key: f.source, label: SOURCE_LABEL[f.source] };
  const key = f.target.path ?? f.target.defId ?? f.target.label;
  const label = f.target.module ?? f.target.label;
  return { key: `m:${key}`, label: f.target.path === "" ? `${label} (root)` : label };
};

export function matchesText(f: Finding, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [f.code, f.message, f.target.label, f.target.path, f.target.defId, f.validator, SOURCE_LABEL[f.source]].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function drcModel(list: Finding[], query: DrcQuery, context: { links?: number; checks?: CheckRun[] } = {}): DrcModel {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of list) counts[f.severity]++;
  const lanes: DrcLane[] = [];
  const lane = (id: DrcLane["id"], title: string, severity: Severity) => {
    const all = list.filter((f) => f.severity === severity);
    const shown = all.filter((f) => matchesText(f, query.text));
    const groups = new Map<string, DrcGroup>();
    for (const f of shown) {
      const g = groupOf(f, query.groupBy);
      const group = groups.get(g.key) ?? { ...g, items: [] };
      group.items.push(f);
      groups.set(g.key, group);
    }
    // the biggest groups first, then by name; rows by code within a group
    const sorted = [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
    for (const g of sorted) g.items.sort((a, b) => a.code.localeCompare(b.code) || Number(a.key) - Number(b.key));
    lanes.push({ id, title, total: all.length, groups: sorted, shown: shown.length });
  };
  if (query.severity !== "warning") lane("blocking", "Blocking", "error");
  if (query.severity !== "error") lane("warnings", "Warnings", "warning");
  if (query.info && query.severity === "all") lane("info", "Information", "info");

  const flagged = new Set(list.filter((f) => f.target.linkId && SEVERITY_RANK[f.severity] <= SEVERITY_RANK.warning).map((f) => f.target.linkId));
  const checks = context.checks ?? [];
  return {
    lanes,
    counts,
    configured: {
      links: Math.max(0, (context.links ?? 0) - flagged.size),
      linksTotal: context.links ?? 0,
      checksRan: checks.filter((c) => c.status === "ran").length,
      checksSkipped: checks.filter((c) => c.status === "skipped").length,
    },
  };
}

/** A finding as the DRC page draws it: plain data, already worded. */
export interface DrcRow {
  key: string;
  code: string;
  summary: string;
  message: string;
  reasons: string[];
  module: string;
  means?: string;
  todo?: string;
  validator: string;
  sourceKind: string;
  /** `file:line`, when the finding has a source location. */
  sourceLabel?: string;
  hasSource: boolean;
  fix?: { label: string; icon?: string };
}

/**
 * The definition a PB_UNRESOLVED_DEFINITION names (B6): a library part that
 * was not fetched, which Fetch Parts adds with the others.
 */
export function unfetchedPart(f: { code: string; message: string }): string | undefined {
  if (f.code !== "PB_UNRESOLVED_DEFINITION") return undefined;
  return /references "([a-z0-9][a-z0-9._-]*)"/i.exec(f.message)?.[1];
}

/** Every definition the findings say is missing, once each, for one Fetch Parts. */
export const unfetchedParts = (fs: { code: string; message: string }[]): string[] => [...new Set(fs.map(unfetchedPart).filter((x): x is string => !!x))].sort();

export const toRow = (f: Finding): DrcRow => ({
  key: f.key,
  code: f.code,
  summary: f.summary,
  message: f.message,
  reasons: f.reasons,
  module: f.target.linkId ? `link ${f.target.label}` : f.target.path === "" ? `${f.target.label} (root)` : f.target.label,
  means: f.means,
  todo: f.todo,
  validator: f.validator,
  sourceKind: SOURCE_LABEL[f.source],
  sourceLabel: f.location ? `${f.location.file}${f.location.line ? `:${f.location.line}` : ""}` : undefined,
  hasSource: !!f.location,
  ...(unfetchedPart(f) ? { fix: { label: "Fetch Parts: add the project's missing library parts", icon: "download" } } : {}),
});

/** The model with rows in place of findings, for posting to the page. */
export const pageModel = (m: DrcModel) => ({ ...m, lanes: m.lanes.map((l) => ({ ...l, groups: l.groups.map((g) => ({ ...g, items: g.items.map(toRow) })) })) });

/** A query from the page, with anything unknown replaced by the default. */
export function parseQuery(q: Partial<Record<keyof DrcQuery, unknown>> | undefined, base: DrcQuery = DEFAULT_QUERY): DrcQuery {
  return {
    groupBy: q?.groupBy === "module" || q?.groupBy === "rule" || q?.groupBy === "source" ? q.groupBy : base.groupBy,
    text: typeof q?.text === "string" ? q.text.slice(0, 200) : base.text,
    severity: q?.severity === "all" || q?.severity === "error" || q?.severity === "warning" ? q.severity : base.severity,
    info: typeof q?.info === "boolean" ? q.info : base.info,
  };
}

/**
 * What Explain shows for a finding (B15): its code's one entry from the
 * extension's reference, as a page to read, with the finding itself under it
 * and a link to the whole reference. Not the reference file in an editor, at
 * a row of a table that wraps out of reading.
 */
export function explainMarkdown(f: Pick<Finding, "code" | "severity" | "message" | "validator" | "means" | "todo" | "reference">): string {
  const cell = (t: string) => t.replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, "\n\n");
  const out = [`# ${f.code}`, ""];
  if (f.means) out.push("**What it means.** " + cell(f.means), "");
  if (f.todo) out.push("**What to do.** " + cell(f.todo), "");
  out.push("## This finding", "", `*${f.severity}* · ${f.validator}`, "", f.message, "");
  if (f.reference) {
    const name = f.reference.file.split(/[\\/]/).slice(-1)[0];
    // a path, not a file: URL (the preview's Markdown refuses file: links); the preview opens it at the line
    const path = f.reference.file.replace(/\\/g, "/");
    out.push("---", "", `From [${name}, line ${f.reference.line}](${encodeURI(path.startsWith("/") ? path : `/${path}`)}#L${f.reference.line}), the reference of the extension that reports it.`);
  }
  return out.join("\n") + "\n";
}
