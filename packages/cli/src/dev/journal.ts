/**
 * The on-disk journal of the 3D view's op log (PB-1196, collaboration D4):
 * `.protoboard/local/scene-oplog.jsonl` (git-ignored with `.protoboard/local/`).
 *
 * The scene's owner (a live tab's view store, or the render service's
 * headless page) keeps the log in memory; the process that relays to it (the
 * `protoboard dev` server's bridge, the render service's batch route) asks
 * for the entries after the last one it wrote (`since`) on every agent call
 * and appends them here, one JSON object per line, with a checkpoint of the
 * store every `checkpointEvery` entries. The format is uhd-viewer's
 * (`src/cad/state/journal.ts`, which also replays it):
 *
 *   {"t":"entry", "tab", "epoch", "seq", "time", "actor", "label", "ops", "inverse", "keys", "touched", ...}
 *   {"t":"checkpoint", "tab", "epoch", "seq", "state", "versions", "nextId", "retired", "leases", ...}
 *   {"t":"checkpoint-omitted", "tab", "epoch", "seq", "omitted": {bytes}}   (a checkpoint too large to keep)
 *
 * Several writers, one file (W4-D, wave 3 carry-forward): the dev server
 * (its tabs) and the render service (its headless page) may both write. Every
 * append and every compaction holds the journal's lock
 * (`scene-oplog.jsonl.lock`, made exclusively; a lock older than
 * `LOCK_STALE_MS` or whose process is gone is taken over). A writer that
 * cannot get the lock in time writes nothing and keeps its marks, so the next
 * call asks the store for the same entries again: nothing is lost, nothing is
 * written twice (replay skips a repeated seq).
 *
 * Size cap (DEFAULT 4 MiB): past it the file is rewritten (temp file and
 * rename) keeping, PER TAB, its newest checkpoint and what follows (a tab
 * without one keeps its newest half), so one writer's compaction never drops
 * another tab's base. An entry line over 64 kB keeps its header and drops its
 * values (`omitted`); a checkpoint over 1 MiB becomes a `checkpoint-omitted`
 * line, which is never taken as a base. A restarted writer reads the file's
 * tail for each tab's last epoch and seq (`seedMarks`), so it does not append
 * what is already there. The person's gestures between two agent calls arrive
 * with the next call: the journal is complete up to the last call.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

export const JOURNAL_FILE = join(".protoboard", "local", "scene-oplog.jsonl");
/** DEFAULT: the journal is compacted past this size. */
export const JOURNAL_MAX_BYTES = 4 * 1024 * 1024;
/** DEFAULT: a checkpoint every this many entries per tab. */
export const CHECKPOINT_EVERY = 200;
/** DEFAULT: one entry line at most this long; a longer entry keeps its header only. */
export const MAX_LINE_BYTES = 64 * 1024;
/** DEFAULT (W4-D): one checkpoint line at most this long; a longer one is kept as a `checkpoint-omitted` line (no base). */
export const MAX_CHECKPOINT_BYTES = 1024 * 1024;
/** DEFAULT (W4-D): a writer waits this long for the lock, then writes nothing this time. */
export const LOCK_WAIT_MS = 2000;
/** DEFAULT (W4-D): a lock older than this is stale (its writer died between taking and freeing it). */
export const LOCK_STALE_MS = 10_000;
/** DEFAULT (W4-D): how much of the file's tail a writer reads at start for its marks. */
export const SEED_TAIL_BYTES = 1024 * 1024;

