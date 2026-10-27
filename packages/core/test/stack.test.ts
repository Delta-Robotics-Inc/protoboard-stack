/**
 * Stack copies outside a project (PB-929): finding them, linking a project
 * to one without touching what npm installed, the command scripts, and a
 * copy installed from a registry (npm stubbed).
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  LINK_RECORD,
  SHIM_MARK,
  STACK_MARKER,
  carriedStack,
  chooseStack,
  compareVersions,
  installStack,
  linkProject,
  listStacks,
  globalStack,
  isDevVersion,
  missingFromStack,
  needsLink,
  npmAuthProblem,
  packageState,
  readLinkRecord,
  shellCommand,
  stackCli,
  stackDir,
  stackFor,
  stackHome,
  stackRangeFor,
  stackVersionMismatch,
  unlinkProject,
  versionSatisfies,
  windowsCommand,
  writeCommands,
  type StackMarker,
} from "../src/index.js";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-stack-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A stand-in stack copy: the packages as folders with a package.json, the CLI entry, the marker. */
function fakeStack(home: string, version: string, source: StackMarker["source"] = "vsix", names = ["@protoboardai/core", "@protoboardai/cli", "@protoboardai/ext-hardware", "@deltarobotics/uhd"]) {
  const dir = stackDir(home, version);
  for (const n of names) {
    mkdirSync(join(dir, "node_modules", n), { recursive: true });
    writeFileSync(join(dir, "node_modules", n, "package.json"), JSON.stringify({ name: n, version }));
  }
  mkdirSync(join(dir, "node_modules/@protoboardai/cli/bin"), { recursive: true });
  writeFileSync(stackCli(dir), `console.log("cli ${version} " + process.argv.slice(2).join(" "));\n`);
  const marker: StackMarker = { schema: "protoboard.stack/v1", version, source, packages: Object.fromEntries(names.map((n) => [n, version])), installedAt: "2026-10-07T00:00:00.000Z" };
  writeFileSync(join(dir, STACK_MARKER), JSON.stringify(marker));
  return dir;
}

function project(name: string, range = "^0.1.3", extra: Record<string, string> = {}) {
  const root = join(TMP, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, dependencies: { "@deltarobotics/uhd": "0.2.1", "@protoboardai/core": range, "@protoboardai/ext-hardware": range, ...extra }, devDependencies: { "@protoboardai/cli": range, typescript: "7.0.2" } }),
  );
  return root;
}

