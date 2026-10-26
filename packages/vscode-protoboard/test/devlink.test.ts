/**
 * A viewer tab's connection to the dev server (PB-943; web-viewer's
 * devLink.ts), with a fake fetch, a fake EventSource and fake timers: the
 * first load, the other loopback name, retries, an event stream that drops
 * and comes back (the message of beta test 1 that never went away), one the
 * browser gave up on, and a reconnect to a newer build.
 */
import { describe, expect, it } from "vitest";
import { DEV_SERVER_IS, DevLink, describeError, otherLoopback, restingStatus, type DevLinkDeps, type EventSourceLike, type ViewerStatus } from "../../web-viewer/src/vscode/devLink.js";
import { parseFromWebview } from "../../web-viewer/src/vscode/protocol.js";
import { fitTabs } from "../../web-viewer/src/vscode/tabs-fit.js";
import { readFileSync } from "node:fs";
import { cliError, resolveNode, type NodeLookup } from "../src/cli.js";
import { whyNoDev, type FetchLike } from "../src/dev.js";

class FakeSource implements EventSourceLike {
  readyState = 0;
  onopen: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, l: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(type: string, data: unknown) {
    for (const l of this.listeners.get(type) ?? []) l({ data: JSON.stringify(data) });
  }
  /** The connection dropped; the browser reconnects (`fatal`: it gave up). */
  drop(fatal = false) {
    this.readyState = fatal ? 2 : 0;
    this.onerror?.({});
  }
}

