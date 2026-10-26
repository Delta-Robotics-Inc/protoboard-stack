// The integration test: runs in VS Code's extension host (CommonJS, no test
// framework). With the real CLI: checks the quadcopter into the Problems
// panel, the hierarchy and the DRC view, opens viewer tabs on a dev server the
// extension starts (the webview loads the bundle and draws it; the Inspector
// follows the focused tab), reads the token sets VS Code gives a webview in
// six colour themes, and stops the server. With a stand-in CLI that logs
// requests: the tab loads the server's bundle, and loads it again when the
// server restarts.
const assert = require("node:assert/strict");
const { existsSync, readdirSync, readFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const vscode = require("vscode");

// as VS Code spells it: on Windows it gives a folder with a lower-case drive letter
const root = vscode.Uri.file(process.env.PROTOBOARD_TEST_WORKSPACE).fsPath;

async function until(what, timeout = 120000) {
  const t0 = Date.now();
  for (;;) {
    const v = await what();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** `promise`, or a failure naming `what` when it has not settled after `ms` (an await that never returns hangs the whole run). */
async function within(promise, ms, what) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, fail) => (timer = setTimeout(() => fail(new Error(`${what} within ${ms / 1000} s`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

exports.run = async function run() {
  const ext = vscode.extensions.getExtension("deltarobotics.vscode-protoboard");
  assert.ok(ext, "extension not loaded");
  const api = await ext.activate();
  const step = (s) => console.log(`[protoboard integration] ${s}`);

  assert.deepEqual(await api.projects(), [root]);
  step("project found");

  // one version number (PB-944): the extension's is the stack's, which the build reads from packages/core
  const stackVersion = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "core", "package.json"), "utf8")).version;
  assert.equal(ext.packageJSON.version, stackVersion, "the extension and the stack share one version number");
  assert.equal(api.about(), `Protoboard for VS Code ${stackVersion}`);
  assert.ok((await vscode.commands.getCommands(true)).includes("protoboard.about"), "Protoboard: About is not registered");
  step(`about: extension and stack ${stackVersion}`);

  await vscode.commands.executeCommand("protoboard.check", root);
  // a build made elsewhere meanwhile (another test run building this example) starts a check that supersedes
  // ours, and ours returns without a result: wait for the newer one rather than fail
  const result = await until(() => api.checkResult(root)).catch(() => undefined);
  assert.ok(result, "no check result");
  const diags = vscode.languages.getDiagnostics(vscode.Uri.file(join(root, "src", "quadcopter.uhd.ts")));
  assert.ok(diags.length > 0, "no diagnostics on src/quadcopter.uhd.ts");
  // the source column names the validator once: "protoboard uhd/checkSystem", "protoboard/artifacts", never "protoboard protoboard/…"
  assert.ok(diags.every((d) => /protoboard/i.test(d.source) && !/^protoboard protoboard/.test(d.source)), "diagnostic source");
  // system findings sit at the link or instance they are about, not all on the system's id line
  assert.ok(new Set(diags.map((d) => d.range.start.line)).size > 2, "system findings all on one line");
  const total = vscode.languages.getDiagnostics().flatMap(([, list]) => list.filter((d) => /protoboard/i.test(d.source ?? ""))).length;
  assert.equal(total, result.counts.error + result.counts.warning + result.counts.info);
  step(`check: ${JSON.stringify(result.counts)}, ${total} in Problems`);

  // the same build feeds the Explorer and the DRC view
  const explorer = api.explorer();
  assert.equal(explorer.project, root);
  assert.equal(explorer.roots.length, 1);
  assert.equal(explorer.roots[0].kind, "system");
  assert.ok(explorer.roots[0].children.some((n) => n.kind === "fasteners"), "no fastener stack in the Explorer");
  assert.equal(api.findings(root).length, result.counts.error + result.counts.warning + result.counts.info);
  await vscode.commands.executeCommand("protoboard.drc.focus");
  await vscode.commands.executeCommand("workbench.view.extension.protoboard-inspector");
  // the DRC panel is the extension's React page (PB-900): it drew its lanes, inside the view
  const drc = await until(() => api.drcDrawn() && api.drcDrawn().lanes >= 2 && api.drcDrawn(), 60000);
  assert.ok(!drc.scrolls, "the DRC page is larger than its view");
  step(`explorer: ${explorer.roots[0].children.length} top-level nodes; DRC: ${api.findings(root).length} findings, ${drc.lanes} lanes and ${drc.findings} rows drawn`);

  // PROTOBOARD_TEST_QUICK=1: the viewer tabs only (while working on them)
  if (!process.env.PROTOBOARD_TEST_QUICK) await libraryAndCloud(api, step);
  if (!process.env.PROTOBOARD_TEST_QUICK) await settingsAndAgents(api, step, stackVersion);

  // the viewer as editor tabs (PB-895..897): the shell the extension ships, reading the dev server the extension starts
  const viewerTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === "protoboard.viewer");
  await vscode.commands.executeCommand("protoboard.openViewer", root);
  await until(() => api.viewers().length === 1 && api.devEndpoint(root), 180000);
  const endpoint = api.devEndpoint(root);
  assert.ok(endpoint && endpoint.url, "no dev endpoint");
  assert.ok(existsSync(join(root, ".protoboard", "local", "dev.json")), "no session record");
  // the webview loads the bundle from the dev server itself (CORS for its origin) and draws the diagram
  await until(() => api.viewers()[0].state && api.viewers()[0].state.nodes > 0, 120000);
  let [tab] = api.viewers();
  assert.equal(tab.target.path, "");
  assert.equal(tab.state.view, "diagram");
  assert.ok(tab.state.views.some((v) => v.id === "diagram") && tab.state.views.some((v) => v.id === "3d"), `view tabs: ${JSON.stringify(tab.state.views)}`);
  // tabs scoped to the module shown (PB-920): the quadcopter's system has no board drawings of its own
  assert.ok(!tab.state.views.some((v) => v.id === "schematic" || v.id === "pcb"), `board drawings at the top level: ${JSON.stringify(tab.state.views)}`);
  assert.equal(viewerTabs().length, 1);
  assert.equal(viewerTabs()[0].label, tab.title);
  assert.ok(!/Protoboard|UHD viewer/.test(tab.title), `tab title ${tab.title}`);
  step(`viewer tab "${tab.title}" on ${endpoint.url}: ${tab.state.nodes} nodes, views ${tab.state.views.map((v) => v.id).join(",")}`);

  // a page that loads again (a restored tab, a tab moved to another window, Developer: Reload Webviews) starts from the page as
  // it was written, before there was a dev server: the extension tells it again, and it draws again (PB-943)
  const before = { loads: tab.loads, states: tab.states };
  await vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction");
  await until(() => api.viewers()[0].loads > before.loads && api.viewers()[0].states > before.states && api.viewers()[0].state.nodes > 0, 60000);
  step(`the tab's page loaded again and drew again (${api.viewers()[0].loads} loads)`);

  // the Inspector follows the focused tab: the level it shows, then what it selects
  await until(() => api.inspector().card, 20000);
  assert.equal(api.inspector().card.kind, "level");
  const child = explorer.roots[0].children.find((n) => n.type === "instance" && n.children.some((c) => c.type === "instance"));
  assert.ok(child, "no module with modules in the quadcopter");
  await vscode.commands.executeCommand("protoboard.explorer.focus", child);
  await until(() => api.viewers()[0].selection && api.viewers()[0].selection.id === child.path, 20000);
  await until(() => api.inspector().card && api.inspector().card.path === child.path && api.inspector().card.kind === "module", 20000);
  step(`focus ${child.path}: the tab selects it, the Inspector shows ${api.inspector().card.title} (${api.inspector().card.sections.map((x) => x.title).join(", ")})`);
  await inspectorShows(api, root, explorer, step);
  // back to the module the next steps start from
  await vscode.commands.executeCommand("protoboard.explorer.focus", child);
  await until(() => api.inspector().card && api.inspector().card.path === child.path && api.inspector().card.kind === "module", 20000);

  // a module opens as a new tab of its own (double-click, Open in New Viewer Tab); the Inspector follows the focused one
  await api.openViewer({ root, path: child.path });
  // the new tab reports its module from its first state on: never the top level on the way
  const seen = [];
  await until(() => {
    const v = api.viewers().find((x) => x.target.path === child.path);
    if (v && v.state && seen[seen.length - 1] !== v.state.path) seen.push(v.state.path);
    return api.viewers().length === 2 && v && v.state && v.state.path === child.path && v.state.nodes > 0;
  }, 60000);
  const second = api.viewers().find((v) => v.target.path === child.path);
  assert.deepEqual(seen, [child.path], `the second tab reported ${JSON.stringify(seen)}`);
  assert.equal(viewerTabs().length, 2);
  await until(() => api.inspector().card && api.inspector().card.path === child.path && api.inspector().card.kind === "level", 20000);
  step(`second tab "${second.title}" on ${child.path}; the Inspector follows it`);
  // the same module and view again is the same tab
  await api.openViewer({ root, path: child.path });
  assert.equal(api.viewers().length, 2);

  // the pair view of a link (the inspector's pair preview, uhd-viewer:openPair) is a tab of its own at the link's level (PB-905)
  const links = [];
  const walk = (n) => (n.type === "link" ? links.push(n) : n.children.forEach(walk));
  explorer.roots.forEach(walk);
  const link = links.find((l) => l.linkId);
  assert.ok(link, "no link in the quadcopter");
  // the Inspector's link card opens it (its pair button)
  await api.inspectorAction({ kind: "link", icon: "link", title: link.label, chips: [], counts: { error: 0, warning: 0, info: 0 }, sections: [], actions: { focus: true, source: true, artifacts: false, operation: false, pair: true }, path: link.path, linkId: link.linkId }, "pair");
  const pairTab = await until(() => api.viewers().find((v) => v.target.view === "pair" && v.state && v.state.view === "pair"), 60000);
  assert.equal(pairTab.target.params.link, link.linkId);
  assert.ok(/· Pair$/.test(pairTab.title), `pair tab title ${pairTab.title}`);
  step(`pair tab "${pairTab.title}" for ${link.linkId}`);
  await vscode.window.tabGroups.close(viewerTabs().filter((t) => t.input.uri.query.includes("view=pair")));
  await until(() => api.viewers().length === 2, 10000);

  // the BOM and the full library are VS Code editors of their own: a viewer's BOM tab opens the BOM editor (PB-912)
  const bomTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith("protoboard.bomProject"));
  await vscode.commands.executeCommand("protoboard.openViewer", { root, path: "", view: "bom" });
  await until(() => bomTabs().length === 1, 30000);
  assert.equal(api.viewers().length, 2, "a viewer tab opened for the BOM");
  step("the viewer's BOM tab opens the BOM editor");
  await vscode.window.tabGroups.close(bomTabs());

  // the colour themes: the token sets VS Code gives a webview, for the visual captures; the Protoboard ones carry the orange
  // settings ids, and the names the webview's body carries (data-vscode-theme-id)
  const themes = { "Default Dark Modern": "Dark Modern", "Default Light Modern": "Light Modern", "Default High Contrast": "Default High Contrast", "Default High Contrast Light": "Default High Contrast Light", "Protoboard Dark": "Protoboard Dark", "Protoboard Light": "Protoboard Light" };
  const tokens = {};
  const workbench = vscode.workspace.getConfiguration("workbench");
  try {
    for (const [theme, name] of Object.entries(themes)) {
      await workbench.update("colorTheme", theme, vscode.ConfigurationTarget.Global);
      let last;
      const report = await until(async () => {
        const r = (last = await api.viewerTheme().catch((e) => ({ error: e.message })));
        // the body's theme id is the theme's name from VS Code 1.109 on, and its settings id before
        return r && (r.themeId === name || r.themeId === theme) ? r : undefined;
      }, 20000).catch((e) => {
        throw new Error(`${theme}: ${e.message}; the tab reported ${JSON.stringify(last && { ...last, vars: Object.keys(last.vars || {}).length })}`);
      });
      tokens[theme] = { name, vars: report.vars, classes: report.classes };
    }
  } finally {
    await workbench.update("colorTheme", undefined, vscode.ConfigurationTarget.Global);
  }
  assert.equal(tokens["Protoboard Dark"].vars["--vscode-button-background"], "#ff5c00");
  assert.equal(tokens["Protoboard Light"].vars["--vscode-statusBar-background"], "#ff5c00");
  assert.ok(tokens["Default High Contrast"].classes.includes("vscode-high-contrast"), "high contrast body class");
  assert.notEqual(tokens["Default Dark Modern"].vars["--vscode-button-background"], "#ff5c00");
  if (process.env.PROTOBOARD_TOKENS_OUT) require("node:fs").writeFileSync(process.env.PROTOBOARD_TOKENS_OUT, JSON.stringify(tokens, null, 1));
  step(`themes: ${Object.entries(tokens).map(([k, v]) => `${k} (${Object.keys(v.vars).length} vars)`).join(", ")}`);

  await roundFive(api, explorer, child, step, viewerTabs);
  await hierarchyInTabs(api, ext, explorer, child, step);

  // a command that waits on a dialog never returns in this test: fail with what it is rather than hang the run
  await within(vscode.commands.executeCommand("protoboard.stopDev", root), 30000, "Protoboard: Stop Dev Server did not return");
  await until(() => !existsSync(join(root, ".protoboard", "local", "dev.json")));
  await assert.rejects(fetch(endpoint.url));
  step("dev server stopped");
  await vscode.window.tabGroups.close(viewerTabs());
  await until(() => api.viewers().length === 0, 10000);
  // no viewer tab open: the Inspector says so (PB-1042)
  await until(() => api.inspector().empty && /Open a viewer tab/.test(api.inspector().empty), 10000).catch(() => assert.fail(`the Inspector with no viewer tab: ${JSON.stringify(api.inspector()).slice(0, 200)}`));
  step("no viewer tab open: the Inspector shows its empty state");

  // the workspace's project has its own installed CLI, which comes before protoboard.cliPath (PB-929): the stand-in
  // for `protoboard dev` is put in through the test's own hook
  api.useCliForTest(process.env.PROTOBOARD_FAKE_CLI);
  const loads = () => (existsSync(process.env.PROTOBOARD_FAKE_LOG) ? readFileSync(process.env.PROTOBOARD_FAKE_LOG, "utf8").split("\n").filter((l) => l === "GET /uhd-bundle.json").length : 0);
  try {
    await vscode.commands.executeCommand("protoboard.openViewer", root);
    const fake = await until(() => api.devEndpoint(root), 30000);
    await until(() => loads() >= 1, 30000);
    step(`the tab loaded the bundle from ${fake.url}`);
    // a rebuild (a new version of the same session) reaches the tab: on the server's event stream where the webview can open
    // one, and by the tab asking the server where it cannot (VS Code before about 1.130, PB-943: beta test 1's "dev server is unreachable")
    // give the tab's stream a moment to ask (where the webview cannot open one, the request is made and the answer refused)
    await until(async () => (await (await fetch(new URL("/__streams", fake.url))).text()) !== "0", 5000).catch(() => undefined);
    const built = loads();
    const told = await (await fetch(new URL("/__rebuild", fake.url))).text();
    await until(() => loads() > built, 30000);
    assert.equal(api.devEndpoint(root).session, fake.session, "a rebuild is not a restart");
    step(`the tab loaded a rebuild (${told})`);
    const before = loads();
    await fetch(new URL("/__restart", fake.url));
    await until(() => loads() > before, 30000);
    // the tab may see the restart before the extension's monitor does (it asks every second where it has no stream)
    await until(() => api.devEndpoint(root).session !== fake.session, 15000);
    step("the tab reloaded after the server restarted");
    await vscode.commands.executeCommand("protoboard.stopDev", root);
    await until(() => !existsSync(join(root, ".protoboard", "local", "dev.json")));
    await vscode.window.tabGroups.close(viewerTabs());
  } finally {
    api.useCliForTest(undefined);
  }
  // an account check made meanwhile asked the stand-in, which only runs dev ("the fake CLI only runs dev, not
  // whoami"), and its answer would lock the library for the steps below (a run of 2026-10-24): asked again, of the real CLI
  await api.accountRefresh();
  await goneFolder(api, step);
  await stackAndSignIn(api, step);
};

/**
 * PB-1042: the hierarchy is in each viewer tab, at its left, and the Inspector is the only view of the right side
 * bar, following the focused tab. Two projects' tabs each show their own project's tree; the Inspector follows the
 * tab in front and keeps the last one's while a text editor has the focus; a row's menu command and Reveal in
 * Hierarchy act on the tab's panel.
 */
async function hierarchyInTabs(api, ext, explorer, child, step) {
  const views = ext.packageJSON.contributes.views;
  assert.deepEqual(views["protoboard-inspector"].filter((v) => !v.id.startsWith("protoboard.start.")).map((v) => v.id), ["protoboard.inspector"], "the right side bar holds more than the Inspector");
  assert.ok(!Object.values(views).flat().some((v) => v.id === "protoboard.explorer"), "a Hierarchy view is still contributed");
  const quad = api.viewers().find((v) => v.target.root === root && v.target.path === "");
  assert.ok(quad, "no top-level tab of the quadcopter");
  const report = async (uri) => api.viewerHierarchy(uri);
  // The panel follows its tab's width (uhd-viewer d3ad89b): a tab narrower than 640 px starts with it folded, and a
  // tab that becomes narrow (another tab opened beside it, the Inspector shown) folds it, opening it again when the
  // tab is wide again. The test's window is small (a tab of about 300 px without a display), so a tab's panel is
  // opened as a user would, with Toggle Hierarchy in that tab, before its tree is read; a panel open already is left.
  const opened = async (tab, target, what) => {
    let last;
    const first = await until(async () => (last = await report(tab.uri).catch(() => undefined)), 30000).catch(() => assert.fail(`${what}: the tab did not report its hierarchy`));
    if (first.open) return false;
    await vscode.commands.executeCommand("protoboard.openViewer", target);
    await until(() => (api.viewers().find((v) => v.uri === tab.uri) || {}).focused, 20000).catch(() => assert.fail(`${what}: the tab did not come to the front`));
    await vscode.commands.executeCommand("protoboard.hierarchy.toggle");
    await until(async () => (last = await report(tab.uri)).open, 20000).catch(() => assert.fail(`${what}: Toggle Hierarchy did not open the panel: ${JSON.stringify(last).slice(0, 300)}`));
    return true;
  };
  // the tab's tree, once it has its rows (the panel opened first when it is folded)
  const treeOf = async (tab, target, what) => {
    let last;
    for (let attempt = 0; ; attempt++) {
      await opened(tab, target, what);
      const tree = await until(async () => {
        const r = (last = await report(tab.uri));
        return r.open && r.rows.length > 1 && r;
      }, 30000).catch(() => undefined);
      if (tree) return tree;
      // folded meanwhile (the tab became narrow as it was read): once more
      if (attempt >= 2 || (last && last.open)) assert.fail(`${what}: its hierarchy has no tree: ${JSON.stringify(last).slice(0, 300)}`);
    }
  };
  const quadTarget = { root, path: "" };
  const quadWasFolded = !(await report(quad.uri)).open;
  const quadTree = await treeOf(quad, quadTarget, "the quadcopter's tab");
  assert.equal(quadTree.rows[0].path, "", "the tree does not start at the system");
  assert.equal(quadTree.rows[0].kind, "system");
  assert.equal(quadTree.rows[0].label, explorer.roots[0].label);
  step(`the quadcopter's tab (${quadTree.width} px${quadWasFolded ? ", its hierarchy folded at that width and opened" : ""}) shows its hierarchy: ${quadTree.rows.length} rows, from "${quadTree.rows[0].label}"`);

  // a second project's tab beside it: its own tree
  const bottle = join(root, "..", "smart-bottle");
  await vscode.commands.executeCommand("protoboard.openViewer", { root: bottle, beside: true });
  const other = await until(() => api.viewers().find((v) => v.target.root === bottle && v.state && v.state.nodes > 0), 180000);
  const bottleTarget = { root: bottle };
  const bottleWasFolded = !(await until(() => report(other.uri), 30000)).open;
  const bottleTree = await treeOf(other, bottleTarget, "the smart-bottle tab");
  assert.notEqual(bottleTree.rows[0].label, quadTree.rows[0].label, "both tabs show the same project's tree");
  // the quadcopter's tab, narrower now that a tab is beside it, may have folded its panel: opened again, it shows its own tree
  const quadFolded = !(await report(quad.uri)).open;
  const quadNow = await treeOf(quad, quadTarget, "the quadcopter's tab beside the smart-bottle tab");
  assert.equal(quadNow.rows[0].label, quadTree.rows[0].label, "the quadcopter's tab changed its tree");
  assert.equal(quadNow.rows.length, quadTree.rows.length, "the quadcopter's tab lost rows of its tree");
  step(`two projects' tabs side by side (${quadNow.width} and ${bottleTree.width} px), two trees: "${quadNow.rows[0].label}" and "${bottleTree.rows[0].label}" (${bottleTree.rows.length} rows)${bottleWasFolded ? "; the smart-bottle tab started folded" : ""}${quadFolded ? "; the quadcopter's panel had folded beside it and opened again with its tree" : ""}`);

  // the Inspector follows the tab in front (the quadcopter's panel, opened again above, may have brought its tab there)
  await vscode.commands.executeCommand("protoboard.openViewer", bottleTarget);
  await until(() => api.viewers().find((v) => v.uri === other.uri).focused, 20000).catch(() => assert.fail("the smart-bottle tab did not come to the front"));
  await until(() => api.inspector().project === "smart-bottle", 20000).catch(() => assert.fail(`the Inspector did not follow the smart-bottle tab: ${JSON.stringify(api.inspector()).slice(0, 200)}`));
  await vscode.commands.executeCommand("protoboard.openViewer", { root, path: "" });
  await until(() => api.viewers().find((v) => v.uri === quad.uri).focused, 20000);
  await until(() => api.inspector().project === require("node:path").basename(root), 20000).catch(() => assert.fail("the Inspector did not follow the quadcopter's tab"));
  // a text editor in front: the Inspector keeps the last tab's
  await vscode.window.showTextDocument(vscode.Uri.file(join(bottle, "protoboard.config.ts")), { preview: true });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(api.inspector().project, require("node:path").basename(root), "the Inspector left the last viewer tab for a text editor");
  step(`the Inspector follows the focused tab (smart-bottle, then ${require("node:path").basename(root)}) and keeps it while a text editor is in front`);

  // a row's right-click menu: the command gets the row's context, and acts in the focused tab
  await vscode.commands.executeCommand("protoboard.openViewer", { root, path: "" });
  await until(() => api.viewers().find((v) => v.uri === quad.uri).focused, 20000);
  await vscode.commands.executeCommand("protoboard.explorer.focus", { webview: "protoboard.viewer", webviewSection: "hierarchy", pbPath: child.path, pbKind: "assembly", pbDefId: child.defId, preventDefaultContextMenuItems: true });
  await until(() => {
    const v = api.viewers().find((x) => x.uri === quad.uri);
    return v.selection && v.selection.id === child.path;
  }, 20000).catch(() => assert.fail("a hierarchy row's Focus in Viewer did not select it"));
  let lastSelected;
  await opened(quad, quadTarget, "the quadcopter's tab after Focus in Viewer");
  const selected = await until(async () => {
    const r = (lastSelected = await report(quad.uri));
    if (!r.open) await opened(quad, quadTarget, "the quadcopter's tab after Focus in Viewer");
    return r.rows.find((x) => x.path === child.path && x.selected) && r;
  }, 20000).catch(() => assert.fail(`the tab's hierarchy does not highlight the canvas's selection: ${JSON.stringify(lastSelected).slice(0, 300)}`));
  step(`a row's Focus in Viewer selects ${child.path}; the tab's hierarchy highlights it (${selected.rows.length} rows)`);

  // Reveal in Hierarchy: a module further down shows in the tab's panel
  const deep = (function find(n) {
    for (const c of n.children) {
      if (c.type === "instance" && c.path.includes("/")) return c;
      const f = c.type === "instance" && find(c);
      if (f) return f;
    }
  })(explorer.roots[0]);
  if (deep) {
    await vscode.commands.executeCommand("protoboard.hierarchy.reveal", deep);
    await until(async () => (await report(quad.uri)).rows.some((x) => x.path === deep.path), 20000).catch(() => assert.fail(`Reveal in Hierarchy did not show ${deep.path}`));
    step(`Reveal in Hierarchy shows ${deep.path} in the tab's panel`);
  }

  // (its dev server is left to the extension, which stops the servers it started when it deactivates; one started
  // elsewhere and attached to is not ours to stop)
  await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => (t.input instanceof vscode.TabInputCustom && t.input.uri.toString() === other.uri) || (t.input instanceof vscode.TabInputText && t.input.uri.fsPath.startsWith(bottle))));
  await until(() => !api.viewers().some((v) => v.target.root === bottle), 10000);
}

