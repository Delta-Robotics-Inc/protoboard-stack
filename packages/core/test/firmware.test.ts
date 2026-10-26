/**
 * The firmware capability's shared pieces (PB-847): the board firmware map
 * and its rules, the cited-file renderer, and the standard outputs
 * (config/ + firmware.manifest.json). Small synthetic parts; the providers'
 * own tests (ext-zephyr, ext-esp-idf) run the whole contract on real parts.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { I2C, Net, Passive, defineModule, netLinks, pinTable, type ModuleDef } from "@deltarobotics/uhd";
import { afterAll, describe, expect, it } from "vitest";
import { CAPABILITIES } from "../src/extensions.js";
import { boardFirmware, checkBoardFirmware, renderFile, sha256, uncitedLines, validateOutputs, type FirmwareManifest } from "../src/index.js";

const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-firmware");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const GPIO = (pin: number, n: number, extra: string[] = []) => ({
  pin,
  name: `IO${n}`,
  type: "io" as const,
  capabilities: ["i2c_sda", "i2c_scl", "interrupt", `gpio${n}`, ...extra],
  protocols: [{ type: "interrupt", roles: ["input"] }],
});

const MCU: ModuleDef = defineModule({
  id: "t-mcu",
  name: "Test MCU",
  categories: ["microcontroller"],
  interfaces: pinTable(
    [
      { pin: 1, name: "3V3", type: "power_in", voltageV: [3.0, 3.6] },
      { pin: 2, name: "GND", type: "ground" },
      GPIO(3, 0, ["deep_sleep_wakeup"]),
      GPIO(4, 1),
      GPIO(5, 2),
      GPIO(6, 8, ["strapping"]),
      { pin: 7, name: "NC", type: "nc" },
    ],
    { source: "test", logicV: [0, 3.6] },
  ),
});

const SENSOR = (id: string, address: number): ModuleDef =>
  defineModule({
    id,
    name: `Sensor ${id}`,
    categories: ["sensor"],
    interfaces: [
      ...pinTable(
        [
          { pin: 1, name: "SDA", type: "io", capabilities: ["i2c_sda"] },
          { pin: 2, name: "SCL", type: "input", capabilities: ["i2c_scl"] },
          { pin: 3, name: "INT", type: "output", capabilities: ["active_low", "open_drain"], protocols: [{ type: "interrupt", roles: ["output"] }] },
          { pin: 4, name: "GND", type: "ground" },
        ],
        { source: "test", logicV: [0, 3.6] },
      ),
      ...I2C({ id: "i2c", roles: ["slave"], sda: "pin_1", scl: "pin_2", address, defaultActive: true }),
    ],
  });

const BUTTON: ModuleDef = defineModule({
  id: "t-button",
  name: "Button",
  categories: ["input", "input.switch"],
  interfaces: pinTable(
    [
      { pin: 1, name: "A", type: "passive" },
      { pin: 2, name: "B", type: "passive" },
    ],
    { source: "test" },
  ),
});
const R10K = Passive({ id: "t-r10k", name: "10 kΩ", kind: "resistor", value: 1e4, unit: "Ω", package: { name: "0402", pin_count: 2, exposed_pad: false } });

const parts = new Map<string, ModuleDef>([MCU, SENSOR("t-sens-a", 0x36), SENSOR("t-sens-b", 0x36), BUTTON, R10K].map((d) => [d.id, d]));
const lookup = (id: string) => parts.get(id);

function board(over: { sda?: string; int?: string; btn?: string; second?: boolean; pull?: boolean } = {}): ModuleDef {
  return defineModule({
    id: "t-board",
    name: "Test board",
    interfaces: ["v3v3", "gnd", "sda", "scl", "int", "btn"].map((id) => Net({ id, name: id.toUpperCase(), ...(id === "v3v3" ? { voltageV: 3.3 } : {}) })),
    children: [
      { id: "u1", moduleDefId: "t-mcu" },
      { id: "u2", moduleDefId: "t-sens-a", name: "Gauge" },
      ...(over.second ? [{ id: "u3", moduleDefId: "t-sens-b" }] : []),
      { id: "sw1", moduleDefId: "t-button", name: "Wake button" },
      ...(over.pull ? [{ id: "r1", moduleDefId: "t-r10k" }] : []),
    ],
    links: [
      ...netLinks("v3v3", ["u1:pin_1", ...(over.pull ? ["r1:pin_1"] : [])]),
      ...netLinks("gnd", ["u1:pin_2", "u2:pin_4", "sw1:pin_2", ...(over.second ? ["u3:pin_4"] : [])]),
      ...netLinks("sda", [over.sda ?? "u1:pin_4", "u2:pin_1", ...(over.second ? ["u3:pin_1"] : [])]),
      ...netLinks("scl", ["u1:pin_5", "u2:pin_2", ...(over.second ? ["u3:pin_2"] : [])]),
      ...netLinks("int", [over.int ?? "u1:pin_3", "u2:pin_3"]),
      ...netLinks("btn", [over.btn ?? "u1:pin_3", "sw1:pin_1", ...(over.pull ? ["r1:pin_2"] : [])]),
    ],
  });
}

const codes = (b: ModuleDef, wake?: unknown) =>
  checkBoardFirmware(boardFirmware(b, lookup), lookup, { wake, canWake: (l) => (l.capabilities ?? []).includes("deep_sleep_wakeup") })
    .map((f) => f.code)
    .sort();

describe("firmware capability", () => {
  it("is a capability with standard outputs", () => {
    expect(CAPABILITIES).toContain("firmware");
  });
});

describe("boardFirmware", () => {
  it("reads buses, addresses, controls and buttons from the nets, each with its cites", () => {
    const fw = boardFirmware(board({ btn: "u1:pin_6", pull: true }), lookup);
    expect(fw.controller).toEqual({ instance: "u1", part: "t-mcu", name: "Test MCU" });
    expect(fw.buses).toHaveLength(1);
    const bus = fw.buses[0];
    expect(bus.signals.map((s) => [s.role, s.pin, s.net, s.cites])).toEqual([
      ["sda", "pin_4", "sda", ["net:sda", "pin:u1:pin_4", "pin:u2:pin_1"]],
      ["scl", "pin_5", "scl", ["net:scl", "pin:u1:pin_5", "pin:u2:pin_2"]],
    ]);
    expect(bus.devices.map((d) => [d.instance, d.address, d.cites])).toEqual([["u2", 0x36, ["pin:u2:i2c", "part:t-sens-a:i2c.i2c_address", "part:t-sens-a:i2c.clock_freq"]]]);
    expect(bus.devices[0].controls.map((g) => [g.use, g.pin, g.direction, g.activeLow, g.pull])).toEqual([["interrupt", "pin_3", "input", true, "up"]]);
    // the board's own pull-up replaces the internal one
    expect(fw.gpios.map((g) => [g.use, g.instance, g.pin, g.activeLow, g.pull, g.externalPull])).toEqual([["button", "sw1", "pin_6", true, undefined, { instance: "r1", to: "up", net: "v3v3" }]]);
    expect(fw.uses).toEqual({ pin_4: ["i2c0.sda"], pin_5: ["i2c0.scl"], pin_3: ["interrupt u2.pin_3"], pin_6: ["button sw1"] });
  });

  it("follows a divider: a supply sensed through a resistor pair is a sense line, pulled by its lower leg", () => {
    const b = defineModule({
      id: "t-sense-board",
      name: "Sense board",
      interfaces: ["v3v3", "vbus", "gnd", "sense"].map((id) => Net({ id, name: id.toUpperCase(), ...(id === "v3v3" ? { voltageV: 3.3 } : id === "vbus" ? { voltageV: 5 } : {}) })),
      children: [
        { id: "u1", moduleDefId: "t-mcu" },
        { id: "r1", moduleDefId: "t-r10k" },
        { id: "r2", moduleDefId: "t-r10k" },
      ],
      links: [
        ...netLinks("v3v3", ["u1:pin_1"]),
        ...netLinks("gnd", ["u1:pin_2", "r2:pin_2"]),
        ...netLinks("vbus", ["r1:pin_1"]),
        ...netLinks("sense", ["u1:pin_4", "r1:pin_2", "r2:pin_1"]),
      ],
    });
    const fw = boardFirmware(b, lookup);
    expect(fw.gpios.map((g) => [g.use, g.instance, g.pin, g.direction, g.externalPull])).toEqual([["sense", "vbus", "pin_4", "input", { instance: "r2", to: "down", net: "gnd" }]]);
    expect(fw.uses).toEqual({ pin_4: ["sense vbus via r1"] });
    expect(fw.findings.map((f) => f.code)).not.toContain("FW_NET_UNUSED");
  });

  it("finds pins used twice, address conflicts, pins that are not GPIOs, strapping pins driven, invalid wake sources", () => {
    expect(codes(board({ btn: "u1:pin_6" }), ["sw1"])).toEqual(["FW_STRAPPING_BUTTON", "FW_WAKE_INVALID"]);
    expect(codes(board({ btn: "u1:pin_6" }), ["u2"])).toEqual(["FW_STRAPPING_BUTTON"]);
    expect(codes(board({ btn: "u1:pin_6" }), ["nope"])).toEqual(["FW_STRAPPING_BUTTON", "FW_WAKE_UNKNOWN"]);
    // the interrupt and the button share pin_3 (which also joins their two nets into one conductor)
    expect(codes(board())).toEqual(["FW_BOARD_UNREADABLE", "FW_PIN_REUSED"]);
    expect(codes(board({ btn: "u1:pin_6", second: true }))).toEqual(["FW_I2C_ADDRESS_CONFLICT", "FW_STRAPPING_BUTTON"]);
    expect(codes(board({ btn: "u1:pin_6", sda: "u1:pin_7" }))).toEqual(["FW_PIN_NOT_GPIO", "FW_STRAPPING_BUTTON"]);
    expect(codes(board({ btn: "u1:pin_4", int: "u1:pin_6" }))).toEqual(expect.arrayContaining(["FW_PIN_REUSED", "FW_STRAPPING_DRIVEN"]));
  });

  it("needs exactly one controller", () => {
    const noMcu = defineModule({ id: "t-empty", name: "Empty", interfaces: [], children: [{ id: "sw1", moduleDefId: "t-button" }] });
    expect(boardFirmware(noMcu, lookup).findings.map((f) => f.code)).toEqual(["FW_NO_CONTROLLER"]);
  });
});

describe("cited files", () => {
  it("puts reasons beside devicetree lines and above Kconfig lines, and indexes cites by line", () => {
    const dts = renderFile({ path: "a.dts", role: "dt", style: "c-block", header: ["H"], lines: [{ text: "/ {" }, { text: '\tstatus = "okay";', cites: ["net:sda"], why: "bus" }, { text: "};" }] });
    expect(dts.text).toBe('/* H */\n\n/ {\n\tstatus = "okay"; /* bus */\n};\n');
    expect(dts.lines).toEqual([{ line: 4, cites: ["net:sda"] }]);
    expect(dts.digest).toBe(sha256(dts.text));
    const conf = renderFile({ path: "a.conf", role: "conf", style: "conf", lines: [{ text: "CONFIG_I2C=y", cites: ["net:sda", "net:sda"], why: "I2C buses" }] });
    expect(conf.text).toBe("# I2C buses\nCONFIG_I2C=y\n");
    expect(conf.lines).toEqual([{ line: 2, cites: ["net:sda"] }]);
    expect(uncitedLines({ path: "b.conf", role: "", style: "conf", lines: [{ text: "CONFIG_SPI=y" }, { text: "# note" }] })).toEqual(["CONFIG_SPI=y"]);
  });
});

