/** netlist.sync (Phase 2 contract, section 2.3): renames by pin membership, orphans, net classes, exact inverse. */
import { describe, expect, it } from "vitest";
import { AIRNODE_C3_NETLIST, airnodeC3 } from "../src/fixtures/airnode-c3.js";
import { documentsEqual, getOperation, provenanceFor, type ApplyContext, type BoardDocument, type NetclassRec, type Netlist, type OpCall, type TrackRec, type ViaRec, type ZoneRec } from "../src/index.js";

function ctxFor(kind: "host" | "system"): ApplyContext {
  const actor = { kind, id: kind };
  let n = 0;
  return { actor, issueId: (k) => `${k}:test.${++n}`, provenance: provenanceFor(actor), lockCopper: false };
}
function applyCall(doc: BoardDocument, call: OpCall, ctx: ApplyContext) {
  const def = getOperation(call.op)!;
  const { op: _o, ...args } = call;
  return def.apply(doc, def.input.parse(args), ctx);
}
const applyAll = (doc: BoardDocument, calls: OpCall[]) => calls.reduce((d, c) => applyCall(d, c, ctxFor("system")).doc, doc);

const nets = (edit: (n: Netlist["nets"][number]) => Netlist["nets"][number] | undefined): Netlist => ({
  source: "fixture",
  nets: AIRNODE_C3_NETLIST.nets.map(edit).filter((n): n is Netlist["nets"][number] => n !== undefined),
});
const sync = (doc: BoardDocument, netlist: Netlist | null, rename?: "pins" | "none") => applyCall(doc, { op: "netlist.sync", netlist, ...(rename ? { rename } : {}) }, ctxFor("host"));
const net = (d: BoardDocument, id: string) => (d.records.get(id) as TrackRec | ViaRec | ZoneRec).net;

