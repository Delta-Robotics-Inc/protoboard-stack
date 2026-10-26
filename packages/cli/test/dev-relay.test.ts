/**
 * `protoboard dev` and a framing host (PB-855, docs/specs/vscode-extension.md
 * §3): the page's relay between its parent window and the viewer (relay.js,
 * run here against a stand-in window and viewer), and where the viewer's
 * openSource lands (sources.ts on the quadcopter, and the server's
 * /__protoboard/source on a temporary project).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import { createRelay, originAllowed, type RelayWindow } from "../src/dev/relay.js";
import { lineOf, resolveSource, sourceIndex, type SourceIndex } from "../src/dev/sources.js";
import { startDev, type DevServer } from "../src/dev/server.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-relay");
const QUAD = join(HERE, "../../../examples/quadcopter-5in");

// ---------------------------------------------------------------------------
// The relay
// ---------------------------------------------------------------------------

/** The dev page in a frame (or not), as far as the relay sees it. */
function page(opts: { origin?: string; ancestor?: string; referrer?: string; framed?: boolean } = {}) {
  const posted: { message: unknown; target: string }[] = [];
  const listeners = new Set<(e: { data: unknown; origin: string; source: unknown }) => void>();
  const parent = { postMessage: (message: unknown, target: string) => void posted.push({ message, target }) };
  const win: RelayWindow = {
    parent,
    location: { origin: opts.origin ?? "http://127.0.0.1:5180", ...(opts.ancestor ? { ancestorOrigins: [opts.ancestor] } : {}) },
    document: { referrer: opts.referrer ?? "" },
    addEventListener: (_t, l) => void listeners.add(l),
    removeEventListener: (_t, l) => void listeners.delete(l),
  };
  if (opts.framed === false) win.parent = win;
  const dispatch = (data: unknown, origin: string, source: unknown = parent) => {
    for (const l of listeners) l({ data, origin, source });
  };
  /** A stand-in viewer handle: records what it is given. */
  const viewer = { got: [] as unknown[], post: (m: unknown) => (viewer.got.push(m), true) };
  return { win, posted, dispatch, listeners, viewer };
}

const where = { source: { file: "src/modules/assemblies.uhd.ts", line: 59, path: "/p/src/modules/assemblies.uhd.ts" } };

