# @protoboardai/ext-esp-idf

A provider of the `firmware` capability
([tool integrations](../../docs/specs/tool-integrations.md)). It turns
a UHD board whose controller is an ESP32-C3 module into an
[ESP-IDF](https://docs.espressif.com/projects/esp-idf/) pins and peripherals
header and `sdkconfig.defaults`. Every setting line cites the UHD facts it
comes from, in a comment for people and in `firmware.manifest.json` for
tools. Checked against ESP-IDF **v5.3.5** (Kconfig symbols at the `v5.3.5`
tag).

ESP-IDF configures pins in code (`i2c_new_master_bus`, `gpio_config`,
`esp_deep_sleep_enable_gpio_wakeup`), not in a devicetree, so the header
carries the board and `sdkconfig.defaults` only what Kconfig owns.

A project selects it for one board, in the config next to the board module:

```ts
// src/boards/mainboard/firmware.config.ts
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-esp-idf",
  constraints: {
    wake: ["sw2", "u4"], // the wake button and the fuel gauge's alert wake it from Deep-sleep
  },
});
```

```sh
protoboard run firmware:generate --module mainboard   # src/boards/mainboard/esp-idf/
protoboard run firmware:export   --module mainboard   # out/config/ + out/firmware.manifest.json
protoboard check                                      # includes firmware:check for the board
```

`test/fixtures/bottle-core` is a complete example: an ESP32-C3-MINI-1-H4X with
an LED driver, a time-of-flight sensor and a fuel gauge on I2C, a DS18B20
probe on 1-Wire, a BOOT button on GPIO9 and a wake button on GPIO5, a
32.768 kHz crystal on GPIO0/1, a GNSS on GPIO20/21 and USB Serial/JTAG on
GPIO18/19. Its generated files are the golden files in `test/golden/`.

## What it writes

```
esp-idf/
  board_pins.h            buses (port, pins, clock, pull-ups), device addresses and controls,
                          1-Wire, buttons, status lines, Deep-sleep wake masks
  sdkconfig.defaults      CONFIG_IDF_TARGET, flash size, console, RTC clock source
  protoboard.lines.json   digest and cites of every file (what export turns into the manifest)
```

Put `board_pins.h` where the application includes it (`main/` or a `board`
component) and list `sdkconfig.defaults` first in `SDKCONFIG_DEFAULTS`, with
the project's own defaults after it. Do not edit the generated files: export
refuses an edited file and check reports it.

```c
#include "board_pins.h"

i2c_master_bus_config_t bus = {
  .i2c_port = BOARD_I2C0_PORT, .sda_io_num = BOARD_I2C0_SDA, .scl_io_num = BOARD_I2C0_SCL,
  .clk_source = I2C_CLK_SRC_DEFAULT, .flags.enable_internal_pullup = BOARD_I2C0_INTERNAL_PULLUPS,
};
esp_deep_sleep_enable_gpio_wakeup(BOARD_DEEP_SLEEP_WAKE_LOW_MASK, ESP_GPIO_WAKEUP_GPIO_LOW);
```

## How the board maps to ESP-IDF

1. **Firmware map** (tool-neutral, in `@protoboardai/core`: `boardFirmware`),
   as for every firmware provider: buses from the peripherals' composites,
   controls from the peripheral pins' capabilities, buttons from switches
   between a controller net and ground, external pull resistors from the
   nets.
2. **SoC table** (`lib/soc.ts`). The controller's SoC fact
   ("ESP32-C3FH4X, …") selects the ESP32-C3: one I2C controller, SPI2 as the
   general-purpose SPI host, UART0 and UART1. A module pin's GPIO number is
   its `gpio<n>` capability.
3. **Console.** USB Serial/JTAG (`CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG`) when
   GPIO18/19 are wired to a connector, else UART0; with the console on UART0,
   a UART device gets UART1.
4. **Clocks and flash.** A 32.768 kHz crystal on GPIO0/1 (XTAL_32K_P/N)
   selects `CONFIG_RTC_CLK_SRC_EXT_CRYS`; the module's `memory.flash_MB` fact
   sets `CONFIG_ESPTOOLPY_FLASHSIZE_<n>MB`.
5. **Strapping and wake.** The part marks GPIO2, GPIO8 and GPIO9 as strapping
   pins and GPIO0-5 as able to wake it from Deep-sleep (`deep_sleep_wakeup`,
   the RTC IO). A peripheral output on a strapping pin is an error; a button
   on GPIO9 is the BOOT button and only noted. Each wake source must arrive
   on an RTC GPIO; the header gives one mask per wake level.

## Constraints

| Key | Meaning |
| --- | --- |
| `controller` | instance path of the controller, when the board has more than one microcontroller |
| `console` | `usb` (USB Serial/JTAG; the default when GPIO18/19 are wired) or `uart0` |
| `i2c_frequency_hz` | I2C clock (default: the slowest device's limit, 400 kHz at most) |
| `uart_baud` | `{ <instance>: baud }` for UART devices that state no `baud_rate` |
| `wake` | inputs that wake the chip from Deep-sleep: button or device instances, or nets |

## Checks

`firmware:check` runs the shared rules from `@protoboardai/core` (codes in the
[provider guide](../../docs/guides/writing-a-capability-provider.md#diagnostic-codes),
including `FW_STRAPPING_DRIVEN` and `FW_WAKE_INVALID`) and these:

| Code | Severity | Meaning |
| --- | --- | --- |
| `FW_SOC_UNSUPPORTED` | error | The controller's SoC fact names no SoC this provider knows. |
| `FW_BUS_INSTANCES` | error | More I2C, SPI or UART buses than the ESP32-C3 has (one I2C controller; UART0 is taken when it is the console). |
| `FW_UART_BAUD_UNKNOWN`, `FW_CONSOLE_UNKNOWN` | error | No baud rate for a UART device; a console the board cannot carry. |

The tests compile `board_pins.h` with the system C compiler against a stub
`driver/gpio.h` when one is installed, and check the values it yields.

## What the output does not establish

The header and defaults agree with the model and the checked ESP-IDF
release. They have not been built into an application or flashed. The bench
proves them: an I2C scan finds the addresses in the header, the BOOT button
enters download mode, each wake source wakes the chip from Deep-sleep.

## Tests

```sh
npx vitest run packages/ext-esp-idf                    # contract, golden files, cites, C compile, seeded faults
UPDATE_GOLDEN=1 npx vitest run packages/ext-esp-idf    # after a deliberate change to the output
```

The test parts in `test/fixtures/parts/` are copies of researched parts; the
README there says where they came from.
