/**
 * The Inspector's selection and the DRC panel as the shells draw them
 * (PB-940, PB-901): the viewer's own details inside the card, every artifact
 * a card, pictures only from what the shell names, and the panel's lanes,
 * filters and row actions. Rendered to markup with the shells' React.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React, { createElement, type ReactElement } from "react";
import { ThemeProvider, keptInspectorState, vscodeTheme, staticTheme } from "@deltarobotics/uhd-viewer/components";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { isProtoboardColourTheme, vscodeViewThemeAdapter } from "../src/theme.js";
import { DrcPanel, SelectionInspector, type DrcPanelActions, type DrcPanelModel, type InspectorActions, type InspectorCard } from "../src/inspector/index.js";

const require = createRequire(import.meta.url);
const shell = createRequire(new URL("../../web-viewer/package.json", import.meta.url));
const bundle = JSON.parse(readFileSync(require.resolve("@deltarobotics/uhd-viewer/package.json").replace(/package\.json$/, "fixtures/imu-pod/uhd-bundle.json"), "utf8"));

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

const posted: unknown[][] = [];
const actions: InspectorActions = {
  action: (a) => posted.push(["action", a]),
  focus: (p) => posted.push(["focus", p]),
  select: (s) => posted.push(["select", s]),
  finding: (k) => posted.push(["finding", k]),
  explain: (k) => posted.push(["explain", k]),
  openArtifact: (d, a) => posted.push(["openArtifact", d, a]),
  openLink: (u) => posted.push(["openLink", u]),
};

const card = (over: Partial<InspectorCard> = {}): InspectorCard => ({
  kind: "module",
  icon: "archive",
  title: "Enclosure",
  subtitle: "enclosure · sample-imu-enclosure",
  kindLabel: "Enclosure",
  summary: { price: "$12.40", children: 2 },
  chips: [{ text: "Unverified", status: "unverified", title: "Unverified. In a library, but not verified." }, { text: "stale outputs", tone: "warning" }],
  counts: { error: 1, warning: 2, info: 0 },
  sections: [
    { title: "Checks", count: 1, rows: [{ icon: "circle-x", label: "The lid does not close", tone: "error", code: "CAD_INTERFERENCE", action: { type: "finding", key: "3" } }] },
    { title: "Children", count: 2, collapsed: true, summary: "Back shell · Lid", rows: [{ icon: "package", label: "Back shell", action: { type: "focus", path: "enclosure/back" } }] },
    { title: "Sourcing", collapsed: true, summary: "JLC · $12.40", rows: [{ icon: "receipt", label: "Enclosure print", detail: "$12.40 · JLC" }] },
  ],
  actions: { focus: true, source: true, artifacts: false, operation: true },
  path: "enclosure",
  details: {
    target: { kind: "module", path: "enclosure" },
    files: {},
    previews: { "sample-imu-enclosure#enclosure_glb": { kind: "image", src: "https://file+.vscode-resource.test/p/docs/images/part-sample-imu-enclosure.png" } },
    links: [],
  },
  ...over,
});
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("the Inspector's selection", () => {
  it("shows a module the way the viewer's inspector does, inside the shell's card", () => {
    const html = render(createElement(SelectionInspector, { content: { card: card(), project: "pod" }, bundle, actions }));
    // design A's header (PB-1042): the name, what it is and which part, the status at the right, the summary row
    expect(html).toContain(">Enclosure</h1>");
    expect(html).toContain("Enclosure · enclosure · sample-imu-enclosure");
    expect(html).toMatch(/data-status-chip=""[^>]*>.*data-status="unverified"/s);
    expect(html).toContain("Findings here and below: 1 blocking, 2 warnings, 0 info");
    expect(html).toContain('data-summary="price">$12.40');
    expect(html).toContain('data-summary="children">2 children');
    for (const label of ["Focus in the viewer", "Open source", "Run operation…"]) expect(html).toContain(`data-tooltip="${label}"`);
    // one column of sections, one keyboard list: the viewer's (Parameters, Interfaces, Artifacts) and the shell's
    expect(count(html, /data-nav-root=""/g)).toBe(1);
    expect(html).toContain("uhd-selection-details");
    const order = [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
    expect(order.slice(0, 3)).toEqual(["parameters", "interfaces", "artifacts"]);
    expect(order.slice(-3)).toEqual(["host:Checks", "host:Children", "host:Sourcing"]);
    expect(html).toContain(">Definition<");
    expect(html).toContain("sample-imu-enclosure");
    // every artifact is a card; none is a plain row
    expect(count(html, /class="uhd-artifact-card /g)).toBe(4);
    expect(html).not.toContain("artifact-file");
    // the model shows the picture the shell named, and nothing else is loaded: no model, no remote picture
    expect(count(html, /<img /g)).toBe(1);
    expect(html).toContain('src="https://file+.vscode-resource.test/p/docs/images/part-sample-imu-enclosure.png"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("artifact-cad");
    // a finding leads to it, says its code, and can be explained
    expect(html).toContain('data-row-finding="CAD_INTERFERENCE"');
    expect(html).toContain('data-tooltip="Explain CAD_INTERFERENCE"');
    // secondary sections start closed and say what they hold in their headers
    const section = (id: string) => html.slice(html.indexOf(`data-section="${id}"`)).split("</section>")[0];
    expect(section("host:Checks")).toContain('aria-expanded="true"');
    expect(section("host:Children")).toContain('aria-expanded="false"');
    expect(section("host:Children")).toContain("Back shell · Lid");
    expect(section("host:Children")).not.toContain("enclosure/back");
    expect(section("host:Sourcing")).toContain("JLC · $12.40");
  });

  it("draws a file only when the shell names it", () => {
    const with_ = card({ details: { target: { kind: "module", path: "board" }, files: { "sample-imu-board\nboard/out/schematic.svg": "https://file+.vscode-resource.test/p/board/out/schematic.svg" }, previews: {}, links: [] } });
    const html = render(createElement(SelectionInspector, { content: { card: with_, project: "pod" }, bundle, actions }));
    expect(count(html, /class="uhd-artifact-card /g)).toBe(8);
    // the schematic was named; the PCB drawings and the board's model were not: they show their icons
    expect(count(html, /<img /g)).toBe(1);
    expect(html).toContain("board/out/schematic.svg");
    expect(count(html, /data-artifact-picture="icon"/g)).toBe(7);
  });

  it("shows a link with its pair, a library part from its definition, and says why when there is nothing", () => {
    const link = card({ kind: "link", icon: "link", title: "Board on its bosses", actions: { focus: true, source: true, artifacts: false, operation: false, pair: true }, path: "", linkId: "board_mount", details: { target: { kind: "link", owner: "", ids: ["board_mount"] }, files: {}, previews: {} } });
    const linkHtml = render(createElement(SelectionInspector, { content: { card: link, project: "pod" }, bundle, actions }));
    expect(linkHtml).toContain('data-tooltip="Open the pair view in a tab"');
    expect(linkHtml).toContain("pair-preview");
    const definition = { id: "lib-imu", name: "IMU", kind: "module", interfaces: [], artifacts: [{ id: "ds", name: "Datasheet", type: "datasheet", url: "https://example.com/imu.pdf" }, { id: "glb", name: "Body", type: "3d_model", role: "body", format: "glb", filePath: "cad/imu.glb" }] };
    const part = card({
      kind: "part",
      icon: "package",
      title: "IMU",
      counts: { error: 0, warning: 0, info: 0 },
      sections: [],
      actions: { focus: false, source: false, artifacts: false, operation: false, detail: true },
      path: "",
      part: { partId: "lib-imu", library: "protoboard" },
      details: { target: { kind: "definition", id: "lib-imu" }, files: {}, previews: { "lib-imu#glb": { kind: "model", src: "https://file+.vscode-resource.test/cache/imu.glb" } }, definitions: [definition], picture: "https://file+.vscode-resource.test/cache/imu.png", links: ["https://example.com/imu.pdf"] },
    });
    // no project bundle: the library's definition is enough
    const partHtml = render(createElement(SelectionInspector, { content: { card: part, project: "pod" }, actions }));
    expect(partHtml).toContain('data-tooltip="Open the part&#x27;s page"');
    expect(partHtml).toContain('src="https://file+.vscode-resource.test/cache/imu.png"');
    expect(partHtml).toContain('data-artifact-kind="datasheet"');
    expect(partHtml).toContain("example.com");
    // the model is drawn by the shell when its card comes into view, not loaded with the page
    expect(partHtml).not.toContain("cache/imu.glb");
    const empty = render(createElement(SelectionInspector, { content: { empty: "Select a module or a link in the viewer." }, actions }));
    expect(empty).toContain("Select a module or a link in the viewer.");
    expect(empty).toContain(">Nothing selected</h1>");
    expect(empty).toContain("data-inspector-empty");
  });

  it("modules selected together: their count, their names, the list and their checks", () => {
    const group = card({ kind: "level", kindLabel: "Selection", icon: "boxes", title: "2 selected", subtitle: "Frame, Top plate", chips: [], summary: undefined, details: undefined, sections: [{ title: "Selected", count: 2, rows: [{ icon: "layers", label: "Frame", action: { type: "focus", path: "frame" } }, { icon: "layers", label: "Top plate", action: { type: "focus", path: "top_plate" } }] }] });
    const html = render(createElement(SelectionInspector, { content: { card: group, project: "pod" }, actions }));
    expect(html).toContain(">2 selected</h1>");
    expect(html).toContain("Selection · Frame, Top plate");
    expect(html).toContain('data-section="host:Selected"');
    expect(html).not.toContain("uhd-selection-details");
  });

  it("uses the deeper severity shades the parts views use on a light page", () => {
    const html = render(createElement(SelectionInspector, { content: { card: card(), project: "pod" }, bundle, actions }));
    expect(html).toContain("--uhd-severity-warning:#a16207");
    expect(html).toContain("--uhd-severity-info:#0369a1");
  });
});

/** An example project's build, when it has been built (CI builds every example before the tests). */
const example = (name: string) => {
  const file = new URL(`../../../examples/${name}/.protoboard/build/uhd-bundle.json`, import.meta.url);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
};
const quad = example("quadcopter-5in");
const bottle = example("smart-bottle");

