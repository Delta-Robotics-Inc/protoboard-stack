/**
 * `protoboard board route` and `board diagnose` (PCB editor Phase 2), in this process on a copy of the Airnode C3
 * fixture. The routers are injected (the built-in straight and L router) so the tests never depend on the tscircuit
 * autorouter or Freerouting; one live run with the product's routers is skipped when tscircuit is not available.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtinRouter, createTscircuitRouter, type BoardScorer, type Router } from "@protoboardai/board-route";
import { boardCommand, type RoutingDeps } from "../src/board.js";
import { boardTools } from "../src/mcp/board-tools.js";
import type { CliRun, ToolContext } from "../src/mcp/tools.js";

const FIXTURE = fileURLToPath(new URL("../../board/test/fixtures/airnode-c3/", import.meta.url));
const LOCKED_TRACKS = ["trk:f.vbus.1", "trk:f.vbus.2"];

function project() {
  const root = mkdtempSync(join(tmpdir(), "pb-board-route-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const dir = join(root, "board");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  return { root, dir };
}

/** Every board file's text, by name. */
const files = (dir: string) => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
/** The stored line of one record (byte for byte). */
const lineOf = (dir: string, id: string) => readFileSync(join(dir, "copper.jsonl"), "utf8").split("\n").find((l) => l.includes(`"id":"${id}"`));
const tracks = (dir: string) => readFileSync(join(dir, "copper.jsonl"), "utf8").split("\n").filter((l) => l.includes('"kind":"track"')).length;

async function run(argv: string[], cwd: string, routing?: RoutingDeps): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const code = await boardCommand(argv, { cwd, env: {}, write: (s) => (stdout += s), stderr: (s) => (stderr += s), ...(routing ? { routing } : {}) });
  return { code, stdout, stderr };
}

const builtin = (): RoutingDeps => ({ routers: [builtinRouter()] });

