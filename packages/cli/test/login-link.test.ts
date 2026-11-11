/**
 * `protoboard login` at a terminal and behind a program (login.ts): what is
 * printed, the keys a waiting terminal takes, the code typed when the page
 * shows one, a wrong code, an expired link, and the JSON lines a program
 * reads. The sign-in itself is a stand-in here; core's tests and the
 * emulator run cover it against a service.
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AccountError, type CodeResult, type LinkLogin, type Session } from "@protoboardai/core";
import { copyToClipboard, runLinkLogin, type LoginIo } from "../src/login.js";

const SERVICE = "https://parts.example";
const session: Session = { service: SERVICE, uid: "u9", email: "grace@example.com", refreshToken: "r", apiKey: "k", signedInAt: "2026-11-10T00:00:00.000Z", via: "link" };

/** A sign-in the test settles: `code` is the one the page would show. */
function standIn(code = "BDFG-HJKL") {
  const started: { client?: string }[] = [];
  const logins: { finish: (s: Session) => void; expire: () => void; cancelled: boolean }[] = [];
  const start = (async (_service: string, options: { client?: string } = {}) => {
    started.push({ ...(options.client ? { client: options.client } : {}) });
    let finish!: (s: Session) => void;
    let fail!: (e: Error) => void;
    const done = new Promise<Session>((ok, ko) => {
      finish = ok;
      fail = ko;
    });
    done.catch(() => undefined);
    let attempts = 0;
    const control = { finish, expire: () => fail(new AccountError("SIGN_IN_EXPIRED", "expired")), cancelled: false };
    logins.push(control);
    const login: LinkLogin = {
      url: `https://account.example/login?r=request${String(logins.length).padStart(5, "0")}`,
      requestId: `request${String(logins.length).padStart(5, "0")}`,
      expiresIn: 600,
      done,
      cancel: () => {
        control.cancelled = true;
        fail(new AccountError("SIGN_IN_FAILED", "sign-in cancelled"));
      },
      submitCode: async (typed): Promise<CodeResult> => {
        if (typed.toUpperCase().replace(/[^A-Z]/g, "") === code.replace("-", "")) {
          finish(session);
          return { status: "signed-in", session };
        }
        if (++attempts >= 2) {
          control.expire();
          return { status: "expired" };
        }
        return { status: "mismatch", attemptsLeft: 5 - attempts };
      },
    };
    return login;
  }) as never;
  return { start, started, logins };
}

/** A terminal: what was written, the events emitted, and keys to press. */
function terminal(options: { interactive?: boolean; remote?: boolean; opens?: boolean; copies?: boolean } = {}) {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: (raw: boolean) => unknown };
  const raw: boolean[] = [];
  if (options.interactive ?? true) {
    input.isTTY = true;
    input.setRawMode = (r: boolean) => void raw.push(r);
  }
  let written = "";
  const events: Record<string, unknown>[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const io: LoginIo = {
    write: (t) => void (written += t),
    emit: (e) => void events.push(e),
    input,
    interactive: options.interactive ?? true,
    open: (url) => (opened.push(url), options.opens ?? true),
    copy: (text) => (copied.push(text), options.copies ?? true),
    remote: options.remote ?? false,
  };
  const tick = () => new Promise((r) => setTimeout(r, 5));
  return { io, input, raw, opened, copied, events, text: () => written, press: async (keys: string) => (input.write(keys), tick()), tick };
}

