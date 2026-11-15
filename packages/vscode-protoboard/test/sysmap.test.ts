/**
 * The System Map in VS Code (docs/specs/system-map.md; src/systemMap.ts):
 * which stack the extension maps (its own repository for a development
 * build, else the stack it carries, never a project's), the session's map
 * (one build for requests that overlap, Rebuild builds again, a failure is
 * said and not kept), and the files it opens (only inside the stack). The
 * pages' data adapters and messages are tested in
 * packages/web-viewer/test/sysmap-data.test.ts.
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stackCli, stackDir } from "@protoboardai/core/stack";
import { MONOREPO_CLI, NO_STACK_MESSAGE, SysmapCache, findStackRoot, stackFileOf, type StackLocation } from "../src/systemMap.js";
import { viewerTitle } from "../src/viewerPage.js";
import type { CliResult } from "../src/cli.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp", "sysmap");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A file system of these files (package.json contents by path). */
function fakeFs(files: Record<string, unknown>) {
  const read: string[] = [];
  return {
    read,
    exists: (p: string) => p in files,
    readJson: (p: string) => {
      read.push(p);
      const v = files[p];
      if (v === "broken") throw new SyntaxError("Unexpected token");
      return v;
    },
  };
}

describe("which stack the System Map is of", () => {
  const repo = resolve("/work/protoboard-stack");
  const extensionPath = join(repo, "packages", "vscode-protoboard");
  const home = resolve("/home/someone/.protoboard");

  it("a development build maps the stack's repository it lies in", () => {
    const fs = fakeFs({
      [join(extensionPath, "package.json")]: { name: "vscode-protoboard" },
      [join(repo, "package.json")]: { name: "protoboard-stack", workspaces: ["packages/cli", "packages/core"] },
      [join(repo, MONOREPO_CLI)]: true,
    });
    // even when the build carries a stack too (an F5 run after a packaging build): the repository is the code that runs
    expect(findStackRoot({ extensionPath, home, carried: { version: "0.3.0" }, ...fs })).toEqual({ root: repo, layout: "monorepo", cli: join(repo, MONOREPO_CLI) });
  });

  it("a package.json with workspaces but no stack CLI is not the stack's repository", () => {
    const outer = resolve("/work");
    const fs = fakeFs({
      [join(repo, "package.json")]: "broken",
      [join(outer, "package.json")]: { workspaces: { packages: ["*"] } },
    });
    expect(findStackRoot({ extensionPath, home, carried: { version: "0.3.0" }, ...fs })).toEqual({ root: stackDir(home, "0.3.0"), layout: "installed", cli: stackCli(stackDir(home, "0.3.0")), version: "0.3.0" });
    // the broken package.json was read and passed over
    expect(fs.read).toContain(join(repo, "package.json"));
  });

  it("an installed build maps the stack it carries, in its unpacked copy", () => {
    const installed = resolve("/home/someone/.vscode/extensions/deltarobotics.vscode-protoboard-0.3.0");
    const fs = fakeFs({ [join(installed, "package.json")]: { name: "vscode-protoboard" } });
    const at = findStackRoot({ extensionPath: installed, home, carried: { version: "0.3.0" }, ...fs });
    expect(at).toEqual({ root: join(home, "stack", "0.3.0"), layout: "installed", cli: join(home, "stack", "0.3.0", "node_modules", "@protoboardai", "cli", "bin", "protoboard.mjs"), version: "0.3.0" });
  });

  it("a build that carries no stack and is not in the repository has none, and says so", () => {
    const fs = fakeFs({});
    expect(() => findStackRoot({ extensionPath: resolve("/somewhere/else"), home, ...fs })).toThrow(NO_STACK_MESSAGE);
    expect(NO_STACK_MESSAGE).toMatch(/carries no stack/);
  });

  it("this package, in this repository, is a development build of it", () => {
    const root = resolve(HERE, "..", "..", "..");
    expect(findStackRoot({ extensionPath: resolve(HERE, ".."), home })).toEqual({ root, layout: "monorepo", cli: join(root, MONOREPO_CLI) });
  });
});

const MAP = {
  schema: "protoboard.sysmap/v0",
  stack: "0.3.0",
  layout: "monorepo",
  counts: { items: 1, links: 0, byType: {}, byDiscipline: {}, byStatus: { released: 1, wip: 0, outside: 0 }, byLinkKind: {}, problems: 0 },
  islands: [],
  stages: [],
  releases: [],
  items: [{ id: "pkg:@protoboardai/cli", type: "package", name: "@protoboardai/cli", source: "packages/cli/package.json" }],
  links: [],
  inputs: [["packages/cli/package.json", 10, 0, "abc"]],
  history: { head: "abc", tags: [], dirty: "x" },
  problems: [],
};

