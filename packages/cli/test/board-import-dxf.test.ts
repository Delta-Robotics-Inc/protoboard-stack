/**
 * `protoboard board import-dxf` and the MCP `board_import_dxf` tool (PCB editor Phase 2): a DXF drawing becomes the
 * board outline through one `outline.import_dxf` operation, on a copy of the Airnode C3 fixture.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { boardCommand } from "../src/board.js";
import { boardTools } from "../src/mcp/board-tools.js";
import type { CliRun, ToolContext } from "../src/mcp/tools.js";

const FIXTURE = fileURLToPath(new URL("../../board/test/fixtures/airnode-c3/", import.meta.url));

/** An ASCII DXF from group code and value pairs. */
const dxf = (entities: string[], insunits = "4") => [...["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", insunits, "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"], ...entities, "0", "ENDSEC", "0", "EOF"].join("\n") + "\n";
/** A 50 x 30 mm rectangle (one closed LWPOLYLINE) and a 3 mm hole inside it. */
const RECT = dxf(["0", "LWPOLYLINE", "8", "OUTLINE", "90", "4", "70", "1", "10", "0", "20", "0", "10", "50", "20", "0", "10", "50", "20", "30", "10", "0", "20", "30", "0", "CIRCLE", "8", "HOLES", "10", "10", "20", "10", "40", "1.5", "0", "TEXT", "8", "NOTES", "10", "0", "20", "0", "1", "a note"]);
/** Two lines that close nothing. */
const OPEN = dxf(["0", "LINE", "8", "OUTLINE", "10", "0", "20", "0", "11", "10", "21", "0", "0", "LINE", "8", "OUTLINE", "10", "10", "20", "0", "11", "10", "21", "10"]);

function project() {
  const root = mkdtempSync(join(tmpdir(), "pb-board-dxf-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "board");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(join(root, "rect.dxf"), RECT);
  writeFileSync(join(root, "open.dxf"), OPEN);
  return { root, dir };
}

async function run(argv: string[], cwd: string): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const code = await boardCommand(argv, { cwd, env: {}, write: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

const outlineLine = (dir: string) => readFileSync(join(dir, "board.jsonl"), "utf8").split("\n").find((l) => l.includes('"kind":"outline"'))!;

describe("board import-dxf", () => {
  it("sets the outline and cutouts from the drawing and prints the report", async () => {
    const { root, dir } = project();
    const r = await run(["import-dxf", dir, "rect.dxf", "--json"], root);
    const d = JSON.parse(r.stdout);
    expect(d.status, r.stdout).toBe("applied");
    expect(r.code).toBe(0);
    expect(d.report).toMatchObject({ entities: 2, loops: 2, cutouts: 1, open: 0, units: "mm", outline: { vertices: 4, area: 1500e12 } });
    expect(d.report.skipped).toEqual([expect.objectContaining({ type: "TEXT", count: 1 })]);
    // centered on the origin: corners at +-25 mm, +-15 mm
    expect(outlineLine(dir)).toContain('{"x":-25000000,"y":-15000000}');
    expect(readFileSync(join(dir, "board.jsonl"), "utf8") + readFileSync(join(dir, "placement.jsonl"), "utf8")).toMatch(/cutout:dxf\.1/);
  });

  it("prints for a person, takes --layers, --units and --tolerance, and refuses a drawing that closes nothing", async () => {
    const { root, dir } = project();
    const text = await run(["import-dxf", dir, "rect.dxf", "--layers", "OUTLINE", "--units", "mm", "--tolerance", "0.01mm"], root);
    expect(text.code, text.stdout + text.stderr).toBe(0);
    expect(text.stdout).toMatch(/^APPLIED/);
    expect(text.stdout).toMatch(/read: 1 entity in mm, 1 closed loop\(s\), 0 open chain\(s\)/);
    expect(text.stdout).toMatch(/outline: 4 vertices, 1500 mm²; cutouts: 0/);
    expect(text.stdout).toMatch(/SKIPPED/);
    const before = outlineLine(dir);
    const open = await run(["import-dxf", dir, "open.dxf", "--json"], root);
    expect(JSON.parse(open.stdout).status).toBe("invalid");
    expect(open.code).toBe(1);
    expect(outlineLine(dir)).toBe(before);
    expect((await run(["import-dxf", dir, "missing.dxf"], root)).code).toBe(2);
    expect((await run(["import-dxf", dir, "rect.dxf", "--units", "ft"], root)).code).toBe(2);
  });

  it("the board_import_dxf tool runs it as the agent and is marked as changing files", async () => {
    const { root, dir } = project();
    const t = boardTools().find((x) => x.name === "board_import_dxf")!;
    expect(t.annotations.readOnlyHint).toBe(false);
    expect(t.description).toMatch(/CHANGES FILES/);
    const seen: string[][] = [];
    const ctx: ToolContext = {
      dir: async (given) => (given ? (given.includes(":") || given.startsWith("/") ? given : join(root, given)) : root),
      cli: (d, args) => (seen.push(args), run(args.slice(1), d)),
      cliFor: () => ({ entry: "in-process", from: "server" }),
      version: "test",
      about: "",
      clientName: () => "dxf-test",
    };
    const out = await t.handler({ dir, path: "rect.dxf", layers: ["OUTLINE", "HOLES"], tolerance: 10000 } as never, ctx);
    expect((out.data as { status: string; report: { cutouts: number } }).status).toBe("applied");
    expect((out.data as { report: { cutouts: number } }).report.cutouts).toBe(1);
    expect(seen[0]).toEqual(expect.arrayContaining(["import-dxf", "--as=agent:dxf-test", "--layers=OUTLINE,HOLES", "--tolerance=10000"]));
    expect(seen[0].slice(-3)).toEqual(["--", dir, join(root, "rect.dxf")]);
    expect(readFileSync(join(dir, "board.jsonl"), "utf8")).toMatch(/"edited":"agent"/);
  });
});
