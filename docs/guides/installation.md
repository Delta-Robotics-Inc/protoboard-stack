# Installing Protoboard

Protoboard designs hardware as code. A project is a folder: its modules, the
interfaces between them and the cables that connect them are written in UHD,
and the `protoboard` command checks them, builds them and makes a release.
The Protoboard extension shows the project as a diagram and in 3D in VS Code,
Cursor or Windsurf. An AI coding agent does most of the writing; you watch
the result in the editor.

This guide is for a person and for an agent doing the work for a person. The
steps are the same. Where an agent has to ask its user something, a note
says so.

**The current version.** This guide names no version number on purpose: you
always install the current version. To see which one you have, run
`protoboard --version` in a terminal, or **Protoboard: Open Settings** in the
editor. The extension and the command line share one version number and
move together.

> **If you are an agent doing this for someone:** ask them these questions
> before you install anything, in plain words, and wait for the answers.
> Do not choose for them.
>
> 1. **Which editor?** VS Code, Cursor or Windsurf.
> 2. **Which agent?** Claude Code, Codex, Cursor's agent, Windsurf's agent,
>    GitHub Copilot in VS Code, or another MCP client. You may be the answer.
> 3. **Start a project now?** If yes, in which folder, under what name, and
>    from which starting point ([Your first project](#your-first-project)).

## What you need

| | Needed for | Notes |
|---|---|---|
| VS Code, Cursor or Windsurf | the extension: the viewer, the Inspector, the checks in the editor | A current release. The extension needs an editor built on VS Code 1.106 or later; an older one refuses to install it and says so. |
| Nothing else | the extension and the `protoboard` command it brings | The extension carries the whole stack and runs it with the editor's own runtime: no Node.js, no npm. |
| Node.js 22 or later, with npm | the command line from npm; boards (the circuit runtime) | Only if you install the command line with npm, or design circuit boards. |
| Python 3, from 3.11 to 3.14 | the 3D generators: enclosures, frames, cables and part bodies | Only for CAD. `protoboard tools install cad` makes a Python runtime of about 1 GB for a project, once. |
| Google Chrome, Chromium, Microsoft Edge or Brave | documents and the release package's PDFs | Found where your system installs it, or set `CHROME` to its executable. |
| KiCad 10 | the hand-placement step of a board, and its fabrication outputs | Optional. |
| An account | the Protoboard library only | Local work needs no account. See [Signing in for the library](#signing-in-for-the-library). |
| An AI coding agent | writing the project with you | Optional, and what Protoboard is built for. See [Connect your agent](#connect-your-agent). |

<!-- verified: engines.vscode ^1.106.0 (packages/vscode-protoboard/package.json); Python ">=3.11,<3.15" (packages/ext-*-cad/protoboard-extension.json); chrome, kicad-cli and tscircuit-node tools (packages/ext-docs, ext-release, ext-tscircuit protoboard-extension.json); the carried stack (packages/vscode-protoboard/scripts/build-stack.ts). -->

## Install on macOS

### The extension

In VS Code, open the Extensions view (Cmd+Shift+X), search for
**Protoboard** and press **Install**. It is published by Delta Robotics, on
the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=deltarobotics.vscode-protoboard)
for VS Code and on [Open VSX](https://open-vsx.org/extension/deltarobotics/vscode-protoboard)
for Cursor and Windsurf. Cursor and Windsurf show Open VSX in their own
Extensions view: search for **Protoboard** there. From a terminal:

```sh
code --install-extension deltarobotics.vscode-protoboard
```

(`cursor` or `windsurf` in place of `code` for those editors.) The terminal
knows `code` only after **Shell Command: Install 'code' command in PATH**
from VS Code's command palette (Cmd+Shift+P). Until then it is
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.

The first time it starts, the extension unpacks Protoboard into
`~/.protoboard` and shows its progress: some seconds, once per version.
Then the **Protoboard** icons are in the side bar and **Sign in** is in the
status bar.

### The protoboard command

New terminals inside the editor have the `protoboard` command already. For
every other terminal, and for an agent that starts its own shell, run
**Protoboard: Add the protoboard Command to PATH** once from the command
palette. It adds one line, marked `protoboard-path`, to the end of your
shell's start file (`~/.zshrc` for zsh, `~/.bash_profile` for bash) and
says which. Open a new terminal afterwards. The command itself is
`~/.protoboard/bin/protoboard`.

Or install the command line with npm instead (Node.js 22 or later):

```sh
npm i -g @protoboardai/cli
```

npm puts it on your `PATH` itself. The extension and an npm install work
side by side.

### Check it

```sh
protoboard --version
protoboard doctor
```

`doctor` lists the version and build, your sign-in, where the stack's
packages come from and, in a project, its extensions, tools and skills
(what each line means: [Troubleshooting](#troubleshooting)).

The 3D generators need a Python that can make a runtime. Homebrew's cannot
on some macOS versions: `protoboard tools install cad` then lists what it
tried and prints what to run instead (`brew install uv && uv python install
3.12`, then `protoboard tools install cad` again).

## Install on Windows

### The extension

In VS Code, open the Extensions view (Ctrl+Shift+X), search for
**Protoboard** and press **Install**: the one published by Delta Robotics.
In Cursor or Windsurf, the same in their own Extensions view (they install
from [Open VSX](https://open-vsx.org/extension/deltarobotics/vscode-protoboard)).
From PowerShell:

```powershell
code --install-extension deltarobotics.vscode-protoboard
```

The VS Code installer adds `code` to `PATH` (its option "Add to PATH", on by
default): open a new terminal after installing VS Code. Otherwise it is
`"%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"` (installed for
you alone) or `"%ProgramFiles%\Microsoft VS Code\bin\code.cmd"` (for
everyone).

The first time it starts, the extension unpacks Protoboard into
`%USERPROFILE%\.protoboard` and shows its progress. SmartScreen or your
antivirus may ask about the editor the first time; that is not Protoboard.

### The protoboard command

New terminals inside the editor have the `protoboard` command already. For
every other terminal, run **Protoboard: Add the protoboard Command to PATH**
once from the command palette (Ctrl+Shift+P). It adds
`%USERPROFILE%\.protoboard\bin` to the end of your user `Path` (your own
environment variables; no administrator rights). Open a new terminal
afterwards. The command itself is
`%USERPROFILE%\.protoboard\bin\protoboard.cmd`.

Or install the command line with npm (Node.js 22 or later):

```powershell
npm i -g @protoboardai/cli
```

Commands in this guide work as written in PowerShell and in the editor's
terminal. In the old Command Prompt, put a link that contains `&` in double
quotes.

### Check it

```powershell
protoboard --version
protoboard doctor
```

The 3D generators need Python from python.org or the Microsoft Store; open a
new terminal after installing it.

## Install on Linux

### The extension

In VS Code, open the Extensions view (Ctrl+Shift+X), search for
**Protoboard** and press **Install**: the one published by Delta Robotics.
In Cursor, Windsurf or VSCodium, the same: they install from [Open
VSX](https://open-vsx.org/extension/deltarobotics/vscode-protoboard). From
a terminal:

```sh
code --install-extension deltarobotics.vscode-protoboard
```

VS Code's `.deb`, `.rpm` and snap packages install `code` on your `PATH`.
The extension carries Protoboard for x64 and arm64 Linux with glibc; on a
system with musl (Alpine) install the command line with npm instead.

The first time it starts, the extension unpacks Protoboard into
`~/.protoboard` and shows its progress.

### The protoboard command

New terminals inside the editor have the `protoboard` command already. For
every other terminal, run **Protoboard: Add the protoboard Command to PATH**
once from the command palette (Ctrl+Shift+P). It adds one line, marked
`protoboard-path`, to the end of your shell's start file (`~/.bashrc`,
`~/.zshrc`, a fish `conf.d` file, else `~/.profile`). Open a new terminal
afterwards. The command itself is `~/.protoboard/bin/protoboard`.

Or install the command line with npm (Node.js 22 or later):

```sh
npm i -g @protoboardai/cli
```

### Check it

```sh
protoboard --version
protoboard doctor
```

The 3D generators need `python3` with `venv` (on Debian and Ubuntu: `sudo
apt install python3-venv`). The document checks use poppler (`sudo apt
install poppler-utils`).

<!-- verified: the PATH line and its files (packages/core/src/path-setup.ts); ~/.protoboard and its bin (packages/core/src/stack.ts, stackHome and writeCommands); the platforms carried, glibc only (packages/vscode-protoboard/scripts/build-stack.ts, DEFAULT_PLATFORMS); the macOS Python advice (packages/core/src/python.ts). -->

> **If you are an agent doing this for someone:** installing an extension
> and changing a shell's start file are their decisions. Ask before you run
> `code --install-extension` or `npm i -g`, and say what each changes. Never
> run a bare `npx protoboard`: npm would fetch an unrelated public package
> of that name. The scoped name is `npx @protoboardai/cli`.

### Setting up a machine from the command line

`protoboard setup` installs the extension into every editor it finds (VS
Code, Cursor, Windsurf and VSCodium, asking about each), then offers to put
the `protoboard` command on your `PATH` and to connect your agents. It needs
no account and no sign-in. It never runs by itself, and it is safe to run
again.

```sh
protoboard setup
```

It installs the extension by its id, `deltarobotics.vscode-protoboard`,
through each editor's own command (`code --install-extension
deltarobotics.vscode-protoboard`, and the same with `cursor`, `windsurf` or
`codium`): VS Code takes it from the Marketplace, the others from Open VSX.
If an editor answers that the extension is not there, `setup` says so in one
line and still sets up the `PATH` and your agents. On a machine without a
connection, give it the `.vsix` file instead:

```sh
protoboard setup --vsix <file>
```

| To | Add |
|---|---|
| Set up one editor only (`code`, `cursor`, `windsurf` or `codium`) | `--editor <id>` |
| Not be asked about each editor and the `PATH` | `--yes` |
| Leave the agents' configuration alone | `--no-agents` |

<!-- verified: packages/cli/src/setup.ts (EXTENSION_ID, findEditors, installCommand, notPublished, setupCommand) and the CLI's help; run signed out in a scratch HOME with a recording `code` on PATH, it ran `code --install-extension deltarobotics.vscode-protoboard --force`, said the extension is not published yet when that `code` answered "not found", then offered the PATH and the agents (2026-10-25). -->

## Connect your agent

A connected agent has Protoboard's MCP server, **protoboard-stack**: it
knows what Protoboard is in any folder, an empty one included, and has
Protoboard's commands as tools (`project_status`, `project_init`,
`project_check`, `project_inspect`, `project_build`, `parts_search`,
`parts_add`, `skill_read`, `bom`, `release_check` and others). Connect it in
one of three ways:

- **In the editor:** **Protoboard: Open Settings**, then **Connect** on your
  agent's row. **Protoboard: Connect Agents (MCP)** lists the agents found,
  none checked, and connects the ones you check.
- **In a terminal:** `protoboard agents setup`. It asks about each agent it
  finds. `protoboard agents` lists them and whether each is connected.
- **By hand:** `protoboard agents config` prints the entry for any client,
  as JSON, as TOML and as a `claude mcp add` line.

```sh
protoboard agents setup
protoboard agents
```

Each way changes only Protoboard's entry in the agent's configuration file,
keeps a copy of the file before its first change (`<file>.protoboard-backup`),
and says what it wrote where. A file that does not parse is left alone.
Another server named `protoboard` (an older Protoboard product's) is left as
it is.

The entry starts a small launcher in Protoboard's own folder, so it keeps
working when Protoboard updates:

| | The launcher |
|---|---|
| macOS and Linux | `~/.config/protoboard/agents/protoboard-mcp` (in `$XDG_CONFIG_HOME/protoboard` when that is set) |
| Windows | `cmd /c %APPDATA%\protoboard\agents\protoboard-mcp.cmd` |

The launcher is written with the first connection. For a client you set up
by hand, run `protoboard agents refresh` once to write it.

**What the agent reads.** Every project has an `AGENTS.md`: what Protoboard
is, the order of work, the rules and the list of skills. Its `CLAUDE.md`
holds one line, `@AGENTS.md`, so Claude Code reads the same. The skills
(step-by-step guides for each stage) are copied to `.claude/skills/` for
Claude Code; any agent reads one with `protoboard skills read <name>` or the
`skill_read` tool. The MCP server tells every agent it connects to to call
`project_status` first, then to read `AGENTS.md` and the build-a-project
skill.

<!-- verified: the agents and their files (packages/core/src/agents.ts, AGENTS); the launcher (packages/core/src/agent-launcher.ts, launcherCommand; configDir in packages/core/src/account.ts); agents setup, config and refresh (packages/cli/src/agents.ts); CLAUDE.md is "@AGENTS.md" (packages/core/src/init.ts, CLAUDE_MD); the server's instructions (packages/cli/src/mcp/instructions.ts); the tools (packages/cli/src/mcp/tools.ts). -->

> **If you are an agent doing this for someone:** an agent's configuration
> is theirs. Ask which agents to connect, then run `protoboard agents setup
> --agent <id> --yes` for each one they named (the ids are in `protoboard
> agents --format json`). Without a terminal to ask at, `agents setup`
> changes nothing unless it is given `--agent` or `--all` with `--yes`.

### Claude Code

Connect: **Connect** on the Claude Code row, or `protoboard agents setup`.
Protoboard runs Claude Code's own command for this, because Claude Code
rewrites its configuration file while it runs. By hand, on macOS or Linux:

```sh
claude mcp add --scope user protoboard-stack -- ~/.config/protoboard/agents/protoboard-mcp
```

On Windows, copy the line `protoboard agents config` prints. In Claude Code,
`/mcp` lists the server once a new session starts.

Reads: `CLAUDE.md` (which imports `AGENTS.md`) and the skills in
`.claude/skills/`.

First prompt, in an empty folder:

> Use the protoboard-stack tools. Call project_status, then make me a
> Protoboard project here from the iot template and run a check. Tell me
> what is in it before you change anything.

### Codex

Connect: **Connect** on the Codex row, or `protoboard agents setup`. It adds
the server to `~/.codex/config.toml` (in `$CODEX_HOME` when that is set),
which the Codex CLI, its IDE extension and its desktop app share. By hand,
with your home folder's full path:

```toml
[mcp_servers.protoboard-stack]
command = "/Users/you/.config/protoboard/agents/protoboard-mcp"
args = []
```

Reads: `AGENTS.md`; the skills through `protoboard skills read <name>`.

First prompt, in a project:

> Read AGENTS.md and the build-a-project skill. Then run protoboard check and
> tell me what the project is and what it reports.

### Cursor

Install the extension from Cursor's Extensions view (Open VSX). Connect:
**Connect** on the Cursor row in **Protoboard: Open Settings**, or
`protoboard agents setup`. It adds the server to `~/.cursor/mcp.json`;
Cursor lists it under Settings, MCP: turn it on there if it is off. By hand:

```json
{
  "mcpServers": {
    "protoboard-stack": {
      "type": "stdio",
      "command": "/Users/you/.config/protoboard/agents/protoboard-mcp",
      "args": []
    }
  }
}
```

Reads: `AGENTS.md`, and the skills through the `skill_read` tool.

First prompt, in Cursor's agent:

> Use the protoboard-stack tools: call project_status, read AGENTS.md, then
> give me a rough draft of a smart water bottle cap that measures the water
> level and shows it on LEDs. Ask me your questions first.

### Windsurf

Install the extension from Windsurf's Extensions view (Open VSX). Connect:
**Connect** on the Windsurf row, or `protoboard agents setup`. It adds the
server to `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\mcp_config.json`
on Windows), or to `~/.codeium/windsurf/mcp_config.json` when that is the
file this machine has. Refresh the MCP servers in Cascade's settings, or
restart Windsurf. By hand, the same `mcpServers` JSON as for Cursor, without
the `type` line.

Reads: `AGENTS.md`, and the skills through the `skill_read` tool.

First prompt, in Cascade:

> Call project_status from the protoboard-stack server, then read AGENTS.md
> and tell me how to start a Protoboard project in this folder.

### GitHub Copilot agent mode

Connect: **Connect** on the VS Code (Copilot agent mode) row, or `protoboard
agents setup`. It adds the server to VS Code's own user `mcp.json`
(`~/Library/Application Support/Code/User/mcp.json` on macOS,
`%APPDATA%\Code\User\mcp.json` on Windows, `~/.config/Code/User/mcp.json` on
Linux; VS Code Insiders has its own). The server starts the next time agent
mode lists its tools. By hand, in that file:

```json
{
  "servers": {
    "protoboard-stack": {
      "type": "stdio",
      "command": "/Users/you/.config/protoboard/agents/protoboard-mcp",
      "args": []
    }
  }
}
```

Reads: `AGENTS.md`, and the skills through the `skill_read` tool.

First prompt, in Copilot Chat with the agent selected:

> Use the protoboard-stack tools. Call project_status, then project_check,
> and explain what this Protoboard project is and what the check found.

### Other MCP clients

`protoboard agents setup` also knows Claude Desktop, Gemini CLI and Cline.
For any other client that runs local (stdio) servers, `protoboard agents
config` prints the entry. It is a server named `protoboard-stack` whose
command is the launcher above, with no arguments, environment variables or
key; restart the client after adding it. In the common `mcpServers` form:

```json
{
  "mcpServers": {
    "protoboard-stack": {
      "command": "/Users/you/.config/protoboard/agents/protoboard-mcp",
      "args": []
    }
  }
}
```

In these examples, put your own home folder in place of `/Users/you`. On
Windows the command is `cmd` with the arguments `/c` and the launcher's full
path; `protoboard agents config` prints it.

Then run `protoboard agents refresh` once, so the launcher is there.

<!-- verified: the files, keys and entries per agent (packages/core/src/agents.ts: claude-code via `claude mcp add --scope user`, codex config.toml mcp_servers, cursor ~/.cursor/mcp.json with type stdio, windsurf devin/mcp_config.json or ~/.codeium/windsurf, vscode <appData>/Code/User/mcp.json servers with type stdio, claude-desktop, gemini, cline); the generic entry (otherClientConfig); real `protoboard agents config` output on Linux, 2026-10-25. -->

## Your first project

### In the editor

Open the Protoboard side bar. In a window with no folder, or an empty folder,
it offers **New Project**; in a folder that holds a Protoboard project not
set up on this machine yet (one you cloned or were sent), it offers
**Initialize**. Both are in the command palette too (**Protoboard: New
Project…**, **Protoboard: Initialize Project**). Neither needs npm.

New Project asks what to start from and where:

| Starting point | What it is |
|---|---|
| Empty | Nothing yet: you and your agent start from a blank project. |
| `iot` | A battery-powered Wi-Fi and Bluetooth device: an ESP32-C3 board on a lithium cell, with its PCB, firmware configuration and an enclosure folder. |
| `wearable` | A Bluetooth wearable: an nRF52840 board on a lithium cell, with its PCB, Zephyr board files and a case folder. |
| `drone` | A multirotor flight stack: flight controller, ESC, battery and receiver, to grow into a drone. |

When it is made, choose **Open in New Window**. The editor then asks **"Do
you trust the authors of the files in this folder?"**: choose **Yes, I trust
the authors**. The Protoboard views stay off until you do.

Protoboard then asks once more, for this project: **Run the code of
"…"?** Checking and showing a project runs its code, so choose **Trust and
Run** for a project you made or got from someone you trust. **Don't Run**
keeps it off; **Protoboard: Trust This Project's Code…** asks again later.

The viewer opens on the system as a diagram. Double-click a module to open
it; the 3D tab shows the assembled model. Click a module to see it in the
**Protoboard Inspector** on the right. The **DRC** panel at the bottom shows
what the checks find, and the project is checked again each time you save.

### From the command line

```sh
protoboard init --list
protoboard init my-project --template iot
code my-project
```

Without `--template`, `init` makes an empty project. The project uses the
Protoboard installed for your user: there is no `npm install` to run in it.
A template's parts come from the Protoboard library: signed out, `init`
makes the project and says how to fetch them later (`--no-parts` leaves
them out on purpose). In the project:

```sh
protoboard check
protoboard build
protoboard dev --open
```

`check` runs every design rule check (exit code 1 when it finds an error),
`build` writes the derived data to `.protoboard/build/`, and `dev --open`
serves the viewer in your browser and redraws it as files change. In the
editor, **Protoboard: Open Viewer** and **Protoboard: Check** do the same.

<!-- verified: init --list and its three templates (run 2026-10-25); init's --stack global default and the signed-out template parts (packages/cli/src/index.ts, docs/releases notes for this release); New Project and Initialize (packages/vscode-protoboard/DEVELOPMENT.md, "A window with no project"; "Open in New Window" in src/extension.ts). -->

> **If you are an agent doing this for someone:** use plain `protoboard
> init`, in the folder and with the starting point they chose. Never
> tell them to run npm in a project: projects use the Protoboard installed
> on the machine. Look at the project (`protoboard inspect`, `protoboard
> check`) before you describe it.

## Signing in for the library

Your projects, the viewer, checks, builds and releases work without an
account. Signing in is for the Protoboard library, all of it: searching and
browsing its parts (`parts search`, `parts taxonomy`, `libraries`), adding
them to a project (`parts add`, a template's parts at `init`), update checks
(`parts update`, `parts list --check`), offers and prices (`parts offers`,
`parts prices`), and publishing a part (`parts publish`). Signed out, those
stop before changing anything, with one line saying to sign in, and exit
code 4.

In the editor: **Sign in** in the status bar, or **Protoboard: Sign In** from
the command palette. A browser page opens; the editor continues by itself
when you are signed in. In a remote window (SSH, WSL, a container), or when
no browser opens, use **Protoboard: Sign In with a Code (Remote or
Headless)** and approve the code on any device.

In a terminal:

```sh
protoboard login
protoboard whoami --check
```

`protoboard login --device` prints a code to approve on another device, for
a machine with no browser. `protoboard logout` signs out. The sign-in is kept
in your system's keychain, else in a file only you can read, and never in a
project. In CI, set `PROTOBOARD_CLOUD_TOKEN` to a service token instead.

To manage the account (its profile, where it is signed in, sign out
everywhere, delete it): `protoboard account` prints its page and opens it,
and **Manage Account** in Protoboard Settings or the Cloud view opens it from
the editor.

<!-- verified: the commands that need an account and exit code 4 (the CLI's help, "Sign-in"; ACCESS_EXIT_CODE in packages/core/src/access.ts); login, --device, whoami --check, logout, account (packages/core/src/account-login.ts accountPage); the credential store (packages/core/src/account.ts). -->

> **If you are an agent doing this for someone:** you cannot sign in for
> them and must not work around it. Ask whether they want the library now;
> if they do, ask them to sign in and to tell you when the status bar shows
> their account. Everything else goes on without it.

## Updating

- **The extension** updates itself from the Marketplace or Open VSX, as
  every extension does. It unpacks the new version once and the
  `protoboard` command it gives follows it.
- **The command line from npm:** `npm i -g @protoboardai/cli` again.
- **A project** keeps working on the version it was set up with. When the
  extension carries a newer stack, **Protoboard: Update Project to the Stack
  This Extension Carries** moves the project to it (in a terminal,
  `protoboard stack link --force`).
- **Agents** keep working: the launcher finds the newest Protoboard each
  time. `protoboard agents` says "update needed" for an entry that should
  be written again; `protoboard agents setup` does it.

### A project from the first beta releases

A project made with the beta releases, before Protoboard was public, is
brought up to date with one command in the project:

```sh
protoboard upgrade
```

In the editor, opening such a project offers **Update Project to
Protoboard** with the version the extension carries (**Initialize** offers it
too): it does the same.

It says what it changed. Commit or copy the project first, so you can see
the changes.

<!-- verified: `protoboard upgrade` is in packages/cli/src/index.ts (upgradeCommand) and core's packages/core/src/upgrade.ts; run on a copy of a 0.1.7 project it rewrote the ranges and pins, linked the packages, refreshed AGENTS.md and CLAUDE.md and migrated the parts, and `protoboard check` then passed. -->

## Uninstalling

Nothing below touches your projects.

1. Disconnect your agents: `protoboard agents remove` (it asks about each),
   or **Disconnect** on each row of **Protoboard: Open Settings**.
2. Sign out: `protoboard logout`.
3. Uninstall the extension from the Extensions view, or with `code
   --uninstall-extension deltarobotics.vscode-protoboard` (`cursor`,
   `windsurf` for those editors).
4. If you installed the command line with npm: `npm uninstall -g
   @protoboardai/cli`.
5. Take the command off your `PATH`: delete the line marked
   `protoboard-path` from your shell's start file (macOS, Linux), or remove
   `%USERPROFILE%\.protoboard\bin` from your user `Path` (Windows: Settings,
   System, About, Advanced system settings, Environment Variables).
6. Delete Protoboard's folders: `~/.protoboard` (the stack copies and the
   command) and `~/.config/protoboard` (the agents' launcher, and the
   sign-in when it is kept in a file); on
   Windows `%USERPROFILE%\.protoboard` and `%APPDATA%\protoboard`.

## Troubleshooting

Start with the two commands that say how this machine is set up:

```sh
protoboard doctor
protoboard agents
```

`doctor` prints, in order: the version and the **Build** (a release, or a
development build with its commit); the **Account** for the library;
**Packages** (which CLI runs, which Node.js, the stack copies in
`~/.protoboard/stack` and the extensions that carry them); and, in a
project, its **Extensions**, the **Tools** they need (each with ✓ or ✗ and
how to install what is missing), the **Runtimes** in `.protoboard/tools`,
the **Skills**, and whether `AGENTS.md` and `CLAUDE.md` are current.
`protoboard doctor --format json` gives the same as data. `protoboard
agents` lists each agent found and whether it is connected.

**Where the logs are.** In the editor, **Protoboard: Show Log** opens the
Protoboard output channel: which CLI and Node.js run and why, each check,
the dev server and every library call. The command line prints to the
terminal; add `--format json` for the details. An agent's MCP server logs
to the agent: in Claude Code, `/mcp` shows whether protoboard-stack
started.

**Exit codes.** 0 is success, 1 is findings (a check with errors), 2 a
command that failed, 4 a library command that needs a sign-in.

| You see | Do this |
|---|---|
| `protoboard: command not found` (in PowerShell: "protoboard is not recognized") | Open a new terminal: one opened before the install does not have it. Inside the editor the setting `protoboard.terminal.addCommand` must be on. For other terminals, run **Protoboard: Add the protoboard Command to PATH**, then open a new terminal; meanwhile the full path works (`~/.protoboard/bin/protoboard`, `%USERPROFILE%\.protoboard\bin\protoboard.cmd`). |
| `code: command not found` | See the `code` command in your system's install section above. |
| The editor refuses to install the extension because it is too old | Update the editor. The extension needs one built on VS Code 1.106 or later. |
| "The Protoboard extension carries its stack for … not for …" | Your system is not one the extension carries Protoboard for (Alpine Linux, for example): install the command line with npm. |
| The Protoboard views are empty or missing | The folder is not trusted yet: run **Workspaces: Manage Workspace Trust** and press **Trust**. **Protoboard: Show Log** says what the extension did. |
| "Protoboard does not run …'s code, so it is not checked or shown" | You chose **Don't Run** when Protoboard asked about the project: run **Protoboard: Trust This Project's Code…** and choose **Trust and Run**. |
| The project "needs its packages", or the views say it is not set up | Press **Initialize** in the Protoboard side bar. Do not run `npm install` in the project unless it was made with `--stack project`. |
| The agent does not list Protoboard's tools | `protoboard agents` shows whether it is connected; connect it, then start a new session or restart the agent (some agents also ask you to turn a new server on). In a client set up by hand, run `protoboard agents refresh` so the launcher exists. |
| `protoboard-mcp: Node.js 22 or later was not found` | The launcher found no Node.js and no editor runtime. Open the editor with the extension once (it records its runtime), or install Node.js 22 or later, then run `protoboard agents setup` again. |
| `… needs a Protoboard account: sign in with protoboard login` (exit code 4), or the Library shows a sign-in card | Only the library needs an account. Sign in: **Protoboard: Sign In**, or `protoboard login`. |
| You signed in, and the editor still says "Sign in" | Run **Protoboard: Check the Account Again**. Still the same: `protoboard whoami --check` says what the service answers; then **Developer: Reload Window**. |
| "The Protoboard library could not be reached" | You are offline, or the service is slow to wake: connect, then **Check Again**. Your project works offline. |
| The wrong account | **Protoboard: Sign Out**, then **Protoboard: Sign In**; or `protoboard logout`, then `protoboard login`. |
| A CAD step is refused or skipped | The 3D generators need the CAD runtime, once per project: **Protoboard: Install a Tool Runtime (CAD, Circuit)…**, or `protoboard tools install cad`. Boards need `protoboard tools install circuit`, which needs Node.js with npm. |
| `tools install cad` says "no Python that can create this runtime was found" | It tried every Python on the machine and lists them. It prints what to run (on macOS `brew install uv && uv python install 3.12`); `--python <path>` names one, `--clean` removes what a failed attempt left. On Windows, install Python from python.org and open a new terminal. |
| Documents fail with `required tools unavailable: chrome` | Install Google Chrome, Chromium, Microsoft Edge or Brave, or set `CHROME` to its executable, then open a new terminal and restart the editor. If it also names `poppler`: `brew install poppler` (macOS) or `sudo apt install poppler-utils` (Debian, Ubuntu). |
| Something in Protoboard looks wrong | Open an issue on the repository with the command, what it printed, and the output of `protoboard doctor`. |

<!-- verified: doctor's sections (packages/cli/src/index.ts, case "doctor"); the exit codes (packages/core/src/access.ts, ACCESS_EXIT_CODE and its comment); the launcher's Node.js message (packages/core/src/agent-launcher.ts); the command titles (packages/vscode-protoboard/package.json, contributes.commands). -->

> **If you are an agent doing this for someone:** when something fails, run
> `protoboard doctor` and `protoboard agents`, read what they say, and tell
> the person in plain words what is missing and what fixing it changes,
> before you fix it.
