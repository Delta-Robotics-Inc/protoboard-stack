/**
 * The browser side of a schematic feed: a `SchematicSource` the screen reads synchronously, kept current by the
 * host's messages (`SchematicFeedMessage`). The host (./host, Node) is the schematic service's client; the page never
 * holds the service's token. Writes go the other way as requests (`SchematicChannel.request`: a POST to the dev
 * server's route, or a postMessage a VS Code host answers); the host decides who acts, and the effects come back on
 * the feed. No Node.
 */
import type { Box, PageDerived, PageItem, PageLogEntry, PageModel, SchematicEntry, SchematicFeedMessage, SchematicReply, SchematicRequest } from "./types.js";

type SnapshotMessage = Extract<SchematicFeedMessage, { type: "snapshot" }>;
export type SchematicEvent =
  | { type: "model" }
  | { type: "commit"; seq: number; entry: PageLogEntry; changed: string[]; removed: string[] }
  | { type: "derived" }
  | { type: "saved"; seq: number }
  | { type: "checkpoint"; seq: number; label: string; committed?: string; error?: string }
  | { type: "presence" }
  | { type: "error"; message: string };

export class SchematicSource {
  model: PageModel;
  readonly items = new Map<string, PageItem>();
  log: PageLogEntry[];
  derived: PageDerived | undefined;
  /** score by seq, as the derived data arrived (the timeline's readability lane) */
  readonly scores: { seq: number; score: number; gates: number }[] = [];
  saved: number | undefined;
  checkpoints: { seq: number; label: string; committed?: string; error?: string }[] = [];
  leases: { holder: string; purpose: string; expiresAt: number }[] = [];
  mode: "service" | "local";
  error: string | undefined;
  private readonly listeners = new Set<(e: SchematicEvent) => void>();

  constructor(
    readonly key: string,
    first: SnapshotMessage,
  ) {
    this.model = first.model;
    this.log = first.log;
    this.mode = first.mode;
    if (first.saved !== undefined) this.saved = first.saved;
    for (const it of first.model.items) this.items.set(it.id, it);
  }

  get seq(): number {
    return this.model.seq;
  }

  subscribe(listener: (e: SchematicEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit(e: SchematicEvent) {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error(err);
      }
    }
  }

