/**
 * A Manufacturing Package's `index.html` in a VS Code webview. The page is
 * static (ext-release writes it with no script); it is shown as written with
 * a `<base>` at the package folder so its figures and fonts load, a
 * Content-Security-Policy that allows only the package's own files and its
 * inline styles, and one script of ours: in-page links scroll, and links to
 * the package's files (PDFs, CSVs, CAD) are handed to the extension, which
 * opens them the way the Explorer opens artifacts.
 */
import { escapeHtml } from "./html.js";

/** Page → extension. */
export type PackagePageMessage = { type: "open"; href: string };

export function packageHtml(html: string, p: { base: string; cspSource: string; nonce: string }): string {
  const csp = [
    "default-src 'none'",
    `img-src ${p.cspSource} data:`,
    `font-src ${p.cspSource} data:`,
    `style-src ${p.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${p.nonce}'`,
    "form-action 'none'",
  ].join("; ");
  const base = p.base.endsWith("/") ? p.base : `${p.base}/`;
  const head = `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">\n<base href="${escapeHtml(base)}">\n`;
  const script = `<script nonce="${p.nonce}">
(() => {
  const vscode = acquireVsCodeApi();
  const base = document.baseURI;
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a) return;
    const href = a.getAttribute("href");
    e.preventDefault();
    if (href.startsWith("#")) {
      const t = document.getElementById(decodeURIComponent(href.slice(1)));
      if (t) t.scrollIntoView({ block: "start" });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !a.href.startsWith(base)) return vscode.postMessage({ type: "open", href });
    vscode.postMessage({ type: "open", href: a.href.startsWith(base) ? decodeURIComponent(a.href.slice(base.length).split("#")[0]) : href });
  });
})();
</script>`;
  // after the charset declaration (it must come first), else at the top of <head>
  const at = /<meta\s+charset=[^>]*>/i.test(html) ? /<meta\s+charset=[^>]*>/i : /<head[^>]*>/i;
  const withHead = at.test(html) ? html.replace(at, (m) => `${m}\n${head}`) : `${head}${html}`;
  return /<\/body>/i.test(withHead) ? withHead.replace(/<\/body>/i, `${script}\n</body>`) : `${withHead}${script}`;
}

/**
 * Where a link of the package page points: a file inside the package
 * (relative, no `..` escaping it), or an external http(s) URL; anything else
 * is ignored.
 */
export function packageLink(href: string): { kind: "file"; path: string } | { kind: "url"; url: string } | undefined {
  if (/^https?:\/\//i.test(href)) return { kind: "url", url: href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("\\")) return undefined;
  const parts: string[] = [];
  for (const seg of href.split(/[\\/]/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? { kind: "file", path: parts.join("/") } : undefined;
}
