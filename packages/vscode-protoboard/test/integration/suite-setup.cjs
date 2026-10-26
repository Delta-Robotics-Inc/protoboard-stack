// The integration test of a window opened on a Protoboard project that is not set up, by someone who is signed
// out (first builds review, D1, D2, D5, items 23 and 24). It runs in VS Code's extension host (CommonJS, no test
// framework), with the stack's real CLI from a stand-in copy "installed for the user" (run-setup.mjs):
//   1. the extension starts; the project is found, is not set up, and nothing was installed or linked unasked;
//   2. the sign-in is asked of the service the project's file names, not of localhost, though the project cannot
//      load; the library cannot be used (the service does not answer), and the Library's page is told so;
//   3. Initialize sets the project up with no npm and no registry: links to the user's copy;
//   4. signed out, everything local runs (PB-928): the project is checked, the dev server starts, the canvas draws.
const assert = require("node:assert/strict");
const { existsSync, lstatSync } = require("node:fs");
const { join } = require("node:path");
const vscode = require("vscode");

// as VS Code spells it: on Windows it gives a folder with a lower-case drive letter
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
  const step = (s) => console.log(`[protoboard set-up] ${s}`);
  const ext = vscode.extensions.getExtension("deltarobotics.vscode-protoboard");
  assert.ok(ext, "extension not loaded");
  await until(() => ext.isActive, 60000, "the extension did not start");
  const api = ext.exports;

  // 1. found, and not set up; nothing was put into it
  await until(async () => (await api.projects()).includes(root), 30000, "the project was not found");
  await until(() => api.state().waiting.includes(root), 30000, "the project is not shown as waiting to be set up");
  assert.ok(!existsSync(join(root, "node_modules")), "something was put into the project's node_modules before the user asked");
  const cli = api.cliOf(root);
  assert.notEqual(cli.from, "project", `the project has no CLI of its own: ${JSON.stringify(cli)}`);
  assert.notEqual(cli.from, "none", "no CLI was found for the window (the stand-in copy in PROTOBOARD_HOME)");
  const commands = await vscode.commands.getCommands(true);
  for (const c of ["protoboard.setupProject", "protoboard.newProject", "protoboard.signIn", "protoboard.start.inspector.focus"]) assert.ok(commands.includes(c), `${c} is not registered`);
  // the start view (its welcome offers Initialize) is the one shown: focusing it does not throw
  await vscode.commands.executeCommand("protoboard.start.inspector.focus");
  step(`the project is found and is not set up (the CLI is ${cli.from}); its node_modules does not exist`);

  // 2. signed out, asked of the right service; the Library's page is told; nothing of the project ran
  await until(() => api.lock().reason !== "checking", 60000, "the sign-in was never checked");
  const lock = api.lock();
  assert.equal(lock.locked, true, `the library is usable with no service: ${JSON.stringify(lock)}`);
  const status = api.accountStatus();
  assert.ok(!/localhost:8787/.test(status.tooltip), `the sign-in was asked of localhost: ${status.tooltip}`);
  assert.ok(/127\.0\.0\.1:9/.test(status.tooltip) || lock.reason === "unreachable", `the sign-in was not asked of the service the project's file names: ${status.tooltip} (${lock.reason})`);
  assert.equal(api.access().signedOut, true);
  assert.equal(api.access().reason, lock.reason);
  assert.ok(!existsSync(join(root, "node_modules")), "asking who is signed in put packages into the project");
  step(`signed out (${lock.reason}), asked of the service the project's file names though the project cannot load; status bar: ${status.text}`);

  // 3. Initialize: no npm, no registry
  assert.equal(await api.setupProject(root), true, "Initialize did not set the project up");
  for (const name of ["@protoboardai/core", "@protoboardai/cli", "@deltarobotics/uhd"]) assert.ok(lstatSync(join(root, "node_modules", ...name.split("/"))).isSymbolicLink(), `${name} is not a link`);
  assert.ok(!existsSync(join(root, "package-lock.json")), "npm ran in the project");
  await until(() => !api.state().waiting.includes(root), 20000, "the project still waits after Initialize");
  assert.equal(api.cliOf(root).from, "project", "the project does not run its own (linked) CLI after Initialize");
  step("Initialize set the project up: its packages are links to the user's copy, and npm did not run");

  // 4. signed out, with the library out of reach, everything local runs (PB-928): the viewer tab, the check, the dev server
  const result = await until(() => api.checkResult(root), 180000, "the project was not checked signed out");
  assert.equal(result.counts.error, 0, JSON.stringify(result.counts));
  await until(() => api.viewers().some((v) => v.root === root), 30000, "no viewer tab opened");
  await until(() => api.devEndpoint(root), 180000, "no dev server signed out");
  const tab = await until(() => {
    const v = api.viewers().find((x) => x.root === root);
    return v && v.state ? v : undefined;
  }, 180000, "the viewer tab drew nothing signed out");
  assert.equal(api.lock().locked, true, "the library's lock went without a sign-in");
  step(`signed out, the project was checked (${JSON.stringify(result.counts)}) and the tab "${tab.title}" draws from ${api.devEndpoint(root).url}`);

  // why a web address is handed to VS Code as a string (item 22): a Uri made from a link with a query does not
  // print as the same link, so the link that reaches the browser would not be the link that was made
  const link = "https://dl.example/login?callback=http%3A%2F%2F127.0.0.1%3A54329%2Fcallback&state=AbC-_123&service=https%3A%2F%2Fparts.example";
  const parsed = vscode.Uri.parse(link, true);
  assert.notEqual(parsed.toString(), link, "Uri.toString() now keeps a query as written: openWeb's reason is gone");
  assert.deepEqual([...new URLSearchParams(parsed.query).keys()], ["callback", "state", "service"], "the parsed query lost a parameter");
  step(`a link with a query does not survive Uri.parse + toString (${parsed.toString().slice(0, 60)}…): links are opened from their own text`);

  await vscode.commands.executeCommand("protoboard.stopDev", root);
  step("done");
};
