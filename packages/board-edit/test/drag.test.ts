/**
 * Drag sessions and footprint.move with attached tracks (contract phase2-editing.md, sections 2.1.1 and 8): the
 * preview is what the commit writes; moving a part with its tracks keeps connectivity on the Airnode C3 fixture; a
 * track drag stops at the last legal position; an agent's move reports what it detached.
 */
import { describe, expect, it } from "vitest";
import { canonicalRecord, createDocument, mm, openBoardService, type Actor, type BoardDocument, type BoardRecord, type TrackRec } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { runBoardChecks } from "@protoboardai/board-checks";
import { createEditKernel } from "../src/index.js";

const PERSON: Actor = { kind: "human", id: "user" };
const AGENT: Actor = { kind: "agent", id: "agent:placer", name: "placer" };

/** Islands per net and the unconnected count: the connectivity a move must keep. */
const connectivity = (doc: BoardDocument) => {
  const r = runBoardChecks(doc);
  return { unconnected: r.summary.unconnected, nets: Object.fromEntries(r.connectivity.nets.map((n) => [n.net, n.islands])) };
};
/** A record without the ids a draft or commit issues (draft ids differ from committed ones). */
const shape = (r: BoardRecord) => {
  const { id: _i, ...rest } = r as BoardRecord & { id: string };
  return canonicalRecord(rest as never);
};

describe("footprint.move with attached tracks", () => {
  for (const [fp, dx, dy] of [
    ["fp:power/ldo", 500_000, 0],
    ["fp:power/ldo", -300_000, 700_000],
    ["fp:sensor/ic", 400_000, -300_000],
    ["fp:usb/connector", 0, -500_000],
  ] as const) {
    it(`keeps connectivity when ${fp} moves by ${dx}, ${dy}`, () => {
      const svc = openBoardService({ document: airnodeC3(), epoch: "mv0001" });
      const before = connectivity(svc.snapshot().doc);
      const r = svc.apply({ batchId: "m", label: "move a part with tracks", ops: [{ op: "footprint.move", ids: [fp], dx, dy }] }, PERSON);
      expect(r.status).toBe("applied");
      expect(connectivity(svc.snapshot().doc)).toEqual(before);
    });
  }

  it("the drag preview is exactly what the commit writes, and the report names what followed", () => {
    const svc = openBoardService({ document: airnodeC3(), epoch: "mv0002" });
    const k = createEditKernel(svc.snapshot());
    const d = k.startDrag({ kind: "footprint", ids: ["fp:power/ldo"] });
    if ("error" in d) throw new Error(d.error);
    const c = d.move({ dx: 500_000, dy: 0 });
    expect(c.ok).toBe(true);
    const f = d.finish();
    if ("error" in f) throw new Error(f.error);
    const r = svc.apply(f.tx, PERSON);
    expect(r.status).toBe("applied");
    if (r.status !== "applied") return;
    const after = svc.snapshot().doc;
    const written = r.changed.map((id) => after.records.get(id)!).map(shape).sort();
    expect(c.puts.map(shape).sort()).toEqual(written);
    expect(r.reports?.[0].report).toMatchObject({ stretched: ["trk:f.3v3.1", "trk:f.vbus.2"], detached: [] });
  });

  it("an agent's move leaves locked copper and reports it as detached", () => {
    const svc = openBoardService({ document: airnodeC3(), epoch: "mv0003" });
    const r = svc.apply({ batchId: "m", label: "move the regulator right", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 500_000, dy: 0 }] }, AGENT);
    expect(r.status).toBe("applied");
    if (r.status === "applied") expect(r.reports?.[0].report.detached).toEqual([{ track: "trk:f.vbus.2", pad: "pad:power/ldo:1", reason: "locked" }]);
  });

  it("detaches a track that would short another net instead of creating the short", () => {
    // a part whose stub runs along a neighbor pad of another net: moving the part would drag the stub across it
    const P = (x: number, y: number) => ({ x: mm(x), y: mm(y) });
    const smd = (number: string, x: number, y: number) => ({ number, type: "smd" as const, shape: "rect" as const, x: mm(x), y: mm(y), width: mm(0.6), height: mm(0.6) });
    const GEN = { by: "generated" as const };
    const recs: BoardRecord[] = [
      { kind: "board", id: "board", name: "Short test", thickness: mm(1.6), copper_layers: 2, origin: "center" },
      { kind: "outline", id: "outline", outline: [P(-10, -10), P(10, -10), P(10, 10), P(-10, 10)], source: { kind: "board" }, provenance: GEN },
      { kind: "footprint", id: "fp:U1", ref: "U1", footprint: "T:U1", x: 0, y: 0, rotation: 0, side: "top", pads: [smd("1", 0, 0)], provenance: GEN },
      { kind: "footprint", id: "fp:J1", ref: "J1", footprint: "T:J1", x: mm(4), y: 0, rotation: 0, side: "top", pads: [smd("1", 0, 0)], provenance: GEN },
      { kind: "footprint", id: "fp:X1", ref: "X1", footprint: "T:X1", x: mm(2), y: mm(2), rotation: 0, side: "top", pads: [smd("1", 0, 0)], provenance: GEN },
      { kind: "track", id: "trk:a", net: "A", layer: "top", width: mm(0.2), start: P(0, 0), end: P(4, 0), provenance: GEN },
    ];
    const doc = createDocument(recs, { source: "test", nets: [{ name: "A", pins: ["U1.1", "J1.1"] }, { name: "B", pins: ["X1.1"] }] });
    const svc = openBoardService({ document: doc, epoch: "mv0004" });
    // U1 moves 4 mm up: the stretched track would cross X1 (net B) at (2, 2) on every posture
    const r = svc.apply({ batchId: "m", label: "move U1 up four millimeters", ops: [{ op: "footprint.move", ids: ["fp:U1"], dx: 0, dy: mm(4) }] }, PERSON);
    expect(r.status).toBe("applied");
    if (r.status !== "applied") return;
    expect(r.reports?.[0].report.detached).toEqual([{ track: "trk:a", pad: "pad:U1:1", reason: "short", with: "pad:X1:1" }]);
    expect((svc.snapshot().doc.records.get("trk:a") as TrackRec).start).toEqual(P(0, 0));
    expect(runBoardChecks(svc.snapshot().doc).findings.filter((f) => f.check === "short" || f.message.includes("short"))).toEqual([]);
  });
});

