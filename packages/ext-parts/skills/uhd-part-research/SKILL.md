---
name: uhd-part-research
description: Gather and record the evidence needed to author a purchased part as a UHD definition — identity, pinout, electrical/mechanical/thermal facts, CAD — with every source logged in sources.json, in a Protoboard project (project-researched tier: parts/evidence/<id>/) or the cloud part library (library/parts/<id>/). Use after a brief names a purchased part that is not in the cloud catalog and before authoring its ModuleDef.
---

# UHD part research

Produce a complete, cited evidence set for one part. The evidence folder
depends on where the part is authored:

| | Project (project-researched tier) | Part library (protoboard-cloud `library/`) |
| --- | --- | --- |
| Evidence folder `<evidence>` | `parts/evidence/<id>/` | `library/parts/<id>/` |
| Definition (next skill) | `parts/local/<id>.uhd.ts` | `library/parts/<id>.ts` |
| Existing parts to check for collisions | `src/`, `parts/local/`, `parts/catalog/` | `library/parts/` |

Downloads and working notes go in `<evidence>/.research/` (gitignored); the
committed record is `<evidence>/sources.json`. In a project, the sourcing
skills (`@protoboardai/ext-sourcing`: **part-search**, **datasheet-extract**,
**part-handoff**) come first and decide the part; this skill then records the
technical evidence.

## Purpose

Collect, cite and extract every fact the author will need, so the definition
is written from files, not from memory. Use it when a purchased part is
needed and the cloud catalog does not have it (`protoboard parts search`
found nothing, or only another variant), and before **uhd-part-author**. In
**build-a-project** it is stage 3, project-researched tier, after
**part-handoff**. Do not use it for a part the catalog has: `protoboard
parts add <id>` vendors it with its evidence.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The chosen part (manufacturer, ordering code) | `docs/sourcing/<need>.md`, `docs/decisions.md` | **part-search**, the brief |
| The part id | kebab-case `<manufacturer>-<product>-<variant>` | **part-search** / step 1 |
| Datasheet extractions (in a project) | `parts/evidence/<id>/datasheet/` | **datasheet-extract** |
| Existing parts, for collisions and peers | the table above | the project or library |

## Steps

### 1. Lock identity

- Resolve the **exact** product: manufacturer, product name, part number or
  SKU, hardware revision, and variant (KV rating, cell count, capacity,
  version). Record it in `.research/identity.md`.
- Choose the part id: kebab-case `<manufacturer>-<product>-<variant>`, e.g.
  `matek-m10q-5883`, `cnhl-black-6s-1100mah-100c`. It must not collide with
  an existing part (table above) or a catalog part; a local variant of a
  catalog part gets its own id.

```bash
npx protoboard parts search <manufacturer> <product> --format json   # is it (or a sibling) in the catalog already?
npx protoboard inspect --format json                                 # definitions the project already has
```

- If the brief's product can't be confirmed from manufacturer documentation
  (it's discontinued, only exists as an unbranded listing, or the name is
  ambiguous), stop and report the problem together with the closest
  documented alternative. Don't author a part whose identity is guesswork.

### 2. Collect sources (pass 1)

Look for these source types in order of authority:

1. The manufacturer's datasheet, manual, or spec sheet (PDF or page).
2. The manufacturer's product page (specs table, pinout image, dimensions
   drawing).
3. The manufacturer's wiring guides, firmware target files (for example
   Betaflight/INAV target definitions for a flight controller's pins and
   UARTs), and dimension drawings.
4. Distributor pages (GetFPV, RaceDayQuads, DigiKey, Mouser), used only to
   corroborate or fill gaps, and cited as such.

For each source:

- fetch it and save the bytes, or the extracted text for web pages, under
  `.research/downloads/`;
- a documentation site built with GitBook (`docs.revrobotics.com`, many
  vendor docs) serves each page's Markdown when `.md` is appended to the
  page URL: save that export (`<page>.md`), hash its bytes, keep the page URL
  as `url` and name the export in `note`. The HTML around it changes on every
  request; the export does not. Save the page's images (pinouts, drawings)
  too, each with its own row;
- append a row to `<evidence>/sources.json`:

