/**
 * The inventory (PB-1168): the stack from the project's packages, the
 * dependency set (scan and hidden lockfile), the CAD runtime's packages, the
 * extension's version from its folder name, and no paths or project names.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { discoverExtensionVersion, INVENTORY_SCHEMA, queryablePackages, readHiddenLockfile, readInventory } from "../src/update/inventory.js";
import { makeProject } from "./update-fixtures.js";

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("protoboard inventory", () => {
  it("lists the stack, its dependency set, the CAD runtime and the interpreters, offline", () => {
    const root = makeProject();
    made.push(root);
    const home = mkdtempSync(join(tmpdir(), "pb-home-"));
    made.push(home);
    mkdirSync(join(home, ".vscode", "extensions", "deltarobotics.vscode-protoboard-0.2.1"), { recursive: true });
    mkdirSync(join(home, ".vscode", "extensions", "deltarobotics.vscode-protoboard-0.2.2-win32-x64"), { recursive: true });
    const inv = readInventory({ root, home, noExec: true, env: {} });
    expect(inv.schema).toBe(INVENTORY_SCHEMA);
    expect(inv.stack).toMatchObject({ version: "0.2.2", cli: "0.2.2", from: "project", dependencySource: "scan" });
    const byName = (n: string) => inv.components.find((c) => c.name === n);
    expect(byName("@protoboardai/ext-parts")).toMatchObject({ role: "extension", version: "0.2.2" });
    expect(byName("@deltarobotics/uhd")).toMatchObject({ role: "uhd", version: "0.3.0" });
    expect(byName("lodash")).toMatchObject({ role: "dependency", version: "4.17.20", registry: true });
    expect(byName("nested-dep")).toMatchObject({ version: "1.0.0" });
    expect(byName("my-private-thing")).toBeUndefined(); // private packages are never listed (or sent)
    expect(byName("build123d")).toMatchObject({ kind: "pypi", role: "runtime:cad", pinned: true });
    expect(byName("pillow")).toMatchObject({ kind: "pypi", version: "10.0.0" });
    expect(byName("pillow")?.pinned).toBeUndefined();
    expect(byName("cadquery-ocp")?.version).toBe("7.8.1.1.post1");
    expect(inv.python).toEqual([{ runtime: "cad", version: "3.12.4" }]);
    expect(inv.node).toBe(process.versions.node);
    expect(inv.vscodeExtension).toEqual({ version: "0.2.2", from: "editor-folder" });
    expect(inv.counts.runtimes).toBe(1);
    // nothing in it names the project or a path
    const text = JSON.stringify(inv);
    expect(text).not.toContain("secret-project-name");
    expect(text).not.toContain(root.replace(/\\/g, "\\\\"));
    expect(text).not.toContain("pb-update-");
  });

  it("prefers the version the extension host gives", () => {
    const root = makeProject({ runtime: false });
    made.push(root);
    const inv = readInventory({ root, extensionVersion: "0.2.5", noExec: true, home: root });
    expect(inv.vscodeExtension).toEqual({ version: "0.2.5", from: "host" });
    expect(inv.counts.runtimes).toBe(0);
  });

  it("queries only registry packages with exact versions", () => {
    const root = makeProject();
    made.push(root);
    const q = queryablePackages(readInventory({ root, noExec: true, home: root }));
    expect(q).toContainEqual({ ecosystem: "npm", name: "lodash", version: "4.17.20" });
    expect(q).toContainEqual({ ecosystem: "PyPI", name: "build123d", version: "0.13.0" });
    expect(q.some((x) => x.name === "node" || x.name === "python")).toBe(false);
  });

  it("reads npm's hidden lockfile, leaving out links and non-registry sources", () => {
    const nm = mkdtempSync(join(tmpdir(), "pb-nm-"));
    made.push(nm);
    writeFileSync(
      join(nm, ".package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" },
          "node_modules/@protoboardai/core": { resolved: "packages/core", link: true },
          "node_modules/b/node_modules/c": { version: "2.0.0", resolved: "https://registry.npmjs.org/c/-/c-2.0.0.tgz", dev: true },
          "node_modules/git-thing": { version: "0.0.1", resolved: "git+ssh://git@github.com/x/y.git" },
          "packages/core": { name: "@protoboardai/core", version: "0.2.2" },
        },
      }),
    );
    expect(readHiddenLockfile(nm)).toEqual([
      { name: "a", version: "1.0.0", registry: true },
      { name: "c", version: "2.0.0", registry: true, dev: true },
      { name: "git-thing", version: "0.0.1", registry: false },
    ]);
  });

  it("finds the newest extension folder and ignores other publishers", () => {
    const home = mkdtempSync(join(tmpdir(), "pb-home-"));
    made.push(home);
    for (const d of ["deltarobotics.vscode-protoboard-0.2.10", "deltarobotics.vscode-protoboard-0.2.9", "evil.vscode-protoboard-9.9.9"]) mkdirSync(join(home, ".cursor", "extensions", d), { recursive: true });
    expect(discoverExtensionVersion(home)).toBe("0.2.10");
    expect(discoverExtensionVersion(join(home, "none"))).toBeUndefined();
  });
});
