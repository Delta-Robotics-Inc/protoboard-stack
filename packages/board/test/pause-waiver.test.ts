/**
 * A person's pause of agents and routers, and waivers through the service (Phase 2, P2-E): while paused, agents' and
 * routers' transactions are refused `paused` (with the pause and when to retry) and person and host writes go on;
 * proposals are still taken; a pause with a ttl ends on its own; presence and events say so; the wire methods.
 * Waivers are a person's call: an agent's is refused needs-person and stored as a proposal a person accepts.
 */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { airnodeC3 } from "../src/fixtures/airnode-c3.js";
import { agentActor, BoardRpcError, openBoardService, serveBoard, wireClient, type Actor, type BoardClient, type BoardEvent, type BoardServer, type BoardService, type WaiverRec } from "../src/node.js";

const PERSON: Actor = { kind: "human", id: "user" };
const AGENT: Actor = { kind: "agent", id: "agent:tidy", name: "tidy" };
const ROUTER: Actor = { kind: "router", id: "router:builtin", name: "builtin" };
const HOST: Actor = { kind: "host", id: "host:editor", name: "editor" };

let n = 0;
const move = (id: string, dx = 100_000) => ({ batchId: `m${++n}`, label: "nudge a part sideways", ops: [{ op: "footprint.move", ids: [id], dx, dy: 0, tracks: "stay" }] });
const WAIVE = { op: "waiver.add", waiver: { rule: "via_under_footprint", objects: ["fp:mcu/module", "via:f.gnd.1"], reason: "the module's ground via is stitched on purpose" }, handle: "w" };

describe("pause", () => {
  it("refuses agents and routers while paused, not people or hosts; proposals still go through", () => {
    let t = 10_000;
    const s = openBoardService({ document: airnodeC3(), epoch: "paus01", now: () => t });
    const events: BoardEvent[] = [];
    s.subscribe((e) => events.push(e));
    expect(s.pause(AGENT, {}).status).toBe("invalid");
    expect(s.pause(ROUTER, {}).status).toBe("invalid");
    const p = s.pause(PERSON, { reason: "reviewing the power section" });
    expect(p).toMatchObject({ status: "paused", pause: { by: PERSON, since: 10_000, reason: "reviewing the power section" } });
    expect(s.paused()).toMatchObject({ reason: "reviewing the power section" });
    expect(s.presence().paused).toMatchObject({ by: PERSON });
    expect(events.filter((e) => e.type === "presence").at(-1)).toMatchObject({ presence: { paused: { reason: "reviewing the power section" } } });

    const a = s.apply(move("fp:status/r2"), AGENT);
    expect(a).toMatchObject({ status: "refused", reason: "paused", pause: { reason: "reviewing the power section" } });
    expect((a as { retryAfterMs?: number }).retryAfterMs).toBeUndefined();
    expect(s.apply(move("fp:status/r2"), ROUTER)).toMatchObject({ status: "refused", reason: "paused" });
    expect(s.undo(AGENT)).toMatchObject({ status: "refused", reason: "paused" });
    expect(s.redo(ROUTER)).toMatchObject({ status: "refused", reason: "paused" });
    expect(s.revertChangeSet(AGENT, "cs1")).toMatchObject({ status: "refused", reason: "paused" });
    expect(s.claim(AGENT, { purpose: "tidy the LEDs", nets: ["LED1_A"] })).toMatchObject({ status: "refused", reason: "paused" });
    // a dry run changes nothing and goes through
    expect(s.apply({ ...move("fp:status/r2"), dryRun: true }, AGENT).status).toBe("valid");
    // a proposal changes nothing and is taken
    expect(s.propose(AGENT, { title: "nudge the LED resistor right", items: [{ label: "R2", ops: move("fp:status/r2").ops }] }).status).toBe("proposed");
    // people and hosts go on
    expect(s.apply(move("fp:status/led1"), PERSON).status).toBe("applied");
    expect(s.apply(move("fp:status/led1"), HOST).status).toBe("applied");

    // the same batch sent again after the resume applies (a paused refusal is not remembered)
    const again = move("fp:status/r2");
    expect(s.apply(again, AGENT)).toMatchObject({ reason: "paused" });
    expect(s.resume(AGENT).status).toBe("invalid");
    const r = s.resume(PERSON);
    expect(r).toMatchObject({ status: "resumed", was: { reason: "reviewing the power section" } });
    expect(s.paused()).toBeUndefined();
    expect(s.presence().paused).toBeUndefined();
    expect(s.apply(again, AGENT).status).toBe("applied");
    expect(s.resume(PERSON)).toEqual({ status: "resumed" });
  });

  it("a pause with a ttl says when to retry and ends on its own", () => {
    let t = 50_000;
    const s = openBoardService({ document: airnodeC3(), epoch: "paus02", now: () => t });
    const events: BoardEvent[] = [];
    s.subscribe((e) => events.push(e));
    const p = s.pause(PERSON, { ttlMs: 2000 });
    expect(p).toMatchObject({ status: "paused", pause: { until: 52_000 } });
    expect(s.pause(PERSON, { ttlMs: -1 }).status).toBe("invalid");
    t += 500;
    const a = s.apply(move("fp:status/r2"), AGENT);
    expect(a).toMatchObject({ status: "refused", reason: "paused", retryAfterMs: 1500 });
    const before = events.filter((e) => e.type === "presence").length;
    t += 1600;
    expect(s.paused()).toBeUndefined();
    expect(events.filter((e) => e.type === "presence").length).toBe(before + 1);
    expect(s.apply(move("fp:status/r2"), AGENT).status).toBe("applied");
    s.close();
  });
});

