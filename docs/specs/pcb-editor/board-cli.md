# Board CLI and MCP tools (PCB editor, Phase 1)

Every board operation runs without a window: through `protoboard board …`, through the MCP
tools an agent sees, or through the board service's wire protocol. The board core is
specified in [phase1-board-core.md](phase1-board-core.md); this page is the command reference.
The examples use the synthetic Airnode C3 board (`packages/board/test/fixtures/airnode-c3/`)
copied into a project at `airnode/board` (a folder holding `board.jsonl`, under a folder with
`protoboard.config.ts`).

## How a command reaches the board

- When `protoboard board serve` runs for the board, its `service.json`
  (`.protoboard/local/board/<board key>/service.json`: `pid`, `port`, `token`, `epoch`) names
  the live service, and every other command is a client of it.
- With no live service, a command opens the board itself for that one call, saves what it
  changed, and closes it. Undo history, leases and presence live only in a running service.
- Lengths are integer nanometers (a number with `mm`, such as `1.5mm`, is converted), angles
  integer millidegrees, +Y up, origin at the board center.
- Text for people by default; `--json` (or `--format json`) on every command.
- Exit codes: `0` applied (or valid in a dry run), `1` invalid (for `check`: errors found; for
  `route`: nothing proposed), `3` refused, `2` a usage error or a failure.

### Who acts

