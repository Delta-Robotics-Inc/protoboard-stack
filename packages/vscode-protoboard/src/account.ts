/**
 * The Protoboard Cloud account in VS Code (PB-911): the status bar item, the
 * Cloud view's account card, and the Sign In / Sign Out commands. Only the
 * cloud needs it (PB-928 as changed on 2026-10-21): local work runs signed
 * out, and the cloud's surfaces say what signing in adds.
 *
 * The extension keeps no session of its own. It reuses the CLI's: signing in
 * runs `protoboard login` in a terminal (a browser sign-in, or a device code
 * on a machine without a browser), signing out runs `protoboard logout`, and
 * the state shown is `protoboard whoami --check`, for the project's
 * Protoboard library. The session lives in the OS keychain (or the CLI's
 * 0600 file), never in the workspace.
 *
 * No VS Code API in the model functions: the unit tests run them directly.
 */
import type { AccountModel } from "@protoboardai/views/parts-model";
import type { CliCommand, CliResult } from "./cli.js";

/** What `protoboard whoami --format json` says. */
export interface WhoAmI {
  service: string;
  signedIn: boolean;
  email?: string;
  uid?: string;
  via?: "browser" | "device";
  store?: string;
  valid?: boolean;
  publisher?: boolean;
  problem?: string;
  /** False when the service signs no one in (a parts service without sign-in): everything there is open. */
  needsAccount?: boolean;
  /** Whether the library's account features (the cloud) may be used here (PB-928). Absent from a CLI older than 0.1.4. */
  access?: WhoAmIAccess;
  /** With --check: the service did not answer at all (the request and what failed). */
  unreachable?: string;
  /** With --check: the service answered, but could not check the sign-in right now. */
  checkUnavailable?: boolean;
}

/** `Access` in @protoboardai/core (access.ts), as the CLI prints it. */
export interface WhoAmIAccess {
  /** Reported only by a CLI before 0.2.0, whose sign-in gated every command; ignored now. */
  required?: boolean;
  allowed: boolean;
  via?: string;
  reason?: "signed-out" | "sign-in-invalid" | "not-invited" | "email-unverified" | "unreachable" | "check-unavailable";
  message?: string;
  email?: string;
  offlineUntil?: string;
}

/** The account as the extension shows it. */
export type AccountState = (
  | { state: "unknown"; reason?: string }
  | { state: "signed-out"; service: string }
  | { state: "open"; service: string }
  /** No sign-in here, and none needed to use Protoboard, but the service did not answer (B18): not "signed out". */
  | { state: "unreachable"; service: string; problem: string }
  | { state: "signed-in"; service: string; email?: string; uid?: string; publisher?: boolean; store?: string }
  | { state: "expired"; service: string; email?: string; problem: string }
) & { access?: WhoAmIAccess };

/**
 * Whether the cloud (the Protoboard library's account features) may be used,
 * and why not (PB-928 as changed on 2026-10-21). Only cloud surfaces follow
 * it: the Library's screens and the commands in `CLOUD_COMMANDS`. Local work
 * (the viewer, the Inspector, the hierarchy, checks, builds, Project Parts'
 * list, the BOM) never does.
 */
export interface Lock {
  locked: boolean;
  /** `checking`: not asked yet. `unknown`: the CLI could not say. The rest are the CLI's reasons. */
  reason: "ok" | "checking" | "unknown" | "signed-out" | "sign-in-invalid" | "not-invited" | "email-unverified" | "unreachable" | "check-unavailable";
  /** One sentence for the Library's sign-in card and a cloud command's prompt. */
  message: string;
}

/**
 * What the views app's pages are told about the cloud's sign-in: one
 * message, one flag. Only the Library's screens act on it (the sign-in card
 * in place of the library); every other page ignores it.
 */
export interface AccessMessage {
  type: "protoboard:access";
  signedOut: boolean;
  /** Why, when signed out: picks the wording and the buttons. */
  reason?: Exclude<Lock["reason"], "ok">;
  /** One sentence for the overlay. */
  message?: string;
}

/** The message for a lock. */
export function accessMessage(lock: Lock): AccessMessage {
  return lock.locked ? { type: "protoboard:access", signedOut: true, reason: lock.reason as Exclude<Lock["reason"], "ok">, message: lock.message } : { type: "protoboard:access", signedOut: false };
}

/**
 * The commands that use the cloud (PB-928 as changed on 2026-10-21): signed
 * out, each asks to sign in instead of running, and the CLI command behind it
 * would stop the same way (packages/cli/src/gate.ts). Every other command is
 * local and runs with no account; none is disabled while signed out.
 */
