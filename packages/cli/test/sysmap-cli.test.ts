/**
 * `protoboard map` (docs/specs/system-map.md): which stack the CLI maps
 * (`stackRootOf`), the summary and the whole map, the query flags and their
 * usage errors, `--check`, `--out` writing that one file only; the gate (no
 * project, no sign-in); the `stack_map` MCP tool; and the dev server's
 * System Map route (its cache, its CORS, its error answer).
 *
 * The stacks mapped here are the core tests' fixture stack, written to a
 * folder in the system's temporary folder (outside any git work tree, so no
 * history), and this repository itself (read only). Nothing is mapped in the
 * user's home.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DISCIPLINE_ORDER, FRAMEWORK_VERSION, SYSMAP_SCHEMA, sysmapGraph, type SystemMap } from "@protoboardai/core";
import { cliCases, cliHelp, mcpTools } from "../../core/src/sysmap/parse.js";
import { stackFiles, writeFiles } from "../../core/test/sysmap-fixture.js";
import { commandGate } from "../src/gate.js";
import { SYSMAP_QUERY_SCHEMA, mapCommand, parseIsland, parseType, stackRootOf, thisStack, type MapItemAnswer, type MapListAnswer } from "../src/sysmap.js";
import { SYSMAP_CHECK_MS, SYSMAP_ROUTES, sysmapAnswer, sysmapSource } from "../src/dev/sysmap.js";
import { startDev, type DevServer } from "../src/dev/server.js";
import { cliTools, mapOverview } from "../src/mcp/tools.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
const CLI = join(HERE, "../bin/protoboard.mjs");
/** Outside every git work tree: the fixture stack has no history. */
const SCRATCH = mkdtempSync(join(tmpdir(), "pb-sysmap-cli-"));
const STACK = join(SCRATCH, "stack");
const HOME = join(SCRATCH, "home");
const EMPTY = join(SCRATCH, "empty");

/** Every file under a folder, relative, with forward slashes. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The CLI with no sign-in (a scratch home), in `cwd`. */
const cli = (cwd: string, ...args: string[]): Promise<Run> =>
  new Promise((done) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("PROTOBOARD_"))) as Record<string, string>;
    const child = spawn(process.execPath, [CLI, ...args, "--cwd", cwd], { cwd, env: { ...env, HOME, USERPROFILE: HOME, PROTOBOARD_CONFIG_DIR: join(HOME, "protoboard"), PROTOBOARD_CREDENTIAL_STORE: "file", PROTOBOARD_CLOUD_URL: "http://127.0.0.1:9" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => done({ code, stdout, stderr }));
  });

/** `mapCommand` in this process, with what it prints captured. */
async function map(flags: Parameters<typeof mapCommand>[1]["flags"], o: { json?: boolean; cwd?: string; args?: string[] } = {}) {
  const printed: unknown[] = [];
  const texts: string[] = [];
  const written: string[] = [];
  const said: string[] = [];
  const json = o.json ?? false;
  const r = await mapCommand(o.args ?? [], {
    json,
    cwd: o.cwd ?? EMPTY,
    out: (data, text) => (json ? printed.push(data) : texts.push(text())),
    write: (t) => written.push(t),
    say: (t) => said.push(t),
    flags: { root: STACK, ...flags },
  });
  return { code: r.code, data: printed[0], text: texts.join("\n"), written: written.join(""), said };
}

beforeAll(() => {
  writeFiles(STACK, stackFiles());
  mkdirSync(HOME, { recursive: true });
  mkdirSync(EMPTY, { recursive: true });
});
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Which stack
// ---------------------------------------------------------------------------

