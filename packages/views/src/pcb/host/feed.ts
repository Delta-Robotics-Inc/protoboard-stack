/**
 * A board feed (Node): one host process's read-only view of one board folder, as `BoardFeedMessage`s for pages.
 *
 * - With a live board service (`protoboard board serve`, its `service.json`), it is that service's wire client:
 *   commits arrive as events, and the feed asks the service for the records they changed so the page applies
 *   them without reloading the board.
 * - Without one, it reads the board's files (no owner lock, no journal: it never writes and never stands in the
 *   way of a service or a CLI call) and reloads them when they change on disk; it looks for a service now and
 *   then, and switches to it when one starts.
 * - After every change it runs the checks (./analysis.ts) and sends the derived data. KiCad's DRC of the source
 *   file runs once per feed (and on `recheck`); each new result of ours is compared with that one run.
 *
 * Messages go to every subscriber; a new subscriber first gets the current snapshot and derived data.
 */
import { watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import { BoardIndex, connectBoard, findProjectRoot, findService, openBoardService, snapshotToWire, withChanges, type BoardClient, type BoardEvent, type BoardSnapshot } from "@protoboardai/board/node";
import type { BoardDerived, BoardFeedMessage } from "../types.js";
import { analyzeBoard, logTail, toBoardDerived, type AnalyzeOptions, type KicadReference } from "./analysis.js";

export interface BoardFeedOptions {
  /** The board folder. */
  dir: string;
  /** The key pages name the board by (DEFAULT the folder path). */
  key?: string;
  projectRoot?: string;
  /** Passed to the checks (`crossCheck`, `kicadPcb`, `kicadRoot`). */
  analyze?: Pick<AnalyzeOptions, "crossCheck" | "kicadPcb" | "kicadRoot">;
  /** Quiet time after a change before the checks run (DEFAULT 250 ms). */
  debounceMs?: number;
  /** How often to look for a service while reading files (DEFAULT 2 s; 0: never). */
  servicePollMs?: number;
  log?: (line: string) => void;
}

export class BoardFeed {
  readonly key: string;
  readonly dir: string;
  private readonly root: string;
  private mode: "service" | "files" = "files";
  private client: BoardClient | undefined;
  private unsubscribeClient: (() => void) | undefined;
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

  private constructor(private readonly options: BoardFeedOptions) {
    this.dir = resolve(options.dir);
    this.key = options.key ?? this.dir;
    this.root = options.projectRoot ?? findProjectRoot(this.dir);
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

  get current(): { mode: "service" | "files"; snapshot: BoardSnapshot; derived?: BoardDerived } {
    return { mode: this.mode, snapshot: this.snap, ...(this.derived ? { derived: this.derived } : {}) };
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
    this.watcher?.close();
    this.unsubscribeClient?.();
    const c = this.client;
    this.client = undefined;
    await c?.close();
    this.listeners.clear();
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
    this.watcher?.close();
    this.watcher = undefined;
    this.client = client;
    this.mode = "service";
    this.snap = await client.snapshot();
    this.presence = await client.presence();
    this.log = logTail(await client.log());
    this.unsubscribeClient = client.subscribe((e) => {
      this.chain = this.chain.then(() => this.onServiceEvent(e)).catch((err: Error) => this.fail(err));
    });
    this.broadcast(this.snapshotMessage());
    this.say(`board feed ${this.key}: attached to the board service`);
    void this.watchServiceEnd(client);
    return true;
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
      // a commit that skipped one (missed while reconnecting) is a reload, not an update
      if (e.epoch !== this.snap.epoch || e.seq !== this.snap.seq + 1) {
        this.snap = await client.snapshot();
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

  private scheduleCheck(ms = this.options.debounceMs ?? 250): void {
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => void this.runChecks().catch((e: Error) => this.fail(e)), ms);
  }

  private async runChecks(): Promise<void> {
    if (this.closed) return;
    const run = ++this.analyzing;
    const snap = this.snap;
    const fresh = !this.kicad;
    // KiCad's DRC of the source file runs once and blocks this process for seconds (kicad-cli is run synchronously):
    // our own checks go out first, so the page draws and counts at once; KiCad's numbers follow a moment later
    const wantsKicad = fresh && this.options.analyze?.crossCheck !== false;
    const a = await analyzeBoard(snap, this.dir, { projectRoot: this.root, ...this.options.analyze, ...(this.kicad ? { kicad: this.kicad } : wantsKicad ? { crossCheck: false } : {}) });
    if (run !== this.analyzing || this.closed || snap !== this.snap) return;
    if (a.kicad) this.kicad = a.kicad;
    if (fresh && a.kicad?.run) this.crossCheckSeq = snap.seq;
    this.derived = toBoardDerived(snap, a, { at: new Date().toISOString(), ...(this.crossCheckSeq !== undefined ? { crossCheckSeq: this.crossCheckSeq } : {}) });
    this.broadcast({ type: "derived", board: this.key, derived: this.derived });
    if (wantsKicad && !this.kicad) {
      const t = setTimeout(() => {
        if (run !== this.analyzing || this.closed) return;
        void (async () => {
          const k = await analyzeBoard(this.snap, this.dir, { projectRoot: this.root, ...this.options.analyze });
          if (this.closed) return;
          // no source file, no kicad-cli: remember that it was tried, so a commit does not try again
          this.kicad = k.kicad ?? { pcbPath: "", reason: k.crossCheck && !k.crossCheck.ran ? k.crossCheck.reason : "no KiCad board file is known for this board" };
          if (k.kicad?.run) this.crossCheckSeq = this.snap.seq;
          if (run !== this.analyzing) return this.scheduleCheck(0);
          this.derived = toBoardDerived(this.snap, k, { at: new Date().toISOString(), ...(this.crossCheckSeq !== undefined ? { crossCheckSeq: this.crossCheckSeq } : {}) });
          this.broadcast({ type: "derived", board: this.key, derived: this.derived });
        })().catch((e: Error) => this.fail(e));
      }, 300);
      t.unref?.();
    }
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
