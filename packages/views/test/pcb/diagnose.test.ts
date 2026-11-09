/**
 * The routing diagnosis (L4) on a host: bounded to the net's open links (a pour net only where its fill does not
 * reach, none: no router runs), one time budget for the whole diagnosis with stages that stop and say so, progress,
 * and the cache (memory and a file under the board's build folder). The built-in router stands in for the product's
 * routers, which are slow.
 */
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDocument, mm, type BoardRecord, type BoardSnapshot, type Vertex } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { builtinRouter, netsInScope, type RouteJob, type Router } from "@protoboardai/board-route";
import { clearDiagnosisMemory, diagnoseNet, diagnosisCacheDir } from "../../src/pcb/host/diagnose.js";
import type { DiagnosisProgress } from "../../src/pcb/types.js";

const snap = (doc: BoardSnapshot["doc"], seq = 0): BoardSnapshot => ({ doc, seq, epoch: "dg0001" }) as BoardSnapshot;

/** A router that records every job it is given (and routes with the built-in router). */
function spy(base: Router = builtinRouter()): { router: Router; jobs: RouteJob[] } {
  const jobs: RouteJob[] = [];
  return {
    jobs,
    router: { ...base, available: () => base.available(), version: () => base.version(), express: (j) => base.express(j), route: (job, signal, p) => (jobs.push(job), base.route(job, signal, p)) },
  };
}

const rect = (w: number, h: number, cx = 0, cy = 0): Vertex[] => [
  { x: mm(cx - w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy + h / 2) },
  { x: mm(cx - w / 2), y: mm(cy + h / 2) },
];

/** Two test pads of net G, far apart, under a solid top pour of G: the pour joins them, nothing is open. */
function pouredBoard(): BoardSnapshot["doc"] {
  const pad = (ref: string, x: number): BoardRecord => ({ kind: "footprint", id: `fp:${ref}`, ref, footprint: `Test:${ref}`, x: mm(x), y: 0, rotation: 0, side: "top", pads: [{ number: "1", type: "smd", shape: "rect", x: 0, y: 0, width: mm(1), height: mm(1) }], provenance: { by: "generated", tool: "test" } });
  const records: BoardRecord[] = [
    { kind: "board", id: "board", name: "Pour test", thickness: mm(1.6), copper_layers: 2, origin: "center" },
    { kind: "layer", id: "layer:top", name: "top", type: "copper", order: 0, thickness: mm(0.035) },
    { kind: "layer", id: "layer:core", name: "core", type: "dielectric", order: 1, thickness: mm(1.5) },
    { kind: "layer", id: "layer:bottom", name: "bottom", type: "copper", order: 2, thickness: mm(0.035) },
    { kind: "outline", id: "outline", outline: rect(30, 20), source: { kind: "board" }, provenance: { by: "generated", tool: "test" } },
    pad("TP1", -8),
    pad("TP2", 8),
    { kind: "zone", id: "zone:g", name: "G top", net: "G", layers: ["top"], outline: rect(26, 16), clearance: mm(0.25), fill_mode: "solid", pad_connection: "solid", priority: 0, remove_islands: "always", thermal_gap: mm(0.25), thermal_spoke_width: mm(0.3), provenance: { by: "hand" } } as BoardRecord,
  ];
  return createDocument(records, { source: "fixture", nets: [{ name: "G", pins: ["TP1.1", "TP2.1"] }] });
}

beforeEach(() => clearDiagnosisMemory());

