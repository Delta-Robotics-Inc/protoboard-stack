/**
 * `serveBoard`: the board service on the wire (contract section 10). JSON-RPC 2.0 over WebSocket on 127.0.0.1, a
 * random token per run, `service.json` in the board's local folder while it runs, and `board.event` notifications
 * of every commit, presence change and save to every connected client.
 *
 * Who may connect: a process on this machine (loopback peers only; the socket is bound to 127.0.0.1) that can read
 * the board's local files (the token is in `service.json`, readable by this user), from no browser page unless its
 * origin is allowed by name, and through a Host header naming the loopback address (no DNS rebinding). The token
 * proves local file access, nothing more: which actor kinds a connection may name is the `actors` policy, and the
 * agent entry points (MCP tools, the CLI under an agent) only ever name agents.
 *
 * Resource limits: `maxConnections` open connections, plus `HANDSHAKE_SLACK` sockets in the handshake or being
 * refused (the listener drops anything beyond); an upgrade request must arrive within `handshakeTimeoutMs`; each
 * connection's message size, fragments, pings and unsent bytes are bounded in `ws.ts`; a keepalive ping frees the
 * slot of a client that stopped answering.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import type { Actor } from "../ops/registry.js";
import type { BoardEvent, BoardService } from "../service.js";
import {
  BOARD_PROTOCOL,
  callService,
  HANDSHAKE_SLACK,
  HANDSHAKE_TIMEOUT_MS,
  KEEPALIVE_MS,
  MAX_BATCH,
  MAX_CONNECTIONS,
  MAX_MESSAGE_BYTES,
  MAX_SEND_BUFFER_BYTES,
  METHOD_PARAMS,
  RPC_ERRORS,
  SERVICE_FILE,
  TOKEN_PROTOCOL_PREFIX,
  type BoardMethod,
  type RpcError,
  type ServiceFile,
} from "./protocol.js";
import { CLOSE, refuseUpgrade, upgradeProblem, WsConnection } from "./ws.js";

export interface ServeOptions {
  /** DEFAULT 0: a free port chosen by the system. */
  port?: number;
  /** DEFAULT: 32 random bytes, hex. */
  token?: string;
  /**
   * Browser origins allowed to connect (exact match, such as the dev server's `http://127.0.0.1:5180`; given here
   * in any case and with or without a trailing slash, matched against the browser's lowercase serialization).
   * `null` (an opaque origin) is never allowed. A request without an Origin header (not a browser) is allowed.
   */
  origins?: string[];
  /** DEFAULT 4 MiB: larger messages close the connection (1009). */
  maxMessageBytes?: number;
  /** DEFAULT 32. */
  maxConnections?: number;
  /** DEFAULT 30 s (`KEEPALIVE_MS`): ping each client this often and drop one that sent nothing since the last ping. 0 turns it off. */
  keepaliveMs?: number;
  /** DEFAULT 32 MiB: a client whose unsent replies and events pass this is dropped. */
  maxSendBufferBytes?: number;
  /** DEFAULT 10 s: time a socket has to send its upgrade request. */
  handshakeTimeoutMs?: number;
  /** DEFAULT 1 s: time a client has to answer a close frame before its socket is destroyed. */
  closeTimeoutMs?: number;
  /** DEFAULT true: write `<local folder>/service.json` while serving (needs a board folder). A string writes it there instead. */
  serviceFile?: boolean | string;
  /** Which actors a connection may name: a reason to refuse, or undefined to allow. DEFAULT: every wire actor (human, agent, router, host). */
  actors?: (actor: Actor) => string | undefined;
  /** Diagnostic lines (connections, refusals). */
  log?: (line: string) => void;
  /** Offer `board.shutdown`: called (after the reply is sent) when a client asks the serving process to stop. */
  onShutdown?: () => void;
}

export interface BoardServer {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  /** Where `service.json` was written, when it was. */
  readonly serviceFile?: string;
  connections(): number;
  /** Close every connection (1001), stop listening and remove `service.json`. The service itself stays open. */
  close(): Promise<void>;
}

