/**
 * The System Map view (`@protoboardai/views/sysmap`): what the Protoboard
 * stack can do, drawn with the Atlas's renderer (docs/specs/system-map.md).
 */
export { SYSMAP_VIEW, SystemMapView, SystemMap, type SystemMapProps } from "./SystemMapView.js";
export { SysmapInspector, SysmapGroupCard, ItemRow, StatusGlyph } from "./SysmapInspector.js";
export * from "./model.js";
export { SysmapDataProvider, useSysmapData, type SysmapData, type SysmapPayload } from "./data.js";
