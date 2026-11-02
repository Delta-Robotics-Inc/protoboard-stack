/**
 * R2 integration (2026-11-02), R2-E's handoff to the views owner: the Settings page's Viewer section (the person's
 * Protoboard settings, core settings.ts): a switch for each on/off setting, a number box for the long-hover delay,
 * Choose… for the folders and the STEP app, Reset where a value is not the default. Rendered to markup with the
 * shells' React, as settings-more-actions.test.ts.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React, { createElement, type ReactElement } from "react";
import { ThemeProvider, staticTheme, vscodeTheme } from "@deltarobotics/uhd-viewer/components";
import { beforeAll, describe, expect, it } from "vitest";
import { SettingsPage } from "../src/parts/SettingsPage.js";
import type { SettingRowModel } from "../src/parts/model.js";

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

const ROWS: SettingRowModel[] = [
  { key: "viewer.openModelsInPlace", title: "Open models in place", description: "Same tab.", kind: "boolean", value: false, text: "Off", isDefault: false, icon: "square-arrow-out-up-right" },
  { key: "viewer.zoomToCursor", title: "Zoom toward the pointer", description: "Wheel zoom.", kind: "boolean", value: true, text: "On", isDefault: true },
  { key: "viewer.hoverLongDelayMs", title: "Long hover delay (ms)", description: "The bigger tooltip.", kind: "number", value: 1200, text: "1200 ms", isDefault: false, min: 200, max: 5000, unit: "ms" },
  { key: "tools.stepViewer", title: "STEP files open with", description: "The app.", kind: "app", value: "fusion360", text: "Fusion 360", isDefault: false },
  { key: "files.exportFolder", title: "Export folder", description: "Where exports go.", kind: "folder", value: null, text: "Downloads (~/Downloads)", isDefault: true },
];

const page = (viewer: SettingRowModel[] | undefined, actions: Record<string, unknown>) =>
  render(
    createElement(SettingsPage, {
      model: { account: { state: "signed-out" }, about: { version: "0.2.2" }, agents: { state: "ready", rows: [], notFound: [] }, ...(viewer ? { viewer } : {}) } as unknown as Props["model"],
      actions: { refresh() {}, run() {}, openVsCodeSettings() {}, ...actions } as unknown as Props["actions"],
    }),
  );
const section = (html: string) => /<section[^>]*aria-label="Viewer"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1];
const row = (html: string, key: string) => html.split('data-setting="').find((c) => c.startsWith(`${key}"`)) ?? "";

describe("the Settings page's Viewer section", () => {
  it("lists every setting with its control", () => {
    const html = section(page(ROWS, { setSetting() {}, chooseSetting() {} }))!;
    expect(html).toBeDefined();
    // a switch per on/off setting, its state said
    expect(html).toMatch(/role="switch" aria-checked="false" aria-label="Open models in place"/);
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Zoom toward the pointer"/);
    // the number box with its range and unit
    expect(html).toMatch(/<input[^>]*type="number"[^>]*aria-label="Long hover delay \(ms\)"[^>]*min="200"[^>]*max="5000"[^>]*value="1200"/);
    // the app and the folder: the value in words and Choose…
    expect(html).toContain("Fusion 360");
    expect(html).toContain("Downloads (~/Downloads)");
    expect((html.match(/Choose…/g) ?? []).length).toBe(2);
  });

  it("offers Reset only where a value is not the default (a switch is its own reset)", () => {
    const html = page(ROWS, { setSetting() {}, chooseSetting() {} });
    expect(row(html, "viewer.hoverLongDelayMs")).toContain("Reset Long hover delay (ms) to the default");
    expect(row(html, "tools.stepViewer")).toContain("Reset STEP files open with to the default");
    expect(row(html, "files.exportFolder")).not.toContain("Reset");
    expect(row(html, "viewer.openModelsInPlace")).not.toContain("Reset");
  });

  it("is left out when the host gives no rows or cannot set them", () => {
    expect(section(page(undefined, { setSetting() {}, chooseSetting() {} }))).toBeUndefined();
    expect(section(page(ROWS, {}))).toBeUndefined();
  });
});
