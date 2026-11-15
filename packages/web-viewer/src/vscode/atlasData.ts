/**
 * The Atlas tab's data in a VS Code viewer tab (./index.ts): the project
 * index from the dev server the tab reads from (CORS, never the write
 * token), and the positions and the files it opens through the extension
 * (protocol.ts `atlasLayout`, `openFile`), which writes the display file and
 * checks every path. No React here.
 */
import type { AtlasData, AtlasPayload } from "@protoboardai/views";
import type { FromWebview } from "./protocol.js";

/**
 * The Atlas tab's data in a viewer tab: the index from the dev server at
 * `base()` (its `__protoboard/atlas` route), positions and Open through the
 * extension (`post`). `changed()` tells the view to load again.
 */
export function createTabAtlasData(base: () => string | undefined, post: (m: FromWebview) => void, fetchImpl: typeof fetch = (url, init) => fetch(url, init)): AtlasData & { changed(): void } {
  const listeners = new Set<() => void>();
  return {
    async load(): Promise<AtlasPayload> {
      const at = base();
      if (!at) throw new Error("This tab is not connected to the project's dev server yet.");
      const res = await fetchImpl(new URL("__protoboard/atlas", at).href, { cache: "no-store" });
      const body = (await res.json().catch(() => ({ error: `atlas: ${res.status}` }))) as AtlasPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `atlas: ${res.status}`);
      if (!body.graph || !Array.isArray(body.graph.nodes) || !Array.isArray(body.graph.edges)) throw new Error("the dev server's Atlas answer has no graph");
      return body;
    },
    // the extension writes the display file (the webview never holds the dev server's write token)
    async saveLayout(layout) {
      post({ type: "atlasLayout", positions: layout.positions });
    },
    openFile: (path) => post({ type: "openFile", path }),
    // an image the index lists, from the dev server (a read route, like the index itself)
    imageUrl(path) {
      const at = base();
      return at ? `${new URL("__protoboard/atlas/image", at).href}?path=${encodeURIComponent(path)}` : undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    changed() {
      for (const l of [...listeners]) l();
    },
  };
}
