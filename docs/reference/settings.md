# Settings

Your Protoboard settings live in one file, `settings.json` in the Protoboard
home (`~/.protoboard`, or the folder `PROTOBOARD_HOME` names). The VS Code
extension, the `protoboard settings` command and the agent's MCP tools
(`settings_get`, `settings_set`) read and change the same file, so a change
made in one place shows in the others at once (the extension watches the
file).

The file holds only what you changed, as flat keys:

```json
{
  "schema": "protoboard.settings/v0",
  "viewer.openModelsInPlace": false,
  "tools.stepViewer": "fusion360"
}
```

A key that is absent has its default. An unknown key, or a value of the wrong
kind, is reported and ignored. A file larger than 64 kB is not read.

## The settings

Every default is marked DEFAULT in the code (`packages/core/src/settings.ts`)
and can be revisited.

| Key | Kind | Default | What it does |
| --- | --- | --- | --- |
| `viewer.openModelsInPlace` | true or false | `true` | Opening a model or a module's 3D view (a double-click in the 3D view, an Inspector model card, "Open 3D model") changes the current viewer tab; Back returns. Ctrl+click, Ctrl+double-click or "Open in new tab" opens a new tab. Off: every open is a new tab. |
| `viewer.zoomToCursor` | true or false | `true` | The mouse wheel zooms toward the point under the pointer in the 3D view. Off: toward the centre of the view. |
| `viewer.modelInfo` | true or false | `true` | The 3D view's model info card is open when a view opens. |
| `viewer.hoverLongDelayMs` | 200 to 5000 | `900` | How long (ms) the pointer rests on a part or a finding before the larger tooltip shows. |
| `tools.stepViewer` | an app id or a path | unset | The application "Open in the system's application" uses for a STEP file: `fusion360`, `onshape` (the browser), `kicad`, `freecad`, `protoboard` (the CAD viewer tab), `system` (the system default), or the absolute path of an executable. Unset: asked once, the first time. |
| `files.exportFolder` | a folder | unset | Where exports are written, without asking. Unset: the Downloads folder (`XDG_DOWNLOAD_DIR` on Linux when set, else `~/Downloads`). |
| `files.importFolder` | a folder | unset | Where a file picker for imports starts. Unset: the project's own folder for the import (today: the part's folder under `parts/`). Imports work as before. |

## Changing them

- **VS Code**: Protoboard: Open Settings. Each setting is a row with its value
  and a button: Turn On or Off, Change… (a number), Choose… (a folder or an
  app).
- **Terminal**:

  ```sh
  protoboard settings get                       # every setting, its value, [default]
  protoboard settings get viewer.hoverLongDelayMs
  protoboard settings set viewer.openModelsInPlace false
  protoboard settings set tools.stepViewer "C:\Program Files\FreeCAD 1.0\bin\FreeCAD.exe"
  protoboard settings reset tools.stepViewer    # back to the default (also: set <key> default)
  protoboard settings log                       # recent changes and who made them
  ```

  `--json` prints the same as data.
- **Your agent**: `settings_get` (one setting or all) and `settings_set`
  (`{ key, value }`; `value: null` resets). An agent changes a setting when you
  ask it to.

## Who changed what

Every change appends a line to `settings-changes.jsonl` beside the file: the
time, the key, the old and new value, and who made it (`person (VS Code)`,
`cli`, or `agent (<client>)`). The log keeps its newer half when it passes
256 kB.

An executable an agent chose for `tools.stepViewer` does not run until you
confirm it once in VS Code; your confirmation is logged as yours.

## The STEP viewer

The first time "Open in the system's application" meets a STEP file and
`tools.stepViewer` is unset, a small question asks which app opens STEP files.
The answer is kept. Dismissed, nothing opens (not even the system's own "Select
an app" chooser) and the question comes again next time. The applications are found where they
install (DEFAULT):

| App | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Fusion 360 | the newest `%LOCALAPPDATA%\Autodesk\webdeploy\production\<build>\FusionLauncher.exe` | `open -a "Autodesk Fusion"` | not offered |
| KiCad | the newest `%ProgramFiles%\KiCad\<version>\bin\kicad.exe` | `open -a KiCad` | `kicad` |
| FreeCAD | the newest `%ProgramFiles%\FreeCAD <version>\bin\FreeCAD.exe` | `open -a FreeCAD` | `freecad` |
| Onshape | the browser at cad.onshape.com, and the file shown in the file manager to import (Onshape cannot open a local file by address) | same | same |

A program is started with the STEP file as its one argument, without a shell.
When the app is not found, you are told and offered the system default or
another app.

## Export

An export is written to the export folder without a dialog, named
`<project>-<view or part>-<date>.<ext>` (with `-2`, `-3` when the name is
taken; characters no file system allows are replaced), and a message says
where, with Reveal:

- a picture of the 3D view (PNG): the view as it last came to rest;
- a part's model (STEP, STL, GLB): through `protoboard parts export`, the
  full-resolution body;
- the bill of materials (CSV), from the BOM view or the BOM editor.

From the 3D toolbar's Export button, or the Command Palette: Protoboard:
Export the View or Part.
