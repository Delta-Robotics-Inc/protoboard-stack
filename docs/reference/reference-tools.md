# Reference tools

A **reference tool** is something Protoboard knows about and measures against, but does not ship (PB-1191):

- a **physical reference** of known size: a scan ruler (a scale bar laid in a photo or a scan), a calibration cube, a gauge block, a printed test part;
- an **external program** used by file handoff only: ScanRuler and BumpMesh by Stefan Hermann (CNC Kitchen), both AGPL-3.0-only. Protoboard links to them, hands files to them and reads what they write. It never bundles, ports, proxies or hosts them, and does not depend on their npm packages.

Code: `packages/core/src/reference-tool/` (registry, loader, validator, evidence writer); commands in `packages/cli/src/parts-{export,import-step,attach}.ts`; the procedure is the **scan-to-part** skill in `@protoboardai/ext-parts`.

## The registry: `protoboard.reference-tool/v0`

One JSON file per tool. Later entries replace earlier ones with the same id:

| Order | Where | Notes |
| --- | --- | --- |
| 1 | built in | `scanruler`, `bumpmesh` (software) |
| 2 | `<home>/reference-tools/<id>.json` | home is `PROTOBOARD_HOME`, else `~/.protoboard` |
| 3 | `parts/reference-tools/<id>.json` in the project | committed with the project; wins |

DEFAULT (revisit): one file per tool in a folder rather than a field in `protoboard.config.ts`, so adding a tool changes no config type and reviews as one file.

