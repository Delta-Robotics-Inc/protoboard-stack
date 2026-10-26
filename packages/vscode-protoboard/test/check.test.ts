/**
 * `protoboard check --format json` → Problems panel entries: paths, 1-based
 * lines, diagnostics without a location, counts, and the real CLI's output on
 * the quadcopter example placed in files that exist, on lines they have.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFIG_FILE, countDiagnostics, mapDiagnostics, parseCheck, problemSource, skippedChecks, statusText, type CheckOutput } from "../src/check.js";
import { parseJsonOutput, resolveCli, runCli } from "../src/cli.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const ROOT = "/work/project";

const out: CheckOutput = {
  checks: [
    { validator: "uhd/checkSystem", status: "ran", counts: { error: 1, warning: 0, info: 1 } },
    { validator: "ext:@protoboardai/ext-tscircuit/check", subject: "watch-mainboard", status: "skipped", reason: "tscircuit is not installed", counts: { error: 0, warning: 0, info: 0 } },
  ],
  diagnostics: [
    { code: "UHD_LINK_STATE", severity: "error", entity: { kind: "link", id: "gnss_uart" }, message: "tx meets tx", source: { file: "src/quadcopter.uhd.ts", line: 50 }, validator: "uhd/checkSystem" },
    { code: "PB_ARTIFACT_UNAVAILABLE", severity: "warning", entity: { kind: "artifact", id: "m9n#step" }, message: "not carried", source: { file: "parts/catalog/m9n.json" }, validator: "protoboard/artifacts" },
    { code: "PB_NO_ROOT", severity: "info", entity: { kind: "project", id: "quad" }, message: "no root", validator: "protoboard/resolve" },
  ],
};

describe("check diagnostics → Problems", () => {
  it("places each diagnostic at its source, 0-based, with the validator as source", () => {
    const m = mapDiagnostics(ROOT, out);
    expect([...m.keys()]).toEqual([join(ROOT, "src/quadcopter.uhd.ts"), join(ROOT, "parts/catalog/m9n.json"), join(ROOT, CONFIG_FILE)]);
    expect(m.get(join(ROOT, "src/quadcopter.uhd.ts"))![0]).toMatchObject({ line: 49, severity: "error", code: "UHD_LINK_STATE", source: "protoboard uhd/checkSystem", message: "tx meets tx", unlocated: false });
    // a file without a line: its first line
    expect(m.get(join(ROOT, "parts/catalog/m9n.json"))![0]).toMatchObject({ line: 0, unlocated: false });
    // no source at all: on the project configuration, marked so the entity is named
    expect(m.get(join(ROOT, CONFIG_FILE))![0]).toMatchObject({ line: 0, unlocated: true, entity: { kind: "project", id: "quad" } });
  });

  it("covers the line's text, without its indentation", () => {
    const m = mapDiagnostics(ROOT, out, (file, line) => (file.endsWith(".uhd.ts") && line === 49 ? "    children: [arm_fl, arm_fr],  " : undefined));
    expect(m.get(join(ROOT, "src/quadcopter.uhd.ts"))![0]).toMatchObject({ startCharacter: 4, endCharacter: 31 });
    // unreadable file: a short range at the line start
    expect(m.get(join(ROOT, "parts/catalog/m9n.json"))![0]).toMatchObject({ startCharacter: 0, endCharacter: 1 });
  });

  it("names the validator once in the Problems panel's source column", () => {
    expect(problemSource("protoboard/artifacts")).toBe("protoboard/artifacts");
    expect(problemSource("uhd/checkSystem")).toBe("protoboard uhd/checkSystem");
    expect(problemSource("ext:@protoboardai/ext-hardware/evidence")).toBe("@protoboardai/ext-hardware/evidence");
    expect(problemSource("ext:@acme/ext-thermal/check")).toBe("protoboard @acme/ext-thermal/check");
  });

  it("keeps absolute source paths", () => {
    const abs = { ...out, diagnostics: [{ ...out.diagnostics[0], source: { file: "/elsewhere/part.uhd.ts", line: 3 } }] };
    expect([...mapDiagnostics(ROOT, abs).keys()]).toEqual(["/elsewhere/part.uhd.ts"]);
  });

  it("counts by severity and lists validators that did not run", () => {
    expect(countDiagnostics(out)).toEqual({ error: 1, warning: 1, info: 1 });
    expect(skippedChecks(out)).toEqual(["ext:@protoboardai/ext-tscircuit/check [watch-mainboard]: tscircuit is not installed"]);
    // the name with one mark; the counts are VS Code's own Problems item's and the tooltip's
    expect(statusText({ error: 1, warning: 1, info: 1 }, "idle")).toBe("$(protoboard-logo) Protoboard $(error)");
    expect(statusText({ error: 0, warning: 2, info: 1 }, "idle")).toBe("$(protoboard-logo) Protoboard $(warning)");
    expect(statusText({ error: 0, warning: 0, info: 3 }, "idle")).toBe("$(protoboard-logo) Protoboard $(pass)");
    expect(statusText(undefined, "idle")).toBe("$(protoboard-logo) Protoboard");
    expect(statusText(undefined, "running")).toContain("sync~spin");
  });

  it("refuses output that is not a check result, and reports the CLI's own failure", () => {
    expect(() => parseCheck({ diagnostics: [] })).toThrow(/without checks and diagnostics/);
    expect(() => parseJsonOutput({ code: 2, stdout: '{"error":"no protoboard.config.ts in /x or its parents"}\n', stderr: "" }, "protoboard check")).toThrow(
      "protoboard check: no protoboard.config.ts in /x or its parents",
    );
    expect(() => parseJsonOutput({ code: 1, stdout: "", stderr: "SyntaxError: Unexpected token\n    at x.ts:3" }, "protoboard check")).toThrow(/printed no JSON \(exit 1\): SyntaxError/);
  });

  it("maps the real CLI's check of the quadcopter onto files and lines that exist", async () => {
    const root = join(REPO, "examples", "quadcopter-5in");
    const cli = resolveCli(root);
    expect(cli.from).toBe("project");
    const r = await runCli(cli, ["check", "--format", "json"], { cwd: root });
    const check = parseCheck(parseJsonOutput(r, "protoboard check"));
    expect(check.diagnostics.length).toBeGreaterThan(0);
    const lines = (f: string) => readFileSync(f, "utf8").split("\n");
    const mapped = mapDiagnostics(root, check, (f, l) => (existsSync(f) ? lines(f)[l] : undefined));
    for (const [file, list] of mapped) {
      expect(existsSync(file), file).toBe(true);
      for (const d of list) expect(d.line, `${file}:${d.line + 1}`).toBeLessThan(lines(file).length);
    }
    expect([...mapped.values()].flat().length).toBe(check.diagnostics.length);
  });
});
