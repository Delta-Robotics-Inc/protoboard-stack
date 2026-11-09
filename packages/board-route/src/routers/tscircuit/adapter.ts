/**
 * The tscircuit autorouter adapter (the primary router): the pinned `@tscircuit/capacity-autorouter`, its default
 * pipeline, run in a worker thread with a heap cap, a time budget and the network off. The autorouter is
 * all-or-nothing in the pinned version: a run that fails or runs out of time returns no copper.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { commonUnexpressed } from "../../constraints.js";
import { routedProvenance, routedToOps } from "../../ops.js";
import type { RouteJob, RouteResult, Router } from "../../types.js";
import { jobToSrj, srjTracesToRouted, type SrjTrace } from "./srj.js";

/** The version this package is tested against (the stack's pin in ext-tscircuit). */
export const TSCIRCUIT_AUTOROUTER_PIN = "0.0.953";
export const TSCIRCUIT_AUTOROUTER_PACKAGE = "@tscircuit/capacity-autorouter";

function installed(): { version: string } | { error: string } {
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve(`${TSCIRCUIT_AUTOROUTER_PACKAGE}/package.json`);
    return { version: JSON.parse(readFileSync(path, "utf8")).version as string };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const WORKER = new URL("./worker.mjs", import.meta.url);

interface WorkerDone {
  type: "done";
  solved: boolean;
  failed: boolean;
  timedOut: boolean;
  error: string | null;
  traces: SrjTrace[];
  iterations: number;
  elapsedMs: number;
  version: string;
  phaseMs: Record<string, number>;
}

export function createTscircuitRouter(): Router {
  const id = "tscircuit";
  const version = () => {
    const i = installed();
    return "version" in i ? i.version : "not installed";
  };
  return {
    id,
    title: "tscircuit autorouter",
    version,
    available() {
      const i = installed();
      if ("error" in i) return { ok: false, reason: `${TSCIRCUIT_AUTOROUTER_PACKAGE} is not installed (${i.error})` };
      if (!existsSync(WORKER)) return { ok: false, reason: "the routing worker file is missing" };
      return { ok: true };
    },
    capabilities: { layers: { min: 1, max: 10 }, region: true, netSubset: true, respectsLockedCopper: false, incremental: true, maxThreads: 1 },
    express(job) {
      const out = jobToSrj(job).unexpressed;
      out.push("locked copper: the autorouter has no lock flag; locked copper is an obstacle and is verified after the run");
      out.push("seed: the pinned autorouter takes no seed; it is deterministic in one thread");
      if (job.budget.threads > 1) out.push(`threads: the pinned autorouter routes in one thread (${job.budget.threads} allowed)`);
      return out;
    },
    async route(job: RouteJob, signal, onProgress): Promise<RouteResult> {
      const t0 = Date.now();
      const ver = version();
      const { srj, nets, unexpressed } = jobToSrj(job);
      const allUnexpressed = [...new Set([...job.unexpressed, ...commonUnexpressed(job.constraints), ...unexpressed])];
      const base = (status: RouteResult["status"], messages: string[]): RouteResult => ({ status, ops: [], provenance: routedProvenance("tscircuit-autorouter", ver, job.runId), stats: { durationMs: Date.now() - t0, segments: 0, vias: 0, length: 0 }, unexpressed: allUnexpressed, messages, version: ver });
      if (!srj.connections.length) return base("complete", ["nothing to route"]);
      if (signal?.aborted) return base("cancelled", []);
      const done = await new Promise<WorkerDone | { cancelled: true } | { crashed: string }>((resolve) => {
        const worker = new Worker(WORKER, { workerData: { srj, timeMs: job.budget.timeMs }, resourceLimits: { maxOldGenerationSizeMb: job.budget.memoryMb } });
        let settled = false;
        const finish = (v: WorkerDone | { cancelled: true } | { crashed: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(hard);
          signal?.removeEventListener("abort", onAbort);
          void worker.terminate();
          resolve(v);
        };
        const onAbort = () => finish({ cancelled: true });
        signal?.addEventListener("abort", onAbort, { once: true });
        // a single solver step can run long: stop the worker shortly after the budget
        const hard = setTimeout(() => finish({ crashed: "the worker did not stop at the time budget" }), job.budget.timeMs + 15_000);
        worker.on("message", (m: { type: string } & Record<string, unknown>) => {
          if (m.type === "progress") onProgress({ router: id, phase: String(m.phase ?? "route"), ...(typeof m.fraction === "number" ? { fraction: m.fraction } : {}), elapsedMs: Date.now() - t0, message: `${m.iterations} iterations` });
          else if (m.type === "done") finish(m as unknown as WorkerDone);
        });
        worker.on("error", (e) => finish({ crashed: e instanceof Error ? e.message : String(e) }));
        worker.on("exit", (code) => finish({ crashed: `the worker exited with code ${code}` }));
      });
      if ("cancelled" in done) return base("cancelled", []);
      if ("crashed" in done) return base(signal?.aborted ? "cancelled" : done.crashed.includes("time budget") ? "timeout" : "failed", [`the autorouter worker stopped: ${done.crashed}`]);
      const extra: Record<string, number | string> = { iterations: done.iterations, ...Object.fromEntries(Object.entries(done.phaseMs ?? {}).map(([k, v]) => [`ms.${k}`, Math.round(v)])) };
      if (done.timedOut) return { ...base("timeout", [`no result within ${job.budget.timeMs} ms (the pinned autorouter is all-or-nothing)`]), stats: { durationMs: Date.now() - t0, segments: 0, vias: 0, length: 0, extra } };
      if (!done.solved) return { ...base("failed", [`the autorouter did not solve: ${done.error ?? "no reason given"}`]), stats: { durationMs: Date.now() - t0, segments: 0, vias: 0, length: 0, extra } };
      const routed = srjTracesToRouted(done.traces, nets, { outer: job.constraints.via.outer.plan, hole: job.constraints.via.hole.plan });
      const conv = routedToOps(job.doc, routed.segments, routed.vias);
      const length = routed.segments.reduce((s, x) => s + Math.hypot(x.end.x - x.start.x, x.end.y - x.start.y), 0);
      return {
        status: "complete",
        ops: conv.ops,
        provenance: routedProvenance("tscircuit-autorouter", done.version || ver, job.runId),
        stats: { durationMs: Date.now() - t0, segments: conv.segments, vias: conv.vias, length: Math.round(length), extra },
        unexpressed: allUnexpressed,
        messages: [...routed.messages, ...conv.dropped],
        version: done.version || ver,
      };
    },
  };
}
