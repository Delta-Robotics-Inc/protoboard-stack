/**
 * Talking to part libraries (docs/specs/vscode-extension.md § 4.2), with no
 * project loading and no file system: the CLI's `parts` and `libraries`
 * commands use this module, and the VS Code extension bundles it, so both
 * read the same libraries the same way (one merge, one cursor, one error
 * text).
 *
 * - A library list in the config: its rules (`libraryProblems`) and its edits
 *   (`withLibraryAdded|Removed|Moved`).
 * - Personal libraries: `PROTOBOARD_USER_LIBRARIES` (a JSON array of
 *   `{ id, url, authEnv? }`), searched after the project's; the VS Code
 *   extension passes its user setting this way.
 * - A client per library (`connectLibrary`): tokens come from the
 *   environment only.
 * - Search across libraries (`searchLibraries`): merged results with their
 *   library, one cursor over every library, facets summed; `sort` is passed
 *   to each library that declares it.
 * - Prices by source for one part (`partPrices`): the library's offers,
 *   grouped by supplier.
 * - The taxonomy across libraries (`libraryTaxonomy`): trees merged by path,
 *   counts summed.
 */
import { LIBRARY_SORTS, isLibrarySort, type LibrarySort } from "./library-sort.js";
import { CloudError, PartsClient, discoverLibrary, type PartSummary, type PublicOffer, type SearchFacets, type SearchQuery, type TaxonomyResult, type TaxonomyTreeNode } from "@protoboardai/cloud/client";

import { cloudTokenAllowed, isAuthEnvName, isLoopbackHost, tokenTransportProblem } from "./web-urls.js";

/** Whether a URL is a service on this machine (one that someone starts), not one reached over the network. */
const onThisMachine = (url: string): boolean => {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** The Protoboard Cloud parts library's id; its URL is the configured cloud URL. */
export const DEFAULT_LIBRARY_ID = "protoboard";
/** Environment variable with the user's personal libraries (JSON array of `{ id, url, authEnv? }`). */
export const USER_LIBRARIES_ENV = "PROTOBOARD_USER_LIBRARIES";

export const LIBRARY_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** One library in a list: `libraries` in protoboard.config.ts, or a personal one. */
export interface LibraryEntry {
  id: string;
  url?: string;
  authEnv?: string;
}

// ---------------------------------------------------------------- a list's rules and edits

/** Problems with a `libraries` list, as messages. */
export function libraryProblems(list: unknown): string[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return ["libraries must be an array of { id, url, authEnv? }"];
  const out: string[] = [];
  const seen = new Set<string>();
  list.forEach((l, i) => {
    const at = `libraries[${i}]`;
    if (!l || typeof l !== "object") return out.push(`${at} must be { id, url, authEnv? }`);
    const { id, url, authEnv, ...rest } = l as Record<string, unknown>;
    if (typeof id !== "string" || !LIBRARY_ID.test(id)) out.push(`${at}.id must be lower-case letters, digits, '-' or '_' (got ${JSON.stringify(id)})`);
    else if (seen.has(id)) out.push(`${at}.id "${id}" is listed twice`);
    else seen.add(id);
    if (url === undefined) {
      if (id !== DEFAULT_LIBRARY_ID) out.push(`${at} (${String(id)}) needs a url; only "${DEFAULT_LIBRARY_ID}" defaults to the configured cloud URL`);
    } else out.push(...urlProblems(url).map((m) => `${at}.url ${m}`));
    if (authEnv !== undefined && !isAuthEnvName(authEnv))
      out.push(
        typeof authEnv === "string" && ENV_NAME.test(authEnv)
          ? `${at}.authEnv must be named PROTOBOARD_<NAME>_TOKEN (not PROTOBOARD_CLOUD_TOKEN), so a project cannot send another of your environment variables to a library (got ${authEnv})`
          : `${at}.authEnv must name an environment variable PROTOBOARD_<NAME>_TOKEN, never hold a token`,
      );
    for (const k of Object.keys(rest)) out.push(`${at}.${k} is not a library setting (id, url, authEnv)`);
  });
  return out;
}

/** Why a library URL cannot be used (empty: it can). */
export function urlProblems(url: unknown): string[] {
  if (typeof url !== "string") return ["must be a string"];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [`"${url}" is not a URL`];
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return [`"${url}" is not http(s)`];
  if (u.username || u.password) return ["must not carry credentials; name an environment variable in authEnv instead"];
  return [];
}

/** `libraries add`: append a library (lowest priority), or insert it at `position` (1 = first). */
export function withLibraryAdded<T extends LibraryEntry>(list: T[], lib: T, position?: number): T[] {
  if (list.some((l) => l.id === lib.id)) throw new Error(`a library "${lib.id}" is already configured (\`protoboard libraries remove ${lib.id}\` first)`);
  const problems = libraryProblems([lib]);
  if (problems.length) throw new Error(problems.join("; ").replace(/libraries\[0\]/g, lib.id ?? "library"));
  const out = [...list];
  out.splice(position === undefined ? out.length : Math.max(0, Math.min(out.length, position - 1)), 0, lib);
  return out;
}

export function withLibraryRemoved<T extends LibraryEntry>(list: T[], id: string, options: { allowEmpty?: boolean } = {}): T[] {
  if (!list.some((l) => l.id === id)) throw new Error(`no library "${id}" (configured: ${list.map((l) => l.id).join(", ") || "none"})`);
  if (list.length === 1 && !options.allowEmpty) throw new Error(`"${id}" is the only library; add another before removing it`);
  return list.filter((l) => l.id !== id);
}

/** `libraries move <id> <position|first|last|up|down>`. */
export function withLibraryMoved<T extends LibraryEntry>(list: T[], id: string, to: string): T[] {
  const from = list.findIndex((l) => l.id === id);
  if (from < 0) throw new Error(`no library "${id}" (configured: ${list.map((l) => l.id).join(", ")})`);
  const target = to === "first" ? 0 : to === "last" ? list.length - 1 : to === "up" ? from - 1 : to === "down" ? from + 1 : /^[1-9]\d*$/.test(to) ? Number(to) - 1 : NaN;
  if (Number.isNaN(target)) throw new Error(`move to a position (1..${list.length}), first, last, up or down; not "${to}"`);
  const out = [...list];
  const [lib] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(list.length - 1, target)), 0, lib);
  return out;
}

