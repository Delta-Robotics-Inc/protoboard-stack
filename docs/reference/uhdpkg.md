# Part package format (`.uhdpkg`, `protoboard.uhdpkg/v0`)

A `.uhdpkg` is one part revision in one file: the part revision envelope
(`protoboard.part-revision/v1`, or `uhd.part-revision/v1` from the UHD
library protocol; [packages/cloud/src/envelope.ts](../../packages/cloud/src/envelope.ts))
**unchanged**, plus the files it lists, zipped. It is how a part travels
without a library: to a customer, between machines, into an archive. PB-1195.

The envelope already says everything about every file: path, sha256, size,
media type, role and licence terms. So the package's manifest *is* the
envelope, and **nothing in UHD changes**: no new field, no new role, no new
schema. The code is in [packages/core/src/uhdpkg/](../../packages/core/src/uhdpkg/);
the command is `protoboard package` ([packages/cli/src/package.ts](../../packages/cli/src/package.ts)).

Values marked DEFAULT were chosen overnight on 2026-11-01 with no ruling
and can be revisited; each is marked `DEFAULT` in the code too.

## Layout

```text
demo-part-r1.uhdpkg                 a zip (no zip64; stored or deflated entries)
  uhdpkg.json                       the manifest: always the first entry
  parts/local/demo-part/out/body.glb    every file the envelope lists, at its envelope path
  parts/local/demo-part/body.step
  parts/evidence/demo-part/sources.json
  derived/<sha256>/<name>           optional build outputs (below), never part of UHD
```

