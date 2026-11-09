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
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import type { Actor } from "../ops/registry.js";
import type { BoardEvent, BoardService } from "../service.js";
import { BOARD_PROTOCOL, callService, MAX_CONNECTIONS, MAX_MESSAGE_BYTES, METHOD_PARAMS, RPC_ERRORS, SERVICE_FILE, TOKEN_PROTOCOL_PREFIX, type BoardMethod, type RpcError, type ServiceFile } from "./protocol.js";
import { CLOSE, refuseUpgrade, upgradeProblem, WsConnection } from "./ws.js";

export interface ServeOptions {
  /** DEFAULT 0: a free port chosen by the system. */
  port?: number;
  /** DEFAULT: 32 random bytes, hex. */
  token?: string;
  /** Browser origins allowed to connect (exact match, such as the dev server's `http://127.0.0.1:5180`). A request without an Origin header (not a browser) is always allowed. */
  origins?: string[];
  /** DEFAULT 4 MiB: larger messages close the connection (1009). */
  maxMessageBytes?: number;
  /** DEFAULT 32. */
  maxConnections?: number;
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

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
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
  const origins = new Set((options.origins ?? []).map((o) => o.replace(/\/+$/, "")));
  const policy = options.actors ?? (() => undefined);
  const log = options.log ?? (() => {});
  const conns = new Set<WsConnection>();
  const sockets = new Set<Duplex>();
  let port = 0;

  const server: Server = createServer((_req, res) => {
    // plain HTTP gets nothing but the hint that this is a WebSocket endpoint
    res.writeHead(426, { "content-type": "text/plain; charset=utf-8", connection: "close", upgrade: "websocket" });
    res.end("Upgrade Required: the board service speaks JSON-RPC over WebSocket\n");
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    const refuse = (status: number, reason: string) => {
      log(`board server: refused a connection (${reason})`);
      refuseUpgrade(socket, status, reason);
    };
    if (!isLoopback(req.socket.remoteAddress)) return refuse(403, "Forbidden");
    const host = String(req.headers.host ?? "").toLowerCase();
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return refuse(403, "Forbidden");
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(String(origin).replace(/\/+$/, ""))) return refuse(403, "Forbidden");
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
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const conn: WsConnection = WsConnection.accept(req, socket, head, {
      maxMessageBytes: maxBytes,
      ...(protocols.length ? { protocol: BOARD_PROTOCOL } : {}),
      onMessage: (text) => onMessage(conn, text),
      onClose: () => conns.delete(conn),
    });
    conns.add(conn);
    log(`board server: a client connected (${conns.size} connected)`);
  });

  const handle = (msg: unknown): object | undefined => {
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
      setImmediate(() => options.onShutdown!());
      return reply({ result: { stopping: true } });
    }
    try {
      return reply({ result: callService(service, method, params) ?? null });
    } catch (e) {
      return reply({ error: { code: RPC_ERRORS.service, message: (e as Error).message } });
    }
  };

  const onMessage = (conn: WsConnection, text: string) => {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      conn.send(JSON.stringify(rpcError(null, { code: RPC_ERRORS.parse, message: "not JSON" })));
      return;
    }
    if (Array.isArray(msg)) {
      if (!msg.length || msg.length > 64) return conn.send(JSON.stringify(rpcError(null, { code: RPC_ERRORS.invalidRequest, message: "a batch holds 1 to 64 requests" })));
      const replies = msg.map(handle).filter((r): r is object => r !== undefined);
      if (replies.length) conn.send(JSON.stringify(replies));
      return;
    }
    const r = handle(msg);
    if (r) conn.send(JSON.stringify(r));
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
