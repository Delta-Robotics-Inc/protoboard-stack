/**
 * @protoboardai/symbols: the schematic symbol and component icon pack, its format, checker, renderer and the
 * generator for code-built symbols. STYLE.md is the rule book; README.md says how to use and extend the pack.
 *
 * Browser-safe exports only (the pack's files are read by `./pack`, which needs Node).
 */
export * from "./types.ts";
export { formatSymbol } from "./format.ts";
export { checkSymbol, formatFindings, type Finding, type CheckOptions } from "./check.ts";
export { elementSvg, formOf, iconForm, iconInner, iconSvg, schematicSvg, type SchematicOptions } from "./render.ts";
export * from "./generate/box.ts";
export * from "./generate/families.ts";