describe("stackRootOf: the stack a file of the CLI belongs to", () => {
  /** An injected file system of package.json files. */
  const io = (files: Record<string, unknown>) => ({ exists: (p: string) => p in files, readJson: (p: string) => files[p] });
  const base = join(SCRATCH, "roots");

  it("the stack's repository: the first ancestor whose package.json has workspaces", () => {
    const root = join(base, "repo");
    const files = { [join(root, "package.json")]: { name: "stack", workspaces: ["packages/*"] }, [join(root, "packages", "cli", "package.json")]: { name: "@protoboardai/cli" } };
    expect(stackRootOf(join(root, "packages", "cli", "src", "sysmap.ts"), io(files))).toEqual({ root, layout: "monorepo" });
    // workspaces that name nothing do not make a repository
    expect(stackRootOf(join(root, "packages", "cli", "src", "sysmap.ts"), io({ [join(root, "package.json")]: { workspaces: [] } }))).toBeNull();
  });

  it("an installed stack: the folder holding node_modules/@protoboardai (a copy in ~/.protoboard/stack/<version>)", () => {
    const copy = join(base, ".protoboard", "stack", "0.3.0");
    const files = { [join(copy, "node_modules", "@protoboardai", "cli", "package.json")]: { name: "@protoboardai/cli" }, [join(copy, "package.json")]: { name: "stack-copy" } };
    expect(stackRootOf(join(copy, "node_modules", "@protoboardai", "cli", "src", "sysmap.ts"), io(files))).toEqual({ root: copy, layout: "installed" });
    // whichever comes first: a node_modules below a repository is an installed stack
    const repo = join(base, "repo2");
    expect(stackRootOf(join(repo, "node_modules", "@protoboardai", "cli", "src", "sysmap.ts"), io({ [join(repo, "package.json")]: { workspaces: ["packages/*"] } }))).toEqual({ root: repo, layout: "installed" });
  });

  it("neither: null (and a package.json that is not JSON is passed over)", () => {
    const dir = join(base, "loose");
    const io2 = { exists: (p: string) => p === join(dir, "package.json"), readJson: () => JSON.parse("{ not json") };
    expect(stackRootOf(join(dir, "src", "file.ts"), io2)).toBeNull();
    expect(stackRootOf(join(dir, "src", "file.ts"), io({}))).toBeNull();
  });

  it("this CLI, run from the stack's repository, maps the repository", () => {
    expect(thisStack()).toEqual({ root: REPO, layout: "monorepo" });
  });
});

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

