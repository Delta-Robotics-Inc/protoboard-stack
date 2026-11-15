/**
 * Drawing the Atlas (atlas/draw.ts) on a recording fake 2D context: the
 * hover and selection outlines, the time-based dimming and hover intent,
 * hexagons and the shape presets, core links and "All links", unlinked
 * files, labels beside their nodes (with chips) drawn and measured only when
 * needed, and hit-testing that agrees with the camera.
 */
import { readFileSync } from "node:fs";
import { ATLAS_KIND_ORDER, type AtlasGraph } from "@protoboardai/core/atlas";
import { describe, expect, it } from "vitest";
import { INERTIA, fitTo, fling, newCamera, stepCamera, toScreen, toWorld, wheelImpulse, wheelZoom } from "../src/atlas/camera.js";
import { DEFAULT_APPEARANCE, lookOf, withPreset } from "../src/atlas/appearance.js";
import { DIM, FRAME_MS, MINIMAP, OUTLINE, createDrawState, drawAtlas, drawMinimap, groupMembers, groupName, hitGroupLabel, hitNode, isCoreLink, isLooseFile, matches, type DrawState } from "../src/atlas/draw.js";
import { HOVER } from "../src/atlas/hover.js";
import { LABEL_ZOOM, leafName, overlaps, truncateLabel, type LabelBox } from "../src/atlas/labels.js";
import { HUB_DEGREE, KIND_STYLE, paletteFrom, type AtlasPalette, type Shape } from "../src/atlas/palette.js";
import { AtlasSimulation } from "../src/atlas/sim.js";

const GRAPH: AtlasGraph = JSON.parse(readFileSync(new URL("./fixtures/atlas-graph.json", import.meta.url), "utf8"));
/** Each token as a recognizable string: what a stroke or fill used is plain to read. */
const P = paletteFrom((t) => `token:${t}`, "mono-test", false);

interface Op {
  op: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  globalAlpha: number;
  lineWidth: number;
  dash: number[];
  font: string;
  align: string;
  baseline: string;
}

/** A 2D context that records every call with the state it was made in. */
function recorder() {
  const ops: Op[] = [];
  const state = { fillStyle: "" as unknown, strokeStyle: "" as unknown, globalAlpha: 1, lineWidth: 1, font: "", textAlign: "start", textBaseline: "alphabetic", shadowColor: "", shadowBlur: 0 };
  let dash: number[] = [];
  const stack: (typeof state & { dash: number[] })[] = [];
  const record = (op: string) => (...args: unknown[]) => {
    ops.push({ op, args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, globalAlpha: state.globalAlpha, lineWidth: state.lineWidth, dash, font: state.font, align: state.textAlign, baseline: state.textBaseline });
  };
  const ctx = {
    ...Object.fromEntries(["setTransform", "clearRect", "fillRect", "translate", "scale", "beginPath", "moveTo", "lineTo", "arc", "arcTo", "closePath", "fill", "stroke", "strokeText", "fillText", "rect", "clip", "strokeRect"].map((m) => [m, record(m)])),
    setLineDash(d: number[]) {
      dash = [...d];
    },
    measureText(text: string) {
      ops.push({ op: "measureText", args: [text], fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, globalAlpha: state.globalAlpha, lineWidth: state.lineWidth, dash, font: state.font, align: state.textAlign, baseline: state.textBaseline });
      return { width: text.length * 7 };
    },
    save() {
      stack.push({ ...state, dash });
    },
    restore() {
      const s = stack.pop();
      if (s) {
        dash = s.dash;
        Object.assign(state, s);
      }
    },
  };
  return { ctx: new Proxy(ctx, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : (state as Record<string | symbol, unknown>)[k]), set: (_t, k, v) => ((state as Record<string | symbol, unknown>)[k] = v, true) }) as unknown as CanvasRenderingContext2D, ops };
}

function settledState(init: Partial<DrawState> = {}): DrawState {
  const sim = new AtlasSimulation(GRAPH, { pullBy: init.pullBy ?? "links" });
  sim.settle();
  const s = createDrawState(sim, { w: 1200, h: 800, ...init });
  fitTo(s.cam, sim.nodes, s.w, s.h, 46, true);
  return s;
}

/** Draw until nothing eases any more; the last frame's operations. */
function drawSettled(s: DrawState) {
  let frame = recorder();
  for (let i = 0; i < 200; i++) {
    frame = recorder();
    if (!drawAtlas(frame.ctx, s, P)) break;
  }
  return frame.ops;
}

/** A hexagon's first corner, computed as draw.ts's `shapePath` does. */
const hexStart = (n: { x: number; y: number }, r: number): [number, number] => [n.x + Math.cos(Math.PI / 6) * r * 1.12, n.y + Math.sin(Math.PI / 6) * r * 1.12];

/** Whether an operation starts a node's outline of radius `r` in `shape` (a dot's circle, a hexagon's first corner, a diamond's top). */
function startsShape(o: Op, n: { x: number; y: number }, r: number, shape: Shape): boolean {
  if (shape === "dot") return o.op === "arc" && o.args[0] === n.x && o.args[1] === n.y && Math.abs((o.args[2] as number) - r) < 1e-9;
  if (shape === "diamond") return o.op === "moveTo" && o.args[0] === n.x && Math.abs((o.args[1] as number) - (n.y - r * 1.15)) < 1e-9;
  if (shape === "square") return o.op === "moveTo" && Math.abs((o.args[1] as number) - (n.y - r * 0.92)) < 1e-9 && Math.abs((o.args[0] as number) - (n.x - r * 0.92 + r * 0.32)) < 1e-9;
  const [hx, hy] = hexStart(n, r);
  return o.op === "moveTo" && Math.abs((o.args[0] as number) - hx) < 1e-9 && Math.abs((o.args[1] as number) - hy) < 1e-9;
}