/**
 * PB-1005: VS Code restores a viewer tab of a project whose folder is gone (moved, deleted, a worktree removed). The
 * tab closes itself, and the window's current project stays the one that is there: kept, the tab made the missing
 * folder current and every command then failed in it.
 */
async function goneFolder(api, step) {
  const { mkdtempSync, writeFileSync } = require("node:fs");
  const gone = mkdtempSync(join(require("node:os").tmpdir(), "pb-gone-"));
  writeFileSync(join(gone, "protoboard.config.ts"), "export default {};\n");
  rmSync(gone, { recursive: true, force: true });
  const target = vscode.Uri.from({ scheme: "protoboard-viewer", path: `/${require("node:path").basename(gone)}`, query: new URLSearchParams({ root: gone, module: "" }).toString() });
  const isGone = (t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === "protoboard.viewer" && t.input.uri.query === target.query;
  const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter(isGone);
  let seen = false;
  const watch = vscode.window.tabGroups.onDidChangeTabs((e) => (seen ||= e.opened.some(isGone)));
  try {
    // as VS Code restores a tab after a reload: the custom editor is opened on the tab's URI
    await vscode.commands.executeCommand("vscode.openWith", target, "protoboard.viewer");
    await until(() => seen && tabs().length === 0, 15000).catch(() => assert.fail(`the tab of the missing folder ${seen ? "did not close" : "never opened"}`));
  } finally {
    watch.dispose();
  }
  assert.ok(api.viewers().every((v) => v.target.root !== gone), "a viewer of the missing folder is still tracked");
  assert.equal(api.explorer().project, root, "the missing folder became the current project");
  assert.deepEqual(await api.projects(), [root]);
  // and the current project still works: a check runs in it
  await vscode.commands.executeCommand("protoboard.check", root);
  assert.ok(await until(() => api.checkResult(root), 120000), "no check of the current project after the missing folder's tab");
  step("a restored viewer tab of a folder that is gone closed itself; the current project stayed and checks");
}

/**
 * PB-929 and PB-928. Which CLI runs and why; then the sign-in screen: the
 * test environment has the requirement off (run.mjs), so it is turned on for
 * the extension host and the CLI it starts, against a service that does not
 * answer, and off again.
 */
/**
 * Round 5 (the 2026-10-08 first builds): tab titles tell modules apart, a part with nothing inside opened as a tab
 * is named after itself, a selection in the viewer brings the Inspector back to the front (D6), and a tab leads to
 * its source file (item 29). Two viewer tabs are open: the top level, and `child` (a module that holds modules).
 */
async function roundFive(api, explorer, child, step, viewerTabs) {
  // titles: every tab's own, and the tab strip shows them
  const titles = () => api.viewers().map((v) => v.title);
  assert.equal(new Set(titles()).size, api.viewers().length, `tab titles are not distinct: ${JSON.stringify(titles())}`);

  // a part with nothing inside, opened as a tab (the hierarchy's Open in New Viewer Tab): the tab shows the level that
  // holds it, and is named after the part, never after that level (the reviewers' second "Main board")
  const leaf = child.children.find((n) => n.type === "instance" && !n.children.some((c) => c.type === "instance"));
  assert.ok(leaf, `no part with nothing inside below ${child.path}`);
  await api.openViewer({ root, path: leaf.path });
  const leafTab = await until(() => {
    const v = api.viewers().find((x) => x.target.path === leaf.path);
    return v && v.state && v.state.nodes > 0 ? v : undefined;
  }, 60000);
  assert.equal(leafTab.state.path, child.path, "a part's tab does not show the level that holds it");
  assert.equal(leafTab.state.at, leaf.path, "a part's tab does not say it is on the part");
  const parentTab = api.viewers().find((v) => v.target.path === child.path);
  assert.notEqual(leafTab.title, parentTab.title, `a part's tab is titled like its parent's: ${leafTab.title}`);
  assert.equal(new Set(titles()).size, api.viewers().length, `tab titles are not distinct: ${JSON.stringify(titles())}`);
  // the tab strip takes a tab's title a moment after the tab reports it (it shows the module's id until then)
  await until(() => JSON.stringify(viewerTabs().map((t) => t.label).sort()) === JSON.stringify(titles().sort()), 10000).catch(() => assert.deepEqual(viewerTabs().map((t) => t.label).sort(), titles().sort()));
  step(`tab titles are distinct: ${titles().map((t) => `"${t}"`).join(", ")}`);

  // from a tab to its source file: the tab's commands act on the module the tab is on
  const top = api.viewers().find((v) => v.target.path === "");
  await api.openViewer({ root, path: "" });
  await until(() => api.viewers().find((v) => v.target.path === "").focused, 20000);
  const textTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputText);
  const opened = textTabs().length;
  await vscode.commands.executeCommand("protoboard.viewer.openSourceFile");
  const sourceTab = await until(() => textTabs().find((t) => /\.uhd\.ts$/.test(t.input.uri.fsPath) && t.isActive), 20000);
  assert.ok(sourceTab.input.uri.fsPath.startsWith(join(root, "src")), `the top-level module's source is ${sourceTab.input.uri.fsPath}, not under src/`);
  const rel = vscode.workspace.asRelativePath(sourceTab.input.uri, false);
  // as the tab's right-click menu calls it: with the tab's resource
  await vscode.commands.executeCommand("protoboard.viewer.copyRelativeSourcePath", viewerTabs().find((t) => t.label === top.title).input.uri);
  let copied;
  try {
    copied = await vscode.env.clipboard.readText();
  } catch {
    copied = undefined; // no clipboard in this session: the command itself did not throw
  }
  if (copied !== undefined && copied !== "") assert.equal(copied, rel, "Copy Relative Path copied something else");
  await vscode.window.tabGroups.close(textTabs().filter((t) => t.input.uri.fsPath === sourceTab.input.uri.fsPath));
  assert.equal(textTabs().length, opened);
  step(`a viewer tab leads to its source: ${rel}${copied ? " (opened, and its path copied)" : " (opened)"}`);

  // D6: the user puts the Inspector away; selecting a module in the viewer brings it back, every time
  const selectInViewer = async (node) => {
    await vscode.commands.executeCommand("protoboard.explorer.focus", node);
    await until(() => api.viewers().some((v) => v.selection && v.selection.id === node.path), 20000);
  };
  await api.openViewer({ root, path: "" });
  // every time: after nothing selected, a module, another, and the same module again (it was selected already: a
  // pick, not a change, which the viewer says again). Nothing, then a module, sent at once, arrive in one render of the
  // tab: the run that failed here (2026-10-23) heard nothing, the module being the one selected before.
  const other = explorer.roots[0].children.find((n) => n.type === "instance" && n !== child) || child;
  for (const [node, clear] of [[child, true], [other, false], [other, false]]) {
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    await until(() => !api.state().inspectorVisible, 20000);
    if (clear) await vscode.commands.executeCommand("protoboard.explorer.focus", explorer.roots[0]).then(undefined, () => undefined);
    await selectInViewer(node);
    await until(() => api.state().inspectorVisible, 20000).catch(() => assert.fail(`selecting ${node.path} in the viewer did not bring the Inspector to the front`));
    await until(() => api.inspector().card && api.inspector().card.path === node.path, 20000);
    // the keyboard stays with the editors: the viewer tab is still the active tab of its group
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(active && active.input instanceof vscode.TabInputCustom && active.input.viewType === "protoboard.viewer", "the viewer tab is no longer the active tab after the Inspector was revealed");
  }
  step("a selection in the viewer brings the Inspector back to the front every time (the same module picked again too), and the viewer tab stays active");

  // the setting turns it off
  const cfg = vscode.workspace.getConfiguration("protoboard");
  await cfg.update("inspector.revealOnSelection", false, vscode.ConfigurationTarget.Global);
  try {
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    await until(() => !api.state().inspectorVisible, 20000);
    await vscode.commands.executeCommand("protoboard.explorer.focus", explorer.roots[0]).then(undefined, () => undefined);
    await selectInViewer(child);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(api.state().inspectorVisible, false, "the Inspector came to the front with protoboard.inspector.revealOnSelection off");
  } finally {
    await cfg.update("inspector.revealOnSelection", undefined, vscode.ConfigurationTarget.Global);
  }
  step("protoboard.inspector.revealOnSelection off: the Inspector stays where the user put it");

  // back to the two tabs the next steps expect
  await vscode.window.tabGroups.close(viewerTabs().filter((t) => t.label === leafTab.title));
  await until(() => api.viewers().length === 2, 10000);
}

