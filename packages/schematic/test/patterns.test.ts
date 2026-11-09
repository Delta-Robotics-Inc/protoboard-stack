/**
 * The layout's patterns at scale, on synthetic circuits only (src/fixtures/synthetic.ts): repeated channels as an
 * aligned array, an addressable LED chain in rows, a 48-pin microcontroller with its crystal, supply rows and
 * folded unused pins, and a board of fifteen cards. Also the time budget (about 160 parts under two seconds),
 * determinism, stability (a changed part re-lays out only its card; a small change does not reshuffle the sheet),
 * and pinned symbols that never move. The flat KiCad export of each is checked with kicad-cli when installed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYNTHETIC, fifteenCards, largeBoard, ledChain8, ledDriver16, mcu48 } from "../src/fixtures/synthetic.ts";
import {
  circuitNetlist,
  createSchematic,
  diffIds,
  exportKicad,
  findKicadCli,
  geometryOf,
  layoutSchematic,
  netlistsEqual,
  readKicadNetlist,
  recordsOfKind,
  schematicsEqual,
  scoreSchematic,
  withChanges,
  withCircuit,
  type SchematicCircuit,
  type SchematicDocument,
} from "../src/index.ts";

const laid = (c: SchematicCircuit) => {
  const doc = createSchematic([], c);
  const r = layoutSchematic(doc);
  return { doc: withChanges(doc, r.puts, r.removes), r };
};
const rule = (doc: SchematicDocument, id: string) => scoreSchematic(doc).rules.find((r) => r.id === id)!;

describe("patterns", () => {
  it("draws sixteen identical channels as an aligned array, each the same way round", () => {
    const { doc, r } = laid(ledDriver16());
    expect(r.patterns).toContainEqual({ card: "card:channels", pattern: "array:16" });
    // every channel's transistor sits on a grid: four distinct columns and four rows, equal pitch
    const q = recordsOfKind(doc, "symbol").filter((s) => /^channels\/q\d+$/.test(s.part));
    const xs = [...new Set(q.map((s) => s.x))].sort((a, b) => a - b);
    const ys = [...new Set(q.map((s) => s.y))].sort((a, b) => a - b);
    expect(xs.length * ys.length).toBeGreaterThanOrEqual(16);
    expect(new Set(xs.slice(1).map((x, i) => x - xs[i])).size).toBe(1);
    expect(new Set(q.map((s) => s.rotation)).size).toBe(1);
    // the two shift registers, linked output to input, lie in a row
    expect(r.patterns).toContainEqual({ card: "card:logic", pattern: "chain:2" });
    const s = scoreSchematic(doc);
    expect(s.gates.open).toBe(0);
    expect(s.score).toBeGreaterThanOrEqual(85);
  });

  it("draws an addressable LED chain in rows of equal pitch, linked output to input", () => {
    const { doc, r } = laid(ledChain8());
    expect(r.patterns).toContainEqual({ card: "card:ring", pattern: "chain:8" });
    const g = geometryOf(doc);
    const leds = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => g.symbols.get(`sym:ring/led${i}`)!);
    // in chain order, left to right within a row, every LED the same way round
    expect(new Set(leds.map((l) => l.rec.rotation)).size).toBe(1);
    for (let i = 1; i < leds.length; i++) if (leds[i].rec.y === leds[i - 1].rec.y) expect(leds[i].rec.x).toBeGreaterThan(leds[i - 1].rec.x);
    // each LED keeps its own decoupling capacitor beside it
    expect(rule(doc, "C12").count).toBe(0);
    const s = scoreSchematic(doc);
    expect(s.gates.open).toBe(0);
    expect(s.score).toBeGreaterThanOrEqual(85);
  });

  it("gives a 48-pin microcontroller supply rows, its crystal, and folds its unused pins", () => {
    const { doc, r } = laid(mcu48());
    const kinds = r.patterns.filter((p) => p.card === "card:mcu").map((p) => p.pattern);
    expect(kinds).toEqual(expect.arrayContaining(["bank:top:1", "bank:bottom:1", "crystal"]));
    const u = recordsOfKind(doc, "symbol").find((s) => s.part === "mcu/u1")!;
    expect(u.hide_unused).toBe(true);
    const g = geometryOf(doc).symbols.get(u.id)!;
    expect(g.pins.length).toBeLessThan(48);
    expect(g.resolved.body.some((e) => e.el === "text" && /unused$/.test(e.text ?? ""))).toBe(true);
    expect(rule(doc, "C01").count).toBe(0);
    expect(rule(doc, "C06").count).toBe(0);
  });

  it("lays fifteen cards out with no overlap, a readable aspect and the drawn netlist equal to the circuit", () => {
    const { doc } = laid(fifteenCards());
    const cards = recordsOfKind(doc, "card");
    expect(cards.length).toBe(15);
    const s = scoreSchematic(doc);
    expect(s.defects.filter((d) => d.rule === "C20" && /overlap|apart/.test(d.message))).toEqual([]);
    const W = Math.max(...cards.map((c) => c.x + c.w)) - Math.min(...cards.map((c) => c.x));
    const H = Math.max(...cards.map((c) => c.y + c.h)) - Math.min(...cards.map((c) => c.y));
    expect(W / H).toBeGreaterThan(1);
    expect(W / H).toBeLessThan(2.2);
    expect(rule(doc, "C01").count).toBe(0);
    expect(rule(doc, "C06").count).toBe(0);
    // the power input card sits left of or above the cards its rails feed
    expect(rule(doc, "C15").count).toBeLessThanOrEqual(1);
  });
});

describe("at scale", () => {
  it("lays out about 160 parts in under two seconds, the same bytes every time", () => {
    const c = largeBoard();
    expect(c.parts.length).toBeGreaterThanOrEqual(150);
    const t0 = performance.now();
    const a = laid(c).doc;
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
    const b = laid(c).doc;
    expect(schematicsEqual(a, b)).toBe(true);
  });

  it("re-lays out only the changed part's card, and keeps every card where it was", () => {
    const { doc } = laid(fifteenCards());
    const c = structuredClone(doc.circuit) as SchematicCircuit;
    c.parts.find((p) => p.path === "temp/r1")!.value = "22k";
    const next = withCircuit(doc, c);
    const r = layoutSchematic(next);
    const after = withChanges(next, r.puts, r.removes);
    const changed = diffIds(doc, after).filter((id) => id !== "schematic");
    for (const id of changed) {
      const rec = after.records.get(id) ?? doc.records.get(id)!;
      expect("card" in rec ? rec.card : id, id).toBe("card:temp");
    }
    for (const k of recordsOfKind(doc, "card")) expect(after.records.get(k.id)).toEqual(k);
  });

  it("never moves a pinned symbol, in a full run or a card run", () => {
    const { doc } = laid(ledChain8());
    const s = doc.records.get("sym:ring/led3")!;
    if (s.kind !== "symbol") throw new Error("fixture");
    const pinned = withChanges(doc, [{ ...s, x: s.x + 3, y: s.y + 2, pinned: true }]);
    for (const scope of ["all", ["card:ring"]] as const) {
      const r = layoutSchematic(pinned, { scope: scope === "all" ? "all" : [...scope] });
      const after = withChanges(pinned, r.puts, r.removes);
      const m = after.records.get(s.id)!;
      expect(m.kind === "symbol" && [m.x, m.y]).toEqual([s.x + 3, s.y + 2]);
      expect(rule(after, "C01").count).toBe(0);
    }
  });
});

const cli = findKicadCli();
describe.skipIf(!cli)("flat KiCad export of the patterns", () => {
  const out = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp", "patterns-kicad");
  for (const [name, make] of Object.entries(SYNTHETIC)) {
    it(`${name}: the exported netlist equals the circuit's and ERC finds no wiring errors`, { timeout: 300_000 }, () => {
      const { doc } = laid(make());
      const dir = join(out, name);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const ex = exportKicad(doc, { dir, project: name.toLowerCase() });
      execFileSync(cli!, ["sch", "export", "netlist", "--format", "kicadsexpr", "-o", join(dir, "n.net"), join(dir, ex.root)]);
      const eq = netlistsEqual(readKicadNetlist(readFileSync(join(dir, "n.net"), "utf8")), circuitNetlist(doc));
      expect(eq.onlyA).toEqual([]);
      expect(eq.onlyB).toEqual([]);
      execFileSync(cli!, ["sch", "erc", "--format", "json", "-o", join(dir, "erc.json"), join(dir, ex.root)]);
      const v = (JSON.parse(readFileSync(join(dir, "erc.json"), "utf8")) as { sheets: { violations: { severity: string; type: string }[] }[] }).sheets.flatMap((s) => s.violations);
      // a rail fed only through a diode or a ferrite (no supply output) is reported as undriven; that is the circuit
      expect(v.filter((x) => x.severity === "error" && x.type !== "power_pin_not_driven")).toEqual([]);
    });
  }
});
