/**
 * The Library view (PB-857) and Manage libraries (PB-858), spec § 2.3: a
 * parts browser over every active library, a preview of a part, and the
 * actions that vendor it into the project through the CLI.
 *
 * - Which libraries: `protoboard libraries --format json` (libraryData.ts),
 *   with the `protoboard.libraries` user setting passed as personal
 *   libraries. Edits to the project's list go through `protoboard libraries
 *   add|remove|move`, so protoboard.config.ts is written by the CLI's own
 *   writer; personal ones are the user setting.
 * - Searching, the taxonomy, part details and files: the CLI's library code
 *   (`@protoboardai/core/library-client`) and the typed uhd-library/v1 client,
 *   bundled. Every downloaded file is verified against its address before it
 *   is cached.
 * - Add / Update: `protoboard parts add <id>@<rev> --library <id>` and
 *   `protoboard parts update <id> --to <rev> --library <id>`.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as vscode from "vscode";
import { discoverLibrary } from "@protoboardai/cloud/client";
import type { PartRevisionEnvelope, PartSummary, RevisionRow, SearchFacets } from "@protoboardai/cloud/client";
import {
  explainCloudError,
  libraryTaxonomy,
  markShadowed,
  partPrices,
  searchLibraries,
  urlProblems,
  withLibraryAdded,
  withLibraryMoved,
  withLibraryRemoved,
  type LibrariesTaxonomy,
  type LibraryConnection,
  type LibraryHit,
} from "@protoboardai/core/library-client";
import { parseJsonOutput, runCli, type CliCommand } from "./cli.js";
import { showApp, tabIcon } from "./appView.js";
import { accountTokensFor } from "@protoboardai/core/account";
import { addArgs, cliEnv, connect, isSignInRefusal, listLibraries, personalSetting, readUsage, updateArgs, type AddResult, type LibrariesListing, type PersonalLibrary, type Usage } from "./libraryData.js";
import { EMPTY_QUERY, categoryNamer, detailModel, drillDown, itemModel, libraryViewModel, pageImages, parseLibraryQuery, partPages, previewModel, previewTrust, rev, type ItemModel, type LibraryQuery, type PreviewModel } from "./libraryModel.js";
import { parseVerificationRecord, type PartTrust, type VerificationRecord } from "@protoboardai/core/part-trust";
import type { LibrarySort } from "@protoboardai/core/library-sort";
import { readFileSync } from "node:fs";
import type { LibraryPageMessage, ManagedLibrary } from "./libraryPage.js";
import type { PreviewAction } from "./previewPage.js";
import type { AccountModel, LibrariesModel, ManagedLibraryModel, PartDetailTab, PartPages } from "@protoboardai/views/parts-model";

/** Results per library per page. */
export const PAGE_SIZE = 30;
/** A body mesh up to this size is fetched with a part's detail; a larger one when the CAD section asks for it. */
export const EAGER_MESH_BYTES = 25e6;
/** Revisions kept in memory for the cards' pages (a revision never changes). */
const ENVELOPES_KEPT = 240;

