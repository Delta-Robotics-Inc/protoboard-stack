/**
 * Binding parity (PCB editor plan, Phase 3), as board-parity.test.ts is for the board: every schematic operation
 * open to all actors is reachable through the CLI's `schematic apply` and through the MCP `schematic_apply` tool,
 * system operations through neither; every cleanup tool has an MCP tool of the same name, description and input
 * and a CLI path; an agent never acts as a person; every `protoboard schematic` command has a --json mode.
 * The circuit is the Airnode C3 sample's, injected (the CLI test with a real UHD project is schematic-cli.test.ts).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CLEANUP_TOOLS, listOperations, writeSchematicDir, type Reply, type SchematicCircuit, type SchematicDocument } from "@protoboardai/schematic";
import { airnodeCircuit, airnodeSchematic } from "@protoboardai/schematic/fixtures/airnode-c3";
import { SCHEMATIC_COMMANDS, schematicCommand } from "../src/schematic.js";
import { agentSchematicOperations, CLEANUP_SUBCOMMANDS, schematicTools } from "../src/mcp/schematic-tools.js";
import type { CliRun, ToolContext } from "../src/mcp/tools.js";

const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
let circuit: SchematicCircuit;
let laid: SchematicDocument;
beforeAll(async () => {
  circuit = await airnodeCircuit();
  laid = await airnodeSchematic();
});

function project(withSchematic = true) {
  const root = mkdtempSync(join(tmpdir(), "pb-schematic-parity-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "airnode", "schematic");
  mkdirSync(dir, { recursive: true });
  if (withSchematic) writeSchematicDir(dir, laid);
  return { root, dir };
}

/** Run `protoboard schematic …` in this process, as a person's terminal, with the sample's circuit. */
async function run(argv: string[], cwd: string, env: NodeJS.ProcessEnv = {}, extra: { signal?: AbortSignal; onServing?: () => void } = {}): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const code = await schematicCommand(argv, { cwd, env, write: (s) => (stdout += s), stderr: (s) => (stderr += s), circuitFor: async () => ({ circuit }), ...extra });
  return { code, stdout, stderr };
}

const ctx = (cwd: string): ToolContext => ({
  dir: async (given) => (given ? given : cwd),
  cli: (dir, args) => {
    expect(args[0]).toBe("schematic");
    return run(args.slice(1), dir);
  },
  cliFor: () => ({ entry: "in-process", from: "server" }),
  version: "test",
  about: "",
  clientName: () => "parity-test",
});
const tool = (name: string) => schematicTools().find((t) => t.name === name)!;

/** A dry run's reply reached the operation itself: valid, or the operation's own refusal of the sample's ids. */
function reachedTheOperation(reply: Reply, name: string) {
  if (reply.status === "invalid") {
    expect(reply.error, name).not.toMatch(/unknown operation|is a system operation/);
    expect(reply.issues, `${name}: ${reply.error}`).toBeUndefined();
    expect(reply.error, name).toMatch(new RegExp(`^${name.replace(".", "\\.")}: `));
  } else if (reply.status === "refused") expect(["pinned", "needs-person"], JSON.stringify(reply)).toContain(reply.reason);
  else expect(reply.status, JSON.stringify(reply)).toBe("valid");
}

describe("every schematic operation open to all actors is reachable through the CLI and MCP", () => {
  const all = listOperations().filter((d) => d.audience === "all");
  const system = listOperations().filter((d) => d.audience === "system");

  it("the registry has operations of both audiences", () => {
    expect(all.length).toBeGreaterThan(20);
    expect(system.map((d) => d.name).sort()).toEqual(["record.put", "record.remove"]);
  });

  it.each(all.map((d) => [d.name, d] as const))("%s through `schematic apply` (a dry run, as a person)", async (name, d) => {
    const { root, dir } = project();
    const file = join(root, "tx.json");
    writeFileSync(file, JSON.stringify({ op: d.name, ...d.example }));
    const r = await run(["apply", dir, file, "--dry-run", "--json"], root);
    const reply = JSON.parse(r.stdout) as Reply;
    reachedTheOperation(reply, name);
    expect(r.code).toBe(reply.status === "valid" ? 0 : reply.status === "refused" ? 3 : 1);
  });

  it.each(all.map((d) => [d.name, d] as const))("%s through the MCP schematic_apply tool (a dry run, as the agent)", async (name, d) => {
    const { root, dir } = project();
    const t = tool("schematic_apply");
    const args = { dir, ops: [{ op: d.name, ...d.example }], dryRun: true };
    expect(z.object(t.input).safeParse(args).success).toBe(true);
    const out = await t.handler(args as never, ctx(root));
    reachedTheOperation(out.data as Reply, name);
  });

  it("most examples are valid on the sample schematic", async () => {
    const { root, dir } = project();
    let valid = 0;
    for (const d of all) {
      const file = join(root, "tx.json");
      writeFileSync(file, JSON.stringify({ op: d.name, ...d.example }));
      if ((JSON.parse((await run(["apply", dir, file, "--dry-run", "--json"], root)).stdout) as Reply).status === "valid") valid++;
    }
    expect(valid).toBeGreaterThan(all.length / 2);
  });

  it("system operations are reachable through neither", async () => {
    const { root, dir } = project();
    const t = tool("schematic_apply");
    for (const d of system) {
      expect(z.object(t.input).safeParse({ dir, ops: [{ op: d.name, ids: ["sym:power/ldo"] }] }).success, d.name).toBe(false);
      const file = join(root, `${d.name}.json`);
      writeFileSync(file, JSON.stringify({ op: d.name, ids: ["sym:power/ldo"], records: [laid.records.get("sym:power/ldo")] }));
      const r = await run(["apply", dir, file, "--dry-run", "--json"], root);
      expect((JSON.parse(r.stdout) as Reply & { error?: string }).error, d.name).toMatch(/is a system operation/);
      expect(r.code).toBe(1);
    }
  });

  it("the tools' operation names and descriptions come from the registry", () => {
    const names = all.map((d) => d.name);
    expect(agentSchematicOperations().map((d) => d.name)).toEqual(names);
    const apply = tool("schematic_apply");
    const op = (apply.input.ops as z.ZodArray<z.ZodObject<{ op: z.ZodEnum<[string, ...string[]]> }>>).element.shape.op;
    expect(op.options).toEqual(names);
    for (const n of names) expect(apply.description).toContain(n);
    for (const d of all) expect(tool("schematic_operations").description).toContain(d.name);
  });
});