describe("versions", () => {
  it("orders versions and judges the ranges projects carry", () => {
    expect(["0.1.10", "0.1.2", "0.2.0", "0.1.3-dev.1", "0.1.3"].sort(compareVersions)).toEqual(["0.1.2", "0.1.3-dev.1", "0.1.3", "0.1.10", "0.2.0"]);
    expect(versionSatisfies("0.1.3", "^0.1.1")).toBe(true);
    expect(versionSatisfies("0.1.3", "^0.1.4")).toBe(false);
    expect(versionSatisfies("0.2.0", "^0.1.3")).toBe(false);
    expect(versionSatisfies("1.4.0", "^1.2.3")).toBe(true);
    expect(versionSatisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(versionSatisfies("0.1.3", "0.1.3")).toBe(true);
    expect(versionSatisfies("0.1.4", "0.1.3")).toBe(false);
    expect(versionSatisfies("0.1.9", "~0.1.3")).toBe(true);
    expect(versionSatisfies("0.2.0", "~0.1.3")).toBe(false);
    expect(versionSatisfies("0.3.0", ">=0.1.3")).toBe(true);
    expect(versionSatisfies("0.1.3", "*")).toBe(true);
    expect(versionSatisfies("0.1.3", "0.1.x")).toBe(true);
    // a tag or a URL cannot be judged
    expect(versionSatisfies("0.1.3", "next")).toBeUndefined();
    expect(versionSatisfies("0.1.3", "file:../core")).toBeUndefined();
  });

  it("a development build (x.y.z-dev.<n>.g<sha>, PB-1062) is judged by the release it leads to; releases and published prereleases as before", () => {
    const dev = "0.2.1-dev.7.g1a2b3c4";
    expect(isDevVersion(dev)).toBe(true);
    expect(isDevVersion("0.2.1")).toBe(false);
    expect(isDevVersion("0.3.0-rc.1")).toBe(false);
    // it sorts after the release it builds on, before the next, and later commits later (numerically)
    expect(["0.2.1", "0.2.1-dev.12.gaaaaaaa", "0.2.0", "0.2.1-dev.7.g1a2b3c4", "0.2.1-dev.0.gbbbbbbb"].sort(compareVersions)).toEqual(["0.2.0", "0.2.1-dev.0.gbbbbbbb", "0.2.1-dev.7.g1a2b3c4", "0.2.1-dev.12.gaaaaaaa", "0.2.1"]);
    // what projects pin: npm's semver would refuse a prerelease here
    expect(versionSatisfies(dev, "^0.2.0")).toBe(true);
    expect(versionSatisfies(dev, "~0.2.0")).toBe(true);
    expect(versionSatisfies(dev, ">=0.2.0")).toBe(true);
    expect(versionSatisfies(dev, "0.2.x")).toBe(true);
    expect(versionSatisfies(dev, "^0.2.1")).toBe(true);
    // not loosened: another line, a newer floor, an exact pin
    expect(versionSatisfies(dev, "^0.1.0")).toBe(false);
    expect(versionSatisfies(dev, "^0.3.0")).toBe(false);
    expect(versionSatisfies(dev, "^0.2.2")).toBe(false);
    expect(versionSatisfies(dev, "0.2.1")).toBe(false);
    expect(versionSatisfies(dev, "0.2.0")).toBe(false);
    expect(versionSatisfies(dev, dev)).toBe(true);
    // a dev build of a version being prepared (no tag yet) counts as that version
    expect(versionSatisfies("0.3.0-dev.4.gccccccc", "^0.3.0")).toBe(true);
    expect(versionSatisfies("0.3.0-dev.4.gccccccc", "^0.2.0")).toBe(false);
    // a release candidate is still below its release, as npm has it
    expect(versionSatisfies("0.3.0-rc.1", "^0.3.0")).toBe(false);
    // what a project a dev build creates is given: the release line, never the dev version
    expect(stackRangeFor(dev)).toBe("^0.2.0");
    expect(stackRangeFor("1.4.1-dev.2.gddddddd")).toBe("^1.4.0");
    expect(stackRangeFor("0.2.0")).toBe("^0.2.0");
    expect(stackRangeFor("0.3.0-rc.1")).toBe("^0.3.0-rc.1");
  });
});

describe("the user's Protoboard folder", () => {
  it("is ~/.protoboard, or PROTOBOARD_HOME", () => {
    expect(stackHome({}, "/home/ada")).toBe(join("/home/ada", ".protoboard"));
    expect(stackHome({ PROTOBOARD_HOME: join(TMP, "elsewhere") }, "/home/ada")).toBe(join(TMP, "elsewhere"));
  });

  it("lists complete copies, newest first, and picks the one a project's range allows", () => {
    const home = join(TMP, "home-list");
    fakeStack(home, "0.1.3");
    fakeStack(home, "0.2.0", "registry");
    fakeStack(home, "0.1.10");
    // half a copy (no marker) is not one
    mkdirSync(join(home, "stack", "0.3.0", "node_modules"), { recursive: true });
    const stacks = listStacks(home);
    expect(stacks.map((s) => s.marker.version)).toEqual(["0.2.0", "0.1.10", "0.1.3"]);
    expect(stackFor(project("pick-a", "^0.1.3"), stacks)?.marker.version).toBe("0.1.10");
    expect(stackFor(project("pick-b", "^0.2.0"), stacks)?.marker.version).toBe("0.2.0");
    expect(stackFor(project("pick-c", "^0.4.0"), stacks)).toBeUndefined();
  });

  it("a dev build's copy has its own folder beside the release's, and a project pinned ^0.2.0 links to it (PB-1062)", () => {
    const home = join(TMP, "home-dev");
    const release = fakeStack(home, "0.2.0", "vsix");
    const dev = fakeStack(home, "0.2.1-dev.7.g1a2b3c4", "vsix");
    expect(dev).not.toBe(release);
    expect(listStacks(home).map((s) => s.marker.version)).toEqual(["0.2.1-dev.7.g1a2b3c4", "0.2.0"]);
    const root = project("pinned-dev", "^0.2.0");
    // the dev build's CLI prefers its own copy, which fits
    const choice = chooseStack(root, { home, version: "0.2.1-dev.7.g1a2b3c4" });
    expect(choice.stack?.dir).toBe(dev);
    expect(choice.rejected).toEqual([]);
    const r = linkProject(root, choice.stack!);
    expect(r).toMatchObject({ version: "0.2.1-dev.7.g1a2b3c4", range: "^0.2.0", satisfied: true });
    expect(realpathSync(join(root, "node_modules", "@protoboardai", "cli"))).toBe(realpathSync(join(dev, "node_modules", "@protoboardai", "cli")));
    // the release CLI still takes the release's copy
    expect(chooseStack(project("pinned-release", "^0.2.0"), { home, version: "0.2.0" }).stack?.dir).toBe(release);
    // a project on another line is not served by the dev build
    expect(chooseStack(project("pinned-old", "^0.1.3"), { home, version: "0.2.1-dev.7.g1a2b3c4" }).stack).toBeUndefined();
  });

  it("knows when the code runs from a copy, and when it does not", () => {
    const home = join(TMP, "home-carried");
    const dir = fakeStack(home, "0.1.3");
    mkdirSync(join(dir, "node_modules/@protoboardai/core/src"), { recursive: true });
    const file = join(dir, "node_modules/@protoboardai/core/src/stack.ts");
    writeFileSync(file, "");
    expect(carriedStack(file)?.dir).toBe(dir);
    // this repository's own core is not a copy
    expect(carriedStack()).toBeUndefined();
  });
});

describe("linking a project", () => {
  const home = join(TMP, "home-link");
  const dir = fakeStack(home, "0.1.3");
  const stack = listStacks(home)[0];

  it("links the stack packages package.json names, writes the project's command, and records it", () => {
    const root = project("fresh");
    expect(needsLink(root)).toBe(true);
    const r = linkProject(root, stack, { now: "2026-10-07T00:00:00.000Z" });
    expect(r.linked).toEqual(["@deltarobotics/uhd", "@protoboardai/cli", "@protoboardai/core", "@protoboardai/ext-hardware"]);
    expect(r.notProvided).toEqual(["typescript"]);
    expect(r).toMatchObject({ version: "0.1.3", range: "^0.1.3", satisfied: true, installed: [], notInStack: [] });
    expect(lstatSync(join(root, "node_modules/@protoboardai/core")).isSymbolicLink()).toBe(true);
    // Node resolves a linked package where it really is: inside the copy, with the copy's own dependencies
    expect(realpathSync(join(root, "node_modules/@deltarobotics/uhd"))).toBe(join(dir, "node_modules/@deltarobotics/uhd"));
    expect(packageState(root, "@protoboardai/core")).toEqual({ state: "linked", target: join(dir, "node_modules/@protoboardai/core") });
    expect(readLinkRecord(root)).toEqual({ schema: "protoboard.stack-link/v1", stack: dir, version: "0.1.3", linked: r.linked, at: "2026-10-07T00:00:00.000Z" });
    expect(needsLink(root)).toBe(false);
    if (process.platform !== "win32") {
      const run = spawnSync(join(root, "node_modules/.bin/protoboard"), ["check", "--format", "json"], { encoding: "utf8", cwd: root });
      expect(run.stdout.trim()).toBe("cli 0.1.3 check --format json");
    }
  });

  it("takes back the links one call made, and only those (a command that linked a project and was then refused)", () => {
    const root = project("taken-back");
    const r = linkProject(root, stack);
    expect(r.made).toEqual(r.linked);
    unlinkProject(r);
    // the project is as it was: no node_modules at all
    expect(existsSync(join(root, "node_modules"))).toBe(false);
    expect(needsLink(root)).toBe(true);
    // links that were there before the call stay, with the project's command and the record
    const first = linkProject(root, stack);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "taken-back", dependencies: { "@deltarobotics/uhd": "0.2.1", "@protoboardai/core": "^0.1.3", "@protoboardai/ext-hardware": "^0.1.3" }, devDependencies: { "@protoboardai/cli": "^0.1.3" } }));
    rmSync(join(root, "node_modules/@protoboardai/core"));
    const second = linkProject(root, stack);
    expect(second.made).toEqual(["@protoboardai/core"]);
    expect(second.linked).toEqual(first.linked);
    unlinkProject(second);
    expect(lstatSync(join(root, "node_modules/@protoboardai/core")).isSymbolicLink()).toBe(true);
    expect(readLinkRecord(root)?.version).toBe("0.1.3");
    // and what npm put beside the links is never removed
    const mixed = project("taken-back-mixed");
    mkdirSync(join(mixed, "node_modules/typescript"), { recursive: true });
    writeFileSync(join(mixed, "node_modules/typescript/package.json"), JSON.stringify({ name: "typescript", version: "7.0.2" }));
    unlinkProject(linkProject(mixed, stack));
    expect(existsSync(join(mixed, "node_modules/typescript/package.json"))).toBe(true);
    expect(existsSync(join(mixed, "node_modules/@protoboardai"))).toBe(false);
    expect(existsSync(join(mixed, "node_modules/.bin"))).toBe(false);
  });

  it("links the type packages the copy carries (a tsconfig's `types: [\"node\"]`), listed in package.json or not", () => {
    const typed = fakeStack(join(TMP, "home-types"), "0.1.3", "vsix", ["@protoboardai/core", "@protoboardai/cli", "@protoboardai/ext-hardware", "@deltarobotics/uhd", "@types/node"]);
    const withTypes = listStacks(join(TMP, "home-types"))[0];
    // the examples: package.json does not list @types/node, their tsconfig names it
    const root = project("types-unlisted");
    const r = linkProject(root, withTypes);
    expect(r.linked).toContain("@types/node");
    expect(realpathSync(join(root, "node_modules/@types/node"))).toBe(join(typed, "node_modules/@types/node"));
    expect(r.notProvided).toEqual(["typescript"]);
    // a template's project lists it: linked, not "not provided"
    const listed = project("types-listed", "^0.1.3", { "@types/node": "^26.1.2" });
    const l = linkProject(listed, withTypes);
    expect(l.linked).toContain("@types/node");
    expect(l.notProvided).toEqual(["typescript"]);
    // one npm installed stays as it is
    const npm = project("types-npm");
    mkdirSync(join(npm, "node_modules/@types/node"), { recursive: true });
    writeFileSync(join(npm, "node_modules/@types/node/package.json"), JSON.stringify({ name: "@types/node", version: "26.1.2" }));
    expect(linkProject(npm, withTypes).installed).toContain("@types/node");
    // a copy without it links what it has, as before
    expect(linkProject(project("types-none"), stack).linked).not.toContain("@types/node");
  });

  it("never replaces what npm installed", () => {
    const root = project("installed");
    mkdirSync(join(root, "node_modules/@protoboardai/core"), { recursive: true });
    writeFileSync(join(root, "node_modules/@protoboardai/core/package.json"), JSON.stringify({ name: "@protoboardai/core", version: "0.1.2" }));
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(root, "node_modules/.bin/protoboard"), "#!/bin/sh\necho npm's own\n");
    const r = linkProject(root, stack, { force: true });
    expect(r.installed).toEqual(["@protoboardai/core"]);
    expect(lstatSync(join(root, "node_modules/@protoboardai/core")).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "node_modules/@protoboardai/core/package.json"), "utf8")).version).toBe("0.1.2");
    // a command that is not one of ours stays
    expect(readFileSync(join(root, "node_modules/.bin/protoboard"), "utf8")).toContain("npm's own");
  });

  it("repairs links to a copy that is gone, and re-points to a newer copy only when asked", () => {
    const root = project("moved");
    mkdirSync(join(root, "node_modules/@protoboardai"), { recursive: true });
    symlinkSync(join(TMP, "gone", "core"), join(root, "node_modules/@protoboardai/core"), "dir");
    expect(packageState(root, "@protoboardai/core").state).toBe("broken-link");
    expect(needsLink(root)).toBe(true);
    linkProject(root, stack);
    expect(packageState(root, "@protoboardai/core").state).toBe("linked");
    fakeStack(join(TMP, "home-newer"), "0.1.4");
    const newer = listStacks(join(TMP, "home-newer"))[0];
    expect(linkProject(root, newer).version).toBe("0.1.4");
    // without --force the project stays on the copy it is linked to
    expect(realpathSync(join(root, "node_modules/@protoboardai/core"))).toContain(join("stack", "0.1.3"));
    linkProject(root, newer, { force: true });
    expect(realpathSync(join(root, "node_modules/@protoboardai/core"))).toContain(join("stack", "0.1.4"));
    expect(readLinkRecord(root)?.version).toBe("0.1.4");
  });

  it("says when the copy does not satisfy the project's range, and what it does not have", () => {
    const root = project("pinned", "^0.2.0", { "@protoboardai/ext-drone": "^0.2.0" });
    const r = linkProject(root, stack);
    expect(r).toMatchObject({ range: "^0.2.0", satisfied: false, notInStack: ["@protoboardai/ext-drone"] });
  });

  it("a folder with no package.json needs nothing", () => {
    mkdirSync(join(TMP, "empty"), { recursive: true });
    expect(needsLink(join(TMP, "empty"))).toBe(false);
    expect(existsSync(join(TMP, "empty", "node_modules", LINK_RECORD))).toBe(false);
  });
});