describe("netlist.sync", () => {
  it("maps a renamed net by its pins and renames its copper", () => {
    const before = airnodeC3();
    const r = sync(before, nets((n) => (n.name === "I2C_SDA" ? { ...n, name: "SDA" } : n)));
    expect(r.report).toEqual({ renamed: { I2C_SDA: "SDA" }, orphaned: [], added: ["SDA"], removed: ["I2C_SDA"], missingFootprints: [], unusedFootprints: [] });
    expect([net(r.doc, "trk:f.i2c_sda.1"), net(r.doc, "trk:f.i2c_sda.2")]).toEqual(["SDA", "SDA"]);
    expect(r.changed.sort()).toEqual(["trk:f.i2c_sda.1", "trk:f.i2c_sda.2"]);
    expect(r.doc.nets.get("SDA")?.pads).toEqual(before.nets.get("I2C_SDA")?.pads);
    expect(r.doc.padNets.get("pad:sensor/ic:1")).toBe("SDA");
  });

  it("renames net-class nets entries and zones", () => {
    const r = sync(airnodeC3(), nets((n) => (n.name === "GND" ? { ...n, name: "VSS" } : n)));
    expect((r.doc.records.get("class:power") as NetclassRec).nets).toEqual(["+3V3", "VSS", "VBUS"]);
    expect(net(r.doc, "zone:f.gnd_bottom")).toBe("VSS");
    expect(net(r.doc, "via:f.gnd.1")).toBe("VSS");
    expect(r.report?.orphaned).toEqual([]);
  });

  it("merging into an existing net drops the duplicate class entry", () => {
    // +3V3's pins move into VBUS: +3V3 disappears, maps to VBUS, and class:power lists VBUS once
    const v3 = AIRNODE_C3_NETLIST.nets.find((n) => n.name === "+3V3")!;
    const r = sync(airnodeC3(), nets((n) => (n.name === "+3V3" ? undefined : n.name === "VBUS" ? { ...n, pins: [...n.pins, ...v3.pins] } : n)));
    expect(r.report?.renamed).toEqual({ "+3V3": "VBUS" });
    expect((r.doc.records.get("class:power") as NetclassRec).nets).toEqual(["VBUS", "GND"]);
    expect(net(r.doc, "trk:f.3v3.arc")).toBe("VBUS");
  });

  it("orphans copper of a net that vanished without a match", () => {
    const r = sync(airnodeC3(), nets((n) => (n.name === "USB_DP" ? undefined : n)));
    expect(r.report?.orphaned).toEqual(["trk:f.usb_dp.1"]);
    expect(r.report?.removed).toEqual(["USB_DP"]);
    expect(net(r.doc, "trk:f.usb_dp.1")).toBeUndefined();
    expect((r.doc.records.get("trk:f.usb_dp.1") as TrackRec).provenance.edited).toBeUndefined(); // a host's edit
  });

  it("needs at least half of the old net's pins on the board", () => {
    // I2C_SDA has three pins; a new net holding one of them is not a match, two of them is
    const one = sync(airnodeC3(), nets((n) => (n.name === "I2C_SDA" ? { ...n, name: "X", pins: ["U3.1"] } : n)));
    expect(one.report?.renamed).toEqual({});
    expect(one.report?.orphaned).toEqual(["trk:f.i2c_sda.1", "trk:f.i2c_sda.2"]);
    const two = sync(airnodeC3(), nets((n) => (n.name === "I2C_SDA" ? { ...n, name: "X", pins: ["U3.1", "U1.15"] } : n)));
    expect(two.report?.renamed).toEqual({ I2C_SDA: "X" });
  });

  it("rename none maps nothing", () => {
    const r = sync(airnodeC3(), nets((n) => (n.name === "I2C_SDA" ? { ...n, name: "SDA" } : n)), "none");
    expect(r.report?.renamed).toEqual({});
    expect(r.report?.orphaned).toEqual(["trk:f.i2c_sda.1", "trk:f.i2c_sda.2"]);
  });

  it("reports missing and unused footprints without adding or removing any", () => {
    const r = sync(
      airnodeC3(),
      nets((n) => (n.name === "LED1_A" ? undefined : n.name === "GND" ? { ...n, pins: [...n.pins.filter((p) => p !== "D1.2"), "U9.1"] } : n)),
    );
    expect(r.report?.missingFootprints).toEqual(["U9"]);
    expect(r.report?.unusedFootprints).toEqual(["fp:status/led1"]);
    expect(r.doc.records.has("fp:status/led1")).toBe(true);
    expect(r.doc.nets.get("GND")?.missing).toEqual(["U9.1"]);
  });

  it("null removes the netlist; nothing is orphaned", () => {
    const before = airnodeC3();
    const r = sync(before, null);
    expect(r.doc.netlist).toBeUndefined();
    expect(r.doc.nets.size).toBe(0);
    expect(r.changed).toEqual([]);
    expect(documentsEqual(applyAll(r.doc, r.inverse), before)).toBe(true);
  });

  it("the inverse restores the netlist first, then the records, exactly", () => {
    const before = airnodeC3();
    for (const next of [
      nets((n) => (n.name === "I2C_SDA" ? { ...n, name: "SDA" } : n)),
      nets((n) => (n.name === "GND" ? { ...n, name: "VSS" } : n)),
      nets((n) => (n.name === "USB_DP" || n.name === "VBUS" ? undefined : n)),
      { source: "kicad", nets: [] },
    ]) {
      const r = sync(before, next);
      expect(r.inverse[0]).toEqual({ op: "netlist.sync", netlist: AIRNODE_C3_NETLIST, rename: "none" });
      expect(r.inverse.slice(1).every((c) => c.op === "record.put" || c.op === "record.remove")).toBe(true);
      const back = applyAll(r.doc, r.inverse);
      expect(documentsEqual(back, before)).toBe(true);
      expect(back.nets.get("I2C_SDA")?.pads).toEqual(before.nets.get("I2C_SDA")?.pads);
    }
  });

  it("from a board without a netlist, copper on nets the new one lacks is orphaned", () => {
    const bare = applyCall(airnodeC3(), { op: "netlist.sync", netlist: null }, ctxFor("system")).doc;
    const r = sync(bare, nets((n) => (n.name === "I2C_SCL" ? undefined : n)));
    expect(r.report?.orphaned).toEqual(["trk:f.i2c_scl.1"]);
    expect(r.report?.added).toHaveLength(14);
    expect(r.inverse[0]).toEqual({ op: "netlist.sync", netlist: null, rename: "none" });
    expect(documentsEqual(applyAll(r.doc, r.inverse), bare)).toBe(true);
  });
});
