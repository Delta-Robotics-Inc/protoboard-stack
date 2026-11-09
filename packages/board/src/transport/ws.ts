/**
 * A minimal server side of the WebSocket protocol (RFC 6455) over Node's own `http` upgrade, enough for JSON-RPC
 * text messages: the opening handshake, masked client frames, fragmentation, ping and pong, the closing
 * handshake, a size limit per message and UTF-8 checking. No extensions (permessage-deflate is never accepted),
 * no binary messages. Written from the RFC; Node has a WebSocket client built in but no server.
 *
 * Limits a peer cannot talk its way past (see the security review in docs/specs/pcb-editor/board-cli.md):
 * - every frame header is checked before its payload is buffered: RSV bits, known opcodes, the mask bit,
 *   control frame rules, minimal length encoding, the top bit of a 64-bit length, and the message size limit
 *   counted across fragments;
 * - received bytes live in one buffer that grows by doubling (no copy of the whole buffer per chunk), so a
 *   connection holds at most about twice the message limit plus one read;
 * - a fragmented message has a fragment count limit and a deadline;
 * - pings are rate limited; a keepalive ping (when enabled) frees the slot of a peer that stopped answering;
 * - a peer that does not read: once the socket's send buffer passes a limit, the connection is dropped;
 * - a close frame's code and reason are checked (RFC 6455 section 7.4), and the socket is destroyed when the
 *   peer never finishes the closing handshake.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Close codes used here (RFC 6455 section 7.4.1). 1005 and 1006 are only ever reported locally, never sent. */
export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  unsupportedData: 1003,
  noStatus: 1005,
  abnormal: 1006,
  invalidPayload: 1007,
  policyViolation: 1008,
  tooBig: 1009,
  internalError: 1011,
} as const;

/** Default limits of one connection (each can be set per connection). */
export const WS_LIMITS = {
  /** Frames one message may be split into. */
  maxFragments: 1024,
  /** Time from a fragmented message's first frame to its last. */
  fragmentTimeoutMs: 30_000,
  /** Pings a peer may send in one second. */
  maxPingsPerSecond: 50,
  /** How long the peer has to finish the closing handshake before the socket is destroyed. */
  closeTimeoutMs: 1000,
  /** Bytes the socket may hold unsent (a peer that does not read) before the connection is dropped. */
  maxSendBufferBytes: 32 * 1024 * 1024,
} as const;

/** The largest frame header: 2 bytes, 8 bytes of extended length, 4 bytes of mask. */
const MAX_HEADER = 14;
/** Opcodes RFC 6455 defines: continuation, text, binary, close, ping, pong. */
const KNOWN_OPCODES = new Set([0x0, 0x1, 0x2, 0x8, 0x9, 0xa]);

/** The `Sec-WebSocket-Accept` value for a client's key. */
export const acceptKey = (key: string): string => createHash("sha1").update(key + GUID).digest("base64");

/**
 * Whether a peer may send this close code (RFC 6455 section 7.4): 1000-1003 and 1007-1014 (defined or registered),
 * 3000-4999 (libraries and applications). 0-999, 1004, 1005, 1006, 1015, 1016-2999 and 5000 up are refused.
 */
export function isValidCloseCode(code: number): boolean {
  if (code >= 3000 && code <= 4999) return true;
  return code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006;
}

/** `text` as UTF-8, cut to at most `max` bytes without splitting a character. */
export function utf8Prefix(text: string, max: number): Buffer {
  const b = Buffer.from(text, "utf8");
  if (b.length <= max) return b;
  let cut = max;
  // back off continuation bytes (10xxxxxx) so the cut lands on the first byte of a character
  while (cut > 0 && (b[cut] & 0xc0) === 0x80) cut--;
  return b.subarray(0, cut);
}

/** Destroy `socket` after `ms` unless it closes first. */
function destroyLater(socket: Duplex, ms: number): void {
  const t = setTimeout(() => socket.destroy(), ms);
  t.unref?.();
  socket.once("close", () => clearTimeout(t));
}

/** Answer an upgrade request with an HTTP error and end the socket (destroyed shortly if the peer lingers). */
export function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  const body = `${reason}\n`;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  destroyLater(socket, WS_LIMITS.closeTimeoutMs);
}

/** Whether a request is a well-formed WebSocket upgrade (version 13); the reason when it is not. */
export function upgradeProblem(req: IncomingMessage): string | undefined {
  if ((req.method ?? "") !== "GET") return "method must be GET";
  if (!/\bwebsocket\b/i.test(String(req.headers.upgrade ?? ""))) return "not a websocket upgrade";
  if (!/\bupgrade\b/i.test(String(req.headers.connection ?? ""))) return "missing Connection: Upgrade";
  if (String(req.headers["sec-websocket-version"] ?? "") !== "13") return "websocket version must be 13";
  const key = String(req.headers["sec-websocket-key"] ?? "");
  if (!/^[A-Za-z0-9+/]{22}==$/.test(key)) return "bad Sec-WebSocket-Key";
  return undefined;
}

