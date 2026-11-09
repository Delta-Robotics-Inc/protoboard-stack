/** Each rule check on small boards with known answers, and the four-tier resolution. */
import { describe, expect, it } from "vitest";
import { FindingSchema, mm, runChecks, type BoardRecord, type BoardSnapshot } from "@protoboardai/board";
import { createBoardChecks, RuleBook, runBoardChecks } from "../src/index.js";
import { boardRecords, fp, makeDoc, P, rectV, rule, smd, th, trk, via } from "./helpers.js";

/** Two parallel tracks of nets N1 and N2, `gap` mm apart edge to edge (0.2 mm wide). */
const pair = (gap: number, n1 = "N1", n2 = "N2"): BoardRecord[] => [trk("a", n1, "top", 0.2, [-5, 0], [5, 0]), trk("b", n2, "top", 0.2, [-5, gap + 0.2], [5, gap + 0.2])];
const run = (records: BoardRecord[], nets: Record<string, string[]> = {}) => runBoardChecks(makeDoc([...boardRecords(), ...records], nets));
const of = (r: ReturnType<typeof run>, check: string) => r.findings.filter((f) => f.check === check);

describe("rule tiers", () => {
  const tiers = [rule("floor", "floor", "clearance", 0.1), rule("target", "target", "clearance", 0.2)];

  it("below target but above floor: a warning from the target rule", () => {
    const f = of(run([...pair(0.15), ...tiers]), "clearance");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "warning", rule: "rule:target", tier: "target", measured: mm(0.15), required: mm(0.2), objects: ["trk:a", "trk:b"] });
    expect(f[0].location.layer).toBe("top");
    expect(f[0].message).toBe("Clearance 0.1500 mm between trk:a (net N1) and trk:b (net N2) on top is below 0.2000 mm (rule:target, target).");
  });

  it("below floor: an error from the floor alone", () => {
    const f = of(run([...pair(0.05), ...tiers]), "clearance");
    expect(f.map((x) => [x.severity, x.rule, x.required])).toEqual([["error", "rule:floor", mm(0.1)]]);
  });

  it("the floor is the largest matching min", () => {
    const f = of(run([...pair(0.15), rule("f1", "floor", "clearance", 0.1), rule("f2", "floor", "clearance", 0.2)]), "clearance");
    expect(f.map((x) => x.rule)).toEqual(["rule:f2"]);
  });

  it("target: the most specific rule wins (class over global)", () => {
    const recs = [...pair(0.25, "VCC", "N2"), rule("t", "target", "clearance", 0.2), rule("t_power", "target", "clearance", 0.3, { classes: ["power"] }), { kind: "netclass", id: "class:power", name: "power", nets: ["VCC"] } as BoardRecord];
    const f = of(run(recs), "clearance");
    expect(f.map((x) => [x.rule, x.required])).toEqual([["rule:t_power", mm(0.3)]]);
    // without a power net the global target applies and 0.25 passes
    expect(of(run([...pair(0.25), rule("t", "target", "clearance", 0.2), rule("t_power", "target", "clearance", 0.3, { classes: ["power"] })]), "clearance")).toEqual([]);
  });

  it("a region rule applies only inside its region", () => {
    const recs = [...pair(0.25), rule("g", "floor", "clearance", 0.1), rule("r", "target", "clearance", 0.5, { region: rectV(2, 2, 4, 0) })];
    const f = of(run(recs), "clearance");
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe("rule:r");
    // away from the region the same pair passes
    expect(of(run([...pair(0.25), rule("g", "floor", "clearance", 0.1), rule("r", "target", "clearance", 0.5, { region: rectV(2, 2, 4, 5) })]), "clearance")).toEqual([]);
  });

  it("policy rules warn with their cost; no-go rules are errors; severity overrides; ignore drops", () => {
    const pol = of(run([...pair(0.15), rule("p", "policy", "clearance", 0.2, {}, { cost: 3 })]), "clearance");
    expect(pol[0]).toMatchObject({ severity: "warning", tier: "policy" });
    expect(pol[0].message).toContain("cost 3");
    expect(of(run([...pair(0.15), rule("n", "no_go", "clearance", 0.2)]), "clearance")[0]).toMatchObject({ severity: "error", tier: "no_go" });
    expect(of(run([...pair(0.15), rule("t", "target", "clearance", 0.2, {}, { severity: "error" })]), "clearance")[0].severity).toBe("error");
    expect(of(run([...pair(0.05), rule("f", "floor", "clearance", 0.1, {}, { severity: "ignore" })]), "clearance")).toEqual([]);
    expect(of(run([...pair(0.05), rule("f", "floor", "clearance", 0.1, {}, { enabled: false })]), "clearance")).toEqual([]);
  });

  it("nets and between narrow a rule", () => {
    expect(of(run([...pair(0.05), rule("f", "floor", "clearance", 0.1, { nets: ["OTHER"] })]), "clearance")).toEqual([]);
    expect(of(run([...pair(0.05), rule("f", "floor", "clearance", 0.1, { nets: ["N2"] })]), "clearance")).toHaveLength(1);
    expect(of(run([...pair(0.05), rule("f", "floor", "clearance", 0.1, { between: ["pad", "track"] })]), "clearance")).toEqual([]);
    expect(of(run([...pair(0.05), rule("f", "floor", "clearance", 0.1, { between: ["track", "track"] })]), "clearance")).toHaveLength(1);
  });
});

