/** DSN and SES round trips on synthetic boards, and SimpleRouteJson conversion both ways. */
import { describe, expect, it } from "vitest";
import { copperLayers, createDocument, mm, padsOf, recordsOfKind, type BoardRecord, type TrackRec } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { buildJob, child, children, jobToDsn, jobToSrj, netOfConnection, parseSes, parseSExpr, parseViaPadstackName, resolutionScale, routedToOps, srjTracesToRouted, viaPadstackName, type RouteJob, type SNode, type SrjTrace } from "../src/index.js";
import { baseRecords, chip, easyBoard, fp, netlist, rect, smd, th, track } from "./helpers.js";

const jobFor = (doc: ReturnType<typeof easyBoard>, scope: RouteJob["scope"] = { kind: "open" }): RouteJob => ({ ...buildJob(doc, { scope }), unexpressed: [] });

/** A board exercising the DSN writer: a bottom footprint turned 90 degrees, through-hole and oval pads, locked and unlocked copper, other nets' copper, typed keep-outs. */
function mixedBoard() {
  const recs: BoardRecord[] = [
    ...baseRecords(),
    chip("R1", -8, 4),
    chip("R2", 0, 4, { side: "bottom", rotation: 90_000 }),
    fp("J1", 8, 4, [th("1", 0, 0), { number: "2", type: "th", shape: "oval", x: mm(2.54), y: 0, outer_width: mm(1.2), outer_height: mm(2), hole_width: mm(0.6), hole_height: mm(1.2) }]),
    chip("R3", -8, -4),
    chip("R4", 0, -4),
    fp("H1", 10, -6, [{ number: "MH", type: "np", shape: "circle", x: 0, y: 0, hole_diameter: mm(3) }]),
    track("lockedA", "A", "top", 0.3, [-7.2, 4], [-5, 4], { locked: true }),
    track("openA", "A", "top", 0.3, [-5, 4], [-4, 5]),
    track("otherC", "C", "top", 0.3, [-7.2, -4], [-5, -4]),
    { kind: "via", id: "via:c1", net: "C", x: mm(-5), y: mm(-4), outer_diameter: mm(0.6), hole_diameter: mm(0.3), from_layer: "top", to_layer: "bottom", provenance: { by: "hand" } },
    { kind: "keepout", id: "kpo:tracks", outline: rect(2, 2, 4, 0), layers: ["top"], blocks: { tracks: true, vias: false, pours: false, footprints: false }, tier: "no_go", provenance: { by: "hand" } },
    { kind: "keepout", id: "kpo:pour", outline: rect(2, 2, -4, 0), layers: ["top", "bottom"], blocks: { tracks: false, vias: false, pours: true, footprints: false }, tier: "no_go", provenance: { by: "hand" } },
    { kind: "keepout", id: "kpo:pref", outline: rect(2, 2, 0, 0), layers: ["top"], blocks: { tracks: true, vias: true, pours: true, footprints: false }, tier: "policy", provenance: { by: "hand" } },
  ];
  return createDocument(recs, netlist({ A: ["R1.2", "R2.1"], B: ["R2.2", "J1.1", "J1.2"], C: ["R3.2", "R4.1"] }));
}

const um = (s: SNode) => Number(s) * 1000; // file units are micrometers

