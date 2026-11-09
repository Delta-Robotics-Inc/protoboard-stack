/**
 * Security review of the wire transport: hand-built frames over raw sockets against `serveBoard` on an in-memory
 * board, and against a bare `WsConnection` for the limits the server does not expose. One test (or a small group)
 * per finding in the review section of docs/specs/pcb-editor/board-cli.md.
 */
import { randomBytes } from "node:crypto";
import { connect, createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createDocument } from "../src/document.js";
import { openBoardService, type BoardService } from "../src/service.js";
import { BOARD_PROTOCOL, RPC_ERRORS, TOKEN_PROTOCOL_PREFIX } from "../src/transport/protocol.js";
import { isLoopback, serveBoard, type BoardServer, type ServeOptions } from "../src/transport/server.js";
import { isValidCloseCode, utf8Prefix, WsConnection, type WsConnectionOptions } from "../src/transport/ws.js";

// ---------------------------------------------------------------- helpers

interface Frame {
  fin: boolean;
  rsv: number;
  opcode: number;
  masked: boolean;
  payload: Buffer;
}

async function until(cond: () => boolean, ms = 2000, what = "condition") {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A client frame: masked unless told otherwise, the shortest length form unless one is forced. */
function frame(opcode: number, payload: Buffer | string = Buffer.alloc(0), o: { fin?: boolean; mask?: boolean; rsv?: number; form?: 7 | 16 | 64 } = {}): Buffer {
  const p = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const n = p.length;
  const form = o.form ?? (n < 126 ? 7 : n < 65536 ? 16 : 64);
  const head = Buffer.alloc(form === 7 ? 2 : form === 16 ? 4 : 10);
  head[0] = ((o.fin ?? true) ? 0x80 : 0) | ((o.rsv ?? 0) << 4) | opcode;
  const maskBit = (o.mask ?? true) ? 0x80 : 0;
  if (form === 7) head[1] = maskBit | n;
  else if (form === 16) {
    head[1] = maskBit | 126;
    head.writeUInt16BE(n, 2);
  } else {
    head[1] = maskBit | 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  if (!(o.mask ?? true)) return Buffer.concat([head, p]);
  const key = randomBytes(4);
  const body = Buffer.alloc(n);
  for (let i = 0; i < n; i++) body[i] = p[i] ^ key[i & 3];
  return Buffer.concat([head, key, body]);
}
const text = (s: string, o: Parameters<typeof frame>[2] = {}) => frame(0x1, s, o);
const closeFrame = (code?: number, reason: Buffer | string = "") => {
  if (code === undefined) return frame(0x8);
  const r = typeof reason === "string" ? Buffer.from(reason) : reason;
  const p = Buffer.alloc(2 + r.length);
  p.writeUInt16BE(code, 0);
  r.copy(p, 2);
  return frame(0x8, p);
};
const req = (id: number, method = "board.presence", extra: Record<string, unknown> = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, ...extra });

/** The client end of a raw WebSocket: parses the server's frames, answers nothing unless told to. */
class Peer {
  readonly frames: Frame[] = [];
  private buf = Buffer.alloc(0);
  private cursor = 0;
  ended = false;
  closed = false;
  autoPong = false;
  constructor(readonly socket: Socket, leftover: Buffer = Buffer.alloc(0)) {
    socket.on("data", (d: Buffer) => this.feed(d));
    socket.on("end", () => (this.ended = true));
    socket.on("close", () => (this.closed = true));
    socket.on("error", () => {});
    if (leftover.length) this.feed(leftover);
  }
  private feed(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const masked = (this.buf[1] & 0x80) !== 0;
      let len = this.buf[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        at = 10;
      }
      if (masked) at += 4;
      if (this.buf.length < at + len) return;
      const f: Frame = { fin: (this.buf[0] & 0x80) !== 0, rsv: (this.buf[0] >> 4) & 7, opcode: this.buf[0] & 0x0f, masked, payload: Buffer.from(this.buf.subarray(at, at + len)) };
      this.buf = this.buf.subarray(at + len);
      this.frames.push(f);
      if (this.autoPong && f.opcode === 0x9) this.send(frame(0xa, f.payload));
    }
  }
  send(b: Buffer) {
    if (!this.socket.destroyed) this.socket.write(b);
  }
  /** The next frame (after those already taken) that matches. */
  async next(pred: (f: Frame) => boolean = () => true, ms = 2000): Promise<Frame> {
    let found: Frame | undefined;
    await until(
      () => {
        for (let i = this.cursor; i < this.frames.length; i++)
          if (pred(this.frames[i])) {
            found = this.frames[i];
            this.cursor = i + 1;
            return true;
          }
        return false;
      },
      ms,
      "a frame",
    );
    return found!;
  }
  async reply(ms = 2000): Promise<any> {
    return JSON.parse((await this.next((f) => f.opcode === 0x1, ms)).payload.toString("utf8"));
  }
  /** The server's close frame: its code (undefined for an empty one) and reason. */
  async closeCode(ms = 2000): Promise<number | undefined> {
    const f = await this.next((x) => x.opcode === 0x8, ms);
    return f.payload.length >= 2 ? f.payload.readUInt16BE(0) : undefined;
  }
  async gone(ms = 2000) {
    await until(() => this.closed, ms, "the socket to close");
  }
}

