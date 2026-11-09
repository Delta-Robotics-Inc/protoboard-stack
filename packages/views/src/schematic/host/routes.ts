/**
 * The schematic routes a dev server mounts (Node), beside the board routes: the browser side of the schematic
 * service's proxy. A page never talks to the service itself; the dev server is its client (./feed.ts):
 *
 *   GET  <prefix>list                       the project's schematics, one per UHD board (`{ schematics }`)
 *   GET  <prefix>events?schematic=<key>     an event stream of `SchematicFeedMessage`s (the page model first)
 *   POST <prefix>request?schematic=<key>    a page's request (`SchematicRequest`), JSON in and out; the server says
 *                                           who may (`mayWrite`); a person acts
 *
 * Only the schematics the host lists are served, by key: no route takes a path.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SchematicCircuit } from "@protoboardai/schematic";
import type { SchematicEntry, SchematicFeedMessage } from "../types.js";
import { parseSchematicRequest } from "../requests.js";
import { SchematicFeed } from "./feed.js";

export const SCHEMATIC_ROUTE_PREFIX = "/__protoboard/schematic/";
const MAX_BODY = 1024 * 1024;

/** A schematic a host offers: its entry for pages, its folder, and its circuit from UHD. */
export interface SchematicSourceEntry {
  entry: SchematicEntry;
  dir: string;
  projectRoot?: string;
  circuit: () => SchematicCircuit | Promise<SchematicCircuit>;
}

export interface SchematicRoutesOptions {
  /** The schematics of the project (one per UHD board), as the host finds them. */
  list: () => Promise<SchematicSourceEntry[]> | SchematicSourceEntry[];
  /** Whether a request may write (the dev server's page token and origin). DEFAULT: no one. */
  mayWrite?: (req: IncomingMessage) => boolean;
  /** Feeds without a subscriber close after this long (DEFAULT 30 s). */
  idleMs?: number;
  log?: (line: string) => void;
}

export interface SchematicRoutes {
  handle(req: IncomingMessage, res: ServerResponse, url: URL): boolean;
  list(): Promise<SchematicEntry[]>;
  feed(key: string): Promise<SchematicFeed>;
  close(): Promise<void>;
}

export function createSchematicRoutes(options: SchematicRoutesOptions): SchematicRoutes {
  const feeds = new Map<string, { feed: Promise<SchematicFeed>; idle?: ReturnType<typeof setTimeout> }>();
  let cached: { at: number; list: Promise<SchematicSourceEntry[]> } | undefined;
  const all = () => {
    if (!cached || Date.now() - cached.at > 5000) cached = { at: Date.now(), list: Promise.resolve(options.list()) };
    return cached.list;
  };
  const say = options.log ?? (() => {});
  const feed = async (key: string): Promise<SchematicFeed> => {
    const had = feeds.get(key);
    if (had) {
      clearTimeout(had.idle);
      had.idle = undefined;
      return had.feed;
    }
    const s = (await all()).find((x) => x.entry.key === key);
    if (!s) throw new Error(`no schematic with key ${key} in this project`);
    const p = SchematicFeed.open({ dir: s.dir, key, name: s.entry.name, circuit: s.circuit, ...(s.projectRoot ? { projectRoot: s.projectRoot } : {}), log: say });
    feeds.set(key, { feed: p });
    p.catch(() => feeds.delete(key));
    return p;
  };
  const release = (key: string) => {
    const f = feeds.get(key);
    if (!f) return;
    void f.feed.then((x) => {
      if (x.subscribers) return;
      clearTimeout(f.idle);
      f.idle = setTimeout(() => {
        if (x.subscribers) return;
        feeds.delete(key);
        void x.close();
      }, options.idleMs ?? 30_000);
      f.idle.unref?.();
    });
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  return {
    list: async () => (await all()).map((s) => s.entry),
    feed,
    handle(req, res, url) {
      if (!url.pathname.startsWith(SCHEMATIC_ROUTE_PREFIX)) return false;
      const route = url.pathname.slice(SCHEMATIC_ROUTE_PREFIX.length);
      const key = url.searchParams.get("schematic") ?? "";
      if (route === "list" && (req.method === "GET" || req.method === "HEAD")) {
        all().then(
          (l) => json(res, 200, { schematics: l.map((s) => s.entry) }),
          (e: Error) => json(res, 500, { error: e.message }),
        );
        return true;
      }
      if (route === "events" && req.method === "GET") {
        feed(key).then(
          (f) => {
            res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
            res.write("retry: 2000\n\n");
            const send = (m: SchematicFeedMessage) => {
              if (!res.writableEnded) res.write(`data: ${JSON.stringify(m)}\n\n`);
            };
            const unsub = f.subscribe(send);
            const ping = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 15_000);
            res.on("close", () => {
              clearInterval(ping);
              unsub();
              release(key);
            });
          },
          (e: Error) => json(res, 404, { error: e.message }),
        );
        return true;
      }
      if (route === "request" && req.method === "POST") {
        if (!(options.mayWrite?.(req) ?? false)) {
          json(res, 403, { ok: false, error: "a schematic request needs the page's own request (its token and origin)" });
          return true;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let refused = false;
        req.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY && !refused) {
            refused = true;
            json(res, 413, { ok: false, error: "the request is too large" });
            req.destroy();
          } else if (!refused) chunks.push(c);
        });
        req.on("end", () => {
          if (refused) return;
          let body: unknown;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
          } catch {
            return json(res, 400, { ok: false, error: "the request body is not JSON" });
          }
          const parsed = parseSchematicRequest(body);
          if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error });
          feed(key).then(
            (f) => f.request(parsed.request).then((r) => json(res, 200, r)),
            (e: Error) => json(res, 404, { ok: false, error: e.message }),
          );
        });
        return true;
      }
      json(res, 404, { error: `no schematic route ${route.slice(0, 40)}` });
      return true;
    },
    async close() {
      const open = [...feeds.values()];
      feeds.clear();
      for (const f of open) clearTimeout(f.idle);
      await Promise.all(open.map((f) => f.feed.then((x) => x.close(), () => {})));
    },
  };
}