describe("routing diagnosis: bounded to the open links", () => {
  it("leaves a net to its pour and runs no router when the fill joins every pad", async () => {
    const s = spy();
    const seen: DiagnosisProgress[] = [];
    const v = await diagnoseNet(snap(pouredBoard()), "G", { routers: [s.router], onProgress: (p) => seen.push(p) });
    expect(v.verdict).toBe("connected");
    expect(v.links).toBe(0);
    expect(v.pour).toMatchObject({ zones: ["zone:g"], links: 0 });
    expect(v.pour!.note).toMatch(/^left to its pour/);
    expect(v.summary).toMatch(/left to its pour/);
    expect(s.jobs).toEqual([]);
    expect(v.attempts).toEqual([]);
    expect(v.options).toEqual([]);
    expect(seen.at(-1)).toMatchObject({ stage: "done", fraction: 1 });
  });

  it("routes only the links a pour does not make, and only the net's open islands", async () => {
    const doc = airnodeC3();
    const s = spy();
    const v = await diagnoseNet(snap(doc), "GND", { routers: [s.router], budgetMs: 20_000 });
    // GND has a pour: it is said up front, and the router is given only the islands its fill leaves apart
    expect(v.pour?.zones.length).toBeGreaterThan(0);
    expect(v.pour!.note).toMatch(/left to its pour/);
    const own = netsInScope(doc, { kind: "nets", nets: ["GND"] }).nets[0].islands.length;
    expect(s.jobs.length).toBeGreaterThan(0);
    expect(s.jobs[0].nets.map((n) => n.net)).toEqual(["GND"]);
    expect(s.jobs[0].nets[0].islands.length).toBe(v.links! + 1);
    expect(v.links! + 1).toBeLessThan(own);
    // a signal net: one net, its own islands only, every stage on that net alone
    const t = spy();
    const w = await diagnoseNet(snap(doc), "I2C_SCL", { routers: [t.router], budgetMs: 20_000 });
    expect(w.pour).toBeUndefined();
    for (const j of t.jobs) expect(j.nets.map((n) => n.net)).toEqual(["I2C_SCL"]);
    expect(w.notes?.join(" ")).toMatch(/scored by what changed/);
  });
});

describe("routing diagnosis: one time budget", () => {
  it("stops each stage when the budget runs out, says what was cut, and reports progress", async () => {
    // a router that takes 2 s per net: neither the attempt nor the probe beside it fits in 1.5 s
    const slow = builtinRouter({ id: "slow", delayMs: 2000 });
    const seen: DiagnosisProgress[] = [];
    const t0 = Date.now();
    const v = await diagnoseNet(snap(airnodeC3()), "I2C_SCL", { routers: [slow], budgetMs: 1500, onProgress: (p) => seen.push(p), cache: false });
    const took = Date.now() - t0;
    // the budget, the backstop for a router stopped at it (this one looks only between nets), and load
    expect(took).toBeLessThan(1500 + 1500);
    expect(v.budgetMs).toBe(1500);
    expect(v.stopped?.length).toBeGreaterThan(0);
    expect(v.stopped!.join("; ")).toMatch(/time budget|budget ran out/);
    expect(v.verdict).toBe("unknown");
    expect(v.summary).toMatch(/budget ran out/);
    expect(v.attempts[0]).toMatchObject({ router: "slow", status: "timeout" });
    expect(v.options.every((o) => o.result.skipped)).toBe(true);
    const stages = [...new Set(seen.map((p) => p.stage))];
    expect(stages[0]).toBe("connectivity");
    expect(stages).toContain("attempt");
    expect(seen.at(-1)!.stage).toBe("done");
    // the fraction never goes back, and the time is against the budget
    for (let i = 1; i < seen.length; i++) expect(seen[i].fraction).toBeGreaterThanOrEqual(seen[i - 1].fraction);
    expect(seen.every((p) => p.budgetMs === 1500)).toBe(true);
  });
});

describe("routing diagnosis: cache", () => {
  it("answers again from memory, then from the file under the board's build folder, marked cached", async () => {
    const root = mkdtempSync(join(tmpdir(), "pb-diagnose-"));
    writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
    const dir = join(root, "board");
    const doc = airnodeC3();
    const s = spy();
    const first = await diagnoseNet(snap(doc, 3), "I2C_SCL", { routers: [s.router], dir, budgetMs: 20_000 });
    const runs = s.jobs.length;
    expect(first.cached).toBe(false);
    expect(first.hash).toMatch(/^[0-9a-f]{20}$/);
    expect(readdirSync(diagnosisCacheDir(dir))).toEqual([`${first.hash}.json`]);
    const again = await diagnoseNet(snap(doc, 4), "I2C_SCL", { routers: [s.router], dir, budgetMs: 20_000 });
    expect(again.cached).toBe(true);
    expect(again.seq).toBe(4);
    expect(again.verdict).toBe(first.verdict);
    expect(s.jobs.length).toBe(runs);
    clearDiagnosisMemory();
    const fromFile = await diagnoseNet(snap(doc, 5), "I2C_SCL", { routers: [s.router], dir, budgetMs: 20_000 });
    expect(fromFile.cached).toBe(true);
    expect(fromFile.summary).toBe(first.summary);
    expect(s.jobs.length).toBe(runs);
    // another budget, another net or a changed board is another answer
    const other = await diagnoseNet(snap(doc), "I2C_SCL", { routers: [s.router], dir, budgetMs: 19_000 });
    expect(other.cached).toBe(false);
    expect(other.hash).not.toBe(first.hash);
  });
});
