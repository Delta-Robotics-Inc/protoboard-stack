/**
 * The decisions log: the memory that grows when the user says "I'd rather it look like this". One JSON line per
 * decision in the scope's `decisions.jsonl`, appended and never edited; a later decision supersedes an earlier one by
 * naming it. Recording a decision also writes its token values into the scope's layer file, so the cascade picks them
 * up. A project change made twice (in this project or another one the user has recorded decisions in) is offered for
 * promotion to the user layer; promotion itself is the person's call.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonical } from "@protoboardai/board";
import { stylePlaces, type Scope, type StylePlaces } from "./paths.js";
import { LAYER_SCHEMA, parseLayer, parseTheme, serializeLayer, type LayerFile } from "./theme.js";
import { checkTokenValue, tokenDef, type TokenValue } from "./tokens.js";

export const DECISION_SCHEMA = "protoboard.board-style.decision/v1";

export interface TokenChange {
  path: string;
  from?: TokenValue;
  to: TokenValue;
}

export interface Decision {
  id: string;
  /** YYYY-MM-DD, from the call (never inferred from file times). */
  date: string;
  scope: Scope;
  /** The board key, for board-scope decisions (they live in the project's log). */
  board?: string;
  /** The user's words, verbatim. */
  said: string;
  /** Where the words came from (a session, a meeting id, a review comment), when known. */
  source?: string;
  tokens: TokenChange[];
  /** A rule that is not a token (read by the agent with STYLE.md). */
  rule?: string;
  /** Image files showing before and after, relative to the log's folder or absolute. */
  evidence: string[];
  supersedes: string[];
  status: "accepted" | "proposed";
  /** Guard rails that acted on the change (a value kept at a fab floor). */
  guards?: string[];
  /** Project decisions this user decision was promoted from (`<project root>#<id>`). */
  promotedFrom?: string[];
}

export interface ListedDecision extends Decision {
  /** Derived: superseded when a later decision names it. */
  effective: "accepted" | "proposed" | "superseded";
  supersededBy?: string;
  file: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read a decisions file (missing: none). Bad lines are refused with their line number. */
export function readDecisions(file: string): Decision[] {
  if (!existsSync(file)) return [];
  const out: Decision[] = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      let d: Decision;
      try {
        d = JSON.parse(line) as Decision;
      } catch (e) {
        throw new Error(`${file}:${i + 1}: not JSON (${(e as Error).message})`);
      }
      if (typeof d.id !== "string" || !Array.isArray(d.tokens) || typeof d.said !== "string") throw new Error(`${file}:${i + 1}: not a decision`);
      out.push(d);
    });
  return out;
}

function withStatus(list: Decision[], file: string): ListedDecision[] {
  const by = new Map<string, string>();
  for (const d of list) for (const s of d.supersedes ?? []) by.set(s, d.id);
  return list.map((d) => ({ ...d, effective: by.has(d.id) ? "superseded" : d.status, ...(by.has(d.id) ? { supersededBy: by.get(d.id) } : {}), file }));
}

/** The decisions of the places' layers, oldest first, with derived status; filters by scope, board or token. */
export function listDecisions(places: StylePlaces, filter: { scope?: Scope; board?: string; token?: string } = {}): ListedDecision[] {
  const out: ListedDecision[] = [];
  if (places.user && (!filter.scope || filter.scope === "user")) out.push(...withStatus(readDecisions(places.user.decisions), places.user.decisions));
  if (places.project && filter.scope !== "user") {
    for (const d of withStatus(readDecisions(places.project.decisions), places.project.decisions)) {
      if (filter.scope && d.scope !== filter.scope) continue;
      if (d.scope === "board" && filter.board && d.board !== filter.board) continue;
      out.push(d);
    }
  }
  return filter.token ? out.filter((d) => d.tokens.some((t) => t.path === filter.token)) : out;
}

