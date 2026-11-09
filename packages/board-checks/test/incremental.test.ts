/**
 * The incremental checks' property: after any sequence of edits, `update(...).result` equals a full
 * `runBoardChecks` of the same document (findings with their ids, content and order; the summary's counts and line;
 * connectivity; the input hash). Random edit sequences are applied through the board engine, as an editor applies
 * them, on the Airnode C3 fixture with its netlist and on a small four-layer board with a ground plane fill, rules
 * for every rule check, silkscreen, a keep-out and copper without a net.
 */
import { describe, expect, it } from "vitest";
import { copperLayers, createEngine, HUMAN, mm, recordsOfKind, type Actor, type BoardDocument, type BoardRecord, type OpCall, type Reply } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { createIncrementalChecks, runBoardChecks, type BoardCheckResult, type JoinRule, type ZoneFill } from "../src/index.js";
import { boardRecords, fp, makeDoc, P, rectV, rule, smd, th, trk, via, zone } from "./helpers.js";

const HOST: Actor = { kind: "host", id: "test" };

/** The changed ids of an applied reply. */
const changedOf = (reply: Reply): string[] => {
  if (reply.status !== "applied") throw new Error(`not applied: ${JSON.stringify(reply)}`);
  return reply.changed;
};
const GEN = { by: "generated" as const, tool: "test" };

/** A small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A four-layer board, 40 by 30 mm: six four-pad footprints with courtyards and silkscreen, a two-pin through-hole
 * connector, routes on the top and through vias on inner1, a ground plane on inner2 given as fill (antipads around
 * the signal vias and the connector's signal pin), a track without a net touching a routed track, a keep-out, a
 * silkscreen text and graphic, and a rule for every rule check.
 */
