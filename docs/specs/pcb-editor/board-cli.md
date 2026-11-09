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

With the editing kernel installed (`@protoboardai/board-edit`), the service also runs the live checks: after
every commit it rechecks what changed (incremental checks), refills affected zones and publishes a `derived`
event (`board.derived` returns the last one), and it offers the `board.diagnose` wire method.

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
envelope. A resent batch id returns its first reply (except a `paused` or `held` refusal, which is not
remembered, so the same batch may be sent again). `--wait <seconds>` retries while the reply is `paused` or `held`
(see pause and resume below).

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

Before a change is made (Phase 2): `--with <file>` checks the board as it would be with that change applied on a
copy (a transaction, ops or one op as `apply` takes them, or a proposal file as `propose` takes it, all its items or
`--items a,b`; applied as the CLI's actor), and `--proposal <id>` with the stored proposal's items applied (all, or
`--items`). Nothing changes; the output ends `the board now: ...` with the counts as they are, and `--json` adds
`with: { kind, file | id, items?, now }`. KiCad does not run on a board that is not on disk. A person reads a
proposal's counts this way before `board accept`; an agent checks its own plan before `board propose`.

`--refill` fills the zones again with the fill engine (`@protoboardai/board-fill`) instead of using the cached fill.
An imported board's cached fill is the source tool's last fill: it stays current while the zones are unchanged, but
copper moved or added since is not cleared from it, so `board check` reports it touching the old pour until the zones
are refilled, as the source tool would. The board service's live checks and the layout screen refill once the board
is edited; `--refill` gives the CLI the same answer.

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

### export-kicad (Phase 2)

```
$ protoboard board export-kicad airnode/board kicad/airnode-c3.kicad_pcb
WRITTEN  <project>/airnode/board -> <project>/kicad/airnode-c3.kicad_pcb
  files: <project>/kicad/airnode-c3.kicad_pcb, <project>/kicad/airnode-c3.kicad_pro, <project>/kicad/airnode-c3.kicad_dru
  board: 20 footprints, 123 pads, 0 tracks (0 arcs), 0 vias, 0 zones, 0 rule areas, 0 graphics, 2 texts, 15 nets, 0 net classes, 0 custom rules
  offset: the import record's: a board point plus (100 mm, -100 mm) is the KiCad point, Y turned down
  zone fill: 0 polygon(s) from <project>/.protoboard/build/board/airnode__board/zone-fill.json (kicad)
  report: 0 dropped, 3 approximated, 8 info line(s)
  APPROXIMATED 20 text: written with its glyph width equal to its height (the document keeps the height only)
  APPROXIMATED 4 polygon pad: written as a custom pad (a small round anchor inside the polygon, the polygon as its primitive); KiCad's trapezoid and chamfered shapes come back as polygons
  APPROXIMATED 4 Edge.Cuts line: drawn 0.05 mm wide (the document keeps the outline's line, not its drawn width)
  INFO 1 board offset: coordinates are the board's plus (100, -100) mm (the import record's offset: the export lands where the source was), Y turned down
  …
  cross-check it: protoboard board check <project>/airnode/board --kicad <project>/kicad/airnode-c3.kicad_pcb
  took 278 ms
$ protoboard board check airnode/board --kicad kicad/airnode-c3.kicad_pcb
…
like with like: ours 75 unconnected, 0 errors, 0 warnings; KiCad 75 unconnected, 0 errors, 0 warnings  (KiCad 10.0.5, 5536 ms)
```

Writes the board as a KiCad board (`exportKicadBoard` of `@protoboardai/board-import`, written from
KiCad's published file format and as the importer's inverse): the `.kicad_pcb` (KiCad 9 format,
which KiCad 9 and 10 open), and beside it the `.kicad_pro` (board setup minimums, net classes with
their values, nets and patterns, the severities the board's rules set) and the `.kicad_dru` (the
custom rules, in precedence order; written with no rules when the board has none, so a stale file
is never left beside the export). In the `.kicad_pcb`: the stackup and layers, the outline and
cutouts on Edge.Cuts, footprints with their pads (shapes, drills, layers, nets, angles, side),
graphics and texts, tracks and arcs, vias (blind and buried by their layers), zones with their
settings and the board's cached zone fill (holes joined by zero-width bridges, as KiCad saves fill;
without a cached fill zones are written unfilled and `kicad-cli pcb drc --refill-zones` fills them),
keep-outs as rule areas, board graphics and texts, the netlist and locked flags. Coordinates go
through the import record's offset when the board has one, so the export lands where the source
was and `board check <dir> --kicad <export>` cross-checks it as it would the source; without one
the board's origin goes to (150, 100) mm. Objects the source gave one KiCad UUID (the import
record's `sharedIds`, such as the front and back copies of a castellated pad) share one UUID again,
so KiCad reports each group once as it did on the source; `--unique-ids` gives every object its own.
The export is noted in the import record (`exports`: path, time, whether it keeps the shared
identities), and the cross-check reads a noted export as it reads the source: in the source's frame,
with the shared identities folded when the export keeps them. Lengths are written exactly (integer nanometers as
millimeters). The report names everything approximated or dropped (text glyph width, polygon pads
as custom pads, the Edge.Cuts line width, rules KiCad cannot express, the source rules the import
could not express, and so on). Imported, exported and imported again, a board comes back record
by record except for explained differences (a polygon pad's ring may start at another vertex, and
its arcs read back in straight steps; custom rules renumber when a source rule could not be
imported). `--json` gives the files, stats, offset, fill and every report line. CHANGES FILES (the
three files; the board is not changed).

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

