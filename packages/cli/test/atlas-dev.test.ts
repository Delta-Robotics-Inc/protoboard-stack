/**
 * The Atlas in `protoboard dev` (docs/specs/atlas.md): the layout request's
 * checks and the merge into display.json (./src/dev/atlas.ts), and the server
 * on a temporary project: each build writes the project index, the read
 * route serves its graph (paths and metadata, never a file's contents) to the
 * page and to VS Code webviews, the layout route keeps positions for the page
 * only and changes nothing but the display file's `atlas` key (no rebuild, no
 * push, not in the bundle), and a stale index is rebuilt on request.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATLAS_LAYOUT_LIMITS, ATLAS_ROUTES, applyAtlasLayout, atlasImageOf, atlasLayoutOf, parseAtlasLayoutRequest } from "../src/dev/atlas.js";
import { formatDisplay, type DisplayFile } from "../src/dev/layout.js";
import { startDev, type DevLogEvent, type DevServer } from "../src/dev/server.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// its own folder: other test files here work in .tmp at the same time
const TMP = join(HERE, ".tmp/atlas-dev");

describe("Atlas layout requests", () => {
  it("takes node ids with two finite numbers each", () => {
    expect(parseAtlasLayoutRequest({ positions: { "def:sys": [10.4, -3], "file:docs/a b.png": [0, 1e6] } })).toEqual({ positions: { "def:sys": [10.4, -3], "file:docs/a b.png": [0, 1e6] } });
    expect(parseAtlasLayoutRequest({ positions: {} })).toEqual({ positions: {} });
  });

  it("refuses malformed bodies", () => {
    const refused = (body: unknown) => expect(parseAtlasLayoutRequest(body), JSON.stringify(body)).toHaveProperty("error");
    refused(null);
    refused([]);
    refused({});
    refused({ positions: [] });
    refused({ positions: { "def:a": [1] } });
    refused({ positions: { "def:a": [1, 2, 3] } });
    refused({ positions: { "def:a": { x: 1, y: 2 } } });
    refused({ positions: { "def:a": ["1", 2] } });
    refused({ positions: { "def:a": [1, null] } });
    refused({ positions: { "def:a": [2e9, 0] } });
    // JSON has no infinity, but a body object can be anything
    refused({ positions: { "def:a": [Number.POSITIVE_INFINITY, 0] } });
    refused({ positions: { "def:a": [Number.NaN, 0] } });
    // not node ids: no kind prefix, an object's own property names, too long
    refused({ positions: { sys: [1, 2] } });
    refused(JSON.parse('{ "positions": { "__proto__": [1, 2] } }'));
    refused({ positions: { constructor: [1, 2] } });
    refused({ positions: { [`file:${"x".repeat(ATLAS_LAYOUT_LIMITS.idLength)}`]: [1, 2] } });
    const many: Record<string, [number, number]> = {};
    for (let i = 0; i <= ATLAS_LAYOUT_LIMITS.ids; i++) many[`file:${i}`] = [i, i];
    refused({ positions: many });
  });

  it("replaces atlas.positions only: integers, sorted, every other key as it was", () => {
    const display: DisplayFile = { schema: "uhd.display/v0", diagram: { layouts: { "": { nodes: { a: { x: 1, y: 2 } } } } }, spatial: { root: "frame" }, atlas: { positions: { "def:old": [1, 1] }, note: "kept" } };
    const r = applyAtlasLayout(display, { "file:z.png": [10.6, -0.4], "def:a": [-3.5, 2.49] });
    expect(r.changed).toBe(true);
    expect(Object.keys(r.display)).toEqual(["schema", "diagram", "spatial", "atlas"]);
    expect(r.display.diagram).toEqual(display.diagram);
    expect(r.display.spatial).toEqual(display.spatial);
    expect(r.display.atlas).toEqual({ positions: { "def:a": [-3, 2], "file:z.png": [11, 0] }, note: "kept" });
    expect(Object.keys((r.display.atlas as { positions: object }).positions)).toEqual(["def:a", "file:z.png"]);
    // the input is not modified, and the same positions again change nothing
    expect((display.atlas as { positions: object }).positions).toEqual({ "def:old": [1, 1] });
    expect(applyAtlasLayout(r.display, { "def:a": [-3, 2], "file:z.png": [11, 0] }).changed).toBe(false);
    // a new file says what it is
    expect(applyAtlasLayout({}, { "def:a": [0, 0] }).display).toEqual({ schema: "uhd.display/v0", atlas: { positions: { "def:a": [0, 0] } } });
  });

  it("reads the positions a display file keeps, leaving out what is not [x, y]", () => {
    expect(atlasLayoutOf({ atlas: { positions: { "def:a": [1.2, 3], "def:b": "x", c: [1, 2], "def:d": [1, 2, 3] } } })).toEqual({ positions: { "def:a": [1, 3] } });
    expect(atlasLayoutOf({ diagram: {} })).toBeUndefined();
    expect(atlasLayoutOf({ atlas: [] })).toBeUndefined();
    expect(atlasLayoutOf("text")).toBeUndefined();
  });

  it("writes one line per position, and the rest of the file as before", () => {
    const display: DisplayFile = { schema: "uhd.display/v0", diagram: { layouts: { "": { nodes: {}, links: { l: { waypoints: [[1, 2]] } } } } } };
    const before = formatDisplay(display);
    const text = formatDisplay(applyAtlasLayout(display, { "def:a": [1, -2], "file:x.png": [30, 40] }).display, before);
    expect(text.startsWith(before.slice(0, before.lastIndexOf("}")).trimEnd())).toBe(true);
    expect(text).toContain('"atlas": {\n    "positions": {\n      "def:a": [1, -2],\n      "file:x.png": [30, 40]\n    }\n  }\n}\n');
    // the diagram's waypoints keep the layout every writer gives them
    expect(text).toMatch(/"waypoints": \[\n\s+\[\n\s+1,\n\s+2\n\s+\]/);
    expect(JSON.parse(text).atlas.positions).toEqual({ "def:a": [1, -2], "file:x.png": [30, 40] });
  });
});

// ---------------------------------------------------------------------------
// The server on a temporary project
// ---------------------------------------------------------------------------

const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";

export const BODY: ModuleDef = {
  id: "body",
  name: "Body",
  interfaces: [],
  artifacts: [{ id: "cad", role: "geometry", format: "glb", filePath: "cad/body.glb" }],
};

export const SYS: ModuleDef = {
  id: "sys",
  name: "Atlas system",
  interfaces: [],
  children: [{ id: "body", moduleDefId: "body" }],
};
`;

/** A display file as a person would commit it, with keys the Atlas must not touch. */
const DISPLAY = {
  schema: "uhd.display/v0",
  diagram: { layouts: { "": { nodes: { body: { x: 40, y: 80 } } } }, expanded: [] },
  spatial: { root: "body", placements: {} },
};

