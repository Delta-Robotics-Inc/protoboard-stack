/**
 * A viewer tab's connection to the project's `protoboard dev` server (PB-943):
 * load the session's state and bundle, follow its events, and recover.
 *
 * - A load that fails is tried again by itself (2 s, then up to 15 s apart)
 *   and at once on `retry()`; a loopback server that does not answer under
 *   one name (`127.0.0.1`) is tried under the other (`localhost`).
 * - Rebuilds arrive on the server's event stream where the webview can
 *   open one. Where it cannot (VS Code 1.106 to at least 1.120: every
 *   attempt errors, though plain requests work; 1.130 and later can. This is
 *   what left "The dev server is unreachable; retrying…" on a drawn diagram
 *   in beta test 1, on 1.108.2), and while a stream is down
 *   (a laptop that slept, a network that changed: the browser does not
 *   reconnect a cut stream in a webview), the tab asks the server for its
 *   state every second instead, and loads a newer build or a restarted
 *   session when it sees one. A stream the browser gave up is opened again.
 * - Only a server that does not answer the questions either is a lost
 *   connection: said after a few seconds, and cleared when it answers.
 * - Everything it tried and every error goes to `log` (the extension's
 *   Protoboard log), with the URL.
 *
 * No DOM and no React here: the tests drive it with a fake fetch and a fake
 * EventSource.
 */
import type { DevEndpoint } from "./protocol.js";

/** What the tab says over the canvas. */
export interface ViewerStatus {
  message: string;
  busy?: boolean;
  /**
   * The tab cannot read from the dev server: shown in the middle of the tab,
   * with what the dev server is and what to try (Retry, Reload Window, Show
   * Log). Without it the message is a note (a rebuild in progress, a failed
   * rebuild) at the bottom.
   */
  problem?: boolean;
}

/** What the dev server is, in one sentence, for the tab's message. */
export const DEV_SERVER_IS = "The dev server serves this project's model and files to the viewer and rebuilds them when the project changes.";

export interface EventSourceLike {
  readyState: number;
  onopen: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  addEventListener(type: string, listener: (e: { data: string }) => void): void;
  close(): void;
}

export interface DevState {
  session?: string;
  version?: number;
  failed?: boolean;
  /** Why the server does not watch the project (B19): live reload is off. */
  unwatched?: string;
  message?: string;
  views?: unknown[];
  diagnostics?: unknown;
  /** The parts' status by definition id (PB-932), said again with every rebuild. */
  partStatus?: unknown;
}

export interface DevLinkDeps {
  fetch: (url: string, init?: { cache?: "no-store"; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  eventSource: (url: string) => EventSourceLike;
  /** The session's state and bundle, read from `base` (first load, a restart, a reconnect to a newer bundle). */
  onLoad(load: { base: string; state: DevState; bundle: unknown }): void;
  /** A rebuild's bundle (the `bundle` event, or a newer version found by asking: `reason` is then `poll`). */
  onBundle(update: { base: string; bundle: unknown; event: { reason?: string; diagnostics?: unknown; failed?: boolean; message?: string; version?: number; partStatus?: unknown } }): void;
  onStatus(status: ViewerStatus | null): void;
  /** For the extension's log. */
  log(level: "info" | "warn" | "error", message: string): void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  now?: () => number;
  /** How long one request may take (default 10 s). */
  requestTimeoutMs?: number;
  /** How long the event stream may be down before the tab says so (default 4 s). */
  graceMs?: number;
  /** The first wait before a load is tried again (default 2 s; doubles up to 15 s). */
  retryMs?: number;
}

/** The other loopback name of a URL (`127.0.0.1` ⇄ `localhost`), or undefined for any other host. */
export function otherLoopback(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.hostname === "127.0.0.1") u.hostname = "localhost";
    else if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    else return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

/** An error as one line: its name when that says more than the message (`TypeError: Failed to fetch`). */
export function describeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "AbortError") return "no answer in time";
    // what a browser says for a refused, reset or blocked connection
    if (e.name === "TypeError" && /failed to fetch|load failed|networkerror/i.test(e.message)) return `no connection (${e.message})`;
    return e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message;
  }
  return String(e);
}

const MAX_RETRY_MS = 15000;
/** How often the tab asks the server while it has no event stream, and while the server does not answer. */
const POLL_MS = 1000;
const POLL_FAILING_MS = 3000;
/** How long after the browser gave a stream up another one is opened. */
const STREAM_RETRY_MS = 15000;

