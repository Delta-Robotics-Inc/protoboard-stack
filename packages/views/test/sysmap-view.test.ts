/**
 * The System Map view's logic (sysmap/model.ts) and what it asks of the
 * shared Atlas renderer: items grouped into islands, the look of each
 * status, the chips and rings of "Show changes", links within and across
 * islands, the islands and releases the side panel lists, an item's links
 * by kind, and an appearance keyed by item type, kept apart from the
 * Atlas's.
 */
import type { DisciplineId, ItemStatus, ItemType, SysmapGraph, SysmapItem, SysmapLink } from "@protoboardai/core/sysmap";
import { ITEM_TYPE_ORDER } from "@protoboardai/core/sysmap";
import { describe, expect, it } from "vitest";
import { ATLAS_KIND_TABLE, kindColor, kindShape, lookOf, parseAppearance, presetOf, withKind, withPreset } from "../src/atlas/appearance.js";
import { createDrawState, drawAtlas, groupMembers, groupName, isCoreLink, matches, nodeLook } from "../src/atlas/draw.js";
import { fitTo } from "../src/atlas/camera.js";
import { paletteFrom } from "../src/atlas/palette.js";
import { parseUi } from "../src/atlas/settings.js";
import { AtlasSimulation } from "../src/atlas/sim.js";
import {
  NO_ISLAND,
  SYSMAP_KEYS,
  SYSMAP_KIND_TABLE,
  SYSMAP_TYPE_STYLE,
  changedIn,
  defaultRelease,
  isWithinIsland,
  islandRows,
  itemChip,
  linkGroups,
  parsePositions,
  releaseOptions,
  sourceFile,
  sysmapMapGraph,
  sysmapSpec,
  typeRows,
  type SysmapNode,
} from "../src/sysmap/model.js";

function item(id: string, type: ItemType, discipline: DisciplineId | null, o: Partial<SysmapItem> = {}): SysmapItem {
  return {
    id,
    type,
    name: id.split(":")[1]!,
    version: "0.3.0",
    versionFrom: "own",
    discipline,
    disciplineFrom: "rule",
    stage: null,
    purpose: `What ${id} does`,
    status: "released",
    changed: { in: "0.2.0", date: "2026-10-26", why: "In v0.2.0, the earliest release tag; unchanged since", from: "history" },
    source: `packages/x/${id.replace(":", "-")}.md`,
    degree: 0,
    ...o,
  };
}

const ITEMS: SysmapItem[] = [
  item("skill:circuit-board", "skill", "pcb", { changed: { in: "0.3.0", date: "2026-11-11", why: "SKILL.md changed", from: "history" }, source: "packages/ext-tscircuit/skills/circuit-board/SKILL.md" }),
  item("op:ext-tscircuit#generate", "operation", "pcb", { source: "packages/ext-tscircuit/protoboard-extension.json#operations/generate" }),
  item("cli:check", "cli-command", "system"),
  item("cli:map", "cli-command", "project", { status: "wip", version: null, versionFrom: "unreleased", changed: { in: "unreleased", why: "New since v0.3.0", from: "history" } }),
  item("pkg:@deltarobotics/uhd", "package", "project", { status: "outside", version: "0.3.1", versionFrom: "installed", changed: null }),
  item("doc:docs/specs/x.md", "doc", null),
];
const LINKS: SysmapLink[] = [
  { from: "skill:circuit-board", to: "op:ext-tscircuit#generate", kind: "runs", via: "a" },
  { from: "skill:circuit-board", to: "cli:check", kind: "runs-command", via: "a" },
  { from: "cli:map", to: "pkg:@deltarobotics/uhd", kind: "cites", via: "b" },
  { from: "doc:docs/specs/x.md", to: "skill:circuit-board", kind: "mentions", via: "c" },
  { from: "doc:docs/specs/x.md", to: "cli:map", kind: "mentions", via: "c" },
];
const ISLANDS = (["project", "research", "system", "pcb", "simulation"] as DisciplineId[]).map((id) => ({
  id,
  name: id === "pcb" ? "PCB & EDA" : id[0]!.toUpperCase() + id.slice(1),
  gloss: `About ${id}`,
  items: ITEMS.filter((i) => i.discipline === id).length,
  empty: !ITEMS.some((i) => i.discipline === id),
  ...(ITEMS.some((i) => i.discipline === id) ? {} : { note: "No item in the stack resolves to this discipline." }),
}));
const GRAPH: SysmapGraph = {
  stack: "0.3.0",
  layout: "monorepo",
  counts: { items: ITEMS.length, links: LINKS.length, byType: Object.fromEntries(ITEM_TYPE_ORDER.map((t) => [t, 0])) as SysmapGraph["counts"]["byType"], byDiscipline: {} as SysmapGraph["counts"]["byDiscipline"], byStatus: { released: 4, wip: 1, outside: 1 }, byLinkKind: {}, problems: 1 },
  islands: ISLANDS,
  stages: [{ n: 5, title: "Boards", discipline: "pcb" }],
  releases: [
    { version: "0.2.0", tag: "v0.2.0", date: "2026-10-26" },
    { version: "0.2.1", tag: "v0.2.1", date: "2026-10-26" },
    { version: "0.3.0", tag: "v0.3.0", date: "2026-11-11" },
  ],
  items: ITEMS,
  links: LINKS,
  problems: [{ reason: "OUTSIDE_VERSION_DRIFT", message: "installed 0.3.1, pinned 0.3.0", item: "pkg:@deltarobotics/uhd" }],
};

