# Agents and the MCP server

Status: built after 0.1.3. This is the discovery half: an agent on the
user's machine knows what Protoboard is and can start and work on a project.
A live bridge to the VS Code window (reading the selection, capturing a view)
is not part of it; section 7 says where it will attach.

The problem it solves: in an empty folder an agent did not know what
Protoboard was and went looking for the earlier Protoboard web app. It only found the CLI because the repository was on that machine.

## 1. The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| The MCP server | `protoboard mcp` (`packages/cli/src/mcp/`) | Speaks MCP over stdio. Tells an agent what Protoboard is and wraps the CLI's commands as tools |
| The launcher | `<config dir>/agents/protoboard-mcp` (`packages/core/src/agent-launcher.ts`) | The stable path an agent's configuration points at. Finds Node and the current CLI each time it starts |
| Agent detection and configuration | `packages/core/src/agents.ts` | Finds the agents installed here, reads whether Protoboard is configured, adds or removes its entry |
| The CLI | `protoboard agents`, `agents setup`, `agents remove`, `agents config` | The same for people without the extension |
| The settings page | `Protoboard: Open Settings` in VS Code | The account, the stack version, the agents with Connect and Disconnect, and the configuration for any other MCP client |
| The first-run offer | A notification in VS Code | Once, after the first sign-in or the first project: connect the detected agents |

## 2. The MCP server

`protoboard mcp` takes no arguments. It is the official TypeScript SDK,
`@modelcontextprotocol/sdk` pinned at exactly **1.32.1**, which speaks
protocol version **2025-11-25** and negotiates down to 2025-06-18,
2025-03-26, 2024-11-05 and 2024-10-07 for older clients. The transport is
stdio only: nothing listens on a port.

It works with or without a project. The folder a tool works in is, in this
order: the tool's `dir` argument; `PROTOBOARD_PROJECT_DIR`; the client's
first root, when the client offers roots (asked again after the client says
its roots changed); the folder the server was started in. A client with no
workspace (Claude Desktop) offers no roots and starts servers in `/` or the
home folder: `project_status` then says first that no folder was chosen and
that the agent should ask the user for one and pass it as an absolute `dir`.

### 2.1 Every tool runs the CLI

A tool does not call the core library. It runs the CLI as a child process,
`node <cli> <command> --format json`, and returns what the CLI printed. That
is deliberate:

- **The sign-in gate applies.** The gate lives in the CLI's command
  layer. A tool that went around the CLI would go around the gate.
- **A project's own CLI version is respected.** A tool uses the
  `@protoboardai/cli` installed in the project (the nearest `node_modules`
  from the folder up), and the CLI that carries the server only when the
  folder has none. The server can be newer than the project.
- **One behaviour.** What an agent gets from a tool is what it would get
  from the command, so AGENTS.md, the skills and the tools never disagree.

The cost is about a second of start-up per call.

