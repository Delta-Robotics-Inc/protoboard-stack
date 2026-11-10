/**
 * Typed client for the parts service API v1, for the stack
 * (`protoboard parts search|add|update`) and the publishing scripts.
 *
 * Everything it downloads is verified before it is returned: an envelope
 * against its digest and its definition digest, a blob against its address.
 * Node 22+ (global fetch, node:crypto, node:fs); no other dependencies.
 *
 *   import { PartsClient } from "@protoboardai/cloud/client";
 *   const cloud = new PartsClient({ baseUrl: "http://localhost:8787" });
 *   const { revisions } = await cloud.getClosure("meps-neon-2207-v2-1950kv", 1);
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KitManifest, KitResult, KitSummary } from "./kits.js";
import type { ApiError, Closure, Discovery, Offer, PartSummary, PublicOffer, RelevanceSeed, RelevanceSeeds, RelevanceSeedsResult, RevisionRow, SearchQuery, SearchResult, ServiceTaxonomyDocument, TaxonomyResult, UsageReport } from "./api.js";
import {
  ENVELOPE_SCHEMAS,
  SUPPORTED_UHD_SCHEMA,
  definitionDigest,
  envelopeDigest,
  isRedistributable,
  isSafePath,
  referencedFiles,
  sha256Hex,
  stableStringify,
  uhdSchemaSupported,
  type EnvelopeArtifact,
  type EvidenceRef,
  type PartRef,
  type PartRevisionDraft,
  type PartRevisionEnvelope,
  type UhdSchemaRange,
} from "./envelope.js";

export type * from "./api.js";
export { PUBLIC_OFFER_FIELDS, SEARCH_SORTS } from "./api.js";
export * from "./envelope.js";

export interface ClientOptions {
  /** Service root, e.g. http://localhost:8787 (the `/v1` prefix is added, unless discovery names another API root). */
  baseUrl: string;
  /**
   * Publish token, for write calls (and reads, when no `readToken` is given:
   * the same service's gated reads accept it). Pass it from the environment;
   * never store it in project files.
   */
  token?: string;
  /**
   * Bearer token sent with every read: for a library whose reads need one
   * (discovery `auth.read: "bearer"`), or a signed-in user's ID token for
   * Protoboard Cloud's online services (full revisions, files, offers). From
   * the environment or a credential store; never from project files.
   */
  readToken?: string;
  /**
   * Find the API root and the envelope identifiers from the library's
   * uhd-library/v1 discovery document before the first call
   * (`discoverLibrary`). Off: the API root is `<baseUrl>/v1`.
   */
  discover?: boolean;
  /** Envelope identifiers accepted besides ENVELOPE_SCHEMAS (discovery adds the library's own). */
  envelopeSchemas?: string[];
  /** Replaces global fetch (tests, proxies). */
  fetch?: typeof fetch;
  /** UHD schema versions this consumer can read; envelopes outside it are refused. Default SUPPORTED_UHD_SCHEMA. */
  uhdSchema?: UhdSchemaRange;
}

/** A failed call: the service's error code, or INTEGRITY / NETWORK from the client itself. */
export class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CloudError";
  }
}

export interface PublishResult {
  /** `source-added`: the revision was published before without definition source, and now has it (protocol § 4.6.1). */
  status: "published" | "unchanged" | "source-added";
  envelope: PartRevisionEnvelope;
  /** Blobs uploaded by this call (the service already had the others). */
  uploaded: string[];
}

/** A file read back for upload: by blob address. */
export type BlobSource = (sha256: string) => Uint8Array | Promise<Uint8Array>;

/** What a downloaded envelope must be: the revision asked for and, when pinned, its digest. */
export interface ExpectedRevision extends PartRef {
  /** The envelope digest a project pinned (`sha256:…`). */
  digest?: string;
}

/**
 * Check a downloaded envelope: its schema, a UHD schema this consumer reads,
 * its digests, and what was asked for. Throws CloudError INTEGRITY, or
 * UHD_SCHEMA_UNSUPPORTED for a definition written against a UHD outside `range`.
 */
