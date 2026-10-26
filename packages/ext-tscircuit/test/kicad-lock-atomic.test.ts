/**
 * circuit:lock is all or nothing (PB-1021, track D follow-up): a lock that
 * fails part way leaves no kicad/ folder, no handoff record and no new
 * designators, so the next lock does not stop on "kicad/ already has files".
 * A kicad-cli that answers its version and then fails stands in for KiCad
 * failing on the board (PROTOBOARD_KICAD_CLI, read when the provider first
 * looks for KiCad, which is the lock itself in this test file).
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject, runCapabilityOperation } from "@protoboardai/core";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/kicad-lock-atomic");
const ROOT = join(TMP, "lamp");
const DIR = "src/boards/lamp";
const run = async (op: string) => runCapabilityOperation(await loadProject(ROOT, { checks: false, fresh: true }), "circuit", op, "fx-lamp-board", {});

describe.skipIf(process.platform === "win32")("circuit:lock writes nothing when it fails", () => {
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    cpSync(join(HERE, "fixtures/nested-board"), ROOT, { recursive: true });
    mkdirSync(join(TMP, "bin"), { recursive: true });
    const fake = join(TMP, "bin/kicad-cli");
    writeFileSync(fake, `#!/bin/sh\nif [ "$1" = version ]; then echo 10.0.6; exit 0; fi\necho "fake kicad-cli: cannot read the board" >&2\nexit 3\n`);
    chmodSync(fake, 0o755);
    process.env.PROTOBOARD_KICAD_CLI = fake;
  });
  afterAll(() => {
    delete process.env.PROTOBOARD_KICAD_CLI;
    rmSync(TMP, { recursive: true, force: true });
  });

  it("leaves the board unlocked, with no kicad/ and refdes.json as generate wrote it, and says why", async () => {
    expect((await run("generate")).status).toBe("succeeded");
    // generate records the designators (F07); a failed lock does not touch them
    const refdes = readFileSync(join(ROOT, DIR, "tscircuit/refdes.json"), "utf8");
    const lock = await run("lock");
    expect(lock.status).toBe("failed");
    expect(lock.summary).toMatch(/fx-lamp-board was not locked \(nothing written to src\/boards\/lamp\/kicad\/\): .*fake kicad-cli: cannot read the board/);
    expect(existsSync(join(ROOT, DIR, "kicad"))).toBe(false);
    expect(readFileSync(join(ROOT, DIR, "tscircuit/refdes.json"), "utf8")).toBe(refdes);
    expect(lock.outputs.filter((o) => o.path.includes("/kicad/") || o.path.endsWith("refdes.json"))).toEqual([]);
  }, 300_000);
});
