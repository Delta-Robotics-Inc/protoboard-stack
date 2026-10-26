/**
 * Which Zephyr driver serves a part: the provider's own table, keyed by part
 * id (tool-integrations.md §4: mapping data from part facts to a tool lives
 * with the provider, never in the part). Every entry was checked against the
 * binding in Zephyr v4.2.0 (`binding` names the file); `kconfig` is the
 * subsystem the driver lives under (the driver itself defaults to y when its
 * compatible is enabled in the devicetree).
 *
 * A part with no entry still gets a devicetree node on its bus, with its
 * address and no compatible: the application finds it by label and drives it
 * itself. The generator says so in a warning.
 */
import type { FirmwareGpioUse } from "@protoboardai/core";

export interface ZephyrDriver {
  compatible: string;
  /** Generic node name (devicetree spec §2.2.2). */
  node: string;
  /** The binding file in Zephyr v4.2.0. */
  binding: string;
  /** Subsystem Kconfig symbols to enable (without CONFIG_). */
  kconfig: string[];
  /** Device controls the binding takes as `*-gpios` properties. Others go to `zephyr,user`. */
  controls?: Partial<Record<FirmwareGpioUse, string>>;
  /** Properties the binding requires that the model cannot state: they come from the config's `properties`. */
  required?: string[];
  /** Fixed properties with the part fact (a `traits.performance` key) they come from. */
  fromPart?: { property: string; fact: string; format: "int" | "string" }[];
  /** Child nodes the binding needs that the generator does not write. */
  childrenNote?: string;
}

export const DRIVERS: Record<string, ZephyrDriver> = {
  "adi-max17048g-t10": {
    compatible: "maxim,max17048",
    node: "fuel-gauge",
    binding: "dts/bindings/fuel-gauge/maxim,max17048.yaml",
    kconfig: ["FUEL_GAUGE"],
  },
  "ti-drv2605ldgs": {
    compatible: "ti,drv2605",
    node: "haptics",
    binding: "dts/bindings/haptics/ti,drv2605.yaml",
    kconfig: ["HAPTICS"],
    controls: { enable: "en-gpios", trigger: "in-trig-gpios" },
    required: ["actuator-mode"],
  },
  "ti-lp5024rsm": {
    compatible: "ti,lp5024",
    node: "led-controller",
    binding: "dts/bindings/led/ti,lp5024.yaml",
    kconfig: ["LED"],
    controls: { enable: "enable-gpios" },
    childrenNote: "add one child node per LED module (label, index, color-mapping): the model does not say which colour each output drives",
  },
  "eastrising-er-tft128-1": {
    compatible: "galaxycore,gc9x01x",
    node: "gc9x01x",
    binding: "dts/bindings/display/galaxycore,gc9x01x.yaml (on zephyr,mipi-dbi-spi)",
    kconfig: ["DISPLAY"],
    controls: { dc: "dc-gpios", reset: "reset-gpios" },
  },
  "adafruit-381-ds18b20-probe": {
    compatible: "maxim,ds18b20",
    node: "ds18b20",
    binding: "dts/bindings/sensor/maxim,ds18b20.yaml (on zephyr,w1-gpio)",
    kconfig: ["W1", "SENSOR"],
    fromPart: [{ property: "resolution", fact: "default_resolution_bits", format: "int" }],
  },
};