const LOOPBACK = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
/** Whether a peer address is this machine's loopback. */
export const isLoopback = (address: string | undefined): boolean => !!address && LOOPBACK.test(address);

/** Constant-time comparison: both sides are hashed first, so neither the content nor the length leaks through timing. */
function sameSecret(a: string, b: string): boolean {
  const x = createHash("sha256").update(a, "utf8").digest();
  const y = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(x, y);
}

/** A configured origin in the form a browser sends it: lowercase, no trailing slash. */
const normalOrigin = (o: string): string => o.trim().toLowerCase().replace(/\/+$/, "");

/** The Host header values that name this server: the loopback address with its port (bare on port 80). */
function hostsFor(port: number): Set<string> {
  const names = ["127.0.0.1", "localhost", "[::1]"];
  return new Set([...names.map((n) => `${n}:${port}`), ...(port === 80 ? names : [])]);
}

/** The token a request carries: `Authorization: Bearer <token>`, or a `protoboard.token.<token>` subprotocol. */
function tokenOf(req: IncomingMessage, protocols: string[]): string | undefined {
  const auth = String(req.headers.authorization ?? "");
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (m) return m[1];
  const p = protocols.find((x) => x.startsWith(TOKEN_PROTOCOL_PREFIX));
  return p ? p.slice(TOKEN_PROTOCOL_PREFIX.length) : undefined;
}

const rpcError = (id: unknown, error: RpcError) => ({ jsonrpc: "2.0" as const, id: id ?? null, error });