A command that fails returns its message as the tool's result with
`isError`. A message that says a sign-in is needed is returned as a normal
result, `{ "signInRequired": true, "message": …, "action": … }`, where the
action is to ask the user to sign in and then try again. The action names
the route that always exists first, the VS Code extension ("Protoboard: Sign
In to Protoboard Cloud", or the account on the settings page), because a
user who has only the extension has no `protoboard` command outside a VS
Code terminal; then `protoboard login` where that command exists. The
server never signs in, and has no tool that does.

A result longer than 40 000 characters is written to a file and the tool
returns the file's path with the start of the text, so an agent's context is
not flooded (Claude Code warns at 10 000 tokens and stops at 25 000). The
file can hold a project's BOM or model, and the system's temporary folder is
shared on Linux: each server makes its own folder there
(`protoboard-mcp-<random>`, mode 0700, files 0600), and a server that starts
removes this user's folders that are more than a day old.

### 2.2 Instructions

The text an agent sees on connecting. Claude Code cuts a server's
instructions and each tool description at 2 048 characters, so the text is
held under that and a test fails when it grows past it. It says:

- what Protoboard and UHD are;
- that this is **not** the earlier Protoboard web app: no browser board, no
  board to open or connect, nothing to search the web for;
- to call `project_status` first;
- in an empty folder: create a project with `project_init`, which templates
  exist (read from the installed templates, not typed), then `npm install`;
- in a project: read AGENTS.md, then the build-a-project skill, the UHD
  reference in `node_modules/@deltarobotics/uhd/docs` and the uhd-authoring
  skill; check before and after every change;
- the rules: cite sources; never edit generated files or `parts/catalog`;
  stop when interfaces do not fit; never put a sign-in in a file; nothing
  here publishes, orders or uploads.

Not every client shows instructions to the model. So `project_status`
returns the same text in its `about` field, and its description says to call
it first.

### 2.3 Tools

Thirteen tools. Each takes an optional `dir`.

| Tool | CLI command | Changes files | Network |
| --- | --- | --- | --- |
| `project_status` | `whoami`, then `doctor` in a project or `init --list` outside one | no | no |
| `project_init` | `init <dir> [--template] [--name]` | **yes**: creates the project folder | yes: a template's catalog parts |
| `project_check` | `check` | no | no |
| `project_inspect` | `inspect [instance]` | no | no |
| `project_build` | `build` | **yes**: `.protoboard/build/` only (derived data) | no |
| `project_layout` | `layout [level] [--apply\|--tidy] [--pin]` | with `mode` apply or tidy: `.protoboard/display.json`, the levels that read clearly better and already have a saved layout | no |
| `parts_search` | `parts search` | no | yes |
| `parts_add` | `parts add` | **yes**: `parts/catalog`, `parts/origins.json` | yes; needs a sign-in |
| `parts_list` | `parts list [--check]` | no | only with `checkUpdates` |
| `skills_list` | `skills` | no | no |
| `skill_read` | `skills`, then the skill's file | no | no |
| `bom` | `bom [--units] [--release]`: the design's bill, each line with its chosen offer and `offerCount`, without the list of every offer | no | no |
| `release_check` | `release --check` | no | no |

The annotations: no tool has `readOnlyHint`. Every one runs the
Protoboard CLI in the project, which evaluates the project's own TypeScript
(protoboard.config.ts and its model files) and may be the project's own CLI
from node_modules, so a client asks before it runs one; each description
ends by saying so. `destructiveHint: false` on all of them (the four that
write add files; none deletes the user's work; `project_layout` replaces a level's saved
diagram layout only with one that reads clearly better, keeps pinned cards,
and the file is in git), `openWorldHint` on the ones
that reach a library.

`project_check` returns the diagnostics at or above a severity (default
`warning`) with the counts of all of them, so a large project's information
lines do not fill the context. Everything else is the CLI's JSON unchanged.

**A tool's arguments are values, never options of the CLI.** The CLI reads
a word that starts with a dash as an option, and it has options a tool must
not be given by an agent (`--url` points a command at another parts service,
`--allow-dirty` skips a release precondition, `--cwd` moves it). So the
command line a tool builds (`cliArgs` in `packages/cli/src/mcp/tools.ts`)
has three parts: the command and the tool's own flags; each option the tool
takes as `--name=value`, where a value that starts with a dash or holds a
line break is refused before the CLI runs; then `--`, and after it
everything that is not an option (search words, part ids, an instance path,
the folder for `init`). The CLI reads no options after `--`, `--help`
included, so a search for `-5V regulator` or `--help` is a search.

**Left out on purpose:**

- `release` without `--check`, `parts publish`, `run` (extension operations,
  some of which are external or physical), `tools install`, `libraries add`:
  an agent that needs one runs the command in a shell, where the user's
  agent asks for permission in its usual way. Nothing in the server
  publishes, orders or uploads.
- `login`, `logout`: the user signs in, in their own terminal and browser.
- `parts prices`, `parts usage`, `parts offers`: prices by source are
  undecided, and usage is
  the publishers' own. No tool says how prices are fetched, and no tool
  returns a credential or a token. `bom` prices from what the project
  already holds.
- `dev`: a long-running server; the extension starts it.

### 2.4 Resources and prompts

Claude Code, Cursor, VS Code, Gemini CLI and Windsurf support both; Codex
documents tools and instructions only, and Cline tools. So the tools are the
whole surface, and these are conveniences on top:

- Resource `protoboard://guide`: the instructions with the commands an agent
  runs in a shell, for a client that attaches resources as context. It is
  served in any folder, an empty one included, so it never names a bare
  `npx protoboard` as something to run (as for the project entry in 3):
  the commands are `npx --no-install protoboard …`, for a project whose
  packages are installed, and it says why. A test reads the guide, the
  instructions and every tool description for a bare form.
- Resource `protoboard://project/AGENTS.md`: the project's AGENTS.md, listed
  only when the folder is a project that has one.
- Prompt `new_project(what)`: start a project for a device.
- Prompt `continue_project`: pick up an existing one.

The skills are not prompts. There are about thirty; as prompts they would
fill every client's slash menu, and a project already gets them as real
skills in `.claude/skills/` and listed in AGENTS.md. `skills_list` and
`skill_read` reach them from any client.

## 3. The launcher

An agent's configuration holds one command. It has to keep working when:

1. the extension updates (its folder name carries the version);
2. Node moves (an nvm upgrade), or the agent was started from the Dock on
   macOS and has no shell PATH;
3. a project has its own CLI version;
4. the user has the extension and no CLI on PATH.

So the configuration never points into the extension, into a project or at
`node`. It points at a launcher in Protoboard's own per-user folder, which
does not move:

| | Folder |
| --- | --- |
| Linux and macOS | `$XDG_CONFIG_HOME/protoboard/agents`, else `~/.config/protoboard/agents` |
| Windows | `%APPDATA%\protoboard\agents` |

It holds:

- `protoboard-mcp` (a POSIX shell script) and `protoboard-mcp.cmd`: find
  Node (the path in `node-path`, else `node` on PATH, else the places
  installers put it), then run the script below. They never change, so
  nothing is quoted into them.
- `protoboard-mcp.mjs`: has no dependencies. It picks the CLI and runs
  `<cli> mcp`, passing stdio through.
- `launcher.json` (`protoboard.launcher/v1`): the CLIs recorded on this
  machine, each `{ entry, version, from }`, where `from` is `extension`,
  `npm` or `project`.
- `node-path`: the Node that last ran `agents setup`, or the one the
  extension runs the CLI with.
- `node-electron`: present when that runtime is an editor's own (VS Code's,
  on a machine with no Node.js 22). The launcher then sets
  `ELECTRON_RUN_AS_NODE=1` for it, without which it would open a window.