| Field | Type | Rule |
| --- | --- | --- |
| `schema` | `"protoboard.reference-tool/v0"` | exact |
| `id` | string | 2 to 64 lower-case letters, digits and hyphens; it names evidence folders |
| `name` | string | required |
| `kind` | `scan-ruler`, `calibration-cube`, `gauge-block`, `printed-test-part`, `software` | |
| `nominal` | list of `{ name, value, unit, tolerance: { plus, minus }, source?, assumption?, note? }` | at least one for a physical kind; `unit` is `mm`, `um`, `in` or `deg`; every value needs a `source`, or `assumption: true` |
| `source` | `{ maker?, partNumber?, lcsc?, url?, certificate? }` | `lcsc` is a C number (LCSC first for anything bought) |
| `model` | `{ path, sha256, format, units }` | the file the reference was made from (a printed test part's STL), relative to the registry file's folder (the project root for project entries), pinned by `sha256:<hex>`; the loader reports `ok`, `missing` or `changed` |
| `evidence` | `{ layout, photos, measures? }` | `layout` names `<part>`, `<date>` and `<tool>` |
| `software` | `{ homepage, repository?, author?, license, relationship: "reference", runs, selfHost?, mcp?, reads, writes, handoffs, provenanceMethod, testedVersions, notes? }` | kind `software` only; an MCP server run through `npx` must be pinned to an exact version |

Security: only `*.json` files directly in those folders, each under 256 KB, are read, as data, and validated; a link out of the folder is refused; a model file is only hashed, never opened by a program.

### Example: a gauge block

```json
{
  "schema": "protoboard.reference-tool/v0",
  "id": "gauge-block-25",
  "name": "Gauge block 25 mm",
  "kind": "gauge-block",
  "nominal": [
    { "name": "length", "value": 25, "unit": "mm", "tolerance": { "plus": 0.0006, "minus": 0.0006 }, "source": "calibration certificate no. <your certificate>" }
  ],
  "source": { "maker": "<maker>", "certificate": "<certificate reference>" },
  "evidence": { "layout": "parts/local/<part>/evidence/<date>-<tool>/", "photos": true, "measures": ["length"] }
}
```

The tolerance shown is a placeholder: use the one on your block's certificate.

### Example: a printed calibration cube

```json
{
  "schema": "protoboard.reference-tool/v0",
  "id": "cube-20-petg",
  "name": "20 mm cube, PETG, printer A",
  "kind": "calibration-cube",
  "nominal": [
    { "name": "edge-x", "value": 20, "unit": "mm", "tolerance": { "plus": 0.1, "minus": 0.1 }, "source": "model file cube-20.stl", "assumption": true, "note": "tolerance is this printer's measured repeatability, an assumption until checked" }
  ],
  "source": { "maker": "printed in-house" },
  "model": { "path": "parts/reference-tools/cube-20.stl", "sha256": "sha256:<64 hex>", "format": "stl", "units": "mm" },
  "evidence": { "layout": "parts/local/<part>/evidence/<date>-<tool>/", "photos": true }
}
```

## Evidence: `parts/local/<part>/evidence/<date>-<tool>/`

One folder per measuring session (a second session the same day with the same tool gets `-2`); nothing is overwritten. A library part's evidence goes in `parts/evidence/<part>/<date>-<tool>/` (DEFAULT). `evidence.json`, schema `protoboard.reference-evidence/v0`:

| Field | Holds |
| --- | --- |
| `part`, `date`, `recordedAt`, `by` | who and when |
| `tool` | id, name, kind, nominal dimensions, the model's sha256 and status |
| `files` | each copied file: project-relative path, sha256, size, original name |
| `measurements` | `{ name, value, unit, uncertainty?, reference?, note?, provenance: { method: "measured-from-reference-tool", tool, evidence }, check? }` |
| `scale` | from the measurement of the tool itself: `{ reference, factor, withinTolerance }` |
| `imported` | for `parts import-step --tool`: the STEP, its sha256 and provenance |

The scale check: a measurement written `ref:<nominal>=<value><unit>` is the reference tool measured in the same photo or scan. Its deviation from the nominal, whether it is inside the tolerance and the factor (nominal / measured) are recorded. Values are kept as measured; nothing is rescaled.

## Commands

| Command | Does |
| --- | --- |
| `protoboard parts export <part or instance> --format step\|stl\|3mf\|glb [--out <file or folder>] [--from glb\|step]` | Writes the full-resolution body (never the view sidecar) to `.protoboard/exports/<name>.<format>` with `<name>.export.json`. STL and 3MF are mm and Z up, from the build's GLB; `--from step` tessellates the STEP at print resolution (0.01 mm, 0.1 rad, DEFAULT) on the CAD runtime. A component drawn inside its holder's body (a board's IC) is cut out of the holder's GLB through the holder's `X.view.json`; it has no STEP of its own. |
| `protoboard parts import-step <file.step> --part <id> [--tool <id>] [--replace]` | A STEP inside the project (size cap 1 GiB) becomes the part's body: recorded in `parts/sources.json` with its sha256, bound to ext-parts' import, converted by `scripts/import_cad.py` on the CAD runtime (found through core's python.ts). With `--tool`, the import is also an evidence session. |
| `protoboard parts attach <part> <file> --kind evidence\|drawing\|datasheet [--tool <id>] [--measure name=value<unit>]... [--terms redistributable\|internal\|unknown] [--license <text>] [--url <source>]` | Copies the file into the part's folder (`drawings/`, `datasheets/`, or an evidence session), lists it with its sha256 and terms in `attachments.json`. Datasheets are gitignored unless `--terms redistributable` (DEFAULT). Files that can run are refused; size cap 256 MB. |

Registration of these commands in `cli/src/index.ts` is W4-D's (phase-1/handoffs.md, 2026-11-01).

## ScanRuler and BumpMesh

- **ScanRuler** (`scanruler`): run its MCP server pinned and with self-update off, `npx -y scanruler-mcp@0.5.0 --no-update`, started with `--out` inside the project. It can read and write any path, so treat what it writes as untrusted until imported. Its agent guide (`guide_read`) is the procedure; the **scan-to-part** skill points at it.
- **BumpMesh** (`bumpmesh`): no programmatic entry point. Export the body (`parts export --format 3mf`), texture it at bumpmesh.com or a self-hosted copy, and attach the textured 3MF back. It is a print variant and never replaces the body (open: a print-variant artifact role, PB-1191 Q1).
