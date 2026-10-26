/**
 * Category hints (PB-864): a part is filed under every taxonomy category that
 * fits, not only the one that names what it is (UHD docs/taxonomy.md). This
 * suggests categories a part's own data points at and that it does not list,
 * so verify-part can warn. It is a heuristic over the part's tags, its
 * interfaces and the categories it already has; each hint says why.
 *
 * A hint is covered when the part lists the path or a path below it. Generic
 * passives (resistors, capacitors, inductors, crystals, ferrite beads) get no
 * hints from their tags, because their tags often name where they are used
 * ("esc", "fpv") rather than what they are.
 *
 * A pass-through part (one whose own links join its interfaces: a cable, an
 * adapter, a dock, a socket breakout) carries other parts' signals, so what
 * those signals are (motor phases, encoder lines, a display bus) does not say
 * what the part is: hints for what a part is (sensor, actuator, display,
 * storage) are not drawn from its tags or interfaces. Memory tags on a sensor
 * or a microcontroller board name a feature of it, not a memory chip, and an
 * SSD tag on a PCIe carrier names what it takes, not what it is.
 *
 * Kit membership comes from the library's kit manifests (library/kits), when
 * the caller passes them: a part a manifest lists should be filed under the
 * kit, and a part filed under a kit with a manifest should be in it.
 */
import type { ModuleDef, Taxonomy } from "@deltarobotics/uhd";
import { UHD_TAXONOMY } from "@deltarobotics/uhd";

export interface CategoryHint {
  /** The suggested taxonomy path. */
  path: string;
  /** Why: the tag, interface or category that points at it. */
  reason: string;
}

/** Kit memberships from a library's kit manifests: kit path → the part ids its manifest lists. */
export type KitMembers = ReadonlyMap<string, ReadonlySet<string>>;

export interface CategoryHintOptions {
  /** The library's kit manifests; without them kit membership is not checked. */
  kits?: KitMembers;
}

/** Exact tags (lower case) that point at a category. */
const TAG_HINTS: [path: string, tags: string[]][] = [
  ["expansion.breakout", ["breakout", "breakout-board"]],
  ["expansion.arduino_shield", ["arduino-shield"]],
  ["expansion.pi_hat", ["pi-hat", "raspberry-pi-hat"]],
  ["robotics.frc", ["frc"]],
  ["robotics.ftc", ["ftc"]],
  ["robotics.drone", ["fpv", "drone", "quadcopter", "multirotor"]],
  ["robotics.rc", ["rc-servo", "esc", "rc-receiver"]],
  ["sensor.motion", ["imu", "accelerometer", "gyroscope", "gyro"]],
  ["sensor.magnetic", ["magnetometer", "compass", "hall-sensor"]],
  ["sensor.gnss", ["gnss", "gps"]],
  ["sensor.encoder", ["encoder", "quadrature", "absolute-encoder", "magnetic-encoder"]],
  ["sensor.distance", ["tof", "time-of-flight", "ultrasonic", "lidar"]],
  ["sensor.environmental", ["humidity", "barometer", "air-quality"]],
  ["component.display", ["oled", "lcd", "tft", "display"]],
  ["connectivity.wireless", ["wifi", "bluetooth", "ble", "bluetooth-le", "lora", "zigbee"]],
  ["actuator.motor_controller", ["motor-driver", "motor-controller", "h-bridge", "stepper-driver", "esc"]],
  ["actuator.servo_controller", ["servo-driver", "servo-controller"]],
  ["actuator.haptic", ["haptic"]],
  ["power.monitor", ["fuel-gauge", "current-sensor", "power-monitor"]],
  ["power.charger", ["charger", "battery-charger"]],
  ["power.regulator", ["ldo", "regulator", "buck", "boost", "buck-boost", "dc-dc"]],
  ["component.discrete.transistor", ["mosfet", "transistor", "bjt"]],
  // UHD taxonomy 1.2.0 (PB-866); dropped while the installed taxonomy lacks them
  ["component.storage.memory", ["eeprom", "fram", "nor-flash", "nand-flash", "psram", "sram"]],
  ["component.storage.ssd", ["ssd", "nvme-ssd"]],
  ["mechanical.fastener.standoff", ["standoff"]],
  // forms: a bare chip, a development board
  ["component.ic", ["ic", "bare-ic"]],
  ["microcontroller.development_board", ["dev-board", "devkit", "development-board"]],
];

/** Tag hints a category makes moot: a microcontroller chip is not also component.ic. */
const TAG_HINT_EXCEPTIONS: [path: string, unless: string[]][] = [
  ["component.ic", ["microcontroller.chip", "microcontroller.module"]],
  ["microcontroller.development_board", ["microcontroller.single_board_computer", "microcontroller.flight_controller"]],
  // a sensor's user EEPROM or a dev board's PSRAM is a feature, not a memory chip; a PCIe carrier takes SSDs
  ["component.storage.memory", ["sensor", "microcontroller"]],
  ["component.storage.ssd", ["expansion.pcie"]],
];

/** What-it-is categories that a pass-through part's tags and interfaces do not point at. */
const PASS_THROUGH_MOOT = ["sensor", "actuator", "component.display", "component.storage"];

/** Drone parts in these categories are RC hobby stock, so they also fit robotics.rc. */
const RC_STOCK = ["actuator.motor", "actuator.motor_controller", "power.battery"];

