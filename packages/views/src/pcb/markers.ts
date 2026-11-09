/**
 * Finding markers and the origin mark as SVG text, shared by the layout screen and the headless render page. A
 * marker never relies on color alone: shape, glyph and color together (the concept's kit): an error is a red
 * octagon with a cross, a warning a yellow triangle with "!", a policy cost an orange diamond with "!", info a
 * dashed circle with "?".
 */
import type { PcbFinding } from "./types.js";

export const MARKER_COLORS = { error: "#ef4444", warning: "#eed202", risk: "#ff7a1a", info: "#8b949e", glyph: "#131313" };

export type MarkerKind = "error" | "warning" | "risk" | "info";

export function markerKind(f: Pick<PcbFinding, "severity" | "tier">): MarkerKind {
  if (f.severity === "error") return "error";
  if (f.severity === "warning") return f.tier === "policy" ? "risk" : "warning";
  return "info";
}

/** One marker centered on (0, 0), `r` its radius in pixels. */
export function markerSvg(kind: MarkerKind, r = 7, ring = false): string {
  const c = MARKER_COLORS;
  const halo = ring ? `<circle r="${r + 4}" fill="none" stroke="${c[kind]}" stroke-width="1.25" opacity="0.6"/>` : "";
  switch (kind) {
    case "error": {
      const k = r * 0.4142;
      const pts = [
        [k, -r],
        [r, -k],
        [r, k],
        [k, r],
        [-k, r],
        [-r, k],
        [-r, -k],
        [-k, -r],
      ]
        .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(" ");
      const g = r * 0.42;
      return `${halo}<polygon points="${pts}" fill="${c.error}"/><path d="M${-g},${-g}L${g},${g}M${g},${-g}L${-g},${g}" stroke="${c.glyph}" stroke-width="${(r / 4).toFixed(2)}" stroke-linecap="round"/>`;
    }
    case "warning":
      return `${halo}<polygon points="0,${-r * 1.05} ${r * 1.05},${r * 0.85} ${-r * 1.05},${r * 0.85}" fill="${c.warning}" stroke-linejoin="round"/><path d="M0,${-r * 0.35}V${r * 0.3}" stroke="${c.glyph}" stroke-width="${(r / 4.5).toFixed(2)}" stroke-linecap="round"/><circle cy="${r * 0.6}" r="${r / 8}" fill="${c.glyph}"/>`;
    case "risk":
      return `${halo}<polygon points="0,${-r} ${r},0 0,${r} ${-r},0" fill="${c.risk}"/><path d="M0,${-r * 0.45}V${r * 0.15}" stroke="${c.glyph}" stroke-width="${(r / 4.5).toFixed(2)}" stroke-linecap="round"/><circle cy="${r * 0.45}" r="${r / 8}" fill="${c.glyph}"/>`;
    case "info":
      return `${halo}<circle r="${r}" fill="#131313" stroke="${c.info}" stroke-width="1.25" stroke-dasharray="2.5 2"/><text y="${r * 0.38}" text-anchor="middle" font-size="${r * 1.15}" font-family="ui-monospace,monospace" fill="${c.info}">?</text>`;
  }
}

/** The origin mark (board center): a small crosshair in a circle, in the scene's ink. */
export function originSvg(r = 9): string {
  return `<circle r="${r * 0.55}" fill="none" stroke="#d4d4d4" stroke-opacity="0.55" stroke-width="1"/><path d="M${-r},0H${r}M0,${-r}V${r}" stroke="#d4d4d4" stroke-opacity="0.55" stroke-width="1"/>`;
}