type BundleEvent = { reason?: string; diagnostics?: unknown; failed?: boolean; message?: string; version?: number; partStatus?: unknown; unwatched?: string };

/** The note a tab keeps at its foot while the stream is fine: a failed rebuild, or live reload off (B19). */
export function restingStatus(s: { failed?: boolean; message?: string; unwatched?: string }): ViewerStatus | null {
  if (s.failed) return { message: s.message ?? "The last rebuild failed; the viewer shows the one before it." };
  if (s.unwatched) return { message: s.unwatched };
  return null;
}

export class DevLink {
  private dev: DevEndpoint | null = null;
  /** The URL the server answers at (the endpoint's, or its other loopback name). */
  private base: string | undefined;
  private events: EventSourceLike | undefined;
  /** Counts connections: work started for an older one is dropped. */
  private generation = 0;
  private retryTimer: unknown;
  /** While the event stream is down the tab asks the server instead (`poll`). */
  private polling = false;
  private pollTimer: unknown;
  private pollFailedAt: number | undefined;
  private saidBuilding = false;
  /** Opens a stream again after the browser gave one up. */
  private streamTimer: unknown;
  /** A stream has delivered events in this page (tests). */
  streamWorked = false;
  private attempts = 0;
  /** When the event stream went down (undefined: it is up). */
  private lostAt: number | undefined;
  /** The lost-connection message is on screen. */
  private lostShown = false;
  private version: number | undefined;
  private everLoaded = false;
  /** What the tab says when the stream is fine (a failed rebuild's note). */
  private resting: ViewerStatus | null = null;

  constructor(private readonly deps: DevLinkDeps) {}

