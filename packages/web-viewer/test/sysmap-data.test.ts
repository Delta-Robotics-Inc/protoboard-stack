/**
 * The System Map's data in both shells (docs/specs/system-map.md): the dev
 * page's adapter (`createDevSysmapData`: the dev server's read-only route)
 * and a VS Code page's (`createVsCodeSysmapData`: the map asked of the
 * extension, which runs the stack), and the messages the extension takes
 * for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevSysmapData } from "../src/sysmapData.js";
import { createVsCodeSysmapData } from "../src/vscode/sysmapData.js";
import { parseFromWebview, parseStackPath, type FromWebview } from "../src/vscode/protocol.js";
import type { SysmapGraph } from "@protoboardai/core/sysmap";

const graph = {
  stack: "0.3.0",
  layout: "monorepo",
  counts: { items: 0, links: 0, byType: {}, byDiscipline: {}, byStatus: { released: 0, wip: 0, outside: 0 }, byLinkKind: {}, problems: 0 },
  islands: [],
  stages: [],
  releases: [],
  items: [],
  links: [],
  problems: [],
} as unknown as SysmapGraph;

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("the dev page's System Map data", () => {
  it("reads the route with no cache and no token, and has no Open", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return answer(200, { graph });
    });
    const data = createDevSysmapData({ base: "http://127.0.0.1:5180/proxy/5180/__protoboard/sysmap/" });
    expect((await data.load()).graph).toEqual(graph);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:5180/proxy/5180/__protoboard/sysmap");
    expect(calls[0].init?.cache).toBe("no-store");
    expect(calls[0].init?.headers).toBeUndefined();
    expect(data.openFile).toBeUndefined();
  });

  it("says why the server could not build the map, and an answer with no items or links is an error", async () => {
    vi.stubGlobal("fetch", async () => answer(500, { error: "the System Map could not be built: no stack" }));
    const data = createDevSysmapData({ base: "http://127.0.0.1:5180/__protoboard/sysmap" });
    await expect(data.load()).rejects.toThrow("the System Map could not be built: no stack");
    for (const body of [{}, { graph: null }, { graph: { items: [] } }, { graph: { links: [] } }, { graph: { items: {}, links: [] } }]) {
      vi.stubGlobal("fetch", async () => answer(200, body));
      await expect(data.load(), JSON.stringify(body)).rejects.toThrow(/no graph/);
    }
    vi.stubGlobal("fetch", async () => new Response("not json", { status: 502 }));
    await expect(data.load()).rejects.toThrow("sysmap: 502");
  });

  it("tells subscribers on refresh and when the page says so", () => {
    const data = createDevSysmapData({ base: "http://127.0.0.1:5180/__protoboard/sysmap" });
    let heard = 0;
    const off = data.subscribe!(() => heard++);
    data.refresh!();
    data.changed();
    off();
    data.changed();
    expect(heard).toBe(2);
  });
});

describe("a VS Code page's System Map data", () => {
  it("asks the extension once for loads that overlap, and every one gets its answer", async () => {
    const posted: FromWebview[] = [];
    const data = createVsCodeSysmapData((m) => posted.push(m));
    const a = data.load();
    const b = data.load();
    expect(posted).toEqual([{ type: "sysmap" }]);
    data.receive({ type: "sysmap", graph });
    expect((await a).graph).toBe(graph);
    expect((await b).graph).toBe(graph);
    // a later load asks again
    const c = data.load();
    expect(posted).toEqual([{ type: "sysmap" }, { type: "sysmap" }]);
    data.receive({ type: "sysmap", graph });
    expect((await c).graph).toBe(graph);
  });

  it("rejects with the extension's error, and on an answer with no graph", async () => {
    const data = createVsCodeSysmapData(() => undefined);
    const a = data.load();
    data.receive({ type: "sysmap", error: "this build carries no stack" });
    await expect(a).rejects.toThrow("this build carries no stack");
    const b = data.load();
    data.receive({ type: "sysmap", graph: { items: [] } as unknown as SysmapGraph });
    await expect(b).rejects.toThrow(/no graph/);
  });

  it("asks for a rebuild, tells the subscribers when it is done, and their next load takes it without asking again", async () => {
    const posted: FromWebview[] = [];
    const data = createVsCodeSysmapData((m) => posted.push(m));
    let heard = 0;
    const off = data.subscribe!(() => heard++);
    data.refresh!();
    expect(posted).toEqual([{ type: "sysmap", refresh: true }]);
    expect(heard).toBe(0);
    const rebuilt = { ...graph, stack: "0.3.1" } as SysmapGraph;
    data.receive({ type: "sysmap", graph: rebuilt });
    expect(heard).toBe(1);
    expect((await data.load()).graph).toBe(rebuilt);
    expect(posted).toHaveLength(1);
    // a failed rebuild is said to the next load, not built again
    data.refresh!();
    data.receive({ type: "sysmap", error: "map: exit 1" });
    expect(heard).toBe(2);
    await expect(data.load()).rejects.toThrow("map: exit 1");
    expect(posted).toHaveLength(2);
    off();
  });

  it("settles a pending load with a rebuild's answer, and treats an answer nobody asked for as news", async () => {
    const data = createVsCodeSysmapData(() => undefined);
    let heard = 0;
    data.subscribe!(() => heard++);
    const pending = data.load();
    data.refresh!();
    data.receive({ type: "sysmap", graph });
    expect((await pending).graph).toBe(graph);
    expect(heard).toBe(1);
    // unasked (another page rebuilt the map): the subscribers load again and get it
    const other = { ...graph, stack: "0.3.2" } as SysmapGraph;
    data.receive({ type: "sysmap", graph: other });
    expect(heard).toBe(2);
    expect((await data.load()).graph).toBe(other);
  });

  it("sends Open to the extension, as a message it accepts", () => {
    const posted: FromWebview[] = [];
    const data = createVsCodeSysmapData((m) => posted.push(m));
    data.openFile!("packages/cli/src/index.ts");
    data.refresh!();
    expect(posted).toEqual([
      { type: "sysmapOpen", path: "packages/cli/src/index.ts" },
      { type: "sysmap", refresh: true },
    ]);
    for (const m of posted) expect(parseFromWebview(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
});

describe("the System Map's messages", () => {
  it("takes a request for the map, with or without a rebuild", () => {
    expect(parseFromWebview({ type: "sysmap" })).toEqual({ type: "sysmap" });
    expect(parseFromWebview({ type: "sysmap", refresh: true })).toEqual({ type: "sysmap", refresh: true });
    // anything but true is a plain request
    expect(parseFromWebview({ type: "sysmap", refresh: "yes" })).toEqual({ type: "sysmap" });
  });

  it("takes a stack-relative path to open, without the entry an item's source names", () => {
    expect(parseFromWebview({ type: "sysmapOpen", path: "packages/cli/src/index.ts#case:map" })).toEqual({ type: "sysmapOpen", path: "packages/cli/src/index.ts" });
    expect(parseFromWebview({ type: "sysmapOpen", path: "packages/ext-hardware/protoboard.extension.json#capabilities/cad/operations/generate" })).toEqual({
      type: "sysmapOpen",
      path: "packages/ext-hardware/protoboard.extension.json",
    });
    expect(parseStackPath("docs/specs/system-map.md")).toBe("docs/specs/system-map.md");
  });

  it("refuses any other path", () => {
    for (const path of [
      undefined,
      7,
      "",
      "#case:map",
      "../outside.md",
      "packages/../../outside.md",
      "packages/..",
      "./packages/cli",
      "packages//cli",
      "packages/cli/",
      "/etc/passwd",
      "C:/Windows/win.ini",
      "packages\\cli\\src\\index.ts",
      "packages/cli\u0000/x",
      `packages/${"x".repeat(1100)}`,
      `packages/a.ts#${"x".repeat(2100)}`,
    ]) {
      expect(parseFromWebview({ type: "sysmapOpen", path }), JSON.stringify(path)).toBeUndefined();
    }
  });
});