describe("Specctra DSN writer", () => {
  const doc = mixedBoard();
  const job = jobFor(doc, { kind: "nets", nets: ["A", "B"] });
  const out = jobToDsn(job);
  const tree = parseSExpr(out.text)[0] as SNode[];

  it("is a parseable pcb with the stack, boundary, rules and via", () => {
    expect(tree[0]).toBe("pcb");
    const structure = child(tree, "structure")!;
    expect(children(structure, "layer").map((l) => [l[1], child(l, "type")![1]])).toEqual([
      ["top", "signal"],
      ["bottom", "signal"],
    ]);
    const boundary = child(child(structure, "boundary"), "path")!;
    expect(boundary.slice(0, 3)).toEqual(["path", "pcb", "0"]);
    expect(child(structure, "via")![1]).toBe(viaPadstackName(mm(0.6), mm(0.3)));
    const rule = child(structure, "rule")!;
    expect(child(rule, "width")![1]).toBe("250");
    expect(child(rule, "clearance")![1]).toBe("200");
    expect(out.via).toEqual({ name: "pbvia_600000_300000", outer: mm(0.6), hole: mm(0.3) });
  });

  it("puts every pad at its world position on its world layer (bottom, rotated footprints too)", () => {
    const placement = new Map(children(child(tree, "placement"), "component").map((c) => [String(child(c, "place")![1]), child(c, "place")!]));
    const library = child(tree, "library")!;
    const images = new Map(children(library, "image").map((i) => [String(i[1]), children(i, "pin")]));
    const stacks = new Map(children(library, "padstack").map((p) => [String(p[1]), children(p, "shape").map((s) => (s[1] as SNode[])[1])]));
    let checked = 0;
    for (const f of recordsOfKind(doc, "footprint")) {
      const place = placement.get(f.ref)!;
      expect(place[4]).toBe("front");
      expect(place[5]).toBe("0");
      const pins = images.get(`img_${f.ref}`)!;
      for (const wp of padsOf(f, copperLayers(doc))) {
        if (wp.pad.type === "np") continue;
        const pin = pins.find((p) => p[2] === (/^[A-Za-z0-9_]+$/.test(wp.key) ? wp.key : `p${f.pads.indexOf(wp.pad)}`))!;
        expect(Math.abs(um(place[2]) + um(pin[3]) - wp.x)).toBeLessThanOrEqual(100);
        expect(Math.abs(um(place[3]) + um(pin[4]) - wp.y)).toBeLessThanOrEqual(100);
        expect(stacks.get(String(pin[1]))).toEqual(wp.pad.type === "smd" ? wp.layers : ["top", "bottom"]);
        checked++;
      }
    }
    expect(checked).toBe(10);
    // R2 is on the bottom: its pads' shapes are on the bottom layer, and turned 90 degrees (0.9 wide, 0.8 tall)
    const r2 = images.get("img_R2")!;
    const shape = (children(child(library, "padstack") && children(library, "padstack").find((p) => p[1] === r2[0][1])!, "shape")[0][1]) as SNode[];
    expect(shape[0]).toBe("rect");
    expect(shape[1]).toBe("bottom");
    expect([Number(shape[4]) - Number(shape[2]), Number(shape[5]) - Number(shape[3])]).toEqual([900, 800]);
  });

  it("writes nets in scope with their pins and classes, and leaves other nets' pins out", () => {
    const network = child(tree, "network")!;
    const nets = Object.fromEntries(children(network, "net").map((n) => [String(n[1]), (child(n, "pins") ?? []).slice(1)]));
    expect(nets).toEqual({ A: ["R1-2", "R2-1"], B: ["J1-1", "J1-2", "R2-2"] });
    const cls = children(network, "class");
    expect(cls).toHaveLength(1);
    expect(cls[0].slice(2, 4)).toEqual(["A", "B"]);
  });

  it("wires in-scope copper as fix (locked) or protect, and other copper as keep-outs", () => {
    const wiring = child(tree, "wiring")!;
    const wires = children(wiring, "wire").map((w) => [child(w, "net")![1], child(w, "type")![1]]);
    expect(wires).toEqual([
      ["A", "fix"],
      ["A", "protect"],
    ]);
    const structure = child(tree, "structure")!;
    const keepIds = (kind: string) => children(structure, kind).map((k) => String(k[1]));
    expect(keepIds("keepout")).toEqual(expect.arrayContaining(["trk:otherC", "via:c1", "pad:H1:MH"]));
    expect(keepIds("wire_keepout")).toEqual(["kpo:tracks"]);
    expect(keepIds("keepout")).not.toContain("kpo:pour");
    expect(keepIds("keepout")).not.toContain("kpo:pref");
    expect(out.unexpressed.join("\n")).toMatch(/kpo:pour blocks only pours/);
    expect(out.unexpressed.join("\n")).toMatch(/policy keep-out kpo:pref is a cost/);
  });

  it("aliases a net name a DSN string cannot hold", () => {
    const d = createDocument([...baseRecords(), chip("R1", -2, 0), chip("R2", 2, 0)], netlist({ 'say "hi"': ["R1.2", "R2.1"] }));
    const r = jobToDsn(jobFor(d));
    expect([...r.nets]).toEqual([["pb_net_0", 'say "hi"']]);
    expect(r.text).not.toContain('say "hi"');
  });

  it("names via padstacks with their sizes and reads them back", () => {
    expect(parseViaPadstackName(viaPadstackName(450_000, 200_000))).toEqual({ outer: 450_000, hole: 200_000 });
    expect(parseViaPadstackName(viaPadstackName(450_000, 200_000, ["top", "inner1"]))).toEqual({ outer: 450_000, hole: 200_000, layers: ["top", "inner1"] });
  });
});

