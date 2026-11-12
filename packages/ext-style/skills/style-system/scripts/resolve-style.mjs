#!/usr/bin/env node
/**
 * resolve-style.mjs: the style system's resolver (plain Node ESM, no dependencies).
 *
 *   node resolve-style.mjs --domain core|cad [--project <dir>] [--item <dir>] [--user <dir>|--no-user]
 *                          [--set path=value ...] [--theme <id>] [--dfm <resolved.json>] [--explain <path>]
 *                          [--format json|table]
 *
 * The cascade, last wins, as in @protoboardai/board-style: token defaults, the shipped theme and the themes it
 * extends, the user layer, the project layer, the item layer (CAD only), then in-session overrides (--set). The
 * nearest layer that names a base theme with `extends` picks it; otherwise hazard-protocol. A theme is found by id in
 * the project's themes/ folder, then the user's, then the shipped ones (bring your own theme). A layer replaces a
 * whole token value. Every resolved token records the layer, the file and the decision that set it.
 *
 * Resolving `cad` also resolves `core` and substitutes `{core.<path>}` references. With --dfm (a resolved DFM
 * profile, schema protoboard.dfm.resolved/v1), tokens with a floor or ceiling formula get an effective value and a
 * reason; without it they are reported as not checked against a process. Formulas are evaluated by the small parser
 * below (numbers, DFM paths, + - * / and parentheses, min, max, round); nothing is ever passed to eval or Function.
 *
 * Exports pure functions for tests. Never writes a file.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------- constants

/** The package root (…/ext-style/), three folders above this script. */
export const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SHIPPED_THEMES_DIR = path.join(PACKAGE_ROOT, "themes");
export const SHIPPED_ASSETS_DIR = path.join(PACKAGE_ROOT, "assets");
export const DEFAULT_THEME = "hazard-protocol";

export const TOKENS_SCHEMA = "protoboard.style.tokens/v1";
export const DECISION_SCHEMA = "protoboard.style.decision/v1";
export const RESOLVED_SCHEMA = "protoboard.style.resolved/v1";
export const ASSETS_SCHEMA = "protoboard.style.assets/v1";
export const DFM_SCHEMA = "protoboard.dfm.resolved/v1";

/** The domains this resolver knows: schema ids, decision id prefix, and where each scope keeps its files. */
export const DOMAINS = {
  core: { theme: "protoboard.style.theme/v1", layer: "protoboard.style.layer/v1", prefix: "D-STYLE-", user: ["style"], project: ["style"], item: false },
  cad: { theme: "protoboard.cad-style.theme/v1", layer: "protoboard.cad-style.layer/v1", prefix: "D-CAD-", user: ["cad-style"], project: ["style", "cad"], item: true },
};

/** The DFM profile paths a floor or ceiling formula may name (the contract with the dfm resolver). */
export const DFM_PATHS = [
  "machine.nozzle",
  "layer.height",
  "line.width",
  "wall.min",
  "wall.structural",
  "wall.unit",
  "overhang.max.angle",
  "bridge.max.span",
  "text.min.height",
  "text.min.stroke",
  "text.emboss.height",
  "text.engrave.depth",
  "chamfer.bed.edge",
  "clearance.sliding.side",
  "feature.min.gap",
];

