/**
 * Project tool runtimes (PB-817).
 *
 * Extensions declare the external tools they need (`tools` in
 * protoboard-extension.json). A tool may also name the managed runtime that
 * provides it: a Python virtual environment or a set of Node packages, with
 * exact versions. `protoboard tools install <runtime>` creates that runtime
 * inside the project (`.protoboard/tools/<runtime>/`) and records it in
 * `.protoboard/tools/tools.json`. Probes, checks and operations then find it
 * without any environment setup. A variable the user sets (PROTOBOARD_PYTHON)
 * still wins over the project runtime.
 *
 * The runtimes and their record are local to the machine (interpreter paths,
 * platform wheels) and are not committed. What makes them reproducible is the
 * pins, which come from the extensions' manifests at their locked versions.
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, relative } from "node:path";
import { BROWSER_PURPOSE, findBrowser, noBrowserMessage, type BrowserLookup } from "./browser.js";
import type { LoadedExtension, ToolDecl } from "./extensions.js";
import { npmAuthProblem } from "./stack.js";
import { describeTried, formatPythonRange, intersectPythonRanges, noPythonMessage, parsePythonRange, selectPython, type PythonLookup, type PythonRange, type PythonSelection } from "./python.js";

/** Where runtimes live, relative to the project root. */
export const TOOLS_DIR = ".protoboard/tools";
export const TOOLS_SCHEMA = "protoboard.tools/v0";
export const RUNTIME_KINDS = ["python", "node"] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

/** A managed runtime that provides a tool (`ToolDecl.runtime`). */
export interface ToolRuntimeDecl {
  /**
   * What `protoboard tools install <id>` installs, e.g. `cad` or `circuit`.
   * Tools of several extensions may share one runtime; their pins are merged.
   */
  id: string;
  kind: RuntimeKind;
  /**
   * Exact pins. python: pip specifiers (`build123d==0.13.0`); node: npm
   * names with a version (`@tscircuit/core@0.0.2056`). Ranges are refused.
   */
  packages: string[];
  /**
   * Variable the runtime sets for probes, checks and operations when the user
   * has not set it: for python the venv's interpreter, for node the runtime's
   * `node_modules` folder. The runtime's bin folder also goes first on PATH.
   */
  env?: string;
  /**
   * python: the Python versions the pins have wheels for, as `>=3.11,<3.15`.
   * `protoboard tools install` creates the venv only with a Python in this
   * range (python.ts chooses one that works). Several tools' ranges are
   * intersected.
   */
  python?: string;
}

const PY_PIN = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(\[[A-Za-z0-9._,-]+\])?==([0-9][0-9A-Za-z.+!-]*)$/;
const NODE_PIN = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/** Name and exact version of a pin, or undefined if it is not an exact pin. Python names are normalised (PEP 503). */
export function parsePin(kind: RuntimeKind, spec: string): { name: string; version: string } | undefined {
  if (kind === "python") {
    const m = PY_PIN.exec(spec);
    return m ? { name: m[1].toLowerCase().replace(/[-_.]+/g, "-"), version: m[3] } : undefined;
  }
  const m = NODE_PIN.exec(spec);
  return m ? { name: m[1], version: m[2] } : undefined;
}