  receive(m: SchematicFeedMessage): void {
    if (m.key !== this.key) return;
    switch (m.type) {
      case "snapshot":
        this.model = m.model;
        this.log = m.log;
        this.mode = m.mode;
        this.items.clear();
        for (const it of m.model.items) this.items.set(it.id, it);
        this.emit({ type: "model" });
        return;
      case "commit": {
        for (const id of m.removes) this.items.delete(id);
        for (const it of m.puts) this.items.set(it.id, it);
        // keep drawing order: cards, wires, symbols, power symbols, labels, no-connect marks
        const order: Record<string, number> = { card: 0, wire: 1, symbol: 2, power: 3, label: 4, noconnect: 5 };
        const items = [...this.items.values()].sort((a, b) => order[a.kind] - order[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        this.model = { ...this.model, seq: m.seq, epoch: m.epoch, items, junctions: m.junctions, bounds: m.bounds as Box, ...(m.parts ? { parts: m.parts } : {}), firstOpen: this.model.firstOpen };
        this.log = [...this.log, m.entry].slice(-500);
        this.emit({ type: "commit", seq: m.seq, entry: m.entry, changed: m.puts.map((p) => p.id), removed: m.removes });
        return;
      }
      case "derived":
        this.derived = m.derived;
        if (!this.scores.length || this.scores[this.scores.length - 1].seq !== m.derived.seq) this.scores.push({ seq: m.derived.seq, score: m.derived.score, gates: m.derived.gates.open });
        else this.scores[this.scores.length - 1] = { seq: m.derived.seq, score: m.derived.score, gates: m.derived.gates.open };
        this.emit({ type: "derived" });
        return;
      case "saved":
        this.saved = m.seq;
        this.model = { ...this.model, firstOpen: false };
        this.emit({ type: "saved", seq: m.seq });
        return;
      case "checkpoint":
        this.checkpoints = [...this.checkpoints, { seq: m.seq, label: m.label, ...(m.committed ? { committed: m.committed } : {}), ...(m.error ? { error: m.error } : {}) }];
        this.emit({ type: "checkpoint", seq: m.seq, label: m.label, ...(m.committed ? { committed: m.committed } : {}), ...(m.error ? { error: m.error } : {}) });
        return;
      case "presence":
        this.leases = m.leases;
        this.emit({ type: "presence" });
        return;
      case "error":
        this.error = m.message;
        this.emit({ type: "error", message: m.message });
        return;
    }
  }
}

export interface SchematicChannel {
  subscribe(onMessage: (m: SchematicFeedMessage) => void): () => void;
  /** Absent: the host is read only. */
  request?(req: SchematicRequest): Promise<SchematicReply>;
}

/** What a host offers the schematic view: the project's schematics (one per UHD board) and a feed of one. */
export interface SchematicHost {
  list(): SchematicEntry[] | Promise<SchematicEntry[]>;
  open(key: string): SchematicChannel;
}

/** A source over a channel: resolves at the first snapshot; `close` ends the feed. */
export function openSchematicSource(key: string, channel: SchematicChannel, options: { timeoutMs?: number } = {}): Promise<{ source: SchematicSource; close(): void; request?: (req: SchematicRequest) => Promise<SchematicReply> }> {
  return new Promise((resolve, reject) => {
    let source: SchematicSource | undefined;
    const timer = setTimeout(() => {
      if (!source) {
        unsub();
        reject(new Error(`the host sent no schematic for ${key} within ${Math.round((options.timeoutMs ?? 120_000) / 1000)} s`));
      }
    }, options.timeoutMs ?? 120_000);
    const unsub = channel.subscribe((m) => {
      if (m.key !== key) return;
      if (!source) {
        if (m.type === "error") {
          clearTimeout(timer);
          unsub();
          return reject(new Error(m.message));
        }
        if (m.type !== "snapshot") return;
        clearTimeout(timer);
        source = new SchematicSource(key, m);
        return resolve({ source, close: unsub, ...(channel.request ? { request: channel.request } : {}) });
      }
      source.receive(m);
    });
  });
}

/** The dev servers' schematic host: `__protoboard/schematic/list`, an event stream per schematic, and POSTed requests (with the page's token header when the server asks for one). */
export function createEventStreamSchematicHost(options: { base: string; token?: string; tokenHeader?: string }): SchematicHost {
  const url = (path: string, key?: string) => `${options.base}${path}${key ? `?schematic=${encodeURIComponent(key)}` : ""}`;
  return {
    async list() {
      const r = await fetch(url("__protoboard/schematic/list"), { cache: "no-store" });
      if (!r.ok) throw new Error(`the schematic list failed: ${r.status} ${await r.text()}`);
      return ((await r.json()) as { schematics: SchematicEntry[] }).schematics;
    },
    open(key) {
      return {
        subscribe(onMessage) {
          const es = new EventSource(url("__protoboard/schematic/events", key));
          es.onmessage = (ev) => {
            try {
              onMessage(JSON.parse(String(ev.data)) as SchematicFeedMessage);
            } catch (e) {
              console.error("a schematic feed message was not JSON", e);
            }
          };
          return () => es.close();
        },
        async request(req) {
          const r = await fetch(url("__protoboard/schematic/request", key), { method: "POST", headers: { "content-type": "application/json", ...(options.token && options.tokenHeader ? { [options.tokenHeader]: options.token } : {}) }, body: JSON.stringify(req) });
          const text = await r.text();
          try {
            const j = JSON.parse(text) as Partial<SchematicReply> & { error?: string };
            return typeof j.ok === "boolean" ? (j as SchematicReply) : { ok: false, error: j.error ?? `the host answered ${r.status}` };
          } catch {
            return { ok: false, error: `the host answered ${r.status}: ${text.slice(0, 200)}` };
          }
        },
      };
    },
  };
}
