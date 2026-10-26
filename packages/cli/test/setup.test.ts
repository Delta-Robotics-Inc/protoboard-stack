/**
 * `protoboard setup` (first builds review, D4 and item 8): the editors found,
 * the command that installs the extension into each, where the package comes
 * from, the PATH offer, and that nothing changes without a yes. Windows and
 * macOS are tested by giving the platform; no editor is started.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { PATH_MARK } from "@protoboardai/core";
import { EXTENSION_ID, findEditors, installCommand, notPublished, setupCommand, setupExitCode, type Command, type SetupIo, type SetupResult } from "../src/setup.js";

const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), "pb-setup-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const VSIX = join(TMP, "vscode-protoboard-0.1.4.vsix");
writeFileSync(VSIX, "a vsix");

const on = (...files: string[]) => (f: string) => files.includes(f);

describe("findEditors", () => {
  it("VSCodium: on PATH, or where its installers put it", () => {
    expect(findEditors({ platform: "linux", home: "/home/ada", env: { PATH: "/usr/bin" }, exists: on("/var/lib/flatpak/exports/bin/com.vscodium.codium") })).toEqual([{ id: "codium", name: "VSCodium", launcher: "/var/lib/flatpak/exports/bin/com.vscodium.codium", from: "known" }]);
    expect(findEditors({ platform: "darwin", home: "/Users/ada", env: { PATH: "/usr/bin" }, exists: on("/Applications/VSCodium.app/Contents/Resources/app/bin/codium") })[0]).toMatchObject({ id: "codium", from: "known" });
    expect(findEditors({ platform: "win32", home: "C:\\Users\\Ada", env: { Path: "C:\\Tools", LOCALAPPDATA: "C:\\L" }, exists: on("C:\\Tools\\codium.cmd") })).toEqual([{ id: "codium", name: "VSCodium", launcher: "C:\\Tools\\codium.cmd", from: "path" }]);
  });

  it("Linux: the launchers on PATH, by full path", () => {
    expect(findEditors({ platform: "linux", home: "/home/ada", env: { PATH: "/usr/local/bin:/usr/bin" }, exists: on("/usr/bin/code", "/usr/local/bin/cursor") })).toEqual([
      { id: "code", name: "VS Code", launcher: "/usr/bin/code", from: "path" },
      { id: "cursor", name: "Cursor", launcher: "/usr/local/bin/cursor", from: "path" },
    ]);
  });

  it("macOS: an app whose command is not on PATH is found in its bundle", () => {
    const code = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
    const windsurf = "/Users/ada/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf";
    expect(findEditors({ platform: "darwin", home: "/Users/ada", env: { PATH: "/usr/bin:/bin" }, exists: on(code, windsurf) })).toEqual([
      { id: "code", name: "VS Code", launcher: code, from: "known" },
      { id: "windsurf", name: "Windsurf", launcher: windsurf, from: "known" },
    ]);
  });

  it("Windows: the .cmd launchers, on Path or where the installers put them", () => {
    const env = { Path: "C:\\Windows;C:\\Users\\Ada\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\", LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local" };
    const code = "C:\\Users\\Ada\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd";
    const cursor = "C:\\Users\\Ada\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd";
    expect(findEditors({ platform: "win32", home: "C:\\Users\\Ada", env, exists: on(code, cursor) })).toEqual([
      { id: "code", name: "VS Code", launcher: code, from: "path" },
      { id: "cursor", name: "Cursor", launcher: cursor, from: "known" },
    ]);
  });

  it("none: an empty list", () => {
    expect(findEditors({ platform: "linux", home: "/home/ada", env: { PATH: "/usr/bin" }, exists: () => false })).toEqual([]);
  });
});

describe("installCommand", () => {
  it("macOS and Linux: the launcher with --install-extension <file> --force, no shell", () => {
    expect(installCommand({ launcher: "/usr/bin/code" }, "/tmp/p b.vsix", "linux")).toEqual({ command: "/usr/bin/code", args: ["--install-extension", "/tmp/p b.vsix", "--force"] });
  });

  it("Windows: the .cmd launcher through cmd, both paths in double quotes (spaces and & are text there)", () => {
    const c = installCommand({ launcher: "C:\\Users\\A & B\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd" }, "C:\\Users\\A & B\\Downloads\\vscode-protoboard-0.1.4.vsix", "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" });
    expect(c).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", '""C:\\Users\\A & B\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd" --install-extension "C:\\Users\\A & B\\Downloads\\vscode-protoboard-0.1.4.vsix" --force"'],
      verbatim: true,
    });
    // what cmd cannot take inside quotes is refused, not passed on
    expect(() => installCommand({ launcher: "C:\\code.cmd" }, "C:\\100%\\p.vsix", "win32", {})).toThrow(/%/);
  });
});

function harness(options: { answers?: boolean[]; json?: boolean; noTerminal?: boolean; agents?: () => Promise<void> } = {}) {
  const asked: string[] = [];
  const logged: string[] = [];
  const answers = [...(options.answers ?? [])];
  let printed = "";
  let data: SetupResult | undefined;
  const io: SetupIo = {
    json: !!options.json,
    cwd: TMP,
    out: (d, text) => {
      data = d as SetupResult;
      printed = text();
    },
    log: (l) => logged.push(l),
    ...(options.noTerminal ? {} : { confirm: async (q: string) => (asked.push(q), answers.shift() ?? false) }),
    ...(options.agents ? { agents: options.agents } : {}),
  };
  return { io, asked, logged, printed: () => printed, data: () => data };
}

const LINUX = { platform: "linux" as const, home: "/home/ada", stackHome: "/home/ada/.protoboard" };

describe("setupCommand", () => {
  it("asks about each editor, installs into the ones that get a yes, and reports each", async () => {
    const ran: Command[] = [];
    const h = harness({ answers: [true, false] });
    const r = await setupCommand({ vsix: VSIX }, h.io, { ...LINUX, env: { PATH: "/usr/bin" }, exists: (f) => f === VSIX || ["/usr/bin/code", "/usr/bin/cursor", "/usr/bin/protoboard"].includes(f), run: (c) => (ran.push(c), { status: 0, stdout: "Extension 'vscode-protoboard-0.1.4.vsix' was successfully installed.", stderr: "" }) });
    expect(h.asked).toEqual([
      `Install the Protoboard extension into VS Code? This runs: /usr/bin/code --install-extension ${VSIX} --force`,
      `Install the Protoboard extension into Cursor? This runs: /usr/bin/cursor --install-extension ${VSIX} --force`,
    ]);
    expect(ran).toEqual([{ command: "/usr/bin/code", args: ["--install-extension", VSIX, "--force"] }]);
    expect(r.editors.map((e) => [e.id, e.action])).toEqual([["code", "installed"], ["cursor", "declined"]]);
    expect(r.notFound).toEqual(["Windsurf", "VSCodium"]);
    expect(r.extension).toEqual({ from: "file", file: VSIX });
    expect(h.printed()).toContain("✓ VS Code: installed (/usr/bin/code)");
    expect(h.printed()).toContain("· Cursor: left alone");
    expect(h.printed()).toContain("Not found here: Windsurf, VSCodium");
    expect(setupExitCode(r)).toBe(0);
  });

  it("--yes installs into every editor found without asking; --editor names one", async () => {
    const ran: Command[] = [];
    const exists = (f: string) => f === VSIX || ["/usr/bin/code", "/usr/bin/windsurf", "/usr/bin/protoboard"].includes(f);
    const h = harness({ noTerminal: true });
    const r = await setupCommand({ vsix: VSIX, yes: true }, h.io, { ...LINUX, env: { PATH: "/usr/bin" }, exists, run: (c) => (ran.push(c), { status: 0, stdout: "", stderr: "" }) });
    expect(h.asked).toEqual([]);
    expect(ran.map((c) => c.command)).toEqual(["/usr/bin/code", "/usr/bin/windsurf"]);
    expect(r.editors.every((e) => e.action === "installed")).toBe(true);
    const one = await setupCommand({ vsix: VSIX, yes: true, editor: ["windsurf"] }, harness({ noTerminal: true }).io, { ...LINUX, env: { PATH: "/usr/bin" }, exists, run: () => ({ status: 0, stdout: "", stderr: "" }) });
    expect(one.editors.map((e) => e.id)).toEqual(["windsurf"]);
    await expect(setupCommand({ vsix: VSIX, yes: true, editor: ["emacs"] }, harness().io, { ...LINUX, env: {}, exists })).rejects.toThrow(/no editor "emacs"; known: code, cursor, windsurf, codium/);
  });

  it("a failed install is said with what the editor printed, and the exit code is 1", async () => {
    const h = harness({ noTerminal: true });
    const r = await setupCommand({ vsix: VSIX, yes: true }, h.io, { ...LINUX, env: { PATH: "/usr/bin" }, exists: (f) => f === VSIX || f === "/usr/bin/code" || f === "/usr/bin/protoboard", run: () => ({ status: 1, stdout: "", stderr: "Error: End of central directory record signature not found" }) });
    expect(r.editors[0]).toMatchObject({ action: "failed", message: "Error: End of central directory record signature not found" });
    expect(h.printed()).toContain("✗ VS Code: not installed: Error: End of central directory record signature not found");
    expect(setupExitCode(r)).toBe(1);
  });

  it("changes nothing without a yes: no terminal and no --yes is refused before anything runs", async () => {
    const run = () => expect.unreachable() as never;
    await expect(setupCommand({ vsix: VSIX }, harness({ noTerminal: true }).io, { ...LINUX, env: { PATH: "/usr/bin" }, exists: () => true, run })).rejects.toThrow(/changes nothing without a yes/);
  });

  it("is never run from an npm install script", async () => {
    await expect(setupCommand({ vsix: VSIX, yes: true }, harness().io, { ...LINUX, env: { PATH: "/usr/bin", npm_lifecycle_event: "postinstall" }, exists: () => true, run: () => expect.unreachable() as never })).rejects.toThrow(/does not run from an npm script of an install \(postinstall\)/);
    // the CLI itself, started the way npm starts a script
    const r = spawnSync(process.execPath, [CLI, "setup", "--yes", "--vsix", VSIX], { cwd: TMP, encoding: "utf8", env: { ...process.env, npm_lifecycle_event: "postinstall", PROTOBOARD_HOME: join(TMP, "home") }, timeout: 60_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("does not run from an npm script of an install");
  });

  it("no editor found: says so and how to install by hand, and needs no package", async () => {
    const h = harness({ noTerminal: true });
    const r = await setupCommand({ yes: true }, h.io, { ...LINUX, env: { PATH: "/usr/bin" }, exists: () => false, run: () => expect.unreachable() as never });
    expect(r.editors).toEqual([]);
    expect(r.notFound).toEqual(["VS Code", "Cursor", "Windsurf", "VSCodium"]);
    expect(h.printed()).toContain("Not found here: VS Code, Cursor, Windsurf, VSCodium. In VS Code, install it from the Extensions view: search for Protoboard (deltarobotics.vscode-protoboard).");
  });

  it("--vsix must be a .vsix file that is there", async () => {
    const exists = (f: string) => f === "/usr/bin/code";
    await expect(setupCommand({ vsix: "nowhere.vsix", yes: true }, harness().io, { ...LINUX, env: { PATH: "/usr/bin" }, exists })).rejects.toThrow(/there is no file .*nowhere\.vsix/);
    await expect(setupCommand({ vsix: "notes.txt", yes: true }, harness().io, { ...LINUX, env: { PATH: "/usr/bin" }, exists: (f) => f === "/usr/bin/code" || f.endsWith("notes.txt") })).rejects.toThrow(/is not a \.vsix file/);
  });

  it("offers to put ~/.protoboard/bin on PATH when the command is there and not on PATH, and writes the line only on a yes", async () => {
    const bin = "/home/ada/.protoboard/bin";
    const exists = (f: string) => f === `${bin}/protoboard`;
    const written: [string, string][] = [];
    const no = harness({ answers: [false] });
    const declined = await setupCommand({}, no.io, { ...LINUX, env: { PATH: "/usr/bin", SHELL: "/bin/zsh" }, exists, read: () => "", append: (f, t) => written.push([f, t]) });
    expect(no.asked[0]).toContain("Put the protoboard command on your PATH");
    expect(no.asked[0]).toContain("/home/ada/.zshrc");
    expect(declined.path).toMatchObject({ action: "declined" });
    expect(written).toEqual([]);
    const yes = harness({ answers: [true] });
    const added = await setupCommand({}, yes.io, { ...LINUX, env: { PATH: "/usr/bin", SHELL: "/bin/zsh" }, exists, read: () => "", append: (f, t) => written.push([f, t]) });
    expect(added.path).toMatchObject({ action: "added", dir: bin });
    expect(written).toHaveLength(1);
    expect(written[0]![0]).toBe("/home/ada/.zshrc");
    expect(written[0]![1]).toContain(PATH_MARK);
    // a `protoboard` already on PATH (installed with npm): nothing to offer
    const has = harness();
    expect((await setupCommand({}, has.io, { ...LINUX, env: { PATH: "/usr/bin" }, exists: (f) => exists(f) || f === "/usr/bin/protoboard" })).path).toMatchObject({ action: "already" });
    expect(has.asked).toEqual([]);
  });

  it("in a VS Code terminal, whose PATH the extension gave the folder, still offers to put it on PATH for other shells (PB-1037)", async () => {
    const bin = "/home/ada/.protoboard/bin";
    const exists = (f: string) => f === `${bin}/protoboard`;
    const written: [string, string][] = [];
    const yes = harness({ answers: [true] });
    const r = await setupCommand({}, yes.io, { ...LINUX, env: { PATH: `/usr/bin:${bin}`, SHELL: "/bin/zsh", TERM_PROGRAM: "vscode" }, exists, read: () => "", append: (f, t) => written.push([f, t]) });
    expect(yes.asked[0]).toContain("Put the protoboard command on your PATH");
    expect(r.path).toMatchObject({ action: "added", dir: bin });
    expect(written[0]![0]).toBe("/home/ada/.zshrc");
    // the extension's own `protoboard` in that folder is not "a protoboard on PATH" either
    const again = harness({ answers: [false] });
    const r2 = await setupCommand({}, again.io, { ...LINUX, env: { PATH: `/usr/bin:${bin}`, SHELL: "/bin/zsh", PROTOBOARD_TERMINAL_PATH: bin }, exists, read: () => "" });
    expect(r2.path).toMatchObject({ action: "declined" });
  });

  it("offers the agents' set-up last, at a terminal; --no-agents and --format json leave it out", async () => {
    let offered = 0;
    const agents = async () => void offered++;
    const exists = (f: string) => f === "/usr/bin/protoboard";
    expect((await setupCommand({}, harness({ agents }).io, { ...LINUX, env: { PATH: "/usr/bin" }, exists })).agents).toBe("offered");
    expect(offered).toBe(1);
    expect((await setupCommand({ agents: false }, harness({ agents }).io, { ...LINUX, env: { PATH: "/usr/bin" }, exists })).agents).toBe("skipped");
    const json = harness({ agents, json: true });
    expect((await setupCommand({}, json.io, { ...LINUX, env: { PATH: "/usr/bin" }, exists })).agents).toBe("not-run");
    expect(json.printed()).toContain("`protoboard agents setup`");
    expect(offered).toBe(1);
  });
});

describe("setupCommand: the extension by its id, from the editors' galleries, with no sign-in (PB-1047)", () => {
  const exists = (f: string) => ["/usr/bin/code", "/usr/bin/cursor", "/usr/bin/codium", "/usr/bin/protoboard"].includes(f);

  it("installs deltarobotics.vscode-protoboard through each editor's own command: the Marketplace for VS Code, Open VSX for the others", async () => {
    const ran: Command[] = [];
    const h = harness({ answers: [true, true, true] });
    const r = await setupCommand({}, h.io, { ...LINUX, env: { PATH: "/usr/bin" }, exists, run: (c) => (ran.push(c), { status: 0, stdout: "", stderr: "" }) });
    expect(EXTENSION_ID).toBe("deltarobotics.vscode-protoboard");
    expect(h.asked[0]).toBe("Install the Protoboard extension into VS Code? This runs: /usr/bin/code --install-extension deltarobotics.vscode-protoboard --force");
    expect(ran).toEqual(["/usr/bin/code", "/usr/bin/cursor", "/usr/bin/codium"].map((command) => ({ command, args: ["--install-extension", EXTENSION_ID, "--force"] })));
    expect(r.extension).toEqual({ from: "gallery", id: EXTENSION_ID });
    expect(r.editors.map((e) => [e.id, e.action])).toEqual([["code", "installed"], ["cursor", "installed"], ["codium", "installed"]]);
    expect(h.printed()).toContain("✓ VSCodium: installed (/usr/bin/codium)");
    expect(h.printed()).toContain(`${EXTENSION_ID}, from the Marketplace and Open VSX`);
    expect(setupExitCode(r)).toBe(0);
  });

  it("not published yet (the editor's gallery has no such id): one line, exit 0, and PATH and the agents still go on", async () => {
    let offered = 0;
    const bin = "/home/ada/.protoboard/bin";
    const h = harness({ answers: [true, true, true, true], agents: async () => void offered++ });
    const notThere = { status: 1, stdout: "Installing extensions...\n", stderr: `Extension '${EXTENSION_ID}' not found.\nMake sure you use the full extension ID, including the publisher, e.g.: ms-dotnettools.csharp\nFailed Installing Extensions: ${EXTENSION_ID}` };
    const r = await setupCommand({}, h.io, { ...LINUX, env: { PATH: "/usr/bin", SHELL: "/bin/bash" }, exists: (f) => ["/usr/bin/code", "/usr/bin/cursor", `${bin}/protoboard`].includes(f), read: () => "", append: () => {}, run: () => notThere });
    expect(r.editors.map((e) => e.action)).toEqual(["unpublished", "unpublished"]);
    expect(r.editors[0]!.message).toBeUndefined();
    const lines = h.printed().split("\n");
    expect(lines.filter((l) => l.includes("not published yet"))).toEqual([`  ${EXTENSION_ID} is not published yet on the Marketplace or Open VSX: install a .vsix with \`protoboard setup --vsix <file>\`.`]);
    expect(h.printed()).toContain("· VS Code: not installed");
    // the PATH was still offered (and added), and the agents' set-up still ran
    expect(h.asked.some((q) => q.startsWith("Put the protoboard command on your PATH"))).toBe(true);
    expect(r.path).toMatchObject({ action: "added" });
    expect(r.agents).toBe("offered");
    expect(offered).toBe(1);
    expect(setupExitCode(r)).toBe(0);
    // a 404 the editor reports in other words is the same answer
    expect(notPublished("Error: Failed to fetch extension: 404 Not Found")).toBe(true);
    expect(notPublished("Unable to install extension 'deltarobotics.vscode-protoboard' as it is not compatible with VS Code '1.90.0'.")).toBe(false);
  });

  it("a --vsix install that the editor refuses is a failure, never \"not published\"", async () => {
    const r = await setupCommand({ vsix: VSIX, yes: true }, harness({ noTerminal: true }).io, { ...LINUX, env: { PATH: "/usr/bin" }, exists: (f) => f === VSIX || exists(f), run: () => ({ status: 1, stdout: "", stderr: "Error: file not found" }) });
    expect(r.editors.every((e) => e.action === "failed")).toBe(true);
    expect(setupExitCode(r)).toBe(1);
  });

  it("needs no service, no network and no sign-in", async () => {
    const io = harness({ noTerminal: true }).io;
    expect(Object.keys(io)).not.toContain("service");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => expect.unreachable("setup fetched something")) as never;
    try {
      const r = await setupCommand({ yes: true }, io, { ...LINUX, env: { PATH: "/usr/bin" }, exists, run: () => ({ status: 0, stdout: "", stderr: "" }) });
      expect(r.editors).toHaveLength(3);
    } finally {
      globalThis.fetch = realFetch;
    }
    const src = readFileSync(fileURLToPath(new URL("../src/setup.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/accountToken|serviceAccount|downloads\.json|fetch\(/);
  });

  it("Windows: the id through cmd, quoted like a path", () => {
    expect(installCommand({ launcher: "C:\\Users\\Ada\\AppData\\Local\\Programs\\VSCodium\\bin\\codium.cmd" }, EXTENSION_ID, "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }).args[3]).toBe(`""C:\\Users\\Ada\\AppData\\Local\\Programs\\VSCodium\\bin\\codium.cmd" --install-extension "${EXTENSION_ID}" --force"`);
  });
});

describe("protoboard setup: the command", () => {
  it("is in the help, works signed out (never NO_VSIX), and with no editor and no terminal says what it found", () => {
    mkdirSync(join(TMP, "empty-path"), { recursive: true });
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_") && !k.startsWith("npm_"))), PROTOBOARD_HOME: join(TMP, "home"), PROTOBOARD_CONFIG_DIR: join(TMP, "config-cli"), PROTOBOARD_CREDENTIAL_STORE: "file", PATH: join(TMP, "empty-path"), HOME: join(TMP, "fake-home"), LOCALAPPDATA: join(TMP, "fake-home") };
    const r = spawnSync(process.execPath, [CLI, "setup", "--yes", "--no-agents", "--format", "json", "--url", "http://127.0.0.1:9"], { cwd: TMP, encoding: "utf8", env, timeout: 60_000 });
    // on a machine whose editors are installed where their installers put them, they are found: then the package is missing
    const out = JSON.parse(r.stdout) as SetupResult & { code?: string };
    expect(out.code).toBeUndefined();
    expect(out.agents).toBe("skipped");
    // an editor installed where its installer puts it is found and tried; else there is none
    if (!out.editors.length) expect(r.status, r.stderr).toBe(0);
  });
});
