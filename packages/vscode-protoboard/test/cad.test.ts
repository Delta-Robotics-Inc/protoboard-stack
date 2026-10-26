/** The CAD viewer's files (PB-906): what opens in it and what it draws. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as cadFiles from "../src/cadFiles.js";
import { CAD_VIEWER, cadSource, cadViewerHtml, isCadFile } from "../src/cadFiles.js";

describe("CAD viewer", () => {
  it("opens STEP and GLB, nothing else", () => {
    expect(["a/body.step", "B.STP", "x.glb"].map(isCadFile)).toEqual([true, true, true]);
    expect(["a.pdf", "a.stl", "a.json", "step"].map(isCadFile)).toEqual([false, false, false, false]);
  });

  it("draws a STEP from the GLB exported with it when that is as new, else converts the STEP", () => {
    const files = new Map([["/p/out/body.step", 10], ["/p/out/body.glb", 12], ["/p/old/board.step", 200_000], ["/p/old/board.glb", 5]]);
    const exists = (f: string) => files.has(f);
    const mtime = (f: string) => files.get(f)!;
    expect(cadSource("/p/out/body.glb", exists, mtime)).toEqual({ kind: "glb", file: "/p/out/body.glb" });
    expect(cadSource("/p/out/body.step", exists, mtime)).toEqual({ kind: "glb", file: "/p/out/body.step", via: "/p/out/body.glb" });
    expect(cadSource("/p/old/board.step", exists, mtime)).toEqual({ kind: "step", file: "/p/old/board.step" });
    expect(cadSource("/p/vendor/part.stp", exists, mtime)).toEqual({ kind: "step", file: "/p/vendor/part.stp" });
  });

  it("serves a page that runs only its own scripts, WebAssembly included", () => {
    const html = cadViewerHtml({ script: "S", style: "C", occt: "O", wasm: "W", model: "M", source: { kind: "step", file: "/x.step" }, name: "x</script>.step", cspSource: "vscode-resource:", nonce: "n1" });
    expect(html).toContain("script-src 'nonce-n1' 'wasm-unsafe-eval'");
    // the viewer's stylesheet carries its faces inline
    expect(html).toContain("font-src vscode-resource: data:;");
    expect(html).not.toContain("x</script>.step");
    expect(html).toContain('"kind":"step"');
    expect(CAD_VIEWER).toBe("protoboard.cadViewer");
  });
});

describe("a CAD tab is local work (PB-928)", () => {
  it("has no sign-in screen: the module offers none, and the editor asks for no account", () => {
    expect(Object.keys(cadFiles)).not.toContain("cadLockedHtml");
    expect(Object.keys(cadFiles)).not.toContain("CAD_LOCK_ACTIONS");
    const editor = readFileSync(fileURLToPath(new URL("../src/cadEditor.ts", import.meta.url)), "utf8");
    expect(editor).not.toMatch(/lock\(\)|signIn|account\(/);
  });
});
