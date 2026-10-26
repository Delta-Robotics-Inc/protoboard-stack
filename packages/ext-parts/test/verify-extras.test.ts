/**
 * PB-862 additions to part verification: the typecheck step, mate lists and
 * --all, the live re-fetch of pinned sources, the free-text lint, and the
 * coverage rules for passive mechanical parts and threaded fluid ports;
 * PB-866: an artifact file that does not exist.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleDef } from "@deltarobotics/uhd";
import { afterAll, describe, expect, it } from "vitest";
import { partFiles } from "../lib/layout.ts";
import { lintFreeText } from "../lib/lint.ts";
import { formatRefetch, refetchSources, type Fetcher } from "../lib/refetch.ts";
import { ownsFile, parseDiagnostics } from "../lib/typecheck.ts";
import { artifactFileIssues, hasThreadJoint, isPassiveMechanical, mateList } from "../lib/verify.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG = join(HERE, "..");
const LIBRARY = join(HERE, "fixtures/library");
const TMP = join(HERE, ".tmp-extras");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const tsx = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(PKG, "scripts", "verify-part.ts"), ...args], { cwd: PKG, encoding: "utf8" });
const verify = (args: string[]) => {
  const r = tsx([...args, "--json"]);
  return { status: r.status, report: r.stdout ? JSON.parse(r.stdout) : undefined, stderr: r.stderr };
};
const copy = (name: string) => {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(LIBRARY, dir, { recursive: true });
  return dir;
};
const write = (file: string, data: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
};
const edit = (file: string, from: string, to: string) => {
  const s = readFileSync(file, "utf8");
  expect(s.includes(from), `${file} contains ${from}`).toBe(true);
  writeFileSync(file, s.replace(from, to));
};
const messages = (fs: { check: string; message: string }[], check?: string) => fs.filter((f) => !check || f.check === check).map((f) => `[${f.check}] ${f.message}`);

const FITTING = `/**
 * ACME F-14 fitting (fixture). Source: https://example.com/acme-f14.pdf (see ./acme-f14/sources.json)
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { defineModule, FluidPort } from "@deltarobotics/uhd";

export const ACME_F14: ModuleDef = defineModule({
  id: "acme-f14",
  name: "ACME F-14 straight fitting",
  version: "1.0.0",
  manufacturer: "ACME",
  part_number: "F-14",
  description: "Fixture: a 1/4 NPT male to 6 mm tube fitting.",
  tags: ["fixture"],
  categories: ["mechanical.pneumatic"],
  interfaces: [
    FluidPort({ id: "thread", medium: "pneumatic", role: "bidirectional", joint: { kind: "thread", standard: "NPT", size: "1/4", gender: "male" }, pressureBar: [0, 10] }),
    FluidPort({ id: "tube", medium: "pneumatic", role: "bidirectional", joint: { kind: "push_to_connect", tubeOdMm: 6 }, pressureBar: [0, 10] }),
  ],
  traits: [{ type: "operating_conditions", params: { operating_temperature_C: [0, 60], source: "https://example.com/acme-f14.pdf" } }],
  artifacts: [{ id: "drawing", name: "F-14 drawing", type: "datasheet", url: "https://example.com/acme-f14.pdf" }],
});
`;

describe("typecheck step", () => {
  it("parses tsc's diagnostics and tells the part's own files from the rest", () => {
    const d = parseDiagnostics("library/parts/x.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\nnoise\nsrc\\a.ts(1,1): error TS1005: ';' expected.");
    expect(d).toEqual([
      { file: "library/parts/x.ts", line: 3, code: "TS2322", message: "Type 'string' is not assignable to type 'number'." },
      { file: "src/a.ts", line: 1, code: "TS1005", message: "';' expected." },
    ]);
    const f = partFiles("/l", "x", "library");
    expect(["library/parts/x.ts", "library/parts/x/terms.json", "library/cad/py/catalog/x.py", "library/parts/xy.ts", "src/a.ts"].map((p) => ownsFile(f, p))).toEqual([true, true, true, false, false]);
  });

  it("a type error in the part's file fails verification; one elsewhere in the root is a warning", () => {
    const lib = copy("typecheck");
    expect(verify(["acme-sb-25", "--root", lib]).report.errors).toEqual([]);
    edit(join(lib, "library/parts/acme-sb-25.ts"), 'const DIR = "library/parts/acme-sb-25/artifacts/cad";', 'const DIR = "library/parts/acme-sb-25/artifacts/cad";\nconst WRONG: number = "3";');
    edit(join(lib, "library/parts/acme-plate.ts"), "export const ACME_PLATE", 'const ALSO_WRONG: number = "4";\nexport const ACME_PLATE');
    const r = verify(["acme-sb-25", "--root", lib]);
    expect(r.status).toBe(1);
    expect(messages(r.report.errors)).toEqual([expect.stringMatching(/^\[typecheck\] library\/parts\/acme-sb-25\.ts:\d+ TS2322 Type 'string' is not assignable to type 'number'\.$/)]);
    expect(messages(r.report.warnings, "typecheck")).toEqual(["[typecheck] 1 type error(s) in other files of the root (not this part's): run the root's typecheck"]);
    // --no-typecheck skips it (the part still imports: tsx strips types)
    expect(verify(["acme-sb-25", "--root", lib, "--no-typecheck"]).status).toBe(0);
  });
});

describe("mates", () => {
  it("--mate takes a list, and --all reports every part that forms a connection", () => {
    expect(mateList(["a,b", " c ", "a"])).toEqual(["a", "b", "c"]);
    const lib = copy("mates");
    write(join(lib, "library/parts/acme-f14.ts"), FITTING);
    edit(join(lib, "library/parts/index.ts"), 'export { ACME_PLATE } from "./acme-plate.js";', 'export { ACME_PLATE } from "./acme-plate.js";\nexport { ACME_F14 } from "./acme-f14.js";');
    const listed = verify(["acme-sb-25", "--root", lib, "--no-typecheck", "--mate", "acme-plate,acme-f14"]);
    expect(listed.report.mates).toEqual(["mate acme-plate: verdict valid, 1 connection(s)", expect.stringMatching(/bolt_pattern/), expect.stringMatching(/^mate acme-f14: verdict \S+, 0 connection\(s\)$/)]);
    const all = verify(["acme-sb-25", "--root", lib, "--no-typecheck", "--all"]);
    expect(all.report.mates).toEqual(["mate acme-plate: verdict valid, 1 connection(s)", expect.stringMatching(/bolt_pattern/), "all mates: 2 part(s) tried, 1 form at least one connection"]);
  });
});

describe("coverage rules", () => {
  it("a passive mechanical part is not asked for an operating temperature; a threaded fluid port counts as mounting", () => {
    const lib = copy("coverage");
    edit(join(lib, "library/parts/acme-sb-25.ts"), '    { type: "operating_conditions", params: { operating_temperature_C: [-20, 60], source: SRC.drawing } },\n', "");
    let r = verify(["acme-sb-25", "--root", lib, "--no-typecheck"]);
    expect(messages(r.report.warnings, "coverage")).toEqual([]);

    write(join(lib, "library/parts/acme-f14.ts"), FITTING);
    write(join(lib, "library/parts/acme-f14/sources.json"), [{ id: "src", title: "ACME F-14 drawing", url: "https://example.com/acme-f14.pdf", type: "datasheet", authority: "manufacturer", supports: ["thread", "tube"] }]);
    edit(join(lib, "library/parts/index.ts"), 'export { ACME_PLATE } from "./acme-plate.js";', 'export { ACME_PLATE } from "./acme-plate.js";\nexport { ACME_F14 } from "./acme-f14.js";');
    r = verify(["acme-f14", "--root", lib, "--no-typecheck"]);
    expect(messages(r.report.warnings, "coverage")).toEqual([]);
    // a push-to-connect port alone is no mounting
    edit(join(lib, "library/parts/acme-f14.ts"), 'joint: { kind: "thread", standard: "NPT", size: "1/4", gender: "male" }', 'joint: { kind: "barb", tubeIdMm: 4 }');
    r = verify(["acme-f14", "--root", lib, "--no-typecheck"]);
    expect(messages(r.report.warnings, "coverage")).toEqual(["[coverage] no mechanical interfaces (mounting, shaft) — confirm this is intended"]);
  });

  it("the helpers behind them", () => {
    const mech = { id: "m", interfaces: [{ id: "a", domain: "mechanical", exposed: true, protocols: [] }] } as unknown as ModuleDef;
    expect(isPassiveMechanical(mech)).toBe(true);
    expect(isPassiveMechanical({ ...mech, interfaces: [...mech.interfaces, { id: "v", domain: "electrical", exposed: true, protocols: [] }] } as unknown as ModuleDef)).toBe(false);
    expect(isPassiveMechanical({ ...mech, domains: [{ domain: "electrical" }] } as unknown as ModuleDef)).toBe(false);
    expect(hasThreadJoint({ id: "t", domain: "pneumatic", exposed: true, protocols: [], traits: [{ type: "fluid_joint", params: { kind: "thread" } }] })).toBe(true);
    expect(hasThreadJoint({ id: "t", domain: "pneumatic", exposed: true, protocols: [], traits: [{ type: "fluid_joint", params: { kind: "push_to_connect" } }] })).toBe(false);
  });
});

describe("artifact files (PB-866)", () => {
  it("an artifact file that does not exist is an error, naming the interfaces that bind it; a large-file pointer counts", () => {
    const root = join(TMP, "files");
    rmSync(root, { recursive: true, force: true });
    write(join(root, "cad/body.glb"), "glb");
    write(join(root, "cad/big.step.blob.json"), { sha256: "0".repeat(64) });
    const def = {
      id: "x",
      interfaces: [{ id: "mesh", geometry: { refs: [{ kind: "artifact", artifact: "cad_if_mesh" }] } }, { id: "mount" }],
      artifacts: [
        { id: "cad_glb", name: "body", type: "3d_model", role: "body", filePath: "cad/body.glb" },
        { id: "cad_step", name: "body", type: "3d_model", role: "body", filePath: "cad/big.step" },
        { id: "cad_if_mesh", name: "mesh", type: "3d_model", role: "interface", interfaceId: "mesh", filePath: "cad/interfaces/mesh.glb" },
        { id: "cad_manifest", name: "manifest", type: "cad", role: "source", filePath: "cad/body.manifest.json" },
        { id: "art_datasheet", name: "data sheet", type: "datasheet", url: "https://example.com/x.pdf" },
      ],
    } as unknown as ModuleDef;
    expect(artifactFileIssues(def, root)).toEqual([
      "artifact cad_if_mesh: file cad/interfaces/mesh.glb does not exist (bound by interface mesh)",
      "artifact cad_manifest: file cad/body.manifest.json does not exist",
    ]);
  });
});

describe("free-text lint", () => {
  const base = {
    id: "acme-b1",
    name: "ACME B1 breakout",
    manufacturer: "ACME Industries",
    part_number: "B1",
    description: "A breakout.",
    interfaces: [],
    artifacts: [{ id: "cad_step", name: "body", type: "3d_model", role: "body", format: "step", filePath: "x.step", provenance: { generatedFrom: "cad_source", tool: "build123d" } }],
  } as unknown as ModuleDef;
  const rows = [{ id: "src", title: "ACME B1 product page", url: "https://www.acme.example/b1", type: "documentation" }];

  it("flags vendor-CAD wording on generated geometry, not negations or parts with a vendor model", () => {
    const def = {
      ...base,
      traits: [
        { type: "usage_note", params: { note: "Mounting holes are read from the ACME STEP. The header is 2.54 mm pitch." } },
        { type: "usage_note", params: { note: "ACME publishes no STEP; the body is generated from the board file." } },
        { type: "data_gap", params: { field: "manufacturer CAD", note: "vendor STEP not found" } },
      ],
    } as unknown as ModuleDef;
    expect(lintFreeText(def, rows, []).map((f) => f.message)).toEqual([
      'module.traits[0](usage_note).note: says "ACME STEP", but the part has no manufacturer CAD (its geometry is generated): "Mounting holes are read from the ACME STEP."',
    ]);
    // a vendor model in sources.json (kept internal, generated body bound) makes the wording legitimate
    expect(lintFreeText(def, [...rows, { id: "src_step", title: "ACME B1 STEP", url: "https://www.acme.example/b1.step", type: "cad" }], [])).toEqual([]);
  });

  it("flags generator references that are not this part's: a generator default, or one borrowed from another library part", () => {
    const manifest = (references: string[]) => [{ artifact: "cad_step", manifest: { generator: { function: "tht_axial", references } } }];
    // the part's own drawing, a standard, a component catalogue the part carries: fine
    expect(lintFreeText(base, rows, manifest(["ACME B1 drawing rev 2", "JEDEC MO-220 VQFN", "www.acme.example/b1 outline"]))).toEqual([]);
    expect(lintFreeText(base, rows, manifest(["Yageo CFR series carbon film resistor data sheet: CFR-25 L 6.3"])).map((f) => f.message)).toEqual([
      'cad_step manifest: generator reference names nothing of this part (ACME Industries B1) or its sources: "Yageo CFR series carbon film resistor data sheet: CFR-25 L 6.3" (a generator default? pass references= with this part\'s drawing)',
    ]);
    const borrowed = manifest(["TI RSM0032B (VQFN-32 4 x 4, e 0.4) (library part ti-lp5024rsm)"]);
    expect(lintFreeText(base, rows, borrowed).map((f) => f.message)).toEqual([expect.stringMatching(/^cad_step manifest: generator reference comes from library part ti-lp5024rsm/)]);
    const withAssumption = { ...base, traits: [{ type: "assumption", params: { field: "terminal size", note: "0.4 mm pitch terminals from ti-lp5024rsm's drawing (no own drawing)" } }] } as unknown as ModuleDef;
    expect(lintFreeText(withAssumption, rows, borrowed)).toEqual([]);
  });
});

describe("refetch", () => {
  it("re-downloads every sha256-pinned source and compares: match, changed file, differing page, failure, unpinned", async () => {
    const lib = copy("refetch");
    const body = (s: string) => new TextEncoder().encode(s);
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    write(join(lib, "library/parts/acme-sb-25/sources.json"), [
      { id: "same", url: "https://acme.example/sb-25.pdf", sha256: sha("drawing") },
      { id: "newer", url: "https://acme.example/sb-25.step", sha256: sha("old model") },
      { id: "page", url: "https://acme.example/sb-25", sha256: sha("<html>old</html>") },
      { id: "walled", url: "https://acme.example/sb-25-manual.pdf", sha256: sha("manual") },
      { id: "gone", url: "https://acme.example/gone.pdf", sha256: sha("x") },
      { id: "loose", url: "https://acme.example/notes" },
    ]);
    const served: Record<string, { status: number; body: string; contentType?: string }> = {
      "https://acme.example/sb-25.pdf": { status: 200, body: "drawing", contentType: "application/pdf" },
      "https://acme.example/sb-25.step": { status: 200, body: "new model", contentType: "application/octet-stream" },
      "https://acme.example/sb-25": { status: 200, body: "<html>new</html>", contentType: "text/html; charset=utf-8" },
      "https://acme.example/sb-25-manual.pdf": { status: 200, body: "<html>sign in</html>", contentType: "text/html" },
      "https://acme.example/gone.pdf": { status: 404, body: "" },
    };
    const fetched: string[] = [];
    const fetcher: Fetcher = async (url) => {
      fetched.push(url);
      const s = served[url];
      return { status: s.status, body: body(s.body), contentType: s.contentType };
    };
    const results = await refetchSources(partFiles(lib, "acme-sb-25", "library"), { fetcher });
    expect(fetched.sort()).toEqual(Object.keys(served).sort());
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ["same", "match"],
      ["newer", "changed"],
      ["page", "page"],
      ["walled", "failed"],
      ["gone", "failed"],
      ["loose", "unpinned"],
    ]);
    expect(results.find((r) => r.id === "walled")!.detail).toMatch(/a file URL answered with an HTML page/);
    expect(formatRefetch(results)[0]).toBe("refetch: 1 match, 1 changed, 1 page(s) differ, 2 failed, 1 unpinned");
  });
});

describe("the source step (PB-910): library parts ship their source, so it must pass UHD's lint", () => {
  it("passes a declarative part and its helpers; reports host access and stray imports at their line", async () => {
    const { lintPartSource } = await import("../lib/source-lint.ts");
    const dir = join(TMP, "source-lint");
    rmSync(dir, { recursive: true, force: true });
    write(join(dir, "library/parts/acme-lamp.ts"), 'import type { ModuleDef } from "@deltarobotics/uhd";\nimport { vin } from "./shared.js";\nexport const ACME_LAMP = { id: "acme-lamp", name: "Lamp", interfaces: [vin()] } as unknown as ModuleDef;\n');
    write(join(dir, "library/parts/shared.ts"), 'export const vin = () => ({ id: "vin", domain: "electrical", protocols: [{ type: "power" }] });\n');
    expect(lintPartSource(partFiles(dir, "acme-lamp", "library"))).toEqual([]);
    write(join(dir, "library/parts/shared.ts"), 'import { readFileSync } from "node:fs";\nexport const vin = () => ({ id: process.env.PIN ?? "vin", domain: "electrical", protocols: [{ type: "power" }] });\n');
    expect(lintPartSource(partFiles(dir, "acme-lamp", "library")).map((f) => f.message.replace(/ \(projects vendor.*$/, ""))).toEqual([
      'library/parts/shared.ts:1 SOURCE_IMPORT_FORBIDDEN: imports "node:fs"; library source imports only @deltarobotics/uhd and its own closure',
      "library/parts/shared.ts:2 SOURCE_FORBIDDEN: uses process",
    ]);
    // a project-researched part is not library source
    expect(lintPartSource(partFiles(dir, "acme-lamp", "project", "library/parts/acme-lamp.ts"))).toEqual([]);
  });
});
