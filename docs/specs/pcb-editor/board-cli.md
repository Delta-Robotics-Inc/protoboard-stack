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
- Exit codes: `0` applied (or valid in a dry run), `1` invalid (for `check`: errors found),
  `3` refused, `2` a usage error or a failure.

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

### import, check and render

Thin commands over the importer, checks and renderer packages. When a package is not
installed they print `not available` (exit 2).

```
$ protoboard board import airnode.kicad_pcb imported/board
not available: no board importer is installed (packages board-import and board-import-easyeda). `protoboard board import` works once that package is installed.
$ protoboard board check airnode/board
…
WARNING via_under_footprint  Via via:f.gnd.3 (net GND) is under U1 (fp:mcu/module) on the top (rule:policy.via_under_module, policy, cost 5).  [fp:mcu/module, via:f.gnd.3] at 10 mm, 5 mm on top
…
$ protoboard board render airnode/board --out airnode.png
wrote <project>/airnode.png (renderBoardPng, seq 2)
```

(The import line is what this build printed before an importer package exported one; the check
line is one finding of the many the checks report on this deliberately imperfect sample.)

`import` takes `--kind` to name the source format; a whole board needs an empty folder,
operations are applied to the board there as host actor `import:<importer>`. `render` writes
to `.protoboard/build/board/<board key>/` unless `--out` names a file.

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

## Wire protocol

JSON-RPC 2.0 over WebSocket on `127.0.0.1`. A client offers the subprotocol
`protoboard.board.v1` and the token from `service.json`, as `Authorization: Bearer <token>` or,
from a browser, as a second subprotocol `protoboard.token.<token>`. The server refuses peers
that are not loopback, a Host header that does not name the loopback address, browser origins
it was not given, a wrong token, and messages over 4 MiB.

Methods mirror the service: `board.snapshot`, `board.query`, `board.apply`, `board.undo`,
`board.redo`, `board.revertChangeSet`, `board.claim`, `board.release`, `board.takeOver`,
`board.presence`, `board.save`, `board.checkpoint`, `board.operations`, `board.log`,
`board.changeSets`, and `board.shutdown` (offered by `protoboard board serve` only). The server
sends `board.event` notifications (`commit`, `presence`, `saved`, `external-change`). In Node,
`connectBoard(dir)` from `@protoboardai/board` finds a live service or opens the board itself,
and `serveBoard(service, options)` serves one.
