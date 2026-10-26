/**
 * Headless captures of the Protoboard settings page (PB-930) as a standalone
 * page, in the token sets VS Code gives a webview: Dark Modern, Light Modern,
 * High Contrast (dark and light), Protoboard Dark and Protoboard Light, wide
 * and narrow. The page is the one the extension ships (dist/views-app.js,
 * `data-screen="settings"`); the model is what the extension computes
 * (src/agents.ts) for a machine with agents in every state.
 *
 *   # 1. the token sets, read from a real VS Code by the integration test
 *   PROTOBOARD_TOKENS_OUT=/tmp/tokens.json npm run test:integration
 *   # 2. the captures (needs node esbuild.mjs)
 *   npx tsx test/visual/settings-capture.ts --tokens /tmp/tokens.json --out /tmp/captures [--port 5396]
 *
 * It also checks what a capture cannot show at a glance: no page scrollbar of
 * the browser's, no text cut off sideways at the narrow width, every button
 * named, and the actions the buttons send. Chrome: $CHROME or an installed Chrome, Chromium, Edge or Brave.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findBrowser, noBrowserMessage } from "@protoboardai/core/browser";
import type { AgentState } from "@protoboardai/core/agents";
import { settingsModel } from "../../src/agents.js";

// $CHROME, else an installed Chrome, Chromium, Edge or Brave on this OS (core's lookup)
const chromePath = (): string => findBrowser()?.path ?? (() => { throw new Error(noBrowserMessage()); })();

const PKG = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const { values } = parseArgs({ options: { tokens: { type: "string" }, out: { type: "string" }, port: { type: "string" }, themes: { type: "string" } } });
if (!values.tokens || !values.out) throw new Error("give --tokens <file> (from the integration test) and --out <dir>");
const OUT = resolve(values.out);
mkdirSync(OUT, { recursive: true });
const TOKENS = JSON.parse(readFileSync(values.tokens, "utf8")) as Record<string, { name: string; vars: Record<string, string>; classes: string[] }>;
const THEMES = (
  [
    ["vscode-dark", "Default Dark Modern"],
    ["vscode-light", "Default Light Modern"],
    ["vscode-hc-dark", "Default High Contrast"],
    ["vscode-hc-light", "Default High Contrast Light"],
    ["protoboard-dark", "Protoboard Dark"],
    ["protoboard-light", "Protoboard Light"],
  ] as [string, string][]
).filter(([id]) => !values.themes || values.themes.split(",").includes(id));
const PORT = Number(values.port ?? 5396);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** VS Code's default webview styles, as every webview page starts. */
const VSCODE_DEFAULTS = `
html { scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background); }
body { background-color: transparent; color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-weight: var(--vscode-font-weight); font-size: var(--vscode-font-size); margin: 0; padding: 0 20px; }
img, video { max-width: 100%; max-height: 100%; }
a, a code { color: var(--vscode-textLink-foreground); }`;

const HOME = "/Users/ada";
const LAUNCHER = { command: `${HOME}/.config/protoboard/agents/protoboard-mcp`, args: [] as string[] };
const agent = (id: string, name: string, file: string, over: Partial<AgentState> = {}): AgentState => ({ id, name, scope: "user", detected: true, evidence: "found", file: `${HOME}/${file}`, status: "not-connected", serverName: "protoboard", method: "file", docs: "", restart: "", ...over });

/** A machine with an agent in every state the page draws. */
const AGENTS: AgentState[] = [
  agent("claude-code", "Claude Code", ".claude.json", { status: "connected", entry: LAUNCHER, method: "command" }),
  agent("claude-desktop", "Claude Desktop", "Library/Application Support/Claude/claude_desktop_config.json"),
  agent("claude-code-manual", "Claude Code", ".claude.json", { method: "command", manual: `claude mcp add --scope user protoboard -- ${LAUNCHER.command}` }),
  agent("cursor", "Cursor", ".cursor/mcp.json", { otherServer: "https://protoboard.example", serverName: "protoboard-stack" }),
  agent("vscode", "VS Code (Copilot agent mode)", "Library/Application Support/Code/User/mcp.json", { status: "connected", entry: LAUNCHER }),
  agent("codex", "Codex", ".codex/config.toml", { status: "outdated", entry: { command: "/Users/ada/old/protoboard-mcp", args: [] } }),
  agent("gemini", "Gemini CLI", ".gemini/settings.json", { status: "unreadable", problem: `${HOME}/.gemini/settings.json is not valid JSON (CommaExpected at character 212); it was left alone` }),
  agent("vscode-insiders", "VS Code Insiders (Copilot agent mode)", "x", { status: "not-detected", detected: false }),
  agent("windsurf", "Windsurf (Devin Desktop)", "x", { status: "not-detected", detected: false }),
  agent("cline", "Cline (VS Code)", "x", { status: "not-detected", detected: false }),
  agent("cline-cli", "Cline CLI", "x", { status: "not-detected", detected: false }),
];