/** The operations that drew a node (a hexagon by default): from the start of its outline at radius r to the next `beginPath`. */
function shapeOps(ops: Op[], n: { x: number; y: number; r: number }, shape: Shape = "hex", r = n.r) {
  const at = ops.findIndex((o) => startsShape(o, n, r, shape));
  expect(at).toBeGreaterThanOrEqual(0);
  const end = ops.findIndex((o, i) => i > at && o.op === "beginPath");
  return ops.slice(at, end < 0 ? undefined : end);
}

/** Draw `frames` frames, `ms` apart. */
function run(s: DrawState, frames: number, ms = FRAME_MS, p: AtlasPalette = P) {
  for (let f = 0; f < frames; f++) drawAtlas(recorder().ctx, s, p, s.time + ms);
}

const idx = (s: DrawState, id: string) => s.sim.indexOf(id)!;

const CHIP_FONT = /^9\.5px /;

/**
 * The screen boxes of the labels a frame drew (the fake measures 7 px a
 * character; every label is left-aligned, vertically centered): a node's
 * name with its chip after it, a group's parent, name and count side by side.
 */
function labelBoxes(ops: Op[]): (LabelBox & { text: string })[] {
  const out: (LabelBox & { text: string })[] = [];
  for (const o of ops) {
    if (o.op !== "fillText") continue;
    const text = o.args[0] as string;
    const x = o.args[1] as number;
    const y = o.args[2] as number;
    const px = Number(/([0-9.]+)px/.exec(o.font)![1]);
    const w = text.length * 7;
    const last = out.at(-1);
    // a chip, or the next part of a group title (it starts where the last ended), extends the label before it
    if (last && (CHIP_FONT.test(o.font) || (Math.abs(x - last.x1) < 1e-6 && Math.abs(y - (last.y0 + last.y1) / 2) < 1))) last.x1 = x + w;
    else out.push({ text, x0: x, y0: y - px / 2, x1: x + w, y1: y + px / 2 });
  }
  return out;
}

/** Every text a group title of this state may draw (its names, parents, counts). */
function groupTexts(s: DrawState): Set<string> {
  const out = new Set<string>(["(PROJECT FOLDER)"]);
  for (const g of s.sim.groups()) {
    out.add(groupName(`${s.pullBy}:${g.key}`).toUpperCase());
    out.add(leafName(g.key).toUpperCase());
    const parts = g.key.split("/").filter(Boolean);
    if (parts.length > 1) out.add(`${parts[parts.length - 2]!.toUpperCase()}/`);
    out.add(`  ${g.members.length}`);
  }
  return out;
}

/** The node labels a frame drew (not group titles, not chips). */
const nodeLabelOps = (s: DrawState, ops: Op[]) => {
  const groups = groupTexts(s);
  return ops.filter((o) => o.op === "fillText" && !CHIP_FONT.test(o.font) && !groups.has(o.args[0] as string));
};

