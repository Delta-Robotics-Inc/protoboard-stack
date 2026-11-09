/**
 * The PCB editor's board renderer and layout screen (Phase 1): a read-only client of the board service
 * (@protoboardai/board). Browser code; the headless render path is Node code in ./headless/render.ts.
 */
export { LayoutScreen, type LayoutScreenProps } from "./LayoutScreen.js";
export { BoardCanvas, type BoardCanvasProps, type Tool } from "./BoardCanvas.js";
export { BoardView, type BoardViewOptions } from "./boardview.js";
export { BoardRenderer, type RendererState, type RendererStats } from "./renderer.js";
export { buildScene, updateScene, setFills, setRatsnest, type Scene, type SceneObject, type SceneItem } from "./scene.js";
export { SceneBuffers } from "./buffers.js";
export { pickAt, pickBox, RANK, type Hit, type PickContext } from "./pick.js";
export { inspect, classTargets, fmtMm, type Inspection, type Field } from "./inspect.js";
export { drawLayers, drawOrder, layerGroups, presetGroups, defaultGroups, PRESETS, type PresetId, type DrawLayerId } from "./layers.js";
export { fitRect, toScreen, toWorld, zoomAbout, panBy, type View, type Insets } from "./view.js";
export { EditSession, outcomeOf, newBatchId, type Outcome, type RequestFn, type SessionStatus } from "./edit/session.js";
export { buildQueue, exportState, type QueueItem, type QueueGroup } from "./review.js";
export { parseBoardRequest } from "./requests.js";
export type { BoardSource, RatsnestPair, PcbFinding, ZoneFill, CheckSummary, DepthView, BoardRequest, BoardReplyMessage, ProposalView, DiagnosisView, RouterInfo } from "./types.js";
