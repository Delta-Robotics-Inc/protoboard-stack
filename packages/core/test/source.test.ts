/**
 * Definition source of catalog parts (PB-910; UHD library protocol § 4.6):
 * `parts add` vendors a part's .uhd.ts and the modules it imports by default
 * and `--compiled` only the JSON; loading evaluates the source; `check`
 * reports a source that no longer evaluates to the pinned digest and
 * requirement ranges the project does not meet; source that breaks the lint
 * is never written.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sealDraft, type PartRevisionDraft, type RevisionSource, type UhdModuleDef } from "@protoboardai/cloud/client";
import { addParts, connectCloud, connectLibrary, loadProject, readOrigins, sha256, updatePart, type CloudConnection } from "../src/index.js";
import { uhdPinDiagnostics } from "../src/source.js";
import { Blobs, draft, startLibrary, TOKEN, type CloudService } from "./cloud.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-source");
const NOW = "2026-10-05T00:00:00.000Z";

const CONFIG = `import { defineConfig } from "@protoboardai/core";
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });
`;
const SYSTEM = `export const SYS = { id: "sys", name: "System", interfaces: [], children: [{ id: "s", moduleDefId: "test-sourced-sensor" }, { id: "p", moduleDefId: "test-plain-part" }] };\n`;

const power = { id: "vin", name: "VIN", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["sink"] }] };
const SENSOR: UhdModuleDef = { id: "test-sourced-sensor", name: "Sourced sensor", manufacturer: "Test", part_number: "SS-1", interfaces: [power], tags: ["sensor"] };
const PLAIN: UhdModuleDef = { id: "test-plain-part", name: "Plain part", interfaces: [power] };

/** The sensor's source: an entry and a helper it imports, evaluating to SENSOR. */
const ENTRY = `/** Test sourced sensor. */
import type { ModuleDef } from "@deltarobotics/uhd";
import { vin } from "./lib/pins.js";

export const TEST_SOURCED_SENSOR = {
  id: "test-sourced-sensor",
  name: "Sourced sensor",
  manufacturer: "Test",
  part_number: "SS-1",
  interfaces: [vin()],
  tags: ["sensor"],
} as unknown as ModuleDef;
`;
const HELPER = `export const vin = () => ({ id: "vin", name: "VIN", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["sink"] }] });\n`;

let svc: CloudService;
let lib: CloudConnection;
const blobs = new Blobs();
const sourceOf = (files: Record<string, string>, requires = { uhd: "^0.2.0", typescript: "^7.0.0" }): RevisionSource => ({
  repository: "test library",
  entry: "test-sourced-sensor.uhd.ts",
  export: "TEST_SOURCED_SENSOR",
  files: Object.entries(files).map(([path, text]) => ({ path, ...blobs.add(text), mediaType: "text/typescript" })),
  requires,
});
const withSource = (d: PartRevisionDraft, source: RevisionSource): PartRevisionDraft => sealDraft({ ...d, source });

let n = 0;
const project = () => {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "protoboard.config.ts"), CONFIG);
  writeFileSync(join(dir, "src/sys.uhd.ts"), SYSTEM);
  return dir;
};

beforeAll(async () => {
  svc = await startLibrary();
  lib = connectCloud(undefined, { url: svc.url, env: {} });
  const sensor = draft(blobs, SENSOR, { files: {} });
  await svc.client.publish(withSource(sensor, sourceOf({ "test-sourced-sensor.uhd.ts": ENTRY, "lib/pins.ts": HELPER })), blobs.source);
  // revision 2: the same definition, its source declaring a UHD and a TypeScript this project does not have
  await svc.client.publish(withSource(draft(blobs, SENSOR, { revision: 2 }), sourceOf({ "test-sourced-sensor.uhd.ts": ENTRY, "lib/pins.ts": HELPER }, { uhd: "^0.2.0 || ^9.0.0", typescript: "^5.0.0" })), blobs.source);
  await svc.client.publish(draft(blobs, PLAIN), blobs.source);
});
afterAll(async () => {
  await svc?.stop();
  rmSync(TMP, { recursive: true, force: true });
});

