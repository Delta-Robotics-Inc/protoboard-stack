/**
 * Run a generator's Python without blocking: a build takes tens of seconds,
 * and a synchronous child process holds the event loop of whatever shares the
 * process (the dev server, a test runner's worker RPC) for all of it.
 */
import { spawn } from "node:child_process";

export type RunResult = { ok: true; stdout: string } | { ok: false; error: string };

/** `command args…` with stdout collected; on failure, the last line of stderr (or why it did not run). */
export function runAsync(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], timeout: options.timeout });
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr!.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (e) => resolve({ ok: false, error: e.message.split("\n")[0] }));
    child.on("close", (code, signal) => {
      if (code === 0) resolve({ ok: true, stdout });
      else resolve({ ok: false, error: stderr.trim().split("\n").pop() || `${command} exited with ${code ?? signal}` });
    });
  });
}
