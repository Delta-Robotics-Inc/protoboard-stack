/**
 * `protoboard dev` (PB-815): the layout adapter (viewer edits → display.json)
 * and the server on a temporary project: a source change is rebuilt and
 * served, a layout POST updates display.json, a display.json edited on disk
 * reaches the bundle, a broken source keeps the last good bundle, and
 * requests outside what the bundle references are refused.
 *
 * The server uses the installed viewer's request handler; the viewer's
 * library build is replaced by two stub files, so these tests do not need
 * `npm run build` in uhd-viewer. The page itself is checked in headless
 * Chrome by hand (README, "Local viewer").
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyViewerLayout, formatDisplay, parseLayoutRequest, type DisplayFile } from "../src/dev/layout.js";
import { DEV_RECORD, folderGoneMessage, startDev, unwatchedMessage, watchPlan, type DevLogEvent, type DevRecord, type DevServer } from "../src/dev/server.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp");

describe("viewer layout → display.json", () => {
  const display: DisplayFile = {
    schema: "uhd.display/v0",
    diagram: {
      layouts: {
        "": {
          nodes: { arm: { x: 48, y: 48, w: 270, h: 132 }, "arm/motor": { x: 34, y: 36 }, "arm/prop": { x: 158, y: 36 }, gnss: { x: 784, y: 48 } },
          ports: { "gnss|uart": "left" },
          links: { gnss_uart: { labelT: 0.3 } },
        },
      },
      expanded: ["arm"],
    },
    spatial: { root: "frame" },
  };

  it("moves a top-level node and keeps everything else", () => {
    const r = applyViewerLayout(display, { positions: { "": { gnss: { x: 800, y: 64 } } }, links: {} });
    expect(r.levels).toEqual([""]);
    expect(r.display.diagram!.layouts![""].nodes.gnss).toEqual({ x: 800, y: 64 });
    expect(r.display.diagram!.layouts![""].nodes.arm).toEqual({ x: 48, y: 48, w: 270, h: 132 });
    expect(r.display.diagram!.layouts![""].ports).toEqual({ "gnss|uart": "left" });
    expect(r.display.spatial).toEqual({ root: "frame" });
    expect(r.display.diagram!.expanded).toEqual(["arm"]);
    // the input is not modified
    expect(display.diagram!.layouts![""].nodes.gnss).toEqual({ x: 784, y: 48 });
  });

  it("stores a dragged child relative to its container, wherever the container is", () => {
    // the viewer reports absolute positions: motor dragged to (112, 96) inside arm at (48, 48)
    const child = applyViewerLayout(display, { positions: { "": { "arm/motor": { x: 112, y: 96 } } }, links: {} });
    expect(child.display.diagram!.layouts![""].nodes["arm/motor"]).toEqual({ x: 64, y: 48 });
    // container and child both dragged: the child is relative to the container's new place
    const both = applyViewerLayout(display, { positions: { "": { arm: { x: 96, y: 64 }, "arm/motor": { x: 112, y: 96 } } }, links: {} });
    expect(both.display.diagram!.layouts![""].nodes.arm).toEqual({ x: 96, y: 64, w: 270, h: 132 });
    expect(both.display.diagram!.layouts![""].nodes["arm/motor"]).toEqual({ x: 16, y: 32 });
    // only the container dragged: its children keep their offsets and move with it
    const parent = applyViewerLayout(display, { positions: { "": { arm: { x: 96, y: 64 } } }, links: {} });
    expect(parent.display.diagram!.layouts![""].nodes["arm/prop"]).toEqual({ x: 158, y: 36 });
  });

  it("merges link waypoints, label and harness-tab placement", () => {
    const r = applyViewerLayout(display, {
      positions: {},
      links: { "": { gnss_uart: { waypoints: [[400, 96], [400, 300]], labelFlip: true }, m1_phases: { tabT: 0.7, tabFlip: true } } },
    });
    expect(r.display.diagram!.layouts![""].links).toEqual({
      gnss_uart: { labelT: 0.3, waypoints: [[400, 96], [400, 300]], labelFlip: true },
      m1_phases: { tabT: 0.7, tabFlip: true },
    });
  });

  it("reports nothing when the edits are already saved", () => {
    const once = applyViewerLayout(display, { positions: { "": { "arm/motor": { x: 112, y: 96 } } }, links: {} });
    const again = applyViewerLayout(once.display, { positions: { "": { "arm/motor": { x: 112, y: 96 } } }, links: {} });
    expect(again.levels).toEqual([]);
  });

  it("saves a level laid out automatically only from the page's snapshot of that level", () => {
    const edits = { positions: { stack: { fc: { x: 320, y: 160 } } }, links: {} };
    const blind = applyViewerLayout(display, edits);
    expect(blind.levels).toEqual([]);
    expect(blind.skipped[0]).toMatchObject({ level: "stack" });
    expect(blind.display.diagram!.layouts!.stack).toBeUndefined();

    // a snapshot of another level does not count
    const elsewhere = applyViewerLayout(display, edits, { nodes: { gnss: { x: 0, y: 0 } }, edges: [] });
    expect(elsewhere.skipped).toHaveLength(1);

    // every node on screen is named, children relative to their container, so nothing falls back to (0, 0)
    const seen = applyViewerLayout(display, edits, {
      nodes: { fc: { x: 320, y: 160 }, esc: { x: 320, y: 480 }, vtx: { x: 640, y: 160 }, "vtx/antenna": { x: 672, y: 208 } },
      edges: ["fc_esc", "fc_vtx"],
    });
    expect(seen.levels).toEqual(["stack"]);
    expect(seen.display.diagram!.layouts!.stack).toEqual({
      nodes: { esc: { x: 320, y: 480 }, fc: { x: 320, y: 160 }, vtx: { x: 640, y: 160 }, "vtx/antenna": { x: 32, y: 48 } },
    });
  });

  it("creates the display file's structure when there is none", () => {
    const r = applyViewerLayout({}, { positions: { "": { a: { x: 16, y: 32 } } }, links: {} }, { nodes: { a: { x: 16, y: 32 }, b: { x: 200, y: 32 } }, edges: [] });
    expect(r.display).toEqual({ schema: "uhd.display/v0", diagram: { layouts: { "": { nodes: { a: { x: 16, y: 32 }, b: { x: 200, y: 32 } } } } } });
  });

  it("keeps the file's escaping of non-ASCII characters", () => {
    const display: DisplayFile = { schema: "uhd.display/v0", notes: "5\u2033 frame \u00b7 4 arms\u2026" } as unknown as DisplayFile;
    const escaped = JSON.stringify(display, null, 2).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) + "\n";
    expect(formatDisplay(display, escaped)).toBe(escaped);
    expect(formatDisplay(display, JSON.stringify(display, null, 2) + "\n")).toBe(JSON.stringify(display, null, 2) + "\n");
    expect(formatDisplay(display)).toMatch(/4 arms…/);
    // a file whose only escapes are Latin-1 (\u00b7, as the bottle's labels have) stays escaped (PB-873)
    const latin = { schema: "uhd.display/v0", notes: "PETG \u00b7 63 mm" } as unknown as DisplayFile;
    const latinText = JSON.stringify(latin, null, 2).replace("\u00b7", "\\u00b7") + "\n";
    expect(latinText).toContain("\\u00b7");
    expect(formatDisplay(latin, latinText)).toBe(latinText);
    // the quadcopter's file round-trips except a float Python wrote as 0.0
    const quad = readFileSync(join(HERE, "../../../examples/quadcopter-5in/.protoboard/display.json"), "utf8");
    const changed = formatDisplay(JSON.parse(quad), quad).split("\n").filter((l, i) => l !== quad.split("\n")[i]);
    expect(changed).toEqual(['        "metalness": 0']);
  });

  it("refuses malformed requests", () => {
    expect(parseLayoutRequest(null)).toHaveProperty("error");
    expect(parseLayoutRequest({ layout: { positions: { "": { a: { x: "1", y: 2 } } } } })).toHaveProperty("error");
    expect(parseLayoutRequest({ layout: { positions: {}, links: { "": { l: { color: "red" } } } } })).toMatchObject({ error: expect.stringMatching(/unknown keys color/) });
    expect(parseLayoutRequest({ layout: { positions: {}, links: { "": { l: { waypoints: [[1, 2, 3]] } } } } })).toHaveProperty("error");
    expect(parseLayoutRequest({ layout: { positions: {}, links: {} }, snapshot: { nodes: {}, edges: [1] } })).toHaveProperty("error");
    expect(parseLayoutRequest({ layout: { positions: { "": { a: { x: 1, y: 2 } } }, links: {} }, client: "c1" })).toEqual({ layout: { positions: { "": { a: { x: 1, y: 2 } } }, links: {} }, client: "c1" });
  });
});

describe("what dev watches", () => {
  it("watches source trees, never the whole project recursively", () => {
    const dir = join(TMP, "plan");
    rmSync(dir, { recursive: true, force: true });
    for (const d of ["src", "parts/catalog", ".protoboard", "node_modules/x", "docs"]) mkdirSync(join(dir, d), { recursive: true });
    const plan = watchPlan(dir, { display: ".protoboard/display.json", sources: ["src/**/*.uhd.ts"], catalog: "parts/catalog" });
    expect(plan).toEqual([
      [dir, false],
      [join(dir, "src"), true],
      [join(dir, "parts"), true],
      [join(dir, ".protoboard"), false],
    ]);
    const everywhere = watchPlan(dir, { display: "display.json", sources: ["**/*.uhd.ts"], catalog: "parts/catalog" });
    expect(everywhere.filter(([, r]) => r).map(([d]) => d.slice(dir.length + 1)).sort()).toEqual(["docs", "parts", "src"]);
  });
});

