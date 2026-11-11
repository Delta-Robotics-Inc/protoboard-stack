<!--
Refresh (from the stack root), after any change to these files in docs/reference/:
  for f in display.md viewer-bridge.md render-service.md view-tools.md transfer-limits.json; do cp docs/reference/$f packages/core/reference/$f; done
(PowerShell: foreach ($f in 'display.md','viewer-bridge.md','render-service.md','view-tools.md','transfer-limits.json') { Copy-Item docs/reference/$f packages/core/reference/$f })
A test (packages/core/test/shipped-reference.test.ts) fails while any copy differs from its source.
-->
# Shipped reference

Byte-identical copies of the stack's `docs/reference/` files that an
installed project needs, published with `@protoboardai/core` so they resolve
at `node_modules/@protoboardai/core/reference/<file>`:

- `display.md`: the display file (`.protoboard/display.json`) format.
- `viewer-bridge.md`: the viewer bridge contract.
- `render-service.md`: the headless render service.
- `view-tools.md`: the agent's view tools over MCP (observe, select, highlight,
  isolate, camera, callout, mark, arrow, explode, capture, undo, leases).
- `transfer-limits.json`: the image transfer limits the render service reads
  (this copy first, then the checkout's `docs/reference/`, then the built-in
  values in `src/render-service/limits.ts`).

`docs/reference/` is the source; never edit these copies by hand.