async function stackAndSignIn(api, step) {
  const cli = api.cliOf(root);
  assert.equal(cli.from, "project", `the workspace's project runs its own CLI first: ${JSON.stringify(cli)}`);
  assert.ok(cli.args[0].endsWith(join("@protoboardai", "cli", "bin", "protoboard.mjs")));
  const stack = api.stack();
  step(`the CLI is the project's own (${cli.command} ${cli.args[0]}); this build ${stack.carried ? `carries the stack ${stack.carried} (${stack.unpacked ? "unpacked" : "not unpacked yet"} in ${stack.home})` : "carries no stack"}`);
  const commands = await vscode.commands.getCommands(true);
  for (const id of ["protoboard.newProject", "protoboard.signIn", "protoboard.signInDevice", "protoboard.account.check", "protoboard.stack.show", "protoboard.stack.update", "protoboard.stack.install", "protoboard.stack.fromVsix"]) assert.ok(commands.includes(id), `${id} is not registered`);

  // the test's library signs no one in: its cloud features are open, with nobody signed in (the test's own config folder)
  assert.deepEqual(api.lock(), { locked: false, reason: "ok", message: "" }, "the test's library signs no one in, so nothing needs a sign-in");
  const before = { url: process.env.PROTOBOARD_CLOUD_URL, config: process.env.PROTOBOARD_CONFIG_DIR, store: process.env.PROTOBOARD_CREDENTIAL_STORE };
  const fs = require("node:fs");
  const scratch = fs.mkdtempSync(join(require("node:os").tmpdir(), "pb-signin-"));
  const kept = { hierarchy: api.explorer().roots.length, findings: (api.findings(root) ?? []).length };
  assert.ok(kept.hierarchy > 0 && kept.findings > 0, "nothing was shown before signing out");
  assert.deepEqual(api.access(), { type: "protoboard:access", signedOut: false });
  // the Inspector's side bar and the DRC panel open, at the size they have now: they keep it through a sign-out and a
  // sign-in (0.1.5 brought them back smaller)
  await vscode.commands.executeCommand("protoboard.drc.focus");
  await vscode.commands.executeCommand("workbench.view.extension.protoboard-inspector");
  const sizes = await viewSizes(api);
  assert.ok(sizes.inspector.width > 0 && sizes.drc.height > 0, `the views did not report their size: ${JSON.stringify(sizes)}`);
  // the Library lists parts while its cloud may be used (PB-1039: signed out it lists none, below)
  await api.libraryReload();
  await until(() => !api.library().loading && api.library().items.length > 0, 60000);
  const listedKey = api.library().items[0].key;
  const cadScratch = fs.mkdtempSync(join(require("node:os").tmpdir(), "pb-signin-cad-"));
  // spelled as VS Code spells a file it opens (a lower-case drive letter on Windows)
  const cadFile = vscode.Uri.file(join(cadScratch, "signed-out.glb")).fsPath;
  // a stand-in Protoboard service that signs people in (as the hosted one does): the whole library, browsing
  // included, needs an account (PB-928); what is asked of it beyond discovery and the account is kept
  let me = { signedIn: false };
  const libraryAsked = [];
  const service = require("node:http").createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/.well-known/uhd-library") return void res.end(JSON.stringify({ protocol: "uhd-library/v1", id: "protoboard", api: "/v1", auth: { read: "bearer" }, account: { provider: "firebase", apiKey: "key" } }));
    if (req.url === "/v1/me") return void res.end(JSON.stringify(me));
    libraryAsked.push(`${req.method} ${req.url}${req.headers.authorization ? " (signed in)" : ""}`);
    if (req.url.startsWith("/v1/parts?") && req.headers.authorization) return void res.end(JSON.stringify({ total: 0, parts: [], nextCursor: null }));
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "this needs a signed-in Protoboard account: run `protoboard login`" } }));
  });
  await new Promise((ok) => service.listen(0, "127.0.0.1", ok));
  const serviceUrl = `http://127.0.0.1:${service.address().port}`;
  try {
    // signed out for real: that service, and an empty credentials folder
    process.env.PROTOBOARD_CLOUD_URL = serviceUrl;
    process.env.PROTOBOARD_CONFIG_DIR = scratch;
    process.env.PROTOBOARD_CREDENTIAL_STORE = "file";
    await api.accountRefresh();
    const lock = api.lock();
    assert.equal(lock.locked, true, `the library is not locked: ${JSON.stringify(lock)}`);
    assert.equal(lock.reason, "signed-out");
    assert.match(lock.message, /^Sign in to use the Protoboard library/);
    assert.deepEqual(api.access(), { type: "protoboard:access", signedOut: true, reason: "signed-out", message: lock.message });
    // the status bar says it, without blocking anything
    assert.equal(api.accountStatus().text, "$(account) Sign in");
    assert.equal(api.accountStatus().tooltip, "Protoboard: not signed in. Click to sign in for library parts and prices.");
    // nothing of the project was hidden or thrown away
    // a sign-out resizes no view (0.1.5 brought them back smaller)
    const out = await viewSizes(api);
    assert.ok(Math.abs(out.inspector.width - sizes.inspector.width) <= 2 && Math.abs(out.drc.height - sizes.drc.height) <= 2, `the sign-out resized the views: ${JSON.stringify({ before: sizes, after: out })}`);
    assert.equal(api.explorer().roots.length, kept.hierarchy, "the hierarchy was emptied at the sign-out");
    assert.equal((api.findings(root) ?? []).length, kept.findings, "the findings were thrown away at the sign-out");
    step(`signed out (${lock.reason}): the status bar says "${api.accountStatus().text}"; the hierarchy (${kept.hierarchy}) and the findings (${kept.findings}) are still there`);

    // local work, signed out (PB-928): check, the viewer with its dev server and drawing, the Inspector
    const checked = api.checkResult(root);
    await vscode.commands.executeCommand("protoboard.check", root);
    const result = await until(() => api.checkResult(root) !== checked && api.checkResult(root), 180000);
    assert.equal(result.counts.error, 0, JSON.stringify(result.counts));
    step(`signed out, Check ran: ${JSON.stringify(result.counts)}`);
    await vscode.commands.executeCommand("protoboard.openViewer", { root, path: "" });
    await until(() => api.viewers().length === 1 && api.devEndpoint(root), 180000);
    await until(() => api.viewers()[0].state && api.viewers()[0].state.nodes > 0, 120000);
    const explorer = api.explorer();
    const child = explorer.roots[0].children.find((n) => n.type === "instance" && n.children.some((c) => c.type === "instance"));
    await vscode.commands.executeCommand("protoboard.explorer.focus", child);
    await until(() => api.viewers()[0].selection && api.viewers()[0].selection.id === child.path, 20000);
    await until(() => api.inspector().card && api.inspector().card.path === child.path && api.inspector().card.kind === "module", 20000);
    step(`signed out, the viewer draws ${api.viewers()[0].state.nodes} nodes from ${api.devEndpoint(root).url}, and the Inspector shows ${api.inspector().card.title}`);

    // the cloud, signed out: the Library shows its sign-in card and lists nothing (PB-1039)
    const signedOutLib = api.library();
    assert.equal(signedOutLib.items.length, 0, `the Library still lists ${signedOutLib.items.length} parts signed out`);
    assert.equal(signedOutLib.total, 0);
    assert.equal(signedOutLib.error, undefined, `the Library shows an error signed out: ${signedOutLib.error}`);
    assert.equal(signedOutLib.loading, false);
    const previewBefore = api.libraryPreview();
    await api.libraryMessage({ type: "open", key: listedKey });
    await api.libraryMessage({ type: "loadMore" });
    await api.libraryMessage({ type: "query", query: { text: "motor" } });
    await api.libraryShow(listedKey.split("/")[0], listedKey.split("/").slice(1).join("/"), "sidebar");
    assert.deepEqual(api.libraryPreview(), previewBefore, "a click signed out opened a part");
    assert.equal(api.library().items.length, 0, "a search signed out listed parts");
    await api.libraryReload();
    assert.equal(api.library().items.length, 0, "a reload signed out listed parts");
    // nothing of that reached the library: signed out, the Library and its part pages ask it nothing (PB-928)
    assert.deepEqual(libraryAsked, [], `signed out, the extension asked the library: ${libraryAsked.join(", ")}`);
    step("signed out: the Library shows the sign-in card and lists no parts; a click, a search or a reload lists nothing and asks the library nothing (PB-1039, PB-928)");
    // Fetch Parts and the update check ask to sign in instead of running
    for (const id of ["protoboard.fetchParts", "protoboard.parts.check"]) {
      const asked = api.signInPrompts().length;
      void vscode.commands.executeCommand(id, root);
      await until(() => api.signInPrompts().length > asked, 20000);
      assert.match(api.signInPrompts().at(-1), /^Sign in to use the Protoboard library/);
      await vscode.commands.executeCommand("notifications.clearAll");
    }
    assert.ok(!existsSync(join(root, "parts", "catalog", "never")), "Fetch Parts fetched something");
    step("signed out: Fetch Parts and Check Libraries for Updates ask to sign in (the prompt names the library)");
    // a STEP or GLB opens as it is
    fs.writeFileSync(cadFile, "not a model: the tab says so");
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(cadFile));
    const cad = await until(() => api.cadViewers().find((v) => v.file === cadFile && v.state), 30000);
    assert.notEqual(cad.state, "locked");
    step(`signed out: a CAD tab reads its file (${cad.state})`);
    // the CLI: local commands run, cloud commands stop with one line and exit 4
    // not spawnSync: the stand-in service runs in this process, and must answer while the CLI waits
    const run = (args) =>
      new Promise((ok) => {
        const p = require("node:child_process").spawn(cli.command, [...cli.args, ...args, "--format", "json"], { cwd: root, env: { ...process.env, ...(cli.env || {}) } });
        let stdout = "";
        let stderr = "";
        p.stdout.on("data", (d) => (stdout += d));
        p.stderr.on("data", (d) => (stderr += d));
        p.on("close", (status) => ok({ status, stdout, stderr }));
      });
    const local = await run(["check"]);
    assert.ok(local.status === 0 || local.status === 1, local.stderr);
    assert.doesNotMatch(local.stdout + local.stderr, /protoboard login/);
    for (const args of [["parts", "add", "never"], ["parts", "search", "motor"]]) {
      const refused = await run(args);
      assert.equal(refused.status, 4, `${args.join(" ")}: ${refused.stderr}`);
      assert.equal(JSON.parse(refused.stdout).code, "SIGN_IN_REQUIRED");
    }
    assert.deepEqual(libraryAsked, [], `signed out, the CLI asked the library: ${libraryAsked.join(", ")}`);
    step("signed out: `protoboard check` runs; `protoboard parts add` and `parts search` exit 4 with SIGN_IN_REQUIRED, asking the library nothing");

    // A sign-in made elsewhere (a terminal, an agent) is noticed by itself (first builds review, item 24): `protoboard
    // login` writes the credentials and touches a stamp beside them. Here the credentials are written as login keeps
    // them, and the stand-in service accepts the account; nothing asks the extension to look.
    const beforeSignIn = await viewSizes(api);
    const jwt = (claims) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    me = { signedIn: true, allowed: true, uid: "u1", email: "ada@example.com", auth: "firebase", kind: "user", publisher: false };
    fs.writeFileSync(join(scratch, "credentials.json"), JSON.stringify({ [serviceUrl]: { service: serviceUrl, uid: "u1", email: "ada@example.com", refreshToken: "r", apiKey: "key", signedInAt: new Date().toISOString(), via: "browser", idToken: jwt({ user_id: "u1" }), idTokenExpiresAt: Date.now() + 50 * 60_000 } }), { mode: 0o600 });
    const t0 = Date.now();
    fs.writeFileSync(join(scratch, "sign-in-changed"), `${new Date().toISOString()}\n`);
    await until(() => !api.lock().locked, 20000);
    assert.deepEqual(api.access(), { type: "protoboard:access", signedOut: false });
    const afterSignIn = await viewSizes(api);
    assert.ok(Math.abs(afterSignIn.inspector.width - beforeSignIn.inspector.width) <= 2 && Math.abs(afterSignIn.drc.height - beforeSignIn.drc.height) <= 2, `the sign-in resized the views: ${JSON.stringify({ before: beforeSignIn, after: afterSignIn })}`);
    step(`a sign-in made elsewhere was noticed by itself in ${((Date.now() - t0) / 1000).toFixed(1)} s: the Library is unlocked with no command run`);
  } finally {
    for (const [k, v] of [["PROTOBOARD_CLOUD_URL", before.url], ["PROTOBOARD_CONFIG_DIR", before.config], ["PROTOBOARD_CREDENTIAL_STORE", before.store]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    service.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  await api.accountRefresh();
  assert.equal(api.lock().locked, false, "unlocked again");
  // the Library lists its parts again, from the test's library
  await api.libraryReload();
  await api.librarySearch({ text: "" });
  await until(() => !api.library().loading && api.library().items.length > 0, 60000);
  step(`signed in again: the Library lists ${api.library().items.length} parts (PB-1039)`);
  await vscode.commands.executeCommand("protoboard.stopDev", root);
  await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputCustom && (t.input.viewType === "protoboard.viewer" || t.input.viewType === "protoboard.cadViewer")));
  fs.rmSync(cadScratch, { recursive: true, force: true });
  step(`a sign-out and a sign-in left the Inspector ${sizes.inspector.width}px wide and the DRC panel ${sizes.drc.height}px high`);
}

