/**
 * The Protoboard Cloud account as the extension shows it (PB-911): read from
 * `protoboard whoami --check --format json`, shown in the status bar and the
 * Cloud view, changed with `protoboard login|logout` in a terminal.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECKING, UNLOCKED, accountCard, accountFromWhoAmI, accountItem, lockOf, signInUnavailable, signInUnavailableMessage, terminalCommand } from "../src/account.js";

const run = (data: unknown, code = 0) => ({ code, stdout: JSON.stringify(data, null, 2) + "\n", stderr: "" });

describe("account state", () => {
  it("signed in: the e-mail's name in the status bar, the rest in the tooltip, sign out on the card", () => {
    const a = accountFromWhoAmI(run({ service: "https://parts.example", signedIn: true, email: "ada@example.com", uid: "u1", via: "browser", store: "the Secret Service keyring (secret-tool)", valid: true, publisher: false }));
    expect(a).toEqual({ state: "signed-in", service: "https://parts.example", email: "ada@example.com", uid: "u1", publisher: false, store: "the Secret Service keyring (secret-tool)" });
    expect(accountItem(a)).toEqual({ text: "$(account) ada", tooltip: "Protoboard: ada@example.com · https://parts.example" });
    // where the sign-in is kept is for whoami and doctor, not the card
    expect(JSON.stringify(accountCard(a))).not.toContain("keyring");
    expect(accountCard(a)).toEqual({ signedIn: true, title: "ada@example.com", note: "https://parts.example", action: "signOut" });
  });

  it("signed out (whoami exits 1): sign in, for the library; the project needs no account", () => {
    const a = accountFromWhoAmI(run({ service: "https://parts.example", signedIn: false, store: "x" }, 1));
    expect(a).toEqual({ state: "signed-out", service: "https://parts.example" });
    expect(accountItem(a).text).toBe("$(account) Sign in");
    expect(accountCard(a)).toMatchObject({ signedIn: false, title: "Not signed in", action: "signIn" });
    expect(accountCard(a).note).toBe("Needed for library parts and prices");
  });

  it("a service that signs no one in (PB_CLOUD_AUTH=none): a neutral state, nothing to sign in to", () => {
    for (const signedIn of [false, true]) {
      const a = accountFromWhoAmI(run({ service: "http://127.0.0.1:8787", signedIn, store: "x", needsAccount: false, ...(signedIn ? { valid: false, problem: "x" } : {}) }));
      expect(a).toEqual({ state: "open", service: "http://127.0.0.1:8787" });
      expect(accountItem(a).text).toBe("$(cloud)");
      expect(accountItem(a).tooltip).toBe("Protoboard: http://127.0.0.1:8787 needs no sign-in");
      expect(accountCard(a)).toEqual({ signedIn: false, title: "No account needed", note: "http://127.0.0.1:8787 needs no sign-in" });
    }
  });

  it("a sign-in the service no longer accepts asks to sign in again", () => {
    const a = accountFromWhoAmI(run({ service: "https://parts.example", signedIn: true, email: "ada@example.com", valid: false, problem: "the sign-in is no longer valid (TOKEN_EXPIRED)" }, 1));
    expect(a).toMatchObject({ state: "expired", email: "ada@example.com" });
    expect(accountItem(a).text).toBe("$(warning) Sign in again");
    expect(accountCard(a).action).toBe("signIn");
  });

  it("an old CLI without whoami, or no CLI: unknown, with the reason", () => {
    const a = accountFromWhoAmI({ code: 2, stdout: "", stderr: "Usage\n  $ protoboard <command>" });
    expect(a).toEqual({ state: "unknown", reason: "$ protoboard <command>" });
    expect(accountItem(a).tooltip).toContain("account state unknown");
  });

  it("quotes the login command for the terminal's shell", () => {
    expect(terminalCommand({ command: "node", args: ["/a b/protoboard.mjs"], from: "project" }, ["login"], "linux")).toBe("node '/a b/protoboard.mjs' login");
    expect(terminalCommand({ command: "node", args: ["C:\\it's\\protoboard.mjs"], from: "project" }, ["login"], "win32")).toBe("& 'node' 'C:\\it''s\\protoboard.mjs' 'login'");
  });
});

describe("the cloud's lock (PB-928): when the library needs a sign-in", () => {
  const whoami = (w: Record<string, unknown>, code = 0) => accountFromWhoAmI(run({ service: "https://parts.example", store: "x", ...w }, code));

  it("follows what the CLI says about access", () => {
    expect(CHECKING).toMatchObject({ locked: true, reason: "checking" });
    const ok = whoami({ signedIn: true, email: "ada@example.com", valid: true, access: { allowed: true, via: "account" } });
    expect(lockOf(ok)).toEqual(UNLOCKED);
    const out = whoami({ signedIn: false, access: { allowed: false, reason: "signed-out", message: "…" } }, 1);
    expect(lockOf(out)).toEqual({ locked: true, reason: "signed-out", message: "Sign in to use the Protoboard library." });
    const refused = whoami({ signedIn: true, email: "eve@elsewhere.example", valid: false, problem: "not invited", access: { allowed: false, reason: "not-invited", email: "eve@elsewhere.example" } }, 1);
    expect(lockOf(refused)).toEqual({ locked: true, reason: "not-invited", message: "eve@elsewhere.example is not invited to the Protoboard library yet. Ask for an invitation or use another account." });
    const gone = whoami({ signedIn: true, email: "ada@example.com", valid: false, problem: "x", access: { allowed: false, reason: "sign-in-invalid" } }, 1);
    expect(lockOf(gone)).toMatchObject({ reason: "sign-in-invalid", message: "Your Protoboard sign-in (ada@example.com) no longer works. Sign in again to use the Protoboard library." });
    const offline = whoami({ signedIn: true, email: "ada@example.com", valid: false, access: { allowed: false, reason: "unreachable" } }, 1);
    expect(lockOf(offline).message).toBe("The Protoboard library could not be reached. Projects work offline.");
    // offline within the seven days, an open service, the service token: all allowed by the CLI
    for (const via of ["offline", "recent", "open-service", "service-token"]) expect(lockOf(whoami({ signedIn: via !== "open-service", access: { allowed: true, via } })).locked).toBe(false);
  });

  it("no message of the lock says Protoboard itself needs an account", () => {
    for (const reason of ["signed-out", "sign-in-invalid", "not-invited", "email-unverified", "unreachable"]) {
      const m = lockOf(whoami({ signedIn: reason !== "signed-out", email: "ada@example.com", access: { allowed: false, reason } }, 1)).message;
      expect(m, reason).toMatch(/library/);
      expect(m, reason).not.toMatch(/to use Protoboard\b|for now|unlock/i);
    }
  });

  it("an unverified e-mail is asked to be verified, never invited; a reason it does not know shows the CLI's line", () => {
    const m = lockOf(whoami({ signedIn: true, email: "ada@example.com", access: { allowed: false, reason: "email-unverified" } }, 1));
    expect(m).toEqual({ locked: true, reason: "email-unverified", message: "Verify ada@example.com to use the Protoboard library: the sign-in page sends the e-mail." });
    expect(lockOf(whoami({ signedIn: true, access: { allowed: false, reason: "something-new", message: "the CLI's line" } }, 1))).toEqual({ locked: true, reason: "unknown", message: "the CLI's line" });
  });

  it("judges a project's older CLI, which does not report access, from what it does report", () => {
    expect(lockOf(whoami({ signedIn: true, valid: true }))).toEqual(UNLOCKED);
    expect(lockOf(whoami({ signedIn: false, needsAccount: false }))).toEqual(UNLOCKED);
    expect(lockOf(whoami({ signedIn: false }, 1))).toMatchObject({ locked: true, reason: "signed-out" });
    expect(lockOf(whoami({ signedIn: true, valid: false, problem: "this account is not invited to the service" }, 1)).reason).toBe("not-invited");
    expect(lockOf(whoami({ signedIn: true, valid: false, problem: "TOKEN_EXPIRED" }, 1)).reason).toBe("sign-in-invalid");
    // the CLI did not run at all: the card says so, with the reason
    expect(lockOf(accountFromWhoAmI({ code: 2, stdout: "", stderr: "protoboard: boom" }))).toEqual({ locked: true, reason: "unknown", message: "Protoboard could not check your sign-in to its library: protoboard: boom" });
  });

  it("the status bar and the Cloud card say what needs the account, in a few words", () => {
    const out = whoami({ signedIn: false, access: { allowed: false, reason: "signed-out" } }, 1);
    expect(accountItem(out).text).toBe("$(account) Sign in");
    expect(accountItem(out).tooltip).toBe("Protoboard: not signed in. Click to sign in for library parts and prices.");
    expect(accountItem(out).tooltip).not.toMatch(/for now/);
    expect(accountCard(out).note).toBe("Needed for library parts and prices");
  });
});

describe("the account commands are offered before there is a project (PB-929: sign in, then New Project)", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    activationEvents: string[];
    contributes: { commands: { command: string }[]; menus: { commandPalette: { command: string; when?: string }[] } };
  };
  const when = (id: string) => manifest.contributes.menus.commandPalette.find((m) => m.command === id)?.when;

  it("Sign In, Sign In with a Code, Check the Account Again, the account, New Project and the log need no project in the Command Palette", () => {
    for (const id of ["protoboard.signIn", "protoboard.signInDevice", "protoboard.account.check", "protoboard.account", "protoboard.newProject", "protoboard.showLog", "protoboard.about", "protoboard.stack.show", "protoboard.stack.fromVsix"]) {
      expect(manifest.contributes.commands.some((c) => c.command === id), id).toBe(true);
      expect(when(id) ?? "", id).not.toContain("protoboard.hasProject");
      expect(when(id), id).not.toBe("false");
    }
    // Sign In is hidden only once signed in
    expect(when("protoboard.signIn")).toBe("!protoboard.signedIn");
    // typed in full, "Protoboard: Sign In" must not also match another command that VS Code then lists first
    // (it did: "Check Sign-In Again" came first and Enter ran it): no other title holds the letters of "Sign In" in order
    const fuzzy = (title: string) => {
      let i = 0;
      for (const ch of title.toLowerCase()) if (ch === "signin"[i]) i++;
      return i === "signin".length;
    };
    const titles = (manifest.contributes.commands as { command: string; title: string }[]).filter((c) => when(c.command) !== "false" && fuzzy(c.title)).map((c) => c.title);
    expect(titles.sort()).toEqual(["Sign In", "Sign In with a Code (Remote or Headless)"]);
  });

  it("the extension starts with VS Code, so the stack, the status bar item and the terminal's command are there without a project", () => {
    expect(manifest.activationEvents).toContain("onStartupFinished");
  });
});

describe("a parts service that is down (B18)", () => {
  const who = (o: object) => accountFromWhoAmI({ code: 1, stdout: JSON.stringify(o), stderr: "" } as never);
  const down = { service: "http://localhost:8815", signedIn: false, unreachable: "GET http://localhost:8815/.well-known/uhd-library: fetch failed", access: { allowed: false, reason: "unreachable" } };
  it("reads as unreachable, not as signed out", () => {
    const a = who(down);
    expect(a.state).toBe("unreachable");
    expect(accountItem(a).tooltip).toMatch(/not reachable/);
    expect(accountItem(a).tooltip).not.toMatch(/not signed in|sign in/i);
    // the state reads as unreachable; the library itself cannot be used, and says why
    expect(lockOf(a)).toMatchObject({ locked: true, reason: "unreachable" });
  });
  it("is still signed out with a project's CLI before 0.2.0 that refused this machine, or when the service answered", () => {
    expect(who({ ...down, access: { required: true, allowed: false, reason: "signed-out" } }).state).toBe("signed-out");
    expect(who({ ...down, unreachable: undefined }).state).toBe("signed-out");
  });
});

describe("signing in while the service does not answer", () => {
  it("is said in one short line that names the service tried, not with a terminal's exit code", () => {
    const problem = "GET http://localhost:8787/.well-known/uhd-library: fetch failed: ECONNREFUSED";
    const m = signInUnavailableMessage(accountFromWhoAmI(run({ service: "http://localhost:8787", signedIn: false, unreachable: problem }, 1)));
    expect(m).toBe("Sign-in isn't available right now: http://localhost:8787 does not answer. Try again later.");
    expect(m.split("\n")).toHaveLength(1);
    expect(signInUnavailableMessage({ state: "unknown", reason: "x" })).toBe("Sign-in isn't available right now. Try again later.");
  });

  it("is known from the account check: signed out or with a sign-in kept here, the service not answering", () => {
    const problem = "GET https://parts.example/.well-known/uhd-library: fetch failed: ENOTFOUND";
    expect(signInUnavailable(accountFromWhoAmI(run({ service: "https://parts.example", signedIn: false, unreachable: problem }, 1)))).toBe(true);
    expect(signInUnavailable(accountFromWhoAmI(run({ service: "https://parts.example", signedIn: true, email: "ada@example.com", valid: false, unreachable: problem, problem: `the service could not be reached (${problem})` }, 1)))).toBe(true);
    // signed out, or a sign-in the service refused: signing in is what to do
    expect(signInUnavailable(accountFromWhoAmI(run({ service: "https://parts.example", signedIn: false }, 1)))).toBe(false);
    expect(signInUnavailable(accountFromWhoAmI(run({ service: "https://parts.example", signedIn: true, valid: false, problem: "the sign-in has expired" }, 1)))).toBe(false);
    expect(signInUnavailable({ state: "unknown", reason: "x" })).toBe(false);
  });
});
