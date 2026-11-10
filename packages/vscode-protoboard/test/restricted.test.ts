/**
 * Restricted Mode (restricted.ts): in a folder VS Code does not trust the
 * extension runs nothing of Protoboard and says so, in its views and in
 * answer to its commands, with VS Code's own page as the way out. Trusting
 * the folder starts it with no reload.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const registered: string[] = [];
const trees: string[] = [];
const said: string[] = [];
let grant: (() => void) | undefined;
let tabs: { label: string; input: unknown }[] = [];
const closed: unknown[] = [];
let trustedFolders: { uri: { scheme: string; fsPath: string } }[] = [];

vi.mock("vscode", () => {
  class Disposable {
    constructor(private readonly fn: () => void) {}
    dispose() {
      this.fn();
    }
    static from(...ds: { dispose(): void }[]) {
      return new Disposable(() => ds.forEach((d) => d.dispose()));
    }
  }
  return {
    Disposable,
    window: {
      tabGroups: {
        get all() {
          return [{ tabs }];
        },
        close: (t: unknown[]) => (closed.push(...t), Promise.resolve(true)),
      },
      showInformationMessage: (m: string) => {
        said.push(m);
        return Promise.resolve(undefined);
      },
      registerTreeDataProvider: (id: string) => {
        trees.push(id);
        return new Disposable(() => trees.splice(trees.indexOf(id), 1));
      },
    },
    commands: {
      registerCommand: (id: string, fn: () => void) => {
        registered.push(id);
        (commands as Record<string, () => void>)[id] = fn;
        return new Disposable(() => registered.splice(registered.indexOf(id), 1));
      },
      executeCommand: () => Promise.resolve(),
    },
    workspace: {
      get workspaceFolders() {
        return trustedFolders;
      },
      onDidGrantWorkspaceTrust: (fn: () => void) => {
        grant = fn;
        return new Disposable(() => (grant = undefined));
      },
    },
  };
});
const commands: Record<string, () => void> = {};

const { TRUST_ACTION, TRUST_COMMAND, activateRestricted, contributedCommands } = await import("../src/restricted.js");
const src = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
const pkg = JSON.parse(src("package.json"));
const context = () => ({ extension: { packageJSON: pkg }, subscriptions: [] as { dispose(): void }[] });
const VIEWS = ["protoboard.start.library", "protoboard.start.parts", "protoboard.start.cloud", "protoboard.start.inspector"];

describe("in a folder that is not trusted", () => {
  it("the manifest keeps the extension on only to say that it is off", () => {
    expect(pkg.capabilities.untrustedWorkspaces.supported).toBe("limited");
    // every Protoboard container has a view there, and its welcome is the one line and VS Code's trust page
    for (const view of VIEWS) {
      const v = Object.values(pkg.contributes.views as Record<string, { id: string; when?: string }[]>).flat().find((x) => x.id === view)!;
      expect(v.when, view).toMatch(/\|\| !isWorkspaceTrusted$/);
      const w = (pkg.contributes.viewsWelcome as { view: string; contents: string; when?: string }[]).filter((x) => x.view === view && x.when === "!isWorkspaceTrusted");
      expect(w.map((x) => x.contents), view).toEqual([`Protoboard is off until you trust this folder.\n[${TRUST_ACTION}](command:${TRUST_COMMAND})`]);
    }
    // the views of a project, and the Start page, need what only a trusted window sets
    for (const v of Object.values(pkg.contributes.views as Record<string, { id: string; when?: string }[]>).flat()) {
      if (VIEWS.includes(v.id) || v.id === "protoboard.help") continue;
      expect(v.when, v.id).toMatch(/^protoboard\.(hasProject|noProject)/);
    }
    expect(TRUST_COMMAND).toBe("workbench.trust.manage");
  });

  it("nothing of Protoboard is started: the extension itself is made only in a trusted window, or when trust is given", () => {
    const ext = src("src/extension.ts");
    expect(ext).toMatch(/if \(vscode\.workspace\.isTrusted\) instance = new ProtoboardExtension\(context\);\s*else activateRestricted\(context, START_VIEWS, \(\) => \(instance = new ProtoboardExtension\(context\)\)/);
    expect(ext.match(/new ProtoboardExtension\(/g)).toHaveLength(2);
    // what stands in for it can reach no CLI, dev server or project file: it imports none of that
    const imports = [...src("src/restricted.ts").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./startPage.js", "node:fs", "node:path", "vscode"]);
    expect([...src("src/startPage.ts").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort()).toEqual(["./example.js", "./html.js"]);
  });

  it("every Protoboard command answers with the line and the way to trust the folder", () => {
    trustedFolders = [];
    registered.length = 0;
    said.length = 0;
    const all = contributedCommands(pkg);
    expect(all.length).toBeGreaterThan(40);
    const handle = activateRestricted(context() as never, VIEWS, () => undefined);
    expect([...registered].sort()).toEqual([...all].sort());
    expect([...trees].sort()).toEqual([...VIEWS].sort());
    commands["protoboard.check"]!();
    commands["protoboard.newProject"]!();
    expect(said).toEqual(["Protoboard is off until you trust this folder.", "Protoboard is off until you trust this folder."]);
    handle.dispose();
    expect(registered).toEqual([]);
    expect(trees).toEqual([]);
  });

  it("what runs no code stays: the links to the documentation", () => {
    registered.length = 0;
    const safe = ["protoboard.help.docs", "protoboard.help.feedback", "protoboard.help.discord"];
    let made = 0;
    const handle = activateRestricted(context() as never, VIEWS, () => undefined, { commands: safe, register: () => (made++, []) });
    expect(made).toBe(1);
    for (const id of safe) expect(registered, id).not.toContain(id);
    handle.dispose();
    expect(src("src/extension.ts")).toContain("{ commands: helpCommands(), register: registerHelp }");
  });

  it("a Protoboard project in the folder is told once, unasked; any other folder is not", () => {
    said.length = 0;
    trustedFolders = [{ uri: { scheme: "file", fsPath: fileURLToPath(new URL("../../../examples/quadcopter-5in", import.meta.url)) } }];
    activateRestricted(context() as never, VIEWS, () => undefined).dispose();
    expect(said).toEqual(["Protoboard is off until you trust this folder."]);
    said.length = 0;
    trustedFolders = [{ uri: { scheme: "file", fsPath: fileURLToPath(new URL("../src", import.meta.url)) } }];
    activateRestricted(context() as never, VIEWS, () => undefined).dispose();
    expect(said).toEqual([]);
  });

  it("trusting the folder starts Protoboard once, with no reload, after its stand-ins are gone", () => {
    trustedFolders = [];
    registered.length = 0;
    const started: number[] = [];
    activateRestricted(context() as never, VIEWS, () => started.push(registered.length));
    expect(registered.length).toBeGreaterThan(40);
    grant!();
    // the real commands can be registered: none of the stand-ins is left
    expect(started).toEqual([0]);
    expect(grant).toBeUndefined();
  });

  it("VS Code's trust page, left open over the window, is closed when the folder is trusted; no other tab is", () => {
    closed.length = 0;
    tabs = [{ label: "Workspace Trust", input: undefined }, { label: "Workspace Trust", input: { uri: "a file of that name" } }, { label: "main.ts", input: undefined }];
    activateRestricted(context() as never, VIEWS, () => undefined);
    grant!();
    expect(closed).toEqual([tabs[0]]);
    tabs = [];
  });

  it("the settings that name a program to run are never a workspace's", () => {
    expect(pkg.capabilities.untrustedWorkspaces.restrictedConfigurations).toEqual(["protoboard.cliPath", "protoboard.nodePath", "protoboard.libraries"]);
    const props = pkg.contributes.configuration.properties;
    expect(props["protoboard.cliPath"].scope).toBe("machine");
    expect(props["protoboard.nodePath"].scope).toBe("machine");
  });
});
