import type { InterfaceDef, InterfaceLink, ModuleDef } from "@deltarobotics/uhd";

/**
 * Trail light, concept level (docs/brief.md): four capability blocks and the
 * connections between them. Every block is a placeholder: no part is chosen,
 * no board is drawn. The voltages are working assumptions for a single
 * lithium cell and a 3.3 V controller, to be settled at the next level.
 */
const power = (id: string, name: string, role: "source" | "sink"): InterfaceDef => ({ id, name, domain: "electrical", exposed: true, protocols: [{ type: "power", roles: [role] }] });
const signal = (id: string, name: string, role: "output" | "input"): InterfaceDef => ({ id, name, domain: "electrical", exposed: true, protocols: [{ type: "gpio", roles: [role] }] });

const block = (id: string, name: string, description: string, interfaces: InterfaceDef[]): ModuleDef => ({ id, name, kind: "module", description: `Placeholder, no part chosen yet. ${description}`, interfaces, children: [], links: [] });

export const TRAIL_POWER = block("trail-light-power", "Power", "A rechargeable cell, its charging from a USB phone charger, and the supply for everything else.", [power("supply", "Supply out", "source")]);
export const TRAIL_CONTROL = block("trail-light-control", "Control", "Reads the button and sets the light: on, dim, off.", [power("supply", "Supply in", "sink"), signal("button", "Button in", "input"), signal("dim", "Brightness out", "output")]);
export const TRAIL_LIGHT_OUTPUT = block("trail-light-output", "Light", "The LED and what drives it at two brightness levels.", [power("supply", "Supply in", "sink"), signal("dim", "Brightness in", "input")]);
export const TRAIL_BUTTON = block("trail-light-button", "Button", "One push button the wearer can find with gloves on.", [signal("press", "Press out", "output")]);

const link = (id: string, name: string, a: [string, string], b: [string, string]): InterfaceLink => ({ id, name, a: { child: a[0], interfaceId: a[1] }, b: { child: b[0], interfaceId: b[1] } });

export const TRAIL_LIGHT: ModuleDef = {
  id: "trail-light",
  name: "Trail light",
  kind: "module",
  version: "0.1.0",
  description: "Concept: a clip-on light for walking at dusk. Four blocks; nothing below them is decided.",
  interfaces: [],
  children: [
    { id: "power", moduleDefId: "trail-light-power", name: "Power" },
    { id: "control", moduleDefId: "trail-light-control", name: "Control" },
    { id: "light", moduleDefId: "trail-light-output", name: "Light" },
    { id: "button", moduleDefId: "trail-light-button", name: "Button" },
  ],
  links: [
    link("control_supply", "Supply to the control", ["power", "supply"], ["control", "supply"]),
    link("light_supply", "Supply to the light", ["power", "supply"], ["light", "supply"]),
    link("button_press", "Button to the control", ["button", "press"], ["control", "button"]),
    link("brightness", "Brightness", ["control", "dim"], ["light", "dim"]),
  ],
};
