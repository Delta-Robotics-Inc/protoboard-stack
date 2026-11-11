/**
 * The two network sources of the update check (PB-1168), and nothing else:
 *
 *   - the npm registry, `GET https://registry.npmjs.org/-/package/<name>/dist-tags`
 *     for every installed @protoboardai / @deltarobotics package (latest and
 *     the other dist-tags);
 *   - OSV.dev, `POST https://api.osv.dev/v1/querybatch` with
 *     `{ queries: [{ package: { ecosystem, name }, version }] }` for the npm
 *     dependency set and the Python runtime packages (OSV answers with ids
 *     only: "Returns vulnerability ids and modified field only",
 *     google.github.io/osv.dev/post-v1-querybatch/), then
 *     `GET https://api.osv.dev/v1/vulns/<id>` for the summary, severity and
 *     fixed versions of at most MAX_VULN_DETAILS ids.
 *
 * DEFAULT (overnight build, plan.md): network only to registry.npmjs.org and
 * api.osv.dev (any other host is refused before a request is made), 10 s per
 * request, every response body read as a stream and cut at a size cap. What
 * is sent: package names and versions, and a user-agent naming the check and
 * the stack version. Never project names, paths or tokens.
 *
 * The request shapes are written from the public API docs named above; no
 * code was copied. UNVERIFIED until a person runs `protoboard update check
 * --force` with the network on (the overnight build ran it once; see
 * progress.md, W4-A).
 */

export const NPM_REGISTRY = "https://registry.npmjs.org";
export const OSV_API = "https://api.osv.dev";
/** DEFAULT: the only hosts the update check talks to. */
export const ALLOWED_HOSTS = ["registry.npmjs.org", "api.osv.dev"] as const;
/** DEFAULT: per request. */
export const REQUEST_TIMEOUT_MS = 10_000;
/** OSV's querybatch takes up to 1000 queries per request. */
export const OSV_BATCH = 1000;
/** Details are fetched for at most this many advisories per check (the rest keep their id). */
export const MAX_VULN_DETAILS = 50;
const MAX_DIST_TAGS_BYTES = 256 * 1024;
const MAX_BATCH_BYTES = 16 * 1024 * 1024;
const MAX_VULN_BYTES = 2 * 1024 * 1024;
const CONCURRENCY = 6;

/** The fetch the sources use (globalThis.fetch fits; tests pass a stub). */
export type UpdateFetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: "error" | "manual" | "follow" }) => Promise<FetchLike>;

export interface FetchLike {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  /** A web ReadableStream (Node 20 fetch); absent on simple stubs. */
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Reads a response body, stopping at `max` bytes: the stream when there is
 * one (so a server that omits or lies about content-length cannot make the
 * caller buffer an unbounded body), else arrayBuffer() with a check after.
 * Throws when the body is over `max`.
 */
export async function readBodyCapped(res: Pick<FetchLike, "body" | "arrayBuffer" | "headers">, max: number, what = "response"): Promise<Buffer> {
  const declared = Number(res.headers?.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > max) throw new Error(`${what} is ${declared} bytes, over the ${max}-byte limit`);
  const body = res.body;
  if (body && typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
          await reader.cancel().catch(() => undefined);
          throw new Error(`${what} is over the ${max}-byte limit`);
        }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
    return Buffer.concat(chunks, total);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > max) throw new Error(`${what} is over the ${max}-byte limit`);
  return bytes;
}

/** Refuses any URL outside the two allowed hosts, or not https. */
export function assertAllowed(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`not a URL: ${url}`);
  }
  if (u.protocol !== "https:" || !(ALLOWED_HOSTS as readonly string[]).includes(u.hostname)) throw new Error(`the update check talks only to ${ALLOWED_HOSTS.join(" and ")} over https, not ${u.host}`);
}

export interface SourceContext {
  fetcher: UpdateFetcher;
  /** Sent as the user-agent: the check and the stack version, nothing else. */
  userAgent: string;
  /** Aborts every request (the check's overall budget). */
  signal?: AbortSignal;
  /** Counts requests and hosts, for the result. */
  log?: { requests: number; hosts: Set<string> };
}

async function getJson<T>(ctx: SourceContext, url: string, init: { method?: string; body?: string } = {}, max: number): Promise<{ status: number; data?: T }> {
  assertAllowed(url);
  const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(ctx.signal ? [ctx.signal] : [])];
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  if (ctx.log) {
    ctx.log.requests++;
    ctx.log.hosts.add(new URL(url).hostname);
  }
  // redirect "error" (wave 4 gate): a 30x from an allowed host must not carry the request to another host
  const res = await ctx.fetcher(url, { method: init.method ?? "GET", redirect: "error", headers: { accept: "application/json", "user-agent": ctx.userAgent, ...(init.body ? { "content-type": "application/json" } : {}) }, ...(init.body ? { body: init.body } : {}), signal });
  if (!res.ok) {
    await res.body?.cancel?.().catch(() => undefined);
    return { status: res.status };
  }
  const bytes = await readBodyCapped(res, max, url);
  return { status: res.status, data: JSON.parse(bytes.toString("utf8")) as T };
}

/** Runs `fn` over `items`, at most `n` at a time, keeping order. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export interface DistTags {
  name: string;
  /** undefined with `status: 404`: not on the public registry. */
  tags?: Record<string, string>;
  status: "ok" | "not-published" | "failed";
  error?: string;
}

