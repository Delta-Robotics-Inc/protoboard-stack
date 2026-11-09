/**
 * Binding parity (PCB editor plan, Phase 1): every registered board operation open to all actors is reachable
 * through the CLI's `board apply` and through the MCP `board_apply` tool, system operations through neither,
 * the tools' descriptions and operation names come from the registry, an agent never acts as a person, and every
 * `protoboard board` command has a --json mode that prints JSON.
 */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { listOperations, type Reply } from "@protoboardai/board";
import { builtinRouter } from "@protoboardai/board-route";
import { BOARD_COMMANDS, boardCommand, resolveActor } from "../src/board.js";
import { agentOperations, boardTools } from "../src/mcp/board-tools.js";
import type { CliRun, ToolContext } from "../src/mcp/tools.js";

const FIXTURE = fileURLToPath(new URL("../../board/test/fixtures/airnode-c3/", import.meta.url));
const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
/** A 40 x 30 mm rectangle as an ASCII DXF (one closed LWPOLYLINE, millimeters). */
const DXF_RECT = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0", "LWPOLYLINE", "8", "OUTLINE", "90", "4", "70", "1", "10", "0", "20", "0", "10", "40", "20", "0", "10", "40", "20", "30", "10", "0", "20", "30", "0", "ENDSEC", "0", "EOF"].join("\n") + "\n";