It changes nothing unless `--apply` or `--propose` is given. With `--propose` and status `proposed`, the result is
stored as board proposals through `@protoboardai/board-edit/service`'s `proposeRouteResult`: one proposal per
router step, one item per net, the scores kept, proposed as the router. A person reads them with `board proposal
--preview` and accepts only what scores better (`board accept <dir> <id> --items n0,...`):

```
$ protoboard board route airnode/board --propose --nets LED1,LED2 --budget 20
PROPOSED  (nothing changed; stored for a person to accept)  run-46f7db82b01d, seq 3, epoch yf3n59
  current:   42 open, 11 errors, 3 vias, 67.1557 mm of track
  candidate: 40 open, 11 errors, 3 vias, 126.2136 mm of track
  scope: nets LED1, LED2; 2 net(s) to route; budget 20 s per router; scored by board checks
  stages:
    1. tscircuit 0.0.953  complete, kept  2 net(s), 8 segment(s), 0 via(s), 3003 ms
  …
  stored as proposal p.yf3n59.3: "route 2 nets with tscircuit", 2 item(s) (n0 LED2, n1 LED1)
  a person accepts what scores better: `protoboard board proposal <dir> <id> --preview`, then `board accept <dir> <id> [--items ...]`
$ protoboard board proposal airnode/board p.yf3n59.3
p.yf3n59.3  OPEN  "route 2 nets with tscircuit"
  by router router:tscircuit (source router), computed on seq 3, epoch yf3n59; change set run-46f7db82b01d
  items:
    n0     open     route LED2  nets LED2
           added 4 track; +29.5393 mm of track; 1 op(s)
    n1     open     route LED1  nets LED1
           added 4 track; +29.5187 mm of track; 1 op(s)
  before: 55 records, 10 tracks, 3 vias; after: 63 records, 18 tracks, 3 vias
  scores: current 42 open, 11 error(s), 3 via(s), 67.1557 mm; candidate 40 open, 11 error(s), 3 via(s), 126.2136 mm (run run-46f7db82b01d)
  --preview shows the diff against the board now
```

`--propose` and `--apply` exclude each other. With `--apply` and status `proposed`, each step's
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
  diagnose USB_DP: connectivity 2%  0.1 of 8 s: the board's checks and zone fill, once
  diagnose USB_DP: attempt 8%  0.2 of 8 s: every rule as it is; the probe beside it
  diagnose USB_DP: attempt 72%  3.6 of 8 s  tscircuit: complete: worse than the board it started from: errors rise from 11 to 29
  diagnose USB_DP: relaxations 75%  4.0 of 8 s  tscircuit: Plan USB_DP at the floor clearance and width
  diagnose USB_DP: done 100%  7.4 of 8 s: the budget cut part of it
