/** The drawing tools on the Airnode C3 fixture and a round board: placement, idempotence, removal, proposals. */
import { describe, expect, it } from "vitest";
import { documentsEqual, recordsOfKind, type Actor, type BoardDocument } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { runBoardChecks } from "@protoboardai/board-checks";
import { alignParts, applyStyleChange, checkStyle, madeBy, planRestyle, proposeStyleChange, removeStyle, resolveStyle, scratchService, styleEdgeText, styleFrames, styleHazard, type ResolvedStyle } from "../src/index.js";
import { roundBoard } from "./boards.js";

const PERSON: Actor = { kind: "human", id: "person" };
const OPTS = { nameplate: { rev: "1", date: "2026-11-09" } };

function restyled(doc: BoardDocument, style: ResolvedStyle): BoardDocument {
  const plan = planRestyle(doc, style, OPTS);
  expect(plan.failed).toBeUndefined();
  return plan.doc;
}

/** Silk-to-pad findings that name a record a style tool drew. */
function styleSilkOnPads(doc: BoardDocument): string[] {
  return runBoardChecks(doc)
    .findings.filter((f) => f.check === "silk_to_pad")
    .flatMap((f) => f.objects)
    .filter((id) => {
      const r = doc.records.get(id);
      return !!r && madeBy(r);
    });
}

describe.each(["hazard-protocol", "neutral", "arcade"])("restyle with %s", (theme) => {
  const doc = airnodeC3();
  const style = resolveStyle(doc, { userDir: false, theme });
  const after = restyled(doc, style);
  it("draws no style silk on pads, vias or holes", () => {
    expect(styleSilkOnPads(after)).toEqual([]);
  });
  it("a second run changes nothing", () => {
    const again = planRestyle(after, style, OPTS);
    expect(again.steps.filter((s) => !s.empty).map((s) => s.tool)).toEqual([]);
  });
  it("the style check is clean afterward (copper drift aside) and was not before", () => {
    const before = checkStyle(doc, style, OPTS);
    const c = checkStyle(after, style, OPTS);
    expect(before.clean).toBe(false);
    expect(c.clean).toBe(true);
    expect(c.findings.every((f) => f.severity !== "error")).toBe(true);
    expect(c.findings.filter((f) => f.severity === "warning").every((f) => f.check === "style.odd_angle")).toBe(true);
  });
  it("removing every tool's drawing gives the original board back", () => {
    const svc = scratchService(after);
    const r = applyStyleChange(svc, removeStyle(after));
    expect(r.status).toBe("applied");
    expect(documentsEqual(svc.snapshot().doc, doc)).toBe(true);
  });
});

describe("changing the theme of a styled board", () => {
  it("each tool updates what it drew before, and a second run is empty", () => {
    const doc = airnodeC3();
    const arcade = resolveStyle(doc, { userDir: false, theme: "arcade" });
    const styled = restyled(doc, arcade);
    const tagged = resolveStyle(doc, { userDir: false, theme: "arcade", overrides: { "frame.style": "chamfer45", "frame.title": "tag", "nameplate.style": "tag" } });
    const plan = planRestyle(styled, tagged, OPTS);
    expect(plan.failed).toBeUndefined();
    expect(plan.steps.find((s) => s.tool === "frames")!.report.edited).toBeGreaterThan(0);
    expect(planRestyle(plan.doc, tagged, OPTS).steps.filter((s) => !s.empty)).toEqual([]);
    expect(checkStyle(plan.doc, tagged, OPTS).clean).toBe(true);
  });
});