const ID = /^[a-z][a-z0-9-]{1,40}$/;
const TOKEN_PATH = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/;
const REF = /^\{core\.([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*)\}$/;
const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const ASSET_ID = /^(none|[a-z0-9][a-z0-9.-]{0,63})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class StyleError extends Error {
  constructor(message, file) {
    super(file ? `${file}: ${message}` : message);
    this.name = "StyleError";
    this.file = file;
  }
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const canonical = (v) => JSON.stringify(v ?? null);
export const isRef = (v) => typeof v === "string" && REF.test(v);
export const refPath = (v) => (isRef(v) ? REF.exec(v)[1] : undefined);

// ---------------------------------------------------------------- places

/** The Protoboard config folder, chosen exactly as @protoboardai/board-style's paths.ts chooses it. */
export function configDir(env = process.env, platform = process.platform) {
  const p = platform === "win32" ? path.win32 : path.posix;
  if (env.PROTOBOARD_CONFIG_DIR) return env.PROTOBOARD_CONFIG_DIR;
  if (platform === "win32" && env.APPDATA) return p.join(env.APPDATA, "protoboard");
  return p.join(env.XDG_CONFIG_HOME || p.join(env.HOME || homedir(), ".config"), "protoboard");
}

/** The user's style folder of a domain: `<config>/style` (core), `<config>/cad-style` (cad). */
export function userStyleDir(domain, env = process.env, platform = process.platform) {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(configDir(env, platform), ...domainOf(domain).user);
}

/** The project's style folder of a domain: `<project>/style` (core), `<project>/style/cad` (cad). */
export const projectStyleDir = (domain, projectRoot) => path.join(projectRoot, ...domainOf(domain).project);

/** The nearest folder at or above `from` that holds protoboard.config.ts, else undefined. */
export function findProjectRoot(from) {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, "protoboard.config.ts"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** `<item key>`: the item folder relative to the project root, separators replaced by `__` (as board-style keys boards). */
export function itemKey(projectRoot, itemDir) {
  if (!projectRoot) return "item";
  return path.relative(path.resolve(projectRoot), path.resolve(itemDir)).split(/[\\/]+/).filter(Boolean).join("__") || "item";
}

function domainOf(domain) {
  const d = DOMAINS[domain];
  if (!d) throw new StyleError(`unknown domain ${domain} (known: ${Object.keys(DOMAINS).join(", ")})`);
  return d;
}

/**
 * The files of each scope for a domain. `user`: the Protoboard config folder (each domain reads its own subfolder
 * of it, `style` or `cad-style`), false to leave the user layer out (tests, CI), or undefined for the default config
 * folder. `project`: the project root. `item`: a module folder (CAD only; its `style.json`).
 */
export function stylePlaces(domain, o = {}) {
  const d = domainOf(domain);
  const out = {};
  const userDir = o.user === false ? undefined : o.user ? path.join(path.resolve(o.user), ...d.user) : userStyleDir(domain);
  if (userDir) out.user = { dir: userDir, theme: path.join(userDir, "theme.json"), themes: path.join(userDir, "themes"), decisions: path.join(userDir, "decisions.jsonl"), examples: path.join(userDir, "examples"), assets: path.join(userDir, "assets") };
  const root = o.project ? path.resolve(o.project) : o.item ? findProjectRoot(o.item) : undefined;
  if (root) {
    const dir = projectStyleDir(domain, root);
    out.project = { root, dir, theme: path.join(dir, "theme.json"), themes: path.join(dir, "themes"), decisions: path.join(dir, "decisions.jsonl"), examples: path.join(dir, "examples"), assets: path.join(dir, "assets"), guide: path.join(dir, "STYLE.md") };
  }
  if (d.item && o.item) {
    const dir = path.resolve(o.item);
    out.item = { dir, key: itemKey(root, dir), theme: path.join(dir, "style.json") };
  }
  return out;
}

// ---------------------------------------------------------------- token definitions

const defsCache = new Map();

/** A domain's token definitions (themes/<domain>/tokens.json), validated, with formulas parsed. */
export function tokenDefs(domain) {
  domainOf(domain);
  let defs = defsCache.get(domain);
  if (defs) return defs;
  const file = path.join(SHIPPED_THEMES_DIR, domain, "tokens.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (raw.schema !== TOKENS_SCHEMA || raw.domain !== domain || !Array.isArray(raw.tokens)) throw new StyleError(`not a ${domain} token list (${TOKENS_SCHEMA})`, file);
  const classes = Object.keys(raw.classes ?? {});
  defs = new Map();
  for (const t of raw.tokens) {
    if (!TOKEN_PATH.test(t.path ?? "")) throw new StyleError(`bad token path ${t.path}`, file);
    if (defs.has(t.path)) throw new StyleError(`token ${t.path} defined twice`, file);
    if (!classes.includes(t.class)) throw new StyleError(`${t.path}: class ${t.class} is not one of ${classes.join(", ")}`, file);
    for (const k of ["title", "description"]) if (typeof t[k] !== "string" || !t[k]) throw new StyleError(`${t.path}: ${k} is required`, file);
    const def = { ...t, bounds: [] };
    for (const kind of ["floor", "ceiling"]) {
      if (t[kind] === undefined) continue;
      const ast = parseFormula(t[kind]);
      const unknown = formulaPaths(ast).filter((p) => !DFM_PATHS.includes(p));
      if (unknown.length) throw new StyleError(`${t.path}: ${kind} names ${unknown.join(", ")}, not a DFM profile path`, file);
      def.bounds.push({ kind, formula: t[kind], ast });
    }
    const why = checkValue(def, t.default);
    if (why) throw new StyleError(`default of ${why}`, file);
    defs.set(t.path, def);
  }
  defs.classes = raw.classes;
  defsCache.set(domain, defs);
  return defs;
}

/** Why a (non-reference) value does not fit its token's type, or undefined when it does. */
export function checkValue(def, value) {
  const p = def.path;
  const t = def.type;
  const inRange = (v, min, max) => (min !== undefined && v < min ? `${p}: ${v} is below ${min}` : max !== undefined && v > max ? `${p}: ${v} is above ${max}` : undefined);
  switch (t.kind) {
    case "length":
      return isNum(value) ? inRange(value, t.min ?? 0, t.max ?? 1000) : `${p}: a length in mm`;
    case "number":
      if (!isNum(value)) return `${p}: a number`;
      if (t.integer && !Number.isInteger(value)) return `${p}: a whole number`;
      return inRange(value, t.min, t.max);
    case "lengths":
      return Array.isArray(value) && value.length <= 20 && value.every((v) => isNum(v) && v > 0 && v <= 1000) ? undefined : `${p}: a list of positive lengths in mm`;
    case "enum":
      return typeof value === "string" && t.values.includes(value) ? undefined : `${p}: one of ${t.values.join(", ")}`;
    case "set":
      if (!Array.isArray(value) || !value.every((v) => t.values.includes(v))) return `${p}: a list of ${t.values.join(", ")}`;
      return new Set(value).size === value.length ? undefined : `${p}: repeated entries`;
    case "bool":
      return typeof value === "boolean" ? undefined : `${p}: true or false`;
    case "color":
      return typeof value === "string" && HEX.test(value) ? undefined : `${p}: #RRGGBB or #RRGGBBAA`;
    case "text":
      return typeof value === "string" && value.length <= (t.max ?? 120) && !/[\n\r]/.test(value) ? undefined : `${p}: one line of at most ${t.max ?? 120} characters`;
    case "texts":
      return Array.isArray(value) && value.length <= (t.max ?? 40) && value.every((v) => typeof v === "string" && v.length <= 120) ? undefined : `${p}: a list of at most ${t.max ?? 40} short texts`;
    case "asset":
      return typeof value === "string" && ASSET_ID.test(value) ? undefined : `${p}: an asset id or none`;
    default:
      return `${p}: unknown type ${t.kind}`;
  }
}

/** Check a value written in a theme or layer of `domain`: a reference to a known core token, or a value of the type. */
export function checkLayerValue(domain, def, value) {
  if (isRef(value)) return tokenDefs("core").has(refPath(value)) ? undefined : `${def.path}: ${value} names no core token`;
  return checkValue(def, value);
}

// ---------------------------------------------------------------- theme and layer files

function checkTokens(domain, tokens, file) {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) throw new StyleError("tokens must be an object of token path to value", file);
  const defs = tokenDefs(domain);
  for (const [p, v] of Object.entries(tokens)) {
    const def = defs.get(p);
    if (!def) throw new StyleError(`unknown ${domain} token ${p}`, file);
    const why = checkLayerValue(domain, def, v);
    if (why) throw new StyleError(why, file);
  }
  return tokens;
}

function checkNotes(notes, file) {
  if (notes === undefined) return undefined;
  if (!notes || typeof notes !== "object" || Array.isArray(notes) || !Object.values(notes).every((v) => typeof v === "string")) throw new StyleError("notes must map token paths to text", file);
  return notes;
}

function parseJson(text, file) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new StyleError(`not JSON: ${e.message}`, file);
  }
}

/** Parse and validate a theme file of a domain. */
export function parseTheme(domain, text, file) {
  const d = domainOf(domain);
  const raw = parseJson(text, file);
  if (raw.schema !== d.theme) throw new StyleError(`schema must be ${d.theme}`, file);
  const extra = Object.keys(raw).filter((k) => !["schema", "id", "name", "extends", "description", "tokens", "notes"].includes(k));
  if (extra.length) throw new StyleError(`unknown fields ${extra.join(", ")}`, file);
  if (typeof raw.id !== "string" || !ID.test(raw.id)) throw new StyleError("id: lowercase letters, digits and hyphens", file);
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new StyleError("name is required", file);
  if (raw.extends !== undefined && (typeof raw.extends !== "string" || !ID.test(raw.extends))) throw new StyleError("extends names a theme id", file);
  if (typeof raw.description !== "string") throw new StyleError("description is required", file);
  const notes = checkNotes(raw.notes, file);
  return { schema: d.theme, id: raw.id, name: raw.name, ...(raw.extends ? { extends: raw.extends } : {}), description: raw.description, tokens: checkTokens(domain, raw.tokens, file), ...(notes ? { notes } : {}) };
}

/** Parse and validate a layer file of a domain. */
export function parseLayer(domain, text, file) {
  const d = domainOf(domain);
  const raw = parseJson(text, file);
  if (raw.schema !== d.layer) throw new StyleError(`schema must be ${d.layer}`, file);
  const extra = Object.keys(raw).filter((k) => !["schema", "extends", "tokens", "notes"].includes(k));
  if (extra.length) throw new StyleError(`unknown fields ${extra.join(", ")}`, file);
  if (raw.extends !== undefined && (typeof raw.extends !== "string" || !ID.test(raw.extends))) throw new StyleError("extends names a theme id", file);
  const notes = checkNotes(raw.notes, file);
  return { schema: d.layer, ...(raw.extends ? { extends: raw.extends } : {}), tokens: checkTokens(domain, raw.tokens ?? {}, file), ...(notes ? { notes } : {}) };
}

/** Read a layer slot: a layer file, or a full theme file read as a layer that extends its own base (or itself). */
export function readLayer(domain, file) {
  if (!file || !existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8");
  const raw = parseJson(text, file);
  if (raw.schema === domainOf(domain).layer) return parseLayer(domain, text, file);
  const t = parseTheme(domain, text, file);
  return { schema: domainOf(domain).layer, extends: t.extends ?? t.id, tokens: t.tokens, themeFile: true };
}

/** Ids of the shipped themes of a domain. */
export function shippedThemeIds(domain) {
  const dir = path.join(SHIPPED_THEMES_DIR, domain);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "tokens.json")
    .map((f) => f.slice(0, -5))
    .sort();
}

/**
 * Find a theme by id: `<project style dir>/themes/<id>.json`, then `<user style dir>/themes/<id>.json`, then the
 * shipped `themes/<domain>/<id>.json` (the nearest wins). `extra` holds themes passed in memory.
 */
export function findTheme(domain, id, places = {}, extra = {}) {
  if (!ID.test(id)) throw new StyleError(`theme id ${id}: lowercase letters, digits and hyphens`);
  if (extra[id]) return { theme: extra[id], where: "memory" };
  const candidates = [
    ["project", places.project?.themes],
    ["user", places.user?.themes],
    ["shipped", path.join(SHIPPED_THEMES_DIR, domain)],
  ];
  for (const [where, dir] of candidates) {
    if (!dir || id === "tokens") continue;
    const file = path.join(dir, `${id}.json`);
    if (!existsSync(file)) continue;
    const theme = parseTheme(domain, readFileSync(file, "utf8"), file);
    if (theme.id !== id) throw new StyleError(`file ${id}.json holds theme ${theme.id}`, file);
    return { theme, file, where, shown: where === "shipped" ? `themes/${domain}/${id}.json` : file };
  }
  throw new StyleError(`no ${domain} theme ${id} (shipped: ${shippedThemeIds(domain).join(", ")}; also searched the user's and the project's themes/ folders)`);
}

/** A theme's chain from its base to itself, refusing cycles. */
export function themeChain(domain, id, places = {}, extra = {}) {
  const chain = [];
  const seen = new Set();
  let cur = id;
  while (cur) {
    if (seen.has(cur)) throw new StyleError(`theme ${id} extends itself through ${cur}`);
    seen.add(cur);
    const found = findTheme(domain, cur, places, extra);
    chain.unshift(found);
    cur = found.theme.extends;
  }
  return chain;
}

// ---------------------------------------------------------------- decisions

/** Read a decisions file (missing: none). Bad lines are refused with their line number. */
export function readDecisions(file) {
  if (!file || !existsSync(file)) return [];
  const out = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      let d;
      try {
        d = JSON.parse(line);
      } catch (e) {
        throw new StyleError(`line ${i + 1}: not JSON (${e.message})`, file);
      }
      if (typeof d.id !== "string" || !Array.isArray(d.tokens) || typeof d.said !== "string") throw new StyleError(`line ${i + 1}: not a decision (id, said and tokens are required)`, file);
      if (d.date !== undefined && !DATE.test(d.date)) throw new StyleError(`line ${i + 1}: date is YYYY-MM-DD`, file);
      out.push(d);
    });
  return out;
}

