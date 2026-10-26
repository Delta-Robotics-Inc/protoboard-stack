/**
 * Eval cases (docs/specs/release-package-and-evals.md §5): what an extension
 * ships in `evals/<case>/` to measure how well an agent follows its skills.
 *
 *   evals/<case>/case.json    or case.ts (default export, `defineEvalCase`)
 *   evals/<case>/…            fixture files, inputs, the known-good solution's files
 *
 * A case is a fixture project state (a folder to copy, a recipe that builds
 * one, and seeding steps), an instruction for the agent, the tools it may
 * use, a turn and time budget, graders, and the known-good command sequence
 * the scripted host replays. Discovery is by convention: every installed
 * package with a `protoboard-extension.json` and an `evals/` folder.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { importTs } from "../load.js";
import type { GraderSpec } from "./graders.js";
import type { Step, StepContext } from "./steps.js";

export const EVAL_CASE_SCHEMA = "protoboard.eval-case/v0";

/** What the agent may use, named without reference to any one agent host. */
export interface EvalTools {
  /** Read and search files (default true). */
  read?: boolean;
  /** Create and edit files inside the project (default true). */
  edit?: boolean;
  /** Shell commands it may run, as patterns with `*` wildcards ("npx protoboard *"). */
  commands?: string[];
}

export interface EvalBudget {
  /** Agent turns (model round trips) before the host stops it. */
  turns: number;
  /** Wall-clock seconds before the runner stops the host. */
  seconds: number;
  /** Spending ceiling, where the host can enforce one. */
  usd?: number;
}

/** A function that builds (part of) the fixture in `dir`, after `from` is copied. */
export type FixtureRecipe = (dir: string, ctx: StepContext) => Promise<void> | void;

export interface FixtureSpec {
  /** A project folder to copy, relative to the case folder. */
  from?: string;
  /** Paths (relative to `from`) not to copy; node_modules, .claude/skills and .protoboard caches are never copied, operations/ only with `operations`. */
  exclude?: string[];
  /**
   * Copy the project's operation records (`operations/`) with it. Off by default: a fixture starts with no history,
   * so a case that needs the records of its generated outputs (a release, a stale check) says so here.
   */
  operations?: boolean;
  /** case.ts: a function; case.json: "./recipe.ts#build" relative to the case folder. */
  recipe?: FixtureRecipe | string;
  /** Seeding steps applied last (the fault, the moved part). */
  steps?: Step[];
}

export interface EvalCase {
  schema?: typeof EVAL_CASE_SCHEMA;
  /** Default: the case folder's name. */
  id?: string;
  title: string;
  /** Which skills or capability the case exercises, for reading a scorecard. */
  skills?: string[];
  tags?: string[];
  fixture: FixtureSpec;
  /** What the agent is asked to do, as a user would ask it. */
  instruction: string;
  tools?: EvalTools;
  budget: EvalBudget;
  /** Tool ids declared by installed extensions (python-build123d, chrome); the case is skipped when one is missing. */
  requires?: string[];
  graders: GraderSpec[];
  /** The known-good command sequence the scripted host replays. */
  solution: Step[];
}

/** case.ts helper (types only). */
export function defineEvalCase(c: EvalCase): EvalCase {
  return c;
}

export interface LoadedCase extends EvalCase {
  id: string;
  /** `<extension>/<case>`, e.g. `@protoboardai/ext-parts/author-tactile-switch`. */
  key: string;
  extension: string;
  extensionRoot: string;
  dir: string;
  file: string;
  tools: Required<EvalTools>;
}

export interface EvalSuite {
  extension: string;
  root: string;
  cases: LoadedCase[];
  /** Case folders that did not load, with the reason. */
  problems: { dir: string; message: string }[];
}

