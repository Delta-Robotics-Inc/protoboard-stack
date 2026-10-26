/**
 * A Zephyr board definition (hardware model v2) for a UHD board whose
 * controller is an nRF52840 module, from the board's firmware map
 * (`boardFirmware` in @protoboardai/core). Checked against Zephyr v4.2.0.
 *
 *   boards/<vendor>/<board>/board.yml              board and SoC
 *   boards/<vendor>/<board>/Kconfig.<board>        selects the SoC variant
 *   boards/<vendor>/<board>/<board>_defconfig      MPU, GPIO, 32 kHz clock source
 *   boards/<vendor>/<board>/<board>.dts            buses, devices, buttons, display, regulators
 *   boards/<vendor>/<board>/<board>-pinctrl.dtsi    pin assignment of every bus
 *   firmware.conf                                  the subsystems the board's drivers need
 *
 * Point BOARD_ROOT at the folder holding boards/ and build with
 * `west build -b <board>`; add firmware.conf with EXTRA_CONF_FILE.
 *
 * Every setting line cites the UHD facts it comes from. What the model
 * cannot state (a driver's required property) comes from the module's
 * firmware.config.ts and cites it.
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import type { BoardFirmware, CapabilityContext, CitedLine, FirmwareBus, FirmwareCite, FirmwareDesign, FirmwareDevice, FirmwareFile, FirmwareFinding, FirmwareGpio } from "@protoboardai/core";
import { wakeSources } from "@protoboardai/core";
import { DRIVERS } from "./drivers.ts";
import { NRF52840, ZEPHYR_VERSION, pinLabel, portPin, socFact, socOf, type ZephyrSoc } from "./soc.ts";

type Ctx = Pick<CapabilityContext, "constraints" | "module" | "project">;

const PSEL: Record<string, string> = { sda: "TWIM_SDA", scl: "TWIM_SCL", sck: "SPIM_SCK", mosi: "SPIM_MOSI", miso: "SPIM_MISO", tx: "UART_TX", rx: "UART_RX", rts: "UART_RTS", cts: "UART_CTS" };
const BUS_KCONFIG: Record<string, string> = { i2c: "I2C", spi: "SPI", uart: "SERIAL", onewire: "W1" };

/** Devicetree-safe names: lowercase, `_` in labels, `-` in node and property names. */
export const dtLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const dtName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const hex = (n: number) => `0x${n.toString(16)}`;
const dtString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** A devicetree value from a config property: string, number, boolean or number array. */
function dtValue(v: unknown): string | undefined {
  if (typeof v === "string") return dtString(v);
  if (typeof v === "number" && Number.isInteger(v)) return `<${v}>`;
  if (Array.isArray(v) && v.every((x) => Number.isInteger(x))) return `<${v.join(" ")}>`;
  return undefined;
}

/** Zephyr board name from the module id, unless the config names one. */
export function boardName(board: ModuleDef, constraints: Record<string, unknown>): string {
  return typeof constraints.board_name === "string" ? constraints.board_name : dtLabel(board.id);
}

