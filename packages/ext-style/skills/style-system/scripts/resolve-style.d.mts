/** Types for resolve-style.mjs (plain Node ESM). Resolved records are plain JSON objects; see the script's comments. */
export type Domain = "core" | "cad";
export type TokenValue = string | number | boolean | readonly string[] | readonly number[];

export interface TokenDef {
  path: string;
  class: string;
  type: { kind: string; [k: string]: unknown };
  unit?: string;
  default: TokenValue;
  title: string;
  description: string;
  guard?: string;
  floor?: string;
  ceiling?: string;
  bounds: { kind: "floor" | "ceiling"; formula: string; ast: unknown }[];
}

export interface DfmProfile {
  file?: string;
  process?: string;
  values: Record<string, { value: unknown; unit?: string; status?: string; source?: string; note?: string; layer?: string; file?: string }>;
}

export interface ResolveOptions {
  domain?: Domain;
  project?: string;
  item?: string;
  /** The Protoboard config folder; false leaves the user layer out. */
  user?: string | false;
  theme?: string;
  coreTheme?: string;
  overrides?: Record<string, unknown>;
  coreOverrides?: Record<string, unknown>;
  themes?: Record<string, unknown>;
  coreThemes?: Record<string, unknown>;
  dfm?: DfmProfile;
}

// biome-ignore lint: resolved records are open JSON
export type Resolved = Record<string, any>;

export const PACKAGE_ROOT: string;
export const SHIPPED_THEMES_DIR: string;
export const SHIPPED_ASSETS_DIR: string;
export const DEFAULT_THEME: string;
export const TOKENS_SCHEMA: string;
export const DECISION_SCHEMA: string;
export const RESOLVED_SCHEMA: string;
export const ASSETS_SCHEMA: string;
export const DFM_SCHEMA: string;
export const DOMAINS: Record<Domain, { theme: string; layer: string; prefix: string; user: string[]; project: string[]; item: boolean }>;
export const DFM_PATHS: string[];
export class StyleError extends Error {
  file?: string;
  constructor(message: string, file?: string);
}
export function canonical(v: unknown): string;
export function isRef(v: unknown): boolean;
export function refPath(v: unknown): string | undefined;
export function configDir(env?: Record<string, string | undefined>, platform?: string): string;
export function userStyleDir(domain: Domain, env?: Record<string, string | undefined>, platform?: string): string;
export function projectStyleDir(domain: Domain, projectRoot: string): string;
export function findProjectRoot(from: string): string | undefined;
export function itemKey(projectRoot: string | undefined, itemDir: string): string;
export function stylePlaces(domain: Domain, o?: { project?: string; item?: string; user?: string | false }): Resolved;
export function tokenDefs(domain: Domain): Map<string, TokenDef> & { classes?: Record<string, string> };
export function checkValue(def: { path: string; type: { kind: string; [k: string]: unknown } }, value: unknown): string | undefined;
export function checkLayerValue(domain: Domain, def: TokenDef, value: unknown): string | undefined;
export function parseTheme(domain: Domain, text: string, file?: string): Resolved;
export function parseLayer(domain: Domain, text: string, file?: string): Resolved;
export function readLayer(domain: Domain, file?: string): Resolved | undefined;
export function shippedThemeIds(domain: Domain): string[];
export function findTheme(domain: Domain, id: string, places?: Resolved, extra?: Record<string, unknown>): Resolved;
export function themeChain(domain: Domain, id: string, places?: Resolved, extra?: Record<string, unknown>): Resolved[];
export function readDecisions(file?: string): Resolved[];
export function withStatus(list: Resolved[], file?: string): Resolved[];
export function nextDecisionId(domain: Domain, existing: { id?: string }[]): string;
export function listDecisions(places: Resolved): Resolved[];
export function promotionCandidates(domain: Domain, places: Resolved): { path: string; to: unknown; decisions: string[] }[];
export function tokenizeFormula(src: string): unknown[];
export function parseFormula(src: string): unknown;
export function formulaPaths(ast: unknown): string[];
export function roundTo(x: number, digits?: number): number;
export function evaluateFormula(formula: string | unknown, lookup: (path: string) => number | undefined): { value?: number; missing?: string[]; error?: string };
export function readDfm(file: string): DfmProfile;
export function dfmProfile(raw: unknown, file?: string): DfmProfile;
export function loadAssets(corePlaces?: Resolved): Map<string, Resolved>;
export function assetProblem(a: Resolved | undefined): string | undefined;
export function resolveDomain(domain: Domain, o?: ResolveOptions): Resolved;
export function resolveStyle(o?: ResolveOptions): Resolved;
export function explainToken(res: Resolved, tokenPath: string): Resolved;
export function formatTable(res: Resolved): string;
export function parseArgs(argv: string[]): Resolved;
export function main(argv?: string[], out?: { write(s: string): unknown }, err?: { write(s: string): unknown }): number;
