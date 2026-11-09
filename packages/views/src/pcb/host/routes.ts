/**
 * The board routes a dev server mounts (Node): the browser side of the board service's proxy. A page never talks
 * to the board service itself (it would need the service's token, and a page's origin is not one the service
 * allows); the dev server is the service's client (./feed.ts) and passes its feed on, read only:
 *
 *   GET  <prefix>list                   the project's board folders (`{ boards: BoardEntry[] }`)
 *   GET  <prefix>events?board=<key>     an event stream of `BoardFeedMessage`s (the snapshot first)
 *   GET  <prefix>derived?board=<key>    the derived data now (checks, ratsnest, fill), JSON
 *   POST <prefix>check?board=<key>      run the checks and the cross-check again (the server says who may)
 *   POST <prefix>request?board=<key>    a page's request (`BoardRequest`: a transaction, undo, redo, save,
 *                                       checkpoint, replay, autoroute, diagnosis, waiver), JSON in and out; the
 *                                       server says who may (`mayWrite`) and who acts (`actor`, DEFAULT a person)
 *
 * Only board folders found under the project root are served, by key: no route takes a path. A request never names
 * its actor: the host decides (../requests.ts refuses a request that tries).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join, relative, resolve, sep } from "node:path";
import { boardKey } from "@protoboardai/board/node";
import type { Actor } from "@protoboardai/board/node";
import { parseBoardRequest } from "../requests.js";
import type { BoardEntry, BoardFeedMessage } from "../types.js";
import { BoardFeed, type BoardFeedOptions } from "./feed.js";

/** The actor a person at a host's screen acts as. */
export const PERSON: Actor = { kind: "human", id: "user" };
/** The largest request body a page may send (a 200-operation transaction is far smaller). */
const MAX_BODY = 1024 * 1024;

export const BOARD_ROUTE_PREFIX = "/__protoboard/board/";

const SKIP = new Set(["node_modules", ".git", ".protoboard", "dist", "release", ".history", "backups"]);

/** Board folders (holding board.jsonl) under `root`, to `depth` folders down, skipping dependency, state and output folders. */
export function findBoards(root: string, depth = 6): BoardEntry[] {
  const out: BoardEntry[] = [];
  const walk = (dir: string, left: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "board.jsonl")) {
      out.push(entryOf(root, dir));
      return;
    }
    if (left <= 0) return;
    for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".")) walk(join(dir, e.name), left - 1);
  };
  walk(resolve(root), depth);
  return out.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}

/** A board folder as the page lists it: key, folder relative to the root, and the board's name. */
export function entryOf(root: string, dir: string): BoardEntry {
  let name = basename(dir);
  try {
    const first = readFileSync(join(dir, "board.jsonl"), "utf8").split(/\r?\n/).find((l) => l.includes('"kind":"board"'));
    const n = first ? (JSON.parse(first) as { name?: unknown }).name : undefined;
    if (typeof n === "string" && n) name = n;
  } catch {
    /* the folder's name */
  }
  return { key: boardKey(resolve(root), resolve(dir)), dir: relative(resolve(root), resolve(dir)).split(sep).join("/") || ".", name };
}

export interface BoardRoutesOptions {
  /** The project root the boards are found under. */
  root: string;
  /** Extra board folders by key (the layout dev page's fixture or a folder given on its command line). */
  extra?: () => { entry: BoardEntry; dir: string }[];
  /** Whether a request may ask for a new check run (the dev server's page token and origin). DEFAULT: no one. */
  mayRecheck?: (req: IncomingMessage) => boolean;
  /** Whether a request may write or run (the dev server's page token and origin). DEFAULT: `mayRecheck`, else no one. */
  mayWrite?: (req: IncomingMessage) => boolean;
  /** Who acts for a page's request: the host's decision, never the page's. DEFAULT a person (`human`). */
  actor?: (req: IncomingMessage) => Actor;
  feed?: Pick<BoardFeedOptions, "analyze" | "debounceMs" | "servicePollMs" | "ownOnWrite" | "origins">;
  /** Feeds without a subscriber close after this long (DEFAULT 30 s). */
  idleMs?: number;
  log?: (line: string) => void;
}

