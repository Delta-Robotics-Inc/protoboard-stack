/**
 * A page as VS Code gives it to a webview, for the headless captures
 * (capture.ts, views-capture.ts): VS Code's default webview styles first in
 * <head>, the theme's `--vscode-*` variables on <html>, the body's theme class
 * and theme id, and an `acquireVsCodeApi` stand-in that keeps what the page
 * posts in `window.__posted`.
 */

/** A theme's tokens as a real VS Code gives them to a webview (read by the integration test, PROTOBOARD_TOKENS_OUT). */
export interface TokenSet {
  name: string;
  vars: Record<string, string>;
  classes: string[];
}

/** VS Code's default webview styles (src/vs/workbench/contrib/webview/browser/pre/index.html), as every webview page starts. */
export const VSCODE_DEFAULTS = `
html { scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background); }
body { background-color: transparent; color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-weight: var(--vscode-font-weight); font-size: var(--vscode-font-size); margin: 0; padding: 0 20px; }
img, video { max-width: 100%; max-height: 100%; }
a, a code { color: var(--vscode-textLink-foreground); }
code { color: var(--vscode-textPreformat-foreground); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-corner { background-color: var(--vscode-editor-background); }
::-webkit-scrollbar-thumb { background-color: var(--vscode-scrollbarSlider-background); }
::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground); }
::-webkit-scrollbar-thumb:active { background-color: var(--vscode-scrollbarSlider-activeBackground); }
`;

/** What VS Code adds to a webview page: its defaults first in <head>, the theme on <html> and <body>, the API stand-in. */
export function webviewPage(html: string, t: TokenSet, nonce: string, surface: "editor" | "sideBar" | "panel" = "editor"): string {
  const vars = Object.entries(t.vars).map(([k, v]) => `${k}: ${v};`).join(" ");
  const kind = t.classes.find((c) => c.startsWith("vscode-")) ?? "vscode-dark";
  const boot = `<script nonce="${nonce}">
    window.__posted = [];
    // the tab's own state (the viewports of its levels) lasts as a webview's does: across a reload of the page
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => window.__posted.push(m),
      getState: () => { try { return JSON.parse(sessionStorage.getItem("__vscode_state") ?? "null") ?? undefined; } catch { return undefined; } },
      setState: (v) => { try { sessionStorage.setItem("__vscode_state", JSON.stringify(v)); } catch { /* no storage */ } },
    });
    document.body.className = ${JSON.stringify(t.classes.join(" "))};
    document.body.dataset.vscodeThemeKind = ${JSON.stringify(kind)};
    document.body.dataset.vscodeThemeName = ${JSON.stringify(t.name)};
    document.body.dataset.vscodeThemeId = ${JSON.stringify(t.name)};
  </script>`;
  return html
    .replace("<head>", `<head>\n<style id="_defaultStyles">${VSCODE_DEFAULTS}</style>`)
    // the webview is transparent: what shows through is the part of the window that hosts it (the page's own rules set transparent)
    .replace("</head>", `<style nonce="${nonce}">html { background: var(--vscode-${surface}-background) !important; }</style>\n</head>`)
    .replace("<html lang=\"en\">", `<html lang="en" style="${vars.replace(/"/g, "&quot;")}">`)
    .replace(/<body([^>]*)>/, (_m, attrs: string) => `<body${attrs}>\n${boot}`);
}

/**
 * A token set made from a colour theme file, as VS Code makes a webview's
 * variables from the theme's colours (`editor.background` →
 * `--vscode-editor-background`): for a run with no tokens read from a real
 * VS Code (the views' integration step). The theme's own colours only; what
 * VS Code derives for keys the theme leaves out is missing.
 */
export function tokensFromTheme(theme: { name: string; type?: string; colors: Record<string, string> }): TokenSet {
  const vars: Record<string, string> = {
    "--vscode-font-family": "system-ui, sans-serif",
    "--vscode-font-weight": "normal",
    "--vscode-font-size": "13px",
    "--vscode-editor-font-family": "monospace",
  };
  for (const [k, v] of Object.entries(theme.colors)) vars[`--vscode-${k.replace(/\./g, "-")}`] = v;
  const kind = theme.type === "light" ? "vscode-light" : theme.type === "hc" ? "vscode-high-contrast" : "vscode-dark";
  return { name: theme.name, vars, classes: [kind] };
}
