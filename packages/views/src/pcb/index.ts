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
export type { BoardSource, RatsnestPair, PcbFinding, ZoneFill, CheckSummary, DepthView } from "./types.js";
