/**
 * One call for agents: the scene JSON and the matching image together, with the marker numbering shared.
 */
import type { BoardDocument, BoardEvent, BoardSnapshot, Finding, Renderer } from "@protoboardai/board";
import type { ConnectivityInput } from "./connectivity.js";
import { cropToFinding, cropToNet, cropToObject, walkthroughTiles, type Tile } from "./crops.js";
import { buildModel, type BoardModel } from "./model.js";
import { svgToPng } from "./png.js";
import type { CorridorQuery } from "./relations.js";
import { buildScene, type Detail, type SceneBuild, type SceneKind } from "./scene.js";
import { renderSvg } from "./svg.js";
import { toBoxMm, type BoxMm } from "./util.js";

export interface Overlays {
  /** Footprint references, pad numbers and net names; default "refs" at overview, "all" closer in. */
  labels?: "refs" | "all" | "none";
  /** Numbered markers matching the scene's `m` (default true). */
  markers?: boolean;
  /** The millimeter grid with the origin at the board center (default true). */
  grid?: boolean;
  scaleBar?: boolean;
  /** Missing links as dashed lines (default true). */
  ratsnest?: boolean;
  /** Extra nets or object ids to highlight (the focus is highlighted anyway). */
  highlight?: string[];
}

export interface DescribeOptions {
  /** One focus at most: a region (mm), a net name, an object id, or a finding id. */
  region?: BoxMm | [number, number, number, number];
  net?: string;
  object?: string;
  finding?: string;
  /** Default: object for `object` and `finding`, region for `region` and `net`, else overview. */
  detail?: Detail;
  /** Copper layers in view. */
  layers?: string[];
  kinds?: SceneKind[];
  overlays?: Overlays;
  findings?: Finding[];
  connectivity?: ConnectivityInput;
  corridors?: CorridorQuery[];
  tracks?: "polylines" | "segments";
  /** Override the level's character budget. */
  budget?: number;
  /** Image: svg (default), png, both, or none. */
  image?: "svg" | "png" | "both" | "none";
  /** Pixels per millimeter, or the longest side in pixels (default 1200). */
  pxPerMm?: number;
  maxPx?: number;
  /** Padding around a net, object or finding crop, mm (default 2). */
  pad?: number;
}

export interface DescribeStats {
  /** Characters of compact JSON. */
  jsonChars: number;
  /** jsonChars / 3: an estimate, not a tokenizer count (README, "What it costs"). */
  estTokens: number;
  imageWidth?: number;
  imageHeight?: number;
  /** width x height / 750: the published rule of thumb for image input tokens, before any downscaling. */
  estImageTokens?: number;
}

export interface DescribeResult {
  scene: Record<string, unknown>;
  json: string;
  svg?: string;
  png?: Uint8Array;
  stats: DescribeStats;
  build: SceneBuild;
}

