# Style: <theme name> (<domain>)

Generated from the resolved style, the decisions logs and the examples. Do not edit by hand: change a token in your
layer or record a decision, then regenerate. Resolved on <YYYY-MM-DD> with the resolver in
`@protoboardai/ext-style` (`--domain <domain> --project . --dfm <profile>`).

- Theme chain: <base> > ... > <theme id> (found in: shipped | user | project)
- Layers present: user <yes/no>, project <yes/no>, item <yes/no>
- Process checked: <process and DFM profile file> | not checked against a process
- Words for the look: <identity.words>

## How to use this style

1. Read this guide, the decisions below and the example captions before designing; open the images whose captions
   match the task.
2. Apply the effective values through the domain's own procedure (for CAD, the cad-style skill).
3. Where a preference was adjusted by the process (below), use the effective value and tell the user why.
4. Report drift as information or warnings; style never blocks. A process limit that the design breaks is a
   manufacturing finding, not drift.
5. When the user says "I'd rather it look like this", restate it as token changes, preview, ask the scope, record
   the decision, write the layer, and regenerate this guide.

## Adjusted by the process

| Token | Preference | Effective | Why |
| --- | --- | --- | --- |
| <path> | <value> | <effective> | <floor or ceiling formula = value, from the DFM profile> |

## Core tokens

| Token | Value | Set by | Note |
| --- | --- | --- | --- |
| <path> | <value> | <layer, decision> | <reference, asset status> |

## <Domain> tokens by class

### Process (bounded by the manufacturing process)

| Token | Value | Effective | Set by | Bound |
| --- | --- | --- | --- | --- |

### Structural (never changed for looks)

| Token | Value | Set by | Guard |
| --- | --- | --- | --- |

### Layout (changed only when asked)

| Token | Value | Set by | Guard |
| --- | --- | --- | --- |

### Cosmetic

| Token | Value | Set by | Note |
| --- | --- | --- | --- |

## Decisions

Rules that are not tokens:

- <rule> (<id>, <scope>)

Newest first:

- <id> (<scope>, <date>, <accepted | superseded by id>): "<the user's words>": `<path>` to <value>

## Examples

- <layer>: `<file>`: <title> [<tags>]. Copy: <copy>. Avoid: <avoid>.

## Marks and assets

- `<asset id>` (<layer>, <kind>): <status>; license <license>; <hash verified | HASH MISMATCH>; <source>
