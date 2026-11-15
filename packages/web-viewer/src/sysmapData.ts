/**
 * The System Map view's data from `protoboard dev` (its `/__protoboard/sysmap`
 * route, packages/cli/src/dev/sysmap.ts): the map of the stack the dev
 * server's CLI runs from, read only (no session token). The server keeps the
 * map and rebuilds it when it goes stale, so `refresh()` and `changed()` only
 * tell the view to load again. The page has no Open: the inspector offers
 * Copy path.
 */
import type { SysmapData, SysmapPayload } from "@protoboardai/views";

export interface DevSysmapOptions {
  /** The System Map route (`…/__protoboard/sysmap`), absolute. */
  base: string;
}

/** An answer that carries a graph with its items and links (what a view cannot do without). */
export function isSysmapPayload(v: unknown): v is SysmapPayload {
  const graph = v && typeof v === "object" ? (v as { graph?: unknown }).graph : undefined;
  return !!graph && typeof graph === "object" && Array.isArray((graph as { items?: unknown }).items) && Array.isArray((graph as { links?: unknown }).links);
}

export function createDevSysmapData(o: DevSysmapOptions): SysmapData & { changed(): void } {
  const base = o.base.replace(/\/+$/, "");
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };
  return {
    async load(): Promise<SysmapPayload> {
      const res = await fetch(base, { cache: "no-store" });
      const body = (await res.json().catch(() => ({ error: `sysmap: ${res.status}` }))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `sysmap: ${res.status}`);
      if (!isSysmapPayload(body)) throw new Error("the dev server's System Map answer has no graph");
      return body;
    },
    // the server rebuilds a stale map by itself: loading again is the rebuild
    refresh: changed,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    changed,
  };
}
