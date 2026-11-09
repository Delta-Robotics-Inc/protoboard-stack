/**
 * @protoboardai/board/browser: the parts of the board core that run in a page. A renderer, the layout screen or a
 * browser-side client imports these and never the package's index, which also carries the file format, the
 * journal, the service and the wire transport (Node's fs, path, http and Node's own WebSocket client).
 *
 * Nothing here touches files or sockets. The modules still hash with `node:crypto`'s `createHash` (ids, input
 * hashes), so a browser bundle maps `node:crypto` to a small SHA implementation (the views package's bundles do).
 * Types of the Node-only modules (the service's snapshot and events, derived zone fill) are exported as types only.
 */
export * from "./units.js";
export * from "./schema.js";
export { byCodeUnit, canonical, canonicalRecord, deepFreeze, sameValue, sha1Hex, sha256Hex } from "./canonical.js";
export * from "./document.js";
export * from "./geometry.js";
export * from "./ops/index.js";
export * from "./leases.js";
export * from "./transaction.js";
export * from "./index-spatial.js";
export * from "./extensions.js";
export { deterministicKey } from "./keys.js";
export * from "./transport/protocol.js";
export { toJsonSchema, type JsonSchema } from "./transport/json-schema.js";
export type { BoardEvent, BoardSnapshot, BoardService, BoardServiceOptions, CheckpointResult, SaveResult } from "./service.js";
export type { DerivedZoneFill, ZoneFillEntry, ZoneFillPolygon, ZoneFillSource } from "./derived.js";
