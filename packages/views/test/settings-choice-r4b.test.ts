/**
 * R4-B (2026-11-02): the Settings page's Viewer section shows the two choices R4-B added to core settings.ts
 * (`viewer.units` mm or in, `viewer.scaleReference` banana, cube or Benchy) as segmented radio groups. Rendered to
 * markup with the shells' React, as settings-viewer-section.test.ts.
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
  { key: "viewer.units", title: "Units", description: "Grid and cube.", kind: "choice", value: "in", text: "in", isDefault: false, options: [{ value: "mm", label: "mm" }, { value: "in", label: "in" }], icon: "ruler" },
  { key: "viewer.scaleReference", title: "For scale", description: "Beside the model.", kind: "choice", value: "banana", text: "Banana", isDefault: true, options: [{ value: "banana", label: "Banana" }, { value: "cube", label: "Cube" }, { value: "benchy", label: "Benchy" }], icon: "banana" },
];

const page = (actions: Record<string, unknown>) =>
  render(
    createElement(SettingsPage, {
      model: { account: { state: "signed-out" }, about: { version: "0.2.2" }, agents: { state: "ready", rows: [], notFound: [] }, viewer: ROWS } as unknown as Props["model"],
      actions: { refresh() {}, run() {}, openVsCodeSettings() {}, ...actions } as unknown as Props["actions"],
    }),
  );
const row = (html: string, key: string) => html.split('data-setting="').find((c) => c.startsWith(`${key}"`)) ?? "";

describe("the Settings page's Viewer section: choices (R4-B)", () => {
  it("shows each choice as a radio group with the value in force checked", () => {
    const html = page({ setSetting() {}, chooseSetting() {} });
    const units = row(html, "viewer.units");
    expect(units).toMatch(/role="radiogroup" aria-label="Units"/);
    expect(units).toMatch(/role="radio" aria-checked="false" data-value="mm"/);
    expect(units).toMatch(/role="radio" aria-checked="true" data-value="in"/);
    const scale = row(html, "viewer.scaleReference");
    expect((scale.match(/role="radio"/g) ?? []).length).toBe(3);
    expect(scale).toMatch(/aria-checked="true" data-value="banana"/);
    expect(scale).toContain(">Benchy<");
  });

  it("offers no Reset on a choice (the default is one of its buttons) and no Choose…", () => {
    const html = page({ setSetting() {}, chooseSetting() {} });
    expect(row(html, "viewer.units")).not.toContain("Reset");
    expect(row(html, "viewer.units")).not.toContain("Choose…");
  });
});
