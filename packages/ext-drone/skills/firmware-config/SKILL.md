---
name: firmware-config
description: Derive a controller's firmware configuration from a UHD system's links and part facts — Betaflight CLI for flight controllers today (protoboard run betaflight-cli; the same method for INAV, ArduPilot or PX4), and the firmware capability's pin and peripheral configuration for microcontroller boards as it lands — with every line citing the link or fact it comes from and every setting checked against the firmware's own source at a pinned version. Use when a system has a controller and its wiring is modelled, when wiring changes, or when moving firmware versions; follow with firmware-verify on the bench.
---

# Firmware configuration from the model

```
UHD links + part facts ──► reference doc (settings verified in firmware source, pinned) ──► generator
                                                                                              │
          firmware/<fw>/cli.txt  (every line: "# link <id>: …" or "# <part>: <fact>")  ◄──────┘
                                                                                              │
                                                              firmware-verify (bench) ◄────────┘
```

The configuration is a *view* of the model: which UART the receiver is wired
to is a link, the current-sensor scale is an ESC fact, the compass address is
a GNSS fact. Nothing is typed from memory, and nothing is claimed flight-ready.

## Purpose

Produce the controller configuration a unit is flashed with, derived from the
model so it cannot disagree with the wiring silently. Use it when a system
has a flight controller or a microcontroller board and its wiring is
modelled, whenever wiring changes, and when moving firmware versions. In
**build-a-project** it is stage 9, after the checks are clean; the
configuration goes into the Manufacturing Package's `files/` and its
UNVERIFIED items into the test plan. **firmware-verify** follows on the
bench, performed by a person.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The links to the controller (UARTs, I2C, motor outputs) | the root system and sub-assemblies, `npx protoboard inspect <fc instance>` | **system-compose**, **harness-author** |
| Part facts (firmware target, sensor scale, I2C address, motor poles, DShot rates) | the parts' definitions and evidence | **uhd-part-author**, the catalog |
| The firmware reference, source-pinned | `references/betaflight-reference.md` (this skill) | step 2 |
| A board's nets and pin assignment (microcontroller boards) | `src/boards/<module>/<module>.uhd.ts` | **circuit-board** |

## Steps

### 1. Generate (Betaflight)

```bash
npx protoboard run betaflight-cli                              # → firmware/betaflight/cli.txt + operation record
npx protoboard run betaflight-cli --format json                # data: target, minFirmware, buildOptions, warnings
```

Look at `data.warnings`: each is something the model could not decide (an
unknown peer on a UART, a motor-order mismatch, a target claimed only by
compatibility) and goes on the **firmware-verify** list.

Implementation: `@protoboardai/ext-drone` `lib/betaflight.ts`; reference:
[betaflight-reference.md](references/betaflight-reference.md) (every setting
checked against Betaflight 4.5.5, 2025.12.5 and 2026.6.2 sources, commits
pinned, UNVERIFIED items marked). Read the reference's gotchas before trusting
any output.

What the configuration is derived from:

| Setting family | Model input | Rule |
| --- | --- | --- |
| Target | FC part facts (target name in traits/description, e.g. `MATEKF405TE`) | The FC must state its firmware target with a source; if it only claims compatibility (DolphinRC → MATEKF405TE), that is UNVERIFIED and goes to the bench list. |
| Serial ports | every `uart` link with the FC on one end: FC interface id `uartN` → port N; the other end's protocol/kind → function | CRSF receiver → `RX_SERIAL` (64) + `feature TELEMETRY`; u-blox GNSS → `GPS` (2) + provider; DJI air unit → `MSP + VTX_MSP` (131073) + HD OSD settings. An unknown peer is a warning, never a guess. |
| Motor protocol | FC motor outputs' and ESC inputs' `esc_signal_rate` | highest DShot rate both state; bidirectional only if both state the capability (cite it). |
| Unused UARTs | every `uartN` interface of the FC with no link | `serial UARTn 0 115200 57600 0 115200` (function 0, per-port default bauds), so a pasted file is complete: a port the model stopped using (the GPS moved from UART1 to UART3) is cleared, not left with its old function. |
| Motor poles | motor stator/magnet config fact (`12N14P`) | magnet poles. |
| Motor order | `bldc_3phase` links: ESC channel n → arm | compare with the firmware's mixer order (Quad-X: M1 rear-right, M2 front-right, M3 rear-left, M4 front-left); mismatch → warning (remap or rewire). |
| Current meter | ESC current-sensor fact (scale, offset) | `current_meter = ADC`, `ibata_scale`, `ibata_offset` from the ESC's manufacturer values. |
| Compass | `i2c` link to the FC; the peer's `i2c_address` and alignment fact | driver per address (0x2C QMC5883P needs ≥ 2025.12.1 → `minFirmware`), `align_mag` from the maker's mounting statement. |
| Build options | whatever the lines above need | e.g. `GPS`, `MAG`, `OSD_HD`, `SERIALRX_CRSF`, `DSHOT` for a cloud build. |

Each emitted line carries its reason: `serial UART2 64 … # link rx_crsf: stack:uart2 ↔ receiver:crsf (CRSF receiver → RX_SERIAL)`.

### 2. Add or change a rule