function smallBoard(): { records: BoardRecord[]; nets: Record<string, string[]>; fills: ZoneFill[] } {
  const records: BoardRecord[] = [...boardRecords({ layers: 4, w: 40, h: 30 })];
  const nets: Record<string, string[]> = { GND: ["J1.1"], NJ: ["J1.2"] };
  const at = (col: number, row: number) => ({ x: -12 + col * 10, y: -6 + row * 10 });
  const padAt = (col: number, row: number, k: number) => ({ x: at(col, row).x - 1.2, y: at(col, row).y - 1.5 + k });
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 3; col++) {
      const ref = `U${row * 3 + col + 1}`;
      const pads = [0, 1, 2, 3].map((k) => smd(String(k + 1), -1.2, -1.5 + k, 0.8, 0.5));
      records.push(
        fp(ref, at(col, row).x, at(col, row).y, pads, {
          courtyard: rectV(3.6, 4.4),
          graphics: [{ layer: "top_silkscreen", shape: "rect", center: P(0.4, 0), width: mm(2.2), height: mm(3.8), stroke_width: mm(0.12) }],
          texts: [{ layer: "top_silkscreen", text: ref, x: mm(0.4), y: mm(2.6), height: mm(0.8), role: "ref" }],
        }),
      );
    }
  records.push(fp("J1", 15, -10, [th("1", 0, 0, 1.7, 1), th("2", 0, 2.54, 1.7, 1)], { courtyard: rectV(3, 5.6, 0, 1.27) }));
  // antipads in the ground plane: x, y and radius (mm)
  const antipads: [number, number, number?][] = [[15, -10 + 2.54, 1.3]];
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < 4; k++) {
      const name = `N${row}${k}`;
      const a = padAt(0, row, k);
      const b = padAt(1, row, k);
      nets[name] = [`U${row * 3 + 1}.${k + 1}`, `U${row * 3 + 2}.${k + 1}`];
      if (k % 2) {
        records.push(trk(`${name}.1`, name, "top", 0.2, [a.x, a.y], [b.x, b.y]));
      } else {
        const x1 = a.x - 1;
        const x2 = b.x - 1;
        records.push(trk(`${name}.1`, name, "top", 0.2, [a.x, a.y], [x1, a.y]), via(`${name}.a`, name, x1, a.y, 0.5, 0.25), trk(`${name}.2`, name, "inner1", 0.2, [x1, a.y], [x2, b.y]), via(`${name}.b`, name, x2, b.y, 0.5, 0.25), trk(`${name}.3`, name, "top", 0.2, [x2, b.y], [b.x, b.y]));
        antipads.push([x1, a.y], [x2, b.y]);
      }
    }
  // the third column: pad 1 to ground through a via into the plane, pad 2 left unrouted to the connector's NJ
  for (let row = 0; row < 2; row++) {
    const p1 = padAt(2, row, 0);
    nets.GND.push(`U${row * 3 + 3}.1`);
    nets.NJ.push(`U${row * 3 + 3}.2`);
    records.push(trk(`gnd${row}.1`, "GND", "top", 0.3, [p1.x, p1.y], [p1.x - 1.5, p1.y]), via(`gnd${row}.v`, "GND", p1.x - 1.5, p1.y, 0.6, 0.3));
  }
  // copper without a net touching the end of a routed track: it carries that net
  const e = padAt(1, 1, 1);
  records.push(trk("free.0", undefined, "top", 0.2, [e.x, e.y], [e.x, e.y + 3]));
  // a chain without a net (two tracks and a via) ending on the middle of N11's track: all three carry N11, and
  // lose it when that track moves away, which changes clearance, hole clearance and track width findings of
  // objects that did not change themselves
  records.push(trk("free.1", undefined, "top", 0.2, [-8, 3.5], [-8, 6.5]), trk("free.2", undefined, "top", 0.2, [-8, 6.5], [-6, 6.5]), via("free.v", undefined, -6, 6.5, 0.5, 0.25));
  // copper of another net 0.15 mm from the chain; an N11 track and an N11 via near the chain whose clearance,
  // hole clearance and hole-to-hole results depend on whether the chain carries N11
  records.push(trk("near.1", "N00", "top", 0.2, [-6.6, 6.85], [-9, 6.85]), trk("near.2", "N11", "top", 0.2, [-5.6, 6], [-5.6, 7]), via("near.v", "N11", -6.55, 6.05, 0.5, 0.25));
  antipads.push([-6.3, 6.3, 0.9]);
  records.push(zone("gnd2", "GND", ["inner2"], rectV(38, 28)));
  records.push({ kind: "keepout", id: "kpo:t.area", outline: rectV(6, 4, 0, 12), layers: ["top", "bottom"], blocks: { tracks: true, vias: true, pours: false, footprints: true }, tier: "policy", name: "test area", provenance: GEN });
  records.push({ kind: "text", id: "txt:t.title", layer: "top_silkscreen", text: "TEST", x: mm(-15), y: mm(12), height: mm(1.2), stroke_width: mm(0.15), provenance: GEN });
  records.push({ kind: "graphic", id: "gfx:t.box", layer: "top_silkscreen", shape: "rect", center: P(-15, 12), width: mm(6), height: mm(2.5), stroke_width: mm(0.15), provenance: GEN });
  records.push(
    rule("clr", "floor", "clearance", 0.15),
    rule("clr_t", "target", "clearance", 0.2),
    rule("clr_n11", "target", "clearance", 0.3, { nets: ["N11"] }),
    rule("hh_same", "floor", "hole_to_hole", 0.5, { when: { same_net: true } }),
    rule("tw", "floor", "track_width", 0.15),
    rule("tw_n11", "target", "track_width", 0.25, { nets: ["N11"] }),
    rule("vd", "floor", "via_diameter", 0.45),
    rule("vh", "floor", "via_hole", 0.2),
    rule("ar", "floor", "annular_ring", 0.1),
    rule("hs", "floor", "hole_size", 0.2),
    rule("hh", "floor", "hole_to_hole", 0.3),
    rule("hc", "floor", "hole_clearance", 0.25),
    rule("edge", "floor", "edge_clearance", 0.4),
    rule("silk", "target", "silk_to_pad", 0.1),
    rule("vip", "policy", "via_in_pad", undefined, {}, { cost: 2 }),
    rule("vuf", "policy", "via_under_footprint", undefined, {}, { cost: 1 }),
  );
  const ring = ([x, y, r = 0.6]: [number, number, number?]) => Array.from({ length: 8 }, (_, k) => P(x + r * Math.cos((k * Math.PI) / 4), y + r * Math.sin((k * Math.PI) / 4)));
  const fills: ZoneFill[] = [{ zone: "zone:gnd2", layer: "inner2", polygons: [{ outline: rectV(37, 27), holes: antipads.map(ring) }] }];
  return { records, nets, fills };
}

