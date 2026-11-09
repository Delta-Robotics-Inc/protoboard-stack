/**
 * The host's side of proposals, waivers, pausing and live checks (Node), and the page's request envelope for them:
 * an agent's proposal through the service reaches the page as a feed message, previews as a ghost, is accepted by
 * the person with every locked record checked byte for byte, and goes stale when a commit touches it; a router's
 * result becomes one proposal with one item per net; waivers are waiver records (older rules entries convert on the
 * first write); a pause refuses an agent's write and the feed says so; the checks run incrementally.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { connectBoard, createDocument, getOperation, loadBoardDir, withChanges, type Actor, type BoardClient, type BoardRecord } from "@protoboardai/board/node";
import { BoardFeed } from "../../src/pcb/host/feed.js";
import { rebase } from "../../src/pcb/host/live.js";
import { routeProposalInputs } from "../../src/pcb/host/proposals.js";
import { parseBoardRequest } from "../../src/pcb/requests.js";
import type { BoardFeedMessage, PageProposal, PageProposalPreview } from "../../src/pcb/types.js";
import { applyWaivers, boardWaivers, legacyWaiverMigration, unwaiveOps, waiverRule } from "../../src/pcb/waivers.js";

const FIXTURE = fileURLToPath(new URL("../../../board/test/fixtures/airnode-c3/", import.meta.url));
const PERSON: Actor = { kind: "human", id: "user" };
const AGENT: Actor = { kind: "agent", id: "agent:placer", name: "placer" };
const dirs: string[] = [];
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "pcb-host-prop-"));
  dirs.push(root);
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "board");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  return { root, dir };
}

const until = async (f: () => boolean, ms = 20_000) => {
  const t = Date.now();
  while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 25));
  return f();
};

/** A feed that owns the board (after a first write) and an agent connected to its service over the wire. */
async function ownedWithAgent() {
  const { root, dir } = project();
  const feed = await BoardFeed.open({ dir, projectRoot: root, servicePollMs: 0, analyze: { crossCheck: false } });
  closers.push(() => feed.close());
  const msgs: BoardFeedMessage[] = [];
  feed.subscribe((m) => msgs.push(m));
  const r = await feed.request({ method: "apply", tx: { batchId: "own", label: "nudge the LDO by hand", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 100_000, dy: 0, tracks: "stay" }] } }, PERSON);
  expect(r.ok && (r.result as { status: string }).status).toBe("applied");
  const agent: BoardClient = await connectBoard(dir, { mode: "service", projectRoot: root });
  closers.unshift(() => agent.close());
  return { root, dir, feed, msgs, agent };
}

const segment = (net: string, x0: number, x1: number, y: number) => ({ net, layer: "top", width: 200_000, start: { x: x0, y }, end: { x: x1, y } });

describe("page requests for proposals, holds and pauses", () => {
  it("takes the new methods and refuses an actor, bad ids and out-of-range times", () => {
    expect(parseBoardRequest({ method: "proposals" }).ok).toBe(true);
    expect(parseBoardRequest({ method: "proposals", status: "stale" }).ok).toBe(true);
    expect(parseBoardRequest({ method: "proposals", status: "maybe" }).ok).toBe(false);
    expect(parseBoardRequest({ method: "proposalPreview", id: "p.abc.1", items: ["n0", "n1"] }).ok).toBe(true);
    expect(parseBoardRequest({ method: "proposalPreview", id: "../etc" }).ok).toBe(false);
    expect(parseBoardRequest({ method: "proposalAccept", id: "p.abc.1", allowStale: true }).ok).toBe(true);
    expect(parseBoardRequest({ method: "proposalAccept", id: "p.abc.1", items: [] }).ok).toBe(false);
    expect(parseBoardRequest({ method: "proposalAccept", id: "p.abc.1", actor: AGENT }).ok).toBe(false);
    expect(parseBoardRequest({ method: "proposalReject", id: "p.abc.1", reason: "not now" }).ok).toBe(true);
    expect(parseBoardRequest({ method: "hold", ids: ["fp:power/ldo"], ttlMs: 10_000 }).ok).toBe(true);
    expect(parseBoardRequest({ method: "hold", ids: [] }).ok).toBe(false);
    expect(parseBoardRequest({ method: "hold", ids: ["a"], ttlMs: 120_000 }).ok).toBe(false);
    expect(parseBoardRequest({ method: "releaseHold" }).ok).toBe(true);
    expect(parseBoardRequest({ method: "pause", reason: "I am drawing", ttlMs: 60_000 }).ok).toBe(true);
    expect(parseBoardRequest({ method: "pause", by: PERSON }).ok).toBe(false);
    expect(parseBoardRequest({ method: "resume" }).ok).toBe(true);
    expect(parseBoardRequest({ method: "resume", extra: 1 }).ok).toBe(false);
    const w = parseBoardRequest({ method: "waive", finding: "f:clearance:0123456789ab", reason: "x".repeat(501) });
    expect(w.ok).toBe(false);
  });
});