function project() {
  const root = mkdtempSync(join(tmpdir(), "pb-board-parity-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "board");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  return { root, dir };
}

/** Run `protoboard board …` in this process, as a person's terminal (no agent in the environment). */
async function run(argv: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const code = await boardCommand(argv, { cwd, env, write: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

/** The MCP tools' context, with the CLI run in this process. */
const ctx = (cwd: string): ToolContext => ({
  dir: async (given) => (given ? given : cwd),
  cli: (dir, args) => {
    expect(args[0]).toBe("board");
    return run(args.slice(1), dir);
  },
  cliFor: () => ({ entry: "in-process", from: "server" }),
  version: "test",
  about: "",
  clientName: () => "parity-test",
});
const tool = (name: string) => boardTools().find((t) => t.name === name)!;

describe("every operation open to all actors is reachable through the CLI and MCP", () => {
  const all = listOperations().filter((d) => d.audience === "all");
  const system = listOperations().filter((d) => d.audience === "system");

  it("the registry has operations of both audiences", () => {
    expect(all.length).toBeGreaterThan(20);
    expect(system.map((d) => d.name).sort()).toEqual(["netlist.sync", "record.put", "record.remove"]);
  });

  it("every Phase 2 operation has an example (the dry runs below cover each one)", () => {
    const p2 = listOperations().filter((d) => d.phase === 2);
    expect(p2.length).toBeGreaterThan(0);
    for (const d of p2) expect(d.example, d.name).toBeTruthy();
    for (const d of p2.filter((x) => x.audience === "all")) expect(all.map((x) => x.name)).toContain(d.name);
  });

  it("footprint.move without tracks moves the attached copper (Phase 2 default)", async () => {
    const { root, dir } = project();
    const file = join(root, "move.json");
    writeFileSync(file, JSON.stringify({ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1000000, dy: 0 }));
    const reply = JSON.parse((await run(["apply", dir, file, "--dry-run", "--json"], root)).stdout) as Reply & { reports?: { op: string; report: Record<string, unknown> }[] };
    expect(reply.status).toBe("valid");
    expect(reply.reports?.find((r) => r.op === "footprint.move")?.report).toHaveProperty("followed");
  });

  it.each(all.map((d) => [d.name, d] as const))("%s through `board apply` (a dry run, as a person)", async (_name, d) => {
    const { root, dir } = project();
    const file = join(root, "tx.json");
    writeFileSync(file, JSON.stringify({ op: d.name, ...d.example }));
    const r = await run(["apply", dir, file, "--dry-run", "--json"], root);
    const reply = JSON.parse(r.stdout) as Reply;
    expect(reply.status, r.stdout).toBe("valid");
    expect(r.code).toBe(0);
  });

  it.each(all.map((d) => [d.name, d] as const))("%s through the MCP board_apply tool (a dry run, as the agent)", async (_name, d) => {
    const { root, dir } = project();
    const t = tool("board_apply");
    const args = { dir, ops: [{ op: d.name, ...d.example }], dryRun: true };
    expect(z.object(t.input).safeParse(args).success).toBe(true);
    const out = await t.handler(args as never, ctx(root));
    const reply = out.data as Reply;
    // reached the engine as an agent: valid, or refused for what agents may not do (a person's call), never unknown
    if (reply.status === "refused") expect(["needs-person", "locked"], JSON.stringify(reply)).toContain(reply.reason);
    else expect(reply.status, JSON.stringify(out.data)).toBe("valid");
  });

  it("system operations are reachable through neither", async () => {
    const { root, dir } = project();
    const t = tool("board_apply");
    for (const d of system) {
      expect(z.object(t.input).safeParse({ dir, ops: [{ op: d.name, ...d.example }] }).success, d.name).toBe(false);
      const file = join(root, `${d.name}.json`);
      writeFileSync(file, JSON.stringify({ op: d.name, ...d.example }));
      const r = await run(["apply", dir, file, "--dry-run", "--json"], root);
      expect((JSON.parse(r.stdout) as Reply).status, d.name).toBe("invalid");
      expect(r.code).toBe(1);
    }
  });

  it("the tools' operation names and descriptions come from the registry", () => {
    const names = all.map((d) => d.name);
    expect(agentOperations().map((d) => d.name)).toEqual(names);
    const apply = tool("board_apply");
    const op = (apply.input.ops as z.ZodArray<z.ZodObject<{ op: z.ZodEnum<[string, ...string[]]> }>>).element.shape.op;
    expect(op.options).toEqual(names);
    for (const n of names) expect(apply.description).toContain(n);
    for (const d of all) expect(tool("board_operations").description).toContain(d.name);
  });
});

describe("an agent never acts as a person", () => {
  it("the CLI under an agent refuses --as human and acts as that agent", () => {
    expect(() => resolveActor("human", { CLAUDECODE: "1" })).toThrow(/never as a person/);
    expect(() => resolveActor("human", { PROTOBOARD_AGENT: "placer" })).toThrow(/never as a person/);
    expect(resolveActor(undefined, { PROTOBOARD_AGENT: "placer" })).toEqual({ kind: "agent", id: "agent:placer", name: "placer" });
    expect(resolveActor(undefined, {})).toMatchObject({ kind: "human" });
    expect(() => resolveActor("system", {})).toThrow();
  });

  it("no MCP board tool takes an actor, and writes go as agent:<client name>", async () => {
    for (const t of boardTools()) expect(Object.keys(t.input).filter((k) => /^(actor|as|human|person|kind|by)$/.test(k)), t.name).toEqual([]);
    const { root, dir } = project();
    const seen: string[][] = [];
    const c = ctx(root);
    const spy: ToolContext = { ...c, cli: (d, args) => (seen.push(args), c.cli(d, args)) };
    await tool("board_apply").handler({ dir, ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1000, dy: 0, tracks: "stay" }] } as never, spy);
    expect(seen[0]).toContain("--as=agent:parity-test");
  });
});

describe("the MCP server over stdio", () => {
  it("lists the board tools and runs them through the CLI as the agent", async () => {
    const { root, dir } = project();
    const home = mkdtempSync(join(tmpdir(), "pb-board-parity-home-"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("PROTOBOARD_"))) as Record<string, string>;
    const client = new Client({ name: "parity-client", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd: root, stderr: "pipe", env: { ...env, HOME: home, USERPROFILE: home, PROTOBOARD_CONFIG_DIR: join(home, "protoboard"), PROTOBOARD_CREDENTIAL_STORE: "file" } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const t of boardTools()) expect(names).toContain(t.name);
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as { content: { text: string }[]; isError?: boolean };
        return JSON.parse(r.content[0].text);
      };
      const inspect = await call("board_inspect", { dir });
      expect(inspect.board.name).toBe("Airnode C3");
      const applied = await call("board_apply", { dir, ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1000000, dy: 0, tracks: "stay" }], label: "move the LDO right" });
      expect(applied.status).toBe("applied");
      const q = await call("board_query", { dir, ids: ["fp:power/ldo"] });
      expect(q.records[0].provenance).toMatchObject({ edited: "agent" });
      // a person's call: refused for the agent
      const net = await call("board_apply", { dir, ops: [{ op: "net.set", ids: ["trk:f.spare.1"], net: "GND" }] });
      expect(net.status === "refused" && net.reason).toBe("needs-person");
    } finally {
      await client.close();
    }
  }, 180_000);
});