interface Step {
  call: OpCall;
  actor: Actor;
  /** Expected to reach the whole board (a full run). */
  global: boolean;
}

/** A random edit of the board: copper, footprints, nets, silkscreen, and now and then a zone or a rule. */
function randomStep(doc: BoardDocument, r: () => number): Step | undefined {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const outline = doc.records.get("outline");
  const xs = outline?.kind === "outline" ? outline.outline.map((v) => v.x) : [-mm(10), mm(10)];
  const ys = outline?.kind === "outline" ? outline.outline.map((v) => v.y) : [-mm(10), mm(10)];
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const fps = recordsOfKind(doc, "footprint").map((f) => f.id);
  const tracks = recordsOfKind(doc, "track");
  const vias = recordsOfKind(doc, "via");
  const nets = [...doc.nets.keys()];
  const layers = copperLayers(doc);
  const pt = () => ({ x: int(box.minX, box.maxX), y: int(box.minY, box.maxY) });
  // a point where copper already is, so edits make and break contacts
  const hot = () => {
    if (r() < 0.4 || !tracks.length) return pt();
    const t = pick(tracks);
    const p = r() < 0.5 ? t.start : t.end;
    return { x: p.x + int(-100_000, 100_000), y: p.y + int(-100_000, 100_000) };
  };
  const step = (call: OpCall, global = false, actor: Actor = HUMAN): Step => ({ call, actor, global });
  // tracks without a net and the netted tracks they end on: edits there change carried nets of copper that
  // itself stays put
  const free = tracks.filter((t) => t.net === undefined);
  const segDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = dx * dx + dy * dy;
    const u = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
  };
  const chain = [...free, ...tracks.filter((s) => s.net !== undefined && s.sweep === undefined && free.some((t) => t.layer === s.layer && [t.start, t.end].some((p) => segDist(p, s.start, s.end) <= (s.width + t.width) / 2)))];
  const weights: [string, number][] = [
    ["chain", chain.length ? 2 : 0],
    ["tmove", 6],
    ["tadd", 4],
    ["tdel", tracks.length > 3 ? 2 : 0],
    ["vmove", vias.length ? 2 : 0],
    ["vadd", 2],
    ["vdel", vias.length > 1 ? 1 : 0],
    ["fmove", 2],
    ["frotate", 1],
    ["fflip", 0.5],
    ["net", 2],
    ["lock", 0.5],
    ["silk", 0.7],
    ["zone", 0.4],
    ["rule", 0.4],
  ];
  let x = r() * weights.reduce((s, w) => s + w[1], 0);
  let kind = weights[0][0];
  for (const [k, w] of weights) {
    if (x < w) {
      kind = k;
      break;
    }
    x -= w;
  }
  switch (kind) {
    case "chain": {
      const t = pick(chain);
      const what = r();
      if (what < 0.6) return step({ op: "track.move", ids: [t.id], dx: int(-400_000, 400_000), dy: int(-1_200_000, 1_200_000) });
      if (what < 0.8) return step({ op: "net.set", ids: [t.id], net: t.net === undefined ? pick(nets) : null });
      return step({ op: "track.delete", ids: [t.id] });
    }
    case "tmove":
      return step({ op: "track.move", ids: [pick(tracks).id], dx: int(-600_000, 600_000), dy: int(-600_000, 600_000) });
    case "tadd": {
      const a = hot();
      const b = { x: a.x + int(-3_000_000, 3_000_000), y: a.y + (r() < 0.5 ? 0 : int(-3_000_000, 3_000_000)) };
      if (a.x === b.x && a.y === b.y) return undefined;
      const net = r() < 0.15 ? undefined : pick(nets);
      return step({ op: "track.add", segments: [{ handle: "h", ...(net ? { net } : {}), layer: pick(layers), width: int(100_000, 500_000), start: a, end: b, ...(r() < 0.2 ? { sweep: pick([90_000, -45_000]) } : {}) }] });
    }
    case "tdel":
      return step({ op: "track.delete", ids: [pick(tracks).id] });
    case "vmove":
      return step({ op: "via.move", ids: [pick(vias).id], dx: int(-500_000, 500_000), dy: int(-500_000, 500_000) });
    case "vadd": {
      const net = r() < 0.15 ? undefined : pick(nets);
      return step({ op: "via.add", vias: [{ ...(net ? { net } : {}), ...hot(), outer_diameter: pick([400_000, 500_000, 600_000]), hole_diameter: pick([200_000, 250_000, 300_000]) }] });
    }
    case "vdel":
      return step({ op: "via.delete", ids: [pick(vias).id] });
    case "fmove":
      return step({ op: "footprint.move", ids: [pick(fps)], dx: int(-2_000_000, 2_000_000), dy: int(-2_000_000, 2_000_000), tracks: "stay" });
    case "frotate":
      return step({ op: "footprint.rotate", ids: [pick(fps)], angle: pick([90_000, -90_000, 45_000, 180_000]) });
    case "fflip":
      return step({ op: "footprint.flip", ids: [pick(fps)] });
    case "net":
      return step({ op: "net.set", ids: [pick([...tracks, ...vias]).id], net: r() < 0.25 ? null : pick(nets) });
    case "lock":
      return step({ op: "lock", ids: [pick([...tracks, ...vias]).id] });
    case "silk": {
      const silk = [...recordsOfKind(doc, "text"), ...recordsOfKind(doc, "graphic")];
      if (!silk.length) return undefined;
      const s = pick(silk);
      const dx = int(-1_500_000, 1_500_000);
      const dy = int(-1_500_000, 1_500_000);
      const moved = s.kind === "text" ? { ...s, x: s.x + dx, y: s.y + dy } : s.center ? { ...s, center: { x: s.center.x + dx, y: s.center.y + dy } } : s;
      return step({ op: "record.put", records: [moved] }, false, HOST);
    }
    case "zone": {
      const zones = recordsOfKind(doc, "zone");
      if (!zones.length) return undefined;
      return step({ op: "zone.edit", id: pick(zones).id, patch: { clearance: int(100_000, 400_000) } }, true);
    }
    default: {
      const rules = recordsOfKind(doc, "rule").filter((x) => x.min !== undefined);
      if (!rules.length) return undefined;
      const { kind: _k, provenance: _p, ...rest } = pick(rules);
      return step({ op: "rule.set", rule: { ...rest, min: Math.max(10_000, rest.min! + int(-50_000, 50_000)) } }, true);
    }
  }
}