describe("protoboard map on a fixture stack", () => {
  it("prints a summary: the stack and its layout, the counts, every island (empty ones say so), the types and the problems", async () => {
    const r = await map({});
    expect(r.code).toBe(0);
    expect(r.text).toMatch(new RegExp(`^System Map of the Protoboard stack ${FRAMEWORK_VERSION.replace(/\./g, "\\.")} \\(monorepo: `));
    expect(r.text).toMatch(/\d+ items, \d+ links, \d+ problem\(s\); no release history/);
    for (const id of DISCIPLINE_ORDER) expect(r.text).toMatch(new RegExp(`^  ${id} `, "m"));
    expect(r.text).toMatch(/^ {2}simulation +Simulation +empty +No item in the stack resolves to this discipline\.$/m);
    expect(r.text).toMatch(/^ {2}CLI commands +6$/m);
    expect(r.text).toMatch(/^ {2}CLI_HELP_ORPHAN /m);
    expect(r.text).toMatch(/HISTORY_UNAVAILABLE/);
  });

  it("--format json prints the whole map, as its file holds it", async () => {
    const r = await map({}, { json: true });
    const m = JSON.parse(r.written) as SystemMap;
    expect(m.schema).toBe(SYSMAP_SCHEMA);
    expect(m.layout).toBe("monorepo");
    expect(m.items.map((i) => i.id)).toEqual(expect.arrayContaining(["cli:check", "mcp:project_check", "skill:board-make", "ext:@protoboardai/ext-a"]));
    expect(m.inputs.length).toBeGreaterThan(10);
    // keys sorted, two-space indent, a final newline: serializeSystemMap's bytes
    expect(r.written.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(r.written))).toEqual(Object.keys(JSON.parse(r.written)).sort());
  });

  it("--island lists one discipline's items, and an empty island says what the stack holds about it", async () => {
    const r = await map({ island: "pcb" }, { json: true });
    const a = r.data as MapListAnswer;
    expect(a.schema).toBe(SYSMAP_QUERY_SCHEMA);
    expect(a.query).toEqual({ island: "pcb" });
    expect(a.island).toMatchObject({ id: "pcb", empty: false });
    expect(a.total).toBe(a.items.length);
    expect(a.items.every((i) => i.discipline === "pcb")).toBe(true);
    expect(a.items.map((i) => i.id)).toEqual(expect.arrayContaining(["skill:board-make", "view:pcb", "tool:lib-node"]));
    // small: no facts, no detail, no inputs
    expect(Object.keys(a.items[0]!).sort()).toEqual(expect.arrayContaining(["id", "type", "name", "version", "status", "discipline", "stage", "purpose", "changed", "source", "degree"]));
    expect(JSON.stringify(a)).not.toMatch(/"facts"|"inputs"|"detail"/);
    // by type, then id
    const empty = (await map({ island: "Playbooks" }, { json: true })).data as MapListAnswer;
    expect(empty).toMatchObject({ total: 0, items: [], island: { id: "playbooks", empty: true } });
    expect(empty.island!.note).toMatch(/docs\/specs\/playbooks\.md/);
    expect((await map({ island: "simulation" })).text).toMatch(/^0 item\(s\)[\s\S]*No item in the stack resolves/);
  });

  it("--type lists one kind of item (by id, prefix or label), and with --island both", async () => {
    const cliOnly = (await map({ type: "cli" }, { json: true })).data as MapListAnswer;
    expect(cliOnly.query).toEqual({ type: "cli-command" });
    expect(cliOnly.items.map((i) => i.id)).toEqual(["cli:build", "cli:check", "cli:mcp", "cli:rebuild", "cli:run", "cli:secret"]);
    expect(parseType("MCP tools")).toBe("mcp-tool");
    expect(parseType("skills")).toBe("skill");
    expect(parseIsland("PCB & EDA")).toBe("pcb");
    const both = (await map({ island: "pcb", type: "skill" }, { json: true })).data as MapListAnswer;
    expect(both.items.length).toBeGreaterThan(0);
    expect(both.items.every((i) => i.type === "skill" && i.discipline === "pcb")).toBe(true);
    const text = (await map({ type: "mcp-tool" })).text;
    expect(text).toMatch(/^2 item\(s\) of the System Map \(stack [^)]+\): MCP tools$/m);
    expect(text).toMatch(/^ {2}mcp:project_check +mcp-tool +1\.0\.0 +system +Check the project$/m);
  });

  it("--item gives one item with every link in both directions, by kind, each neighbor with its version and status", async () => {
    const a = (await map({ item: "cli:check" }, { json: true })).data as MapItemAnswer;
    expect(a.schema).toBe(SYSMAP_QUERY_SCHEMA);
    expect(a.item).toMatchObject({ id: "cli:check", name: "protoboard check", type: "cli-command" });
    const group = (kind: string, direction: string) => a.links.find((g) => g.kind === kind && g.direction === direction);
    expect(group("ships", "in")).toMatchObject({ label: "shipped by", items: [{ id: "pkg:@protoboardai/cli", type: "package", version: "1.0.0", status: "released" }] });
    expect(group("wraps", "in")?.items.map((n) => n.id)).toEqual(["mcp:project_check"]);
    expect(group("runs-command", "in")?.items.map((n) => n.id)).toContain("skill:board-make");
    expect(group("cites", "out")?.items.map((n) => n.id)).toEqual(["doc:docs/specs/foo.md"]);
    expect(Object.keys(group("ships", "in")!.items[0]!).sort()).toEqual(["id", "name", "status", "type", "version"]);
    // kinds in the model's order, out before in
    const kinds = a.links.map((g) => `${g.kind} ${g.direction}`);
    expect(kinds.indexOf("ships in")).toBeLessThan(kinds.indexOf("cites out"));
    // the same item by its key or its name; its problems come with it
    expect(((await map({ item: "check" }, { json: true })).data as MapItemAnswer).item.id).toBe("cli:check");
    expect(((await map({ item: "protoboard check" }, { json: true })).data as MapItemAnswer).item.id).toBe("cli:check");
    const secret = (await map({ item: "cli:secret" }, { json: true })).data as MapItemAnswer;
    expect(secret.problems.map((p) => p.reason)).toContain("CLI_UNDOCUMENTED");
    const text = (await map({ item: "mcp:project_check" })).text;
    expect(text).toMatch(/^mcp:project_check "project_check" \(MCP tool, 1\.0\.0; System design\)\n {2}Check the project$/m);
    expect(text).toMatch(/^wraps \(1\)\n {2}cli:check +cli-command +1\.0\.0$/m);
  });

  it("usage errors (exit 2) before anything is built: an unknown island or type names the choices, an unknown item the closest ids", async () => {
    await expect(map({ island: "nowhere" })).rejects.toThrow(/--island takes one of project, research, parts, system, pcb, cad, firmware, docs, mfg, simulation, packaging, protocols, playbooks, not "nowhere"/);
    await expect(map({ type: "gadget" })).rejects.toThrow(/--type takes one of package, extension, skill, .*doc, not "gadget"/);
    await expect(map({ item: "board-mak" })).rejects.toThrow(/no item "board-mak" in the System Map; closest: skill:board-make/);
    await expect(map({ item: "report" })).rejects.toThrow(/"report" names 2 items of the System Map: op:@protoboardai\/ext-a#report, op:@protoboardai\/ext-b#report; ask for one by its id/);
    await expect(map({ item: "cli:check", island: "pcb" })).rejects.toThrow(/--item takes no --island or --type/);
    await expect(map({ island: "" })).rejects.toThrow(/--island takes a discipline id/);
    await expect(map({}, { args: ["extra"] })).rejects.toThrow(/protoboard map takes no words/);
    await expect(map({ root: join(SCRATCH, "not-there") })).rejects.toThrow(/--root: no folder/);
  });

  it("--check: exit 1 when the map lists problems, after printing; without it the same map is exit 0", async () => {
    const checked = await map({ check: true });
    expect(checked.code).toBe(1);
    expect(checked.text).toMatch(/^Problems$/m);
    const query = await map({ check: true, type: "view" }, { json: true });
    expect(query.code).toBe(1);
    expect((query.data as MapListAnswer).total).toBe(2);
    expect(query.said.join("\n")).toMatch(/--check: the System Map lists \d+ problem\(s\) \(.*CLI_HELP_ORPHAN.*\)/);
    expect((await map({ check: false })).code).toBe(0);
  });

  it("writes nothing without --out, and with --out only that file (relative to the folder it runs in)", async () => {
    const before = listFiles(STACK);
    await map({});
    await map({ type: "skill" }, { json: true });
    expect(listFiles(STACK)).toEqual(before);
    const cwd = join(SCRATCH, "out-here");
    mkdirSync(cwd, { recursive: true });
    const r = await map({ out: "maps/stack.json" }, { cwd });
    expect(r.text).toMatch(new RegExp(`wrote ${join(cwd, "maps", "stack.json").replace(/\\/g, "\\\\")}$`));
    expect(listFiles(cwd)).toEqual(["maps/stack.json"]);
    expect(listFiles(STACK)).toEqual(before);
    const written = JSON.parse(readFileSync(join(cwd, "maps", "stack.json"), "utf8")) as SystemMap;
    expect(written.schema).toBe(SYSMAP_SCHEMA);
    // JSON stays the answer alone; where the file went is said beside it
    const j = await map({ out: "again.json", item: "cli:check" }, { json: true, cwd });
    expect((j.data as MapItemAnswer).item.id).toBe("cli:check");
    expect(j.said).toEqual([`wrote ${join(cwd, "again.json")}`]);
  });
});