`--as human` (a person; the default in a person's terminal) or `--as agent:<name>`. When the
CLI runs under an agent (`PROTOBOARD_AGENT=<name>`, or an agent host's own environment marker)
it acts as that agent, and `--as human` is refused: an agent never passes itself off as a
person. The MCP tools take no actor at all and always act as `agent:<client name>`. A person's
copper is locked by default; locked objects and net changes are refused for agents.

## Commands

### serve

Example outputs below were captured from runs on this sample; epochs, ports, pids and batch ids
change per run.

```
$ protoboard board serve airnode/board
serving <project>/airnode/board
  ws://127.0.0.1:53994/  pid 26924  epoch 5kblnh
  service.json: <project>/.protoboard/local/board/board/service.json
  Ctrl+C or `protoboard board stop` saves the board and stops; nothing is saved until `board save`, `board checkpoint` or the stop
```

`--port <n>` (default: a free port), `--origin <origin>` (a browser origin allowed to connect,
such as the dev server's; repeatable), `--autosave` (save 2 s after the last change),
`--recover` (replay journal entries of an earlier session that never reached the files).
`--json` prints one line when serving and one when stopped.

### stop

```
$ protoboard board stop airnode/board
stopped the board service (pid 26924); it saved the board
```

### inspect

```
$ protoboard board inspect airnode/board
Airnode C3  <project>/airnode/board
  version: seq 0, epoch 952n36 (opened here; no service running)
  board: 2 copper layers, 1.6 mm thick
  layers: top_mask (soldermask), top (copper), core1 (dielectric), bottom (copper), bottom_mask (soldermask)
  objects: 19 footprints, 87 pads, 10 tracks, 3 vias, 1 zone, 1 keepout, 1 graphic, 1 text, 0 cutouts
  nets: 15 from a fixture netlist
    +3V3           power    9 pads, 2 tracks, 0 vias, 0 zones
    …
  rules: 9
    rule:floor.clearance           floor   clearance min 0.127 mm
    …
  locked: fp:usb/connector, trk:f.vbus.1, trk:f.vbus.2
  leases: none
```

### query

Exactly one of `--id <id>[,<id>…]`, `--net <name>`, `--region x1,y1,x2,y2`, `--point x,y`
(`--tolerance`), or a query file (`{ "by": "id" | "net" | "region" | "at", … }`). `--layers`
and `--kinds` narrow a region or point; `--records` adds the stored records and versions (by
id they always come). The answer is JSON; a missing id exits 1.

```
$ protoboard board query airnode/board --point -10mm,-3mm --kinds footprint
{
  "epoch": "aq69ou",
  "seq": 2,
  "items": [
    {
      "id": "fp:power/ldo",
      "kind": "footprint",
      "box": { "minX": -11800000, "minY": -4750000, "maxX": -8200000, "maxY": -1250000 },
      "layers": ["top", "top_silkscreen", "top_courtyard"]
    }
  ]
}
```

### ops

```
$ protoboard board ops
footprint.move  Move footprints
    Translate footprints by dx, dy (nanometers). …
    example: {"op":"footprint.move","ids":["fp:power/ldo"],"dx":500000,"dy":0,"tracks":"stay"}
…
```

`--json` adds every input's JSON Schema; `--all` adds the system operations (hosts and undo
only, never open to the CLI's `apply` or MCP).

### apply

The file holds a transaction (`{ batchId, label, ops, expectSeq?, … }`), a list of ops, or one
op; `-` (or no file) reads stdin. `--dry-run`, `--label`, `--batch-id`, `--change-set
<id>[:<title>]`, `--expect-seq`, `--expect-epoch`, `--lease <token>` fill or override the
envelope. A resent batch id returns its first reply.

```
$ cat move.json
{ "batchId": "e2e-move-1", "label": "move the LDO 1 mm right", "ops": [ { "op": "footprint.move", "ids": ["fp:power/ldo"], "dx": 1000000, "dy": 0, "tracks": "stay" } ] }
$ protoboard board apply airnode/board move.json
APPLIED  seq 1, epoch 5kblnh, batch e2e-move-1
  changed: fp:power/ldo
$ cat track.json
{ "batchId": "e2e-track-1", "label": "add a 3V3 segment", "ops": [ { "op": "track.add", "segments": [ { "handle": "t1", "net": "+3V3", "layer": "top", "width": 400000, "start": { "x": -9950000, "y": -1800000 }, "end": { "x": -9950000, "y": 0 } } ] } ] }
$ protoboard board apply airnode/board track.json
APPLIED  seq 2, epoch 5kblnh, batch e2e-track-1
  changed: trk:5kblnh.1
  created: t1 -> trk:5kblnh.1
$ protoboard board apply airnode/board move.json --batch-id e2e-stale --expect-seq 0
REFUSED  stale-seq: the board is at seq 2; you read seq 0
  missed seq 1 by agent:claude-code: fp:power/ldo
  missed seq 2 by agent:claude-code: trk:5kblnh.1
```

### undo and redo

```
$ protoboard board undo airnode/board
APPLIED  seq 3, epoch 5kblnh, batch cli-4e1eb4a08c17
  changed: trk:5kblnh.1
  removed: trk:5kblnh.1
$ protoboard board redo airnode/board --as agent:placer
REFUSED  nothing-to-redo: nothing of yours is left to redo (a new change of yours clears redo)
```

Each undoes or redoes only the acting actor's own transactions.

### revert

```
$ protoboard board apply airnode/board m.json --as agent:placer --change-set "tidy-power:Tidy the power section"
APPLIED  seq 1, epoch aq69ou, batch cli-9c0ff506153a
  changed: fp:power/ldo
$ protoboard board revert airnode/board tidy-power --as agent:placer
APPLIED  seq 2, epoch aq69ou, batch cli-5c0f5388704b
  changed: fp:power/ldo
```

Undoes a whole change set, newest first, all or nothing.

### claim, release and presence

Leases need a running service.

```
$ protoboard board claim airnode/board --as agent:placer --purpose "tidy the power section" --roots power
GRANTED  lease lease-1, token 1, until 2026-11-09T09:45:14.231Z
  pass --lease 1 with your writes
$ protoboard board presence airnode/board
seq 1, epoch aq69ou
  lease lease-1 by agent:placer: root power until 2026-11-09T09:45:14.231Z
  intent of agent:placer (from its lease): "tidy the power section"
$ protoboard board release airnode/board --as agent:placer
released lease-1 (tidy the power section)
```

`claim` also takes `--nets`, `--region x1,y1,x2,y2` with `--layers`, `--ttl <ms>`, or a claim
file. A person's edit inside a lease revokes it.

### save

```
$ protoboard board save airnode/board
saved placement at seq 3
files 4e1611020a86733c
```

Only changed files are written; a file changed on disk by someone else is refused (exit 3).

### checkpoint

```
$ protoboard board checkpoint airnode/board "nudge the LDO"
no file changed at seq 3

Commit message (Protoboard does not commit; run git yourself):

nudge the LDO

- other edits (agent claude-code): 3 transaction(s)

Board seq 1 to 3, epoch 5kblnh.
```

### import, check, render and describe

These use the importer, checks, scene and renderer packages; when one is not installed the
command prints `not available` (exit 2). The examples import the synthetic Airnode C3 KiCad
board (`packages/ext-tscircuit/test/fixtures/pcb-regression/airnode-c3/airnode-c3.kicad_pcb`)
into a project at `airnode/board`.

#### import

```
$ protoboard board import airnode-c3.kicad_pcb airnode/board
WRITTEN  kicad: <project>/airnode-c3.kicad_pcb -> <project>/airnode/board
  board: 20 footprints, 123 pads, 0 tracks (0 arcs), 0 vias, 0 zones, 0 keep-outs, 15 nets, 0 net classes, 7 rules
  files: board, placement, copper, zones, graphics, rules
  zone fill: none in the source (kicad) -> <project>/.protoboard/build/board/airnode__board/zone-fill.json
  offset: a board point plus (100 mm, -100 mm) is the source point (+Y up)
  import record: <project>/.protoboard/build/board/airnode__board/import.json
  report: 3 dropped (55 objects), 0 approximated, 11 info line(s); --json lists every line
  DROPPED 5 3D model reference: 3D models are not modeled by the board document (line 743, …)
  …
  took 31 ms to import, 138 ms in all
```

The importer is the first installed one whose `accepts` takes the source (KiCad `.kicad_pcb`,
with the `.kicad_pro` and `.kicad_dru` beside it; Circuit JSON; EasyEDA Pro when
`board-import-easyeda` is installed); `--kind` names the format when the file name does not.
A whole board needs an empty or new folder: the command writes the board files and the
netlist, the source's own zone fill (`zone-fill.json`) and the import record (`import.json`,
which says where the board came from and how it was shifted, for `check`'s KiCad
cross-check), both derived data under `.protoboard/build/board/<board key>/`. The report
counts its lines by level (and the objects they stand for) and prints every dropped and
approximated line; `--json` adds every line, the stats, the offset, the rules the board cannot
express (`rulesNotEvaluated`) and the timing. An importer that gives operations instead has
them applied to the board there as host actor `import:<importer>`.

#### check

```
$ protoboard board check airnode/board
ERROR   unconnected  Net SDA is not connected between pad:R4:1 at (5.175, 11.000) mm on top and pad:U1:18 at (-11.500, -1.400) mm on top, 20.7801 mm apart.  [pad:R4:1, pad:U1:18] at -3.1625 mm, 4.8 mm on top  (f:unconnected:fd0fa31c51ac)
…
NOT RUN clearance: no enabled clearance rule on the board
CAVEAT  clearance not checked: no enabled clearance rule on the board
NOTE    20 silkscreen text(s) are checked as their boxes (0.6 of the height per character); the board files hold no font outlines.
zone fill: kicad, 0 entries, 0 polygons, current (<project>/.protoboard/build/board/airnode__board/zone-fill.json)
ours:  75 unconnected, 0 errors, 0 warnings (incomplete: see caveats)  (seq 0, checks 20 ms)
like with like: ours 75 unconnected, 0 errors, 0 warnings; KiCad 75 unconnected, 0 errors, 0 warnings  (KiCad 10.0.5, 4173 ms)
apart: ours only 0, KiCad only 38, not evaluated 0 rule(s) with 0 KiCad item(s) under them, folded 0
KiCad raw: 75 unconnected, 0 errors, 38 warnings
KiCad cross-check (KiCad 10.0.5, kicad-cli pcb drc --format json --severity-all --all-track-errors --units mm)
  …
differences (3):
  - kicad:lib_footprint_issues: KiCad only, 0 error(s) and 20 warning(s); Protoboard does not check this
  - …
```

The checks run on the board with its cached zone fill (the same analysis the layout screen
and the dev servers show). Each finding prints with its id (for `describe --finding`), then
the checks that did not run, those that ran on a built-in default, the caveats, the model's
approximations, the zone fill used, and the status line. When the import record names a KiCad
file (or `--kicad <file>` names one) and kicad-cli is installed (`PROTOBOARD_KICAD_CLI`, on
`PATH`, or KiCad's install folder), KiCad's DRC runs on that file and the comparison prints like
with like: the comparable counts (the categories both tools check, KiCad's items counted once)
on both sides, then apart from them what only we check, what only KiCad checks, the source's
rules the import could not express (KiCad's items under them count nowhere; the import record
keeps the list) and the findings folded on objects the source gives one identity, then KiCad's
raw totals and every difference named; otherwise a line says why no cross-check ran.
`--kicad-root <folder>` is the folder kicad-cli's run copies (default: the KiCad file's
folder), `--no-cross-check` skips KiCad. Exit 1 when any finding is an error (unconnected
items included). `--json` gives the findings, the summary, connectivity counts, the
cross-check (our findings by id, KiCad's entries in full), the fill state, the import record
and the timings.

#### render

```
$ protoboard board render airnode/board --net GND --out airnode.png
wrote <project>/airnode.png (1200 x 900 px, seq 0)
  drawn: 75 finding marker(s), 75 ratsnest line(s), 0 fill entries (kicad)
  checks: 75 unconnected, 0 errors, 0 warnings (incomplete: see caveats)
```

A PNG as the layout screen draws it, through headless Chrome (it needs a Chrome-family
browser; without one it prints `not available`), with the board's zone fill and the checks'
ratsnest and finding markers. `--region x1,y1,x2,y2` (nanometers, or numbers with `mm`),
`--layers <preset>` (`all`, `routing`, `top`, `fab`) or layer panel rows
(`cu:top,silk:top,pads`), `--flip` (from the bottom), `--net <name>[,<name>…]` (highlighted),
`--width` and `--height` (pixels; 1200 by 900 by default). It writes `render.png` under
`.protoboard/build/board/<board key>/` unless `--out` names a file.

#### describe

```
$ protoboard board describe airnode/board --net GND
wrote <project>/.protoboard/build/board/airnode__board/describe-net-GND.json (39604 characters, about 13202 tokens)
wrote <project>/.protoboard/build/board/airnode__board/describe-net-GND.png (1260 x 1090 px, about 1832 image tokens)
  scene: region detail, focus net GND; connectivity from the board checks
  checks: 75 unconnected, 0 errors, 0 warnings (incomplete: see caveats)
  the scene itself: add --json (it prints the scene with these paths)
```

The agent scene (`@protoboardai/board-scene`): compact JSON for an agent and a PNG whose
marker numbers match it, with the checks' connectivity and findings. At most one focus:
`--region x1,y1,x2,y2` (millimeters, as the scene takes), `--net <name>`, `--object <id>`, or
`--finding <id>` (from `check`); none describes the whole board. The files go to
`.protoboard/build/board/<board key>/describe-<focus>.json` and `.png`, or to `--out <base>`
(`.json`, `.png`, `.svg` added). `--image png` (default), `svg`, `both` or `none`.

Without `--json` it prints where the files are and what they cost, for a person. With
`--json` it prints the scene itself beside the paths, which is what an agent wants from one
call (the image is read from its file, or returned by the MCP tool):

```json
{
  "status": "written", "epoch": "ule888", "seq": 0,
  "focus": { "net": "GND" },
  "files": { "json": "<…>/describe-net-GND.json", "png": "<…>/describe-net-GND.png" },
  "stats": { "jsonChars": 39604, "estTokens": 13202, "imageWidth": 1260, "imageHeight": 1090, "estImageTokens": 1832 },
  "checks": { "line": "75 unconnected, 0 errors, 0 warnings (incomplete: see caveats)", "unconnected": 75, "errors": 0, "warnings": 0, "incomplete": true },
  "fill": { "source": "kicad", "current": true },
  "scene": {
    "schema": "protoboard.board-scene/v1", "detail": "region",
    "board": { "name": "airnode-c3", "box": [-20, -15, 20, 15], "copper": ["top", "bottom"], … },
    "view": { "box": [-19.8, -14.225, 14.676, 15.475], "layers": ["top", "bottom"], "filters": { "nets": ["GND"], … } },
    "counts": { "footprints": 20, "pads": 123, "missingLinks": 75, "findings": 75, … },
    "connectivity": "from the board checks",
    "nets": [{ "name": "GND", "pads": 45, "status": "unrouted", "missing": 44, "islands": 45 }],
    "rats": [{ "id": "rat:GND:1", "net": "GND", "from": ["pad:C1:2", 11.413, -9], "to": ["pad:U2:2", 6, -10.3], "len": 5.57 }, …],
    "footprints": [{ "id": "fp:C1", "ref": "C1", "at": [10.5, -9], "pads": [["1", 9.588, -9, "VBUS"], ["2", 11.413, -9, "GND"]], "near": { "left": ["U2", 1.02] }, … }, …],
    …
  }
}
```

### import-dxf (Phase 2)

```
$ protoboard board import-dxf airnode/board outline.dxf
APPLIED  seq 1, epoch r8km1t, batch cli-a5a31e099bfb (no running service: opened here and saved)
  changed: cutout:dxf.1, outline
  read: 2 entities in mm, 2 closed loop(s), 0 open chain(s)
  outline: 4 vertices, 1500 mm²; cutouts: 1
  SKIPPED 1 TEXT: not an outline entity (LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE are read)
```

Reads the drawing and applies one `outline.import_dxf` operation (its `dxf` input is the file's
text): LINE, ARC, CIRCLE, LWPOLYLINE and POLYLINE are read, ends within the tolerance join into
closed loops, the largest loop becomes the outline (centered on the origin) and the loops inside it
replace the board's cutouts. `--units mm|in|auto` (default `auto`: the file's `$INSUNITS`, else
mm), `--layers a,b` (DXF layer names; default all), `--tolerance <length>` (nanometers, or a number
with `mm`; default 10000 nm), `--as`. Prints the reply and the operation's report: entities, loops,
the outline (vertices, area), cutouts, what was skipped and why, open chains, and the units used.
`--json` gives the reply with `report` and `file`. A drawing with no closed loop, or an outline
driven by CAD, is `invalid` (exit 1). CHANGES FILES.

### route and diagnose (Phase 2)

These use the autorouter (`@protoboardai/board-route`) through the layout screen's host module
(`@protoboardai/views/pcb/host`); when either is not installed the command prints `not available`
(exit 2). The routers run in the product's order: the tscircuit autorouter first, Freerouting (when
installed) as the fallback. Every candidate is scored by the board checks (open connections, then
errors, then vias, then track length).

#### route

```
$ protoboard board route airnode/board
PROPOSED  (nothing changed; --apply applies it)  run-d6c85ca9040d, seq 0, epoch awozfx
  current:   42 open, 11 errors, 3 vias, 67.1557 mm of track
  candidate: 24 open, 11 errors, 7 vias, 261.5392 mm of track
  scope: every open net; 14 net(s) to route; budget 60 s per router; scored by board checks
  stages:
    1. tscircuit 0.0.953  complete, not kept (worse than the board it started from: errors rise from 11 to 48)  14 net(s), 270 segment(s), 18 via(s), 52377 ms
    2. freerouting 2.4.1  partial, kept  14 net(s), 89 segment(s), 4 via(s), 65261 ms
  FALLBACK: tscircuit (tscircuit autorouter) ran first; freerouting (Freerouting (installed separately)) ran as the fallback
    because tscircuit: worse than the board it started from: errors rise from 11 to 48
  copper added: 89 segment(s), 4 via(s), 194.3835 mm
  locked copper: no router changed any of the 3 locked record(s)
  still open: BOOT, CC1, CC2, EN, I2C_SCL, USB_DP, VBUS (`protoboard board diagnose <dir> <net>` says why)
  unexpressed (checked after the run, not given to a router):
    - edge clearance 0.3 mm: passed as a router setting; checked after
    - locked copper: the autorouter has no lock flag; locked copper is an obstacle and is verified after the run
    - …
  note: left to their pours (a zone of the net exists): GND
```

Runs the orchestrator on a snapshot of the board and prints the scored proposal: the status
(`proposed`, `rejected`, `unchanged`, `failed`, `cancelled`) and its reasons, the current and
candidate scores, each router stage (router, version, status, whether its copper was kept and why
not, duration), the fallback when one ran, the copper added, the locked-copper check, the nets
still open, and what the routers could not express. Scope: every net with open connections, or
`--nets a,b`, or `--region x1,y1,x2,y2` (nanometers, or numbers with `mm`; the open connections
inside that rectangle). `--budget <seconds>` is the wall clock per router run (default 60).

It changes nothing unless `--apply` is given. With `--apply` and status `proposed`, each step's
transaction is applied as its router (`router:<id>`, never as the caller), through the running
service or the board opened for the call, stopping at the first refusal; afterwards every locked
record is compared byte for byte with the snapshot the run started from (`N locked records verified
unchanged`, or the changed ids named). A proposal that is not `proposed` is never applied: a result
worse than the board is never offered. `--as` names who asked (reported as `applied.by`).
`--json` gives the whole report, with the steps (actor, batch id, label, operation count) and, after
`--apply`, every step's reply.

Exit codes: `0` proposed (or applied, with the locks verified), `1` not proposed (rejected,
unchanged, failed or cancelled; nothing applied), `3` a step was refused on apply (the steps after
it were not applied), `2` a usage error, not available, or a locked record changed after applying.

#### diagnose

```
$ protoboard board diagnose airnode/board USB_DP
USB_DP: PLACEMENT  (seq 0, epoch vzpsiw; nothing changed)
  Placement: the probe routed USB_DP only by breaking the floor clearance (20 pairs); move parts or a no-go area
  attempts (every rule as it is):
    tscircuit  complete (worse than the board it started from: errors rise from 11 to 29)  0 segment(s), 0 via(s), 6428 ms
    freerouting  partial (no copper (partial))  0 segment(s), 0 via(s), 34139 ms
  probe (the fab floor and no-go areas only): tscircuit routed the net, 35.6144 mm, 0 via(s), 20 pair(s) under the floor clearance, 13670 ms
  what blocks it:
    target  rule:target.clearance: clearance plan 0.2 mm (rule:target.clearance); above the floor 0.127 mm
    target  rule:target.track_width: track width plan 0.25 mm (rule:target.track_width); above the floor 0.127 mm
    no_go   kpo:f.antenna: antenna clearance; a wall for pours, tracks, vias on top, bottom
    policy  rule:policy.via_under_module: a cost (5) in its region
    floor   fab floor: clearance 0.127 mm, width 0.127 mm; never relaxed
  rule areas by tier:
    floor: none
    no_go: kpo:f.antenna (antenna clearance) blocks pours, tracks, vias
    target: none
    policy: rule:policy.via_under_module blocks via_under_footprint
  relaxations (test-run on copies; none applied):
    Plan USB_DP at the floor clearance: a target rule for this net only: 0.2 mm to 0.127 mm
      -> did not route: 41 open, 29 error(s), 0 via(s), 35.3782 mm, 18 new finding(s), 13046 ms (errors rise from 11 to 29)
    …
```

Why one net does not route: the verdict (`routes as is`; `rules, not placement`: with only the
fab floor and no-go areas it routes within the floor clearance; `placement`: even then it does
not, so the parts or a no-go area block it), the summary sentence, the attempts with every rule,
the probe with the fab floor and no-go areas only, what blocks it, the rule areas by tier, and the
relaxations (target rules for this net only; the floor is never relaxed) with their test-run
results on copies of the board. `--budget <seconds>` per router run (default 30). It changes
nothing: a relaxation takes effect only when its rules are applied (`board apply` with `rule.set`).
Exit `0` when the diagnosis ran, `2` for a usage error (an unknown net) or not available.

## MCP tools

The Protoboard MCP server (`protoboard mcp`) offers the board as tools generated from the
operation registry, so their descriptions and accepted operation names cannot drift from it.
Each runs `protoboard board …` as `agent:<client name>`:

| Tool | Command |
|---|---|
| `board_operations` | `board ops --json` |
| `board_apply` | `board apply` (ops, label, batchId, changeSet, expectSeq, expectEpoch, expectVersions, expectRegion, lease, dryRun) |
| `board_inspect` | `board inspect` |
| `board_query` | `board query` (ids, net, region, point, tolerance, layers, kinds, records) |
| `board_undo`, `board_redo` | `board undo`, `board redo` |
| `board_claim`, `board_release` | `board claim`, `board release` |
| `board_presence` | `board presence` |
| `board_check` | `board check` (kicad, kicadRoot, crossCheck: false is `--no-cross-check`); writes nothing |
| `board_describe` | `board describe --json` (region in mm, net, object, finding; `image: true` also returns the PNG) |
| `board_render` | `board render` (region in nm, layers, flip, nets, width, height; `image: true` also returns the PNG) |
| `board_import` | `board import` (source, dir, format is `--kind`); CHANGES FILES |
| `board_import_dxf` | `board import-dxf` (dir, path, units, layers, tolerance in nm); CHANGES FILES |
| `board_route` | `board route` (nets, region in mm, budget in seconds, apply); CHANGES THE BOARD only with `apply: true`, each step as its router |
| `board_diagnose` | `board diagnose` (net, budget in seconds); writes nothing |

`board_describe` and `board_render` write only derived files under `.protoboard/build`, so
they are not marked read-only; `board_check` and `board_diagnose` are. `board_route` is not, since
`apply` changes the board. A region goes to the CLI in brackets
(`--region=[-10,-5,10,5]`), since a value a tool passes never starts with a dash.

## Wire protocol

JSON-RPC 2.0 over WebSocket on `127.0.0.1`. A client offers the subprotocol
`protoboard.board.v1` and the token from `service.json`, as `Authorization: Bearer <token>` or
as a second subprotocol `protoboard.token.<token>` (what a browser can send, and what the Node
client sends: it uses the standard WebSocket constructor, so the same module type-checks in a
program that also has the DOM's types). The server refuses peers
that are not loopback, a Host header that does not name the loopback address, browser origins
it was not given, a wrong token, and messages over 4 MiB.

Methods mirror the service: `board.snapshot`, `board.query`, `board.apply`, `board.undo`,
`board.redo`, `board.revertChangeSet`, `board.claim`, `board.release`, `board.takeOver`,
`board.presence`, `board.save`, `board.checkpoint`, `board.operations`, `board.log`,
`board.changeSets`, and `board.shutdown` (offered by `protoboard board serve` only). The server
sends `board.event` notifications (`commit`, `presence`, `saved`, `external-change`). In Node,
`connectBoard(dir)` from `@protoboardai/board/node` finds a live service or opens the board
itself, and `serveBoard(service, options)` serves one. The package's index carries the protocol's
shapes but not the server or the client; `@protoboardai/board/browser` is what runs in a page.

### The layout screen's path to the board

A page never connects to the board service: it would need the token, and the service allows no
browser origin by default. The host is the service's client and passes a feed on
(`@protoboardai/views/pcb/host`, `BoardFeed`): the snapshot first, then each commit with the
records it changed, presence, saves, checkpoints, autoroute progress and proposals, and the
derived data (the checks with the zone fill, the ratsnest, each check run's counts by seq, waived
findings, and KiCad's cross-check once kicad-cli has run on the source file). With no service
running, the host reads the board's files (no owner lock, no journal) and reloads them when they
change; it switches to a service when one starts.

Writes go the other way as requests (`BoardRequest`): a transaction, undo, redo, a change set's
revert, Take over, save, checkpoint (the service saves and prepares the message), commit (`git add`
and `git commit` of the board folder only; never a push), the board at an earlier seq (replay,
read only), the routers and an autoroute run (its proposal held by the host until accepted, then
applied as each router's transaction and checked for locked records byte for byte), a routing
diagnosis, and a waiver ("not a problem" with a reason, stored as a disabled rules entry
`rule:waiver.*` that the host's analysis leaves out of the counts and lists). **The host decides
who acts**: a person at the screen is `human`; a request that names an actor, a `by`, a
`provenance` or a lease token is refused (`parseBoardRequest`). With no service running, the first
write opens the board in the host as its owner and serves it (`service.json`), so the CLI and
agents become its clients; closing the feed saves the board, as `board stop` does.

- `protoboard dev` serves the feed at `/__protoboard/board/list`, `/events?board=<key>` (an event
  stream), `/derived?board=<key>`, `POST /check?board=<key>` and `POST /request?board=<key>` (the
  page's token and origin), for its own page only; boards are named by key, never by path. The web
  viewer's `layout` tab opens on them.
- In VS Code, the extension host opens the feed itself and relays it to the viewer tab by
  postMessage (`boards`, `boardOpen`, `boardClose`, `boardCheck`, `boardRequest`; `boards`,
  `boardFeed`, `boardReply`).
- The layout screen's dev page (`packages/views/bench/pcb-screen/serve.ts`) mounts the same routes;
  `session.ts` there drives scripted editing sessions on it and `latency.ts` measures a drag.

## Security review of the wire transport (Phase 1)

A review of the hand-written WebSocket server (`packages/board/src/transport/ws.ts`, written
from RFC 6455) and its use in `serveBoard` (`transport/server.ts`). Each item has a test in
`packages/board/test/ws-security.test.ts` that sends hand-built frames over a raw socket.

1. **Frame headers and buffering.** Fixed. A 64-bit length with its top bit set was reported as
   "too big" (1009) instead of a protocol error, and lengths not in their shortest form were
   accepted; both now close with 1002. Every header check (RSV bits, opcode, mask, control
   rules, binary, fragment order, size) now runs before the payload is buffered, so an oversized
   frame is refused from its header alone. The receive buffer used to be concatenated with every
   chunk (quadratic for a large frame); it is now one buffer that grows by doubling and is
   compacted in place, so a connection holds at most about twice the message limit plus one read.
2. **Fragmentation.** Partly right already (continuation order, control frames between
   fragments, the size limit counted across fragments). Fixed: empty fragments could pile up
   without limit; a message may now have at most 1024 fragments, and a fragmented message must
   finish within 30 seconds (both close with 1008).
3. **Masking.** Already right: unmasked client frames close with 1002, and the server never
   masks.
4. **Close handling.** Fixed. A one-byte close payload, close codes a peer may not send
   (0-999, 1004, 1005, 1006, 1015, 1016-2999, 5000 and up) and a close reason that is not UTF-8
   were all accepted; they now close with 1002 or 1007. An empty close is answered with an empty
   close. A long close reason was cut by characters, which could exceed the 125-byte control
   frame limit; it is now cut by bytes at a character boundary. Data after a close frame is
   ignored (already right). The server now also destroys a socket after it ends its side or
   fails the connection, and drops a client that half-closes without a close frame (the HTTP
   server allows half-open sockets, so such a client used to keep its slot).
5. **Ping and pong.** Control frame size and fragmentation were already checked, and
   unsolicited pongs are ignored. Fixed: pings are limited to 50 a second (1008). Added a
   keepalive ping (`keepaliveMs`, default 30 seconds, 0 turns it off) that drops a client that
   sent nothing since the previous ping, so dead peers free their slot.
6. **Host and Origin.** Mostly right. Host must be `127.0.0.1`, `localhost` or `[::1]` with the
   server's port (any case). Fixed: Origin is now matched exactly as the browser sends it (the
   configured list is lowercased and loses trailing slashes, the incoming value is not altered),
   and `null` is refused even if configured.
7. **Token comparison.** Fixed. The comparison returned early when the lengths differed, which
   leaks the token's length through timing. Both sides are now hashed with SHA-256 and the
   digests compared with `timingSafeEqual`.
8. **Loopback only.** Already right: the listener binds `127.0.0.1` and refuses non-loopback
   peers at the upgrade. Now also dropped as soon as they connect.
9. **Message size and batches.** Already right: 4 MiB per message (1009) and 1 to 64 requests
   per batch. The batch limit is now the constant `MAX_BATCH`.
10. **Slow clients and connection count.** Fixed. A client that never reads made the server
    buffer replies and events without bound; once a connection holds more than 32 MiB unsent
    (`maxSendBufferBytes`) it is dropped. Sockets that had not finished the handshake did not
    count against `maxConnections`; the listener now accepts at most `maxConnections` plus 8
    sockets, and a socket that has not sent its upgrade request within 10 seconds
    (`handshakeTimeoutMs`) is dropped.
11. **Malformed input.** Unknown opcodes, RSV bits (1002), binary frames (1003), invalid UTF-8
    (1007) and malformed JSON (a -32700 reply) were already handled. Fixed: frames sent in the
    same packet as the upgrade request reached the message handler before the connection
    existed, which threw and could stop the process; they are now read once the connection is
    registered. A request that throws outside the service call (a failing actor policy, a reply
    that cannot be serialized) now gets a -32603 reply instead of an uncaught exception, and a
    message handler that throws closes that one connection with 1011.

Not changed: a JSON-RPC batch of 64 `board.snapshot` calls can make a large reply. Only a
holder of the token (a local process that can read the board's files) can send one, so this is
accepted for Phase 1.
