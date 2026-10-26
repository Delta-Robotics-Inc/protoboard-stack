/**
 * Agent-host adapters. The runner hands a host a project directory (a copy
 * of the fixture), the instruction, the tools the case allows and a budget;
 * the host runs its agent there and reports how it ended. Nothing here is an
 * agent runtime: a host is a thin bridge to one that already exists.
 *
 *   scripted      replays the case's known-good steps: tests the harness and
 *                 the cases themselves, deterministically and for free
 *   claude-code   Claude Code headless (`claude -p`), inside the copy only
 */
import { spawn } from "node:child_process";
import { createWriteStream, realpathSync, writeFileSync } from "node:fs";
import type { SkillHost } from "../skills.js";
import type { EvalBudget, EvalTools } from "./case.js";
import type { Judge } from "./graders.js";
import { runCommand, runSteps, StepError, type Step, type StepContext, type StepResult } from "./steps.js";

export interface HostTask {
  caseKey: string;
  /** The trial's project directory: a copy of the fixture, never the user's checkout. */
  dir: string;
  /** Where the trial's node_modules link points (the module mirror, outside `dir`): readable, not writable. */
  modules?: string;
  instruction: string;
  tools: Required<EvalTools>;
  budget: EvalBudget;
  /** The known-good steps (only the scripted host reads them). */
  solution: Step[];
  steps: StepContext;
  /** Where to write the transcript (absolute). */
  transcript: string;
  /** false: the ablation arm, without the stack's skills (no Skill tool; the runner exports none). Default true. */
  skills?: boolean;
  log: (line: string) => void;
}

export interface HostRun {
  status: "completed" | "max-turns" | "timeout" | "budget" | "error";
  /** The agent's final answer. */
  answer: string;
  detail?: string;
  turns?: number;
  durationMs: number;
  costUsd?: number;
  model?: string;
  steps?: StepResult[];
}

export interface AgentHost {
  id: string;
  /**
   * The host runs only the case's own steps (the scripted host). The runner
   * watches the workspace during the trials of every other host and fails a
   * trial that changed anything outside its copy.
   */
  trusted?: boolean;
  /** Where this host discovers skills: the runner runs `protoboard skills export --host <it>` in the trial first. */
  skillHost?: SkillHost;
  probe(): Promise<{ available: boolean; version?: string; detail?: string }>;
  run(task: HostTask): Promise<HostRun>;
}

// ---------------------------------------------------------------------------
// scripted
// ---------------------------------------------------------------------------