/** A person waives a finding now counted (by id, or by its rule and objects), or removes a waiver: a full run. */
function waiverStep(doc: BoardDocument, result: BoardCheckResult, r: () => number): Step | undefined {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const ws = recordsOfKind(doc, "waiver");
  if (ws.length && r() < 0.35) return { call: { op: "waiver.remove", ids: [pick(ws).id] }, actor: HUMAN, global: true };
  if (!result.findings.length) return undefined;
  const f = pick(result.findings);
  const byRule = r() < 0.5 && f.objects.length <= 50;
  const waiver = byRule ? { rule: f.rule ?? f.check, objects: [...f.objects], reason: "a random test waiver" } : { finding: f.id, reason: "a random test waiver" };
  return { call: { op: "waiver.add", waiver }, actor: HUMAN, global: true };
}

/** The incremental result equals the full run (everything the result says, except timing). */
function expectSame(inc: BoardCheckResult, full: BoardCheckResult, where: string): void {
  const strip = (r: BoardCheckResult) => ({ ...r.summary, timing: undefined });
  expect(inc.inputHash, where).toBe(full.inputHash);
  expect(inc.findings.map((f) => f.id), where).toEqual(full.findings.map((f) => f.id));
  expect(inc.findings, where).toEqual(full.findings);
  expect(inc.waived, where).toEqual(full.waived);
  expect(strip(inc), where).toEqual(strip(full));
  expect(inc.connectivity, where).toEqual(full.connectivity);
  expect(inc.notRun, where).toEqual(full.notRun);
  expect(inc.defaults, where).toEqual(full.defaults);
  expect(inc.notes, where).toEqual(full.notes);
}

