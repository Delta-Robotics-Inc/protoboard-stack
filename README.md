# Protoboard Stack

Protoboard is a framework for agents and people to design, check and release
hardware projects. A project describes its system in
[UHD](https://github.com/Delta-Robotics-Inc/uhd) (Universal Hardware
Description: modules, interfaces, links and harnesses, as TypeScript), and
Protoboard supplies the rest: project conventions, a parts library, checks,
a viewer, extensions that drive engineering tools (tscircuit and KiCad for
boards, build123d for CAD, Zephyr and ESP-IDF for firmware), skills that
teach an agent the workflow, and a release that ends in a Manufacturing
Package.

Think of it as "Next.js for hardware": initialize a project, add
capabilities as packages, work in VS Code with your agent, view the system
live, and cut a versioned hardware release. Any agent that speaks MCP or
reads `AGENTS.md` can use it; the stack does not run the agent.

This repository holds the stack: the framework core, the `protoboard` CLI,
the extensions, the viewer shells, the VS Code extension, the parts service
client, and the reference projects. It is open source under the [Apache
License 2.0](LICENSE).

## Install

Install the **Protoboard** extension in VS Code (Visual Studio Marketplace),
or in Cursor or Windsurf (Open VSX). It carries the whole stack and gives
your terminals the `protoboard` command, with no Node.js or npm needed. Or
install the command line alone (Node.js 22 or later):

```sh
npm i -g @protoboardai/cli
protoboard agents setup        # connect Claude Code, Codex, Cursor, … to the stack's MCP server
```

**[The installation guide](docs/guides/installation.md)** covers macOS,
Windows and Linux, each supported agent, your first project, signing in for
the Protoboard parts library (the only part that needs an account),
updating, uninstalling and troubleshooting.

## Quick start

```sh
protoboard init my-drone --template drone     # or wearable, iot; or a blank project
cd my-drone
protoboard check                              # every validator that can run; exit 1 on errors
protoboard dev --open                         # the viewer at http://127.0.0.1:5180/, live
protoboard release --check                    # what stands between the design and a release
```

Then open the folder in VS Code, or ask your agent to start from the
**build-a-project** skill. A project made with Protoboard 0.1 is moved to
0.2 with `protoboard upgrade` ([release notes](docs/releases/stack-v0.2.md)).

## Documentation

- [Quickstart](docs/quickstart.md): a project from a template to a release, step by step.
- [Reference](docs/reference/README.md): the [CLI](docs/reference/cli.md),
  [configuration](docs/reference/configuration.md),
  [extensions and skills](docs/reference/extensions.md), the
  [Manufacturing Package format](docs/reference/manufacturing-package.md) and
  the [library protocol](docs/reference/library-protocol.md).
- Guides: [writing a capability provider](docs/guides/writing-a-capability-provider.md),
  [the SOP format](docs/guides/sop-format.md) every skill follows,
  [evals](docs/guides/evals.md), [a local registry](docs/guides/local-registry.md).
- Design: [architecture](docs/specs/architecture.md),
  [project structure](docs/specs/protoboard-project-structure.md),
  [UHD boundary](docs/specs/uhd-boundary.md),
  [tool integrations](docs/specs/tool-integrations.md),
  [distribution](docs/specs/distribution.md) and the rest of [docs/specs](docs/specs/).
- [Release notes](docs/releases/stack-v0.2.md).

## Repository layout

| Path | What |
| --- | --- |
| `packages/core` | `@protoboardai/core`: project loading, the definition registry, resolution, checks, build, templates, parts and libraries. |
| `packages/cli` | `@protoboardai/cli`: the `protoboard` command and its MCP server. |
| `packages/cloud` | `@protoboardai/cloud`: the typed client of the parts service and of any `uhd-library/v1` library. |
| `packages/views`, `packages/web-viewer` | The domain views and the shells of `protoboard dev` and the VS Code tabs. |
| `packages/ext-*` | The extensions: hardware, parts, sourcing, docs, release, drone, tscircuit, zephyr, esp-idf, frame-cad, harness-cad, enclosure-cad. |
| `packages/vscode-protoboard` | The VS Code extension ([developer reference](packages/vscode-protoboard/DEVELOPMENT.md)). |
| `examples/` | Reference projects: a 5-inch quadcopter, a wearable watch, a smart water bottle and a motor test bench. |
| `docs/` | The documentation above. |
| `scripts/` | CI, the lints, the local registry and publishing. |

## Developing

The stack builds against two repositories checked out beside it, UHD and the
viewer:

```sh
git clone https://github.com/Delta-Robotics-Inc/uhd.git
git clone https://github.com/Delta-Robotics-Inc/uhd-viewer.git
git clone https://github.com/Delta-Robotics-Inc/protoboard-stack.git
(cd uhd && npm install && npm run build)
(cd uhd-viewer && npm install && npm run build)
cd protoboard-stack && npm install
npm run typecheck && npm test
scripts/ci-stack.sh                 # the whole CI flow, as GitHub Actions runs it
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the commands, the pull request
process and the sign-off; [docs/ci.md](docs/ci.md) the workflows.

## Licence and trademarks

The code is Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)); contributions
come in under the same licence with a DCO sign-off. "Protoboard" and its logo
are trademarks of Delta Robotics, Inc.; a fork you distribute needs its own
name ([TRADEMARKS.md](TRADEMARKS.md)).
