/**
 * Proposal mode (Phase 2 contract, section 4): propose, preview, accept all or per item as the person's own
 * transaction with the proposer's provenance, reject, automatic stale marking, agents' net changes stored as
 * proposals, files under the proposals folder. And the netlist change through the engine (undo restores it).
 */
import { cpSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { airnodeC3, AIRNODE_C3_NETLIST } from "../src/fixtures/airnode-c3.js";
import { openBoardService, type Actor, type BoardEvent, type OpCall, type TrackRec } from "../src/index.js";

const PERSON: Actor = { kind: "human", id: "user" };
const AGENT: Actor = { kind: "agent", id: "agent:planner", name: "planner" };
const ROUTER: Actor = { kind: "router", id: "router:builtin", name: "builtin" };

const seg = (net: string, x0: number, y0: number, x1: number, y1: number, handle = "a"): OpCall => ({ op: "track.add", segments: [{ handle, net, layer: "top", width: 200_000, start: { x: x0, y: y0 }, end: { x: x1, y: y1 } }] });

function svc() {
  return openBoardService({ document: airnodeC3(), epoch: "prop01", now: () => 1000 });
}

describe("proposals", () => {
  it("are stored, not applied, and previewed as a diff", () => {
    const s = svc();
    const seq = s.seq;
    const r = s.propose(AGENT, { title: "join the two LED anodes", items: [{ key: "led1", label: "LED1 anode", ops: [seg("LED1_A", -12_520_000, 10_000_000, -12_520_000, 11_500_000)] }] });
    expect(r.status).toBe("proposed");
    if (r.status !== "proposed") return;
    expect(s.seq).toBe(seq);
    expect(r.proposal.summary.added).toEqual({ track: 1 });
    expect(r.proposal.items[0].nets).toEqual(["LED1_A"]);
    expect(r.proposal.provenance).toEqual({ by: "agent", actor: "agent:planner" });
    const pv = s.previewProposal(r.proposal.id)!;
    expect(pv.valid).toBe(true);
    expect(pv.added.map((x) => x.kind)).toEqual(["track"]);
    expect(s.proposals({ status: "open" }).map((p) => p.id)).toEqual([r.proposal.id]);
  });

  it("an invalid item is refused with its key", () => {
    const s = svc();
    const r = s.propose(AGENT, { title: "move a part that is not there", items: [{ key: "x", label: "nothing", ops: [{ op: "footprint.move", ids: ["fp:nope"], dx: 1, dy: 0 }] }] });
    expect(r).toMatchObject({ status: "invalid", item: "x" });
  });

  it("accept all: one transaction by the person, provenance kept, undoable by the person", () => {
    const s = svc();
    const events: BoardEvent[] = [];
    s.subscribe((e) => events.push(e));
    const r = s.propose(AGENT, { title: "add two short stubs", items: [{ key: "a", label: "stub one", ops: [seg("LED1_A", -12_520_000, 10_000_000, -12_520_000, 11_000_000)] }, { key: "b", label: "stub two", ops: [seg("LED2_A", -12_520_000, 7_000_000, -12_520_000, 6_000_000)] }] });
    if (r.status !== "proposed") throw new Error("not proposed");
    expect(s.acceptProposal(AGENT, r.proposal.id)).toMatchObject({ status: "refused", reason: "not-a-person" });
    const a = s.acceptProposal(PERSON, r.proposal.id);
    expect(a.status).toBe("applied");
    if (a.status !== "applied") return;
    expect(Object.keys(a.created).sort()).toEqual(["a_0_a", "b_1_a"]);
    const t = s.snapshot().doc.records.get(a.created.a_0_a) as TrackRec;
    expect(t.provenance).toEqual({ by: "agent", actor: "agent:planner" });
    expect(t.locked).toBeUndefined();
    expect(a.proposalState?.status).toBe("accepted");
    expect(s.log().at(-1)).toMatchObject({ actor: PERSON, proposal: r.proposal.id });
    expect(events.filter((e) => e.type === "proposal").map((e) => (e as { change: string }).change)).toEqual(["created", "accepted"]);
    expect(s.undo(PERSON).status).toBe("applied");
    expect(s.snapshot().doc.records.has(a.created.a_0_a)).toBe(false);
  });

  it("partial accept, then reject the rest", () => {
    const s = svc();
    const r = s.propose(AGENT, { title: "add two short stubs", items: [{ key: "a", label: "stub one", ops: [seg("LED1_A", -12_520_000, 10_000_000, -12_520_000, 11_000_000)] }, { key: "b", label: "stub two", ops: [seg("LED2_A", -12_520_000, 7_000_000, -12_520_000, 6_000_000)] }] });
    if (r.status !== "proposed") throw new Error("not proposed");
    const a = s.acceptProposal(PERSON, r.proposal.id, { items: ["a"] });
    expect(a.status).toBe("applied");
    expect(s.proposal(r.proposal.id)!.status).toBe("open");
    expect(s.proposal(r.proposal.id)!.items.map((i) => i.status)).toEqual(["accepted", "open"]);
    const rej = s.rejectProposal(PERSON, r.proposal.id, { reason: "not now" });
    expect(rej.status).toBe("rejected");
    expect(s.proposal(r.proposal.id)!.status).toBe("partial");
    expect(s.acceptProposal(PERSON, r.proposal.id).status).toBe("invalid");
  });

  it("goes stale when the board changes under it, and a stale accept is refused unless allowed", () => {
    const s = svc();
    const r = s.propose(ROUTER, { title: "route the LED one anode", items: [{ key: "a", label: "stub", ops: [seg("LED1_A", -12_520_000, 10_000_000, -12_520_000, 11_000_000)] }], provenance: { by: "routed", tool: "builtin 1", run: "r1" } });
    if (r.status !== "proposed") throw new Error("not proposed");
    // a change far away leaves it open
    expect(s.apply({ batchId: "far", label: "nudge the USB connector", ops: [{ op: "footprint.move", ids: ["fp:usb/r_cc2"], dx: 100_000, dy: 0, tracks: "stay" }] }, PERSON).status).toBe("applied");
    expect(s.proposal(r.proposal.id)!.status).toBe("open");
    // moving R1 (the stub starts on its pad) makes it stale
    expect(s.apply({ batchId: "near", label: "nudge resistor R1 left", ops: [{ op: "footprint.move", ids: ["fp:status/r1"], dx: -100_000, dy: 0 }] }, PERSON).status).toBe("applied");
    const p = s.proposal(r.proposal.id)!;
    expect(p.status).toBe("stale");
    expect(p.stale?.seq).toBe(s.seq);
    expect(s.acceptProposal(PERSON, p.id)).toMatchObject({ status: "refused", reason: "stale-proposal" });
    const a = s.acceptProposal(PERSON, p.id, { allowStale: true });
    expect(a.status).toBe("applied");
    if (a.status === "applied") expect((s.snapshot().doc.records.get(a.created.a) as TrackRec).provenance).toEqual({ by: "routed", tool: "builtin 1", run: "r1" });
  });

  it("an agent's net change waits for a person as a proposal", () => {
    const s = svc();
    const r = s.apply({ batchId: "net-1", label: "put the spare track on GND", ops: [{ op: "net.set", ids: ["trk:f.spare.1"], net: "GND" }] }, AGENT);
    expect(r).toMatchObject({ status: "refused", reason: "needs-person" });
    const id = (r as { proposal?: string }).proposal!;
    expect(id).toMatch(/^p\./);
    expect(s.proposal(id)).toMatchObject({ source: "needs-person", status: "open" });
    // the same batch sent again names the same proposal
    expect((s.apply({ batchId: "net-1", label: "put the spare track on GND", ops: [{ op: "net.set", ids: ["trk:f.spare.1"], net: "GND" }] }, AGENT) as { proposal?: string }).proposal).toBe(id);
    // a dry run stores nothing
    const before = s.proposals().length;
    s.apply({ batchId: "net-2", label: "put the spare track on GND", ops: [{ op: "net.set", ids: ["trk:f.spare.1"], net: "GND" }], dryRun: true }, AGENT);
    expect(s.proposals().length).toBe(before);
    expect(s.acceptProposal(PERSON, id).status).toBe("applied");
    expect((s.snapshot().doc.records.get("trk:f.spare.1") as TrackRec).net).toBe("GND");
  });

  it("are written under the proposals folder and come back stale in a new session", () => {
    const root = mkdtempSync(join(tmpdir(), "pb-proposals-"));
    const dir = join(root, "board");
    cpSync(fileURLToPath(new URL("./fixtures/airnode-c3/", import.meta.url)), dir, { recursive: true });
    const s = openBoardService({ dir });
    const r = s.propose(AGENT, { title: "add a short LED stub", items: [{ label: "stub", ops: [seg("LED1_A", -12_520_000, 10_000_000, -12_520_000, 11_000_000)] }] });
    if (r.status !== "proposed") throw new Error("not proposed");
    expect(s.proposalsDir).toBeDefined();
    expect(readdirSync(s.proposalsDir!)).toEqual([`${r.proposal.id}.json`]);
    s.close({ save: false });
    const s2 = openBoardService({ dir });
    expect(s2.proposal(r.proposal.id)?.status).toBe("stale");
    s2.close({ save: false });
    expect(existsSync(join(dir, "proposals"))).toBe(false);
  });
});

describe("netlist.sync through the engine", () => {
  it("commits a netlist-only change, journals it, and undo restores the netlist", () => {
    const s = svc();
    const next = { source: "fixture", nets: AIRNODE_C3_NETLIST.nets.map((n) => (n.name === "LED1" ? { ...n, name: "LED_ONE" } : n)) };
    const r = s.apply({ batchId: "nl-1", label: "rename the LED one net", ops: [{ op: "netlist.sync", netlist: next }] }, { kind: "host", id: "host:uhd" });
    expect(r).toMatchObject({ status: "applied", netlist: true });
    expect(s.snapshot().doc.nets.has("LED_ONE")).toBe(true);
    expect(s.log().at(-1)!.forward[0]).toMatchObject({ op: "netlist.sync", rename: "none" });
    expect(s.undo({ kind: "host", id: "host:uhd" }).status).toBe("applied");
    expect(s.snapshot().doc.nets.has("LED1")).toBe(true);
    expect(s.snapshot().doc.nets.has("LED_ONE")).toBe(false);
  });
});
