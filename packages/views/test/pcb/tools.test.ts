/**
 * The layout screen's interactive tools without a browser: what the route callout names (the limiting rule, its
 * tier and source), the operations the via, zone, keep-out, rip-up, width, outline and silkscreen tools build (each
 * applied by the core's own engine on the Airnode C3 fixture), the DXF report, and the tool controller over a real
 * board service: a route drafted, finished as one `track.route` transaction with its region precondition, or
 * dropped with nothing written; highlight mode asking twice; a footprint drag with attached tracks held against
 * agents and committed as the kernel's call.
 */
import { describe, expect, it } from "vitest";
import { createEngine, openBoardService, padsOf, snapshotToWire, type Actor, type BoardDocument, type BoardService, type FootprintRec } from "@protoboardai/board";
import { airnodeC3, AIRNODE_C3_NETLIST } from "@protoboardai/board/fixtures/airnode-c3";
import { createEditKernel, type RouteSession } from "@protoboardai/board-edit";
import { EditSession } from "../../src/pcb/edit/session.js";
import { ToolController } from "../../src/pcb/edit/controller.js";
import {
  activeSegment,
  contourOf,
  draftVias,
  dxfReport,
  keepoutOp,
  latencyStats,
  lineOp,
  moveVertexOp,
  nearestVertex,
  objectName,
  outlineVertices,
  rectContour,
  reportOf,
  ripOp,
  ripSelectionOps,
  ripSummary,
  routeCallout,
  routeStartFor,
  stepWidth,
  valueSource,
  viaOp,
  viaSize,
  widthOps,
  zoneOp,
  type RouteDraft,
} from "../../src/pcb/edit/tools.js";
import { dragNotesSvg, placeCard, polygonSvg, routeCardHtml, routeDraftSvg } from "../../src/pcb/draft-overlay.js";
import { RemoteBoardSource } from "../../src/pcb/remote.js";
import type { BoardReplyMessage, BoardRequest, PageOpCall } from "../../src/pcb/types.js";

const PERSON: Actor = { kind: "human", id: "user" };
const padAt = (doc: BoardDocument, fp: string, key: string) => {
  const p = padsOf(doc.records.get(fp) as FootprintRec).find((x) => x.key === key)!;
  return { x: p.x, y: p.y, id: p.id };
};
const m = { toScreen: (x: number, y: number) => ({ x: 400 + x * 20, y: 300 - y * 20 }), scale: 20 };

/** Apply ops as a person on a copy of the fixture: the reply (reports included). */
function apply(ops: PageOpCall[], doc: BoardDocument = airnodeC3()) {
  const e = createEngine(doc, { epoch: "tools1", now: () => 0 });
  const r = e.apply({ batchId: "t", label: "a tool test change", ops: ops as never }, PERSON);
  return { r, doc: e.doc };
}

function rig() {
  const svc: BoardService = openBoardService({ document: airnodeC3(), netlist: AIRNODE_C3_NETLIST });
  const remote = new RemoteBoardSource("b", { type: "snapshot", board: "b", mode: "service", snapshot: snapshotToWire(svc.snapshot()) });
  svc.subscribe((e) => {
    if (e.type !== "commit") return;
    const s = svc.snapshot();
    const ids = [...new Set([...e.changed, ...Object.values(e.created)])].filter((id) => !e.removed.includes(id));
    remote.receive({ type: "commit", board: "b", event: e, puts: ids.map((id) => s.doc.records.get(id)!).filter(Boolean), removes: e.removed, versions: Object.fromEntries(ids.map((id) => [id, s.version(id)])) });
  });
  const sent: BoardRequest[] = [];
  const txs: unknown[] = [];
  const send = async (req: BoardRequest): Promise<BoardReplyMessage> => {
    sent.push(req);
    if (req.method === "apply") {
      txs.push(req.tx);
      return { ok: true, result: svc.apply(req.tx as never, PERSON) };
    }
    return { ok: false, error: `unknown method ${req.method}` };
  };
  const session = new EditSession(remote, send);
  const changes = { n: 0 };
  const ctl = new ToolController({ session, request: send, onChange: () => changes.n++, budgetMs: 50 });
  return { svc, session, ctl, sent, txs, changes };
}