describe("firmware standard outputs", () => {
  const def = board({ btn: "u1:pin_6" });
  const out = join(TMP, "out");
  const write = (manifest: unknown, files: Record<string, string>) => {
    rmSync(out, { recursive: true, force: true });
    for (const [f, t] of Object.entries(files)) {
      mkdirSync(join(out, f, ".."), { recursive: true });
      writeFileSync(join(out, f), t);
    }
    if (manifest !== undefined) writeFileSync(join(out, "firmware.manifest.json"), JSON.stringify(manifest));
    return validateOutputs({ capability: "firmware", outDir: out, module: def, lookup }).map((f) => `${f.code} ${f.file}: ${f.message}`);
  };
  const conf = "# x\nCONFIG_I2C=y\n";
  const good = (over: Partial<FirmwareManifest["files"][number]> = {}): FirmwareManifest => ({
    schema: "protoboard.firmware/v0",
    module: "t-board",
    provider: "@test/fw",
    framework: "test",
    controller: { instance: "u1", part: "t-mcu" },
    files: [{ path: "config/sub/fw.conf", digest: sha256(conf), lines: [{ line: 2, cites: ["net:sda", "pin:u2:i2c", "part:t-sens-a:i2c.i2c_address", "constraint:wake"] }], ...over }],
  });

  it("accepts a manifest whose files, digests, lines and cites all hold", () => {
    expect(write(good(), { "config/sub/fw.conf": conf })).toEqual([]);
  });

  it("reports what is missing, unlisted, changed or cites what the board does not have", () => {
    expect(write(undefined, {})).toEqual(["PB_OUTPUT_MISSING config/: missing firmware configuration files (any layout under config/; subfolders allowed)", "PB_OUTPUT_MISSING firmware.manifest.json: missing firmware manifest: every file in config/ with its digest and the UHD facts each line cites (protoboard.firmware/v0)"]);
    expect(write(good(), { "config/sub/fw.conf": conf, "config/extra.h": "#define X 1\n" })).toEqual(["PB_OUTPUT_INCOMPLETE config/extra.h: is not listed in firmware.manifest.json: every configuration file names the facts it is derived from"]);
    expect(write(good(), { "config/sub/fw.conf": conf + "CONFIG_SPI=y\n" })[0]).toMatch(/digest .* does not match the file .*changed after export/);
    expect(write(good({ lines: [{ line: 9, cites: ["net:sda"] }] }), { "config/sub/fw.conf": conf })).toEqual(["PB_OUTPUT_MALFORMED firmware.manifest.json: config/sub/fw.conf: line 9 is not a line of the file (1-3)"]);
    expect(write(good({ lines: [{ line: 2, cites: ["net:nope", "pin:u9:pin_1", "pin:u2:pin_99", "part:other:x", "wire:x"] }] }), { "config/sub/fw.conf": conf })).toEqual([
      "PB_OUTPUT_UNKNOWN_INSTANCE firmware.manifest.json: config/sub/fw.conf:2: cite \"net:nope\": t-board has no net nope",
      "PB_OUTPUT_UNKNOWN_INSTANCE firmware.manifest.json: config/sub/fw.conf:2: cite \"pin:u9:pin_1\": u9 is not a component of t-board",
      "PB_OUTPUT_UNKNOWN_INSTANCE firmware.manifest.json: config/sub/fw.conf:2: cite \"pin:u2:pin_99\": t-sens-a has no interface pin_99",
      "PB_OUTPUT_UNKNOWN_INSTANCE firmware.manifest.json: config/sub/fw.conf:2: cite \"part:other:x\": no component of t-board is part other",
      'PB_OUTPUT_UNKNOWN_INSTANCE firmware.manifest.json: config/sub/fw.conf:2: cite "wire:x" is not <net|link|pin|part|module|constraint>:<ref>',
    ]);
    expect(write({ ...good(), controller: { instance: "u2", part: "t-mcu" } }, { "config/sub/fw.conf": conf })).toEqual(["PB_OUTPUT_MALFORMED firmware.manifest.json: controller u2 is t-sens-a, not t-mcu"]);
  });
});