/** Decisions with derived status: superseded when a later decision names them. */
export function withStatus(list, file) {
  const by = new Map();
  for (const d of list) for (const s of d.supersedes ?? []) by.set(s, d.id);
  return list.map((d) => ({ ...d, effective: by.has(d.id) ? "superseded" : (d.status ?? "accepted"), ...(by.has(d.id) ? { supersededBy: by.get(d.id) } : {}), ...(file ? { file } : {}) }));
}

/** The next decision id of a domain given the existing lines (D-CAD-0001, D-STYLE-0001). */
export function nextDecisionId(domain, existing) {
  const prefix = domainOf(domain).prefix;
  let n = 0;
  for (const d of existing) if (typeof d.id === "string" && d.id.startsWith(prefix)) n = Math.max(n, Number(d.id.slice(prefix.length)) || 0);
  return `${prefix}${String(n + 1).padStart(4, "0")}`;
}

/** Every decision of the places (user log, then the project log, which also holds item decisions). */
export function listDecisions(places) {
  return [...(places.user ? withStatus(readDecisions(places.user.decisions), places.user.decisions) : []), ...(places.project ? withStatus(readDecisions(places.project.decisions), places.project.decisions) : [])];
}

/**
 * Token changes made at project scope in two or more live decisions (this project's log, and the logs of the
 * projects listed in the user folder's projects.json), whose value the user layer does not already have. The person
 * decides whether to promote; this only finds the candidates.
 */
