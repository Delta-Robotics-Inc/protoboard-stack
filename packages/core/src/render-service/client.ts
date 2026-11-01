/**
 * Reaching a project's render service (PB-1180) from the CLI or the MCP
 * server: read `.protoboard/local/render-service.json`, check the service
 * answers (`/health` with the session token), else start one (the caller
 * says how: the CLI spawns `protoboard views service` detached) and wait for
 * its record. Every call is JSON over loopback HTTP.
 */
import { readServiceRecord } from "./files.js";
import type { ServiceHealth } from "./service.js";
import { TOKEN_HEADER } from "./service.js";
import type { CaptureResponse, ServiceRecord } from "./schema.js";
import { isCaptureResponse } from "./schema.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RenderClient {
  record: ServiceRecord;
  /** Whether this call started the service (its first capture pays the browser start and the page load). */
  started: boolean;
  health(): Promise<ServiceHealth>;
  capture(request: unknown): Promise<CaptureResponse>;
  /** POST to a route; NDJSON lines stream to `onLine`, the last line is the result. */
  stream<T>(path: string, body: unknown, onLine?: (line: unknown) => void): Promise<T>;
  shutdown(): Promise<void>;
}

async function call(record: ServiceRecord, method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 600000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(new URL(path.replace(/^\//, ""), record.url), {
      method,
      headers: { [TOKEN_HEADER]: record.token, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/** The service's health, or undefined when the record is stale (nothing answers, or another token). */
export async function probeService(record: ServiceRecord, timeoutMs = 2000): Promise<ServiceHealth | undefined> {
  try {
    const r = await call(record, "GET", "/health", undefined, timeoutMs);
    if (!r.ok) return undefined;
    const h = (await r.json()) as ServiceHealth;
    return h.ok ? h : undefined;
  } catch {
    return undefined;
  }
}

function clientFor(record: ServiceRecord, started: boolean): RenderClient {
  const errorOf = async (r: Response) => {
    const text = await r.text();
    try {
      return (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      return text;
    }
  };
  return {
    record,
    started,
    async health() {
      const r = await call(record, "GET", "/health", undefined, 5000);
      if (!r.ok) throw new Error(`render service: ${await errorOf(r)}`);
      return (await r.json()) as ServiceHealth;
    },
    async capture(request) {
      const r = await call(record, "POST", "/capture", request);
      if (!r.ok) throw new Error(`render service: ${await errorOf(r)}`);
      const v = await r.json();
      if (!isCaptureResponse(v)) throw new Error("render service: the response is not a capture (an older or newer service?)");
      return v;
    },
    async stream<T>(path: string, body: unknown, onLine?: (line: unknown) => void): Promise<T> {
      const r = await call(record, "POST", path, body);
      if (!r.ok || !r.body) throw new Error(`render service: ${await errorOf(r)}`);
      let last: unknown;
      let rest = "";
      const decoder = new TextDecoder();
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        rest += decoder.decode(chunk, { stream: true });
        let i: number;
        while ((i = rest.indexOf("\n")) >= 0) {
          const line = rest.slice(0, i).trim();
          rest = rest.slice(i + 1);
          if (!line) continue;
          const v = JSON.parse(line) as { error?: string };
          if (v && typeof v === "object" && "error" in v && Object.keys(v).length === 1) throw new Error(`render service: ${v.error}`);
          last = v;
          onLine?.(v);
        }
      }
      if (rest.trim()) last = JSON.parse(rest);
      return last as T;
    },
    async shutdown() {
      await call(record, "POST", "/shutdown", {}, 5000).catch(() => undefined);
    },
  };
}

export interface EnsureOptions {
  /** Start a service for `root` (detached); the client then waits for its record. */
  spawn: () => void;
  /** How long to wait for a new service's record and health (default 60 s). */
  timeoutMs?: number;
  /** The caller's version: an older service (another CLI) is replaced. */
  version?: string;
}

/** A client for the project's service: the running one, or a new one started with `spawn`. */
export async function ensureRenderService(root: string, opts: EnsureOptions): Promise<RenderClient> {
  const existing = readServiceRecord(root);
  if (existing && (await probeService(existing))) {
    if (!opts.version || existing.version === opts.version) return clientFor(existing, false);
    await clientFor(existing, false).shutdown();
    for (let i = 0; i < 50 && readServiceRecord(root)?.pid === existing.pid; i++) await sleep(100);
  }
  opts.spawn();
  const deadline = Date.now() + (opts.timeoutMs ?? 60000);
  while (Date.now() < deadline) {
    await sleep(150);
    const r = readServiceRecord(root);
    if (r && r.pid !== existing?.pid && (await probeService(r, 1000))) return clientFor(r, true);
  }
  throw new Error(`the render service did not start in ${Math.round((opts.timeoutMs ?? 60000) / 1000)} s (no answer at .protoboard/local/render-service.json); run \`protoboard views service\` in the project to see why`);
}

/** A client for the running service only (no start); undefined when none answers. */
export async function connectRenderService(root: string): Promise<RenderClient | undefined> {
  const r = readServiceRecord(root);
  return r && (await probeService(r)) ? clientFor(r, false) : undefined;
}