/**
 * What the Inspector's and the DRC panel's pages say their size is (a page is as large as its view), once both
 * views are shown and the size has settled: the same answer twice in a row, a moment apart. A panel just opened
 * answers first at the size of a page not laid out yet (300 x 150, a frame's default): the run of 2026-10-24 took
 * that for the size before the sign-out, and the panel's real size after it for a resize.
 */
async function viewSizes(api) {
  await until(() => api.state().inspectorVisible && api.state().drcVisible, 20000).catch(() => undefined);
  const probe = async () => {
    api.inspectorProbe();
    api.drcProbe();
    const inspector = await until(() => api.inspectorDrawn(), 20000).catch(() => ({ width: 0, height: 0 }));
    const drc = await until(() => api.drcDrawn(), 20000).catch(() => ({ width: 0, height: 0 }));
    return { inspector: { width: inspector.width, height: inspector.height }, drc: { width: drc.width, height: drc.height } };
  };
  let last = await probe();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const now = await probe();
    if (JSON.stringify(now) === JSON.stringify(last)) return now;
    last = now;
  }
  return last;
}

// The settings page and the agents' MCP configuration (PB-930), in a temporary home: no real agent's
// configuration is read or written here.
async function settingsAndAgents(api, step, stackVersion) {
  const { mkdirSync, mkdtempSync, statSync, writeFileSync } = require("node:fs");
  const home = mkdtempSync(join(require("node:os").tmpdir(), "pb-settings-it-"));
  try {
    mkdirSync(join(home, ".gemini"));
    writeFileSync(join(home, ".gemini", "settings.json"), '{\n  // mine\n  "theme": "Default Dark"\n}\n');
    mkdirSync(join(home, ".cursor"));
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { protoboard: { type: "http", url: "https://alpha.example/mcp" } } }, null, 2));
    api.settings.useHome(home);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("protoboard.openSettings") && commands.includes("protoboard.agents.connect"), "the settings commands are not registered");

    await vscode.commands.executeCommand("protoboard.openSettings");
    await until(() => api.settings.drawn(), 60000);
    const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputWebview && /protoboard\.settings/.test(t.input.viewType));
    assert.ok(tab && tab.label === "Protoboard Settings", "no Protoboard Settings tab");
    let model = api.settings.model();
    assert.equal(model.about.version, stackVersion);
    assert.ok(model.about.cli && /protoboard\.mjs$/.test(model.about.cli), `the CLI in use: ${JSON.stringify(model.about)}`);
    assert.deepEqual(model.agents.rows.map((r) => [r.id, r.status]), [["cursor", "not-connected"], ["gemini", "not-connected"]]);
    assert.ok(model.agents.notFound.includes("Claude Code") && model.agents.notFound.includes("Codex"), "agents of the real home leaked into the page");
    const launcher = join(home, ".config", "protoboard", "agents", "protoboard-mcp");
    // Cursor in this home has another server named protoboard (the alpha app's): what is copied for any client takes the free name, as the row does
    // on Windows the launcher is a .cmd file, which a client can only start through cmd
    const win = process.platform === "win32";
    const entry = win ? { command: "cmd", args: ["/c", `${launcher}.cmd`] } : { command: launcher, args: [] };
    assert.deepEqual(JSON.parse(model.other.forms[0].text), { mcpServers: { "protoboard-stack": entry } });
    assert.ok(!JSON.stringify(model).includes("alpha.example/mcp"), "the other server's address is shown beyond its host");
    // looking wrote nothing: no launcher, no backup, the files as they were
    assert.ok(!existsSync(join(home, ".config")), "listing the agents wrote something");
    step(`settings page: ${model.agents.rows.length} agents found in the test home, version ${model.about.version}`);

    // Connect on one agent's row: that agent only, the comment kept, a backup, the launcher written and the CLI recorded
    let row = await api.settings.connect("gemini");
    assert.equal(row.status, "connected", JSON.stringify(api.settings.model().agents.rows));
    const gemini = readFileSync(join(home, ".gemini", "settings.json"), "utf8");
    assert.ok(gemini.includes("// mine") && gemini.includes('"theme": "Default Dark"'), "the rest of the file changed");
    assert.ok(gemini.includes(`"command": ${JSON.stringify(entry.command)}`) && gemini.includes(JSON.stringify(win ? `${launcher}.cmd` : launcher)), gemini);
    assert.equal(readFileSync(join(home, ".gemini", "settings.json.protoboard-backup"), "utf8"), '{\n  // mine\n  "theme": "Default Dark"\n}\n');
    if (win) assert.ok(existsSync(`${launcher}.cmd`), "no launcher was written");
    else assert.ok(statSync(launcher).mode & 0o111, "the launcher is not executable");
    const record = JSON.parse(readFileSync(join(home, ".config", "protoboard", "agents", "launcher.json"), "utf8"));
    assert.ok(record.cli.length === 1 && /protoboard\.mjs$/.test(record.cli[0].entry) && record.cli[0].version === stackVersion, JSON.stringify(record));
    // the recorded Node.js is one the CLI runs with, never the editor's own executable
    const nodePath = readFileSync(join(home, ".config", "protoboard", "agents", "node-path"), "utf8").trim();
    assert.ok(nodePath !== process.execPath && !/[Cc]ode|electron/i.test(require("node:path").basename(nodePath)), `node-path is ${nodePath}`);
    model = api.settings.model();
    assert.match(model.agents.rows.find((r) => r.id === "gemini").detail, /^Added to ~[\\/]\.gemini[\\/]settings\.json\. /);
    assert.equal(model.agents.rows.find((r) => r.id === "cursor").status, "not-connected", "an agent nobody chose was changed");
    assert.equal(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"), JSON.stringify({ mcpServers: { protoboard: { type: "http", url: "https://alpha.example/mcp" } } }, null, 2));
    step("settings page: Connect wrote one agent's entry, kept the rest of its file and a backup; the launcher records the CLI");

    // what the agent would start: the launcher runs the server, which answers an MCP initialize
    const { spawnSync } = require("node:child_process");
    const hello = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "it", version: "0" } } }) + "\n";
    const started = spawnSync(entry.command, entry.args, { input: hello, encoding: "utf8", cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
    const answer = JSON.parse(started.stdout.split("\n")[0] || "{}");
    assert.equal(answer.result && answer.result.serverInfo && answer.result.serverInfo.name, "protoboard-stack", `the launcher did not start the server: ${started.stderr}`);
    assert.match(answer.result.instructions, /NOT the Protoboard alpha web app/);
    step(`the launcher starts the MCP server (protocol ${answer.result.protocolVersion})`);

    // another server named protoboard (the alpha's) stays; ours goes in beside it
    row = await api.settings.connect("cursor");
    assert.equal(row.status, "connected");
    const cursor = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers;
    assert.deepEqual(cursor.protoboard, { type: "http", url: "https://alpha.example/mcp" });
    assert.equal(cursor["protoboard-stack"].command, entry.command);

    // Disconnect: only our entry goes
    row = await api.settings.disconnect("gemini");
    assert.equal(row.status, "not-connected");
    assert.ok(!readFileSync(join(home, ".gemini", "settings.json"), "utf8").includes("protoboard-mcp"));
    assert.ok(readFileSync(join(home, ".gemini", "settings.json"), "utf8").includes("// mine"));
    await api.settings.disconnect("cursor");
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers), ["protoboard"]);
    step("settings page: Disconnect removed our entries only; the alpha's server of the same name was never touched");

    // the first-run offer: shown once, and remembered whatever the answer
    await api.settings.offer({ force: true });
    assert.ok(api.settings.offered(), "the offer was not remembered");
    assert.equal(await api.settings.offer(), "not-shown", "the offer showed a second time");
    step("the offer to connect agents is shown once and remembered");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

