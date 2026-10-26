/**
 * Steps: one small vocabulary for seeding a fixture (move a part, swap two
 * wires) and for the known-good solution the scripted host replays. Every
 * step runs inside one project directory; paths are relative to it, except
 * `from` paths, which are relative to the case folder.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface StepExpect {
  /** Exit code (default 0). */
  exit?: number;
  /** `protoboard` steps: the JSON result's `status` (an operation record's succeeded/failed/refused). */
  status?: string;
}

export type Step =
  /** The protoboard CLI in the project (`--format json` is added). */
  | { protoboard: string[]; expect?: StepExpect; note?: string }
  /** Any command, run in the project. `{node}` is the running Node binary. */
  | { command: string[]; expect?: StepExpect; note?: string }
  /** Replace text in a file; it must occur (exactly `count` times when given). */
  | { replace: { file: string; find: string; with: string; count?: number }; note?: string }
  /** Write a file from inline content or a file in the case folder. */
  | { write: { file: string; content?: string; from?: string }; note?: string }
  /** Copy a file or folder from the case folder into the project. */
  | { copy: { from: string; to: string }; note?: string }
  /** Delete a file or folder. */
  | { remove: string; note?: string }
  /** Set values in a JSON file by path (`spatial.placements.bulk_cap.matrix.3`). */
  | { json: { file: string; set: Record<string, unknown> }; note?: string }
  /** The scripted host's answer: text a transcript grader reads. */
  | { say: string };

export interface StepContext {
  /** The project directory the steps act on. */
  dir: string;
  /** The case folder (`from` paths). */
  caseDir: string;
  /** argv prefix that runs the protoboard CLI ([node, bin/protoboard.mjs]). */
  cli: string[];
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  /** Stop a running command after this many milliseconds. */
  timeoutMs?: number;
  /** Stop the running command, and the steps after it, when this aborts (a deadline for the whole sequence). */
  signal?: AbortSignal;
}

export interface StepResult {
  step: string;
  ok: boolean;
  exit?: number | null;
  status?: string;
  detail?: string;
  ms: number;
}

export class StepError extends Error {
  /** Every step that ran, the failed one last (set by runSteps). */
  results: StepResult[];
  constructor(
    message: string,
    readonly result: StepResult,
  ) {
    super(message);
    this.results = [result];
  }
}

export interface CommandResult {
  exit: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** A child process that does not block the event loop; killed after `timeoutMs`. */
export function runCommand(argv: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal; input?: string }): Promise<CommandResult> {
  return new Promise((done) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: options.cwd, env: options.env ?? process.env, stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout!.on("data", (d) => (stdout += d));
    child.stderr!.on("data", (d) => (stderr += d));
    if (options.input !== undefined) child.stdin!.end(options.input);
    const kill = () => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    };
    const timer = options.timeoutMs ? setTimeout(kill, options.timeoutMs) : undefined;
    if (options.signal?.aborted) kill();
    else options.signal?.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => {
      stderr += e.message;
    });
    child.on("close", (exit) => {
      if (timer) clearTimeout(timer);
      done({ exit, stdout, stderr, timedOut });
    });
  });
}

/** A path inside the project; anything that leaves it is refused. */
export function inside(dir: string, rel: string): string {
  const abs = resolve(dir, rel);
  const r = relative(dir, abs);
  if (r.startsWith("..") || isAbsolute(r)) throw new Error(`${rel} is outside the project`);
  return abs;
}

const fromCase = (ctx: StepContext, rel: string) => resolve(ctx.caseDir, rel);

