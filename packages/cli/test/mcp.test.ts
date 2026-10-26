/**
 * The Protoboard MCP server (PB-930, docs/specs/agents-and-mcp.md §2),
 * driven by the SDK's own client over stdio, the way an agent starts it:
 * the instructions, the tools and their annotations, every tool against a
 * project and against an empty folder, the resources and the prompts.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION, ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listTemplates } from "@protoboardai/core";
import type { UhdModuleDef } from "@protoboardai/cloud/client";
import { Blobs, draft, startCloud, type CloudService } from "../../core/test/cloud.js";
import { DESCRIPTION_LIMIT, guideText, serverInstructions } from "../src/mcp/instructions.js";
import { RESULT_LIMIT, sweepSpill, toResult } from "../src/mcp/server.js";
import { cliArgs, cliTools, failure, readCliJson } from "../src/mcp/tools.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "../../..");
const CLI = join(HERE, "../bin/protoboard.mjs");
const EXAMPLE = join(ROOT, "examples", "smart-bottle");
/** Scratch projects live in the repository, so they resolve the stack's packages as a project's node_modules would. */
const TMP = join(HERE, ".tmp-mcp");
const EMPTY = mkdtempSync(join(tmpdir(), "pb-mcp-empty-"));
const HOME = mkdtempSync(join(tmpdir(), "pb-mcp-home-"));

const TOOLS = ["project_status", "project_init", "project_check", "project_inspect", "project_build", "project_layout", "parts_search", "parts_add", "parts_list", "skills_list", "skill_read", "bom", "release_check"];
const WRITES = ["project_init", "project_build", "project_layout", "parts_add"];

const PART: UhdModuleDef = {
  id: "test-mcp-regulator",
  name: "MCP test regulator",
  manufacturer: "Test",
  part_number: "REG-33",
  interfaces: [{ id: "vin", name: "VIN", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["sink"] }] }],
};

let svc: CloudService;
const clients: Client[] = [];

/** An MCP client connected to `protoboard mcp` started in `cwd`: no sign-in, a scratch home, the test parts service. */
async function connect(cwd: string, env: Record<string, string> = {}): Promise<Client> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("PROTOBOARD_") && k !== "npm_config_registry")) as Record<string, string>;
  const client = new Client({ name: "protoboard-test", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd, stderr: "pipe", env: { ...clean, HOME, PROTOBOARD_CONFIG_DIR: join(HOME, "protoboard"), PROTOBOARD_CREDENTIAL_STORE: "file", PROTOBOARD_CLOUD_URL: svc.url, ...env } }),
  );
  clients.push(client);
  return client;
}

