/**
 * The project's statement of its product (PB-935): docs/product.json, the
 * brief's requirements table when the file states none, and what is said
 * to be missing rather than made up.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { briefRequirements, productProblems, readProduct } from "../src/product.js";

const EXAMPLES = fileURLToPath(new URL("../../../examples", import.meta.url));
let tmp: string | undefined;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});
function project(files: Record<string, string>): string {
  tmp = mkdtempSync(join(tmpdir(), "pb-product-"));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(tmp, f, ".."), { recursive: true });
    writeFileSync(join(tmp, f), text);
  }
  return tmp;
}
const file = (o: object) => JSON.stringify({ schema: "protoboard.product/v0", ...o });

describe("docs/product.json", () => {
  it("states the summary, features, functions and requirements", () => {
    const p = readProduct(project({ "docs/product.json": file({ summary: " A lamp. ", features: ["Dims", " "], functions: [{ id: "F1", text: "Lights", by: "the LED" }], requirements: [{ id: "R1", text: "500 lm", how: "Measure with a lux meter", pass: "≥ 500 lm" }] }) }));
    expect(p).toEqual({
      file: true,
      summary: "A lamp.",
      features: ["Dims"],
      functions: [{ id: "F1", text: "Lights", by: "the LED" }],
      requirements: [{ id: "R1", text: "500 lm", how: "Measure with a lux meter", pass: "≥ 500 lm" }],
      requirementsFrom: "docs/product.json",
      functionsFrom: "docs/product.json",
      missing: [],
      problems: [],
    });
  });

  it("says what is not stated: no file, an empty file, empty members", () => {
    expect(readProduct(project({ "src/x.ts": "" }))).toMatchObject({ file: false, missing: ["summary", "features", "functions", "requirements"], problems: [] });
    const empty = readProduct(project({ "docs/product.json": file({ summary: "", features: [], functions: [], requirements: [] }) }));
    expect(empty).toMatchObject({ file: true, missing: ["summary", "features", "functions", "requirements"], problems: [] });
    expect(empty.summary).toBeUndefined();
    expect(readProduct(project({ "docs/product.json": file({ summary: "A lamp." }) })).missing).toEqual(["features", "functions", "requirements"]);
  });

  it("takes the requirements from the brief's table when the file states none, and never from prose", () => {
    const brief = ["# Lamp: brief", "", "It should be bright and not too hot.", "", "- bullets are for the test plan, not this page", "", "## Functions", "", "| ID | Function |", "| --- | --- |", "| F1 | Lights |", "", "## Requirements", "", "| ID | Requirement | How | Pass | Record |", "| --- | --- | --- | --- | --- |", "| R1 | 500 lm | Lux meter at 1 m | ≥ 500 lm | the reading |", ""].join("\n");
    const p = readProduct(project({ "docs/brief.md": brief, "docs/product.json": file({ summary: "A lamp.", features: ["Dims"], functions: [{ id: "F1", text: "Lights" }] }) }));
    expect(p.requirements).toEqual([{ id: "R1", text: "500 lm", how: "Lux meter at 1 m", pass: "≥ 500 lm", record: "the reading" }]);
    expect(p.requirementsFrom).toBe("docs/brief.md");
    expect(p.missing).toEqual([]);
    // the file's own requirements win, and the brief is then not read
    const own = readProduct(project({ "docs/brief.md": brief, "docs/product.json": file({ requirements: [{ text: "Stays under 60 °C" }] }) }));
    expect(own.requirements).toEqual([{ text: "Stays under 60 °C" }]);
    expect(own.requirementsFrom).toBe("docs/product.json");
    // with no functions in the file, the brief's Functions table states them (and what does each); they are not requirements too
    const fromBrief = readProduct(project({ "docs/brief.md": brief.replace("| ID | Function |\n| --- | --- |\n| F1 | Lights |", "| ID | Function | Hardware |\n| --- | --- | --- |\n| F1 | Lights | One LED |") }));
    expect(fromBrief.functions).toEqual([{ id: "F1", text: "Lights", by: "One LED" }]);
    expect(fromBrief.functionsFrom).toBe("docs/brief.md");
    expect(fromBrief.requirements.map((r) => r.id)).toEqual(["R1"]);
    expect(fromBrief.missing).toEqual(["summary", "features"]);
    // a brief of prose and bullets states no requirements for the page
    expect(readProduct(project({ "docs/brief.md": "# Lamp\n\nBright.\n\n- 500 lm\n" })).missing).toContain("requirements");
    // a table that does not say how a row is shown: the row is a requirement, its method is not stated (and not guessed here)
    const targets = readProduct(project({ "docs/brief.md": "# Lamp\n\n## Targets\n\n| Target | Value |\n| --- | --- |\n| Mass | ≤ 40 g |\n" }));
    expect(targets.requirements).toEqual([{ text: "Mass: ≤ 40 g" }]);
  });

  it("does not use a malformed file, and says what is wrong", () => {
    expect(productProblems([])).toEqual(["not a protoboard.product/v0 file"]);
    expect(productProblems({ schema: "protoboard.product/v0", summary: 3, features: "x", functions: [{ id: "F1" }], requirements: [{ id: "R1", text: "a" }, { id: "R1", text: "b", how: 2 }] })).toEqual([
      "summary must be text",
      "features must be a list of text lines",
      "functions[0] needs text",
      "requirements[1].how must be text",
      "requirements: the id R1 is used twice",
    ]);
    const bad = readProduct(project({ "docs/product.json": "{" }));
    expect(bad.file).toBe(true);
    expect(bad.problems[0]).toMatch(/^not JSON/);
    expect(bad.missing).toEqual(["summary", "features", "functions", "requirements"]);
  });

  it("the brief's parser says where each requirement stands", () => {
    const r = briefRequirements("# B\n\n- top bullet\n\n## Targets\n\n| Target | Value |\n| --- | --- |\n| Mass | ≤ 40 g |\n");
    expect(r.map((x) => [x.from, x.section, x.text])).toEqual([["bullet", "B", "top bullet"], ["table", "Targets", "Mass: ≤ 40 g"]]);
  });

  it("the reference projects state their product; the one without a brief does not", () => {
    for (const e of ["quadcopter-5in", "smart-bottle", "wearable-watch"]) {
      const p = readProduct(join(EXAMPLES, e));
      expect([e, p.problems, p.missing]).toEqual([e, [], []]);
      expect(p.functions.length).toBeGreaterThan(3);
      expect(p.requirementsFrom).toBe("docs/brief.md");
    }
    expect(readProduct(join(EXAMPLES, "uno-motor-bench")).missing).toEqual(["summary", "features", "functions", "requirements"]);
  });
});