```json
{
  "id": "src_datasheet",
  "title": "Matek M10Q-5883 manual",
  "url": "https://www.mateksys.com/?portfolio=m10q-5883",
  "type": "datasheet",
  "authority": "manufacturer",
  "fetched_at": "2026-09-26T18:00:00Z",
  "sha256": "<of downloaded bytes, or null for text-only captures>",
  "supports": ["pinout", "supply voltage", "dimensions", "I2C compass address"]
}
```

`type` uses UHD `ArtifactType` values: `datasheet | schematic | pcb | 3d_model
| firmware | simulation | documentation | cad | custom` (CAD downloads are
`cad`, with a `licence` field; see step 3). `authority` is one of
`manufacturer`, `distributor`, `community`.

In the part library, write rows with the writer instead of by hand: it
hashes the download, records it as `local`, and refuses a row verify-part
would reject (`npm run migrate:sources -- <id> --id src_datasheet --url <url>
--title "<title>" --type datasheet --authority manufacturer --supports
"pinout; supply voltage" --file library/parts/<id>/.research/downloads/<file>`;
`--check` re-hashes every local copy).

**Vendor URL patterns.** Some manufacturers publish documents at fixed paths
that their product pages do not always link. Try them (a HEAD request is
enough to see whether one exists) before recording a gap:

| Maker | Try |
| --- | --- |
| REV Robotics | `https://www.revrobotics.com/content/docs/<SKU>-DR.pdf` (drawing), `<SKU>-DS.pdf` (data sheet), `<SKU>-UM.pdf` (user manual), and `https://www.revrobotics.com/content/cad/<SKU>.STEP`, with the SKU as REV prints it (`REV-31-1425`; a pack's SKU without `-PK<n>`). The docs site is GitBook: capture its pages as `.md`. |
| Adafruit | the product's Learn guide PDF, the `adafruit/Adafruit-<product>-PCB` repository (Eagle `.brd`/`.sch`), and `adafruit/Adafruit_CAD_Parts` (`<number> <name>/`). |

Standard parts (ISO/DIN fasteners and similar) are defined by the standard,
not a manufacturer. Set `manufacturer` to `Generic (<standard>)`, tag the part
`standard-part`, keep the supplier's SKU as `part_number`, and mark the
supplier's drawing `authority: "distributor"`.

The datasheet or manual blocks the pipeline. If no manufacturer technical
source exists, escalate instead of authoring from distributor listings
alone.

### 3. Find CAD

Every part gets 3D geometry (the author binds its interfaces to it), so
look for manufacturer CAD while collecting sources. In order:

1. The manufacturer's product or downloads page (a "STEP", "3D model" or
   "CAD" link; REV, CTRE, Raspberry Pi, Arduino and Pololu publish one per
   product).
2. The manufacturer's GitHub (Adafruit `Adafruit_CAD_Parts`, SparkFun
   product repos, Pololu): the licence file in the repo is the licence.
3. The distributor "3D model" link (Digi-Key, Mouser), SnapEDA or Ultra
   Librarian, for ICs and connectors. These are usually package models
   (the IC body), which is fine for a chip-level part.
4. Community models: KiCad's 3D library (`kicad-packages3D` on GitLab, for
   standard packages such as DO-41, SOT-23, TO-220, pin headers; CC-BY-SA
   4.0 with the KiCad libraries exception), FreeCAD and other public GitHub
   repositories, forum attachments. Take them when they download without an
   account, keep the licence text beside the file (`licensePath`), and
   record the terms as the repository states them. A CC-BY-SA model is
   `redistributable` with its attribution and licence; it is evidence and a
   possible body for a generic part, and the part's modelling notes say
   whether it is bound or only kept (the library's `generic-1n4007` keeps a
   KiCad DO-41 model beside a generated body).

Collect every model you can download, whatever its licence,
including the community ones: the team may use a file it may not pass on,
and its terms record keeps it from leaving the team. Never create an account, log in, or accept a licence on
the owner's behalf (a click-through agreement). A model behind an account, a
login, a click-through licence or bot protection is recorded as a link with
its terms instead (below).

Save the download under `.research/cad/` (gitignored) and add a row to
`sources.json` with `type: "cad"`, the sha256 of the downloaded bytes (the
archive if it was zipped), and a `licence` field quoting the terms:

