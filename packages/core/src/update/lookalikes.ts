/**
 * The lookalike deny list (PB-1168): loader and name checks.
 *
 * The list is data (`packages/core/reference/lookalikes.json`, schema
 * `protoboard.lookalikes/v0`), so it can grow between releases without a code
 * change. Two checks run over every package name the inventory finds:
 *
 *   1. exact match against `deny` (refused by install and fetch paths that ask
 *      `checkPackageName`) and `watch` (reported only);
 *   2. the generic rule against `protect` (the names Protoboard really uses):
 *      edit distance 1-2, the same base under another scope, a `-js`/`.js`
 *      suffix change, or `<prefix>-<base>` around a long base. A near miss is a
 *      warning; it never blocks or deletes (security-updates-telemetry.md A.4).
 *
 * Nothing here reaches the network. The file is read with a size cap.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LOOKALIKES_SCHEMA = "protoboard.lookalikes/v0";
/** The list is small; anything bigger is not ours. */
export const MAX_LOOKALIKES_BYTES = 1024 * 1024;

export type Ecosystem = "npm" | "PyPI";

export interface DenyEntry {
  name: string;
  ecosystem: Ecosystem;
  imitates?: string;
  kind: "deny" | "watch";
  added?: string;
  comment: string;
}

export interface ProtectEntry {
  /** A package name, or `@scope/*` for a whole scope. */
  name: string;
  ecosystem: Ecosystem;
  comment?: string;
}

export interface LookalikeRules {
  editDistance: { max: number; maxForShortNames: number; shortNameLength: number };
  scopeSwap: boolean;
  jsSuffix: boolean;
  wrapperPrefixMinLength: number;
}

export interface RepoPin {
  repo: string;
  owner: string;
  url?: string;
  comment?: string;
}

export interface LookalikeList {
  schema: typeof LOOKALIKES_SCHEMA;
  updated?: string;
  deny: DenyEntry[];
  protect: ProtectEntry[];
  allow: { name: string; comment?: string }[];
  rules: LookalikeRules;
  repos: RepoPin[];
}

/** What a name check found. `deny` refuses; `watch` and `suspect` warn. */
export interface NameVerdict {
  name: string;
  ecosystem: Ecosystem;
  verdict: "deny" | "watch" | "suspect" | "ok";
  /** The real name it resembles. */
  resembles?: string;
  /** Why, in one line, with the source for a list entry. */
  reason?: string;
}

const DEFAULT_RULES: LookalikeRules = { editDistance: { max: 2, maxForShortNames: 1, shortNameLength: 6 }, scopeSwap: true, jsSuffix: true, wrapperPrefixMinLength: 8 };

/** Where the shipped list is: `packages/core/reference/lookalikes.json` (exported as `@protoboardai/core/reference/lookalikes.json`). */
export function defaultLookalikesPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "reference", "lookalikes.json");
}

