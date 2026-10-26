/**
 * The user's Protoboard folders stay private (PB-1048): made 0700, and
 * tightened to 0700 when an earlier version left them 0755.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ensurePrivateDir, tightenDir, tightenUserFolders } from "../src/index.js";
import { writeHome } from "../src/stack-unpack.js";

const TMP = mkdtempSync(join(tmpdir(), "pb-private-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const mode = (d: string) => statSync(d).mode & 0o777;

describe.skipIf(process.platform === "win32")("private folders", () => {
  it("ensurePrivateDir makes a folder 0700 and tightens one that is there", () => {
    const fresh = ensurePrivateDir(join(TMP, "fresh", "protoboard"));
    expect(mode(fresh)).toBe(0o700);
    const open = join(TMP, "open");
    mkdirSync(open, { mode: 0o755 });
    chmodSync(open, 0o755);
    ensurePrivateDir(open);
    expect(mode(open)).toBe(0o700);
  });

  it("tightenDir leaves a missing folder missing, does not follow a link, and does nothing on Windows", () => {
    expect(tightenDir(join(TMP, "missing"))).toBe(false);
    const target = join(TMP, "target");
    mkdirSync(target);
    chmodSync(target, 0o755);
    symlinkSync(target, join(TMP, "link"));
    expect(tightenDir(join(TMP, "link"))).toBe(false);
    expect(mode(target)).toBe(0o755);
    expect(tightenDir(target, "win32")).toBe(false);
    expect(mode(target)).toBe(0o755);
  });

  it("tightenUserFolders tightens the config folder and the stack home the environment names", () => {
    const config = join(TMP, "u", ".config", "protoboard");
    const home = join(TMP, "u", ".protoboard");
    for (const d of [config, home]) {
      mkdirSync(d, { recursive: true });
      chmodSync(d, 0o755);
    }
    expect(tightenUserFolders({ PROTOBOARD_CONFIG_DIR: config, PROTOBOARD_HOME: home }).sort()).toEqual([config, home].sort());
    expect([mode(config), mode(home)]).toEqual([0o700, 0o700]);
    expect(tightenUserFolders({ PROTOBOARD_CONFIG_DIR: config, PROTOBOARD_HOME: home })).toEqual([]);
  });

  it("writing the stack home's command makes ~/.protoboard 0700", () => {
    const home = join(TMP, "stack-home");
    mkdirSync(home);
    chmodSync(home, 0o755);
    writeHome(home, { runtime: process.execPath, version: "0.0.1", platform: "linux" });
    expect(mode(home)).toBe(0o700);
  });
});