describe("interface cards in the Inspector (PB-1042, design A with expandable cards)", () => {
  const moduleCard = (path: string, title: string, over: Partial<InspectorCard> = {}): InspectorCard => card({ title, kindLabel: "Module", subtitle: undefined, sections: [], path, details: { target: { kind: "module", path }, files: {}, previews: {}, links: [] }, ...over });
  afterEach(() => keptInspectorState.clear());

  it.skipIf(!quad)("the quadcopter's FC + ESC stack: the receiver pads, linked to the receiver through its wires, closed", () => {
    const html = render(createElement(SelectionInspector, { content: { card: moduleCard("stack", "FC + ESC stack"), project: "quadcopter-5in" }, bundle: quad, actions }));
    const pads = html.slice(html.indexOf('data-slot="rx_fc_pads"')).split('data-slot="')[1];
    expect(pads).toContain('aria-expanded="false"');
    for (const pin of ["RX2", "TX2", "5V", "GND"]) expect(pads).toContain(`>${pin}<`);
    expect(pads).toContain("ELRS receiver");
    expect(pads).toContain("via Receiver wires");
    expect(pads).not.toContain("data-card-detail");
    // "11 linked · 1 open": USB-C is the open slot, with Connect…
    expect(html).toContain("11 linked · 1 open");
    const usb = html.slice(html.indexOf('data-slot="usb"')).split('data-slot="')[1];
    expect(usb).toContain("Open slot");
  });

  it.skipIf(!quad)("expanded: the receiver pads' pin mapping (RX2 ← TX), their links and the 5 V finding; the battery pads' warning", () => {
    keptInspectorState.setExpanded(JSON.stringify({ kind: "module", path: "stack" }), new Set(["rx_fc_pads", "battery_pads"]));
    const findings = [
      { key: "7", code: "UHD_PROPULSION_CURRENT", message: "4 motors can peak at 171.88 A together", severity: "warning" as const, refs: ["battery_pads+battery_plug~battery_out~bat_in"] },
      { key: "9", code: "UHD_SUPPLY_BUDGET", message: "5 V BEC: 2% used", severity: "info" as const, refs: ["rx_fc_pads+rx_pads~vcc_5v~bec_5v"] },
    ];
    const c = moduleCard("stack", "FC + ESC stack", { details: { target: { kind: "module", path: "stack" }, files: {}, previews: {}, links: [], findings } });
    const html = render(createElement(SelectionInspector, { content: { card: c, project: "quadcopter-5in" }, bundle: quad, actions: { ...actions, interfaceSource: () => undefined, connect: () => undefined } }));
    const slot = (id: string) => html.slice(html.indexOf(`data-slot="${id}"`)).split('data-slot="')[1];
    const pads = slot("rx_fc_pads");
    expect(pads).toContain('aria-expanded="true"');
    expect(pads).toMatch(/data-pin="RX2".*uart2_rx.*←.*>TX<.*ELRS receiver/s);
    expect(pads).toMatch(/data-pin="TX2".*uart2_tx.*→.*>RX</s);
    expect(pads).toMatch(/data-pin="GND".*—/s);
    expect(pads).toContain('data-link="rx_pads"');
    expect(pads).toContain(">rx_fc_pads<");
    expect(pads).toContain("configured");
    expect(pads).toContain("compatible");
    expect(pads).toContain("UHD_SUPPLY_BUDGET");
    expect(pads).toContain("5V voltage");
    for (const action of ["Locate on canvas", "Open in source"]) expect(pads).toContain(action);
    // the power interface: its pins, the cell range it takes, its warning with its code and Locate
    const battery = slot("battery_pads");
    expect(battery).toContain('aria-expanded="true"');
    expect(battery).toMatch(/data-pin="BAT\+".*bat_in.*←.*6S battery/s);
    expect(battery).toContain("6–30 V");
    expect(battery).toContain("UHD_PROPULSION_CURRENT");
    expect(battery).toContain("Locate");
    // two cards open at once
    expect(count(html, /data-card-detail=""/g)).toBe(2);
  });

  it.skipIf(!bottle)("the smart bottle's board: its pad groups linked to the cell and the probe, and its open slots", () => {
    const html = render(createElement(SelectionInspector, { content: { card: moduleCard("board", "Cap board"), project: "smart-bottle" }, bundle: bottle, actions }));
    expect(html).toContain('data-section="interfaces"');
    const bat = html.slice(html.indexOf('data-slot="bat_pads"')).split('data-slot="')[1];
    expect(bat).toContain('data-kind="power"');
    expect(bat).toContain("LiPo cell");
    expect(html).toContain('data-slot="probe_pads"');
    expect(html).toMatch(/\d+ linked · \d+ open/);
    keptInspectorState.setExpanded(JSON.stringify({ kind: "module", path: "board" }), new Set(["probe_pads"]));
    const open = render(createElement(SelectionInspector, { content: { card: moduleCard("board", "Cap board"), project: "smart-bottle" }, bundle: bottle, actions }));
    const probe = open.slice(open.indexOf('data-slot="probe_pads"')).split('data-slot="')[1];
    expect(probe).toMatch(/data-pin="2".*pad_dq.*DQ.*Temperature probe/s);
    expect(probe).toContain("Usage note");
  });
});