/** Reads and validates a list; throws on a malformed or oversized file. */
export function loadLookalikes(file = defaultLookalikesPath()): LookalikeList {
  const size = statSync(file).size;
  if (size > MAX_LOOKALIKES_BYTES) throw new Error(`${file} is ${size} bytes, over the ${MAX_LOOKALIKES_BYTES}-byte limit for a lookalike list`);
  return parseLookalikes(JSON.parse(readFileSync(file, "utf8")));
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 214;
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4000;
const eco = (v: unknown): Ecosystem => (v === "PyPI" ? "PyPI" : "npm");

/** Validates the JSON shape; unknown fields are ignored, bad entries are an error (the list is ours, so a bad one is a bug). */
export function parseLookalikes(raw: unknown): LookalikeList {
  const o = raw as Partial<Record<keyof LookalikeList, unknown>>;
  if (!o || typeof o !== "object" || o.schema !== LOOKALIKES_SCHEMA) throw new Error(`not a ${LOOKALIKES_SCHEMA} list`);
  const arr = (v: unknown, what: string): Record<string, unknown>[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new Error(`lookalikes: ${what} must be an array`);
    return v as Record<string, unknown>[];
  };
  const deny = arr(o.deny, "deny").map((e, i) => {
    if (!str(e.name) || !text(e.comment) || (e.kind !== "deny" && e.kind !== "watch")) throw new Error(`lookalikes: deny[${i}] needs name, kind (deny|watch) and a comment citing its source`);
    return { name: e.name, ecosystem: eco(e.ecosystem), kind: e.kind, comment: e.comment, ...(str(e.imitates) ? { imitates: e.imitates } : {}), ...(str(e.added) ? { added: e.added } : {}) } as DenyEntry;
  });
  const protect = arr(o.protect, "protect").map((e, i) => {
    if (!str(e.name)) throw new Error(`lookalikes: protect[${i}] needs a name`);
    return { name: e.name, ecosystem: eco(e.ecosystem), ...(text(e.comment) ? { comment: e.comment } : {}) } as ProtectEntry;
  });
  const allow = arr(o.allow, "allow").filter((e) => str(e.name)).map((e) => ({ name: e.name as string }));
  const repos = arr(o.repos, "repos").map((e, i) => {
    if (!str(e.repo) || !str(e.owner)) throw new Error(`lookalikes: repos[${i}] needs repo and owner`);
    return { repo: e.repo, owner: e.owner, ...(str(e.url) ? { url: e.url } : {}), ...(text(e.comment) ? { comment: e.comment } : {}) } as RepoPin;
  });
  const r = (o.rules ?? {}) as Partial<LookalikeRules>;
  const ed = (r.editDistance ?? {}) as Partial<LookalikeRules["editDistance"]>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4 ? v : d);
  const rules: LookalikeRules = {
    editDistance: { max: num(ed.max, DEFAULT_RULES.editDistance.max), maxForShortNames: num(ed.maxForShortNames, DEFAULT_RULES.editDistance.maxForShortNames), shortNameLength: typeof ed.shortNameLength === "number" ? ed.shortNameLength : DEFAULT_RULES.editDistance.shortNameLength },
    scopeSwap: r.scopeSwap !== false,
    jsSuffix: r.jsSuffix !== false,
    wrapperPrefixMinLength: typeof r.wrapperPrefixMinLength === "number" ? r.wrapperPrefixMinLength : DEFAULT_RULES.wrapperPrefixMinLength,
  };
  return { schema: LOOKALIKES_SCHEMA, ...(str(o.updated) ? { updated: o.updated } : {}), deny, protect, allow, rules, repos };
}

/** Levenshtein distance with an early exit above `limit` (returns limit + 1 then). */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

const split = (name: string): { scope?: string; base: string } => {
  const m = /^@([^/]+)\/(.+)$/.exec(name);
  return m ? { scope: m[1], base: m[2] } : { base: name };
};
/** PyPI names compare normalised (PEP 503); npm names are already lower case. */
const norm = (name: string, ecosystem: Ecosystem) => (ecosystem === "PyPI" ? name.toLowerCase().replace(/[-_.]+/g, "-") : name);
const stripJs = (s: string) => s.replace(/([-.]?js)$/i, "");