export const CLOUD_COMMANDS: ReadonlySet<string> = new Set([
  // library parts into the project: `parts add`
  "protoboard.fetchParts",
  "protoboard.library.add",
  // update checks and re-pins compare and fetch full revisions: `parts list --check`, `parts update`
  "protoboard.parts.check",
  "protoboard.parts.update",
  "protoboard.parts.restore",
  "protoboard.parts.compare",
  // offers and prices: `parts offers`
  "protoboard.fetchOffers",
  // publishing a part: `parts publish`
  "protoboard.parts.publish",
]);

/** What an account button of a page may ask for; anything else from a page is ignored. */
export const ACCOUNT_ACTIONS = ["signIn", "signInDevice", "signOut", "checkAccount", "showLog"] as const;
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number];
export const isAccountAction = (v: unknown): v is AccountAction => typeof v === "string" && (ACCOUNT_ACTIONS as readonly string[]).includes(v);

export const CHECKING: Lock = { locked: true, reason: "checking", message: "Checking your Protoboard sign-in…" };
export const UNLOCKED: Lock = { locked: false, reason: "ok", message: "" };

/**
 * Whether the cloud is locked for this account. The CLI decides (`access` in
 * `whoami`); a project's older CLI that does not say is judged from what it
 * does report: signed in and accepted, or a service without sign-in.
 */
export function lockOf(a: AccountState): Lock {
  const access = a.access;
  if (access) {
    if (access.allowed) return UNLOCKED;
    const reason = access.reason ?? "signed-out";
    // a reason this extension does not know (a newer CLI): the CLI's own line
    if (!(reason in LOCK_MESSAGES)) return { locked: true, reason: "unknown", message: access.message ?? `Protoboard could not check your sign-in to its library.` };
    return { locked: true, reason, message: LOCK_MESSAGES[reason](a) };
  }
  switch (a.state) {
    case "signed-in":
    case "open":
    case "unreachable":
      return UNLOCKED;
    case "signed-out":
      return { locked: true, reason: "signed-out", message: LOCK_MESSAGES["signed-out"](a) };
    case "expired":
      return { locked: true, reason: /not invited/i.test(a.problem) ? "not-invited" : "sign-in-invalid", message: /not invited/i.test(a.problem) ? LOCK_MESSAGES["not-invited"](a) : LOCK_MESSAGES["sign-in-invalid"](a) };
    default:
      return { locked: true, reason: "unknown", message: `Protoboard could not check your sign-in to its library${a.reason ? `: ${a.reason}` : "."}` };
  }
}

const emailOf = (a: AccountState) => ("email" in a && a.email ? a.email : a.access?.email);
const LOCK_MESSAGES: Record<Exclude<Lock["reason"], "ok" | "checking" | "unknown">, (a: AccountState) => string> = {
  "signed-out": () => "Sign in to use the Protoboard library.",
  "sign-in-invalid": (a) => `Your Protoboard sign-in${emailOf(a) ? ` (${emailOf(a)})` : ""} no longer works. Sign in again to use the Protoboard library.`,
  "not-invited": (a) => `${emailOf(a) ?? "This account"} is not invited to the Protoboard library yet. Ask for an invitation or use another account.`,
  "email-unverified": (a) => `Verify ${emailOf(a) ?? "this account's e-mail address"} to use the Protoboard library: the sign-in page sends the e-mail.`,
  unreachable: () => "The Protoboard library could not be reached. Projects work offline.",
  "check-unavailable": () => "The Protoboard service can't check sign-ins right now. Try again later.",
};

/**
 * What signing in says when the service does not answer: one short line, in a
 * notification, never a terminal's exit code. It names the service that was
 * tried, so a project pointed at a service that is not running (its
 * cloud.url, PROTOBOARD_CLOUD_URL) is not mistaken for the hosted library
 * being down.
 */
export const signInUnavailableMessage = (a: AccountState): string =>
  "service" in a && a.service ? `Sign-in isn't available right now: ${a.service} does not answer. Try again later.` : "Sign-in isn't available right now. Try again later.";

/** Whether a sign-in cannot work now: the account check found the service not answering (signed out, or with a sign-in kept here). */
export const signInUnavailable = (a: AccountState): boolean => a.state === "unreachable" || (a.state === "expired" && /could not be reached/i.test(a.problem));

