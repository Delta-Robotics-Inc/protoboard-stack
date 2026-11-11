/**
 * The process behind the sign-in prompt (cli.ts `loginProcess`): started with
 * pipes whatever runs the CLI, so a machine with no Node.js 22, where the CLI
 * runs on the editor's own runtime, gets its link like any other. (That
 * runtime prints nothing into a pseudo-terminal on Windows: a sign-in shown
 * in a terminal stayed empty there.)
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseRuntime, loginProcess, loginTreeKill, type CliCommand } from "../src/cli.js";
import { runSignInPrompt, type PromptBox } from "../src/signInPrompt.js";

const dir = mkdtempSync(join(tmpdir(), "pb-sign-in-process-"));
/** A stand-in for `protoboard login --wait --format json`: the link, then an answer to each line it is given. */
const script = join(dir, "login.mjs");
writeFileSync(
  script,
  `process.stdout.write(JSON.stringify({ event: "link", url: "https://account.example/login?r=abc", expiresIn: 600, opened: false, runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null, client: process.env.PROTOBOARD_LOGIN_CLIENT ?? null }) + "\\n");
let pending = "";
process.stdin.on("data", (d) => {
  pending += d;
  if (!pending.includes("\\n")) return;
  const code = pending.trim();
  if (code === "RIGHT") {
    process.stdout.write(JSON.stringify({ signedIn: true, email: "grace@example.com" }) + "\\n");
    process.exit(0);
  }
  pending = "";
  process.stdout.write(JSON.stringify({ event: "code", status: "mismatch", attemptsLeft: 4 }) + "\\n");
});
`,
);

/** The CLI as a machine with no Node.js runs it: the editor's own runtime, told to be Node. */
function cliWithoutNode(): CliCommand {
  const runtime = chooseRuntime({ command: "node", from: "missing" }, { execPath: process.execPath, version: process.version, electron: true });
  expect(runtime).toMatchObject({ from: "vscode", command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } });
  return { command: runtime.command, args: [script], from: "carried", ...(runtime.env ? { env: runtime.env } : {}) };
}

function box(): PromptBox & { accept(): void; shown: boolean } {
  let accept = () => {};
  const b = {
    title: "",
    placeholder: "",
    prompt: "",
    value: "",
    busy: false,
    validationMessage: undefined as string | undefined,
    shown: false,
    show: () => void (b.shown = true),
    hide: () => void (b.shown = false),
    onAccept: (run: () => void) => void (accept = run),
    onButton: () => {},
    onHide: () => {},
    onChange: () => {},
    accept: () => accept(),
  };
  return b;
}

describe("the sign-in process, with no Node.js on the machine", () => {
  it("answers through pipes on the editor's own runtime: the link out, a code in, its exit", async () => {
    const p = loginProcess(cliWithoutNode(), ["login", "--wait", "--no-browser", "--format", "json"], dir, { PROTOBOARD_LOGIN_CLIENT: "vscode" });
    const lines: Record<string, unknown>[] = [];
    const exit = new Promise<number | null>((ok) => p.onExit((code) => ok(code)));
    const link = new Promise<void>((ok) =>
      p.onLine((l) => {
        lines.push(JSON.parse(l));
        if (lines.length === 1) ok();
      }),
    );
    await link;
    expect(lines[0]).toMatchObject({ event: "link", url: "https://account.example/login?r=abc", runAsNode: "1", client: "vscode" });
    p.write("RIGHT");
    expect(await exit).toBe(0);
    expect(lines.at(-1)).toEqual({ signedIn: true, email: "grace@example.com" });
  });

  it("the prompt gets its link and signs in with a typed code", async () => {
    const b = box();
    const opened: string[] = [];
    const cli = cliWithoutNode();
    const done = runSignInPrompt({ box: () => b, start: () => loginProcess(cli, [], dir, {}), open: (url) => (opened.push(url), true), copy: () => {}, log: () => {} });
    await expect.poll(() => opened, { timeout: 10_000 }).toEqual(["https://account.example/login?r=abc"]);
    expect(b.shown).toBe(true);
    b.value = "WRONG";
    b.accept();
    await expect.poll(() => b.validationMessage, { timeout: 10_000 }).toBe("That code doesn't match. Check it and try again.");
    b.value = "RIGHT";
    b.accept();
    expect(await done).toEqual({ signedIn: true, email: "grace@example.com" });
    expect(b.shown).toBe(false);
  });

  it("an older CLI's indented result still counts: its exit code 0 is a sign-in", async () => {
    const older = join(dir, "older.mjs");
    writeFileSync(older, `process.stdout.write(JSON.stringify({ prompt: "approve this code", userCode: "BDFG-HJKL", verificationUri: "https://account.example/device", expiresIn: 600 }) + "\\n");\nsetTimeout(() => { process.stdout.write(JSON.stringify({ service: "https://parts.example", signedIn: true, email: "grace@example.com" }, null, 2) + "\\n"); }, 50);\n`);
    const b = box();
    const opened: string[] = [];
    const done = runSignInPrompt({ box: () => b, start: () => loginProcess({ command: process.execPath, args: [older], from: "project" }, [], dir, {}), open: (url) => (opened.push(url), true), copy: () => {}, log: () => {} });
    expect(await done).toEqual({ signedIn: true, email: "grace@example.com" });
    expect(opened).toEqual(["https://account.example/device"]);
    expect(b.prompt).toBe("Approve this code on the page that opened: BDFG-HJKL");
  });

  it("an older CLI's indented refusal is a refusal, though it exits 0", async () => {
    const refuses = join(dir, "refuses.mjs");
    writeFileSync(refuses, `process.stdout.write(JSON.stringify({ service: "https://parts.example", signedIn: false, message: "this service signs no one in" }, null, 2) + "\\n");\n`);
    const b = box();
    const done = runSignInPrompt({ box: () => b, start: () => loginProcess({ command: process.execPath, args: [refuses], from: "project" }, [], dir, {}), open: () => true, copy: () => {}, log: () => {} });
    expect(await done).toEqual({ signedIn: false, reason: "failed", message: "this service signs no one in" });
  });

  it("a command that cannot start ends the prompt with what went wrong, not a dead surface", async () => {
    const b = box();
    const done = runSignInPrompt({ box: () => b, start: () => loginProcess({ command: join(dir, "no-such-runtime"), args: [], from: "carried" }, [], dir, {}), open: () => true, copy: () => {}, log: () => {} });
    expect(await done).toMatchObject({ signedIn: false, reason: "failed" });
    expect(b.shown).toBe(false);
  });

  it("behind a shell on Windows a cancelled sign-in ends the whole tree, not the shell alone", () => {
    expect(loginTreeKill(4242)).toEqual({ command: "taskkill", args: ["/pid", "4242", "/T", "/F"] });
    const src = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(src).toContain('shell && process.platform === "win32" && proc.pid !== undefined ? loginTreeKill(proc.pid) : undefined');
  });
});