describe("size checks", () => {
  it("track width against min and max", () => {
    const recs = [trk("thin", "N1", "top", 0.15, [-5, 0], [5, 0]), trk("wide", "N1", "top", 1.5, [-5, 3], [5, 3]), rule("f", "floor", "track_width", 0.127, {}, { max: mm(1) }), rule("t", "target", "track_width", 0.2)];
    const f = of(run(recs), "track_width");
    expect(f.map((x) => [x.objects[0], x.severity, x.measured, x.required])).toEqual([
      ["trk:wide", "error", mm(1.5), mm(1)],
      ["trk:thin", "warning", mm(0.15), mm(0.2)],
    ]);
  });

  it("via diameter, via hole and annular ring (vias and plated pads)", () => {
    const recs = [via("v", "N1", 0, 0, 0.45, 0.3), fp("J", 5, 0, [th("1", 0, 0, 1.0, 0.9)]), rule("d", "floor", "via_diameter", 0.5), rule("h", "floor", "via_hole", 0.2), rule("ar", "floor", "annular_ring", 0.1)];
    const r = run(recs);
    expect(of(r, "via_diameter").map((x) => [x.objects[0], x.measured])).toEqual([["via:v", mm(0.45)]]);
    expect(of(r, "via_hole")).toEqual([]);
    expect(of(r, "annular_ring").map((x) => [x.objects[0], x.measured]).sort()).toEqual([
      ["pad:J:1", mm(0.05)],
      ["via:v", mm(0.075)],
    ]);
  });
});

describe("hole checks", () => {
  it("hole to hole, edge to edge", () => {
    const f = of(run([via("a", "N1", 0, 0, 0.45, 0.3), via("b", "N2", 0.5, 0, 0.45, 0.3), rule("hh", "floor", "hole_to_hole", 0.25)]), "hole_to_hole");
    expect(f.map((x) => [x.objects, x.measured])).toEqual([[["via:a", "via:b"], mm(0.2)]]);
  });

  it("hole clearance to copper of another net, and of a non-plated hole to any copper", () => {
    const recs = [via("v", "N1", 0, 0, 0.5, 0.3), trk("t", "N2", "top", 0.2, [-3, 0.4], [3, 0.4]), fp("M", 0, 5, [{ number: "", type: "np", shape: "circle", x: 0, y: 0, hole_diameter: mm(1) }]), trk("u", "N1", "bottom", 0.2, [-3, 5.65], [3, 5.65]), rule("hc", "floor", "hole_clearance", 0.2)];
    const f = of(run(recs), "hole_clearance");
    expect(f.map((x) => [x.objects, x.measured])).toEqual([
      [["trk:t", "via:v"], mm(0.15)],
      [["pad:M:", "trk:u"], mm(0.05)],
    ]);
  });
});

