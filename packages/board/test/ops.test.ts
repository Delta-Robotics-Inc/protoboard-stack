/**
 * Every operation's cases (op-cases.ts) on the Airnode C3 fixture, and the inverse property: applying an
 * operation and then its inverse gives back the same document, record for record. A seeded random walk over the
 * operations checks the property on many inputs and on long sequences.
 */
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "../src/fixtures/airnode-c3.js";
import { documentsEqual, getOperation, OpError, provenanceFor, recordsOfKind, type ApplyContext, type BoardDocument, type OpCall } from "../src/index.js";
import { OP_CASES } from "./op-cases.js";

let serial = 0;
export function ctxFor(kind: "human" | "agent" | "host" | "system" = "human"): ApplyContext {
  const actor = { kind, id: kind === "agent" ? "test" : kind, ...(kind === "agent" ? { name: "test" } : {}) } as const;
  return {
    actor,
    issueId: (k) => `${{ track: "trk", via: "via", zone: "zone", keepout: "kpo" }[k as "track"] ?? k}:test.${++serial}`,
    provenance: provenanceFor(actor),
    edited: kind === "human" ? "hand" : kind === "agent" ? "agent" : undefined,
    lockCopper: kind === "human",
  };
}

/** Apply one call directly (no engine): parse, apply. */
export function applyCall(doc: BoardDocument, call: OpCall, ctx = ctxFor()) {
  const def = getOperation(call.op);
  if (!def) throw new Error(`unknown op ${call.op}`);
  const { op: _o, ...args } = call;
  return def.apply(doc, def.input.parse(args), ctx);
}

export function applyAll(doc: BoardDocument, calls: OpCall[]): BoardDocument {
  let d = doc;
  for (const c of calls) d = applyCall(d, c, ctxFor("system")).doc;
  return d;
}

describe("operation cases", () => {
  for (const [name, cases] of Object.entries(OP_CASES)) {
    for (const c of cases) {
      it(`${name}: ${c.name}`, () => {
        const fresh = () => (c.before ? applyAll(airnodeC3(), c.before) : airnodeC3());
        const before = fresh();
        if (c.fails) {
          expect(() => applyCall(before, c.call, ctxFor(c.actor))).toThrow(OpError);
          expect(() => applyCall(before, c.call, ctxFor(c.actor))).toThrow(c.fails);
          return;
        }
        const r = applyCall(before, c.call, ctxFor(c.actor));
        expect(r.changed.length).toBeGreaterThan(0);
        c.check(before, r.doc, r.created ?? {});
        // pure: the input document is untouched
        expect(documentsEqual(before, fresh())).toBe(true);
        // exact inverse
        expect(documentsEqual(applyAll(r.doc, r.inverse), before)).toBe(true);
      });
    }
  }
});

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

