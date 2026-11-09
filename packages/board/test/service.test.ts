/**
 * The board service (contract section 10): one owner per board, save only what changed, refuse files changed by
 * someone else, journal and crash recovery, change events, snapshots and the query index.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "../src/fixtures/airnode-c3.js";
import { BoardIndex, BoardLockedError, boardKey, HUMAN, mm, openBoardService, type Actor, type BoardEvent, type FootprintRec } from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/airnode-c3/", import.meta.url));
const AGENT: Actor = { kind: "agent", id: "s9", name: "placer" };

/** A project folder with the fixture board in src/modules/main/board. */
function project() {
  const root = mkdtempSync(join(tmpdir(), "pb-board-svc-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "src", "modules", "main", "board");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  return { root, dir };
}
let n = 0;
const move = (id: string, dx: number) => ({ batchId: `svc${++n}`, label: "move a part sideways", ops: [{ op: "footprint.move", ids: [id], dx, dy: 0, tracks: "stay" }] });

describe("board service", () => {
  it("finds the project root and keeps its local state under .protoboard/local", () => {
    const { root, dir } = project();
    const svc = openBoardService({ dir });
    expect(boardKey(root, dir)).toBe("src__modules__main__board");
    expect(svc.localDir).toBe(join(root, ".protoboard", "local", "board", "src__modules__main__board"));
    svc.close();
  });

  it("is the single owner: a second open of the same board is refused until the first closes", () => {
    const { dir } = project();
    const a = openBoardService({ dir });
    expect(() => openBoardService({ dir })).toThrow(BoardLockedError);
    a.close();
    openBoardService({ dir }).close();
  });

  it("saves only changed files and refuses a file changed by someone else", () => {
    const { dir } = project();
    const svc = openBoardService({ dir });
    const events: BoardEvent[] = [];
    svc.subscribe((e) => events.push(e));
    expect(svc.apply(move("fp:power/ldo", mm(1)), HUMAN).status).toBe("applied");
    const s = svc.save();
    expect(s.written).toEqual(["placement"]);
    expect(s.refused).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(["commit", "saved"]);
    // someone edits copper.jsonl by hand (a git checkout, an editor)
    writeFileSync(join(dir, "copper.jsonl"), readFileSync(join(dir, "copper.jsonl"), "utf8").replace("trk:f.spare.1", "trk:f.spare.9"));
    svc.apply({ batchId: `svc${++n}`, label: "delete the spare segment", ops: [{ op: "track.delete", ids: ["trk:f.spare.1"] }] }, HUMAN);
    const r = svc.save();
    expect(r.refused).toEqual(["copper"]);
    expect(readFileSync(join(dir, "copper.jsonl"), "utf8")).toContain("trk:f.spare.9");
    expect(events.at(-1)).toEqual({ type: "external-change", files: ["copper"] });
    svc.close({ save: false });
  });

  it("journals every commit and recovers unsaved work after a crash", () => {
    const { dir } = project();
    const a = openBoardService({ dir, epoch: "crash1" });
    a.apply(move("fp:sensor/ic", mm(2)), HUMAN);
    a.apply({ batchId: `svc${++n}`, label: "agent adds a ground via", ops: [{ op: "via.add", vias: [{ handle: "v", net: "GND", x: 0, y: 0, outer_diameter: mm(0.6), hole_diameter: mm(0.3) }] }] }, AGENT);
    const moved = a.snapshot().doc;
    const lines = readFileSync(join(a.localDir!, "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.t)).toEqual(["open", "entry", "entry"]);
    expect(lines[2].ops[0].op).toBe("via.add");
    // the process dies: no save, no close (drop the lock as the dead process would have)
    a.close({ save: false });
    const b = openBoardService({ dir });
    expect(b.recoverable()).toBe(2);
    expect(b.recover()).toEqual({ replayed: 2, seq: 2 });
    expect((b.snapshot().doc.records.get("fp:sensor/ic") as FootprintRec).x).toBe((moved.records.get("fp:sensor/ic") as FootprintRec).x);
    expect(b.snapshot().doc.records.has("via:crash1.1")).toBe(true);
    b.close(); // saves
    const c = openBoardService({ dir });
    expect(c.recoverable()).toBe(0);
    expect(c.snapshot().doc.records.has("via:crash1.1")).toBe(true);
    c.close();
  });

  it("prepares a checkpoint message from change sets and never commits itself", () => {
    const { dir } = project();
    const svc = openBoardService({ dir });
    svc.apply({ ...move("fp:status/led1", mm(1)), changeSet: { id: "cs.leds", title: "tidy the status LEDs" } }, AGENT);
    svc.apply(move("fp:power/ldo", mm(1)), HUMAN);
    const cp = svc.checkpoint("Tidy the LEDs");
    expect(cp.written).toEqual(["placement"]);
    expect(cp.message).toContain("Tidy the LEDs");
    expect(cp.message).toContain("tidy the status LEDs (agent placer): 1 transaction(s)");
    expect(cp.message).toContain("other edits (person): 1 transaction(s)");
    svc.close();
  });

  it("serves snapshots and a query index that tracks commits", () => {
    const svc = openBoardService({ document: airnodeC3() });
    const s0 = svc.snapshot();
    expect(svc.snapshot()).toBe(s0);
    const gnd = svc.query.net("GND");
    expect(gnd.vias).toEqual(["via:f.gnd.1", "via:f.gnd.2", "via:f.gnd.3"]);
    expect(gnd.zones).toEqual(["zone:f.gnd_bottom"]);
    expect(gnd.pads).toContain("pad:usb/connector:S~4");
    const ldo = s0.doc.records.get("fp:power/ldo") as FootprintRec;
    const hereBefore = svc.query.at({ x: ldo.x, y: ldo.y }, { kinds: ["footprint"] }).map((i) => i.id);
    expect(hereBefore).toContain("fp:power/ldo");
    svc.apply(move("fp:power/ldo", mm(5)), HUMAN);
    expect(svc.query.at({ x: ldo.x, y: ldo.y }, { kinds: ["footprint"] }).map((i) => i.id)).not.toContain("fp:power/ldo");
    expect(svc.query.at({ x: ldo.x + mm(5), y: ldo.y }, { kinds: ["footprint"] }).map((i) => i.id)).toContain("fp:power/ldo");
    // the old snapshot still answers for its own seq
    expect(s0.query.at({ x: ldo.x, y: ldo.y }, { kinds: ["footprint"] }).map((i) => i.id)).toContain("fp:power/ldo");
    expect(s0.version("fp:power/ldo")).toBe(1);
    expect(svc.snapshot().version("fp:power/ldo")).toBe(2);
    // the incremental index answers like a fresh one
    const fresh = BoardIndex.build(svc.snapshot().doc);
    const all = { minX: mm(-25), minY: mm(-20), maxX: mm(25), maxY: mm(20) };
    expect(svc.query.region(all).map((i) => i.id)).toEqual(fresh.region(all).map((i) => i.id));
    expect(svc.query.region(all, { layers: ["bottom"], kinds: ["track"] }).map((i) => i.id)).toEqual(["trk:f.i2c_scl.1", "trk:f.spare.1"]);
    expect(() => svc.save()).toThrow(/in-memory/);
    svc.close();
  });

  it("tells subscribers about leases and commits with the actor and label", () => {
    const svc = openBoardService({ document: airnodeC3() });
    const events: BoardEvent[] = [];
    svc.subscribe((e) => events.push(e));
    svc.claim(AGENT, { roots: ["status"], purpose: "align the leds" });
    svc.apply(move("fp:status/led1", 1), HUMAN);
    expect(events.map((e) => e.type)).toEqual(["presence", "commit", "presence"]);
    const commit = events[1] as Extract<BoardEvent, { type: "commit" }>;
    expect(commit.entry).toMatchObject({ seq: 1, actor: HUMAN, label: "move a part sideways" });
    expect(commit.changed).toEqual(["fp:status/led1"]);
    svc.close();
  });
});
