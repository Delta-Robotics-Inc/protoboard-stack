/**
 * The DevTools pipe (wave 2 gate): `--remote-debugging-pipe` framing (NUL-terminated JSON on fds 3/4)
 * against a fake browser made of two streams, the flattened page session over it, the transport
 * choice, and one real launch on this machine (skipped without a Chromium-family browser or with
 * PROTOBOARD_SKIP_RENDER_IT set; it takes the measure lock from the outside when run by hand).
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { findBrowser } from "../src/browser.js";
import { attachPage, cdpRpc, launchBrowser, pipeConnection, requestedTransport } from "../src/cdp.js";

/** A fake browser on the far end of the two pipes: reads NUL-terminated commands, answers with `answer`. */
function fakeChrome(answer: (msg: any, emit: (m: unknown) => void) => unknown) {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const received: any[] = [];
  const raw: string[] = [];
  let rest = "";
  const emit = (m: unknown) => fromChrome.write(`${JSON.stringify(m)}\0`);
  toChrome.on("data", (d: Buffer) => {
    raw.push(d.toString("utf8"));
    rest += d.toString("utf8");
    let i: number;
    while ((i = rest.indexOf("\0")) >= 0) {
      const msg = JSON.parse(rest.slice(0, i));
      rest = rest.slice(i + 1);
      received.push(msg);
      const result = answer(msg, emit);
      if (result !== undefined) emit({ id: msg.id, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}), result });
    }
  });
  return { toChrome, fromChrome, received, raw, emit };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("the DevTools pipe's framing", () => {
  it("one NUL ends each message: split across chunks, several in one chunk, UTF-8 split mid-character", async () => {
    const toChrome = new PassThrough();
    const fromChrome = new PassThrough();
    const conn = pipeConnection(toChrome, fromChrome);
    const got: string[] = [];
    conn.onMessage((t) => got.push(t));
    const two = Buffer.from('{"id":1,"result":{"v":"ü"}}\0{"method":"Page.loadEventFired"}\0{"id":2', "utf8");
    const u = two.indexOf(0xc3);
    fromChrome.write(two.subarray(0, u + 1));
    fromChrome.write(two.subarray(u + 1));
    fromChrome.write(Buffer.from(',"result":{}}\0', "utf8"));
    await tick();
    expect(got.map((t) => JSON.parse(t))).toEqual([{ id: 1, result: { v: "ü" } }, { method: "Page.loadEventFired" }, { id: 2, result: {} }]);
  });
  it("sends each command as one JSON text and a NUL, never a raw NUL inside", async () => {
    const toChrome = new PassThrough();
    const fromChrome = new PassThrough();
    const sent: Buffer[] = [];
    toChrome.on("data", (d: Buffer) => sent.push(d));
    const conn = pipeConnection(toChrome, fromChrome);
    conn.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "'a\u0000b'" } }));
    await tick();
    const all = Buffer.concat(sent);
    expect(all.at(-1)).toBe(0);
    expect(all.subarray(0, -1).includes(0)).toBe(false);
    expect(JSON.parse(all.subarray(0, -1).toString("utf8")).params.expression).toBe("'a\u0000b'");
  });
  it("a message over the cap closes the connection; a closed pipe fails what waits and refuses new sends", async () => {
    const toChrome = new PassThrough();
    const fromChrome = new PassThrough();
    const conn = pipeConnection(toChrome, fromChrome, 64);
    const closed: (Error | undefined)[] = [];
    conn.onClose((why) => closed.push(why));
    fromChrome.write("x".repeat(65));
    await tick();
    expect(conn.open).toBe(false);
    expect(closed[0]?.message).toMatch(/over 64 bytes/);
    expect(() => conn.send("{}")).toThrow(/closed the DevTools connection/);

    const f = fakeChrome(() => undefined);
    const rpc = cdpRpc(pipeConnection(f.toChrome, f.fromChrome));
    const waiting = rpc.raw("Browser.getVersion");
    f.fromChrome.end();
    await expect(waiting).rejects.toThrow(/closed the DevTools connection/);
    await expect(rpc.raw("Browser.getVersion")).rejects.toThrow(/closed the DevTools connection/);
  });
});

