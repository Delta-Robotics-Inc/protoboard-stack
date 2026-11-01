/**
 * The page `protoboard dev` serves: Protoboard's web viewer
 * (`@protoboardai/web-viewer`, `mountWebViewer`: the browser shell over the
 * viewer stack, docs/specs/viewer-stack.md) in a page of its own, with the
 * Protoboard adapter around it:
 *
 * - the bundle and its artifacts come from the viewer's own handler
 *   (`/uhd-bundle.json`, `/artifacts/...`);
 * - the dev session's findings (a failed rebuild, an unsaved layout) are the
 *   host diagnostics, next to the project's aggregate in the bundle;
 * - layout edits go to the server, which writes them to display.json;
 * - server-sent events push rebuilt bundles and display changes into the
 *   running viewer (`update`), so the view, drill level and selection stay;
 * - in a frame (the VS Code extension's webview), the page relays the
 *   viewer's host messages between its parent and the viewer (relay.js),
 *   and answers `openSource` with the file and line from the build's source
 *   index (`/__protoboard/source`, ./sources.ts);
 * - the views the project's extensions contribute become tabs (`views` in the
 *   state route); `?theme=` picks the theme (protoboard-dark, protoboard-light,
 *   vscode, …, or light, dark, system for Protoboard's; default: the viewer's
 *   last choice, else Protoboard dark);
 * - the 3D view's live state (PB-1178) goes to the server after the viewer's
 *   400 ms debounce (`.protoboard/local/viewer-state.json`) and comes back
 *   from the state route when the page opens; named views and annotations
 *   go to the display file only when saved;
 * - the page is a live tab of the bridge (./bridge.ts): its event stream
 *   names it (`?tab=`), batches arrive as `bridge` events, the viewer
 *   answers them (`viewer.bridge`), and the page posts the reply; a focus
 *   makes it the tab agents reach by default.
 */

/** Routes of the dev session, apart from the viewer handler's own. */
export const DEV_ROUTES = {
  page: "/",
  script: "/__protoboard/dev.js",
  events: "/__protoboard/events",
  state: "/__protoboard/state",
  layout: "/__protoboard/layout",
  relay: "/__protoboard/relay.js",
  source: "/__protoboard/source",
  /** Local telemetry (PB-1181): the viewer's session and crash records, POSTed by the page; the server appends them under .protoboard/local/telemetry/. */
  telemetry: "/__protoboard/telemetry",
  /** The 3D view's live state (PB-1178): GET the saved one, POST a newer one (.protoboard/local/viewer-state.json). */
  viewState: "/__protoboard/view-state",
  /** Named views and annotations (PB-1178): an explicit save into the display file (`spatial.views`, `spatial.annotations`). */
  displayViews: "/__protoboard/display-views",
  /** The last snapshot of a tab (PB-1180): GET its record (`?level=&view=`), POST a save point from the viewer. */
  snapshot: "/__protoboard/snapshot",
  /** The snapshot's image. */
  snapshotPng: "/__protoboard/snapshot.png",
  /** The live-tab bridge's reply and presence routes (./bridge.ts BRIDGE_ROUTES). */
  bridgeReply: "/__protoboard/bridge/reply",
  bridgePresence: "/__protoboard/bridge/presence",
  parts: "/__protoboard/parts/",
  viewerJs: "/__protoboard/viewer/web-viewer.js",
  viewerCss: "/__protoboard/viewer/web-viewer.css",
} as const;

/**
 * A route as the page refers to it: relative to the page, so the page also
 * works behind a proxy that serves it under a path (code-server's
 * `/proxy/<port>/`, PB-861). The page is always served at the root of the
 * server.
 */
const rel = (route: string) => `.${route}`;
/** A route as dev.js imports it: relative to dev.js itself (`/__protoboard/dev.js`). */
const fromScript = (route: string) => `./${route.slice("/__protoboard/".length)}`;

