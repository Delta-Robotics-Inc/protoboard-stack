/** The renderer's scene (src/pcb/scene.ts) and its GPU buffers (buffers.ts): built from a board snapshot, kept up to date by commits. */
import { describe, expect, it } from "vitest";
import { createDocument } from "@protoboardai/board";
import type { BoardRecord, FootprintRec } from "@protoboardai/board";
import { openBoardService } from "@protoboardai/board";
import { HUMAN } from "@protoboardai/board";
import { mm } from "@protoboardai/board";
import "@protoboardai/board";
import { airnodeC3, airnodeC3Records, AIRNODE_C3_NETLIST } from "@protoboardai/board/fixtures/airnode-c3";
import { SceneBuffers } from "../../src/pcb/buffers.js";
import { FLAG, INSTANCE_FLOATS, partHit, type Part } from "../../src/pcb/geom.js";
import { drawOrder } from "../../src/pcb/layers.js";
import { triangulate } from "../../src/pcb/triangulate.js";
import { buildScene, setFills, updateScene, type Scene } from "../../src/pcb/scene.js";

const parts = (s: Scene, id: string, layer?: string): Part[] => (s.objects.get(id)?.items ?? []).filter((i) => !layer || i.layer === layer).flatMap((i) => i.parts);

function withRecords(edit: (rs: BoardRecord[]) => BoardRecord[]) {
  return createDocument(edit(airnodeC3Records()), AIRNODE_C3_NETLIST);
}