/** Serve a board service until `close()`. Resolves once listening (and `service.json` is written). */
export async function serveBoard(service: BoardService, options: ServeOptions = {}): Promise<BoardServer> {
  const token = options.token ?? randomBytes(32).toString("hex");
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(token)) throw new Error("the token must be 16 to 256 letters, digits, _ or -");
  const maxBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;
  const maxConns = options.maxConnections ?? MAX_CONNECTIONS;
  const origins = new Set((options.origins ?? []).map(normalOrigin).filter((o) => o && o !== "null"));
  const policy = options.actors ?? (() => undefined);
  const log = options.log ?? (() => {});
  const handshakeMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const conns = new Set<WsConnection>();
  const sockets = new Set<Duplex>();
  let port = 0;
  let hosts = hostsFor(0);

  const server: Server = createServer(
    // a socket must deliver its whole upgrade request in time; idle or slow ones are dropped
    { headersTimeout: handshakeMs, requestTimeout: handshakeMs, connectionsCheckingInterval: Math.max(50, Math.min(1000, Math.floor(handshakeMs / 4))) },
    (_req, res) => {
      // plain HTTP gets nothing but the hint that this is a WebSocket endpoint
      res.writeHead(426, { "content-type": "text/plain; charset=utf-8", connection: "close", upgrade: "websocket" });
      res.end("Upgrade Required: the board service speaks JSON-RPC over WebSocket\n");
    },
  );
  // every socket counts, open connections and handshakes alike; the listener drops what is beyond
  server.maxConnections = maxConns + HANDSHAKE_SLACK;
  // the listener is bound to 127.0.0.1; a peer that is not loopback is dropped before it says anything
  // and one that has not completed its upgrade in time is dropped too (the HTTP server's own timeouts only start
  // once a request has begun, so a socket that never says anything would otherwise hold its slot forever)
  const handshakeTimers = new WeakMap<Duplex, ReturnType<typeof setTimeout>>();
  server.on("connection", (s: Socket) => {
    if (!isLoopback(s.remoteAddress)) return void s.destroy();
    const t = setTimeout(() => s.destroy(), handshakeMs);
    t.unref?.();
    handshakeTimers.set(s, t);
    s.once("close", () => clearTimeout(t));
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    const refuse = (status: number, reason: string) => {
      log(`board server: refused a connection (${reason})`);
      refuseUpgrade(socket, status, reason);
    };
    try {
      if (!isLoopback(req.socket.remoteAddress)) return refuse(403, "Forbidden");
      // DNS rebinding: a page on another name that resolves to 127.0.0.1 still sends its own name as Host
      const host = req.headers.host;
      if (typeof host !== "string" || !hosts.has(host.toLowerCase())) return refuse(403, "Forbidden");
      // a browser always sends Origin; it must be one of ours exactly (an opaque `null` never is)
      const origin = req.headers.origin;
      if (origin !== undefined && !origins.has(origin)) return refuse(403, "Forbidden");
      const problem = upgradeProblem(req);
      if (problem) return refuse(400, "Bad Request");
      const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (protocols.length && !protocols.includes(BOARD_PROTOCOL)) return refuse(400, "Bad Request");
      const given = tokenOf(req, protocols);
      if (!given || !sameSecret(given, token)) return refuse(401, "Unauthorized");
      if (conns.size >= maxConns) return refuse(503, "Service Unavailable");
      clearTimeout(handshakeTimers.get(socket));
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      const conn: WsConnection = WsConnection.accept(req, socket, head, {
        maxMessageBytes: maxBytes,
        maxSendBufferBytes: options.maxSendBufferBytes ?? MAX_SEND_BUFFER_BYTES,
        keepaliveMs: options.keepaliveMs ?? KEEPALIVE_MS,
        ...(options.closeTimeoutMs !== undefined ? { closeTimeoutMs: options.closeTimeoutMs } : {}),
        ...(protocols.length ? { protocol: BOARD_PROTOCOL } : {}),
        onMessage: (text) => onMessage(conn, text),
        onClose: () => conns.delete(conn),
      });
      conns.add(conn);
      log(`board server: a client connected (${conns.size} connected)`);
    } catch (e) {
      // nothing a client sends may take the process down
      log(`board server: dropped a connection (${(e as Error)?.message ?? String(e)})`);
      socket.destroy();
    }
  });

  const handle = (msg: unknown): object | undefined => {
    try {
      return handleOne(msg);
    } catch (e) {
      // a request that throws outside the service call (a schema too deep to check, a policy that throws)
      const id = msg && typeof msg === "object" && !Array.isArray(msg) ? (msg as { id?: unknown }).id : null;
      const replyId = typeof id === "string" || typeof id === "number" ? id : null;
      return rpcError(replyId, { code: RPC_ERRORS.internal, message: `internal error: ${(e as Error)?.message ?? String(e)}`.slice(0, 500) });
    }
  };

  const handleOne = (msg: unknown): object | undefined => {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return rpcError(null, { code: RPC_ERRORS.invalidRequest, message: "a request is a JSON object" });
    const m = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    const hasId = "id" in m;
    const id = m.id;
    if (m.jsonrpc !== "2.0" || typeof m.method !== "string" || (hasId && id !== null && typeof id !== "string" && typeof id !== "number")) return rpcError(hasId ? id : null, { code: RPC_ERRORS.invalidRequest, message: "expected { jsonrpc: \"2.0\", id, method, params }" });
    const reply = (body: { result: unknown } | { error: RpcError }) => (hasId ? { jsonrpc: "2.0" as const, id, ...body } : undefined);
    if (!Object.prototype.hasOwnProperty.call(METHOD_PARAMS, m.method)) return reply({ error: { code: RPC_ERRORS.methodNotFound, message: `no method ${m.method.slice(0, 80)}` } });
    const method = m.method as BoardMethod;
    const parsed = METHOD_PARAMS[method].safeParse(m.params ?? undefined);
    if (!parsed.success) return reply({ error: { code: RPC_ERRORS.invalidParams, message: parsed.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; "), data: parsed.error.issues } });
    const params = parsed.data as { actor?: Actor; by?: Actor } | undefined;
    for (const a of [params?.actor, params?.by]) {
      const why = a ? policy(a) : undefined;
      if (why) return reply({ error: { code: RPC_ERRORS.actor, message: why } });
    }
    if (method === "board.shutdown") {
      if (!options.onShutdown) return reply({ error: { code: RPC_ERRORS.methodNotFound, message: "this server cannot be stopped by a client" } });
      setImmediate(() => {
        try {
          options.onShutdown!();
        } catch (e) {
          log(`board server: shutdown failed (${(e as Error)?.message ?? String(e)})`);
        }
      });
      return reply({ result: { stopping: true } });
    }
    try {
      return reply({ result: callService(service, method, params) ?? null });
    } catch (e) {
      return reply({ error: { code: RPC_ERRORS.service, message: (e as Error).message } });
    }
  };

  /** Send a reply; one that cannot be serialized becomes an internal error. */
  const sendJson = (conn: WsConnection, body: unknown) => {
    let text: string;
    try {
      text = JSON.stringify(body);
    } catch (e) {
      text = JSON.stringify(rpcError(null, { code: RPC_ERRORS.internal, message: `internal error: ${(e as Error)?.message ?? String(e)}`.slice(0, 500) }));
    }
    conn.send(text);
  };

  const onMessage = (conn: WsConnection, text: string) => {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      sendJson(conn, rpcError(null, { code: RPC_ERRORS.parse, message: "not JSON" }));
      return;
    }
    if (Array.isArray(msg)) {
      if (!msg.length || msg.length > MAX_BATCH) return sendJson(conn, rpcError(null, { code: RPC_ERRORS.invalidRequest, message: `a batch holds 1 to ${MAX_BATCH} requests` }));
      const replies = msg.map((m) => handle(m)).filter((r): r is object => r !== undefined);
      if (replies.length) sendJson(conn, replies);
      return;
    }
    const r = handle(msg);
    if (r) sendJson(conn, r);
  };

  const unsubscribe = service.subscribe((event: BoardEvent) => {
    const text = JSON.stringify({ jsonrpc: "2.0", method: "board.event", params: event });
    for (const c of conns) c.send(text);
  });

  try {
    await new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen({ port: options.port ?? 0, host: "127.0.0.1", exclusive: true }, () => {
        server.off("error", fail);
        done();
      });
    });
  } catch (e) {
    unsubscribe();
    throw e;
  }
  port = (server.address() as AddressInfo).port;
  hosts = hostsFor(port);

  // service.json: written whole (temp file and rename), readable by this user only
  let serviceFile: string | undefined;
  const wanted = options.serviceFile ?? true;
  if (wanted) {
    const file = typeof wanted === "string" ? wanted : service.localDir ? join(service.localDir, SERVICE_FILE) : undefined;
    if (file) {
      const body: ServiceFile = { pid: process.pid, port, token, epoch: service.epoch, host: "127.0.0.1", protocol: BOARD_PROTOCOL, ...(service.dir ? { dir: service.dir } : {}) };
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
      renameSync(tmp, file);
      serviceFile = file;
    }
  }

  let closing: Promise<void> | undefined;
  return {
    url: `ws://127.0.0.1:${port}/`,
    port,
    token,
    ...(serviceFile ? { serviceFile } : {}),
    connections: () => conns.size,
    close() {
      return (closing ??= new Promise<void>((done) => {
        unsubscribe();
        if (serviceFile) {
          try {
            const held = JSON.parse(readFileSync(serviceFile, "utf8")) as Partial<ServiceFile>;
            if (held.pid === process.pid && held.port === port) rmSync(serviceFile, { force: true });
          } catch {
            // gone already
          }
        }
        for (const c of conns) c.close(CLOSE.goingAway, "the board service is stopping");
        server.close(() => done());
        // give the close frames a moment, then drop what is left
        const t = setTimeout(() => {
          for (const s of sockets) s.destroy();
          server.closeAllConnections?.();
        }, 200);
        t.unref?.();
      }));
    },
  };
}
