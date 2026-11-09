/**
 * The editing commands of `protoboard board` (Phase 2 bindings, section 9, and P2-E's pause and waivers), in this
 * process on copies of the Airnode C3 fixture: proposals listed, shown, previewed, proposed, accepted by a person only
 * and rejected; pause and resume of a running service and `apply --wait`; `route --propose`; the corridor query;
 * `board serve` with live checks and board.diagnose; and the MCP tools that go with them.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BoardRpcError, findService, openBoardService, RPC_ERRORS, serveBoard, wireClient, type BoardServer, type BoardService } from "@protoboardai/board/node";
import { builtinRouter } from "@protoboardai/board-route";
import { boardCommand, type RoutingDeps } from "../src/board.js";
import { boardTools } from "../src/mcp/board-tools.js";
import { DESCRIPTION_LIMIT } from "../src/mcp/instructions.js";
import type { CliRun, ToolContext } from "../src/mcp/tools.js";

const FIXTURE = fileURLToPath(new URL("../../board/test/fixtures/airnode-c3/", import.meta.url));
const AGENT_ENV = { PROTOBOARD_AGENT: "planner" };

function project() {
  const root = mkdtempSync(join(tmpdir(), "pb-board-edit-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "board");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  return { root, dir };
}

async function run(argv: string[], cwd: string, env: NodeJS.ProcessEnv = {}, routing?: RoutingDeps): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const code = await boardCommand(argv, { cwd, env, write: (s) => (stdout += s), stderr: (s) => (stderr += s), ...(routing ? { routing } : {}) });
  return { code, stdout, stderr };
}
const json = (r: CliRun) => JSON.parse(r.stdout);

const files = (dir: string) => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
const move = (id: string, dx = 100_000) => ({ op: "footprint.move", ids: [id], dx, dy: 0, tracks: "stay" });

const open: { svc?: BoardService; server?: BoardServer } = {};
afterEach(async () => {
  await open.server?.close();
  open.svc?.close({ save: false });
  open.server = undefined;
  open.svc = undefined;
});
/** A running service for the board (service.json written), as `board serve` runs it. */
async function serve(dir: string) {
  open.svc = openBoardService({ dir });
  open.server = await serveBoard(open.svc);
  return open.svc;
}