describe("the command scripts", () => {
  it("prefer Node.js 22 or later, fall back on the runtime named in <home>/runtime, and say what to install", () => {
    const sh = shellCommand({ kind: "project", cli: "/s t/cli's.mjs", home: "/h" });
    expect(sh.split("\n")[1]).toContain(SHIM_MARK);
    expect(sh).toContain(`CLI='/s t/cli'\\''s.mjs'`);
    expect(sh).toContain('ELECTRON_RUN_AS_NODE=1 exec "$RT" "$CLI" "$@"');
    expect(sh).toContain("install Node.js 22 or later");
    expect(sh).not.toContain("node_modules/.bin/protoboard");
    // the terminal's command looks for the project's own first
    expect(shellCommand({ kind: "home", cli: "/c.mjs", home: "/h" })).toContain('exec "$d/node_modules/.bin/protoboard" "$@"');
    const cmd = windowsCommand({ kind: "home", cli: "C:\\s\\cli.mjs", home: "C:\\Users\\ada\\.protoboard" });
    expect(cmd).toContain(`rem ${SHIM_MARK}`);
    expect(cmd).toContain('set /p RT=<"%PBHOME%\\runtime"');
    expect(cmd).toContain("\r\n");
  });

  it.skipIf(process.platform === "win32")("with no Node on PATH, run the CLI with the fallback runtime as Node", () => {
    const home = join(TMP, "home-rt");
    mkdirSync(join(home, "bin"), { recursive: true });
    // the stand-in for VS Code's executable: a script that proves ELECTRON_RUN_AS_NODE was set and runs the real node
    const rt = join(home, "code");
    writeFileSync(rt, `#!/bin/sh\n[ "$ELECTRON_RUN_AS_NODE" = 1 ] || exit 9\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, "runtime"), `${rt}\n`);
    const cli = join(home, "cli.mjs");
    writeFileSync(cli, 'console.log("ran " + process.argv.slice(2).join(","));');
    const [file] = writeCommands(join(home, "bin"), { kind: "home", cli, home });
    const empty = join(home, "nopath");
    mkdirSync(empty);
    const r = spawnSync("/bin/sh", [file, "a", "b c"], { encoding: "utf8", env: { PATH: empty }, cwd: home });
    expect(r.stdout.trim()).toBe("ran a,b c");
    // no runtime either: one line that says what to install
    rmSync(join(home, "runtime"));
    const none = spawnSync("/bin/sh", [file], { encoding: "utf8", env: { PATH: empty }, cwd: home });
    expect(none.status).toBe(127);
    expect(none.stderr).toContain("install Node.js 22 or later");
  });
});

describe("the terminal's command and a project's own (PB-1048)", () => {
  it.skipIf(process.platform === "win32")("runs the project's own command only from the project's node_modules, never one above the project or outside any project", () => {
    const home = join(TMP, "home-walk");
    mkdirSync(join(home, "bin"), { recursive: true });
    const cli = join(home, "cli.mjs");
    writeFileSync(cli, 'console.log("stack cli");');
    const [file] = writeCommands(join(home, "bin"), { kind: "home", cli, home });
    const planted = (dir: string, says: string) => {
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(dir, "node_modules", ".bin", "protoboard"), `#!/bin/sh\necho ${says}\n`, { mode: 0o755 });
    };
    // a folder above the project (a downloads folder, a shared parent) holds a planted command
    const above = join(TMP, "walk-above");
    planted(above, "planted above");
    const project = join(above, "proj");
    mkdirSync(join(project, "src", "deep"), { recursive: true });
    writeFileSync(join(project, "protoboard.config.ts"), "export default {};\n");
    const run = (cwd: string) => spawnSync("/bin/sh", [file], { encoding: "utf8", cwd, env: { PATH: `${join(process.execPath, "..")}:/usr/bin:/bin` } }).stdout.trim();
    // inside the project with no command of its own: the stack's CLI, not the one above
    expect(run(join(project, "src", "deep"))).toBe("stack cli");
    // outside any project: the stack's CLI, whatever node_modules is above
    mkdirSync(join(above, "elsewhere"), { recursive: true });
    expect(run(join(above, "elsewhere"))).toBe("stack cli");
    // the project's own command, from anywhere inside it
    planted(project, "project own");
    expect(run(join(project, "src", "deep"))).toBe("project own");
    expect(run(project)).toBe("project own");
  });

  it("the Windows command stops at the project root too", () => {
    const cmd = windowsCommand({ kind: "home", cli: "C:\\s\\cli.mjs", home: "C:\\h" });
    const lines = cmd.split("\r\n");
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at('if exist "%D%\\protoboard.config.ts" goto project')).toBeGreaterThan(0);
    expect(at(":project")).toBeGreaterThan(at("goto run"));
    expect(at('node_modules\\.bin\\protoboard.cmd')).toBeGreaterThan(at(":project"));
    expect(at(":run")).toBeGreaterThan(at('node_modules\\.bin\\protoboard.cmd'));
  });
});

