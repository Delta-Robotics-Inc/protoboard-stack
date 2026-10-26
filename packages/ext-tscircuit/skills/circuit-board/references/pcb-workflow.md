# The PCB workflow, KiCad files, and leaving the official path

Read with the **circuit-board** SOP.

## The sanctioned workflow

1. Model the board in UHD (`src/boards/<module>/<module>.uhd.ts`): parts, pins, nets, edge, envelope.
2. `protoboard run circuit:generate --module <board>`: the provider writes the tscircuit source and
   routes it, in-process, with the tscircuit core it pins.
3. `protoboard run circuit:check --module <board>` (also part of `protoboard check`): DRC, the copper
   against the UHD nets, every pad netted, outline, keep-outs, placements, staleness.
4. `protoboard run circuit:export --module <board>`: Gerber and drill, BOM, pick-and-place, GLB,
   STEP, manifest, netlist and renders in `out/`. A failed export leaves the last good `out/`.
5. View it in VS Code: the Protoboard extension's viewer shows `out/pcb-top.svg`,
   `out/pcb-bottom.svg`, `out/schematic.svg` and the 3D board `out/board.glb` (with the parts' own
   bodies). `protoboard dev` serves the same viewer in a browser.

### Why not `tsci`

Agents never run `tsci dev`, `tsci build` or `tsci export` on a stack board, nor at a stack
project's root. What happened on a large field project:

- `tsci` rebuilds `board.tsx` with its own, different tscircuit core (0.0.2125 or later, against
  the provider's pinned 0.0.2056) and re-routes the board in the browser, so what it shows is not
  the board the provider built, checked and exported.
- Its file watcher crashes (ENOENT) when generate or export rewrites the files it watches.
- It serves files only under `/api/files/static/`, which led to model paths that work nowhere
  else; `tsci build` left `dist/` and `.tscircuit/` in the project.
- Its outputs bypass `circuit:check` and the staleness records, so nothing says when they no
  longer match the model.

`tsci` is fine for a standalone tscircuit component outside the project, or to reproduce a
tscircuit bug for an upstream report.

## UHD → tscircuit → KiCad

The chain: **tscircuit while the design changes** (agents iterate: model,
generate, route, check), then the design is **locked** and exported to **KiCad** for the final
hand placement and routing; after the lock KiCad is the board's source of truth for copper, and
the UHD model stays the source of truth for what is on the board and how it is connected (check
compares the two both ways). Not UHD → KiCad directly.

### KiCad files

The provider writes them (spec `docs/specs/pcb-kicad-handoff.md` in the stack
repository); never `tsci export` on a stack board:

- `protoboard run circuit:kicad --module <board>`: a KiCad 10 project of the current build in
  `tscircuit/kicad/`, a preview at any time (footprint and symbol libraries of the board, the
  parts' 3D bodies under `3d/` linked through `${KIPRJMOD}`, MPN, manufacturer, LCSC and the UHD
  instance on every symbol and footprint, stable reference designators). Nothing changes hands.
  The preview is rewritten each time and is not committed (the project's `.gitignore` leaves
  `src/boards/*/tscircuit/kicad/` out).
- `protoboard run circuit:lock --module <board>`, **only when the person decides**: the project
  into `<board dir>/kicad/` with `handoff.json`; KiCad is then the layout of record, `circuit:export`
  makes `out/` with `kicad-cli`, and `circuit:check` compares the model, the handoff and the KiCad
  files both ways (`CIRCUIT_KICAD_*`). `circuit:unlock` returns the board to tscircuit and keeps
  the KiCad folder as an archive.
- **Fabrication does not need KiCad** before lock: `out/gerber/` is a complete fabrication set.

## Fallback policy

When the official path fails **and** the use case needs a board anyway (a PCB at all costs, with a
real blocker: the router cannot complete a 4-layer board, a converter crashes on this board, a
fab deadline before a provider fix), the agent may fall back to `tsci` or to KiCad tooling
(the `circuit:kicad` preview inspected with the **kicad-cli** skill, derived from KiStack, an
MIT-licensed KiCad skill pack).
Before it does:

1. **Tell the user plainly, before running anything**, that it is leaving the official path, why
   (the failing command and its message), and that it adds friction: the fallback's outputs are
   outside the stack's checks (`circuit:check`, the standard-output checks) and its staleness
   tracking, and every change made there must be carried back to the UHD model by hand.
2. **Record it** in the project's worklog (`worklog.md`: date, the blocker, the fallback tool and
   version, what was produced, what must be carried back) and as Protoboard feedback (the feedback
   tool of a connected Protoboard MCP server or, in a company workspace, its friction log), so the
   blocker reaches the stack's maintainers.
3. **Keep the UHD model the source of truth.** Never change the model to match the fallback's
   copper; a net or part change goes into the model first, then into the fallback by hand.
4. **Put the fallback's outputs in a clearly named folder** next to the board, never in `out/`
   or `tscircuit/`: `src/boards/<module>/fallback-<tool>/` (for example `fallback-kicad/`), with a
   `README.md` naming the blocker, the date, the source (`tscircuit/circuit.json` of which build)
   and the tool.
5. Go back to the official path when the blocker is fixed, and say so in the worklog.

A blocker the agent can fix inside the official path (a missing land pattern, a part that needs
room in `layout.json`, a keep-out in the wrong frame) is not a reason to fall back.
