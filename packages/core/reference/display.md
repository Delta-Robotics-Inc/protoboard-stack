# display.json: the diagram's layout and the 3D placements

`.protoboard/display.json` holds how a project is shown: where the
diagram's nodes sit, and where the 3D view puts modules that no mate places.
It is presentation, never topology: nothing in it changes what the model
says, what `protoboard check` finds about the design, or what a release
contains. It is the one file under `.protoboard/` that is not generated:
commit it. The viewer writes it when someone drags a node; people and agents
may write it by hand (read it again first, and keep what you do not change).

The file is read by the viewer (`protoboard dev`, the VS Code extension; the
format is the viewer's `DisplayConfig`, in `@deltarobotics/uhd-viewer`
`src/source/source.ts`) and, for `spatial.root` and `spatial.placements`, by
`protoboard check` (`UHD_UNPLACED`, below). Its path can be changed with
`display` in `protoboard.config.ts`.

```json
{
  "schema": "uhd.display/v0",
  "diagram": {
    "layouts": {
      "": { "nodes": { "board": { "x": 460, "y": 370 }, "cell": { "x": 60, "y": 450 } } },
      "board": { "nodes": { ":u1": { "x": 320, "y": 200 } } }
    },
    "expanded": ["board"],
    "openLinks": ["power"]
  },
  "spatial": {
    "root": "shell",
    "placements": {
      "pod": { "matrix": [1, 0, 0, 12.5, 0, 1, 0, 0, 0, 0, 1, 30, 0, 0, 0, 1], "note": "sits in the shell's pocket" },
      "shell/button": { "matrix": [0, -1, 0, 4, 1, 0, 0, 0, 0, 0, 1, 18, 0, 0, 0, 1] }
    },
    "labels": { "modules": { "pod": { "title": "Pod", "sub": "nebuliser" } } },
    "appearance": { "nebuliser-shell": { "color": "#d8d4cc", "opacity": 0.6 } },
    "view": { "up": [0, 0, 1], "camera": { "azimuth": 35, "elevation": 20 } },
    "views": {
      "Pod out": { "camera": { "position": [180, -240, 160], "target": [0, 0, 30], "up": [0, 0, 1] }, "explode": { "t": 1, "step": null } }
    }
  }
}
```

## `diagram`: the block diagram

| Key | What it is |
| --- | --- |
| `layouts` | One entry per level of the diagram, keyed by the instance path of the module the level shows: `""` is the top level, `"board"` the inside of the instance `board`, `"board/power"` one deeper. A level without an entry is laid out automatically. |
| `layouts.<level>.nodes` | The position of each node of that level, `{ "x": …, "y": … }` in diagram units (x to the right, y down). The keys are the ones the viewer writes; move a node once in the viewer to see them for a level. |
| `layouts.<level>.nodes.<id>.w`, `.h` | A size set by hand. `protoboard layout --apply` writes it for modules expanded in place (the size they were laid out at); for those it is the least they draw at, and they still grow to hold their children. |
| `layouts.<level>.pinned` | Nodes `protoboard layout` keeps where they are (`--pin <id>` adds one). The viewer ignores it. |
| `expanded` | Instance paths drawn expanded in place when the diagram opens. |
| `openLinks` | Links whose conductors are shown when the diagram opens. |

### Layout without a saved level, and `protoboard layout`

A level with no entry is laid out automatically. A level of modules is a
block shaped like a screen: the module with the most links in the middle,
each other one beside what it connects to, connectors and power to the left
of a processor and what it drives to the right, modules linked to nothing in
rows below. A board's own level (its parts and nets) is laid out as a
schematic sheet. The same model always gives the same layout.

`protoboard layout [level]` measures each level as the viewer draws it: line
crossings, overlapping cards, the longest row or column of cards (a strip),
the aspect ratio and lines under cards, with what to fix. `--apply` lays a
level out afresh and `--tidy` starts from the saved arrangement; either
writes `layouts.<level>`, but only for a level that already has a saved
layout and only when the result reads clearly better (fewer problems, or as
few and a quarter less line); `--force` writes anyway. Links whose ends
moved lose their saved waypoints; labels and tabs stay. `check` reports a
level of modules that needs work as `PB_DIAGRAM_LAYOUT` (info).

### Where the file lives (decided for 0.2.0)

The file stays at `.protoboard/display.json` (or the path `display` in
`protoboard.config.ts` names). It was asked whether it should move out of
`.protoboard/`, since everything else there is generated and agents are told
not to edit generated files.

