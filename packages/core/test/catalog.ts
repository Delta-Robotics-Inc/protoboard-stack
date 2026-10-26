/**
 * Test copies of catalog parts (fixtures/catalog/README.md): read one, or
 * vendor it into a scratch project's parts/catalog with an origins entry,
 * the way `protoboard parts add` does (definition only, no artifacts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleDef } from "@deltarobotics/uhd";
import { sha256 } from "../src/index.js";

const DIR = fileURLToPath(new URL("./fixtures/catalog/", import.meta.url));

/** The test copy of a catalog part's definition. */
export const catalogPart = (id: string): ModuleDef => JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8")) as ModuleDef;

/** Vendor test copies into `dir`'s parts/catalog and parts/origins.json. */
export function vendorCatalogParts(dir: string, ids: string[]): void {
  mkdirSync(join(dir, "parts/catalog"), { recursive: true });
  const file = join(dir, "parts/origins.json");
  const origins = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { schema: "protoboard.origins/v0", definitions: {} };
  for (const id of ids) {
    const bytes = readFileSync(join(DIR, `${id}.json`));
    writeFileSync(join(dir, "parts/catalog", `${id}.json`), bytes);
    origins.definitions[id] = {
      file: `parts/catalog/${id}.json`,
      tier: "catalog",
      provider: "protoboard-cloud (test copy)",
      library: "protoboard",
      partId: id,
      revision: 2,
      digest: sha256(bytes),
      retrievedAt: "2026-10-03T00:00:00.000Z",
    };
  }
  writeFileSync(file, JSON.stringify(origins, null, 2) + "\n");
}
