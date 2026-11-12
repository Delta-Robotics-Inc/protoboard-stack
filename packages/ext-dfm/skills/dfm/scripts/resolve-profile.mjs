#!/usr/bin/env node
/**
 * Resolve a DFM profile: the shipped process profile, then the user, project
 * and part layers, then `--set` overrides from the session, last wins; then
 * every formula is evaluated over the merged values. Plain Node ESM with no
 * dependencies, so an agent can run it from any project that has
 * @protoboardai/ext-dfm installed.
 *
 *   node resolve-profile.mjs [--process fdm] [--project <dir>] [--part <dir>]
 *                            [--user <dir> | --no-user] [--set path=value ...]
 *                            [--format json|table] [--explain <path>]
 *                            [--profiles <dir>]
 *
 * Exit codes: 0 resolved; 1 resolved with errors (a formula cycle, an unknown
 * path, a value a formula cannot use); 2 usage or file errors (no such
 * profile, a file that is not valid JSON or not the right schema).
 *
 * The contract is documented in ../references/profile-format.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const PROFILE_SCHEMA = "protoboard.dfm.profile/v1";
export const LAYER_SCHEMA = "protoboard.dfm.layer/v1";
export const RESOLVED_SCHEMA = "protoboard.dfm.resolved/v1";

/** The status vocabulary (profile-format.md, "Status"). */
export const STATUSES = ["house", "typical", "derived", "assumption", "unverified", "proven", "failed", "user"];

/** The scopes of the cascade, in the order they apply (last wins). */
export const SCOPES = ["shipped", "user", "project", "part", "session"];

/** The process profile used when nothing chooses one: the low-cost-first ladder starts at desktop FDM. */
export const DEFAULT_PROCESS = "fdm";

/** A value path: dot-separated segments of letters, digits and underscores, starting with a letter. No hyphens (a hyphen is a minus in a formula). */
export const PATH_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

export class DfmProfileError extends Error {
  /** @param {string} message @param {string} [valuePath] */
  constructor(message, valuePath) {
    super(message);
    this.name = "DfmProfileError";
    this.path = valuePath;
  }
}

// ---------------------------------------------------------------------------
// Where the layers live

/**
 * The Protoboard config folder, resolved as packages/board-style/src/paths.ts
 * resolves it: PROTOBOARD_CONFIG_DIR, else %APPDATA%\protoboard on Windows,
 * else $XDG_CONFIG_HOME (or ~/.config) /protoboard. The path flavor follows
 * `platform`, so a posix answer can be computed on Windows and the reverse.
 */
export function configDir(env = process.env, platform = process.platform) {
  const p = platform === "win32" ? path.win32 : path.posix;
  if (env.PROTOBOARD_CONFIG_DIR) return env.PROTOBOARD_CONFIG_DIR;
  if (platform === "win32" && env.APPDATA) return p.join(env.APPDATA, "protoboard");
  return p.join(env.XDG_CONFIG_HOME || p.join(env.HOME || homedir(), ".config"), "protoboard");
}

/** The user layer's folder: `<config>/dfm`. */
export function userLayerDir(env = process.env, platform = process.platform) {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(configDir(env, platform), "dfm");
}

/** The user layer file inside a user folder: `<dir>/profile.json` (a path ending in .json is taken as the file itself). */
export const userLayerFile = (dir) => (dir.endsWith(".json") ? dir : path.join(dir, "profile.json"));
/** The project layer file: `<project>/dfm/profile.json` (a path ending in .json is taken as the file itself). */
export const projectLayerFile = (dir) => (dir.endsWith(".json") ? dir : path.join(dir, "dfm", "profile.json"));
/** The part layer file: `<part folder>/dfm.json` (a path ending in .json is taken as the file itself). */
export const partLayerFile = (dir) => (dir.endsWith(".json") ? dir : path.join(dir, "dfm.json"));

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The folder of shipped profiles: `--profiles` when given, else `../../../profiles`
 * relative to this script (the package layout), else
 * `node_modules/@protoboardai/ext-dfm/profiles` found from `cwd` upward (for a
 * copy of the skill exported to an agent host, where the relative path breaks).
 */
export function findProfilesDir(explicit, cwd = process.cwd()) {
  if (explicit) return path.resolve(cwd, explicit);
  const packaged = path.resolve(HERE, "../../../profiles");
  if (existsSync(packaged)) return packaged;
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, "node_modules", "@protoboardai", "ext-dfm", "profiles");
    if (existsSync(candidate)) return candidate;
    const up = path.dirname(dir);
    if (up === dir) return packaged;
    dir = up;
  }
}

