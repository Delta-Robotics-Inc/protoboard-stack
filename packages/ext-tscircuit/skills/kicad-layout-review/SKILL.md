---
name: kicad-layout-review
description: Review and finish a locked board's layout in KiCad 10 — placement, decoupling loops, return paths, clearances, silkscreen, courtyards, mounting holes, edge clearance, thermal relief and the fab's DFM rules — run DRC and ERC through kicad-cli and read their JSON reports, bring model changes in with Update PCB from Schematic without losing placement, then run protoboard check and act on every CIRCUIT_KICAD_* finding. Use after circuit:lock, when someone asks for a layout review of <board>/kicad/, or when check reports CIRCUIT_LOCKED or a CIRCUIT_KICAD_* code.
---

# KiCad layout review

```
UHD board module ── circuit:lock (a human decides) ──▶ <board dir>/kicad/<b>.kicad_pcb   (layout of record)
      ▲                                                        │  review, hand edits in KiCad
      │ model changes go here first                            ▼
      └──────────── check finds CIRCUIT_KICAD_* (handoff record vs model vs KiCad; nothing written back)
```

Once a board is locked, KiCad holds its layout and tscircuit does not. The
UHD board module still says what is on the board and how it is connected.
This skill is the review and finishing pass in KiCad, and the loop that keeps
KiCad and the model in agreement. Command details for every `kicad-cli` call
are in the **kicad-cli** skill; the lock itself is in **circuit-board** and the
spec `docs/specs/pcb-kicad-handoff.md`.

## Purpose

Get a locked board to the point where a fab would build it and it would work:
parts placed for short loops and clean returns, DRC clean against the fab's
own rules, silkscreen readable, mechanical features where the enclosure
expects them, and `protoboard check` free of `CIRCUIT_KICAD_*` errors. Use it
after `circuit:lock`, when asked to review a board in KiCad, and whenever
check reports a `CIRCUIT_KICAD_*` code.

## Inputs

| Input | Where |
| --- | --- |
| The KiCad project | `src/boards/<b>/kicad/`: `<b>.kicad_pro`, `<b>.kicad_pcb`, `<b>.kicad_sch`, `<b>.pretty/`, `<b>.kicad_sym`, `3d/` |
| The handoff record | `src/boards/<b>/kicad/handoff.json` (`state: "locked"`, `lockedAt`, the netlist as handed off) |
| Reference designators | `src/boards/<b>/tscircuit/refdes.json` (instance path to designator; kept across lock, unlock and re-lock) |
| The model | `src/boards/<b>/<b>.uhd.ts` and its parts' datasheets (decoupling tables, layout guidelines, thermal pad notes) |
| Enclosure constraints | `circuit.config.ts` (fixed placements, keep-outs, mounting holes) and **enclosure-cad** |
| The fab's capabilities | the fab's published minimums for track, space, drill, annular ring, mask web, silkscreen width, board-edge clearance |
| KiCad 10 | `kicad-cli version` prints 10.x; **kicad-cli** skill |

Every symbol and footprint carries `Reference`, `Value`, `Footprint`, `MPN`,
`Manufacturer`, `LCSC` (when the part has an LCSC offer), `UHD_Instance` and
`UHD_Part`. Use `UHD_Instance` to get from a designator back to the model.

## Steps

### 0. Before any edit: where the fix belongs

KiCad is the last place a board changes, not the first. Protoboard is the
orchestrator: the model owns the data and the build steps write the KiCad
project, so do not manage KiCad libraries, symbols or footprints by hand
unless the job needs something Protoboard cannot do (then say so first, as
the fallback rule in **circuit-board** asks). Before editing, say in one line
where each fix belongs, in this order (**circuit-board** step 0):

1. the UHD model (parts, connections, values, designators, MPN and LCSC
   fields, test pads);
2. the tscircuit stage (placement, widths, rules, keep-outs, land patterns,
   `circuit.config.ts`);
3. the stack (a converter or provider bug: a garbled schematic, mangled pin
   names, wrong silkscreen text; report it with the command and output, do
   not hand-patch the output);
4. KiCad: only the hand finish the stages above cannot produce (routing
   touch-ups, final placement nudges, silkscreen).

