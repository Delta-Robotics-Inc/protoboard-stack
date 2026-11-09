/**
 * @protoboardai/board: the headless board core of the PCB editor. The contract is
 * docs/specs/pcb-editor/phase1-board-core.md.
 */
export * from "./units.js";
export * from "./schema.js";
export { byCodeUnit, canonical, canonicalRecord, deepFreeze, sameValue, sha1Hex, sha256Hex } from "./canonical.js";
export * from "./document.js";
export * from "./geometry.js";
export * from "./ops/index.js";
export * from "./editing-types.js";
export * from "./proposals.js";
export * from "./copper-geom.js";
export * from "./edit-plan.js";
export { readDxf, dxfOutline, joinEdges, bulgeToSweep, DxfError, type DxfRead, type DxfReadOptions, type DxfOutline, type DxfOutlineOptions, type DxfOutlineReport, type DxfSkipped, type DxfUnits } from "./dxf.js";
export * from "./leases.js";
export * from "./transaction.js";
export * from "./journal.js";
export * from "./format.js";
export * from "./index-spatial.js";
export * from "./service.js";
export * from "./derived.js";
export * from "./extensions.js";
export { deterministicKey } from "./keys.js";
// the wire protocol's shapes are browser-safe; the WebSocket server and client are Node only: `@protoboardai/board/node`
export * from "./transport/protocol.js";
export { toJsonSchema, type JsonSchema } from "./transport/json-schema.js";
