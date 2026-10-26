/**
 * @protoboardai/ext-esp-idf end to end on a smart-bottle cap board
 * (test/fixtures/bottle-core: an ESP32-C3-MINI-1 with an I2C LED driver,
 * time-of-flight sensor and fuel gauge, a DS18B20 probe on 1-Wire, a BOOT
 * button on GPIO9 and a wake button on GPIO5, a 32.768 kHz crystal, a GNSS
 * on the UART0 pins, USB Serial/JTAG):
 *
 *   - the firmware provider contract: generate → export → extract → check
 *   - golden files: board_pins.h and sdkconfig.defaults, byte for byte
 *     (UPDATE_GOLDEN=1 rewrites them after a deliberate change)
 *   - every setting line cites UHD facts that exist on the board
 *   - the header compiles as C when a compiler is installed (with a stub
 *     driver/gpio.h)
 *   - seeded faults: strapping pins, Deep-sleep wake sources, pins that are
 *     not GPIOs, the one I2C controller, address conflicts, hand edits
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isSettingLine, loadProject, runCapabilityOperation, runProviderContract, type ContractReport, type FirmwareManifest, type PinRef, type Project } from "@protoboardai/core";
import { makeProject } from "./fixture.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp");
const GOLDEN = join(HERE, "golden");
const BOARD = "bottle-core-board";
const DIR = "src/boards/mainboard";
const OUT = `${DIR}/out`;
const NATIVE = `${DIR}/esp-idf`;
const VALIDATOR = "ext:@protoboardai/ext-esp-idf/firmware:check";

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let root: string;
let p: Project;
let report: ContractReport;
const text = (rel: string) => readFileSync(join(root, rel), "utf8");

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)).map((f) => `${n}/${f}`) : [n]));
}

beforeAll(async () => {
  root = makeProject(join(TMP, "bottle"));
  p = await loadProject(root);
  report = await runProviderContract(p, "firmware", BOARD, { record: false });
}, 120_000);

describe("the firmware provider contract on the bottle board", () => {
  it("loads the project with the provider selected by firmware.config.ts only, without findings", () => {
    expect(p.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(p.capabilities.map((b) => [b.capability, b.module, b.provider, b.native])).toEqual([["firmware", BOARD, "@protoboardai/ext-esp-idf", NATIVE]]);
    // the BOOT button on GPIO9 is noted, not an error
    expect(p.diagnostics.filter((d) => d.validator === VALIDATOR).map((d) => [d.code, d.severity])).toEqual([
      ["FW_STRAPPING_BUTTON", "info"],
      ["FW_NOT_GENERATED", "info"],
    ]);
  });

  it("passes generate, export, extract and check with no contract problems", () => {
    expect(report.steps.map((s) => [s.operation, s.status])).toEqual([
      ["generate", "succeeded"],
      ["export", "succeeded"],
      ["extract", "succeeded"],
      ["check", "succeeded"],
    ]);
    expect(report.steps.flatMap((s) => s.problems)).toEqual([]);
    expect(report.steps[0].summary).toMatch(/esp-idf configuration for u1 \(espressif-esp32-c3-mini-1-h4x\): 2 files, \d+ cited settings, 3 bus\(es\), 2 GPIO\(s\)$/);
  });

  it("writes board_pins.h and sdkconfig.defaults as in the golden files", () => {
    const got = files(join(root, OUT));
    expect(got).toEqual(["config/board_pins.h", "config/sdkconfig.defaults", "firmware.manifest.json"]);
    for (const f of got) {
      const golden = join(GOLDEN, f);
      if (process.env.UPDATE_GOLDEN) {
        mkdirSync(dirname(golden), { recursive: true });
        writeFileSync(golden, text(`${OUT}/${f}`));
      }
      expect(text(`${OUT}/${f}`), f).toBe(readFileSync(golden, "utf8"));
    }
    expect(files(GOLDEN)).toEqual(got);
  });
});

describe("what the configuration says", () => {
  it("names the bus pins, addresses, controls, buttons and wake mask from the board", () => {
    const h = text(`${OUT}/config/board_pins.h`);
    for (const line of [
      "#define BOARD_I2C0_SDA GPIO_NUM_6 /* net i2c_sda: u1:pin_20 IO6 */",
      "#define BOARD_I2C0_SCL GPIO_NUM_7 /* net i2c_scl: u1:pin_21 IO7 */",
      "#define BOARD_I2C0_FREQ_HZ 400000",
      "#define BOARD_I2C0_INTERNAL_PULLUPS 0 /* pull-up resistors on the board */",
      "#define BOARD_U2_I2C_ADDR 0x28 /* LED driver (ti-lp5024rsm) */",
      "#define BOARD_U3_I2C_ADDR 0x29",
      "#define BOARD_U4_I2C_ADDR 0x36",
      "#define BOARD_U4_ALRT_GPIO GPIO_NUM_3",
      // the GNSS's TXD reaches GPIO20, so the controller receives there
      "#define BOARD_UART1_RX GPIO_NUM_20 /* net gnss_tx: u1:pin_30 RXD0 */",
      "#define BOARD_UART1_BAUD 9600",
      "#define BOARD_ONEWIRE0_GPIO GPIO_NUM_10",
      "#define BOARD_ONEWIRE0_INTERNAL_PULLUP 0 /* pull-up resistor on the board */",
      "#define BOARD_P1_RESOLUTION_BITS 12",
      "#define BOARD_SW1_GPIO GPIO_NUM_9 /* BOOT button: u1:pin_23 IO9 */",
      "#define BOARD_SW2_ACTIVE_LEVEL 0 /* active low */",
      "#define BOARD_DEEP_SLEEP_WAKE_LOW_MASK ((1ULL << GPIO_NUM_5) | (1ULL << GPIO_NUM_3))",
    ]) {
      expect(h).toContain(line);
    }
    const sdk = text(`${OUT}/config/sdkconfig.defaults`);
    expect(sdk.match(/^CONFIG_\w+=.*$/gm)).toEqual(['CONFIG_IDF_TARGET="esp32c3"', "CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y", "CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y", "CONFIG_RTC_CLK_SRC_EXT_CRYS=y"]);
    // Kconfig values never carry a trailing comment: the reason is on the line above
    expect(sdk).toContain("# 4 MB flash in the package\nCONFIG_ESPTOOLPY_FLASHSIZE_4MB=y");
  });

  it("cites UHD facts on every setting line, and the manifest says which", () => {
    const m = JSON.parse(text(`${OUT}/firmware.manifest.json`)) as FirmwareManifest;
    expect(m).toMatchObject({ schema: "protoboard.firmware/v0", module: BOARD, provider: "@protoboardai/ext-esp-idf", framework: "esp-idf", frameworkVersion: "5.3.5", controller: { instance: "u1", part: "espressif-esp32-c3-mini-1-h4x" } });
    for (const f of m.files) {
      const lines = text(`${OUT}/${f.path}`).split("\n");
      const cited = new Set(f.lines.map((l) => l.line));
      const style = f.path.endsWith(".h") ? "c-block" : "conf";
      const settings = lines.map((l, i) => [l, i + 1] as const).filter(([l]) => isSettingLine(style, l));
      expect(settings.length, f.path).toBeGreaterThan(0);
      for (const [l, n] of settings) expect(cited.has(n), `${f.path}:${n} ${l}`).toBe(true);
    }
    const h = m.files.find((f) => f.path === "config/board_pins.h")!;
    const at = (needle: string) => h.lines.find((l) => l.line === text(`${OUT}/config/board_pins.h`).split("\n").findIndex((x) => x.includes(needle)) + 1)?.cites;
    expect(at("BOARD_U4_I2C_ADDR")).toEqual(["pin:u4:i2c", "part:adi-max17048g-t10:i2c.i2c_address", "part:adi-max17048g-t10:i2c.clock_freq"]);
    expect(at("WAKE_LOW_MASK")).toEqual(["constraint:wake", "net:btn_wake", "pin:u1:pin_19", "net:gnd", "net:fg_alrt", "pin:u1:pin_6", "pin:u4:pin_5"]);
    const sdk = m.files.find((f) => f.path === "config/sdkconfig.defaults")!;
    expect(sdk.lines.map((l) => l.cites[0])).toEqual([
      "part:espressif-esp32-c3-mini-1-h4x:domains.electrical.metadata.soc",
      "part:espressif-esp32-c3-mini-1-h4x:domains.electrical.metadata.memory.flash_MB",
      "pin:u1:usb",
      "pin:y1:pin_1",
    ]);
    expect(report.steps[1].record.diagnostics ?? []).toEqual([]);
  });

  it("reads back the GPIOs the header names (extract)", () => {
    const data = report.steps[2].record.data as { pins: PinRef[] };
    const pins = new Set(data.pins.map((r) => `${r.ref}=${r.pin}`));
    for (const x of ["GPIO6=pin_20", "GPIO7=pin_21", "GPIO9=pin_23", "GPIO10=pin_16", "GPIO20=pin_30", "GPIO21=pin_31"]) expect(pins.has(x), x).toBe(true);
    expect(data.pins.every((r) => r.pin)).toBe(true);
  });

  const cc = spawnSync("cc", ["--version"]).status === 0;
  it.runIf(cc)("board_pins.h compiles as C against a stub driver/gpio.h, and its values are what the board says", () => {
    const dir = join(TMP, "cc");
    mkdirSync(join(dir, "driver"), { recursive: true });
    writeFileSync(join(dir, "driver/gpio.h"), `typedef enum { ${Array.from({ length: 22 }, (_, i) => `GPIO_NUM_${i} = ${i}`).join(", ")} } gpio_num_t;\ntypedef enum { GPIO_PULLUP_ONLY, GPIO_PULLDOWN_ONLY, GPIO_PULLUP_PULLDOWN, GPIO_FLOATING } gpio_pull_mode_t;\n`);
    cpSync(join(root, OUT, "config/board_pins.h"), join(dir, "board_pins.h"));
    writeFileSync(
      join(dir, "main.c"),
      '#include <stdio.h>\n#include "board_pins.h"\nint main(void) { printf("%d %d %d %d %llx\\n", BOARD_I2C0_SDA, BOARD_U4_I2C_ADDR, BOARD_SW1_GPIO, BOARD_SW1_PULL == GPIO_PULLUP_ONLY, (unsigned long long)BOARD_DEEP_SLEEP_WAKE_LOW_MASK); return 0; }\n',
    );
    const build = spawnSync("cc", ["-std=c11", "-Wall", "-Werror", "-I", dir, "-o", join(dir, "main"), join(dir, "main.c")], { encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    expect(spawnSync(join(dir, "main"), { encoding: "utf8" }).stdout.trim()).toBe("6 54 9 1 28");
  });
});