describe("Hazard Protocol on Airnode C3", () => {
  const doc = airnodeC3();
  const style = resolveStyle(doc, { userDir: false });
  it("frames every group of two or more parts with a knockout tag, and logs the single-part group", () => {
    const cs = styleFrames(doc, style);
    const frames = cs.report.frames as { group: string; titleAs?: string }[];
    expect(frames.map((f) => f.group).sort()).toEqual(["mcu", "power", "sensor", "status", "usb"]);
    expect(frames.every((f) => f.titleAs === "tag")).toBe(true);
    expect(cs.report.skipped.map((s) => s.what)).toEqual(["ui (top)"]);
  });
  it("stripes the antenna keep-out only, with its tag, in 45 degree stripes", () => {
    const cs = styleHazard(doc, style);
    expect(cs.report.zones).toEqual([{ id: "kpo:f.antenna", kind: "antennaKeepout", side: "top", tag: "ANTENNA", stripes: expect.any(Number) }]);
  });
  it("shows the bench designators, about a third, and moves footprint texts off the silkscreen as a host operation", () => {
    const plan = planRestyle(doc, style, OPTS);
    const des = plan.steps.find((s) => s.tool === "designators")!;
    expect((des.report.shown as { ref: string }[]).map((s) => s.ref).sort()).toEqual(["D1", "D2", "J1", "SW1", "U1", "U2", "U3"]);
    expect(des.hostOps[0].op).toBe("record.put");
  });
  it("puts the nameplate on the bottom with no date", () => {
    const plan = planRestyle(doc, style, OPTS);
    expect(plan.steps.find((s) => s.tool === "nameplate")!.report).toMatchObject({ text: "AIRNODE C3 BOARD V1", side: "bottom", tag: true });
  });
  it("a frame a person edited by hand is kept on a re-run (and redrawn with force)", () => {
    const svc = scratchService(doc);
    applyStyleChange(svc, styleFrames(doc, style));
    const g = recordsOfKind(svc.snapshot().doc, "graphic").find((x) => madeBy(x, "frames") && x.shape === "path")!;
    const r = svc.apply({ batchId: "hand-1", label: "person nudges a frame", ops: [{ op: "graphic.edit", id: g.id, patch: { stroke_width: 200_000 } }] }, PERSON);
    expect(r.status).toBe("applied");
    const again = styleFrames(svc.snapshot().doc, style);
    expect(again.report.keptHandEdits).toEqual([g.id]);
    expect(again.empty).toBe(true);
    expect(styleFrames(svc.snapshot().doc, style, { force: true }).report.edited).toBe(1);
  });
  it("an agent proposes a change set and a person accepts it; the records carry the tool's provenance", () => {
    const svc = scratchService(doc);
    const p = proposeStyleChange(svc, styleFrames(doc, style));
    expect(p.status).toBe("proposed");
    const r = svc.acceptProposal(PERSON, p.proposal!);
    expect(r.status).toBe("applied");
    const made = recordsOfKind(svc.snapshot().doc, "graphic").filter((x) => madeBy(x, "frames"));
    expect(made.length).toBeGreaterThan(5);
    expect(styleFrames(svc.snapshot().doc, style).empty).toBe(true);
  });
});

describe("round board", () => {
  const doc = roundBoard();
  const style = resolveStyle(doc, { userDir: false });
  it("auto edge text follows a round outline and keeps clear of pads", () => {
    const cs = styleEdgeText(doc, style);
    expect((cs.report.runs as unknown[]).length).toBeGreaterThan(0);
    const svc = scratchService(doc);
    applyStyleChange(svc, cs);
    expect(styleSilkOnPads(svc.snapshot().doc)).toEqual([]);
    expect(recordsOfKind(svc.snapshot().doc, "text").every((t) => t.layer === "bottom_silkscreen" && t.mirrored)).toBe(true);
  });
  it("frames groups on both sides", () => {
    const frames = styleFrames(doc, style).report.frames as { group: string; side: string }[];
    expect(frames.map((f) => `${f.group}/${f.side}`).sort()).toEqual(["back/bottom", "led/top", "sense/top"]);
  });
});

describe("alignment (only on request)", () => {
  it("leaves routed parts alone before routing, snaps the rest, and reports moves that lengthen a critical net", () => {
    const doc = airnodeC3();
    const style = resolveStyle(doc, { userDir: false, overrides: { "placement.grid": 1.0, "placement.maxLengthIncrease": 0.1 } });
    const cs = alignParts(doc, style, { group: "sensor" });
    const skipped = cs.report.skipped.map((s) => s.what);
    expect(skipped).toContain("U3"); // copper attached
    expect(cs.ops.every((o) => o.op === "footprint.move" && o.tracks === "attached")).toBe(true);
    const all = alignParts(doc, style, { group: "power", afterRouting: true });
    expect((all.report.lengthened as unknown[]).length + all.ops.length).toBeGreaterThan(0);
    // moves are guarded one at a time, so a move refused at first can pass once its neighbors moved: it settles
    const svc = scratchService(doc);
    let next = cs;
    for (let i = 0; i < 4 && !next.empty; i++) {
      expect(applyStyleChange(svc, next).status).toBe("applied");
      next = alignParts(svc.snapshot().doc, style, { group: "sensor" });
    }
    expect(next.empty).toBe(true);
  });
});
