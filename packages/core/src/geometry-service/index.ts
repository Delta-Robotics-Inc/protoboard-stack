/**
 * The exact measurement tier (PB-1187): a per-project build123d worker the
 * CLI and the viewer's host ask over JSON lines, answering the same
 * `MeasureResult` the viewer's mesh tier gives, with `tier: "exact"`.
 */
export * from "./protocol.js";
export { MAX_STEP_BYTES, RESOLVED_FILE, inside, resolvePartStep, type PartStep } from "./resolve.js";
export { GEOMETRY_LIMITS, GeometryService, cadPythonFor, closeGeometryServices, geometryScript, geometryService, type GeometryServiceOptions, type WorkerInfo } from "./service.js";