function nextId(existing: Decision[], scope: Scope): string {
  const prefix = scope === "user" ? "D-USR-" : "D-PCB-";
  let n = 0;
  for (const d of existing) if (d.id.startsWith(prefix)) n = Math.max(n, Number(d.id.slice(prefix.length)) || 0);
  return `${prefix}${String(n + 1).padStart(4, "0")}`;
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** Read a layer file (or theme file treated as a layer) for writing token values into it. */
function readLayerForWrite(file: string): LayerFile {
  if (!existsSync(file)) return { schema: LAYER_SCHEMA, tokens: {} };
  const text = readFileSync(file, "utf8");
  const raw = JSON.parse(text) as { schema?: string };
  if (raw.schema === LAYER_SCHEMA) return parseLayer(text, file);
  // a user who wrote a full theme file as their layer: keep its tokens and extends
  const t = parseTheme(text, file);
  return { schema: LAYER_SCHEMA, ...(t.extends ? { extends: t.extends } : {}), tokens: { ...t.tokens }, ...(t.notes ? { notes: t.notes } : {}) };
}

/** The layer file a scope's tokens go to. */
export function layerFileOf(places: StylePlaces, scope: Scope): string {
  if (scope === "user") {
    if (!places.user) throw new Error("no user style folder (userDir is off)");
    return places.user.theme;
  }
  if (scope === "project") {
    if (!places.project) throw new Error("no project: the board is not inside a project, so a project decision has nowhere to go");
    return places.project.theme;
  }
  if (!places.board) throw new Error("no board folder: a board decision needs the board's folder");
  return places.board.theme;
}

const decisionsFileOf = (places: StylePlaces, scope: Scope): string => {
  if (scope === "user") {
    if (!places.user) throw new Error("no user style folder (userDir is off)");
    return places.user.decisions;
  }
  if (!places.project) throw new Error(`a ${scope} decision is logged in the project's style folder, and the board is not in a project`);
  return places.project.decisions;
};

export interface RecordDecisionInput {
  said: string;
  tokens: { path: string; to: TokenValue }[];
  scope: Scope;
  evidence?: string[];
  rule?: string;
  source?: string;
  date?: string;
  status?: "accepted" | "proposed";
  guards?: string[];
  promotedFrom?: string[];
  /** Write the token values into the scope's layer file (default true). */
  apply?: boolean;
}

export interface RecordDecisionResult {
  decision: Decision;
  file: string;
  layerFile?: string;
  /** Token changes now made twice at project scope: offer promotion to the user layer. */
  promotion: PromotionCandidate[];
}

/** Append a decision and (by default) write its tokens into the scope's layer file. */
export function recordDecision(places: StylePlaces, input: RecordDecisionInput): RecordDecisionResult {
  if (!input.said.trim()) throw new Error("said: the user's words are required");
  if (!input.tokens.length && !input.rule) throw new Error("a decision changes at least one token or states a rule");
  for (const t of input.tokens) {
    if (!tokenDef(t.path)) throw new Error(`unknown token ${t.path}`);
    const why = checkTokenValue(t.path, t.to);
    if (why) throw new Error(why);
  }
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  if (!DATE.test(date)) throw new Error("date: YYYY-MM-DD");
  const file = decisionsFileOf(places, input.scope);
  const existing = readDecisions(file);
  const layerFile = layerFileOf(places, input.scope);
  const layer = readLayerForWrite(layerFile);
  const board = input.scope === "board" ? places.board?.key : undefined;
  // earlier live decisions of the same scope (and board) that set one of these tokens are superseded
  const live = withStatus(existing, file).filter((d) => d.effective !== "superseded" && d.scope === input.scope && d.board === board);
  const supersedes = live.filter((d) => d.tokens.some((t) => input.tokens.some((n) => n.path === t.path))).map((d) => d.id);
  const decision: Decision = {
    id: nextId(existing, input.scope),
    date,
    scope: input.scope,
    ...(board ? { board } : {}),
    said: input.said,
    ...(input.source ? { source: input.source } : {}),
    tokens: input.tokens.map((t) => ({ path: t.path, ...(layer.tokens[t.path] !== undefined ? { from: layer.tokens[t.path] } : {}), to: t.to })),
    ...(input.rule ? { rule: input.rule } : {}),
    evidence: input.evidence ?? [],
    supersedes,
    status: input.status ?? "accepted",
    ...(input.guards?.length ? { guards: input.guards } : {}),
    ...(input.promotedFrom?.length ? { promotedFrom: input.promotedFrom } : {}),
  };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(decision)}\n`);
  let wrote: string | undefined;
  if ((input.apply ?? true) && decision.status === "accepted" && input.tokens.length) {
    for (const t of input.tokens) layer.tokens[t.path] = t.to;
    writeAtomic(layerFile, serializeLayer(layer));
    wrote = layerFile;
  }
  if (input.scope === "project" && places.user && places.project) registerProject(places.user.dir, places.project.root);
  const promotion = input.scope === "project" ? promotionCandidates(places).filter((c) => input.tokens.some((t) => t.path === c.path)) : [];
  return { decision, file, ...(wrote ? { layerFile: wrote } : {}), promotion };
}

// ---------------------------------------------------------------- promotion

const PROJECTS_FILE = "projects.json";

/** Remember a project root that recorded decisions, so promotion can see the same change in other projects. */
export function registerProject(userDir: string, projectRoot: string): void {
  const file = resolve(userDir, PROJECTS_FILE);
  const known = readProjects(userDir);
  const root = resolve(projectRoot);
  if (known.includes(root)) return;
  writeAtomic(file, `${JSON.stringify({ projects: [...known, root].sort() }, null, 2)}\n`);
}

export function readProjects(userDir: string): string[] {
  const file = resolve(userDir, PROJECTS_FILE);
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, "utf8")) as { projects?: unknown };
  return Array.isArray(raw.projects) ? raw.projects.filter((p): p is string => typeof p === "string") : [];
}

export interface PromotionCandidate {
  path: string;
  to: TokenValue;
  /** The project decisions that made this change (`<project root>#<id>`). */
  decisions: string[];
}