```json
{
  "id": "src_cad",
  "title": "<Manufacturer> <product> STEP model",
  "url": "<the download link, not the page it is on>",
  "type": "cad",
  "authority": "manufacturer",
  "fetched_at": "2026-09-26T18:00:00Z",
  "sha256": "<of the downloaded bytes>",
  "licence": "No licence stated on the download page; not redistributed.",
  "supports": ["overall dimensions", "mounting hole positions", "named components"]
}
```

Write `licence` exactly as the source states it, or "not stated", and look
for the terms where they usually are: a LICENSE file in the archive or the
repository, the download page, the site's terms of use or IP policy (linked
from the page footer). Then record the terms of the file itself in
`<evidence>/terms.json`, one entry per file, keyed by the path the file will
have (the library commits vendor files under
`library/parts/<id>/artifacts/cad/vendor/`; a project under
`parts/local/<id>/vendor/`):

```json
{
  "schema": "protoboard.library-terms/v1",
  "files": {
    "library/parts/<id>/artifacts/cad/vendor/<file>.STEP": {
      "distribution": "internal",
      "license": "LicenseRef-<Vendor>-Terms",
      "licenseUrl": "<the terms page>",
      "summary": "<the terms in a sentence or two, or what you found when there were none>",
      "sourceUrl": "<the download link>",
      "sourceSha256": "<the archive's sha256, when the file was extracted from it>",
      "retrieved": "2026-10-03",
      "sha256": "<of this file>"
    }
  },
  "links": [
    { "title": "<what is there>", "url": "<the page>", "kind": "3d_model", "access": "account",
      "terms": { "distribution": "internal", "summary": "<the site's terms>", "retrieved": "2026-10-03" } }
  ]
}
```

`distribution` is the decision that matters:

| Class | When |
| --- | --- |
| `redistributable` | The terms clearly allow passing the file on: MIT, BSD, Apache-2.0, CC-BY, CC-BY-SA, CERN-OHL. Give `license` as the SPDX id, `attribution` as the copyright line, and commit the licence text beside the file (`licensePath`). |
| `internal` | Terms were found and they restrict use or redistribution: non-commercial only, own use only, "all rights reserved", a library service's terms. |
| `unknown` | No terms could be established: none stated, terms pages unreachable. This is the default for anything unverified, including scraped product photos. |

Use an SPDX id when there is one; otherwise `LicenseRef-<Name>`. Record the
same for a product photo you download (the page it came from, and what its
terms say or that they were not found). Models you could not download go in
`links` with `access`: `account`, `login`, `click-through` or `other` (a bot
challenge, for example), and their terms as far as the page shows them.

In the part library, `npm run migrate:terms -- <id> <file> --distribution
<class> --license <id> --summary "<terms>" --source-url <url>` writes a file's
entry with its sha256 (`--preset <name>` for a preset, `--link …` for a model
you could not download, `--missing` lists the files with no entry).

Treat the CAD as evidence: measure the hole pattern, overall size and
connector positions, and record agreements and conflicts with the drawing in
the mechanical extract, like any other source. Use the shared measurer rather
than a script of your own, with the CAD Python (`$PROTOBOARD_PYTHON`, or
`.protoboard/tools/cad/bin/python` after `npx protoboard tools install cad`):

```bash
$PROTOBOARD_PYTHON <ext-parts>/scripts/audit/step_measure.py <file.step> --axis z --max-d 6   # envelope + hole axes
$PROTOBOARD_PYTHON <ext-parts>/scripts/audit/step_measure.py <file.step> --section z=1.5      # a cut: outline, circles, edges
python3 <ext-parts>/scripts/audit/eagle_brd.py <board.brd> --element '^JP1$' --nets          # a breakout's header nets, holes, outline
```

`eagle_brd.py` places pads as Eagle does (rotate, then mirror a bottom-side
element), so the coordinates of an `MR90` part are right; ad hoc scripts that
mirror first get them wrong. In the library,
`.venv-cad/bin/python library/cad/py/vendor_step.py <id> <file.step>` also
prints the vendor model's component tree.

If no CAD can be downloaded, write down where you looked in
`.research/gaps.json` (`type: "data"`, field "manufacturer CAD", with the
URLs tried). The author
then generates representative geometry from the drawing dimensions. A vendor
model is used for the body whatever its terms; the terms decide only who may
receive it.

### 4. Extract by domain (pass 2)

