/**
 * The electrical checks (with the 5 V fault), the agent scene and its markers, the renderer, and the flat KiCad
 * export: the exported schematic's netlist equals the circuit's, it plots, and ERC finds no errors. The KiCad
 * part is skipped when kicad-cli is not installed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { airnodeSchematic } from "../src/fixtures/airnode-c3.ts";
import { circuitNetlist, describeSchematic, electricalChecks, exportKicad, findKicadCli, netlistsEqual, readKicadNetlist, renderSchematicSvg, scoreSchematic, type SchematicDocument } from "../src/index.ts";

let ok: SchematicDocument;
let fault: SchematicDocument;
beforeAll(async () => {
  ok = await airnodeSchematic("ok");
  fault = await airnodeSchematic("fault");
});

describe("electrical checks", () => {
  it("find nothing wrong with the good board", () => {
    const f = electricalChecks(ok.circuit, ok);
    expect(f.filter((x) => x.severity !== "info")).toEqual([]);
  });

  it("flag the BOOT pull-up on 5 V with the path that explains it", () => {
    const v = electricalChecks(fault.circuit, fault).filter((x) => x.check === "voltage");
    expect(v.length).toBe(1);
    expect(v[0]).toMatchObject({ severity: "error", measured: 5, required: 3.6 });
    expect(v[0].path).toEqual(["J1 VBUS (supply out, 5 V)", "VBUS", "R8 10k", "BOOT", "U1 pin 13 IO9 (max 3.6 V)"]);
    expect(v[0].location?.card).toBe("card:mcu");
  });

  it("report unconnected pins, single-pin nets and conflicting outputs", () => {
    const c = structuredClone(ok.circuit) as typeof ok.circuit;
    const mcu = c.parts.find((p) => p.path === "mcu/module")!;
    delete mcu.unconnected;
    c.nets.push({ name: "LONELY", kind: "signal", pins: ["mcu/module:pin_4"] });
    const vbus = c.nets.find((n) => n.name === "VBUS")!;
    vbus.pins.push("power/ldo:pin_5");
    c.nets.find((n) => n.name === "+3V3")!.pins.splice(c.nets.find((n) => n.name === "+3V3")!.pins.indexOf("power/ldo:pin_5"), 1);
    const f = electricalChecks(c);
    expect(f.some((x) => x.check === "unconnected_pin" && x.objects.includes("pin:mcu/module:pin_5"))).toBe(true);
    expect(f.some((x) => x.check === "single_pin_net" && x.objects.includes("net:LONELY"))).toBe(true);
    expect(f.some((x) => x.check === "conflicting_outputs" && x.severity === "error")).toBe(true);
  });
});

describe("scene and image", () => {
  it("numbers its markers like the defects and findings, and is stable", () => {
    const a = describeSchematic(fault, { image: "svg" });
    const b = describeSchematic(fault, { image: "svg" });
    expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
    expect(a.svg).toBe(b.svg);
    const score = scoreSchematic(fault);
    const markers = a.json.markers as [number, string][];
    for (const d of score.defects.filter((x) => x.severity !== "info")) expect(markers).toContainEqual([d.n, d.id]);
    const findings = a.json.findings as { n: number; check: string }[];
    const v = findings.find((f) => f.check === "voltage")!;
    expect(markers.some(([n]) => n === v.n)).toBe(true);
    expect((a.json.cards as { digest: string }[]).every((c) => c.digest.length > 20)).toBe(true);
  });

  it("crops to one card and renders both themes without fonts", () => {
    const crop = describeSchematic(ok, { card: "card:sensor", image: "png" });
    expect(crop.png!.length).toBeGreaterThan(1000);
    expect((crop.json.parts as unknown[]).length).toBe(4);
    for (const theme of ["dark", "paper"] as const) {
      const svg = renderSchematicSvg(ok, { theme });
      expect(svg).not.toMatch(/<text/);
      expect(svg).toBe(renderSchematicSvg(ok, { theme }));
    }
  });
});

describe("flat KiCad export", () => {
  it("reads a KiCad netlist", () => {
    const text = `(export (version "E") (nets (net (code "1") (name "GND") (class "Default") (node (ref "R1") (pin "2")) (node (ref "C1") (pin "2"))) (net (code "2") (name "unconnected-(U1-Pad4)") (node (ref "U1") (pin "4")))))`;
    expect(readKicadNetlist(text)).toEqual([{ name: "GND", nodes: ["C1.2", "R1.2"] }]);
  });

  const cli = findKicadCli();
  it.skipIf(!cli)("imports cleanly: same netlist as the circuit, plots, and passes ERC", () => {
    const dir = mkdtempSync(join(tmpdir(), "schematic-kicad-"));
    const ex = exportKicad(ok, { dir, project: "airnode" });
    execFileSync(cli!, ["sch", "export", "netlist", "--format", "kicadsexpr", "-o", join(dir, "net.txt"), join(dir, ex.root)]);
    const eq = netlistsEqual(readKicadNetlist(readFileSync(join(dir, "net.txt"), "utf8")), circuitNetlist(ok));
    expect(eq).toEqual({ equal: true, onlyA: [], onlyB: [] });
    execFileSync(cli!, ["sch", "export", "svg", "-o", join(dir, "svg"), join(dir, ex.root)]);
    expect(readdirSync(join(dir, "svg")).filter((f) => f.endsWith(".svg")).length).toBe(7);
    execFileSync(cli!, ["sch", "erc", "--format", "json", "-o", join(dir, "erc.json"), join(dir, ex.root)]);
    const erc = JSON.parse(readFileSync(join(dir, "erc.json"), "utf8")) as { sheets: { violations: { severity: string; type: string }[] }[] };
    const errors = erc.sheets.flatMap((s) => s.violations).filter((v) => v.severity === "error");
    expect(errors).toEqual([]);
  });
});
