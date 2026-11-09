# @protoboardai/board-edit

The editing kernel of Protoboard's PCB editor: what a person or an agent needs to finish the last mile of a board by
hand. The contract is `docs/specs/pcb-editor/phase2-editing.md` in the Protoboard Stack repository.

- `@protoboardai/board-edit` (browser-safe, imports only `@protoboardai/board/browser`): `createEditKernel(snapshot)`
  and its sessions. A **route session** plans the head to each cursor position in walk-around mode (direct 45 and 90
  degree postures first, then a time-budgeted grid search around other nets' copper, pulled taut and verified with
  exact geometry), snaps to copper of its net, places vias on legal spots, backs up, and finishes as one `track.route`
  call in a transaction refused when the neighborhood changed. Highlight mode draws straight and lists collisions. A
  **drag session** previews `footprint.move` with attached tracks or `track.drag` through the same planners the
  operations use, so the preview is the commit; track and via drags stop at the last legal position.
- `@protoboardai/board-edit/service` (Node): `attachLiveChecks(service)` rechecks and refills only what a commit
  touched and publishes the derived state; `diagnoseNet(snapshot, net)` asks `board-route` whether rules or placement
  keep a net open, within one time budget (default 8 s), routing only its open links (a net with a pour only where
  the fill does not reach) and cached by input hash; `proposeRouteResult(service, result)` stores router results as proposals; `attachEditing(service)`
  bundles them with the `board.diagnose` wire method for `serveBoard(service, { methods })`.

Nothing here writes a board. Sessions return operations; the board service applies them.
