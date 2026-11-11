/**
 * R2 integration (2026-11-02): the extension's side of the handoffs applied after the R2 builders finished. The
 * Settings page's Viewer section rows (R2-E's handoff to the views owner), the in-tab BOM's Export CSV through the
 * `exportCsv` hook (the same `download` the anchor interception sends), and the CAD file tab's model info card
 * following `viewer.modelInfo`.
 */
import { describe, expect, it, vi } from "vitest";

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
  return { EventEmitter, Uri: { file: (p: string) => ({ fsPath: p }) }, window: {}, commands: {}, env: {} };
});

const { viewerRows, settingRows } = await import("../src/userSettings.js");
const { extensionPartsData, base64Utf8, safeDownloadName } = await import("../../web-viewer/src/vscode/host-io.js");
const { parseFromWebview } = await import("../../web-viewer/src/vscode/protocol.js");
const { cadViewerHtml } = await import("../src/cadFiles.js");
const { settingsModel } = await import("../src/agents.js");
const { DEFAULT_SETTINGS, SETTING_DEFS } = await import("@protoboardai/core/settings");

describe("the Settings page's Viewer section rows", () => {
  it("one row per setting, with its kind, value, words and whether it is the default", () => {
    const rows = viewerRows({ ...DEFAULT_SETTINGS, "viewer.zoomToCursor": false, "viewer.hoverLongDelayMs": 1500, "tools.stepViewer": "fusion360" }, { env: { HOME: "/h" } });
    expect(rows.map((r) => r.key)).toEqual(SETTING_DEFS.map((d) => d.key));
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by["viewer.openModelsInPlace"]).toMatchObject({ kind: "boolean", value: true, text: "On", isDefault: true });
    expect(by["viewer.zoomToCursor"]).toMatchObject({ kind: "boolean", value: false, text: "Off", isDefault: false });
    expect(by["viewer.hoverLongDelayMs"]).toMatchObject({ kind: "number", value: 1500, text: "1500 ms", isDefault: false, min: 200, max: 5000, unit: "ms" });
    expect(by["tools.stepViewer"]).toMatchObject({ kind: "app", value: "fusion360", text: "Fusion 360", isDefault: false });
    expect(by["files.exportFolder"]).toMatchObject({ kind: "folder", value: null, isDefault: true });
    expect(by["files.exportFolder"].text).toMatch(/^Downloads \(/);
    for (const r of rows) expect(r.icon).toEqual(expect.any(String));
  });

  it("the page's model carries them (and More actions no longer repeats them)", () => {
    const viewer = viewerRows(DEFAULT_SETTINGS);
    const m = settingsModel({ account: { state: "signed-out" } as never, version: "0.2.2", command: { command: "protoboard", args: [] } as never, home: "/h", viewer });
    expect(m.viewer).toHaveLength(SETTING_DEFS.length);
    expect(m.links ?? []).toEqual([]);
    // R2-E's rows form stays available to anything that still lists them
    expect(settingRows(DEFAULT_SETTINGS).map((r) => r.id)).toEqual(SETTING_DEFS.map((d) => `setting:${d.key}`));
  });
});

describe("the in-tab BOM's Export CSV (exportCsv hook)", () => {
  it("posts the file to the extension as a download, UTF-8 base64, with a safe name", () => {
    const posted: unknown[] = [];
    const { data } = extensionPartsData((m) => posted.push(m));
    const text = "Line,Part,Qty\n1,Résistance 10 kΩ,4\n";
    data.exportCsv("quad/copter-bom.csv", text);
    expect(posted).toEqual([{ type: "download", name: "quad-copter-bom.csv", data: base64Utf8(text) }]);
    expect(Buffer.from(base64Utf8(text), "base64").toString("utf8")).toBe(text);
    // the extension's own parse takes it as it takes the anchor interception's
    expect(parseFromWebview(posted[0])).toEqual(posted[0]);
    expect(safeDownloadName("a\\b/c".padEnd(300, "x"))).toHaveLength(200);
    expect(safeDownloadName("a\\b/c")).toBe("a-b-c");
  });
});

describe("the CAD file tab's model info card (viewer.modelInfo)", () => {
  const html = (modelInfo?: boolean) =>
    cadViewerHtml({ script: "s.js", style: "s.css", occt: "o.js", wasm: "o.wasm", model: "m.glb", source: { kind: "glb", file: "/p/m.glb" } as never, name: "m.glb", cspSource: "csp", nonce: "n", ...(modelInfo === undefined ? {} : { modelInfo }) });
  const config = (h: string) => JSON.parse(/window\.pbCad = (\{.*?\});<\/script>/.exec(h)![1]) as Record<string, unknown>;
  it("says modelInfo: false only when the person turned the card off", () => {
    expect(config(html(false)).modelInfo).toBe(false);
    expect("modelInfo" in config(html(true))).toBe(false);
    expect("modelInfo" in config(html())).toBe(false);
  });
});
