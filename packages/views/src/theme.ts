/**
 * Theme adapters for the shells. The tokens and the neutral and VS Code
 * adapters come from @deltarobotics/uhd-viewer; Protoboard's own theme lives
 * here, so the open viewer never carries the brand. Protoboard orange exists
 * only in these two themes: nothing else in the stack hard-codes it.
 */
import {
  defaultDark,
  defaultLight,
  defaultThemeAdapter,
  defineTheme,
  staticTheme,
  vscodeThemeAdapter,
  type Theme,
  type ThemeAdapter,
} from "@deltarobotics/uhd-viewer/components";

/**
 * The Protoboard brand palette, light and dark. The themes below map it onto
 * the viewer's tokens, so every Protoboard surface reads as one product.
 * Design history: the values and their names were taken from the alpha app's stylesheet (next-alpha src/index.css, `:root` and `.dark`).
 */
export const BRAND_TOKENS = {
  light: {
    background: "oklch(0.9551 0 0)",
    foreground: "oklch(0.3211 0 0)",
    card: "oklch(0.97 0 0)",
    popover: "oklch(0.9702 0 0)",
    primary: "oklch(0.6837 0.212 40.5923)",
    primaryForeground: "oklch(1 0 0)",
    secondary: "oklch(0.9067 0 0)",
    muted: "oklch(0.872 0 0)",
    mutedForeground: "oklch(0.45 0 0)",
    accent: "oklch(0.8078 0 0)",
    border: "oklch(0.8576 0 0)",
    input: "oklch(0.9067 0 0)",
    ring: "oklch(0.4891 0 0)",
    sidebar: "oklch(0.937 0 0)",
    canvasBackground: "oklch(0.94 0 0)",
    canvasGrid: "oklch(0.76 0 0)",
  },
  dark: {
    background: "oklch(0.2178 0 0)",
    foreground: "oklch(0.8853 0 0)",
    card: "oklch(0.251 0 0)",
    popover: "oklch(0.2435 0 0)",
    primary: "oklch(0.6837 0.212 40.5923)",
    primaryForeground: "oklch(0.922 0 0)",
    secondary: "oklch(0.3092 0 0)",
    muted: "oklch(0.285 0 0)",
    mutedForeground: "oklch(0.68 0 0)",
    accent: "oklch(0.3715 0 0)",
    border: "oklch(0.329 0 0)",
    input: "oklch(0.3092 0 0)",
    ring: "oklch(0.7058 0 0)",
    sidebar: "oklch(0.2393 0 0)",
    canvasBackground: "oklch(0.2178 0 0)",
    canvasGrid: "oklch(0.285 0 0)",
  },
} as const;

/** The brand's shadows: a 2px y-offset step under a soft blur. */
const BRAND_SHADOWS = {
  shadowSm: "0px 2px 0px 0px hsl(0 0% 20% / 0.15), 0px 1px 2px -1px hsl(0 0% 20% / 0.15)",
  shadowMd: "0px 2px 0px 0px hsl(0 0% 20% / 0.15), 0px 2px 4px -1px hsl(0 0% 20% / 0.15)",
  shadowLg: "0px 2px 0px 0px hsl(0 0% 20% / 0.15), 0px 4px 6px -1px hsl(0 0% 20% / 0.15)",
};

/** The brand palette on the viewer's surfaces, text, borders and accent. */
function brandTokens(a: (typeof BRAND_TOKENS)["light" | "dark"]) {
  return {
    background: a.background,
    canvas: a.canvasBackground,
    canvasDot: a.canvasGrid,
    surface: a.card,
    surfaceRaised: a.popover,
    surfaceSunken: a.sidebar,
    muted: a.muted,
    active: a.accent,
    text: a.foreground,
    textMuted: a.mutedForeground,
    textOnAccent: a.primaryForeground,
    border: a.border,
    borderSubtle: a.input,
    borderStrong: a.ring,
    nodeBorder: a.border,
    accent: a.primary,
    textLink: a.primary,
    radius: "0.5rem",
  };
}

/** The dark Protoboard theme: the palette's dark tokens. */
export const protoboardDark: Theme = defineTheme(defaultDark, {
  id: "protoboard-dark",
  label: "Protoboard dark",
  tokens: {
    ...brandTokens(BRAND_TOKENS.dark),
    // the canvas's nodes and the 3D scene sit a step off the palette's background
    surfaceSunken: "oklch(0.2 0 0)",
    textFaint: "oklch(0.52 0 0)",
    node: "oklch(0.2768 0 0)",
    nodeSelected: "oklch(0.2386 0 0)",
    nodeBorder: "oklch(0.4 0 0)",
    nodeBorderHover: BRAND_TOKENS.dark.foreground,
    selection: "rgba(168, 162, 158, 0.32)",
    accentHover: "oklch(0.72 0.19 42)",
    ...BRAND_SHADOWS,
  },
});

/** The light Protoboard theme: the palette's light tokens. */
export const protoboardLight: Theme = defineTheme(defaultLight, {
  id: "protoboard-light",
  label: "Protoboard light",
  tokens: {
    ...brandTokens(BRAND_TOKENS.light),
    textFaint: "oklch(0.6 0 0)",
    node: BRAND_TOKENS.light.card,
    nodeSelected: `color-mix(in oklab, var(--uhd-accent) 6%, ${BRAND_TOKENS.light.card})`,
    nodeBorder: BRAND_TOKENS.light.border,
    nodeBorderHover: BRAND_TOKENS.light.mutedForeground,
    overlay: "color-mix(in oklab, var(--uhd-surface) 92%, transparent)",
    scrim: "oklch(0.2 0 0 / 0.4)",
    accentHover: "oklch(0.63 0.2 40.6)",
    sceneBackground: BRAND_TOKENS.light.canvasBackground,
    sceneGrid: "oklch(0.8 0 0)",
    sceneGridMinor: "oklch(0.88 0 0)",
    ...BRAND_SHADOWS,
  },
});