export function designZephyr(fw: BoardFirmware, board: ModuleDef, controller: ModuleDef, ctx: Ctx): FirmwareDesign {
  const findings: FirmwareFinding[] = [];
  const warnings: string[] = [];
  const c = ctx.constraints;
  const soc = socOf(controller);
  const fact = socFact(controller);
  if (!soc) {
    findings.push({ code: "FW_SOC_UNSUPPORTED", severity: "error", instance: fw.controller!.instance, message: `${controller.id} states SoC "${fact ?? "nothing"}"; this provider knows ${NRF52840.name} (domains[electrical].metadata.soc)` });
    return { files: [], warnings, findings };
  }
  const ctl = fw.controller!.instance;
  const socCite: FirmwareCite = `part:${controller.id}:domains.electrical.metadata.soc`;
  const name = boardName(board, c);
  const vendor = typeof c.vendor === "string" ? c.vendor : "protoboard";
  const dir = `boards/${vendor}/${name}`;
  const leaf = (pin: string) => controller.interfaces.find((i) => i.id === pin);
  const pp = (pin: string) => portPin(leaf(pin))!;
  const where = (pin: string) => `${ctl}:${pin} ${leaf(pin)?.name ?? pin}`;
  const gpioCell = (pin: string, flags: string[]) => {
    const p = pp(pin);
    return `<&gpio${p.port} ${p.pin} ${flags.length > 1 ? `(${flags.join(" | ")})` : flags[0]}>`;
  };
  const flagsOf = (g: FirmwareGpio, extra: string[] = []) => [...(g.pull === "up" ? ["GPIO_PULL_UP"] : g.pull === "down" ? ["GPIO_PULL_DOWN"] : []), ...extra, g.activeLow ? "GPIO_ACTIVE_LOW" : "GPIO_ACTIVE_HIGH"];
  const gpioWhy = (g: FirmwareGpio) => `${g.label}: ${where(g.pin)}${g.externalPull ? `, pulled ${g.externalPull.to} by ${g.externalPull.instance}` : ""}`;

  for (const [pin] of Object.entries(fw.uses)) {
    if (leaf(pin) && !portPin(leaf(pin)) && !fw.usb?.pins.includes(pin)) {
      findings.push({ code: "FW_PIN_UNKNOWN", severity: "error", instance: ctl, message: `${where(pin)} has no nRF port/pin name (P<port>.<pin>), so it cannot be configured`, cites: [`pin:${ctl}:${pin}`] });
    }
  }
  if (findings.length) return { files: [], warnings, findings };

  // ---- bus instances
  const used = new Set<string>();
  const instanceOf = new Map<FirmwareBus, string>();
  for (const bus of fw.buses) {
    if (bus.protocol === "onewire") continue;
    const pool = soc[bus.protocol as "i2c" | "spi" | "uart"];
    const free = pool.find((x) => !used.has(x) && !(soc.sharesId[x] && used.has(soc.sharesId[x])));
    if (!free) {
      findings.push({ code: "FW_BUS_INSTANCES", severity: "error", instance: ctl, message: `${bus.id}: no ${bus.protocol.toUpperCase()} instance left on the ${soc.name} (${pool.join(", ")}; i2c0/spi0 and i2c1/spi1 share hardware)`, cites: bus.signals.flatMap((s) => s.cites) });
      continue;
    }
    used.add(free);
    instanceOf.set(bus, free);
  }
  if (findings.length) return { files: [], warnings, findings };

  const kconfig = new Map<string, FirmwareCite[]>();
  const needs = (sym: string, cites: FirmwareCite[]) => kconfig.set(sym, [...(kconfig.get(sym) ?? []), ...cites]);
  const zephyrUser: CitedLine[] = [];
  const userGpio = (g: FirmwareGpio) => {
    zephyrUser.push({ text: `\t\t${dtName(`${g.instance}-${leafName(g)}`)}-gpios = ${gpioCell(g.pin, flagsOf(g))};`, cites: g.cites, why: gpioWhy(g) });
  };
  const leafName = (g: FirmwareGpio) => {
    const part = ctx.project.lookup(g.part);
    return part?.interfaces.find((i: InterfaceDef) => i.id === g.peripheralPin)?.name ?? g.use;
  };

  // ---- pinctrl
  const pinctrl: CitedLine[] = [{ text: "&pinctrl {" }];
  for (const [bus, inst] of instanceOf) {
    const sigs = [...bus.signals].sort((a, b) => Object.keys(PSEL).indexOf(a.role) - Object.keys(PSEL).indexOf(b.role));
    const cites = sigs.flatMap((s) => s.cites);
    const psel = (s: (typeof sigs)[number], i: number, all: typeof sigs) => {
      const p = pp(s.pin);
      const head = i === 0 ? "\t\t\tpsels = " : "\t\t\t\t";
      return { text: `${head}<NRF_PSEL(${PSEL[s.role]}, ${p.port}, ${p.pin})>${i === all.length - 1 ? ";" : ","}`, cites: s.cites, why: `${s.role.toUpperCase()} on net ${s.net}: ${where(s.pin)}` };
    };
    pinctrl.push({ text: `\t${inst}_default: ${inst}_default {` });
    if (bus.protocol === "uart") {
      // receive lines get a pull-up so an idle, unplugged line reads as idle (Zephyr's nRF boards do the same)
      const outs = sigs.filter((s) => s.role === "tx" || s.role === "rts");
      const ins = sigs.filter((s) => s.role === "rx" || s.role === "cts");
      if (outs.length) pinctrl.push({ text: "\t\tgroup1 {" }, ...outs.map(psel), { text: "\t\t};" });
      if (ins.length) pinctrl.push({ text: `\t\tgroup${outs.length ? 2 : 1} {` }, ...ins.map(psel), { text: "\t\t\tbias-pull-up;", cites: ins.flatMap((s) => s.cites), why: "idle-high receive line" }, { text: "\t\t};" });
    } else pinctrl.push({ text: "\t\tgroup1 {" }, ...sigs.map(psel), { text: "\t\t};" });
    pinctrl.push({ text: "\t};" }, { text: "" });
    pinctrl.push({ text: `\t${inst}_sleep: ${inst}_sleep {` }, { text: "\t\tgroup1 {" }, ...sigs.map(psel), { text: "\t\t\tlow-power-enable;", cites, why: "pins released in sleep" }, { text: "\t\t};" }, { text: "\t};" }, { text: "" });
  }
  if (pinctrl[pinctrl.length - 1].text === "") pinctrl.pop();
  pinctrl.push({ text: "};" });

  // ---- devicetree
  const root: CitedLine[] = [];
  const after: CitedLine[] = [];
  const includes: CitedLine[] = [
    { text: "/dts-v1/;" },
    { text: `#include <${soc.dtsi}>`, cites: [socCite], why: `${controller.id}: ${fact}` },
    { text: `#include "${name}-pinctrl.dtsi"` },
  ];
  const memCite: FirmwareCite = `part:${controller.id}:domains.electrical.metadata.memory`;
  root.push(
    { text: "/ {" },
    { text: `\tmodel = ${dtString(board.name)};`, cites: ["module:name"] },
    { text: `\tcompatible = ${dtString(`${vendor},${dtName(name)}`)};`, cites: ["module:id", ...(typeof c.vendor === "string" ? ["constraint:vendor" as const] : [])] },
    { text: "" },
    { text: "\tchosen {" },
    { text: "\t\tzephyr,sram = &sram0;", cites: [memCite], why: "on-chip RAM" },
    { text: "\t\tzephyr,flash = &flash0;", cites: [memCite], why: "on-chip flash" },
  );
  const console = typeof c.console === "string" ? c.console : undefined;
  if (console) {
    const bus = [...instanceOf].find(([b]) => b.id === console || b.devices.some((d) => d.instance === console));
    if (bus && bus[0].protocol === "uart") root.push({ text: `\t\tzephyr,console = &${bus[1]};`, cites: ["constraint:console", ...bus[0].signals.flatMap((s) => s.cites)] });
    else findings.push({ code: "FW_CONSOLE_UNKNOWN", severity: "error", message: `console ${console} is no UART bus or UART device of the board`, cites: ["constraint:console"] });
  }
  root.push({ text: "\t};" });

  // buttons
  if (fw.gpios.some((g) => g.use === "button")) {
    includes.push({ text: "#include <zephyr/dt-bindings/input/input-event-codes.h>", cites: fw.gpios.filter((g) => g.use === "button").flatMap((g) => g.cites.slice(0, 1)) });
    root.push({ text: "" }, { text: "\tbuttons {" }, { text: '\t\tcompatible = "gpio-keys";', cites: fw.gpios.filter((g) => g.use === "button").flatMap((g) => g.cites.slice(0, 1)) });
    fw.gpios
      .filter((g) => g.use === "button")
      .forEach((g, i) => {
        root.push(
          { text: `\t\tbutton_${dtLabel(g.instance)}: button_${i} {` },
          { text: `\t\t\tgpios = ${gpioCell(g.pin, flagsOf(g))};`, cites: g.cites, why: gpioWhy(g) },
          { text: `\t\t\tlabel = ${dtString(g.label)};`, cites: [`pin:${g.instance}:${ctx.project.lookup(g.part)?.interfaces[0]?.id ?? "pin_1"}`] },
          ...(buttonCode(i) ? [{ text: `\t\t\tzephyr,code = <${buttonCode(i)}>;`, cites: g.cites.slice(0, 1) }] : []),
          { text: "\t\t};" },
        );
      });
    const buttons = fw.gpios.filter((g) => g.use === "button");
    if (buttons.length > BUTTON_CODES) {
      // zephyr,code is optional in gpio-keys.yaml: the extra buttons get none rather than a code that is not defined
      findings.push({ code: "FW_BUTTON_CODES", severity: "warning", message: `${buttons.length} buttons: this provider gives them INPUT_KEY_0..9 and INPUT_KEY_A..Z (${BUTTON_CODES}); ${buttons.slice(BUTTON_CODES).map((g) => g.instance).join(", ")} ${buttons.length - BUTTON_CODES === 1 ? "gets" : "get"} no zephyr,code: set it in the application overlay`, cites: buttons.slice(BUTTON_CODES).flatMap((g) => g.cites.slice(0, 1)) });
    }
    root.push({ text: "\t};" });
    needs("INPUT", fw.gpios.filter((g) => g.use === "button").flatMap((g) => g.cites.slice(0, 1)));
  }

  // devices on buses
  const busNodes: CitedLine[] = [];
  for (const [bus, inst] of instanceOf) {
    const sigCites = bus.signals.flatMap((s) => s.cites);
    needs(BUS_KCONFIG[bus.protocol], sigCites);
    busNodes.push({ text: "" }, { text: `&${inst} {` });
    if (bus.protocol === "i2c") busNodes.push({ text: '\tcompatible = "nordic,nrf-twim";', cites: sigCites, why: "EasyDMA TWI master" });
    if (bus.protocol === "spi") busNodes.push({ text: '\tcompatible = "nordic,nrf-spim";', cites: sigCites, why: "EasyDMA SPI master" });
    if (bus.protocol === "uart") busNodes.push({ text: '\tcompatible = "nordic,nrf-uarte";', cites: sigCites, why: "EasyDMA UART" });
    busNodes.push(
      { text: '\tstatus = "okay";', cites: sigCites },
      { text: `\tpinctrl-0 = <&${inst}_default>;`, cites: sigCites },
      { text: `\tpinctrl-1 = <&${inst}_sleep>;`, cites: sigCites },
      { text: '\tpinctrl-names = "default", "sleep";', cites: sigCites },
    );
    if (bus.protocol === "i2c") {
      const asked = c.i2c_frequency_hz;
      const slowest = Math.min(...bus.devices.map((d) => d.maxClockHz ?? 400_000), 400_000);
      const hz = typeof asked === "number" ? asked : slowest >= 400_000 ? 400_000 : 100_000;
      const macro = hz === 400_000 ? "I2C_BITRATE_FAST" : hz === 100_000 ? "I2C_BITRATE_STANDARD" : undefined;
      if (!macro) findings.push({ code: "FW_BUS_SPEED", severity: "error", message: `i2c_frequency_hz ${hz}: the nRF52840 TWIM runs at 100 kHz or 400 kHz (part fact bus_limits.twim_kbps)`, cites: ["constraint:i2c_frequency_hz"] });
      else {
        busNodes.push({
          text: `\tclock-frequency = <${macro}>;`,
          cites: [...(typeof asked === "number" ? ["constraint:i2c_frequency_hz" as const] : []), `part:${controller.id}:domains.electrical.metadata.bus_limits.twim_kbps`, ...bus.devices.flatMap((d) => d.cites.filter((x) => x.endsWith(".clock_freq")))],
          why: `${hz / 1000} kHz: ${typeof asked === "number" ? "set in firmware.config.ts" : `the slowest device allows ${slowest / 1000} kHz`}`,
        });
      }
    }
    // SPI: reg is the device's index in cs-gpios, so every device on a shared bus needs its own chip select
    const csIndex = new Map<FirmwareDevice, number>();
    if (bus.protocol === "spi") {
      const cs = bus.devices.filter((d) => d.cs);
      cs.forEach((d, i) => csIndex.set(d, i));
      if (cs.length) busNodes.push({ text: `\tcs-gpios = ${cs.map((d) => gpioCell(d.cs!.pin, flagsOf(d.cs!))).join(", ")};`, cites: cs.flatMap((d) => d.cs!.cites), why: cs.map((d) => `${d.instance} CS ${where(d.cs!.pin)}`).join("; ") });
      if (bus.devices.length > 1) {
        for (const d of bus.devices.filter((d) => !d.cs)) {
          findings.push({ code: "FW_SPI_CS_MISSING", severity: "error", instance: d.instance, message: `${d.instance} (${d.part}) shares ${bus.id} with ${bus.devices.filter((x) => x !== d).map((x) => x.instance).join(", ")} but has no chip select wired to the controller`, cites: d.cites });
        }
      }
    }
    if (bus.protocol === "uart") {
      const d = bus.devices[0];
      const asked = (c.uart_baud as Record<string, unknown> | undefined)?.[d?.instance ?? ""];
      const baud = typeof asked === "number" ? asked : d?.baud;
      if (baud) busNodes.push({ text: `\tcurrent-speed = <${baud}>;`, cites: typeof asked === "number" ? ["constraint:uart_baud"] : [`part:${d.part}:${d.interface}.baud_rate`], why: `${d.instance} (${d.name})` });
      else findings.push({ code: "FW_UART_BAUD_UNKNOWN", severity: "error", instance: d?.instance, message: `${d?.instance} states no baud_rate; set uart_baud: { ${d?.instance}: <baud> } in firmware.config.ts`, cites: d?.cites });
    }
    bus.devices.forEach((d, i) => {
      // an I2C node needs reg (i2c-device.yaml); a device with no address is an error from the shared rules and gets no node
      if (bus.protocol === "i2c" && d.address !== undefined) busNodes.push(...deviceNode(d, `@${d.address.toString(16)}`, `<${hex(d.address)}>`));
      const reg = csIndex.get(d) ?? 0;
      if (bus.protocol === "spi" && !isDisplay(d)) busNodes.push(...deviceNode(d, `@${reg}`, `<${reg}>`, inst));
      if (bus.protocol === "spi" && isDisplay(d)) root.push(...displayNode(d, inst, reg));
      if (bus.protocol === "uart") {
        warnings.push(`${d.instance} (${d.part}) on ${inst}: no Zephyr driver in this provider's table; the application talks to ${inst} directly`);
        for (const g of d.controls) userGpio(g);
      }
    });
    busNodes.push({ text: "};" });
  }

  // 1-Wire
  for (const bus of fw.buses.filter((b) => b.protocol === "onewire")) {
    const s = bus.signals[0];
    const ext = fw.netlist.nets.find((n) => n.id === s.net);
    const pulled = ext?.pins.some((p) => fw.netlist.components.find((x) => x.instance === p.split(":")[0])?.kind === "resistor");
    needs("W1", s.cites);
    root.push(
      { text: "" },
      { text: `\tw1_${dtLabel(bus.id)}: w1-${dtName(bus.id)} {` },
      { text: '\t\tcompatible = "zephyr,w1-gpio";', cites: s.cites },
      { text: `\t\tgpios = ${gpioCell(s.pin, [...(pulled ? [] : ["GPIO_PULL_UP"]), "GPIO_OPEN_DRAIN", "GPIO_ACTIVE_HIGH"])};`, cites: s.cites, why: `1-Wire DQ on net ${s.net}: ${where(s.pin)}${pulled ? " (pull-up resistor on the board)" : ""}` },
    );
    for (const d of bus.devices) {
      const drv = DRIVERS[d.part];
      if (!drv) {
        warnings.push(`${d.instance} (${d.part}) on 1-Wire: no Zephyr driver in this provider's table`);
        continue;
      }
      drv.kconfig.forEach((k) => needs(k, d.cites));
      root.push({ text: `\t\t${dtLabel(d.instance)}: ${drv.node} {` }, { text: `\t\t\tcompatible = ${dtString(drv.compatible)};`, cites: d.cites, why: d.name });
      root.push(...fromPart(d, "\t\t\t"));
      root.push({ text: "\t\t};" });
    }
    root.push({ text: "\t};" });
  }

  // controls without a driver property, and wake sources
  for (const g of fw.gpios.filter((g) => g.use !== "button")) userGpio(g);
  const { sources } = wakeSources(fw, c.wake);
  if (sources.length) {
    zephyrUser.push({
      text: `\t\twakeup-gpios = ${sources.map((w) => gpioCell(w.pin, [w.activeLow ? "GPIO_ACTIVE_LOW" : "GPIO_ACTIVE_HIGH"])).join(", ")};`,
      cites: sources.flatMap((w) => w.cites),
      why: `wake from System OFF: ${sources.map((w) => w.source).join(", ")} (any nRF52840 GPIO can, through its SENSE level)`,
    });
  }
  if (zephyrUser.length) root.push({ text: "" }, { text: "\tzephyr,user {" }, ...zephyrUser, { text: "\t};" });
  root.push({ text: "};" });

  // regulators, GPIO ports, UICR, USB
  const internal = metadata(controller, "internal");
  if (typeof internal === "string" && /REG1 DC\/DC inductor/i.test(internal)) {
    after.push({ text: "" }, { text: "&reg1 {" }, { text: "\tregulator-initial-mode = <NRF5X_REG_MODE_DCDC>;", cites: [`part:${controller.id}:domains.electrical.metadata.internal`], why: "REG1 DC/DC inductor is inside the module" }, { text: "};" });
  }
  after.push({ text: "" }, { text: "&gpiote {" }, { text: '\tstatus = "okay";', cites: Object.keys(fw.uses).slice(0, 1).map((p) => `pin:${ctl}:${p}` as const), why: "GPIO interrupts" }, { text: "};" });
  for (const port of [0, 1]) {
    const pins = Object.keys(fw.uses)
      .filter((p) => portPin(leaf(p))?.port === port && !fw.usb?.pins.includes(p))
      .sort((a, b) => pp(a).pin - pp(b).pin);
    if (pins.length) after.push({ text: "" }, { text: `&gpio${port} {` }, { text: '\tstatus = "okay";', cites: pins.map((p) => `pin:${ctl}:${p}` as const), why: `used: ${pins.map((p) => pinLabel(pp(p))).join(", ")}` }, { text: "};" });
  }
  const nfc = Object.keys(fw.uses).filter((p) => (leaf(p)?.capabilities ?? []).some((x) => x === "nfc1" || x === "nfc2"));
  if (nfc.length) after.push({ text: "" }, { text: "&uicr {" }, { text: "\tnfct-pins-as-gpios;", cites: nfc.map((p) => `pin:${ctl}:${p}` as const), why: `${nfc.map((p) => leaf(p)?.name).join(", ")} used as GPIO` }, { text: "};" });
  if (fw.usb) {
    after.push({ text: "" }, { text: "zephyr_udc0: &usbd {" }, { text: '\tstatus = "okay";', cites: fw.usb.cites, why: `USB D+/D- wired to ${fw.usb.peers.join(", ")}` }, { text: "};" });
    needs("USB_DEVICE_STACK_NEXT", fw.usb.cites);
  }

  const dts: FirmwareFile = {
    path: `${dir}/${name}.dts`,
    role: "board devicetree",
    style: "c-block",
    warnings: true,
    header: [`${board.name}: Zephyr ${ZEPHYR_VERSION} board devicetree, generated from the UHD model by @protoboardai/ext-zephyr. Do not edit.`],
    lines: [...includes, { text: "" }, ...root, ...busNodes, ...after],
  };
  const pinctrlFile: FirmwareFile = { path: `${dir}/${name}-pinctrl.dtsi`, role: "pin assignment", style: "c-block", header: [`${board.name}: pin assignment, generated from the board's nets. Do not edit.`], lines: pinctrl };

  // ---- Kconfig and board metadata
  const xtal = fw.crystals.find((x) => x.pins.some((p) => (leaf(p)?.capabilities ?? []).some((k) => k.startsWith("lfxo_"))));
  const defconfig: CitedLine[] = [
    { text: "CONFIG_ARM_MPU=y", cites: [`part:${controller.id}:domains.electrical.metadata.cpu`], why: `${metadata(controller, "cpu")}: memory protection unit` },
  ];
  if (Object.keys(fw.uses).length) defconfig.push({ text: "CONFIG_GPIO=y", cites: Object.keys(fw.uses).slice(0, 3).map((p) => `pin:${ctl}:${p}` as const), why: "the board uses GPIOs" });
  if (xtal) {
    defconfig.push({ text: "CONFIG_CLOCK_CONTROL_NRF_K32SRC_XTAL=y", cites: xtal.cites, why: `32.768 kHz crystal ${xtal.instance} (${xtal.part}) on ${xtal.pins.map((p) => leaf(p)?.name).join(", ")}` });
  } else {
    defconfig.push({ text: "CONFIG_CLOCK_CONTROL_NRF_K32SRC_RC=y", cites: [`part:${controller.id}:traits.usage_note`], why: "no crystal on XL1/XL2: the internal RC oscillator (the module's usage note: omit the crystal with the RC oscillator)" });
    warnings.push("no 32.768 kHz crystal on XL1/XL2: the low-frequency clock runs from the RC oscillator (±500 ppm after calibration); BLE timing allows it, but sleep current rises with calibration");
  }
  const files: FirmwareFile[] = [
    {
      path: `${dir}/board.yml`,
      role: "board metadata",
      style: "yaml",
      header: ["Generated from the UHD model by @protoboardai/ext-zephyr. Do not edit."],
      lines: [
        { text: "board:" },
        { text: `  name: ${name}`, cites: [typeof c.board_name === "string" ? "constraint:board_name" : "module:id"] },
        { text: `  full_name: ${board.name}`, cites: ["module:name"] },
        { text: `  vendor: ${vendor}`, cites: [typeof c.vendor === "string" ? "constraint:vendor" : "module:id"] },
        { text: "  socs:" },
        { text: `    - name: ${soc.name}`, cites: [socCite], why: fact },
      ],
    },
    {
      path: `${dir}/Kconfig.${name}`,
      role: "board Kconfig",
      style: "kconfig",
      header: ["Generated from the UHD model by @protoboardai/ext-zephyr. Do not edit."],
      lines: [
        { text: `config BOARD_${name.toUpperCase()}`, cites: ["module:id"] },
        { text: `\tselect ${soc.kconfig}`, cites: [socCite], why: `${fact} (${soc.kconfig}: the ${soc.packageMatch.source.replace(/[\\?-]/g, "")} package)` },
      ],
    },
    { path: `${dir}/${name}_defconfig`, role: "board defconfig", style: "conf", header: ["Generated from the UHD model by @protoboardai/ext-zephyr. Do not edit."], lines: defconfig },
    dts,
    pinctrlFile,
    {
      path: "firmware.conf",
      role: "Kconfig fragment: subsystems for the board's devices",
      style: "conf",
      header: [`Subsystems the board's devices need (Zephyr ${ZEPHYR_VERSION}); each driver turns itself on when its devicetree node is enabled.`, "Add with -DEXTRA_CONF_FILE=firmware.conf. Generated by @protoboardai/ext-zephyr. Do not edit."],
      warnings: true,
      lines: [...kconfig].map(([sym, cites]) => ({ text: `CONFIG_${sym}=y`, cites: [...new Set(cites)].slice(0, 6), why: KCONFIG_WHY[sym] ?? sym })),
    },
  ];
  if (!soc.packageMatch.test(fact ?? "")) warnings.push(`${controller.id}: SoC fact "${fact}" does not name the ${soc.kconfig} package; check the Kconfig select`);
  return { files, warnings, findings };

  // ---- helpers that close over the context
  function isDisplay(d: FirmwareDevice) {
    // the UHD taxonomy's component.display, or a bare display category from before it
    return d.categories.some((x) => /^(component\.)?display(\.|$)/.test(x));
  }

  function fromPart(d: FirmwareDevice, indent: string): CitedLine[] {
    const drv = DRIVERS[d.part];
    const out: CitedLine[] = [];
    const part = ctx.project.lookup(d.part);
    for (const f of drv?.fromPart ?? []) {
      const t = part?.traits?.find((x) => x.type === "performance" && (x.params as Record<string, unknown> | undefined)?.[f.fact] !== undefined);
      const v = (t?.params as Record<string, unknown> | undefined)?.[f.fact];
      if (v !== undefined) out.push({ text: `${indent}${f.property} = ${f.format === "int" ? `<${v}>` : dtString(String(v))};`, cites: [`part:${d.part}:traits.performance.${f.fact}`] });
    }
    const props = (c.properties as Record<string, Record<string, unknown>> | undefined)?.[d.instance] ?? {};
    for (const [k, v] of Object.entries(props)) {
      const val = v === true ? undefined : dtValue(v);
      if (v === true) out.push({ text: `${indent}${k};`, cites: ["constraint:properties"] });
      else if (val) out.push({ text: `${indent}${k} = ${val};`, cites: ["constraint:properties"], why: "firmware.config.ts" });
      else findings.push({ code: "FW_PROPERTY_INVALID", severity: "error", instance: d.instance, message: `properties.${d.instance}.${k}: use a string, an integer, an integer array or true`, cites: ["constraint:properties"] });
    }
    for (const r of drv?.required ?? []) {
      if (props[r] === undefined) findings.push({ code: "FW_PROPERTY_MISSING", severity: "error", instance: d.instance, message: `${drv!.compatible} requires ${r}, which the model does not state; set properties: { ${d.instance}: { "${r}": … } } in firmware.config.ts`, cites: d.cites });
    }
    return out;
  }

  function controlLines(d: FirmwareDevice, indent: string): CitedLine[] {
    const drv = DRIVERS[d.part];
    const out: CitedLine[] = [];
    for (const g of d.controls) {
      const prop = drv?.controls?.[g.use];
      if (prop) out.push({ text: `${indent}${prop} = ${gpioCell(g.pin, flagsOf(g))};`, cites: g.cites, why: gpioWhy(g) });
      else userGpio(g);
    }
    return out;
  }

  function deviceNode(d: FirmwareDevice, unit: string, reg: string | undefined, spiInst?: string): CitedLine[] {
    const drv = DRIVERS[d.part];
    const out: CitedLine[] = [{ text: "" }, { text: `\t${dtLabel(d.instance)}: ${drv?.node ?? dtName(d.categories[d.categories.length - 1] ?? "device")}${unit} {` }];
    if (drv) {
      out.push({ text: `\t\tcompatible = ${dtString(drv.compatible)};`, cites: [`pin:${d.instance}:${d.interface}`], why: `${d.name} (${d.part})` });
      drv.kconfig.forEach((k) => needs(k, [`pin:${d.instance}:${d.interface}`]));
      if (drv.childrenNote) warnings.push(`${d.instance} (${drv.compatible}): ${drv.childrenNote}`);
    } else {
      warnings.push(`${d.instance} (${d.part}): no Zephyr driver in this provider's table; its node has no compatible, so the application finds it by the label ${dtLabel(d.instance)} and drives it itself`);
    }
    if (reg) out.push({ text: `\t\treg = ${reg};`, cites: d.cites, why: d.address !== undefined ? `I2C address ${hex(d.address)} (${d.part})` : `chip select ${reg}` });
    if (spiInst && d.maxClockHz) {
      const hz = Math.min(d.maxClockHz, NRF52840.spiMaxHz[spiInst]);
      out.push({ text: `\t\tspi-max-frequency = <${hz}>;`, cites: [...d.cites, `part:${controller.id}:domains.electrical.metadata.bus_limits.spim_Mbps`] });
    }
    if (drv) out.push(...fromPart(d, "\t\t"));
    out.push(...controlLines(d, "\t\t"));
    out.push({ text: "\t};" });
    return out;
  }

  function displayNode(d: FirmwareDevice, spiInst: string, index: number): CitedLine[] {
    const drv = DRIVERS[d.part];
    const part = ctx.project.lookup(d.part);
    const perf = part?.traits?.find((t) => t.type === "performance" && Array.isArray((t.params as Record<string, unknown> | undefined)?.resolution))?.params as { resolution?: number[]; controller?: string } | undefined;
    const out: CitedLine[] = [{ text: "" }, { text: `\tmipi_dbi_${dtLabel(d.instance)}: mipi-dbi-${dtName(d.instance)} {` }];
    out.push({ text: '\t\tcompatible = "zephyr,mipi-dbi-spi";', cites: [`pin:${d.instance}:${d.interface}`], why: "display on SPI with D/C (MIPI DBI type C, 4-wire)" });
    out.push({ text: `\t\tspi-dev = <&${spiInst}>;`, cites: [`pin:${d.instance}:${d.interface}`] });
    for (const g of d.controls.filter((g) => drv?.controls?.[g.use])) out.push({ text: `\t\t${drv!.controls![g.use]} = ${gpioCell(g.pin, flagsOf(g))};`, cites: g.cites, why: gpioWhy(g) });
    for (const g of d.controls.filter((g) => !drv?.controls?.[g.use])) userGpio(g);
    if (!d.controls.some((g) => g.use === "dc")) findings.push({ code: "FW_DISPLAY_DC_MISSING", severity: "error", instance: d.instance, message: `${d.instance} (${d.part}) has no D/C line wired to the controller; a 4-wire SPI display needs one`, cites: d.cites });
    // write-only is the panel's property (it drives no MISO), whatever else shares the bus
    if (!d.roles?.includes("miso")) out.push({ text: "\t\twrite-only;", cites: [`pin:${d.instance}:${d.interface}`], why: "the panel has no MISO: it is written, never read" });
    out.push({ text: "\t\t#address-cells = <1>;", cites: [`pin:${d.instance}:${d.interface}`] }, { text: "\t\t#size-cells = <0>;", cites: [`pin:${d.instance}:${d.interface}`] }, { text: "" });
    if (!drv) {
      warnings.push(`${d.instance} (${d.part}): no Zephyr display driver in this provider's table`);
      out.push({ text: "\t};" });
      return out;
    }
    drv.kconfig.forEach((k) => needs(k, [`pin:${d.instance}:${d.interface}`]));
    const hz = Math.min(d.maxClockHz ?? NRF52840.spiMaxHz[spiInst], NRF52840.spiMaxHz[spiInst]);
    out.push(
      { text: `\t\t${dtLabel(d.instance)}: ${drv.node}@${index} {` },
      { text: `\t\t\tcompatible = ${dtString(drv.compatible)};`, cites: [`part:${d.part}:traits.performance.controller`], why: `${perf?.controller ?? "controller"} (${d.part})` },
      { text: `\t\t\treg = <${index}>;`, cites: d.cs ? d.cs.cites : d.cites, why: `chip select ${index} of ${spiInst}` },
      { text: `\t\t\tmipi-max-frequency = <${hz}>;`, cites: [...d.cites.filter((x) => x.endsWith(".clock_freq")), `part:${controller.id}:domains.electrical.metadata.bus_limits.spim_Mbps`], why: `${hz / 1e6} MHz: the slower of the panel and ${spiInst}` },
      { text: "\t\t\tpixel-format = <PANEL_PIXEL_FORMAT_RGB_565>;", cites: [`part:${d.part}:traits.performance.colours`], why: "65K colours" },
    );
    includes.push({ text: "#include <zephyr/dt-bindings/display/panel.h>", cites: [`pin:${d.instance}:${d.interface}`] });
    if (perf?.resolution?.length === 2) {
      out.push({ text: `\t\t\twidth = <${perf.resolution[0]}>;`, cites: [`part:${d.part}:traits.performance.resolution`] }, { text: `\t\t\theight = <${perf.resolution[1]}>;`, cites: [`part:${d.part}:traits.performance.resolution`] });
    } else findings.push({ code: "FW_PROPERTY_MISSING", severity: "error", instance: d.instance, message: `${d.part} states no resolution (traits.performance.resolution); the display binding requires width and height`, cites: d.cites });
    out.push(...fromPart(d, "\t\t\t"));
    out.push({ text: "\t\t};" }, { text: "\t};" });
    return out;
  }
}

/** gpio-keys codes by button index: the digit keys, then the letter keys (zephyr/dt-bindings/input/input-event-codes.h). */
const BUTTON_CODES = 36;
export function buttonCode(i: number): string | undefined {
  if (i < 10) return `INPUT_KEY_${i}`;
  if (i < BUTTON_CODES) return `INPUT_KEY_${String.fromCharCode(65 + i - 10)}`;
  return undefined;
}

const KCONFIG_WHY: Record<string, string> = {
  I2C: "I2C buses",
  SPI: "SPI buses",
  SERIAL: "UARTs",
  W1: "1-Wire bus",
  INPUT: "buttons (gpio-keys)",
  FUEL_GAUGE: "fuel gauge driver",
  HAPTICS: "haptic driver",
  LED: "LED controller driver",
  DISPLAY: "display driver",
  SENSOR: "sensor drivers",
  USB_DEVICE_STACK_NEXT: "USB device stack",
};

function metadata(def: ModuleDef, key: string): unknown {
  for (const d of def.domains ?? []) {
    const m = (d as { metadata?: Record<string, unknown> }).metadata;
    if (m && key in m) return m[key];
  }
  return undefined;
}

export type { ZephyrSoc };
