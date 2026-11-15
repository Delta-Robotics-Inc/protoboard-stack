/**
 * A small stack for the System Map tests (docs/specs/system-map.md): two
 * extensions, the CLI with its help, switch and MCP tools, the views, a
 * template, an example project, an outside package, docs and release notes.
 * Every reference the builder follows has a case here, including the ones it
 * must report instead of resolve.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SysmapGitRunner } from "../src/sysmap/history.js";

/** No git: a fixture is read from its files alone. */
export const noGit: SysmapGitRunner = async () => null;

export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

const HUB = `---
name: build-a-project
description: The top-level SOP.
---

# Build a project

## Steps

### 0. Set up

| Extension | For |
| --- | --- |
| \`@protoboardai/ext-a\` | boards (**board-make**) |

Run \`npx protoboard check\`, then call \`project_status\`.

### 1. Boards (circuit capability)

Follow **board-make**, then **board-verify**. Run \`protoboard run circuit:generate --module b\` and \`protoboard run report\`.

### 2. Release

Follow **board-make** for the last fixes. Read docs/specs/foo.md.

## Outputs

Nothing.
`;

const MAKE = `---
name: board-make
description: Make a board.
---

# Board make

Run \`protoboard run circuit:generate --module b\`, then \`protoboard check\`, then \`protoboard frobnicate\`.
Hand off to **board-verify**. Use \`project_check\`. See docs/specs/bar.md and docs/specs/missing.md.
`;

const VERIFY = `---
name: board-verify
description: Verify a board.
---

# Board verify

Check what **board-make** made with \`circuit:check\` and \`circuit:nonsense\`.
`;

const CLI_INDEX = `import meow from "meow";
const cli = meow(
  \`
  Usage
    $ protoboard <command> [options]

  Commands
    check                   Resolve the project and run every available validator (exit 1 on errors)
    build                   Write the resolved project
    mcp                     The Protoboard MCP server on stdio: what an agent starts
    run <operation>         Run an extension operation
    run <capability>:<op> --module <instance>
                            Run a capability operation on one module
    ghost                   A command the switch does not handle

  Options
    --format json
\`,
);
const [command] = cli.input;
async function main() {
  switch (command) {
    case "check": {
      // docs/specs/foo.md
      return;
    }
    case "build":
    case "rebuild": {
      return;
    }
    case "run": {
      return;
    }
    case "secret": {
      return;
    }
    case "mcp": {
      const { serveStdio } = await import("./mcp/server.js");
      await serveStdio();
      return;
    }
    default:
      cli.showHelp(2);
  }
}
`;

const SERVER = `import { cliTools } from "./tools.js";
export async function serveStdio() { return cliTools([]); }
`;

const TOOLS = `export function cliTools(templates: string[]) {
  return [
    tool({
      name: "project_check",
      title: "Check the project",
      description:
        "Run every validator. " +
        "Reads only.",
      handler: async ({ dir }, ctx) => command(ctx, dir, cliArgs(["check"])),
    }),
    tool({
      name: "project_status",
      title: "Protoboard status",
      description: "Call this first.",
      handler: async ({ dir }, ctx) => command(ctx, dir, cliArgs(["build"]), cliArgs(["vanished"])),
    }),
  ];
}
`;

const TABS = `export const BUILTIN_TABS: readonly TabRule[] = [
  {
    id: "diagram",
    title: "Diagram",
    description: "Modules, interfaces, links and harnesses of this level.",
    applies: () => true,
  },
  {
    id: "pcb",
    title: "PCB",
    description: "The board's layout.",
    applies: () => true,
  },
];
`;