describe("protoboard login at a terminal", () => {
  it("prints the link, opens it, and offers the keys and the code line; the page's hand-off ends it with nothing typed", async () => {
    const s = standIn();
    const t = terminal();
    const run = runLinkLogin(SERVICE, t.io, { json: false, start: s.start });
    await t.tick();
    expect(t.opened).toEqual(["https://account.example/login?r=request00001"]);
    expect(t.text()).toBe(["Sign in to Protoboard", "", "  https://account.example/login?r=request00001", "", "Opened in your browser.", "c copy link   o open again   Ctrl+C cancel", "", "Paste the code here if your browser shows one: "].join("\n"));
    s.logins[0]!.finish(session);
    expect(await run).toBe(session);
    // the terminal is given back as it was
    expect(t.raw).toEqual([true, false]);
  });

  it("over SSH, or with no display: the link is for any device, and nothing is opened", async () => {
    const s = standIn();
    const t = terminal({ remote: true });
    const run = runLinkLogin(SERVICE, t.io, { json: false, start: s.start });
    await t.tick();
    expect(t.opened).toEqual([]);
    expect(t.text()).toContain("Open this link on any device:\n  https://account.example/login?r=request00001");
    expect(t.text()).toContain("c copy link   Ctrl+C cancel");
    expect(t.text()).not.toContain("open again");
    // `o` does nothing here
    await t.press("o");
    expect(t.opened).toEqual([]);
    await t.press("BDFG-HJKL\r");
    expect((await run).email).toBe("grace@example.com");
  });

  it("c copies the link and o opens it again, without starting a code", async () => {
    const s = standIn();
    const t = terminal();
    const run = runLinkLogin(SERVICE, t.io, { json: false, start: s.start });
    await t.tick();
    await t.press("c");
    expect(t.copied).toEqual(["https://account.example/login?r=request00001"]);
    expect(t.text()).toContain("Link copied.\nPaste the code here if your browser shows one: ");
    await t.press("o");
    expect(t.opened).toHaveLength(2);
    expect(t.text()).toContain("Opened again.");
    s.logins[0]!.finish(session);
    await run;
  });

  it("a pasted code signs in; a wrong one says so and the line is asked again", async () => {
    const s = standIn();
    const t = terminal();
    const run = runLinkLogin(SERVICE, t.io, { json: false, start: s.start });
    await t.tick();
    // a paste arrives as one chunk, wrapped in bracketed-paste marks by some terminals
    await t.press("\x1b[200~LKJH-GFDB\x1b[201~");
    await t.press("\r");
    expect(t.text()).toContain("That code doesn't match. Check it and try again.\nPaste the code here if your browser shows one: ");
    // typed a key at a time, with a slip corrected
    for (const k of "bdfx") await t.press(k);
    await t.press("\x7f");
    for (const k of "g-hjkl") await t.press(k);
    await t.press("\r");
    expect((await run).uid).toBe("u9");
  });

  it("an expired link asks for Enter and starts a new one", async () => {
    const s = standIn();
    const t = terminal();
    const run = runLinkLogin(SERVICE, t.io, { json: false, start: s.start });
    await t.tick();
    await t.press("ZZZZ-ZZZZ\r");
    await t.press("ZZZZ-ZZZZ\r");
    expect(t.text()).toContain("That code has expired. Press Enter for a new link.");
    await t.press("\r");
    await t.tick();
    expect(s.logins).toHaveLength(2);
    expect(t.text()).toContain("https://account.example/login?r=request00002");
    await t.press("BDFG-HJKL\r");
    expect((await run).uid).toBe("u9");
  });

  it("a sign-in that could not be saved ends the command with the reason, and never says signed in (PB-1226)", async () => {
    const s = standIn();
    const start = (async (...args: unknown[]) => {
      const login = (await (s.start as (...a: unknown[]) => Promise<LinkLogin>)(...args)) as LinkLogin;
      return { ...login, submitCode: async () => Promise.reject(new AccountError("NOT_SAVED", "the sign-in could not be saved, so you are not signed in: could not encrypt the sign-in with Windows' DPAPI")) };
    }) as never;
    const t = terminal();
    const run = runLinkLogin(SERVICE, t.io, { json: false, start });
    run.catch(() => undefined);
    await t.tick();
    await t.press("BDFG-HJKL\r");
    await expect(run).rejects.toMatchObject({ code: "NOT_SAVED", message: expect.stringContaining("could not be saved, so you are not signed in") });
    expect(t.text()).not.toMatch(/signed in as|✓/i);
    // nothing is left waiting, and the terminal is given back
    expect(s.logins[0]!.cancelled).toBe(true);
    expect(t.raw).toEqual([true, false]);
  });

  it("Ctrl+C cancels the sign-in and gives the terminal back", async () => {
    const s = standIn();
    const t = terminal();
    const run = runLinkLogin(SERVICE, t.io, { json: false, start: s.start });
    await t.tick();
    const cancelled = expect(run).rejects.toMatchObject({ code: "SIGN_IN_FAILED" });
    await t.press("\x03");
    await cancelled;
    expect(s.logins[0]!.cancelled).toBe(true);
    expect(t.raw.at(-1)).toBe(false);
  });
});