interface Walk {
  steps: number;
  incremental: number;
  full: number;
}

/** Walk `steps` random applied edits from `start`, comparing every update with a full run. */
function walk(start: BoardDocument, seed: number, steps: number, opts: { fills?: ZoneFill[]; join?: JoinRule; refill?: boolean; waivers?: boolean } = {}): Walk {
  const r = rng(seed);
  const engine = createEngine(start, { epoch: `s${String(seed).padStart(5, "0")}`.slice(0, 6) });
  let fills = opts.fills;
  const inc = createIncrementalChecks(start, { ...(fills ? { fills } : {}), ...(opts.join ? { join: opts.join } : {}) });
  expectSame(inc.result, runBoardChecks(start, { ...(fills ? { fills } : {}), ...(opts.join ? { join: opts.join } : {}) }), `seed ${seed}: the first run`);
  const out: Walk = { steps: 0, incremental: 0, full: 0 };
  for (let attempt = 0; out.steps < steps && attempt < steps * 6; attempt++) {
    const s = opts.waivers && r() < 0.15 ? waiverStep(engine.doc, inc.result, r) : randomStep(engine.doc, r);
    if (!s) continue;
    const before = inc.result;
    const reply = engine.apply({ batchId: `b${seed}.${attempt}`, label: "apply one random test edit", ops: [s.call] }, s.actor);
    if (reply.status !== "applied") continue;
    out.steps++;
    // now and then new zone fill arrives (a refill): an antipad hole moves, appears or goes, the holes come in
    // another order, the same fill comes again, or the plane's outline shrinks or grows (that one runs in full)
    let fillOpt = {};
    let refill = "";
    if (opts.refill && fills && r() < 0.2) {
      refill = ["move", "move", "add", "remove", "reorder", "same", "outline"][Math.floor(r() * 7)];
      const vias = recordsOfKind(engine.doc, "via");
      const ring = (x: number, y: number) => Array.from({ length: 8 }, (_, k) => ({ x: Math.round(x + 600_000 * Math.cos((k * Math.PI) / 4)), y: Math.round(y + 600_000 * Math.sin((k * Math.PI) / 4)) }));
      fills = fills.map((f) => ({
        ...f,
        polygons: f.polygons.map((p) => {
          if (!("outline" in p)) return p;
          const holes = [...(p.holes ?? [])];
          const h = Math.floor(r() * holes.length);
          if (refill === "move" && holes.length) {
            const dx = Math.round((r() - 0.5) * 600_000);
            const dy = Math.round((r() - 0.5) * 600_000);
            holes[h] = holes[h].map((v) => ({ x: v.x + dx, y: v.y + dy }));
          } else if (refill === "add" && vias.length) {
            const v = vias[Math.floor(r() * vias.length)];
            holes.push(ring(v.x, v.y));
          } else if (refill === "remove" && holes.length) holes.splice(h, 1);
          else if (refill === "reorder") holes.reverse();
          const d = mm(0.1) * (r() < 0.5 ? -1 : 1);
          const outline = refill === "outline" ? p.outline.map((v) => ({ x: v.x + Math.sign(v.x) * d, y: v.y + Math.sign(v.y) * d })) : p.outline;
          return { ...p, outline, holes };
        }),
      }));
      fillOpt = { fills, fillChanged: ["zone:gnd2"] };
    }
    const u = inc.update(engine.doc, reply.changed, fillOpt);
    const where = `seed ${seed}, step ${out.steps}: ${JSON.stringify(s.call)}${refill ? `, refill ${refill}` : ""}`;
    expectSame(u.result, runBoardChecks(engine.doc, { ...(fills ? { fills } : {}), ...(opts.join ? { join: opts.join } : {}) }), where);
    expect(inc.result).toBe(u.result);
    // a local edit stays incremental, a local refill too; an edit with board-wide reach, or a new plane outline
    // (every ring of the fill changed), runs in full
    expect(u.mode, where).toBe(s.global || refill === "outline" ? "full" : "incremental");
    if (u.mode === "incremental") out.incremental++;
    else out.full++;
    // the diff turns the previous findings into the new ones
    const ids = new Set(before.findings.map((f) => f.id));
    for (const id of u.removed) ids.delete(id);
    for (const f of u.added) ids.add(f.id);
    expect([...ids].sort(), where).toEqual(u.result.findings.map((f) => f.id).sort());
    const prev = new Map(before.findings.map((f) => [f.id, JSON.stringify(f)]));
    for (const f of u.result.findings) if (!u.added.includes(f)) expect(JSON.stringify(f), where).toBe(prev.get(f.id));
  }
  expect(out.steps, `seed ${seed}: enough edits applied`).toBe(steps);
  return out;
}

