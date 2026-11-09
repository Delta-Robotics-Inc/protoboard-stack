/**
 * `protoboard board export-kicad` and the MCP `board_export_kicad` tool (PCB editor Phase 2): the Airnode C3 sample's
 * KiCad board imported into a temporary project, then written back as a KiCad board (.kicad_pcb, .kicad_pro,
 * .kicad_dru) through its import record's offset; with kicad-cli installed, `board check --kicad <export>` gives
 * KiCad's counts on the export equal to those on the source.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findKicadCli } from "@protoboardai/board-checks";
import { boardCommand } from "../src/board.js";
import { boardTools } from "../src/mcp/board-tools.js";
import type { CliRun, ToolContext } from "../src/mcp/tools.js";

const SOURCE = fileURLToPath(new URL("../../ext-tscircuit/test/fixtures/pcb-regression/airnode-c3/airnode-c3.kicad_pcb", import.meta.url));

async function run(argv: string[], cwd: string): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const code = await boardCommand(argv, { cwd, env: {}, write: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

/** A project with the sample's KiCad board imported into `board`. */
async function project() {
  const root = mkdtempSync(join(tmpdir(), "pb-board-export-kicad-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "board");
  mkdirSync(dir, { recursive: true });
  const imp = await run(["import", SOURCE, dir, "--json"], root);
  expect(imp.code, imp.stdout + imp.stderr).toBe(0);
  return { root, dir, offset: JSON.parse(imp.stdout).offset as { x: number; y: number } };
}

describe("board export-kicad", () => {
  it("writes the three files through the import record's offset and prints the report", async () => {
    const { root, dir, offset } = await project();
    const r = await run(["export-kicad", dir, "out/airnode.kicad_pcb", "--json"], root);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.status).toBe("written");
    expect(d.offsetFrom).toBe("import record");
    expect(d.offset).toEqual(offset);
    expect(d.files.pcb).toBe(join(root, "out", "airnode.kicad_pcb"));
    for (const f of [d.files.pcb, d.files.pro, d.files.dru]) expect(existsSync(f), f).toBe(true);
    expect(d.files.pro).toBe(join(root, "out", "airnode.kicad_pro"));
    expect(d.stats).toMatchObject({ footprints: 20, nets: 15 });
    expect(d.report.some((x: { level: string; message: string }) => x.level === "approximated" && /polygon pad/.test(x.message))).toBe(true);
    expect(d.levels.approximated).toBeGreaterThan(0);
    // the project names itself after the file, and the board lands where the source was
    expect(JSON.parse(readFileSync(d.files.pro, "utf8")).meta.filename).toBe("airnode.kicad_pro");
    // the export is noted in the import record, so a cross-check against it reads it in the source's frame
    const record = JSON.parse(readFileSync(d.importRecord, "utf8"));
    expect(record.exports).toEqual([{ path: d.files.pcb, at: expect.any(String), sharedIds: false }]);
    const pcb = readFileSync(d.files.pcb, "utf8");
    expect(pcb.startsWith("(kicad_pcb\n\t(version 20241229)")).toBe(true);
    expect(pcb).toMatch(/\(footprint "[^"]*"\n\t\t\(layer "F.Cu"\)/);

    const text = await run(["export-kicad", dir, join(root, "out", "airnode.kicad_pcb")], root);
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toMatch(/^WRITTEN /);
    expect(text.stdout).toMatch(/offset: the import record's/);
    expect(text.stdout).toMatch(/APPROXIMATED \d+ polygon pad/);
    expect(text.stdout).toMatch(/cross-check it: protoboard board check .* --kicad /);
  }, 120_000);

  it("refuses an output that is not a .kicad_pcb, and a folder without a board", async () => {
    const { root, dir } = await project();
    expect((await run(["export-kicad", dir, "out/board.pcb"], root)).code).toBe(2);
    expect((await run(["export-kicad", join(root, "nothing"), "out/board.kicad_pcb"], root)).code).toBe(2);
    expect((await run(["export-kicad", dir], root)).code).toBe(2);
  }, 120_000);

  it.skipIf(!findKicadCli())(
    "board check --kicad <export> gives KiCad's counts on the export equal to those on the source",
    async () => {
      const { root, dir } = await project();
      expect((await run(["export-kicad", dir, "out/airnode.kicad_pcb", "--json"], root)).code).toBe(0);
      const source = JSON.parse((await run(["check", dir, "--json"], root)).stdout).crossCheck;
      const exported = JSON.parse((await run(["check", dir, "--kicad", join(root, "out", "airnode.kicad_pcb"), "--json"], root)).stdout).crossCheck;
      expect(source.ran && exported.ran).toBe(true);
      expect(exported.totals.kicad).toEqual(source.totals.kicad);
      expect(exported.totals.ours).toEqual(source.totals.ours);
    },
    300_000,
  );
});

describe("the board_export_kicad tool", () => {
  it("runs export-kicad with the board and the output, and says it changes files", async () => {
    const t = boardTools().find((x) => x.name === "board_export_kicad")!;
    expect(t).toBeDefined();
    expect(t.annotations.readOnlyHint).toBe(false);
    expect(t.annotations.destructiveHint).toBe(false);
    expect(t.description).toMatch(/CHANGES FILES: it writes the export only/);
    expect(Object.keys(t.input).sort()).toEqual(["dir", "out", "uniqueIds"]);
    const { root, dir } = await project();
    const seen: string[][] = [];
    const ctx: ToolContext = {
      dir: async (given) => (given ? (given.startsWith(root) ? given : join(root, given)) : root),
      cli: (d, args) => (seen.push(args), run(args.slice(1), d)),
      cliFor: () => ({ entry: "in-process", from: "server" }),
      version: "test",
      about: "",
      clientName: () => "export-test",
    };
    const out = await t.handler({ dir, out: "out/tool.kicad_pcb" } as never, ctx);
    expect(out.isError, JSON.stringify(out.data)).toBeFalsy();
    expect(seen[0].slice(0, 2)).toEqual(["board", "export-kicad"]);
    expect(seen[0]).toContain(join(root, "out", "tool.kicad_pcb"));
    expect((out.data as { status: string }).status).toBe("written");
    expect(existsSync(join(root, "out", "tool.kicad_dru"))).toBe(true);
  }, 120_000);
});
