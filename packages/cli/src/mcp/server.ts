/**
 * `protoboard mcp`: the Protoboard MCP server over stdio (PB-930,
 * docs/specs/agents-and-mcp.md §2). It tells an agent what Protoboard is
 * (the instructions) and gives it the CLI's commands as tools (tools.ts).
 * It works with or without a project in the folder it is started in.
 *
 * stdout carries the protocol and nothing else; anything to say goes to
 * stderr, where clients keep a server's log.
 */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { findProjectRoot, listTemplates } from "@protoboardai/core";
import { guideText, serverInstructions } from "./instructions.js";
import { cliTools, type CliRun, type ToolContext, type ToolOutcome, type ToolSpec } from "./tools.js";

/** The CLI that carries this server. */
export const SELF_CLI = fileURLToPath(new URL("../../bin/protoboard.mjs", import.meta.url));
const SELF_VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** A result longer than this goes to a file; the tool returns where (Claude Code stops a result at 25 000 tokens). */
export const RESULT_LIMIT = 40_000;

/** The `@protoboardai/cli` installed for a folder: the nearest `node_modules` from it up, as Node resolves it. */
export function projectCli(dir: string): string | undefined {
  for (let d = resolve(dir); ; d = dirname(d)) {
    const bin = join(d, "node_modules", "@protoboardai", "cli", "bin", "protoboard.mjs");
    if (existsSync(bin)) return bin;
    if (dirname(d) === d) return undefined;
  }
}