/** Text no answer may carry: it is only inside the project's files. */
const CONTENT = "ATLAS-CONTENT-MARKER-7f3a";

function tempProject(name: string) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write("package.json", JSON.stringify({ name, private: true, type: "module" }));
  write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "${name}", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
  write("src/sys.uhd.ts", SYS);
  write("cad/body.glb", `glb bytes ${CONTENT}`);
  write("docs/notes.md", `# Notes\n\n${CONTENT}\n`);
  write("docs/render.png", `png ${CONTENT}`);
  write(".env", `SECRET=${CONTENT}\n`);
  write("viewer-lib/web-viewer.js", "export function mountWebViewer() {}\n");
  write("viewer-lib/web-viewer.css", "body {}\n");
  write(".protoboard/display.json", formatDisplay(DISPLAY));
  return dir;
}

function call(port: number, method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: IncomingMessage["headers"] }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { ...(body !== undefined ? { "content-length": Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
    });
    req.on("error", fail);
    req.end(body);
  });
}

/** Server-sent events from the dev server, collected as they arrive. */
function listen(port: number) {
  const events: { event: string; data: Record<string, unknown> }[] = [];
  let res: IncomingMessage | undefined;
  const req = request({ host: "127.0.0.1", port, path: "/__protoboard/events" }, (r) => {
    res = r;
    let buf = "";
    r.on("data", (d) => {
      buf += d;
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
    });
  });
  req.end();
  return { events, close: () => (res?.destroy(), req.destroy()) };
}

