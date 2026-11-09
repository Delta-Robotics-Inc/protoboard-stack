/**
 * @protoboardai/views/schematic/host: the Node side of the schematic screen. A host process (the `protoboard dev`
 * server, the schematic dev page's server) is the schematic service's client and hands pages the drawn sheet and its
 * derived data as `SchematicFeedMessage`s. Node only; the page side is ../remote.ts.
 */
export { SchematicFeed, SCHEMATIC_PERSON, FIRST_OPEN, txLabel, type SchematicFeedOptions } from "./feed.js";
export { createSchematicRoutes, SCHEMATIC_ROUTE_PREFIX, type SchematicRoutes, type SchematicRoutesOptions, type SchematicSourceEntry } from "./routes.js";
export { modelOf, derivedOf, itemOf, itemsOf, partsOf, netsOf, plain } from "./model.js";
export { followCalls, gestureCalls, moveCalls, rotateCalls, mirrorCalls, fieldCalls, orthogonalize, reattach, simplifyPath, orthogonal } from "./gestures.js";
export { parseSchematicRequest } from "../requests.js";
export type * from "../types.js";
