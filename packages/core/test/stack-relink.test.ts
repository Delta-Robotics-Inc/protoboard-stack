/**
 * Re-pointing a linked project to another stack copy. On Windows the links are
 * junctions, which some Node releases' `fs.rmSync` refuses as directories
 * ("Path is a directory"), and which a recursive remove could follow into the
 * copy they lead to. The links must move, the old copy must stay whole, a real
 * folder is never removed, and a failure part way leaves the links as they were.
 *
 * Runs on every platform (the Windows CI job lists it): junctions on Windows,
 * directory symlinks elsewhere, as `linkProject` makes them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { STACK_MARKER, linkProject, listStacks, packageState, readLinkRecord, removeLink, stackCli, stackDir, unlinkProject, writeCommands, type StackMarker } from "../src/index.js";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-relink-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";
const PACKAGES = ["@deltarobotics/uhd", "@protoboardai/cli", "@protoboardai/core", "@protoboardai/ext-hardware"];

/** A stand-in stack copy: each package a folder with a package.json and one more file, the CLI entry, the marker. */
function fakeStack(home: string, version: string, extra: string[] = []) {
  const dir = stackDir(home, version);
  const names = [...PACKAGES, ...extra];
  for (const n of names) {
    mkdirSync(join(dir, "node_modules", n), { recursive: true });
    writeFileSync(join(dir, "node_modules", n, "package.json"), JSON.stringify({ name: n, version }));
    writeFileSync(join(dir, "node_modules", n, "index.js"), `// ${n} ${version}\n`);
  }
  mkdirSync(join(dir, "node_modules/@protoboardai/cli/bin"), { recursive: true });
  writeFileSync(stackCli(dir), `console.log("cli ${version}");\n`);
  const marker: StackMarker = { schema: "protoboard.stack/v1", version, source: "vsix", packages: Object.fromEntries(names.map((n) => [n, version])), installedAt: "2026-10-28T00:00:00.000Z" };
  writeFileSync(join(dir, STACK_MARKER), JSON.stringify(marker));
  return listStacks(home).find((s) => s.marker.version === version)!;
}

