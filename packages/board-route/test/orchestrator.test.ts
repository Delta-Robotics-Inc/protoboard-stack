/** The orchestrator with the built-in and fake routers: fallback, rejection, lock verification, cancel, determinism, diagnostic. */
import { describe, expect, it } from "vitest";
import { createDocument, mm, openBoardService, withChanges, type BoardRecord, type TrackRec } from "@protoboardai/board";
import { applyProposal, basicScorer, createBuiltinRouter, lockedChanges, lockedFingerprint, netsInScope, resolveConstraints, routeBoard, type IslandSource, type RouteEvent } from "../src/index.js";
import { baseRecords, blockedTopBoard, chip, diagnosticBoard, easyBoard, fakeRouter, netlist, stripTimes, track } from "./helpers.js";

const scorer = basicScorer(mm(0.127));

describe("routeBoard with the built-in router", () => {
  it("routes the easy board completely and proposes it with both scores", async () => {
    const doc = easyBoard();
    const p = await routeBoard(doc, { scope: { kind: "open" }, routers: [createBuiltinRouter()], scorer });
    expect(p.status).toBe("proposed");
    expect(p.current.open).toBe(6);
    expect(p.candidate.open).toBe(0);
    expect(p.candidate.errors).toBe(0);
    expect(p.openNets).toEqual([]);
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0].actor).toEqual({ kind: "router", id: "router:builtin", name: "builtin" });
    expect(p.steps[0].transaction.provenance).toEqual({ by: "routed", tool: "builtin 1", run: p.runId });
    expect(p.added.segments).toBe(6);
    expect(p.fallback).toBeUndefined();
    expect(p.diagnostic).toBeUndefined();
  });

  it("applies an accepted proposal to a live service as the router, unlocked and with routed provenance", async () => {
    const svc = openBoardService({ document: easyBoard() });
    const p = await routeBoard(svc.snapshot(), { scope: { kind: "open" }, routers: [createBuiltinRouter()], scorer });
    expect(p.steps[0].transaction.expectSeq).toBe(0);
    const replies = applyProposal(svc, p);
    expect(replies.map((r) => r.status)).toEqual(["applied"]);
    const added = [...svc.snapshot().doc.records.values()].filter((r): r is TrackRec => r.kind === "track");
    expect(added).toHaveLength(6);
    expect(added.every((t) => !t.locked && t.provenance.by === "routed" && t.provenance.run === p.runId)).toBe(true);
    expect((await scorer(svc.snapshot().doc)).open).toBe(0);
  });

  it("routes a net subset and leaves the other nets alone", async () => {
    const p = await routeBoard(easyBoard(), { scope: { kind: "nets", nets: ["A", "E"] }, routers: [createBuiltinRouter()], scorer });
    expect(p.status).toBe("proposed");
    expect(p.nets).toEqual(["A", "E"]);
    const nets = p.steps.flatMap((s) => s.transaction.ops.flatMap((o) => (o.segments as { net: string }[] | undefined)?.map((x) => x.net) ?? []));
    expect([...new Set(nets)].sort()).toEqual(["A", "E"]);
    expect(p.candidate.open).toBe(4);
  });

  it("routes a region: only nets whose islands are inside it", async () => {
    const region = [
      { x: mm(-12), y: mm(2) },
      { x: mm(12), y: mm(2) },
      { x: mm(12), y: mm(6) },
      { x: mm(-12), y: mm(6) },
    ];
    const p = await routeBoard(easyBoard(), { scope: { kind: "region", region }, routers: [createBuiltinRouter()], scorer });
    expect(p.nets).toEqual(["A", "B"]);
    expect(p.status).toBe("proposed");
  });

  it("falls back to the next router on the nets still open and flags it", async () => {
    const weak = createBuiltinRouter({ id: "top-only", layers: ["top"] });
    const strong = createBuiltinRouter({ id: "both-layers" });
    const doc = createDocument([...blockedTopBoard().records.values(), chip("R1", -8, -6), chip("R2", 8, -6)], {
      source: "fixture",
      nets: [...blockedTopBoard().netlist!.nets, { name: "S", pins: ["R1.2", "R2.1"] }],
    });
    const events: RouteEvent[] = [];
    const p = await routeBoard(doc, { scope: { kind: "open" }, routers: [weak, strong], scorer, onEvent: (e) => events.push(e) });
    expect(p.status).toBe("proposed");
    expect(p.stages.map((s) => [s.router, s.status, s.kept])).toEqual([
      ["top-only", "partial", true],
      ["both-layers", "complete", true],
    ]);
    expect(p.stages[1].nets).toEqual(["G"]);
    expect(p.fallback).toEqual({ from: "top-only", to: ["both-layers"], reasons: ["top-only: 1 net(s) still open"] });
    expect(events.some((e) => e.type === "fallback" && e.to === "both-layers")).toBe(true);
    expect(p.steps.map((s) => s.actor.id)).toEqual(["router:top-only", "router:both-layers"]);
    const gLayer = (p.steps[1].transaction.ops[0].segments as { layer: string }[])[0].layer;
    expect(gLayer).toBe("bottom");
    expect(p.candidate.open).toBe(0);
  });

  it("falls back when the primary is unavailable or throws", async () => {
    const off = { ...createBuiltinRouter({ id: "off" }), available: () => ({ ok: false as const, reason: "not installed here" }) };
    const boom = { ...createBuiltinRouter({ id: "boom" }), route: async () => Promise.reject(new Error("crashed")) };
    const p = await routeBoard(easyBoard(), { scope: { kind: "open" }, routers: [off, boom, createBuiltinRouter()], scorer });
    expect(p.status).toBe("proposed");
    expect(p.stages.map((s) => [s.router, s.status])).toEqual([
      ["off", "skipped"],
      ["boom", "failed"],
      ["builtin", "complete"],
    ]);
    expect(p.fallback?.reasons[0]).toContain("not installed here");
    expect(p.stages[1].messages[0]).toContain("crashed");
  });

  it("rejects a result worse than the current board, with the reason", async () => {
    // a track of net A straight across both pads of R4 and R5 (nets E, C): shorts
    const shorting = fakeRouter("shorting", () => [{ op: "track.add", segments: [{ net: "A", layer: "top", width: mm(0.25), start: { x: mm(-9), y: mm(-4) }, end: { x: mm(1), y: mm(-4) } }] }]);
    const p = await routeBoard(easyBoard(), { scope: { kind: "nets", nets: ["A"] }, routers: [shorting], scorer, diagnose: false });
    expect(p.status).toBe("rejected");
    expect(p.reasons.join(" ")).toMatch(/errors rise from 0 to \d+/);
    expect(p.candidate.errors).toBeGreaterThan(0);
    expect(p.current.errors).toBe(0);
    expect(p.stages[0].kept).toBe(false);
    expect(p.stages[0].reason).toMatch(/worse than the board it started from/);
  });

  it("keeps what the first router completed when the second only makes it worse", async () => {
    const weak = createBuiltinRouter({ id: "top-only", layers: ["top"] });
    const shorting = fakeRouter("shorting", () => [{ op: "track.add", segments: [{ net: "G", layer: "top", width: mm(0.25), start: { x: mm(-6), y: mm(0) }, end: { x: mm(-6), y: mm(-6) } }] }]);
    const doc = createDocument([...blockedTopBoard().records.values(), chip("R1", -8, -6), chip("R2", 8, -6)], { source: "fixture", nets: [...blockedTopBoard().netlist!.nets, { name: "S", pins: ["R1.2", "R2.1"] }] });
    const p = await routeBoard(doc, { scope: { kind: "open" }, routers: [weak, shorting], scorer, diagnose: false });
    expect(p.status).toBe("proposed");
    expect(p.stages.map((s) => s.kept)).toEqual([true, false]);
    expect(p.steps).toHaveLength(1);
    expect(p.candidate.open).toBe(1);
    expect(p.openNets).toEqual(["G"]);
  });
});