describe("the dev page's relay", () => {
  it("takes host messages from the parent at an allowed origin and hands them to the viewer", () => {
    const p = page({ ancestor: "vscode-webview://1f2e" });
    const relay = createRelay({ window: p.win, resolveSource: async () => undefined });
    expect(relay.framed).toBe(true);
    // before the viewer is mounted: kept for it
    p.dispatch({ type: "uhd-viewer:setView", view: "3d" }, "vscode-webview://1f2e");
    relay.attach(p.viewer);
    p.dispatch({ type: "uhd-viewer:focus", path: "arm_fl/motor" }, "vscode-webview://1f2e");
    // the page's own origin is allowed by default too
    p.dispatch({ type: "uhd-viewer:drill", path: "stack" }, "http://127.0.0.1:5180");
    // refused: another origin, another window, events, other messages
    p.dispatch({ type: "uhd-viewer:focus", path: "battery" }, "https://evil.example");
    p.dispatch({ type: "uhd-viewer:focus", path: "battery" }, "vscode-webview://1f2e", { postMessage() {} });
    p.dispatch({ type: "uhd-viewer:openSource", defId: "x" }, "vscode-webview://1f2e");
    p.dispatch({ type: "something-else" }, "vscode-webview://1f2e");
    expect(p.viewer.got).toEqual([
      { type: "uhd-viewer:setView", view: "3d" },
      { type: "uhd-viewer:focus", path: "arm_fl/motor" },
      { type: "uhd-viewer:drill", path: "stack" },
    ]);
    relay.close();
    expect(p.listeners.size).toBe(0);
  });

  it("posts the viewer's events to the parent at its origin", () => {
    const p = page({ ancestor: "vscode-webview://1f2e" });
    const { callbacks } = createRelay({ window: p.win, resolveSource: async () => undefined });
    callbacks.onReady();
    callbacks.onSelectionChanged({ kind: "node", id: "arm_fl/motor", defId: "meps-neon-2207-v2-1950kv" });
    callbacks.onOpenArtifact!({ defId: "dji-o4-air-unit", artifactId: "cad_step" });
    callbacks.onOpenPair!({ linkId: "cap/l_spi", a: "cap/esp32", b: "cap/sensor" });
    expect(p.posted).toEqual([
      { message: { type: "uhd-viewer:ready" }, target: "vscode-webview://1f2e" },
      { message: { type: "uhd-viewer:selectionChanged", selection: { kind: "node", id: "arm_fl/motor", defId: "meps-neon-2207-v2-1950kv" } }, target: "vscode-webview://1f2e" },
      { message: { type: "uhd-viewer:openArtifact", defId: "dji-o4-air-unit", artifactId: "cad_step" }, target: "vscode-webview://1f2e" },
      { message: { type: "uhd-viewer:openPair", linkId: "cap/l_spi", a: "cap/esp32", b: "cap/sensor" }, target: "vscode-webview://1f2e" },
    ]);
  });

  it("adds where the source is to openSource", async () => {
    const p = page({ ancestor: "vscode-webview://1f2e" });
    const asked: unknown[] = [];
    const relay = createRelay({ window: p.win, resolveSource: async (r) => (asked.push(r), where) });
    const event = await relay.openSource({ defId: "quadcopter-5in-arm", instancePath: "arm_fl" });
    expect(asked).toEqual([{ defId: "quadcopter-5in-arm", instancePath: "arm_fl" }]);
    expect(event).toEqual({ type: "uhd-viewer:openSource", defId: "quadcopter-5in-arm", instancePath: "arm_fl", ...where });
    expect(p.posted).toEqual([{ message: event, target: "vscode-webview://1f2e" }]);
    // nothing known (or the server unreachable): the request goes out as it came
    const bare = createRelay({ window: page({ ancestor: "vscode-webview://1f2e" }).win, resolveSource: async () => Promise.reject(new Error("down")) });
    expect(await bare.openSource({ defId: "x" })).toEqual({ type: "uhd-viewer:openSource", defId: "x" });
  });

  it("holds events until a parent at an allowed origin speaks, when the frame cannot tell who framed it", () => {
    const p = page({ referrer: "" });
    const relay = createRelay({ window: p.win, origins: ["http://localhost:3000", "vscode-webview://*"], resolveSource: async () => undefined });
    relay.attach(p.viewer);
    relay.callbacks.onReady();
    expect(p.posted).toEqual([]);
    p.dispatch({ type: "uhd-viewer:select", ids: [] }, "http://localhost:3000");
    expect(p.posted).toEqual([{ message: { type: "uhd-viewer:ready" }, target: "http://localhost:3000" }]);
    expect(p.viewer.got).toEqual([{ type: "uhd-viewer:select", ids: [] }]);
  });

  it("does not take the page's own origin when the server names others", () => {
    const p = page({ ancestor: "vscode-webview://1f2e" });
    const relay = createRelay({ window: p.win, origins: ["vscode-webview://*"], resolveSource: async () => undefined });
    relay.attach(p.viewer);
    p.dispatch({ type: "uhd-viewer:drill", path: "stack" }, "http://127.0.0.1:5180");
    expect(p.viewer.got).toEqual([]);
  });

  it("in a tab of its own: no host, openSource is shown by the page, artifacts stay links", async () => {
    const p = page({ framed: false });
    const shown: unknown[] = [];
    const relay = createRelay({ window: p.win, resolveSource: async () => where, onLocal: (e) => void shown.push(e) });
    expect(relay.framed).toBe(false);
    expect(relay.callbacks.onOpenArtifact).toBeUndefined();
    expect(relay.callbacks.onOpenPair).toBeUndefined();
    relay.callbacks.onReady();
    relay.callbacks.onOpenSource({ defId: "quadcopter-5in-arm" });
    await new Promise((r) => setTimeout(r, 0));
    expect(shown).toEqual([{ type: "uhd-viewer:openSource", defId: "quadcopter-5in-arm", ...where }]);
    expect(p.posted).toEqual([]);
    expect(p.listeners.size).toBe(0);
  });

  it("matches origins", () => {
    expect(originAllowed("vscode-webview://abc", ["vscode-webview://*"])).toBe(true);
    expect(originAllowed("http://127.0.0.1:5180", ["self"], "http://127.0.0.1:5180")).toBe(true);
    expect(originAllowed("http://localhost:5180", ["self"], "http://127.0.0.1:5180")).toBe(false);
    expect(originAllowed("null", ["vscode-webview://*", "self"], "null")).toBe(false);
    expect(originAllowed("https://a.example", ["https://a.example/"])).toBe(true);
    expect(originAllowed("https://b.example", ["*"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Where a module is written: the quadcopter
// ---------------------------------------------------------------------------

describe("source locations", () => {
  let index: SourceIndex;
  beforeAll(async () => {
    index = sourceIndex(await loadProject(QUAD, { checks: false }));
  }, 60000);
  const line = (file: string, text: string) => readFileSync(join(QUAD, file), "utf8").split("\n").findIndex((l) => l.includes(text)) + 1;

  it("finds a definition's id in TypeScript or JSON, from a given line", () => {
    const ts = `export const A = {\n  id: "arm",\n  children: [\n    { id: "motor", moduleDefId: "m" },\n  ],\n};\nexport const B = {\n  id: 'b',\n  children: [{ id: \`motor\`, moduleDefId: "m" }],\n};\n`;
    expect(lineOf(ts, "arm")).toBe(2);
    expect(lineOf(ts, "motor")).toBe(4);
    expect(lineOf(ts, "motor", 7)).toBe(9);
    expect(lineOf(ts, "m", 1, "moduleDefId")).toBe(4);
    expect(lineOf('{\n  "id": "x.y"\n}', "x.y")).toBe(2);
    expect(lineOf('{ "id": "xay" }', "x.y")).toBeUndefined();
  });

  it("indexes local definitions at their id and catalog parts at their vendored .uhd.ts (PB-910), not the pinned JSON", () => {
    expect(index.definitions["quadcopter-5in-arm"]).toEqual({ file: "src/modules/assemblies.uhd.ts", line: line("src/modules/assemblies.uhd.ts", 'id: "quadcopter-5in-arm"'), tier: "project-specific" });
    expect(index.definitions["quadcopter-5in"]).toMatchObject({ file: "src/quadcopter.uhd.ts", line: line("src/quadcopter.uhd.ts", 'id: "quadcopter-5in"') });
    expect(index.definitions["meps-neon-2207-v2-1950kv"]).toEqual({
      file: "parts/catalog/meps-neon-2207-v2-1950kv/meps-neon-2207-v2-1950kv.uhd.ts",
      line: line("parts/catalog/meps-neon-2207-v2-1950kv/meps-neon-2207-v2-1950kv.uhd.ts", 'id: "meps-neon-2207-v2-1950kv"'),
      tier: "catalog",
    });
  });

  it("indexes each instance where its parent declares it", () => {
    // a child entry in the parent's definition
    expect(index.instances["arm_fl/motor"]).toEqual({ definition: "meps-neon-2207-v2-1950kv", file: "src/modules/assemblies.uhd.ts", line: line("src/modules/assemblies.uhd.ts", '{ id: "motor"') });
    // children the root builds from a list above it (ARMS.map): the list entry
    expect(index.instances.arm_fl).toEqual({ definition: "quadcopter-5in-arm", file: "src/quadcopter.uhd.ts", line: line("src/quadcopter.uhd.ts", '{ id: "arm_fl"') });
    expect(index.instances.stack).toMatchObject({ definition: "dolphinrc-f405-v3-stack" });
    // in a sub-assembly: the stack's own entry for the flight controller
    expect(index.instances["stack/fc"]).toMatchObject({ definition: "dolphinrc-f405-v3-flight-controller", file: index.definitions["dolphinrc-f405-v3-stack"].file });
    expect(index.instances["stack/fc"].line).toBeGreaterThan(index.definitions["dolphinrc-f405-v3-stack"].line!);
    expect(index.instances[""]).toBeUndefined();
  });

  it("resolves a request to places with absolute paths, inside the project only", () => {
    const r = resolveSource(index, QUAD, { defId: "meps-neon-2207-v2-1950kv", instancePath: "arm_fl/motor" })!;
    expect(r.defId).toBe("meps-neon-2207-v2-1950kv");
    expect(r.source).toMatchObject({ file: "parts/catalog/meps-neon-2207-v2-1950kv/meps-neon-2207-v2-1950kv.uhd.ts", path: join(QUAD, "parts/catalog/meps-neon-2207-v2-1950kv/meps-neon-2207-v2-1950kv.uhd.ts") });
    expect(r.instanceSource).toMatchObject({ file: "src/modules/assemblies.uhd.ts", path: join(QUAD, "src/modules/assemblies.uhd.ts") });
    // an instance alone names its definition
    expect(resolveSource(index, QUAD, { instancePath: "/arm_fl/motor/" })).toMatchObject({ defId: "meps-neon-2207-v2-1950kv", instancePath: "arm_fl/motor" });
    expect(resolveSource(index, QUAD, { defId: "no-such-part" })).toBeUndefined();
    expect(resolveSource(index, QUAD, {})).toBeUndefined();
    const escaping: SourceIndex = { ...index, definitions: { evil: { file: "../../etc/passwd", tier: "catalog" } } };
    expect(resolveSource(escaping, QUAD, { defId: "evil" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The server: the source route, the relay script, the host origins
// ---------------------------------------------------------------------------

const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";

export const BODY: ModuleDef = {
  id: "body",
  name: "Body",
  interfaces: [],
};

export const SYS: ModuleDef = {
  id: "sys",
  name: "System",
  interfaces: [],
  children: [
    { id: "left", moduleDefId: "body" },
    { id: "right", moduleDefId: "body" },
  ],
};
`;

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

describe("protoboard dev: source route and relay", () => {
  let dev: DevServer;
  const dir = join(TMP, "relay-project");
  beforeAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    const write = (rel: string, content: string) => {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), content);
    };
    write("package.json", JSON.stringify({ name: "relay-project", private: true, type: "module" }));
    write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "relay-project", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
    write("src/sys.uhd.ts", SYS);
    write("viewer-lib/web-viewer.js", "export function mountWebViewer() {}\n");
    write("viewer-lib/web-viewer.css", "body {}\n");
    dev = await startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "viewer-lib"), hostOrigins: ["vscode-webview://*", "http://localhost:3000"] });
  }, 60000);
  afterAll(async () => {
    await dev?.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("answers where a definition and an instance are written", async () => {
    const r = await get(dev.port, "/__protoboard/source?defId=body&instancePath=right");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      defId: "body",
      instancePath: "right",
      source: { file: "src/sys.uhd.ts", line: 4, path: join(dir, "src/sys.uhd.ts") },
      instanceSource: { file: "src/sys.uhd.ts", line: 15, path: join(dir, "src/sys.uhd.ts") },
    });
    expect(JSON.parse((await get(dev.port, "/__protoboard/source?instancePath=left")).body)).toMatchObject({ defId: "body", instanceSource: { line: 14 } });
    expect((await get(dev.port, "/__protoboard/source?defId=nothing")).status).toBe(404);
    expect((await get(dev.port, "/__protoboard/source")).status).toBe(400);
  });

  it("serves the relay and gives the page the host origins", async () => {
    const relay = await get(dev.port, "/__protoboard/relay.js");
    expect(relay.status).toBe(200);
    expect(relay.body).toContain("export function createRelay");
    const script = (await get(dev.port, "/__protoboard/dev.js")).body;
    expect(script).toContain(`import { createRelay } from "./relay.js"`);
    expect(script).toMatch(/\.\.\.relay\.callbacks/);
    const html = (await get(dev.port, "/")).body;
    const config = JSON.parse(/<script type="application\/json" id="protoboard-dev">(.*?)<\/script>/.exec(html)![1]);
    expect(config.hostOrigins).toEqual(["vscode-webview://*", "http://localhost:3000"]);
  });
});