/** Send an upgrade request (plus `extra` bytes in the same write); the status, and the peer when it was 101. */
async function handshake(port: number, token: string, headers: Record<string, string | undefined> = {}, extra?: Buffer, opts: { allowHalfOpen?: boolean } = {}): Promise<{ status: number; peer?: Peer; socket: Socket }> {
  const all: Record<string, string | undefined> = {
    Host: `127.0.0.1:${port}`,
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
    "Sec-WebSocket-Version": "13",
    Authorization: `Bearer ${token}`,
    ...headers,
  };
  const lines = ["GET / HTTP/1.1", ...Object.entries(all).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`)];
  const socket = connect({ host: "127.0.0.1", port, allowHalfOpen: opts.allowHalfOpen ?? false });
  socket.setNoDelay(true);
  socket.on("error", () => {});
  return new Promise((done, fail) => {
    let acc = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      acc = Buffer.concat([acc, d]);
      const end = acc.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.off("data", onData);
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(acc.subarray(0, end).toString("latin1"))?.[1] ?? 0);
      if (status !== 101) {
        socket.destroy();
        return done({ status, socket });
      }
      done({ status, socket, peer: new Peer(socket, acc.subarray(end + 4)) });
    };
    socket.on("data", onData);
    socket.once("close", () => done({ status: 0, socket }));
    socket.once("connect", () => {
      const head = Buffer.from(lines.join("\r\n") + "\r\n\r\n", "latin1");
      socket.write(extra ? Buffer.concat([head, extra]) : head);
    });
    setTimeout(() => fail(new Error("no answer to the upgrade")), 3000).unref();
  });
}

const open: { svc?: BoardService; server?: BoardServer; sockets: Socket[]; nets: Server[] } = { sockets: [], nets: [] };
afterEach(async () => {
  for (const s of open.sockets.splice(0)) s.destroy();
  for (const n of open.nets.splice(0)) await new Promise((r) => n.close(r));
  await open.server?.close();
  open.svc?.close({ save: false });
  open.server = undefined;
  open.svc = undefined;
});

/** serveBoard on an empty in-memory board. */
async function serve(opts: ServeOptions = {}) {
  const svc = openBoardService({ document: createDocument([]) });
  const server = await serveBoard(svc, { serviceFile: false, ...opts });
  open.svc = svc;
  open.server = server;
  return server;
}
async function peerOf(server: BoardServer, headers: Record<string, string | undefined> = {}, extra?: Buffer, opts: { allowHalfOpen?: boolean } = {}): Promise<Peer> {
  const r = await handshake(server.port, server.token, headers, extra, opts);
  open.sockets.push(r.socket);
  expect(r.status).toBe(101);
  return r.peer!;
}
async function statusOf(server: BoardServer, headers: Record<string, string | undefined>): Promise<number> {
  const r = await handshake(server.port, server.token, headers);
  open.sockets.push(r.socket);
  return r.status;
}

/** A bare WsConnection on a plain TCP socket (no handshake), for limits serveBoard does not expose. */
async function pair(opts: Partial<WsConnectionOptions> = {}, client: { allowHalfOpen?: boolean } = {}) {
  const state: { conn?: WsConnection; closedWith?: [number, string]; messages: string[] } = { messages: [] };
  const net = createServer((s) => {
    s.on("error", () => {});
    state.conn = new WsConnection(s, { maxMessageBytes: 1 << 20, onMessage: (t) => state.messages.push(t), onClose: (code, reason) => (state.closedWith = [code, reason]), ...opts });
  });
  open.nets.push(net);
  await new Promise<void>((r) => net.listen(0, "127.0.0.1", r));
  const port = (net.address() as { port: number }).port;
  const socket = connect({ host: "127.0.0.1", port, allowHalfOpen: client.allowHalfOpen ?? false });
  open.sockets.push(socket);
  await new Promise((r) => socket.once("connect", r));
  await until(() => !!state.conn, 2000, "the server side");
  return { state, peer: new Peer(socket), conn: state.conn! };
}

// ---------------------------------------------------------------- 1. frame parsing limits

describe("1. frame headers and the receive buffer", () => {
  it("reads all three length forms (7-bit, 16-bit, 64-bit)", async () => {
    const server = await serve();
    const p = await peerOf(server);
    p.send(text(req(1)));
    expect((await p.reply()).id).toBe(1);
    p.send(text(req(2, "board.presence", { pad: "x".repeat(300) })));
    expect((await p.reply()).id).toBe(2);
    p.send(text(req(3, "board.presence", { pad: "x".repeat(70_000) })));
    expect((await p.reply()).id).toBe(3);
  });

  it("refuses a 64-bit length with its top bit set (1002)", async () => {
    const server = await serve();
    const p = await peerOf(server);
    const head = Buffer.from([0x81, 0x80 | 127, 0x80, 0, 0, 0, 0, 0, 0, 5]);
    p.send(head);
    expect(await p.closeCode()).toBe(1002);
  });

  it("refuses lengths not in their shortest form (1002)", async () => {
    const server = await serve();
    const a = await peerOf(server);
    a.send(text("{}", { form: 16 }));
    expect(await a.closeCode()).toBe(1002);
    const b = await peerOf(server);
    b.send(text("{}", { form: 64 }));
    expect(await b.closeCode()).toBe(1002);
  });

  it("refuses an oversized frame from its header alone, before any payload arrives (1009)", async () => {
    const server = await serve({ maxMessageBytes: 100_000 });
    const p = await peerOf(server);
    const head = Buffer.alloc(14);
    head[0] = 0x81;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(10_000_000n, 2);
    p.send(head); // no payload is ever sent
    expect(await p.closeCode()).toBe(1009);
    await p.gone();
  });

  it("reassembles frames split byte by byte and several frames in one write", async () => {
    const server = await serve();
    const p = await peerOf(server);
    const f = text(req(7));
    for (const byte of f) {
      p.send(Buffer.from([byte]));
      await new Promise((r) => setImmediate(r));
    }
    expect((await p.reply()).id).toBe(7);
    p.send(Buffer.concat([text(req(8)), text(req(9)), text(req(10))]));
    expect([(await p.reply()).id, (await p.reply()).id, (await p.reply()).id]).toEqual([8, 9, 10]);
  });

  it("takes a 2 MiB message in 1 KiB writes without copying the buffer per chunk", async () => {
    const server = await serve();
    const p = await peerOf(server);
    const f = text(req(11, "board.presence", { pad: "y".repeat(2 * 1024 * 1024) }));
    const t0 = Date.now();
    for (let i = 0; i < f.length; i += 1024) p.send(f.subarray(i, i + 1024));
    expect((await p.reply(5000)).id).toBe(11);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------- 2. fragmentation

describe("2. fragmentation", () => {
  it("allows control frames between fragments and delivers the whole message", async () => {
    const server = await serve();
    const p = await peerOf(server);
    const msg = req(20);
    p.send(Buffer.concat([text(msg.slice(0, 10), { fin: false }), frame(0x9, "mid"), frame(0x0, msg.slice(10, 20), { fin: false }), frame(0xa, "x"), frame(0x0, msg.slice(20))]));
    const pong = await p.next((f) => f.opcode === 0xa);
    expect(pong.payload.toString()).toBe("mid");
    expect((await p.reply()).id).toBe(20);
  });

  it("refuses a continuation without a message and a new message inside a fragmented one (1002)", async () => {
    const server = await serve();
    const a = await peerOf(server);
    a.send(frame(0x0, "{}"));
    expect(await a.closeCode()).toBe(1002);
    const b = await peerOf(server);
    b.send(Buffer.concat([text("{", { fin: false }), text("}")]));
    expect(await b.closeCode()).toBe(1002);
  });

  it("applies the size limit across fragments (1009)", async () => {
    const server = await serve({ maxMessageBytes: 1000 });
    const p = await peerOf(server);
    p.send(Buffer.concat([text("x".repeat(600), { fin: false }), frame(0x0, "y".repeat(600))]));
    expect(await p.closeCode()).toBe(1009);
  });

  it("limits the fragments of one message, empty ones included (1008)", async () => {
    const server = await serve();
    const p = await peerOf(server);
    const many = [text("", { fin: false })];
    for (let i = 0; i < 1024; i++) many.push(frame(0x0, Buffer.alloc(0), { fin: false }));
    p.send(Buffer.concat(many));
    expect(await p.closeCode()).toBe(1008);
  });

  it("fails a fragmented message that never finishes (1008 after the deadline)", async () => {
    const { peer, state } = await pair({ fragmentTimeoutMs: 100 });
    peer.send(text("{", { fin: false }));
    expect(await peer.closeCode()).toBe(1008);
    expect(state.messages).toEqual([]);
  });
});

// ---------------------------------------------------------------- 3. masking

describe("3. masking", () => {
  it("refuses an unmasked client frame (1002) and never masks its own frames", async () => {
    const server = await serve();
    const p = await peerOf(server);
    p.send(text(req(30)));
    await p.reply();
    p.send(text(req(31), { mask: false }));
    expect(await p.closeCode()).toBe(1002);
    expect(p.frames.length).toBeGreaterThan(1);
    expect(p.frames.every((f) => !f.masked && f.rsv === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------- 4. close handling

describe("4. close handling", () => {
  it("knows which close codes a peer may send (RFC 6455 section 7.4)", () => {
    for (const bad of [0, 999, 1004, 1005, 1006, 1015, 1016, 2000, 2999, 5000, 65535]) expect(isValidCloseCode(bad), String(bad)).toBe(false);
    for (const ok of [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 3000, 4000, 4999]) expect(isValidCloseCode(ok), String(ok)).toBe(true);
  });

  it("refuses a one-byte close payload and invalid codes (1002)", async () => {
    const server = await serve();
    const a = await peerOf(server);
    a.send(frame(0x8, Buffer.from([0x03])));
    expect(await a.closeCode()).toBe(1002);
    for (const code of [999, 1005, 1006, 1015, 2999]) {
      const p = await peerOf(server);
      p.send(closeFrame(code));
      expect(await p.closeCode(), String(code)).toBe(1002);
    }
  });

  it("refuses a close reason that is not UTF-8 (1007)", async () => {
    const server = await serve();
    const p = await peerOf(server);
    p.send(closeFrame(1000, Buffer.from([0xc3, 0x28])));
    expect(await p.closeCode()).toBe(1007);
  });

  it("echoes a valid code, answers an empty close with an empty one, ends the socket and frees the slot", async () => {
    const server = await serve();
    const a = await peerOf(server);
    a.send(closeFrame(4000, "bye"));
    expect(await a.closeCode()).toBe(4000);
    await a.gone();
    const b = await peerOf(server);
    b.send(closeFrame());
    expect(await b.closeCode()).toBeUndefined();
    await b.gone();
    await until(() => server.connections() === 0);
  });

  it("ignores data that follows a close frame", async () => {
    const server = await serve();
    const p = await peerOf(server);
    p.send(Buffer.concat([closeFrame(1000), text(req(40))]));
    expect(await p.closeCode()).toBe(1000);
    await p.gone();
    expect(p.frames.filter((f) => f.opcode === 0x1)).toEqual([]);
  });

  it("destroys a socket whose peer never answers our close frame", async () => {
    const { peer, conn, state } = await pair({ closeTimeoutMs: 100 }, { allowHalfOpen: true });
    const t0 = Date.now();
    conn.close(1000, "done");
    expect(await peer.closeCode()).toBe(1000);
    // the peer keeps its side open and never answers: the server's socket is destroyed after the timeout
    await until(() => !!state.closedWith, 2000, "the server side to close");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(80);
    expect(state.closedWith![0]).toBe(1006);
    await until(() => peer.ended || peer.closed, 2000, "the peer to see the end");
  });

  it("keeps a long close reason within a control frame without splitting a character", async () => {
    expect(utf8Prefix("é".repeat(100), 123).length).toBe(122);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(utf8Prefix("€".repeat(60), 123))).not.toThrow();
    const { peer, conn } = await pair();
    conn.close(1001, "é".repeat(100));
    const f = await peer.next((x) => x.opcode === 0x8);
    expect(f.payload.length).toBeLessThanOrEqual(125);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(f.payload.subarray(2))).toBe("é".repeat(61));
  });

  it("drops a client that half-closes its side without a close frame", async () => {
    const server = await serve();
    const p = await peerOf(server, {}, undefined, { allowHalfOpen: true });
    await until(() => server.connections() === 1);
    p.socket.end();
    await until(() => server.connections() === 0);
    await p.gone();
  });
});

// ---------------------------------------------------------------- 5. ping and pong

describe("5. ping and pong", () => {
  it("answers a ping with its payload and ignores an unsolicited pong", async () => {
    const server = await serve();
    const p = await peerOf(server);
    p.send(frame(0xa, "unasked"));
    p.send(frame(0x9, "hello"));
    expect((await p.next((f) => f.opcode === 0xa)).payload.toString()).toBe("hello");
    p.send(text(req(50)));
    expect((await p.reply()).id).toBe(50);
    expect(p.frames.some((f) => f.opcode === 0x8)).toBe(false);
  });

  it("refuses a control frame over 125 bytes or fragmented (1002)", async () => {
    const server = await serve();
    const a = await peerOf(server);
    a.send(frame(0x9, Buffer.alloc(126)));
    expect(await a.closeCode()).toBe(1002);
    const b = await peerOf(server);
    b.send(frame(0x9, "x", { fin: false }));
    expect(await b.closeCode()).toBe(1002);
  });

  it("rate-limits pings (1008)", async () => {
    const server = await serve();
    const p = await peerOf(server);
    p.send(Buffer.concat(Array.from({ length: 60 }, () => frame(0x9))));
    expect(await p.closeCode()).toBe(1008);
    expect(p.frames.filter((f) => f.opcode === 0xa).length).toBe(50);
  });

  it("keepalive: drops a client that stops answering, keeps one that answers", async () => {
    const server = await serve({ keepaliveMs: 60 });
    const live = await peerOf(server);
    live.autoPong = true;
    const dead = await peerOf(server);
    await dead.next((f) => f.opcode === 0x9, 1000);
    await dead.gone(2000);
    await sleep(250);
    expect(live.closed).toBe(false);
    expect(server.connections()).toBe(1);
  });
});

// ---------------------------------------------------------------- 6. Host and Origin

describe("6. Host and Origin (DNS rebinding)", () => {
  it("accepts only the loopback names with this server's port, in any case", async () => {
    const server = await serve();
    const port = server.port;
    expect(await statusOf(server, { Host: `127.0.0.1:${port}` })).toBe(101);
    expect(await statusOf(server, { Host: `LOCALHOST:${port}` })).toBe(101);
    expect(await statusOf(server, { Host: `[::1]:${port}` })).toBe(101);
    for (const host of [`evil.example:${port}`, `127.0.0.1:${port + 1}`, "127.0.0.1", `localhost.:${port}`, `127.0.0.1.evil.example:${port}`]) expect(await statusOf(server, { Host: host }), host).toBe(403);
    expect(await statusOf(server, { Host: undefined })).not.toBe(101);
  });

  it("matches Origin exactly against the configured list and never allows null", async () => {
    const server = await serve({ origins: ["HTTP://127.0.0.1:5180/", "null"] });
    expect(await statusOf(server, { Origin: "http://127.0.0.1:5180" })).toBe(101);
    expect(await statusOf(server, {})).toBe(101); // not a browser
    for (const origin of ["null", "http://127.0.0.1:5180/", "http://127.0.0.1:5181", "http://127.0.0.1:5180.evil.example", "https://127.0.0.1:5180", "", "http://127.0.0.1:5180, http://evil.example"]) expect(await statusOf(server, { Origin: origin }), origin).toBe(403);
  });
});

// ---------------------------------------------------------------- 7. token

describe("7. token", () => {
  it("refuses a wrong token of any length and takes the right one as a header or a subprotocol", async () => {
    const server = await serve();
    const t = server.token;
    const flipped = (t[0] === "a" ? "b" : "a") + t.slice(1);
    for (const bad of [flipped, t.slice(0, -1), t + "0", "x"]) expect(await statusOf(server, { Authorization: `Bearer ${bad}` })).toBe(401);
    expect(await statusOf(server, { Authorization: undefined })).toBe(401);
    expect(await statusOf(server, {})).toBe(101);
    expect(await statusOf(server, { Authorization: undefined, "Sec-WebSocket-Protocol": `${BOARD_PROTOCOL}, ${TOKEN_PROTOCOL_PREFIX}${t}` })).toBe(101);
    expect(await statusOf(server, { Authorization: undefined, "Sec-WebSocket-Protocol": `${BOARD_PROTOCOL}, ${TOKEN_PROTOCOL_PREFIX}${flipped}` })).toBe(401);
  });
});

// ---------------------------------------------------------------- 8. loopback

describe("8. loopback only", () => {
  it("serves on 127.0.0.1 and knows loopback peers from others", async () => {
    const server = await serve();
    expect(server.url).toBe(`ws://127.0.0.1:${server.port}/`);
    for (const a of ["127.0.0.1", "127.5.6.7", "::1", "::ffff:127.0.0.1"]) expect(isLoopback(a), a).toBe(true);
    for (const a of [undefined, "", "10.0.0.1", "::ffff:10.0.0.1", "0.0.0.0", "::", "128.0.0.1", "127.0.0.1.evil", "fe80::1"]) expect(isLoopback(a), String(a)).toBe(false);
  });
});

