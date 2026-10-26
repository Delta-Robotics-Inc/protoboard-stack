/**
 * The eval runner: for each case, build its fixture once (copy, recipe,
 * seeding; a seeded fault is confirmed by `protoboard check` before any
 * trial), then for each trial copy the fixture into a scratch directory,
 * export the skills where the host finds them, let the host's agent work
 * there within the budget, and grade what it left. Scorecards (JSON and a
 * Markdown summary) go to `.protoboard/evals/<run>/`.
 *
 * The scratch copies live outside the user's checkout (the system temp
 * folder by default). Each one links `node_modules` to a mirror of the
 * workspace's (isolation.ts): the packages without their eval cases and
 * solutions, and without the example projects fixtures are copied from.
 * For a host that is not `trusted` (a real agent), the runner records the
 * workspace, the files the mirror took from sibling checkouts, the fixture
 * and the mirror before each trial and fails the trial if any of them
 * changed.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { FRAMEWORK_VERSION, type ToolDecl } from "../extensions.js";
import { importTs, packageRoot } from "../load.js";
import { probeTool } from "../tools.js";
import type { FixtureRecipe, LoadedCase } from "./case.js";
import { discoverEvalSuites, loadSuites, type EvalSuite } from "./case.js";
import { fixtureDigests, grade, matchDiagnostics, protoboardJson, type CheckOutput, type GraderResult, type Judge } from "./graders.js";
import type { AgentHost, HostRun } from "./hosts.js";
import { changedPaths, isInside, mirrorModules, snapshotTree, type ModuleMirror } from "./isolation.js";
import { runSteps, StepError, type StepContext, type StepResult } from "./steps.js";

export const SCORECARD_SCHEMA = "protoboard.eval-scorecard/v0";

export interface RunEvalsOptions {
  /** Where to discover suites (installed packages from here upwards). */
  from: string;
  extension?: string;
  case?: string;
  /** Extension folders to include even when not installed (tests). */
  extra?: string[];
  trials?: number;
  host: AgentHost;
  judge?: Judge;
  /** argv prefix that runs the protoboard CLI where the module mirror has none (default: node + @protoboardai/cli's bin, resolved from `from`). */
  cli?: string[];
  /** Scratch folder for fixtures and trials (default: <tmp>/protoboard-evals/<run>). */
  workDir?: string;
  /** Folder that receives `<run>/scorecard.json` (default: <from>/.protoboard/evals). */
  outDir?: string;
  /** Keep the fixture and trial directories. */
  keep?: boolean;
  /**
   * Fail a trial that changed anything outside its copy (the workspace, the
   * checkouts its packages come from, the fixture, the module mirror).
   * Default: on for hosts that are not `trusted`.
   */
  guard?: boolean;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** Run id (default: a timestamp). */
  runId?: string;
  /** Fixtures and trials run at once, across cases (default 1). With the guard on, a change outside any copy fails every trial running then. */
  jobs?: number;
  /** false: the ablation arm, without the stack's skills (none exported, their documents left out of the module mirror). Default true. */
  skills?: boolean;
}

export interface TrialResult {
  trial: number;
  host: Omit<HostRun, "answer" | "steps"> & { answer: string };
  graders: GraderResult[];
  score: number;
  passed: boolean;
  /** Transcript, relative to the run folder. */
  transcript: string;
  /** Kept trial directory (with --keep). */
  dir?: string;
  /** With the guard on: what changed outside the trial's copy (any entry fails the trial). */
  outside?: string[];
}

export interface CaseResult {
  key: string;
  id: string;
  extension: string;
  title: string;
  skills?: string[];
  status: "ran" | "skipped" | "error";
  reason?: string;
  budget: LoadedCase["budget"];
  fixture?: { ms: number; steps: StepResult[]; seeded?: string[] };
  trials: TrialResult[];
  passRate?: number;
  meanScore?: number;
  meanDurationMs?: number;
  meanTurns?: number;
  costUsd?: number;
}

