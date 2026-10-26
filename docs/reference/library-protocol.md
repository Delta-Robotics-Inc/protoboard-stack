# Library protocol: `uhd-library/v1`

Parts libraries speak UHD's open read protocol. The protocol is part of UHD
(public), not of the Protoboard Stack: **the specification is
[`docs/library-protocol.md`](https://github.com/Delta-Robotics-Inc/uhd/blob/mark/stack-v0.1/docs/library-protocol.md)
in the `uhd` repository** (draft 2, 2026-10-03; on `mark/stack-v0.1` until it
merges into UHD's `main`), with its types and a conformance kit in
`@deltarobotics/uhd/library` and the JSON Schema in
`schemas/uhd-library-v1.schema.json`. In a source checkout it is
`../uhd/docs/library-protocol.md`.

This page only says how the stack uses it.

## In one paragraph

A library serves UHD module definitions as immutable, numbered revisions. A
client finds it from a URL (`GET <url>/.well-known/uhd-library`, else
`GET <url>/v1`: the discovery document), searches `GET /parts`, and
downloads an exact revision as a **revision envelope**
(`uhd.part-revision/v1`): the definition, the exact revisions of the parts it
contains (`/closure`), and every file by SHA-256 (`/blobs/{sha256}`), each
verified before use. Publishing, review and accounts are each library's own
business and outside the protocol.

```sh
curl -s http://localhost:8787/.well-known/uhd-library
# {"protocol":"uhd-library/v1","name":"Protoboard parts library","id":"protoboard",…,"api":"/v1",
#  "envelopeSchemas":["protoboard.part-revision/v1","uhd.part-revision/v1"],"uhdSchema":{"min":"0.2.0","below":"0.4.0"},…}
```

## How the stack uses it

| Piece | What it does with the protocol |
| --- | --- |
| Protoboard Cloud (`protoboard-cloud`) | One library (id `protoboard`), the default. It adds publishing (`parts publish`, with a token), supplier offers (`parts offers`, `parts prices`) and, as declared extensions, an order for search (`x-sort`) with a relevance value per part; these are its own API, not the protocol. |
| `protoboard libraries` | Keeps the project's ordered list in `protoboard.config.ts`; `--check` fetches each discovery document. |
| `protoboard parts search / taxonomy` | Searches every library and merges the results, each tagged with its library. `--sort relevance\|name\|manufacturer\|updated` is passed to each library that declares the `x-sort` capability (the Protoboard library's extension: the protocol leaves the order to the library, and a library without it keeps its own order); a part's `relevance` value, when the library gives one, is in `--format json`. |
| `protoboard parts prices` | A part's prices by source from Protoboard Cloud's offers (its own API, not the protocol): supplier, its part number, price breaks, currency, stock, pack and minimum order, the link and when it was observed. How a price was fetched is not part of what the library serves. |
| `protoboard parts add / update` | Downloads an envelope and its closure, verifies every definition and file digest, then vendors them into `parts/catalog` and pins them in `parts/origins.json` (`library`, `service`, `revision`, `digest`, `envelopeDigest`, every file's digest). |
| `protoboard parts add / update` (source) | Also vendors the revision's definition source (protocol § 4.6), the part's `.uhd.ts` and the library modules it imports, into the same folder (`parts/catalog/<id>/<id>.uhd.ts`), after UHD's lint and an evaluation that must give the pinned definition digest; source that fails either is not written, and the part comes compiled. `--compiled` vendors the JSON only. `parts/origins.json` records the source's files, entry, export and the `uhd` and `typescript` ranges it requires. |
| `protoboard check` | Verifies the vendored bytes offline against those digests (`PB_DIGEST_MISMATCH`, `PB_VENDORED_FILE_MISMATCH`, `PB_VENDORED_FILE_MISSING`), lints and evaluates vendored source (confined) and reports one that breaks the lint (`PB_SOURCE_LINT`) or no longer evaluates to the pinned digest (`PB_SOURCE_DRIFT`, an edited vendored part) or a UHD or TypeScript outside its declared ranges (`PB_SOURCE_UHD_RANGE`, `PB_SOURCE_TS_RANGE`). It never calls a library. |
| VS Code Library view | The same search and add, with taxonomy filters and previews. |

Configuration (`libraries`, `authEnv`, `PROTOBOARD_USER_LIBRARIES`) is in the
[configuration reference](configuration.md#libraries). Read tokens come from
environment variables only.

## Boundary

UHD defines the protocol and the envelope; it holds no Protoboard parts data
and names no tool. Protoboard Cloud's parts, offers and publishing stay
private. Anyone can run a library that conforms, and a project can mix
libraries (see [UHD boundary](../specs/uhd-boundary.md)).

## Definition source

A library may ship each part's TypeScript beside its definition, the way an
npm package ships its code (UHD library protocol § 4.6). Protoboard Cloud
does for every part: `<id>.uhd.ts` and the library modules it imports
(`cad/artifacts.ts`, `series.ts`, `chip-passive.ts`, or the part it is
derived from).

- **The definition stays the contract.** The vendored JSON and its digest pin
  are unchanged; the source must evaluate to exactly that digest. Loading
  evaluates the source when it is present and uses what it gives when that
  is the pinned definition; `check` makes sure it still is.
- **Editing a vendored part** is drift: `check` reports `PB_SOURCE_DRIFT`
  (error) at the edited file, and the project builds the pinned JSON, never
  the drifted source. `protoboard parts add <id>@<rev>` restores it.
  To change a part, copy its source to `parts/local/` under a new id (a
  derived part). A change that leaves the definition alone (a comment) is
  `PB_SOURCE_EDITED` (info).
- **Versions.** Each part's source declares the `@deltarobotics/uhd` range it
  is written against (like a peerDependency) and the TypeScript it is written
  for. Projects pin both in `package.json` (`protoboard init` writes exact
  versions); `check` reports a UHD outside the range as an error and a
  TypeScript outside it, or not pinned, as a warning.
- **Safety.** Library source is limited to declarative UHD code: imports
  only `@deltarobotics/uhd` and its own files; no file system, network,
  `process`, timers, `eval`/`Function`, dynamic `import()` or reflection
  (`Reflect`, `prototype`, `getPrototypeOf`, a string such as
  `"constructor"`). UHD's `lintSource` enforces this when the library
  publishes, when `parts add` vendors and whenever a project loads
  (`PB_SOURCE_LINT`). The lint is lexical, so library source is never run
  in the CLI's own process: it is evaluated **confined** (UHD's
  `evaluateSourceConfined`), in a child Node process that reads only the
  closure and the project's UHD, writes nothing, starts no process, cannot
  generate code from strings and sees none of the environment (no tokens).
  Only its export comes back, as JSON. Source that fails the lint or does
  not give the pinned digest is never written. The library evaluates it the
  same way before it publishes it.