/** The files of the fixture stack (a monorepo: package.json with workspaces). */
export function stackFiles(): Record<string, string> {
  return {
    "package.json": json({ name: "fixture-stack", private: true, workspaces: ["packages/core", "packages/cli", "packages/views", "packages/ext-a", "packages/ext-b", "packages/ext-c", "examples/*"] }),
    "packages/core/package.json": json({
      name: "@protoboardai/core",
      version: "1.0.0",
      description: "The framework.",
      dependencies: { "@deltarobotics/uhd": "^1.0.0" },
      protoboard: { toolchain: { uhd: "1.0.1" } },
    }),
    "packages/core/README.md": "# Core\n\nSee docs/specs/foo.md.\n",
    "packages/core/templates/basic/template.json": json({ title: "Basic: one board", description: "A board.", derivedFrom: "examples/demo", extensions: ["@protoboardai/ext-a", "@protoboardai/ext-gone"] }),
    "packages/cli/package.json": json({ name: "@protoboardai/cli", version: "1.0.0", description: "The protoboard command.", dependencies: { "@protoboardai/core": "^1.0.0" } }),
    "packages/cli/src/index.ts": CLI_INDEX,
    "packages/cli/src/mcp/server.ts": SERVER,
    "packages/cli/src/mcp/tools.ts": TOOLS,
    "packages/views/package.json": json({ name: "@protoboardai/views", version: "1.0.0", description: "The views." }),
    "packages/views/src/tabs.ts": TABS,
    "packages/ext-a/package.json": json({ name: "@protoboardai/ext-a", version: "1.0.0", description: "Protoboard extension: boards and the top-level SOP", dependencies: { "@protoboardai/core": "^1.0.0" } }),
    "packages/ext-a/protoboard-extension.json": json({
      schema: "protoboard.extension/v0",
      id: "@protoboardai/ext-a",
      version: "1.0.0",
      description: "circuit provider and the top-level SOP",
      tools: [{ id: "lib-node", purpose: "The board library on Node", runtime: { id: "circuit", packages: ["boardlib==2.0.0"] } }],
      skills: [
        { id: "build-a-project", summary: "The top-level SOP: brief to release", path: "skills/build-a-project/SKILL.md" },
        { id: "board-make", summary: "Make a board through the circuit capability", path: "skills/board-make/SKILL.md", verifiedBy: "board-verify" },
        { id: "board-verify", summary: "Verify a board", path: "skills/board-verify/SKILL.md" },
        { id: "uhd-authoring", summary: "UHD schema reference; shipped by UHD", package: "@deltarobotics/uhd", path: "skills/uhd-authoring/SKILL.md" },
      ],
      capabilities: [
        {
          id: "circuit",
          summary: "PCBs",
          native: "boardlib",
          operations: {
            generate: { entry: "./ops.ts#generate", requires: ["lib-node"], summary: "Write the board source and route it" },
            check: { entry: "./ops.ts#check", requires: ["lib-node"], summary: "DRC and netlist drift" },
            lock: { entry: "./ops.ts#lock", effect: "export", summary: "Hand the board to another tool (a human decision: agents ask first)" },
          },
        },
      ],
      operations: [{ id: "report", summary: "Write the board report", entry: "./ops.ts#report", requires: ["missing-tool"] }],
      checks: [{ id: "boards", summary: "Board checks", entry: "./checks.ts#boards" }],
    }),
    "packages/ext-a/skills/build-a-project/SKILL.md": HUB,
    "packages/ext-a/skills/board-make/SKILL.md": MAKE,
    "packages/ext-a/skills/board-verify/SKILL.md": VERIFY,
    "packages/ext-a/skills/stray/SKILL.md": "---\nname: stray\ndescription: Not declared.\n---\n",
    "packages/ext-b/package.json": json({ name: "@protoboardai/ext-b", version: "1.0.1", description: "Protoboard extension: another circuit provider" }),
    "packages/ext-b/protoboard-extension.json": json({
      schema: "protoboard.extension/v0",
      id: "@protoboardai/ext-b",
      version: "1.0.0",
      description: "another circuit provider",
      skills: [{ id: "other-board", summary: "Another board path", path: "skills/other-board/SKILL.md" }],
      capabilities: [{ id: "circuit", summary: "PCBs too", native: "other", operations: { generate: { entry: "./ops.ts#generate", summary: "Generate another way" } } }],
      operations: [{ id: "report", summary: "Another report", entry: "./ops.ts#report" }],
    }),
    "packages/ext-b/skills/other-board/SKILL.md": "---\nname: other-board-renamed\ndescription: Another.\n---\n\nRun `protoboard run circuit:generate`.\n",
    "packages/ext-c/package.json": json({ name: "@protoboardai/ext-c", version: "1.0.0", description: "Protoboard extension: a skill with no operations of its own" }),
    "packages/ext-c/protoboard-extension.json": json({
      schema: "protoboard.extension/v0",
      id: "@protoboardai/ext-c",
      version: "1.0.0",
      description: "a skill only",
      skills: [{ id: "c-skill", summary: "Runs what others provide", path: "skills/c-skill/SKILL.md" }],
    }),
    "packages/ext-c/skills/c-skill/SKILL.md": "---\nname: c-skill\ndescription: Runs what others provide.\n---\n\nRun `protoboard run circuit:generate --module b`, then `protoboard run report`.\n",
    "node_modules/@deltarobotics/uhd/package.json": json({ name: "@deltarobotics/uhd", version: "1.0.0", description: "Universal Hardware Description" }),
    "node_modules/@deltarobotics/uhd/skills/uhd-authoring/SKILL.md": "---\nname: uhd-authoring\ndescription: How to write UHD.\n---\n",
    "examples/demo/package.json": json({ name: "demo", private: true, version: "0.1.0", description: "Protoboard reference project: a demo board", devDependencies: { "@protoboardai/ext-a": "^1.0.0", "@protoboardai/core": "^1.0.0" } }),
    "examples/demo/protoboard.config.ts": "export default {};\n",
    "docs/specs/foo.md": "# Foo: the board spec\n\nStatus: built. Nothing else.\n\nHow **board-make** works; run `protoboard check`; the tool `project_check`; see [bar](bar.md).\n",
    "docs/specs/bar.md": "# Bar\n\nAbout `@protoboardai/ext-a`.\n",
    "docs/specs/playbooks.md": "# Playbooks\n\nNothing here is built yet.\n",
    "docs/releases/stack-v1.md": "# Stack 1\n\n## Unreleased\n\n- **The check got faster.** `protoboard check` now caches.\n\n## 1.0.0\n\n- **First release.** Everything.\n",
  };
}

/** The same stack installed: node_modules/@protoboardai/<name> (no workspaces, no docs, no examples). */
export function installedFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, content] of Object.entries(stackFiles())) {
    const m = /^packages\/([^/]+)\/(.*)$/.exec(rel);
    if (m) out[`node_modules/@protoboardai/${m[1]}/${m[2]}`] = content;
    else if (rel.startsWith("node_modules/")) out[rel] = content;
  }
  out["package.json"] = json({ name: "stack-copy", private: true, dependencies: { "@protoboardai/cli": "1.0.0" } });
  return out;
}
