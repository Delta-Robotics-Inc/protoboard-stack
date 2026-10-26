/**
 * The watch-core test project (test/fixtures/watch-core), copied into a
 * scratch folder with its researched parts vendored the way `protoboard
 * parts add` does: JSON definitions in parts/catalog, pinned by digest in
 * parts/origins.json. The parts are test copies (test/fixtures/parts/README.md).
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@protoboardai/core";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const FIXTURE = join(HERE, "fixtures/watch-core");
export const PARTS = join(HERE, "fixtures/parts");

export function makeProject(dir: string, edit?: (rel: string, text: string) => string): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  const definitions: Record<string, unknown> = {};
  mkdirSync(join(dir, "parts/catalog"), { recursive: true });
  for (const file of readdirSync(PARTS).filter((f) => f.endsWith(".json")).sort()) {
    const bytes = readFileSync(join(PARTS, file));
    const id = file.replace(/\.json$/, "");
    writeFileSync(join(dir, "parts/catalog", file), bytes);
    definitions[id] = {
      file: `parts/catalog/${file}`,
      provider: "parts workspace (test copy)",
      revision: "9a80317",
      digest: sha256(bytes),
      retrievedAt: "2026-10-02T00:00:00.000Z",
    };
  }
  writeFileSync(join(dir, "parts/origins.json"), JSON.stringify({ schema: "protoboard.origins/v0", definitions }, null, 2) + "\n");
  if (edit) {
    for (const rel of ["src/boards/mainboard/mainboard.uhd.ts", "src/boards/mainboard/firmware.config.ts"]) {
      const f = join(dir, rel);
      const before = readFileSync(f, "utf8");
      const after = edit(rel, before);
      if (after !== before) writeFileSync(f, after);
    }
  }
  return dir;
}
