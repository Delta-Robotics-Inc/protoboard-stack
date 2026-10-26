/**
 * The dev page's relay (docs/specs/vscode-extension.md §3), served as
 * /__protoboard/relay.js and run in the browser as it is (no build step).
 *
 * `protoboard dev` mounts the viewer in its own page. When that page is
 * itself in a frame (the VS Code extension's webview frames it), the relay
 * carries the viewer's host message channel through it:
 *
 * - host → viewer: messages from the parent window, at an allowed origin,
 *   go to the viewer's handle (`post`), which checks them;
 * - viewer → host: the viewer's events are posted to the parent at its
 *   origin; `openSource` first asks the dev server where the definition and
 *   the instance are written (file, line, absolute path) and carries the
 *   answer as `source` and `instanceSource`.
 *
 * In a tab of its own the page has no host: `openSource` goes to `onLocal`
 * (the page shows the place), and artifact files open as links.
 *
 * Plain JavaScript on purpose: the page loads it without a bundler. Its
 * types are in relay.d.ts.
 */

/** Origins a page takes host messages from unless the server is told otherwise: its own, and VS Code webviews. */
export const DEFAULT_HOST_ORIGINS = ["self", "vscode-webview://*"];

/**
 * `origin` is one of `allowed`: an exact origin, `scheme://*`, `*`, or
 * `self` (the page's own origin, given as `self`). An opaque origin ("null")
 * matches only `*`.
 * @param {string} origin
 * @param {readonly string[]} allowed
 * @param {string} [self]
 */
export function originAllowed(origin, allowed, self) {
  return allowed.some((a) => {
    if (a === "*") return true;
    if (origin === "null") return false;
    if (a === "self") return origin === self;
    const wild = /^([a-z][a-z0-9+.-]*):\/\/\*$/i.exec(a);
    if (wild) return origin.toLowerCase().startsWith(`${wild[1].toLowerCase()}://`);
    return a.replace(/\/+$/, "") === origin;
  });
}

const EVENTS = new Set(["uhd-viewer:ready", "uhd-viewer:selectionChanged", "uhd-viewer:openSource", "uhd-viewer:openArtifact", "uhd-viewer:openPair"]);
/** Events held while the parent's origin is unknown; past this only the latest are kept. */
const HELD = 64;

/**
 * @param {import("./relay.js").RelayOptions} options
 * @returns {import("./relay.js").Relay}
 */
export function createRelay(options) {
  const win = options.window;
  const self = win.location.origin;
  const framed = Boolean(win.parent) && win.parent !== win;
  const allowed = options.origins && options.origins.length ? options.origins : DEFAULT_HOST_ORIGINS;
  /** @type {{ post(message: unknown): boolean } | undefined} */
  let viewer;
  /** @type {unknown[]} */
  let waiting = [];
  /** @type {unknown[]} */
  let held = [];
  let target = framed ? initialTarget() : undefined;

  function initialTarget() {
    const ancestors = win.location.ancestorOrigins;
    let guess = ancestors && ancestors.length ? ancestors[0] : undefined;
    if (!guess && win.document && win.document.referrer) {
      try {
        guess = new URL(win.document.referrer).origin;
      } catch {
        guess = undefined;
      }
    }
    if (guess && guess !== "null" && originAllowed(guess, allowed, self)) return guess;
    const exact = allowed.filter((a) => a !== "*" && !a.includes("*"));
    if (allowed.length === 1 && exact.length === 1) return exact[0] === "self" ? self : exact[0];
    return undefined;
  }

  function flush() {
    if (!target) return;
    const out = held;
    held = [];
    for (const e of out) win.parent.postMessage(e, target);
  }

  /** @param {unknown} event */
  function post(event) {
    if (!framed) return;
    held.push(event);
    if (held.length > HELD) held = held.slice(-HELD);
    flush();
  }

  /** @param {{ data: unknown, origin: string, source: unknown }} e */
  function onMessage(e) {
    if (e.source !== win.parent || !originAllowed(e.origin, allowed, self)) return;
    const data = /** @type {{ type?: unknown }} */ (e.data);
    if (!data || typeof data !== "object" || typeof data.type !== "string" || !data.type.startsWith("uhd-viewer:") || EVENTS.has(data.type)) return;
    if (!target) {
      target = e.origin === "null" ? "*" : e.origin;
      flush();
    }
    if (viewer) viewer.post(data);
    else waiting.push(data);
  }
  if (framed) win.addEventListener("message", onMessage);

  /** @param {{ defId: string, instancePath?: string }} request */
  async function openSource(request) {
    let resolved;
    try {
      resolved = await options.resolveSource(request);
    } catch {
      resolved = undefined;
    }
    const event = { type: "uhd-viewer:openSource", defId: request.defId, ...(request.instancePath ? { instancePath: request.instancePath } : {}), ...(resolved && resolved.source ? { source: resolved.source } : {}), ...(resolved && resolved.instanceSource ? { instanceSource: resolved.instanceSource } : {}) };
    if (framed) post(event);
    else if (options.onLocal) options.onLocal(event);
    return event;
  }

  return {
    framed,
    callbacks: {
      onReady: () => post({ type: "uhd-viewer:ready" }),
      onSelectionChanged: (selection) => post({ type: "uhd-viewer:selectionChanged", selection }),
      onOpenSource: (request) => void openSource(request),
      // without a host, artifact rows stay links
      ...(framed ? { onOpenArtifact: (request) => post({ type: "uhd-viewer:openArtifact", defId: request.defId, artifactId: request.artifactId }) } : {}),
      // a link's pair view: the page opens its own tab, a host may open one of its own as well
      ...(framed ? { onOpenPair: (request) => post({ type: "uhd-viewer:openPair", linkId: request.linkId, a: request.a, b: request.b }) } : {}),
    },
    attach(handle) {
      viewer = handle;
      const queued = waiting;
      waiting = [];
      for (const m of queued) handle.post(m);
    },
    openSource,
    close() {
      if (framed) win.removeEventListener("message", onMessage);
    },
  };
}
