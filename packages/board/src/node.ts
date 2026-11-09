/**
 * @protoboardai/board/node: the whole board core for Node, with the wire transport (contract section 10): the
 * WebSocket server (`serveBoard`) and the client that finds a board's live service or opens the board itself
 * (`connectBoard`). The client uses Node's built-in WebSocket with an Authorization header, which a browser's
 * WebSocket cannot send, so it lives here and not in the package's index (a browser-targeted project type-checks
 * the index; see ./browser.ts for what runs in a page).
 */
export * from "./index.js";
export * from "./transport/index.js";