describe("board route", () => {
  it("without --apply proposes and leaves the board files byte-identical", async () => {
    const { root, dir } = project();
    const before = files(dir);
    const r = await run(["route", dir, "--json"], root, builtin());
    const p = JSON.parse(r.stdout);
    expect(p.status, r.stdout).toBe("proposed");
    expect(r.code).toBe(0);
    expect(p.stages[0]).toMatchObject({ router: "builtin", kept: true });
    expect(p.added.segments).toBeGreaterThan(0);
    expect(p.candidate.open).toBeLessThan(p.current.open);
    expect(p.lockCheck).toMatchObject({ ok: true, changed: [] });
    expect(p.locked).toEqual(expect.arrayContaining(LOCKED_TRACKS));
    expect(p.steps[0].actor).toBe("router:builtin");
    expect(p.applied).toBeNull();
    expect(files(dir)).toEqual(before);
  });

  it("with --apply adds copper as the router and keeps locked tracks byte-identical", async () => {
    const { root, dir } = project();
    const locked = LOCKED_TRACKS.map((id) => lineOf(dir, id));
    expect(locked.every(Boolean)).toBe(true);
    const n = tracks(dir);
    const r = await run(["route", dir, "--apply", "--json"], root, builtin());
    const p = JSON.parse(r.stdout);
    expect(p.status, r.stdout).toBe("proposed");
    expect(r.code).toBe(0);
    expect(p.applied).toMatchObject({ complete: true, mode: "local", locked: { changed: [] } });
    expect(p.applied.locked.checked).toBe(p.locked.length);
    for (const x of p.applied.replies) expect(x).toMatchObject({ actor: "router:builtin", reply: { status: "applied" } });
    expect(tracks(dir)).toBe(n + p.added.segments);
    expect(LOCKED_TRACKS.map((id) => lineOf(dir, id))).toEqual(locked);
    // what was added is the router's, not a person's
    expect(readFileSync(join(dir, "copper.jsonl"), "utf8")).toMatch(/"by":"routed"/);
  });

  it("prints the proposal for a person, with the fallback flagged and the lock verification", async () => {
    const { root, dir } = project();
    const routers: Router[] = [builtinRouter({ id: "weak", layers: ["bottom"] }), builtinRouter()];
    const r = await run(["route", dir, "--apply"], root, { routers });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^APPLIED/);
    expect(r.stdout).toMatch(/FALLBACK: weak \(.*\) ran first; builtin \(.*\) ran as the fallback/);
    expect(r.stdout).toMatch(/current: .* open/);
    expect(r.stdout).toMatch(/candidate: .* open/);
    expect(r.stdout).toMatch(/copper added: \d+ segment/);
    expect(r.stdout).toMatch(/\d+ locked records verified unchanged/);
  });

  it("never applies a rejected proposal, even with --apply", async () => {
    const { root, dir } = project();
    const before = files(dir);
    // a scorer that calls every added track an error: every candidate is worse than the board
    const scorer: BoardScorer = (doc) => ({ open: 0, errors: [...doc.records.values()].filter((x) => x.kind === "track").length });
    const r = await run(["route", dir, "--apply", "--json"], root, { routers: [builtinRouter()], scorer, scorerName: "test" });
    const p = JSON.parse(r.stdout);
    expect(p.status).toBe("rejected");
    expect(p.applied).toBeNull();
    expect(r.code).toBe(1);
    expect(files(dir)).toEqual(before);
  });

  it("routes a region (mm) or named nets, and refuses both at once or an unknown net", async () => {
    const { root, dir } = project();
    const region = await run(["route", dir, "--region", "-20mm,-15mm,20mm,15mm", "--json"], root, builtin());
    expect(JSON.parse(region.stdout).scope.kind).toBe("region");
    const nets = await run(["route", dir, "--nets", "I2C_SCL,LED1", "--json"], root, builtin());
    expect(JSON.parse(nets.stdout).scope).toEqual({ kind: "nets", nets: ["I2C_SCL", "LED1"] });
    expect((await run(["route", dir, "--nets", "LED1", "--region", "0,0,1,1"], root, builtin())).code).toBe(2);
    expect((await run(["route", dir, "--nets", "NOPE"], root, builtin())).code).toBe(2);
    expect((await run(["route", dir, "--budget", "0"], root, builtin())).code).toBe(2);
  });

  it.skipIf(!createTscircuitRouter().available().ok)(
    "runs the product's routers (tscircuit first) and changes nothing without --apply (live)",
    async () => {
      const { root, dir } = project();
      const before = files(dir);
      const r = await run(["route", dir, "--nets", "LED1", "--budget", "20", "--json"], root);
      const p = JSON.parse(r.stdout);
      expect(p.stages[0].router).toBe("tscircuit");
      expect(p.routers.map((x: { id: string }) => x.id)).toEqual(["tscircuit", "freerouting"]);
      expect(files(dir)).toEqual(before);
    },
    240_000,
  );
});

