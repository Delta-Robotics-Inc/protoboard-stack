/**
 * The cascade: token defaults, then the shipped theme (with the themes it extends), then the user's layer, the
 * project's, the board's, and in-memory overrides (a correction being previewed). Every resolved token says which
 * layer set it, from which file, and which decision (when a logged decision set that value there). Guard rails run
 * on the result: printable sizes under the fab's floor keep their value and get an effective value at the floor.
 */
import { existsSync, readFileSync } from "node:fs";
import { copperLayers, type BoardDocument } from "@protoboardai/board";
import { listDecisions, type ListedDecision } from "./decisions.js";
import { fabProfile, type FabProfile } from "./fab.js";
import { boardGuards, tokenGuards, type Clamp, type GuardResult } from "./guards.js";
import { stylePlaces, type StylePlaces } from "./paths.js";
import { DEFAULT_THEME, LAYER_SCHEMA, parseLayer, parseTheme, themeChain, type LayerFile, type ThemeFile } from "./theme.js";
import { formatValue, TOKENS, tokenDef, tokenUnit, type TextClass, type TokenClass, type TokenValue } from "./tokens.js";
import { canonical } from "@protoboardai/board";

export type LayerName = "default" | "shipped" | "user" | "project" | "board" | "override";

export interface ResolvedToken {
  path: string;
  class: TokenClass;
  /** The value the winning layer set. */
  value: TokenValue;
  /** The value tools use: the value, or the fab floor when a guard clamped it. */
  effective: TokenValue;
  layer: LayerName;
  /** The shipped theme id when the layer is `shipped`. */
  theme?: string;
  file?: string;
  decision?: string;
  clamp?: Clamp;
}

export interface ResolvedStyle {
  theme: { id: string; name: string; chain: string[] };
  tokens: Record<string, ResolvedToken>;
  fab: FabProfile;
  /** Derived, read-only: the minimum mask web per side (mm) and the text floor. */
  derived: { maskWeb: { top: number; bottom: number }; textFloor: { height: number; stroke: number } };
  guards: GuardResult[];
  layers: { name: LayerName; file?: string; present: boolean; extends?: string }[];
  places: StylePlaces;
}

export interface ResolveOptions {
  /** The board folder (its `style.json` is the board layer; the project is found from it). */
  boardDir?: string;
  projectRoot?: string;
  /** The user's style folder; `false` leaves the user layer out (tests, CI). */
  userDir?: string | false;
  /** Force the base theme (a preview of another theme); otherwise the nearest layer's `extends`, else the default. */
  theme?: string;
  /** In-memory token values on top of every layer (a correction before it is written). */
  overrides?: Record<string, TokenValue>;
  /** Extra themes by id (a theme being edited, a theme from a shared package). */
  themes?: Record<string, ThemeFile>;
}

type Board = BoardDocument | { doc: BoardDocument; dir?: string; projectRoot?: string };
const docOf = (b: Board | undefined): BoardDocument | undefined => (!b ? undefined : "records" in b ? b : b.doc);

function readLayer(file: string): LayerFile | undefined {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8");
  const raw = JSON.parse(text) as { schema?: string };
  if (raw.schema === LAYER_SCHEMA) return parseLayer(text, file);
  const t = parseTheme(text, file);
  return { schema: LAYER_SCHEMA, ...(t.extends ? { extends: t.extends } : { extends: t.id }), tokens: t.tokens };
}

/**
 * Resolve the style of a board. `board` may be a document (no files: defaults and the shipped theme, plus the user
 * layer unless `userDir: false`) or `{ doc, dir, projectRoot }` for a board in a project.
 */