describe("locked copper", () => {
  const lockedBoard = () => easyBoard([track("hand", "A", "top", 0.3, [-7.2, 4], [-5, 4], { locked: true })]);

  it("a router that moves locked copper is refused and its result is not kept", async () => {
    const mover = fakeRouter("mover", () => [
      { op: "track.move", ids: ["trk:hand"], dx: mm(0.1), dy: 0 },
      { op: "track.add", segments: [{ net: "A", layer: "top", width: mm(0.25), start: { x: mm(-5), y: mm(4) }, end: { x: mm(-0.8), y: mm(4) } }] },
    ]);
    const p = await routeBoard(lockedBoard(), { scope: { kind: "nets", nets: ["A"] }, routers: [mover], scorer, diagnose: false });
    expect(p.status).not.toBe("proposed");
    expect(p.steps).toEqual([]);
    expect(p.lockCheck).toEqual({ ok: false, changed: ["trk:hand"] });
    expect(p.stages[0].reason).toMatch(/refused: locked/);
  });

  it("a router that uses a system operation is refused", async () => {
    const sneaky = fakeRouter("sneaky", () => [{ op: "record.remove", ids: ["trk:hand"] }]);
    const p = await routeBoard(lockedBoard(), { scope: { kind: "nets", nets: ["A"] }, routers: [sneaky], scorer, diagnose: false });
    expect(p.steps).toEqual([]);
    expect(p.stages[0].reason).toMatch(/refused|invalid|audience|system/i);
  });

  it("the fingerprint catches any byte of a locked record that changed, and frozen ids", () => {
    const doc = lockedBoard();
    const before = lockedFingerprint(doc, ["trk:hand", "fp:R1"]);
    const t = doc.records.get("trk:hand") as TrackRec;
    expect(lockedChanges(before, doc)).toEqual([]);
    expect(lockedChanges(before, withChanges(doc, [{ ...t, width: t.width + 1 }]))).toEqual(["trk:hand"]);
    expect(lockedChanges(before, withChanges(doc, [], ["fp:R1"]))).toEqual(["fp:R1"]);
  });

  it("the built-in router leaves locked copper byte-identical and routes from it", async () => {
    const doc = lockedBoard();
    const p = await routeBoard(doc, { scope: { kind: "open" }, routers: [createBuiltinRouter()], scorer });
    expect(p.status).toBe("proposed");
    expect(p.lockCheck.ok).toBe(true);
    const svc = openBoardService({ document: doc });
    applyProposal(svc, p);
    expect(svc.snapshot().doc.records.get("trk:hand")).toEqual(doc.records.get("trk:hand"));
  });
});

