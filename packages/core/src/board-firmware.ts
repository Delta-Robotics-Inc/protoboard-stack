/**
 * Board firmware map (tool-integrations.md §2, PB-847): the first step of
 * every `firmware` provider, shared so that a Zephyr and an ESP-IDF provider
 * read a board the same way.
 *
 * A UHD board module (components as children, nets as links) is read into
 * what a firmware configuration needs and nothing else:
 *
 *   controller  the one microcontroller (module) on the board
 *   buses       I2C, SPI, UART and 1-Wire: which controller pin carries each
 *               signal, and the devices on the bus with their addresses
 *   gpios       buttons, interrupts, resets, enables, chip selects, status
 *               lines: each a controller pin, its direction and polarity;
 *               also a line reached through a series resistor (a divider
 *               bringing a 5 V status output, or a supply to sense, down to
 *               the controller's level)
 *   crystals    a low-frequency crystal on the controller's crystal pins
 *   usb         the controller's USB data pins wired to something
 *
 * Every item carries the UHD facts it comes from as cites (`net:`, `pin:`,
 * `part:`, `link:`, `constraint:`; see `FirmwareCite`), which the provider
 * copies onto the configuration lines it writes. Nothing here knows a
 * firmware framework: no devicetree, no Kconfig, no GPIO numbering. Each
 * provider maps controller pins to its SoC's names with its own tables.
 *
 * `checkBoardFirmware` holds the rules every provider applies: pins exist
 * and are used once, buses match the controller pin's capabilities, I2C
 * addresses are unique per bus, strapping pins are not driven by
 * peripherals, wake sources are valid.
 */
import { isConnector, leafPins, slotBindings, type InterfaceDef, type ModuleDef, type ModuleLookup, type Parameter } from "@deltarobotics/uhd";
import { boardNetlist, type BoardComponent, type BoardNetDef, type BoardNetlist, type BoardOptions } from "./board-netlist.js";
import type { FirmwareCite } from "./outputs.js";
import type { Severity } from "./types.js";

export const BOARD_FIRMWARE_SCHEMA = "protoboard.board-firmware/v0";

export type BusProtocol = "i2c" | "spi" | "uart" | "onewire";

/** A controller pin carrying one bus signal. `role` is the controller's view: sda, scl, sck, mosi, miso, tx, rx, rts, cts, dq. */
export interface FirmwareSignal {
  role: string;
  /** Controller leaf interface id, e.g. `pin_37`. */
  pin: string;
  /** Board net the signal runs on. */
  net: string;
  cites: FirmwareCite[];
}

export interface FirmwareDevice {
  /** Instance path on the board, e.g. `u3`. */
  instance: string;
  part: string;
  /** Instance name, else the part's name. */
  name: string;
  categories: string[];
  tags: string[];
  /** The device's bus interface (`i2c`, `spi`, `uart`), or its 1-Wire data pin. */
  interface: string;
  /** I2C 7-bit address from the part (`i2c_address`). */
  address?: number;
  /** Highest bus clock the part states (`clock_freq`), Hz. */
  maxClockHz?: number;
  /** UART baud rate the part states (`baud_rate`). */
  baud?: number;
  /** SPI chip select: a controller GPIO, per device. */
  cs?: FirmwareGpio;
  /** Bus roles this device's interface wires (a write-only display on a shared SPI bus has no `miso`). */
  roles?: string[];
  /** GPIOs between the controller and this device (interrupt, reset, enable, D/C…). */
  controls: FirmwareGpio[];
  cites: FirmwareCite[];
}

export interface FirmwareBus {
  /** Stable id: `<protocol><n>` in order of first appearance, e.g. `i2c0`. */
  id: string;
  protocol: BusProtocol;
  signals: FirmwareSignal[];
  devices: FirmwareDevice[];
}

export type FirmwareGpioUse = "button" | "interrupt" | "reset" | "enable" | "shutdown" | "dc" | "cs" | "status" | "trigger" | "output" | "input" | "sense";

export interface FirmwareGpio {
  use: FirmwareGpioUse;
  /** Controller leaf interface id. */
  pin: string;
  net: string;
  /** Who is on the other end. */
  instance: string;
  part: string;
  /** The peripheral's pin, e.g. `pin_5` (ALRT). */
  peripheralPin?: string;
  /** A readable name: the button's or device's name plus the peripheral pin's name. */
  label: string;
  /** Controller drives it (reset, enable, dc, cs) or reads it (button, interrupt, status). */
  direction: "input" | "output";
  activeLow: boolean;
  /** Pull the controller should enable: none when the board has a resistor doing it. */
  pull?: "up" | "down";
  /** A resistor on the board pulling the net, when there is one. */
  externalPull?: { instance: string; to: "up" | "down"; net: string };
  cites: FirmwareCite[];
}