describe("board edge", () => {
  it("near the edge, across it, outside it, and near a cutout", () => {
    const cut: BoardRecord = { kind: "cutout", id: "cutout:c", outline: rectV(2, 2, 0, 0), provenance: { by: "hand" } };
    const recs = [cut, trk("near", "N1", "top", 0.2, [-5, 9.6], [5, 9.6]), trk("hole", "N1", "top", 0.2, [-5, 1.3], [5, 1.3]), rule("e", "floor", "edge_clearance", 0.5)];
    const f = of(run(recs), "edge_clearance");
    expect(f.map((x) => [x.objects, x.measured]).sort()).toEqual([
      [["cutout:c", "trk:hole"], mm(0.2)],
      [["outline", "trk:near"], mm(0.3)],
    ]);
    // no rule: only copper across or outside the edge, as a built-in error
    const g = of(run([trk("across", "N1", "top", 0.2, [5, 0], [15, 0]), trk("out", "N1", "top", 0.2, [12, 5], [15, 5]), trk("in", "N1", "top", 0.2, [-5, 9.6], [5, 9.6])]), "edge_clearance");
    expect(g.map((x) => [x.objects[1], x.severity, x.rule])).toEqual([
      ["trk:across", "error", undefined],
      ["trk:out", "error", undefined],
    ]);
    expect(g.find((x) => x.objects.includes("trk:out"))!.message).toContain("outside the board outline");
  });
});

describe("footprints and silkscreen", () => {
  const withCourt = (ref: string, x: number, y: number, w: number, h: number) => fp(ref, x, y, [smd("1", 0, 0, 0.5, 0.5)], { courtyard: rectV(w, h) });

  it("overlapping courtyards are errors by default; touching ones are not", () => {
    const f = of(run([withCourt("A", 0, 0, 2, 2), withCourt("B", 1.5, 0, 2, 2), withCourt("C", 5, 0, 2, 2), withCourt("D", 7, 0, 2, 2)]), "courtyard_overlap");
    expect(f.map((x) => [x.objects, x.severity, x.rule])).toEqual([[["fp:A", "fp:B"], "error", undefined]]);
    const g = of(run([withCourt("A", 0, 0, 2, 2), withCourt("B", 1.5, 0, 2, 2), rule("co", "policy", "courtyard_overlap", undefined, {}, { cost: 1 })]), "courtyard_overlap");
    expect(g.map((x) => [x.severity, x.rule])).toEqual([["warning", "rule:co"]]);
  });

  it("courtyards on opposite sides do not overlap", () => {
    expect(of(run([withCourt("A", 0, 0, 2, 2), { ...withCourt("B", 0.5, 0, 2, 2), side: "bottom" }]), "courtyard_overlap")).toEqual([]);
  });

  it("silkscreen over a pad: a warning by default, the rule's min with a rule", () => {
    const line = (y: number) => fp("R", 0, 0, [smd("1", 0, 0, 1, 1)], { graphics: [{ layer: "top_silkscreen", shape: "line", start: P(-2, y), end: P(2, y), stroke_width: mm(0.1) }] });
    expect(of(run([line(0.3)]), "silk_to_pad").map((x) => [x.severity, x.measured])).toEqual([["warning", 0]]);
    expect(of(run([line(0.6)]), "silk_to_pad")).toEqual([]);
    const f = of(run([line(0.6), rule("s", "floor", "silk_to_pad", 0.15)]), "silk_to_pad");
    expect(f.map((x) => [x.severity, x.measured, x.rule])).toEqual([["error", mm(0.05), "rule:s"]]);
    // a bottom footprint's silkscreen is on the bottom and meets bottom pads
    const b = of(run([{ ...line(0.3), side: "bottom" }]), "silk_to_pad");
    expect(b.map((x) => x.location.layer)).toEqual(["bottom_silkscreen"]);
  });
});