describe("incremental checks equal a full run after every edit (property)", () => {
  const STEPS = 40;
  for (const seed of [11, 2026, 90210]) {
    it(`Airnode C3 with its netlist, seed ${seed}, ${STEPS} edits`, () => {
      const w = walk(airnodeC3(), seed, STEPS);
      expect(w.incremental).toBeGreaterThan(STEPS / 2);
    });
    it(`a small four-layer board with a ground plane fill, seed ${seed}, ${STEPS} edits`, () => {
      const { records, nets, fills } = smallBoard();
      const w = walk(makeDoc(records, nets), seed, STEPS, { fills, refill: true });
      expect(w.incremental).toBeGreaterThan(STEPS / 2);
    });
  }
  it(`Airnode C3 with waivers added and removed between the edits, ${STEPS} edits`, () => {
    const w = walk(airnodeC3(), 5, STEPS, { waivers: true });
    expect(w.incremental).toBeGreaterThan(STEPS / 2);
  });
  it(`a small four-layer board with fill and waivers, ${STEPS} edits`, () => {
    const { records, nets, fills } = smallBoard();
    walk(makeDoc(records, nets), 77, STEPS, { fills, refill: true, waivers: true });
  });
  it(`Airnode C3 with the overlap join rule, ${STEPS} edits`, () => {
    walk(airnodeC3(), 7, STEPS, { join: "overlap" });
  });
});

