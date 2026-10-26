/**
 * The npm scope rename (PB-941): the packages moved from `@protoboard/…` to
 * `@protoboardai/…` before 0.1.1. A project that still names the old packages
 * gets one diagnostic that says what to change, and is never told to
 * `npm install` a name that on npmjs belongs to someone else.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { SCOPE_RENAMED, formerScopeDependencies, loadProject, renamedPackage } from "../src/index.js";

const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-scope");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const project = (name: string, files: Record<string, string>) => {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};

const OLD = "@protoboard";
const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";\nexport const SYS: ModuleDef = { id: "sys", name: "Sys", interfaces: [] };\n`;
const config = (core: string, extensions: string[]) =>
  `import { defineConfig } from "${core}";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, extensions: ${JSON.stringify(extensions)} });\n`;
const manifest = (deps: Record<string, string>, dev: Record<string, string> = {}) => JSON.stringify({ name: "old-project", private: true, type: "module", dependencies: deps, devDependencies: dev });

describe("a project that names the former npm scope", () => {
  it("renames a package name under the former scope, and no other", () => {
    expect(renamedPackage(`${OLD}/ext-hardware`)).toBe("@protoboardai/ext-hardware");
    expect(renamedPackage("@protoboardai/core")).toBeUndefined();
    expect(renamedPackage("@protoboard-test/ext-demo")).toBeUndefined();
    expect(renamedPackage("@deltarobotics/uhd")).toBeUndefined();
  });

  it("gets one error naming package.json, the extensions list and the capability configs, and no advice to install the old names", async () => {
    const dir = project("half-migrated", {
      "package.json": manifest({ "@deltarobotics/uhd": "0.2.1", [`${OLD}/core`]: "^0.1.0", [`${OLD}/ext-hardware`]: "^0.1.0" }, { [`${OLD}/cli`]: "^0.1.0" }),
      // the config's own import was changed, the names it lists were not
      "protoboard.config.ts": config("@protoboardai/core", [`${OLD}/ext-hardware`]),
      "src/sys.uhd.ts": SYS,
      "src/cad.config.ts": `import { defineCapabilityConfig } from "@protoboardai/core";\nexport default defineCapabilityConfig({ provider: "${OLD}/ext-frame-cad", module: "sys" });\n`,
    });
    expect(formerScopeDependencies(dir)).toEqual([`${OLD}/cli`, `${OLD}/core`, `${OLD}/ext-hardware`]);
    const p = await loadProject(dir);
    const renamed = p.diagnostics.filter((d) => d.code === SCOPE_RENAMED);
    expect(renamed).toHaveLength(1);
    expect(renamed[0]).toMatchObject({ severity: "error", source: { file: "package.json" }, validator: "protoboard/loader" });
    expect(renamed[0].message).toBe(
      `package.json lists ${OLD}/cli, ${OLD}/core, ${OLD}/ext-hardware; protoboard.config.ts lists the extension ${OLD}/ext-hardware; src/cad.config.ts names the provider ${OLD}/ext-frame-cad: ` +
        `the Protoboard packages were renamed from ${OLD}/… to @protoboardai/… (stack 0.1.1). Replace \`${OLD}/\` with \`@protoboardai/\` in package.json, protoboard.config.ts, the capability configs (*.config.ts) and the project's imports, ` +
        `point \`@protoboardai:registry\` in .npmrc at the registry, then run \`npm install\`. Do not install ${OLD}/… packages: that name on npmjs is not Protoboard's`,
    );
    // the extension is not reported a second time, and nothing says "npm install @protoboard/…"
    expect(p.diagnostics.filter((d) => d.code === "PB_EXTENSION_NOT_INSTALLED")).toEqual([]);
    const provider = p.diagnostics.find((d) => d.code === "PB_PROVIDER_NOT_INSTALLED")!;
    expect(provider.message).toBe(`cad provider ${OLD}/ext-frame-cad (named by src/cad.config.ts) is not installed: it was renamed to @protoboardai/ext-frame-cad; name that in src/cad.config.ts (see PB_PACKAGE_SCOPE_RENAMED)`);
    expect(p.diagnostics.some((d) => d.message.includes(`npm install ${OLD}/`))).toBe(false);
    // the loader alone (no extensions) reports it too
    expect((await loadProject(dir, { extensions: false })).diagnostics.filter((d) => d.code === SCOPE_RENAMED)).toHaveLength(1);
  });

  it("says what to change when protoboard.config.ts itself imports the old core, instead of a bare module-not-found", async () => {
    const dir = project("not-migrated", {
      "package.json": manifest({ [`${OLD}/core`]: "^0.1.0" }),
      "protoboard.config.ts": config(`${OLD}/core`, []),
      "src/sys.uhd.ts": SYS,
    });
    await expect(loadProject(dir)).rejects.toThrow(/^protoboard\.config\.ts: Cannot find package '@protoboard\/core'.*renamed from @protoboard\/… to @protoboardai\/….*Replace `@protoboard\/` with `@protoboardai\/`/);
  });

  it("says nothing about a project on the new scope", async () => {
    const dir = project("migrated", {
      "package.json": manifest({ "@deltarobotics/uhd": "0.2.1", "@protoboardai/core": "^0.1.1" }),
      "protoboard.config.ts": config("@protoboardai/core", []),
      "src/sys.uhd.ts": SYS,
    });
    const p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.code === SCOPE_RENAMED)).toEqual([]);
  });
});
