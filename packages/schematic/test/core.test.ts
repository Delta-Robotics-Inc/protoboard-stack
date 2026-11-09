/**
 * The circuit from UHD, the engine, the files, the layout's determinism and incrementality, and the score.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { airnodeCircuit, airnodeSchematic } from "../src/fixtures/airnode-c3.ts";
import {
  HUMAN,
  createSchematicEngine,
  drawnNetlist,
  layoutSchematic,
  loadSchematicDir,
  openSchematicService,
  parseFile,
  recordsOfKind,
  schematicsEqual,
  scoreSchematic,
  serializeSchematic,
  withChanges,
  writeSchematicDir,
  type SchematicCircuit,
  type SchematicDocument,
} from "../src/index.ts";

let circuit: SchematicCircuit;
let doc: SchematicDocument;
beforeAll(async () => {
  circuit = await airnodeCircuit();
  doc = await airnodeSchematic();
});
const AGENT = { kind: "agent" as const, id: "cleaner", name: "cleaner" };

describe("the circuit from UHD", () => {
  it("flattens the board and reads pin facts from the UHD leaves", () => {
    expect(circuit.parts.length).toBe(20);
    expect(circuit.nets.length).toBe(15);
    const io9 = circuit.parts.find((p) => p.path === "mcu/module")!.pins.find((p) => p.name === "IO9")!;
    expect(io9).toMatchObject({ number: "13", type: "io", voltage: { min: 0, max: 3.6 } });
    expect(circuit.nets.find((n) => n.name === "VBUS")!.voltage).toMatchObject({ nominal: 5 });
    expect(circuit.parts.find((p) => p.path === "power/ldo")!.class).toBe("regulator");
    expect(circuit.parts.find((p) => p.path === "usb/connector")!.unconnected).toEqual({ pin_A8: "sideband unused in USB 2.0", pin_B8: "sideband unused in USB 2.0" });
  });
});

describe("layout", () => {
  it("is deterministic: the same circuit gives the same bytes", async () => {
    const again = await airnodeSchematic();
    expect(serializeSchematic(again)).toEqual(serializeSchematic(doc));
  });

  it("draws exactly the UHD netlist, with every gate closed", () => {
    const s = scoreSchematic(doc);
    expect(s.gates.open).toBe(0);
    expect(s.presentable).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(90);
    const dn = drawnNetlist(doc);
    for (const n of circuit.nets) expect(new Set(n.pins.map((k) => dn.of.get(k))).size, n.name).toBe(1);
  });

  it("wires inside cards and labels only across cards", () => {
    for (const l of recordsOfKind(doc, "label")) {
      const cards = new Set(circuit.nets.find((n) => n.name === l.net)!.pins.map((k) => recordsOfKind(doc, "symbol").find((s) => s.part === k.slice(0, k.lastIndexOf(":")))!.card));
      expect(cards.size, l.net).toBeGreaterThan(1);
    }
    expect(scoreSchematic(doc).rules.find((r) => r.id === "C08")!.count).toBe(0);
  });

  it("re-lays out only the card in scope, and never moves a pinned symbol", () => {
    const r3 = doc.records.get("sym:sensor/r_sda")!;
    if (r3.kind !== "symbol") throw new Error("fixture");
    const pinned = withChanges(doc, [{ ...r3, x: r3.x - 1, pinned: true }]);
    const r = layoutSchematic(pinned, { scope: ["card:sensor"] });
    const after = withChanges(pinned, r.puts, r.removes);
    const moved = after.records.get("sym:sensor/r_sda")!;
    expect(moved.kind === "symbol" && [moved.x, moved.y]).toEqual([r3.x - 1, r3.y]);
    // every other card keeps its inside: symbols at the same place relative to their card
    const rel = (d: SchematicDocument, id: string) => {
      const s = d.records.get(id)!;
      const c = s.kind === "symbol" ? d.records.get(s.card)! : undefined;
      return s.kind === "symbol" && c?.kind === "card" ? [s.x - c.x, s.y - c.y, s.rotation] : [];
    };
    for (const s of recordsOfKind(doc, "symbol")) if (s.card !== "card:sensor") expect(rel(after, s.id), s.id).toEqual(rel(doc, s.id));
    expect(scoreSchematic(after).gates.open).toBe(0);
  });
});

describe("engine", () => {
  it("applies transactions, answers a resent batch once, and refuses stale writes", () => {
    const e = createSchematicEngine(doc, { epoch: "test01" });
    const tx = { batchId: "b1", label: "move the LDO right", ops: [{ op: "item.move", ids: ["sym:power/ldo"], dx: 1, dy: 0 }] };
    const r = e.apply(tx, HUMAN);
    expect(r.status).toBe("applied");
    expect(e.apply(tx, HUMAN)).toMatchObject({ status: "applied", duplicate: true });
    expect(e.seq).toBe(1);
    expect(e.apply({ batchId: "b2", label: "move it again please", ops: [{ op: "item.move", ids: ["sym:power/ldo"], dx: 1, dy: 0 }], expectSeq: 0 }, HUMAN)).toMatchObject({ status: "refused", reason: "stale-seq" });
    const moved = e.doc.records.get("sym:power/ldo")!;
    expect(moved.kind === "symbol" && moved.pinned).toBe(true);
  });

  it("refuses an agent's change to a pinned item; an agent's unpin waits for a person", () => {
    const e = createSchematicEngine(doc, { epoch: "test02" });
    e.apply({ batchId: "p", label: "pin the sensor in place", ops: [{ op: "pin", ids: ["sym:sensor/ic"] }] }, HUMAN);
    expect(e.apply({ batchId: "a", label: "agent nudges the sensor", ops: [{ op: "item.move", ids: ["sym:sensor/ic"], dx: 1, dy: 0 }] }, AGENT)).toMatchObject({ status: "refused", reason: "pinned" });
    expect(e.apply({ batchId: "u", label: "agent unpins the sensor", ops: [{ op: "unpin", ids: ["sym:sensor/ic"] }] }, AGENT)).toMatchObject({ status: "refused", reason: "needs-person" });
    expect(e.apply({ batchId: "l", label: "agent lays out the sensor", ops: [{ op: "layout.run", scope: ["card:sensor"] }] }, AGENT).status).toBe("applied");
  });

  it("undoes per actor: a person's undo leaves the agent's later work alone", () => {
    const e = createSchematicEngine(doc, { epoch: "test03" });
    e.apply({ batchId: "h", label: "person moves the LED", ops: [{ op: "item.move", ids: ["sym:status/led1"], dx: 1, dy: 0 }] }, HUMAN);
    e.apply({ batchId: "g", label: "agent moves a resistor", ops: [{ op: "item.move", ids: ["sym:sensor/r_scl"], dx: 1, dy: 0 }] }, AGENT);
    expect(e.undo(HUMAN).status).toBe("applied");
    expect(e.doc.records.get("sym:status/led1")).toEqual(doc.records.get("sym:status/led1"));
    expect(e.doc.records.get("sym:sensor/r_scl")).not.toEqual(doc.records.get("sym:sensor/r_scl"));
    expect(e.redo(HUMAN).status).toBe("applied");
    expect(e.undo(AGENT).status).toBe("applied");
    expect(e.undo(AGENT)).toMatchObject({ status: "refused", reason: "nothing-to-undo" });
  });
});

describe("files", () => {
  it("save then load is byte-identical, and the service saves only what changed", () => {
    const dir = mkdtempSync(join(tmpdir(), "schematic-"));
    writeSchematicDir(dir, doc);
    const texts = ["schematic", "symbols", "wires"].map((f) => readFileSync(join(dir, `${f}.jsonl`), "utf8"));
    const loaded = loadSchematicDir(dir, circuit).doc;
    expect(schematicsEqual(loaded, doc)).toBe(true);
    writeSchematicDir(dir, loaded);
    expect(["schematic", "symbols", "wires"].map((f) => readFileSync(join(dir, `${f}.jsonl`), "utf8"))).toEqual(texts);
    const svc = openSchematicService({ dir, circuit, projectRoot: dir, ownerLock: false });
    svc.apply({ batchId: "m", label: "move the sensor card", ops: [{ op: "item.move", ids: ["card:sensor"], dx: 1, dy: 0 }] }, HUMAN);
    const w = svc.save();
    expect(w.written.sort()).toEqual(["schematic", "symbols", "wires"]);
    expect(svc.score().presentable).toBe(true);
    svc.close({ save: false });
  });

  it("refuses an unsorted or misplaced line with its file and line", () => {
    const text = serializeSchematic(doc).symbols.split("\n");
    const swapped = [text[0], text[2], text[1], ...text.slice(3)].join("\n");
    expect(() => parseFile("symbols", swapped)).toThrow(/symbols.jsonl:3/);
    const dir = mkdtempSync(join(tmpdir(), "schematic-"));
    writeFileSync(join(dir, "symbols.jsonl"), `${text[0]}\n${serializeSchematic(doc).wires.split("\n")[1]}\n`);
    expect(() => loadSchematicDir(dir, circuit)).toThrow(/belongs in wires.jsonl/);
  });
});
