# Protoboard project structure

Status: proposed conventions for the first quadcopter project. Package names and
schemas are provisional; this is a target layout, not a shipped scaffold.

```text
quadcopter/
  package.json                    # framework and extension dependencies
  package-lock.json               # npm dependency pins
  protoboard.config.ts             # entrypoint and configured extensions
  AGENTS.md                       # portable guidance and skill discovery (skills by name, never by path)
  CLAUDE.md                       # `@AGENTS.md` only: Claude Code reads CLAUDE.md, not AGENTS.md
  src/
    quadcopter.uhd.ts              # root system and instance composition
    modules/
      frame/frame.uhd.ts          # custom module, requirements, artifact links
      frame/cad.config.ts        # which `cad` provider designs the frame, and its settings
      frame/frame-cad/           # the provider's native design (source of truth)
      frame/out/                 # standard outputs: body.step/.glb/.manifest.json (artifacts cad_*)
    harnesses/                   # reusable connection definitions, if needed
  parts/
    catalog/                     # committed downloaded UHD definitions (<id>.json)
      <short>/                   # the files vendored with each revision (artifact base), and its
                                 # source: <id>.uhd.ts plus the library modules it imports.
                                 # <short> is the id cut to 24 characters (with a hash when cut), and
                                 # the library's folders down to the part's own are left out of the
                                 # paths (origins.json `artifactBase.strip`); see "Vendored paths" below
    local/                       # purchased parts researched in this project (<id>.uhd.ts)
    origins.json                 # revisions, digests, dependencies, derivations
    evidence/                    # retained datasheets and extracted source facts
  firmware/                      # source/configuration, tool-specific metadata
  docs/
    brief.md                     # requirements and acceptance targets
    product.json                 # what the product is (protoboard.product/v0): summary, features, functions,
                                 # requirements with how each is shown; the documents' first page reads it
    decisions.md                 # engineering decisions and cited evidence
    assembly.md                  # assembly and wiring instructions
  testing/                       # test plans and measured results by revision/unit
  operations/                    # portable operation records and output references
  release/<version>/             # the Manufacturing Package (`protoboard release`): rebuilt from the
                                 # committed project, not committed itself (`releases/` is read too)
  .protoboard/
    display.json                 # viewer display hints and the saved diagram layout; commit
    build/                       # derived build output (resolved.json, uhd-bundle.json); ignore
    tools/                       # tool runtimes from `protoboard tools install` and tools.json; ignore
    cache/                       # derived data; ignore
    local/                       # machine configuration and transient state; ignore
```

Folders are conventions, not domain restrictions. Artifacts may use different
native directory layouts and may refer to remote engineering documents. Resolve
paths relative to their declaring source and retain provenance. Generated exports
are rebuildable working outputs until selected into a frozen release.

## Parts identity and provenance

Keep catalog definitions immutable at their downloaded revision. An origin record
maps local definitions to service URL, catalog identity, immutable revision, UHD
schema version, content digest, retrieval time, and any resolved dependencies.
Record source documents and extraction/review evidence separately from stable
part identity. Capture price and availability with their observation date; those
values are not immutable engineering specifications.

A locally defined purchased part needs manufacturer/part identity and supporting
evidence, but no cloud account. A custom frame is also a normal UHD module.
When deriving a local variant of a catalog definition, give it an explicit local
identity and a derived-from origin rather than altering the cached original.
Per-instance overrides continue to use UHD's own semantics.

The parts origin record is a data provenance manifest, not a package manager.
npm's lockfile continues to own framework, extension, and npm library versions.
Downloaded definition closures must be available locally for offline checks;
optional remote artifacts may remain links, with availability reported honestly.

## Project context and company context

Skills ship through installed extension packages and are exposed through host
adapters or discoverable files. Project-owned instructions and engineering
records survive extension updates. Updates must not overwrite user decisions.

A company workspace can contain `projects/quadcopter`, other projects, shared
parts packages, company skills, and shared memory. Each project retains a clear
root and can be packaged independently. A company's own context lives in that
workspace, not in the reusable framework's defaults.

