# Protoboard framework and CLI v0

Status: proposed implementation contracts for the architecture in
[architecture.md](architecture.md). These commands and APIs are not shipped yet.

## Packages and scope

Use a small workspace with conceptual packages for framework core, CLI, and
reusable extensions. Final published npm names must be checked before release.
UHD core and UHD viewer have independent ownership and public contracts.
A separate dev-server package is only needed if implementation size warrants it.

Core owns project services, not an agent event loop. It exposes structured APIs
for loading, resolving, inspecting, checking, invoking operations, and packaging.
The CLI is a thin client; the external agent determines the engineering workflow.

## Project loading

`protoboard.config.ts` declares the UHD entrypoint, installed extensions, and
project options. All relative paths resolve from the project root or the source
that declares an artifact, with that base recorded. Start with one root module
per project; company monorepos can hold multiple independently loadable projects.

Accept TypeScript exports of UHD data and imported JSON definitions. Use the
pinned UHD schema and validation APIs. Define a registry mapping imported
module definitions to child references, detect ambiguous or duplicate IDs, and
preserve stable instance paths (four motor instances may share one definition).
Do not invent a second editable hardware schema or require React for authoring.

Source evaluation may execute user code; it runs inside the caller's environment.
After evaluation and dependency materialization, normalization and model checks
must be deterministic for the same inputs and versions. Check/build never
silently fetch a newer catalog revision or start hardware operations.

## Resolved project contract

A serializable resolved project includes schema/tool versions, roots, definition
identities, instance paths, harness endpoints, artifact locations, source/origin
references, and diagnostics. It is derived data. It is not the whole project,
a manufacturing release, or a required input format for independent UHD viewers.

Diagnostics include stable code, severity, entity reference, message, source
location when known, and producing validator. Keep UHD diagnostics intact and
add project or extension findings. Report missing evidence and unsupported checks
as unknown/skipped rather than claiming successful validation.

Required initial findings cover unresolved references, duplicate identities,
containment cycles, invalid harness endpoints, UHD compatibility results,
missing required local artifacts, and pinned-content integrity failures.

## Proposed commands

| Command | Purpose |
| --- | --- |
| `protoboard init <directory>` | Scaffold a portable project with core agent guidance. |
| `protoboard doctor` | Report configured extensions and available tools, credentials, and connections without revealing secrets. |
| `protoboard inspect [instance] --format json` | Return system, artifact, provenance, and diagnostic context. |
| `protoboard artifacts [instance] --format json` | List the artifacts of the parts in use with the instances using them and their resolved files, for editors (implemented). |
| `protoboard check` | Resolve and run available checks; nonzero exit for errors. |
| `protoboard dev` | Serve UHD locally, watch sources, and expose artifact navigation for browser/editor use. |
| `protoboard build` | Emit resolved project data; does not fabricate or operate devices. |
| `protoboard parts search <query>` | Query the configured UHD cloud catalog; support structured filters and JSON results. |
| `protoboard parts add <id>[@<revision>]` | Download a fixed definition closure and its files and record origin/integrity (implemented; see the README). |
| `protoboard parts update [id] [--to <revision>]` | Report the recommended revision; re-pin only with `--to`. |
| `protoboard parts publish <parts/local file>` | Promote a project-researched part to the catalog as its next revision. |
| `protoboard run <operation>` | Invoke a configured extension operation with declared inputs and structured results. |
| `protoboard release <revision>` | Freeze a manifest of selected design inputs, outputs, versions, and evidence. |

Command spelling is provisional. Implement machine-readable output and stable
exit behavior alongside human output. Interactive features cannot be required
for normal headless use. Login is added when the catalog's access model needs it;
deploy and quote follow release packaging, outside the initial local slice.

## Extensions and operations

Start with a versioned extension manifest: identity, compatible framework/UHD
versions, skill entrypoints, optional tool requirements, and optional operation
and check declarations. Validate the manifest and reject incompatible versions
with actionable diagnostics. Use installed npm packages and normal imports.

An operation declares input/output schemas and required capabilities. Record
operation identity, input entity/revision/digests, parameters, tool version,
status, output artifacts, and evidence. Keep runtime/device configuration and
credentials separate. Pure checks and exports must be distinguishable from
operations with physical or external effects. The invoking environment supplies
execution authorization; the stack must not silently repeat a physical job after
an ambiguous failure.

Initial skill exposure should work in VS Code through one supported agent host
and also be discoverable from plain project files/CLI. Keep the host adapter
replaceable; test portability with another environment before the first release.

## Viewer integration

Implementation depends on settling the viewer's diagrams and design
decisions. The following describes target capabilities, not a settled
interaction design. [CAD/UHD integration](cad-uhd-integration.md) adds a prototype
track for module/interface geometry and a later spatial view of harnesses.


The UHD viewer accepts UHD through its own neutral contract. Protoboard supplies
a projection plus callbacks for source and artifact resolution. Its local dev
session supports hierarchy navigation, selection, interface/harness inspection,
diagnostics, artifact opening, and refresh after source changes.

Save deliberate node layout separately using instance paths; do not modify UHD
topology when moving a node. Begin with a local viewer usable inside VS Code's
browser surface. A custom webview extension follows only if embedding or native
artifact opening requires it. Native tools open their own artifacts.

Implemented: `packages/vscode-protoboard` frames the `protoboard dev`
page in a webview panel (attaching to a running session through
`.protoboard/local/dev.json`), maps `check --format json` to the Problems
panel, and opens artifacts with the system's application or the editor.

## Releases

`build` produces derived system data. `release` captures an identified hardware
revision including source revision/content, pinned parts, required artifact
hashes, tool versions, BOM, assembly instructions, and available test evidence.
Remote URLs alone do not make a manufacturing release reproducible: materialize
required bytes or identify unresolved handoff dependencies explicitly.

Release creation is separate from ordering, deploying, or operating machines.
Later quote requests reference the release digest plus quantities and process
requirements. Results attach to the same release without mutating its frozen
inputs.
