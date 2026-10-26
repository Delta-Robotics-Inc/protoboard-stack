---
name: firmware-config-esp-idf
description: Configure ESP-IDF for a UHD board whose controller is an ESP32-C3 module, with the @protoboardai/ext-esp-idf firmware provider. Writes board_pins.h and sdkconfig.defaults from the board's nets and part facts, every setting citing its facts, and fixes what firmware:check finds (strapping pins, Deep-sleep wake sources, pins, buses, addresses, drift). Use after the board's circuit is modelled, whenever its nets change, and before the release's firmware configuration is frozen.
---

# Firmware configuration: ESP-IDF (ESP32-C3)

Standard operating procedure (release-package-and-evals.md §4). The
configuration is a view of the model: which GPIO is SDA is a net, a sensor's
address is a part fact, which pins are strapping pins is a fact of the
module. Nothing is typed from memory or edited by hand. Reference: the
package README.

## Purpose

Produce the ESP-IDF 5.3 pins header and sdkconfig defaults for one custom
board, and the standard firmware outputs (`out/config/`,
`out/firmware.manifest.json`) that the release packages. Use it when a board
module's controller is an ESP32-C3 module (the part's SoC fact says
ESP32-C3), after its nets are modelled, and again whenever they change.

## Inputs

- The board module: `src/boards/<module>/<module>.uhd.ts`, with every
  peripheral pin the firmware drives or reads on a net that reaches a
  controller pin. Peripherals with a bus state it as a composite with
  `i2c_address` and `clock_freq`; a 1-Wire device's data pin carries
  `onewire_dq`.
- The parts, with pin tables: the module's `gpio<n>`, `strapping` and
  `deep_sleep_wakeup` capabilities are what the rules read.
- Which inputs wake the device from Deep-sleep, decided with the person who
  owns the firmware.

## Steps

### 1. Write the config

Next to the board:

```ts
// src/boards/<module>/firmware.config.ts
import { defineCapabilityConfig } from "@protoboardai/core";
export default defineCapabilityConfig({ provider: "@protoboardai/ext-esp-idf", constraints: { wake: ["sw2", "u4"] } });
```

Then `npx protoboard capabilities`: the board is listed under `firmware`
with `✓`.

### 2. Check before generating

`npx protoboard check`. Read every
`ext:@protoboardai/ext-esp-idf/firmware:check` finding. Errors stop
generate; `FW_STRAPPING_BUTTON` (info) on GPIO9 is the BOOT button.

### 3. Generate

`npx protoboard run firmware:generate --module <module>`.
Read the summary and its warnings (`--format json | jq .data`).

### 4. Read `src/boards/<module>/esp-idf/board_pins.h`

Each `#define`
names its net and pin in a comment. Compare with the schematic intent:
pins, addresses, active levels, pulls, the wake masks.

### 5. Export

`npx protoboard run firmware:export --module <module>`, then
`npx protoboard check`: `protoboard/standard-outputs` and the provider's
check clean.

### 6. Hand off

Where the header and defaults go (README), the warnings,
and the bench items in "Verification".

## Decision points

| Question | Rule |
| --- | --- |
| Which GPIO for a new signal | Wake inputs on GPIO0-5 (RTC IO). No peripheral output on GPIO2, GPIO8 or GPIO9 (strapping). GPIO18/19 are USB Serial/JTAG; GPIO20/21 are the UART0 download port. Change the board's nets, never the header. |
| Two I2C buses wanted | The ESP32-C3 has one I2C controller: put every device on one bus, or choose part variants with distinct addresses. |
| Console | USB Serial/JTAG when GPIO18/19 reach a connector (the default); `console: "uart0"` when a USB-serial bridge is on GPIO20/21. |
| No pull-up resistors on I2C or 1-Wire (warning) | Add them to the board (4.7 kOhm is common); the internal ~45 kOhm pull-ups are too weak at 400 kHz or on a cable. |
| Something must differ from the generated files | Put it in the application's own code or a later `SDKCONFIG_DEFAULTS` file. Never edit `esp-idf/`. |

## Outputs

- `src/boards/<module>/esp-idf/`: `board_pins.h`, `sdkconfig.defaults`,
  `protoboard.lines.json` (native, provider-owned).
- `src/boards/<module>/out/config/` and `out/firmware.manifest.json`:
  standard outputs, the only files the release and other tools read.
- The operation records in `operations/` (commit them with the outputs).

## Verification

- `npx protoboard check`: no error from `protoboard/standard-outputs` or the
  firmware check; no `FW_NATIVE_STALE`.
- `out/firmware.manifest.json`: every file listed, each setting line with at
  least one cite.
- First build: `idf.py set-target esp32c3 && idf.py build` with the header
  included and the defaults listed. A compile error from the header is a
  provider defect: record it with the ESP-IDF version.
- On the bench (the release's test plan): BOOT held at reset enters download
  mode; an I2C scan finds the header's addresses; the 1-Wire search finds the
  probe; each wake source wakes the chip from Deep-sleep; the console appears
  on USB. Record results with **test-and-measure**.

## Failure handling

| Diagnostic | Meaning | Action |
| --- | --- | --- |
| `FW_STRAPPING_DRIVEN` | A peripheral output (interrupt, a device's TX) on GPIO2/8/9 can select the wrong boot mode | Move it to another GPIO. |
| `FW_STRAPPING_PIN` (warning) | A bus line or controller output on a strapping pin | Check the level it holds at reset against the module's strapping table; move it if in doubt. |
| `FW_WAKE_INVALID` | A wake source on GPIO6 or above | Move it to GPIO0-5, or drop it from `wake`. |
| `FW_WAKE_UNKNOWN` | A wake source that is no input of the board | Name a button, or a device whose interrupt reaches the controller. |
| `FW_PIN_NOT_GPIO` | A signal on an NC, EN or supply pin | Fix the net. |
| `FW_BUS_INSTANCES` | A second I2C bus, or a UART too many | Share the bus; move the console to USB. |
| `FW_PIN_REUSED`, `FW_BUS_CROSSED`, `FW_BUS_INCOMPLETE` | One pin with two jobs; swapped or missing bus lines | Fix the nets. |
| `FW_I2C_ADDRESS_CONFLICT` | Two devices at one address | Another part variant or address strap. |
| `FW_NATIVE_EDITED` | Someone edited `esp-idf/` | Regenerate; move the change to the application. |
| `FW_NATIVE_STALE`, `FW_PIN_DRIFT` | The board changed since generate | Regenerate and export. |
| `FW_PIN_UNKNOWN` | The header names a GPIO the module does not have (GPIO11-17 are not on its pins; GPIO12-17 drive the in-package flash) | Regenerate; if it persists, it is a provider defect. |
| `FW_LINE_UNCITED` | Provider defect | Report it with the board. |
