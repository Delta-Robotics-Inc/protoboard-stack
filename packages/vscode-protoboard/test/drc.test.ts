/**
 * The DRC view's model: lanes, grouping by module, rule and source, text and
 * severity filters, information behind a toggle, configured items counted;
 * one-line messages; and the "what to do" from the extensions' code tables,
 * including the ones installed in this repository.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { installedPackages, loadCodeReference, lookupCode, parseCodeTables } from "../src/codes.js";
import { DEFAULT_QUERY, drcModel, findingSource, findings, pageModel, parseQuery, splitMessage, unfetchedPart, unfetchedParts, explainMarkdown, type DrcQuery } from "../src/drc.js";
import { appCsp, appHtml } from "../src/appPage.js";
import { indexProject } from "../src/model.js";
import { bundle, resolved } from "./fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

const TABLE = `# Codes

Some text | not a table.

| Code | Severity | Means | Do |
| --- | --- | --- | --- |
| \`UHD_LINK_STATE\` | error / warning | Link DRC: incompatible. | Relink; never widen a range. |
| \`PB_CATALOG_PARSE\`, \`PB_CATALOG_FILE_MISSING\` | error | Broken or missing catalog file. | Re-download. |
| \`PB_EXTENSION_*\` | error | An extension is not installed. | \`npm install\` it. |

| Code | Severity | Finding |
| --- | --- | --- |
| \`CIRCUIT_NET_OPEN\`, \`_SHORT\`, \`_EXTRA\` | error | the copper's nets differ |

| Name | Code |
| --- | --- |
| \`NOT_A_CODE\` | x |
`;

describe("code references", () => {
  it("reads code tables: several codes per row, `_SUFFIX` shorthand, prefixes, and the column names in use", () => {
    const e = parseCodeTables(TABLE, "/ext/README.md");
    expect(e.map((x) => x.code)).toEqual(["UHD_LINK_STATE", "PB_CATALOG_PARSE", "PB_CATALOG_FILE_MISSING", "PB_EXTENSION_", "CIRCUIT_NET_OPEN", "CIRCUIT_NET_SHORT", "CIRCUIT_NET_EXTRA"]);
    expect(e[0]).toEqual({ code: "UHD_LINK_STATE", prefix: false, severity: "error / warning", means: "Link DRC: incompatible.", todo: "Relink; never widen a range.", file: "/ext/README.md", line: 7 });
    expect(e[3]).toMatchObject({ prefix: true, todo: "`npm install` it." });
    expect(e[5]).toMatchObject({ means: "the copper's nets differ", todo: undefined, line: 13 });
  });

  it("looks a code up exactly, else by the longest prefix", () => {
    const ref = { exact: new Map(parseCodeTables(TABLE, "f").filter((x) => !x.prefix).map((x) => [x.code, x])), prefixes: parseCodeTables(TABLE, "f").filter((x) => x.prefix), files: ["f"] };
    expect(lookupCode(ref, "PB_CATALOG_PARSE")?.means).toBe("Broken or missing catalog file.");
    expect(lookupCode(ref, "PB_EXTENSION_NOT_INSTALLED")?.code).toBe("PB_EXTENSION_");
    expect(lookupCode(ref, "SOMETHING_ELSE")).toBeUndefined();
    expect(lookupCode(undefined, "UHD_LINK_STATE")).toBeUndefined();
  });

  it("finds the installed extensions' references from a project", () => {
    const root = join(REPO, "examples", "quadcopter-5in");
    expect(installedPackages(root).map((p) => p.split("/").pop())).toContain("ext-hardware");
    const ref = loadCodeReference(root);
    expect(ref.files.some((f) => f.endsWith(join("system-compose", "references", "diagnostic-codes.md")))).toBe(true);
    expect(lookupCode(ref, "UHD_PROPULSION_CURRENT")?.todo).toMatch(/redesign/);
    expect(lookupCode(ref, "FRAME_CAD_STALE")?.todo).toMatch(/Regenerate/);
    expect(lookupCode(ref, "ENCLOSURE_STALE")?.means).toMatch(/changed since generation/);
    expect(lookupCode(ref, "CIRCUIT_NET_SHORT")).toBeDefined();
    // the reference names each PB_EXTENSION_ code (prefix rows are covered by the table above)
    expect(lookupCode(ref, "PB_EXTENSION_NOT_INSTALLED")).toMatchObject({ prefix: false, severity: "error" });
  });
});

describe("findings", () => {
  it("are one line, with the rest as reasons", () => {
    expect(splitMessage("gpio1 drives 3.3 V into a 2.0 V LED; add a resistor; or lower the drive")).toEqual({ summary: "gpio1 drives 3.3 V into a 2.0 V LED", reasons: ["add a resistor", "or lower the drive"] });
    expect(splitMessage("Known loads need 10 W of 25 W. The budget is a lower bound.")).toEqual({ summary: "Known loads need 10 W of 25 W", reasons: ["The budget is a lower bound."] });
    expect(splitMessage("short; one")).toEqual({ summary: "short; one", reasons: [] });
    expect(splitMessage("4 motors can peak at 171.88 A together")).toEqual({ summary: "4 motors can peak at 171.88 A together", reasons: [] });
    // clauses inside brackets stay whole
    expect(splitMessage("m9n artifact cad_step: not found (not distributed (vendor file; redistribution not cleared)); fine offline")).toEqual({
      summary: "m9n artifact cad_step: not found (not distributed (vendor file; redistribution not cleared))",
      reasons: ["fine offline"],
    });
  });

  it("name their source: UHD, an extension's check, a provider's capability check, the framework", () => {
    expect(findingSource("uhd/checkSystem")).toBe("uhd");
    expect(findingSource("ext:@protoboardai/ext-hardware/evidence")).toBe("extension");
    expect(findingSource("ext:@protoboardai/ext-harness-cad/cad:check")).toBe("provider");
    expect(findingSource("protoboard/artifacts")).toBe("protoboard");
  });
});

describe("DRC model", () => {
  const index = indexProject(resolved, bundle);
  const ref = { exact: new Map(parseCodeTables(TABLE, "/ref.md").map((x) => [x.code, x])), prefixes: [], files: ["/ref.md"] };
  const list = findings(index, resolved.diagnostics, ref);
  const model = (q: Partial<DrcQuery> = {}) => drcModel(list, { ...DEFAULT_QUERY, ...q }, { links: resolved.links.length, checks: resolved.checks });

  it("puts errors in Blocking and warnings in Warnings; information only when asked", () => {
    const m = model();
    expect(m.lanes.map((l) => [l.id, l.total])).toEqual([
      ["blocking", 1],
      ["warnings", 4],
    ]);
    expect(m.counts).toEqual({ error: 1, warning: 4, info: 3 });
    expect(model({ info: true }).lanes.map((l) => l.id)).toEqual(["blocking", "warnings", "info"]);
    expect(model({ severity: "error" }).lanes.map((l) => l.id)).toEqual(["blocking"]);
    // a severity filter hides the information lane too
    expect(model({ severity: "warning", info: true }).lanes.map((l) => l.id)).toEqual(["warnings"]);
  });

  it("counts configured links (no error or warning) and the checks that ran", () => {
    expect(model().configured).toEqual({ links: 2, linksTotal: 3, checksRan: 1, checksSkipped: 1 });
  });

  it("groups by module (the instance, or the definition at its first use), by rule, or by source", () => {
    const warnings = (q: Partial<DrcQuery>) => model(q).lanes.find((l) => l.id === "warnings")!.groups.map((g) => [g.label, g.items.map((f) => f.code)]);
    expect(warnings({ groupBy: "module" })).toEqual([
      ["Case", ["ENCLOSURE_STALE"]],
      ["LED", ["HW_NO_SOURCES"]],
      ["MCU", ["PB_ARTIFACT_UNAVAILABLE"]],
      ["Smart watch (root)", ["UHD_FASTENER_TORQUE"]],
    ]);
    // a link's finding is grouped under the module that declares it
    expect(model({ groupBy: "module" }).lanes[0].groups.map((g) => g.label)).toEqual(["Main board (board)"]);
    expect(warnings({ groupBy: "rule" }).map(([l]) => l)).toEqual(["ENCLOSURE_STALE", "HW_NO_SOURCES", "PB_ARTIFACT_UNAVAILABLE", "UHD_FASTENER_TORQUE"]);
    expect(warnings({ groupBy: "source" })).toEqual([["UHD", ["ENCLOSURE_STALE", "HW_NO_SOURCES", "PB_ARTIFACT_UNAVAILABLE", "UHD_FASTENER_TORQUE"]]]);
  });

  it("filters by words in the code, message, module or validator, and says how many are shown", () => {
    const w = model({ text: "led" }).lanes;
    expect(w.map((l) => [l.id, l.shown, l.total])).toEqual([
      ["blocking", 1, 1],
      ["warnings", 1, 4],
    ]);
    expect(model({ text: "stale case" }).lanes[1].groups.flatMap((g) => g.items.map((f) => f.code))).toEqual(["ENCLOSURE_STALE"]);
    expect(model({ text: "zzz" }).lanes.every((l) => l.shown === 0 && l.groups.length === 0)).toBe(true);
  });

  it("gives the page plain rows: the module, the source location, the reference's meaning and what to do", () => {
    const rows = pageModel(model()).lanes[0].groups[0].items;
    expect(rows[0]).toEqual({
      key: "0",
      code: "UHD_LINK_STATE",
      summary: "gpio1 drives 3.3 V into a 2.0 V LED",
      message: "gpio1 drives 3.3 V into a 2.0 V LED; add a resistor",
      reasons: ["add a resistor"],
      module: "link board:mcu_led",
      means: "Link DRC: incompatible.",
      todo: "Relink; never widen a range.",
      validator: "uhd/checkSystem",
      sourceKind: "UHD",
      sourceLabel: undefined,
      hasSource: false,
    });
    expect(list[0].reference).toEqual({ file: "/ref.md", line: 7 });
  });

  it("takes only known query values from the page", () => {
    expect(parseQuery({ groupBy: "rule", text: "x", severity: "error", info: true })).toEqual({ groupBy: "rule", text: "x", severity: "error", info: true });
    expect(parseQuery({ groupBy: "nonsense", severity: 3, info: "yes" } as never, { ...DEFAULT_QUERY, groupBy: "source" })).toEqual({ ...DEFAULT_QUERY, groupBy: "source" });
    expect(parseQuery(undefined)).toEqual(DEFAULT_QUERY);
  });
});

describe("DRC page", () => {
  // the panel is @protoboardai/views' DrcPanel in the extension's React page (its drawing is tested in packages/views)
  const page = { screen: "drc" as const, title: "DRC", cspSource: "vscode-resource:", script: "vscode-resource:/ext/dist/views-app.js", style: "vscode-resource:/ext/dist/views-app.css", nonce: "N1" };
  it("runs only the extension's own script by its nonce, and loads nothing from the network", () => {
    const html = appHtml(page);
    expect(html).toContain('<body data-screen="drc" data-theme="vscode">');
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script type="module" nonce="N1" src="vscode-resource:/ext/dist/views-app.js">');
    const csp = appCsp(page);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-N1'");
    expect(csp).not.toMatch(/https?:|\*/);
  });

  it("posts the model the panel draws: rows as plain data, already worded", () => {
    const index = indexProject(resolved, bundle);
    const model = pageModel(drcModel(findings(index, resolved.diagnostics), { ...DEFAULT_QUERY, info: true }, { links: resolved.links.length, checks: resolved.checks }));
    expect(model.lanes.map((l) => l.id)).toEqual(["blocking", "warnings", "info"]);
    const row = model.lanes[0].groups[0].items[0];
    expect(row).toMatchObject({ code: "UHD_LINK_STATE", summary: "gpio1 drives 3.3 V into a 2.0 V LED", reasons: ["add a resistor"], hasSource: false });
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});