/**
 * The Protoboard mark (as in the VS Code extension's media/protoboard.svg) as
 * the tab's icon, in a neutral grey: no brand colour is hard-coded (PB-900).
 * Once mounted, the web viewer redraws it in the theme's accent.
 */
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">' +
  '<path fill="#8a8a8a" d="M8.529 13.629 15.272 6.885C15.348 6.81 15.385 6.715 15.385 6.6C15.385 6.486 15.348 6.39 15.272 6.315L13.815 4.886C13.624 4.695 13.386 4.6 13.101 4.6H10.9C10.614 4.6 10.376 4.695 10.186 4.886L8.529 6.543C8.338 6.733 8.243 6.972 8.243 7.257V13.486C8.243 13.638 8.281 13.714 8.357 13.714C8.414 13.714 8.472 13.686 8.529 13.629ZM10.9 19.4H13.101C13.386 19.4 13.624 19.305 13.815 19.114L15.472 17.457C15.662 17.267 15.757 17.029 15.757 16.743V10.514C15.757 10.362 15.719 10.286 15.643 10.286C15.586 10.286 15.529 10.315 15.472 10.372L8.729 17.115C8.634 17.209 8.586 17.305 8.586 17.4C8.586 17.496 8.634 17.591 8.729 17.685L10.186 19.114C10.376 19.305 10.614 19.4 10.9 19.4ZM6.015 5.372 9.015 2.4C9.243 2.133 9.548 2 9.929 2H14.072C14.433 2 14.738 2.124 14.986 2.372L17.958 5.372C18.224 5.6 18.357 5.905 18.357 6.286V17.714C18.357 18.076 18.224 18.391 17.958 18.657L14.986 21.628C14.738 21.876 14.433 22 14.072 22H9.929C9.548 22 9.243 21.867 9.015 21.6L6.015 18.628C5.767 18.381 5.643 18.076 5.643 17.714V6.286C5.643 5.924 5.767 5.619 6.015 5.372Z"/></svg>';
/** The page's icon, inline: the browser then never asks for /favicon.ico (PB-873). */
const FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

/** Header carrying the session token on writes (a page on another origin cannot set it without a preflight, which is refused). */
export const TOKEN_HEADER = "x-protoboard-dev";

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function devPage(config: { name: string; token: string; session: string; hostOrigins?: string[] }): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(config.name)} · Protoboard dev</title>
    <link rel="icon" href="${FAVICON_DATA_URL}" />
    <link rel="stylesheet" href="${rel(DEV_ROUTES.viewerCss)}" />
    <style>
      /* until the web viewer mounts and puts its theme on the document, the system canvas in the
         theme's scheme (no dark flash under a light theme) */
      html { background: Canvas; color-scheme: dark; }
      html[data-pb-scheme="light"] { color-scheme: light; }
      html, body { margin: 0; height: 100%; }
      #viewer { height: 100vh; }
      #pb-dev {
        --pb-surface: #262626; --pb-text: #e5e5e5; --pb-text-muted: #a3a3a3; --pb-border: #3a3a3a; --pb-accent: currentColor;
        --pb-ok: #22c55e; --pb-warning: #eed202; --pb-error: #ef4444; --pb-shadow: 0 6px 24px rgb(0 0 0 / 0.35); --pb-font: ui-monospace, monospace;
        /* above the viewer's bottom toolbar, and only while it has something to say: once a build or a
           save is done it fades out, so it never sits over the diagram (PB-861); errors stay */
        position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%); z-index: 50; pointer-events: none;
        max-width: min(640px, calc(100vw - 32px)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        display: flex; align-items: center; gap: 8px; padding: 6px 10px;
        /* the viewer's tokens (the theme is applied on the viewer's root, so read them from there) */
        background: var(--pb-surface); color: var(--pb-text-muted);
        border: 1px solid var(--pb-border); border-radius: 8px;
        box-shadow: var(--pb-shadow);
        font: 500 11px/1.4 var(--pb-font); letter-spacing: 0.04em; text-transform: uppercase;
        transition: opacity 0.3s;
      }
      #pb-dev .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pb-ok); flex: none; }
      #pb-dev[data-state="busy"] .dot { background: var(--pb-warning); }
      #pb-dev[data-state="error"] .dot { background: var(--pb-error); }
      #pb-dev[data-state="error"] { color: var(--pb-text); }
      #pb-dev[data-quiet="1"] { opacity: 0; }
      #pb-dev .sep { width: 1px; align-self: stretch; background: var(--pb-border); }
      #pb-dev .brand { color: var(--pb-accent); }
    </style>
    <script>
      try {
        const t = new URLSearchParams(location.search).get("theme") ?? localStorage.getItem("protoboard-web:theme") ?? "";
        if (t.endsWith("light") || (t.endsWith("system") && matchMedia("(prefers-color-scheme: light)").matches)) document.documentElement.dataset.pbScheme = "light";
      } catch {}
    </script>
    <script type="application/json" id="protoboard-dev">${json}</script>
  </head>
  <body>
    <div id="viewer"></div>
    <div id="pb-dev" data-state="busy"><span class="dot"></span><span class="brand">Protoboard dev</span><span class="sep"></span><span id="pb-dev-text">loading</span></div>
    <script type="module" src="${rel(DEV_ROUTES.script)}"></script>
  </body>
