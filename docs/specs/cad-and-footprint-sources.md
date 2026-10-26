# Footprint and CAD model sources

Status: draft; nothing here is built yet.
Extends [the UHD boundary](uhd-boundary.md), [tool integrations](tool-integrations.md)
and [the PCB handoff](pcb-kicad-handoff.md).

Every part on a board needs a land pattern and a body model, and every part in
an assembly needs a body model. Today each extension finds these its own way,
the agent fills gaps by drawing models from data sheets, and the KiCad export
looks for files that are not where it expects. This spec says where those
files come from, which source is trusted over which, how each file records
where it came from, where the files are kept, how every extension asks for
one, what `check` reports, and what the agent may and may not do.

## 0. Design decisions

- **Do not reinvent the wheel.** The models usually exist already: on the UHD
  part, or from JLC/LCSC (where tscircuit and EasyEDA get theirs). An agent
  must not read every data sheet and make a placeholder model of every
  component.
- **Know the source** of every footprint and model, electrical and
  mechanical, so the extensions read the source and the agent reuses what is
  already in UHD.
- **Trust the model that comes with the footprint** (JLC/LCSC) over a random
  one.
- **Do what KiCad does:** libraries with a reference back to their source;
  local copies, remote references.
- **Protoboard is the orchestrator.** Modules own the data; build steps turn
  UHD into each tool's format (a KiCad library, a tscircuit board). The agent
  works in Protoboard, not at the KiCad or tscircuit library level, unless the
  job needs something Protoboard cannot do (SPICE, say).

## 1. What exists today

### 1.1 UHD: artifacts, package facts, file terms

- `ArtifactDef` (`uhd/src/types/artifact.ts`): `type` (`3d_model`, `cad`,
  `pcb`, …), `format` (`step`, `glb`, …), `role` (`body`, `interface`,
  `source`, `drawing`), `units`, `filePath` or `url`, and `provenance`
  (`ArtifactProvenance` in `uhd/src/types/geometry.ts`: `generatedFrom`,
  `tool`, `toolVersion`, `sourceDigest`). No sha256 and no source URL on the
  artifact itself.
- `PackageSpec` (`uhd/src/types/domain.ts`): the package as the manufacturer
  prints it (name, code, pin count, pitch, exposed pad, source). Its comment
  states the rule this spec keeps: which footprint a PCB tool uses for the
  package "is the tool's own choice and never part of UHD".
- The library protocol (`uhd/docs/library-protocol.md` §4.5,
  `uhd/src/library/types.ts`): every file a revision carries is a `BlobRef`
  (`sha256`, `size`, `mediaType`) with optional `terms` (`FileTerms`:
  `distribution` redistributable | internal | unknown, `license`,
  `licenseUrl`, `licensePath`, `attribution`, `summary`, `sourceUrl`,
  `sourceSha256`, `retrieved`). Terms are inside the envelope digest. Files
  not carried are listed in `missingArtifacts` with a reason.
- `uhd/docs/geometry-artifacts.md`: which files a generator writes is the
  generator's convention, not UHD; vendor CAD binds by the vendor's component
  names.

So UHD already has the tool-neutral half of provenance (where a file was
downloaded, when, its bytes, its licence). It has, rightly, nowhere to say
"this footprint" or "picked by the agent".

### 1.2 The library (protoboard-cloud)

- `protoboard-cloud/client/src/envelope.ts` mirrors the envelope (schemas
  `protoboard.part-revision/v1` and `uhd.part-revision/v1`, `FileTerms`,
  `missingArtifacts`).
- `protoboard-cloud/src/terms.ts`: the Protoboard-side terms record,
  `library/parts/<id>/terms.json` (`protoboard.library-terms/v1`), one entry
  per carried file, with record-only fields that never reach the envelope:
  `sha256` (bytes the terms were written for), `verified`, `note` and
  `provenance` (`method`: `protopart-import` | `cad-render` | `download` |
  `generated`, plus `publisher`, `sourcePage`, `renderedFrom`, `processing`,
  `recorded`, `tool`). It also holds `links`: models behind an account,
  login or click-through, recorded with their terms and not downloaded.