describe("every cleanup tool has an MCP tool and a CLI path", () => {
  it.each(CLEANUP_TOOLS.map((t) => [t.name, t] as const))("%s: same name, description and input", (name, c) => {
    const t = tool(name);
    expect(t, name).toBeDefined();
    expect(t.description.startsWith(c.description), name).toBe(true);
    expect(Object.keys(t.input).sort()).toEqual(["dir", ...Object.keys(c.input.shape)].sort());
    const cleanup = SCHEMATIC_COMMANDS.find((x) => x.name === "cleanup")!;
    expect(cleanup.args).toContain(CLEANUP_SUBCOMMANDS[name]);
  });

  it("each runs `schematic cleanup <dir> <tool>` with flags the command takes, and works on the sample", async () => {
    const { root, dir } = project();
    const seen: string[][] = [];
    const c = ctx(root);
    const spy: ToolContext = { ...c, cli: (d, args) => (seen.push(args), c.cli(d, args)) };
    const list = (await tool("schematic_list_defects").handler({ dir, limit: 5 } as never, spy)).data as { score: number; defects: { id: string; n: number }[] };
    expect(typeof list.score).toBe("number");
    if (list.defects.length) {
      const first = list.defects[0];
      const text = (await tool("schematic_explain_defect").handler({ dir, defect: first.n } as never, spy)).data as { text: string };
      expect(text.text).toMatch(/^Defect /);
      const fixes = (await tool("schematic_propose_fixes").handler({ dir, defect: first.id, max: 2 } as never, spy)).data as { candidates: { title: string; ops: unknown[] }[] };
      expect(Array.isArray(fixes.candidates)).toBe(true);
      if (fixes.candidates.length) {
        const applied = (await tool("schematic_apply_fix").handler({ dir, title: fixes.candidates[0].title, ops: fixes.candidates[0].ops } as never, spy)).data as Reply;
        expect(["applied", "refused"]).toContain(applied.status);
      }
    }
    const pass = (await tool("schematic_cleanup_pass").handler({ dir, budget: 4, maxPasses: 1 } as never, spy)).data as { changeSet: { ops: number }; passes: number };
    expect(pass.changeSet.ops).toBeLessThanOrEqual(4);
    expect(pass.passes).toBeLessThanOrEqual(1);
    for (const args of seen) {
      expect(args[1]).toBe("cleanup");
      const spec = SCHEMATIC_COMMANDS.find((x) => x.name === "cleanup")!;
      for (const a of args.filter((x) => x.startsWith("--") && x !== "--")) {
        const flag = a.slice(2).split("=")[0];
        if (flag !== "format") expect(spec.flags, `cleanup --${flag}`).toContain(flag);
      }
      expect(Object.values(CLEANUP_SUBCOMMANDS)).toContain(args[args.indexOf("--") + 2]);
    }
  });
});

describe("an agent never acts as a person", () => {
  it("the CLI under an agent refuses --as human", async () => {
    const { root, dir } = project();
    const file = join(root, "tx.json");
    writeFileSync(file, JSON.stringify({ op: "item.move", ids: ["sym:power/ldo"], dx: 1, dy: 0 }));
    const r = await run(["apply", dir, file, "--as", "human", "--json"], root, { CLAUDECODE: "1" });
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).error).toMatch(/never as a person/);
  });

  it("no MCP schematic tool takes an actor, and writes go as agent:<client name>", async () => {
    for (const t of schematicTools()) expect(Object.keys(t.input).filter((k) => /^(actor|as|human|person|kind|by)$/.test(k)), t.name).toEqual([]);
    const { root, dir } = project();
    const seen: string[][] = [];
    const c = ctx(root);
    const spy: ToolContext = { ...c, cli: (d, args) => (seen.push(args), c.cli(d, args)) };
    const r = (await tool("schematic_apply").handler({ dir, ops: [{ op: "item.move", ids: ["sym:power/ldo"], dx: 1, dy: 0 }] } as never, spy)).data as Reply;
    expect(r.status).toBe("applied");
    expect(seen[0]).toContain("--as=agent:parity-test");
    const q = (await tool("schematic_query").handler({ dir, ids: ["sym:power/ldo"] } as never, c)).data as { records: { provenance: { edited?: string } }[] };
    expect(q.records[0].provenance.edited).toBe("agent");
  });
});

