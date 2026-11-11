/**
 * Getting started: the page a first install opens (an editor tab that looks
 * like VS Code's own walkthrough), and the Start view a window with no
 * project shows in the Protoboard Library side bar. Both are written here as
 * plain pages that take their colours from the editor's theme, so they follow
 * whatever theme is applied, the Protoboard ones included.
 *
 * No VS Code API here: start.ts gathers the model and answers the buttons.
 * The pages draw from the model; a new model arrives as a message and they
 * draw again.
 */
import { escapeHtml } from "./html.js";
import type { PreviewPart } from "./example.js";

export const START_TITLE = "Get Started with Protoboard";
export const START_LINE = "Sign in, connect your agent, open the drone example.";
export const RESTRICTED_LINE = "Protoboard is off until you trust this folder.";

export type StepId = "signIn" | "agents" | "example" | "theme" | "project";

export interface StartStep {
  id: StepId;
  title: string;
  /** What is so, read from the machine: an account, a connected agent, an example opened, a Protoboard theme, a project. */
  done: boolean;
}

export interface ThemeChoice {
  /** The setting's value: "Protoboard Dark". */
  id: string;
  /** A small picture of it: its own colours. */
  swatch: { editor: string; side: string; bar: string; line: string };
}

export interface StartModel {
  steps: StartStep[];
  account: { signedIn: boolean; email?: string };
  agents: {
    /** Agents found on this machine that are not connected yet. */
    waiting: string[];
    connected: string[];
    /** Whether the `protoboard` command is on the user's PATH already; false offers Add to PATH. */
    onPath: boolean;
  };
  example: {
    /** This build carries the example. */
    carried: boolean;
    title: string;
    text: string;
  };
  theme: {
    choices: ThemeChoice[];
    /** The theme applied now (the user's setting). */
    current: string;
    /** The theme to go back to: the one in use before a Protoboard theme was chosen here. */
    previous?: string;
  };
  hasProject: boolean;
}

/** The five steps, in their order, with what is done. */
export function startSteps(m: Omit<StartModel, "steps"> & { exampleOpened: boolean }): StartStep[] {
  return [
    { id: "theme", title: "Choose a theme", done: isProtoboardTheme(m.theme.current, m.theme.choices) },
    { id: "signIn", title: "Sign in", done: m.account.signedIn },
    { id: "agents", title: "Connect your agent", done: m.agents.connected.length > 0 },
    { id: "example", title: "Open the drone example", done: m.exampleOpened },
    { id: "project", title: "Start your own project", done: m.hasProject },
  ];
}

export const isProtoboardTheme = (theme: string, choices: readonly Pick<ThemeChoice, "id">[]): boolean => choices.some((c) => c.id === theme);

/** A theme's name as people read it: VS Code's own carry "Default " in the setting. */
export const themeLabel = (theme: string): string => theme.replace(/^Default /, "") || "your theme";

export interface ThemeChange {
  /** The value for `workbench.colorTheme`; undefined: leave the setting as it is. */
  set?: string;
  /** What to remember as the theme to go back to (undefined: forget it). */
  previous?: string;
}

/**
 * A click on a theme tile. A tile that is not applied applies its theme, and
 * the theme in use before the first Protoboard one is remembered. The applied
 * tile, clicked again, puts that theme back.
 */
export function themeClick(clicked: string, current: string, previous: string | undefined, choices: readonly Pick<ThemeChoice, "id">[], fallback: string): ThemeChange {
  if (!choices.some((c) => c.id === clicked)) return { previous };
  if (clicked === current) return { set: previous ?? fallback };
  // from one Protoboard theme to the other: what to go back to stays the theme before both
  return { set: clicked, previous: isProtoboardTheme(current, choices) ? previous : current };
}

/**
 * Whether the page opens by itself: once, at the first start after an
 * install. Someone who had the extension before this page existed (their
 * profile already holds what an earlier version remembered) is not shown it
 * unasked, and a test run never is.
 */
export function shouldOpenStart(f: { shown: boolean; hadBefore: boolean; test: boolean; trusted: boolean }): boolean {
  return f.trusted && !f.test && !f.shown && !f.hadBefore;
}

export interface PageEnv {
  cspSource: string;
  nonce: string;
  /** The drone's picture, as the webview reaches it. */
  picture: string;
}

const csp = (e: PageEnv) => ["default-src 'none'", `img-src ${e.cspSource}`, `style-src 'nonce-${e.nonce}'`, `script-src 'nonce-${e.nonce}'`, "base-uri 'none'", "form-action 'none'"].join("; ");

/** JSON inside a script element: `<` never ends the element. */
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const ICONS = {
  circle: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  done: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5 8.2l2 2 4-4.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  part: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 1.5v1.5M10 1.5v1.5M6 13v1.5M10 13v1.5M1.5 6h1.5M1.5 10h1.5M13 6h1.5M13 10h1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
} as const;

