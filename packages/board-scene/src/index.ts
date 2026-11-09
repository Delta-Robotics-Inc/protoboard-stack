/**
 * @protoboardai/board-scene: the agent's eyes on a board. A compact scene description of a board snapshot and
 * matching SVG and PNG images that share labels and marker numbers, made in plain Node (no GPU, no window).
 * Start with `describeBoard`; `diffScene` describes a change. See README.md.
 */
export { describeBoard, describeWalkthrough, createSceneExporter, type DescribeOptions, type DescribeResult, type DescribeStats, type Overlays } from "./describe.js";
export { diffScene, DIFF_SCHEMA, type DiffOptions, type DiffResult } from "./diff.js";
export { buildScene, polylines, padCopper, BUDGETS, SCENE_SCHEMA, type Detail, type MarkerItem, type SceneBuild, type SceneKind, type SceneOptions, type Polyline } from "./scene.js";
export { renderSvg, layerColor, PALETTE, type SvgOptions } from "./svg.js";
export { svgToPng, pngAvailable, type PngOptions } from "./png.js";
export { cropToFinding, cropToNet, cropToObject, walkthroughTiles, type Tile } from "./crops.js";
export { buildModel, objectBox, objectKind, netBox, padSdf, type BoardModel, type MArea, type MFootprint, type MNet, type MPad, type MTrack, type MVia, type RuleValues } from "./model.js";
export { connectivityOf, estimateConnectivity, type ConnectivityInput, type ConnectivityResult, type NetConnectivity, type NetState, type RatLink, type RatsnestLink } from "./connectivity.js";
export {
  blockersAt,
  congestion,
  copperNear,
  directionOf,
  findCorridor,
  nearestByDirection,
  neighborsOf,
  niceCell,
  ratCrossings,
  DIRECTIONS,
  type Congestion,
  type CongestionLayer,
  type CopperNear,
  type Corridor,
  type CorridorQuery,
  type Direction,
  type Neighbor,
  type RatCrossing,
} from "./relations.js";
export { textPath, textWidth } from "./font.js";
export type { BoxMm, Pt } from "./util.js";