/** A session file as Freerouting writes one (resolution um 10). */
function writeSes(nets: { name: string; wires: { layer: string; width: number; pts: [number, number][]; type?: string }[]; vias: { name: string; x: number; y: number; type?: string }[] }[]): string {
  const v = (nmv: number) => String(Math.round(nmv / 100));
  const lines = ["(session board", "  (base_design board)", "  (routes", "    (resolution um 10)", "    (parser (host_cad Protoboard) (host_version \"0\"))", "    (library_out", '      (padstack "pbvia_600000_300000" (shape (circle top 6000 0 0)) (shape (circle bottom 6000 0 0)) (attach off))', "    )", "    (network_out"];
  for (const n of nets) {
    lines.push(`      (net ${/\s/.test(n.name) ? `"${n.name}"` : n.name}`);
    for (const w of n.wires) lines.push(`        (wire (path ${w.layer} ${v(w.width)} ${w.pts.map(([x, y]) => `${v(x)} ${v(y)}`).join(" ")})${w.type ? ` (type ${w.type})` : ""})`);
    for (const x of n.vias) lines.push(`        (via "${x.name}" ${v(x.x)} ${v(x.y)}${x.type ? ` (type ${x.type})` : ""})`);
    lines.push("      )");
  }
  lines.push("    )", "  )", ")");
  return lines.join("\n");
}

describe("Specctra SES reader", () => {
  it("round trips routed copper: board tracks to a session and back to the same operations", () => {
    const doc = easyBoard();
    const tracks = [
      { net: "A", layer: "top", width: mm(0.25), start: { x: mm(-7.2), y: mm(4) }, end: { x: mm(-4), y: mm(4) } },
      { net: "A", layer: "top", width: mm(0.25), start: { x: mm(-4), y: mm(4) }, end: { x: mm(-0.8), y: mm(4) } },
      { net: "E", layer: "bottom", width: mm(0.3), start: { x: mm(-8.8), y: mm(4) }, end: { x: mm(-8.8), y: mm(-4) } },
    ];
    const ses = writeSes([
      { name: "A", wires: [{ layer: "top", width: mm(0.25), pts: [[mm(-7.2), mm(4)], [mm(-4), mm(4)], [mm(-0.8), mm(4)]] }, { layer: "top", width: mm(0.3), pts: [[mm(-9), mm(9)], [mm(-8), mm(9)]], type: "protect" }], vias: [] },
      { name: "E", wires: [{ layer: "bottom", width: mm(0.3), pts: [[mm(-8.8), mm(4)], [mm(-8.8), mm(-4)]] }], vias: [{ name: "pbvia_600000_300000", x: mm(-8.8), y: mm(4) }, { name: "pbvia_600000_300000", x: mm(-8.8), y: mm(-4), type: "fix" }] },
      { name: "Z", wires: [{ layer: "top", width: mm(0.25), pts: [[0, 0], [mm(1), 0]] }], vias: [] },
    ]);
    const nets = new Map([
      ["A", "A"],
      ["E", "E"],
    ]);
    const read = parseSes(ses, nets, ["top", "bottom"], mm(0.3));
    expect(read.segments).toEqual(tracks);
    expect(read.vias).toEqual([{ net: "E", x: mm(-8.8), y: mm(4), outer: mm(0.6), hole: mm(0.3), from: "top", to: "bottom" }]);
    expect(read.skipped).toBe(2);
    expect(read.messages).toEqual(["1 net(s) in the session are not in this job; their copper was not read"]);
    const ops = routedToOps(doc, read.segments, read.vias);
    expect(ops.ops).toEqual([
      { op: "track.add", segments: tracks.map((t) => ({ net: t.net, layer: t.layer, width: t.width, start: t.start, end: t.end })) },
      { op: "via.add", vias: [{ net: "E", x: mm(-8.8), y: mm(4), outer_diameter: mm(0.6), hole_diameter: mm(0.3) }] },
    ]);
  });

  it("reads quoted net names and other resolutions", () => {
    expect(resolutionScale(["resolution", "mil", "10"])).toBe(2540);
    expect(resolutionScale(["resolution", "mm", "1000"])).toBe(1000);
    const read = parseSes(writeSes([{ name: "N 2", wires: [{ layer: "top", width: mm(0.2), pts: [[0, 0], [mm(1), mm(1)]] }], vias: [] }]), new Map([["N 2", "N 2"]]), ["top", "bottom"], mm(0.3));
    expect(read.segments).toHaveLength(1);
    expect(read.segments[0].net).toBe("N 2");
  });

  it("drops copper that repeats what the board has", () => {
    const doc = easyBoard([track("a1", "A", "top", 0.25, [-7.2, 4], [-0.8, 4])]);
    const ops = routedToOps(doc, [{ net: "A", layer: "top", width: mm(0.25), start: { x: mm(-0.8), y: mm(4) }, end: { x: mm(-7.2), y: mm(4) } }], []);
    expect(ops.ops).toEqual([]);
  });
});