describe("a copy from a registry", () => {
  it("installs the version the project pins with npm, marks it, and says what failed", () => {
    const home = join(TMP, "home-install");
    const root = project("from-registry", "^0.2.0");
    writeFileSync(join(root, ".npmrc"), "@protoboardai:registry=https://registry.example/\n");
    const calls: { args: string[]; cwd: string }[] = [];
    const stack = installStack(root, {
      home,
      registry: "https://registry.example/",
      now: "2026-10-07T00:00:00.000Z",
      run: (args, cwd) => {
        calls.push({ args, cwd });
        if (args[0] === "view") return { status: 0, stdout: JSON.stringify(["0.2.0", "0.2.1"]), stderr: "" };
        // what npm install would leave
        for (const n of ["@protoboardai/core", "@protoboardai/cli"]) {
          mkdirSync(join(cwd, "node_modules", n, "bin"), { recursive: true });
          writeFileSync(join(cwd, "node_modules", n, "package.json"), JSON.stringify({ name: n, version: "0.2.1" }));
        }
        writeFileSync(stackCli(cwd), "");
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    expect(stack.dir).toBe(stackDir(home, "0.2.1"));
    expect(stack.marker).toMatchObject({ version: "0.2.1", source: "registry", registry: "https://registry.example/", packages: { "@protoboardai/core": "0.2.1", "@protoboardai/cli": "0.2.1" } });
    expect(calls[0]).toMatchObject({ cwd: root, args: ["view", "@protoboardai/cli@^0.2.0", "version", "--json", "--@protoboardai:registry=https://registry.example/", "--@deltarobotics:registry=https://registry.example/"] });
    expect(calls[1].cwd).toBe(stack.dir);
    expect(calls[1].args.slice(0, 2)).toEqual(["install", "--omit=dev"]);
    // the project's npm settings travel with the copy
    expect(readFileSync(join(stack.dir, ".npmrc"), "utf8")).toContain("registry.example");
    expect(JSON.parse(readFileSync(join(stack.dir, "package.json"), "utf8")).dependencies["@protoboardai/cli"]).toBe("0.2.1");

    expect(() => installStack(root, { home, run: () => ({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT" }) }) })).toThrow(/npm was not found.*needs neither/);
    // an expired registry pass is said as that, with what to do and the way that needs no npm (item 26)
    expect(() => installStack(root, { home, run: () => ({ status: 1, stdout: "", stderr: "npm error code E401\nnpm error Unable to authenticate" }) })).toThrow(/npm view @protoboardai\/cli@\^0\.2\.0 was refused by the registry\. npm got 401.*without npm/);
    expect(() => installStack(root, { home, run: () => ({ status: 1, stdout: "", stderr: "npm error code E404\nnpm error 404 Not Found" }) })).toThrow(/failed \(npm exit 1\).*E404/);
  });
});

describe("npm refused by the registry (first builds review, item 26)", () => {
  it("names the one-hour pass for the beta registry, the command that renews it, and the set-up without npm", () => {
    const m = npmAuthProblem("npm error code E403\nnpm error 403 403 Forbidden - GET https://us-central1-npm.pkg.dev/protoboard-cloud/protoboard-npm/@protoboardai%2fcli");
    expect(m).toContain("npm got 403 from us-central1-npm.pkg.dev: the registry pass ran out (it lasts one hour)");
    expect(m).toContain("npx google-artifactregistry-auth");
    expect(m).toContain("without npm and without a registry");
    expect(m).toContain("Initialize");
    expect(npmAuthProblem("npm ERR! code E401\nnpm ERR! Unable to authenticate, need: Basic realm=\"us-central1-npm.pkg.dev\"")).toContain("npm got 401 from us-central1-npm.pkg.dev");
  });

  it("another registry: the same cause without the beta's command", () => {
    const m = npmAuthProblem("npm error code E401\nnpm error 401 Unauthorized - GET https://registry.example/@protoboardai%2fcli");
    expect(m).toContain("npm got 401 from the registry");
    expect(m).not.toContain("google-artifactregistry-auth");
  });

  it("is silent about anything else", () => {
    for (const other of ["npm error code E404", "npm error code ENOTFOUND registry.example", "added 12 packages in 4s", "ERESOLVE could not resolve", ""]) expect(npmAuthProblem(other), other).toBeUndefined();
  });
});

describe("the global stack (first builds review, D3)", () => {
  it("is a copy in the user's folder that the project's range accepts and that has its packages; the running CLI's version first", () => {
    const home = join(TMP, "home-global");
    fakeStack(home, "0.1.3");
    fakeStack(home, "0.1.4");
    fakeStack(home, "0.2.0");
    const root = project("global", "^0.1.3");
    // not run from a copy (this test file is in the repository): the folder is looked at
    expect(globalStack(root, { home })?.marker.version).toBe("0.1.4");
    expect(globalStack(root, { home, version: "0.1.3" })?.marker.version).toBe("0.1.3");
    // a version outside the project's range is not taken, whatever runs
    expect(globalStack(root, { home, version: "0.2.0" })?.marker.version).toBe("0.1.4");
    expect(globalStack(root, { home: join(TMP, "home-none") })).toBeUndefined();
  });

  it("a copy that lacks a package the project names is not the project's stack", () => {
    const home = join(TMP, "home-partial");
    const dir = fakeStack(home, "0.1.4", "registry", ["@protoboardai/core", "@protoboardai/cli", "@deltarobotics/uhd"]);
    const root = project("global-partial", "^0.1.3");
    expect(missingFromStack(root, { dir, marker: JSON.parse(readFileSync(join(dir, STACK_MARKER), "utf8")) })).toEqual(["@protoboardai/ext-hardware"]);
    expect(globalStack(root, { home })).toBeUndefined();
  });

  it("the code running from a copy uses that copy", () => {
    const home = join(TMP, "home-own");
    const dir = fakeStack(home, "0.1.4");
    fakeStack(home, "0.1.5");
    const from = join(dir, "node_modules/@protoboardai/core/src/stack.ts");
    mkdirSync(join(from, ".."), { recursive: true });
    writeFileSync(from, "");
    expect(globalStack(project("global-own", "^0.1.3"), { home, from })?.dir).toBe(dir);
  });

  it("a carried copy that the project's range refuses is not taken: another that fits is, or none (PB-1037)", () => {
    const home = join(TMP, "home-carried-range");
    const dir = fakeStack(home, "0.1.5");
    const from = join(dir, "node_modules/@protoboardai/core/src/stack.ts");
    mkdirSync(join(from, ".."), { recursive: true });
    writeFileSync(from, "");
    // the extension's 0.1.5 run in a project that asks for ^0.2.0: no copy fits, and the reason is said
    const none = chooseStack(project("carried-range", "^0.2.0"), { home, from, version: "0.1.5" });
    expect(none.stack).toBeUndefined();
    expect(none.rejected).toEqual([{ version: "0.1.5", dir, reason: "package.json asks for ^0.2.0" }]);
    // with a 0.2.0 copy there, that one, and the line says the CLI's own was not taken
    fakeStack(home, "0.2.0");
    const other = chooseStack(project("carried-range", "^0.2.0"), { home, from, version: "0.1.5" });
    expect(other.stack?.marker.version).toBe("0.2.0");
    expect(other.fallback).toBe("the stack 0.1.5 (this CLI's) does not fit this project: package.json asks for ^0.2.0");
  });

  it("a carried copy without a package the project names is not taken either", () => {
    const home = join(TMP, "home-carried-missing");
    const dir = fakeStack(home, "0.1.5", "vsix", ["@protoboardai/core", "@protoboardai/cli", "@deltarobotics/uhd"]);
    const from = join(dir, "node_modules/@protoboardai/core/src/stack.ts");
    mkdirSync(join(from, ".."), { recursive: true });
    writeFileSync(from, "");
    const choice = chooseStack(project("carried-missing", "^0.1.3"), { home, from });
    expect(choice.stack).toBeUndefined();
    expect(choice.rejected[0]?.reason).toBe("it does not have @protoboardai/ext-hardware");
  });

  it("prefers the CLI's own version and says when it falls back (PB-1024)", () => {
    const home = join(TMP, "home-prefer");
    fakeStack(home, "0.1.6");
    fakeStack(home, "0.1.7");
    const root = project("prefer", "^0.1.3");
    expect(chooseStack(root, { home, version: "0.1.6" })).toMatchObject({ stack: { marker: { version: "0.1.6" } }, preferred: "0.1.6" });
    expect(chooseStack(root, { home, version: "0.1.6" }).fallback).toBeUndefined();
    // the 0.1.8 CLI with no 0.1.8 copy: the newest that fits, said
    const fell = chooseStack(root, { home, version: "0.1.8" });
    expect(fell.stack?.marker.version).toBe("0.1.7");
    expect(fell.fallback).toBe(`the stack 0.1.8 (this CLI's) is not in ${join(home, "stack")}`);
  });

  it("says when the CLI and the copy the project links to are different versions (PB-1024)", () => {
    const home = join(TMP, "home-mismatch");
    const dir = fakeStack(home, "0.1.6");
    const root = project("mismatch", "^0.1.3");
    expect(stackVersionMismatch(root, "0.1.7")).toBeUndefined(); // not linked
    linkProject(root, { dir, marker: JSON.parse(readFileSync(join(dir, STACK_MARKER), "utf8")) }, { home });
    expect(stackVersionMismatch(root, "0.1.6")).toBeUndefined();
    const line = stackVersionMismatch(root, "0.1.7");
    expect(line).toContain("this CLI is 0.1.7, and the project's packages are links to the Protoboard stack 0.1.6");
    expect(line).toContain("protoboard stack link --force");
  });
});
