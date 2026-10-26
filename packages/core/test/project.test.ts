/**
 * M1 exit criteria: a fresh project loads
 * headlessly; repeated instances have distinct paths; invalid endpoints and
 * unresolved definitions fail clearly; fixed inputs produce stable build
 * data; a missing required artifact is visible.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { artifactPathEscape, initProject, inspectInstance, listArtifacts, loadProject, resolvedProject, sha256, stableStringify, type Project, type ProjectDiagnostic } from "../src/index.js";
import { undefinedParts } from "../src/capabilities.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const QUAD = join(HERE, "../../../examples/quadcopter-5in");
const WATCH = join(HERE, "../../../examples/wearable-watch");
const BOTTLE = join(HERE, "../../../examples/smart-bottle");
const TMP = join(HERE, ".tmp");
let n = 0;
const tmpProject = (files: Record<string, string>) => {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CONFIG = `import { defineConfig } from "@protoboardai/core";
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });
`;
const PART = (id: string) => `{ id: "${id}", name: "${id}", interfaces: [{ id: "p", name: "P", domain: "electrical", protocols: [{ type: "power", roles: ["source"] }] }] }`;

/**
 * The GNSS module's vendor CAD (Matek's M9N-5883 STEP and the GLBs converted
 * from it) is not distributed: its terms are not stated (UHD
 * docs/geometry-artifacts.md), so its catalog revision lists those files as
 * missingArtifacts rather than carrying them, and check reports each as an
 * optional PB_ARTIFACT_UNAVAILABLE warning. Only that case is tolerated: an
 * unavailable artifact anywhere else, or any other warning, still fails.
 */
const OPTIONAL_VENDOR_FILE = /\/(vendor|\.research)\//;
const isUnavailableVendorFile = (p: Project, d: ProjectDiagnostic) => {
  if (d.code !== "PB_ARTIFACT_UNAVAILABLE" || d.entity.kind !== "artifact") return false;
  const a = p.artifacts.find((x) => `${x.definition}#${x.id}` === d.entity.id);
  return !!a?.filePath && a.present === false && OPTIONAL_VENDOR_FILE.test(a.filePath);
};