const version = (JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as { version: string }).version;
const MODELS = {
  settings: settingsModel({
    account: { state: "signed-in", service: "https://parts.protoboard.example", email: "ada@example.com", detail: "sign-in kept in the macOS keychain" },
    version,
    cli: { command: { command: "/opt/homebrew/bin/node", args: [`${HOME}/projects/soil-sensor/node_modules/@protoboardai/cli/bin/protoboard.mjs`], from: "project" }, origin: "project" },
    agents: AGENTS,
    command: LAUNCHER,
    home: HOME,
    notes: { vscode: { text: "Added to ~/Library/Application Support/Code/User/mcp.json. The file as it was is kept as ~/Library/Application Support/Code/User/mcp.json.protoboard-backup. VS Code asks to start the server the next time agent mode lists its tools.", tone: "ok" } },
    working: new Set(["claude-desktop"]),
    // what the extension lists for a window with a project and a carried stack (extension.ts, settingsLinks)
    links: [
      { id: "start", label: "First steps", note: "Sign in, make a project from a template, open the viewer, use the terminal", icon: "map", action: "Open" },
      { id: "createProject", label: "A new project", note: "From a template (drone, wearable, IoT) or empty, in this window's folder or another", icon: "folder-plus", action: "Create" },
      { id: "bom", label: "Bill of materials", note: "soil-sensor: the design's parts with the offer chosen for each, in dollars", icon: "table", action: "Open" },
      { id: "stack", label: `The stack this extension carries (${version})`, note: `~/.protoboard/stack/${version}: a project without packages links to it, and this window's terminals have the protoboard command`, icon: "package", action: "Show Folder" },
      { id: "account", label: "Check the account again", note: "Ask the service whether this account may use Protoboard", icon: "refresh-cw", action: "Check" },
    ],
  }),
  "settings-empty": settingsModel({ account: { state: "signed-out", service: "https://parts.protoboard.example" }, version, cli: { command: { command: "protoboard", args: [], from: "path" } }, agents: AGENTS.map((a) => ({ ...a, detected: false, status: "not-detected" as const })), command: LAUNCHER, home: HOME }),
};

function page(theme: string, model: unknown): string {
  const t = TOKENS[theme];
  if (!t) throw new Error(`no token set for ${theme} in ${values.tokens}`);
  const vars = Object.entries(t.vars).map(([k, v]) => `${k}: ${v};`).join(" ");
  const kind = t.classes.find((c) => c.startsWith("vscode-")) ?? "vscode-dark";
  return `<!doctype html>
<html lang="en" style="${vars.replace(/"/g, "&quot;")}">
<head><meta charset="utf-8"><style id="_defaultStyles">${VSCODE_DEFAULTS}</style>
<link rel="stylesheet" href="/dist/views-app.css">
<style>html { background: var(--vscode-editor-background) !important; }</style></head>
<body data-screen="settings" data-theme="vscode">
<script>
  window.__posted = [];
  const message = ${JSON.stringify({ type: "model", model })};
  window.acquireVsCodeApi = () => ({ postMessage: (m) => { window.__posted.push(m); if (m.type === "ready") setTimeout(() => window.postMessage(message, "*"), 0); }, getState: () => undefined, setState: () => undefined });
  document.body.className = ${JSON.stringify(t.classes.join(" "))};
  document.body.dataset.vscodeThemeKind = ${JSON.stringify(kind)};
  document.body.dataset.vscodeThemeName = ${JSON.stringify(t.name)};
  document.body.dataset.vscodeThemeId = ${JSON.stringify(t.name)};
</script>
<div id="root"></div>
<script type="module" src="/dist/views-app.js"></script>
</body></html>`;
}