/**
 * The user's personal libraries from `PROTOBOARD_USER_LIBRARIES`, after the
 * project's: an id the project already uses is the project's, so it is left
 * out (and said so). Each needs a url; tokens come from `authEnv` as usual.
 */
export function personalLibraries(env: NodeJS.ProcessEnv = process.env, projectIds: readonly string[] = []): { libraries: { id: string; url: string; authEnv?: string }[]; skipped: string[] } {
  const raw = env[USER_LIBRARIES_ENV]?.trim();
  if (!raw) return { libraries: [], skipped: [] };
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new Error(`${USER_LIBRARIES_ENV} is not JSON (expected [{ "id": …, "url": … }])`);
  }
  const problems = libraryProblems(list).concat(Array.isArray(list) ? list.flatMap((l, i) => (l && typeof l === "object" && (l as LibraryEntry).url === undefined && (l as LibraryEntry).id === DEFAULT_LIBRARY_ID ? [`libraries[${i}] needs a url`] : [])) : []);
  if (problems.length) throw new Error(`${USER_LIBRARIES_ENV}: ${problems.join("; ")}`);
  const skipped: string[] = [];
  const libraries = (list as LibraryEntry[]).flatMap((l) => {
    if (projectIds.includes(l.id)) {
      skipped.push(l.id);
      return [];
    }
    return [{ id: l.id, url: l.url!.replace(/\/+$/, ""), ...(l.authEnv ? { authEnv: l.authEnv } : {}) }];
  });
  return { libraries, skipped };
}

export { LIBRARY_SORTS, compareHits, isLibrarySort, localSorts, type LibrarySort } from "./library-sort.js";

// ---------------------------------------------------------------- clients and errors

