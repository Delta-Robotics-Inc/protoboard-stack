/**
 * Every operation on the Airnode C3 schematic, and the inverse property: applying an operation and then its
 * inverse gives back the same document, record for record. A seeded random walk checks it on long sequences.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { airnodeSchematic } from "../src/fixtures/airnode-c3.ts";
import { getOperation, listOperations, provenanceFor, recordsOfKind, schematicsEqual, type ApplyContext, type OpCall, type SchematicDocument } from "../src/index.ts";

let serial = 0;
export function ctxFor(kind: "human" | "agent" | "system" = "human"): ApplyContext {
  const actor = { kind, id: kind } as const;
  return { actor, issueId: (k) => `${{ label: "lbl", power: "pwr", text: "txt", proposal: "prop", noconnect: "nc", symbol: "sym", frame: "frm", card: "card" }[k as "label"] ?? k}:test.${++serial}`, provenance: provenanceFor(actor), edited: kind === "human" ? "hand" : kind === "agent" ? "agent" : undefined, pinMoves: kind === "human" };
}
export function applyCall(doc: SchematicDocument, call: OpCall, ctx = ctxFor()) {
  const def = getOperation(call.op);
  if (!def) throw new Error(`unknown op ${call.op}`);
  const { op: _o, ...args } = call;
  return def.apply(doc, def.input.parse(args), ctx);
}
function undoAll(doc: SchematicDocument, inverse: OpCall[]): SchematicDocument {
  let d = doc;
  for (const c of inverse) d = applyCall(d, c, ctxFor("system")).doc;
  return d;
}

let doc: SchematicDocument;
beforeAll(async () => {
  doc = await airnodeSchematic();
});

function cases(d: SchematicDocument): OpCall[] {
  const sym = recordsOfKind(d, "symbol");
  const wire = recordsOfKind(d, "wire")[0];
  const label = recordsOfKind(d, "label")[0];
  const power = recordsOfKind(d, "power")[0];
  const nc = recordsOfKind(d, "noconnect")[0];
  const sensorWire = recordsOfKind(d, "wire").find((w) => w.net === "I2C_SDA" && w.card === "card:sensor")!;
  return [
    { op: "symbol.place", id: sym[0].id, x: sym[0].x + 3, y: sym[0].y - 1, rotation: 90 },
    { op: "symbol.place", id: sym[1].id, variant: "iec", mirror: true },
    { op: "symbol.rotate", ids: [sym[2].id, sym[3].id], angle: 90 },
    { op: "symbol.mirror", ids: [sym[4].id] },
    { op: "item.move", ids: [sym[5].id, label.id], dx: 2, dy: -1 },
    { op: "item.move", ids: ["card:status"], dx: 5, dy: 0 },
    { op: "wire.add", wires: [{ handle: "w", net: "I2C_SDA", card: "card:sensor", points: [[0, 0], [3, 0], [3, 4]] }] },
    { op: "wire.edit", id: wire.id, points: [[0, 0], [0, 5]] },
    { op: "wire.delete", ids: [wire.id] },
    { op: "wire.to_label", ids: [sensorWire.id] },
    { op: "label.add", labels: [{ net: "BOOT", card: "card:ui", x: 1, y: 1, side: "left", scope: "port" }] },
    { op: "label.delete", ids: [label.id] },
    { op: "power.add", symbols: [{ net: "GND", card: "card:ui", x: 4, y: 4, dir: "down", style: "ground" }] },
    { op: "power.delete", ids: [power.id] },
    { op: "noconnect.delete", ids: [nc.id] },
    { op: "text.add", card: "card:status", x: 2, y: 2, text: "LED current about 1 mA" },
    { op: "pin", ids: [sym[0].id, "card:mcu"] },
    { op: "card.regroup", ids: ["sym:ui/r_boot"], card: "card:mcu" },
    { op: "card.edit", id: "card:ui", title: "User input", subtitle: null },
    { op: "layout.run", scope: ["card:sensor"], mode: "fresh" },
    { op: "layout.run", mode: "tidy" },
    { op: "proposal.add", title: "Move R4 beside SCL", ops: [{ op: "item.move", ids: ["sym:sensor/r_scl"], dx: 2, dy: 0 }], rule: "C13" },
  ];
}

describe("operations", () => {
  it("are registered with schemas, descriptions and the noun.verb names", () => {
    const names = listOperations().map((o) => o.name);
    for (const n of ["symbol.place", "symbol.rotate", "symbol.mirror", "item.move", "wire.add", "wire.edit", "wire.delete", "wire.to_label", "label.to_wire", "label.add", "label.delete", "power.add", "power.delete", "noconnect.add", "noconnect.delete", "text.add", "text.edit", "text.delete", "pin", "unpin", "card.regroup", "card.edit", "layout.run", "proposal.add", "proposal.accept", "proposal.reject", "record.put", "record.remove"]) expect(names).toContain(n);
    for (const o of listOperations()) expect(o.description.length).toBeGreaterThan(10);
  });

  it("each case applies and its inverse restores the document exactly", () => {
    for (const call of cases(doc)) {
      const r = applyCall(doc, call);
      expect(r.changed.length, call.op).toBeGreaterThan(0);
      expect(schematicsEqual(undoAll(r.doc, r.inverse), doc), call.op).toBe(true);
    }
  });

  it("label.to_wire wires a labeled net back", () => {
    const sensorWire = recordsOfKind(doc, "wire").find((w) => w.net === "I2C_SDA" && w.card === "card:sensor")!;
    const labeled = applyCall(doc, { op: "wire.to_label", ids: recordsOfKind(doc, "wire").filter((w) => w.net === sensorWire.net && w.card === "card:sensor").map((w) => w.id) }).doc;
    const back = applyCall(labeled, { op: "label.to_wire", net: "I2C_SDA", card: "card:sensor" });
    expect(recordsOfKind(back.doc, "wire").some((w) => w.net === "I2C_SDA" && w.card === "card:sensor")).toBe(true);
    expect(schematicsEqual(undoAll(back.doc, back.inverse), labeled)).toBe(true);
  });

  it("proposal.accept applies the proposal and removes it; reject removes it", () => {
    const p = applyCall(doc, { op: "proposal.add", handle: "p", title: "Move R4", ops: [{ op: "item.move", ids: ["sym:sensor/r_scl"], dx: 2, dy: 0 }] }, ctxFor("agent"));
    const id = p.created!.p;
    const prop = p.doc.records.get(id)!;
    expect(prop.kind === "proposal" && prop.score).toBeTruthy();
    const acc = applyCall(p.doc, { op: "proposal.accept", id });
    expect(acc.doc.records.has(id)).toBe(false);
    const r4 = acc.doc.records.get("sym:sensor/r_scl")!;
    const r4before = doc.records.get("sym:sensor/r_scl")!;
    expect(r4.kind === "symbol" && r4before.kind === "symbol" && r4.x - r4before.x).toBe(2);
    expect(schematicsEqual(undoAll(acc.doc, acc.inverse), p.doc)).toBe(true);
    expect(applyCall(p.doc, { op: "proposal.reject", ids: [id] }).doc.records.has(id)).toBe(false);
  });

  it("refuses connectivity it does not have: unknown nets, pins on a net marked no-connect", () => {
    expect(() => applyCall(doc, { op: "wire.add", wires: [{ net: "NOPE", card: "card:ui", points: [[0, 0], [1, 0]] }] })).toThrow(/not in the circuit/);
    expect(() => applyCall(doc, { op: "noconnect.add", pins: ["mcu/module:pin_13"] })).toThrow(/is on net/);
  });

  it("keeps the inverse property over a seeded random walk", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let d = doc;
    const stack: { before: SchematicDocument; inverse: OpCall[] }[] = [];
    for (let step = 0; step < 60; step++) {
      const syms = recordsOfKind(d, "symbol");
      const s = syms[Math.floor(rnd() * syms.length)];
      const choice = Math.floor(rnd() * 4);
      const call: OpCall = choice === 0 ? { op: "item.move", ids: [s.id], dx: Math.floor(rnd() * 7) - 3, dy: Math.floor(rnd() * 7) - 3 || 1 } : choice === 1 ? { op: "symbol.rotate", ids: [s.id], angle: 90 } : choice === 2 ? { op: "symbol.mirror", ids: [s.id] } : { op: "pin", ids: [s.id] };
      const r = applyCall(d, call);
      stack.push({ before: d, inverse: r.inverse });
      d = r.doc;
    }
    while (stack.length) {
      const { before, inverse } = stack.pop()!;
      d = undoAll(d, inverse);
      expect(schematicsEqual(d, before)).toBe(true);
    }
    expect(schematicsEqual(d, doc)).toBe(true);
  });
});