/**
 * Token changes made at project scope at least twice (live decisions, this project and every project the user folder
 * knows), whose value the user layer does not already have.
 */
export function promotionCandidates(places: StylePlaces): PromotionCandidate[] {
  if (!places.user) return [];
  const roots = new Set(readProjects(places.user.dir));
  if (places.project) roots.add(resolve(places.project.root));
  const userLayer = readLayerForWrite(places.user.theme);
  const groups = new Map<string, PromotionCandidate>();
  for (const root of [...roots].sort()) {
    const p = stylePlaces({ projectRoot: root, userDir: false }).project!;
    for (const d of withStatus(readDecisions(p.decisions), p.decisions)) {
      if (d.effective !== "accepted" || d.scope !== "project") continue;
      for (const t of d.tokens) {
        const key = `${t.path}=${canonical(t.to)}`;
        const g = groups.get(key) ?? { path: t.path, to: t.to, decisions: [] };
        g.decisions.push(`${root}#${d.id}`);
        groups.set(key, g);
      }
    }
  }
  return [...groups.values()].filter((g) => g.decisions.length >= 2 && canonical(userLayer.tokens[g.path] ?? null) !== canonical(g.to));
}

/** The person approved: record the candidate as a user decision (it supersedes nothing in the projects). */
export function promoteDecision(places: StylePlaces, candidate: PromotionCandidate, o: { said: string; date?: string }): RecordDecisionResult {
  return recordDecision(places, { said: o.said, tokens: [{ path: candidate.path, to: candidate.to }], scope: "user", promotedFrom: candidate.decisions, ...(o.date ? { date: o.date } : {}) });
}

/** A readable view of a decisions log (the `DECISIONS.md` beside it). */
export function decisionsMarkdown(list: ListedDecision[]): string {
  const lines = ["# Style decisions", "", "Generated from decisions.jsonl; do not edit by hand. Newest last.", ""];
  if (!list.length) lines.push("No decisions yet.");
  for (const d of list) {
    lines.push(`## ${d.id} (${d.scope}${d.board ? ` ${d.board}` : ""}, ${d.date}, ${d.effective}${d.supersededBy ? ` by ${d.supersededBy}` : ""})`, "");
    lines.push(`Said: "${d.said}"`, "");
    for (const t of d.tokens) lines.push(`- \`${t.path}\`: ${t.from === undefined ? "(inherited)" : canonical(t.from)} to ${canonical(t.to)}`);
    if (d.rule) lines.push(`- Rule: ${d.rule}`);
    if (d.guards?.length) lines.push(`- Guard rails: ${d.guards.join("; ")}`);
    if (d.evidence.length) lines.push(`- Evidence: ${d.evidence.join(", ")}`);
    if (d.promotedFrom?.length) lines.push(`- Promoted from: ${d.promotedFrom.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
