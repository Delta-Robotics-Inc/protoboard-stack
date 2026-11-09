/**
 * The layout screen's editing, without a browser: the page's edit session over a real board service (through a
 * request function that stands in for the host: the host decides the actor), the gestures as operations, the
 * request envelope a page may send, waivers, the review queue's ranking and the timeline's model.
 */
import { describe, expect, it } from "vitest";
import { canonicalRecord, openBoardService, snapshotToWire, type Actor, type BoardService } from "@protoboardai/board";
import { airnodeC3, AIRNODE_C3_NETLIST } from "@protoboardai/board/fixtures/airnode-c3";
import { EditSession, outcomeOf } from "../../src/pcb/edit/session.js";
import { anchorOf, deleteOps, lockOps, moveOps, numericOps, rotateOps, snapDelta } from "../../src/pcb/edit/gestures.js";
import { parseBoardRequest } from "../../src/pcb/requests.js";
import { applyWaivers, readWaivers, waiverRule, waiverRuleId } from "../../src/pcb/waivers.js";
import { buildQueue, exportState } from "../../src/pcb/review.js";
import { blocksOf, errorLine, scaleFor } from "../../src/pcb/timeline.js";
import { docAtSeq } from "../../src/pcb/host/feed.js";
import { RemoteBoardSource } from "../../src/pcb/remote.js";
import type { BoardReplyMessage, BoardRequest, PcbFinding } from "../../src/pcb/types.js";

const PERSON: Actor = { kind: "human", id: "user" };

/** A service, a page-side feed over it and a request function as a host gives one (it decides the actor). */
function rig(options: { delayReply?: boolean } = {}) {
  const svc: BoardService = openBoardService({ document: airnodeC3(), netlist: AIRNODE_C3_NETLIST });
  const remote = new RemoteBoardSource("b", { type: "snapshot", board: "b", mode: "service", snapshot: snapshotToWire(svc.snapshot()) });
  // the host's feed: each commit with the records it changed
  svc.subscribe((e) => {
    if (e.type !== "commit") return;
    const s = svc.snapshot();
    const ids = [...new Set([...e.changed, ...Object.values(e.created)])].filter((id) => !e.removed.includes(id));
    remote.receive({ type: "commit", board: "b", event: e, puts: ids.map((id) => s.doc.records.get(id)!).filter(Boolean), removes: e.removed, versions: Object.fromEntries(ids.map((id) => [id, s.version(id)])) });
  });
  const sent: BoardRequest[] = [];
  const send = async (req: BoardRequest): Promise<BoardReplyMessage> => {
    sent.push(req);
    if (options.delayReply) await new Promise((r) => setTimeout(r, 5));
    if (req.method === "apply") return { ok: true, result: svc.apply(req.tx, PERSON) };
    if (req.method === "undo") return { ok: true, result: svc.undo(PERSON) };
    if (req.method === "redo") return { ok: true, result: svc.redo(PERSON) };
    return { ok: false, error: `not in this test: ${req.method}` };
  };
  return { svc, remote, session: new EditSession(remote, send), sent };
}