export function verifyEnvelope(env: PartRevisionEnvelope, expect?: ExpectedRevision, range: UhdSchemaRange = SUPPORTED_UHD_SCHEMA, schemas: readonly string[] = ENVELOPE_SCHEMAS): PartRevisionEnvelope {
  const bad = (m: string) => new CloudError(0, "INTEGRITY", `${env?.partId}@${env?.revision}: ${m}`);
  if (!env || typeof env !== "object" || !env.definition || typeof env.definition !== "object") throw bad("not an envelope");
  if (!schemas.includes(env.schema)) throw bad(`schema is ${JSON.stringify(env.schema)}, expected ${schemas.join(" or ")}`);
  if (expect && (env.partId !== expect.partId || env.revision !== expect.revision)) throw bad(`asked for ${expect.partId}@${expect.revision}`);
  if (definitionDigest(env.definition) !== env.definitionDigest) throw bad("definition does not match definitionDigest");
  if (envelopeDigest(env) !== env.digest) throw bad("envelope does not match its digest");
  if (expect?.digest !== undefined && env.digest !== expect.digest) throw bad(`digest is ${env.digest}, pinned ${expect.digest}`);
  if (typeof env.uhdSchema !== "string" || !uhdSchemaSupported(env.uhdSchema, range))
    throw new CloudError(0, "UHD_SCHEMA_UNSUPPORTED", `${env.partId}@${env.revision} is written against UHD ${env.uhdSchema}; this client reads >=${range.min} <${range.below}`, {
      uhdSchema: env.uhdSchema,
      supported: range,
    });
  return env;
}

/**
 * Check a closure is complete and self-consistent: the root is present, each
 * revision once, every dependency of every revision present at its pinned
 * revision and listed before it, nothing unreachable from the root. Conflicts
 * are recomputed from the revisions rather than taken from the server.
 */
export function verifyClosure(c: Closure, root: PartRef, range: UhdSchemaRange = SUPPORTED_UHD_SCHEMA, schemas: readonly string[] = ENVELOPE_SCHEMAS): Closure {
  const bad = (m: string) => new CloudError(0, "INTEGRITY", `closure of ${root.partId}@${root.revision}: ${m}`);
  if (!c || !c.root || !Array.isArray(c.revisions)) throw bad("not a closure");
  if (c.root.partId !== root.partId || c.root.revision !== root.revision) throw bad(`root is ${c.root.partId}@${c.root.revision}`);
  const key = (r: PartRef) => `${r.partId}@${r.revision}`;
  const position = new Map<string, number>();
  c.revisions.forEach((env, i) => {
    verifyEnvelope(env, undefined, range, schemas);
    if (position.has(key(env))) throw bad(`${key(env)} listed twice`);
    position.set(key(env), i);
  });
  if (!position.has(key(root))) throw bad("the root revision is missing");
  for (const [i, env] of c.revisions.entries())
    for (const d of env.dependencies) {
      const at = position.get(key(d));
      if (at === undefined) throw bad(`${key(env)} pins ${key(d)}, which is missing`);
      if (at >= i) throw bad(`${key(d)} is listed after ${key(env)}, which pins it`);
    }
  const byKey = new Map(c.revisions.map((env) => [key(env), env]));
  const reached = new Set<string>();
  const walk = (k: string) => {
    if (reached.has(k)) return;
    reached.add(k);
    for (const d of byKey.get(k)!.dependencies) walk(key(d));
  };
  walk(key(root));
  const extra = [...byKey.keys()].filter((k) => !reached.has(k));
  if (extra.length) throw bad(`${extra.join(", ")} not reachable from the root`);
  const revisionsOf = new Map<string, number[]>();
  for (const env of c.revisions) revisionsOf.set(env.partId, [...(revisionsOf.get(env.partId) ?? []), env.revision]);
  const conflicts = [...revisionsOf.entries()].filter(([, r]) => r.length > 1).map(([partId, r]) => ({ partId, revisions: r.sort((a, b) => a - b) }));
  return { root: c.root, revisions: c.revisions, conflicts };
}

/** `?k=v&…` for the defined, non-empty members of a query. */
function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** What `discoverLibrary` found: the API root and, when the library publishes one, its discovery document. */
export interface LibraryLocation {
  /** API root, without a trailing slash. */
  api: string;
  document?: Discovery;
}