The CLI the launcher runs, first that exists: `PROTOBOARD_CLI`; the recorded
ones, the extension's and a global install before a project's, newest
version first; the CLI of the project the agent was started in. The server
it starts then uses the project's own CLI for each tool (2.1), so 3 holds
even when the server is the carried one.

What an agent's configuration gets:

```json
{ "command": "/home/you/.config/protoboard/agents/protoboard-mcp", "args": [] }
```

and on Windows `{ "command": "cmd", "args": ["/c", "C:\\Users\\you\\AppData\\Roaming\\protoboard\\agents\\protoboard-mcp.cmd"] }`,
because several clients start a server without a shell and cannot run a
`.cmd` file directly.

`protoboard agents setup` (with the first yes for an agent, not before) and
`agents refresh` rewrite the launcher's files and record the CLI that ran
them; entries whose file is gone are dropped. `agents config` prints and
writes nothing; when the launcher is not there yet it says to run
`agents refresh`. The extension does the same in process when an agent is
connected from its settings page, or an entry is copied from it by hand,
with the Node.js it runs the CLI with (never the editor's own executable).
When it starts, in any window (a project open or not), and a launcher is
already there, it records again the CLI that stays put: the one the folder
resolves to, or, when that is a project's own, the one resolved from the
home folder, which is where the carried stack is found (`cliToRecord()` in
`packages/vscode-protoboard/src/agents.ts`). A project's own CLI is never
recorded unasked. So an updated extension is recorded before an agent next
starts the server. It never creates the launcher unasked.

**The seam with the carried CLI** (the extension carries the CLI). The extension asks
one function which CLI belongs to the machine, `machineCli()` in
`packages/vscode-protoboard/src/agents.ts`. It is what `resolveCli` finds
from the current folder. Without a carried CLI that is the project's CLI, else
`protoboard` on PATH (which records itself, by `agents refresh`); a user
with the extension, no project open and no CLI on PATH can then see the
agents but cannot connect one, and the row says why. With a carried CLI,
`resolveCli` ends at the stack the extension carries (`from: "carried"`, or
`"store"`), which `machineCli()` records as the extension's; the launcher
prefers it. What the merge has to do:

1. In `extension.ts`, the settings page's `cliSettings` passes the carried CLI's
   `carried`, `stacks` and `runtime` to `resolveCli`, and gives the launcher
   that runtime: `nodeFile` is its command and `electron` is true when it is
   VS Code's own (`runtime.env.ELECTRON_RUN_AS_NODE`).
   With that, `cliToRecord()` finds the carried stack on activation with no
   further change; the merge should add a case to its test in
   `test/settings.test.ts` with `from: "carried"`.
2. In the CLI, `mcp` and `agents` work signed out, as every local command
   does since 0.2.0 (only the cloud needs a sign-in,
   `packages/cli/src/gate.ts`).

A cloud command signed out prints `{"error", "code":
"SIGN_IN_REQUIRED", "access"}`. The server reads the code, not the wording,
and answers `signInRequired` with what to ask the user. `project_status`
reads `access` from `whoami` and mentions the sign-in once, at the end of
`next`; only for a project pinned to a CLI before 0.2.0, which refuses every
command signed out (it reports `access.required`), does it come first.

**A project-scope entry is different.** A file shared through git cannot
hold a path on one person's machine. When the project depends on
`@protoboardai/cli`, a project-scope entry is
`npx --no-install protoboard mcp`, which runs the project's own CLI on
anyone's machine (`--portable` forces it, `--no-portable` writes the
launcher instead).

