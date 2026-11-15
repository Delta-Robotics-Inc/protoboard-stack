/**
 * The Atlas tab's data in both shells (docs/specs/atlas.md): the dev page's
 * adapter (`createDevAtlasData`: the dev server's Atlas routes, writes with
 * the session token) and a VS Code viewer tab's (`createTabAtlasData`: the
 * index from the dev server, positions and Open through the extension).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevAtlasData } from "../src/atlasData.js";
import { createTabAtlasData } from "../src/vscode/atlasData.js";
import { parseFromWebview, type FromWebview } from "../src/vscode/protocol.js";

const graph = {
  project: { name: "quad", root: "sys" },
  counts: { nodes: 1, edges: 0, byKind: {}, census: { total: 0, linked: 0, unlinked: 0, failed: 0, excluded: 0 } },
  nodes: [{ id: "def:sys", kind: "module", label: "Sys", folder: "", status: "ok", degree: 0 }],
  edges: [],
};

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("the dev page's Atlas data", () => {
  it("reads the data route and saves positions to the layout route with the session token", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return init?.method === "POST" ? answer(200, { file: ".protoboard/display.json", changed: true, nodes: 1 }) : answer(200, { graph, layout: { positions: { "def:sys": [1, 2] } } });
    });
    const data = createDevAtlasData({ base: "http://127.0.0.1:5180/proxy/5180/__protoboard/atlas/", token: "t0k", tokenHeader: "x-protoboard-dev" });
    const payload = await data.load();
    expect(payload.layout).toEqual({ positions: { "def:sys": [1, 2] } });
    await data.saveLayout!({ positions: { "def:sys": [3, 4] } });
    expect(calls.map((c) => [c.init?.method ?? "GET", c.url])).toEqual([
      ["GET", "http://127.0.0.1:5180/proxy/5180/__protoboard/atlas"],
      ["POST", "http://127.0.0.1:5180/proxy/5180/__protoboard/atlas/layout"],
    ]);
    expect(calls[0].init?.cache).toBe("no-store");
    expect(calls[1].init?.headers).toEqual({ "content-type": "application/json", "x-protoboard-dev": "t0k" });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ positions: { "def:sys": [3, 4] } });
    // the page has no Open: the inspector offers Copy path
    expect(data.openFile).toBeUndefined();
  });

  it("says why the server refused, and an answer with no graph is an error", async () => {
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => (init?.method === "POST" ? answer(403, { error: "missing or wrong session token" }) : answer(503, { error: "the project index is being built" })));
    const data = createDevAtlasData({ base: "http://127.0.0.1:5180/__protoboard/atlas" });
    await expect(data.load()).rejects.toThrow("the project index is being built");
    await expect(data.saveLayout!({ positions: {} })).rejects.toThrow("missing or wrong session token");
    vi.stubGlobal("fetch", async () => answer(200, { nodes: [] }));
    await expect(data.load()).rejects.toThrow(/no graph/);
  });

  it("tells subscribers when the page says the project was rebuilt", () => {
    const data = createDevAtlasData({ base: "http://127.0.0.1:5180/__protoboard/atlas" });
    let heard = 0;
    const off = data.subscribe!(() => heard++);
    data.changed();
    off();
    data.changed();
    expect(heard).toBe(1);
  });
});

describe("a VS Code viewer tab's Atlas data", () => {
  it("reads the index from the dev server the tab reads from, and nothing before there is one", async () => {
    let base: string | undefined;
    const asked: string[] = [];
    const data = createTabAtlasData(
      () => base,
      () => undefined,
      async (url) => {
        asked.push(String(url));
        return answer(200, { graph, stale: { changed: 2, rebuilding: true } });
      },
    );
    await expect(data.load()).rejects.toThrow(/not connected/);
    base = "http://127.0.0.1:5180/proxy/5180/";
    expect((await data.load()).stale).toEqual({ changed: 2, rebuilding: true });
    expect(asked).toEqual(["http://127.0.0.1:5180/proxy/5180/__protoboard/atlas"]);
  });

  it("says why the server has no index", async () => {
    const data = createTabAtlasData(
      () => "http://127.0.0.1:5180/",
      () => undefined,
      async () => answer(503, { error: "the project index is being built" }),
    );
    await expect(data.load()).rejects.toThrow("the project index is being built");
  });

  it("sends positions and Open to the extension (never to the dev server), and tells subscribers after a rebuild", async () => {
    const posted: FromWebview[] = [];
    const fetched: string[] = [];
    const data = createTabAtlasData(
      () => "http://127.0.0.1:5180/",
      (m) => posted.push(m),
      async (url) => {
        fetched.push(String(url));
        return answer(200, { graph });
      },
    );
    await data.saveLayout!({ positions: { "def:sys": [3, 4] } });
    data.openFile!("docs/notes.md");
    expect(fetched).toEqual([]);
    expect(posted).toEqual([
      { type: "atlasLayout", positions: { "def:sys": [3, 4] } },
      { type: "openFile", path: "docs/notes.md" },
    ]);
    // what the page posts is what the extension accepts
    for (const m of posted) expect(parseFromWebview(JSON.parse(JSON.stringify(m)))).toEqual(m);
    let heard = 0;
    const off = data.subscribe!(() => heard++);
    data.changed();
    off();
    data.changed();
    expect(heard).toBe(1);
  });
});