describe("the route callout", () => {
  it("names the width, the clearance and the limiting rule with tier and source", () => {
    const doc = airnodeC3();
    const k = createEditKernel({ epoch: "t", seq: 0, doc }, { budgetMs: 50 });
    const from = padAt(doc, "fp:status/r1", "2");
    const s = k.startRoute({ from: { pad: from.id } }) as RouteSession;
    const c = s.move({ x: from.x - 500_000, y: from.y + 1_500_000 }) as unknown as RouteDraft;
    const co = routeCallout(doc, c, { mode: "walkaround", posture: "45" });
    expect(co.shelf).toBe(`${c.net} · active segment`);
    expect(co.mode).toBe("walk around");
    const cl = co.rows.find((r) => r.label === "Clearance")!;
    expect(cl.value).toBe("0.2");
    expect(cl.chip).toBe("design target");
    const w = co.rows.find((r) => r.label === "Width")!;
    expect(w.value).toBe("0.25");
    expect(co.rows.find((r) => r.label === "Length")!.value).toMatch(/mm, live · vias 0/);
    if (c.limiting) expect(co.rows[0].label).toBe("Limit");
    expect(co.keys).toContain("F finish");
    const html = routeCardHtml(co);
    expect(html).toContain("CLEARANCE".toLowerCase().replace(/^./, "C"));
    expect(html).not.toContain("<script");
  });

  it("says where a value comes from: a rule's tier, a net class, the default, the person", () => {
    const doc = airnodeC3();
    expect(valueSource(doc, { value: 1, source: "default" }).by).toBe("default");
    expect(valueSource(doc, { value: 1, source: "given" }).by).toBe("you");
    const t = valueSource(doc, { value: 200_000, rule: "rule:target.clearance", tier: "target", source: "rule" });
    expect(t.by).toBe("design target");
    expect(t.from.length).toBeGreaterThan(0);
    const cls = [...doc.records.values()].find((r) => r.kind === "rule" && r.applies.classes?.length);
    if (cls) expect(valueSource(doc, { value: 1, rule: cls.id, source: "rule" }).by).toBe("net class");
  });

  it("flags highlight collisions and asks twice", () => {
    const doc = airnodeC3();
    const k = createEditKernel({ epoch: "t", seq: 0, doc }, { budgetMs: 50 });
    const from = padAt(doc, "fp:status/r1", "2");
    const to = padAt(doc, "fp:status/led1", "1");
    const s = k.startRoute({ from: { pad: from.id }, mode: "highlight" }) as RouteSession;
    const c = s.move(to) as unknown as RouteDraft;
    expect(c.collisions.length).toBeGreaterThan(0);
    expect(routeCallout(doc, c, { mode: "highlight", posture: "45" }).flag).toMatchObject({ tone: "fail", text: expect.stringContaining("F asks") });
    expect(routeCallout(doc, c, { mode: "highlight", posture: "45", armed: true }).flag?.text).toContain("F again commits");
    const svg = routeDraftSvg(doc, c, m, { mode: "highlight", via: viaSize(doc) });
    expect(svg).toContain("#ef4444");
    // blue only on the active segment
    expect(svg.match(/#5aa9ff/g)?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("finds vias and the active segment of a draft, and names objects in words", () => {
    const pts = [
      { x: 0, y: 0, layer: "top" as const },
      { x: 1000, y: 0, layer: "top" as const },
      { x: 1000, y: 0, layer: "bottom" as const },
      { x: 1000, y: 2000, layer: "bottom" as const },
    ];
    expect(draftVias(pts)).toEqual([{ x: 1000, y: 0 }]);
    expect(activeSegment({ points: pts } as RouteDraft)).toEqual([pts[2], pts[3]]);
    const doc = airnodeC3();
    expect(objectName(doc, padAt(doc, "fp:status/r1", "2").id)).toMatch(/^R1 pad 2$/);
    expect(objectName(doc, "outline")).toBe("board edge");
  });
});

describe("the tools' operations apply on the fixture", () => {
  const doc = airnodeC3();
  const sq = (x: number, y: number, s = 2_000_000) => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
  it("contours drop repeats and refuse no area", () => {
    expect(contourOf([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }])).toHaveLength(3);
    expect(contourOf([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])).toBeUndefined();
    expect(rectContour({ x: 5, y: 5 }, { x: 0, y: 0 })[0]).toEqual({ x: 0, y: 0 });
  });
  it("zone, keep-out, via and silkscreen line", () => {
    const z = zoneOp(sq(-15_000_000, -12_000_000), { net: "GND", layer: "top" })!;
    expect(apply([z]).r.status).toBe("applied");
    const k = keepoutOp(sq(-15_000_000, -12_000_000), { layers: ["top", "bottom"], tier: "no_go", blocks: { tracks: true, vias: true, pours: false, footprints: false } })!;
    expect(apply([k]).r.status).toBe("applied");
    expect(keepoutOp(sq(0, 0), { layers: ["top"], tier: "policy", blocks: { tracks: false, vias: false, pours: false, footprints: false } })).toBeUndefined();
    const v = viaOp({ x: -15_000_000, y: -12_000_000 }, { net: "GND", ...viaSize(doc) });
    expect(apply([v]).r.status).toBe("applied");
    expect(apply([lineOp({ x: 0, y: -13_000_000 }, { x: 5_000_000, y: -13_000_000 })!]).r.status).toBe("applied");
    expect(lineOp({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeUndefined();
  });
  it("rip-up keeps locked copper and reports it", () => {
    const tracks = [...doc.records.values()].filter((r) => r.kind === "track");
    const locked = tracks.find((t) => t.locked);
    const free = tracks.find((t) => !t.locked)!;
    const sel = ripSelectionOps(doc, [free.id, ...(locked ? [locked.id] : [])]);
    expect(sel.removed).toEqual([free.id]);
    if (locked) expect(sel.skippedLocked).toEqual([locked.id]);
    expect(apply(sel.ops).r.status).toBe("applied");
    const net = free.net!;
    const out = apply([ripOp({ nets: [net] })!]);
    expect(out.r.status).toBe("applied");
    expect(ripSummary(reportOf(out.r))).toMatch(/removed/);
    const region = apply([ripOp({ region: rectContour({ x: -20_000_000, y: -20_000_000 }, { x: 20_000_000, y: 20_000_000 }) })!]);
    expect(region.r.status).toBe("applied");
    const rep = reportOf(region.r)!;
    for (const id of rep.skippedLocked as string[]) expect(region.doc.records.has(id)).toBe(true);
  });
  it("track widths on a net, with a neck", () => {
    const net = [...doc.records.values()].flatMap((r) => (r.kind === "track" && r.net ? [r.net] : []))[0];
    const out = apply(widthOps({ net }, 0.4, true));
    expect(out.r.status).toBe("applied");
    expect(widthOps({ ids: [] }, 0.4, false)).toEqual([]);
    expect(stepWidth(250_000, 1)).toBe(300_000);
    expect(stepWidth(250_000, -1)).toBe(200_000);
  });
  it("moves an outline corner", () => {
    const vs = outlineVertices(doc)!;
    expect(nearestVertex(vs, { x: vs[0].x + 100, y: vs[0].y }, 1000)).toBe(0);
    const op = moveVertexOp(doc, 0, { x: vs[0].x - 1_000_000, y: vs[0].y }, true)!;
    const out = apply([op]);
    expect(out.r.status, JSON.stringify(out.r)).toBe("applied");
    expect(outlineVertices(out.doc)![0].x).toBe(vs[0].x - 1_000_000);
  });
  it("reads a DXF import's report", () => {
    const dxf = ["0", "SECTION", "2", "ENTITIES", ...[[0, 0, 30, 0], [30, 0, 30, 20], [30, 20, 0, 20], [0, 20, 0, 0]].flatMap(([a, b, c, d]) => ["0", "LINE", "8", "0", "10", String(a), "20", String(b), "11", String(c), "21", String(d)]), "0", "TEXT", "8", "0", "0", "ENDSEC", "0", "EOF"].join("\n");
    const out = apply([{ op: "outline.import_dxf", dxf }]);
    expect(out.r.status, JSON.stringify(out.r)).toBe("applied");
    const rep = dxfReport(reportOf(out.r, "outline.import_dxf"))!;
    expect(rep.entities).toBeGreaterThanOrEqual(4);
    expect(rep.loops).toBe(1);
    expect(rep.outline).toMatchObject({ vertices: 4, areaMm2: 600 });
    expect(rep.skipped.some((s) => s.type === "TEXT" && s.reason.length > 0)).toBe(true);
  });
  it("starts a route from what is under the pointer", () => {
    const pad = padAt(doc, "fp:status/r1", "2");
    expect(routeStartFor(doc, { id: pad.id, kind: "pad" }, pad)).toEqual({ pad: pad.id });
    const t = [...doc.records.values()].find((r) => r.kind === "track")!;
    if (t.kind === "track") expect(routeStartFor(doc, { id: t.id, kind: "track" }, t.end)).toEqual({ track: t.id, end: "end" });
    expect(routeStartFor(doc, undefined, { x: 0, y: 0 })).toBeUndefined();
  });
  it("draws polygons and drag notes", () => {
    expect(polygonSvg(sq(0, 0), { x: 1, y: 1 }, m, { color: "#e6e6e6", label: "zone" })).toContain("ZONE");
    const t = [...doc.records.values()].find((r) => r.kind === "track")!;
    expect(dragNotesSvg(doc, { ok: true, detached: [{ track: t.id, pad: "p", reason: "short", with: "GND" }], collisions: [] }, m)).toContain("SHORT WITH GND");
  });
  it("places the route card beside the draft, never over it", () => {
    const area = { left: 76, top: 132, right: 1044, bottom: 720 };
    const c = placeCard({ x0: 400, y0: 300, x1: 700, y1: 400 }, { x: 700, y: 350 }, { w: 300, h: 160 }, area);
    expect(c.x + 300 <= 400 || c.x >= 700 || c.y + 160 <= 300 || c.y >= 400).toBe(true);
    const near = placeCard({ x0: 90, y0: 200, x1: 600, y1: 400 }, { x: 300, y: 300 }, { w: 300, h: 160 }, area);
    expect(near.x).toBeGreaterThanOrEqual(600);
  });
  it("summarizes latency samples", () => {
    expect(latencyStats([5, 1, 3, 2, 4])).toEqual({ n: 5, median: 3, p95: 5, max: 5 });
    expect(latencyStats([])).toEqual({ n: 0, median: 0, p95: 0, max: 0 });
  });
});

describe("the tool controller over a board service", () => {
  it("drafts a route, writes nothing until finish, then commits one track.route with the region precondition", async () => {
    const { svc, session, ctl, txs } = rig();
    const doc = session.confirmed().doc;
    const from = padAt(doc, "fp:status/r1", "2");
    const to = padAt(doc, "fp:status/led1", "1");
    expect(ctl.startRoute({ pad: from.id })).toEqual({ ok: true });
    for (let k = 0; k <= 10; k++) ctl.moveRoute({ x: from.x + ((to.x - from.x) * k) / 10, y: from.y + 1_500_000 * (1 - k / 10) });
    const c = ctl.moveRoute({ x: to.x + 120_000, y: to.y - 80_000 })!;
    expect(c.reached).toEqual({ kind: "pad", id: to.id });
    expect(svc.snapshot().seq).toBe(0);
    expect(ctl.timings.route.length).toBe(12);
    const out = await ctl.finishRoute();
    expect("ok" in out && out.ok, JSON.stringify(out)).toBe(true);
    expect(svc.snapshot().seq).toBe(1);
    expect(txs).toHaveLength(1);
    const tx = txs[0] as { ops: PageOpCall[]; expectRegion?: { box: unknown; seq: number } };
    expect(tx.ops.map((o) => o.op)).toEqual(["track.route"]);
    expect(tx.expectRegion?.seq).toBe(0);
    expect(svc.log().at(-1)!.actor.kind).toBe("human");
    expect(ctl.route).toBeUndefined();
  });

  it("Esc drops the draft: nothing is written", () => {
    const { svc, session, ctl, sent } = rig();
    const from = padAt(session.confirmed().doc, "fp:status/r1", "2");
    ctl.startRoute({ pad: from.id });
    ctl.moveRoute({ x: from.x, y: from.y + 2_000_000 });
    ctl.cancelRoute();
    expect(ctl.route).toBeUndefined();
    expect(svc.snapshot().seq).toBe(0);
    expect(sent.filter((r) => r.method === "apply")).toHaveLength(0);
  });

  it("highlight mode: the first finish only arms, the second commits the collisions", async () => {
    const { svc, session, ctl } = rig();
    const doc = session.confirmed().doc;
    const from = padAt(doc, "fp:status/r1", "2");
    const to = padAt(doc, "fp:status/led1", "1");
    ctl.startRoute({ pad: from.id }, { mode: "highlight" });
    expect(ctl.moveRoute(to)!.collisions.length).toBeGreaterThan(0);
    expect(await ctl.finishRoute()).toEqual({ armed: true });
    expect(svc.snapshot().seq).toBe(0);
    const out = await ctl.finishRoute();
    expect("ok" in out && out.ok).toBe(true);
    expect(svc.snapshot().seq).toBe(1);
    expect(svc.log().at(-1)!.label).toContain("with collisions");
  });

  it("backs up and changes layer with a via", () => {
    const { session, ctl } = rig();
    const from = padAt(session.confirmed().doc, "fp:status/r1", "2");
    ctl.startRoute({ pad: from.id });
    ctl.clickRoute({ x: from.x, y: from.y + 2_000_000 });
    const v = ctl.viaRoute(undefined, { x: from.x + 2_000_000, y: from.y + 2_000_000 });
    expect(v.ok, v.reason).toBe(true);
    expect(draftVias(ctl.route!.candidate!.points).length).toBe(1);
    ctl.backRoute();
    expect(draftVias(ctl.route!.candidate?.points ?? []).length).toBe(0);
    ctl.cancelRoute();
  });

  it("drags a footprint with its tracks through the kernel, holds it, previews and commits the kernel's call", async () => {
    const { svc, session, ctl, sent, txs } = rig();
    const x0 = (session.confirmed().doc.records.get("fp:power/ldo") as { x: number }).x;
    expect(ctl.startDrag({ kind: "footprint", ids: ["fp:power/ldo"] })).toBe(true);
    const c = ctl.moveDrag(500_000, 0)!;
    expect(c.ok).toBe(true);
    expect((session.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0 + 500_000);
    expect((session.confirmed().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.some((r) => r.method === "hold")).toBe(true);
    const out = await ctl.endDrag(false, "move LDO by hand");
    expect(out?.ok, out?.message).toBe(true);
    expect((svc.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0 + 500_000);
    expect((txs[0] as { ops: PageOpCall[] }).ops[0]).toMatchObject({ op: "footprint.move", tracks: "attached", dx: 500_000 });
    expect(sent.some((r) => r.method === "releaseHold")).toBe(true);
  });

  it("a cancelled drag puts the preview back and writes nothing", async () => {
    const { svc, session, ctl } = rig();
    const x0 = (session.confirmed().doc.records.get("fp:power/ldo") as { x: number }).x;
    ctl.startDrag({ kind: "footprint", ids: ["fp:power/ldo"] });
    ctl.moveDrag(800_000, 0);
    expect(await ctl.endDrag(true, "move LDO by hand")).toBeUndefined();
    expect((session.snapshot().doc.records.get("fp:power/ldo") as { x: number }).x).toBe(x0);
    expect(svc.snapshot().seq).toBe(0);
  });
});
