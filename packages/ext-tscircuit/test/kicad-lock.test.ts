/**
 * The KiCad handoff end to end with KiCad 10 (skipped when kicad-cli is not
 * installed): the smart-bottle example's cap board, copied, is exported to
 * KiCad, locked, checked, exported from KiCad, edited by hand, and unlocked
 * (docs/specs/pcb-kicad-handoff.md). Its committed build is used as it is:
 * nothing here runs tscircuit.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject, runCapabilityOperation, type OperationRecord } from "@protoboardai/core";
import { kicadCli } from "../lib/kicad/cli.ts";
import { readHandoff } from "../lib/kicad/handoff.ts";
import { parse, children, property } from "../lib/kicad/sexpr.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EXAMPLE = join(HERE, "../../../examples/smart-bottle");
const TMP = join(HERE, ".tmp/kicad-lock");
const ROOT = join(TMP, "bottle");
const BOARD = "bottle-cap-board";
const DIR = "src/boards/bottle-cap";
const PCB = `${DIR}/kicad/${BOARD}.kicad_pcb`;

const run = async (op: string, inputs: Record<string, string> = {}): Promise<OperationRecord> => runCapabilityOperation(await loadProject(ROOT, { checks: false, fresh: true }), "circuit", op, BOARD, inputs);
const findings = async () => {
  const rec = await run("check");
  return (rec.diagnostics ?? []).map((d) => `${d.severity} ${d.code}`);
};

describe.skipIf(!kicadCli())("KiCad handoff with KiCad 10 (smart-bottle cap board)", () => {
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    cpSync(EXAMPLE, ROOT, { recursive: true, filter: (src) => !/[\\/](node_modules|\.protoboard[\\/](build|cache)|tsconfig\.json)([\\/]|$)/.test(src) });
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("circuit:kicad writes the same KiCad 10 project twice", async () => {
    const first = await run("kicad");
    expect(first.status, first.summary).toBe("succeeded");
    const files = first.outputs.map((o) => o.path).filter((p) => p.includes("/tscircuit/kicad/"));
    expect(files).toEqual(expect.arrayContaining([`${DIR}/tscircuit/kicad/${BOARD}.kicad_pcb`, `${DIR}/tscircuit/kicad/${BOARD}.kicad_sch`, `${DIR}/tscircuit/kicad/${BOARD}.kicad_pro`, `${DIR}/tscircuit/kicad/fp-lib-table`, `${DIR}/tscircuit/kicad/sym-lib-table`]));
    expect(files.some((f) => f.endsWith(".kicad_mod"))).toBe(true);
    expect(files.some((f) => /\/3d\/.*\.step$/.test(f))).toBe(true);
    const pcb = readFileSync(join(ROOT, `${DIR}/tscircuit/kicad/${BOARD}.kicad_pcb`), "utf8");
    expect(pcb).toMatch(/^\(kicad_pcb\s+\(version 2026/); // saved by KiCad 10
    expect(pcb).toContain("${KIPRJMOD}/3d/");
    expect(pcb).not.toMatch(/\/home\/|\/tmp\/|node_modules/);
    // every component footprint carries its UHD identity and its symbol's UUID
    const fps = children(parse(pcb), "footprint").filter((f) => property(f, "UHD_Instance"));
    expect(fps.length).toBe(61);
    expect(fps.find((f) => property(f, "UHD_Instance") === "u1")).toBeTruthy();
    expect(property(fps.find((f) => property(f, "UHD_Instance") === "u1")!, "LCSC")).toMatch(/^C\d+$/);
    const second = await run("kicad");
    for (const o of second.outputs) expect(first.outputs.find((x) => x.path === o.path)?.digest, o.path).toBe(o.digest);
  }, 300_000);

  it("the schematic reads as one would draw it: KiCad's ERC finds no error and nothing off the grid, pins keep the model's names (PB-1032)", () => {
    const folder = join(ROOT, `${DIR}/tscircuit/kicad`);
    const tmp = join(TMP, "erc");
    rmSync(tmp, { recursive: true, force: true });
    cpSync(folder, tmp, { recursive: true });
    const report = join(tmp, "erc.json");
    spawnSync(kicadCli()!, ["sch", "erc", "--format", "json", "--severity-all", "--output", report, join(tmp, `${BOARD}.kicad_sch`)]);
    const violations = (JSON.parse(readFileSync(report, "utf8")) as { sheets: { violations: { severity: string; type: string }[] }[] }).sheets.flatMap((s) => s.violations);
    expect(violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(violations.filter((v) => /off_grid|unconnected_wire|label_dangling|power_pin_not_driven|pin_not_connected/.test(v.type))).toEqual([]);
    const sch = parse(readFileSync(join(folder, `${BOARD}.kicad_sch`), "utf8"));
    const lib = children(sch, "lib_symbols")[0];
    const pins = children(lib, "symbol").flatMap((s) => children(s, "symbol").flatMap((u) => children(u, "pin")));
    // every pin on the 1.27 mm grid, named as the model names it, typed from the UHD leaf
    for (const pin of pins) for (const v of children(pin, "at")[0].items.slice(1, 3)) expect(Math.abs(Number(v) / 1.27 - Math.round(Number(v) / 1.27)), String(v)).toBeLessThan(1e-6);
    const names = new Set(pins.map((p) => (children(p, "name")[0].items[1] as { str: string }).str));
    expect([...names]).toEqual(expect.arrayContaining(["VBUS", "CC1", "GND", "SDA", "SCL", "BAT-_pad"]));
    expect([...names].some((n) => /__|_{3,}/.test(n))).toBe(false);
    const types = new Set(pins.map((p) => p.items[1] as string));
    expect([...types]).toEqual(expect.arrayContaining(["power_in", "power_out", "input", "output", "bidirectional", "passive"]));
  }, 120_000);

  it("circuit:lock hands the board to KiCad; generate then refuses; check finds the KiCad side as handed off", async () => {
    const lock = await run("lock");
    expect(lock.status, lock.summary).toBe("succeeded");
    expect(readHandoff(ROOT, DIR)).toMatchObject({ state: "locked", board: BOARD, tools: { kicad: expect.stringMatching(/^10\./), converter: "0.0.237" } });
    expect(existsSync(join(ROOT, `${DIR}/tscircuit/refdes.json`))).toBe(true);
    expect((await run("lock")).summary).toMatch(/already locked/);
    const gen = await run("generate");
    expect(gen.status).toBe("failed");
    expect(gen.summary).toMatch(/is locked/);
    const found = await findings();
    expect(found).toContain("info CIRCUIT_LOCKED");
    // the comparisons find nothing; KiCad's own DRC reports the tscircuit layout's findings (PB-1027, F24)
    expect(found.filter((f) => f.includes("CIRCUIT_KICAD"))).toEqual(["error CIRCUIT_KICAD_DRC"]);
    // where KiCad has each part at lock (F26), and the antenna keep-out's exception for u1 as a KiCad rule (F23)
    expect(readHandoff(ROOT, DIR)?.positions?.u1).toEqual({ x: 22.8, y: 0, rot: 270, side: "top" });
    const dru = readFileSync(join(ROOT, `${DIR}/kicad/${BOARD}.kicad_dru`), "utf8");
    expect(dru).toContain("A.intersectsArea('antenna') && A.Reference != 'U1'");
    expect(dru).toContain("(constraint via_diameter (min 0.6mm))");
    // check is pure: KiCad's local settings file is not left in the project
    expect(readdirSync(join(ROOT, `${DIR}/kicad`)).filter((f) => f.endsWith(".kicad_prl"))).toEqual([]);
    // the KiCad project is the board's layout of record now, attached to it by itself (PB-1030): the viewer offers it
    const kicad = (await loadProject(ROOT, { checks: false, fresh: true })).definitions.get(BOARD)!.def.artifacts!.find((a) => a.id === "board_kicad");
    expect(kicad).toMatchObject({ role: "source", format: "kicad", filePath: `${DIR}/kicad/${BOARD}.kicad_pro` });
  }, 300_000);

  it("circuit:export makes the fabrication outputs with kicad-cli, stopping on DRC errors unless forced", async () => {
    const stopped = await run("export");
    expect(stopped.status).toBe("failed");
    expect(stopped.summary).toMatch(/KiCad DRC: \d+ error/);
    const rec = await run("export", { force: "true" });
    expect(rec.status, rec.summary).toBe("succeeded");
    // check and export count KiCad's DRC the same way (F25); u1 is not in its own keep-out (F23); nothing moved (F26)
    const drcLine = /KiCad DRC: [^;]*schematic parity/.exec(rec.summary)![0];
    const checked = (await run("check")).diagnostics!.find((d) => d.code === "CIRCUIT_KICAD_DRC")!;
    expect(checked.message.startsWith(drcLine)).toBe(true);
    expect(rec.summary).not.toMatch(/positions of \d+ component\(s\) taken from KiCad/);
    const drc = JSON.parse(readFileSync(join(ROOT, `${DIR}/out/drc.json`), "utf8")) as { violations: { type: string; items: { description: string }[] }[] };
    expect(drc.violations.filter((v) => v.type === "items_not_allowed")).toEqual([]);
    expect((rec.diagnostics ?? []).filter((d) => d.severity === "error")).toEqual([]);
    const out = join(ROOT, `${DIR}/out`);
    const gerber = readdirSync(join(out, "gerber"));
    expect(gerber.some((f) => f.endsWith("F_Cu.gbr"))).toBe(true);
    expect(gerber.some((f) => f.endsWith(".drl"))).toBe(true);
    const pnp = readFileSync(join(out, "pnp.csv"), "utf8").split("\n");
    expect(pnp[0]).toBe("instance,x_mm,y_mm,rotation_deg,side,part,mpn,package,lcsc");
    // the supplier numbers the unlocked export gives (PB-1033): in the pick-and-place and the BOM of a locked board too
    expect(pnp.find((l) => l.startsWith("u1,"))).toMatch(/,C\d+$/);
    expect(readFileSync(join(out, "bom.csv"), "utf8").split("\n").find((l) => l.startsWith("u1,"))).toMatch(/,C\d+,lcsc:C\d+/);
    // in the board frame: u1 where the config fixes it
    expect(pnp.find((l) => l.startsWith("u1,"))).toMatch(/^u1,22\.8,0,270,top,/);
    expect(JSON.parse(readFileSync(join(out, "board.manifest.json"), "utf8")).tool).toBe("kicad");
  }, 300_000);

  it("check reports hand edits in KiCad, and a model change made there too as applied", async () => {
    const file = join(ROOT, PCB);
    const before = readFileSync(file, "utf8");
    writeFileSync(file, before.replace(/\(net "led_en"\)/g, '(net "led_enable")'));
    expect(await findings()).toContain("warning CIRCUIT_KICAD_NET_RENAMED");
    writeFileSync(file, before);
    expect((await findings()).filter((f) => f.includes("CIRCUIT_KICAD") && !f.includes("CIRCUIT_KICAD_DRC"))).toEqual([]);
  }, 300_000);

  it("circuit:unlock archives kicad/ and returns the board to tscircuit", async () => {
    const rec = await run("unlock");
    expect(rec.status, rec.summary).toBe("succeeded");
    expect(existsSync(join(ROOT, `${DIR}/kicad`))).toBe(false);
    const archive = readdirSync(join(ROOT, `${DIR}/kicad-archive`));
    expect(archive).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(ROOT, `${DIR}/kicad-archive/${archive[0]}/handoff.json`), "utf8"))).toMatchObject({ state: "unlocked", unlockedAt: expect.any(String) });
    expect(existsSync(join(ROOT, `${DIR}/kicad-archive/${archive[0]}/${BOARD}.kicad_pcb`))).toBe(true);
    expect(await findings()).not.toContain("info CIRCUIT_LOCKED");
    expect((await loadProject(ROOT, { checks: false, fresh: true })).definitions.get(BOARD)!.def.artifacts!.some((a) => a.id === "board_kicad")).toBe(false);
  }, 300_000);
});
