/**
 * `protoboard board import | check | describe | render` on the tracked synthetic sample (Airnode C3, a KiCad board):
 * the import writes the board, its zone fill and the import record; check runs the checks and, when kicad-cli is
 * installed, KiCad's DRC beside them (the test holds either way); describe writes the agent scene with the checks'
 * connectivity; render skips cleanly when no Chrome-family browser is found.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { boardCommand } from "../src/board.js";
import { boardTools } from "../src/mcp/board-tools.js";
import type { CliRun, ToolContext } from "../src/mcp/tools.js";

const SAMPLE = fileURLToPath(new URL("../../ext-tscircuit/test/fixtures/pcb-regression/airnode-c3/airnode-c3.kicad_pcb", import.meta.url));

async function run(argv: string[], cwd: string): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const code = await boardCommand(argv, { cwd, env: {}, write: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}
const json = async (argv: string[], cwd: string) => {
  const r = await run([...argv, "--json"], cwd);
  return { code: r.code, data: JSON.parse(r.stdout) as Record<string, any> };
};

const ctx = (cwd: string): ToolContext => ({
  dir: async (given) => (given ? join(given) : cwd),
  cli: (dir, args) => run(args.slice(1), dir),
  cliFor: () => ({ entry: "in-process", from: "server" }),
  version: "test",
  about: "",
  clientName: () => "analysis-test",
});
const tool = (name: string) => boardTools().find((t) => t.name === name)!;

let root: string;
let dir: string;
let imported: Record<string, any>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "pb-board-analysis-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  mkdirSync(join(root, "src"));
  copyFileSync(SAMPLE, join(root, "src", "airnode-c3.kicad_pcb"));
  dir = join(root, "airnode", "board");
  const r = await json(["import", join(root, "src", "airnode-c3.kicad_pcb"), dir], root);
  expect(r.code).toBe(0);
  imported = r.data;
}, 120_000);

describe("board import", () => {
  it("writes the board, its zone fill and the import record, and reports what it dropped", () => {
    expect(imported).toMatchObject({ importer: "kicad", status: "written" });
    expect(existsSync(join(dir, "board.jsonl"))).toBe(true);
    expect(imported.stats).toMatchObject({ footprints: expect.any(Number), pads: expect.any(Number), nets: expect.any(Number) });
    expect(imported.stats.footprints).toBeGreaterThan(0);
    expect(imported.offset).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    expect(existsSync(imported.fill.path)).toBe(true);
    const record = JSON.parse(readFileSync(imported.importRecord, "utf8"));
    expect(record).toMatchObject({ schema: "protoboard.board-import/v1", importer: "kicad", source: join(root, "src", "airnode-c3.kicad_pcb"), offset: imported.offset });
    // every report line is counted under its level
    expect(imported.levels.dropped + imported.levels.approximated + imported.levels.info).toBe(imported.report.length);
    expect(imported.ms.import).toBeGreaterThanOrEqual(0);
  });

  it("refuses a folder that already holds a board, and says so in text", async () => {
    const r = await run(["import", join(root, "src", "airnode-c3.kicad_pcb"), dir], root);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/already holds a board/);
  });

  it("prints the report for people", async () => {
    const r = await run(["import", join(root, "src", "airnode-c3.kicad_pcb"), join(root, "second")], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^WRITTEN {2}kicad: /);
    expect(r.stdout).toMatch(/report: \d+ dropped/);
    for (const line of imported.report.filter((x: { level: string }) => x.level === "dropped")) expect(r.stdout).toContain(line.message);
  });
});

describe("board check", () => {
  it("gives the findings, the status line and the cross-check (or why it did not run)", async () => {
    const r = await json(["check", dir], root);
    const d = r.data;
    expect(d.summary.line).toMatch(/^\d+ unconnected, \d+ errors?, \d+ warnings?/);
    expect(d.summary.unconnected).toBe(d.connectivity.unconnected);
    expect(Array.isArray(d.findings)).toBe(true);
    expect(d.fill).toMatchObject({ source: "kicad", current: true });
    expect(d.importRecord.importer).toBe("kicad");
    expect(r.code).toBe(d.findings.some((f: { severity: string }) => f.severity === "error") ? 1 : 0);
    if (d.crossCheck.ran) {
      // kicad-cli is installed: KiCad's counts stand beside ours, every difference named
      expect(d.crossCheck.totals.ours.unconnected).toBe(d.summary.unconnected);
      expect(d.crossCheck.totals.kicad).toMatchObject({ unconnected: expect.any(Number), errors: expect.any(Number), warnings: expect.any(Number) });
      expect(Array.isArray(d.crossCheck.differences)).toBe(true);
      expect(d.ms.kicad).toBeGreaterThan(0);
    } else expect(d.crossCheck.reason).toMatch(/kicad-cli|KiCad/);
  }, 120_000);

  it("--no-cross-check says why there is none, in text after the status line", async () => {
    const r = await run(["check", dir, "--no-cross-check"], root);
    const lines = r.stdout.trim().split("\n");
    expect(lines.at(-2)).toMatch(/^ours: {2}\d+ unconnected/);
    expect(lines.at(-1)).toBe("KiCad cross-check not run: turned off (--no-cross-check)");
    expect(r.stdout).toMatch(/^zone fill: kicad/m);
  });

  it("prints each finding in plain language, the ids left to --json", async () => {
    const r = await run(["check", dir, "--no-cross-check"], root);
    const lines = r.stdout.split("\n").filter((l) => /^(ERROR|WARNING|INFO) /.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).toMatch(/^(ERROR|WARNING|INFO) +[a-z][a-z -]+: \S.*\. {2}at \(-?[\d.]+, -?[\d.]+\) mm$/);
      expect(l).not.toMatch(/\b(pad|trk|via|fp|rule|zone|kpo):[\w./~+-]/);
    }
    expect(r.stdout).toContain("(finding, object and rule ids: --json)");
  });

  it("refuses contradictory and missing flags", async () => {
    expect((await run(["check", dir, "--no-cross-check", "--kicad", join(root, "src", "airnode-c3.kicad_pcb")], root)).code).toBe(2);
    expect((await run(["check", dir, "--kicad", join(root, "nothing.kicad_pcb")], root)).code).toBe(2);
  });
});

describe("board describe", () => {
  it("writes the overview scene and its image, with the checks' connectivity", async () => {
    const { code, data } = await json(["describe", dir], root);
    expect(code).toBe(0);
    expect(data.focus).toBe("overview");
    expect(data.scene.schema).toBe("protoboard.board-scene/v1");
    expect(data.scene.detail).toBe("overview");
    expect(String(data.scene.connectivity)).toMatch(/checks/);
    expect(data.checks.line).toMatch(/unconnected/);
    expect(JSON.parse(readFileSync(data.files.json, "utf8"))).toEqual(data.scene);
    expect(data.files.json).toContain(join(".protoboard", "build", "board", "airnode__board", "describe-overview.json"));
    if (data.files.png) expect(readFileSync(data.files.png).subarray(1, 4).toString()).toBe("PNG");
    else expect(data.notes.join(" ")).toMatch(/PNG output is not available/);
  });

  it("takes one focus: a net, a region in millimeters, an object, a finding", async () => {
    const check = (await json(["check", dir, "--no-cross-check"], root)).data;
    const net = (await json(["describe", dir, "--net", "GND", "--image", "none"], root)).data;
    expect(net.focus).toEqual({ net: "GND" });
    expect(net.files.png).toBeUndefined();
    const region = (await json(["describe", dir, "--region", "-10,-5,10,5", "--image", "none"], root)).data;
    expect(region.focus).toEqual({ region: [-10, -5, 10, 5] });
    expect(region.scene.view.box[0]).toBeLessThanOrEqual(-10);
    const fp = (await json(["query", dir, "--region", "-20mm,-15mm,20mm,15mm", "--kinds", "footprint"], root)).data.items[0].id as string;
    expect((await json(["describe", dir, "--object", fp, "--image", "none"], root)).data.focus).toEqual({ object: fp });
    if (check.findings.length) {
      const f = check.findings[0].id;
      const d = (await json(["describe", dir, "--finding", f, "--image", "none"], root)).data;
      expect(d.focus).toEqual({ finding: f });
      expect(d.scene.detail).toBe("object");
    }
    expect((await run(["describe", dir, "--net", "GND", "--region", "0,0,1,1"], root)).code).toBe(2);
    expect((await run(["describe", dir, "--finding", "f:nothing:000000000000"], root)).code).toBe(2);
  });

  it("prints a path summary without --json", async () => {
    const r = await run(["describe", dir, "--image", "none", "--out", join(root, "out", "scene")], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`wrote ${join(root, "out", "scene.json")}`);
    expect(r.stdout).toMatch(/scene: overview detail, the whole board/);
  });
});

describe("board render", () => {
  it("draws a PNG with the board's fill, ratsnest and findings, or says the renderer is not available", async (t) => {
    const out = join(root, "render.png");
    const { code, data } = await json(["render", dir, "--out", out, "--width", "400", "--height", "300", "--region", "-20mm,-15mm,20mm,15mm", "--net", "GND"], root);
    if (data.status === "not-available") {
      expect(code).toBe(2);
      t.skip();
    }
    expect(code).toBe(0);
    expect(data).toMatchObject({ status: "written", file: out, width: 400, height: 300, highlightNets: ["GND"] });
    expect(data.ratsnest).toBeGreaterThan(0);
    expect(readFileSync(out).subarray(1, 4).toString()).toBe("PNG");
  }, 120_000);

  it("refuses a net the board does not have", async () => {
    expect((await run(["render", dir, "--net", "NO_SUCH_NET"], root)).code).toBe(2);
  });
});

describe("the MCP tools", () => {
  it("board_check and board_describe run the commands as the agent; board_describe can return its PNG", async () => {
    const c = ctx(root);
    const check = await tool("board_check").handler({ dir, crossCheck: false } as never, c);
    expect((check.data as { summary: { line: string } }).summary.line).toMatch(/unconnected/);
    expect((check.data as { crossCheck: { reason: string } }).crossCheck.reason).toMatch(/turned off/);
    const d = await tool("board_describe").handler({ dir, region: [-10, -5, 10, 5], image: true } as never, c);
    expect((d.data as { focus: unknown }).focus).toEqual({ region: [-10, -5, 10, 5] });
    if ((d.data as { files: { png?: string } }).files.png) expect(d.images?.[0].mimeType).toBe("image/png");
    const two = await tool("board_describe").handler({ dir, net: "GND", object: "fp:x" } as never, c);
    expect(two.isError).toBe(true);
  });

  it("board_import imports into a new folder", async () => {
    const target = join(root, "via-mcp");
    const r = await tool("board_import").handler({ source: join(root, "src", "airnode-c3.kicad_pcb"), dir: target } as never, ctx(root));
    expect(r.isError).toBeFalsy();
    expect((r.data as { status: string; importer: string }).status).toBe("written");
    expect(existsSync(join(target, "board.jsonl"))).toBe(true);
  });
});
