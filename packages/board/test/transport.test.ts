/**
 * The wire transport (contract section 10): a real server and real WebSocket clients in this process. Two clients
 * where one write makes the other's stale write refused, a lease revoked by a person's edit, service.json written
 * and removed, connectBoard finding the live service or opening the board itself, and the connection checks
 * (token, origin, Host, message size, actors).
 */
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentActor,
  BOARD_PROTOCOL,
  BoardRpcError,
  connectBoard,
  findService,
  HUMAN,
  isLoopback,
  listOperations,
  mm,
  openBoardService,
  RPC_ERRORS,
  serveBoard,
  serviceFileFor,
  toJsonSchema,
  wireClient,
  type BoardClient,
  type BoardEvent,
  type BoardServer,
  type BoardService,
  type FootprintRec,
  type Reply,
} from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/airnode-c3/", import.meta.url));
const AGENT = agentActor("placer");

function project() {
  const root = mkdtempSync(join(tmpdir(), "pb-board-wire-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "board");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  return { root, dir };
}

let n = 0;
const move = (id: string, dx: number, extra: Record<string, unknown> = {}) => ({ batchId: `w${++n}`, label: "move a part sideways", ops: [{ op: "footprint.move", ids: [id], dx, dy: 0, tracks: "stay" }], ...extra });

const open: { svc?: BoardService; server?: BoardServer; clients: BoardClient[] } = { clients: [] };
afterEach(async () => {
  for (const c of open.clients.splice(0)) await c.close().catch(() => {});
  await open.server?.close();
  open.svc?.close({ save: false });
  open.server = undefined;
  open.svc = undefined;
});

async function serve(opts: Parameters<typeof serveBoard>[1] = {}) {
  const p = project();
  const svc = openBoardService({ dir: p.dir });
  const server = await serveBoard(svc, opts);
  open.svc = svc;
  open.server = server;
  return { ...p, svc, server };
}
async function client(server: BoardServer) {
  const c = await wireClient(server.url, server.token);
  open.clients.push(c);
  return c;
}
/** Wait for a condition a notification makes true. */
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A raw upgrade request, to see the status a refused handshake gets. */
function rawUpgrade(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path: "/", headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": randomBytes(16).toString("base64"), ...headers } });
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      done(101);
    });
    req.on("response", (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on("error", fail);
    req.end();
  });
}

