# The DFM profile format

A DFM profile is the set of machine and material limits an agent designs to.
Every value carries a unit, a status (how much to trust it) and a source
(where it came from). The stack ships one profile per process; a user, a
project and a part each add a layer on top; what is said in the session goes
last. `scripts/resolve-profile.mjs` merges them and evaluates the formulas.

## Shipped process profile

One file per process in the package's `profiles/` folder, named by the
process id: `profiles/fdm.json` for FDM printing. Schema
`protoboard.dfm.profile/v1`:

```json
{
  "schema": "protoboard.dfm.profile/v1",
  "id": "fdm",
  "name": "FDM 3D printing",
  "process": "fdm",
  "description": "What the profile assumes (printer class, nozzle, material).",
  "values": {
    "machine.nozzle": { "value": 0.4, "unit": "mm", "status": "house", "source": "house default", "note": "Change this for another nozzle." },
    "line.width": { "formula": "1.125 * machine.nozzle", "unit": "mm", "status": "typical", "source": "<URL>" },
    "wall.min": { "formula": "2 * line.width", "unit": "mm", "status": "typical", "source": "<URL>" }
  }
}
```

| Field | Rule |
| --- | --- |
| `id` | The process id; equals the file name without `.json`; lowercase letters, digits and hyphens |
| `name`, `description` | For people and agents |
| `process` | The process this profile describes (usually the id) |
| `values` | Path to entry |

An entry has exactly one of:

- `value`: a number, string, boolean or array;
- `formula`: arithmetic over numbers and other paths (below);