/** A cache over a fake CLI: `answers` are what each run prints, in order. */
function cacheWith(o: { answers: (CliResult | Error)[]; location?: StackLocation | (() => StackLocation); exists?: (p: string) => boolean }) {
  const runs: { cli: string; args: string[]; cwd: string }[] = [];
  const logs: string[] = [];
  let prepared = 0;
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  const at = o.location ?? { root: resolve("/work/protoboard-stack"), layout: "monorepo", cli: resolve("/work/protoboard-stack/packages/cli/bin/protoboard.mjs") };
  const cache = new SysmapCache({
    locate: typeof at === "function" ? at : () => at,
    prepare: async () => void prepared++,
    run: async (cli, args, cwd) => {
      runs.push({ cli, args, cwd });
      if (gate) await gate;
      const a = o.answers.shift();
      if (!a) throw new Error("no more answers");
      if (a instanceof Error) throw a;
      return a;
    },
    log: (l) => logs.push(l),
    exists: o.exists ?? (() => true),
    now: () => 0,
  });
  return {
    cache,
    runs,
    logs,
    prepared: () => prepared,
    hold() {
      gate = new Promise((ok) => (release = ok));
    },
    release() {
      gate = undefined;
      release?.();
    },
  };
}

const printed = (v: unknown, code = 0): CliResult => ({ code, stdout: JSON.stringify(v), stderr: "" });

