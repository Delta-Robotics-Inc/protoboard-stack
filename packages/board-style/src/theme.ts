/**
 * Theme and layer files. A theme is data: `theme.json` names its id, a human name, an optional theme it extends, and
 * token values by path. A layer file (user, project or board) has the same tokens and may pick the base theme with
 * `extends`. Files are written deterministically (fixed key order, tokens sorted by path, two-space indent, LF, a
 * final newline) so they diff cleanly and a person can edit them by hand.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { byCodeUnit } from "@protoboardai/board";
import { checkTokenValue, tokenDef, type TokenValue } from "./tokens.js";

export const THEME_SCHEMA = "protoboard.board-style.theme/v1";
export const LAYER_SCHEMA = "protoboard.board-style.layer/v1";

export interface ThemeFile {
  schema: typeof THEME_SCHEMA;
  id: string;
  name: string;
  extends?: string;
  description: string;
  tokens: Record<string, TokenValue>;
  /** Why a value is what it is, by token path (free text, for people). */
  notes?: Record<string, string>;
}

export interface LayerFile {
  schema: typeof LAYER_SCHEMA;
  /** The base theme this layer builds on; the nearest layer that names one wins. */
  extends?: string;
  tokens: Record<string, TokenValue>;
  notes?: Record<string, string>;
}

export class ThemeFormatError extends Error {
  constructor(
    message: string,
    readonly file?: string,
  ) {
    super(file ? `${file}: ${message}` : message);
  }
}

const ID = /^[a-z][a-z0-9-]{1,40}$/;

function checkTokens(tokens: unknown, file?: string): Record<string, TokenValue> {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) throw new ThemeFormatError("tokens must be an object of token path to value", file);
  for (const [path, value] of Object.entries(tokens)) {
    if (!tokenDef(path)) throw new ThemeFormatError(`unknown token ${path}`, file);
    const why = checkTokenValue(path, value);
    if (why) throw new ThemeFormatError(why, file);
  }
  return tokens as Record<string, TokenValue>;
}

function checkNotes(notes: unknown, file?: string): Record<string, string> | undefined {
  if (notes === undefined) return undefined;
  if (!notes || typeof notes !== "object" || Array.isArray(notes) || !Object.values(notes).every((v) => typeof v === "string")) throw new ThemeFormatError("notes must map token paths to text", file);
  return notes as Record<string, string>;
}

/** Parse and validate a theme file's text. */
export function parseTheme(text: string, file?: string): ThemeFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new ThemeFormatError(`not JSON: ${(e as Error).message}`, file);
  }
  if (raw.schema !== THEME_SCHEMA) throw new ThemeFormatError(`schema must be ${THEME_SCHEMA}`, file);
  const extra = Object.keys(raw).filter((k) => !["schema", "id", "name", "extends", "description", "tokens", "notes"].includes(k));
  if (extra.length) throw new ThemeFormatError(`unknown fields ${extra.join(", ")}`, file);
  if (typeof raw.id !== "string" || !ID.test(raw.id)) throw new ThemeFormatError("id: lowercase letters, digits and hyphens", file);
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new ThemeFormatError("name is required", file);
  if (raw.extends !== undefined && (typeof raw.extends !== "string" || !ID.test(raw.extends))) throw new ThemeFormatError("extends names a theme id", file);
  if (typeof raw.description !== "string") throw new ThemeFormatError("description is required", file);
  const notes = checkNotes(raw.notes, file);
  return { schema: THEME_SCHEMA, id: raw.id, name: raw.name, ...(raw.extends ? { extends: raw.extends as string } : {}), description: raw.description, tokens: checkTokens(raw.tokens, file), ...(notes ? { notes } : {}) };
}

/** Parse and validate a layer file's text. */
export function parseLayer(text: string, file?: string): LayerFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new ThemeFormatError(`not JSON: ${(e as Error).message}`, file);
  }
  if (raw.schema !== LAYER_SCHEMA) throw new ThemeFormatError(`schema must be ${LAYER_SCHEMA}`, file);
  const extra = Object.keys(raw).filter((k) => !["schema", "extends", "tokens", "notes"].includes(k));
  if (extra.length) throw new ThemeFormatError(`unknown fields ${extra.join(", ")}`, file);
  if (raw.extends !== undefined && (typeof raw.extends !== "string" || !ID.test(raw.extends))) throw new ThemeFormatError("extends names a theme id", file);
  const notes = checkNotes(raw.notes, file);
  return { schema: LAYER_SCHEMA, ...(raw.extends ? { extends: raw.extends as string } : {}), tokens: checkTokens(raw.tokens ?? {}, file), ...(notes ? { notes } : {}) };
}