Where the project does not depend on the CLI, a project-scope entry is this
machine's launcher, which does nothing for a teammate: the result carries a
warning that says so and not to commit the file as it is. The same for the
`<file>.protoboard-backup` copy a write in a project leaves; a generated
project's `.gitignore` covers `*.protoboard-backup`.

`--no-install` is required, not a nicety. The
unscoped name `protoboard` on the public registry is someone else's package.
An agent starts the entry with no terminal, and without the flag npx, where
the project's packages are not installed (a fresh clone), fetches that
package and runs it without asking, each time the agent starts. With the
flag it stops with "npx canceled due to missing packages", the agent shows
the server as failed, and `npm install` in the project fixes it. A test
runs both forms against a local registry that offers such a package. An
entry written before this (`npx protoboard mcp`) is recognised as this
server's, shown as needing an update, and rewritten by `agents setup`.

## 4. Detecting and configuring agents

Each location and format below was read from the agent's own documentation
on 2026-10-07. The entry is named `protoboard-stack` (0.1.7).

**One name, `protoboard-stack`, everywhere.** Until 0.1.6 the entry was
`protoboard`, and `protoboard-stack` only beside another server of that name.
The earlier Protoboard web app's MCP server is called `protoboard` on many
machines and in company workspaces' `.mcp.json`, and an agent told to use "the
Protoboard MCP server" took whichever it met first. So there is one name for
this server in every file
and every scope, so a shared project file reads the same whoever wrote it,
and the server's own name (`initialize`) is `protoboard-stack` too.

