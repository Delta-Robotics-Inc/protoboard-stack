/**
 * The live-tab bridge and the 3D view's saved state (PB-1178): the bridge's
 * outcomes (the tab's reply, not-run, may-have-run, a resent batchId),
 * sessions and the default tab; the viewer-state file (merged by scope,
 * written only when it changed) and named views in the display file; and the
 * dev server's routes end to end, with an agent reading a live tab.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRIDGE_KEY_HEADER, BRIDGE_SESSION_HEADER, LiveBridge, parseBatchBody, type BridgeEnvelope } from "../src/dev/bridge.js";
import { connectBridge } from "../src/dev/bridgeClient.js";
import { VIEWER_STATE_FILE, parsePresentation, parseViewerStateFile, presentationToWrite, readViewerState, saveViewerState, withPresentation } from "../src/dev/viewState.js";
import { DEV_RECORD, startDev, type DevRecord, type DevServer } from "../src/dev/server.js";
import { JOURNAL_FILE, Journal } from "../src/dev/journal.js";

// a folder of this run's own (two test processes on one machine must not share one; wave 2 gate), inside the
// repository so the fixture project resolves the workspace's packages
const HERE = fileURLToPath(new URL(".", import.meta.url));
mkdirSync(join(HERE, ".tmp"), { recursive: true });
const TMP = mkdtempSync(join(HERE, ".tmp", "dev-bridge-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const batch = (id: string, ops: unknown[] = []) => ({ batchId: id, label: "read the current view state", ops });
const file = (scopes: Record<string, Record<string, unknown>>, scope = "") => ({ schema: "protoboard.viewer-state/v0" as const, viewState: "uhd-viewer.view-state/v1" as const, scope, scopes });

describe("the bridge: outcomes", () => {
  it("says not-run when no tab is open, and delivers to the tab used last", async () => {
    const b = new LiveBridge();
    const s = b.mintSession("test agent");
    expect(await b.submit(s, { batch: batch("a1") })).toMatchObject({ status: "not-run", batchId: "a1" });
    const got: Record<string, BridgeEnvelope[]> = { one: [], two: [] };
    let t = 1000;
    const timed = new LiveBridge({ now: () => t });
    const s2 = timed.mintSession("x");
    timed.addTab({ id: "one", kind: "web", deliver: (e) => (got.one.push(e), true) });
    t = 2000;
    timed.addTab({ id: "two", kind: "vscode", deliver: (e) => (got.two.push(e), true) });
    t = 3000;
    timed.touch("one");
    const out = timed.submit(s2, { batch: batch("b1") });
    expect(got.one).toHaveLength(1);
    expect(got.two).toHaveLength(0);
    // the tab sees the batch id qualified by the session, and the actor the session names (an agent, never the user)
    expect(got.one[0].batch.batchId).toBe(`${s2.id}:b1`);
    expect(got.one[0].actor).toEqual({ kind: "agent", id: `agent:${s2.id}`, session: s2.id, name: "x" });
    expect(timed.reply(got.one[0].id, { status: "read", seq: 4, state: { selection: { body: "battery" } } }, "one")).toBe(true);
    expect(await out).toMatchObject({ status: "read", seq: 4, tab: "one", batchId: "b1" });
    expect(timed.listTabs().find((x) => x.default)?.id).toBe("one");
  });

  it("answers a resent batchId from memory, and waits on one still in flight", async () => {
    const b = new LiveBridge();
    const s = b.mintSession("x");
    const sent: BridgeEnvelope[] = [];
    b.addTab({ id: "t", kind: "web", deliver: (e) => (sent.push(e), true) });
    const first = b.submit(s, { batch: batch("c1", [{ op: "select", selection: {} }]) });
    const again = b.submit(s, { batch: batch("c1", [{ op: "select", selection: {} }]) });
    expect(sent).toHaveLength(1);
    b.reply(sent[0].id, { status: "applied", seq: 1, applied: [] });
    expect(await first).toMatchObject({ status: "applied", seq: 1 });
    expect(await again).toMatchObject({ status: "applied", seq: 1 });
    expect(await b.submit(s, { batch: batch("c1") })).toMatchObject({ status: "applied", duplicate: true });
    expect(sent).toHaveLength(1);
    // another session's c1 is its own batch
    const other = b.mintSession("y");
    void b.submit(other, { batch: batch("c1") });
    expect(sent).toHaveLength(2);
  });

  it("says may-have-run on a timeout, keeps a late reply for the resend, and not-run when the delivery cannot leave", async () => {
    const b = new LiveBridge();
    const s = b.mintSession("x");
    const sent: BridgeEnvelope[] = [];
    b.addTab({ id: "slow", kind: "web", deliver: (e) => (sent.push(e), true) });
    const out = await b.submit(s, { batch: batch("d1"), timeoutMs: 1000 });
    expect(out).toMatchObject({ status: "may-have-run", batchId: "d1", tab: "slow" });
    // the tab answers late: the resend gets that answer without a second delivery
    expect(b.reply(sent[0].id, { status: "applied", seq: 7, applied: [] })).toBe(true);
    expect(await b.submit(s, { batch: batch("d1") })).toMatchObject({ status: "applied", seq: 7, batchId: "d1" });
    expect(sent).toHaveLength(1);
    // a tab whose stream is gone: not-run, and it is dropped
    b.addTab({ id: "gone", kind: "web", deliver: () => false, lastActive: Date.now() + 1000 });
    expect(await b.submit(s, { batch: batch("d2") })).toMatchObject({ status: "not-run", batchId: "d2" });
    expect(b.listTabs().map((t) => t.id)).toEqual(["slow"]);
    // a tab that closes while a batch waits: may-have-run
    const pending = b.submit(s, { batch: batch("d3") });
    b.removeTab("slow");
    expect(await pending).toMatchObject({ status: "may-have-run", batchId: "d3" });
  }, 10000);

  it("refuses bad batches, keys and tokens", () => {
    expect(parseBatchBody({ batchId: "x", label: "two words", ops: [] })).toMatchObject({ error: /3 to 8 words/ });
    expect(parseBatchBody({ batchId: "bad id!", label: "a b c", ops: [] })).toMatchObject({ error: /batchId/ });
    expect(parseBatchBody({ batchId: "x", label: "a b c", ops: "set" })).toMatchObject({ error: /ops/ });
    expect(parseBatchBody({ batchId: "x", label: "a b c", ops: [], timeoutMs: 5 })).toMatchObject({ error: /timeoutMs/ });
    expect(parseBatchBody({ batchId: "x", label: "a b c", ops: [], expectSeq: 3, tab: "t", observe: true })).toMatchObject({ batch: { expectSeq: 3 }, tab: "t", observe: true });
    const b = new LiveBridge({ key: "k".repeat(43) });
    expect(b.keyMatches("k".repeat(43))).toBe(true);
    expect(b.keyMatches("k".repeat(42))).toBe(false);
    expect(b.keyMatches(undefined)).toBe(false);
    expect(b.session("nope")).toBeUndefined();
    const s = b.mintSession("\u0007weird name");
    expect(s.name).toBe("weird name");
    expect(b.session(s.token)?.id).toBe(s.id);
  });
});

describe("the saved view state and the display file's views", () => {
  it("merges a tab's scopes into viewer-state.json and writes only when it changed", () => {
    const dir = join(TMP, "state");
    mkdirSync(dir, { recursive: true });
    const cam = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] };
    expect(saveViewerState(dir, file({ "": { camera: cam } })).written).toBe(true);
    expect(saveViewerState(dir, file({ "": { camera: cam } })).written).toBe(false);
    expect(saveViewerState(dir, file({ stack: { selection: { body: "stack/fc" } } }, "stack")).written).toBe(true);
    const saved = readViewerState(dir)!;
    expect(Object.keys(saved.scopes).sort()).toEqual(["", "stack"]);
    expect(saved.scope).toBe("stack");
    expect(existsSync(join(dir, VIEWER_STATE_FILE))).toBe(true);
    // only the live keys are kept; a named view never lands here
    const parsed = parseViewerStateFile(file({ "": { camera: cam, namedViews: { A: {} }, bogus: 1 } }));
    expect("error" in parsed ? parsed : parsed.scopes[""]).toEqual({ camera: cam });
    expect(parseViewerStateFile({ schema: "x" })).toMatchObject({ error: /schema/ });
  });

  it("writes annotations to the display file only on an explicit save of them", () => {
    const display = { spatial: { root: "frame", annotations: [{ id: "keep", kind: "mark", ref: "battery", author: "user" }] } };
    const pres = parsePresentation({ namedViews: {}, annotations: [{ id: "a.e.1", kind: "callout", ref: "stack/fc", author: "agent:claude", title: "FC" }] });
    if ("error" in pres) throw new Error(pres.error);
    // an agent's callout in the live view: the file keeps what it holds
    expect(withPresentation(display, presentationToWrite(pres, display, undefined)).changed).toBe(false);
    // saved on purpose
    const saved = withPresentation(display, presentationToWrite(pres, display, true));
    expect(saved.changed).toBe(true);
    expect((saved.display.spatial as { annotations: { id: string }[] }).annotations.map((a) => a.id)).toEqual(["a.e.1"]);
    // records without an author, or too large, are refused
    expect(parsePresentation({ namedViews: {}, annotations: [{ id: "x", kind: "mark", ref: "a" }] })).toMatchObject({ error: expect.stringMatching(/author/) });
    expect(parsePresentation({ namedViews: {}, annotations: [{ id: "x", kind: "mark", ref: "a", author: "u", text: "x".repeat(5000) }] })).toMatchObject({ error: expect.stringMatching(/4096/) });
  });

  it("puts named views in spatial.views only when they changed", () => {
    const view = { camera: { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] } };
    const display = { schema: "uhd.display/v0", spatial: { root: "frame" } };
    const pres = parsePresentation({ namedViews: { Front: view }, annotations: [] });
    if ("error" in pres) throw new Error(pres.error);
    const a = withPresentation(display, pres);
    expect(a.changed).toBe(true);
    expect(a.display.spatial).toEqual({ root: "frame", views: { Front: view } });
    expect(withPresentation(a.display, pres).changed).toBe(false);
    expect(withPresentation(a.display, { views: {}, annotations: [] }).display.spatial).toEqual({ root: "frame" });
    expect(parsePresentation({ namedViews: { Bad: {} } })).toMatchObject({ error: /camera/ });
  });
});

// ---- the dev server end to end ----------------------------------------------------------------------------------

function http(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", fail);
    req.end(body);
  });
}

/** An event stream: its events as they come. */
function stream(port: number, path: string, headers: Record<string, string> = {}) {
  const events: { event: string; data: unknown }[] = [];
  let res: IncomingMessage | undefined;
  const waiters: (() => void)[] = [];
  const req = request({ host: "127.0.0.1", port, path, headers }, (r) => {
    res = r;
    let buf = "";
    r.setEncoding("utf8");
    r.on("data", (c: string) => {
      buf += c;
      let at: number;
      while ((at = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const ev = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        waiters.splice(0).forEach((w) => w());
      }
    });
  });
  req.end();
  const next = async (event: string, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = events.find((e) => e.event === event);
      if (hit) {
        events.splice(events.indexOf(hit), 1);
        return hit.data;
      }
      if (Date.now() > end) throw new Error(`no ${event} event`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  return { next, close: () => (req.destroy(), res?.destroy()) };
}

describe("protoboard dev: the view-state routes and the bridge", () => {
  let dir: string;
  let dev: DevServer;
  let token: string;
  let record: DevRecord;

  beforeAll(async () => {
    dir = join(TMP, "dev-project");
    const write = (rel: string, content: string) => {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), content);
    };
    write("package.json", JSON.stringify({ name: "dev-bridge", private: true, type: "module" }));
    write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "dev-bridge", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
    write("src/sys.uhd.ts", `import type { ModuleDef } from "@deltarobotics/uhd";\nexport const SYS: ModuleDef = { id: "sys", name: "Sys", interfaces: [] };\n`);
    write("viewer-lib/web-viewer.js", "export function mountWebViewer() {}\n");
    write("viewer-lib/web-viewer.css", "body {}\n");
    dev = await startDev({ root: dir, port: 0, viewerLib: join(dir, "viewer-lib"), watch: false, log: () => {} });
    const page = (await http(dev.port, "GET", "/")).body;
    token = JSON.parse(/<script type="application\/json" id="protoboard-dev">(.*?)<\/script>/.exec(page)![1]).token;
    record = JSON.parse(readFileSync(join(dir, DEV_RECORD), "utf8")) as DevRecord;
  }, 60000);
  afterAll(async () => {
    await dev?.close();
  });

  it("writes the record's bridge key, and the page names itself on its stream and answers bridge events", async () => {
    expect(record.bridge?.key).toMatch(/^[\w-]{40,}$/);
    const script = (await http(dev.port, "GET", "/__protoboard/dev.js")).body;
    expect(script).toContain("__protoboard/events?tab=");
    expect(script).toContain('events.addEventListener("bridge"');
    // the reply is posted in parts when it is large (wave 4 gate: page.ts uses viewer.bridgeParts)
    expect(script).toContain("viewer.bridgeParts(envelope)");
    expect(script).toContain("part: { i: m.i, n: m.n, data: m.data }");
    expect(script).toContain("onViewStateChange");
    expect(script).toContain("onPresentationChange");
  });

  it("keeps the page's live view state in viewer-state.json and gives it back on the state route", async () => {
    const json = { "content-type": "application/json" };
    const body = JSON.stringify({ file: file({ "": { selection: { body: "battery" } } }) });
    expect((await http(dev.port, "POST", "/__protoboard/view-state", json, body)).status).toBe(403);
    expect((await http(dev.port, "POST", "/__protoboard/view-state", { ...json, "x-protoboard-dev": token, origin: "http://evil.example" }, body)).status).toBe(403);
    const r = await http(dev.port, "POST", "/__protoboard/view-state", { ...json, "x-protoboard-dev": token }, body);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ written: true, file: ".protoboard/local/viewer-state.json" });
    expect(JSON.parse((await http(dev.port, "POST", "/__protoboard/view-state", { ...json, "x-protoboard-dev": token }, body)).body).written).toBe(false);
    const state = JSON.parse((await http(dev.port, "GET", "/__protoboard/state")).body);
    expect(state.viewState.scopes[""].selection).toEqual({ body: "battery" });
  });

  it("writes named views to the display file on an explicit save, only when they changed", async () => {
    const json = { "content-type": "application/json", "x-protoboard-dev": token };
    const presentation = { namedViews: { Front: { camera: { position: [0, -300, 100], target: [0, 0, 20], up: [0, 0, 1] } } }, annotations: [] };
    const r1 = await http(dev.port, "POST", "/__protoboard/display-views", json, JSON.stringify({ presentation }));
    expect(JSON.parse(r1.body)).toMatchObject({ written: true });
    const display = JSON.parse(readFileSync(join(dir, ".protoboard", "display.json"), "utf8"));
    expect(display.spatial.views.Front.camera.position).toEqual([0, -300, 100]);
    const r2 = await http(dev.port, "POST", "/__protoboard/display-views", json, JSON.stringify({ presentation }));
    expect(JSON.parse(r2.body)).toMatchObject({ written: false });
  });

  it("lets an agent with the key read a live tab through the bridge, and says not-run with no tab", async () => {
    const json = { "content-type": "application/json" };
    // no key, wrong key, a page on another origin: refused
    expect((await http(dev.port, "POST", "/__protoboard/bridge/session", json, "{}")).status).toBe(403);
    expect((await http(dev.port, "POST", "/__protoboard/bridge/session", { ...json, [BRIDGE_KEY_HEADER]: record.bridge!.key, origin: "http://evil.example" }, "{}")).status).toBe(403);
    expect((await http(dev.port, "POST", "/__protoboard/bridge", { ...json, [BRIDGE_SESSION_HEADER]: "nope" }, JSON.stringify(batch("x")))).status).toBe(401);

    const agent = await connectBridge(dir, { name: "test agent" });
    expect(agent.actor.kind).toBe("agent");
    expect(await agent.call(batch("e1"))).toMatchObject({ status: "not-run", batchId: "e1" });
    expect(await agent.call({ batchId: "e0", label: "short", ops: [] })).toMatchObject({ status: "invalid" });

    // a page opens: its stream alone makes no tab (wave 2 gate item 2); its authenticated presence does
    const page = stream(dev.port, "/__protoboard/events?tab=abcdefgh-1234");
    await page.next("hello");
    expect(await agent.tabs()).toEqual([]);
    expect((await http(dev.port, "POST", "/__protoboard/bridge/presence", json, JSON.stringify({ tab: "abcdefgh-1234", active: true }))).status).toBe(403);
    expect((await http(dev.port, "POST", "/__protoboard/bridge/presence", { ...json, "x-protoboard-dev": token, origin: "http://evil.example" }, JSON.stringify({ tab: "abcdefgh-1234", active: true }))).status).toBe(403);
    // a presence naming a tab with no stream of its own makes no tab either
    await http(dev.port, "POST", "/__protoboard/bridge/presence", { ...json, "x-protoboard-dev": token }, JSON.stringify({ tab: "zzzzzzzz-0000", active: true }));
    expect(await agent.tabs()).toEqual([]);
    expect((await http(dev.port, "POST", "/__protoboard/bridge/presence", { ...json, "x-protoboard-dev": token }, JSON.stringify({ tab: "abcdefgh-1234", active: true }))).status).toBe(200);
    expect((await agent.tabs()).map((t) => t.id)).toEqual(["web:abcdefgh-1234"]);
    const pending = agent.call({ ...batch("e2"), observe: true });
    const envelope = (await page.next("bridge")) as BridgeEnvelope;
    expect(envelope).toMatchObject({ type: "uhd-viewer:bridge", batch: { batchId: `${agent.session}:e2`, ops: [] }, actor: agent.actor, observe: true, since: { epoch: "", seq: 0 }, checkpoint: true });
    const entry = { seq: 3, time: 1, actor: { kind: "human", id: "user" }, label: "pick the battery", ops: [{ op: "set", path: ["selection"], value: { body: "battery" } }], inverse: [], keys: ["selection"], touched: { selection: 1 } };
    const answer = {
      status: "read",
      batchId: envelope.batch.batchId,
      seq: 3,
      state: { selection: { body: "battery" }, camera: { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] } },
      log: { epoch: "ep1", entries: [entry] },
      checkpoint: { schema: "uhd-viewer.store-checkpoint/v0", epoch: "ep1", seq: 3, state: { selection: { body: "battery" } }, versions: { selection: 1 }, nextId: 1, retired: [], leases: [] },
    };
    // only the page (its token) or a relay (the key) may answer
    expect((await http(dev.port, "POST", "/__protoboard/bridge/reply", json, JSON.stringify({ id: envelope.id, reply: answer }))).status).toBe(403);
    expect((await http(dev.port, "POST", "/__protoboard/bridge/reply", { ...json, "x-protoboard-dev": token }, JSON.stringify({ id: envelope.id, tab: "abcdefgh-1234", reply: answer }))).status).toBe(204); // no body: an unread body kept a keepalive request counted (the page no longer posts replies with keepalive)
    const out = await pending;
    expect(out).toMatchObject({ status: "read", batchId: "e2", seq: 3, tab: "web:abcdefgh-1234", state: { selection: { body: "battery" } }, logged: 1 });
    // the log is mirrored to the journal, not handed to the agent
    expect(out).not.toHaveProperty("log");
    const lines = readFileSync(join(dir, JOURNAL_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.t, l.epoch, l.seq])).toEqual([["entry", "ep1", 3], ["checkpoint", "ep1", 3]]);
    // the next call asks only for what follows
    const p2 = agent.call(batch("e3"));
    expect(((await page.next("bridge")) as BridgeEnvelope).since).toEqual({ epoch: "ep1", seq: 3 });
    page.close();
    expect(await p2).toMatchObject({ status: "may-have-run" });
  });

  it("relays VS Code tabs through the extension host's stream", async () => {
    const json = { "content-type": "application/json" };
    const relay = stream(dev.port, "/__protoboard/bridge/relay", { [BRIDGE_KEY_HEADER]: record.bridge!.key });
    const { relay: id } = (await relay.next("relay")) as { relay: string };
    const presence = await http(dev.port, "POST", "/__protoboard/bridge/presence", { ...json, [BRIDGE_KEY_HEADER]: record.bridge!.key }, JSON.stringify({ tab: "vscode:tab1", relay: id, label: "Quadcopter · 3D", active: true }));
    expect(presence.status).toBe(200);
    const agent = await connectBridge(dir, { name: "relay test" });
    expect((await agent.tabs()).find((t) => t.default)).toMatchObject({ id: "vscode:tab1", kind: "vscode", label: "Quadcopter · 3D" });
    const pending = agent.call(batch("f1"));
    const { tab, envelope } = (await relay.next("bridge")) as { tab: string; envelope: BridgeEnvelope };
    expect(tab).toBe("vscode:tab1");
    await http(dev.port, "POST", "/__protoboard/bridge/reply", { ...json, [BRIDGE_KEY_HEADER]: record.bridge!.key }, JSON.stringify({ id: envelope.id, tab, reply: { status: "read", seq: 0 } }));
    expect(await pending).toMatchObject({ status: "read", tab: "vscode:tab1", batchId: "f1" });
    relay.close();
  });
});