describe("via policies and keep-outs", () => {
  const usb: BoardRecord = { kind: "netclass", id: "class:usb", name: "usb", patterns: ["USB_*"] };

  it("via in pad, under a no-go rule for one class", () => {
    const recs = [usb, fp("J", 0, 0, [smd("1", 0, 0, 1, 1), smd("2", 3, 0, 1, 1)]), via("v1", "USB_DP", 0, 0), via("v2", "GND", 3, 0), rule("vip", "no_go", "via_in_pad", undefined, { classes: ["usb"] })];
    const f = of(run(recs, { USB_DP: ["J.1"], GND: ["J.2"] }), "via_in_pad");
    expect(f.map((x) => [x.objects, x.severity])).toEqual([[["pad:J:1", "via:v1"], "error"]]);
  });

  it("via under a footprint, as a policy with a cost", () => {
    const recs = [fp("U", 0, 0, [smd("1", -2, 0, 0.5, 0.5)], { courtyard: rectV(6, 4) }), via("v", "N1", 1, 1), via("w", "N1", 5, 5), rule("vuf", "policy", "via_under_footprint", undefined, {}, { cost: 5 })];
    const f = of(run(recs), "via_under_footprint");
    expect(f.map((x) => [x.objects, x.severity])).toEqual([[["fp:U", "via:v"], "warning"]]);
    expect(f[0].message).toContain("cost 5");
  });

  it("keep-outs block what they name, at their tier", () => {
    const kpo = (id: string, tier: "no_go" | "policy", blocks: { tracks: boolean; vias: boolean; pours: boolean; footprints: boolean }): BoardRecord => ({ kind: "keepout", id, outline: rectV(4, 4, 5, 5), layers: ["top", "bottom"], blocks, tier, provenance: { by: "hand" } });
    const recs = [kpo("kpo:t", "no_go", { tracks: true, vias: false, pours: false, footprints: false }), kpo("kpo:v", "policy", { tracks: false, vias: true, pours: false, footprints: true }), trk("x", "N1", "top", 0.2, [0, 5], [8, 5]), via("v", "N1", 5, 6), fp("U", 6, 6, [smd("1", 0, 0, 0.5, 0.5)], { courtyard: rectV(2, 2) })];
    const f = of(run(recs), "keepout");
    expect(f.map((x) => [x.objects, x.severity, x.tier])).toEqual([
      [["kpo:t", "trk:x"], "error", "no_go"],
      [["fp:U", "kpo:v"], "warning", "policy"],
      [["kpo:v", "via:v"], "warning", "policy"],
    ]);
  });
});

describe("findings", () => {
  const recs = [...pair(0.05), rule("f", "floor", "clearance", 0.1), trk("d", "N1", "top", 0.2, [-5, -3], [0, -3])];

  it("have the contract's shape and stable ids", () => {
    const a = run(recs);
    for (const f of a.findings) expect(FindingSchema.safeParse(f).success).toBe(true);
    const b = run(recs);
    expect(b.findings.map((f) => f.id)).toEqual(a.findings.map((f) => f.id));
    expect(a.findings[0].id).toMatch(/^f:[\w.-]+:[0-9a-f]{12}$/);
    // sorted: errors first, then by id
    expect(a.findings.map((f) => f.severity)).toEqual([...a.findings.map((f) => f.severity)].sort((x, y) => (x === y ? 0 : x === "error" ? -1 : y === "error" ? 1 : x < y ? -1 : 1)));
  });

  it("the contract's Check objects give the same findings through runChecks", () => {
    const doc = makeDoc([...boardRecords(), ...recs]);
    const snap = { epoch: "e", seq: 3, doc, version: () => 1, query: undefined as never } as BoardSnapshot;
    expect(runChecks(snap, createBoardChecks())).toEqual(runBoardChecks(snap).findings);
    expect(runBoardChecks(snap)).toMatchObject({ epoch: "e", seq: 3 });
  });

  it("a region keeps only findings that meet it", () => {
    const r = runBoardChecks(makeDoc([...boardRecords(), ...recs]), { region: { minX: mm(-6), minY: mm(-4), maxX: mm(1), maxY: mm(-2) } });
    // both ends of trk:d, and the link joining it to trk:a (N1 has two islands)
    expect(r.findings.map((f) => f.check).sort()).toEqual(["dangling", "dangling", "unconnected"]);
  });
});

