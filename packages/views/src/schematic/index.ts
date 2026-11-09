/**
 * @protoboardai/views/schematic: the schematic screen (browser side). The host side (Node) is ./host.
 */
export { SchematicScreen, moveSegment, type SchematicScreenProps, type SchematicScreenApi } from "./SchematicScreen.js";
export { SchematicEditorView } from "./SchematicView.js";
export { SchematicCanvas, lodOf, LOD_STOPS, BASE_SCALE, segDist, type Hit, type Lod, type View, type DragPreview } from "./canvas.js";
export { SchematicSource, createEventStreamSchematicHost, openSchematicSource, type SchematicChannel, type SchematicHost, type SchematicEvent } from "./remote.js";
export { setKnownSchematics, knownSchematics, onKnownSchematics, schematicEditorApplies } from "./known.js";
export { parseSchematicRequest } from "./requests.js";
export { pinFacts, partFacts, netFacts, voltageText, CHIPS, type Chip, type Fact } from "./facts.js";
export { simplifyPath, reattach, orthogonal, orthogonalize, followPreview } from "./paths.js";
export type * from "./types.js";