describe("the bridge: turn-taking, late replies and the journal (W3-A)", () => {
  it("delivers a batch again while the tab says busy, and says not-run when the person keeps dragging", async () => {
    const b = new LiveBridge();
    const s = b.mintSession("x");
    const sent: BridgeEnvelope[] = [];
    b.addTab({ id: "t", kind: "web", deliver: (e) => (sent.push(e), true) });
    const out = b.submit(s, { batch: batch("g1", [{ op: "highlight", paths: ["u3"] }]) });
    await new Promise((r) => setTimeout(r, 5));
    b.reply(sent[0].id, { status: "busy", retryAfterMs: 100 }, "t");
    await new Promise((r) => setTimeout(r, 160));
    expect(sent).toHaveLength(2);
    b.reply(sent[1].id, { status: "applied", seq: 1, applied: [] }, "t");
    expect(await out).toMatchObject({ status: "applied", seq: 1, batchId: "g1" });
    // still dragging at the deadline: nothing ran
    const out2 = b.submit(s, { batch: batch("g2", [{ op: "highlight", paths: [] }]), timeoutMs: 1000 });
    const answerBusy = async () => {
      for (let i = 0; i < 40; i++) {
        const e = sent.at(-1)!;
        b.reply(e.id, { status: "busy", retryAfterMs: 250 }, "t");
        await new Promise((r) => setTimeout(r, 60));
      }
    };
    void answerBusy();
    expect(await out2).toMatchObject({ status: "not-run", batchId: "g2", reason: expect.stringMatching(/dragging/) });
  });

  it("keeps a late reply only from the tab it was sent to, and only when it is a reply", async () => {
    const b = new LiveBridge();
    const s = b.mintSession("x");
    const sent: BridgeEnvelope[] = [];
    b.addTab({ id: "slow", kind: "web", deliver: (e) => (sent.push(e), true) });
    expect(await b.submit(s, { batch: batch("h1"), timeoutMs: 1000 })).toMatchObject({ status: "may-have-run" });
    expect(b.reply(sent[0].id, { status: "applied", seq: 9, applied: [] }, "other")).toBe(false);
    expect(b.reply(sent[0].id, { status: "whatever" }, "slow")).toBe(false);
    expect(b.reply(sent[0].id, { status: "applied", seq: 9, applied: [] }, "slow")).toBe(true);
    expect(await b.submit(s, { batch: batch("h1") })).toMatchObject({ status: "applied", seq: 9, tab: "slow" });
  });

  it("writes the journal from the replies' logs, with checkpoints, and compacts it past its cap", () => {
    const root = mkdtempSync(join(TMP, "journal-"));
    const j = new Journal(root, { maxBytes: 4000, checkpointEvery: 3 });
    expect(j.since("t")).toBeUndefined();
    expect(j.wantCheckpoint("t")).toBe(true);
    const e = (seq: number) => ({ seq, time: seq, actor: { kind: "agent", id: "agent:a" }, label: "highlight the parts now", ops: [{ op: "set", path: ["highlight"], value: [`p${seq}`] }], inverse: [], keys: ["highlight"], touched: { highlight: seq } });
    expect(j.record("t", { log: { epoch: "e1", entries: [e(1), e(2)] } })).toBe(2);
    // a repeat of what it has is not written twice
    expect(j.record("t", { log: { epoch: "e1", entries: [e(2), e(3)] } })).toBe(1);
    expect(j.since("t")).toEqual({ epoch: "e1", seq: 3 });
    expect(j.wantCheckpoint("t")).toBe(true);
    j.record("t", { checkpoint: { epoch: "e1", seq: 3, state: { highlight: ["p3"] }, versions: { highlight: 3 } } });
    expect(j.wantCheckpoint("t")).toBe(false);
    // a reload: a new epoch starts over
    expect(j.record("t", { log: { epoch: "e2", entries: [e(1)] } })).toBe(1);
    expect(j.since("t")).toEqual({ epoch: "e2", seq: 1 });
    for (let i = 2; i < 40; i++) j.record("t", { log: { epoch: "e2", entries: [e(i)] }, ...(i === 30 ? { checkpoint: { epoch: "e2", seq: 30, state: {}, versions: {} } } : {}) });
    const lines = j.read() as { t: string; seq: number; epoch: string }[];
    expect(readFileSync(j.file, "utf8").length).toBeLessThanOrEqual(4000);
    expect(lines[0]).toMatchObject({ t: "checkpoint", epoch: "e2", seq: 30 });
    expect(lines.at(-1)).toMatchObject({ t: "entry", seq: 39 });
    expect(existsSync(join(root, ".protoboard", "local", "scene-oplog.jsonl"))).toBe(true);
    // gate 3: a second compaction keeps the checkpoint at line 0 as its base (it was halved away before)
    for (let i = 40; i < 70; i++) j.record("t", { log: { epoch: "e2", entries: [e(i)] } });
    const again = j.read() as { t: string; seq: number }[];
    expect(readFileSync(j.file, "utf8").length).toBeLessThanOrEqual(4000);
    expect(again[0]).toMatchObject({ t: "checkpoint", seq: 30 });
    expect(again.at(-1)).toMatchObject({ t: "entry", seq: 69 });
  });

  it("never lets an entry rewrite the line's own fields (an entry cannot pass for a checkpoint)", () => {
    const root = mkdtempSync(join(TMP, "journal-forge-"));
    const j = new Journal(root);
    j.record("t", { log: { epoch: "e1", entries: [{ seq: 1, t: "checkpoint", tab: "other", epoch: "x", label: "a forged line here", ops: [] }] } });
    const [line] = j.read() as Record<string, unknown>[];
    expect(line).toMatchObject({ t: "entry", tab: "t", epoch: "e1", seq: 1 });
    expect(readFileSync(j.file, "utf8").startsWith('{"t":"entry"')).toBe(true);
  });
});
