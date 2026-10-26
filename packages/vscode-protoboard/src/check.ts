/**
 * `protoboard check --format json` → Problems panel entries. No VS Code API
 * here: the extension turns each `MappedDiagnostic` into a `vscode.Diagnostic`.
 */
import { resolve } from "node:path";

export type Severity = "error" | "warning" | "info";

/** One diagnostic as the CLI prints it (`ProjectDiagnostic` in @protoboardai/core). */
export interface CheckDiagnostic {
  code: string;
  severity: Severity;
  entity: { kind: string; id: string };
  message: string;
  /** Project-relative file; `line` is 1-based. */
  source?: { file: string; line?: number };
  validator: string;
}

/** One validator's outcome (`CheckRun`). */
export interface CheckRun {
  validator: string;
  subject?: string;
  status: "ran" | "skipped";
  reason?: string;
  counts: Record<Severity, number>;
}

export interface CheckOutput {
  checks: CheckRun[];
  diagnostics: CheckDiagnostic[];
}

/** A diagnostic placed in a file: 0-based line and columns, ready for a `vscode.Range`. */
export interface MappedDiagnostic {
  file: string;
  line: number;
  startCharacter: number;
  endCharacter: number;
  severity: Severity;
  message: string;
  code: string;
  /** Shown after the message in the Problems panel. */
  source: string;
  entity: { kind: string; id: string };
  /** The diagnostic had no source location: it is placed on the project configuration. */
  unlocated: boolean;
}

export const CONFIG_FILE = "protoboard.config.ts";

/** The check output, or why it is not one. */
export function parseCheck(data: unknown): CheckOutput {
  const o = data as Partial<CheckOutput> | undefined;
  if (!o || !Array.isArray(o.diagnostics) || !Array.isArray(o.checks)) throw new Error("protoboard check printed JSON without checks and diagnostics (is the CLI older than this extension?)");
  return o as CheckOutput;
}

/**
 * Place every diagnostic in a file. A diagnostic's source is project-relative;
 * one without a source goes on `protoboard.config.ts`, line 1, so it still
 * shows in the Problems panel. `lineText` gives a file's line (0-based) when
 * the file is readable, so the range covers the line's text rather than
 * starting at its indentation.
 */
export function mapDiagnostics(root: string, out: CheckOutput, lineText: (file: string, line: number) => string | undefined = () => undefined): Map<string, MappedDiagnostic[]> {
  const byFile = new Map<string, MappedDiagnostic[]>();
  for (const d of out.diagnostics) {
    const file = resolve(root, d.source?.file ?? CONFIG_FILE);
    const line = Math.max(0, (d.source?.line ?? 1) - 1);
    const text = lineText(file, line);
    const start = text ? text.length - text.trimStart().length : 0;
    const end = text ? Math.max(start, text.trimEnd().length) : 0;
    const mapped: MappedDiagnostic = {
      file,
      line,
      startCharacter: start,
      // an empty range still underlines a few characters in the editor
      endCharacter: end > start ? end : start + 1,
      severity: d.severity,
      message: d.message,
      code: d.code,
      source: problemSource(d.validator),
      entity: d.entity,
      unlocated: !d.source,
    };
    byFile.set(file, [...(byFile.get(file) ?? []), mapped]);
  }
  return byFile;
}

/**
 * The Problems panel's source column for a validator: the validator itself
 * when it already names Protoboard (`protoboard/artifacts`,
 * `@protoboardai/ext-hardware/evidence`), else prefixed so the row says where it
 * comes from (`protoboard uhd/checkSystem`). Never "protoboard protoboard/…".
 */
export function problemSource(validator: string): string {
  const v = validator.replace(/^ext:/, "");
  return /protoboard/i.test(v) ? v : `protoboard ${v}`;
}

export interface Counts {
  error: number;
  warning: number;
  info: number;
}

export function countDiagnostics(out: CheckOutput): Counts {
  const c: Counts = { error: 0, warning: 0, info: 0 };
  for (const d of out.diagnostics) if (d.severity in c) c[d.severity]++;
  return c;
}

/** Validators that did not run, for the log and the status bar tooltip. */
export const skippedChecks = (out: CheckOutput) => out.checks.filter((c) => c.status === "skipped").map((c) => `${c.validator}${c.subject ? ` [${c.subject}]` : ""}: ${c.reason ?? "skipped"}`);

/**
 * Status bar text: the name with one mark for the check's state. The counts
 * are VS Code's own (its Problems item) and the tooltip's; repeating them
 * here only made two sets of numbers.
 */
/** The status bar item in words, for a screen reader: the mark alone says nothing ("Protoboard: 2 errors, 1 warning"). */
export function statusLabel(counts: Counts | undefined, state: "idle" | "running" | "failed"): string {
  if (state === "running") return "Protoboard: checking the project";
  if (state === "failed") return "Protoboard: the last check failed";
  if (!counts) return "Protoboard: not checked yet";
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
  if (!counts.error && !counts.warning) return "Protoboard: the checks pass, no errors or warnings";
  return `Protoboard: ${n(counts.error, "error")}, ${n(counts.warning, "warning")}`;
}

export function statusText(counts: Counts | undefined, state: "idle" | "running" | "failed"): string {
  // the Protoboard mark (the extension's icon font), then the checks' state when there is one to tell
  const name = "$(protoboard-logo) Protoboard";
  if (state === "running") return `${name} $(sync~spin)`;
  if (state === "failed") return `${name} $(circle-slash)`;
  if (!counts) return name;
  if (counts.error) return `${name} $(error)`;
  if (counts.warning) return `${name} $(warning)`;
  return `${name} $(pass)`;
}
