/** Synthetic boards and test routers for the board-route tests. */
import { createDocument, mm, type BoardDocument, type BoardRecord, type FootprintRec, type Netlist, type OpCall, type Pad, type Vertex } from "@protoboardai/board";
import { routedProvenance } from "../src/ops.js";
import type { RouteJob, RouteResult, Router } from "../src/types.js";

export const rect = (w: number, h: number, cx = 0, cy = 0): Vertex[] => [
  { x: mm(cx - w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy + h / 2) },
  { x: mm(cx - w / 2), y: mm(cy + h / 2) },
];

export const smd = (number: string, x: number, y: number, w = 0.8, h = 0.9): Pad => ({ number, type: "smd", shape: "rect", x: mm(x), y: mm(y), width: mm(w), height: mm(h) });
export const th = (number: string, x: number, y: number, d = 1.6, hole = 0.8): Pad => ({ number, type: "th", shape: "circle", x: mm(x), y: mm(y), outer_diameter: mm(d), hole_diameter: mm(hole) });

export function fp(ref: string, x: number, y: number, pads: Pad[], extra: Partial<FootprintRec> = {}): FootprintRec {
  return { kind: "footprint", id: `fp:${ref}`, ref, footprint: `Test:${ref}`, x: mm(x), y: mm(y), rotation: 0, side: "top", pads, provenance: { by: "generated", tool: "test" }, ...extra };
}

export const chip = (ref: string, x: number, y: number, extra: Partial<FootprintRec> = {}) => fp(ref, x, y, [smd("1", -0.8, 0), smd("2", 0.8, 0)], extra);

export function track(key: string, net: string | undefined, layer: "top" | "bottom", w: number, a: [number, number], b: [number, number], extra: { locked?: true; by?: "hand" | "routed" } = {}): BoardRecord {
  return { kind: "track", id: `trk:${key}`, ...(net ? { net } : {}), layer, width: mm(w), start: { x: mm(a[0]), y: mm(a[1]) }, end: { x: mm(b[0]), y: mm(b[1]) }, ...(extra.locked ? { locked: true as const } : {}), provenance: { by: extra.by ?? "hand" } };
}

export function baseRecords(w = 30, h = 20): BoardRecord[] {
  return [
    { kind: "board", id: "board", name: "Test board", thickness: mm(1.6), copper_layers: 2, origin: "center" },
    { kind: "layer", id: "layer:top", name: "top", type: "copper", order: 0, thickness: mm(0.035) },
    { kind: "layer", id: "layer:core", name: "core", type: "dielectric", order: 1, thickness: mm(1.5) },
    { kind: "layer", id: "layer:bottom", name: "bottom", type: "copper", order: 2, thickness: mm(0.035) },
    { kind: "outline", id: "outline", outline: rect(w, h), source: { kind: "board" }, provenance: { by: "generated", tool: "test" } },
    { kind: "rule", id: "rule:floor.clearance", tier: "floor", check: "clearance", applies: {}, min: mm(0.127) },
    { kind: "rule", id: "rule:floor.track_width", tier: "floor", check: "track_width", applies: {}, min: mm(0.127) },
    { kind: "rule", id: "rule:target.clearance", tier: "target", check: "clearance", applies: {}, min: mm(0.2) },
    { kind: "rule", id: "rule:target.track_width", tier: "target", check: "track_width", applies: {}, min: mm(0.25) },
  ];
}

export function netlist(nets: Record<string, string[]>): Netlist {
  return { source: "fixture", nets: Object.entries(nets).map(([name, pins]) => ({ name, pins })) };
}

/** An easy two-layer board: six chips in two rows, six two-pin nets that route straight. */
export function easyBoard(extra: BoardRecord[] = []): BoardDocument {
  const fps = [chip("R1", -8, 4), chip("R2", 0, 4), chip("R3", 8, 4), chip("R4", -8, -4), chip("R5", 0, -4), chip("R6", 8, -4)];
  const nl = netlist({ A: ["R1.2", "R2.1"], B: ["R2.2", "R3.1"], C: ["R4.2", "R5.1"], D: ["R5.2", "R6.1"], E: ["R1.1", "R4.1"], F: ["R3.2", "R6.2"] });
  return createDocument([...baseRecords(), ...fps, ...extra], nl);
}

/** Two through-hole test points of net G with a top-only no-go keep-out between them: only the bottom is free. */
export function blockedTopBoard(): BoardDocument {
  const fps = [fp("TP1", -6, 0, [th("1", 0, 0)]), fp("TP2", 6, 0, [th("1", 0, 0)])];
  const keep: BoardRecord = { kind: "keepout", id: "kpo:wall", outline: rect(2, 6), layers: ["top"], blocks: { tracks: true, vias: true, pours: true, footprints: false }, tier: "no_go", provenance: { by: "hand" } };
  return createDocument([...baseRecords(), ...fps, keep], netlist({ G: ["TP1.1", "TP2.1"] }));
}

/**
 * Net H from P1 to P2 runs between two pads of nets X and Y 0.5 mm apart: it fits at the floor (0.127 mm width and
 * clearance) but not at the target (0.25 mm width, 0.2 mm clearance). Net K is walled off by a no-go keep-out on
 * both layers (placement).
 */
export function diagnosticBoard(): BoardDocument {
  const fps = [
    fp("P1", -5, 0, [smd("1", 0, 0)]),
    fp("P2", 5, 0, [smd("1", 0, 0)]),
    fp("Q1", 0, 0, [smd("1", 0, 0.4, 1.0, 0.3), smd("2", 0, -0.4, 1.0, 0.3)]),
    fp("P3", -5, 6, [smd("1", 0, 0)]),
    fp("P4", 5, 6, [smd("1", 0, 0)]),
  ];
  const wall: BoardRecord = { kind: "keepout", id: "kpo:wall", outline: rect(1, 8.9, 0, 5.45), layers: ["top", "bottom"], blocks: { tracks: true, vias: true, pours: false, footprints: false }, tier: "no_go", provenance: { by: "hand" } };
  return createDocument([...baseRecords(), ...fps, wall], netlist({ H: ["P1.1", "P2.1"], X: ["Q1.1"], Y: ["Q1.2"], K: ["P3.1", "P4.1"] }));
}

/** A router that returns fixed operations (or computes them from the job). */
export function fakeRouter(id: string, make: (job: RouteJob) => OpCall[], status: RouteResult["status"] = "complete"): Router {
  return {
    id,
    title: `fake ${id}`,
    version: () => "0",
    available: () => ({ ok: true }),
    capabilities: { layers: { min: 1, max: 10 }, region: true, netSubset: true, respectsLockedCopper: false, incremental: true, maxThreads: 1 },
    express: () => [],
    async route(job) {
      const ops = make(job);
      return { status, ops, provenance: routedProvenance(id, "0", job.runId), stats: { durationMs: 0, segments: 0, vias: 0, length: 0 }, unexpressed: job.unexpressed, messages: [], version: "0" };
    },
  };
}

/** A proposal without timings, for comparing two runs. */
export function stripTimes<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (k, v) => (k === "durationMs" || k === "elapsedMs" ? undefined : v)));
}