/** A client for one library. */
export interface LibraryConnection {
  /** Library id ("protoboard" for Protoboard Cloud). */
  id: string;
  client: PartsClient;
  url: string;
  /** A publish token was found in PROTOBOARD_CLOUD_TOKEN (Protoboard library only). */
  canPublish: boolean;
  /** Environment variable for its read token, and whether it is set. */
  authEnv?: string;
  hasToken?: boolean;
  /** The user is signed in to this service (`protoboard login`) and its token is sent. */
  signedIn?: boolean;
  /** The orders the library sorts a search by itself (`librarySorts`): asked once, from its discovery document. */
  sorts?: () => Promise<readonly LibrarySort[]>;
}

// ---------------------------------------------------------------- sorting (beta test 1, F14; the orders themselves: library-sort.ts)

/**
 * The orders a library sorts by itself, from its discovery document: the
 * `sort.values` it lists with capability `x-sort` (all four when it names
 * the capability without listing values). None when the library does not
 * say so or cannot be reached: a library without the capability ignores the
 * `sort` parameter, and the client then orders what it has loaded.
 */
export async function librarySorts(url: string, options: { fetch?: typeof fetch } = {}): Promise<readonly LibrarySort[]> {
  try {
    const doc = (await discoverLibrary(url, options)).document as ({ capabilities?: unknown; sort?: { values?: unknown } } | undefined);
    if (!doc || !Array.isArray(doc.capabilities) || !doc.capabilities.includes("x-sort")) return [];
    const values = Array.isArray(doc.sort?.values) ? doc.sort.values.filter(isLibrarySort) : [];
    return values.length ? values : LIBRARY_SORTS;
  } catch {
    return [];
  }
}

/** Signed-in users' ID tokens by service URL (`serviceKey`), from `accountTokensFor` (account.ts). */
export type AccountTokens = ReadonlyMap<string, string>;

/**
 * A client for one library. Tokens come from the environment, or from the
 * user's sign-in to that service (`accountTokens`, PB-911): its ID token is
 * the read token when no `authEnv` gives one, and the Protoboard library's
 * publish token when PROTOBOARD_CLOUD_TOKEN is not set (the service decides
 * whether the user may publish).
 */
export function connectLibrary(l: { id: string; url: string; authEnv?: string }, options: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; accountTokens?: AccountTokens } = {}): LibraryConnection {
  const env = options.env ?? process.env;
  // no token over plain http to another machine, and the service token to its own origins only (web-urls.ts, PB-1048)
  const sends = !tokenTransportProblem(l.url);
  const account = sends ? options.accountTokens?.get(l.url.trim().replace(/\/+$/, "").replace(/\/v1$/, "")) : undefined;
  const envRead = sends && isAuthEnvName(l.authEnv) ? env[l.authEnv] || undefined : undefined;
  const readToken = envRead ?? account;
  const serviceToken = l.id === DEFAULT_LIBRARY_ID && cloudTokenAllowed(l.url, env) ? env.PROTOBOARD_CLOUD_TOKEN || undefined : undefined;
  const token = serviceToken ?? (l.id === DEFAULT_LIBRARY_ID ? account : undefined);
  const client = new PartsClient({ baseUrl: l.url, discover: true, ...(token ? { token } : {}), ...(readToken ? { readToken } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) });
  let sorts: Promise<readonly LibrarySort[]> | undefined;
  return { id: l.id, client, url: l.url, sorts: () => (sorts ??= librarySorts(l.url, options.fetch ? { fetch: options.fetch } : {})), canPublish: !!token, ...(account ? { signedIn: true } : {}), ...(l.authEnv ? { authEnv: l.authEnv, hasToken: !!envRead } : {}) };
}

/** A parts command that could not do what was asked; `code` is the service's or the client's. */
export class PartsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PartsError";
  }
}

const isDefault = (lib: { id?: string }) => (lib.id ?? DEFAULT_LIBRARY_ID) === DEFAULT_LIBRARY_ID;
/** The refusal asks for a Protoboard account (the service signs users in), not a library token. */
const signsIn = (e: CloudError) => /protoboard login|signed-in/i.test(e.message);

