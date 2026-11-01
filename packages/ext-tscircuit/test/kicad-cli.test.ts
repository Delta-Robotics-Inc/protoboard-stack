/**
 * Finding kicad-cli for any KiCad version (PB-1182): lib/kicad/detect.cjs, the
 * one search cli.ts and probe.cjs share, run against a fake file tree and a
 * fake `kicad-cli version` (no KiCad needed, same result on every platform).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { candidates, describeKicadCli, findKicadCli, parseVersion, type KicadDetectDeps } from "../lib/kicad/detect.cjs";
import { kicadCli, kicadCliInfo, kicadCliSummary, kicadVersion } from "../lib/kicad/cli.ts";

/** A machine: files (path -> the version its `kicad-cli version` prints, or null when it answers nothing), env, platform. */
function machine(platform: string, files: Record<string, string | null>, env: Record<string, string> = {}, options: { versionFails?: boolean } = {}) {
  const win = platform === "win32";
  const norm = (p: string) => (win ? p.toLowerCase().replace(/\//g, "\\") : p);
  const sep = win ? "\\" : "/";
  const keys = Object.keys(files).map((k) => (win ? k.replace(/\//g, "\\") : k));
  const table = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
  const runs: string[] = [];
  const deps: KicadDetectDeps = {
    platform,
    env,
    home: win ? "C:\\Users\\you" : platform === "darwin" ? "/Users/you" : "/home/you",
    exists: (p) => table.has(norm(p)),
    readdir: (dir) => {
      // norm() only changes case, so a key's own spelling can be cut at the same length
      const d = norm(dir).replace(/[\\/]+$/, "") + sep;
      const names = new Set<string>();
      for (const k of keys) if (norm(k).startsWith(d)) names.add(k.slice(d.length).split(sep)[0]);
      return [...names];
    },
    run: (file, args) => {
      runs.push(`${file} ${args.join(" ")}`);
      const v = table.get(norm(file));
      if (v === undefined) return { status: null, stdout: "", stderr: `spawn ${file} ENOENT` };
      if (v === null) return { status: 1, stdout: "", stderr: "kicad-cli: crashed" };
      if (options.versionFails && args[0] === "version") return { status: 1, stdout: "", stderr: "unknown command version" };
      return { status: 0, stdout: `${v}\n` };
    },
  };
  return { deps, runs };
}

const WIN = "C:\\Program Files\\KiCad";

describe("kicad-cli version text", () => {
  it("parses stable, nightly and release-candidate answers", () => {
    expect(parseVersion("10.0.8\n")).toEqual({ version: "10.0.8", major: 10, minor: 0, patch: 8 });
    expect(parseVersion("10.99.0-1234-g0123abcd")).toMatchObject({ version: "10.99.0-1234-g0123abcd", major: 10, minor: 99 });
    expect(parseVersion("11.0.0-rc1")).toMatchObject({ major: 11, minor: 0 });
    expect(parseVersion("Application: kicad-cli\nVersion: 10.0.5, release build")).toMatchObject({ version: "10.0.5", major: 10, minor: 0, patch: 5 });
    expect(parseVersion("usage: kicad-cli")).toBeUndefined();
  });
});

describe("finding kicad-cli", () => {
  it("prefers kicad-cli on PATH over the install folders", () => {
    const { deps } = machine("win32", { "D:\\tools\\kicad\\kicad-cli.exe": "10.0.8", [`${WIN}\\10.0\\bin\\kicad-cli.exe`]: "10.0.6" }, { Path: "C:\\Windows;D:\\tools\\kicad" });
    const r = findKicadCli(deps);
    expect(r.cli).toEqual({ path: "D:\\tools\\kicad\\kicad-cli.exe", version: "10.0.8", major: 10, minor: 0, source: "path", nightly: false });
    expect(describeKicadCli(r.cli!)).toBe("kicad-cli 10.0.8 at D:\\tools\\kicad\\kicad-cli.exe (found on PATH)");
  });

  it("finds KiCad 10.0 in Program Files when it is not on PATH (what was hard-coded before)", () => {
    const { deps, runs } = machine("win32", { [`${WIN}\\10.0\\bin\\kicad-cli.exe`]: "10.0.5", [`${WIN}\\9.0\\bin\\Lib\\x.dll`]: null }, { PATH: "C:\\Windows" });
    const r = findKicadCli(deps);
    expect(r.cli).toMatchObject({ path: `${WIN}\\10.0\\bin\\kicad-cli.exe`, version: "10.0.5", major: 10, minor: 0, source: "install" });
    // the 9.0 folder without a kicad-cli.exe (this machine has one) is not run
    expect(runs).toEqual([`${WIN}\\10.0\\bin\\kicad-cli.exe version`]);
  });

  it("finds a 10.99 nightly, and takes the newest version folder first", () => {
    const { deps } = machine("win32", { [`${WIN}\\10.0\\bin\\kicad-cli.exe`]: "10.0.8", [`${WIN}\\10.99\\bin\\kicad-cli.exe`]: "10.99.0-512-gfeedbee" });
    expect(candidates(deps).map((c) => c.path)).toEqual([`${WIN}\\10.99\\bin\\kicad-cli.exe`, `${WIN}\\10.0\\bin\\kicad-cli.exe`]);
    const r = findKicadCli(deps);
    expect(r.cli).toMatchObject({ version: "10.99.0-512-gfeedbee", major: 10, minor: 99, nightly: true, source: "install" });
    expect(describeKicadCli(r.cli!)).toMatch(/\(found in KiCad's install folder; a nightly build\)$/);
  });

  it("accepts KiCad 11 (it drops the Python bindings, not kicad-cli) and says it is newer than tested", () => {
    const { deps } = machine("win32", { [`${WIN}\\11.0\\bin\\kicad-cli.exe`]: "11.0.0", [`${WIN}\\10.0\\bin\\kicad-cli.exe`]: "10.0.8" });
    const r = findKicadCli(deps);
    expect(r.cli).toMatchObject({ path: `${WIN}\\11.0\\bin\\kicad-cli.exe`, major: 11, minor: 0, nightly: false });
    expect(describeKicadCli(r.cli!)).toMatch(/newer than the KiCad 10 this provider is tested with/);
  });

  it("checks the major version: a KiCad 9 on PATH is passed over for a KiCad 10 install", () => {
    const { deps } = machine("win32", { "D:\\old\\kicad-cli.exe": "9.0.4", [`${WIN}\\10.0\\bin\\kicad-cli.exe`]: "10.0.8" }, { PATH: "D:\\old" });
    const r = findKicadCli(deps);
    expect(r.cli?.path).toBe(`${WIN}\\10.0\\bin\\kicad-cli.exe`);
    expect(r.tried).toEqual([{ path: "D:\\old\\kicad-cli.exe", source: "path", why: "KiCad 9.0.4 is older than KiCad 10" }]);
  });

  it("finds a per-user Windows install, and asks --version when `version` fails", () => {
    const local = "C:\\Users\\you\\AppData\\Local";
    const { deps, runs } = machine("win32", { [`${local}\\Programs\\KiCad\\10.0\\bin\\kicad-cli.exe`]: "10.0.7" }, { LOCALAPPDATA: local }, { versionFails: true });
    expect(findKicadCli(deps).cli).toMatchObject({ version: "10.0.7", source: "install" });
    expect(runs.map((r) => r.split(" ").pop())).toEqual(["version", "--version"]);
  });

  it("finds the macOS app bundle and a versioned or nightly bundle", () => {
    const { deps } = machine("darwin", {
      "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli": "10.0.8",
      "/Applications/KiCad 10.99/KiCad.app/Contents/MacOS/kicad-cli": "10.99.0-77-gabc",
    });
    expect(candidates(deps).map((c) => c.path)).toEqual(["/Applications/KiCad 10.99/KiCad.app/Contents/MacOS/kicad-cli", "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"]);
    const only = machine("darwin", { "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli": "10.0.8" });
    expect(findKicadCli(only.deps).cli).toMatchObject({ path: "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli", source: "install" });
  });

  it("finds the Linux package's kicad-cli", () => {
    const { deps } = machine("linux", { "/usr/bin/kicad-cli": "10.0.8" }, { PATH: "/home/you/bin:/usr/sbin" });
    expect(findKicadCli(deps).cli).toMatchObject({ path: "/usr/bin/kicad-cli", source: "install" });
  });

  it("says what to do when none is found, and when only an old KiCad is installed", () => {
    const none = findKicadCli(machine("win32", {}, { PATH: "C:\\Windows" }).deps);
    expect(none.cli).toBeUndefined();
    expect(none.reason).toMatch(/kicad-cli not found on PATH or in KiCad's install folders; install KiCad 10 or newer .*PROTOBOARD_KICAD_CLI/);
    const old = findKicadCli(machine("linux", { "/usr/bin/kicad-cli": "8.0.9" }).deps);
    expect(old.cli).toBeUndefined();
    expect(old.reason).toBe("only KiCad 8.0.9 was found (/usr/bin/kicad-cli); install KiCad 10 or newer, or set PROTOBOARD_KICAD_CLI to its kicad-cli");
  });

  it("uses PROTOBOARD_KICAD_CLI first, and reports a broken one instead of falling back", () => {
    const tree = { "E:\\kicad\\kicad-cli.exe": "10.0.8", [`${WIN}\\10.0\\bin\\kicad-cli.exe`]: "10.0.5" };
    const ok = findKicadCli(machine("win32", tree, { PROTOBOARD_KICAD_CLI: "E:\\kicad\\kicad-cli.exe", PATH: `${WIN}\\10.0\\bin` }).deps);
    expect(ok.cli).toMatchObject({ path: "E:\\kicad\\kicad-cli.exe", source: "override", version: "10.0.8" });
    expect(describeKicadCli(ok.cli!)).toMatch(/\(from PROTOBOARD_KICAD_CLI\)$/);
    const missing = findKicadCli(machine("win32", tree, { PROTOBOARD_KICAD_CLI: "E:\\nope\\kicad-cli.exe" }).deps);
    expect(missing.cli).toBeUndefined();
    expect(missing.reason).toBe("PROTOBOARD_KICAD_CLI is set to E:\\nope\\kicad-cli.exe, which is not a usable kicad-cli (no such file); fix or unset it");
    const broken = findKicadCli(machine("win32", { ...tree, "E:\\bad\\kicad-cli.exe": null }, { PROTOBOARD_KICAD_CLI: "E:\\bad\\kicad-cli.exe" }).deps);
    expect(broken.reason).toMatch(/not a usable kicad-cli \(no version answered \(kicad-cli: crashed\)\)/);
  });
});

describe("cli.ts and probe.cjs on this machine", () => {
  const PROBE = fileURLToPath(new URL("../lib/kicad/probe.cjs", import.meta.url));

  it("cli.ts reports the same kicad-cli as the probe (one search), asking its version once", () => {
    const probe = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(PROBE)})`], { encoding: "utf8", timeout: 60_000 });
    const info = kicadCliInfo();
    if (!info) {
      expect(probe.status).toBe(1);
      expect(probe.stderr.trim()).toBe(kicadCliSummary());
      return;
    }
    expect(probe.status).toBe(0);
    expect(probe.stdout.trim()).toBe(kicadCliSummary());
    expect(kicadCli()).toBe(info.path);
    expect(kicadVersion()).toBe(info.version);
    expect(info.major).toBeGreaterThanOrEqual(10);
    expect(kicadCliInfo()).toBe(info); // cached: the same object, no second `kicad-cli version`
  }, 60_000);
});
