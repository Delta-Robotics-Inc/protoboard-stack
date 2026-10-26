/**
 * Part libraries (docs/specs/vscode-extension.md § 4.2): a project reads parts
 * from an ordered list of libraries that speak the open UHD library protocol
 * (`uhd-library/v1`), each with its own URL and optional credentials kept
 * outside project data. The first library that has a part id provides it,
 * unless a command names one (`--library`) or the part is already pinned to
 * one in parts/origins.json.
 *
 * `protoboard.config.ts`:
 *
 *   libraries: [
 *     { id: "protoboard" },                                             // Protoboard Cloud at the configured cloud URL
 *     { id: "acme", url: "https://parts.acme.example", authEnv: "PROTOBOARD_ACME_TOKEN" },
 *   ]
 *
 * Without `libraries`, the project uses the Protoboard library alone, at the
 * configured cloud URL (`--url`, PROTOBOARD_CLOUD_URL, `cloud.url`,
 * localhost). `authEnv` names the environment variable holding a library's
 * read token; the token itself is never written anywhere.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverLibrary, type Discovery } from "@protoboardai/cloud/client";
import { CONFIG_FILE, importTs, readOrigins } from "./load.js";
import { DEFAULT_LIBRARY_ID, connectLibrary, libraryProblems, personalLibraries, type AccountTokens, type LibraryConnection } from "./library-client.js";
import type { LibraryConfig, ProtoboardConfig } from "./types.js";
import { HOSTED_CLOUD_URL } from "./web-urls.js";

export {
  DEFAULT_LIBRARY_ID,
  USER_LIBRARIES_ENV,
  connectLibrary,
  libraryProblems,
  personalLibraries,
  withLibraryAdded,
  withLibraryMoved,
  withLibraryRemoved,
  type LibraryConnection,
} from "./library-client.js";
export const DEFAULT_CLOUD_URL = "http://localhost:8787";
/** The hosted Protoboard library: defined in web-urls.ts (where tokens may go), which nothing heavy is imported into. */
export { HOSTED_CLOUD_URL } from "./web-urls.js";
/** `provider` of a definition vendored from the Protoboard library. */
export const CLOUD_PROVIDER = "protoboard-cloud";
/** `provider` of a definition vendored from any other uhd-library/v1 library. */
export const LIBRARY_PROVIDER = "uhd-library";

/** The Protoboard library's URL: `--url`, then PROTOBOARD_CLOUD_URL, then its entry's url, then `cloud.url`, then localhost. */
export function cloudUrl(config?: ProtoboardConfig, override?: string, env: NodeJS.ProcessEnv = process.env, entryUrl?: string): string {
  return (override || env.PROTOBOARD_CLOUD_URL || entryUrl || config?.cloud?.url || DEFAULT_CLOUD_URL).replace(/\/+$/, "");
}

/**
 * Where an account command's service URL came from: `--url`,
 * PROTOBOARD_CLOUD_URL, the project's `cloud.url`, a project that sets none
 * (localhost, as its `parts` commands use), or no project at all (the hosted
 * library).
 */
export type AccountServiceSource =
  | "flag"
  | "environment"
  | "project"
  | "project-default"
  | "default"
  /** The project's configuration could not be loaded (its packages are not set up): `cloud.url` as written in the file. */
  | "project-file"
  /** The project's configuration could not be loaded and names no service that can be read: the service this machine is signed in to. */
  | "saved";

/**
 * The service `login`, `logout` and `whoami` talk to. Inside a project it is
 * the service the project's `parts` commands use (`cloudUrl`), so a sign-in
 * is for the library the project takes parts from. With no project there is
 * nothing to follow, and the person signing in is a user of the hosted
 * library (what `protoboard init` writes into a new project), not of a
 * development service on this machine: HOSTED_CLOUD_URL, not localhost.
 * `--url` and PROTOBOARD_CLOUD_URL win everywhere.
 */
export function accountService(config: ProtoboardConfig | undefined, options: { url?: string; env?: NodeJS.ProcessEnv; inProject: boolean }): { url: string; source: AccountServiceSource } {
  const env = options.env ?? process.env;
  const source: AccountServiceSource = options.url ? "flag" : env.PROTOBOARD_CLOUD_URL ? "environment" : config?.cloud?.url ? "project" : options.inProject ? "project-default" : "default";
  return { url: source === "default" ? HOSTED_CLOUD_URL : cloudUrl(config, options.url, env), source };
}

