/**
 * The kernel's diagnosis of one net (contract phase2-editing.md, section 6.3) within one time budget: only the net's
 * open links (a pour net only where its fill does not reach), the budget respected and what it cut reported, and the
 * cache by input hash. The built-in router stands in for the product's routers.
 */
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardBuildDir, findProjectRoot, openBoardService, type BoardSnapshot } from "@protoboardai/board/node";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import type { RouteJob, Router } from "@protoboardai/board-route";
import { builtinRouter, diagnoseNet } from "../src/service.js";

function spy(base: Router = builtinRouter()): { router: Router; jobs: RouteJob[] } {
  const jobs: RouteJob[] = [];
  return { jobs, router: { ...base, available: () => base.available(), version: () => base.version(), express: (j) => base.express(j), route: (job, signal, p) => (jobs.push(job), base.route(job, signal, p)) } };
}

const snapOf = (doc = airnodeC3()): BoardSnapshot => openBoardService({ document: doc, epoch: "kd0001" }).snapshot();

describe("the kernel's diagnosis", () => {
  it("routes only the links a pour leaves open, and says the net is left to its pour", async () => {
    const s = spy();
    const d = await diagnoseNet(snapOf(), "GND", { routers: [s.router], budgetMs: 20_000, cache: false });
    expect(d.pour?.note).toMatch(/^left to its pour/);
    expect(d.messages[0]).toMatch(/^left to its pour/);
    expect(s.jobs.length).toBeGreaterThan(0);
    for (const j of s.jobs) expect(j.nets.map((n) => n.net)).toEqual(["GND"]);
    expect(s.jobs[0].nets[0].islands.length).toBe(d.links + 1);
  });

  it("keeps to one budget: a slow router is stopped or not started, and the answer says so", async () => {
    const t0 = Date.now();
    const d = await diagnoseNet(snapOf(), "I2C_SCL", { routers: [builtinRouter({ id: "slow", delayMs: 900 }), builtinRouter({ id: "next", delayMs: 900 })], budgetMs: 1200, cache: false });
    expect(Date.now() - t0).toBeLessThan(1200 + 1500);
    expect(d.budgetMs).toBe(1200);
    expect(d.stopped?.join("; ")).toMatch(/time budget/);
  });

  it("answers again from the cache (memory, then the file under the board's build folder)", async () => {
    const root = mkdtempSync(join(tmpdir(), "pb-kernel-diagnose-"));
    writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
    const dir = join(root, "board");
    const s = spy();
    const first = await diagnoseNet(snapOf(), "LED2_A", { routers: [s.router], budgetMs: 20_000, dir });
    const runs = s.jobs.length;
    expect(first.cached).toBe(false);
    expect(readdirSync(join(boardBuildDir(findProjectRoot(dir), dir), "diagnosis"))).toEqual([`${first.hash}.json`]);
    const again = await diagnoseNet(snapOf(), "LED2_A", { routers: [s.router], budgetMs: 20_000, dir });
    expect(again.cached).toBe(true);
    expect(again.hash).toBe(first.hash);
    expect(s.jobs.length).toBe(runs);
  });
});
