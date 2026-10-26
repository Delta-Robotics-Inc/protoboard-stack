/**
 * ENCLOSURE_GENERATOR_STALE (PB-809): the check recomputes the generator's
 * sourceDigest (py/enclosure_cad.py, py/fit.py and Python's json.dumps of the
 * job) without running Python, so a design built by an older generator is
 * flagged, and release refuses it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATOR_FILES, generatorSourceDigest } from "../lib/check.ts";
import { pyJsonDumps } from "../lib/pyjson.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DESIGNS = ["examples/wearable-watch/src/enclosures/watch-case/build123d/watch-case", "examples/smart-bottle/src/enclosures/bottle-cap/build123d/bottle-cap-enclosure"];
const python = (() => {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("generator digest", () => {
  it("pyJsonDumps writes what Python's json.dumps(sort_keys=True) writes", () => {
    const value = { b: [1, -2, 0.5, 1e-5, 1.25e-7, 123456789.125, 1e16, 2.5e21, -0.0001, 3.0e-4], a: { "é ×": "tab\tquote\"back\\slash\u0001\u007f😀", z: null, y: true }, n: 12345678901234567 };
    expect(pyJsonDumps(value)).toBe(
      '{"a": {"y": true, "z": null, "\\u00e9 \\u00d7": "tab\\tquote\\"back\\\\slash\\u0001\\u007f\\ud83d\\ude00"}, "b": [1, -2, 0.5, 1e-05, 1.25e-07, 123456789.125, 10000000000000000, 2.5e+21, -0.0001, 0.0003], "n": 12345678901234568}',
    );
    if (!python) return;
    const dir = mkdtempSync(join(tmpdir(), "pb-pyjson-"));
    try {
      const file = join(dir, "v.json");
      writeFileSync(file, JSON.stringify(value));
      expect(execFileSync("python3", ["-c", "import json,sys; sys.stdout.write(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))", file], { encoding: "utf8" })).toBe(pyJsonDumps(value));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(python)("matches Python on the committed jobs", () => {
    for (const d of DESIGNS) {
      const file = join(ROOT, `${d}.job.json`);
      expect(pyJsonDumps(JSON.parse(readFileSync(file, "utf8"))), d).toBe(execFileSync("python3", ["-c", "import json,sys; sys.stdout.write(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))", file], { encoding: "utf8", maxBuffer: 1 << 28 }));
    }
  });

  it("every committed enclosure design was built by this generator (regenerate it when this fails)", () => {
    for (const d of DESIGNS) {
      const job = JSON.parse(readFileSync(join(ROOT, `${d}.job.json`), "utf8"));
      const report = JSON.parse(readFileSync(join(ROOT, `${d}.report.json`), "utf8"));
      expect(generatorSourceDigest(job), d).toBe(report.sourceDigest);
    }
    // and a change to the generator changes the digest
    const dir = mkdtempSync(join(tmpdir(), "pb-gen-"));
    try {
      const copy = join(dir, "enclosure_cad.py");
      writeFileSync(copy, readFileSync(GENERATOR_FILES[0], "utf8") + "\n# edited\n");
      const job = JSON.parse(readFileSync(join(ROOT, `${DESIGNS[0]}.job.json`), "utf8"));
      expect(generatorSourceDigest(job, [copy, GENERATOR_FILES[1]])).not.toBe(generatorSourceDigest(job));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