**A locked board is not fixed in place.** When a fix belongs at levels 1 to
3, propose unlocking and re-locking rather than editing KiCad, and say
plainly what that loses: `circuit:unlock` moves `kicad/` to
`kicad-archive/<stamp>/`, and the hand routing, placement and silkscreen work
done since `lockedAt` does not come back by itself. The person decides; ask.

**Mistakes and design choices.** List each finding as one or the other: a
mistake (a DRC violation, a wrong net, a value against the datasheet) is
fixed where it belongs; a design choice (where a part sits, a layer, a
trade-off made on purpose) is proposed, and you ask before changing it.

**Long work, small areas, the router.** Before a long pass (hand-routing many
nets, re-placing a section), say what it will do and roughly how long it
takes, and ask when it is optional. When the routing is poor, look for the
cause first (parts too close, rules that do not fit, a placement that forces
crossings) and propose that fix before routing by hand. Do not polish a small
area before asking whether it needs doing at all. Never make placeholder
footprints or 3D models from datasheets while the part's UHD artifacts or its
JLC/LCSC source has one; ask first when none does.

### 1. Confirm the state and who is editing

```bash
npx protoboard check --format json      # CIRCUIT_LOCKED (info) for the board; note every CIRCUIT_KICAD_* already present
```

Only one writer at a time. If the person has the board open in KiCad, do not
write `<b>.kicad_pcb` yourself: propose changes (designator, position,
rotation, side, the reason) and let them apply, or wait until they save and
close. Work on the files in `kicad/`; do not create a second board file
beside them.

### 2. Take a baseline

Run DRC and ERC into a scratch folder (never `out/`, never `kicad/`), as the
**kicad-cli** skill describes:

```bash
S=$(mktemp -d)
kicad-cli pcb drc --format json --severity-all --schematic-parity --refill-zones \
  --exit-code-violations -o "$S/drc.json" src/boards/<b>/kicad/<b>.kicad_pcb
kicad-cli sch erc --format json --severity-all --exit-code-violations \
  -o "$S/erc.json" src/boards/<b>/kicad/<b>.kicad_sch
```

Exit 0 means no violations, 5 means the report has some. Read the JSON rather
than the console text:

- DRC: `violations[]`, `unconnected_items[]`, `schematic_parity[]`. Each entry
  has `type` (for example `clearance`, `courtyards_overlap`,
  `copper_edge_clearance`, `silk_over_copper`), `severity`, `description`,
  and `items[]` with the object's `description`, `pos` (mm) and `uuid`.
- ERC: `sheets[].violations[]`, same entry shape.

Group by `type`, count by `severity`, and name each finding by designator so a
person can find it. `--refill-zones` refills pours in memory only; leave out
`--save-board` unless the person asked for the refill to be saved.

Also export the copper, mask and silkscreen layers as SVG into the same
scratch folder and look at them, top and bottom.

### 3. Review the layout

Work through each point and write down what you found, with the designator,
the datasheet section that supports the call, whether it is a mistake or a
design choice, and where its fix belongs (step 0).

| Area | What to check |
| --- | --- |
| Placement | Parts grouped by function; the MCU's crystal next to its pins; the regulator's input cap, inductor, output cap and feedback divider tight around it as its datasheet's layout example shows; sensitive analog away from switching nodes; parts aligned on a grid, same orientation in a group; nothing on the bottom unless the design calls for it. |
| Decoupling | Each decoupling capacitor at the pin it serves, smallest value nearest, with the via to ground beside its own pad so the loop (pin, cap, ground via, back) is as small as the board allows. A cap shared across the board is a finding. |
| Return paths | A continuous ground under every fast or sensitive trace; no split or slot in the plane under a signal that crosses it; stitching vias along pour edges and next to layer-change vias of fast signals; no copper islands left floating. |
| Clearances | Track, space and via sizes meet the net classes in `<b>.kicad_pro` and the fab's minimums; higher-voltage nets have the spacing their voltage needs. |
| Silkscreen | Every designator readable, not over pads or vias, not under a part body, one orientation or two at most; pin-1 and polarity marks visible after assembly. |
| Courtyards | No overlaps (`courtyards_overlap`); room for rework around fine-pitch parts and for the nozzle around tall parts. |
| Mounting holes | At the positions and diameters in `circuit.config.ts` (the enclosure is built around them); keep copper and parts out of the screw head's and standoff's footprint. |
| Edge clearance | Copper, pads and vias clear of `Edge.Cuts` by at least the fab's minimum (`copper_edge_clearance`); connectors that a cable mates sit at the edge with their mouth facing out, matching the frames **enclosure-cad** uses. |
| Thermal | Exposed pads have the via array and paste pattern the datasheet asks for; regulators and power parts have the copper area their dissipation needs; pours to through-hole pins use thermal relief so they can be soldered. |
| DFM | A second DRC with the fab's rules (step 4). Also acid traps, slivers in pours, annular ring on vias, mask web between fine-pitch pads, and fiducials if the assembler asks for them. |

