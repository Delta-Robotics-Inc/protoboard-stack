/**
 * R2-E (walkthrough F1, J1, G2, G3; 2026-11-02): the host side of navigation in place (the protocol's new messages,
 * the tab's own back and forward, the extension's in-place decision), the settings in the extension, the preferred
 * STEP viewer, export and the page's download hand-off.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// the parts of the VS Code API the modules under test touch
const ui = { picks: [] as unknown[], warnings: [] as unknown[], info: [] as string[], executed: [] as unknown[][], opened: [] as string[] };
vi.mock("vscode", () => {
  class EventEmitter<T> {
    private ls = new Set<(v: T) => void>();
    event = (l: (v: T) => void) => (this.ls.add(l), { dispose: () => this.ls.delete(l) });
    fire(v: T) {
      for (const l of this.ls) l(v);
    }
    dispose() {
      this.ls.clear();
    }
  }
  return {
    EventEmitter,
    Uri: { file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }), parse: (u: string) => ({ toString: () => u }) },
    window: {
      showQuickPick: async () => ui.picks.shift(),
      showWarningMessage: async () => ui.warnings.shift(),
      showInformationMessage: async (m: string) => (ui.info.push(m), undefined),
      showOpenDialog: async () => undefined,
      showInputBox: async () => undefined,
    },
    commands: { executeCommand: async (...a: unknown[]) => (ui.executed.push(a), undefined) },
    env: { openExternal: async (u: { toString(): string }) => (ui.opened.push(u.toString()), true) },
  };
});

const { parseFromWebview, parseViewerSettings, DEFAULT_VIEWER_SETTINGS } = await import("../../web-viewer/src/vscode/protocol.js");
const { backGoesTo, emptyTabHistory, forwardGoesTo, parseTabHistory, recordMove, stepTab, tabRecords, MAX_TAB_HISTORY } = await import("../../web-viewer/src/vscode/tab-history.js");
const { applyHubSettings, extensionPartsData, interceptDownloads } = await import("../../web-viewer/src/vscode/host-io.js");
const { cardOpensModule, clickWantsNewTab, decideNavigate } = await import("../src/navigation.js");
const { stepLaunch, openStepFile, ONSHAPE_URL } = await import("../src/stepViewer.js");
const { UserSettings, settingRows, settingText, viewerSettingsOf } = await import("../src/userSettings.js");
const { downloadParts, exportWhat, writeExport } = await import("../src/exportFiles.js");
const { appHtml, POINTER_SCRIPT } = await import("../src/appPage.js");
const { DEFAULT_SETTINGS, SETTING_DEFS, agentActor, setSetting } = await import("@protoboardai/core/settings");

const dirs: string[] = [];
const tmp = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), `pb-r2e-${name}-`));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

describe("protocol (R2-E)", () => {
  it("relays R2-A's navigate and history events, checked", () => {
    const nav = { type: "event", event: { type: "uhd-viewer:navigate", target: { module: "cube/panel_3" }, how: "replace", view: "3d", from: "" } };
    expect(parseFromWebview(nav)).toEqual(nav);
    const model = { type: "event", event: { type: "uhd-viewer:navigate", target: { model: { defId: "usb-c", artifactId: "vendor_step", path: "board/j1" } }, how: "newTab" } };
    expect(parseFromWebview(model)).toEqual(model);
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:navigate", target: { module: "x" }, how: "sideways" } })).toBeUndefined();
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:navigate", target: { model: { defId: "", artifactId: "a" } }, how: "replace" } })).toBeUndefined();
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:navigate", target: { module: "a\u0000b" }, how: "replace" } })).toBeUndefined();
    const h = parseFromWebview({ type: "event", event: { type: "uhd-viewer:history", index: 1, length: 2, canBack: true, canForward: false, entries: [{ scope: "", label: "System", kind: "open" }, { scope: "arm", label: "Arm", kind: "drill" }, { scope: 1, label: "bad", kind: "open" }] } });
    expect(h).toEqual({ type: "event", event: { type: "uhd-viewer:history", index: 1, length: 2, canBack: true, canForward: false, entries: [{ scope: "", label: "System", kind: "open" }, { scope: "arm", label: "Arm", kind: "drill" }] } });
  });

  it("takes the export event for R2-B's toolbar button", () => {
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:export", format: "png" } })).toEqual({ type: "event", event: { type: "uhd-viewer:export", format: "png" } });
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:export", format: "step", target: "arm_fl/motor" } })).toMatchObject({ event: { target: "arm_fl/motor" } });
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:export", format: "exe" } })).toBeUndefined();
  });

  it("checks the BOM's requests, downloads and the header's history state", () => {
    expect(parseFromWebview({ type: "parts", ask: 3, op: "bom" })).toEqual({ type: "parts", ask: 3, op: "bom" });
    expect(parseFromWebview({ type: "parts", ask: 3, op: "deleteEverything" })).toBeUndefined();
    expect(parseFromWebview({ type: "parts", ask: 1.5, op: "bom" })).toBeUndefined();
    expect(parseFromWebview({ type: "download", name: "drone-bom.csv", data: "YSxi" })).toEqual({ type: "download", name: "drone-bom.csv", data: "YSxi" });
    expect(parseFromWebview({ type: "download", name: "../../evil.csv", data: "YSxi" })).toBeUndefined();
    expect(parseFromWebview({ type: "download", name: "x.csv", data: "not base64!" })).toBeUndefined();
    expect(parseFromWebview({ type: "historyState", back: true, forward: false })).toEqual({ type: "historyState", back: true, forward: false });
  });

  it("reads viewer settings with the defaults for anything wrong", () => {
    expect(parseViewerSettings(undefined)).toEqual(DEFAULT_VIEWER_SETTINGS);
    expect(parseViewerSettings({ openModelsInPlace: false, hoverLongDelayMs: 99999, zoomToCursor: "no" })).toEqual({ ...DEFAULT_VIEWER_SETTINGS, openModelsInPlace: false, hoverLongDelayMs: 5000 });
    expect(viewerSettingsOf(DEFAULT_SETTINGS)).toEqual(DEFAULT_VIEWER_SETTINGS);
  });
});

describe("the tab's own back and forward (R2-E, F1)", () => {
  const d = (path: string) => ({ path, view: "diagram" });
  const t = (path: string) => ({ path, view: "3d" });
  it("remembers view changes and levels outside 3D; 3D levels are the viewer's", () => {
    expect(tabRecords(d(""), t(""))).toBe(true);
    expect(tabRecords(d(""), d("arm"))).toBe(true);
    expect(tabRecords(t(""), t("arm"))).toBe(false);
    // a viewer from before R2-A keeps no 3D history: the tab remembers 3D levels itself
    expect(tabRecords(t(""), t("arm"), false)).toBe(true);
    expect(recordMove(emptyTabHistory(), t(""), t("arm"), false).back).toEqual([t("")]);
    let h = emptyTabHistory();
    h = recordMove(h, d(""), d("arm"));
    h = recordMove(h, d("arm"), t("arm"));
    h = recordMove(h, t("arm"), t("arm/motor"));
    expect(h.back).toEqual([d(""), d("arm")]);
    expect(h.forward).toEqual([]);
  });

  it("goes back through the viewer's 3D history first, then the tab's; forward the other way", () => {
    let h = recordMove(recordMove(emptyTabHistory(), d(""), { path: "", view: "bom" }), { path: "", view: "bom" }, t(""));
    const here = t("arm");
    expect(backGoesTo("3d", { canBack: true, canForward: false }, h, here)).toBe("viewer");
    expect(backGoesTo("3d", { canBack: false, canForward: false }, h, here)).toBe("tab");
    // on another view the viewer's history is never used
    expect(backGoesTo("bom", { canBack: true, canForward: false }, h, { path: "", view: "bom" })).toBe("tab");
    const s = stepTab(h, t(""), -1)!;
    expect(s.to).toEqual({ path: "", view: "bom" });
    h = s.history;
    expect(h.forward).toEqual([t("")]);
    expect(forwardGoesTo("bom", null, h, { path: "", view: "bom" })).toBe("tab");
    expect(forwardGoesTo("3d", { canBack: true, canForward: true }, emptyTabHistory(), t(""))).toBe("viewer");
    expect(backGoesTo("diagram", null, emptyTabHistory(), d(""))).toBe("none");
  });

  it("skips a place equal to where the tab is, caps the lists, and reads a kept history safely", () => {
    const h = { back: [d("a"), d("b")], forward: [] };
    expect(stepTab(h, d("b"), -1)!.to).toEqual(d("a"));
    let big = emptyTabHistory();
    for (let i = 0; i < 80; i++) big = recordMove(big, d(`p${i}`), d(`p${i + 1}`));
    expect(big.back).toHaveLength(MAX_TAB_HISTORY);
    expect(parseTabHistory({ back: [d("x"), { path: 1 }, "y"], forward: "nope" })).toEqual({ back: [d("x")], forward: [] });
  });
});

describe("in place or a new tab (R2-E, F1)", () => {
  it("decides by the request and the setting", () => {
    expect(decideNavigate({ target: { module: "cube/panel" }, how: "replace" }, true)).toEqual({ kind: "go", path: "cube/panel", view: "3d" });
    expect(decideNavigate({ target: { module: "cube/panel" }, how: "replace" }, false)).toEqual({ kind: "tab", path: "cube/panel", view: "3d" });
    expect(decideNavigate({ target: { module: "cube/panel" }, how: "newTab" }, true)).toEqual({ kind: "tab", path: "cube/panel", view: "3d" });
    expect(decideNavigate({ target: { model: { defId: "j", artifactId: "step" } }, how: "replace" }, true)).toEqual({ kind: "model", defId: "j", artifactId: "step", sameGroup: true });
    expect(decideNavigate({ target: { model: { defId: "j", artifactId: "step" } }, how: "newTab" }, true)).toMatchObject({ sameGroup: false });
  });

  it("opens a card's body model as the module's 3D view, other files as files", () => {
    expect(cardOpensModule({ role: "body", format: "step", resolved: "C:/p/src/modules/grill/out/body.step" })).toBe(true);
    expect(cardOpensModule({ format: "glb", resolved: "/p/src/modules/board/out/board.glb" })).toBe(true);
    expect(cardOpensModule({ role: "print", format: "stl", resolved: "/p/cad/grill.stl" })).toBe(false);
    expect(cardOpensModule({ role: "datasheet", format: "pdf", resolved: "/p/ds.pdf" })).toBe(false);
    expect(cardOpensModule({ format: "step", resolved: "/p/vendor/usb-c-3d.step" })).toBe(false);
  });

  it("reads a Ctrl+click from the Inspector page's pointer message", () => {
    expect(clickWantsNewTab({ newTab: true, at: 1000 }, 1500)).toBe(true);
    expect(clickWantsNewTab({ newTab: true, at: 1000 }, 4000)).toBe(false);
    expect(clickWantsNewTab({ newTab: false, at: 1000 }, 1100)).toBe(false);
    expect(clickWantsNewTab(undefined)).toBe(false);
    // the page script shares the app's one VS Code API and tells each click's modifiers first
    const html = appHtml({ screen: "inspector", title: "Inspector", cspSource: "vscode-resource:", script: "s.js", style: "s.css", nonce: "n0", pointerModifiers: true });
    expect(html).toContain(POINTER_SCRIPT);
    expect(html.indexOf(POINTER_SCRIPT)).toBeLessThan(html.indexOf('src="s.js"'));
    expect(appHtml({ screen: "library", title: "L", cspSource: "x", script: "s.js", style: "s.css", nonce: "n0" })).not.toContain("protoboard:pointer");
  });
});

describe("settings in the extension (R2-E, J1)", () => {
  it("lists every setting as a Settings page row with its value and button", () => {
    const rows = settingRows({ ...DEFAULT_SETTINGS, "viewer.openModelsInPlace": false, "tools.stepViewer": "fusion360" }, { env: { HOME: "/h" } });
    expect(rows.map((r) => r.id)).toEqual(SETTING_DEFS.map((d) => `setting:${d.key}`));
    expect(rows[0]).toMatchObject({ label: "Open models in place: Off", action: "Turn On", command: "protoboard.settings.edit", args: ["viewer.openModelsInPlace"] });
    expect(rows.find((r) => r.id === "setting:tools.stepViewer")!.label).toBe("STEP files open with: Fusion 360");
    expect(rows.find((r) => r.id === "setting:viewer.hoverLongDelayMs")!.label).toBe("Long hover delay (ms): 900 ms");
    expect(settingText(SETTING_DEFS.find((d) => d.key === "files.exportFolder")!, DEFAULT_SETTINGS)).toMatch(/^Downloads \(/);
  });

  it("changes a setting as the person and tells the listeners; picks up a change made elsewhere", () => {
    const home = tmp("settings");
    const place = { env: { PROTOBOARD_HOME: home } as NodeJS.ProcessEnv };
    const us = new UserSettings(log, place);
    const seen: boolean[] = [];
    us.onDidChange((v) => seen.push(v["viewer.openModelsInPlace"]));
    us.set("viewer.openModelsInPlace", false);
    expect(us.viewer.openModelsInPlace).toBe(false);
    expect(readFileSync(join(home, "settings-changes.jsonl"), "utf8")).toContain('"actor":"person (VS Code)"');
    // an agent's change through core, then the watch's reload
    setSetting("viewer.openModelsInPlace", true, agentActor("claude-code"), place);
    us.reload();
    expect(seen).toEqual([false, true]);
    us.dispose();
  });
});

describe("the preferred STEP viewer (R2-E, G2)", () => {
  const win = { platform: "win32" as const, env: { LOCALAPPDATA: "C:\\Users\\k\\AppData\\Local", ProgramFiles: "C:\\Program Files" } };
  it("finds the applications where they install", () => {
    const files = new Set([
      "C:\\Users\\k\\AppData\\Local\\Autodesk\\webdeploy\\production\\aaa\\FusionLauncher.exe",
      "C:\\Users\\k\\AppData\\Local\\Autodesk\\webdeploy\\production\\bbb\\FusionLauncher.exe",
      "C:\\Program Files\\KiCad\\9.0\\bin\\kicad.exe",
      "C:\\Program Files\\KiCad\\8.0\\bin\\kicad.exe",
      "C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCAD.exe",
    ]);
    const list = (dir: string) => (dir.endsWith("production") ? ["aaa", "bbb"] : dir.endsWith("KiCad") ? ["8.0", "9.0"] : ["Common Files", "FreeCAD 1.0"]);
    const o = { ...win, exists: (p: string) => files.has(p), list, mtime: (p: string) => (p.includes("bbb") ? 2 : 1) };
    expect(stepLaunch("fusion360", "C:\\m\\body.step", o)).toEqual({ kind: "exec", command: "C:\\Users\\k\\AppData\\Local\\Autodesk\\webdeploy\\production\\bbb\\FusionLauncher.exe", args: ["C:\\m\\body.step"], app: "Fusion 360" });
    expect(stepLaunch("kicad", "f.step", o)).toMatchObject({ kind: "exec", command: "C:\\Program Files\\KiCad\\9.0\\bin\\kicad.exe" });
    expect(stepLaunch("freecad", "f.step", o)).toMatchObject({ kind: "exec", command: "C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCAD.exe" });
    expect(stepLaunch("onshape", "f.step", o)).toEqual({ kind: "url", url: ONSHAPE_URL, app: "Onshape (browser)" });
    expect(stepLaunch("system", "f.step", o)).toEqual({ kind: "system" });
    expect(stepLaunch("protoboard", "f.step", o)).toEqual({ kind: "protoboard" });
    expect(stepLaunch("fusion360", "f.step", { ...win, exists: () => false, list: () => [] })).toMatchObject({ kind: "missing" });
    expect(stepLaunch("C:\\Tools\\viewer.exe", "f.step", { ...o, exists: (p) => p === "C:\\Tools\\viewer.exe" })).toEqual({ kind: "exec", command: "C:\\Tools\\viewer.exe", args: ["f.step"], app: "C:\\Tools\\viewer.exe" });
    expect(stepLaunch("fusion360", "/m/f.step", { platform: "darwin" })).toEqual({ kind: "exec", command: "open", args: ["-a", "Autodesk Fusion", "/m/f.step"], app: "Fusion 360" });
    expect(stepLaunch("kicad", "/m/f.step", { platform: "linux" })).toMatchObject({ command: "kicad" });
  });

  it("asks once when unset, keeps the answer, and opens with it", async () => {
    let choice: string | null = null;
    const done: string[] = [];
    const host = { log, choice: () => choice, choose: (v: string) => void (choice = v), openInViewer: async () => void done.push("viewer"), openSystem: async () => void done.push("system") };
    ui.picks.push({ id: "system", label: "System default" });
    expect(await openStepFile({ fsPath: "/m/body.step" } as never, host)).toBe("system");
    expect(choice).toBe("system");
    // asked no more: the kept answer opens it
    expect(await openStepFile({ fsPath: "/m/body.step" } as never, host)).toBe("system");
    expect(done).toEqual(["system", "system"]);
    // dismissed: nothing opens (no system "Select an app" chooser), nothing kept
    choice = null;
    ui.picks.push(undefined);
    expect(await openStepFile({ fsPath: "/m/body.step" } as never, host)).toBe("none");
    expect(choice).toBeNull();
    expect(done).toEqual(["system", "system"]);
  });

  it("asks the person before it runs an executable an agent chose", async () => {
    const home = tmp("step");
    const place = { env: { PROTOBOARD_HOME: home } as NodeJS.ProcessEnv };
    const exe = join(home, "viewer.exe");
    writeFileSync(exe, "");
    setSetting("tools.stepViewer", exe, agentActor("some-agent"), place);
    const done: string[] = [];
    const host = { log, place, choice: () => exe, choose: () => undefined, openInViewer: async () => void done.push("viewer"), openSystem: async () => void done.push("system") };
    ui.warnings.push(undefined); // the person says no
    expect(await openStepFile({ fsPath: "/m/body.step" } as never, host)).toBe("system");
    expect(done).toEqual(["system"]);
  });
});

describe("export and downloads (R2-E, G3)", () => {
  it("writes to the export folder under a free name", () => {
    const folder = join(tmp("export"), "Downloads");
    const now = new Date(2026, 10, 2);
    const a = writeExport(folder, "quadcopter-5in", "3d", "png", new Uint8Array([1, 2, 3]), now);
    const b = writeExport(folder, "quadcopter-5in", "3d", "png", new Uint8Array([4]), now);
    expect(a.endsWith("quadcopter-5in-3d-2026-11-02.png")).toBe(true);
    expect(b.endsWith("quadcopter-5in-3d-2026-11-02-2.png")).toBe(true);
    expect([...readFileSync(a)]).toEqual([1, 2, 3]);
    expect(downloadParts("drone-bom.csv")).toEqual({ what: "drone-bom", ext: "csv" });
    expect(exportWhat("arm_fl/motor", "3d")).toBe("motor");
    expect(exportWhat("", "3d")).toBe("3d");
  });

  it("hands a page's download to the extension instead of the browser", async () => {
    const posted: unknown[] = [];
    let original = 0;
    const proto = { click: () => void original++ };
    const restore = interceptDownloads((m) => void posted.push(m), proto);
    const blob = new Blob(["a,b\n1,2\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    proto.click.call({ download: "drone-bom.csv", href: url } as never);
    proto.click.call({ download: "", href: "https://example.com/" } as never);
    await new Promise((r) => setTimeout(r, 50));
    expect(original).toBe(1);
    expect(posted).toEqual([{ type: "download", name: "drone-bom.csv", data: Buffer.from("a,b\n1,2\n").toString("base64") }]);
    restore();
    URL.revokeObjectURL(url);
  });

  it("asks the extension for the BOM and matches the answers to the asks", async () => {
    const posted: { ask: number; op: string }[] = [];
    const { data, answer } = extensionPartsData((m) => void posted.push(m as never));
    const bom = data.bom!();
    const save = data.saveBom!({ units: 3 });
    expect(posted.map((p) => p.op)).toEqual(["bom", "saveBom"]);
    answer({ type: "partsAnswer", ask: posted[1].ask, ok: false, error: "no build" });
    answer({ type: "partsAnswer", ask: posted[0].ask, ok: true, value: { units: 1 } });
    await expect(bom).resolves.toEqual({ units: 1 });
    await expect(save).rejects.toThrow("no build");
    await expect(data.search({} as never)).rejects.toThrow(/Library side bar/);
  });

  it("applies zoom to the pointer through the view hub, now and for a view mounted later", () => {
    const calls: unknown[] = [];
    const win = { __uhdViewHub: { controls: (o: unknown) => calls.push(o) } } as Record<string, unknown>;
    applyHubSettings({ ...DEFAULT_VIEWER_SETTINGS, zoomToCursor: false }, win);
    expect(calls).toEqual([{ zoomToCursor: false }]);
    expect((win.__uhdViewHub as { controlOptions: unknown }).controlOptions).toEqual({ zoomToCursor: false });
    expect(() => applyHubSettings(DEFAULT_VIEWER_SETTINGS, {})).not.toThrow();
    expect(existsSync).toBeDefined();
  });
});

// wave R2 gate (2026-11-02): the review's export and STEP-program findings
describe("wave R2 gate: export and STEP programs", () => {
  it("downloads only data and picture files, and never overwrites a file", async () => {
    expect(downloadParts("drone-bom.CSV")).toEqual({ what: "drone-bom", ext: "csv" });
    for (const bad of ["x.exe", "x.bat", "x.lnk", "x.hta", "x.cmd", "x.ps1", "noext"]) expect(downloadParts(bad), bad).toBeUndefined();
    const folder = tmp("wx");
    const now = new Date("2026-11-02T10:00:00");
    // a file that is there already under the first free name the check would pick is kept, the next name taken
    const a = writeExport(folder, "p", "3d", "png", new Uint8Array([1]), now);
    expect([...readFileSync(a)]).toEqual([1]);
    const b = writeExport(folder, "p", "3d", "png", new Uint8Array([2]), now);
    expect(b).not.toBe(a);
    expect([...readFileSync(a)]).toEqual([1]);
  });

  it("runs an executable only after the person confirmed it, whoever set it, and again when it changed", async () => {
    const { isTrustedProgram, trustProgram } = await import("../src/stepViewer.js");
    const home = tmp("trust");
    const place = { env: { PROTOBOARD_HOME: home } as NodeJS.ProcessEnv };
    const exe = join(home, "viewer.exe");
    writeFileSync(exe, "a");
    // set from the CLI (an agent with a shell would look like this): still asked
    setSetting("tools.stepViewer", exe, "cli", place);
    const mem = new Map<string, unknown>();
    const store = { get: <T>(k: string) => mem.get(k) as T | undefined, update: (k: string, v: unknown) => void mem.set(k, v) };
    const done: string[] = [];
    const host = { log, place, choice: () => exe, choose: () => undefined, trusted: (e: string) => isTrustedProgram(store, e), trust: (e: string) => trustProgram(store, e), openInViewer: async () => void done.push("viewer"), openSystem: async () => void done.push("system") };
    ui.warnings.push(undefined); // the person says no
    expect(await openStepFile({ fsPath: "/m/body.step" } as never, host)).toBe("system");
    expect(isTrustedProgram(store, exe)).toBe(false);
    trustProgram(store, exe);
    expect(isTrustedProgram(store, exe)).toBe(true);
    // the program replaced on disk: no longer the one confirmed
    writeFileSync(exe, "a different program");
    expect(isTrustedProgram(store, exe)).toBe(false);
  });
});
