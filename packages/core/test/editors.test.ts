/**
 * `contributes.editors` in extension manifests (docs/specs/viewer-stack.md):
 * an extension declares the files its editor opens, the page the shell
 * loads and the host process the page's services run in; malformed
 * declarations refuse the extension with the reason, and the first enabled
 * extension that claims a file opens it.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { claims, editorFor, filePatternRegExp, loadProject, loadProjectExtensions, resolveEditors, validateContributes, type ExtensionManifest } from "../src/index.js";
import { EDITOR_SERVICES, isEnvelope, themeKind, webviewUri } from "../src/editor-protocol.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-editors");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const manifest = (id: string, contributes?: unknown): ExtensionManifest =>
  ({ schema: "protoboard.extension/v0", id, version: "0.1.0", compatibility: { protoboard: "^0.3.0" }, ...(contributes !== undefined ? { contributes } : {}) }) as ExtensionManifest;

const board = { id: "board", title: "Board", icon: "layout-dashboard", files: ["*.board"], webview: { script: "./dist/board.js", style: "./dist/board.css" }, host: "./host/board-host.mjs#createHost" };

function project(name: string, extensions: Record<string, { manifest: ExtensionManifest; files?: string[] }>) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write(
    "protoboard.config.ts",
    `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, extensions: ${JSON.stringify(Object.keys(extensions))} });\n`,
  );
  write("src/sys.uhd.ts", `export const SYS = { id: "sys", interfaces: [] };\n`);
  write("package.json", JSON.stringify({ name, type: "module" }));
  for (const [pkg, { manifest: m, files = [] }] of Object.entries(extensions)) {
    write(`node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, version: "0.1.0", type: "module" }));
    write(`node_modules/${pkg}/protoboard-extension.json`, JSON.stringify(m));
    for (const f of files) write(`node_modules/${pkg}/${f}`, "");
  }
  return dir;
}

describe("contributes.editors", () => {
  it("accepts a well-formed editor, one without a host and one without a stylesheet", () => {
    expect(validateContributes(manifest("ext-a", { editors: [board] }))).toEqual([]);
    expect(validateContributes(manifest("ext-a", { editors: [{ ...board, host: undefined, webview: { script: "./page.js" } }] }))).toEqual([]);
    expect(validateContributes(manifest("ext-a", { views: [], editors: [] }))).toEqual([]);
  });

  it("names what is wrong with an editor", () => {
    const problems = validateContributes(
      manifest("ext-a", {
        editors: [
          { id: "Board", title: "x", icon: "x", files: ["*.b"], webview: { script: "./a.js" } },
          { id: "board", title: "", icon: "LayoutDashboard", files: [], webview: { script: "dist/a.js", style: "../a.css", inline: true }, host: "./host.mjs#create#again", extra: 1 },
          { id: "board", title: "Board", icon: "layout", files: ["../*.board", "C:\\x.board", "/abs.board"], webview: "./a.js", host: "/host.mjs" },
        ],
      }),
    );
    expect(problems).toEqual([
      'every editor needs an id like "canvas" (lowercase, dashes)',
      "editor board has unknown key extra (known: id, title, icon, files, webview, host)",
      "editor board needs a title",
      "editor board needs an icon: a Lucide icon name in kebab-case",
      'editor board: files must be file patterns like "*.canvas" (a name, or a project-relative path with no "..")',
      "editor board: webview has unknown key inline (known: script, style)",
      'editor board: webview.script must be a file inside the package, like "./dist/editor.js"',
      'editor board: webview.style must be a file inside the package, like "./dist/editor.css"',
      'editor board: host must be a module inside the package, like "./host/editor-host.ts#createEditorHost"',
      "duplicate editor board",
      'editor board: files must be file patterns like "*.canvas" (a name, or a project-relative path with no "..")',
      'editor board needs a webview: { "script": "./dist/editor.js", "style": "./dist/editor.css" }',
      'editor board: host must be a module inside the package, like "./host/editor-host.ts#createEditorHost"',
    ]);
    expect(validateContributes(manifest("ext-a", { editors: {} }))).toEqual(["contributes.editors must be an array"]);
    expect(validateContributes(manifest("ext-a", { panels: [] }))).toEqual(["contributes has unknown section panels"]);
  });

  it("matches files by name, or by project-relative path when the pattern has a slash", () => {
    expect(filePatternRegExp("*.{canvas,board}").test("a.board")).toBe(true);
    expect(filePatternRegExp("*.canvas").test("dir/a.canvas")).toBe(false);
    expect(filePatternRegExp("**/plans/*.canvas").test("plans/a.canvas")).toBe(true);
    expect(filePatternRegExp("**/plans/*.canvas").test("x/y/plans/a.canvas")).toBe(true);
    expect(filePatternRegExp("a?.canvas").test("ab.canvas")).toBe(true);
    expect(filePatternRegExp("a.canvas").test("aXcanvas")).toBe(false);
    expect(claims({ files: ["*.canvas"] }, "boards/deep/x.canvas")).toBe(true);
    expect(claims({ files: ["boards/*.canvas"] }, "boards/deep/x.canvas")).toBe(false);
    expect(claims({ files: ["boards/**/*.canvas"] }, "boards/deep/x.canvas")).toBe(true);
    expect(claims({ files: ["*.canvas"] }, "x.canvas.md")).toBe(false);
  });

  it("refuses an extension whose editors are malformed, and resolves the others' with their files", async () => {
    const dir = project("editors", {
      "ext-ok": { manifest: manifest("ext-ok", { editors: [board] }), files: ["dist/board.js", "host/board-host.mjs"] },
      "ext-bad": { manifest: manifest("ext-bad", { editors: [{ id: "x", title: "X", icon: "x", files: ["*.x"] }] }) },
    });
    const p = await loadProject(dir);
    expect(p.extensions.map((e) => e.manifest.id)).toEqual(["ext-ok"]);
    expect(p.diagnostics.find((d) => d.code === "PB_EXTENSION_MANIFEST_INVALID")?.message).toBe('ext-bad: editor x needs a webview: { "script": "./dist/editor.js", "style": "./dist/editor.css" }');
    // the quick path loads the same extensions without the model
    const quick = await loadProjectExtensions(dir);
    expect(quick.extensions.map((e) => e.manifest.id)).toEqual(["ext-ok"]);
    const { editors, diagnostics } = resolveEditors(quick.extensions);
    expect(diagnostics).toEqual([]);
    const root = join(dir, "node_modules", "ext-ok");
    expect(editors).toEqual([
      {
        ...board,
        extension: "ext-ok",
        package: "ext-ok",
        packageRoot: root,
        resolved: { script: join(root, "dist", "board.js"), style: join(root, "dist", "board.css"), host: { module: join(root, "host", "board-host.mjs"), export: "createHost" }, missing: [join(root, "dist", "board.css")] },
      },
    ]);
    expect(editorFor(editors, dir, join(dir, "plans", "a.board"))?.id).toBe("board");
    expect(editorFor(editors, dir, join(dir, "plans", "a.canvas"))).toBeUndefined();
    expect(editorFor(editors, join(dir, "src"), join(dir, "a.board"))).toBeUndefined();
  });

  it("opens a file claimed twice in the first extension's editor, and says so", async () => {
    const dir = project("shared", {
      "ext-a": { manifest: manifest("ext-a", { editors: [board] }) },
      "ext-b": { manifest: manifest("ext-b", { editors: [{ ...board, id: "other", host: undefined }] }) },
    });
    const { extensions } = await loadProjectExtensions(dir);
    const { editors, diagnostics } = resolveEditors(extensions);
    expect(editorFor(editors, dir, join(dir, "x.board"))?.extension).toBe("ext-a");
    expect(diagnostics.map((d) => [d.code, d.message])).toEqual([["PB_EXTENSION_EDITOR_SHARED", "ext-b: editor other claims *.board, which ext-a's editor board claims first; those files open in ext-a's"]]);
    // a host given without an export name runs the module's default export
    expect(resolveEditors([{ ...extensions[0], manifest: manifest("ext-a", { editors: [{ ...board, host: "./host.mjs" }] }) }]).editors[0].resolved.host?.export).toBe("default");
  });
});

describe("the editor protocol's helpers", () => {
  it("joins a relative path to a webview prefix, each segment encoded", () => {
    expect(webviewUri("https://file%2B.vscode-resource.vscode-cdn.net/c%3A/p/", "items/a b/#1.png")).toBe("https://file%2B.vscode-resource.vscode-cdn.net/c%3A/p/items/a%20b/%231.png");
    expect(() => webviewUri("https://x/p", "../secret")).toThrow(/leaves/);
  });

  it("tells envelopes from an editor's own messages, and names themes and services", () => {
    expect(isEnvelope({ protoboard: "call" })).toBe(true);
    expect(isEnvelope({ type: "ready" })).toBe(false);
    expect([1, 2, 3, 4].map(themeKind)).toEqual(["light", "dark", "high-contrast", "high-contrast-light"]);
    expect(EDITOR_SERVICES).toContain("document.applyEdit");
  });
});