function runCli(entry: string, args: string[], cwd: string, timeoutMs: number): Promise<CliRun> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      stderr += `\nprotoboard: stopped after ${Math.round(timeoutMs / 1000)} s`;
      child.kill();
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: `${stderr}\n${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

const SPILL_PREFIX = "protoboard-mcp-";
const SPILL_KEEP_MS = 24 * 60 * 60 * 1000;
let spill: string | undefined;

/**
 * Remove the folders of earlier servers of this user that are more than a
 * day old (and the one folder earlier versions shared). Only real folders
 * this user owns: the system's temporary folder is shared on Linux.
 */
export function sweepSpill(now = Date.now(), tmp = tmpdir()): void {
  let names: string[];
  try {
    names = readdirSync(tmp);
  } catch {
    return;
  }
  const uid = process.getuid?.();
  for (const n of names) {
    if (n !== "protoboard-mcp" && !n.startsWith(SPILL_PREFIX)) continue;
    const dir = join(tmp, n);
    try {
      const s = lstatSync(dir);
      if (!s.isDirectory() || dir === spill || (uid !== undefined && s.uid !== uid) || now - s.mtimeMs < SPILL_KEEP_MS) continue;
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // someone else's, or gone already
    }
  }
}

/** This server's own folder for results too long to return: made for this user only (0700), with a name no one can prepare. */
function spillDir(): string {
  if (!spill || !existsSync(spill)) spill = mkdtempSync(join(tmpdir(), SPILL_PREFIX));
  return spill;
}

/** A tool's outcome as an MCP result: JSON text, moved to a file when it would flood the agent's context. */
export function toResult(name: string, o: ToolOutcome): { content: { type: "text"; text: string }[]; isError?: boolean } {
  let text = typeof o.data === "string" ? o.data : JSON.stringify(o.data, null, 2);
  if (text.length > RESULT_LIMIT) {
    // a project's BOM or model: readable by this user only, and removed by a later server once it is a day old
    const file = join(spillDir(), `${name}-${Date.now()}.${typeof o.data === "string" ? "md" : "json"}`);
    writeFileSync(file, text, { mode: 0o600 });
    text = JSON.stringify({ truncated: true, characters: text.length, file, note: "The whole result is in `file`: read the part you need (or query it with jq). Its start follows.", start: text.slice(0, 6000) }, null, 2);
  }
  return { content: [{ type: "text", text }], ...(o.isError ? { isError: true } : {}) };
}

export interface ServerOptions {
  /** The folder tools work in when they are given none (default: PROTOBOARD_PROJECT_DIR, the client's first root, the process's folder). */
  cwd?: string;
  /** More tools beside the CLI's (the seam for a bridge to a VS Code window, §7). */
  tools?: ToolSpec[];
}

/** The server, not yet connected to a transport. */
export function createServer(options: ServerOptions = {}): McpServer {
  sweepSpill();
  const templates = listTemplates().map((t) => t.id);
  const about = serverInstructions(templates);
  const server = new McpServer({ name: "protoboard-stack", title: "Protoboard Stack", version: SELF_VERSION }, { instructions: about });

  let rootDir: string | undefined;
  const base = async (): Promise<string> => {
    if (options.cwd) return options.cwd;
    if (process.env.PROTOBOARD_PROJECT_DIR) return resolve(process.env.PROTOBOARD_PROJECT_DIR);
    if (rootDir === undefined && server.server.getClientCapabilities()?.roots) {
      try {
        const first = (await server.server.listRoots()).roots.find((r) => r.uri.startsWith("file:"));
        rootDir = first ? fileURLToPath(first.uri) : "";
      } catch {
        rootDir = "";
      }
    }
    return rootDir || process.cwd();
  };
  // a client that changes its roots says so: it is asked again at the next call
  server.server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
    rootDir = undefined;
  });

  const ctx: ToolContext = {
    dir: async (given) => (given ? (isAbsolute(given) ? given : resolve(await base(), given)) : base()),
    cliFor: (dir) => {
      const own = projectCli(dir);
      return own ? { entry: own, from: "project" } : { entry: SELF_CLI, from: "server" };
    },
    cli: (dir, args, o) => runCli(ctx.cliFor(dir).entry, args, dir, o?.timeoutMs ?? 180_000),
    version: SELF_VERSION,
    about,
  };

  for (const spec of [...cliTools(templates), ...(options.tools ?? [])]) {
    server.registerTool(spec.name, { title: spec.title, description: spec.description, inputSchema: spec.input, annotations: { title: spec.title, ...spec.annotations } }, async (args: Record<string, unknown>) => {
      try {
        const dir = typeof args.dir === "string" ? await ctx.dir(args.dir) : undefined;
        if (dir && spec.name !== "project_init" && !existsSync(dir)) return toResult(spec.name, { data: { error: `no folder ${dir}` }, isError: true });
        return toResult(spec.name, await spec.handler(args as never, ctx));
      } catch (e) {
        return toResult(spec.name, { data: { error: (e as Error).message }, isError: true });
      }
    });
  }

  server.registerResource("guide", "protoboard://guide", { title: "Working with Protoboard", description: "What Protoboard is, the rules, the order of work and the shell commands beside these tools.", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: guideText(templates) }],
  }));
  // the project's own instructions, when the server was started in a project that has them
  const startedIn = options.cwd ?? process.env.PROTOBOARD_PROJECT_DIR ?? process.cwd();
  const root = findProjectRoot(resolve(startedIn));
  if (root && existsSync(join(root, "AGENTS.md"))) {
    server.registerResource("agents-md", "protoboard://project/AGENTS.md", { title: "The project's AGENTS.md", description: "The project's own instructions for agents: read it before working on the project.", mimeType: "text/markdown" }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: readFileSync(join(root, "AGENTS.md"), "utf8") }],
    }));
  }

  server.registerPrompt(
    "new_project",
    { title: "Start a Protoboard project", description: "Start a hardware project for a device, in this folder.", argsSchema: { what: z.string().describe("The device to build, in a sentence or two.") } },
    ({ what }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use Protoboard to start a hardware project for: ${what}\n\nCall project_status first. If this folder is not a project yet, pick the closest template (${templates.join(", ")}; or none) and create it with project_init (it uses the Protoboard installed on this machine: never run \`npm install\`). Read the project's AGENTS.md and the build-a-project skill (skill_read), write the requirements into docs/brief.md with a source for every number, and follow the skill from there. Run project_check after each change. Do not look for a Protoboard web app: there is none to use here.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt("continue_project", { title: "Continue this Protoboard project", description: "Pick up the Protoboard project in this folder where it stands." }, () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Continue the Protoboard project in this folder. Call project_status, read AGENTS.md and docs/brief.md, run project_check and project_inspect to see where it stands, then say what the next step of the build-a-project skill is (skill_read) and what you would do. Do not change anything before I agree.",
        },
      },
    ],
  }));
  return server;
}

/** Serve on stdio until the client closes the stream. */
export async function serveStdio(options: ServerOptions = {}): Promise<void> {
  const server = createServer(options);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`protoboard mcp ${SELF_VERSION}: serving on stdio (folder: ${options.cwd ?? process.cwd()})\n`);
  await new Promise<void>((done) => {
    server.server.onclose = () => done();
    process.stdin.on("close", () => done());
  });
}