describe("items as the renderer's nodes", () => {
  it("each item sits in its discipline's island (none: its own), typed by its item type", () => {
    const g = sysmapMapGraph(GRAPH);
    expect(g.nodes.map((n) => [n.id, n.kind, n.folder])).toEqual(ITEMS.map((i) => [i.id, i.type, i.discipline ?? NO_ISLAND]));
    expect(g.edges).toEqual(LINKS.map((l) => ({ from: l.from, to: l.to, type: l.kind })));
    expect(g.nodes.every((n) => n.hub !== true)).toBe(true);
  });

  it("released is filled, work in progress hollow and dashed, outside hollow and solid", () => {
    const looks = Object.fromEntries(sysmapMapGraph(GRAPH).nodes.map((n) => [n.item.status, nodeLook(n)])) as Record<ItemStatus, string>;
    expect(looks).toEqual({ released: "fill", wip: "dashed", outside: "hollow" });
  });

  it("the chip is the item's own version, unreleased for work in progress; Show changes reads the version it changed in", () => {
    const [skill, op, , map, uhd] = ITEMS;
    expect(itemChip(skill!)).toBe("0.3.0");
    expect(itemChip(map!)).toBe("unreleased");
    expect(itemChip(uhd!)).toBe("0.3.1");
    expect(itemChip(skill!, "0.3.0")).toBe("changed 0.3.0");
    expect(itemChip(op!, "0.3.0")).toBe("0.3.0");
    expect(itemChip(map!, "unreleased")).toBe("changed unreleased");
    const g = sysmapMapGraph(GRAPH, "0.3.0");
    expect(g.nodes.find((n) => n.id === "skill:circuit-board")!.version).toBe("changed 0.3.0");
    expect(itemChip(item("cap:x", "capability", "pcb", { version: null }))).toBe("");
  });

  it("the file to open is the source before its entry", () => {
    expect(sourceFile(ITEMS[1]!)).toBe("packages/ext-tscircuit/protoboard-extension.json");
    expect(sourceFile(ITEMS[0]!)).toBe("packages/ext-tscircuit/skills/circuit-board/SKILL.md");
    expect(sourceFile({ source: "#nothing" })).toBeUndefined();
  });
});

describe("islands", () => {
  it("pulled together by discipline: one simulation group per island that has items, none for an empty island", () => {
    const sim = new AtlasSimulation(sysmapMapGraph(GRAPH), { pullBy: "folder" });
    const keys = sim.groups().map((g) => g.key).sort();
    expect(keys).toEqual(["none", "pcb", "project", "system"]);
    expect(groupMembers(sim, "folder:pcb").map((i) => sim.nodes[i]!.id).sort()).toEqual(["op:ext-tscircuit#generate", "skill:circuit-board"]);
    sim.settle();
    // grouped: the two pcb items end nearer each other than either is to the system island's
    const at = (id: string) => sim.nodes[sim.indexOf(id)!]!;
    const d = (a: string, b: string) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    expect(d("skill:circuit-board", "op:ext-tscircuit#generate")).toBeLessThan(d("op:ext-tscircuit#generate", "pkg:@deltarobotics/uhd"));
  });

  it("island titles are the islands' names, never folder paths; kind groups the type's label", () => {
    const spec = sysmapSpec(GRAPH);
    expect(groupName("folder:pcb", spec)).toBe("PCB & EDA");
    expect(groupName("folder:none", spec)).toBe("No discipline");
    expect(groupName("kind:cli-command", spec)).toBe("CLI commands");
    expect(spec.folderTitles).toBe("names");
  });

  it("the side panel lists every island in order with its count, empty ones too, and No discipline when an item has none", () => {
    const rows = islandRows(GRAPH);
    expect(rows.map((r) => [r.id, r.count, r.empty])).toEqual([
      ["project", 2, false],
      ["research", 0, true],
      ["system", 1, false],
      ["pcb", 2, false],
      ["simulation", 0, true],
      ["none", 1, false],
    ]);
    expect(rows.find((r) => r.id === "simulation")!.note).toMatch(/No item/);
  });

  it("types in type order with counts", () => {
    expect(typeRows(GRAPH).map((t) => [t.type, t.count])).toEqual([
      ["package", 1],
      ["skill", 1],
      ["operation", 1],
      ["cli-command", 2],
      ["doc", 1],
    ]);
  });

  it("search matches names, paths, types and purposes", () => {
    const spec = sysmapSpec(GRAPH);
    const nodes = sysmapMapGraph(GRAPH).nodes;
    const found = (q: string) => nodes.filter((n) => matches(n, q, spec)).map((n) => n.id);
    expect(found("circuit-board")).toEqual(["skill:circuit-board"]);
    expect(found("CLI command")).toEqual(["cli:check", "cli:map"]);
    expect(found("what op:ext")).toEqual(["op:ext-tscircuit#generate"]);
  });
});

