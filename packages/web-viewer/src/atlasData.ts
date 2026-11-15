/**
 * The Atlas view's data from `protoboard dev` (its `/__protoboard/atlas`
 * routes, packages/cli/src/dev/atlas.ts): the project index's graph with the
 * positions the display file keeps, and saving positions with the page's
 * session token. The page calls `changed()` after each rebuild; the view
 * then loads again.
 */
import type { AtlasData, AtlasLayout, AtlasPayload } from "@protoboardai/views";

export interface DevAtlasOptions {
  /** The Atlas data route (`…/__protoboard/atlas`), absolute; the layout route is `<base>/layout`. */
  base: string;
  /** The session token writes carry, and the header it goes in. */
  token?: string;
  tokenHeader?: string;
}

export function createDevAtlasData(o: DevAtlasOptions): AtlasData & { changed(): void } {
  const base = o.base.replace(/\/+$/, "");
  const listeners = new Set<() => void>();
  return {
    async load(): Promise<AtlasPayload> {
      const res = await fetch(base, { cache: "no-store" });
      const body = (await res.json().catch(() => ({ error: `atlas: ${res.status}` }))) as AtlasPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `atlas: ${res.status}`);
      if (!body.graph || !Array.isArray(body.graph.nodes) || !Array.isArray(body.graph.edges)) throw new Error("the dev server's Atlas answer has no graph");
      return body;
    },
    async saveLayout(layout: AtlasLayout): Promise<void> {
      const res = await fetch(`${base}/layout`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(o.token ? { [o.tokenHeader ?? "x-protoboard-dev"]: o.token } : {}) },
        body: JSON.stringify({ positions: layout.positions }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `atlas layout: ${res.status}`);
      }
    },
    imageUrl: (path) => `${base}/image?path=${encodeURIComponent(path)}`,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    changed() {
      for (const l of [...listeners]) l();
    },
  };
}