/** The dist-tags of each package (`latest`, `beta`, ...). One failing package does not fail the rest. */
export async function npmDistTags(ctx: SourceContext, names: string[]): Promise<DistTags[]> {
  return pool(names, CONCURRENCY, async (name): Promise<DistTags> => {
    const url = `${NPM_REGISTRY}/-/package/${name.startsWith("@") ? name.replace("/", "%2f") : encodeURIComponent(name)}/dist-tags`;
    try {
      const r = await getJson<Record<string, unknown>>(ctx, url, {}, MAX_DIST_TAGS_BYTES);
      if (r.status === 404) return { name, status: "not-published" };
      if (!r.data) return { name, status: "failed", error: `HTTP ${r.status}` };
      const tags: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.data)) if (typeof v === "string" && /^[\w.-]{1,64}$/.test(k) && /^\d+\.\d+\.\d+\S{0,64}$/.test(v)) tags[k] = v;
      return { name, tags, status: "ok" };
    } catch (e) {
      return { name, status: "failed", error: (e as Error).message };
    }
  });
}

export interface OsvQuery {
  ecosystem: "npm" | "PyPI";
  name: string;
  version: string;
}

/** OSV's answer per query: the advisory ids that affect that exact version. */
export interface OsvHit {
  query: OsvQuery;
  ids: string[];
}

/** One querybatch request per OSV_BATCH packages; returns only the packages with advisories. */
export async function osvQueryBatch(ctx: SourceContext, queries: OsvQuery[]): Promise<OsvHit[]> {
  const hits: OsvHit[] = [];
  for (let i = 0; i < queries.length; i += OSV_BATCH) {
    const chunk = queries.slice(i, i + OSV_BATCH);
    const body = JSON.stringify({ queries: chunk.map((q) => ({ package: { ecosystem: q.ecosystem, name: q.name }, version: q.version })) });
    const r = await getJson<{ results?: { vulns?: { id?: string }[] }[] }>(ctx, `${OSV_API}/v1/querybatch`, { method: "POST", body }, MAX_BATCH_BYTES);
    if (!r.data) throw new Error(`OSV querybatch: HTTP ${r.status}`);
    const results = r.data.results ?? [];
    chunk.forEach((q, j) => {
      const ids = (results[j]?.vulns ?? []).map((v) => v.id).filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(id));
      if (ids.length) hits.push({ query: q, ids: [...new Set(ids)] });
    });
  }
  return hits;
}

export type Severity = "malicious" | "critical" | "high" | "moderate" | "low" | "unknown";

export interface VulnDetail {
  id: string;
  summary?: string;
  severity: Severity;
  aliases: string[];
  /** Versions that fix it, per package name (from the advisory's ranges). */
  fixed: Record<string, string[]>;
  url: string;
}

const SEVERITY_ORDER: Severity[] = ["malicious", "critical", "high", "moderate", "low", "unknown"];
export const severityRank = (s: Severity) => SEVERITY_ORDER.indexOf(s);

/** Severity from an OSV record: MAL- ids are malicious; else GHSA's database_specific.severity; else unknown. */
export function osvSeverity(id: string, rec: { database_specific?: { severity?: unknown }; affected?: { database_specific?: { severity?: unknown }; ecosystem_specific?: { severity?: unknown } }[] } | undefined): Severity {
  if (/^MAL-/i.test(id)) return "malicious";
  const raw = [rec?.database_specific?.severity, ...(rec?.affected ?? []).flatMap((a) => [a.database_specific?.severity, a.ecosystem_specific?.severity])].find((s) => typeof s === "string") as string | undefined;
  const s = raw?.toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "moderate" || s === "medium") return "moderate";
  if (s === "low") return "low";
  return "unknown";
}

/** Details for up to MAX_VULN_DETAILS ids; an id whose details fail keeps severity `unknown` (MAL- stays malicious). */
export async function osvDetails(ctx: SourceContext, ids: string[]): Promise<Map<string, VulnDetail>> {
  const out = new Map<string, VulnDetail>();
  const wanted = [...new Set(ids)];
  // malicious first, so the cap never drops one
  wanted.sort((a, b) => Number(/^MAL-/i.test(b)) - Number(/^MAL-/i.test(a)));
  const fetched = wanted.slice(0, MAX_VULN_DETAILS);
  await pool(fetched, CONCURRENCY, async (id) => {
    const url = `${OSV_API}/v1/vulns/${encodeURIComponent(id)}`;
    try {
      const r = await getJson<{ summary?: unknown; details?: unknown; aliases?: unknown; database_specific?: { severity?: unknown }; affected?: { package?: { name?: string }; ranges?: { events?: { fixed?: string }[] }[]; database_specific?: { severity?: unknown }; ecosystem_specific?: { severity?: unknown } }[] }>(ctx, url, {}, MAX_VULN_BYTES);
      const rec = r.data;
      const fixed: Record<string, string[]> = {};
      for (const a of rec?.affected ?? []) {
        const name = a.package?.name;
        if (!name) continue;
        for (const range of a.ranges ?? []) for (const ev of range.events ?? []) if (typeof ev.fixed === "string" && ev.fixed.length <= 64) (fixed[name] ??= []).push(ev.fixed);
      }
      const summary = typeof rec?.summary === "string" ? rec.summary.slice(0, 300) : undefined;
      out.set(id, { id, ...(summary ? { summary } : {}), severity: osvSeverity(id, rec), aliases: Array.isArray(rec?.aliases) ? (rec!.aliases as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 10) : [], fixed, url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}` });
    } catch {
      out.set(id, { id, severity: osvSeverity(id, undefined), aliases: [], fixed: {}, url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}` });
    }
  });
  for (const id of wanted.slice(MAX_VULN_DETAILS)) out.set(id, { id, severity: osvSeverity(id, undefined), aliases: [], fixed: {}, url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}` });
  return out;
}
