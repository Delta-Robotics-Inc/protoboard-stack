/**
 * Nested boards in the circuit provider (docs/specs/nested-boards.md):
 * designators (§6), placement in sub-module frames (§7), the provider's
 * names, the examples' flat boards unchanged byte for byte, and the round
 * trip of the grouped fixture board (test/fixtures/nested-board) through
 * generate, check, KiCad with groups, lock and the locked check.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boardNetlist, boardOptions, loadProject, runCapabilityOperation, type BoardNetlist, type OperationRecord } from "@protoboardai/core";
import { readConstraints } from "../lib/config.ts";
import { kicadCli } from "../lib/kicad/cli.ts";
import { assignRefdes } from "../lib/kicad/refdes.ts";
import { child, children, parse, printDocument, property, text } from "../lib/kicad/sexpr.ts";
import { cadModels, chooseBodies } from "../lib/models.ts";
import { digestOf, files, readLayout, readOverrides } from "../lib/native.ts";
import { generateSource, inFrame, placementOf } from "../lib/source.ts";
import { withoutShapes } from "../lib/stepfile.ts";
import { supplierNumbers } from "../lib/suppliers.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = join(HERE, "fixtures/nested-board");
const EXAMPLES = join(HERE, "../../../examples");
const TMP = join(HERE, ".tmp/nested-boards");
const ROOT = join(TMP, "lamp");
const BOARD = "fx-lamp-board";
const DIR = "src/boards/lamp";

describe("designators on a grouped board (spec §6)", () => {
  const parts = (...ids: string[]) => ids.map((instance) => ({ instance, kind: (/\/?r\d/.test(instance.split("/").pop()!) ? "resistor" : "ic") as "resistor" | "ic" }));

  it("gives one definition used twice two sets of designators, unique over the board", () => {
    const { record } = assignRefdes(parts("u1", "led1/r1", "led1/r2", "led2/r1", "led2/r2", "led1/q1", "led2/q1"));
    expect(record.assigned).toEqual({ "led1/q1": "U2", "led1/r1": "R1", "led1/r2": "R2", "led2/q1": "U3", "led2/r1": "R3", "led2/r2": "R4", u1: "U1" });
  });

  it("keeps a part's designator when it moves into a group, out of one, or between groups", () => {
    const flat = assignRefdes(parts("u1", "r1", "r7")).record;
    expect(flat.assigned).toEqual({ r1: "R1", r7: "R7", u1: "U1" });
    const grouped = assignRefdes(parts("u1", "r1", "power/r7"), flat);
    expect(grouped.record.assigned).toEqual({ "power/r7": "R7", r1: "R1", u1: "U1" });
    const moved = assignRefdes(parts("u1", "r1", "sense/r7"), grouped.record);
    expect(moved.record.assigned["sense/r7"]).toBe("R7");
    const back = assignRefdes(parts("u1", "r1", "r7"), moved.record);
    expect(back.record.assigned).toEqual({ r1: "R1", r7: "R7", u1: "U1" });
  });

  it("does not guess when the move is ambiguous (a part split into two groups)", () => {
    const flat = assignRefdes(parts("r3")).record;
    const split = assignRefdes(parts("a/r3", "b/r3"), flat).record.assigned;
    expect(split.r3).toBe("R3"); // the old instance keeps its designator reserved
    expect([split["a/r3"], split["b/r3"]].sort()).toEqual(["R1", "R2"]);
  });

  it("never renumbers what is recorded when a part is added to another group", () => {
    const before = assignRefdes(parts("led1/r1", "led2/r1")).record;
    const after = assignRefdes(parts("led1/r1", "led1/r9", "led2/r1"), before).record.assigned;
    expect(after["led2/r1"]).toBe(before.assigned["led2/r1"]);
  });
});

describe("placement in sub-module frames (spec §7)", () => {
  const groups = new Set(["led1", "led2", "led2/inner"]);

  it("carries a part through its sub-module's frame: turned, moved, flipped", () => {
    expect(inFrame({ at: [10, 5], rotation_deg: 90, side: "top" }, { at: [2, 0], rotation_deg: 0, side: "top" })).toEqual({ at: [10, 7], rotation_deg: 90, side: "top" });
    // a frame on the bottom turns the sub-module over about its own Y axis
    expect(inFrame({ at: [0, 0], rotation_deg: 0, side: "bottom" }, { at: [2, 1], rotation_deg: 30, side: "top" })).toEqual({ at: [-2, 1], rotation_deg: 330, side: "bottom" });
  });

  it("composes nested frames, and leaves a part of a sub-module without a frame in board coordinates", () => {
    const own: Record<string, { at: [number, number]; rotation_deg: number; side: "top" | "bottom" }> = {
      led2: { at: [9, -5], rotation_deg: 180, side: "top" },
      "led2/inner": { at: [1, 0], rotation_deg: 0, side: "top" },
      "led2/inner/r1": { at: [0, 2], rotation_deg: 90, side: "top" },
      "led1/r1": { at: [3, 3], rotation_deg: 0, side: "top" },
    };
    expect(placementOf("led2/inner/r1", groups, (k) => own[k])).toEqual({ at: [8, -7], rotation_deg: 270, side: "top" });
    expect(placementOf("led1/r1", groups, (k) => own[k])).toEqual(own["led1/r1"]);
    expect(placementOf("led1/r2", groups, (k) => own[k])).toBeUndefined();
  });
});

/** The netlist and generate inputs of a project's board, as circuit:generate reads them. */
async function generateInputsOf(root: string, board: string) {
  const p = await loadProject(root, { checks: false, fresh: true });
  const b = p.capabilities.find((c) => c.module === board && c.capability === "circuit")!;
  const netlist = boardNetlist(p.lookup(board)!, p.lookup, boardOptions(p));
  const constraints = readConstraints(b.constraints, netlist.envelope).constraints!;
  const bodies = chooseBodies(p, netlist.components, b.native!);
  // generate points each body at its copy without interface shapes, once written (ops/circuit.ts prepareBodies)
  for (const body of bodies) if (body.step && body.stripped && body.strip?.length && withoutShapes(readFileSync(body.step, "utf8"), body.strip).removed.length) body.step = join(root, body.stripped);
  const g = generateSource({
    netlist,
    constraints,
    overrides: readOverrides(root, b.native!).overrides,
    layout: readLayout(root, b.native!).layout,
    suppliers: supplierNumbers(root, netlist.components),
    models: cadModels(root, b.native!, bodies),
  });
  return { p, b, netlist, g };
}

