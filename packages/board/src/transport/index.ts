/** The board service's wire transport (contract section 10): JSON-RPC 2.0 over WebSocket on 127.0.0.1. */
export * from "./protocol.js";
export { serveBoard, isLoopback, type BoardServer, type ExtensionMethod, type ServeOptions } from "./server.js";
export { connectBoard, findService, localClient, serviceFileFor, wireClient, type BoardClient, type ConnectOptions, type OperationsResult } from "./client.js";
export { toJsonSchema, type JsonSchema } from "./json-schema.js";
export { CLOSE, refuseUpgrade, upgradeProblem, WsConnection, type WsConnectionOptions } from "./ws.js";
