// The tscircuit autorouter in a worker thread (plain JavaScript so it runs without a TypeScript loader). It receives
// a SimpleRouteJson and a time budget, steps the solver, posts progress, and posts the traces. The network is off in
// this thread: board data never leaves the machine (the autorouter has optional remote caches; none is used).
import { parentPort, workerData } from "node:worker_threads";

const blocked = async () => {
  throw new Error("network access is disabled in the routing worker");
};
globalThis.fetch = blocked;
if (globalThis.WebSocket) globalThis.WebSocket = function () {
  throw new Error("network access is disabled in the routing worker");
};

const { srj, timeMs, progressMs = 250 } = workerData;
const t0 = Date.now();
try {
  const mod = await import("@tscircuit/capacity-autorouter");
  const Solver = mod.AutoroutingPipelineSolver;
  const solver = new Solver(srj, { cacheProvider: null });
  let last = 0;
  let iterations = 0;
  const deadline = t0 + timeMs;
  let timedOut = false;
  while (!solver.solved && !solver.failed) {
    solver.step();
    iterations++;
    if ((iterations & 63) === 0) {
      const now = Date.now();
      if (now > deadline) {
        timedOut = true;
        break;
      }
      if (now - last >= progressMs) {
        last = now;
        parentPort.postMessage({ type: "progress", phase: typeof solver.getCurrentPhase === "function" ? solver.getCurrentPhase() : "route", fraction: typeof solver.progress === "number" ? solver.progress : undefined, iterations, elapsedMs: now - t0 });
      }
    }
  }
  let traces = [];
  if (solver.solved) traces = solver.getOutputSimplifiedPcbTraces();
  parentPort.postMessage({ type: "done", solved: !!solver.solved, failed: !!solver.failed, timedOut, error: solver.error ?? null, traces, iterations, elapsedMs: Date.now() - t0, version: mod.AUTOROUTER_VERSION ?? "unknown", phaseMs: solver.timeSpentOnPhase ?? {} });
} catch (e) {
  parentPort.postMessage({ type: "done", solved: false, failed: true, timedOut: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), traces: [], iterations: 0, elapsedMs: Date.now() - t0, version: "unknown", phaseMs: {} });
}