function randomCall(doc: BoardDocument, r: () => number): OpCall {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const fps = recordsOfKind(doc, "footprint").map((f) => f.id);
  const tracks = recordsOfKind(doc, "track").map((t) => t.id);
  const vias = recordsOfKind(doc, "via").map((v) => v.id);
  const lockable = [...fps, ...tracks, ...vias];
  const nets = [...doc.nets.keys()];
  const pt = () => ({ x: int(-19_000_000, 19_000_000), y: int(-14_000_000, 14_000_000) });
  const kinds = ["move", "place", "rotate", "flip", "tadd", "tmove", "vadd", "vmove", "lock", "unlock", "net", "zone"];
  if (tracks.length > 2) kinds.push("tdel");
  if (vias.length > 1) kinds.push("vdel");
  switch (pick(kinds)) {
    case "move":
      return { op: "footprint.move", ids: [pick(fps)], dx: int(-3_000_000, 3_000_000), dy: int(-3_000_000, 3_000_000) };
    case "place":
      return { op: "footprint.place", id: pick(fps), x: int(-15_000_000, 15_000_000), rotation: int(-720_000, 720_000) };
    case "rotate":
      return { op: "footprint.rotate", ids: [...new Set([pick(fps), pick(fps)])], angle: pick([90_000, -90_000, 45_000, int(-360_000, 360_000)]), about: pick(["each", "center", pt()] as const) };
    case "flip":
      return { op: "footprint.flip", ids: [pick(fps)], about: pick(["each", "center"] as const) };
    case "tadd": {
      const a = pt();
      return { op: "track.add", segments: [{ handle: "h", net: pick(nets), layer: pick(["top", "bottom"]), width: int(100_000, 800_000), start: a, end: { x: a.x + int(1, 2_000_000), y: a.y }, ...(r() < 0.3 ? { sweep: pick([90_000, -45_000]) } : {}) }] };
    }
    case "tmove":
      return { op: "track.move", ids: [pick(tracks)], dx: int(-500_000, 500_000), dy: int(-500_000, 500_000) };
    case "tdel":
      return { op: "track.delete", ids: [pick(tracks)] };
    case "vadd":
      return { op: "via.add", vias: [{ net: pick(nets), ...pt(), outer_diameter: 600_000, hole_diameter: 300_000 }] };
    case "vmove":
      return { op: "via.move", ids: [pick(vias)], dx: int(-500_000, 500_000), dy: 0 };
    case "vdel":
      return { op: "via.delete", ids: [pick(vias)] };
    case "lock":
      return { op: "lock", ids: [pick(lockable)] };
    case "unlock":
      return { op: "unlock", ids: [pick(lockable)] };
    case "net":
      return { op: "net.set", ids: [pick([...tracks, ...vias])], net: r() < 0.2 ? null : pick(nets) };
    default:
      return { op: "zone.edit", id: "zone:f.gnd_bottom", patch: { priority: int(0, 9), clearance: int(100_000, 400_000) } };
  }
}

describe("apply then inverse restores the document (property)", () => {
  it("for 400 random single operations", () => {
    const r = rng(20261109);
    let doc = airnodeC3();
    for (let i = 0; i < 400; i++) {
      const call = randomCall(doc, r);
      const res = applyCall(doc, call, ctxFor(r() < 0.5 ? "human" : "agent"));
      expect(documentsEqual(applyAll(res.doc, res.inverse), doc), `step ${i}: ${JSON.stringify(call)}`).toBe(true);
      doc = res.doc; // walk on, so later steps see moved, added and removed objects
    }
  });

  it("for a 150-step sequence undone in reverse", () => {
    const r = rng(7);
    const start = airnodeC3();
    let doc = start;
    const inverses: OpCall[][] = [];
    for (let i = 0; i < 150; i++) {
      const res = applyCall(doc, randomCall(doc, r));
      inverses.push(res.inverse);
      doc = res.doc;
    }
    expect(documentsEqual(doc, start)).toBe(false);
    for (const inv of inverses.reverse()) doc = applyAll(doc, inv);
    expect(documentsEqual(doc, start)).toBe(true);
  });

  it("flip twice and rotate by a full turn are identities", () => {
    const start = airnodeC3();
    const ids = recordsOfKind(start, "footprint").map((f) => f.id);
    let doc = applyCall(start, { op: "footprint.flip", ids }).doc;
    doc = applyCall(doc, { op: "footprint.flip", ids }).doc;
    doc = applyCall(doc, { op: "footprint.rotate", ids, angle: 90_000, about: { x: 0, y: 0 } }).doc;
    for (let i = 0; i < 3; i++) doc = applyCall(doc, { op: "footprint.rotate", ids, angle: 90_000, about: { x: 0, y: 0 } }).doc;
    const strip = (d: BoardDocument) => recordsOfKind(d, "footprint").map((f) => [f.id, f.x, f.y, f.rotation, f.side]);
    expect(strip(doc)).toEqual(strip(start));
  });
});
