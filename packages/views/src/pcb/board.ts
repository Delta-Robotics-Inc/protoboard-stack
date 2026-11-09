/**
 * The board core's browser-safe parts, in one place. The renderer and the layout screen run in a browser, so they
 * import the board package's pure modules (document, geometry, units, schema) and never its index, which pulls in
 * the file format, the journal and the service (Node's fs and path). When @protoboardai/board exports these
 * modules as subpaths, only this file changes.
 */
export { copperLayers, netClassOf, parsePadId, padKeys, padId, footprintKey, recordsOfKind, type BoardDocument, type NetInfo } from "../../../board/src/document.js";
export { arcCenter, boundsOf, footprintToWorld, layersOf, padsOf, rotatePoint, sideLayer, viaLayers, type Box, type WorldPad } from "../../../board/src/geometry.js";
export { mm, toMm, toDeg, deg, normAngle } from "../../../board/src/units.js";
export { COPPER_LAYERS, DRAWING_LAYERS } from "../../../board/src/schema.js";
export type {
  AnyLayer,
  BoardRecord,
  CopperLayer,
  FootprintGraphic,
  FootprintRec,
  FootprintText,
  GraphicRec,
  KeepoutRec,
  OutlineRec,
  CutoutRec,
  Pad,
  Point,
  Provenance,
  RuleRec,
  NetclassRec,
  TextRec,
  TrackRec,
  Vertex,
  ViaRec,
  ZoneRec,
} from "../../../board/src/schema.js";
export type { BoardQuery, IndexItem } from "../../../board/src/index-spatial.js";
export type { BoardEvent, BoardSnapshot } from "../../../board/src/service.js";
export type { LogEntry, Presence } from "../../../board/src/transaction.js";
export type { Actor } from "../../../board/src/ops/registry.js";
export type { Finding } from "../../../board/src/extensions.js";