/**
 * Turn a client failure into a message that says what to do. `lib` is the
 * library the call went to (a bare URL means the Protoboard library).
 */
export function explainCloudError(e: unknown, lib: string | { id?: string; url: string; authEnv?: string; hasToken?: boolean; signedIn?: boolean }, ref?: string, options: { publishing?: boolean } = {}): Error {
  if (e instanceof PartsError || !(e instanceof CloudError)) return e as Error;
  const l = typeof lib === "string" ? { id: DEFAULT_LIBRARY_ID, url: lib } : lib;
  const url = l.url;
  const what = ref ? `${ref}: ` : "";
  const where = isDefault(l) ? `the catalog at ${url}` : `library ${l.id} at ${url}`;
  switch (e.code) {
    case "NETWORK":
      return new PartsError(
        e.code,
        isDefault(l)
          ? onThisMachine(url)
            ? `cannot reach the Protoboard Cloud parts service at ${url} (${e.message.replace(/^.*?: /, "")}). Start it, or point PROTOBOARD_CLOUD_URL (or cloud.url in protoboard.config.ts) at it. Loading, checking and building do not need the service.`
            : `cannot reach the Protoboard library at ${url} (${e.message.replace(/^.*?: /, "")}). Check your connection, or point PROTOBOARD_CLOUD_URL (or cloud.url in protoboard.config.ts) at another service. Loading, checking and building do not need the service.`
          : `cannot reach library ${l.id} at ${url} (${e.message.replace(/^.*?: /, "")}). Check its url in protoboard.config.ts (\`protoboard libraries list --check\`). Loading, checking and building do not need it.`,
      );
    case "PART_NOT_FOUND":
      return new PartsError(e.code, `${what}not in ${where} (\`protoboard parts search\` lists what is)`);
    case "REVISION_NOT_FOUND":
      return new PartsError(e.code, `${what}no such revision at ${url} (${e.message})`);
    case "ACCOUNT_NOT_ALLOWED":
      // signed in, but the service is limited to invited accounts (PB-915): its message says what to do
      return new PartsError(e.code, `${what}${where} refused access: ${e.message}`);
    case "AUTH_REQUIRED":
    case "FORBIDDEN":
    case "PUBLISH_DISABLED":
      if (options.publishing || e.code === "PUBLISH_DISABLED")
        return new PartsError(e.code, `${what}the service refused to publish (${e.code}: ${e.message}). Publishing needs the service's token in PROTOBOARD_CLOUD_TOKEN; it is never stored in the project.`);
      return new PartsError(
        e.code,
        `${what}${where} refused access (${e.code}: ${e.message}). ${
          l.authEnv
            ? `Its token comes from $${l.authEnv}, which is ${l.hasToken ? "set but was not accepted" : "not set"}.`
            : signsIn(e)
              ? l.signedIn
                ? `You are signed in, but the service did not accept the sign-in: run \`protoboard login${isDefault(l) ? "" : ` --url ${url}`}\` again.`
                : `Sign in first: \`protoboard login${isDefault(l) ? "" : ` --url ${url}`}\` (or \`protoboard login --device\` from an agent or a machine without a browser). Everything in the Protoboard library, searching included, needs an account.`
              : `Name the environment variable that holds its token in its authEnv (\`protoboard libraries add ${l.id} ${url} --auth-env <NAME>\`); the token itself is never written to the project.`
        }`,
      );
    case "INTEGRITY":
      return new PartsError(e.code, `${what}downloaded data failed verification, so nothing was written: ${e.message}`);
    default:
      return new PartsError(e.code, `${what}${e.code}: ${e.message}${e.details.problems ? `\n${JSON.stringify(e.details.problems, null, 2)}` : ""}`);
  }
}

// ---------------------------------------------------------------- search

/**
 * What a search needs of a library: its id, its URL (for messages) and a
 * client. The orders it declares (`x-sort`) come from `sorts` when the
 * connection has it, else from the client's own `sorts()` when it can tell.
 */
export type SearchableLibrary = Pick<LibraryConnection, "id" | "url" | "authEnv" | "hasToken" | "sorts"> & { client: Pick<PartsClient, "search" | "getTaxonomy"> & Partial<Pick<PartsClient, "sorts">> };

/** A search result with the library it comes from. */
export interface LibraryHit extends PartSummary {
  library: string;
  /** An earlier library has the same part id, so `parts add <id>` takes that one unless told otherwise. */
  shadowedBy?: string;
  /** The part's relevance in its library, when the library ranks (protoboard-cloud's `x-sort`); higher first. */
  relevance?: number;
}

export interface LibrariesSearch {
  /** Matches across every library that answered. */
  total: number;
  /**
   * The page's hits (`LibraryHit.relevance` is the library's value, when it
   * ranks). Their order:
   * - `sort: "name"` or `"manufacturer"`: by that, over the page (several
   *   libraries' pages merged; one library's page is as it gave it).
   * - otherwise, when a library ranks (it declares `x-sort`): each library's
   *   own order, the libraries one after another in their configured order.
   * - when none does: by part id, then library order (as before sorting).
   */
  parts: LibraryHit[];
  /** `sorted`: the library declares the order asked for and was sent it; false when it was asked without (its own order). */
  libraries: { id: string; url: string; total?: number; returned?: number; nextCursor?: string | null; error?: string; sorted?: boolean }[];
  /** The order asked for, when one was. */
  sort?: LibrarySort;
  /** The order asked for, when every library asked sorts by it: `parts` is in that order across pages. Absent: at least one library kept its own order, and a view orders what it has loaded. */
  sorted?: LibrarySort;
  /** The orders every library asked sorts by itself (what a control can offer without sorting locally). */
  sorts: LibrarySort[];
  /** The next page over every library that has more (`cursor` of the next search); null on the last page. */
  nextCursor: string | null;
  /** With `facets`: counts summed over the libraries that answered. */
  facets?: SearchFacets;
}

/** A search across libraries: a library protocol query (with `sort`, for the libraries that take it), and the cursor of the previous page. */
export type LibrariesQuery = Omit<SearchQuery, "cursor" | "offset" | "sort"> & { cursor?: string | null; sort?: LibrarySort };

/** The orders a library declares (`x-sort`); none for a library that does not, or whose client cannot tell. */
async function sortsOf(lib: SearchableLibrary): Promise<readonly LibrarySort[]> {
  try {
    if (lib.sorts) return await lib.sorts();
    return ((await lib.client.sorts?.())?.values ?? []).filter(isLibrarySort);
  } catch {
    return [];
  }
}

const CURSOR_PREFIX = "libs.";

/** One cursor over several libraries: each library's own cursor, by id (libraries done are left out). */
export function encodeLibrariesCursor(cursors: Record<string, string>): string | null {
  return Object.keys(cursors).length ? CURSOR_PREFIX + Buffer.from(JSON.stringify(cursors)).toString("base64url") : null;
}

export function decodeLibrariesCursor(cursor: string): Record<string, string> {
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new PartsError("BAD_CURSOR", `not a cursor of \`parts search\`: ${cursor}`);
  try {
    const v = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8")) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string")) return v as Record<string, string>;
  } catch {
    // reported below
  }
  throw new PartsError("BAD_CURSOR", `not a cursor of \`parts search\`: ${cursor}`);
}