// ---------------------------------------------------------------------------
// The server on a temporary project
// ---------------------------------------------------------------------------

const SYS = (name: string) => `import type { ModuleDef } from "@deltarobotics/uhd";

export const BODY: ModuleDef = {
  id: "body",
  name: "Body",
  interfaces: [],
  artifacts: [{ id: "cad", role: "geometry", format: "glb", filePath: "cad/body.glb" }],
};

export const SYS: ModuleDef = {
  id: "sys",
  name: "${name}",
  interfaces: [],
  children: [{ id: "body", moduleDefId: "body" }],
};
`;

function tempProject(name: string) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write("package.json", JSON.stringify({ name, private: true, type: "module" }));
  write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "${name}", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
  write("src/sys.uhd.ts", SYS("System one"));
  write("cad/body.glb", "glb bytes");
  write(".env", "SECRET=1\n");
  write("notes.txt", "not an artifact\n");
  write("viewer-lib/web-viewer.js", "export function mountWebViewer() {}\n");
  write("viewer-lib/web-viewer.css", "body {}\n");
  return dir;
}

/** A raw GET, so the path reaches the server exactly as written (no client-side normalisation). */
function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

/** A GET's status and response headers. */
function headersOf(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      res.resume();
      ok({ status: res.statusCode ?? 0, headers: res.headers });
      if (path.includes("events")) req.destroy();
    });
    req.on("error", (e) => ((e as NodeJS.ErrnoException).code === "ECONNRESET" ? undefined : fail(e)));
    req.end();
  });
}

