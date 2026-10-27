/**
 * Operations: named extension actions with declared effects and a portable
 * operation record (core-cli-v0.md). The record keeps what ran, on which
 * inputs (the resolved-project digest), with which tool versions, and what it
 * produced, so results can be traced and nothing is silently repeated.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { resolvedProject, stableStringify } from "./build.js";
import { loadEntry, probeTools, type LoadedExtension, type OperationDecl } from "./extensions.js";
import type { Project } from "./project.js";
import { withToolEnvironment } from "./tools.js";
import type { ProjectDiagnostic } from "./types.js";
import { projectRelative, recordedPath } from "./paths.js";

export interface OperationContext {
  project: Project;
  inputs: Record<string, string>;
  /** Write a project file and register it as an output. Paths are project-relative. */
  writeOutput: (path: string, content: string | Buffer, description?: string) => void;
  log: (line: string) => void;
}

export interface OperationOutput {
  path: string;
  digest: string;
  bytes: number;
  description?: string;
}

export interface OperationResult {
  status: "succeeded" | "failed";
  summary: string;
  /** Structured data for agents (counts, findings, …). */
  data?: unknown;
}

export type OperationFn = (ctx: OperationContext) => Promise<OperationResult> | OperationResult;

export interface OperationRecord {
  schema: "protoboard.operation/v0";
  /** Operation id; `<capability>:<operation>` for a capability operation (circuit:export). */
  operation: string;
  extension: { id: string; version: string };
  /** Capability operations: which module, through which config (tool-integrations.md §2, §4). */
  capability?: {
    id: string;
    operation: string;
    provider: string;
    module: string;
    instance?: string;
    /** Project-relative config file and the digest of its bytes. */
    config: string;
    configDigest: string;
    /**
     * Digest of the module's definition and every definition it contains
     * (`moduleDigest`), so a later reader (a release) can tell whether the
     * module changed since this run. Absent in records written before it existed.
     */
    moduleDigest?: string;
  };
  effect: OperationDecl["effect"];
  inputs: Record<string, string>;
  /** Digest of the resolved project the operation read. */
  projectDigest: string;
  /** Tools the operation requires, as probed; `source` says where a runtime-provided tool was found. */
  tools: { id: string; available: boolean; detail?: string; source?: "environment" | "runtime" | "system" }[];
  status: OperationResult["status"] | "refused";
  summary: string;
  outputs: OperationOutput[];
  data?: unknown;
  /** Findings attached to the run (a provider check, standard-output validation). */
  diagnostics?: ProjectDiagnostic[];
  /**
   * What the operation wrote with `ctx.log` (part-verify's findings, a build's
   * progress), in order; and, when it threw, the error's stack. Absent when
   * it logged nothing.
   */
  log?: string[];
  startedAt: string;
  finishedAt: string;
}

/** The lines of a thrown error worth keeping: its message, then up to 12 stack frames (none for a non-Error). */
export function thrownTrace(e: unknown): string[] {
  if (!(e instanceof Error)) return [`threw ${String(e)}`];
  const frames = (e.stack ?? "")
    .split("\n")
    .filter((l) => /^\s+at /.test(l))
    .slice(0, 12)
    .map((l) => `  ${l.trim()}`);
  return [`${e.name}: ${e.message}`, ...frames];
}

const digest = (b: string | Buffer) =>"sha256:" + createHash("sha256").update(b).digest("hex");

export function findOperation(extensions: LoadedExtension[], id: string): { ext: LoadedExtension; op: OperationDecl } | undefined {
  for (const ext of extensions) {
    const op = (ext.manifest.operations ?? []).find((o) => o.id === id || `${ext.manifest.id}:${o.id}` === id);
    if (op) return { ext, op };
  }
  return undefined;
}

export async function runOperation(
  p: Project,
  ext: LoadedExtension,
  op: OperationDecl,
  inputs: Record<string, string>,
  options: RunOptions = {},
): Promise<OperationRecord> {
  return invokeOperation(p, ext, { id: op.id, entry: op.entry, effect: op.effect, requires: op.requires, inputs: op.inputs }, inputs, options);
}

export interface RunOptions {
  authorize?: boolean;
  record?: boolean;
  now?: () => string;
}

/** What `invokeOperation` runs: an ordinary operation, or a capability operation with its hooks. */
export interface Invocation {
  /** Record id (and file-name stem). */
  id: string;
  entry: string;
  /** Run this instead of loading `entry` (an alias running one module's step in-process). */
  fn?: OperationFn;
  effect: OperationDecl["effect"];
  requires?: string[];
  inputs?: OperationDecl["inputs"];
  capability?: OperationRecord["capability"];
  /** A reason to refuse writing `path` (project-relative), or undefined to allow it. */
  guardWrite?: (path: string) => string | undefined;
  /** Extend the context handed to the entry. */
  context?: (ctx: OperationContext) => OperationContext;
  /** Runs once nothing refuses the operation, just before the entry. */
  prepare?: () => void;
  /**
   * Stage some outputs: a write `redirect` maps goes to that (project-relative) path instead,
   * `commit` moves the staged files into place once the entry succeeds, and `abort` drops them
   * when it fails or throws. Records keep the final paths.
   */
  stage?: { redirect: (path: string) => string | undefined; commit: () => void; abort: () => void };
  /** Inspect the result after the entry returns: adjust it and attach findings. */
  after?: (result: OperationResult, outputs: OperationOutput[]) => { result: OperationResult; diagnostics?: ProjectDiagnostic[] };
}