interface TabMark {
  epoch: string;
  seq: number;
  /** Entries written since this epoch's last checkpoint (Infinity: none yet). */
  sinceCheckpoint: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Sleep without an event loop turn (the journal is written from synchronous code). */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* spin */
    }
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class Journal {
  readonly file: string;
  readonly lockFile: string;
  private readonly marks = new Map<string, TabMark>();
  private readonly maxBytes: number;
  private readonly every: number;
  private readonly lockWaitMs: number;

  constructor(root: string, options: { maxBytes?: number; checkpointEvery?: number; lockWaitMs?: number } = {}) {
    this.file = join(root, JOURNAL_FILE);
    this.lockFile = `${this.file}.lock`;
    this.maxBytes = options.maxBytes ?? JOURNAL_MAX_BYTES;
    this.every = options.checkpointEvery ?? CHECKPOINT_EVERY;
    this.lockWaitMs = options.lockWaitMs ?? LOCK_WAIT_MS;
    this.seedMarks();
  }

  /** The last entry written for a tab (a new tab: nothing, so the store sends all it has). */
  since(tab: string): { epoch: string; seq: number } | undefined {
    const m = this.marks.get(tab);
    return m ? { epoch: m.epoch, seq: m.seq } : undefined;
  }

  /** Whether the next reply from `tab` should carry a checkpoint. */
  wantCheckpoint(tab: string): boolean {
    const m = this.marks.get(tab);
    return !m || m.sinceCheckpoint >= this.every;
  }

  /**
   * Each tab's last epoch and seq from the file's tail (W4-D: a restarted writer appended the same entries again).
   * A tab whose last line is not readable starts from nothing (its store sends what it has; replay skips repeats).
   */
  private seedMarks(): void {
    let text = "";
    try {
      const size = statSync(this.file).size;
      const fd = openSync(this.file, "r");
      try {
        const len = Math.min(size, SEED_TAIL_BYTES);
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, size - len);
        text = buf.toString("utf8");
        // a tail that starts mid-line: drop the partial first line
        if (len < size) text = text.slice(text.indexOf("\n") + 1);
      } finally {
        closeSync(fd);
      }
    } catch {
      return;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      let o: unknown;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isObj(o) || typeof o.tab !== "string" || typeof o.epoch !== "string" || !Number.isInteger(o.seq)) continue;
      const tab = o.tab;
      let m = this.marks.get(tab);
      if (!m || m.epoch !== o.epoch) m = { epoch: o.epoch, seq: 0, sinceCheckpoint: Number.POSITIVE_INFINITY };
      if (o.t === "entry") {
        m.seq = Math.max(m.seq, o.seq as number);
        m.sinceCheckpoint++;
      } else if (o.t === "checkpoint") {
        m.seq = Math.max(m.seq, o.seq as number);
        m.sinceCheckpoint = 0;
      }
      this.marks.set(tab, m);
    }
  }

  /** Take the journal's lock (true), or give up after `lockWaitMs` (false). */
  private lock(): boolean {
    mkdirSync(dirname(this.file), { recursive: true });
    const until = Date.now() + this.lockWaitMs;
    for (;;) {
      try {
        const fd = openSync(this.lockFile, "wx", 0o600);
        writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
        closeSync(fd);
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") return false;
      }
      // a stale lock: its writer is gone, or it is older than LOCK_STALE_MS
      try {
        const held = JSON.parse(readFileSync(this.lockFile, "utf8")) as { pid?: number; at?: number };
        if (!processAlive(Number(held.pid)) || Date.now() - Number(held.at) > LOCK_STALE_MS) {
          rmSync(this.lockFile, { force: true });
          continue;
        }
      } catch {
        // a lock being written right now, or unreadable: wait for it
        try {
          if (Date.now() - statSync(this.lockFile).mtimeMs > LOCK_STALE_MS) {
            rmSync(this.lockFile, { force: true });
            continue;
          }
        } catch {
          continue;
        }
      }
      if (Date.now() >= until) return false;
      sleepSync(15);
    }
  }

  private unlock(): void {
    try {
      const held = JSON.parse(readFileSync(this.lockFile, "utf8")) as { pid?: number };
      if (held.pid === process.pid) rmSync(this.lockFile, { force: true });
    } catch {
      /* gone already */
    }
  }

  /** Append a reply's log entries (only those after the mark) and its checkpoint. Returns the entries written. */
  record(tab: string, reply: { log?: { epoch: string; entries: unknown[] }; checkpoint?: unknown }): number {
    const lines: string[] = [];
    const before = this.marks.get(tab);
    let m: TabMark | undefined = before ? { ...before } : undefined;
    const log = reply.log;
    if (log && typeof log.epoch === "string" && Array.isArray(log.entries)) {
      if (!m || m.epoch !== log.epoch) m = { epoch: log.epoch, seq: 0, sinceCheckpoint: Number.POSITIVE_INFINITY };
      for (const e of log.entries) {
        if (!isObj(e) || !Number.isInteger(e.seq) || (e.seq as number) <= m.seq) continue;
        // the line's own fields win and come first: an entry cannot make itself a checkpoint line (gate 3)
        const { t: _t, tab: _tab, epoch: _epoch, ...rest } = e;
        lines.push(this.line({ t: "entry", tab, epoch: log.epoch, ...rest }));
        m.seq = e.seq as number;
        m.sinceCheckpoint++;
      }
    }
    const cp = reply.checkpoint;
    if (isObj(cp) && typeof cp.epoch === "string" && Number.isInteger(cp.seq)) {
      if (!m || m.epoch !== cp.epoch) m = { epoch: cp.epoch, seq: cp.seq as number, sinceCheckpoint: 0 };
      const { t: _t, tab: _tab, ...rest } = cp;
      const text = JSON.stringify({ t: "checkpoint", tab, ...rest });
      if (text.length <= MAX_CHECKPOINT_BYTES) {
        lines.push(`${text}\n`);
        m.sinceCheckpoint = 0;
      } else {
        // too large to keep: a line that says so, never a base for compaction or replay (W4-D); the next call asks again
        lines.push(`${JSON.stringify({ t: "checkpoint-omitted", tab, epoch: cp.epoch, seq: cp.seq, omitted: { bytes: text.length } })}\n`);
      }
      m.seq = Math.max(m.seq, cp.seq as number);
    }
    if (!lines.length) {
      if (m) this.marks.set(tab, m);
      return 0;
    }
    if (!this.lock()) return 0; // the marks stay: the next call asks for the same entries again
    try {
      appendFileSync(this.file, lines.join(""), { mode: 0o600 });
      if (m) this.marks.set(tab, m);
      this.compactIfLarge();
    } finally {
      this.unlock();
    }
    return lines.filter((l) => l.startsWith('{"t":"entry"')).length;
  }

  private line(o: Record<string, unknown>): string {
    const text = JSON.stringify(o);
    if (text.length <= MAX_LINE_BYTES) return `${text}\n`;
    const { ops: _o, inverse: _i, state: _s, ...head } = o;
    return `${JSON.stringify({ ...head, omitted: { bytes: text.length } })}\n`;
  }

  /**
   * Past the cap (the lock held): per tab, keep its newest checkpoint and what follows (a tab without one keeps its
   * newest half); still over, halve the largest tab's lines after its base until it fits.
   */
  private compactIfLarge(): void {
    let size = 0;
    try {
      size = statSync(this.file).size;
    } catch {
      return;
    }
    if (size <= this.maxBytes) return;
    const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
    const tabOf = (l: string): string => {
      try {
        const o = JSON.parse(l) as { tab?: unknown };
        return typeof o.tab === "string" ? o.tab : "";
      } catch {
        return "";
      }
    };
    const groups = new Map<string, { base?: string; rest: string[] }>();
    for (const l of lines) {
      const tab = tabOf(l);
      let g = groups.get(tab);
      if (!g) groups.set(tab, (g = { rest: [] }));
      if (l.startsWith('{"t":"checkpoint"')) {
        // a newer checkpoint is the tab's base: everything before it goes (gate 3: a base at line 0 stays a base)
        g.base = l;
        g.rest = [];
      } else g.rest.push(l);
    }
    for (const g of groups.values()) if (!g.base) g.rest = g.rest.slice(Math.floor(g.rest.length / 2));
    const total = () => [...groups.values()].reduce((n, g) => n + (g.base ? g.base.length + 1 : 0) + g.rest.reduce((k, l) => k + l.length + 1, 0), 0);
    while (total() > this.maxBytes) {
      const largest = [...groups.values()].filter((g) => g.rest.length).sort((a, b) => b.rest.length - a.rest.length)[0];
      if (!largest) break;
      largest.rest = largest.rest.slice(Math.max(1, Math.floor(largest.rest.length / 2)));
    }
    const kept: string[] = [];
    for (const g of groups.values()) kept.push(...(g.base ? [g.base] : []), ...g.rest);
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, kept.length ? `${kept.join("\n")}\n` : "", { mode: 0o600 });
    try {
      renameSync(tmp, this.file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  }

  /** The journal's lines (tests, `view_observe` with history). */
  read(): unknown[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return undefined;
        }
      })
      .filter((x) => x !== undefined);
  }
}
