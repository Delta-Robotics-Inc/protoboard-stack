/**
 * Graders: deterministic first (check and operation results, files present
 * and well-formed by core's standard-output validators, digests, facts
 * against reference values, a seeded fault caught and fixed), then rubric
 * graders, which an LLM judge scores against a written rubric. Rubric
 * graders are skipped unless a judge is given (never in CI).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { sha256 } from "../load.js";
import { checkDxf, checkExcellon, checkGerber, checkGlb, checkManifest, checkStep, checkStl, checkThreeMf } from "../outputs.js";
import type { ProjectDiagnostic } from "../types.js";
import { isInside } from "./isolation.js";
import { inside, runCommand } from "./steps.js";

/** A reference value at a path in a JSON document. */
export interface Fact {
  /** `a.b.0.c`, `offers[supplier=Distributor A].stock`, `interfaces[id=vtx_mount].geometry.frame.origin`. */
  path: string;
  equals?: unknown;
  /** Numeric: |value - approx| ≤ tolerance (default 1e-6), element-wise for arrays. */
  approx?: number | number[];
  tolerance?: number;
  min?: number;
  max?: number;
  /** String: regular expression. */
  matches?: string;
  /** Array: contains an element equal to this; string: contains this text. */
  includes?: unknown;
  length?: number;
  /** false: the path must not resolve. */
  exists?: boolean;
}

export type FileFormat = "step" | "glb" | "stl" | "3mf" | "dxf" | "gerber" | "excellon" | "manifest" | "json" | "pdf";

export type GraderSpec = (
  | {
      /** `protoboard check`: error and warning ceilings, codes that must be absent or present, validators that must have run, diagnostics matched by subject or message. */
      kind: "check";
      maxErrors?: number;
      maxWarnings?: number;
      absent?: string[];
      present?: string[];
      ran?: string[];
      /** Diagnostics picked by code, severity, subject and message: each must be reported (`present`, the default) or not. */
      diagnostics?: DiagnosticMatch[];
    }
  | { kind: "operation"; /** `protoboard run …` arguments. */ run: string[]; status?: string; /** facts about the record's `data`. */ data?: Fact[] }
  | { kind: "files"; exist?: string[]; absent?: string[] }
  | { kind: "outputs"; /** Module id (definition) whose standard outputs must be present and valid. */ module: string }
  | { kind: "format"; file: string; format: FileFormat }
  | {
      kind: "digest";
      file: string;
      /** true: differs from the fixture; false: identical to it. */
      changed?: boolean;
      /** A sha256 the file must have. */
      equals?: string;
      /** Another project file it must be identical to (a reference an `operation` grader wrote just before). */
      sameAs?: string;
    }
  | {
      kind: "facts";
      /** A JSON file in the project … */
      file?: string;
      /** … or the JSON a protoboard command prints … */
      protoboard?: string[];
      /** … or a definition the project declares, as the loaded ModuleDef. */
      definition?: string;
      facts: Fact[];
    }
  | {
      /**
       * A fault seeded into the fixture: `seeded` codes must show in the fixture's check (verified before any trial);
       * afterwards `code` must be gone (fixed) and/or the answer name it (caught). `subject` and `message` narrow
       * `code` to one diagnostic (two faults with one code); `seeded: []` is a hidden seed that check does not show.
       */
      kind: "fault";
      code: string;
      subject?: string;
      message?: string;
      seeded?: string[];
      fixed?: boolean;
      caught?: string;
    }
  | { kind: "text"; /** A project file, or the agent's final answer when absent. */ file?: string; matches?: string[]; notMatches?: string[] }
  | {
      /**
       * An extension's script, run in the project after the agent (`node --import tsx node_modules/<extension>/<script> …args`):
       * its exit code, its output's text, and facts on its output when it prints JSON.
       */
      kind: "script";
      /** The package that ships the script (default: the case's own extension). */
      extension?: string;
      /** Path inside the package: `skills/system-compose/scripts/scenarios.ts`. */
      script: string;
      args?: string[];
      /** Exit code it must end with (default: any). */
      exit?: number;
      matches?: string[];
      notMatches?: string[];
      /** Facts on its standard output, parsed as JSON. */
      facts?: Fact[];
      /** Seconds before it is stopped (default 300). */
      seconds?: number;
    }
  | { kind: "rubric"; rubric: string; /** Files the judge reads (project-relative). */ files?: string[]; /** Include the agent's answer (default true). */ answer?: boolean; /** Pass mark, 0..1 (default 0.7). */ threshold?: number }
) & { id?: string; description?: string; weight?: number };

