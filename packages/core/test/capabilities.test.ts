/**
 * Capability contracts (docs/specs/tool-integrations.md §2–§4, PB-819), with
 * two fake circuit providers and one fake cad provider (test/fixtures/providers;
 * they write minimal valid files, not real designs):
 *   - a project switches provider by changing only the module's config;
 *   - every provider passes the same contract (generate, export, extract, check);
 *   - missing and malformed standard outputs are diagnosed, with locations;
 *   - an uninstalled provider, or one without the capability, is reported clearly;
 *   - provider checks merge into `protoboard check`, attributed to the provider.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  FRAMEWORK_VERSION,
  checkDxf,
  checkExcellon,
  checkGerber,
  checkGlb,
  checkManifest,
  checkStep,
  checkStl,
  checkThreeMf,
  listCapabilities,
  loadProject,
  parseCsv,
  moduleDigest,
  operationRecordFile,
  runCapabilityOperation,
  runCapabilityStep,
  runProviderContract,
  type Project,
} from "../src/index.js";
import { excellon, gerber, glb, step, stlBox, zipStored } from "./fixtures/providers/_shared/fab.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(HERE, "fixtures/providers");
const CLI = join(HERE, "../../cli/bin/protoboard.mjs");
const TMP = join(HERE, ".tmp-cap");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const PROVIDERS = ["fake-circuit-a", "fake-circuit-b", "fake-cad", "fake-firmware"];

const PARTS = `const power = (id: string, role: string, pin: number) => ({ id, name: id.toUpperCase(), domain: "electrical", exposed: true, pin, protocols: [{ type: "power", roles: [role] }] });
export const MCU = { id: "fixture-mcu", name: "Fixture MCU", interfaces: [power("vdd", "sink", 1)] };
export const LDO = { id: "fixture-ldo", name: "Fixture LDO", interfaces: [power("vin", "sink", 1), power("vout", "source", 2)] };
export const USB = { id: "fixture-usb-c", name: "Fixture USB-C receptacle", interfaces: [power("vbus", "source", 1), { id: "usb", name: "USB", domain: "electrical", exposed: true, protocols: [{ type: "usb", roles: ["device"] }] }] };
`;
const BOARD = `export const MAINBOARD = {
  id: "watch-mainboard",
  name: "Watch mainboard",
  interfaces: [{ id: "mount", name: "Mount", domain: "mechanical", exposed: true, protocols: [{ type: "mechanical", roles: ["mount"] }] }],
  children: [
    { id: "u1", moduleDefId: "fixture-mcu" },
    { id: "u2", moduleDefId: "fixture-ldo" },
    { id: "j1", moduleDefId: "fixture-usb-c", name: "USB-C, charging" },
  ],
  exports: [{ id: "usb", from: { child: "j1", interfaceId: "usb" } }],
  links: [
    { id: "vbus", a: { child: "j1", interfaceId: "vbus" }, b: { child: "u2", interfaceId: "vin" } },
    { id: "v3v3", a: { child: "u2", interfaceId: "vout" }, b: { child: "u1", interfaceId: "vdd" } },
  ],
};
`;
const CASE = `const opening = (id: string) => ({ id, name: id, domain: "mechanical", exposed: true, protocols: [{ type: "mechanical", roles: ["mount"] }] });
export const CASE = { id: "watch-case", name: "Watch case", interfaces: [opening("board_mount"), opening("usb_opening")] };
`;
const SYSTEM = `export const WATCH = { id: "watch", name: "Watch", interfaces: [], children: [{ id: "board", moduleDefId: "watch-mainboard" }, { id: "case", moduleDefId: "watch-case" }] };
`;
const circuitConfig = (provider: string, constraints = `{ width_mm: 38, height_mm: 30, layers: 2 }`) =>
  `import { defineCapabilityConfig } from "@protoboardai/core";\n\nexport default defineCapabilityConfig({\n  provider: "${provider}",\n  constraints: ${constraints},\n});\n`;
const CAD_CONFIG = `import { defineCapabilityConfig } from "@protoboardai/core";\n\nexport default defineCapabilityConfig({\n  provider: "@fixtures/fake-cad",\n  process: "print",\n  constraints: { wall_mm: 1.6, inner_mm: [40, 34, 9] },\n});\n`;

let n = 0;
/** A small watch project: a custom board (circuit) and case (cad); providers come only from the module configs. */
function watch(overrides: Record<string, string | null> = {}, extensions: Record<string, { manifest: unknown; files?: Record<string, string> }> = {}) {
  const dir = join(TMP, `w${n++}`);
  rmSync(dir, { recursive: true, force: true });
  const files: Record<string, string | null> = {
    "package.json": JSON.stringify({ name: "watch", type: "module" }),
    "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/watch.uhd.ts", export: "WATCH" }, extensions: ${JSON.stringify(Object.keys(extensions))} });\n`,
    "src/parts.uhd.ts": PARTS,
    "src/watch.uhd.ts": SYSTEM,
    "src/boards/mainboard/mainboard.uhd.ts": BOARD,
    "src/boards/mainboard/circuit.config.ts": circuitConfig("@fixtures/fake-circuit-a"),
    "src/enclosures/case/case.uhd.ts": CASE,
    "src/enclosures/case/cad.config.ts": CAD_CONFIG,
    ...overrides,
  };
  for (const [rel, content] of Object.entries(files)) if (content !== null) write(dir, rel, content);
  mkdirSync(join(dir, "node_modules/@fixtures"), { recursive: true });
  for (const p of PROVIDERS) symlinkSync(join(FIXTURES, p), join(dir, "node_modules/@fixtures", p), "dir");
  for (const [pkg, e] of Object.entries(extensions)) {
    write(dir, `node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, version: "0.1.0", type: "module" }));
    write(dir, `node_modules/${pkg}/protoboard-extension.json`, JSON.stringify(e.manifest));
    for (const [rel, content] of Object.entries(e.files ?? {})) write(dir, `node_modules/${pkg}/${rel}`, content);
  }
  return dir;
}
function write(dir: string, rel: string, content: string | Buffer) {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

const codes = (p: Project, validator?: string) => p.diagnostics.filter((d) => !validator || d.validator === validator).map((d) => d.code);
const OUT = "src/boards/mainboard/out";
const manifest = (id: string, capabilities: unknown, extra: object = {}) => ({ schema: "protoboard.extension/v0", id, version: "0.1.0", compatibility: { protoboard: "^0.2.0" }, capabilities, ...extra });
const ops = { generate: "./x.ts#g", export: "./x.ts#e", extract: "./x.ts#x", check: "./x.ts#c" };

function pb(dir: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--format", "json", "--cwd", dir], { encoding: "utf8", timeout: 120000 });
  return { status: r.status, json: JSON.parse(r.stdout || "null"), stderr: r.stderr };
}

describe("capability manifests", () => {
  it("validates capability declarations; manifests without capabilities load as before", async () => {
    const dir = watch(
      {},
      {
        "ext-plain": { manifest: { schema: "protoboard.extension/v0", id: "ext-plain", version: "0.1.0", compatibility: { protoboard: "^0.2.0" } } },
        "ext-partial": { manifest: manifest("ext-partial", [{ id: "circuit", operations: { generate: "./x.ts#g", export: "./x.ts#e" } }]) },
        "ext-unknown": { manifest: manifest("ext-unknown", [{ id: "fabrication", operations: ops }]) },
        "ext-tool": { manifest: manifest("ext-tool", [{ id: "cad", operations: { ...ops, generate: { entry: "./x.ts#g", requires: ["kernel"] } } }]) },
        "ext-odd": { manifest: manifest("ext-odd", [{ id: "cad", native: "..", operations: { ...ops, check: null } }]) },
      },
    );
    const p = await loadProject(dir);
    const msgs = p.diagnostics.filter((d) => d.code === "PB_EXTENSION_MANIFEST_INVALID").map((d) => d.message);
    expect(msgs).toEqual([
      "ext-partial: capability circuit lacks operation(s) extract, check; a provider implements all of generate, export, extract, check",
      `ext-unknown: capability "fabrication" is not defined by protoboard ${FRAMEWORK_VERSION} (known: circuit, cad, firmware)`,
      "ext-tool: capability cad operation generate requires undeclared tool kernel",
      "ext-odd: capability cad operation check needs an entry like \"./ops/cad.ts#check\"",
      'ext-odd: capability cad: native must be a plain folder name other than "out"',
    ]);
    expect(p.extensions.map((e) => e.manifest.id)).toEqual(["ext-plain", "@fixtures/fake-circuit-a", "@fixtures/fake-cad"]);
  });
});

describe("provider selection by module config", async () => {
  const dir = watch();
  const p = await loadProject(dir);

  it("binds each module to the provider its config names, without listing providers in protoboard.config.ts", () => {
    expect(listCapabilities(p).modules).toEqual([
      { capability: "circuit", module: "watch-mainboard", instances: ["board"], provider: "@fixtures/fake-circuit-a", config: "src/boards/mainboard/circuit.config.ts", dir: "src/boards/mainboard", status: "ready" },
      { capability: "cad", module: "watch-case", instances: ["case"], provider: "@fixtures/fake-cad", config: "src/enclosures/case/cad.config.ts", dir: "src/enclosures/case", status: "ready" },
    ]);
    expect(p.capabilities[0].native).toBe("src/boards/mainboard/fake-a");
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("before export, check says the outputs are not there yet and runs each provider's check", () => {
    expect(p.diagnostics.filter((d) => d.validator === "protoboard/standard-outputs").map((d) => [d.code, d.severity, d.entity.id])).toEqual([
      ["PB_OUTPUT_NOT_EXPORTED", "info", "watch-mainboard"],
      ["PB_OUTPUT_NOT_EXPORTED", "info", "watch-case"],
    ]);
    expect(p.checks.filter((c) => c.validator.startsWith("ext:@fixtures")).map((c) => `${c.validator} [${c.subject}] ${c.status}`)).toEqual([
      "ext:@fixtures/fake-circuit-a/circuit:check [watch-mainboard] ran",
      "ext:@fixtures/fake-cad/cad:check [watch-case] ran",
    ]);
    expect(p.diagnostics.find((d) => d.code === "FAKE_A_NOT_GENERATED")).toMatchObject({ validator: "ext:@fixtures/fake-circuit-a/circuit:check", source: { file: "src/boards/mainboard/circuit.config.ts" } });
  });

  it("runs an operation the provider declares beside the four, recorded and under the same write guard", async () => {
    const rec = await runCapabilityOperation(p, "circuit", "stamp", "board", { force: "true" });
    expect(rec).toMatchObject({ operation: "circuit:stamp", status: "succeeded", effect: "export", capability: { operation: "stamp", module: "watch-mainboard" } });
    expect(rec.outputs.map((o) => o.path)).toEqual(["src/boards/mainboard/fake-a/stamp.txt"]);
    expect(readFileSync(join(p.root, "src/boards/mainboard/fake-a/stamp.txt"), "utf8")).toBe("stamp watch-mainboard forced\n");
    // the cad provider declares no such operation
    await expect(runCapabilityOperation(p, "cad", "stamp", "case")).rejects.toThrow(/unknown operation cad:stamp/);
  });

  it("accepts an instance path or a module id, and rejects anything else with the bound modules listed", async () => {
    const byPath = await runCapabilityOperation(p, "circuit", "check", "board");
    expect(byPath.capability).toMatchObject({ module: "watch-mainboard", instance: "board", provider: "@fixtures/fake-circuit-a" });
    const byId = await runCapabilityOperation(p, "circuit", "check", "watch-mainboard");
    expect(byId.capability?.instance).toBeUndefined();
    await expect(runCapabilityOperation(p, "circuit", "generate", "case")).rejects.toThrow(/watch-case has no circuit.config.ts.*watch-mainboard/);
    await expect(runCapabilityOperation(p, "circuit", "generate", "nope")).rejects.toThrow(/no instance path or module "nope"/);
    await expect(runCapabilityOperation(p, "circuit", "route", "board")).rejects.toThrow(/unknown operation circuit:route \(operations: generate, export, extract, check, stamp\)/);
    await expect(runCapabilityOperation(p, "fabrication", "generate", "board")).rejects.toThrow(/unknown capability "fabrication"/);
  });
});

describe("unavailable providers are reported clearly", () => {
  it("not installed: an error at the config's provider line, and run refuses with the install command", async () => {
    const p = await loadProject(watch({ "src/boards/mainboard/circuit.config.ts": circuitConfig("@acme/ext-kicad") }));
    const d = p.diagnostics.find((x) => x.code === "PB_PROVIDER_NOT_INSTALLED")!;
    expect(d).toMatchObject({ severity: "error", entity: { kind: "definition", id: "watch-mainboard" }, source: { file: "src/boards/mainboard/circuit.config.ts", line: 4 }, validator: "protoboard/capabilities" });
    expect(d.message).toBe("circuit provider @acme/ext-kicad (named by src/boards/mainboard/circuit.config.ts) is not installed; run npm install @acme/ext-kicad");
    expect(codes(p, "protoboard/extensions")).toEqual([]); // reported once, by the module that needs it
    await expect(runCapabilityOperation(p, "circuit", "generate", "board")).rejects.toThrow(/not installed; run npm install @acme\/ext-kicad/);
    expect(listCapabilities(p).modules[0]).toMatchObject({ status: "unavailable" });
    // the other module is unaffected
    expect(p.checks.find((c) => c.subject === "watch-case")?.status).toBe("ran");
  });

  it("installed but not a provider of the capability", async () => {
    const p = await loadProject(watch({ "src/boards/mainboard/circuit.config.ts": circuitConfig("@fixtures/fake-cad") }));
    expect(p.diagnostics.find((x) => x.code === "PB_PROVIDER_LACKS_CAPABILITY")?.message).toBe(
      "@fixtures/fake-cad does not provide circuit (it provides cad); name a circuit provider in src/boards/mainboard/circuit.config.ts",
    );
  });

  it("config problems: no module next to it, an invalid process, unknown and missing constraints", async () => {
    const p = await loadProject(
      watch({
        "src/boards/orphan/circuit.config.ts": circuitConfig("@fixtures/fake-circuit-a"),
        "src/boards/mainboard/circuit.config.ts": circuitConfig("@fixtures/fake-circuit-a", `{ layers: 4, thickness_mm: 0.8 }`),
        "src/enclosures/case/cad.config.ts": `import { defineCapabilityConfig } from "@protoboardai/core";\nexport default defineCapabilityConfig({ provider: "@fixtures/fake-cad", constraints: {} });\n`,
        "src/enclosures/lid/lid.uhd.ts": `export const LID = { id: "watch-lid", name: "Lid", interfaces: [] };\n`,
        "src/enclosures/lid/cad.config.ts": `export default { provider: "@fixtures/fake-cad", process: "weld", constraints: { wall_mm: 1 } };\n`,
      }),
    );
    const found = p.diagnostics.filter((d) => d.validator === "protoboard/capabilities").map((d) => [d.code, d.severity, d.source?.file, d.source?.line]);
    expect(found).toEqual([
      ["PB_CAPABILITY_CONFIG_INVALID", "error", "src/enclosures/lid/cad.config.ts", 1],
      ["PB_CAPABILITY_CONSTRAINT_UNKNOWN", "warning", "src/boards/mainboard/circuit.config.ts", 5],
      ["PB_CAPABILITY_MODULE_NOT_FOUND", "error", "src/boards/orphan/circuit.config.ts", undefined],
      ["PB_CAPABILITY_CONSTRAINT_MISSING", "error", "src/enclosures/case/cad.config.ts", undefined],
    ]);
    expect(p.diagnostics.find((d) => d.code === "PB_CAPABILITY_CONSTRAINT_MISSING")?.message).toBe("@fixtures/fake-cad needs constraint wall_mm: wall thickness");
  });
});

describe.each([
  ["circuit", "@fixtures/fake-circuit-a", "board"],
  ["circuit", "@fixtures/fake-circuit-b", "board"],
  ["cad", "@fixtures/fake-cad", "case"],
])("the %s contract: %s", (capability, provider, module) => {
  it("generate, export, extract and check all hold; records are kept; check then passes", async () => {
    const dir = watch(capability === "circuit" ? { "src/boards/mainboard/circuit.config.ts": circuitConfig(provider) } : {});
    const p = await loadProject(dir);
    const report = await runProviderContract(p, capability, module);
    expect(report.steps.map((s) => [s.operation, s.status, s.problems])).toEqual([
      ["generate", "succeeded", []],
      ["export", "succeeded", []],
      ["extract", "succeeded", []],
      ["check", "succeeded", []],
    ]);
    expect(report).toMatchObject({ passed: true, provider });
    // generate, export and extract are recorded; check is pure
    const recs = readdirSync(join(dir, "operations")).map((f) => JSON.parse(readFileSync(join(dir, "operations", f), "utf8")));
    expect(recs.map((r) => r.operation).sort()).toEqual([`${capability}:export`, `${capability}:extract`, `${capability}:generate`]);
    expect(recs[0].capability).toMatchObject({ id: capability, provider, config: expect.stringMatching(/\.config\.ts$/), configDigest: expect.stringMatching(/^sha256:/) });
    const exported = report.steps[1].record;
    expect(exported.diagnostics?.filter((d) => d.severity !== "info")).toEqual([]);
    expect(exported.outputs.length).toBeGreaterThanOrEqual(capability === "circuit" ? 10 : 4);

    const after = await loadProject(dir);
    const outputs = after.checks.find((c) => c.validator === "protoboard/standard-outputs");
    expect(outputs).toMatchObject({ status: "ran", counts: { error: 0, warning: 0 } });
    expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("switching provider", () => {
  it("changing only circuit.config.ts moves the board from provider A to B; native files sit side by side, out/ is B's", async () => {
    const dir = watch();
    const a = await loadProject(dir);
    expect((await runProviderContract(a, "circuit", "board")).passed).toBe(true);
    expect(existsSync(join(dir, OUT, "gerber/F_Cu.gbr"))).toBe(true);

    writeFileSync(join(dir, "src/boards/mainboard/circuit.config.ts"), circuitConfig("@fixtures/fake-circuit-b"));
    const b = await loadProject(dir);
    expect(b.capabilities[0]).toMatchObject({ provider: "@fixtures/fake-circuit-b", native: "src/boards/mainboard/fake-circuit-b" });
    const report = await runProviderContract(b, "circuit", "board");
    expect(report).toMatchObject({ passed: true, provider: "@fixtures/fake-circuit-b" });
    expect(readdirSync(join(dir, OUT, "gerber")).sort()).toEqual(["board.gbl", "board.gko", "board.gtl", "board.xln"]);
    expect(existsSync(join(dir, "src/boards/mainboard/fake-a/design.json"))).toBe(true);
    expect(existsSync(join(dir, "src/boards/mainboard/fake-circuit-b/board.fkb"))).toBe(true);

    // the provider is part of what operations read: the project digest changes with it
    expect(report.steps[0].record.projectDigest).not.toBe((await runCapabilityOperation(a, "circuit", "check", "board")).projectDigest);
  });

  it("through the CLI, in fresh processes", () => {
    const dir = watch({ "src/boards/mainboard/circuit.config.ts": circuitConfig("@fixtures/fake-circuit-b") });
    expect(pb(dir, ["run", "circuit:generate", "--module", "board"]).json).toMatchObject({ status: "succeeded", operation: "circuit:generate", extension: { id: "@fixtures/fake-circuit-b" } });
    const exp = pb(dir, ["run", "circuit:export", "--module", "watch-mainboard"]);
    expect(exp.status).toBe(0);
    expect(exp.json.capability).toMatchObject({ id: "circuit", operation: "export", module: "watch-mainboard" });
    writeFileSync(join(dir, "src/boards/mainboard/circuit.config.ts"), circuitConfig("@fixtures/fake-circuit-a"));
    const caps = pb(dir, ["capabilities"]);
    expect(caps.status).toBe(0);
    expect(caps.json.modules[0]).toMatchObject({ module: "watch-mainboard", provider: "@fixtures/fake-circuit-a", status: "ready" });
    expect(caps.json.capabilities.find((c: { id: string }) => c.id === "circuit").providers.map((x: { extension: string }) => x.extension)).toEqual(["@fixtures/fake-circuit-a"]);
    // A has not generated yet: its check says so, and B's exported outputs still validate
    const check = pb(dir, ["check", "--severity", "info"]);
    expect(check.status).toBe(0);
    expect(check.json.diagnostics.map((d: { code: string }) => d.code)).toContain("FAKE_A_NOT_GENERATED");
    expect(check.json.checks.find((c: { validator: string }) => c.validator === "protoboard/standard-outputs")).toMatchObject({ status: "ran", counts: { error: 0 } });
  });
});

describe("capabilities sharing out/", () => {
  const FIRMWARE_CONFIG = `import { defineCapabilityConfig } from "@protoboardai/core";\n\nexport default defineCapabilityConfig({ provider: "@fixtures/fake-firmware" });\n`;
  const outputs = (p: Project) => p.diagnostics.filter((d) => d.validator === "protoboard/standard-outputs").map((d) => [d.code, d.entity.id, d.severity]);

  it("a board's circuit and firmware exports leave each other's outputs in place, and both validate", async () => {
    const dir = watch({ "src/boards/mainboard/firmware.config.ts": FIRMWARE_CONFIG });
    const p = await loadProject(dir);
    expect(p.capabilities.map((b) => [b.capability, b.out])).toEqual([
      ["circuit", OUT],
      ["firmware", OUT],
      ["cad", "src/enclosures/case/out"],
    ]);
    expect(outputs(p).filter(([, id]) => id === "watch-mainboard")).toEqual([
      ["PB_OUTPUT_NOT_EXPORTED", "watch-mainboard", "info"],
      ["PB_OUTPUT_NOT_EXPORTED", "watch-mainboard", "info"],
    ]);

    expect((await runProviderContract(p, "circuit", "board")).passed).toBe(true);
    // only the circuit has exported: the firmware is not exported yet, not missing
    const half = await loadProject(dir);
    expect(outputs(half).filter(([, id]) => id === "watch-mainboard")).toEqual([["PB_OUTPUT_NOT_EXPORTED", "watch-mainboard", "info"]]);
    // ...and says which capability's outputs are missing (PB-869)
    expect(half.diagnostics.find((d) => d.code === "PB_OUTPUT_NOT_EXPORTED" && d.entity.id === "watch-mainboard")!.message).toBe(
      `watch-mainboard has no firmware outputs yet (${OUT}/, which holds its circuit outputs); run \`protoboard run firmware:export --module watch-mainboard\``,
    );

    expect((await runProviderContract(p, "firmware", "board")).passed).toBe(true);
    expect(existsSync(join(dir, OUT, "bom.csv"))).toBe(true);
    expect(existsSync(join(dir, OUT, "gerber/F_Cu.gbr"))).toBe(true);
    expect(existsSync(join(dir, OUT, "config/board.conf"))).toBe(true);

    // a stale file the circuit export owns is removed by the next circuit export; firmware's files stay
    writeFileSync(join(dir, OUT, "stale.txt"), "from an earlier export\n");
    expect((await runCapabilityOperation(p, "circuit", "export", "board")).status).toBe("succeeded");
    expect(existsSync(join(dir, OUT, "stale.txt"))).toBe(false);
    expect(existsSync(join(dir, OUT, "firmware.manifest.json"))).toBe(true);
    expect((await runCapabilityOperation(p, "firmware", "export", "board")).status).toBe("succeeded");
    expect(existsSync(join(dir, OUT, "pnp.csv"))).toBe(true);

    const after = await loadProject(dir);
    expect(outputs(after)).toEqual([["PB_OUTPUT_NOT_EXPORTED", "watch-case", "info"]]);
    expect(after.diagnostics.find((d) => d.code === "PB_OUTPUT_NOT_EXPORTED")!.message).toMatch(/^watch-case has no cad outputs yet \(src\/enclosures\/case\/out\/\); run/);
    expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    // a hand edit to one capability's output is reported against that capability's export, not the other's
    writeFileSync(join(dir, OUT, "config/board.conf"), readFileSync(join(dir, OUT, "config/board.conf"), "utf8") + "CONFIG_EDITED=y\n");
    const edited = (await loadProject(dir)).diagnostics.filter((d) => d.code === "PB_OUTPUT_STALE");
    expect(edited.map((d) => d.message.replace(/\(operations\/[^)]*\)/, "(record)"))).toEqual([
      `${OUT}/config/board.conf: edited after firmware:export wrote it (record); re-run \`protoboard run firmware:export --module watch-mainboard\` instead of editing generated outputs`,
    ]);
  });

  it("firmware export removes only config/ and its manifest", async () => {
    const dir = watch({ "src/boards/mainboard/firmware.config.ts": FIRMWARE_CONFIG });
    write(dir, `${OUT}/bom.csv`, "instance\n");
    write(dir, `${OUT}/gerber/top.gtl`, "G04*\n");
    write(dir, `${OUT}/config/old.conf`, "OLD=y\n");
    const p = await loadProject(dir);
    await runCapabilityOperation(p, "firmware", "generate", "board");
    expect((await runCapabilityOperation(p, "firmware", "export", "board")).status).toBe("succeeded");
    expect(readdirSync(join(dir, OUT)).sort()).toEqual(["bom.csv", "config", "firmware.manifest.json", "gerber"]);
    expect(readdirSync(join(dir, OUT, "config"))).toEqual(["board.conf"]);
    expect(existsSync(join(dir, OUT, "gerber/top.gtl"))).toBe(true);
  });

  it("an export that fails or throws leaves the last good out/ as it was, and nothing staged behind (PB-1013)", async () => {
    const dir = watch({ "src/boards/mainboard/firmware.config.ts": FIRMWARE_CONFIG });
    const p = await loadProject(dir);
    expect((await runProviderContract(p, "circuit", "board")).passed).toBe(true);
    const bom = readFileSync(join(dir, OUT, "bom.csv"), "utf8");
    const listing = readdirSync(join(dir, OUT), { recursive: true }).map(String).sort();
    const staging = join(dir, "src/boards/mainboard/.out.staging");
    const half = async (finish: () => { status: "failed"; summary: string }) =>
      runCapabilityStep(p, "circuit", "export", "board", async (ctx) => {
        ctx.writeOutput(`${OUT}/bom.csv`, "instance\nhalf\n");
        ctx.writeOutput(`${OUT}/gerber/F_Cu.gbr`, "G04 half*\n");
        expect(existsSync(staging)).toBe(true);
        expect(readFileSync(join(dir, OUT, "bom.csv"), "utf8")).toBe(bom);
        return finish();
      });
    const thrown = await half(() => {
      throw new Error("Maximum call stack size exceeded");
    });
    expect(thrown).toMatchObject({ status: "failed", summary: "Maximum call stack size exceeded" });
    expect((await half(() => ({ status: "failed", summary: "converter refused" }))).status).toBe("failed");
    expect(readFileSync(join(dir, OUT, "bom.csv"), "utf8")).toBe(bom);
    expect(readdirSync(join(dir, OUT), { recursive: true }).map(String).sort()).toEqual(listing);
    expect(existsSync(staging)).toBe(false);
    // a successful export swaps the new files in; the record names out/, not the staging folder
    const ok = await runCapabilityOperation(p, "circuit", "export", "board");
    expect(ok.status).toBe("succeeded");
    expect(ok.outputs.every((o) => o.path.startsWith(`${OUT}/`))).toBe(true);
    expect(existsSync(staging)).toBe(false);
  });
});

describe("standard outputs are diagnosed", async () => {
  const dir = watch();
  const p = await loadProject(dir);
  await runCapabilityOperation(p, "circuit", "generate", "board");
  await runCapabilityOperation(p, "circuit", "export", "board");
  await runCapabilityOperation(p, "cad", "generate", "case");
  await runCapabilityOperation(p, "cad", "export", "case");
  const found = async () => (await loadProject(dir)).diagnostics.filter((d) => d.validator === "protoboard/standard-outputs").map((d) => [d.code, d.severity, d.source?.file, d.source?.line ?? null]);

  it("missing files", async () => {
    rmSync(join(dir, OUT, "bom.csv"));
    rmSync(join(dir, OUT, "gerber/board.drl"));
    rmSync(join(dir, "src/enclosures/case/out/body.stl"));
    expect(await found()).toEqual([
      ["PB_OUTPUT_MISSING", "error", `${OUT}/gerber/`, null],
      ["PB_OUTPUT_MISSING", "error", `${OUT}/bom.csv`, null],
      // each export's record says what it wrote: a file it wrote that is gone is not its output (PB-869)
      ["PB_OUTPUT_STALE", "warning", `${OUT}/bom.csv`, null],
      ["PB_OUTPUT_STALE", "warning", `${OUT}/gerber/board.drl`, null],
      ["PB_OUTPUT_MISSING", "error", "src/enclosures/case/out", null],
      ["PB_OUTPUT_STALE", "warning", "src/enclosures/case/out/body.stl", null],
    ]);
    const p2 = await loadProject(dir);
    expect(p2.diagnostics.find((d) => d.source?.file === "src/enclosures/case/out")?.message).toBe('src/enclosures/case/out/: process "print" needs a manufacturing export (.stl or .3mf) in out/');
  });

  it("malformed files, located to the line where it helps", async () => {
    await runCapabilityOperation(p, "circuit", "export", "board");
    await runCapabilityOperation(p, "cad", "export", "case");
    const edit = (rel: string, fn: (s: string) => string) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), "utf8")));
    edit(`${OUT}/gerber/F_Cu.gbr`, (s) => s.replace("M02*\n", ""));
    edit(`${OUT}/pnp.csv`, (s) => s.replace("j1,26,6,0,top", "j1,26,6,0,middle"));
    edit(`${OUT}/bom.csv`, (s) => s + "u9,fixture-mcu,1\n");
    edit(`${OUT}/board.manifest.json`, (s) => s.replace('"units": "mm"', '"units": "in"'));
    edit(`${OUT}/netlist.json`, (s) => s.replace('"u1:vdd"', '"u1:vcc"'));
    edit(`${OUT}/board.step`, (s) => s.replace("END-ISO-10303-21;", ""));
    const glbBytes = readFileSync(join(dir, OUT, "board.glb"));
    writeFileSync(join(dir, OUT, "board.glb"), glbBytes.subarray(0, glbBytes.length - 8));
    writeFileSync(join(dir, "src/enclosures/case/out/body.stl"), "solid box\nendsolid box\n");
    const p2 = await loadProject(dir);
    const all = p2.diagnostics.filter((d) => d.validator === "protoboard/standard-outputs");
    // every hand edit is also an output that differs from what its export wrote (PB-869)
    expect(all.filter((d) => d.code === "PB_OUTPUT_STALE").map((d) => [d.severity, d.source?.file.replace(/^src\/(boards\/mainboard|enclosures\/case)\/out\//, "")])).toEqual(
      ["board.glb", "board.manifest.json", "board.step", "bom.csv", "gerber/F_Cu.gbr", "netlist.json", "pnp.csv", "body.stl"].map((f) => ["warning", f]),
    );
    expect(all.find((d) => d.code === "PB_OUTPUT_STALE" && d.source?.file === `${OUT}/bom.csv`)!.message).toMatch(/bom\.csv: edited after circuit:export wrote it \(operations\/.*\.json\); re-run `protoboard run circuit:export --module watch-mainboard`/);
    const ds = all.filter((d) => d.code !== "PB_OUTPUT_STALE");
    expect(ds.map((d) => [d.code, d.source?.file.replace(/^src\/(boards\/mainboard|enclosures\/case)\/out\//, ""), d.source?.line ?? null])).toEqual([
      ["PB_OUTPUT_MALFORMED", "gerber/F_Cu.gbr", 10],
      ["PB_OUTPUT_UNKNOWN_INSTANCE", "bom.csv", 5],
      ["PB_OUTPUT_MALFORMED", "pnp.csv", 4],
      ["PB_OUTPUT_MALFORMED", "board.glb", null],
      ["PB_OUTPUT_MALFORMED", "board.step", 12],
      ["PB_OUTPUT_MALFORMED", "board.manifest.json", null],
      ["PB_OUTPUT_UNKNOWN_INSTANCE", "netlist.json", null],
      ["PB_OUTPUT_MALFORMED", "body.stl", null],
    ]);
    expect(ds.map((d) => d.message.replace(/^src\/\S+\/out\/\S*: /, ""))).toEqual([
      "does not end with M02* (truncated?)",
      "instance u9 is not a component of the module (known: u1, u2, j1)",
      'side "middle" is not top or bottom',
      `header length ${glbBytes.length} ≠ file size ${glbBytes.length - 8} (truncated?)`,
      "does not end with END-ISO-10303-21; (truncated?)",
      'units is "in"; UHD geometry is in "mm"',
      "net N_v3v3: u1:vcc: fixture-mcu has no interface vcc",
      "ASCII STL with no facets",
    ]);
    expect(errorsIn(p2)).toBe(8);
  });

  it("an export whose outputs do not validate is recorded as failed, with the findings attached", async () => {
    const dir2 = watch({}, {});
    const q = await loadProject(dir2);
    await runCapabilityOperation(q, "circuit", "generate", "board");
    // a hand edit drops a component from the native design: the BOM no longer covers the board
    const design = join(dir2, "src/boards/mainboard/fake-a/design.json");
    const d = JSON.parse(readFileSync(design, "utf8"));
    d.components = d.components.filter((c: { instance: string }) => c.instance !== "u2");
    d.components.push({ instance: "u7", definition: "fixture-ldo", x: 1, y: 1, rotation: 0, side: "top" });
    writeFileSync(design, JSON.stringify(d));
    const rec = await runCapabilityOperation(q, "circuit", "export", "board");
    expect(rec.status).toBe("failed");
    expect(rec.summary).toBe("exported 3 components; standard outputs invalid: 2 error(s), first: src/boards/mainboard/out/bom.csv: instance u7 is not a component of the module (known: u1, u2, j1)");
    expect(rec.diagnostics?.map((x) => [x.code, x.severity, x.source?.file])).toEqual([
      ["PB_OUTPUT_UNKNOWN_INSTANCE", "error", `${OUT}/bom.csv`],
      ["PB_OUTPUT_UNKNOWN_INSTANCE", "error", `${OUT}/pnp.csv`],
      ["PB_OUTPUT_INCOMPLETE", "warning", `${OUT}/bom.csv`],
    ]);
    // ...and the provider's own check reports the drift, attributed to it, in protoboard check
    const after = await loadProject(dir2);
    const drift = after.diagnostics.filter((x) => x.code === "FAKE_A_DRIFT");
    expect(drift.map((x) => x.message)).toEqual(["u2 is in the model but not in the design; regenerate", "u7 is in the design but no longer in the model; regenerate"]);
    expect(drift[0]).toMatchObject({ validator: "ext:@fixtures/fake-circuit-a/circuit:check", entity: { id: "watch-mainboard" }, source: { file: "src/boards/mainboard/fake-a/design.json" } });
    expect(after.checks.find((c) => c.validator === "ext:@fixtures/fake-circuit-a/circuit:check")).toMatchObject({ subject: "watch-mainboard", status: "ran", counts: { error: 2 } });
  });
});

const errorsIn = (p: Project) => p.diagnostics.filter((d) => d.severity === "error").length;

describe("capability operations keep to their module", () => {
  const rogue = (body: string) => ({
    "@acme/ext-rogue": {
      manifest: manifest("@acme/ext-rogue", [{ id: "circuit", operations: { generate: "./x.ts#g", export: "./x.ts#e", extract: "./x.ts#x", check: "./x.ts#c" } }]),
      files: { "x.ts": `${body}\nexport const e = g, x = g;\n` },
    },
  });

  it("writes outside the module's provider directory are refused; check cannot write; check must return diagnostics", async () => {
    const dir = watch(
      { "src/boards/mainboard/circuit.config.ts": circuitConfig("@acme/ext-rogue", "{}") },
      rogue(
        `export const g = (ctx) => { ctx.writeOutput("src/watch.uhd.ts", "export const WATCH = 1;"); return { status: "succeeded", summary: "" }; };\n` +
          `export const c = (ctx) => { ctx.writeOutput(ctx.module.out + "/x", "x"); return { status: "succeeded", summary: "" }; };`,
      ),
    );
    const p = await loadProject(dir);
    const gen = await runCapabilityOperation(p, "circuit", "generate", "board");
    expect(gen).toMatchObject({ status: "failed", summary: "circuit:generate writes only inside the module's provider directory src/boards/mainboard/ (not src/watch.uhd.ts)" });
    expect(readFileSync(join(dir, "src/watch.uhd.ts"), "utf8")).toBe(SYSTEM);
    expect((await runCapabilityOperation(p, "circuit", "check", "board")).summary).toMatch(/declared pure/);
    expect(p.checks.find((c) => c.validator === "ext:@acme/ext-rogue/circuit:check")).toMatchObject({ status: "skipped", reason: expect.stringMatching(/is pure and cannot write/) });
  });

  it("a check without a diagnostics array breaks the contract and is not counted as passed", async () => {
    const dir = watch({ "src/boards/mainboard/circuit.config.ts": circuitConfig("@acme/ext-rogue", "{}") }, rogue(`export const g = () => ({ status: "succeeded", summary: "ok" }), c = g;`));
    const p = await loadProject(dir);
    expect(p.checks.find((c) => c.validator === "ext:@acme/ext-rogue/circuit:check")).toMatchObject({ status: "skipped", reason: "check returned no diagnostics array (return [] when the design matches)" });
    const report = await runProviderContract(p, "circuit", "board");
    expect(report.passed).toBe(false);
    expect(report.steps.flatMap((s) => s.problems)).toEqual([
      "generate wrote no native files under src/boards/mainboard/rogue/",
      "export failed: ok; standard outputs invalid: 8 error(s), first: src/boards/mainboard/out/gerber/: missing Gerber RS-274X layers (every file in gerber/ that is not a drill file)",
      "export wrote nothing under src/boards/mainboard/out/",
      "extract failed: ok; extracted facts invalid: extract returned no facts (data must be { frames?, artifacts? })",
      "check failed: check returned no diagnostics array (return [] when the design matches)",
    ]);
  });
});

describe("CLI errors", () => {
  it("run without --module lists the bound modules; an uninstalled provider fails run (exit 2) and check (exit 1)", () => {
    const dir = watch({ "src/boards/mainboard/circuit.config.ts": circuitConfig("@acme/ext-kicad") });
    const noModule = pb(dir, ["run", "cad:generate"]);
    expect(noModule.status).toBe(2);
    expect(noModule.json.error).toBe("usage: protoboard run cad:generate --module <instance path or module id>; modules with a cad config: watch-case");
    const run = pb(dir, ["run", "circuit:generate", "--module", "board"]);
    expect(run.status).toBe(2);
    expect(run.json.error).toMatch(/@acme\/ext-kicad .* is not installed; run npm install @acme\/ext-kicad/);
    const check = pb(dir, ["check"]);
    expect(check.status).toBe(1);
    expect(check.json.diagnostics.find((d: { code: string }) => d.code === "PB_PROVIDER_NOT_INSTALLED").source).toEqual({ file: "src/boards/mainboard/circuit.config.ts", line: 4 });
    const caps = pb(dir, ["capabilities"]);
    expect(caps.status).toBe(1);
    expect(caps.json.modules[0]).toMatchObject({ status: "unavailable", problem: expect.stringMatching(/not installed/) });
  });
});

describe("file format checks", () => {
  it("Gerber RS-274X", () => {
    const good = gerber({ units: "mm", fileFunction: "Copper,L1,Top", pads: [{ x: 1, y: 1 }] });
    expect(checkGerber(Buffer.from(good))).toEqual([]);
    expect(checkGerber(Buffer.from(good.replace("%MOMM*%\n", "")))).toEqual([{ message: "no unit (%MOMM*% or %MOIN*%)" }]);
    expect(checkGerber(Buffer.from("G04 RS-274D has no parameters*\nX0Y0D02*\nM02*\n"))[0].message).toMatch(/not an RS-274X file/);
    expect(checkGerber(Buffer.from(good.replace("%FSLAX46Y46*%", "%FSTAX46Y46*%")))).toEqual([{ severity: "warning", line: 3, message: expect.stringMatching(/deprecated/) }]);
  });

  it("Excellon", () => {
    const good = excellon({ units: "in", diameter_mm: 1, holes: [{ x: 1, y: 1 }] });
    expect(checkExcellon(Buffer.from(good))).toEqual([]);
    expect(checkExcellon(Buffer.from(good.replace("M30\n", ""))).map((p) => p.message)).toEqual(["does not end with M30 (truncated?)"]);
    expect(checkExcellon(Buffer.from(good.replace("INCH,TZ\n", "").replace(/T1C[\d.]+\n/, ""))).map((p) => p.message)).toEqual(["header states no unit (METRIC or INCH)", "header defines no tool (T<n>C<diameter>)"]);
  });

  it("GLB", () => {
    const good = glb({ asset: { version: "2.0" } });
    expect(checkGlb(good)).toEqual([]);
    expect(checkGlb(glb({ asset: { version: "1.0" } }))[0].message).toMatch(/expected "2.0"/);
    const v1 = Buffer.from(good);
    v1.writeUInt32LE(1, 4);
    expect(checkGlb(v1)[0].message).toBe("GLB version 1; glTF 2.0 is required");
    expect(checkGlb(Buffer.from("not a glb at all, really"))[0].message).toBe("magic is not glTF");
  });

  it("STEP", () => {
    const good = step("x.step", [{ name: "p", x: 0, y: 0, z: 0 }]);
    expect(checkStep(Buffer.from(good))).toEqual([]);
    expect(checkStep(Buffer.from(good.replace(/FILE_SCHEMA.*\n/, ""))).map((p) => p.message)).toEqual(["header has no FILE_SCHEMA"]);
    expect(checkStep(Buffer.from("solid stl\n"))[0].message).toBe("does not start with ISO-10303-21;");
  });

  it("STL, binary and ASCII", () => {
    expect(checkStl(stlBox(10, 10, 10))).toEqual([]);
    expect(checkStl(stlBox(10, 10, 10).subarray(0, 300))[0].message).toMatch(/neither a binary STL/);
    expect(checkStl(Buffer.from("solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n"))).toEqual([]);
    expect(checkStl(Buffer.from("solid t\nfacet normal 0 0 1\nouter loop\n"))[0].message).toMatch(/does not end with endsolid/);
  });

  it("3MF", () => {
    const pkg = zipStored([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name: "_rels/.rels", data: "<Relationships/>" },
      { name: "3D/3dmodel.model", data: "<model/>" },
    ]);
    expect(checkThreeMf(pkg)).toEqual([]);
    expect(checkThreeMf(zipStored([{ name: "3D/3dmodel.model", data: "<model/>" }])).map((p) => p.message)).toEqual(["no _rels/.rels (package root relationships)"]);
    expect(checkThreeMf(pkg.subarray(0, pkg.length - 10))[0].message).toMatch(/no end-of-central-directory/);
    expect(checkThreeMf(Buffer.from("<model/>"))[0].message).toMatch(/not a ZIP package/);
  });

  it("DXF", () => {
    expect(checkDxf(Buffer.from("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"))).toEqual([]);
    expect(checkDxf(Buffer.from("0\nSECTION\n2\nENTITIES\n"))[0].message).toMatch(/does not end with 0 \/ EOF/);
  });

  it("geometry manifest against the UHD GeometryManifest type", () => {
    expect(checkManifest({ artifact: "body", units: "mm", features: { a: { area_mm2: 1, centroid: [0, 0, 0], normal: [0, 0, 1], faces: 2 } } })).toEqual([]);
    expect(checkManifest({ artifact: "body", units: "mm", features: { a: { area_mm2: -1, centroid: [0, 0], faces: 1.5 } }, volume_mm3: "big" }).map((p) => p.message)).toEqual([
      "volume_mm3 must be a non-negative number",
      'feature "a": invalid area_mm2, centroid, faces',
    ]);
    expect(checkManifest([]).map((p) => p.message)).toEqual(["is not a JSON object"]);
  });

  it("CSV with quoted commas, quotes and newlines", () => {
    const { rows, lines } = parseCsv('instance,note\r\nu1,"a, ""b""\nc"\nu2,plain\n');
    expect(rows).toEqual([["instance", "note"], ["u1", 'a, "b"\nc'], ["u2", "plain"]]);
    expect(lines).toEqual([1, 2, 4]);
    expect(parseCsv('a\n"open').error).toEqual({ message: "unterminated quoted field", line: 2 });
  });
});

describe("an alias's steps and definitions that read their own design files", () => {
  // the case names itself from a file its cad:generate writes, as a routed harness reads its route
  const READS_LABEL = `import { existsSync, readFileSync } from "node:fs";
const label = new URL("./frame-cad/label.json", import.meta.url);
const opening = (id: string) => ({ id, name: id, domain: "mechanical", exposed: true, protocols: [{ type: "mechanical", roles: ["mount"] }] });
export const CASE = { id: "watch-case", name: existsSync(label) ? JSON.parse(readFileSync(label, "utf8")).name : "Watch case", interfaces: [opening("board_mount"), opening("usb_opening")] };
`;

  it("runCapabilityStep records one module's run done in-process, under the capability's write guard", async () => {
    const dir = watch({ "src/enclosures/case/case.uhd.ts": READS_LABEL });
    const p = await loadProject(dir);
    const rec = await runCapabilityStep(p, "cad", "generate", "case", (ctx) => {
      ctx.writeOutput(`${ctx.module.dir}/frame-cad/label.json`, JSON.stringify({ name: "Watch case, labelled" }));
      return { status: "succeeded", summary: `${ctx.module.id}: labelled` };
    });
    expect(rec).toMatchObject({ operation: "cad:generate", status: "succeeded", capability: { id: "cad", operation: "generate", module: "watch-case", provider: "@fixtures/fake-cad" } });
    expect(rec.outputs.map((o) => o.path)).toEqual(["src/enclosures/case/frame-cad/label.json"]);
    expect(existsSync(join(dir, operationRecordFile(rec)))).toBe(true);

    const outside = await runCapabilityStep(p, "cad", "generate", "case", (ctx) => {
      ctx.writeOutput("src/elsewhere.json", "{}");
      return { status: "succeeded", summary: "wrote outside" };
    });
    expect(outside).toMatchObject({ status: "failed", outputs: [] });
    expect(outside.summary).toMatch(/writes only inside the module's provider directory src\/enclosures\/case/);
  });

  it("a fresh load sees what a definition reads now; a plain load in the same process does not", async () => {
    const dir = watch({ "src/enclosures/case/case.uhd.ts": READS_LABEL });
    const before = await loadProject(dir, { checks: false });
    expect(before.definitions.get("watch-case")!.def.name).toBe("Watch case");
    write(dir, "src/enclosures/case/frame-cad/label.json", JSON.stringify({ name: "Watch case, labelled" }));
    const cached = await loadProject(dir, { checks: false });
    expect(cached.definitions.get("watch-case")!.def.name).toBe("Watch case");
    const fresh = await loadProject(dir, { checks: false, fresh: true });
    const def = fresh.definitions.get("watch-case")!.def;
    expect(def.name).toBe("Watch case, labelled");
    expect(moduleDigest(def, fresh.lookup)).not.toBe(moduleDigest(before.definitions.get("watch-case")!.def, before.lookup));
    // the fresh project runs operations like any other
    expect((await runCapabilityOperation(fresh, "cad", "generate", "case")).capability!.moduleDigest).toBe(moduleDigest(def, fresh.lookup));
  });
});

describe("a provider's declared artifacts reach the bound module (PB-1030)", () => {
  const DECLARING = "@fixtures/declaring-circuit";
  const declaring = (artifacts: unknown) => ({
    [DECLARING]: {
      manifest: manifest(DECLARING, [
        {
          id: "circuit",
          operations: ops,
          artifacts,
        },
      ]),
    },
  });
  const ARTIFACTS = [
    { id: "board_glb", name: "Board (GLB)", type: "3d_model", role: "body", format: "glb", units: "m", path: "{out}/board.glb" },
    { id: "board_pcb_top", name: "PCB, top", type: "pcb", role: "drawing", format: "svg", path: "{out}/pcb-top.svg" },
    { id: "board_schematic", name: "Schematic", type: "schematic", role: "drawing", format: "svg", path: "{out}/schematic.svg" },
    { id: "board_routed", name: "Routed board", type: "pcb", format: "json", path: "{native}/circuit.json" },
    { id: "board_kicad", name: "KiCad project", type: "pcb", role: "source", format: "kicad", path: "{dir}/kicad/{module}.kicad_pro" },
  ];
  const project = (overrides: Record<string, string | null> = {}, artifacts: unknown = ARTIFACTS) =>
    watch({ "src/boards/mainboard/circuit.config.ts": circuitConfig(DECLARING), ...overrides }, declaring(artifacts));
  const ids = (p: Project) => (p.definitions.get("watch-mainboard")!.def.artifacts ?? []).map((a) => `${a.id}=${a.filePath}`);

  it("attaches each declared file that exists, with its path resolved; a missing file is not attached", async () => {
    const dir = project({ [`${OUT}/pcb-top.svg`]: "<svg/>", [`${OUT}/schematic.svg`]: "<svg/>", "src/boards/mainboard/declaring-circuit/circuit.json": "[]" });
    const p = await loadProject(dir);
    expect(ids(p)).toEqual([
      `board_pcb_top=${OUT}/pcb-top.svg`,
      `board_schematic=${OUT}/schematic.svg`,
      "board_routed=src/boards/mainboard/declaring-circuit/circuit.json",
    ]);
    expect(p.capabilities.find((b) => b.module === "watch-mainboard")!.attached).toEqual(["board_pcb_top", "board_schematic", "board_routed"]);
    // the project's artifact list and the bundle carry them too; no missing-artifact finding
    expect(p.artifacts.filter((a) => a.definition === "watch-mainboard").map((a) => [a.id, a.present])).toEqual([
      ["board_pcb_top", true],
      ["board_schematic", true],
      ["board_routed", true],
    ]);
    expect(codes(p)).not.toContain("PB_MISSING_ARTIFACT");
    const { uhdBundle } = await import("../src/index.js");
    const bundle = await uhdBundle(p);
    expect(bundle.definitions.find((d) => d.id === "watch-mainboard")!.artifacts!.map((a) => a.id)).toEqual(["board_pcb_top", "board_schematic", "board_routed"]);
  });

  it("a locked board's KiCad project is attached by the module's id", async () => {
    const p = await loadProject(project({ "src/boards/mainboard/kicad/watch-mainboard.kicad_pro": "{}" }));
    expect(ids(p)).toEqual(["board_kicad=src/boards/mainboard/kicad/watch-mainboard.kicad_pro"]);
  });

  it("an artifact the module lists itself wins, by id or by file path", async () => {
    const listed = BOARD.replace(
      "  children: [",
      `  artifacts: [
    { id: "board_pcb_top", name: "Top, hand-picked", type: "pcb", format: "svg", filePath: "${OUT}/pcb-top.svg" },
    { id: "my_schematic", name: "Schematic", type: "schematic", format: "svg", filePath: "${OUT}/schematic.svg" },
  ],
  children: [`,
    );
    const dir = project({ "src/boards/mainboard/mainboard.uhd.ts": listed, [`${OUT}/pcb-top.svg`]: "<svg/>", [`${OUT}/schematic.svg`]: "<svg/>" });
    write(dir, `${OUT}/board.glb`, glb({ asset: { version: "2.0" } }));
    const p = await loadProject(dir);
    const arts = p.definitions.get("watch-mainboard")!.def.artifacts!;
    expect(arts.map((a) => a.id)).toEqual(["board_pcb_top", "my_schematic", "board_glb"]);
    expect(arts[0].name).toBe("Top, hand-picked");
  });

  it("the module's digest does not change when outputs appear (an export is not a design change)", async () => {
    const dir = project();
    const before = await loadProject(dir, { checks: false });
    const def0 = before.definitions.get("watch-mainboard")!.def;
    write(dir, `${OUT}/pcb-top.svg`, "<svg/>");
    const after = await loadProject(dir, { checks: false });
    const def1 = after.definitions.get("watch-mainboard")!.def;
    expect(def1.artifacts!.length).toBe(1);
    expect(moduleDigest(def1, after.lookup)).toBe(moduleDigest(def0, before.lookup));
    // the source's own object is never changed: a plain reload in this process starts from the definition as written
    write(dir, `${OUT}/schematic.svg`, "<svg/>");
    const again = await loadProject(dir, { checks: false });
    expect(again.definitions.get("watch-mainboard")!.def.artifacts!.map((a) => a.id)).toEqual(["board_pcb_top", "board_schematic"]);
  });

  it("the model checks see an attached body: the board's components are drawn by its GLB, not reported unplaced", async () => {
    const without = await loadProject(project());
    const dir = project();
    write(dir, `${OUT}/board.glb`, glb({ asset: { version: "2.0" } }));
    const p = await loadProject(dir);
    expect(p.definitions.get("watch-mainboard")!.def.artifacts!.map((a) => a.id)).toEqual(["board_glb"]);
    const unplaced = (q: Project) => q.diagnostics.filter((d) => d.code === "UHD_UNPLACED" && d.entity.id.startsWith("board/")).length;
    expect(unplaced(p)).toBeLessThanOrEqual(unplaced(without));
  });

  it("check warns when a board has outputs on disk that no view can reach, and says why", async () => {
    // a provider that declares nothing (a field board's situation before PB-1030: no artifacts, no PCB tab)
    const silent = await loadProject(project({ [`${OUT}/pcb-top.svg`]: "<svg/>", [`${OUT}/bom.csv`]: "instance\n" }, []));
    const d = silent.diagnostics.find((x) => x.code === "PB_VIEW_UNREACHABLE")!;
    expect(d).toMatchObject({ severity: "warning", entity: { kind: "definition", id: "watch-mainboard" }, validator: "protoboard/views" });
    expect(d.message).toContain(`${OUT}/pcb-top.svg, ${OUT}/bom.csv on disk`);
    expect(d.message).toMatch(/no PCB, BOM tabs .*declares no artifacts.*protoboard views check --module watch-mainboard/);
    expect(d.source?.file).toBe("src/boards/mainboard/mainboard.uhd.ts");

    // the module's own artifact of the declared id points elsewhere
    const listed = BOARD.replace("  children: [", `  artifacts: [{ id: "board_pcb_top", name: "Top", type: "pcb", format: "svg", filePath: "docs/old-top.svg" }],\n  children: [`);
    const shadow = await loadProject(project({ "src/boards/mainboard/mainboard.uhd.ts": listed, "docs/old-top.svg": "<svg/>", [`${OUT}/pcb-top.svg`]: "<svg/>" }));
    expect(shadow.diagnostics.find((x) => x.code === "PB_VIEW_UNREACHABLE")!.message).toMatch(/overrides the provider's artifacts: its own artifact board_pcb_top names docs\/old-top.svg/);

    // attached: nothing to say
    const fine = await loadProject(project({ [`${OUT}/pcb-top.svg`]: "<svg/>", [`${OUT}/schematic.svg`]: "<svg/>" }));
    expect(codes(fine)).not.toContain("PB_VIEW_UNREACHABLE");
    expect(fine.checks.find((c) => c.validator === "protoboard/views")).toMatchObject({ status: "ran" });
  });

  it("a declaration whose path leaves the provider directory, or has no id, is refused", async () => {
    const p = await loadProject(project({}, [{ id: "x", name: "X", type: "pcb", path: "../elsewhere.svg" }, { name: "no id", type: "pcb", path: "{out}/a.svg" }, { id: "y", name: "Y", type: "pcb", path: "{out}/../../up.svg" }]));
    const messages = p.diagnostics.filter((d) => d.code.startsWith("PB_EXTENSION")).map((d) => d.message).join("\n");
    expect(messages).toMatch(/artifact "x": path must start with \{out\}\/, \{native\}\/ or \{dir\}\//);
    expect(messages).toMatch(/every declared artifact needs an id/);
    expect(messages).toMatch(/artifact "y": path must start/);
  });
});
