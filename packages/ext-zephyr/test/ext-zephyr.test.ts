/**
 * @protoboardai/ext-zephyr end to end on a watch mainboard (test/fixtures/
 * watch-core: a Raytac MDBT50Q-1MV2 with an I2C heart-rate sensor, fuel
 * gauge and haptic driver, an SPI display, a button, the charger's status
 * line, a 32.768 kHz crystal, a GNSS on a UART, USB):
 *
 *   - the firmware provider contract: generate → export → extract → check
 *   - golden files: the board definition and Kconfig fragment, byte for byte
 *     (UPDATE_GOLDEN=1 rewrites them after a deliberate change)
 *   - every setting line cites UHD facts that exist on the board
 *   - the devicetree is well formed (structural parser; dtc when installed)
 *   - seeded faults in the model, the config and the native files are caught
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FORMER_PACKAGE_SCOPE,
  PACKAGE_SCOPE,
  isSettingLine,
  loadProject,
  runCapabilityOperation,
  runProviderContract,
  sha256,
  type ContractReport,
  type FirmwareManifest,
  type PinRef,
  type Project,
} from "@protoboardai/core";
import { buttonCode } from "../lib/design.ts";
import { checkDts } from "../lib/dts.ts";
import { NRF52840 } from "../lib/soc.ts";
import { makeProject } from "./fixture.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp");
const GOLDEN = join(HERE, "golden");
const BOARD = "watch-core-board";
const DIR = "src/boards/mainboard";
const OUT = `${DIR}/out`;
const NATIVE = `${DIR}/zephyr`;
const BOARD_DIR = "boards/protoboard/watch_core";
const VALIDATOR = "ext:@protoboardai/ext-zephyr/firmware:check";

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

const styleOf = (path: string) => (/\.(dts|dtsi)$/.test(path) ? "c-block" : path.endsWith(".yml") ? "yaml" : /\/Kconfig\./.test(path) ? "kconfig" : "conf");

beforeAll(async () => {
  root = makeProject(join(TMP, "watch"));
  p = await loadProject(root);
  report = await runProviderContract(p, "firmware", BOARD, { record: false });
}, 120_000);

describe("the firmware provider contract on the watch board", () => {
  it("loads the project with the provider selected by firmware.config.ts only, without findings", () => {
    expect(p.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(p.capabilities.map((b) => [b.capability, b.module, b.provider, b.native])).toEqual([["firmware", BOARD, "@protoboardai/ext-zephyr", NATIVE]]);
  });

  it("passes generate, export, extract and check with no contract problems", () => {
    expect(report.steps.map((s) => [s.operation, s.status])).toEqual([
      ["generate", "succeeded"],
      ["export", "succeeded"],
      ["extract", "succeeded"],
      ["check", "succeeded"],
    ]);
    expect(report.steps.flatMap((s) => s.problems)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.steps[0].summary).toMatch(/zephyr configuration for u1 \(raytac-mdbt50q-1mv2\): 6 files, \d+ cited settings, 3 bus\(es\), 2 GPIO\(s\), 2 warning\(s\)/);
  });

  it("writes the board definition and Kconfig fragment as in the golden files", () => {
    const got = files(join(root, OUT));
    expect(got).toEqual([
      `config/${BOARD_DIR}/Kconfig.watch_core`,
      `config/${BOARD_DIR}/board.yml`,
      `config/${BOARD_DIR}/watch_core-pinctrl.dtsi`,
      `config/${BOARD_DIR}/watch_core.dts`,
      `config/${BOARD_DIR}/watch_core_defconfig`,
      "config/firmware.conf",
      "firmware.manifest.json",
    ]);
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
  it("assigns each bus to pins from the board's nets", () => {
    const pinctrl = text(`${OUT}/config/${BOARD_DIR}/watch_core-pinctrl.dtsi`);
    expect(pinctrl).toContain("psels = <NRF_PSEL(TWIM_SDA, 0, 13)>, /* SDA on net i2c_sda: u1:pin_37 P0.13 */");
    expect(pinctrl).toContain("<NRF_PSEL(TWIM_SCL, 0, 14)>; /* SCL on net i2c_scl: u1:pin_36 P0.14 */");
    // the display gets the 32 MHz SPIM3; UART TX/RX are crossed relative to the GNSS's own pins
    expect(pinctrl).toContain("psels = <NRF_PSEL(SPIM_SCK, 0, 19)>");
    expect(pinctrl).toContain("psels = <NRF_PSEL(UART_TX, 0, 26)>; /* TX on net gnss_rx: u1:pin_19 P0.26 */");
    expect(pinctrl).toContain("psels = <NRF_PSEL(UART_RX, 0, 27)>; /* RX on net gnss_tx: u1:pin_16 P0.27 */");
  });

  it("puts each device on its bus at the part's address, with the controls the binding takes", () => {
    const dts = text(`${OUT}/config/${BOARD_DIR}/watch_core.dts`);
    expect(dts).toContain('#include <nordic/nrf52840_qiaa.dtsi> /* raytac-mdbt50q-1mv2: Nordic nRF52840 revision 2, aQFN-73 */');
    expect(dts).toMatch(/u3: fuel-gauge@36 \{\n\t\tcompatible = "maxim,max17048";[^\n]*\n\t\treg = <0x36>;/);
    expect(dts).toMatch(/u5: haptics@5a \{\n\t\tcompatible = "ti,drv2605";[^\n]*\n\t\treg = <0x5a>;[^\n]*\n\t\tactuator-mode = "LRA";[^\n]*\n\t\ten-gpios = <&gpio0 17 GPIO_ACTIVE_HIGH>;/);
    // no Zephyr driver for the MAX30102: a node without compatible, and its interrupt for the application
    expect(dts).toMatch(/u2: sensor-biometric@57 \{\n\t\treg = <0x57>;/);
    expect(dts).toContain("u2-int-gpios = <&gpio0 15 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>;");
    expect(dts).toContain("clock-frequency = <I2C_BITRATE_FAST>;");
    // display: MIPI DBI on spi3, D/C and reset from the board, size from the part
    expect(dts).toContain("spi-dev = <&spi3>;");
    expect(dts).toContain("dc-gpios = <&gpio0 23 GPIO_ACTIVE_HIGH>;");
    expect(dts).toContain("reset-gpios = <&gpio0 22 GPIO_ACTIVE_LOW>;");
    expect(dts).toContain("width = <240>;");
    expect(dts).toContain("cs-gpios = <&gpio0 20 GPIO_ACTIVE_LOW>;");
    // the button pulls to GND: active low with the internal pull-up
    expect(dts).toContain("gpios = <&gpio1 11 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>; /* Side button: u1:pin_4 P1.11 */");
    expect(dts).toContain("wakeup-gpios = <&gpio1 11 GPIO_ACTIVE_LOW>, <&gpio0 16 GPIO_ACTIVE_LOW>;");
    expect(dts).toContain("regulator-initial-mode = <NRF5X_REG_MODE_DCDC>;");
    expect(dts).toContain("zephyr_udc0: &usbd {");
    const defconfig = text(`${OUT}/config/${BOARD_DIR}/watch_core_defconfig`);
    expect(defconfig).toContain("CONFIG_CLOCK_CONTROL_NRF_K32SRC_XTAL=y");
    expect(text(`${OUT}/config/firmware.conf`).match(/^CONFIG_\w+=y$/gm)).toEqual([
      "CONFIG_INPUT=y",
      "CONFIG_I2C=y",
      "CONFIG_FUEL_GAUGE=y",
      "CONFIG_HAPTICS=y",
      "CONFIG_SPI=y",
      "CONFIG_DISPLAY=y",
      "CONFIG_SERIAL=y",
      "CONFIG_USB_DEVICE_STACK_NEXT=y",
    ]);
  });

  it("cites UHD facts on every setting line, and the manifest says which", () => {
    const m = JSON.parse(text(`${OUT}/firmware.manifest.json`)) as FirmwareManifest;
    expect(m).toMatchObject({ schema: "protoboard.firmware/v0", module: BOARD, provider: "@protoboardai/ext-zephyr", framework: "zephyr", frameworkVersion: "4.2.0", controller: { instance: "u1", part: "raytac-mdbt50q-1mv2" } });
    expect(m.warnings).toHaveLength(2);
    for (const f of m.files) {
      const lines = text(`${OUT}/${f.path}`).split("\n");
      const cited = new Set(f.lines.map((l) => l.line));
      const settings = lines.map((l, i) => [l, i + 1] as const).filter(([l]) => isSettingLine(styleOf(f.path), l));
      expect(settings.length, f.path).toBeGreaterThan(0);
      for (const [l, n] of settings) expect(cited.has(n), `${f.path}:${n} ${l}`).toBe(true);
    }
    const sda = m.files.find((f) => f.path.endsWith("pinctrl.dtsi"))!.lines[0];
    expect(sda.cites).toEqual(["net:i2c_sda", "pin:u1:pin_37", "pin:u2:pin_3"]);
    const reg = m.files.find((f) => f.path.endsWith(".dts"))!;
    const regLine = text(`${OUT}/${reg.path}`).split("\n").findIndex((l) => l.includes("reg = <0x36>")) + 1;
    expect(reg.lines.find((l) => l.line === regLine)?.cites).toEqual(["pin:u3:i2c", "part:adi-max17048g-t10:i2c.i2c_address", "part:adi-max17048g-t10:i2c.clock_freq"]);
    // standard-output validation of the manifest (digests, line numbers, cites) found nothing
    expect(report.steps[1].record.diagnostics ?? []).toEqual([]);
  });

  it("reads back the pins the devicetree names (extract)", () => {
    const data = report.steps[2].record.data as { pins: PinRef[]; artifacts: { id: string; filePath: string }[] };
    expect(data.artifacts.map((a) => [a.id, a.filePath])).toEqual([
      ["firmware_source", NATIVE],
      ["firmware_manifest", `${OUT}/firmware.manifest.json`],
    ]);
    const pins = new Set(data.pins.map((r) => `${r.ref}=${r.pin}`));
    for (const x of ["P0.13=pin_37", "P0.14=pin_36", "P1.11=pin_4", "P0.20=pin_44", "P1.10=pin_3"]) expect(pins.has(x), x).toBe(true);
    expect(data.pins.every((r) => r.pin)).toBe(true);
  });
});

describe("devicetree syntax", () => {
  const sources = () => Object.fromEntries([".dts", "-pinctrl.dtsi"].map((s) => [`watch_core${s}`, text(`${OUT}/config/${BOARD_DIR}/watch_core${s}`)]));

  it("is well formed: nodes closed, properties terminated, every &label defined (structural parser)", () => {
    expect(checkDts(sources(), NRF52840.labels)).toEqual([]);
  });

  it("the structural parser catches a missing semicolon, an unclosed node and an unknown label", () => {
    const s = sources();
    const broken = {
      "watch_core.dts": s["watch_core.dts"].replace('status = "okay"; /* GPIO interrupts */', 'status = "okay" /* GPIO interrupts */').replace("spi-dev = <&spi3>;", "spi-dev = <&spi9>;"),
      "watch_core-pinctrl.dtsi": s["watch_core-pinctrl.dtsi"].replace(/\n};\n$/, "\n"),
    };
    const problems = checkDts(broken, NRF52840.labels).map((x) => `${x.file}: ${x.message}`);
    expect(problems).toContain("watch_core.dts: property status is not closed with ;");
    expect(problems).toContain("watch_core-pinctrl.dtsi: 1 node(s) not closed");
    expect(problems).toContain("watch_core.dts: &spi9 is not defined by these files or the SoC devicetree");
  });

  const dtc = spawnSync("dtc", ["--version"]).status === 0 && spawnSync("cpp", ["--version"]).status === 0;
  it.runIf(dtc)("compiles with dtc after the C preprocessor, against a stub of the SoC devicetree", () => {
    const dir = join(TMP, "dtc");
    mkdirSync(join(dir, "nordic"), { recursive: true });
    mkdirSync(join(dir, "zephyr/dt-bindings/input"), { recursive: true });
    mkdirSync(join(dir, "zephyr/dt-bindings/display"), { recursive: true });
    writeFileSync(join(dir, "nordic/nrf52840_qiaa.dtsi"), `/ {\n${NRF52840.labels.map((l, i) => `\t${l}: stub-${i} { };`).join("\n")}\n};\n`);
    const stub = ["#define NRF_PSEL(f, port, pin) ((port) * 32 + (pin))", "#define GPIO_ACTIVE_HIGH 0", "#define GPIO_ACTIVE_LOW 1", "#define GPIO_OPEN_DRAIN 6", "#define GPIO_PULL_UP 16", "#define GPIO_PULL_DOWN 32", "#define I2C_BITRATE_STANDARD 100000", "#define I2C_BITRATE_FAST 400000", "#define NRF5X_REG_MODE_DCDC 1", "#define PANEL_PIXEL_FORMAT_RGB_565 16"];
    writeFileSync(join(dir, "stub.h"), stub.join("\n") + "\n");
    writeFileSync(join(dir, "zephyr/dt-bindings/input/input-event-codes.h"), "#define INPUT_KEY_0 11\n");
    writeFileSync(join(dir, "zephyr/dt-bindings/display/panel.h"), "\n");
    cpSync(join(root, OUT, "config", BOARD_DIR), join(dir, "board"), { recursive: true });
    const pre = spawnSync("cpp", ["-nostdinc", "-undef", "-x", "assembler-with-cpp", "-P", "-I", dir, "-I", join(dir, "board"), "-include", join(dir, "stub.h"), join(dir, "board/watch_core.dts")], { encoding: "utf8" });
    expect(pre.status, pre.stderr).toBe(0);
    const out = spawnSync("dtc", ["-I", "dts", "-O", "dtb", "-o", join(dir, "board.dtb"), "-"], { input: pre.stdout, encoding: "utf8" });
    expect(out.status, out.stderr).toBe(0);
  });
  it.skipIf(dtc)("dtc is not installed here: the structural parser above is the devicetree syntax check", () => {});
});