describe("scene from the Airnode C3 fixture", () => {
  const scene = buildScene(airnodeC3());

  it("has one object per drawable record and one per pad", () => {
    const counts: Record<string, number> = {};
    for (const o of scene.objects.values()) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
    const fps = airnodeC3Records().filter((r): r is FootprintRec => r.kind === "footprint");
    expect(counts).toEqual({ footprint: fps.length, pad: fps.reduce((n, f) => n + f.pads.length, 0), track: 10, via: 3, zone: 1, keepout: 1, outline: 1, graphic: 1, text: 1 });
  });

  it("gives pads their nets from the netlist and keeps footprint pads together", () => {
    const pad = scene.objects.get("pad:usb/connector:A4")!;
    expect(pad.netName).toBe("VBUS");
    expect(scene.nets[pad.net]).toBe("VBUS");
    expect(scene.padsOf.get("fp:usb/connector")).toContain("pad:usb/connector:S~4");
    expect(pad.fp).toBe(scene.objects.get("fp:usb/connector")!.index);
  });

  it("draws smd pads on their side's pad layer, through pads on both sides with a hole", () => {
    expect(scene.objects.get("pad:power/ldo:1")!.items.map((i) => i.layer)).toEqual(expect.arrayContaining(["pads:top", "mask:top", "paste:top"]));
    const th = scene.objects.get("pad:usb/connector:S")!;
    expect(th.items.map((i) => i.layer)).toEqual(expect.arrayContaining(["pads:top", "pads:bottom", "holes"]));
    const hole = parts(scene, "pad:usb/connector:S", "holes")[0];
    expect(hole.k).toBe("box"); // a slot
  });

  it("puts the board outline under everything and its edge on top, with rounded corners", () => {
    const board = parts(scene, "outline", "board")[0];
    expect(board.k).toBe("poly");
    expect(scene.rect[2] - scene.rect[0]).toBeCloseTo(40, 3);
    expect(scene.rect[3] - scene.rect[1]).toBeCloseTo(30, 3);
    // a corner arc is tessellated: more vertices than the 8 of the contour
    expect((board as Extract<Part, { k: "poly" }>).rings[0].length / 2).toBeGreaterThan(8);
  });

  it("marks locked hand copper and autorouted copper for their own styles", () => {
    const hand = scene.objects.get("trk:f.vbus.1")!.items[0];
    const routed = scene.objects.get("trk:f.usb_dp.1")!.items[0];
    expect(hand.flags & FLAG.HAND).toBeTruthy();
    expect(routed.flags & FLAG.AUTO).toBeTruthy();
    expect(scene.objects.get("trk:f.spare.1")!.items[0].flags & FLAG.HAND).toBeFalsy(); // hand but not locked
  });

  it("tessellates arc tracks with exact end points", () => {
    const arc = parts(scene, "trk:f.3v3.arc", "cu:top")[0] as Extract<Part, { k: "path" }>;
    const rec = airnodeC3().records.get("trk:f.3v3.arc")!;
    if (rec.kind !== "track") throw new Error("not a track");
    expect(arc.k).toBe("path");
    expect(arc.pts[0]).toBeCloseTo(rec.start.x / 1e6, 9);
    expect(arc.pts[arc.pts.length - 1]).toBeCloseTo(rec.end.y / 1e6, 9);
    expect(arc.pts.length / 2).toBeGreaterThan(10);
  });

  it("hatches keep-outs inside their outline and dashes unfilled zone outlines", () => {
    const k = parts(scene, "kpo:f.antenna", "keepout");
    const hatch = k.filter((p) => p.k === "seg");
    expect(hatch.length).toBeGreaterThan(5);
    for (const h of hatch) if (h.k === "seg") for (const [x, y] of [[h.x1, h.y1], [h.x2, h.y2]]) {
      expect(x).toBeGreaterThanOrEqual(10 - 6.6 - 1e-6);
      expect(x).toBeLessThanOrEqual(10 + 6.6 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(12.4 - 2.6 - 1e-6);
    }
    const zone = scene.objects.get("zone:f.gnd_bottom")!;
    expect(zone.items.every((i) => i.layer === "cu:bottom")).toBe(true);
    expect(zone.items[0].flags & FLAG.DASHED).toBeTruthy();
  });

  it("adds net names on pads and tracks, shown only when zoomed in", () => {
    const label = scene.objects.get("pad:usb/connector:A4")!.items.find((i) => i.layer === "labels:pads")!;
    expect(label.minScale).toBeGreaterThan(0);
    expect(scene.objects.get("trk:f.vbus.1")!.items.some((i) => i.layer === "labels:tracks")).toBe(true);
  });
});

describe("scene shapes", () => {
  it("mirrors a bottom footprint: pads on the bottom pad layer, silk on bottom silk, text mirrored", () => {
    const doc = withRecords((rs) => rs.map((r) => (r.kind === "footprint" && r.ref === "SW1" ? { ...r, side: "bottom" as const } : r)));
    const s = buildScene(doc);
    const pad = s.objects.get("pad:ui/boot_button:1")!;
    expect(pad.items.map((i) => i.layer)).toContain("pads:bottom");
    expect(pad.copper).toEqual(["bottom"]);
    const fp = s.objects.get("fp:ui/boot_button")!;
    expect(fp.items.map((i) => i.layer)).toEqual(expect.arrayContaining(["silk:bottom", "crtyd:bottom"]));
    // the pad at footprint x = -1.9 lands at world x = -15 + 1.9 when mirrored
    const box = parts(s, "pad:ui/boot_button:1", "pads:bottom")[0] as Extract<Part, { k: "box" }>;
    expect(box.cx).toBeCloseTo(-15 + 1.9, 6);
  });

  it("draws rotated, polygon and round pads", () => {
    const doc = withRecords((rs) =>
      rs.map((r) => {
        if (r.kind === "footprint" && r.ref === "R1")
          return {
            ...r,
            pads: [
              { ...r.pads[0], rotation: 45_000 },
              { number: "2", type: "smd" as const, shape: "polygon" as const, x: mm(0.48), y: 0, layer: "top" as const, points: [{ x: 0, y: mm(-0.3) }, { x: mm(0.3), y: mm(0.3) }, { x: mm(-0.3), y: mm(0.3) }] },
            ],
          };
        if (r.kind === "footprint" && r.ref === "R2") return { ...r, pads: [{ number: "1", type: "smd" as const, shape: "circle" as const, x: 0, y: 0, radius: mm(0.3), layer: "top" as const }] };
        return r;
      }),
    );
    const s = buildScene(doc);
    const rot = parts(s, "pad:status/r1:1", "pads:top")[0] as Extract<Part, { k: "box" }>;
    expect(rot.a).toBeCloseTo(Math.PI / 4, 9);
    const poly = parts(s, "pad:status/r1:2", "pads:top")[0] as Extract<Part, { k: "poly" }>;
    expect(poly.k).toBe("poly");
    // the triangle's apex: footprint at (-13, 10), pad offset (0.48, 0), vertex (0, -0.3)
    expect(poly.rings[0][0]).toBeCloseTo(-13 + 0.48, 6);
    expect(poly.rings[0][1]).toBeCloseTo(10 - 0.3, 6);
    expect(parts(s, "pad:status/r2:1", "pads:top")[0].k).toBe("ring");
    const buffers = new SceneBuffers(s, triangulate);
    expect(buffers.layers.get("pads:top")!.tris.length).toBeGreaterThan(0);
    expect(partHit(rot, rot.cx, rot.cy)).toBe(true);
  });

  it("draws a blind via with its span and its own mark", () => {
    const doc = withRecords((rs) => ([
      ...rs.map((r) => (r.kind === "board" ? { ...r, copper_layers: 4 } : r)),
      { kind: "layer", id: "layer:inner1", name: "inner1", type: "copper", order: 2, thickness: mm(0.035) },
      { kind: "layer", id: "layer:inner2", name: "inner2", type: "copper", order: 3, thickness: mm(0.035) },
      { kind: "via", id: "via:blind", net: "GND", x: mm(3), y: mm(3), outer_diameter: mm(0.45), hole_diameter: mm(0.2), from_layer: "top", to_layer: "inner1", provenance: { by: "hand" } },
    ] as BoardRecord[]).map((r) => (r.kind === "layer" && r.name === "core1" ? { ...r, order: 5 } : r.kind === "layer" && r.name === "bottom" ? { ...r, order: 4 } : r.kind === "layer" && r.name === "bottom_mask" ? { ...r, order: 6 } : r)));
    const s = buildScene(doc);
    expect(s.copper).toEqual(["top", "inner1", "inner2", "bottom"]);
    const via = s.objects.get("via:blind")!;
    expect(via.copper).toEqual(["top", "inner1"]);
    expect(via.items[0].flags & FLAG.PARTIAL).toBeTruthy();
    expect(s.objects.get("via:f.gnd.1")!.items[0].flags & FLAG.PARTIAL).toBeFalsy();
    // a through pad has copper on the inner layers too
    expect(s.objects.get("pad:usb/connector:S")!.items.map((i) => i.layer)).toEqual(expect.arrayContaining(["cu:inner1", "cu:inner2"]));
  });

  it("takes zone fills handed in and redraws only that zone", () => {
    const s = buildScene(airnodeC3());
    const changed = setFills(s, [{ zone: "zone:f.gnd_bottom", layer: "bottom", polygons: [[[{ x: mm(-5), y: mm(-5) }, { x: mm(5), y: mm(-5) }, { x: mm(5), y: mm(5) }, { x: mm(-5), y: mm(5) }]]] }]);
    expect([...changed]).toEqual(["zone:f.gnd_bottom"]);
    const fill = s.objects.get("zone:f.gnd_bottom")!.items.find((i) => i.flags & FLAG.FILL)!;
    expect(fill.parts[0].k).toBe("poly");
  });

  it("orders layers bottom-most first, mirrors for the bottom view and lifts the active copper", () => {
    const top = drawOrder(["top", "inner1", "bottom"], "top", false);
    expect(top.indexOf("cu:bottom")).toBeLessThan(top.indexOf("cu:inner1"));
    expect(top.indexOf("cu:inner1")).toBeLessThan(top.indexOf("cu:top"));
    expect(top.indexOf("silk:bottom")).toBeLessThan(top.indexOf("silk:top"));
    const under = drawOrder(["top", "inner1", "bottom"], "bottom", true);
    expect(under.indexOf("silk:top")).toBeLessThan(under.indexOf("silk:bottom"));
    expect(under.indexOf("cu:top")).toBeLessThan(under.indexOf("cu:bottom"));
    const inner = drawOrder(["top", "inner1", "bottom"], "inner1", false);
    expect(inner.indexOf("cu:inner1")).toBeGreaterThan(inner.indexOf("cu:top"));
  });
});

describe("incremental updates from commit events", () => {
  function setup() {
    const svc = openBoardService({ document: airnodeC3(), netlist: AIRNODE_C3_NETLIST, journal: false, ownerLock: false });
    const scene = buildScene(svc.snapshot().doc);
    const buffers = new SceneBuffers(scene, triangulate);
    const events: { changed: string[]; created: Record<string, string>; removed: string[] }[] = [];
    svc.subscribe((e) => e.type === "commit" && events.push(e));
    return { svc, scene, buffers, events };
  }

  it("a footprint move rebuilds that footprint and its pads only, written in place", () => {
    const { svc, scene, buffers, events } = setup();
    const total = [...buffers.layers.values()].reduce((n, b) => n + b.boxes.length + b.tris.length, 0);
    const written = buffers.floatsWritten;
    const repacked = buffers.layersRepacked;
    const r = svc.apply({ batchId: "mv-1", label: "move the LDO right", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: mm(1), dy: 0, tracks: "stay" }] }, HUMAN);
    expect(r.status).toBe("applied");
    const e = events[0];
    const changed = updateScene(scene, svc.snapshot().doc, [...e.changed, ...e.removed]);
    expect(changed).not.toBe("all");
    expect([...(changed as Set<string>)].sort()).toEqual(["fp:power/ldo", "pad:power/ldo:1", "pad:power/ldo:2", "pad:power/ldo:3", "pad:power/ldo:4", "pad:power/ldo:5"]);
    const touched = buffers.update(changed);
    expect(touched.has("pads:top")).toBe(true);
    expect(buffers.layersRepacked).toBe(repacked);
    const delta = buffers.floatsWritten - written;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(total / 5);
    // the moved pad is where the board says
    const box = parts(scene, "pad:power/ldo:1", "pads:top")[0] as Extract<Part, { k: "box" }>;
    expect(box.cx).toBeCloseTo(-10 - 0.95 + 1, 6);
    const range = buffers.layers.get("pads:top")!.boxRange.get("pad:power/ldo:1")!;
    expect(buffers.layers.get("pads:top")!.boxes[range[0]]).toBeCloseTo(box.cx, 5);
    expect(range[1]).toBe(INSTANCE_FLOATS);
  });

  it("a deleted track leaves its layer, and only that layer is repacked", () => {
    const { svc, scene, buffers, events } = setup();
    const before = buffers.layers.get("cu:bottom")!.boxes.length;
    const repacked = buffers.layersRepacked;
    svc.apply({ batchId: "del-1", label: "delete the spare track", ops: [{ op: "track.delete", ids: ["trk:f.spare.1"] }] }, HUMAN);
    const e = events[0];
    const changed = updateScene(scene, svc.snapshot().doc, [...e.changed, ...e.removed]);
    expect(scene.objects.has("trk:f.spare.1")).toBe(false);
    buffers.update(changed);
    expect(buffers.layers.get("cu:bottom")!.boxes.length).toBe(before - INSTANCE_FLOATS);
    expect(buffers.layersRepacked).toBe(repacked + 1);
  });

  it("a new via appears without touching the other layers' buffers", () => {
    const { svc, scene, buffers, events } = setup();
    svc.apply({ batchId: "via-1", label: "add a ground via", ops: [{ op: "via.add", vias: [{ handle: "v", net: "GND", x: mm(5), y: mm(-12), outer_diameter: mm(0.6), hole_diameter: mm(0.3) }] }] }, HUMAN);
    const e = events[0];
    const id = e.created.v;
    const changed = updateScene(scene, svc.snapshot().doc, [...e.changed, ...Object.values(e.created)]);
    const touched = buffers.update(changed);
    expect(scene.objects.get(id)?.kind).toBe("via");
    expect([...touched].sort()).toEqual(["holes", "vias"]);
  });
});
