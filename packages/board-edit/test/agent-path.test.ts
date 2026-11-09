/**
 * The agent path end to end (contract phase2-editing.md, sections 2.1 and 4), kept as a test: on a copy of the
 * Airnode C3 board, an agent uses only public calls to route three open nets. It finds open two-pin nets from the
 * checks, plans each with a free-corridor query from board-scene, submits each route as a `track.route` proposal, and
 * a person accepts it. The open-connection count drops by exactly the links routed, with no new errors.
 */
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mm, openBoardService, type Actor, type BoardSnapshot } from "@protoboardai/board";
import { runBoardChecks } from "@protoboardai/board-checks";
import { buildModel, findCorridor } from "@protoboardai/board-scene";

const FIXTURE = fileURLToPath(new URL("../../board/test/fixtures/airnode-c3/", import.meta.url));
const AGENT: Actor = { kind: "agent", id: "agent:router-helper", name: "router-helper" };
const PERSON: Actor = { kind: "human", id: "user" };

/** The agent's view: open two-pin signal nets, by name. */
function openTwoPinNets(s: BoardSnapshot): string[] {
  const r = runBoardChecks(s.doc);
  const open = new Set(r.connectivity.nets.filter((n) => n.missing > 0).map((n) => n.net));
  return [...s.doc.nets.values()].filter((n) => open.has(n.name) && n.pads.length === 2 && !n.class).map((n) => n.name).sort();
}

describe("an agent routes three open nets through proposals a person accepts", () => {
  it("drops the open-connection count by exactly three with no new errors", () => {
    const root = mkdtempSync(join(tmpdir(), "pb-agent-path-"));
    const dir = join(root, "board");
    cpSync(FIXTURE, dir, { recursive: true });
    const svc = openBoardService({ dir });
    try {
      const start = svc.snapshot();
      const before = runBoardChecks(start.doc);
      const errorsBefore = new Set(before.findings.filter((f) => f.severity === "error" && f.check !== "unconnected").map((f) => f.id));
      const routed: string[] = [];
      for (const net of openTwoPinNets(start)) {
        if (routed.length === 3) break;
        const snap = svc.snapshot();
        const [a, b] = snap.doc.nets.get(net)!.pads;
        // plan: a free corridor on the top layer at the planned width, with a little extra clearance for the simplified path
        const corridor = findCorridor(buildModel(snap), { from: a, to: b, layer: "top", width: 0.25, clearance: 0.26, net });
        // a start or end moved by more than a raster cell means the pad is boxed in at this clearance
        if (!corridor.found || !corridor.path || corridor.startShift > 0.1 || corridor.endShift > 0.1) continue;
        const pa = snap.query.byId(a)!.box,
          pb = snap.query.byId(b)!.box;
        const center = (bx: { minX: number; minY: number; maxX: number; maxY: number }) => ({ x: Math.round((bx.minX + bx.maxX) / 2), y: Math.round((bx.minY + bx.maxY) / 2) });
        const inner = corridor.path.slice(1, -1).map((p) => ({ x: mm(p.x), y: mm(p.y) }));
        const points = [center(pa), ...inner, center(pb)].map((p) => ({ ...p, layer: "top" as const }));
        const call = { op: "track.route", net, width: 250_000, points, handle: "r" };
        // check it applies before proposing (a dry run of the same call)
        const dry = svc.apply({ batchId: `dry.${net}`, label: `try routing ${net} first`, ops: [call], dryRun: true }, AGENT);
        if (dry.status !== "valid") continue;
        const p = svc.propose(AGENT, { title: `route ${net} along a free corridor`, items: [{ key: net.replace(/[^A-Za-z0-9_.-]/g, "_"), label: `route ${net}`, ops: [call] }], expectSeq: svc.seq });
        expect(p.status, JSON.stringify(p)).toBe("proposed");
        if (p.status !== "proposed") continue;
        // the person reviews the diff and accepts it
        const pv = svc.previewProposal(p.proposal.id)!;
        expect(pv.added.every((r) => r.kind === "track")).toBe(true);
        const acc = svc.acceptProposal(PERSON, p.proposal.id);
        expect(acc.status, JSON.stringify(acc)).toBe("applied");
        routed.push(net);
      }
      expect(routed).toHaveLength(3);
      const after = runBoardChecks(svc.snapshot().doc);
      expect(after.summary.unconnected).toBe(before.summary.unconnected - 3);
      const newErrors = after.findings.filter((f) => f.severity === "error" && f.check !== "unconnected" && !errorsBefore.has(f.id));
      expect(newErrors, JSON.stringify(newErrors)).toEqual([]);
      // the accepted copper is the agent's, accepted by the person
      const log = svc.log().filter((e) => e.proposal);
      expect(log).toHaveLength(3);
      expect(log.every((e) => e.actor.kind === "human")).toBe(true);
      const added = log.flatMap((e) => Object.values(e.created)).map((id) => svc.snapshot().doc.records.get(id)!);
      expect(added.every((r) => (r as { provenance: { by: string } }).provenance.by === "agent")).toBe(true);
      console.log(`agent path: routed ${routed.join(", ")}; unconnected ${before.summary.unconnected} -> ${after.summary.unconnected}; errors ${before.summary.errors} -> ${after.summary.errors}`);
    } finally {
      svc.close({ save: false });
    }
  });
});
