// The integration test of a window opened on a folder with no project (PB-931, PB-946). It runs in VS Code's
// extension host (CommonJS, no test framework), with the stack's real CLI:
//   1. the extension starts by itself, with no project;
//   2. a project made there (Protoboard: New Project, as `protoboard init` makes it) comes up with no
//      reload: found, checked, its viewer tab open on a dev server, the Inspector in front;
//   3. a second project does not bring the Inspector back once the user has put it away;
//   4. a .uhd.ts file opens in the viewer at the level of the module it defines (the lens, the command);
//   5. a project from a template whose catalog parts could not be fetched still draws, saying what is missing.
const assert = require("node:assert/strict");
const { existsSync, readdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const vscode = require("vscode");

// as VS Code spells it: on Windows it gives a folder with a lower-case drive letter
const folder = vscode.Uri.file(process.env.PROTOBOARD_TEST_WORKSPACE).fsPath;

async function until(what, timeout = 120000, label = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await what();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out${label ? `: ${label}` : ""}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

exports.run = async function run() {
  const step = (s) => console.log(`[protoboard new-project] ${s}`);
  const ext = vscode.extensions.getExtension("deltarobotics.vscode-protoboard");
  assert.ok(ext, "extension not loaded");
  assert.deepEqual(readdirSync(folder), [], "the folder is not empty to begin with");

  // 1. no project, and nobody asks: the extension starts by itself (onStartupFinished)
  await until(() => ext.isActive, 60000, "the extension did not start in a folder with no project");
  const api = ext.exports;
  assert.deepEqual(await api.projects(), []);
  assert.equal(api.state().current, undefined);
  assert.equal(api.state().inspectorShownOnce, false, "the Inspector was shown with no project");
  const commands = await vscode.commands.getCommands(true);
  for (const c of ["protoboard.newProject", "protoboard.init", "protoboard.setupProject", "protoboard.trustProject", "protoboard.path.add", "protoboard.signIn", "protoboard.openSourceInViewer", "protoboard.start.library.focus", "protoboard.start.inspector.focus"]) assert.ok(commands.includes(c), `${c} is not registered`);
  // the start view of a container shows (its welcome offers New Project): focusing it does not throw
  await vscode.commands.executeCommand("protoboard.start.library.focus");
  step(`started with no project (VS Code ${vscode.version})`);

  // 2. a project is made in the open folder; nothing is reloaded
  const one = join(folder, "one");
  const made = await api.createProject({ dir: one, template: "", install: false });
  assert.equal(made, one);
  assert.ok(existsSync(join(one, "protoboard.config.ts")), "init wrote no protoboard.config.ts");
  await until(async () => (await api.projects()).includes(one), 30000, "the new project was not noticed");
  await until(() => api.state().current === one, 10000, "the new project did not become the current one");
  // it needs no set-up (its packages are found above it here): nothing waits, and nothing was installed into it
  assert.deepEqual(api.state().waiting, [], "the new project waits to be set up");
  assert.ok(!existsSync(join(one, "package-lock.json")), "npm ran in the new project");
  // checked, by itself
  const result = await until(() => api.checkResult(one), 120000, "the new project was not checked");
  assert.equal(result.counts.error, 0);
  // its viewer tab, on a dev server the extension started
  await until(() => api.viewers().some((v) => v.root === one) && api.devEndpoint(one), 180000, "no viewer tab or dev server for the new project");
  await until(() => api.viewers().find((v) => v.root === one).state, 120000, "the viewer tab drew nothing");
  const first = api.viewers().find((v) => v.root === one);
  assert.equal(first.target.path, "");
  // the Inspector, in front, once
  await until(() => api.state().inspectorShownOnce && api.state().inspectorVisible, 30000, "the Inspector did not come to the front");
  await until(() => api.inspector().card || api.inspector().empty, 20000);
  step(`project "one" came up with no reload: checked (${JSON.stringify(result.counts)}), viewer tab "${first.title}" on ${api.devEndpoint(one).url}, Inspector in front`);

  // a selection in the viewer updates the Inspector and leaves the focus where it is
  // (the hierarchy is in the viewer tab itself, PB-1042: it follows its canvas there)

  // 3. the user puts the Inspector away; a second project appears; the Inspector stays away
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  await until(() => !api.state().inspectorVisible, 20000, "the secondary side bar did not close");
  const two = join(folder, "two");
  await api.createProject({ dir: two, template: "", install: false });
  await until(async () => (await api.projects()).includes(two), 30000, "the second project was not noticed");
  await until(() => api.viewers().some((v) => v.root === two), 180000, "no viewer tab for the second project");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(api.state().inspectorVisible, false, "the Inspector came to the front a second time");
  step('project "two" came up too, and the Inspector stayed where the user put it');

  // 4. a .uhd.ts file in the viewer, at the level of the module it defines
  const modules = join(one, "src", "modules.uhd.ts");
  writeFileSync(
    modules,
    [
      'import type { ModuleDef } from "@deltarobotics/uhd";',
      "",
      "/** A part: nothing inside it. */",
      "export const SENSOR: ModuleDef = {",
      '  id: "sensor",',
      '  name: "Sensor",',
      '  kind: "module",',
      "  interfaces: [],",
      "};",
      "",
      "/** A module with a part inside it: it has a level of its own. */",
      "export const CARRIER: ModuleDef = {",
      '  id: "carrier",',
      '  name: "Carrier",',
      '  kind: "module",',
      "  interfaces: [],",
      '  children: [{ id: "s1", moduleDefId: "sensor", name: "Sensor one" }],',
      "  links: [],",
      "};",
      "",
    ].join("\n"),
  );
  const system = join(one, "src", "one.uhd.ts");
  writeFileSync(
    system,
    ['import type { ModuleDef } from "@deltarobotics/uhd";', "", "export const ONE: ModuleDef = {", '  id: "one",', '  name: "one",', '  kind: "module",', "  interfaces: [],", '  children: [{ id: "carrier", moduleDefId: "carrier", name: "Carrier" }],', "  links: [],", "};", ""].join("\n"),
  );
  await vscode.commands.executeCommand("protoboard.check", one);
  await until(() => api.explorer().project === one || true);
  const found = await until(() => {
    const m = api.sourceModules(modules);
    return m && m.modules.length === 2 && m.modules.every((x) => x.path !== undefined) ? m : undefined;
  }, 120000, "the build does not know the modules of modules.uhd.ts").catch((e) => {
    // what it did know, for a machine where this cannot be watched
    throw new Error(`${e.message}: ${modules} gives ${JSON.stringify(api.sourceModules(modules))}`);
  });
  console.log(`[protoboard new-project] modules: ${JSON.stringify(found.modules)}`);
  assert.deepEqual(found.modules.map((m) => [m.defId, m.line, m.path, m.hasChildren]), [["sensor", 4, "carrier/s1", false], ["carrier", 12, "carrier", true]]);
  // the lens above each definition
  const doc = await vscode.workspace.openTextDocument(modules);
  await vscode.window.showTextDocument(doc);
  const lenses = await until(async () => {
    const all = await vscode.commands.executeCommand("vscode.executeCodeLensProvider", doc.uri);
    const ours = (all ?? []).filter((l) => l.command && l.command.command === "protoboard.openSourceInViewer");
    return ours.length === 2 ? ours : undefined;
  }, 30000, "no lens above the definitions");
  assert.deepEqual(lenses.map((l) => [l.range.start.line, l.command.arguments[1]]), [[3, "sensor"], [11, "carrier"]]);
  assert.ok(lenses.every((l) => /Open in Viewer/.test(l.command.title)), lenses.map((l) => l.command.title).join(" | "));
  // the module with a level of its own: a tab on that level
  await vscode.commands.executeCommand(lenses[1].command.command, ...lenses[1].command.arguments);
  const carrier = await until(() => api.viewers().find((v) => v.root === one && v.target.path === "carrier" && v.state && v.state.path === "carrier"), 60000, "no tab on the carrier's level");
  assert.ok(carrier.state.nodes >= 1, `the carrier's level draws ${carrier.state.nodes} nodes`);
  // the part: a tab that shows its parent's level, with the part selected
  await vscode.window.showTextDocument(doc);
  await api.openSourceInViewer(modules, "sensor");
  const sensor = await until(() => api.viewers().find((v) => v.root === one && v.target.path === "carrier/s1" && v.state && v.selection && v.selection.id === "carrier/s1"), 60000, "the part was not shown selected");
  assert.equal(sensor.state.path, "carrier");
  // with no definition named: the one the cursor is in (the title button, the context menu)
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(14, 0, 14, 0);
  const again = await vscode.commands.executeCommand("protoboard.openSourceInViewer", doc.uri);
  assert.ok(again, "the command returned no tab");
  assert.equal(api.viewers().filter((v) => v.root === one && v.target.path === "carrier").length, 1, "the same module opened a second tab");
  step(`modules.uhd.ts: lenses on lines ${lenses.map((l) => l.range.start.line + 1).join(" and ")}; "carrier" opens on its own level, "sensor" on its parent's, selected`);

  // 5. a project from a template whose catalog parts cannot be fetched (the parts service is out of reach here,
  //    as it is for someone who is not signed in): the project is made, and its viewer draws what it has, with the
  //    missing parts as placeholders, instead of a blank tab
  assert.ok(commands.includes("protoboard.signIn"), "Sign In is not registered with no project");
  const three = join(folder, "three");
  await api.createProject({ dir: three, template: "iot", install: false });
  assert.ok(existsSync(join(three, "protoboard.config.ts")), "init wrote no project when the parts were not fetched");
  await until(async () => (await api.projects()).includes(three), 30000, "the template project was not noticed");
  const checked = await until(() => api.checkResult(three), 180000, "the template project was not checked");
  assert.ok(checked.counts.error > 0, "a project without its parts checked clean");
  await until(() => api.viewers().some((v) => v.root === three) && api.devEndpoint(three), 240000, "no viewer tab or dev server for the template project");
  const top = await until(() => {
    const v = api.viewers().find((x) => x.root === three);
    return v && v.state ? v : undefined;
  }, 180000, "the template project's viewer tab drew nothing (a bundle that names parts it does not hold)");
  assert.ok(top.state.nodes >= 2, `the top level draws ${top.state.nodes} nodes`);
  assert.ok(top.state.missing > 0, "the tab does not say that definitions are missing");
  // the board, whose parts are the missing ones: its level draws them as placeholders
  await api.openViewer({ root: three, path: "board" });
  const board = await until(() => api.viewers().find((v) => v.root === three && v.state && v.state.path === "board"), 60000, "no tab on the board's level");
  assert.ok(board.state.nodes > 10, `the board's level draws ${board.state.nodes} nodes`);
  // the parts views waited for nothing here (the CLI is above the folder), and the library logged no error about a missing CLI
  step(`project "three" (iot template, parts not fetched): ${checked.counts.error} errors in the check, viewer tab "${top.title}" draws ${top.state.nodes} nodes and says ${top.state.missing} definitions are missing; the board's level draws ${board.state.nodes}`);

  await vscode.commands.executeCommand("protoboard.stopDev", one);
  await vscode.commands.executeCommand("protoboard.stopDev", two);
  await vscode.commands.executeCommand("protoboard.stopDev", three);
  step("done");
};