describe("measurement details", () => {
  it("compares at whole nanometers", () => {
    const book = new RuleBook(makeDoc([...boardRecords(), rule("f", "floor", "clearance", 0.1)]));
    const s = { nets: ["N1", "N2"], kinds: ["track", "track"] as ["track", "track"], at: { x: 0, y: 0 } };
    expect(book.evaluate("clearance", 99_999.6, s)).toEqual([]);
    expect(book.evaluate("clearance", 99_999.4, s).map((v) => v.rule)).toEqual(["rule:f"]);
  });

  it("clearance between copper carrying the same net by contact is not checked", () => {
    const recs = [fp("A", 0, 0, [smd("1", 0, 0, 1, 1)]), trk("nn", undefined, "top", 0.2, [0, 0], [3, 0]), trk("n2", "N1", "top", 0.2, [0, 0.35], [3, 0.35]), rule("f", "floor", "clearance", 0.2)];
    expect(of(run(recs, { N1: ["A.1"] }), "clearance")).toEqual([]);
  });

  it("a zone's own clearance warns when its fill is nearer than it asks and no rule reports the pair", () => {
    const z: BoardRecord = { kind: "zone", id: "zone:g", net: "GND", layers: ["top"], outline: rectV(10, 10), priority: 0, clearance: mm(0.3), pad_connection: "solid", fill_mode: "solid", remove_islands: "never", provenance: { by: "hand" } };
    const doc = makeDoc([...boardRecords(), z, trk("t", "N1", "top", 0.2, [-3, 2.25], [3, 2.25]), rule("f", "floor", "clearance", 0.1)]);
    const f = runBoardChecks(doc, { fills: [{ zone: "zone:g", layer: "top", polygons: [{ outline: rectV(8, 4, 0, 0) }] }] }).findings.filter((x) => x.check === "clearance");
    expect(f.map((x) => [x.severity, x.measured, x.required])).toEqual([["warning", mm(0.15), mm(0.3)]]);
  });

  it("fill clipped at a keep-out's edge is not inside it", () => {
    const kpo: BoardRecord = { kind: "keepout", id: "kpo:k", outline: rectV(2, 2, 3, 0), layers: ["top"], blocks: { tracks: true, vias: true, pours: true, footprints: false }, tier: "no_go", provenance: { by: "hand" } };
    const z: BoardRecord = { kind: "zone", id: "zone:g", net: "GND", layers: ["top"], outline: rectV(10, 10), priority: 0, pad_connection: "solid", fill_mode: "solid", remove_islands: "never", provenance: { by: "hand" } };
    const doc = makeDoc([...boardRecords(), z, kpo]);
    const touching = runBoardChecks(doc, { fills: [{ zone: "zone:g", layer: "top", polygons: [{ outline: rectV(4, 4, 0, 0) }] }] });
    expect(touching.findings.filter((x) => x.check === "keepout")).toEqual([]);
    const inside = runBoardChecks(doc, { fills: [{ zone: "zone:g", layer: "top", polygons: [{ outline: rectV(4.5, 4, 0, 0) }] }] });
    expect(inside.findings.filter((x) => x.check === "keepout")).toHaveLength(1);
  });
});