export function promotionCandidates(domain, places) {
  if (!places.project) return [];
  const roots = new Set([places.project.root]);
  if (places.user && existsSync(path.join(places.user.dir, "projects.json"))) {
    const raw = parseJson(readFileSync(path.join(places.user.dir, "projects.json"), "utf8"), path.join(places.user.dir, "projects.json"));
    for (const r of Array.isArray(raw.projects) ? raw.projects : []) if (typeof r === "string") roots.add(path.resolve(r));
  }
  const userLayer = places.user ? readLayer(domain, places.user.theme) : undefined;
  const groups = new Map();
  for (const root of [...roots].sort()) {
    const file = path.join(projectStyleDir(domain, root), "decisions.jsonl");
    for (const d of withStatus(readDecisions(file), file)) {
      if (d.effective !== "accepted" || d.scope !== "project") continue;
      for (const t of d.tokens) {
        const key = `${t.path}=${canonical(t.to)}`;
        const g = groups.get(key) ?? { path: t.path, to: t.to, decisions: [] };
        g.decisions.push(`${root}#${d.id}`);
        groups.set(key, g);
      }
    }
  }
  return [...groups.values()].filter((g) => g.decisions.length >= 2 && canonical(userLayer?.tokens[g.path]) !== canonical(g.to));
}

// ---------------------------------------------------------------- formulas (no eval)

/** Split a formula into tokens: numbers, DFM paths, function names, operators. Anything else is refused. */
export function tokenizeFormula(src) {
  if (typeof src !== "string" || src.length > 400) throw new StyleError(`formula must be a short string`);
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*/.exec(src.slice(i));
    if (name) {
      out.push({ t: "name", v: name[0] });
      i += name[0].length;
      continue;
    }
    if ("+-*/(),".includes(c)) {
      out.push({ t: c });
      i++;
      continue;
    }
    throw new StyleError(`formula "${src}": unexpected "${c}" at ${i + 1}`);
  }
  return out;
}

const FUNCS = { min: [1, 8], max: [1, 8], round: [1, 2] };

/** Parse a formula into a small tree: { num }, { path }, { op, a, b }, { neg }, { fn, args }. */
export function parseFormula(src) {
  const toks = tokenizeFormula(src);
  let k = 0;
  const peek = () => toks[k];
  const take = (t) => {
    if (toks[k]?.t !== t) throw new StyleError(`formula "${src}": expected "${t}"`);
    return toks[k++];
  };
  const expr = () => {
    let a = term();
    while (peek()?.t === "+" || peek()?.t === "-") {
      const op = toks[k++].t;
      a = { op, a, b: term() };
    }
    return a;
  };
  const term = () => {
    let a = unary();
    while (peek()?.t === "*" || peek()?.t === "/") {
      const op = toks[k++].t;
      a = { op, a, b: unary() };
    }
    return a;
  };
  const unary = () => (peek()?.t === "-" ? (k++, { neg: unary() }) : primary());
  const primary = () => {
    const tok = peek();
    if (!tok) throw new StyleError(`formula "${src}": ends early`);
    if (tok.t === "num") return (k++, { num: tok.v });
    if (tok.t === "(") {
      k++;
      const e = expr();
      take(")");
      return e;
    }
    if (tok.t === "name") {
      k++;
      if (peek()?.t === "(") {
        const arity = FUNCS[tok.v];
        if (!arity) throw new StyleError(`formula "${src}": unknown function ${tok.v}`);
        k++;
        const args = [expr()];
        while (peek()?.t === ",") (k++, args.push(expr()));
        take(")");
        if (args.length < arity[0] || args.length > arity[1]) throw new StyleError(`formula "${src}": ${tok.v} takes ${arity[0]} to ${arity[1]} arguments`);
        return { fn: tok.v, args };
      }
      if (FUNCS[tok.v]) throw new StyleError(`formula "${src}": ${tok.v} needs arguments`);
      return { path: tok.v };
    }
    throw new StyleError(`formula "${src}": unexpected "${tok.t}"`);
  };
  const tree = expr();
  if (k !== toks.length) throw new StyleError(`formula "${src}": unexpected "${toks[k].t === "name" || toks[k].t === "num" ? toks[k].v : toks[k].t}"`);
  return tree;
}