</html>
`;
}

/** The page's script: mounts the viewer and connects it to the dev server. */
export const DEV_SCRIPT = `import { createDevPartsData, mountWebViewer } from "${fromScript(DEV_ROUTES.viewerJs)}";
import { createRelay } from "${fromScript(DEV_ROUTES.relay)}";

const config = JSON.parse(document.getElementById("protoboard-dev").textContent);
const client = crypto.randomUUID();
const empty = () => ({ positions: {}, links: {} });
const badge = document.getElementById("pb-dev");
const text = document.getElementById("pb-dev-text");
let quiet;
function status(state, message) {
  badge.dataset.state = state;
  badge.dataset.quiet = "0";
  text.textContent = message;
  clearTimeout(quiet);
  if (state === "ok") quiet = setTimeout(() => (badge.dataset.quiet = "1"), 4000);
}
const counts = (c) => (c ? c.error + " errors · " + c.warning + " warnings" : "");

// the badge sits outside the viewer: it takes the viewer's theme tokens from the viewer's root whenever they change
const BADGE_TOKENS = { surface: "surface", text: "text", "text-muted": "text-muted", border: "border", accent: "accent", ok: "severity-ok", warning: "severity-warning", error: "severity-error", shadow: "shadow-lg", font: "font-ui" };
let themed;
function syncBadge() {
  const style = getComputedStyle(themed);
  for (const [k, t] of Object.entries(BADGE_TOKENS)) {
    const v = style.getPropertyValue("--uhd-" + t).trim();
    if (v) badge.style.setProperty("--pb-" + k, v);
  }
}
new MutationObserver(() => {
  const root = document.querySelector("#viewer > .uhd-root");
  if (!root || root === themed) return;
  themed = root;
  new MutationObserver(syncBadge).observe(root, { attributes: true, attributeFilter: ["style", "data-uhd-theme"] });
  syncBadge();
}).observe(document.getElementById("viewer"), { childList: true });

// every URL relative to the page, so it works behind a path-prefixing proxy (a browser-hosted VS Code)
const here = (path) => new URL(path, document.baseURI).href;
const bundleUrl = here("uhd-bundle.json");

async function fetchBundle() {
  const res = await fetch(bundleUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("bundle: " + res.status);
  const bundle = await res.json();
  // the server names artifact bases by the host it was asked on (http://host/artifacts/…); a proxy in
  // front of it (another scheme, host or path) reaches them relative to this page instead
  for (const [id, base] of Object.entries(bundle.artifactBases ?? {})) {
    const m = /^https?:\\/\\/[^/]+\\/(artifacts\\/.*)$/.exec(base);
    if (m) bundle.artifactBases[id] = here(m[1]);
  }
  return bundle;
}

/** Where every node and edge of the diagram on screen is drawn (absolute canvas coordinates). */
function snapshot() {
  const flow = document.querySelector(".react-flow");
  if (!flow) return undefined;
  const nodes = {};
  for (const el of flow.querySelectorAll(".react-flow__node[data-id]")) {
    const m = /translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)/.exec(el.style.transform);
    if (m) nodes[el.dataset.id] = { x: Number(m[1]), y: Number(m[2]) };
  }
  const edges = [...flow.querySelectorAll(".react-flow__edge[data-id]")].map((el) => el.dataset.id);
  return { nodes, edges };
}