Entries are sorted by path (byte order) after the manifest. Every timestamp
is the DOS epoch (1980-01-01 00:00, DEFAULT), the "made by" host is MS-DOS
with no external attributes (no Unix mode: no exec bits, no symlinks), names
are UTF-8. An entry is deflated (zlib's default level, DEFAULT) when that
makes it smaller, else stored; `--stored` stores everything. The same input
gives the same bytes: two writes are byte-identical, and so is a `read`
followed by a `write` of the unpacked folder (for the same zlib build).

## The manifest (`uhdpkg.json`)

```json
{
  "createdAt": "1980-01-01T00:00:00.000Z",
  "createdBy": "@protoboardai/core 0.2.2",
  "envelope": { "schema": "protoboard.part-revision/v1", "partId": "demo-part", "revision": 1, "artifacts": [ … ], … },
  "required": ["envelope"],
  "schema": "protoboard.uhdpkg/v0"
}
```

Written as sorted-key JSON with two-space indent.

| Member | Meaning |
| --- | --- |
| `schema` | `protoboard.uhdpkg/v0` (v0: may change before 1.0, DEFAULT). Any other value is an error. |
| `envelope` | The part revision envelope exactly as the CLI builds it for `parts publish` and reads it for `parts add`: no field added or dropped. A published envelope keeps `publisher` and `createdAt`. |
| `required` | Names a reader must understand to use the package. Known: `envelope` (always listed), `derived`. **An unknown name is an error, not a warning** (as an unknown glTF required extension is). |
| `createdBy` | The stack's core package and version. |
| `createdAt` | DEFAULT: `--created-at` when given, else the envelope's `createdAt` (a published revision), else `1980-01-01T00:00:00.000Z`, so a write is reproducible. |
| `derived` | Optional: the `derived/` entries, each `{ path, key, sha256, size, mediaType? }`. |
| `provenance` | Optional, informational: `{ kind: "local-part" \| "catalog-vendored" \| "folder", pinnedEnvelopeDigest?, note? }`. |

Any other top-level member is ignored with a warning (`MANIFEST_MEMBER_UNKNOWN`).

### Files the envelope carries

Every `artifacts[]` entry, every `evidence[]` entry that has a `path`, and
every `source.files[]` entry is a package entry at its `path`; its bytes
must have the envelope's `sha256` and `size`. The paths `uhdpkg.json` and
anything under `derived/` are reserved: an envelope that uses them cannot be
packaged.

### Derived entries (build outputs, never UHD)

Part and project digests (about 1.2 KB a part) and vendor-frame sidecars are
build outputs. They never enter the envelope or UHD. A package may carry
them under `derived/<key>/<name>`, where `<key>` is the sha256 of the
envelope file they describe (the CAD file's hash), listed in the manifest's
`derived` with their own sha256 and size, and checked like every other
entry. A key that matches no carried file is refused at write and a warning
at read (DEFAULT). The CLI does not yet add derived entries; the core API
does (`buildPackage({ derived: [...] })`).

## Where `write` gets the envelope

- **A project part** (`parts/local/`, or a definition the project's own
  sources declare, such as a board): the envelope `parts publish` would send,
  built offline by the same function (`localPartDraft` in
  [parts.ts](../../packages/core/src/parts.ts)). Publish asks the library for
  the next revision; offline the revision is DEFAULT the one after the
  project's last publish (`parts/origins.json` `published`), else 1. Children
  are pinned at the catalog revisions the project vendored; a child that is
  not a catalog part is an error unless `--allow-unpinned` (then readers
  report `DEPENDENCY_MISSING` as a warning).
- **A catalog part** (`parts add`): the project keeps the library's envelope
  digest, not the envelope, so an equivalent envelope is rebuilt from the
  vendored definition (its bytes are the pinned `definitionDigest`) and the
  vendored files (their pinned sha256), with the same fields. DEFAULT, since
  the project does not record them: roles from the definition's artifacts
  (else `attachment`), media types from the file extension (the table
  `parts publish` uses), no licence terms, `derivedFrom: null` (readers warn
  `DERIVED_FROM_REQUIRED`), no definition source. Its digest therefore
  differs from the pinned one, which `provenance.pinnedEnvelopeDigest` keeps.
- **A folder** holding `uhdpkg.json` (an unpacked package) or `envelope.json`
  (an envelope as a library serves it), with the files at their envelope
  paths. A file whose real path leaves the folder is refused.

`--exclude <path>` leaves a carried artifact out of a project part's package
(for a file over the caps): it moves to the envelope's own `missingArtifacts`
with the reason `left out of this package (uhdpkg --exclude)`, and the
envelope is resealed. Evidence files cannot be left out (the envelope has no
place to say so).

## Caps (DEFAULT)

Read and write apply the same caps, so a writer never makes a package no
reader opens. The core API takes overrides (`caps`); the CLI uses these.

| Cap | Value |
| --- | --- |
| Archive size | 256 MiB, checked before the file is read |
| One entry, uncompressed | 128 MiB, checked from the directory before inflating |
| All entries, uncompressed | 512 MiB |
| Entries | 10,000, checked before the directory is walked |
| Compression ratio | 200:1, for entries of 1 MiB or more (zip bombs) |
| `uhdpkg.json` | 4 MiB |
| Entry name | 1024 bytes; 255 a path segment |

Inflation also stops at an entry's declared size (`maxOutputLength`), so a
directory that lies about a size cannot make the reader allocate past it.

## What is refused

Each refusal is a stable code in the report.

- **Names** (`ENTRY_NAME`; and `ENVELOPE_PATH` for an envelope path): empty;
  absolute (`/x`); a drive (`C:`, `C:\x`, `C:x`); a backslash anywhere
  (`a\..\b`); an empty, `.` or `..` segment; a trailing `/` (directory
  entries: packages carry files only); any of `< > : " | ? *`; a control
  character (U+0000 to U+001F, U+007F); a segment ending in a dot or a space;
  a Windows device name as a segment's base name, any case, with or without
  an extension (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`,
  their superscript-digit forms, `CONIN$`, `CONOUT$`; `con.txt` is refused,
  `console.txt` is not); an entry the directory marks as a symbolic link,
  directory, device, pipe or socket.
- **Duplicates** (`ENTRY_DUPLICATE`): two names equal after Unicode NFC and
  lower-casing (the same file on Windows and macOS), or a file that another
  name needs to be a folder (`a` and `a/b`).
- **The zip**: not a zip or truncated (`ZIP_TRUNCATED`), bytes after the end
  record (`ZIP_TRAILING`), zip64 (`ZIP64`), multi-disk, encryption, a method
  other than stored or deflated, a local header naming another file than the
  directory (`ZIP_NAME_MISMATCH`), a size or CRC-32 that does not match
  (`ZIP_SIZE`, `ZIP_CRC`).
- **The manifest**: not first (`MANIFEST_MISSING`), not JSON, another schema,
  an unknown `required` name (`REQUIRED_UNKNOWN`), no envelope.
- **The envelope**: the parts service's own structural checks
  (`validateDraft`), including `DIGEST_MISMATCH` for an envelope edited
  after sealing. Three of its codes are warnings here, not errors, because
  they are rules about the catalog rather than about the package's
  integrity: `DERIVED_FROM_REQUIRED`, `DEPENDENCY_MISSING`,
  `UHD_SCHEMA_UNSUPPORTED` (DEFAULT). The service still applies them on
  publish.
- **Content**: an entry whose sha256 (`ENTRY_SHA256`) or size (`ENTRY_SIZE`)
  differs from the envelope; an envelope file the zip lacks
  (`ENTRY_MISSING`); an entry the envelope (and the manifest's `derived`)
  does not list (`ENTRY_UNEXPECTED`).
- **Caps**: `CAP_ARCHIVE`, `CAP_ENTRY`, `CAP_TOTAL`, `CAP_ENTRIES`,
  `CAP_RATIO`, `CAP_MANIFEST`.

Nothing in a package is ever executed, imported, required or evaluated, and
no install script is run: entries are bytes that are hashed and, for `read`,
written with mode 0o644.

## `read`: unpacking

`read` runs every check above. Files are written only after their bytes
matched the envelope, into a temporary folder beside the target; each
resolved path (and the real path of each folder made for it) must lie
inside that folder's real path (zip-slip), and files are created with `wx`
(never through an existing file or link). The folder is renamed into place
only when the whole package passed, so a failed read leaves nothing. The
target must not exist or be an empty folder (DEFAULT: a package never writes
over files). The unpacked folder holds `uhdpkg.json` and the files, so
`write` packs it again to the same bytes.

**Before you move an unpacked part into a project**: `read` runs nothing, but
a project does. A part's `*.uhd.ts` (and any other source) placed under
`parts/local/` is loaded, which means run, by the next `protoboard check` or
`build` through the default source globs. Read the unpacked sources first,
as you would any code from someone else, and only then move the folder into
`parts/local/` (wave 4 gate).

## Commands

```text
protoboard package write <part-id | folder> [--out <file.uhdpkg>] [--exclude <path>]... [--allow-unpinned] [--created-at <iso>] [--stored]
protoboard package read <file.uhdpkg> <folder>
protoboard package verify <file.uhdpkg>
```

All three take `--json`. Exit 0 when the package is sound, 1 when a check
fails. `write`'s default output is `<part-id>-r<revision>.uhdpkg` in the
working folder (DEFAULT).

```text
$ protoboard package write iso-4762-m3x8          # in examples/quadcopter-5in
wrote …/iso-4762-m3x8-r1.uhdpkg: iso-4762-m3x8@1, 7 file(s), 0.05 MiB in, 0.02 MiB packed, 1586 ms
  envelope sha256:5f3050ac78af58a668aad0bca8ef42fdaf17a7e9acdb529377fbfddc8faf34ce

$ protoboard package verify iso-4762-m3x8-r1.uhdpkg
verify iso-4762-m3x8-r1.uhdpkg: OK  iso-4762-m3x8@1  protoboard.part-revision/v1  archive 0.02 MiB, files 0.06 MiB
  envelope sha256:5f3050ac78af58a668aad0bca8ef42fdaf17a7e9acdb529377fbfddc8faf34ce
  manifest        8652  sha256 OK  uhdpkg.json
  evidence         593  sha256 OK  parts/evidence/iso-4762-m3x8/sources.json  terms unknown
  evidence        1142  sha256 OK  parts/evidence/iso-4762-m3x8/verification.json  terms unknown
  artifact         343  sha256 OK  parts/local/iso-4762-m3x8/cad.config.ts  [attachment]  terms unknown
  artifact         248  sha256 OK  parts/local/iso-4762-m3x8/frame-cad/params.json  [source]  terms unknown
  artifact       21088  sha256 OK  parts/local/iso-4762-m3x8/out/body.glb  [body]  terms unknown
  artifact         542  sha256 OK  parts/local/iso-4762-m3x8/out/body.manifest.json  [source]  terms unknown
  artifact       32498  sha256 OK  parts/local/iso-4762-m3x8/out/body.step  [body]  terms unknown
5 ms

$ protoboard package write pcb-b1-4 --allow-unpinned --exclude src/modules/pcb-b1-4/out/body.step --exclude cad/board-step/<board>.step
$ protoboard package read pcb-b1-4-r1.uhdpkg ./pcb-b1-4
```

`verify` lists each entry with its size, sha256 OK or BAD, role and licence
terms (`terms unknown` when the envelope gives none), then the errors and
warnings.

## Measured (2026-11-01, W4-D / PB-1195)

Node 24.11.0 on Kevin's Windows 11 machine, through the core functions
(`node --import tsx measure.mts <project> <part> <label> [...]`, a scratch
script that calls `inputFromProjectPart`, `writePackage`, `verifyPackageFile`
and `readPackage`). "Envelope" is loading the project and building the
envelope (most of it is loading the project's TypeScript); write, verify
and read are the package steps alone. Every package was byte-identical when
written twice, verified clean and unpacked.

| Part | Kind | Files | In | Archive | Envelope | Write | Verify | Read |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drone `dolphinrc-m3-grommet-esc` | project part | 7 | 29.3 KB | 12.2 KB | 3.0 s | 9 ms | 4 ms | 23 ms |
| drone `meps-neon-2207-v2-1950kv` | catalog (rebuilt) | 13 | 1.27 MB | 228 KB | 2.2 s | 36 ms | 12 ms | 43 ms |
| drone `matek-m9n-5883` | catalog (rebuilt) | 11 | 9.19 MB | 2.12 MB | 2.1 s | 193 ms | 46 ms | 84 ms |
| ClientX `pcb-b1-4`, both STEPs excluded | project board | 3 | 31.8 MB | 5.50 MB | 2.9 s | 549 ms | 133 ms | 163 ms |
| ClientX `pcb-b1-4`, caps raised to 200 MiB an entry, 512 MiB an archive | project board | 5 | 323 MB | 52.4 MB | 2.4 s | 6.6 s | 1.4 s | 1.7 s |

With the default caps the ClientX board is refused at write: its source
STEP (148,203,193 bytes) and its `out/body.step` (143,464,657 bytes) are
each over the 128 MiB entry cap (`CAP_ENTRY`, with the `--exclude` hint), and
its children are board sections, not catalog parts (`DEPENDENCY_UNPINNED`
without `--allow-unpinned`). The 31.8 MB `body.glb` deflates to about 5.4 MB.

## Not in it (no UHD change)

- No UHD field, role, schema or structure is added or changed. The manifest
  wraps the envelope; it does not extend it.
- Mark's agenda items stay out of this format and out of UHD until he
  decides them: a LOD or tier field, new artifact roles, richer mates, and
  `AssemblySequence`.
- Part and project digests and vendor frames are build outputs: at most
  optional `derived/` entries keyed by the CAD file's sha256, never envelope
  or UHD members.
- No signatures: the envelope's digests make a package self-consistent, not
  authenticated. A package from a library is as trustworthy as the library.
- No zip64: a package is at most 4 GB by the format and 256 MiB by the cap.