async function libraryAndCloud(api, step) {
  // the Library: the project's libraries from the CLI, search, a category, load more, a preview
  await vscode.commands.executeCommand("protoboard.library.focus");
  await api.libraryReload();
  let lib = api.library();
  assert.equal(lib.error, undefined, `library: ${lib.error}`);
  assert.deepEqual(lib.libraries.map((l) => l.id), ["protoboard"]);
  assert.equal(lib.libraries[0].url, process.env.PROTOBOARD_CLOUD_URL);
  await api.librarySearch({ text: "", category: "", domain: "", protocol: "" });
  lib = api.library();
  assert.ok(lib.total > 0 && lib.items.length > 0, "no parts found");
  assert.ok(lib.taxonomy && lib.taxonomy.nodes.length > 0, "no taxonomy");
  const firstPage = lib.items.length;
  step(`library: ${lib.total} parts, ${firstPage} on the first page, ${lib.taxonomy.nodes.length} taxonomy roots`);
  const root0 = lib.taxonomy.nodes.find((n) => n.count > 0);
  await api.librarySearch({ category: root0.path });
  lib = api.library();
  assert.equal(lib.total, root0.count, `category ${root0.path}: ${lib.total} parts, the taxonomy says ${root0.count}`);
  assert.ok(lib.items.every((i) => i.categories.some((c) => c === root0.path || c.startsWith(root0.path + "."))), "a part outside the category");
  step(`category ${root0.path}: ${lib.total} parts`);
  await api.librarySearch({ category: "" });
  if (api.library().more) {
    await api.libraryLoadMore();
    assert.ok(api.library().items.length > firstPage, "load more added nothing");
    step(`load more: ${api.library().items.length} parts`);
  }
  if (process.env.PROTOBOARD_TEST_LIBRARY === "real") {
    // a part the quadcopter uses: the preview says so, with its facts and revisions
    const used = api.library().items.find((i) => i.used) ?? (await api.librarySearch({ text: "meps" }), api.library().items.find((i) => i.used));
    assert.ok(used, "no used part in the results");
    await api.libraryOpen(used.key);
    await until(() => (api.library().drawn || []).includes("part"), 20000);
    const p = api.libraryPreview();
    assert.equal(p.partId, used.partId);
    // in the project: pinned at the shown revision, or an update when the library has a newer recommended one
    assert.ok(["pinned", "update"].includes(p.action.kind), `action ${p.action.kind}`);
    assert.ok(p.revisions.length >= 1 && p.facts.length >= 1, "preview without facts or revisions");
    step(`preview ${p.partId}@${p.revision}: ${p.facts.length} facts, ${p.interfaceCount} interfaces, glb ${p.glb ? "yes" : "no"}`);
    // the card's pages (PB-918), as a card asks for them: from the revision, pictures as webview addresses, never a model
    const pages = await api.libraryPages(used.key);
    assert.equal(pages.revision, used.revision);
    assert.ok(pages.images.length >= 1 && pages.images.every((i) => /^[a-z-]+:\/\//.test(i.url) && /\.(png|jpe?g|webp|svg)$/.test(i.url)), `pictures: ${JSON.stringify(pages.images)}`);
    assert.ok(pages.dimensions && pages.interfaces.chips.length > 0 && pages.artifacts.length > 0, "pages without dimensions, interfaces or artifacts");
    assert.ok(!JSON.stringify(pages).includes(".glb\",\"url") && pages.cad && typeof pages.cad.file === "string", "the CAD page is a summary, not a model");
    step(`pages of ${p.partId}: ${pages.images.length} picture(s), ${pages.specs.length} specs, ${pages.interfaces.chips.length} interface chips, CAD ${pages.cad.file}, ${pages.artifacts.length} artifact kinds`);
    // its prices by source, as the detail's Prices section asks: what the library serves, or why not and what to do
    const prices = await api.libraryPrices();
    assert.equal(prices.partId, used.partId);
    assert.ok(prices.unavailable ? prices.unavailable.message.length > 0 : Array.isArray(prices.sources), "prices without sources or a reason");
    assert.ok(!/"source"|"note"/.test(JSON.stringify(prices)), "an offer says how its price was read");
    step(`prices of ${p.partId}: ${prices.unavailable ? `unavailable (${prices.unavailable.code})` : `${prices.sources.length} supplier(s), ${prices.offers} offer(s)`}`);
    await api.librarySearch({ text: "" });
  }
  // a personal library: user settings, searched after the project's
  await vscode.workspace.getConfiguration("protoboard").update("libraries", [{ id: "mine", url: process.env.PROTOBOARD_CLOUD_URL }], vscode.ConfigurationTarget.Global);
  await until(async () => (api.library().libraries || []).some((l) => l.id === "mine" && l.personal) && !api.library().loading, 60000);
  assert.ok(api.library().items.some((i) => i.library === "mine" && i.shadowedBy === "protoboard"), "no result from the personal library");
  step("personal library searched after the project's");
  await vscode.workspace.getConfiguration("protoboard").update("libraries", undefined, vscode.ConfigurationTarget.Global);
  await until(async () => !(api.library().libraries || []).some((l) => l.id === "mine") && !api.library().loading, 60000);
  // item 6 (PB-912): the full-page library and Manage libraries open as editor tabs (the React webviews)
  const webviewTabs = (type) => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith(type));
  await vscode.commands.executeCommand("protoboard.library.openPage");
  await until(() => webviewTabs("protoboard.libraryPage").length === 1, 10000);
  await vscode.commands.executeCommand("protoboard.library.manage");
  await until(() => webviewTabs("protoboard.libraries").length === 1, 10000);
  // each React webview says when it has drawn: the bundle loaded under the CSP and mounted
  await until(() => ["sidebar", "page", "manager"].every((w) => (api.library().drawn || []).includes(w)), 20000);
  step(`full-page library and Manage libraries open as tabs; drawn: ${api.library().drawn.join(", ")}`);
  // a part opened from the full-page library has a back control (PB-917): back brings the page to the front and closes the
  // detail (a part's detail needs a real library: the stand-in lists parts only)
  await vscode.window.tabGroups.close(webviewTabs("protoboard.libraries"));
  if (process.env.PROTOBOARD_TEST_LIBRARY === "real") await libraryBack(api, step, webviewTabs);
  await vscode.window.tabGroups.close(webviewTabs("protoboard.libraryPage"));
  // Project parts (PB-903, PB-945): `protoboard parts list` into the side bar (a React webview, so it follows the theme)
  // in its own container, then the libraries' updates
  await vscode.commands.executeCommand("protoboard.parts.focus");
  await api.partsRefresh(false);
  let parts = api.parts();
  assert.equal(parts.root, root);
  await until(() => api.parts().drawn.includes("sidebar"), 20000);
  assert.ok(parts.parts && parts.parts.counts.library > 0 && parts.parts.counts.designed > 0, `project parts: ${JSON.stringify(parts.parts?.counts)}`);
  assert.ok(parts.parts.parts.every((p) => ["pinned", "up-to-date", "update-available", "diverged", "local", "designed"].includes(p.status)));
  // every part says its status (PB-932): the project's own are local, a library's unverified, verified or official
  assert.ok(parts.parts.parts.every((p) => (p.tier === "catalog" ? ["unverified", "verified", "official"] : ["local"]).includes(p.trust)), `part status: ${parts.parts.parts.map((p) => `${p.id}=${p.trust}`).join(" ")}`);
  await api.partsRefresh(true);
  parts = api.parts();
  assert.ok(parts.checked && parts.parts.checked, "the libraries were not asked for updates");
  step(`project parts: ${parts.parts.counts.total} (${parts.parts.counts.library} from libraries, ${parts.parts.counts.updates} updates, ${parts.parts.counts.diverged} diverged)`);
  // a part selected in the list shows in the Inspector, with its artifacts as previews (PB-919)
  const used = parts.parts.parts.find((p) => p.tier === "catalog" && p.instances > 0);
  await api.partsSelect(used.id);
  const card = await until(() => api.inspector().card && api.inspector().card.kind === "part" && api.inspector().card.part.partId === used.id && api.inspector().card, 20000);
  assert.ok(card.sections.some((s) => s.title === "Used in"), `part card sections: ${card.sections.map((s) => s.title)}`);
  assert.equal(api.parts().selected, used.id);
  assert.ok(card.chips.some((c) => c.status === used.trust), `the Inspector's part card has no status chip: ${JSON.stringify(card.chips)}`);
  // its definition is shown as a module's is: the viewer's details, with the files of its artifacts (PB-940)
  assert.deepEqual(card.details && card.details.target, { kind: "definition", id: used.id });
  const partDrawn = await until(() => api.inspectorDrawn() && api.inspectorDrawn().what.startsWith(`part:${used.id}:`) && api.inspectorDrawn().details && api.inspectorDrawn(), 30000);
  assert.ok(partDrawn.cards > 0 && partDrawn.rows === 0 && partDrawn.failed === 0, `the part's artifacts: ${JSON.stringify(partDrawn)}`);
  step(`project part ${used.id} in the Inspector: ${card.sections.map((s) => s.title).join(", ")}; ${partDrawn.cards} artifact cards (${partDrawn.loaded} pictures, ${partDrawn.icons} icons); status ${used.trust}`);
  // the Project Parts page (PB-945): an editor tab with the same parts as cards; the command opens it, once
  await vscode.commands.executeCommand("protoboard.parts.openPage");
  await until(() => webviewTabs("protoboard.partsPage").length === 1, 10000);
  await until(() => api.parts().drawn.includes("page"), 20000);
  await vscode.commands.executeCommand("protoboard.parts.openPage");
  assert.equal(webviewTabs("protoboard.partsPage").length, 1, "a second Project Parts page opened");
  step(`Project Parts page open as a tab; drawn: ${api.parts().drawn.join(", ")}`);
  await vscode.window.tabGroups.close(webviewTabs("protoboard.partsPage"));
  await until(() => !api.parts().pageOpen, 10000);
  // a part opened from the project's parts goes back to that page (beta test 1, F17: "Project parts" only closed the tab)
  if (process.env.PROTOBOARD_TEST_LIBRARY === "real") {
    const lib = parts.parts.parts.find((p) => p.tier === "catalog" && p.library);
    await api.libraryShow(lib.library, lib.id, "parts");
    await until(() => webviewTabs("protoboard.part").length === 1, 20000);
    assert.equal(api.libraryPreview().back, "Project parts");
    await api.libraryBack();
    await until(() => webviewTabs("protoboard.partsPage").length === 1 && webviewTabs("protoboard.part").length === 0, 10000);
    step("a part's Project parts breadcrumb opens the Project Parts page");
    await vscode.window.tabGroups.close(webviewTabs("protoboard.partsPage"));
  }
  // the Cloud view: the stand-in library signs no one in (PB-911), the cost of the design's bill of materials, and Generate
  assert.match(api.accountStatus().tooltip, process.env.PROTOBOARD_TEST_LIBRARY === "fake" ? /needs no sign-in/ : /^Protoboard: /);
  await vscode.commands.executeCommand("protoboard.cloud.focus");
  const operations = join(root, "operations");
  const records = new Set(readdirSync(operations));
  try {
    let state = await api.generate(root, { quiet: true });
    if (state.state === "refused" && (state.problems ?? []).every((p) => p.code === "REL_DIRTY")) state = await api.generate(root, { quiet: true, allowDirty: true });
    assert.equal(state.state, "done", `release: ${state.message} ${JSON.stringify(state.problems ?? [])}`);
    const cloud = api.cloud();
    assert.equal(cloud.account.signedIn, false);
    assert.ok(cloud.releases.length >= 1 && cloud.releases[0].index && cloud.releases[0].overview, "no package with index.html and the overview PDF");
    // the cost is the design's bill of materials, in dollars, whatever releases exist (PB-933)
    assert.equal(cloud.cost.source.kind, "design");
    const cost = api.cost(root);
    assert.ok(cost.lines.length > 10, "the design's lines read");
    assert.equal(cost.bom.priced + cost.bom.unpriced + cost.bom.included + cost.manufacturing.made, cost.lines.length);
    assert.ok(cost.bom.totals.length <= 1 && cost.bom.totals.every((t) => t.currency === "USD"), "one currency");
    assert.ok(cost.lines.filter((l) => l.kind !== "included").every((l) => l.instances.length > 0), "every line links to a module");
    step(`cloud: release ${cloud.releases[0].version}, ${cost.lines.length} lines, ${cost.bom.priced} priced, ${cost.bom.unpriced} unpriced, ${cost.manufacturing.made} made`);
    // the Cloud panel's model: the real account state, the project, the release, the cost preview (PB-904)
    assert.equal(cloud.view.account.state, process.env.PROTOBOARD_TEST_LIBRARY === "fake" ? "open" : cloud.view.account.state);
    assert.ok(cloud.view.project.name && cloud.view.project.libraries >= 1, `cloud project: ${JSON.stringify(cloud.view.project)}`);
    assert.equal(cloud.view.releases[0].version, cloud.releases[0].version);
    assert.ok(cloud.view.releases[0].files > 0 && cloud.view.cost.bought === cost.bom.priced + cost.bom.unpriced);
    // the BOM editor (PB-904, PB-933): the project's bill of materials, from the design, in a tab of its own
    await vscode.commands.executeCommand("protoboard.openBom", root);
    const bomTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith("protoboard.bomProject"));
    await until(() => bomTabs().length === 1, 10000);
    await until(() => api.parts().bomDrawn && api.cloudDrawn(), 20000);
    assert.deepEqual(cost.source, { kind: "design" });
    assert.equal(cost.bill.currency, "USD");
    step(`BOM editor "${bomTabs()[0].label}": ${cost.bill.counts.lines} lines, per unit ${cost.bill.totals.perUnit}, order ${cost.bill.totals.order} USD`);
    await vscode.window.tabGroups.close(bomTabs());
    await until(() => bomTabs().length === 0, 10000);
    // after a window reload VS Code hands the tab back with the page's saved state, which names the project: it draws the bill again
    await api.restoreBom(root);
    await until(() => bomTabs().length === 1 && api.parts().bomDrawn, 20000);
    assert.match(bomTabs()[0].label, /^Bill of materials · /);
    // a tab of a project that is no longer there is closed, and so is a second tab of the same project
    await api.restoreBom(require("path").join(root, "no-such-project"));
    await api.restoreBom(root);
    await until(() => bomTabs().length === 1, 10000);
    step(`the BOM tab is restored from its saved state ("${bomTabs()[0].label}")`);
    await vscode.window.tabGroups.close(bomTabs());
    // a release's ordering list opens in the same editor, as a custom editor
    const list = require("path").join(root, "release", cloud.releases[0].version, "system", "ordering-list.csv");
    if (require("fs").existsSync(list)) {
      const customTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === "protoboard.bom");
      await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(list), "protoboard.bom");
      await until(() => customTabs().length === 1, 10000);
      step("the release's ordering list opens in the BOM editor");
      await vscode.window.tabGroups.close(customTabs());
    }
    await vscode.commands.executeCommand("protoboard.openPackage", root);
    const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith("protoboard.package"));
    await until(() => tabs().length === 1, 10000);
    step("package index.html open in a webview");
    await vscode.window.tabGroups.close(tabs());
  } finally {
    // the release writes its operation record; the test leaves the project as it found it
    for (const f of readdirSync(operations)) if (!records.has(f)) rmSync(join(operations, f));
  }

  // the CAD viewer (PB-906): STEP and GLB open in an editor tab, not the system's application
  const cadTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === "protoboard.cadViewer");
  const frame = join(root, "src", "modules", "frame", "out");
  for (const name of ["body.glb", "body.step"]) {
    const file = vscode.Uri.file(join(frame, name));
    await vscode.commands.executeCommand("vscode.open", file);
    await until(() => cadTabs().some((t) => t.input.uri.fsPath === file.fsPath), 20000);
    const tab = await until(() => api.cadViewers().find((v) => v.file === file.fsPath && v.state), 60000);
    assert.notEqual(tab.state, "error", `${name}: ${tab.message}`);
    step(`CAD viewer: ${name} drawn from ${tab.source.via ? "the GLB exported with it" : tab.source.kind} (${tab.state}${tab.message ? `, ${tab.message}` : ""})`);
  }
  await vscode.window.tabGroups.close(cadTabs());
}