/** Mark hits whose id an earlier library (in `order`) also has, over every hit given (a page, or every page loaded so far). */
export function markShadowed<T extends { partId: string; library: string; shadowedBy?: string }>(hits: T[], order: readonly string[]): T[] {
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const first = new Map<string, string>();
  for (const h of hits) {
    const seen = first.get(h.partId);
    if (seen === undefined || rank(h.library) < rank(seen)) first.set(h.partId, h.library);
  }
  return hits.map((h) => {
    const by = first.get(h.partId)!;
    const { shadowedBy: _drop, ...rest } = h;
    return (by !== h.library ? { ...rest, shadowedBy: by } : rest) as T;
  });
}

/** Facet counts summed. */
export function mergeFacets(list: (SearchFacets | undefined)[]): SearchFacets | undefined {
  const present = list.filter((f): f is SearchFacets => !!f);
  if (!present.length) return undefined;
  const out: SearchFacets = { taxonomy: {}, domain: {}, protocol: {}, tag: {}, categories: {} };
  for (const f of present)
    for (const k of Object.keys(out) as (keyof SearchFacets)[]) for (const [v, n] of Object.entries(f[k] ?? {})) out[k][v] = (out[k][v] ?? 0) + n;
  return out;
}

/**
 * Search every library with the same query and merge the results. A library
 * that fails is reported with its error and the others still answer; when
 * every library fails, the first failure is thrown. With `cursor` (the
 * previous result's `nextCursor`), only the libraries that have more are
 * asked, each from its own cursor.
 */
