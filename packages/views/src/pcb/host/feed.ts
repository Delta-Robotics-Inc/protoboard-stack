/**
 * A board feed (Node): one host process's view of one board folder, as `BoardFeedMessage`s for pages, and the
 * host's side of a page's requests (`request`: transactions, undo, redo, saves, checkpoints, replay, autoroute runs,
 * routing diagnosis, waivers).
 *
 * - With a live board service (`protoboard board serve`, its `service.json`), it is that service's wire client:
 *   commits arrive as events, and the feed asks the service for the records they changed so the page applies
 *   them without reloading the board.
 * - Without one, it reads the board's files (no owner lock, no journal: it never stands in the way of a service or
 *   a CLI call) and reloads them when they change on disk; it looks for a service now and then, and switches to it
 *   when one starts. The first write a page asks for opens the board here as its owner and serves it
 *   (`serveBoard`, `service.json`), so the CLI and agents become its clients; closing the feed saves and stops it.
 * - After every change it computes the zone fill (`@protoboardai/board-fill`, incrementally) when the board has
 *   zones and has been edited, runs the checks (./analysis.ts) and sends the derived data with each check run's
 *   counts by seq (the timeline's error line). KiCad's DRC of the source file runs once per feed (and on
 *   `recheck`); each new result of ours is compared with that one run.
 *
 * Who acts is the host's decision: `request(req, actor)` takes the actor from the host (a person at the screen is
 * `human`), never from the page.
 */
import { watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import {
  BoardIndex,
  BoardLockedError,
  connectBoard,
  findProjectRoot,
  findService,
  loadZoneFill,
  localClient,
  openBoardService,
  serveBoard,
  snapshotToWire,
  withChanges,
  type Actor,
  type BoardClient,
  type BoardDocument,
  type BoardEvent,
  type BoardServer,
  type BoardService,
  type BoardSnapshot,
  type LogEntry,
  type OpCall,
  type Transaction,
} from "@protoboardai/board/node";
import type * as FillModule from "@protoboardai/board-fill";
import type { BoardDerived, BoardFeedMessage, BoardReplyMessage, BoardRequest, CheckPoint } from "../types.js";
import { readWaivers, waiverRule, waiverRuleId } from "../waivers.js";
import { analyzeBoard, logTail, toBoardDerived, type AnalyzeOptions, type KicadReference } from "./analysis.js";
import { commitBoardFolder } from "./git.js";
import { diagnoseNet, loadFillModule, RouteRuns, routerInfo } from "./route.js";

export interface BoardFeedOptions {
  /** The board folder. */
  dir: string;
  /** The key pages name the board by (DEFAULT the folder path). */
  key?: string;
  projectRoot?: string;
  /** Passed to the checks (`crossCheck`, `kicadPcb`, `kicadRoot`). */
  analyze?: Pick<AnalyzeOptions, "crossCheck" | "kicadPcb" | "kicadRoot">;
  /** Quiet time after a change before the checks run (DEFAULT 120 ms). */
  debounceMs?: number;
  /** How often to look for a service while reading files (DEFAULT 2 s; 0: never). */
  servicePollMs?: number;
  /**
   * Whether the feed may open the board as its owner for a page's first write when no service runs (DEFAULT true).
   * False: writes need a running service.
   */
  ownOnWrite?: boolean;
  /** Browser origins the served board allows (when this feed owns it). */
  origins?: string[];
  log?: (line: string) => void;
}

const HISTORY_CAP = 500;
const hasZones = (doc: BoardDocument) => {
  for (const r of doc.records.values()) if (r.kind === "zone") return true;
  return false;
};

/** The board as it was at `seq`, rebuilt from the current document and the log's inverse operations. */
export function docAtSeq(doc: BoardDocument, log: readonly LogEntry[], current: number, seq: number): BoardDocument {
  if (seq > current) throw new Error(`seq ${seq} is ahead of the board (seq ${current})`);
  if (seq === current) return doc;
  const after = log.filter((e) => e.seq > seq).sort((a, b) => b.seq - a.seq);
  const reach = log.length ? Math.min(...log.map((e) => e.seq)) - 1 : current;
  if (seq < reach || after.length !== current - seq) throw new Error(`the log reaches back to seq ${reach} in this session; seq ${seq} is before it`);
  let d = doc;
  for (const e of after)
    for (const op of e.inverse as OpCall[]) {
      if (op.op === "record.put") d = withChanges(d, op.records as never[]);
      else if (op.op === "record.remove") d = withChanges(d, [], op.ids as string[]);
      else throw new Error(`an inverse of seq ${e.seq} is ${op.op}, not a record operation`);
    }
  return d;
}

export class BoardFeed {
  readonly key: string;
  readonly dir: string;
  private readonly root: string;
  private mode: "service" | "files" = "files";
  private client: BoardClient | undefined;
  private unsubscribeClient: (() => void) | undefined;
  /** When this feed owns the board (opened it for a write): the service and its server. */
  private owned: { svc: BoardService; server: BoardServer } | undefined;
  private snap!: BoardSnapshot;
  private presence: Extract<BoardFeedMessage, { type: "snapshot" }>["presence"];
  private log: Extract<BoardFeedMessage, { type: "snapshot" }>["log"];
  private derived: BoardDerived | undefined;
  private kicad: KicadReference | undefined;
  private crossCheckSeq: number | undefined;
  private readonly listeners = new Set<(m: BoardFeedMessage) => void>();
  private watcher: FSWatcher | undefined;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private checkTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  /** Commits are applied in order: each waits for the one before. */
  private chain: Promise<void> = Promise.resolve();
  private analyzing = 0;
  private closed = false;
  private readonly history: CheckPoint[] = [];
  /** Ids changed since the last fill (for an incremental refill); `all` after a reload. */
  private fillChanged: Set<string> | "all" = new Set();
  /** Whether the board changed in this feed (then the fill is computed, not read from the source tool's cache). */
  private edited = false;
  private fillResult: (FillModule.FillZonesResult & { seq: number; epoch: string }) | undefined;
  private readonly routes: RouteRuns;
  private readonly notesExtra: string[] = [];
  private writable: Promise<BoardClient> | undefined;

  private constructor(private readonly options: BoardFeedOptions) {
    this.dir = resolve(options.dir);
    this.key = options.key ?? this.dir;
    this.root = options.projectRoot ?? findProjectRoot(this.dir);
    this.routes = new RouteRuns((m) => this.broadcast({ type: "route", board: this.key, ...m }));
  }

  /** Open a feed: the live service when there is one, else the files. Resolves with the first snapshot read. */
  static async open(options: BoardFeedOptions): Promise<BoardFeed> {
    const f = new BoardFeed(options);
    if (!(await f.attachService())) f.readFiles();
    f.scheduleCheck(0);
    if ((options.servicePollMs ?? 2000) > 0) {
      f.pollTimer = setInterval(() => {
        if (f.mode === "files" && !f.closed && findService(f.dir, f.root)) void f.attachService().then((ok) => ok && f.scheduleCheck(0));
      }, options.servicePollMs ?? 2000);
      f.pollTimer.unref?.();
    }
    return f;
  }

  get current(): { mode: "service" | "files"; snapshot: BoardSnapshot; derived?: BoardDerived; owned: boolean } {
    return { mode: this.mode, snapshot: this.snap, ...(this.derived ? { derived: this.derived } : {}), owned: !!this.owned };
  }

  /** Every message from now on; the current snapshot (and derived data) first. */
  subscribe(listener: (m: BoardFeedMessage) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshotMessage());
    if (this.derived) listener({ type: "derived", board: this.key, derived: this.derived });
    return () => void this.listeners.delete(listener);
  }

  get subscribers(): number {
    return this.listeners.size;
  }

  /** Run the checks again, and KiCad's DRC of the source file too. */
  recheck(): void {
    this.kicad = undefined;
    this.scheduleCheck(0);
  }

  /** The derived data for the current snapshot, computing it when it is missing or stale. */
  async derivedNow(): Promise<BoardDerived> {
    if (this.derived && this.derived.seq === this.snap.seq && this.derived.epoch === this.snap.epoch) return this.derived;
    await this.runChecks();
    return this.derived!;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.reloadTimer);
    clearTimeout(this.checkTimer);
    clearInterval(this.pollTimer);
    this.routes.close();
    this.watcher?.close();
    this.unsubscribeClient?.();
    const c = this.client;
    this.client = undefined;
    if (this.owned) {
      const { svc, server } = this.owned;
      this.owned = undefined;
      await server.close().catch(() => {});
      // the service saves on close (contract section 10), as `protoboard board serve` does when it stops
      try {
        svc.close();
      } catch (e) {
        this.say(`board feed ${this.key}: saving on close failed: ${(e as Error).message}`);
      }
    } else await c?.close();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ requests

  /**
   * Do what a page asked, as `actor` (the host's choice: a person at the screen is `human`). Writes open the board
   * as its owner when no service runs (unless `ownOnWrite` is false).
   */
  async request(req: BoardRequest, actor: Actor): Promise<BoardReplyMessage> {
    if (this.closed) return { ok: false, error: "the board feed is closed" };
    try {
      return { ok: true, result: await this.handle(req, actor) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async handle(req: BoardRequest, actor: Actor): Promise<unknown> {
    switch (req.method) {
      case "apply": {
        const c = await this.ensureWritable();
        const t = req.tx;
        const tx: Transaction = {
          batchId: t.batchId,
          label: t.label,
          ops: t.ops,
          ...(t.changeSet ? { changeSet: t.changeSet } : {}),
          ...(t.expectEpoch !== undefined ? { expectEpoch: t.expectEpoch } : {}),
          ...(t.expectSeq !== undefined ? { expectSeq: t.expectSeq } : {}),
          ...(t.expectVersions ? { expectVersions: t.expectVersions } : {}),
          ...(t.dryRun ? { dryRun: true } : {}),
        };
        return c.apply(tx, actor);
      }
      case "undo":
        return (await this.ensureWritable()).undo(actor, req.batchId ? { batchId: req.batchId } : undefined);
      case "redo":
        return (await this.ensureWritable()).redo(actor, req.batchId ? { batchId: req.batchId } : undefined);
      case "revertChangeSet":
        return (await this.ensureWritable()).revertChangeSet(actor, req.id, req.batchId ? { batchId: req.batchId } : undefined);
      case "takeOver":
        return (await this.ensureWritable()).takeOver(actor);
      case "save": {
        const r = await (await this.ensureWritable()).save();
        await this.persistFill();
        return r;
      }
      case "checkpoint": {
        const r = await (await this.ensureWritable()).checkpoint(req.label);
        await this.persistFill();
        if (!r.refused.length) this.broadcast({ type: "checkpoint", board: this.key, seq: r.seq, label: r.label });
        return r;
      }
      case "commit": {
        const r = await commitBoardFolder(this.dir, req.message);
        this.broadcast({ type: "checkpoint", board: this.key, seq: this.snap.seq, label: req.message.split("\n")[0], committed: r.commit });
        return r;
      }
      case "at": {
        const log = this.client ? await this.client.log() : [];
        const doc = docAtSeq(this.snap.doc, log, this.snap.seq, req.seq);
        let index: BoardIndex | undefined;
        const s: BoardSnapshot = { epoch: this.snap.epoch, seq: req.seq, doc, version: () => 0, get query() { return (index ??= BoardIndex.build(doc)); } };
        const a = await analyzeBoard(s, this.dir, { projectRoot: this.root, crossCheck: false, ...(hasZones(doc) ? await this.fillFor(s, true) : {}) });
        return { snapshot: snapshotToWire(s), derived: toBoardDerived(s, a, {}) };
      }
      case "routers":
        return routerInfo();
      case "route":
        return { run: await this.routes.start(this.snap, { scope: req.scope, ...(req.budgetMs ? { budgetMs: req.budgetMs } : {}) }) };
      case "routeCancel":
        return { cancelled: this.routes.cancel(req.run) };
      case "routeReject":
        return { rejected: this.routes.reject(req.run) };
      case "routeAccept": {
        const c = await this.ensureWritable();
        const before = this.snap.doc;
        return this.routes.accept(req.run, (tx, a) => c.apply(tx, a), before, async () => (await c.snapshot()).doc);
      }
      case "diagnose":
        return diagnoseNet(this.snap, req.net, req.budgetMs ? { budgetMs: req.budgetMs } : {});
      case "waive": {
        const d = this.derived;
        const f = d?.findings.find((x) => x.id === req.finding);
        if (!f) throw new Error(`no open finding ${req.finding} at seq ${d?.seq ?? this.snap.seq} (it may be fixed already, or the board moved on)`);
        const c = await this.ensureWritable();
        return c.apply({ batchId: `waive-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, label: `mark ${f.check} not a problem`, ops: [{ op: "rule.set", rule: waiverRule(f, req.reason) }] }, actor);
      }
      case "unwaive": {
        const w = readWaivers(this.snap.doc).get(req.finding);
        const id = w?.rule ?? waiverRuleId(req.finding);
        if (!this.snap.doc.records.has(id)) throw new Error(`no waiver for ${req.finding}`);
        const c = await this.ensureWritable();
        return c.apply({ batchId: `unwaive-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, label: "take back a not a problem", ops: [{ op: "rule.delete", ids: [id] }] }, actor);
      }
    }
  }

  /** A client that can write: the live service, or the board opened here as its owner and served. */
  private ensureWritable(): Promise<BoardClient> {
    if (this.mode === "service" && this.client) return Promise.resolve(this.client);
    if (this.options.ownOnWrite === false) return Promise.reject(new Error("no board service is running for this board, and this host does not open boards for writing: start one with `protoboard board serve`"));
    this.writable ??= this.takeOwnership().finally(() => (this.writable = undefined));
    return this.writable;
  }

  private async takeOwnership(): Promise<BoardClient> {
    for (let attempt = 0; attempt < 10; attempt++) {
      if (await this.attachService()) return this.client!;
      let svc: BoardService;
      try {
        svc = openBoardService({ dir: this.dir, projectRoot: this.root });
      } catch (e) {
        // another process owns it and is about to write service.json (a service starting, a CLI call)
        if (e instanceof BoardLockedError) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        throw e;
      }
      let server: BoardServer;
      try {
        server = await serveBoard(svc, { ...(this.options.origins ? { origins: this.options.origins } : {}), log: (l) => this.say(`board service ${this.key}: ${l}`) });
      } catch (e) {
        svc.close({ save: false });
        throw e;
      }
      if (svc.recoverable()) this.notesExtra.push(`${svc.recoverable()} journal entr${svc.recoverable() === 1 ? "y" : "ies"} of an earlier session never reached the files; \`protoboard board serve --recover\` replays them`);
      this.owned = { svc, server };
      this.attachClient(localClient(svc, { dir: this.dir, closeService: false }), await Promise.resolve(svc.snapshot()));
      this.say(`board feed ${this.key}: opened the board for writing and serving it (pid ${process.pid})`);
      return this.client!;
    }
    throw new Error("another process holds the board and did not start a service; try again in a moment");
  }

  // ------------------------------------------------------------------ sources

  private async attachService(): Promise<boolean> {
    if (!findService(this.dir, this.root)) return false;
    let client: BoardClient;
    try {
      client = await connectBoard(this.dir, { mode: "service", projectRoot: this.root });
    } catch (e) {
      this.say(`board feed ${this.key}: the service did not answer (${(e as Error).message}); reading the files`);
      return false;
    }
    this.attachClient(client, await client.snapshot());
    this.say(`board feed ${this.key}: attached to the board service`);
    void this.watchServiceEnd(client);
    return true;
  }

  private attachClient(client: BoardClient, snap: BoardSnapshot): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.unsubscribeClient?.();
    this.client = client;
    this.mode = "service";
    const reloaded = !this.snap || this.snap.epoch !== snap.epoch || this.snap.seq !== snap.seq;
    this.snap = snap;
    if (reloaded) this.fillChanged = "all";
    void (async () => {
      this.presence = await client.presence();
      this.log = logTail(await client.log());
      this.broadcast(this.snapshotMessage());
    })().catch((e: Error) => this.fail(e));
    this.unsubscribeClient = client.subscribe((e) => {
      this.chain = this.chain.then(() => this.onServiceEvent(e)).catch((err: Error) => this.fail(err));
    });
    // a new epoch is a new board version: its derived data follows at once
    if (reloaded) this.scheduleCheck(0);
  }

  /** When the service goes away, fall back to the files. */
  private async watchServiceEnd(client: BoardClient): Promise<void> {
    while (!this.closed && this.client === client) {
      await new Promise((r) => setTimeout(r, 1500).unref?.());
      if (this.closed || this.client !== client) return;
      try {
        await client.call("board.presence", {});
      } catch {
        this.unsubscribeClient?.();
        this.client = undefined;
        await client.close().catch(() => {});
        this.say(`board feed ${this.key}: the service stopped; reading the files`);
        this.readFiles();
        this.scheduleCheck(0);
        return;
      }
    }
  }

  private async onServiceEvent(e: BoardEvent): Promise<void> {
    const client = this.client;
    if (!client || this.closed) return;
    if (e.type === "commit") {
      const ids = [...new Set([...e.changed, ...Object.values(e.created)])].filter((id) => !e.removed.includes(id));
      const q = ids.length ? await client.query({ by: "id", ids, records: true }) : undefined;
      const puts = (q?.records ?? []).filter((r) => ids.includes(r.id));
      const versions = Object.fromEntries(ids.map((id) => [id, q?.versions?.[id] ?? 0]));
      this.log = logTail(await client.log());
      this.edited = true;
      if (this.fillChanged !== "all") for (const id of [...ids, ...e.removed]) this.fillChanged.add(id);
      // a commit that skipped one (missed while reconnecting) is a reload, not an update
      if (e.epoch !== this.snap.epoch || e.seq !== this.snap.seq + 1) {
        this.snap = await client.snapshot();
        this.fillChanged = "all";
        this.broadcast(this.snapshotMessage());
      } else {
        // the board moves by the commit's records here too: no whole board crosses the wire per commit
        const doc = withChanges(this.snap.doc, puts, e.removed);
        const prev = this.snap;
        const vs = new Map(Object.entries(versions));
        let index: BoardIndex | undefined;
        this.snap = {
          epoch: e.epoch,
          seq: e.seq,
          doc,
          version: (id: string) => (vs.has(id) ? vs.get(id)! : e.removed.includes(id) ? 0 : prev.version(id)),
          get query() {
            return (index ??= BoardIndex.build(doc));
          },
        };
        this.broadcast({ type: "commit", board: this.key, event: e, puts, removes: e.removed, versions, ...(this.log ? { log: this.log } : {}) });
      }
      this.scheduleCheck();
    } else if (e.type === "presence") {
      this.presence = e.presence;
      this.broadcast({ type: "presence", board: this.key, presence: e.presence });
    } else if (e.type === "saved") this.broadcast({ type: "saved", board: this.key, seq: e.seq, files: e.files });
    else if (e.type === "external-change") {
      this.snap = await client.snapshot();
      this.fillChanged = "all";
      this.broadcast(this.snapshotMessage());
      this.scheduleCheck();
    }
  }

  private readFiles(): void {
    this.mode = "files";
    const svc = openBoardService({ dir: this.dir, projectRoot: this.root, journal: false, ownerLock: false });
    try {
      this.snap = svc.snapshot();
      this.presence = undefined;
      this.log = undefined;
      this.fillChanged = "all";
    } finally {
      svc.close({ save: false });
    }
    this.broadcast(this.snapshotMessage());
    if (!this.watcher) {
      try {
        this.watcher = watch(this.dir, { persistent: false }, (_ev, name) => {
          if (this.mode !== "files" || (name && !/\.jsonl$/i.test(String(name)))) return;
          clearTimeout(this.reloadTimer);
          this.reloadTimer = setTimeout(() => {
            if (this.closed || this.mode !== "files") return;
            try {
              this.readFiles();
              this.scheduleCheck();
            } catch (e) {
              // a file caught half-written: the next change event reads it again
              this.fail(e as Error);
            }
          }, 300);
        });
      } catch (e) {
        this.say(`board feed ${this.key}: cannot watch the folder (${(e as Error).message}); changes on disk will not show until it is opened again`);
      }
    }
  }

  // ------------------------------------------------------------------ derived

  private scheduleCheck(ms = this.options.debounceMs ?? 120): void {
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => void this.runChecks().catch((e: Error) => this.fail(e)), ms);
  }

  /**
   * The zone fill to check a snapshot with: the source tool's cached fill until the board is edited here (then it
   * would be silently out of date), a computed one after (incrementally from the last when the epoch is the same).
   */
  private async fillFor(s: BoardSnapshot, oneOff = false): Promise<{ fill?: FillModule.FillZonesResult["fill"] }> {
    if (!hasZones(s.doc)) return {};
    // the source tool's own fill while it is current and the board is as imported; otherwise one is computed (a
    // board with zones and no fill would connect nothing through its pours)
    if (!this.edited && !oneOff) {
      const cached = loadZoneFill(this.dir, s.doc, this.root);
      if (cached?.current) return {};
    }
    const mod = await loadFillModule();
    if (!mod) return {};
    if (oneOff) return { fill: mod.fillZones(s).fill };
    const prev = this.fillResult;
    const changed = this.fillChanged;
    this.fillChanged = new Set();
    let r: FillModule.FillZonesResult;
    if (prev && prev.epoch === s.epoch && changed !== "all") r = mod.refillZones(s, prev, [...changed]);
    else r = mod.fillZones(s);
    this.fillResult = { ...r, seq: s.seq, epoch: s.epoch };
    return { fill: r.fill };
  }

  /** Write the computed fill beside the board's derived data (a save keeps the cache in step with the files). */
  private async persistFill(): Promise<void> {
    const r = this.fillResult;
    if (!r || r.seq !== this.snap.seq || r.epoch !== this.snap.epoch) return;
    const mod = await loadFillModule();
    try {
      mod?.writeComputedFill(this.dir, r, this.root);
    } catch (e) {
      this.say(`board feed ${this.key}: the computed zone fill was not written: ${(e as Error).message}`);
    }
  }

  private async runChecks(): Promise<void> {
    if (this.closed) return;
    const run = ++this.analyzing;
    const snap = this.snap;
    const fresh = !this.kicad;
    // KiCad's DRC of the source file runs once and blocks this process for seconds (kicad-cli is run synchronously):
    // our own checks go out first, so the page draws and counts at once; KiCad's numbers follow a moment later
    const wantsKicad = fresh && this.options.analyze?.crossCheck !== false;
    const tf = performance.now();
    const fill = await this.fillFor(snap);
    const fillMs = fill.fill ? Math.round(performance.now() - tf) : undefined;
    const a = await analyzeBoard(snap, this.dir, { projectRoot: this.root, ...this.options.analyze, ...fill, ...(this.kicad ? { kicad: this.kicad } : wantsKicad ? { crossCheck: false } : {}) });
    if (run !== this.analyzing || this.closed || snap !== this.snap) return;
    if (a.kicad) this.kicad = a.kicad;
    if (fresh && a.kicad?.run) this.crossCheckSeq = snap.seq;
    this.publish(snap, a, fillMs);
    if (wantsKicad && !this.kicad) {
      const t = setTimeout(() => {
        if (run !== this.analyzing || this.closed) return;
        void (async () => {
          const s = this.snap;
          const k = await analyzeBoard(s, this.dir, { projectRoot: this.root, ...this.options.analyze, ...(this.fillResult && this.fillResult.seq === s.seq ? { fill: this.fillResult.fill } : {}) });
          if (this.closed) return;
          // no source file, no kicad-cli: remember that it was tried, so a commit does not try again
          this.kicad = k.kicad ?? { pcbPath: "", reason: k.crossCheck && !k.crossCheck.ran ? k.crossCheck.reason : "no KiCad board file is known for this board" };
          if (k.kicad?.run) this.crossCheckSeq = s.seq;
          if (run !== this.analyzing || s !== this.snap) return this.scheduleCheck(0);
          this.publish(s, k, undefined);
        })().catch((e: Error) => this.fail(e));
      }, 300);
      t.unref?.();
    }
  }

  private publish(snap: BoardSnapshot, a: Awaited<ReturnType<typeof analyzeBoard>>, fillMs: number | undefined): void {
    const d = toBoardDerived(snap, a, { at: new Date().toISOString(), ...(this.crossCheckSeq !== undefined ? { crossCheckSeq: this.crossCheckSeq } : {}) });
    if (d.checks.ran) {
      const point: CheckPoint = { seq: snap.seq, errors: d.checks.errors, warnings: d.checks.warnings, unconnected: d.checks.unconnected };
      const i = this.history.findIndex((h) => h.seq === snap.seq);
      if (i >= 0) this.history[i] = point;
      else this.history.push(point);
      // a new epoch starts the line again
      if (this.history.length > 1 && this.history[this.history.length - 2].seq > snap.seq) this.history.splice(0, this.history.length - 1);
      if (this.history.length > HISTORY_CAP) this.history.splice(0, this.history.length - HISTORY_CAP);
    }
    if (d.fill) d.fill = { ...d.fill, seq: snap.seq, ...(fillMs !== undefined ? { ms: fillMs } : {}) };
    this.derived = { ...d, history: [...this.history], ...(this.notesExtra.length ? { notes: [...(d.notes ?? []), ...this.notesExtra] } : {}) };
    this.broadcast({ type: "derived", board: this.key, derived: this.derived });
  }

  // ------------------------------------------------------------------ out

  private snapshotMessage(): Extract<BoardFeedMessage, { type: "snapshot" }> {
    return { type: "snapshot", board: this.key, mode: this.mode, snapshot: snapshotToWire(this.snap), ...(this.presence ? { presence: this.presence } : {}), ...(this.log ? { log: this.log } : {}) };
  }

  private broadcast(m: BoardFeedMessage): void {
    for (const l of [...this.listeners]) {
      try {
        l(m);
      } catch (e) {
        this.say(`board feed ${this.key}: a subscriber failed: ${(e as Error).message}`);
      }
    }
  }

  private fail(e: Error): void {
    this.say(`board feed ${this.key}: ${e.message}`);
    this.broadcast({ type: "error", board: this.key, message: e.message });
  }

  private say(line: string): void {
    this.options.log?.(line);
  }
}

