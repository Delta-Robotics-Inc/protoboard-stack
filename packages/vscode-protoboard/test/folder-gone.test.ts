/**
 * A project whose folder is gone (moved, deleted, a worktree removed). The
 * system answers "not found" for the program when the working folder is
 * missing, which the extension used to report as a missing Node.js; and a
 * viewer tab VS Code restored for such a project made it the current one
 * again after every reload (owner's report, 2026-10-12).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { folderGone, runCli } from "../src/cli.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("a project folder that is gone", () => {
  it("is named as the problem, not the Node.js that would run the CLI", async () => {
    const gone = join(here, "no-such-project-folder");
    const cli = { command: process.execPath, args: ["-e", "process.exit(0)"], from: "project" } as never;
    await expect(runCli(cli, [], { cwd: gone })).rejects.toThrow(/is no longer there: the project was moved or deleted/);
    await expect(runCli(cli, [], { cwd: gone })).rejects.not.toThrow(/Node\.js chosen/);
    expect(folderGone(gone).message).toContain(gone);
  });

  it("closes a restored viewer tab, and the tabs of a project that goes while the window is open", () => {
    const viewer = readFileSync(join(here, "../src/viewerEditor.ts"), "utf8");
    expect(viewer).toMatch(/if \(!existsSync\(join\(document\.target\.root, "protoboard\.config\.ts"\)\)\) \{[\s\S]{0,400}panel\.dispose\(\)/);
    const ext = readFileSync(join(here, "../src/extension.ts"), "utf8");
    expect(ext).toMatch(/for \(const e of \[\.\.\.this\.viewers\.editors\]\) if \(!existsSync\(join\(e\.root, "protoboard\.config\.ts"\)\)\) e\.panel\.dispose\(\)/);
  });
});

describe("a project folder moved or deleted while the window is open (B5)", () => {
  const ext = readFileSync(join(here, "../src/extension.ts"), "utf8");
  it("is looked for every few seconds: a renamed folder fires no protoboard.config.ts event", () => {
    expect(ext).toMatch(/private watchFoldersGone\(\) \{[\s\S]{0,600}existsSync\(join\(r, "protoboard\.config\.ts"\)\)\) return this\.refreshRoots\(\)/);
    expect(ext).toMatch(/this\.watchFoldersGone\(\);/);
  });
  it("clears its findings from Problems, and stops its check and its dev server", () => {
    const forget = ext.slice(ext.indexOf("private forget(root: string)"), ext.indexOf("private watchFoldersGone()"));
    expect(forget).toMatch(/this\.diagnostics\.delete/);
    expect(forget).toMatch(/this\.results\.delete\(root\)/);
    expect(forget).toMatch(/process\.stop\(/);
    expect(ext).toMatch(/\.filter\(\(r\) => !roots\.includes\(r\) && !existsSync\(join\(r, "protoboard\.config\.ts"\)\)\)/);
    expect(ext).toMatch(/for \(const r of gone\) this\.forget\(r\)/);
  });
  it("is read again when its folder comes back (restored from the Trash, moved back)", () => {
    const forget = ext.slice(ext.indexOf("private forget(root: string)"), ext.indexOf("private watchFoldersGone()"));
    expect(forget).toMatch(/this\.goneRoots\.add\(root\)/);
    const watch = ext.slice(ext.indexOf("private watchFoldersGone()"), ext.indexOf("private get lastUsed()"));
    expect(watch).toMatch(/\[\.\.\.this\.goneRoots\]\.filter\(\(r\) => existsSync\(join\(r, "protoboard\.config\.ts"\)\)\)/);
    expect(watch).toMatch(/this\.goneRoots\.delete\(r\)[\s\S]{0,200}return this\.refreshRoots\(\)/);
  });
  it("closes the panel before the DRC view goes, so no terminal is started in the folder that is gone", () => {
    expect(ext).toMatch(/if \(gone\.length && !roots\.length && this\.drc\.visible\) await vscode\.commands\.executeCommand\("workbench\.action\.closePanel"\);\s+await this\.setProjectContext\(roots\)/);
  });
});

describe("a project that waits to be set up (B17)", () => {
  it("does not log which CLI it would run on every look, only when that changes", () => {
    const ext = readFileSync(join(here, "../src/extension.ts"), "utf8");
    const loop = ext.slice(ext.indexOf("private async runnable(root: string)"), ext.indexOf("/** Ends a project's wait at once"));
    const body = loop.slice(loop.indexOf("for (;;)"), loop.indexOf("} finally"));
    expect(body).not.toMatch(/cliSaid\.delete/);
    expect(ext).toMatch(/if \(this\.cliSaid\.get\(root\) !== said\) \{/);
  });
});