describe("waivers through the service", () => {
  it("a person's waiver applies and undoes; an agent's is refused needs-person and kept as a proposal", () => {
    const s = openBoardService({ document: airnodeC3(), epoch: "waiv01", now: () => 1_700_000_000_000 });
    const mine = s.apply({ batchId: "w1", label: "waive the stitched module via", ops: [WAIVE] }, PERSON);
    expect(mine.status).toBe("applied");
    if (mine.status !== "applied") return;
    const w = s.snapshot().doc.records.get(mine.created.w) as WaiverRec;
    expect(w).toMatchObject({ kind: "waiver", rule: "via_under_footprint", by: { kind: "human", id: "user" }, at: "2023-11-14T22:13:20.000Z", provenance: { by: "hand" } });
    expect(s.undo(PERSON).status).toBe("applied");
    expect(s.snapshot().doc.records.has(mine.created.w)).toBe(false);

    const theirs = s.apply({ batchId: "a1", label: "waive the stitched module via", ops: [WAIVE] }, AGENT);
    expect(theirs).toMatchObject({ status: "refused", reason: "needs-person" });
    const pid = (theirs as { proposal?: string }).proposal;
    expect(pid).toMatch(/^p\./);
    expect(s.snapshot().doc.records.has("waiver:waiv01.1")).toBe(false);
    const prop = s.proposal(pid!)!;
    expect(prop).toMatchObject({ source: "needs-person", actor: AGENT, status: "open" });
    expect(prop.summary.added).toEqual({ waiver: 1 });
    // a router is refused too (no proposal: routers propose through proposeRouteResult)
    expect(s.apply({ batchId: "r1", label: "waive the stitched module via", ops: [WAIVE] }, ROUTER)).toMatchObject({ status: "refused", reason: "needs-person" });
    // the person accepts it: the waiver is the person's transaction with the agent's provenance
    const acc = s.acceptProposal(PERSON, pid!);
    expect(acc.status).toBe("applied");
    const added = [...s.snapshot().doc.records.values()].filter((r) => r.kind === "waiver") as WaiverRec[];
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ by: { kind: "human" }, provenance: { by: "agent", actor: "agent:tidy" } });
    // removing one is a person's call too
    expect(s.apply({ batchId: "a2", label: "remove the module via waiver", ops: [{ op: "waiver.remove", ids: [added[0].id] }] }, AGENT)).toMatchObject({ status: "refused", reason: "needs-person" });
    expect(s.apply({ batchId: "p2", label: "remove the module via waiver", ops: [{ op: "waiver.remove", ids: [added[0].id] }] }, PERSON).status).toBe("applied");
  });

  it("a waiver is saved with the rules and read back", () => {
    const root = mkdtempSync(join(tmpdir(), "pb-board-waiver-"));
    writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
    const dir = join(root, "board");
    mkdirSync(dir, { recursive: true });
    cpSync(fileURLToPath(new URL("./fixtures/airnode-c3/", import.meta.url)), dir, { recursive: true });
    const s = openBoardService({ dir });
    const r = s.apply({ batchId: "w1", label: "waive the stitched module via", ops: [WAIVE] }, PERSON);
    expect(s.save().written).toEqual(["rules"]);
    s.close({ save: false });
    const again = openBoardService({ dir });
    expect(again.snapshot().doc.records.get((r as { created: Record<string, string> }).created.w)?.kind).toBe("waiver");
    again.close({ save: false });
  });
});

describe("pause over the wire", () => {
  const open: { svc?: BoardService; server?: BoardServer; clients: BoardClient[] } = { clients: [] };
  afterEach(async () => {
    for (const c of open.clients.splice(0)) await c.close().catch(() => {});
    await open.server?.close();
    open.svc?.close({ save: false });
  });

  it("board.pause and board.resume, with the presence event", async () => {
    const svc = (open.svc = openBoardService({ document: airnodeC3(), epoch: "paus03" }));
    const server = (open.server = await serveBoard(svc, { serviceFile: false }));
    const c = await wireClient(server.url, server.token);
    open.clients.push(c);
    const events: BoardEvent[] = [];
    c.subscribe((e) => events.push(e));
    const agent = agentActor("placer");
    expect(await c.pause(agent)).toMatchObject({ status: "invalid" });
    const p = await c.pause(PERSON, { reason: "hands off", ttlMs: 60_000 });
    expect(p).toMatchObject({ status: "paused", pause: { reason: "hands off" } });
    expect((await c.presence()).paused).toMatchObject({ reason: "hands off" });
    const r = await c.apply(move("fp:status/r2"), agent);
    expect(r).toMatchObject({ status: "refused", reason: "paused" });
    expect((r as { retryAfterMs?: number }).retryAfterMs).toBeGreaterThan(50_000);
    expect(await c.resume(PERSON)).toMatchObject({ status: "resumed", was: { reason: "hands off" } });
    expect((await c.apply(move("fp:status/r2"), agent)).status).toBe("applied");
    const end = Date.now() + 2000;
    while (events.filter((e) => e.type === "presence").length < 2 && Date.now() < end) await new Promise((x) => setTimeout(x, 10));
    const pres = events.filter((e): e is Extract<BoardEvent, { type: "presence" }> => e.type === "presence");
    expect(pres[0].presence.paused).toMatchObject({ reason: "hands off" });
    expect(pres.at(-1)!.presence.paused).toBeUndefined();
    await expect(c.call("board.pause", { actor: PERSON, ttlMs: -5 })).rejects.toBeInstanceOf(BoardRpcError);
  });
});
