# Protoboard Stack 0.2.0 — release notes

0.2.0 is the first public release of Protoboard Stack. The stack, the VS Code
extension, the cloud client and the viewer are open source under Apache-2.0,
and local work needs no account. The [0.1 release notes](stack-v0.1.md)
describe the line before it.

## 0.2.0

### Versions

| Package | Version |
| --- | --- |
| `@protoboardai/*` (core, cli, cloud, views, web-viewer and the twelve extensions) | 0.2.0 |
| The VS Code extension (`deltarobotics.vscode-protoboard`) | 0.2.0 |
| `@deltarobotics/uhd-viewer` | 0.2.0 |
| `@deltarobotics/uhd` (pinned by new projects) | 0.3.0 |

The stack's packages depend on each other at `^0.2.0`, and every extension
declares `compatibility.protoboard: "^0.2.0"`.

### Upgrading a 0.1 project

A project made with 0.1.x asks for `^0.1.x`, which 0.2.0 is not: `protoboard
stack link` does not link it to a 0.2.0 copy, and an extension that carries
0.2.0 says the project asks for another version. One command moves it, offline:

```sh
cd my-project
git commit -am "Before Protoboard 0.2"     # so the changes can be reviewed
protoboard upgrade --dry-run               # what would change
protoboard upgrade
protoboard check
```

`upgrade`:

1. rewrites `package.json`: every `@protoboardai/*` range becomes `^0.2.0`,
   `@deltarobotics/uhd` becomes 0.3.0 and an exact `typescript` pin follows
   the stack's (a `file:`, git or tag spec is left as it is);
2. links the project's packages again, to a stack copy that fits (a project
   whose packages npm installed is told to run `npm install`);
3. refreshes `AGENTS.md` and `CLAUDE.md` with this version's guidance
   (`init --refresh-guidance`), keeping the project's own sections, and
   exports the skills;
4. moves vendored parts to the current folder layout (`parts migrate`).

In VS Code, a project like that shows **Update Project to Protoboard 0.2**;
the command is **Protoboard: Update Project to This Extension's Protoboard
Version**.

Projects now pin UHD 0.3.0: `protoboard check` after the upgrade checks the
project's own `.uhd.ts` sources and its vendored parts against it.

### What changed

**Open source and local first**

- Apache-2.0 for the stack, the extension, the viewer and the cloud client,
  with `LICENSE` and `NOTICE` in every package, contributions under a DCO
  sign-off ([CONTRIBUTING.md](../../CONTRIBUTING.md)) and a trademark policy
  ([TRADEMARKS.md](../../TRADEMARKS.md)).
