/**
 * The scene reads the checks package's connectivity as it is (the core's `BoardConnectivity`): completion, islands
 * and ratsnest lines come from the checks, and the scene says so; without it the scene's own estimate is labeled.
 */
import { describe, expect, it } from "vitest";
import type { BoardConnectivity } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { runBoardChecks } from "@protoboardai/board-checks";
import { buildModel, connectivityOf, describeBoard } from "../src/index.js";

describe("connectivity from the board checks", () => {
  const doc = airnodeC3();
  const checks = runBoardChecks(doc);
  // the checks' result is accepted without conversion
  const input: BoardConnectivity = checks.connectivity;

  it("takes the checks' missing links and completion", () => {
    const conn = connectivityOf(buildModel(doc), input);
    expect(conn.source).toBe("checks");
    expect([...conn.nets.values()].reduce((s, n) => s + n.missing, 0)).toBe(checks.connectivity.unconnected);
    expect(conn.rats.length).toBe(checks.connectivity.links.length);
    for (const l of checks.connectivity.links) expect(conn.rats.some((r) => r.net === l.net && r.from.id === l.from.object && r.to.id === l.to.object)).toBe(true);
    for (const n of checks.connectivity.nets) expect(conn.nets.get(n.net)?.missing).toBe(n.missing);
  });

  it("says where the numbers come from in the scene", () => {
    const withChecks = describeBoard(doc, { connectivity: input, findings: checks.findings, image: "none" });
    expect(String(withChecks.scene.connectivity)).toMatch(/^from the board checks/);
    expect((withChecks.scene.counts as { missingLinks: number }).missingLinks).toBe(checks.connectivity.unconnected);
    const estimate = describeBoard(doc, { image: "none" });
    expect(String(estimate.scene.connectivity)).toMatch(/^estimated from geometry by the scene.*no checks result was given$/);
  });

  it("estimates (and names) nets the checks did not report", () => {
    const partial: BoardConnectivity = { ...input, nets: input.nets.slice(1), links: input.links.filter((l) => l.net !== input.nets[0].net), islands: input.islands.filter((i) => i.net !== input.nets[0].net) };
    const conn = connectivityOf(buildModel(doc), partial);
    expect(conn.estimated).toContain(input.nets[0].net);
    const d = describeBoard(doc, { connectivity: partial, image: "none" });
    expect(String(d.scene.connectivity)).toContain(input.nets[0].net);
  });
});