  private get later() {
    return this.deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  }
  private cancel(handle: unknown) {
    if (handle === undefined) return;
    (this.deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(handle);
  }
  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** The endpoint in use (tests). */
  get endpoint(): DevEndpoint | null {
    return this.dev;
  }

  /** The extension said where the server is (`null`: there is none, and `message` says why). */
  set(next: DevEndpoint | null, message?: string, busy?: boolean) {
    if (next && this.dev && next.url === this.dev.url && next.session === this.dev.session) return;
    this.stop();
    this.dev = next;
    if (!next) {
      this.deps.onStatus({ message: message ?? "The dev server is not running.", ...(busy ? { busy: true } : {}), problem: true });
      return;
    }
    this.attempts = 0;
    void this.load(next, ++this.generation);
  }

  /** Try now (the Retry button): load again from the endpoint the tab has. */
  retry() {
    if (!this.dev) return;
    this.deps.log("info", `retry: loading from ${this.dev.url} again`);
    this.stop();
    this.attempts = 0;
    void this.load(this.dev, ++this.generation);
  }

  dispose() {
    this.stop();
    this.dev = null;
    this.generation++;
  }

  private stop() {
    this.cancel(this.retryTimer);
    this.cancel(this.streamTimer);
    this.retryTimer = this.streamTimer = undefined;
    this.stopPolling();
    this.saidBuilding = false;
    this.events?.close();
    this.events = undefined;
    this.lostAt = undefined;
    this.lostShown = false;
  }

  private async get(url: string): Promise<unknown> {
    const ctl = typeof AbortController === "undefined" ? undefined : new AbortController();
    const timer = this.later(() => ctl?.abort(), this.deps.requestTimeoutMs ?? 10000);
    try {
      const res = await this.deps.fetch(url, { cache: "no-store", ...(ctl ? { signal: ctl.signal } : {}) });
      if (!res.ok) throw new Error(`the dev server answered ${res.status}`);
      return await res.json();
    } finally {
      this.cancel(timer);
    }
  }

  /** The state and the bundle from one base URL. */
  private async read(base: string): Promise<{ state: DevState; bundle: unknown }> {
    const state = ((await this.get(new URL("__protoboard/state", base).href)) ?? {}) as DevState;
    const bundle = await this.get(new URL("uhd-bundle.json", base).href);
    return { state, bundle };
  }

  private async load(dev: DevEndpoint, generation: number) {
    const current = () => generation === this.generation;
    if (!this.everLoaded || this.attempts > 0) this.deps.onStatus({ message: this.attempts ? `Trying the dev server at ${new URL(dev.url).host} again…` : "Loading the project…", busy: true, ...(this.attempts ? { problem: true } : {}) });
    const bases = [this.base && otherLoopback(this.base) === dev.url ? this.base : dev.url];
    const other = otherLoopback(bases[0]);
    if (other) bases.push(other);
    const errors: string[] = [];
    for (const base of bases) {
      try {
        const { state, bundle } = await this.read(base);
        if (!current()) return;
        if (base !== dev.url) this.deps.log("warn", `the dev server did not answer at ${dev.url} (${errors[0]}) but does at ${base}: reading from there`);
        else if (this.attempts) this.deps.log("info", `the dev server at ${base} answers again (attempt ${this.attempts + 1})`);
        else this.deps.log("info", `loaded the project from ${base} (session ${state.session ?? "?"}, version ${state.version ?? "?"})`);
        this.base = base;
        this.attempts = 0;
        this.everLoaded = true;
        this.version = typeof state.version === "number" ? state.version : undefined;
        this.deps.onLoad({ base, state, bundle });
        this.resting = restingStatus(state);
        this.deps.onStatus(this.resting);
        this.listen(dev, base, generation);
        return;
      } catch (e) {
        if (!current()) return;
        errors.push(describeError(e));
        this.deps.log("error", `GET ${base} failed: ${describeError(e)}${(globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine === false ? " (the browser reports it is offline)" : ""}`);
      }
    }
    this.attempts++;
    const wait = Math.min((this.deps.retryMs ?? 2000) * 2 ** (this.attempts - 1), MAX_RETRY_MS);
    this.deps.onStatus({ message: `The dev server at ${new URL(dev.url).host} is not answering: ${errors[0]}. Retrying…`, busy: true, problem: true });
    this.retryTimer = this.later(() => {
      this.retryTimer = undefined;
      if (current()) void this.load(dev, generation);
    }, wait);
  }

  private listen(dev: DevEndpoint, base: string, generation: number) {
    const current = () => generation === this.generation;
    const url = new URL("__protoboard/events", base).href;
    const es = (this.events = this.deps.eventSource(url));
    /** This stream delivered something: the browser can stream from the server at all. */
    let opened = false;
    let errors = 0;
    const up = () => {
      if (!current()) return;
      opened = true;
      errors = 0;
      this.streamWorked = true;
      if (this.polling) {
        this.deps.log("info", `events from ${url} are back${this.lostAt !== undefined ? ` after ${((this.now() - this.lostAt) / 1000).toFixed(1)} s` : ""}`);
        this.stopPolling();
      }
      this.lostAt = undefined;
      if (this.lostShown) {
        this.lostShown = false;
        this.deps.onStatus(this.resting);
      }
    };
    es.onopen = up;
    es.addEventListener("hello", (e) => {
      if (!current()) return;
      up();
      let hello: { session?: string; version?: number } = {};
      try {
        hello = JSON.parse(e.data);
      } catch {
        return;
      }
      // a restarted server (the extension follows with its new session), or a rebuild missed while the stream was down
      if (hello.session && dev.session && hello.session !== dev.session) return this.reload(dev, `the dev server at ${base} restarted (session ${hello.session})`);
      if (typeof hello.version === "number" && this.version !== undefined && hello.version !== this.version) return this.reload(dev, `the dev server at ${base} has a newer build (version ${hello.version}, shown ${this.version})`);
    });
    es.addEventListener("status", (e) => {
      if (!current()) return;
      const s = JSON.parse(e.data) as { state?: string; message?: string };
      this.deps.onStatus(s.state === "error" ? { message: s.message ?? "error" } : s.state === "busy" ? { message: s.message ?? "building", busy: true } : this.resting);
    });
    // the server could not watch the project's files (B19): live reload is off, and the tab says so
    es.addEventListener("watch", (e) => {
      if (!current()) return;
      let w: { unwatched?: string } = {};
      try {
        w = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!w.unwatched || this.resting) return;
      this.resting = { message: w.unwatched };
      this.deps.onStatus(this.resting);
    });
    es.addEventListener("bundle", (e) => {
      if (!current()) return;
      const event = JSON.parse(e.data) as BundleEvent;
      void this.rebuilt(base, event, generation);
    });
    es.onerror = () => {
      if (!current() || this.events !== es) return;
      errors++;
      const gaveUp = es.readyState === 2;
      if (!opened && !gaveUp && errors < 2) return; // one failed attempt: the browser tries again
      if (this.lostAt === undefined) this.lostAt = this.now();
      if (!this.polling) {
        // the webviews of VS Code before about 1.130 never open an event stream to a loopback server (every attempt
        // errors), and newer ones do not reconnect one that was cut: either way the tab follows the server by asking it
        this.deps.log(
          opened ? "warn" : "info",
          opened
            ? `events from ${url} stopped (${gaveUp ? "the browser will not reconnect" : "the browser is reconnecting"}); asking the server every second meanwhile`
            : `this VS Code's webview cannot open an event stream to ${url} (${errors} attempt${errors === 1 ? "" : "s"} failed); following the server by asking it every second instead`,
        );
        this.startPolling(dev, base, generation);
      }
      if (!opened) {
        // it never worked here: stop the browser's attempts (each one is an error in the console)
        es.close();
        if (this.events === es) this.events = undefined;
        return;
      }
      // it worked and the browser gave it up: open another one in a while (the polling goes on until it is up)
      if (gaveUp && this.streamTimer === undefined) {
        this.streamTimer = this.later(() => {
          this.streamTimer = undefined;
          if (!current()) return;
          es.close();
          this.listen(dev, base, generation);
        }, STREAM_RETRY_MS);
      }
    };
  }

  private reload(dev: DevEndpoint, why: string) {
    this.deps.log("info", `${why}: loading the project again`);
    this.stop();
    void this.load(dev, ++this.generation);
  }

  /** A rebuild: read the bundle again. */
  private async rebuilt(base: string, event: BundleEvent, generation: number) {
    try {
      const bundle = await this.get(new URL("uhd-bundle.json", base).href);
      if (generation !== this.generation) return;
      if (typeof event.version === "number") this.version = event.version;
      this.deps.onBundle({ base, bundle, event });
      this.resting = restingStatus(event);
      this.deps.onStatus(this.resting);
    } catch (err) {
      if (generation !== this.generation) return;
      this.deps.log("error", `GET ${new URL("uhd-bundle.json", base).href} after a rebuild failed: ${describeError(err)}`);
      this.deps.onStatus({ message: `The rebuilt project could not be read from the dev server: ${describeError(err)}` });
    }
  }

  private startPolling(dev: DevEndpoint, base: string, generation: number) {
    this.polling = true;
    this.pollFailedAt = undefined;
    const tick = () => {
      this.pollTimer = this.later(() => {
        this.pollTimer = undefined;
        if (generation !== this.generation || !this.polling) return;
        void this.poll(dev, base, generation).then(() => {
          if (generation === this.generation && this.polling) tick();
        });
      }, this.pollFailedAt === undefined ? POLL_MS : POLL_FAILING_MS);
    };
    tick();
  }

  private stopPolling() {
    this.polling = false;
    this.cancel(this.pollTimer);
    this.pollTimer = undefined;
    this.pollFailedAt = undefined;
  }

  /** Ask the server what it has: a new session or version is loaded, a build in progress is said. */
  private async poll(dev: DevEndpoint, base: string, generation: number) {
    let state: DevState & { building?: boolean };
    try {
      state = ((await this.get(new URL("__protoboard/state", base).href)) ?? {}) as DevState & { building?: boolean };
    } catch (e) {
      if (generation !== this.generation) return;
      if (this.pollFailedAt === undefined) {
        this.pollFailedAt = this.now();
        this.deps.log("error", `GET ${new URL("__protoboard/state", base).href} failed: ${describeError(e)}`);
      }
      // a short gap says nothing
      if (!this.lostShown && this.now() - this.pollFailedAt >= (this.deps.graceMs ?? 4000)) {
        this.lostShown = true;
        this.deps.onStatus({ message: `Lost the dev server at ${new URL(base).host}: ${describeError(e)}. Retrying…`, busy: true, problem: true });
      }
      return;
    }
    if (generation !== this.generation) return;
    if (this.pollFailedAt !== undefined) {
      this.deps.log("info", `the dev server at ${base} answers again after ${((this.now() - this.pollFailedAt) / 1000).toFixed(1)} s`);
      this.pollFailedAt = undefined;
    }
    if (this.lostShown) {
      this.lostShown = false;
      this.deps.onStatus(this.resting);
    }
    if (state.session && dev.session && state.session !== dev.session) return this.reload(dev, `the dev server at ${base} restarted (session ${state.session})`);
    if (typeof state.version === "number" && state.version !== this.version) {
      await this.rebuilt(base, { version: state.version, reason: "poll", diagnostics: state.diagnostics, failed: state.failed, message: state.message, partStatus: state.partStatus }, generation);
      this.saidBuilding = false;
    } else if (state.building && !this.saidBuilding) {
      this.saidBuilding = true;
      this.deps.onStatus({ message: "rebuilding", busy: true });
    } else if (!state.building && this.saidBuilding) {
      this.saidBuilding = false;
      this.deps.onStatus(this.resting);
    }
  }
}