const sortedObject = <V>(o: Record<string, V>): Record<string, V> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => byCodeUnit(a, b)));

/** A text class keeps its own key order (height, width, stroke, case, knockout) so a person reads it naturally. */
function tokenOut(v: TokenValue): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const t = v as { height: number; width: number; stroke: number; case: string; knockout: boolean };
    return { height: t.height, width: t.width, stroke: t.stroke, case: t.case, knockout: t.knockout };
  }
  return v;
}

/** Short arrays and text classes on one line; the rest as JSON with a two-space indent. */
function stringify(value: unknown, indent: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return "{}";
    const flat = entries.every(([, v]) => v === null || typeof v !== "object");
    if (flat && entries.length <= 6 && indent.length >= 4) return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
    const inner = indent + "  ";
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringify(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  return JSON.stringify(value);
}

/** The canonical text of a theme file. */
export function serializeTheme(t: ThemeFile): string {
  const o: Record<string, unknown> = { schema: THEME_SCHEMA, id: t.id, name: t.name };
  if (t.extends) o.extends = t.extends;
  o.description = t.description;
  o.tokens = Object.fromEntries(Object.entries(sortedObject(t.tokens)).map(([k, v]) => [k, tokenOut(v)]));
  if (t.notes && Object.keys(t.notes).length) o.notes = sortedObject(t.notes);
  return `${stringify(o, "")}\n`;
}

/** The canonical text of a layer file. */
export function serializeLayer(l: LayerFile): string {
  const o: Record<string, unknown> = { schema: LAYER_SCHEMA };
  if (l.extends) o.extends = l.extends;
  o.tokens = Object.fromEntries(Object.entries(sortedObject(l.tokens)).map(([k, v]) => [k, tokenOut(v)]));
  if (l.notes && Object.keys(l.notes).length) o.notes = sortedObject(l.notes);
  return `${stringify(o, "")}\n`;
}

// ---------------------------------------------------------------- shipped themes

/** The folder the shipped themes live in (each `<id>/theme.json`). */
export const SHIPPED_THEMES_DIR = fileURLToPath(new URL("./themes/", import.meta.url));
/** The theme a board gets when no layer names one. */
export const DEFAULT_THEME = "hazard-protocol";

const shippedCache = new Map<string, ThemeFile>();

/** The ids of the themes that ship with this package. */
export function shippedThemeIds(): string[] {
  return readdirSync(SHIPPED_THEMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`${SHIPPED_THEMES_DIR}${d.name}/theme.json`))
    .map((d) => d.name)
    .sort(byCodeUnit);
}

/** A shipped theme by id (throws when there is none). */
export function shippedTheme(id: string): ThemeFile {
  let t = shippedCache.get(id);
  if (!t) {
    const file = `${SHIPPED_THEMES_DIR}${id}/theme.json`;
    if (!ID.test(id) || !existsSync(file)) throw new ThemeFormatError(`no shipped theme ${id} (shipped: ${shippedThemeIds().join(", ")})`);
    t = parseTheme(readFileSync(file, "utf8"), file);
    if (t.id !== id) throw new ThemeFormatError(`theme folder ${id} holds theme ${t.id}`, file);
    shippedCache.set(id, t);
  }
  return t;
}

/** A theme's chain from the base to itself (`[neutral, arcade]`), refusing cycles. */
export function themeChain(id: string, extra: Record<string, ThemeFile> = {}): ThemeFile[] {
  const chain: ThemeFile[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur) {
    if (seen.has(cur)) throw new ThemeFormatError(`theme ${id} extends itself through ${cur}`);
    seen.add(cur);
    const t: ThemeFile = extra[cur] ?? shippedTheme(cur);
    chain.unshift(t);
    cur = t.extends;
  }
  return chain;
}