describe("the MCP server", () => {
  /** The tools that change files (the rest write nothing, or only derived files). */
  const WRITES = ["schematic_apply", "schematic_undo", "schematic_redo", "schematic_layout", "schematic_apply_fix", "schematic_cleanup_pass"];

  it("follows the server's description rules: project code, writes, read-only hints", () => {
    for (const t of schematicTools()) {
      expect(t.annotations.destructiveHint, t.name).toBe(false);
      expect(t.description.length, t.name).toBeLessThanOrEqual(2048);
      if (t.name === "schematic_operations") {
        expect(t.description).toMatch(/Runs no project code/);
        continue;
      }
      // the circuit comes from the project's UHD: none of these is read-only (PB-1048)
      expect(t.annotations.readOnlyHint, t.name).toBe(false);
      expect(t.description, t.name).toContain("It runs the project's own code (protoboard.config.ts and its model files)");
      expect(t.description, t.name).toMatch(WRITES.includes(t.name) ? /CHANGES FILES/ : /Writes nothing/);
    }
  });

  it("lists the schematic tools over stdio and answers one through the CLI", async () => {
    const { root } = project();
    const home = mkdtempSync(join(tmpdir(), "pb-schematic-parity-home-"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("PROTOBOARD_"))) as Record<string, string>;
    const client = new Client({ name: "schematic-parity-client", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd: root, stderr: "pipe", env: { ...env, HOME: home, USERPROFILE: home, PROTOBOARD_CONFIG_DIR: join(home, "protoboard"), PROTOBOARD_CREDENTIAL_STORE: "file" } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const t of schematicTools()) expect(names).toContain(t.name);
      const r = (await client.callTool({ name: "schematic_operations", arguments: {} }, undefined, { timeout: 120_000 })) as { content: { text: string }[] };
      expect((JSON.parse(r.content[0].text) as { operations: { name: string }[] }).operations.map((o) => o.name)).toEqual(agentSchematicOperations().map((d) => d.name));
    } finally {
      await client.close();
    }
  }, 180_000);
});

describe("every schematic command has a --json mode", () => {
  it.each(SCHEMATIC_COMMANDS.map((c) => [c.name] as const))("schematic %s --json prints JSON", async (name) => {
    const { root, dir } = project();
    writeFileSync(join(root, "tx.json"), JSON.stringify({ op: "item.move", ids: ["sym:power/ldo"], dx: 1, dy: 0 }));
    const extra: Record<string, string[]> = {
      query: ["--id", "sym:power/ldo"],
      apply: [join(root, "tx.json")],
      checkpoint: ["parity checkpoint"],
      render: ["--theme", "paper"],
      describe: ["--image", "svg"],
      cleanup: ["--budget", "2", "--max-passes", "1"],
    };
    const argv = name === "ops" ? ["ops", "--json"] : [name, dir, ...(extra[name] ?? []), "--json"];
    const stop = new AbortController();
    const r = await run(argv, root, {}, { signal: stop.signal, onServing: () => stop.abort() });
    const lines = r.stdout.trim().split("\n");
    if (name === "serve") for (const l of lines) expect(() => JSON.parse(l), l).not.toThrow();
    else expect(() => JSON.parse(r.stdout), r.stdout + r.stderr).not.toThrow();
    // a one-call open has no history: undo and redo are refused (3)
    expect(r.code, r.stdout).toBe(name === "undo" || name === "redo" ? 3 : name === "check" && JSON.parse(r.stdout).summary.errors ? 1 : 0);
  }, 120_000);

  it("a folder with no schematic yet: read-only commands say so, layout lays it out", async () => {
    const { root, dir } = project(false);
    const render = await run(["render", dir, "--json"], root);
    expect(JSON.parse(render.stdout)).toMatchObject({ status: "not-laid-out" });
    expect(render.code).toBe(2);
    const inspect = JSON.parse((await run(["inspect", dir, "--json"], root)).stdout);
    expect(inspect).toMatchObject({ laidOut: false, board: circuit.board });
    const layout = await run(["layout", dir, "--json"], root);
    expect(JSON.parse(layout.stdout)).toMatchObject({ status: "applied", saved: { written: ["schematic", "symbols", "wires"] } });
    expect(JSON.parse((await run(["inspect", dir, "--json"], root)).stdout)).toMatchObject({ laidOut: true, stale: false });
  }, 120_000);
});