describe("check", () => {
  it("runs through `protoboard check`, attributed to the provider, clean on the generated design", async () => {
    const again = await loadProject(root);
    expect(again.checks.find((c) => c.validator === VALIDATOR)).toMatchObject({ subject: BOARD, status: "ran", counts: { error: 0, warning: 0 } });
    expect(again.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  });

  it("catches a hand edit to a pin that is not on the module, and export refuses the edited file", async () => {
    const file = `${NATIVE}/${BOARD_DIR}/watch_core-pinctrl.dtsi`;
    const original = text(file);
    writeFileSync(join(root, file), original.replaceAll("NRF_PSEL(TWIM_SDA, 0, 13)", "NRF_PSEL(TWIM_SDA, 1, 20)"));
    try {
      const rec = await runCapabilityOperation(p, "firmware", "check", BOARD, {}, { record: false });
      const codes = (rec.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`);
      expect(codes).toContain(`FW_NATIVE_EDITED: ${file} was edited after generate; regenerate it (and move project settings into the application's own files)`);
      expect(codes).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^FW_PIN_UNKNOWN: ${file}:\\d+ names P1\\.20, which is not a pin of raytac-mdbt50q-1mv2`))]));
      expect(codes.some((c) => c.startsWith("FW_PIN_DRIFT: the board wires pin_37 (P0.13) for i2c0.sda"))).toBe(true);
      const exp = await runCapabilityOperation(p, "firmware", "export", BOARD, {}, { record: false });
      expect(exp.status).toBe("failed");
      expect(exp.summary).toContain("watch_core-pinctrl.dtsi changed since generate");
    } finally {
      writeFileSync(join(root, file), original);
    }
  });

  it("reports the native files as stale when the board changes after generate", async () => {
    // the files generated for the fixture, in a project whose button moved from P1.11 to P1.12
    const dir = makeProject(join(TMP, "stale"), (rel, t) => (rel.endsWith(".uhd.ts") ? t.replace('netLinks("btn", ["u1:pin_4"', 'netLinks("btn", ["u1:pin_5"') : t));
    cpSync(join(root, NATIVE), join(dir, NATIVE), { recursive: true });
    const q = await loadProject(dir);
    const ds = q.diagnostics.filter((d) => d.validator === VALIDATOR).map((d) => `${d.code}: ${d.message}`);
    expect(ds).toContain(`FW_NATIVE_STALE: ${NATIVE}/${BOARD_DIR}/watch_core.dts does not match the board any more (the model changed since generate); run firmware:generate`);
    expect(ds).toContain("FW_PIN_DRIFT: the native files use pin_4 (P1.11), which no net of the board gives a firmware function");
    expect(ds).toContain("FW_PIN_DRIFT: the board wires pin_5 (P1.12) for button sw1, but the native files do not configure it");
    expect(q.diagnostics.find((d) => d.code === "FW_NATIVE_STALE")?.severity).toBe("error");
    // export refuses the old files: their cites still name facts the board has, but the settings no longer match it
    const exp = await runCapabilityOperation(q, "firmware", "export", BOARD, {}, { record: false });
    expect(exp.status).toBe("failed");
    expect(exp.summary).toContain(`${BOARD_DIR}/watch_core.dts does not match the board any more (the model changed since generate)`);
    expect(exp.summary).toContain("run firmware:generate");
    expect(existsSync(join(dir, OUT, "firmware.manifest.json"))).toBe(false);
  });

  it("native files generated under the provider's former package name are current, and export ships them (PB-941)", async () => {
    // the fixture's files as stack 0.1.0 wrote them: the same settings, the header naming the package under its old npm scope
    const dir = makeProject(join(TMP, "former-scope"));
    cpSync(join(root, NATIVE), join(dir, NATIVE), { recursive: true });
    const indexFile = join(dir, NATIVE, "protoboard.lines.json");
    const index = JSON.parse(readFileSync(indexFile, "utf8")) as { provider: string; files: { path: string; digest: string }[] };
    const former = (t: string) => t.replaceAll(`${PACKAGE_SCOPE}/`, `${FORMER_PACKAGE_SCOPE}/`);
    let renamed = 0;
    for (const f of index.files) {
      const now = readFileSync(join(dir, NATIVE, f.path), "utf8");
      const then = former(now);
      if (then !== now) renamed++;
      writeFileSync(join(dir, NATIVE, f.path), then);
      f.digest = sha256(then);
    }
    expect(renamed).toBeGreaterThan(0);
    index.provider = former(index.provider);
    writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
    const q = await loadProject(dir);
    expect(q.diagnostics.filter((d) => d.code === "FW_NATIVE_STALE" || d.code === "FW_NATIVE_EDITED")).toEqual([]);
    const exp = await runCapabilityOperation(q, "firmware", "export", BOARD, {}, { record: false });
    expect(exp.status, exp.summary).toBe("succeeded");
  });
});

describe("buttons", () => {
  it("get the digit keys, then the letter keys; beyond 36 no code, with a warning", async () => {
    expect([0, 9, 10, 35, 36].map(buttonCode)).toEqual(["INPUT_KEY_0", "INPUT_KEY_9", "INPUT_KEY_A", "INPUT_KEY_Z", undefined]);
    // 36 more buttons on the side button's net (the module has too few free GPIOs; FW_PIN_REUSED is reported too)
    const ids = Array.from({ length: 36 }, (_, i) => `sw${i + 2}`);
    const dir = makeProject(join(TMP, "buttons"), (rel, t) =>
      rel.endsWith(".uhd.ts")
        ? t
            .replace('{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },', `{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },\n    ${ids.map((id) => `{ id: "${id}", moduleDefId: "alps-skrtlae010" },`).join("\n    ")}`)
            .replace('netLinks("btn", ["u1:pin_4", "sw1:pin_2"])', `netLinks("btn", ["u1:pin_4", "sw1:pin_2", ${ids.map((id) => `"${id}:pin_2"`).join(", ")}])`)
        : t,
    );
    const q = await loadProject(dir);
    const d = q.diagnostics.find((x) => x.validator === VALIDATOR && x.code === "FW_BUTTON_CODES");
    expect(d?.severity).toBe("warning");
    expect(d?.message).toBe("37 buttons: this provider gives them INPUT_KEY_0..9 and INPUT_KEY_A..Z (36); sw37 gets no zephyr,code: set it in the application overlay");
  });
});

describe("a display and a flash sharing one SPI bus", () => {
  // the flash's CLK and DI on the display's SCK/MOSI nets; its DO and /CS on P0.24 and P0.25
  const shared = (rel: string, t: string) =>
    rel.endsWith(".uhd.ts")
      ? t
          .replace('{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },', '{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },\n    { id: "u6", moduleDefId: "fx-spi-flash", name: "Flash" },')
          .replace('netLinks("lcd_sck", ["u1:pin_42", "d1:pin_9"])', 'netLinks("lcd_sck", ["u1:pin_42", "d1:pin_9", "u6:pin_6"])')
          .replace('netLinks("lcd_mosi", ["u1:pin_43", "d1:pin_10"])', 'netLinks("lcd_mosi", ["u1:pin_43", "d1:pin_10", "u6:pin_5"]),\n    ...netLinks("flash_miso", ["u1:pin_48", "u6:pin_2"]),\n    ...netLinks("flash_cs", ["u1:pin_49", "u6:pin_1"])')
          .replace('...netLinks("v3v3", ["u1:pin_28",', '...netLinks("v3v3", ["u6:pin_8", "u1:pin_28",')
          .replace('"sw1:pin_1", "sw1:pin_3",', '"sw1:pin_1", "sw1:pin_3", "u6:pin_4",')
          .replace('Net({ id: "lcd_dc", name: "LCD_DC" }),', 'Net({ id: "lcd_dc", name: "LCD_DC" }),\n    Net({ id: "flash_miso", name: "FLASH_MISO" }),\n    Net({ id: "flash_cs", name: "FLASH_CS" }),')
      : t;

  it("is one bus with MISO; generate succeeds and each device's reg is its index in cs-gpios", async () => {
    const dir = makeProject(join(TMP, "shared-spi"), shared);
    const q = await loadProject(dir);
    expect(q.diagnostics.filter((d) => d.validator === VALIDATOR && d.severity === "error").map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    const gen = await runCapabilityOperation(q, "firmware", "generate", BOARD, {}, { record: false });
    expect(gen.status, gen.summary).toBe("succeeded");
    const dts = readFileSync(join(dir, NATIVE, BOARD_DIR, "watch_core.dts"), "utf8");
    const pinctrl = readFileSync(join(dir, NATIVE, BOARD_DIR, "watch_core-pinctrl.dtsi"), "utf8");
    expect(checkDts({ "watch_core.dts": dts, "watch_core-pinctrl.dtsi": pinctrl }, NRF52840.labels)).toEqual([]);
    // one SPI instance, with SCK and MOSI once and the flash's MISO added
    expect(dts.match(/&spi\d \{/g)).toEqual(["&spi3 {"]);
    expect(pinctrl).toContain("NRF_PSEL(SPIM_MISO, 0, 24)");
    expect(pinctrl.match(/NRF_PSEL\(SPIM_SCK, 0, 19\)/g)?.length).toBe(2); // default and sleep
    expect(dts).toMatch(/cs-gpios = <&gpio0 20 GPIO_ACTIVE_LOW>, <&gpio0 25 GPIO_ACTIVE_LOW>;/);
    expect(dts).toMatch(/gc9x01x@0 \{[\s\S]*?reg = <0>;/);
    expect(dts).toMatch(/\tu6: memory-flash@1 \{\n\t\treg = <1>;/);
    // write-only is the panel's own property: it stays although the bus now has MISO
    expect(dts).toContain("write-only; /* the panel has no MISO: it is written, never read */");
  });
});

/** Seeded faults: one change each to the fixture's board or config, and the finding it must produce. */
const FAULTS: { name: string; edit: (rel: string, text: string) => string; code: string; message: RegExp }[] = [
  {
    name: "SDA on a low-frequency pad",
    edit: (rel, t) => (rel.endsWith(".uhd.ts") ? t.replace('netLinks("i2c_sda", ["u1:pin_37"', 'netLinks("i2c_sda", ["u1:pin_5"') : t),
    code: "FW_BUS_PROTOCOL",
    message: /i2c0 SDA is on u1:pin_5 \(P1\.12\), which raytac-mdbt50q-1mv2 does not list for i2c_sda \(a low-frequency pad\)/,
  },
  {
    name: "a button on the heart-rate sensor's interrupt line",
    edit: (rel, t) => (rel.endsWith(".uhd.ts") ? t.replace('...netLinks("btn", ["u1:pin_4", "sw1:pin_2"]),', "").replace('netLinks("hr_int", ["u1:pin_39", "u2:pin_13"])', 'netLinks("hr_int", ["u1:pin_39", "u2:pin_13", "sw1:pin_2"])') : t),
    code: "FW_PIN_REUSED",
    message: /u1:pin_39 \(P0\.15\) is assigned 2 times/,
  },
  {
    name: "the haptic driver's SCL left unconnected",
    edit: (rel, t) => (rel.endsWith(".uhd.ts") ? t.replace('"u3:pin_7", "u5:pin_2", "r2:pin_2"', '"u3:pin_7", "r2:pin_2"') : t),
    code: "FW_BUS_INCOMPLETE",
    message: /u5 \(ti-drv2605ldgs\) i2c: scl not wired to u1/,
  },
  {
    name: "the haptic driver's SDA and SCL swapped",
    edit: (rel, t) => (rel.endsWith(".uhd.ts") ? t.replace('"u3:pin_8", "u5:pin_3", "r1:pin_2"', '"u3:pin_8", "u5:pin_2", "r1:pin_2"').replace('"u3:pin_7", "u5:pin_2", "r2:pin_2"', '"u3:pin_7", "u5:pin_3", "r2:pin_2"') : t),
    code: "FW_BUS_CROSSED",
    message: /devices disagree about this line/,
  },
  {
    name: "two fuel gauges at 0x36 on one bus",
    edit: (rel, t) =>
      rel.endsWith(".uhd.ts")
        ? t.replace('{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },', '{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },\n    { id: "u6", moduleDefId: "adi-max17048g-t10", name: "Second gauge" },').replace('"u5:pin_3", "r1:pin_2"', '"u5:pin_3", "u6:pin_8", "r1:pin_2"').replace('"u5:pin_2", "r2:pin_2"', '"u5:pin_2", "u6:pin_7", "r2:pin_2"')
        : t,
    code: "FW_I2C_ADDRESS_CONFLICT",
    message: /i2c0: u3 \(adi-max17048g-t10\) and u6 \(adi-max17048g-t10\) share address 0x36/,
  },
  {
    name: "a wake source that is not an input",
    edit: (rel, t) => (rel.endsWith("firmware.config.ts") ? t.replace('wake: ["sw1", "u3"]', 'wake: ["sw1", "d1"]') : t),
    code: "FW_WAKE_UNKNOWN",
    message: /wake source d1 is no button, interrupt or status input/,
  },
  {
    name: "the drv2605 binding's required actuator-mode missing",
    edit: (rel, t) => (rel.endsWith("firmware.config.ts") ? t.replace('properties: { u5: { "actuator-mode": "LRA" } },', "") : t),
    code: "FW_PROPERTY_MISSING",
    message: /ti,drv2605 requires actuator-mode/,
  },
  {
    name: "an I2C sensor whose part states no address (a devicetree node needs reg)",
    edit: (rel, t) =>
      rel.endsWith(".uhd.ts")
        ? t.replace('{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },', '{ id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },\n    { id: "u6", moduleDefId: "fx-i2c-ambient", name: "Light sensor" },').replace('"u5:pin_3", "r1:pin_2"', '"u5:pin_3", "u6:pin_3", "r1:pin_2"').replace('"u5:pin_2", "r2:pin_2"', '"u5:pin_2", "u6:pin_4", "r2:pin_2"')
        : t,
    code: "FW_I2C_ADDRESS_UNKNOWN",
    message: /u6 \(fx-i2c-ambient\) states no i2c_address on i2c; its node cannot be addressed; this framework needs it/,
  },
  {
    name: "an I2C clock the TWIM cannot run",
    edit: (rel, t) => (rel.endsWith("firmware.config.ts") ? t.replace('board_name: "watch_core",', 'board_name: "watch_core",\n    i2c_frequency_hz: 1000000,') : t),
    code: "FW_BUS_SPEED",
    message: /faster than u2 \(adi-max30102efd\) allows \(400000 Hz\)/,
  },
];

describe("seeded faults", () => {
  for (const f of FAULTS) {
    it(`catches ${f.name} (${f.code}) in check, and generate refuses`, async () => {
      const dir = makeProject(join(TMP, `fault-${f.code}`), f.edit);
      const q = await loadProject(dir);
      const found = q.diagnostics.filter((d) => d.validator === VALIDATOR && d.code === f.code);
      expect(found.map((d) => d.message), JSON.stringify(q.diagnostics.filter((d) => d.validator === VALIDATOR).map((d) => d.code))).toEqual(expect.arrayContaining([expect.stringMatching(f.message)]));
      expect(found[0].severity).toBe("error");
      expect(found[0].source?.file).toMatch(/src\/boards\/mainboard\/(mainboard\.uhd|firmware\.config)\.ts/);
      const gen = await runCapabilityOperation(q, "firmware", "generate", BOARD, {}, { record: false });
      expect(gen.status).toBe("failed");
      expect(existsSync(join(dir, NATIVE))).toBe(false);
    });
  }
});