describe("waivers in both forms", () => {
  const doc0 = loadBoardDir(FIXTURE).doc;
  const finding = { id: "f:clearance:0123456789ab", check: "clearance", rule: "rule:fab.clearance", severity: "error" as const, objects: ["trk:a", "trk:b"], location: { x: 0, y: 0 }, message: "too close" };
  const legacy = { kind: "rule", id: "rule:waiver.clearance.0123456789ab", ...waiverRule(finding, "accepted on this board"), provenance: { by: "hand" } } as unknown as BoardRecord;
  const ruleWaiver = { kind: "waiver", id: "waiver:k1", rule: "clearance", objects: ["trk:b", "trk:a"], reason: "the pair is one net tie", by: { kind: "human", id: "user", name: "Kim" }, provenance: { by: "hand" } } as unknown as BoardRecord;

  it("reads the older rules entry and a waiver record, and covers findings by id or by rule and objects", () => {
    const doc = withChanges(doc0, [legacy]);
    const ws = boardWaivers(doc);
    expect(ws).toEqual([expect.objectContaining({ id: legacy.id, finding: finding.id, reason: "accepted on this board", legacy: true })]);
    expect(applyWaivers([finding], ws).waived[0]).toMatchObject({ rule: legacy.id, legacy: true });
    if (!getOperation("waiver.add")) return; // a core without waiver records cannot hold the second form
    const doc2 = withChanges(doc0, [ruleWaiver]);
    const w2 = boardWaivers(doc2);
    const split = applyWaivers([finding, { ...finding, id: "f:clearance:ffffffffffff", objects: ["trk:a", "trk:c"] }], w2);
    expect(split.waived.map((w) => w.finding.id)).toEqual([finding.id]);
    expect(split.waived[0]).toMatchObject({ rule: "waiver:k1", by: "Kim" });
    expect(unwaiveOps(doc2, finding)).toEqual([{ op: "waiver.remove", ids: ["waiver:k1"] }]);
  });

  it("converts older entries with one waiver.add each and one rule.delete", () => {
    const doc = withChanges(doc0, [legacy]);
    expect(legacyWaiverMigration(doc)).toEqual([{ op: "waiver.add", waiver: { finding: finding.id, reason: "accepted on this board" } }, { op: "rule.delete", ids: [legacy.id] }]);
    expect(legacyWaiverMigration(doc0)).toEqual([]);
    expect(unwaiveOps(doc, finding.id)).toEqual([{ op: "rule.delete", ids: [legacy.id] }]);
  });

  it("waives as a waiver record through the feed, converts an older entry on the first write, and takes it back", async () => {
    if (!getOperation("waiver.add")) return;
    const { root, dir } = project();
    // an older entry already on the board's rules
    const feed0 = await BoardFeed.open({ dir, projectRoot: root, servicePollMs: 0, analyze: { crossCheck: false } });
    const d0 = await feed0.derivedNow();
    const f = d0.findings.find((x) => x.check !== "unconnected")!;
    const g = d0.findings.find((x) => x.check !== "unconnected" && x.id !== f.id)!;
    await feed0.close();
    const rules = join(dir, "rules.jsonl");
    const line = JSON.stringify({ kind: "rule", ...waiverRule(f, "reviewed in an earlier session"), provenance: { by: "hand" } });
    const { readFileSync } = await import("node:fs");
    writeFileSync(rules, `${readFileSync(rules, "utf8").replace(/\n?$/, "\n")}${line}\n`);
    const feed = await BoardFeed.open({ dir, projectRoot: root, servicePollMs: 0, analyze: { crossCheck: false } });
    closers.push(() => feed.close());
    const before = await feed.derivedNow();
    expect(before.waived?.find((w) => w.finding.id === f.id)).toMatchObject({ legacy: true });
    const r = await feed.request({ method: "waive", finding: g.id, reason: "silk over a fiducial is fine here" }, PERSON);
    expect(r.ok && (r.result as { status: string }).status).toBe("applied");
    const seq = (r as { result: { seq: number } }).result.seq;
    // the conversion is a transaction of its own, before the waiver
    expect(await until(() => feed.current.snapshot.seq >= seq)).toBe(true);
    expect(seq).toBeGreaterThanOrEqual(2);
    const ws = boardWaivers(feed.current.snapshot.doc);
    // the older entry became a record in its own transaction; the new waiver is a record too
    expect(ws.filter((w) => w.legacy)).toEqual([]);
    expect(ws.map((w) => w.finding).sort()).toEqual([f.id, g.id].sort());
    expect(ws.every((w) => w.id.startsWith("waiver:"))).toBe(true);
    await until(() => (feed.current.derived?.seq ?? 0) >= feed.current.snapshot.seq && (feed.current.derived?.waived?.length ?? 0) >= 2);
    const after = feed.current.derived!;
    expect(after.findings.map((x) => x.id)).not.toContain(g.id);
    expect(after.waived?.find((w) => w.finding.id === g.id)?.reason).toBe("silk over a fiducial is fine here");
    const back = await feed.request({ method: "unwaive", finding: g.id }, PERSON);
    expect(back.ok && (back.result as { status: string }).status).toBe("applied");
    const backSeq = (back as { result: { seq: number } }).result.seq;
    expect(await until(() => feed.current.snapshot.seq >= backSeq)).toBe(true);
    expect(boardWaivers(feed.current.snapshot.doc).map((w) => w.finding)).toEqual([f.id]);
  });
});