/** One diagnostic, picked by what it says: code and severity exactly, subject and message by regular expression (case-insensitive). */
export interface DiagnosticMatch {
  code?: string;
  severity?: "error" | "warning" | "info";
  /** Matched against the entity: `video_power` and `link:video_power` both match a link's diagnostic. */
  subject?: string;
  message?: string;
  /** true (default): at least one such diagnostic; false: none. */
  present?: boolean;
}

/** Diagnostics a match picks. */
export function matchDiagnostics(diagnostics: ProjectDiagnostic[], m: Omit<DiagnosticMatch, "present">): ProjectDiagnostic[] {
  const subject = m.subject !== undefined ? new RegExp(m.subject, "i") : undefined;
  const message = m.message !== undefined ? new RegExp(m.message, "i") : undefined;
  return diagnostics.filter(
    (d) =>
      (m.code === undefined || d.code === m.code) &&
      (m.severity === undefined || d.severity === m.severity) &&
      (!subject || subject.test(d.entity?.id ?? "") || subject.test(`${d.entity?.kind}:${d.entity?.id}`)) &&
      (!message || message.test(d.message)),
  );
}

const describeMatch = (m: DiagnosticMatch) => [m.severity, m.code, m.subject !== undefined ? `on /${m.subject}/` : undefined, m.message !== undefined ? `saying /${m.message}/` : undefined].filter(Boolean).join(" ") || "any diagnostic";

export interface GraderResult {
  id: string;
  kind: GraderSpec["kind"];
  status: "pass" | "fail" | "skipped" | "error";
  /** 0..1; partial credit only from rubric graders. */
  score: number;
  weight: number;
  detail: string;
}

export interface CheckOutput {
  checks: { validator: string; subject?: string; status: string; reason?: string }[];
  diagnostics: ProjectDiagnostic[];
}

/** Scores a rubric. Pluggable: the claude-code judge is one implementation. */
export interface Judge {
  id: string;
  /** The files are whole (up to RUBRIC_FILE_LIMIT each); a judge that cannot read them in one go reads them in parts. */
  grade(input: { rubric: string; files: { path: string; content: string }[]; answer?: string }): Promise<{ score: number; reasons: string }>;
}

/** A rubric grader reads each file whole up to this many characters (a file past it is cut, and the judge is told so). */
export const RUBRIC_FILE_LIMIT = 2_000_000;

export interface GraderContext {
  dir: string;
  cli: string[];
  env: NodeJS.ProcessEnv;
  /** The agent's final answer. */
  answer: string;
  /** Digests of fixture files before the trial (project-relative path → sha256). */
  before: Map<string, string | undefined>;
  judge?: Judge;
  /** `protoboard check` on the trial, run once and shared. */
  check: () => Promise<CheckOutput>;
  /** The case's extension (a script grader's default package). */
  extension?: string;
}

export const graderId = (g: GraderSpec, i: number) => g.id ?? `${i + 1}-${g.kind}`;

/** Run the CLI in the project and parse its JSON. */
export async function protoboardJson<T = unknown>(cli: string[], dir: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ exit: number | null; json: T | undefined; stderr: string }> {
  const r = await runCommand([...cli, ...args, ...(args.includes("--format") ? [] : ["--format", "json"])], { cwd: dir, env });
  let json: T | undefined;
  try {
    json = JSON.parse(r.stdout) as T;
  } catch {
    json = undefined;
  }
  return { exit: r.exit, json, stderr: r.stderr };
}

/** Script that loads the project in a child process and prints one definition (null when absent). */
const DEFINITION_SCRIPT =
  'import { loadProject } from "@protoboardai/core"; const p = await loadProject(process.cwd(), { checks: false, extensions: false }); const r = p.definitions.get(process.env.PROTOBOARD_EVAL_DEFINITION); process.stdout.write(JSON.stringify(r ? r.def : null));';