describe("quadcopter reference project", async () => {
  const p = await loadProject(QUAD);

  it("loads headlessly with no errors (the one warning is the real propulsion finding)", () => {
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const warnings = p.diagnostics.filter((d) => d.severity === "warning" && !isUnavailableVendorFile(p, d));
    expect(warnings.map((d) => d.code)).toEqual(["UHD_PROPULSION_CURRENT"]);
    expect(p.checks.map((c) => `${c.validator}:${c.status}`)).toEqual([
      "protoboard/registry:ran",
      "protoboard/resolve:ran",
      "protoboard/artifacts:ran",
      // the extensions load and the capabilities bind first: the providers' declared outputs are the modules'
      // artifacts before the model checks read them (PB-1030)
      "protoboard/extensions:ran",
      "protoboard/capabilities:ran",
      "uhd/checkSystem:ran",
      "uhd/assemble:ran",
      "uhd/geometryBindings:ran",
      "ext:@protoboardai/ext-hardware/evidence:ran",
      "ext:@protoboardai/ext-frame-cad/frames:ran",
      "ext:@protoboardai/ext-frame-cad/hardware:ran",
      "ext:@protoboardai/ext-harness-cad/routes:ran",
      "protoboard/views:ran",
      "protoboard/standard-outputs:ran",
      // one provider check per module with a cad.config.ts: the twelve hardware parts and the capacitor
      // (parts/local), ten cables, then the frame and the top plate
      ...Array(12).fill("ext:@protoboardai/ext-frame-cad/cad:check:ran"),
      "ext:@protoboardai/ext-parts/cad:check:ran",
      ...Array(10).fill("ext:@protoboardai/ext-harness-cad/cad:check:ran"),
      "ext:@protoboardai/ext-frame-cad/cad:check:ran",
      "ext:@protoboardai/ext-frame-cad/cad:check:ran",
    ]);
    expect(p.capabilities.map((b) => `${b.module} ${b.provider}`).filter((x) => x.includes("frame-cad") && x.startsWith("quadcopter"))).toEqual(["quadcopter-5in-frame @protoboardai/ext-frame-cad", "quadcopter-5in-top-plate @protoboardai/ext-frame-cad"]);
    // every CAD body comes through the capability: the bought parts' bodies too
    expect(p.capabilities.filter((b) => b.capability === "cad").length).toBe(25);
  });

  it("places findings where they are declared: links, instances, a catalog part's origin entry (PB-861)", () => {
    const line = (file: string, needle: string) => readFileSync(join(QUAD, file), "utf8").split("\n").findIndex((l) => l.includes(needle)) + 1;
    const sys = "src/quadcopter.uhd.ts";
    const of = (code: string, id: string) => p.diagnostics.find((d) => d.code === code && d.entity.id === id)!.source;
    // a derived link at its first link that is declared (an object literal), or a helper call's first argument
    expect(of("UHD_PROPULSION_CURRENT", "battery_pads+battery_plug~battery_out~bat_in")).toEqual({ file: sys, line: line(sys, 'id: "battery_pads"') });
    expect(of("UHD_SUPPLY_BUDGET", "dji_fc+dji_o4~bec_10v~vcc")).toEqual({ file: sys, line: line(sys, 'link("dji_fc"') });
    // an unplaced instance at its declaration in its parent (the battery, receiver and bulk cap are placed
    // from their placement hints since the watch work; the strap is not)
    expect(of("UHD_UNPLACED", "strap")).toEqual({ file: sys, line: line(sys, 'id: "strap", moduleDefId') });
  });

  it("places a catalog part's missing file at its entry in parts/origins.json, not line 1 of the vendored JSON (PB-861)", async () => {
    // the quadcopter's catalog parts carry every file now: a copy without the GNSS's vendor GLB
    const dir = join(TMP, "quad-missing-file");
    rmSync(dir, { recursive: true, force: true });
    // (not its tsconfig.json, which extends the workspace's from two levels up)
    cpSync(QUAD, dir, { recursive: true, filter: (src) => !/[/\\](node_modules|\.protoboard|\.claude|operations|tsconfig\.json)$/.test(src) });
    rmSync(join(dir, "parts/catalog/matek-m9n-5883/library/parts/matek-m9n-5883/artifacts/cad/vendor/M9N-5883.glb"));
    const copy = await loadProject(dir, { extensions: false });
    const unavailable = copy.diagnostics.find((d) => d.code === "PB_ARTIFACT_UNAVAILABLE")!;
    expect(unavailable.entity.id).toBe("matek-m9n-5883#cad_vendor_glb");
    const entry = readFileSync(join(QUAD, "parts/origins.json"), "utf8").split("\n").findIndex((l) => l.includes('"matek-m9n-5883": {')) + 1;
    expect(unavailable.source).toEqual({ file: "parts/origins.json", line: entry });
  });

  it("gives repeated instances of one definition distinct paths", () => {
    const motors = p.instances.filter((i) => i.definition === "meps-neon-2207-v2-1950kv").map((i) => i.path);
    expect(motors.sort()).toEqual(["arm_fl/motor", "arm_fr/motor", "arm_rl/motor", "arm_rr/motor"]);
    expect(new Set(p.instances.map((i) => i.path)).size).toBe(p.instances.length);
  });

  it("keeps origins: local sources with lines, catalog parts pinned by digest and revision", () => {
    const frame = p.definitions.get("quadcopter-5in-frame")!.origin;
    expect(frame).toMatchObject({ kind: "local", tier: "project-specific", source: { file: "src/modules/frame/frame.uhd.ts" } });
    expect(frame.source.line).toBeGreaterThan(0);
    const motor = p.definitions.get("meps-neon-2207-v2-1950kv")!.origin;
    expect(motor).toMatchObject({ kind: "catalog", tier: "catalog", provider: "protoboard-cloud", library: "protoboard", revision: 2 });
    expect(motor.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(motor.envelopeDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // catalog files were vendored into the project with the revision: nothing resolves from the UHD package
    expect(motor.artifactBase).toEqual({ kind: "vendored", dir: "parts/catalog/meps-neon-2207-v2-1950kv" });
    for (const r of p.definitions.values()) expect(r.origin.artifactBase.kind).not.toBe("package");
    const glb = p.artifacts.find((a) => a.definition === "meps-neon-2207-v2-1950kv" && a.id === "cad_glb")!;
    expect(glb).toMatchObject({ present: true, resolved: join(QUAD, "parts/catalog/meps-neon-2207-v2-1950kv", glb.filePath!) });
    // one purchased part was researched in the project
    expect(p.definitions.get("panasonic-eeu-fr1v471")!.origin).toMatchObject({ kind: "local", tier: "project-researched" });
  });

  it("resolves links through exports to leaf instances", () => {
    const r = inspectInstance(p, "arm_fl/motor")!;
    // the phase leads' composition lands on the motor's three lead exits (PB-805)
    expect(r.links.map((l) => l.id).sort()).toEqual(["arm_fl:prop_on_shaft", "arm_fl_mount", "m4_leads"]);
    expect(p.links.find((l) => l.id === "m4_leads")!.aLeaves).toEqual(["arm_fl/motor:phases_a", "arm_fl/motor:phases_b", "arm_fl/motor:phases_c"]);
    expect(p.links.find((l) => l.id === "arm_fl_mount")!.aLeaf).toBe("arm_fl/motor:base_mount");
  });

  it("lists artifacts with the instances using each part, for editors", () => {
    const all = listArtifacts(p)!;
    expect(all.length).toBe(p.artifacts.length);
    const step = all.find((a) => a.definition === "meps-neon-2207-v2-1950kv" && a.id === "cad_step")!;
    expect(step).toMatchObject({ name: expect.stringContaining("2207"), format: "step", present: true });
    expect(step.resolved).toBe(join(QUAD, "parts/catalog/meps-neon-2207-v2-1950kv", step.filePath!));
    expect(step.instances.sort()).toEqual(["arm_fl/motor", "arm_fr/motor", "arm_rl/motor", "arm_rr/motor"]);
    // one instance: its part's artifacts only
    expect(new Set(listArtifacts(p, "arm_fl/motor")!.map((a) => a.definition))).toEqual(new Set(["meps-neon-2207-v2-1950kv"]));
    expect(listArtifacts(p, "no/such")).toBeUndefined();
  });

  it("produces byte-stable build data for fixed inputs", async () => {
    const again = await loadProject(QUAD);
    expect(stableStringify(resolvedProject(again))).toBe(stableStringify(resolvedProject(p)));
  });
});

describe("wearable watch reference project", async () => {
  const p = await loadProject(WATCH);

  it("loads with no errors and only the warning its decisions record explains (docs/decisions.md, what check still reports)", () => {
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const cad = p.checks.find((c) => c.validator === "ext:@protoboardai/ext-enclosure-cad/cad:check");
    const warnings = p.diagnostics.filter((d) => d.severity === "warning").map((d) => d.code);
    // the enclosure check needs build123d; without it the check is skipped. Either way no enclosure warning (the
    // USB-C plug has a flat seat on the round wall, D-W12); the cell leads' slack, which the harness check reports
    // when it runs, is the one dispositioned warning
    expect(cad?.status === "ran" || cad?.status === "skipped").toBe(true);
    expect(warnings.filter((c) => c !== "HARNESS_ROUTE_WARNING")).toEqual([]);
    expect(p.capabilities.map((b) => `${b.capability} ${b.module} ${b.provider}`).sort()).toEqual([
      "cad watch-battery-leads @protoboardai/ext-harness-cad",
      "cad watch-case @protoboardai/ext-enclosure-cad",
      "cad watch-lra-leads @protoboardai/ext-harness-cad",
      "circuit watch-main-board @protoboardai/ext-tscircuit",
      "firmware watch-main-board @protoboardai/ext-zephyr",
    ]);
  });

  it("checks the board's own nets: a fault inside the board is reported against it", () => {
    // the board-level rules ran (no finding on the nominal board) and its components are drawn by its body
    expect(p.checks.find((c) => c.validator === "uhd/checkSystem")?.status).toBe("ran");
    // only the assembly materials (tapes, adhesive) are unplaced: they have no geometry (D-W16)
    expect(p.diagnostics.filter((d) => d.code === "UHD_UNPLACED").map((d) => d.entity?.id).sort()).toEqual(["cell_pad", "cover_adhesive", "display_ring", "lra_pad"]);
    expect(p.definitions.get("watch-main-board")!.def.artifacts?.some((a) => a.role === "body" && a.format === "glb")).toBe(true);
  });

  it("places the parts held inside the case from the display placements", () => {
    const placed = p.diagnostics.filter((d) => d.validator === "uhd/assemble").map((d) => d.message);
    const unplaced = p.diagnostics.filter((d) => d.validator === "uhd/assemble" && /not placed/.test(d.message)).map((d) => d.entity?.id);
    expect(unplaced.filter((id) => !["cell_pad", "cover_adhesive", "display_ring", "lra_pad"].includes(id ?? ""))).toEqual([]);
    expect(placed.length).toBeGreaterThan(0);
  });

  it("closes the back cover with its fastener stack, and seats the window covers", () => {
    const def = p.definitions.get("watch-back-cover-screws")!.def;
    expect(def.fastenerStack?.map((s) => s.child)).toEqual(["inserts", "screws"]);
    expect(p.rootDef?.links?.find((l) => l.id === "back_cover")?.harness).toBe("back_screws");
    expect(p.rootDef?.links?.filter((l) => /_seat$/.test(l.id)).map((l) => l.id).sort()).toEqual(["hr_cover_seat", "lens_seat"]);
  });
});

describe("smart-bottle reference project", async () => {
  const p = await loadProject(BOTTLE);

  it("loads with no errors; the two warnings are the ones its decisions record explains", () => {
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // docs/decisions.md "Warnings dispositioned": the I2C bus on two strapping pins
    expect(p.diagnostics.filter((d) => d.severity === "warning").map((d) => d.code).sort()).toEqual(["FW_STRAPPING_PIN", "FW_STRAPPING_PIN"]);
    expect(p.checks.filter((c) => c.status !== "ran")).toEqual([]);
    // the three capabilities, one provider check each (two cables)
    expect(p.checks.map((c) => c.validator).filter((v) => v.endsWith(":check")).sort()).toEqual([
      "ext:@protoboardai/ext-enclosure-cad/cad:check",
      "ext:@protoboardai/ext-esp-idf/firmware:check",
      "ext:@protoboardai/ext-harness-cad/cad:check",
      "ext:@protoboardai/ext-harness-cad/cad:check",
      "ext:@protoboardai/ext-tscircuit/circuit:check",
    ]);
    expect(p.capabilities.map((b) => `${b.capability} ${b.module}`).sort()).toEqual([
      "cad bottle-battery-leads",
      "cad bottle-cap-enclosure",
      "cad bottle-probe-cable",
      "circuit bottle-cap-board",
      "firmware bottle-cap-board",
    ]);
  });

  it("keeps the three part tiers", () => {
    for (const id of ["lipol-lp503450", "adafruit-381-ds18b20-probe", "nalgene-32oz-wide-mouth"]) expect(p.definitions.get(id)!.origin).toMatchObject({ kind: "local", tier: "project-researched" });
    expect(p.definitions.get("ti-lp5024rsm")!.origin).toMatchObject({ kind: "catalog", tier: "catalog" });
    expect(p.definitions.get("bottle-cap-board")!.origin).toMatchObject({ kind: "local", tier: "project-specific" });
  });

  it("resolves a link-scoped composition to the board's pads", () => {
    expect(p.links.find((l) => l.id === "bat_pads")!.bLeaves).toEqual(["board/jbat:pad_pos", "board/jbat:pad_neg"]);
  });
});

describe("failures are clear and located", () => {
  it("unresolved definition", async () => {
    const dir = tmpProject({
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", interfaces: [], children: [\n  { id: "a", moduleDefId: "no-such-part" },\n] };\n`,
    });
    const p = await loadProject(dir);
    const d = p.diagnostics.find((x) => x.code === "PB_UNRESOLVED_DEFINITION")!;
    expect(d).toMatchObject({ severity: "error", entity: { kind: "instance", id: "a" }, source: { file: "src/sys.uhd.ts", line: 2 } });
    expect(p.checks.find((c) => c.validator === "uhd/checkSystem")).toMatchObject({ status: "skipped" });
  });

  it("one unresolved definition is one finding, however many instances use it (B6)", async () => {
    const dir = tmpProject({
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", interfaces: [], children: [\n  { id: "r1", moduleDefId: "no-such-resistor" },\n  { id: "r2", moduleDefId: "no-such-resistor" },\n  { id: "r3", moduleDefId: "no-such-resistor" },\n  { id: "u1", moduleDefId: "no-such-mcu" },\n] };\n`,
    });
    const p = await loadProject(dir);
    const ds = p.diagnostics.filter((x) => x.code === "PB_UNRESOLVED_DEFINITION");
    expect(ds).toHaveLength(2);
    expect(ds[0]).toMatchObject({ entity: { kind: "instance", id: "r1" }, source: { file: "src/sys.uhd.ts", line: 2 } });
    expect(ds[0].message).toMatch(/^r1 references "no-such-resistor", which no local source or catalog entry defines; 3 instances use it \(r1, r2, r3\)\. If it is a library part, fetch it: `protoboard parts add no-such-resistor`/);
    expect(ds[1].message).toMatch(/^u1 references "no-such-mcu", which no local source or catalog entry defines\. /);
    expect(undefinedParts(p, "sys")).toEqual(["no-such-mcu", "no-such-resistor"]);
  });

  it("invalid endpoint", async () => {
    const dir = tmpProject({
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": `export const A = ${PART("part-a")};
export const SYS = { id: "sys", interfaces: [], children: [{ id: "a", moduleDefId: "part-a" }, { id: "b", moduleDefId: "part-a" }],
  links: [
    { id: "bad", a: { child: "a", interfaceId: "p" }, b: { child: "b", interfaceId: "nope" } },
  ] };
`,
    });
    const p = await loadProject(dir);
    const d = p.diagnostics.find((x) => x.code === "PB_INVALID_ENDPOINT")!;
    expect(d).toMatchObject({ entity: { kind: "link", id: "bad" }, source: { file: "src/sys.uhd.ts", line: 4 } });
    expect(d.message).toMatch(/nope/);
  });

  it("duplicate definition ids", async () => {
    const dir = tmpProject({
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", interfaces: [], children: [{ id: "a", moduleDefId: "part-a" }] };\n`,
      "src/one.uhd.ts": `export const A1 = ${PART("part-a")};\n`,
      "src/two.uhd.ts": `export const A2 = ${PART("part-a")};\n`,
    });
    const p = await loadProject(dir);
    expect(p.diagnostics.map((d) => d.code)).toContain("PB_DUPLICATE_DEFINITION");
  });

  it("a missing required artifact is visible", async () => {
    const dir = tmpProject({
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", interfaces: [],
  artifacts: [
    { id: "frame_step", name: "Frame", type: "3d_model", role: "body", format: "step", filePath: "cad/frame.step" },
  ] };
`,
    });
    const p = await loadProject(dir);
    expect(p.diagnostics.find((d) => d.code === "PB_MISSING_ARTIFACT")).toMatchObject({ severity: "error", entity: { id: "sys#frame_step" }, source: { line: 3 } });
  });

  it("a tampered catalog definition fails its digest", async () => {
    // vendored the way `parts add` writes it (parts.test.ts covers the download itself)
    const bytes = stableStringify({ id: "part-a", name: "Part A", manufacturer: "Acme", interfaces: [{ id: "p", name: "P", domain: "electrical", protocols: [{ type: "power", roles: ["source"] }] }] });
    const dir = tmpProject({
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", interfaces: [], children: [{ id: "a", moduleDefId: "part-a" }] };\n`,
      "parts/catalog/part-a.json": bytes,
      "parts/origins.json": JSON.stringify({
        schema: "protoboard.origins/v0",
        definitions: { "part-a": { file: "parts/catalog/part-a.json", tier: "catalog", provider: "protoboard-cloud", partId: "part-a", revision: 1, digest: sha256(bytes), retrievedAt: "2026-09-26T00:00:00.000Z" } },
      }),
    });
    const ok = await loadProject(dir);
    expect(ok.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(ok.definitions.get("part-a")!.origin).toMatchObject({ kind: "catalog", tier: "catalog", revision: 1 });
    writeFileSync(join(dir, "parts/catalog/part-a.json"), bytes.replace('"Acme"', '"Acme (edited)"'));
    const p = await loadProject(dir);
    expect(p.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(["PB_DIGEST_MISMATCH", "PB_UNRESOLVED_DEFINITION"]));
  });

  it("a catalog or vendored part's file stays in its folder: an unsafe path or a link out is an error and is not resolved (PB-1048)", async () => {
    const outside = join(TMP, "outside-secret");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "id_rsa"), "secret");
    const art = (id: string, filePath: string) => ({ id, name: id, type: "3d_model", role: "body", format: "step", filePath });
    const bytes = stableStringify({
      id: "part-a", name: "Part A", manufacturer: "Acme",
      interfaces: [{ id: "p", name: "P", domain: "electrical", protocols: [{ type: "power", roles: ["source"] }] }],
      artifacts: [art("up", "../outside-secret/id_rsa"), art("abs", join(outside, "id_rsa")), art("back", "cad\\x.step"), art("link", "cad/link.step"), art("dot", "./cad/body.step"), art("ok", "cad/body.step")],
    });
    const dir = tmpProject({
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", interfaces: [], children: [{ id: "a", moduleDefId: "part-a" }] };\n`,
      "parts/catalog/part-a.json": bytes,
      "cad/body.step": "ISO-10303-21;",
      "parts/origins.json": JSON.stringify({
        schema: "protoboard.origins/v0",
        definitions: { "part-a": { file: "parts/catalog/part-a.json", tier: "catalog", provider: "protoboard-cloud", partId: "part-a", revision: 1, digest: sha256(bytes), retrievedAt: "2026-09-26T00:00:00.000Z" } },
      }),
    });
    symlinkSync(join(outside, "id_rsa"), join(dir, "cad/link.step"));
    const p = await loadProject(dir, { extensions: false });
    const unsafe = p.diagnostics.filter((d) => d.code === "PB_ARTIFACT_PATH_UNSAFE");
    expect(unsafe.map((d) => [d.entity.id, d.severity])).toEqual([["part-a#up", "error"], ["part-a#abs", "error"], ["part-a#back", "error"], ["part-a#link", "error"], ["part-a#dot", "warning"]]);
    expect(unsafe[0].message).toMatch(/could lead outside the part's folder/);
    expect(unsafe[3].message).toMatch(/leads outside the part's folder through a link/);
    // a path that is only written oddly (a catalog's "./x") is a warning, and still not resolved
    expect(unsafe[4].message).toMatch(/is not a normalised relative path/);
    // none of them is given a resolved path anyone could read or open
    for (const id of ["up", "abs", "back", "link", "dot"]) {
      const a = p.artifacts.find((x) => x.id === id)!;
      expect([a.present, a.resolved]).toEqual([false, undefined]);
    }
    expect(p.artifacts.find((a) => a.id === "ok")).toMatchObject({ present: true, resolved: join(dir, "cad/body.step") });
  });

  it("a sources glob never loads the catalog folder, directly or through a link (PB-1048)", async () => {
    const marker = join(TMP, "catalog-code-ran");
    rmSync(marker, { force: true });
    const evil = `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport const EVIL = { id: "evil", name: "evil", interfaces: [] };\n`;
    const dir = tmpProject({
      "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, sources: ["**/*.uhd.ts", "parts/**/*.uhd.ts"] });\n`,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", interfaces: [] };\n`,
      "parts/catalog/evil/library/parts/evil/source/evil.uhd.ts": evil,
      "parts/catalog/evil/library/parts/evil/source/cad.config.ts": evil.replace("export const EVIL =", "export default"),
    });
    symlinkSync(join(dir, "parts/catalog/evil"), join(dir, "src/linked"));
    const p = await loadProject(dir);
    expect(existsSync(marker)).toBe(false);
    expect(p.definitions.has("evil")).toBe(false);
    expect(p.definitions.has("sys")).toBe(true);
    expect(p.diagnostics.find((d) => d.code === "PB_SOURCES_IN_CATALOG")).toMatchObject({ severity: "info", message: expect.stringMatching(/^2 file\(s\) a `sources` glob matches are in parts\/catalog/) });
  });

  it("artifactPathEscape: a vendored folder outside the project, or reached through a link, is refused", () => {
    const root = tmpProject({ "parts/catalog/x/a.step": "x" });
    expect(artifactPathEscape(root, true, join(root, "parts/catalog/x"), "a.step")).toBeUndefined();
    expect(artifactPathEscape(root, true, join(root, "../elsewhere"), "a.step")).toEqual({ reason: "belongs to a part folder outside the project", severity: "error" });
    symlinkSync(TMP, join(root, "parts/catalog/out"));
    expect(artifactPathEscape(root, true, join(root, "parts/catalog/out"), "a.step")?.severity).toBe("error");
    expect(artifactPathEscape(root, false, root, "./a.step")).toMatchObject({ severity: "warning", reason: expect.stringMatching(/not a normalised relative path/) });
    for (const p of ["/etc/passwd", "../a", "a/../../b", "a\\b", "C:/x", "a\0b"]) expect(artifactPathEscape(root, false, root, p)?.severity, p).toBe("error");
  });
});

describe("init", () => {
  it("scaffolds a project that loads", async () => {
    const dir = join(TMP, "fresh");
    rmSync(dir, { recursive: true, force: true });
    initProject(dir, { name: "Test Rig" });
    const p = await loadProject(dir);
    expect(p.rootDef?.id).toBe("test-rig");
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // the three part tiers have their places from the start
    expect(p.config.sources).toEqual(["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"]);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("parts/evidence/*/.research/");
    expect(p.definitions.get("test-rig")!.origin.tier).toBe("project-specific");
  });

  it("loads a purchased part researched in parts/local as the project-researched tier", async () => {
    const dir = tmpProject({
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", interfaces: [], children: [{ id: "a", moduleDefId: "part-a" }] };\n`,
      "parts/local/part-a.uhd.ts": `export const A = ${PART("part-a")};\n`,
    });
    const p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(p.definitions.get("part-a")!.origin).toMatchObject({ kind: "local", tier: "project-researched", source: { file: "parts/local/part-a.uhd.ts", line: 1 } });
    expect(resolvedProject(p).definitions.find((d) => d.id === "part-a")!.origin.tier).toBe("project-researched");
  });
});