USB_DP: PLACEMENT  (seq 0, epoch q8qo3c; nothing changed)
  Placement: the probe routed USB_DP only by breaking the floor clearance (20 pairs); move parts or a no-go area
  budget 8 s for the whole diagnosis; took 7.4 s; 1 open link(s) diagnosed
  STOPPED attempt: freerouting: not started, the time budget ran out (2384 ms left)
  attempts (every rule as it is):
    tscircuit  complete (worse than the board it started from: errors rise from 11 to 29)  0 segment(s), 0 via(s), 3398 ms
    freerouting  skipped (the time budget ran out (2384 ms left))  0 segment(s), 0 via(s), 0 ms
  probe (the fab floor and no-go areas only): tscircuit routed the net, 35.6144 mm, 0 via(s), 20 pair(s) under the floor clearance, 3757 ms
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
      -> did not route: 41 open, 29 error(s), 0 via(s), 35.3782 mm, 18 new finding(s), 3418 ms (errors rise from 11 to 29)
    Plan USB_DP at the floor width: a target rule for this net only: 0.25 mm to 0.127 mm
      -> not test-run: relaxing both did not route USB_DP, so relaxing one alone will not
    Plan USB_DP at the floor clearance and width: both target rules, this net only
      -> did not route: 41 open, 29 error(s), 0 via(s), 35.3782 mm, 18 new finding(s), 3313 ms (errors rise from 11 to 29)
  note: scored by what changed: 5 full and 3 incremental check run(s), 216 ms

$ protoboard board diagnose airnode/board USB_DP
USB_DP: PLACEMENT  (seq 0, epoch whfa2h; nothing changed; from the cache)
  …

$ protoboard board diagnose airnode/board GND
GND: ROUTES AS IS  (seq 0, epoch ksnc6o; nothing changed)
  left to its pour (zone:f.gnd_bottom): its fill joins the rest; only the 15 links it does not make are diagnosed
  GND routes with every rule as it is: run the autorouter on it
  budget 8 s for the whole diagnosis; took 4.7 s; 15 open link(s) diagnosed
  …
```

(Progress lines abridged; they go to stderr. Times are from a laptop with other work running.)

Why one net does not route, within one time budget for the whole diagnosis: `--budget <seconds>`
(default 8). The verdict (`routes as is`; `rules, not placement`: with only the fab floor and
no-go areas it routes within the floor clearance; `placement`: even then it does not, so the parts
or a no-go area block it; `connected`: nothing of the net is open; `not known`: the budget ran out
before the probe could say), the summary sentence, the attempts with every rule, the probe with the
fab floor and no-go areas only, what blocks it, the rule areas by tier, and the relaxations (target
rules for this net only; the floor is never relaxed) with their test-run results on copies of the
board.

It is bounded to the net's open links: the board checks run once (with the zone fill when the board
has zones) and give the net's missing connections; only those are routed, and every candidate is
scored by what changed since the last board scored (incremental checks and refill), not by a full
check run. A net with a zone is left to its pour: the first line says so, and only the links its
fill does not make are diagnosed (none: no router runs, verdict `connected`). The attempt runs the
routers in order (the fallback only while time is left; Freerouting needs a few seconds to start
and is not started with less); the probe runs beside it (the first available router) and is
dropped when the attempt routes. The attempt and the probe may use three quarters of the budget;
the relaxations get the rest, two at a time, the most relaxed first: when the probe or the most
relaxed one does not route, the others are not test-run, nor is one that cannot finish in the time
left. Every stage stops at the budget and the answer says what was cut (`STOPPED`, `not test-run`).

Progress (stage, percent, time against the budget, router) goes to stderr, not with `--json`. The
answer is cached by an input hash (the board's records other than drawings and text, the netlist,
the net, the budget, the routers and the scorer) in
`.protoboard/build/board/<board key>/diagnosis/<hash>.json`, and a repeat says `from the cache`
(`cached: true` and `hash` in `--json`, which also gives `links`, `pour`, `stopped`, `notes`). It
changes nothing on the board: a relaxation takes effect only when its rules are applied (`board
apply` with `rule.set`). Exit `0` when the diagnosis ran, `2` for a usage error (an unknown net)
or not available.

### Proposals, waivers, pause and the corridor (Phase 2)

The commands of [phase2-editing.md](phase2-editing.md) section 9 and of the waivers and pause. A proposal is a
change stored, not applied, until a person accepts it (all of it or some items) as their own transaction; an
agent's net change, unlock or waiver is refused `needs-person` and stored as one by the service. Proposals live
in `.protoboard/local/board/<board key>/proposals/` beside the journal. With no running service a command opens
the board for the one call, so a proposal stored by an earlier call reads as stale (its seq belongs to another
session): `accept --allow-stale` revalidates it and applies what still applies. With `board serve` running,
proposals stay open until the board changes under them.

#### propose, proposals and proposal

```
$ cat move-leds.json
{ "title": "nudge the two LED resistors right", "items": [ { "key": "r2", "label": "move R2 right", "ops": [ { "op": "footprint.move", "ids": ["fp:status/r2"], "dx": 100000, "dy": 0, "tracks": "stay" } ] }, { "key": "r1", "label": "move R1 right", "ops": [ { "op": "footprint.move", "ids": ["fp:status/r1"], "dx": 100000, "dy": 0, "tracks": "stay" } ] } ] }
$ PROTOBOARD_AGENT=planner protoboard board propose airnode/board move-leds.json
PROPOSED  p.yf3n59.1  OPEN     "nudge the two LED resistors right"  by agent agent:planner; 2 item(s); changed 2 footprint
  nothing changed; a person accepts it with `protoboard board accept airnode/board p.yf3n59.1`
