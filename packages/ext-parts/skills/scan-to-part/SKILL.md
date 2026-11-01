---
name: scan-to-part
description: Turn a real object into a Protoboard part with a measured body and recorded evidence, using reference tools Protoboard does not ship (ScanRuler for 3D scans; a scan ruler, calibration cube, gauge block or printed test part for scale). Covers the reference-tool registry entry, the session order, parts attach --kind evidence, parts import-step, and parts export for handing a body back out. Use when a part's body should come from a scan or from measurements of the physical thing, not from a datasheet drawing.
---

# Scan to part

A measured body is evidence, not a guess. Every number that comes from a scan
or a photo is recorded with the reference tool it was measured against
(provenance `measured-from-reference-tool`), in the part's own folder:

```text
parts/local/<part>/evidence/<date>-<tool>/
  evidence.json      the tool (id, nominal dimensions, model sha256), the files, every measured value, the scale check
  <photos, reports>
```

## Purpose

Use this when a part's body or its key dimensions should come from the
physical object: a part with no usable CAD, a printed part to check against
its model, a bought part whose drawing is wrong. It sits in build-a-project
where a part is authored (after **uhd-part-research**, beside
**uhd-part-author**); the body it imports is checked by **uhd-part-verify**
like any other. Do not use it when a datasheet drawing or a vendor STEP is
good enough: measuring adds work and an unverified body.

Reference tools are registry entries (`protoboard.reference-tool/v0`,
docs/reference/reference-tools.md). Built in: `scanruler` and `bumpmesh`
(software by CNC Kitchen, AGPL-3.0-only, used as separate programs by file
handoff only, never bundled or hosted). Physical references are project
entries in `parts/reference-tools/<id>.json`.

## Inputs

| Input | Where | Produced by |
| --- | --- | --- |
| The part's definition | `parts/local/<id>.uhd.ts` (or its module folder) | **uhd-part-author** |
| A reference tool entry | built in, or `parts/reference-tools/<tool>.json` | the person (nominal values from a certificate, datasheet or model file) |
| Photos, a scan, a report | anywhere on disk; copied in by attach | the person, ScanRuler |
| A STEP of the measured body (optional) | inside the project, e.g. `parts/local/<id>/evidence/<date>-<tool>/` | ScanRuler's reverse-engineering export, or another CAD tool |
| The CAD runtime | `.protoboard/tools/cad/` | `npx protoboard tools install cad` |

## Steps

### 1. Check the project

```bash
npx protoboard check
```

Read the summary line: fix errors on this part before measuring it.

### 2. Pick or write the reference tool

Read docs/reference/reference-tools.md. For a physical reference that is not
registered, write `parts/reference-tools/<tool>.json`: every nominal value
with its unit, its tolerance and a `source` (a certificate, the maker's
datasheet, or the model file it was printed from, pinned by sha256). A value
without a source carries `assumption: true` and a note. If the reference must
be bought, search LCSC first, record the C number in `source.lcsc` and check
stock before naming it.

### 3. Capture

Photograph or scan the object with the reference in frame (a scan ruler or
gauge block beside the part; a calibration cube printed on the same printer
for a printed part). For a 3D scan, run ScanRuler through its own MCP server,
pinned and with self-update off (`npx -y scanruler-mcp@<version> --no-update`,
started with `--out` inside the project), and read ScanRuler's own agent guide
first with its `guide_read` tool (topics `measure` and `scan-to-cad`). This
skill points at that guide and does not repeat it.

### 4. Record the evidence

```bash
npx protoboard parts attach <part> <photo or report> --kind evidence --tool <tool> --measure ref:<nominal>=<value><unit> --measure <name>=<value><unit>
```

`ref:<nominal>=…` is the reference tool measured in the same photo or scan: it
is checked against the tool's nominal and tolerance (the scale check). Read
the `evidence:` line and `scale.withinTolerance` in
`parts/local/<part>/evidence/<date>-<tool>/evidence.json`. Values are recorded
as measured; nothing is rescaled.

### 5. Import the measured body (when there is one)

```bash
npx protoboard parts import-step <file.step> --part <part> --tool <tool>
```

The STEP must be inside the project; its sha256 goes in parts/sources.json,
and the body is made by ext-parts' `scripts/import_cad.py` on the CAD runtime.
Read the `SUCCEEDED cad:generate` and `SUCCEEDED cad:export` lines.

### 6. Check and build

```bash
npx protoboard check
npx protoboard build
```

### 7. Hand a body out (a slicer, BumpMesh, a colleague)

```bash
npx protoboard parts export <part> --format stl
```

It writes the full-resolution body (never the display sidecar) under
`.protoboard/exports/` with `<name>.export.json` saying what it came from. A
textured print variant from BumpMesh comes back with `parts attach --kind
evidence --tool bumpmesh`; it never replaces the body.

## Decision points

| Decision | Rule |
| --- | --- |
| Scan or measure by hand | Scan when the shape is freeform or has many features; measure by hand (calipers against a gauge block) for a few dimensions. |
| Which reference | One whose tolerance is at least ten times finer than the dimension you need; else say the measurement is limited by it. |
| Scale check fails | Stop: re-take the photo or scan. Never correct the other values by the factor yourself. |
| Below the noise | ScanRuler reports σ; anything finer than 3σ is inconclusive and is not recorded as a measurement. |
| Accept the measured body | The person decides; until then it is project-local and unverified. |

## Outputs

| Output | Path |
| --- | --- |
| Evidence session | `parts/local/<part>/evidence/<date>-<tool>/evidence.json` and the copied files |
| Attachment list | `parts/local/<part>/attachments.json` |
| Imported body record | `parts/sources.json` (entry `imported-<sha8>`), `cad.config.ts` binding |
| Body files | the part's `out/body.step`, `out/body.glb`, `out/body.manifest.json` (generated: never edit) |
| Exports | `.protoboard/exports/<name>.<format>` and `<name>.export.json` |

## Verification

```bash
npx protoboard check
npx protoboard parts models
```

The part's row shows the imported body. Then run **uhd-part-verify** on the
part; the auditor reads the evidence session and the scale check.

## Failure handling

| Code or symptom | Meaning | Action |
| --- | --- | --- |
| `no reference tool "<id>"` | the tool is not registered (or its JSON is not valid: the message lists why) | write or fix `parts/reference-tools/<id>.json` |
| `... is outside the project` | import-step reads only files inside the project | move the STEP under the part's evidence folder, then import it |
| `not converted: no Python with build123d` | no CAD runtime | `npx protoboard tools install cad`, then `npx protoboard run cad:generate --module <part>` and `cad:export` |
| `PART_CAD_IMPORT_CHANGED` | the STEP changed after it was imported | check the new file, then import it again |
| scale check outside tolerance | the photo or scan is distorted or the reference is mis-read | re-take it; do not record the values |
| `has only a placeholder body` on export | nothing real to export | give the part a model first |

Other codes: **system-compose**'s diagnostic codes reference.

## Hard rules

1. Files from reference tools enter the project only through `parts import-step` or `parts attach`, never by copying into `parts/local` by hand.
2. Cite a source for every nominal number; mark assumptions.
3. Never put a sign-in, token or pairing code in a file or a prompt.
