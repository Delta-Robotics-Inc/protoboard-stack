/** Test cases for the Phase 2 editing operations: footprint.move with attached tracks, track.drag, track.route (merged into OP_CASES). */
import { expect } from "vitest";
import type { BoardDocument, TrackRec, ViaRec } from "../src/index.js";
import type { OpCase } from "./op-cases.js";

const trk = (d: BoardDocument, id: string) => d.records.get(id) as TrackRec;
const tracksOf = (d: BoardDocument, net: string) => [...d.records.values()].filter((r): r is TrackRec => r.kind === "track" && r.net === net);
const endsAt = (t: TrackRec, x: number, y: number) => (t.start.x === x && t.start.y === y) || (t.end.x === x && t.end.y === y);

export const OP_CASES_EDIT: Record<string, OpCase[]> = {
  "footprint.move": [
    {
      name: "attached is the default: a track on a moved pad stretches with a 45 degree corner",
      call: { op: "footprint.move", ids: ["fp:power/ldo"], dx: 500_000, dy: 0 },
      check(b, a, created) {
        expect(created).toEqual({});
        // pad 5 (+3V3) moved from -10.95 to -10.45 mm: the +3V3 copper still reaches it
        expect(tracksOf(a, "+3V3").some((t) => endsAt(t, -10_450_000, -1_900_000))).toBe(true);
        // the stretched segment stays vertical from its fixed end and a new diagonal joins the moved pad
        const kept = trk(a, "trk:f.3v3.1");
        expect(kept.end).toEqual(trk(b, "trk:f.3v3.1").end);
        expect(kept.start.x).toBe(kept.end.x);
        expect(tracksOf(a, "+3V3").length).toBe(tracksOf(b, "+3V3").length + 1);
        // the person moved locked VBUS copper along too (a person may)
        expect(endsAt(trk(a, "trk:f.vbus.2"), -10_450_000, -4_100_000)).toBe(true);
      },
    },
    {
      name: "an agent's move leaves locked copper in place (detached, reported)",
      actor: "agent",
      call: { op: "footprint.move", ids: ["fp:power/ldo"], dx: 500_000, dy: 0, tracks: "attached" },
      check(b, a) {
        expect(a.records.get("trk:f.vbus.2")).toBe(b.records.get("trk:f.vbus.2"));
        expect(tracksOf(a, "+3V3").some((t) => endsAt(t, -10_450_000, -1_900_000))).toBe(true);
      },
    },
  ],
  "track.drag": [
    {
      name: "a segment slides along its normal; its neighbor re-forms the corner; the pad end gets a connector",
      call: { op: "track.drag", id: "trk:f.vbus.1", dx: 300_000, dy: 999 },
      check(b, a) {
        const t = trk(a, "trk:f.vbus.1");
        // a vertical segment moves only in x
        expect(t.start.x).toBe(-11_900_000);
        expect(t.end.x).toBe(-11_900_000);
        // the neighbor keeps its far end and now meets the moved segment
        const n = trk(a, "trk:f.vbus.2");
        expect(n.end).toEqual(trk(b, "trk:f.vbus.2").end);
        expect(n.start).toEqual(t.end);
        // the end on the connector's pad is joined by a new segment
        expect(tracksOf(a, "VBUS").length).toBe(tracksOf(b, "VBUS").length + 1);
        expect(tracksOf(a, "VBUS").some((s) => endsAt(s, -12_200_000, -9_500_000))).toBe(true);
      },
    },
    {
      name: "a via moves",
      call: { op: "track.drag", id: "via:f.gnd.1", dx: 300_000, dy: 200_000 },
      check(_b, a) {
        const v = a.records.get("via:f.gnd.1") as ViaRec;
        expect([v.x, v.y]).toEqual([-9_700_000, -5_000_000]);
      },
    },
    { name: "a drag that would short another net is refused", call: { op: "track.drag", id: "trk:f.vbus.1", dx: -500_000, dy: 0 }, fails: "would short", check() {} },
    { name: "a footprint is not draggable here", call: { op: "track.drag", id: "fp:power/ldo", dx: 1, dy: 0 }, fails: "not a track or via", check() {} },
  ],
  "track.route": [
    {
      name: "segments and a via in one operation, handles numbered in path order",
      call: {
        op: "track.route",
        net: "LED1",
        width: 250_000,
        handle: "led",
        points: [
          { x: 12_000_000, y: -6_000_000, layer: "top" },
          { x: 12_000_000, y: -7_000_000, layer: "top" },
          { x: 12_000_000, y: -7_000_000, layer: "bottom" },
          { x: 13_000_000, y: -8_000_000, layer: "bottom" },
        ],
      },
      check(_b, a, created) {
        expect(Object.keys(created).sort()).toEqual(["led_s0", "led_s1", "led_v0"]);
        const v = a.records.get(created.led_v0) as ViaRec;
        expect([v.from_layer, v.to_layer, v.net]).toEqual(["top", "bottom", "LED1"]);
        const s1 = trk(a, created.led_s1);
        expect([s1.layer, s1.start, s1.locked]).toEqual(["bottom", { x: 12_000_000, y: -7_000_000 }, true]);
      },
    },
    { name: "a layer change must stay in place", call: { op: "track.route", net: "LED1", width: 250_000, points: [{ x: 0, y: 0, layer: "top" }, { x: 1, y: 0, layer: "bottom" }] }, fails: "same x, y", check() {} },
  ],
};
