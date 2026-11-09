/**
 * The host's side of a page's requests (Node): a board feed over a board folder with no service opens the board as
 * its owner on the first write and serves it (the CLI and agents become its clients), applies writes as the actor
 * the host gives, replays an earlier seq, records a waiver the checks then leave out, and saves on close.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { findService, loadBoardDir, type Actor } from "@protoboardai/board/node";
import { BoardFeed } from "../../src/pcb/host/feed.js";
import type { BoardFeedMessage } from "../../src/pcb/types.js";

const FIXTURE = fileURLToPath(new URL("../../../board/test/fixtures/airnode-c3/", import.meta.url));
const PERSON: Actor = { kind: "human", id: "user" };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "pcb-host-req-"));
  dirs.push(root);
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "board");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  return { root, dir };
}

const until = async (f: () => boolean, ms = 15_000) => {
  const t = Date.now();
  while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 25));
  return f();
};

describe("a page's requests through the host's board feed", () => {
  it("opens a board with no service on the first write, as the host's actor, and saves on close", async () => {
    const { root, dir } = project();
    const before = readFileSync(join(dir, "placement.jsonl"), "utf8");
    const feed = await BoardFeed.open({ dir, projectRoot: root, servicePollMs: 0, analyze: { crossCheck: false } });
    const msgs: BoardFeedMessage[] = [];
    feed.subscribe((m) => msgs.push(m));
    expect(feed.current.owned).toBe(false);
    const r = await feed.request({ method: "apply", tx: { batchId: "t1", label: "move the LDO by hand", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1_000_000, dy: 0, tracks: "stay" }] } }, PERSON);
    expect(r.ok && (r.result as { status: string }).status).toBe("applied");
    expect(feed.current.owned).toBe(true);
    // served: a CLI call or an agent finds it through service.json
    expect(findService(dir, root)).toBeTruthy();
    expect(await until(() => msgs.some((m) => m.type === "commit"))).toBe(true);
    // the files are written only on save or close
    expect(readFileSync(join(dir, "placement.jsonl"), "utf8")).toBe(before);
    const at0 = await feed.request({ method: "at", seq: 0 }, PERSON);
    expect(at0.ok).toBe(true);
    const ldo0 = (at0 as { result: { snapshot: { records: { id: string; x?: number }[] } } }).result.snapshot.records.find((x) => x.id === "fp:power/ldo")!;
    expect(ldo0.x).toBe((loadBoardDir(dir).doc.records.get("fp:power/ldo") as { x: number }).x);
    const u = await feed.request({ method: "undo" }, PERSON);
    expect(u.ok && (u.result as { status: string }).status).toBe("applied");
    const redo = await feed.request({ method: "redo" }, PERSON);
    expect(redo.ok && (redo.result as { status: string }).status).toBe("applied");
    await feed.close();
    expect(readFileSync(join(dir, "placement.jsonl"), "utf8")).not.toBe(before);
    expect(findService(dir, root)).toBeUndefined();
  });

  it("records a waiver the checks then leave out and list", async () => {
    const { root, dir } = project();
    const feed = await BoardFeed.open({ dir, projectRoot: root, servicePollMs: 0, analyze: { crossCheck: false } });
    try {
      const d = await feed.derivedNow();
      expect(d.checks.ran).toBe(true);
      const f = d.findings.find((x) => x.check !== "unconnected") ?? d.findings[0];
      const r = await feed.request({ method: "waive", finding: f.id, reason: "accepted on this board" }, PERSON);
      expect(r.ok && (r.result as { status: string }).status).toBe("applied");
      await until(() => (feed.current.derived?.waived?.length ?? 0) > 0);
      const after = feed.current.derived!;
      expect(after.waived?.map((w) => w.finding.id)).toContain(f.id);
      expect(after.findings.map((x) => x.id)).not.toContain(f.id);
      expect(existsSync(join(dir, "rules.jsonl"))).toBe(true);
      const back = await feed.request({ method: "unwaive", finding: f.id }, PERSON);
      expect(back.ok).toBe(true);
    } finally {
      await feed.close();
    }
  });

  it("a write the host does not allow says why", async () => {
    const { root, dir } = project();
    const feed = await BoardFeed.open({ dir, projectRoot: root, servicePollMs: 0, ownOnWrite: false, analyze: { crossCheck: false } });
    try {
      const r = await feed.request({ method: "undo" }, PERSON);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(/no board service is running/);
    } finally {
      await feed.close();
    }
  });
});