/** How a name resembles one protected entry, or undefined. */
function resemblance(name: string, p: ProtectEntry, rules: LookalikeRules): string | undefined {
  const c = split(name);
  const t = split(p.name);
  // a whole scope (`@protoboardai/*`): another scope close to it, or the scope spelt into an unscoped name
  if (t.base === "*" && t.scope) {
    if (c.scope === t.scope) return undefined;
    if (c.scope && editDistance(c.scope, t.scope, 2) <= 2) return `scope @${c.scope} is close to @${t.scope}`;
    const flat = c.base.replace(/[-_.]/g, "");
    if (!c.scope && flat.startsWith(t.scope.replace(/[-_.]/g, ""))) return `unscoped name spells the @${t.scope} scope`;
    return undefined;
  }
  if (name === p.name) return undefined;
  const limit = p.name.length < rules.editDistance.shortNameLength ? rules.editDistance.maxForShortNames : rules.editDistance.max;
  const d = editDistance(name, p.name, limit);
  if (d >= 1 && d <= limit) return `edit distance ${d} from ${p.name}`;
  // a rescoped copy: of an unscoped name (`@sunbox/occt-import-js`), or a scoped name's distinctive base used bare;
  // generic bases under another scope (`@tscircuit/core` against `@gltf-transform/core`) are not lookalikes
  const swapped = c.base === t.base && c.scope !== t.scope && (!t.scope || (!c.scope && t.base.length >= rules.wrapperPrefixMinLength));
  if (rules.scopeSwap && swapped) return `same name as ${p.name} under ${c.scope ? `@${c.scope}` : "no scope"}`;
  if (rules.jsSuffix && c.scope === t.scope && c.base !== t.base && stripJs(c.base) === stripJs(t.base) && stripJs(c.base).length > 0) return `${p.name} with a js suffix changed`;
  if (t.base.length >= rules.wrapperPrefixMinLength && c.base !== t.base && c.base.endsWith(`-${t.base}`)) return `${p.name} with a prefix`;
  return undefined;
}

/**
 * The verdict for one package name. `deny` means refuse (an install or fetch
 * path that sees it stops and says why); `watch` and `suspect` mean warn.
 */
export function checkPackageName(name: string, ecosystem: Ecosystem = "npm", list: LookalikeList = loadLookalikes()): NameVerdict {
  const n = norm(name, ecosystem);
  const hit = list.deny.find((e) => e.ecosystem === ecosystem && norm(e.name, ecosystem) === n);
  if (hit) return { name, ecosystem, verdict: hit.kind, ...(hit.imitates ? { resembles: hit.imitates } : {}), reason: hit.comment };
  if (list.allow.some((a) => norm(a.name, ecosystem) === n)) return { name, ecosystem, verdict: "ok" };
  const protectedHere = list.protect.filter((p) => p.ecosystem === ecosystem);
  // a protected name itself, or a member of a protected scope, is ours
  if (protectedHere.some((p) => norm(p.name, ecosystem) === n || (p.name.endsWith("/*") && n.startsWith(p.name.slice(0, -1))))) return { name, ecosystem, verdict: "ok" };
  for (const p of protectedHere) {
    const why = resemblance(n, { ...p, name: norm(p.name, ecosystem) }, list.rules);
    if (why) return { name, ecosystem, verdict: "suspect", resembles: p.name, reason: `possible lookalike: ${why}` };
  }
  return { name, ecosystem, verdict: "ok" };
}

/** Every name that is not `ok`, in input order (names repeat across folders; each is checked once). */
export function scanNames(names: { name: string; ecosystem: Ecosystem }[], list: LookalikeList = loadLookalikes()): NameVerdict[] {
  const seen = new Set<string>();
  const out: NameVerdict[] = [];
  for (const { name, ecosystem } of names) {
    const key = `${ecosystem}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const v = checkPackageName(name, ecosystem, list);
    if (v.verdict !== "ok") out.push(v);
  }
  return out;
}

/** Whether a GitHub `owner/repo` matches the pinned owner for that repo name (undefined: the repo is not pinned). */
export function checkRepoOwner(ownerRepo: string, list: LookalikeList = loadLookalikes()): { ok: boolean; expected: string; reason?: string } | undefined {
  const m = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(ownerRepo.trim());
  if (!m) return undefined;
  const pin = list.repos.find((r) => r.repo.toLowerCase() === m[2].toLowerCase());
  if (!pin) return undefined;
  return pin.owner.toLowerCase() === m[1].toLowerCase() ? { ok: true, expected: `${pin.owner}/${pin.repo}` } : { ok: false, expected: `${pin.owner}/${pin.repo}`, reason: pin.comment ?? `the real ${pin.repo} is ${pin.owner}/${pin.repo}` };
}