describe("cancel, determinism, progress", () => {
  it("cancels: nothing is proposed", async () => {
    const ac = new AbortController();
    const slow = createBuiltinRouter({ delayMs: 40 });
    setTimeout(() => ac.abort(), 60);
    const p = await routeBoard(easyBoard(), { scope: { kind: "open" }, routers: [slow, createBuiltinRouter({ id: "never" })], scorer, signal: ac.signal });
    expect(p.status).toBe("cancelled");
    expect(p.steps).toEqual([]);
    expect(p.stages).toHaveLength(1);
  });

  it("is deterministic for the same inputs and seed, and the run id follows the seed", async () => {
    const run = (seed: number) => routeBoard(easyBoard(), { scope: { kind: "open" }, routers: [createBuiltinRouter()], scorer, seed });
    const a = await run(7);
    const b = await run(7);
    const c = await run(8);
    expect(stripTimes(a)).toEqual(stripTimes(b));
    expect(c.runId).not.toBe(a.runId);
  });

  it("reports progress events in order", async () => {
    const events: RouteEvent[] = [];
    await routeBoard(easyBoard(), { scope: { kind: "open" }, routers: [createBuiltinRouter()], scorer, onEvent: (e) => events.push(e) });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("stage-start");
    expect(types).toContain("progress");
    expect(types.at(-2)).toBe("stage-end");
    expect(types.at(-1)).toBe("done");
  });

  it("does nothing when nothing in scope is open", async () => {
    const doc = createDocument([...baseRecords(), chip("R1", 0, 0)], netlist({ A: ["R1.1"] }));
    const p = await routeBoard(doc, { scope: { kind: "open" }, routers: [createBuiltinRouter()], scorer });
    expect(p.status).toBe("unchanged");
    expect(p.reasons).toEqual(["nothing in scope is open"]);
  });
});

