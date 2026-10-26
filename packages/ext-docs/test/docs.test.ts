/**
 * @protoboardai/ext-docs (PB-801): the technical-documents generator that UHD
 * held in scripts/docs, on a Protoboard project. Exercised on the quadcopter:
 *   - the project loads as a document system: root system, scenarios,
 *     docs/docspec.ts, artifact files resolved per origin (project or the
 *     package a catalog part came from), evidence from parts/evidence and the
 *     catalog package;
 *   - the doc spec's queries all resolve and its steps cover every mate,
 *     hardware placement and wiring link;
 *   - the committed documents are current: their BOM file is the live BOM,
 *     and every bound value re-resolves to the text the document shows;
 *   - with Chrome present, `protoboard run tech-docs-verify` passes on the
 *     committed documents.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { findBrowser, loadProject } from "@protoboardai/core";
import { bomFile, buildContext } from "../lib/context.ts";
import { planSteps } from "../lib/docs/assembly.ts";
import { formatValue } from "../lib/format.ts";
import { resolveServed } from "../lib/render/server.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
const QUAD = join(REPO, "examples/quadcopter-5in");
const CLI = join(REPO, "packages/cli/bin/protoboard.mjs");
const TMP = join(HERE, ".tmp");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const chrome = findBrowser()?.path ?? "google-chrome";
const hasChrome = spawnSync(chrome, ["--version"]).status === 0 && spawnSync("pdfinfo", ["-v"]).status === 0;

const ctx = await buildContext(await loadProject(QUAD));
const DOCS = ["quadcopter-5in-datasheet", "quadcopter-5in-assembly-guide"];

describe("the quadcopter as a document system", () => {
  it("loads the project's root system, scenarios and doc spec", () => {
    expect(ctx.sys).toMatchObject({ name: "quadcopter-5in", docsDir: "docs" });
    expect(ctx.sys.system.id).toBe("quadcopter-5in");
    expect(ctx.sys.scenarios.map((s) => s.id)).toContain("o4-on-vbat");
    expect(ctx.sys.config).toMatchObject({ docId: "UHD-QUAD5", root: ["frame"], testData: { standins: "multirotor" } });
  });

  it("resolves artifact files per origin: project files, and the parts/catalog directory a catalog revision was vendored into", () => {
    const frame = ctx.sys.lookup("quadcopter-5in-frame")!;
    const motor = ctx.sys.lookup("meps-neon-2207-v2-1950kv")!;
    const glb = (id: string) => ctx.scene.bodies.find((b) => b.def.id === id)!.glb!;
    expect(glb(frame.id)).toBe("project/src/modules/frame/out/body.glb");
    expect(glb(motor.id)).toMatch(/^project\/parts\/catalog\/meps-neon-2207-v2-1950kv\/library\/parts\/meps-neon-2207-v2-1950kv\//);
    for (const b of ctx.scene.bodies.filter((x) => x.glb && !x.vendor)) expect(existsSync(resolveServed(ctx.sys.roots, b.glb!)!), b.key).toBe(true);
    expect(resolveServed(ctx.sys.roots, "project/../outside")).toBeUndefined();
    // body volumes come from each origin's manifest: the frame's from the project, the screws' from their cad:export (ext-frame-cad)
    expect(ctx.resolve("derived:mass.module(quadcopter-5in-frame)").value).toBeGreaterThan(0);
  });

  it("finds evidence in parts/evidence (local part) and in what the catalog revision vendored (parts/catalog/<id>)", () => {
    expect(ctx.resolve("ver:panasonic-eeu-fr1v471:partId")).toMatchObject({ value: "panasonic-eeu-fr1v471", source: "parts/evidence/panasonic-eeu-fr1v471/verification.json" });
    expect(ctx.resolve("ver:meps-neon-2207-v2-1950kv:audit.confirmed").status).toBe("model");
    const motorLine = ctx.liveBom.find((r) => r.partId === "meps-neon-2207-v2-1950kv")!;
    expect(motorLine).toMatchObject({ quantity: 4, buy: "purchase", verification: expect.stringMatching(/^audited \d+\/\d+$/) });
    // every bought part names its source, except the assembly materials, which are specified by kind with no product chosen yet
    const consumable = (id: string) => (ctx.sys.lookup(id)?.tags ?? []).includes("consumable");
    expect(ctx.liveBom.filter((r) => r.buy === "purchase" && !r.source && !consumable(r.partId)).map((r) => r.partId)).toEqual([]);
  });

  it("every key figure and specification query resolves, and the steps cover the whole assembly", () => {
    const ds = ctx.sys.config.datasheet!;
    const qs = [...(ds.keyFigures ?? []).map((k) => k.q), ...(ds.specGroups ?? []).flatMap((g) => g.rows.map((r) => r.q))];
    expect(qs.length).toBeGreaterThan(40);
    expect(qs.filter((q) => ctx.resolve(q).status === "gap")).toEqual([]);
    const plans = planSteps({ ctx } as never);
    expect(plans.filter((p) => p.spec.id.startsWith("auto-")).map((p) => p.spec.id)).toEqual([]);
  });
});

describe("the committed quadcopter documents", () => {
  it("publish the live BOM", () => {
    expect(JSON.parse(readFileSync(join(QUAD, bomFile(ctx.sys)), "utf8"))).toEqual(ctx.liveBom);
  });

  it.each(DOCS)("%s: every bound value re-resolves to the text the document shows", (name) => {
    const { values } = JSON.parse(readFileSync(join(QUAD, "docs", `${name}.values.json`), "utf8")) as { values: { q: string; f?: string; text: string; status: string }[] };
    expect(values.length).toBeGreaterThan(40);
    const stale = values.filter((v) => {
      const r = ctx.resolve(v.q);
      const text = r.status === "gap" && (r.value === undefined || r.value === null) ? "—" : formatValue(r.value, r.unit, v.f ?? undefined);
      return text.replace(/\s+/g, " ").trim() !== v.text.replace(/\s+/g, " ").trim() || r.status !== v.status;
    });
    expect(stale.map((v) => v.q)).toEqual([]);
    for (const ext of ["html", "pdf"]) expect(existsSync(join(QUAD, "docs", `${name}.${ext}`))).toBe(true);
  });
});

describe.skipIf(!hasChrome)("tech-docs-verify with Chrome", () => {
  it("passes on the committed documents (in a copy of the project)", () => {
    const dir = join(TMP, "verify");
    rmSync(dir, { recursive: true, force: true });
    cpSync(QUAD, dir, { recursive: true, filter: (src) => !/[/\\](node_modules|\.protoboard|\.claude|\.review)$/.test(src) && !/[/\\]operations[/\\]/.test(src) });
    const r = spawnSync(process.execPath, [CLI, "run", "tech-docs-verify", "--format", "json", "--cwd", dir], { encoding: "utf8", timeout: 300000 });
    const json = JSON.parse(r.stdout || "null");
    expect(json.data.findings.filter((f: { severity: string }) => f.severity === "error")).toEqual([]);
    expect(json.status).toBe("succeeded");
    expect(json.outputs.map((o: { path: string }) => o.path)).toEqual(["docs/.review/verify-report.json"]);
  }, 300000);
});
