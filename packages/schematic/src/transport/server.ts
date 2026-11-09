/**
 * `serveSchematic`: the schematic service on the wire, as `serveBoard` serves a board (board core section 10).
 * JSON-RPC 2.0 over WebSocket on 127.0.0.1, a random token per run, `service.json` in the schematic's local folder
 * while it runs, and `schematic.event` notifications of every commit, presence change and save to every client.
 *
 * The WebSocket framing, the upgrade checks and the limits are the board's (`WsConnection`, `upgradeProblem`,
 * `refuseUpgrade`, `isLoopback`, its constants): who may connect is decided exactly as for a board (loopback peers,
 * a Host header naming the loopback address, browser origins allowed by name, the token from `service.json`), and
 * which actor kinds a connection may name is the `actors` policy. Node only.
 */
import type { z } from "zod";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { CLOSE, HANDSHAKE_SLACK, HANDSHAKE_TIMEOUT_MS, isLoopback, KEEPALIVE_MS, MAX_BATCH, MAX_CONNECTIONS, MAX_MESSAGE_BYTES, MAX_SEND_BUFFER_BYTES, refuseUpgrade, RPC_ERRORS, TOKEN_PROTOCOL_PREFIX, upgradeProblem, WsConnection, type Actor, type RpcError } from "@protoboardai/board/node";
import type { SchematicEvent, SchematicService } from "../service.ts";
import { callSchematicService } from "./dispatch.ts";
import { SCHEMATIC_EVENT, SCHEMATIC_METHOD_PARAMS, SCHEMATIC_PROTOCOL, SCHEMATIC_SERVICE_FILE, type SchematicMethod, type SchematicServiceFile } from "./protocol.ts";

export interface SchematicServeOptions {
  /** DEFAULT 0: a free port chosen by the system. */
  port?: number;
  /** DEFAULT: 32 random bytes, hex. */
  token?: string;
  /** Browser origins allowed to connect (exact match; `null` never). A request without an Origin header (not a browser) is allowed. */
  origins?: string[];
  /** DEFAULT 4 MiB. */
  maxMessageBytes?: number;
  /** DEFAULT 32. */
  maxConnections?: number;
  /** DEFAULT 30 s; 0 turns the keepalive off. */
  keepaliveMs?: number;
  /** DEFAULT 32 MiB. */
  maxSendBufferBytes?: number;
  /** DEFAULT 10 s. */
  handshakeTimeoutMs?: number;
  /** DEFAULT 1 s. */
  closeTimeoutMs?: number;
  /** DEFAULT true: write `<local folder>/service.json` while serving (needs a schematic folder). A string writes it there instead. */
  serviceFile?: boolean | string;
  /** Which actors a connection may name: a reason to refuse, or undefined to allow. DEFAULT: every wire actor. */
  actors?: (actor: Actor) => string | undefined;
  /** Diagnostic lines. */
  log?: (line: string) => void;
  /** Offer `schematic.shutdown`: called (after the reply is sent) when a client asks the serving process to stop. */
  onShutdown?: () => void;
  /** Extra methods a host offers beside the schematic's own; an `actor` or `by` param passes the actor policy. */
  methods?: Record<string, SchematicExtensionMethod>;
}

export interface SchematicExtensionMethod {
  params: z.ZodTypeAny;
  run(params: unknown): unknown;
}

export interface SchematicServer {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  readonly serviceFile?: string;
  connections(): number;
  /** Close every connection, stop listening and remove `service.json`. The service itself stays open. */
  close(): Promise<void>;
}

function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a, "utf8").digest(), createHash("sha256").update(b, "utf8").digest());
}
const normalOrigin = (o: string): string => o.trim().toLowerCase().replace(/\/+$/, "");
function hostsFor(port: number): Set<string> {
  const names = ["127.0.0.1", "localhost", "[::1]"];
  return new Set([...names.map((n) => `${n}:${port}`), ...(port === 80 ? names : [])]);
}
function tokenOf(req: IncomingMessage, protocols: string[]): string | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""));
  if (m) return m[1];
  const p = protocols.find((x) => x.startsWith(TOKEN_PROTOCOL_PREFIX));
  return p ? p.slice(TOKEN_PROTOCOL_PREFIX.length) : undefined;
}
const rpcError = (id: unknown, error: RpcError) => ({ jsonrpc: "2.0" as const, id: id ?? null, error });
const issuesText = (issues: z.ZodIssue[]) => issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; ");

