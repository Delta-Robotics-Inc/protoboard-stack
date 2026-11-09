/**
 * The layout screen's dev page (browser side). It opens a board service in the page (in memory, the board core
 * bundled with small shims for Node's built-ins) on the Airnode C3 fixture, or on any board folder the dev server
 * reads (`?board=<folder>`), and mounts the LayoutScreen on it.
 *
 * URL options:
 *   board=<folder>     a board folder in the core's on-disk format (board.jsonl ...), read by the dev server
 *   sample=findings    hand in sample findings and sample check counts (labeled as samples in the page title)
 *   ratsnest=naive     hand in a naive ratsnest: per net, a spanning tree over its pads (ignores copper)
 *
 * window.__dev exposes the service, the board view and a few helpers for the screenshot script.
 */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { createDocument } from "../../../board/src/document.js";
import { openBoardService, type BoardService } from "../../../board/src/service.js";
import { HUMAN } from "../../../board/src/transaction.js";
import "../../../board/src/ops/index.js";
import { airnodeC3, AIRNODE_C3_NETLIST } from "../../../board/src/fixtures/airnode-c3.js";
import { padsOf } from "../../../board/src/geometry.js";
import type { BoardRecord, Netlist } from "../../../board/src/schema.js";
import type { BoardDocument } from "../../src/pcb/board.js";
import type { BoardView } from "../../src/pcb/boardview.js";
import { LayoutScreen } from "../../src/pcb/LayoutScreen.js";
import type { CheckSummary, PcbFinding, RatsnestPair } from "../../src/pcb/types.js";

const params = new URLSearchParams(location.search);

/** Per net, a spanning tree over its pads by distance (Prim). A stand-in until the checks package computes the real ratsnest. */
function naiveRatsnest(doc: BoardDocument): RatsnestPair[] {
  const at = new Map<string, { x: number; y: number }>();
  for (const r of doc.records.values()) if (r.kind === "footprint") for (const p of padsOf(r)) at.set(p.id, { x: p.x, y: p.y });
  const out: RatsnestPair[] = [];
  for (const [name, info] of doc.nets) {
    const pts = info.pads.map((id) => ({ id, p: at.get(id)! })).filter((x) => x.p);
    if (pts.length < 2) continue;
    const inTree = new Set([0]);
    while (inTree.size < pts.length) {
      let best: [number, number, number] | undefined;
      for (const i of inTree)
        for (let j = 0; j < pts.length; j++) {
          if (inTree.has(j)) continue;
          const d = Math.hypot(pts[i].p.x - pts[j].p.x, pts[i].p.y - pts[j].p.y);
          if (!best || d < best[2]) best = [i, j, d];
        }
      inTree.add(best![1]);
      out.push({ net: name, a: pts[best![0]].p, b: pts[best![1]].p, from: pts[best![0]].id, to: pts[best![1]].id });
    }
  }
  return out;
}

/** Sample findings on the fixture, for the screen's review states. Not computed: the page title says so. */
const SAMPLE_FINDINGS: PcbFinding[] = [
  { id: "f:clearance:000000000001", check: "clearance", rule: "rule:target.clearance", tier: "target", severity: "error", objects: ["pad:sensor/c_dec:1", "trk:f.i2c_scl.1"], location: { x: -4_480_000, y: 11_500_000, layer: "top" }, measured: 110_000, required: 200_000, message: "I2C_SCL passes 0.11 mm from the C4 pad. The design target asks 0.2 mm (sample finding)." },
  { id: "f:via_under_footprint:000000000002", check: "via_under_footprint", rule: "rule:policy.via_under_module", tier: "policy", severity: "warning", objects: ["via:f.gnd.3"], location: { x: 10_000_000, y: 5_000_000 }, message: "A ground via sits under the module; the policy rule costs 5 (sample finding)." },
  { id: "f:edge_clearance:000000000003", check: "edge_clearance", rule: "rule:floor.edge_clearance", tier: "floor", severity: "warning", objects: ["fp:usb/connector"], location: { x: -10_000_000, y: -15_000_000 }, message: "J1 overhangs the board edge by design (sample finding)." },
];
const SAMPLE_CHECKS: CheckSummary = { ran: true, at: "sample", ms: 0, seq: 0, unconnected: 4, errors: 1, warnings: 2 };

async function loadBoard(): Promise<{ doc: BoardDocument; netlist?: Netlist; name: string }> {
  const path = params.get("board");
  if (!path) return { doc: airnodeC3(), netlist: AIRNODE_C3_NETLIST, name: "Airnode C3" };
  const res = await fetch(`/api/board?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(await res.text());
  const body = (await res.json()) as { records: BoardRecord[]; netlist?: Netlist; name: string };
  return { doc: createDocument(body.records, body.netlist), ...(body.netlist ? { netlist: body.netlist } : {}), name: body.name };
}

declare global {
  interface Window {
    __dev: { ready: boolean; service?: BoardService; view?: BoardView; error?: string; move?: (id: string, dxMm: number, dyMm: number) => unknown };
  }
}
window.__dev = { ready: false };

function App() {
  const [state, setState] = useState<{ svc: BoardService; name: string; ratsnest: RatsnestPair[] } | { error: string } | undefined>(undefined);
  useEffect(() => {
    loadBoard()
      .then(({ doc, netlist, name }) => {
        const svc = openBoardService({ document: doc, ...(netlist ? { netlist } : {}), journal: false, ownerLock: false });
        window.__dev.service = svc;
        window.__dev.move = (id, dx, dy) => svc.apply({ batchId: `dev-${Date.now()}`, label: `move ${id} by hand`, ops: [{ op: "footprint.move", ids: [id], dx: Math.round(dx * 1e6), dy: Math.round(dy * 1e6), tracks: "stay" }] }, HUMAN);
        const naive = params.get("ratsnest") === "naive";
        setState({ svc, name, ratsnest: naive ? naiveRatsnest(svc.snapshot().doc) : [] });
        // the stand-in ratsnest follows the board, as the real one will
        if (naive) svc.subscribe((e) => e.type === "commit" && setState({ svc, name, ratsnest: naiveRatsnest(svc.snapshot().doc) }));
      })
      .catch((e) => {
        window.__dev.error = String(e);
        setState({ error: String(e) });
      });
  }, []);
  if (!state) return null;
  if ("error" in state) return <pre style={{ color: "#ef4444", padding: 20 }}>{state.error}</pre>;
  const sample = params.get("sample") === "findings";
  document.title = `${state.name} · layout${sample ? " · sample findings" : ""}`;
  return (
    <LayoutScreen
      source={state.svc}
      crumbs={[state.name, "boards", "main"]}
      ratsnest={state.ratsnest}
      {...(sample ? { findings: SAMPLE_FINDINGS, checks: SAMPLE_CHECKS } : {})}
      onNavigate={(v) => console.log(`navigate to ${v}`)}
      onView={(v) => {
        window.__dev.view = v;
        window.__dev.ready = true;
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
