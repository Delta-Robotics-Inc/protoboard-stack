/**
 * `protoboard schematic` on a real UHD project (PCB editor Phase 3): a scratch project whose source file exports the
 * Airnode C3 sample's modules, so the circuit comes from `loadProject` and `circuitFromUhd` as for any project. The
 * scratch project lives in the repository's ignored test folder, so it resolves the stack's packages as a project's
 * node_modules would. It runs inspect (nothing laid out yet), layout, apply and undo, first with the schematic
 * opened for each call, then against a running service (where undo has history).
 */
import { existsSync, mkdirSync, mkdtempSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Reply } from "@protoboardai/schematic";
import { schematicCircuitFor, schematicCommand, schematicTargets } from "../src/schematic.js";
import type { CliRun } from "../src/mcp/tools.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "..", "schematic", "src", "fixtures", "airnode-c3.ts");
let root: string;
let dir: string;

beforeAll(() => {
  mkdirSync(join(HERE, ".tmp"), { recursive: true });
  root = mkdtempSync(join(HERE, ".tmp", "schematic-"));
  const moduleDir = join(root, "src", "airnode");
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(root, "protoboard.config.ts"), 'export default { name: "airnode-schematic-test", root: { source: "src/airnode/airnode.uhd.ts", export: "AIRNODE_BOARD" }, sources: ["src/**/*.uhd.ts"] };\n');
  const fixture = relative(moduleDir, FIXTURE).split("\\").join("/");
  writeFileSync(
    join(moduleDir, "airnode.uhd.ts"),
    [
      `import { airnodeUhd } from "${fixture}";`,
      "",
      "// the sample board and every definition it uses, found from the board down",
      'const { board, lookup } = airnodeUhd("ok");',
      "const seen = new Map();",
      "const walk = (id: string) => {",
      "  const d = lookup(id);",
      "  if (!d || seen.has(id)) return;",
      "  seen.set(id, d);",
      "  for (const c of d.children ?? []) walk(c.moduleDefId);",
      "};",
      "walk(board.id);",
      "export const AIRNODE_BOARD = board;",
      "export const AIRNODE = [...seen.values()];",
      "",
    ].join("\n"),
  );
  dir = join(moduleDir, "schematic");
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  try {
    // the ignored scratch folder too, when nothing else is in it
    rmdirSync(join(HERE, ".tmp"));
  } catch {
    /* not empty, or gone */
  }
});

async function run(argv: string[], extra: { signal?: AbortSignal; onServing?: (info: Record<string, unknown>) => void } = {}): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const code = await schematicCommand(argv, { cwd: root, env: {}, write: (s) => (stdout += s), stderr: (s) => (stderr += s), ...extra });
  return { code, stdout, stderr };
}
const json = (r: CliRun) => {
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`not JSON (exit ${r.code}): ${r.stdout}${r.stderr}`);
  }
};