$ protoboard board proposals airnode/board
1 proposal(s)
  p.yf3n59.1  OPEN     "nudge the two LED resistors right"  by agent agent:planner; 2 item(s); changed 2 footprint
$ protoboard board proposal airnode/board p.yf3n59.1 --preview
p.yf3n59.1  OPEN  "nudge the two LED resistors right"
  by agent agent:planner (source agent), computed on seq 0, epoch yf3n59; change set proposal.p.yf3n59.1
  items:
    r2     open     move R2 right
           changed 1 footprint; 1 op(s)
    r1     open     move R1 right
           changed 1 footprint; 1 op(s)
  before: 54 records, 10 tracks, 3 vias; after: 54 records, 10 tracks, 3 vias
  preview on seq 0: applies
    added 0
    removed 0
    changed 2: fp:status/r1, fp:status/r2
```

`propose <dir> <proposal.json>` stores `{ title (3 to 12 words), items: [{ key?, label, ops }], changeSet?,
scores? }` as the actor the CLI resolves (`--as`, or the agent it runs under); every item must apply on its own
and all together, else `INVALID` (exit 1). It changes nothing. `proposals <dir> [--status open|stale|accepted|
partial|rejected]` lists them newest first. `proposal <dir> <id>` shows the title, the proposer, the status, each
item with its nets and change summary (records added, removed and changed by kind, track length added and
removed), the counts before and after, the scores (a router's current and candidate), why it is stale or who
rejected it; `--preview` adds the diff against the board as it is now. `--json` gives the stored proposal.

#### accept and reject

```
$ PROTOBOARD_AGENT=planner protoboard board accept airnode/board p.yf3n59.1
REFUSED  not-a-person: board accept is a person's call; this command runs as agent:planner, and an agent never acts as a person
$ protoboard board accept airnode/board p.yf3n59.1 --items r2
APPLIED  seq 1, epoch yf3n59, batch accept.p.yf3n59.1.0
  changed: fp:status/r2
  proposal p.yf3n59.1 is now open: r2 accepted, r1 open
