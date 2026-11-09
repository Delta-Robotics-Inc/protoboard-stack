/**
 * The on-disk format (contract section 5): one folder, three files, one canonical record per line sorted by id,
 * a canonical header line, integers only, a final newline. Load then save is byte-identical. Proposals are local
 * state, written to the local state folder when one is given.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { byCodeUnit, canonical, canonicalRecord, sha256Hex } from "@protoboardai/board";
import type { SchematicCircuit } from "./circuit.ts";
import { createSchematic, type SchematicDocument } from "./document.ts";
import { FILE_OF, SCHEMA_ID, SCHEMATIC_FILES, validateRecord, type SchematicFile, type SchematicRecord } from "./schema.ts";
import { GU_MM } from "./units.ts";

export const UNITS = { length: "gu", gu_mm: GU_MM } as const;
export const fileName = (f: SchematicFile): string => `${f}.jsonl`;

export class SchematicFormatError extends Error {
  constructor(
    readonly file: string,
    readonly line: number,
    message: string,
  ) {
    super(`${file}:${line}: ${message}`);
    this.name = "SchematicFormatError";
  }
}

export const header = (f: SchematicFile): string => canonical({ file: f, schema: SCHEMA_ID, units: UNITS });

export function serializeFile(f: SchematicFile, records: readonly SchematicRecord[]): string {
  const lines = [header(f), ...[...records].sort((a, b) => byCodeUnit(a.id, b.id)).map((r) => canonicalRecord(r))];
  return `${lines.join("\n")}\n`;
}

/** Every file's text (proposals included). */
export function serializeSchematic(doc: SchematicDocument): Record<SchematicFile, string> {
  const by: Record<SchematicFile, SchematicRecord[]> = { schematic: [], symbols: [], wires: [], proposals: [] };
  for (const r of doc.records.values()) by[FILE_OF[r.kind]].push(r);
  return { schematic: serializeFile("schematic", by.schematic), symbols: serializeFile("symbols", by.symbols), wires: serializeFile("wires", by.wires), proposals: serializeFile("proposals", by.proposals) };
}

export function parseFile(f: SchematicFile, text: string): SchematicRecord[] {
  const name = fileName(f);
  if (!text.endsWith("\n")) throw new SchematicFormatError(name, 0, "the file does not end with a newline");
  const lines = text.slice(0, -1).split("\n");
  if (lines[0] !== header(f)) throw new SchematicFormatError(name, 1, `the header is not ${header(f)}`);
  const out: SchematicRecord[] = [];
  let prev = "";
  for (let i = 1; i < lines.length; i++) {
    let rec: SchematicRecord;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      throw new SchematicFormatError(name, i + 1, "not JSON");
    }
    const v = validateRecord(rec);
    if (!v.ok) throw new SchematicFormatError(name, i + 1, v.error);
    if (FILE_OF[rec.kind] !== f) throw new SchematicFormatError(name, i + 1, `a ${rec.kind} belongs in ${fileName(FILE_OF[rec.kind])}`);
    if (canonicalRecord(rec) !== lines[i]) throw new SchematicFormatError(name, i + 1, "the line is not canonical JSON");
    if (prev && byCodeUnit(prev, rec.id) >= 0) throw new SchematicFormatError(name, i + 1, `${rec.id} is out of order`);
    prev = rec.id;
    out.push(rec);
  }
  return out;
}

export interface LoadedSchematic {
  doc: SchematicDocument;
  /** sha256 of each file as read */
  hashes: Partial<Record<SchematicFile, string>>;
}

/** Load a schematic folder against a circuit; `localDir` holds the proposals. */
export function loadSchematicDir(dir: string, circuit: SchematicCircuit, options: { localDir?: string } = {}): LoadedSchematic {
  const records: SchematicRecord[] = [];
  const hashes: Partial<Record<SchematicFile, string>> = {};
  for (const f of SCHEMATIC_FILES) {
    const p = join(dir, fileName(f));
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    hashes[f] = sha256Hex(text);
    records.push(...parseFile(f, text));
  }
  if (options.localDir) {
    const p = join(options.localDir, fileName("proposals"));
    if (existsSync(p)) records.push(...parseFile("proposals", readFileSync(p, "utf8")));
  }
  return { doc: createSchematic(records, circuit), hashes };
}

export interface WriteResult {
  written: SchematicFile[];
  /** files changed on disk by someone else since `expected` (not written) */
  refused: SchematicFile[];
  hashes: Partial<Record<SchematicFile, string>>;
}

/** Write the files whose content changed, each through a temporary file and a rename, refusing one changed on disk since `expected`. */
export function writeSchematicDir(dir: string, doc: SchematicDocument, options: { expected?: Partial<Record<SchematicFile, string>>; localDir?: string } = {}): WriteResult {
  mkdirSync(dir, { recursive: true });
  const texts = serializeSchematic(doc);
  const written: SchematicFile[] = [];
  const refused: SchematicFile[] = [];
  const hashes: Partial<Record<SchematicFile, string>> = {};
  const targets: [SchematicFile, string][] = SCHEMATIC_FILES.map((f) => [f, join(dir, fileName(f))]);
  if (options.localDir) targets.push(["proposals", join(options.localDir, fileName("proposals"))]);
  for (const [f, p] of targets) {
    const text = texts[f];
    const now = existsSync(p) ? readFileSync(p, "utf8") : undefined;
    const want = sha256Hex(text);
    hashes[f] = want;
    if (now === text) continue;
    if (f === "proposals" && now === undefined && ![...doc.records.values()].some((r) => r.kind === "proposal")) continue;
    const exp = options.expected?.[f];
    if (exp !== undefined && now !== undefined && sha256Hex(now) !== exp) {
      refused.push(f);
      hashes[f] = sha256Hex(now);
      continue;
    }
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(`${p}.tmp`, text);
    renameSync(`${p}.tmp`, p);
    written.push(f);
  }
  return { written, refused, hashes };
}