describe("proposals through the CLI", () => {
  it("an agent proposes; a person lists, reads, previews, accepts one item and rejects the other", async () => {
    const { root, dir } = project();
    const svc = await serve(dir);
    const file = join(root, "proposal.json");
    writeFileSync(file, JSON.stringify({ title: "nudge the two LED resistors right", items: [{ key: "r2", label: "move R2 right", ops: [move("fp:status/r2")] }, { key: "r1", label: "move R1 right", ops: [move("fp:status/r1")] }] }));
    const before = svc.seq;
    const p = await run(["propose", dir, file, "--json"], root, AGENT_ENV);
    expect(p.code, p.stdout).toBe(0);
    const proposal = json(p).proposal;
    expect(proposal).toMatchObject({ status: "open", actor: { kind: "agent", id: "agent:planner" }, title: "nudge the two LED resistors right" });
    expect(svc.seq).toBe(before);

    const listed = json(await run(["proposals", dir, "--json"], root));
    expect(listed.mode).toBe("service");
    expect(listed.proposals.map((x: { id: string }) => x.id)).toEqual([proposal.id]);
    expect(json(await run(["proposals", dir, "--status", "accepted", "--json"], root)).proposals).toEqual([]);
    const text = (await run(["proposals", dir], root)).stdout;
    expect(text).toContain(proposal.id);
    expect(text).toContain("by agent agent:planner; 2 item(s); changed 2 footprint");

    const shown = await run(["proposal", dir, proposal.id, "--preview", "--json"], root);
    expect(json(shown)).toMatchObject({ id: proposal.id, preview: { valid: true, stale: false } });
    expect(json(shown).preview.changed.map((c: { after: { id: string } }) => c.after.id).sort()).toEqual(["fp:status/r1", "fp:status/r2"]);
    const shownText = (await run(["proposal", dir, proposal.id], root)).stdout;
    expect(shownText).toMatch(/OPEN {2}"nudge the two LED resistors right"/);
    expect(shownText).toContain("before: ");
    expect(shownText).toContain("r2     open     move R2 right");

    // a person's call: refused for the agent
    const refused = await run(["accept", dir, proposal.id, "--json"], root, AGENT_ENV);
    expect(refused.code).toBe(3);
    expect(json(refused)).toMatchObject({ status: "refused", reason: "not-a-person" });

    const acc = await run(["accept", dir, proposal.id, "--items", "r2", "--json"], root);
    expect(acc.code, acc.stdout).toBe(0);
    expect(json(acc)).toMatchObject({ status: "applied", changed: ["fp:status/r2"], proposalState: { items: [{ key: "r2", status: "accepted" }, { key: "r1", status: "open" }] } });
    expect(svc.log().at(-1)).toMatchObject({ actor: { kind: "human" }, proposal: proposal.id });

    const rej = await run(["reject", dir, proposal.id, "--items", "r1", "--reason", "R1 stays where it is", "--json"], root);
    expect(rej.code).toBe(0);
    expect(json(rej)).toMatchObject({ status: "rejected", proposal: { status: "partial", rejected: { reason: "R1 stays where it is" } } });
    expect((await run(["reject", dir, proposal.id], root)).code).toBe(1);
    expect((await run(["proposal", dir, "p.nope.1", "--json"], root)).code).toBe(1);
  });

  it("an agent's waiver is stored as a proposal a person accepts", async () => {
    const { root, dir } = project();
    await serve(dir);
    const file = join(root, "waive.json");
    writeFileSync(file, JSON.stringify({ op: "waiver.add", waiver: { rule: "via_under_footprint", objects: ["fp:mcu/module", "via:f.gnd.1"], reason: "stitched on purpose" } }));
    const r = await run(["apply", dir, file, "--json"], root, AGENT_ENV);
    expect(r.code).toBe(3);
    const reply = json(r);
    expect(reply).toMatchObject({ status: "refused", reason: "needs-person" });
    expect(reply.proposal).toMatch(/^p\./);
    const acc = await run(["accept", dir, reply.proposal, "--json"], root);
    expect(json(acc).status).toBe("applied");
    expect(json(acc).changed[0]).toMatch(/^waiver:/);
  });

  it("with no running service the board's stored proposals of an earlier call read as stale; --allow-stale revalidates", async () => {
    const { root, dir } = project();
    const file = join(root, "proposal.json");
    writeFileSync(file, JSON.stringify({ title: "nudge the LED resistor right", items: [{ label: "move R2", ops: [move("fp:status/r2")] }] }));
    const before = files(dir);
    const p = json(await run(["propose", dir, file, "--json"], root, AGENT_ENV));
    expect(p.mode).toBe("local");
    expect(files(dir)).toEqual(before);
    const stale = await run(["accept", dir, p.proposal.id, "--json"], root);
    expect(stale.code).toBe(3);
    expect(json(stale)).toMatchObject({ status: "refused", reason: "stale-proposal" });
    expect((await run(["accept", dir, p.proposal.id], root)).stdout).toContain("--allow-stale revalidates");
    const acc = await run(["accept", dir, p.proposal.id, "--allow-stale", "--json"], root);
    expect(json(acc).status, acc.stdout).toBe("applied");
    expect(files(dir)["placement.jsonl"]).not.toBe(before["placement.jsonl"]);
  });

  it("a proposal file that is not a proposal is a usage error, an invalid one exit 1", async () => {
    const { root, dir } = project();
    const bad = join(root, "bad.json");
    writeFileSync(bad, "[]");
    expect((await run(["propose", dir, bad], root)).code).toBe(2);
    writeFileSync(bad, JSON.stringify({ title: "two words", items: [{ label: "x", ops: [move("fp:status/r2")] }] }));
    const r = await run(["propose", dir, bad, "--json"], root);
    expect(r.code).toBe(1);
    expect(json(r).error).toMatch(/3 to 12 words/);
  });
});

