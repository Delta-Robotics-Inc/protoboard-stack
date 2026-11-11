/**
 * What the dev server rebuilds for (R1-B, review 2026-11-01 M3 and B2): only a real change of a file a build
 * reads. Not an access-time or attribute event that changed nothing (Windows reports those as changes: the storm
 * of rebuilds every ~4.4 s while Kevin only looked at the ClientX), not the view sidecars or the parts research
 * records the tools write, not the build's own output. Parts wait for a longer quiet period than sources; each
 * rebuild names its trigger in the log; the status the viewers show says "Updating model" with the files in
 * `detail`.
 */
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busyStatus, contentChanged, diskSignature, ignoredPath, type DiskSignature, isSourcePath, MTIME_SLACK_MS, startDev, type DevLogEvent, type DevServer } from "../src/dev/server.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// its own folder: other test files here work in .tmp at the same time
const TMP = join(HERE, ".tmp/dev-server-watch");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Set a file's access time only (what a reader, an indexer or a scanner does), keeping its modification time. */
const touchAccess = (file: string) => {
  const st = statSync(file);
  utimesSync(file, new Date(), st.mtime);
};

describe("what the watcher ignores and how long it waits", () => {
  it("ignores the view sidecars, the parts research records and the build's own output", () => {
    for (const p of [
      "src/modules/control-panel-rev1/out/body.view.glb",
      "src/modules/control-panel-rev1/out/body.view.coarse.glb",
      "src/modules/control-panel-rev1/out/body.view.json",
      "parts/catalog/samsung-cl05/artifacts/cad/samsung-cl05-1005.view.glb",
      "parts/evidence/samsung-cl05/sources.json",
      "parts\\evidence\\samsung-cl05\\verification.json",
      ".protoboard/build/uhd-bundle.json",
      "node_modules/x/index.js",
      "src/.sys.uhd.ts.123.tmp",
    ])
      expect(ignoredPath(p), p).toBe(true);
    for (const p of ["parts/origins.json", "parts/local/samsung-cl21/part-cad/chip_cap_0805.py", "parts/local/samsung-cl21/part-cad/source.json", "src/sys.uhd.ts", "src/modules/x/out/body.glb", "protoboard.config.ts"])
      expect(ignoredPath(p), p).toBe(false);
    // the display file is never ignored, even under .protoboard
    expect(ignoredPath(".protoboard/display.json", ".protoboard/display.json")).toBe(false);
  });

  it("tells sources (the short quiet period) from parts and records (the long one)", () => {
    const w = { sources: ["src/**/*.uhd.ts"] };
    expect(isSourcePath("src/sys.uhd.ts", w)).toBe(true);
    expect(isSourcePath("src\\modules\\pcb\\pcb.uhd.ts", w)).toBe(true);
    expect(isSourcePath("protoboard.config.ts", w)).toBe(true);
    expect(isSourcePath("src/lib/helpers.ts", w)).toBe(true);
    expect(isSourcePath("parts/origins.json", w)).toBe(false);
    expect(isSourcePath("parts/local/samsung-cl21/part-cad/chip_cap_0805.py", w)).toBe(false);
    expect(isSourcePath("parts/local/samsung-cl21/part.uhd.ts", w)).toBe(false);
    expect(isSourcePath("scenarios.ts", { sources: [], scenarios: "scenarios.ts" })).toBe(true);
  });

  it("says Updating model, with the changed files only in the detail (B2)", () => {
    expect(busyStatus(["parts/local/a/part-cad/a.py", "parts/origins.json"])).toEqual({ state: "busy", message: "Updating model", detail: "parts/local/a/part-cad/a.py\nparts/origins.json" });
    expect(busyStatus([])).toEqual({ state: "busy", message: "Updating model", detail: "building" });
  });
});

