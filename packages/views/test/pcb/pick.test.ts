/** Picking (src/pcb/pick.ts): the board core's query index plus exact shape tests, by priority, honoring visible and active layers. */
import { describe, expect, it } from "vitest";
import { createDocument } from "../../../board/src/document.js";
import type { BoardRecord } from "../../../board/src/schema.js";
import { openBoardService } from "../../../board/src/service.js";
import { mm } from "../../../board/src/units.js";
import { airnodeC3, airnodeC3Records, AIRNODE_C3_NETLIST } from "../../../board/src/fixtures/airnode-c3.js";
import { defaultGroups, drawLayers } from "../../src/pcb/layers.js";
import { pickAt, pickBox, type PickContext } from "../../src/pcb/pick.js";
import { buildScene } from "../../src/pcb/scene.js";
import type { BoardDocument } from "../../src/pcb/board.js";

function ctxFor(doc: BoardDocument, opts: { hide?: string[]; active?: "top" | "bottom" } = {}): PickContext {
  const svc = openBoardService({ document: doc, journal: false, ownerLock: false, ...(doc.netlist ? { netlist: doc.netlist } : {}) });
  const snap = svc.snapshot();
  const scene = buildScene(snap.doc);
  const groups = defaultGroups(scene.copper);
  for (const h of opts.hide ?? []) groups.delete(h);
  const groupOf = new Map(drawLayers(scene.copper).map((d) => [d.id, d.group]));
  const visible = (l: string) => (l === "holes" ? groups.has("pads") || groups.has("vias") : groups.has(groupOf.get(l) ?? l));
  return { scene, query: snap.query, visible, active: opts.active ?? "top" };
}

const wpad = (ctx: PickContext, id: string) => {
  const o = ctx.scene.objects.get(id)!;
  return { x: (o.rect[0] + o.rect[2]) / 2, y: (o.rect[1] + o.rect[3]) / 2 };
};

describe("picking on the Airnode C3 fixture", () => {
  const ctx = ctxFor(airnodeC3());

  it("a pad beats its footprint, and the footprint comes next", () => {
    const p = wpad(ctx, "pad:power/ldo:2");
    const hits = pickAt(ctx, p.x, p.y, 0.05);
    expect(hits[0]).toMatchObject({ id: "pad:power/ldo:2", kind: "pad", footprint: "fp:power/ldo" });
    expect(hits.map((h) => h.id)).toContain("fp:power/ldo");
    expect(hits.findIndex((h) => h.id === "fp:power/ldo")).toBeGreaterThan(0);
  });

  it("a via at its center, a track on its line", () => {
    expect(pickAt(ctx, 10, 5, 0.05)[0].id).toBe("via:f.gnd.3");
    // the USB D+ segment from J1.A6 toward (0, -6.5): a point on the line
    const t = airnodeC3().records.get("trk:f.usb_dp.1")!;
    if (t.kind !== "track") throw new Error("not a track");
    const x = ((t.start.x + t.end.x) / 2) * 1e-6;
    const y = ((t.start.y + t.end.y) / 2) * 1e-6;
    expect(pickAt(ctx, x, y, 0.01)[0].id).toBe("trk:f.usb_dp.1");
  });

  it("a footprint by its body between pads", () => {
    // the module U1 at (10, 6.5): its body, away from its pads and the via
    expect(pickAt(ctx, 13, 9, 0.01)[0].id).toBe("fp:mcu/module");
  });

  it("a zone only by its outline, or by its inside when nothing else is there", () => {
    // empty board area inside the bottom ground zone
    const inside = pickAt(ctx, 2, 12, 0.05);
    expect(inside[0]).toMatchObject({ id: "zone:f.gnd_bottom", interior: true });
    // on the zone's outline (x = 19.5)
    expect(pickAt(ctx, 19.5, 0, 0.05)[0]).toMatchObject({ id: "zone:f.gnd_bottom" });
    expect(pickAt(ctx, 19.5, 0, 0.05)[0].interior).toBeUndefined();
    // inside the zone but on a pad: the pad, and the zone's inside is not offered
    const p = wpad(ctx, "pad:power/ldo:2");
    expect(pickAt(ctx, p.x, p.y, 0.05).some((h) => h.id === "zone:f.gnd_bottom")).toBe(false);
  });

  it("a hidden layer is not picked", () => {
    const hidden = ctxFor(airnodeC3(), { hide: ["cu:bottom"] });
    // the spare track on the bottom at (14..17, -12)
    expect(pickAt(ctx, 15.5, -12, 0.05)[0].id).toBe("trk:f.spare.1");
    expect(pickAt(hidden, 15.5, -12, 0.05).some((h) => h.id === "trk:f.spare.1")).toBe(false);
  });

  it("copper on the active layer wins over copper on another layer at the same place", () => {
    const doc = createDocument(
      [
        ...airnodeC3Records(),
        { kind: "track", id: "trk:t.top", net: "GND", layer: "top", width: mm(0.3), start: { x: mm(0), y: mm(13) }, end: { x: mm(4), y: mm(13) }, provenance: { by: "hand" } },
        { kind: "track", id: "trk:t.bot", net: "GND", layer: "bottom", width: mm(0.3), start: { x: mm(0), y: mm(13) }, end: { x: mm(4), y: mm(13) }, provenance: { by: "hand" } },
      ] as BoardRecord[],
      AIRNODE_C3_NETLIST,
    );
    expect(pickAt(ctxFor(doc, { active: "top" }), 2, 13, 0.05)[0].id).toBe("trk:t.top");
    expect(pickAt(ctxFor(doc, { active: "bottom" }), 2, 13, 0.05)[0].id).toBe("trk:t.bot");
  });

  it("picks agree with a brute-force scan over every object", () => {
    // 400 points over the board: the first hit through the index equals the first hit testing every object
    let agree = 0;
    const all = { ...ctx, query: { ...ctx.query, at: (p: { x: number; y: number }, o?: { tolerance?: number }) => [...ctx.scene.objects.values()].filter((x) => x.kind !== "ratsnest").map((x) => ({ id: x.id, kind: x.kind as never, box: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, layers: [] })).filter(() => p && o !== null) } } as PickContext;
    for (let i = 0; i < 400; i++) {
      const x = -20 + ((i * 7.31) % 40);
      const y = -15 + ((i * 3.77) % 30);
      const a = pickAt(ctx, x, y, 0.05)[0]?.id;
      const b = pickAt(all, x, y, 0.05)[0]?.id;
      if (a === b) agree++;
    }
    expect(agree).toBe(400);
  });

  it("box select: window takes what is wholly inside, crossing what it touches; pads select their footprint", () => {
    const ldo = ctx.scene.objects.get("fp:power/ldo")!.rect;
    const win = pickBox(ctx, [ldo[0] - 0.01, ldo[1] - 0.01, ldo[2] + 0.01, ldo[3] + 0.01], "window");
    expect(win).toContain("fp:power/ldo");
    expect(win.some((id) => id.startsWith("pad:"))).toBe(false);
    expect(win).not.toContain("zone:f.gnd_bottom");
    const small = [ldo[0] + 0.2, ldo[1] + 0.2, ldo[0] + 0.4, ldo[1] + 0.4] as [number, number, number, number];
    expect(pickBox(ctx, small, "window")).not.toContain("fp:power/ldo");
    expect(pickBox(ctx, small, "crossing")).toContain("fp:power/ldo");
  });
});
