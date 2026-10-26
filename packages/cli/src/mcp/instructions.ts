/**
 * What an agent is told on connecting to the Protoboard MCP server (PB-930,
 * docs/specs/agents-and-mcp.md §2.2). Claude Code cuts a server's
 * instructions, and each tool's description, at 2 048 characters: the text
 * stays under that (a test checks it), with what matters most first.
 */

/** The limit Claude Code applies to instructions and to each tool description. */
export const DESCRIPTION_LIMIT = 2048;

export function serverInstructions(templates: string[]): string {
  const list = templates.length ? templates.join(", ") : "none installed";
  return `Protoboard designs hardware as code: a project is a folder whose system (modules, parts, interfaces, links, harnesses, artifacts) is written in UHD, the open Unified Hardware Description (*.uhd.ts, package @deltarobotics/uhd) and checked, built and released with the \`protoboard\` CLI. These tools run that CLI.

This is NOT the Protoboard alpha web app. There is no browser board to open or connect to; do not look for one. Work in the project's files and with these tools; people see the result in the Protoboard VS Code extension.

Start with project_status: whether the folder is a project, what is installed, whether the user is signed in.

No project yet: project_init (templates: ${list}; none gives a blank project with ext-hardware). Projects use the Protoboard installed on this machine: never run \`npm install\` (only for a project-local stack the user asked for). Add an extension with \`protoboard extensions add <name>\`.

In a project, read AGENTS.md first (inside a larger repository it says what the workspace's guidance governs), then the build-a-project skill (skill_read), which gives the order of work and the skill for each stage, and the UHD reference in node_modules/@deltarobotics/uhd/docs. Run project_check before and after every change.

Rules:
- Cite a source for every number; mark assumptions.
- Never edit generated files (.protoboard/ except display.json, release/) or parts/catalog; a variant is a new part in parts/local.
- Boards follow the circuit-board skill; never \`tsci\` on a project's board. Another PCB tool only when that path fails, and say so to the user first.
- When interfaces do not fit, stop and check the datasheet; never invent wires or drop functions.
- Never put a sign-in, token or key in a file; when a tool says a sign-in is needed, ask the user to sign in; the result says how.
- These tools never publish, order or upload. A passing check validates the model, not physical readiness.`;
}

/** The longer guide, as a resource: the instructions and the commands an agent runs in a shell. */
export function guideText(templates: string[]): string {
  return `# Working with Protoboard

${serverInstructions(templates)}

## Commands to run in a shell (not tools)

The command is \`protoboard …\`. If the shell does not find it: a new VS Code terminal (the extension adds it), \`~/.protoboard/bin/protoboard\` (\`%USERPROFILE%\\.protoboard\\bin\\protoboard.cmd\` on Windows), or in a project \`./node_modules/.bin/protoboard\`. Never run a bare \`npx protoboard\`: npx would fetch an unrelated public package of that name. Never run \`npm install\` to set a project up or to add something: projects use the Protoboard installed on this machine.

- \`protoboard stack link\` in a project whose packages are missing: links them to the Protoboard installed on this machine (no npm).
- \`protoboard extensions add <name>\`: adds an extension (ext-tscircuit, ext-enclosure-cad, …) and exports its skills.
- Signing in is the user's to do, never yours: in VS Code the command "Protoboard: Sign In to Protoboard Cloud" (or the account on the page "Protoboard: Open Settings"); in a terminal \`protoboard login\` (a browser, or a code with --device).
- \`protoboard doctor\`: extensions, external tools and runtimes; \`protoboard tools install <cad|circuit|all>\` installs a runtime.
- \`protoboard skills read <name>\`: a skill's text, as skill_read gives it.
- \`protoboard release\`: writes the Manufacturing Package; release_check says first whether it would be refused.
- \`protoboard --help\`: every command. Add \`--format json\` for machine output.

## The order of work

1. project_status.
2. No project: project_init.
3. Read AGENTS.md and the build-a-project skill; write requirements in docs/brief.md.
4. Find parts with parts_search, add them with parts_add; research a part the library lacks into parts/local with the parts skills.
5. Compose the system in src/*.uhd.ts; project_check after each change; project_inspect to see what resolved.
6. project_layout: lay the diagram out by function, compact, and fix what it reports before you call the build done.
7. project_build, bom, then release_check.
`;
}