function post(port: number, path: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-length": Buffer.byteLength(body), ...headers } }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: data }));
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

describe("protoboard dev on a temporary project", () => {
  let dir: string;
  let dev: DevServer;
  let token: string;
  const logs: DevLogEvent[] = [];
  let sse: ReturnType<typeof listen>;
  const bundle = async () => JSON.parse((await get(dev.port, "/uhd-bundle.json")).body);

  beforeAll(async () => {
    dir = tempProject("dev-project");
    dev = await startDev({ root: dir, port: 0, viewerLib: join(dir, "viewer-lib"), debounceMs: 50, log: (e) => logs.push(e) });
    const page = (await get(dev.port, "/")).body;
    token = JSON.parse(/<script type="application\/json" id="protoboard-dev">(.*?)<\/script>/.exec(page)![1]).token;
    sse = listen(dev.port);
    await until(() => sse.events.some((e) => e.event === "hello"));
  }, 60000);
  afterAll(async () => {
    sse?.close();
    await dev?.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("serves the page, the web viewer and the bundle with the project's diagnostics", async () => {
    expect(logs.find((l) => l.event === "listening")).toMatchObject({ url: dev.url, port: dev.port, bundle: ".protoboard/build/uhd-bundle.json" });
    expect((await get(dev.port, "/")).body).toContain(`<title>dev-project · Protoboard dev</title>`);
    expect((await get(dev.port, "/__protoboard/viewer/web-viewer.js")).body).toContain("mountWebViewer");
    // relative URLs, so the page also works behind a proxy that serves it under a path (PB-861)
    const page = (await get(dev.port, "/")).body;
    expect(page).toContain(`src="./__protoboard/dev.js"`);
    expect(page).toContain(`href="./__protoboard/viewer/web-viewer.css"`);
    const script = (await get(dev.port, "/__protoboard/dev.js")).body;
    expect(script).toContain(`import { createDevPartsData, mountWebViewer } from "./viewer/web-viewer.js"`);
    // the library and bom tabs ask this server, relative to the page too
    expect(script).toContain(`createDevPartsData({ base: here("__protoboard/parts/")`);
    // the page names no brand colour: the badge takes the viewer's theme tokens
    expect(page).not.toMatch(/#f26b1d|#ff5c00|oklch\(0\.6837/i);
    expect(script).toContain(`from "./relay.js"`);
    expect(script).not.toMatch(/fetch\("\/|EventSource\("\//);
    const b = await bundle();
    expect(b).toMatchObject({ schema: "uhd.bundle/v0", root: "sys", meta: { name: "dev-project" } });
    expect(b.definitions.map((d: { id: string }) => d.id)).toEqual(["body", "sys"]);
    // aggregate diagnostics travel in the bundle; the artifact base is a URL on this server, not a path
    expect(Array.isArray(b.diagnostics)).toBe(true);
    expect(b.artifactBases.body).toBe(`http://127.0.0.1:${dev.port}/artifacts/dev-project`);
    expect((await get(dev.port, "/artifacts/dev-project/cad/body.glb")).body).toBe("glb bytes");
  });

  it("answers the library and bom tabs: the project's parts, its BOM, and adds parts only for the page (PB-912)", async () => {
    const parts = await get(dev.port, "/__protoboard/parts/project");
    expect(parts.status).toBe(200);
    expect(JSON.parse(parts.body)).toMatchObject({ counts: { total: expect.any(Number) } });
    const bom = await get(dev.port, "/__protoboard/parts/bom");
    expect(bom.status).toBe(200);
    expect(JSON.parse(bom.body)).toMatchObject({ schema: "protoboard.bom/v0", project: "dev-project", source: { kind: "design" }, currency: "USD", units: 1, groups: expect.any(Array) });
    expect((await get(dev.port, "/__protoboard/parts/blob?library=x&sha=nope&type=image/png")).status).toBe(400);
    expect((await get(dev.port, "/__protoboard/parts/nothing")).status).toBe(404);
    const add = JSON.stringify({ key: "protoboard/some-part", kind: "add", revision: 1 });
    expect((await post(dev.port, "/__protoboard/parts/vendor", add, { "content-type": "application/json" })).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/parts/vendor", add, { "content-type": "application/json", "x-protoboard-dev": token, origin: "http://evil.example" })).status).toBe(403);
    // the BOM tab keeps the units to build in the project (parts/bom.json), for the page's session only (PB-933)
    const units = JSON.stringify({ units: 12 });
    expect((await post(dev.port, "/__protoboard/parts/bom", units, { "content-type": "application/json" })).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/parts/bom", units, { "content-type": "application/json", "x-protoboard-dev": token, origin: "http://evil.example" })).status).toBe(403);
    const kept = await post(dev.port, "/__protoboard/parts/bom", units, { "content-type": "application/json", "x-protoboard-dev": token });
    expect(kept.status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "parts/bom.json"), "utf8"))).toEqual({ schema: "protoboard.bom-settings/v0", units: 12 });
    expect(JSON.parse((await get(dev.port, "/__protoboard/parts/bom")).body).units).toBe(12);
    // asking the library for its offers writes parts/offers.json: the page's session only, and never by GET (PB-933)
    expect((await post(dev.port, "/__protoboard/parts/offers", "{}", { "content-type": "application/json" })).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/parts/offers", "{}", { "content-type": "application/json", "x-protoboard-dev": token, origin: "http://evil.example" })).status).toBe(403);
    expect((await get(dev.port, "/__protoboard/parts/offers")).status).toBe(405);
    const bad = await post(dev.port, "/__protoboard/parts/bom", JSON.stringify({ line: "--cwd", offer: "x" }), { "content-type": "application/json", "x-protoboard-dev": token });
    expect(bad.status).toBe(502);
    expect(JSON.parse(bad.body).error).toMatch(/give units, or a line and an offer/);
  });

  it("names an inline icon and answers /favicon.ico, so the browser's console has no 404 (PB-873)", async () => {
    expect((await get(dev.port, "/")).body).toMatch(/<link rel="icon" href="data:image\/svg\+xml,/);
    const icon = await get(dev.port, "/favicon.ico");
    expect(icon.status).toBe(200);
    expect(icon.body).toContain("<svg");
  });

  it("records the session in .protoboard/local/dev.json for editors to attach to", async () => {
    const record = JSON.parse(readFileSync(join(dir, DEV_RECORD), "utf8")) as DevRecord;
    expect(record).toMatchObject({ schema: "protoboard.dev/v0", url: dev.url, port: dev.port, pid: process.pid, root: dir });
    // the state route names the same session: the record is live, not left by a stopped server
    expect(JSON.parse((await get(dev.port, "/__protoboard/state")).body).session).toBe(record.session);
  });

  it("lets a VS Code viewer tab read the session from its own origin, and no other page (PB-895)", async () => {
    const webview = "vscode-webview://1a2b3c";
    for (const path of ["/uhd-bundle.json", "/__protoboard/state", "/artifacts/dev-project/cad/body.glb", "/__protoboard/events"]) {
      const r = await headersOf(dev.port, path, { origin: webview });
      expect(r.status, path).toBe(200);
      expect(r.headers["access-control-allow-origin"], path).toBe(webview);
      expect(r.headers.vary).toBe("Origin");
    }
    // nothing else: the page carries the write token, the source lookup names files
    for (const path of ["/", "/__protoboard/source?def=x", "/__protoboard/dev.js", "/__protoboard/relay.js"]) {
      expect((await headersOf(dev.port, path, { origin: webview })).headers["access-control-allow-origin"], path).toBeUndefined();
    }
    expect((await headersOf(dev.port, "/uhd-bundle.json", { origin: "https://evil.example" })).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await headersOf(dev.port, "/uhd-bundle.json")).headers["access-control-allow-origin"]).toBeUndefined();
    // writes stay with the page itself: a webview origin cannot post a layout
    const denied = await post(dev.port, "/__protoboard/layout", JSON.stringify({ layout: { positions: {}, links: {} } }), { "content-type": "application/json", origin: webview, "x-protoboard-dev": token });
    expect(denied.status).toBe(403);
    // the state names the display file the tab saves its layout to (PB-896)
    expect(JSON.parse((await get(dev.port, "/__protoboard/state")).body).display).toBe(".protoboard/display.json");
  });

  it("sends an artifact sandboxed and unsniffed, so a part's file cannot run in the dev server's origin (PB-1048)", async () => {
    const r = await headersOf(dev.port, "/artifacts/dev-project/cad/body.glb");
    expect(r.status).toBe(200);
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    // the dev page itself is not sandboxed
    expect((await headersOf(dev.port, "/")).headers["content-security-policy"]).toBeUndefined();
  });

  it("refuses what the bundle does not reference, path traversal, and other hosts", async () => {
    for (const path of [
      "/artifacts/dev-project/.env",
      "/artifacts/dev-project/notes.txt",
      "/artifacts/dev-project/../dev-project/.env",
      "/artifacts/dev-project/cad/../../.env",
      "/artifacts/dev-project/%2e%2e/%2e%2e/package.json",
      "/artifacts/dev-project/cad%2f..%2f.env",
      "/artifacts/../../../../etc/passwd",
      "/__protoboard/viewer/../../protoboard.config.ts",
      "/__protoboard/viewer/%2e%2e/protoboard.config.ts",
      "/protoboard.config.ts",
      "/src/sys.uhd.ts",
      "/.protoboard/display.json",
    ]) {
      const r = await get(dev.port, path);
      expect([403, 404], `${path} → ${r.status}`).toContain(r.status);
      expect(r.body).not.toMatch(/SECRET|defineConfig|ModuleDef/);
    }
    expect((await get(dev.port, "/", { host: "evil.example:80" })).status).toBe(403);
    expect((await get(dev.port, "/uhd-bundle.json", { host: "evil.example" })).status).toBe(403);
  });

  it("rebuilds on a source change and pushes the new bundle", async () => {
    const before = dev.version;
    writeFileSync(join(dir, "src/sys.uhd.ts"), SYS("System two"));
    await until(() => dev.version > before);
    await dev.idle();
    const b = await bundle();
    expect(b.definitions.find((d: { id: string }) => d.id === "sys").name).toBe("System two");
    const pushed = await until(() => sse.events.find((e) => e.event === "bundle" && e.data.reason === "source" && (e.data.version as number) > before));
    expect(pushed!.data).toMatchObject({ failed: false, diagnostics: [] });
    expect(logs.some((l) => l.event === "build" && (l.trigger as string[]).includes("src/sys.uhd.ts"))).toBe(true);
  }, 60000);

  it("keeps the last good bundle when a source breaks, with the failure as a diagnostic", async () => {
    const before = dev.version;
    writeFileSync(join(dir, "protoboard.config.ts"), "export default {{ broken");
    await until(() => dev.version > before);
    await dev.idle();
    const state = JSON.parse((await get(dev.port, "/__protoboard/state")).body);
    expect(state.failed).toBe(true);
    expect(state.diagnostics[0]).toMatchObject({ code: "PB_DEV_BUILD_FAILED", severity: "error", validator: "protoboard/dev" });
    expect((await bundle()).root).toBe("sys");

    const broken = dev.version;
    writeFileSync(join(dir, "protoboard.config.ts"), `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "dev-project", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
    await until(() => dev.version > broken);
    await dev.idle();
    expect(JSON.parse((await get(dev.port, "/__protoboard/state")).body)).toMatchObject({ failed: false, diagnostics: [], views: [] });
  }, 60000);

  it("writes a layout POST to display.json and pushes it", async () => {
    const layout = { positions: { "": { body: { x: 320, y: 96 } } }, links: { "": { body_link: { labelT: 0.25, labelFlip: true } } } };
    const snapshot = { nodes: { body: { x: 320, y: 96 }, other: { x: 32, y: 32 } }, edges: ["body_link"] };
    const body = JSON.stringify({ client: "tab-1", layout, snapshot });
    const json = { "content-type": "application/json" };

    expect((await post(dev.port, "/__protoboard/layout", body, json)).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/layout", body, { ...json, "x-protoboard-dev": "guess" })).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/layout", body, { "content-type": "text/plain", "x-protoboard-dev": token })).status).toBe(415);
    expect((await post(dev.port, "/__protoboard/layout", body, { ...json, "x-protoboard-dev": token, origin: "http://evil.example" })).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/layout", body, { ...json, "x-protoboard-dev": token, origin: "https://evil.example", "x-forwarded-host": "proxy.example" })).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/layout", body, { ...json, "x-protoboard-dev": token, origin: "null" })).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/layout", "{}", { ...json, "x-protoboard-dev": token })).status).toBe(400);

    const before = dev.version;
    const r = await post(dev.port, "/__protoboard/layout", body, { ...json, "x-protoboard-dev": token, origin: `http://127.0.0.1:${dev.port}` });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ file: ".protoboard/display.json", levels: [""], skipped: [] });
    const saved = JSON.parse(readFileSync(join(dir, ".protoboard/display.json"), "utf8"));
    expect(saved).toEqual({
      schema: "uhd.display/v0",
      diagram: { layouts: { "": { nodes: { body: { x: 320, y: 96 }, other: { x: 32, y: 32 } }, links: { body_link: { labelT: 0.25, labelFlip: true } } } } },
    });
    await until(() => dev.version > before);
    await dev.idle();
    expect((await bundle()).display).toEqual(saved);
    const pushed = await until(() => sse.events.find((e) => e.event === "bundle" && e.data.reason === "layout"));
    expect(pushed!.data.client).toBe("tab-1");
    expect(logs.some((l) => l.event === "layout" && /saved top level/.test(l.message))).toBe(true);

    // its own write is not reported back as an edit on disk
    await new Promise((r) => setTimeout(r, 400));
    await dev.idle();
    expect(sse.events.some((e) => e.event === "bundle" && e.data.reason === "display")).toBe(false);
  }, 60000);

  it("pushes display.json edited on disk, and reports one that is not JSON", async () => {
    const file = join(dir, ".protoboard/display.json");
    const edited = JSON.parse(readFileSync(file, "utf8"));
    edited.diagram.layouts[""].nodes.body = { x: 640, y: 96 };
    const before = dev.version;
    writeFileSync(file, JSON.stringify(edited, null, 2) + "\n");
    await until(() => dev.version > before);
    await dev.idle();
    expect((await bundle()).display.diagram.layouts[""].nodes.body).toEqual({ x: 640, y: 96 });
    expect(sse.events.some((e) => e.event === "bundle" && e.data.reason === "display")).toBe(true);

    const valid = dev.version;
    writeFileSync(file, "{ not json");
    await until(() => dev.version > valid);
    await dev.idle();
    const state = JSON.parse((await get(dev.port, "/__protoboard/state")).body);
    expect(state.diagnostics.map((d: { code: string }) => d.code)).toEqual(["PB_DEV_DISPLAY_INVALID"]);
    expect((await bundle()).display.diagram.layouts[""].nodes.body).toEqual({ x: 640, y: 96 });
    writeFileSync(file, JSON.stringify(edited, null, 2) + "\n");
    await until(async () => JSON.parse((await get(dev.port, "/__protoboard/state")).body).diagnostics.length === 0);
  }, 60000);

  it("stops cleanly", async () => {
    const port = dev.port;
    await dev.close();
    expect(logs.at(-1)).toMatchObject({ event: "stopped" });
    await expect(get(port, "/")).rejects.toThrow();
    expect(existsSync(join(dir, DEV_RECORD))).toBe(false);
  });
});

describe("behind a proxy (a browser-hosted VS Code, PB-861)", () => {
  it("answers the host names it is told to besides loopback, and takes a forwarded https origin's writes", async () => {
    const dir = tempProject("dev-proxy");
    const dev = await startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "viewer-lib"), allowHosts: ["ide.example"] });
    try {
      expect((await get(dev.port, "/", { host: "ide.example" })).status).toBe(200);
      expect((await get(dev.port, "/uhd-bundle.json", { host: "IDE.example:443" })).status).toBe(200);
      expect((await get(dev.port, "/", { host: "evil.example" })).status).toBe(403);
      const page = (await get(dev.port, "/", { host: "ide.example" })).body;
      const token = JSON.parse(/<script type="application\/json" id="protoboard-dev">(.*?)<\/script>/.exec(page)![1]).token;
      const body = JSON.stringify({ client: "t", layout: { positions: {}, links: {} } });
      const headers = { "content-type": "application/json", "x-protoboard-dev": token };
      // https at the proxy, http behind it; or the proxy's own host forwarded
      expect((await post(dev.port, "/__protoboard/layout", body, { ...headers, host: "ide.example", origin: "https://ide.example" })).status).toBe(200);
      expect((await post(dev.port, "/__protoboard/layout", body, { ...headers, origin: "https://ide.example", "x-forwarded-host": "ide.example" })).status).toBe(200);
    } finally {
      await dev.close();
    }
    const any = await startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "viewer-lib"), allowHosts: ["*"] });
    try {
      expect((await get(any.port, "/", { host: "anything.example" })).status).toBe(200);
    } finally {
      await any.close();
    }
  }, 60000);
});

describe("port selection", () => {
  it("takes any free port when the whole range from the first one is taken (many windows, each with its dev server)", async () => {
    const { createServer } = await import("node:net");
    const dir = tempProject("dev-ports-full");
    // 21 neighbouring ports, held: the first is where the scan starts, the other 20 are what it would skip to
    const held: import("node:net").Server[] = [];
    const hold = (port: number) =>
      new Promise<boolean>((ok) => {
        const s = createServer();
        s.once("error", () => ok(false));
        s.listen(port, "127.0.0.1", () => (held.push(s), ok(true)));
      });
    let base = 0;
    try {
      for (let attempt = 0; attempt < 20 && !base; attempt++) {
        const first = 20000 + Math.floor(Math.random() * 20000);
        let all = true;
        for (let p = first; p <= first + 20 && all; p++) all = await hold(p);
        if (all) base = first;
        else for (const s of held.splice(0)) await new Promise((r) => s.close(r));
      }
      expect(base, "no run of 21 free ports was found to hold").toBeGreaterThan(0);
      const dev = await startDev({ root: dir, port: base, watch: false, viewerLib: join(dir, "viewer-lib") });
      try {
        expect(dev.port < base || dev.port > base + 20, `it listens on ${dev.port}, inside the held range from ${base}`).toBe(true);
        expect((await fetch(`${dev.url}__protoboard/state`)).status).toBe(200);
      } finally {
        await dev.close();
      }
      // a port that was asked for is still never replaced
      await expect(startDev({ root: dir, port: base, strictPort: true, watch: false, viewerLib: join(dir, "viewer-lib") })).rejects.toThrow(`port ${base} is in use`);
    } finally {
      for (const s of held) await new Promise((r) => s.close(r));
    }
  }, 60000);


  it("skips a taken port, or fails on it when the port was asked for", async () => {
    const dir = tempProject("dev-ports");
    const a = await startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "viewer-lib") });
    try {
      const b = await startDev({ root: dir, port: a.port, watch: false, viewerLib: join(dir, "viewer-lib") });
      expect(b.port).toBeGreaterThan(a.port);
      await b.close();
      await expect(startDev({ root: dir, port: a.port, strictPort: true, watch: false, viewerLib: join(dir, "viewer-lib") })).rejects.toThrow(`port ${a.port} is in use`);
    } finally {
      await a.close();
    }
  }, 60000);

  it("says how to build the web viewer when its build is missing", async () => {
    const dir = tempProject("dev-unbuilt");
    await expect(startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "nowhere") })).rejects.toThrow(/web viewer is not built .* run `npm run build`/);
  });
});

describe("a project folder that goes while the server runs (B5)", () => {
  it("fails the next build with the reason, without an unhandled spawn error", async () => {
    const dir = tempProject("dev-gone");
    const dev = await startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "viewer-lib") });
    try {
      rmSync(dir, { recursive: true, force: true });
      const r = await dev.rebuild("test");
      expect(r.ok).toBe(false);
      expect(r.error).toBe(folderGoneMessage(dir));
      // the server still answers, with the failure as its state
      const state = JSON.parse((await get(dev.port, "/__protoboard/state")).body);
      expect(state.failed).toBe(true);
    } finally {
      await dev.close();
    }
  }, 60000);
});

describe("live reload that cannot watch (B19)", () => {
  it("says so in words, with what the system refused", () => {
    const e = Object.assign(new Error("EMFILE: too many open files, watch"), { code: "EMFILE" });
    const m = unwatchedMessage("the project folder", e);
    expect(m).toMatch(/^Live reload is off: the dev server cannot watch the project folder \(the system allows no more file watchers \(EMFILE\)\)/);
    expect(m).toContain("reload the window");
  });
});
