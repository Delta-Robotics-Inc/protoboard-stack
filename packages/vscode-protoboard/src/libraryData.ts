/**
 * The project's part libraries as the Library view uses them. No VS Code API
 * here: the unit tests run it directly.
 *
 * - Which libraries, in which order, with which URL: the project's CLI says
 *   (`protoboard libraries --format json`), so the extension never reads
 *   protoboard.config.ts itself and agrees with `parts search|add` by
 *   construction. Personal libraries (the `protoboard.libraries` user
 *   setting) reach the CLI as PROTOBOARD_USER_LIBRARIES and come back last.
 * - Talking to them: the CLI's own library client code
 *   (`@protoboardai/core/library-client`, bundled), so search merging, cursors
 *   and error messages are the CLI's. Tokens are read from the environment
 *   variable a library names in `authEnv`; never stored.
 * - What the project already uses: parts/origins.json (the path the CLI
 *   reports), read directly.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { connectLibrary, libraryProblems, USER_LIBRARIES_ENV, type LibraryConnection, type LibraryEntry } from "@protoboardai/core/library-client";
import { parseJsonOutput, runCli, type CliCommand } from "./cli.js";

/** One library as `protoboard libraries --format json` lists it. */
export interface LibraryInfo {
  id: string;
  url: string;
  authEnv?: string;
  /** Listed in protoboard.config.ts. */
  declared: boolean;
  /** From the user's settings (PROTOBOARD_USER_LIBRARIES). */
  personal?: boolean;
  position: number;
  /** Vendored parts pinned to it. */
  pinned: string[];
}

export interface LibrariesListing {
  libraries: LibraryInfo[];
  /** parts/origins.json, project-relative. */
  origins: string;
}

/** A personal library in the `protoboard.libraries` user setting. */
export type PersonalLibrary = LibraryEntry & { url: string };

/** The personal libraries setting, checked: the valid entries, and what is wrong with the others. */
export function personalSetting(value: unknown): { libraries: PersonalLibrary[]; problems: string[] } {
  if (value === undefined || value === null) return { libraries: [], problems: [] };
  if (!Array.isArray(value)) return { libraries: [], problems: ["protoboard.libraries must be an array of { id, url, authEnv? }"] };
  const libraries: PersonalLibrary[] = [];
  const problems: string[] = [];
  for (const raw of value as unknown[]) {
    const e = (raw && typeof raw === "object" ? raw : {}) as LibraryEntry;
    const name = `protoboard.libraries (${JSON.stringify(e.id ?? raw)})`;
    const p = libraryProblems([raw]).map((m) => m.replace(/^libraries\[0\]/, name));
    if (!p.length && typeof e.url !== "string") p.push(`${name} needs a url`);
    if (!p.length && libraries.some((l) => l.id === e.id)) p.push(`${name} is listed twice`);
    if (p.length) problems.push(...p);
    else libraries.push({ id: e.id, url: e.url!.replace(/\/+$/, ""), ...(e.authEnv ? { authEnv: e.authEnv } : {}) });
  }
  return { libraries, problems };
}

/** The environment for the CLI: the process's, plus the personal libraries. */
export function cliEnv(personal: PersonalLibrary[], base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  if (personal.length) env[USER_LIBRARIES_ENV] = JSON.stringify(personal.map((l) => ({ id: l.id, url: l.url, ...(l.authEnv ? { authEnv: l.authEnv } : {}) })));
  else delete env[USER_LIBRARIES_ENV];
  return env;
}

/** `protoboard libraries --format json`. */
export async function listLibraries(cli: CliCommand, root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<LibrariesListing> {
  const r = await runCli(cli, ["libraries", "--format", "json"], { cwd: root, env, ...(signal ? { signal } : {}) });
  const out = parseJsonOutput<{ libraries: LibraryInfo[]; origins?: string }>(r, "protoboard libraries");
  return { libraries: out.libraries, origins: out.origins ?? "parts/origins.json" };
}

/** Clients for the libraries, in order. Tokens from `env` only. */
/** Clients for the libraries; `accountTokens` are the user's sign-ins (`protoboard login`, PB-911) by service URL. */
export function connect(libraries: LibraryInfo[], env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch, accountTokens?: ReadonlyMap<string, string>): LibraryConnection[] {
  return libraries.map((l) => connectLibrary(l, { env, ...(fetchImpl ? { fetch: fetchImpl } : {}), ...(accountTokens ? { accountTokens } : {}) }));
}

/** A part the project has vendored: the pinned revision and the library it came from. */
export interface Usage {
  revision?: number;
  library?: string;
  tier?: string;
  /** The vendored definition file, project-relative. */
  file?: string;
}

/** What the project uses, by part id, from parts/origins.json. */
export function readUsage(root: string, origins: string): Map<string, Usage> {
  const file = isAbsolute(origins) ? origins : join(root, origins);
  const out = new Map<string, Usage>();
  if (!existsSync(file)) return out;
  let data: { definitions?: Record<string, { revision?: unknown; library?: string; provider?: string; tier?: string; file?: string }> };
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return out;
  }
  for (const [id, rec] of Object.entries(data.definitions ?? {})) {
    const library = rec.library ?? (rec.provider === "protoboard-cloud" ? "protoboard" : undefined);
    out.set(id, {
      ...(typeof rec.revision === "number" ? { revision: rec.revision } : {}),
      ...(library ? { library } : {}),
      ...(rec.tier ? { tier: rec.tier } : {}),
      ...(rec.file ? { file: rec.file } : {}),
    });
  }
  return out;
}

/** CLI arguments for the Library's actions: the CLI does the vendoring, as it would in a terminal. */
export const addArgs = (partId: string, revision: number, library: string) => ["parts", "add", `${partId}@${revision}`, "--library", library, "--format", "json"];
export const updateArgs = (partId: string, revision: number, library: string) => ["parts", "update", partId, "--to", String(revision), "--library", library, "--format", "json"];

/** One line of `parts add|update --format json`. */
export interface AddResult {
  id: string;
  library?: string;
  revision?: number;
  status: "added" | "unchanged" | "restored" | "migrated" | "updated" | "conflict";
  requiredBy?: string;
  message?: string;
}

/** A library's answer that it needs a sign-in, or does not accept the one it was given (PB-1039): a cloud error's code. */
export function isSignInRefusal(e: unknown): boolean {
  const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  return code === "AUTH_REQUIRED" || code === "ACCOUNT_NOT_ALLOWED" || code === "FORBIDDEN";
}