/** A request from a webview that waits for its answer (`ask` is the webview's number for it). */
export function answer<T>(webview: vscode.Webview | undefined, ask: unknown, work: () => Promise<T>): Promise<void> {
  if (typeof ask !== "number") return Promise.resolve();
  return work().then(
    (value) => void webview?.postMessage({ type: "answer", ask, ok: true, value }),
    (e: unknown) => void webview?.postMessage({ type: "answer", ask, ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
}
export const PERSONAL_SETTING = "libraries";

/** What the Library needs from the rest of the extension. */
export interface LibraryHost {
  log: vscode.LogOutputChannel;
  cli(root: string): CliCommand;
  /** The project the views show. */
  project(): string | undefined;
  /** The project's parts changed (after add or update): check it again. */
  partsChanged(root: string): Promise<void>;
  /** Focus a part's instances in the viewer (the viewer opens). */
  openInViewer(root: string, partId: string): Promise<void>;
  openFile(root: string, file: string): Promise<void>;
  guard(fn: () => unknown): Promise<unknown>;
  /** The Protoboard Cloud sign-in, for the libraries manager's account card. */
  account?(): AccountModel;
  signIn?(): unknown;
  signOut?(): unknown;
  /** A part was picked (its detail shown): the Inspector shows it, without taking the focus (PB-919). */
  partPicked?(part: LibraryPick): void;
  /** The Project Parts page, in the editor area: where a part opened from the project's parts goes back to (PB-945). */
  openProjectParts?(): void;
  /**
   * Whether the library needs a sign-in (PB-928). Signed out, the Library lists
   * no parts and asks nothing of a library (PB-1039): its views show the
   * signed-out state with the sign-in action, as the others do.
   */
  locked?(): boolean;
  /** A library refused this window's sign-in: ask the service again who is signed in (`whoami --check`), so the views follow (PB-1039). */
  recheckAccount?(): Promise<unknown>;
}

/** Where a part's detail was opened from: its back control returns there (PB-917). */
export type DetailOrigin = "sidebar" | "page" | "parts";

const BACK_LABEL: Record<DetailOrigin, string> = { sidebar: "Library", page: "Library", parts: "Project parts" };

/** A library part as the Inspector shows it. */
export interface LibraryPick {
  model: PreviewModel;
  /** Its picture and body model, as files in the cache (when downloaded). */
  thumbnail?: string;
  glb?: string;
  /** The revision's UHD definition: the Inspector shows it as it shows a module of the project (PB-940). */
  definition?: unknown;
  /** The part's status (PB-932) from the revision's evidence, and why. */
  trust?: PartTrust;
  trustBasis?: string;
}

interface Results {
  hits: LibraryHit[];
  total: number;
  nextCursor: string | null;
  sources: { id: string; total?: number; error?: string }[];
  facets?: SearchFacets;
  /** The orders every library searched sorts by itself. */
  sorts: LibrarySort[];
}

export class LibraryController implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly id = "protoboard.library";
  private view: vscode.WebviewView | undefined;
  private root: string | undefined;
  private listing: LibrariesListing | undefined;
  private conns: LibraryConnection[] = [];
  private usage = new Map<string, Usage>();
  private personal: PersonalLibrary[] = [];
  private personalProblems: string[] = [];
  private setupError: string | undefined;
  private query: LibraryQuery;
  /** The full-page library (an editor tab) and the libraries manager (a settings tab). */
  private page: vscode.WebviewPanel | undefined;
  private manager: vscode.WebviewPanel | undefined;
  /** Which webviews have drawn (their React app said "ready"): the integration test reads it. */
  private readonly drawn = new Set<"sidebar" | "page" | "manager" | "part">();
  private working = false;
  private results: Results = { hits: [], total: 0, nextCursor: null, sources: [], sorts: [] };
  private taxonomy: { key: string; value: Promise<LibrariesTaxonomy | undefined> } | undefined;
  private taxonomyValue: LibrariesTaxonomy | undefined;
  private loading = false;
  private loadingMore = false;
  private error: string | undefined;
  private seq = 0;
  private readonly thumbs = new Map<string, string>();
  private readonly thumbQueue: { conn: LibraryConnection; sha: string; size: number; mediaType: string }[] = [];
  private thumbWorkers = 0;
  private readonly busy = new Set<string>();
  private readonly discovery = new Map<string, ManagedLibrary["discovery"]>();
  private readonly preview: PartPreview;
  /** Revisions the cards asked for, by `library/id@revision`: the newest kept, the oldest dropped. */
  private readonly envelopes = new Map<string, Promise<PartRevisionEnvelope>>();
  /** Counts the times the libraries were connected again (a sign-in, a changed list): what was asked of them before is asked again. */
  private connected = 0;
  private readonly watchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private loaded: Promise<void> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: LibraryHost,
  ) {
    this.query = parseLibraryQuery(context.workspaceState.get("protoboard.library.query"), EMPTY_QUERY);
    this.preview = new PartPreview(context, this, host);
    this.readPersonal();
    this.disposables.push(
      this.preview,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`protoboard.${PERSONAL_SETTING}`)) {
          this.readPersonal();
          void this.reload();
        }
      }),
    );
  }

  /** Where downloaded thumbnails and models are kept (by content address). */
  get cacheDir(): string {
    return join(this.context.globalStorageUri.fsPath, "library-cache");
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    mkdirSync(this.cacheDir, { recursive: true });
    showApp(view.webview, this.context.extensionUri, "library", "Library", [vscode.Uri.file(this.cacheDir)]);
    view.webview.onDidReceiveMessage((m: LibraryPageMessage) => {
      if (m?.type === "ready") this.drawn.add("sidebar");
      void this.host.guard(() => this.receive(m, "sidebar"));
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.ensureLoaded();
        this.post();
      }
    });
    view.onDidDispose(() => (this.view = undefined));
  }

  /** The current project changed (or was found): the Library follows it. */
  setProject(root: string | undefined) {
    if (root === this.root) return;
    this.root = root;
    this.listing = undefined;
    this.loaded = undefined;
    this.taxonomy = undefined;
    this.taxonomyValue = undefined;
    this.results = { hits: [], total: 0, nextCursor: null, sources: [], sorts: [] };
    for (const w of this.watchers.splice(0)) w.dispose();
    this.originsWatch?.dispose();
    this.originsWatch = undefined;
    if (root) {
      const config = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "protoboard.config.ts"));
      this.watchers.push(config, config.onDidChange(() => void this.reload()));
    }
    if (this.view?.visible) this.ensureLoaded();
    this.post();
  }

  private ensureLoaded() {
    if (this.root && !this.loaded && !this.isLocked()) this.loaded = this.reload();
  }

  /** The library needs a sign-in (PB-928). */
  private isLocked(): boolean {
    return this.host.locked?.() ?? false;
  }

  /**
   * The sign-in changed (PB-1039). Signed out, what the Library listed is
   * dropped: it shows no parts, and nothing is asked of a library until the
   * user signs in again (the libraries are listed and searched again then,
   * by the extension). Its pages show the signed-out state with the sign-in
   * action, as every other view does.
   */
  lockChanged() {
    if (!this.isLocked()) return;
    this.seq++;
    this.loaded = undefined;
    this.loading = false;
    this.loadingMore = false;
    this.error = undefined;
    this.setupError = undefined;
    this.results = { hits: [], total: 0, nextCursor: null, sources: [], sorts: [] };
    this.thumbQueue.splice(0);
    this.envelopes.clear();
    this.preview.signedOut();
    this.post();
  }

  /** The libraries are listed and connected (the Project parts views need them before the Library was ever shown). */
  async whenLoaded(): Promise<void> {
    this.ensureLoaded();
    await this.loaded;
  }

  private readPersonal() {
    const { libraries, problems } = personalSetting(vscode.workspace.getConfiguration("protoboard").get(PERSONAL_SETTING));
    this.personal = libraries;
    this.personalProblems = problems;
  }

  private env(): NodeJS.ProcessEnv {
    return cliEnv(this.personal);
  }

  /** The environment for any CLI run that touches libraries: the personal ones included. */
  cliEnv(): NodeJS.ProcessEnv {
    return this.env();
  }

  /** List the libraries (CLI), connect, read what the project uses, and search again. */
  async reload(): Promise<void> {
    const root = this.root;
    // signed out, nothing is listed and no library is asked (PB-1039): the extension reloads at the sign-in
    if (!root || this.isLocked()) return;
    this.loaded ??= Promise.resolve();
    this.setupError = undefined;
    this.loading = true;
    this.post();
    try {
      const listing = await listLibraries(this.host.cli(root), root, this.env());
      if (root !== this.root) return;
      this.listing = listing;
      // the user's sign-ins (protoboard login) for these services: full revisions and files need one on a hosted service
      const signedIn = await accountTokensFor(listing.libraries.map((l) => l.url));
      for (const p of signedIn.problems) this.host.log.warn(`library: not using the sign-in for ${p}`);
      if (root !== this.root) return;
      this.conns = connect(listing.libraries, process.env, undefined, signedIn.tokens);
      this.connected++;
      this.envelopes.clear();
      this.preview.connectionsChanged();
      this.watchOrigins(root, listing.origins);
      this.usage = readUsage(root, listing.origins);
      this.taxonomy = undefined;
      this.host.log.info(`library: ${listing.libraries.map((l) => `${l.id} ${l.url}`).join(", ")}`);
    } catch (e) {
      if (root !== this.root) return;
      this.loading = false;
      this.setupError = `Could not list the project's libraries: ${(e as Error).message}`;
      this.host.log.error(`library: ${this.setupError}`);
      this.post();
      return;
    }
    await this.search();
  }

  /** One watcher on the origins file; every reload() replaces it. */
  private originsWatch: vscode.Disposable | undefined;

  private watchOrigins(root: string, origins: string) {
    this.originsWatch?.dispose();
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, origins));
    const changed = () => {
      if (this.root !== root || !this.listing) return;
      this.usage = readUsage(root, this.listing.origins);
      this.post();
      this.preview.usageChanged();
    };
    this.originsWatch = vscode.Disposable.from(w, w.onDidChange(changed), w.onDidCreate(changed), w.onDidDelete(changed));
  }

  // ---- search

  private async search(): Promise<void> {
    if (!this.root || !this.conns.length || this.isLocked()) return;
    const seq = ++this.seq;
    this.loading = true;
    this.error = undefined;
    this.post();
    const q = this.query;
    const taxKey = JSON.stringify([q.text, q.domain, q.protocol, this.conns.map((c) => c.url)]);
    if (this.taxonomy?.key !== taxKey) {
      const value = libraryTaxonomy(this.conns, { q: q.text || undefined, domain: q.domain || undefined, protocol: q.protocol || undefined }).catch((e: Error) => {
        this.host.log.warn(`library: taxonomy: ${e.message}`);
        return undefined;
      });
      this.taxonomy = { key: taxKey, value };
    }
    try {
      const [r, tax] = await Promise.all([
        // `sort` goes to every library: one that sorts (capability x-sort) orders its pages by it, another ignores it
        searchLibraries(this.conns, { q: q.text || undefined, taxonomy: q.category || undefined, domain: q.domain || undefined, protocol: q.protocol || undefined, sort: q.sort, limit: PAGE_SIZE, facets: true }),
        this.taxonomy.value,
      ]);
      if (seq !== this.seq || this.isLocked()) return;
      this.taxonomyValue = tax;
      this.results = { hits: r.parts, total: r.total, nextCursor: r.nextCursor, sources: r.libraries.map((l) => ({ id: l.id, ...(l.total !== undefined ? { total: l.total } : {}), ...(l.error ? { error: l.error } : {}) })), ...(r.facets ? { facets: r.facets } : {}), sorts: r.sorts };
      for (const s of this.results.sources) if (s.error) this.host.log.warn(`library ${s.id}: ${s.error}`);
    } catch (e) {
      if (seq !== this.seq) return;
      this.results = { hits: [], total: 0, nextCursor: null, sources: [], sorts: [] };
      this.error = (e as Error).message;
      this.host.log.error(`library search: ${this.error}`);
    } finally {
      if (seq === this.seq) {
        this.loading = false;
        this.post();
        this.queueThumbs(this.results.hits);
      }
    }
  }

  private async loadMore() {
    if (!this.results.nextCursor || this.loadingMore || this.loading || this.isLocked()) return;
    const seq = this.seq;
    const q = this.query;
    this.loadingMore = true;
    this.post();
    try {
      const r = await searchLibraries(this.conns, { q: q.text || undefined, taxonomy: q.category || undefined, domain: q.domain || undefined, protocol: q.protocol || undefined, sort: q.sort, limit: PAGE_SIZE, cursor: this.results.nextCursor });
      if (seq !== this.seq) return;
      const order = this.conns.map((c) => c.id);
      this.results.hits = markShadowed([...this.results.hits, ...r.parts], order);
      this.results.nextCursor = r.nextCursor;
      for (const l of r.libraries) if (l.error) this.host.log.warn(`library ${l.id}: ${l.error}`);
      this.queueThumbs(r.parts);
    } catch (e) {
      if (seq === this.seq) this.error = (e as Error).message;
    } finally {
      if (seq === this.seq) {
        this.loadingMore = false;
        this.post();
      }
    }
  }

  /** The current rows, as the page and the integration test see them. */
  items(): ItemModel[] {
    return this.results.hits.map((h) => itemModel(h, this.usage));
  }

  /** For the integration test. */
  snapshot() {
    return { root: this.root, libraries: this.listing?.libraries, query: this.query, total: this.results.total, items: this.items(), more: !!this.results.nextCursor, taxonomy: this.taxonomyValue, error: this.error ?? this.setupError, loading: this.loading, drawn: [...this.drawn, ...(this.preview.drawn ? ["part"] : [])] };
  }

  /** A message from the Library's side bar, as a click sends it (the integration test: a click on a card is `open`). */
  async messageForTest(m: LibraryPageMessage): Promise<void> {
    await this.receive(m, "sidebar");
  }

  loadMoreForTest(): Promise<void> {
    return this.loadMore();
  }

  async openForTest(key: string, origin: DetailOrigin = "sidebar") {
    const hit = this.hit(key);
    if (!hit) throw new Error(`no ${key} in the results`);
    await this.preview.show(hit.library, hit.partId, undefined, undefined, origin);
  }

  /** A card's pages, as the Library's side bar asks for them (the integration test). */
  async pagesForTest(ref: unknown): Promise<PartPages> {
    const webview = this.view?.webview ?? this.page?.webview ?? this.preview.webview;
    if (!webview) throw new Error("no Library webview is open");
    return this.partPages(ref, webview);
  }

  /** The shown part's prices, as its detail asks for them (the integration test). */
  pricesForTest() {
    return this.preview.prices();
  }

  /** The part detail's back control, as a click on it (the integration test). */
  detailBack() {
    return this.preview.goBack();
  }

  previewSnapshot() {
    return this.preview.snapshot();
  }

  async setQuery(q: Partial<LibraryQuery>) {
    const next = parseLibraryQuery({ ...this.query, ...q }, this.query);
    // a new category keeps the drill-down where the user is
    this.query = next;
    void this.context.workspaceState.update("protoboard.library.query", this.query);
    if (!this.listing) await (this.loaded ??= this.reload());
    else await this.search();
  }

  // ---- thumbnails and files, verified, cached by content address

  private queueThumbs(hits: LibraryHit[]) {
    for (const h of hits) {
      const t = h.thumbnail;
      if (!t || this.thumbs.has(t.sha256) || this.thumbQueue.some((q) => q.sha === t.sha256)) continue;
      const conn = this.conns.find((c) => c.id === h.library);
      if (conn) this.thumbQueue.push({ conn, sha: t.sha256, size: t.size, mediaType: t.mediaType });
    }
    while (this.thumbWorkers < 4 && this.thumbQueue.length) {
      this.thumbWorkers++;
      void this.thumbWorker().finally(() => this.thumbWorkers--);
    }
  }

  private async thumbWorker() {
    const done: Record<string, string> = {};
    for (let job = this.thumbQueue.shift(); job; job = this.thumbQueue.shift()) {
      try {
        const file = await cachedBlob(this.cacheDir, job.conn, job.sha, job.size, job.mediaType);
        const uri = this.webviewUri(file);
        if (uri) {
          this.thumbs.set(job.sha, uri);
          done[job.sha] = uri;
        }
      } catch (e) {
        this.host.log.warn(`library: thumbnail ${job.sha.slice(0, 12)} from ${job.conn.id}: ${(e as Error).message}`);
      }
      if (Object.keys(done).length >= 6) this.postThumbs(done);
    }
    this.postThumbs(done);
  }

  private postThumbs(done: Record<string, string>) {
    if (!Object.keys(done).length) return;
    for (const k of Object.keys(done)) delete done[k];
    this.post();
  }

  /** A cached file as the webviews reach it (every one of them maps the cache the same way). */
  webviewUri(file: string): string | undefined {
    const w = this.view?.webview ?? this.page?.webview ?? this.preview.webview;
    return w?.asWebviewUri(vscode.Uri.file(file)).toString();
  }

  connection(id: string): LibraryConnection | undefined {
    return this.conns.find((c) => c.id === id);
  }

  /** How many times the libraries were connected: a part's prices are asked for again when it changes. */
  get connectedEpoch(): number {
    return this.connected;
  }

  /** A revision's pictures as the webviews reach them: fetched, verified and cached like the Library's thumbnails. */
  async pictureUrls(conn: LibraryConnection, envelope: Pick<PartRevisionEnvelope, "artifacts">, webview: vscode.Webview): Promise<Record<string, string>> {
    const urls: Record<string, string> = {};
    await Promise.all(
      pageImages(envelope).map(async (i) => {
        try {
          const file = await cachedBlob(this.cacheDir, conn, i.sha256, i.size, i.mediaType);
          urls[i.sha256] = webview.asWebviewUri(vscode.Uri.file(file)).toString();
        } catch (e) {
          this.host.log.warn(`library: picture ${i.sha256.slice(0, 12)} from ${conn.id}: ${(e as Error).message}`);
        }
      }),
    );
    return urls;
  }

  /**
   * A part's pages, for the cards' text carousel (PB-918): the revision's
   * specifications, dimensions, interfaces, CAD and artifacts. Asked for by a
   * card when it first shows a page (the Library's and the Project Parts
   * page's); never the model, only pictures.
   */
  async partPages(ref: unknown, webview: vscode.Webview): Promise<PartPages> {
    if (this.isLocked()) throw new Error("sign in to see the part library");
    const r = (ref && typeof ref === "object" ? ref : {}) as { key?: unknown; revision?: unknown };
    const key = typeof r.key === "string" ? r.key.slice(0, 300) : "";
    const [library, ...rest] = key.split("/");
    const partId = rest.join("/");
    await this.whenLoaded().catch(() => undefined);
    const conn = this.connection(library);
    if (!conn || !partId) throw new Error(`library ${library || "(none)"} is not active`);
    try {
      const hit = this.hit(key);
      const given = typeof r.revision === "number" && Number.isInteger(r.revision) && r.revision > 0 ? r.revision : undefined;
      const listed = hit?.recommendedRevision ?? hit?.latestRevision;
      const revision: number = given ?? listed ?? (await conn.client.getPart(partId).then((x) => x.part.recommendedRevision ?? x.part.latestRevision));
      const id = `${key}@${revision}`;
      let envelope = this.envelopes.get(id);
      if (!envelope) {
        envelope = conn.client.getRevision(partId, revision);
        this.envelopes.set(id, envelope);
        envelope.catch(() => this.envelopes.delete(id));
        if (this.envelopes.size > ENVELOPES_KEPT) this.envelopes.delete(this.envelopes.keys().next().value!);
      }
      const env = await envelope;
      return partPages(env, { urls: await this.pictureUrls(conn, env, webview) });
    } catch (e) {
      throw explainCloudError(e, conn, partId);
    }
  }

  usageOf(partId: string): Usage | undefined {
    return this.usage.get(partId);
  }

  categoryName(path: string): string | undefined {
    return this.taxonomyValue ? categoryNamer(this.taxonomyValue.nodes)(path) : undefined;
  }

  // ---- page

  /** The Library's model, to the sidebar and the full page. */
  private post() {
    const root = this.root;
    if (this.view) this.view.description = root && this.results.total ? `${this.results.total} parts` : undefined;
    this.postManager();
    if (!this.view?.visible && !this.page?.visible) return;
    const tax = this.taxonomyValue;
    const model = libraryViewModel({
      query: this.query,
      ...(tax ? { drill: drillDown(tax.nodes, this.query.category, { facets: this.results.facets?.taxonomy, total: tax.total }), top: tax.nodes } : {}),
      items: this.items(),
      total: this.results.total,
      // the taxonomy counts each part once; it is the whole catalog while no text, domain or protocol narrows it
      ...(tax && !this.query.text && !this.query.domain && !this.query.protocol ? { catalogTotal: tax.total } : {}),
      more: !!this.results.nextCursor,
      sources: this.results.sources.map((x) => ({ ...x, ...(this.discovery.get(x.id) && !("error" in this.discovery.get(x.id)!) ? { name: (this.discovery.get(x.id) as { name: string }).name } : {}) })),
      thumbs: Object.fromEntries(this.thumbs),
      busy: Object.fromEntries([...this.busy].map((k) => [k, "Working"])),
      loading: this.loading,
      loadingMore: this.loadingMore,
      ...(this.error ? { error: this.error } : {}),
      ...(this.setupError ? { setupError: this.setupError } : {}),
      noProject: !root,
      categoryName: (p) => this.categoryName(p),
      sorts: this.results.sorts,
    });
    const message = { type: "model", model, ...(this.preview.shownKey ? { selected: this.preview.shownKey } : {}) };
    if (this.view?.visible) void this.view.webview.postMessage(message);
    if (this.page?.visible) void this.page.webview.postMessage(message);
  }

  /** The full-page library: one editor tab, sharing the sidebar's search. */
  openPage() {
    if (this.page) return this.page.reveal(undefined, false);
    mkdirSync(this.cacheDir, { recursive: true });
    const panel = vscode.window.createWebviewPanel("protoboard.libraryPage", "Protoboard Library", { viewColumn: vscode.ViewColumn.Active }, { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = tabIcon(this.context.extensionUri, "library");
    showApp(panel.webview, this.context.extensionUri, "library-page", "Protoboard Library", [vscode.Uri.file(this.cacheDir)]);
    panel.webview.onDidReceiveMessage((m: LibraryPageMessage) => {
      if (m?.type === "ready") this.drawn.add("page");
      void this.host.guard(() => this.receive(m, "page"));
    });
    panel.onDidChangeViewState(() => panel.visible && this.post());
    panel.onDidDispose(() => (this.page = undefined));
    this.page = panel;
    this.ensureLoaded();
  }

  /** Manage libraries, as a settings tab. */
  openManager() {
    if (this.manager) return this.manager.reveal(undefined, false);
    const panel = vscode.window.createWebviewPanel("protoboard.libraries", "Libraries", { viewColumn: vscode.ViewColumn.Active }, { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = tabIcon(this.context.extensionUri, "settings");
    showApp(panel.webview, this.context.extensionUri, "libraries", "Libraries");
    panel.webview.onDidReceiveMessage((m: LibraryPageMessage | { type: "signIn" | "signOut" }) => {
      if (m?.type === "ready") this.drawn.add("manager");
      void this.host.guard(() => (m?.type === "signIn" ? this.host.signIn?.() : m?.type === "signOut" ? this.host.signOut?.() : this.receive(m as LibraryPageMessage)));
    });
    panel.onDidChangeViewState(() => panel.visible && this.postManager());
    panel.onDidDispose(() => {
      this.manager = undefined;
      void vscode.commands.executeCommand("setContext", "protoboard.library.managing", false);
    });
    this.manager = panel;
    void vscode.commands.executeCommand("setContext", "protoboard.library.managing", true);
    this.ensureLoaded();
    void this.checkLibraries();
  }

  /** The libraries manager's model. */
  librariesModel(): LibrariesModel {
    const access = (l: ManagedLibrary): ManagedLibraryModel["access"] => {
      const d = l.discovery;
      if (d && "error" in d) return "error";
      if (l.authEnv) return l.tokenSet ? "token" : "token-missing";
      const a = this.host.account?.();
      if (d && d.auth !== "none") return a?.state === "signed-in" ? "signed-in" : "sign-in";
      if (!d) return "checking";
      return a?.state === "signed-in" && l.scope === "default" ? "signed-in" : "public";
    };
    return {
      account: this.host.account?.() ?? { state: "unknown" },
      libraries: this.managed().map((l) => ({
        id: l.id,
        ...(l.discovery && !("error" in l.discovery) ? { name: l.discovery.name } : {}),
        url: l.url,
        scope: l.scope,
        ...(this.results.sources.find((x) => x.id === l.id)?.total !== undefined && !this.query.text && !this.query.category ? { parts: this.results.sources.find((x) => x.id === l.id)!.total } : {}),
        access: access(l),
        ...(l.authEnv ? { authEnv: l.authEnv } : {}),
        ...(l.discovery && "error" in l.discovery ? { error: l.discovery.error } : {}),
        pinned: l.pinned,
        position: l.position,
      })),
      problems: [...this.personalProblems, ...(this.setupError ? [this.setupError] : [])],
      working: this.working,
      ...(this.root ? {} : { noProject: true }),
    };
  }

  /** The sign-in changed: the libraries manager shows it. */
  accountChanged() {
    this.postManager();
  }

  private postManager() {
    if (this.manager?.visible) void this.manager.webview.postMessage({ type: "model", model: this.librariesModel() });
  }

  managed(): ManagedLibrary[] {
    return (this.listing?.libraries ?? []).map((l) => ({
      id: l.id,
      url: l.url,
      scope: l.personal ? "personal" : l.declared ? "project" : "default",
      ...(l.authEnv ? { authEnv: l.authEnv, tokenSet: !!process.env[l.authEnv] } : {}),
      position: l.position,
      pinned: l.pinned.length,
      ...(this.discovery.has(l.id) ? { discovery: this.discovery.get(l.id) } : {}),
    }));
  }

  private async receive(m: LibraryPageMessage, from: DetailOrigin = "sidebar") {
    // signed out (PB-1039): the pages show the signed-out state; nothing they send reaches a library
    if (this.isLocked() && m?.type !== "ready" && m?.type !== "manage") {
      if (m?.type === "pages") {
        const webview = from === "page" ? this.page?.webview : this.view?.webview;
        return answer(webview, m.ask, () => Promise.reject(new Error("sign in to see the part library")));
      }
      return;
    }
    switch (m?.type) {
      case "ready":
        this.ensureLoaded();
        // pictures fetched while no page of the library was open had no address a page can show (webviewUri) and
        // were dropped: results loaded by a sign-in or a settings change, before the Library was first opened,
        // stayed without pictures until the next search. They are cached by now: asked for again, they are there
        this.queueThumbs(this.results.hits);
        return this.post();
      case "retry":
        return this.reload();
      case "query":
        return this.setQuery(m.query);
      case "loadMore":
        return this.loadMore();
      case "open": {
        const hit = this.hit(m.key);
        if (hit) await this.preview.show(hit.library, hit.partId, undefined, m.tab, from);
        return;
      }
      case "openPage":
        return this.openPage();
      case "pages": {
        // answered to the webview that asked; a failure is the card's to show, not a notification
        const webview = from === "page" ? this.page?.webview : this.view?.webview;
        return answer(webview, m.ask, () => this.partPages(m.ref, webview!));
      }
      case "more":
        return this.moreActions(m.key);
      case "add":
      case "update": {
        const it = this.items().find((x) => x.key === m.key);
        if (!it) return;
        if (m.type === "add") await this.vendor("add", it.partId, it.revision, it.library);
        else if (it.update !== undefined) await this.vendor("update", it.partId, it.update, it.library);
        return;
      }
      case "manage":
        return this.setManage(!!m.open);
      case "libCheck":
        return this.checkLibraries();
      case "libAdd":
        return this.addLibrary(m);
      case "libRemove":
      case "libUp":
      case "libDown":
        return this.editLibrary(m.type, m.id, m.scope, m.type === "libRemove" ? 1 : m.steps);
    }
  }

  private hit(key: string): LibraryHit | undefined {
    return this.results.hits.find((h) => `${h.library}/${h.partId}` === key);
  }

  /** A part's detail, in its editor tab. */
  showPart(library: string, partId: string, revision?: number, tab?: PartDetailTab, origin?: DetailOrigin) {
    if (this.isLocked()) return Promise.resolve();
    return this.preview.show(library, partId, revision, tab, origin);
  }

  /** Back from a part's detail to the list it was opened from: that list keeps where it was scrolled to. */
  async back(origin: DetailOrigin) {
    if (origin === "page") this.openPage();
    // from the project's parts: the Project Parts page (beta test 1, F17: it used to only close the tab)
    else if (origin === "parts" && this.host.openProjectParts) this.host.openProjectParts();
    else await vscode.commands.executeCommand(origin === "parts" ? "protoboard.parts.focus" : "protoboard.library.focus");
  }

  /** A library part's picture as a file in the cache (downloaded and verified like the Library's own), when it has one. */
  async thumbnailFile(library: string, partId: string): Promise<string | undefined> {
    const conn = this.connection(library);
    if (!conn) return undefined;
    const t = this.results.hits.find((h) => h.library === library && h.partId === partId)?.thumbnail ?? (await conn.client.getPart(partId)).part.thumbnail;
    if (!t) return undefined;
    return cachedBlob(this.cacheDir, conn, t.sha256, t.size, t.mediaType);
  }

  /** The part detail has its data: the Inspector shows the part (PB-919). */
  picked(pick: LibraryPick) {
    this.host.partPicked?.(pick);
  }

  /** The part detail changed what it shows: the Library outlines that card. */
  selectionChanged() {
    this.post();
  }

  /** A part's other actions, as a quick pick. */
  private async moreActions(key: string) {
    const it = this.items().find((x) => x.key === key);
    if (!it) return;
    const picks: (vscode.QuickPickItem & { id: string })[] = [
      { id: "open", label: "$(eye) Preview Part" },
      { id: "copy", label: "$(copy) Copy Part Id", description: it.partId },
      // the CLI's reference form (`parts add <id>@<rev>`), for pasting into a terminal
      { id: "ref", label: "$(copy) Copy CLI Reference", description: `${it.partId}@${it.revision}` },
      ...(it.used && !it.used.elsewhere ? [{ id: "def", label: "$(go-to-file) Open Definition" }, { id: "viewer", label: "$(target) Show in Viewer" }] : []),
      { id: "page", label: "$(library) Open the Full Library" },
    ];
    const pick = await vscode.window.showQuickPick(picks, { title: it.name, placeHolder: `${it.library} · ${it.partId} ${rev(it.revision)}` });
    switch (pick?.id) {
      case "open":
        return this.preview.show(it.library, it.partId, undefined, undefined, "sidebar");
      case "copy":
        return vscode.env.clipboard.writeText(it.partId);
      case "ref":
        return vscode.env.clipboard.writeText(`${it.partId}@${it.revision}`);
      case "def":
        return this.openDefinition(it.partId);
      case "viewer":
        return this.openInViewer(it.partId);
      case "page":
        return this.openPage();
    }
  }

  // ---- Add to project / Update

  /** `protoboard parts add|update` for a part from one library; then the project is checked again. */
  async vendor(kind: "add" | "update", partId: string, revision: number, library: string): Promise<AddResult[] | undefined> {
    const root = this.root;
    if (!root) throw new Error("open a Protoboard project first");
    const key = `${library}/${partId}`;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    this.post();
    this.preview.busyChanged(key, kind === "add" ? "Adding" : "Updating");
    const args = kind === "add" ? addArgs(partId, revision, library) : updateArgs(partId, revision, library);
    this.host.log.info(`library: protoboard ${args.slice(0, -2).join(" ")}`);
    try {
      const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: ${kind === "add" ? "adding" : "updating"} ${partId} ${rev(revision)} from ${library}` }, () =>
        runCli(this.host.cli(root), args, { cwd: root, env: this.env() }),
      );
      const out = parseJsonOutput<{ results: AddResult[] }>(r, `protoboard parts ${kind}`);
      for (const x of out.results) this.host.log.info(`  ${x.status} ${x.id}${x.revision ? `@${x.revision}` : ""}${x.library ? ` from ${x.library}` : ""}${x.message ? `: ${x.message}` : ""}`);
      if (this.listing) this.usage = readUsage(root, this.listing.origins);
      const conflict = out.results.find((x) => x.status === "conflict");
      const self = out.results.find((x) => x.id === partId);
      const deps = out.results.filter((x) => x.requiredBy && x.status !== "unchanged").length;
      if (conflict) {
        void vscode.window.showWarningMessage(`Protoboard: ${conflict.id}: ${conflict.message ?? "conflict"}`, "Show Log").then((a) => a && this.host.log.show());
      } else {
        const what = `${partId} ${rev(self?.revision ?? revision)} ${self?.status ?? "added"} from ${library}${deps ? ` with ${deps} dependenc${deps === 1 ? "y" : "ies"}` : ""}`;
        void vscode.window.showInformationMessage(`Protoboard: ${what}.`, "Open in Viewer", "Open Definition").then((a) => {
          if (a === "Open in Viewer") void this.host.guard(() => this.host.openInViewer(root, partId));
          if (a === "Open Definition") void this.host.guard(() => this.openDefinition(partId));
        });
        void this.host.partsChanged(root);
      }
      return out.results;
    } finally {
      this.busy.delete(key);
      this.post();
      this.preview.busyChanged(key, undefined);
    }
  }

  async openDefinition(partId: string) {
    const root = this.root;
    const u = this.usage.get(partId);
    if (!root || !u?.file) throw new Error(`${partId} is not vendored in this project`);
    await this.host.openFile(root, u.file);
  }

  async openInViewer(partId: string) {
    if (!this.root) throw new Error("open a Protoboard project first");
    await this.host.openInViewer(this.root, partId);
  }

  // ---- Manage libraries

  /** Manage libraries: its settings tab opens (or closes). */
  setManage(open: boolean) {
    if (open) this.openManager();
    else this.manager?.dispose();
  }

  private async checkLibraries() {
    await Promise.all(
      (this.listing?.libraries ?? []).map(async (l) => {
        try {
          const where = await discoverLibrary(l.url);
          const d = where.document;
          this.discovery.set(l.id, d ? { name: d.name, version: d.version, auth: d.auth.read } : { error: `no uhd-library/v1 discovery document at ${l.url}/.well-known/uhd-library` });
        } catch (e) {
          this.discovery.set(l.id, { error: explainCloudError(e, l).message });
        }
      }),
    );
    this.post();
  }

  /** Add a library by URL: its discovery document names it and says whether reads need a token. */
  async addLibrary(m: { url: string; id?: string; authEnv?: string; scope: "project" | "personal" }) {
    const root = this.root;
    if (!root) throw new Error("open a Protoboard project first");
    const url = m.url.replace(/\/+$/, "");
    const bad = urlProblems(url);
    if (bad.length) throw new Error(`the library URL ${bad.join("; ")}`);
    await this.working_(async () => {
      const found = await discoverLibrary(url).catch((e: Error) => {
        throw new Error(`cannot reach ${url}: ${e.message.replace(/^.*?: /, "")}`);
      });
      const doc = found.document;
      if (!doc) throw new Error(`${url} has no uhd-library/v1 discovery document (${url}/.well-known/uhd-library); is it a parts library?`);
      const id = m.id || doc.id;
      if (!id) throw new Error(`${url}'s discovery document has no id; give the library an id`);
      // a library that signs users in itself (a Protoboard service: `account` in its discovery, PB-928) reads with the
      // user's sign-in; any other that wants a token for reads gets it from the environment
      if (doc.auth.read !== "none" && !m.authEnv && !(doc as { account?: unknown }).account)
        throw new Error(`${doc.name} needs a token to read: name the environment variable that holds it (for example ${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_TOKEN); the token itself is never stored`);
      if (this.listing?.libraries.some((l) => l.id === id)) throw new Error(`a library "${id}" is already active; give this one another id`);
      const lib = { id, url, ...(m.authEnv ? { authEnv: m.authEnv } : {}) };
      if (m.scope === "personal") {
        await this.savePersonal(withLibraryAdded(this.personal, lib));
      } else {
        await this.libraries(root, ["add", id, url, ...(m.authEnv ? ["--auth-env", m.authEnv] : [])]);
      }
      this.discovery.set(id, { name: doc.name, version: doc.version, auth: doc.auth.read });
      void vscode.window.showInformationMessage(`Protoboard: added ${doc.name} as library "${id}" (${m.scope === "personal" ? "your user settings" : "protoboard.config.ts"}).${m.authEnv && !process.env[m.authEnv] ? ` Set $${m.authEnv} in the environment VS Code starts from; it is not set now.` : ""}`);
    });
  }

  async editLibrary(kind: "libRemove" | "libUp" | "libDown", id: string, scope: "project" | "default" | "personal", steps = 1) {
    const root = this.root;
    if (!root) return;
    if (kind === "libRemove") {
      const l = this.listing?.libraries.find((x) => x.id === id);
      const pinned = l?.pinned.length ?? 0;
      const where = scope === "personal" ? "your user settings" : "protoboard.config.ts";
      const ok = await vscode.window.showWarningMessage(
        `Remove library "${id}" from ${where}?`,
        { modal: true, detail: pinned ? `${pinned} part(s) vendored from it stay vendored, but cannot be updated until it is added back.` : undefined },
        "Remove",
      );
      if (ok !== "Remove") return;
    }
    await this.working_(async () => {
      const direction = kind === "libUp" ? "up" : "down";
      // a drag moves several places: one step at a time, in order (the CLI moves one place per call)
      const n = Math.max(1, Math.min(Math.floor(steps) || 1, 50));
      if (scope === "personal") {
        let list = this.personal;
        if (kind === "libRemove") list = withLibraryRemoved(list, id, { allowEmpty: true });
        else for (let i = 0; i < n; i++) list = withLibraryMoved(list, id, direction);
        await this.savePersonal(list);
      } else if (kind === "libRemove") await this.libraries(root, ["remove", id]);
      else for (let i = 0; i < n; i++) await this.libraries(root, ["move", id, direction]);
    });
  }

  private async working_(fn: () => Promise<void>) {
    this.working = true;
    this.post();
    try {
      await fn();
    } finally {
      this.working = false;
      await this.reload();
    }
  }

  /** `protoboard libraries <args>`: the CLI writes protoboard.config.ts. */
  private async libraries(root: string, args: string[]) {
    this.host.log.info(`library: protoboard libraries ${args.join(" ")}`);
    const r = await runCli(this.host.cli(root), ["libraries", ...args, "--format", "json"], { cwd: root, env: this.env() });
    const out = parseJsonOutput<{ done?: string }>(r, `protoboard libraries ${args[0]}`);
    if (out.done) this.host.log.info(`  ${out.done}`);
  }

  private async savePersonal(list: PersonalLibrary[]) {
    await vscode.workspace.getConfiguration("protoboard").update(PERSONAL_SETTING, list.length ? list : undefined, vscode.ConfigurationTarget.Global);
    this.readPersonal();
  }

  dispose() {
    for (const w of this.watchers.splice(0)) w.dispose();
    this.originsWatch?.dispose();
    this.originsWatch = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.page?.dispose();
    this.manager?.dispose();
  }
}

/** A blob from a library, verified against its address, kept in the cache by that address. */
export async function cachedBlob(dir: string, conn: Pick<LibraryConnection, "client">, sha: string, size: number | undefined, mediaType: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`not a blob address: ${sha}`);
  const ext = mediaType === "image/png" ? ".png" : mediaType === "image/jpeg" ? ".jpg" : mediaType === "image/webp" ? ".webp" : mediaType === "image/svg+xml" ? ".svg" : mediaType === "model/gltf-binary" ? ".glb" : ".bin";
  const file = join(dir, `${sha}${ext}`);
  if (existsSync(file)) return file;
  const bytes = await conn.client.downloadBlob(sha, size !== undefined ? { size } : {});
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.part`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
  return file;
}

/** The part preview panel: one, reused, showing one revision of one part from one library. */
class PartPreview implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private shown: { library: string; partId: string; revision?: number } | undefined;
  private data: { part: PartSummary; revisions: RevisionRow[]; envelope: PartRevisionEnvelope } | undefined;
  private files: { thumb?: string; glb?: string; glbError?: string; thumbFile?: string; glbFile?: string; pictures?: Record<string, string> } = {};
  /** The revision's verification record, once read (`null`: it carries one that could not be read). */
  private record: VerificationRecord | null | undefined;
  /** The list the detail was opened from (its back control). */
  private origin: DetailOrigin | undefined;
  private busy: string | undefined;
  private seq = 0;
  /** Its React app has drawn. */
  drawn = false;
  /** The section the detail opens on (the card's Compare opens Revisions). */
  private tab: PartDetailTab | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly lib: LibraryController,
    private readonly host: LibraryHost,
  ) {}

  /** The webview, for cache URIs. */
  get webview(): vscode.Webview | undefined {
    return this.panel?.webview;
  }

  /** The part shown (`<library>/<id>`), so the Library outlines its card. */
  get shownKey(): string | undefined {
    return this.shown ? `${this.shown.library}/${this.shown.partId}` : undefined;
  }

  /** Signed out (PB-1039): what the detail was loading is dropped; its tab keeps the signed-out state over an empty page. */
  signedOut() {
    this.seq++;
    this.data = undefined;
    this.files = {};
    this.record = undefined;
  }

  async show(library: string, partId: string, revision?: number, tab?: PartDetailTab, origin?: DetailOrigin) {
    const conn = this.lib.connection(library);
    if (!conn) throw new Error(`library ${library} is no longer active`);
    this.tab = tab;
    // a revision or retry of the part shown keeps where it came from
    if (origin || !this.shown || this.shown.partId !== partId) this.origin = origin;
    if (!this.panel) {
      mkdirSync(this.lib.cacheDir, { recursive: true });
      const panel = vscode.window.createWebviewPanel("protoboard.part", partId, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true });
      panel.iconPath = tabIcon(this.context.extensionUri, "part");
      showApp(panel.webview, this.context.extensionUri, "part", partId, [vscode.Uri.file(this.lib.cacheDir)]);
      panel.webview.onDidReceiveMessage((m: PreviewAction) => void this.host.guard(() => this.receive(m)));
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.shown = undefined;
        this.data = undefined;
      });
      this.panel = panel;
    } else this.panel.reveal(undefined, false);
    this.shown = { library, partId, ...(revision !== undefined ? { revision } : {}) };
    this.panel.title = partId;
    await this.load(conn);
  }

  private async load(conn: LibraryConnection) {
    const shown = this.shown!;
    const seq = ++this.seq;
    this.data = undefined;
    this.files = {};
    this.record = undefined;
    this.lib.selectionChanged();
    try {
      const { part, revisions } = await conn.client.getPart(shown.partId);
      const revision = shown.revision ?? part.recommendedRevision ?? part.latestRevision;
      const envelope = await conn.client.getRevision(shown.partId, revision);
      if (seq !== this.seq) return;
      this.data = { part, revisions, envelope };
      this.panel!.title = part.name;
      this.post();
      // the verification record (a small JSON file among the evidence) says the part's status (PB-932)
      const ver = this.model()?.verification;
      if (ver) {
        const record = await cachedBlob(this.lib.cacheDir, conn, ver.sha256, ver.size, "application/json").then(
          (file) => parseVerificationRecord(readFileSync(file, "utf8")),
          () => null,
        );
        if (seq !== this.seq) return;
        this.record = record;
        this.post();
      }
      // the thumbnail first (small), then the model
      if (part.thumbnail) {
        const file = await cachedBlob(this.lib.cacheDir, conn, part.thumbnail.sha256, part.thumbnail.size, part.thumbnail.mediaType).catch(() => undefined);
        if (file && seq === this.seq && this.panel) {
          this.files.thumb = this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
          this.files.thumbFile = file;
        }
      }
      // its other pictures (the image carousel), then the model: with the detail when it is small, when the CAD section asks otherwise
      if (this.panel) {
        const pictures = await this.lib.pictureUrls(conn, envelope, this.panel.webview);
        if (seq === this.seq) {
          this.files.pictures = pictures;
          this.post();
        }
      }
      const m = this.model();
      if (m?.glb && m.glb.size <= EAGER_MESH_BYTES) await this.fetchModel(conn, seq);
      if (seq === this.seq) {
        this.post();
        const shownModel = this.model();
        if (shownModel) this.lib.picked({ model: shownModel, ...(this.files.thumbFile ? { thumbnail: this.files.thumbFile } : {}), ...(this.files.glbFile ? { glb: this.files.glbFile } : {}), definition: this.data?.envelope.definition, ...previewTrust(shownModel, this.record) });
      }
    } catch (e) {
      if (seq !== this.seq) return;
      const err = explainCloudError(e, conn, `${shown.partId}`);
      if (this.panel) this.panel.title = `${shown.partId} (not loaded)`;
      // the library refused the sign-in this window holds (PB-1039): a list loaded while the sign-in still worked gave a
      // click that failed (the service needs an account for every read of the library, PB-928). The service is
      // asked again who is signed in, so every view follows (signed out: the Library's sign-in card), and the user is told
      if (isSignInRefusal(e)) {
        this.host.log.warn(`library: ${err.message}`);
        await this.host.recheckAccount?.();
        if (seq !== this.seq || this.host.locked?.()) return;
        void vscode.window.showWarningMessage("Protoboard: sign in again to open library parts.", "Sign In").then((a) => a && void this.host.guard(() => this.host.signIn?.()));
        return;
      }
      void vscode.window.showErrorMessage(`Protoboard: ${err.message}`, "Try Again").then((a) => a && void this.host.guard(() => this.show(shown.library, shown.partId, shown.revision)));
    }
  }

  /** The body mesh, into the cache and onto the page. */
  private async fetchModel(conn: LibraryConnection, seq: number) {
    const glb = this.model()?.glb;
    if (!glb || this.files.glb) return;
    try {
      const file = await cachedBlob(this.lib.cacheDir, conn, glb.sha256, glb.size, "model/gltf-binary");
      if (seq === this.seq && this.panel) {
        this.files.glb = this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
        this.files.glbFile = file;
      }
    } catch (e) {
      if (seq === this.seq) this.files.glbError = (e as Error).message;
    }
  }

  /** The shown part's prices by source: what its library serves the signed-in user; a refusal comes back in `unavailable`, with what to do. */
  async prices() {
    const shown = this.shown;
    const conn = shown && this.lib.connection(shown.library);
    if (!shown || !conn) throw new Error(`library ${shown?.library ?? "(none)"} is no longer active`);
    return partPrices(conn, shown.partId);
  }

  /** The libraries were connected again (a sign-in): the prices are the new account's to ask for. */
  connectionsChanged() {
    this.post();
  }

  private model() {
    if (!this.data || !this.shown) return undefined;
    const conn = this.lib.connection(this.shown.library);
    return previewModel({ ...this.data, library: { id: this.shown.library, url: conn?.url ?? "" }, usage: this.lib.usageOf(this.shown.partId), categoryName: (p) => this.lib.categoryName(p) });
  }

  private post() {
    const model = this.model();
    if (!model) return;
    const detail = detailModel(model, {
      ...(this.files.thumb ? { thumb: this.files.thumb } : {}),
      ...(this.files.glb ? { model: this.files.glb } : {}),
      ...(this.files.glbError ? { modelError: this.files.glbError } : {}),
      ...(this.busy ? { busy: this.busy } : {}),
      noProject: !this.host.project(),
      ...previewTrust(model, this.record),
      pages: partPages(this.data!.envelope, { urls: { ...(this.files.pictures ?? {}), ...(this.data!.part.thumbnail && this.files.thumb ? { [this.data!.part.thumbnail.sha256]: this.files.thumb } : {}) } }),
      ...(model.glb && !this.files.glb && !this.files.glbError ? { modelLazy: true } : {}),
      hasPrices: true,
    });
    detail.pricesAs = String(this.lib.connectedEpoch);
    if (this.origin) {
      detail.back = BACK_LABEL[this.origin];
      // the extension binds it (package.json): VS Code shows it in the tooltip as any shortcut
      detail.backShortcutLabel = "Alt+←";
    }
    void this.panel?.webview.postMessage({ type: "model", model: detail, ...(this.tab ? { tab: this.tab } : {}) });
  }

  usageChanged() {
    this.post();
  }

  snapshot() {
    const m = this.model();
    return m && { ...m, ...(this.origin ? { back: BACK_LABEL[this.origin] } : {}), open: !!this.panel };
  }

  busyChanged(key: string, busy: string | undefined) {
    if (this.shown && `${this.shown.library}/${this.shown.partId}` === key) {
      this.busy = busy;
      this.post();
    }
  }

  private async receive(m: PreviewAction) {
    const shown = this.shown;
    if (!shown) return;
    switch (m?.type) {
      case "ready":
        this.drawn = true;
        return this.post();
      case "retry":
        return this.show(shown.library, shown.partId, shown.revision);
      case "revision":
        return this.show(shown.library, shown.partId, m.revision);
      case "act": {
        if (!Number.isInteger(m.revision)) return;
        await this.lib.vendor(m.kind === "add" ? "add" : "update", shown.partId, m.revision, shown.library);
        return;
      }
      case "openViewer":
        return this.lib.openInViewer(shown.partId);
      case "openDefinition":
        if (this.lib.usageOf(shown.partId)?.file) return this.lib.openDefinition(shown.partId);
        void vscode.window.showInformationMessage(`Protoboard: add ${shown.partId} to the project to open its definition.`);
        return;
      case "openPage":
        return this.lib.openPage();
      case "back":
        return this.goBack();
      case "openLink":
        if (typeof m.url === "string" && /^https?:\/\//.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
        return;
      case "copy":
        if (typeof m.text === "string") await vscode.env.clipboard.writeText(m.text.slice(0, 200));
        return;
      case "loadModel": {
        // the CAD section asked for a mesh too large to fetch with the detail
        const conn = this.lib.connection(shown.library);
        if (!conn) return;
        const seq = this.seq;
        await this.fetchModel(conn, seq);
        if (seq !== this.seq) return;
        this.post();
        const model = this.model();
        if (model && this.files.glbFile) this.lib.picked({ model, ...(this.files.thumbFile ? { thumbnail: this.files.thumbFile } : {}), glb: this.files.glbFile, ...previewTrust(model, this.record) });
        return;
      }
      case "prices":
        return answer(this.panel?.webview, m.ask, () => this.prices());
      case "signIn":
        return this.host.signIn?.();
    }
  }

  /** The back control: the list it came from comes to the front, and the detail closes (as a page does on back). */
  async goBack() {
    const origin = this.origin;
    if (!origin) return;
    const panel = this.panel;
    await this.lib.back(origin);
    panel?.dispose();
  }

  dispose() {
    this.panel?.dispose();
  }
}