export interface FirmwareCrystal {
  instance: string;
  part: string;
  /** Controller pins the crystal sits on. */
  pins: string[];
  frequencyHz?: number;
  cites: FirmwareCite[];
}

export interface FirmwareUsb {
  /** Controller's USB composite id. */
  interface: string;
  pins: string[];
  /** Components on the data nets (connector, ESD). */
  peers: string[];
  cites: FirmwareCite[];
}

export interface FirmwareFinding {
  code: string;
  severity: Severity;
  message: string;
  /** Board instance the finding is about, when there is one. */
  instance?: string;
  cites?: FirmwareCite[];
}

export interface BoardFirmware {
  schema: typeof BOARD_FIRMWARE_SCHEMA;
  board: string;
  controller?: { instance: string; part: string; name: string };
  buses: FirmwareBus[];
  /** GPIOs that are not part of a device on a bus (buttons, charger status, a lone enable). Device controls are on the device. */
  gpios: FirmwareGpio[];
  crystals: FirmwareCrystal[];
  usb?: FirmwareUsb;
  /** Every controller pin in use, with what uses it (`i2c0.sda`, `gpio:button sw1`). */
  uses: Record<string, string[]>;
  /** What the reading found wrong or could not decide. */
  findings: FirmwareFinding[];
  netlist: BoardNetlist;
}

export interface BoardFirmwareOptions {
  /** Instance path of the controller, when the board has more than one microcontroller. */
  controller?: string;
  /** How the board's children are read (a child with its own circuit binding is a separate board). */
  board?: BoardOptions;
}

const hasProtocol = (i: InterfaceDef, type: string, role?: string) => i.protocols.some((p) => p.type === type && (!role || p.roles.includes(role)));
const caps = (i: InterfaceDef) => i.capabilities ?? [];
const param = (i: InterfaceDef | undefined, id: string): Parameter | undefined => i?.parameters?.find((p) => p.id === id);
const maxOf = (p?: Parameter) => (p?.range ? p.range[1] : p?.value);

/**
 * A controller pin that can be a GPIO: it can raise an interrupt or drive
 * PWM, or the part names it a GPIO. A fixed-function digital pin (a chip
 * enable, a USB data line) is not.
 */
export function isGpioPin(leaf: InterfaceDef | undefined): boolean {
  if (!leaf) return false;
  return leaf.protocols.some((p) => p.type === "interrupt" || p.type === "pwm") || caps(leaf).some((c) => /^(gpio\d+|interrupt|low_frequency_io)$/.test(c));
}

/** The controller capability each bus role needs on its pin (UHD vocabulary: i2c_sda, spi_sck, uart_tx…). */
export const ROLE_CAPABILITY: Record<string, string | undefined> = {
  sda: "i2c_sda",
  scl: "i2c_scl",
  sck: "spi_sck",
  mosi: "spi_mosi",
  miso: "spi_miso",
  cs: "spi_ss",
  tx: "uart_tx",
  rx: "uart_rx",
  rts: "uart_rts",
  cts: "uart_cts",
  dq: undefined,
};

/** UART slots are named from the device's side: its rx is the controller's tx. */
const CONTROLLER_ROLE: Record<BusProtocol, Record<string, string>> = {
  i2c: { sda: "sda", scl: "scl" },
  spi: { mosi: "mosi", miso: "miso", sck: "sck", ss: "cs" },
  uart: { rx: "tx", tx: "rx", rts: "cts", cts: "rts" },
  onewire: {},
};

const isController = (def: ModuleDef) => (def.categories ?? []).some((c) => c === "microcontroller" || c.startsWith("microcontroller."));

/** The cite for a net: its Net interface, or the link that declared it. */
function netCite(board: ModuleDef, net: BoardNetDef): FirmwareCite {
  return board.interfaces.some((i) => i.id === net.id) ? `net:${net.id}` : `link:${net.links[0] ?? net.id}`;
}

/**
 * Read a UHD board module into its firmware map. `lookup` resolves the parts
 * (the project's definition registry).
 */