describe("library parts that were not fetched (B6)", () => {
  const f = (code: string, message: string) => ({ code, message });
  it("a missing definition's row offers Fetch Parts, which adds every missing one once", () => {
    expect(unfetchedPart(f("PB_UNRESOLVED_DEFINITION", 'board/r1 references "yageo-rc0402", which no local source or catalog entry defines; 9 instances use it'))).toBe("yageo-rc0402");
    expect(unfetchedPart(f("UHD_LINK_STATE", 'x references "y"'))).toBeUndefined();
    expect(unfetchedParts([f("PB_UNRESOLVED_DEFINITION", 'a references "p2"'), f("PB_UNRESOLVED_DEFINITION", 'b references "p1"'), f("PB_UNRESOLVED_DEFINITION", 'c references "p2"')])).toEqual(["p1", "p2"]);
  });
  it("the DRC page, Problems and the viewer's notice all reach it", () => {
    const ext = readFileSync(join(here, "../src/extension.ts"), "utf8");
    expect(ext).toMatch(/fix: \(\) => this\.guard\(\(\) => this\.fetchMissingParts\(this\.current\)\)/);
    expect(ext).toMatch(/registerCodeActionsProvider\([\s\S]{0,300}PB_UNRESOLVED_DEFINITION[\s\S]{0,300}protoboard\.fetchParts/);
    const viewer = readFileSync(join(here, "../src/viewerEditor.ts"), "utf8");
    expect(viewer).toMatch(/m\.action === "fetchParts"\) return void vscode\.commands\.executeCommand\("protoboard\.fetchParts", editor\.root\)/);
  });
});

describe("Explain (B15)", () => {
  it("is the code's own entry as a page, with the finding and a link to the whole reference", () => {
    const md = explainMarkdown({ code: "UHD_PROPULSION_CURRENT", severity: "warning", message: "link battery_pads: 120 A peak", validator: "ext:x/propulsion", means: "The pack cannot \\| supply<br>the peak", todo: "Use a bigger pack", reference: { file: "/p/node_modules/@protoboardai/ext-hardware/skills/system-compose/references/diagnostic-codes.md", line: 102 } });
    expect(md).toMatch(/^# UHD_PROPULSION_CURRENT\n/);
    expect(md).toContain("**What it means.** The pack cannot | supply\n\nthe peak");
    expect(md).toContain("**What to do.** Use a bigger pack");
    expect(md).toContain("link battery_pads: 120 A peak");
    expect(md).toContain("[diagnostic-codes.md, line 102](/p/node_modules/@protoboardai/ext-hardware/skills/system-compose/references/diagnostic-codes.md#L102)");
    expect(md).not.toMatch(/^\|/m);
    const ext = readFileSync(join(here, "../src/extension.ts"), "utf8");
    expect(ext).toMatch(/executeCommand\("markdown\.showPreview", uri\)/);
  });
});
