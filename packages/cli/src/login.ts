/**
 * `protoboard login` at a terminal, and for a program that drives it.
 *
 * One command, the same link from any machine: the link is printed and
 * opened where there is a browser; the terminal then waits for the page's
 * hand-off and for a typed code at the same time, and the first one signs
 * in. So the line asking for the code is always there, and reads as
 * optional: the page shows a code only when it could not reach this
 * terminal (another machine, a browser that blocks it).
 *
 * A program (the VS Code extension) runs it with `--wait --format json`:
 * events are JSON lines on stdout, and each line on stdin is a code.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { AccountError, startLinkLogin, type CredentialStore, type LinkLogin, type Session } from "@protoboardai/core";

export interface LoginIo {
  /** Text for the person, as written (no newline added). */
  write(text: string): void;
  /** A machine event (JSON mode). */
  emit(event: Record<string, unknown>): void;
  /** Where keys and codes come from. */
  input: Readable & { isTTY?: boolean; setRawMode?: (raw: boolean) => unknown };
  /** A person is typing at a terminal: keys are read one at a time, and `c` and `o` are commands. */
  interactive: boolean;
  /** Give the link to this machine's browser; false when it could not be tried. */
  open(url: string): boolean;
  /** Put the link on the clipboard; false when nothing could. */
  copy(text: string): boolean;
  /** No browser here (over SSH, no display): the link is for another device. */
  remote: boolean;
}

export interface LinkLoginRun {
  store?: CredentialStore;
  json: boolean;
  /** Do not open the browser (the caller does, or nobody should). */
  noBrowser?: boolean;
  client?: "vscode" | "terminal";
  /** Tests: start the sign-in themselves. */
  start?: typeof startLinkLogin;
}

type Key = { type: "line"; text: string } | { type: "key"; key: "c" | "o" } | { type: "cancel" } | { type: "end" };

/**
 * Keys and lines from the input. At a terminal, one key at a time: `c` and
 * `o` on an empty line are commands (a code never has either letter), Enter
 * ends a line, Ctrl+C cancels. Otherwise whole lines.
 */