/** The paths a formula names. */
export function formulaPaths(ast) {
  if (ast.path) return [ast.path];
  if (ast.neg) return formulaPaths(ast.neg);
  if (ast.op) return [...formulaPaths(ast.a), ...formulaPaths(ast.b)];
  if (ast.fn) return ast.args.flatMap(formulaPaths);
  return [];
}

export const roundTo = (x, digits = 0) => {
  const f = 10 ** digits;
  return Math.round((x + Math.sign(x) * Number.EPSILON) * f) / f;
};

/**
 * Evaluate a formula (text or tree) with `lookup(path)` giving a number or undefined. Returns { value } or
 * { missing: [paths] } or { error }.
 */
export function evaluateFormula(formula, lookup) {
  const ast = typeof formula === "string" ? parseFormula(formula) : formula;
  const missing = formulaPaths(ast).filter((p) => !isNum(lookup(p)));
  if (missing.length) return { missing: [...new Set(missing)] };
  const ev = (n) => {
    if (n.num !== undefined) return n.num;
    if (n.path) return lookup(n.path);
    if (n.neg) return -ev(n.neg);
    if (n.op) {
      const a = ev(n.a);
      const b = ev(n.b);
      return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : a / b;
    }
    const args = n.args.map(ev);
    if (n.fn === "min") return Math.min(...args);
    if (n.fn === "max") return Math.max(...args);
    const digits = args[1] ?? 0;
    if (!Number.isInteger(digits) || digits < 0 || digits > 6) throw new StyleError("round(x, digits): digits is a whole number from 0 to 6");
    return roundTo(args[0], digits);
  };
  const value = ev(ast);
  if (!isNum(value)) return { error: "the formula has no finite value (division by zero?)" };
  return { value: roundTo(value, 6) };
}

// ---------------------------------------------------------------- DFM profile

/** Read a resolved DFM profile (protoboard.dfm.resolved/v1). */
export function readDfm(file) {
  const raw = parseJson(readFileSync(file, "utf8"), file);
  return dfmProfile(raw, file);
}

/** Validate an already-parsed resolved DFM profile. */
export function dfmProfile(raw, file) {
  if (!raw || raw.schema !== DFM_SCHEMA) throw new StyleError(`not a resolved DFM profile (${DFM_SCHEMA})`, file);
  if (!raw.values || typeof raw.values !== "object") throw new StyleError("values: an object of path to { value, unit, status, source }", file);
  return { file, process: raw.process, values: raw.values };
}

// ---------------------------------------------------------------- assets

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** The registered assets: shipped, then the user's core assets, then the project's (the nearest wins by id). */
export function loadAssets(corePlaces = {}) {
  const out = new Map();
  for (const [layer, dir] of [
    ["shipped", SHIPPED_ASSETS_DIR],
    ["user", corePlaces.user?.assets],
    ["project", corePlaces.project?.assets],
  ]) {
    const file = dir && path.join(dir, "registry.json");
    if (!file || !existsSync(file)) continue;
    const reg = parseJson(readFileSync(file, "utf8"), file);
    if (reg.schema !== ASSETS_SCHEMA || !Array.isArray(reg.assets)) throw new StyleError(`not an asset registry (${ASSETS_SCHEMA})`, file);
    for (const e of reg.assets) {
      const f = path.resolve(dir, e.file);
      out.set(e.id, { id: e.id, kind: e.kind, layer, status: e.status, license: e.license, file: f, verified: existsSync(f) && sha256(f) === e.sha256 });
    }
  }
  return out;
}

/** Why an asset may not be used, or undefined. */
export function assetProblem(a) {
  if (!a) return "not in any asset registry";
  if (!a.verified) return `its file is missing or does not match the registry's hash (${a.file})`;
  if (a.status === "unresolved") return `its license is unresolved (${a.license})`;
  return undefined;
}

// ---------------------------------------------------------------- the cascade

function layerFiles(domain, places) {
  const files = [
    { name: "user", file: places.user?.theme },
    { name: "project", file: places.project?.theme },
  ];
  if (domainOf(domain).item) files.push({ name: "item", file: places.item?.theme });
  return files.map((f) => ({ ...f, layer: f.file ? readLayer(domain, f.file) : undefined }));
}

/**
 * Resolve one domain's tokens without references or bounds: defaults, the theme chain, the layers, overrides.
 * Options: { project, item, user, theme, overrides, themes }.
 */
