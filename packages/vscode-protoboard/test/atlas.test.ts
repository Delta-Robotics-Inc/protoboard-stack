/**
 * The Atlas tab in VS Code (docs/specs/atlas.md): the webview's messages for
 * positions and Open, checked field by field; the positions kept in the
 * display file's `atlas` key, with every other key as it was; a file opened
 * only when it lies inside the project; and the tab's title. (The tab's data
 * adapter is tested in packages/web-viewer/test/atlas-data.test.ts.)
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFromWebview, parseProjectPath } from "../../web-viewer/src/vscode/protocol.js";
import { formatDisplay } from "../../cli/src/dev/layout.js";
import { isProjectFile, projectFileOf, saveAtlasLayout, saveLayout } from "../src/display.js";
import { viewerTitle } from "../src/viewerPage.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp", "atlas");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("the Atlas tab's messages", () => {
  it("accepts positions: node ids with two finite numbers each", () => {
    expect(parseFromWebview({ type: "atlasLayout", positions: { "def:sys": [1.5, -2], "file:docs/a.png": [0, 0] } })).toEqual({ type: "atlasLayout", positions: { "def:sys": [1.5, -2], "file:docs/a.png": [0, 0] } });
    expect(parseFromWebview({ type: "atlasLayout", positions: {} })).toEqual({ type: "atlasLayout", positions: {} });
  });

  it("refuses positions that are not [x, y] by node id", () => {
    for (const positions of [
      undefined,
      null,
      [],
      { "def:a": [1] },
      { "def:a": [1, 2, 3] },
      { "def:a": [Number.NaN, 0] },
      { "def:a": [Number.POSITIVE_INFINITY, 0] },
      { "def:a": [2e9, 0] },
      { "def:a": ["1", 2] },
      { "def:a": { x: 1, y: 2 } },
      { sys: [1, 2] },
      JSON.parse('{ "__proto__": [1, 2] }'),
      { [`file:${"x".repeat(600)}`]: [1, 2] },
    ]) {
      expect(parseFromWebview({ type: "atlasLayout", positions }), JSON.stringify(positions)).toBeUndefined();
    }
  });

  it("accepts a project-relative path to open, and refuses anything else", () => {
    expect(parseFromWebview({ type: "openFile", path: "docs/images/render 1.png" })).toEqual({ type: "openFile", path: "docs/images/render 1.png" });
    expect(parseFromWebview({ type: "openFile", path: "src/system.uhd.ts" })).toEqual({ type: "openFile", path: "src/system.uhd.ts" });
    for (const path of [
      undefined,
      42,
      "",
      "../outside.txt",
      "docs/../../outside.txt",
      "docs/..",
      "./docs/a.png",
      "docs//a.png",
      "docs/a.png/",
      "/etc/passwd",
      "C:/Windows/win.ini",
      "C:\\Windows\\win.ini",
      "docs\\a.png",
      "\\\\server\\share\\a.png",
      "docs/a.png:stream",
      "docs/a\u0000.png",
      "docs/a\n.png",
      "x".repeat(1025),
    ]) {
      expect(parseFromWebview({ type: "openFile", path }), JSON.stringify(path)).toBeUndefined();
      expect(parseProjectPath(path)).toBeUndefined();
    }
  });
});

describe("keeping the Atlas positions in the display file", () => {
  const root = join(TMP, "project");
  const file = join(root, ".protoboard", "display.json");
  const display = {
    schema: "uhd.display/v0",
    diagram: { layouts: { "": { nodes: { cap: { x: 10, y: 20 } }, links: { l1: { waypoints: [[1, 2]] as [number, number][] } } } }, expanded: ["cap"] },
    spatial: { root: "shell", placements: { pod: { matrix: [1, 0, 0, 12.5, 0, 1, 0, 0, 0, 0, 1, 30, 0, 0, 0, 1], note: "sits in the pocket … here" } } },
  };
  beforeAll(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, ".protoboard"), { recursive: true });
    // as Python writes it: non-ASCII escaped, which a save keeps
    writeFileSync(file, formatDisplay(display).replace("…", "\\u2026"));
  });

  it("adds the atlas key and keeps diagram and spatial as they were, byte for byte", () => {
    const before = readFileSync(file, "utf8");
    const r = saveAtlasLayout(root, file, { "def:shell": [100.4, -20.6], "file:docs/a.png": [5, 6] });
    expect(r).toEqual({ file: ".protoboard/display.json", changed: true, nodes: 2 });
    const after = readFileSync(file, "utf8");
    expect(after.startsWith(before.slice(0, before.lastIndexOf("\n}")))).toBe(true);
    expect(after).toContain("\\u2026");
    const saved = JSON.parse(after);
    expect(saved.diagram).toEqual(display.diagram);
    expect(saved.spatial).toEqual(display.spatial);
    expect(saved.atlas).toEqual({ positions: { "def:shell": [100, -21], "file:docs/a.png": [5, 6] } });
    // one line per position
    expect(after).toContain('      "def:shell": [100, -21],\n      "file:docs/a.png": [5, 6]\n');
  });

  it("writes nothing when the file already holds the positions", () => {
    const before = readFileSync(file, "utf8");
    expect(saveAtlasLayout(root, file, { "file:docs/a.png": [5, 6], "def:shell": [100, -21] }).changed).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("keeps the atlas key when a diagram layout is saved (Ctrl+S)", () => {
    const r = saveLayout(root, file, { positions: { "": { cap: { x: 30, y: 40 } } }, links: {} });
    expect(r.levels).toEqual([""]);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.diagram.layouts[""].nodes.cap).toEqual({ x: 30, y: 40 });
    expect(saved.atlas).toEqual({ positions: { "def:shell": [100, -21], "file:docs/a.png": [5, 6] } });
  });

  it("refuses a display file that is not JSON, and leaves it alone", () => {
    const broken = join(root, "broken.json");
    writeFileSync(broken, "{ nope");
    expect(() => saveAtlasLayout(root, broken, { "def:a": [1, 2] })).toThrow(/broken\.json is not valid JSON/);
    expect(readFileSync(broken, "utf8")).toBe("{ nope");
  });

  it("creates the file when the project has none", () => {
    const fresh = join(TMP, "fresh");
    rmSync(fresh, { recursive: true, force: true });
    const f = join(fresh, ".protoboard", "display.json");
    expect(saveAtlasLayout(fresh, f, { "def:a": [1, 2] }).changed).toBe(true);
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ schema: "uhd.display/v0", atlas: { positions: { "def:a": [1, 2] } } });
  });
});

describe("a file the Atlas opens", () => {
  const root = join(TMP, "open", "project");
  const outside = join(TMP, "open", "outside");
  beforeAll(() => {
    rmSync(join(TMP, "open"), { recursive: true, force: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, "docs", "notes.md"), "# notes\n");
    writeFileSync(join(root, ".env"), "SECRET=1\n");
    writeFileSync(join(outside, "secret.txt"), "outside\n");
    // a link inside the project that leads out of it (a junction: no rights needed on Windows)
    symlinkSync(outside, join(root, "linked"), "junction");
  });

  it("opens a file inside the project", () => {
    const f = projectFileOf(root, "docs/notes.md");
    expect(f).toBe(join(root, "docs", "notes.md"));
    expect(isProjectFile(f!)).toBe(true);
    // inside, but gone (or a folder): not a file to open
    expect(isProjectFile(projectFileOf(root, "docs/gone.md")!)).toBe(false);
    expect(isProjectFile(projectFileOf(root, "docs")!)).toBe(false);
  });

  it("refuses a path that leaves the project, by text or through a link", () => {
    expect(projectFileOf(root, "../outside/secret.txt")).toBeUndefined();
    expect(projectFileOf(root, "docs/../../outside/secret.txt")).toBeUndefined();
    expect(projectFileOf(root, join(outside, "secret.txt"))).toBeUndefined();
    expect(projectFileOf(root, "linked/secret.txt")).toBeUndefined();
    expect(projectFileOf(root, "")).toBeUndefined();
  });

  it("refuses a name the index never lists", () => {
    expect(projectFileOf(root, ".env")).toBeUndefined();
    expect(projectFileOf(root, "keys/deploy.pem")).toBeUndefined();
  });
});

describe("the Atlas tab's title", () => {
  it("is the project and Atlas", () => {
    expect(viewerTitle("quadcopter-5in", "atlas")).toBe("quadcopter-5in · Atlas");
  });
});
