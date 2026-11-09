/**
 * The schematic journal (contract section 10, after the board core's section 10): `journal.jsonl` in the
 * schematic's local folder, one JSON object per line, appended on every commit. The board's journal is generic in
 * everything but its entry type, so this is the board's `BoardJournal` with the board's line format, compaction
 * and recovery rule (`pendingEntries`), typed for the schematic's log entries:
 *
 *   {"t":"open", "epoch", "seq", "files"}                     the service opened the schematic (files: hash of its files)
 *   {"t":"entry", "epoch", "seq", "time", "actor", "label", "ops", "inverse", "forward", "changed", ...}
 *   {"t":"saved", "epoch", "seq", "files"}                    the schematic files were written at this seq
 *   {"t":"checkpoint", "epoch", "seq", "label", "files"}      a named checkpoint (the caller commits)
 *
 * Recovery replays the entries committed after the last marker whose `files` hash equals the files on disk now.
 */
import { BoardJournal, canonical, pendingEntries, sha256Hex, type OpCall } from "@protoboardai/board";
import type { LogEntry } from "./engine.ts";
import { SCHEMATIC_FILES, type SchematicFile } from "./schema.ts";

/** An entry as the journal keeps it: what recovery replays. */
export interface JournaledEntry {
  epoch: string;
  seq: number;
  label: string;
  /** Record-level operations that write the records after the entry (exact replay). */
  forward: OpCall[];
}

export class SchematicJournal {
  private readonly j: BoardJournal;

  constructor(file: string, options: { maxBytes?: number } = {}) {
    this.j = new BoardJournal(file, options);
  }

  get file(): string {
    return this.j.file;
  }

  open(epoch: string, seq: number, files: string): void {
    this.j.open(epoch, seq, files);
  }

  entry(epoch: string, e: LogEntry): void {
    // the board's line drops `areas`, `touched` and the undo marks; the schematic has no areas
    this.j.entry(epoch, { ...e, areas: [] });
  }

  saved(epoch: string, seq: number, files: string): void {
    this.j.saved(epoch, seq, files);
  }

  checkpoint(epoch: string, seq: number, label: string, files: string): void {
    this.j.checkpoint(epoch, seq, label, files);
  }

  /** The entries an earlier session committed after its last marker whose files hash equals `filesHash`. */
  pending(filesHash: string): JournaledEntry[] {
    return pendingEntries(this.j.read(), filesHash).map((l) => ({ epoch: l.epoch, seq: l.seq, label: l.label, forward: l.forward }));
  }
}

/** The hash journal markers carry: SHA-256 over the hashes of the three committed files (absent files as null). */
export function schematicFilesHash(hashes: Partial<Record<SchematicFile, string>>): string {
  return sha256Hex(canonical(Object.fromEntries(SCHEMATIC_FILES.map((f) => [f, hashes[f] ?? null]))));
}
