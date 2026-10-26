/**
 * The IMU tile test project (test/fixtures/imu-tile), copied into a scratch
 * folder with its three ICs vendored the way `protoboard parts add` does:
 * JSON definitions in parts/catalog, pinned by digest in parts/origins.json,
 * their artifacts (the BMI270 and TPS63020 bodies) in a vendored folder.
 * The definitions and artifacts are test copies of UHD library parts
 * (test/fixtures/uhd-parts/README.md), so the tests do not depend on UHD's
 * library/, which is moving to the parts service.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@protoboardai/core";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const FIXTURE = join(HERE, "fixtures/imu-tile");
/** Test copies of the UHD library parts the fixture uses (README.md there says where they came from). */
export const UHD_PARTS = join(HERE, "fixtures/uhd-parts");
const VENDOR = "parts/vendor/uhd-parts";

export async function makeProject(dir: string): Promise<string> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  await vendorParts(dir);
  return dir;
}

/**
 * Vendor the three ICs into a copy of the fixture (the eval runner's recipe
 * uses this too): parts/catalog JSON, parts/origins.json and their files.
 */
export async function vendorParts(dir: string): Promise<void> {
  cpSync(join(UHD_PARTS, "files"), join(dir, VENDOR), { recursive: true });
  const definitions: Record<string, unknown> = {};
  mkdirSync(join(dir, "parts/catalog"), { recursive: true });
  for (const file of readdirSync(join(UHD_PARTS, "definitions")).sort()) {
    const bytes = readFileSync(join(UHD_PARTS, "definitions", file));
    const def = JSON.parse(bytes.toString("utf8")) as { id: string };
    writeFileSync(join(dir, "parts/catalog", `${def.id}.json`), bytes);
    definitions[def.id] = {
      file: `parts/catalog/${def.id}.json`,
      provider: "@deltarobotics/uhd library (test copy)",
      package: "@deltarobotics/uhd",
      version: "0.2.0",
      revision: "8a62efd",
      digest: sha256(bytes),
      retrievedAt: "2026-10-02T00:00:00.000Z",
      artifactBase: { kind: "vendored", dir: VENDOR },
    };
  }
  writeFileSync(join(dir, "parts/origins.json"), JSON.stringify({ schema: "protoboard.origins/v0", definitions }, null, 2) + "\n");
}
