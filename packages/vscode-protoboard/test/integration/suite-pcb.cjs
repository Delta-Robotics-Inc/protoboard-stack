// The integration test of a routed board's PCB tab (PB-1018), in VS Code's extension host (CommonJS, no test
// framework), with the stack's real CLI, on the wearable watch example:
//   1. the board offers its PCB and schematic tabs, and the PCB tab opens on the board as the provider routed it
//      (circuit.json, which the board carries as an artifact, is served to the tab);
//   2. a component of the board picked (as the PCB tab picks it) shows in the Inspector its reference, part,
//      footprint, side and place on the board.
// What the tab draws (layers, a net, a component, findings, zoom, the far side) is checked and captured in the
// tab's own page by test/visual/capture.ts --only pcb.
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const vscode = require("vscode");

const root = vscode.Uri.file(process.env.PROTOBOARD_TEST_WORKSPACE).fsPath;

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
  const step = (s) => console.log(`[protoboard pcb] ${s}`);
  const ext = vscode.extensions.getExtension("deltarobotics.vscode-protoboard");
  assert.ok(ext, "extension not loaded");
  const api = await ext.activate();
  assert.deepEqual(await api.projects(), [root]);
  await vscode.commands.executeCommand("protoboard.check", root);
  const result = await until(() => api.checkResult(root), 300000, "no check result");
  step(`check: ${JSON.stringify(result.counts)}`);

  // the board: the module whose definition carries the routed result
  const all = [];
  const walk = (n) => (all.push(n), n.children.forEach(walk));
  api.explorer().roots.forEach(walk);
  const board = all.find((n) => n.type === "instance" && n.defId === "watch-main-board");
  assert.ok(board, "no watch-main-board in the hierarchy");
  const u1 = board.children.find((n) => n.type === "instance" && n.path === `${board.path}/u1`);
  assert.ok(u1, `no u1 below ${board.path}`);

  // 1. its PCB tab, on the routed board
  await api.openViewer({ root, path: board.path, view: "pcb" });
  const tab = await until(() => api.viewers().find((v) => v.target.path === board.path && v.state && v.state.view === "pcb"), 240000, "the PCB tab did not open");
  assert.ok(tab.state.views.some((v) => v.id === "pcb") && tab.state.views.some((v) => v.id === "schematic"), `views: ${JSON.stringify(tab.state.views)}`);
  const endpoint = api.devEndpoint(root);
  assert.ok(endpoint && endpoint.url, "no dev server");
  // what the tab fetches: the board's routed result and its name map, served as artifacts of the board
  const bundle = await (await fetch(new URL("/uhd-bundle.json", endpoint.url))).json();
  const base = bundle.artifactBases && bundle.artifactBases["watch-main-board"];
  assert.ok(base, "the board has no artifact base in the served bundle");
  for (const f of ["src/boards/watch-main/tscircuit/circuit.json", "src/boards/watch-main/tscircuit/build.json"]) {
    const r = await fetch(`${base}/${f}`);
    assert.equal(r.status, 200, `${f} is not served to the tab (${r.status})`);
  }
  const cj = await (await fetch(`${base}/src/boards/watch-main/tscircuit/circuit.json`)).json();
  assert.ok(Array.isArray(cj) && cj.some((e) => e.type === "pcb_trace"), "the served circuit.json holds no routed traces");
  step(`PCB tab "${tab.title}" on ${board.path}: the routed board (${cj.filter((e) => e.type === "pcb_trace").length} traces) is served to it`);

  // 2. a component picked: the Inspector says where it is on the board
  await vscode.commands.executeCommand("protoboard.explorer.focus", u1);
  const card = await until(() => api.inspector().card && api.inspector().card.path === u1.path && api.inspector().card, 30000, "the Inspector did not show u1");
  const section = card.sections.find((s) => s.title === "On the board");
  assert.ok(section, `no "On the board" section: ${card.sections.map((s) => s.title)}`);
  const rows = Object.fromEntries(section.rows.map((r) => [r.label, r.detail]));
  assert.equal(rows.Reference, "U1");
  assert.ok(rows.Footprint && rows.Part && rows.Side && rows.Position, JSON.stringify(rows));
  step(`Inspector on ${u1.path}: ${section.rows.map((r) => `${r.label} ${r.detail}`).join(", ")}`);

  await vscode.commands.executeCommand("protoboard.stopDev", root);
  await until(() => !existsSync(join(root, ".protoboard", "local", "dev.json")), 30000);
  await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === "protoboard.viewer"));
  step("dev server stopped");
};