// ---------------------------------------------------------------- 9. message size and batches

describe("9. message size and batches", () => {
  it("closes on a message over the limit (1009)", async () => {
    const server = await serve({ maxMessageBytes: 1000 });
    const p = await peerOf(server);
    p.send(text("x".repeat(1001)));
    expect(await p.closeCode()).toBe(1009);
  });

  it("takes batches of 1 to 64 requests and refuses others", async () => {
    const server = await serve();
    const p = await peerOf(server);
    const batch = (n: number) => `[${Array.from({ length: n }, (_, i) => req(i + 1)).join(",")}]`;
    p.send(text(batch(64)));
    expect((await p.reply()).length).toBe(64);
    p.send(text(batch(65)));
    expect((await p.reply()).error.code).toBe(RPC_ERRORS.invalidRequest);
    p.send(text("[]"));
    expect((await p.reply()).error.code).toBe(RPC_ERRORS.invalidRequest);
    // a batch of notifications gets no reply at all
    p.send(text(`[${JSON.stringify({ jsonrpc: "2.0", method: "board.presence" })}]`));
    p.send(text(req(99)));
    expect((await p.reply()).id).toBe(99);
  });
});

// ---------------------------------------------------------------- 10. slow clients and connection counts

describe("10. slow clients and connection counts", () => {
  it("drops a client that does not read once its unsent bytes pass the limit", async () => {
    const { peer, conn, state } = await pair({ maxSendBufferBytes: 256 * 1024 });
    peer.socket.pause();
    const chunk = "z".repeat(1024 * 1024);
    for (let i = 0; i < 512 && !state.closedWith; i++) {
      conn.send(chunk);
      if (i % 8 === 7) await new Promise((r) => setImmediate(r));
    }
    expect(state.closedWith?.[0]).toBe(1008);
  });

  it("refuses connections over maxConnections (503)", async () => {
    const server = await serve({ maxConnections: 2 });
    await peerOf(server);
    await peerOf(server);
    expect(await statusOf(server, {})).toBe(503);
  });

  it("drops a socket that never sends its upgrade request", async () => {
    const server = await serve({ handshakeTimeoutMs: 100 });
    const s = connect({ host: "127.0.0.1", port: server.port });
    open.sockets.push(s);
    s.on("error", () => {});
    let closed = false;
    s.on("close", () => (closed = true));
    await until(() => closed, 2000, "the idle socket to be dropped");
  });

  it("bounds sockets in the handshake: maxConnections plus a small slack", async () => {
    const server = await serve({ maxConnections: 1 });
    const idle: Socket[] = [];
    for (let i = 0; i < 9; i++) {
      const s = connect({ host: "127.0.0.1", port: server.port });
      s.on("error", () => {});
      open.sockets.push(s);
      idle.push(s);
      await new Promise((r) => s.once("connect", r));
    }
    await sleep(50);
    const extra = connect({ host: "127.0.0.1", port: server.port });
    extra.on("error", () => {});
    open.sockets.push(extra);
    let closed = false;
    extra.on("close", () => (closed = true));
    await until(() => closed, 2000, "the socket over the limit to be dropped");
    for (const s of idle) s.destroy();
    await sleep(50);
    expect(await statusOf(server, {})).toBe(101);
  });
});

