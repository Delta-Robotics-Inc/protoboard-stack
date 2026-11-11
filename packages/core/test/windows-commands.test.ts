/**
 * What only Windows itself can show (PB-1226), run by the Windows job of CI:
 * the command file the extension writes gives the CLI's exit code back to
 * cmd and to PowerShell, and the credential store saves a sign-in through
 * Windows PowerShell also when PowerShell 7's module folders are in
 * PSModulePath. Everywhere else these are skipped; the text of the command
 * file and the helper's environment are tested in stack.test.ts and
 * account.test.ts.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CredentialStore, writeCommands, type Session } from "../src/index.js";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-windows-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const SERVICE = "https://parts.example";
const session = (over: Partial<Session> = {}): Session => ({ service: SERVICE, uid: "u1", email: "ada@example.com", refreshToken: "refresh-1", apiKey: "key", signedInAt: "2026-10-05T00:00:00.000Z", via: "browser", ...over });

describe("on Windows itself", () => {
  it.runIf(process.platform === "win32")("a failed command's exit code comes back through the command file, to cmd and to PowerShell (PB-1226)", () => {
    const home = join(TMP, "home-exit");
    mkdirSync(join(home, "bin"), { recursive: true });
    const cli = join(home, "cli.mjs");
    writeFileSync(cli, 'console.log("ran " + process.argv.slice(2).join(","));\nprocess.exitCode = Number(process.argv[2] ?? 0);\n');
    const file = writeCommands(join(home, "bin"), { kind: "home", cli, home }).find((f) => f.endsWith("protoboard.cmd"))!;
    const root = process.env.SystemRoot ?? "C:\\Windows";
    for (const code of [0, 1, 2, 7]) {
      const viaCmd = spawnSync(`"${file}" ${code} "b c"`, { shell: true, encoding: "utf8", cwd: home });
      expect(viaCmd.stdout.trim(), `cmd ${code}`).toBe(`ran ${code},b c`);
      expect(viaCmd.status, `cmd ${code}`).toBe(code);
      const viaPowerShell = spawnSync(join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", `& '${file}' ${code}; exit $LASTEXITCODE`], { encoding: "utf8", cwd: home });
      expect(viaPowerShell.status, `powershell ${code}`).toBe(code);
    }
    // what this replaced: the CLI and `exit /b` in one line. PowerShell is given 0 for it, whatever the CLI's code
    const old = join(home, "bin", "old-form.cmd");
    writeFileSync(old, `@echo off\r\nsetlocal\r\nwhere node >nul 2>nul && ( node "${cli}" %* & exit /b )\r\nexit /b 127\r\n`);
    const before = spawnSync(join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", `& '${old}' 7; exit $LASTEXITCODE`], { encoding: "utf8", cwd: home });
    expect(before.status).toBe(0);
  });

  it.runIf(process.platform === "win32")("a sign-in is saved and read back with PowerShell 7's module folders in PSModulePath (PB-1226)", () => {
    const local = mkdtempSync(join(TMP, "local-"));
    // what a PowerShell 7 terminal hands down: its own module folders ahead of Windows PowerShell's
    const seven = ["C:\\Program Files\\PowerShell\\Modules", "C:\\Program Files\\PowerShell\\7\\Modules", process.env.PSModulePath ?? ""].join(";");
    const store = new CredentialStore({ env: { ...process.env, LOCALAPPDATA: local, APPDATA: local, PSModulePath: seven, PROTOBOARD_CREDENTIAL_STORE: "dpapi" }, platform: "win32" });
    store.put(session({ refreshToken: "refresh-secret" }));
    expect(readFileSync(store.dpapiFile, "utf8")).not.toContain("refresh-secret");
    expect(store.get(SERVICE)?.refreshToken).toBe("refresh-secret");
  });
});