export interface BoardRoutes {
  /** Answer a request under BOARD_ROUTE_PREFIX; false when the path is not one of these routes. */
  handle(req: IncomingMessage, res: ServerResponse, url: URL): boolean;
  list(): BoardEntry[];
  /** The feed of a board by key (opened when needed). */
  feed(key: string): Promise<BoardFeed>;
  close(): Promise<void>;
}

export function createBoardRoutes(options: BoardRoutesOptions): BoardRoutes {
  const feeds = new Map<string, { feed: Promise<BoardFeed>; idle?: ReturnType<typeof setTimeout> }>();
  const all = () => {
    const found = findBoards(options.root).map((entry) => ({ entry, dir: resolve(options.root, entry.dir) }));
    const extra = options.extra?.() ?? [];
    return [...extra, ...found.filter((f) => !extra.some((x) => x.entry.key === f.entry.key))];
  };
  const dirOf = (key: string) => all().find((b) => b.entry.key === key)?.dir;
  const say = options.log ?? (() => {});

  const feed = (key: string): Promise<BoardFeed> => {
    const had = feeds.get(key);
    if (had) {
      clearTimeout(had.idle);
      had.idle = undefined;
      return had.feed;
    }
    const dir = dirOf(key);
    if (!dir || !existsSync(join(dir, "board.jsonl"))) return Promise.reject(new Error(`no board folder with key ${key} in this project`));
    // each board's own project root (its derived data, the zone fill, live under it), not the server's
    const p = BoardFeed.open({ dir, key, ...options.feed, log: say });
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
    list: () => all().map((b) => b.entry),
    feed,
    handle(req, res, url) {
      if (!url.pathname.startsWith(BOARD_ROUTE_PREFIX)) return false;
      const route = url.pathname.slice(BOARD_ROUTE_PREFIX.length);
      const key = url.searchParams.get("board") ?? "";
      if (route === "list" && (req.method === "GET" || req.method === "HEAD")) {
        json(res, 200, { boards: all().map((b) => b.entry) });
        return true;
      }
      if (route === "events" && req.method === "GET") {
        feed(key).then(
          (f) => {
            res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
            res.write("retry: 2000\n\n");
            const send = (m: BoardFeedMessage) => {
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
      if (route === "derived" && req.method === "GET") {
        feed(key)
          .then((f) => f.derivedNow())
          .then(
            (d) => {
              json(res, 200, d);
              release(key);
            },
            (e: Error) => json(res, 404, { error: e.message }),
          );
        return true;
      }
      if (route === "check" && req.method === "POST") {
        if (!(options.mayRecheck?.(req) ?? false)) {
          json(res, 403, { error: "a check run needs the page's own request" });
          return true;
        }
        feed(key).then(
          (f) => {
            f.recheck();
            json(res, 202, { status: "checking" });
          },
          (e: Error) => json(res, 404, { error: e.message }),
        );
        return true;
      }
      if (route === "request" && req.method === "POST") {
        const may = options.mayWrite ?? options.mayRecheck;
        if (!(may?.(req) ?? false)) {
          json(res, 403, { error: "a board request needs the page's own request (its token and origin)" });
          return true;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let refused = false;
        req.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY && !refused) {
            refused = true;
            json(res, 413, { error: "the request is too large" });
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
          const parsed = parseBoardRequest(body);
          if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error });
          const actor = options.actor?.(req) ?? PERSON;
          feed(key).then(
            (f) =>
              f.request(parsed.request, actor).then((r) => {
                json(res, 200, r);
                release(key);
              }),
            (e: Error) => json(res, 404, { ok: false, error: e.message }),
          );
        });
        return true;
      }
      json(res, 404, { error: `no board route ${route.slice(0, 40)}` });
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
