/**
 * The on-disk format (contract section 7): one folder per board, one file per group of kinds, a header line, then
 * one canonical JSON record per line sorted by id. Loading then saving an unchanged board gives the same bytes.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { byCodeUnit, canonical, canonicalRecord, sha256Hex } from "./canonical.js";
import { createDocument, type BoardDocument } from "./document.js";
import { AnyRecord, BOARD_FILES, FILE_OF, Netlist, NETLIST_SCHEMA_ID, NetlistNet, SCHEMA_ID, type BoardFile, type BoardRecord } from "./schema.js";

export const UNITS = { length: "nm", angle: "mdeg" } as const;
export const NETLIST_FILE = "netlist.jsonl";
export const fileName = (f: BoardFile): string => `${f}.jsonl`;

export class BoardFormatError extends Error {
  constructor(
    readonly file: string,
    readonly line: number,
    message: string,
  ) {
    super(`${file}:${line}: ${message}`);
    this.name = "BoardFormatError";
  }
}

const header = (file: string, extra: Record<string, unknown> = {}) => canonical({ schema: file === "netlist" ? NETLIST_SCHEMA_ID : SCHEMA_ID, file, units: UNITS, ...extra });

/** One board file's text from its records (any order; sorted here). */
export function serializeFile(file: BoardFile, records: readonly BoardRecord[]): string {
  const lines = [header(file)];
  const sorted = [...records].sort((a, b) => byCodeUnit(a.id, b.id));
  for (const r of sorted) {
    if (FILE_OF[r.kind] !== file) throw new Error(`${r.id} (${r.kind}) belongs in ${FILE_OF[r.kind]}.jsonl, not ${file}.jsonl`);
    lines.push(canonicalRecord(r));
  }
  return `${lines.join("\n")}\n`;
}

/** Every board file's text. */
export function serializeDocument(doc: BoardDocument): Record<BoardFile, string> {
  const groups = Object.fromEntries(BOARD_FILES.map((f) => [f, [] as BoardRecord[]])) as Record<BoardFile, BoardRecord[]>;
  for (const r of doc.records.values()) groups[FILE_OF[r.kind]].push(r);
  return Object.fromEntries(BOARD_FILES.map((f) => [f, serializeFile(f, groups[f])])) as Record<BoardFile, string>;
}

/** The netlist file's text: nets sorted by name, pins sorted. */
export function serializeNetlist(netlist: Netlist): string {
  const lines = [header("netlist", { source: netlist.source })];
  const nets = [...netlist.nets].sort((a, b) => byCodeUnit(a.name, b.name));
  for (const n of nets) lines.push(canonicalRecord({ kind: "net", id: `net:${n.name}`, name: n.name, ...(n.class ? { class: n.class } : {}), pins: [...n.pins].sort(byCodeUnit) }));
  return `${lines.join("\n")}\n`;
}

function lines(text: string, file: string): { n: number; value: unknown }[] {
  if (text.includes("\r")) throw new BoardFormatError(file, 1, "line ends must be \\n");
  const out: { n: number; value: unknown }[] = [];
  text.split("\n").forEach((l, i) => {
    if (!l) return;
    try {
      out.push({ n: i + 1, value: JSON.parse(l) });
    } catch (e) {
      throw new BoardFormatError(file, i + 1, `not JSON (${(e as Error).message})`);
    }
  });
  return out;
}

