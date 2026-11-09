/**
 * Waivers in the checks (Phase 2, P2-E): a waived finding leaves `findings` and the counts and is listed in
 * `waived`; the summary line says how many; the incremental checks and the contract `Check` objects agree; the KiCad
 * comparison lists waived findings and the KiCad items matched to them apart from the like-with-like counts.
 */
import { describe, expect, it } from "vitest";
import { createEngine, HUMAN, mm, runChecks, withChanges, type BoardDocument, type WaiverRec } from "@protoboardai/board";
import { compareWithKicad, createBoardChecks, createIncrementalChecks, formatCrossCheck, runBoardChecks, type KicadDrcReport } from "../src/index.js";
import { boardRecords, fp, makeDoc, rule, smd, trk } from "./helpers.js";

/** A board where trk:x shorts N1 to N2's pad and N2 has one missing link (as kicad.test.ts). */
const board = () =>
  makeDoc([...boardRecords(), fp("A", 0, 0, [smd("1", -2, 0, 0.8, 0.8), smd("2", 2, 0, 0.8, 0.8)]), fp("B", 0, 5, [smd("1", -2, 0, 0.8, 0.8), smd("2", 2, 0, 0.8, 0.8)]), trk("x", "N1", "top", 0.25, [-2, 0], [2, 0]), trk("y", "N1", "top", 0.25, [-2, 0], [-2, 5]), rule("c", "floor", "clearance", 0.1)], { N1: ["A.1", "B.1"], N2: ["A.2", "B.2"] });

let k = 0;
const waiver = (w: Partial<WaiverRec>): WaiverRec => ({ kind: "waiver", id: `waiver:t.${++k}`, objects: [], reason: "checked by a person", by: { kind: "human", id: "user" }, provenance: { by: "hand" }, ...w });
const withWaivers = (doc: BoardDocument, ws: WaiverRec[]) => withChanges(doc, ws, []);

describe("waivers in runBoardChecks", () => {
  const plain = runBoardChecks(board());
  const short = plain.findings.find((f) => f.check === "short")!;
  const open = plain.findings.find((f) => f.check === "unconnected")!;

  it("the board has a short and an open connection to waive", () => {
    expect(short).toBeDefined();
    expect(open).toBeDefined();
    expect(plain.waived).toEqual([]);
    expect(plain.summary.waived).toBe(0);
    expect(plain.summary.line).not.toMatch(/waived/);
  });

  it("by finding id: out of the findings and the counts, listed with its waiver, and the line says so", () => {
    const w = waiver({ finding: short.id });
    const r = runBoardChecks(withWaivers(board(), [w]));
    expect(r.findings.map((f) => f.id)).not.toContain(short.id);
    expect(r.waived).toEqual([{ finding: short, waiver: w.id }]);
    expect(r.summary.errors).toBe(plain.summary.errors - 1);
    expect(r.summary.byCheck.short).toBeUndefined();
    expect(r.summary.waived).toBe(1);
    expect(r.summary.line).toBe(`${plain.summary.unconnected} unconnected, ${plain.summary.errors - 1} error${plain.summary.errors - 1 === 1 ? "" : "s"}, ${plain.summary.warnings} warning${plain.summary.warnings === 1 ? "" : "s"}, 1 waived${plain.summary.incomplete ? " (incomplete: see caveats)" : ""}`);
  });

  it("an unconnected item waived leaves the unconnected count, with no caveat about it", () => {
    const r = runBoardChecks(withWaivers(board(), [waiver({ finding: open.id })]));
    expect(r.summary.unconnected).toBe(plain.summary.unconnected - 1);
    expect(r.summary.caveats).toEqual(plain.summary.caveats);
    expect(r.connectivity.unconnected).toBe(plain.connectivity.unconnected);
  });

  it("by rule and exactly these objects, by rule alone; other objects or another rule do not match", () => {
    const byObjects = runBoardChecks(withWaivers(board(), [waiver({ rule: "short", objects: [...short.objects].reverse() })]));
    expect(byObjects.waived.map((x) => x.finding.id)).toEqual([short.id]);
    const ruleAlone = runBoardChecks(withWaivers(board(), [waiver({ rule: "unconnected" })]));
    expect(ruleAlone.waived.map((x) => x.finding.check)).toEqual(plain.findings.filter((f) => f.check === "unconnected").map(() => "unconnected"));
    const other = runBoardChecks(withWaivers(board(), [waiver({ rule: "short", objects: [short.objects[0]] }), waiver({ rule: "clearance", objects: [...short.objects] })]));
    expect(other.waived).toEqual([]);
    expect(other.findings.map((f) => f.id)).toEqual(plain.findings.map((f) => f.id));
    // a finding id and a rule together must both match
    expect(runBoardChecks(withWaivers(board(), [waiver({ finding: short.id, rule: "clearance" })])).waived).toEqual([]);
  });

  it("the contract Check objects leave waived findings out too", () => {
    const doc = withWaivers(board(), [waiver({ finding: short.id })]);
    const snap = { epoch: "w", seq: 0, doc, version: () => 1, query: undefined as never };
    const ids = runChecks(snap, createBoardChecks()).map((f) => f.id);
    expect(ids).not.toContain(short.id);
    expect(ids.sort()).toEqual(runBoardChecks(doc).findings.map((f) => f.id).sort());
  });
});