/** Problems with a tool's `runtime` declaration (empty when valid or absent). */
export function validateRuntime(t: ToolDecl): string[] {
  const r = t.runtime as unknown;
  if (r === undefined) return [];
  if (!r || typeof r !== "object") return [`tool ${t.id}: runtime must be an object`];
  const d = r as Partial<ToolRuntimeDecl>;
  const problems: string[] = [];
  if (typeof d.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(d.id) || d.id === "all") problems.push(`tool ${t.id}: runtime id must be a lower-case name such as "cad" (not "all")`);
  if (!(RUNTIME_KINDS as readonly string[]).includes(d.kind as string)) problems.push(`tool ${t.id}: runtime kind must be one of ${RUNTIME_KINDS.join(", ")}`);
  if (!Array.isArray(d.packages)) problems.push(`tool ${t.id}: runtime packages must be an array of exact pins`);
  else if ((RUNTIME_KINDS as readonly string[]).includes(d.kind as string)) {
    for (const p of d.packages) {
      if (typeof p !== "string" || !parsePin(d.kind as RuntimeKind, p)) problems.push(`tool ${t.id}: "${String(p)}" is not an exact ${d.kind} pin (${d.kind === "python" ? "name==1.2.3" : "name@1.2.3"})`);
    }
  }
  if (d.env !== undefined && (typeof d.env !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(d.env) || d.env === "PATH")) problems.push(`tool ${t.id}: runtime env must be a variable name such as PROTOBOARD_PYTHON (not PATH)`);
  if (d.python !== undefined && (d.kind !== "python" || typeof d.python !== "string" || !parsePythonRange(d.python))) problems.push(`tool ${t.id}: runtime python must be a version range such as ">=3.11,<3.15" (python runtimes only)`);
  return problems;
}

// ---------------------------------------------------------------------------
// Plans: what each runtime must contain, merged from every extension
// ---------------------------------------------------------------------------

export interface RuntimePlan {
  id: string;
  kind: RuntimeKind;
  /** Merged pins, sorted by package name. */
  packages: string[];
  /** Variables it sets. */
  env: string[];
  /** The tools it provides, as `<extension id>#<tool id>`. */
  provides: string[];
  /** python: the versions every declaration allows (absent: any). */
  python?: PythonRange;
  /** Declarations that disagree (a package pinned twice, two kinds); the runtime cannot be installed until they agree. */
  problems: string[];
}