export function boardFirmware(board: ModuleDef, lookup: ModuleLookup, options: BoardFirmwareOptions = {}): BoardFirmware {
  const netlist = boardNetlist(board, lookup, options.board);
  const findings: FirmwareFinding[] = netlist.problems.map((message) => ({ code: "FW_BOARD_UNREADABLE", severity: "warning", message }));
  const result: BoardFirmware = { schema: BOARD_FIRMWARE_SCHEMA, board: board.id, buses: [], gpios: [], crystals: [], uses: {}, findings, netlist };
  // every part on the board, sub-modules expanded (docs/specs/nested-boards.md), by instance path
  const parts = new Map<string, ModuleDef>();
  for (const c of netlist.components) {
    const d = lookup(c.part);
    if (d) parts.set(c.instance, d);
  }
  const component = new Map(netlist.components.map((c) => [c.instance, c]));

  // ---- the controller
  const candidates = options.controller ? [options.controller] : netlist.components.filter((c) => isController(parts.get(c.instance)!)).map((c) => c.instance);
  if (options.controller && !parts.has(options.controller)) {
    findings.push({ code: "FW_NO_CONTROLLER", severity: "error", message: `constraint controller names ${options.controller}, which is not a component of ${board.id}`, cites: ["constraint:controller"] });
    return result;
  }
  if (candidates.length !== 1) {
    findings.push(
      candidates.length
        ? { code: "FW_CONTROLLER_AMBIGUOUS", severity: "error", message: `${board.id} has ${candidates.length} microcontrollers (${candidates.join(", ")}); name the one this firmware runs on with constraints.controller` }
        : { code: "FW_NO_CONTROLLER", severity: "error", message: `${board.id} has no component in category "microcontroller"; firmware needs a controller (or name it with constraints.controller)` },
    );
    return result;
  }
  const ctl = candidates[0];
  const ctlDef = parts.get(ctl)!;
  result.controller = { instance: ctl, part: ctlDef.id, name: component.get(ctl)?.name ?? ctlDef.name };
  const ctlLeaf = (id: string) => ctlDef.interfaces.find((i) => i.id === id);

  // ---- nets: which net each pin is on, and the controller pins on each net
  const netOf = new Map<string, BoardNetDef>();
  for (const n of netlist.nets) for (const p of n.pins) netOf.set(p, n);
  const ctlPins = (net: BoardNetDef) => net.pins.filter((p) => p.startsWith(`${ctl}:`)).map((p) => p.slice(ctl.length + 1));
  const use = (pin: string, what: string) => {
    const list = (result.uses[pin] ??= []);
    if (!list.includes(what)) list.push(what);
  };
  const onePin = (net: BoardNetDef, what: string, instance: string): string | undefined => {
    const pins = ctlPins(net);
    if (pins.length > 1) findings.push({ code: "FW_PINS_SHORTED", severity: "warning", instance, message: `net ${net.id} joins controller pins ${pins.join(", ")}; ${what} uses ${pins[0]}`, cites: [netCite(board, net)] });
    return pins[0];
  };

  /** A resistor from the net to a supply or ground net: the board's own pull. */
  const externalPull = (net: BoardNetDef): FirmwareGpio["externalPull"] => {
    for (const p of net.pins) {
      const [inst, leaf] = p.split(":");
      const c = component.get(inst);
      if (c?.kind !== "resistor") continue;
      const other = c.pins.find((x) => x.interface !== leaf);
      const otherNet = other && netOf.get(`${inst}:${other.interface}`);
      if (otherNet?.kind === "power") return { instance: inst, to: "up", net: otherNet.id };
      if (otherNet?.kind === "ground") return { instance: inst, to: "down", net: otherNet.id };
    }
    return undefined;
  };

  const gpio = (g: Omit<FirmwareGpio, "pull" | "externalPull">, net: BoardNetDef, wantPull?: "up" | "down"): FirmwareGpio => {
    const ext = externalPull(net);
    return { ...g, ...(ext ? { externalPull: ext, cites: [...g.cites, `pin:${ext.instance}:${component.get(ext.instance)!.pins[0].interface}`] } : {}), ...(wantPull && !ext ? { pull: wantPull } : {}) };
  };

  /**
   * The bus a device's signals join: an existing bus of the protocol that
   * shares at least one line with them on the same role and disagrees on
   * none (same role on another pin, or another role on the same pin), else a
   * new one. A write-only SPI display and a full-duplex flash on the same
   * SCK/MOSI are one bus; the flash adds MISO to it.
   */
  const busFor = (protocol: BusProtocol, signals: FirmwareSignal[], shared: string[]): FirmwareBus => {
    const mine = signals.filter((s) => shared.includes(s.role));
    const joins = (b: FirmwareBus) =>
      b.protocol === protocol && mine.some((s) => b.signals.some((x) => x.role === s.role && x.pin === s.pin)) && mine.every((s) => b.signals.every((x) => (x.role === s.role) === (x.pin === s.pin)));
    let bus = result.buses.find(joins);
    if (!bus) {
      bus = { id: `${protocol}${result.buses.filter((b) => b.protocol === protocol).length}`, protocol, signals: [], devices: [] };
      result.buses.push(bus);
    }
    for (const s of mine) if (!bus.signals.some((x) => x.role === s.role)) bus.signals.push(s);
    return bus;
  };

  const claimed = new Set<string>(); // peripheral pins already read as part of a bus
  for (const c of netlist.components) {
    if (c.instance === ctl) continue;
    const def = parts.get(c.instance)!;
    const name = c.name;
    const base = { instance: c.instance, part: def.id, name, categories: def.categories ?? [], tags: def.tags ?? [] };

    // -- bus composites: I2C, SPI, UART
    for (const iface of def.interfaces) {
      if (!iface.slots?.length || isConnector(iface)) continue;
      const protocol = (["i2c", "spi", "uart"] as BusProtocol[]).find((p) => hasProtocol(iface, p));
      if (!protocol) continue;
      const bindings = slotBindings(iface);
      // a bus whose line is strapped to a supply or ground rail is not in use: the strap selects
      // another interface of the part (a BMI270's CSB tied to VDDIO selects I2C, so its SPI is off)
      const strapped = iface.slots.some((slot) => {
        const leaf = bindings[slot.id];
        const net = leaf ? netOf.get(`${c.instance}:${leaf}`) : undefined;
        return !!net && net.kind !== "signal";
      });
      if (strapped) continue;
      const signals: FirmwareSignal[] = [];
      const missing: string[] = [];
      let cs: FirmwareGpio | undefined;
      for (const slot of iface.slots) {
        const leaf = bindings[slot.id];
        const net = leaf ? netOf.get(`${c.instance}:${leaf}`) : undefined;
        const pin = net && onePin(net, `${c.instance} ${slot.id}`, c.instance);
        if (!net || !pin) {
          if (slot.required) missing.push(slot.id);
          continue;
        }
        claimed.add(`${c.instance}:${leaf}`);
        const role = CONTROLLER_ROLE[protocol][slot.id] ?? slot.id;
        const cites = [netCite(board, net), `pin:${ctl}:${pin}`, `pin:${c.instance}:${leaf}`];
        if (role === "cs") cs = gpio({ use: "cs", pin, net: net.id, instance: c.instance, part: def.id, peripheralPin: leaf, label: `${name} CS`, direction: "output", activeLow: true, cites }, net);
        else signals.push({ role, pin, net: net.id, cites });
      }
      if (!signals.length && !cs) continue; // the device is not wired to the controller
      if (missing.length) {
        findings.push({
          code: "FW_BUS_INCOMPLETE",
          severity: "error",
          instance: c.instance,
          message: `${c.instance} (${def.id}) ${iface.id}: ${missing.join(", ")} not wired to ${ctl}; the ${protocol.toUpperCase()} bus needs every required line`,
          cites: [`pin:${c.instance}:${iface.id}`],
        });
      }
      const shared = protocol === "i2c" ? ["sda", "scl"] : protocol === "spi" ? ["sck", "mosi", "miso"] : ["tx", "rx", "rts", "cts"];
      const bus = busFor(protocol, signals, shared);
      for (const s of signals) use(s.pin, `${bus.id}.${s.role}`);
      if (cs) use(cs.pin, `${bus.id}.cs ${c.instance}`);
      const address = param(iface, "i2c_address")?.value;
      const clock = maxOf(param(iface, "clock_freq"));
      const baud = maxOf(param(iface, "baud_rate"));
      bus.devices.push({
        ...base,
        interface: iface.id,
        ...(address !== undefined ? { address } : {}),
        ...(clock !== undefined ? { maxClockHz: clock } : {}),
        ...(baud !== undefined ? { baud } : {}),
        ...(cs ? { cs } : {}),
        roles: signals.map((s) => s.role),
        controls: [],
        cites: [
          `pin:${c.instance}:${iface.id}`,
          ...(address !== undefined ? [`part:${def.id}:${iface.id}.i2c_address`] : []),
          ...(clock !== undefined ? [`part:${def.id}:${iface.id}.clock_freq`] : []),
        ],
      });
      if (protocol === "i2c" && address === undefined) {
        findings.push({ code: "FW_I2C_ADDRESS_UNKNOWN", severity: "warning", instance: c.instance, message: `${c.instance} (${def.id}) states no i2c_address on ${iface.id}; its node cannot be addressed`, cites: [`pin:${c.instance}:${iface.id}`] });
      }
    }

    // -- crystals on the controller's crystal pins
    if ((def.categories ?? []).some((x) => x.includes("crystal"))) {
      const pins = c.pins.map((p) => netOf.get(`${c.instance}:${p.interface}`)).flatMap((n) => (n ? ctlPins(n).map((pin) => ({ pin, n })) : []));
      if (pins.length) {
        const perf = (def.traits ?? []).find((t) => t.type === "performance" && typeof (t.params as Record<string, unknown> | undefined)?.nominal_frequency_Hz === "number");
        const freq = perf ? ((perf.params as Record<string, unknown>).nominal_frequency_Hz as number) : undefined;
        result.crystals.push({
          instance: c.instance,
          part: def.id,
          pins: pins.map((x) => x.pin),
          ...(freq !== undefined ? { frequencyHz: freq } : {}),
          cites: [`pin:${c.instance}:${c.pins[0].interface}`, ...(freq !== undefined ? [`part:${def.id}:traits.performance.nominal_frequency_Hz`] : []), ...pins.flatMap((x) => [netCite(board, x.n), `pin:${ctl}:${x.pin}`])],
        });
        for (const x of pins) use(x.pin, `crystal ${c.instance}`);
      }
      continue;
    }

    // -- buttons: a switch with one side on a controller net and the other on ground or a supply
    if (c.kind === "switch" || (def.categories ?? []).some((x) => /^(component\.switch|input\.(switch|button))/.test(x))) {
      const nets = [...new Set(c.pins.map((p) => netOf.get(`${c.instance}:${p.interface}`)).filter((n): n is BoardNetDef => Boolean(n)))];
      const signal = nets.find((n) => n.kind === "signal" && ctlPins(n).length);
      if (!signal) continue;
      const pin = onePin(signal, `button ${c.instance}`, c.instance)!;
      const other = nets.find((n) => n !== signal && (n.kind === "ground" || n.kind === "power"));
      const activeLow = other?.kind !== "power";
      const g = gpio(
        {
          use: "button",
          pin,
          net: signal.id,
          instance: c.instance,
          part: def.id,
          label: name,
          direction: "input",
          activeLow,
          cites: [netCite(board, signal), `pin:${ctl}:${pin}`, ...(other ? [netCite(board, other)] : [])],
        },
        signal,
        activeLow ? "up" : "down",
      );
      if (!other) findings.push({ code: "FW_BUTTON_FLOATING", severity: "warning", instance: c.instance, message: `button ${c.instance}: its other terminal is on no ground or supply net; assumed active low with a pull-up`, cites: g.cites });
      result.gpios.push(g);
      use(pin, `button ${c.instance}`);
      continue;
    }

    // -- single GPIOs between the controller and this component (not passives, not USB data lines)
    if (["resistor", "capacitor", "inductor", "ferrite_bead"].includes(c.kind)) continue;
    for (const leaf of leafPins(def)) {
      if (claimed.has(`${c.instance}:${leaf.id}`)) continue;
      if (hasProtocol(leaf, "usb") || hasProtocol(leaf, "passive") || hasProtocol(leaf, "power")) continue;
      const own = netOf.get(`${c.instance}:${leaf.id}`);
      if (!own || own.kind !== "signal") continue;
      // through a series resistor (a level divider's top bringing a 5 V status output down, a current limit)
      // when the pin's own net has no controller pin; the divider's lower leg is then the line's pull (gpio)
      let net = own;
      let series: string | undefined;
      let via: string | undefined;
      if (!ctlPins(own).length) {
        for (const p of own.pins) {
          const [inst, lf] = p.split(":");
          const rc = component.get(inst);
          if (rc?.kind !== "resistor") continue;
          const other = rc.pins.find((x) => x.interface !== lf);
          const next = other && netOf.get(`${inst}:${other.interface}`);
          if (next?.kind === "signal" && ctlPins(next).length) {
            net = next;
            series = `${inst}:${other!.interface}`;
            via = inst;
            break;
          }
        }
      }
      const pin = ctlPins(net).length ? onePin(net, `${c.instance} ${leaf.name ?? leaf.id}`, c.instance) : undefined;
      if (!pin) continue;
      const k = caps(leaf);
      const cites = [netCite(board, net), ...(series ? [netCite(board, own), `pin:${series}`] : []), `pin:${ctl}:${pin}`, `pin:${c.instance}:${leaf.id}`];
      const label = `${name} ${leaf.name ?? leaf.id}${via ? ` (through ${via})` : ""}`;
      if (k.includes("onewire_dq") || hasProtocol(leaf, "onewire")) {
        const bus = busFor("onewire", [{ role: "dq", pin, net: net.id, cites }], ["dq"]);
        bus.devices.push({ ...base, interface: leaf.id, controls: [], cites: [`pin:${c.instance}:${leaf.id}`] });
        use(pin, `${bus.id}.dq`);
        continue;
      }
      const output = hasProtocol(leaf, "interrupt", "output") || hasProtocol(leaf, "digital", "output") || hasProtocol(leaf, "digital", "bidirectional");
      const input = hasProtocol(leaf, "digital", "input");
      let use_: FirmwareGpioUse;
      if (hasProtocol(leaf, "interrupt", "output") || (k.includes("interrupt") && output)) use_ = "interrupt";
      else if (k.includes("charge_status")) use_ = "status";
      else if (k.includes("reset")) use_ = "reset";
      else if (k.includes("shutdown")) use_ = "shutdown";
      else if (k.includes("enable") || k.includes("charge_enable")) use_ = "enable";
      else if (k.includes("display_dc")) use_ = "dc";
      else if (k.includes("trigger_in")) use_ = "trigger";
      else if (output && !input) use_ = "input";
      else use_ = "output";
      const direction = ["interrupt", "status", "input"].includes(use_) ? "input" : "output";
      const activeLow = k.includes("active_low") || use_ === "reset";
      // an open-drain or tri-state output needs a pull-up to be read
      const floats = k.includes("open_drain") || k.includes("tri_state");
      const g = gpio({ use: use_, pin, net: net.id, instance: c.instance, part: def.id, peripheralPin: leaf.id, label, direction, activeLow, cites }, net, direction === "input" && floats ? "up" : undefined);
      use(pin, `${use_} ${c.instance}.${leaf.id}${via ? ` via ${via}` : ""}`);
      // a control of a device already on a bus belongs to that device
      const dev = result.buses.flatMap((b) => b.devices).find((d) => d.instance === c.instance);
      if (dev) dev.controls.push(g);
      else result.gpios.push(g);
    }
  }

  // ---- USB: the controller's USB composite with its data pins on nets that reach something
  for (const iface of ctlDef.interfaces) {
    if (!iface.slots?.length || !hasProtocol(iface, "usb")) continue;
    const data = Object.entries(slotBindings(iface)).filter(([slot]) => slot === "dp" || slot === "dm");
    const nets = data.map(([, leaf]) => netOf.get(`${ctl}:${leaf}`)).filter((n): n is BoardNetDef => Boolean(n));
    const peers = [...new Set(nets.flatMap((n) => n.pins.map((p) => p.split(":")[0]).filter((i) => i !== ctl)))];
    if (nets.length === data.length && peers.length) {
      result.usb = { interface: iface.id, pins: data.map(([, leaf]) => leaf), peers, cites: [`pin:${ctl}:${iface.id}`, ...nets.map((n) => netCite(board, n))] };
      for (const [, leaf] of data) use(leaf, `usb ${iface.id}`);
    }
  }

  // ---- controller pins whose net holds only resistors, one of them to a supply: the supply sensed through a
  // divider (a part's line through a series resistor is read above, with the part's pin)
  for (const n of netlist.nets) {
    if (n.kind !== "signal") continue;
    for (const pin of ctlPins(n)) {
      if (result.uses[pin]) continue;
      const others = n.pins.filter((p) => !p.startsWith(`${ctl}:`));
      if (!others.length || others.some((p) => component.get(p.split(":")[0])?.kind !== "resistor")) continue;
      const farOf = ([inst, leaf]: string[]) => netOf.get(`${inst}:${component.get(inst)!.pins.find((x) => x.interface !== leaf)?.interface}`);
      const top = others.map((p) => p.split(":")).find((x) => farOf(x)?.kind === "power");
      if (!top) continue;
      const far = farOf(top)!;
      const cites: FirmwareCite[] = [netCite(board, n), `pin:${ctl}:${pin}`, `pin:${top[0]}:${component.get(top[0])!.pins[0].interface}`, netCite(board, far)];
      // the divider's lower leg is the line's pull (it sets the level when the supply is off), not the series resistor
      const lower = others.map((p) => p.split(":")).find((x) => x[0] !== top[0] && farOf(x)?.kind === "ground");
      const g: FirmwareGpio = {
        use: "sense",
        pin,
        net: n.id,
        instance: far.id,
        part: component.get(top[0])!.part,
        label: `${far.name ?? far.id} sense (through ${top[0]})`,
        direction: "input",
        activeLow: false,
        cites: lower ? [...cites, `pin:${lower[0]}:${lower[1]}`] : cites,
        ...(lower ? { externalPull: { instance: lower[0], to: "down" as const, net: farOf(lower)!.id } } : {}),
      };
      result.gpios.push(g);
      use(pin, `sense ${far.id} via ${top[0]}`);
    }
  }

  // ---- controller pins on signal nets that nothing above uses
  for (const n of netlist.nets) {
    if (n.kind !== "signal") continue;
    for (const pin of ctlPins(n)) {
      if (result.uses[pin] || n.pins.length < 2) continue;
      const others = n.pins.filter((p) => !p.startsWith(`${ctl}:`));
      if (!others.length) continue;
      findings.push({ code: "FW_NET_UNUSED", severity: "info", instance: ctl, message: `net ${n.id} reaches ${ctl}:${pin} (${ctlLeaf(pin)?.name ?? pin}) and ${others.join(", ")}, but nothing on it is a bus, button or control the firmware configures`, cites: [netCite(board, n)] });
    }
  }
  return result;
}