/** Set `value` at a dotted path; numeric segments index arrays. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur: Record<string, unknown> = target;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] === undefined || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

export const describeStep = (s: Step): string =>
  "protoboard" in s
    ? `protoboard ${s.protoboard.join(" ")}`
    : "command" in s
      ? s.command.join(" ")
      : "replace" in s
        ? `replace in ${s.replace.file}`
        : "write" in s
          ? `write ${s.write.file}`
          : "copy" in s
            ? `copy ${s.copy.from} → ${s.copy.to}`
            : "remove" in s
              ? `remove ${s.remove}`
              : "json" in s
                ? `set ${Object.keys(s.json.set).join(", ")} in ${s.json.file}`
                : "say";

/** Run one step. Throws StepError when it fails; `say` returns its text. */
export async function runStep(step: Step, ctx: StepContext): Promise<StepResult & { said?: string }> {
  const started = Date.now();
  const name = describeStep(step);
  const done = (r: Partial<StepResult> & { ok: boolean }): StepResult => ({ step: name, ms: Date.now() - started, ...r });
  const fail = (detail: string, r: Partial<StepResult> = {}): never => {
    throw new StepError(`${name}: ${detail}`, done({ ok: false, detail, ...r }));
  };
  ctx.log(`  · ${name}`);
  if ("say" in step) return { ...done({ ok: true }), said: step.say };
  if ("protoboard" in step || "command" in step) {
    const pb = "protoboard" in step;
    const args = pb ? [...ctx.cli, ...step.protoboard, ...(step.protoboard.includes("--format") ? [] : ["--format", "json"])] : step.command.map((a) => (a === "{node}" ? process.execPath : a));
    const r = await runCommand(args, { cwd: ctx.dir, env: ctx.env, timeoutMs: ctx.timeoutMs, signal: ctx.signal });
    const want = step.expect?.exit ?? (step.expect?.status !== undefined ? undefined : 0);
    let status: string | undefined;
    let summary: string | undefined;
    if (pb) {
      try {
        ({ status, summary } = JSON.parse(r.stdout) as { status?: string; summary?: string });
      } catch {
        // not every command prints a record
      }
    }
    // a record says why in its summary; the last lines of its JSON would not
    const tail = typeof summary === "string" && summary ? summary.slice(0, 400) : (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400);
    if (r.timedOut) fail("timed out", { exit: r.exit });
    if (want !== undefined && r.exit !== want) fail(`exit ${r.exit}, expected ${want}${status ? ` (status ${status})` : ""}: ${tail}`, { exit: r.exit, status });
    if (step.expect?.status !== undefined && status !== step.expect.status) fail(`status ${status ?? "(none)"}, expected ${step.expect.status}: ${tail}`, { exit: r.exit, status });
    return done({ ok: true, exit: r.exit, ...(status ? { status } : {}) });
  }
  if ("replace" in step) {
    const file = inside(ctx.dir, step.replace.file);
    if (!existsSync(file)) fail("no such file");
    const text = readFileSync(file, "utf8");
    const n = text.split(step.replace.find).length - 1;
    if (n === 0 || (step.replace.count !== undefined && n !== step.replace.count)) fail(`found ${n} occurrence(s) of the text${step.replace.count !== undefined ? `, expected ${step.replace.count}` : ""}`);
    writeFileSync(file, text.split(step.replace.find).join(step.replace.with));
    return done({ ok: true });
  }
  if ("write" in step) {
    const file = inside(ctx.dir, step.write.file);
    mkdirSync(dirname(file), { recursive: true });
    if (step.write.from !== undefined) writeFileSync(file, readFileSync(fromCase(ctx, step.write.from)));
    else writeFileSync(file, step.write.content ?? "");
    return done({ ok: true });
  }
  if ("copy" in step) {
    const to = inside(ctx.dir, step.copy.to);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(fromCase(ctx, step.copy.from), to, { recursive: true });
    return done({ ok: true });
  }
  if ("remove" in step) {
    rmSync(inside(ctx.dir, step.remove), { recursive: true, force: true });
    return done({ ok: true });
  }
  if ("json" in step) {
    const file = inside(ctx.dir, step.json.file);
    const raw = readFileSync(file, "utf8");
    const value = JSON.parse(raw) as Record<string, unknown>;
    for (const [path, v] of Object.entries(step.json.set)) setPath(value, path, v);
    writeFileSync(file, JSON.stringify(value, null, raw.match(/^\s*\{\n(\s+)/)?.[1]?.length ?? 2) + "\n");
    return done({ ok: true });
  }
  return fail("unknown step");
}

/** Run steps in order; stops at the first failure (StepError). Returns the results and anything said. */
export async function runSteps(steps: Step[], ctx: StepContext): Promise<{ results: StepResult[]; said: string[] }> {
  const results: StepResult[] = [];
  const said: string[] = [];
  for (const s of steps) {
    try {
      if (ctx.signal?.aborted) throw new StepError(`${describeStep(s)}: not started, out of time`, { step: describeStep(s), ok: false, detail: "out of time", ms: 0 });
      const { said: text, ...r } = await runStep(s, ctx);
      if (text !== undefined) said.push(text);
      results.push(r);
    } catch (e) {
      if (e instanceof StepError) e.results = [...results, e.result];
      throw e;
    }
  }
  return { results, said };
}