describe("links within and across islands", () => {
  it("a link within an island is core (always drawn); one across islands only with All links", () => {
    const byId = new Map(ITEMS.map((i) => [i.id, i]));
    expect(LINKS.map((l) => isWithinIsland(l, byId))).toEqual([true, false, true, false, false]);
    const sim = new AtlasSimulation(sysmapMapGraph(GRAPH), { pullBy: "folder" });
    const core = sim.edges.map((e) => isCoreLink(sim, "folder", e));
    expect(core).toEqual(sim.edges.map((e) => isWithinIsland({ from: sim.nodes[e.s]!.id, to: sim.nodes[e.t]!.id }, byId)));
  });

  it("an item's links in both directions, grouped by kind, out before in", () => {
    const groups = linkGroups(GRAPH, "skill:circuit-board");
    expect(groups.map((g) => [g.kind, g.direction, g.label, g.items.map((i) => i.id)])).toEqual([
      ["runs", "out", "runs", ["op:ext-tscircuit#generate"]],
      ["runs-command", "out", "runs command", ["cli:check"]],
      ["mentions", "in", "mentioned by", ["doc:docs/specs/x.md"]],
    ]);
    expect(linkGroups(GRAPH, "nope")).toEqual([]);
  });
});

describe("Show changes", () => {
  it("offers every release some item last changed in, newest first, unreleased on top; starts on the latest release", () => {
    const opts = releaseOptions(GRAPH);
    expect(opts.map((o) => [o.version, o.count])).toEqual([
      ["unreleased", 1],
      ["0.3.0", 1],
      ["0.2.0", 3],
    ]);
    expect(defaultRelease(opts)).toBe("0.3.0");
    expect(defaultRelease([{ version: "unreleased", label: "", count: 1 }])).toBe("unreleased");
    expect(defaultRelease([])).toBeNull();
  });

  it("lists the items that changed in the release with their why, by island", () => {
    expect(changedIn(GRAPH, "0.2.0").map((c) => c.item.id)).toEqual(["cli:check", "op:ext-tscircuit#generate", "doc:docs/specs/x.md"]);
    expect(changedIn(GRAPH, "0.3.0")).toEqual([{ item: ITEMS[0], why: "SKILL.md changed" }]);
    expect(changedIn(GRAPH, null)).toEqual([]);
  });

  it("rings the marked items in the text color, outside the node, and dims the rest", () => {
    const sim = new AtlasSimulation<SysmapNode>(sysmapMapGraph(GRAPH, "0.3.0"), { pullBy: "folder" });
    sim.settle();
    const mark = new Uint8Array(sim.nodes.length);
    mark[sim.indexOf("skill:circuit-board")!] = 1;
    const s = createDrawState(sim, { w: 1000, h: 700, pullBy: "folder", spec: sysmapSpec(GRAPH), mark });
    fitTo(s.cam, sim.nodes, s.w, s.h, 46, true);
    const strokes: { style: unknown; width: number }[] = [];
    const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1 };
    const noop = () => {};
    const ctx = new Proxy(
      { setTransform: noop, fillRect: noop, translate: noop, scale: noop, beginPath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, closePath: noop, fill: noop, fillText: noop, strokeRect: noop, setLineDash: noop, measureText: (t: string) => ({ width: t.length * 7 }), stroke: () => strokes.push({ style: state.strokeStyle, width: state.lineWidth as number }) },
      { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : state[k as string]), set: (_t, k, v) => ((state[k as string] = v), true) },
    ) as unknown as CanvasRenderingContext2D;
    const p = paletteFrom((t) => `token:${t}`, "mono", false, lookOf({ colorByType: false, kinds: {} }, SYSMAP_KIND_TABLE));
    for (let i = 0; i < 120; i++) {
      strokes.length = 0;
      drawAtlas(ctx, s, p, i * 16);
    }
    const ring = strokes.filter((x) => x.style === "token:text");
    expect(ring).toHaveLength(1);
    expect(ring[0]!.width * s.cam.k).toBeCloseTo(1.6, 5);
    // the others dim, as for a search
    expect(s.alpha[sim.indexOf("cli:check")!]).toBeLessThan(0.5);
    expect(s.alpha[sim.indexOf("skill:circuit-board")!]).toBeGreaterThan(0.9);
  });
});

