/**
 * Editors that Protoboard extensions provide (extensionEditors.ts,
 * extensionEditorPage.ts): the page loads only the extension's bundle, under
 * a nonce policy with no network; the fallback page runs no script and calls
 * only its few commands; paths the page or the host give stay inside the
 * project (and the package, for webview URIs); file.pick returns the paths
 * of the files picked in VS Code's open dialog, which may be outside the
 * project; a service the shell does not offer is refused by name; the
 * manifest declares the selector and the activation event.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { EXTENSION_EDITOR, FALLBACK_COMMANDS, REOPEN_AS_TEXT, editorCsp, editorHtml, fallbackHtml, fallbacks, guardedPath } from "../src/extensionEditorPage.js";

type FakeUri = { scheme: string; fsPath: string };
const dialogs: Record<string, unknown>[] = [];
let picked: FakeUri[] | undefined;

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string): FakeUri => ({ scheme: "file", fsPath }) },
  window: {
    showOpenDialog: (options: Record<string, unknown>) => {
      dialogs.push(options);
      return Promise.resolve(picked);
    },
  },
}));

const { pickFiles, serviceName } = await import("../src/extensionEditors.js");

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

  it("picks files in VS Code's open dialog, in the edited file's folder: several, none when canceled, files only", async () => {
    const folder = resolve("/work/proj/plans");
    const a = resolve("/work/proj/items/a.png");
    const outside = resolve("/elsewhere/photos/b.jpg");
    dialogs.length = 0;
    picked = [
      { scheme: "file", fsPath: a },
      { scheme: "file", fsPath: outside },
    ];
    // the person chose them: a file outside the project comes back too, as its path
    expect(await pickFiles({ multiple: true, title: "Add images", filters: { Images: ["png", "jpg"] } }, folder)).toEqual({ paths: [a, outside] });
    expect(dialogs[0]).toEqual({ canSelectFiles: true, canSelectFolders: false, canSelectMany: true, defaultUri: { scheme: "file", fsPath: folder }, title: "Add images", filters: { Images: ["png", "jpg"] } });

    picked = undefined;
    expect(await pickFiles({}, folder)).toEqual({ paths: [] });
    expect(dialogs[1]).toEqual({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, defaultUri: { scheme: "file", fsPath: folder } });

    picked = [
      { scheme: "vscode-remote", fsPath: "/remote/c.png" },
      { scheme: "file", fsPath: a },
      { scheme: "untitled", fsPath: "Untitled-1" },
    ];
    expect(await pickFiles({ multiple: true }, folder)).toEqual({ paths: [a] });

    // a leading dot is dropped, and a filter with no extension left is not offered
    picked = undefined;
    await pickFiles({ filters: { Images: [".png", "jpg", ""], Nothing: [], Bad: "png" } }, folder);
    expect(dialogs[3]).toMatchObject({ filters: { Images: ["png", "jpg"] } });
    await pickFiles({ filters: { Nothing: [] } }, folder);
    expect(dialogs[4]).not.toHaveProperty("filters");
  });

  it("refuses a service it does not offer by name, so an editor can tell an older shell", () => {
    expect(serviceName("file.pick")).toBe("file.pick");
    expect(serviceName("document.applyEdit")).toBe("document.applyEdit");
    expect(() => serviceName("file.frobnicate")).toThrow(/^no service file\.frobnicate$/);
    expect(() => serviceName(undefined)).toThrow(/^no service undefined$/);
  });

  it("is declared in the manifest for *.canvas, and activates the extension", () => {
    const manifest = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
    const editor = manifest.contributes.customEditors.find((c: { viewType: string }) => c.viewType === EXTENSION_EDITOR);
    expect(editor.selector).toEqual([{ filenamePattern: "*.canvas" }]);
    expect(manifest.activationEvents).toContain(`onCustomEditor:${EXTENSION_EDITOR}`);
  });
});