describe("board service over the wire", () => {
  it("writes service.json with pid, port, token and epoch, and removes it on close", async () => {
    const { dir, svc, server } = await serve();
    const file = serviceFileFor(dir);
    expect(server.serviceFile).toBe(file);
    const s = JSON.parse(readFileSync(file, "utf8"));
    expect(s).toMatchObject({ pid: process.pid, port: server.port, token: server.token, epoch: svc.epoch, host: "127.0.0.1", protocol: BOARD_PROTOCOL });
    expect(findService(dir)?.port).toBe(server.port);
    await server.close();
    expect(existsSync(file)).toBe(false);
  });

  it("mirrors the service: snapshot, query, apply, undo, redo, presence, save, operations", async () => {
    const { svc, server } = await serve();
    const c = await client(server);
    const snap = await c.snapshot();
    expect(snap.epoch).toBe(svc.epoch);
    expect(snap.seq).toBe(0);
    expect([...snap.doc.records.keys()].sort()).toEqual([...svc.snapshot().doc.records.keys()].sort());
    expect(snap.doc.nets.size).toBe(svc.snapshot().doc.nets.size);
    expect(snap.version("fp:power/ldo")).toBe(1);

    const r = await c.apply(move("fp:power/ldo", mm(1)), HUMAN);
    expect(r.status).toBe("applied");
    expect(svc.seq).toBe(1);
    const q = await c.query({ by: "id", ids: ["fp:power/ldo", "rule:floor.clearance", "fp:nope"], records: true });
    expect(q.seq).toBe(1);
    expect(q.missing).toEqual(["fp:nope"]);
    const ldo = q.records!.find((x) => x.id === "fp:power/ldo") as FootprintRec;
    expect(ldo.x).toBe((svc.snapshot().doc.records.get("fp:power/ldo") as FootprintRec).x);
    expect(q.versions!["fp:power/ldo"]).toBe(2);
    expect(q.records!.map((x) => x.id)).toContain("rule:floor.clearance");

    const net = await c.query({ by: "net", name: "+3V3" });
    expect(net.items.length).toBeGreaterThan(2);
    const region = await c.query({ by: "region", box: { minX: mm(-1), minY: mm(-1), maxX: mm(1), maxY: mm(1) } });
    expect(Array.isArray(region.items)).toBe(true);

    expect((await c.undo(HUMAN)).status).toBe("applied");
    expect((await c.redo(HUMAN)).status).toBe("applied");
    expect((await c.presence()).seq).toBe(3);
    const saved = await c.save();
    expect(saved.written).toEqual(["placement"]);
    expect((await c.log()).length).toBe(3);

    const ops = await c.operations();
    const all = listOperations().filter((d) => d.audience === "all");
    expect(ops.operations.map((o) => o.name)).toEqual(all.map((d) => d.name));
    for (const o of ops.operations) expect(o.input).toEqual(toJsonSchema(listOperations().find((d) => d.name === o.name)!.input));
    expect((await c.operations({ all: true })).operations.some((o) => o.audience === "system")).toBe(true);
  });

  it("two clients: one write makes the other's stale write refused, and the other hears of it", async () => {
    const { server } = await serve();
    const a = await client(server);
    const b = await client(server);
    const heard: BoardEvent[] = [];
    b.subscribe((e) => heard.push(e));
    const seen = (await b.snapshot()).seq;
    const ver = (await b.snapshot()).version("fp:power/ldo");

    expect((await a.apply(move("fp:power/ldo", mm(1), { expectSeq: seen }), HUMAN)).status).toBe("applied");
    await until(() => heard.some((e) => e.type === "commit"));
    const commit = heard.find((e) => e.type === "commit")!;
    expect(commit.type === "commit" && commit.changed).toEqual(["fp:power/ldo"]);

    // b read the whole board at seq 0: refused, with what it missed
    const stale = await b.apply(move("fp:power/ldo", mm(2), { expectSeq: seen }), AGENT);
    expect(stale.status).toBe("refused");
    if (stale.status === "refused") {
      expect(stale.reason).toBe("stale-seq");
      expect(stale.missed?.map((m) => m.seq)).toEqual([1]);
    }
    // b read only the ldo, at its old version: refused by version
    const staleVer = await b.apply(move("fp:power/ldo", mm(2), { expectVersions: { "fp:power/ldo": ver } }), AGENT);
    expect(staleVer.status === "refused" && staleVer.reason).toBe("stale-versions");
    // after re-reading, b's write goes through
    const fresh = await b.snapshot();
    expect((await b.apply(move("fp:power/ldo", mm(2), { expectVersions: { "fp:power/ldo": fresh.version("fp:power/ldo") } }), AGENT)).status).toBe("applied");
  });

  it("a person's edit revokes an agent's lease; the agent hears it and its token stops working", async () => {
    const { server } = await serve();
    const agent = await client(server);
    const person = await client(server);
    const heard: BoardEvent[] = [];
    agent.subscribe((e) => heard.push(e));
    const claim = await agent.claim(AGENT, { roots: ["power"], purpose: "tidy the power section" });
    expect(claim.status).toBe("granted");
    if (claim.status !== "granted") return;
    expect((await agent.apply(move("fp:power/ldo", mm(1), { leaseToken: claim.lease.token }), AGENT)).status).toBe("applied");

    expect((await person.apply(move("fp:power/ldo", mm(-1)), HUMAN)).status).toBe("applied");
    await until(() => heard.some((e) => e.type === "presence" && e.presence.leases.length === 0));
    expect((await agent.presence()).leases).toEqual([]);

    const after: Reply = await agent.apply(move("fp:power/ldo", mm(1), { leaseToken: claim.lease.token }), AGENT);
    expect(after.status === "refused" && after.reason).toBe("lease-revoked");
    expect((await agent.release(AGENT)).length).toBe(0);
  });

  it("answers JSON-RPC errors: unknown method, bad params, the system actor, a thrown call", async () => {
    const { server } = await serve();
    const c = await client(server);
    await expect(c.call("board.nope" as never, {})).rejects.toMatchObject({ code: RPC_ERRORS.methodNotFound });
    await expect(c.call("board.query", { by: "everywhere" })).rejects.toMatchObject({ code: RPC_ERRORS.invalidParams });
    await expect(c.apply(move("fp:power/ldo", 1), { kind: "system", id: "board" })).rejects.toBeInstanceOf(BoardRpcError);
    await expect(c.apply(move("fp:power/ldo", 1), { kind: "agent", id: "sneaky" })).rejects.toMatchObject({ code: RPC_ERRORS.invalidParams });
    // a reply the engine gives (not an error): invalid with the op index
    const r = await c.apply({ batchId: "bad1", label: "move a missing part", ops: [{ op: "footprint.move", ids: ["fp:nope"], dx: 1, dy: 0, tracks: "stay" }] }, HUMAN);
    expect(r.status === "invalid" && r.index).toBe(0);
  });

  it("applies the actor policy it is given", async () => {
    const { server } = await serve({ actors: (a) => (a.kind === "human" ? "this server takes no person's edits" : undefined) });
    const c = await client(server);
    await expect(c.apply(move("fp:power/ldo", 1), HUMAN)).rejects.toMatchObject({ code: RPC_ERRORS.actor, message: "this server takes no person's edits" });
    expect((await c.apply(move("fp:power/ldo", 1), AGENT)).status).toBe("applied");
  });

  it("refuses a wrong token, a browser origin it was not given, a foreign Host, and plain HTTP", async () => {
    const { server } = await serve({ origins: ["http://127.0.0.1:5180"] });
    const auth = { authorization: `Bearer ${server.token}` };
    const host = `127.0.0.1:${server.port}`;
    expect(await rawUpgrade(server.port, { ...auth, host })).toBe(101);
    expect(await rawUpgrade(server.port, { authorization: "Bearer wrong-token-0000000000", host })).toBe(401);
    expect(await rawUpgrade(server.port, { host })).toBe(401);
    expect(await rawUpgrade(server.port, { ...auth, host, origin: "https://evil.example" })).toBe(403);
    expect(await rawUpgrade(server.port, { ...auth, host, origin: "http://127.0.0.1:5180" })).toBe(101);
    expect(await rawUpgrade(server.port, { ...auth, host: `evil.example:${server.port}` })).toBe(403);
    // a browser offers the token as a subprotocol
    expect(await rawUpgrade(server.port, { host, "sec-websocket-protocol": `${BOARD_PROTOCOL}, protoboard.token.${server.token}` })).toBe(101);
    expect(await rawUpgrade(server.port, { ...auth, host, "sec-websocket-protocol": "chat" })).toBe(400);
    await expect(wireClient(server.url, "0123456789abcdef0123")).rejects.toThrow(/refused|gone/);
    const plain = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(plain.status).toBe(426);
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("192.168.1.5")).toBe(false);
    expect(isLoopback("::ffff:10.0.0.2")).toBe(false);
  });

  it("closes a connection whose message is over the size limit", async () => {
    const { server } = await serve({ maxMessageBytes: 2048 });
    const c = await client(server);
    expect((await c.presence()).seq).toBe(0);
    await expect(c.call("board.checkpoint", { label: "x".repeat(4000) })).rejects.toThrow(/closed/);
  });
});

