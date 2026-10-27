/**
 * Loading failures that used to surface far from their cause, as agents
 * building projects on the stack met them: a definition whose interfaces hold a builder's unspread array
 * crashed the checks with "Cannot read properties of undefined (reading
 * 'some')"; a project with no packages said only "Cannot find package"; a
 * plain project asked for a CAD runtime was not told which extension brings one.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadProject, malformedInterfaces, missingStackPackage } from "../src/index.js";
import { installRuntimes, RUNTIME_EXTENSIONS } from "../src/tools.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-load-guards");
const CLI = join(HERE, "../../cli/bin/protoboard.mjs");
const OUTSIDE = mkdtempSync(join(tmpdir(), "pb-load-guards-"));
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
});

function write(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

const CONFIG = `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`;

describe("a definition whose interfaces are not one object each", () => {
  it("is reported where it is written and left out, instead of crashing the checks", async () => {
    const dir = join(TMP, "nested");
    rmSync(dir, { recursive: true, force: true });
    write(dir, {
      "package.json": JSON.stringify({ name: "nested", type: "module" }),
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", interfaces: [], children: [{ id: "psu", moduleDefId: "psu" }] };\n`,
      // AcPower(...) returns two interfaces; written without the spread
      "src/psu.uhd.ts": `const AcPower = () => [{ id: "l", protocols: [] }, { id: "n", protocols: [] }];\nexport const PSU = {\n  id: "psu",\n  interfaces: [AcPower()],\n};\n`,
    });
    const p = await loadProject(dir);
    const bad = p.diagnostics.find((d) => d.code === "PB_DEFINITION_INVALID");
    expect(bad).toMatchObject({ severity: "error", entity: { kind: "definition", id: "psu" }, source: { file: "src/psu.uhd.ts", line: 3 } });
    expect(bad!.message).toMatch(/interfaces\[0\] is a list of 2, not one interface.*\.\.\.AcPower/);
    expect(p.definitions.has("psu")).toBe(false);
    expect(p.diagnostics.some((d) => d.code === "PB_UNRESOLVED_DEFINITION")).toBe(true);
  });

  it("names each bad entry", () => {
    const def = { id: "x", interfaces: [{ id: "ok" }, [{ id: "a" }], null, "vin"] } as never;
    expect(malformedInterfaces(def)).toEqual([
      expect.stringMatching(/^interfaces\[1\] is a list of 1/),
      "interfaces[2] is null, not an interface",
      "interfaces[3] is string, not an interface",
    ]);
    expect(malformedInterfaces({ id: "y", interfaces: [{ id: "a" }] } as never)).toEqual([]);
  });
});

describe("a project whose packages are not installed", () => {
  it("is told to link or install them, not shown a bare module error", async () => {
    // outside the workspace, so @protoboardai/core cannot be found from it
    // (run by the CLI as a user runs it: under vitest the workspace's packages resolve from anywhere)
    write(OUTSIDE, { "package.json": JSON.stringify({ name: "bare", type: "module" }), "protoboard.config.ts": CONFIG });
    const run = spawnSync(process.execPath, [CLI, "check"], { cwd: OUTSIDE, encoding: "utf8", env: { ...process.env, PROTOBOARD_CONFIG_DIR: join(OUTSIDE, ".config") } });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/protoboard\.config\.ts could not load: @protoboardai\/core is not installed in this project\. Run `protoboard stack link`.*`npm install`/);
    expect(run.stderr).not.toMatch(/sign/i);
  });

  it("recognises only the stack's own packages", () => {
    const err = (message: string) => Object.assign(new Error(message), { code: "ERR_MODULE_NOT_FOUND" });
    expect(missingStackPackage(err("Cannot find package '@protoboardai/core' imported from /p/protoboard.config.ts"))).toBe("@protoboardai/core");
    expect(missingStackPackage(err("Cannot find package '@deltarobotics/uhd' imported from /p/src/a.ts"))).toBe("@deltarobotics/uhd");
    expect(missingStackPackage(err("Cannot find package 'left-pad' imported from /p/protoboard.config.ts"))).toBeUndefined();
    expect(missingStackPackage(new Error("boom"))).toBeUndefined();
  });
});

describe("a runtime no configured extension declares", () => {
  it("names the extensions that bring it and the command that adds one", async () => {
    await expect(installRuntimes(OUTSIDE, [], ["cad"])).rejects.toThrow(/the cad runtime comes with ext-parts, .*`protoboard extensions add ext-parts`/);
    await expect(installRuntimes(OUTSIDE, [], ["nope"])).rejects.toThrow(/declares a nope runtime \(declared: none\); runtimes come from [^.]*$/);
  });

  it("the list matches the extensions the stack ships", () => {
    const packages = join(HERE, "../..");
    const declared: Record<string, string[]> = {};
    for (const name of readdirSync(packages).filter((n) => n.startsWith("ext-")).sort()) {
      let manifest: unknown;
      try {
        manifest = JSON.parse(readFileSync(join(packages, name, "protoboard-extension.json"), "utf8"));
      } catch {
        continue;
      }
      const ids = new Set<string>();
      JSON.stringify(manifest, (k, v) => {
        if (k === "runtime" && v && typeof v === "object" && typeof v.id === "string") ids.add(v.id);
        return v;
      });
      for (const id of ids) (declared[id] ??= []).push(name);
    }
    expect(Object.fromEntries(Object.entries(RUNTIME_EXTENSIONS).map(([k, v]) => [k, [...v].sort()]))).toEqual(declared);
  });
});