describe("SimpleRouteJson conversion", () => {
  it("writes connections per net with one point per island, and obstacles for pads, copper and keep-outs", () => {
    const doc = mixedBoard();
    const job = jobFor(doc, { kind: "nets", nets: ["A", "B"] });
    const { srj, nets, unexpressed } = jobToSrj(job);
    expect(srj.layerCount).toBe(2);
    expect(srj.connections.map((c) => [c.name, nets.get(c.name), c.pointsToConnect.length])).toEqual([
      ["pbn0x", "A", 2],
      ["pbn1x", "B", 3],
    ]);
    // the through-hole pads of J1 can be reached on both layers
    expect(srj.connections[1].pointsToConnect.filter((p) => "layers" in p)).toHaveLength(2);
    expect(srj.minTraceWidth).toBe(0.127);
    expect(srj.connections[0].nominalTraceWidth).toBe(0.25);
    expect(srj.defaultObstacleMargin).toBe(0.2);
    expect(srj.minViaDiameter).toBe(0.6);
    expect(srj.minViaHoleDiameter).toBe(0.3);
    expect(srj.allowViaInPad).toBe(false);
    expect(srj.bounds).toEqual({ minX: -15, maxX: 15, minY: -10, maxY: 10 });
    const ob = (id: string) => srj.obstacles.find((o) => o.obstacleId === id)!;
    // R2 is on the bottom, turned 90 degrees: its pad is 0.9 by 0.8 on the bottom layer, touchable by net A
    expect(ob("pad:R2:1")).toMatchObject({ layers: ["bottom"], width: 0.9, height: 0.8, connectedTo: ["pbn0x"] });
    expect(ob("pad:R3:2")).toMatchObject({ connectedTo: [] });
    expect(ob("trk:lockedA#0.0")).toMatchObject({ layers: ["top"], connectedTo: ["pbn0x"] });
    expect(ob("trk:otherC#0.0")).toMatchObject({ connectedTo: [] });
    expect(ob("pad:H1:MH")).toMatchObject({ shape: "circle", isNonPlatedHole: true, layers: ["top", "bottom"] });
    expect(srj.obstacles.some((o) => o.obstacleId?.startsWith("kpo:tracks"))).toBe(false);
    expect(unexpressed.join("\n")).toMatch(/kpo:tracks blocks only tracks/);
    expect(srj.obstacles.filter((o) => o.obstacleId?.startsWith("trk:openA")).length).toBeGreaterThan(1);
  });

  it("reads traces back: wires to segments, vias with the job's sizes, suffixed connection names", () => {
    const nets = new Map([["pbn0x", "A"]]);
    expect(netOfConnection("pbn0x_mst1_0", nets)).toBe("A");
    expect(netOfConnection("pbn01x", nets)).toBeUndefined();
    const traces: SrjTrace[] = [
      {
        type: "pcb_trace",
        pcb_trace_id: "t0",
        connection_name: "pbn0x_mst0",
        route: [
          { route_type: "wire", x: -7.2, y: 4, width: 0.25, layer: "top" },
          { route_type: "wire", x: -4, y: 4, width: 0.25, layer: "top" },
          { route_type: "via", x: -4, y: 4, from_layer: "top", to_layer: "bottom" },
          { route_type: "wire", x: -4, y: 4, width: 0.25, layer: "bottom" },
          { route_type: "wire", x: -0.8, y: 4, width: 0.25, layer: "bottom" },
          { route_type: "jumper", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, footprint: "0603", layer: "top" },
        ],
      },
    ];
    const r = srjTracesToRouted(traces, nets, { outer: mm(0.6), hole: mm(0.3) });
    expect(r.segments).toEqual([
      { net: "A", layer: "top", width: mm(0.25), start: { x: mm(-7.2), y: mm(4) }, end: { x: mm(-4), y: mm(4) } },
      { net: "A", layer: "bottom", width: mm(0.25), start: { x: mm(-4), y: mm(4) }, end: { x: mm(-0.8), y: mm(4) } },
    ]);
    expect(r.vias).toEqual([{ net: "A", x: mm(-4), y: mm(4), outer: mm(0.6), hole: mm(0.3), from: "top", to: "bottom" }]);
    expect(r.messages[0]).toMatch(/1 jumper/);
  });

  it("converts the Airnode C3 fixture: pour nets left to the pour, locked hand copper as an obstacle of its net", () => {
    const doc = airnodeC3();
    const job = buildJob(doc, { scope: { kind: "open" } });
    expect(job.notes.join(" ")).toContain("GND");
    const { srj, nets } = jobToSrj(job);
    expect([...nets.values()]).not.toContain("GND");
    expect([...nets.values()]).toContain("VBUS");
    const vbus = [...nets].find(([, n]) => n === "VBUS")![0];
    const hand = srj.obstacles.find((o) => o.obstacleId === "trk:f.vbus.1#0.0")!;
    expect(hand.connectedTo).toEqual([vbus]);
    // the I2C_SCL track on the bottom touches no pad of its net (its pads are on the top): a plain obstacle, or the
    // router would end a route on it and take that for the pad
    expect(srj.obstacles.filter((o) => o.obstacleId?.startsWith("trk:f.i2c_scl.1#")).every((o) => o.connectedTo.length === 0)).toBe(true);
    // the antenna keep-out blocks tracks and vias on both layers: an obstacle
    expect(srj.obstacles.find((o) => o.obstacleId === "kpo:f.antenna#0")!.layers).toEqual(["top", "bottom"]);
    expect(job.locked).toEqual(expect.arrayContaining(["trk:f.vbus.1", "trk:f.vbus.2", "fp:usb/connector"]));
    void (doc.records.get("trk:f.vbus.1") as TrackRec);
  });
});

describe("Specctra reader", () => {
  it("handles string_quote, quoted names with spaces and nesting", () => {
    const t = parseSExpr('(pcb x (parser (string_quote ") (space_in_quoted_tokens on)) (net "N 2" (pins A-1)))');
    expect(t).toEqual([["pcb", "x", ["parser", ["string_quote", '"'], ["space_in_quoted_tokens", "on"]], ["net", "N 2", ["pins", "A-1"]]]]);
    expect(() => parseSExpr("(a (b)")).toThrow(/unbalanced/);
  });
  void smd;
});