/** Every file under a folder, with its contents: to show a stack copy is untouched. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
      else out[`${rel}${e.name}`] = readFileSync(p, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

function project(name: string) {
  const root = join(TMP, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, dependencies: { "@deltarobotics/uhd": "0.3.0", "@protoboardai/core": "^0.2.0", "@protoboardai/ext-hardware": "^0.2.0" }, devDependencies: { "@protoboardai/cli": "^0.2.0" } }),
  );
  return root;
}

const home = join(TMP, "home");
const a = fakeStack(home, "0.2.0");
const b = fakeStack(home, "0.2.1");
const aFiles = snapshot(a.dir);
const at = (root: string, name: string) => join(root, "node_modules", ...name.split("/"));

describe("re-pointing a project's links to another stack copy", () => {
  it("moves every link from copy A to copy B and leaves copy A whole", () => {
    const root = project("relink");
    const first = linkProject(root, a);
    expect(first.made.sort()).toEqual(PACKAGES);
    for (const n of PACKAGES) {
      expect(lstatSync(at(root, n)).isSymbolicLink(), n).toBe(true);
      expect(realpathSync(at(root, n))).toBe(realpathSync(join(a.dir, "node_modules", ...n.split("/"))));
    }
    const second = linkProject(root, b, { force: true });
    expect(second.made.sort()).toEqual(PACKAGES);
    for (const n of PACKAGES) {
      expect(packageState(root, n).state, n).toBe("linked");
      expect(realpathSync(at(root, n))).toBe(realpathSync(join(b.dir, "node_modules", ...n.split("/"))));
    }
    expect(readLinkRecord(root)?.version).toBe("0.2.1");
    expect(snapshot(a.dir)).toEqual(aFiles);
  });

  it("moves links made by hand as junctions (Windows) or directory symlinks", () => {
    const root = project("by-hand");
    for (const n of PACKAGES) {
      mkdirSync(join(root, "node_modules", n.split("/")[0]!), { recursive: true });
      symlinkSync(join(a.dir, "node_modules", ...n.split("/")), at(root, n), LINK_TYPE);
    }
    linkProject(root, b, { force: true });
    for (const n of PACKAGES) expect(realpathSync(at(root, n))).toBe(realpathSync(join(b.dir, "node_modules", ...n.split("/"))));
    expect(snapshot(a.dir)).toEqual(aFiles);
  });

  it("a failure part way puts every link back on copy A", () => {
    const root = project("half");
    linkProject(root, a);
    // copy C carries @types/node, linked last; the project's node_modules/@types is a file, so that link cannot be made
    const c = fakeStack(join(TMP, "home-c"), "0.2.2", ["@types/node"]);
    writeFileSync(join(root, "node_modules", "@types"), "not a folder\n");
    expect(() => linkProject(root, c, { force: true })).toThrow();
    for (const n of PACKAGES) expect(realpathSync(at(root, n)), n).toBe(realpathSync(join(a.dir, "node_modules", ...n.split("/"))));
    expect(readLinkRecord(root)?.version).toBe("0.2.0");
    expect(snapshot(a.dir)).toEqual(aFiles);
  });

  it("a failure after the links moved (the command scripts cannot be written) puts the links and the record back", () => {
    const root = project("late");
    linkProject(root, a);
    const record = readFileSync(join(root, "node_modules", ".protoboard-stack.json"), "utf8");
    // node_modules/.bin is a file: every link moves, then the project's command cannot be written
    rmSync(join(root, "node_modules", ".bin"), { recursive: true, force: true });
    writeFileSync(join(root, "node_modules", ".bin"), "not a folder\n");
    expect(() => linkProject(root, b, { force: true })).toThrow();
    for (const n of PACKAGES) expect(realpathSync(at(root, n)), n).toBe(realpathSync(join(a.dir, "node_modules", ...n.split("/"))));
    expect(readFileSync(join(root, "node_modules", ".protoboard-stack.json"), "utf8")).toBe(record);
    expect(snapshot(a.dir)).toEqual(aFiles);
  });

  it("unlinkProject removes its links and nothing they lead to", () => {
    const root = project("unlink");
    unlinkProject(linkProject(root, a));
    for (const n of PACKAGES) expect(existsSync(at(root, n)), n).toBe(false);
    expect(snapshot(a.dir)).toEqual(aFiles);
  });
});

describe("removeLink", () => {
  it("removes a link and never its target", () => {
    const target = join(TMP, "target");
    mkdirSync(join(target, "inner"), { recursive: true });
    writeFileSync(join(target, "inner", "keep.txt"), "kept\n");
    const link = join(TMP, "a-link");
    symlinkSync(target, link, LINK_TYPE);
    removeLink(link);
    expect(() => lstatSync(link)).toThrow();
    expect(readFileSync(join(target, "inner", "keep.txt"), "utf8")).toBe("kept\n");
  });

  it("removes a link whose target is gone", () => {
    const target = join(TMP, "gone-target");
    mkdirSync(target);
    const link = join(TMP, "broken-link");
    symlinkSync(target, link, LINK_TYPE);
    rmSync(target, { recursive: true });
    removeLink(link);
    expect(() => lstatSync(link)).toThrow();
  });

  it("refuses a real folder and leaves it as it is, with its path in the message", () => {
    const real = join(TMP, "real-folder");
    mkdirSync(real);
    writeFileSync(join(real, "file.txt"), "mine\n");
    expect(() => removeLink(real)).toThrow(real);
    expect(readFileSync(join(real, "file.txt"), "utf8")).toBe("mine\n");
  });
});

describe("the terminal's command on Windows", () => {
  it.runIf(process.platform === "win32")("passes its arguments through, and runs `upgrade` with its own CLI in a project that has a command", () => {
    const pbhome = join(TMP, "home-cmd");
    mkdirSync(join(pbhome, "bin"), { recursive: true });
    const cli = join(pbhome, "cli.mjs");
    writeFileSync(cli, 'console.log("stack cli " + process.argv.slice(2).join(","));');
    const file = writeCommands(join(pbhome, "bin"), { kind: "home", cli, home: pbhome, platform: "win32" }).find((f) => f.endsWith("protoboard.cmd"))!;
    const proj = join(TMP, "cmd project");
    mkdirSync(join(proj, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(proj, "protoboard.config.ts"), "export default {};\n");
    writeFileSync(join(proj, "node_modules", ".bin", "protoboard.cmd"), "@echo project own %*\r\n");
    const run = (args: string) => spawnSync("cmd.exe", ["/d", "/s", "/c", `"\"${file}\" ${args}"`], { cwd: proj, encoding: "utf8", windowsVerbatimArguments: true }).stdout.trim();
    expect(run("check --json")).toBe("project own check --json");
    expect(run("upgrade --dry-run")).toBe("stack cli upgrade,--dry-run");
    expect(run("--dry-run upgrade")).toBe("stack cli --dry-run,upgrade");
    expect(run(`--cwd "${proj}" upgrade`)).toBe(`stack cli --cwd,${proj},upgrade`);
    expect(run("check upgrade")).toBe("project own check upgrade");
    expect(run("--json check upgrade")).toBe("project own --json check upgrade");
    expect(run("--format json upgrade")).toBe("stack cli --format,json,upgrade");
    expect(run("--library upgrade parts search")).toBe("project own --library upgrade parts search");
  });
});
