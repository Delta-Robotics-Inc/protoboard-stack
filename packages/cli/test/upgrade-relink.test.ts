/**
 * `protoboard upgrade` in a project whose packages are links to an older stack
 * copy (junctions on Windows): when the links cannot be moved to this stack's
 * copy, the project is left as it was. package.json keeps its old ranges and
 * the links still lead to the old copy, so the project is never half-upgraded.
 *
 * The copies are stand-ins in a scratch PROTOBOARD_HOME: the user's
 * ~/.protoboard is never read or written. Runs on every platform (the
 * Windows CI job lists it).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { STACK_MARKER, linkProject, listStacks, stackCli, stackDir, type StackMarker } from "@protoboardai/core";

const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const VERSION = (JSON.parse(readFileSync(join(REPO, "packages/cli/package.json"), "utf8")) as { version: string }).version;
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-upgrade-relink-")));
const HOME = join(TMP, "protoboard-home");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const PACKAGES = ["@deltarobotics/uhd", "@protoboardai/cli", "@protoboardai/core", "@protoboardai/ext-hardware"];

function fakeStack(version: string, extra: string[] = []) {
  const dir = stackDir(HOME, version);
  const names = [...PACKAGES, ...extra];
  for (const n of names) {
    mkdirSync(join(dir, "node_modules", n), { recursive: true });
    writeFileSync(join(dir, "node_modules", n, "package.json"), JSON.stringify({ name: n, version }));
  }
  mkdirSync(join(dir, "node_modules/@protoboardai/cli/bin"), { recursive: true });
  writeFileSync(stackCli(dir), `console.log("cli ${version}");\n`);
  const marker: StackMarker = { schema: "protoboard.stack/v1", version, source: "vsix", packages: Object.fromEntries(names.map((n) => [n, version])), installedAt: "2026-10-28T00:00:00.000Z" };
  writeFileSync(join(dir, STACK_MARKER), JSON.stringify(marker));
  return listStacks(HOME).find((s) => s.marker.version === version)!;
}

function pb(args: string[], cwd: string) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_") && k !== "npm_config_registry"));
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...clean, PROTOBOARD_HOME: HOME, PROTOBOARD_CONFIG_DIR: join(TMP, "config") }, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("protoboard upgrade when the links cannot be moved", () => {
  it("leaves package.json and the links as they were, and says why", () => {
    const old = fakeStack("0.1.7");
    // this CLI's copy carries @types/node, which is linked last; a file at node_modules/@types makes that link fail
    fakeStack(VERSION, ["@types/node"]);
    const root = join(TMP, "project");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
    const pkg = JSON.stringify({ name: "project", dependencies: { "@deltarobotics/uhd": "0.2.1", "@protoboardai/core": "^0.1.7", "@protoboardai/ext-hardware": "^0.1.7" }, devDependencies: { "@protoboardai/cli": "^0.1.7" } }, null, 2) + "\n";
    writeFileSync(join(root, "package.json"), pkg);
    linkProject(root, old, { home: HOME });
    writeFileSync(join(root, "node_modules", "@types"), "not a folder\n");

    const r = pb(["upgrade"], root);
    expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stderr).toContain(`could not be linked to the stack ${VERSION}`);
    expect(r.stderr).toContain("package.json and the links are as they were");
    expect(r.stderr).not.toMatch(/Path is a directory/);
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(pkg);
    for (const n of PACKAGES) expect(realpathSync(join(root, "node_modules", ...n.split("/"))), n).toBe(realpathSync(join(old.dir, "node_modules", ...n.split("/"))));
  });

  it("moves the links when nothing is in the way", () => {
    const root = join(TMP, "project-ok");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "project-ok", dependencies: { "@deltarobotics/uhd": "0.2.1", "@protoboardai/core": "^0.1.7" }, devDependencies: { "@protoboardai/cli": "^0.1.7" } }, null, 2) + "\n");
    const old = listStacks(HOME).find((s) => s.marker.version === "0.1.7")!;
    linkProject(root, old, { home: HOME });
    pb(["upgrade"], root);
    const now = listStacks(HOME).find((s) => s.marker.version === VERSION)!;
    expect(realpathSync(join(root, "node_modules/@protoboardai/core"))).toBe(realpathSync(join(now.dir, "node_modules/@protoboardai/core")));
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies["@protoboardai/cli"]).not.toBe("^0.1.7");
    expect(realpathSync(join(old.dir, "node_modules/@protoboardai/core/package.json"))).toBeTruthy();
  });
});
