/**
 * @protoboardai/schematic: the headless schematic core of the PCB editor. The contract is
 * docs/specs/pcb-editor/phase3-schematic-core.md. The circuit from UHD is `@protoboardai/schematic/uhd`.
 */
export * from "./units.ts";
export * from "./circuit.ts";
export * from "./schema.ts";
export * from "./document.ts";
export * from "./symbols.ts";
export * from "./geometry.ts";
export * from "./ops/index.ts";
export * from "./engine.ts";
export * from "./format.ts";
export * from "./service.ts";
export { layoutSchematic, assignRefs, cardTitle, CARD_MARGIN, TITLE_BAND, DEFAULT_SETTINGS, type LayoutOptions, type LayoutResult } from "./layout/index.ts";
export { classify, cardKeyOf, type Classification, type PartInfo, type SatelliteRole } from "./layout/classify.ts";
export { Grid, routeNet, COST, type Terminal, type RouteResult } from "./layout/route.ts";
export * from "./score.ts";
export * from "./checks.ts";
export * from "./scene.ts";
export * from "./render/svg.ts";
export { svgToPng } from "@protoboardai/board-scene";
export * from "./export/kicad.ts";
