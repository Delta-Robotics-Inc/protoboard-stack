import type { InterfaceDef, InterfaceLink, ModuleDef } from "@deltarobotics/uhd";

/**
 * Bike computer, concept level (docs/brief.md): nine capability blocks around
 * the controller. Every block is a placeholder: no part is chosen.
 */
const power = (id: string, name: string, role: "source" | "sink"): InterfaceDef => ({ id, name, domain: "electrical", exposed: true, protocols: [{ type: "power", roles: [role] }] });
const signal = (id: string, name: string, role: "output" | "input"): InterfaceDef => ({ id, name, domain: "electrical", exposed: true, protocols: [{ type: "gpio", roles: [role] }] });
const block = (id: string, name: string, description: string, interfaces: InterfaceDef[]): ModuleDef => ({ id, name, kind: "module", description: `Placeholder, no part chosen yet. ${description}`, interfaces, children: [], links: [] });

export const BIKE_USB = block("bike-usb", "USB-C port", "Charging input.", [power("vbus", "VBUS out", "source")]);
export const BIKE_POWER = block("bike-power", "Battery and charging", "A lithium cell, its charger and the 3.3 V supply.", [power("vbus", "VBUS in", "sink"), power("v3v3", "3.3 V out", "source")]);
export const BIKE_CONTROL = block("bike-control", "Controller", "Reads the sensors and buttons, draws the screen, talks to the phone.", [
  power("v3v3", "3.3 V in", "sink"),
  signal("gps", "GPS data in", "input"),
  signal("motion", "Motion data in", "input"),
  signal("screen", "Screen out", "output"),
  signal("buzz", "Buzzer out", "output"),
  signal("buttons", "Buttons in", "input"),
  signal("radio", "Radio out", "output"),
]);
export const BIKE_GPS = block("bike-gps", "GPS", "Position and speed.", [power("v3v3", "3.3 V in", "sink"), signal("data", "Data out", "output")]);
export const BIKE_MOTION = block("bike-motion", "Motion sensor", "Tilt and vibration, for climbs and crashes.", [power("v3v3", "3.3 V in", "sink"), signal("data", "Data out", "output")]);
export const BIKE_SCREEN = block("bike-screen", "Screen", "A small sunlight-readable display.", [power("v3v3", "3.3 V in", "sink"), signal("data", "Data in", "input")]);
export const BIKE_BUZZER = block("bike-buzzer", "Buzzer", "Beeps before a turn.", [signal("drive", "Drive in", "input")]);
export const BIKE_BUTTONS = block("bike-buttons", "Buttons", "Two buttons usable with gloves.", [signal("press", "Press out", "output")]);
export const BIKE_RADIO = block("bike-radio", "Bluetooth radio", "The link to the phone.", [power("v3v3", "3.3 V in", "sink"), signal("data", "Data in", "input")]);

const link = (id: string, name: string, a: [string, string], b: [string, string]): InterfaceLink => ({ id, name, a: { child: a[0], interfaceId: a[1] }, b: { child: b[0], interfaceId: b[1] } });

export const BIKE_COMPUTER: ModuleDef = {
  id: "bike-computer",
  name: "Bike computer",
  kind: "module",
  version: "0.1.0",
  description: "Concept: a handlebar bike computer. Nine blocks; nothing below them is decided.",
  interfaces: [],
  children: [
    { id: "usb", moduleDefId: "bike-usb", name: "USB-C port" },
    { id: "power", moduleDefId: "bike-power", name: "Battery and charging" },
    { id: "control", moduleDefId: "bike-control", name: "Controller" },
    { id: "gps", moduleDefId: "bike-gps", name: "GPS" },
    { id: "motion", moduleDefId: "bike-motion", name: "Motion sensor" },
    { id: "screen", moduleDefId: "bike-screen", name: "Screen" },
    { id: "buzzer", moduleDefId: "bike-buzzer", name: "Buzzer" },
    { id: "buttons", moduleDefId: "bike-buttons", name: "Buttons" },
    { id: "radio", moduleDefId: "bike-radio", name: "Bluetooth radio" },
  ],
  links: [
    link("charge", "USB charging", ["usb", "vbus"], ["power", "vbus"]),
    link("control_supply", "Supply to the controller", ["power", "v3v3"], ["control", "v3v3"]),
    link("gps_supply", "Supply to the GPS", ["power", "v3v3"], ["gps", "v3v3"]),
    link("motion_supply", "Supply to the motion sensor", ["power", "v3v3"], ["motion", "v3v3"]),
    link("screen_supply", "Supply to the screen", ["power", "v3v3"], ["screen", "v3v3"]),
    link("radio_supply", "Supply to the radio", ["power", "v3v3"], ["radio", "v3v3"]),
    link("gps_data", "GPS data", ["gps", "data"], ["control", "gps"]),
    link("motion_data", "Motion data", ["motion", "data"], ["control", "motion"]),
    link("screen_data", "Screen data", ["control", "screen"], ["screen", "data"]),
    link("buzz", "Buzzer drive", ["control", "buzz"], ["buzzer", "drive"]),
    link("buttons", "Buttons", ["buttons", "press"], ["control", "buttons"]),
    link("radio_data", "Radio data", ["control", "radio"], ["radio", "data"]),
  ],
};