export interface Scorecard {
  schema: typeof SCORECARD_SCHEMA;
  runId: string;
  startedAt: string;
  finishedAt: string;
  host: { id: string; version?: string };
  judge?: string;
  /** "exported" (default), or "none" for the ablation arm. */
  skills?: "exported" | "none";
  jobs?: number;
  trialsPerCase: number;
  framework: string;
  environment: { node: string; platform: string };
  cases: CaseResult[];
  problems: { extension: string; dir: string; message: string }[];
  totals: { cases: number; ran: number; skipped: number; errors: number; trials: number; passed: number; passRate: number; meanScore: number; costUsd?: number };
}

const safeName = (c: LoadedCase) => `${c.extension.replace(/^@[^/]+\//, "")}--${c.id}`.replace(/[^\w.-]+/g, "_");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** Never copied into a fixture: installs, operation records (unless `fixture.operations`), exported skills, caches and runtimes. */
const SKIP = [/(^|\/)node_modules$/, /(^|\/)\.git$/, /^operations$/, /^\.claude\/skills$/, /^\.protoboard\/(build|cache|tools|evals|local)$/];

/** The node_modules a case's packages resolve from: the nearest one above the case folder that has @protoboardai/core. */
function workspaceModules(from: string): string | undefined {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, "node_modules", "@protoboardai", "core"))) return join(dir, "node_modules");
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** Every tool declared by the installed extensions that ship evals (not only the filtered ones: a case may need another's tool), by id. */
function toolIndex(suites: { root: string }[]): Map<string, ToolDecl> {
  const m = new Map<string, ToolDecl>();
  for (const s of suites) {
    try {
      const manifest = JSON.parse(readFileSync(join(s.root, "protoboard-extension.json"), "utf8")) as { tools?: ToolDecl[] };
      for (const t of manifest.tools ?? []) if (!m.has(t.id)) m.set(t.id, t);
    } catch {
      // reported by doctor
    }
  }
  return m;
}

/** Build the case's fixture in `dir`: copy, link node_modules to the mirror, recipe, seeding steps. */
async function buildFixture(c: LoadedCase, dir: string, modules: string, ctx: StepContext): Promise<StepResult[]> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const f = c.fixture;
  if (f.from !== undefined) {
    const src = resolve(c.dir, f.from);
    if (!existsSync(src)) throw new Error(`fixture folder ${f.from} does not exist`);
    const exclude = (f.exclude ?? []).map((x) => x.replace(/\/$/, ""));
    cpSync(src, dir, {
      recursive: true,
      filter: (p) => {
        const rel = relative(src, p).split("\\").join("/");
        if (rel === "") return true;
        if (f.operations && (rel === "operations" || rel.startsWith("operations/"))) return !exclude.some((x) => rel === x || rel.startsWith(`${x}/`));
        return !SKIP.some((re) => re.test(rel)) && !exclude.some((x) => rel === x || rel.startsWith(`${x}/`));
      },
    });
    // a tsconfig that extends the workspace's base by a relative path: make it absolute
    const ts = join(dir, "tsconfig.json");
    if (existsSync(ts)) {
      const text = readFileSync(ts, "utf8");
      const m = /"extends"\s*:\s*"(\.[^"]+)"/.exec(text);
      if (m && existsSync(resolve(src, m[1]))) writeFileSync(ts, text.replace(m[0], `"extends": ${JSON.stringify(resolve(src, m[1]))}`));
    }
  }
  if (!existsSync(join(dir, "node_modules"))) symlinkSync(modules, join(dir, "node_modules"), "dir");
  if (f.recipe !== undefined) {
    let recipe: FixtureRecipe;
    if (typeof f.recipe === "function") recipe = f.recipe;
    else {
      const [file, name = "default"] = f.recipe.split("#");
      const fn = (await importTs<Record<string, unknown>>(resolve(c.dir, file)))[name];
      if (typeof fn !== "function") throw new Error(`fixture recipe ${f.recipe} is not a function export`);
      recipe = fn as FixtureRecipe;
    }
    await recipe(dir, ctx);
  }
  return f.steps?.length ? (await runSteps(f.steps, ctx)).results : [];
}

