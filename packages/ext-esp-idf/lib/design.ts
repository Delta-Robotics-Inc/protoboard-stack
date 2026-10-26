/**
 * ESP-IDF configuration for a UHD board whose controller is an ESP32-C3
 * module, from the board's firmware map (`boardFirmware` in
 * @protoboardai/core). Checked against ESP-IDF v5.3.5.
 *
 *   board_pins.h         every pin, bus, address, button and wake source as a
 *                        #define, for the application's driver setup code
 *   sdkconfig.defaults   target, flash size, console, RTC clock source
 *
 * ESP-IDF configures pins in code (i2c_new_master_bus, gpio_config,
 * esp_deep_sleep_enable_gpio_wakeup), not in Kconfig, so the header carries
 * the board and sdkconfig.defaults only what Kconfig owns. Every setting
 * line cites the UHD facts it comes from.
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import type { BoardFirmware, CapabilityContext, CitedLine, FirmwareBus, FirmwareCite, FirmwareDesign, FirmwareFinding, FirmwareGpio } from "@protoboardai/core";
import { wakeSources } from "@protoboardai/core";
import { ESP32C3, IDF_VERSION, gpioNumber, socFact, socOf } from "./soc.ts";

type Ctx = Pick<CapabilityContext, "constraints" | "module" | "project">;

const macro = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;

export function designEspIdf(fw: BoardFirmware, board: ModuleDef, controller: ModuleDef, ctx: Ctx): FirmwareDesign {
  const findings: FirmwareFinding[] = [];
  const warnings: string[] = [];
  const c = ctx.constraints;
  const soc = socOf(controller);
  const fact = socFact(controller);
  const ctl = fw.controller!.instance;
  if (!soc) {
    findings.push({ code: "FW_SOC_UNSUPPORTED", severity: "error", instance: ctl, message: `${controller.id} states SoC "${fact ?? "nothing"}"; this provider knows ${ESP32C3.target} (domains[electrical].metadata.soc)` });
    return { files: [], warnings, findings };
  }
  const socCite: FirmwareCite = `part:${controller.id}:domains.electrical.metadata.soc`;
  const periphCite: FirmwareCite = `part:${controller.id}:domains.electrical.metadata.peripherals`;
  const leaf = (pin: string) => controller.interfaces.find((i: InterfaceDef) => i.id === pin);
  const num = (pin: string) => gpioNumber(leaf(pin))!;
  const where = (pin: string) => `${ctl}:${pin} ${leaf(pin)?.name ?? pin}`;
  const gpioDefine = (name: string, pin: string, cites: FirmwareCite[], why: string): CitedLine => ({ text: `#define ${name} GPIO_NUM_${num(pin)}`, cites, why });

  for (const pin of Object.keys(fw.uses)) {
    if (leaf(pin) && gpioNumber(leaf(pin)) === undefined && !fw.usb?.pins.includes(pin)) {
      findings.push({ code: "FW_PIN_UNKNOWN", severity: "error", instance: ctl, message: `${where(pin)} has no GPIO number (capability gpio<n>), so it cannot be configured`, cites: [`pin:${ctl}:${pin}`] });
    }
  }
  if (findings.length) return { files: [], warnings, findings };

  // ---- console and controllers
  const console = typeof c.console === "string" ? c.console : fw.usb ? "usb" : "uart0";
  if (console !== "usb" && console !== "uart0") findings.push({ code: "FW_CONSOLE_UNKNOWN", severity: "error", message: `console ${console}: use "usb" (USB Serial/JTAG) or "uart0"`, cites: ["constraint:console"] });
  if (console === "usb" && !fw.usb) findings.push({ code: "FW_CONSOLE_UNKNOWN", severity: "error", message: "console usb: the board does not wire the USB Serial/JTAG pins (GPIO18/19) to anything", cites: ["constraint:console"] });
  const pools: Record<string, number[]> = { i2c: [...soc.i2c], spi: [...soc.spi], uart: console === "uart0" ? soc.uart.filter((n) => n !== 0) : [...soc.uart] };
  const port = new Map<FirmwareBus, number>();
  for (const bus of fw.buses.filter((b) => b.protocol !== "onewire")) {
    const n = pools[bus.protocol].shift();
    if (n === undefined) {
      findings.push({
        code: "FW_BUS_INSTANCES",
        severity: "error",
        instance: ctl,
        message: `${bus.id}: the ${soc.target} has ${soc[bus.protocol as "i2c" | "spi" | "uart"].length} ${bus.protocol.toUpperCase()} controller(s)${bus.protocol === "uart" && console === "uart0" ? " and UART0 is the console" : ""}; put the devices on one bus`,
        cites: [periphCite, ...bus.signals.flatMap((s) => s.cites)],
      });
      continue;
    }
    port.set(bus, n);
  }
  if (findings.some((f) => f.severity === "error")) return { files: [], warnings, findings };

  // ---- board_pins.h
  const h: CitedLine[] = [{ text: "#pragma once" }, { text: "" }, { text: '#include "driver/gpio.h"', cites: [socCite], why: "GPIO_NUM_x" }];
  const section = (title: string) => h.push({ text: "" }, { text: `/* ${title} */` });
  const levelOf = (g: FirmwareGpio) => (g.activeLow ? 0 : 1);
  const pullOf = (g: FirmwareGpio) => (g.pull === "up" ? "GPIO_PULLUP_ONLY" : g.pull === "down" ? "GPIO_PULLDOWN_ONLY" : "GPIO_FLOATING");
  const control = (prefix: string, g: FirmwareGpio) => {
    const why = `${g.label}: ${where(g.pin)}${g.externalPull ? `, pulled ${g.externalPull.to} by ${g.externalPull.instance}` : ""}`;
    h.push(gpioDefine(`${prefix}_GPIO`, g.pin, g.cites, why));
    h.push({ text: `#define ${prefix}_ACTIVE_LEVEL ${levelOf(g)}`, cites: g.cites, why: g.activeLow ? "active low" : "active high" });
    if (g.direction === "input") h.push({ text: `#define ${prefix}_PULL ${pullOf(g)}`, cites: g.cites, why: g.externalPull ? "the board has its own pull resistor" : g.pull ? `internal pull-${g.pull}` : "driven both ways" });
  };

  section("Controller");
  h.push({ text: `#define BOARD_TARGET "${soc.target}"`, cites: [socCite], why: `${controller.id}: ${fact}` });

  for (const [bus, n] of port) {
    const sig = (role: string) => bus.signals.find((s) => s.role === role);
    const B = `BOARD_${bus.protocol.toUpperCase()}${n}`;
    if (bus.protocol === "i2c") {
      section(`I2C${n}: ${bus.devices.map((d) => d.instance).join(", ")}`);
      h.push({ text: `#define ${B}_PORT ${n}`, cites: [periphCite, ...bus.signals.flatMap((s) => s.cites)], why: `I2C controller ${n} (the ${soc.target} has ${soc.i2c.length})` });
      for (const role of ["sda", "scl"]) {
        const s = sig(role);
        if (s) h.push(gpioDefine(`${B}_${role.toUpperCase()}`, s.pin, s.cites, `net ${s.net}: ${where(s.pin)}`));
      }
      const asked = c.i2c_frequency_hz;
      const slowest = Math.min(...bus.devices.map((d) => d.maxClockHz ?? 400_000), 400_000);
      const hz = typeof asked === "number" ? asked : slowest;
      h.push({
        text: `#define ${B}_FREQ_HZ ${hz}`,
        // the controller's I2C (fast mode at most) always bounds it, so the line is cited even when no device states a clock
        cites: [...(typeof asked === "number" ? ["constraint:i2c_frequency_hz" as const] : []), periphCite, ...bus.devices.flatMap((d) => d.cites.filter((x) => x.endsWith(".clock_freq")))],
        why: typeof asked === "number" ? "set in firmware.config.ts" : "the slowest device's limit (400 kHz at most)",
      });
      const pulled = bus.signals.every((s) => fw.netlist.nets.find((x) => x.id === s.net)?.pins.some((p) => fw.netlist.components.find((k) => k.instance === p.split(":")[0])?.kind === "resistor"));
      h.push({ text: `#define ${B}_INTERNAL_PULLUPS ${pulled ? 0 : 1}`, cites: bus.signals.map((s) => s.cites[0]), why: pulled ? "pull-up resistors on the board" : "no pull-up resistors on the board: enable the internal ones (weak, ~45 kOhm)" });
      if (!pulled) warnings.push(`${bus.id}: no pull-up resistors on SDA/SCL; the internal ~45 kOhm pull-ups are too weak for 400 kHz on most boards`);
      for (const d of bus.devices) {
        if (d.address !== undefined) h.push({ text: `#define BOARD_${macro(d.instance)}_I2C_ADDR ${hex(d.address)}`, cites: d.cites, why: `${d.name} (${d.part})` });
        for (const g of d.controls) control(`BOARD_${macro(d.instance)}_${macro(pinName(g))}`, g);
      }
    }
    if (bus.protocol === "spi") {
      section(`SPI${n}: ${bus.devices.map((d) => d.instance).join(", ")}`);
      h.push({ text: `#define ${B}_HOST SPI${n}_HOST`, cites: [periphCite, ...bus.signals.flatMap((s) => s.cites)], why: "general-purpose SPI host" });
      for (const role of ["sck", "mosi", "miso"]) {
        const s = sig(role);
        if (s) h.push(gpioDefine(`${B}_${role.toUpperCase()}`, s.pin, s.cites, `net ${s.net}: ${where(s.pin)}`));
      }
      for (const d of bus.devices) {
        if (d.cs) h.push(gpioDefine(`BOARD_${macro(d.instance)}_CS`, d.cs.pin, d.cs.cites, `${d.name} chip select: ${where(d.cs.pin)}`));
        if (d.maxClockHz) h.push({ text: `#define BOARD_${macro(d.instance)}_SPI_HZ ${Math.min(d.maxClockHz, soc.spiMaxHz)}`, cites: [...d.cites, periphCite], why: `the slower of ${d.part} and SPI${n}` });
        for (const g of d.controls) control(`BOARD_${macro(d.instance)}_${macro(pinName(g))}`, g);
      }
    }
    if (bus.protocol === "uart") {
      const d = bus.devices[0];
      section(`UART${n}: ${d?.instance}`);
      h.push({ text: `#define ${B}_PORT ${n}`, cites: [periphCite, ...bus.signals.flatMap((s) => s.cites)], why: console === "uart0" ? "UART0 is the console" : `UART ${n}` });
      for (const role of ["tx", "rx", "rts", "cts"]) {
        const s = sig(role);
        if (s) h.push(gpioDefine(`${B}_${role.toUpperCase()}`, s.pin, s.cites, `net ${s.net}: ${where(s.pin)}`));
      }
      const asked = (c.uart_baud as Record<string, unknown> | undefined)?.[d?.instance ?? ""];
      const baud = typeof asked === "number" ? asked : d?.baud;
      if (baud) h.push({ text: `#define ${B}_BAUD ${baud}`, cites: typeof asked === "number" ? ["constraint:uart_baud"] : [`part:${d.part}:${d.interface}.baud_rate`], why: `${d.instance} (${d.name})` });
      else findings.push({ code: "FW_UART_BAUD_UNKNOWN", severity: "error", instance: d?.instance, message: `${d?.instance} states no baud_rate; set uart_baud: { ${d?.instance}: <baud> } in firmware.config.ts`, cites: d?.cites });
      for (const g of d?.controls ?? []) control(`BOARD_${macro(d.instance)}_${macro(pinName(g))}`, g);
    }
  }

  fw.buses
    .filter((b) => b.protocol === "onewire")
    .forEach((bus, i) => {
      const s = bus.signals[0];
      const B = `BOARD_ONEWIRE${i}`;
      section(`1-Wire ${i}: ${bus.devices.map((d) => d.instance).join(", ")}`);
      h.push(gpioDefine(`${B}_GPIO`, s.pin, s.cites, `DQ on net ${s.net}: ${where(s.pin)}`));
      const pulled = fw.netlist.nets.find((x) => x.id === s.net)?.pins.some((p) => fw.netlist.components.find((k) => k.instance === p.split(":")[0])?.kind === "resistor");
      h.push({ text: `#define ${B}_INTERNAL_PULLUP ${pulled ? 0 : 1}`, cites: s.cites, why: pulled ? "pull-up resistor on the board" : "no pull-up resistor on the board" });
      if (!pulled) warnings.push(`${bus.id}: no pull-up resistor on DQ; 1-Wire needs about 4.7 kOhm, the internal pull-up is too weak for a cable`);
      for (const d of bus.devices) {
        const part = ctx.project.lookup(d.part);
        const res = part?.traits?.find((t) => t.type === "performance" && (t.params as Record<string, unknown> | undefined)?.default_resolution_bits !== undefined);
        if (res) h.push({ text: `#define BOARD_${macro(d.instance)}_RESOLUTION_BITS ${(res.params as Record<string, unknown>).default_resolution_bits}`, cites: [`part:${d.part}:traits.performance.default_resolution_bits`], why: `${d.name}: power-on resolution` });
      }
    });

  const buttons = fw.gpios.filter((g) => g.use === "button");
  if (buttons.length) {
    section("Buttons");
    for (const g of buttons) control(`BOARD_${macro(g.instance)}`, g);
  }
  const others = fw.gpios.filter((g) => g.use !== "button");
  if (others.length) {
    section("Status and control lines");
    for (const g of others) control(`BOARD_${macro(g.instance)}_${macro(pinName(g))}`, g);
  }

  const { sources } = wakeSources(fw, c.wake);
  if (sources.length) {
    section("Deep-sleep wake (esp_deep_sleep_enable_gpio_wakeup: RTC GPIOs only)");
    for (const [name, low] of [["LOW", true], ["HIGH", false]] as const) {
      const set = sources.filter((w) => w.activeLow === low);
      if (!set.length) continue;
      h.push({
        text: `#define BOARD_DEEP_SLEEP_WAKE_${name}_MASK (${set.map((w) => `(1ULL << GPIO_NUM_${num(w.pin)})`).join(" | ")})`,
        cites: set.flatMap((w) => [...w.cites, `pin:${ctl}:${w.pin}`]),
        why: `${set.map((w) => w.source).join(", ")}: wake when ${name.toLowerCase()} (ESP_GPIO_WAKEUP_GPIO_${name})`,
      });
    }
  }

  // ---- sdkconfig.defaults
  const flash = memory(controller)?.flash_MB;
  const sdk: CitedLine[] = [{ text: `CONFIG_IDF_TARGET="${soc.target}"`, cites: [socCite], why: `${controller.id}: ${fact}` }];
  if (typeof flash === "number" && soc.flashSizes.includes(flash)) sdk.push({ text: `CONFIG_ESPTOOLPY_FLASHSIZE_${flash}MB=y`, cites: [`part:${controller.id}:domains.electrical.metadata.memory.flash_MB`], why: `${flash} MB flash in the package` });
  else warnings.push(`${controller.id}: no flash size in the part (domains[electrical].metadata.memory.flash_MB); ESP-IDF keeps its 2 MB default`);
  if (console === "usb" && fw.usb) sdk.push({ text: "CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y", cites: [...fw.usb.cites, ...(typeof c.console === "string" ? ["constraint:console" as const] : [])], why: `console on USB Serial/JTAG: D+/D- wired to ${fw.usb.peers.join(", ")}` });
  else if (console === "uart0") sdk.push({ text: "CONFIG_ESP_CONSOLE_UART_DEFAULT=y", cites: [`pin:${ctl}:uart0`, ...(typeof c.console === "string" ? ["constraint:console" as const] : [])], why: "console on UART0 (GPIO20/21)" });
  const xtal = fw.crystals.find((x) => x.pins.some((p) => (leaf(p)?.capabilities ?? []).some((k) => k.startsWith("xtal_32k"))));
  if (xtal) sdk.push({ text: "CONFIG_RTC_CLK_SRC_EXT_CRYS=y", cites: xtal.cites, why: `32.768 kHz crystal ${xtal.instance} (${xtal.part}) on ${xtal.pins.map((p) => leaf(p)?.name).join(", ")} (XTAL_32K_P/N)` });

  const files = [
    {
      path: "board_pins.h",
      role: "pins and peripherals header",
      style: "c-block" as const,
      warnings: true,
      header: [`${board.name}: pins and peripherals for ESP-IDF ${IDF_VERSION}, generated from the UHD model by @protoboardai/ext-esp-idf. Do not edit.`],
      lines: h,
    },
    {
      path: "sdkconfig.defaults",
      role: "sdkconfig defaults",
      style: "conf" as const,
      warnings: true,
      header: [`${board.name}: ESP-IDF ${IDF_VERSION} defaults, generated from the UHD model by @protoboardai/ext-esp-idf. Do not edit;`, "list your own defaults file after this one in SDKCONFIG_DEFAULTS."],
      lines: sdk,
    },
  ];
  return { files, warnings, findings };

  function pinName(g: FirmwareGpio): string {
    const part = ctx.project.lookup(g.part);
    return part?.interfaces.find((i: InterfaceDef) => i.id === g.peripheralPin)?.name ?? g.use;
  }
}

function memory(def: ModuleDef): Record<string, unknown> | undefined {
  for (const d of def.domains ?? []) {
    const m = (d as { metadata?: Record<string, unknown> }).metadata?.memory;
    if (m && typeof m === "object") return m as Record<string, unknown>;
  }
  return undefined;
}
