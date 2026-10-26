# Reference

The Protoboard Stack v0.1 reference set. New here: start with the
[quickstart](../quickstart.md). What is in this release and what is not yet:
[release notes](../releases/stack-v0.1.md).

| Reference | What it covers | Kept accurate by |
| --- | --- | --- |
| [CLI](cli.md) | Every `protoboard` command and option | Generated from `protoboard --help` (`node scripts/reference-docs.mjs`); `packages/cli/test/reference-docs.test.ts` fails when it is out of date |
| [Configuration](configuration.md) | Project layout, `protoboard.config.ts`, `release`, `libraries`, module capability configs, environment variables, which files to commit | Written against `packages/core/src/types.ts`; the reference test checks every command it names |
| [Extensions and skills](extensions.md) | The 12 first-party extensions: capabilities, operations, checks, tools and runtimes, skills, eval cases | Generated from the `protoboard-extension.json` manifests, as the CLI reference |
| [Diagnostic codes](../../packages/ext-hardware/skills/system-compose/references/diagnostic-codes.md) | Every code `protoboard check` reports, what it means and what to do; pointers to the `FW_*` and `REL_*` tables | `packages/cli/test/skills-sop.test.ts` fails on a code the stack emits that it does not list |
| [display.json](display.md) | `.protoboard/display.json`: the diagram's layout, and the 3D view's root, placements (row-major 4×4, millimetres), labels, appearance and camera | Written against the viewer's `DisplayConfig` and UHD's `assemble`; every project's AGENTS.md carries the short form |
| [Manufacturing Package](manufacturing-package.md) | `release/<version>/`: layout, `manifest.json` (`protoboard.release/v0`), reproducibility | `scripts/compare-release.mjs` against the committed release records |
| [Library protocol](library-protocol.md) | Pointer to UHD's `uhd-library/v1`, and how the CLI uses it | UHD's own protocol tests |

Guides:

- [Writing a capability provider](../guides/writing-a-capability-provider.md): a `circuit`, `cad` or `firmware` provider, its standard outputs, the contract test, tool runtimes.
- [The SOP format](../guides/sop-format.md): how every skill is written.
- [Evals](../guides/evals.md): eval cases, hosts, graders and scorecards.
- [CI](../ci.md): the four repositories, `scripts/ci-stack.sh`, the read token.
- [VS Code extension](../../packages/vscode-protoboard/README.md) and [ext-release](../../packages/ext-release/README.md) READMEs.

Design documents (the why) are in [`docs/specs/`](../specs/).