describe("the session's System Map", () => {
  it("is built once by the stack's own CLI for requests that overlap, and kept", async () => {
    const t = cacheWith({ answers: [printed(MAP)] });
    t.hold();
    const a = t.cache.get();
    const b = t.cache.get();
    const c = t.cache.get({ refresh: true });
    t.release();
    const [ga, gb, gc] = await Promise.all([a, b, c]);
    expect(ga).toBe(gb);
    expect(gc).toBe(ga);
    expect(t.runs).toEqual([{ cli: resolve("/work/protoboard-stack/packages/cli/bin/protoboard.mjs"), args: ["map", "--root", resolve("/work/protoboard-stack"), "--format", "json"], cwd: resolve("/work/protoboard-stack") }]);
    // the view's projection: no inputs, no history fingerprint
    expect(ga).toEqual({ stack: "0.3.0", layout: "monorepo", counts: MAP.counts, islands: [], stages: [], releases: [], items: MAP.items, links: [], problems: [] });
    expect(ga).not.toHaveProperty("inputs");
    expect(await t.cache.get()).toBe(ga);
    expect(t.cache.stats.builds).toBe(1);
    // one line in the log for the build: where from, how long, what it holds
    expect(t.logs).toEqual([`System Map: built from ${resolve("/work/protoboard-stack")} (the stack's repository, stack 0.3.0) in 0.0 s: 1 items, 0 links, 0 problem(s)`]);
    // a monorepo has nothing to unpack
    expect(t.prepared()).toBe(0);
  });

  it("is built again on Rebuild", async () => {
    const t = cacheWith({ answers: [printed(MAP), printed({ ...MAP, stack: "0.3.1" })] });
    expect((await t.cache.get()).stack).toBe("0.3.0");
    expect((await t.cache.get({ refresh: true })).stack).toBe("0.3.1");
    expect((await t.cache.get()).stack).toBe("0.3.1");
    expect(t.runs).toHaveLength(2);
    expect(t.logs).toHaveLength(2);
  });

  it("unpacks the carried stack before its CLI runs", async () => {
    const dir = stackDir(resolve("/home/someone/.protoboard"), "0.3.0");
    const t = cacheWith({ answers: [printed({ ...MAP, layout: "installed" })], location: { root: dir, layout: "installed", cli: stackCli(dir), version: "0.3.0" } });
    await t.cache.get();
    expect(t.prepared()).toBe(1);
    expect(t.runs[0]).toEqual({ cli: stackCli(dir), args: ["map", "--root", dir, "--format", "json"], cwd: dir });
    expect(t.logs[0]).toContain("(the carried stack 0.3.0, stack 0.3.0)");
  });

  it("answers what failed, keeps nothing broken, and tries again on the next request", async () => {
    const t = cacheWith({ answers: [{ code: 2, stdout: JSON.stringify({ error: "--root: no folder x" }), stderr: "" }, { code: 1, stdout: "", stderr: "Error: Cannot find module tsx\n" }, printed({ items: [] }), printed(MAP)] });
    await expect(t.cache.get()).rejects.toThrow("protoboard map: --root: no folder x");
    await expect(t.cache.get()).rejects.toThrow(/printed no JSON \(exit 1\): Error: Cannot find module tsx/);
    await expect(t.cache.get()).rejects.toThrow("protoboard map printed no System Map");
    expect((await t.cache.get()).stack).toBe("0.3.0");
    expect(t.logs.slice(0, 3).every((l) => l.startsWith(`System Map: the build from ${resolve("/work/protoboard-stack")} failed after 0.0 s: `))).toBe(true);
  });

  it("keeps the map it had when a Rebuild fails", async () => {
    const t = cacheWith({ answers: [printed(MAP), new Error("spawn node ENOENT")] });
    const first = await t.cache.get();
    await expect(t.cache.get({ refresh: true })).rejects.toThrow("spawn node ENOENT");
    expect(await t.cache.get()).toBe(first);
  });

  it("refuses when there is no stack, or its CLI is not there, without running anything", async () => {
    const none = cacheWith({
      answers: [],
      location: () => {
        throw new Error(NO_STACK_MESSAGE);
      },
    });
    await expect(none.cache.get()).rejects.toThrow(NO_STACK_MESSAGE);
    expect(none.logs).toEqual([`System Map: the build failed after 0.0 s: ${NO_STACK_MESSAGE}`]);
    const gone = cacheWith({ answers: [printed(MAP)], exists: () => false });
    await expect(gone.cache.get()).rejects.toThrow(/the stack's CLI is not at /);
    expect(none.runs).toEqual([]);
    expect(gone.runs).toEqual([]);
  });

  it("says where the map is from: the last build's stack, else the one it would build", async () => {
    let asked = 0;
    const repo = resolve("/work/protoboard-stack");
    const t = cacheWith({ answers: [printed(MAP)], location: () => ({ root: join(repo, String(asked++)), layout: "monorepo", cli: join(repo, MONOREPO_CLI) }) });
    expect(t.cache.location().root).toBe(join(repo, "0"));
    await t.cache.get();
    // the build's own location from then on, not asked again
    expect(t.cache.location().root).toBe(join(repo, "1"));
    expect(t.cache.location().root).toBe(join(repo, "1"));
    expect(asked).toBe(2);
  });
});

describe("a file the System Map opens", () => {
  const root = join(TMP, "stack");
  const outside = join(TMP, "outside");
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(root, "packages", "cli", "src"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, "packages", "cli", "src", "index.ts"), "// the CLI\n");
    writeFileSync(join(root, "packages", "cli", ".env.local"), "TOKEN=1\n");
    writeFileSync(join(outside, "secret.txt"), "outside\n");
    // a link inside the stack that leads out of it (a junction: no rights needed on Windows)
    symlinkSync(outside, join(root, "linked"), "junction");
  });

  it("opens a file inside the stack, the item's entry dropped", () => {
    expect(stackFileOf(root, "packages/cli/src/index.ts")).toEqual({ file: join(root, "packages", "cli", "src", "index.ts") });
    expect(stackFileOf(root, "packages/cli/src/index.ts#case:map")).toEqual({ file: join(root, "packages", "cli", "src", "index.ts") });
    expect(readFileSync(join(root, "packages", "cli", "src", "index.ts"), "utf8")).toContain("CLI");
  });

  it("refuses a path that leaves the stack, by text or through a link", () => {
    for (const p of ["../outside/secret.txt", "packages/../../outside/secret.txt", join(outside, "secret.txt"), "linked/secret.txt", "", "#entry"]) {
      expect(stackFileOf(root, p), p).toHaveProperty("refused");
    }
    expect(stackFileOf(root, "linked/secret.txt")).toEqual({ refused: "linked/secret.txt is not a file of the Protoboard stack." });
  });

  it("refuses a sensitive name, a folder and a file that is not there", () => {
    expect(stackFileOf(root, "packages/cli/.env.local")).toEqual({ refused: "packages/cli/.env.local is not opened from the System Map (its name looks like a secret's)." });
    expect(stackFileOf(root, "packages/cli/src")).toHaveProperty("refused", expect.stringMatching(/is not in the stack/));
    expect(stackFileOf(root, "packages/cli/package.json (not installed)")).toHaveProperty("refused", expect.stringMatching(/Rebuild builds it again/));
  });
});

describe("the System Map in the extension's manifest and tabs", () => {
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as { activationEvents: string[]; contributes: { commands: { command: string; title: string; category?: string; icon?: string; enablement?: string }[] } };

  it("has Open System Map in the palette next to Open Atlas, needing no sign-in", () => {
    const ids = pkg.contributes.commands.map((c) => c.command);
    const map = pkg.contributes.commands.find((c) => c.command === "protoboard.openSystemMap");
    expect(map).toEqual({ command: "protoboard.openSystemMap", title: "Open System Map", category: "Protoboard", icon: "$(map)" });
    expect(ids.indexOf("protoboard.openSystemMap")).toBe(ids.indexOf("protoboard.openAtlas") + 1);
    // VS Code restores the panel after a reload
    expect(pkg.activationEvents).toContain("onWebviewPanel:protoboard.systemMap");
  });

  it("titles a viewer tab's System Map tab", () => {
    expect(viewerTitle("quadcopter-5in", "sysmap")).toBe("quadcopter-5in · System Map");
  });
});
