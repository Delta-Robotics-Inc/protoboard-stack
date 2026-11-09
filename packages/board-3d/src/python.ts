/**
 * The stack's CAD runtime (Python with OCP over OCCT), optional. Found as the other CAD packages find it: the
 * `PROTOBOARD_PYTHON` environment variable (empty means "none"), else a project's `.protoboard/tools/cad` runtime
 * (`protoboard tools install cad`) at or above the given folder. Only OCP is imported, never build123d, so a run
 * starts in about a second.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PY_SCRIPT = fileURLToPath(new URL("../py/board3d.py", import.meta.url));

/** The CAD runtime's Python, or undefined. */
export function findCadPython(from?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.PROTOBOARD_PYTHON !== undefined) return env.PROTOBOARD_PYTHON || undefined;
  let dir = from;
  while (dir) {
    for (const rel of [".protoboard/tools/cad/Scripts/python.exe", ".protoboard/tools/cad/bin/python"]) {
      const p = join(dir, rel);
      if (existsSync(p)) return p;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

/** Run the helper script; resolves with its parsed JSON output. */
export function runCadPython<T>(python: string, args: string[], timeoutMs = 600_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-I", PY_SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, env: { ...process.env, PYTHONHASHSEED: "0" } });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`CAD runtime exited with ${code}: ${err.trim().split("\n").slice(-2).join(" | ")}`));
      // OCCT can print its own banners to stdout: the result is the one line that is a JSON object
      const line = out.split("\n").map((l) => l.trim()).find((l) => l.startsWith("{"));
      try {
        resolve(JSON.parse(line ?? out) as T);
      } catch {
        reject(new Error(`CAD runtime gave no JSON: ${out.slice(0, 200)}`));
      }
    });
  });
}