async function until<T>(what: () => T | Promise<T>, timeout = 30000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await what();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the Atlas in protoboard dev, on a temporary project", () => {
  let dir: string;
  let dev: DevServer;
  let token: string;
  const logs: (DevLogEvent & { at: number })[] = [];
  let sse: ReturnType<typeof listen>;
  const bundles = () => sse.events.filter((e) => e.event === "bundle");
  const atlas = async (headers: Record<string, string> = {}) => {
    const r = await call(dev.port, "GET", ATLAS_ROUTES.data, undefined, headers);
    return { ...r, json: JSON.parse(r.body) };
  };
  const save = (positions: unknown, headers: Record<string, string>) => call(dev.port, "POST", ATLAS_ROUTES.layout, JSON.stringify({ positions }), { "content-type": "application/json", ...headers });

  beforeAll(async () => {
    dir = tempProject("atlas-project");
    dev = await startDev({ root: dir, port: 0, viewerLib: join(dir, "viewer-lib"), debounceMs: 50, log: (e) => logs.push({ ...e, at: Date.now() }), record: false });
    const page = (await call(dev.port, "GET", "/")).body;
    token = JSON.parse(/<script type="application\/json" id="protoboard-dev">(.*?)<\/script>/.exec(page)![1]).token;
    sse = listen(dev.port);
    await until(() => sse.events.some((e) => e.event === "hello"));
  }, 60000);
  afterAll(async () => {
    sse?.close();
    await dev?.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("writes the project index with the first build, and the page loads it", async () => {
    expect(existsSync(join(dir, ".protoboard/build/atlas.json"))).toBe(true);
    const script = (await call(dev.port, "GET", "/__protoboard/dev.js")).body;
    expect(script).toContain(`import { createDevAtlasData } from "./viewer/web-viewer.js"`);
    expect(script).toContain(`createDevAtlasData({ base: here("__protoboard/atlas")`);
    expect(script).toContain("atlasData.changed()");
  });

  it("serves the graph: paths and metadata, never a file's contents or a sensitive name", async () => {
    const r = await atlas();
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const ids = (r.json.graph.nodes as { id: string }[]).map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["def:sys", "def:body", "file:cad/body.glb", "file:docs/notes.md", "file:docs/render.png"]));
    expect(r.json.graph.edges.length).toBeGreaterThan(0);
    expect(r.json.graph.project.name).toBe("atlas-project");
    // the view's projection only: no freshness inputs, census or problems
    expect(Object.keys(r.json.graph).sort()).toEqual(["counts", "edges", "nodes", "project"]);
    expect(r.body).not.toContain(CONTENT);
    expect(r.body).not.toContain(".env");
    expect(r.json.stale).toBeUndefined();
    expect(r.json.layout).toBeUndefined();
  });

  it("lets a VS Code viewer tab read it from its own origin, and no other page", async () => {
    const webview = "vscode-webview://1a2b3c";
    const r = await atlas({ origin: webview });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(webview);
    expect((await atlas({ origin: "https://evil.example" })).headers["access-control-allow-origin"]).toBeUndefined();
    // the layout route is the page's: never shared, never read
    expect((await call(dev.port, "GET", ATLAS_ROUTES.layout)).status).toBe(405);
  });

  it("serves an image the index lists for the inspector's preview, and nothing else", async () => {
    const image = (path: string, headers: Record<string, string> = {}) => call(dev.port, "GET", `${ATLAS_ROUTES.image}?path=${encodeURIComponent(path)}`, undefined, headers);
    const r = await image("docs/render.png", { origin: "vscode-webview://1a2b3c" });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toContain("sandbox");
    expect(r.headers["access-control-allow-origin"]).toBe("vscode-webview://1a2b3c");
    // not an image, not in the index, a sensitive name, out of the project, not a relative path: refused
    expect((await image("docs/notes.md")).status).toBe(415);
    expect((await image("docs/missing.png")).status).toBe(404);
    expect((await image(".env")).status).toBe(404);
    expect((await image("../outside.png")).status).toBe(400);
    expect((await image("/etc/passwd")).status).toBe(400);
    expect((await image("docs\\render.png")).status).toBe(400);
    expect(atlasImageOf([{ path: "a.png", ext: "png", status: "failed" }], "a.png")).toEqual({ error: "the index could not read this file", status: 404 });
  });

  it("keeps positions for the page only, in the display file's atlas key, without a rebuild or a push", async () => {
    const file = join(dir, ".protoboard/display.json");
    const before = readFileSync(file, "utf8");
    const version = dev.version;
    const pushed = bundles().length;
    const positions = { "def:sys": [12.4, -40.6], "file:docs/notes.md": [300, 120] };
    // without the token, with another origin, without JSON: refused, and the file is as it was
    expect((await save(positions, {})).status).toBe(403);
    expect((await save(positions, { "x-protoboard-dev": "wrong" })).status).toBe(403);
    expect((await save(positions, { "x-protoboard-dev": token, origin: "vscode-webview://1a2b3c" })).status).toBe(403);
    expect((await save(positions, { "x-protoboard-dev": token, origin: "https://evil.example" })).status).toBe(403);
    expect((await call(dev.port, "POST", ATLAS_ROUTES.layout, JSON.stringify({ positions }), { "content-type": "text/plain", "x-protoboard-dev": token })).status).toBe(415);
    expect((await call(dev.port, "POST", ATLAS_ROUTES.layout, "{ not json", { "content-type": "application/json", "x-protoboard-dev": token })).status).toBe(400);
    expect((await save({ "def:sys": [1, Number.NaN] }, { "x-protoboard-dev": token })).status).toBe(400);
    expect(readFileSync(file, "utf8")).toBe(before);

    const ok = await save(positions, { "x-protoboard-dev": token });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ file: ".protoboard/display.json", changed: true, nodes: 2 });
    const after = readFileSync(file, "utf8");
    // only the atlas key was added: the text before it is byte for byte the same
    expect(after.startsWith(before.slice(0, before.lastIndexOf("\n}")))).toBe(true);
    const saved = JSON.parse(after);
    expect(saved.atlas).toEqual({ positions: { "def:sys": [12, -41], "file:docs/notes.md": [300, 120] } });
    const { atlas: _atlas, ...rest } = saved;
    expect(rest).toEqual(DISPLAY);

    // nothing rebuilt or pushed, and the bundle never carries the key
    await pause(600);
    await dev.idle();
    expect(dev.version).toBe(version);
    expect(bundles().length).toBe(pushed);
    const bundle = JSON.parse((await call(dev.port, "GET", "/uhd-bundle.json")).body);
    expect(bundle.display.atlas).toBeUndefined();
    expect(bundle.display.spatial).toEqual(DISPLAY.spatial);

    // the read route gives the positions back; the same positions again write nothing
    expect((await atlas()).json.layout).toEqual({ positions: { "def:sys": [12, -41], "file:docs/notes.md": [300, 120] } });
    const again = await save(positions, { "x-protoboard-dev": token });
    expect(JSON.parse(again.body).changed).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(after);
  });

  it("does not push a display file whose only change on disk is the Atlas layout", async () => {
    const file = join(dir, ".protoboard/display.json");
    const version = dev.version;
    const pushed = bundles().length;
    const display = JSON.parse(readFileSync(file, "utf8"));
    display.atlas.positions["def:body"] = [5, 5];
    writeFileSync(file, formatDisplay(display));
    await pause(600);
    await dev.idle();
    expect(dev.version).toBe(version);
    expect(bundles().length).toBe(pushed);
    // a change to another key still reaches the viewer
    display.diagram.expanded = ["body"];
    writeFileSync(file, formatDisplay(display));
    await until(() => bundles().length > pushed);
    expect(bundles().at(-1)!.data.reason).toBe("display");
    const bundle = JSON.parse((await call(dev.port, "GET", "/uhd-bundle.json")).body);
    expect(bundle.display.diagram.expanded).toEqual(["body"]);
    expect(bundle.display.atlas).toBeUndefined();
  }, 30000);
});