export async function searchLibraries(libs: SearchableLibrary | SearchableLibrary[], query: LibrariesQuery = {}): Promise<LibrariesSearch> {
  const list = Array.isArray(libs) ? libs : [libs];
  if (!list.length) throw new PartsError("NO_LIBRARIES", "no libraries are configured (protoboard.config.ts `libraries`)");
  const { cursor, sort, ...rest } = query;
  if (sort !== undefined && !isLibrarySort(sort)) throw new PartsError("BAD_SORT", `sort is one of ${LIBRARY_SORTS.join(", ")}; not "${String(sort)}"`);
  const cursors = cursor ? decodeLibrariesCursor(cursor) : undefined;
  const asked = cursors ? list.filter((l) => cursors[l.id] !== undefined) : list;
  // `sort` goes only to a library that declares it (x-sort): another keeps its own order, and is told nothing it might refuse
  const declared = new Map(await Promise.all(asked.map(async (lib) => [lib.id, await sortsOf(lib)] as const)));
  const sends = (lib: SearchableLibrary) => sort !== undefined && declared.get(lib.id)!.includes(sort);
  const answers = await Promise.all(
    asked.map((lib) =>
      lib.client.search({ ...rest, ...(sends(lib) ? { sort } : {}), ...(cursors ? { cursor: cursors[lib.id] } : {}) }).then(
        (r) => ({ lib, r }),
        (e: unknown) => ({ lib, error: explainCloudError(e, lib) }),
      ),
    ),
  );
  const failed = answers.filter((a): a is { lib: SearchableLibrary; error: Error } => "error" in a);
  if (asked.length && failed.length === asked.length) throw failed[0].error;
  const order = list.map((l) => l.id);
  const hits: LibraryHit[] = answers.flatMap((a) => ("r" in a ? a.r.parts.map((x) => ({ ...x, library: a.lib.id })) : []));
  const byLibrary = (a: LibraryHit, b: LibraryHit) => order.indexOf(a.library) - order.indexOf(b.library);
  // compared as a library's own index does (lower case, by code unit), so merging two sorted pages keeps each one's order
  const text = (v: string | undefined) => (v ?? "").toLowerCase();
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const several = answers.filter((a) => "r" in a).length > 1;
  if (sort === "name" && several) hits.sort((a, b) => cmp(text(a.name), text(b.name)) || cmp(a.partId, b.partId) || byLibrary(a, b));
  else if (sort === "manufacturer" && several) hits.sort((a, b) => Number(!a.manufacturer) - Number(!b.manufacturer) || cmp(text(a.manufacturer), text(b.manufacturer)) || cmp(text(a.name), text(b.name)) || cmp(a.partId, b.partId) || byLibrary(a, b));
  // a library that ranks gave its page in order (relevance by default): kept, the libraries one after another (flatMap's order)
  else if (!asked.some((lib) => declared.get(lib.id)!.length)) hits.sort((a, b) => a.partId.localeCompare(b.partId) || byLibrary(a, b));
  // what every library asked sorts by itself; a library that does not say sorts nothing
  const sorts = LIBRARY_SORTS.filter((s) => asked.length > 0 && asked.every((lib) => declared.get(lib.id)!.includes(s)));
  const sorted = sort !== undefined && sorts.includes(sort) ? sort : undefined;
  const next: Record<string, string> = {};
  for (const a of answers) if ("r" in a && a.r.nextCursor) next[a.lib.id] = a.r.nextCursor;
  const facets = query.facets ? mergeFacets(answers.map((a) => ("r" in a ? a.r.facets : undefined))) : undefined;
  return {
    total: answers.reduce((n, a) => n + ("r" in a ? a.r.total : 0), 0),
    parts: markShadowed(hits, order),
    libraries: answers.map((a) =>
      "r" in a ? { id: a.lib.id, url: a.lib.url, total: a.r.total, returned: a.r.parts.length, nextCursor: a.r.nextCursor ?? null, ...(sort !== undefined ? { sorted: sends(a.lib) } : {}) } : { id: a.lib.id, url: a.lib.url, error: a.error.message },
    ),
    ...(sorted ? { sorted } : {}),
    sorts,
    nextCursor: encodeLibrariesCursor(next),
    ...(sort !== undefined ? { sort } : {}),
    ...(facets ? { facets } : {}),
  };
}

