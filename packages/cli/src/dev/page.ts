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
 *   vscode, …; default: the viewer's last choice, else Protoboard dark).
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

const state = await (await fetch("${rel(DEV_ROUTES.state)}", { cache: "no-store" })).json();
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
  ...relay.callbacks,
});
relay.attach(viewer);
window.protoboardDev = { viewer, relay, client, version: state.version, updates: 0 };
status(state.building ? "busy" : state.failed ? "error" : "ok", state.message);

const events = new EventSource("${rel(DEV_ROUTES.events)}");
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