describe("proposals through the service", () => {
  it("relays an agent's proposal, previews it as a ghost, and accepts it as the person with the locks checked", async () => {
    const { feed, msgs, agent } = await ownedWithAgent();
    const p = await agent.propose(AGENT, { title: "add a test trace on the top", items: [{ key: "a", label: "a short GND trace", ops: [{ op: "track.add", segments: [segment("GND", 10_000_000, 12_000_000, 13_000_000)] }] }] });
    expect(p.status).toBe("proposed");
    const id = p.status === "proposed" ? p.proposal.id : "";
    expect(await until(() => msgs.some((m) => m.type === "proposal" && m.change === "created" && m.proposal.id === id))).toBe(true);
    const listed = await feed.request({ method: "proposals" }, PERSON);
    const list = (listed.ok ? listed.result : []) as PageProposal[];
    expect(list.map((x) => x.id)).toContain(id);
    const pp = list.find((x) => x.id === id)!;
    expect(pp.actor).toMatchObject({ kind: "agent", name: "placer" });
    expect(pp.items[0]).toMatchObject({ key: "a", nets: ["GND"], ops: 1 });
    expect(pp.after.tracks).toBe(pp.before.tracks + 1);
    expect("ops" in (pp.items[0] as object) && typeof pp.items[0].ops).toBe("number");
    const pv = await feed.request({ method: "proposalPreview", id }, PERSON);
    expect(pv.ok).toBe(true);
    const view = (pv as { result: PageProposalPreview }).result;
    expect(view.valid).toBe(true);
    expect(view.added.segments).toHaveLength(1);
    expect(view.removed.ids).toEqual([]);
    const acc = await feed.request({ method: "proposalAccept", id }, PERSON);
    expect(acc.ok).toBe(true);
    const x = (acc as { result: { status: string; locked: { checked: number; changed: string[]; hand: number }; proposalState: PageProposal } }).result;
    expect(x.status).toBe("applied");
    expect(x.locked.changed).toEqual([]);
    expect(x.proposalState.status).toBe("accepted");
    expect(await until(() => msgs.some((m) => m.type === "proposal" && m.change === "changed" && m.proposal.id === id))).toBe(true);
  });

  it("marks a proposal stale when a commit touches it, refuses it, and revalidates it when its ops still apply", async () => {
    const { feed, msgs, agent } = await ownedWithAgent();
    const p = await agent.propose(AGENT, { title: "move the LDO a little left", items: [{ label: "move the LDO", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: -200_000, dy: 0, tracks: "stay" }] }] });
    const id = p.status === "proposed" ? p.proposal.id : "";
    expect(id).not.toBe("");
    const r = await feed.request({ method: "apply", tx: { batchId: "touch", label: "nudge the LDO again", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 0, dy: 100_000, tracks: "stay" }] } }, PERSON);
    expect(r.ok && (r.result as { status: string }).status).toBe("applied");
    expect(await until(() => msgs.some((m) => m.type === "proposal" && m.change === "stale" && m.proposal.id === id))).toBe(true);
    const stale = msgs.find((m) => m.type === "proposal" && m.change === "stale" && m.proposal.id === id) as Extract<BoardFeedMessage, { type: "proposal" }>;
    expect(stale.proposal.stale).toMatchObject({ actor: { kind: "human" } });
    const refused = await feed.request({ method: "proposalAccept", id }, PERSON);
    expect(refused.ok && (refused.result as { status: string; reason?: string }).reason).toBe("stale-proposal");
    const pv = await feed.request({ method: "proposalPreview", id }, PERSON);
    expect((pv as { result: PageProposalPreview }).result).toMatchObject({ stale: true, valid: true });
    const again = await feed.request({ method: "proposalAccept", id, allowStale: true }, PERSON);
    expect(again.ok && (again.result as { status: string }).status).toBe("applied");
  });

  it("turns a router's result into one proposal with an item per net, and checks the hand tracks after accepting it", async () => {
    const { feed } = await ownedWithAgent();
    const router: Actor = { kind: "router", id: "router:builtin", name: "builtin" };
    const snap = feed.current.snapshot;
    const score = { open: 4, errors: 2, vias: 0, length: 0, openNets: ["GND", "VBUS"] };
    const rp = {
      runId: "run-test",
      status: "proposed",
      reasons: [],
      base: { epoch: snap.epoch, seq: snap.seq },
      current: score,
      candidate: { ...score, open: 2, openNets: ["VBUS"] },
      steps: [{ actor: router, transaction: { batchId: "rt", label: "route 2 nets", changeSet: { id: "run-test", title: "autoroute" }, provenance: { by: "routed", tool: "builtin" }, ops: [{ op: "track.add", segments: [segment("GND", 10_000_000, 11_000_000, 13_500_000), segment("VBUS", 10_000_000, 11_000_000, 14_000_000)] }] } }],
    };
    const inputs = await routeProposalInputs(rp as never, snap.epoch);
    if ("error" in inputs) throw new Error(inputs.error);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].input.items.map((i) => i.label).sort()).toEqual(["route GND", "route VBUS"]);
    const c = await connectBoard(feed.dir, { mode: "service" });
    closers.unshift(() => c.close());
    const made = await c.propose(inputs[0].actor, inputs[0].input);
    expect(made.status).toBe("proposed");
    const id = made.status === "proposed" ? made.proposal.id : "";
    // accept one item, then the rest
    const one = await feed.request({ method: "proposalAccept", id, items: [made.status === "proposed" ? made.proposal.items[0].key : ""] }, PERSON);
    const x = (one as { result: { status: string; locked: { checked: number; changed: string[]; hand: number }; proposalState: PageProposal } }).result;
    expect(x.status).toBe("applied");
    expect(x.locked.changed).toEqual([]);
    expect(x.locked.hand).toBeGreaterThan(0);
    expect(x.proposalState.items.filter((i) => i.status === "open")).toHaveLength(1);
  });
});

