# protoboard

The command line for [Protoboard](https://protoboard.ai): design hardware
with your AI agent.

A Protoboard project describes a device as code: its modules, the
interfaces between them, and the cables that connect them. `protoboard`
creates projects, checks them, builds them, and turns them into a
manufacturing package.

## Install

```sh
npm install -g @protoboardai/cli
```

Needs Node.js 22 or later. The
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=deltarobotics.vscode-protoboard)
brings this command with it, so you only need npm if you work without the
extension.

Run `protoboard`, not `npx protoboard`: the `protoboard` package on npm is
an unrelated project.

## Quick start

```sh
protoboard init my-project                  # --template drone|wearable|iot after `protoboard login`
cd my-project
protoboard check                            # run every design check
protoboard dev                              # serve the live diagram and 3D view
```

Connect your agent (Claude Code, Codex, Cursor, Windsurf, GitHub Copilot or
any MCP client) with `protoboard agents setup`, then ask it what to build.

## Common commands

| Command | What it does |
| --- | --- |
| `protoboard init <dir>` | Create a project, from a template or empty |
| `protoboard check` | Run the design checks |
| `protoboard build` | Check and build the project's outputs, including the project index |
| `protoboard index census` | List every asset file (CAD, models, renders, photos, documents) and what links it |
| `protoboard index where <ref>` | Show where a module, part or file is, and what is one step from it |
| `protoboard index search <text>` | Search the project index: names, paths, kinds and the text of documents |
| `protoboard dev` | Serve the live diagram and 3D view |
| `protoboard parts search <query>` | Search the parts library (needs an account) |
| `protoboard release` | Make the manufacturing package |
| `protoboard upgrade` | Move a project to this version of Protoboard |
| `protoboard agents setup` | Connect your agents to Protoboard (MCP) |
| `protoboard doctor` | Show what is installed and what is missing |
| `protoboard map` | Show what the Protoboard stack can do: its extensions, skills, operations, commands and tools by discipline, with versions |
| `protoboard login` | Sign in to the parts library |

The `index` commands read only the index that `protoboard build` writes, and
run none of the project's code. When the project's files have changed since
the last build they refuse with exit code 3 and say which files changed: run
`protoboard build` again.

`protoboard map` needs no project and writes nothing unless `--out <file>`
names a file. `--island <id>`, `--type <type>` and `--item <id>` (one item
with all its links) answer one question; `--format json` gives the whole map.

`protoboard --help` lists everything.

## Learn more

- [protoboard.ai](https://protoboard.ai)
- [Source code](https://github.com/Delta-Robotics-Inc/protoboard-stack)
- [Installation guide](https://github.com/Delta-Robotics-Inc/protoboard-stack/blob/main/docs/guides/installation.md),
  by operating system and agent
- [Report an issue](https://github.com/Delta-Robotics-Inc/protoboard-stack/issues)

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc.