export const scriptedHost: AgentHost = {
  id: "scripted",
  trusted: true,
  probe: async () => ({ available: true, version: "1" }),
  async run(task) {
    const started = Date.now();
    // one deadline for the whole sequence, as for an agent: the case's time budget
    const signal = AbortSignal.timeout(task.budget.seconds * 1000);
    try {
      const { results, said } = await runSteps(task.solution, { ...task.steps, timeoutMs: undefined, signal });
      writeFileSync(task.transcript, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
      return { status: "completed", answer: said.join("\n"), turns: task.solution.length, durationMs: Date.now() - started, steps: results };
    } catch (e) {
      const results = e instanceof StepError ? e.results : [];
      writeFileSync(task.transcript, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
      const status = signal.aborted ? "timeout" : "error";
      return { status, answer: "", detail: status === "timeout" ? `stopped after ${task.budget.seconds} s: ${(e as Error).message}` : (e as Error).message, turns: results.length, durationMs: Date.now() - started, steps: results };
    }
  },
};

// ---------------------------------------------------------------------------
// claude-code
// ---------------------------------------------------------------------------

export interface ClaudeCodeOptions {
  /** The executable (default `claude`, or PROTOBOARD_EVAL_CLAUDE). */
  command?: string;
  model?: string;
}

/** Appended to Claude Code's system prompt: nobody answers questions during an eval. */
const EVAL_NOTE =
  "This is an automated evaluation run in a scratch copy of a Protoboard project. Nobody will answer questions: do the task with the tools you have, then end with a short summary of what you found and what you changed. Do not order, upload, print or contact any service.";

/**
 * The `claude -p` arguments for a task: stream-json transcript, the case's
 * turn limit and spending ceiling, only the built-in tools the case needs,
 * permissions that deny anything the case did not allow (`dontAsk`: no
 * prompts), reads confined to the copy and the module mirror, edits to the
 * copy outside node_modules, no shell command that names `--cwd` or `..`,
 * no MCP servers, no user or local settings files (hooks, permissions of
 * the person running it), no saved session.
 */
export function claudeCodeArgs(task: Pick<HostTask, "instruction" | "tools" | "budget" | "modules" | "skills"> & { dir?: string }, options: ClaudeCodeOptions = {}): string[] {
  const skill = task.skills === false ? [] : ["Skill"];
  // the built-in tools the session has at all, then the permission rules for them
  const builtin = [...skill, ...(task.tools.read ? ["Read", "Glob", "Grep"] : []), ...(task.tools.edit ? ["Edit", "Write"] : []), ...(task.tools.commands.length ? ["Bash"] : [])];
  // Rules on the trial's absolute path (`//abs/**`): `./**` follows the session's working directory, so after a `cd`
  // into the module mirror it allowed edits there and denied them in the copy. Both spellings of a path that has a
  // symbolic link in it (macOS /var → /private/var) are listed. Without `dir` (a caller that has none), `./**`.
  const roots = task.dir ? [...new Set([task.dir, realOr(task.dir)])].map((d) => `/${d}`) : ["."];
  const under = (tool: string, sub = "") => roots.map((r) => `${tool}(${r}${sub}/**)`);
  // Read rules cover Glob and Grep; outside the working directories (the copy, --add-dir) dontAsk denies reads
  const allowed = [...skill, ...(task.tools.read ? under("Read") : []), ...(task.tools.edit ? [...under("Edit"), ...under("Write")] : []), ...task.tools.commands.map((c) => `Bash(${c})`)];
  const denied = [
    ...under("Edit", "/node_modules"),
    ...under("Write", "/node_modules"),
    ...(task.modules ? [`Edit(/${task.modules}/**)`, `Write(/${task.modules}/**)`] : []),
    // another project directory, or a path that climbs out of the copy
    "Bash(*--cwd*)",
    "Bash(*..*)",
  ];
  return [
    "-p",
    task.instruction,
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(task.budget.turns),
    ...(task.budget.usd !== undefined ? ["--max-budget-usd", String(task.budget.usd)] : []),
    "--tools",
    builtin.join(","),
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    allowed.join(","),
    "--disallowedTools",
    denied.join(","),
    ...(task.modules ? ["--add-dir", task.modules] : []),
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "project",
    "--no-session-persistence",
    "--append-system-prompt",
    EVAL_NOTE,
    ...(options.model ? ["--model", options.model] : []),
  ];
}

/** The real path of a directory, or the path itself when it cannot be resolved. */
const realOr = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** The environment for a nested `claude`: without the variables a parent Claude Code session sets. */
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const e = { ...env };
  for (const k of Object.keys(e)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) delete e[k];
  return e;
}

interface ResultMessage {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  result?: string;
  structured_output?: unknown;
}

/** Read a stream-json transcript's final result message and model. */
export function parseStreamJson(text: string): { result?: ResultMessage; model?: string } {
  let result: ResultMessage | undefined;
  let model: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line) as { type?: string; subtype?: string; model?: string };
      if (m.type === "system" && m.subtype === "init" && m.model) model = m.model;
      if (m.type === "result") result = m as ResultMessage;
    } catch {
      // partial line from a killed process
    }
  }
  return { result, model };
}

