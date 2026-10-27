/**
 * A project made after the window opened, and a window with none (PB-931):
 * the manifest (the extension runs in every window; each container has a
 * start view that offers to create a project), the choices of Create Project,
 * and the modules a .uhd.ts file defines (Open in Protoboard Viewer, the lens).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMPTY_TEMPLATE, KNOWN_TEMPLATES, canInitIn, folderFromName, folderHolding, folderNameProblem, folderNotice, initArgs, npxCommand, npxInitCommand, onPath, partsAddArgs, partsFailure, partsNotFetchedMessage, registryRefusal, templateChoices, toolsInstallHint, vscodeBefore, withoutRunHint } from "../src/newProject.js";
import { canRun, globalCliScript, resolveCli } from "../src/cli.js";
import { npmAuthProblem } from "../../core/src/stack.js";
import { declarationLine, lensTitle, moduleAtLine, modulesInFile } from "../src/sourceModules.js";
import { indexProject, type ResolvedProject, type UhdBundle } from "../src/model.js";
import { listTemplates } from "../../core/src/init.js";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
const src = readFileSync(fileURLToPath(new URL("../src/extension.ts", import.meta.url)), "utf8");
const c = pkg.contributes;

describe("the manifest: a window with no project (PB-931)", () => {
  it("runs the extension in every window, so a protoboard.config.ts that appears later is noticed", () => {
    expect(pkg.activationEvents).toContain("onStartupFinished");
    // a window opened on a project still starts it at once
    expect(pkg.activationEvents).toContain("workspaceContains:**/protoboard.config.ts");
    // the watcher for a config created in the workspace, and what it starts
    expect(src).toContain('createFileSystemWatcher("**/protoboard.config.ts"');
    expect(src).toMatch(/watcher\.onDidCreate\(\(\) => this\.refreshRoots\(\)\)/);
    // one that appears starts; several at once (a checkout) start only the current one
    expect(src).toMatch(/if \(appeared\.length === 1 \|\| r === this\.current\) void this\.arrive\(r, true\)/);
  });

  it("gives every side bar container a start view, shown without a project or for one that is not set up, with a welcome that offers New Project or Initialize", () => {
    const starts = ["protoboard-library", "protoboard-parts", "protoboard-cloud", "protoboard-inspector"];
    const START = "protoboard.noProject || protoboard.needsSetup";
    for (const id of starts) {
      const views = c.views[id] as { id: string; when?: string; type?: string; name: string }[];
      const start = views.filter((v) => v.when === START);
      expect(start, id).toHaveLength(1);
      // a tree view: VS Code draws its welcome natively (a webview view has none)
      expect(start[0].type, id).toBeUndefined();
      expect(src, start[0].id).toContain(`"${start[0].id}"`);
      const welcomes = (c.viewsWelcome as { view: string; contents: string; when?: string }[]).filter((w) => w.view === start[0].id);
      // no project: New Project, the one command (first builds review, item 21)
      // one wording signed out (it offers the sign-in), one signed in (it does not ask for what is already done)
      const none = welcomes.filter((w) => w.when?.startsWith("protoboard.noProject && !protoboard.needsSetup"));
      expect(none.map((w) => w.when), id).toEqual(["protoboard.noProject && !protoboard.needsSetup && !protoboard.signedIn", "protoboard.noProject && !protoboard.needsSetup && protoboard.signedIn"]);
      for (const w of none) {
        expect(w.contents).toContain("(command:protoboard.newProject)");
        expect(w.contents).toMatch(/blank or from a template/i);
      }
      expect(none[1].contents).not.toMatch(/sign in/i);
      // a project that is not set up: Initialize, with no npm and no registry (D2)
      const setup = welcomes.filter((w) => w.when === "protoboard.needsSetup");
      expect(setup, id).toHaveLength(1);
      expect(setup[0].contents).toContain("(command:protoboard.setupProject)");
      expect(setup[0].contents).toBe("This project is not set up on this machine yet.\n[$(rocket) Initialize](command:protoboard.setupProject)");
      for (const w of welcomes) {
        // a welcome is plain text with links: a backtick would be drawn as one
        expect(w.contents, w.when).not.toContain("`");
        // the former command is in no welcome, and nothing tells the user to run a command
        expect(w.contents, w.when).not.toContain("protoboard.init)");
        expect(w.contents, w.when).not.toMatch(/npm install|\brun protoboard\b/i);
      }
      // every other view of the container needs a project that is set up, except Help (PB-1070: always there)
      for (const v of views.filter((x) => x !== start[0] && x.id !== "protoboard.help")) expect(v.when, v.id).toBe("protoboard.hasProject && !protoboard.needsSetup");
    }
    // the start views are the ones the extension registers
    const ids = starts.map((id) => (c.views[id] as { id: string; when?: string }[]).find((v) => v.when === START)!.id).sort();
    expect([...src.matchAll(/"(protoboard\.start\.[a-z]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort()).toEqual(ids);
    // neither context is set before the extension has looked: a project's window never flashes the start views
    expect(src).toContain('executeCommand("setContext", "protoboard.noProject", roots.length === 0)');
    expect(src).toContain('executeCommand("setContext", "protoboard.needsSetup"');
  });

  it("has one command that makes a project: New Project (Create Project is gone; first builds review, item 21)", () => {
    const commands = c.commands as { command: string; title: string }[];
    const making = commands.filter((x) => /create project|new project/i.test(x.title));
    expect(making.map((x) => [x.command, x.title])).toEqual([["protoboard.newProject", "New Project…"]]);
    expect(commands.map((x) => x.command)).not.toContain("protoboard.init");
    // nothing the manifest shows leads to the former id: menus, welcomes, the walkthrough
    expect(JSON.stringify({ menus: c.menus, viewsWelcome: c.viewsWelcome, walkthroughs: c.walkthroughs })).not.toContain("protoboard.init");
    // the id still answers for whatever calls it, with the one implementation
    expect(src).toContain('cmd("protoboard.init", (arg?: NewProjectArgs) => this.newProject(arg))');
    expect(src).toContain('cmd("protoboard.newProject", (given?: NewProjectArgs) => this.newProject(given))');
    expect(src).not.toMatch(/createProject\(arg/);
    // Initialize, the PATH offer and the tool runtimes are commands with a title
    for (const id of ["protoboard.setupProject", "protoboard.path.add", "protoboard.tools.install"]) {
      expect(commands.map((x) => x.command), id).toContain(id);
      expect(src, id).toContain(`cmd("${id}"`);
    }
  });

  it("offers New Project and Open in Protoboard Viewer where they apply", () => {
    const commands = (c.commands as { command: string; title: string; icon?: string }[]).map((x) => x.command);
    expect(commands).toContain("protoboard.newProject");
    expect(commands).toContain("protoboard.openSourceInViewer");
    for (const id of ["protoboard.newProject", "protoboard.openSourceInViewer"]) expect(src).toContain(`cmd("${id}"`);
    // New Project is in the palette whatever the window holds
    expect((c.menus.commandPalette as { command: string }[]).some((m) => m.command === "protoboard.newProject")).toBe(false);
    // a .uhd.ts file: a button in the editor's title, and entries in the editor's, the tab's and the explorer's menus
    for (const menu of ["editor/title", "editor/context", "editor/title/context", "explorer/context"]) {
      const entry = (c.menus[menu] as { command: string; when: string; group: string }[]).find((m) => m.command === "protoboard.openSourceInViewer");
      expect(entry, menu).toBeDefined();
      expect(entry!.when).toContain("resourceFilename =~ /\\.uhd\\.ts$/");
      expect(entry!.when).toContain("protoboard.hasProject");
    }
    expect(c.menus["editor/title"][0].group).toMatch(/^navigation/);
    expect((c.commands as { command: string; icon?: string }[]).find((x) => x.command === "protoboard.openSourceInViewer")!.icon).toBe("$(protoboard-logo)");
    expect(c.configuration.properties["protoboard.editor.codeLens"].default).toBe(true);
  });

  it("brings the Inspector to the front once a session, without taking the focus, unless the user put another view in front of it (PB-946, QA B3)", () => {
    expect(src).toContain('const KEY = "protoboard.inspector.shownOnce"');
    // once a session (VS Code restores Chat in front after a restart: once per workspace left it there)
    expect(src).toMatch(/if \(this\.revealedThisSession\) return;/);
    // the user's choice stays: hidden while the window is in use, it is not brought back
    expect(src).toMatch(/workspaceState\.get<boolean>\(KEY\) && this\.context\.workspaceState\.get<boolean>\(INSPECTOR_AWAY\)/);
    expect(src).toMatch(/if \(this\.disposed \|\| !vscode\.window\.state\.focused \|\| Date\.now\(\) - this\.ourReveal < 3000\) return;/);
    expect(src).toContain("executeCommand(`${InspectorViewProvider.id}.focus`, { preserveFocus: true })");
    // a selection in the viewer updates the card and never reveals or focuses a view
    const fromViewer = src.slice(src.indexOf('case "uhd-viewer:selectionChanged"'), src.indexOf('case "uhd-viewer:openSource"'));
    expect(fromViewer).toContain("this.showInspector()");
    expect(fromViewer).not.toMatch(/\.focus\b|workbench\.view|executeCommand|\.show\(/);
    // the hierarchy is the tab's own (PB-1042): it follows its canvas there, with no message from the extension
    expect(fromViewer).not.toContain("revealInHierarchy");
    expect(src).not.toContain("createTreeView");
  });
});

describe("Create Project: the choices", () => {
  it("offers the empty project first, then the templates the CLI lists, else the ones the stack ships", () => {
    expect(templateChoices()[0]).toBe(EMPTY_TEMPLATE);
    expect(templateChoices("not json").slice(1)).toEqual(KNOWN_TEMPLATES);
    expect(templateChoices(JSON.stringify({ templates: [] })).slice(1)).toEqual(KNOWN_TEMPLATES);
    const listed = templateChoices(JSON.stringify({ templates: [{ id: "rover", title: "Rover", description: "Four wheels", extensions: [] }, { id: "../x", title: "bad" }, { title: "no id" }] }));
    expect(listed.map((t) => t.id)).toEqual(["", "rover"]);
    expect(listed[1]).toEqual({ id: "rover", title: "Rover", description: "Four wheels" });
  });

  it("knows the templates the stack ships (the fallback list is the CLI's)", () => {
    expect(KNOWN_TEMPLATES.map((t) => t.id).sort()).toEqual(listTemplates().map((t) => t.id).sort());
    for (const t of listTemplates()) expect(KNOWN_TEMPLATES.find((k) => k.id === t.id)!.title, t.id).toBe(t.title);
  });

  it("builds the init command, and the npx one for a machine with no CLI yet", () => {
    expect(initArgs("/w/bottle", "iot")).toEqual(["init", "/w/bottle", "--template", "iot", "--format", "json"]);
    expect(initArgs("/w/bottle", "")).toEqual(["init", "/w/bottle", "--format", "json"]);
    // a name that is not the folder's
    expect(initArgs("/w/bottle", "iot", true, "Smart Bottle")).toEqual(["init", "/w/bottle", "--template", "iot", "--name", "Smart Bottle", "--format", "json"]);
    expect(folderFromName("Smart Bottle v2!")).toBe("smart-bottle-v2");
    expect(folderFromName("—")).toBe("");
    // blank is the default: first, and called that
    expect(EMPTY_TEMPLATE.title).toBe("Blank project");
    expect(npxInitCommand("0.1.3", ".", "iot", "darwin")).toBe("npx --yes @protoboardai/cli@0.1.3 init . --template iot");
    expect(npxInitCommand("0.1.3", ".", undefined, "linux")).toBe("npx --yes @protoboardai/cli@0.1.3 init .");
    expect(npxInitCommand("0.1.3", "my project", "iot", "darwin")).toBe("npx --yes @protoboardai/cli@0.1.3 init 'my project' --template iot");
    expect(npxInitCommand("0.1.3", "my project", "iot", "win32")).toBe("npx --yes @protoboardai/cli@0.1.3 init 'my project' --template iot");
    expect(npxInitCommand("0.1.3", "it's", undefined, "win32")).toBe("npx --yes @protoboardai/cli@0.1.3 init 'it''s'");
    // the stack's scope, and the version of this extension
    expect(npxInitCommand("0.1.3", ".").split(" ")[2]).toBe("@protoboardai/cli@0.1.3");
  });

  it("makes a project only in a folder that is empty or new", () => {
    const fs: Record<string, string[]> = { "/w": ["a.txt"], "/w/empty": [], "/w/git": [".git"] };
    const exists = (d: string) => d in fs;
    const list = (d: string) => fs[d];
    expect(canInitIn("/w", list, exists)).toBe(false);
    expect(canInitIn("/w/empty", list, exists)).toBe(true);
    expect(canInitIn("/w/new", list, exists)).toBe(true);
    // a folder with only .git in it is not empty to `protoboard init`
    expect(canInitIn("/w/git", list, exists)).toBe(false);
    const can = (d: string) => canInitIn(d.split("\\").join("/"), list, exists);
    expect(folderNameProblem("bottle", "/w", can)).toBeUndefined();
    expect(folderNameProblem("  ", "/w", can)).toMatch(/name/);
    expect(folderNameProblem("a/b", "/w", can)).toBeDefined();
    expect(folderNameProblem("a:b", "/w", can)).toBeDefined();
    expect(folderNameProblem(".hidden", "/w", can)).toBeDefined();
    expect(folderNameProblem("trailing.", "/w", can)).toBeDefined();
    expect(folderNameProblem("NUL", "/w", can)).toMatch(/Windows/);
    expect(folderNameProblem("com1.txt", "/w", can)).toMatch(/Windows/);
  });

  it("tells a folder inside the workspace from one outside, as the platform's file system compares names", () => {
    expect(folderHolding("/w/proj/bottle", ["/w/proj"], "linux")).toBe("/w/proj");
    expect(folderHolding("/w/proj", ["/w/proj"], "linux")).toBe("/w/proj");
    expect(folderHolding("/w/project2", ["/w/proj"], "linux")).toBeUndefined();
    expect(folderHolding("/w/Proj/bottle", ["/w/proj"], "linux")).toBeUndefined();
    // macOS and Windows file systems do not tell case apart
    expect(folderHolding("/w/Proj/bottle", ["/w/proj"], "darwin")).toBe("/w/proj");
    expect(folderHolding("/elsewhere", ["/w/proj"], "darwin")).toBeUndefined();
  });

  it("finds a command on PATH: `protoboard`, or its .cmd shim on Windows", () => {
    const has = (files: string[]) => (p: string) => files.includes(p);
    expect(onPath("protoboard", { PATH: "/usr/bin:/opt/homebrew/bin" }, "darwin", has(["/opt/homebrew/bin/protoboard"]))).toBe(true);
    expect(onPath("protoboard", { PATH: "/usr/bin:/opt/homebrew/bin/" }, "darwin", has(["/opt/homebrew/bin/protoboard"]))).toBe(true);
    expect(onPath("protoboard", { PATH: "/usr/bin" }, "darwin", has(["/opt/homebrew/bin/protoboard"]))).toBe(false);
    expect(onPath("protoboard", { Path: "C:\\Windows;C:\\Users\\m\\AppData\\Roaming\\npm" }, "win32", has(["C:\\Users\\m\\AppData\\Roaming\\npm\\protoboard.cmd"]))).toBe(true);
    expect(onPath("protoboard", { Path: "C:\\Windows" }, "win32", has([]))).toBe(false);
    expect(onPath("protoboard", {}, "linux", has([]))).toBe(false);
  });
});

describe("a template whose parts were not fetched, and signing in before there is a project (PB-931)", () => {
  it("offers Sign In with no project: in the palette, and in every start view's welcome", () => {
    const palette = c.menus.commandPalette as { command: string; when: string }[];
    expect(palette.find((m) => m.command === "protoboard.signIn")!.when).toBe("!protoboard.signedIn");
    // the account is in the palette in every window (PB-929: the extension starts with VS Code)
    expect(palette.find((m) => m.command === "protoboard.account")).toBeUndefined();
    for (const w of (c.viewsWelcome as { view: string; contents: string; when?: string }[]).filter((w) => w.view.startsWith("protoboard.start.") && w.when === "protoboard.noProject && !protoboard.needsSetup && !protoboard.signedIn")) expect(w.contents, w.view).toContain("(command:protoboard.signIn)");
    // signing in with no project: any CLI the window can run (the carried stack first), else the scoped package through npm
    expect(src).toContain("npxCommand(String(this.context.extension.packageJSON.version), args)");
  });

  it("runs any CLI command through npm by the scoped name and this version", () => {
    expect(npxCommand("0.1.3", ["login"], "darwin")).toBe("npx --yes @protoboardai/cli@0.1.3 login");
    expect(npxCommand("0.1.3", ["login"], "win32")).toBe("npx --yes @protoboardai/cli@0.1.3 login");
  });

  it("takes only a parts-add command with part references from what init printed", () => {
    expect(partsAddArgs("protoboard parts add espressif-esp32-c3-mini-1-h4x@3 ti-tps63020dsjr@3")).toEqual(["parts", "add", "espressif-esp32-c3-mini-1-h4x@3", "ti-tps63020dsjr@3"]);
    expect(partsAddArgs("  protoboard parts add a ")).toEqual(["parts", "add", "a"]);
    expect(partsAddArgs("protoboard parts add")).toBeUndefined();
    expect(partsAddArgs("protoboard parts add a; rm -rf .")).toBeUndefined();
    expect(partsAddArgs("protoboard parts add --registry http://x a")).toBeUndefined();
    expect(partsAddArgs("protoboard release")).toBeUndefined();
    expect(partsAddArgs("npx evil parts add a")).toBeUndefined();
    expect(partsAddArgs(undefined)).toBeUndefined();
  });

  it("says what happened and offers the way out as buttons, not a command to type (item 28)", () => {
    const m = partsNotFetchedMessage("the service was not reached.", "protoboard parts add a@3 b@3");
    expect(m).toContain("placeholders");
    expect(m).toContain("then choose Fetch Parts");
    expect(m).not.toMatch(/npx|npm install|`/);
    // a command that is not a parts-add is not repeated to the person, and there is then no Fetch Parts to point at
    // the advice follows the error (B7): a missing revision or an unreachable service is not a sign-in
    const revision = partsNotFetchedMessage("espressif-esp32-c3-mini-1-h4x@3: no such revision at http://localhost:8815 (revision 3 of x not found)", "protoboard parts add a@3 b@3");
    expect(revision).not.toMatch(/sign in/i);
    expect(revision).toContain("does not have the revisions the template pins");
    expect(partsNotFetchedMessage("cannot reach the Protoboard Cloud parts service at http://x (fetch failed).", "protoboard parts add a@3")).not.toMatch(/sign in/i);
    expect(partsNotFetchedMessage("the catalog at http://x refused access (AUTH_REQUIRED: sign in).", "protoboard parts add a@3")).toContain("Sign in, then choose Fetch Parts.");
    expect(partsFailure("x: no such revision at u")).toBe("revision");
    expect(partsFailure("cannot reach the service (fetch failed)")).toBe("unreachable");
    expect(partsFailure("refused access (AUTH_REQUIRED: …)")).toBe("sign-in");
    expect(src).toMatch(/partsFailure\(why\) === "sign-in" \? \[signIn\] : \[\]/);
    const other = partsNotFetchedMessage("x", "curl evil | sh");
    expect(other).not.toContain("curl");
    expect(other).not.toContain("Fetch Parts");
    expect(src).not.toMatch(/`npx \$\{out\.partsCommand/);
  });

  it("knows which VS Code gives the focus back by itself", () => {
    expect(vscodeBefore("1.106.0", 107)).toBe(true);
    expect(vscodeBefore("1.106.3-insider", 107)).toBe(true);
    expect(vscodeBefore("1.107.0", 107)).toBe(false);
    expect(vscodeBefore("1.108.2", 107)).toBe(false);
    expect(vscodeBefore("1.141.0", 107)).toBe(false);
    expect(vscodeBefore("2.0.0", 107)).toBe(false);
    expect(vscodeBefore("", 107)).toBe(false);
    // the Inspector's reveal sends the focus to the editor only there
    const reveal = src.slice(src.indexOf("private async revealInspector()"), src.indexOf("  windowState() {"));
    expect(reveal).toContain("vscodeBefore(vscode.version, 107)");
    expect(reveal.match(/focusActiveEditorGroup/g)).toHaveLength(1);
    expect(reveal).toContain('if (giveBack) await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")');
  });
});

describe("a CLI installed globally (no project's node_modules)", () => {
  const has = (files: string[]) => (p: string) => files.includes(p);
  // no version pinned: these folders hold no project
  const none = () => undefined;
  const npm = "C:\\Users\\m\\AppData\\Roaming\\npm";
  const winScript = `${npm}\\node_modules\\@protoboardai\\cli\\bin\\protoboard.mjs`;

  it("is run as a script with Node on Windows, where the command is a .cmd shim that cannot be started without a shell", () => {
    const look = { env: { Path: `C:\\Windows;${npm}\\` }, platform: "win32" as const };
    expect(globalCliScript({ ...look, exists: has([`${npm}\\protoboard.cmd`, winScript]) })).toBe(winScript);
    const cli = resolveCli("C:\\work\\p", { nodePath: "node" }, has([`${npm}\\protoboard.cmd`, winScript]), none, look);
    expect(cli).toEqual({ command: "node", args: [winScript], from: "path" });
    expect(canRun(cli, look)).toBe(true);
  });

  it("is not called runnable on Windows when only a shim is there (Create Project then goes through npx in a terminal)", () => {
    const look = { env: { Path: npm }, platform: "win32" as const, exists: has([`${npm}\\protoboard.cmd`]) };
    expect(globalCliScript(look)).toBeUndefined();
    const cli = resolveCli("C:\\work\\p", {}, look.exists, none, look);
    // nothing this window can start: no CLI (PB-929's order ends in "none")
    expect(cli).toEqual({ command: "protoboard", args: [], from: "none" });
    expect(canRun(cli, look)).toBe(false);
    // an .exe of that name is a command the system starts
    const exe = has([`${npm}\\protoboard.exe`]);
    expect(resolveCli("C:\\work\\p", {}, exe, none, { env: look.env, platform: look.platform })).toEqual({ command: "protoboard", args: [], from: "path" });
    expect(canRun({ command: "protoboard", args: [], from: "path" }, { ...look, exists: exe })).toBe(true);
  });

  it("is run as a script with Node on macOS and Linux too: the link on PATH leads to it", () => {
    const script = "/opt/homebrew/lib/node_modules/@protoboardai/cli/bin/protoboard.mjs";
    const look = { env: { PATH: "/usr/bin:/opt/homebrew/bin" }, platform: "darwin" as const, realpath: (p: string) => (p === "/opt/homebrew/bin/protoboard" ? script : p) };
    const exists = has(["/opt/homebrew/bin/protoboard", script]);
    expect(resolveCli("/Users/m/p", { nodePath: "/opt/homebrew/bin/node" }, exists, none, look)).toEqual({ command: "/opt/homebrew/bin/node", args: [script], from: "path" });
    // another package manager's shim is run as the command it is
    const shim = { ...look, realpath: () => "/Users/m/.volta/bin/volta-shim" };
    expect(resolveCli("/Users/m/p", {}, exists, none, shim)).toEqual({ command: "protoboard", args: [], from: "path" });
    expect(canRun({ command: "protoboard", args: [], from: "path" }, { ...shim, exists })).toBe(true);
    // a link that leads nowhere
    expect(globalCliScript({ ...look, exists, realpath: () => { throw new Error("ENOENT"); } })).toBeUndefined();
    expect(canRun({ command: "protoboard", args: [], from: "path" }, { env: { PATH: "/usr/bin" }, platform: "linux", exists: has([]) })).toBe(false);
  });

  it("leaves a project's own CLI and the setting alone", () => {
    expect(canRun({ command: "node", args: ["/p/node_modules/@protoboardai/cli/bin/protoboard.mjs"], from: "project" }, { env: {}, platform: "win32", exists: () => false })).toBe(true);
    expect(canRun({ command: "protoboard-dev", args: [], from: "setting" }, { env: {}, platform: "win32", exists: () => false })).toBe(true);
  });
});

describe("the modules a .uhd.ts file defines", () => {
  const def = (id: string, file: string, line: number | undefined, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), kind: "module", origin: { kind: "project", tier: "project-specific" as const, source: { file, ...(line ? { line } : {}) }, ...extra } });
  const resolved = {
    schema: "protoboard.resolved/v0",
    project: { name: "iot", root: "iot" },
    definitions: [
      def("iot", "src/system.uhd.ts", 12),
      def("main-board", "src/boards/main/main.uhd.ts", 64),
      def("battery-pads", "src/boards/main/pads.uhd.ts", 5),
      def("test-pad", "src/boards/main/pads.uhd.ts", 30),
      def("spare", "src/boards/main/pads.uhd.ts", 50),
      // a library part: pinned as JSON, written in the .uhd.ts beside it
      { ...def("esp32", "parts/catalog/esp32/esp32.json", undefined), origin: { kind: "catalog", tier: "catalog" as const, source: { file: "parts/catalog/esp32/esp32.json" }, definitionSource: { file: "parts/catalog/esp32/esp32.uhd.ts", line: 9 } } },
    ],
    instances: [
      { path: "", definition: "iot", kind: "module", quantity: 1 },
      { path: "board", definition: "main-board", kind: "module", quantity: 1, parent: "" },
      { path: "board/jbat", definition: "battery-pads", kind: "module", quantity: 1, parent: "board" },
      { path: "board/tp_en", definition: "test-pad", kind: "module", quantity: 1, parent: "board" },
      { path: "board/tp_boot", definition: "test-pad", kind: "module", quantity: 1, parent: "board" },
      { path: "board/u1", definition: "esp32", kind: "module", quantity: 1, parent: "board" },
    ],
    links: [],
    artifacts: [],
    checks: [],
    diagnostics: [],
  } as unknown as ResolvedProject;
  const bundle = {
    root: "iot",
    definitions: [
      { id: "iot", children: [{ id: "board", moduleDefId: "main-board" }] },
      { id: "main-board", children: [{ id: "jbat", moduleDefId: "battery-pads" }, { id: "tp_en", moduleDefId: "test-pad" }, { id: "tp_boot", moduleDefId: "test-pad" }, { id: "u1", moduleDefId: "esp32" }] },
      { id: "battery-pads" },
      { id: "test-pad" },
      { id: "spare" },
      { id: "esp32" },
    ],
  } as UhdBundle;
  const index = indexProject(resolved, bundle);

  it("lists them top to bottom, each with the instance to open and whether it has a level of its own", () => {
    expect(modulesInFile(index, "src/system.uhd.ts")).toEqual([{ defId: "iot", name: "IOT", line: 12, path: "", uses: 1, hasChildren: true }]);
    expect(modulesInFile(index, "src/boards/main/main.uhd.ts")).toEqual([{ defId: "main-board", name: "MAIN-BOARD", line: 64, path: "board", uses: 1, hasChildren: true }]);
    const pads = modulesInFile(index, "src/boards/main/pads.uhd.ts");
    expect(pads.map((m) => [m.defId, m.line, m.path, m.uses, m.hasChildren])).toEqual([
      ["battery-pads", 5, "board/jbat", 1, false],
      ["test-pad", 30, "board/tp_boot", 2, false],
      // defined, but nothing uses it: no instance to show
      ["spare", 50, undefined, 0, false],
    ]);
    expect(modulesInFile(index, "src/other.uhd.ts")).toEqual([]);
    // a library part's readable source
    expect(modulesInFile(index, "parts/catalog/esp32/esp32.uhd.ts").map((m) => [m.defId, m.line, m.path])).toEqual([["esp32", 9, "board/u1"]]);
  });

  it("keeps a lens on its definition when the file was edited since the build", () => {
    const before = ["// pads", "", "", "", 'export const batteryPads = module({ id: "battery-pads" });'].join("\n");
    expect(modulesInFile(index, "src/boards/main/pads.uhd.ts", before)[0]).toMatchObject({ defId: "battery-pads", line: 5 });
    // ten lines added above: the recorded line no longer names it
    const after = `${"// note\n".repeat(10)}${before}`;
    const moved = modulesInFile(index, "src/boards/main/pads.uhd.ts", after).find((m) => m.defId === "battery-pads")!;
    expect(moved.line).toBe(15);
    // a definition the text no longer names stays within the file
    for (const m of modulesInFile(index, "src/boards/main/pads.uhd.ts", after)) expect(m.line).toBeLessThanOrEqual(after.split("\n").length);
  });

  it("puts the lens on the line the definition starts on, above its id", () => {
    const text = ["", "", "", "/** pads */", "export const BATTERY_PADS: ModuleDef = {", '  id: "battery-pads",', '  name: "Pads",', "};"].join("\n");
    // the build records the id's line (6); the declaration is the line above
    const moved = indexProject({ ...resolved, definitions: resolved.definitions.map((d) => (d.id === "battery-pads" ? { ...d, origin: { ...d.origin, source: { file: d.origin.source.file, line: 6 } } } : d)) } as ResolvedProject, bundle);
    expect(modulesInFile(moved, "src/boards/main/pads.uhd.ts", text).find((m) => m.defId === "battery-pads")!.line).toBe(5);
    expect(declarationLine(["const a = module({", "  kind: 1,", '  id: "x",'], 3)).toBe(1);
    expect(declarationLine(["export default {", '  id: "x",'], 2)).toBe(1);
    expect(declarationLine(["foo(", "bar,", "baz,", '  id: "x",'], 4)).toBe(4);
    expect(declarationLine(['  id: "x",'], 1)).toBe(1);
  });

  it("picks the module the cursor is in, and the instance that is selected now", () => {
    const pads = modulesInFile(index, "src/boards/main/pads.uhd.ts");
    expect(moduleAtLine(index, pads, 1)!.defId).toBe("battery-pads");
    expect(moduleAtLine(index, pads, 29)!.defId).toBe("battery-pads");
    expect(moduleAtLine(index, pads, 30)!.defId).toBe("test-pad");
    expect(moduleAtLine(index, pads, 45)!.path).toBe("board/tp_boot");
    expect(moduleAtLine(index, pads, 45, "board/tp_en")!.path).toBe("board/tp_en");
    expect(moduleAtLine(index, pads, 45, "board/u1")!.path).toBe("board/tp_boot");
    expect(moduleAtLine(index, [], 3)).toBeUndefined();
  });

  it("says on the lens what a click does", () => {
    const [pads, testPad, spare] = modulesInFile(index, "src/boards/main/pads.uhd.ts");
    expect(lensTitle(pads)).toBe("$(open-preview) Open in Viewer");
    expect(lensTitle(testPad)).toBe("$(open-preview) Open in Viewer (2 uses)");
    expect(lensTitle(spare)).toBe("$(circle-slash) Not in the system yet");
  });
});

describe("the one notification a window gives unasked (first builds review, D2 and item 6)", () => {
  const never = () => false;
  it("an empty folder is offered a project, once", () => {
    const empty = (d: string) => d === "/w/empty";
    expect(folderNotice({ folders: ["/w/empty"], roots: [], needsSetup: never, empty, told: never })).toEqual({ kind: "empty", folder: "/w/empty" });
    expect(folderNotice({ folders: ["/w/empty"], roots: [], needsSetup: never, empty, told: (k) => k === "empty:/w/empty" })).toEqual({ kind: "none" });
  });

  it("a Protoboard project that is not set up is offered Initialize, once", () => {
    const needsSetup = (r: string) => r === "/w/field-board";
    expect(folderNotice({ folders: ["/w/field-board"], roots: ["/w/field-board"], needsSetup, told: never })).toEqual({ kind: "needs-setup", root: "/w/field-board" });
    expect(folderNotice({ folders: ["/w/field-board"], roots: ["/w/field-board"], needsSetup, told: (k) => k === "setup:/w/field-board" })).toEqual({ kind: "none" });
  });

  it("nothing anywhere else: no folder, someone's code, a project that is set up, several folders", () => {
    expect(folderNotice({ folders: [], roots: [], needsSetup: never, empty: () => true, told: never })).toEqual({ kind: "none" });
    expect(folderNotice({ folders: ["/w/their-code"], roots: [], needsSetup: never, empty: never, told: never })).toEqual({ kind: "none" });
    expect(folderNotice({ folders: ["/w/drone"], roots: ["/w/drone"], needsSetup: never, empty: never, told: never })).toEqual({ kind: "none" });
    expect(folderNotice({ folders: ["/w/a", "/w/b"], roots: [], needsSetup: never, empty: () => true, told: never })).toEqual({ kind: "none" });
  });

  it("is given by one place in the extension, and at most once per window", () => {
    // the only unasked project notices are the two of giveNotice, behind `noticed`
    expect(src.match(/is not set up on this machine yet\.`, init\)/g)).toHaveLength(1);
    expect(src.match(/this folder is empty\. Start a Protoboard project in it\?/g)).toHaveLength(1);
    expect(src).toMatch(/private giveNotice\(roots: string\[\]\) \{\n\s+if \(this\.noticed\) return;/);
    // what it replaces is gone: the request to run npm install, and a terminal that ran it
    expect(src).not.toMatch(/needs its packages before it can be checked/);
    expect(src).not.toMatch(/sendText\("npm install"\)/);
    expect(src).not.toMatch(/Run npm install/);
  });
});

describe("buttons, not commands (first builds review, item 28)", () => {
  it("finds the runtime a CLI message says to install, and takes the instruction out of what is shown", () => {
    const m = "frame: the CAD runtime is not installed; run `protoboard tools install cad`";
    expect(toolsInstallHint(m)).toBe("cad");
    expect(withoutRunHint(m)).toBe("frame: the CAD runtime is not installed");
    expect(toolsInstallHint("installed with other pins; run `protoboard tools install circuit`")).toBe("circuit");
    expect(toolsInstallHint("protoboard build failed")).toBeUndefined();
  });

  it("npm refused by the registry: the cause, with the pass renewed and the no-npm set-up as buttons (item 26)", () => {
    const beta = `npm install in /home/ada/.protoboard/stack/0.1.4 was refused by the registry. ${npmAuthProblem("npm error code E403\nnpm error 403 Forbidden - GET https://us-central1-npm.pkg.dev/x")}`;
    const r = registryRefusal(beta)!;
    expect(r.renew).toBe('npx google-artifactregistry-auth --repo-config="$HOME/.npmrc" --credential-config="$HOME/.npmrc"');
    expect(r.text).toContain("the registry pass ran out (it lasts one hour)");
    expect(r.text).toContain("Renew Registry Pass gets a new one");
    expect(r.text).not.toMatch(/`|run this again|protoboard setup/);
    const other = registryRefusal(`npm view was refused by the registry. ${npmAuthProblem("npm error code E401")}`)!;
    expect(other.renew).toBeUndefined();
    expect(other.text).not.toMatch(/`|run this again/);
    expect(registryRefusal("protoboard build failed")).toBeUndefined();
    expect(src).toContain('"Initialize Without npm"');
    expect(src).toContain('"Renew Registry Pass"');
  });

  it("no message of the extension tells the user to run a command", () => {
    const dir = fileURLToPath(new URL("../src/", import.meta.url));
    const told: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const lines = readFileSync(join(dir, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.trim();
        // comments describe the code; the one pattern that recognises such an instruction (to remove it) is not one
        if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*") || code.includes(".replace(/")) return;
        if (/\b[Rr]un `|\brun npm install\b|`npm install`|`npx |\bwhich node\b/.test(code)) told.push(`${file}:${i + 1}: ${code.slice(0, 140)}`);
      });
    }
    expect(told).toEqual([]);
    // nor the walkthrough's pages
    for (const page of ["new-project.md", "terminal.md", "sign-in.md", "viewer.md"]) expect(readFileSync(fileURLToPath(new URL(`../media/walkthrough/${page}`, import.meta.url)), "utf8"), page).not.toMatch(/\b[Rr]un `npm install`|after `npm install`/);
    // the CAD runtime and the agents are buttons: a command with progress, offered where a failure names it
    expect(src).toContain('executeCommand("protoboard.tools.install", runtime)');
    expect(src).toContain('["tools", "install", id, "--format", "json"]');
    expect(src).toContain('cmd("protoboard.agents.connect"');
  });
});
