/**
 * The settings page's More actions: "it's, like, more commands or, like,
 * more actions". The rows that do something here (Add to PATH) or open a
 * view of VS Code's are plain buttons; only a row that leaves VS Code (a web
 * page, the file manager) shows the external-link icon. Rendered to markup
 * with the shells' React, as faces.test.ts.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React, { createElement, type ReactElement } from "react";
import { ThemeProvider, staticTheme, vscodeTheme } from "@deltarobotics/uhd-viewer/components";
import { beforeAll, describe, expect, it } from "vitest";
import { SettingsPage } from "../src/parts/SettingsPage.js";

const require = createRequire(import.meta.url);
const shell = createRequire(new URL("../../web-viewer/package.json", import.meta.url));

/** One React for the render (as faces.test.ts: the linked viewer may carry a second copy). */
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

type Props = Parameters<typeof SettingsPage>[0];

describe("the settings page's More actions", () => {
  const links = [
    { id: "start", label: "First steps", note: "New project, viewer, sign-in, terminal", icon: "map", action: "Open", opens: "view" },
    { id: "stack", label: "Protoboard 0.2.2, installed for your user", note: "~/.protoboard/stack/0.2.2", icon: "package", action: "Show Folder", opens: "external" },
    { id: "path", label: "The protoboard command outside VS Code", note: "For terminals outside VS Code", icon: "terminal", action: "Add to PATH" },
  ];
  const page = () =>
    render(
      createElement(SettingsPage, {
        model: { account: { state: "signed-out" }, about: { version: "0.2.2" }, agents: { state: "ready", rows: [], notFound: [] }, links } as unknown as Props["model"],
        actions: { refresh() {}, run() {}, openVsCodeSettings() {}, openLibraries() {} } as unknown as Props["actions"],
      }),
    );
  /** The section's rows: each one's id (or its title) and whether its button carries an icon. */
  const rows = (html: string) => {
    const section = /<section[^>]*aria-label="More actions"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
    return [...section.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({ text: m[1].replace(/<[^>]+>/g, "").trim(), icon: /<svg/.test(m[1]) }));
  };

  it("is called More actions", () => {
    const html = page();
    expect(html).toContain(">More actions</h2>");
    expect(html).not.toContain("More settings");
  });

  it("marks only the button that leaves VS Code as an outbound link", () => {
    expect(rows(page())).toEqual([
      { text: "Open", icon: false }, // VS Code settings
      { text: "Open", icon: false }, // Libraries
      { text: "Open", icon: false }, // First steps
      { text: "Show Folder", icon: true },
      { text: "Add to PATH", icon: false },
    ]);
  });
});
