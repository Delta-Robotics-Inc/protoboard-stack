/**
 * The schematic service on the wire (contract section 10, after the board core's): serve and connect through
 * service.json, an agent's transaction and its event notification, the actor policy, journal recovery of a commit
 * that was never saved, and leases that keep another agent out.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { airnodeCircuit, airnodeSchematic } from "../src/fixtures/airnode-c3.ts";
import { agentActor, connectSchematic, findSchematicService, HUMAN, localClient, openSchematicService, RPC_ERRORS, serveSchematic, SchematicRpcError, writeSchematicDir, type SchematicCircuit, type SchematicDocument, type SchematicEvent } from "../src/node.ts";

let circuit: SchematicCircuit;
let laid: SchematicDocument;
beforeAll(async () => {
  circuit = await airnodeCircuit();
  laid = await airnodeSchematic();
});

/** A project with the Airnode C3 schematic saved in `<root>/airnode/schematic`. */
function project() {
  const root = mkdtempSync(join(tmpdir(), "pb-schematic-transport-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "airnode", "schematic");
  mkdirSync(dir, { recursive: true });
  writeSchematicDir(dir, laid);
  return { root, dir };
}

const PLACER = agentActor("placer");
const OTHER = agentActor("other");
const move = (batchId: string, id: string, dx = 1) => ({ batchId, label: "move a part right", ops: [{ op: "item.move", ids: [id], dx, dy: 0 }] });

describe("serve and connect", () => {
  it("finds the service through service.json, applies as an agent and notifies every client", async () => {
    const { dir } = project();
    const svc = openSchematicService({ dir, circuit });
    const server = await serveSchematic(svc);
    try {
      expect(server.serviceFile && existsSync(server.serviceFile)).toBe(true);
      expect(findSchematicService(dir)?.port).toBe(server.port);
      // no circuit given: only a live service can answer
      const client = await connectSchematic(dir);
      expect(client.mode).toBe("service");
      const events: SchematicEvent[] = [];
      const got = new Promise<void>((done) => client.subscribe((e) => (events.push(e), e.type === "commit" && done())));
      const before = await client.snapshot();
      expect(before.doc.records.size).toBe(laid.records.size);
      expect(before.version("sym:sensor/r_scl")).toBe(1);
      const r = await client.apply(move("t1", "sym:sensor/r_scl"), PLACER);
      expect(r.status).toBe("applied");
      await got;
      const commit = events.find((e) => e.type === "commit")!;
      expect(commit).toMatchObject({ type: "commit", seq: 1, entry: { seq: 1, actor: { kind: "agent", id: "agent:placer" }, label: "move a part right", batchId: "t1" }, changed: ["sym:sensor/r_scl"] });
      const q = await client.query({ by: "id", ids: ["sym:sensor/r_scl", "sym:nope"] });
      expect(q.records[0]).toMatchObject({ id: "sym:sensor/r_scl", provenance: { edited: "agent" } });
      expect(q.items[0].box?.length).toBe(4);
      expect(q.missing).toEqual(["sym:nope"]);
      expect((await client.query({ by: "net", name: "I2C_SCL" })).items.some((i) => i.kind === "wire" || i.kind === "label")).toBe(true);
      expect((await client.query({ by: "card", id: "card:sensor" })).items.length).toBeGreaterThan(3);
      const ops = await client.operations();
      expect(ops.operations.map((o) => o.name)).toContain("item.move");
      expect(ops.operations.some((o) => o.audience === "system")).toBe(false);
      expect((await client.undo(PLACER)).status).toBe("applied");
      expect((await client.score()).score).toBeGreaterThan(0);
      const scene = await client.scene({ image: "svg" });
      expect(scene.json.schema).toBe("protoboard.schematic-scene/v1");
      expect(scene.svg).toMatch(/^<svg/);
      const list = await client.listDefects({ limit: 3 });
      if (list.defects.length) expect(await client.explainDefect(list.defects[0].id)).toMatch(/^Defect /);
      await client.close();
    } finally {
      await server.close();
      svc.close({ save: false });
    }
    expect(findSchematicService(dir)).toBeUndefined();
  });

  it("refuses a person on a connection whose policy admits agents only", async () => {
    const { dir } = project();
    const svc = openSchematicService({ dir, circuit });
    const server = await serveSchematic(svc, { actors: (a) => (a.kind === "human" ? "this connection is for agents" : undefined) });
    const client = await connectSchematic(dir, { mode: "service" });
    try {
      const err = await client.apply(move("h1", "sym:sensor/ic"), HUMAN).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(SchematicRpcError);
      expect((err as SchematicRpcError).code).toBe(RPC_ERRORS.actor);
      expect(svc.seq).toBe(0);
      expect((await client.apply(move("a1", "sym:sensor/ic"), PLACER)).status).toBe("applied");
    } finally {
      await client.close();
      await server.close();
      svc.close({ save: false });
    }
  });
});

describe("journal recovery", () => {
  it("replays a commit that was never saved, and nothing once the files hold it", () => {
    const { dir } = project();
    const a = openSchematicService({ dir, circuit });
    expect(a.recoverable()).toBe(0);
    expect(a.apply(move("j1", "sym:power/ldo", 2), HUMAN).status).toBe("applied");
    const moved = a.snapshot().doc.records.get("sym:power/ldo");
    a.close({ save: false });
    const b = openSchematicService({ dir, circuit });
    expect(b.recoverable()).toBe(1);
    expect(b.snapshot().doc.records.get("sym:power/ldo")).toEqual(laid.records.get("sym:power/ldo"));
    expect(b.recover()).toEqual({ replayed: 1, seq: 1 });
    expect(b.snapshot().doc.records.get("sym:power/ldo")).toEqual(moved);
    const saved = b.save();
    expect(saved.written).toContain("symbols");
    b.close({ save: false });
    const c = openSchematicService({ dir, circuit });
    expect(c.recoverable()).toBe(0);
    expect(c.snapshot().doc.records.get("sym:power/ldo")).toEqual(moved);
    c.close({ save: false });
  });

  it("checkpoints with a commit message from the change sets", () => {
    const { dir } = project();
    const svc = openSchematicService({ dir, circuit });
    svc.apply({ ...move("c1", "sym:sensor/r_sda"), changeSet: { id: "tidy", title: "tidy the sensor card" } }, PLACER);
    const r = svc.checkpoint("tidy the sensor");
    expect(r.refused).toEqual([]);
    expect(r.message).toMatch(/^tidy the sensor\n\n- tidy the sensor card \(agent placer\): 1 transaction/);
    svc.close({ save: false });
  });
});

describe("leases", () => {
  it("keep another agent out, take the holder's token, and end when a person edits inside", async () => {
    const { dir } = project();
    const svc = openSchematicService({ dir, circuit });
    const client = localClient(svc, { closeService: false });
    try {
      const claim = await client.claim(PLACER, { roots: ["sensor"], purpose: "tidy the sensor card" });
      expect(claim.status).toBe("granted");
      const token = claim.status === "granted" ? claim.lease.token : -1;
      // another agent: refused on a symbol, a wire of the card and the card itself
      expect(await client.apply(move("o1", "sym:sensor/r_scl"), OTHER)).toMatchObject({ status: "refused", reason: "leased" });
      expect(await client.apply(move("o2", "card:sensor"), OTHER)).toMatchObject({ status: "refused", reason: "leased" });
      expect((await client.claim(OTHER, { roots: ["sensor/ic"], purpose: "move the sensor" })).status).toBe("refused");
      // outside the lease the other agent works on
      expect((await client.apply(move("o3", "sym:status/led1"), OTHER)).status).toBe("applied");
      // the holder writes with its token; without it, it is told to quote it
      expect(await client.apply(move("p0", "sym:sensor/r_sda"), PLACER)).toMatchObject({ status: "refused", reason: "lease-revoked" });
      expect((await client.apply({ ...move("p1", "sym:sensor/r_sda"), leaseToken: token }, PLACER)).status).toBe("applied");
      expect((await client.presence()).leases.map((l) => l.holder.id)).toEqual(["agent:placer"]);
      // a person's edit inside the lease revokes it
      expect((await client.apply(move("h1", "sym:sensor/ic"), HUMAN)).status).toBe("applied");
      expect((await client.presence()).leases).toEqual([]);
      expect(await client.apply({ ...move("p2", "sym:sensor/r_sda"), leaseToken: token }, PLACER)).toMatchObject({ status: "refused", reason: "lease-revoked" });
    } finally {
      await client.close();
      svc.close({ save: false });
    }
  });

  it("reverts a change set as a whole", () => {
    const { dir } = project();
    const svc = openSchematicService({ dir, circuit });
    const cs = { id: "cs1", title: "two moves" };
    svc.apply({ ...move("r1", "sym:sensor/r_sda"), changeSet: cs }, PLACER);
    svc.apply({ ...move("r2", "sym:sensor/r_scl"), changeSet: cs }, PLACER);
    expect(svc.changeSets()).toEqual([{ id: "cs1", title: "two moves", actors: [PLACER], entries: [1, 2] }]);
    expect(svc.revertChangeSet(PLACER, "cs1").status).toBe("applied");
    for (const id of ["sym:sensor/r_sda", "sym:sensor/r_scl"]) expect(svc.snapshot().doc.records.get(id)).toEqual(laid.records.get(id));
    svc.close({ save: false });
  });
});
