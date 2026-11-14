/**
 * Editors that Protoboard extensions provide (extensionEditors.ts,
 * extensionEditorPage.ts): the page loads only the extension's bundle, under
 * a nonce policy with no network; the fallback page runs no script and calls
 * only its few commands; paths the page or the host give stay inside the
 * project (and the package, for webview URIs); the manifest declares the
 * selector and the activation event.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXTENSION_EDITOR, FALLBACK_COMMANDS, REOPEN_AS_TEXT, editorCsp, editorHtml, fallbackHtml, fallbacks, guardedPath } from "../src/extensionEditorPage.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));

describe("an extension editor's page", () => {
  it("allows scripts only by nonce and loads from the webview's own resources only", () => {
    const csp = editorCsp("https://*.vscode-cdn.net", "N0NCE");
    expect(csp).toBe(
      "default-src 'none'; img-src https://*.vscode-cdn.net data: blob:; media-src https://*.vscode-cdn.net blob:; style-src https://*.vscode-cdn.net; font-src https://*.vscode-cdn.net; connect-src https://*.vscode-cdn.net; script-src 'nonce-N0NCE'; base-uri 'none'; form-action 'none'",
    );
    expect(csp).not.toMatch(/unsafe|https?:\/\/(?!\*\.vscode-cdn)/);
  });

  it("loads the bundle as a module after a prelude that shares the API handle and reports violations", () => {
    const html = editorHtml({ cspSource: "https://*.vscode-cdn.net", nonce: "N0NCE", script: "https://x/pkg/dist/e.js", style: "https://x/pkg/dist/e.css", title: "a <b>.canvas" });
    expect(html).toContain('<script type="module" nonce="N0NCE" src="https://x/pkg/dist/e.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="https://x/pkg/dist/e.css">');
    expect(html).toContain("<title>a &lt;b&gt;.canvas</title>");
    expect(html).toContain("window.acquireVsCodeApi=function(){return api;}");
    expect(html).toContain('protoboard:"csp"');
    // every script carries the nonce; a test run's page says it is one
    expect(html.match(/<script(?![^>]*nonce="N0NCE")/g)).toBeNull();
    expect(html).not.toContain("data-protoboard-editor-test");
    expect(editorHtml({ cspSource: "c", nonce: "n", script: "s", title: "t", test: true })).toContain('<body data-protoboard-editor-test="1">');
  });

  it("says why nothing opens, with no script, and links only its commands", () => {
    const uri = "file:///c%3A/p/a.canvas";
    for (const f of [fallbacks.restricted(uri), fallbacks.untrusted(uri, "p", "C:\\p"), fallbacks.unclaimed(uri, "p", "a.canvas", []), fallbacks.notBuilt(uri, "ext-a", ["node_modules/ext-a/dist/e.js"]), fallbacks.failed(uri, "boom")]) {
      const html = fallbackHtml("N0NCE", f);
      expect(html).not.toMatch(/<script/);
      expect(html).toContain(`href="command:${REOPEN_AS_TEXT}?${encodeURIComponent(JSON.stringify([uri]))}"`);
      for (const [, command] of html.matchAll(/href="command:([^"?]+)/g)) expect(FALLBACK_COMMANDS).toContain(command);
    }
    expect(fallbacks.unclaimed(uri, "p", "a.canvas", ["ext-b"]).detail).toContain("ext-b");
  });

  it("keeps paths inside the project, and inside the package where it may be loaded", () => {
    const root = resolve("/work/proj");
    const pkg = join(root, "node_modules", "ext-a");
    expect(guardedPath(root, "items/a.png")).toBe(join(root, "items", "a.png"));
    expect(guardedPath(root, join(root, "a.png"))).toBe(join(root, "a.png"));
    expect(() => guardedPath(root, "../secret.txt")).toThrow(/outside the project/);
    expect(() => guardedPath(root, resolve("/etc/passwd"))).toThrow(/outside the project/);
    expect(() => guardedPath(root, "")).toThrow(/no path/);
    expect(() => guardedPath(root, resolve("/other/ext/x.js"), pkg)).toThrow();
    expect(guardedPath(root, join(pkg, "dist", "e.js"), pkg)).toBe(join(pkg, "dist", "e.js"));
  });

  it("is declared in the manifest for *.canvas, and activates the extension", () => {
    const manifest = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
    const editor = manifest.contributes.customEditors.find((c: { viewType: string }) => c.viewType === EXTENSION_EDITOR);
    expect(editor.selector).toEqual([{ filenamePattern: "*.canvas" }]);
    expect(manifest.activationEvents).toContain(`onCustomEditor:${EXTENSION_EDITOR}`);
  });
});