describe("a stale index in protoboard dev (no watcher: only the Atlas asks for a rebuild)", () => {
  let dir: string;
  let dev: DevServer;
  const logs: (DevLogEvent & { at: number })[] = [];
  let sse: ReturnType<typeof listen>;
  const bundles = () => sse.events.filter((e) => e.event === "bundle");
  const rebuilds = () => logs.filter((l) => l.event === "atlas" && /rebuilding/.test(l.message));
  const atlas = async () => {
    const r = await call(dev.port, "GET", ATLAS_ROUTES.data);
    return { ...r, json: JSON.parse(r.body) };
  };

  beforeAll(async () => {
    dir = tempProject("atlas-stale");
    dev = await startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "viewer-lib"), log: (e) => logs.push({ ...e, at: Date.now() }), record: false });
    sse = listen(dev.port);
    await until(() => sse.events.some((e) => e.event === "hello"));
  }, 60000);
  afterAll(async () => {
    sse?.close();
    await dev?.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("rebuilds a stale index on request, then serves it fresh", async () => {
    const pushed = bundles().length;
    writeFileSync(join(dir, "docs/notes.md"), `# Notes, longer now\n\n${CONTENT}\n`);
    writeFileSync(join(dir, "docs/new.md"), "# New\n");
    const stale = await atlas();
    expect(stale.status).toBe(200);
    expect(stale.json.stale).toEqual({ changed: 2, reason: "files", rebuilding: true });
    expect(stale.body).not.toContain(CONTENT);
    // the rebuild is pushed like any other, and the index then holds the new file
    await until(() => bundles().slice(pushed).find((e) => e.data.reason === "source"));
    expect(rebuilds()).toHaveLength(1);
    await dev.idle();
    const fresh = await atlas();
    expect(fresh.json.stale).toBeUndefined();
    expect((fresh.json.graph.nodes as { id: string }[]).map((n) => n.id)).toContain("file:docs/new.md");
    expect(bundles().length).toBe(pushed + 1);
  }, 60000);

  it("rebuilds at most once every 10 seconds: a request inside the interval waits for its end", async () => {
    await dev.idle();
    const pushed = bundles().length;
    const last = rebuilds().at(-1)!.at;
    writeFileSync(join(dir, "docs/later.md"), "# Later\n");
    // a rebuild is coming: the last one was moments ago, so it waits for the interval's end
    expect((await atlas()).json.stale).toEqual({ changed: 1, reason: "files", rebuilding: true });
    await pause(1000);
    expect(bundles().length).toBe(pushed);
    // a second request inside the interval does not add another
    expect((await atlas()).json.stale.rebuilding).toBe(true);
    await until(() => bundles().length > pushed, 20000);
    expect(rebuilds()).toHaveLength(2);
    expect(rebuilds()[1].at - last).toBeGreaterThanOrEqual(10_000 - 50);
    await dev.idle();
    expect((await atlas()).json.stale).toBeUndefined();
    expect(bundles().length).toBe(pushed + 1);
  }, 40000);

  it("serves a missing index as not there yet, and builds it", async () => {
    await dev.idle();
    await pause(Math.max(0, rebuilds().at(-1)!.at + 10_000 - Date.now()));
    rmSync(join(dir, ".protoboard/build/atlas.json"));
    const r = await atlas();
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: "INDEX_MISSING", rebuilding: true });
    await until(async () => (await atlas()).status === 200, 30000);
  }, 40000);

  it("says why an index from another stack version is stale (it compares no files), and rebuilds it", async () => {
    await dev.idle();
    await pause(Math.max(0, rebuilds().at(-1)!.at + 10_000 - Date.now()));
    const file = join(dir, ".protoboard/build/atlas.json");
    const index = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...index, stack: "0.0.0-another" }));
    const r = await atlas();
    expect(r.status).toBe(200);
    expect(r.json.stale).toEqual({ changed: 0, reason: "stack", rebuilding: true });
    await until(async () => (await atlas()).json.stale === undefined, 30000);
  }, 40000);

  it("says an index built before creation times were recorded is stale (\"history\"), and rebuilds it with them", async () => {
    await dev.idle();
    await pause(Math.max(0, rebuilds().at(-1)!.at + 10_000 - Date.now()));
    const file = join(dir, ".protoboard/build/atlas.json");
    const index = JSON.parse(readFileSync(file, "utf8"));
    expect(index.counts.created).toBeDefined();
    delete index.counts.created;
    for (const n of index.nodes) delete n.created;
    writeFileSync(file, JSON.stringify(index));
    const r = await atlas();
    expect(r.status).toBe(200);
    expect(r.json.stale).toEqual({ changed: 0, reason: "history", rebuilding: true });
    await until(async () => (await atlas()).json.stale === undefined, 30000);
    const graph = (await atlas()).json.graph;
    expect(graph.counts.created).toBeDefined();
    expect((graph.nodes as { id: string; created?: unknown }[]).find((n) => n.id === "file:docs/notes.md")!.created).toEqual({ at: expect.any(Number), from: expect.any(String) });
  }, 40000);
});