- Only the hosted parts library needs a sign-in. `init`, `check`, `build`,
  `dev`, the viewer, circuits, CAD, firmware, releases and the MCP tools work
  with no account; library commands say once that they need one and stop with
  exit code 4 ([distribution](../specs/distribution.md#sign-in-for-the-cloud)).
- `protoboard setup` installs the extension by its id from the Marketplace
  (VS Code) or Open VSX (Cursor, Windsurf, VSCodium), then offers the `PATH`
  and the agents, with no sign-in; `protoboard setup --vsix <file>` installs
  a package offline.
- The cloud client, `@protoboardai/cloud`, is part of this repository
  (`packages/cloud`): the stack builds and tests from one clone beside UHD
  and the viewer.

**Modelling and checks**

- UHD 0.3.0: net ports, derivation through them, and a board marker; nested
  boards and the KiCad handoff use them ([nested boards](../specs/nested-boards.md),
  [PCB handoff](../specs/pcb-kicad-handoff.md)).
- Locked boards, and 3D model names unique by content.
- The diagram an agent builds is laid out and checked (`protoboard layout`,
  `PB_DIAGRAM_LAYOUT`).

**VS Code**

- The hierarchy is in each viewer tab; the Inspector is the right sidebar,
  with expandable interface cards.
- Right-drag pans the canvas; the legend becomes a toolbar item when the tab
  is narrow.
- Kode Mono throughout, and shorter UI wording.
- `protoboard --version --json` and `doctor` say which build is running
  (release or development, and its commit).

**Agents**

- `protoboard agents setup` connects the agents found on the machine to the
  stack's MCP server; every project's `AGENTS.md` carries the guidance
  between markers that `init --refresh-guidance` and `upgrade` keep current.

### Known limits

- Extensions run TypeScript source through `tsx`; there is no compiled build.
- The release publishes one `.vsix` per platform (about 43 MB each), each
  built on its own platform's runner; a `.vsix` built locally without a
  target carries the stack for all six (about 70 MB).
- CAD generation needs Python with build123d (`protoboard tools install cad`).

### In detail

- **Only the cloud needs a sign-in.** The stack is open source from
  this release, and the hosted cloud is the paid part, so local work no
  longer asks for an account. `init`, `check`, `build`, `dev` and the
  viewer, `layout`, `views check`, `run` (circuit generate, export, KiCad,
  lock; CAD; firmware), `release`, `bom`, `doctor` and every other local
  command run signed out, and so do the MCP tools that work on the project.
  In VS Code nothing is covered or disabled: the viewer and CAD tabs, the
  Inspector, the hierarchy, DRC, Project Parts' list and the BOM work as
  signed in, and checks and the dev server start at once.
  - **What needs an account: the whole library, browsing included.**
    `parts search`, `parts taxonomy`, `libraries`, `parts add`, `parts
    update`, `parts list --check`, `parts offers`, `parts prices` and
    `parts publish`, and a template's library parts at `init`. Signed out,
    these stop before changing anything, with "… needs a Protoboard
    account: sign in with `protoboard login`" and exit code 4
    (`SIGN_IN_REQUIRED` in JSON); the MCP tools `parts_search` and
    `parts_add` answer `signInRequired`. `init --template` signed out makes
    the project and leaves its library parts for later (`partsSkipped`
    names the command). This reverses 0.1's open browsing: the
    library is the paid cloud, so signed out there is no access to it
    anywhere.
  - **In VS Code:** the Library's screens show **Sign in to use the
    Protoboard library** in place of the library. **Fetch Parts**, **Add
    Part…**, the update check, **Update**, **Restore**, **Compare**, offers
    and **Submit for Verification…** ask to sign in. The status bar shows
    the account state. The walkthrough's sign-in step is optional and comes
    after the project and the viewer.
  - **The service enforces it.** With sign-in on, the parts service
    refuses every read of the library without a sign-in (`401
    AUTH_REQUIRED`): search, facets and taxonomy counts, part pages and
    revision lists, full revisions and closures, files (thumbnails too),
    kits, offers, and the redistributable view (`/distributable/v1`,
    `?distribution=redistributable`), which served full revisions to anyone
    before. Only discovery (without the library's counts), the account,
    device sign-in and the list of downloads stay open; discovery now says
    `auth: { read: "bearer" }`. The client's line is a courtesy that a fork
    may remove.
  - **Secure by default.** The parts service's image signs users in
    (`PB_CLOUD_AUTH=firebase`) and does not start without the accounts'
    project; a production process without `PB_CLOUD_AUTH` does not start
    either. A service without sign-in, which serves the whole library to
    anyone, is only ever asked for (`PB_CLOUD_AUTH=none`: `npm run dev`,
    docker compose, the tests).
  - **Removed:** the `SIGN_IN_REQUIRED` switch and `PROTOBOARD_SIGN_IN`
    (nothing needs turning off), the viewer tab's sign-in overlay, the CAD
    tab's sign-in card, and the disabled state of 45 commands. A service
    that cannot be reached no longer refuses a command; the command says
    what it could not reach.
  - The MCP server's `project_status` mentions the sign-in once, at the end,
    unless the project's own CLI is from before 0.2.0 and gates everything.

- **UHD 0.3.0.** The stack runs on `@deltarobotics/uhd` 0.3.0: core needs
  `^0.3.0`, the extensions, the views and the viewer `>=0.3.0`, and
  `protoboard init` pins 0.3.0. **A project moves its pin**: in
  `package.json`, `"@deltarobotics/uhd": "0.3.0"`, then `npm install`. A
  project still pinned at 0.2.1 gets its own copy of 0.2.1 beside the
  stack's, and its definitions no longer type-check against the stack's
  types (`Type '"board"' is not assignable to type 'ModuleKind'`).
  Definitions written for 0.2 are valid 0.3 definitions unchanged.
  - **Catalog parts keep working.** A part's source declares the UHD line it
    was written for (`^0.2.0`). UHD 0.3 reads 0.2 definitions unchanged, so
    `check` and `parts add` accept that source under 0.3.x; a range of
    another line is still `PB_SOURCE_UHD_RANGE`.
  - **The parts service and client read both lines** (`>=0.2.0 <0.4.0`). A
    revision published from a library built with UHD 0.3.0 records
    `uhdSchema` 0.3.0, which a 0.1.x stack refuses
    (`UHD_SCHEMA_UNSUPPORTED`): publish such revisions only once users have
    0.2.0.
- **Net ports in nested boards.** A sub-module exports one of its own nets
  as a net port, `exports: [{ id: "vdd", from: { self: true, interfaceId:
  "vdd" } }]`, instead of an arbitrary pin of the net. The board netlist
  joins the parent's net (or a pin linked straight to the port) to the
  sub-module's net, at any depth and through re-exports; the conductors,
  names and aliases are those of the exported-pin idiom, which still works.
  A child's net without a port is still refused (`net_not_own`), now with
  the fix. A net port on the board's edge carries its whole conductor
  (`edge[].net`). An unconnected net port is noted like an unconnected pin
  export. UHD now derives a bus or supply crossing as nets (the old "known
  gap"), and `check` reports at the board a sub-module's supply port that
  nothing feeds (`UHD_UNPOWERED`, `<child>:<port> … is a net port feeding …`).
- **`kind: "board"`.** A module marked as one PCB is a separate board in its
  parent's reading (rule 3 of the nested-boards spec), whatever else it
  states; a bought module with a part number or package is still a part. The
  Explorer shows it as a board, and the viewer tags it BOARD.

- **Library parts use UHD 0.3.0's piezo and charge vocabulary** (not yet
  published): the atomiser disc and the Bartels BP7 are piezo loads, the
  Seeed atomiser board and the mp-Lowdriver piezo drives, the 2500 mAh LiPo
  and the BQ24074 have charge ports, so UHD checks drive voltage and
  frequency, element count, chemistry, charge voltage and current.
  `verify-part` knows the new protocols.
- **Third-party licences ship with the bundles.** The web viewer's `dist/`
  and the `.vsix` carry `THIRD_PARTY_LICENSES.md`: every third-party package
  inside their bundles (75 and 81), with its licence text
  (`scripts/third-party-licenses.mjs`, run by the web viewer's build and by
  the extension's `package.mjs`). The other packages run from their sources
  and bundle nothing.