describe("the edit session", () => {
  it("draws a gesture in progress without sending anything", () => {
    const { svc, session, sent } = rig();
    const x0 = (svc.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x;
    expect(session.preview(moveOps(session.confirmed().doc, ["fp:power/ldo"], 1_000_000, 0).ops)).toBe(true);
    expect((session.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0 + 1_000_000);
    expect((session.confirmed().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0);
    expect(sent).toHaveLength(0);
    session.preview(undefined);
    expect((session.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0);
  });

  it("commits one gesture as one transaction, as the host's actor, and reconciles with the feed", async () => {
    const { svc, session } = rig({ delayReply: true });
    const x0 = (svc.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x;
    const p = session.commit("move the LDO by hand", moveOps(session.confirmed().doc, ["fp:power/ldo"], 2_000_000, 0).ops, { expectFor: ["fp:power/ldo"] });
    // drawn at once, before the reply
    expect((session.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0 + 2_000_000);
    const o = await p;
    expect(o.ok).toBe(true);
    expect(svc.seq).toBe(1);
    expect(svc.log().at(-1)!.actor).toEqual(PERSON);
    expect(session.status().pending).toBe(0);
    // the overlay is gone and the confirmed board holds the move: no double move
    expect((session.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0 + 2_000_000);
    expect(session.snapshot()).toBe(session.confirmed());
  });

  it("takes a refusal off the board and says why plainly", async () => {
    const { svc, session } = rig();
    // someone else moves the part first: the person's write expected the version it read
    const exp = { "fp:power/ldo": svc.snapshot().version("fp:power/ldo") };
    svc.apply({ batchId: "other", label: "an agent moves the LDO", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1_000_000, dy: 0, tracks: "stay" }] }, { kind: "agent", id: "agent:x" });
    const o = await session.commit("move the LDO by hand", [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1_000_000, dy: 0, tracks: "stay" }], {});
    expect(o.ok).toBe(true);
    const stale = outcomeOf("move", { ok: true, result: svc.apply({ batchId: "late", label: "move the LDO again", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1, dy: 0, tracks: "stay" }], expectVersions: exp }, PERSON) });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe("stale-versions");
    expect(stale.message).toMatch(/changed what you edited first/);
    expect(session.status().pending).toBe(0);
  });

  it("undo and redo are the person's own, through the host", async () => {
    const { svc, session } = rig();
    const x0 = (svc.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x;
    await session.commit("move the LDO by hand", moveOps(session.confirmed().doc, ["fp:power/ldo"], 1_000_000, 0).ops);
    // an agent's later change elsewhere is not undone by the person
    svc.apply({ batchId: "a1", label: "an agent moves the sensor", ops: [{ op: "footprint.move", ids: ["fp:sensor/ic"], dx: 1_000_000, dy: 0, tracks: "stay" }] }, { kind: "agent", id: "agent:x" });
    const sensor = canonicalRecord(svc.snapshot().doc.records.get("fp:sensor/ic")!);
    expect((await session.undo()).ok).toBe(true);
    expect((svc.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0);
    expect(canonicalRecord(svc.snapshot().doc.records.get("fp:sensor/ic")!)).toBe(sensor);
    expect((await session.redo()).ok).toBe(true);
    const nothing = await session.undo().then(() => session.undo());
    expect(nothing.ok).toBe(false);
    expect(nothing.message).toMatch(/Nothing of yours/);
  });

  it("a session without a request channel is read only", async () => {
    const svc = openBoardService({ document: airnodeC3(), netlist: AIRNODE_C3_NETLIST });
    const remote = new RemoteBoardSource("b", { type: "snapshot", board: "b", mode: "files", snapshot: snapshotToWire(svc.snapshot()) });
    const s = new EditSession(remote);
    expect(s.writable).toBe(false);
    const o = await s.commit("move the LDO by hand", [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1, dy: 0, tracks: "stay" }]);
    expect(o.ok).toBe(false);
    expect(svc.seq).toBe(0);
  });
});

describe("gestures as operations", () => {
  const doc = airnodeC3();
  it("move, rotate, delete and lock build the core's operations", () => {
    const m = moveOps(doc, ["fp:power/ldo", "trk:f.usb_dp.1", "via:f.gnd.1"], 1_000_000, -500_000);
    expect(m.ops.map((o) => o.op).sort()).toEqual(["footprint.move", "track.move", "via.move"]);
    expect(rotateOps(doc, ["fp:power/ldo"], 90_000).ops[0]).toMatchObject({ op: "footprint.rotate", angle: 90_000, about: "each" });
    expect(rotateOps(doc, ["fp:power/ldo", "fp:sensor/ic"], 90_000).ops[0]).toMatchObject({ about: "center" });
    expect(deleteOps(doc, ["trk:f.usb_dp.1"]).ops).toEqual([{ op: "track.delete", ids: ["trk:f.usb_dp.1"] }]);
    // already locked objects are left out of a lock
    expect(lockOps(doc, ["trk:f.vbus.1", "trk:f.usb_dp.1"], true)).toEqual([{ op: "lock", ids: ["trk:f.usb_dp.1"] }]);
    expect(lockOps(doc, ["trk:f.vbus.1"], false)).toEqual([{ op: "unlock", ids: ["trk:f.vbus.1"] }]);
  });
  it("a pad stands for its footprint", () => {
    expect(moveOps(doc, ["pad:power/ldo:1"], 1, 0).ops[0]).toMatchObject({ op: "footprint.move", ids: ["fp:power/ldo"] });
  });
  it("a drag snaps the anchor to the grid", () => {
    const a = anchorOf(doc, ["fp:power/ldo"])!;
    const s = snapDelta(a, 1_130_000, -40_000, 0.25);
    expect(Math.abs((a.x + s.dx) % 250_000)).toBe(0);
    expect(Math.abs((a.y + s.dy) % 250_000)).toBe(0);
  });
  it("the inspector's millimeters become the same transactions", () => {
    const fp = doc.records.get("fp:power/ldo")!;
    expect(numericOps(fp, "x", 4.25)).toEqual([{ op: "footprint.place", id: "fp:power/ldo", x: 4_250_000 }]);
    expect(numericOps(fp, "rotation", 90)).toEqual([{ op: "footprint.place", id: "fp:power/ldo", rotation: 90_000 }]);
    const via = doc.records.get("via:f.gnd.1") as { x: number; y: number } & Parameters<typeof numericOps>[0];
    expect(numericOps(via, "x", via.x / 1e6 + 1)).toEqual([{ op: "via.move", ids: ["via:f.gnd.1"], dx: 1_000_000, dy: 0 }]);
  });
});

describe("what a page may ask its host", () => {
  it("takes the methods it knows", () => {
    expect(parseBoardRequest({ method: "apply", tx: { batchId: "ui-1", label: "move the LDO by hand", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1, dy: 0 }] } }).ok).toBe(true);
    expect(parseBoardRequest({ method: "undo" }).ok).toBe(true);
    expect(parseBoardRequest({ method: "route", scope: { kind: "nets", nets: ["GND"] }, budgetMs: 60_000 }).ok).toBe(true);
    expect(parseBoardRequest({ method: "waive", finding: "f:clearance:0123456789ab", reason: "accepted by the fab" }).ok).toBe(true);
  });
  it("never lets a page name an actor or claim authority", () => {
    for (const bad of [
      { method: "undo", actor: { kind: "agent", id: "agent:x" } },
      { method: "apply", tx: { batchId: "x", label: "a b c", ops: [{ op: "lock", ids: ["fp:power/ldo"] }], provenance: { by: "routed" } } },
      { method: "apply", tx: { batchId: "x", label: "a b c", ops: [{ op: "lock", ids: ["fp:power/ldo"], actor: "agent:x" }] } },
      { method: "apply", tx: { batchId: "x", label: "a b c", ops: [{ op: "lock", ids: [] }], leaseToken: 3 } },
      { method: "takeOver", by: { kind: "agent", id: "agent:x" } },
    ]) {
      const r = parseBoardRequest(bad);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(/never sends|unknown field/);
    }
  });
  it("refuses unknown methods and malformed fields", () => {
    expect(parseBoardRequest({ method: "shutdown" }).ok).toBe(false);
    expect(parseBoardRequest({ method: "at", seq: -1 }).ok).toBe(false);
    expect(parseBoardRequest({ method: "waive", finding: "f:x:1", reason: "  " }).ok).toBe(false);
    expect(parseBoardRequest({ method: "route", scope: { kind: "region", region: [{ x: 0, y: 0 }] } }).ok).toBe(false);
  });
});

const finding = (id: string, check: string, severity: PcbFinding["severity"], objects: string[], x = 0): PcbFinding => ({ id, check, severity, objects, location: { x, y: 0 }, message: `${check} at ${x}` });

describe("waivers", () => {
  it("are rules entries the checks cannot apply, read back by finding id", () => {
    const svc = openBoardService({ document: airnodeC3(), netlist: AIRNODE_C3_NETLIST });
    const f = finding("f:clearance:0123456789ab", "clearance", "error", ["trk:f.usb_dp.1"]);
    const r = svc.apply({ batchId: "w", label: "mark clearance not a problem", ops: [{ op: "rule.set", rule: waiverRule(f, "the fab accepts this gap") }] }, PERSON);
    expect(r.status).toBe("applied");
    const rule = svc.snapshot().doc.records.get(waiverRuleId(f.id)) as { enabled?: false; severity?: string };
    expect(rule.enabled).toBe(false);
    const w = readWaivers(svc.snapshot().doc);
    expect(w.get(f.id)?.reason).toBe("the fab accepts this gap");
    const split = applyWaivers([f, finding("f:clearance:ffffffffffff", "clearance", "error", ["x"])], w);
    expect(split.open.map((x) => x.id)).toEqual(["f:clearance:ffffffffffff"]);
    expect(split.waived[0].reason).toBe("the fab accepts this gap");
  });
});

describe("the review queue", () => {
  const doc = airnodeC3();
  it("ranks blocks the fab first, then unconnected nets, then style, then notes", () => {
    const q = buildQueue(doc, [
      finding("f:silk:1", "silk_to_pad", "warning", ["fp:power/ldo"]),
      finding("f:unconnected:1", "unconnected", "error", ["pad:power/ldo:1", "pad:power/c_out:1"]),
      finding("f:unconnected:2", "unconnected", "error", ["pad:power/ldo:2", "pad:power/c_in:2"]),
      finding("f:note:1", "length", "info", []),
      finding("f:clearance:1", "clearance", "error", ["trk:f.usb_dp.1", "trk:f.usb_dn.1"]),
    ]);
    expect(q.map((i) => i.group)).toEqual(["fab", ...q.filter((i) => i.group === "unconnected").map(() => "unconnected"), "style", "note"]);
    // an open net is one item with its links counted
    expect(q.filter((i) => i.group === "unconnected").reduce((n, i) => n + i.findings.length, 0)).toBe(2);
  });
  it("lets Export through only when nothing is left", () => {
    expect(exportState([], undefined, true).allowed).toBe(true);
    expect(exportState(buildQueue(doc, [finding("f:c:1", "clearance", "error", [])]), undefined, true).allowed).toBe(false);
    expect(exportState([], undefined, false).allowed).toBe(false);
  });
});

describe("the timeline", () => {
  it("groups a change set's run into one block", () => {
    const e = (seq: number, changeSet?: string) => ({ seq, time: 0, actor: PERSON, label: `t${seq}`, ops: [], inverse: [], forward: [], changed: [`x${seq}`], created: {}, removed: [], touched: {}, areas: [], ...(changeSet ? { changeSet } : {}) });
    const b = blocksOf([e(1), e(2, "run-1"), e(3, "run-1"), e(4)]);
    expect(b.map((x) => [x.from, x.to])).toEqual([
      [1, 1],
      [2, 3],
      [4, 4],
    ]);
  });
  it("draws the error line as steps across the window", () => {
    const s = scaleFor(10, 24);
    const l = errorLine([{ seq: 0, errors: 4, warnings: 0, unconnected: 2 }, { seq: 5, errors: 1, warnings: 0, unconnected: 0 }], s);
    expect(l.peak).toBe(6);
    expect(l.points.at(-1)![1]).toBeCloseTo(1 / 6);
  });
});

describe("replay", () => {
  it("rebuilds the board at an earlier seq from the log's inverses", () => {
    const svc = openBoardService({ document: airnodeC3(), netlist: AIRNODE_C3_NETLIST });
    const s0 = svc.snapshot().doc;
    svc.apply({ batchId: "a", label: "move the LDO by hand", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1_000_000, dy: 0, tracks: "stay" }] }, PERSON);
    const s1 = svc.snapshot().doc;
    svc.apply({ batchId: "b", label: "delete a track by hand", ops: [{ op: "track.delete", ids: ["trk:f.usb_dp.1"] }] }, PERSON);
    const now = svc.snapshot().doc;
    const at0 = docAtSeq(now, svc.log(), 2, 0);
    const at1 = docAtSeq(now, svc.log(), 2, 1);
    for (const [a, b] of [
      [at0, s0],
      [at1, s1],
    ] as const) {
      expect([...a.records.keys()].sort()).toEqual([...b.records.keys()].sort());
      for (const [id, r] of b.records) expect(canonicalRecord(a.records.get(id)!)).toBe(canonicalRecord(r));
    }
    expect(() => docAtSeq(now, svc.log(), 2, 3)).toThrow(/ahead/);
  });
});
