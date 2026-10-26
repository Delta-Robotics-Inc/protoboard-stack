# @protoboardai/ext-release

`protoboard release` and the Manufacturing Package
([releases, package, SOPs and evals](../../docs/specs/release-package-and-evals.md)
§1–§3). A release refuses a project that is not clean, then
writes everything needed to order, make, assemble and check the product to
`release/<version>/`, laid out by unit, with a manifest that a rebuild in a
clean environment reproduces byte for byte. It never orders, uploads or
prints anything, and never calls a service.

| Kind | Id | What |
| --- | --- | --- |
| Operation | `release` (export; tool `chrome`) | The package; inputs `version` (default: the root module's `version`), `allow-dirty`, `check` (preconditions only). `protoboard release [--version <v>] [--allow-dirty] [--check]` runs it. |
| Operations | `package:spec`, `package:bom`, `package:work-order`, `package:assembly`, `package:test-plan` (pure) | The release's own section content, from the model and the collected files: identity and interfaces with ratings; module breakdown and ordering list; ordering checklist, fabrication orders, operations and kitting; plain assembly steps when nothing richer is installed; the basic test plan |
| Skill | `release` | The SOP: choose units, clear the preconditions, release, inspect |
| Tool | `chrome` | Headless Chrome for the unit figures and the PDFs (@protoboardai/ext-docs' renderer) |

```ts
// protoboard.config.ts (or the default export of release.config.ts)
extensions: [..., "@protoboardai/ext-release"],
release: {
  units: ["stack", "quadcopter-5in-arm"], // instance paths or module ids; the root is always a unit
  build: 1,                                // products to build: ordering quantities × build
  spares: { fastener: { percent: 20, min: 4 } }, // by part id, tag or category; overrides the defaults
},
```

## The package

```
release/<version>/
  00-overview.pdf      the cover, then the product page (what it is, features, functions, requirements with how
                       each is shown, from docs/product.json), units, order of work, index of files, traceability appendix
  index.html           all of it, navigable by unit and by section (assets/ holds its figures and Kode Mono)
  manifest.json        protoboard.release/v0
  system/              the root unit: final assembly
    spec-sheet.pdf  bom.pdf  bom.csv  ordering-list.csv  work-order.pdf  assembly-guide.pdf  test-plan.pdf
    files/model/uhd-bundle.json      the released model (artifact bases relative to the project)
    files/firmware/…                 configurations other extensions contribute (ext-drone: betaflight-cli.txt)
  units/<unit>/        one per release.units entry, same layout (no ordering list)
    files/boards/<module>/           circuit: gerber/ (layers and drill), bom.csv, pnp.csv, board.step, board.glb
    files/mechanical/<module>/       cad: <module>.step and the process exports (<module>.stl, .3mf, .dxf)
    files/harnesses/<module>/        cad on a cable: routed <module>.step and .glb; cut-list.csv from the model
```

**Units.** An instance path makes that instance a unit (folder: the path with
`/` as `.`); a module id makes every instance of the module one unit, built
once per instance. Every other instance folds into the nearest unit above it.
A unit inside another is built first; the root (`system/`, final assembly) is
last. A unit named by path may not sit inside one build of a module unit that
is built several times (the builds would differ). Files of a custom module go
to every unit that builds it.

**Files** come only from the providers' standard outputs (`<module>/out/`),
never from native files, renamed as above. The cut list is derived from the
cable's UHD facts (`performance` kind cable, `cable_build`, the conductor
link between its ends); a cable the unit makes or cuts without a cad
provider gets `files/harnesses/<module>/cut-list.csv` too, and the work order
and test plan name a cut list only when the package holds it.

## Preconditions

Nothing is written unless all of these hold (`--check` reports them):

| Code | Rule |
| --- | --- |
| `REL_CHECK_ERRORS` | `protoboard check` has no errors. |
| `REL_STALE` | No provider finding ends in `_STALE` (warning or error). Every bound module has a recorded `<capability>:export` made with the current config file (digest) and provider, and, when the record has it, the current module (`capability.moduleDigest`, recorded by core since Stack 0.1). `out/` holds exactly the files that record lists, with its digests. Every file any operation record wrote is still the bytes its latest writer wrote (earlier packages under `release/` excepted: a release replaces its folder). |
| `REL_FRESHNESS_UNKNOWN` | No provider check was skipped: a skipped check cannot show its outputs are current. |
| `REL_NOT_EXPORTED` | Every bound module has standard outputs. |
| `REL_DIRTY` | In a git work tree, no uncommitted changes outside `release/` and `operations/` (`--allow-dirty` records them in the manifest instead). |
| `REL_UNIT_INVALID`, `REL_CONFIG_INVALID`, `REL_NO_VERSION` | The configuration resolves. |
| any error a section returns | e.g. ext-drone's `DRONE_CLI_STALE` when the flight-controller configuration no longer matches the model. |

## Section contract

An extension contributes to a section by declaring an operation
`package:<section>` (`spec`, `bom`, `work-order`, `assembly`, `test-plan`;
effect `pure`). The release calls it once per unit, the others in
configuration order and the release's own entry last (so its work order can
number what they contribute), and renders what it returns into that unit's
PDF and `index.html`, the release's own content first.

