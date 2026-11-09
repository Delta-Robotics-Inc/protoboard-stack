/**
 * The board journal and the owner lock (contract sections 7 and 10), after the 3D viewer's journal
 * (packages/cli/src/dev/journal.ts): one JSON object per line in a git-ignored file, appended on every commit.
 *
 *   {"t":"open", "epoch", "seq", "files"}                     the service opened the board (files: hash of the board files)
 *   {"t":"entry", "epoch", "seq", "time", "actor", "label", "ops", "inverse", "forward", "changed", ...}
 *   {"t":"saved", "epoch", "seq", "files"}                    the board files were written at this seq
 *   {"t":"checkpoint", "epoch", "seq", "label", "files"}      a named checkpoint (the caller commits)
 *
 * One owner writes it (the owner lock guarantees that), so there is no journal lock. Past `maxBytes` the file is
 * rewritten keeping the latest epoch from its last open, saved or checkpoint line on. Recovery replays the
 * entries committed after the last marker whose `files` hash matches the files now on disk.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { LogEntry } from "./transaction.js";

/** DEFAULT: compact past this size. */
export const JOURNAL_MAX_BYTES = 4 * 1024 * 1024;

export type JournalLine =
  | { t: "open"; epoch: string; seq: number; files: string }
  | ({ t: "entry"; epoch: string } & Omit<LogEntry, "areas" | "touched" | "undoneBy" | "redoneBy">)
  | { t: "saved"; epoch: string; seq: number; files: string }
  | { t: "checkpoint"; epoch: string; seq: number; label: string; files: string };

export class BoardJournal {
  readonly file: string;
  private readonly maxBytes: number;

  constructor(file: string, options: { maxBytes?: number } = {}) {
    this.file = file;
    this.maxBytes = options.maxBytes ?? JOURNAL_MAX_BYTES;
  }

  private append(line: JournalLine): void {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    this.compactIfLarge();
  }

  open(epoch: string, seq: number, files: string): void {
    this.append({ t: "open", epoch, seq, files });
  }

  entry(epoch: string, e: LogEntry): void {
    const { areas: _a, touched: _t, undoneBy: _u, redoneBy: _r, ...rest } = e;
    this.append({ t: "entry", epoch, ...rest });
  }

  saved(epoch: string, seq: number, files: string): void {
    this.append({ t: "saved", epoch, seq, files });
  }

  checkpoint(epoch: string, seq: number, label: string, files: string): void {
    this.append({ t: "checkpoint", epoch, seq, label, files });
  }

  read(): JournalLine[] {
    if (!existsSync(this.file)) return [];
    const out: JournalLine[] = [];
    for (const l of readFileSync(this.file, "utf8").split("\n")) {
      if (!l) continue;
      try {
        const o = JSON.parse(l) as JournalLine;
        if (o && typeof o === "object" && typeof o.t === "string" && typeof o.epoch === "string") out.push(o);
      } catch {
        // a torn last line (a crash mid-write) is skipped
      }
    }
    return out;
  }

  private compactIfLarge(): void {
    let size = 0;
    try {
      size = statSync(this.file).size;
    } catch {
      return;
    }
    if (size <= this.maxBytes) return;
    const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
    let keepFrom = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\{"t":"(open|saved|checkpoint)"/.test(lines[i])) {
        keepFrom = i;
        break;
      }
    }
    let kept = lines.slice(keepFrom);
    // still too large (a long unsaved session): keep the newest half of it; recovery then finds no base and stops
    while (kept.join("\n").length > this.maxBytes && kept.length > 1) kept = kept.slice(Math.floor(kept.length / 2));
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${kept.join("\n")}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

/**
 * The entries to replay after a crash: those of the newest epoch committed after its last open, saved or
 * checkpoint line whose `files` hash equals `filesHash` (the files on disk now). None when the files moved on.
 */
export function pendingEntries(lines: JournalLine[], filesHash: string): Extract<JournalLine, { t: "entry" }>[] {
  const lastEpoch = [...lines].reverse().find((l) => l.t === "entry" || l.t === "open")?.epoch;
  if (!lastEpoch) return [];
  const mine = lines.filter((l) => l.epoch === lastEpoch);
  let base = -1;
  for (let i = mine.length - 1; i >= 0; i--) {
    const l = mine[i];
    if (l.t === "open" || l.t === "saved" || l.t === "checkpoint") {
      base = l.files === filesHash ? i : -2;
      break;
    }
  }
  if (base < 0) return [];
  const seen = new Set<number>();
  const out: Extract<JournalLine, { t: "entry" }>[] = [];
  for (const l of mine.slice(base + 1)) {
    if (l.t !== "entry" || seen.has(l.seq)) continue;
    seen.add(l.seq);
    out.push(l);
  }
  return out;
}

// ---------------------------------------------------------------- owner lock

export class BoardLockedError extends Error {
  constructor(
    readonly file: string,
    readonly pid: number,
  ) {
    super(`another live process (pid ${pid}) owns this board; connect to it as a client (lock ${file})`);
    this.name = "BoardLockedError";
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

/** Take the owner lock (exclusive create, pid inside); a lock whose process is gone is taken over. */
export function acquireOwnerLock(file: string, info: Record<string, unknown> = {}): { release(): void } {
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(file, "wx", 0o600);
      writeSync(fd, JSON.stringify({ pid: process.pid, ...info }));
      closeSync(fd);
      return {
        release() {
          try {
            const held = JSON.parse(readFileSync(file, "utf8")) as { pid?: number };
            if (held.pid === process.pid) rmSync(file, { force: true });
          } catch {
            /* gone already */
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    let pid = 0;
    try {
      pid = Number((JSON.parse(readFileSync(file, "utf8")) as { pid?: number }).pid);
    } catch {
      pid = 0;
    }
    if (!processAlive(pid)) {
      rmSync(file, { force: true });
      continue;
    }
    throw new BoardLockedError(file, pid);
  }
  throw new Error(`could not take the owner lock ${file}`);
}
