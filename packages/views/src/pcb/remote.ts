/**
 * The browser side of a board feed: a `BoardSource` the layout screen reads synchronously, kept current by the
 * host's messages (`BoardFeedMessage`). The host (./host, Node) is the board service's client; the page never
 * holds the service's token and never writes. Two transports carry the same messages:
 *
 * - the dev servers' event stream (`openEventStreamBoard`: `protoboard dev`, the layout dev page), and
 * - VS Code's postMessage (`openMessageBoard`: the extension host relays its own board client's feed).
 *
 * A commit carries the records it changed, so the page applies it to its document (`withChanges`) and the renderer
 * updates only those objects; a `snapshot` after the first replaces the whole board (the host reloaded it) and is
 * passed on as an `external-change` event.
 *
 * Writes go the other way as requests (`BoardChannel.request`: a POST to the dev server's route, or a postMessage
 * the VS Code extension answers); the host decides who acts, and the effects come back on the feed.
 */
import { BoardIndex, snapshotFromWire, withChanges, type BoardEvent, type BoardSnapshot, type LogEntry, type Presence } from "./board.js";
import type { BoardDerived, BoardEntry, BoardFeedMessage, BoardReplyMessage, BoardRequest, BoardSource } from "./types.js";

/** Feed messages beside the board itself: checkpoints and autoroute runs. */
export type SideMessage = Extract<BoardFeedMessage, { type: "checkpoint" | "route" }>;

type SnapshotMessage = Extract<BoardFeedMessage, { type: "snapshot" }>;

export class RemoteBoardSource implements BoardSource {
  private snap: BoardSnapshot;
  private versions: Record<string, number>;
  private pres: Presence | undefined;
  private entries: LogEntry[] | undefined;
  private readonly listeners = new Set<(e: BoardEvent) => void>();
  private readonly derivedListeners = new Set<(d: BoardDerived | undefined, error?: string) => void>();
  private readonly sideListeners = new Set<(m: SideMessage) => void>();
  /** `service`: a live board service; `files`: the host reads the board's files. */
  mode: "service" | "files";
  derived: BoardDerived | undefined;
  /** The last error the host reported. */
  error: string | undefined;

  constructor(
    readonly board: string,
    first: SnapshotMessage,
  ) {
    this.mode = first.mode;
    this.versions = { ...first.snapshot.versions };
    this.snap = snapshotFromWire(first.snapshot);
    this.pres = first.presence;
    this.entries = first.log;
  }