export interface WsConnectionOptions {
  /** Largest message accepted, in bytes (after reassembly). */
  maxMessageBytes: number;
  /** DEFAULT `WS_LIMITS.maxFragments`. */
  maxFragments?: number;
  /** DEFAULT `WS_LIMITS.fragmentTimeoutMs`. */
  fragmentTimeoutMs?: number;
  /** DEFAULT `WS_LIMITS.maxPingsPerSecond`. */
  maxPingsPerSecond?: number;
  /** DEFAULT `WS_LIMITS.closeTimeoutMs`. */
  closeTimeoutMs?: number;
  /** DEFAULT `WS_LIMITS.maxSendBufferBytes`. */
  maxSendBufferBytes?: number;
  /** Send a ping this often and drop a peer that sent nothing since the last one. DEFAULT 0: off. */
  keepaliveMs?: number;
  onMessage(text: string): void;
  onClose(code: number, reason: string): void;
}

/** One accepted WebSocket connection (server side). */
export class WsConnection {
  // received bytes not yet parsed: rbuf[rstart, rend)
  private rbuf: Buffer = Buffer.alloc(0);
  private rstart = 0;
  private rend = 0;
  // the message being reassembled
  private parts: Buffer[] = [];
  private partBytes = 0;
  private fragments = 0;
  private fragmented = false;
  private fragmentTimer?: ReturnType<typeof setTimeout>;
  /** A close frame was sent. */
  private closing = false;
  /** The connection failed or the peer closed: nothing more is read. */
  private stopped = false;
  /** onClose was called. */
  private closed = false;
  private destroyTimerSet = false;
  private pingWindow = 0;
  private pings = 0;
  private heardFromPeer = true;
  private keepalive?: ReturnType<typeof setInterval>;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private readonly limits: Required<Omit<WsConnectionOptions, "onMessage" | "onClose">>;