export interface FirmwareRuleOptions {
  /** Controller pins that can wake the chip from its deepest sleep. Default: every GPIO. */
  canWake?: (leaf: InterfaceDef) => boolean;
  /** What the chip's deepest sleep is called, for messages ("Deep-sleep", "System OFF"). */
  sleepName?: string;
  /** Wake sources from the module's config: button or device instances, or nets. */
  wake?: unknown;
  /** Bus frequency the config asks for (Hz), checked against the devices. */
  i2cFrequencyHz?: number;
  /** The framework needs every I2C device's address (a devicetree node needs `reg`): FW_I2C_ADDRESS_UNKNOWN is an error. */
  i2cAddressRequired?: boolean;
}

/** A wake source resolved to the controller pin it arrives on. */
export interface WakeSource {
  source: string;
  pin: string;
  activeLow: boolean;
  cites: FirmwareCite[];
}

/** Resolve `constraints.wake` (instances or nets) to controller pins. Unknown entries are findings. */
export function wakeSources(fw: BoardFirmware, wake: unknown): { sources: WakeSource[]; findings: FirmwareFinding[] } {
  const sources: WakeSource[] = [];
  const findings: FirmwareFinding[] = [];
  if (wake === undefined) return { sources, findings };
  if (!Array.isArray(wake) || wake.some((w) => typeof w !== "string")) {
    return { sources, findings: [{ code: "FW_WAKE_INVALID", severity: "error", message: "constraints.wake must list instance paths or net ids, e.g. [\"sw1\", \"u4\"]", cites: ["constraint:wake"] }] };
  }
  const all = [...fw.gpios, ...fw.buses.flatMap((b) => b.devices.flatMap((d) => d.controls))];
  for (const w of wake as string[]) {
    const g = all.find((x) => x.direction === "input" && (x.instance === w || x.net === w));
    if (!g) {
      findings.push({ code: "FW_WAKE_UNKNOWN", severity: "error", message: `wake source ${w} is no button, interrupt or status input of the board (inputs: ${[...new Set(all.filter((x) => x.direction === "input").map((x) => x.instance))].join(", ") || "none"})`, cites: ["constraint:wake"] });
      continue;
    }
    sources.push({ source: w, pin: g.pin, activeLow: g.activeLow, cites: ["constraint:wake", ...g.cites] });
  }
  return { sources, findings };
}

