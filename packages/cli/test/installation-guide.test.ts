/**
 * The installation guide (docs/guides/installation.md, served at the site's
 * /guide; PB-1056): one guide for a person and for an agent, by operating
 * system and by agent, with no version number of Protoboard in it. What it
 * says about the stack is held to the code here: the commands and flags it
 * names exist, the agents it lists are the ones `protoboard agents` knows,
 * and the files and launcher it shows are the ones the stack writes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOWN_AGENTS, MCP_SERVER_NAME, otherClientConfig } from "@protoboardai/core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("docs/guides/installation.md", () => {
  const doc = read("docs/guides/installation.md");
  // what a reader sees: the maintainers' comments are not part of it
  const shown = doc.replace(/<!--[\s\S]*?-->/g, "");
  const blocks = [...doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const h2 = [...shown.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const h3 = [...shown.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
  const sectionOf = (title: string) => {
    const at = shown.indexOf(`\n## ${title}\n`);
    expect(at, title).toBeGreaterThan(0);
    const next = shown.indexOf("\n## ", at + 1);
    return shown.slice(at, next < 0 ? undefined : next);
  };
  // prose as one line: a phrase the text wraps is still found
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const help = read("packages/cli/src/index.ts");

  it("is the one guide, in this order: what you need, each system, agents, a first project, sign-in, updating, uninstalling, troubleshooting", () => {
    expect(existsSync(join(ROOT, "docs/guides/beta-teammates.md"))).toBe(false);
    expect(h2).toEqual(["What you need", "Install on macOS", "Install on Windows", "Install on Linux", "Connect your agent", "Your first project", "Signing in for the library", "Updating", "Uninstalling", "Troubleshooting"]);
  });

  it("names no version of Protoboard, and says how to see the current one", () => {
    expect(shown.match(/\d+\.\d+\.\d+/g) ?? []).toEqual([]);
    expect(shown).not.toMatch(/@protoboardai\/[a-z-]+@\d|vscode-protoboard-\d|Protoboard \d|Written for|\b0\.\d\b/);
    expect(shown).toMatch(/names no version number on purpose/);
    expect(shown).toContain("`protoboard --version`");
    expect(shown).toContain("**Protoboard: Open Settings**");
    expect(shown).toMatch(/share one version number/);
    expect(JSON.parse(read("packages/vscode-protoboard/package.json")).version).toBe(JSON.parse(read("packages/core/package.json")).version);
  });

  it("covers each system the same way: the extension, the protoboard command and PATH, and a check with doctor", () => {
    for (const os of ["macOS", "Windows", "Linux"]) {
      const s = sectionOf(`Install on ${os}`);
      expect(s, os).toMatch(/^### The extension$/m);
      expect(s, os).toMatch(/^### The protoboard command$/m);
      expect(s, os).toMatch(/^### Check it$/m);
      expect(s, os).toContain("code --install-extension deltarobotics.vscode-protoboard");
      expect(s, os).toContain("npm i -g @protoboardai/cli");
      expect(s, os).toContain("protoboard doctor");
      expect(s, os).toContain("**Protoboard: Add the protoboard Command to PATH**");
      expect(flat(s), os).toMatch(/Open VSX/);
    }
    expect(sectionOf("Install on macOS")).toContain("Shell Command: Install 'code' command in PATH");
    expect(sectionOf("Install on Windows")).toContain("%USERPROFILE%\\.protoboard\\bin\\protoboard.cmd");
    expect(sectionOf("Install on Linux")).toContain("~/.protoboard/bin/protoboard");
  });

  it("names the extension by the id it is published under, and the listing pages for that id", () => {
    const pkg = JSON.parse(read("packages/vscode-protoboard/package.json"));
    const id = `${pkg.publisher}.${pkg.name}`;
    expect(id).toBe("deltarobotics.vscode-protoboard");
    expect(shown).toContain(`https://marketplace.visualstudio.com/items?itemName=${id}`);
    expect(shown).toContain(`https://open-vsx.org/extension/${pkg.publisher}/${pkg.name}`);
    expect(flat(shown)).toContain(`code --uninstall-extension ${id}`);
    // the editor floor it states is the manifest's
    expect(pkg.engines.vscode).toBe("^1.106.0");
    expect(shown).toMatch(/VS Code 1\.106 or later/);
  });

  it("says what protoboard setup does as it is: the extension by its id from the Marketplace or Open VSX, no sign-in, --vsix offline (PB-1047)", () => {
    const setup = read("packages/cli/src/setup.ts");
    const pkg = JSON.parse(read("packages/vscode-protoboard/package.json"));
    expect(setup).toContain(`export const EXTENSION_ID = "${pkg.publisher}.${pkg.name}";`);
    // no sign-in, no downloads site
    expect(setup).not.toMatch(/accountToken|serviceAccount|downloads\.json/);
    for (const id of ["code", "cursor", "windsurf", "codium"]) expect(setup, id).toContain(`id: "${id}"`);
    const s = flat(sectionOf("Install on Linux").slice(sectionOf("Install on Linux").indexOf("### Setting up a machine from the command line")));
    expect(blocks.map((b) => b.trim())).toContain("protoboard setup");
    expect(blocks.join("\n")).toContain("protoboard setup --vsix <file>");
    expect(s).toContain("needs no account and no sign-in");
    expect(s).toContain("`deltarobotics.vscode-protoboard`");
    expect(s).toMatch(/VS Code takes it from the Marketplace, the others from Open VSX/);
    expect(s).toMatch(/not there, `setup` says so in one line and still sets up the `PATH` and your agents/);
    expect(s).not.toMatch(/downloads site|signed in/);
    for (const flag of ["--editor <id>", "--yes", "--no-agents"]) {
      expect(shown, flag).toContain(`\`${flag}\``);
      expect(help, flag).toContain(flag);
    }
    expect(help).toContain("(code, cursor, windsurf or codium; repeatable)");
  });

  it("has a section for every agent it promises, and every one of them is an agent the stack connects", () => {
    expect(h3).toEqual(expect.arrayContaining(["Claude Code", "Codex", "Cursor", "Windsurf", "GitHub Copilot agent mode", "Other MCP clients"]));
    const ids = KNOWN_AGENTS.map((a) => a.id);
    for (const id of ["claude-code", "codex", "cursor", "windsurf", "vscode"]) expect(ids, id).toContain(id);
    const agents = sectionOf("Connect your agent");
    for (const name of ["Claude Code", "Codex", "Cursor", "Windsurf", "GitHub Copilot agent mode"]) {
      const at = agents.indexOf(`\n### ${name}\n`);
      const part = flat(agents.slice(at, agents.indexOf("\n### ", at + 1)));
      expect(part, name).toMatch(/(### .+? |\. )Connect: /);
      expect(part, name).toMatch(/ Reads: /);
      expect(part, name).toMatch(/ First prompt[^:]*: > /);
    }
    // the three ways to connect, each a command or a button that exists
    expect(agents).toContain("**Connect**");
    expect(agents).toContain("**Protoboard: Connect Agents (MCP)**");
    for (const c of ["protoboard agents setup", "protoboard agents config", "protoboard agents refresh", "protoboard agents remove"]) expect(shown, c).toContain(c);
    for (const c of ["agents setup", "agents config", "agents refresh", "agents remove"]) expect(help, c).toContain(c);
  });

  it("writes the manual entries as the stack writes them: the server's name, each agent's key, the launcher", () => {
    expect(MCP_SERVER_NAME).toBe("protoboard-stack");
    const launcher = "/Users/you/.config/protoboard/agents/protoboard-mcp";
    const generic = otherClientConfig({ command: launcher, args: [] });
    const json = blocks.filter((b) => b.trimStart().startsWith("{")).map((b) => JSON.parse(b));
    expect(json.length).toBeGreaterThanOrEqual(3);
    for (const j of json) {
      const servers = j.mcpServers ?? j.servers;
      expect(Object.keys(servers)).toEqual([MCP_SERVER_NAME]);
      expect(servers[MCP_SERVER_NAME].command).toBe(launcher);
    }
    // the generic mcpServers form and VS Code's form are exactly the ones `protoboard agents config` prints
    expect(json).toContainEqual(JSON.parse(generic.json));
    expect(json).toContainEqual(JSON.parse(generic.vscodeJson));
    expect(blocks.map((b) => b.trim())).toContain(generic.toml.replace(launcher, launcher));
    expect(blocks.join("\n")).toContain(generic.claudeLine.replace(launcher, "~/.config/protoboard/agents/protoboard-mcp"));
    // the agents' files it names are the ones core writes
    const agentsSrc = read("packages/core/src/agents.ts");
    for (const [said, inCode] of [
      ["~/.cursor/mcp.json", '".cursor", "mcp.json"'],
      ["~/.codex/config.toml", '"config.toml"'],
      ["~/.config/devin/mcp_config.json", '"devin", "mcp_config.json"'],
      ["~/.codeium/windsurf/mcp_config.json", '".codeium", "windsurf", "mcp_config.json"'],
      ["Code/User/mcp.json", '"mcp.json"'],
    ]) {
      expect(shown, said).toContain(said);
      expect(agentsSrc, inCode).toContain(inCode);
    }
    // the launcher's folder: configDir()/agents
    expect(read("packages/core/src/account.ts")).toMatch(/join\(env\.XDG_CONFIG_HOME \|\| join\(env\.HOME \|\| homedir\(\), "\.config"\), "protoboard"\)/);
    expect(read("packages/core/src/agent-launcher.ts")).toContain('"protoboard-mcp.cmd"');
    expect(shown).toContain("%APPDATA%\\protoboard\\agents\\protoboard-mcp.cmd");
  });

  it("says what the agent reads, as init writes it", () => {
    expect(read("packages/core/src/init.ts")).toContain('export const CLAUDE_MD = "@AGENTS.md\\n"');
    const agents = sectionOf("Connect your agent");
    expect(agents).toContain("`@AGENTS.md`");
    expect(agents).toContain("`.claude/skills/`");
    expect(agents).toContain("`protoboard skills read <name>`");
    expect(read("packages/cli/src/mcp/instructions.ts")).toMatch(/Start with project_status/);
  });

  it("speaks to an agent where the agent must ask its user: which editor and agent, installs, agents' files, the sign-in, npm in a project", () => {
    const notes = [...shown.matchAll(/^> \*\*If you are an agent doing this for someone:\*\*[\s\S]*?(?=\n\n(?!>))/gm)].map((m) => m[0]);
    expect(notes.length).toBeGreaterThanOrEqual(5);
    expect(notes[0]).toMatch(/Which editor\?/);
    expect(notes[0]).toMatch(/Which agent\?/);
    expect(notes[0]).toMatch(/Start a project now\?/);
    expect(notes.some((n) => /cannot sign in for\s+>?\s*them/.test(n))).toBe(true);
    expect(notes.some((n) => /Never\s+>?\s*tell them to run npm in a project/.test(n))).toBe(true);
    expect(notes.some((n) => /--agent <id> --yes/.test(n.replace(/\n> /g, " ")))).toBe(true);
  });

  it("uses the scoped name wherever npx would run Protoboard", () => {
    expect(blocks.join("\n")).not.toMatch(/npx\s+(--no-install\s+)?protoboard\b/);
    expect(shown).toMatch(/Never\s+(>\s*)?run a bare `npx protoboard`/);
    expect(shown).toContain("`npx @protoboardai/cli`");
  });

  it("never tells the reader to run npm in a project", () => {
    expect(blocks.join("\n")).not.toMatch(/^\s*npm (install|ci)\b/m);
    for (const m of shown.matchAll(/`npm install`/g)) {
      const around = shown.slice(Math.max(0, m.index - 80), m.index + 60);
      expect(around, around).toMatch(/no `npm install`|Do not run `npm install`/);
    }
  });

  it("names the sign-in's commands, and only the library needs it", () => {
    const s = sectionOf("Signing in for the library");
    for (const c of ["protoboard login", "protoboard whoami --check", "`protoboard login --device`", "`protoboard logout`", "PROTOBOARD_CLOUD_TOKEN", "exit code 4"]) expect(s.replace(/\s+/g, " "), c).toContain(c);
    expect(help).toMatch(/Local work needs no account/);
    expect(read("packages/core/src/access.ts")).toContain("export const ACCESS_EXIT_CODE = 4;");
  });

  it("keeps a troubleshooting table, with doctor, the logs and the rows people need", () => {
    const s = sectionOf("Troubleshooting");
    expect(s).toContain("protoboard doctor");
    expect(s).toContain("**Protoboard: Show Log**");
    const rows = s.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| You see") && !l.startsWith("|---"));
    expect(rows.length).toBeGreaterThanOrEqual(12);
    const row = (re: RegExp) => rows.find((r) => re.test(r.split("|")[1]));
    expect(row(/command not found/), "PATH").toMatch(/Add the protoboard Command to PATH/);
    expect(row(/does not list Protoboard's tools/), "the agent").toMatch(/protoboard agents refresh/);
    expect(row(/CAD step/), "CAD").toMatch(/protoboard tools install cad/);
    expect(row(/needs a Protoboard account/), "sign-in").toMatch(/protoboard login/);
    // the launcher's own message, word for word
    expect(read("packages/core/src/agent-launcher.ts")).toContain("protoboard-mcp: Node.js 22 or later was not found");
    expect(s).toContain("`protoboard-mcp: Node.js 22 or later was not found`");
  });

  it("names only commands of the extension that it contributes", () => {
    const titles = new Set((JSON.parse(read("packages/vscode-protoboard/package.json")).contributes.commands as { category?: string; title: string }[]).map((c) => `${c.category ?? "Protoboard"}: ${c.title}`));
    const named = [...new Set([...shown.matchAll(/\*\*(Protoboard: [^*]+)\*\*/g)].map((m) => m[1].replace(/\s+/g, " ")))];
    expect(named.length).toBeGreaterThan(10);
    for (const n of named) expect(titles, n).toContain(n);
  });

  it("names only CLI commands and flags the CLI has", () => {
    const commands = blocks.join("\n").split("\n").filter((l) => /^protoboard /.test(l.trim()));
    expect(commands.length).toBeGreaterThan(10);
    for (const line of commands) {
      const [, sub] = line.trim().split(/\s+/);
      if (sub.startsWith("-")) continue;
      expect(help, line).toMatch(new RegExp(`case "${sub}"`));
    }
  });

  it("marks what it was checked against, each with a sentence that names the source", () => {
    const marks = [...doc.matchAll(/<!-- (verified|depends): ([\s\S]*?) -->/g)].map((m) => m[2]);
    expect(marks.length).toBeGreaterThanOrEqual(8);
    for (const m of marks) expect(m.length, m).toBeGreaterThan(40);
    // every file a mark names exists
    for (const [file] of doc.matchAll(/packages\/[\w./-]+\.(?:ts|json|md)/g)) expect(existsSync(join(ROOT, file.replace(/\*/g, ""))) || file.includes("*"), file).toBe(true);
  });
});
