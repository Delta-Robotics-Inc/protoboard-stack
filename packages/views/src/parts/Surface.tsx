/**
 * The page a parts view draws on: its background (the sidebar's or the
 * editor's), the card surface, the body face and the picture matte, all from
 * the theme's tokens. High contrast draws no washes: cards are the page with
 * an outline.
 */
import type { CSSProperties, ReactNode } from "react";
import { cx, useTheme } from "@deltarobotics/uhd-viewer/components";
import { CarouselStyles } from "./carousel.js";
import { PartStatusStyles } from "./PartStatus.js";

export type Place = "sidebar" | "editor";

export function PartsSurface({ place, children, className }: { place: Place; children: ReactNode; className?: string }) {
  const { theme } = useTheme();
  const hc = theme.scheme.startsWith("high-contrast");
  const light = theme.scheme.includes("light");
  // Protoboard's themes have their own card and sidebar shades (Alpha's); a VS Code theme gives the sidebar's colour,
  // and cards are a light wash of the text over the editor's background
  const own = theme.id.startsWith("protoboard");
  const sidebar = own ? "color-mix(in oklab, var(--uhd-text) 2.5%, var(--uhd-background))" : "var(--uhd-surface)";
  const bg = place === "sidebar" ? sidebar : "var(--uhd-background)";
  const card = own ? "var(--uhd-surface)" : "color-mix(in oklab, var(--uhd-text) 7%, var(--uhd-background))";
  const style = {
    "--pb-bg": bg,
    "--pb-card": hc ? bg : card,
    "--pb-row-head": hc ? bg : `color-mix(in oklab, var(--uhd-text) 5%, ${card})`,
    // the outline of buttons, chips and inputs: a quiet line in every theme, the contrast border in high contrast
    "--pb-control-border": hc ? "var(--uhd-contrast-border)" : "color-mix(in oklab, var(--uhd-text) 22%, transparent)",
    // pictures (PB-917): a render with a transparent background on the page's own surface, a little lifted; a photo
    // shot on white on a light tile it melts into (multiply), white in light themes, a soft grey in dark ones;
    // high contrast keeps white tiles, outlined by the card
    "--pb-thumb-clear": hc ? bg : `color-mix(in oklab, var(--uhd-text) ${light ? 3 : 6}%, ${card})`,
    "--pb-thumb-tile": hc || light ? "#ffffff" : "color-mix(in srgb, #ffffff 86%, var(--uhd-background))",
    "--pb-thumb-blend": hc ? "normal" : "multiply",
    "--pb-thumb-fg": "#8a8a8a",
    // the body face: in VS Code the theme's (VS Code's own, or Kode Mono under a Protoboard colour theme, PB-1070); a neutral sans elsewhere
    "--pb-font-body": theme.id === "vscode" ? "var(--uhd-font-ui)" : `var(--vscode-font-family, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)`,
    // the severity hues are bright for dark pages; as text on a light page they need the deeper shade of the same hue (WCAG AA on white)
    ...(light ? { "--uhd-severity-warning": "#a16207", "--uhd-severity-info": "#0369a1", "--uhd-severity-ok": "#15803d", "--uhd-severity-error": "#dc2626" } : {}),
    background: bg,
  } as CSSProperties;
  return (
    <div className={cx("pb-parts relative size-full min-h-0 min-w-0 overflow-hidden text-fg", className)} style={style}>
      {/* the part status colours (PB-932), for every dot drawn on this page */}
      <PartStatusStyles />
      {/* the carousels' fade and hover-revealed controls (PB-918) */}
      <CarouselStyles />
      {children}
    </div>
  );
}