### A stack project nested in a workspace

A company hub may keep one folder per engagement, and the stack project in it:
`projects/<group>/<yyyy-mm-dd-slug>/protoboard/`, with the engagement record
(client, quotes, worklog, the revision ledger) one level up. The stack
supports this as an ordinary case:

- **Precedence.** The project's AGENTS.md (written by `init`, the shared text
  in `packages/core/templates/_agents/common.md`) says: the person's
  instruction first; the stack's guidance governs the hardware work in the
  folder (model, parts, checks, providers, outputs, the engineering brief and
  decisions, releases); the workspace's governs the process around it (git,
  confidentiality, client communication, orders, sign-offs, the delivery
  record). Each wins in its own domain.
- **Claude Code** loads every CLAUDE.md from the working folder up, and no
  AGENTS.md by itself. `init` writes `CLAUDE.md` containing only
  `@AGENTS.md`; a folder that already holds a CLAUDE.md (the workspace made
  it, with its own pointer to the engagement files) is accepted by `init` and
  the file is kept; `doctor` says when one does not import AGENTS.md.
- **Never the repository root.** Commands run in the project folder and write
  only inside it; its `.gitignore` is the project's own (git applies it from
  that folder down); a release's git state is read for the project folder
  within whatever repository holds it (`git status -- .`, paths made relative
  to the project); every path recorded in a project file is relative to the
  project, with forward slashes.
- **Paths.** A nested project's prefix (`projects/contracts/2026-10-15-` plus
  a slug of up to 28 characters plus `/protoboard/`, about 70 characters) is
  added to every vendored path. The vendored layout keeps every file of the
  dev catalog's parts under 200 characters with that prefix (a test checks
  it), leaving room under Windows' 260 for the workspace's own location.

### Vendored paths

Stack 0.1.6 put a revision's files under `parts/catalog/<id>/` exactly as the
library names them (`library/parts/<id>/artifacts/cad/<id>.step`), so the
part id appeared three times in one path; one client project had a
268-character path. Now:

- the folder is `vendoredDirName(id)`: the id when it has 24 characters or
  fewer, else its first characters and four hex digits of its hash;
- the library's folders down to and including the part's own folder are left
  out (`artifacts/cad/<id>.step`); origins.json records the prefix as
  `artifactBase.strip`, and the file keys, evidence and missing-artifact
  paths are the stored paths;
- the definition is never changed (its bytes are the pin): loading gives its
  artifacts the stored paths, and a board's staleness fingerprint is taken
  over the definition as pinned, so moving files never makes a board stale;
- a record without `strip` is the earlier layout and loads as it did; `check`
  says so (`PB_CATALOG_LAYOUT_EARLIER`, info), `doctor` too, and
  `protoboard parts migrate` moves the files (offline, digests unchanged).
  `parts add` and `parts update --to` write the new layout for what they
  vendor.

Every path the stack writes into a project file (origins.json, operation
records, the build) uses forward slashes; records written on Windows by
0.1.6 with backslashes are read as forward slashes, and the next write
rewrites them.

## Design, release, and physical unit

The UHD model describes design intent. A release identifies a particular set of
design inputs and handoff outputs. Operations and tests reference that release
and, when applicable, a physical unit or batch. Measured results do not silently
rewrite design specifications. Feed findings into a new design revision.

Small structured data and definitions belong in Git. Large native artifacts may
use Git LFS or addressed storage; release manifests must identify their exact
bytes. Credentials and machine-local configuration never belong in a portable
release.

## CAD geometry bindings

Prototype explicit mappings from UHD instance/interface/harness references to
versioned CAD entities. Keep these alongside the relevant artifact and include
them in releases. Preserve coordinate frames, units, and instance transforms;
report bindings invalidated by CAD edits. See
[CAD/UHD integration](cad-uhd-integration.md) for the proposed boundary and
recursive-interface display behavior.
