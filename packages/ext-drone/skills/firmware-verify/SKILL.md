---
name: firmware-verify
description: Verify a generated flight-controller configuration on the real hardware, props off — apply the CLI, diff the result, then check ports, receiver and telemetry, OSD, GPS, compass alignment, motor order and direction, bidirectional DShot and the current sensor, resolving every UNVERIFIED item in the firmware reference — and record the result as measured test data. Use after firmware-config, before any flight, and after any firmware or wiring change. Physical effects: a person performs or authorises each step.
---

# Firmware verify (bench)

Everything here happens on a physical unit. An agent can prepare the
checklist, read dumps and logs, and record results; a person connects the
battery and spins motors. **Props off for every step.** First power through a
current limiter (smoke stopper or bench supply at ~1 A).

## Purpose

Close the gap between a configuration that agrees with the model and one
that works on the unit: pads, directions, alignment and sensor scales can
only be confirmed on hardware. Use it after **firmware-config**, before any
flight, and after any firmware or wiring change. In **build-a-project** it
comes after the release (stage 11): the unit under test is built from a
release, and the result is recorded against it. An agent prepares and
records; a person performs or authorises every physical step.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The release and unit under test | release name and unit serial | **release** |
| The generated configuration and its record | `firmware/<fw>/cli.txt`, `operations/` | **firmware-config** |
| Firmware version and build options it asks for | the CLI header (`# Target … firmware >= … cloud build options …`) | **firmware-config** |
| The UNVERIFIED list | `firmware-config/references/betaflight-reference.md` | **firmware-config** |
| The generator's warnings | `npx protoboard run betaflight-cli --format json` → `data.warnings` | **firmware-config** |
| A person at the bench | with the unit, a current-limited supply, a clamp meter, a multimeter | the operator |

## Steps

### 1. Prepare

- The release/revision and unit serial under test (**release**).
- `firmware/<fw>/cli.txt` and its operation record; the firmware version and
  build options it asks for.
- The UNVERIFIED list from the reference
  ([betaflight-reference.md](../firmware-config/references/betaflight-reference.md))
  and the generator's warnings:

```bash
npx protoboard run betaflight-cli --format json      # data.warnings; the run must not change cli.txt (git diff firmware/)
```

### 2. Flash and apply (a person does this)

1. Flash the stated firmware with the stated build options (a missing `MAG`
   option silently compiles the compass driver out).
2. CLI: `diff all` → save as `firmware/<fw>/bench/<date>-before.txt`.
3. Paste `cli.txt`; the FC reboots on `save`.
4. `diff all` again → `…-after.txt`. Every generated line must appear (or be
   the firmware default, which `diff` omits); any rejected line is a finding
   against the reference.

### 3. Checks (each: expected from the model, observed, pass/fail)

| Check | Expected (model) | How |
| --- | --- | --- |
| Pads = UARTs | the link's UART is the pad you soldered | Ports tab lists the functions on the right UARTs; each peripheral works (below). Resolves "pads labelled as the target expects". |
| Receiver | CRSF on the receiver link's UART | Receiver tab: sticks move the right channels; telemetry (RSSI, battery) reaches the radio. |
| OSD | MSP DisplayPort on the air-unit link's UART | OSD elements visible in the goggles, HD canvas. |
| GPS | GNSS on its UART, auto-config | Sats and fix in the GPS tab (outdoors); the module's baud was negotiated. |
| Compass | detected at the model's I2C address; `align_mag` per the maker | Sensors tab shows MAG; rotate the craft: heading follows (N-E-S-W), no mirror. Resolves the alignment item. |
| Motor order | Quad-X order from the phase links | Motors tab, props off: M1 rear-right, M2 front-right, M3 rear-left, M4 front-left spin. |
| Motor direction | the spin the model states for each arm | Each motor's direction matches its prop's handedness; fix with the ESC tool (AM32) or `motor_direction` per the firmware, then record. |
| Bidirectional DShot | both parts state it (weak source: say which) | Motors tab shows RPM with ~0 % error. Otherwise turn it off and record the finding against the part. |
| Current sensor | the ESC's `ibata_scale` | Compare the FC's current with a clamp meter at 2–3 loads; adjust scale only with a recorded measurement. |
| Voltage | `vbat_scale` default | FC voltage vs multimeter within 0.05 V/cell. |

### 4. Record

Write `docs/test-data/firmware-bench.json` (status `measured`; **test-and-measure**):
conditions (release, unit, firmware version, build options, cli.txt sha256),
columns `check`, `expected`, `observed`, `pass`, one row per check, raw files
(`before`/`after` dumps, screenshots, Blackbox logs). Validate it:

```bash
npx tsx node_modules/@protoboardai/ext-hardware/skills/test-and-measure/scripts/test-data.ts docs/test-data/firmware-bench.json
```

Feed every failure back: a wrong pad mapping or alignment becomes a model fix
(part fact or link), then regenerate the CLI — never a hand edit of
`cli.txt`.

## Decision points

| Decision | Rule |
| --- | --- |
| Continue after a failed check | Stop before anything that spins or powers more: fix the model, regenerate, re-apply, re-check. |
| A rejected CLI line | A finding against the reference; correct the reference (source-pinned) and the generator, not the dump. |
| Adjust a scale | Only with a recorded measurement at two or more loads. |
| The NOT FLIGHT-TESTED header | May be reconsidered only when every check passes, and only for the recorded firmware version and unit. |
| Who acts | A person performs every physical step; an agent prepares, reads and records. |

## Outputs

| Output | Where |
| --- | --- |
| Before/after dumps | `firmware/<fw>/bench/<date>-before.txt`, `<date>-after.txt` |
| The measured result | `docs/test-data/firmware-bench.json` |
| Model fixes | the parts and links (through **uhd-part-author**, **system-compose**), then a regenerated `cli.txt` |

## Verification

`test-data.ts` passes on `firmware-bench.json`; every row of the checks table
has an observed value and pass/fail; every UNVERIFIED item in the reference
is resolved or still listed with the reason; the release and unit are named
in the file's conditions.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| A generated line rejected by the CLI | The reference is wrong for this version | Fix the reference and generator (**firmware-config** step 2) |
| A peripheral works on another UART than the link says | Pads not labelled as the target expects, or the link is wrong | Fix the link or the FC part's pad facts; regenerate |
| Heading mirrored or rotated | `align_mag` is wrong for the mounting | Fix the GNSS part's alignment fact from the maker; regenerate |
| A motor in the wrong position or direction | Phase links or spins disagree with the mixer | Remap or rewire, record the decision; fix the model to match |
| RPM telemetry errors | Bidirectional DShot does not work with this ESC firmware | Turn it off; record the finding against the part |
| `test-data.ts` fails | The record is incomplete or has placeholders | Complete it; never commit a placeholder as measured |
| `UHD_PROP_HANDEDNESS` | Spins not set or mismatched in the model | **system-compose**: set `spin` per arm |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).