// ---------------------------------------------------------------- prices by source

/** One price a supplier lists for a part: the result, as the library serves it (nothing about how it was fetched). */
export type PartPrice = Omit<PublicOffer, "id" | "partId" | "supplier">;

/** A supplier's current prices for a part. */
export interface PriceSource {
  supplier: string;
  /** A franchised distributor or the manufacturer's own store, when the library knows. */
  authorized?: boolean;
  /** The lowest price per piece among its offers that are not stale, with its currency (prices are never converted). */
  from?: { unitPrice: number; currency: string };
  /** When its newest offer was observed. */
  observedAt: string;
  /** Its offers, one per ordering code and supplier code (the newest observation of each), newest first. */
  offers: PartPrice[];
}

export interface PartPrices {
  partId: string;
  /** By supplier: those with a current price first (lowest first within a currency), then by name. */
  sources: PriceSource[];
  /** Offers the library holds for the part (older observations of the same listing included). */
  offers: number;
  /** Why there are no prices to show: not signed in, not invited, or the library has no price service. */
  unavailable?: { code: string; message: string };
}

/** A part's offers grouped by supplier: per supplier the newest observation of each listing. */
export function pricesBySource(partId: string, offers: readonly PublicOffer[]): PartPrices {
  const bySupplier = new Map<string, PublicOffer[]>();
  for (const o of [...offers].sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0))) {
    const list = bySupplier.get(o.supplier) ?? [];
    // one listing: the same ordering code under the same supplier code; an older observation of it is superseded
    if (!list.some((x) => x.mpn.toUpperCase() === o.mpn.toUpperCase() && (x.sku ?? "") === (o.sku ?? ""))) list.push(o);
    bySupplier.set(o.supplier, list);
  }
  const sources: PriceSource[] = [...bySupplier].map(([supplier, list]) => {
    const priced = list.filter((o) => !o.stale && o.unitPrice !== undefined && o.currency).sort((a, b) => a.unitPrice! - b.unitPrice!);
    const authorized = list.find((o) => o.authorized !== undefined)?.authorized;
    return {
      supplier,
      ...(authorized !== undefined ? { authorized } : {}),
      ...(priced[0] ? { from: { unitPrice: priced[0].unitPrice!, currency: priced[0].currency! } } : {}),
      observedAt: list[0].observedAt,
      offers: list.map(({ id: _id, partId: _part, supplier: _s, ...rest }) => rest),
    };
  });
  sources.sort((a, b) => Number(!a.from) - Number(!b.from) || (a.from && b.from && a.from.currency === b.from.currency ? a.from.unitPrice - b.from.unitPrice : 0) || a.supplier.localeCompare(b.supplier));
  return { partId, sources, offers: offers.length };
}

/**
 * Prices by source for one part, for a part's detail: the offers the
 * Protoboard library serves a signed-in user, grouped by supplier. Offers
 * are the Protoboard Cloud service's, not part of the library protocol:
 * another library answers "no price service". A refusal (signed out, not
 * invited) is returned in `unavailable` with what to do, not thrown, so a
 * detail shows it in place of the prices.
 */
