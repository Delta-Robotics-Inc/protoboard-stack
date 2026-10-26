# Manufacturing Package format (`protoboard.release/v0`)

The folder `protoboard release` writes: everything needed to order, make,
assemble and check one version of a product. This page is the format; how
each document is built (BOMs, ordering quantities, offers, work order, test
plan) is in the [ext-release README](../../packages/ext-release/README.md),
and the design in [releases, package, SOPs and evals](../specs/release-package-and-evals.md).
The examples are the three reference projects' 0.1.0 packages.

## Layout

```text
release/<version>/
  00-overview.pdf          the cover with the totals, the product page (what it is, features, functions, requirements with
                           how each is shown, from docs/product.json), units, order of work, index of files, traceability appendix
  index.html               all of it, navigable by unit and section
  manifest.json            protoboard.release/v0 (below)
  assets/                  index.html's figures (images/) and fonts (fonts/)
  system/                  the root unit: final assembly
    spec-sheet.pdf  bom.pdf  bom.csv  ordering-list.csv  work-order.pdf  assembly-guide.pdf  test-plan.pdf
    files/model/uhd-bundle.json        the released UHD model (artifact bases relative to the project)
    files/firmware/…                   configurations contributed by extensions (ext-drone: betaflight-cli.txt)
    files/harnesses/<module>/          routed <module>.step and .glb, cut-list.csv
    files/mechanical/<module>/         <module>.step and the process exports (.stl, .3mf, .dxf)
    files/test/test-record.csv         one row per check in the test plan
  units/<unit>/            one per `release.units` entry; the same layout, no ordering list
    files/boards/<module>/             gerber/ (layers, drill), bom.csv, pnp.csv, board.step, board.glb
    files/firmware/<module>/           the firmware provider's out/config/ (Zephyr board, ESP-IDF header and sdkconfig)
```

| Project | Units | Documents | Files |
| --- | --- | --- | --- |
| quadcopter-5in | `system`, `units/stack` | 11 (67 pages) | 121 |
| wearable-watch | `system`, `units/board` | 11 (48 pages) | 108 |
| smart-bottle | `system`, `units/board`, `units/cap` | 16 (48 pages) | 99 |

Manufacturing files come only from the providers' standard outputs
(`<module>/out/`), renamed into the unit that builds the module; never from
native design files. A unit folder's name is its instance path with `/` as
`.`.

## `manifest.json`

One JSON object, keys sorted, no clock time and no machine path.

| Key | Content |
| --- | --- |
| `schema` | `"protoboard.release/v0"` |
| `version`, `build` | The release version and the number of products the quantities are for. |
| `date` | `SOURCE_DATE_EPOCH`, else the source commit's date (ISO 8601, UTC). |
| `project` | `{ name, root }`: the project and its root module id. |
| `source` | `{ commit, dirty }`: the git commit, and the uncommitted paths `--allow-dirty` released (otherwise `[]`). |
| `framework` | `{ protoboard, uhd: { version, revision } }`. |
| `extensions` | `[{ id, version }]`: every extension loaded. |
| `tools` | `[{ id, detail }]`: the tools the release ran (`chrome`, with its version). |
| `fonts` | `[{ file, digest }]`: the fonts the PDFs were printed with. Other fonts give other bytes. |
| `check` | `{ errors, warnings, info, findings, validators }`: the check the release passed, its findings (`code`, `severity`, `message`, `validator`) and every validator's status. |
| `model` | `{ bundle, digest }`: the packaged UHD bundle. |
| `units` | `[{ id, entry, name, definition, kind, folder, instances, parents, perProduct }]`: `kind` is `root`, `instance` or `module`. |
| `parts` | `[{ id, kind, tier, source, digest, instances, … }]`: every definition used; catalog parts add `provider`, `service`, `revision`, `envelopeDigest`. |
| `outputs` | `[{ capability, module, provider, config, configDigest, moduleDigest, projectDigest, record, tools, files, packaged }]`: each module's standard outputs, the export record that wrote them (`record`, a path in `operations/`) and where they went in the package. |
| `generated` | `[{ extension, operation, record, path, digest, packaged }]`: other generated files packaged from operation records (the Betaflight CLI dump). |
| `firmware` | `[{ path, from, digest }]`: firmware configuration files and where they came from. |
| `sections` | `[{ unit, section, contributors }]`: which extensions contributed to each unit's spec, BOM, work order, assembly guide and test plan. |
| `files` | `[{ path, digest, bytes, role, unit?, from? }]`: every file in the package but the manifest. `role` is `document`, `purchasing`, `fabrication`, `assembly`, `test`, `firmware-config`, `model`, `figure` or `asset`; `from` is the project file it was copied from. |
| `packageDigest` | SHA-256 of the `files` list (stable JSON): the package's identity. |

## Reproducibility

A release of the same commit with the same Chrome and fonts gives the same
bytes. On another commit, the PDFs, `index.html` and `manifest.json` change
(they carry the commit and its date), and so does `packageDigest`; every
other file stays the same unless the model or its outputs changed.
`node scripts/compare-release.mjs <project>` compares a package with the
project's committed release record on that basis:

```text
examples/smart-bottle: release/0.1.0 against operations/2026-10-03T20-15-46-753Z-release.json (…; package 57a412f89384)
  81 file(s) identical, 18 document(s) that carry the commit differ (expected on another commit), 0 other difference(s)
```

## Preconditions and codes

Nothing is written unless `protoboard check` has no errors, every provider
output is current (recorded export, unchanged config and module, `out/` as
the record wrote it, no `*_STALE` finding, no skipped provider check), and
the git tree is clean outside `release/` and `operations/`. The `REL_*`
codes are in the [ext-release README](../../packages/ext-release/README.md#preconditions).
The release writes `operations/<time>-release.json` with every file and
digest; commit it.