describe("waivers in the incremental checks", () => {
  it("a waiver change runs in full; local edits with waivers present stay incremental and equal a full run", () => {
    const engine = createEngine(board(), { epoch: "wvinc1" });
    const inc = createIncrementalChecks(engine.doc);
    const short = inc.result.findings.find((f) => f.check === "short")!;
    const add = engine.apply({ batchId: "w1", label: "waive the test short", ops: [{ op: "waiver.add", waiver: { rule: "short", objects: [...short.objects], reason: "a test short" }, handle: "w" }] }, HUMAN);
    expect(add.status).toBe("applied");
    if (add.status !== "applied") return;
    const u1 = inc.update(engine.doc, add.changed);
    expect(u1.mode).toBe("full");
    expect(u1.removed).toEqual([short.id]);
    expect(u1.added).toEqual([]);
    expect(u1.result.waived.map((w) => w.finding.id)).toEqual([short.id]);
    expect(u1.result.findings).toEqual(runBoardChecks(engine.doc).findings);
    // a local edit: the waived short stays waived and out of the diff
    const mv = engine.apply({ batchId: "m1", label: "nudge the spare track", ops: [{ op: "track.move", ids: ["trk:y"], dx: mm(0.05), dy: 0 }] }, HUMAN);
    expect(mv.status).toBe("applied");
    if (mv.status !== "applied") return;
    const u2 = inc.update(engine.doc, mv.changed);
    expect(u2.mode).toBe("incremental");
    const full = runBoardChecks(engine.doc);
    expect(u2.result.findings).toEqual(full.findings);
    expect(u2.result.waived).toEqual(full.waived);
    expect({ ...u2.result.summary, timing: undefined }).toEqual({ ...full.summary, timing: undefined });
    for (const f of u2.added) expect(u2.result.findings).toContain(f);
    expect(u2.removed.filter((id) => full.waived.some((w) => w.finding.id === id))).toEqual([]);
    // removing the waiver brings the short back
    const rm = engine.apply({ batchId: "w2", label: "remove the test short waiver", ops: [{ op: "waiver.remove", ids: [add.created.w] }] }, HUMAN);
    if (rm.status !== "applied") throw new Error(JSON.stringify(rm));
    const u3 = inc.update(engine.doc, rm.changed);
    expect(u3.mode).toBe("full");
    expect(u3.added.map((f) => f.check)).toEqual(["short"]);
    expect(u3.result.waived).toEqual([]);
  });
});

describe("waivers in the KiCad comparison", () => {
  const k = (x: number, y: number) => ({ x: x + 100, y: -y + 100 });
  const report: KicadDrcReport = {
    kicad_version: "10.0.5",
    coordinate_units: "mm",
    violations: [{ type: "shorting_items", severity: "error", description: "Items shorting two nets", items: [{ description: "Track [N1] on F.Cu", pos: k(-2, 0) }, { description: "Pad 2 [N2] of A on F.Cu", pos: k(2, 0) }] }],
    unconnected_items: [{ type: "unconnected_items", severity: "error", description: "Missing connection between items", items: [{ description: "Pad 2 [N2] of A on F.Cu", pos: k(2, 0) }, { description: "Pad 2 [N2] of B on F.Cu", pos: k(2, 5) }] }],
  };
  const transform = { tx: -mm(100), ty: mm(100), source: "given" as const };

  it("lists waived findings and their KiCad items apart; the like-with-like counts leave both out", () => {
    const plain = runBoardChecks(board());
    const short = plain.findings.find((f) => f.check === "short")!;
    const open = plain.findings.find((f) => f.check === "unconnected")!;
    const w1 = waiver({ finding: short.id });
    const w2 = waiver({ rule: "unconnected", objects: [...open.objects] });
    const doc = withWaivers(board(), [w1, w2]);
    const c = compareWithKicad(runBoardChecks(doc), report, { transform, doc });
    expect(c.waived.map((w) => [w.finding.id, w.waiver, w.kicad?.type])).toEqual([
      [short.id, w1.id, "shorting_items"],
      [open.id, w2.id, "unconnected_items"],
    ]);
    expect(c.matched).toEqual([]);
    expect(c.kicadOnly).toEqual([]);
    expect(c.oursOnly).toEqual([]);
    expect(c.comparable).toEqual({ ours: { unconnected: 0, errors: 0, warnings: 0 }, kicad: { unconnected: 0, errors: 0, warnings: 0 } });
    expect(c.categories.find((r) => r.category === "short")).toBeUndefined();
    expect(c.unconnectedByNet).toEqual([]);
    expect(c.differences).toEqual([]);
    // the raw totals stay as each tool reports them
    expect(c.totals.kicad).toMatchObject({ unconnected: 1, errors: 1 });
    expect(formatCrossCheck(c)).toMatch(/waived: 2 finding\(s\) a person marked not a problem, 2 of them matched to a KiCad item/);
  });

  it("a waived finding KiCad does not report is listed without a KiCad item; nothing else changes", () => {
    const plain = runBoardChecks(board());
    const short = plain.findings.find((f) => f.check === "short")!;
    const noShort: KicadDrcReport = { ...report, violations: [] };
    const c = compareWithKicad(runBoardChecks(withWaivers(board(), [waiver({ finding: short.id })])), noShort, { transform });
    expect(c.waived.map((w) => [w.finding.id, w.kicad])).toEqual([[short.id, undefined]]);
    expect(c.comparable.ours.errors).toBe(0);
    expect(c.matched.map((m) => m.kicad.type)).toEqual(["unconnected_items"]);
  });
});