describe("protoboard map from the command line: no project, no sign-in", () => {
  it("is local: no sign-in and no project", () => {
    expect(commandGate("map")).toEqual({ gate: "local" });
  });

  it("runs in an empty folder with no sign-in, and prints the whole map with --format json", async () => {
    const r = await cli(EMPTY, "map", "--root", STACK, "--format", "json");
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).schema).toBe(SYSMAP_SCHEMA);
    expect(r.stderr).not.toMatch(/sign in|protoboard login/i);
    expect(readdirSync(EMPTY)).toEqual([]);
  }, 60_000);

  it("exit codes: 1 for --check with problems, 2 for a usage error (as JSON with --format json)", async () => {
    const [check, usage, text] = await Promise.all([cli(EMPTY, "map", "--root", STACK, "--check"), cli(EMPTY, "map", "--root", STACK, "--item", "nothing-like-it", "--format", "json"), cli(EMPTY, "map", "--island", "nowhere")]);
    expect(check.code).toBe(1);
    expect(check.stdout).toMatch(/^System Map of the Protoboard stack/);
    expect(usage.code).toBe(2);
    expect(JSON.parse(usage.stdout).error).toMatch(/no item "nothing-like-it" in the System Map/);
    expect(text.code).toBe(2);
    expect(text.stderr).toMatch(/--island takes one of/);
  }, 60_000);

  it("the help and the switch read as the System Map reads them: map is a documented command", () => {
    const src = readFileSync(join(HERE, "../src/index.ts"), "utf8");
    expect(cliHelp(src).get("map")).toMatchObject({ forms: ["map"] });
    expect(cliHelp(src).get("map")!.description).toMatch(/^The System Map of the stack this CLI runs from/);
    expect(cliCases(src)!.has("map")).toBe(true);
    const tools = mcpTools(readFileSync(join(HERE, "../src/mcp/tools.ts"), "utf8"));
    expect(tools.find((t) => t.name === "stack_map")).toMatchObject({ title: "What the Protoboard stack can do", commands: ["map"] });
  });
});