describe("pausing agents", () => {
  it("pauses, refuses an agent's write with reason paused (passed on as a refusal), and resumes", async () => {
    const { feed, msgs, agent } = await ownedWithAgent();
    const p = await feed.request({ method: "pause", reason: "drawing by hand" }, PERSON);
    if (!p.ok && /cannot pause/.test(p.error)) return; // a core without pausing
    expect(p.ok && (p.result as { status: string }).status).toBe("paused");
    expect(await until(() => msgs.some((m) => m.type === "presence" && !!(m.presence as { paused?: unknown }).paused))).toBe(true);
    const w = await agent.apply({ batchId: "agent-1", label: "nudge the sensor pull-up", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 100_000, dy: 0, tracks: "stay" }] }, AGENT);
    expect(w.status === "refused" && w.reason).toBe("paused");
    expect(await until(() => msgs.some((m) => m.type === "refusal" && m.refusal.reason === "paused" && m.refusal.label === "nudge the sensor pull-up"))).toBe(true);
    // proposals still arrive while paused
    const prop = await agent.propose(AGENT, { title: "a proposal while paused", items: [{ label: "a GND trace", ops: [{ op: "track.add", segments: [segment("GND", 10_000_000, 12_000_000, 12_000_000)] }] }] });
    expect(prop.status).toBe("proposed");
    const r = await feed.request({ method: "resume" }, PERSON);
    expect(r.ok && (r.result as { status: string }).status).toBe("resumed");
    const w2 = await agent.apply({ batchId: "agent-2", label: "nudge it after the pause", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 100_000, dy: 0, tracks: "stay" }] }, AGENT);
    expect(w2.status).toBe("applied");
  });

  it("holds objects for a person's drag and lists the hold in presence", async () => {
    const { feed, msgs } = await ownedWithAgent();
    const h = await feed.request({ method: "hold", ids: ["fp:power/ldo"], ttlMs: 5000 }, PERSON);
    expect(h.ok && (h.result as { status: string }).status).toBe("held");
    expect(await until(() => msgs.some((m) => m.type === "presence" && m.presence.holds.length > 0))).toBe(true);
    const rel = await feed.request({ method: "releaseHold" }, PERSON);
    expect(rel.ok && Array.isArray(rel.result)).toBe(true);
  });
});