/** The nearest folder at or above `start` holding protoboard.config.ts: the project root, or undefined. */
export function findProjectRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "protoboard.config.ts"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

// ---------------------------------------------------------------------------
// The formula language: numbers, paths, + - * / ( ), min(...), max(...), round(x, digits)

const FUNCTIONS = {
  min: { arity: [1, Infinity], fn: (...a) => Math.min(...a) },
  max: { arity: [1, Infinity], fn: (...a) => Math.max(...a) },
  round: {
    arity: [1, 2],
    fn: (x, digits = 0) => {
      if (!Number.isInteger(digits) || digits < 0 || digits > 12) throw new DfmProfileError(`round(): digits must be a whole number from 0 to 12, got ${digits}`);
      const f = 10 ** digits;
      return Math.round(x * f) / f;
    },
  },
};

/** Split a formula into tokens: { type: "num" | "path" | "op", value }. */
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new DfmProfileError(`unexpected "${c}" at ${i} in "${src}"`);
      tokens.push({ type: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/.exec(src.slice(i));
      tokens.push({ type: "path", value: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/(),".includes(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    throw new DfmProfileError(`unexpected "${c}" at ${i} in "${src}"`);
  }
  return tokens;
}

/**
 * Parse a formula into a tree. Grammar:
 *   expr   = term (("+" | "-") term)*
 *   term   = unary (("*" | "/") unary)*
 *   unary  = "-" unary | "+" unary | atom
 *   atom   = number | path | name "(" expr ("," expr)* ")" | "(" expr ")"
 */
export function parseFormula(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek()?.type === "op" && peek().value === v;
  const expect = (v) => {
    if (!isOp(v)) throw new DfmProfileError(`expected "${v}" in "${src}"`);
    pos++;
  };
  const expr = () => {
    let node = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].value;
      node = { type: "bin", op, left: node, right: term() };
    }
    return node;
  };
  const term = () => {
    let node = unary();
    while (isOp("*") || isOp("/")) {
      const op = tokens[pos++].value;
      node = { type: "bin", op, left: node, right: unary() };
    }
    return node;
  };
  const unary = () => {
    if (isOp("-")) {
      pos++;
      return { type: "neg", arg: unary() };
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return atom();
  };
  const atom = () => {
    const t = peek();
    if (!t) throw new DfmProfileError(`unexpected end of "${src}"`);
    if (t.type === "num") {
      pos++;
      return { type: "num", value: t.value };
    }
    if (t.type === "path") {
      pos++;
      if (isOp("(")) {
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new DfmProfileError(`unknown function "${t.value}" in "${src}" (min, max, round)`);
        pos++;
        const args = [expr()];
        while (isOp(",")) {
          pos++;
          args.push(expr());
        }
        expect(")");
        if (args.length < fn.arity[0] || args.length > fn.arity[1]) throw new DfmProfileError(`${t.value}() takes ${fn.arity[1] === Infinity ? `at least ${fn.arity[0]}` : `${fn.arity[0]} to ${fn.arity[1]}`} arguments in "${src}"`);
        return { type: "call", name: t.value, args };
      }
      return { type: "path", path: t.value };
    }
    if (t.type === "op" && t.value === "(") {
      pos++;
      const node = expr();
      expect(")");
      return node;
    }
    throw new DfmProfileError(`unexpected "${t.value}" in "${src}"`);
  };
  const tree = expr();
  if (pos < tokens.length) throw new DfmProfileError(`unexpected "${tokens[pos].value}" in "${src}"`);
  return tree;
}

/** The paths a formula tree reads, in order of first appearance. */
export function formulaPaths(tree) {
  const out = [];
  const walk = (n) => {
    if (n.type === "path") {
      if (!out.includes(n.path)) out.push(n.path);
    } else if (n.type === "bin") {
      walk(n.left);
      walk(n.right);
    } else if (n.type === "neg") walk(n.arg);
    else if (n.type === "call") n.args.forEach(walk);
  };
  walk(tree);
  return out;
}

/** Evaluate a formula tree; `lookup(path)` returns the number a path holds (or throws). */
export function evaluateTree(tree, lookup) {
  switch (tree.type) {
    case "num":
      return tree.value;
    case "path":
      return lookup(tree.path);
    case "neg":
      return -evaluateTree(tree.arg, lookup);
    case "bin": {
      const a = evaluateTree(tree.left, lookup);
      const b = evaluateTree(tree.right, lookup);
      if (tree.op === "+") return a + b;
      if (tree.op === "-") return a - b;
      if (tree.op === "*") return a * b;
      if (b === 0) throw new DfmProfileError("division by zero");
      return a / b;
    }
    case "call":
      return FUNCTIONS[tree.name].fn(...tree.args.map((x) => evaluateTree(x, lookup)));
    default:
      throw new DfmProfileError(`bad formula node ${tree.type}`);
  }
}

/** Parse and evaluate a formula against a plain map of path to number. */
export function evaluateFormula(src, values) {
  return evaluateTree(parseFormula(src), (p) => {
    if (!(p in values)) throw new DfmProfileError(`unknown path "${p}"`, p);
    const v = values[p];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new DfmProfileError(`"${p}" is not a number`, p);
    return v;
  });
}

/** Drop floating-point noise (0.45000000000000007 becomes 0.45). */
const clean = (x) => (Number.isFinite(x) ? Number(x.toPrecision(12)) : x);

// ---------------------------------------------------------------------------
// Entries, layers and the merge

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isBareValue = (v) => ["number", "string", "boolean"].includes(typeof v) || Array.isArray(v);

/**
 * One entry, normalized: { value?, formula?, unit, status, source, note }.
 * Shipped profile entries must carry status and source; layer entries default
 * to status `user` and source "layer file" (a bare value is exactly that).
 */
export function normalizeEntry(valuePath, raw, scope, previous) {
  if (!PATH_PATTERN.test(valuePath)) throw new DfmProfileError(`"${valuePath}" is not a valid path (letters, digits and underscores in dot-separated segments, starting with a letter; no hyphens)`, valuePath);
  const inheritedUnit = previous?.unit ?? null;
  if (scope !== "shipped" && isBareValue(raw)) return { value: raw, unit: inheritedUnit, status: "user", source: scope === "session" ? "session (--set)" : "layer file", note: null };
  if (!isPlainObject(raw)) throw new DfmProfileError(`"${valuePath}": an entry is an object with "value" or "formula"${scope === "shipped" ? "" : ", or a bare value"}`, valuePath);
  const hasValue = "value" in raw;
  const hasFormula = "formula" in raw;
  if (hasValue === hasFormula) throw new DfmProfileError(`"${valuePath}": give exactly one of "value" and "formula"`, valuePath);
  if (hasValue && !isBareValue(raw.value)) throw new DfmProfileError(`"${valuePath}": "value" is a number, string, boolean or array`, valuePath);
  if (hasFormula) {
    if (typeof raw.formula !== "string") throw new DfmProfileError(`"${valuePath}": "formula" is a string`, valuePath);
    parseFormula(raw.formula); // syntax errors surface here, naming the path below
  }
  const status = raw.status ?? (scope === "shipped" ? undefined : "user");
  if (!status) throw new DfmProfileError(`"${valuePath}": a shipped entry needs a "status"`, valuePath);
  if (!STATUSES.includes(status)) throw new DfmProfileError(`"${valuePath}": status "${status}" is not one of ${STATUSES.join(", ")}`, valuePath);
  const source = raw.source ?? (scope === "shipped" ? undefined : scope === "session" ? "session (--set)" : "layer file");
  if (!source) throw new DfmProfileError(`"${valuePath}": a shipped entry needs a "source"`, valuePath);
  const entry = { unit: raw.unit ?? inheritedUnit, status, source, note: raw.note ?? null };
  if (hasValue) entry.value = raw.value;
  else entry.formula = raw.formula;
  return entry;
}

function readJson(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new DfmProfileError(`cannot read ${file}: ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new DfmProfileError(`${file} is not valid JSON: ${e.message}`);
  }
}

/** Load the shipped profile for a process from a profiles folder. */
export function loadProfile(processId, profilesDir) {
  if (!/^[a-z][a-z0-9-]*$/.test(processId)) throw new DfmProfileError(`"${processId}" is not a process id`);
  const file = path.join(profilesDir, `${processId}.json`);
  if (!existsSync(file)) throw new DfmProfileError(`no shipped profile for process "${processId}" (looked for ${file})`);
  const profile = readJson(file);
  if (profile.schema !== PROFILE_SCHEMA) throw new DfmProfileError(`${file}: schema is ${JSON.stringify(profile.schema)}, not "${PROFILE_SCHEMA}"`);
  if (!isPlainObject(profile.values)) throw new DfmProfileError(`${file}: "values" is an object`);
  return { file, profile };
}

/** Load a layer file, or undefined when it does not exist. */
export function loadLayer(file) {
  if (!existsSync(file)) return undefined;
  const layer = readJson(file);
  if (layer.schema !== LAYER_SCHEMA) throw new DfmProfileError(`${file}: schema is ${JSON.stringify(layer.schema)}, not "${LAYER_SCHEMA}"`);
  if (layer.values !== undefined && !isPlainObject(layer.values)) throw new DfmProfileError(`${file}: "values" is an object`);
  if (layer.notes !== undefined && !Array.isArray(layer.notes)) throw new DfmProfileError(`${file}: "notes" is an array`);
  if (layer.waivers !== undefined && !(Array.isArray(layer.waivers) && layer.waivers.every(isPlainObject))) throw new DfmProfileError(`${file}: "waivers" is an array of objects`);
  return layer;
}

/** Parse one `--set path=value`: a number, true/false, a JSON array or object, else the text. */
export function parseSet(arg) {
  const i = arg.indexOf("=");
  if (i <= 0) throw new DfmProfileError(`--set takes path=value, got "${arg}"`);
  const valuePath = arg.slice(0, i).trim();
  const text = arg.slice(i + 1).trim();
  let value = text;
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) value = Number(text);
  else if (text === "true" || text === "false") value = text === "true";
  else if (/^[[{]/.test(text)) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new DfmProfileError(`--set ${valuePath}: "${text}" is not valid JSON`, valuePath);
    }
  }
  return [valuePath, value];
}

/**
 * Merge the layers in order (last wins; a layer replaces a whole entry, and
 * keeps the earlier unit when it gives none). Returns the merged entries,
 * each with its winning layer and file, and the history of every path.
 * `layers` is [{ scope, file, values }], shipped first.
 */
export function mergeLayers(layers) {
  const merged = {};
  const history = {};
  const errors = [];
  for (const layer of layers) {
    for (const [valuePath, raw] of Object.entries(layer.values ?? {})) {
      let entry;
      try {
        entry = { ...normalizeEntry(valuePath, raw, layer.scope, merged[valuePath]), layer: layer.scope, file: layer.file ?? null };
      } catch (e) {
        if (!(e instanceof DfmProfileError)) throw e;
        errors.push({ path: valuePath, message: `${e.message} (${layer.scope} layer${layer.file ? ` ${layer.file}` : ""}; entry skipped)` });
        continue;
      }
      merged[valuePath] = entry;
      (history[valuePath] ??= []).push(entry);
    }
  }
  return { merged, history, errors };
}

/**
 * Evaluate every formula over the merged entries. Formulas run after the
 * merge, so a changed input recomputes every value that depends on it, and an
 * explicit value in a later layer replaces a formula outright. Cycles,
 * unknown paths and non-numeric inputs are errors naming the path; the value
 * of a path in error is null.
 */
export function evaluateMerged(merged) {
  const values = {};
  const errors = [];
  const state = {}; // path -> "busy" | "done" | "error"
  const numbers = {};
  const failure = {}; // path -> the message of the error that stopped it (the root cause, naming its path)

  const resolvePath = (p, stack) => {
    if (state[p] === "done") return numbers[p];
    if (state[p] === "error") throw new DfmProfileError(failure[p], p);
    if (state[p] === "busy") {
      const cycle = [...stack.slice(stack.indexOf(p)), p];
      throw new DfmProfileError(`formula cycle: ${cycle.join(" -> ")}`, p);
    }
    const entry = merged[p];
    if (!entry) throw new DfmProfileError(`unknown path "${p}"${stack.length ? ` (read by the formula of "${stack[stack.length - 1]}")` : ""}`, p);
    if (!("formula" in entry)) {
      state[p] = "done";
      numbers[p] = entry.value;
      return entry.value;
    }
    state[p] = "busy";
    try {
      const result = evaluateTree(parseFormula(entry.formula), (dep) => {
        const v = resolvePath(dep, [...stack, p]);
        if (typeof v !== "number" || !Number.isFinite(v)) throw new DfmProfileError(`"${dep}" is not a number (read by the formula of "${p}")`, dep);
        return v;
      });
      if (!Number.isFinite(result)) throw new DfmProfileError(`the formula of "${p}" does not give a finite number`, p);
      state[p] = "done";
      numbers[p] = clean(result);
      return numbers[p];
    } catch (e) {
      state[p] = "error";
      failure[p] = e.message;
      throw e;
    }
  };

  for (const p of Object.keys(merged)) {
    let value = null;
    try {
      value = resolvePath(p, []);
    } catch (e) {
      if (!(e instanceof DfmProfileError)) throw e;
      state[p] = "error";
      failure[p] ??= e.message;
      errors.push({ path: p, message: failure[p] });
    }
    const entry = merged[p];
    const out = { value, unit: entry.unit, status: entry.status, source: entry.source, note: entry.note };
    if ("formula" in entry) {
      out.formula = entry.formula;
      out.dependsOn = formulaPaths(parseFormula(entry.formula));
    }
    out.layer = entry.layer;
    out.file = entry.file;
    values[p] = out;
  }
  return { values, errors };
}

/**
 * Resolve a profile. Options:
 *   process      the shipped profile id (default: the nearest layer's `extends`, else fdm)
 *   project      the project root (layer at <project>/dfm/profile.json), or a layer file
 *   part         the part folder (layer at <part>/dfm.json), or a layer file
 *   user         the user layer folder (default <config>/dfm), or a layer file; false leaves it out
 *   set          ["path=value", ...] session overrides
 *   profilesDir  the shipped profiles folder (default: findProfilesDir())
 *   env, platform  for the config folder
 */
export function resolveProfile(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const profilesDir = options.profilesDir ?? findProfilesDir();
  const warnings = [];

  const found = [];
  const userFile = options.user === false ? undefined : userLayerFile(options.user ?? userLayerDir(env, platform));
  if (userFile) found.push({ scope: "user", file: userFile });
  if (options.project) found.push({ scope: "project", file: projectLayerFile(options.project) });
  if (options.part) found.push({ scope: "part", file: partLayerFile(options.part) });
  const layers = [];
  for (const f of found) {
    const layer = loadLayer(f.file);
    if (layer) layers.push({ ...f, layer });
  }

  const nearestExtends = [...layers].reverse().find((l) => l.layer.extends)?.layer.extends;
  const processId = options.process ?? nearestExtends ?? DEFAULT_PROCESS;
  for (const l of layers) if (l.layer.extends && l.layer.extends !== processId) warnings.push(`${l.scope} layer ${l.file} extends "${l.layer.extends}" but the resolved process is "${processId}"; its values still apply`);

  const { file: profileFile, profile } = loadProfile(processId, profilesDir);
  const sessionValues = {};
  for (const s of options.set ?? []) {
    const [k, v] = parseSet(s);
    sessionValues[k] = v;
  }
  const ordered = [
    { scope: "shipped", file: profileFile, values: profile.values },
    ...layers.map((l) => ({ scope: l.scope, file: l.file, values: l.layer.values ?? {}, notes: l.layer.notes, waivers: l.layer.waivers })),
    ...(Object.keys(sessionValues).length ? [{ scope: "session", file: null, values: sessionValues }] : []),
  ];

  const { merged, history, errors } = mergeLayers(ordered);
  const evaluated = evaluateMerged(merged);
  errors.push(...evaluated.errors);

  return {
    schema: RESOLVED_SCHEMA,
    process: profile.process ?? processId,
    profile: { id: profile.id ?? processId, name: profile.name ?? processId },
    layers: ordered.map((l) => ({ scope: l.scope, file: l.file, ...(l.notes ? { notes: l.notes } : {}) })),
    values: evaluated.values,
    waivers: ordered.flatMap((l) => (l.waivers ?? []).map((w) => ({ ...w, layer: l.scope, file: l.file }))),
    errors,
    warnings,
    history,
  };
}

/** What `--explain <path>` prints: every layer that set the path, the winner, and the inputs of its formula. */
export function explain(resolved, valuePath) {
  const v = resolved.values[valuePath];
  if (!v) return { path: valuePath, found: false, message: `no value "${valuePath}" in profile "${resolved.profile.id}"` };
  const inputs = (v.dependsOn ?? []).map((d) => ({ path: d, value: resolved.values[d]?.value ?? null, unit: resolved.values[d]?.unit ?? null, status: resolved.values[d]?.status ?? null, layer: resolved.values[d]?.layer ?? null }));
  return { path: valuePath, found: true, resolved: v, setBy: resolved.history[valuePath] ?? [], inputs, errors: resolved.errors.filter((e) => e.path === valuePath) };
}

const fmt = (v) => (v === null || v === undefined ? "-" : Array.isArray(v) || typeof v === "object" ? JSON.stringify(v) : String(v));

/** A plain-text table of the resolved values. */
export function formatTable(resolved) {
  const rows = [["path", "value", "unit", "status", "layer", "source"]];
  for (const [p, v] of Object.entries(resolved.values)) rows.push([p, fmt(v.value) + (v.formula ? ` (= ${v.formula})` : ""), fmt(v.unit), v.status, v.layer, v.source.length > 60 ? `${v.source.slice(0, 57)}...` : v.source]);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const out = [`${resolved.profile.name} (${resolved.profile.id}), process ${resolved.process}`, `layers: ${resolved.layers.map((l) => `${l.scope}${l.file ? ` ${l.file}` : ""}`).join(" | ")}`, "", line(rows[0]), line(rows[0].map((_, i) => "-".repeat(widths[i]))), ...rows.slice(1).map(line)];
  for (const w of resolved.warnings) out.push(`warning: ${w}`);
  for (const e of resolved.errors) out.push(`error: ${e.path ? `${e.path}: ` : ""}${e.message}`);
  return out.join("\n");
}

function formatExplain(x) {
  if (!x.found) return x.message;
  const out = [`${x.path} = ${fmt(x.resolved.value)} ${x.resolved.unit ?? ""}`.trimEnd(), `  status ${x.resolved.status}, from the ${x.resolved.layer} layer${x.resolved.file ? ` (${x.resolved.file})` : ""}`, `  source: ${x.resolved.source}`];
  if (x.resolved.note) out.push(`  note: ${x.resolved.note}`);
  if (x.resolved.formula) {
    out.push(`  formula: ${x.resolved.formula}`);
    for (const i of x.inputs) out.push(`    ${i.path} = ${fmt(i.value)} ${i.unit ?? ""} (${i.status}, ${i.layer})`);
  }
  out.push("  set by, in order (last wins):");
  for (const h of x.setBy) out.push(`    ${h.layer}: ${"formula" in h ? `formula ${h.formula}` : `value ${fmt(h.value)}`} [${h.status}] ${h.file ?? ""}`.trimEnd());
  for (const e of x.errors) out.push(`  error: ${e.message}`);
  return out.join("\n");
}

const USAGE = `usage: node resolve-profile.mjs [--process fdm] [--project <dir>] [--part <dir>] [--user <dir> | --no-user]
                               [--set path=value ...] [--format json|table] [--explain <path>] [--profiles <dir>]`;

/** The command line. Returns the exit code; writes to the given streams. */
export function main(argv = process.argv.slice(2), io = { out: process.stdout, err: process.stderr, cwd: process.cwd(), env: process.env, platform: process.platform }) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        process: { type: "string" },
        project: { type: "string" },
        part: { type: "string" },
        user: { type: "string" },
        "no-user": { type: "boolean" },
        set: { type: "string", multiple: true },
        format: { type: "string" },
        explain: { type: "string" },
        profiles: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    io.err.write(`${e.message}\n${USAGE}\n`);
    return 2;
  }
  if (args.help) {
    io.out.write(`${USAGE}\n`);
    return 0;
  }
  const format = args.format ?? "json";
  if (!["json", "table"].includes(format)) {
    io.err.write(`--format is json or table\n${USAGE}\n`);
    return 2;
  }
  if (args.user && args["no-user"]) {
    io.err.write(`--user and --no-user cannot be used together\n${USAGE}\n`);
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const part = args.part ? path.resolve(cwd, args.part) : undefined;
  const project = args.project ? path.resolve(cwd, args.project) : findProjectRoot(part ?? cwd);
  let resolved;
  try {
    resolved = resolveProfile({
      process: args.process,
      project,
      part,
      user: args["no-user"] ? false : args.user ? path.resolve(cwd, args.user) : undefined,
      set: args.set,
      profilesDir: findProfilesDir(args.profiles, cwd),
      env: io.env,
      platform: io.platform,
    });
  } catch (e) {
    if (!(e instanceof DfmProfileError)) throw e;
    io.err.write(`${e.message}\n`);
    return 2;
  }
  if (args.explain) {
    const x = explain(resolved, args.explain);
    io.out.write(format === "json" ? `${JSON.stringify(x, null, 2)}\n` : `${formatExplain(x)}\n`);
    return x.found && !x.errors.length ? 0 : 1;
  }
  const { history: _history, ...output } = resolved;
  io.out.write(format === "json" ? `${JSON.stringify(output, null, 2)}\n` : `${formatTable(resolved)}\n`);
  return resolved.errors.length ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
