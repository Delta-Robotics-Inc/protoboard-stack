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
 *
 * Size cap (DEFAULT 4 MiB): past it the file is rewritten from its newest
 * checkpoint on (temp file and rename), so crash recovery keeps what it
 * needs. An entry line over 64 kB keeps its header and drops its values
 * (`omitted`). The person's gestures between two agent calls arrive with the
 * next call: the journal is complete up to the last call, not to the second.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const JOURNAL_FILE = join(".protoboard", "local", "scene-oplog.jsonl");
/** DEFAULT: the journal is compacted past this size. */
export const JOURNAL_MAX_BYTES = 4 * 1024 * 1024;
/** DEFAULT: a checkpoint every this many entries per tab. */
export const CHECKPOINT_EVERY = 200;
/** DEFAULT: one line at most this long; a longer entry keeps its header only. */
export const MAX_LINE_BYTES = 64 * 1024;

interface TabMark {
  epoch: string;
  seq: number;
  /** Entries written since this epoch's last checkpoint (Infinity: none yet). */
  sinceCheckpoint: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export class Journal {
  readonly file: string;
  private readonly marks = new Map<string, TabMark>();
  private readonly maxBytes: number;
  private readonly every: number;

  constructor(root: string, options: { maxBytes?: number; checkpointEvery?: number } = {}) {
    this.file = join(root, JOURNAL_FILE);
    this.maxBytes = options.maxBytes ?? JOURNAL_MAX_BYTES;
    this.every = options.checkpointEvery ?? CHECKPOINT_EVERY;
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

  /** Append a reply's log entries (only those after the mark) and its checkpoint. Returns the entries written. */
  record(tab: string, reply: { log?: { epoch: string; entries: unknown[] }; checkpoint?: unknown }): number {
    const lines: string[] = [];
    let m = this.marks.get(tab);
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
      lines.push(this.line({ t: "checkpoint", tab, ...rest }));
      m.sinceCheckpoint = 0;
      m.seq = Math.max(m.seq, cp.seq as number);
    }
    if (m) this.marks.set(tab, m);
    if (!lines.length) return 0;
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, lines.join(""), { mode: 0o600 });
    this.compactIfLarge();
    return lines.filter((l) => l.startsWith('{"t":"entry"')).length;
  }

  private line(o: Record<string, unknown>): string {
    const text = JSON.stringify(o);
    if (text.length <= MAX_LINE_BYTES) return `${text}\n`;
    const { ops: _o, inverse: _i, state: _s, ...head } = o;
    return `${JSON.stringify({ ...head, omitted: { bytes: text.length } })}\n`;
  }

  /** Past the cap: keep from the newest checkpoint on (or the newest half of the lines when there is none). */
  private compactIfLarge(): void {
    let size = 0;
    try {
      size = statSync(this.file).size;
    } catch {
      return;
    }
    if (size <= this.maxBytes) return;
    const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
    let from = -1;
    for (let i = lines.length - 1; i >= 0; i--)
      if (lines[i].startsWith('{"t":"checkpoint"')) {
        from = i;
        break;
      }
    // a checkpoint at line 0 (after an earlier compaction) is still the base (gate 3: `from > 0` halved it away)
    let kept = from >= 0 ? lines.slice(from) : lines.slice(Math.floor(lines.length / 2));
    // a checkpoint followed by more than the cap still halves, keeping the checkpoint as the base
    const base = from >= 0 ? kept[0] : undefined;
    while (kept.length > 1 && kept.join("\n").length > this.maxBytes) {
      const rest = kept.slice(base ? 1 : 0);
      const half = rest.slice(Math.floor(rest.length / 2));
      if (half.length === rest.length) break;
      kept = base ? [base, ...half] : half;
    }
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${kept.join("\n")}\n`, { mode: 0o600 });
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