function readKeys(io: LoginIo, on: (k: Key) => void): () => void {
  const input = io.input;
  if (io.interactive && input.setRawMode) {
    let line = "";
    input.setRawMode(true);
    input.resume();
    const data = (chunk: Buffer | string) => {
      // a paste arrives as one chunk, wrapped in bracketed-paste marks by some terminals: keep its text
      const text = String(chunk).replace(/\x1b\[[0-9;]*[~A-Za-z]/g, "");
      const single = text.length === 1;
      for (const ch of text) {
        if (ch === "\x03") return on({ type: "cancel" });
        if (ch === "\x04") return on({ type: "end" });
        if (ch === "\r" || ch === "\n") {
          io.write("\n");
          const done = line;
          line = "";
          on({ type: "line", text: done });
          continue;
        }
        if (ch === "\x7f" || ch === "\b") {
          if (line) {
            line = line.slice(0, -1);
            io.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue;
        if (single && !line && (ch === "c" || ch === "C" || ch === "o" || ch === "O")) {
          on({ type: "key", key: ch.toLowerCase() as "c" | "o" });
          continue;
        }
        line += ch;
        io.write(ch);
      }
    };
    input.on("data", data);
    return () => {
      input.off("data", data);
      input.setRawMode?.(false);
      input.pause();
    };
  }
  const rl = createInterface({ input, terminal: false });
  rl.on("line", (text) => on({ type: "line", text }));
  rl.on("close", () => on({ type: "end" }));
  return () => rl.close();
}

const PROMPT = "Paste the code here if your browser shows one: ";

/**
 * Sign in by link, waiting here until the page's hand-off or a typed code
 * does it. Resolves with the session; rejects with an AccountError
 * (`LINK_UNSUPPORTED` from a service without this sign-in, before anything
 * is shown).
 */
export async function runLinkLogin(service: string, io: LoginIo, run: LinkLoginRun): Promise<Session> {
  const start = run.start ?? startLinkLogin;
  for (;;) {
    const login: LinkLogin = await start(service, { ...(run.store ? { store: run.store } : {}), client: run.client ?? "terminal" });
    const opened = !run.noBrowser && !io.remote && io.open(login.url);
    const show = () => {
      if (run.json) return io.emit({ event: "link", url: login.url, expiresIn: login.expiresIn, opened });
      io.write(
        [
          "Sign in to Protoboard",
          "",
          ...(opened ? [] : ["Open this link on any device:"]),
          `  ${login.url}`,
          "",
          ...(opened ? ["Opened in your browser."] : []),
          ...(io.interactive ? [`c copy link${io.remote || run.noBrowser ? "" : "   o open again"}   Ctrl+C cancel`, ""] : []),
          PROMPT,
        ].join("\n"),
      );
    };
    show();
    let stop: () => void = () => undefined;
    let busy = false;
    const outcome = await new Promise<Session | "expired">((resolve, reject) => {
      login.done.then(resolve, (e: unknown) => (e instanceof AccountError && e.code === "SIGN_IN_EXPIRED" ? resolve("expired") : reject(e as Error)));
      const say = (line: string) => (run.json ? undefined : io.write(`${line}\n${PROMPT}`));
      stop = readKeys(io, (k) => {
        if (k.type === "cancel") return login.cancel();
        if (k.type === "end") return;
        if (k.type === "key") {
          if (k.key === "c") return say(io.copy(login.url) ? "Link copied." : "Could not reach a clipboard here: select the link above.");
          if (io.remote || run.noBrowser) return;
          return say(io.open(login.url) ? "Opened again." : "Could not open a browser here: use the link above.");
        }
        const code = k.text.trim();
        if (!code) return run.json ? undefined : io.write(PROMPT);
        if (busy) return;
        busy = true;
        void login
          .submitCode(code)
          .then((r) => {
            if (r.status === "mismatch") {
              if (run.json) io.emit({ event: "code", status: "mismatch", attemptsLeft: r.attemptsLeft });
              else say("That code doesn't match. Check it and try again.");
            } else if (r.status === "pending") {
              if (run.json) io.emit({ event: "code", status: "pending" });
              else say("Nobody has signed in on that page yet. Sign in there first.");
            }
            // signed in, or expired: `done` settles and ends the wait
          })
          .catch((e) => {
            // the run ends here: the listener is closed with it, or the process would stay until the link expires
            login.cancel();
            reject(e);
          })
          .finally(() => (busy = false));
      });
    }).finally(() => stop());
    if (outcome !== "expired") return outcome;
    if (run.json) io.emit({ event: "expired" });
    // nobody to ask for another try: the caller starts again
    if (!io.interactive) throw new AccountError("SIGN_IN_EXPIRED", "That code has expired. Run `protoboard login` again for a new link.");
    io.write("That code has expired. Press Enter for a new link.");
    const again = await new Promise<boolean>((resolve) => {
      const end = readKeys(io, (k) => {
        if (k.type === "line" || k.type === "cancel" || k.type === "end") {
          end();
          resolve(k.type === "line");
        }
      });
    });
    if (!again) throw new AccountError("SIGN_IN_FAILED", "sign-in cancelled");
  }
}

/**
 * Put text on the clipboard: through the terminal itself (OSC 52, which
 * also reaches the person's own machine over SSH in terminals that allow
 * it), and through the desktop's tool when this machine has one. True when
 * either was tried with no error.
 */
export function copyToClipboard(text: string, options: { write?: (s: string) => void; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; run?: typeof spawnSync; tty?: boolean } = {}): boolean {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const run = options.run ?? spawnSync;
  let done = false;
  if (options.tty ?? true) {
    (options.write ?? ((s: string) => process.stderr.write(s)))(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
    done = true;
  }
  // over SSH the desktop tools would reach the far machine's clipboard, which nobody is looking at
  if (env.SSH_CONNECTION) return done;
  const tools: [string, string[]][] =
    platform === "darwin"
      ? [["pbcopy", []]]
      : platform === "win32"
        ? [["clip.exe", []]]
        : [...(env.WAYLAND_DISPLAY ? ([["wl-copy", []]] as [string, string[]][]) : []), ...(env.DISPLAY ? ([["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]] as [string, string[]][]) : [])];
  for (const [command, args] of tools) {
    try {
      const r = run(command, args, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 2000 });
      if (!r.error && r.status === 0) return true;
    } catch {
      // not installed: the next one
    }
  }
  return done;
}
