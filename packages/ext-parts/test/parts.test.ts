/**
 * @protoboardai/ext-parts (PB-801): the part verification that UHD's
 * scripts/verify-part.ts and record-verification.ts did, now on both layouts:
 *   - library: library/parts/<id>.ts + library/parts/<id>/ (a fixture library
 *     here; the cloud part library has the same layout);
 *   - project: any local definition, evidence in parts/evidence/<id>/ (the
 *     quadcopter's bulk capacitor), through the script and the operations.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UHD_TAXONOMY } from "@deltarobotics/uhd";
import { afterAll, describe, expect, it } from "vitest";
import { detectLayout, partFiles } from "../lib/layout.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG = join(HERE, "..");
const REPO = join(PKG, "../..");
const QUAD = join(REPO, "examples/quadcopter-5in");
const CLI = join(REPO, "packages/cli/bin/protoboard.mjs");
const LIBRARY = join(HERE, "fixtures/library");
// its own folder: other test files here work in .tmp at the same time, and this one removes TMP when it ends
const TMP = join(HERE, ".tmp/parts");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const tsx = (script: string, args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(PKG, "scripts", script), ...args], { cwd: PKG, encoding: "utf8" });
// the typecheck step has its own tests (test/verify-extras.test.ts); here it would only add a tsc run per call
const verify = (args: string[]) => {
  const r = tsx("verify-part.ts", [...args, "--no-typecheck", "--json"]);
  return { status: r.status, report: r.stdout ? JSON.parse(r.stdout) : undefined, stderr: r.stderr };
};
const write = (file: string, data: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
};
const copy = (from: string, name: string, filter?: (src: string) => boolean) => {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(from, dir, { recursive: true, filter });
  return dir;
};
const copyQuad = (name: string) => copy(QUAD, name, (src) => !/[/\\](node_modules|\.protoboard|\.claude)$/.test(src) && !/[/\\]operations[/\\]/.test(src));
function pb(dir: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--format", "json", "--cwd", dir], { encoding: "utf8" });
  return { status: r.status, json: JSON.parse(r.stdout || "null") };
}
const messages = (fs: { check: string; message: string }[]) => fs.map((f) => `[${f.check}] ${f.message}`);

describe("layouts", () => {
  it("a project root and a library root are told apart, and each part's files follow its layout", () => {
    expect(detectLayout(QUAD)).toBe("project");
    expect(detectLayout(LIBRARY)).toBe("library");
    expect(detectLayout(HERE)).toBeUndefined();
    expect(partFiles("/p", "x", "project")).toMatchObject({ definition: "parts/local/x.uhd.ts", evidence: "parts/evidence/x", research: "parts/evidence/x/.research", artifacts: "parts/local/x" });
    expect(partFiles("/l", "x", "library")).toMatchObject({ definition: "library/parts/x.ts", evidence: "library/parts/x", research: "library/parts/x/.research", artifacts: "library/parts/x/artifacts" });
  });
});

describe("library layout", () => {
  it("a complete part passes, with pair DRC against a mate from the same library", () => {
    const { status, report } = verify(["acme-sb-25", "--root", LIBRARY, "--mate", "acme-plate"]);
    expect(status).toBe(0);
    expect(report).toMatchObject({ partId: "acme-sb-25", layout: "library", definition: "library/parts/acme-sb-25.ts", errors: [], warnings: [] });
    expect(report.mates).toEqual(["mate acme-plate: verdict valid, 1 connection(s)", expect.stringMatching(/^ {2}bolt_pattern +valid +1 sub-link\(s\)$/)]);
  });

  it("finds what is missing or wrong: sources, vocabulary (unless recorded as a gap), CAD frames", () => {
    const lib = copy(LIBRARY, "broken");
    const part = join(lib, "library/parts/acme-sb-25.ts");
    rmSync(join(lib, "library/parts/acme-sb-25/sources.json"));
    rmSync(join(lib, "library/parts/acme-sb-25/artifacts/cad/acme-sb-25.step"));
    writeFileSync(part, readFileSync(part, "utf8").replace('origin: [0, 0, 0], normal: [0, 0, -1]', 'origin: [3, 0, 0], normal: [0, 0, -1]').replace("tags: [\"fixture\", \"bracket\"],", "tags: [\"fixture\", \"bracket\"],\n  // TODO check the pattern"));
    let r = verify(["acme-sb-25", "--root", lib]);
    expect(r.status).toBe(1);
    expect(messages(r.report.errors)).toEqual([
      "[hygiene] file contains TODO/TBD/FIXME",
      "[citation] missing library/parts/acme-sb-25/sources.json",
      "[files] artifact cad_step: file library/parts/acme-sb-25/artifacts/cad/acme-sb-25.step does not exist (bound by interface mount)",
      "[cad] interface mount: hole 1 of the bolt pattern (frame + parameters) is 3.00 mm from the nearest CAD hole axis",
      "[cad] interface mount: hole 2 of the bolt pattern (frame + parameters) is 3.00 mm from the nearest CAD hole axis",
      "[cad] interface mount: hole 3 of the bolt pattern (frame + parameters) is 3.00 mm from the nearest CAD hole axis",
      "[cad] interface mount: hole 4 of the bolt pattern (frame + parameters) is 3.00 mm from the nearest CAD hole axis",
    ]);

    const vocab = copy(LIBRARY, "vocab");
    const plate = join(vocab, "library/parts/acme-sb-25.ts");
    writeFileSync(plate, readFileSync(plate, "utf8").replace("interfaces: [BoltPattern(", 'interfaces: [{ id: "servo_link", domain: "electrical", exposed: true, protocols: [{ type: "acme_bus", roles: ["peer"] }] }, BoltPattern('));
    r = verify(["acme-sb-25", "--root", vocab]);
    expect(messages(r.report.errors)).toEqual(['[vocabulary] interface servo_link: protocol type "acme_bus" is not in the vocabulary — record it in .research/gaps.json or use an existing type']);
    write(join(vocab, "library/parts/acme-sb-25/.research/gaps.json"), [{ type: "vocabulary", term: "acme_bus", note: "ACME's servo bus has no UHD protocol" }]);
    r = verify(["acme-sb-25", "--root", vocab]);
    expect(r.status).toBe(0);
    expect(messages(r.report.warnings)).toContain('[vocabulary] interface servo_link: protocol type "acme_bus" is not in the vocabulary (recorded in gaps.json)');
  });

  it("checks categories against UHD's taxonomy, with the library's own extension", () => {
    const lib = copy(LIBRARY, "categories");
    const part = join(lib, "library/parts/acme-sb-25.ts");
    writeFileSync(part, readFileSync(part, "utf8").replace('categories: ["mechanical.mounting"],', 'categories: ["structure", "mechanical..mounting", "x-acme.jigs"],'));
    let r = verify(["acme-sb-25", "--root", lib]);
    expect(r.status).toBe(1);
    expect(messages(r.report.errors)).toEqual([
      `[categories] "structure" is not in the uhd taxonomy ${UHD_TAXONOMY.version}; did you mean mechanical.structure?`,
      '[categories] "mechanical..mounting" is not a category path (dotted ids such as sensor.distance)',
      `[categories] "x-acme.jigs" is not in the uhd taxonomy ${UHD_TAXONOMY.version} (the x-acme extension is not loaded)`,
    ]);
    write(join(lib, "library/taxonomy.json"), { library: "acme", taxonomy: { id: "uhd", version: UHD_TAXONOMY.version }, categories: { "x-acme": { name: "Acme", children: { jigs: { name: "Jigs" } } } } });
    writeFileSync(part, readFileSync(part, "utf8").replace('"structure", "mechanical..mounting", ', ""));
    r = verify(["acme-sb-25", "--root", lib]);
    expect(messages(r.report.errors)).toEqual([]);
  });

  it("warns when a part's tags or interfaces point at a category it does not list (every category that fits)", () => {
    const lib = copy(LIBRARY, "category-hints");
    const part = join(lib, "library/parts/acme-sb-25.ts");
    writeFileSync(part, readFileSync(part, "utf8").replace('tags: ["fixture", "bracket"],', 'tags: ["fixture", "bracket", "frc", "breakout"],'));
    const r = verify(["acme-sb-25", "--root", lib]);
    expect(r.status).toBe(0);
    expect(messages(r.report.warnings).filter((m) => m.startsWith("[categories]"))).toEqual([
      '[categories] filed under one category (mechanical.mounting); also fits robotics.frc (tag "frc"); list every category that fits',
      '[categories] filed under one category (mechanical.mounting); also fits expansion.breakout (tag "breakout"); list every category that fits',
    ]);
    writeFileSync(part, readFileSync(part, "utf8").replace('categories: ["mechanical.mounting"],', 'categories: ["mechanical.mounting", "robotics.frc", "expansion.breakout"],'));
    expect(messages(verify(["acme-sb-25", "--root", lib]).report.warnings).filter((m) => m.startsWith("[categories]"))).toEqual([]);
  });

  it("a manufacturer or downloaded file needs a terms record (PB-863)", () => {
    const lib = copy(LIBRARY, "terms");
    const dir = join(lib, "library/parts/acme-sb-25");
    write(join(dir, "artifacts/cad/vendor/SB-25.STEP"), "ISO-10303-21; vendor model");
    write(join(dir, "artifacts/thumbnail.png"), "png");
    let r = verify(["acme-sb-25", "--root", lib]);
    expect(r.status).toBe(1);
    expect(messages(r.report.errors)).toEqual([
      "[terms] library/parts/acme-sb-25/artifacts/cad/vendor/SB-25.STEP: manufacturer or downloaded file with no terms record in library/parts/acme-sb-25/terms.json (distribution, licence or what was found, source URL, retrieval date)",
      "[terms] library/parts/acme-sb-25/artifacts/thumbnail.png: manufacturer or downloaded file with no terms record in library/parts/acme-sb-25/terms.json (distribution, licence or what was found, source URL, retrieval date)",
    ]);

    const step = "library/parts/acme-sb-25/artifacts/cad/vendor/SB-25.STEP";
    const sha = createHash("sha256").update("ISO-10303-21; vendor model").digest("hex");
    write(join(lib, "library/terms.json"), { schema: "protoboard.library-terms-presets/v1", presets: { library: { distribution: "redistributable", license: "LicenseRef-Acme-Library" } } });
    const record = {
      schema: "protoboard.library-terms/v1",
      files: {
        [step]: { distribution: "internal", license: "LicenseRef-Acme-Terms", summary: "own use only", sourceUrl: "https://acme.example/SB-25.STEP", retrieved: "2026-10-03", sha256: sha },
        "library/parts/acme-sb-25/artifacts/thumbnail.png": { distribution: "unknown", summary: "scraped photo; unverified" },
        "library/parts/acme-sb-25/artifacts/cad/acme-sb-25.manifest.json": { preset: "library" },
        "library/parts/acme-sb-25/artifacts/cad/acme-sb-25.step": { preset: "library" },
      },
      links: [{ title: "SB-25 model on a library site", url: "https://library.example/sb-25", kind: "3d_model", access: "account", terms: { distribution: "internal" } }],
    };
    write(join(dir, "terms.json"), record);
    r = verify(["acme-sb-25", "--root", lib]);
    expect(r.status).toBe(0);
    // the thumbnail's entry records no source; generated files only warn when left out
    expect(messages(r.report.warnings).filter((m) => m.startsWith("[terms]"))).toEqual([
      "[terms] library/parts/acme-sb-25/artifacts/thumbnail.png: terms record no sourceUrl, retrieved",
    ]);

    // the vendor file changed since its terms were written; a preset that does not exist
    write(join(dir, "artifacts/cad/vendor/SB-25.STEP"), "ISO-10303-21; a newer vendor model");
    write(join(dir, "terms.json"), { ...record, files: { ...record.files, "library/parts/acme-sb-25/artifacts/cad/acme-sb-25.manifest.json": { preset: "ours" } } });
    r = verify(["acme-sb-25", "--root", lib]);
    expect(messages(r.report.errors)).toEqual([
      `[terms] ${step}: the terms were recorded for other bytes (sha256 ${sha.slice(0, 12)}…); check the new file's terms and update the entry`,
      '[terms] library/parts/acme-sb-25/terms.json: library/parts/acme-sb-25/artifacts/cad/acme-sb-25.manifest.json: preset "ours" is not in library/terms.json',
    ]);

    // record fields: verified (here from a preset) and provenance stay in the record; an unverified entry is never redistributable
    write(join(dir, "artifacts/cad/vendor/SB-25.STEP"), "ISO-10303-21; vendor model");
    write(join(lib, "library/terms.json"), {
      schema: "protoboard.library-terms-presets/v1",
      presets: { library: { distribution: "redistributable", license: "LicenseRef-Acme-Library", verified: true }, "protopart-photo": { distribution: "unknown", summary: "scraped photo", verified: false } },
    });
    const photo = { preset: "protopart-photo", sourceUrl: "https://acme.example/sb-25.jpg", retrieved: "2026-04-08", provenance: { method: "protopart-import", from: "protoparts/acme-sb-25/thumbnail.png" } };
    write(join(dir, "terms.json"), { ...record, files: { ...record.files, "library/parts/acme-sb-25/artifacts/thumbnail.png": photo } });
    r = verify(["acme-sb-25", "--root", lib]);
    expect(messages(r.report.errors)).toEqual([]);
    // a render of a vendor body carries the body's terms and names the body, not a download source
    const render = { distribution: "internal", license: "LicenseRef-Acme-Terms", sha256: createHash("sha256").update("png").digest("hex"), provenance: { method: "cad-render", renderedFrom: { path: step } } };
    write(join(dir, "terms.json"), { ...record, files: { ...record.files, "library/parts/acme-sb-25/artifacts/thumbnail.png": render } });
    r = verify(["acme-sb-25", "--root", lib]);
    expect(messages(r.report.errors)).toEqual([]);
    expect(messages(r.report.warnings).filter((m) => m.startsWith("[terms]"))).toEqual([]);
    write(join(dir, "terms.json"), { ...record, files: { ...record.files, "library/parts/acme-sb-25/artifacts/thumbnail.png": { ...photo, distribution: "redistributable", provenance: "scraped" } } });
    expect(messages(verify(["acme-sb-25", "--root", lib]).report.errors)).toEqual([
      "[terms] library/parts/acme-sb-25/terms.json: library/parts/acme-sb-25/artifacts/thumbnail.png: an unverified entry cannot be redistributable",
      "[terms] library/parts/acme-sb-25/terms.json: library/parts/acme-sb-25/artifacts/thumbnail.png: provenance must be an object with a method",
    ]);
  });

  it("an unknown part or mate fails clearly", () => {
    const r = tsx("verify-part.ts", ["no-such-part", "--root", LIBRARY]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/error \[load\] No part file at library\/parts\/no-such-part\.ts/);
    expect(messages(verify(["acme-sb-25", "--root", LIBRARY, "--mate", "nope"]).report.errors)).toEqual(['[mate] no part "nope" to mate with']);
  });

  it("record-verification writes the evidence record from the audit and gaps", () => {
    const lib = copy(LIBRARY, "record");
    const research = join(lib, "library/parts/acme-sb-25/.research");
    const facts = [{ fact: "spacing", verdict: "confirmed" }, { fact: "hole", verdict: "confirmed" }, { fact: "temp", verdict: "unsupported" }];
    write(join(research, "audit.json"), { facts });
    write(join(research, "gaps.json"), [{ type: "data", field: "mass", reason: "not on the drawing" }, { type: "vocabulary", term: "acme_bus" }]);
    const record = join(lib, "library/parts/acme-sb-25/verification.json");
    // nobody said who audited: no record
    let r = tsx("record-verification.ts", ["acme-sb-25", "--root", lib]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/say who audited: pass --independent .* or --self-audit/);
    expect(existsSync(record)).toBe(false);
    r = tsx("record-verification.ts", ["acme-sb-25", "--root", lib, "--independent", "--self-audit"]);
    expect(r.status).toBe(2);

    r = tsx("record-verification.ts", ["acme-sb-25", "--root", lib, "--independent", "--auditor", "audit agent B", "--method", "re-fetched the drawing (sha256 match) and re-read each fact", "--repairs", "temperature source added"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("acme-sb-25: audit 2/3 (independent), 0 assumption(s), 1 data gap(s)");
    const v = JSON.parse(readFileSync(record, "utf8"));
    expect(v).toMatchObject({
      partId: "acme-sb-25",
      audit: { method: "re-fetched the drawing (sha256 match) and re-read each fact", independent: true, auditor: "audit agent B", checked: 3, confirmed: 2, wrong: 0, unsupported: 1 },
      repairs: "temperature source added",
      assumptions: [],
      data_gaps: ["mass (not on the drawing)"],
      vocabulary_gaps: ["acme_bus"],
    });

    // audit.json speaks for itself; a self-audit is recorded as one, with the default wording when it gives no method
    write(join(research, "audit.json"), { independent: false, auditor: "the authoring agent", facts });
    r = tsx("record-verification.ts", ["acme-sb-25", "--root", lib]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("acme-sb-25: audit 2/3 (self-audit), 0 assumption(s), 1 data gap(s)");
    expect(JSON.parse(readFileSync(record, "utf8")).audit).toMatchObject({ independent: false, auditor: "the authoring agent", method: expect.stringMatching(/^self-audit by the authoring agent, not independent/) });
    // a flag that contradicts audit.json, or an "independent" audit that describes a self-audit, writes nothing
    r = tsx("record-verification.ts", ["acme-sb-25", "--root", lib, "--independent"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/audit.json says independent: false, but the flag says --independent/);
    write(join(research, "audit.json"), { independent: true, method: "self-audit: key facts searched in the downloads", facts });
    r = tsx("record-verification.ts", ["acme-sb-25", "--root", lib]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/marked independent, but its method or auditor describes a self-audit/);
  });
});

describe("project layout", () => {
  it("the script verifies a local purchased part where the project declares it, with its evidence in parts/evidence", () => {
    const { status, report } = verify(["panasonic-eeu-fr1v471", "--root", QUAD]);
    expect(status).toBe(0);
    expect(report).toMatchObject({ layout: "project", definition: "parts/local/panasonic-eeu-fr1v471.uhd.ts", errors: [] });
    // the warnings its modelling notes explain
    expect(report.warnings.map((w: { check: string }) => w.check).sort()).toEqual(["cad", "connectors", "connectors", "coverage"]);
  });

  it("protoboard run part-verify: the same report through the project, pure (no operation record)", () => {
    const dir = copyQuad("verify-op");
    const { status, json } = pb(dir, ["run", "part-verify", "--input", "part=panasonic-eeu-fr1v471", "--input", "mate=dolphinrc-am32-60a-4in1-esc"]);
    expect(status).toBe(0);
    expect(json).toMatchObject({ status: "succeeded", summary: "panasonic-eeu-fr1v471: 0 errors, 4 warning(s)" });
    expect(json.data.mates[0]).toMatch(/^mate dolphinrc-am32-60a-4in1-esc: verdict /);
    const records = () => (existsSync(join(dir, "operations")) ? readdirSync(join(dir, "operations")) : []);
    expect(records()).toEqual([]);
    // a catalog part's evidence travels with its revision
    const catalog = pb(dir, ["run", "part-verify", "--input", "part=meps-neon-2207-v2-1950kv"]);
    expect(catalog.json).toMatchObject({ status: "failed", summary: expect.stringMatching(/is a catalog definition/) });
  });

  it("protoboard run part-verification writes parts/evidence/<id>/verification.json and records the operation", () => {
    const dir = copyQuad("record-op");
    write(join(dir, "parts/evidence/panasonic-eeu-fr1v471/.research/audit.json"), { summary: { checked: 14, confirmed: 14, wrong: 0, unsupported: 0 } });
    // the operation, like the script, will not guess who audited
    const unsaid = pb(dir, ["run", "part-verification", "--input", "part=panasonic-eeu-fr1v471"]);
    expect(unsaid.json).toMatchObject({ status: "failed", summary: expect.stringMatching(/say who audited/) });
    const { status, json } = pb(dir, ["run", "part-verification", "--input", "part=panasonic-eeu-fr1v471", "--input", "independent=true", "--input", "auditor=stage-2 agent"]);
    expect(status).toBe(0);
    expect(json.outputs.map((o: { path: string }) => o.path)).toEqual(["parts/evidence/panasonic-eeu-fr1v471/verification.json"]);
    // the refused run and the one that wrote the record
    expect(readdirSync(join(dir, "operations")).filter((f) => f.endsWith("-part-verification.json"))).toHaveLength(2);
    const v = JSON.parse(readFileSync(join(dir, "parts/evidence/panasonic-eeu-fr1v471/verification.json"), "utf8"));
    expect(v).toMatchObject({ partId: "panasonic-eeu-fr1v471", audit: { independent: true, auditor: "stage-2 agent", checked: 14, confirmed: 14 }, repairs: null });
    expect(v.assumptions.length).toBe(2);
  });
});