function rig(servers: Record<string, { session: string; version: number; failed?: boolean; message?: string } | Error | number>) {
  const statuses: (ViewerStatus | null)[] = [];
  const logs: string[] = [];
  const loads: { base: string; version?: number }[] = [];
  const bundles: unknown[] = [];
  const sources: FakeSource[] = [];
  const requests: string[] = [];
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let now = 0;
  let ids = 0;
  const deps: DevLinkDeps = {
    fetch: async (url) => {
      requests.push(url);
      const u = new URL(url);
      const server = servers[u.origin + "/"];
      if (server === undefined || server instanceof Error) throw server ?? new TypeError("Failed to fetch");
      if (typeof server === "number") return { ok: false, status: server, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => (u.pathname === "/__protoboard/state" ? { ...server, views: [] } : { bundle: server.version }) };
    },
    eventSource: (url) => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    },
    onLoad: (l) => loads.push({ base: l.base, version: l.state.version }),
    onBundle: (b) => bundles.push(b.bundle),
    onStatus: (s) => statuses.push(s),
    log: (level, message) => logs.push(`${level}: ${message}`),
    setTimeout: (fn, ms) => {
      timers.push({ fn, at: now + ms, id: ++ids });
      return ids;
    },
    clearTimeout: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    now: () => now,
  };
  const link = new DevLink(deps);
  /** Let promises settle. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  /** Move time on, running the timers that come due. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers.splice(timers.indexOf(next), 1);
      now = next.at;
      next.fn();
      await settle();
    }
    now = end;
    await settle();
  };
  return { link, statuses, logs, loads, bundles, sources, requests, servers, settle, advance, last: () => statuses[statuses.length - 1] };
}

const A = "http://127.0.0.1:5180/";
const L = "http://localhost:5180/";

describe("the first load", () => {
  it("reads the state and the bundle, then follows the events", async () => {
    const r = rig({ [A]: { session: "s1", version: 3 } });
    r.link.set({ url: A, session: "s1" });
    expect(r.statuses[0]).toEqual({ message: "Loading the project…", busy: true });
    await r.settle();
    expect(r.requests).toEqual([`${A}__protoboard/state`, `${A}uhd-bundle.json`]);
    expect(r.loads).toEqual([{ base: A, version: 3 }]);
    expect(r.last()).toBeNull();
    expect(r.sources.map((s) => s.url)).toEqual([`${A}__protoboard/events`]);
    expect(r.logs).toEqual(["info: loaded the project from http://127.0.0.1:5180/ (session s1, version 3)"]);
  });

  it("the same endpoint again changes nothing; no endpoint says why, as a problem", async () => {
    const r = rig({ [A]: { session: "s1", version: 1 } });
    r.link.set({ url: A, session: "s1" });
    await r.settle();
    r.link.set({ url: A, session: "s1" });
    await r.settle();
    expect(r.loads).toHaveLength(1);
    r.link.set(null, "The dev server exited (code 1); the Protoboard log has its output.");
    expect(r.last()).toEqual({ message: "The dev server exited (code 1); the Protoboard log has its output.", problem: true });
    expect(r.sources[0].closed).toBe(true);
  });

  it("a server that does not answer as 127.0.0.1 is read as localhost, and the log says so", async () => {
    const r = rig({ [L]: { session: "s1", version: 1 } });
    r.link.set({ url: A, session: "s1" });
    await r.settle();
    expect(r.loads).toEqual([{ base: L, version: 1 }]);
    expect(r.sources[0].url).toBe(`${L}__protoboard/events`);
    expect(r.logs).toEqual([
      "error: GET http://127.0.0.1:5180/ failed: no connection (Failed to fetch)",
      "warn: the dev server did not answer at http://127.0.0.1:5180/ (no connection (Failed to fetch)) but does at http://localhost:5180/: reading from there",
    ]);
  });

  it("nothing answers: a problem that names the address and the error, tried again by itself, and at once on retry", async () => {
    const r = rig({});
    r.link.set({ url: A, session: "s1" });
    await r.settle();
    expect(r.last()).toEqual({ message: "The dev server at 127.0.0.1:5180 is not answering: no connection (Failed to fetch). Retrying…", busy: true, problem: true });
    expect(r.requests).toHaveLength(2); // both loopback names
    await r.advance(2000);
    expect(r.requests).toHaveLength(4);
    await r.advance(3999);
    expect(r.requests).toHaveLength(4); // the second wait is 4 s
    r.servers[A] = { session: "s1", version: 1 };
    r.link.retry();
    await r.settle();
    expect(r.loads).toEqual([{ base: A, version: 1 }]);
    expect(r.last()).toBeNull();
    // the retry that was waiting does not load a second time
    await r.advance(60000);
    expect(r.loads).toHaveLength(1);
  });

  it("an answer that is not the project says the status", async () => {
    const r = rig({ [A]: 403, [L]: 403 });
    r.link.set({ url: A, session: "s1" });
    await r.settle();
    expect(r.last()?.message).toContain("the dev server answered 403");
  });

  it("a failed build's note is not a problem", async () => {
    const r = rig({ [A]: { session: "s1", version: 2, failed: true, message: "build failed: boom" } });
    r.link.set({ url: A, session: "s1" });
    await r.settle();
    expect(r.last()).toEqual({ message: "build failed: boom" });
  });
});

describe("following the server", () => {
  const loaded = async (open = true) => {
    const r = rig({ [A]: { session: "s1", version: 1 } });
    r.link.set({ url: A, session: "s1" });
    await r.settle();
    if (open) {
      r.sources[0].open();
      r.sources[0].emit("hello", { session: "s1", version: 1 });
    }
    r.requests.length = 0;
    return r;
  };
  const polls = (r: Awaited<ReturnType<typeof loaded>>) => r.requests.filter((u) => u.endsWith("/__protoboard/state")).length;

  it("with a stream: a rebuild's bundle is read; a busy status is a note; nothing is asked meanwhile", async () => {
    const r = await loaded();
    r.sources[0].emit("status", { state: "busy", message: "rebuilding (src/a.uhd.ts)" });
    expect(r.last()).toEqual({ message: "rebuilding (src/a.uhd.ts)", busy: true });
    r.sources[0].emit("bundle", { version: 2, reason: "source", failed: false, message: "built" });
    await r.settle();
    expect(r.bundles).toEqual([{ bundle: 1 }]);
    expect(r.last()).toBeNull();
    // a later hello with that version is not a reason to load again
    r.sources[0].emit("hello", { session: "s1", version: 2 });
    await r.advance(10000);
    expect(r.loads).toHaveLength(1);
    expect(polls(r)).toBe(0);
  });

  it("VS Code 1.108: the stream never opens (beta test 1). No message; the tab asks the server every second and loads a rebuild", async () => {
    const r = await loaded(false);
    const before = r.statuses.length;
    r.sources[0].drop(); // the first attempt
    expect(r.sources[0].closed).toBe(false);
    r.sources[0].drop(); // the second: this webview cannot stream
    expect(r.sources[0].closed).toBe(true);
    expect(r.logs[r.logs.length - 1]).toBe("info: this VS Code's webview cannot open an event stream to http://127.0.0.1:5180/__protoboard/events (2 attempts failed); following the server by asking it every second instead");
    await r.advance(5000);
    expect(polls(r)).toBe(5);
    expect(r.statuses.length).toBe(before); // nothing said: the server answers
    r.servers[A] = { session: "s1", version: 2 };
    await r.advance(1000);
    expect(r.bundles).toEqual([{ bundle: 2 }]);
    expect(r.sources).toHaveLength(1); // and no further stream attempts
    expect(r.link.streamWorked).toBe(false);
  });

  it("asking: a build in progress is a note that goes when it is done; a failed one stays as a note", async () => {
    const r = await loaded(false);
    r.sources[0].drop(true);
    (r.servers[A] as { building?: boolean }).building = true;
    await r.advance(1000);
    expect(r.last()).toEqual({ message: "rebuilding", busy: true });
    r.servers[A] = { session: "s1", version: 2, failed: true, message: "build failed: boom" };
    await r.advance(1000);
    expect(r.last()).toEqual({ message: "build failed: boom" });
  });

  it("asking: a server that stops answering is a lost connection after a few seconds, cleared when it answers", async () => {
    const r = await loaded(false);
    r.sources[0].drop(true);
    await r.advance(1000);
    const saved = r.servers[A];
    delete r.servers[A];
    await r.advance(3000);
    expect(r.last()).toBeNull(); // a short gap says nothing
    await r.advance(6000);
    expect(r.last()).toEqual({ message: "Lost the dev server at 127.0.0.1:5180: no connection (Failed to fetch). Retrying…", busy: true, problem: true });
    r.servers[A] = saved;
    await r.advance(3000);
    expect(r.last()).toBeNull();
    expect(r.logs.filter((l) => l.startsWith("error: GET http://127.0.0.1:5180/__protoboard/state failed"))).toHaveLength(1); // once per outage
    expect(r.logs[r.logs.length - 1]).toMatch(/^info: the dev server at http:\/\/127\.0\.0\.1:5180\/ answers again after \d+\.\d s$/);
  });

  it("asking: a restarted server (a new session) is loaded again", async () => {
    const r = await loaded(false);
    r.sources[0].drop(true);
    r.servers[A] = { session: "s2", version: 1 };
    await r.advance(1000);
    expect(r.loads).toEqual([{ base: A, version: 1 }, { base: A, version: 1 }]);
    expect(r.logs.some((l) => l.includes("restarted (session s2): loading the project again"))).toBe(true);
  });

  it("a stream that worked and was cut (a laptop slept): asks meanwhile, says nothing while the server answers, and opens another stream", async () => {
    const r = await loaded();
    const before = r.statuses.length;
    r.sources[0].drop(true); // a webview does not reconnect it
    expect(r.logs[r.logs.length - 1]).toBe("warn: events from http://127.0.0.1:5180/__protoboard/events stopped (the browser will not reconnect); asking the server every second meanwhile");
    await r.advance(14000);
    expect(polls(r)).toBe(14);
    expect(r.statuses.length).toBe(before);
    await r.advance(1000);
    expect(r.sources).toHaveLength(2);
    r.sources[1].open();
    r.sources[1].emit("hello", { session: "s1", version: 1 });
    const asked = polls(r);
    await r.advance(10000);
    expect(polls(r)).toBe(asked); // the stream is back: no more questions
    expect(r.loads).toHaveLength(1);
  });

  it("cut while a build was made: the build is loaded by asking, and the new stream's hello does not load it twice", async () => {
    const r = await loaded();
    r.sources[0].drop(true);
    r.servers[A] = { session: "s1", version: 2 };
    await r.advance(1000);
    expect(r.bundles).toEqual([{ bundle: 2 }]);
    await r.advance(14000);
    r.sources[1].open();
    r.sources[1].emit("hello", { session: "s1", version: 2 });
    await r.settle();
    expect(r.loads).toHaveLength(1);
    expect(r.bundles).toHaveLength(1);
  });

  it("a stream the browser reconnects by itself: back on a newer build, that build is loaded", async () => {
    const r = await loaded();
    r.sources[0].drop();
    r.servers[A] = { session: "s1", version: 3 };
    r.sources[0].open();
    r.sources[0].emit("hello", { session: "s1", version: 3 });
    await r.settle();
    expect(r.loads).toEqual([{ base: A, version: 1 }, { base: A, version: 3 }]);
  });

  it("the questions and events of a connection that was replaced are ignored", async () => {
    const r = await loaded(false);
    r.sources[0].drop(true);
    r.link.set({ url: "http://127.0.0.1:5181/", session: "s2" });
    await r.settle();
    r.requests.length = 0;
    await r.advance(10000);
    expect(r.requests.filter((u) => u.startsWith(A))).toEqual([]);
  });
});

describe("helpers and the protocol", () => {
  it("otherLoopback", () => {
    expect(otherLoopback("http://127.0.0.1:5180/")).toBe("http://localhost:5180/");
    expect(otherLoopback("http://localhost:5180/x")).toBe("http://127.0.0.1:5180/x");
    expect(otherLoopback("https://abc-5180.app.github.dev/")).toBeUndefined();
    expect(otherLoopback("nonsense")).toBeUndefined();
  });

  it("describeError", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toBe("no connection (Failed to fetch)");
    expect(describeError(new RangeError("bad"))).toBe("RangeError: bad");
    expect(describeError(new Error("the dev server answered 500"))).toBe("the dev server answered 500");
    expect(describeError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("no answer in time");
  });

  it("says what the dev server is in one sentence", () => {
    expect(DEV_SERVER_IS).toBe("The dev server serves this project's model and files to the viewer and rebuilds them when the project changes.");
  });

  it("the page's log lines and buttons are checked like every other message", () => {
    expect(parseFromWebview({ type: "log", level: "error", message: "GET http://127.0.0.1:5180/ failed" })).toEqual({ type: "log", level: "error", message: "GET http://127.0.0.1:5180/ failed" });
    expect(parseFromWebview({ type: "log", level: "shout", message: "x" })).toEqual({ type: "log", level: "info", message: "x" });
    expect(parseFromWebview({ type: "log", message: 3 })).toBeUndefined();
    expect((parseFromWebview({ type: "log", message: "x".repeat(5000) }) as { message: string }).message).toHaveLength(2000);
    expect(parseFromWebview({ type: "devAction", action: "retry" })).toEqual({ type: "devAction", action: "retry" });
    expect(parseFromWebview({ type: "devAction", action: "format-disk" })).toBeUndefined();
  });
});

describe("the Node.js the CLI runs with (a VS Code started from the macOS Dock has the system's PATH)", () => {
  const has =
    (...files: string[]) =>
    (p: string) =>
      files.includes(p);
  const mac = (over: Partial<NodeLookup>): NodeLookup => ({ platform: "darwin", home: "/Users/ada", env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, exists: () => false, list: () => [], ...over });

  it("the setting wins", () => {
    expect(resolveNode(" /opt/n/bin/node ", mac({}))).toEqual({ command: "/opt/n/bin/node", from: "setting" });
    // the setting's default value is not a choice
    expect(resolveNode("node", mac({ exists: has("/opt/homebrew/bin/node") })).from).toBe("found");
  });
  it("node on PATH runs as `node`", () => {
    expect(resolveNode("", mac({ env: { PATH: "/usr/bin:/opt/homebrew/bin" }, exists: has("/opt/homebrew/bin/node") }))).toEqual({ command: "node", from: "path", path: "/opt/homebrew/bin/node" });
  });
  it("not on PATH: Homebrew on Apple Silicon, then Intel, then the version managers", () => {
    expect(resolveNode(undefined, mac({ exists: has("/opt/homebrew/bin/node", "/usr/local/bin/node") }))).toEqual({ command: "/opt/homebrew/bin/node", from: "found", path: "/opt/homebrew/bin/node" });
    expect(resolveNode(undefined, mac({ exists: has("/usr/local/bin/node") })).command).toBe("/usr/local/bin/node");
    expect(resolveNode(undefined, mac({ exists: has("/Users/ada/.volta/bin/node") })).command).toBe("/Users/ada/.volta/bin/node");
    expect(resolveNode(undefined, mac({ exists: has("/Users/ada/Library/Application Support/fnm/aliases/default/bin/node") })).command).toBe("/Users/ada/Library/Application Support/fnm/aliases/default/bin/node");
  });
  it("nvm: the newest version installed", () => {
    const nvm = "/Users/ada/.nvm/versions/node";
    const look = mac({ list: (d) => (d === nvm ? ["v8.17.0", "v22.9.0", "v22.11.1", "v20.18.0", ".DS_Store"] : []), exists: (p) => p.startsWith(nvm) });
    expect(resolveNode(undefined, look).command).toBe(`${nvm}/v22.11.1/bin/node`);
  });
  it("Windows: Path, node.exe, Program Files", () => {
    expect(resolveNode(undefined, { platform: "win32", home: "C:\\Users\\ada", env: { Path: "C:\\Windows;C:\\tools\\node" }, exists: has("C:\\tools\\node\\node.exe"), list: () => [] })).toEqual({ command: "node", from: "path", path: "C:\\tools\\node\\node.exe" });
    expect(resolveNode(undefined, { platform: "win32", home: "C:\\Users\\ada", env: { Path: "C:\\Windows", ProgramFiles: "C:\\Program Files" }, exists: has("C:\\Program Files\\nodejs\\node.exe"), list: () => [] }).command).toBe("C:\\Program Files\\nodejs\\node.exe");
  });
  it("nowhere: `node`, marked missing (VS Code's own runtime then runs the CLI), and a spawn error says what to set", () => {
    const node = resolveNode(undefined, mac({}));
    expect(node).toEqual({ command: "node", from: "missing" });
    const e = cliError({ command: node.command, args: ["/p/node_modules/@protoboardai/cli/bin/protoboard.mjs"], from: "project" }, Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" }));
    expect(e.message).toBe(
      "cannot run node (not found): the Node.js chosen for the Protoboard CLI is not there. Leave protoboard.nodePath at `node` to let Protoboard choose (a Node.js 22 or later on this machine, else VS Code's own runtime), or set protoboard.nodePath to the full path of a Node.js 22 or later",
    );
  });
});

describe("why a dev server does not answer the extension", () => {
  const A = "http://127.0.0.1:5180/";
  it("answers as a dev server: nothing to say", async () => {
    expect(await whyNoDev(A, { fetch: async () => ({ ok: true, json: async () => ({ session: "s" }) }) })).toBeUndefined();
  });
  it("refused, another program on the port, an error status", async () => {
    expect(await whyNoDev(A, { fetch: async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })) })).toBe("GET http://127.0.0.1:5180/__protoboard/state: ECONNREFUSED");
    expect(await whyNoDev(A, { fetch: async () => ({ ok: true, json: async () => ({ hello: 1 }) }) })).toBe("GET http://127.0.0.1:5180/__protoboard/state answered, but not as a Protoboard dev server (another program has the port?)");
    expect(await whyNoDev(A, { fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }) as never })).toBe("GET http://127.0.0.1:5180/__protoboard/state answered 403");
  });
  it("no answer in time", async () => {
    const hang: FetchLike = (_u, init) => new Promise((_ok, fail) => init?.signal?.addEventListener("abort", () => fail(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    expect(await whyNoDev(A, { fetch: hang, timeoutMs: 20 })).toBe("GET http://127.0.0.1:5180/__protoboard/state: no answer in 20 ms");
  });
});

describe("live reload off (B19)", () => {
  it("keeps the server's reason as the tab's note, after a failed rebuild's", () => {
    expect(restingStatus({})).toBeNull();
    expect(restingStatus({ unwatched: "Live reload is off: …" })).toEqual({ message: "Live reload is off: …" });
    expect(restingStatus({ failed: true, message: "build failed: x", unwatched: "Live reload is off: …" })).toEqual({ message: "build failed: x" });
  });
});

describe("the viewer's view tabs at any width (B8)", () => {
  const full = [90, 50, 60, 70, 80]; // Diagram, 3D, Schematic, PCB, Pair with titles
  const icons = [33, 33, 33, 33, 33];
  it("keeps the titles while they fit, then icons, then a More menu, the active tab always shown", () => {
    expect(fitTabs(full, icons, 400, 0)).toEqual({ compact: false, shown: [0, 1, 2, 3, 4] });
    expect(fitTabs(full, icons, 200, 0)).toEqual({ compact: true, shown: [0, 1, 2, 3, 4] });
    const narrow = fitTabs(full, icons, 120, 0);
    expect(narrow.compact).toBe(true);
    expect(narrow.shown).toEqual([0, 1]);
    expect(fitTabs(full, icons, 120, 4).shown).toEqual([0, 4]);
  });
  it("names every tab for screen readers and automation, icon-only too (B9)", () => {
    const shell = readFileSync(new URL("../../web-viewer/src/vscode/Shell.tsx", import.meta.url), "utf8");
    expect(shell).toMatch(/aria-label=\{view\.title\}/);
    expect(shell).toMatch(/label=\{`More views: \$\{hidden\.map/);
  });
});