plus `unit` (a string such as `mm`, `deg`, `C`, `count`, or `null` for a
unitless value), `status`, `source` (a URL, or a description such as "house
default" or "derived from a and b"), and an optional `note`. A shipped entry
must carry `status` and `source`.

### Paths

A path is dot-separated segments of letters, digits and underscores, the first
segment starting with a letter: `machine.nozzle`, `insert.m3.hole`,
`clearance.sliding.side`. **No hyphens**: a hyphen is a minus sign in a
formula. Conventions used by the shipped FDM profile: clearance paths ending
in `.side` are per side (radial); paths ending in `.diametral` are on the
diameter. Say which in the note as well.

### Formulas

Numbers (`0.4`, `.5`, `1e-3`), paths, `+ - * /`, parentheses, unary minus,
and three functions: `min(a, b, ...)`, `max(a, b, ...)`, `round(x, digits)`
(`digits` 0 to 12, default 0). Nothing else: the resolver parses formulas with
its own small parser and never calls `eval`. A path in a formula must hold a
number. Results are cleaned to 12 significant digits, so `1.125 * 0.4` is
`0.45`.

### Status

| Status | Means | Who sets it |
| --- | --- | --- |
| `house` | The shipped house default, chosen by the project maintainers | shipped profiles |
| `typical` | From a cited source (the source holds the URL) | shipped profiles, layers |
| `derived` | Computed or reasoned from other values, not sourced directly | shipped profiles, layers |
| `assumption` | A stated assumption, to be confirmed | anyone |
| `unverified` | Seen (for example in a search excerpt) but not confirmed at the source | anyone |
| `proven` | Measured on this user's machine with a coupon; the note says which coupon and when | the user or the agent recording a coupon result |
| `failed` | Tried and did not work; the note says what happened and what to use instead | the user or the agent recording a coupon result |
| `user` | Stated by the user | layers, `--set` |

## Layer files

Schema `protoboard.dfm.layer/v1`:

```json
{
  "schema": "protoboard.dfm.layer/v1",
  "extends": "fdm",
  "values": {
    "machine.nozzle": 0.6,
    "clearance.sliding.side": { "value": 0.15, "status": "proven", "source": "slot fit coupon", "note": "PETG, 2026-11-12" },
    "wall.structural": { "formula": "3 * line.width", "status": "user" }
  },
  "waivers": [],
  "notes": ["Free text for people and agents."]
}
```

| Field | Rule |
| --- | --- |
| `extends` | Optional: the shipped profile this layer is written for. The nearest layer's `extends` picks the process when `--process` is not given. Leave it out for a process with no shipped profile (record the process in `notes` instead) |
| `values` | Path to a bare value, or to an entry object |
| `waivers` | Optional: recorded departures from a rule (below). The resolver passes them through |
| `notes` | Optional: an array of strings. JSON has no comments, so explanations go here |

A **bare value** (`"machine.nozzle": 0.6`) becomes an entry with status `user`
and source "layer file", keeping the earlier entry's unit. An **entry object**
takes `value` or `formula` and optional `status` (default `user`), `source`
(default "layer file"), `note` and `unit` (default: the earlier entry's unit).

A layer replaces a whole entry: a layer that sets `value` on a path that held
a formula drops the formula. A path the shipped profile does not have may be
added by any layer.

### Waivers

| Field | Holds |
| --- | --- |
| `rule` | The rule id from the process playbook, or the profile path |
| `feature` | Where on the part |
| `value`, `unit` | The measured or intended value |
| `limit` | The limit it departs from, as resolved when the waiver was made |
| `bound` | `{ "min": x }` or `{ "max": x }`: the waiver covers values on the safe side of the bound only, so it stops applying if the value moves further from the limit |
| `reason` | Why, in a sentence |
| `decidedBy` | `user` or `agent` (an agent's waiver is a proposal until the user confirms it) |
| `date` | `YYYY-MM-DD` |

## The cascade

Last wins:

| Order | Scope | File | Chosen by |
| --- | --- | --- | --- |
| 1 | `shipped` | `profiles/<process>.json` in this package | `--process`, else the nearest layer's `extends`, else `fdm` |
| 2 | `user` | `<config>/dfm/profile.json` | `--user <dir>` (the folder holding `profile.json`, or a `.json` file), `--no-user` to leave it out |
| 3 | `project` | `<project>/dfm/profile.json` | `--project <dir>` (or a `.json` file); default: the nearest folder above the part (or the current folder) holding `protoboard.config.ts` |
| 4 | `part` | `<part folder>/dfm.json` | `--part <dir>` (or a `.json` file) |
| 5 | `session` | none | `--set path=value`, repeatable |

`<config>` is the Protoboard config folder, resolved as the CLI and the PCB
style system resolve it (`packages/board-style/src/paths.ts`):
`PROTOBOARD_CONFIG_DIR` when set, else `%APPDATA%\protoboard` on Windows,
else `$XDG_CONFIG_HOME/protoboard`, else `~/.config/protoboard`.

Formulas are evaluated **after** the merge. A user who sets `machine.nozzle`
to 0.6 gets every dependent value recomputed; a value set explicitly in a
later layer wins over an earlier formula.

`--set` values: a number, `true` or `false`, a JSON array or object (so
`--set 'wall.min={"formula":"3*line.width"}'` sets a formula), else the text.

## The resolver

```bash
node <package>/skills/dfm/scripts/resolve-profile.mjs [--process fdm] [--project <dir>] [--part <dir>]
    [--user <dir> | --no-user] [--set path=value ...] [--format json|table] [--explain <path>] [--profiles <dir>]
```

`<package>` is `node_modules/@protoboardai/ext-dfm` in a project. The shipped
profiles are found at `--profiles <dir>`, else `../../../profiles` from the
script, else `node_modules/@protoboardai/ext-dfm/profiles` above the current
folder (for a copy of the skill exported to an agent host).

Output (`--format json`, the default), schema `protoboard.dfm.resolved/v1`:

```json
{
  "schema": "protoboard.dfm.resolved/v1",
  "process": "fdm",
  "profile": { "id": "fdm", "name": "FDM 3D printing" },
  "layers": [ { "scope": "shipped", "file": ".../profiles/fdm.json" }, { "scope": "project", "file": ".../dfm/profile.json", "notes": [] } ],
  "values": {
    "line.width": { "value": 0.675, "unit": "mm", "status": "typical", "source": "<URL>", "note": null,
                    "formula": "1.125 * machine.nozzle", "dependsOn": ["machine.nozzle"], "layer": "shipped", "file": ".../profiles/fdm.json" }
  },
  "waivers": [ { "rule": "...", "layer": "part", "file": ".../dfm.json" } ],
  "errors": [ { "path": "boss.od", "message": "unknown path \"insert.hole\" (read by the formula of \"boss.od\")" } ],
  "warnings": []
}
```

`layer` is `shipped`, `user`, `project`, `part` or `session`; `file` is the
layer file (null for the session). A path in error has `value: null` and an
entry in `errors`; the rest still resolves. `--format table` prints the same
as a table; `--explain <path>` prints every layer that set the path, the
winner, and the formula's inputs.

Exit codes: 0 resolved; 1 resolved with errors (a formula cycle, an unknown
path, a non-numeric input, an invalid entry); 2 usage or file errors (no
shipped profile for the process, a file that is not JSON or has the wrong
`schema`).

## Reference data beside the profiles

The package's `profiles/` folder may hold reference tables that are not
profiles (for example `materials-fdm.json` and `printers-bambu-lab.json`).
The resolver does not merge them; the process playbook says how to read them,
and a user or project layer copies the values it adopts (for example the
build volume of the user's printer) into its `values`.