$ protoboard board reject airnode/board p.yf3n59.1 --items r1 --reason "R1 stays where it is"
REJECTED  p.yf3n59.1  PARTIAL  "nudge the two LED resistors right"  by agent agent:planner; 2 item(s), 0 open; changed 2 footprint
```

`accept <dir> <id> [--items a,b] [--allow-stale] [--as human]` is a person's call only: under an agent it is refused
`not-a-person` (exit 3) without touching the board, `--as human` included (as for `pause` and `resume`, which take it
too). `board check <dir> --proposal <id>` gives its counts first. The accepted items apply as one ordinary transaction of the
person (undoable by them), the records keeping the proposer's provenance; a stale proposal is refused
`stale-proposal` (exit 3) unless `--allow-stale`. `reject <dir> <id> [--items a,b] [--reason <text>]` marks
items rejected (a person, or the proposer withdrawing its own).

#### waivers

A waiver is a person's "not a problem" on a finding, with a reason: a `waiver` record stored with the rules
(`rules.jsonl`), added and removed by the operations `waiver.add` and `waiver.remove` through `board apply`.
`finding` waives one finding id; `rule` (a rule id or a check name) with `objects` waives that rule's findings on
exactly those objects (it survives them moving); `rule` alone waives every finding of that rule. An agent's
waiver is refused `needs-person` and stored as a proposal:

```
$ cat waive.json
{ "op": "waiver.add", "waiver": { "rule": "dangling", "objects": ["trk:f.spare.1"], "reason": "a spare stub for a rework wire" } }
$ PROTOBOARD_AGENT=planner protoboard board apply airnode/board waive.json
REFUSED  needs-person: waiver.add from an agent waits for a person; stored as proposal p.yf3n59.2 for a person to accept
$ protoboard board accept airnode/board p.yf3n59.2
APPLIED  seq 3, epoch yf3n59, batch accept.p.yf3n59.2.2
  changed: waiver:yf3n59.2
  proposal p.yf3n59.2 is now accepted: i0 accepted
$ protoboard board check airnode/board --no-cross-check
…
WAIVED  dangling (f:dangling:b6234125fe0a) by waiver:yf3n59.2: out of the counts
WAIVED  dangling (f:dangling:f77be6fe2eb9) by waiver:yf3n59.2: out of the counts
…
ours:  48 unconnected, 11 errors, 13 warnings, 2 waived (incomplete: see caveats)  (seq 3, checks 30 ms)
```

The checks leave a waived finding out of `findings` and every count and list it in `waived` (`--json`: `{
finding, waiver }`); the summary line ends in `N waived`. The KiCad cross-check matches waived findings too and
leaves them and the KiCad items matched to them out of the like-with-like counts, listing them apart
(`crossCheck.waived`, and `waived N (M matched to a KiCad item)` on the `apart:` line).

#### pause and resume

```
$ protoboard board pause airnode/board --reason "reviewing the power section" --ttl 20
PAUSED  agents and routers are refused until 2026-11-09T14:06:09.480Z; reason: reviewing the power section
  proposals are still taken; people and hosts write as before
$ PROTOBOARD_AGENT=planner protoboard board apply airnode/board nudge.json
REFUSED  paused: a person paused agents and routers (reviewing the power section) until 2026-11-09T14:06:09.480Z; proposals are still taken: retry later, or propose the change for a person
$ PROTOBOARD_AGENT=planner protoboard board apply airnode/board nudge.json --wait 60
APPLIED  seq 2, epoch yf3n59, batch cli-8a3cfb839ba8
  changed: fp:status/led2
  waited 11.0 s, 2 tries
$ protoboard board presence airnode/board
seq 2, epoch yf3n59
  PAUSED by user (reviewing the power section) since 2026-11-09T14:07:15.353Z until 2026-11-09T14:09:15.353Z: agents and routers are refused
  no leases
$ protoboard board resume airnode/board
RESUMED  agents and routers may write again (paused since 2026-11-09T14:07:15.353Z by person user)
```

(The presence lines are from a second pause with `--ttl 2m`.) `pause <dir> [--reason <text>] [--ttl <seconds>]`
(a number of seconds, or with `s`, `m` or `ms`; at most a day) and `resume <dir>` are a person's calls on a
running service (with none: exit 2; under an agent: `not-a-person`, exit 3). While paused, every transaction of an
agent or router (apply, undo, redo, revert, claim) is refused `paused` with the pause and, when it has an end,
`retryAfterMs`; dry runs and proposals go through, and people and hosts write as before. A `presence` event fires
on pause, on resume and when a pause with a ttl ends. `apply --wait <seconds>` sends the same transaction again
while it is refused `paused` or `held` (the service does not remember those refusals by batch id), until it goes
through or the time runs out; `--json` adds `waited: { ms, tries }`.

#### corridor

```
$ protoboard board corridor airnode/board --from -16mm,10mm --to -13mm,7mm --layer top
FOUND  a free corridor on top: 5.95 mm through 8 point(s); the widest track along it is 0.27 mm
  from -16, 10 to -13, 7 mm, track 0.25 mm at 0.2 mm clearance (grid 0.05 mm); the ends moved 0.035 and 0.576 mm to free space
  path: -16, 10 -> -15.975, 9.425 -> -15.875, 9.275 -> -13.975, 7.375 -> -13.925, 6.475 -> -13.775, 6.375 -> -12.975, 6.375 -> -13, 7
  millimeters, +Y up; changes nothing (a guide, not a route: `board apply` with track.route commits one)
