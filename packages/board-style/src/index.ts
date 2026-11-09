/**
 * @protoboardai/board-style: a design system for printed circuit boards. Typed style tokens in four classes (fab,
 * electrical, placement, cosmetic) with guard rails, shipped themes and a cascade (shipped, user, project, board),
 * tools that draw the theme through the board core's operations and return change sets to propose, a style check that
 * never blocks, and a decisions log that grows when the user corrects the agent. See README.md.
 */
export * from "./tokens.js";
export * from "./fab.js";
export { parseTheme, parseLayer, serializeTheme, serializeLayer, shippedTheme, shippedThemeIds, themeChain, ThemeFormatError, THEME_SCHEMA, LAYER_SCHEMA, DEFAULT_THEME, SHIPPED_THEMES_DIR, type ThemeFile, type LayerFile } from "./theme.js";
export { resolveStyle, explainToken, tok, tokNum, tokText, type ResolvedStyle, type ResolvedToken, type ResolveOptions, type TokenExplanation, type LayerName } from "./resolve.js";
export { tokenGuards, boardGuards, type GuardResult, type Clamp } from "./guards.js";
export { stylePlaces, userStyleDir, projectStyleDir, boardStyleFile, type Scope, type StylePlaces } from "./paths.js";
export {
  STYLE_TOOLS,
  RESTYLE_ORDER,
  STYLE_HOST,
  HIDDEN_MARK,
  styleProvenance,
  toolTag,
  madeBy,
  reconcile,
  removeStyle,
  applyStyleChange,
  proposeStyleChange,
  scratchService,
  type StyleTool,
  type StyleChangeSet,
  type Skipped,
  type Desired,
} from "./changeset.js";
export { planRestyle, runStyleTool, type RestyleOptions } from "./restyle.js";
export { styleFrames, type FramesOptions } from "./tools/frames.js";
export { styleDesignators, wantedDesignators, type DesignatorOptions } from "./tools/designators.js";
export { styleNameplate, type NameplateOptions } from "./tools/nameplate.js";
export { styleHazard, hazardKindOf, type HazardOptions } from "./tools/hazard.js";
export { styleEdgeText, edgeTextActive, outlineIsRound, type EdgeTextOptions } from "./tools/edge-text.js";
export { styleMarks, type MarksOptions } from "./tools/marks.js";
export { alignParts, type AlignOptions, type AlignMove } from "./tools/align.js";
export { checkStyle, type StyleCheckResult, type StyleCheckOptions, type StyleCategory, type FabRecord } from "./check.js";
export { recordDecision, listDecisions, readDecisions, promotionCandidates, promoteDecision, registerProject, decisionsMarkdown, layerFileOf, DECISION_SCHEMA, type Decision, type ListedDecision, type TokenChange, type RecordDecisionInput, type RecordDecisionResult, type PromotionCandidate } from "./decisions.js";
export { styleGuide, writeStyleGuide } from "./guide.js";
export { readExamples, indexExamples, searchExamples, exampleDirs, parseCaption, EXAMPLES_SCHEMA, type Example, type ExampleHit } from "./examples.js";
export { loadAssets, readAsset, registerAsset, readRegistry, assetUsable, SHIPPED_ASSETS_DIR, ASSET_SCHEMA, REGISTRY_SCHEMA, type AssetEntry, type AssetFile, type LoadedAsset, type Registry, type AssetStatus } from "./assets.js";
export { renderAsBuilt, renderPng, type RenderOptions } from "./render.js";
export { applyCorrection, type CorrectionContext, type CorrectionResult } from "./correction.js";
export { STYLE_API, styleApiTool, type StyleApiTool, type StyleApiContext } from "./api.js";