describe("track drag session", () => {
  it("stops at the last legal position instead of shorting", () => {
    const svc = openBoardService({ document: airnodeC3(), epoch: "dr0001" });
    const k = createEditKernel(svc.snapshot());
    const d = k.startDrag({ kind: "track", id: "trk:f.vbus.1" });
    if ("error" in d) throw new Error(d.error);
    const c = d.move({ dx: -600_000, dy: 0 });
    expect(c.ok).toBe(false);
    expect(c.dx).toBeLessThan(0);
    expect(c.dx).toBeGreaterThan(-600_000);
    const f = d.finish();
    if ("error" in f) throw new Error(f.error);
    expect(svc.apply(f.tx, PERSON).status).toBe("applied");
    const errorsBefore = new Set(runBoardChecks(airnodeC3()).findings.filter((x) => x.severity === "error").map((x) => x.id));
    const errorsAfter = runBoardChecks(svc.snapshot().doc).findings.filter((x) => x.severity === "error" && !errorsBefore.has(x.id) && x.check !== "unconnected");
    expect(errorsAfter).toEqual([]);
  });

  it("a via drag re-forms its tracks at 45 degrees", () => {
    const svc = openBoardService({ document: airnodeC3(), epoch: "dr0002" });
    // give the ground via a track to drag along
    svc.apply({ batchId: "t", label: "add a ground stub track", ops: [{ op: "track.add", segments: [{ handle: "s", net: "GND", layer: "top", width: 250_000, start: { x: -10_000_000, y: -5_200_000 }, end: { x: -10_000_000, y: -4_100_000 } }] }] }, PERSON);
    const k = createEditKernel(svc.snapshot());
    const d = k.startDrag({ kind: "track", id: "via:f.gnd.1" });
    if ("error" in d) throw new Error(d.error);
    const c = d.move({ dx: 300_000, dy: -500_000 });
    const tracks = c.puts.filter((r): r is TrackRec => r.kind === "track");
    expect(tracks.length).toBe(2);
    for (const t of tracks) {
      const ax = Math.abs(t.end.x - t.start.x),
        ay = Math.abs(t.end.y - t.start.y);
      expect(ax === 0 || ay === 0 || ax === ay).toBe(true);
    }
  });
});

