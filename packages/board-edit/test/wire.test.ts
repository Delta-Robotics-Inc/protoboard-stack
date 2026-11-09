/** The Phase 2 wire methods (contract phase2-editing.md, section 9): proposals, holds, derived state and the diagnose extension over WebSocket. */
import { describe, expect, it } from "vitest";
import { openBoardService, serveBoard, wireClient, type Actor } from "@protoboardai/board/node";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { attachEditing, builtinRouter } from "../src/service.js";

const PERSON: Actor = { kind: "human", id: "user" };
const AGENT: Actor = { kind: "agent", id: "agent:wire", name: "wire" };

describe("Phase 2 over the wire", () => {
  it("proposes, previews, accepts, holds, reads derived state and diagnoses", async () => {
    const svc = openBoardService({ document: airnodeC3(), epoch: "wire01" });
    const ed = attachEditing(svc, { diagnose: { routers: [builtinRouter()], budgetMs: 20_000 } });
    const server = await serveBoard(svc, { serviceFile: false, methods: ed.methods });
    const c = await wireClient(server.url, server.token);
    try {
      const p = await c.propose(AGENT, { title: "add a short LED stub", items: [{ key: "a", label: "stub", ops: [{ op: "track.add", segments: [{ handle: "s", net: "LED1_A", layer: "top", width: 200_000, start: { x: -12_520_000, y: 10_000_000 }, end: { x: -12_520_000, y: 11_000_000 } }] }] }] });
      expect(p.status).toBe("proposed");
      if (p.status !== "proposed") return;
      expect((await c.proposals({ status: "open" })).map((x) => x.id)).toEqual([p.proposal.id]);
      expect((await c.previewProposal(p.proposal.id))?.added).toHaveLength(1);
      const a = await c.acceptProposal(PERSON, p.proposal.id);
      expect(a.status).toBe("applied");
      expect((await c.proposal(p.proposal.id))?.status).toBe("accepted");
      const h = await c.hold(PERSON, { ids: ["fp:power/ldo"] });
      expect(h.status).toBe("held");
      expect((await c.releaseHold(PERSON)).length).toBe(1);
      const d = await c.derived();
      expect(d?.seq).toBe(svc.seq);
      const diag = (await c.callExtension("board.diagnose", { net: "LED2_A" })) as { net: string };
      expect(diag.net).toBe("LED2_A");
    } finally {
      await c.close();
      await server.close();
      ed.stop();
    }
  }, 60_000);
});
