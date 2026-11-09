/** The schematic service's wire transport: JSON-RPC 2.0 over WebSocket on 127.0.0.1 (Node only, but for protocol.ts). */
export * from "./protocol.ts";
export { callSchematicService } from "./dispatch.ts";
export { serveSchematic, type SchematicExtensionMethod, type SchematicServeOptions, type SchematicServer } from "./server.ts";
export { connectSchematic, findSchematicService, localClient, schematicServiceFileFor, schematicWireClient, type ConnectSchematicOptions, type SchematicClient, type SchematicOperationsResult } from "./client.ts";