- An entry is this server's only when its command is the launcher or
  `protoboard mcp` (`isOurs`).
- **Migration.** An entry of this server under `protoboard` (written by 0.1.6
  or earlier) is shown as outdated (`legacyName`) and `agents setup` renames
  it: in a JSON file the key is renamed where it is, in TOML the table
  headers; what the user set beside the command (env, approved tools) stays.
  Claude Code's user file is changed through its command: `claude mcp remove
  protoboard`, then `claude mcp add … protoboard-stack`. `agents remove`
  takes out both names.
- **Never touched:** an entry named `protoboard` that points anywhere else
  (the earlier web app's); it is reported (`alphaServer`) and left as it is.
- **Refused:** an entry named `protoboard-stack` that is not this server;
  nothing is written over it, and the state says what it is.
- Every project's AGENTS.md says which server is its own and that a
  `protoboard` server with `list_boards` / `open_board` is the retired web
  app.

| Agent | id | User configuration | Format | Project scope |
| --- | --- | --- | --- | --- |
| Claude Code | `claude-code` | `~/.claude.json` (`$CLAUDE_CONFIG_DIR/.claude.json`), top-level `mcpServers` | JSON | `.mcp.json` |
| Claude Desktop | `claude-desktop` | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows `%APPDATA%\Claude\claude_desktop_config.json` | JSON, `mcpServers` | none |
| Cursor | `cursor` | `~/.cursor/mcp.json` | JSON, `mcpServers` | `.cursor/mcp.json` |
| VS Code (Copilot agent mode) | `vscode`, `vscode-insiders` | `mcp.json` in the user folder: `~/.config/Code/User`, `~/Library/Application Support/Code/User`, `%APPDATA%\Code\User` | JSON with comments, `servers`, `"type": "stdio"` | `.vscode/mcp.json` |
| Windsurf (now Devin Desktop) | `windsurf` | `~/.config/devin/mcp_config.json` (`$XDG_CONFIG_HOME`; Windows `%APPDATA%\devin`), or the earlier `~/.codeium/windsurf/mcp_config.json` when that is the one present | JSON, `mcpServers` | none |
| Codex | `codex` | `~/.codex/config.toml` (`$CODEX_HOME`) | TOML, `[mcp_servers.protoboard]` | `.codex/config.toml` |
| Gemini CLI | `gemini` | `~/.gemini/settings.json` | JSON, `mcpServers` | `.gemini/settings.json` |
| Cline (VS Code) | `cline` | `globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` in VS Code's user folder | JSON, `mcpServers` | none |
| Cline CLI | `cline-cli` | `~/.cline/data/settings/cline_mcp_settings.json` (`$CLINE_MCP_SETTINGS_PATH`) | JSON, `mcpServers` | none |

Sources: code.claude.com/docs/en/mcp; modelcontextprotocol.io (connect
local servers); cursor.com/docs/context/mcp;
code.visualstudio.com/docs/copilot/customization/mcp-servers;
docs.devin.ai/desktop/cascade/mcp; the Codex MCP page
(learn.chatgpt.com/docs/extend/mcp); geminicli.com/docs/tools/mcp-server;
docs.cline.bot/mcp/configuring-mcp-servers.

Not from the agent's own documentation, and marked so in the code: Cline's
VS Code path (its documentation names the file, not the folder; the path is
the extension's global storage), Claude Desktop on Linux (`~/.config/Claude`,
used by unofficial builds; detected only when the folder exists), and the
earlier Windsurf folder.

**Detected** means the agent's configuration folder exists or its command is
on PATH. Detection reads; it never writes.

**Reading** the state gives, per agent: detected or not and why, the file,
whether a `protoboard` entry is there, and whether it is the entry setup
would write (`current`) or an older one (`outdated`). Of another server that
holds the name `protoboard` it says only the host of its URL or the name of
its command, never a path, a query or an argument: a key can be in those,
and the text goes to a terminal, the log and the settings page.

**Writing**

- The file is parsed and edited in place. In a JSON file only the
  characters of the one entry change (its property, its comma, its own
  lines), found with `jsonc-parser`'s syntax tree: comments, key order,
  indentation and line endings stay, a neighbour written on one line stays
  on one line, a file written on one line stays on one line, and trailing
  commas stay where the file has them. Adding and then removing gives the
  file back byte for byte, with one exception: a servers object that had to
  be created stays, empty. (The parser's own `modify` re-indents the lines
  around an edit, so it is used only for an object that holds nothing but
  comments.) TOML is edited as text. A new `[mcp_servers.protoboard]` table
  is appended. An update changes the table's `command` and `args` lines
  where they are (or, when a value runs over several lines, writes the table
  again in the same place). A removal cuts the table and its sub-tables. The
  table ends at its last line that holds a key or a value: the blank lines
  and comments after it belong to what follows and are never touched.
- A byte-order mark at the start of a file (Windows editors write one) is
  not part of its JSON or TOML: it is skipped on reading and kept on
  writing.
- After the edit and before the file is replaced, the result is parsed again
  and compared with the original: everything except the `protoboard` entry
  must be equal. If it is not, nothing is written.
- A file that does not parse is never written to. The message says so and
  names the file.
- Before the first write to a file, a copy is made beside it:
  `<file>.protoboard-backup`. It is made once and never overwritten.
- The write is a temporary file renamed over the original, with the
  original's mode.
- Claude Code at user scope is the exception. `~/.claude.json` is Claude
  Code's own live state, rewritten while it runs, so an edit from outside
  can be lost or lose a change of Claude Code's. It is only ever read; setup
  and remove run `claude mcp add --scope user protoboard -- …` and
  `claude mcp remove --scope user protoboard`. The command is looked for on
  PATH and then where its installers put it (`~/.local/bin`,
  `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`,
  `~/.npm-global/bin`), because an editor started from the Dock has almost
  no PATH. When it is not found (or is npm's `.cmd` shim on Windows, which
  cannot be started without a shell), nothing is written: the state carries
  the command for the user to run (`manual`), the CLI prints it, and the
  settings page's row offers "Copy command" in place of Connect.
- Every write is reported: the agent, the file, what changed, the backup.

**Consent.** No agent's configuration is edited without the user's yes for
that agent:

- `protoboard agents setup` at a terminal asks about each detected agent.
  Until one has a yes it writes nothing at all, Protoboard's own launcher
  included.
- Without a terminal it changes nothing unless told which: `--agent <id>`
  (repeatable) with `--yes`, or `--all --yes`. `--yes` alone is refused.
- In VS Code each Connect button is one agent. The first-run notification's
  "Connect…" opens a pick list of the detected agents, none checked until
  the user checks it.

## 5. The CLI

```
protoboard agents                       the agents found here and their state
protoboard agents setup [--agent <id>]… [--all] [--yes] [--scope user|project]
protoboard agents remove [--agent <id>]… [--all] [--yes] [--scope user|project]
protoboard agents config                the JSON and instructions for any other MCP client; prints only
protoboard agents refresh               write or update the launcher (Protoboard's own folder; no agent's file)
protoboard mcp                          the server (an agent starts it)
```

`--format json` on each. `agents refresh` is for a client set up by hand
from `agents config`, and is what the extension runs for a `protoboard` on
PATH.

## 6. VS Code

**The settings page** (`protoboard.openSettings`, "Protoboard: Open
Settings"; the gear in the Cloud view's title; the account menu). A page in
an editor tab, drawn by `SettingsPage` in `@protoboardai/views` with the
libraries manager's components, in VS Code's theme. The extension runs the
detection and the edits in process (`@protoboardai/core/agents`, the code the
CLI runs), so the page lists agents in a window with no project and no CLI.
It is the home for Protoboard's settings, so it is a list of sections that
can grow:

1. **Account**: who is signed in, sign in or out.
2. **Protoboard**: the extension's and the stack's version, which CLI is
   used and where it was found, the log.
3. **Agents**: each agent found with its state (Connected, Update needed,
   Not connected, Cannot read its file), its configuration file and one
   button; a second line says what a change wrote and where. The agents not
   found are named below the list.
4. **Other MCP clients**: the steps, and the entry as JSON, for VS Code's
   `mcp.json`, as TOML, as a command and as a `claude mcp add` line, each to
   copy. The name in them (and in `agents config`) is `protoboard-stack`
   (since 0.1.7 always; before, only beside another server named
   `protoboard`).
5. **More settings**: opens VS Code's own settings for the extension, and
   the libraries manager. They are not repeated on the page.

VS Code's own extension API for MCP servers
(`mcpServerDefinitionProviders`) is not used in this pass: the server would
then start for Copilot's agent mode without the user choosing it, and the
entry in the user's `mcp.json` gives the same result with the same consent
as every other agent. It is the natural next step for VS Code alone.

**The first-run offer.** Once, after the first sign-in or the first time a
Protoboard project is open, when at least one detected agent is not
connected: "Connect your agents to Protoboard?" with **Connect…**,
**Open Settings** and **Not now**. Any answer, and dismissing it, is
remembered in the extension's global state; it is not shown again.
`protoboard.agents.offerSetup` (default on) turns it off before it shows.
**Connect…** opens a pick list of the agents found, none checked; only the
ones the user checks are connected (also **Protoboard: Connect Agents
(MCP)**).

## 7. Where the live bridge attaches

Not built. The server's tools are a list of specifications
(`packages/cli/src/mcp/tools.ts`: name, schema, annotations, a handler that
gets a context). `cliTools()` is the only source today. A bridge adds a
second source, `windowTools(bridge)`, registered when the launcher's
environment names a bridge (`PROTOBOARD_BRIDGE`) and left out otherwise, so
the server stays the same for an agent with no VS Code window. Its tools
would talk to the window through DevLink's relay, not to the CLI.

## 8. Verification

- `packages/core/test/agents.test.ts`: every format with fixture files
  (comments, tabs, CRLF, other servers, an empty file, a broken file), the
  backup, removal, the equality check, detection per platform, the launcher.
- `packages/cli/test/mcp.test.ts`: the SDK's client drives the server over
  stdio: instructions, the tool list and annotations, every tool against an
  example project and against an empty folder, resources and prompts.
- `packages/cli/test/agents-cli.test.ts`: the commands against a temporary
  HOME; consent.
- `packages/vscode-protoboard/test/settings.test.ts`: the page's model, the
  offer, the seam. The extension's integration test opens the page in a real
  VS Code with a temporary home, connects and disconnects agents, and starts
  the server through the launcher. `test/visual/settings-capture.ts` draws
  the page in six token sets, wide and narrow, and checks its actions.
- With Claude Code: a project-scope entry in a scratch folder and a
  non-interactive session asking what Protoboard is.

Not verified on a Mac or on Windows: the launcher's `.cmd` file, the
Dock-started PATH case, and each agent's real configuration file there. The
paths are from documentation and the fixtures are written to match it.

## `protoboard setup`

`protoboard setup` ([distribution](distribution.md))
installs the VS Code extension from the command line and then offers this
document's agent set-up: at a terminal it runs `protoboard agents setup`,
which asks about each agent as always. `setup --yes` never stands for an
agent's yes: without a terminal it leaves the agents alone and names the
command. `--no-agents` leaves the step out.