describe("protoboard login --wait --format json (a program drives it)", () => {
  it("emits the link, takes codes as lines, and reports a wrong one", async () => {
    const s = standIn();
    const t = terminal({ interactive: false });
    const run = runLinkLogin(SERVICE, t.io, { json: true, noBrowser: true, client: "vscode", start: s.start });
    await t.tick();
    expect(s.started).toEqual([{ client: "vscode" }]);
    // the program opens the link itself
    expect(t.opened).toEqual([]);
    expect(t.events).toEqual([{ event: "link", url: "https://account.example/login?r=request00001", expiresIn: 600, opened: false }]);
    await t.press("LKJH-GFDB\n");
    expect(t.events.at(-1)).toEqual({ event: "code", status: "mismatch", attemptsLeft: 4 });
    await t.press("BDFG-HJKL\n");
    expect((await run).email).toBe("grace@example.com");
    // nothing for a person was written
    expect(t.text()).toBe("");
  });

  it("an expired link ends it: the program starts another", async () => {
    const s = standIn();
    const t = terminal({ interactive: false });
    const run = runLinkLogin(SERVICE, t.io, { json: true, noBrowser: true, start: s.start });
    await t.tick();
    const expired = expect(run).rejects.toMatchObject({ code: "SIGN_IN_EXPIRED" });
    s.logins[0]!.expire();
    await expired;
    expect(t.events.at(-1)).toEqual({ event: "expired" });
  });

  it("a service from before sign-in by link is passed up before anything is shown", async () => {
    const t = terminal();
    const old = (async () => {
      throw new AccountError("LINK_UNSUPPORTED", "an older service");
    }) as never;
    await expect(runLinkLogin(SERVICE, t.io, { json: false, start: old })).rejects.toMatchObject({ code: "LINK_UNSUPPORTED" });
    expect(t.text()).toBe("");
  });
});

describe("copying the link", () => {
  it("goes through the terminal (OSC 52), and through the desktop's tool when this machine has one", () => {
    let written = "";
    const ran: string[] = [];
    const run = ((command: string) => (ran.push(command), { status: 0 })) as never;
    expect(copyToClipboard("https://x.example/y", { write: (s) => void (written += s), env: { WAYLAND_DISPLAY: "wayland-0" }, platform: "linux", run })).toBe(true);
    expect(written).toBe(`\x1b]52;c;${Buffer.from("https://x.example/y").toString("base64")}\x07`);
    expect(ran).toEqual(["wl-copy"]);
  });

  it("over SSH only the terminal is asked: the far machine's clipboard is nobody's", () => {
    const ran: string[] = [];
    const run = ((command: string) => (ran.push(command), { status: 0 })) as never;
    expect(copyToClipboard("x", { write: () => undefined, env: { SSH_CONNECTION: "1 2 3 4", DISPLAY: ":0" }, platform: "linux", run })).toBe(true);
    expect(ran).toEqual([]);
    // no terminal and no tool: nothing could
    expect(copyToClipboard("x", { tty: false, env: {}, platform: "linux", run })).toBe(false);
  });
});
