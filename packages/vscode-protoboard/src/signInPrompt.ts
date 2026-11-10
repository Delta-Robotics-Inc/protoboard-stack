/**
 * The sign-in prompt: one input box at the top of the window while
 * `protoboard login` waits. The link opens in the browser (the person's own,
 * in a remote window too); the box closes by itself when the page hands the
 * sign-in over, and takes the code the page shows when it cannot.
 *
 * This module has no `vscode` import: the box and the CLI process are given
 * to it, so the flow is tested as it is.
 */

/** The input box, as much of VS Code's `InputBox` as the prompt uses. */
export interface PromptBox {
  title: string;
  placeholder: string;
  prompt: string;
  value: string;
  busy: boolean;
  validationMessage: string | undefined;
  show(): void;
  hide(): void;
  /** Enter. */
  onAccept(run: () => void): void;
  /** A title-bar button, by its id. */
  onButton(run: (id: "open" | "copy") => void): void;
  /** Hidden by the person (Escape) or by `hide`. */
  onHide(run: () => void): void;
  onChange(run: () => void): void;
}

/** A running `protoboard login --wait --format json`. */
export interface LoginProcess {
  /** A line of its standard output. */
  onLine(run: (line: string) => void): void;
  /** It ended, with its exit code and what it last said on standard error. */
  onExit(run: (code: number | null, lastError: string) => void): void;
  /** A line for its standard input (a code). */
  write(line: string): void;
  kill(): void;
}

export interface PromptHost {
  box(): PromptBox;
  start(): LoginProcess;
  /** Open the link in the person's browser; false when it could not. */
  open(url: string): Promise<boolean> | boolean;
  copy(text: string): Promise<void> | void;
  log(line: string): void;
}

export type PromptResult = { signedIn: true; email?: string } | { signedIn: false; reason: "cancelled" } | { signedIn: false; reason: "failed"; message: string };

export const PROMPT_TEXT = {
  title: "Sign in to Protoboard",
  placeholder: "Paste the code from your browser",
  waiting: "Finish signing in in your browser. This closes by itself.",
  mismatch: "That code doesn't match. Check it and try again.",
  pending: "Sign in on the page first. It shows a code only if it cannot reach this window.",
  expired: "That code has expired. Press Enter for a new link.",
  noBrowser: "No browser opened here. Copy the link with the button above and open it on any device.",
} as const;

/**
 * Run the prompt until the sign-in is done, cancelled or failed. One box
 * throughout: a new link after an expiry reuses it.
 */
export function runSignInPrompt(host: PromptHost): Promise<PromptResult> {
  return new Promise((resolve) => {
    const box = host.box();
    box.title = PROMPT_TEXT.title;
    box.placeholder = PROMPT_TEXT.placeholder;
    box.prompt = PROMPT_TEXT.waiting;
    box.busy = true;
    let url: string | undefined;
    let proc: LoginProcess | undefined;
    let over = false;
    let expired = false;
    const end = (r: PromptResult) => {
      if (over) return;
      over = true;
      proc?.kill();
      box.hide();
      resolve(r);
    };
    const begin = () => {
      expired = false;
      url = undefined;
      box.value = "";
      box.validationMessage = undefined;
      box.prompt = PROMPT_TEXT.waiting;
      box.busy = true;
      const p = host.start();
      proc = p;
      let signedIn: { email?: string } | undefined;
      p.onLine((line) => {
        if (over || p !== proc) return;
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (e.event === "link" && typeof e.url === "string") {
          url = e.url;
          void Promise.resolve(host.open(e.url)).then((ok) => {
            if (!ok && !over && p === proc) box.prompt = PROMPT_TEXT.noBrowser;
          });
        } else if (e.event === "code") {
          box.busy = true;
          box.validationMessage = e.status === "mismatch" ? PROMPT_TEXT.mismatch : PROMPT_TEXT.pending;
        } else if (e.event === "expired") {
          expired = true;
          box.busy = false;
          box.validationMessage = PROMPT_TEXT.expired;
        } else if (e.prompt === "approve this code" && typeof e.userCode === "string") {
          // a service from before sign-in by link: its code is approved on its own page
          const page = typeof e.verificationUriComplete === "string" ? e.verificationUriComplete : typeof e.verificationUri === "string" ? e.verificationUri : undefined;
          url = page;
          box.placeholder = "";
          box.prompt = `Approve this code on the page that opened: ${e.userCode}`;
          if (page) void host.open(page);
        } else if (e.signedIn === true) {
          signedIn = { ...(typeof e.email === "string" ? { email: e.email } : {}) };
        } else if (e.signedIn === false && typeof e.message === "string" && !expired) {
          end({ signedIn: false, reason: "failed", message: e.message });
        }
      });
      p.onExit((code, lastError) => {
        if (over || p !== proc) return;
        if (signedIn) return end({ signedIn: true, ...signedIn });
        // a CLI from before sign-in by link prints its result as indented JSON, which no line of it parses:
        // its exit says the sign-in was saved
        if (code === 0) return end({ signedIn: true });
        // an expired link ends the command: the box stays, and Enter starts another
        if (expired) return;
        end({ signedIn: false, reason: "failed", message: lastError || `the sign-in ended with exit code ${code}` });
      });
    };
    box.onAccept(() => {
      if (over) return;
      if (expired) return begin();
      const code = box.value.trim();
      if (!code) return;
      box.validationMessage = undefined;
      box.busy = true;
      proc?.write(code);
    });
    box.onChange(() => {
      if (!expired) box.validationMessage = undefined;
    });
    box.onButton((id) => {
      if (!url) return;
      if (id === "copy") void host.copy(url);
      else void host.open(url);
    });
    box.onHide(() => end({ signedIn: false, reason: "cancelled" }));
    box.show();
    begin();
  });
}
