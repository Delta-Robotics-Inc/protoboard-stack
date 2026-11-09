/**
 * @protoboardai/schematic/node: the whole schematic core for Node, with the wire transport (contract section 10,
 * after the board core's): the WebSocket server (`serveSchematic`) and the client that finds a schematic's live
 * service or opens the schematic itself (`connectSchematic`), plus `localClient` over a service in this process.
 * The client uses Node's built-in WebSocket; the protocol's shapes (`transport/protocol.ts`) import nothing of Node.
 */
export * from "./index.ts";
export * from "./transport/index.ts";