/**
 * The Inspector's selection (PB-940): the page is the extension's React page with the viewer's own details in it. A
 * module is shown from the build's bundle with every artifact as a card; pictures load through webview URLs below
 * the page's roots (the project, its artifact packages, the library's cache) and nowhere else; a card opens its
 * artifact; an interface picked in the hierarchy has a card of its own.
 */
async function inspectorShows(api, root, explorer, step) {
  const { join, sep } = require("node:path");
  const all = [];
  const walk = (n) => (all.push(n), n.children.forEach(walk));
  explorer.roots.forEach(walk);
  // a catalog part with a body model: its artifacts are files of the project, with a picture exported for it
  const leaf = all.find((n) => n.type === "instance" && n.tier === "catalog" && n.hasArtifacts && existsSync(join(root, "docs", "images", `part-${n.defId}.png`)));
  assert.ok(leaf, "no catalog part with an exported picture in the quadcopter");
  await vscode.commands.executeCommand("protoboard.explorer.focus", leaf);
  const content = await until(() => api.inspector().card && api.inspector().card.path === leaf.path && api.inspector().card.kind === "module" && api.inspector(), 20000);
  assert.deepEqual(content.card.details.target, { kind: "module", path: leaf.path });
  assert.ok(content.bundle && existsSync(content.bundle.file), "the Inspector has no bundle to show the module from");
  // what the page may load: pictures only, each a file below a root
  const roots = api.inspectorRoots();
  assert.ok(roots.includes(root), `the project is not a root of the Inspector: ${roots}`);
  assert.ok(roots.every((r) => r === root || r.includes("library-cache") || r.includes(`${sep}node_modules${sep}`)), `the Inspector's roots are wider than the project, its packages and the cache: ${roots}`);
  const files = [...Object.values(content.card.details.files), ...Object.values(content.card.details.previews).map((p) => p.src)];
  assert.ok(files.length > 0, "the part has no picture to show");
  for (const f of files) {
    assert.ok(roots.some((r) => f.startsWith(r + sep)), `${f} is outside the Inspector's roots`);
    assert.ok(existsSync(f), `${f} does not exist`);
  }
  assert.ok(Object.values(content.card.details.previews).some((p) => p.kind === "image" && p.src.endsWith(`part-${leaf.defId}.png`)), "the model's card does not use the exported picture");
  // the page drew it: the viewer's details, every artifact a card, the pictures loaded
  await until(() => api.inspectorDrawn() && api.inspectorDrawn().what.startsWith(`module:${leaf.path}:`) && api.inspectorDrawn().details, 60000).catch(() => assert.fail(`the Inspector's page drew ${JSON.stringify(api.inspectorDrawn())}`));
  // pictures are lazy (a card below the fold is not asked for): the page is asked to load them all, and says what came
  api.inspectorProbe();
  const drawn = await until(() => api.inspectorDrawn() && api.inspectorDrawn().what.startsWith(`module:${leaf.path}:`) && api.inspectorDrawn().loaded + api.inspectorDrawn().failed > 0 && api.inspectorDrawn(), 60000).catch(() => assert.fail(`the Inspector's page drew ${JSON.stringify(api.inspectorDrawn())}`));
  assert.ok(drawn.loaded > 0, `no picture loaded: ${JSON.stringify(drawn)}`);
  assert.equal(drawn.rows, 0, "artifacts are still plain rows");
  assert.equal(drawn.failed, 0, `${drawn.failed} pictures did not load`);
  // fewer cards than files since QA B2: a part's internal interface geometry has none, and a model in two formats is one card
  assert.ok(drawn.cards > 0 && drawn.cards <= files.length && !drawn.scrolls, `the page: ${JSON.stringify(drawn)} (${files.length} files)`);
  step(`Inspector: ${leaf.path} as the viewer shows it, ${drawn.cards} artifact cards (${drawn.loaded} pictures loaded, ${drawn.icons} icons), roots ${roots.length}`);

  // a card opens its artifact as Open Artifact does: a source file in an editor
  const local = (api.checkResult(root), require("node:fs").readFileSync(join(root, ".protoboard", "build", "resolved.json"), "utf8"));
  const art = JSON.parse(local).artifacts.find((a) => a.definition === leaf.defId && a.present === true && /\.(json|py|ts)$/.test(a.resolved || ""));
  if (art) {
    await api.inspectorOpenArtifact(leaf.defId, art.id);
    await until(() => vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath.endsWith(art.resolved.split("/").pop()), 20000);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    step(`Inspector: the card of ${art.id} opened ${art.resolved.split("/").pop()}`);
  }

  // an interface picked in the hierarchy: its own card, and it stays while the viewer selects its module
  const iface = all.find((n) => n.type === "interface" && n.path === leaf.path);
  assert.ok(iface, `${leaf.path} has no interface in the hierarchy`);
  assert.ok(api.explorerPick(iface.key));
  await until(() => api.inspector().card && api.inspector().card.kind === "interface" && api.inspector().card.path === leaf.path, 20000);
  await until(() => api.viewers()[0].selection && api.viewers()[0].selection.id === leaf.path, 20000);
  // the viewer's selection of the module has arrived by now: the interface is still what the Inspector shows
  await new Promise((ok) => setTimeout(ok, 1500));
  const ifaceCard = api.inspector().card;
  assert.equal(ifaceCard.kind, "interface", `the Inspector left the interface for ${ifaceCard.kind} ${ifaceCard.title}`);
  assert.equal(ifaceCard.subtitle, `${leaf.path}:${iface.interfaceId}`);
  // another module picked: the interface's card goes
  assert.ok(api.explorerPick(`i:${leaf.path}`));
  await until(() => api.inspector().card && api.inspector().card.kind === "module" && api.inspector().card.path === leaf.path, 20000);
  step(`Inspector: interface ${ifaceCard.subtitle} has its own card (${ifaceCard.sections.map((x) => x.title).join(", ") || "no sections"}; ${(ifaceCard.artifacts || []).length} artifacts)`);
}

async function libraryBack(api, step, webviewTabs) {
  const first = api.library().items[0];
  await api.libraryOpen(first.key, "page");
  await until(() => api.libraryPreview() && api.libraryPreview().back === "Library", 20000);
  // the Inspector shows the part picked, and the focus stays in the editor (PB-919)
  await until(() => api.inspector().card && api.inspector().card.kind === "part" && api.inspector().card.part.partId === first.partId, 20000);
  await until(() => webviewTabs("protoboard.part").length === 1 && webviewTabs("protoboard.part")[0].isActive, 10000).catch(() => assert.fail("the part's tab is not the active one"));
  // the command Alt+Left runs in a part's detail (package.json's keybinding): the same as the back control
  await vscode.commands.executeCommand("protoboard.part.back");
  await until(() => api.libraryPreview() === undefined && webviewTabs("protoboard.part").length === 0, 10000);
  await until(() => webviewTabs("protoboard.libraryPage")[0].isActive, 10000).catch(() => assert.fail("back did not bring the full library to the front"));
  step(`part ${first.partId}: back to the full library; the Inspector showed it`);
}