const checkOf = (cli: string[], dir: string, env: NodeJS.ProcessEnv) => async (): Promise<CheckOutput> => {
  const r = await protoboardJson<CheckOutput & { error?: string }>(cli, dir, ["check", "--severity", "info"], env);
  if (!r.json?.diagnostics) throw new Error(`protoboard check printed no result: ${r.json?.error ?? r.stderr.trim().split("\n").pop()}`);
  return r.json;
};

/** At most `n` tasks at a time, in the order they ask. */
export function semaphore(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (running >= n) await new Promise<void>((go) => waiting.push(go));
    else running++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}

const once = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
};

export async function runEvals(o: RunEvalsOptions): Promise<{ scorecard: Scorecard; file: string; summary: string }> {
  const log = o.log ?? (() => {});
  const started = new Date();
  const runId = o.runId ?? started.toISOString().replace(/[:.]/g, "-");
  const env = { ...process.env, ...o.env };
  const cliBin = o.cli ?? (() => {
    const pkg = packageRoot(o.from, "@protoboardai/cli");
    if (!pkg) throw new Error(`@protoboardai/cli is not installed where evals run (${o.from})`);
    return [process.execPath, join(pkg, "bin", "protoboard.mjs")];
  })();
  const work = o.workDir ?? join(tmpdir(), "protoboard-evals", runId);
  // a --work-dir that already exists is the user's: only the fixtures/ and trials/ the runner makes in it are removed
  const ownWork = !existsSync(work);
  const outRoot = o.outDir ?? join(o.from, ".protoboard", "evals");
  const runDir = join(outRoot, runId);
  mkdirSync(runDir, { recursive: true });
  const trials = Math.max(1, o.trials ?? 1);

  const probe = await o.host.probe();
  if (!probe.available) throw new Error(`host ${o.host.id} is not available: ${probe.detail ?? "unknown reason"}`);
  const suites = await loadSuites(o.from, { extension: o.extension, case: o.case, extra: o.extra });
  const tools = toolIndex([...suites, ...discoverEvalSuites(o.from, o.extra)]);
  const cases: CaseResult[] = [];
  const guard = o.guard ?? !o.host.trusted;
  const skills = o.skills !== false;

  // one module mirror per workspace the cases come from, built on first use (once, however many cases ask at a time)
  const mirrors = new Map<string, Promise<ModuleMirror & { root: string; workspace: string }>>();
  const mirrorFor = (c: LoadedCase) => {
    const ws = workspaceModules(c.dir);
    if (!ws) return Promise.reject(new Error(`no node_modules with @protoboardai/core above ${c.dir}`));
    let m = mirrors.get(ws);
    if (!m) {
      const root = join(work, "modules", String(mirrors.size + 1));
      m = Promise.resolve().then(() => {
        rmSync(root, { recursive: true, force: true });
        const t0 = Date.now();
        const built = { ...mirrorModules(ws, root, { withoutSkills: !skills }), root, workspace: dirname(realpathSync(ws)) };
        log(`  modules mirrored: ${built.files} files in ${Date.now() - t0} ms${built.omitted.length ? `; left out ${built.omitted.map((p) => relative(built.workspace, p)).join(", ")}` : ""}${skills ? "" : "; without the skills' documents"}`);
        return built;
      });
      mirrors.set(ws, m);
    }
    return m;
  };
  /** The CLI for a project directory: the mirror's own, so the project, its extensions and the CLI share one @protoboardai/core. */
  const cliIn = (m: ModuleMirror) => {
    const bin = join(m.modules, "@protoboardai", "cli", "bin", "protoboard.mjs");
    return existsSync(bin) ? [process.execPath, bin] : cliBin;
  };

  // --jobs: fixtures and trials of several cases at once, at most `jobs` at a time; the scorecard keeps the cases' order
  const jobs = Math.max(1, Math.floor(o.jobs ?? 1));
  const slots = semaphore(jobs);

  const runCase = async (c: LoadedCase, result: CaseResult) => {
    const name = safeName(c);
    const clog = jobs > 1 ? (line: string) => log(`[${c.id}] ${line.trimStart()}`) : log;
    clog(`${c.key}: ${c.title}`);

    const missing = (c.requires ?? []).flatMap((id) => {
      const t = tools.get(id);
      if (!t) return [`${id} (no installed extension declares it)`];
      const r = probeTool(t, env);
      return r.available ? [] : [`${id} (${r.detail ?? "unavailable"}${t.install ? `; ${t.install}` : ""})`];
    });
    if (missing.length) {
      Object.assign(result, { status: "skipped", reason: `missing tool(s): ${missing.join(", ")}` });
      clog(`  skipped: ${result.reason}`);
      return;
    }

    const fixtureDir = join(work, "fixtures", name, "project");
    let mirror: Awaited<ReturnType<typeof mirrorFor>> | undefined;
    let cli = cliBin;
    const steps = (dir: string): StepContext => ({ dir, caseDir: c.dir, cli, env, log: clog, timeoutMs: c.budget.seconds * 1000 });
    const built = await slots(async () => {
      try {
        mirror = await mirrorFor(c);
        cli = cliIn(mirror);
        const t0 = Date.now();
        clog("  fixture");
        const fsteps = await buildFixture(c, fixtureDir, mirror.modules, steps(fixtureDir));
        result.fixture = { ms: Date.now() - t0, steps: fsteps };
        const faults = c.graders.flatMap((g) => (g.kind === "fault" ? [g] : []));
        if (faults.length) {
          const check = await checkOf(cli, fixtureDir, env)();
          // a fault narrowed by subject or message must show as that diagnostic; other seeded codes by code
          const absent = faults.flatMap((g) =>
            (g.seeded ?? [g.code]).filter((code) => !matchDiagnostics(check.diagnostics, code === g.code ? { code, subject: g.subject, message: g.message } : { code }).length).map((code) => (code === g.code && (g.subject ?? g.message) !== undefined ? `${code} (${[g.subject && `on /${g.subject}/`, g.message && `saying /${g.message}/`].filter(Boolean).join(" ")})` : code)),
          );
          if (absent.length) throw new Error(`the seeded fault does not show: protoboard check on the fixture reports no ${[...new Set(absent)].join(", ")}`);
          result.fixture.seeded = [...new Set(faults.flatMap((g) => g.seeded ?? [g.code]))];
        }
        return true;
      } catch (e) {
        Object.assign(result, { status: "error", reason: `fixture: ${(e as Error).message}`.slice(0, 600) });
        if (e instanceof StepError) result.fixture = { ms: 0, steps: e.results };
        clog(`  error: ${result.reason}`);
        if (!o.keep) rmSync(dirname(fixtureDir), { recursive: true, force: true });
        return false;
      }
    });
    if (!built) return;

    const before = fixtureDigests(c.graders, fixtureDir);
    const runTrial = async (n: number): Promise<TrialResult> => {
      const dir = join(work, "trials", name, String(n), "project");
      rmSync(dirname(dir), { recursive: true, force: true });
      mkdirSync(dirname(dir), { recursive: true });
      cpSync(fixtureDir, dir, { recursive: true, verbatimSymlinks: true });
      const transcript = join(runDir, name, `trial-${n}.jsonl`);
      mkdirSync(dirname(transcript), { recursive: true });
      clog(`  trial ${n}/${trials} (${o.host.id}${skills ? "" : ", without skills"})`);
      let run: HostRun;
      if (o.host.skillHost && skills) {
        const r = await protoboardJson(cli, dir, ["skills", "export", "--host", o.host.skillHost], env);
        if (r.exit !== 0) clog(`  skills export failed: ${r.stderr.trim().split("\n").pop()}`);
      }
      // the backstop: everything a trial must not touch, recorded before the agent starts
      const m = mirror!;
      const watched = guard ? [m.workspace, ...m.carried.filter((p) => !isInside(m.workspace, p)), fixtureDir] : [];
      const watch = () => {
        const exclude = [work, outRoot, runDir].map((p) => resolve(p));
        const tree = snapshotTree(watched, { exclude });
        for (const [k, v] of snapshotTree([m.modules], { skipNames: (n) => n === "__pycache__" || n === ".cache", exclude })) tree.set(k, v);
        return tree;
      };
      const watchedBefore = guard ? watch() : undefined;
      try {
        run = await o.host.run({ caseKey: c.key, dir, modules: m.modules, instruction: c.instruction, tools: c.tools, budget: c.budget, solution: c.solution, steps: steps(dir), transcript, log: clog, skills });
      } catch (e) {
        run = { status: "error", answer: "", detail: (e as Error).message, durationMs: 0 };
      }
      const outside = watchedBefore ? changedPaths(watchedBefore, watch()) : undefined;
      const ctx = { dir, cli, env, answer: run.answer, before, judge: o.judge, check: once(checkOf(cli, dir, env)), extension: c.extension };
      const graders: GraderResult[] = [];
      for (const [i, g] of c.graders.entries()) graders.push(await grade(g, i, ctx));
      const graded = graders.filter((g) => g.status !== "skipped");
      const weight = graded.reduce((a, g) => a + g.weight, 0);
      const score = weight ? graded.reduce((a, g) => a + g.weight * g.score, 0) / weight : 0;
      const passed = graded.length > 0 && graded.every((g) => g.status === "pass") && !outside?.length;
      const { steps: _steps, ...host } = run;
      if (host.costUsd !== undefined) host.costUsd = round(host.costUsd, 4);
      clog(`    trial ${n}: ${passed ? "PASS" : "FAIL"} ${round(score, 2)}  host ${run.status}${run.detail ? ` (${run.detail.slice(0, 160)})` : ""}${outside?.length ? `\n    changed outside the trial: ${outside.slice(0, 5).join(", ")}${outside.length > 5 ? ` and ${outside.length - 5} more` : ""}` : ""}${graders.filter((g) => g.status !== "pass").map((g) => `\n    ${g.status} ${g.id}: ${g.detail.slice(0, 200)}`).join("")}`);
      if (!o.keep) rmSync(dirname(dir), { recursive: true, force: true });
      return { trial: n, host, graders, score: round(score), passed, transcript: relative(runDir, transcript), ...(outside ? { outside } : {}), ...(o.keep ? { dir } : {}) };
    };
    result.trials = await Promise.all(Array.from({ length: trials }, (_, i) => slots(() => runTrial(i + 1))));
    if (!o.keep) rmSync(dirname(fixtureDir), { recursive: true, force: true });
    const t = result.trials;
    Object.assign(result, {
      passRate: round(t.filter((x) => x.passed).length / t.length),
      meanScore: round(mean(t.map((x) => x.score))),
      meanDurationMs: Math.round(mean(t.map((x) => x.host.durationMs))),
      ...(t.some((x) => x.host.turns !== undefined) ? { meanTurns: round(mean(t.map((x) => x.host.turns ?? 0)), 1) } : {}),
      ...(t.some((x) => x.host.costUsd !== undefined) ? { costUsd: round(t.reduce((a, x) => a + (x.host.costUsd ?? 0), 0), 4) } : {}),
    });
  };

  const all = suites.flatMap((s) => s.cases);
  for (const c of all) cases.push({ key: c.key, id: c.id, extension: c.extension, title: c.title, ...(c.skills ? { skills: c.skills } : {}), status: "ran", budget: c.budget, trials: [] });
  await Promise.all(all.map((c, i) => runCase(c, cases[i])));
  if (!o.keep) {
    for (const d of ["fixtures", "trials", "modules"]) rmSync(join(work, d), { recursive: true, force: true });
    if (ownWork) rmSync(work, { recursive: true, force: true });
  }

  const ran = cases.filter((c) => c.status === "ran");
  const allTrials = ran.flatMap((c) => c.trials);
  const cost = cases.reduce((a, c) => a + (c.costUsd ?? 0), 0);
  const scorecard: Scorecard = {
    schema: SCORECARD_SCHEMA,
    runId,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    host: { id: o.host.id, ...(probe.version ? { version: probe.version } : {}) },
    ...(o.judge ? { judge: o.judge.id } : {}),
    skills: skills ? "exported" : "none",
    ...(jobs > 1 ? { jobs } : {}),
    trialsPerCase: trials,
    framework: FRAMEWORK_VERSION,
    environment: { node: process.version, platform: process.platform },
    cases,
    problems: suites.flatMap((s) => s.problems.map((p) => ({ extension: s.extension, ...p }))),
    totals: {
      cases: cases.length,
      ran: ran.length,
      skipped: cases.filter((c) => c.status === "skipped").length,
      errors: cases.filter((c) => c.status === "error").length,
      trials: allTrials.length,
      passed: allTrials.filter((t) => t.passed).length,
      passRate: round(allTrials.length ? allTrials.filter((t) => t.passed).length / allTrials.length : 0),
      meanScore: round(mean(allTrials.map((t) => t.score))),
      ...(cost ? { costUsd: round(cost, 4) } : {}),
    },
  };
  const file = join(runDir, "scorecard.json");
  const summary = scorecardMarkdown(scorecard);
  writeFileSync(file, JSON.stringify(scorecard, null, 2) + "\n");
  writeFileSync(join(runDir, "summary.md"), summary);
  writeFileSync(join(outRoot, "latest.json"), JSON.stringify(scorecard, null, 2) + "\n");
  writeFileSync(join(outRoot, "latest.md"), summary);
  return { scorecard, file, summary };
}