describe("connectBoard", () => {
  it("talks to the live service when service.json names one, else opens the board itself", async () => {
    const { dir, svc, server } = await serve();
    const c = await connectBoard(dir);
    open.clients.push(c);
    expect(c.mode).toBe("service");
    expect((await c.apply(move("fp:power/ldo", mm(1)), AGENT)).status).toBe("applied");
    expect(svc.seq).toBe(1);
    await c.close();
    await server.close();
    svc.close();
    open.svc = undefined;
    open.server = undefined;

    // no service: the board is opened for the one call, saved after the change, and released
    const local = await connectBoard(dir);
    expect(local.mode).toBe("local");
    const before = readFileSync(join(dir, "placement.jsonl"), "utf8");
    expect((await local.apply(move("fp:power/ldo", mm(1)), AGENT)).status).toBe("applied");
    await local.close();
    expect(readFileSync(join(dir, "placement.jsonl"), "utf8")).not.toBe(before);
    // and the lock is free again
    openBoardService({ dir }).close();
  });

  it("ignores a stale service.json whose process is gone, and refuses mode service with no live service", async () => {
    const { dir } = project();
    const file = serviceFileFor(dir);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 12345, port: 1, token: "x".repeat(32), epoch: "zzzzzz" }));
    expect(findService(dir)).toBeUndefined();
    const c = await connectBoard(dir);
    expect(c.mode).toBe("local");
    // a read-only client leaves the files as they were
    await c.snapshot();
    await c.close();
    await expect(connectBoard(dir, { mode: "service" })).rejects.toThrow(/no board service is running/);
  });

  it("waits for a service that holds the board but has not written service.json yet", async () => {
    const { dir } = project();
    const svc = openBoardService({ dir });
    open.svc = svc;
    const pending = connectBoard(dir);
    await new Promise((r) => setTimeout(r, 300));
    open.server = await serveBoard(svc);
    const c = await pending;
    open.clients.push(c);
    expect(c.mode).toBe("service");
  });
});
