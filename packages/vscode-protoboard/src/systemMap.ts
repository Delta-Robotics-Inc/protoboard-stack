/**
 * The System Map in VS Code (docs/specs/system-map.md): the map of the
 * Protoboard stack this extension runs, whatever project is open, and in a
 * window with no project at all. No VS Code API here (systemMapPanel.ts has
 * the panel and the messages).
 *
 * - Which stack (`findStackRoot`): a development build is one whose
 *   extension folder lies inside the stack's monorepo, and maps that
 *   repository; any other build maps the stack it carries, as unpacked into
 *   `~/.protoboard/stack/<version>`. Never the open project's own CLI or
 *   packages: the map is the extension's stack, not the project's.
 * - The map (`SysmapCache`): built once per session by that stack's own CLI
 *   (`protoboard map --root <root> --format json`), projected to the view's
 *   graph, and kept; a rebuild (the panel's Rebuild) builds it again, and
 *   requests that arrive while one build runs share it.
 * - Open (`stackFileOf`): a stack-relative path the map names, resolved
 *   inside the stack root (links followed), there, and not a sensitive name.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stackCli, stackDir } from "@protoboardai/core/stack";
import { isSensitiveName } from "@protoboardai/core/atlas";
import { sysmapGraph, type SysmapGraph, type SystemMap } from "@protoboardai/core/sysmap";
import { isInsideReal } from "../../core/src/paths.js";
import { parseStackPath } from "../../web-viewer/src/vscode/protocol.js";
import { parseJsonOutput, type CliResult } from "./cli.js";

/** The CLI in the stack's repository, from its root. */
export const MONOREPO_CLI = join("packages", "cli", "bin", "protoboard.mjs");

/** The stack the System Map is of, and the CLI that maps it. */
export interface StackLocation {
  /** The folder `protoboard map --root` is given (and the CLI's working folder). */
  root: string;
  /** monorepo: the stack's repository (a development build); installed: the carried stack's unpacked copy. */
  layout: "monorepo" | "installed";
  /** The CLI's script (run with the extension's chosen Node.js). */
  cli: string;
  /** installed: the carried stack's version (its copy is unpacked before the CLI runs). */
  version?: string;
}

export interface FindStackOptions {
  /** The extension's own folder (`context.extensionPath`). */
  extensionPath: string;
  /** The user's Protoboard folder (core's `stackHome()`). */
  home: string;
  /** The stack this build carries (its manifest), if any. */
  carried?: { version: string };
  exists?: (path: string) => boolean;
  readJson?: (path: string) => unknown;
}

/** What a window says when there is no stack to map. */
export const NO_STACK_MESSAGE =
  "This build of the Protoboard extension carries no stack and does not run from the stack's repository, so it has no System Map to show. Install the Protoboard extension that carries the stack.";

const hasWorkspaces = (json: unknown): boolean => {
  const ws = json && typeof json === "object" && !Array.isArray(json) ? (json as { workspaces?: unknown }).workspaces : undefined;
  return Array.isArray(ws) ? ws.length > 0 : !!ws && typeof ws === "object";
};

/**
 * The stack the extension runs. Walking up from the extension's folder, the
 * first folder whose package.json has `workspaces` and which holds
 * `packages/cli/bin/protoboard.mjs` is the stack's repository: this is a
 * development build, and that repository is mapped (layout monorepo).
 * Otherwise the stack the build carries, in its unpacked copy (layout
 * installed; the caller unpacks it first). Otherwise an Error: this build
 * carries no stack.
 */
export function findStackRoot(o: FindStackOptions): StackLocation {
  const exists = o.exists ?? existsSync;
  const readJson = o.readJson ?? ((p: string) => JSON.parse(readFileSync(p, "utf8")) as unknown);
  for (let d = resolve(o.extensionPath); ; d = dirname(d)) {
    const pkg = join(d, "package.json");
    if (exists(pkg)) {
      let json: unknown;
      try {
        json = readJson(pkg);
      } catch {
        json = undefined;
      }
      if (hasWorkspaces(json) && exists(join(d, MONOREPO_CLI))) return { root: d, layout: "monorepo", cli: join(d, MONOREPO_CLI) };
    }
    if (dirname(d) === d) break;
  }
  if (o.carried) {
    const dir = stackDir(o.home, o.carried.version);
    return { root: dir, layout: "installed", cli: stackCli(dir), version: o.carried.version };
  }
  throw new Error(NO_STACK_MESSAGE);
}