/**
 * Find a uhd-library/v1 library's API root (UHD docs/library-protocol.md § 2):
 * `<baseUrl>/.well-known/uhd-library`, then `<baseUrl>/v1`. A library without
 * a discovery document (a service older than the protocol) is assumed at
 * `<baseUrl>/v1`. Only an unreachable host is an error (NETWORK). The
 * discovery document never needs credentials, so none are sent.
 */
export async function discoverLibrary(baseUrl: string, options: { fetch?: typeof fetch } = {}): Promise<LibraryLocation> {
  const base = baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  for (const url of [`${base}/.well-known/uhd-library`, `${base}/v1`]) {
    let res: Response;
    try {
      res = await doFetch(url, { headers: { accept: "application/json" } });
    } catch (e) {
      throw new CloudError(0, "NETWORK", `GET ${url}: ${(e as Error).message}`);
    }
    if (!res.ok) continue;
    const doc = (await res.json().catch(() => undefined)) as Discovery | undefined;
    if (doc?.protocol !== "uhd-library/v1") continue;
    return { api: new URL(doc.api ?? url, url).href.replace(/\/+$/, ""), document: doc };
  }
  return { api: `${base}/v1` };
}

/** How often a call is tried again after a 429, and the longest Retry-After it waits for (seconds). */
const RETRIES_429 = 2;
const MAX_RETRY_AFTER_S = 10;

