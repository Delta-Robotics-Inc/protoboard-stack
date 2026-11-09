/**
 * The transaction engine (contract section 9): all-or-nothing transactions, versions, stale-write refusal,
 * idempotent resend, handles, locks, leases, per-actor undo and redo, change-set revert.
 */
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "../src/fixtures/airnode-c3.js";
import { createEngine, documentsEqual, HUMAN, mm, type Actor, type FootprintRec, type Reply, type TrackRec } from "../src/index.js";

const AGENT: Actor = { kind: "agent", id: "s1", name: "router helper" };
const AGENT2: Actor = { kind: "agent", id: "s2" };
const ROUTER: Actor = { kind: "router", id: "freerouting" };
let n = 0;
const bid = () => `b${++n}`;

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const engine = createEngine(airnodeC3(), { epoch: "ep0001", now: clock.now });
  return { engine, clock };
}
const move = (id: string, dx: number) => ({ op: "footprint.move", ids: [id], dx, dy: 0, tracks: "stay" });
const ok = (r: Reply) => {
  expect(r.status, JSON.stringify(r)).toBe("applied");
  return r as Extract<Reply, { changed: string[] }>;
};

describe("transactions and versions", () => {
  it("bumps seq once per transaction and versions per object", () => {
    const { engine } = setup();
    expect(engine.seq).toBe(0);
    expect(engine.version("fp:power/ldo")).toBe(1);
    const r = ok(engine.apply({ batchId: bid(), label: "move the ldo right", ops: [move("fp:power/ldo", mm(1)), move("fp:power/c_in", mm(1))] }, HUMAN));
    expect(r.seq).toBe(1);
    expect(r.versions).toEqual({ "fp:power/c_in": 2, "fp:power/ldo": 2 });
    expect(engine.version("fp:power/ldo")).toBe(2);
    expect(engine.log()).toHaveLength(1);
  });

  it("is all or nothing: a failing op leaves the document untouched", () => {
    const { engine } = setup();
    const before = engine.doc;
    const r = engine.apply({ batchId: bid(), label: "move then fail badly", ops: [move("fp:power/ldo", mm(1)), move("fp:nope", 1)] }, HUMAN);
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") expect(r.index).toBe(1);
    expect(engine.doc).toBe(before);
    expect(engine.seq).toBe(0);
  });

  it("checks the envelope: label words, op count, batch id", () => {
    const { engine } = setup();
    expect(engine.apply({ batchId: bid(), label: "move", ops: [move("fp:power/ldo", 1)] }, HUMAN).status).toBe("invalid");
    expect(engine.apply({ batchId: bid(), label: "move the ldo", ops: [] }, HUMAN).status).toBe("invalid");
    expect(engine.apply({ batchId: "bad id!", label: "move the ldo", ops: [move("fp:power/ldo", 1)] }, HUMAN).status).toBe("invalid");
  });

  it("returns the first reply for a resent batch id", () => {
    const { engine } = setup();
    const tx = { batchId: bid(), label: "move the ldo right", ops: [move("fp:power/ldo", mm(1))] };
    ok(engine.apply(tx, HUMAN));
    const again = engine.apply(tx, HUMAN);
    expect(again.duplicate).toBe(true);
    expect(engine.seq).toBe(1);
  });

  it("refuses stale seq, versions and regions with what the writer missed", () => {
    const { engine } = setup();
    ok(engine.apply({ batchId: bid(), label: "person nudges the ldo", ops: [move("fp:power/ldo", mm(1))] }, HUMAN));
    const s = engine.apply({ batchId: bid(), label: "agent moves the sensor", ops: [move("fp:sensor/ic", 1)], expectSeq: 0 }, AGENT);
    expect(s.status === "refused" && s.reason).toBe("stale-seq");
    if (s.status === "refused") expect(s.missed?.map((m) => m.seq)).toEqual([1]);
    const v = engine.apply({ batchId: bid(), label: "agent moves the ldo", ops: [move("fp:power/ldo", 1)], expectVersions: { "fp:power/ldo": 1 } }, AGENT);
    expect(v.status === "refused" && v.reason).toBe("stale-versions");
    if (v.status === "refused") expect(v.conflicts?.[0]).toMatchObject({ id: "fp:power/ldo", expected: 1, current: 2, by: HUMAN, seq: 1 });
    // the ldo's region changed after seq 0; a region elsewhere did not
    const near = engine.apply({ batchId: bid(), label: "agent routes near the ldo", ops: [move("fp:sensor/ic", 1)], expectRegion: { box: { minX: mm(-12), minY: mm(-5), maxX: mm(-8), maxY: mm(-1) }, seq: 0 } }, AGENT);
    expect(near.status === "refused" && near.reason).toBe("stale-region");
    ok(engine.apply({ batchId: bid(), label: "agent routes far away", ops: [move("fp:sensor/ic", 1)], expectRegion: { box: { minX: mm(10), minY: mm(-14), maxX: mm(19), maxY: mm(-10) }, seq: 0 } }, AGENT));
    expect(engine.apply({ batchId: bid(), label: "new object must be absent", ops: [move("fp:sensor/ic", 1)], expectVersions: { "trk:new": 0 } }, AGENT).status).toBe("applied");
    expect(engine.apply({ batchId: bid(), label: "after a restart of service", ops: [move("fp:sensor/ic", 1)], expectEpoch: "other" }, AGENT).status).toBe("refused");
  });

  it("resolves handles inside a transaction and returns the new ids", () => {
    const { engine } = setup();
    const r = ok(
      engine.apply(
        {
          batchId: bid(),
          label: "add a segment and lock it",
          ops: [
            { op: "track.add", segments: [{ handle: "a", net: "EN", layer: "top", width: mm(0.2), start: { x: 0, y: 0 }, end: { x: mm(1), y: 0 } }] },
            { op: "track.move", ids: ["$a"], dx: 0, dy: mm(0.5) },
          ],
        },
        AGENT,
      ),
    );
    expect(r.created.a).toBe("trk:ep0001.1");
    expect((engine.doc.records.get(r.created.a) as TrackRec).start.y).toBe(mm(0.5));
    expect(engine.apply({ batchId: bid(), label: "use a missing handle", ops: [{ op: "track.delete", ids: ["$zz"] }] }, AGENT).status).toBe("invalid");
  });

  it("validates references: unknown nets and layers are refused", () => {
    const { engine } = setup();
    const r = engine.apply({ batchId: bid(), label: "add copper on a ghost net", ops: [{ op: "track.add", segments: [{ net: "NOPE", layer: "top", width: 1000, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] }] }, HUMAN);
    expect(r.status === "invalid" && r.error).toMatch(/not in the netlist/);
  });

  it("a dry run commits nothing", () => {
    const { engine } = setup();
    const r = engine.apply({ batchId: bid(), label: "try a move first", ops: [move("fp:power/ldo", 1)], dryRun: true }, HUMAN);
    expect(r.status).toBe("valid");
    expect(engine.seq).toBe(0);
  });
});

describe("locks and person-only changes", () => {
  it("agents and routers leave locked objects alone; a person does not", () => {
    const { engine } = setup();
    const a = engine.apply({ batchId: bid(), label: "agent moves the connector", ops: [move("fp:usb/connector", 1)] }, AGENT);
    expect(a.status === "refused" && a.reason).toBe("locked");
    const r = engine.apply({ batchId: bid(), label: "router rips hand copper", ops: [{ op: "track.delete", ids: ["trk:f.vbus.1"] }] }, ROUTER);
    expect(r.status === "refused" && r.reason).toBe("locked");
    ok(engine.apply({ batchId: bid(), label: "person moves the connector", ops: [move("fp:usb/connector", 1)] }, HUMAN));
    expect((engine.doc.records.get("fp:usb/connector") as FootprintRec).locked).toBe(true);
  });

  it("an agent's unlock and net change wait for a person; its lock goes through", () => {
    const { engine } = setup();
    const u = engine.apply({ batchId: bid(), label: "agent unlocks hand copper", ops: [{ op: "unlock", ids: ["trk:f.vbus.1"] }] }, AGENT);
    expect(u.status === "refused" && u.reason).toBe("needs-person");
    const n2 = engine.apply({ batchId: bid(), label: "agent renames copper net", ops: [{ op: "net.set", ids: ["trk:f.spare.1"], net: "EN" }] }, AGENT);
    expect(n2.status === "refused" && n2.reason).toBe("needs-person");
    ok(engine.apply({ batchId: bid(), label: "agent locks the module", ops: [{ op: "lock", ids: ["fp:mcu/module"] }] }, AGENT));
    ok(engine.apply({ batchId: bid(), label: "person unlocks hand copper", ops: [{ op: "unlock", ids: ["trk:f.vbus.1"] }] }, HUMAN));
  });

  it("a person's new copper is locked against routers by default", () => {
    const { engine } = setup();
    const r = ok(engine.apply({ batchId: bid(), label: "person draws a segment", ops: [{ op: "track.add", segments: [{ handle: "t", layer: "top", width: mm(0.2), start: { x: 0, y: 0 }, end: { x: mm(1), y: 0 } }] }] }, HUMAN));
    const rr = engine.apply({ batchId: bid(), label: "router moves that segment", ops: [{ op: "track.move", ids: [r.created.t], dx: 1, dy: 0 }] }, ROUTER);
    expect(rr.status === "refused" && rr.reason).toBe("locked");
  });
});

describe("leases", () => {
  it("blocks other writers, fences stale tokens, and a person's edit revokes", () => {
    const { engine, clock } = setup();
    const c = engine.claim(AGENT, { roots: ["power"], purpose: "tidy the power section" });
    expect(c.status).toBe("granted");
    if (c.status !== "granted") return;
    expect(engine.claim(AGENT2, { roots: ["power/ldo"], purpose: "move the ldo" }).status).toBe("refused");
    const blocked = engine.apply({ batchId: bid(), label: "other agent moves ldo", ops: [move("fp:power/ldo", 1)] }, AGENT2);
    expect(blocked.status === "refused" && blocked.reason).toBe("leased");
    const noToken = engine.apply({ batchId: bid(), label: "holder forgets its token", ops: [move("fp:power/ldo", 1)] }, AGENT);
    expect(noToken.status === "refused" && noToken.reason).toBe("lease-revoked");
    ok(engine.apply({ batchId: bid(), label: "holder moves the ldo", ops: [move("fp:power/ldo", 1)], leaseToken: c.lease.token }, AGENT));
    // a net lease covers the copper of that net and footprints with pads on it
    const nl = engine.claim(AGENT2, { nets: ["I2C_SDA"], purpose: "route the sda net" });
    expect(nl.status).toBe("granted");
    const t = engine.apply({ batchId: bid(), label: "agent moves an sda segment", ops: [{ op: "track.move", ids: ["trk:f.i2c_sda.1"], dx: 1, dy: 0 }] }, AGENT);
    expect(t.status === "refused" && t.reason).toBe("leased");
    // the person moves a power part: the agent's lease there is revoked, and its old token stops working
    ok(engine.apply({ batchId: bid(), label: "person moves the input cap", ops: [move("fp:power/c_in", 1)] }, HUMAN));
    expect(engine.presence().leases.map((l) => l.holder.id)).toEqual(["s2"]);
    const stale = engine.apply({ batchId: bid(), label: "holder writes after revoke", ops: [move("fp:power/ldo", 1)], leaseToken: c.lease.token }, AGENT);
    expect(stale.status === "refused" && stale.reason).toBe("lease-revoked");
    // leases expire
    clock.advance(121_000);
    expect(engine.presence().leases).toEqual([]);
  });

  it("region leases cover objects whose boxes meet the region on its layers", () => {
    const { engine } = setup();
    expect(engine.claim(ROUTER, { region: { box: { minX: mm(-20), minY: mm(-15), maxX: mm(0), maxY: mm(0) }, layers: ["bottom"] }, purpose: "reroute bottom left" }).status).toBe("granted");
    const r = engine.apply({ batchId: bid(), label: "agent moves gnd via", ops: [{ op: "via.move", ids: ["via:f.gnd.1"], dx: 1, dy: 0 }] }, AGENT);
    expect(r.status === "refused" && r.reason).toBe("leased");
    // top-only copper in the region is not covered
    ok(engine.apply({ batchId: bid(), label: "agent moves usb segment", ops: [{ op: "track.move", ids: ["trk:f.usb_dp.1"], dx: 1, dy: 0 }] }, AGENT));
    expect(engine.takeOver(HUMAN)).toHaveLength(1);
  });

  it("only agents, routers and hosts take leases", () => {
    const { engine } = setup();
    expect(engine.claim(HUMAN, { roots: [""], purpose: "everything" }).status).toBe("invalid");
  });
});

describe("undo and redo per actor", () => {
  it("undoes each actor's own last transaction, never another's", () => {
    const { engine } = setup();
    const start = engine.doc;
    ok(engine.apply({ batchId: bid(), label: "agent moves the sensor", ops: [move("fp:sensor/ic", mm(1))] }, AGENT));
    ok(engine.apply({ batchId: bid(), label: "person moves the ldo", ops: [move("fp:power/ldo", mm(1))] }, HUMAN));
    ok(engine.undo(HUMAN));
    expect((engine.doc.records.get("fp:power/ldo") as FootprintRec).x).toBe((start.records.get("fp:power/ldo") as FootprintRec).x);
    expect((engine.doc.records.get("fp:sensor/ic") as FootprintRec).x).toBe((start.records.get("fp:sensor/ic") as FootprintRec).x + mm(1));
    expect(engine.undo(HUMAN).status).toBe("refused");
    ok(engine.undo(AGENT));
    expect(documentsEqual(engine.doc, start)).toBe(true);
  });

  it("refuses an undo when what it changed was changed again since", () => {
    const { engine } = setup();
    ok(engine.apply({ batchId: bid(), label: "agent moves the sensor", ops: [move("fp:sensor/ic", mm(1))] }, AGENT));
    ok(engine.apply({ batchId: bid(), label: "person moves the sensor", ops: [move("fp:sensor/ic", mm(1))] }, HUMAN));
    const r = engine.undo(AGENT);
    expect(r.status === "refused" && r.reason).toBe("stale-undo");
  });

  it("redoes in order and a new change clears redo", () => {
    const { engine } = setup();
    const start = engine.doc;
    ok(engine.apply({ batchId: bid(), label: "first move of ldo", ops: [move("fp:power/ldo", mm(1))] }, HUMAN));
    const afterOne = engine.doc;
    ok(engine.apply({ batchId: bid(), label: "second move of ldo", ops: [move("fp:power/ldo", mm(1))] }, HUMAN));
    const afterTwo = engine.doc;
    ok(engine.undo(HUMAN));
    ok(engine.undo(HUMAN));
    expect(documentsEqual(engine.doc, start)).toBe(true);
    ok(engine.redo(HUMAN));
    expect(documentsEqual(engine.doc, afterOne)).toBe(true);
    ok(engine.redo(HUMAN));
    expect(documentsEqual(engine.doc, afterTwo)).toBe(true);
    expect(engine.redo(HUMAN).status).toBe("refused");
    ok(engine.undo(HUMAN));
    ok(engine.apply({ batchId: bid(), label: "a different ldo move", ops: [move("fp:power/ldo", -1)] }, HUMAN));
    const r = engine.redo(HUMAN);
    expect(r.status === "refused" && r.reason).toBe("nothing-to-redo");
  });

  it("undo restores created and deleted records exactly", () => {
    const { engine } = setup();
    const start = engine.doc;
    ok(
      engine.apply(
        {
          batchId: bid(),
          label: "rip and redraw some copper",
          ops: [
            { op: "track.delete", ids: ["trk:f.i2c_scl.1"] },
            { op: "via.add", vias: [{ net: "GND", x: 0, y: 0, outer_diameter: mm(0.6), hole_diameter: mm(0.3) }] },
            { op: "zone.edit", id: "zone:f.gnd_bottom", patch: { priority: 4 } },
          ],
        },
        AGENT,
      ),
    );
    ok(engine.undo(AGENT));
    expect(documentsEqual(engine.doc, start)).toBe(true);
  });

  it("reverts a whole change set, and refuses when someone else changed part of it", () => {
    const { engine } = setup();
    const start = engine.doc;
    const cs = { id: "cs.tidy", title: "tidy the status leds" };
    ok(engine.apply({ batchId: bid(), label: "move the first led", ops: [move("fp:status/led1", mm(1))], changeSet: cs }, AGENT));
    ok(engine.apply({ batchId: bid(), label: "move the second led", ops: [move("fp:status/led2", mm(1))], changeSet: cs }, AGENT));
    expect(engine.changeSets()[0]).toMatchObject({ id: "cs.tidy", title: "tidy the status leds", entries: [1, 2] });
    ok(engine.revertChangeSet(HUMAN, "cs.tidy"));
    expect(documentsEqual(engine.doc, start)).toBe(true);

    const cs2 = { id: "cs.again" };
    ok(engine.apply({ batchId: bid(), label: "move the first led", ops: [move("fp:status/led1", mm(1))], changeSet: cs2 }, AGENT));
    ok(engine.apply({ batchId: bid(), label: "person nudges led one", ops: [move("fp:status/led1", 1)] }, HUMAN));
    const r = engine.revertChangeSet(HUMAN, "cs.again");
    expect(r.status === "refused" && r.reason).toBe("stale-undo");
  });
});