export function claudeCodeHost(options: ClaudeCodeOptions = {}): AgentHost {
  const command = options.command ?? process.env.PROTOBOARD_EVAL_CLAUDE ?? "claude";
  return {
    id: "claude-code",
    skillHost: "claude-code",
    async probe() {
      const v = await runCommand([command, "--version"], { cwd: process.cwd(), env: childEnv(process.env), timeoutMs: 20000 });
      if (v.exit !== 0) return { available: false, detail: `${command} --version failed: ${(v.stderr || v.stdout).trim().slice(0, 160) || `exit ${v.exit}`}` };
      const version = v.stdout.trim().split("\n")[0];
      if (process.env.ANTHROPIC_API_KEY) return { available: true, version };
      const a = await runCommand([command, "auth", "status"], { cwd: process.cwd(), env: childEnv(process.env), timeoutMs: 20000 });
      try {
        const s = JSON.parse(a.stdout) as { loggedIn?: boolean };
        return s.loggedIn ? { available: true, version } : { available: false, version, detail: "not signed in (claude auth login, or ANTHROPIC_API_KEY)" };
      } catch {
        return { available: a.exit === 0, version, detail: a.exit === 0 ? undefined : "claude auth status failed" };
      }
    },
    async run(task) {
      const started = Date.now();
      const out = createWriteStream(task.transcript);
      let text = "";
      const r = await new Promise<{ exit: number | null; timedOut: boolean; stderr: string }>((done) => {
        const child = spawn(command, claudeCodeArgs(task, options), { cwd: task.dir, env: childEnv(task.steps.env), stdio: ["ignore", "pipe", "pipe"] });
        let stderr = "";
        let timedOut = false;
        child.stdout.on("data", (d: Buffer) => {
          out.write(d);
          text += d;
        });
        child.stderr.on("data", (d: Buffer) => (stderr += d));
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 5000).unref();
        }, task.budget.seconds * 1000);
        child.on("error", (e) => (stderr += e.message));
        child.on("close", (exit) => {
          clearTimeout(timer);
          done({ exit, timedOut, stderr });
        });
      });
      await new Promise((ok) => out.end(ok));
      const { result, model } = parseStreamJson(text);
      const base = { durationMs: Date.now() - started, turns: result?.num_turns, costUsd: result?.total_cost_usd, model, answer: result?.result ?? "" };
      if (r.timedOut) return { ...base, status: "timeout", detail: `stopped after ${task.budget.seconds} s` };
      if (!result) return { ...base, status: "error", detail: (r.stderr.trim().split("\n").pop() || `exit ${r.exit}, no result message`).slice(0, 300) };
      if (result.subtype === "error_max_turns") return { ...base, status: "max-turns", detail: `reached ${task.budget.turns} turns` };
      if (result.subtype?.includes("budget")) return { ...base, status: "budget", detail: result.subtype };
      if (result.is_error) return { ...base, status: "error", detail: result.subtype ?? "error" };
      return { ...base, status: "completed" };
    },
  };
}

// ---------------------------------------------------------------------------
// Rubric judge: Claude Code without tools, structured output
// ---------------------------------------------------------------------------

const VERDICT_SCHEMA = {
  type: "object",
  properties: { score: { type: "number", minimum: 0, maximum: 1 }, reasons: { type: "string" } },
  required: ["score", "reasons"],
};

const NOTES_SCHEMA = {
  type: "object",
  properties: { notes: { type: "string" } },
  required: ["notes"],
};

export interface JudgeOptions extends ClaudeCodeOptions {
  /**
   * Characters of material (files and answer) the judge reads in one call (default 300 000, about 75 000 tokens).
   * More than that is read in parts: each part gives notes per criterion, and the verdict is given on the notes.
   */
  maxChars?: number;
}

/** One file's text in parts of at most `max` characters, cut at line ends where it can. */
export function splitText(text: string, max: number): string[] {
  const parts: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + max);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > at + max / 2) end = nl + 1;
    }
    parts.push(text.slice(at, end));
    at = end;
  }
  return parts.length ? parts : [""];
}

/**
 * The files as sections of at most `max` characters each: whole files packed together, a long file in numbered parts.
 * An entry with a `heading` is shown under that heading instead of `File: <path>` (the agent's answer).
 */
export function judgeSections(files: { path: string; content: string; heading?: string }[], max: number): string[] {
  const blocks = files.flatMap((f) => {
    const title = f.heading ?? `File: ${f.path}`;
    const parts = splitText(f.content, max - title.length - 64);
    return parts.map((p, i) => ["", `## ${title}${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ""}`, "```", p, "```"].join("\n"));
  });
  const sections: string[] = [];
  for (const b of blocks) {
    if (sections.length && sections[sections.length - 1].length + b.length <= max) sections[sections.length - 1] += b;
    else sections.push(b);
  }
  return sections;
}

