/**
 * The text placement search, the score's opportunity floor and the agent's cleanup loop (listDefects, proposeFixes,
 * applyFix, explainDefect, cleanupPass, revertCleanup), on the synthetic Airnode C3 sample and synthetic circuits.
 */
import { describe, expect, it } from "vitest";
import { airnodeSchematic } from "../src/fixtures/airnode-c3.ts";
import { ledDriver16, mcu48 } from "../src/fixtures/synthetic.ts";
import {
  CLEANUP_TOOLS,
  applyFix,
  cleanupPass,
  createSchematic,
  explainDefect,
  failFraction,
  labelBox,
  layoutSchematic,
  listDefects,
  openSchematicService,
  proposeFixes,
  recordsOfKind,
  revertCleanup,
  schematicsEqual,
  scoreSchematic,
  withChanges,
  type SchematicCircuit,
  type SchematicDocument,
} from "../src/index.ts";

const laid = (c: SchematicCircuit): SchematicDocument => {
  const doc = createSchematic([], c);
  const r = layoutSchematic(doc);
  return withChanges(doc, r.puts, r.removes);
};

describe("the score's opportunity floor", () => {
  it("floors non-gate rules at ten opportunities and leaves gates absolute", () => {
    expect(failFraction("warning", 1, 1)).toBeCloseTo(0.1);
    expect(failFraction("warning", 3, 30)).toBeCloseTo(0.1);
    expect(failFraction("info", 2, 4)).toBeCloseTo(0.2);
    expect(failFraction("gate", 1, 1)).toBe(1);
    expect(failFraction("error", 0, 0)).toBe(0);
  });
});

describe("text placement search", () => {
  it("closes the text gates on the sample and the 16-channel driver", async () => {
    for (const doc of [await airnodeSchematic("ok"), laid(ledDriver16())]) {
      const s = scoreSchematic(doc);
      for (const g of ["C01", "C02", "C03", "C04", "C05", "C06"]) expect(s.rules.find((r) => r.id === g)!.count, g).toBe(0);
    }
  });
});

describe("the cleanup tools", () => {
  /** the sample with one label pushed onto a symbol body: an overlap (C02) to clean up */
  const broken = async () => {
    const doc = await airnodeSchematic("ok");
    const sym = recordsOfKind(doc, "symbol").find((s) => s.card === "card:sensor")!;
    const l = recordsOfKind(doc, "label").find((x) => x.card === sym.card)!;
    const target = { ...l, x: sym.x + 1, y: sym.y + 1 };
    // keep it a label of its own net on nothing else: only its overlap matters here
    return { doc: withChanges(doc, [target], []), label: target };
  };

  it("lists defects gates first with points and a crop, and explains them", async () => {
    const { doc } = await broken();
    const list = listDefects(doc);
    expect(list.defects.length).toBeGreaterThan(0);
    expect(list.defects[0].gate).toBe(true);
    for (const d of list.defects) {
      expect(d.points).toBeGreaterThanOrEqual(0);
      expect(d.crop.box[2]).toBeGreaterThan(d.crop.box[0]);
    }
    const text = explainDefect(doc, list.defects[0].id);
    expect(text).toContain(list.defects[0].rule);
    expect(text).toMatch(/matters because/);
    expect(explainDefect(doc, "D9999")).toMatch(/no defect/);
    expect(CLEANUP_TOOLS.map((t) => t.name)).toEqual(["schematic_list_defects", "schematic_propose_fixes", "schematic_apply_fix", "schematic_explain_defect", "schematic_cleanup_pass"]);
  });

  it("proposes fixes scored on a copy, never opening a gate, and applies one as the agent", async () => {
    const { doc, label } = await broken();
    const before = scoreSchematic(doc);
    const d = listDefects(doc, { score: before }).defects.find((x) => x.gate && x.objects.includes(label.id))!;
    expect(d).toBeTruthy();
    const fixes = proposeFixes(doc, d.id, { score: before });
    expect(fixes.length).toBeGreaterThan(0);
    for (const f of fixes) expect(f.predicted.gatesAfter).toBeLessThanOrEqual(f.predicted.gatesBefore);
    const best = fixes[0];
    expect(best.predicted.gatesAfter).toBeLessThan(best.predicted.gatesBefore);
    const svc = openSchematicService({ document: doc, circuit: doc.circuit });
    const r = applyFix(svc, best, { changeSet: { id: "cs-test" } });
    expect(r.status).toBe("applied");
    expect(svc.score().gates.open).toBe(best.predicted.gatesAfter);
    expect(svc.score().score).toBe(best.predicted.after);
  });

  it("leaves a pinned label alone", async () => {
    const { doc, label } = await broken();
    const pinned = withChanges(doc, [{ ...label, pinned: true }], []);
    const d = listDefects(pinned).defects.find((x) => x.gate && x.objects.includes(label.id))!;
    for (const f of proposeFixes(pinned, d.id)) expect(JSON.stringify(f.ops)).not.toContain(label.id);
    const svc = openSchematicService({ document: pinned, circuit: pinned.circuit });
    cleanupPass(svc, { budget: 20, maxPasses: 2 });
    expect(svc.snapshot().doc.records.get(label.id)).toEqual(pinned.records.get(label.id));
  });

  it("runs a bounded greedy pass that never lowers the score or opens a gate, reverted as a whole", () => {
    const doc = laid(mcu48());
    const svc = openSchematicService({ document: doc, circuit: doc.circuit });
    const r = cleanupPass(svc, { budget: 12, maxPasses: 3 });
    expect(r.passes).toBeLessThanOrEqual(3);
    expect(r.changeSet.ops).toBeLessThanOrEqual(12);
    expect(r.after.score).toBeGreaterThanOrEqual(r.before.score);
    expect(r.after.gates).toBeLessThanOrEqual(r.before.gates);
    for (const s of r.steps) expect(s.after).toBeGreaterThanOrEqual(s.before);
    expect(revertCleanup(svc, r)).toBe(r.changeSet.transactions);
    expect(schematicsEqual(svc.snapshot().doc, doc)).toBe(true);
  });

  it("the fixed label sits clear of every body", async () => {
    const { doc, label } = await broken();
    const svc = openSchematicService({ document: doc, circuit: doc.circuit });
    cleanupPass(svc, { budget: 10, maxPasses: 2 });
    const after = svc.snapshot().doc;
    const moved = recordsOfKind(after, "label").find((l) => l.net === label.net && l.card === label.card);
    expect(moved).toBeTruthy();
    expect(scoreSchematic(after).gates.open).toBe(0);
    expect(labelBox(moved!, after).x1).toBeGreaterThan(labelBox(moved!, after).x0);
  });
});