- What the library holds now (counted from `library/parts/*/terms.json`, 338
  parts with records): 406 STEP entries, 291 under the `library` preset (the
  library's own generated bodies, build123d) and 115 with terms of their
  own. By recorded method, 119 say `download`, 44 `generated` and the rest
  state none; of the downloads with a source URL, 74 are from KiCad's
  `kicad-packages3D` on GitLab, 18 from GitHub, the rest from makers' sites. 223 account-gated
  links (58 Onshape, 35 SnapEDA, 26 Ultra Librarian, 5 LCSC). No footprint
  files. Six parts mention LCSC, JLC or EasyEDA at all.
- Offers (`parts/offers.json` in a project, served by
  `GET /v1/parts/:id/offers`) are a precedent for Protoboard-side data served
  beside a part but outside its UHD definition.

### 1.3 Vendored part files in projects

- `protoboard parts add` (`packages/core/src/parts.ts`, client in
  `packages/core/src/library-client.ts`) vendors the definition JSON, its
  source and its carried files into `parts/catalog/<short>/`; each file's
  sha256 is pinned in `parts/origins.json` (`protoboard.origins/v0`, `files`)
  with `retrievedAt`, the service and the revision. Layout and `strip`:
  [project structure](protoboard-project-structure.md), "Vendored paths".
  The examples are still in the earlier layout (no `strip`).
- Project-researched parts live in `parts/local/` with evidence in
  `parts/evidence/<id>/` (`sources.json`, and `terms.json` in the library's
  format, `packages/ext-parts/lib/terms.ts`). None of the four examples has an
  evidence `terms.json` yet.
- `packages/core/src/project.ts` resolves every artifact of every used
  definition against its origin's base into `ResolvedArtifact`
  (`packages/core/src/types.ts`: `resolved`, `present` true | false | remote |
  provenance) and reports `PB_MISSING_ARTIFACT` (error) or
  `PB_ARTIFACT_UNAVAILABLE` (warning, vendor/research/catalog-held/URL).
  `PB_VENDORED_FILE_MISMATCH` and `PB_VENDORED_FILE_MISSING` cover the pinned
  catalog files.
- A part's status (`packages/core/src/part-trust.ts`): local,
  unverified, verified, official. It is per part, not per file.

### 1.4 How parts get bodies now

- `packages/ext-parts/skills/uhd-part-research/SKILL.md` §3 "Find CAD":
  maker's page, maker's GitHub, distributor/SnapEDA/Ultra Librarian, community
  (KiCad 3D library). JLC/LCSC is not in the list.
- `packages/ext-parts/skills/uhd-part-author/SKILL.md`: in the library, bind
  vendor CAD through `vendor_step.py`, else generate from the drawing; **in a
  project, keep the vendor STEP as evidence but "bind geometry generated from
  the drawing"**. `packages/ext-parts/lib/part-cad.ts` is the `cad` provider
  for such a part: a hand-written build123d script that writes
  `out/body.step`, `body.glb`, `body.manifest.json`.
- In the examples: quadcopter-5in has 13 local parts and one `part-cad`
  generator, smart-bottle 3 local parts with 3 generator scripts,
  wearable-watch 4 with 5 (`parts/local/_cadkit/`). This is the "mock model
  of every component" pattern section 0 rules out, and it is what the skill asks
  for today.

### 1.5 ext-tscircuit: land patterns and bodies

- Land patterns (`packages/ext-tscircuit/lib/footprints.ts`,
  `lib/land-patterns.ts`): the provider's own package → land-pattern table,
  either a `@tscircuit/footprinter` string or pads authored from the maker's
  recommended land pattern with a verification record. A project overrides
  it in `src/boards/<b>/tscircuit/footprints.json`. Matched by package name
  or family; `CIRCUIT_FOOTPRINT_FAMILY` (info), `CIRCUIT_FOOTPRINT_MISMATCH`
  (error), `CIRCUIT_FOOTPRINT_UNVERIFIED` (warning) in `lib/checks.ts`.
- No EasyEDA, JLC or jlcsearch import is used anywhere in the packages; the
  only mention is `ext-sourcing`'s part-search reference
  (`skills/part-search/references/sources.md`), as a stock shortlist.
- Bodies (`lib/models.ts`, `chooseBodies`), in order: the part's own UHD STEP
  body (a copy in `tscircuit/models/<part>-<artifact>.step` without the
  interface feature shapes), else its GLB/OBJ for `board.glb` with a package
  box for `board.step`, else a box from `dimensions_mm`
  (`models/box-LxWxH.step`), else tscircuit's own or none. Generate writes
  each body into `board.gen.tsx` as a `cadModel` relative to `tscircuit/`.
- README "Licensing": KiCad footprint and 3D-model libraries are not bundled
  and not fetched (CC-BY-SA 4.0); bodies come from the project's UHD parts or
  are boxes.

### 1.6 The KiCad export

`packages/ext-tscircuit/lib/kicad/project.ts` (spec:
[pcb-kicad-handoff.md](pcb-kicad-handoff.md) §2). The converter writes each
footprint's `(model …)` from the circuit JSON's `model_step_url`; the wrapper
then copies every model into `3d/` and rewrites the reference:

```ts
const file = `3d/${libItemName(basename(src))}`;
models[file] = src;
model.items[1] = str(`\${KIPRJMOD}/${file}`);
```

The name is the source file's **basename**. A model that is missing or not a
STEP file (`modelOk` in `ops/kicad.ts`) is dropped from its footprint and
listed. Footprints and symbols go into the project's own `<b>.pretty` and
`<b>.kicad_sym` with `${KIPRJMOD}`-relative `fp-lib-table` and
`sym-lib-table`, so the project does not depend on any global library.

**Symptom (fixed in another track):** every project part made by
`ext-parts`' `cad` provider writes `out/body.step`, so their basenames are all
`body.step` and they overwrite one another in `3d/`; 89 parts collided on one
board. Every footprint then shows whichever body was written last. This spec
does not fix it; §5.2 gives the naming rule the fix should follow.

### 1.7 The CAD extensions

`ext-harness-cad` (`lib/job.ts`) and `ext-enclosure-cad` (`lib/job.ts`) each
look up a body themselves: the first artifact with `format === "glb"` and
`role === "body"`, matched by id or `provenance.generatedFrom`, then
`p.artifacts.find(...).resolved`; a missing file is skipped silently.
`ext-frame-cad` (`checks/hardware.ts`) skips generating a fastener body when
the part already has a `role: "body"` artifact (a vendor model), else makes
the nominal body from its sizes. None of them records or reports which model
it used, or that it fell back.

### 1.8 How KiCad itself does it

- **Library tables.** Footprints and symbols are found by
  `<nickname>:<item>` through `fp-lib-table` and `sym-lib-table`. A global
  table lives in the user's KiCad configuration folder; a project table next
  to the `.kicad_pro` adds or overrides nicknames for that project. A
  library row is a URI, usually with a path variable.
- **Path variables.** `${KIPRJMOD}` is the project's folder.
  `${KICAD<n>_FOOTPRINT_DIR}`, `${KICAD<n>_SYMBOL_DIR}` and
  `${KICAD<n>_3DMODEL_DIR}` (n = the major version: `KICAD8_…`, `KICAD9_…`)
  point at the installed standard libraries; users add their own in
  Preferences → Configure Paths. A path variable that is undefined on
  another machine is the common cause of "models not found".
- **Model references.** A footprint names its body as
  `(model "<path>" (offset (xyz …)) (scale (xyz …)) (rotate (xyz …)))`; the
  footprint owns the placement of the model, so a model is only right
  together with the footprint it was aligned to. The standard library pairs a
  `.wrl` for rendering with a `.step` of the same name for STEP export.
- **Embedded files (KiCad 9 and later).** Models, fonts and data sheets can
  be embedded in a board or footprint and referenced as `kicad-embed://…`,
  making the file self-contained; embedding is one model at a time in the UI.
- **Plugin and Content Manager.** Installs third-party libraries into a
  managed folder under its own path variable (`${KICAD<n>_3RD_PARTY}`) and
  can add them to the tables; packages are versioned in a repository index.
- **JLC/LCSC importers.** `easyeda2kicad` (AGPL-3.0) fetches a part by LCSC
  number from EasyEDA's API and writes `easyeda2kicad.kicad_sym`,
  `easyeda2kicad.pretty/` and `easyeda2kicad.3dshapes/` (`.wrl` and `.step`)
  into one user library, models referenced through an `EASYEDA2KICAD` path
  variable (or `${KIPRJMOD}` with `--project-relative`); the offset and
  rotation come from EasyEDA's own placement of its model on its footprint.
  `JLC2KiCadLib` does the same per C-number. tscircuit's
  `easyeda-converter` (MIT) fetches the same EasyEDA data by C-number and
  turns it into a tscircuit footprint and component with a 3D model
  reference (optionally through a tscircuit model CDN).

What we take from KiCad: a **local copy** the tool reads, a **reference back
to the source** (library nickname, URL, version), a **project-local table**
so a project never depends on a machine's global setup, and a footprint that
**owns its model's placement**.

Sources: [easyeda2kicad](https://github.com/uPesy/easyeda2kicad.py),
[tscircuit easyeda-converter](https://github.com/tscircuit/easyeda-converter),
[KiCad 9 release (embedded files)](https://www.cnx-software.com/2025/02/21/kicad-9-release/).

## 2. Principles

1. **One resolver.** Every extension asks Protoboard for a part's footprint
   or model through one API (§5). No extension searches artifacts, caches or
   tool libraries on its own.
2. **Reuse before making.** A file that exists at a trusted source is used;
   a model is made only when no source has one, and an agent asks first (§7).
3. **Every file has a record**: where it came from, its bytes, its terms, who
   chose it (§3). A file with no record is reported.
4. **UHD stays tool-neutral.** Body models are UHD artifacts (they are
   facts of the part); footprints, supplier ids and "who chose it" are
   Protoboard data, kept beside the part, never in its definition (§3.2).
5. **Local copy, remote reference.** Tools read local files; each local file
   names its source and can be fetched again and checked against its sha256
   (§4).
6. **Build steps write tool formats.** The KiCad library, the tscircuit
   `cadModel`s and the CAD extensions' inputs are generated from the resolver
   at build time; nobody edits a KiCad or tscircuit library by hand to add a
   part.

## 3. Trust and provenance

### 3.1 Order of trust

Two axes decide a file's rank: **who made it** and **whether it was checked
against the part's facts**. A file checked against the part (pins, pitch,
package size, pin 1, body envelope) outranks the same origin unchecked.

**Footprints (land patterns)**

| Tier | Source | Notes |
| --- | --- | --- |
| F1 | A land pattern the library or provider holds for this part or package, **verified** against the maker's recommended land pattern | Today: ext-tscircuit's authored table entries with a verification record |
| F2 | The manufacturer's own footprint for the part | From the maker's site or ECAD download |
| F3 | The JLC/LCSC (EasyEDA) footprint for the exact C-number of the placement's MPN | Assembler's own library; the model it pairs with is F3's model (below) |
| F4 | An aggregator footprint (SnapEDA, Ultra Librarian, SamacSys) | Usually behind an account: a recorded link, not fetched by an agent |
| F5 | A generic generated pattern from package facts (`@tscircuit/footprinter`, IPC-7351 nominal) | Fine for chip passives and standard packages; `CIRCUIT_FOOTPRINT_FAMILY` already reports family matches |
| F6 | Hand-authored for this project from the data sheet | Only after the user agrees (§7); carries its verification record |

A project's explicit choice (`tscircuit/footprints.json`, or a pin in the
sources record) always wins over the order; the order decides what is chosen
when nobody has chosen.

**Body models, electrical parts on a board**

| Tier | Source | Notes |
| --- | --- | --- |
| M1 | The part's own UHD body artifact from the library, revision verified (`part-trust.ts` verified or official) | Whether the library made it (generated) or downloaded it, its interfaces are bound and checked |
| M2 | The model that **comes with the chosen footprint** (F2's or F3's model) | Placed by the footprint's own offset and rotation, so it sits right on the copper: the "model built around the footprint" of section 0 |
| M3 | The manufacturer's model, unpaired | Placed by the part's mounting frame |
| M4 | The part's UHD body artifact, unverified revision or project-local | |
| M5 | KiCad's standard 3D library (generic package) | CC-BY-SA 4.0 with the libraries exception: redistributable with attribution |
| M6 | A parametric body from UHD package facts (the provider's package box, ext-frame-cad's nominal fastener) | Deterministic, costs nothing; correct envelope, no detail |
| M7 | A body hand-modelled for this project from the drawing (ext-parts `part-cad` script) | Only after the user agrees (§7) |
| M8 | Placeholder (no body, or a box with no package facts) | Always reported |

M1 above M2 is deliberate: a verified library body is checked against the
part's facts and binds its interfaces, which the viewer and the CAD
extensions need. For the PCB views and KiCad export, a provider may prefer an
M2 model to a **generated** M1 body when the project asks for it (open
question Q2).

**Body models, mechanical parts** (motors, connectors on harnesses,
fasteners, structure): M1, then the manufacturer's STEP, then a distributor
or aggregator model, then a community model (KiCad 3D library, GrabCAD,
maker repositories with a licence), then M6, M7, M8. JLC/LCSC does not apply.

### 3.2 Where provenance lives

| Datum | Where | Why |
| --- | --- | --- |
| The body model as a file, its sha256, its licence, source URL, retrieval date, the sha256 of what was downloaded | The UHD artifact plus the envelope's `BlobRef` and `FileTerms` (library); the artifact plus `parts/evidence/<id>/terms.json` (project part) | Already tool-neutral UHD (§1.1); nothing new in UHD |
| How it was obtained (`download`, `generated`, `converted`, `easyeda-import`), who or what chose it, the tier, verification of placement | The terms record's record-only `provenance` (`protoboard.library-terms/v1`), extended (§3.3) | Protoboard data; never reaches the envelope |
| Footprints: the file, its source, C-number or URL, its pairing with a model, offset and rotation | A Protoboard **sources record** (§3.3), never the UHD definition | Footprints are tool knowledge (tool-integrations.md §1) |
| Which candidate a project uses per part or instance | The project's `parts/sources.json` | A project decision, committed |

UHD gains nothing. If a library later needs to carry footprint
files inside a revision, the protocol already allows carried files that the
definition does not reference (role `attachment`), with terms; the definition
still never names a footprint (open question Q5).

### 3.3 The sources record

One schema, `protoboard.part-sources/v0`, used in two places: served by the
library per part (`GET /v1/parts/:id/sources`, like offers, outside the
envelope and its digest), and kept by the project as `parts/sources.json`
(committed). An entry per file:

```jsonc
{
  "schema": "protoboard.part-sources/v0",
  "parts": {
    "ti-tps63802": {
      "files": [
        {
          "id": "lcsc-C2678052-fp",
          "kind": "footprint",               // footprint | model | symbol
          "format": "easyeda-json",          // kicad_mod | easyeda-json | step | wrl | glb
          "sha256": "…",
          "size": 18231,
          "source": {
            "type": "lcsc",                  // library | manufacturer | lcsc | aggregator | kicad-lib | generated | authored
            "id": "C2678052",                // C-number, library part@revision, KiCad lib:item
            "url": "https://…",
            "retrieved": "2026-10-21",
            "sourceSha256": "…",            // the bytes as downloaded, when converted
            "version": "…"                   // upstream revision when the source states one
          },
          "terms": { "distribution": "unknown", "summary": "…" },  // FileTerms
          "pairs": "lcsc-C2678052-step",     // the model aligned to this footprint
          "placement": { "offset": [0, 0, 0], "rotate": [0, 0, 0] },  // the source's own, for a paired model
          "tier": "F3",
          "verification": { "checked": "2026-10-21", "against": "package", "result": "pass", "by": "ext-tscircuit verifyEntry" },
          "chosenBy": { "kind": "agent", "who": "claude-code", "at": "2026-10-21T10:02:00Z", "approvedBy": "ada" },
          "path": "parts/files/ti-tps63802/C2678052.json"  // when committed (§4.2); absent when cache-only
        }
      ],
      "use": { "footprint": "lcsc-C2678052-fp", "model": "lcsc-C2678052-step" },  // the project's pins
      "instances": { "u3": { "footprint": "…" } }                                  // per-instance overrides
    }
  }
}
```

A catalog part's own artifacts are not copied into this record: the resolver
reads them from `parts/origins.json` and the vendored envelope terms. The
record holds what the project adds or chooses. `chosenBy.kind` is `person`,
`agent` or `default` (the resolver's order, nobody chose).

## 4. Cache and files

### 4.1 Per machine

A content-addressed store, shared by every project on the machine:

- `$XDG_CACHE_HOME/protoboard/files` (else `~/.cache/protoboard/files`),
  `~/Library/Caches/protoboard/files` on macOS,
  `%LOCALAPPDATA%\protoboard\Cache\files` on Windows.
- `sha256/<2 hex>/<62 hex>` holds the bytes; `index.json` maps a source key
  (`lcsc:C2678052#footprint`, a URL, `library:<part>@<rev>/<path>`) to the
  sha256 and the source record as fetched, with the fetch time.
- Nothing in it is authoritative: it can be deleted, and every file is
  fetched again from its recorded source and checked against the project's
  sha256. A file whose source now serves other bytes is not replaced
  silently (`PB_FILE_UPSTREAM_CHANGED`, §6).
- Credentials never go into it; account-gated sources are links only.

This is KiCad's global library and the PCM's managed folder in one: the
machine's copy, keyed by what it is rather than where it was installed.

### 4.2 Per project

- `parts/sources.json`: committed (§3.3).
- `parts/files/<short>/<file>`: committed copies of the sourced files the
  project uses whose terms allow it (redistributable, or the team's own
  work). `<short>` is `vendoredDirName(id)`, so paths stay within the path
  length budget. The sha256 in the record is the pin, as in origins.json.
- Files with `internal` or `unknown` terms are **not** committed by default:
  the record holds the reference and sha256, the bytes stay in the machine
  cache, and `protoboard parts files fetch` restores them on a clone
  (open question Q3: a private repository inside the organisation may want
  them committed).
- Catalog files stay where `parts add` puts them (`parts/catalog/<short>/`);
  this spec does not move them.
- Build outputs (`tscircuit/models/`, `kicad/3d/`, CAD job inputs) are copies
  made from the resolved files at build time; they name their source by
  sha256, not by the source path.

## 5. One resolver

### 5.1 The API

In `@protoboardai/core` (`part-files.ts`), used by every extension and by
`check`:

```ts
resolvePartFile(project, {
  part: string,                 // definition id
  instance?: string,            // for per-instance pins and series-passive MPNs
  kind: "footprint" | "model",
  formats: string[],            // what the caller can read, best first: ["step"], ["glb", "step"], ["kicad_mod", "easyeda-json"]
  purpose: "pcb" | "assembly" | "export",
  pairWith?: string,            // a footprint id: prefer the model that comes with it (M2)
  offline?: boolean,            // never fetch; report what is missing
}): {
  file?: string,                // absolute path of a local copy, in a format asked for
  sha256?: string,
  entry: SourceEntry,           // the record (§3.3), synthesised for a catalog artifact
  tier: string,                 // F1…F6, M1…M8
  placement?: { offset, rotate }, // for a paired model
  candidates: SourceEntry[],    // everything known, ranked, for `parts files` and the agent
  findings: ProjectDiagnostic[],// §6
}
```

Order of decision: the project's per-instance pin, the project's per-part
pin, the library's served choice, then the trust order (§3.1) over every
known candidate that is present locally or fetchable without an account. A
format conversion the resolver can do itself (STEP → GLB, already done
server-side for the viewer; EasyEDA JSON → `.kicad_mod` through the MIT
converter) produces a derived file recorded with `generatedFrom` and
`sourceSha256`.

The resolver never makes a model. M6 (parametric) bodies are made by the
provider that needs them, as today; M7 is a `cad` provider run by a person or
by an agent with approval.

### 5.2 Per extension

| Consumer | Asks for | Changes from today |
| --- | --- | --- |
| ext-tscircuit generate | footprint (`formats` the provider reads), model paired with it | The land-pattern table stays the provider's F1/F5 source; a sourced F2/F3 footprint becomes an entry converted by the provider and checked by `verifyEntry` like any other. `cadModel` points at `tscircuit/models/<short>-<sha8>.<ext>` |
| ext-tscircuit export (`board.glb`, `board.step`) | model, `purpose: "export"` | `chooseBodies` takes the resolver's result in place of its own artifact search; a paired model uses its source placement instead of the mount frame |
| KiCad export (`circuit:kicad`, `circuit:lock`) | footprint and model | `3d/<short>-<sha8>.step`, unique by content (the same bytes once, different bytes never share a name: the rule that prevents two bodies sharing one name); every reference `${KIPRJMOD}/3d/…`; footprints only in `<b>.pretty`; never a `${KICAD<n>_…}` variable or a global nickname. The `.wrl` is not needed (KiCad renders STEP). Embedding (`kicad-embed://`) is a later option (Q6) |
| ext-frame-cad, ext-harness-cad, ext-enclosure-cad | model, `formats: ["glb", "step"]`, `purpose: "assembly"` | Replace the per-extension `artifacts.find(format glb, role body)` with the resolver; a skipped body becomes a finding, not silence |
| Viewer bundle (`protoboard build`) | model, `["glb"]` | Unchanged for catalog parts; sourced models reach the viewer through the same artifact base |
| Release, system STEP | model, `purpose: "export"` | The release lists each part body with its tier and terms; files that may not leave the organisation are named |

### 5.3 Commands

The agent and the user use these, never a KiCad or tscircuit library tool:

| Command | Does |
| --- | --- |
| `protoboard parts files <part> [--instance <i>]` | Lists the candidates per kind with tier, source, terms, local or not, and which is used |
| `protoboard parts files find <part>` | Looks the part up at the sources that need no account (the library, LCSC by the placement's C-number from the offers, the maker's URL in its evidence) and records what it finds; fetches into the cache |
| `protoboard parts files use <part> --footprint <id> --model <id> [--instance <i>]` | Pins a choice in `parts/sources.json` with `chosenBy` |
| `protoboard parts files fetch` | Fills the machine cache for everything the project records; verifies sha256 |
| `protoboard parts files migrate` | §8 |

The LCSC C-number comes from the offers the project already holds
(`@protoboardai/core/offers`), so finding a JLC footprint needs no
search by the agent.

## 6. What `check` reports

Validator `protoboard/part-files`, run on every part placed on a board or in
an assembly. Severities rise to error in `protoboard release` where noted.

| Code | Severity | Finding |
| --- | --- | --- |
| `PB_FOOTPRINT_MISSING` | error | A board part has no footprint at any tier (the provider would stop on it) |
| `PB_MODEL_MISSING` | warning | No body model at any tier; the part is drawn as a placeholder (M8) |
| `PB_MODEL_PLACEHOLDER` | info (warning at release) | The body in use is M6 or M8 while the part states no better source |
| `PB_MODEL_SOURCE_AVAILABLE` | warning | A hand-modelled (M7) or placeholder body is in use while a higher tier is known (a paired JLC model, a maker STEP, a library body). The message names it and the `parts files use` command. This is the "do not reinvent" finding |
| `PB_FOOTPRINT_SOURCE_AVAILABLE` | warning | A hand-authored footprint (F6) is in use while an F1–F3 one is known |
| `PB_PART_FILE_UNRECORDED` | error | A footprint or model is used with no source record (a file copied in by hand, a model under `parts/local` without a terms entry) |
| `PB_PART_FILE_UNVERIFIED` | info | The file in use has not been checked against the part's facts (tiers F2–F4, M2–M5 without `verification`) |
| `PB_PART_FILE_MISMATCH` | error | A committed or cached file no longer matches its recorded sha256 |
| `PB_PART_FILE_NOT_CACHED` | warning | A recorded file is neither committed nor in this machine's cache; `parts files fetch` |
| `PB_FILE_UPSTREAM_CHANGED` | warning | The source now serves other bytes than the record pins; review, then `parts files use` the new one or keep the pin |
| `PB_PART_FILE_TERMS_UNKNOWN` | info (error in a release that leaves the organisation) | The file's distribution is `unknown` or `internal` |
| `PB_MODEL_FOOTPRINT_UNPAIRED` | info | The footprint and model come from different sources; placement is by the part's mounting frame, not the footprint's |
| `CIRCUIT_KICAD_MODEL_UNRESOLVED` | error | A `(model …)` in the KiCad project does not resolve under `${KIPRJMOD}`, or uses a path variable the project does not define |
| `CIRCUIT_KICAD_MODEL_NAME_CLASH` | error | Two different files would be written to one `3d/` name (two bodies under one name; cannot happen once names carry the sha256) |
| `CIRCUIT_KICAD_LIB_EXTERNAL` | warning | A footprint or symbol in the locked KiCad project refers to a library not in the project's tables (added by hand in KiCad) |

`PB_MISSING_ARTIFACT` and `PB_ARTIFACT_UNAVAILABLE` stay as they are for
artifacts generally; the codes above are about the file each consumer
resolves. The codes go into `ext-hardware`'s
`skills/system-compose/references/diagnostic-codes.md` and the circuit-board
skill's table.

## 7. The agent rule

**Rule.** An agent never makes a footprint or model while a source has one.
It reads `protoboard parts files <part>` first. When no source has one it
**asks the user** before drawing a land pattern or modelling a body, and
says what it would cost (the part, the drawing it would use, roughly how
long). Without an answer it leaves the part at M6 or M8 and moves on; `check`
keeps reporting it.

**Where the agent works.** In Protoboard: UHD parts, `parts/sources.json`
through `parts files`, provider configs, `protoboard run`. Not at the KiCad
or tscircuit library level: no `tsci import`, no `easyeda2kicad`, no edits to
`fp-lib-table` or `<b>.pretty`, no files copied into `tscircuit/models/` or
`kicad/3d/`. These are build outputs and are rewritten. The exception is work
Protoboard cannot do (SPICE models, a KiCad DRC investigation after lock,
per the `kicad-layout-review` skill), and the agent says it is stepping
outside.

**Where the guidance changes.**

| Place | Change |
| --- | --- |
| `packages/core/templates/_agents/common.md` (AGENTS.md) | The rule above in three lines: reuse sources, ask before modelling, work through `parts files` |
| `ext-parts` `uhd-part-research` §3 | Start with `parts files find`; add JLC/LCSC (by the C-number in the offers) after the maker, before aggregators; record what was found, do not model |
| `ext-parts` `uhd-part-author` | Replace "in a project, bind geometry generated from the drawing" with: bind the best sourced model (§3.1); generate (M7) only when none exists and the user agreed, and say so in the modelling notes |
| `ext-tscircuit` `circuit-board` | A part with no land pattern: `parts files find` first; a sourced footprint goes in through the resolver, not hand-copied into `footprints.json` |
| Evals (`packages/*/evals`) | A case where a JLC footprint and model exist for every part: pass only if the agent models nothing and makes no `part-cad` script |

## 8. Migration

- **Records for what exists.** `protoboard parts files migrate` writes
  `parts/sources.json` entries for the bodies projects already use, offline:
  catalog bodies as library (M1 or M4 by the revision's status); `part-cad`
  and `parts/local/<id>/<id>.py` bodies as M7, `chosenBy: default`;
  `tscircuit/models/box-*.step` as M6. Nothing moves and nothing is
  re-generated.
- **Then the findings.** `check` reports `PB_MODEL_SOURCE_AVAILABLE` where a
  better source exists once `parts files find` has been run. Replacing a
  hand-made body is the user's decision per part, not automatic: the
  interfaces bound to the old body need re-binding.
- **Examples** (the release rule: examples come up to every new stack and
  get a visual check). quadcopter-5in (13 local parts, one `part-cad`),
  smart-bottle (3 local parts, 3 generators), wearable-watch (4 local parts,
  5 generators) and uno-motor-bench (catalog only). For each: run migrate and
  find, switch board parts to F3/M2 where JLC has them, re-export KiCad
  previews (unique `3d/` names), capture the 3D and KiCad views. The
  examples' origins are still in the pre-0.1.7 layout; `parts migrate` comes
  first.
- **The library.** The cloud library's `terms.json` provenance gets the new
  method `easyeda-import` and the `tier`/`verification` fields; a script
  backfills `GET /v1/parts/:id/sources` for parts with an LCSC offer.
- **Locked boards.** A locked KiCad project is the layout of record
  (pcb-kicad-handoff.md); migration does not rewrite it. `check` reports
  `CIRCUIT_KICAD_MODEL_UNRESOLVED` and `CIRCUIT_KICAD_MODEL_NAME_CLASH` on it,
  and `circuit:lock --input refresh=true` after the user re-exports models.

## 9. Open questions

1. **Q1, JLC/LCSC terms.** EasyEDA's library terms for redistributing its
   footprints and models are not established. Proposal: record them as
   `unknown`, use them inside the organisation, keep them out of the
   library's redistributable view until someone reads the terms.
2. **Q2, generated library body vs paired JLC model on a PCB.** For a chip
   whose library body is generated (M1) and whose JLC model comes with the
   footprint in use (M2), should the PCB views prefer M2 by default? The
   proposal keeps M1 first and lets a project choose.
3. **Q3, committing `internal` files.** Projects in a private project
   repository are private to the team but delivered to clients. Commit internal and
   unknown-terms files there (simpler clones) or keep them cache-only
   (§4.2)?
4. **Q4, KiCad standard library.** The ext-tscircuit README says KiCad
   libraries are not fetched. May the resolver fetch single KiCad 3D models
   (M5) per project with their attribution, as the cloud library already
   carries 74 of them?
5. **Q5, footprints in the library.** Should the cloud library serve verified
   footprints (F1) per part through the sources endpoint only, or also carry
   them in revisions as attachments?
6. **Q6, KiCad embedded models.** For a locked board, `kicad-embed://`
   makes the KiCad files self-contained (no `3d/` folder to lose) at the cost
   of larger files and diffs. Keep `${KIPRJMOD}/3d/` (proposal) or embed?
7. **Q7, who may approve.** Is the person running the session enough to
   approve an M7/F6 model, or does it need a maintainer of the organisation?

## 10. Phases

| Phase | Scope | Done when |
| --- | --- | --- |
| P0 | This spec; the questions of §9 answered | Decisions recorded here |
| P1 | `parts/sources.json` schema; `resolvePartFile` over what is local (catalog artifacts, local parts, provider table, boxes); `check` codes of §6 that need no network; `parts files` list and `migrate`. KiCad `3d/` names by sha256 | Examples migrate; the KiCad preview of the smart-bottle board has one model file per distinct body; `check` reports the hand-made bodies |
| P2 | Machine cache; `parts files find|use|fetch`; LCSC/EasyEDA source by C-number from the offers; ext-tscircuit reads F3 footprints and M2 paired models through the resolver | A board of JLC parts exports to tscircuit and KiCad with every footprint and body from LCSC, none modelled |
| P3 | The CAD extensions and the viewer bundle on the resolver; release lists tiers and terms; cloud `GET /v1/parts/:id/sources` and the terms backfill | No extension looks up a body itself; a release names every placeholder |
| P4 | Skills and AGENTS.md (§7); the eval case | The eval passes: the agent models nothing when sources exist and asks when none do |
| P5 | Mechanical sources beyond the library (maker STEPs found by `find` for parts in `parts/local`), KiCad embedding if Q6 says so | |
