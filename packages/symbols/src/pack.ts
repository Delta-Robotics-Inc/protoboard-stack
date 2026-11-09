/**
 * The drawn pack on disk: pack/<id>.symbol.json, one file per symbol. Node only (reads files).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkSymbol, type Finding } from "./check.ts";
import type { SymbolDef } from "./types.ts";

export const PACK_DIR = fileURLToPath(new URL("../pack/", import.meta.url));
export const PACK_LICENSE = "Apache-2.0";

export interface PackFile {
  file: string;
  id: string;
  text: string;
  def: SymbolDef;
}

/** Every symbol file in the pack, sorted by id. */
export function readPack(dir = PACK_DIR): PackFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".symbol.json"))
    .sort()
    .map((file) => {
      const text = readFileSync(dir + file, "utf8");
      return { file, id: file.replace(/\.symbol\.json$/, ""), text, def: JSON.parse(text) as SymbolDef };
    });
}

/** Check every file of the pack. */
export function checkPack(dir = PACK_DIR): { files: PackFile[]; findings: Finding[] } {
  const files = readPack(dir);
  const packIds = new Set(files.map((f) => f.def.id));
  const findings = files.flatMap((f) => checkSymbol(f.def, { text: f.text, fileId: f.id, packIds, license: PACK_LICENSE }));
  return { files, findings };
}
