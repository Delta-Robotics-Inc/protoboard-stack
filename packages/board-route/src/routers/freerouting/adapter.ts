/**
 * The Freerouting adapter (the fallback router): an installed Freerouting run headless as a separate program on a
 * DSN this package writes, its SES read back into operations. On every run: no GUI, analytics off, a private user
 * data folder, a time limit, a thread cap, a heap cap, and Java's HTTP proxy pointed at a closed local port so
 * neither its update check nor anything else can reach the network. Board data never leaves the machine.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copperLayers } from "@protoboardai/board";
import { routedProvenance, routedToOps } from "../../ops.js";
import type { RouteJob, RouteResult, Router } from "../../types.js";
import { detectFreerouting, type DetectOptions, type FreeroutingDetection } from "./detect.js";
import { jobToDsn } from "./dsn.js";
import { parseSes } from "./ses.js";

export interface FreeroutingOptions extends DetectOptions {
  /** Routing passes (default 100). */
  maxPasses?: number;
  /** Keep the DSN, SES and log in the work folder (for debugging); default false. */
  keepFiles?: boolean;
}

const hms = (ms: number) => {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Java options for every run: heap cap, headless, and HTTP(S) through a closed local port (no network). */
export function javaOptions(memoryMb: number): string[] {
  return [`-Xmx${memoryMb}m`, "-Djava.awt.headless=true", "-Djava.net.useSystemProxies=false", "-Dhttp.proxyHost=127.0.0.1", "-Dhttp.proxyPort=9", "-Dhttps.proxyHost=127.0.0.1", "-Dhttps.proxyPort=9", "-Dhttp.nonProxyHosts=", "-Dlog4j2.disableJndi=true"];
}

/** Freerouting's command-line arguments for one run. */
export function freeroutingArgs(dsn: string, ses: string, userData: string, job: Pick<RouteJob, "budget" | "constraints">, maxPasses: number): string[] {
  return [
    "-de",
    dsn,
    "-do",
    ses,
    "--gui.enabled=false",
    "-da",
    "--usage_and_diagnostic_data.disable_analytics=true",
    `--user_data_path=${userData}`,
    `--router.job_timeout=${hms(job.budget.timeMs)}`,
    `--router.max_threads=${Math.max(1, job.budget.threads)}`,
    `--router.max_passes=${maxPasses}`,
    "--router.fanout.enabled=false",
    `--router.copper_to_edge_clearance_um=${Math.round(job.constraints.edgeClearance.plan / 1000)}`,
  ];
}

export function createFreeroutingRouter(options: FreeroutingOptions = {}): Router {
  const id = "freerouting";
  let detection: FreeroutingDetection | undefined;
  let ranVersion: string | undefined;
  const detect = () => (detection ??= detectFreerouting(options));
  const version = () => ranVersion ?? (detect().ok ? (detect() as { install: { version: string } }).install.version : "not installed");
  return {
    id,
    title: "Freerouting (installed separately)",
    version,
    available() {
      const d = detect();
      return d.ok ? { ok: true } : { ok: false, reason: `${d.reason}. ${d.howToInstall}` };
    },
    // a JVM starts before it routes anything (seconds on a laptop): not worth starting with less time left than that
    capabilities: { layers: { min: 1, max: 10 }, region: false, netSubset: true, respectsLockedCopper: true, incremental: true, maxThreads: 16, startupMs: 3000 },
    express(job) {
      const out = jobToDsn(job).unexpressed;
      out.push("seed: Freerouting takes no seed; one thread keeps runs repeatable");
      return out;
    },
    async route(job: RouteJob, signal, onProgress): Promise<RouteResult> {
      const t0 = Date.now();
      const d = detect();
      const prov = () => routedProvenance("freerouting", version(), job.runId);
      const empty = (status: RouteResult["status"], messages: string[], unexpressed = job.unexpressed): RouteResult => ({ status, ops: [], provenance: prov(), stats: { durationMs: Date.now() - t0, segments: 0, vias: 0, length: 0 }, unexpressed, messages, version: version() });
      if (!d.ok) return empty("unavailable", [`${d.reason}. ${d.howToInstall}`]);
      const dsn = jobToDsn(job, { name: "Protoboard", version: "board-route" });
      const unexpressed = [...new Set([...job.unexpressed, ...dsn.unexpressed])];
      if (!dsn.nets.size) return empty("complete", ["nothing to route"], unexpressed);
      if (signal?.aborted) return empty("cancelled", [], unexpressed);
      const work = mkdtempSync(join(tmpdir(), "protoboard-route-"));
      const dsnPath = join(work, "board.dsn");
      const sesPath = join(work, "board.ses");
      writeFileSync(dsnPath, dsn.text, "utf8");
      const args = freeroutingArgs(dsnPath, sesPath, join(work, "user"), job, options.maxPasses ?? 100);
      const install = d.install;
      const jopts = javaOptions(job.budget.memoryMb);
      const cmd = install.kind === "jar" ? install.java! : install.path;
      const fullArgs = install.kind === "jar" ? [...jopts, "-jar", install.path, ...args] : args;
      const env = { ...process.env, ...(install.kind === "exe" ? { JAVA_TOOL_OPTIONS: jopts.join(" ") } : {}) };
      let log = "";
      let reportedOpen: number | undefined;
      let violations: number | undefined;
      let passes = 0;
      const run = await new Promise<{ code: number | null; killed: "cancel" | "timeout" | undefined; error?: string }>((resolve) => {
        const child = spawn(cmd, fullArgs, { cwd: work, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let killed: "cancel" | "timeout" | undefined;
        const hard = setTimeout(() => {
          killed = "timeout";
          child.kill();
        }, job.budget.timeMs + 20_000);
        const onAbort = () => {
          killed = "cancel";
          child.kill();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        const onData = (b: Buffer) => {
          const text = b.toString("utf8");
          log += text;
          if (log.length > 2_000_000) log = log.slice(-1_000_000);
          for (const line of text.split(/\r?\n/)) {
            const v = /Freerouting v(\d+\.\d+\.\d+)/.exec(line);
            if (v) ranVersion = v[1];
            const p = /Auto-routing pass #(\d+)/.exec(line);
            if (p) {
              passes = Number(p[1]);
              onProgress({ router: id, phase: `pass ${passes}`, elapsedMs: Date.now() - t0, message: line.replace(/^.*?\] /, "").slice(0, 200) });
            }
            if (/Optimization stage started/.test(line)) onProgress({ router: id, phase: "optimize", elapsedMs: Date.now() - t0 });
            const s = /\((\d+) unrouted and (\d+) violations\)/.exec(line);
            if (s && /completed/.test(line)) {
              reportedOpen = Number(s[1]);
              violations = Number(s[2]);
            }
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", (e) => {
          clearTimeout(hard);
          signal?.removeEventListener("abort", onAbort);
          resolve({ code: null, killed, error: e.message });
        });
        child.on("close", (code) => {
          clearTimeout(hard);
          signal?.removeEventListener("abort", onAbort);
          resolve({ code, killed });
        });
      });
      try {
        const extra: Record<string, number | string> = { passes, ...(violations !== undefined ? { violations } : {}) };
        if (run.killed === "cancel") return empty("cancelled", [], unexpressed);
        if (!existsSync(sesPath)) {
          const tail = log.split(/\r?\n/).filter((l) => /ERROR|WARN|Exception/.test(l)).slice(-5).join(" | ");
          return { ...empty(run.killed === "timeout" ? "timeout" : "failed", [`Freerouting wrote no session file (exit ${run.code ?? "none"}${run.error ? `, ${run.error}` : ""})${tail ? `: ${tail}` : ""}`], unexpressed), stats: { durationMs: Date.now() - t0, segments: 0, vias: 0, length: 0, extra } };
        }
        const ses = parseSes(readFileSync(sesPath, "utf8"), dsn.nets, copperLayers(job.doc), dsn.via.hole);
        const conv = routedToOps(job.doc, ses.segments, ses.vias);
        const timedOut = run.killed === "timeout" || /TIMED_OUT|timed out/i.test(log);
        const status: RouteResult["status"] = timedOut ? "timeout" : reportedOpen && reportedOpen > 0 ? "partial" : "complete";
        const length = ses.segments.reduce((s, x) => s + Math.hypot(x.end.x - x.start.x, x.end.y - x.start.y), 0);
        return {
          status,
          ops: conv.ops,
          provenance: prov(),
          stats: { durationMs: Date.now() - t0, segments: conv.segments, vias: conv.vias, length: Math.round(length), ...(reportedOpen !== undefined ? { routerReportedOpen: reportedOpen } : {}), extra },
          unexpressed,
          messages: [...ses.messages, ...conv.dropped],
          version: version(),
        };
      } finally {
        if (!options.keepFiles) rmSync(work, { recursive: true, force: true });
      }
    },
  };
}
