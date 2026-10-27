/**
 * The Protoboard cloud needs a sign-in; local work never does (PB-928 as
 * changed on 2026-10-21: the stack is open source, and only the hosted cloud
 * is a paid service). Creating, modelling, checking, building, the viewer,
 * layout, circuits and releases run with no account. Everything that uses
 * the library does need one, browsing included (the library is not
 * accessible over the CLI when signed out either):
 * searching it and its categories, the project's libraries, fetching library
 * parts, update checks, prices and offers, publishing. The CLI asks `checkAccess` before
 * such a command (packages/cli/src/gate.ts is the table of which ones), and
 * the VS Code extension reads the same answer from `protoboard whoami`.
 *
 * What it is, plainly: a courtesy on the user's machine, so that a cloud
 * command signed out stops at once with one line saying how to sign in,
 * before it changes anything. It is not the protection. The parts service
 * refuses every read of the library without a valid sign-in on its own
 * (protoboard-cloud docs/access.md); a fork that removes this file gets the
 * service's 401 instead of this line.
 *
 * The cases (docs/specs/distribution.md, "Sign-in for the cloud"):
 *
 * - A fresh answer from the service is kept for `ACCESS_RECHECK_HOURS` and
 *   used without contacting anything: cloud commands stay fast, and agents run many.
 * - When the service cannot be reached, the last good answer is accepted for
 *   `OFFLINE_GRACE_DAYS`; the command itself then says what it could not reach.
 * - A parts service that signs no one in (local development, `PB_CLOUD_AUTH=none`,
 *   or a library someone else hosts without accounts) is open.
 * - `PROTOBOARD_CLOUD_TOKEN` (the service token, CI) counts as signed in. It is
 *   not sent anywhere by this check; the service judges it when it is used.
 * - An account the service's invite list refuses is not allowed, and is told so.
 *
 * What the check sends, and nothing else: `GET <service>/.well-known/uhd-library`
 * without credentials, `GET <service>/v1/me` with the account's ID token, and,
 * when that token is older than an hour, the refresh to Google's token endpoint
 * that every signed-in command already makes. Nothing about the project: not
 * its name, its path, its files or its parts.
 *
 * No VS Code API here: the CLI calls it, and the extension reads its result
 * from `protoboard whoami --format json` (`access`).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ensurePrivateDir } from "./private-dir.js";
import { join } from "node:path";
import { AccountError, CredentialStore, accountToken, configDir, fetchProblem, serviceKey } from "./account.js";

/** How long a good answer is used without asking the service again. */
export const ACCESS_RECHECK_HOURS = 12;

/**
 * How long the last good answer is accepted while the service cannot be
 * reached. Seven days: a week of travel or bench work without a connection
 * keeps working, and an account taken off the invite list stops within a week
 * even on a machine that never goes online (online, it stops at the next
 * check, at most `ACCESS_RECHECK_HOURS` later).
 */
export const OFFLINE_GRACE_DAYS = 7;

/** Why access was given. */
export type AccessVia =
  /** The service accepted the signed-in account just now. */
  | "account"
  /** The service accepted it within the last `ACCESS_RECHECK_HOURS`; nothing was contacted. */
  | "recent"
  /** The service cannot be reached; it accepted the account within the last `OFFLINE_GRACE_DAYS`. */
  | "offline"
  /** The service signs no one in (local development). */
  | "open-service"
  /** `PROTOBOARD_CLOUD_TOKEN` is set (CI). */
  | "service-token";

/** Why access was refused. */
export type AccessRefusal =
  /** Nobody is signed in to the service. */
  | "signed-out"
  /** The sign-in no longer works (revoked, disabled, expired). */
  | "sign-in-invalid"
  /** Signed in, but the service's invite list does not have the account. */
  | "not-invited"
  /** Signed in, but the account's e-mail address is not verified yet. */
  | "email-unverified"
  /** The service cannot be reached and there is no recent good answer. */
  | "unreachable";

export interface Access {
  /** Whether this machine may use the service's account features (the cloud) now. */
  allowed: boolean;
  service: string;
  via?: AccessVia;
  reason?: AccessRefusal;
  /** One line for a person: what is wrong and what to run. Set when not allowed. */
  message?: string;
  email?: string;
  /** When the service last accepted the account (ISO). */
  verifiedAt?: string;
  /** With `via: "offline"`: until when the last answer is accepted (ISO). */
  offlineUntil?: string;
}