Antenna keep-outs and fixed placements from `circuit.config.ts` still hold
after the move to KiCad; check them by eye, since KiCad's DRC does not know
the config.

### 4. DRC against the fab's rules

The rules exported at lock come from the config and are looser than a fab's.
Set the fab's minimums in Board Setup (constraints and net classes) or in a
custom rules file `<b>.kicad_dru`, then run DRC again. Record which rule set
and which fab the clean run was against.

### 5. Hand edits

Placement, routing, pours, silkscreen and stitching are KiCad edits and stay
in KiCad. After each meaningful edit, save, then:

```bash
npx protoboard check --format json
```

and act on what it reports (table below). Parts and connections are not KiCad
edits: a pin swap, a new test point, a fiducial, a different value or a
different package starts in the UHD board module, never only in KiCad.

A KiCad edit that a re-lock would lose and the stack cannot make yet (a logo,
a zone the provider does not draw, a silkscreen note) is recorded as a
post-lock step in the project's `docs/post-lock.md`: what, why, the exact
edit, and how to check it. It is applied from that list after every lock,
never left as a silent hand edit.

### 6. Bring a model change into KiCad

Nothing is written back to UHD and nothing is pushed into KiCad
automatically. When the model changes (a part added or removed, a land
pattern, a connection, a value or MPN):

1. Make the change in the UHD board module first (**circuit-board** step 1)
   and run `protoboard check`: it reports `CIRCUIT_KICAD_STALE`,
   `CIRCUIT_KICAD_MODEL_CHANGED` or `CIRCUIT_KICAD_FIELDS` with the diff.
2. Make the same change in the KiCad schematic: the symbol, its fields
   (`Reference` from `tscircuit/refdes.json`, `Value`, `Footprint` as
   `<b>:<entry>`, `MPN`, `Manufacturer`, `LCSC`, `UHD_Instance`, `UHD_Part`)
   and its connections.
3. In the PCB editor run **Tools > Update PCB from Schematic**. Symbols and
   footprints are linked by the symbol's UUID (the footprint's `path`), so
   leave the option that re-links footprints by reference designator off;
   existing footprints keep their positions and routing, and only new
   footprints arrive unplaced. Leave footprint deletion off unless the change
   removed a part, and replace footprints only when the land pattern changed.
4. Place and route what is new, run DRC, and run `protoboard check` again.
   The change should now show as `CIRCUIT_KICAD_APPLIED`.
5. Ask the person before recording it: `npx protoboard run circuit:lock
   --module <b> --input refresh=true` re-records the handoff from the model and
   the KiCad files as they are now.

If the change is large (many parts, a new outline, a re-layout of the
schematic, renamed pins), say so and propose unlocking, fixing it upstream
and re-locking instead. Say which KiCad work would be lost (step 0) and which
post-lock steps would be applied again. Unlocking is the person's decision.

## Decision points

| Decision | Rule |
| --- | --- |
| A model change since lock | Small (a part, a value, a connection): bring it into KiCad (step 6). Large (many parts, a new outline): propose unlock, fix upstream, re-lock, and say what KiCad work it loses; the person decides |
| A schematic that reads badly, pin names that are wrong, silkscreen text that is wrong | A converter or provider bug (level 3): report it; do not re-lay out or rename in KiCad, since a re-lock reproduces it |
| A KiCad edit that must survive a re-lock | A post-lock step in `docs/post-lock.md` (step 5) |
| A finding the fab's rules allow | Record the fab and the rule; leave it |
| A fixed placement or keep-out in the way | Ask; it changes only with `circuit.config.ts` |
| `CIRCUIT_KICAD_APPLIED` | Ask before `circuit:lock --input refresh=true` |