describe("a person's check of a change before accepting it (the Phase 2 exit test's additions)", () => {
  const trackOp = (y: number) => ({ op: "track.add", segments: [{ net: "+3V3", layer: "top", width: 250_000, start: { x: -9_950_000, y }, end: { x: -9_950_000, y: y + 1_000_000 } }] });

  it("accept, pause and resume take --as human; under an agent it is still refused as not a person", async () => {
    const { root, dir } = project();
    await serve(dir);
    const file = join(root, "proposal.json");
    writeFileSync(file, JSON.stringify({ title: "nudge the LED resistor right", items: [{ label: "move R2", ops: [move("fp:status/r2")] }] }));
    const p = json(await run(["propose", dir, file, "--json"], root, AGENT_ENV)).proposal;
    const asAgent = await run(["accept", dir, p.id, "--as", "human", "--json"], root, AGENT_ENV);
    expect(asAgent.code).toBe(3);
    expect(json(asAgent)).toMatchObject({ status: "refused", reason: "not-a-person" });
    const named = await run(["accept", dir, p.id, "--as", "agent:helper", "--json"], root);
    expect(named.code).toBe(3);
    expect(json(named).message).toContain("agent:helper");
    const acc = await run(["accept", dir, p.id, "--as", "human", "--json"], root);
    expect(acc.code, acc.stdout).toBe(0);
    expect(json(acc).status).toBe("applied");
    expect((await run(["pause", dir, "--as", "human", "--json"], root)).code).toBe(0);
    expect((await run(["resume", dir, "--as", "human", "--json"], root)).code).toBe(0);
  });

  it("check --with a proposal file (all items or --items) and --proposal <id> count the board as it would be, changing nothing", async () => {
    const { root, dir } = project();
    const svc = await serve(dir);
    // the service has issued ids in its epoch already: the copy must not reuse them (it would overwrite this track)
    writeFileSync(join(root, "t.json"), JSON.stringify(trackOp(-1_800_000)));
    expect((await run(["apply", dir, join(root, "t.json"), "--json"], root)).code).toBe(0);
    const file = join(root, "proposal.json");
    writeFileSync(file, JSON.stringify({ title: "add two short 3V3 segments", items: [{ key: "a", label: "one", ops: [trackOp(3_000_000)] }, { key: "b", label: "two", ops: [trackOp(6_000_000)] }] }));
    const now = json(await run(["check", dir, "--json"], root));
    const before = files(dir);
    const seq = svc.seq;

    const all = await run(["check", dir, "--with", file, "--json"], root, AGENT_ENV);
    expect([0, 1]).toContain(all.code);
    const a = json(all);
    expect(a.with).toMatchObject({ kind: "with", now: { line: now.summary.line } });
    expect(a.crossCheck).toMatchObject({ ran: false });
    const one = json(await run(["check", dir, "--with", file, "--items", "a", "--json"], root, AGENT_ENV));
    expect(one.with.items).toEqual(["a"]);
    expect((await run(["check", dir, "--with", file, "--items", "zz"], root)).code).toBe(2);
    expect((await run(["check", dir, "--with", file], root)).stdout).toMatch(/applied on a copy; nothing changed\n {2}the board now: /);

    const p = json(await run(["propose", dir, file, "--json"], root, AGENT_ENV)).proposal;
    const byId = json(await run(["check", dir, "--proposal", p.id, "--json"], root));
    const counts = (x: { summary: { unconnected: number; errors: number; warnings: number } }) => [x.summary.unconnected, x.summary.errors, x.summary.warnings];
    expect(counts(byId)).toEqual(counts(a));
    expect(counts(a)).not.toEqual(counts(now));
    expect(byId.with).toMatchObject({ kind: "proposal", id: p.id });
    expect((await run(["check", dir, "--proposal", "p.nope.1", "--json"], root)).code).toBe(1);
    expect((await run(["check", dir, "--proposal", p.id, "--kicad", file], root)).code).toBe(2);

    expect(svc.seq).toBe(seq);
    expect(files(dir)).toEqual(before);
  });

  it("check --refill fills the zones again with the fill engine instead of the cached fill", async () => {
    const { root, dir } = project();
    const r = json(await run(["check", dir, "--refill", "--json"], root));
    expect(r.fill.source).toBe("computed");
    expect(r.fill.current).toBe(true);
  });
});