/** The last answer per service. Not a secret: no token, only who and when. */
interface AccessRecord {
  /** The account it was for; a record of another account is ignored. `open` for a service without sign-in. */
  uid: string;
  email?: string;
  verifiedAt: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `<config dir>/access.json`: beside the credentials, never in a project. */
export function accessFile(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return join(configDir(env, platform), "access.json");
}

function readRecords(file: string): Record<string, AccessRecord> {
  if (!existsSync(file)) return {};
  try {
    const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, AccessRecord>;
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}

function writeRecord(file: string, service: string, record: AccessRecord | undefined): void {
  try {
    const all = readRecords(file);
    if (record) all[service] = record;
    else if (service in all) delete all[service];
    else return;
    ensurePrivateDir(join(file, ".."));
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch {
    // the record only saves a request next time: a folder that cannot be written is not a reason to refuse
  }
}

/**
 * The services this machine is signed in to, the most recently confirmed
 * first: those the credential store can list, and those the service's last
 * answers name (the OS credential stores are asked by name only). What an
 * account command falls back on when a project cannot say which service is
 * its own (`unloadedProjectService`).
 */
export function savedServices(options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; store?: CredentialStore; also?: string[] } = {}): string[] {
  const env = options.env ?? process.env;
  let store: CredentialStore;
  try {
    store = options.store ?? new CredentialStore({ env, ...(options.platform ? { platform: options.platform } : {}) });
  } catch {
    return [];
  }
  const records = readRecords(accessFile(env, options.platform));
  const named = Object.keys(records).sort((a, b) => Date.parse(records[b]!.verifiedAt) - Date.parse(records[a]!.verifiedAt));
  const candidates = [...new Set([...named, ...store.services(), ...(options.also ?? [])].map(serviceKey))];
  return candidates.filter((s) => {
    try {
      return !!store.get(s);
    } catch {
      return false;
    }
  });
}

/** Forget the last answer for a service (`protoboard logout`, a new `login`): the next check asks the service. */
export function forgetAccess(service: string, options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): void {
  writeRecord(accessFile(options.env, options.platform), serviceKey(service), undefined);
}

export interface AccessOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  store?: CredentialStore;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch (tests). */
  now?: number;
  /** Ask the service even when a recent answer is kept (`whoami --check`, the extension after a sign-in). */
  fresh?: boolean;
}

const SIGN_IN = "sign in with `protoboard login`";
const LIBRARY = "The Protoboard library";

/**
 * The one line a refused cloud command prints. `what` names what needed the
 * cloud ("Adding library parts"); without it the line speaks of the library.
 */
export function accessMessage(a: Pick<Access, "reason" | "service" | "email">, detail?: string, what = LIBRARY): string {
  switch (a.reason) {
    case "not-invited":
      return `${what} needs an invited account: ${a.email ?? "this account"} is signed in to ${a.service} but is not on its invite list${detail ? ` (${detail})` : ""}. Ask for an invitation, or ${SIGN_IN} with an invited account. Local work (check, build, the viewer) needs no account.`;
    case "email-unverified":
      return `${what} needs a verified e-mail address: ${a.email ?? "this account"} is signed in to ${a.service}, but its address is not verified yet. Verify it (the sign-in page sends the e-mail), then try again.`;
    case "sign-in-invalid":
      return `${what} needs a sign-in: the one kept for ${a.service}${a.email ? ` (${a.email})` : ""} no longer works${detail ? ` (${detail})` : ""}. To sign in again, ${SIGN_IN}.`;
    case "unreachable":
      return `${what} needs ${a.service}, which cannot be reached to check the sign-in${detail ? ` (${detail})` : ""}.`;
    default:
      return `${what} needs a Protoboard account: ${SIGN_IN} (not signed in to ${a.service}).`;
  }
}

/**
 * Whether this machine may use the account features (the cloud) of the
 * library at `service`: see the top of this file for the cases. Never throws; a credential store that
 * cannot be read is "signed out" with the reason in the message.
 */
export async function checkAccess(service: string, options: AccessOptions = {}): Promise<Access> {
  const env = options.env ?? process.env;
  const key = serviceKey(service);
  const now = options.now ?? Date.now();
  const f = options.fetch ?? fetch;
  const file = accessFile(env, options.platform);
  const refuse = (reason: AccessRefusal, extra: Partial<Access> = {}, detail?: string): Access => ({ allowed: false, service: key, reason, ...extra, message: accessMessage({ reason, service: key, ...(extra.email ? { email: extra.email } : {}) }, detail) });

  // CI: the service token stands for an account. Nothing is asked; the service judges the token when it is used.
  if (env.PROTOBOARD_CLOUD_TOKEN) return { allowed: true, service: key, via: "service-token" };

  let store: CredentialStore;
  try {
    store = options.store ?? new CredentialStore({ env, ...(options.platform ? { platform: options.platform } : {}) });
  } catch (e) {
    return refuse("signed-out", {}, (e as Error).message);
  }
  const session = store.get(key);
  const record = readRecords(file)[key];
  const age = record ? now - Date.parse(record.verifiedAt) : Infinity;
  const who = session ? { ...(session.email ? { email: session.email } : {}) } : {};
  // the last answer counts only for the account it was given to (or, signed out, for an open service)
  const mine = !!record && age >= 0 && record.uid === (session ? session.uid : "open");

  if (mine && !options.fresh && age < ACCESS_RECHECK_HOURS * HOUR) {
    return { allowed: true, service: key, via: session ? "recent" : "open-service", ...who, verifiedAt: record.verifiedAt };
  }
  const offline = (what: string): Access => {
    if (mine && age < OFFLINE_GRACE_DAYS * DAY) {
      return { allowed: true, service: key, via: session ? "offline" : "open-service", ...who, verifiedAt: record.verifiedAt, offlineUntil: new Date(Date.parse(record.verifiedAt) + OFFLINE_GRACE_DAYS * DAY).toISOString() };
    }
    return refuse("unreachable", who, what);
  };

  // does the service sign anyone in? (no credentials in this request)
  let needsAccount: boolean;
  try {
    const res = await f(`${key}/.well-known/uhd-library`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return offline(`GET ${key}/.well-known/uhd-library answered ${res.status}`);
    needsAccount = !!((await res.json()) as { account?: unknown }).account;
  } catch (e) {
    return offline(`GET ${key}/.well-known/uhd-library: ${fetchProblem(e)}`);
  }
  const verifiedAt = new Date(now).toISOString();
  if (!needsAccount) {
    writeRecord(file, key, { uid: "open", verifiedAt });
    return { allowed: true, service: key, via: "open-service", verifiedAt };
  }
  if (!session) {
    writeRecord(file, key, undefined);
    return refuse("signed-out");
  }
  let me: { signedIn?: boolean; allowed?: boolean; reason?: string; problem?: string };
  try {
    const token = await accountToken(key, { store, fetch: f, now });
    const res = await f(`${key}/v1/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status >= 500) return offline(`GET ${key}/v1/me answered ${res.status}`);
    me = (await res.json().catch(() => ({}))) as typeof me;
  } catch (e) {
    // Firebase said the sign-in is over: that is an answer. Anything else is "could not ask".
    if (e instanceof AccountError && e.code === "SESSION_EXPIRED") {
      writeRecord(file, key, undefined);
      return refuse("sign-in-invalid", who, e.message.replace(/: run `protoboard login` again$/, ""));
    }
    return offline(e instanceof AccountError ? e.message : `GET ${key}/v1/me: ${fetchProblem(e)}`);
  }
  if (!me.signedIn) {
    writeRecord(file, key, undefined);
    return refuse("sign-in-invalid", who, "the service does not accept it");
  }
  if (me.allowed === false) {
    writeRecord(file, key, undefined);
    return me.reason === "email-unverified" ? refuse("email-unverified", who) : refuse("not-invited", who, me.problem);
  }
  writeRecord(file, key, { uid: session.uid, ...(session.email ? { email: session.email } : {}), verifiedAt });
  return { allowed: true, service: key, via: "account", ...who, verifiedAt };
}

/** Thrown by `requireAccess`: the CLI prints `message` as its one line and exits `ACCESS_EXIT_CODE`. */
export class AccessError extends Error {
  readonly code = "SIGN_IN_REQUIRED";
  constructor(
    readonly access: Access,
    what?: string,
  ) {
    const line = access.message ?? accessMessage(access);
    super(what && line.startsWith(LIBRARY) ? what + line.slice(LIBRARY.length) : line);
    this.name = "AccessError";
  }
}

/** The CLI's exit code for a cloud command refused for want of a sign-in (1 is findings, 2 a failed command). */
export const ACCESS_EXIT_CODE = 4;

/**
 * `checkAccess`, throwing `AccessError` when the service definitely refuses
 * (signed out, a sign-in that no longer works, not invited). A service that
 * cannot be reached is not a refusal here: the command goes on and says
 * itself what it could not reach.
 */
export async function requireAccess(service: string, options: AccessOptions & { what?: string } = {}): Promise<Access> {
  const a = await checkAccess(service, options);
  if (!a.allowed && a.reason !== "unreachable") throw new AccessError(a, options.what);
  return a;
}
