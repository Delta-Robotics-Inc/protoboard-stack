/**
 * The extension host's part in the 3D view's state and the live-tab bridge
 * (PB-1178): the webview messages (view state, named views, bridge replies,
 * openModule on 3D), the relay of a project's tabs, and the saved files.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseFromWebview, parseViewerStateFile } from "../../web-viewer/src/vscode/protocol.js";
import { ProjectRelay, readViewerState, saveTabViewState, savePresentation, type RelayTransport } from "../src/viewerBridge.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/viewer-bridge");
rmSync(TMP, { recursive: true, force: true });
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const stateFile = (scopes: Record<string, Record<string, unknown>>) => ({ schema: "protoboard.viewer-state/v0", viewState: "uhd-viewer.view-state/v1", scope: "", scopes });

describe("webview messages for the 3D view's state", () => {
  it("checks view state, presentation, bridge replies and openModule on 3D", () => {
    expect(parseFromWebview({ type: "viewState", file: stateFile({ "": { camera: {} } }) })).toMatchObject({ type: "viewState" });
    expect(parseFromWebview({ type: "viewState", file: { schema: "x" } })).toBeUndefined();
    expect(parseFromWebview({ type: "presentation", presentation: { namedViews: { A: {} }, annotations: [] } })).toMatchObject({ type: "presentation" });
    expect(parseFromWebview({ type: "presentation", presentation: { namedViews: [] } })).toBeUndefined();
    expect(parseFromWebview({ type: "bridgeReply", id: "d1", reply: { status: "read" } })).toEqual({ type: "bridgeReply", id: "d1", reply: { status: "read" } });
    expect(parseFromWebview({ type: "bridgeReply", id: 3, reply: {} })).toBeUndefined();
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:openModule", path: "stack/fc", view: "3d" } })).toEqual({ type: "event", event: { type: "uhd-viewer:openModule", path: "stack/fc", view: "3d" } });
    expect(parseFromWebview({ type: "event", event: { type: "uhd-viewer:openModule", path: "stack/fc", view: "pcb" } })).toEqual({ type: "event", event: { type: "uhd-viewer:openModule", path: "stack/fc" } });
    expect(parseViewerStateFile(stateFile({ "": {} }))?.scope).toBe("");
  });
});

describe("the files the extension host writes", () => {
  it("saves a tab's live state per scope, and named views through the dev server or into the display file", async () => {
    const root = join(TMP, "p1");
    mkdirSync(join(root, ".protoboard"), { recursive: true });
    expect(saveTabViewState(root, stateFile({ "": { selection: { body: "battery" } } }) as never)).toBe(true);
    expect(saveTabViewState(root, stateFile({ "": { selection: { body: "battery" } } }) as never)).toBe(false);
    expect(readViewerState(root)?.scopes[""]).toEqual({ selection: { body: "battery" } });
    // no dev server: the display file is written here, and only when the views changed
    writeFileSync(join(root, ".protoboard", "display.json"), JSON.stringify({ schema: "uhd.display/v0", spatial: { root: "frame" } }, null, 2) + "\n");
    const pres = { namedViews: { Front: { camera: { position: [0, -1, 0], target: [0, 0, 0], up: [0, 0, 1] } } }, annotations: [] };
    expect(await savePresentation(root, pres)).toEqual({ written: true, via: "file" });
    expect(JSON.parse(readFileSync(join(root, ".protoboard", "display.json"), "utf8")).spatial).toEqual({ root: "frame", views: pres.namedViews });
    expect(await savePresentation(root, pres)).toEqual({ written: false, via: "file" });
    // a dev server running: it writes (it owns the file and rebuilds)
    mkdirSync(join(root, ".protoboard", "local"), { recursive: true });
    writeFileSync(join(root, ".protoboard", "local", "dev.json"), JSON.stringify({ url: "http://127.0.0.1:5999/", session: "s", bridge: { key: "k" } }));
    const posted: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const transport: RelayTransport = { post: async (url, headers, body) => (posted.push({ url, headers, body }), { status: 200, body: { written: true } }), stream: () => () => {} };
    expect(await savePresentation(root, pres, { transport })).toEqual({ written: true, via: "dev" });
    expect(posted[0]).toMatchObject({ url: "http://127.0.0.1:5999/__protoboard/display-views", headers: { "x-protoboard-bridge-key": "k" } });
  });
});

describe("the bridge relay of a project's tabs", () => {
  it("announces its tabs, delivers batches into the right tab, and posts replies with the key", async () => {
    const root = join(TMP, "p2");
    mkdirSync(join(root, ".protoboard", "local"), { recursive: true });
    writeFileSync(join(root, ".protoboard", "local", "dev.json"), JSON.stringify({ url: "http://127.0.0.1:5998/", session: "s", bridge: { key: "key2" } }));
    let onEvent: ((e: string, d: unknown) => void) | undefined;
    let closeStream: (() => void) | undefined;
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    const transport: RelayTransport = {
      post: async (url, _h, body) => (posts.push({ url, body: body as Record<string, unknown> }), { status: 200, body: {} }),
      stream: (url, headers, ev, close) => {
        expect(url).toBe("http://127.0.0.1:5998/__protoboard/bridge/relay");
        expect(headers["x-protoboard-bridge-key"]).toBe("key2");
        onEvent = ev;
        closeStream = close;
        return () => {};
      },
    };
    const relay = new ProjectRelay(root, transport);
    const got: Record<string, unknown>[] = [];
    relay.add({ id: "vscode:a", label: "Drone · 3D", active: true, deliver: (r) => got.push(r) });
    expect(onEvent).toBeDefined();
    onEvent!("relay", { relay: "relay:1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(posts[0]).toMatchObject({ url: "http://127.0.0.1:5998/__protoboard/bridge/presence", body: { tab: "vscode:a", relay: "relay:1", label: "Drone · 3D", active: true } });
    expect(relay.connected).toBe(true);
    onEvent!("bridge", { tab: "vscode:a", envelope: { type: "uhd-viewer:bridge", id: "d1" } });
    expect(got).toEqual([{ type: "uhd-viewer:bridge", id: "d1" }]);
    await relay.reply("vscode:a", "d1", { status: "read", seq: 2 });
    expect(posts.at(-1)).toMatchObject({ url: "http://127.0.0.1:5998/__protoboard/bridge/reply", body: { id: "d1", tab: "vscode:a", reply: { status: "read", seq: 2 } } });
    // a batch for a tab this relay no longer has: the server is told it closed
    onEvent!("bridge", { tab: "vscode:gone", envelope: { id: "d2" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(posts.at(-1)?.body).toMatchObject({ tab: "vscode:gone", closed: true });
    relay.remove("vscode:a");
    await new Promise((r) => setTimeout(r, 0));
    expect(posts.at(-1)?.body).toMatchObject({ tab: "vscode:a", closed: true });
    closeStream?.();
    relay.dispose();
  });
});