  constructor(
    private readonly socket: Duplex,
    private readonly options: WsConnectionOptions,
  ) {
    this.limits = {
      maxMessageBytes: options.maxMessageBytes,
      maxFragments: options.maxFragments ?? WS_LIMITS.maxFragments,
      fragmentTimeoutMs: options.fragmentTimeoutMs ?? WS_LIMITS.fragmentTimeoutMs,
      maxPingsPerSecond: options.maxPingsPerSecond ?? WS_LIMITS.maxPingsPerSecond,
      closeTimeoutMs: options.closeTimeoutMs ?? WS_LIMITS.closeTimeoutMs,
      maxSendBufferBytes: options.maxSendBufferBytes ?? WS_LIMITS.maxSendBufferBytes,
      keepaliveMs: options.keepaliveMs ?? 0,
    };
    socket.on("data", (d: Buffer) => this.receive(d));
    // the HTTP server's sockets allow half-open connections: a peer that ends its side is gone
    socket.on("end", () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("close", () => this.finish(CLOSE.abnormal, "socket closed"));
    if (this.limits.keepaliveMs > 0) {
      this.keepalive = setInterval(() => this.tick(), this.limits.keepaliveMs);
      this.keepalive.unref?.();
    }
  }

  /**
   * Complete the opening handshake on `socket` and return the connection. Bytes that came with the request
   * (`head`) are read on the next microtask, after the caller has registered the connection.
   */
  static accept(req: IncomingMessage, socket: Duplex, head: Buffer, options: WsConnectionOptions & { protocol?: string }): WsConnection {
    const key = String(req.headers["sec-websocket-key"]);
    const lines = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey(key)}`];
    if (options.protocol) lines.push(`Sec-WebSocket-Protocol: ${options.protocol}`);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    const conn = new WsConnection(socket, options);
    if (head.length) {
      const early = Buffer.from(head);
      queueMicrotask(() => conn.receive(early));
    }
    return conn;
  }

  get isOpen(): boolean {
    return !this.closing && !this.stopped && !this.closed;
  }

  /** Send one text message. */
  send(text: string): void {
    if (!this.isOpen) return;
    this.frame(0x1, Buffer.from(text, "utf8"));
  }

  /** Start the closing handshake; the socket ends when the peer answers or after a short wait. */
  close(code: number = CLOSE.normal, reason = ""): void {
    if (this.closing || this.closed) return;
    this.closing = true;
    const sent = isValidCloseCode(code) ? code : CLOSE.internalError;
    const r = utf8Prefix(reason, 123);
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(sent, 0);
    r.copy(payload, 2);
    this.frame(0x8, payload);
    this.destroySoon();
  }

  /** Drop the connection now (server shutdown after the close frame had its chance). */
  destroy(): void {
    this.socket.destroy();
  }

  private destroySoon(): void {
    if (this.destroyTimerSet) return;
    this.destroyTimerSet = true;
    destroyLater(this.socket, this.limits.closeTimeoutMs);
  }

  private frame(opcode: number, payload: Buffer): void {
    const s = this.socket;
    if (s.destroyed || !s.writable) return;
    // a peer that does not read: its unsent bytes stop at the limit (one message may pass it, then nothing)
    if (s.writableLength > this.limits.maxSendBufferBytes) {
      this.finish(CLOSE.policyViolation, "the peer is not reading");
      s.destroy();
      return;
    }
    const n = payload.length;
    const head = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    head[0] = 0x80 | opcode; // FIN, no RSV bits; the mask bit stays 0: a server never masks
    if (n < 126) head[1] = n;
    else if (n < 65536) {
      head[1] = 126;
      head.writeUInt16BE(n, 2);
    } else {
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(n), 2);
    }
    s.write(Buffer.concat([head, payload]));
  }

  /** `fail`, for the frame parser: false stops reading. */
  private stop(code: number, reason: string): false {
    this.fail(code, reason);
    return false;
  }

  /** Fail the connection (RFC 6455 section 7.1.7): a close frame, then the end of the socket; nothing more is read. */
  private fail(code: number, reason: string): void {
    if (this.stopped || this.closed) return;
    this.stopped = true;
    this.resetMessage();
    this.rbuf = Buffer.alloc(0);
    this.rstart = this.rend = 0;
    this.close(code, reason);
    this.socket.end();
    this.destroySoon();
  }

  private finish(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.stopped = true;
    this.resetMessage();
    if (this.keepalive) clearInterval(this.keepalive);
    try {
      this.options.onClose(code, reason);
    } catch {
      // a listener's failure must not take the process down
    }
  }

  private tick(): void {
    if (!this.isOpen) return;
    if (!this.heardFromPeer) {
      this.finish(CLOSE.abnormal, "no answer to a keepalive ping");
      this.socket.destroy();
      return;
    }
    this.heardFromPeer = false;
    this.frame(0x9, Buffer.alloc(0));
  }

  private resetMessage(): void {
    this.parts = [];
    this.partBytes = 0;
    this.fragments = 0;
    this.fragmented = false;
    if (this.fragmentTimer) clearTimeout(this.fragmentTimer);
    this.fragmentTimer = undefined;
  }

  /** Append received bytes; the buffer grows by doubling and is compacted in place, so each byte is copied O(1) times. */
  private append(data: Buffer): void {
    if (this.rend + data.length > this.rbuf.length) {
      const live = this.rend - this.rstart;
      const need = live + data.length;
      if (need <= this.rbuf.length >> 1) {
        this.rbuf.copy(this.rbuf, 0, this.rstart, this.rend);
      } else {
        const next = Buffer.allocUnsafe(Math.max(4096, need * 2));
        this.rbuf.copy(next, 0, this.rstart, this.rend);
        this.rbuf = next;
      }
      this.rstart = 0;
      this.rend = live;
    }
    data.copy(this.rbuf, this.rend);
    this.rend += data.length;
  }

  private receive(data: Buffer): void {
    if (this.stopped || this.closed) return;
    this.heardFromPeer = true;
    this.append(data);
    while (!this.stopped && this.nextFrame());
    if (this.stopped) return;
    if (this.rstart === this.rend) {
      // nothing pending: let go of a large buffer
      this.rstart = this.rend = 0;
      if (this.rbuf.length > 64 * 1024) this.rbuf = Buffer.alloc(0);
    } else if (this.rend - this.rstart > this.limits.maxMessageBytes + MAX_HEADER) {
      // cannot happen with the header checks below; a guard on the bytes one connection may hold
      this.fail(CLOSE.tooBig, "too much unread data");
    }
  }

  /** Parse and handle one frame when it has fully arrived; false when more bytes are needed or reading stopped. */
  private nextFrame(): boolean {
    const avail = this.rend - this.rstart;
    if (avail < 2) return false;
    const b = this.rbuf;
    const p = this.rstart;
    const b0 = b[p];
    const b1 = b[p + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    const len7 = b1 & 0x7f;
    const control = opcode >= 0x8;
    // everything the first two bytes decide, before any payload is buffered
    if (b0 & 0x70) return this.stop(CLOSE.protocolError, "no extensions were negotiated");
    if (!KNOWN_OPCODES.has(opcode)) return this.stop(CLOSE.protocolError, "unknown opcode");
    if (!masked) return this.stop(CLOSE.protocolError, "client frames must be masked");
    if (control && (!fin || len7 > 125)) return this.stop(CLOSE.protocolError, "bad control frame");
    if (opcode === 0x2) return this.stop(CLOSE.unsupportedData, "binary messages are not accepted");
    if (opcode === 0x0 && !this.fragmented) return this.stop(CLOSE.protocolError, "continuation without a message");
    if (opcode === 0x1 && this.fragmented) return this.stop(CLOSE.protocolError, "a new message inside a fragmented one");
    let len = len7;
    let at = 2;
    if (len7 === 126) {
      if (avail < 4) return false;
      len = b.readUInt16BE(p + 2);
      if (len < 126) return this.stop(CLOSE.protocolError, "frame length not in its shortest form");
      at = 4;
    } else if (len7 === 127) {
      if (avail < 10) return false;
      const hi = b.readUInt32BE(p + 2);
      const lo = b.readUInt32BE(p + 6);
      if (hi & 0x80000000) return this.stop(CLOSE.protocolError, "frame length has its top bit set");
      if (hi === 0 && lo < 65536) return this.stop(CLOSE.protocolError, "frame length not in its shortest form");
      if (hi !== 0) return this.stop(CLOSE.tooBig, "message too big");
      len = lo;
      at = 10;
    }
    if (!control && this.partBytes + len > this.limits.maxMessageBytes) return this.stop(CLOSE.tooBig, "message too big");
    if (avail < at + 4 + len) return false;
    const m = p + at;
    const start = m + 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[start + i] ^ b[m + (i & 3)];
    this.rstart = start + len;
    this.handle(fin, opcode, payload);
    return !this.stopped;
  }

  private handle(fin: boolean, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case 0x8:
        return this.peerClosed(payload);
      case 0x9: {
        const now = Date.now();
        if (now - this.pingWindow >= 1000) {
          this.pingWindow = now;
          this.pings = 0;
        }
        if (++this.pings > this.limits.maxPingsPerSecond) return this.fail(CLOSE.policyViolation, "too many pings");
        if (this.isOpen) this.frame(0xa, payload);
        return;
      }
      case 0xa:
        // a pong answers our keepalive, or is unsolicited (RFC 6455 section 5.5.3): no reply either way
        return;
      default:
        return this.data(fin, payload);
    }
  }

  /** A text frame or a continuation (the order was checked with the header). */
  private data(fin: boolean, payload: Buffer): void {
    if (++this.fragments > this.limits.maxFragments) return this.fail(CLOSE.policyViolation, "too many fragments in one message");
    if (payload.length) this.parts.push(payload);
    this.partBytes += payload.length;
    if (!fin) {
      if (!this.fragmented) {
        this.fragmented = true;
        this.fragmentTimer = setTimeout(() => this.fail(CLOSE.policyViolation, "a fragmented message was not finished in time"), this.limits.fragmentTimeoutMs);
        this.fragmentTimer.unref?.();
      }
      return;
    }
    const whole = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.partBytes);
    this.resetMessage();
    let text: string;
    try {
      text = this.decoder.decode(whole);
    } catch {
      return this.fail(CLOSE.invalidPayload, "messages must be UTF-8");
    }
    // after our close frame, data is read (to reach the peer's close) but not delivered
    if (!this.isOpen) return;
    try {
      this.options.onMessage(text);
    } catch {
      this.fail(CLOSE.internalError, "internal error");
    }
  }

  /** The peer's close frame: check it, answer it (unless we started the close), end the socket, read nothing more. */
  private peerClosed(payload: Buffer): void {
    if (payload.length === 1) return this.fail(CLOSE.protocolError, "a close payload of one byte");
    let code: number = CLOSE.noStatus;
    let reason = "";
    if (payload.length >= 2) {
      code = payload.readUInt16BE(0);
      if (!isValidCloseCode(code)) return this.fail(CLOSE.protocolError, "invalid close code");
      try {
        reason = this.decoder.decode(payload.subarray(2));
      } catch {
        return this.fail(CLOSE.invalidPayload, "a close reason must be UTF-8");
      }
    }
    if (!this.closing) {
      this.closing = true;
      // echo the status code (no reason); an empty close answers an empty close
      const echo = Buffer.alloc(payload.length >= 2 ? 2 : 0);
      if (echo.length) echo.writeUInt16BE(code, 0);
      this.frame(0x8, echo);
    }
    this.stopped = true;
    this.finish(code, reason);
    // the server closes the TCP connection first (RFC 6455 section 7.1.1)
    this.socket.end();
    this.destroySoon();
  }
}