export async function partPrices(lib: Pick<LibraryConnection, "id" | "url" | "authEnv" | "hasToken" | "signedIn"> & { client: Pick<PartsClient, "listOffers"> }, partId: string, options: { mpn?: string } = {}): Promise<PartPrices> {
  try {
    return pricesBySource(partId, await lib.client.listOffers(partId, options.mpn ? { mpn: options.mpn } : {}));
  } catch (e) {
    if (!(e instanceof CloudError) || e.code === "NETWORK" || e.code === "PART_NOT_FOUND") throw explainCloudError(e, lib, partId);
    const noService = e.status === 404 || e.code.startsWith("HTTP_");
    return { partId, sources: [], offers: 0, unavailable: { code: noService ? "NO_PRICES" : e.code, message: noService ? `library ${lib.id} has no price service` : explainCloudError(e, lib, partId).message } };
  }
}

// ---------------------------------------------------------------- taxonomy

/** A taxonomy node over several libraries: counts summed, `libraries` that define it. */
export interface MergedTaxonomyNode {
  id: string;
  path: string;
  name: string;
  description?: string;
  count: number;
  /** Where the node is defined: the taxonomy id ("uhd") or an extending library. */
  source: string;
  children: MergedTaxonomyNode[];
}

export interface LibrariesTaxonomy {
  nodes: MergedTaxonomyNode[];
  /** Parts counted, over the libraries that answered. */
  total: number;
  uncategorised: number;
  /** Category paths parts use that no library's taxonomy has. */
  unknown: { path: string; count: number }[];
  libraries: { id: string; taxonomy?: { id: string; version: string }; error?: string }[];
}

/** Trees merged by path: a node's name and description from the first library that has it, counts summed. */
export function mergeTaxonomyTrees(trees: TaxonomyTreeNode[][]): MergedTaxonomyNode[] {
  const merge = (into: MergedTaxonomyNode[], nodes: TaxonomyTreeNode[]) => {
    for (const n of nodes) {
      let m = into.find((x) => x.path === n.path);
      if (!m) {
        m = { id: n.id, path: n.path, name: n.name, ...(n.description ? { description: n.description } : {}), count: 0, source: n.source, children: [] };
        into.push(m);
      }
      m.count += n.count;
      merge(m.children, n.children ?? []);
    }
  };
  const out: MergedTaxonomyNode[] = [];
  for (const t of trees) merge(out, t);
  return out;
}

/**
 * The taxonomy of every library, with part counts over the query's filters
 * (`GET /v1/taxonomy`; the taxonomy filter is not applied, so a drill-down
 * shows siblings and children alike). A library without the taxonomy route
 * is reported, and the others still answer.
 */
export async function libraryTaxonomy(libs: SearchableLibrary[], query: Pick<SearchQuery, "q" | "domain" | "protocol" | "tag" | "includeDeprecated"> = {}): Promise<LibrariesTaxonomy> {
  const answers = await Promise.all(
    libs.map((lib) =>
      lib.client.getTaxonomy(query).then(
        (r: TaxonomyResult) => ({ lib, r }),
        (e: unknown) => ({ lib, error: explainCloudError(e, lib) }),
      ),
    ),
  );
  const ok = answers.filter((a): a is { lib: SearchableLibrary; r: TaxonomyResult } => "r" in a);
  const unknown = new Map<string, number>();
  for (const a of ok) for (const u of a.r.unknown ?? []) unknown.set(u.path, (unknown.get(u.path) ?? 0) + u.count);
  return {
    nodes: mergeTaxonomyTrees(ok.map((a) => a.r.nodes)),
    total: ok.reduce((n, a) => n + a.r.total, 0),
    uncategorised: ok.reduce((n, a) => n + (a.r.uncategorised ?? 0), 0),
    unknown: [...unknown].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path)),
    libraries: answers.map((a) => ("r" in a ? { id: a.lib.id, taxonomy: { id: a.r.taxonomy.id, version: a.r.taxonomy.version } } : { id: a.lib.id, error: a.error.message })),
  };
}
