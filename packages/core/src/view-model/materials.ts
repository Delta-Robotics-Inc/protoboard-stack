/**
 * Default looks for geometry whose source carries no material (README §4,
 * PB-1073: library-made catalog GLBs and nominal fasteners have none, so the
 * viewer drew them all in one grey). A STEP colour always wins; these apply
 * only where the GLB primitive has no material.
 *
 * Two sources of a default, in order: the sub-node's name ("pcb", "pads",
 * "grommets" in a library-made body), then the part's kind. Colours are
 * linear RGB factors, as glTF stores them.
 */

export interface MaterialLook {
  name: string;
  color: [number, number, number, number];
  metallic: number;
  roughness: number;
}

const look = (name: string, srgb: string, metallic: number, roughness: number): MaterialLook => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const n = parseInt(srgb.slice(1), 16);
  const r = (x: number) => Math.round(lin(x) * 1e4) / 1e4;
  return { name, color: [r((n >> 16) & 255), r((n >> 8) & 255), r(n & 255), 1], metallic, roughness };
};

export const LOOKS = {
  pcb: look("default pcb (solder mask)", "#1f5a32", 0, 0.55),
  copper: look("default copper pads", "#c8a23c", 0.8, 0.35),
  silk: look("default silkscreen", "#f2f2ee", 0, 0.7),
  ic: look("default package (epoxy)", "#222428", 0, 0.6),
  passive: look("default passive body", "#7a6a55", 0, 0.6),
  ceramic: look("default ceramic capacitor", "#b39c7a", 0, 0.6),
  connector: look("default connector housing", "#e8e4dc", 0, 0.6),
  metal: look("default steel", "#9aa0a6", 0.85, 0.35),
  rubber: look("default rubber", "#2b2b2b", 0, 0.9),
  plastic: look("default plastic", "#5a6270", 0, 0.65),
  wire: look("default insulation", "#3a3a3a", 0, 0.6),
  placeholder: look("placeholder (amber)", "#f2a33a", 0, 0.7),
  neutral: look("default", "#9ea3a8", 0.1, 0.6),
} as const;

/** Look for a sub-node by its name, when the name says what it is. */
export function lookForName(name: string | undefined): MaterialLook | undefined {
  const n = (name ?? "").toLowerCase();
  if (!n) return undefined;
  if (/silk/.test(n)) return LOOKS.silk;
  if (/(^|[^a-z])(pad|pads|copper|pin|pins|lead|leads|terminal|contact)s?([^a-z]|$)|^pad_|copper/.test(n)) return LOOKS.copper;
  if (/(^|[^a-z])(pcb|board|substrate|mask)([^a-z]|$)/.test(n)) return LOOKS.pcb;
  if (/grommet|rubber|damper|o-?ring|gasket/.test(n)) return LOOKS.rubber;
  if (/screw|bolt|nut|washer|standoff|spacer|shaft|bearing|metal|steel|alu/.test(n)) return LOOKS.metal;
  if (/component|chip|package|^ic\b|mcu|body_ic/.test(n)) return LOOKS.ic;
  if (/wire|cable|conductor|insulation|harness/.test(n)) return LOOKS.wire;
  if (/housing|connector|header|plug|socket/.test(n)) return LOOKS.connector;
  return undefined;
}

/** Look for a part kind (ViewComponent.partKind). */
export function lookForKind(kind: string | undefined, placeholder?: boolean): MaterialLook {
  if (placeholder) return LOOKS.placeholder;
  switch (kind) {
    case "board":
      return LOOKS.pcb;
    case "ic":
    case "diode":
    case "transistor":
    case "led":
    case "module":
      return LOOKS.ic;
    case "resistor":
    case "inductor":
      return LOOKS.passive;
    case "capacitor":
      return LOOKS.ceramic;
    case "connector":
      return LOOKS.connector;
    case "fastener":
      return LOOKS.metal;
    case "harness":
      return LOOKS.wire;
    case "enclosure":
    case "mechanical":
      return LOOKS.plastic;
    default:
      return LOOKS.neutral;
  }
}

/**
 * A coarse part kind from a definition's tags, categories and name. Ordered:
 * the first rule that matches wins.
 */
export function partKindOf(words: (string | undefined)[]): string | undefined {
  const w = ` ${words.filter(Boolean).join(" ").toLowerCase()} `;
  const has = (re: RegExp) => re.test(w);
  if (has(/\bplaceholder\b/)) return "placeholder";
  if (has(/\b(resistor|resistors)\b/)) return "resistor";
  if (has(/\b(capacitor|capacitors|mlcc)\b/)) return "capacitor";
  if (has(/\b(inductor|inductors|ferrite)\b/)) return "inductor";
  if (has(/\b(led|leds)\b/)) return "led";
  if (has(/\b(diode|diodes|tvs|zener|schottky)\b/)) return "diode";
  if (has(/\b(mosfet|transistor|bjt)\b/)) return "transistor";
  if (has(/\b(connector|header|jack|socket|terminal|receptacle|usb-c)\b/)) return "connector";
  if (has(/\b(fastener|screw|nut|standoff|spacer|washer|grommet)\b/)) return "fastener";
  if (has(/\b(harness|cable|wire|lead)\b/)) return "harness";
  if (has(/\b(pcb|board|mainboard)\b/)) return "board";
  if (has(/\b(ic|mcu|microcontroller|regulator|ldo|buffer|sensor|soc|amplifier)\b/)) return "ic";
  if (has(/\b(enclosure|shell|housing|panel|plate|frame|bracket|mount)\b/)) return "mechanical";
  return undefined;
}
