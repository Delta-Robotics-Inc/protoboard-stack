/**
 * @protoboardai/views: Protoboard's views as components, the registry the
 * shells' view tabs come from, and the host and theme adapter interfaces
 * (docs/specs/viewer-stack.md). Shells: @protoboardai/web-viewer (browser,
 * `protoboard dev`) and packages/vscode-protoboard.
 */
export type { HostAdapter, Theme, ThemeAdapter, ViewDefinition, ViewProps, ViewStatus, ViewTarget } from "./types.js";
export { NULL_HOST } from "./types.js";
export { ViewRegistry, registerContributedViews } from "./registry.js";
export { appliesFromDecl, definition, fileName, hasArtifact, hasFile, subtree } from "./applies.js";
export { BUILTIN_TABS, tabsFor, type TabRule } from "./tabs.js";
export { AssemblyView, BUILTIN_VIEWS, DiagramView, MissingPartsHint, PlannedView, createViewRegistry } from "./builtins.js";
export { BoardDrawingView, PcbView, SchematicView } from "./drawing/BoardDrawingView.js";
export { themeSvg, canonicalColour, type Palette, type ThemedSvg } from "./drawing/svg.js";
export { PCB_PALETTE, SCHEMATIC_PALETTE, DRAWING_CSS } from "./drawing/palettes.js";
export { boardsWith, type BoardAt } from "./drawing/boards.js";
export { PairView } from "./pair/PairView.js";
export { CUSTOM_ICONS, SCHEMATIC_ICON, ViewIcon, customIconSvg } from "./icons.js";
export { pairsOf, findPair, censusOf, potentialsOf, type Pair, type PairLink, type PairSide, type CensusEntry } from "./pair/model.js";
export {
  PROTOBOARD_THEMES,
  THEME_CHOICES,
  protoboardDark,
  protoboardLight,
  protoboardThemeAdapter,
  themeAdapterFor,
  themeChoiceOf,
  vscodeThemeAdapter,
  defaultThemeAdapter,
  staticTheme,
  type ThemeChoice,
} from "./theme.js";
export * from "./parts/index.js";
export * from "./inspector/index.js";
