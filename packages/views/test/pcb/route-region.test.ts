/**
 * The route tool's commit keeps its region precondition all the way through the host: the page envelope takes
 * `expectRegion`, the feed forwards it, and a route whose neighborhood changed after the draft started is refused
 * `stale-region` (never committed without the check).
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { connectBoard, padsOf, type Actor, type BoardDocument, type FootprintRec } from "@protoboardai/board/node";
import { createEditKernel } from "@protoboardai/board-edit";
import { BoardFeed } from "../../src/pcb/host/feed.js";
import { parseBoardRequest } from "../../src/pcb/requests.js";
import type { PageTransaction } from "../../src/pcb/types.js";

const FIXTURE = fileURLToPath(new URL("../../../board/test/fixtures/airnode-c3/", import.meta.url));
const PERSON: Actor = { kind: "human", id: "user" };
const dirs: string[] = [];
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const padAt = (doc: BoardDocument, fp: string, key: string) => {
  const p = padsOf(doc.records.get(fp) as FootprintRec).find((x) => x.key === key)!;
  return { x: p.x, y: p.y, id: p.id };
};

async function ownedFeed() {
  const root = mkdtempSync(join(tmpdir(), "pcb-route-region-"));
  dirs.push(root);
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "board");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  const feed = await BoardFeed.open({ dir, projectRoot: root, servicePollMs: 0, analyze: { crossCheck: false } });
  closers.push(() => feed.close());
  // the first write opens the board in the host as its owner
  const own = await feed.request({ method: "apply", tx: { batchId: "own", label: "nudge the LDO by hand", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 100_000, dy: 0, tracks: "stay" }] } }, PERSON);
  expect(own.ok && (own.result as { status: string }).status).toBe("applied");
  const client = await connectBoard(dir, { mode: "service", projectRoot: root });
  closers.unshift(() => client.close());
  return { feed, client };
}

/** A finished draft from R1 pad 2 to LED1 pad 1, as the page would send it. */
async function draft(client: Awaited<ReturnType<typeof ownedFeed>>["client"]): Promise<PageTransaction> {
  const snap = await client.snapshot();
  const from = padAt(snap.doc, "fp:status/r1", "2");
  const to = padAt(snap.doc, "fp:status/led1", "1");
  const s = createEditKernel(snap).startRoute({ from: { pad: from.id } });
  if ("error" in s) throw new Error(s.error);
  for (let k = 0; k <= 10; k++) s.move({ x: from.x + ((to.x - from.x) * k) / 10, y: from.y + 1_500_000 * (1 - k / 10) });
  expect(s.move({ x: to.x, y: to.y }).reached?.id).toBe(to.id);
  const f = s.finish();
  if ("error" in f) throw new Error(String(f.error));
  const tx = f.tx as unknown as PageTransaction;
  expect(tx.expectRegion).toBeDefined();
  return { batchId: `route-${Date.now()}`, label: "route by hand", ops: tx.ops, expectRegion: tx.expectRegion! };
}

describe("the route tool's region precondition through the host", () => {
  it("the page envelope takes expectRegion and refuses malformed ones", () => {
    const tx = (expectRegion: unknown) => ({ method: "apply", tx: { batchId: "b1", label: "route", ops: [{ op: "track.route" }], expectRegion } });
    expect(parseBoardRequest(tx({ box: { minX: -1, minY: -2, maxX: 3, maxY: 4 }, layers: ["top"], seq: 2 })).ok).toBe(true);
    expect(parseBoardRequest(tx({ box: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, seq: 0 })).ok).toBe(true);
    expect(parseBoardRequest(tx({ box: { minX: 0.5, minY: 0, maxX: 1, maxY: 1 }, seq: 0 })).ok).toBe(false);
    expect(parseBoardRequest(tx({ box: { minX: 2, minY: 0, maxX: 1, maxY: 1 }, seq: 0 })).ok).toBe(false);
    expect(parseBoardRequest(tx({ box: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, seq: -1 })).ok).toBe(false);
    expect(parseBoardRequest(tx({ box: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, seq: 0, actor: "x" })).ok).toBe(false);
    expect(parseBoardRequest(tx({ box: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, layers: Array(65).fill("top"), seq: 0 })).ok).toBe(false);
  });

  it("commits a route whose neighborhood did not change", async () => {
    const { feed, client } = await ownedFeed();
    const tx = await draft(client);
    const r = await feed.request({ method: "apply", tx }, PERSON);
    expect(r.ok && (r.result as { status: string }).status, JSON.stringify(r)).toBe("applied");
  });

  it("refuses a route whose neighborhood changed after the draft started (stale-region)", async () => {
    const { feed, client } = await ownedFeed();
    const tx = await draft(client);
    const box = tx.expectRegion!.box;
    const mid = { x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2) };
    // someone else's copper lands inside the draft's box on its layer
    const other = await client.apply({ batchId: "intruder", label: "a track in the way", ops: [{ op: "track.add", segments: [{ net: "GND", layer: tx.expectRegion!.layers?.[0] ?? "top", width: 150_000, start: { x: mid.x - 200_000, y: mid.y }, end: { x: mid.x + 200_000, y: mid.y } }] }] }, PERSON);
    expect(other.status).toBe("applied");
    const r = await feed.request({ method: "apply", tx }, PERSON);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const reply = (r as { result: { status: string; reason?: string } }).result;
    expect(reply.status).toBe("refused");
    expect(reply.reason).toBe("stale-region");
  });
});