```ts
import type { SectionFn } from "@protoboardai/ext-release";

export const workOrder: SectionFn = ({ project, unit, units, release, files }) => {
  if (unit.kind !== "root") return undefined; // nothing for this unit
  return {
    title: "Flight controller configuration", // its own numbered part of the document; omit to join the main body
    order: 20,
    blocks: [
      { kind: "paragraph", text: "…" },
      { kind: "table", columns: [{ key: "item", label: "Item" }], rows: [{ item: "…" }] },
    ],
    // work order only: operations the release numbers with its own (OP 10, 20, …)
    operations: [{ stage: "configure", title: "Load the configuration", actions: ["…"], test: "…" }],
    files: [{ path: "files/firmware/betaflight-cli.txt", from: "firmware/betaflight/cli.txt", role: "firmware-config" }],
    diagnostics: [], // an error stops the release
  };
};
```

Blocks: `heading`, `paragraph` (`keep` holds it on the page of the next
block), `list`, `keyvalues`, `figures` (key figures), `table` (with `{ group
}` rows; `nowrap` columns), `note` (tip, caution, warning), `steps` (an id,
actions, parts with thumbnails and letters, a figure with callouts, a table,
tools, materials, torque, inspection, the test that follows, notes, trace),
`image` (with lettered `callouts`; `size: "small"`) and `kit` (a grid of
items with thumbnails). Files go under the unit folder (`files/…` for
manufacturing files; a unit-level data file such as `bom.csv`); a `from`
path is copied from the project, and the manifest traces it to the operation
record that wrote it. Types: `lib/types.ts`.

The context also carries:

- `figure(name, spec)`: renders an ext-docs `RenderSpec` (line art or
  shaded, from served GLB paths, `project/<path>`) with the release's Chrome
  into `assets/images/<name>.png` and returns its package path, size and
  anchor positions (for callouts). A name is rendered once per release; the
  same name with another spec is an error. Figures are rendered before the
  documents, one Chrome at a time.
- `contributors`: the extensions contributing to this section, so a
  baseline can step aside (the release's plain assembly steps give way to
  ext-docs' illustrated ones).
- `operations`: for the release's own work order, the operations the others
  returned. A `configure` operation (flash firmware, load a configuration)
  runs after the assembly steps, between the power-up checks and the rest of
  the bench test, and so before the steps that must follow the test.

`@protoboardai/ext-release/helpers` gives contributors what the release
knows: the custom modules a unit builds (`unitModules`, `providerModules`),
how many per build (`perBuild`), the files collected for one
(`moduleFiles`), its JSON standard outputs (`readOutput`), a GLB's size
(`glbBox`), the cut list and the bill of materials.
`@protoboardai/ext-release/testing` builds the units and contexts of a project
for a contributor's tests, recording figures instead of rendering them.

## Bills of materials (PK2)

- **`bom.csv` / `bom.pdf`** per unit: one build's module tree (sub-assembly →
  board → components), one row per instance with quantity per build and per
  product, make/buy, manufacturer, MPN, tier and origin. A board's components
  are its UHD children; the circuit provider's `out/bom.csv` is merged by its
  `instance` column for value, package and MPN where the model has none.