export interface SysmapCacheDeps {
  /** Which stack (findStackRoot): asked at every build. Throws when there is none. */
  locate(): StackLocation;
  /** Unpack the carried stack if it is not yet (extension.ts's prepareStack); run before an installed stack's CLI. */
  prepare?(): Promise<void>;
  /** Run the stack's CLI script with these arguments in `cwd` (runCli with the extension's runtime). */
  run(cli: string, args: string[], cwd: string): Promise<CliResult>;
  /** One line per build for the Protoboard log. */
  log(line: string): void;
  exists?: (path: string) => boolean;
  now?: () => number;
}

/**
 * The System Map of the session: built on the first request and kept. A
 * request with `refresh` builds it again; requests that arrive while a build
 * runs (refresh or not) share it. A build that fails is not kept: the
 * request is refused with what failed, the map built before (if any) stays,
 * and the next refresh (or, with none kept, the next request) tries again.
 */
export class SysmapCache {
  private kept: SysmapGraph | undefined;
  private building: Promise<SysmapGraph> | undefined;
  private where: StackLocation | undefined;
  /** How many builds ran (the tests and the log). */
  readonly stats = { builds: 0 };

  constructor(private readonly deps: SysmapCacheDeps) {}

  get(o: { refresh?: boolean } = {}): Promise<SysmapGraph> {
    if (this.building) return this.building;
    if (this.kept && !o.refresh) return Promise.resolve(this.kept);
    this.building = this.build().finally(() => (this.building = undefined));
    return this.building;
  }

  /** The stack the map is of: the last build's, else the one a build would map now (throws when there is none). */
  location(): StackLocation {
    return this.where ?? this.deps.locate();
  }

  private async build(): Promise<SysmapGraph> {
    const now = this.deps.now ?? Date.now;
    const exists = this.deps.exists ?? existsSync;
    const t0 = now();
    this.stats.builds++;
    let at: StackLocation | undefined;
    try {
      at = this.deps.locate();
      if (at.layout === "installed") await this.deps.prepare?.();
      if (!exists(at.cli)) throw new Error(`the stack's CLI is not at ${at.cli}`);
      const r = await this.deps.run(at.cli, ["map", "--root", at.root, "--format", "json"], at.root);
      const map = parseJsonOutput<SystemMap>(r, "protoboard map");
      if (!map || typeof map !== "object" || !Array.isArray(map.items) || !Array.isArray(map.links)) throw new Error("protoboard map printed no System Map");
      const graph = sysmapGraph(map);
      this.kept = graph;
      this.where = at;
      this.deps.log(
        `System Map: built from ${at.root} (${at.layout === "monorepo" ? "the stack's repository" : `the carried stack ${at.version ?? ""}`.trim()}, stack ${graph.stack}) in ${seconds(now() - t0)}: ${graph.items.length} items, ${graph.links.length} links, ${graph.problems.length} problem(s)`,
      );
      return graph;
    } catch (e) {
      this.deps.log(`System Map: the build${at ? ` from ${at.root}` : ""} failed after ${seconds(now() - t0)}: ${(e as Error).message}`);
      throw e;
    }
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** A file the System Map may open, or why not. */
export type StackFile = { file: string } | { refused: string };

/**
 * The file a System Map item names (its `source`, without the `#entry`),
 * resolved in the stack root: refused unless it is a stack-relative path
 * (protocol.ts `parseStackPath`) that lies inside the root once links are
 * followed, is not a sensitive name (.env*, keys, credentials), and is a
 * file that is there.
 */
export function stackFileOf(root: string, path: string, isFile: (file: string) => boolean = isAFile): StackFile {
  const rel = parseStackPath(path);
  if (rel === undefined) return { refused: `${JSON.stringify(path)} is not a path inside the Protoboard stack.` };
  if (isSensitiveName(rel)) return { refused: `${rel} is not opened from the System Map (its name looks like a secret's).` };
  const file = resolve(root, ...rel.split("/"));
  if (file === resolve(root) || !isInsideReal(root, file)) return { refused: `${rel} is not a file of the Protoboard stack.` };
  if (!isFile(file)) return { refused: `${rel} is not in the stack (moved or deleted since the map was built: Rebuild builds it again).` };
  return { file };
}

function isAFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