Consider every domain and write `.research/extract-<domain>.json` for each:
`electrical`, `mechanical`, `thermal`, `network`, `pneumatic`, `hydraulic`.
A domain with nothing in the sources gets `{ "domain", "relevant": false,
"reason" }`. In a project, every value taken from a PDF goes through
**datasheet-extract** first; its grounded rows become these facts.

For a relevant domain:

```json
{
  "domain": "electrical",
  "relevant": true,
  "facts": [
    { "field": "supply voltage", "value": "4.5-5.5 V", "source": "src_datasheet", "where": "Specifications table" }
  ]
}
```

What to extract:

| Domain | Extract |
| --- | --- |
| Electrical | Pin or pad table **first** (label, function, voltage level, and the pin designator for the exact package: a custom board's circuit provider needs it); supply rails, with input range and current, and any minimum rating the source must have ("use a 40 A breaker"); outputs (BEC voltage and current); signal protocols (UART numbers, I2C address, DShot support, bidirectional DShot); connectors and their pin order; current and voltage ratings (continuous vs burst, and burst duration). |
| Mechanical | Mounting pattern (spacing, hole count, fastener size, threaded vs through, grommets; for holes in a line, the pitch and count; for slots, the usable length and whether it is a T-slot or a through slot); dimensions; mass; package name as the manufacturer prints it ("QFN-48 6×6 mm") and body size; shaft or bore: male or female, profile (round, hex, rounded hex, D-cut, keyed, spline), diameter or across-flats size, key width or spline standard, thread; for linear outputs, stroke, lead, thread pitch and starts, rated force (dynamic, static or peak) and speed; connector and lead types; lead length. |
| Thermal | Operating and storage temperature; derating and cooling requirements. |
| Network / RF | Radio band, protocol, antenna connector, output power. |
| Performance | Anything specific to the part type: motor KV, stator size, thrust tables; battery cell count, capacity, and C rating; propeller diameter, pitch, and blades. |

Record conflicts between sources as
`{ "field", "values": [...], "sources": [...], "resolution" }`.

**Before recording a data gap, search for it.** The pilot audits found
"gaps" whose value sat in a datasheet table the author had not read
(electrical characteristics, absolute maximum ratings, ordering information,
package drawings). For each missing field, search every downloaded source's
text (`pdftotext -layout <file.pdf> - | grep -n -i -E '<terms>'`, with the
field's synonyms: "operating temperature|ambient|T_A", "weight|mass|g\b") and
look through the tables of contents, then save the search:

```json
{ "type": "data", "field": "operating temperature",
  "reason": "no temperature in the guide, the product page or the board files",
  "searched": [{ "source": "src_guide", "terms": ["temperature", "°C", "ambient"], "result": "no match", "saved": ".research/searches/operating-temperature.txt" }] }
```

`.research/searches/<field>.txt` keeps the commands and their output. A gap
without a recorded search is not accepted by the audit (**uhd-part-verify**
samples gaps). Record a fact that is missing everywhere in
`.research/gaps.json` as `type: "data"`.

**Image-only sources.** Many drawings and pinouts are only images (a PNG on
a docs page, a scanned drawing). Read them visually, and say so: such a
fact's `method` is `"visual"`, with the image file, the region read, and the
value as printed:

```json
{ "field": "mounting hole spacing", "value": "16 mm", "source": "src_drawing_png", "where": "front view, top dimension", "method": "visual", "image": ".research/downloads/drawing.png" }
```

The auditor re-reads every visual fact from the same image. Where a
vector source (a PDF drawing, a STEP, a board file) states the same value,
cite it instead and keep the image as corroboration.

### 5. Summarise

Write `.research/summary.md`: identity, the chosen part id, bullet facts with
source ids, conflicts, gaps, the CAD found (file, licence, coordinate
system, where the mounting holes, shaft and connectors are in it) or where
you looked, and the mating parts this part should connect to (for example
the ESC and frame for a motor). The author skill works from this
file and the extract files, not from raw documents.

## Decision points

| Decision | Rule |
| --- | --- |
| Research or `parts add` | The catalog has the exact variant: `protoboard parts add`, no research. Otherwise research it here. |
| Identity unconfirmable | Stop and report with the closest documented alternative; never author a guessed identity. |
| Source authority | Manufacturer over distributor over community; a distributor fact is corroboration, cited as such. |
| No manufacturer technical source | Escalate to a person; do not author from listings alone. |
| Keep a CAD download | Always, whatever its licence, with its terms in `terms.json`. In the library it is committed under `artifacts/cad/vendor/`; a file over 95 MB goes to the blob store with a pointer (`npm run large-files -- add`). |
| Terms not found | `distribution: "unknown"`, and say in `summary` where you looked. Never guess `redistributable`. |
| Model behind an account, a login or a click-through licence | Do not sign up, log in or accept on the owner's behalf: record it in `terms.json` `links` with its terms. |
| Two sources disagree | Record the conflict and its resolution; an unresolved one goes to the author as an `assumption` or `source_discrepancy` trait. |
| A value is "not stated" | Search every source's text and tables first, and save the search (step 4); only then a data gap. |
| A drawing is only an image | Read it, and record the fact with `method: "visual"` and the image; prefer a vector source that states the same. |
| No branded maker (a marketplace clone, a generic part) | The design's reference source as manufacturer authority; the listing as distributor; clone variation as assumptions (Marketplace clones and generic parts). |

## Outputs

| Output | Where |
| --- | --- |
| Committed source record | `<evidence>/sources.json` |
| Committed terms record | `<evidence>/terms.json`: the terms of every downloaded file, and links to models not downloaded |
| Working evidence (gitignored) | `<evidence>/.research/`: `identity.md`, `downloads/`, `cad/`, `extract-<domain>.json`, `gaps.json` (with the searches), `searches/`, `summary.md` |

## Verification

- Every fact in the extract files has a `source` id that exists in
  `sources.json` and a `where`.
- Every `sources.json` row has a `fetched_at`, and a `sha256` for downloaded
  bytes; every `cad` row has a `licence`.
- Every downloaded model, licence text and photo has an entry in
  `terms.json` with a `distribution`, a `sourceUrl`, a `retrieved` date and
  a `summary`; `verify-part.ts` fails on one without an entry.
- Every domain has an extract file (`relevant: false` with a reason counts).
- Every data gap records the search that did not find it.
- `summary.md` names the part id, the CAD (or where research looked) and the
  mating parts.

The facts are re-checked independently in **uhd-part-verify** stage 2.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `HW_NO_SOURCES` (later, in `check`) | The part was authored without sources | Run this skill and cite them |
| `PB_DUPLICATE_DEFINITION` (later) | The chosen id collides | Choose a distinct id (a local variant gets its own) |
| The datasheet covers several variants | Facts would mix variants | Extract for the exact ordering code only (**datasheet-extract** rule 4) |
| A fetched page has no stable bytes (JavaScript-rendered) | Nothing to hash | Save the extracted text, `sha256: null`, and say so in the row |
| No CAD can be downloaded | Geometry cannot be vendor CAD | Record the search in `gaps.json` and any account-only models in `terms.json` `links`; the author generates the body from the drawing |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. Every fact has a source id and a location.
2. Keep variants distinct. A spec for the 1950KV motor isn't evidence for the
   2550KV one.
3. Don't infer: "Typical for this class" is not a source.
4. Drop raw documents from context once the facts are extracted, and work
   from the files.
5. Don't touch other parts' files or shared code.

## Marketplace clones and generic parts

Many parts are sold under no maker's name (an HC-SR04, an L298N board, a
28BYJ-48 motor, an NPT adapter from a marketplace listing), or are generic
by nature (a 1N4007, a 5 mm LED). There is no manufacturer of the exact
item, but there is a design:

- **Identity**: `manufacturer` is `Generic (<design or reference maker>)`,
  the tag `generic-part`, `part_number` the design's name (`HC-SR04`,
  `1N4007`). The listing that sold it is a `distributor` source.
- **Reference source**: the design's originator or the reference datasheet a
  maker publishes for it (Elecfreaks for the HC-SR04, Vishay for a 1N4007,
  Handson Technology's L298N guide), cited with `authority: "manufacturer"`
  and named as the reference in the modelling notes. For a passive or
  discrete, pick one reference maker and part number and record it.
- **What varies between clones** (board colour, connector type, hole
  positions, regulator fitted) is an `assumption` trait naming the reference
  the value came from; a value only a listing states is corroboration, never
  the source.
- **Photos and CAD**: a listing photo is `unknown` terms; a community model
  of the design (KiCad, a GitHub repository) is collected with its terms.
