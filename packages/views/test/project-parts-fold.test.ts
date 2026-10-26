/**
 * The project's parts in groups that fold away (PB-1039, as in the alpha):
 * the side bar and the Project Parts page, each with a heading per group
 * that folds it and a control that folds them all, starting from the groups
 * the host kept folded. Rendered to markup with the shells' React.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React, { createElement, type ReactElement } from "react";
import { ThemeProvider, vscodeTheme, staticTheme } from "@deltarobotics/uhd-viewer/components";
import { beforeAll, describe, expect, it } from "vitest";
import { ProjectParts, ProjectPartsPage, type ProjectPartModel, type ProjectPartsActions, type ProjectPartsModel } from "../src/parts/index.js";

const require = createRequire(import.meta.url);
const shell = createRequire(new URL("../../web-viewer/package.json", import.meta.url));

/**
 * One React for the render. In a checkout where the viewer is a linked
 * sibling repository with packages of its own, its components (and the Radix
 * and Lucide it loads) have a second copy of React of the same version, and a
 * hook called through it finds no renderer. The two copies are made to share
 * the renderer's state; where there is one copy (an installed stack) this
 * does nothing.
 */
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
  // react-dom of the shells (the root's is another major, for the circuit tools)
  const server = (await import(pathToFileURL(shell.resolve("react-dom/server")).href)) as { renderToStaticMarkup(el: ReactElement): string };
  render = (el) => server.renderToStaticMarkup(createElement(ThemeProvider, { adapter: staticTheme(vscodeTheme("light")) }, el));
});


const part = (id: string, tier: ProjectPartModel["tier"], status: ProjectPartModel["status"]): ProjectPartModel => ({ id, name: `Part ${id}`, tier, status, file: `parts/${id}.uhd.ts`, instances: 1, ...(tier === "catalog" ? { library: "protoboard", revision: 2 } : {}) });
const MODEL: ProjectPartsModel = {
  parts: [part("motor", "catalog", "up-to-date"), part("esc", "catalog", "update-available"), part("standoff", "project-researched", "local"), part("frame", "project-specific", "designed")],
  counts: { total: 4, library: 2, researched: 1, designed: 1, updates: 1, diverged: 0 },
};
const actions: ProjectPartsActions = { open: () => undefined };

/** The `aria-expanded` of each group heading, in order. */
const expanded = (html: string) => [...html.matchAll(/<button[^>]*aria-expanded="(true|false)"/g)].map((m) => m[1]);

describe("the project parts' groups fold away", () => {
  it("the side bar: every group opens with a heading that folds it, and one control folds them all", () => {
    const html = render(createElement(ProjectParts, { model: MODEL, actions }));
    expect(expanded(html)).toEqual(["true", "true", "true", "true"]);
    expect(html).toContain('aria-label="Collapse all groups"');
    for (const id of ["motor", "esc", "standoff", "frame"]) expect(html).toContain(`Part ${id}`);
  });

  it("the side bar keeps the groups the host kept folded: their parts are not drawn", () => {
    const html = render(createElement(ProjectParts, { model: MODEL, actions, folded: { closed: ["researched", "updates"] } }));
    expect(expanded(html)).toEqual(["false", "true", "false", "true"]);
    expect(html).not.toContain("Part standoff");
    expect(html).not.toContain("Part esc");
    expect(html).toContain("Part motor");
  });

  it("all folded: the control expands them all", () => {
    const html = render(createElement(ProjectParts, { model: MODEL, actions, folded: { closed: ["updates", "library:protoboard", "researched", "designed"] } }));
    expect(expanded(html)).toEqual(["false", "false", "false", "false"]);
    expect(html).toContain('aria-label="Expand all groups"');
  });

  it("the Project Parts page: its sections fold the same way, cards and hint hidden", () => {
    const open = render(createElement(ProjectPartsPage, { model: MODEL, actions }));
    expect(expanded(open)).toEqual(["true", "true", "true"]);
    expect(open).toContain("Collapse all groups");
    const folded = render(createElement(ProjectPartsPage, { model: MODEL, actions, folded: { closed: ["library"] } }));
    expect(expanded(folded)).toEqual(["false", "true", "true"]);
    expect(folded).not.toContain("Vendored from a library and pinned to a revision");
    expect(folded).toContain("Written in parts/local from datasheets");
  });
});
