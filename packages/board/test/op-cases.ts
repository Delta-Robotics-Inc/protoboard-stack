/**
 * At least one test case per registered operation (registry.test.ts fails when an operation has none). Each
 * case runs on the Airnode C3 fixture; `check` asserts the effect; ops.test.ts also proves the inverse.
 */
import { expect } from "vitest";
import type { BoardDocument, BoardRecord, FootprintRec, TrackRec, ViaRec, ZoneRec } from "../src/index.js";
import { OP_CASES_EDIT } from "./op-cases-edit.js";
import { OP_CASES_P2 } from "./op-cases-p2.js";

export interface OpCase {
  name: string;
  call: Record<string, unknown> & { op: string };
  /** The actor kind running it (default human). */
  actor?: "human" | "agent" | "host" | "system";
  check(before: BoardDocument, after: BoardDocument, created: Record<string, string>): void;
  /** The apply must fail with this text in its message. */
  fails?: string;
}

const rec = <T extends BoardRecord>(d: BoardDocument, id: string) => d.records.get(id) as T;

const OP_CASES_P1: Record<string, OpCase[]> = {
  "footprint.move": [
    {
      name: "moves by dx, dy",
      call: { op: "footprint.move", ids: ["fp:power/ldo", "fp:power/c_in"], dx: 1_000_000, dy: -250_000, tracks: "stay" },
      check(b, a) {
        expect(rec<FootprintRec>(a, "fp:power/ldo").x).toBe(rec<FootprintRec>(b, "fp:power/ldo").x + 1_000_000);
        expect(rec<FootprintRec>(a, "fp:power/c_in").y).toBe(rec<FootprintRec>(b, "fp:power/c_in").y - 250_000);
        expect(rec<FootprintRec>(a, "fp:power/ldo").provenance.edited).toBe("hand");
      },
    },
    { name: "a track is not a footprint", call: { op: "footprint.move", ids: ["trk:f.spare.1"], dx: 1, dy: 0 }, fails: "not a footprint", check() {} },
  ],
  "footprint.place": [
    {
      name: "sets position and normalizes rotation",
      call: { op: "footprint.place", id: "fp:status/led1", x: 1_000_000, rotation: -90_000 },
      check(b, a) {
        const f = rec<FootprintRec>(a, "fp:status/led1");
        expect(f.x).toBe(1_000_000);
        expect(f.y).toBe(rec<FootprintRec>(b, "fp:status/led1").y);
        expect(f.rotation).toBe(270_000);
      },
    },
  ],
  "footprint.rotate": [
    {
      name: "each about its origin",
      call: { op: "footprint.rotate", ids: ["fp:sensor/ic"], angle: 45_000 },
      check(b, a) {
        expect(rec<FootprintRec>(a, "fp:sensor/ic").rotation).toBe(45_000);
        expect(rec<FootprintRec>(a, "fp:sensor/ic").x).toBe(rec<FootprintRec>(b, "fp:sensor/ic").x);
      },
    },
    {
      name: "about a point moves the position",
      call: { op: "footprint.rotate", ids: ["fp:status/led1"], angle: 180_000, about: { x: 0, y: 0 } },
      check(b, a) {
        const f0 = rec<FootprintRec>(b, "fp:status/led1");
        const f = rec<FootprintRec>(a, "fp:status/led1");
        expect([f.x, f.y, f.rotation]).toEqual([-f0.x, -f0.y, 180_000]);
      },
    },
    {
      name: "a group about its center",
      call: { op: "footprint.rotate", ids: ["fp:status/led1", "fp:status/led2"], angle: 90_000, about: "center" },
      check(_b, a) {
        expect(rec<FootprintRec>(a, "fp:status/led1").y).toBe(rec<FootprintRec>(a, "fp:status/led2").y);
      },
    },
  ],
  "footprint.flip": [
    {
      name: "to the bottom and back",
      call: { op: "footprint.flip", ids: ["fp:sensor/c_dec"] },
      check(b, a) {
        expect(rec<FootprintRec>(a, "fp:sensor/c_dec").side).toBe("bottom");
        expect(rec<FootprintRec>(a, "fp:sensor/c_dec").x).toBe(rec<FootprintRec>(b, "fp:sensor/c_dec").x);
      },
    },
    {
      name: "a group mirrors about its center",
      call: { op: "footprint.flip", ids: ["fp:status/led1", "fp:status/r1"], about: "center" },
      check(b, a) {
        expect(rec<FootprintRec>(a, "fp:status/led1").x - rec<FootprintRec>(a, "fp:status/r1").x).toBe(-(rec<FootprintRec>(b, "fp:status/led1").x - rec<FootprintRec>(b, "fp:status/r1").x));
      },
    },
  ],
  "track.add": [
    {
      name: "a person's segment is locked, a handle maps to the id",
      call: { op: "track.add", segments: [{ handle: "a", net: "I2C_SDA", layer: "top", width: 200_000, start: { x: 0, y: 0 }, end: { x: 1_000_000, y: 0 } }] },
      check(_b, a, created) {
        const t = rec<TrackRec>(a, created.a);
        expect(t.locked).toBe(true);
        expect(t.provenance.by).toBe("hand");
      },
    },
    {
      name: "an agent's arc is open to routers",
      actor: "agent",
      call: { op: "track.add", segments: [{ handle: "arc", layer: "bottom", width: 200_000, start: { x: 0, y: 0 }, end: { x: 1_000_000, y: 1_000_000 }, sweep: 90_000 }] },
      check(_b, a, created) {
        const t = rec<TrackRec>(a, created.arc);
        expect(t.locked).toBeUndefined();
        expect(t.sweep).toBe(90_000);
        expect(t.provenance).toEqual({ by: "agent", actor: "agent:test" });
      },
    },
    { name: "a layer outside the stackup", call: { op: "track.add", segments: [{ layer: "inner1", width: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] }, fails: "not in this board's stackup", check() {} },
    { name: "an agent may not choose the id", actor: "agent", call: { op: "track.add", segments: [{ id: "trk:mine", layer: "top", width: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] }, fails: "only hosts choose ids", check() {} },
  ],
  "track.move": [
    {
      name: "translates both ends",
      call: { op: "track.move", ids: ["trk:f.i2c_sda.1"], dx: 0, dy: 100_000 },
      check(b, a) {
        const t0 = rec<TrackRec>(b, "trk:f.i2c_sda.1");
        const t = rec<TrackRec>(a, "trk:f.i2c_sda.1");
        expect(t.start.y - t0.start.y).toBe(100_000);
        expect(t.end.y - t0.end.y).toBe(100_000);
        expect(t.locked).toBe(true);
        expect(t.provenance.edited).toBe("hand");
      },
    },
  ],
  "track.delete": [{ name: "removes", call: { op: "track.delete", ids: ["trk:f.i2c_scl.1"] }, check: (_b, a) => expect(a.records.has("trk:f.i2c_scl.1")).toBe(false) }],
  "via.add": [
    {
      name: "a through via by default",
      call: { op: "via.add", vias: [{ handle: "v", net: "GND", x: 0, y: 0, outer_diameter: 600_000, hole_diameter: 300_000 }] },
      check(_b, a, created) {
        const v = rec<ViaRec>(a, created.v);
        expect([v.from_layer, v.to_layer, v.locked]).toEqual(["top", "bottom", true]);
      },
    },
    { name: "hole bigger than the pad", call: { op: "via.add", vias: [{ x: 0, y: 0, outer_diameter: 300_000, hole_diameter: 300_000 }] }, fails: "smaller than the outer", check() {} },
    { name: "upside down layers", call: { op: "via.add", vias: [{ x: 0, y: 0, outer_diameter: 600_000, hole_diameter: 300_000, from_layer: "bottom", to_layer: "top" }] }, fails: "must be above", check() {} },
  ],
  "via.move": [{ name: "translates", call: { op: "via.move", ids: ["via:f.gnd.1"], dx: 250_000, dy: 0 }, check: (b, a) => expect(rec<ViaRec>(a, "via:f.gnd.1").x - rec<ViaRec>(b, "via:f.gnd.1").x).toBe(250_000) }],
  "via.delete": [{ name: "removes", call: { op: "via.delete", ids: ["via:f.gnd.2"] }, check: (_b, a) => expect(a.records.has("via:f.gnd.2")).toBe(false) }],
  "net.set": [
    { name: "assigns", call: { op: "net.set", ids: ["trk:f.spare.1"], net: "+3V3" }, check: (_b, a) => expect(rec<TrackRec>(a, "trk:f.spare.1").net).toBe("+3V3") },
    { name: "clears", call: { op: "net.set", ids: ["via:f.gnd.3"], net: null }, check: (_b, a) => expect(rec<ViaRec>(a, "via:f.gnd.3").net).toBeUndefined() },
  ],
  "zone.add": [
    {
      name: "adds with a handle",
      call: { op: "zone.add", handle: "z", zone: { net: "+3V3", layers: ["top"], outline: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }, { x: 0, y: 1_000_000 }], priority: 2, pad_connection: "solid", fill_mode: "solid", remove_islands: "never" } },
      check: (_b, a, created) => expect(rec<ZoneRec>(a, created.z).priority).toBe(2),
    },
  ],
  "zone.edit": [
    {
      name: "patch and unset",
      call: { op: "zone.edit", id: "zone:f.gnd_bottom", patch: { priority: 3 }, unset: ["clearance"] },
      check(_b, a) {
        const z = rec<ZoneRec>(a, "zone:f.gnd_bottom");
        expect(z.priority).toBe(3);
        expect(z.clearance).toBeUndefined();
      },
    },
    { name: "required fields stay", call: { op: "zone.edit", id: "zone:f.gnd_bottom", patch: {}, unset: ["layers"] }, fails: "cannot be removed", check() {} },
  ],
  "zone.delete": [{ name: "removes", call: { op: "zone.delete", ids: ["zone:f.gnd_bottom"] }, check: (_b, a) => expect(a.records.has("zone:f.gnd_bottom")).toBe(false) }],
  "keepout.add": [
    {
      name: "states what it blocks",
      call: { op: "keepout.add", handle: "k", keepout: { outline: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }, { x: 0, y: 1_000_000 }], layers: ["top"], blocks: { tracks: false, vias: true, pours: false, footprints: false }, tier: "policy" } },
      check: (_b, a, created) => expect(a.records.get(created.k)?.kind).toBe("keepout"),
    },
  ],
  "keepout.edit": [{ name: "tier", call: { op: "keepout.edit", id: "kpo:f.antenna", patch: { tier: "policy" } }, check: (_b, a) => expect((a.records.get("kpo:f.antenna") as { tier: string }).tier).toBe("policy") }],
  "keepout.delete": [{ name: "removes", call: { op: "keepout.delete", ids: ["kpo:f.antenna"] }, check: (_b, a) => expect(a.records.has("kpo:f.antenna")).toBe(false) }],
  "outline.set": [
    {
      name: "replaces the outline",
      call: { op: "outline.set", outline: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] },
      check: (_b, a) => expect((a.records.get("outline") as { outline: unknown[] }).outline).toHaveLength(4),
    },
  ],
  lock: [{ name: "locks", call: { op: "lock", ids: ["fp:mcu/module", "fp:usb/connector"] }, check: (_b, a) => expect((a.records.get("fp:mcu/module") as { locked?: true }).locked).toBe(true) }],
  unlock: [{ name: "unlocks", call: { op: "unlock", ids: ["trk:f.vbus.1"] }, check: (_b, a) => expect((a.records.get("trk:f.vbus.1") as { locked?: true }).locked).toBeUndefined() }],
  "rule.set": [
    {
      name: "creates a rule",
      call: { op: "rule.set", rule: { id: "rule:target.usb_gap", tier: "target", check: "diff_pair_gap", applies: { classes: ["usb"] }, min: 150_000 } },
      check: (_b, a) => expect((a.records.get("rule:target.usb_gap") as { provenance: { by: string } }).provenance.by).toBe("hand"),
    },
    { name: "bad id", call: { op: "rule.set", rule: { id: "fp:x", tier: "target", check: "clearance", applies: {} } }, fails: "not a rule:<name> id", check() {} },
  ],
  "rule.delete": [{ name: "removes", call: { op: "rule.delete", ids: ["rule:policy.via_under_module"] }, check: (_b, a) => expect(a.records.has("rule:policy.via_under_module")).toBe(false) }],
  "netclass.set": [{ name: "replaces", call: { op: "netclass.set", netclass: { id: "class:usb", name: "usb", nets: ["USB_DP", "USB_DN"] } }, check: (_b, a) => expect((a.records.get("class:usb") as { nets?: string[] }).nets).toEqual(["USB_DP", "USB_DN"]) }],
  "netclass.delete": [{ name: "removes", call: { op: "netclass.delete", ids: ["class:power"] }, check: (_b, a) => expect(a.records.has("class:power")).toBe(false) }],
  "record.put": [
    {
      name: "a host writes a whole record",
      actor: "host",
      call: { op: "record.put", records: [{ kind: "text", id: "txt:f.rev", layer: "top_silkscreen", text: "rev B", x: 0, y: 0, height: 1_000_000, provenance: { by: "imported", tool: "test" } }] },
      check: (_b, a) => expect(a.records.get("txt:f.rev")?.kind).toBe("text"),
    },
    { name: "id must fit the kind", actor: "host", call: { op: "record.put", records: [{ kind: "text", id: "trk:x", layer: "top_silkscreen", text: "x", x: 0, y: 0, height: 1, provenance: { by: "system" } }] }, fails: "not a valid id", check() {} },
  ],
  "record.remove": [{ name: "a host removes any record", actor: "host", call: { op: "record.remove", ids: ["txt:f.title", "fp:ui/boot_button"] }, check: (_b, a) => expect(a.records.has("fp:ui/boot_button")).toBe(false) }],
};

/** Every case by operation: Phase 1, then the Phase 2 sets (a name in two sets gets both lists). */
export const OP_CASES: Record<string, OpCase[]> = {};
for (const set of [OP_CASES_P1, OP_CASES_P2, OP_CASES_EDIT]) for (const [name, cases] of Object.entries(set)) OP_CASES[name] = [...(OP_CASES[name] ?? []), ...cases];