describe("a change of content, not an event", () => {
  const dir = join(TMP, "gate");
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });

  it("does not count an access-time update of a file the last build already read", () => {
    const f = join(dir, "origins.json");
    writeFileSync(f, "{}");
    const seen = new Map<string, DiskSignature>();
    const buildAt = Date.now() + MTIME_SLACK_MS + 1000; // a build began after the file was written
    touchAccess(f);
    expect(contentChanged(seen, f, "change", buildAt)).toBe(false);
    touchAccess(f);
    expect(contentChanged(seen, f, "change", buildAt)).toBe(false);
    // a real write: a different size or time
    writeFileSync(f, '{"definitions":{}}');
    expect(contentChanged(seen, f, "change", buildAt)).toBe(true);
    expect(contentChanged(seen, f, "change", buildAt)).toBe(false);
  });

  it("counts a file written after the last build began, a new file and a deleted one", () => {
    const f = join(dir, "a.py");
    const buildAt = Date.now() - 10_000;
    writeFileSync(f, "x = 1\n");
    expect(contentChanged(new Map(), f, "change", buildAt)).toBe(true);
    const seen = new Map<string, DiskSignature>();
    const g = join(dir, "new.py");
    writeFileSync(g, "y = 2\n");
    expect(contentChanged(seen, g, "rename", Date.now() + 60_000)).toBe(true);
    rmSync(g);
    expect(contentChanged(seen, g, "rename", Date.now() + 60_000)).toBe(true);
    expect(diskSignature(g)).toBeUndefined();
  });

  it("counts a source seen for the first time even with old times (a restore, unzip, cp -p; gate R1)", () => {
    const f = join(dir, "restored.uhd.ts");
    writeFileSync(f, "export const A = 1;\n");
    const buildAt = Date.now() + MTIME_SLACK_MS + 60_000; // the file looks older than the last build
    expect(contentChanged(new Map(), f, "change", buildAt)).toBe(false);
    expect(contentChanged(new Map(), f, "change", buildAt, true)).toBe(true);
    // once its signature is known, a read of it is not a change
    const seen = new Map<string, DiskSignature>();
    contentChanged(seen, f, "change", buildAt, true);
    touchAccess(f);
    expect(contentChanged(seen, f, "change", buildAt, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The server on a temporary project
// ---------------------------------------------------------------------------

const SYS = (name: string) => `import type { ModuleDef } from "@deltarobotics/uhd";

export const SYS: ModuleDef = { id: "sys", name: "${name}", interfaces: [] };
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
  write("src/modules/panel/out/body.glb", "glb bytes");
  write("parts/origins.json", JSON.stringify({ schema: "protoboard.origins/v0", definitions: {} }));
  write("parts/local/cap/part-cad/chip_cap.py", "# a part's CAD script\n");
  write("parts/local/cap/part-cad/source.json", "{}\n");
  write("parts/evidence/cap/sources.json", "[]\n");
  write("viewer-lib/web-viewer.js", "export function mountWebViewer() {}\n");
  write("viewer-lib/web-viewer.css", "body {}\n");
  return dir;
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
    await sleep(50);
  }
}

describe("protoboard dev, watching a project while nobody edits it", () => {
  let dir: string;
  let dev: DevServer;
  let sse: ReturnType<typeof listen>;
  const logs: DevLogEvent[] = [];
  const SLOW = 400;

  beforeAll(async () => {
    dir = tempProject("quiet");
    // the project's files predate the first build by more than the slack, as a person's project does (a file seen
    // first within the slack of a build's start counts once as written after it)
    await sleep(MTIME_SLACK_MS + 500);
    dev = await startDev({ root: dir, port: 0, viewerLib: join(dir, "viewer-lib"), debounceMs: 50, slowDebounceMs: SLOW, record: false, log: (e) => logs.push(e) });
    sse = listen(dev.port);
    await until(() => sse.events.some((e) => e.event === "hello"));
    // the watchers settle
    await sleep(300);
  }, 60000);
  afterAll(async () => {
    sse?.close();
    await dev?.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("does not rebuild for reads, sidecars or research records (M3)", async () => {
    const before = dev.version;
    for (let round = 0; round < 3; round++) {
      // what was seen in the storm: the origins, a part's CAD script and record read again, the view sidecars and
      // the evidence written
      touchAccess(join(dir, "parts/origins.json"));
      touchAccess(join(dir, "parts/local/cap/part-cad/chip_cap.py"));
      touchAccess(join(dir, "parts/local/cap/part-cad/source.json"));
      touchAccess(join(dir, "src/modules/panel/out/body.glb"));
      writeFileSync(join(dir, "src/modules/panel/out/body.view.glb"), `sidecar ${round}`);
      writeFileSync(join(dir, "src/modules/panel/out/body.view.coarse.glb"), `coarse ${round}`);
      writeFileSync(join(dir, "parts/evidence/cap/sources.json"), `[${round}]\n`);
      await sleep(300);
    }
    await sleep(SLOW + 600);
    await dev.idle();
    expect(dev.version).toBe(before);
    expect(logs.filter((l) => l.event === "build" && (l.trigger as string[]).length > 0)).toEqual([]);
    // the next storm names its cause: each file whose event changed nothing is logged once
    const quiet = logs.filter((l) => l.event === "watch" && /^ignored an event on/.test(l.message)).map((l) => String(l.path).split("\\").join("/"));
    expect(quiet).toContain("parts/origins.json");
    expect(new Set(quiet).size).toBe(quiet.length);
  }, 30000);

  it("rebuilds once for a part's files written together, after the long quiet period, naming them (M3, B2)", async () => {
    const before = dev.version;
    const t0 = Date.now();
    writeFileSync(join(dir, "parts/local/cap/part-cad/chip_cap.py"), "# regenerated\nx = 1\n");
    await sleep(150);
    writeFileSync(join(dir, "parts/local/cap/part-cad/source.json"), '{"sha256":"x"}\n');
    await until(() => dev.version > before);
    await dev.idle();
    expect(dev.version).toBe(before + 1);
    const status = sse.events.filter((e) => e.event === "status").pop()!;
    expect(status.data).toMatchObject({ state: "busy", message: "Updating model" });
    expect(String(status.data.detail).split("\\").join("/")).toBe("parts/local/cap/part-cad/chip_cap.py\nparts/local/cap/part-cad/source.json");
    const named = logs.filter((l) => l.event === "watch" && /^rebuilding for 2 changed file/.test(l.message));
    expect(named).toHaveLength(1);
    // it waited for the long quiet period after the last write, not the short one
    const built = logs.filter((l) => l.event === "build").pop()!;
    expect(built.version).toBe(before + 1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150 + SLOW);
  }, 30000);

  it("still rebuilds for a source edit after the short quiet period, and for origins.json edited by hand", async () => {
    let before = dev.version;
    writeFileSync(join(dir, "src/sys.uhd.ts"), SYS("System two"));
    await until(() => dev.version > before);
    await dev.idle();
    expect(JSON.parse(readFileSync(join(dir, ".protoboard/build/uhd-bundle.json"), "utf8")).definitions.find((d: { id: string }) => d.id === "sys").name).toBe("System two");
    before = dev.version;
    writeFileSync(join(dir, "parts/origins.json"), JSON.stringify({ schema: "protoboard.origins/v0", definitions: {} }, null, 2) + "\n");
    await until(() => dev.version > before);
    await dev.idle();
    expect(logs.some((l) => l.event === "build" && (l.trigger as string[]).map((t) => t.split("\\").join("/")).includes("parts/origins.json"))).toBe(true);
  }, 60000);
});
