/**
 * The files the bill of materials reads besides the design, checked when a
 * project loads (PB-933): `parts/bom.json` (units to build, chosen offers)
 * and `parts/fx-rates.json` (the project's own rate table). A malformed one
 * is an error in `protoboard check`, the same refusal `protoboard bom` and
 * the BOM views give, so it is found before someone opens the bill.
 *
 * Node only (reads the project's files).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BOM_SETTINGS_FILE, bomSettingsProblems } from "./bom-model.js";
import { FX_FILE, fxProblems } from "./fx-rates.js";
import type { ProjectDiagnostic } from "./types.js";

export function bomFileDiagnostics(root: string): ProjectDiagnostic[] {
  const out: ProjectDiagnostic[] = [];
  const check = (file: string, code: string, problems: (x: unknown) => string[], use: string) => {
    if (!existsSync(join(root, file))) return;
    let found: string[];
    try {
      found = problems(JSON.parse(readFileSync(join(root, file), "utf8")));
    } catch (e) {
      found = [`not JSON: ${(e as Error).message}`];
    }
    for (const message of found) out.push({ code, severity: "error", entity: { kind: "project", id: file }, message: `${file}: ${message} (${use})`, source: { file }, validator: "protoboard/loader" });
  };
  check(BOM_SETTINGS_FILE, "PB_BOM_SETTINGS_INVALID", bomSettingsProblems, "the bill of materials cannot be priced until it is fixed or removed");
  check(FX_FILE, "PB_FX_RATES_INVALID", fxProblems, "the bill of materials cannot convert prices until it is fixed or removed");
  return out;
}