describe("a native view's theme", () => {
  const doc = (id: string, cls = "vscode-dark") => ({ body: { className: cls, classList: { contains: (c: string) => cls.split(" ").includes(c) }, dataset: { vscodeThemeId: id } } }) as unknown as Document;

  it("has VS Code's own faces, and Kode Mono (bold for labels) only under a Protoboard colour theme, as the viewer tab has", () => {
    const plain = vscodeViewThemeAdapter(doc("Default Dark Modern")).current();
    expect(plain.tokens.fontUi).toBe("var(--vscode-font-family)");
    expect(plain.tokens.fontLabel).toBe("var(--vscode-font-family)");
    const own = vscodeViewThemeAdapter(doc("Protoboard Dark")).current();
    expect(own.tokens.fontUi).toContain("Kode Mono");
    expect(own.tokens.fontLabel).toMatch(/^"Kode Mono Bold", "Kode Mono"/);
    // the colours are VS Code's either way, high contrast included
    expect(own.tokens.surface).toBe(plain.tokens.surface);
    expect(vscodeViewThemeAdapter(doc("Default High Contrast Light", "vscode-high-contrast vscode-high-contrast-light")).current().scheme).toBe("high-contrast-light");
    expect(isProtoboardColourTheme(doc("Protoboard Light", "vscode-light"))).toBe(true);
    expect(isProtoboardColourTheme(doc("Default Light Modern", "vscode-light"))).toBe(false);
  });
});

