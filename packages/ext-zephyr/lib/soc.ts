/**
 * nRF52840 facts the Zephyr provider needs, checked against Zephyr v4.2.0
 * (dts/arm/nordic/nrf52840.dtsi, boards/nordic/nrf52840dongle,
 * drivers/clock_control/Kconfig.nrf). This is the provider's own table,
 * like a PCB tool's land patterns: it is never written into a part.
 *
 * A part is matched to an SoC entry by its stated SoC fact
 * (`domains[electrical].metadata.soc`), which is a UHD fact about the part.
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";

export const ZEPHYR_VERSION = "4.2.0";

export interface ZephyrSoc {
  /** board.yml `socs[].name`. */
  name: string;
  /** Kconfig symbol the board selects (the package variant). */
  kconfig: string;
  /** SoC devicetree include. */
  dtsi: string;
  /** How the part states it: matched against its SoC fact. */
  match: RegExp;
  /** Package the Kconfig symbol stands for, matched against the same fact. */
  packageMatch: RegExp;
  /** Bus instances in the order the provider uses them. */
  i2c: string[];
  spi: string[];
  uart: string[];
  /** Instances that share one peripheral id and cannot both be enabled. */
  sharesId: Record<string, string>;
  /** Highest SPI clock per instance (Hz). */
  spiMaxHz: Record<string, number>;
  /** Labels the SoC devicetree defines (for the structural check of the generated files). */
  labels: string[];
}

export const NRF52840: ZephyrSoc = {
  name: "nrf52840",
  kconfig: "SOC_NRF52840_QIAA",
  dtsi: "nordic/nrf52840_qiaa.dtsi",
  match: /nRF52840/i,
  packageMatch: /aQFN-?73/i,
  // TWIM0/SPIM0 and TWIM1/SPIM1 share peripheral ids (nrf52840.dtsi: i2c0 and spi0 both at 0x40003000)
  i2c: ["i2c0", "i2c1"],
  spi: ["spi3", "spi2", "spi1", "spi0"],
  uart: ["uart0", "uart1"],
  sharesId: { i2c0: "spi0", spi0: "i2c0", i2c1: "spi1", spi1: "i2c1" },
  // SPIM3 runs at 32 MHz, SPIM0-2 at 8 MHz (nRF52840 PS §6.25)
  spiMaxHz: { spi3: 32_000_000, spi2: 8_000_000, spi1: 8_000_000, spi0: 8_000_000 },
  labels: [
    "acl", "adc", "bt_hci_controller", "ccm", "clock", "comp", "cpu0", "cryptocell", "ecb", "egu0", "egu1", "egu2", "egu3", "egu4", "egu5",
    "ficr", "flash0", "flash_controller", "gpio0", "gpio1", "gpiote", "gpiote0", "gpregret1", "gpregret2", "hfxo", "i2c0", "i2c1", "i2s0",
    "ieee802154", "itm", "mwu", "nfct", "nvic", "pdm0", "pinctrl", "power", "ppi", "pwm0", "pwm1", "pwm2", "pwm3", "qdec", "qspi", "radio",
    "reg0", "reg1", "rng", "rtc0", "rtc1", "rtc2", "spi0", "spi1", "spi2", "spi3", "sram0", "systick", "temp", "timer0", "timer1", "timer2",
    "timer3", "timer4", "uart0", "uart1", "uicr", "usbd", "wdt", "wdt0",
  ],
};

const SOCS = [NRF52840];

/** The part's stated SoC fact, if it has one. */
export function socFact(def: ModuleDef): string | undefined {
  for (const d of def.domains ?? []) {
    const soc = (d as { metadata?: Record<string, unknown> }).metadata?.soc;
    if (typeof soc === "string") return soc;
  }
  return undefined;
}

export function socOf(def: ModuleDef): ZephyrSoc | undefined {
  const fact = socFact(def);
  return fact ? SOCS.find((s) => s.match.test(fact)) : undefined;
}

/** "P0.13" or "P0.00/XL1" → port 0, pin 13. */
export function portPin(leaf: InterfaceDef | undefined): { port: number; pin: number } | undefined {
  const m = /^P(\d)\.(\d{1,2})\b/.exec(leaf?.name ?? "");
  return m ? { port: Number(m[1]), pin: Number(m[2]) } : undefined;
}

export const pinLabel = (pp: { port: number; pin: number }) => `P${pp.port}.${String(pp.pin).padStart(2, "0")}`;

/** The controller leaf named P<port>.<pin>, if the module has it. */
export function leafAt(def: ModuleDef, port: number, pin: number): InterfaceDef | undefined {
  return def.interfaces.find((i) => {
    const pp = portPin(i);
    return pp?.port === port && pp.pin === pin;
  });
}
