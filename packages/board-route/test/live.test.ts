/**
 * The real routers on the Airnode C3 fixture and the easy synthetic board. Skipped cleanly when a router is not
 * installed. Each run prints one line (router, board, time, nets, open connections and errors before and after).
 */
import { describe, expect, it } from "vitest";
import type { BoardDocument } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { basicScorer, createFreeroutingRouter, createTscircuitRouter, detectFreerouting, routeBoard, type BoardScorer, type Router } from "../src/index.js";
import { easyBoard } from "./helpers.js";

/** The board checks when they load (the scorer the product injects), else the basic scorer. */
async function loadScorer(): Promise<{ name: string; scorer: BoardScorer }> {
  try {
    const name = "@protoboardai/board-checks";
    const m = (await import(/* @vite-ignore */ name)) as { runBoardChecks: (d: BoardDocument) => { summary: { unconnected: number; errors: number }; connectivity: { nets: { net: string; missing: number }[] } } };
    return {
      name: "board-checks",
      scorer: (doc) => {
        const r = m.runBoardChecks(doc);
        return { open: r.summary.unconnected, errors: r.summary.errors, openNets: r.connectivity.nets.filter((n) => n.missing > 0).map((n) => n.net) };
      },
    };
  } catch {
    return { name: "basic", scorer: basicScorer(127_000) };
  }
}

const tscircuit = createTscircuitRouter();
const freerouting = createFreeroutingRouter();
const boards: [string, () => BoardDocument][] = [
  ["easy two-layer", () => easyBoard()],
  ["Airnode C3", () => airnodeC3()],
];

async function live(router: Router, board: string, doc: BoardDocument) {
  const { name, scorer } = await loadScorer();
  const p = await routeBoard(doc, { scope: { kind: "open" }, routers: [router], scorer, budget: { timeMs: 120_000, threads: 1, memoryMb: 2048 }, diagnose: false });
  const s = p.stages[0];
  const line = {
    router: `${router.id} ${s?.version}`,
    board,
    scorer: name,
    status: p.status,
    stage: s?.status,
    seconds: s ? Math.round(s.durationMs / 100) / 10 : 0,
    nets: p.nets.length,
    open: `${p.current.open} -> ${p.candidate.open}`,
    errors: `${p.current.errors} -> ${p.candidate.errors}`,
    openNets: p.openNets,
    added: p.added,
    lockOk: p.lockCheck.ok,
    reasons: p.reasons,
    messages: s?.messages.slice(0, 3),
    routerReportedOpen: s?.routerReportedOpen,
  };
  console.log(`[live-route] ${JSON.stringify(line)}`);
  return p;
}

describe.skipIf(!tscircuit.available().ok)("tscircuit autorouter (live)", () => {
  it("reports the pinned version", () => {
    expect(tscircuit.version()).toBe("0.0.953");
  });
  for (const [board, make] of boards)
    it(`routes ${board}`, async () => {
      const p = await live(tscircuit, board, make());
      expect(p.lockCheck.ok).toBe(true);
      expect(["proposed", "rejected", "failed", "unchanged"]).toContain(p.status);
      if (board === "easy two-layer") {
        expect(p.status).toBe("proposed");
        expect(p.candidate.open).toBeLessThan(p.current.open);
      }
    }, 300_000);
});

describe.skipIf(!detectFreerouting().ok)("Freerouting (live, installed separately)", () => {
  for (const [board, make] of boards)
    it(`routes ${board}`, async () => {
      const p = await live(freerouting, board, make());
      expect(p.lockCheck.ok).toBe(true);
      expect(p.stages[0].version).toMatch(/^\d+\.\d+\.\d+$/);
      if (board === "easy two-layer") {
        expect(p.status).toBe("proposed");
        expect(p.candidate.open).toBe(0);
      }
    }, 300_000);
});

describe.skipIf(!tscircuit.available().ok || !detectFreerouting().ok)("tscircuit then Freerouting (live, the default order)", () => {
  it("routes Airnode C3 with fallback and the rules-or-placement diagnostic", async () => {
    const { name, scorer } = await loadScorer();
    const p = await routeBoard(airnodeC3(), { scope: { kind: "open" }, routers: [tscircuit, freerouting], scorer, budget: { timeMs: 120_000, threads: 1, memoryMb: 2048 } });
    console.log(
      `[live-route] ${JSON.stringify({ chain: p.stages.map((s) => `${s.router} ${s.version}: ${s.status}${s.kept ? " kept" : ""}${s.reason ? ` (${s.reason})` : ""} ${Math.round(s.durationMs / 100) / 10} s`), scorer: name, status: p.status, open: `${p.current.open} -> ${p.candidate.open}`, errors: `${p.current.errors} -> ${p.candidate.errors}`, openNets: p.openNets, fallback: p.fallback, diagnostic: p.diagnostic && { router: p.diagnostic.router, seconds: Math.round(p.diagnostic.durationMs / 100) / 10, nets: p.diagnostic.nets } })}`,
    );
    expect(p.lockCheck.ok).toBe(true);
    expect(p.fallback?.from).toBe("tscircuit");
    if (p.openNets.length) expect(p.diagnostic?.tiers).toBe("floor-and-no-go");
  }, 600_000);
});

describe("Freerouting detection", () => {
  it("reports clearly when absent, with how to install", () => {
    const d = detectFreerouting({ env: { PATH: "" }, platform: "linux", exists: () => false });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toMatch(/not installed/);
      expect(d.howToInstall).toMatch(/github\.com\/freerouting\/freerouting\/releases/);
      expect(d.howToInstall).toMatch(/PROTOBOARD_FREEROUTING/);
    }
  });

  it("finds the Windows install folder, a setting, and a jar with Java", () => {
    const files = new Set(["C:\\Users\\u\\AppData\\Local\\freerouting\\freerouting.exe", "/opt/fr/freerouting-2.5.0.jar", "/jdk/bin/java"]);
    const win = detectFreerouting({ env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", PATH: "" }, platform: "win32", exists: (p) => files.has(p), readText: () => "java-options=-Djpackage.app-version=2.4.1" });
    expect(win.ok && win.install).toMatchObject({ kind: "exe", version: "2.4.1", source: "install location" });
    const jar = detectFreerouting({ setting: "/opt/fr/freerouting-2.5.0.jar", env: { JAVA_HOME: "/jdk", PATH: "" }, platform: "linux", exists: (p) => files.has(p) });
    expect(jar.ok && jar.install).toMatchObject({ kind: "jar", java: "/jdk/bin/java", version: "2.5.0", source: "setting" });
    const missing = detectFreerouting({ setting: "/nowhere/freerouting", env: { PATH: "" }, platform: "linux", exists: () => false });
    expect(missing.ok).toBe(false);
  });
});
