# @protoboardai/ext-zephyr

A provider of the `firmware` capability
([tool integrations](../../docs/specs/tool-integrations.md)). It turns
a UHD board whose controller is an nRF52840 module into a
[Zephyr](https://zephyrproject.org) board definition: devicetree with pin
assignment, devices on their buses, buttons, display, regulators and Kconfig.
Every setting line cites the UHD facts it comes from, in a comment for people
and in `firmware.manifest.json` for tools. Checked against Zephyr **4.2.0**
(bindings, Kconfig symbols and the nRF52840 devicetree at the `v4.2.0` tag).

A project selects it for one board, in the config next to the board module:

```ts
// src/boards/mainboard/firmware.config.ts
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-zephyr",
  constraints: {
    board_name: "watch_core",
    wake: ["sw1", "u3"], // the side button and the fuel gauge's alert wake it from System OFF
    properties: { u5: { "actuator-mode": "LRA" } }, // what a driver binding needs and the model does not say
  },
});
```

```sh
protoboard run firmware:generate --module mainboard   # src/boards/mainboard/zephyr/
protoboard run firmware:export   --module mainboard   # out/config/ + out/firmware.manifest.json
protoboard run firmware:extract  --module mainboard   # artifacts, and the pins the devicetree names
protoboard check                                      # includes firmware:check for the board
```

`test/fixtures/watch-core` is a complete example: a Raytac MDBT50Q-1MV2 with a
heart-rate sensor, fuel gauge and haptic driver on I2C, a round GC9A01
display on SPI with D/C and reset, a side button, the charger's status line,
a 32.768 kHz crystal, a GNSS on a UART and USB. Its generated files are the
golden files in `test/golden/`.

## What it writes

```
zephyr/
  boards/<vendor>/<board>/board.yml            board name and SoC (Zephyr hardware model v2)
  boards/<vendor>/<board>/Kconfig.<board>      selects SOC_NRF52840_QIAA
  boards/<vendor>/<board>/<board>_defconfig    MPU, GPIO, the 32 kHz clock source
  boards/<vendor>/<board>/<board>.dts          chosen, buttons, display, zephyr,user, buses and devices, regulators, GPIO ports, UICR, USB
  boards/<vendor>/<board>/<board>-pinctrl.dtsi pin assignment of every bus (default and sleep states)
  firmware.conf                                Kconfig fragment: the subsystems the board's drivers live in
  protoboard.lines.json                        digest and cites of every file (what export turns into the manifest)
```

Build with the folder holding `boards/` as a board root:

```sh
west build -b watch_core app -- -DBOARD_ROOT=<path>/zephyr -DEXTRA_CONF_FILE=<path>/zephyr/firmware.conf
```

Do not edit these files. Settings of your own go in the application's
`prj.conf` and an application overlay, which Zephyr merges after the board's.
Export refuses an edited file and check reports it.

## How the board maps to Zephyr

1. **Firmware map** (tool-neutral, in `@protoboardai/core`: `boardFirmware`).
   The controller is the board's one `microcontroller`. Buses come from the
   peripherals' I2C, SPI and UART composites: each slot's pin is followed
   along its net to a controller pin. Single lines between a peripheral and
   the controller become controls by the peripheral pin's capabilities
   (interrupt output, `reset`, `enable`, `display_dc`, `charge_status`). A
   switch between a controller net and ground is an active-low button; a
   resistor from the net to a supply replaces the internal pull-up. Devices
   that agree on the lines they share are one bus: the write-only display and
   a flash on the same SCK/MOSI are one SPI instance, with the flash's MISO,
   one `cs-gpios` entry per device and each device's `reg` its index there.
2. **SoC table** (`lib/soc.ts`). The controller's SoC fact
   (`domains[electrical].metadata.soc`, "Nordic nRF52840 revision 2,
   aQFN-73") selects the nRF52840: `nordic/nrf52840_qiaa.dtsi`, bus instances
   (`i2c0`/`i2c1`, `spi3` first for its 32 MHz, then `spi2`; `i2c0`/`spi0`
   and `i2c1`/`spi1` share hardware), and the pin naming: a module pin named
   `P0.13` is `NRF_PSEL(…, 0, 13)` and `<&gpio0 13 …>`.
3. **Driver table** (`lib/drivers.ts`), keyed by part id, each entry checked
   against its Zephyr 4.2.0 binding:

   | Part | Compatible | Kconfig | Controls the binding takes |
   | --- | --- | --- | --- |
   | `adi-max17048g-t10` | `maxim,max17048` | `FUEL_GAUGE` | — (ALRT goes to `zephyr,user`) |
   | `ti-drv2605ldgs` | `ti,drv2605` (requires `actuator-mode`) | `HAPTICS` | `en-gpios`, `in-trig-gpios` |
   | `ti-lp5024rsm` | `ti,lp5024` | `LED` | `enable-gpios` (LED child nodes are yours) |
   | `eastrising-er-tft128-1` | `galaxycore,gc9x01x` on `zephyr,mipi-dbi-spi` | `DISPLAY` | `dc-gpios`, `reset-gpios`; width and height from the part's resolution |
   | `adafruit-381-ds18b20-probe` | `maxim,ds18b20` on `zephyr,w1-gpio` | `W1`, `SENSOR` | resolution from the part |

   A part with no entry still gets a node on its bus with its address and no
   compatible (the application finds it by label), and a warning says so. An
   I2C part that states no address is an error: its node would have no `reg`.
   A missing mapping is reported to this package; meanwhile the application
   overlay binds the driver to the node's label. Buttons get `INPUT_KEY_0`…`9`
   then `INPUT_KEY_A`…`Z`; beyond 36 they get no code and a warning.
   Controls without a binding property go to `zephyr,user` as
   `<instance>-<pin name>-gpios`.
4. **Board facts.** A 32.768 kHz crystal on XL1/XL2 selects
   `CLOCK_CONTROL_NRF_K32SRC_XTAL`, else the RC oscillator with a warning; the
   module's "REG1 DC/DC inductor inside" fact turns on `&reg1` DC/DC; NFC pads
   used as GPIO set `nfct-pins-as-gpios`; USB pins wired to a connector enable
   `zephyr_udc0: &usbd`. Wake sources (`constraints.wake`) are written as
   `zephyr,user { wakeup-gpios = … }` for the application to arm before
   `sys_poweroff()`; any nRF52840 GPIO can wake it from System OFF.

## Constraints

| Key | Meaning |
| --- | --- |
| `controller` | instance path of the controller, when the board has more than one microcontroller |
| `board_name` | Zephyr board name (default: the module id with `_` for `-`) |
| `vendor` | board vendor folder and compatible prefix (default `protoboard`) |
| `console` | UART bus id or UART device instance for `zephyr,console` |
| `i2c_frequency_hz` | 100000 or 400000 (default: 400 kHz when every device allows it) |
| `uart_baud` | `{ <instance>: baud }` for UART devices that state no `baud_rate` |
| `wake` | inputs that wake the chip from System OFF: button or device instances, or nets |
| `properties` | `{ <instance>: { <property>: value } }`: devicetree properties a binding requires that the model cannot state; strings, integers, integer arrays, or `true` for a boolean |

## Checks

`firmware:check` runs the shared rules from `@protoboardai/core` (codes in the
[provider guide](../../docs/guides/writing-a-capability-provider.md#diagnostic-codes))
and these:

| Code | Severity | Meaning |
| --- | --- | --- |
| `FW_SOC_UNSUPPORTED` | error | The controller's SoC fact names no SoC this provider knows. |
| `FW_BUS_INSTANCES` | error | More I2C, SPI or UART buses than free nRF52840 instances. |
| `FW_BUS_SPEED` | error | An I2C clock the TWIM cannot run (100 or 400 kHz). |
| `FW_PROPERTY_MISSING` | error | A binding's required property (`actuator-mode`, a display's size) that neither the part nor the config states. |
| `FW_DISPLAY_DC_MISSING` | error | A 4-wire SPI display without a D/C line to the controller. |
| `FW_UART_BAUD_UNKNOWN`, `FW_CONSOLE_UNKNOWN` | error | No baud rate for a UART device; a console that is no UART. |
| `FW_DTS_SYNTAX` | error | The generated devicetree is not well formed (a provider defect). |

The devicetree is checked by a structural parser (`lib/dts.ts`): nodes and
properties closed, values are cells, strings or references, labels defined
once, and every `&label` defined by the files or the nRF52840 devicetree.
The tests also compile it with `dtc` after the C preprocessor when `dtc` is
installed; it is not on every machine, so the structural check is what
always runs.

## What the output does not establish

A generated board definition agrees with the model and the checked Zephyr
release. It has not been built or flashed: the first `west build` is the
real compile check, and the bench (rails, programming, I2C scan at the
addresses above, each peripheral's smoke test) is where it is proven. The
release's test plan lists those steps.

## Tests

```sh
npx vitest run packages/ext-zephyr                     # contract, golden files, cites, devicetree, seeded faults
UPDATE_GOLDEN=1 npx vitest run packages/ext-zephyr     # after a deliberate change to the output
```

The test parts in `test/fixtures/parts/` are copies of researched parts; the
README there says where they came from.
