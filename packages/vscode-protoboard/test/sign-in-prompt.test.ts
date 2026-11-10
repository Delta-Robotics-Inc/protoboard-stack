/**
 * The sign-in prompt (signInPrompt.ts): one input box while `protoboard
 * login` waits behind it. The link opens in the browser, the box closes by
 * itself when the page hands the sign-in over, and takes the code the page
 * shows when it cannot. A box and a process stand in for VS Code's and the
 * CLI's.
 */
import { describe, expect, it } from "vitest";
import { PROMPT_TEXT, runSignInPrompt, type LoginProcess, type PromptBox, type PromptHost } from "../src/signInPrompt.js";

function fakes(options: { opens?: boolean } = {}) {
  const handlers: { accept?: () => void; button?: (id: "open" | "copy") => void; hide?: () => void; change?: () => void } = {};
  const box = {
    title: "",
    placeholder: "",
    prompt: "",
    value: "",
    busy: false,
    validationMessage: undefined as string | undefined,
    shown: false,
    hides: 0,
    show() {
      this.shown = true;
    },
    hide() {
      if (!this.shown) return;
      this.shown = false;
      this.hides++;
      handlers.hide?.();
    },
    onAccept: (run: () => void) => void (handlers.accept = run),
    onButton: (run: (id: "open" | "copy") => void) => void (handlers.button = run),
    onHide: (run: () => void) => void (handlers.hide = run),
    onChange: (run: () => void) => void (handlers.change = run),
  };
  const procs: { line: (l: unknown) => void; exit: (code: number | null, err?: string) => void; written: string[]; killed: boolean }[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const host: PromptHost = {
    box: () => box as PromptBox,
    start: () => {
      let onLine: (l: string) => void = () => undefined;
      let onExit: (code: number | null, err: string) => void = () => undefined;
      const p = { line: (l: unknown) => onLine(typeof l === "string" ? l : JSON.stringify(l)), exit: (code: number | null, err = "") => onExit(code, err), written: [] as string[], killed: false };
      procs.push(p);
      const proc: LoginProcess = { onLine: (run) => void (onLine = run), onExit: (run) => void (onExit = run), write: (l) => void p.written.push(l), kill: () => void (p.killed = true) };
      return proc;
    },
    open: (url) => (opened.push(url), options.opens ?? true),
    copy: (text) => void copied.push(text),
    log: () => undefined,
  };
  const type = (text: string) => {
    box.value = text;
    handlers.change?.();
  };
  return { host, box, procs, opened, copied, type, enter: () => handlers.accept?.(), button: (id: "open" | "copy") => handlers.button?.(id), escape: () => box.hide(), tick: () => new Promise((r) => setTimeout(r, 0)) };
}
const LINK = { event: "link", url: "https://account.example/login?r=abcdefghijkl", expiresIn: 600, opened: false };

describe("the sign-in prompt", () => {
  it("shows one box, opens the link in the browser, and closes by itself when the page hands the sign-in over", async () => {
    const f = fakes();
    const run = runSignInPrompt(f.host);
    expect(f.box).toMatchObject({ shown: true, title: "Sign in to Protoboard", placeholder: "Paste the code from your browser", prompt: PROMPT_TEXT.waiting, busy: true });
    f.procs[0]!.line(LINK);
    expect(f.opened).toEqual([LINK.url]);
    f.procs[0]!.line({ service: "https://parts.example", signedIn: true, email: "grace@example.com" });
    f.procs[0]!.exit(0);
    expect(await run).toEqual({ signedIn: true, email: "grace@example.com" });
    expect(f.box.shown).toBe(false);
  });

  it("takes the code the page shows; a wrong one is said in the box and may be corrected", async () => {
    const f = fakes();
    const run = runSignInPrompt(f.host);
    f.procs[0]!.line(LINK);
    // Enter on an empty box sends nothing
    f.enter();
    expect(f.procs[0]!.written).toEqual([]);
    f.type(" LKJH-GFDB ");
    f.enter();
    expect(f.procs[0]!.written).toEqual(["LKJH-GFDB"]);
    f.procs[0]!.line({ event: "code", status: "mismatch", attemptsLeft: 4 });
    expect(f.box.validationMessage).toBe("That code doesn't match. Check it and try again.");
    // typing again clears the message
    f.type("BDFG-HJKL");
    expect(f.box.validationMessage).toBeUndefined();
    f.enter();
    f.procs[0]!.line({ signedIn: true, email: "grace@example.com" });
    f.procs[0]!.exit(0);
    expect((await run).signedIn).toBe(true);
  });

  it("an expired link keeps the box: Enter starts a new one", async () => {
    const f = fakes();
    const run = runSignInPrompt(f.host);
    f.procs[0]!.line(LINK);
    f.procs[0]!.line({ event: "expired" });
    f.procs[0]!.line({ signedIn: false, message: "That code has expired. Run `protoboard login` again for a new link." });
    f.procs[0]!.exit(1);
    expect(f.box).toMatchObject({ shown: true, busy: false, validationMessage: "That code has expired. Press Enter for a new link." });
    f.enter();
    expect(f.procs).toHaveLength(2);
    expect(f.box).toMatchObject({ busy: true, value: "", validationMessage: undefined });
    const second = { ...LINK, url: "https://account.example/login?r=mnopqrstuvwx" };
    f.procs[1]!.line(second);
    expect(f.opened).toEqual([LINK.url, second.url]);
    // the buttons use the new link
    f.button("copy");
    expect(f.copied).toEqual([second.url]);
    f.procs[1]!.line({ signedIn: true });
    f.procs[1]!.exit(0);
    expect(await run).toEqual({ signedIn: true });
  });

  it("Open link again and Copy link use the link; before there is one they do nothing", async () => {
    const f = fakes();
    const run = runSignInPrompt(f.host);
    f.button("open");
    f.button("copy");
    expect(f.opened).toEqual([]);
    f.procs[0]!.line(LINK);
    f.button("open");
    f.button("copy");
    expect(f.opened).toEqual([LINK.url, LINK.url]);
    expect(f.copied).toEqual([LINK.url]);
    f.escape();
    expect(await run).toEqual({ signedIn: false, reason: "cancelled" });
  });

  it("Escape cancels and stops the command", async () => {
    const f = fakes();
    const run = runSignInPrompt(f.host);
    f.procs[0]!.line(LINK);
    f.escape();
    expect(await run).toEqual({ signedIn: false, reason: "cancelled" });
    expect(f.procs[0]!.killed).toBe(true);
  });

  it("no browser opened here: the box says to copy the link", async () => {
    const f = fakes({ opens: false });
    const run = runSignInPrompt(f.host);
    f.procs[0]!.line(LINK);
    await f.tick();
    expect(f.box.prompt).toBe(PROMPT_TEXT.noBrowser);
    f.escape();
    await run;
  });

  it("a command that ends with an error closes the box with what it said", async () => {
    const f = fakes();
    const run = runSignInPrompt(f.host);
    f.procs[0]!.exit(1, "cannot reach the Protoboard library");
    expect(await run).toEqual({ signedIn: false, reason: "failed", message: "cannot reach the Protoboard library" });
    expect(f.box.shown).toBe(false);
  });

  it("a service from before sign-in by link: its code is shown, to approve on its own page", async () => {
    const f = fakes();
    const run = runSignInPrompt(f.host);
    f.procs[0]!.line({ prompt: "approve this code", userCode: "BCDF-GHJK", verificationUri: "https://account.example/device", expiresIn: 600 });
    expect(f.opened).toEqual(["https://account.example/device"]);
    expect(f.box.prompt).toBe("Approve this code on the page that opened: BCDF-GHJK");
    f.procs[0]!.line({ signedIn: true, email: "grace@example.com" });
    f.procs[0]!.exit(0);
    expect((await run).signedIn).toBe(true);
  });

  it("lines that are not events are ignored", async () => {
    const f = fakes();
    const run = runSignInPrompt(f.host);
    f.procs[0]!.line("not json");
    f.procs[0]!.line(LINK);
    expect(f.opened).toEqual([LINK.url]);
    f.escape();
    await run;
  });
});