// ---------------------------------------------------------------------------
// The MCP tool
// ---------------------------------------------------------------------------

describe("the stack_map MCP tool", () => {
  const clients: Client[] = [];
  const connect = async (cwd: string, env: Record<string, string> = {}) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("PROTOBOARD_"))) as Record<string, string>;
    const client = new Client({ name: "protoboard-test", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd, stderr: "pipe", env: { ...clean, HOME, USERPROFILE: HOME, PROTOBOARD_CONFIG_DIR: join(HOME, "protoboard"), PROTOBOARD_CREDENTIAL_STORE: "file", ...env } }));
    clients.push(client);
    return client;
  };
  const call = async (client: Client, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name: "stack_map", arguments: args }, undefined, { timeout: 240_000 })) as { content: { text: string }[]; isError?: boolean };
    return { data: JSON.parse(r.content[0]!.text), isError: r.isError === true };
  };
  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => undefined);
  });

  it("is specified like the others: its inputs, a description of what the System Map is, read only", () => {
    const spec = cliTools([]).find((t) => t.name === "stack_map")!;
    expect(Object.keys(spec.input).sort()).toEqual(["island", "item", "type"]);
    expect(spec.description).toMatch(/what the Protoboard stack on this machine can do/);
    expect(spec.description).toMatch(/packages, extensions, skills \(SOPs\).*operations.*checks, external tools, CLI commands, MCP tools, views, templates/);
    expect(spec.description).toMatch(/Reads only/);
    expect(spec.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(mapOverview({ stack: "1", layout: "monorepo", counts: {}, islands: [], stages: [], releases: [], problems: [], items: [1], links: [2], inputs: [3] })).not.toHaveProperty("items");
  });

  it("answers from this repository's stack in a folder that is no project: the overview, one item, and an unknown item", async () => {
    const client = await connect(EMPTY);
    const overview = await call(client);
    expect(overview.isError).toBe(false);
    expect(overview.data.islands.map((i: { id: string }) => i.id)).toEqual([...DISCIPLINE_ORDER]);
    expect(overview.data.counts.byType["mcp-tool"]).toBeGreaterThanOrEqual(17);
    expect(overview.data.items).toBeUndefined();
    expect(overview.data.links).toBeUndefined();
    expect(overview.data.next).toMatch(/island.*type.*item/);
    const one = await call(client, { item: "mcp:stack_map" });
    expect(one.isError).toBe(false);
    expect(one.data.item).toMatchObject({ id: "mcp:stack_map", type: "mcp-tool" });
    expect(one.data.links.find((g: { kind: string; direction: string }) => g.kind === "wraps" && g.direction === "out").items.map((n: { id: string }) => n.id)).toEqual(["cli:map"]);
    const command = await call(client, { item: "cli:map" });
    expect(command.data.item).toMatchObject({ id: "cli:map", name: "protoboard map" });
    // a command that is in the help and in the switch: neither undocumented nor an orphan
    expect(overview.data.problems.filter((p: { item?: string; reason: string }) => p.item === "cli:map" || p.item === "mcp:stack_map" || /CLI_UNDOCUMENTED|CLI_HELP_ORPHAN|SOURCE_UNPARSED/.test(p.reason))).toEqual([]);
    const unknown = await call(client, { item: "stack_mapp" });
    expect(unknown.isError).toBe(true);
    expect(unknown.data.error).toMatch(/closest: mcp:stack_map/);
    expect(readdirSync(EMPTY)).toEqual([]);
  }, 240_000);

  it("keeps the agent's words values: the CLI line it runs, and item with island refused before it runs", async () => {
    const proj = join(SCRATCH, "echo-cli");
    const bin = join(proj, "node_modules", "@protoboardai", "cli", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "protoboard.mjs"), `process.stdout.write(JSON.stringify({ args: process.argv.slice(2) }) + "\\n");\n`);
    const client = await connect(EMPTY, { PROTOBOARD_PROJECT_DIR: proj });
    expect((await call(client, { item: "cli:map" })).data.args).toEqual(["map", "--item=cli:map", "--format=json", "--"]);
    expect((await call(client, { island: "pcb", type: "skill" })).data.args).toEqual(["map", "--island=pcb", "--type=skill", "--format=json", "--"]);
    const dashed = await call(client, { item: "--root=/" });
    expect(dashed.isError).toBe(true);
    expect(dashed.data.error).toMatch(/`item` cannot start with a dash/);
    const both = await call(client, { item: "cli:map", island: "pcb" });
    expect(both.isError).toBe(true);
    expect(both.data.error).toMatch(/give it alone/);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The dev server's route
// ---------------------------------------------------------------------------

describe("the System Map source the dev route serves", () => {
  const fakeMap = (n: number) => ({ stack: String(n) }) as unknown as SystemMap;
  const graphOf = (m: SystemMap) => ({ stack: m.stack }) as unknown as ReturnType<typeof sysmapGraph>;

  it("builds on the first request, keeps the map, checks it at most every 10 s and rebuilds it when stale", async () => {
    let t = 0;
    let n = 0;
    let fresh = true;
    const s = sysmapSource({ build: async () => fakeMap(++n), fresh: async () => fresh, graph: graphOf, now: () => t });
    expect(SYSMAP_CHECK_MS).toBe(10_000);
    expect((await s.graph()).stack).toBe("1");
    t = 9_999;
    expect((await s.graph()).stack).toBe("1");
    expect(s.stats).toEqual({ builds: 1, checks: 0 });
    t = 10_000;
    expect((await s.graph()).stack).toBe("1");
    expect(s.stats).toEqual({ builds: 1, checks: 1 });
    // checked at 10 000: the next check is due at 20 000
    t = 15_000;
    fresh = false;
    expect((await s.graph()).stack).toBe("1");
    t = 20_000;
    expect((await s.graph()).stack).toBe("2");
    expect(s.stats).toEqual({ builds: 2, checks: 2 });
  });

  it("requests that arrive during a build share it", async () => {
    let release!: () => void;
    let n = 0;
    const s = sysmapSource({ build: () => new Promise<SystemMap>((ok) => (release = () => ok(fakeMap(++n)))), fresh: async () => true, graph: graphOf });
    const all = Promise.all([s.graph(), s.graph(), s.graph()]);
    release();
    expect((await all).map((g) => g.stack)).toEqual(["1", "1", "1"]);
    expect(s.stats.builds).toBe(1);
  });

  it("a build that fails answers 500 with what failed, and the next request tries again", async () => {
    let fail = true;
    const s = sysmapSource({ build: async () => (fail ? Promise.reject(new Error("no stack here")) : fakeMap(7)), fresh: async () => true, graph: graphOf });
    expect(await sysmapAnswer(s)).toEqual({ status: 500, body: { error: "the System Map could not be built: no stack here" } });
    fail = false;
    expect(await sysmapAnswer(s)).toMatchObject({ status: 200, body: { graph: { stack: "7" } } });
  });
});

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: IncomingMessage["headers"] }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
    });
    req.on("error", fail);
    req.end();
  });
}