describe("incremental checks", () => {
  it("an update with nothing changed changes nothing", () => {
    const doc = airnodeC3();
    const inc = createIncrementalChecks(doc);
    const first = inc.result;
    const u = inc.update(doc, []);
    expect(u.mode).toBe("incremental");
    expect(u.added).toEqual([]);
    expect(u.removed).toEqual([]);
    expect(u.result.findings).toEqual(first.findings);
    expect(u.ms).toBeGreaterThanOrEqual(0);
  });

  it("rechecks copper whose carried net changes when the copper it touches moves", () => {
    const { records, nets, fills } = smallBoard();
    const doc = makeDoc(records, nets);
    const inc = createIncrementalChecks(doc, { fills });
    expect(inc.result.connectivity.carried).toMatchObject({ "trk:free.1": "N11", "trk:free.2": "N11", "via:free.v": "N11" });
    const said = (r: BoardCheckResult) => r.findings.filter((f) => f.message.includes("carries N11")).length;
    expect(said(inc.result)).toBeGreaterThan(0);
    const engine = createEngine(doc);
    for (const dy of [mm(-1), mm(1)]) {
      const reply = engine.apply({ batchId: `n11${dy}`, label: "move the N11 track sideways", ops: [{ op: "track.move", ids: ["trk:N11.1"], dx: 0, dy }] }, HUMAN);
      expect(reply.status).toBe("applied");
      const u = inc.update(engine.doc, changedOf(reply));
      expect(u.mode).toBe("incremental");
      expectSame(u.result, runBoardChecks(engine.doc, { fills }), `N11 track moved by ${dy}`);
      if (dy < 0) {
        expect(u.result.connectivity.carried["trk:free.2"]).toBeUndefined();
        expect(said(u.result)).toBe(0);
        expect(u.result.findings.some((f) => f.check === "hole_clearance" && f.objects.includes("via:free.v"))).toBe(true);
      } else expect(u.result.connectivity.carried["trk:free.2"]).toBe("N11");
    }
  });

  it("runs new fill in full when a rule tests an area: a fill change anywhere can change how it matches", () => {
    const { records, nets, fills } = smallBoard();
    const doc = makeDoc([...records, rule("clr_region", "floor", "clearance", 0.25, { region: rectV(6, 6, 10, 0) })], nets);
    const inc = createIncrementalChecks(doc, { fills });
    const moved = fills.map((f) => ({ ...f, polygons: f.polygons.map((p) => ("outline" in p ? { ...p, holes: (p.holes ?? []).map((h, k) => (k === 1 ? h.map((v) => ({ x: v.x + 100_000, y: v.y })) : h)) } : p)) }));
    const u = inc.update(doc, [], { fills: moved, fillChanged: ["zone:gnd2"] });
    expect(u.mode).toBe("full");
    expectSame(u.result, runBoardChecks(doc, { fills: moved }), "a fill change with a region rule");
  });

  it("finds changed records the changed list leaves out", () => {
    const doc = airnodeC3();
    const inc = createIncrementalChecks(doc);
    const engine = createEngine(doc);
    const reply = engine.apply({ batchId: "x", label: "move the spare track down", ops: [{ op: "track.move", ids: ["trk:f.spare.1"], dx: 0, dy: mm(-1) }] }, HUMAN);
    expect(reply.status).toBe("applied");
    const u = inc.update(engine.doc, []);
    expectSame(u.result, runBoardChecks(engine.doc), "an empty changed list");
  });

  it("new zone fill runs in full and is kept for later updates", () => {
    const { records, nets, fills } = smallBoard();
    const doc = makeDoc(records, nets);
    const inc = createIncrementalChecks(doc);
    expect(inc.result.connectivity.zoneFill).toBe("absent");
    const u = inc.update(doc, [], { fills });
    expect(u.mode).toBe("full");
    expectSame(u.result, runBoardChecks(doc, { fills }), "fill given");
    const engine = createEngine(doc);
    const reply = engine.apply({ batchId: "y", label: "move one routed track", ops: [{ op: "track.move", ids: ["trk:N01.1"], dx: mm(0.3), dy: 0 }] }, HUMAN);
    expect(reply.status).toBe("applied");
    const v = inc.update(engine.doc, changedOf(reply));
    expect(v.mode).toBe("incremental");
    expectSame(v.result, runBoardChecks(engine.doc, { fills }), "after the fill");
  });

  it("leaves the cache of runBoardChecks alone: earlier documents still check as before", () => {
    const start = airnodeC3();
    const first = runBoardChecks(start);
    const inc = createIncrementalChecks(start);
    const engine = createEngine(start);
    const r = rng(5);
    for (let i = 0, n = 0; n < 15 && i < 100; i++) {
      const s = randomStep(engine.doc, r);
      if (!s || s.global) continue;
      const reply = engine.apply({ batchId: `c${i}`, label: "apply one random test edit", ops: [s.call] }, s.actor);
      if (reply.status !== "applied") continue;
      n++;
      inc.update(engine.doc, reply.changed);
    }
    expectSame(runBoardChecks(start), first, "the first document again");
    expectSame(inc.result, runBoardChecks(engine.doc), "the last document");
  });
});