describe("pause and resume", () => {
  it("a person pauses a running service; agents are refused; --wait waits out a pause with a ttl; resume", async () => {
    const { root, dir } = project();
    await serve(dir);
    const tx = join(root, "tx.json");
    writeFileSync(tx, JSON.stringify(move("fp:status/r2")));
    expect(json(await run(["pause", dir, "--json"], root, AGENT_ENV))).toMatchObject({ status: "refused", reason: "not-a-person" });
    const p = await run(["pause", dir, "--reason", "reviewing the power section", "--ttl", "1.5", "--json"], root);
    expect(p.code, p.stdout).toBe(0);
    expect(json(p)).toMatchObject({ status: "paused", pause: { reason: "reviewing the power section" } });
    expect(json(p).pause.until - json(p).pause.since).toBe(1500);
    const presence = json(await run(["presence", dir, "--json"], root));
    expect(presence.paused).toMatchObject({ reason: "reviewing the power section" });

    const refused = await run(["apply", dir, tx, "--as", "agent:tidy", "--json"], root);
    expect(refused.code).toBe(3);
    expect(json(refused)).toMatchObject({ status: "refused", reason: "paused" });
    // a person is not paused
    expect((await run(["apply", dir, tx, "--json"], root)).code).toBe(0);
    const waited = await run(["apply", dir, tx, "--as", "agent:tidy", "--wait", "10", "--json"], root);
    expect(waited.code, waited.stdout).toBe(0);
    expect(json(waited).status).toBe("applied");
    expect(json(waited).waited.tries).toBeGreaterThan(1);

    expect(json(await run(["pause", dir, "--json"], root)).status).toBe("paused");
    expect((await run(["pause", dir], root)).stdout).toMatch(/^PAUSED {2}agents and routers are refused until you resume/);
    const r = await run(["resume", dir, "--json"], root);
    expect(json(r)).toMatchObject({ status: "resumed", was: { by: { kind: "human" } } });
    expect((await run(["resume", dir], root)).stdout).toMatch(/RESUMED {2}nothing was paused/);
    expect((await run(["apply", dir, tx, "--as", "agent:tidy", "--json"], root)).code).toBe(0);
  }, 30_000);

  it("needs a running service, and --wait needs a write", async () => {
    const { root, dir } = project();
    const r = await run(["pause", dir, "--json"], root);
    expect(r.code).toBe(2);
    expect(json(r).error).toMatch(/no board service is running/);
    writeFileSync(join(root, "tx.json"), JSON.stringify(move("fp:status/r2")));
    expect((await run(["apply", dir, join(root, "tx.json"), "--dry-run", "--wait", "2"], root)).code).toBe(2);
    expect((await run(["pause", dir, "--ttl", "soon"], root)).code).toBe(2);
  });
});

describe("board route --propose", () => {
  it("stores the result as proposals with the scores, and changes nothing", async () => {
    const { root, dir } = project();
    await serve(dir);
    const before = files(dir);
    const r = await run(["route", dir, "--propose", "--json"], root, {}, { routers: [builtinRouter()] });
    const p = json(r);
    expect(p.status, r.stdout).toBe("proposed");
    expect(r.code).toBe(0);
    expect(p.applied).toBeNull();
    expect(p.proposals.length).toBe(p.steps.length);
    const id = p.proposals[0].id;
    expect(id).toMatch(/^p\./);
    expect(p.proposals[0].items.length).toBeGreaterThan(0);
    const shown = json(await run(["proposal", dir, id, "--json"], root));
    expect(shown).toMatchObject({ actor: { kind: "router", id: "router:builtin" }, source: "router", scores: { current: { open: p.current.open }, candidate: { open: p.candidate.open } } });
    expect((await run(["proposal", dir, id], root)).stdout).toMatch(/scores: current \d+ open, .*; candidate \d+ open/);
    expect(files(dir)).toEqual(before);
    expect((await run(["route", dir, "--propose", "--apply"], root, {}, { routers: [builtinRouter()] })).code).toBe(2);
    const text = (await run(["route", dir, "--propose"], root, {}, { routers: [builtinRouter()] })).stdout;
    expect(text).toMatch(/^PROPOSED {2}\(nothing changed; stored for a person to accept\)/);
    expect(text).toMatch(/stored as proposal p\./);
  }, 60_000);
});

describe("board corridor", () => {
  it("finds a free corridor between two points on a layer, and reports a blocked one with its blockers", async () => {
    const { root, dir } = project();
    const r = await run(["corridor", dir, "--from", "-16mm,10mm", "--to", "-13mm,7mm", "--layer", "top", "--json"], root);
    expect(r.code, r.stdout).toBe(0);
    const c = json(r);
    expect(c).toMatchObject({ found: true, layer: "top", units: "mm" });
    expect(c.length).toBeGreaterThan(4);
    expect(c.path.length).toBeGreaterThan(1);
    expect((await run(["corridor", dir, "--from", "-16mm,10mm", "--to", "-13mm,7mm", "--layer", "top"], root)).stdout).toMatch(/^FOUND {2}a free corridor on top/);
    const b = await run(["corridor", dir, "--from", "-18mm,-12mm", "--to", "18mm,12mm", "--layer", "top", "--width", "3mm", "--json"], root);
    expect(b.code).toBe(1);
    expect(json(b)).toMatchObject({ found: false, width: 3 });
    expect(json(b).blockedBy.length).toBeGreaterThan(0);
  }, 60_000);

  it("takes object ids, and refuses a layer or net the board does not have", async () => {
    const { root, dir } = project();
    const r = await run(["corridor", dir, "--from", "fp:status/led1", "--to", "fp:status/r2", "--layer", "top", "--json"], root);
    expect([0, 1]).toContain(r.code);
    expect(json(r)).toHaveProperty("found");
    expect((await run(["corridor", dir, "--from", "0,0", "--to", "1mm,0", "--layer", "inner7"], root)).code).toBe(2);
    expect((await run(["corridor", dir, "--from", "0,0", "--to", "1mm,0", "--layer", "top", "--net", "NOPE"], root)).code).toBe(2);
    expect((await run(["corridor", dir, "--to", "1mm,0", "--layer", "top"], root)).code).toBe(2);
  }, 60_000);
});

