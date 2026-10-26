/**
 * The `protoboard` command on the user's PATH (first builds review, D3): what
 * is planned per system, and that nothing is written until it is applied.
 * Every system is tested here by giving the platform and the environment.
 */
import { describe, expect, it } from "vitest";
import { PATH_MARK, TERMINAL_PATH_ENV, applyPathPlan, describePathPlan, lastingPath, onPathValue, pathPlan } from "../src/path-setup.js";

const HOME = "/home/ada";
const BIN = `${HOME}/.protoboard/bin`;
const none = { exists: () => false, read: () => "" };

describe("pathPlan", () => {
  it("says so when the folder is on PATH already", () => {
    expect(pathPlan(BIN, { platform: "linux", home: HOME, env: { PATH: `/usr/bin:${BIN}/`, SHELL: "/bin/bash" }, ...none })).toEqual({ kind: "already", dir: BIN, where: "PATH" });
    expect(onPathValue("C:\\Users\\Ada\\.protoboard\\bin", "C:\\Windows;c:\\users\\ada\\.PROTOBOARD\\bin\\", "win32")).toBe(true);
    expect(onPathValue(BIN, `/usr/bin:${BIN}-other`, "linux")).toBe(false);
  });

  it("zsh, bash and other shells: one marked line for the shell's own start file, written with $HOME", () => {
    const line = `export PATH="$PATH:$HOME/.protoboard/bin" # ${PATH_MARK}: the protoboard command (added by Protoboard; delete this line to undo)`;
    expect(pathPlan(BIN, { platform: "darwin", home: HOME, env: { PATH: "/usr/bin", SHELL: "/bin/zsh" }, ...none })).toEqual({ kind: "profile", dir: BIN, file: `${HOME}/.zshrc`, line, shell: "zsh" });
    expect(pathPlan(BIN, { platform: "darwin", home: HOME, env: { PATH: "/usr/bin", SHELL: "/bin/zsh", ZDOTDIR: "/home/ada/.zsh" }, ...none })).toMatchObject({ file: "/home/ada/.zsh/.zshrc" });
    expect(pathPlan(BIN, { platform: "linux", home: HOME, env: { PATH: "/usr/bin", SHELL: "/usr/bin/bash" }, ...none })).toMatchObject({ file: `${HOME}/.bashrc`, line });
    // macOS starts bash as a login shell
    expect(pathPlan(BIN, { platform: "darwin", home: HOME, env: { PATH: "/usr/bin", SHELL: "/bin/bash" }, ...none })).toMatchObject({ file: `${HOME}/.bash_profile` });
    expect(pathPlan(BIN, { platform: "linux", home: HOME, env: { PATH: "/usr/bin" }, ...none })).toMatchObject({ file: `${HOME}/.profile`, shell: "sh" });
    // a folder outside the home folder is written as it is
    expect(pathPlan("/opt/pb/bin", { platform: "linux", home: HOME, env: { PATH: "/usr/bin", SHELL: "/bin/bash" }, ...none })).toMatchObject({ line: expect.stringContaining('export PATH="$PATH:/opt/pb/bin"') });
  });

  it("fish: a conf.d file of its own", () => {
    expect(pathPlan(BIN, { platform: "linux", home: HOME, env: { PATH: "/usr/bin", SHELL: "/usr/bin/fish" }, ...none })).toMatchObject({ kind: "profile", file: `${HOME}/.config/fish/conf.d/protoboard.fish`, line: expect.stringContaining('set -gx PATH $PATH "$HOME/.protoboard/bin"') });
  });

  it("the line is written once: a start file that has it needs nothing", () => {
    const plan = pathPlan(BIN, { platform: "linux", home: HOME, env: { PATH: "/usr/bin", SHELL: "/bin/bash" }, exists: () => true, read: () => `# mine\nexport PATH="$PATH:$HOME/.protoboard/bin" # ${PATH_MARK}: …\n` });
    expect(plan).toEqual({ kind: "already", dir: BIN, where: `${HOME}/.bashrc` });
    expect(describePathPlan(plan)).toContain("terminals opened from now on have it");
  });

  it("Windows: the user's own Path through PowerShell, the folder quoted, appended only when it is not there", () => {
    const dir = "C:\\Users\\O'Brien\\.protoboard\\bin";
    const plan = pathPlan(dir, { platform: "win32", home: "C:\\Users\\O'Brien", env: { Path: "C:\\Windows", SystemRoot: "C:\\Windows" } });
    expect(plan.kind).toBe("windows");
    if (plan.kind !== "windows") return;
    expect(plan.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(plan.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
    const script = plan.args[3]!;
    expect(script).toContain("$d='C:\\Users\\O''Brien\\.protoboard\\bin'");
    expect(script).toContain("[Environment]::GetEnvironmentVariable('Path','User')");
    expect(script).toContain("-notcontains");
    expect(script).toContain("[Environment]::SetEnvironmentVariable('Path'");
    expect(script).toContain("'User')");
    // never the machine's Path, and never setx (which cuts a long Path)
    expect(script).not.toMatch(/'Machine'|setx/i);
    expect(describePathPlan(plan)).toContain("no administrator rights");
  });
});

describe("an editor terminal's PATH (PB-1037)", () => {
  const bin = "/home/ada/.protoboard/bin";
  it("leaves out the entry the extension gave the terminal, and keeps the rest", () => {
    expect(lastingPath(bin, { PATH: `/usr/bin:${bin}`, TERM_PROGRAM: "vscode" }, "linux")).toBe("/usr/bin");
    expect(lastingPath(bin, { PATH: `/usr/bin:${bin}/`, [TERMINAL_PATH_ENV]: bin }, "linux")).toBe("/usr/bin");
    // another terminal: its PATH is the user's
    expect(lastingPath(bin, { PATH: `/usr/bin:${bin}`, TERM_PROGRAM: "iTerm.app" }, "darwin")).toBe(`/usr/bin:${bin}`);
    expect(lastingPath("C:\\Users\\ada\\.protoboard\\bin", { Path: "C:\\Windows;C:\\Users\\ada\\.protoboard\\bin", TERM_PROGRAM: "vscode" }, "win32")).toBe("C:\\Windows");
  });

  it("in a VS Code terminal the folder on PATH is not taken as set up: the start file gets its line", () => {
    const plan = pathPlan(bin, { platform: "linux", home: "/home/ada", env: { PATH: `/usr/bin:${bin}`, SHELL: "/bin/bash", TERM_PROGRAM: "vscode" }, exists: () => false });
    expect(plan).toMatchObject({ kind: "profile", file: "/home/ada/.bashrc" });
    // once the line is there, it is
    expect(pathPlan(bin, { platform: "linux", home: "/home/ada", env: { PATH: `/usr/bin:${bin}`, SHELL: "/bin/bash", TERM_PROGRAM: "vscode" }, exists: () => true, read: () => `export PATH="$PATH:$HOME/.protoboard/bin" # ${PATH_MARK}` })).toMatchObject({ kind: "already", where: "/home/ada/.bashrc" });
    // outside an editor, on PATH is on PATH
    expect(pathPlan(bin, { platform: "linux", home: "/home/ada", env: { PATH: `/usr/bin:${bin}`, SHELL: "/bin/bash" }, exists: () => false })).toMatchObject({ kind: "already", where: "PATH" });
  });
});

describe("applyPathPlan", () => {
  it("appends the line to the start file, on a line of its own", () => {
    const written: [string, string][] = [];
    const plan = pathPlan(BIN, { platform: "linux", home: HOME, env: { PATH: "/usr/bin", SHELL: "/bin/zsh" }, ...none });
    const r = applyPathPlan(plan, { append: (file, text) => written.push([file, text]) });
    expect(written).toEqual([[`${HOME}/.zshrc`, `\n${(plan as { line: string }).line}\n`]]);
    expect(r).toMatchObject({ changed: true, message: expect.stringContaining("Open a new terminal") });
  });

  it("Windows: runs the command, and says what to do by hand when it fails", () => {
    const plan = pathPlan("C:\\pb\\bin", { platform: "win32", env: { Path: "C:\\Windows" } });
    const ran: string[][] = [];
    expect(applyPathPlan(plan, { run: (c, a) => (ran.push([c, ...a]), { status: 0, stdout: "added\r\n", stderr: "" }) })).toMatchObject({ changed: true });
    expect(ran).toHaveLength(1);
    expect(applyPathPlan(plan, { run: () => ({ status: 0, stdout: "already\r\n", stderr: "" }) })).toMatchObject({ changed: false });
    expect(() => applyPathPlan(plan, { run: () => ({ status: 1, stdout: "", stderr: "Access denied" }) })).toThrow(/Access denied.*Environment Variables/);
  });

  it("changes nothing when there is nothing to do", () => {
    const r = applyPathPlan({ kind: "already", dir: BIN, where: "PATH" }, { append: () => expect.unreachable(), run: () => expect.unreachable() as never });
    expect(r.changed).toBe(false);
  });
});