describe("parts add with definition source", () => {
  it("vendors the .uhd.ts and its helper beside the definition, and loading evaluates it to the pinned digest", async () => {
    const dir = project();
    const r = await addParts(await loadProject(dir, { checks: false }), ["test-sourced-sensor@1", "test-plain-part"], lib, { now: NOW });
    expect(r.map((x) => [x.id, x.status, x.files, x.message])).toEqual([
      ["test-sourced-sensor", "added", 2, undefined],
      ["test-plain-part", "added", undefined, undefined],
    ]);
    const rec = readOrigins(dir).definitions["test-sourced-sensor"];
    expect(rec.source).toEqual({
      entry: "test-sourced-sensor.uhd.ts",
      export: "TEST_SOURCED_SENSOR",
      requires: { uhd: "^0.2.0", typescript: "^7.0.0" },
      files: { "test-sourced-sensor.uhd.ts": sha256(ENTRY), "lib/pins.ts": sha256(HELPER) },
    });
    expect(readFileSync(join(dir, "parts/catalog/test-sourced-sensor/test-sourced-sensor.uhd.ts"), "utf8")).toBe(ENTRY);
    expect(readFileSync(join(dir, "parts/catalog/test-sourced-sensor/lib/pins.ts"), "utf8")).toBe(HELPER);
    expect(readOrigins(dir).definitions["test-plain-part"].source).toBeUndefined();

    const p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.code.startsWith("PB_SOURCE") || d.severity === "error")).toEqual([]);
    const loaded = p.definitions.get("test-sourced-sensor")!;
    expect(loaded.origin.definitionSource).toEqual({ file: "parts/catalog/test-sourced-sensor/test-sourced-sensor.uhd.ts" });
    // the same definition the JSON holds, key for key
    expect(JSON.stringify(loaded.def)).toBe(JSON.stringify(JSON.parse(readFileSync(join(dir, "parts/catalog/test-sourced-sensor.json"), "utf8"))));
    expect(p.definitions.get("test-plain-part")!.origin.definitionSource).toBeUndefined();

    // adding again changes nothing
    expect((await addParts(p, ["test-sourced-sensor@1"], lib)).map((x) => x.status)).toEqual(["unchanged"]);
  });

  it("check reports an edited vendored part whose source no longer evaluates to the pin; restoring it clears that", async () => {
    const dir = project();
    await addParts(await loadProject(dir, { checks: false }), ["test-sourced-sensor@1", "test-plain-part"], lib, { now: NOW });
    const helper = join(dir, "parts/catalog/test-sourced-sensor/lib/pins.ts");

    // a comment: still the same definition
    writeFileSync(helper, `// a note\n${HELPER}`);
    let p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.code.startsWith("PB_SOURCE")).map((d) => [d.code, d.severity])).toEqual([["PB_SOURCE_EDITED", "info"]]);

    // a changed value: drift, reported; the project builds the pinned definition, not what the source now says
    writeFileSync(helper, HELPER.replace('"VIN"', '"VBAT"'));
    p = await loadProject(dir);
    const drift = p.diagnostics.filter((d) => d.code === "PB_SOURCE_DRIFT");
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ severity: "error", source: { file: "parts/catalog/test-sourced-sensor/lib/pins.ts" } });
    expect(drift[0].message).toMatch(/no longer evaluates to the pinned definition of test-sourced-sensor@1 .*lib\/pins\.ts was edited.*protoboard parts add test-sourced-sensor@1/);
    expect(drift[0].message).toMatch(/parts\/catalog\/test-sourced-sensor\.json is used/);
    expect(p.definitions.get("test-sourced-sensor")!.def.interfaces[0].name).toBe("VIN");

    // the source does not evaluate at all
    writeFileSync(helper, "export const vin = () => { throw new Error('broken helper'); };\n");
    p = await loadProject(dir);
    expect(p.diagnostics.find((d) => d.code === "PB_SOURCE_LOAD_FAILED")!.message).toMatch(/broken helper; parts\/catalog\/test-sourced-sensor\.json is used/);
    expect(p.definitions.get("test-sourced-sensor")!.def.interfaces[0].name).toBe("VIN");

    // parts add restores the vendored source, nothing else
    const before = readFileSync(join(dir, "parts/origins.json"), "utf8");
    const r = await addParts(p, ["test-sourced-sensor@1"], lib, { now: "2026-10-06T00:00:00.000Z" });
    expect(r.map((x) => [x.status, x.message])).toEqual([["restored", "vendored its definition source (test-sourced-sensor.uhd.ts and 1 module(s) it imports)"]]);
    expect(readFileSync(join(dir, "parts/origins.json"), "utf8")).toBe(before);
    p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.code.startsWith("PB_SOURCE"))).toEqual([]);
  });

  it("--compiled vendors the JSON only, and turns a vendored source back into JSON only", async () => {
    const dir = project();
    const r = await addParts(await loadProject(dir, { checks: false }), ["test-sourced-sensor@1", "test-plain-part"], lib, { now: NOW, compiled: true });
    expect(r.map((x) => [x.status, x.files])).toEqual([["added", undefined], ["added", undefined]]);
    expect(readOrigins(dir).definitions["test-sourced-sensor"].source).toBeUndefined();
    expect(existsSync(join(dir, "parts/catalog/test-sourced-sensor/test-sourced-sensor.uhd.ts"))).toBe(false);

    // with source, then compiled again
    const withSrc = await addParts(await loadProject(dir, { checks: false }), ["test-sourced-sensor@1"], lib);
    expect(withSrc.map((x) => x.status)).toEqual(["restored"]);
    expect(existsSync(join(dir, "parts/catalog/test-sourced-sensor/lib/pins.ts"))).toBe(true);
    const back = await addParts(await loadProject(dir, { checks: false }), ["test-sourced-sensor@1"], lib, { compiled: true });
    expect(back.map((x) => [x.status, x.message])).toEqual([["restored", "removed its definition source (--compiled)"]]);
    expect(existsSync(join(dir, "parts/catalog/test-sourced-sensor/lib/pins.ts"))).toBe(false);
    expect(readOrigins(dir).definitions["test-sourced-sensor"].source).toBeUndefined();
    const p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("parts update vendors the new revision's source; check holds the project to its UHD and TypeScript ranges", async () => {
    const dir = project();
    await addParts(await loadProject(dir, { checks: false }), ["test-sourced-sensor@1", "test-plain-part"], lib, { now: NOW });
    const r = await updatePart(await loadProject(dir, { checks: false }), "test-sourced-sensor", 2, lib, { now: NOW });
    expect(r[0]).toMatchObject({ status: "updated", revision: 2, files: 2 });
    expect(r[0].message).toMatch(/its source is written for TypeScript \^5\.0\.0 \(the project has 7\./);
    expect(readOrigins(dir).definitions["test-sourced-sensor"].source!.requires).toEqual({ uhd: "^0.2.0 || ^9.0.0", typescript: "^5.0.0" });
    const p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.code.startsWith("PB_SOURCE")).map((d) => [d.code, d.severity])).toEqual([["PB_SOURCE_TS_RANGE", "warning"]]);

    // a UHD outside the part's range is an error
    const origins = JSON.parse(readFileSync(join(dir, "parts/origins.json"), "utf8"));
    origins.definitions["test-sourced-sensor"].source.requires.uhd = "^9.0.0";
    writeFileSync(join(dir, "parts/origins.json"), JSON.stringify(origins, null, 2) + "\n");
    const q = await loadProject(dir);
    expect(q.diagnostics.find((d) => d.code === "PB_SOURCE_UHD_RANGE")).toMatchObject({ severity: "error", message: expect.stringMatching(/needs @deltarobotics\/uhd \^9\.0\.0; the project has 0\.3\./) });
  });

  /** A library mirror that serves `text` as test-sourced-sensor@1's source: the record is outside the envelope digest. */
  const swappingMirror = async (text: string) => {
    const bad = blobs.add(text);
    await svc.client.uploadBlob(blobs.source(bad.sha256));
    const mirror: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (!/\/parts\/test-sourced-sensor\/revisions\/1(\/closure)?$/.test(new URL(String(input)).pathname)) return res;
      const swap = (env: { source?: RevisionSource }) => ({ ...env, source: { ...env.source!, files: [{ path: "test-sourced-sensor.uhd.ts", ...bad, mediaType: "text/typescript" }] } });
      const body = (await res.json()) as { revisions?: { source?: RevisionSource }[] } & { source?: RevisionSource };
      return Response.json(body.revisions ? { ...body, revisions: body.revisions.map(swap) } : swap(body), { status: res.status });
    };
    return connectLibrary({ id: "protoboard", url: svc.url }, { fetch: mirror, env: {} });
  };

  it("never writes source that breaks the lint (a library or mirror serving other code under the same pin)", async () => {
    // only the lint and the evaluation stand in its way
    const tampered = await swappingMirror(`import { readFileSync } from "node:fs";\n${ENTRY}`);
    const dir = project();
    const r = await addParts(await loadProject(dir, { checks: false }), ["test-sourced-sensor@1"], tampered, { now: NOW });
    expect(r[0].status).toBe("added");
    expect(r[0].message).toMatch(/^its definition source was refused \(test-sourced-sensor\.uhd\.ts:1 imports "node:fs"/);
    expect(existsSync(join(dir, "parts/catalog/test-sourced-sensor/test-sourced-sensor.uhd.ts"))).toBe(false);
    expect(readOrigins(dir).definitions["test-sourced-sensor"].source).toBeUndefined();
    expect(TOKEN).toBeTruthy();
  });

  /** The sensor's source in one file, as a mirror would serve it. */
  const INLINE = ENTRY.replace('import { vin } from "./lib/pins.js";', HELPER.replace("export ", "").trim());

  it("source that gets past the lint never runs in this process: evaluated confined, it reaches nothing and is not written", async () => {
    const marker = join(TMP, "pwned");
    rmSync(marker, { force: true });
    // a key computed at run time is beyond the lint; the Function constructor it reaches cannot compile in the confined child
    const payload = `const F = (() => 0)["constr" + "uctor"];\nF(${JSON.stringify(`require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`)})();\n`;
    const tampered = await swappingMirror(`${payload}${INLINE}`);
    const dir = project();
    const r = await addParts(await loadProject(dir, { checks: false }), ["test-sourced-sensor@1"], tampered, { now: NOW });
    expect(r[0].status).toBe("added");
    expect(r[0].message).toMatch(/^its definition source does not evaluate here \(Code generation from strings disallowed/);
    expect(existsSync(join(dir, "parts/catalog/test-sourced-sensor/test-sourced-sensor.uhd.ts"))).toBe(false);
    expect(existsSync(marker)).toBe(false);
    // the string spelled out is refused before it is run
    const spelled = await swappingMirror(`const F = (() => 0)["constructor"];\nvoid F;\n${INLINE}`);
    const s2 = await addParts(await loadProject(project(), { checks: false }), ["test-sourced-sensor@1"], spelled, { now: NOW });
    expect(s2[0].message).toMatch(/^its definition source was refused \(test-sourced-sensor\.uhd\.ts:1 uses the string "constructor"/);
  });

  it("an edited vendored source is linted and evaluated confined at load: host access is refused, a computed escape fails", async () => {
    const dir = project();
    await addParts(await loadProject(dir, { checks: false }), ["test-sourced-sensor@1", "test-plain-part"], lib, { now: NOW });
    const helper = join(dir, "parts/catalog/test-sourced-sensor/lib/pins.ts");
    writeFileSync(helper, `${HELPER}export const home = process.env.HOME;\n`);
    let p = await loadProject(dir);
    const lint = p.diagnostics.find((d) => d.code === "PB_SOURCE_LINT")!;
    expect(lint).toMatchObject({ severity: "error", source: { file: "parts/catalog/test-sourced-sensor/lib/pins.ts", line: 2 } });
    expect(lint.message).toMatch(/uses process.*parts\/catalog\/test-sourced-sensor\.json is used/);
    expect(p.definitions.get("test-sourced-sensor")!.def.interfaces[0].name).toBe("VIN");

    const marker = join(dir, "pwned");
    writeFileSync(helper, `${HELPER}const F = (() => 0)["constr" + "uctor"];\nexport const x = F(${JSON.stringify(`require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`)})();\n`);
    p = await loadProject(dir);
    expect(p.diagnostics.find((d) => d.code === "PB_SOURCE_LOAD_FAILED")!.message).toMatch(/Code generation from strings disallowed/);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("the project's exact UHD pin against the UHD it runs with (PB-941)", () => {
  const project = (name: string, pin: string | undefined, installed: string | undefined) => {
    const dir = join(TMP, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, private: true, type: "module", dependencies: pin ? { "@deltarobotics/uhd": pin } : {} }));
    if (installed) {
      mkdirSync(join(dir, "node_modules/@deltarobotics/uhd"), { recursive: true });
      writeFileSync(join(dir, "node_modules/@deltarobotics/uhd/package.json"), JSON.stringify({ name: "@deltarobotics/uhd", version: installed }));
    }
    return dir;
  };

  it("says nothing when they agree, when the project declares a range, or when nothing is installed here", () => {
    expect(uhdPinDiagnostics(project("pin-same", "0.2.1", "0.2.1"))).toEqual([]);
    expect(uhdPinDiagnostics(project("pin-range", "^0.2.0", "0.2.1"))).toEqual([]);
    expect(uhdPinDiagnostics(project("pin-none", undefined, "0.2.1"))).toEqual([]);
  });

  it("warns either way round within a minor line, naming the version that ran and both ways out", () => {
    const [older] = uhdPinDiagnostics(project("pin-older", "0.2.0", "0.2.1"));
    expect(older).toMatchObject({ code: "PB_UHD_PIN", severity: "warning", source: { file: "package.json" } });
    expect(older.message).toBe(
      "package.json pins @deltarobotics/uhd 0.2.0, and 0.2.1 is installed: this ran with 0.2.1. Run `npm install` to get the pinned version, or move the pin to 0.2.1 (the same 0.2 line: parts and definitions written for one work with the other)",
    );
    const [newer] = uhdPinDiagnostics(project("pin-newer", "0.2.1", "0.2.0"));
    expect(newer.message).toMatch(/pins @deltarobotics\/uhd 0\.2\.1, and 0\.2\.0 is installed: this ran with 0\.2\.0\..*the same 0\.2 line/);
  });

  it("says so when the installed UHD is another minor line", () => {
    expect(uhdPinDiagnostics(project("pin-minor", "0.2.1", "0.3.0"))[0].message).toMatch(/another minor line: UHD's schema may differ, and each vendored part's range is checked against 0\.3\.0/);
  });
});

describe("which UHD runs a part's source", () => {
  it("is its declared range, or a later line UHD says reads the older line's definitions unchanged (0.3 reads 0.2)", async () => {
    const { uhdRunsSource } = await import("../src/source.js");
    expect(uhdRunsSource("0.2.1", "^0.2.0")).toBe(true);
    expect(uhdRunsSource("0.3.0", "^0.2.0")).toBe(true);
    expect(uhdRunsSource("0.3.4", "^0.2.1")).toBe(true);
    expect(uhdRunsSource("0.3.0", "^0.3.0")).toBe(true);
    expect(uhdRunsSource("0.2.1", "^0.3.0")).toBe(false); // an older UHD does not read the newer line
    expect(uhdRunsSource("0.4.0", "^0.2.0")).toBe(false); // nor a line UHD has not declared compatible
    expect(uhdRunsSource("0.3.0", "^9.0.0")).toBe(false);
    expect(uhdRunsSource("0.3.0", "^0.1.0")).toBe(false);
  });
});
