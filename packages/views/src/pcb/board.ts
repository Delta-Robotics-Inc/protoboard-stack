/**
 * The board core's browser-safe parts, in one place: `@protoboardai/board/browser`. The renderer and the layout
 * screen run in a browser, so they never import the package's index (the file format, the journal, the service and
 * the Node WebSocket client).
 */
export { copperLayers, netClassOf, parsePadId, padKeys, padId, footprintKey, recordsOfKind, createDocument, withChanges, type BoardDocument, type NetInfo } from "@protoboardai/board/browser";
export { arcCenter, boundsOf, footprintToWorld, layersOf, padsOf, rotatePoint, sideLayer, viaLayers, type Box, type WorldPad } from "@protoboardai/board/browser";
export { mm, toMm, toDeg, deg, normAngle } from "@protoboardai/board/browser";
export { COPPER_LAYERS, DRAWING_LAYERS } from "@protoboardai/board/browser";
export { BoardIndex, snapshotFromWire } from "@protoboardai/board/browser";
export type {
  AnyLayer,
  BoardRecord,
  CopperLayer,
  FootprintGraphic,
  FootprintRec,
  FootprintText,
  GraphicRec,
  KeepoutRec,
  Netlist,
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
} from "@protoboardai/board/browser";
export type { BoardQuery, IndexItem } from "@protoboardai/board/browser";
export type { BoardEvent, BoardSnapshot } from "@protoboardai/board/browser";
export type { LogEntry, Presence } from "@protoboardai/board/browser";
export type { Actor } from "@protoboardai/board/browser";
export type { Finding, BoardConnectivity } from "@protoboardai/board/browser";
export type { WireSnapshot } from "@protoboardai/board/browser";
export type { DerivedZoneFill, ZoneFillEntry, ZoneFillPolygon } from "@protoboardai/board/browser";