/** Describe a board for an agent: scene JSON and image with shared marker numbers. */
export function describeBoard(input: BoardSnapshot | BoardDocument | BoardModel, options: DescribeOptions = {}): DescribeResult {
  const model = (input as BoardModel).fpById ? (input as BoardModel) : buildModel(input as BoardSnapshot | BoardDocument);
  const focusCount = [options.region, options.net, options.object, options.finding].filter((x) => x !== undefined).length;
  if (focusCount > 1) throw new Error("describeBoard takes one of region, net, object or finding");
  const pad = options.pad ?? 2;
  let region: BoxMm | undefined = options.region ? toBoxMm(options.region) : undefined;
  let focus: string | undefined;
  let nets: string[] | undefined;
  if (options.net) {
    if (!model.netByName.has(options.net)) throw new Error(`unknown net: ${options.net}`);
    region = cropToNet(model, options.net, pad);
    nets = [options.net];
  }
  if (options.object) {
    focus = options.object;
    region = options.object.startsWith("net:") ? cropToNet(model, options.object.slice(4), pad) : cropToObject(model, options.object, pad);
  }
  if (options.finding) {
    const f = (options.findings ?? []).find((x) => x.id === options.finding);
    if (!f) throw new Error(`finding ${options.finding} is not in options.findings`);
    focus = f.id;
    region = cropToFinding(f, pad);
  }
  const detail: Detail = options.detail ?? (focus ? "object" : region ? "region" : "overview");
  const build = buildScene(model, {
    detail,
    ...(region ? { region } : {}),
    ...(nets ? { nets } : {}),
    ...(options.layers ? { layers: options.layers } : {}),
    ...(options.kinds ? { kinds: options.kinds } : {}),
    ...(focus ? { focus } : {}),
    ...(options.findings ? { findings: options.findings } : {}),
    ...(options.connectivity ? { connectivity: options.connectivity } : {}),
    ...(options.corridors ? { corridors: options.corridors } : {}),
    ...(options.tracks ? { tracks: options.tracks } : {}),
    ...(options.budget ? { budget: options.budget } : {}),
  });
  const ov = options.overlays ?? {};
  const image = options.image ?? "svg";
  const stats: DescribeStats = { jsonChars: build.json.length, estTokens: Math.ceil(build.json.length / 3) };
  const result: DescribeResult = { scene: build.scene, json: build.json, stats, build };
  if (image !== "none") {
    const extra = ov.highlight ?? [];
    const svg = renderSvg(model, {
      box: build.view,
      layers: build.layers,
      ...(options.pxPerMm ? { pxPerMm: options.pxPerMm } : {}),
      ...(options.maxPx ? { maxPx: options.maxPx } : {}),
      labels: ov.labels ?? (detail === "overview" ? "refs" : "all"),
      markers: ov.markers === false ? [] : build.markers,
      grid: ov.grid !== false,
      scaleBar: ov.scaleBar !== false,
      rats: ov.ratsnest === false ? [] : build.rats,
      corridors: build.corridors,
      highlight: { nets: [...build.highlight.nets, ...extra.filter((x) => model.netByName.has(x))], ids: [...build.highlight.ids, ...extra.filter((x) => !model.netByName.has(x))] },
      title: `${model.name}  ${detail}${focus ? ` ${focus}` : nets ? ` net ${nets[0]}` : ""}  layers ${build.layers.join(" ")}  origin board center, +Y up`,
    });
    const m = /width="(\d+)" height="(\d+)"/.exec(svg)!;
    stats.imageWidth = Number(m[1]);
    stats.imageHeight = Number(m[2]);
    stats.estImageTokens = Math.ceil((stats.imageWidth * stats.imageHeight) / 750);
    if (image === "svg" || image === "both") result.svg = svg;
    if (image === "png" || image === "both") result.png = svgToPng(svg).png;
  }
  return result;
}

/** A walkthrough: one region description per tile of a grid over the board, each with its own markers. */
export function describeWalkthrough(input: BoardSnapshot | BoardDocument | BoardModel, options: Omit<DescribeOptions, "region" | "net" | "object" | "finding"> & { cols?: number; rows?: number; tile?: number; overlap?: number } = {}): { tile: Tile; result: DescribeResult }[] {
  const model = (input as BoardModel).fpById ? (input as BoardModel) : buildModel(input as BoardSnapshot | BoardDocument);
  const { cols, rows, tile, overlap, ...rest } = options;
  return walkthroughTiles(model, { ...(cols ? { cols } : {}), ...(rows ? { rows } : {}), ...(tile ? { tile } : {}), ...(overlap !== undefined ? { overlap } : {}) }).map((t) => ({ tile: t, result: describeBoard(model, { ...rest, region: t.box, detail: rest.detail ?? "region" }) }));
}

/**
 * The scene exporter as a core `Renderer`: it keeps the latest description of the board, rebuilt on every commit.
 * It never writes to the board.
 */
export function createSceneExporter(options: DescribeOptions = {}): Renderer & { latest(): DescribeResult | undefined } {
  let last: DescribeResult | undefined;
  return {
    render(snapshot: BoardSnapshot) {
      last = describeBoard(snapshot, options);
    },
    update(_event: Extract<BoardEvent, { type: "commit" }>, snapshot: BoardSnapshot) {
      last = describeBoard(snapshot, options);
    },
    latest: () => last,
  };
}