export function claudeCodeJudge(options: JudgeOptions = {}): Judge {
  const command = options.command ?? process.env.PROTOBOARD_EVAL_CLAUDE ?? "claude";
  const maxChars = options.maxChars ?? 300_000;
  const ask = async <T>(prompt: string, schema: object): Promise<T> => {
    const r = await runCommand(
      [command, "-p", "--output-format", "json", "--json-schema", JSON.stringify(schema), "--tools", "", "--max-turns", "3", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "project", "--no-session-persistence", ...(options.model ? ["--model", options.model] : [])],
      // the prompt goes in on standard input: no argument-length limit
      { cwd: process.cwd(), env: childEnv(process.env), timeoutMs: 600000, input: prompt },
    );
    let msg: ResultMessage;
    try {
      msg = JSON.parse(r.stdout) as ResultMessage;
    } catch {
      throw new Error(`judge printed no result: ${(r.stderr || r.stdout).trim().split("\n").pop()?.slice(0, 300) ?? `exit ${r.exit}`}`);
    }
    return (msg.structured_output ?? JSON.parse(msg.result ?? "{}")) as T;
  };
  const verdict = async (prompt: string) => {
    const v = await ask<{ score?: number; reasons?: string }>(prompt, VERDICT_SCHEMA);
    if (typeof v.score !== "number") throw new Error(`judge returned no score: ${JSON.stringify(v).slice(0, 200)}`);
    return { score: v.score, reasons: v.reasons ?? "" };
  };
  const answerBlock = (answer?: string) => (answer !== undefined ? ["", "## The agent's final answer", answer] : []);
  return {
    id: `claude-code${options.model ? `:${options.model}` : ""}`,
    async grade({ rubric, files, answer }) {
      const head = "Grade the work below against the rubric. Score 0 to 1: the fraction of the rubric's criteria that the work meets, judged strictly from the material shown. Name each unmet criterion in the reasons.";
      const material = files.reduce((a, f) => a + f.content.length + f.path.length, 0) + (answer?.length ?? 0);
      if (material <= maxChars) return verdict([head, "", "## Rubric", rubric, ...judgeSections(files, Number.MAX_SAFE_INTEGER), ...answerBlock(answer)].join("\n"));
      // too much for one reading: notes on each part, then the verdict on the notes.
      // A long answer is read in parts with the files, so it cannot overflow the verdict call either.
      const answerInParts = answer !== undefined && answer.length > maxChars / 4;
      const read: { path: string; content: string; heading?: string }[] = answerInParts ? [...files, { path: "", content: answer, heading: "The agent's final answer" }] : files;
      const sections = judgeSections(read, maxChars);
      const notes: string[] = [];
      for (const [i, section] of sections.entries()) {
        const n = await ask<{ notes?: string }>(
          [
            `You are reading part ${i + 1} of ${sections.length} of the files an agent produced${answerInParts ? " and of its final answer" : ""}, to grade them against the rubric below in a later step. Write notes for that step: for each criterion, the evidence in this part for or against it (quote the values, entries or lines that matter, and say where they are). Say "nothing in this part" for a criterion this part does not bear on. Do not score.`,
            "",
            "## Rubric",
            rubric,
            section,
          ].join("\n"),
          NOTES_SCHEMA,
        );
        notes.push(`### Notes on part ${i + 1} of ${sections.length}\n${n.notes ?? "(none)"}`);
      }
      return verdict(
        [
          head,
          `The ${answerInParts ? "files and the agent's final answer" : "files"} were too long to show at once (${read.map((f) => `${f.heading ?? f.path}: ${f.content.length} characters`).join("; ")}); they were read in ${sections.length} parts, and the notes below are what each reading found. Judge from the notes as you would from the material.`,
          "",
          "## Rubric",
          rubric,
          "",
          "## Notes on the files",
          ...notes,
          ...(answerInParts ? [] : answerBlock(answer)),
        ].join("\n"),
      );
    },
  };
}