export class PartsClient {
  readonly baseUrl: string;
  private readonly token?: string;
  private readonly readToken?: string;
  private readonly doFetch: typeof fetch;
  private readonly uhdSchema: UhdSchemaRange;
  private schemas: string[];
  private api?: string;
  private located?: Promise<LibraryLocation>;
  /** The library's discovery document, once a call has found it (`discover: true`). */
  library?: Discovery;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.readToken = options.readToken;
    this.doFetch = options.fetch ?? fetch;
    this.uhdSchema = options.uhdSchema ?? SUPPORTED_UHD_SCHEMA;
    this.schemas = [...new Set([...ENVELOPE_SCHEMAS, ...(options.envelopeSchemas ?? [])])];
    if (!options.discover) this.api = `${this.baseUrl}/v1`;
  }

  /** The API root: `<baseUrl>/v1`, or what discovery found. */
  async apiRoot(): Promise<string> {
    if (this.api) return this.api;
    this.located ??= discoverLibrary(this.baseUrl, { fetch: this.doFetch });
    try {
      const where = await this.located;
      this.library = where.document;
      this.schemas = [...new Set([...this.schemas, ...(where.document?.envelopeSchemas ?? [])])];
      this.api = where.api;
      return where.api;
    } catch (e) {
      this.located = undefined; // try again on the next call
      throw e;
    }
  }

  private async call(method: string, path: string, init: { body?: unknown; raw?: Uint8Array; auth?: boolean } = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (init.auth) {
      if (!this.token) throw new CloudError(401, "AUTH_REQUIRED", "this call needs a publish token (ClientOptions.token)");
      headers.authorization = `Bearer ${this.token}`;
    } else if (this.readToken ?? this.token) headers.authorization = `Bearer ${this.readToken ?? this.token}`;
    const api = await this.apiRoot();
    let body: RequestInit["body"];
    if (init.raw) {
      headers["content-type"] = "application/octet-stream";
      body = init.raw as unknown as RequestInit["body"];
    } else if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.doFetch(`${api}${path}`, { method, headers, body });
      } catch (e) {
        throw new CloudError(0, "NETWORK", `${method} ${api}${path}: ${(e as Error).message}`);
      }
      // over a per-minute cap (429 with a short Retry-After): wait it out, twice at most; a longer wait is the caller's to report
      const wait = res.status === 429 ? Number(res.headers.get("retry-after")) : NaN;
      if (!(attempt < RETRIES_429 && Number.isFinite(wait) && wait >= 0 && wait <= MAX_RETRY_AFTER_S)) break;
      await res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    if (!res.ok) {
      const err = ((await res.json().catch(() => undefined)) as { error?: ApiError } | undefined)?.error;
      const { code, message, ...details } = err ?? { code: `HTTP_${res.status}`, message: res.statusText };
      throw new CloudError(res.status, code, message, details);
    }
    return res;
  }

  private async json<T>(method: string, path: string, init?: { body?: unknown; auth?: boolean }): Promise<T> {
    return (await (await this.call(method, path, init)).json()) as T;
  }

  /** The uhd-library/v1 discovery document at the API root (with this service's counts, from Protoboard Cloud). */
  discover(): Promise<Discovery> {
    return this.json("GET", "");
  }

  /**
   * Parts whose recommended revision matches; any word of `q` matches, parts matching more words first;
   * `taxonomy` (or `category`) takes the subtree. Pass the result's
   * `nextCursor` as `cursor` for the next page; `facets` adds counts over
   * every match. `sort` orders the results on a library that declares the
   * `x-sort` capability (`sorts()`); another library ignores it.
   */
  search(query: SearchQuery = {}): Promise<SearchResult> {
    return this.json("GET", `/parts${queryString(query)}`);
  }

  /**
   * The orders this library's search takes in `sort` (capability `x-sort`),
   * from its discovery document; empty for a library that does not sort.
   */
  async sorts(): Promise<{ values: string[]; default?: string }> {
    await this.apiRoot();
    const doc = (this.library ??= await this.discover().catch(() => undefined));
    return doc?.capabilities?.includes("x-sort") && Array.isArray(doc.sort?.values) ? { values: [...doc.sort.values], default: doc.sort.default } : { values: [] };
  }

  /** The taxonomy the service uses, with part counts over the query's filters (the taxonomy filter ignored). */
  getTaxonomy(query: Omit<SearchQuery, "taxonomy" | "category" | "limit" | "offset" | "cursor" | "facets"> = {}): Promise<TaxonomyResult> {
    return this.json("GET", `/taxonomy${queryString(query)}`);
  }

  /** Give the service its taxonomy (needs the publish token). Unchanged when it already has this one. */
  setTaxonomy(doc: ServiceTaxonomyDocument): Promise<{ status: "set" | "unchanged"; digest: string; id: string; version: string }> {
    return this.json("PUT", "/taxonomy", { body: doc, auth: true });
  }

  /** The kits the service holds (capability `x-kits`). */
  async listKits(): Promise<KitSummary[]> {
    return (await this.json<{ kits: KitSummary[] }>("GET", "/kits")).kits;
  }

  /** One kit's manifest, with the latest revision of each part it names (null: not in the catalog). */
  getKit(kit: string): Promise<KitResult> {
    return this.json("GET", `/kits/${encodeURIComponent(kit)}`);
  }

  /** Give the service a kit's manifest (needs the publish token). Unchanged when it already has this one. */
  setKit(manifest: KitManifest): Promise<{ status: "set" | "unchanged"; digest: string; kit: string }> {
    return this.json("PUT", `/kits/${encodeURIComponent(manifest.kit)}`, { body: manifest, auth: true });
  }

  getPart(partId: string): Promise<{ part: PartSummary; revisions: RevisionRow[] }> {
    return this.json("GET", `/parts/${encodeURIComponent(partId)}`);
  }

  async listRevisions(partId: string): Promise<RevisionRow[]> {
    return (await this.json<{ revisions: RevisionRow[] }>("GET", `/parts/${encodeURIComponent(partId)}/revisions`)).revisions;
  }

  /** One exact revision, verified; with `digest`, also against a pinned envelope digest. */
  async getRevision(partId: string, revision: number, options: { digest?: string } = {}): Promise<PartRevisionEnvelope> {
    const env = await this.json<PartRevisionEnvelope>("GET", `/parts/${encodeURIComponent(partId)}/revisions/${revision}`);
    return verifyEnvelope(env, { partId, revision, ...(options.digest !== undefined ? { digest: options.digest } : {}) }, this.uhdSchema, this.schemas);
  }

  /**
   * A revision and every transitive dependency at its pinned revision,
   * dependencies first, each envelope verified and the closure checked
   * complete (`verifyClosure`). A part reached at two revisions is a
   * conflict (a project holds one definition per id): it throws
   * CLOSURE_CONFLICT unless `allowConflicts`.
   */
  async getClosure(partId: string, revision: number, options: { allowConflicts?: boolean } = {}): Promise<Closure> {
    const raw = await this.json<Closure>("GET", `/parts/${encodeURIComponent(partId)}/revisions/${revision}/closure`);
    const c = verifyClosure(raw, { partId, revision }, this.uhdSchema, this.schemas);
    if (c.conflicts.length && !options.allowConflicts) {
      throw new CloudError(409, "CLOSURE_CONFLICT", `dependencies pin different revisions of ${c.conflicts.map((x) => `${x.partId} (${x.revisions.join(", ")})`).join("; ")}`, { conflicts: c.conflicts });
    }
    return c;
  }

  /** Blob bytes, verified against the address (and `size` when given). */
  async downloadBlob(sha256: string, expect: { size?: number } = {}): Promise<Uint8Array> {
    const bytes = new Uint8Array(await (await this.call("GET", `/blobs/${sha256}`)).arrayBuffer());
    const got = sha256Hex(bytes);
    if (got !== sha256) throw new CloudError(0, "INTEGRITY", `blob ${sha256} downloaded as ${got}`);
    if (expect.size !== undefined && bytes.length !== expect.size) throw new CloudError(0, "INTEGRITY", `blob ${sha256} is ${bytes.length} bytes, expected ${expect.size}`);
    return bytes;
  }

  /**
   * Write a revision's files under `dir`, each at its envelope path, every one
   * verified. Artifacts always; evidence files with `evidence: true`. With
   * `redistributableOnly`, only files whose terms say `redistributable`
   * (what the redistributable view serves, and all a copy for others may
   * hold). With `skipWithheld`, an optional file (one no definition artifact
   * rests on: a thumbnail, an attachment, evidence) the service withholds for
   * its terms (403 NOT_DISTRIBUTABLE, as the redistributable library does) is
   * left out of the result instead of failing the download.
   */
  async downloadFiles(env: PartRevisionEnvelope, dir: string, options: { evidence?: boolean; redistributableOnly?: boolean; skipWithheld?: boolean } = {}): Promise<{ path: string; file: string; size: number }[]> {
    const files: (EnvelopeArtifact | EvidenceRef)[] = [...env.artifacts, ...(options.evidence ? env.evidence.filter((e) => e.path) : [])].filter((f) => !options.redistributableOnly || isRedistributable(f));
    const out: { path: string; file: string; size: number }[] = [];
    // optional = no definition artifact references the path (read from the definition, not the file's artifactId marker)
    const required = new Set(referencedFiles(env.definition).map((r) => r.path));
    for (const f of files) {
      if (!isSafePath(f.path!)) throw new CloudError(0, "INTEGRITY", `unsafe path ${f.path}`);
      let bytes: Uint8Array;
      try {
        bytes = await this.downloadBlob(f.sha256!, { size: f.size });
      } catch (e) {
        const optional = !required.has(f.path!);
        if (options.skipWithheld && optional && e instanceof CloudError && e.code === "NOT_DISTRIBUTABLE") continue;
        throw e;
      }
      const file = join(dir, ...f.path!.split("/"));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.part`, bytes);
      renameSync(`${file}.part`, file);
      out.push({ path: f.path!, file, size: bytes.length });
    }
    return out;
  }

  /**
   * A revision's definition source (protocol § 4.6), each file verified
   * against its address and size: path → text. Empty when the revision
   * ships none. Whether the text is allowed (the lint) and evaluates to the
   * definition digest is the caller's to check.
   */
  async downloadSource(env: PartRevisionEnvelope): Promise<{ path: string; text: string; sha256: string }[]> {
    const out: { path: string; text: string; sha256: string }[] = [];
    for (const f of env.source?.files ?? []) {
      if (!isSafePath(f.path)) throw new CloudError(0, "INTEGRITY", `unsafe source path ${f.path}`);
      const bytes = await this.downloadBlob(f.sha256, { size: f.size });
      out.push({ path: f.path, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), sha256: f.sha256 });
    }
    return out;
  }

  /**
   * Publish a revision: upload the blobs the service lacks (read through
   * `files`), then the envelope. Republishing identical content returns
   * "unchanged"; different content under an existing revision throws
   * REVISION_IMMUTABLE (409).
   */
  async publish(draft: PartRevisionDraft, files: BlobSource): Promise<PublishResult> {
    const wanted = [...new Set([...draft.artifacts.map((a) => a.sha256), ...draft.evidence.flatMap((e) => (e.sha256 ? [e.sha256] : [])), ...(draft.source?.files ?? []).map((f) => f.sha256)])];
    const { missing } = wanted.length ? await this.json<{ missing: string[] }>("POST", "/blobs/missing", { body: { sha256: wanted } }) : { missing: [] };
    for (const sha of missing) {
      const bytes = await files(sha);
      if (sha256Hex(bytes) !== sha) throw new CloudError(0, "INTEGRITY", `local file for blob ${sha} has changed since the draft was made`);
      await this.call("PUT", `/blobs/${sha}`, { raw: bytes, auth: true });
    }
    const r = await this.json<{ status: PublishResult["status"]; envelope: PartRevisionEnvelope }>("PUT", `/parts/${encodeURIComponent(draft.partId)}/revisions/${draft.revision}`, {
      body: draft,
      auth: true,
    });
    return { ...r, uploaded: missing };
  }

  /** Upload one blob (needs the publish token); unchanged when the service has it. */
  async uploadBlob(bytes: Uint8Array): Promise<{ sha256: string; size: number }> {
    const sha = sha256Hex(bytes);
    return (await this.call("PUT", `/blobs/${sha}`, { raw: bytes, auth: true })).json() as Promise<{ sha256: string; size: number }>;
  }

  /** Mark a revision (or, without `revision`, the whole part) deprecated. It stays downloadable. */
  deprecate(partId: string, d: { revision?: number; reason: string; replacedBy?: PartRef }): Promise<{ part: PartSummary; revisions: RevisionRow[] }> {
    return this.json("POST", `/parts/${encodeURIComponent(partId)}/deprecate`, { body: d, auth: true });
  }

  /**
   * A part's supplier offers, newest first: prices by source, as users are
   * served them (who sells it, the supplier's code, price breaks, currency,
   * stock, pack and minimum order, the link, when it was observed). With
   * `mpn`, only those for that ordering code (one value of a series part).
   */
  async listOffers(partId: string, filter: { mpn?: string } = {}): Promise<PublicOffer[]> {
    return (await this.json<{ offers: PublicOffer[] }>("GET", `/parts/${encodeURIComponent(partId)}/offers${queryString({ mpn: filter.mpn })}`)).offers;
  }

  /** The whole offer records, with where and how each was observed: publishers only. */
  async listOffersInternal(partId: string, filter: { mpn?: string } = {}): Promise<Offer[]> {
    return (await this.json<{ offers: Offer[] }>("GET", `/parts/${encodeURIComponent(partId)}/offers${queryString({ mpn: filter.mpn, view: "internal" })}`, { auth: true })).offers;
  }

  /** The relevance seeds the library holds (publishers only). */
  async listSeeds(): Promise<RelevanceSeed[]> {
    return (await this.json<{ seeds: RelevanceSeed[] }>("GET", "/relevance", { auth: true })).seeds;
  }

  /** Set every relevance seed (publishers only); parts left out are cleared. The same seeds again change nothing. */
  setSeeds(seeds: RelevanceSeeds): Promise<RelevanceSeedsResult> {
    return this.json("PUT", "/relevance", { body: { seeds }, auth: true });
  }

  /** The most added parts over a period (publishers only): the last `days` (30), or `from`..`to` (UTC days). */
  usage(query: { days?: number; from?: string; to?: string; limit?: number } = {}): Promise<UsageReport> {
    return this.json("GET", `/usage${queryString(query)}`, { auth: true });
  }

  async addOffer(partId: string, offer: Omit<Offer, "id" | "partId">): Promise<Offer> {
    return (await this.json<{ offer: Offer }>("POST", `/parts/${encodeURIComponent(partId)}/offers`, { body: offer, auth: true })).offer;
  }
}

/** The vendored definition file's bytes (`parts/catalog/<id>.json`); its sha256 is `envelope.definitionDigest`. */
export const vendoredDefinition = (env: PartRevisionEnvelope): string => stableStringify(env.definition);