  snapshot(): BoardSnapshot {
    return this.snap;
  }
  subscribe(listener: (e: BoardEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  presence(): Presence {
    // a host without a presence feed: no leases, no intents (and no holds, once the core lists them)
    return this.pres ?? ({ epoch: this.snap.epoch, seq: this.snap.seq, leases: [], intents: [], holds: [] } as unknown as Presence);
  }
  log(since?: number): LogEntry[] {
    const l = this.entries ?? [];
    return since === undefined ? l : l.filter((e) => e.seq > since);
  }
  /** Derived data (checks, ratsnest, fill) as the host sends it; called at once with what is there. */
  onDerived(listener: (d: BoardDerived | undefined, error?: string) => void): () => void {
    this.derivedListeners.add(listener);
    listener(this.derived, this.error);
    return () => void this.derivedListeners.delete(listener);
  }

  /** Checkpoints and autoroute runs as the host reports them. */
  onSide(listener: (m: SideMessage) => void): () => void {
    this.sideListeners.add(listener);
    return () => void this.sideListeners.delete(listener);
  }

  /** Apply one message of the host's feed. */
  receive(m: BoardFeedMessage): void {
    if (m.board !== this.board) return;
    switch (m.type) {
      case "snapshot": {
        this.mode = m.mode;
        this.versions = { ...m.snapshot.versions };
        this.snap = snapshotFromWire(m.snapshot);
        if (m.presence) this.pres = m.presence;
        if (m.log) this.entries = m.log;
        this.emit({ type: "external-change", files: [] });
        return;
      }
      case "commit": {
        const doc = withChanges(this.snap.doc, m.puts, m.removes);
        for (const id of m.removes) delete this.versions[id];
        Object.assign(this.versions, m.versions);
        const versions = { ...this.versions };
        let index: BoardIndex | undefined;
        this.snap = {
          epoch: m.event.epoch,
          seq: m.event.seq,
          doc,
          version: (id: string) => versions[id] ?? 0,
          get query() {
            return (index ??= BoardIndex.build(doc));
          },
        };
        if (m.log) this.entries = m.log;
        this.emit(m.event);
        return;
      }
      case "presence":
        this.pres = m.presence;
        this.emit({ type: "presence", presence: m.presence });
        return;
      case "saved":
        this.emit({ type: "saved", seq: m.seq, files: m.files as Extract<BoardEvent, { type: "saved" }>["files"] });
        return;
      case "derived":
        this.derived = m.derived;
        this.error = undefined;
        for (const l of [...this.derivedListeners]) l(this.derived);
        return;
      case "error":
        this.error = m.message;
        for (const l of [...this.derivedListeners]) l(this.derived, m.message);
        return;
      case "checkpoint":
      case "route":
        for (const l of [...this.sideListeners]) l(m);
        return;
    }
  }

  private emit(e: BoardEvent) {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

/** A board feed's channel: messages in, and the requests a page may make (a new check run). */
export interface BoardChannel {
  subscribe(onMessage: (m: BoardFeedMessage) => void): () => void;
  /** Ask the host to run the checks (and the cross-check) again. */
  recheck?(): void;
  /** Ask the host to write or run something (absent: the host is read only). The host decides who acts. */
  request?(req: BoardRequest): Promise<BoardReplyMessage>;
}

/** What a host offers the layout view: the project's board folders, and a feed of one. */
export interface BoardHost {
  list(): BoardEntry[] | Promise<BoardEntry[]>;
  open(key: string): BoardChannel;
}

/** A board source over a channel: resolves at the first snapshot; `close` ends the feed. */
export function openBoardSource(key: string, channel: BoardChannel, options: { timeoutMs?: number } = {}): Promise<{ source: RemoteBoardSource; close(): void; recheck?: () => void; request?: (req: BoardRequest) => Promise<BoardReplyMessage> }> {
  return new Promise((resolve, reject) => {
    let source: RemoteBoardSource | undefined;
    const timer = setTimeout(() => {
      if (!source) {
        unsub();
        reject(new Error(`the host sent no board for ${key} within ${Math.round((options.timeoutMs ?? 60_000) / 1000)} s`));
      }
    }, options.timeoutMs ?? 60_000);
    const unsub = channel.subscribe((m) => {
      if (m.board !== key) return;
      if (!source) {
        if (m.type === "error") {
          clearTimeout(timer);
          unsub();
          return reject(new Error(m.message));
        }
        if (m.type !== "snapshot") return;
        clearTimeout(timer);
        source = new RemoteBoardSource(key, m);
        return resolve({ source, close: unsub, ...(channel.recheck ? { recheck: channel.recheck } : {}), ...(channel.request ? { request: channel.request } : {}) });
      }
      source.receive(m);
    });
  });
}

/**
 * The dev servers' board host: `GET <base>__protoboard/board/list` for the folders, an event stream
 * (`__protoboard/board/events?board=<key>`) per open board, `POST __protoboard/board/check?board=<key>` (with the
 * page's token header, when the server asks for one) to run the checks again, and `POST
 * __protoboard/board/request?board=<key>` for a page's request (`BoardRequest`, JSON).
 */
export function createEventStreamBoardHost(options: { base: string; token?: string; tokenHeader?: string }): BoardHost {
  const url = (path: string, key?: string) => `${options.base}${path}${key ? `?board=${encodeURIComponent(key)}` : ""}`;
  return {
    async list() {
      const r = await fetch(url("__protoboard/board/list"), { cache: "no-store" });
      if (!r.ok) throw new Error(`the board list failed: ${r.status} ${await r.text()}`);
      return ((await r.json()) as { boards: BoardEntry[] }).boards;
    },
    open(key) {
      return {
        subscribe(onMessage) {
          const es = new EventSource(url("__protoboard/board/events", key));
          es.onmessage = (ev) => {
            try {
              onMessage(JSON.parse(String(ev.data)) as BoardFeedMessage);
            } catch (e) {
              console.error("a board feed message was not JSON", e);
            }
          };
          return () => es.close();
        },
        recheck() {
          void fetch(url("__protoboard/board/check", key), { method: "POST", headers: { "content-type": "application/json", ...(options.token && options.tokenHeader ? { [options.tokenHeader]: options.token } : {}) }, body: "{}" });
        },
        async request(req) {
          const r = await fetch(url("__protoboard/board/request", key), { method: "POST", headers: { "content-type": "application/json", ...(options.token && options.tokenHeader ? { [options.tokenHeader]: options.token } : {}) }, body: JSON.stringify(req) });
          const text = await r.text();
          try {
            const j = JSON.parse(text) as Partial<BoardReplyMessage> & { error?: string };
            return typeof j.ok === "boolean" ? (j as BoardReplyMessage) : { ok: false, error: j.error ?? `the host answered ${r.status}` };
          } catch {
            return { ok: false, error: `the host answered ${r.status}: ${text.slice(0, 200)}` };
          }
        },
      };
    },
  };
}