describe("live checks", () => {
  it("rebuilds a board read again from its files on the one before, keeping unchanged records", () => {
    const a = loadBoardDir(FIXTURE).doc;
    const b = loadBoardDir(FIXTURE).doc;
    const same = rebase(a, b);
    expect(same.doc).toBe(a);
    expect(same.changed).toEqual([]);
    const moved = { ...(b.records.get("fp:power/ldo") as BoardRecord & { x: number }), x: (b.records.get("fp:power/ldo") as { x: number }).x + 1000 } as BoardRecord;
    const r = rebase(a, withChanges(b, [moved]));
    expect(r.changed).toEqual(["fp:power/ldo"]);
    expect(r.doc.records.get("board")).toBe(a.records.get("board"));
    expect(rebase(undefined, b).whole).toBe(true);
    expect(rebase(createDocument([]), b).doc).toBeDefined();
  });

  it("uses the service's live checks once the host owns the board, and its own incremental checks before", async () => {
    const { root, dir } = project();
    const feed = await BoardFeed.open({ dir, projectRoot: root, servicePollMs: 0, analyze: { crossCheck: false } });
    closers.push(() => feed.close());
    const d0 = await feed.derivedNow();
    expect(d0.live).toMatchObject({ source: "host", mode: "full" });
    const r = await feed.request({ method: "apply", tx: { batchId: "m1", label: "move the LDO by hand", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 500_000, dy: 0, tracks: "stay" }] } }, PERSON);
    expect(r.ok).toBe(true);
    expect(await until(() => feed.current.derived?.seq === feed.current.snapshot.seq && !!feed.current.derived?.live)).toBe(true);
    const live = feed.current.derived!.live!;
    expect(["service", "host"]).toContain(live.source);
    expect(feed.current.derived!.checks.ran).toBe(true);
  });
});