/** Call a tool and read its JSON text. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 240_000 })) as { content: { type: string; text: string }[]; isError?: boolean };
  expect(r.content).toHaveLength(1);
  expect(r.content[0].type).toBe("text");
  let data: any;
  try {
    data = JSON.parse(r.content[0].text);
  } catch {
    data = r.content[0].text;
  }
  return { data, isError: r.isError === true, text: r.content[0].text };
}

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  svc = await startCloud();
  const blobs = new Blobs();
  await svc.client.publish(draft(blobs, PART), blobs.source);
}, 120_000);

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
  await svc?.stop();
  for (const d of [TMP, EMPTY, HOME]) rmSync(d, { recursive: true, force: true });
});

describe("the folder the tools work in", () => {
  it("is the client's first root, and the new one after the client says its roots changed", async () => {
    const [first, second] = [mkdtempSync(join(tmpdir(), "pb-mcp-root1-")), mkdtempSync(join(tmpdir(), "pb-mcp-root2-"))];
    let roots = [{ uri: pathToFileURL(first).href, name: "first" }];
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("PROTOBOARD_") && k !== "npm_config_registry")) as Record<string, string>;
    const client = new Client({ name: "protoboard-test-roots", version: "0" }, { capabilities: { roots: { listChanged: true } } });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots }));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd: HOME, stderr: "pipe", env: { ...clean, HOME, PROTOBOARD_CONFIG_DIR: join(HOME, "protoboard"), PROTOBOARD_CREDENTIAL_STORE: "file", PROTOBOARD_CLOUD_URL: svc.url } }));
    clients.push(client);
    expect((await call(client, "project_status")).data.folder).toBe(first);
    roots = [{ uri: pathToFileURL(second).href, name: "second" }];
    await client.sendRootsListChanged();
    await expect.poll(async () => (await call(client, "project_status")).data.folder, { timeout: 60_000, interval: 200 }).toBe(second);
    for (const d of [first, second]) rmSync(d, { recursive: true, force: true });
  }, 180_000);

  it("a client that gives none and starts the server in the home folder (a desktop app) is told to ask for a folder and pass it as an absolute dir", async () => {
    const client = await connect(HOME);
    const status = (await call(client, "project_status")).data;
    expect(status.folder).toBe(HOME);
    expect(status.next[0]).toMatch(/not a folder the user chose\. Ask the user which folder to work in, and pass it as an absolute `dir`/);
    // a folder that was given, or one the server was started in, is not questioned
    expect((await call(client, "project_status", { dir: EMPTY })).data.next.join(" ")).not.toMatch(/not a folder the user chose/);
  }, 180_000);
});

describe("what an agent is told", () => {
  const templates = listTemplates().map((t) => t.id);
  const text = serverInstructions(templates);

  it("fits the limit clients cut instructions at, with room to spare", () => {
    expect(text.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    for (const t of cliTools(templates)) expect(t.description.length, t.name).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
  });

  it("says what Protoboard is, that it is not the alpha web app, and where to start", () => {
    expect(text).toMatch(/UHD, the open Unified Hardware Description/);
    expect(text).toMatch(/NOT the Protoboard alpha web app/);
    expect(text).toMatch(/no browser board/);
    expect(text).toMatch(/Start with project_status/);
    for (const t of templates) expect(text).toContain(t);
    expect(templates).toEqual(expect.arrayContaining(["drone", "wearable", "iot"]));
    expect(text).toMatch(/AGENTS\.md/);
    expect(text).toMatch(/build-a-project skill/);
    expect(text).toMatch(/node_modules\/@deltarobotics\/uhd\/docs/);
  });

  it("gives the rules that matter", () => {
    expect(text).toMatch(/Cite a source/);
    expect(text).toMatch(/Never edit generated files .* or parts\/catalog/);
    expect(text).toMatch(/When interfaces do not fit, stop/);
    expect(text).toMatch(/Never put a sign-in, token or key in a file/);
    expect(text).toMatch(/never publish, order or upload/);
  });

  it("names only tools that exist", () => {
    const names = cliTools(templates).map((t) => t.name);
    for (const m of text.matchAll(/\b((?:project|parts|skills?|release)_[a-z]+|bom)\b/g)) expect(names, m[1]).toContain(m[1]);
  });
});

describe("the server's surface", () => {
  let client: Client;
  beforeAll(async () => {
    client = await connect(EMPTY);
  }, 60_000);

  it("speaks the SDK's current protocol and introduces itself", () => {
    expect(LATEST_PROTOCOL_VERSION).toBe("2025-11-25");
    expect(client.getServerVersion()).toMatchObject({ name: "protoboard-stack", title: "Protoboard Stack", version: JSON.parse(readFileSync(join(HERE, "../package.json"), "utf8")).version });
    expect(client.getInstructions()).toBe(serverInstructions(listTemplates().map((t) => t.id)));
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {}, prompts: {} });
  });

  it("the SDK is pinned to an exact version", () => {
    const deps = JSON.parse(readFileSync(join(HERE, "../package.json"), "utf8")).dependencies as Record<string, string>;
    expect(deps["@modelcontextprotocol/sdk"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.parse(readFileSync(join(ROOT, "node_modules/@modelcontextprotocol/sdk/package.json"), "utf8")).version).toBe(deps["@modelcontextprotocol/sdk"]);
  });

  it("lists the tools, each with a schema, a description and annotations that say whether it writes", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS);
    for (const t of tools) {
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.description!.length, t.name).toBeGreaterThan(80);
      expect(t.annotations, t.name).toBeDefined();
      const writes = WRITES.includes(t.name);
      // every tool runs the project's code, so none is read-only: a client asks before it runs (PB-1048)
      expect(t.annotations!.readOnlyHint, t.name).toBe(false);
      expect(t.annotations!.destructiveHint, t.name).toBe(false);
      expect(t.description, t.name).toContain("It runs the project's own code (protoboard.config.ts and its model files)");
      if (writes) expect(t.description, t.name).toMatch(/CHANGES FILES/);
      else expect(t.description, t.name).toMatch(/Reads only|writes nothing|Writes nothing/);
    }
  });

  it("has no tool that publishes, orders, uploads, signs in or shows prices by source", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).filter((n) => /publish|order|upload|login|logout|price|offer|usage|token|credential|run|release$/.test(n))).toEqual([]);
    // and none takes a token, a key or a service address
    for (const t of tools) expect(Object.keys(t.inputSchema.properties ?? {}).filter((k) => /token|key|secret|password|url/i.test(k)), t.name).toEqual([]);
  });

  it("offers the guide as a resource, and two prompts", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(["protoboard://guide"]);
    const guide = await client.readResource({ uri: "protoboard://guide" });
    const guideSaid = (guide.contents[0] as { text: string }).text;
    expect(guideSaid).toMatch(/NOT the Protoboard alpha web app[\s\S]*npm install[\s\S]*protoboard login/);
    expect(guideSaid).toBe(guideText(listTemplates().map((t) => t.id)));
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["continue_project", "new_project"]);
    const p = await client.getPrompt({ name: "new_project", arguments: { what: "a soil moisture sensor" } });
    expect((p.messages[0].content as { text: string }).text).toMatch(/a soil moisture sensor[\s\S]*project_status[\s\S]*Do not look for a Protoboard web app/);
  });

  it("refuses arguments that are not the schema's", async () => {
    const r = (await client.callTool({ name: "parts_add", arguments: { parts: [] } })) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    const unknown = (await client.callTool({ name: "parts_publish", arguments: {} }).catch((e: Error) => ({ isError: true, content: [{ text: e.message }] }))) as { isError?: boolean; content: { text: string }[] };
    expect(unknown.isError).toBe(true);
  });
});

describe("in an empty folder", () => {
  let client: Client;
  beforeAll(async () => {
    client = await connect(EMPTY);
  }, 60_000);

  it("project_status says there is no project, what Protoboard is, the templates and what to do", async () => {
    const { data, isError } = await call(client, "project_status");
    expect(isError).toBe(false);
    expect(data.project).toBeNull();
    expect(data.folder).toBe(EMPTY);
    expect(data.about).toMatch(/NOT the Protoboard alpha web app/);
    expect(data.protoboard).toMatchObject({ cli: CLI, cliFrom: "server" });
    expect(data.templates.map((t: { id: string }) => t.id).sort()).toEqual(["drone", "iot", "wearable"]);
    expect(data.account).toMatchObject({ service: svc.url, signedIn: false });
    expect(data.next.join(" ")).toMatch(/not a Protoboard project.*project_init.*nothing to install/);
  });

  it("every project tool says the folder is not a project, as a result an agent can act on", async () => {
    for (const [name, args] of [
      ["project_check", {}],
      ["project_inspect", {}],
      ["project_build", {}],
      ["project_layout", {}],
      ["parts_search", { query: "regulator" }],
      ["parts_add", { parts: ["test-mcp-regulator"] }],
      ["parts_list", {}],
      ["skills_list", {}],
      ["skill_read", { id: "build-a-project" }],
      ["bom", {}],
      ["release_check", {}],
    ] as const) {
      const { data, isError } = await call(client, name, args);
      expect(isError, name).toBe(true);
      expect(data.error, name).toMatch(/protoboard\.config\.ts/);
      expect(data.hint, name).toMatch(/not a Protoboard project.*project_init/);
    }
    // nothing was written
    expect(existsSync(join(EMPTY, ".protoboard"))).toBe(false);
    expect(existsSync(join(EMPTY, "parts"))).toBe(false);
  }, 240_000);

  it("a folder that does not exist is said so", async () => {
    const { data, isError } = await call(client, "project_check", { dir: "nowhere" });
    expect(isError).toBe(true);
    expect(data.error).toBe(`no folder ${join(EMPTY, "nowhere")}`);
  });

  it("project_init creates a project there, with its CLAUDE.md, and never tells the agent to run npm install on its own", async () => {
    const { data, isError } = await call(client, "project_init", { dir: "sensor", name: "soil-sensor" });
    expect(isError).toBe(false);
    expect(data.root).toBe(join(EMPTY, "sensor"));
    expect(data.files).toEqual(expect.arrayContaining(["protoboard.config.ts", "AGENTS.md", "CLAUDE.md", "package.json"]));
    // a CLI run from the stack's repository makes a project-local stack: only then is npm named, and only with the user's yes
    expect(data.next[0]).toBe(`This project installs its own packages (a project-local stack): ask the user before running \`npm install\` in ${join(EMPTY, "sensor")}.`);
    expect(readFileSync(join(EMPTY, "sensor", "AGENTS.md"), "utf8")).toMatch(/^# soil-sensor/);
    // the project is there but not installed: the status and the tools say what is missing
    const status = await call(client, "project_status", { dir: "sensor" });
    expect(status.data.project).toMatchObject({ root: join(EMPTY, "sensor"), installed: false });
    expect(status.data.next[0]).toMatch(/Run `protoboard stack link`.*never `npm install`/);
    const check = await call(client, "project_check", { dir: "sensor" });
    expect(check.isError).toBe(true);
    expect(check.data.hint).toMatch(/packages are not set up on this machine\. Run `protoboard stack link`/);
    // a second init there is refused, by the CLI
    const again = await call(client, "project_init", { dir: "sensor" });
    expect(again.isError).toBe(true);
    expect(again.data.error).toMatch(/already|exists|not empty/i);
  }, 120_000);

  it("an unknown template is refused with the ones that exist", async () => {
    const { data, isError } = await call(client, "project_init", { dir: "x", template: "submarine" });
    expect(isError).toBe(true);
    expect(data.error).toMatch(/submarine/);
    expect(existsSync(join(EMPTY, "x"))).toBe(false);
  });
});

describe("in an example project", () => {
  let client: Client;
  beforeAll(async () => {
    client = await connect(EXAMPLE);
  }, 60_000);

  it("project_status finds the project and what doctor finds; the project's AGENTS.md is a resource", async () => {
    const { data, isError } = await call(client, "project_status");
    expect(isError).toBe(false);
    expect(data.project.root).toBe(EXAMPLE);
    expect(data.project.installed).toBe(true);
    expect(data.project.doctor.extensions.map((e: { id: string }) => e.id)).toContain("@protoboardai/ext-hardware");
    expect(data.project.doctor.skills.length).toBeGreaterThan(5);
    expect(data.templates).toBeUndefined();
    expect(data.next.join(" ")).toMatch(/AGENTS\.md.*build-a-project/);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["protoboard://guide", "protoboard://project/AGENTS.md"]);
    const agents = await client.readResource({ uri: "protoboard://project/AGENTS.md" });
    expect((agents.contents[0] as { text: string }).text).toBe(readFileSync(join(EXAMPLE, "AGENTS.md"), "utf8"));
  }, 240_000);

  it("project_check returns the validators, the counts and the diagnostics at the severity asked for", async () => {
    const { data, isError } = await call(client, "project_check");
    expect(isError).toBe(false);
    expect(data.ok).toBe(true);
    expect(data.counts.error).toBe(0);
    expect(data.checks.length).toBeGreaterThan(3);
    expect(data.diagnostics.every((d: { severity: string }) => d.severity !== "info")).toBe(true);
    const all = await call(client, "project_check", { severity: "info" });
    expect(all.data.diagnostics.length).toBe(all.data.counts.error + all.data.counts.warning + all.data.counts.info);
    expect(all.data.notShown).toBeUndefined();
  }, 240_000);

  it("project_inspect gives the system, and one instance", async () => {
    const { data } = await call(client, "project_inspect");
    expect(data.project).toBe("smart-bottle");
    expect(data.children.length).toBeGreaterThan(1);
    const path = data.children[0].path as string;
    const one = await call(client, "project_inspect", { instance: path });
    expect(one.data).toMatchObject({ path });
    expect(one.data.interfaces).toBeDefined();
    const none = await call(client, "project_inspect", { instance: "no/such/instance" });
    expect(none.isError).toBe(true);
    expect(none.data.error).toMatch(/no instance "no\/such\/instance"/);
  }, 240_000);

  it("parts_list, skills_list, skill_read, bom and release_check return the CLI's JSON", async () => {
    const parts = await call(client, "parts_list");
    expect(parts.data.counts.total).toBeGreaterThan(3);
    expect(parts.data.checked).toBeUndefined();
    const skills = await call(client, "skills_list");
    expect(skills.data.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(["build-a-project", "uhd-part-research", "release"]));
    const skill = await call(client, "skill_read", { id: "build-a-project" });
    expect(skill.isError).toBe(false);
    expect(skill.text).toMatch(/^# Skill build-a-project \(@protoboardai\/ext-hardware\)/);
    expect(skill.text).toContain(readFileSync(join(ROOT, "packages/ext-hardware/skills/build-a-project/SKILL.md"), "utf8").slice(0, 400));
    const missing = await call(client, "skill_read", { id: "no-such-skill" });
    expect(missing.isError).toBe(true);
    expect(missing.data.installed).toContain("build-a-project");
    const bom = await call(client, "bom");
    expect(bom.isError).toBe(false);
    // the design's bill (PB-933), whole in one answer: each line with its chosen offer's quote and how many offers
    // it has, not the list of them (a real project's bill is otherwise longer than a result may be)
    expect(bom.data.schema).toBe("protoboard.bom/v0");
    expect(bom.data.truncated).toBeUndefined();
    const lines = (bom.data.groups as { lines: Record<string, unknown>[] }[]).flatMap((g) => g.lines);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(typeof l.offerCount).toBe("number");
      expect(l.offers).toBeUndefined();
      expect(l.quotes).toBeUndefined();
    }
    expect(bom.data.fx.rates).toBeUndefined();
    const release = await call(client, "release_check");
    expect(release.data.operation).toBe("release");
    expect(["succeeded", "failed"]).toContain(release.data.status);
  }, 300_000);
});

describe("in a scratch project (the tools that write)", () => {
  const dir = join(TMP, "scratch");
  let client: Client;
  beforeAll(async () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "protoboard.config.ts"), `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
    writeFileSync(join(dir, "src/sys.uhd.ts"), `export const SYS = { id: "sys", name: "System", interfaces: [], children: [] };\n`);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "scratch", private: true, type: "module" }) + "\n");
    client = await connect(TMP);
  }, 60_000);

  it("parts_search finds a library part (a local service that signs no one in: no account to ask for)", async () => {
    const { data, isError } = await call(client, "parts_search", { dir: "scratch", query: "regulator" });
    expect(isError).toBe(false);
    expect(data.service).toBe(svc.url);
    expect(data.parts.map((p: { partId: string }) => p.partId)).toEqual(["test-mcp-regulator"]);
    const none = await call(client, "parts_search", { dir: "scratch", query: "zzzz-nothing" });
    expect(none.data.parts).toEqual([]);
  }, 120_000);

  it("parts_add vendors it into parts/catalog and pins it in parts/origins.json", async () => {
    const { data, isError } = await call(client, "parts_add", { dir: "scratch", parts: ["test-mcp-regulator"] });
    expect(isError).toBe(false);
    expect(data.results).toEqual([expect.objectContaining({ id: "test-mcp-regulator", revision: 1 })]);
    expect(JSON.parse(readFileSync(join(dir, "parts/origins.json"), "utf8")).definitions["test-mcp-regulator"]).toMatchObject({ tier: "catalog", revision: 1 });
    const list = await call(client, "parts_list", { dir: "scratch", checkUpdates: true });
    expect(list.data.parts.find((p: { id: string }) => p.id === "test-mcp-regulator")).toMatchObject({ tier: "catalog" });
    expect(list.data.checked).toBeDefined();
    const unknown = await call(client, "parts_add", { dir: "scratch", parts: ["no-such-part"] });
    expect(JSON.stringify(unknown.data)).toMatch(/no-such-part/);
  }, 180_000);

  it("project_build writes only derived data under .protoboard/build", async () => {
    const { data, isError } = await call(client, "project_build", { dir: "scratch" });
    expect(isError).toBe(false);
    expect(data.file).toMatch(/\.protoboard\/build\/resolved\.json$/);
    expect(existsSync(join(dir, ".protoboard/build/resolved.json"))).toBe(true);
    expect(data.bundle.file).toMatch(/\.protoboard\/build\//);
  }, 120_000);
});

describe("what an agent gives is a value, never an option of the CLI", () => {
  it("options are joined to their names, a value that starts with a dash is refused, and the rest follows --", () => {
    expect(cliArgs(["parts", "search"], { limit: 20, library: "protoboard", tag: undefined, cursor: "" }, ["buck", "--url", "http://x", "", "-5V"])).toEqual(["parts", "search", "--limit=20", "--library=protoboard", "--format=json", "--", "buck", "--url", "http://x", "-5V"]);
    expect(cliArgs(["check"])).toEqual(["check", "--format=json", "--"]);
    for (const bad of ["--allow-dirty", "-x", " --url", "--"]) expect(() => cliArgs(["release", "--check"], { version: bad }), bad).toThrow(/`version` cannot start with a dash/);
    expect(() => cliArgs(["bom"], { release: "1.0\n--url" })).toThrow(/line break/);
    // a number is the schema's, not text: it is passed as it is
    expect(cliArgs(["x"], { limit: -1 })).toEqual(["x", "--limit=-1", "--format=json", "--"]);
  });

  it("every tool's command line keeps the agent's words behind --, seen by a CLI that prints what it was given", async () => {
    const proj = join(EMPTY, "echo-cli");
    const bin = join(proj, "node_modules", "@protoboardai", "cli", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(proj, "protoboard.config.ts"), "");
    writeFileSync(join(bin, "protoboard.mjs"), `process.stdout.write(JSON.stringify({ args: process.argv.slice(2) }) + "\\n");\n`);
    const client = await connect(EMPTY);
    const args = async (name: string, a: Record<string, unknown>) => (await call(client, name, { dir: "echo-cli", ...a })).data.args as string[];
    /** Whatever precedes `--` is the tool's own; nothing an agent gave may stand there on its own. */
    const own = (line: string[]) => line.slice(0, line.indexOf("--"));
    const hostile = ["--url", "http://127.0.0.1:9/x", "--allow-dirty", "--help", "--format", "text", "--cwd", "/", "-h"];

    const search = await args("parts_search", { query: `buck ${hostile.join(" ")} -5V`, library: "protoboard", taxonomy: "power/regulators", limit: 5 });
    expect(own(search)).toEqual(["parts", "search", "--taxonomy=power/regulators", "--limit=5", "--library=protoboard", "--format=json"]);
    expect(search.slice(search.indexOf("--") + 1)).toEqual(["buck", ...hostile, "-5V"]);
    const add = await args("parts_add", { parts: ["--url", "http://127.0.0.1:9/x", "a-part@2"] });
    expect(add).toEqual(["parts", "add", "--format=json", "--", "--url", "http://127.0.0.1:9/x", "a-part@2"]);
    expect(await args("project_inspect", { instance: "--help" })).toEqual(["inspect", "--format=json", "--", "--help"]);
    expect(await args("bom", { release: "0.1.0" })).toEqual(["bom", "--release=0.1.0", "--format=json", "--"]);
    expect(await args("release_check", { version: "0.2.0-rc.1" })).toEqual(["release", "--check", "--version=0.2.0-rc.1", "--format=json", "--"]);
    expect(await args("parts_list", { checkUpdates: true })).toEqual(["parts", "list", "--check", "--format=json", "--"]);

    // an option's value that would be read as another option never reaches the CLI
    const refused: [string, Record<string, unknown>][] = [
      ["release_check", { version: "--allow-dirty" }],
      ["bom", { release: "--url=http://127.0.0.1:9/x" }],
      ["parts_add", { parts: ["a-part"], library: "--url" }],
      ...["taxonomy", "domain", "protocol", "tag", "cursor", "library"].map((k): [string, Record<string, unknown>] => ["parts_search", { query: "x", [k]: "--url" }]),
    ];
    for (const [name, a] of refused) {
      const r = await call(client, name, { dir: "echo-cli", ...a });
      expect(r.isError, `${name} ${JSON.stringify(a)}`).toBe(true);
      expect(r.data.error, name).toMatch(/cannot start with a dash/);
      expect(r.data.args, name).toBeUndefined();
    }
    for (const a of [{ template: "--no-parts" }, { name: "--local" }]) {
      const r = await call(client, "project_init", { dir: "made-by-echo", ...a });
      expect(r.isError, JSON.stringify(a)).toBe(true);
      expect(r.data.error).toMatch(/cannot start with a dash/);
    }
    expect(existsSync(join(EMPTY, "made-by-echo"))).toBe(false);
  }, 120_000);

  it("the real CLI: a search for dashed words is a search of the project's own library, and a release check cannot be told to skip a precondition", async () => {
    const dir = join(TMP, "dashes");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "protoboard.config.ts"), `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
    writeFileSync(join(dir, "src/sys.uhd.ts"), `export const SYS = { id: "sys", name: "System", interfaces: [], children: [] };\n`);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dashes", private: true, type: "module" }) + "\n");
    const client = await connect(TMP);
    for (const query of ["regulator --url http://127.0.0.1:9/x", "--help", "regulator --format text", "-5V regulator", "--cwd / regulator"]) {
      const r = await call(client, "parts_search", { dir: "dashes", query });
      expect(r.isError, query).toBe(false);
      // the service is the project's, whatever the words say; the answer is the search's JSON, not help text
      expect(r.data.service, query).toBe(svc.url);
      expect(Array.isArray(r.data.parts), query).toBe(true);
    }
    const add = await call(client, "parts_add", { dir: "dashes", parts: ["--url", "http://127.0.0.1:9/x"] });
    expect(JSON.stringify(add.data)).not.toMatch(/cannot reach/);
    expect(existsSync(join(dir, "parts", "catalog", "test-mcp-regulator"))).toBe(false);
    const release = await call(client, "release_check", { dir: "dashes", version: "--allow-dirty" });
    expect(release.isError).toBe(true);
    expect(release.data.error).toMatch(/`version` cannot start with a dash/);
    const help = await call(client, "project_inspect", { dir: "dashes", instance: "--help" });
    expect(help.isError).toBe(true);
    expect(help.data.error).toMatch(/no instance "--help"/);
  }, 240_000);
});

describe("the sign-in gate and other refusals", () => {
  it("a command that needs a sign-in is a normal result that says what to ask the user", () => {
    for (const message of [
      "Not signed in to https://parts.example (`protoboard login`).",
      "Searching the Protoboard library needs a Protoboard account: sign in with `protoboard login` (not signed in to https://parts.example).",
      "Protoboard needs a signed-in account: run `protoboard login`",
      "sign-in required to use this command",
    ]) {
      const r = failure(message, EMPTY);
      expect(r.isError, message).toBeUndefined();
      expect(r.data).toMatchObject({ signInRequired: true, message });
      expect((r.data as { action: string }).action).toMatch(/Ask the user to sign in.*Protoboard: Sign In.*`protoboard login`.*never write a sign-in to a file/);
    }
    expect(failure("no instance \"x\"", EMPTY)).toMatchObject({ isError: true, data: { error: 'no instance "x"' } });
  });

  it("reads the CLI's JSON, its {error} and its silence", () => {
    expect(readCliJson({ code: 0, stdout: '{"a":1}\n', stderr: "" })).toEqual({ ok: true, data: { a: 1 } });
    expect(readCliJson({ code: 1, stdout: '{"checks":[],"diagnostics":[]}', stderr: "" }).ok).toBe(true);
    expect(readCliJson({ code: 2, stdout: '{"error":"nope"}\n', stderr: "" })).toEqual({ ok: false, message: "nope" });
    expect(readCliJson({ code: 3, stdout: '{"error":"sign in","code":"SIGN_IN_REQUIRED","access":{"allowed":false}}\n', stderr: "" })).toEqual({ ok: false, message: "sign in", code: "SIGN_IN_REQUIRED" });
    // a result that happens to have an "error" field among others is data
    expect(readCliJson({ code: 0, stdout: '{"error":"x","results":[]}', stderr: "" }).ok).toBe(true);
    expect(failure("anything", EMPTY, "SIGN_IN_REQUIRED").data).toMatchObject({ signInRequired: true });
    expect(readCliJson({ code: 2, stdout: "", stderr: "protoboard: broken\n" })).toEqual({ ok: false, message: "broken" });
    expect(readCliJson({ code: 3, stdout: "", stderr: "" })).toEqual({ ok: false, message: "the command printed nothing (exit 3)" });
  });

  it("never tells an agent to run a bare `npx protoboard`: outside an installed project npx would fetch someone else's package of that name (the security review's R6)", () => {
    const templates = listTemplates().map((t) => t.id);
    const said = [guideText(templates), serverInstructions(templates), ...cliTools(templates).map((t) => t.description)].join("\n");
    // every `npx … protoboard` is told not to install; the one bare mention is the sentence that forbids it
    const bare = [...said.matchAll(/npx (?!--no-install )protoboard[^\n]*/g)].map((m) => m[0]);
    expect(bare.every((line) => /^npx protoboard\\?`: npx would fetch an unrelated public package/.test(line)), bare.join("\n")).toBe(true);
    expect(guideText(templates)).toMatch(/Never run a bare `npx protoboard`/);
    expect(guideText(templates)).toMatch(/`protoboard doctor`/);
    // one install story (PB-1018): npm only for a project-local stack the user asked for
    for (const text of [guideText(templates), serverInstructions(templates), ...cliTools(templates).map((t) => t.description)])
      for (const m of text.matchAll(/[^.\n]*npm install[^.\n]*/g)) expect(m[0], m[0]).toMatch(/never|Never|project-local/);
  });

  it("how to sign in names the route that always exists: the VS Code extension, for a user who has no `protoboard` command", () => {
    const action = (failure("AUTH_REQUIRED: not signed in", EMPTY).data as { action: string }).action;
    expect(action).toMatch(/In VS Code: the command "Protoboard: Sign In to Protoboard Cloud"/);
    expect(action).toMatch(/`protoboard login` where that command exists/);
    expect(action).not.toMatch(/npx (?!--no-install )protoboard/);
    // the command it names is the extension's
    const manifest = JSON.parse(readFileSync(join(ROOT, "packages", "vscode-protoboard", "package.json"), "utf8")) as { contributes: { commands: { command: string; title: string; category?: string }[] } };
    const by = Object.fromEntries(manifest.contributes.commands.map((c) => [c.command, `${c.category}: ${c.title}`]));
    expect(action).toContain(by["protoboard.signIn"]);
    expect(action).toContain(by["protoboard.openSettings"]);
    expect(serverInstructions([])).toMatch(/ask the user to sign in; the result says how/);
  });

  it("a long result's file is this user's only, and a later server removes the ones a day old", () => {
    const r = toResult("bom", { data: { rows: Array.from({ length: 4000 }, (_, i) => ({ i, text: "a part line" })) } });
    const file = JSON.parse(r.content[0].text).file as string;
    const dir = dirname(file);
    expect(dirname(dir)).toBe(tmpdir());
    if (process.platform !== "win32") {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    // this server's own folder is never swept, however old
    const tmp = mkdtempSync(join(tmpdir(), "pb-mcp-sweep-"));
    const [old, fresh, other] = [join(tmp, "protoboard-mcp-old1"), join(tmp, "protoboard-mcp-new1"), join(tmp, "someone-elses")];
    for (const d of [old, fresh, other]) {
      mkdirSync(d);
      writeFileSync(join(d, "bom-1.json"), "{}");
    }
    const twoDays = new Date(Date.now() - 48 * 3600 * 1000);
    utimesSync(old, twoDays, twoDays);
    utimesSync(other, twoDays, twoDays);
    sweepSpill(Date.now(), tmp);
    expect([existsSync(old), existsSync(fresh), existsSync(other)]).toEqual([false, true, true]);
    rmSync(tmp, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("a result that would flood the context goes to a file", () => {
    const big = { rows: Array.from({ length: 4000 }, (_, i) => ({ i, text: "a part line" })) };
    const r = toResult("bom", { data: big });
    const told = JSON.parse(r.content[0].text);
    expect(told.truncated).toBe(true);
    expect(told.characters).toBeGreaterThan(RESULT_LIMIT);
    expect(JSON.parse(readFileSync(told.file, "utf8"))).toEqual(big);
    rmSync(told.file);
    expect(toResult("bom", { data: { rows: [] } }).content[0].text).toBe('{\n  "rows": []\n}');
  });

  it("uses a project's own CLI for its commands, and the server's for a folder without one", async () => {
    const proj = join(EMPTY, "own-cli");
    const bin = join(proj, "node_modules", "@protoboardai", "cli", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(proj, "protoboard.config.ts"), "");
    // a stand-in for an older CLI: it answers every command the same way
    writeFileSync(join(bin, "protoboard.mjs"), `process.stdout.write(JSON.stringify({ from: "the project's own CLI", args: process.argv.slice(2) }) + "\\n");\n`);
    const client = await connect(EMPTY);
    const own = await call(client, "project_inspect", { dir: "own-cli" });
    expect(own.data).toEqual({ from: "the project's own CLI", args: ["inspect", "--format=json", "--"] });
    const status = await call(client, "project_status", { dir: "own-cli" });
    expect(status.data.protoboard).toMatchObject({ cli: join(bin, "protoboard.mjs"), cliFrom: "project" });
    // the gate, when the project's CLI applies it: its message comes back as the result
    // the CLI's line when Protoboard needs a sign-in (PB-928): {"error", "code": "SIGN_IN_REQUIRED", "access"}, exit 3
    const refusal = { error: "Protoboard needs an invited account: you@example.com is signed in to https://parts.example but is not on its invite list. Ask for an invitation.", code: "SIGN_IN_REQUIRED", access: { required: true, allowed: false, reason: "not-invited" } };
    writeFileSync(join(bin, "protoboard.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(refusal))} + "\\n"); process.exitCode = 3;\n`);
    for (const name of ["project_check", "project_build", "parts_list", "skills_list", "bom", "release_check"]) {
      const gated = await call(client, name, { dir: "own-cli" });
      expect(gated.isError, name).toBe(false);
      expect(gated.data, name).toMatchObject({ signInRequired: true, message: refusal.error });
      expect(gated.data.action, name).toMatch(/Ask the user to sign in.*`protoboard login`/);
    }
    // whoami stays open and says what the gate found: the status puts it first
    writeFileSync(join(bin, "protoboard.mjs"), `process.stdout.write(JSON.stringify(process.argv[2] === "whoami" ? { service: "https://parts.example", signedIn: false, access: { required: true, allowed: false, reason: "signed-out", message: "Protoboard needs a sign-in: run \`protoboard login\` (not signed in to https://parts.example)." } } : ${JSON.stringify(refusal)}) + "\\n");\n`);
    const blocked = await call(client, "project_status", { dir: "own-cli" });
    expect(blocked.isError).toBe(false);
    expect(blocked.data.next[0]).toMatch(/^Protoboard needs a sign-in: run `protoboard login` \(not signed in to https:\/\/parts\.example\)\. Ask the user to sign in, then call this tool again\. In VS Code/);
  }, 120_000);
});

/**
 * The real gate (PB-928, as changed on 2026-10-21), signed out against a
 * stand-in service that signs people in: every tool that works on the
 * project answers as usual, and only the cloud (the library: searching it,
 * adding library parts) says what to ask the user. A template's library
 * parts wait; the project is made.
 */
describe("signed out (PB-928): project tools work, the library asks for a sign-in", () => {
  let service: import("node:http").Server;
  let url = "";
  beforeAll(async () => {
    const { createServer } = await import("node:http");
    service = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/.well-known/uhd-library") return void res.end(JSON.stringify({ protocol: "uhd-library/v1", id: "protoboard", api: "/v1", account: { provider: "firebase", apiKey: "key" } }));
      if (req.url === "/v1/me") return void res.end(JSON.stringify({ signedIn: false }));
      // as the real service: the library, browsing included, needs a sign-in
      if (req.url?.startsWith("/v1/")) {
        res.statusCode = 401;
        return void res.end(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "the Protoboard library needs a signed-in Protoboard account: run `protoboard login`" } }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((ok) => service.listen(0, "127.0.0.1", ok));
    url = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
  });
  afterAll(() => void service?.close());

  it("project_status says it once, at the end; project tools run; parts_search and parts_add say what to ask the user", async () => {
    const dir = join(TMP, "signed-out");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "protoboard.config.ts"), `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, cloud: { url: "${url}" } });\n`);
    writeFileSync(join(dir, "src/sys.uhd.ts"), `export const SYS = { id: "sys", name: "System", interfaces: [], children: [] };\n`);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "signed-out", private: true, type: "module" }) + "\n");
    // nobody signed in, a home of its own
    const home = mkdtempSync(join(tmpdir(), "pb-mcp-gate-"));
    const client = await connect(TMP, { PROTOBOARD_CLOUD_URL: url, HOME: home, PROTOBOARD_CONFIG_DIR: join(home, "protoboard") });
    try {
      expect((await client.listTools()).tools).toHaveLength(TOOLS.length);
      for (const where of ["signed-out", EMPTY]) {
        const status = await call(client, "project_status", { dir: where });
        expect(status.isError, where).toBe(false);
        expect(status.data.account.access, where).toMatchObject({ allowed: false, reason: "signed-out" });
        expect(status.data.next[0], where).not.toMatch(/protoboard login/);
        expect(status.data.next.at(-1), where).toMatch(/Everything on the project works without an account.*The Protoboard library needs one, browsing included: searching it \(parts_search\), adding library parts.*`protoboard login`/);
      }
      for (const [name, args] of [["project_check", {}], ["project_inspect", {}], ["project_build", {}], ["project_layout", {}], ["parts_list", {}], ["bom", {}], ["release_check", {}]] as [string, Record<string, unknown>][]) {
        const r = await call(client, name, { dir: "signed-out", ...args });
        expect(r.data?.signInRequired, `${name}: ${JSON.stringify(r.data).slice(0, 300)}`).toBeUndefined();
        expect(JSON.stringify(r.data), name).not.toMatch(/protoboard login/);
      }
      expect(existsSync(join(dir, ".protoboard/build/resolved.json"))).toBe(true);
      // searching the library is the library too: a normal result that says what to ask the user
      const search = await call(client, "parts_search", { dir: "signed-out", query: "regulator" });
      expect(search.isError).toBe(false);
      expect(search.data).toMatchObject({ signInRequired: true, message: `Searching the Protoboard library needs a Protoboard account: sign in with \`protoboard login\` (not signed in to ${url}).` });
      expect(search.data.action).toMatch(/Ask the user to sign in.*`protoboard login`/);
      const add = await call(client, "parts_add", { dir: "signed-out", parts: ["test-mcp-regulator"] });
      expect(add.isError).toBe(false);
      expect(add.data).toMatchObject({ signInRequired: true, message: `Adding library parts needs a Protoboard account: sign in with \`protoboard login\` (not signed in to ${url}).` });
      expect(add.data.action).toMatch(/Ask the user to sign in.*`protoboard login`/);
      expect(existsSync(join(dir, "parts"))).toBe(false);
      // a template's project is made; its library parts wait for the sign-in
      const init = await call(client, "project_init", { dir: join(EMPTY, "signed-out-new"), template: "iot" });
      expect(init.isError, JSON.stringify(init.data).slice(0, 400)).toBe(false);
      expect(existsSync(join(EMPTY, "signed-out-new", "protoboard.config.ts"))).toBe(true);
      expect(init.data.partsSkipped).toMatch(/needs a Protoboard account: sign in with `protoboard login`/);
      expect(init.data.next.join("\n")).toMatch(/library parts were not added.*parts_add/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 240_000);
});