1. **Verify the setting first** in the firmware source at a pinned tag: the
   CLI parser, the setting's table, value ranges, defaults, the target's
   `config.h`. Add a section to the reference with `file#Lx-Ly` links, the
   commit, and a **Δ** note for version differences. What cannot be checked in
   source is marked **UNVERIFIED** and becomes a firmware-verify item.
2. **Find the model input.** If the fact is not in the model (a pad label, a
   scale factor), add it to the part with its source (**uhd-part-author**,
   repair mode) instead of hard-coding it in the generator.
3. **Emit with a reason** naming the link id or `<part id>: <fact>`, and a
   warning when the model cannot decide.
4. Regenerate, diff `firmware/<fw>/cli.txt`, commit output and operation
   record together.

### 3. Another firmware

Same pattern, new files in `@protoboardai/ext-drone`: `lib/<fw>.ts` (pure:
model → lines with reasons + warnings), `ops/<fw>.ts` (writes
`firmware/<fw>/…`), an operation in the manifest, and
`skills/firmware-config/references/<fw>-reference.md` written *before* the
generator, with the same verification standard (source-pinned, UNVERIFIED
marked, version deltas). Parameter names and serial-function values differ per
firmware; the link → function mapping in step 1 does not.

### 4. Microcontroller boards (the firmware capability, planned)

Custom boards with a microcontroller (Zephyr devicetree overlays and Kconfig
for nRF52840, ESP-IDF pin headers and sdkconfig for ESP32-C3) get their
starting configuration from a `firmware` capability provider, being built
now. It follows the capability pattern, so expect:

```bash
npx protoboard run firmware:generate --module <board>    # planned
npx protoboard run firmware:check --module <board>       # planned: pins exist and are assigned once, peripherals match buses, strapping pins respected, I2C addresses match parts
```

Until it is in your CLI (`npx protoboard capabilities` lists `firmware`),
write the board's pin and peripheral assignment as a table from the board
module's nets (each row citing its net and part fact) in the board's notes,
and list the configuration as an open item for the release.

### 5. What the output does not establish

A generated configuration is consistent with the model and the checked
firmware sources. It does not prove the pads are labelled as the target
expects, that motor directions are right, that the compass alignment matches
the physical mounting, or that bidirectional DShot works on this ESC. Those
are bench checks: **firmware-verify**. The CLI header says NOT FLIGHT-TESTED
until they pass and are recorded.

## Decision points

| Decision | Rule |
| --- | --- |
| The model cannot decide a setting | Emit a warning, never a guess; it goes on the bench list. |
| A fact is missing from the model | Add it to the part with its source (**uhd-part-author**), not to the generator. |
| A setting not checkable in source | Mark it **UNVERIFIED** in the reference; it becomes a **firmware-verify** item. |
| Firmware version | The lowest version every emitted line needs (`minFirmware`), recorded in the header and the release manifest. |
| Motor order mismatch | Remap in firmware or rewire; decide and record it in `docs/decisions.md`. |

## Outputs

| Output | Where |
| --- | --- |
| Betaflight configuration (generated; never edit) | `firmware/betaflight/cli.txt` |
| Operation record | `operations/` |
| Reference, source-pinned | `references/<fw>-reference.md` in this skill |
| Board pin and peripheral configuration | `firmware/<fw>/` from the firmware capability (planned) |

## Verification

```bash
npx protoboard run betaflight-cli --format json      # succeeded; data.warnings reviewed, each on the bench list
git diff --stat firmware/                            # only the changes the model change explains
```

Every line of `cli.txt` carries a `# link …` or `# <part>: …` reason. Then
**firmware-verify** on the bench.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `run betaflight-cli` fails: "project has no root system" | `protoboard.config.ts` names no loadable root | Fix `root` (`PB_ROOT_NOT_FOUND`) |
| Summary says "unknown target" | The FC part states no firmware target | Add the target to the FC part with its source; until then a bench item |
| Warning: "no Betaflight serial function derived" | A UART link to something the generator has no rule for | Add the rule (step 2) or set it on the bench and record it |
| Warning: "no common DShot rate" | FC outputs and ESC inputs state no shared rate | Add the rates from the datasheets, or choose compatible parts |
| Warning: no spin, or spins not Quad-X | `spin` missing on the arms, or diagonal motors disagree | Set `ChildModuleRef.spin` once per arm (**system-compose**) |
| Warning: motor order differs from the mixer | ESC channels and arms disagree | Remap or rewire; record the decision |
| `UHD_LINK_STATE` on a link to the FC | The wiring the configuration would encode is wrong | Fix the system first (**system-compose**) |
| `UHD_INTERFACE_REUSE` on an FC UART | Two devices on one UART | Fix the wiring; the generator cannot assign one port twice |
| `UHD_BUS_ADDRESS` on the FC's I2C | Two devices share an address | Fix the system |
| `run firmware:generate` not available | The firmware capability has not landed | Step 4's interim table and an open item |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. Every emitted line cites the link or part fact it comes from.
2. Never hand-edit a generated configuration; change the model or the
   generator and regenerate.
3. Nothing generated is flight-ready until **firmware-verify** passes on the
   recorded firmware version and unit.