describe("flat boards are unchanged (spec §9)", () => {
  for (const [example, board] of [
    ["smart-bottle", "bottle-cap-board"],
    ["wearable-watch", "watch-main-board"],
  ] as const) {
    it(`${example}: the same netlist digest as its build, and the same generated source`, async () => {
      const root = join(EXAMPLES, example);
      const { b, netlist, g } = await generateInputsOf(root, board);
      expect(netlist.groups).toBeUndefined();
      expect(netlist.boundaries).toBeUndefined();
      expect(netlist.notes).toBeUndefined();
      const build = JSON.parse(readFileSync(join(root, files(b.native!).build), "utf8")) as { netlistDigest: string };
      expect(digestOf(JSON.stringify(netlist))).toBe(build.netlistDigest);
      expect(g.problems).toEqual([]);
      expect(g.source).toBe(readFileSync(join(root, files(b.native!).gen), "utf8"));
    });
  }
});

describe("net ports read as the exported pins they replace (UHD 0.3.0; review-tools r6/uhd-nested-followup.md §5)", () => {
  const PORTED = join(TMP, "lamp-ported");
  const PINNED = join(TMP, "lamp-pinned");
  beforeAll(() => {
    for (const d of [PORTED, PINNED]) {
      rmSync(d, { recursive: true, force: true });
      cpSync(FIXTURE, d, { recursive: true });
    }
    // the sensor's rails and each LED channel's ground cross as net ports of the same ids, not as a pin on the net
    const file = join(PORTED, DIR, "lamp.uhd.ts");
    let src = readFileSync(file, "utf8");
    for (const [from, to] of [
      [`{ id: "vdd_port", name: "VDD", from: { child: "s1", interfaceId: "pin_1" } }`, `{ id: "vdd_port", name: "VDD", from: { self: true, interfaceId: "vdd" } }`],
      [`{ id: "gnd_port", name: "GND", from: { child: "s1", interfaceId: "pin_2" } }`, `{ id: "gnd_port", name: "GND", from: { self: true, interfaceId: "gnd" } }`],
      [`{ id: "gnd_port", name: "GND", from: { child: "q1", interfaceId: "pin_2" } }`, `{ id: "gnd_port", name: "GND", from: { self: true, interfaceId: "gnd" } }`],
    ]) {
      expect(src).toContain(from);
      src = src.replace(from, to);
    }
    writeFileSync(file, src);
  });

  it("gives the same netlist digest and the same generated source", async () => {
    const pinned = await generateInputsOf(PINNED, BOARD);
    const ported = await generateInputsOf(PORTED, BOARD);
    expect(ported.netlist.problems).toEqual([]);
    expect(ported.netlist.notes).toBeUndefined();
    expect(digestOf(JSON.stringify(ported.netlist))).toBe(digestOf(JSON.stringify(pinned.netlist)));
    expect(ported.g.source).toBe(pinned.g.source);
  });

  it("is checked clean by UHD at the board, which now sees the rails cross", async () => {
    const p = await loadProject(PORTED, { fresh: true });
    const errors = p.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code}: ${d.message}`);
    expect(errors).toEqual([]);
  }, 120_000);

  it("reports a sub-module's supply port that nothing on the board feeds, at the board", async () => {
    const file = join(PORTED, DIR, "lamp.uhd.ts");
    const src = readFileSync(file, "utf8");
    const from = `...netLinks("v3v3", ["power:ldo__pin_5", "power:cout__pin_1", "u1:pin_1", "sensor:vdd_port"]),`;
    expect(src).toContain(from);
    writeFileSync(file, src.replace(from, `...netLinks("v3v3", ["power:ldo__pin_5", "power:cout__pin_1", "u1:pin_1"]),\n    ...netLinks("int", ["sensor:vdd_port"]),`));
    try {
      const p = await loadProject(PORTED, { fresh: true });
      const unfed = p.diagnostics.filter((d) => d.code === "UHD_UNPOWERED").map((d) => d.message);
      expect(unfed.some((m) => /sensor:vdd_port \(VDD\) is a net port feeding .*sensor\/s1:pin_1.*but no supply reaches it/.test(m)), unfed.join("\n")).toBe(true);
    } finally {
      writeFileSync(file, src);
    }
  }, 120_000);
});

describe("the grouped fixture board: generate → check → KiCad with groups → lock → check (spec §8–10)", () => {
  let netlist: BoardNetlist;
  const run = async (op: string, inputs: Record<string, string> = {}): Promise<OperationRecord> => runCapabilityOperation(await loadProject(ROOT, { checks: false, fresh: true }), "circuit", op, BOARD, inputs);
  const errors = (rec: OperationRecord) => (rec.diagnostics ?? []).filter((d) => d.severity === "error").map((d) => `${d.code}: ${d.message}`);

  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    cpSync(FIXTURE, ROOT, { recursive: true });
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("writes every part of every sub-module under its path, sub-module frames applied", async () => {
    const r = await generateInputsOf(ROOT, BOARD);
    netlist = r.netlist;
    expect(netlist.problems).toEqual([]);
    expect(netlist.components).toHaveLength(17);
    expect(netlist.nets.map((n) => n.id)).toEqual(["gnd", "int", "led1_ctl", "led1:a", "led1:k", "led2_ctl", "led2:a", "led2:k", "sensor:scl", "sensor:sda", "v3v3", "v5"]);
    expect(r.g.problems).toEqual([]);
    expect(Object.values(r.g.map.components).map((c) => c.instance)).toContain("led2/d1");
    expect(r.g.source).toContain(`name="led2_d1"`);
    // led2's frame is led1's turned half round: its LED at (0, 4) in the channel lands at (9, -9)
    expect(r.g.source).toMatch(/name="led2_d1"\s+pcbX=\{9\}\s+pcbY=\{-9\}\s+pcbRotation=\{270\}/);
    expect(r.g.source).toMatch(/<net name="led1_k" \/>/);
  });

  it("tells a layout key of a part that moved into a group where it went", async () => {
    const layout = JSON.parse(readFileSync(join(ROOT, DIR, "tscircuit/layout.json"), "utf8"));
    const { g } = await (async () => {
      writeFileSync(join(ROOT, DIR, "tscircuit/layout.json"), JSON.stringify({ ...layout, s1: { at: [1, 1] } }));
      try {
        return await generateInputsOf(ROOT, BOARD);
      } finally {
        writeFileSync(join(ROOT, DIR, "tscircuit/layout.json"), JSON.stringify(layout, null, 2) + "\n");
      }
    })();
    expect(g.notes).toEqual(["layout.json: s1 names no component or sub-module of the board; it is sensor/s1 now (a part in a sub-module is keyed by its path), so it places nothing"]);
  });

  it("generates and routes, and check finds the built board matches the expanded netlist", async () => {
    const gen = await run("generate");
    expect(gen.status, gen.summary).toBe("succeeded");
    expect(gen.summary).toMatch(/^17 components \(1 fixed, 9 layout, 7 auto\), 12 nets/);
    const check = await run("check");
    expect(errors(check)).toEqual([]);
  }, 300_000);

  it.skipIf(!kicadCli())("exports KiCad with one group per sub-module and the group on each part, locks, and checks clean", async () => {
    const kicad = await run("kicad");
    expect(kicad.status, kicad.summary).toBe("succeeded");
    const lock = await run("lock");
    expect(lock.status, lock.summary).toBe("succeeded");
    const pcb = parse(readFileSync(join(ROOT, DIR, `kicad/${BOARD}.kicad_pcb`), "utf8"));
    const fps = children(pcb, "footprint");
    const uuidOf = new Map(fps.map((f) => [text(child(f, "uuid")?.items[1]), property(f, "UHD_Instance")]));
    const groups = Object.fromEntries(
      children(pcb, "group").map((g) => [text(g.items[1]), (child(g, "members")?.items.slice(1) ?? []).map((m) => uuidOf.get(text(m))).sort()]),
    );
    expect(groups).toEqual({
      power: ["power/cin", "power/cout", "power/ldo"],
      sensor: ["sensor/c1", "sensor/r1", "sensor/r2", "sensor/s1"],
      led1: ["led1/d1", "led1/q1", "led1/r1", "led1/r2"],
      led2: ["led2/d1", "led2/q1", "led2/r1", "led2/r2"],
    });
    expect(property(fps.find((f) => property(f, "UHD_Instance") === "led2/r1")!, "UHD_Group")).toBe("led2");
    expect(property(fps.find((f) => property(f, "UHD_Instance") === "u1")!, "UHD_Group")).toBeUndefined();
    const refdes = JSON.parse(readFileSync(join(ROOT, DIR, "tscircuit/refdes.json"), "utf8")).assigned as Record<string, string>;
    expect(new Set(Object.values(refdes)).size).toBe(17);
    expect([refdes["led1/r1"], refdes["led1/r2"]]).toEqual(["R1", "R2"]);
    const check = await run("check");
    // the comparisons find nothing; KiCad's own DRC (PB-1027) reports what tscircuit's layout leaves, as export would
    expect(errors(check).filter((e) => !e.startsWith("CIRCUIT_KICAD_DRC:"))).toEqual([]);
    expect((check.diagnostics ?? []).filter((d) => d.code.startsWith("CIRCUIT_KICAD") && d.code !== "CIRCUIT_KICAD_DRC")).toEqual([]);
    for (const d of (check.diagnostics ?? []).filter((x) => x.code === "CIRCUIT_KICAD_DRC")) expect(d.message).toMatch(/^KiCad DRC: \d+ error\(s\)/);
  }, 300_000);

  it.skipIf(!kicadCli())("exports a locked board in the board frame, with a part turned in KiCad carrying KiCad's orientation", async () => {
    // turn led1's switch a quarter turn in KiCad, as an engineer would
    const file = join(ROOT, DIR, `kicad/${BOARD}.kicad_pcb`);
    const pcb = parse(readFileSync(file, "utf8"));
    const at = child(children(pcb, "footprint").find((f) => property(f, "UHD_Instance") === "led1/q1")!, "at")!;
    at.items[3] = "90";
    writeFileSync(file, printDocument(pcb));
    const rec = await run("export", { force: "true" });
    expect(rec.status, rec.summary).toBe("succeeded");
    expect(rec.summary).toMatch(/1 component\(s\) turned in KiCad: their manifest features carry KiCad's orientation/);
    const manifest = JSON.parse(readFileSync(join(ROOT, DIR, "out/board.manifest.json"), "utf8"));
    const x = manifest.features["led1/q1"].frame.xAxis as number[];
    expect(Math.abs(x[0])).toBeLessThan(1e-3);
    expect(Math.abs(Math.abs(x[1]) - 1)).toBeLessThan(1e-3);
    // board.step: the parts on top sit at the top face of a board whose mid-plane is z = 0 (1.0 mm thick)
    const step = readFileSync(join(ROOT, DIR, "out/board.step"), "utf8");
    expect(step).toMatch(/CARTESIAN_POINT\('',\(-12\.,8\.,0\.495\)\)/);
    expect(existsSync(join(ROOT, DIR, `out/gerber/${BOARD}-NPTH.drl`))).toBe(false);
  }, 300_000);
});