describe("the DRC panel", () => {
  const row = (key: string, code: string, summary: string) => ({ key, code, summary, message: `${summary}; because <b>x</b>`, reasons: ["because <b>x</b>"], module: "Main board", means: "A `link` is **incompatible**.", todo: "Relink.", validator: "uhd/checkSystem", sourceKind: "UHD", sourceLabel: "src/a.ts:4", hasSource: true });
  const model: DrcPanelModel = {
    state: "idle",
    project: "watch",
    at: "12:00:00",
    query: { groupBy: "module", text: "", severity: "all", info: false },
    model: {
      counts: { error: 1, warning: 2, info: 5 },
      configured: { links: 3, linksTotal: 4, checksRan: 2, checksSkipped: 1 },
      lanes: [
        { id: "blocking", title: "Blocking", total: 1, shown: 1, groups: [{ key: "m:board", label: "Main board", items: [row("0", "UHD_LINK_STATE", "gpio1 drives 3.3 V into a 2.0 V LED")] }] },
        { id: "warnings", title: "Warnings", total: 2, shown: 2, groups: [{ key: "m:a", label: "A", items: [row("1", "HW_NO_SOURCES", "no sources")] }, { key: "m:b", label: "B", items: [row("2", "ENCLOSURE_STALE", "stale")] }] },
      ],
    },
  };
  const none: DrcPanelActions = { query: () => undefined, locate: () => undefined, openSource: () => undefined, explain: () => undefined, refresh: () => undefined };

  it("has lanes by severity, themed filters and icon actions with tooltips, no native select (PB-901)", () => {
    const html = render(createElement(DrcPanel, { model, actions: none }));
    expect(html).toContain('data-lane="blocking"');
    expect(html).toContain('data-lane="warnings"');
    expect(html).not.toContain("<select");
    for (const label of ["Blocking and warnings", "Blocking only", "Warnings only", "Group by module", "Group by rule", "Group by source", "Show information findings (5)", "Check again (protoboard build)"]) expect(html).toContain(`data-tooltip="${label}"`);
    // the row actions: the same as the hierarchy's and the Inspector's, each with a tooltip
    for (const label of ["Locate in the viewer", "Open source · src/a.ts:4", "Explain UHD_LINK_STATE"]) expect(html).toContain(`data-tooltip="${label}"`);
    expect(html).toContain("configured: 3/4 links, 2 checks ran, 1 skipped");
    expect(html).toContain("watch · checked 12:00:00");
  });

  it("draws finding text as text: nothing from a build is parsed as markup", () => {
    const open = render(createElement(DrcPanel, { model, actions: { ...none, saved: { expanded: ["UHD_LINK_STATE|gpio1 drives 3.3 V into a 2.0 V LED; because <b>x</b>"] } } }));
    expect(open).toContain("because &lt;b&gt;x&lt;/b&gt;");
    expect(open).not.toContain("because <b>x</b>");
    // the references' `code` and **bold** are the only markup read
    expect(open).toContain("<code");
    expect(open).toContain("<b>incompatible</b>");
    expect(open).toContain("What to do: ");
  });

  it("says what to do without a project or a build", () => {
    expect(render(createElement(DrcPanel, { model: undefined, actions: none }))).toContain("Open a folder with a protoboard.config.ts");
    expect(render(createElement(DrcPanel, { model: { ...model, model: undefined, state: "running" }, actions: none }))).toContain("Checking the project…");
  });
});