describe("board serve with the editing kernel", () => {
  it("publishes derived state and offers board.diagnose", async () => {
    const { root, dir } = project();
    const stop = new AbortController();
    let ready!: () => void;
    const up = new Promise<void>((r) => (ready = r));
    const serving = boardCommand(["serve", dir, "--json"], { cwd: root, env: {}, write: () => {}, stderr: () => {}, signal: stop.signal, onServing: () => ready() });
    await up;
    try {
      const s = findService(dir)!;
      const c = await wireClient(`ws://127.0.0.1:${s.port}/`, s.token);
      try {
        const d = await c.derived();
        expect(d).not.toBeNull();
        expect(d!.summary.line).toMatch(/unconnected/);
        expect(d!.timing.mode).toBe("full");
        // the method exists (bad params, not an unknown method)
        const err = await c.callExtension("board.diagnose", {}).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BoardRpcError);
        expect((err as BoardRpcError).code).toBe(RPC_ERRORS.invalidParams);
      } finally {
        await c.close();
      }
    } finally {
      stop.abort();
      await serving;
    }
  }, 60_000);
});

describe("the MCP tools", () => {
  const ctx = (cwd: string): ToolContext => ({
    dir: async (given) => (given ? given : cwd),
    cli: (dir, args) => run(args.slice(1), dir),
    cliFor: () => ({ entry: "in-process", from: "server" }),
    version: "test",
    about: "",
    clientName: () => "edit-test",
  });
  const tool = (name: string) => boardTools().find((t) => t.name === name)!;

  it("propose as the agent, read proposals and one proposal, ask for a corridor; none accepts, rejects, pauses or resumes", async () => {
    const { root, dir } = project();
    const out = await tool("board_propose").handler({ dir, title: "nudge the LED resistor right", items: [{ label: "move R2", ops: [move("fp:status/r2")] }] } as never, ctx(root));
    const p = (out.data as { proposal: { id: string; actor: { id: string } } }).proposal;
    expect(p.actor.id).toBe("agent:edit-test");
    const ls = (await tool("board_proposals").handler({ dir } as never, ctx(root))).data as { proposals: { id: string }[] };
    expect(ls.proposals.map((x) => x.id)).toEqual([p.id]);
    const one = (await tool("board_proposal").handler({ dir, id: p.id, preview: true } as never, ctx(root))).data as { id: string; preview: unknown };
    expect(one.id).toBe(p.id);
    expect(one.preview).toBeTruthy();
    const cor = (await tool("board_corridor").handler({ dir, from: [-16, 10], to: [-13, 7], layer: "top" } as never, ctx(root))).data as { found: boolean };
    expect(cor.found).toBe(true);
    for (const n of ["board_proposals", "board_proposal", "board_corridor"]) expect(tool(n).annotations.readOnlyHint, n).toBe(true);
    expect(tool("board_propose").annotations.readOnlyHint).toBe(false);
    for (const t of boardTools()) expect(t.name).not.toMatch(/accept|reject|pause|resume|hold/);
    for (const t of boardTools()) expect(t.description.length, t.name).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
  }, 60_000);

  it("board_apply's waitSeconds and board_route's propose reach the CLI as --wait and --propose", async () => {
    const { root, dir } = project();
    const seen: string[][] = [];
    const c = ctx(root);
    // the route is not run (only its arguments are looked at)
    const spy: ToolContext = { ...c, cli: (d, args) => (seen.push(args), args[1] === "route" ? Promise.resolve({ code: 0, stdout: "{}", stderr: "" }) : c.cli(d, args)) };
    await tool("board_apply").handler({ dir, ops: [move("fp:status/r2")], waitSeconds: 2 } as never, spy);
    expect(seen[0]).toContain("--wait=2");
    await tool("board_route").handler({ dir, nets: ["GND"], budget: 1, propose: true } as never, spy);
    expect(seen[1]).toContain("--propose=true");
  });
});