describe("every board command has a --json mode", () => {
  it.each(BOARD_COMMANDS.map((c) => [c.name] as const))("board %s --json prints JSON", async (name) => {
    const { root, dir } = project();
    const extra: Record<string, string[]> = {
      query: ["--id", "fp:power/ldo"],
      apply: [join(root, "tx.json")],
      revert: ["no-such-set"],
      checkpoint: ["parity checkpoint"],
      claim: ["--purpose", "parity check"],
      import: [],
      check: ["--no-cross-check"],
      describe: ["--image", "none"],
      render: ["--width", "200", "--height", "150"],
      route: ["--budget", "5"],
      diagnose: ["I2C_SCL", "--budget", "5"],
      "import-dxf": [join(root, "outline.dxf")],
    };
    writeFileSync(join(root, "outline.dxf"), DXF_RECT);
    writeFileSync(join(root, "tx.json"), JSON.stringify({ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1000, dy: 0, tracks: "stay" }));
    const argv = name === "ops" ? ["ops", "--json"] : name === "import" ? ["import", join(dir, "board.jsonl"), join(root, "imported"), "--json"] : [name, dir, ...(extra[name] ?? []), "--json"];
    let stdout = "";
    const stop = new AbortController();
    // route and diagnose run the built-in router: the parity check never waits on the real routers
    const code = await boardCommand(argv, { cwd: root, env: {}, write: (s) => (stdout += s), stderr: () => {}, signal: stop.signal, onServing: () => stop.abort(), routing: { routers: [builtinRouter()] } });
    const lines = stdout.trim().split("\n");
    // serve prints one JSON line when it starts and one when it stops; every other command one JSON document
    if (name === "serve") for (const l of lines) expect(() => JSON.parse(l), l).not.toThrow();
    else expect(() => JSON.parse(stdout), stdout).not.toThrow();
    expect(typeof code).toBe("number");
  }, 120_000);
});

describe("the import, check, describe, render, route and diagnose commands have MCP tools", () => {
  const pairs = { import: "board_import", check: "board_check", describe: "board_describe", render: "board_render", route: "board_route", diagnose: "board_diagnose", "import-dxf": "board_import_dxf" } as const;

  it.each(Object.entries(pairs))("board %s is the %s tool", (command, name) => {
    expect(BOARD_COMMANDS.map((c) => c.name)).toContain(command);
    const t = tool(name);
    expect(t, name).toBeDefined();
    expect(t.annotations.destructiveHint).toBe(false);
    // check and diagnose write nothing; describe and render write derived files only; import changes files; route only with apply
    expect(t.annotations.readOnlyHint).toBe(command === "check" || command === "diagnose");
    if (command === "import" || command === "import-dxf") expect(t.description).toMatch(/CHANGES FILES/);
    if (command === "route") expect(t.description).toMatch(/CHANGES THE BOARD \(only with apply\)/);
  });

  it("each tool runs its command with the flags the command takes", async () => {
    const { root, dir } = project();
    const seen: string[][] = [];
    const c = ctx(root);
    const spy: ToolContext = { ...c, cli: (d, args) => (seen.push(args), c.cli(d, args)) };
    await tool("board_check").handler({ dir, crossCheck: false } as never, spy);
    await tool("board_describe").handler({ dir, net: "GND" } as never, spy);
    await tool("board_describe").handler({ dir, region: [-10, -5, 10, 5] } as never, spy);
    await tool("board_import").handler({ source: join(dir, "board.jsonl"), dir: join(root, "imported"), format: "kicad_pcb" } as never, spy);
    expect(seen[0].slice(0, 3)).toEqual(["board", "check", "--no-cross-check=true"]);
    expect(seen[1]).toContain("--net=GND");
    expect(seen[2]).toContain("--region=[-10,-5,10,5]");
    expect(seen[3]).toContain("--kind=kicad_pcb");
    for (const args of seen) {
      const spec = BOARD_COMMANDS.find((x) => x.name === args[1])!;
      for (const a of args.filter((x) => x.startsWith("--") && x !== "--")) {
        const flag = a.slice(2).split("=")[0];
        if (flag !== "format") expect(spec.flags, `${args[1]} --${flag}`).toContain(flag);
      }
    }
  });
});