export function resolveDomain(domain, o = {}) {
  const defs = tokenDefs(domain);
  const places = stylePlaces(domain, o);
  const files = layerFiles(domain, places);
  let themeId = o.theme;
  if (!themeId) for (const f of files) if (f.layer?.extends) themeId = f.layer.extends;
  themeId ??= DEFAULT_THEME;
  const chain = themeChain(domain, themeId, places, o.themes ?? {});

  const tokens = {};
  for (const def of defs.values()) tokens[def.path] = { path: def.path, class: def.class, unit: def.unit ?? "", value: def.default, effective: def.default, layer: "default" };
  for (const c of chain) for (const [p, v] of Object.entries(c.theme.tokens)) tokens[p] = { ...tokens[p], value: v, effective: v, layer: "shipped", theme: c.theme.id, ...(c.shown ? { file: c.shown } : {}) };

  let decisions = [];
  const warnings = [];
  try {
    decisions = listDecisions(places);
  } catch (e) {
    warnings.push(`decisions not read: ${e.message}`);
  }
  for (const f of files) {
    if (!f.layer) continue;
    for (const [p, v] of Object.entries(f.layer.tokens)) {
      const d = [...decisions].reverse().find((x) => x.effective === "accepted" && x.scope === f.name && (f.name !== "item" || x.item === places.item?.key) && x.tokens.some((t) => t.path === p && canonical(t.to) === canonical(v)));
      const { theme: _t, decision: _d, ...rest } = tokens[p];
      tokens[p] = { ...rest, value: v, effective: v, layer: f.name, file: f.file, ...(d ? { decision: d.id } : {}) };
    }
  }
  for (const [p, v] of Object.entries(o.overrides ?? {})) {
    const def = defs.get(p);
    if (!def) throw new StyleError(`unknown ${domain} token ${p}`);
    const why = checkLayerValue(domain, def, v);
    if (why) throw new StyleError(`--set ${why}`);
    tokens[p] = { path: p, class: def.class, unit: def.unit ?? "", value: v, effective: v, layer: "override" };
  }
  const top = chain[chain.length - 1];
  const layers = [
    { name: "default", present: true },
    { name: "shipped", present: true, file: top.shown ?? top.where, theme: top.theme.id },
    ...files.map((f) => ({ name: f.name, present: !!f.layer, ...(f.file ? { file: f.file } : {}), ...(f.layer?.extends ? { extends: f.layer.extends } : {}) })),
    { name: "override", present: Object.keys(o.overrides ?? {}).length > 0 },
  ];
  const out = { domain, theme: { id: top.theme.id, name: top.theme.name, chain: chain.map((c) => c.theme.id), where: top.where }, tokens, layers, places, decisions: decisions.map((d) => ({ id: d.id, scope: d.scope, effective: d.effective, said: d.said, tokens: d.tokens.map((t) => t.path) })), warnings };
  Object.defineProperty(out, "sources", { value: { chain, files, overrides: o.overrides ?? {} }, enumerable: false });
  return out;
}

/** Substitute `{core.<path>}` references in `res` (a resolved domain) from the resolved core `core`. */
function substituteRefs(res, core) {
  const defs = tokenDefs(res.domain);
  const lookup = (p, seen) => {
    const t = core.tokens[p];
    if (!t) throw new StyleError(`{core.${p}} names no core token`);
    if (!isRef(t.value)) return { value: t.effective, from: t };
    if (seen.has(p)) throw new StyleError(`core references loop through ${p}`);
    seen.add(p);
    return lookup(refPath(t.value), seen);
  };
  for (const t of Object.values(res.tokens)) {
    if (!isRef(t.value)) continue;
    const r = lookup(refPath(t.value), new Set(res.domain === "core" ? [t.path] : []));
    const def = defs.get(t.path);
    const why = checkValue(def, r.value);
    if (why) throw new StyleError(`${t.path} = ${t.value} resolves to ${canonical(r.value)}, which does not fit: ${why}`);
    t.ref = `core.${refPath(t.value)}`;
    t.refSetBy = { layer: r.from.layer, ...(r.from.file ? { file: r.from.file } : {}), ...(r.from.decision ? { decision: r.from.decision } : {}) };
    t.effective = r.value;
  }
}

const fmt = (v, unit) => (Array.isArray(v) ? `[${v.join(", ")}]` : `${v}`) + (unit && unit !== "share" && unit !== "count" && unit !== "" ? ` ${unit}` : "");

/** Apply floors and ceilings from a DFM profile (or mark them not checked). */
function applyBounds(res, dfm) {
  const defs = tokenDefs(res.domain);
  const adjusted = [];
  for (const def of defs.values()) {
    if (!def.bounds.length) continue;
    const t = res.tokens[def.path];
    t.bounds = [];
    if (!dfm) {
      for (const b of def.bounds) t.bounds.push({ kind: b.kind, formula: b.formula, status: "not-checked" });
      t.check = "not-checked";
      t.reason = "not checked against a process (no resolved DFM profile given)";
      continue;
    }
    const lookup = (p) => {
      const v = dfm.values[p];
      return v && isNum(v.value) ? v.value : undefined;
    };
    let eff = t.effective;
    const reasons = [];
    let unknown = false;
    for (const b of def.bounds) {
      const r = evaluateFormula(b.ast, lookup);
      const inputs = Object.fromEntries(formulaPaths(b.ast).map((p) => [p, dfm.values[p] ? { value: dfm.values[p].value, unit: dfm.values[p].unit, status: dfm.values[p].status, source: dfm.values[p].source } : null]));
      if (r.missing || r.error) {
        unknown = true;
        t.bounds.push({ kind: b.kind, formula: b.formula, status: "unknown", inputs, reason: r.missing ? `the DFM profile has no value for ${r.missing.join(", ")}` : r.error });
        continue;
      }
      const bound = r.value;
      const clampOne = (x) => (b.kind === "floor" ? Math.max(x, bound) : Math.min(x, bound));
      const next = Array.isArray(eff) ? eff.map(clampOne) : isNum(eff) ? clampOne(eff) : eff;
      const applied = canonical(next) !== canonical(eff);
      const why = `${b.kind} ${b.formula} = ${fmt(bound, def.unit)} for ${dfm.process ?? "the process"}${applied ? `: ${fmt(eff, def.unit)} ${b.kind === "floor" ? "raised" : "lowered"} to ${fmt(next, def.unit)}` : ": met"}`;
      t.bounds.push({ kind: b.kind, formula: b.formula, bound, status: applied ? "applied" : "met", inputs, reason: why });
      if (applied) reasons.push(why);
      eff = next;
    }
    if (reasons.length) {
      adjusted.push({ path: def.path, value: t.effective, effective: eff, reason: reasons.join("; ") });
      t.effective = eff;
      t.check = "adjusted";
      t.reason = reasons.join("; ");
    } else t.check = unknown ? "unknown" : "ok";
    if (unknown && !t.reason) t.reason = t.bounds.filter((b) => b.status === "unknown").map((b) => b.reason).join("; ");
  }
  return adjusted;
}