export async function invokeOperation(p: Project, ext: LoadedExtension, inv: Invocation, inputs: Record<string, string>, options: RunOptions = {}): Promise<OperationRecord> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const projectDigest = digest(stableStringify(resolvedProject(p)));
  const tools = probeTools([{ ...ext, manifest: { ...ext.manifest, tools: (ext.manifest.tools ?? []).filter((t) => inv.requires?.includes(t.id)) } }], { root: p.root }).map((t) => ({
    id: t.id,
    available: t.available,
    detail: t.detail,
    ...(t.source ? { source: t.source } : {}),
  }));
  const base: Omit<OperationRecord, "status" | "summary" | "outputs" | "finishedAt"> = {
    schema: "protoboard.operation/v0",
    operation: inv.id,
    extension: { id: ext.manifest.id, version: ext.manifest.version },
    ...(inv.capability ? { capability: inv.capability } : {}),
    effect: inv.effect,
    inputs,
    projectDigest,
    tools,
    startedAt,
  };
  const refuse = (summary: string): OperationRecord => ({ ...base, status: "refused", summary, outputs: [], finishedAt: now() });

  if ((inv.effect === "external" || inv.effect === "physical") && !options.authorize) {
    return refuse(`${inv.id} has ${inv.effect} effects; re-run with --authorize to confirm. It is never retried automatically.`);
  }
  const missingTools = tools.filter((t) => !t.available);
  if (missingTools.length) return refuse(`required tool(s) unavailable: ${missingTools.map((t) => `${t.id} (${t.detail})`).join("; ")}`);
  for (const [k, spec] of Object.entries(inv.inputs ?? {})) {
    if (inputs[k] === undefined && spec.default !== undefined) inputs[k] = spec.default;
    if (spec.required && inputs[k] === undefined) return refuse(`missing input ${k}: ${spec.description}`);
  }
  const unknown = Object.keys(inputs).filter((k) => !(inv.inputs ?? {})[k]);
  if (unknown.length) return refuse(`unknown input(s) ${unknown.join(", ")}; ${inv.id} takes ${Object.keys(inv.inputs ?? {}).join(", ") || "none"}`);

  const outputs: OperationOutput[] = [];
  const logs: string[] = [];
  let ctx: OperationContext = {
    project: p,
    inputs,
    writeOutput: (path, content, description) => {
      if (inv.effect === "pure") throw new Error(`${inv.id} is declared pure and cannot write ${path}`);
      const refused = inv.guardWrite?.(path);
      if (refused) throw new Error(refused);
      const abs = join(p.root, inv.stage?.redirect(path) ?? path);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
      outputs.push({ path: recordedPath(path), digest: digest(content), bytes: Buffer.byteLength(content), ...(description ? { description } : {}) });
    },
    log: (line) => logs.push(line),
  };
  if (inv.context) ctx = inv.context(ctx);
  let result: OperationResult;
  let diagnostics: ProjectDiagnostic[] | undefined;
  try {
    const fn = inv.fn ?? (await loadEntry<OperationFn>(ext, inv.entry));
    inv.prepare?.();
    // the project's installed runtimes are visible to the entry and every tool it spawns
    result = await withToolEnvironment(p.root, () => fn(ctx));
    if (inv.stage) {
      if (result.status === "succeeded") inv.stage.commit();
      else inv.stage.abort();
    }
    if (inv.after) ({ result, diagnostics } = inv.after(result, outputs));
  } catch (e) {
    try {
      inv.stage?.abort();
    } catch {
      // the staging folder is removed again before the next run
    }
    result = { status: "failed", summary: (e as Error).message.split("\n")[0] };
    // the summary keeps one line; the stack says where it broke (a bare "Cannot read properties of undefined" is not actionable)
    logs.push(...thrownTrace(e));
  }
  const record: OperationRecord = {
    ...base,
    status: result.status,
    summary: result.summary,
    outputs,
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    ...(logs.length ? { log: logs } : {}),
    finishedAt: now(),
  };
  if (options.record !== false && inv.effect !== "pure") {
    const dir = join(p.root, "operations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(p.root, operationRecordFile(record)), JSON.stringify(record, null, 2) + "\n");
  }
  return record;
}

/** Where a record is (or would be) written: `operations/<startedAt>-<operation>.json`, project-relative. */
export const operationRecordFile = (record: Pick<OperationRecord, "startedAt" | "operation">): string =>
  `operations/${record.startedAt.replace(/[:.]/g, "-")}-${record.operation.replace(/[^\w.-]/g, "-")}.json`;

/** Operation records in `operations/`, newest last. */
export function listOperationRecords(p: Project): { file: string; record: OperationRecord }[] {
  const dir = join(p.root, "operations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: projectRelative(p.root, join(dir, f)), record: JSON.parse(readFileSync(join(dir, f), "utf8")) as OperationRecord }));
}