export function resolveStyle(board?: Board, options: ResolveOptions = {}): ResolvedStyle {
  const doc = docOf(board);
  const boardDir = options.boardDir ?? (board && !("records" in board) ? board.dir : undefined);
  const projectRoot = options.projectRoot ?? (board && !("records" in board) ? board.projectRoot : undefined);
  const places = stylePlaces({ ...(boardDir ? { boardDir } : {}), ...(projectRoot ? { projectRoot } : {}), ...(options.userDir !== undefined ? { userDir: options.userDir } : {}) });
  const files: { name: LayerName; file?: string; layer?: LayerFile }[] = [
    { name: "user", ...(places.user ? { file: places.user.theme, layer: readLayer(places.user.theme) } : {}) },
    { name: "project", ...(places.project ? { file: places.project.theme, layer: readLayer(places.project.theme) } : {}) },
    { name: "board", ...(places.board ? { file: places.board.theme, layer: readLayer(places.board.theme) } : {}) },
  ];
  let themeId = options.theme;
  if (!themeId) for (const f of files) if (f.layer?.extends) themeId = f.layer.extends;
  themeId ??= DEFAULT_THEME;
  const chain = themeChain(themeId, options.themes ?? {});

  const tokens: Record<string, ResolvedToken> = {};
  for (const t of TOKENS) tokens[t.path] = { path: t.path, class: t.class, value: t.default, effective: t.default, layer: "default" };
  for (const th of chain) for (const [p, v] of Object.entries(th.tokens)) tokens[p] = { ...tokens[p], value: v, effective: v, layer: "shipped", theme: th.id, file: `themes/${th.id}/theme.json` };
  const decisions: ListedDecision[] = (() => {
    try {
      return listDecisions(places, places.board ? { board: places.board.key } : {});
    } catch {
      return [];
    }
  })();
  for (const f of files) {
    if (!f.layer) continue;
    for (const [p, v] of Object.entries(f.layer.tokens)) {
      const scope = f.name as "user" | "project" | "board";
      const d = [...decisions].reverse().find((x) => x.effective === "accepted" && x.scope === scope && x.tokens.some((t) => t.path === p && canonical(t.to) === canonical(v)));
      tokens[p] = { ...tokens[p], value: v, effective: v, layer: f.name, ...(f.file ? { file: f.file } : {}), ...(d ? { decision: d.id } : {}) };
      delete tokens[p].theme;
      if (!d) delete tokens[p].decision;
    }
  }
  for (const [p, v] of Object.entries(options.overrides ?? {})) {
    if (!tokenDef(p)) throw new Error(`unknown token ${p}`);
    tokens[p] = { path: p, class: tokens[p].class, value: v, effective: v, layer: "override" };
  }
  const values: Record<string, TokenValue> = {};
  for (const [p, t] of Object.entries(tokens)) values[p] = t.value;
  const g = tokenGuards(values, doc ? { copperLayers: copperLayers(doc).length } : {});
  for (const [p, c] of Object.entries(g.clamps)) tokens[p] = { ...tokens[p], effective: c.to, clamp: c };
  const fab = fabProfile(values["fab.profile"] as string);
  const oz = values["fab.copperWeight"] as number;
  const guards = [...g.results, ...(doc ? boardGuards(doc, values) : [])];
  const top = chain[chain.length - 1];
  return {
    theme: { id: top.id, name: top.name, chain: chain.map((t) => t.id) },
    tokens,
    fab,
    derived: {
      maskWeb: { top: fab.maskWeb(values["fab.mask.color.top"] as string, oz).value, bottom: fab.maskWeb(values["fab.mask.color.bottom"] as string, oz).value },
      textFloor: { height: fab.silk.minTextHeight.value, stroke: fab.silk.minLine.value },
    },
    guards,
    layers: [{ name: "default", present: true }, { name: "shipped", file: `themes/${top.id}/theme.json`, present: true }, ...files.map((f) => ({ name: f.name, ...(f.file ? { file: f.file } : {}), present: !!f.layer, ...(f.layer?.extends ? { extends: f.layer.extends } : {}) }))],
    places,
  };
}

/** A token's effective value (what tools use). */
export function tok<T extends TokenValue = TokenValue>(style: ResolvedStyle, path: string): T {
  const t = style.tokens[path];
  if (!t) throw new Error(`unknown token ${path}`);
  return t.effective as T;
}
export const tokNum = (style: ResolvedStyle, path: string): number => tok<number>(style, path);
export const tokText = (style: ResolvedStyle, path: string): TextClass => tok<TextClass>(style, path);

export interface TokenExplanation {
  path: string;
  title: string;
  class: TokenClass;
  unit: string;
  value: TokenValue;
  effective: TokenValue;
  layer: LayerName;
  file?: string;
  decision?: string;
  /** What each layer says, lowest first (only layers that set it). */
  chain: { layer: LayerName; theme?: string; value: TokenValue }[];
  guard?: string;
  guards: GuardResult[];
  usedBy: readonly string[];
  /** One paragraph for a person or an agent. */
  text: string;
}

/** Why a token has its value: the layers that set it, the decision, the guard rail and its effect. */
export function explainToken(style: ResolvedStyle, path: string): TokenExplanation {
  const def = tokenDef(path);
  const t = style.tokens[path];
  if (!def || !t) throw new Error(`unknown token ${path}`);
  const chain: TokenExplanation["chain"] = [{ layer: "default", value: def.default }];
  for (const id of style.theme.chain) {
    let th: ThemeFile | undefined;
    try {
      th = themeChain(id).at(-1);
    } catch {
      th = undefined; // a theme passed in memory: its values show as the resolved value
    }
    if (th?.tokens[path] !== undefined) chain.push({ layer: "shipped", theme: id, value: th.tokens[path] });
  }
  for (const l of style.layers) {
    if (l.name === "default" || l.name === "shipped" || !l.present || !l.file) continue;
    const layer = readLayer(l.file);
    if (layer?.tokens[path] !== undefined) chain.push({ layer: l.name, value: layer.tokens[path] });
  }
  if (t.layer === "override") chain.push({ layer: "override", value: t.value });
  const guards = style.guards.filter((g) => g.token === path);
  const parts = [`${path} (${def.title}, ${def.class}) is ${formatValue(def, t.value)}`];
  parts.push(t.layer === "default" ? "from the token default" : t.layer === "shipped" ? `from the shipped theme ${t.theme}` : t.layer === "override" ? "from an unsaved override" : `from the ${t.layer} layer (${t.file})`);
  if (t.decision) parts.push(`set by decision ${t.decision}`);
  let text = `${parts.join(", ")}.`;
  if (t.clamp) text += ` Effective value ${formatValue(def, t.effective)}: ${t.clamp.reason}.`;
  if (def.guard) text += ` Guard: ${def.guard}`;
  for (const g of guards) if (g.guard !== "text_floor" && g.guard !== "line_floor") text += ` ${g.severity}: ${g.message}.`;
  if (def.specifiedOnly) text += " Specified for a later version: no tool acts on it yet.";
  return {
    path,
    title: def.title,
    class: def.class,
    unit: tokenUnit(def),
    value: t.value,
    effective: t.effective,
    layer: t.layer,
    ...(t.file ? { file: t.file } : {}),
    ...(t.decision ? { decision: t.decision } : {}),
    chain,
    ...(def.guard ? { guard: def.guard } : {}),
    guards,
    usedBy: def.usedBy,
    text,
  };
}