/**
 * `cloud.url` as it is written in a protoboard.config.ts, read from the text
 * without running the file: what a project names as its service when its
 * configuration cannot be loaded (no packages yet). Undefined when the file
 * has no literal URL there.
 */
export function cloudUrlInConfigText(text: string): string | undefined {
  // comments out first: the line `protoboard init` writes above the entry mentions localhost
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const m = /\bcloud\s*:\s*\{[^{}]*?\burl\s*:\s*(["'`])(https?:\/\/[^"'`\s$]+)\1/.exec(code);
  return m ? m[2]!.replace(/\/+$/, "") : undefined;
}

/**
 * The service of the account commands and of the sign-in check when a
 * project is there but its configuration cannot be loaded (first builds
 * review, item 23: a project without its packages sent the sign-in check to
 * localhost, and a signed-in person was told the service could not be
 * reached). A sign-in is the user's, not the project's: `--url` and
 * PROTOBOARD_CLOUD_URL as always, then the `cloud.url` the file names, then
 * the service this machine is signed in to (`saved`: the hosted library when
 * it is one of them), then the hosted library. Never localhost by default.
 */
export function unloadedProjectService(configText: string | undefined, options: { url?: string; env?: NodeJS.ProcessEnv; saved?: string[] }): { url: string; source: AccountServiceSource } {
  const env = options.env ?? process.env;
  if (options.url) return { url: cloudUrl(undefined, options.url, env), source: "flag" };
  if (env.PROTOBOARD_CLOUD_URL) return { url: cloudUrl(undefined, undefined, env), source: "environment" };
  const written = configText === undefined ? undefined : cloudUrlInConfigText(configText);
  if (written) return { url: written, source: "project-file" };
  const saved = (options.saved ?? []).map((s) => s.replace(/\/+$/, ""));
  if (saved.length) return { url: saved.includes(HOSTED_CLOUD_URL) ? HOSTED_CLOUD_URL : saved[0]!, source: "saved" };
  return { url: HOSTED_CLOUD_URL, source: "default" };
}

/**
 * What an account command says when its service does not answer: the URL
 * tried and what failed (`what`: the request and the error), why that URL
 * (`source`; `configFile` is the project's protoboard.config.ts), and how to
 * use another.
 */
export function unreachableService(service: string, what: string, source: AccountServiceSource, configFile?: string): string {
  const config = configFile ?? CONFIG_FILE;
  const elsewhere = "For another service, pass --url <url> or set PROTOBOARD_CLOUD_URL";
  const why: Record<AccountServiceSource, [string, string]> = {
    flag: ["That URL is the one given with --url.", "Check it, or leave --url out to use the default."],
    environment: ["That URL comes from the PROTOBOARD_CLOUD_URL environment variable.", "Check it, unset it to use the default, or pass --url <url>."],
    project: [
      `That URL is cloud.url in ${config}: the service this project takes its parts from.`,
      `${elsewhere} (${DEFAULT_CLOUD_URL} is a parts service started on this machine; ${HOSTED_CLOUD_URL} is the hosted Protoboard library).`,
    ],
    "project-default": [
      `${config} sets no cloud.url, so this is the default for a project without one: a parts service on this machine.`,
      `Start one, or for another service set cloud.url there, pass --url <url> or set PROTOBOARD_CLOUD_URL (the hosted Protoboard library is ${HOSTED_CLOUD_URL}).`,
    ],
    "project-file": [
      `That URL is cloud.url as written in ${config} (the file could not be loaded, so it was read as text): the service this project takes its parts from.`,
      `${elsewhere} (${HOSTED_CLOUD_URL} is the hosted Protoboard library).`,
    ],
    saved: [
      `${config} could not be loaded and names no service that can be read, so this is the service this machine is signed in to.`,
      `Check your connection. ${elsewhere}.`,
    ],
    default: [
      "That is the hosted Protoboard library: the default when there is no project here, no --url and no PROTOBOARD_CLOUD_URL.",
      `Check your connection. ${elsewhere} (${DEFAULT_CLOUD_URL} for a parts service on this machine); inside a project, its cloud.url is used.`,
    ],
  };
  return [`Cannot reach ${service} (${what}).`, ...why[source].map((l) => `  ${l}`)].join("\n");
}

/** A library as a project uses it: in order, with its URL resolved. */
export interface ResolvedLibrary {
  id: string;
  url: string;
  /** Environment variable holding its read token. */
  authEnv?: string;
  /** Listed in protoboard.config.ts (false: the implicit default, or a personal library). */
  declared: boolean;
  /** The user's own, from PROTOBOARD_USER_LIBRARIES (searched after the project's; not in protoboard.config.ts). */
  personal?: boolean;
}

/**
 * The project's libraries in order (the Protoboard library alone when the
 * config lists none), then the user's personal libraries
 * (PROTOBOARD_USER_LIBRARIES) unless `personal: false`.
 */
export function configuredLibraries(config?: ProtoboardConfig, options: { url?: string; env?: NodeJS.ProcessEnv; personal?: boolean } = {}): ResolvedLibrary[] {
  const env = options.env ?? process.env;
  const problems = libraryProblems(config?.libraries);
  if (problems.length) throw new Error(`${CONFIG_FILE}: ${problems.join("; ")}`);
  const project: ResolvedLibrary[] = !config?.libraries
    ? [{ id: DEFAULT_LIBRARY_ID, url: cloudUrl(config, options.url, env), declared: false }]
    : config.libraries.map((l) => ({
        id: l.id,
        url: l.id === DEFAULT_LIBRARY_ID ? cloudUrl(config, options.url, env, l.url) : l.url!.replace(/\/+$/, ""),
        ...(l.authEnv ? { authEnv: l.authEnv } : {}),
        declared: true,
      }));
  if (options.personal === false) return project;
  const mine = personalLibraries(env, project.map((l) => l.id)).libraries;
  return [...project, ...mine.map((l) => ({ ...l, declared: false, personal: true }))];
}

/** Clients for the project's libraries, in order. Tokens come from the environment, or the user's sign-in (`accountTokens`). */
export function connectLibraries(config?: ProtoboardConfig, options: { url?: string; fetch?: typeof fetch; env?: NodeJS.ProcessEnv; accountTokens?: AccountTokens } = {}): LibraryConnection[] {
  const env = options.env ?? process.env;
  return configuredLibraries(config, options).map((l) => connectLibrary(l, { env, ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.accountTokens ? { accountTokens: options.accountTokens } : {}) }));
}

// ---------------------------------------------------------------- the config file

/** The `libraries` list as it would be written: the declared one, or the implicit default. */
export function declaredLibraries(config: ProtoboardConfig): LibraryConfig[] {
  return config.libraries ? config.libraries.map((l) => ({ ...l })) : [{ id: DEFAULT_LIBRARY_ID }];
}

type Span = { start: number; end: number };

/**
 * Scan TypeScript source for the default-exported config object: the span of
 * its braces, and of the `libraries` member's value when present. Strings,
 * template literals and comments are skipped.
 */
export function findConfigObject(text: string, member = "libraries"): { object: Span; libraries?: { key: number; value: Span }; librariesNotArray?: boolean; indent: string } | undefined {
  const exp = /export\s+default\s+(?:defineConfig\s*\(\s*)?\{/.exec(text);
  if (!exp) return undefined;
  const open = exp.index + exp[0].length - 1;
  let depth = 0;
  let libraries: { key: number; value: Span } | undefined;
  let valueStart = -1;
  let notArray = false;
  let i = open;
  const skipString = (q: string) => {
    for (i++; i < text.length && text[i] !== q; i++) if (text[i] === "\\") i++;
  };
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") skipString(c);
    else if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i);
    else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) + 1;
    else if (c === "{" || c === "[" || c === "(") {
      depth++;
      if (depth === 2 && valueStart === -2) valueStart = i;
    } else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 1 && valueStart >= 0 && libraries) {
        libraries.value = { start: valueStart, end: i + 1 };
        valueStart = -1;
      }
      if (depth === 0) {
        const lines = text.slice(open + 1, i).split("\n").map((l) => /^(\s+)\S/.exec(l)?.[1]).filter((x): x is string => !!x);
        return { object: { start: open, end: i }, ...(libraries?.value.end ? { libraries } : {}), ...(notArray ? { librariesNotArray: true } : {}), indent: lines[0] ?? "  " };
      }
    } else if (depth === 1 && !libraries) {
      const m = new RegExp(`^${member}\\s*:\\s*`).exec(text.slice(i));
      if (m && /[\s,{]/.test(text[i - 1])) {
        libraries = { key: i, value: { start: -1, end: 0 } };
        i += m[0].length - 1;
        if (text[i + 1] === "[") valueStart = -2; // the next bracket opens the value
        else notArray = true;
      }
    }
  }
  return undefined;
}