describe("Atlas drawing", () => {
  it("hover: the node keeps its own fill and gets an accent outline in its shape just outside it; no fill-over, ring, glow or growth", () => {
    const s = settledState();
    const i = idx(s, "file:models/frame.glb");
    const n = s.sim.nodes[i]!;
    s.hover = i;
    const ops = drawSettled(s);
    expect(s.accent[i]).toBe(1);
    // the node itself: its own color, its own size
    const own = shapeOps(ops, n);
    expect(own.find((o) => o.op === "fill")!.fillStyle).toBe("token:domainNetwork");
    // the outline: the same hexagon, r + 2.5 px on screen, a 1.5 px accent line
    const outline = shapeOps(ops, n, "hex", n.r + OUTLINE.hover.gap / s.cam.k);
    const stroke = outline.find((o) => o.op === "stroke")!;
    expect(stroke.strokeStyle).toBe("token:accent");
    expect(stroke.lineWidth).toBeCloseTo(OUTLINE.hover.width / s.cam.k);
    expect(outline.some((o) => o.op === "fill")).toBe(false);
    // nothing filled in the accent, no circle around it, no shadow, nothing larger than the outline
    expect(ops.some((o) => o.op === "fill" && o.fillStyle === "token:accent")).toBe(false);
    expect(ops.some((o) => o.op === "arc" && o.args[0] === n.x && o.args[1] === n.y)).toBe(false);
    expect(ops.some((o) => o.op === "moveTo" && Math.abs((o.args[1] as number) - hexStart(n, n.r * 1.15)[1]) < 1e-9)).toBe(false);
    // its links in the accent
    expect(ops.some((o) => o.op === "stroke" && o.strokeStyle === "token:accent" && o.lineWidth === 1.6 / s.cam.k)).toBe(true);
  });

  it("selection: the same outline, wider and thicker (r + 3.5 px, 2 px); hollow and high-contrast nodes get it too", () => {
    for (const highContrast of [false, true]) {
      const s = settledState({ highContrast });
      for (const id of ["file:models/frame.glb", "file:models/untitled.glb"]) {
        const i = idx(s, id);
        const n = s.sim.nodes[i]!;
        s.selected = i;
        const ops = drawSettled(s);
        const stroke = shapeOps(ops, n, "hex", n.r + OUTLINE.selected.gap / s.cam.k).find((o) => o.op === "stroke")!;
        expect(stroke.strokeStyle).toBe("token:accent");
        expect(stroke.lineWidth).toBeCloseTo(OUTLINE.selected.width / s.cam.k);
        // no hover-sized outline as well
        expect(ops.some((o) => startsShape(o, n, n.r + OUTLINE.hover.gap / s.cam.k, "hex"))).toBe(false);
      }
    }
  });

  it("the outline comes in within HOVER.accentInMs and goes with the restore, by real time: the same at 30 and 120 frames a second", () => {
    const at = (fps: number, ms: number) => {
      const s = settledState();
      const i = idx(s, "file:models/frame.glb");
      s.time = 0;
      s.hover = i;
      run(s, Math.round((ms * fps) / 1000), 1000 / fps);
      return { s, i };
    };
    // after one 60 Hz frame it is part way in: an ease-out, not a jump
    const one = at(60, FRAME_MS);
    expect(one.s.accent[one.i]).toBeGreaterThan(0.2);
    expect(one.s.accent[one.i]).toBeLessThan(0.6);
    // 95 % in within accentInMs, whatever the frame rate
    for (const fps of [30, 60, 120]) {
      const { s, i } = at(fps, HOVER.accentInMs);
      expect(s.accent[i]).toBeGreaterThan(0.94);
    }
    const slow = at(30, 100).s;
    const fast = at(120, 100).s;
    const i = idx(slow, "file:models/frame.glb");
    expect(Math.abs(slow.accent[i]! - fast.accent[i]!)).toBeLessThan(0.01);
    // out: after the hold, along the restore's time constant (63 % of the way in one time constant)
    const { s } = at(60, 400);
    s.hover = null;
    run(s, Math.round((HOVER.restoreTauMs * 60) / 1000));
    expect(s.accent[i]).toBeLessThan(0.45);
    expect(s.accent[i]).toBeGreaterThan(0.3);
  });

  it("with a node selected, nodes outside its neighborhood dim strongly (eased), its neighbors stay lit", () => {
    const s = settledState();
    const sel = idx(s, "def:frame");
    s.selected = sel;
    const first = recorder();
    // the first frame starts easing: nothing is dimmed all the way yet
    expect(drawAtlas(first.ctx, s, P)).toBe(true);
    const far0 = idx(s, "file:models/gps.glb");
    expect(s.alpha[far0]).toBeLessThan(1);
    expect(s.alpha[far0]).toBeGreaterThan(0.9);
    const ops = drawSettled(s);
    const far = s.sim.nodes[idx(s, "file:models/gps.glb")]!;
    const neighbor = s.sim.nodes[idx(s, "file:cad/frame.step")]!;
    const fillOf = (n: { x: number; y: number; r: number }) => shapeOps(ops, n).find((o) => o.op === "fill")!;
    expect(fillOf(far).globalAlpha).toBeCloseTo(DIM, 5);
    expect(fillOf(neighbor).globalAlpha).toBe(1);
    expect(fillOf(far).fillStyle).toBe("token:domainNetwork");
    // the selected node's links are drawn in the accent on top
    expect(ops.some((o) => o.op === "stroke" && o.strokeStyle === "token:accent" && o.lineWidth === 1.6 / s.cam.k)).toBe(true);
  });

  it("an unlinked file is hollow (canvas fill) with a dashed outline in its kind's color", () => {
    const s = settledState();
    const i = idx(s, "file:models/untitled.glb");
    expect(isLooseFile(s.sim.source[i]!)).toBe(true);
    const n = s.sim.nodes[i]!;
    const ops = shapeOps(drawSettled(s), n);
    expect(ops.find((o) => o.op === "fill")!.fillStyle).toBe("token:canvas");
    const stroke = ops.find((o) => o.op === "stroke")!;
    expect(stroke.strokeStyle).toBe("token:domainNetwork");
    expect(stroke.dash.length).toBe(2);
    // a linked file of the same kind is filled, with no outline
    const linked = s.sim.nodes[idx(s, "file:models/frame.glb")]!;
    const lops = shapeOps(drawSettled(s), linked);
    expect(lops.find((o) => o.op === "fill")!.fillStyle).toBe("token:domainNetwork");
    expect(lops.some((o) => o.op === "stroke")).toBe(false);
  });

  it("high contrast: outlines replace fills", () => {
    const s = settledState({ highContrast: true });
    const n = s.sim.nodes[idx(s, "file:models/frame.glb")]!;
    const ops = shapeOps(drawSettled(s), n);
    expect(ops.find((o) => o.op === "fill")!.fillStyle).toBe("token:canvas");
    expect(ops.find((o) => o.op === "stroke")!.strokeStyle).toBe("token:domainNetwork");
  });

  it("All links: made-from links are dashed, the others solid; every link on screen is drawn, the non-core ones thinner", () => {
    const s = settledState({ allLinks: true });
    const ops = drawSettled(s);
    const lines = (w: number) => ops.filter((o, i) => o.op === "stroke" && ops[i - 1]?.op === "lineTo" && Math.abs(o.lineWidth - w / s.cam.k) < 1e-9);
    const core = s.sim.edges.filter((e) => isCoreLink(s.sim, "links", e));
    expect(lines(1).length).toBe(core.length);
    expect(lines(0.6).length).toBe(s.sim.edges.length - core.length);
    const dashed = [...lines(1), ...lines(0.6)].filter((o) => o.dash.length).length;
    expect(dashed).toBe(s.sim.edges.filter((e) => e.type === "made-from").length);
    // the web is muted: fainter than the core links
    expect(Math.max(...lines(0.6).map((o) => o.globalAlpha))).toBeLessThan(Math.min(...lines(1).map((o) => o.globalAlpha)));
  });

  it("core links by default: the structure in Links (has, contains), the links within a group in Kind and Folder", () => {
    for (const pullBy of ["links", "kind", "folder"] as const) {
      const s = settledState({ pullBy });
      const ops = drawSettled(s);
      const drawn = ops.filter((o, i) => o.op === "stroke" && ops[i - 1]?.op === "lineTo" && o.strokeStyle === "token:textMuted").length;
      const core = s.sim.edges.filter((e) => isCoreLink(s.sim, pullBy, e));
      expect(drawn, pullBy).toBe(core.length);
      expect(core.length, pullBy).toBeLessThan(s.sim.edges.length);
      for (const e of core) {
        const a = s.sim.nodes[e.s]!;
        const b = s.sim.nodes[e.t]!;
        if (pullBy === "links") expect(["has", "contains"]).toContain(e.type);
        else if (pullBy === "kind") expect(a.kind).toBe(b.kind);
        else expect(a.folder).toBe(b.folder);
      }
    }
  });

  it("a hovered or selected node shows all of its links in the accent, toggle or not; the toggle never moves a node", () => {
    const s = settledState();
    // a module with links of both families (has and uses)
    const i = idx(s, "def:frame");
    const own = s.sim.edgesOf(i).map((e) => s.sim.edges[e]!);
    expect(own.some((e) => !isCoreLink(s.sim, "links", e))).toBe(true);
    const before = s.sim.nodes.map((n) => [n.x, n.y]);
    for (const allLinks of [false, true]) {
      s.allLinks = allLinks;
      s.hover = i;
      const ops = drawSettled(s);
      const accent = ops.filter((o, j) => o.op === "stroke" && ops[j - 1]?.op === "lineTo" && o.strokeStyle === "token:accent" && o.lineWidth === 1.6 / s.cam.k);
      expect(accent.length).toBe(own.length);
    }
    s.hover = null;
    drawSettled(s);
    // drawing never touches the layout
    expect(s.sim.nodes.map((n) => [n.x, n.y])).toEqual(before);
  });

  it("zoomed out, only the module hubs are labeled (those with room); zoomed in, more nodes on screen", () => {
    const s = settledState();
    s.cam.k = s.cam.tk = 0.3;
    let ops = drawSettled(s);
    const modules = s.sim.nodes.filter((n) => n.kind === "module").length;
    const zoomedOut = ops.filter((o) => o.op === "fillText");
    expect(zoomedOut.length).toBeGreaterThan(0);
    expect(zoomedOut.length).toBeLessThanOrEqual(modules);
    const moduleNames = new Set(s.sim.source.filter((n) => n.kind === "module").map((n) => n.label.toUpperCase()));
    expect(zoomedOut.every((o) => moduleNames.has(o.args[0] as string))).toBe(true);
    s.cam.k = s.cam.tk = 2;
    ops = drawSettled(s);
    const texts = ops.filter((o) => o.op === "fillText").length;
    expect(texts).toBeGreaterThan(modules);
    expect(texts).toBeLessThan(s.sim.nodes.length);
  });

  it("labels are measured once per font and text: a later frame measures nothing", () => {
    const links = settledState();
    const once = recorder();
    drawAtlas(once.ctx, links, P);
    expect(once.ops.filter((o) => o.op === "measureText").length).toBeGreaterThan(0);
    expect(drawSettled(links).filter((o) => o.op === "measureText").length).toBe(0);
    const kind = settledState({ pullBy: "kind" });
    const first = recorder();
    drawAtlas(first.ctx, kind, P);
    expect(first.ops.filter((o) => o.op === "measureText").length).toBeGreaterThan(0);
    const second = recorder();
    drawAtlas(second.ctx, kind, P);
    expect(second.ops.filter((o) => o.op === "measureText").length).toBe(0);
  });

  it("group labels: drawn above each kind with its count, and hit where they are drawn", () => {
    const s = settledState({ pullBy: "kind" });
    const ops = drawSettled(s);
    const renders = s.sim.groups().find((g) => g.key === "render")!;
    expect(ops.some((o) => o.op === "fillText" && o.args[0] === "RENDERS")).toBe(true);
    expect(ops.some((o) => o.op === "fillText" && o.args[0] === `  ${renders.members.length}`)).toBe(true);
    const label = s.labels.get("kind:render")!;
    const [sx, sy] = toScreen(s.cam, label.x, label.y - 4 / s.cam.k, s.w, s.h);
    expect(hitGroupLabel(s, sx, sy)).toBe("kind:render");
    expect(hitGroupLabel(s, sx, sy + 60)).not.toBe("kind:render");
    expect(groupName("kind:render")).toBe("Renders");
    expect(groupName("folder:docs/renders")).toBe("docs/renders");
    expect(groupName("unlinked")).toBe("Unlinked files");
    expect(groupMembers(s.sim, "kind:render")).toEqual([...renders.members]);
    expect(groupMembers(s.sim, "unlinked").length).toBe(GRAPH.counts.census.unlinked);
  });

  it("hitNode and toWorld agree with fitTo: every node is on the canvas and found where it is drawn", () => {
    const s = settledState();
    for (const n of s.sim.nodes) {
      const [sx, sy] = toScreen(s.cam, n.x, n.y, s.w, s.h);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(s.w);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(s.h);
      const [wx, wy] = toWorld(s.cam, sx, sy, s.w, s.h);
      expect(wx).toBeCloseTo(n.x, 9);
      expect(wy).toBeCloseTo(n.y, 9);
      expect(hitNode(s, sx, sy)).toBe(n.index);
    }
    // a point far from every node hits nothing
    expect(hitNode(s, 2, 2)).toBeNull();
    // the reach is 5 pixels past the edge, whatever the zoom
    const n = s.sim.nodes[idx(s, "def:frame")]!;
    const [sx, sy] = toScreen(s.cam, n.x, n.y, s.w, s.h);
    const edge = n.r * s.cam.k;
    expect(hitNode(s, sx + edge + 4, sy)).toBe(n.index);
  });

  it("the wheel zooms about the pointer: the graph point under it stays put", () => {
    const cam = newCamera();
    cam.x = cam.tx = 30;
    cam.y = cam.ty = -12;
    const before = toWorld(cam, 900, 200, 1200, 800);
    wheelZoom(cam, 900, 200, -240, 1200, 800);
    expect(cam.k).toBeGreaterThan(1);
    const after = toWorld(cam, 900, 200, 1200, 800);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    for (let i = 0; i < 40; i++) wheelZoom(cam, 900, 200, -1000, 1200, 800);
    expect(cam.k).toBe(4);
  });

  it("the wheel zooms with inertia: it eases in and coasts out about the pointer, to the same zoom as at once", () => {
    const cam = newCamera();
    cam.x = cam.tx = 30;
    cam.y = cam.ty = -12;
    const before = toWorld(cam, 900, 200, 1200, 800);
    const once = { ...cam };
    wheelZoom(once, 900, 200, -240, 1200, 800);
    wheelImpulse(cam, 900, 200, -240);
    // not there at once: it eases in
    expect(cam.k).toBe(1);
    stepCamera(cam, 1200, 800);
    expect(cam.k).toBeGreaterThan(1);
    expect(cam.k).toBeLessThan(once.k);
    let frames = 1;
    while (stepCamera(cam, 1200, 800) && frames < 500) frames++;
    // it coasted over several frames, then stopped, at the zoom one turn gives at once, the point under the pointer kept
    expect(frames).toBeGreaterThan(10);
    expect(cam.k).toBeCloseTo(once.k, 2);
    const after = toWorld(cam, 900, 200, 1200, 800);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it("a pan let go while moving flings on and slows by friction to a stop", () => {
    const cam = newCamera();
    fling(cam, 20, 0);
    stepCamera(cam, 1200, 800);
    expect(cam.x).toBeLessThan(0);
    let frames = 0;
    while (stepCamera(cam, 1200, 800) && frames < 1000) frames++;
    // it stops after a finite distance (speed / (1 - friction))
    expect(frames).toBeLessThan(200);
    expect(cam.x).toBeGreaterThan(-20 / (1 - INERTIA.panFriction) - 1);
    // a flick is capped
    fling(cam, 1e4, 0);
    expect(cam.vx).toBe(INERTIA.maxFling);
  });

  it("matches: label, path or kind name, case-insensitive; an empty query matches all", () => {
    const n = { label: "frame-1.png", path: "docs/renders/frame-1.png", kind: "render" as const };
    expect(matches(n, "FRAME")).toBe(true);
    expect(matches(n, "docs/renders")).toBe(true);
    expect(matches(n, "renders")).toBe(true);
    expect(matches(n, "render")).toBe(true);
    expect(matches(n, "photo")).toBe(false);
    expect(matches(n, "  ")).toBe(true);
  });

  it("a search dims what does not match", () => {
    const s = settledState({ query: "Tuning" });
    const ops = drawSettled(s);
    const hit = s.sim.nodes[idx(s, "file:docs/tuning-log.md")]!;
    const miss = s.sim.nodes[idx(s, "file:models/frame.glb")]!;
    expect(shapeOps(ops, hit).find((o) => o.op === "fill")!.globalAlpha).toBe(1);
    expect(shapeOps(ops, miss).find((o) => o.op === "fill")!.globalAlpha).toBeCloseTo(DIM, 5);
    // what matches is labeled, whatever the zoom
    expect(ops.some((o) => o.op === "fillText" && o.args[0] === "tuning-log.md")).toBe(true);
  });

  it("KIND_STYLE and the palette cover every kind, with theme tokens only: every kind a hexagon, each in its own color, none in the accent", () => {
    expect(Object.keys(KIND_STYLE).sort()).toEqual([...ATLAS_KIND_ORDER].sort());
    for (const k of ATLAS_KIND_ORDER) expect(P.kinds[k]).toBe(`token:${KIND_STYLE[k].token}`);
    expect(P.font).toBe("mono-test");
    for (const k of ATLAS_KIND_ORDER) expect(P.shapes[k]).toBe("hex");
    // one shape for all: no two kinds share a color token; the accent is the hover's and the selection's only
    const all = ATLAS_KIND_ORDER.map((k) => KIND_STYLE[k].token);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("accent");
    for (const orange of ["signalPower", "domainElectrical", "signalPwm"]) expect(all).not.toContain(orange);
    expect(KIND_STYLE.module.token).toBe("text");
    // the viewer's twins (signalI2c and domainNetwork are one violet, signalPhase and domainThermal one red) are not both used
    expect(all.includes("signalI2c") && all.includes("domainNetwork")).toBe(false);
    expect(all.includes("signalPhase") && all.includes("domainThermal")).toBe(false);
  });

  it("every node is drawn a hexagon by default; Shapes by type puts back the earlier mapping", () => {
    const s = settledState();
    let ops = drawSettled(s);
    for (const n of s.sim.nodes) shapeOps(ops, n, "hex");
    const byType = paletteFrom((t) => `token:${t}`, "mono-test", false, lookOf(withPreset(DEFAULT_APPEARANCE, "by-type")));
    ops = [];
    for (let f = 0; f < 3; f++) {
      const r = recorder();
      drawAtlas(r.ctx, s, byType);
      ops = r.ops;
    }
    const expected: Record<string, Shape> = { module: "hex", render: "square", image: "square", board: "diamond", model: "dot", doc: "dot" };
    for (const n of s.sim.nodes) if (expected[n.kind]) shapeOps(ops, n, expected[n.kind]);
  });

  it("Color by type off: every node the neutral, the hubs (modules, well-linked nodes) a step stronger", () => {
    const s = settledState();
    const gray = paletteFrom((t) => `token:${t}`, "mono-test", false, lookOf({ ...DEFAULT_APPEARANCE, colorByType: false }));
    let ops: Op[] = [];
    for (let f = 0; f < 3; f++) {
      const r = recorder();
      drawAtlas(r.ctx, s, gray);
      ops = r.ops;
    }
    for (const n of s.sim.nodes) {
      if (isLooseFile(s.sim.source[n.index]!)) continue;
      const fill = shapeOps(ops, n).find((o) => o.op === "fill")!.fillStyle;
      expect(fill).toBe(n.kind === "module" || n.deg >= HUB_DEGREE ? "token:textMuted" : "token:textFaint");
    }
  });

  it("the main canvas draws no minimap: the minimap has a canvas of its own, in a panel", () => {
    const s = settledState();
    expect(drawSettled(s).some((o) => o.op === "strokeRect")).toBe(false);
  });

  it("the minimap: each node a one-pixel dot in its kind's color, and the view framed in the accent", () => {
    const s = settledState({ dpr: 2 });
    const mini = recorder();
    drawMinimap(mini.ctx, s, P, MINIMAP.w, MINIMAP.h, 2);
    const ops = mini.ops;
    const m = { x: 0, y: 0, w: MINIMAP.w, h: MINIMAP.h };
    const inside = (o: Op) => (o.args[0] as number) >= m.x && (o.args[0] as number) <= m.x + m.w && (o.args[1] as number) >= m.y && (o.args[1] as number) <= m.y + m.h;
    // (the panel's face behind it is one surface-colored rect)
    const dots = ops.filter((o) => o.op === "fillRect" && inside(o) && o.fillStyle !== "token:surface" && (o.args[2] as number) <= 2);
    expect(dots.length).toBe(s.sim.nodes.length);
    // one CSS pixel (two device pixels at dpr 2), on whole device pixels; modules twice that
    expect(dots.filter((o) => o.args[2] === 1).length).toBe(s.sim.nodes.filter((n) => n.kind !== "module").length);
    for (const o of dots) expect(((o.args[0] as number) * 2) % 1).toBe(0);
    expect(new Set(dots.map((o) => o.fillStyle))).toEqual(new Set(s.sim.nodes.map((n) => P.kinds[n.kind])));
    const frame = ops.filter((o) => o.op === "strokeRect").at(-1)!;
    expect(frame.strokeStyle).toBe("token:accent");
    expect(inside(frame)).toBe(true);
  });

  it("labels never overlap, and stay off what floats over the canvas (the panels, the minimap)", () => {
    const panel: LabelBox = { x0: 1200 - 140, y0: 0, x1: 1200, y1: 100 };
    for (const pullBy of ["links", "kind", "folder"] as const) {
      for (const k of [0.3, 0.8, 1.6, 3]) {
        const s = settledState({ pullBy, reserved: [panel] });
        s.cam.k = s.cam.tk = k;
        const boxes = labelBoxes(drawSettled(s));
        // far out there may be nothing big enough to label
        if (k >= 1.6) expect(boxes.length).toBeGreaterThan(0);
        for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) expect(overlaps(boxes[a]!, boxes[b]!), `${pullBy} at ${k}: "${boxes[a]!.text}" and "${boxes[b]!.text}"`).toBe(false);
        for (const b of boxes) expect(overlaps(b, panel)).toBe(false);
      }
    }
  });

  it("labels by zoom: far out no file labels; close in, file labels fade in (muted) by on-screen radius; the hovered node always", () => {
    for (const pullBy of ["links", "kind", "folder"] as const) {
      const s = settledState({ pullBy });
      const nodeTexts = (ops: Op[]) => nodeLabelOps(s, ops);
      // far out: no node is big enough on screen for a file label; only titles (a group's, or in Links a module's cluster)
      s.cam.k = s.cam.tk = 0.3;
      let ops = drawSettled(s);
      for (const o of nodeTexts(ops)) {
        expect(pullBy, String(o.args[0])).toBe("links");
        expect(s.sim.source.some((n) => n.kind === "module" && n.label.toUpperCase() === o.args[0])).toBe(true);
      }
      // in the middle (the whole map in view): group titles, and no file label on a node too small on screen
      fitTo(s.cam, s.sim.nodes, s.w, s.h, 46, true);
      ops = drawSettled(s);
      if (pullBy !== "links") expect(ops.some((o) => o.op === "fillText" && groupTexts(s).has(o.args[0] as string))).toBe(true);
      for (const o of nodeTexts(ops).filter((x) => x.fillStyle === "token:textMuted")) {
        const n = s.sim.nodes.find((x) => s.sim.source[x.index]!.label === o.args[0] || truncateLabel(s.sim.source[x.index]!.label) === o.args[0])!;
        expect(n.r * s.cam.k).toBeGreaterThan(LABEL_ZOOM.fileFromPx);
      }
      // close in: file labels, muted, of nodes whose on-screen radius is past the start of the ramp
      s.cam.k = s.cam.tk = 3;
      ops = drawSettled(s);
      const files = nodeTexts(ops).filter((o) => o.fillStyle === "token:textMuted");
      expect(files.length).toBeGreaterThan(0);
      expect(Math.min(...s.sim.nodes.map((n) => n.r)) * 3).toBeGreaterThan(LABEL_ZOOM.fileFromPx);
      // the hovered node is labeled, whole, whatever the zoom
      s.cam.k = s.cam.tk = 0.3;
      s.hover = idx(s, "file:docs/tuning-log.md");
      const focused = drawSettled(s).find((o) => o.op === "fillText" && o.args[0] === "tuning-log.md");
      // in the accent text color, weight 600
      expect(focused?.fillStyle).toBe("token:accentHover");
      expect(focused?.font.startsWith("600 ")).toBe(true);
    }
  });

  it("a label sits right of its node, centered on it, on a canvas-colored plate; close in (or on the focus) a boxed chip follows: the extension", () => {
    const s = settledState();
    const i = idx(s, "file:models/frame.glb");
    const n = s.sim.nodes[i]!;
    s.cam.k = s.cam.tk = 3;
    s.cam.x = s.cam.tx = n.x;
    s.cam.y = s.cam.ty = n.y;
    const ops = drawSettled(s);
    const [sx, sy] = toScreen(s.cam, n.x, n.y, s.w, s.h);
    const name = ops.find((o) => o.op === "fillText" && o.args[0] === "frame.glb")!;
    expect(name).toBeDefined();
    // 5 px past the hexagon's right corner, vertically centered
    expect(name.args[1]).toBeCloseTo(sx + n.r * s.cam.k * 1.12 * Math.cos(Math.PI / 6) + 5, 6);
    expect(name.args[2]).toBeCloseTo(sy, 6);
    expect(name.baseline).toBe("middle");
    expect(name.align).toBe("left");
    // the plate under it: the canvas color, a little see-through
    const at = ops.indexOf(name);
    const plateOp = ops.slice(0, at).reverse().find((o) => o.op === "fillRect")!;
    expect(plateOp.fillStyle).toBe("token:canvas");
    expect(plateOp.globalAlpha).toBeCloseTo(0.82, 5);
    // the chip: the extension in capitals, boxed (a surface fill, a 1 px border), in the muted text, after the name
    const chip = ops.find((o) => o.op === "fillText" && o.args[0] === "GLB")!;
    expect(chip).toBeDefined();
    expect(chip.fillStyle).toBe("token:textMuted");
    expect(chip.font.startsWith("9.5px")).toBe(true);
    expect(chip.args[1] as number).toBeGreaterThan((name.args[1] as number) + "frame.glb".length * 7);
    const box = ops.slice(at, ops.indexOf(chip)).find((o) => o.op === "strokeRect")!;
    expect(box.strokeStyle).toBe("token:border");
    expect(box.lineWidth).toBe(1);
    expect(ops.slice(at, ops.indexOf(chip)).some((o) => o.op === "fillRect" && o.fillStyle === "token:surface")).toBe(true);
    // in the middle tier, no chips; a module (no file) never has one
    fitTo(s.cam, s.sim.nodes, s.w, s.h, 46, true);
    const mid = drawSettled(s);
    expect(mid.some((o) => o.op === "fillText" && CHIP_FONT.test(o.font))).toBe(false);
    s.hover = i;
    expect(drawSettled(s).some((o) => o.op === "fillText" && o.args[0] === "GLB")).toBe(true);
    s.hover = idx(s, "def:frame");
    expect(drawSettled(s).some((o) => o.op === "fillText" && CHIP_FONT.test(o.font))).toBe(false);
  });

  it("group titles: uppercase, weight 600; on the group's center far out, above it closer in", () => {
    const s = settledState({ pullBy: "kind" });
    const g = s.sim.groups().find((x) => x.key === "render")!;
    const box = () => {
      const ys = g.members.map((m) => s.sim.nodes[m]!);
      return { top: Math.min(...ys.map((n) => n.y - n.r)), bottom: Math.max(...ys.map((n) => n.y + n.r)) };
    };
    // closer in: above the group's top
    s.cam.k = s.cam.tk = 1.2;
    s.cam.x = s.cam.tx = s.sim.nodes[g.members[0]!]!.x;
    s.cam.y = s.cam.ty = s.sim.nodes[g.members[0]!]!.y;
    let ops = drawSettled(s);
    let title = ops.find((o) => o.op === "fillText" && o.args[0] === "RENDERS")!;
    expect(title.font.startsWith("600 11.5px")).toBe(true);
    expect(s.labels.get("kind:render")!.y).toBeLessThan(box().top);
    // far out: centered on the group, larger
    s.cam.k = s.cam.tk = 0.7;
    for (let f = 0; f < 120; f++) drawAtlas(recorder().ctx, s, P);
    ops = drawSettled(s);
    title = ops.find((o) => o.op === "fillText" && o.args[0] === "RENDERS")!;
    expect(title).toBeDefined();
    expect(title.font.startsWith("600 13px")).toBe(true);
    const { top, bottom } = box();
    expect(s.labels.get("kind:render")!.y).toBeCloseTo((top + bottom) / 2, 0);
  });

  it("Folder: a title is the folder's last segment; its parent comes first, dimmer, only when two titles share it", () => {
    const graph: AtlasGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((n, i) => (n.file && n.folder ? { ...n, folder: `${i % 2 ? "b" : "a"}/${n.folder.split("/").pop()}` } : n)),
    };
    const sim = new AtlasSimulation(graph, { pullBy: "folder" });
    sim.settle();
    const s = createDrawState(sim, { w: 1600, h: 1000 });
    fitTo(s.cam, sim.nodes, s.w, s.h, 46, true);
    const ops = drawSettled(s);
    const titles = ops.filter((o) => o.op === "fillText" && groupTexts(s).has(o.args[0] as string) && !/^ {2}\d+$/.test(o.args[0] as string));
    expect(titles.length).toBeGreaterThan(0);
    // no title draws a whole path
    for (const o of titles) expect((o.args[0] as string).replace(/\/$/, "")).not.toContain("/");
    // the parents (A/, B/) tell the twins apart, drawn in the faint text color
    const parents = titles.filter((o) => /^[AB]\/$/.test(o.args[0] as string));
    expect(parents.length).toBeGreaterThan(0);
    for (const o of parents) expect(o.fillStyle).toBe("token:textFaint");
    // the whole path is the tooltip's and the inspector's
    expect(groupName("folder:a/renders")).toBe("a/renders");
  });

  it("long names are cut with an ellipsis; the hovered node's is drawn whole", () => {
    const long = "Clear heat-shrink sleeve for the receiver, about 15 mm flat width";
    const graph: AtlasGraph = { ...GRAPH, nodes: GRAPH.nodes.map((n) => (n.id === "def:receiver" ? { ...n, label: long } : n)) };
    const sim = new AtlasSimulation(graph, { pullBy: "links" });
    sim.settle();
    const s = createDrawState(sim, { w: 1200, h: 800 });
    fitTo(s.cam, sim.nodes, s.w, s.h, 46, true);
    const i = sim.indexOf("def:receiver")!;
    s.hover = i;
    expect(drawSettled(s).some((o) => o.op === "fillText" && o.args[0] === long.toUpperCase())).toBe(true);
    s.hover = null;
    s.cam.k = s.cam.tk = 2;
    s.cam.x = s.cam.tx = sim.nodes[i]!.x;
    s.cam.y = s.cam.ty = sim.nodes[i]!.y;
    const texts = drawSettled(s).filter((o) => o.op === "fillText").map((o) => o.args[0] as string);
    expect(texts).toContain(truncateLabel(long).toUpperCase());
    expect(texts).not.toContain(long.toUpperCase());
  });

  it("unlinked follows the census: a file an operation produced is drawn solid and is not in the Unlinked group", () => {
    const loose = GRAPH.nodes.filter((n) => n.degree === 0 && n.file);
    expect(loose.length).toBe(GRAPH.counts.census.unlinked);
    const produced = loose[0]!.id;
    const graph: AtlasGraph = { ...GRAPH, nodes: GRAPH.nodes.map((n) => (n.id === produced ? { ...n, file: { ...n.file!, producedBy: "operations/2026-01-01T00-00-00-000Z-tech-docs.json" } } : n)) };
    expect(isLooseFile(graph.nodes.find((x) => x.id === produced)!)).toBe(false);
    const sim = new AtlasSimulation(graph, { pullBy: "links" });
    sim.settle();
    const s = createDrawState(sim, { w: 1200, h: 800 });
    fitTo(s.cam, sim.nodes, s.w, s.h, 46, true);
    const members = groupMembers(sim, "unlinked");
    expect(members.length).toBe(loose.length - 1);
    expect(members).not.toContain(sim.indexOf(produced));
    // the hollow (canvas-filled, dashed) shapes are exactly the unlinked files
    const hollow = drawSettled(s).filter((o) => o.op === "fill" && o.fillStyle === "token:canvas");
    expect(hollow.length).toBe(members.length);
  });

  it("a fit keeps clear of the panels, a card, the toolbar and the group labels", () => {
    const s = settledState();
    const bottom = 50;
    fitTo(s.cam, s.sim.nodes, s.w, s.h, 46, true, { left: 336, right: 312, top: 22, bottom });
    for (const n of s.sim.nodes) {
      const [sx, sy] = toScreen(s.cam, n.x, n.y, s.w, s.h);
      expect(sx).toBeGreaterThan(336);
      expect(sx).toBeLessThan(s.w - 312);
      expect(sy).toBeGreaterThan(22);
      expect(sy).toBeLessThan(s.h - bottom);
    }
    // insets that would leave less than a third of the canvas are scaled down
    fitTo(s.cam, s.sim.nodes, 400, 300, 10, true, { left: 336, right: 312 });
    const [sx] = toScreen(s.cam, s.sim.nodes[0]!.x, s.sim.nodes[0]!.y, 400, 300);
    expect(Number.isFinite(sx)).toBe(true);
    expect(s.cam.k).toBeGreaterThan(0);
  });

  it("a fit can keep a side of the canvas clear: the boxes' center lands mid-way in what is left", () => {
    const s = settledState();
    fitTo(s.cam, s.sim.nodes, s.w, s.h, 46, true, { left: 336 });
    const c = { x: (Math.min(...s.sim.nodes.map((n) => n.x - n.r)) + Math.max(...s.sim.nodes.map((n) => n.x + n.r))) / 2, y: 0 };
    const [sx] = toScreen(s.cam, c.x, c.y, s.w, s.h);
    expect(sx).toBeCloseTo(336 + (s.w - 336) / 2, 6);
    for (const n of s.sim.nodes) expect(toScreen(s.cam, n.x, n.y, s.w, s.h)[0]).toBeGreaterThan(336);
  });
});
