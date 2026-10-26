/**
 * Opening a URL in the default browser (first builds review, items 22 and W1):
 * on Windows the sign-in link was cut at its first `&` because it went
 * through `cmd /c start`. The command is built for a platform given as an
 * argument, so Windows is tested here without a Windows machine.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CredentialStore, loginWithBrowser } from "@protoboardai/core";
import { openCommands, openUrl } from "../src/openUrl.js";

const SIGN_IN = "https://dl.example/login?callback=http%3A%2F%2F127.0.0.1%3A54329%2Fcallback&state=AbC-_123&service=https%3A%2F%2Fparts.example";
const WIN = { SystemRoot: "C:\\Windows" };

describe("openCommands", () => {
  it("Windows: the URL is one argument of a program that is not cmd, with its &, %3A and = as they are", () => {
    const [first, second] = openCommands(SIGN_IN, "win32", WIN);
    expect(first).toEqual({ command: "C:\\Windows\\System32\\rundll32.exe", args: ["url.dll,FileProtocolHandler", SIGN_IN], verbatim: true });
    // the fallback: PowerShell, the URL in single quotes (nothing in them is interpreted)
    expect(second!.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(second!.args).toEqual(["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${SIGN_IN}'`]);
    for (const c of [first!, second!]) {
      expect(c.command.toLowerCase()).not.toContain("cmd");
      expect(c.args.join(" ")).not.toMatch(/\bstart\s+""/);
      // the whole link, in one argument
      expect(c.args.filter((a) => a.includes(SIGN_IN))).toHaveLength(1);
    }
  });

  it("Windows: every parameter of the link survives the command line Windows builds from the arguments", () => {
    // rundll32 is given the arguments joined by spaces (verbatim): what follows the entry point is the URL
    const [first] = openCommands(SIGN_IN, "win32", WIN);
    const line = first!.args.join(" ");
    const opened = new URL(line.slice("url.dll,FileProtocolHandler ".length));
    expect(opened.href).toBe(SIGN_IN);
    expect(opened.searchParams.get("callback")).toBe("http://127.0.0.1:54329/callback");
    expect(opened.searchParams.get("state")).toBe("AbC-_123");
    expect(opened.searchParams.get("service")).toBe("https://parts.example");
  });

  it("Windows: a quote or a space cannot end the argument early", () => {
    const [first, second] = openCommands(`https://x.example/a b?q="1"&r='2'`, "win32", WIN);
    expect(first!.args[1]).toBe("https://x.example/a%20b?q=%221%22&r='2'");
    expect(second!.args[3]).toBe("Start-Process 'https://x.example/a%20b?q=%221%22&r=''2'''");
  });

  it("Windows: without SystemRoot it still names a full path", () => {
    expect(openCommands("https://x.example/", "win32", {})[0]!.command).toBe("C:\\Windows\\System32\\rundll32.exe");
  });

  it("macOS and Linux: the URL is the one argument of open or xdg-open (no shell)", () => {
    expect(openCommands(SIGN_IN, "darwin")).toEqual([{ command: "open", args: [SIGN_IN] }]);
    expect(openCommands(SIGN_IN, "linux")).toEqual([{ command: "xdg-open", args: [SIGN_IN] }]);
  });
});

describe("protoboard login: the link that reaches the browser is the link that was made", () => {
  const dir = mkdtempSync(join(tmpdir(), "pb-open-url-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("the URL handed to the opener carries callback, state and service, equals the printed one, and is passed whole on every platform", async () => {
    const discovery = { protocol: "uhd-library/v1", api: "/v1", account: { provider: "firebase", apiKey: "key", projectId: "demo", signInUrl: "https://dl.example/login" } };
    const service = (async (url: string | URL | Request) => (String(url).endsWith("/.well-known/uhd-library") || String(url).endsWith("/v1") ? Response.json(discovery) : new Response("", { status: 404 }))) as typeof fetch;
    const store = new CredentialStore({ env: { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" } });
    let opened = "";
    const lines: string[] = [];
    const stop = new AbortController();
    const done = loginWithBrowser("https://parts.example", (url) => (opened = url), { store, fetch: service, log: (l) => lines.push(l), signal: stop.signal }).catch((e: Error) => e);
    for (let i = 0; i < 100 && !opened; i++) await new Promise((r) => setTimeout(r, 20));
    stop.abort();
    await done;

    const u = new URL(opened);
    expect(u.searchParams.get("callback")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(u.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(u.searchParams.get("service")).toBe("https://parts.example");
    // the link the terminal prints (the one that worked when pasted) is the same link
    expect(lines.join("\n")).toContain(`\n  ${opened}`);
    // and each platform's opener is given exactly it
    for (const platform of ["win32", "darwin", "linux"] as const) {
      for (const c of openCommands(opened, platform, WIN)) expect(c.args.some((a) => a === opened || a === `Start-Process '${opened}'`), `${platform} ${c.command}`).toBe(true);
    }
  });
});

describe("openUrl hands only https pages (http on this machine) to the system's opener (PB-1048)", () => {
  it("refuses file:, other schemes and plain http elsewhere, and starts nothing for them", () => {
    const started: string[][] = [];
    const run = ((command: string, args: string[]) => {
      started.push([command, ...args]);
      return { on: () => {}, unref: () => {} };
    }) as unknown as Parameters<typeof openUrl>[1];
    for (const u of ["file:///etc/passwd", "http://login.example/", "javascript:alert(1)", "vscode://ext/x", "\\\\host\\share", "smb://host/x"]) expect(openUrl(u, run), u).toBe(false);
    expect(started).toEqual([]);
    expect(openUrl(SIGN_IN, run)).toBe(true);
    expect(openUrl("http://127.0.0.1:5173/", run)).toBe(true);
    expect(started.map((c) => c.at(-1))).toEqual(expect.arrayContaining([expect.stringContaining("127.0.0.1:5173")]));
    expect(started).toHaveLength(2);
  });

  it("a service whose sign-in page is plain http elsewhere is refused before anything opens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pb-open-http-"));
    try {
      const f = (async () => Response.json({ protocol: "uhd-library/v1", api: "/v1", account: { provider: "firebase", apiKey: "k", signInUrl: "http://login.example/login" } })) as typeof fetch;
      const opened: string[] = [];
      await expect(loginWithBrowser("https://parts.example", (u) => opened.push(u), { fetch: f, store: new CredentialStore({ env: { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" } }) })).rejects.toMatchObject({
        code: "NO_SIGN_IN",
        message: expect.stringMatching(/not an https page/),
      });
      expect(opened).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
