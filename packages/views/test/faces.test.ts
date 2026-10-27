/**
 * The faces across the extension (PB-1070). Mark: "the theme font should be
 * applied across the app, but also in other themes at least the protoboard
 * title text should be the KodeMono theme, as that is the app branding".
 * Every webview takes one adapter (vscodeViewThemeAdapter): Kode Mono under
 * a Protoboard colour theme, VS Code's faces under any other; the brand face
 * (bold Kode Mono, `font-brand`) under every theme for the titles that are
 * the product's name. Rendered to markup with the shells' React.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React, { createElement, type ReactElement } from "react";
import { ThemeProvider, staticTheme, vscodeTheme } from "@deltarobotics/uhd-viewer/components";
import { beforeAll, describe, expect, it } from "vitest";
import { SettingsPage } from "../src/parts/SettingsPage.js";
import { FONT_BRAND, themeAdapterFor, vscodeThemeAdapter, vscodeViewThemeAdapter } from "../src/theme.js";

const require = createRequire(import.meta.url);
const shell = createRequire(new URL("../../web-viewer/package.json", import.meta.url));

/** One React for the render (as project-parts-fold.test.ts: the linked viewer may carry a second copy). */
function shareReact() {
  const KEY = "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE";
  const mine = (React as unknown as Record<string, Record<string, unknown>>)[KEY];
  let theirs: Record<string, unknown> | undefined;
  try {
    theirs = createRequire(require.resolve("@deltarobotics/uhd-viewer/package.json"))("react")[KEY];
  } catch {
    return;
  }
  if (!mine || !theirs || theirs === mine) return;
  for (const key of Object.keys(mine)) Object.defineProperty(theirs, key, { configurable: true, get: () => mine[key], set: (v) => void (mine[key] = v) });
}

let render: (el: ReactElement) => string;
beforeAll(async () => {
  shareReact();
  const server = (await import(pathToFileURL(shell.resolve("react-dom/server")).href)) as { renderToStaticMarkup(el: ReactElement): string };
  render = (el) => server.renderToStaticMarkup(createElement(ThemeProvider, { adapter: staticTheme(vscodeTheme("dark")) }, el));
});

describe("the faces across the extension", () => {
  const doc = (id: string, cls = "vscode-dark") => ({ body: { className: cls, classList: { contains: (c: string) => cls.split(" ").includes(c) }, dataset: { vscodeThemeId: id } } }) as unknown as Document;

  it("is Kode Mono, bold for labels, under Protoboard Dark and Light, and VS Code's own faces under any other theme", () => {
    for (const [id, cls] of [["Protoboard Dark", "vscode-dark"], ["Protoboard Light", "vscode-light"]]) {
      const t = vscodeViewThemeAdapter(doc(id, cls)).current().tokens;
      expect(t.fontUi).toMatch(/^"Kode Mono", var\(--vscode-font-family/);
      expect(t.fontLabel).toBe(FONT_BRAND);
      expect(t.fontMono).toMatch(/^var\(--vscode-editor-font-family/);
    }
    for (const [id, cls] of [["Default Dark Modern", "vscode-dark"], ["Default Light Modern", "vscode-light"], ["Default High Contrast", "vscode-high-contrast"]]) {
      const t = vscodeViewThemeAdapter(doc(id, cls)).current().tokens;
      expect(t.fontUi).toMatch(/^var\(--vscode-font-family/);
      expect(t.fontLabel).toMatch(/^var\(--vscode-font-family/);
      expect(`${t.fontUi}${t.fontLabel}${t.fontMono}`).not.toContain("Kode Mono");
    }
  });

  it("re-reads the faces when the colour theme changes", () => {
    const body = { className: "vscode-dark", classList: { contains: () => false }, dataset: { vscodeThemeId: "Default Dark Modern" } };
    const adapter = vscodeViewThemeAdapter({ body } as unknown as Document);
    expect(adapter.current().tokens.fontUi).not.toContain("Kode Mono");
    body.dataset.vscodeThemeId = "Protoboard Dark";
    expect(adapter.current().tokens.fontUi).toContain("Kode Mono");
  });

  it("keeps faint text as the theme has it outside the native views", () => {
    const d = doc("Default Light Modern", "vscode-light");
    expect(vscodeViewThemeAdapter(d).current().tokens.textFaint).toMatch(/^color-mix/);
    expect(vscodeViewThemeAdapter(d, { viewFaint: false }).current().tokens.textFaint).toBe(vscodeThemeAdapter(d).current().tokens.textFaint);
  });

  it("gives the vscode choice (every page but the Inspector and the DRC panel) the same faces", () => {
    const g = globalThis as { document?: unknown };
    const before = g.document;
    try {
      g.document = doc("Default Dark Modern");
      expect(themeAdapterFor("vscode").current().tokens.fontUi).toMatch(/^var\(--vscode-font-family/);
      g.document = doc("Protoboard Dark");
      expect(themeAdapterFor("vscode").current().tokens.fontLabel).toBe(FONT_BRAND);
    } finally {
      g.document = before;
    }
  });

  it("has one brand face, bold Kode Mono under every theme, declared for Tailwind as font-brand", () => {
    expect(FONT_BRAND).toMatch(/^"Kode Mono Bold", "Kode Mono", var\(--vscode-font-family/);
    const css = readFileSync(new URL("../src/brand.css", import.meta.url), "utf8");
    expect(css).toContain(`--font-brand: ${FONT_BRAND};`);
  });

  it("puts the Protoboard settings title and the Protoboard section in the brand face, and nothing else on the page", () => {
    const model = { account: { state: "signed-out" }, about: { version: "0.2.2" }, agents: { state: "ready", rows: [], notFound: [] } } as unknown as Parameters<typeof SettingsPage>[0]["model"];
    const html = render(createElement(SettingsPage, { model, actions: { refresh() {} } as unknown as Parameters<typeof SettingsPage>[0]["actions"] }));
    const brand = [...html.matchAll(/<(h[12])[^>]*class="[^"]*\bfont-brand\b[^"]*"[^>]*>([^<]*)</g)].map((m) => m[2]);
    expect(brand).toEqual(["Protoboard settings", "Protoboard"]);
    expect(html.match(/font-brand/g)).toHaveLength(2);
  });
});
