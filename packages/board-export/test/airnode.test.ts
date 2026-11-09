/**
 * The Airnode C3 fixture through every export: the round trip through this package's readers, determinism (the same
 * board twice gives byte-identical folders), the tracked golden package (`test/golden/airnode-c3-jlcpcb/`, every file
 * but the PNGs, whose hashes the golden manifest holds for the SVGs), and the ready/override rules.
 *
 * Update the golden package after an intended change: `PB_UPDATE_GOLDEN=1 npx vitest run packages/board-export`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { recordsOfKind } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { countObjects, exportBom, exportFabPackage, exportGerbers, gerberTexts, optionsFromInput, readGerber, unzipStored, EXPORT_COMMANDS, GENERATOR, type ExportOptions } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, "golden", "airnode-c3-jlcpcb");
const tmp = mkdtempSync(join(tmpdir(), "pb-board-export-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/** The part data the golden package uses: one consigned connector and one DNP LED; the rest has no supplier number. */
const PARTS: ExportOptions["parts"] = { J1: { consigned: "USB-C receptacle supplied by the customer", libraryClass: "extended" }, D2: { dnp: true } };

describe("Airnode C3 round trip", () => {
  it("writes every fab layer and reads it back with the counts the board implies", () => {
    const texts = gerberTexts(airnodeC3(), "generic");
    expect(Object.keys(texts).sort()).toEqual(["copper:bottom", "copper:top", "legend:bottom", "legend:top", "paste:bottom", "paste:top", "profile", "soldermask:bottom", "soldermask:top"]);
    const doc = airnodeC3();
    const pads = recordsOfKind(doc, "footprint").reduce((n, f) => n + f.pads.length, 0);
    const th = recordsOfKind(doc, "footprint").reduce((n, f) => n + f.pads.filter((p) => p.type === "th").length, 0);
    const vias = recordsOfKind(doc, "via").length;
    const tracks = recordsOfKind(doc, "track");
    const top = countObjects(readGerber(texts["copper:top"]));
    // every top pad (all of this board's pads are on the top side or drilled) and every via, each once
    expect(top.flashes).toBe(pads + vias);
    expect(top.draws + top.arcs).toBe(tracks.filter((t) => t.layer === "top").length);
    expect(top.arcs).toBe(tracks.filter((t) => t.layer === "top" && t.sweep !== undefined).length);
    const bottom = countObjects(readGerber(texts["copper:bottom"]));
    expect(bottom.flashes).toBe(th + vias);
    // one zone (GND, bottom), filled as regions without holes left over as separate contours
    expect(bottom.regions).toBeGreaterThan(0);
    for (const [id, t] of Object.entries(texts)) {
      const r = readGerber(t);
      expect(r.errors, id).toEqual([]);
      expect(r.warnings, id).toEqual([]);
    }
  });

  it("writes the same bytes twice (determinism, PNG included)", async () => {
    const a = join(tmp, "det-a");
    const b = join(tmp, "det-b");
    await exportFabPackage(airnodeC3(), "jlcpcb", { outDir: a, parts: PARTS });
    await exportFabPackage(airnodeC3(), "jlcpcb", { outDir: b, parts: PARTS });
    const fa = listFiles(a);
    expect(fa).toEqual(listFiles(b));
    for (const f of fa) expect(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), f).toBe(true);
    // no clock in any file unless asked
    const gerber = readFileSync(join(a, fa.find((f) => f.endsWith(".gtl"))!), "utf8");
    expect(gerber).not.toContain("CreationDate");
    // a second export into the same folder replaces the first one's files
    await exportFabPackage(airnodeC3(), "jlcpcb", { outDir: a, parts: PARTS });
    expect(listFiles(a)).toEqual(fa);
  });

  it("matches the tracked golden package", async () => {
    const out = join(tmp, "golden");
    await exportFabPackage(airnodeC3(), "jlcpcb", { outDir: out, parts: PARTS, png: false });
    const files = listFiles(out).filter((f) => !f.startsWith("images/"));
    if (process.env.PB_UPDATE_GOLDEN) {
      rmSync(GOLDEN, { recursive: true, force: true });
      for (const f of files) {
        mkdirSync(dirname(join(GOLDEN, f)), { recursive: true });
        writeFileSync(join(GOLDEN, f), readFileSync(join(out, f)));
      }
    }
    expect(existsSync(GOLDEN), "golden package missing: run with PB_UPDATE_GOLDEN=1").toBe(true);
    expect(files).toEqual(listFiles(GOLDEN));
    for (const f of files) expect(readFileSync(join(out, f), "utf8"), f).toBe(readFileSync(join(GOLDEN, f), "utf8"));
  });

  it("is not ready while checks fail, and records an override with its reason", async () => {
    const out = join(tmp, "override");
    const r = await exportFabPackage(airnodeC3(), "jlcpcb", { outDir: out, parts: PARTS, png: false });
    expect(r.preflight.verdict).toBe("not-ready");
    // nothing named an upload is written for a package that is not ready
    expect(r.files.some((f) => f.path.endsWith("-upload.zip"))).toBe(false);
    const o = await exportFabPackage(airnodeC3(), "jlcpcb", { outDir: out, parts: PARTS, png: false, override: { reason: "sample board: routing unfinished on purpose", by: "test" } });
    expect(o.preflight.verdict).toBe("overridden");
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(m.override.reason).toBe("sample board: routing unfinished on purpose");
    expect(m.override.failed.length).toBeGreaterThan(0);
    const z = o.files.find((f) => f.path.endsWith("-upload.zip"))!;
    const entries = unzipStored(new Uint8Array(readFileSync(join(out, z.path)))).map((e) => e.name);
    expect(entries.every((n) => /\.(gtl|gbl|gts|gbs|gtp|gbp|gto|gbo|gm1|drl)$/.test(n))).toBe(true);
    expect(m.generator.version).toBe(GENERATOR[2]);
    expect(GENERATOR[2]).toBe(JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version);
  });

  it("validates its own output: every read-back check passes on the fixture", async () => {
    const r = await exportFabPackage(airnodeC3(), "jlcpcb", { outDir: join(tmp, "checks"), parts: PARTS, png: false });
    const status = (id: string) => r.preflight.items.find((i) => i.id === id)?.status;
    for (const id of ["gerber.parse", "gerber.copper", "gerber.fill", "nets.attributes", "profile.closed", "drill.readback", "drill.registration", "netlist.ipc356", "placement.rows", "bom.designators", "dxf.readback"]) expect(status(id), id).toBe("pass");
    // the fixture has no LCSC numbers: flagged, never guessed
    expect(status("bom.supplier")).toBe("fail");
    expect(r.preflight.items.find((i) => i.id === "bom.consigned")!.title).toContain("J1");
    // KiCad steps report what they need instead of failing silently
    expect(r.preflight.items.find((i) => i.id === "kicad.cross")!.title).toContain("needs KiCad");
  });

  it("one command per export writes only its files, each with an image", async () => {
    const g = await exportGerbers(airnodeC3(), "generic", { outDir: join(tmp, "only-gerbers"), png: false });
    expect(g.files.every((f) => f.path.startsWith("fab/files/") && f.image?.svg)).toBe(true);
    const b = await exportBom(airnodeC3(), "circuithub", { outDir: join(tmp, "only-bom"), png: false });
    expect(b.files.map((f) => f.path)).toEqual(["assembly/Airnode-C3-bom-circuithub.csv", "assembly/Airnode-C3-bom.csv", "data/Airnode-C3-bom.json"]);
    expect(readFileSync(join(tmp, "only-bom", "assembly/Airnode-C3-bom-circuithub.csv"), "utf8").split("\n")[0]).toBe("Designators,Quantity,Manufacturer,MPN,Description,Value,Footprint,DNP,Consigned,Supplier,Supplier Part Number");
  });

  it("describes every command for the CLI and MCP bindings", () => {
    expect(EXPORT_COMMANDS.map((c) => c.name)).toEqual(["package", "gerbers", "drill", "bom", "placement", "ipc356", "dxf", "ipc2581"]);
    for (const c of EXPORT_COMMANDS) expect(c.description.length).toBeGreaterThan(60);
    const { profile, options } = optionsFromInput({ board: "b", out: "o", origin: "lower-left" });
    expect(profile).toBe("jlcpcb");
    expect(options.origin).toBe("lower-left");
    expect(() => optionsFromInput({ board: "b", out: "o", profile: "nope" })).toThrow();
  });
});
