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
| [Render service](render-service.md) | `protoboard views capture`, `views doctor`, `views service`: one warm headless browser per project, captures with overlays and manifests, the transfer limits (`transfer-limits.json`), and the snapshot a visible viewer opens from | Written against `packages/core/src/render-service/`; `packages/core/test/render-service.test.ts` keeps the limits file equal to the built-in copy |
| [Agent view tools (MCP)](view-tools.md) | `view_observe`, `view_select`, `view_highlight`, `view_isolate`, `view_camera`, `view_callout`, `view_mark`, `view_arrow`, `view_explode`, `view_capture`, `view_undo`, `view_claim`, `view_release`: the route (live tab or headless), refusals, leases, undo per actor, turn-taking, the op log on disk | Written against `packages/cli/src/mcp/view-tools.ts`, `scene.ts` and uhd-viewer `src/cad/state/`; `packages/cli/test/view-tools.test.ts`, uhd-viewer `test/collab.test.ts` |
| [3D view state and live-tab bridge](viewer-bridge.md) | The view-state schema (`uhd-viewer.view-state/v1`), the op log and its version preconditions, `.protoboard/local/viewer-state.json`, and the loopback channel from `protoboard dev` to the open viewer tab | Written against uhd-viewer `src/cad/state/` and `packages/cli/src/dev/bridge.ts`; `packages/cli/test/dev-bridge.test.ts` |
| [Manufacturing Package](manufacturing-package.md) | `release/<version>/`: layout, `manifest.json` (`protoboard.release/v0`), reproducibility | `scripts/compare-release.mjs` against the committed release records |
| [Library protocol](library-protocol.md) | Pointer to UHD's `uhd-library/v1`, and how the CLI uses it | UHD's own protocol tests |
| [Local telemetry](telemetry.md) | The viewer's crash and performance records in `.protoboard/local/telemetry/` (recorded on your machine only, never sent): fields, retention, how to turn them off, `protoboard telemetry`, and the consent-to-send bundle and request shape | Written against `packages/core/src/telemetry.ts`; `packages/core/test/telemetry.test.ts` covers the writer, the redaction and the switches |

Guides:

- [Writing a capability provider](../guides/writing-a-capability-provider.md): a `circuit`, `cad` or `firmware` provider, its standard outputs, the contract test, tool runtimes.
- [The SOP format](../guides/sop-format.md): how every skill is written.
- [Evals](../guides/evals.md): eval cases, hosts, graders and scorecards.
- [CI](../ci.md): the four repositories, `scripts/ci-stack.sh`, the read token.
- [VS Code extension](../../packages/vscode-protoboard/DEVELOPMENT.md) and [ext-release](../../packages/ext-release/README.md) READMEs.

Design documents (the why) are in [`docs/specs/`](../specs/).