/** The state from a `whoami` run. Exit 1 with JSON is a plain "not signed in" or a sign-in the service refused. */
export function accountFromWhoAmI(r: CliResult): AccountState {
  let w: WhoAmI | undefined;
  try {
    w = JSON.parse(r.stdout.trim()) as WhoAmI;
  } catch {
    w = undefined;
  }
  if (!w || typeof w.signedIn !== "boolean" || typeof w.service !== "string") return { state: "unknown", reason: (r.stderr || r.stdout).trim().split("\n").pop()?.trim() || `protoboard whoami exited ${r.code}` };
  const access = w.access && typeof w.access.allowed === "boolean" ? { access: w.access } : {};
  if (w.needsAccount === false) return { state: "open", service: w.service, ...access };
  // the service did not answer (B18): that is the news, not "signed out"; local work goes on either way. (A CLI
  // before 0.2.0 that gated everything and refused this machine is still read as signed out.)
  if (!w.signedIn && w.unreachable && !(w.access?.required === true && !w.access.allowed)) return { state: "unreachable", service: w.service, problem: w.unreachable, ...access };
  if (!w.signedIn) return { state: "signed-out", service: w.service, ...access };
  // the service could not check the sign-in (its problem): still signed in here, and nobody is told to sign in again
  const unchecked = w.access?.reason === "check-unavailable" || w.checkUnavailable === true;
  if (w.valid === false && !unchecked) return { state: "expired", service: w.service, ...(w.email ? { email: w.email } : {}), problem: w.problem ?? "the service does not accept the sign-in", ...access };
  return { state: "signed-in", service: w.service, ...(w.email ? { email: w.email } : {}), ...(w.uid ? { uid: w.uid } : {}), ...(w.publisher !== undefined ? { publisher: w.publisher } : {}), ...(w.store ? { store: w.store } : {}), ...access };
}

/** The status bar item for a state: an icon and a short label, the rest in the tooltip. */
export function accountItem(a: AccountState): { text: string; tooltip: string } {
  switch (a.state) {
    case "signed-in": {
      const who = a.email ?? a.uid ?? "signed in";
      return { text: `$(account) ${who.replace(/@.*/, "")}`, tooltip: `Protoboard: ${who}${a.publisher ? " (publisher)" : ""} · ${a.service}` };
    }
    case "expired":
      return { text: "$(warning) Sign in again", tooltip: `Protoboard: sign-in expired (${a.problem}). Click to sign in again.` };
    case "open":
      return { text: "$(cloud)", tooltip: `Protoboard: ${a.service} needs no sign-in` };
    case "unreachable":
      return { text: "$(cloud) Offline", tooltip: `Protoboard: ${a.service} not reachable. Click to check again.` };
    case "signed-out":
      return { text: "$(account) Sign in", tooltip: "Protoboard: not signed in. Click to sign in for library parts and prices." };
    default:
      return { text: "$(account)", tooltip: `Protoboard Cloud: account state unknown${a.reason ? ` (${a.reason})` : ""}. Click to sign in.` };
  }
}

/** The Cloud view's account card. */
export function accountCard(a: AccountState): { signedIn: boolean; title: string; note: string; action?: "signIn" | "signOut" } {
  switch (a.state) {
    case "signed-in":
      return { signedIn: true, title: a.email ?? a.uid ?? "Signed in", note: `${a.service}${a.publisher ? " · publisher" : ""}`, action: "signOut" };
    case "expired":
      return { signedIn: false, title: "Sign in again", note: `The sign-in${a.email ? ` as ${a.email}` : ""} no longer works: ${a.problem}.`, action: "signIn" };
    case "open":
      return { signedIn: false, title: "No account needed", note: `${a.service} needs no sign-in` };
    case "unreachable":
      return { signedIn: false, title: "Service unreachable", note: `${a.service} could not be reached: ${a.problem}.` };
    case "signed-out":
      return { signedIn: false, title: "Not signed in", note: "Needed for library parts and prices", action: "signIn" };
    default:
      return { signedIn: false, title: "Account", note: `Could not read the sign-in${a.reason ? `: ${a.reason}` : ""}.`, action: "signIn" };
  }
}

/**
 * The command line a terminal runs for `protoboard login|logout`, quoted for
 * a POSIX shell or PowerShell. The CLI's own environment (`cli.env`:
 * ELECTRON_RUN_AS_NODE when VS Code's runtime runs it) is given to the
 * terminal when it is created, not written into the line.
 */
export function terminalCommand(cli: CliCommand, args: string[], platform: NodeJS.Platform = process.platform): string {
  const parts = [cli.command, ...cli.args, ...args];
  if (platform === "win32") return "& " + parts.map((p) => `'${p.replace(/'/g, "''")}'`).join(" ");
  return parts.map((p) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(" ");
}

/** The account as the parts views draw it (the Cloud panel, the libraries manager). */
export function accountView(a: AccountState): AccountModel {
  switch (a.state) {
    case "signed-in":
      return { state: "signed-in", service: a.service, ...(a.email ? { email: a.email } : a.uid ? { email: a.uid } : {}), ...(a.publisher !== undefined ? { publisher: a.publisher } : {}), ...(a.publisher ? { detail: "Publisher" } : {}) };
    case "expired":
      return { state: "expired", service: a.service, ...(a.email ? { email: a.email } : {}), problem: a.problem };
    case "open":
      return { state: "open", service: a.service };
    case "signed-out":
      return { state: "signed-out", service: a.service };
    case "unreachable":
      return { state: "unknown", detail: `${a.service} not reachable` };
    default:
      return { state: "unknown", ...(a.reason ? { detail: a.reason } : {}) };
  }
}