/** What both pages share: the editor's fonts and colours, buttons as VS Code draws them, the preview card. */
const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:transparent;line-height:1.45}
button{font:inherit;color:inherit}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:26px;padding:3px 14px;border:1px solid var(--vscode-button-border,transparent);border-radius:2px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--vscode-button-hoverBackground)}
.btn.second{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn.second:hover{background:var(--vscode-button-secondaryHoverBackground)}
.btn.wide{width:100%}
.btn:focus-visible,.tile:focus-visible,.step>button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
.muted{color:var(--vscode-descriptionForeground)}
.card{border:1px solid var(--vscode-widget-border,var(--vscode-editorWidget-border,rgba(128,128,128,.35)));border-radius:6px;background:var(--vscode-editor-background);overflow:hidden}
.card img{display:block;width:100%;height:100%;object-fit:contain}
.card .shot{background:var(--vscode-sideBar-background,var(--vscode-editor-background))}
.card b{display:block;font-weight:600;color:var(--vscode-foreground)}
.tag{display:inline-block;padding:0 6px;border-radius:3px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:10px;font-weight:600;letter-spacing:.04em}
`;

const PAGE_CSS = `${BASE_CSS}
body{padding:36px 48px 48px}
main{display:flex;gap:48px;align-items:flex-start;max-width:1180px;margin:0 auto}
.steps{flex:0 0 460px;min-width:0}
h1{margin:0 0 6px;font-size:22px;font-weight:600;color:var(--vscode-foreground)}
.lead{margin:0 0 18px;color:var(--vscode-descriptionForeground)}
.step{border-radius:6px;border-left:2px solid transparent}
.step.open{background:var(--vscode-welcomePage-tileBackground,var(--vscode-editorWidget-background));border-left-color:var(--vscode-focusBorder)}
.step>button{display:flex;align-items:center;gap:12px;width:100%;padding:11px 14px;border:0;background:none;text-align:left;cursor:pointer;font-weight:600}
.step .mark{flex:none;display:flex;color:var(--vscode-textLink-foreground)}
.step .body{display:none;padding:0 14px 14px 42px}
.step.open .body{display:block}
.step .body p{margin:0 0 10px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.note{margin-top:10px;font-size:12px}
.card.inline{display:flex;gap:12px;align-items:center;padding:10px;margin-bottom:2px}
.card.inline .shot{flex:none;width:150px;height:94px;border-radius:4px}
.card.inline .text{min-width:0}
.card.inline .text span{display:block;margin:2px 0 8px;font-size:12px}
.tiles{display:flex;gap:12px}
.tile{flex:1;padding:8px;border:1px solid var(--vscode-widget-border,rgba(128,128,128,.35));border-radius:6px;background:var(--vscode-editor-background);cursor:pointer;text-align:left}
.tile.on{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px var(--vscode-focusBorder)}
.swatch{display:flex;flex-direction:column;height:84px;border-radius:3px;overflow:hidden;border:1px solid}
.swatch i{display:block}
.swatch .top{height:12px}
.swatch .mid{flex:1;display:flex;gap:6px;padding:8px}
.swatch .side{width:34px}
.swatch .lines{flex:1;display:flex;flex-direction:column;gap:5px}
.swatch .lines i{height:4px}
.swatch .bar{height:8px}
.tile .name{display:flex;align-items:center;gap:6px;margin-top:8px}
.tile .name .mark{display:flex;color:var(--vscode-descriptionForeground)}
.tile.on .name .mark{color:var(--vscode-textLink-foreground)}
.media{flex:1;min-width:0;align-self:stretch}
.media .card{height:430px;padding:18px}
@media (max-width:900px){main{flex-direction:column}.steps{flex-basis:auto;width:100%}.media{display:none}body{padding:24px 20px}}
`;

const VIEW_CSS = `${BASE_CSS}
body{padding:0 0 12px}
h2{margin:0;padding:6px 12px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));border-top:1px solid var(--vscode-sideBarSectionHeader-border,transparent)}
section{padding:6px 12px 14px;display:flex;flex-direction:column;gap:10px}
.card .shot{height:132px}
.card .text{padding:10px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.card .text span{font-size:12px}
.gate{display:flex;align-items:center;gap:8px;padding:7px 8px 7px 10px;border:1px solid var(--vscode-widget-border,rgba(128,128,128,.35));border-radius:4px;background:var(--vscode-editorWidget-background)}
.gate span{flex:1;min-width:0;font-size:12px}
.gate .btn{min-height:22px;padding:1px 10px;font-size:12px}
.preview{display:flex;flex-direction:column;gap:6px;opacity:.45;pointer-events:none;user-select:none}
.field{display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border:1px solid var(--vscode-input-border,transparent);border-radius:2px;background:var(--vscode-input-background);color:var(--vscode-input-placeholderForeground)}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chips i{font-style:normal;font-size:11px;padding:1px 8px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);opacity:.75}
.chips i:first-child{opacity:1}
.part{display:flex;align-items:center;gap:8px;height:24px}
.part span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.part em{font-style:normal;font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap}
.link{border:0;background:none;padding:0;color:var(--vscode-textLink-foreground);cursor:pointer;text-align:left}
.link:hover{text-decoration:underline}
`;

/** The page's script: draws the model, says which button was pressed. */
const PAGE_JS = `
const vscode = acquireVsCodeApi();
const ICONS = ${JSON.stringify({ circle: ICONS.circle, done: ICONS.done })};
const PICTURE = document.body.dataset.picture;
let model = JSON.parse(document.getElementById("model").textContent);
let open = (vscode.getState() || {}).open;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const label = (t) => String(t).replace(/^Default /, "") || "your theme";
const say = (action, value) => vscode.postMessage({ type: "start", action, value });
const list = (names) => names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0] || "";
function body(id) {
  const m = model;
  if (id === "signIn") return m.account.signedIn
    ? '<p>Signed in' + (m.account.email ? " as " + esc(m.account.email) : "") + '. The parts library is yours to use.</p>'
    : '<p>A free Protoboard account unlocks the parts library.</p><div class="row"><button class="btn" data-action="signIn">Sign In</button></div>';
  if (id === "agents") {
    const a = m.agents;
    const found = a.waiting.length ? '<p class="note muted">Found here: ' + esc(list(a.waiting)) + '.</p>' : a.connected.length ? '' : '<p class="note muted">No agent was found on this machine. Settings has the entry for any other.</p>';
    const have = a.connected.length ? '<p class="note muted">Connected: ' + esc(list(a.connected)) + '.</p>' : '';
    const path = a.onPath ? '' : '<p class="note muted">An agent that starts its own shell needs the protoboard command.</p><div class="row"><button class="btn second" data-action="addToPath">Add to PATH</button></div>';
    return '<p>Claude Code, Codex, Cursor and others work on the project through Protoboard.</p><div class="row"><button class="btn" data-action="connectAgents">Connect Agents</button></div>' + found + have + path;
  }
  if (id === "example") return m.example.carried
    ? '<p>A complete drone to explore. Then ask your agent to change it.</p><div class="card inline"><div class="shot"><img alt="" src="' + esc(PICTURE) + '"></div><div class="text"><b>' + esc(m.example.title) + '</b><span class="muted">' + esc(m.example.text) + '</span><button class="btn" data-action="openExample">Open</button></div></div>'
    : '<p class="muted">This build does not carry the example.</p>';
  if (id === "theme") {
    const t = m.theme;
    const on = t.choices.some((c) => c.id === t.current);
    const tiles = t.choices.map((c) => {
      const s = c.swatch, sel = c.id === t.current;
      return '<button class="tile' + (sel ? " on" : "") + '" data-action="theme" data-value="' + esc(c.id) + '" aria-pressed="' + sel + '">'
        + '<span class="swatch" style-bg="' + esc(s.editor) + '" style-line="' + esc(s.line) + '"><i class="top" style-bg="' + esc(s.side) + '"></i><span class="mid"><i class="side" style-bg="' + esc(s.side) + '"></i><span class="lines"><i style-bg="' + esc(s.bar) + '" style-w="70%"></i><i style-bg="' + esc(s.line) + '" style-w="96%"></i><i style-bg="' + esc(s.line) + '" style-w="54%"></i></span></span><i class="bar" style-bg="' + esc(s.bar) + '"></i></span>'
        + '<span class="name"><span class="mark">' + (sel ? ICONS.done : ICONS.circle) + '</span>' + esc(c.id) + '</span></button>';
    }).join("");
    const note = on ? 'Click the selected theme again to go back to ' + esc(label(t.previous || "")) + '.' : 'Your theme now: ' + esc(label(t.current)) + '.';
    return '<p>Protoboard\\'s own colours for the editor and the viewer. Optional.</p><div class="tiles">' + tiles + '</div><p class="note muted">' + note + '</p>';
  }
  return '<p>Blank, or from a template: a drone, a wearable or an IoT board.</p><div class="row"><button class="btn" data-action="newProject">New Project</button></div>';
}
function draw() {
  const first = model.steps.find((s) => !s.done);
  if (!open || !model.steps.some((s) => s.id === open)) open = first ? first.id : model.steps[0].id;
  document.getElementById("steps").innerHTML = model.steps.map((s) =>
    '<div class="step' + (s.id === open ? " open" : "") + '" data-step="' + s.id + '"><button aria-expanded="' + (s.id === open) + '"><span class="mark">' + (s.done ? ICONS.done : ICONS.circle) + '</span>' + esc(s.title) + '</button><div class="body">' + (s.id === open ? body(s.id) : "") + '</div></div>').join("");
  // colours of the theme pictures are data, set from script: the policy allows no inline style attribute
  for (const el of document.querySelectorAll("[style-bg]")) el.style.background = el.getAttribute("style-bg");
  for (const el of document.querySelectorAll("[style-line]")) el.style.borderColor = el.getAttribute("style-line");
  for (const el of document.querySelectorAll("[style-w]")) el.style.width = el.getAttribute("style-w");
}
document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-action]");
  if (act) return say(act.dataset.action, act.dataset.value);
  const head = e.target.closest(".step>button");
  if (head) {
    open = head.parentElement.dataset.step;
    vscode.setState({ open });
    draw();
  }
});
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "model") {
    const before = model.steps.find((s) => s.id === open);
    model = e.data.model;
    // a step just done hands over to the next one that is not; the theme step stays, for its way back is in it
    const now = model.steps.find((s) => s.id === open);
    if (open !== "theme" && before && now && !before.done && now.done) open = undefined;
    draw();
  }
});
draw();
say("ready");
`;

const VIEW_JS = `
const vscode = acquireVsCodeApi();
const ICONS = ${JSON.stringify({ lock: ICONS.lock, search: ICONS.search, part: ICONS.part })};
const PICTURE = document.body.dataset.picture;
let model = JSON.parse(document.getElementById("model").textContent);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const say = (action, value) => vscode.postMessage({ type: "start", action, value });
function draw() {
  const m = model;
  const card = m.example.carried
    ? '<div class="card"><div class="shot"><img alt="" src="' + esc(PICTURE) + '"></div><div class="text"><span class="tag">EXAMPLE</span><b>' + esc(m.example.title) + '</b><span class="muted">' + esc(m.example.text) + '</span><button class="btn wide" data-action="openExample">Open</button></div></div>'
    : '';
  const gate = m.account.signedIn
    ? '<div class="gate">' + ICONS.part + '<span>Open a project to use the library</span></div>'
    : '<div class="gate">' + ICONS.lock + '<span>Sign in to use the library</span><button class="btn" data-action="signIn">Sign In</button></div>';
  const tops = [...new Set(m.parts.map((p) => p.top).filter(Boolean))].slice(0, 3);
  const rows = m.parts.map((p) => '<div class="part">' + ICONS.part + '<span>' + esc(p.name) + '</span><em>' + esc(p.category) + '</em></div>').join("");
  const preview = m.parts.length
    ? '<div class="preview" aria-hidden="true" inert><div class="field">' + ICONS.search + 'Search parts</div><div class="chips"><i>All</i>' + tops.map((t) => '<i>' + esc(t) + '</i>').join("") + '</div>' + rows + '</div>'
    : '';
  document.getElementById("root").innerHTML =
    '<h2>Start</h2><section>' + card + '<button class="btn second wide" data-action="newProject">New Project</button><button class="link" data-action="openStart">Get Started</button></section>'
    + '<h2>Library</h2><section>' + gate + preview + '</section>';
}
document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-action]");
  if (act) say(act.dataset.action, act.dataset.value);
});
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "model") {
    model = e.data.model;
    draw();
  }
});
draw();
say("ready");
`;

const page = (e: PageEnv, title: string, css: string, js: string, model: unknown, inner: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp(e))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style nonce="${escapeHtml(e.nonce)}">${css}</style>
</head>
<body data-picture="${escapeHtml(e.picture)}">
${inner}
<script type="application/json" id="model">${json(model)}</script>
<script nonce="${escapeHtml(e.nonce)}">${js}</script>
</body>
</html>`;

/** The getting-started page (an editor tab). */
export function startHtml(e: PageEnv, model: StartModel): string {
  return page(
    e,
    START_TITLE,
    PAGE_CSS,
    PAGE_JS,
    model,
    `<main><div class="steps"><h1>${escapeHtml(START_TITLE)}</h1><p class="lead">${escapeHtml(START_LINE)}</p><div id="steps"></div></div><div class="media"><div class="card"><img alt="The 5-inch quadcopter example" src="${escapeHtml(e.picture)}"></div></div></main>`,
  );
}

export interface StartViewModel {
  account: StartModel["account"];
  example: StartModel["example"];
  /** The example's own parts: what the Library looks like, before a sign-in. */
  parts: PreviewPart[];
}

/** The Start view of a window with no project (the Protoboard Library side bar). */
export function startViewHtml(e: PageEnv, model: StartViewModel): string {
  return page(e, "Protoboard", VIEW_CSS, VIEW_JS, model, `<div id="root"></div>`);
}