const pct = (x: number | undefined) => (x === undefined ? "—" : `${Math.round(x * 100)}%`);
const secs = (ms: number | undefined) => (ms === undefined ? "—" : `${Math.round(ms / 100) / 10} s`);

/** The Markdown summary written next to scorecard.json. */
export function scorecardMarkdown(s: Scorecard): string {
  const t = s.totals;
  const lines = [
    `# Eval run ${s.runId}`,
    "",
    `Host **${s.host.id}**${s.host.version ? ` (${s.host.version})` : ""}, ${s.trialsPerCase} trial(s) per case${s.judge ? `, rubric judge ${s.judge}` : ", rubric graders off"}${s.skills === "none" ? ", **without the stack's skills** (ablation)" : ""}${s.jobs ? `, ${s.jobs} jobs` : ""}. Protoboard ${s.framework}, Node ${s.environment.node}.`,
    "",
    `**${t.passed}/${t.trials} trials passed (${pct(t.passRate)}), mean score ${t.meanScore.toFixed(2)}.** ${t.ran} case(s) ran, ${t.skipped} skipped, ${t.errors} error(s)${t.costUsd !== undefined ? `; cost $${t.costUsd.toFixed(2)}` : ""}.`,
    "",
    "| Case | Status | Pass | Score | Time | Turns | Cost |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...s.cases.map((c) => `| \`${c.key}\` | ${c.status} | ${c.status === "ran" ? pct(c.passRate) : "—"} | ${c.meanScore?.toFixed(2) ?? "—"} | ${secs(c.meanDurationMs)} | ${c.meanTurns ?? "—"} | ${c.costUsd !== undefined ? `$${c.costUsd.toFixed(2)}` : "—"} |`),
    "",
  ];
  for (const c of s.cases) {
    if (c.status !== "ran") {
      lines.push(`- \`${c.key}\` ${c.status}: ${c.reason}`);
      continue;
    }
    const failed = c.trials.flatMap((tr) => [
      ...(tr.outside?.length ? [`trial ${tr.trial} changed files outside its copy: ${tr.outside.slice(0, 5).join(", ")}${tr.outside.length > 5 ? ` and ${tr.outside.length - 5} more` : ""}`] : []),
      ...tr.graders.filter((g) => g.status === "fail" || g.status === "error").map((g) => `trial ${tr.trial} ${g.id}: ${g.detail}`),
    ]);
    const hostNotes = c.trials.filter((tr) => tr.host.status !== "completed").map((tr) => `trial ${tr.trial} host ${tr.host.status}${tr.host.detail ? `: ${tr.host.detail}` : ""}`);
    // whole lines: a rubric's reasons are what a reader needs (the JSON has every detail too)
    if (failed.length || hostNotes.length) lines.push(`- \`${c.key}\`:`, ...[...hostNotes, ...failed].map((f) => `  - ${f.replace(/\n+/g, " ")}`));
  }
  if (s.problems.length) lines.push("", "Cases that did not load:", ...s.problems.map((p) => `- ${p.extension} ${p.dir}: ${p.message}`));
  return lines.join("\n") + "\n";
}
