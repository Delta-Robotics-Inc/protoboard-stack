/**
 * The part status colours (PB-932), once, for every view: the dot on a module
 * in the diagram, the Project Parts list and page, and the parts Inspector.
 * The states and what they mean are core's (`@protoboardai/core/part-trust`,
 * where the mapping from a library's data is documented); this file gives
 * each a colour per colour scheme and the ways a shell applies it:
 *
 * - React views draw `PartStatusDot` (PartStatus.tsx) inside a themed root;
 *   `PART_STATUS_CSS` gives the root its `--pb-status-*` variables by the
 *   scheme the theme provider writes on it (`data-uhd-scheme`), and by VS
 *   Code's body classes for the extension's plain pages (the Inspector).
 * - The diagram (@deltarobotics/uhd-viewer, which knows nothing of parts)
 *   takes generic marks: `nodeMarks` maps a state to a tone, and the same
 *   stylesheet points the viewer's `--uhd-mark-<tone>` at these colours.
 *
 * Colour alone never carries the state: every dot has a tooltip that says
 * the state and what it means, lists write the state's name beside it, and
 * high contrast adds a ring. No React here: the extension's Node side
 * imports it too.
 */
import { BLANK_BLOCK_TEXT, PART_TRUST_STATES, PART_TRUST_TEXT, partTrustTooltip, type PartTrust } from "@protoboardai/core/part-trust";

export { BLANK_BLOCK_TEXT, PART_TRUST_STATES, PART_TRUST_TEXT, partTrustTooltip, type PartTrust };

export type PartStatusScheme = "dark" | "light" | "high-contrast" | "high-contrast-light";

/**
 * gray local, yellow unverified, green verified, blue official. The dark
 * values are bright enough on a dark card; the light ones are the deeper
 * shade of the same hue (each at least 4.5:1 on white, so the state's name
 * can be written in it); high contrast uses saturated values on black and
 * the darkest on white.
 */
export const PART_STATUS_COLORS: Record<PartStatusScheme, Record<PartTrust, string>> = {
  dark: { local: "#8b949e", unverified: "#e3b341", verified: "#3fb950", official: "#58a6ff" },
  light: { local: "#6e7781", unverified: "#9a6700", verified: "#1a7f37", official: "#0969da" },
  "high-contrast": { local: "#bdbdbd", unverified: "#ffd60a", verified: "#3ff23f", official: "#6fc3ff" },
  "high-contrast-light": { local: "#5a5a5a", unverified: "#7a5200", verified: "#0b6b1f", official: "#0550ae" },
};

/** The CSS variable of a state's colour. */
export const partStatusVar = (trust: PartTrust): string => `--pb-status-${trust}`;

/** The viewer's generic mark tone for each state (`ViewerOptions.nodeMarks`). */
export const PART_STATUS_TONE: Record<PartTrust, "neutral" | "warning" | "ok" | "info"> = { local: "neutral", unverified: "warning", verified: "ok", official: "info" };

const declarations = (scheme: PartStatusScheme) =>
  [
    ...PART_TRUST_STATES.map((t) => `${partStatusVar(t)}: ${PART_STATUS_COLORS[scheme][t]};`),
    ...PART_TRUST_STATES.map((t) => `--uhd-mark-${PART_STATUS_TONE[t]}: var(${partStatusVar(t)});`),
    `--pb-status-ring: ${scheme.startsWith("high-contrast") ? "currentColor" : "transparent"};`,
  ].join(" ");

/** VS Code's body class for each scheme (`vscode-high-contrast-light` also carries `vscode-high-contrast`, so it comes last). */
const VSCODE_CLASS: [PartStatusScheme, string][] = [
  ["dark", "body.vscode-dark"],
  ["light", "body.vscode-light"],
  ["high-contrast", "body.vscode-high-contrast"],
  ["high-contrast-light", "body.vscode-high-contrast-light"],
];

/**
 * The stylesheet every shell includes once: the variables on a themed root
 * (any theme: VS Code's, Protoboard's, the neutral ones) and on a VS Code
 * webview's body, and the dot itself for pages drawn without React.
 */
export const PART_STATUS_CSS = [
  `:root, .uhd-root { ${declarations("dark")} }`,
  ...(["dark", "light", "high-contrast", "high-contrast-light"] as const).map((s) => `[data-uhd-scheme="${s}"] { ${declarations(s)} }`),
  ...VSCODE_CLASS.map(([s, sel]) => `${sel} { ${declarations(s)} }`),
  `.pb-status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--pb-status-local); outline: 1px solid var(--pb-status-ring); outline-offset: 1px; }`,
  ...PART_TRUST_STATES.map((t) => `.pb-status-dot[data-status="${t}"] { background: var(${partStatusVar(t)}); }`),
  // a blank block (no part chosen): the local gray as a dashed ring, not a fifth colour
  `.pb-status-dot[data-blank] { background: transparent; box-shadow: none; border: 1.5px dashed var(--pb-status-local); }`,
].join("\n");

/** A mark on a module in the diagram: the status's tone, its tooltip, and a ring instead of a dot for a blank block. */
export type PartMark = { tone: "neutral" | "warning" | "ok" | "info"; label: string; shape?: "ring" };

/** A part's status as a mark on its modules in the diagram. A blank block (no part chosen) is the local gray as a ring. */
export function nodeMarks(status: Record<string, { trust: PartTrust; basis?: string; blank?: boolean }> | undefined): Record<string, PartMark> {
  const out: Record<string, PartMark> = {};
  for (const [id, s] of Object.entries(status ?? {})) {
    if (!PART_TRUST_STATES.includes(s.trust)) continue;
    out[id] = { tone: PART_STATUS_TONE[s.trust], label: partTrustTooltip(s.trust, s.basis, s.blank === true), ...(s.blank === true ? { shape: "ring" as const } : {}) };
  }
  return out;
}