describe("appearance keyed by item type, apart from the Atlas's", () => {
  it("every item type has a default hexagon and a swatch token; none is the accent", () => {
    expect(Object.keys(SYSMAP_TYPE_STYLE).sort()).toEqual([...ITEM_TYPE_ORDER].sort());
    expect(Object.values(SYSMAP_TYPE_STYLE).every((s) => s.shape === "hex" && !/accent|Power|Electrical|Pwm/.test(s.token))).toBe(true);
  });

  it("starts neutral (Color by type off), keeps item-type entries and drops the Atlas's kinds", () => {
    expect(parseAppearance(null, SYSMAP_KIND_TABLE)).toEqual({ colorByType: false, kinds: {} });
    const a = parseAppearance({ kinds: { skill: { color: "signalSpi", shape: "dot" }, module: { color: "text" }, render: { shape: "square" } } }, SYSMAP_KIND_TABLE);
    expect(a).toEqual({ colorByType: false, kinds: { skill: { color: "signalSpi", shape: "dot" } } });
    // the Atlas's own reading of the same keeps its kinds and drops the item types
    expect(parseAppearance({ kinds: { skill: { shape: "dot" }, render: { shape: "square" } } })).toEqual({ colorByType: true, kinds: { render: { shape: "square" } } });
    expect(parseAppearance({ colorByType: true }, SYSMAP_KIND_TABLE).colorByType).toBe(true);
  });

  it("colors, shapes and presets per item type", () => {
    let a = withKind({ colorByType: true, kinds: {} }, "doc", { color: "#AABBCC" as `#${string}` }, SYSMAP_KIND_TABLE);
    expect(kindColor(a, "doc", SYSMAP_KIND_TABLE)).toBe("#AABBCC");
    expect(kindColor(a, "skill", SYSMAP_KIND_TABLE)).toBe("domainSoftware");
    a = withPreset(a, "by-type", SYSMAP_KIND_TABLE);
    expect(kindShape(a, "package", SYSMAP_KIND_TABLE)).toBe("square");
    expect(kindShape(a, "cli-command", SYSMAP_KIND_TABLE)).toBe("diamond");
    expect(presetOf(a, SYSMAP_KIND_TABLE)).toBe("by-type");
    const look = lookOf(a, SYSMAP_KIND_TABLE);
    expect(Object.keys(look.colors)).toEqual([...ITEM_TYPE_ORDER]);
    const p = paletteFrom((t) => `token:${t}`, "mono", false, look);
    expect(p.kinds.skill).toBe("token:domainSoftware");
    expect(p.shapes["cli-command"]).toBe("diamond");
    // the Atlas's table is untouched
    expect(ATLAS_KIND_TABLE.order).not.toContain("skill");
  });

  it("is stored under its own key, apart from the Atlas's", () => {
    expect(SYSMAP_KEYS.ui).not.toBe("protoboard.atlas:ui");
    const ui = parseUi(JSON.stringify({ allLinks: true, appearance: { kinds: { view: { shape: "diamond" } } } }), SYSMAP_KIND_TABLE);
    expect(ui.allLinks).toBe(true);
    expect(ui.appearance).toEqual({ colorByType: false, kinds: { view: { shape: "diamond" } } });
    expect(parseUi(null, SYSMAP_KIND_TABLE).appearance.colorByType).toBe(false);
  });

  it("kept positions are read leniently", () => {
    expect(parsePositions(JSON.stringify({ positions: { "skill:a": [1, 2], bad: [1], worse: "x" } }))).toEqual({ "skill:a": [1, 2] });
    expect(parsePositions("not json")).toBeUndefined();
    expect(parsePositions(null)).toBeUndefined();
  });
});