export function planRuntimes(extensions: LoadedExtension[]): RuntimePlan[] {
  const plans = new Map<string, RuntimePlan & { pins: Map<string, { spec: string; version: string; by: string }>; ranges: PythonRange[] }>();
  for (const e of extensions) {
    for (const t of e.manifest.tools ?? []) {
      const r = t.runtime;
      if (!r) continue;
      const by = `${e.manifest.id}#${t.id}`;
      let plan = plans.get(r.id);
      if (!plan) {
        plan = { id: r.id, kind: r.kind, packages: [], env: [], provides: [], problems: [], pins: new Map(), ranges: [] };
        plans.set(r.id, plan);
      }
      plan.provides.push(by);
      if (r.kind !== plan.kind) {
        plan.problems.push(`${by} declares runtime ${r.id} as ${r.kind}; ${plan.provides[0]} declares it as ${plan.kind}`);
        continue;
      }
      if (r.env && !plan.env.includes(r.env)) plan.env.push(r.env);
      const range = r.python ? parsePythonRange(r.python) : undefined;
      if (range) plan.ranges.push(range);
      for (const spec of r.packages) {
        const pin = parsePin(r.kind, spec);
        if (!pin) continue;
        const prev = plan.pins.get(pin.name);
        if (!prev) plan.pins.set(pin.name, { spec, version: pin.version, by });
        else if (prev.version !== pin.version) plan.problems.push(`${pin.name}: ${prev.by} pins ${prev.version}, ${by} pins ${pin.version}`);
      }
    }
  }
  return [...plans.values()]
    .map(({ pins, ranges, ...plan }) => ({ ...plan, packages: [...pins.keys()].sort().map((k) => pins.get(k)!.spec), env: plan.env.sort(), ...(ranges.length ? { python: intersectPythonRanges(ranges) } : {}) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Record: what is installed in this checkout
// ---------------------------------------------------------------------------

export interface RuntimeRecord {
  kind: RuntimeKind;
  /** Project-relative folder of the runtime. */
  dir: string;
  /** The pins installed (the plan at install time). */
  packages: string[];
  /** Packages present after the install, name → version (python: every package; node: the pinned ones). */
  installed: Record<string, string>;
  /** python: the venv interpreter (project-relative) and its version; node: the Node.js and npm used. */
  interpreter: { path: string; version: string; npm?: string };
  /** Variables it sets: name → project-relative path. */
  env: Record<string, string>;
  /** Project-relative folder put first on PATH. */
  bin: string;
  provides: string[];
  installedAt: string;
}

export interface ToolsRecord {
  schema: typeof TOOLS_SCHEMA;
  runtimes: Record<string, RuntimeRecord>;
}

const recordFile = (root: string) => join(root, TOOLS_DIR, "tools.json");

export function readToolsRecord(root: string): ToolsRecord {
  try {
    const r = JSON.parse(readFileSync(recordFile(root), "utf8")) as ToolsRecord;
    if (r.schema === TOOLS_SCHEMA && r.runtimes && typeof r.runtimes === "object") return r;
  } catch {
    // absent or unreadable: nothing installed
  }
  return { schema: TOOLS_SCHEMA, runtimes: {} };
}

function writeToolsRecord(root: string, record: ToolsRecord) {
  const file = recordFile(root);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
}

const WIN = process.platform === "win32";
const venvPython = (dir: string) => (WIN ? join(dir, "Scripts", "python.exe") : join(dir, "bin", "python"));
const venvBin = (dir: string) => (WIN ? join(dir, "Scripts") : join(dir, "bin"));

/** Whether a recorded runtime is still on disk. */
function present(root: string, r: RuntimeRecord): boolean {
  return existsSync(join(root, r.kind === "python" ? r.interpreter.path : join(r.dir, "node_modules")));
}

export interface RuntimeStatus extends RuntimePlan {
  installed: boolean;
  /** Installed with other pins than the extensions now declare: re-run `protoboard tools install`. */
  stale: boolean;
  record?: RuntimeRecord;
}

export function runtimeStatus(root: string, extensions: LoadedExtension[]): RuntimeStatus[] {
  const record = readToolsRecord(root);
  return planRuntimes(extensions).map((plan) => {
    const r = record.runtimes[plan.id];
    const installed = !!r && r.kind === plan.kind && present(root, r);
    return { ...plan, installed, stale: installed && r.packages.join("\n") !== plan.packages.join("\n"), ...(r ? { record: r } : {}) };
  });
}

// ---------------------------------------------------------------------------
// Environment: how probes, checks and operations see the runtimes
// ---------------------------------------------------------------------------

export interface ToolEnvironment {
  /** Variables to set on top of the base environment (PATH and the runtimes' own). */
  overrides: Record<string, string>;
  /** Each runtime variable and where its value comes from. */
  vars: Record<string, { value: string; from: "environment" | "runtime"; runtime: string }>;
  /** Installed runtimes whose bin folders go first on PATH. */
  runtimes: string[];
}

/**
 * The environment the project's installed runtimes provide. A runtime
 * variable already set in `base` (to a non-empty value) is kept: the user's
 * choice wins. Runtimes whose folders are gone are ignored.
 */
export function toolEnvironment(root: string, base: NodeJS.ProcessEnv = process.env): ToolEnvironment {
  const record = readToolsRecord(root);
  const overrides: Record<string, string> = {};
  const vars: ToolEnvironment["vars"] = {};
  const bins: string[] = [];
  const runtimes: string[] = [];
  for (const [id, r] of Object.entries(record.runtimes).sort(([a], [b]) => a.localeCompare(b))) {
    if (!present(root, r)) continue;
    runtimes.push(id);
    bins.push(join(root, r.bin));
    for (const [name, rel] of Object.entries(r.env ?? {})) {
      if (vars[name]) continue;
      if (base[name]) vars[name] = { value: base[name]!, from: "environment", runtime: id };
      else {
        vars[name] = { value: join(root, rel), from: "runtime", runtime: id };
        overrides[name] = vars[name].value;
      }
    }
  }
  if (bins.length) overrides.PATH = [...bins, ...(base.PATH ? [base.PATH] : [])].join(delimiter);
  return { overrides, vars, runtimes };
}

/**
 * Runs `fn` with the project's runtimes visible to the process (and to every
 * tool it spawns), then restores the environment. Operations and capability
 * checks run inside it.
 */
export async function withToolEnvironment<T>(root: string, fn: () => Promise<T> | T): Promise<T> {
  const { overrides } = toolEnvironment(root);
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export interface ProbeResult {
  available: boolean;
  detail?: string;
  /** The first probe of a runtime's tool in this project (a cold import), and how long it took. */
  firstRun?: boolean;
  ms?: number;
}

/** How long a probe may take, and how long the first one of a runtime's tool may (PB-943). */
export const PROBE_TIMEOUT_MS = 20000;
export const FIRST_PROBE_TIMEOUT_MS = 180000;
/** Which probes have passed in this checkout (local to the machine, not committed). */
const PROBED_FILE = ".protoboard/local/probed.json";

export interface ProbeOptions {
  /**
   * The project: a probe that passed here before gets the normal time
   * limit; the first probe of a runtime's tool gets the long one. The first
   * import of a CAD runtime (build123d and its OpenCascade libraries) reads
   * hundreds of megabytes from a cold disk and compiles its modules, and on
   * macOS the system checks every new library: it can take a minute, where a
   * later one takes a second or two.
   */
  root?: string;
  /** Told before a first probe starts (the probe blocks until it ends). */
  log?: (line: string) => void;
  timeoutMs?: number;
  firstTimeoutMs?: number;
  exec?: (command: string, args: string[], options: { timeout: number; env: NodeJS.ProcessEnv }) => string;
  /** How a browser is looked for by the `protoboard:browser` probe (tests give a fake file system). */
  browser?: BrowserLookup;
}

/** What identifies a probe: its command, and the interpreter or packages its runtime variable names. */
function probeKey(t: ToolDecl, env: NodeJS.ProcessEnv): string {
  return createHash("sha1").update(JSON.stringify([t.probe, t.runtime?.env ? (env[t.runtime.env] ?? "") : ""])).digest("hex").slice(0, 16);
}

function readProbed(root: string): Record<string, string> {
  try {
    const r = JSON.parse(readFileSync(join(root, PROBED_FILE), "utf8")) as Record<string, string>;
    return r && typeof r === "object" ? r : {};
  } catch {
    return {};
  }
}

/**
 * Runs a tool's probe command: available when it exits 0. The first probe
 * of a tool that comes from a runtime is given `FIRST_PROBE_TIMEOUT_MS`;
 * once it has passed in this project, later ones get `PROBE_TIMEOUT_MS`.
 */
export function probeTool(t: ToolDecl, env: NodeJS.ProcessEnv = process.env, options: ProbeOptions = {}): ProbeResult {
  const key = probeKey(t, env);
  const first = !!t.runtime && !(options.root && readProbed(options.root)[key]);
  const timeout = first ? (options.firstTimeoutMs ?? FIRST_PROBE_TIMEOUT_MS) : (options.timeoutMs ?? PROBE_TIMEOUT_MS);
  if (first) options.log?.(`${t.id}: first run of the ${t.runtime!.id} runtime here; loading it for the first time can take a minute (later runs take seconds)`);
  // built-in probes (`protoboard:<name>`): what a shell one-liner cannot do on every platform
  if (t.probe[0]?.startsWith("protoboard:")) return builtinProbe(t.probe[0].slice("protoboard:".length), env, options);
  const run = options.exec ?? ((command, args, o) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: o.timeout, env: o.env }));
  const t0 = Date.now();
  try {
    // PB-929: on VS Code's own runtime (a machine without Node.js) a probe that asks for `node` means the Node that
    // runs Protoboard, which is this process: the tools probed this way run inside it
    const own = t.probe[0] === "node" && !!process.versions.electron;
    const out = run(own ? process.execPath : t.probe[0], t.probe.slice(1), { timeout, env: own ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env });
    const ms = Date.now() - t0;
    if (first && options.root) {
      try {
        const file = join(options.root, PROBED_FILE);
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, JSON.stringify({ ...readProbed(options.root), [key]: new Date().toISOString() }, null, 2) + "\n");
      } catch {
        // a read-only checkout: the next probe is given the long limit again
      }
    }
    return { available: true, detail: out.trim().split("\n")[0]?.slice(0, 400), ...(first ? { firstRun: true } : {}), ms };
  } catch (err) {
    const e = err as { stderr?: string; message: string; code?: string; killed?: boolean; signal?: string };
    const ms = Date.now() - t0;
    if (e.code === "ETIMEDOUT" || (e.killed && ms >= timeout - 50)) {
      const s = Math.round(timeout / 1000);
      return {
        available: false,
        detail: first
          ? `no answer after ${s} s on its first run (loading a runtime for the first time is slow; run the command again, and if it still gives no answer the runtime is broken: protoboard tools install ${t.runtime!.id} --clean)`
          : `no answer after ${s} s`,
        ...(first ? { firstRun: true } : {}),
        ms,
      };
    }
    const msg = e.stderr?.toString().trim().split("\n").pop() || e.message;
    return { available: false, detail: msg.slice(0, 160), ...(first ? { firstRun: true } : {}), ms };
  }
}

/** The built-in probes a manifest may name instead of a command. */
export const BUILTIN_PROBES = ["browser"] as const;

/**
 * `protoboard:browser`: a Chromium-family browser (browser.ts finds it, the
 * same way the document renderer does). On Windows a browser found is not
 * run (`chrome.exe --version` opens a window there and prints nothing).
 */
function builtinProbe(name: string, env: NodeJS.ProcessEnv, options: ProbeOptions): ProbeResult {
  if (name !== "browser") return { available: false, detail: `unknown built-in probe protoboard:${name} (known: ${BUILTIN_PROBES.map((p) => `protoboard:${p}`).join(", ")})` };
  const look = { env, ...(options.browser ?? {}) };
  const found = findBrowser(look);
  if (!found) return { available: false, detail: noBrowserMessage(look.platform ?? process.platform) };
  if ((look.platform ?? process.platform) === "win32") {
    const there = (look.exists ?? existsSync)(found.path);
    return there ? { available: true, detail: `${found.name} at ${found.path}` } : { available: false, detail: `${found.from} names ${found.path}, which does not exist. ${BROWSER_PURPOSE}` };
  }
  const run = options.exec ?? ((command, args, o) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: o.timeout, env: o.env }));
  try {
    const out = run(found.path, ["--version"], { timeout: options.timeoutMs ?? PROBE_TIMEOUT_MS, env });
    return { available: true, detail: `${out.trim().split("\n")[0]?.slice(0, 80)} (${found.path})` };
  } catch (err) {
    const e = err as { code?: string; message: string };
    const why = e.code === "ENOENT" ? "which does not exist" : `which does not run (${e.message.split("\n")[0].slice(0, 100)})`;
    return { available: false, detail: `${found.from === "installed" || found.from === "PATH" ? "found" : `${found.from} names`} ${found.path}, ${why}. ${BROWSER_PURPOSE} Set CHROME to a browser's executable.` };
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/** Runs a command and resolves with its stdout (rejects with its stderr on a non-zero exit). */
export type Exec = (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<string>;

const defaultExec: Exec = (command, args, options) =>
  new Promise((ok, fail) => {
    execFile(command, args, { ...options, encoding: "utf8", maxBuffer: 64 << 20, timeout: 30 * 60 * 1000, shell: WIN && /\.cmd$/.test(command) }, (err, stdout, stderr) => {
      if (err) fail(new Error(`${[command, ...args].join(" ")} failed: ${(stderr || err.message).trim().split("\n").slice(-3).join(" ")}`));
      else ok(stdout);
    });
  });

export interface InstallOptions {
  /**
   * Interpreter that creates a python venv (`--python`). Default: the first
   * Python found that works (python.ts): its version is one the pins
   * support, and it can create a venv with pip.
   */
  python?: string;
  /** How Pythons are found and tested (tests give fake candidates). */
  selectPython?: (look: PythonLookup) => Promise<PythonSelection>;
  /** Delete an existing runtime folder first. */
  clean?: boolean;
  exec?: Exec;
  log?: (line: string) => void;
  now?: () => string;
}

export interface InstallResult {
  id: string;
  kind: RuntimeKind;
  status: "installed" | "failed";
  /** Project-relative folder. */
  dir: string;
  packages: string[];
  installed?: Record<string, string>;
  /** Each tool the runtime provides, probed with the new environment. */
  verified: { tool: string; available: boolean; detail?: string }[];
  message?: string;
  /**
   * Runtime variables the user has set (for example PROTOBOARD_PYTHON). The
   * install check probes the new runtime regardless, but doctor and
   * operations will keep using these values while they are set.
   */
  shadowed?: { name: string; value: string }[];
}

/**
 * The stack's extensions that declare each managed runtime, the one to suggest
 * first: what a project made by plain `protoboard init` (no such extension
 * yet) is told to add. A test keeps it in step with the extension manifests.
 */
export const RUNTIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  cad: ["ext-parts", "ext-enclosure-cad", "ext-frame-cad", "ext-harness-cad"],
};

/**
 * `protoboard tools install <id|all>`: create or update each runtime in the
 * project, record it, and probe the tools it provides. Runtimes are installed
 * one at a time; a failure is reported per runtime and does not stop the
 * others.
 */
export async function installRuntimes(root: string, extensions: LoadedExtension[], ids: string[], options: InstallOptions = {}): Promise<InstallResult[]> {
  const plans = planRuntimes(extensions);
  const wanted = ids.includes("all") ? plans : ids.map((id) => plans.find((p) => p.id === id) ?? id);
  const unknown = wanted.filter((w): w is string => typeof w === "string");
  if (unknown.length) {
    const hints = unknown.flatMap((id) => (RUNTIME_EXTENSIONS[id] ? [`The ${id} runtime comes with ${RUNTIME_EXTENSIONS[id].join(", ")}: \`protoboard extensions add ${RUNTIME_EXTENSIONS[id][0]}\` adds the first`] : []));
    throw new Error(
      `no extension in this project declares a ${unknown.join(", ")} runtime (declared: ${plans.map((p) => p.id).join(", ") || "none"}); runtimes come from the tools of the configured extensions and capability providers${hints.length ? `. ${hints.join("; ")}` : ""}`,
    );
  }
  const results: InstallResult[] = [];
  for (const plan of wanted as RuntimePlan[]) results.push(await installOne(root, extensions, plan, options));
  return results;
}

async function installOne(root: string, extensions: LoadedExtension[], plan: RuntimePlan, options: InstallOptions): Promise<InstallResult> {
  const exec = options.exec ?? defaultExec;
  const log = options.log ?? (() => {});
  const dirRel = `${TOOLS_DIR}/${plan.id}`;
  const dir = join(root, dirRel);
  const result: InstallResult = { id: plan.id, kind: plan.kind, status: "failed", dir: dirRel, packages: plan.packages, verified: [] };
  if (plan.problems.length) return { ...result, message: `conflicting declarations: ${plan.problems.join("; ")}` };
  let rec: RuntimeRecord;
  try {
    if (options.clean) rmSync(dir, { recursive: true, force: true });
    if (plan.kind === "python") rec = await installPython(root, dir, plan, exec, log, options);
    else rec = await installNode(root, dir, plan, exec, log);
    rec.installedAt = (options.now ?? (() => new Date().toISOString()))();
    const record = readToolsRecord(root);
    record.runtimes[plan.id] = rec;
    writeToolsRecord(root, record);
    result.installed = rec.installed;
  } catch (e) {
    // npm refused by a registry (an expired pass) is said as that, not as a failed install
    const auth = plan.kind === "node" ? npmAuthProblem((e as Error).message) : undefined;
    return { ...result, message: auth ? `npm install was refused by the registry. ${auth}` : (e as Error).message };
  }
  // the tools it provides, probed against this runtime: a variable the user
  // set would otherwise point the probe at their interpreter, not the new one
  const base: NodeJS.ProcessEnv = { ...process.env };
  const shadowed = Object.keys(rec.env ?? {})
    .filter((name) => process.env[name])
    .map((name) => ({ name, value: process.env[name]! }));
  for (const { name } of shadowed) delete base[name];
  const env = { ...base, ...toolEnvironment(root, base).overrides };
  if (shadowed.length) result.shadowed = shadowed;
  for (const e of extensions) {
    for (const t of e.manifest.tools ?? []) {
      if (t.runtime?.id !== plan.id) continue;
      // the first import after an install is the slow one: it gets the long limit here, and doctor is quick afterwards
      const { available, detail } = probeTool(t, env, { root, log: (line) => log(`${plan.id}: ${line}`) });
      result.verified.push({ tool: `${e.manifest.id}#${t.id}`, available, ...(detail !== undefined ? { detail } : {}) });
    }
  }
  const failed = result.verified.filter((v) => !v.available);
  return {
    ...result,
    status: failed.length ? "failed" : "installed",
    ...(failed.length ? { message: `installed, but ${failed.map((f) => `${f.tool} (${f.detail})`).join("; ")} still fails its probe` } : {}),
  };
}

async function installPython(root: string, dir: string, plan: RuntimePlan, exec: Exec, log: (line: string) => void, options: InstallOptions): Promise<RuntimeRecord> {
  const py = venvPython(dir);
  const pipInstall = async () => {
    if (!plan.packages.length) return;
    log(`${plan.id}: pip install ${plan.packages.join(" ")}`);
    await exec(py, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", ...plan.packages], { cwd: root });
  };
  // an existing venv is kept (its Python was chosen before); a new one is made with a Python that works
  if (existsSync(py)) await pipInstall();
  else await createVenv(root, dir, plan, exec, log, options, pipInstall);
  const listed = JSON.parse(await exec(py, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], { cwd: root })) as { name: string; version: string }[];
  const installed = Object.fromEntries(listed.map((p) => [p.name.toLowerCase().replace(/[-_.]+/g, "-"), p.version]).sort(([a], [b]) => a.localeCompare(b)));
  for (const spec of plan.packages) {
    const pin = parsePin("python", spec)!;
    if (installed[pin.name] !== pin.version) throw new Error(`${spec} was requested but the venv has ${pin.name} ${installed[pin.name] ?? "missing"}`);
  }
  const version = (await exec(py, ["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"], { cwd: root })).trim();
  const rel = (abs: string) => relative(root, abs).split("\\").join("/");
  return {
    kind: "python",
    dir: rel(dir),
    packages: plan.packages,
    installed,
    interpreter: { path: rel(py), version },
    env: Object.fromEntries(plan.env.map((name) => [name, rel(py)])),
    bin: rel(venvBin(dir)),
    provides: plan.provides,
    installedAt: "",
  };
}

/**
 * Create the venv with a Python that works and install the pins into it
 * (PB-943). The candidates are tested first (version, venv, ensurepip,
 * pyexpat, ssl, zlib). The venv is made with the first that passes; if
 * making it fails, or the pins do not install with it (no wheel for that
 * Python on this platform), the venv is removed and the next Python is
 * tried: after a failed install, one of another minor version. With none
 * left, the error says what was tried and what to run.
 */
async function createVenv(root: string, dir: string, plan: RuntimePlan, exec: Exec, log: (line: string) => void, options: InstallOptions, pipInstall: () => Promise<void>) {
  const range = plan.python ?? {};
  const command = `protoboard tools install ${plan.id}`;
  const select = options.selectPython ?? ((look: PythonLookup) => selectPython(look));
  const { working, tried } = await select({ ...(options.python ? { explicit: options.python } : {}), range });
  const refused = tried.filter((p) => !p.ok);
  if (refused.length) log(`${plan.id}: Pythons that cannot create this runtime:\n${describeTried(refused).join("\n")}`);
  if (!working.length) throw new Error(noPythonMessage(tried, range, process.platform, command));
  mkdirSync(join(dir, ".."), { recursive: true });
  const failures: string[] = [];
  /** Minor versions the pins did not install with: another Python of the same one would fail the same way. */
  const noWheels = new Set<string>();
  const minor = (v?: string) => v?.split(".").slice(0, 2).join(".") ?? "";
  const rest = (p: (typeof working)[number]) => working.slice(working.indexOf(p) + 1).some((q) => !noWheels.has(minor(q.version)));
  for (const p of working) {
    if (noWheels.has(minor(p.version))) continue;
    const shown = [p.command, ...p.args].join(" ");
    log(`${plan.id}: creating a Python venv with ${shown} (${p.from}, Python ${p.version}${plan.python ? `; the packages need ${formatPythonRange(range)}` : ""})`);
    let step = "creating the venv";
    try {
      await exec(p.command, [...p.args, "-m", "venv", dir], { cwd: root });
      step = "installing the packages";
      await pipInstall();
      return;
    } catch (e) {
      // a half-made runtime would be taken for a finished one by the next run
      rmSync(dir, { recursive: true, force: true });
      const why = (e as Error).message;
      if (step === "installing the packages") noWheels.add(minor(p.version));
      failures.push(`  ${shown} (${p.from}), Python ${p.version}: passed the checks, but ${step} failed: ${why}`);
      log(`${plan.id}: ${step} with ${shown} (Python ${p.version}) failed (${why})${rest(p) ? "; trying the next Python" : ""}`);
    }
  }
  throw new Error([noPythonMessage(tried.filter((p) => !p.ok), range, process.platform, command), "Also tried:", ...failures].join("\n"));
}

async function installNode(root: string, dir: string, plan: RuntimePlan, exec: Exec, log: (line: string) => void): Promise<RuntimeRecord> {
  mkdirSync(dir, { recursive: true });
  const pins = plan.packages.map((spec) => parsePin("node", spec)!);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: `protoboard-runtime-${plan.id}`,
        private: true,
        description: `Managed by \`protoboard tools install ${plan.id}\`; pins come from the project's extensions. Do not edit.`,
        dependencies: Object.fromEntries(pins.map((p) => [p.name, p.version])),
      },
      null,
      2,
    ) + "\n",
  );
  const npm = WIN ? "npm.cmd" : "npm";
  log(`${plan.id}: npm install ${plan.packages.join(" ")}`);
  await exec(npm, ["install", "--no-audit", "--no-fund", "--save-exact"], { cwd: dir });
  const installed: Record<string, string> = {};
  for (const p of pins) {
    const file = join(dir, "node_modules", p.name, "package.json");
    const version = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version : undefined;
    if (version !== p.version) throw new Error(`${p.name}@${p.version} was requested but the runtime has ${version ?? "nothing"}`);
    installed[p.name] = version;
  }
  const npmVersion = (await exec(npm, ["--version"], { cwd: dir })).trim();
  const rel = (abs: string) => relative(root, abs).split("\\").join("/");
  return {
    kind: "node",
    dir: rel(dir),
    packages: plan.packages,
    installed,
    interpreter: { path: "node", version: process.versions.node, npm: npmVersion },
    env: Object.fromEntries(plan.env.map((name) => [name, rel(join(dir, "node_modules"))])),
    bin: rel(join(dir, "node_modules", ".bin")),
    provides: plan.provides,
    installedAt: "",
  };
}

/**
 * Where an installed runtime is, for a provider that loads packages from it
 * (a node runtime's `node_modules`, a python venv's interpreter), or
 * undefined when it is not installed in this checkout.
 */
export function projectRuntime(root: string, id: string): { kind: RuntimeKind; dir: string; bin: string; python?: string; nodeModules?: string } | undefined {
  const r = readToolsRecord(root).runtimes[id];
  if (!r || !present(root, r)) return undefined;
  return {
    kind: r.kind,
    dir: join(root, r.dir),
    bin: join(root, r.bin),
    ...(r.kind === "python" ? { python: join(root, r.interpreter.path) } : { nodeModules: join(root, r.dir, "node_modules") }),
  };
}