async function save(layout) {
  status("busy", "saving layout");
  try {
    const res = await fetch("${rel(DEV_ROUTES.layout)}", {
      method: "POST",
      headers: { "content-type": "application/json", "${TOKEN_HEADER}": config.token },
      body: JSON.stringify({ client, layout, snapshot: snapshot() }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.status);
    if (body.skipped?.length) status("error", "layout not saved: " + body.skipped[0].reason);
    else status("ok", body.levels.length ? "layout saved · " + body.file : "layout unchanged");
  } catch (e) {
    status("error", "layout not saved: " + e.message);
  }
}

// local telemetry (PB-1181): the viewer dispatches its session records (a partial one when the page is hidden, the
// final one when it closes) and crash records as a window event; the server appends them to the project's
// .protoboard/local/telemetry/ unless recording is off there. keepalive: a record sent as the page closes still arrives.
window.addEventListener("uhd-viewer:telemetry", (e) => {
  const record = e.detail;
  if (!record || typeof record !== "object") return;
  fetch("${rel(DEV_ROUTES.telemetry)}", {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json", "${TOKEN_HEADER}": config.token },
    body: JSON.stringify({ record }),
  }).catch(() => {});
});

// a framing host (the VS Code extension) talks to the viewer through this page
const relay = createRelay({
  window,
  origins: config.hostOrigins,
  async resolveSource(request) {
    const query = new URLSearchParams({ defId: request.defId, ...(request.instancePath ? { instancePath: request.instancePath } : {}) });
    const res = await fetch("${rel(DEV_ROUTES.source)}?" + query, { cache: "no-store" });
    return res.ok ? res.json() : undefined;
  },
  onLocal(event) {
    const at = event.source ?? event.instanceSource;
    status("ok", at ? "source · " + at.file + (at.line ? ":" + at.line : "") : "no source found for " + event.defId);
  },
});

const params = new URLSearchParams(location.search);
// document mode (?chrome=none, PB-1109): what is marked as chrome is left out
if (params.get("chrome") === "none") {
  const style = document.createElement("style");
  style.textContent = "[data-chrome]{display:none!important}";
  document.head.append(style);
}
// the last snapshot of the view the page opens on (PB-1180), asked for with the state: painted before the models load
const level = params.get("drill") ?? "";
const snapshotView = params.get("view") === "3d" ? "3d" : undefined;
const snapshotLoad = snapshotView ? fetch("${rel(DEV_ROUTES.snapshot)}?" + new URLSearchParams({ level, view: snapshotView }), { cache: "no-store" }).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined) : Promise.resolve(undefined);
const state = await (await fetch("${rel(DEV_ROUTES.state)}", { cache: "no-store" })).json();
// not keepalive by default: Chrome refuses a keepalive body over 64 kB and counts every keepalive request in flight
// against one 64 kB budget, so a large bridge reply was refused (gate 3, W3-A's bullet). Only the view-state flush
// asks for it (it may be sent as the page hides), and only while its body fits under the budget.
const KEEPALIVE_MAX_CHARS = 60 * 1024; // DEFAULT: under Chrome's 64 kB keepalive budget
const post = (route, body, { keepalive = false } = {}) => {
  const json = JSON.stringify(body);
  return fetch(route, { method: "POST", keepalive: keepalive && json.length < KEEPALIVE_MAX_CHARS, headers: { "content-type": "application/json", "${TOKEN_HEADER}": config.token }, body: json });
};
const themeChoice = new URLSearchParams(location.search).get("theme") ?? undefined;
const viewer = mountWebViewer(document.getElementById("viewer"), {
  bundle: await fetchBundle(),
  bundleUrl,
  themeChoice,
  views: state.views ?? [],
  // every definition's part status (PB-932): the shell marks the modules with it
  partStatus: state.partStatus,
  // the library and bom tabs ask the server (writes carry the session token)
  partsData: createDevPartsData({ base: here("${DEV_ROUTES.parts.slice(1)}"), token: config.token, tokenHeader: "${TOKEN_HEADER}" }),
  diagnostics: state.diagnostics,
  layout: empty(),
  onLayoutChange: save,
  // the 3D view's live state (PB-1178): the one saved last comes back; a newer one is kept after the viewer's debounce
  ...(state.viewState ? { viewState: state.viewState } : {}),
  onViewStateChange: (file) => post("${rel(DEV_ROUTES.viewState)}", { file }, { keepalive: true }).catch(() => {}),
  // named views and annotations: an explicit save, into the display file
  onPresentationChange: async (presentation) => {
    try {
      const res = await post("${rel(DEV_ROUTES.displayViews)}", { presentation });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.status);
      status("ok", body.written ? "views saved · " + body.file : "views unchanged");
    } catch (e) {
      status("error", "views not saved: " + e.message);
    }
  },
  // the visible viewer's own save points (PB-1180): the frame on settle and on hide, kept for the next tab
  onSavePoint: async (point) => {
    try {
      const bytes = new Uint8Array(await point.png.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const { png: _png, ...meta } = point;
      // not keepalive: a keepalive body is capped at 64 kB, and a frame is larger
      await fetch("${rel(DEV_ROUTES.snapshot)}", { method: "POST", headers: { "content-type": "application/json", "${TOKEN_HEADER}": config.token }, body: JSON.stringify({ png: btoa(bin), meta }) });
    } catch {
      // a save point is a convenience: the next tab opens without it
    }
  },
  ...relay.callbacks,
});
relay.attach(viewer);
void snapshotLoad.then((snap) => {
  if (snap && snap.imageUrl) viewer.post({ ...snap, type: "uhd-viewer:snapshot", imageUrl: here(snap.imageUrl), currentBundleHash: state.bundleHash });
});
window.protoboardDev = { viewer, relay, client, version: state.version, updates: 0 };
status(state.building ? "busy" : state.failed ? "error" : "ok", state.message);

// the stream names this page: it is a live tab of the bridge while it is open (PB-1178)
const events = new EventSource("${rel(DEV_ROUTES.events)}?tab=" + client);
events.addEventListener("bridge", async (e) => {
  const envelope = JSON.parse(e.data);
  const answer = viewer.bridge(envelope);
  if (!answer) return;
  try {
    await post("${rel(DEV_ROUTES.bridgeReply)}", { id: envelope.id, tab: client, reply: answer.reply });
  } catch {
    // the server says may-have-run when no reply arrives; a resend gets the tab's remembered answer
  }
});
// the tab a person uses is the one an agent reaches by default
let presentAt = 0;
const present = () => {
  if (Date.now() - presentAt < 5000) return;
  presentAt = Date.now();
  post("${rel(DEV_ROUTES.bridgePresence)}", { tab: client, active: true }).catch(() => {});
};
window.addEventListener("focus", present);
document.addEventListener("pointerdown", present, { passive: true });
events.addEventListener("hello", () => setTimeout(present, 50));
events.addEventListener("hello", (e) => {
  // a restarted server: its bundle and session are new
  if (JSON.parse(e.data).session !== config.session) location.reload();
});
events.addEventListener("status", (e) => {
  const s = JSON.parse(e.data);
  status(s.state, s.message);
});
events.addEventListener("bundle", async (e) => {
  const msg = JSON.parse(e.data);
  try {
    const bundle = await fetchBundle();
    // the layout on disk changed under the viewer (an edit, a checkout, another tab): show it as saved
    const reset = msg.reason === "display" || (msg.reason === "layout" && msg.client !== client);
    viewer.update({ bundle, diagnostics: msg.diagnostics, ...(reset ? { layout: empty() } : {}), ...(msg.partStatus ? { partStatus: msg.partStatus } : {}) });
    window.protoboardDev.version = msg.version;
    window.protoboardDev.updates++;
    status(msg.failed ? "error" : "ok", msg.message);
  } catch (err) {
    status("error", err.message);
  }
});
// a dropped stream reconnects by itself (a laptop that slept, a network that changed): say so only while it is down
let lost = false;
events.onerror = () => {
  lost = true;
  status("error", "dev server unreachable; retrying");
};
events.onopen = async () => {
  if (!lost) return;
  lost = false;
  try {
    const now = await (await fetch("${rel(DEV_ROUTES.state)}", { cache: "no-store" })).json();
    if (now.session !== config.session) return location.reload();
    if (now.version !== window.protoboardDev.version) {
      viewer.update({ bundle: await fetchBundle(), diagnostics: now.diagnostics });
      window.protoboardDev.version = now.version;
      window.protoboardDev.updates++;
    }
    status(now.building ? "busy" : now.failed ? "error" : "ok", now.message);
  } catch (err) {
    status("error", err.message);
  }
};
`;