/** A definition as the project loads it, from a fresh process (the trial's sources change between loads). */
export async function definitionJson(dir: string, id: string, env: NodeJS.ProcessEnv): Promise<{ def?: unknown; error?: string }> {
  const r = await runCommand([process.execPath, "--import", "tsx", "--input-type=module", "-e", DEFINITION_SCRIPT], { cwd: dir, env: { ...env, PROTOBOARD_EVAL_DEFINITION: id } });
  if (r.exit !== 0) return { error: `loading the project failed: ${r.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300)}` };
  try {
    return { def: JSON.parse(r.stdout) };
  } catch {
    return { error: "loading the project printed no definition" };
  }
}

// ---------------------------------------------------------------------------
// Paths into JSON
// ---------------------------------------------------------------------------

/** Resolve `a.b[key=value].c.0` (or `[key~=regex]`, case-insensitive); undefined when any segment is missing. */
export function readPath(value: unknown, path: string): unknown {
  const segments = path.match(/[^.[\]]+|\[[^\]]*\]/g) ?? [];
  let cur: unknown = value;
  for (const raw of segments) {
    if (cur === undefined || cur === null) return undefined;
    if (raw.startsWith("[")) {
      const inner = raw.slice(1, -1);
      const eq = inner.indexOf("=");
      if (eq < 0) {
        cur = (cur as unknown[])[Number(inner)];
        continue;
      }
      if (!Array.isArray(cur)) return undefined;
      // [key~=pattern]: the first element whose key matches the regular expression (case-insensitive)
      const re = inner[eq - 1] === "~" ? new RegExp(inner.slice(eq + 1), "i") : undefined;
      const [k, v] = [inner.slice(0, re ? eq - 1 : eq), inner.slice(eq + 1)];
      cur = cur.find((x) => {
        if (!x || typeof x !== "object") return false;
        const got = readPath(x, k);
        return re ? got !== undefined && re.test(String(got)) : String(got) === v;
      });
    } else cur = (cur as Record<string, unknown>)[raw];
  }
  return cur;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const show = (v: unknown) => (v === undefined ? "(missing)" : JSON.stringify(v).slice(0, 120));

/** Problems with one fact (empty when it holds). */
export function checkFact(doc: unknown, f: Fact): string[] {
  const v = readPath(doc, f.path);
  const out: string[] = [];
  const bad = (what: string) => out.push(`${f.path} = ${show(v)}: ${what}`);
  if (f.exists === false) return v === undefined ? [] : [`${f.path} should not exist (is ${show(v)})`];
  if (v === undefined) return [`${f.path} is missing`];
  if ("equals" in f && !same(v, f.equals)) bad(`expected ${show(f.equals)}`);
  if (f.approx !== undefined) {
    const tol = f.tolerance ?? 1e-6;
    const want = Array.isArray(f.approx) ? f.approx : [f.approx];
    const got = Array.isArray(v) ? v : [v];
    if (got.length !== want.length || got.some((x, i) => typeof x !== "number" || Math.abs(x - want[i]) > tol)) bad(`expected ${show(f.approx)} ± ${tol}`);
  }
  if (f.min !== undefined && !(typeof v === "number" && v >= f.min)) bad(`expected ≥ ${f.min}`);
  if (f.max !== undefined && !(typeof v === "number" && v <= f.max)) bad(`expected ≤ ${f.max}`);
  if (f.matches !== undefined && !(typeof v === "string" && new RegExp(f.matches).test(v))) bad(`expected to match /${f.matches}/`);
  if (f.includes !== undefined && !(Array.isArray(v) ? v.some((x) => same(x, f.includes)) : typeof v === "string" && typeof f.includes === "string" && v.includes(f.includes))) bad(`expected to include ${show(f.includes)}`);
  if (f.length !== undefined && !((Array.isArray(v) || typeof v === "string") && v.length === f.length)) bad(`expected length ${f.length}`);
  return out;
}

// ---------------------------------------------------------------------------
// File formats (core's standard-output validators, plus JSON and PDF)
// ---------------------------------------------------------------------------

