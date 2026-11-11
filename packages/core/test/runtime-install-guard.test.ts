/**
 * Wave 4 gate (PB-1168, W4-A's handoff): a managed runtime install runs no
 * package install script (`npm install --ignore-scripts`), and a pin whose
 * name is on the lookalike deny list is refused before anything is fetched;
 * `extensions add` refuses a deny-listed package name before writing.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { addExtension } from "../src/extensions-add.js";
import { deniedPins } from "../src/tools.js";
import { installRuntimes, loadProject, type Exec } from "../src/index.js";

// the fake extension is compatible with this stack whatever its version (a ^0.2.0 pin broke at the 0.3.0 release)
const CORE_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-install-guard");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function project(name: string, packages: string[]) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, extensions: ["ext-board"] });\n`);
  write("src/sys.uhd.ts", `export const SYS = { id: "sys", interfaces: [] };\n`);
  write("package.json", JSON.stringify({ name, type: "module", dependencies: { "@protoboardai/core": `^${CORE_VERSION}` } }));
  const tool = { id: "fake-node", purpose: "node packages from the project runtime", probe: ["fake-node", "--version"], runtime: { id: "circuit", kind: "node", packages, env: "FAKE_NODE_MODULES" } };
  write("node_modules/ext-board/package.json", JSON.stringify({ name: "ext-board", version: "0.1.0", type: "module" }));
  write("node_modules/ext-board/protoboard-extension.json", JSON.stringify({ schema: "protoboard.extension/v0", id: "ext-board", version: "0.1.0", compatibility: { protoboard: `^${CORE_VERSION}` }, tools: [tool] }));
  return dir;
}

describe("managed runtime installs (wave 4 gate)", () => {
  it("runs npm install with --ignore-scripts", async () => {
    const dir = project("scripts", ["circuit-json@0.0.510"]);
    const p = await loadProject(dir, { checks: false });
    const calls: string[][] = [];
    const exec: Exec = async (_command, args) => {
      calls.push(args);
      return args[0] === "--version" ? "11.11.0\n" : "";
    };
    await installRuntimes(p.root, p.extensions, ["circuit"], { exec });
    const install = calls.find((a) => a[0] === "install");
    expect(install).toBeDefined();
    expect(install).toContain("--ignore-scripts");
  });

  it("refuses a deny-listed pin before anything runs", async () => {
    const dir = project("denied", ["circuit-json@0.0.510", "cbim-three-mesh-bvh@1.0.0"]);
    const p = await loadProject(dir, { checks: false });
    const [r] = await installRuntimes(p.root, p.extensions, ["circuit"], { exec: () => Promise.reject(new Error("must not run")) });
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/^refused before installing: cbim-three-mesh-bvh@1\.0\.0 is on the lookalike deny list \(imitates three-mesh-bvh\)/);
    expect(deniedPins("node", ["three-mesh-bvh@0.9.1", "circuit-json@0.0.510"])).toEqual([]);
  });

  it("extensions add refuses a deny-listed package name and writes nothing", async () => {
    const dir = project("ext-add", ["circuit-json@0.0.510"]);
    const before = readFileSync(join(dir, "package.json"), "utf8");
    await expect(addExtension(dir, "@sunbox/occt-import-js", { fallbackRange: "^0.2.0" })).rejects.toThrow(/lookalike deny list \(imitates occt-import-js\); nothing was added/);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
  });
});