/** Every installed package (from `from` upwards) with a protoboard-extension.json and an evals/ folder. */
export function discoverEvalSuites(from: string, extra: string[] = []): { extension: string; root: string }[] {
  const found = new Map<string, { extension: string; root: string }>();
  const consider = (root: string) => {
    const manifest = join(root, "protoboard-extension.json");
    if (!existsSync(manifest) || !existsSync(join(root, "evals"))) return;
    const real = realpathSync(root);
    if (found.has(real)) return;
    try {
      const id = JSON.parse(readFileSync(manifest, "utf8")).id as string;
      if (typeof id === "string") found.set(real, { extension: id, root: real });
    } catch {
      // an unreadable manifest is doctor's to report
    }
  };
  for (const e of extra) consider(e);
  let dir = from;
  for (;;) {
    const nm = join(dir, "node_modules");
    if (existsSync(nm)) {
      for (const name of readdirSync(nm)) {
        if (name.startsWith(".")) continue;
        if (name.startsWith("@")) {
          const scope = join(nm, name);
          if (!statSync(scope).isDirectory()) continue;
          for (const pkg of readdirSync(scope)) consider(join(scope, pkg));
        } else consider(join(nm, name));
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return [...found.values()].sort((a, b) => a.extension.localeCompare(b.extension));
}

/** `@protoboardai/ext-parts`, `ext-parts` and `parts` all name the same extension. */
export function matchesExtension(id: string, filter: string): boolean {
  const short = id.replace(/^@[^/]+\//, "");
  return filter === id || filter === short || filter === short.replace(/^ext-/, "");
}

/** `*` wildcards; anything else literal. */
export const wildcard = (pattern: string) => new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);

export async function loadSuite(ext: { extension: string; root: string }): Promise<EvalSuite> {
  const evalsDir = join(ext.root, "evals");
  const suite: EvalSuite = { extension: ext.extension, root: ext.root, cases: [], problems: [] };
  for (const name of readdirSync(evalsDir).sort()) {
    const dir = join(evalsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const file = ["case.ts", "case.json"].map((f) => join(dir, f)).find(existsSync);
    if (!file) continue;
    try {
      const raw = file.endsWith(".json") ? (JSON.parse(readFileSync(file, "utf8")) as EvalCase) : (await importTs<{ default?: EvalCase }>(file)).default;
      if (!raw) throw new Error(`${relative(ext.root, file)} has no default export`);
      const problems = validateCase(raw);
      if (problems.length) throw new Error(problems.join("; "));
      const id = raw.id ?? name;
      suite.cases.push({
        ...raw,
        id,
        key: `${ext.extension}/${id}`,
        extension: ext.extension,
        extensionRoot: ext.root,
        dir,
        file,
        tools: { read: raw.tools?.read ?? true, edit: raw.tools?.edit ?? true, commands: raw.tools?.commands ?? ["npx protoboard *"] },
      });
    } catch (e) {
      suite.problems.push({ dir: relative(ext.root, dir), message: (e as Error).message });
    }
  }
  return suite;
}

const GRADER_KINDS = ["check", "operation", "files", "outputs", "format", "digest", "facts", "fault", "text", "rubric", "script"];

/** Structural problems with a case (empty when it is usable). */
export function validateCase(c: EvalCase): string[] {
  const problems: string[] = [];
  if (c.schema !== undefined && c.schema !== EVAL_CASE_SCHEMA) problems.push(`schema is ${c.schema}, expected ${EVAL_CASE_SCHEMA}`);
  if (!c.title) problems.push("needs a title");
  if (!c.instruction?.trim()) problems.push("needs an instruction");
  if (!c.fixture || (c.fixture.from === undefined && c.fixture.recipe === undefined)) problems.push("fixture needs `from` (a folder) or `recipe`");
  if (!c.budget || !(c.budget.turns > 0) || !(c.budget.seconds > 0)) problems.push("budget needs turns and seconds");
  if (!Array.isArray(c.graders) || !c.graders.length) problems.push("needs at least one grader");
  for (const [i, g] of (c.graders ?? []).entries()) {
    if (!GRADER_KINDS.includes(g?.kind)) problems.push(`grader ${i + 1}: unknown kind ${String(g?.kind)} (known: ${GRADER_KINDS.join(", ")})`);
    else if (g.kind === "script" && (typeof g.script !== "string" || !g.script || g.script.split(/[\\/]/).includes("..") || g.script.startsWith("/"))) problems.push(`grader ${i + 1}: script needs a path inside its package (no .. or leading /)`);
  }
  if (c.fixture?.operations !== undefined && typeof c.fixture.operations !== "boolean") problems.push("fixture.operations is true or false");
  if (!Array.isArray(c.solution)) problems.push("needs a solution (the steps the scripted host replays)");
  return problems;
}

/** Load the suites under `from`, filtered by extension and case (wildcards allowed). */
export async function loadSuites(from: string, filter: { extension?: string; case?: string; extra?: string[] } = {}): Promise<EvalSuite[]> {
  const suites: EvalSuite[] = [];
  for (const ext of discoverEvalSuites(from, filter.extra)) {
    if (filter.extension && !matchesExtension(ext.extension, filter.extension)) continue;
    const s = await loadSuite(ext);
    if (filter.case) {
      // several ids or patterns, comma-separated
      const res = filter.case.split(",").map((x) => x.trim()).filter(Boolean).map(wildcard);
      s.cases = s.cases.filter((c) => res.some((re) => re.test(c.id) || re.test(c.key)));
    }
    suites.push(s);
  }
  return suites;
}
