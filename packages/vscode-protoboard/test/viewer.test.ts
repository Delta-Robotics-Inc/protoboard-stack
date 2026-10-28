/**
 * The viewer tabs (PB-895, PB-896, PB-897): what names a tab, the page its
 * webview loads and that page's policy, the messages between the page and
 * the extension, a tab's layout saved into the display file, and the
 * Inspector's card for what a tab selects.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { hasEdits, hierarchyRowArg, parseFromWebview } from "../../web-viewer/src/vscode/protocol.js";
import { tabModule } from "../../web-viewer/src/vscode/tab-module.js";
import { COMET_DOTS, COMET_DUR_S, TRIANGLE, cometDots, trianglePoint } from "../../web-viewer/src/vscode/comet.js";
import { statusLabel } from "../src/check.js";
import { DEFAULT_DISPLAY, displayFile, saveLayout } from "../src/display.js";
import { findings } from "../src/drc.js";
import { groupCard, linkCard, moduleCard, moduleSourceFile, statusChip } from "../src/inspector.js";
import { moduleSource } from "../src/source.js";
import { indexProject, readBuild } from "../src/model.js";
import { loadCodeReference } from "../src/codes.js";
import { buildTree, nodeMap } from "../src/tree.js";
import { SOURCE_COMMANDS, devOrigins, distinctTitles, originCovered, parseBackup, parseViewerUri, viewerCsp, viewerPageHtml, viewerTitle, viewerUri, VIEWER_SCHEME } from "../src/viewerPage.js";
import { bundle, resolved } from "./fixtures.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp", "viewer");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("viewer tab resources", () => {
  it("name the project, the module and the view, and read back", () => {
    const u = viewerUri({ root: "/work/smart-bottle", path: "cap/board", view: "3d" });
    expect(u.scheme).toBe(VIEWER_SCHEME);
    expect(u.path).toBe("/smart-bottle/cap/board");
    expect(parseViewerUri(u)).toEqual({ root: "/work/smart-bottle", path: "cap/board", view: "3d" });
    // the diagram is the default and leaves no view in the query: one tab per module and view
    const root = viewerUri({ root: "/work/quad", path: "", view: "diagram" });
    expect(root.path).toBe("/quad");
    expect(root.query).not.toContain("view=");
    expect(parseViewerUri(root)).toEqual({ root: "/work/quad", path: "", view: "diagram" });
    expect(parseViewerUri(viewerUri({ root: "C:\\work\\quad", path: "", view: "ext-x.wiring" }))).toEqual({ root: "C:\\work\\quad", path: "", view: "ext-x.wiring" });
  });

  it("carry a view's params (the pair view's link and modules) as part of the tab", () => {
    const pair = { root: "/work/quad", path: "stack", view: "pair", params: { link: "stack/fc_esc", a: "stack/fc", b: "stack/esc" } };
    const u = viewerUri(pair);
    expect(parseViewerUri(u)).toEqual(pair);
    // another link of the same level is another tab
    expect(viewerUri({ ...pair, params: { link: "stack/fc_rx", a: "stack/fc", b: "stack/rx" } }).query).not.toBe(u.query);
    // only short named strings come back
    expect(parseViewerUri({ scheme: VIEWER_SCHEME, query: "root=/x&view=pair&p.link=l1&p.Bad%20Name=1" })).toEqual({ root: "/x", path: "", view: "pair", params: { link: "l1" } });
  });

  it("refuse anything else", () => {
    expect(parseViewerUri({ scheme: "file", query: "root=/x" })).toBeUndefined();
    expect(parseViewerUri({ scheme: VIEWER_SCHEME, query: "module=a" })).toBeUndefined();
    expect(parseViewerUri({ scheme: VIEWER_SCHEME, query: "root=/x&module=/etc" })).toBeUndefined();
    expect(parseViewerUri({ scheme: VIEWER_SCHEME, query: "root=/x&module=a//b" })).toBeUndefined();
    expect(parseViewerUri({ scheme: VIEWER_SCHEME, query: "root=/x&view=Bad View" })).toBeUndefined();
  });

  it("are titled by the module, with the view when it is not the diagram", () => {
    expect(viewerTitle("Bottle cap", "diagram")).toBe("Bottle cap");
    expect(viewerTitle("Bottle cap", "3d")).toBe("Bottle cap · 3D");
    expect(viewerTitle("Main board", "schematic", "Schematic")).toBe("Main board · Schematic");
  });
});

describe("viewer tab page", () => {
  const config = { path: "cap", view: "diagram", media: "https://file+.vscode-resource/ext/media", dev: { url: "http://127.0.0.1:5181/", session: "s1" } };
  const page = (over: Partial<Parameters<typeof viewerPageHtml>[0]> = {}) =>
    viewerPageHtml({ cspSource: "https://file+.vscode-resource", script: "https://file+.vscode-resource/ext/dist/webview/protoboard-viewer.js", style: "https://file+.vscode-resource/ext/dist/webview/protoboard-viewer.css", nonce: "N0nce", title: "Bottle cap", origins: devOrigins(config.dev.url), config, ...over });

  it("loads the shell the extension ships, frames nothing, and reads only from the dev server", () => {
    const html = page();
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)![1].replace(/&#39;/g, "'");
    expect(csp).toBe(viewerCsp({ cspSource: "https://file+.vscode-resource", nonce: "N0nce", origins: devOrigins(config.dev.url) }));
    expect(csp).toContain("script-src 'nonce-N0nce' https://file+.vscode-resource;");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("connect-src https://file+.vscode-resource http://127.0.0.1:* http://localhost:* data: blob:");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(html).not.toContain("<iframe");
    // one script, by nonce, from the extension; the config is inert JSON
    expect(html.match(/<script type="module"/g)).toHaveLength(1);
    expect(html).toContain('<script type="module" nonce="N0nce" src="https://file+.vscode-resource/ext/dist/webview/protoboard-viewer.js">');
    expect(html).toContain('<script type="application/json" id="protoboard-viewer-config">');
  });

  it("keeps the config from closing its script", () => {
    const html = page({ config: { ...config, path: "</script><script>alert(1)</script>" }, title: "<b>x</b>" });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("is written again only when the server moves where its policy does not reach", () => {
    const loopback = devOrigins();
    expect(originCovered("http://127.0.0.1:5199/", loopback)).toBe(true);
    expect(originCovered("http://localhost:6000/", loopback)).toBe(true);
    expect(originCovered("https://abc-5180.app.github.dev/", loopback)).toBe(false);
    const forwarded = devOrigins("https://abc-5180.app.github.dev/");
    expect(forwarded).toContain("https://abc-5180.app.github.dev");
    expect(originCovered("https://abc-5180.app.github.dev/x", forwarded)).toBe(true);
    expect(originCovered("http://127.0.0.1.evil.example:80/", loopback)).toBe(false);
  });
});

describe("messages from the tab", () => {
  it("are checked field by field", () => {
    expect(parseFromWebview({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:openModule", path: "cap" } })).toEqual({ type: "event", event: { type: "uhd-viewer:openModule", path: "cap" } });
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:openPair", linkId: "cap/l1", a: "cap/board", b: "cap/lid", x: 1 } })).toEqual({ type: "event", event: { type: "uhd-viewer:openPair", linkId: "cap/l1", a: "cap/board", b: "cap/lid" } });
    expect(parseFromWebview({ type: "openView", view: "pair", path: "cap", params: { link: "cap/l1", n: 3 } })).toEqual({ type: "openView", view: "pair", path: "cap", params: { link: "cap/l1" } });
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection: { kind: "link", id: "cap/l1", defId: "cap", x: 1 } } })).toEqual({
      type: "event",
      event: { type: "uhd-viewer:selectionChanged", selection: { kind: "link", id: "cap/l1", defId: "cap" } },
    });
    expect(parseFromWebview({ type: "state", path: "cap", label: "Cap", view: "3d", nodes: 4, views: [{ id: "diagram", title: "Diagram" }, { id: 3 }] })).toEqual({
      type: "state",
      path: "cap",
      label: "Cap",
      view: "3d",
      nodes: 4,
      views: [{ id: "diagram", title: "Diagram" }],
    });
    const layout = { positions: { "": { board: { x: 1, y: 2 } } }, links: { "": { l1: { labelT: 0.4 } } } };
    expect(parseFromWebview({ type: "edit", layout, snapshot: { nodes: { board: { x: 1, y: 2 } }, edges: ["l1"] } })).toEqual({ type: "edit", layout, snapshot: { nodes: { board: { x: 1, y: 2 } }, edges: ["l1"] } });
    expect(parseFromWebview({ type: "theme", vars: { "--vscode-foreground": "#ccc", color: "red" }, classes: ["vscode-dark", 3], themeId: "Protoboard Dark" })).toEqual({
      type: "theme",
      vars: { "--vscode-foreground": "#ccc" },
      classes: ["vscode-dark"],
      themeId: "Protoboard Dark",
    });
  });

  it("refuse anything else", () => {
    for (const m of [
      null,
      "ready",
      { type: "restart" },
      { type: "event", event: { type: "uhd-viewer:focus", path: "x" } },
      { type: "event", event: { type: "uhd-viewer:openModule" } },
      { type: "event", event: { type: "uhd-viewer:openPair", linkId: "l1", a: "x" } },
      { type: "state", path: "x" },
      { type: "edit", layout: { positions: { "": { a: { x: "1", y: 2 } } }, links: {} } },
      { type: "edit", layout: { positions: [] } },
      { type: "openView", view: "pcb" },
    ])
      expect(parseFromWebview(m), JSON.stringify(m)).toBeUndefined();
  });

  it("tell edits from an empty layout", () => {
    expect(hasEdits({ positions: {}, links: {} })).toBe(false);
    expect(hasEdits({ positions: { "": {} }, links: { cap: {} } })).toBe(false);
    expect(hasEdits({ positions: { "": { a: { x: 0, y: 0 } } }, links: {} })).toBe(true);
    expect(hasEdits({ positions: {}, links: { cap: { l: { labelFlip: true } } } })).toBe(true);
  });
});

describe("saving a tab's layout (PB-896)", () => {
  it("folds the edits into the display file the project tracks, as the dev server does", () => {
    const root = join(TMP, "save");
    mkdirSync(join(root, ".protoboard"), { recursive: true });
    const file = displayFile(root);
    expect(file).toBe(join(root, DEFAULT_DISPLAY));
    writeFileSync(file, JSON.stringify({ schema: "uhd.display/v0", diagram: { layouts: { "": { nodes: { board: { x: 0, y: 0 }, case: { x: 300, y: 0 } } } } } }, null, 2) + "\n");
    const r = saveLayout(root, file, { positions: { "": { board: { x: 40, y: 80 } } }, links: { "": { board_flex: { labelT: 0.3 } } } });
    expect(r).toEqual({ file: ".protoboard/display.json", levels: [""], skipped: [] });
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.diagram.layouts[""].nodes.board).toMatchObject({ x: 40, y: 80 });
    expect(saved.diagram.layouts[""].nodes.case).toMatchObject({ x: 300, y: 0 });
    expect(saved.diagram.layouts[""].links.board_flex).toEqual({ labelT: 0.3 });
    // nothing new: nothing written
    const again = saveLayout(root, file, { positions: { "": { board: { x: 40, y: 80 } } }, links: {} });
    expect(again.levels).toEqual([]);
  });

  it("needs the snapshot for a level's first save, and says so without it", () => {
    const root = join(TMP, "first");
    mkdirSync(root, { recursive: true });
    const file = displayFile(root, "layout/display.json");
    expect(file).toBe(join(root, "layout", "display.json"));
    const r = saveLayout(root, file, { positions: { cap: { board: { x: 1, y: 2 } } }, links: {} });
    expect(r.levels).toEqual([]);
    expect(r.skipped[0].level).toBe("cap");
    const ok = saveLayout(root, file, { positions: { cap: { board: { x: 1, y: 2 } } }, links: {} }, { nodes: { board: { x: 1, y: 2 }, lid: { x: 200, y: 0 } }, edges: [] });
    expect(ok.levels).toEqual(["cap"]);
    expect(JSON.parse(readFileSync(file, "utf8")).diagram.layouts.cap.nodes).toMatchObject({ board: { x: 1, y: 2 }, lid: { x: 200, y: 0 } });
  });

  it("never writes outside the project for a reported path, and refuses a broken file", () => {
    expect(displayFile("/p", "../elsewhere.json")).toBe(join("/p", DEFAULT_DISPLAY));
    expect(displayFile("/p", "/etc/display.json")).toBe(join("/p", DEFAULT_DISPLAY));
    const root = join(TMP, "broken");
    mkdirSync(join(root, ".protoboard"), { recursive: true });
    writeFileSync(join(root, DEFAULT_DISPLAY), "{ nope");
    expect(() => saveLayout(root, displayFile(root), { positions: { "": { a: { x: 1, y: 1 } } }, links: {} })).toThrow(/not valid JSON/);
  });

  it("writes a file git tracks: .protoboard/ ignores only its build, cache, local, tools and evals folders", () => {
    const repo = join(HERE, "..", "..", "..");
    const ignored = (path: string) => spawnSync("git", ["check-ignore", "-q", path], { cwd: repo }).status === 0;
    for (const example of ["quadcopter-5in", "smart-bottle", "wearable-watch"]) expect(ignored(`examples/${example}/.protoboard/display.json`), example).toBe(false);
    expect(ignored("examples/smart-bottle/.protoboard/build/resolved.json")).toBe(true);
    // a new project's .gitignore (protoboard init) leaves it tracked too
    const init = readFileSync(join(repo, "packages", "core", "src", "init.ts"), "utf8");
    const gitignore = /"\.gitignore": `([^`]*)`/.exec(init)![1];
    expect(gitignore.split("\\n").filter((l) => l.startsWith(".protoboard"))).toEqual([".protoboard/cache/", ".protoboard/local/", ".protoboard/build/", ".protoboard/tools/", ".protoboard/evals/"]);
  });

  it("keeps unsaved edits in a backup it can read back", () => {
    const layout = { positions: { "": { a: { x: 1, y: 1 } } }, links: {} };
    expect(parseBackup(JSON.stringify({ schema: "protoboard.viewer-backup/v0", layout }))).toEqual({ schema: "protoboard.viewer-backup/v0", layout });
    expect(parseBackup("{}")).toBeUndefined();
    expect(parseBackup("nope")).toBeUndefined();
  });
});

describe("the Inspector's card (PB-895)", () => {
  const index = indexProject(resolved, bundle);
  const nodes = nodeMap(buildTree(index));
  const list = findings(index, resolved.diagnostics);

  it("shows a module: kind and tier chips, findings below it as counts, how many modules are below, its links and findings; the viewer's details show the rest", () => {
    const card = moduleCard(index, nodes.get("i:board")!, list);
    expect(card).toMatchObject({ kind: "module", title: "Main board", path: "board", actions: { focus: true, source: true, operation: true } });
    // design A (PB-1042): "Board · <definition>" under the name; the tier stays a chip
    expect(card.kindLabel).toBe("Board");
    expect(card.subtitle).toBe("mainboard");
    expect(card.chips.map((c) => c.text)).toEqual(["project"]);
    expect(card.summary).toEqual({ children: 2 });
    // the link finding inside the board (an error) and the LED's warning count here
    expect(card.counts.error).toBe(1);
    expect(card.counts.warning).toBeGreaterThanOrEqual(1);
    const titles = card.sections.map((s) => s.title);
    // the checks open, the links closed; a parent lists no children (PB-1088): the summary row counts them
    expect(titles).toEqual(["Checks", "Links"]);
    expect(card.sections.find((s) => s.title === "Links")).toMatchObject({ collapsed: true });
    const checks = card.sections.find((s) => s.title === "Checks")!;
    // every severity, each with its code
    expect(checks.rows[0]).toMatchObject({ tone: "error", code: "UHD_LINK_STATE", action: { type: "finding" } });
    expect(checks.count).toBe(checks.rows.length);
    // the module as the viewer's inspector shows it (its facts, artifacts, interfaces), by its path, with the findings
    // its interface cards show: the link inside the board, by the id the viewer selects it with
    expect(card.details).toMatchObject({ target: { kind: "module", path: "board" }, files: {}, previews: {}, links: [] });
    // its own artifacts only, not its parts' (PB-1063)
    expect(card.details!.artifactsOf).toBe("mainboard");
    expect(card.details!.findings).toContainEqual(expect.objectContaining({ code: "UHD_LINK_STATE", refs: ["board/mcu_led"] }));
  });

  it("leaves a part's interfaces to the viewer's details, and names what they show", () => {
    const card = moduleCard(index, nodes.get("i:board/mcu")!, list);
    expect(card.kindLabel).toBe("Part");
    expect(card.chips.map((c) => c.text)).toEqual(["catalog"]);
    expect(card.sections.map((s) => s.title)).not.toContain("Interfaces");
    expect(card.details?.target).toEqual({ kind: "module", path: "board/mcu" });
    expect(card.details?.artifactsOf).toBe(nodes.get("i:board/mcu")!.defId);
    // without a bundle there are no details to draw
    expect(moduleCard(indexProject(resolved), nodes.get("i:board/mcu")!, list).details).toBeUndefined();
  });

  it("shows the level a tab is on without a focus action", () => {
    const card = moduleCard(index, nodes.get("i:")!, list, true);
    expect(card.kind).toBe("level");
    expect(card.actions.focus).toBe(false);
    // everything below the root counts
    expect(card.counts.error + card.counts.warning + card.counts.info).toBeGreaterThan(3);
  });

  it("shows modules selected together as one card listing them (QA B10)", () => {
    const card = groupCard([nodes.get("i:board/mcu")!, nodes.get("i:board/led")!], list);
    expect(card).toMatchObject({ title: "2 selected", path: "board", actions: { focus: false } });
    expect(card.sections[0]).toMatchObject({ title: "Selected", count: 2 });
    expect(card.sections[0].rows.map((r) => r.action)).toEqual([{ type: "focus", path: "board/mcu" }, { type: "focus", path: "board/led" }]);
    // their findings together, each once
    expect(card.counts.error).toBeGreaterThanOrEqual(moduleCard(index, nodes.get("i:board/mcu")!, list).counts.error);
  });

  it("shows a link by its ends, each leading to its module", () => {
    const card = linkCard(index, "board/mcu_led", list)!;
    expect(card).toMatchObject({ kind: "link", title: "mcu_led", path: "board", linkId: "board:mcu_led", counts: { error: 1 }, actions: { pair: true } });
    expect(card.sections[0].rows).toEqual([
      { icon: "plug", label: "gpio1", detail: "mcu", action: { type: "focus", path: "board/mcu" } },
      { icon: "plug", label: "anode", detail: "led", action: { type: "focus", path: "board/led" } },
    ]);
    // the link on its owner's level, by the ids the viewer selects it with
    expect(card.details?.target).toEqual({ kind: "link", owner: "board", ids: ["board/mcu_led", "board"] });
    expect(linkCard(index, "nowhere/x", list)).toBeUndefined();
  });
});

// ---- the 2026-10-21 QA (B10, B14) and PB-1042: what the viewer tab says, and what the Inspector shows for it
describe("the viewer tab's messages and the Inspector after PB-1042", () => {
  it("takes modules selected together (a box, Shift-click) with every path (QA B10)", () => {
    const m = parseFromWebview({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection: { kind: "node", id: "stack/fc", ids: ["stack/fc", "stack/esc", 3] } } });
    expect(m).toEqual({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection: { kind: "node", id: "stack/fc", ids: ["stack/fc", "stack/esc"] } } });
    // one module is not a group
    const one = parseFromWebview({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection: { kind: "node", id: "stack/fc", ids: ["stack/fc"] } } });
    expect(one).toEqual({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection: { kind: "node", id: "stack/fc" } } });
  });

  it("reads a hierarchy row's menu context, and nothing else, as a module", () => {
    expect(hierarchyRowArg({ webview: "protoboard.viewer", webviewSection: "hierarchy", pbPath: "stack/fc", pbDefId: "fc" })).toEqual({ path: "stack/fc", defId: "fc" });
    expect(hierarchyRowArg({ webviewSection: "hierarchy", pbPath: "" })).toEqual({ path: "" });
    expect(hierarchyRowArg({ webviewSection: "canvas", pbPath: "x" })).toBeUndefined();
    expect(hierarchyRowArg({ key: "i:x" })).toBeUndefined();
    expect(hierarchyRowArg(undefined)).toBeUndefined();
  });

  it("parses the hierarchy report of a tab (tests)", () => {
    expect(parseFromWebview({ type: "hierarchy", open: true, rows: [{ path: "", label: "Drone", kind: "system", current: true }, { path: 3 }] })).toEqual({ type: "hierarchy", open: true, rows: [{ path: "", label: "Drone", kind: "system", current: true }] });
    expect(parseFromWebview({ type: "hierarchy", rows: [] })).toBeUndefined();
    // the tab's width comes with it (a narrow tab folds its panel: the test says at what width)
    expect(parseFromWebview({ type: "hierarchy", open: false, rows: [], width: 294 })).toEqual({ type: "hierarchy", open: false, rows: [], width: 294 });
    expect(parseFromWebview({ type: "hierarchy", open: false, rows: [], width: "wide" })).toEqual({ type: "hierarchy", open: false, rows: [] });
  });

  const quad = join(HERE, "..", "..", "..", "examples", "quadcopter-5in");
  const build = readBuild(quad);
  it.skipIf(!build)("counts the findings of every link a harness run carries on the line's card (QA B14)", () => {
    const index = indexProject(build!.resolved, build!.bundle);
    const list = findings(index, build!.resolved.diagnostics, loadCodeReference(quad));
    // the XT60 lead's line carries battery_plug (XT60) and battery_pads; the viewer selects it as battery_plug,
    // and UHD_PROPULSION_CURRENT names battery_pads
    expect(list.some((f) => f.code === "UHD_PROPULSION_CURRENT" && f.target.linkId === "battery_pads")).toBe(true);
    expect(linkCard(index, "battery_plug", list)!.counts.warning).toBeGreaterThanOrEqual(1);
    expect(linkCard(index, "battery_pads", list)!.counts.warning).toBeGreaterThanOrEqual(1);
  });
});

// ---- round 5 (the 2026-10-08 first builds): tab titles, a tab's source file, the Inspector's way to the code, blank blocks

describe("tab titles for different modules are distinct (item 13)", () => {
  const tab = (path: string, label: string, view = "diagram", root = "/work/larq") => ({ root, path, label, view });

  it("keeps the plain title where nothing else reads the same", () => {
    expect(distinctTitles([tab("", "LARQ cap"), tab("main", "Main board"), tab("main", "Main board", "3d")])).toEqual(["LARQ cap", "Main board", "Main board · 3D"]);
    expect(distinctTitles([])).toEqual([]);
  });

  it("adds the module's place where two modules have one name: the reviewers' two tabs called Main board", () => {
    // a root system named like its board, and the board's own tab
    expect(distinctTitles([tab("", "Main board"), tab("main", "Main board")])).toEqual(["Main board (larq)", "Main board (main)"]);
    // two instances of one part
    expect(distinctTitles([tab("arm_fl/motor", "Motor"), tab("arm_fr/motor", "Motor"), tab("stack", "Stack")])).toEqual(["Motor (arm_fl/motor)", "Motor (arm_fr/motor)", "Stack"]);
    // the view stays last
    expect(distinctTitles([tab("a/board", "Board", "3d"), tab("b/board", "Board", "3d")])).toEqual(["Board (a/board) · 3D", "Board (b/board) · 3D"]);
    const titles = distinctTitles([tab("", "Main board"), tab("main", "Main board"), tab("uv", "UV board"), tab("uv/main", "Main board")]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("leaves two tabs on the same module and view alike, and tells two projects apart by their folder", () => {
    expect(distinctTitles([tab("main", "Main board"), tab("main", "Main board")])).toEqual(["Main board", "Main board"]);
    expect(distinctTitles([tab("main", "Main board", "diagram", "/work/a"), tab("main", "Main board", "diagram", "/work/b")])).toEqual(["Main board (a/main)", "Main board (b/main)"]);
    // a title that differs by view only is not a clash
    expect(distinctTitles([tab("main", "Main board"), tab("uv", "Main board", "3d")])).toEqual(["Main board", "Main board · 3D"]);
  });
});

describe("a tab opened on a part with nothing inside is named after the part, never its parent (item 13)", () => {
  const nodes = [
    { id: "usb", label: "USB-C receptacle" },
    { id: "soc", label: "SoC" },
  ];

  it("is the level for a tab on a module that has one", () => {
    expect(tabModule(["main"], "main", "Main board", nodes)).toEqual({ path: "main", label: "Main board", part: false });
    expect(tabModule([], "", "LARQ cap", nodes)).toEqual({ path: "", label: "LARQ cap", part: false });
    // drilled further in place: the level shown
    expect(tabModule(["main", "soc"], "main", "SoC", [])).toEqual({ path: "main/soc", label: "SoC", part: false });
  });

  it("is the part for a tab opened on one: the viewer shows the level that holds it", () => {
    expect(tabModule(["main"], "main/usb", "Main board", nodes)).toEqual({ path: "main/usb", label: "USB-C receptacle", part: true });
    // a part the level no longer draws keeps its id as a name
    expect(tabModule(["main"], "main/gone", "Main board", nodes)).toEqual({ path: "main/gone", label: "gone", part: true });
    // the tab moved to another branch: the level again
    expect(tabModule(["uv"], "main/usb", "UV board", nodes)).toEqual({ path: "uv", label: "UV board", part: false });
  });
});

describe("from a canvas tab to its source (item 29)", () => {
  const index = indexProject(resolved, bundle);

  it("is the file the module in view is written in, at its line", () => {
    expect(moduleSource(index, "")).toEqual({ file: "src/watch.uhd.ts", line: 10 });
    expect(moduleSource(index, "board")).toEqual({ file: "src/boards/mainboard/mainboard.uhd.ts", line: 5 });
    // a block with no file of its own (written inside the system's file) is that file, at the block's line
    expect(moduleSource(index, "flex")).toEqual({ file: "src/watch.uhd.ts", line: 50 });
    expect(moduleSource(index, "no/such")).toBeUndefined();
  });

  it("takes the header's actions and the part a tab is on from the page, and nothing else", () => {
    for (const action of ["open", "reveal", "copy", "copyRelative"]) expect(parseFromWebview({ type: "source", action })).toEqual({ type: "source", action });
    expect(parseFromWebview({ type: "source", action: "delete" })).toBeUndefined();
    expect(parseFromWebview({ type: "source" })).toBeUndefined();
    const state = { type: "state", path: "main", label: "USB-C receptacle", view: "diagram", nodes: 5, views: [] };
    expect(parseFromWebview({ ...state, at: "main/usb" })).toEqual({ ...state, at: "main/usb" });
    expect(parseFromWebview({ ...state, at: 7 })).toEqual(state);
    expect(parseFromWebview({ ...state, at: "" })).toEqual(state);
  });

  it("offers the tab's commands in its right-click menu, for viewer tabs only", () => {
    const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as { contributes: { commands: { command: string; title: string }[]; menus: Record<string, { command: string; when?: string }[]> } };
    const commands = Object.values(SOURCE_COMMANDS);
    expect(commands).toHaveLength(4);
    for (const c of commands) {
      expect(pkg.contributes.commands.find((x) => x.command === c)?.title, c).toBeTruthy();
      expect(pkg.contributes.menus["editor/title/context"].find((x) => x.command === c)?.when, c).toBe("resourceScheme == protoboard-viewer");
      expect(pkg.contributes.menus.commandPalette.find((x) => x.command === c)?.when, c).toContain("protoboard.viewer");
    }
  });
});

describe("INSPECT from a module's menu (item 5, D6)", () => {
  it("is an event the extension takes from the tab", () => {
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:inspect", path: "main/usb", defId: "usb-c" } })).toEqual({ type: "event", event: { type: "uhd-viewer:inspect", path: "main/usb", defId: "usb-c" } });
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:inspect", path: "main" } })).toEqual({ type: "event", event: { type: "uhd-viewer:inspect", path: "main" } });
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:inspect" } })).toBeUndefined();
  });

  it("has a setting for the reveal on selection, on by default", () => {
    const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as { contributes: { configuration: { properties: Record<string, { type: string; default: unknown }> } } };
    expect(pkg.contributes.configuration.properties["protoboard.inspector.revealOnSelection"]).toMatchObject({ type: "boolean", default: true });
  });
});

describe("the Inspector's way to the code, and blank blocks (items 5, D7)", () => {
  const index = indexProject(resolved, bundle);
  const nodes = nodeMap(buildTree(index));
  const list = findings(index, resolved.diagnostics);

  it("names the file Open source opens: the parent's for an instance, its own for the root and a level", () => {
    expect(moduleSourceFile(index, nodes.get("i:")!)).toEqual({ file: "src/watch.uhd.ts", line: 10 });
    // an instance is declared in its parent's definition (the line is the child's, found when the file is read)
    expect(moduleSourceFile(index, nodes.get("i:board")!)).toEqual({ file: "src/watch.uhd.ts" });
    expect(moduleSourceFile(index, nodes.get("i:board/mcu")!)).toEqual({ file: "src/boards/mainboard/mainboard.uhd.ts" });
    expect(moduleCard(index, nodes.get("i:board/mcu")!, list).source).toEqual({ file: "src/boards/mainboard/mainboard.uhd.ts" });
    expect(moduleCard(index, nodes.get("i:")!, list, true).source).toEqual({ file: "src/watch.uhd.ts", line: 10 });
  });

  it("says Blank block in place of Local on a module with no part chosen, with what that means", () => {
    const blank: typeof resolved = { ...resolved, definitions: resolved.definitions.map((d) => (d.id === "case" ? { ...d, partStatus: { trust: "local" as const, basis: "no part chosen", blank: true } } : d.id === "led" ? { ...d, partStatus: { trust: "local" as const, basis: "not in a library" } } : d)) };
    const idx = indexProject(blank, bundle);
    const tree = nodeMap(buildTree(idx));
    expect(tree.get("i:case")!.blank).toBe(true);
    expect(tree.get("i:spare_led")!.blank).toBeUndefined();
    const chip = (key: string) => moduleCard(idx, tree.get(key)!, []).chips.find((c) => c.status);
    expect(chip("i:case")).toMatchObject({ text: "Blank block", status: "local", blank: true });
    expect(chip("i:case")!.title).toContain("No part chosen yet");
    expect(chip("i:spare_led")).toMatchObject({ text: "Local", status: "local" });
    expect(chip("i:spare_led")!.blank).toBeUndefined();
    // the same chip by hand
    expect(statusChip("local", undefined, true).text).toBe("Blank block");
    expect(statusChip("verified", "independent audit recorded").text).toBe("Verified");
  });
});

describe("the status bar item in words (item 30)", () => {
  it("says what the mark means", () => {
    expect(statusLabel({ error: 2, warning: 1, info: 4 }, "idle")).toBe("Protoboard: 2 errors, 1 warning");
    expect(statusLabel({ error: 0, warning: 3, info: 0 }, "idle")).toBe("Protoboard: 0 errors, 3 warnings");
    expect(statusLabel({ error: 0, warning: 0, info: 9 }, "idle")).toBe("Protoboard: the checks pass, no errors or warnings");
    expect(statusLabel(undefined, "idle")).toBe("Protoboard: not checked yet");
    expect(statusLabel(undefined, "running")).toBe("Protoboard: checking the project");
    expect(statusLabel({ error: 1, warning: 0, info: 0 }, "failed")).toBe("Protoboard: the last check failed");
  });
});

describe("an empty level's Add a part", () => {
  it("is posted by the tab and opens the Library side bar", () => {
    expect(parseFromWebview({ type: "devAction", action: "openLibrary" })).toEqual({ type: "devAction", action: "openLibrary" });
    const shell = readFileSync(join(HERE, "../../web-viewer/src/vscode/Shell.tsx"), "utf8");
    expect(shell).toMatch(/label: "Add a part", onClick: \(\) => bridge\.post\(\{ type: "devAction", action: "openLibrary" \}\)/);
    expect(shell).toMatch(/<DiagramCanvas .*emptyAction=\{addPart\} \/>/);
    const editor = readFileSync(join(HERE, "../src/viewerEditor.ts"), "utf8");
    expect(editor).toMatch(/m\.action === "openLibrary"\) return void vscode\.commands\.executeCommand\("protoboard\.library\.focus"\)/);
    // the command VS Code makes for the Library view: its id in the manifest
    const manifest = JSON.parse(readFileSync(join(HERE, "../package.json"), "utf8")) as { contributes: { views: Record<string, { id: string }[]> } };
    expect(Object.values(manifest.contributes.views).flat().map((v) => v.id)).toContain("protoboard.library");
  });
});

describe("the loading comet", () => {
  const css = readFileSync(join(HERE, "../../web-viewer/src/vscode/styles.css"), "utf8");
  const keyframes = [...(/@keyframes pb-comet-travel \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "").matchAll(/([\d.]+)% \{\s*transform: translate\(([\d.]+)px, ([\d.]+)px\);/g)].map((m) => ({ at: Number(m[1]) / 100, x: Number(m[2]), y: Number(m[3]) }));

  it("runs round the triangle's corners, each reached when that share of the length is run", () => {
    // a frame per corner, and the first again to close the loop
    expect(keyframes).toHaveLength(TRIANGLE.length + 1);
    keyframes.slice(0, -1).forEach((k, i) => {
      expect([k.x, k.y]).toEqual([...TRIANGLE[i]]);
      // the walk the still frame uses puts the same corner at the same time (the CSS rounds to 0.01 %)
      const [x, y] = trianglePoint(k.at);
      expect(Math.hypot(x - k.x, y - k.y)).toBeLessThan(0.1);
    });
    expect(keyframes.at(-1)).toEqual({ at: 1, x: TRIANGLE[0][0], y: TRIANGLE[0][1] });
    expect(css).toMatch(new RegExp(`animation: pb-comet-travel ${COMET_DUR_S}s linear infinite`));
  });

  it("is a head and a tail that fades behind it, standing still under reduced motion", () => {
    const dots = cometDots();
    expect(dots).toHaveLength(COMET_DOTS);
    expect(dots[0]).toMatchObject({ size: 5, opacity: 1, delay: -(COMET_DOTS - 1) * 0.016 });
    for (let i = 1; i < dots.length; i++) expect(dots[i].opacity).toBeLessThan(dots[i - 1].opacity);
    expect(dots.at(-1)!.delay).toBe(-0);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.pb-comet-dot \{\s*animation: none;/);
    // nor do the skeleton's blocks pulse
    expect(readFileSync(join(HERE, "../../web-viewer/src/vscode/Loading.tsx"), "utf8")).toMatch(/animate-pulse [^`]*motion-reduce:animate-none/);
  });

  it("is what a tab shows while it connects and loads; a dev server problem keeps its card", () => {
    const shell = readFileSync(join(HERE, "../../web-viewer/src/vscode/Shell.tsx"), "utf8");
    expect(shell).toMatch(/if \(!status\.problem\) return <LoadingScreen message=\{status\.message\} hierarchy=\{bridge\.hierarchyState\} \/>;/);
  });
});
