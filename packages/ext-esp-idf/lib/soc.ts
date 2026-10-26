/**
 * ESP32-C3 facts the ESP-IDF provider needs, checked against ESP-IDF v5.3.5
 * (components/esp_system/Kconfig ESP_CONSOLE_*, components/esp_hw_support/
 * port/esp32c3/Kconfig.rtc RTC_CLK_SRC_*, components/esptool_py/
 * Kconfig.projbuild ESPTOOLPY_FLASHSIZE_*). The provider's own table: a part
 * is matched by its stated SoC fact (`domains[electrical].metadata.soc`).
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";

export const IDF_VERSION = "5.3.5";

export interface IdfSoc {
  /** CONFIG_IDF_TARGET. */
  target: string;
  match: RegExp;
  /** Controller numbers per peripheral. */
  i2c: number[];
  spi: number[];
  uart: number[];
  /** SPI2 master clock limit (Hz). */
  spiMaxHz: number;
  /** ESPTOOLPY_FLASHSIZE_<n>MB choices. */
  flashSizes: number[];
}

// One I2C controller, SPI2 as the only general-purpose SPI host, UART0 and UART1
// (the module's peripheral list: "2 x UART", "SPI2 (master 80 MHz …)", "I2C").
export const ESP32C3: IdfSoc = {
  target: "esp32c3",
  match: /ESP32-C3/i,
  i2c: [0],
  spi: [2],
  uart: [1, 0],
  spiMaxHz: 80_000_000,
  flashSizes: [1, 2, 4, 8, 16, 32, 64, 128],
};

const SOCS = [ESP32C3];

export function socFact(def: ModuleDef): string | undefined {
  for (const d of def.domains ?? []) {
    const soc = (d as { metadata?: Record<string, unknown> }).metadata?.soc;
    if (typeof soc === "string") return soc;
  }
  return undefined;
}

export function socOf(def: ModuleDef): IdfSoc | undefined {
  const fact = socFact(def);
  return fact ? SOCS.find((s) => s.match.test(fact)) : undefined;
}

/** The GPIO number a module pin carries (its `gpio<n>` capability). */
export function gpioNumber(leaf: InterfaceDef | undefined): number | undefined {
  const c = (leaf?.capabilities ?? []).find((x) => /^gpio\d+$/.test(x));
  return c ? Number(c.slice(4)) : undefined;
}

export function leafForGpio(def: ModuleDef, n: number): InterfaceDef | undefined {
  return def.interfaces.find((i) => gpioNumber(i) === n);
}