/** Serve a schematic service until `close()`. Resolves once listening (and `service.json` is written). */
export async function serveSchematic(service: SchematicService, options: SchematicServeOptions = {}): Promise<SchematicServer> {
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

  const server: Server = createServer({ headersTimeout: handshakeMs, requestTimeout: handshakeMs, connectionsCheckingInterval: Math.max(50, Math.min(1000, Math.floor(handshakeMs / 4))) }, (_req, res) => {
    res.writeHead(426, { "content-type": "text/plain; charset=utf-8", connection: "close", upgrade: "websocket" });
    res.end("Upgrade Required: the schematic service speaks JSON-RPC over WebSocket\n");
  });
  server.maxConnections = maxConns + HANDSHAKE_SLACK;
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
      log(`schematic server: refused a connection (${reason})`);
      refuseUpgrade(socket, status, reason);
    };
    try {
      if (!isLoopback(req.socket.remoteAddress)) return refuse(403, "Forbidden");
      const host = req.headers.host;
      if (typeof host !== "string" || !hosts.has(host.toLowerCase())) return refuse(403, "Forbidden");
      const origin = req.headers.origin;
      if (origin !== undefined && !origins.has(origin)) return refuse(403, "Forbidden");
      if (upgradeProblem(req)) return refuse(400, "Bad Request");
      const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (protocols.length && !protocols.includes(SCHEMATIC_PROTOCOL)) return refuse(400, "Bad Request");
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
        ...(protocols.length ? { protocol: SCHEMATIC_PROTOCOL } : {}),
        onMessage: (text) => onMessage(conn, text),
        onClose: () => conns.delete(conn),
      });
      conns.add(conn);
      log(`schematic server: a client connected (${conns.size} connected)`);
    } catch (e) {
      log(`schematic server: dropped a connection (${(e as Error)?.message ?? String(e)})`);
      socket.destroy();
    }
  });

  const checkActors = (params: { actor?: Actor; by?: Actor } | undefined): string | undefined => {
    for (const a of [params?.actor, params?.by]) {
      const why = a ? policy(a) : undefined;
      if (why) return why;
    }
    return undefined;
  };

  const handleOne = (msg: unknown): object | undefined | Promise<object | undefined> => {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return rpcError(null, { code: RPC_ERRORS.invalidRequest, message: "a request is a JSON object" });
    const m = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    const hasId = "id" in m;
    const id = m.id;
    if (m.jsonrpc !== "2.0" || typeof m.method !== "string" || (hasId && id !== null && typeof id !== "string" && typeof id !== "number")) return rpcError(hasId ? id : null, { code: RPC_ERRORS.invalidRequest, message: 'expected { jsonrpc: "2.0", id, method, params }' });
    const reply = (body: { result: unknown } | { error: RpcError }) => (hasId ? { jsonrpc: "2.0" as const, id, ...body } : undefined);
    const own = Object.prototype.hasOwnProperty.call(SCHEMATIC_METHOD_PARAMS, m.method);
    const ext = !own && options.methods && Object.prototype.hasOwnProperty.call(options.methods, m.method) ? options.methods[m.method] : undefined;
    if (ext) {
      const parsed = ext.params.safeParse(m.params ?? undefined);
      if (!parsed.success) return reply({ error: { code: RPC_ERRORS.invalidParams, message: issuesText(parsed.error.issues), data: parsed.error.issues } });
      const why = checkActors(parsed.data as { actor?: Actor; by?: Actor } | undefined);
      if (why) return reply({ error: { code: RPC_ERRORS.actor, message: why } });
      try {
        const out = ext.run(parsed.data);
        if (out && typeof (out as Promise<unknown>).then === "function")
          return (out as Promise<unknown>).then(
            (v) => reply({ result: v ?? null }),
            (e) => reply({ error: { code: RPC_ERRORS.service, message: (e as Error)?.message ?? String(e) } }),
          );
        return reply({ result: out ?? null });
      } catch (e) {
        return reply({ error: { code: RPC_ERRORS.service, message: (e as Error).message } });
      }
    }
    if (!own) return reply({ error: { code: RPC_ERRORS.methodNotFound, message: `no method ${m.method.slice(0, 80)}` } });
    const method = m.method as SchematicMethod;
    const parsed = SCHEMATIC_METHOD_PARAMS[method].safeParse(m.params ?? undefined);
    if (!parsed.success) return reply({ error: { code: RPC_ERRORS.invalidParams, message: issuesText(parsed.error.issues), data: parsed.error.issues } });
    const why = checkActors(parsed.data as { actor?: Actor; by?: Actor } | undefined);
    if (why) return reply({ error: { code: RPC_ERRORS.actor, message: why } });
    if (method === "schematic.shutdown") {
      if (!options.onShutdown) return reply({ error: { code: RPC_ERRORS.methodNotFound, message: "this server cannot be stopped by a client" } });
      setImmediate(() => {
        try {
          options.onShutdown!();
        } catch (e) {
          log(`schematic server: shutdown failed (${(e as Error)?.message ?? String(e)})`);
        }
      });
      return reply({ result: { stopping: true } });
    }
    try {
      return reply({ result: callSchematicService(service, method, parsed.data) ?? null });
    } catch (e) {
      return reply({ error: { code: RPC_ERRORS.service, message: (e as Error).message } });
    }
  };

  const handle = (msg: unknown): object | undefined | Promise<object | undefined> => {
    try {
      return handleOne(msg);
    } catch (e) {
      const id = msg && typeof msg === "object" && !Array.isArray(msg) ? (msg as { id?: unknown }).id : null;
      return rpcError(typeof id === "string" || typeof id === "number" ? id : null, { code: RPC_ERRORS.internal, message: `internal error: ${(e as Error)?.message ?? String(e)}`.slice(0, 500) });
    }
  };

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
      const all = msg.map((x) => handle(x));
      const send = (rs: (object | undefined)[]) => {
        const replies = rs.filter((r): r is object => r !== undefined);
        if (replies.length) sendJson(conn, replies);
      };
      if (all.some((r) => r instanceof Promise)) void Promise.all(all).then(send);
      else send(all as (object | undefined)[]);
      return;
    }
    const r = handle(msg);
    if (r instanceof Promise) void r.then((x) => x && sendJson(conn, x));
    else if (r) sendJson(conn, r);
  };

  const unsubscribe = service.subscribe((event: SchematicEvent) => {
    const text = JSON.stringify({ jsonrpc: "2.0", method: SCHEMATIC_EVENT, params: event });
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

  let serviceFile: string | undefined;
  const wanted = options.serviceFile ?? true;
  if (wanted) {
    const file = typeof wanted === "string" ? wanted : service.localDir ? join(service.localDir, SCHEMATIC_SERVICE_FILE) : undefined;
    if (file) {
      const body: SchematicServiceFile = { pid: process.pid, port, token, epoch: service.epoch, host: "127.0.0.1", protocol: SCHEMATIC_PROTOCOL, ...(service.dir ? { dir: service.dir } : {}) };
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
            const held = JSON.parse(readFileSync(serviceFile, "utf8")) as Partial<SchematicServiceFile>;
            if (held.pid === process.pid && held.port === port) rmSync(serviceFile, { force: true });
          } catch {
            // gone already
          }
        }
        for (const c of conns) c.close(CLOSE.goingAway, "the schematic service is stopping");
        server.close(() => done());
        const t = setTimeout(() => {
          for (const s of sockets) s.destroy();
          server.closeAllConnections?.();
        }, 200);
        t.unref?.();
      }));
    },
  };
}