const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".map": "application/json" };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  if (url.pathname === "/page") {
    const model = MODELS[(url.searchParams.get("model") ?? "settings") as keyof typeof MODELS];
    const id = url.searchParams.get("theme") ?? "vscode-dark";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(THEMES.find(([t]) => t === id)?.[1] ?? id, model));
    return;
  }
  if (url.pathname === "/favicon.ico") return void res.writeHead(204).end();
  const file = normalize(join(PKG, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PKG + sep) && file !== PKG) return void res.writeHead(403).end();
  if (!existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise<void>((ok) => server.listen(PORT, "127.0.0.1", ok));

// puppeteer-core is the viewer's (as capture.ts finds it)
const REPO = resolve(PKG, "..", "..");
const puppeteer = (() => {
  for (const from of [join(REPO, "..", "uhd-viewer", "package.json")]) {
    try {
      return createRequire(from)("puppeteer-core");
    } catch {
      /* next */
    }
  }
  return createRequire(import.meta.url)("puppeteer-core");
})();
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--window-size=1500,1100"] });
const problems: string[] = [];
const shots: string[] = [];
const SIZES: [string, number, number][] = [
  ["wide", 1400, 1200],
  ["narrow", 420, 1200],
];

try {
  for (const [theme] of THEMES) {
    for (const [sizeName, width, height] of SIZES) {
      for (const model of Object.keys(MODELS)) {
        if (model !== "settings" && (theme !== "vscode-dark" || sizeName !== "wide")) continue;
        const p = await browser.newPage();
        await p.setViewport({ width, height, deviceScaleFactor: 1 });
        const errors: string[] = [];
        p.on("pageerror", (e: Error) => errors.push(String(e)));
        p.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && errors.push(m.text()));
        await p.goto(`${ORIGIN}/page?theme=${theme}&model=${model}`, { waitUntil: "load" });
        await p.waitForSelector("h1", { timeout: 20000 }).catch(async () => {
          throw new Error(`${theme} ${sizeName}: the page did not draw: ${errors.join("; ") || (await p.evaluate(() => document.body.innerHTML.slice(0, 300)))}`);
        });
        await new Promise((r) => setTimeout(r, 400));
        const name = `${model}-${theme}-${sizeName}`;
        const path = join(OUT, `${name}.png`);
        await p.screenshot({ path });
        shots.push(path);
        const facts = await p.evaluate(() => {
          const doc = document.documentElement;
          const unnamed = [...document.querySelectorAll("button")].filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("aria-label")).length;
          const noTip = [...document.querySelectorAll("button")].filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("data-tooltip")).length;
          // text that runs out of the page sideways (cut off, since the page never scrolls sideways)
          const cut = [...document.querySelectorAll("h1, h2, p, button, pre, li")].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1) && !e.closest("[data-radix-scroll-area-viewport] pre");
          }).length;
          const upright = [...document.querySelectorAll("*")].every((e) => {
            const s = getComputedStyle(e);
            return s.writingMode === "horizontal-tb" && (s.rotate === "none" || s.rotate === "");
          });
          return {
            pageScrolls: doc.scrollHeight > doc.clientHeight + 1 || doc.scrollWidth > doc.clientWidth + 1 || getComputedStyle(document.body).overflow !== "hidden",
            radix: document.querySelectorAll("[data-radix-scroll-area-viewport]").length,
            rows: document.querySelectorAll("[data-agent]").length,
            // every row has a way to its configuration file that can be seen and clicked, at this width too
            noFileButton: [...document.querySelectorAll("[data-agent]")].filter((row) => ![...row.querySelectorAll("button")].some((b) => /^Open (the configuration )?file$/.test(b.getAttribute("aria-label") ?? (b.textContent ?? "").trim()) && b.getClientRects().length > 0 && b.getBoundingClientRect().right <= window.innerWidth)).length,
            unnamed,
            noTip,
            cut,
            upright,
            h1: document.querySelector("h1")?.textContent,
            font: getComputedStyle(document.querySelector("h1")!).fontFamily.slice(0, 40),
            accent: getComputedStyle(document.querySelector("[data-agent] button") ?? document.body).backgroundColor,
          };
        });
        if (errors.length) problems.push(`${name}: ${errors.join("; ")}`);
        if (facts.pageScrolls) problems.push(`${name}: the page itself scrolls (the browser's scrollbar)`);
        if (facts.radix < 1) problems.push(`${name}: no Radix scroll area`);
        if (facts.unnamed) problems.push(`${name}: ${facts.unnamed} icon button(s) with no name`);
        if (facts.noTip) problems.push(`${name}: ${facts.noTip} icon button(s) with no tooltip`);
        if (facts.cut) problems.push(`${name}: ${facts.cut} element(s) run out of the page sideways`);
        if (!facts.upright) problems.push(`${name}: text that is not upright`);
        if (model === "settings" && facts.rows !== 7) problems.push(`${name}: ${facts.rows} agent rows, expected 7`);
        if (facts.noFileButton) problems.push(`${name}: ${facts.noFileButton} agent row(s) with no visible button that opens the configuration file`);
        // narrow, once: the button that is shown there opens that row's file
        if (model === "settings" && theme === "vscode-dark" && sizeName === "narrow") {
          await p.evaluate(() => ([...document.querySelectorAll('[data-agent="vscode"] button')].find((b) => b.getAttribute("aria-label") === "Open the configuration file" && b.getClientRects().length > 0) as HTMLElement).click());
          const sent = (await p.evaluate(() => (window as unknown as { __posted: { type: string; id?: string }[] }).__posted)).filter((m) => m.type === "openFile").map((m) => m.id);
          if (JSON.stringify(sent) !== '["vscode"]') problems.push(`narrow: the open-file button sent ${JSON.stringify(sent)}`);
          console.log(`narrow: openFile:${sent.join(",")}`);
        }
        console.log(`${name}: ${facts.rows} rows, font ${facts.font}, first button ${facts.accent}`);

        // once: the buttons send the actions the extension acts on, for the agent of their row
        if (model === "settings" && theme === "vscode-dark" && sizeName === "wide") {
          const click = async (selector: string, text: string) => {
            await p.evaluate(
              (sel, t) => {
                const b = [...document.querySelectorAll(sel)].find((x) => (x.textContent ?? "").trim() === t || x.getAttribute("aria-label") === t) as HTMLElement | undefined;
                if (!b) throw new Error(`no ${t} in ${sel}`);
                b.click();
              },
              selector,
              text,
            );
          };
          await click('[data-agent="cursor"] button', "Connect");
          await click('[data-agent="claude-code-manual"] button', "Copy command");
          await click('[data-agent="codex"] button', "Update");
          await click('[data-agent="claude-code"] button', "Disconnect");
          await click('[data-agent="gemini"] button', "Open file");
          await click('[data-agent="vscode"] button', "Open the configuration file");
          await click("button", "Look for agents again");
          await click('[role="tab"]', "TOML");
          await click("button", "Copy the TOML");
          await click("button", "Open");
          const posted = (await p.evaluate(() => (window as unknown as { __posted: { type: string; id?: string; what?: string; text?: string }[] }).__posted)).filter((m) => m.type !== "ready");
          const got = posted.map((m) => [m.type, m.id ?? m.what ?? ""].join(":"));
          const want = ["connect:cursor", "copy:command", "connect:codex", "disconnect:claude-code", "openFile:gemini", "openFile:vscode", "refresh:", "copy:TOML", "openVsCodeSettings:"];
          if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`actions: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
          if (posted.find((m) => m.type === "copy" && m.what === "command")?.text !== `claude mcp add --scope user protoboard -- ${LAUNCHER.command}`) problems.push("the command copied for Claude Code is not the one to run");
          if (await p.evaluate(() => [...document.querySelectorAll('[data-agent="claude-code-manual"] button')].some((b) => (b.textContent ?? "").trim() === "Connect"))) problems.push("a row Protoboard cannot connect itself still offers Connect");
          const toml = posted.find((m) => m.type === "copy" && m.what === "TOML")?.text ?? "";
          // Cursor in this model has another server named protoboard: what is copied takes the free name
          if (!toml.startsWith("[mcp_servers.protoboard-stack]")) problems.push(`the TOML copied is ${JSON.stringify(toml.slice(0, 60))}`);
          // a row that is working cannot be clicked twice
          const disabled = await p.evaluate(() => ([...document.querySelectorAll('[data-agent="claude-desktop"] button')].find((b) => (b.textContent ?? "").trim() === "Connect") as HTMLButtonElement).disabled);
          if (!disabled) problems.push("the Connect button of a row that is working is not disabled");
          console.log(`actions: ${got.join(", ")}`);
        }
        await p.close();
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`${shots.length} captures in ${OUT}`);
if (problems.length) {
  console.error(problems.map((x) => `PROBLEM ${x}`).join("\n"));
  process.exit(1);
}