/**
 * The rules every firmware provider applies to the board, whatever the
 * framework: a controller exists; each controller pin it uses is a GPIO and
 * is used once; bus signals land on pins with that bus function; I2C
 * addresses are unique per bus; strapping pins are not driven by
 * peripherals; wake sources are inputs on pins that can wake the chip.
 */
export function checkBoardFirmware(fw: BoardFirmware, lookup: ModuleLookup, options: FirmwareRuleOptions = {}): FirmwareFinding[] {
  const findings: FirmwareFinding[] = fw.findings.map((f) =>
    f.code === "FW_I2C_ADDRESS_UNKNOWN" && options.i2cAddressRequired ? { ...f, severity: "error", message: `${f.message}; this framework needs it (state i2c_address on the part)` } : f,
  );
  if (!fw.controller) return findings;
  const ctl = fw.controller.instance;
  const def = lookup(fw.controller.part)!;
  const leaf = (pin: string) => def.interfaces.find((i) => i.id === pin);
  const label = (pin: string) => `${ctl}:${pin} (${leaf(pin)?.name ?? "?"})`;

  // pins: a GPIO, used once
  for (const [pin, uses] of Object.entries(fw.uses)) {
    const l = leaf(pin);
    const usb = uses.every((u) => u.startsWith("usb "));
    if (!l) findings.push({ code: "FW_PIN_UNKNOWN", severity: "error", instance: ctl, message: `${pin} is not a pin of ${def.id}`, cites: [`part:${def.id}:pins`] });
    else if (!usb && !isGpioPin(l)) {
      findings.push({ code: "FW_PIN_NOT_GPIO", severity: "error", instance: ctl, message: `${label(pin)} carries ${uses.join(", ")}, but it is not a GPIO of ${def.id} (${l.protocols.map((p) => p.type).join(", ") || "no function"})`, cites: [`pin:${ctl}:${pin}`] });
    }
    if (uses.length > 1) {
      const roles = uses.map((u) => /^(\w+?\d+)\.(\w+)/.exec(u)).filter(Boolean) as RegExpExecArray[];
      const crossed = roles.length > 1 && new Set(roles.map((r) => r[1])).size > 1;
      findings.push({
        code: crossed ? "FW_BUS_CROSSED" : "FW_PIN_REUSED",
        severity: "error",
        instance: ctl,
        message: `${label(pin)} is assigned ${uses.length} times: ${uses.join("; ")}${crossed ? " (devices disagree about this line: one puts another role on it, or shares it but not the bus's other lines; a peripheral's lines are swapped)" : ""}`,
        cites: [`pin:${ctl}:${pin}`],
      });
    }
  }

  // buses: the controller pin has the function; devices agree on address and speed
  for (const bus of fw.buses) {
    for (const s of bus.signals) {
      const need = ROLE_CAPABILITY[s.role];
      const l = leaf(s.pin);
      if (need && l && isGpioPin(l) && !(l.capabilities ?? []).includes(need)) {
        findings.push({
          code: "FW_BUS_PROTOCOL",
          severity: "error",
          instance: ctl,
          message: `${bus.id} ${s.role.toUpperCase()} is on ${label(s.pin)}, which ${def.id} does not list for ${need}${(l.capabilities ?? []).includes("low_frequency_io") ? " (a low-frequency pad)" : ""}`,
          cites: s.cites,
        });
      }
    }
    for (const d of bus.devices) {
      if (d.cs) {
        const l = leaf(d.cs.pin);
        if (l && !isGpioPin(l)) findings.push({ code: "FW_PIN_NOT_GPIO", severity: "error", instance: d.instance, message: `${d.instance} chip select is on ${label(d.cs.pin)}, which is not a GPIO`, cites: d.cs.cites });
      }
    }
    if (bus.protocol === "i2c") {
      const by = new Map<number, FirmwareDevice[]>();
      for (const d of bus.devices) if (d.address !== undefined) by.set(d.address, [...(by.get(d.address) ?? []), d]);
      for (const [address, ds] of by) {
        if (ds.length > 1) {
          findings.push({
            code: "FW_I2C_ADDRESS_CONFLICT",
            severity: "error",
            instance: ds[1].instance,
            message: `${bus.id}: ${ds.map((d) => `${d.instance} (${d.part})`).join(" and ")} share address 0x${address.toString(16).padStart(2, "0")}; move one to another bus or strap another address`,
            cites: ds.flatMap((d) => d.cites),
          });
        }
      }
      if (options.i2cFrequencyHz !== undefined) {
        for (const d of bus.devices) {
          if (d.maxClockHz !== undefined && d.maxClockHz < options.i2cFrequencyHz) {
            findings.push({ code: "FW_BUS_SPEED", severity: "error", instance: d.instance, message: `${bus.id} at ${options.i2cFrequencyHz} Hz is faster than ${d.instance} (${d.part}) allows (${d.maxClockHz} Hz)`, cites: ["constraint:i2c_frequency_hz", ...d.cites] });
          }
        }
      }
    }
    if (bus.protocol === "uart" && bus.devices.length > 1) {
      findings.push({ code: "FW_BUS_SHARED", severity: "error", instance: bus.devices[1].instance, message: `${bus.id}: ${bus.devices.map((d) => d.instance).join(" and ")} share UART lines; a UART joins two ends`, cites: bus.devices.flatMap((d) => d.cites) });
    }
  }

  // strapping pins: nothing drives them at reset
  const all = [...fw.gpios, ...fw.buses.flatMap((b) => b.devices.flatMap((d) => [...d.controls, ...(d.cs ? [d.cs] : [])]))];
  const strapping = (pin: string) => (leaf(pin)?.capabilities ?? []).some((c) => c === "strapping" || c === "boot");
  for (const g of all.filter((g) => strapping(g.pin))) {
    if (g.use === "button") {
      findings.push({ code: "FW_STRAPPING_BUTTON", severity: "info", instance: g.instance, message: `button ${g.instance} is on strapping pin ${label(g.pin)}: held at reset it selects the boot mode (that is what a BOOT button does)`, cites: g.cites });
    } else if (g.direction === "input") {
      findings.push({ code: "FW_STRAPPING_DRIVEN", severity: "error", instance: g.instance, message: `${g.label} drives strapping pin ${label(g.pin)}; a peripheral output there can select the wrong boot mode at reset. Move it to another GPIO`, cites: g.cites });
    } else {
      findings.push({ code: "FW_STRAPPING_PIN", severity: "warning", instance: g.instance, message: `${g.label} uses strapping pin ${label(g.pin)}; check the level it holds at reset`, cites: g.cites });
    }
  }
  for (const bus of fw.buses) {
    for (const s of bus.signals.filter((s) => strapping(s.pin))) {
      const driven = bus.protocol === "uart" && s.role === "rx";
      findings.push({
        code: driven ? "FW_STRAPPING_DRIVEN" : "FW_STRAPPING_PIN",
        severity: driven ? "error" : "warning",
        instance: ctl,
        message: driven ? `${bus.id} RX on strapping pin ${label(s.pin)} is driven by ${bus.devices.map((d) => d.instance).join(", ")}'s TX at reset; move it` : `${bus.id} ${s.role.toUpperCase()} uses strapping pin ${label(s.pin)}; its pull-up holds it high at reset, check that selects the boot mode you want`,
        cites: s.cites,
      });
    }
  }

  // wake sources
  const { sources, findings: wakeFindings } = wakeSources(fw, options.wake);
  findings.push(...wakeFindings);
  const canWake = options.canWake ?? isGpioPin;
  for (const w of sources) {
    const l = leaf(w.pin);
    if (!l || !canWake(l)) {
      findings.push({ code: "FW_WAKE_INVALID", severity: "error", instance: w.source, message: `wake source ${w.source} arrives on ${label(w.pin)}, which cannot wake ${def.id} from ${options.sleepName ?? "sleep"}`, cites: w.cites });
    }
  }
  return findings;
}

/** Board components by instance path. */
export function componentOf(fw: BoardFirmware, instance: string): BoardComponent | undefined {
  return fw.netlist.components.find((c) => c.instance === instance);
}
