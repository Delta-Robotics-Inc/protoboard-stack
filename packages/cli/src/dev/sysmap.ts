/**
 * The System Map in `protoboard dev` (docs/specs/system-map.md): the
 * Atlas view's second data source, the map of the stack the dev server's CLI
 * runs from.
 *
 * `GET /__protoboard/sysmap` answers `{ graph: sysmapGraph(map) }`: items,
 * links, islands, stages, release tags and problems; paths (stack-relative)
 * and metadata only, never a file's contents, never the freshness inputs.
 * The map is built in memory on the first request and kept: never written.
 * A later request checks its freshness at most once every SYSMAP_CHECK_MS
 * and rebuilds it when it is stale; requests that arrive meanwhile share that
 * one check or build. A build that fails answers 500 `{ error }`, and the next
 * request tries again.
 *
 * No Node and no core imports here (types only): the server passes the
 * builder and the freshness check in.
 */
import type { SysmapGraph, SystemMap } from "@protoboardai/core";

/** The dev server's System Map route. */
export const SYSMAP_ROUTES = { data: "/__protoboard/sysmap" } as const;

/** A kept map's freshness is checked at most this often. */
export const SYSMAP_CHECK_MS = 10_000;

export interface SysmapSourceOptions {
  /** Builds the map (the server: buildSystemMap of the stack root). */
  build(): Promise<SystemMap>;
  /** Whether a map still describes the stack (the server: sysmapFreshness). */
  fresh(map: SystemMap): Promise<boolean>;
  /** The view projection (core's sysmapGraph). */
  graph(map: SystemMap): SysmapGraph;
  now?: () => number;
  checkMs?: number;
}

export interface SysmapSource {
  /** The current map's graph: built, kept, or rebuilt when stale. Rejects when a build fails. */
  graph(): Promise<SysmapGraph>;
  /** How many builds and freshness checks ran (for the log and the tests). */
  readonly stats: { builds: number; checks: number };
}

/** The map the route serves, kept in memory (see the module's comment for the rule). */
export function sysmapSource(options: SysmapSourceOptions): SysmapSource {
  const now = options.now ?? Date.now;
  const every = options.checkMs ?? SYSMAP_CHECK_MS;
  const stats = { builds: 0, checks: 0 };
  let kept: { map: SystemMap; graph: SysmapGraph; checkedAt: number } | undefined;
  let pending: Promise<SysmapGraph> | undefined;
  const build = async (): Promise<SysmapGraph> => {
    stats.builds++;
    const map = await options.build();
    kept = { map, graph: options.graph(map), checkedAt: now() };
    return kept.graph;
  };
  const refresh = async (): Promise<SysmapGraph> => {
    if (!kept) return build();
    stats.checks++;
    const fresh = await options.fresh(kept.map);
    if (fresh) {
      kept.checkedAt = now();
      return kept.graph;
    }
    return build();
  };
  return {
    stats,
    graph() {
      if (kept && now() - kept.checkedAt < every) return Promise.resolve(kept.graph);
      // one check or build at a time: the requests that arrive meanwhile wait for it
      if (!pending) pending = refresh().finally(() => (pending = undefined));
      return pending;
    },
  };
}

/** The route's answer: the graph, or 500 with what failed. */
export async function sysmapAnswer(source: SysmapSource): Promise<{ status: number; body: { graph: SysmapGraph } | { error: string } }> {
  try {
    return { status: 200, body: { graph: await source.graph() } };
  } catch (e) {
    return { status: 500, body: { error: `the System Map could not be built: ${(e as Error).message}` } };
  }
}