describe("board diagnose", () => {
  it("prints JSON with a verdict and changes nothing", async () => {
    const { root, dir } = project();
    const before = files(dir);
    const r = await run(["diagnose", dir, "I2C_SCL", "--json"], root, builtin());
    const d = JSON.parse(r.stdout);
    expect(r.code, r.stdout).toBe(0);
    expect(d.net).toBe("I2C_SCL");
    expect(["routes", "rules", "placement"]).toContain(d.verdict);
    expect(typeof d.summary).toBe("string");
    expect(d.attempts.length).toBeGreaterThan(0);
    expect(d.areas.map((a: { tier: string }) => a.tier)).toEqual(["floor", "no_go", "target", "policy"]);
    expect(d.blockers.some((b: { rule: string }) => b.rule === "fab floor")).toBe(true);
    expect(files(dir)).toEqual(before);
  });

  it("prints the verdict for a person, and refuses an unknown net", async () => {
    const { root, dir } = project();
    const r = await run(["diagnose", dir, "I2C_SCL"], root, builtin());
    expect(r.stdout).toMatch(/^I2C_SCL: (ROUTES AS IS|RULES, NOT PLACEMENT|PLACEMENT)/);
    expect(r.stdout).toMatch(/what blocks it:/);
    expect(r.stdout).toMatch(/rule areas by tier:/);
    expect((await run(["diagnose", dir, "NOPE"], root, builtin())).code).toBe(2);
    expect((await run(["diagnose", dir], root, builtin())).code).toBe(2);
  });
  it("keeps to one budget (8 s by default), prints progress on stderr for a person, and answers again from the cache", async () => {
    const { root, dir } = project();
    const before = files(dir);
    const text = await run(["diagnose", dir, "LED1_A", "--budget", "7"], root, builtin());
    expect(text.code, text.stdout + text.stderr).toBe(0);
    expect(text.stderr).toMatch(/diagnose LED1_A: connectivity \d+%/);
    expect(text.stderr).toMatch(/diagnose LED1_A: done 100%/);
    expect(text.stdout).toMatch(/budget 7 s for the whole diagnosis/);
    const json = await run(["diagnose", dir, "LED1_A", "--json"], root, builtin());
    expect(json.stderr).toBe("");
    const d = JSON.parse(json.stdout);
    expect(d.budgetMs).toBe(8000);
    expect(d.cached).toBe(false);
    const again = JSON.parse((await run(["diagnose", dir, "LED1_A", "--json"], root, builtin())).stdout);
    expect(again.cached).toBe(true);
    expect(again.hash).toBe(d.hash);
    // the board's files are untouched; the answer is cached under its build folder
    expect(files(dir)).toEqual(before);
    expect(readdirSync(join(root, ".protoboard", "build", "board", "board", "diagnosis"))).toContain(`${d.hash}.json`);
  });
});

describe("the board_route and board_diagnose MCP tools", () => {
  const tool = (name: string) => boardTools().find((t) => t.name === name)!;
  /** The tools' context with the CLI run in this process (built-in router) and every command line recorded. */
  function ctx(cwd: string, seen: string[][]): ToolContext {
    return {
      dir: async (given) => (given ? given : cwd),
      cli: (dir, args) => {
        seen.push(args);
        expect(args[0]).toBe("board");
        return run(args.slice(1), dir, builtin());
      },
      cliFor: () => ({ entry: "in-process", from: "server" }),
      version: "test",
      about: "",
      clientName: () => "route-test",
    };
  }

  it("board_route runs as the agent, passes a region in mm, and applies only when asked", async () => {
    const { root, dir } = project();
    const before = files(dir);
    const seen: string[][] = [];
    const proposed = await tool("board_route").handler({ dir, region: [-20, -15, 20, 15], budget: 5 } as never, ctx(root, seen));
    expect((proposed.data as { status: string }).status).toBe("proposed");
    expect(seen[0]).toEqual(expect.arrayContaining(["route", "--as=agent:route-test", "--region=[-20mm,-15mm,20mm,15mm]", "--budget=5"]));
    expect(seen[0]).not.toContain("--apply=true");
    expect(files(dir)).toEqual(before);
    const applied = await tool("board_route").handler({ dir, apply: true } as never, ctx(root, seen));
    expect((applied.data as { applied: { complete: boolean; by: string } }).applied).toMatchObject({ complete: true, by: "agent:route-test" });
    expect(seen[1]).toContain("--apply=true");
    expect(LOCKED_TRACKS.map((id) => lineOf(dir, id))).toEqual(LOCKED_TRACKS.map((id) => before["copper.jsonl"].split("\n").find((l) => l.includes(`"id":"${id}"`))));
  });

  it("board_diagnose is read-only and passes the net after --", async () => {
    const { root, dir } = project();
    const seen: string[][] = [];
    expect(tool("board_diagnose").annotations.readOnlyHint).toBe(true);
    expect(tool("board_route").annotations.readOnlyHint).toBe(false);
    expect(tool("board_route").description).toMatch(/CHANGES THE BOARD \(only with apply\)/);
    const out = await tool("board_diagnose").handler({ dir, net: "I2C_SCL", budget: 5 } as never, ctx(root, seen));
    expect(["routes", "rules", "placement"]).toContain((out.data as { verdict: string }).verdict);
    expect(seen[0].slice(-3)).toEqual(["--", dir, "I2C_SCL"]);
  });
});