function checkAssets(res, assets) {
  const defs = tokenDefs(res.domain);
  const problems = [];
  for (const t of Object.values(res.tokens)) {
    if (defs.get(t.path).type.kind !== "asset" || t.effective === "none") continue;
    const a = assets.get(t.effective);
    const why = assetProblem(a);
    t.asset = { id: t.effective, found: !!a, ...(a ? { layer: a.layer, status: a.status, license: a.license, verified: a.verified } : {}), ...(why ? { problem: why } : {}) };
    if (why) problems.push({ path: t.path, asset: t.effective, problem: why });
  }
  return problems;
}

/**
 * Resolve the style of a domain. Options: { domain, project, item, user, theme, coreTheme, overrides (domain
 * tokens), coreOverrides, themes, coreThemes, dfm (a profile from readDfm or dfmProfile) }. For `cad` the result has
 * `core` (the resolved core) and every `{core.…}` reference substituted; floors and ceilings apply when `dfm` is given.
 */
export function resolveStyle(o = {}) {
  const domain = o.domain ?? "core";
  domainOf(domain);
  const coreOpts = { project: o.project, user: o.user, theme: o.coreTheme ?? (domain === "core" ? o.theme : undefined), overrides: domain === "core" ? { ...(o.coreOverrides ?? {}), ...(o.overrides ?? {}) } : (o.coreOverrides ?? {}), themes: domain === "core" ? (o.themes ?? {}) : (o.coreThemes ?? {}), item: undefined };
  if (!coreOpts.project && o.item) coreOpts.project = findProjectRoot(o.item);
  const core = resolveDomain("core", coreOpts);
  substituteRefs(core, core);
  const assets = loadAssets(core.places);
  const coreAssetProblems = checkAssets(core, assets);
  const result = { schema: RESOLVED_SCHEMA, domain };
  if (domain === "core") {
    Object.assign(result, core, { schema: RESOLVED_SCHEMA, dfm: null, adjusted: [], assets: coreAssetProblems, promotion: safe(() => promotionCandidates("core", core.places), []) });
    Object.defineProperty(result, "sources", { value: core.sources, enumerable: false });
    return result;
  }
  const res = resolveDomain(domain, { project: o.project, item: o.item, user: o.user, theme: o.theme, overrides: o.overrides ?? {}, themes: o.themes ?? {} });
  substituteRefs(res, core);
  const adjusted = applyBounds(res, o.dfm);
  const problems = checkAssets(res, assets);
  Object.assign(result, res, {
    schema: RESOLVED_SCHEMA,
    dfm: o.dfm ? { file: o.dfm.file, process: o.dfm.process, checked: true } : { checked: false, note: "no resolved DFM profile given: tokens with a floor or ceiling are not checked against a process" },
    adjusted,
    assets: [...coreAssetProblems.map((p) => ({ ...p, path: `core.${p.path}` })), ...problems],
    promotion: safe(() => promotionCandidates(domain, res.places), []),
    core: { theme: core.theme, tokens: core.tokens, layers: core.layers, places: core.places, decisions: core.decisions },
  });
  Object.defineProperty(result, "sources", { value: res.sources, enumerable: false });
  Object.defineProperty(result, "coreResolved", { value: core, enumerable: false });
  return result;
}