const renderLibraries = (list: LibraryConfig[], indent: string) =>
  `libraries: [\n${list
    .map((l) => `${indent}${indent}{ ${[`id: ${JSON.stringify(l.id)}`, ...(l.url ? [`url: ${JSON.stringify(l.url)}`] : []), ...(l.authEnv ? [`authEnv: ${JSON.stringify(l.authEnv)}`] : [])].join(", ")} },`)
    .join("\n")}\n${indent}]`;

/**
 * Write `libraries` into protoboard.config.ts: replace the member's array,
 * or add the member at the end of the config object. The file is re-read
 * and checked; on any mismatch the original is restored.
 */
export async function writeLibraries(root: string, list: LibraryConfig[]): Promise<void> {
  const problems = libraryProblems(list);
  if (problems.length) throw new Error(problems.join("; "));
  if (!list.length) throw new Error("a project needs at least one library");
  const file = join(root, CONFIG_FILE);
  const before = readFileSync(file, "utf8");
  const found = findConfigObject(before);
  if (!found) throw new Error(`cannot find the config object in ${CONFIG_FILE} (expected \`export default defineConfig({ … })\`); edit \`libraries\` by hand`);
  if (found.librariesNotArray) throw new Error(`\`libraries\` in ${CONFIG_FILE} is not an array literal; edit it by hand`);
  let after: string;
  if (found.libraries) {
    after = before.slice(0, found.libraries.key) + renderLibraries(list, found.indent) + before.slice(found.libraries.value.end);
  } else {
    // add it as the object's last member
    let end = found.object.end;
    while (end > 0 && /\s/.test(before[end - 1])) end--;
    const comma = before[end - 1] === "," || before[end - 1] === "{" ? "" : ",";
    const member = `\n${found.indent}// part libraries in order: the first one that has a part id provides it (\`protoboard libraries\`)\n${found.indent}${renderLibraries(list, found.indent)},\n`;
    after = before.slice(0, end) + comma + member + before.slice(found.object.end);
  }
  writeFileSync(file, after);
  try {
    const mod = await importTs<{ default?: ProtoboardConfig }>(file, { fresh: true });
    const got = JSON.stringify(mod.default?.libraries);
    if (got !== JSON.stringify(list)) throw new Error(`the rewritten ${CONFIG_FILE} reads back as ${got}`);
  } catch (e) {
    writeFileSync(file, before);
    throw new Error(`could not update ${CONFIG_FILE}, left unchanged: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------- `protoboard libraries`

export interface LibraryListing extends ResolvedLibrary {
  position: number;
  /** Vendored parts pinned to it in parts/origins.json. */
  pinned: string[];
  /** With `check`: what its discovery document says, or why it could not be read. */
  discovery?: { name: string; version: string; protocol: string; api: string; auth: string; signIn?: true } | { error: string };
}

/**
 * What a library's reads need, in words: nothing, a Protoboard account (a
 * library whose discovery document names a sign-in, as the Protoboard library
 * does), or a token from the environment variable its `authEnv` names.
 */
export function readsNeed(d: { auth: string; signIn?: true }): string {
  if (d.auth === "none") return "reads open";
  return d.signIn ? "needs a Protoboard account" : "reads need a token";
}

/** Which library a vendored part is pinned to (records from before libraries: the Protoboard library). */
export const recordLibrary = (rec: { library?: string; provider?: string }): string | undefined => rec.library ?? (rec.provider === CLOUD_PROVIDER ? DEFAULT_LIBRARY_ID : undefined);

export async function listLibraries(root: string, config: ProtoboardConfig, options: { check?: boolean; url?: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<LibraryListing[]> {
  const origins = readOrigins(root, config.catalog);
  const libs = configuredLibraries(config, options);
  return Promise.all(
    libs.map(async (l, i) => {
      const pinned = Object.entries(origins.definitions)
        .filter(([, rec]) => recordLibrary(rec) === l.id)
        .map(([id]) => id)
        .sort();
      const out: LibraryListing = { ...l, position: i + 1, pinned };
      if (options.check) {
        try {
          const where = await discoverLibrary(l.url, options.fetch ? { fetch: options.fetch } : {});
          const d: Discovery | undefined = where.document;
          out.discovery = d
            ? { name: d.name, version: d.version, protocol: d.protocol, api: where.api, auth: d.auth.read, ...(d.auth.read !== "none" && d.account ? { signIn: true as const } : {}) }
            : { error: `no uhd-library/v1 discovery document at ${l.url}/.well-known/uhd-library or ${l.url}/v1` };
        } catch (e) {
          out.discovery = { error: (e as Error).message };
        }
      }
      return out;
    }),
  );
}

export { discoverLibrary };

/** The project's config file exists (for messages). */
export const hasConfig = (root: string) => existsSync(join(root, CONFIG_FILE));