export const PROTOBOARD_THEMES: readonly Theme[] = [protoboardDark, protoboardLight];

/** Protoboard's theme: dark, light, or whichever the system prefers. */
export function protoboardThemeAdapter(scheme: "dark" | "light" | "system" = "dark", win: Window | undefined = typeof window === "undefined" ? undefined : window): ThemeAdapter {
  if (scheme !== "system") return staticTheme(scheme === "light" ? protoboardLight : protoboardDark);
  const query = win?.matchMedia?.("(prefers-color-scheme: light)");
  const current = () => (query?.matches ? protoboardLight : protoboardDark);
  return {
    id: "protoboard",
    current,
    subscribe: query
      ? (onChange) => {
          const h = () => onChange(current());
          query.addEventListener("change", h);
          return () => query.removeEventListener("change", h);
        }
      : undefined,
  };
}

/** The colour theme VS Code applies is a Protoboard one (the extension's Protoboard Dark or Light). */
export const isProtoboardColourTheme = (doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean =>
  /^protoboard\b/i.test(doc?.body?.dataset.vscodeThemeId ?? doc?.body?.dataset.vscodeThemeName ?? "");

/** VS Code's faces, or the Protoboard ones under a Protoboard colour theme (the only place they apply). */
const VSCODE_FACES = { fontUi: "var(--vscode-font-family)", fontLabel: "var(--vscode-font-family)", fontMono: "var(--vscode-editor-font-family, ui-monospace, monospace)" };
const PROTOBOARD_FACES = { fontUi: '"Kode Mono", var(--vscode-font-family)', fontLabel: '"Kode Mono Bold", "Kode Mono", var(--vscode-font-family)', fontMono: "var(--vscode-editor-font-family, ui-monospace, monospace)" };

/** Faint text in a native view: readable as text on the side bar's and the panel's background in a light and a dark theme. */
const VIEW_FAINT = "color-mix(in oklab, var(--vscode-foreground) 72%, var(--vscode-sideBar-background, var(--vscode-editor-background)))";

/**
 * VS Code's theme for a native view (the Inspector's selection, the DRC
 * panel): the viewer's VS Code adapter, every token on `--vscode-*`, with VS
 * Code's own faces, and Kode Mono (bold for labels) only under a Protoboard
 * colour theme. The viewer tab's shell has the same rule
 * (`vscodeShellThemeAdapter` in @protoboardai/web-viewer). A change of theme
 * (the body's class or its theme id) re-themes.
 */
export function vscodeViewThemeAdapter(doc: Document | undefined = typeof document === "undefined" ? undefined : document): ThemeAdapter {
  const base = vscodeThemeAdapter(doc);
  const current = () => {
    const t = base.current();
    // faint text (the keys of the details' facts) is much of what a native view shows, and VS Code's disabledForeground is
    // too pale to read as text (2.2:1 in Light Modern): the foreground stepped towards the view's background keeps 4.5:1;
    // high contrast has one text colour, the foreground
    const textFaint = t.scheme.startsWith("high-contrast") ? "var(--vscode-foreground)" : VIEW_FAINT;
    return defineTheme(t, { id: t.id, label: t.label, tokens: { ...(isProtoboardColourTheme(doc) ? PROTOBOARD_FACES : VSCODE_FACES), textFaint } });
  };
  return {
    id: "vscode",
    current,
    subscribe: doc?.body
      ? (onChange) => {
          let key = `${doc.body.className}|${isProtoboardColourTheme(doc)}`;
          const observer = new MutationObserver(() => {
            const next = `${doc.body.className}|${isProtoboardColourTheme(doc)}`;
            if (next !== key) {
              key = next;
              onChange(current());
            }
          });
          observer.observe(doc.body, { attributes: true, attributeFilter: ["class", "data-vscode-theme-id", "data-vscode-theme-name"] });
          return () => observer.disconnect();
        }
      : undefined,
  };
}

/** The theme choices a shell offers by id (`?theme=` in the web viewer). */
export type ThemeChoice = "protoboard-dark" | "protoboard-light" | "protoboard-system" | "vscode" | "default-dark" | "default-light";

export const THEME_CHOICES: readonly ThemeChoice[] = ["protoboard-dark", "protoboard-light", "protoboard-system", "vscode", "default-dark", "default-light"];

/** The adapter for a choice (unknown: Protoboard dark). */
export function themeAdapterFor(choice: string | null | undefined): ThemeAdapter {
  switch (choice) {
    case "protoboard-light":
      return protoboardThemeAdapter("light");
    case "protoboard-system":
      return protoboardThemeAdapter("system");
    case "vscode":
      return vscodeThemeAdapter();
    case "default-dark":
      return defaultThemeAdapter("dark");
    case "default-light":
      return defaultThemeAdapter("light");
    default:
      return protoboardThemeAdapter("dark");
  }
}

export { defaultThemeAdapter, staticTheme, vscodeThemeAdapter, type Theme, type ThemeAdapter };