describe("protoboard schematic on a UHD project", () => {
  it("finds the board's schematic folder beside its UHD file, and its circuit", async () => {
    const targets = await schematicTargets(root);
    expect(targets.map((t) => [t.board, t.key])).toEqual([["airnode-c3", "src__airnode__schematic"]]);
    expect(targets[0]).toMatchObject({ dir, moduleDir: dirname(dir), name: "Airnode C3 main board" });
    expect(targets[0].boardDir).toBeUndefined();
    const { circuit, target } = await schematicCircuitFor(dir);
    expect(target.board).toBe("airnode-c3");
    expect(circuit.parts.length).toBeGreaterThan(15);
    expect(circuit.nets.map((n) => n.name)).toContain("I2C_SDA");
    await expect(schematicCircuitFor(join(root, "src", "schematic"))).rejects.toThrow(/no UHD board/);
  }, 120_000);

  it("inspect, layout, apply and undo, each opening the schematic for the call", async () => {
    const before = json(await run(["inspect", "src/airnode/schematic", "--json"]));
    expect(before).toMatchObject({ laidOut: false, board: "airnode-c3", name: "Airnode C3 main board", mode: "local" });
    expect(existsSync(join(dir, "schematic.jsonl"))).toBe(false);

    const layout = await run(["layout", "src/airnode/schematic", "--json"]);
    expect(layout.code, layout.stdout + layout.stderr).toBe(0);
    expect(json(layout)).toMatchObject({ status: "applied", saved: { written: ["schematic", "symbols", "wires"] } });
    for (const f of ["schematic", "symbols", "wires"]) expect(existsSync(join(dir, `${f}.jsonl`))).toBe(true);

    const after = json(await run(["inspect", "src/airnode/schematic", "--json"]));
    expect(after).toMatchObject({ laidOut: true, stale: false });
    expect(after.cards.length).toBeGreaterThan(3);
    expect(after.score.score).toBeGreaterThan(0);

    writeFileSync(join(root, "move.json"), JSON.stringify({ op: "item.move", ids: ["sym:power/ldo"], dx: 2, dy: 0 }));
    const applied = await run(["apply", "src/airnode/schematic", "move.json", "--json"]);
    expect(applied.code).toBe(0);
    expect(json(applied) as Reply).toMatchObject({ status: "applied", changed: ["sym:power/ldo"] });
    // the move was saved: a new open sees it pinned (a person's move pins what it moved)
    const q = json(await run(["query", "src/airnode/schematic", "--id", "sym:power/ldo", "--json"]));
    expect(q.records[0]).toMatchObject({ id: "sym:power/ldo", pinned: true });

    // a one-call open has no history
    const undo = await run(["undo", "src/airnode/schematic", "--json"]);
    expect(undo.code).toBe(3);
    expect(json(undo)).toMatchObject({ status: "refused", reason: "nothing-to-undo" });

    const text = await run(["check", "src/airnode/schematic"]);
    expect(text.stdout).toMatch(/electrical: /);
    expect(text.stdout).not.toMatch(/sym:|pin:/);
  }, 180_000);

  it("against a running service, apply then undo restores the part", async () => {
    const stop = new AbortController();
    let info: Record<string, unknown> | undefined;
    let served: CliRun | undefined;
    // ready once serving, or when serve ended without serving (its output says why)
    await new Promise<void>((done) => {
      void run(["serve", "src/airnode/schematic", "--json"], { signal: stop.signal, onServing: (i) => ((info = i), done()) }).then((r) => ((served = r), done()));
    });
    expect(served, served && served.stdout + served.stderr).toBeUndefined();
    try {
      expect(info).toMatchObject({ status: "serving", laidOut: true });
      writeFileSync(join(root, "move2.json"), JSON.stringify({ op: "item.move", ids: ["sym:sensor/ic"], dx: 0, dy: 1 }));
      const before = json(await run(["query", "src/airnode/schematic", "--id", "sym:sensor/ic", "--json"])).records[0];
      const applied = json(await run(["apply", "src/airnode/schematic", "move2.json", "--as", "agent:tester", "--json"]));
      expect(applied).toMatchObject({ status: "applied", seq: 1 });
      expect(json(await run(["inspect", "src/airnode/schematic", "--json"]))).toMatchObject({ mode: "service", seq: 1 });
      // a person cannot undo the agent's move; the agent can
      expect(json(await run(["undo", "src/airnode/schematic", "--json"]))).toMatchObject({ status: "refused", reason: "nothing-to-undo" });
      const undo = await run(["undo", "src/airnode/schematic", "--as", "agent:tester", "--json"]);
      expect(undo.code).toBe(0);
      expect(json(undo)).toMatchObject({ status: "applied", seq: 2 });
      expect(json(await run(["query", "src/airnode/schematic", "--id", "sym:sensor/ic", "--json"])).records[0]).toEqual(before);
    } finally {
      stop.abort();
      for (let i = 0; i < 100 && !served; i++) await new Promise((r) => setTimeout(r, 50));
    }
    expect(served?.code).toBe(0);
    expect(served!.stdout.trim().split("\n").map((l) => JSON.parse(l).status)).toEqual(["serving", "stopped"]);
  }, 180_000);
});