/** Parse one board file. */
export function parseFile(file: BoardFile, text: string): BoardRecord[] {
  const name = fileName(file);
  const ls = lines(text, name);
  const head = ls[0]?.value as { schema?: unknown; file?: unknown } | undefined;
  if (!head || head.schema !== SCHEMA_ID || head.file !== file) throw new BoardFormatError(name, 1, `the first line must be the header {"file":"${file}","schema":"${SCHEMA_ID}",...}`);
  const out: BoardRecord[] = [];
  let prev = "";
  for (const { n, value } of ls.slice(1)) {
    const r = AnyRecord.safeParse(value);
    if (!r.success) throw new BoardFormatError(name, n, r.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`).join("; "));
    const rec = value as BoardRecord;
    if (FILE_OF[rec.kind] !== file) throw new BoardFormatError(name, n, `a ${rec.kind} belongs in ${FILE_OF[rec.kind]}.jsonl`);
    if (prev && byCodeUnit(prev, rec.id) >= 0) throw new BoardFormatError(name, n, `records must be sorted by id with no repeats (${rec.id} after ${prev})`);
    prev = rec.id;
    out.push(rec);
  }
  return out;
}

/** Parse the netlist file. */
export function parseNetlist(text: string): Netlist {
  const ls = lines(text, NETLIST_FILE);
  const head = ls[0]?.value as { schema?: unknown; source?: unknown } | undefined;
  if (!head || head.schema !== NETLIST_SCHEMA_ID || typeof head.source !== "string") throw new BoardFormatError(NETLIST_FILE, 1, `the first line must be the header {"file":"netlist","schema":"${NETLIST_SCHEMA_ID}","source":...}`);
  const nets = ls.slice(1).map(({ n, value }) => {
    const v = value as Record<string, unknown>;
    if (v?.kind !== "net" || v.id !== `net:${String(v.name)}`) throw new BoardFormatError(NETLIST_FILE, n, "a net line is {kind:\"net\", id:\"net:<name>\", name, class?, pins}");
    const { kind: _k, id: _i, ...rest } = v;
    const r = NetlistNet.safeParse(rest);
    if (!r.success) throw new BoardFormatError(NETLIST_FILE, n, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return r.data;
  });
  return Netlist.parse({ source: head.source, nets });
}

/** The hash of a set of board file texts (the journal's `files`). */
export function filesHash(texts: Partial<Record<string, string>>): string {
  const names = Object.keys(texts).filter((k) => texts[k] !== undefined).sort(byCodeUnit);
  return sha256Hex(names.map((n) => `${n}\u0000${texts[n]}\u0000`).join(""));
}

export interface LoadedBoard {
  doc: BoardDocument;
  /** The text of each board file as read (undefined: the file was absent). */
  texts: Record<BoardFile, string | undefined>;
  netlistText?: string;
}

/** Read a board folder. `board.jsonl` must exist; other missing files count as empty. */
export function loadBoardDir(dir: string, options: { netlist?: Netlist } = {}): LoadedBoard {
  if (!existsSync(join(dir, fileName("board")))) throw new BoardFormatError(join(dir, fileName("board")), 0, "not a board folder (no board.jsonl)");
  const texts = {} as Record<BoardFile, string | undefined>;
  const records: BoardRecord[] = [];
  for (const f of BOARD_FILES) {
    const p = join(dir, fileName(f));
    const text = existsSync(p) ? readFileSync(p, "utf8") : undefined;
    texts[f] = text;
    if (text !== undefined) records.push(...parseFile(f, text));
  }
  const np = join(dir, NETLIST_FILE);
  const netlistText = existsSync(np) ? readFileSync(np, "utf8") : undefined;
  const netlist = options.netlist ?? (netlistText !== undefined ? parseNetlist(netlistText) : undefined);
  return { doc: createDocument(records, netlist), texts, ...(netlistText !== undefined ? { netlistText } : {}) };
}

export interface WriteResult {
  written: BoardFile[];
  unchanged: BoardFile[];
  /** Files changed on disk by someone else since `expected`: left alone. */
  refused: BoardFile[];
  texts: Record<BoardFile, string | undefined>;
}

/**
 * Write a document's files. A file is written only when its text changed, through a temporary file and a rename,
 * and only when the file on disk is still `expected[file]` (undefined: no check; null: the file must not exist).
 */
export function writeBoardDir(dir: string, doc: BoardDocument, expected?: Partial<Record<BoardFile, string | null>>): WriteResult {
  mkdirSync(dir, { recursive: true });
  const next = serializeDocument(doc);
  const result: WriteResult = { written: [], unchanged: [], refused: [], texts: {} as Record<BoardFile, string | undefined> };
  for (const f of BOARD_FILES) {
    const p = join(dir, fileName(f));
    const onDisk = existsSync(p) ? readFileSync(p, "utf8") : null;
    if (onDisk === next[f]) {
      result.unchanged.push(f);
      result.texts[f] = onDisk;
      continue;
    }
    const want = expected?.[f];
    if (want !== undefined && want !== onDisk) {
      result.refused.push(f);
      result.texts[f] = onDisk ?? undefined;
      continue;
    }
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, next[f]);
    try {
      renameSync(tmp, p);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    result.written.push(f);
    result.texts[f] = next[f];
  }
  return result;
}

/** Write a netlist file beside the board files (importers of boards without UHD). */
export function writeNetlist(dir: string, netlist: Netlist): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, NETLIST_FILE), serializeNetlist(netlist));
}
