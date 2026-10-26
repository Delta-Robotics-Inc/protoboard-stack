/**
 * Running tscircuit in Protoboard's own Node process, offline by
 * construction (docs/research/tscircuit-spike.md §1, §7, §9):
 *
 *   - the native source (TSX) is compiled with sucrase and evaluated here;
 *     `tsci` (which needs Bun) is never spawned
 *   - @tscircuit/core renders it with the parts engine disabled, the cloud
 *     autorouter off and a local autorouter preset
 *   - `fetch` is replaced for the duration by a guard that serves absolute
 *     local paths and file:// URLs from disk and refuses everything else, so
 *     a build or an export cannot reach the network even by accident
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "sucrase";

const localRequire = createRequire(import.meta.url);

/** A circuit JSON element (the tscircuit interchange format). */
export type CircuitElement = { type: string; [key: string]: any };

/** Network requests refused while the guard was installed (for reports and tests). */
export const refusedRequests: string[] = [];

/**
 * The local file a model URL names, or undefined when it names none: a
 * file:// URL, or an absolute path. On Windows that is `C:\\…`, `C:/…` or a
 * UNC path as well as `/…`, and a file:// URL is `file:///C:/…` (whose URL
 * pathname `/C:/…` is not a path there). `platform` is for tests.
 */
export function localFile(url: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const windows = platform === "win32";
  if (url.startsWith("file://")) {
    try {
      return fileURLToPath(url, { windows });
    } catch {
      return undefined;
    }
  }
  return (windows ? win32 : posix).isAbsolute(url) ? url : undefined;
}

/** Local files the guard was asked for while installed: found and read, or missing. */
export interface FileRequests {
  read: string[];
  missing: string[];
}

/**
 * Run `fn` with `fetch` restricted to local files. Absolute paths and
 * file:// URLs are read from disk; data: and blob: URLs pass through;
 * anything else throws. `files`, when given, collects the local files asked
 * for (so a caller can say which bodies loaded).
 */
export async function offline<T>(fn: () => Promise<T>, options: { files?: FileRequests; platform?: NodeJS.Platform } = {}): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === "string" ? input : ((input as { url?: string })?.url ?? String(input));
    const file = localFile(url, options.platform);
    if (file) {
      if (!existsSync(file)) {
        options.files?.missing.push(file);
        return new Response(null, { status: 404 });
      }
      options.files?.read.push(file);
      return new Response(readFileSync(file));
    }
    if (url.startsWith("data:") || url.startsWith("blob:")) return real(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    refusedRequests.push(url);
    throw new Error(`@protoboardai/ext-tscircuit works offline: refused a network request to ${url.slice(0, 120)}`);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const SOURCE_EXT = [".tsx", ".ts", ".jsx", ".js"];

/**
 * Load a TSX module and its relative imports; bare imports resolve from this package (react, react/jsx-runtime).
 * `loaded` collects the absolute path of every file read: the entry, each relative import (JSON included),
 * wherever it lives (a hand file shared with another board's folder).
 */
export function loadTsx(entry: string, loaded?: Set<string>): Record<string, unknown> {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const load = (file: string): Record<string, unknown> => {
    const hit = cache.get(file);
    if (hit) return hit.exports;
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(file, mod);
    loaded?.add(file);
    if (extname(file) === ".json") {
      mod.exports = JSON.parse(readFileSync(file, "utf8"));
      return mod.exports;
    }
    const { code } = transform(readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true, filePath: file });
    const req = (spec: string) => {
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const base = resolve(dirname(file), spec);
        const found = [base, ...SOURCE_EXT.map((e) => base + e), ...SOURCE_EXT.map((e) => join(base, "index" + e))].find((p) => existsSync(p) && !readdirSafe(p));
        if (!found) throw new Error(`${file}: cannot resolve ${spec}`);
        return load(found);
      }
      return localRequire(spec);
    };
    new Function("exports", "require", "module", "__filename", "__dirname", code)(mod.exports, req, mod, file, dirname(file));
    return mod.exports;
  };
  return load(resolve(entry));
}

function readdirSafe(p: string): boolean {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

export interface BuildResult {
  circuitJson: CircuitElement[];
  ms: number;
  /** @tscircuit/core version that rendered it. */
  coreVersion: string;
  /** What tscircuit printed while building (router progress, solver notes). */
  log: string[];
  /** Every source file the build read (absolute): the entry and its relative imports, JSON included. */
  files: string[];
}

/** Installed version of a dependency, read from its package.json (several hide it behind "exports"). */
export function packageVersion(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const file = join(dir, "node_modules", name, "package.json");
    if (existsSync(file)) return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
    const up = dirname(dir);
    if (up === dir) return "unknown";
    dir = up;
  }
}

export const coreVersion = (): string => packageVersion("@tscircuit/core");

/** Run `fn` with console.log/info/warn collected instead of printed (the router is chatty); `only` keeps just the lines it accepts. */
export async function quietly<T>(fn: () => Promise<T>, log: string[], only?: (line: string) => boolean): Promise<T> {
  const saved = { log: console.log, info: console.info, warn: console.warn, debug: console.debug, error: console.error };
  const keep = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (log.length < 2000 && (!only || only(line))) log.push(line);
  };
  Object.assign(console, { log: keep, info: keep, warn: keep, debug: keep, error: keep });
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
}

/**
 * Render the board exported by `entry` (default export: a component taking
 * no props) to circuit JSON with @tscircuit/core, offline.
 */
export async function buildCircuit(entry: string, options: { routing?: boolean } = {}): Promise<BuildResult> {
  const t0 = performance.now();
  const loaded = new Set<string>();
  const mod = loadTsx(entry, loaded);
  const Board = mod.default as (() => unknown) | undefined;
  if (typeof Board !== "function") throw new Error(`${entry} has no default export (the board component)`);
  const log: string[] = [];
  const circuitJson = await quietly(() => offline(async () => {
    const { Circuit } = (await import("@tscircuit/core")) as unknown as { Circuit: new (o: unknown) => { add(e: unknown): void; renderUntilSettled(): Promise<void>; getCircuitJson(): CircuitElement[] } };
    const { createElement } = localRequire("react") as { createElement: (c: unknown) => unknown };
    const circuit = new Circuit({ platform: { partsEngineDisabled: true, useCloudAutorouter: false, ...(options.routing === false ? { routingDisabled: true } : {}) } });
    circuit.add(createElement(Board));
    await circuit.renderUntilSettled();
    return circuit.getCircuitJson();
  }), log);
  return { circuitJson, ms: Math.round(performance.now() - t0), coreVersion: coreVersion(), log, files: [...loaded].sort() };
}