function safe(f, fallback) {
  try {
    return f();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- explain

/**
 * Why a token has its value: every layer that set it, the decision, a core reference and the floor or ceiling. In a
 * CAD result, `core.<path>` explains a core token.
 */
export function explainToken(res, tokenPath) {
  const coreOfCad = res.domain !== "core" && tokenPath.startsWith("core.");
  const domain = coreOfCad ? "core" : res.domain;
  const p = coreOfCad ? tokenPath.slice(5) : tokenPath;
  const r = coreOfCad ? res.coreResolved : res;
  const def = tokenDefs(domain).get(p);
  const t = r?.tokens[p];
  if (!def || !t) throw new StyleError(`unknown ${domain} token ${p}`);
  const chain = [{ layer: "default", value: def.default }];
  for (const c of r.sources.chain) if (c.theme.tokens[p] !== undefined) chain.push({ layer: "shipped", theme: c.theme.id, ...(c.shown ? { file: c.shown } : {}), value: c.theme.tokens[p] });
  for (const f of r.sources.files) if (f.layer?.tokens[p] !== undefined) chain.push({ layer: f.name, file: f.file, value: f.layer.tokens[p] });
  if (r.sources.overrides[p] !== undefined) chain.push({ layer: "override", value: r.sources.overrides[p] });
  const parts = [`${domain === "core" && res.domain !== "core" ? "core." : ""}${p} (${def.title}, ${def.class}) is ${fmt(t.value, def.unit)}`];
  parts.push(t.layer === "default" ? "from the token default" : t.layer === "shipped" ? `from the shipped theme ${t.theme}` : t.layer === "override" ? "from an unsaved override" : `from the ${t.layer} layer (${t.file})`);
  if (t.decision) parts.push(`set by decision ${t.decision}`);
  let text = `${parts.join(", ")}.`;
  if (t.ref) text += ` It references ${t.ref}, which is ${fmt(t.effective, "")} (set by the ${t.refSetBy.layer} layer${t.refSetBy.decision ? `, decision ${t.refSetBy.decision}` : ""}).`;
  if (t.check === "adjusted") text += ` Effective value ${fmt(t.effective, def.unit)}: ${t.reason}.`;
  else if (t.check === "not-checked") text += ` It has a ${def.bounds.map((b) => `${b.kind} (${b.formula})`).join(" and ")}, not checked against a process: no resolved DFM profile was given.`;
  else if (t.check === "unknown") text += ` Its bound could not be checked: ${t.reason}.`;
  else if (t.check === "ok") text += ` Within the process bounds (${t.bounds.map((b) => b.reason).join("; ")}).`;
  if (def.guard) text += ` Guard: ${def.guard}`;
  if (t.asset?.problem) text += ` Asset ${t.asset.id}: ${t.asset.problem}.`;
  return { path: tokenPath, domain, title: def.title, class: def.class, unit: def.unit ?? "", value: t.value, effective: t.effective, layer: t.layer, ...(t.file ? { file: t.file } : {}), ...(t.decision ? { decision: t.decision } : {}), ...(t.ref ? { ref: t.ref } : {}), ...(t.bounds ? { bounds: t.bounds } : {}), chain, ...(def.guard ? { guard: def.guard } : {}), text };
}

// ---------------------------------------------------------------- output

const cell = (s) => String(s).replace(/\|/g, "/").replace(/\n/g, " ");

/** A plain-text table of a resolved style (both core and the domain for a branch). */
export function formatTable(res) {
  const L = [];
  const section = (r, prefix) => {
    L.push(`${r.domain} style: ${r.theme.name} (${r.theme.chain.join(" > ")}); layers: ${r.layers.filter((l) => !["default", "shipped"].includes(l.name)).map((l) => `${l.name}${l.present ? "" : " (none)"}`).join(", ")}`);
    L.push("token | class | value | effective | set by | note");
    for (const t of Object.values(r.tokens)) {
      const by = t.layer === "shipped" ? `theme ${t.theme}` : t.layer === "default" ? "default" : `${t.layer}${t.decision ? ` ${t.decision}` : ""}`;
      const note = [t.ref ? `ref ${t.ref}` : "", t.check && t.check !== "ok" ? `${t.check}: ${t.reason}` : "", t.asset?.problem ? `asset: ${t.asset.problem}` : ""].filter(Boolean).join("; ");
      L.push([prefix + t.path, t.class, cell(fmt(t.value, t.unit)), cell(fmt(t.effective, t.unit)), cell(by), cell(note)].join(" | "));
    }
    L.push("");
  };
  if (res.domain !== "core") section({ ...res.core, domain: "core" }, "core.");
  section(res, "");
  if (res.domain !== "core") L.push(res.dfm.checked ? `DFM: ${res.dfm.process ?? "process"} profile ${res.dfm.file ?? ""}; ${res.adjusted.length} preference(s) adjusted` : `DFM: ${res.dfm.note}`);
  for (const a of res.adjusted ?? []) L.push(`adjusted ${a.path}: ${a.reason}`);
  for (const a of res.assets ?? []) L.push(`asset ${a.path} (${a.asset}): ${a.problem}`);
  for (const c of res.promotion ?? []) L.push(`promotion candidate: ${c.path} = ${canonical(c.to)} (${c.decisions.join(", ")}); ask the user before promoting`);
  return `${L.join("\n")}\n`;
}

// ---------------------------------------------------------------- command line

/** Parse the command line into options (throws StyleError on a bad flag). */
export function parseArgs(argv) {
  const o = { domain: "core", format: "json", overrides: {}, coreOverrides: {} };
  const sets = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new StyleError(`${a} needs a value`);
      return v;
    };
    if (a === "--domain") o.domain = val();
    else if (a === "--project") o.project = val();
    else if (a === "--item") o.item = val();
    else if (a === "--user") o.user = val();
    else if (a === "--no-user") o.user = false;
    else if (a === "--set") sets.push(val());
    else if (a === "--theme") o.theme = val();
    else if (a === "--dfm") o.dfmFile = val();
    else if (a === "--explain") o.explain = val();
    else if (a === "--format") o.format = val();
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new StyleError(`unknown option ${a}`);
  }
  domainOf(o.domain);
  if (!["json", "table"].includes(o.format)) throw new StyleError("--format is json or table");
  for (const s of sets) {
    const eq = s.indexOf("=");
    if (eq < 1) throw new StyleError(`--set ${s}: path=value`);
    const p = s.slice(0, eq);
    const raw = s.slice(eq + 1);
    let v;
    try {
      v = JSON.parse(raw);
    } catch {
      v = raw;
    }
    if (p.startsWith("core.") && o.domain !== "core") o.coreOverrides[p.slice(5)] = v;
    else o.overrides[p.startsWith("core.") ? p.slice(5) : p] = v;
  }
  return o;
}

const HELP = `resolve-style: resolve the style of a domain, with every token's value, effective value and source.

  node resolve-style.mjs --domain core|cad [--project <dir>] [--item <dir>] [--user <dir>|--no-user]
                         [--set path=value ...] [--theme <id>] [--dfm <resolved.json>] [--explain <path>]
                         [--format json|table]

  --user <dir> is the Protoboard config folder (default: PROTOBOARD_CONFIG_DIR, else %APPDATA%\\protoboard on
  Windows, else $XDG_CONFIG_HOME/protoboard or ~/.config/protoboard); core reads <dir>/style, cad <dir>/cad-style.
  --set core.<path>=<value> overrides a core token while resolving a branch. Values are JSON when they parse
  (numbers, true, [0.6, 1.2]), else text. Nothing is written.
`;

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  try {
    const o = parseArgs(argv);
    if (o.help) {
      out.write(HELP);
      return 0;
    }
    if (!o.project) o.project = o.item ? findProjectRoot(o.item) : findProjectRoot(process.cwd());
    const dfm = o.dfmFile ? readDfm(o.dfmFile) : undefined;
    const res = resolveStyle({ ...o, ...(dfm ? { dfm } : {}) });
    if (o.explain) {
      const ex = explainToken(res, o.explain);
      out.write(o.format === "json" ? `${JSON.stringify(ex, null, 2)}\n` : `${ex.text}\n`);
      return 0;
    }
    out.write(o.format === "json" ? `${JSON.stringify(res, null, 2)}\n` : formatTable(res));
    return 0;
  } catch (e) {
    err.write(`resolve-style: ${e.message}\n`);
    return e instanceof StyleError ? 2 : 1;
  }
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = main();
