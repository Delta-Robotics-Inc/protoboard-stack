/**
 * The `protoboard` command on the user's PATH (first builds review, D3): what
 * is planned per system, and that nothing is written until it is applied.
 * Every system is tested here by giving the platform and the environment.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PATH_MARK, TERMINAL_PATH_ENV, addToPathValue, applyPathPlan, describePathPlan, lastingPath, onPathValue, parseUserPath, pathPlan, powerShellEnv, readUserPathScript, removeFromPathValue, removeFromUserPath, writeUserPathScript } from "../src/path-setup.js";

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

  it("Windows: the plan reads the user's own Path as the registry stores it, through Windows PowerShell", () => {
    const dir = "C:\\Users\\O'Brien\\.protoboard\\bin";
    const plan = pathPlan(dir, { platform: "win32", home: "C:\\Users\\O'Brien", env: { Path: "C:\\Windows", SystemRoot: "C:\\Windows" } });
    expect(plan.kind).toBe("windows");
    if (plan.kind !== "windows") return;
    expect(plan.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(plan.args).toEqual(["-NoProfile", "-NonInteractive", "-Command", readUserPathScript()]);
    expect(describePathPlan(plan)).toContain("no administrator rights");
  });
});

const DIR = "C:\\Users\\Ada\\.protoboard\\bin";
const ADA = { USERPROFILE: "C:\\Users\\Ada", LocalAppData: "C:\\Users\\Ada\\AppData\\Local" };

describe("the stored Windows Path (PB-1225)", () => {
  it("appends the folder and keeps every other entry as written, variables included", () => {
    const stored = "%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin;C:\\Tools";
    expect(addToPathValue(stored, DIR, ADA)).toEqual({ value: `${stored};${DIR}`, changed: true });
  });

  it("a trailing semicolon, an empty value and no value", () => {
    expect(addToPathValue("%USERPROFILE%\\bin;", DIR, ADA)).toEqual({ value: `%USERPROFILE%\\bin;${DIR}`, changed: true });
    expect(addToPathValue("", DIR, ADA)).toEqual({ value: DIR, changed: true });
    expect(addToPathValue("  ", DIR, ADA)).toEqual({ value: DIR, changed: true });
    expect(addToPathValue(undefined, DIR, ADA)).toEqual({ value: DIR, changed: true });
    // empty entries in the middle are the user's own: kept
    expect(addToPathValue("C:\\a;;C:\\b", DIR, ADA).value).toBe(`C:\\a;;C:\\b;${DIR}`);
  });

  it("is unchanged when the folder is there: other case, a trailing separator, quotes, or through a variable", () => {
    for (const stored of [`C:\\Tools;${DIR}`, `C:\\Tools;c:\\users\\ADA\\.Protoboard\\BIN\;C:\\x`, `"${DIR}"`, "C:\\Tools;%USERPROFILE%\\.protoboard\\bin", "%userprofile%\\.protoboard\\bin\;"]) {
      expect(addToPathValue(stored, DIR, ADA)).toEqual({ value: stored, changed: false });
    }
    // a folder that only starts the same is another folder, and an unknown variable is not expanded
    expect(addToPathValue(`${DIR}-old;%NOPE%\\.protoboard\\bin`, DIR, ADA).changed).toBe(true);
  });

  it("removal takes out only that folder", () => {
    const stored = `%USERPROFILE%\\go\\bin;${DIR};C:\\Tools;`;
    expect(removeFromPathValue(stored, DIR, ADA)).toEqual({ value: "%USERPROFILE%\\go\\bin;C:\\Tools;", changed: true });
    expect(removeFromPathValue(`%USERPROFILE%\\go\\bin;${DIR}`, DIR, ADA).value).toBe("%USERPROFILE%\\go\\bin");
    expect(removeFromPathValue("C:\\a;%USERPROFILE%\\.PROTOBOARD\\bin\;C:\\b", DIR, ADA).value).toBe("C:\\a;C:\\b");
    expect(removeFromPathValue(DIR, DIR, ADA)).toEqual({ value: "", changed: true });
    expect(removeFromPathValue("C:\\a;;C:\\b;", DIR, ADA)).toEqual({ value: "C:\\a;;C:\\b;", changed: false });
    expect(removeFromPathValue(undefined, DIR, ADA)).toEqual({ value: "", changed: false });
    // adding and removing gives back what was there
    const before = "%USERPROFILE%\\go\\bin;C:\\Tools";
    expect(removeFromPathValue(addToPathValue(before, DIR, ADA).value, DIR, ADA).value).toBe(before);
  });

  it("the read command asks the registry for the value unexpanded and for its type", () => {
    const script = readUserPathScript();
    expect(script).toContain("[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')");
    expect(script).toContain("GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)");
    expect(script).toContain("GetValueKind('Path')");
    // never the expanded value, the machine's Path, or setx (which cuts a long Path)
    expect(script).not.toMatch(/GetEnvironmentVariable|LocalMachine|'Machine'|setx/i);
  });

  it("what the read command prints is read back: type and text, an empty value, a missing one", () => {
    const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64");
    expect(parseUserPath(`ExpandString ${b64("%USERPROFILE%\\bin;C:\\Users\\Zoë\\x")}\r\n`)).toEqual({ kind: "ExpandString", value: "%USERPROFILE%\\bin;C:\\Users\\Zoë\\x" });
    expect(parseUserPath("String\r\n")).toEqual({ kind: "String", value: "" });
    expect(parseUserPath("missing\r\n")).toEqual({ kind: "missing" });
    expect(parseUserPath("")).toBeUndefined();
    expect(parseUserPath("Get-Item : Access denied")).toBeUndefined();
  });

  it("the write command carries the value whole, writes it with the type given, and announces the change", () => {
    const value = "%USERPROFILE%\\it's;C:\\Users\\Zoë\\bin";
    const script = writeUserPathScript(value, "ExpandString");
    const carried = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(script)?.[1];
    expect(Buffer.from(carried!, "base64").toString("utf8")).toBe(value);
    // the value itself is never part of the command's text: nothing in it can be read as PowerShell
    expect(script).not.toContain("it's");
    expect(script).toContain("$k.SetValue('Path',$v,[Microsoft.Win32.RegistryValueKind]::ExpandString)");
    expect(writeUserPathScript(value, "String")).toContain("[Microsoft.Win32.RegistryValueKind]::String)");
    // the broadcast: a variable that does not exist is deleted, which changes nothing and tells running programs
    expect(script).toContain("[Environment]::SetEnvironmentVariable('PROTOBOARD_PATH_CHANGED',$null,'User')");
    expect(script.indexOf("SetValue('Path'")).toBeLessThan(script.indexOf("SetEnvironmentVariable"));
    expect(script).not.toMatch(/SetEnvironmentVariable\('Path'|LocalMachine|'Machine'|setx/i);
  });

  it("Windows PowerShell is started without PowerShell 7's module path", () => {
    expect(powerShellEnv({ Path: "C:\\Windows", PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules", psmodulepath: "x", USERPROFILE: "C:\\Users\\Ada" })).toEqual({ Path: "C:\\Windows", USERPROFILE: "C:\\Users\\Ada" });
  });
});

describe.runIf(process.platform === "win32")("on Windows itself: the commands against a real registry value (a scratch key, never the user's Path)", () => {
  const key = `Software\\ProtoboardTest\\path-${randomBytes(6).toString("hex")}`;
  const powershell = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const ps = (script: string) => spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", env: powerShellEnv() });
  const reg = (...args: string[]) => spawnSync("reg.exe", args, { encoding: "utf8" });
  const stored = () => reg("query", `HKCU\\${key}`, "/v", "Path").stdout;

  it("an expandable value is read unexpanded and written back expandable, with only the folder added; a plain one stays plain; a missing one is created", () => {
    try {
      // no value yet
      expect(reg("add", `HKCU\\${key}`, "/f").status).toBe(0);
      const none = ps(readUserPathScript(key));
      expect(none.stderr).toBe("");
      expect(parseUserPath(none.stdout)).toEqual({ kind: "missing" });

      // expandable, with variables and a trailing semicolon (reg.exe is started without a shell: the % stay)
      const before = "%USERPROFILE%\\go\\bin;%LOCALAPPDATA%\\Programs\\Zoë\\bin;C:\\Tools;";
      expect(reg("add", `HKCU\\${key}`, "/v", "Path", "/t", "REG_EXPAND_SZ", "/d", before, "/f").status).toBe(0);
      const read = ps(readUserPathScript(key));
      expect(read.stderr).toBe("");
      expect(parseUserPath(read.stdout)).toEqual({ kind: "ExpandString", value: before });
      const next = addToPathValue(before, DIR, process.env);
      expect(next).toEqual({ value: `${before}${DIR}`, changed: true });
      const wrote = ps(writeUserPathScript(next.value, "ExpandString", key));
      expect(wrote.stderr).toBe("");
      expect(wrote.status).toBe(0);
      expect(wrote.stdout.trim()).toBe("written");
      expect(stored()).toContain("REG_EXPAND_SZ");
      expect(parseUserPath(ps(readUserPathScript(key)).stdout)).toEqual({ kind: "ExpandString", value: `${before}${DIR}` });

      // taken out again: the other entries as they were
      const without = removeFromPathValue(`${before}${DIR}`, DIR, process.env);
      expect(ps(writeUserPathScript(without.value, "ExpandString", key)).status).toBe(0);
      expect(parseUserPath(ps(readUserPathScript(key)).stdout)).toEqual({ kind: "ExpandString", value: before.slice(0, -1) });

      // a plain string stays a plain string
      expect(reg("add", `HKCU\\${key}`, "/v", "Path", "/t", "REG_SZ", "/d", "C:\\Tools", "/f").status).toBe(0);
      expect(parseUserPath(ps(readUserPathScript(key)).stdout)).toEqual({ kind: "String", value: "C:\\Tools" });
      expect(ps(writeUserPathScript(`C:\\Tools;${DIR}`, "String", key)).status).toBe(0);
      expect(stored()).toMatch(/REG_SZ/);
      expect(stored()).not.toContain("REG_EXPAND_SZ");
      expect(parseUserPath(ps(readUserPathScript(key)).stdout)).toEqual({ kind: "String", value: `C:\\Tools;${DIR}` });
    } finally {
      reg("delete", `HKCU\\${key}`, "/f");
    }
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

  /** A user Path in a fake registry: answers the read command, and takes what the write command carries. */
  const registry = (kind: string, value: string | undefined) => {
    const reg = { kind, value, writes: 0, ran: [] as string[][] };
    const run = (command: string, args: string[]) => {
      reg.ran.push([command, ...args]);
      const script = args.at(-1)!;
      if (script === readUserPathScript()) return { status: 0, stdout: reg.value === undefined ? "missing\r\n" : `${reg.kind} ${Buffer.from(reg.value, "utf8").toString("base64")}\r\n`, stderr: "" };
      const m = /FromBase64String\('([A-Za-z0-9+/=]*)'\).*RegistryValueKind\]::(\w+)\)/.exec(script);
      if (!m) throw new Error(`unexpected command: ${script}`);
      reg.value = Buffer.from(m[1]!, "base64").toString("utf8");
      reg.kind = m[2]!;
      reg.writes++;
      return { status: 0, stdout: "written\r\n", stderr: "" };
    };
    return { reg, run };
  };
  const winPlan = () => pathPlan(DIR, { platform: "win32", env: { Path: "C:\\Windows", SystemRoot: "C:\\Windows" } });

  it("Windows: an expandable Path stays expandable and differs only by the added folder (PB-1225)", () => {
    const stored = "%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;%USERPROFILE%\\go\\bin;";
    const { reg, run } = registry("ExpandString", stored);
    expect(applyPathPlan(winPlan(), { run, env: ADA })).toMatchObject({ changed: true, message: expect.stringContaining("Open a new terminal") });
    expect(reg).toMatchObject({ kind: "ExpandString", value: `${stored}${DIR}`, writes: 1 });
    expect(reg.ran.every((r) => r[0] === "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" && r.slice(1, 4).join(" ") === "-NoProfile -NonInteractive -Command")).toBe(true);
    // a second time there is nothing to write
    expect(applyPathPlan(winPlan(), { run, env: ADA })).toMatchObject({ changed: false, message: expect.stringContaining("already") });
    expect(reg.writes).toBe(1);
    // and taking it out again leaves the other entries as they were, type included (the folder goes with the separator before it)
    expect(removeFromUserPath(DIR, { env: { ...ADA, SystemRoot: "C:\\Windows" } }, { run })).toMatchObject({ changed: true });
    expect(reg).toMatchObject({ kind: "ExpandString", value: stored.slice(0, -1), writes: 2 });
    expect(removeFromUserPath(DIR, { env: ADA }, { run })).toMatchObject({ changed: false });
    expect(reg.writes).toBe(2);
  });

  it("Windows: a plain Path stays plain, a missing one is created expandable, one entered through a variable is left alone", () => {
    const plain = registry("String", "C:\\Tools");
    applyPathPlan(winPlan(), { run: plain.run, env: ADA });
    expect(plain.reg).toMatchObject({ kind: "String", value: `C:\\Tools;${DIR}` });
    const none = registry("", undefined);
    applyPathPlan(winPlan(), { run: none.run, env: ADA });
    expect(none.reg).toMatchObject({ kind: "ExpandString", value: DIR });
    const through = registry("ExpandString", "%USERPROFILE%\\.protoboard\\bin");
    expect(applyPathPlan(winPlan(), { run: through.run, env: ADA }).changed).toBe(false);
    expect(through.reg.writes).toBe(0);
  });

  it("Windows: says what to do by hand when it cannot read or write, and never writes a Path it could not read", () => {
    expect(() => applyPathPlan(winPlan(), { run: () => ({ status: 1, stdout: "", stderr: "Access denied" }) })).toThrow(/Access denied.*Environment Variables/);
    const unread: string[] = [];
    expect(() => applyPathPlan(winPlan(), { run: (_c, a) => (unread.push(a.at(-1)!), { status: 0, stdout: "WARNING: not what was asked.\r\n", stderr: "" }) })).toThrow(/could not be read.*Environment Variables/);
    expect(unread).toEqual([readUserPathScript()]);
    const odd = registry("MultiString", "C:\\Tools");
    expect(() => applyPathPlan(winPlan(), { run: odd.run, env: ADA })).toThrow(/stored as MultiString/);
    expect(odd.reg.writes).toBe(0);
    const { reg, run } = registry("ExpandString", "C:\\Tools");
    expect(() => applyPathPlan(winPlan(), { run: (c, a) => (a.at(-1) === readUserPathScript() ? run(c, a) : { status: 1, stdout: "", stderr: "Requested registry access is not allowed." }), env: ADA })).toThrow(/registry access is not allowed/);
    expect(reg.value).toBe("C:\\Tools");
  });

  it("changes nothing when there is nothing to do", () => {
    const r = applyPathPlan({ kind: "already", dir: BIN, where: "PATH" }, { append: () => expect.unreachable(), run: () => expect.unreachable() as never });
    expect(r.changed).toBe(false);
  });
});