// ---------------------------------------------------------------- 11. malformed input

describe("11. malformed input", () => {
  it("refuses unknown opcodes and RSV bits (1002), binary (1003) and invalid UTF-8 (1007)", async () => {
    const server = await serve();
    const cases: [Buffer, number][] = [
      [frame(0x3, "x"), 1002],
      [frame(0xb, "x"), 1002],
      [text("{}", { rsv: 4 }), 1002],
      [text("{}", { rsv: 1 }), 1002],
      [frame(0x2, "{}"), 1003],
      [frame(0x1, Buffer.from([0x7b, 0xff, 0x7d])), 1007],
      [frame(0x1, Buffer.from([0xed, 0xa0, 0x80])), 1007], // an encoded surrogate
    ];
    for (const [f, code] of cases) {
      const p = await peerOf(server);
      p.send(f);
      expect(await p.closeCode()).toBe(code);
    }
  });

  it("answers malformed JSON and bad requests with errors and stays open", async () => {
    const server = await serve();
    const p = await peerOf(server);
    p.send(text("{not json"));
    expect((await p.reply()).error.code).toBe(RPC_ERRORS.parse);
    p.send(text("42"));
    expect((await p.reply()).error.code).toBe(RPC_ERRORS.invalidRequest);
    p.send(text(req(60, "__proto__")));
    expect((await p.reply()).error.code).toBe(RPC_ERRORS.methodNotFound);
    p.send(text(req(61)));
    expect((await p.reply()).id).toBe(61);
  });

  it("turns a request that throws outside the service into an internal error, not a crash", async () => {
    const server = await serve({
      actors: () => {
        throw new Error("policy failed");
      },
    });
    const p = await peerOf(server);
    p.send(text(req(70, "board.undo", { params: { actor: { kind: "agent", id: "agent:x" } } })));
    const r = await p.reply();
    expect(r.id).toBe(70);
    expect(r.error.code).toBe(RPC_ERRORS.internal);
    p.send(text(req(71)));
    expect((await p.reply()).id).toBe(71);
  });

  it("fails the connection (1011) when the message handler throws", async () => {
    const { peer } = await pair({
      onMessage: () => {
        throw new Error("handler failed");
      },
    });
    peer.send(text("{}"));
    expect(await peer.closeCode()).toBe(1011);
  });

  it("reads frames sent in the same packet as the upgrade request", async () => {
    const server = await serve();
    const p = await peerOf(server, {}, Buffer.concat([text(req(80)), text(req(81))]));
    expect((await p.reply()).id).toBe(80);
    expect((await p.reply()).id).toBe(81);
  });
});
