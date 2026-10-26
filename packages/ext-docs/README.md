# @protoboardai/ext-docs

Technical documents for a project's system: a datasheet and an assembly
guide, as HTML and PDF, in which every value is a query into the UHD model
(re-checked by the verifier), figures are rendered from the CAD artifacts
placed by `assemble()`, and stand-in test data carries a watermark until
measured data replaces it. Moved out of UHD, where it was
`scripts/docs` with the `uhd-tech-docs` skills and read a library system
folder; it now reads a Protoboard project.

| Kind | Id | What |
| --- | --- | --- |
| Operation | `tech-docs` (export; tool `chrome`) | Builds `docs/<system-id>-datasheet.*`, `-assembly-guide.*` (`.html`, `.pdf`, `.values.json`), `docs/<system-id>-bom.json`, `docs/images/`, `docs/test-data/`; inputs `only`, `pdf`, `standins` |
| Operation | `tech-docs-verify` (export; tools `chrome`, `poppler`) | Re-resolves every bound value; checks format, placeholders, stand-in marks, images, layout, typography, BOM, assembly coverage; writes `docs/.review/` |
| Operations | `package:spec`, `package:assembly` (pure) | Manufacturing Package sections (@protoboardai/ext-release), per unit: what is designed for the unit (boards, mechanical parts and cables from the providers' standard outputs, with figures), and the illustrated assembly guide |
| Skill | `uhd-tech-docs` | Writing the doc spec, value queries, figures, test data; verified by `uhd-tech-docs-verify` |
| Skill | `uhd-tech-docs-verify` | The automated checks and the visual review |

Inputs from the project: the root system and the definitions it uses, the
configured scenarios, `docs/docspec.ts` (a `DocConfig`, `import type {
DocConfig } from "@protoboardai/ext-docs"`), and each part's evidence
(`parts/evidence/<id>/`, or the evidence files a catalog revision vendored
into `parts/catalog/<id>/`). Artifact files resolve against each definition's
artifact base: the project, the `parts/catalog/<id>/` directory of a catalog
part, or (older package-vendored pins) that package (`lib/model.ts`).

Requirements: Google Chrome (`$CHROME` for another binary), poppler
(`pdfinfo`, `pdffonts`, `pdftoppm`), three.js (a dependency;
`$PROTOBOARD_THREE_DIR` overrides it). The documents' font, Kode Mono (SIL
Open Font License 1.1), ships in this package (`fonts/`, with `OFL.txt`), so
every machine renders the same documents; display text is Kode Mono Bold. A
file in a folder named by `$PROTOBOARD_DOC_FONTS` replaces the bundled one of
the same name. A body whose CAD file is not in the
checkout (vendor CAD whose redistribution is not cleared) is left out of the
assembly figures, shown as "CAD file not available" in the kit and as an
empty slot in a step's parts strip, never as a blank image.

Worked example: `examples/quadcopter-5in` (`docs/docspec.ts` and the built
documents). `test/docs.test.ts` checks that its committed documents are
current against the model, and runs the verifier when Chrome is present.

## In the Manufacturing Package

With @protoboardai/ext-release, `protoboard release` calls two sections of
this extension once per unit (`ops/package.ts`):

- **`package:assembly`**: the unit's assembly plan (`lib/package/plan.ts`,
  exported as `@protoboardai/ext-docs/plan`): the doc spec's steps and the
  automatic ones, scoped to the links the unit makes (a step split across
  units says so; a board's nets are not steps). Each step gets its parts
  with thumbnails and letters, an exploded line-art figure lettered like
  them (or, for connections, the routed cables in the accent colour with the
  camera fitted on them), generated actions, the connection table, torque,
  tools, materials and the model's notes, merged when several cables say
  the same. Before the steps: sub-units to bring, tools, materials, and the
  kit (a sub-unit drawn as it arrives). After them: a coverage table. The
  release's work order numbers the same steps as its operations. Steps that
  must follow the bench test and configuration (a step that fits
  propellers, or one the doc spec marks `after: "test"`) are planned last;
  the work order runs the test before them. A unit named by module id and
  built several times is planned once; where its builds differ in what the
  parent sets (`spin`, `overrides`), a step that depends on it lists each
  build (the propeller's hand at each position), and the plan reports the
  differences (`builds`, `variants`).
- **`package:spec`**: each module of the unit a capability provider
  designs: boards (layers, thickness, outline, placements by side, nets and
  rails, edge), mechanical parts (material, size from the GLB, thickness,
  volume and mass, pieces, interface features) with a figure, and cables in
  one table with their routed shapes.

Figures are rendered by the release (`SectionContext.figure`), so this
extension never starts Chrome during a release. `test/package.test.ts`
checks both sections on the quadcopter with figures recorded, not rendered.

## Evals

`evals/build-datasheet`: build and verify the quadcopter's datasheet only,
and read two figures from it (needs Chrome and poppler). Run it with
`protoboard evals --extension docs`; see the [evals guide](../../docs/guides/evals.md).
