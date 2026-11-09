/**
 * A minimal server side of the WebSocket protocol (RFC 6455) over Node's own `http` upgrade, enough for JSON-RPC
 * text messages: the opening handshake, masked client frames, fragmentation, ping and pong, the closing
 * handshake, a size limit per message and UTF-8 checking. No extensions (permessage-deflate is never accepted),
 * no binary messages. Written from the RFC; Node has a WebSocket client built in but no server.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Close codes used here (RFC 6455 section 7.4.1). */
export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  unsupportedData: 1003,
  invalidPayload: 1007,
  policyViolation: 1008,
  tooBig: 1009,
  internalError: 1011,
} as const;

/** The `Sec-WebSocket-Accept` value for a client's key. */
export const acceptKey = (key: string): string => createHash("sha1").update(key + GUID).digest("base64");

/** Answer an upgrade request with an HTTP error and end the socket. */
export function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  const body = `${reason}\n`;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
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
  onMessage(text: string): void;
  onClose(code: number, reason: string): void;
}

/** One accepted WebSocket connection (server side). */
export class WsConnection {
  private buf: Buffer = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private partBytes = 0;
  private fragmented = false;
  private closing = false;
  private closed = false;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(
    private readonly socket: Duplex,
    private readonly options: WsConnectionOptions,
  ) {
    socket.on("data", (d: Buffer) => this.receive(d));
    socket.on("error", () => this.finish(CLOSE.goingAway, "socket error"));
    socket.on("close", () => this.finish(CLOSE.goingAway, "socket closed"));
  }

  /** Complete the opening handshake on `socket` and return the connection. */
  static accept(req: IncomingMessage, socket: Duplex, head: Buffer, options: WsConnectionOptions & { protocol?: string }): WsConnection {
    const key = String(req.headers["sec-websocket-key"]);
    const lines = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey(key)}`];
    if (options.protocol) lines.push(`Sec-WebSocket-Protocol: ${options.protocol}`);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    const conn = new WsConnection(socket, options);
    if (head.length) conn.receive(head);
    return conn;
  }

  get isOpen(): boolean {
    return !this.closing && !this.closed;
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
    const r = Buffer.from(reason.slice(0, 120), "utf8");
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this.frame(0x8, payload);
    const timer = setTimeout(() => this.socket.destroy(), 1000);
    timer.unref?.();
    this.socket.once("close", () => clearTimeout(timer));
  }

  /** Drop the connection now (server shutdown after the close frame had its chance). */
  destroy(): void {
    this.socket.destroy();
  }

  private frame(opcode: number, payload: Buffer): void {
    const n = payload.length;
    const head = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    if (n < 126) head[1] = n;
    else if (n < 65536) {
      head[1] = 126;
      head.writeUInt16BE(n, 2);
    } else {
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(n), 2);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  private fail(code: number, reason: string): void {
    this.close(code, reason);
    this.buf = Buffer.alloc(0);
    this.parts = [];
  }

  private finish(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.options.onClose(code, reason);
  }

  private receive(data: Buffer): void {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let at = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(this.options.maxMessageBytes)) return this.fail(CLOSE.tooBig, "message too big");
        len = Number(big);
        at = 10;
      }
      if (rsv) return this.fail(CLOSE.protocolError, "no extensions were negotiated");
      if (!masked) return this.fail(CLOSE.protocolError, "client frames must be masked");
      const control = opcode >= 0x8;
      if (control && (!fin || len > 125)) return this.fail(CLOSE.protocolError, "bad control frame");
      if (!control && this.partBytes + len > this.options.maxMessageBytes) return this.fail(CLOSE.tooBig, "message too big");
      if (this.buf.length < at + 4 + len) return;
      const mask = this.buf.subarray(at, at + 4);
      const payload = Buffer.from(this.buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(at + 4 + len);
      if (!this.handle(fin, opcode, payload)) return;
    }
  }

  /** One frame; false stops reading. */
  private handle(fin: boolean, opcode: number, payload: Buffer): boolean {
    switch (opcode) {
      case 0x8: {
        // the peer closes: answer with the same code (when it gave one) and end
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : CLOSE.normal;
        if (!this.closing) {
          this.closing = true;
          const echo = Buffer.alloc(2);
          echo.writeUInt16BE(code === 1005 || code === 1006 || code === 1015 ? CLOSE.normal : code, 0);
          this.frame(0x8, echo);
        }
        this.socket.end();
        this.finish(code, payload.length > 2 ? payload.subarray(2).toString("utf8") : "");
        return false;
      }
      case 0x9:
        if (this.isOpen) this.frame(0xa, payload);
        return true;
      case 0xa:
        return true;
      case 0x2:
        this.fail(CLOSE.unsupportedData, "binary messages are not accepted");
        return false;
      case 0x1:
      case 0x0: {
        if ((opcode === 0x1) === this.fragmented) {
          this.fail(CLOSE.protocolError, opcode === 0x1 ? "a new message inside a fragmented one" : "continuation without a message");
          return false;
        }
        this.parts.push(payload);
        this.partBytes += payload.length;
        this.fragmented = !fin;
        if (!fin) return true;
        const whole = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts);
        this.parts = [];
        this.partBytes = 0;
        let text: string;
        try {
          text = this.decoder.decode(whole);
        } catch {
          this.fail(CLOSE.invalidPayload, "messages must be UTF-8");
          return false;
        }
        if (this.isOpen) this.options.onMessage(text);
        return true;
      }
      default:
        this.fail(CLOSE.protocolError, "unknown opcode");
        return false;
    }
  }
}
