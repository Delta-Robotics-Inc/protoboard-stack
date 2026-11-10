/**
 * The process behind the sign-in prompt (cli.ts `loginProcess`): started with
 * pipes whatever runs the CLI, so a machine with no Node.js 22, where the CLI
 * runs on the editor's own runtime, gets its link like any other. (That
 * runtime prints nothing into a pseudo-terminal on Windows: a sign-in shown
 * in a terminal stayed empty there.)
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseRuntime, loginProcess, type CliCommand } from "../src/cli.js";
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

  it("a command that cannot start ends the prompt with what went wrong, not a dead surface", async () => {
    const b = box();
    const done = runSignInPrompt({ box: () => b, start: () => loginProcess({ command: join(dir, "no-such-runtime"), args: [], from: "carried" }, [], dir, {}), open: () => true, copy: () => {}, log: () => {} });
    expect(await done).toMatchObject({ signedIn: false, reason: "failed" });
    expect(b.shown).toBe(false);
  });
});