describe("one deadline, and the caller's islands", () => {
  it("stops at the deadline: a slow router ends as a timeout (not a cancellation), the next is not started, and the proposal says so", async () => {
    const slow = createBuiltinRouter({ id: "slow", delayMs: 400 });
    const t0 = Date.now();
    const p = await routeBoard(easyBoard(), { scope: { kind: "open" }, routers: [slow, createBuiltinRouter({ id: "next" })], scorer, deadline: Date.now() + 1200 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(p.status).not.toBe("cancelled");
    expect(p.stages[0]).toMatchObject({ router: "slow", status: "timeout" });
    expect(p.stages[1]).toMatchObject({ router: "next", status: "skipped" });
    expect(p.stages[1].reason).toMatch(/time budget ran out/);
    expect(p.stopped?.join("; ")).toMatch(/slow: stopped at the time budget/);
    expect(p.stopped?.join("; ")).toMatch(/next: not started/);
  });

  it("does not start a router whose startup needs more time than is left", async () => {
    const jvm = { ...createBuiltinRouter({ id: "jvm" }), capabilities: { ...createBuiltinRouter().capabilities, startupMs: 60_000 } };
    const p = await routeBoard(easyBoard(), { scope: { kind: "open" }, routers: [jvm, createBuiltinRouter()], scorer, deadline: Date.now() + 5000 });
    expect(p.stages[0]).toMatchObject({ router: "jvm", status: "skipped" });
    expect(p.stages[1]).toMatchObject({ router: "builtin", kept: true });
    expect(p.status).toBe("proposed");
  });

  it("routes only the islands the caller's connectivity gives (a pour joins the rest)", async () => {
    // the caller's connectivity says net A is joined already (by a pour, say): only B is routed
    const islands: IslandSource = (d, nets) => new Map(nets.filter((n) => n !== "A").map((n) => [n, netsInScope(d, { kind: "nets", nets: [n] }).nets[0]?.islands ?? []]));
    const p = await routeBoard(easyBoard(), { scope: { kind: "nets", nets: ["A", "B"] }, routers: [createBuiltinRouter()], scorer, islands });
    expect(p.nets).toEqual(["B"]);
    expect(p.status).toBe("proposed");
    expect(p.openNets).toEqual([]);
    expect(netsInScope(easyBoard(), { kind: "nets", nets: ["A"] }, () => new Map()).nets).toEqual([]);
  });
});

describe("rules or placement diagnostic", () => {
  it("names the target rules that block a net, and placement for a net walled off", async () => {
    const p = await routeBoard(diagnosticBoard(), { scope: { kind: "open" }, routers: [createBuiltinRouter()], scorer });
    expect(p.openNets).toEqual(["H", "K"]);
    const d = p.diagnostic!;
    expect(d.tiers).toBe("floor-and-no-go");
    const byNet = Object.fromEntries(d.nets.map((n) => [n.net, n]));
    expect(byNet.H.verdict).toBe("rules");
    expect(byNet.H.relaxed).toEqual(["track width 0.25 mm to floor 0.127 mm (rule:target.track_width)", "clearance 0.2 mm to floor 0.127 mm (rule:target.clearance)", "via 0.6 mm/0.3 mm to floor 0.45 mm/0.2 mm", "edge clearance 0.3 mm to floor 0.25 mm"]);
    expect(byNet.H.floorViolations).toBe(0);
    expect(byNet.K.verdict).toBe("placement");
    // the board itself was not changed: still open on the proposal
    expect(p.candidate.open).toBe(2);
  });

  it("drops target and policy tiers in the relaxed constraints, keeps no-go", () => {
    const doc = diagnosticBoard();
    const relaxed = resolveConstraints(doc, ["H"], { tiers: "floor-and-no-go" });
    expect(relaxed.nets.H.width).toEqual({ plan: mm(0.127), floor: mm(0.127) });
    expect(relaxed.keepouts.map((k) => k.id)).toEqual(["kpo:wall"]);
    const normal = resolveConstraints(doc, ["H"]);
    expect(normal.nets.H.width).toEqual({ plan: mm(0.25), floor: mm(0.127) });
  });
});

describe("constraints", () => {
  it("resolves four tiers: floor is the largest minimum, target the most specific, policy a cost, local rules listed", () => {
    const extra: BoardRecord[] = [
      { kind: "netclass", id: "class:power", name: "power", nets: ["A"] },
      { kind: "rule", id: "rule:target.power", tier: "target", check: "track_width", applies: { classes: ["power"] }, min: mm(0.4), preferred: mm(0.5) },
      { kind: "rule", id: "rule:floor.high", tier: "floor", check: "clearance", applies: {}, min: mm(0.15) },
      { kind: "rule", id: "rule:policy.via", tier: "policy", check: "via_under_footprint", applies: {}, cost: 5 },
      { kind: "rule", id: "rule:target.inner", tier: "target", check: "clearance", applies: { layers: ["top"] }, min: mm(0.3) },
    ];
    const c = resolveConstraints(easyBoard(extra), ["A", "B"]);
    expect(c.nets.A.width).toEqual({ plan: mm(0.5), floor: mm(0.127) });
    expect(c.nets.B.width).toEqual({ plan: mm(0.25), floor: mm(0.127) });
    expect(c.nets.A.clearance).toEqual({ plan: mm(0.2), floor: mm(0.15) });
    expect(c.policies).toEqual([{ id: "rule:policy.via", check: "via_under_footprint", cost: 5 }]);
    expect(c.localRules).toEqual(["rule:target.inner"]);
    expect(c.defaulted).toEqual(["edge clearance", "via diameter", "via hole"]);
  });

  it("applies a rule whose condition names a class only to that class's nets; a condition on geometry is local", () => {
    // as a KiCad custom rule imports: (condition "A.Type == 'track' && A.NetClass == 'power'")
    const extra: BoardRecord[] = [
      { kind: "netclass", id: "class:power", name: "power", nets: ["A"] },
      { kind: "rule", id: "rule:dru.power", tier: "floor", check: "track_width", applies: { when: { all: [{ kind: ["track"], side: "A" }, { any: [{ class: ["power"], side: "A" }] }] } }, min: mm(0.3) },
      { kind: "rule", id: "rule:dru.area", tier: "floor", check: "track_width", applies: { when: { all: [{ class: ["power"], side: "A" }, { area: ["X"], side: "A" }] } }, min: mm(0.5) },
    ];
    const c = resolveConstraints(easyBoard(extra), ["A", "B"]);
    expect(c.nets.A.width.floor).toBe(mm(0.3));
    expect(c.nets.B.width).toEqual({ plan: mm(0.25), floor: mm(0.127) });
    expect(c.defaults.width.floor).toBe(mm(0.127));
    expect(c.localRules).toEqual(["rule:dru.area"]);
  });
});
