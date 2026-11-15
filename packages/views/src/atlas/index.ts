/**
 * The Atlas view (`@protoboardai/views/atlas`): the project's artifacts as a
 * force-directed map, its data contract for the shells, and the pure
 * simulation, camera, renderer and time-lapse data it is built from.
 */
export { AtlasView, type PlaybackState } from "./AtlasView.js";
export { UI_DEFAULT, UI_KEY, parseUi, type AtlasUi } from "./settings.js";
export { ATLAS_KIND_TABLE, DEFAULT_APPEARANCE, SHAPE_PRESETS, defaultAppearance, SWATCH_TOKENS, isKindColor, kindColor, kindShape, lookOf, parseAppearance, presetOf, shapesOf, withKind, withPreset, type AtlasAppearance, type KindColor, type KindTable, type ShapePreset } from "./appearance.js";
export { Ease, HOVER, HoverIntent, easeShare } from "./hover.js";
export { AtlasInspector, AtlasGroupCard, AtlasPreview, fileLinkage, formatSize, operationName, previewSource, type AtlasInspectorProps, type InspectorNeighbor, type PreviewSource } from "./Inspector.js";
export { AtlasDataProvider, staleMessage, useAtlasData, type AtlasData, type AtlasLayout, type AtlasPayload, type PullBy } from "./data.js";
export { AtlasSimulation, BASE_RADIUS, DEGREE_SCALE, ROOT_MIN_R, SIM, degreeScale, graphShape, manyBody, nodeRadius, seedPosition, fnv1a, type Body, type Neighbor, type SimEdge, type SimNode, type SimOptions, type SimStart } from "./sim.js";
export { INERTIA, ZOOM, easeCamera, fitTo, fling, newCamera, panBy, snapCamera, stepCamera, stopCamera, toScreen, toWorld, wheelImpulse, wheelZoom, zoomBy, type Camera, type FitInsets } from "./camera.js";
export { DEFAULT_LOOK, HUB_DEGREE, KIND_ICON, KIND_STYLE, SHAPES, SURFACE_TOKENS, isHighContrast, isHub, nodeColor, paletteFrom, resolveColor, type AtlasLook, type AtlasPalette, type Shape } from "./palette.js";
export { DIM, FRAME_MS, MINIMAP, OUTLINE, createDrawState, drawAtlas, drawMinimap, groupMembers, groupName, hitGroupLabel, hitNode, isCoreLink, isLooseFile, matches, nodeLook, shapePath, type DrawState, type GroupLabel } from "./draw.js";
export { LABEL_MAX_CHARS, LABEL_TIER, LABEL_ZOOM, chipShown, chipText, fileLabelAlpha, titleAbove, folderTitles, groupTitled, labelPriority, leafName, overlaps, placeLabels, truncateLabel, truncatePath, type LabelBox, type LabelCandidate } from "./labels.js";
export { TIMELAPSE, TIMELAPSE_SPEEDS, arrivedAt, arrivedBy, buildTimeline, dateAt, entryOpacity, fadeIn, formatDay, gapSteps, linkAlpha, linkTime, playbackLength, popScale, springRamp, type Timeline, type TimelapseSpeed } from "./timeline.js";
export { TimelapseRun } from "./timelapse.js";
export { ATLAS_SPEC, type MapEdge, type MapGraph, type MapNode, type MapSpec, type NodeLook } from "./graph.js";
export { AtlasEngine, CARD, REOPEN, TOP, readSession, useAtlasPalette, writeSession, type EngineEvents, type Session } from "./engine.js";
