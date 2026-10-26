---
name: kicad-cli
description: Run KiCad 10's kicad-cli on a Protoboard board's KiCad project — DRC and ERC with JSON reports and exit codes, Gerbers and Excellon drill, position file, STEP and GLB, SVG and PDF plots, netlist, BOM, and file-format upgrade — and know where the results belong (a locked board's circuit:export writes out/ itself; manual runs go to a scratch folder). Also the fallback before lock: when circuit:generate or circuit:export fails, inspect the circuit:kicad preview with these commands while the model and tscircuit stay the truth. Use when checking or exporting from <board>/kicad/ or tscircuit/kicad/, or when circuit:export reports a kicad-cli failure.
---

# kicad-cli

```
locked board:   src/boards/<b>/kicad/<b>.kicad_pcb ── circuit:export ──▶ out/ (gerber/, pnp.csv, board.step, board.glb, *.svg, drc.json)
                                                  └── manual kicad-cli ─▶ a scratch folder (never out/)
before lock:    circuit:kicad ──▶ src/boards/<b>/tscircuit/kicad/ (a preview, rewritten each time) ── kicad-cli ─▶ scratch
```

`kicad-cli` is KiCad's command-line tool. The stack declares it as a tool
(`kicad-cli`, KiCad 10): `circuit:lock` and `circuit:kicad` need it, and
`circuit:export` of a locked board runs it. This skill is the reference for
running it by hand: to check a board, to look at a layer, or to see why an
export failed. The review itself is **kicad-layout-review**.

## Purpose

Give an agent the exact KiCad 10 commands, flags, exit codes and report
formats for a Protoboard board's KiCad project, and the rule for where their
output may go. Use it after lock for checks and inspection, and before lock as
a fallback when the tscircuit path fails.

## Inputs

| Input | Where |
| --- | --- |
| A locked board's project | `src/boards/<b>/kicad/<b>.kicad_pcb`, `<b>.kicad_sch`, `<b>.kicad_pro` |
| A preview project (any board) | `src/boards/<b>/tscircuit/kicad/`, written by `npx protoboard run circuit:kicad --module <b>` |
| KiCad 10 | `kicad-cli version` prints `10.x`; `npx protoboard doctor` shows the tool |

Flags change between KiCad versions (KiCad 10 dropped HPGL board plots, for
one). When in doubt, `kicad-cli <group> <command> --help` is the authority.
Spell help out as `--help`: in `pcb render`, `-h` means height.

## Steps

### 1. Checks

```bash
P=src/boards/<b>/kicad/<b>          # or src/boards/<b>/tscircuit/kicad/<b> for a preview
S=$(mktemp -d)

kicad-cli pcb drc --format json --units mm --severity-all \
  --schematic-parity --refill-zones --exit-code-violations \
  -o "$S/drc.json" "$P.kicad_pcb"

kicad-cli sch erc --format json --units mm --severity-all \
  --exit-code-violations -o "$S/erc.json" "$P.kicad_sch"
```

| Exit | Meaning |
| --- | --- |
| 0 | ran; no violations (or `--exit-code-violations` was not given) |
| 5 | ran; the report lists violations (only with `--exit-code-violations`) |
| 3 | the input file could not be loaded |
| 1 | bad arguments (an unknown flag or value); read stderr |
| other non-zero | another failure; read stderr |

Use `--format json` (the default `report` is text for people). The DRC report
(`$schema` `https://schemas.kicad.org/drc.v1.json`) has `kicad_version`,
`source`, `coordinate_units`, and three lists: `violations`,
`unconnected_items` and `schematic_parity`. The ERC report has the same header
and `sheets[]`, each with `path` and `violations`. Every entry has `type`,
`severity` (`error`, `warning`, `exclusion`), `description` and `items[]`
(each with `description`, `pos` {x, y} and `uuid`). Count by severity, group
by `type`, and name findings by the designator in the item description.

`--refill-zones` refills pours in memory before checking; adding
`--save-board` writes the refill into the board, which is an edit to the
layout of record: only when the person asks. `--schematic-parity` needs the
`.kicad_sch` beside the board under the same name.

### 2. Fabrication outputs

```bash
# Gerbers: always name the layers; with no --layers every layer is plotted (User, Margin, Courtyard too)
kicad-cli pcb export gerbers -o "$S/gerber/" \
  -l F.Cu,B.Cu,F.Paste,B.Paste,F.Silkscreen,B.Silkscreen,F.Mask,B.Mask,Edge.Cuts \
  --subtract-soldermask "$P.kicad_pcb"        # 4 layers: add In1.Cu,In2.Cu

# Drill, Excellon, mm, plated and non-plated in separate files, with a map
kicad-cli pcb export drill -o "$S/gerber/" --format excellon \
  --drill-origin absolute --excellon-units mm --excellon-zeros-format decimal \
  --excellon-separate-th --generate-map --map-format gerberx2 "$P.kicad_pcb"

# Position file (pick-and-place)
kicad-cli pcb export pos -o "$S/pos.csv" --format csv --units mm \
  --side both --exclude-dnp "$P.kicad_pcb"
```

Keep Gerbers, drill and position on the same origin: the commands above all
use the absolute origin. Add `--use-drill-file-origin` to the Gerbers and the
position file together, and `--drill-origin plot` to the drill, if a fab wants
the auxiliary origin. The position CSV columns are `Ref,Val,Package,PosX,PosY,Rot,Side`
(`Side` is `top` or `bottom`). The project's `out/pnp.csv` is not this file:
`circuit:export` re-keys it by UHD instance through `tscircuit/refdes.json`.

Before calling a board ready, look at every Gerber layer. The quickest way is
an SVG per layer of the board itself:

```bash
kicad-cli pcb export svg -o "$S/layers/" --mode-multi --page-size-mode 2 \
  --exclude-drawing-sheet -l F.Cu,B.Cu,F.Mask,B.Mask,F.Silkscreen,B.Silkscreen,Edge.Cuts "$P.kicad_pcb"
```

### 3. 3D, plots, netlist, BOM

```bash
kicad-cli pcb export step -o "$S/board.step" --force --subst-models --no-dnp "$P.kicad_pcb"
kicad-cli pcb export glb  -o "$S/board.glb"  --force --subst-models --no-dnp \
  --include-tracks --include-pads --include-zones --include-silkscreen --include-soldermask "$P.kicad_pcb"

kicad-cli pcb export svg -o "$S/pcb-top.svg" --mode-single --page-size-mode 2 \
  --exclude-drawing-sheet -l F.Cu,F.Mask,F.Silkscreen,Edge.Cuts "$P.kicad_pcb"
kicad-cli pcb export svg -o "$S/pcb-bottom.svg" --mode-single --mirror --page-size-mode 2 \
  --exclude-drawing-sheet -l B.Cu,B.Mask,B.Silkscreen,Edge.Cuts "$P.kicad_pcb"
kicad-cli pcb export pdf -o "$S/pcb.pdf" --mode-multipage -l F.Cu,B.Cu,Edge.Cuts "$P.kicad_pcb"

kicad-cli sch export svg -o "$S/sch/" --exclude-drawing-sheet "$P.kicad_sch"   # a folder: <b>.svg for the root sheet, <b>-<sheet>.svg for each sub-sheet
kicad-cli sch export pdf -o "$S/schematic.pdf" "$P.kicad_sch"

kicad-cli sch export netlist --format kicadxml -o "$S/netlist.xml" "$P.kicad_sch"   # or kicadsexpr (the default)

kicad-cli sch export bom -o "$S/bom.csv" \
  --fields 'Reference,Value,Footprint,MPN,Manufacturer,LCSC,UHD_Instance,${QUANTITY}' \
  --labels Refs,Value,Footprint,MPN,Manufacturer,LCSC,Instance,Qty \
  --group-by Value,Footprint,MPN --exclude-dnp "$P.kicad_sch"
```

STEP and GLB carry the part bodies the footprints link at
`${KIPRJMOD}/3d/<file>.step`; a body missing there shows as a bare footprint.
The KiCad BOM is for comparing with the model: the project's `out/bom.csv`
comes from the model, not from KiCad. `--preset` and `--format-preset` name
presets saved in the project; none are built in. `--include-excluded-from-bom`
does nothing in KiCad 10.

### 4. Upgrade

```bash
cp "$P.kicad_pcb" "$S/" && kicad-cli pcb upgrade "$S/<b>.kicad_pcb"
cp "$P.kicad_sch" "$S/" && kicad-cli sch upgrade "$S/<b>.kicad_sch"   # --force resaves even when already current
```

Lock already saves both files in KiCad 10's format. Upgrade by hand only to
read a file from an older KiCad, and on a copy.

## Decision points

**Before lock, as a fallback.** This is the fallback the **circuit-board** skill names.
When `circuit:generate` or `circuit:export` fails on an unlocked board, an
agent may run `npx protoboard run circuit:kicad --module <b>` and use the
commands above on `tscircuit/kicad/` to see what is wrong (DRC findings by
designator, a layer image, the netlist). The preview is rewritten every time
and is never the layout of record. The UHD model and the tscircuit build stay
the truth: fix the problem there (the module, `circuit.config.ts`,
`layout.json`, `footprints.json`, `board.tsx`, per **circuit-board**) and
generate again. Do not hand-edit the preview to get a board out.

If the person wants to finish the board in KiCad instead, that is a lock.
Locking is a human decision: explain what it changes (KiCad becomes the
layout of record; `circuit:generate` refuses without `--force`) and ask
before running `circuit:lock` or `circuit:unlock`.

## Outputs

- A locked board's `circuit:export` runs these commands itself and writes
  `out/`. Do not reproduce that by hand, and never write into `out/` or
  `kicad/` from a manual run.
- Manual runs write to a scratch folder outside the project, for example
  `S=$(mktemp -d)`, and nothing there is committed.
- `pcb upgrade` and `sch upgrade` rewrite their input file in place; run them
  on a copy unless the person asked for the project to be upgraded.

## Verification

```bash
kicad-cli version                                   # 10.x
npx protoboard check --format json                  # a locked board: CIRCUIT_LOCKED and no CIRCUIT_KICAD_* error
git status --short src/boards                       # a manual run left nothing in out/ or kicad/
```

## Failure handling

| Symptom | Do |
| --- | --- |
| `kicad-cli: command not found`, or `circuit:export` says it is missing | Install KiCad 10 (`npx protoboard doctor` names the tool); the locked board cannot export without it |
| `kicad-cli version` prints 9.x or older | Use KiCad 10; the project is saved in KiCad 10's format |
| Exit 3 | Wrong path, or a file KiCad cannot parse: `protoboard check` reports `CIRCUIT_KICAD_UNREADABLE`; restore from git |
| DRC exit 5 | Read `drc.json`; fix in KiCad (**kicad-layout-review**). `circuit:export` stops on a DRC error unless `--force` |
| `schematic_parity` entries | Run Update PCB from Schematic in KiCad; check reports `CIRCUIT_KICAD_PARITY` |
| A 3D body missing in STEP/GLB | The file under `kicad/3d/` is missing or the footprint's model path changed |
| `pcb export hpgl` | Not available in KiCad 10; use SVG or PDF |

## Hard rules

1. Manual output goes to a scratch folder; `out/` belongs to `circuit:export`
   and `kicad/` to the person editing the board.
2. No `--save-board` and no in-place `upgrade` of the board of record unless
   the person asked.
3. Before lock, the preview is for looking only; the model and tscircuit are
   the truth.
4. Ask before `circuit:lock`, `circuit:unlock` or `circuit:lock --input
   refresh=true`.
5. Nothing is uploaded or ordered.

Source: derived from KiStack (American-Embedded/kistack @ 8494dbd, MIT), rewritten.