- **`system/ordering-list.csv`**: every item to obtain for the whole product,
  one line per part. Quantities come from the instance tree (independent of
  the units). `needed = per product × build`; `spares = max(ceil(needed ×
  percent / 100), min)` by the first matching rule: `release.spares[part id]`,
  `release.spares[tag or category]`, then the defaults: mechanical hardware
  (category `hardware` or tag `fastener`) 10 %, at least 2; components placed
  on a board 5 %, at least 2; nothing else. `order` rounds `needed + spares`
  up to whole packs (the offer's own, else the `pack_quantity` the model
  states) and the chosen offer's minimum, and goes up to a later price break
  where that costs less in all (`offer_flag` then says what the smaller
  order would have cost). Parts that ship with another (`included_with`) are listed with
  order 0; custom parts, boards and cables not included with a part are
  `fabricate` lines.
- **Offers, offline only**: catalog offers vendored by `protoboard parts
  offers` into `parts/offers.json` (`protoboard.offers/v0`), sourcing evidence
  in `parts/evidence/<id>/sourcing.json` (@protoboardai/ext-sourcing: price
  breaks, stock, lead time, lifecycle, alternates), and as a last resort a
  supplier listing the model cites (a `usage_note` starting "Supplier
  listing:"; where to buy, no price). Each catalog offer names the MPN it is
  for, so a series passive's values are priced by their own offers. A value
  with no offer for its own MPN stays unpriced; it is never priced by
  another value's offer.
- **One quote, the bill of materials'** (docs/specs/bom.md §3.8). A
  bought line is quoted by the model the bill of materials uses
  (ext-sourcing `quoteHeldLines`), so a release and `protoboard bom` agree
  on supplier and price for the same pieces: the offer a person chose for
  the line in `parts/bom.json` (flagged "chosen in the bill of materials"),
  else, in order, an offer with a price; not a full reel for fewer than a
  reel (that line stays unpriced and says so in `offer_flag`, the reel
  listed in `offer_alternatives`; a reel the quantity fills is quoted and
  flagged); stock that covers the order or is not stated; a current price
  before a stale one; the lowest cost of the order in dollars. Every price
  is in US dollars: `unit_price`, `currency` (`USD`) and `extended`. An
  offer in another currency is converted with the project's dated rate
  table (`parts/fx-rates.json`, else the Stack's) and marked:
  `supplier_unit_price`, `supplier_currency`, `fx_rate` and `fx_date` carry
  the supplier's own price and the rate, `offer_flag` says "converted from
  EUR at 1.1177 (2026-10-07)", and the PDF's price reads "(from EUR)". An
  offer in a currency the table lacks is not quoted. The cost estimate is
  the sum of the lines; its note names the currencies converted and the
  table's date, and it says how many bought lines are priced. `currency` in
  protoboard.config.ts no longer changes a release's quotes. The only
  difference from the bill of materials is the quantity: a release adds
  spares.

## Work order, assembly guide and test plan (PK3–PK5)

The three documents follow one sequence: the unit's assembly plan from
`@protoboardai/ext-docs/plan` (the doc spec's steps, then automatic ones,
scoped to the links the unit makes; a board's nets are its copper, not
steps). The release's own content:

- **Work order.** Ordering checklist from the ordering list (the whole
  product on the root, the unit's own items elsewhere), with supplier, lead
  time and minimum order where an offer or sourcing record states them and
  "unknown" otherwise. Fabrication orders, one line per made part, pointing
  at the provider's details below. Operations, numbered OP 10, 20, …: kit and
  incoming inspection (first-article ids), board assembly, cutting and
  preparing cables whose installed length is shorter than supplied, one
  operation per assembly step (parts, tools, materials, torque, an inspection
  point and the joint check that follows), then the bench test. With
  contributed `configure` operations the test is split around them: power-up
  checks (before power, power-up, rails, current), the configuration, then
  the checks that need firmware (programming, bus scans, smoke tests). Steps
  that must follow the test come next: a step that fits propellers, or one
  the doc spec marks `after: "test"` (the quadcopter's battery); then a final
  check with the functional checks on the finished product. A sub-unit with
  such a step gets a `REL_AFTER_TEST_IN_SUBUNIT` warning, since it is built
  before the product's own test. Kitting: what
  each operation consumes and where it comes from (ordering-list line,
  fabrication order, sub-unit folder, the part it ships with).
- **Assembly guide.** Contributed by ext-docs (illustrated steps); the
  release's plain steps only when no other extension contributes, from the
  same plan as the work order (its "Assembly guide step N" is step N). A part
  whose connectors ship loose (UHD `connector` trait `supplied: "loose"`, a
  shield's header strips) gets a soldering step first, with a solder-joint
  check. A mate the scene could not place (no geometry) lowers the
  component-side part onto the structure-side one (the shield onto the UNO).
- **Test plan** (basic v0.1, marked so). First-article inspection of each
  part designed in the project: overall size from its GLB, thickness, hole
  patterns from its bolt-pattern interfaces, seal glands, features present;
  boards bare and assembled; cables' length and conductor order. One joint
  check per assembly step. Bring-up of what the unit powers: before power,
  power-up current-limited (a battery's voltage in its place, a board's
  undriven edge nets, power inputs nothing in the unit feeds), each rail at
  its design voltage (board nets, regulated outputs of purchased modules),
  current against the model's supply budget (`supply_budget`) and
  `docs/power-budget.md` when the project has one, programming and boot on
  the reachable USB/SWD/JTAG ports, an I2C scan per controller with the
  addresses the parts state, and a smoke test per signal link. Functional
  checks, one per requirement of `docs/brief.md` (ID tables, requirement
  tables, top-level and requirement-section bullets), on the root; a
  table's How, Pass and Record columns give the check's method and
  criterion, otherwise they follow the requirement's wording. A rail that
  passes an input through (the same voltage range as one of the part's
  inputs) reads the supply's voltage. An input the model marks as left
  unconnected on purpose (UHD `ChildModuleRef.unconnected`, with a reason)
  gets no bench supply; when a rail can only read such an input (a motor
  shield's outputs with its motor terminal open), a "Temporary supply" check
  on that input comes first and those rails are measured with it on. The
  I2C scan lists every address a device answers at: its `i2c_address` and
  each `i2c_address_<name>` it states (a PCA9685's all-call 0x70). Project checks (`release.checks`) join
  the bring-up, numbered power-phase first. Records to
  capture, and `files/test/test-record.csv` with one row per check.
- **Builds that differ.** A unit named by module id is built once per
  instance from one plan. Where the instances differ in what their parent
  sets (`spin`, `overrides`), the plan names the value per build where a step
  depends on it (the propeller's hand by the motor's spin at each position),
  the work order and guide say how the builds differ, and a difference no
  step accounts for is a `REL_BUILDS_DIFFER` warning.
- **Counts.** A wiring step's actions and its joint check count the same
  thing: the conductors of the step's table (pin rows), in links.

Providers add their parts: ext-tscircuit the board fabrication and assembly
order, ext-frame-cad the cut order and its inspection, ext-enclosure-cad the
print order and the enclosure checks, ext-harness-cad cable preparation,
terminations and routing checks, ext-docs the spec sheet's designed parts
and the illustrated assembly guide, ext-drone the flight-controller
configuration and bench check.

## Reproducibility

The manifest holds no clock time and no machine path. The release date is
`SOURCE_DATE_EPOCH`, else the source commit's date. Chrome writes the print
time and its DOM node counter into each PDF; both are normalised (same
length, so the cross-reference table holds). Figures are rendered with
SwiftShader. The fonts the PDFs were printed with are listed with digests,
since other fonts give other bytes. Rebuilding a version replaces its folder.

## Tests

`test/release.test.ts` (from the repository root, `npm test`): requirements
read from a brief, test-id ranges, an earlier package not held against the
project, unit folding
and invalid entries; unit BOMs with the provider's BOM merged; ordering
quantities with spares, packs, MOQ, offers from both offline sources and
included parts; each precondition refusing (check errors, edited, extra and
missing outputs, a changed config, an earlier module, no export, uncommitted
changes); PDF normalisation; and, with Chrome, the package layout, files
from the standard outputs, the manifest, operations and test ids in
index.html, a CLI refusal, and two releases with identical bytes. The
fixture uses core's fake providers. Contributors test their parts with
`@protoboardai/ext-release/testing` (ext-docs, ext-frame-cad and
ext-harness-cad on the quadcopter, ext-enclosure-cad on a written build
report, ext-tscircuit with the IMU tile board, which also exercises the
release's bring-up checks for a custom board).
