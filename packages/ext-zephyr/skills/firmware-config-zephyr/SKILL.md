---
name: firmware-config-zephyr
description: Configure Zephyr for a UHD board whose controller is an nRF52840 module, with the @protoboardai/ext-zephyr firmware provider. Writes a board definition (devicetree, pinctrl, Kconfig) and a Kconfig fragment from the board's nets and part facts, every setting citing its facts, and fixes what firmware:check finds (pins, buses, addresses, wake sources, drift). Use after the board's circuit is modelled, whenever its nets change, and before the release's firmware configuration is frozen.
---

# Firmware configuration: Zephyr (nRF52840)

Standard operating procedure (release-package-and-evals.md §4). The
configuration is a view of the model: which pin is SDA is a net, a sensor's
address is a part fact. Nothing is typed from memory or edited by hand.
Reference: the package README.

## Purpose

Produce a Zephyr 4.2 board definition for one custom board and the standard
firmware outputs (`out/config/`, `out/firmware.manifest.json`) that the
release packages. Use it when a board module's controller is an nRF52840
module (the part's SoC fact says nRF52840), after its nets are modelled, and
again whenever they change.

## Inputs

- The board module: `src/boards/<module>/<module>.uhd.ts`, with every
  peripheral pin the firmware drives or reads on a net that reaches a
  controller pin (`netLinks`). Peripherals with a bus state it as a composite
  (`i2c`, `spi`, `uart`) with `i2c_address` and `clock_freq`.
- The parts: the controller module and each peripheral, from
  `parts/catalog` or `parts/local`, with pin tables and facts.
- What the model cannot state, decided with the person who owns the
  firmware: which inputs wake the device, and any property a driver binding
  requires (the DRV2605's `actuator-mode`, from the actuator chosen).

## Steps

### 1. Write the config

Next to the board:

```ts
// src/boards/<module>/firmware.config.ts
import { defineCapabilityConfig } from "@protoboardai/core";
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-zephyr",
  constraints: { board_name: "<board>", wake: ["sw1"], properties: { u5: { "actuator-mode": "LRA" } } },
});
```

Then `npx protoboard capabilities`: the board is listed under `firmware`
with `✓` and the provider.

### 2. Check before generating

`npx protoboard check`. Read every
`ext:@protoboardai/ext-zephyr/firmware:check` finding; errors stop
generate. `FW_NOT_GENERATED` (info) is expected now.

### 3. Generate

`npx protoboard run firmware:generate --module <module>`.
The summary names the files, the number of cited settings, buses and
GPIOs, and the warnings. Read the warnings (`--format json | jq .data`):
each names a device without a Zephyr driver or a gap to close.

### 4. Read the board devicetree

In
`src/boards/<module>/zephyr/boards/<vendor>/<board>/<board>.dts` and the
pinctrl file. Compare each comment with the schematic intent: the pin,
the net, the address, the polarity.

### 5. Export

`npx protoboard run firmware:export --module <module>`, then
`npx protoboard check` again: `protoboard/standard-outputs` and the
provider's check both clean.

### 6. Hand off

The build command in the README (`BOARD_ROOT`,
`EXTRA_CONF_FILE`), the warnings, and the bench items in "Verification".

## Decision points

| Question | Rule |
| --- | --- |
| A part has no Zephyr driver (warning) | Leave the generated node (address, label); the application drives it. Do not invent a compatible, and do not edit the installed provider package. If Zephyr has a driver for it, report the missing mapping (part id, compatible, binding file at the pinned release) to the provider's maintainers; meanwhile bind the driver in the application's own overlay (`app.overlay`: `&<label> { compatible = "..."; };`), which the generated files do not touch. |
| A binding needs a property the model lacks (`FW_PROPERTY_MISSING`) | If it is a fact of the part, add it to the part with its source (part authoring, repair mode). If it is a design choice, put it in `constraints.properties` with a comment saying why. |
| Which pins should a new bus use | Full-drive pads for I2C, SPI, UART (the module's usage note lists them); low-frequency pads only for buttons and status lines. Change the board's nets, never the generated file. |
| No crystal on XL1/XL2 (warning) | Acceptable for a prototype (RC oscillator); add the crystal to the board if timing accuracy or sleep current matters. |
| Two devices share an address | Move one to a second bus (a second set of nets) or choose a part variant with another address. |
| Something must differ from the generated files | Put it in the application's `prj.conf` or overlay. Never edit `zephyr/`. |

## Outputs

- `src/boards/<module>/zephyr/`: the board definition, `firmware.conf`,
  `protoboard.lines.json` (native, provider-owned).
- `src/boards/<module>/out/config/` and `out/firmware.manifest.json`:
  standard outputs, the only files the release and other tools read.
- The operation records in `operations/` (commit them with the outputs).

## Verification

- `npx protoboard check`: no error from `protoboard/standard-outputs` or the
  firmware check; `FW_NATIVE_STALE` absent (the files match the model).
- `out/firmware.manifest.json`: every file listed, each setting line with at
  least one cite (`net:`, `pin:`, `part:`, `constraint:`).
- First build: `west build -b <board> <app> -- -DBOARD_ROOT=… -DEXTRA_CONF_FILE=…`
  compiles. A devicetree or Kconfig error there is a provider defect: record
  it with the Zephyr version.
- On the bench (the release's test plan): an I2C scan finds the addresses in
  the devicetree; each button, interrupt and display line works; the device
  wakes from System OFF on each wake source. Record results with
  **test-and-measure**.

## Failure handling

| Diagnostic | Meaning | Action |
| --- | --- | --- |
| `FW_NO_CONTROLLER`, `FW_CONTROLLER_AMBIGUOUS` | No microcontroller, or several | Fix the controller part's category, or set `constraints.controller`. |
| `FW_SOC_UNSUPPORTED` | The controller's SoC fact is not an nRF52840 | Use the provider for that SoC (ESP32-C3: `@protoboardai/ext-esp-idf`), or fix the part's SoC fact. |
| `FW_BUS_PROTOCOL` | A bus signal on a pad without that function (a low-frequency pad) | Move the net to a full-drive pad. |
| `FW_PIN_REUSED`, `FW_BUS_CROSSED` | One pin with two jobs; a peripheral's SDA/SCL swapped, or two SPI devices sharing SCK but not MOSI | Fix the nets. (Devices that agree on the lines they share are one bus.) |
| `FW_SPI_CS_MISSING` | A device on a shared SPI bus with no chip select | Wire its CS to a controller GPIO. |
| `FW_I2C_ADDRESS_UNKNOWN` | An I2C part states no address; a devicetree node needs `reg` | Fix the part (`i2c_address` on its I2C interface) through the parts library. |
| `FW_BUTTON_CODES` (warning) | More than 36 buttons: the extra ones get no `zephyr,code` | Set their key codes in the application overlay. |
| `FW_BUS_INCOMPLETE` | A peripheral's bus line reaches no controller pin | Add the missing pin to its net. |
| `FW_I2C_ADDRESS_CONFLICT` | Two devices at one address on one bus | Second bus or another part variant. |
| `FW_BUS_INSTANCES` | More buses than the nRF52840 has (i2c0/spi0 and i2c1/spi1 share hardware) | Share a bus. |
| `FW_BUS_SPEED` | A clock the TWIM or a device cannot run | Use 100 or 400 kHz, at most the slowest device's limit. |
| `FW_WAKE_UNKNOWN` | A wake source that is no input of the board | Name a button, or a device whose interrupt reaches the controller. |
| `FW_NATIVE_EDITED` | Someone edited `zephyr/` | Regenerate; move the change to the application's files. |
| `FW_NATIVE_STALE`, `FW_PIN_DRIFT` | The board changed since generate | Regenerate and export. |
| `FW_PIN_UNKNOWN` | A file names a pin the module does not have | Regenerate; if it persists, it is a provider defect. |
| `FW_DTS_SYNTAX`, `FW_LINE_UNCITED` | Provider defect | Report it with the board; do not work around it in the output. |
