/**
 * The Protoboard colour themes for VS Code (PB-900): "Protoboard Dark" and
 * "Protoboard Light", built from the Protoboard Alpha app's tokens
 * (next-alpha `src/index.css`, kept as `BRAND_TOKENS` in @protoboardai/views:
 * `.dark` and `:root`) with the brand orange (`--primary`, #FF5C00) as the
 * accent, and the DRC colours every Protoboard view keeps. They cover the
 * workbench, the editor, the terminal and syntax (TextMate and semantic
 * tokens). These are the only place outside the Protoboard web theme where
 * the orange exists: the views themselves follow whatever theme VS Code
 * applies. `npm run themes` writes themes/*.json from here; a test keeps them
 * equal. No VS Code API here.
 */

/** The brand tokens one theme is built from (`BRAND_TOKENS.dark` or `.light`). */
export interface BrandTokens {
  background: string;
  foreground: string;
  card: string;
  popover: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  canvasBackground: string;
  canvasGrid: string;
}

/** DRC and severity colours: the same in every theme (uhd-viewer's DRC_TOKENS). */
export interface DrcColors {
  severityError: string;
  severityWarning: string;
  severityInfo: string;
  severityOk: string;
}

/** `oklch(L C H)` (L 0..1, C, H in degrees, optional `/ alpha`) or `#rrggbb` → `#rrggbb[aa]`. */
export function toHex(color: string): string {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (hex) return `#${hex[1].toLowerCase()}`;
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i.exec(color.trim());
  if (!m) throw new Error(`not an oklch() or #hex colour: ${color}`);
  const L = Number(m[1]) / (m[2] ? 100 : 1);
  const C = Number(m[3]);
  const h = (Number(m[4]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  // OKLab → LMS (cubed) → linear sRGB
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  const byte = (x: number) => Math.round(Math.min(1, Math.max(0, gamma(x))) * 255).toString(16).padStart(2, "0");
  const alpha = m[5] === undefined ? "" : Math.round(Math.min(1, Math.max(0, Number(m[5]) / (m[6] ? 100 : 1))) * 255).toString(16).padStart(2, "0");
  return `#${lin.map(byte).join("")}${alpha === "ff" ? "" : alpha}`;
}

/** A colour with an alpha (0..1) as #rrggbbaa. */
export const withAlpha = (hex: string, alpha: number): string => `${toHex(hex).slice(0, 7)}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;

/** Mix two colours in sRGB (t: share of `b`). */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(toHex(h).slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Syntax colours per scheme: one hue per role, at the lightness each surface needs; keywords take the brand orange. */
const SYNTAX = {
  dark: {
    comment: "oklch(0.62 0 0)",
    keyword: "oklch(0.74 0.17 45)",
    storage: "oklch(0.74 0.17 45)",
    string: "oklch(0.8 0.12 135)",
    number: "oklch(0.8 0.12 75)",
    constant: "oklch(0.78 0.11 300)",
    func: "oklch(0.84 0.1 85)",
    type: "oklch(0.8 0.1 200)",
    variable: "oklch(0.88 0 0)",
    property: "oklch(0.82 0.06 230)",
    parameter: "oklch(0.86 0.04 60)",
    tag: "oklch(0.74 0.17 45)",
    attribute: "oklch(0.82 0.1 85)",
    regexp: "oklch(0.78 0.13 20)",
    invalid: "#ef4444",
  },
  light: {
    comment: "oklch(0.55 0 0)",
    keyword: "oklch(0.58 0.19 42)",
    storage: "oklch(0.58 0.19 42)",
    string: "oklch(0.52 0.13 140)",
    number: "oklch(0.55 0.13 65)",
    constant: "oklch(0.5 0.15 300)",
    func: "oklch(0.5 0.12 75)",
    type: "oklch(0.5 0.1 220)",
    variable: "oklch(0.32 0 0)",
    property: "oklch(0.45 0.09 245)",
    parameter: "oklch(0.42 0.06 55)",
    tag: "oklch(0.58 0.19 42)",
    attribute: "oklch(0.52 0.12 75)",
    regexp: "oklch(0.55 0.16 25)",
    invalid: "#dc2626",
  },
} as const;

export interface ColorTheme {
  $schema: string;
  name: string;
  type: "dark" | "light";
  semanticHighlighting: true;
  colors: Record<string, string>;
  tokenColors: { name: string; scope: string | string[]; settings: { foreground?: string; fontStyle?: string } }[];
  semanticTokenColors: Record<string, string | { foreground?: string; fontStyle?: string; italic?: boolean }>;
}

/** One Protoboard colour theme. */
export function colorTheme(scheme: "dark" | "light", brand: BrandTokens, drc: DrcColors): ColorTheme {
  const dark = scheme === "dark";
  const c = Object.fromEntries(Object.entries(brand).map(([k, v]) => [k, toHex(v)])) as Record<keyof BrandTokens, string>;
  const err = toHex(drc.severityError);
  const warn = toHex(drc.severityWarning);
  const info = toHex(drc.severityInfo);
  const ok = toHex(drc.severityOk);
  const orange = c.primary;
  const onOrange = dark ? "#ffffff" : c.primaryForeground;
  const hoverOrange = mixHex(orange, dark ? "#ffffff" : "#000000", 0.12);
  // surfaces: the editor on Alpha's background, the bars on its sidebar, widgets on its popover
  const editor = c.background;
  const bars = c.sidebar;
  const widget = c.popover;
  const line = c.border;
  const fg = c.foreground;
  const muted = c.mutedForeground;
  const select = withAlpha(orange, dark ? 0.28 : 0.2);
  const hover = dark ? mixHex(bars, "#ffffff", 0.05) : mixHex(bars, "#000000", 0.05);
  const listActive = c.accent;
  const s = SYNTAX[scheme];
  const x = (v: string) => toHex(v);
  // the orange as text: the brand orange on dark surfaces; on light ones a deeper step of it, so it reads
  const ink = dark ? orange : x(s.keyword);
  const colors: Record<string, string> = {
    // base
    focusBorder: withAlpha(orange, 0.8),
    foreground: fg,
    descriptionForeground: muted,
    disabledForeground: withAlpha(muted, 0.6),
    errorForeground: err,
    "icon.foreground": dark ? mixHex(fg, bars, 0.15) : mixHex(fg, bars, 0.1),
    "widget.border": line,
    "widget.shadow": dark ? "#00000066" : "#0000001f",
    "selection.background": select,
    "sash.hoverBorder": orange,
    "textLink.foreground": ink,
    "textLink.activeForeground": dark ? hoverOrange : mixHex(ink, "#000000", 0.15),
    "textPreformat.foreground": ink,
    "textPreformat.background": withAlpha(c.muted, 0.6),
    "textBlockQuote.background": c.card,
    "textBlockQuote.border": orange,
    "textCodeBlock.background": c.card,
    "textSeparator.foreground": line,
    // window chrome
    "titleBar.activeBackground": bars,
    "titleBar.activeForeground": fg,
    "titleBar.inactiveBackground": bars,
    "titleBar.inactiveForeground": muted,
    "titleBar.border": line,
    "activityBar.background": bars,
    "activityBar.foreground": fg,
    "activityBar.inactiveForeground": muted,
    "activityBar.activeBorder": orange,
    "activityBar.activeBackground": withAlpha(orange, 0.08),
    "activityBar.border": line,
    "activityBarBadge.background": orange,
    "activityBarBadge.foreground": onOrange,
    "activityBarTop.foreground": fg,
    "activityBarTop.activeBorder": orange,
    "activityBarTop.inactiveForeground": muted,
    "sideBar.background": bars,
    "sideBar.foreground": fg,
    "sideBar.border": line,
    "sideBarTitle.foreground": fg,
    "sideBarSectionHeader.background": bars,
    "sideBarSectionHeader.foreground": fg,
    "sideBarSectionHeader.border": line,
    "panel.background": bars,
    "panel.border": line,
    "panelTitle.activeBorder": orange,
    "panelTitle.activeForeground": fg,
    "panelTitle.inactiveForeground": muted,
    "panelSection.border": line,
    "panelSectionHeader.background": bars,
    "statusBar.background": orange,
    "statusBar.foreground": onOrange,
    "statusBar.border": orange,
    "statusBar.noFolderBackground": orange,
    "statusBar.noFolderForeground": onOrange,
    "statusBar.debuggingBackground": dark ? mixHex(orange, "#000000", 0.25) : mixHex(orange, "#000000", 0.2),
    "statusBar.debuggingForeground": "#ffffff",
    "statusBarItem.hoverBackground": withAlpha(dark ? "#ffffff" : "#000000", 0.14),
    "statusBarItem.activeBackground": withAlpha(dark ? "#ffffff" : "#000000", 0.22),
    "statusBarItem.remoteBackground": mixHex(orange, "#000000", 0.18),
    "statusBarItem.remoteForeground": "#ffffff",
    "statusBarItem.prominentBackground": withAlpha("#000000", 0.2),
    "statusBarItem.errorBackground": mixHex(err, "#000000", 0.15),
    "statusBarItem.errorForeground": "#ffffff",
    "statusBarItem.warningBackground": mixHex(warn, "#000000", 0.3),
    "statusBarItem.warningForeground": "#ffffff",
    "badge.background": orange,
    "badge.foreground": onOrange,
    "progressBar.background": orange,
    // editor groups and tabs
    "editorGroupHeader.tabsBackground": bars,
    "editorGroupHeader.tabsBorder": line,
    "editorGroupHeader.noTabsBackground": editor,
    "editorGroup.border": line,
    "editorGroup.dropBackground": withAlpha(orange, 0.12),
    "tab.activeBackground": editor,
    "tab.activeForeground": fg,
    "tab.activeBorderTop": orange,
    "tab.border": line,
    "tab.inactiveBackground": bars,
    "tab.inactiveForeground": muted,
    "tab.hoverBackground": hover,
    "tab.unfocusedActiveBorderTop": withAlpha(orange, 0.45),
    "tab.unfocusedActiveForeground": mixHex(fg, editor, 0.25),
    "tab.unfocusedInactiveForeground": withAlpha(muted, 0.8),
    "tab.lastPinnedBorder": line,
    "breadcrumb.foreground": muted,
    "breadcrumb.focusForeground": fg,
    "breadcrumb.activeSelectionForeground": fg,
    "breadcrumb.background": editor,
    // editor
    "editor.background": editor,
    "editor.foreground": fg,
    "editorLineNumber.foreground": withAlpha(muted, 0.6),
    "editorLineNumber.activeForeground": fg,
    "editorCursor.foreground": orange,
    "editor.selectionBackground": select,
    "editor.inactiveSelectionBackground": withAlpha(orange, dark ? 0.14 : 0.1),
    "editor.selectionHighlightBackground": withAlpha(orange, dark ? 0.14 : 0.1),
    "editor.wordHighlightBackground": withAlpha(fg, 0.1),
    "editor.wordHighlightStrongBackground": withAlpha(orange, 0.18),
    "editor.findMatchBackground": withAlpha(orange, 0.45),
    "editor.findMatchHighlightBackground": withAlpha(orange, 0.2),
    "editor.lineHighlightBackground": withAlpha(fg, dark ? 0.04 : 0.035),
    "editor.lineHighlightBorder": "#00000000",
    "editorIndentGuide.background1": withAlpha(line, 0.8),
    "editorIndentGuide.activeBackground1": mixHex(line, fg, 0.3),
    "editorWhitespace.foreground": withAlpha(muted, 0.3),
    "editorRuler.foreground": line,
    "editorBracketMatch.background": withAlpha(orange, 0.15),
    "editorBracketMatch.border": withAlpha(orange, 0.6),
    "editorLink.activeForeground": ink,
    "editorError.foreground": err,
    "editorWarning.foreground": warn,
    "editorInfo.foreground": info,
    "editorHint.foreground": muted,
    "editorGutter.addedBackground": ok,
    "editorGutter.modifiedBackground": info,
    "editorGutter.deletedBackground": err,
    "editorOverviewRuler.border": line,
    "editorOverviewRuler.errorForeground": err,
    "editorOverviewRuler.warningForeground": warn,
    "editorOverviewRuler.infoForeground": info,
    "editorWidget.background": widget,
    "editorWidget.foreground": fg,
    "editorWidget.border": line,
    "editorSuggestWidget.background": widget,
    "editorSuggestWidget.border": line,
    "editorSuggestWidget.selectedBackground": listActive,
    "editorSuggestWidget.highlightForeground": ink,
    "editorHoverWidget.background": widget,
    "editorHoverWidget.border": line,
    "editorStickyScroll.background": editor,
    "editorStickyScrollHover.background": hover,
    "peekView.border": orange,
    "peekViewEditor.background": c.card,
    "peekViewResult.background": bars,
    "peekViewTitle.background": bars,
    "minimap.selectionHighlight": withAlpha(orange, 0.5),
    "scrollbar.shadow": dark ? "#00000055" : "#00000018",
    "scrollbarSlider.background": withAlpha(muted, 0.22),
    "scrollbarSlider.hoverBackground": withAlpha(muted, 0.36),
    "scrollbarSlider.activeBackground": withAlpha(orange, 0.5),
    // lists, inputs, buttons
    "list.activeSelectionBackground": listActive,
    "list.activeSelectionForeground": fg,
    "list.inactiveSelectionBackground": withAlpha(listActive, 0.7),
    "list.hoverBackground": hover,
    "list.focusOutline": withAlpha(orange, 0.7),
    "list.highlightForeground": ink,
    "list.errorForeground": err,
    // text, not a mark: the DRC yellow is unreadable as words on the light theme's gray (1.4:1), so they are darkened there
    "list.warningForeground": dark ? warn : mixHex(warn, "#000000", 0.5),
    "tree.indentGuidesStroke": line,
    "input.background": c.input,
    "input.foreground": fg,
    "input.border": line,
    "input.placeholderForeground": withAlpha(muted, 0.8),
    "inputOption.activeBackground": withAlpha(orange, 0.2),
    "inputOption.activeBorder": withAlpha(orange, 0.7),
    "inputOption.activeForeground": fg,
    "inputValidation.errorBorder": err,
    "inputValidation.warningBorder": warn,
    "inputValidation.infoBorder": info,
    "dropdown.background": c.input,
    "dropdown.foreground": fg,
    "dropdown.border": line,
    "dropdown.listBackground": widget,
    "checkbox.background": c.input,
    "checkbox.border": line,
    "button.background": orange,
    "button.foreground": onOrange,
    "button.hoverBackground": hoverOrange,
    "button.border": "#00000000",
    "button.secondaryBackground": c.secondary,
    "button.secondaryForeground": fg,
    "button.secondaryHoverBackground": dark ? mixHex(c.secondary, "#ffffff", 0.06) : mixHex(c.secondary, "#000000", 0.06),
    "toolbar.hoverBackground": withAlpha(fg, dark ? 0.08 : 0.07),
    "toolbar.activeBackground": withAlpha(fg, dark ? 0.12 : 0.1),
    "menu.background": widget,
    "menu.foreground": fg,
    "menu.border": line,
    "menu.selectionBackground": listActive,
    "menu.selectionForeground": fg,
    "menu.separatorBackground": line,
    "quickInput.background": widget,
    "quickInputList.focusBackground": listActive,
    "quickInputList.focusForeground": fg,
    "pickerGroup.foreground": ink,
    "pickerGroup.border": line,
    "keybindingLabel.background": c.muted,
    "keybindingLabel.foreground": fg,
    "keybindingLabel.border": line,
    "keybindingLabel.bottomBorder": line,
    "notifications.background": widget,
    "notifications.border": line,
    "notificationCenterHeader.background": bars,
    "notificationLink.foreground": ink,
    "notificationsErrorIcon.foreground": err,
    "notificationsWarningIcon.foreground": warn,
    "notificationsInfoIcon.foreground": info,
    "problemsErrorIcon.foreground": err,
    "problemsWarningIcon.foreground": warn,
    "problemsInfoIcon.foreground": info,
    "testing.iconPassed": ok,
    "testing.iconFailed": err,
    "charts.red": err,
    "charts.yellow": warn,
    "charts.blue": info,
    "charts.green": ok,
    "charts.orange": orange,
    "charts.purple": dark ? "#a78bfa" : "#7c3aed",
    "charts.foreground": fg,
    "charts.lines": line,
    "debugToolBar.background": widget,
    "gitDecoration.addedResourceForeground": ok,
    "gitDecoration.untrackedResourceForeground": ok,
    "gitDecoration.modifiedResourceForeground": dark ? "#e2c08d" : "#895503",
    "gitDecoration.deletedResourceForeground": err,
    "gitDecoration.conflictingResourceForeground": orange,
    "gitDecoration.ignoredResourceForeground": withAlpha(muted, 0.7),
    "diffEditor.insertedTextBackground": withAlpha(ok, 0.16),
    "diffEditor.removedTextBackground": withAlpha(err, 0.16),
    "welcomePage.tileBackground": c.card,
    "walkThrough.embeddedEditorBackground": c.card,
    "settings.headerForeground": fg,
    "settings.modifiedItemIndicator": orange,
    "terminal.background": bars,
    "terminal.foreground": fg,
    "terminalCursor.foreground": orange,
    "terminal.selectionBackground": select,
    "terminal.ansiBlack": dark ? "#2b2b2b" : "#3a3a3a",
    "terminal.ansiRed": err,
    "terminal.ansiGreen": dark ? "#4ade80" : "#16a34a",
    "terminal.ansiYellow": dark ? "#facc15" : "#a16207",
    "terminal.ansiBlue": dark ? "#60a5fa" : "#2563eb",
    "terminal.ansiMagenta": dark ? "#c084fc" : "#9333ea",
    "terminal.ansiCyan": dark ? "#22d3ee" : "#0891b2",
    "terminal.ansiWhite": dark ? "#d4d4d4" : "#737373",
    "terminal.ansiBrightBlack": dark ? "#737373" : "#525252",
    "terminal.ansiBrightRed": dark ? "#f87171" : "#ef4444",
    "terminal.ansiBrightGreen": dark ? "#86efac" : "#22c55e",
    "terminal.ansiBrightYellow": dark ? "#fde047" : "#ca8a04",
    "terminal.ansiBrightBlue": dark ? "#93c5fd" : "#3b82f6",
    "terminal.ansiBrightMagenta": dark ? "#d8b4fe" : "#a855f7",
    "terminal.ansiBrightCyan": dark ? "#67e8f9" : "#06b6d4",
    "terminal.ansiBrightWhite": dark ? "#fafafa" : "#262626",
  };
  const tokenColors: ColorTheme["tokenColors"] = [
    { name: "Comments", scope: ["comment", "punctuation.definition.comment"], settings: { foreground: x(s.comment), fontStyle: "italic" } },
    { name: "Keywords", scope: ["keyword", "keyword.control", "keyword.operator.new", "keyword.operator.expression", "keyword.other"], settings: { foreground: x(s.keyword) } },
    { name: "Operators", scope: ["keyword.operator"], settings: { foreground: x(s.variable) } },
    { name: "Storage", scope: ["storage", "storage.type", "storage.modifier"], settings: { foreground: x(s.storage) } },
    { name: "Strings", scope: ["string", "string.template", "punctuation.definition.string"], settings: { foreground: x(s.string) } },
    { name: "Escapes", scope: ["constant.character.escape"], settings: { foreground: x(s.regexp) } },
    { name: "Regular expressions", scope: ["string.regexp"], settings: { foreground: x(s.regexp) } },
    { name: "Numbers", scope: ["constant.numeric", "keyword.other.unit"], settings: { foreground: x(s.number) } },
    { name: "Constants", scope: ["constant.language", "constant.other", "variable.other.constant", "support.constant", "variable.other.enummember"], settings: { foreground: x(s.constant) } },
    { name: "Functions", scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function", "variable.function"], settings: { foreground: x(s.func) } },
    { name: "Types", scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class", "storage.type.class"], settings: { foreground: x(s.type) } },
    { name: "Variables", scope: ["variable", "variable.other.readwrite", "meta.definition.variable"], settings: { foreground: x(s.variable) } },
    { name: "Parameters", scope: ["variable.parameter"], settings: { foreground: x(s.parameter) } },
    { name: "Properties", scope: ["variable.other.property", "variable.other.object.property", "support.variable.property", "meta.object-literal.key", "support.type.property-name"], settings: { foreground: x(s.property) } },
    { name: "Tags", scope: ["entity.name.tag", "punctuation.definition.tag"], settings: { foreground: x(s.tag) } },
    { name: "Attributes", scope: ["entity.other.attribute-name"], settings: { foreground: x(s.attribute) } },
    { name: "Markup headings", scope: ["markup.heading", "entity.name.section"], settings: { foreground: ink, fontStyle: "bold" } },
    { name: "Markup emphasis", scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { name: "Markup strong", scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { name: "Markup links", scope: ["markup.underline.link", "string.other.link"], settings: { foreground: ink } },
    { name: "Markup code", scope: ["markup.inline.raw", "markup.fenced_code"], settings: { foreground: x(s.string) } },
    { name: "Inserted", scope: ["markup.inserted"], settings: { foreground: x(s.string) } },
    { name: "Deleted", scope: ["markup.deleted"], settings: { foreground: x(s.invalid) } },
    { name: "Changed", scope: ["markup.changed"], settings: { foreground: x(s.number) } },
    { name: "Invalid", scope: ["invalid", "invalid.illegal"], settings: { foreground: x(s.invalid) } },
  ];
  const semanticTokenColors: ColorTheme["semanticTokenColors"] = {
    namespace: x(s.type),
    class: x(s.type),
    interface: x(s.type),
    enum: x(s.type),
    type: x(s.type),
    typeParameter: x(s.type),
    function: x(s.func),
    method: x(s.func),
    parameter: x(s.parameter),
    property: x(s.property),
    enumMember: x(s.constant),
    variable: x(s.variable),
    "variable.readonly": x(s.constant),
    "property.readonly": x(s.property),
    keyword: x(s.keyword),
    string: x(s.string),
    number: x(s.number),
    regexp: x(s.regexp),
    comment: { foreground: x(s.comment), italic: true },
  };
  return {
    $schema: "vscode://schemas/color-theme",
    name: dark ? "Protoboard Dark" : "Protoboard Light",
    type: scheme,
    semanticHighlighting: true,
    colors,
    tokenColors,
    semanticTokenColors,
  };
}

/** The themes' file names under themes/. */
export const THEME_FILES = { dark: "protoboard-dark-color-theme.json", light: "protoboard-light-color-theme.json" } as const;

/** A theme file's text, as written. */
export const themeJson = (theme: ColorTheme): string => `${JSON.stringify(theme, null, 2)}\n`;