describe("a page over the pipe, with a flattened session", () => {
  it("creates a target, attaches with flatten, routes replies by id and events by sessionId", async () => {
    const f = fakeChrome((msg, emit) => {
      if (msg.method === "Target.createTarget") return { targetId: "T1" };
      if (msg.method === "Target.attachToTarget") return { sessionId: "S1" };
      if (msg.method === "Runtime.evaluate") {
        // an exception in another session, then one in ours, then the answer
        emit({ method: "Runtime.exceptionThrown", sessionId: "OTHER", params: { exceptionDetails: { text: "not ours" } } });
        emit({ method: "Runtime.exceptionThrown", sessionId: "S1", params: { exceptionDetails: { text: "ours" } } });
        return { result: { value: 42 } };
      }
      if (msg.method === "Page.navigate") {
        setTimeout(() => emit({ method: "Page.loadEventFired", sessionId: "S1", params: {} }), 5);
        return { frameId: "F" };
      }
      if (msg.method === "Page.captureScreenshot") return { data: Buffer.from("png!").toString("base64") };
      return {};
    });
    const page = await attachPage(cdpRpc(pipeConnection(f.toChrome, f.fromChrome)), { echoErrors: false });
    expect(f.received[0]).toMatchObject({ method: "Target.createTarget", params: { url: "about:blank" } });
    expect(f.received[1]).toMatchObject({ method: "Target.attachToTarget", params: { targetId: "T1", flatten: true } });
    expect(f.received.slice(2).every((m) => m.sessionId === "S1")).toBe(true);
    expect(await page.evaluate<number>("6 * 7")).toBe(42);
    expect(page.takeErrors()).toEqual(["ours"]);
    await page.navigate("http://127.0.0.1:1/");
    expect((await page.screenshot()).toString()).toBe("png!");
    // every command went out as one NUL-terminated JSON text
    expect(f.raw.join("").split("\0").filter(Boolean).every((t) => JSON.parse(t).id > 0)).toBe(true);
  });
});

describe("the transport choice", () => {
  it("pipe by default; PROTOBOARD_CDP_TRANSPORT wins over the caller", () => {
    expect(requestedTransport(undefined, {})).toBe("pipe");
    expect(requestedTransport("port", {})).toBe("port");
    expect(requestedTransport("pipe", { PROTOBOARD_CDP_TRANSPORT: "PORT" })).toBe("port");
    expect(requestedTransport("port", { PROTOBOARD_CDP_TRANSPORT: "pipe" })).toBe("pipe");
    expect(requestedTransport(undefined, { PROTOBOARD_CDP_TRANSPORT: "ws" })).toBe("pipe");
  });
});

const skip = !findBrowser() || !!process.env.PROTOBOARD_SKIP_RENDER_IT;
describe.skipIf(skip)("a real browser over the pipe", () => {
  it("starts, evaluates, captures and closes with no DevTools port; the port fallback still works", async () => {
    const saved = process.env.PROTOBOARD_CDP_TRANSPORT;
    delete process.env.PROTOBOARD_CDP_TRANSPORT;
    try {
      const b = await launchBrowser({ backend: "swiftshader", echoErrors: false, purpose: "cdp-pipe test" });
      try {
        expect(b.backend.transport).toBe("pipe");
        expect(b.backend.transportFallback).toBeUndefined();
        expect(b.backend.product).toMatch(/Chrome|Edg|Brave/i);
        expect(b.alive()).toBe(true);
        expect(await b.evaluate<number>("6 * 7")).toBe(42);
        await b.setViewport(64, 48);
        const png = await b.screenshot();
        expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
        expect(png.readUInt32BE(16)).toBe(64);
      } finally {
        await b.close();
      }
      expect(b.alive()).toBe(false);
      const p = await launchBrowser({ backend: "swiftshader", echoErrors: false, transport: "port" });
      try {
        expect(p.backend.transport).toBe("port");
        expect(await p.evaluate<string>("typeof document")).toBe("object");
      } finally {
        await p.close();
      }
    } finally {
      if (saved !== undefined) process.env.PROTOBOARD_CDP_TRANSPORT = saved;
    }
  }, 120000);
});