- **For moving it** (for example to `display.json` at the project root, or
  `docs/`): a person browsing the project sees it; no rule has an exception;
  ignore patterns for `.protoboard/` cannot catch it by mistake.
- **For keeping it**: every reader already finds it there (the viewer through
  the bundle, `protoboard dev`, the VS Code extension, `check`'s placements,
  `harness-cad`, the hub's projects, the examples and the templates); a move
  needs a fallback for projects made before it, in every one of those, and a
  migration of every project that commits one. The ignore patterns `init`
  writes name `.protoboard/` subfolders, never `.protoboard/` itself, so the
  file is committed today. The confusion it caused is answered in the text
  agents read: AGENTS.md says it is the one file there they may write.

The owners can still move it later behind the `display` setting with the
old path as a fallback; nothing in the format depends on where it is.

## `spatial`: the 3D view

Modules are placed in 3D by **mates**: a mechanical link between two
interfaces that both carry a geometry frame puts one module against the
other (UHD's `assemble`, `@deltarobotics/uhd` `src/system/geometry.ts`). The
assembly starts from one module, its root, which sits at the origin; mates
place what they reach from it. `spatial` says where to start and places what
no mate reaches: a part held, bonded or strapped, or one not yet joined.

### `root`

The instance path the assembly is placed from: the structure the others
mount to (a frame, a shell, a board). One rule picks it, for the viewer and
for `protoboard check` (PB-1137):

1. `spatial.root`, when it names an instance (a path from the top level);
2. else the system itself, when it has a body of its own (a board as the
   bundle's root);
3. else the top-level module (not a harness) with the most interface
   frames; on a tie, the first one declared.

The viewer reports the root it used: `window.__cad.observe().root`;
`protoboard check --json` reports it as `root` (and the step of the rule
that chose it as `rootRule`) on its `uhd/assemble` entry. The rule is
written in uhd-viewer (`src/cad/state/view.ts`, `assemblyRoot`) and, for
`check`, in core (`assemblyRoot` in `packages/core/src/project.ts`).

### `placements`

```json
"placements": {
  "<instance path>[#<artifact>]": { "matrix": [16 numbers], "note": "why" }
}
```

- **Key**: an instance path from the top level, with `/` between levels
  (`"pod"`, `"shell/button"`). A module whose definition has several bodies is
  placed one body at a time with `#` and the artifact id of the body
  (`"board#case"`), as mates do.
- **`matrix`**: a 4×4 homogeneous transform from the module's own
  coordinates into the root's, written **row by row** (row-major), 16 numbers:

  ```text
  [ r11, r12, r13, tx,
    r21, r22, r23, ty,
    r31, r32, r33, tz,
    0,   0,   0,   1  ]
  ```

  The upper-left 3×3 is the rotation (its columns are the module's x, y and z
  axes in the root's coordinates); `tx`, `ty`, `tz` (elements 4, 8 and 12,
  counting from 1) are the translation in **millimetres**, the unit of UHD
  frames and of the bodies' manifests. The identity
  `[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]` puts the module's origin at the
  root's.
- **`note`**: why the module is placed by hand (shown in the viewer's
  inspector; "placed by a display hint" when absent).

A placement holds the module where it says. Mates then place from it what
they reach, and a mate between two placed modules is checked against both
placements: one that does not agree is reported as over-constrained. Use a
placement only for what no mate reaches; when a part can be mated (an
interface frame on each side and a mechanical link), mate it in the model.

When the 3D view shows one module on its own (opened from the diagram), the
placements inside it are used re-keyed to it, and `root` too when it lies
inside it.

**What `check` sees.** `protoboard check` reports each module that nothing
places as `UHD_UNPLACED` (info). It places from the same root as the viewer
and counts these placements, so a module placed here is not reported.

Write the matrices from the same numbers the geometry came from (the CAD
script's transforms, the datasheet's mounting dimensions), and cite them in
`docs/decisions.md`; a placement copied by eye drifts when the CAD changes.

### The matrix convention, exactly

- **Column vectors.** A point `p` of the module (its own coordinates, mm)
  lands at `p' = M · p` in the root's coordinates, with the 16 numbers read
  row by row: `x' = m1·x + m2·y + m3·z + m4`, `y' = m5·x + m6·y + m7·z + m8`,
  `z' = m9·x + m10·y + m11·z + m12` (UHD's `applyMat4`,
  `src/system/geometry.ts`). The columns of the upper 3×3 are where the
  module's x, y and z axes point in the root's frame.
- **Every key is in the root's frame**, a nested one too: `"shell/button"`
  is placed in the root's coordinates, not in `shell`'s. Compose the parent's
  matrix with the child's offset yourself when you mean "relative to its
  parent".
- **A placement keyed by the root replaces the root's identity**: it turns or
  moves the whole assembly (every mate places from it). That is one way to
  stand a model built on a tilted face upright; the other, which changes no
  geometry, is `view.up` below.
- **Units**: millimetres, Z up, as UHD frames and the bodies' manifests.
  Model files are glTF (metres, Y up); the viewer converts a GLB point
  `(gx, gy, gz)` to `(gx, -gz, gy) × 1000` mm (`cadWrapper` in uhd-viewer
  `src/cad/scene.ts`), so a body's manifest and its frames agree with the
  matrices here.
- **Precision**: write rotations with at least six significant digits (a
  45° turn is `0.707107`); the rotation part must stay orthonormal to within
  about `1e-6`, or the mates that close a loop through the placement are
  reported as over-constrained. Translations to `0.001` mm are plenty.

A worked example: a pod turned a quarter turn about x (its own +z along the
root's −y, its own +y up), its origin 12.5 mm along x and 30 mm up:

```json
"pod": { "matrix": [1, 0,  0, 12.5,
                    0, 0, -1, 0,
                    0, 1,  0, 30,
                    0, 0,  0, 1] }
```

Read it by columns: column 1 (`1, 0, 0`) is where the pod's +x points (the
root's +x), column 2 (`0, 0, 1`) its +y (up), column 3 (`0, -1, 0`) its +z
(the root's −y), column 4 its origin (`12.5, 0, 30` mm). Check a matrix this
way before committing it: say where each column points.

### The rest of `spatial`

| Key | What it is |
| --- | --- |
| `labels.modules`, `labels.harnesses` | Per instance path: `title`, `sub` (a second line) or `hide` for the 3D view's callouts. |
| `appearance` | Per definition id: `color` (CSS colour), `metalness`, `roughness`, `opacity`, and `parts` for named sub-bodies of the same. |
| `view.up` | The direction drawn up (default `[0, 0, 1]`): the camera's up, the orbit axis, the lights and the ground grid follow it. A model built display-down says `[0, 0, -1]` and opens display-up without changing the model; a model placed from a tilted root face (its +z along `(1, 1, 1)/√3`) says `[1, 1, 1]` (normalised for you) and opens standing on its feet (PB-1137). Only the whole assembly's view: a module opened on its own is seen in its own coordinates. |
| `up` | The same as `view.up`, shorter (`spatial.up`); `view.up` wins when both are given. |
| `view.camera` | The opening camera: `azimuth` and `elevation` (degrees, about `up`), `distance` (mm) and `target` (`[x, y, z]`, mm, root coordinates). Without a distance the model is fitted. The URL (`?az=`, `?el=`, `?dist=`, `?cam=`), and the view a person left (below), open it differently. |
| `views` | Named views (PB-1178): per name, a `camera` (`position`, `target`, `up`, mm, and an optional `fov` in degrees), and optionally `explode` (`{ "t": 0..1, "step": n | null }`), `sections`, `hidden` and `isolation`. Written only by an explicit save (the `saveView` verb, from a person or an agent call that says so); `?view3d=<name>` opens one. |
| `annotations` | Reserved for callouts and marks saved with the project (wave 3); written only on an explicit save. |

## What is not in this file: the view a person left

Where the camera is now, what is selected, what is hidden or cut, how far
the model is exploded: that is each person's own, and it changes with every
drag, so it never goes in this committed file ("not bloat git with a bunch
of micro changes"). The viewer hands it to the host 400 ms after it last
changed, and the host keeps it in `.protoboard/local/viewer-state.json`
(git-ignored, one entry per module shown) and, in VS Code, with the tab; it
comes back when the view opens again. Diagram positions are written here
when a drag is dropped, never while it moves, and only when they changed.
The format and the live-tab bridge that lets an agent read and set it are
in [viewer-bridge.md](viewer-bridge.md).

## See also

- Every project's `AGENTS.md` (the shared text in
  `packages/core/templates/_agents/common.md`): the diagram's layout and the
  3D placements, as an agent is told them.
- [Configuration](configuration.md): where the file sits among the project's
  files.