describe("GET /__protoboard/sysmap in protoboard dev", () => {
  // the project lives in the repository, so it resolves the stack's packages; the stack it maps is the fixture
  const dir = join(HERE, ".tmp", "sysmap-dev");
  let dev: DevServer;
  beforeAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "sysmap-dev", private: true, type: "module" }),
      "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "sysmap-dev", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`,
      "src/sys.uhd.ts": `export const SYS = { id: "sys", name: "System", interfaces: [], children: [] };\n`,
      "viewer-lib/web-viewer.js": "export function mountWebViewer() {}\n",
      "viewer-lib/web-viewer.css": "body {}\n",
    };
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    dev = await startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "viewer-lib"), record: false, stackRoot: STACK, log: () => undefined });
  }, 60_000);
  afterAll(async () => {
    await dev?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers the view's graph of the stack: items, links, islands, stages, releases and problems; never the inputs", async () => {
    const before = listFiles(STACK);
    const r = await get(dev.port, SYSMAP_ROUTES.data);
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const { graph } = JSON.parse(r.body);
    expect(Object.keys(graph).sort()).toEqual(["counts", "islands", "items", "layout", "links", "problems", "releases", "stack", "stages"]);
    expect(graph.items.map((i: { id: string }) => i.id)).toContain("cli:check");
    expect(r.body).not.toMatch(/"inputs"|sha256:/);
    // built in memory: nothing is written into the stack
    expect(listFiles(STACK)).toEqual(before);
  }, 60_000);

  it("lets a VS Code viewer tab read it from its own origin, and no other page", async () => {
    const webview = "vscode-webview://1a2b3c";
    const r = await get(dev.port, SYSMAP_ROUTES.data, { origin: webview });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(webview);
    expect((await get(dev.port, SYSMAP_ROUTES.data, { origin: "https://evil.example" })).headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("the page creates the System Map data beside the Atlas's and hands it to the viewer", async () => {
    const script = (await get(dev.port, "/__protoboard/dev.js")).body;
    expect(script).toContain(`import { createDevSysmapData } from "./viewer/web-viewer.js"`);
    expect(script).toContain(`const sysmapData = createDevSysmapData({ base: here("__protoboard/sysmap") })`);
    expect(script).toMatch(/atlasData,\n {2}sysmapData,/);
    expect(script).toContain("window.protoboardDev = { viewer, relay, client, atlasData, sysmapData,");
  });

  it("a stack folder that is no stack still answers (an empty map that lists STACK_NOT_FOUND)", async () => {
    const other = await startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "viewer-lib"), record: false, stackRoot: EMPTY, log: () => undefined });
    try {
      const r = await get(other.port, SYSMAP_ROUTES.data);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).graph.problems.map((p: { reason: string }) => p.reason)).toContain("STACK_NOT_FOUND");
      expect(existsSync(join(EMPTY, ".protoboard"))).toBe(false);
    } finally {
      await other.close();
    }
  }, 60_000);
});