describe("check", () => {
  it("catches a hand edit to a GPIO that is not on the module, and export refuses the edited file", async () => {
    const file = `${NATIVE}/board_pins.h`;
    const original = text(file);
    // GPIO12-17 drive the in-package flash; the module has no pins for them
    writeFileSync(join(root, file), original.replace("#define BOARD_ONEWIRE0_GPIO GPIO_NUM_10", "#define BOARD_ONEWIRE0_GPIO GPIO_NUM_12"));
    try {
      const rec = await runCapabilityOperation(p, "firmware", "check", BOARD, {}, { record: false });
      const codes = (rec.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`);
      expect(codes).toContain(`FW_NATIVE_EDITED: ${file} was edited after generate; regenerate it (and move project settings into the application's own files)`);
      expect(codes).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^FW_PIN_UNKNOWN: ${file}:\\d+ names GPIO12, which is not a pin of espressif-esp32-c3-mini-1-h4x`))]));
      expect(codes).toContain("FW_PIN_DRIFT: the board wires pin_16 (IO10) for onewire0.dq, but the native files do not configure it");
      const exp = await runCapabilityOperation(p, "firmware", "export", BOARD, {}, { record: false });
      expect(exp.status).toBe("failed");
    } finally {
      writeFileSync(join(root, file), original);
    }
  });
});

describe("an I2C bus whose devices state no clock", () => {
  it("still cites the I2C clock line (the controller's I2C limit), and generate succeeds", async () => {
    // every part without its clock_freq parameter
    const strip = (_id: string, json: string) => {
      const drop = (v: unknown): unknown =>
        Array.isArray(v) ? v.filter((x) => !(x && typeof x === "object" && (x as { id?: unknown }).id === "clock_freq")).map(drop) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, drop(x)])) : v;
      return JSON.stringify(drop(JSON.parse(json)), null, 2);
    };
    const dir = makeProject(join(TMP, "no-clock"), undefined, strip);
    expect(readFileSync(join(dir, "parts/catalog/adi-max17048g-t10.json"), "utf8")).not.toContain("clock_freq");
    const q = await loadProject(dir);
    expect(q.diagnostics.filter((d) => d.validator === VALIDATOR && d.severity === "error").map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    const gen = await runCapabilityOperation(q, "firmware", "generate", BOARD, {}, { record: false });
    expect(gen.status, gen.summary).toBe("succeeded");
    const index = JSON.parse(readFileSync(join(dir, NATIVE, "protoboard.lines.json"), "utf8")) as { files: { path: string; lines: { line: number; cites: string[] }[] }[] };
    const header = readFileSync(join(dir, NATIVE, "board_pins.h"), "utf8").split("\n");
    const n = header.findIndex((l) => l.startsWith("#define BOARD_I2C0_FREQ_HZ 400000")) + 1;
    expect(n).toBeGreaterThan(0);
    expect(index.files.find((f) => f.path === "board_pins.h")!.lines.find((l) => l.line === n)!.cites).toEqual(["part:espressif-esp32-c3-mini-1-h4x:domains.electrical.metadata.peripherals"]);
  });
});

const board = (f: (t: string) => string) => (rel: string, t: string) => (rel.endsWith(".uhd.ts") ? f(t) : t);
const config = (f: (t: string) => string) => (rel: string, t: string) => (rel.endsWith("firmware.config.ts") ? f(t) : t);

/** Seeded faults: one change each to the fixture's board or config, and the finding it must produce. */
const FAULTS: { name: string; edit: (rel: string, text: string) => string; code: string; message: RegExp }[] = [
  {
    name: "a wake button on a GPIO that cannot leave Deep-sleep",
    edit: config((t) => t.replace('wake: ["sw2", "u4"]', 'wake: ["sw1", "u4"]')),
    code: "FW_WAKE_INVALID",
    message: /wake source sw1 arrives on u1:pin_23 \(IO9\), which cannot wake espressif-esp32-c3-mini-1-h4x from Deep-sleep/,
  },
  {
    name: "the level sensor's interrupt output on strapping pin GPIO8",
    edit: board((t) => t.replace('netLinks("tof_int", ["u1:pin_18"', 'netLinks("tof_int", ["u1:pin_22"')),
    code: "FW_STRAPPING_DRIVEN",
    message: /Level sensor GPIO1 drives strapping pin u1:pin_22 \(IO8\)/,
  },
  {
    name: "the GNSS's TX on strapping pin GPIO2",
    edit: board((t) => t.replace('netLinks("gnss_tx", ["u1:pin_30"', 'netLinks("gnss_tx", ["u1:pin_5"')),
    code: "FW_STRAPPING_DRIVEN",
    message: /uart0 RX on strapping pin u1:pin_5 \(IO2\) is driven by m1's TX at reset/,
  },
  {
    name: "SDA on a pin that is not connected inside the module",
    edit: board((t) => t.replace('netLinks("i2c_sda", ["u1:pin_20"', 'netLinks("i2c_sda", ["u1:pin_4"')),
    code: "FW_PIN_NOT_GPIO",
    message: /u1:pin_4 \(NC\) carries i2c0\.sda, but it is not a GPIO/,
  },
  {
    name: "a second I2C bus on a chip with one I2C controller",
    edit: board((t) =>
      t
        .replace('"u1:pin_20", "u2:pin_28", "u3:pin_9", "u4:pin_8", "r1:pin_2"', '"u1:pin_20", "u3:pin_9", "u4:pin_8", "r1:pin_2"')
        .replace('"u1:pin_21", "u2:pin_29", "u3:pin_10", "u4:pin_7", "r2:pin_2"', '"u1:pin_21", "u3:pin_10", "u4:pin_7", "r2:pin_2"')
        .replace('...netLinks("x32k_p", ["u1:pin_12", "y1:pin_1"]),', '...netLinks("led_sda", ["u1:pin_12", "u2:pin_28"]),')
        .replace('...netLinks("x32k_n", ["u1:pin_13", "y1:pin_2"]),', '...netLinks("led_scl", ["u1:pin_13", "u2:pin_29"]),')
        .replace('Net({ id: "x32k_p", name: "X32K_P" }),', 'Net({ id: "led_sda", name: "LED_SDA" }),')
        .replace('Net({ id: "x32k_n", name: "X32K_N" }),', 'Net({ id: "led_scl", name: "LED_SCL" }),')
        .replace('{ id: "y1", moduleDefId: "epson-fc-135-32k768-12p5", name: "32.768 kHz crystal" },', ""),
    ),
    code: "FW_BUS_INSTANCES",
    message: /i2c1: the esp32c3 has 1 I2C controller\(s\); put the devices on one bus/,
  },
  {
    name: "two fuel gauges at 0x36 on one bus",
    edit: board((t) =>
      t
        .replace('{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },', '{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },\n    { id: "u5", moduleDefId: "adi-max17048g-t10", name: "Second gauge" },')
        .replace('"u4:pin_8", "r1:pin_2"', '"u4:pin_8", "u5:pin_8", "r1:pin_2"')
        .replace('"u4:pin_7", "r2:pin_2"', '"u4:pin_7", "u5:pin_7", "r2:pin_2"'),
    ),
    code: "FW_I2C_ADDRESS_CONFLICT",
    message: /i2c0: u4 \(adi-max17048g-t10\) and u5 \(adi-max17048g-t10\) share address 0x36/,
  },
  {
    name: "the wake button and the fuel gauge alert on one GPIO",
    edit: board((t) => t.replace('netLinks("btn_wake", ["u1:pin_19", "sw2:pin_2"])', 'netLinks("btn_wake", ["u1:pin_19", "sw2:pin_2", "u4:pin_5"])').replace('...netLinks("fg_alrt", ["u1:pin_6", "u4:pin_5"]),', "")),
    code: "FW_PIN_REUSED",
    message: /u1:pin_19 \(IO5\) is assigned 2 times: (button sw2; interrupt u4\.pin_5|interrupt u4\.pin_5; button sw2)/,
  },
];

describe("seeded faults", () => {
  for (const f of FAULTS) {
    it(`catches ${f.name} (${f.code}) in check, and generate refuses`, async () => {
      const dir = makeProject(join(TMP, `fault-${f.name.replace(/\W+/g, "-")}`), f.edit);
      const q = await loadProject(dir);
      const found = q.diagnostics.filter((d) => d.validator === VALIDATOR && d.code === f.code);
      expect(found.map((d) => d.message), JSON.stringify(q.diagnostics.filter((d) => d.validator === VALIDATOR).map((d) => d.code))).toEqual(expect.arrayContaining([expect.stringMatching(f.message)]));
      expect(found[0].severity).toBe("error");
      const gen = await runCapabilityOperation(q, "firmware", "generate", BOARD, {}, { record: false });
      expect(gen.status).toBe("failed");
      expect(existsSync(join(dir, NATIVE))).toBe(false);
    });
  }
});
