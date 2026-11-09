/**
 * The interactive routing session (contract phase2-editing.md, section 7) on the Airnode C3 fixture: a scripted cursor
 * path routes a connection around other nets' pads with zero new findings, snapping and finishing on the target;
 * layer change places a legal via; backing up retracts; highlight mode lists collisions; a changed neighborhood
 * refuses the commit.
 */
import { describe, expect, it } from "vitest";
import { openBoardService, padsOf, type Actor, type BoardDocument, type FootprintRec } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { runBoardChecks } from "@protoboardai/board-checks";
import { createEditKernel, type RouteSession } from "../src/index.js";

const PERSON: Actor = { kind: "human", id: "user" };

const padAt = (doc: BoardDocument, fp: string, key: string) => {
  const p = padsOf(doc.records.get(fp) as FootprintRec).find((x) => x.key === key)!;
  return { x: p.x, y: p.y, id: p.id };
};
const errorsAndWarnings = (doc: BoardDocument) => new Set(runBoardChecks(doc).findings.filter((f) => f.check !== "unconnected").map((f) => f.id));

function session(doc: BoardDocument, opts: Parameters<ReturnType<typeof createEditKernel>["startRoute"]>[0], at: { epoch: string; seq: number } = { epoch: "test01", seq: 0 }) {
  const k = createEditKernel({ ...at, doc }, { budgetMs: 50 });
  const s = k.startRoute(opts);
  if ("error" in s) throw new Error(s.error);
  return { k, s: s as RouteSession };
}

describe("interactive routing", () => {
  it("routes R1.2 to D1.1 around the pads between them, snaps, finishes, and adds no findings", () => {
    const svc = openBoardService({ document: airnodeC3(), epoch: "rt0001" });
    const doc = svc.snapshot().doc;
    const from = padAt(doc, "fp:status/r1", "2");
    const to = padAt(doc, "fp:status/led1", "1");
    const { s } = session(doc, { from: { pad: from.id } }, svc.snapshot());
    // a person's hand: from R1 toward D1, past the LED1 and GND pads that sit on the straight line
    let c = s.move({ x: from.x - 500_000, y: from.y + 1_500_000 });
    expect(c.ok).toBe(true);
    for (let k = 1; k <= 10; k++) c = s.move({ x: from.x + ((to.x - from.x) * k) / 10, y: from.y + 1_500_000 * (1 - k / 10) });
    c = s.move({ x: to.x + 120_000, y: to.y - 80_000 });
    expect(c.ok).toBe(true);
    expect(c.snapped).toMatchObject({ kind: "pad", id: to.id });
    expect(c.reached).toEqual({ kind: "pad", id: to.id });
    expect(c.width).toMatchObject({ value: 250_000, rule: "rule:target.track_width", tier: "target" });
    expect(c.clearance).toMatchObject({ value: 200_000, rule: "rule:target.clearance", tier: "target" });
    expect(c.limiting?.rule).toBeDefined();
    // every segment is octilinear
    for (let i = 0; i + 1 < c.points.length; i++) {
      const a = c.points[i],
        b = c.points[i + 1];
      if (a.layer !== b.layer) continue;
      const dx = Math.abs(b.x - a.x),
        dy = Math.abs(b.y - a.y);
      expect(dx === 0 || dy === 0 || dx === dy, JSON.stringify([a, b])).toBe(true);
    }
    const before = errorsAndWarnings(doc);
    const unconnectedBefore = runBoardChecks(doc).summary.unconnected;
    const f = s.finish();
    if ("error" in f) throw new Error(f.error);
    expect(f.complete).toBe(true);
    expect(svc.snapshot().doc).toBe(doc); // the draft wrote nothing
    const r = svc.apply(f.tx, PERSON);
    expect(r.status, JSON.stringify(r)).toBe("applied");
    const after = svc.snapshot().doc;
    const added = [...errorsAndWarnings(after)].filter((id) => !before.has(id));
    expect(added, JSON.stringify(runBoardChecks(after).findings.filter((x) => added.includes(x.id)))).toEqual([]);
    expect(runBoardChecks(after).summary.unconnected).toBe(unconnectedBefore - 1);
  });

  it("highlight mode goes straight and names what it collides with", () => {
    const doc = airnodeC3();
    const from = padAt(doc, "fp:status/r1", "2");
    const to = padAt(doc, "fp:status/led1", "1");
    const { s } = session(doc, { from: { pad: from.id }, mode: "highlight" });
    const c = s.move({ x: to.x, y: to.y });
    expect(c.ok).toBe(false);
    const ids = c.collisions.map((x) => x.id);
    expect(ids).toContain(padAt(doc, "fp:status/led1", "2").id);
    expect(ids).toContain(padAt(doc, "fp:status/r1", "1").id);
  });

  it("places a via on a legal spot when the layer changes, continues there, and backs up", () => {
    const doc = airnodeC3();
    const from = padAt(doc, "fp:status/r2", "2");
    const { s } = session(doc, { from: { pad: from.id } });
    s.click({ x: from.x, y: from.y - 1_500_000 });
    const v = s.changeLayer("bottom");
    expect(v.ok, v.reason).toBe(true);
    const c = s.move({ x: from.x - 2_000_000, y: from.y - 3_500_000 });
    expect(c.layer).toBe("bottom");
    expect(c.ok).toBe(true);
    const viaAt = c.points.findIndex((p, i) => i > 0 && p.x === c.points[i - 1].x && p.y === c.points[i - 1].y && p.layer !== c.points[i - 1].layer);
    expect(viaAt).toBeGreaterThan(0);
    const back = s.back();
    expect(back?.layer).toBe("top");
    expect(s.state.points.every((p) => p.layer === "top")).toBe(true);
  });

  it("a commit is refused when the neighborhood changed after the session started", () => {
    const svc = openBoardService({ document: airnodeC3(), epoch: "rt0002" });
    const doc = svc.snapshot().doc;
    const from = padAt(doc, "fp:status/r2", "2");
    const { s } = session(doc, { from: { pad: from.id } });
    s.move({ x: from.x, y: from.y - 1_500_000 });
    const f0 = s.finish();
    void f0;
    const { s: s2 } = session(doc, { from: { pad: from.id } }, svc.snapshot());
    s2.move({ x: from.x, y: from.y - 1_500_000 });
    const f = s2.finish();
    if ("error" in f) throw new Error(f.error);
    expect(svc.apply({ batchId: "nudge", label: "nudge resistor R2 up", ops: [{ op: "footprint.move", ids: ["fp:status/r2"], dx: 0, dy: 100_000 }] }, PERSON).status).toBe("applied");
    expect(svc.apply(f.tx, PERSON)).toMatchObject({ status: "refused", reason: "stale-region" });
  });

  it("walk-around stops at an obstacle it cannot pass and never returns an illegal head", () => {
    const doc = airnodeC3();
    const from = padAt(doc, "fp:status/r1", "2");
    const { s } = session(doc, { from: { pad: from.id } });
    // the cursor inside the module's no-go antenna area
    const c = s.move({ x: 10_000_000, y: 12_000_000 });
    expect(c.ok).toBe(true);
    const end = c.points[c.points.length - 1];
    // never inside the no-go area (x 3.4 to 16.6 mm, y 9.8 to 15 mm)
    const inside = end.x > 3_400_000 && end.x < 16_600_000 && end.y > 9_800_000 && end.y < 15_000_000;
    expect(inside, JSON.stringify(end)).toBe(false);
    for (const p of c.points) expect(p.x > 3_400_000 && p.x < 16_600_000 && p.y > 9_800_000 && p.y < 15_000_000).toBe(false);
  });
});