## Outputs

| Output | Where |
| --- | --- |
| The finished layout | `src/boards/<b>/kicad/` (committed) |
| Fabrication outputs | `src/boards/<b>/out/` from `circuit:export` (never by hand) |
| Reports | a scratch folder; the review's findings in your answer |

## Verification

```bash
npx protoboard check --format json   # CIRCUIT_LOCKED only: no CIRCUIT_KICAD_* error or warning
kicad-cli pcb drc --format json --severity-all --schematic-parity --exit-code-violations -o "$S/drc.json" src/boards/<b>/kicad/<b>.kicad_pcb   # exit 0 with the fab's rules
npx protoboard run circuit:export --module <b>   # drc.json in out/ is clean; export does not fail on DRC
```

Report what you reviewed, what you changed, which findings remain and why,
and which fab's rules the clean DRC used.

## Failure handling

What check reports on a locked board, and what to do:

| Code | Means | Do |
| --- | --- | --- |
| `CIRCUIT_LOCKED` (info) | KiCad is the layout of record since `lockedAt` | Nothing; review in KiCad, not in tscircuit |
| `CIRCUIT_KICAD_STALE` (error) | The model added or removed a part, changed a land pattern, the outline, holes, layers or thickness, and KiCad lacks it | Step 6, or propose unlocking |
| `CIRCUIT_KICAD_MODEL_CHANGED` | Connections between existing parts changed in the model | Rewire in the KiCad schematic, Update PCB from Schematic, reroute |
| `CIRCUIT_KICAD_FIELDS` | MPN, manufacturer, value or LCSC changed in the model | Update those fields on the symbol, then Update PCB from Schematic |
| `CIRCUIT_KICAD_APPLIED` (info) | The model change is in KiCad too | Ask, then `circuit:lock --input refresh=true` |
| `CIRCUIT_KICAD_PART_MISSING` (error) | A part was deleted in KiCad | Restore it (Update PCB from Schematic brings the footprint back); remove a part only in the model |
| `CIRCUIT_KICAD_PART_EXTRA` | KiCad has a part the model lacks | Add it to the model (a fiducial or test point belongs there) or delete it in KiCad |
| `CIRCUIT_KICAD_FOOTPRINT_CHANGED` | A footprint was swapped in KiCad | Put the handed-off footprint back, or change the land pattern in the model first |
| `CIRCUIT_KICAD_NET_RENAMED` | A net was renamed in KiCad, same pins | Restore the model's net name |
| `CIRCUIT_KICAD_NET_CHANGED` (error) | A pin is on another net in KiCad | Undo it in KiCad; if the new connection is right, change the model first |
| `CIRCUIT_KICAD_PARITY` | Schematic and board disagree | Update PCB from Schematic; the DRC `schematic_parity[]` list names the parts |
| `CIRCUIT_KICAD_UNREADABLE` (error) | A KiCad file is missing or does not parse | Restore it from git; re-save from KiCad 10 |

## Hard rules

1. The model is the truth for parts and connections. Make those changes in
   the UHD board module first; KiCad catches up by hand; nothing is written
   back to UHD.
2. Locking, unlocking and `refresh=true` are the person's decisions: ask
   before running any of them.
3. Never move a part the config fixes, never shrink a mounting hole or keep-out,
   without the person agreeing and the config changing with it.
4. Reports and test exports go to a scratch folder, never to `out/` or into
   `kicad/`.
5. One writer on `<b>.kicad_pcb` at a time.
6. Say where a fix belongs before editing (the model, the tscircuit stage, a
   stack bug, then KiCad). Never fix in KiCad what belongs upstream: propose
   unlock and re-lock, saying what would be lost.
7. A KiCad edit that must survive a re-lock is a documented post-lock step,
   never a silent hand edit.

Source: derived from KiStack (American-Embedded/kistack @ 8494dbd, MIT), rewritten.