$ protoboard board corridor airnode/board --from pad:status/led1:1 --to pad:power/ldo:2 --layer top --width 0.5mm
BLOCKED  no free corridor on top for LED1_A: stuck at -10, -4.1 mm, blocked by pad:power/ldo:1, pad:power/ldo:2, pad:power/ldo:3, trk:f.vbus.2
  from -16.8, 10 to -10, -4.1 mm, track 0.5 mm at 0.2 mm clearance (grid 0.05 mm); the ends moved 0.035 and 0 mm to free space
  millimeters, +Y up; changes nothing (a guide, not a route: `board apply` with track.route commits one)
```

`corridor <dir> --from <x,y | id> --to <x,y | id> --layer <copper layer> [--net] [--width] [--clearance]` asks the
agent scene (`@protoboardai/board-scene`'s `findCorridor`, a grid search at 0.05 mm) whether a track of that width
fits between the two ends at that clearance (defaults: the board's target width and clearance). Lengths take
nanometers or `mm`; an end may be a pad, via or footprint id (its center; a pad or via end gives the net). The
answer is in millimeters: `found`, the simplified centerline `path`, its `length`, the widest track that fits
along it (`maxWidth`), or where it got stuck (`stuckAt`) and the objects blocking it (`blockedBy`). Exit 0 found,
1 blocked, 2 usage (a layer or net the board lacks). It changes nothing.

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
| `board_export_kicad` | `board export-kicad` (dir, out, uniqueIds is `--unique-ids`); CHANGES FILES: it writes the export only (and notes it in the import record) |
| `board_route` | `board route` (nets, region in mm, budget in seconds, apply); CHANGES THE BOARD only with `apply: true`, each step as its router |
| `board_diagnose` | `board diagnose` (net, budget in seconds for the whole diagnosis); writes nothing but its cache under `.protoboard/build` |
| `board_propose` | `board propose` (title, items, changeSet); stores a proposal, changes nothing |
| `board_proposals` | `board proposals` (status); writes nothing |
| `board_proposal` | `board proposal` (id, preview); writes nothing |
| `board_corridor` | `board corridor` (from and to as `[x, y]` in mm or an id, layer, net, width and clearance in mm); writes nothing |

`board_apply` also takes `waitSeconds` (`--wait`), and `board_route` `propose` (`--propose`). No tool accepts or
rejects a proposal, pauses or resumes, or takes a hold: those are a person's calls (the editor, or the CLI in a
person's terminal).

`board_describe` and `board_render` write only derived files under `.protoboard/build`, so
they are not marked read-only; `board_check` and `board_diagnose` are (the diagnosis's cache only
answers a repeat sooner). `board_route` is not, since
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
`board.changeSets`, and `board.shutdown` (offered by `protoboard board serve` only); Phase 2 adds
`board.propose`, `board.proposals`, `board.proposal`, `board.previewProposal`, `board.acceptProposal`,
`board.rejectProposal`, `board.hold`, `board.releaseHold`, `board.derived`, `board.pause` (`{ actor, reason?,
ttlMs? }`) and `board.resume` (`{ actor }`), each a typed client method of the same name, and the extension method
`board.diagnose` when `board serve` attached the editing kernel. The server sends `board.event` notifications
(`commit`, `presence` (with `paused` while a pause lasts), `saved`, `external-change`, `proposal`, `derived`). In Node,
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