export function checkFormat(bytes: Buffer, format: FileFormat): string[] {
  const msgs = (ps: { message: string; severity?: string }[]) => ps.filter((p) => p.severity !== "warning").map((p) => p.message);
  switch (format) {
    case "step":
      return msgs(checkStep(bytes));
    case "glb":
      return msgs(checkGlb(bytes));
    case "stl":
      return msgs(checkStl(bytes));
    case "3mf":
      return msgs(checkThreeMf(bytes));
    case "dxf":
      return msgs(checkDxf(bytes));
    case "gerber":
      return msgs(checkGerber(bytes));
    case "excellon":
      return msgs(checkExcellon(bytes));
    case "manifest":
    case "json": {
      let value: unknown;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch (e) {
        return [`not JSON: ${(e as Error).message}`];
      }
      return format === "manifest" ? msgs(checkManifest(value)) : [];
    }
    case "pdf":
      return bytes.subarray(0, 5).toString("latin1") === "%PDF-" && bytes.subarray(-1024).toString("latin1").includes("%%EOF") ? [] : ["not a complete PDF (%PDF- header and %%EOF trailer)"];
  }
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

const errors = (c: CheckOutput) => c.diagnostics.filter((d) => d.severity === "error");
const codes = (c: CheckOutput) => new Set(c.diagnostics.map((d) => d.code));

export async function grade(g: GraderSpec, i: number, ctx: GraderContext): Promise<GraderResult> {
  const base = { id: graderId(g, i), kind: g.kind, weight: g.weight ?? 1 };
  const result = (problems: string[], ok: string): GraderResult => ({ ...base, status: problems.length ? "fail" : "pass", score: problems.length ? 0 : 1, detail: problems.length ? problems.join("; ") : ok });
  try {
    switch (g.kind) {
      case "check": {
        const c = await ctx.check();
        const errs = errors(c);
        const warns = c.diagnostics.filter((d) => d.severity === "warning");
        const have = codes(c);
        const problems: string[] = [];
        if (errs.length > (g.maxErrors ?? 0)) problems.push(`${errs.length} error(s): ${[...new Set(errs.map((d) => d.code))].join(", ")}`);
        if (g.maxWarnings !== undefined && warns.length > g.maxWarnings) problems.push(`${warns.length} warning(s), at most ${g.maxWarnings}: ${[...new Set(warns.map((d) => d.code))].join(", ")}`);
        for (const code of g.absent ?? []) if (have.has(code)) problems.push(`${code} still reported: ${c.diagnostics.find((d) => d.code === code)!.message.slice(0, 160)}`);
        for (const code of g.present ?? []) if (!have.has(code)) problems.push(`${code} not reported`);
        for (const v of g.ran ?? []) if (!c.checks.some((x) => x.validator === v && x.status === "ran")) problems.push(`validator ${v} did not run`);
        for (const m of g.diagnostics ?? []) {
          const hits = matchDiagnostics(c.diagnostics, m);
          if (m.present !== false && !hits.length) problems.push(`no ${describeMatch(m)} reported`);
          if (m.present === false && hits.length) problems.push(`${describeMatch(m)} still reported: ${hits[0].code} ${hits[0].entity?.id ?? ""}: ${hits[0].message.slice(0, 160)}`);
        }
        return result(problems, `${errs.length} error(s), ${warns.length} warning(s)${g.diagnostics?.length ? `; ${g.diagnostics.length} diagnostic match(es) hold` : ""}`);
      }
      case "operation": {
        const r = await protoboardJson<{ status?: string; summary?: string; data?: unknown; error?: string }>(ctx.cli, ctx.dir, ["run", ...g.run], ctx.env);
        if (!r.json) return result([`no JSON from protoboard run ${g.run.join(" ")}: ${r.stderr.trim().split("\n").pop()}`], "");
        const want = g.status ?? "succeeded";
        const problems = r.json.status === want ? [] : [`status ${r.json.status ?? r.json.error}, expected ${want}${r.json.summary ? `: ${r.json.summary}` : ""}`];
        for (const f of g.data ?? []) problems.push(...checkFact(r.json.data, f));
        return result(problems, `${r.json.status}: ${r.json.summary ?? ""}`);
      }
      case "files": {
        const problems = [...(g.exist ?? []).filter((f) => !existsSync(inside(ctx.dir, f))).map((f) => `${f} is missing`), ...(g.absent ?? []).filter((f) => existsSync(inside(ctx.dir, f))).map((f) => `${f} should not exist`)];
        return result(problems, `${(g.exist ?? []).length} present, ${(g.absent ?? []).length} absent`);
      }
      case "outputs": {
        const c = await ctx.check();
        const mine = c.diagnostics.filter((d) => d.validator === "protoboard/standard-outputs" && d.entity.id === g.module);
        const problems = mine.filter((d) => d.severity === "error" || d.code === "PB_OUTPUT_NOT_EXPORTED" || d.code === "PB_OUTPUT_STALE").map((d) => `${d.code} ${d.message}`);
        if (!c.checks.some((x) => x.validator === "protoboard/standard-outputs" && x.status === "ran")) problems.push("the standard-outputs check did not run");
        return result(problems, `${g.module}: standard outputs valid${mine.length ? ` (${mine.length} warning(s))` : ""}`);
      }
      case "format": {
        const file = inside(ctx.dir, g.file);
        if (!existsSync(file)) return result([`${g.file} is missing`], "");
        return result(checkFormat(readFileSync(file), g.format).map((m) => `${g.file}: ${m}`), `${g.file} is valid ${g.format}`);
      }
      case "digest": {
        const file = inside(ctx.dir, g.file);
        const now = existsSync(file) ? sha256(readFileSync(file)) : undefined;
        const was = ctx.before.get(g.file);
        const problems: string[] = [];
        if (now === undefined) problems.push(`${g.file} is missing`);
        else {
          if (g.changed === true && now === was) problems.push(`${g.file} is unchanged from the fixture`);
          if (g.changed === false && now !== was) problems.push(`${g.file} changed (it must stay as given)`);
          if (g.equals !== undefined && now !== g.equals) problems.push(`${g.file} is ${now.slice(0, 19)}…, expected ${g.equals.slice(0, 19)}…`);
          if (g.sameAs !== undefined) {
            const other = inside(ctx.dir, g.sameAs);
            if (!existsSync(other)) problems.push(`${g.sameAs} is missing`);
            else if (sha256(readFileSync(other)) !== now) problems.push(`${g.file} differs from ${g.sameAs}`);
          }
        }
        return result(problems, `${g.file} ${now?.slice(0, 19)}…`);
      }
      case "facts": {
        let doc: unknown;
        if (g.file !== undefined) {
          const file = inside(ctx.dir, g.file);
          if (!existsSync(file)) return result([`${g.file} is missing`], "");
          try {
            doc = JSON.parse(readFileSync(file, "utf8"));
          } catch (e) {
            return result([`${g.file} is not JSON: ${(e as Error).message}`], "");
          }
        } else if (g.protoboard) {
          const r = await protoboardJson(ctx.cli, ctx.dir, g.protoboard, ctx.env);
          if (r.json === undefined) return result([`no JSON from protoboard ${g.protoboard.join(" ")}: ${r.stderr.trim().split("\n").pop()}`], "");
          doc = r.json;
        } else if (g.definition !== undefined) {
          const r = await definitionJson(ctx.dir, g.definition, ctx.env);
          if (r.error) return result([r.error], "");
          if (r.def === null) return result([`the project declares no definition ${g.definition}`], "");
          doc = r.def;
        } else return { ...base, status: "error", score: 0, detail: "facts grader needs file, protoboard or definition" };
        return result(g.facts.flatMap((f) => checkFact(doc, f)), `${g.facts.length} fact(s) hold`);
      }
      case "fault": {
        const problems: string[] = [];
        if (g.fixed !== false) {
          const c = await ctx.check();
          const left = matchDiagnostics(c.diagnostics, { code: g.code, subject: g.subject, message: g.message });
          if (left.length) problems.push(`${g.code} still reported${left[0].entity?.id ? ` on ${left[0].entity.id}` : ""}: ${left[0].message.slice(0, 160)}`);
        }
        if (g.caught !== undefined && !new RegExp(g.caught, "i").test(ctx.answer)) problems.push(`the answer does not identify the fault (/${g.caught}/i)`);
        return result(problems, `${g.code}${g.fixed !== false ? " fixed" : ""}${g.caught !== undefined ? `${g.fixed !== false ? " and" : ""} caught` : ""}`);
      }
      case "text": {
        let text = ctx.answer;
        if (g.file !== undefined) {
          const file = inside(ctx.dir, g.file);
          if (!existsSync(file)) return result([`${g.file} is missing`], "");
          text = readFileSync(file, "utf8");
        }
        const problems = [...(g.matches ?? []).filter((m) => !new RegExp(m, "i").test(text)).map((m) => `no match for /${m}/i`), ...(g.notMatches ?? []).filter((m) => new RegExp(m, "i").test(text)).map((m) => `matches /${m}/i`)];
        return result(problems, `${g.file ?? "answer"}: text holds`);
      }
      case "rubric": {
        if (!ctx.judge) return { ...base, status: "skipped", score: 0, detail: "no judge (--judge); rubric graders are off by default" };
        const files = (g.files ?? []).flatMap((f) => {
          const abs = inside(ctx.dir, f);
          if (!existsSync(abs)) return [{ path: f, content: "(missing)" }];
          return (statSync(abs).isDirectory() ? filesUnder(abs) : [abs]).map((file) => ({ path: relative(ctx.dir, file), content: readForJudge(file) }));
        });
        const v = await ctx.judge.grade({ rubric: g.rubric, files, answer: g.answer === false ? undefined : ctx.answer });
        const pass = v.score >= (g.threshold ?? 0.7);
        // the judge's reasons whole: they are what a reader of the scorecard needs
        return { ...base, status: pass ? "pass" : "fail", score: Math.max(0, Math.min(1, v.score)), detail: `${ctx.judge.id}: ${v.score.toFixed(2)} — ${v.reasons}` };
      }
      case "script": {
        const pkg = g.extension ?? ctx.extension;
        if (!pkg) return { ...base, status: "error", score: 0, detail: "script grader needs `extension` (no case extension known)" };
        const root = inside(ctx.dir, join("node_modules", pkg));
        const file = resolve(root, g.script);
        if (!isInside(root, file)) return { ...base, status: "error", score: 0, detail: `${g.script} is outside ${pkg}` };
        if (!existsSync(file)) return result([`${pkg} has no ${g.script}`], "");
        const r = await runCommand([process.execPath, "--import", "tsx", file, ...(g.args ?? [])], { cwd: ctx.dir, env: ctx.env, timeoutMs: (g.seconds ?? 300) * 1000 });
        const problems: string[] = [];
        const tail = (r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 300);
        if (r.timedOut) problems.push(`stopped after ${g.seconds ?? 300} s`);
        if (g.exit !== undefined && r.exit !== g.exit) problems.push(`exit ${r.exit}, expected ${g.exit}${tail ? `: ${tail}` : ""}`);
        problems.push(...(g.matches ?? []).filter((m) => !new RegExp(m, "i").test(r.stdout)).map((m) => `output has no match for /${m}/i`));
        problems.push(...(g.notMatches ?? []).filter((m) => new RegExp(m, "i").test(r.stdout)).map((m) => `output matches /${m}/i`));
        if (g.facts?.length) {
          let doc: unknown;
          try {
            doc = JSON.parse(r.stdout);
          } catch {
            problems.push(`its output is not JSON${tail ? `: ${tail}` : ""}`);
          }
          if (doc !== undefined) problems.push(...g.facts.flatMap((f) => checkFact(doc, f)));
        }
        return result(problems, `${pkg}/${g.script} exit ${r.exit}${g.facts?.length ? `, ${g.facts.length} fact(s) hold` : ""}`);
      }
    }
  } catch (e) {
    return { ...base, status: "error", score: 0, detail: (e as Error).message.slice(0, 400) };
  }
}

/** Every file under a folder, depth first, in name order. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []));
}

/** A file as the judge reads it: text whole (up to RUBRIC_FILE_LIMIT), a binary file named, not dumped. */
function readForJudge(file: string): string {
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 8192).includes(0)) return `(binary file, ${bytes.length} bytes: not shown)`;
  const text = bytes.toString("utf8");
  return text.length > RUBRIC_FILE_LIMIT ? `${text.slice(0, RUBRIC_FILE_LIMIT)}\n… (cut: the file has ${text.length} characters, the first ${RUBRIC_FILE_LIMIT} are shown)` : text;
}

/** Files the digest graders compare, as fixture digests. */
export function fixtureDigests(graders: GraderSpec[], fixtureDir: string): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>();
  for (const g of graders) {
    if (g.kind !== "digest") continue;
    const abs = inside(fixtureDir, g.file);
    m.set(g.file, existsSync(abs) ? sha256(readFileSync(abs)) : undefined);
  }
  return m;
}