/** Interface protocols (with the role that matters) that point at a category. */
const INTERFACE_HINTS: [path: string, protocol: string, roles: string[]][] = [
  ["sensor.encoder", "quadrature_encoder", ["output"]],
  ["actuator.motor_controller", "dc_motor", ["output"]],
  ["actuator.motor_controller", "bldc_3phase", ["output"]],
  ["actuator.motor_controller", "bipolar_stepper_phases", ["output", "driver"]],
  ["actuator.motor_controller", "unipolar_stepper_phases", ["output"]],
  ["actuator.motor.stepper", "bipolar_stepper_phases", ["input", "motor"]],
  ["actuator.motor.brushless", "bldc_3phase", ["input"]],
  ["connectivity.wireless", "wifi", ["*"]],
  ["connectivity.wireless", "bluetooth", ["*"]],
  // PB-866
  ["component.led", "led_drive", ["anode", "cathode"]],
  ["component.ic.led_driver", "led_drive", ["sink", "source"]],
  // PB-866 mechanical round
  ["mechanical.motion", "gear_mesh", ["*"]],
  ["mechanical.motion", "bearing_fit", ["bearing"]],
  ["mechanical.motion", "rolling_contact", ["wheel"]],
];

/** Capabilities on leaves that point at a category. */
const CAPABILITY_HINTS: [path: string, capability: string][] = [
  ["sensor.encoder", "quadrature_a"],
  ["component.relay", "relay_coil_plus"],
];

/** Categories that never take tag hints (generic parts whose tags say where they are used). */
const GENERIC = ["component.passive", "mechanical.fastener"];

const covered = (cats: readonly string[], path: string) => cats.some((c) => c === path || c.startsWith(path + "."));
const under = (cat: string, root: string) => cat === root || cat.startsWith(root + ".");

/**
 * Categories the part's data points at and that it does not list, each with
 * its reason, in taxonomy order. Paths the taxonomy does not have are dropped.
 */
export function categoryHints(def: ModuleDef, taxonomy: Taxonomy = UHD_TAXONOMY, options: CategoryHintOptions = {}): CategoryHint[] {
  const cats = def.categories ?? [];
  const hints = new Map<string, string>();
  const passThrough = (def.links?.length ?? 0) > 0;
  const add = (path: string, reason: string) => {
    if (passThrough && PASS_THROUGH_MOOT.some((m) => under(path, m))) return;
    if (!covered(cats, path) && taxonomy.has(path) && !hints.has(path)) hints.set(path, reason);
  };

  const generic = cats.length > 0 && cats.every((c) => GENERIC.some((g) => under(c, g)));
  if (!generic) {
    const tags = new Set((def.tags ?? []).map((t) => t.toLowerCase()));
    for (const [path, words] of TAG_HINTS) {
      const hit = words.find((w) => tags.has(w));
      const moot = TAG_HINT_EXCEPTIONS.find(([p]) => p === path)?.[1].some((u) => covered(cats, u));
      if (hit && !moot) add(path, `tag "${hit}"`);
    }
  }

  // FPV and RC drones are built from RC hobby stock
  if (covered(cats, "robotics.drone")) {
    const stock = cats.find((c) => RC_STOCK.some((r) => under(c, r)));
    if (stock) add("robotics.rc", `a drone part in ${stock} is RC hobby stock`);
  }

  // Kits: the manifests say which parts a kit ships
  for (const [kit, ids] of options.kits ?? []) {
    if (ids.has(def.id)) add(kit, `the ${kit} manifest lists it`);
    else if (cats.includes(kit)) hints.set(`!${kit}`, `filed under ${kit}, but the kit's manifest (library/kits) does not list it: add it to the manifest or drop the category`);
  }

  for (const iface of def.interfaces) {
    for (const [path, protocol, roles] of INTERFACE_HINTS) {
      const p = iface.protocols?.find((x) => x.type === protocol);
      if (p && (roles.includes("*") || p.roles.some((r) => roles.includes(r)))) add(path, `interface ${iface.id} (${protocol}: ${p.roles.join("/")})`);
    }
    for (const [path, capability] of CAPABILITY_HINTS) {
      const out = iface.protocols?.some((p) => p.roles.includes("output"));
      if (out && iface.capabilities?.includes(capability)) add(path, `interface ${iface.id} outputs ${capability}`);
    }
  }

  // A board form (breakout, shield, HAT) is how a part comes, not what it does:
  // it should also be filed under what it carries.
  const forms = cats.filter((c) => under(c, "expansion"));
  const functional = cats.filter((c) => !under(c, "expansion") && !under(c, "robotics") && !under(c, "kit"));
  if (forms.length && !functional.length && hints.size === 0) {
    hints.set("", `filed only under ${forms.join(", ")}: also list the category of what the board carries (a sensor breakout is also sensor.<kind>)`);
  }

  const order = new Map(taxonomy.nodes().map((n, i) => [n.path, i]));
  return [...hints].map(([path, reason]) => ({ path: path.startsWith("!") ? "" : path, reason })).sort((a, b) => (order.get(a.path) ?? -1) - (order.get(b.path) ?? -1));
}

/** Warning messages for verify-part: one per hint, saying when the part has a single category. */
export function categoryHintMessages(def: ModuleDef, taxonomy?: Taxonomy, options?: CategoryHintOptions): string[] {
  const cats = def.categories ?? [];
  const single = cats.length === 1 ? `filed under one category (${cats[0]}); ` : "";
  return categoryHints(def, taxonomy, options).map((h) => (h.path ? `${single}also fits ${h.path} (${h.reason}); list every category that fits` : h.reason));
}
