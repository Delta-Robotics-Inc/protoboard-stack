/** The drag hold (Phase 2 contract, section 5): while a person drags, agents' writes into what they hold wait; the person always wins. */
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "../src/fixtures/airnode-c3.js";
import { openBoardService, type Actor, type BoardEvent } from "../src/index.js";

const PERSON: Actor = { kind: "human", id: "user" };
const AGENT: Actor = { kind: "agent", id: "agent:tidy", name: "tidy" };
const ROUTER: Actor = { kind: "router", id: "router:builtin", name: "builtin" };

describe("drag hold", () => {
  it("refuses agent and router writes to held objects and their halo, not elsewhere; the drop releases it", () => {
    let t = 1000;
    const s = openBoardService({ document: airnodeC3(), epoch: "hold01", now: () => t });
    const events: BoardEvent[] = [];
    s.subscribe((e) => events.push(e));
    expect(s.hold(AGENT, { ids: ["fp:power/ldo"] }).status).toBe("invalid");
    const h = s.hold(PERSON, { ids: ["fp:power/ldo"] });
    expect(h.status).toBe("held");
    if (h.status !== "held") return;
    expect(s.presence().holds.map((x) => x.id)).toEqual([h.hold.id]);
    expect(events.some((e) => e.type === "presence")).toBe(true);
    // the held part itself
    const a = s.apply({ batchId: "a1", label: "nudge the regulator right", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 100_000, dy: 0, tracks: "stay" }] }, AGENT);
    expect(a).toMatchObject({ status: "refused", reason: "held" });
    expect((a as { retryAfterMs?: number }).retryAfterMs).toBeGreaterThan(0);
    // copper in its halo (the +3V3 track on its pad)
    expect(s.apply({ batchId: "r1", label: "move a track near it", ops: [{ op: "track.move", ids: ["trk:f.3v3.1"], dx: 50_000, dy: 0 }] }, ROUTER)).toMatchObject({ status: "refused", reason: "held" });
    // elsewhere on the board: applied
    expect(s.apply({ batchId: "a2", label: "nudge the far LED resistor", ops: [{ op: "footprint.move", ids: ["fp:status/r2"], dx: 100_000, dy: 0, tracks: "stay" }] }, AGENT).status).toBe("applied");
    // the person's drop wins and releases the hold
    expect(s.apply({ batchId: "p1", label: "drop the regulator here", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 300_000, dy: 0 }] }, PERSON).status).toBe("applied");
    expect(s.presence().holds).toEqual([]);
    expect(s.apply({ batchId: "a3", label: "nudge the regulator right", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 100_000, dy: 0, tracks: "stay" }] }, AGENT).status).toBe("applied");
    // a hold lapses on its own
    s.hold(PERSON, { ids: ["fp:status/led1"], ttlMs: 500 });
    t += 600;
    expect(s.apply({ batchId: "a4", label: "nudge the first LED", ops: [{ op: "footprint.move", ids: ["fp:status/led1"], dx: 100_000, dy: 0, tracks: "stay" }] }, AGENT).status).toBe("applied");
  });

  it("released explicitly", () => {
    const s = openBoardService({ document: airnodeC3(), epoch: "hold02" });
    const h = s.hold(PERSON, { ids: ["via:f.gnd.1"] });
    if (h.status !== "held") throw new Error("no hold");
    expect(s.releaseHold(PERSON, h.hold.id).map((x) => x.id)).toEqual([h.hold.id]);
    expect(s.apply({ batchId: "a1", label: "move the ground via", ops: [{ op: "via.move", ids: ["via:f.gnd.1"], dx: 100_000, dy: 0 }] }, AGENT).status).toBe("applied");
  });
});
