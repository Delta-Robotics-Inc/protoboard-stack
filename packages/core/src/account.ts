/**
 * Protoboard Cloud accounts on this machine (PB-911): the signed-in user of
 * a parts service, kept outside every project, and a fresh ID token for it.
 *
 * A sign-in is a Firebase Auth refresh token for one service (keyed by the
 * service's URL), with the user's id and e-mail and the Firebase details the
 * service published in its discovery document (`account`). The refresh token
 * is the secret; ID tokens last an hour and are refreshed as needed.
 *
 * Where it is kept (PB-1048):
 *
 * - Linux: the freedesktop Secret Service (`secret-tool`, GNOME Keyring or
 *   KWallet), which reads the secret from stdin, when one answers; else the
 *   file below.
 * - macOS: the file below. The keychain's `security add-generic-password`
 *   takes the secret only as an argument (visible in the process list while
 *   it runs) or from a terminal prompt, and its stdin mode (`security -i`)
 *   has an undocumented quoting grammar and line limit, so Protoboard does
 *   not write the keychain. A sign-in an earlier version kept there is moved
 *   into the file the first time it is read, and removed from the keychain.
 * - Windows: `%LOCALAPPDATA%\protoboard\credentials.dpapi.json`, each
 *   sign-in encrypted for the Windows account with DPAPI (PowerShell's
 *   `ConvertTo-SecureString`/`ConvertFrom-SecureString`, the secret passed on
 *   stdin), so it does not roam with the profile and another account cannot
 *   read it. A sign-in an earlier version kept in the plain file is moved.
 * - The file: `<config dir>/credentials.json` with mode 0600 in a 0700
 *   folder, the folder tightened when it exists with another mode
 *   (`$PROTOBOARD_CONFIG_DIR`, else `$XDG_CONFIG_HOME/protoboard`,
 *   `~/.config/protoboard`, or `%APPDATA%\protoboard` on Windows).
 *
 * `PROTOBOARD_CREDENTIAL_STORE=keychain|dpapi|file` chooses one where it
 * exists (keychain: Linux; dpapi: Windows; file: everywhere). Never in a
 * project's files, never in an environment variable that a project could
 * record; the CI path is `PROTOBOARD_CLOUD_TOKEN` (the service token).
 *
 * No VS Code API and no Firebase SDK here: the extension bundles this to
 * show the signed-in state, and Firebase Auth is reached over its REST API
 * (or the Auth emulator's, when the service says it runs against one).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensurePrivateDir } from "./private-dir.js";
import { SIGN_IN_CHECK_UNAVAILABLE } from "./sign-in-check.js";
import { tokenTransportProblem } from "./web-urls.js";

export { SIGN_IN_CHECK_UNAVAILABLE };

/** What a service's discovery document says about signing in (`account`). */
export interface AccountInfo {
  provider: "firebase";
  projectId?: string;
  apiKey?: string;
  signInUrl?: string;
  deviceUrl?: string;
  /** The account page: the profile, the sign-ins, sign out everywhere, delete (PB-1089). Older services name none: see accountPageUrl. */
  accountUrl?: string;
  /** The Auth emulator's origin (local testing). */
  emulator?: string;
  /** Services that need a signed-in user. */
  required?: string[];
}

/** One sign-in, as stored. */
export interface Session {
  /** The parts service it is for (its base URL, no trailing slash). */
  service: string;
  uid: string;
  email?: string;
  name?: string;
  /** The secret: trades for ID tokens. */
  refreshToken: string;
  apiKey: string;
  projectId?: string;
  emulator?: string;
  /** The last ID token and when it expires (ms since the epoch), so commands do not refresh every time. */
  idToken?: string;
  idTokenExpiresAt?: number;
  signedInAt: string;
  /** How it was signed in. */
  via: "browser" | "device";
}

export type CredentialBackend = "keychain" | "dpapi" | "file";

/** Runs a command; stubbed in tests. */
export type Runner = (command: string, args: string[], input?: string) => { status: number | null; stdout: string; stderr?: string; error?: Error };

const run: Runner = (command, args, input) => {
  const r = spawnSync(command, args, { input, encoding: "utf8", timeout: 15_000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(r.error ? { error: r.error } : {}) };
};

/** The macOS keychain item's service. Never rename it: stored sign-ins are found by it. */
const KEYCHAIN_SERVICE = "Protoboard Cloud";
const SECRET_TOOL_ATTR = "protoboard-cloud";

/** A service URL as a credential key: no trailing slash, no /v1. */
export const serviceKey = (url: string) => url.trim().replace(/\/+$/, "").replace(/\/v1$/, "");

export interface CredentialStoreOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  runner?: Runner;
}

/** The per-user folder for Protoboard's own files (never inside a project). */
export function configDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.PROTOBOARD_CONFIG_DIR) return env.PROTOBOARD_CONFIG_DIR;
  if (platform === "win32" && env.APPDATA) return join(env.APPDATA, "protoboard");
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "protoboard");
}

/** The file `login` and `logout` touch (`CredentialStore.changed`), in the folder `configDir` names. */
export const signInStamp = (dir: string) => join(dir, "sign-in-changed");

/** Where Windows keeps the DPAPI-encrypted sign-ins: the machine's own profile (LocalAppData), not the roaming one. */
export function dpapiFile(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.PROTOBOARD_CONFIG_DIR) return join(env.PROTOBOARD_CONFIG_DIR, "credentials.dpapi.json");
  const local = env.LOCALAPPDATA || (env.USERPROFILE ? join(env.USERPROFILE, "AppData", "Local") : undefined);
  return join(local ? join(local, "protoboard") : configDir(env, platform), "credentials.dpapi.json");
}

/** PowerShell, run with the secret on stdin and never in its arguments. */
const POWERSHELL = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];
/** stdin (base64 text) → a DPAPI blob for the current user, as hex. */
export const DPAPI_PROTECT = "$ErrorActionPreference='Stop'; $t=[Console]::In.ReadToEnd().Trim(); ConvertTo-SecureString -String $t -AsPlainText -Force | ConvertFrom-SecureString";
/** stdin (a DPAPI blob as hex) → the text it holds. */
export const DPAPI_UNPROTECT = "$ErrorActionPreference='Stop'; $b=[Console]::In.ReadToEnd().Trim(); $s=ConvertTo-SecureString -String $b; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))";

/**
 * Where sign-ins are kept (the module's comment says why): the Secret
 * Service on Linux when one answers, DPAPI on Windows, else the 0600 file.
 * `describe` says which, for `protoboard whoami`.
 */
export class CredentialStore {
  readonly backend: CredentialBackend;
  /** The 0600 file (the store itself, or where a Windows sign-in of an earlier version is moved from). */
  readonly file: string;
  /** Windows: the DPAPI-encrypted sign-ins. */
  readonly dpapiFile: string;
  private readonly runner: Runner;
  private readonly platform: NodeJS.Platform;

  constructor(options: CredentialStoreOptions = {}) {
    const env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.runner = options.runner ?? run;
    this.file = join(configDir(env, this.platform), "credentials.json");
    this.dpapiFile = dpapiFile(env, this.platform);
    const asked = env.PROTOBOARD_CREDENTIAL_STORE;
    if (asked && asked !== "keychain" && asked !== "dpapi" && asked !== "file") throw new Error(`PROTOBOARD_CREDENTIAL_STORE is keychain (Linux), dpapi (Windows) or file, not ${asked}`);
    if (asked === "keychain" && this.platform === "darwin")
      throw new Error("PROTOBOARD_CREDENTIAL_STORE=keychain is not used on macOS: the keychain's `security` command takes a secret only as an argument, where other processes can see it. Protoboard keeps the sign-in in a file only you can read (PROTOBOARD_CREDENTIAL_STORE=file, the default)");
    if (asked === "keychain" && this.platform !== "linux") throw new Error(`PROTOBOARD_CREDENTIAL_STORE=keychain is for Linux's Secret Service; on ${this.platform} use ${this.platform === "win32" ? "dpapi (the default) or " : ""}file`);
    if (asked === "keychain" && !this.secretServiceWorks()) throw new Error("PROTOBOARD_CREDENTIAL_STORE=keychain, but no credential store answers here (secret-tool and a Secret Service)");
    if (asked === "dpapi" && this.platform !== "win32") throw new Error(`PROTOBOARD_CREDENTIAL_STORE=dpapi is for Windows; on ${this.platform} use ${this.platform === "linux" ? "keychain or " : ""}file`);
    this.backend = asked === "file" ? "file" : asked === "keychain" ? "keychain" : this.platform === "win32" ? "dpapi" : this.platform === "linux" && this.secretServiceWorks() ? "keychain" : "file";
  }

  /** Whether `secret-tool` answers with a running Secret Service (Linux). */
  private secretServiceWorks(): boolean {
    // a lookup of nothing: exit 1 with no error when the service answers, an error or another status when it does not
    const r = this.runner("secret-tool", ["lookup", "service", SECRET_TOOL_ATTR, "account", "__probe__"]);
    return !r.error && (r.status === 0 || r.status === 1) && !/not\s+(be\s+)?provided|cannot|failed|error/i.test(r.stderr ?? "");
  }

  describe(): string {
    if (this.backend === "file") return `${this.file} (readable by you only)`;
    if (this.backend === "dpapi") return `${this.dpapiFile} (encrypted for your Windows account)`;
    return "the Secret Service keyring (secret-tool)";
  }

  get(service: string): Session | undefined {
    const key = serviceKey(service);
    const text = this.backend === "keychain" ? this.secretGet(key) : this.backend === "dpapi" ? this.dpapiGet(key) : this.readFile()[key];
    const s = parseSession(text) ?? this.moveEarlier(key);
    return s;
  }

  put(session: Session): void {
    const key = serviceKey(session.service);
    const s = { ...session, service: key };
    if (this.backend === "keychain") return this.secretPut(key, JSON.stringify(s));
    if (this.backend === "dpapi") {
      const all = this.readJson(this.dpapiFile) as Record<string, { dpapi: string }>;
      all[key] = { dpapi: this.protect(JSON.stringify(s)) };
      return this.writeJson(this.dpapiFile, all);
    }
    const all = this.readFile();
    all[key] = s;
    this.writeFile(all);
  }

  /**
   * The services a sign-in is kept for, as far as this store can list them:
   * all of them in a file; the Secret Service is asked by name only, so
   * there it is none (callers add the services they know to ask about).
   */
  services(): string[] {
    if (this.backend === "dpapi") return [...new Set([...Object.keys(this.readJson(this.dpapiFile)), ...Object.keys(this.readFile())])];
    return this.backend === "file" ? Object.keys(this.readFile()) : [];
  }

  /**
   * Says that a sign-in was made or forgotten: a small file beside the
   * credentials with the time and nothing else, written by `login` and
   * `logout`. The VS Code extension watches it, so a sign-in made in a
   * terminal or by an agent shows at once, whichever store keeps it.
   */
  changed(now: Date = new Date()): void {
    try {
      const dir = ensurePrivateDir(join(this.file, ".."), this.platform);
      writeFileSync(signInStamp(dir), `${now.toISOString()}\n`, { mode: 0o600 });
    } catch {
      // only a hint for whoever watches: a folder that cannot be written is not a reason to fail a sign-in
    }
  }

  delete(service: string): boolean {
    const key = serviceKey(service);
    // a sign-in an earlier version kept elsewhere goes too
    const earlier = this.deleteEarlier(key);
    if (this.backend === "keychain") return this.secretDelete(key) || earlier;
    if (this.backend === "dpapi") {
      const all = this.readJson(this.dpapiFile);
      if (!(key in all)) return earlier;
      delete all[key];
      this.writeJson(this.dpapiFile, all);
      return true;
    }
    const all = this.readFile();
    if (!(key in all)) return earlier;
    delete all[key];
    this.writeFile(all);
    return true;
  }

  // ---- where an earlier version kept a sign-in: the macOS keychain, Windows' plain file

  /** A sign-in an earlier version kept where this one does not, moved here (and removed there); undefined when there is none. */
  private moveEarlier(key: string): Session | undefined {
    try {
      if (this.platform === "darwin" && this.backend === "file") {
        const r = this.runner("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key, "-w"]);
        const s = r.status === 0 ? parseSession(r.stdout.trim()) : undefined;
        if (!s) return undefined;
        this.put(s);
        this.runner("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key]);
        return s;
      }
      if (this.backend === "dpapi") {
        const plain = this.readFile();
        const s = parseSession(plain[key]);
        if (!s) return undefined;
        this.put(s);
        delete plain[key];
        this.writeFile(plain);
        return s;
      }
    } catch {
      // the earlier copy stays where it is; signing in again replaces it
    }
    return undefined;
  }

  private deleteEarlier(key: string): boolean {
    try {
      if (this.platform === "darwin" && this.backend === "file") return this.runner("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key]).status === 0;
      if (this.backend === "dpapi") {
        const plain = this.readFile();
        if (!(key in plain)) return false;
        delete plain[key];
        this.writeFile(plain);
        return true;
      }
    } catch {}
    return false;
  }

  // ---- the Secret Service (Linux)

  private secretGet(key: string): string | undefined {
    const r = this.runner("secret-tool", ["lookup", "service", SECRET_TOOL_ATTR, "account", key]);
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
  }

  private secretPut(key: string, secret: string): void {
    // secret-tool reads the secret from stdin
    const r = this.runner("secret-tool", ["store", `--label=${KEYCHAIN_SERVICE} (${key})`, "service", SECRET_TOOL_ATTR, "account", key], secret);
    if (r.status !== 0) throw new Error(`could not save the sign-in to ${this.describe()}: ${(r.stderr || r.error?.message || "").trim()}`);
  }

  private secretDelete(key: string): boolean {
    const had = this.secretGet(key) !== undefined;
    this.runner("secret-tool", ["clear", "service", SECRET_TOOL_ATTR, "account", key]);
    return had;
  }

  // ---- DPAPI (Windows)

  private powershell(script: string, input: string, what: string): string {
    const r = this.runner("powershell.exe", [...POWERSHELL, script], input);
    if (r.error || r.status !== 0 || !r.stdout.trim()) throw new Error(`could not ${what} the sign-in with Windows' DPAPI (PowerShell): ${(r.stderr || r.error?.message || `exit ${r.status}`).trim()}. PROTOBOARD_CREDENTIAL_STORE=file keeps it in ${this.file} instead`);
    return r.stdout.trim();
  }

  /** Text → a DPAPI blob (hex). It goes through base64 so any text survives the console's code page. */
  private protect(text: string): string {
    return this.powershell(DPAPI_PROTECT, Buffer.from(text, "utf8").toString("base64"), "encrypt");
  }

  private dpapiGet(key: string): string | undefined {
    const blob = (this.readJson(this.dpapiFile)[key] as { dpapi?: unknown } | undefined)?.dpapi;
    if (typeof blob !== "string" || !/^[0-9a-fA-F]+$/.test(blob)) return undefined;
    try {
      return Buffer.from(this.powershell(DPAPI_UNPROTECT, blob, "decrypt"), "base64").toString("utf8");
    } catch {
      return undefined;
    }
  }

  // ---- the 0600 files

  private readFile(): Record<string, Session> {
    return this.readJson(this.file) as Record<string, Session>;
  }

  private writeFile(all: Record<string, Session>): void {
    this.writeJson(this.file, all);
  }

  private readJson(file: string): Record<string, unknown> {
    if (!existsSync(file)) return {};
    try {
      const v = JSON.parse(readFileSync(file, "utf8")) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private writeJson(file: string, all: Record<string, unknown>): void {
    ensurePrivateDir(join(file, ".."), this.platform);
    if (!Object.keys(all).length) {
      rmSync(file, { force: true });
      return;
    }
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  }
}

/** A stored sign-in, from its JSON or the parsed object; undefined unless it has a service and a refresh token. */
function parseSession(text: unknown): Session | undefined {
  if (!text) return undefined;
  try {
    const s = (typeof text === "string" ? JSON.parse(text) : text) as Session;
    return s && typeof s === "object" && s.refreshToken && s.service ? s : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- Firebase Auth over REST

/** Firebase Auth's REST endpoints, or the emulator's. */
function authEndpoints(info: { apiKey: string; emulator?: string }) {
  const host = (h: string) => (info.emulator ? `${info.emulator.replace(/\/+$/, "")}/${h}` : `https://${h}`);
  return {
    token: `${host("securetoken.googleapis.com")}/v1/token?key=${encodeURIComponent(info.apiKey)}`,
    customToken: `${host("identitytoolkit.googleapis.com")}/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(info.apiKey)}`,
  };
}

/** A sign-in error that says what to do. */
export class AccountError extends Error {
  constructor(
    readonly code: "NOT_SIGNED_IN" | "SESSION_EXPIRED" | "NO_SIGN_IN" | "SIGN_IN_FAILED" | "UNREACHABLE",
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

/**
 * What a failed `fetch` says, with the reason Node keeps in `cause`
 * ("fetch failed" alone names neither the host nor why): the system error
 * code when there is one (ECONNREFUSED, ENOTFOUND, a certificate code),
 * else the cause's message.
 */
export function fetchProblem(e: unknown): string {
  const err = e as { message?: string; name?: string; cause?: { code?: string; message?: string; errors?: { code?: string }[] } } | undefined;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "no answer in time";
  const cause = err?.cause;
  const detail = cause?.code ?? cause?.errors?.find((x) => x.code)?.code ?? cause?.message;
  const message = err?.message || String(e);
  return detail && !message.includes(detail) ? `${message}: ${detail}` : message;
}

/** The claims of a JWT, unverified: for the user id, e-mail and expiry of a token Firebase just gave us. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Trade a Firebase custom token (device sign-in) for an ID token and a refresh token. */
export async function signInWithCustomToken(info: { apiKey: string; emulator?: string }, customToken: string, doFetch: typeof fetch = fetch): Promise<{ idToken: string; refreshToken: string; expiresIn: number }> {
  const res = await doFetch(authEndpoints(info).customToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) });
  const body = (await res.json().catch(() => ({}))) as { idToken?: string; refreshToken?: string; expiresIn?: string; error?: { message?: string } };
  if (!res.ok || !body.idToken || !body.refreshToken) throw new AccountError("SIGN_IN_FAILED", `Firebase Auth refused the sign-in (${body.error?.message ?? res.status})`);
  return { idToken: body.idToken, refreshToken: body.refreshToken, expiresIn: Number(body.expiresIn ?? 3600) };
}

/** Trade a refresh token for a new ID token (and possibly a new refresh token). */
export async function refreshIdToken(info: { apiKey: string; emulator?: string }, refreshToken: string, doFetch: typeof fetch = fetch): Promise<{ idToken: string; refreshToken: string; expiresIn: number; uid: string }> {
  const res = await doFetch(authEndpoints(info).token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString() });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; refresh_token?: string; expires_in?: string; user_id?: string; error?: { message?: string } };
  if (!res.ok || !body.id_token) {
    const why = body.error?.message ?? String(res.status);
    throw new AccountError(/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND/.test(why) ? "SESSION_EXPIRED" : "SIGN_IN_FAILED", `the sign-in is no longer valid (${why}): run \`protoboard login\` again`);
  }
  return { idToken: body.id_token, refreshToken: body.refresh_token ?? refreshToken, expiresIn: Number(body.expires_in ?? 3600), uid: body.user_id ?? String(jwtClaims(body.id_token).user_id ?? "") };
}

/** A session from Firebase's answer to a sign-in. */
export function sessionFrom(service: string, info: AccountInfo, tokens: { idToken: string; refreshToken: string; expiresIn: number }, via: Session["via"], now = Date.now()): Session {
  const c = jwtClaims(tokens.idToken);
  return {
    service: serviceKey(service),
    uid: String(c.user_id ?? c.sub ?? ""),
    ...(typeof c.email === "string" ? { email: c.email } : {}),
    ...(typeof c.name === "string" ? { name: c.name } : {}),
    refreshToken: tokens.refreshToken,
    apiKey: info.apiKey!,
    ...(info.projectId ? { projectId: info.projectId } : {}),
    ...(info.emulator ? { emulator: info.emulator } : {}),
    idToken: tokens.idToken,
    idTokenExpiresAt: now + tokens.expiresIn * 1000,
    signedInAt: new Date(now).toISOString(),
    via,
  };
}

/**
 * A valid ID token for a service, refreshed when it has less than five
 * minutes left (and the refreshed token saved). Undefined when nobody is
 * signed in to it. Throws `AccountError` SESSION_EXPIRED when the sign-in no
 * longer works.
 */
export async function accountToken(service: string, options: { store?: CredentialStore; fetch?: typeof fetch; now?: number } = {}): Promise<string | undefined> {
  const store = options.store ?? new CredentialStore();
  const s = store.get(service);
  if (!s) return undefined;
  // an ID token is only for sending to its service: never over plain http to another machine (PB-1048)
  const insecure = tokenTransportProblem(serviceKey(service));
  if (insecure) throw new AccountError("UNREACHABLE", `the sign-in for ${serviceKey(service)} is not used: ${insecure}`);
  const now = options.now ?? Date.now();
  if (s.idToken && (s.idTokenExpiresAt ?? 0) - now > 5 * 60_000) return s.idToken;
  const t = await refreshIdToken(s, s.refreshToken, options.fetch);
  store.put({ ...s, idToken: t.idToken, refreshToken: t.refreshToken, idTokenExpiresAt: now + t.expiresIn * 1000 });
  return t.idToken;
}

/** The signed-in state of a service, as `protoboard whoami` and the VS Code extension show it (no secrets). */
export interface AccountStatus {
  service: string;
  signedIn: boolean;
  email?: string;
  uid?: string;
  name?: string;
  via?: Session["via"];
  signedInAt?: string;
  /** Where the sign-in is kept. */
  store: string;
  /** Whether the service still accepts it (asked with --check). */
  valid?: boolean;
  /** Whether the service lets this account use what needs one (false: not on its allowlist, PB-915). */
  allowed?: boolean;
  /** What of the library the account reads: all of it, or (an open sign-up) the parts and files whose terms allow redistribution. */
  distribution?: "all" | "redistributable";
  publisher?: boolean;
  problem?: string;
  /**
   * Whether the service signs users in at all (asked with --check: its
   * discovery document has an `account` field). False for a parts service
   * without sign-in (`PB_CLOUD_AUTH=none`, local development): everything
   * there is open, and there is nothing to sign in to.
   */
  needsAccount?: boolean;
  /**
   * Asked with --check and the service did not answer at all (no connection,
   * no such host, a timeout): the request and what failed. The local sign-in
   * above is still reported; nothing about the service is known.
   */
  unreachable?: string;
  /** Asked with --check: the service answered, but could not check the sign-in right now (its problem, not the sign-in's). */
  checkUnavailable?: boolean;
}

/** Whether a service signs users in, from its discovery document; `needs` undefined when it cannot be asked, `unreachable` when it did not answer. */
async function serviceNeedsAccount(service: string, f: typeof fetch): Promise<{ needs?: boolean; unreachable?: string }> {
  const url = `${serviceKey(service)}/.well-known/uhd-library`;
  let res: Response;
  try {
    res = await f(url, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    return { unreachable: `GET ${url}: ${fetchProblem(e)}` };
  }
  try {
    if (!res.ok) return {};
    const d = (await res.json()) as { account?: unknown };
    return { needs: !!d.account };
  } catch {
    return {};
  }
}

/** The local sign-in for a service; with `check`, also whether the service accepts it (`GET /v1/me`) and whether it signs anyone in. */
export async function accountStatus(service: string, options: { store?: CredentialStore; fetch?: typeof fetch; check?: boolean } = {}): Promise<AccountStatus> {
  const store = options.store ?? new CredentialStore();
  const s = store.get(service);
  const asked = options.check ? await serviceNeedsAccount(service, options.fetch ?? fetch) : {};
  const base: AccountStatus = { service: serviceKey(service), signedIn: !!s, store: store.describe(), ...(asked.needs !== undefined ? { needsAccount: asked.needs } : {}), ...(asked.unreachable ? { unreachable: asked.unreachable } : {}) };
  if (!s) return base;
  const out: AccountStatus = { ...base, uid: s.uid, ...(s.email ? { email: s.email } : {}), ...(s.name ? { name: s.name } : {}), via: s.via, signedInAt: s.signedInAt };
  if (!options.check) return out;
  // the service did not answer: whether it accepts the sign-in is unknown, not "no"
  if (asked.unreachable) return { ...out, valid: false, problem: `the service could not be reached (${asked.unreachable})` };
  try {
    const token = await accountToken(service, { store, ...(options.fetch ? { fetch: options.fetch } : {}) });
    const res = await (options.fetch ?? fetch)(`${serviceKey(service)}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    const me = (await res.json().catch(() => ({}))) as { signedIn?: boolean; publisher?: boolean; allowed?: boolean; problem?: string; distribution?: unknown; reason?: unknown };
    // the service could not check the token (its own problem): whether it accepts the sign-in is unknown, not "no"
    if (!me.signedIn && me.reason === "check-unavailable") return { ...out, valid: false, checkUnavailable: true, problem: SIGN_IN_CHECK_UNAVAILABLE };
    const distribution: Pick<AccountStatus, "distribution"> = me.distribution === "all" || me.distribution === "redistributable" ? { distribution: me.distribution } : {};
    // signed in, but not an invited account of a service limited to some (PB_CLOUD_ALLOWED_USERS, PB-915)
    if (me.signedIn && me.allowed === false) return { ...out, valid: false, allowed: false, ...(me.publisher !== undefined ? { publisher: me.publisher } : {}), problem: me.problem ?? "this account is not invited to the service; sign in with an invited account (`protoboard login`)" };
    return { ...out, valid: !!me.signedIn, ...(me.allowed !== undefined ? { allowed: me.allowed } : {}), ...(me.publisher !== undefined ? { publisher: me.publisher } : {}), ...distribution, ...(me.signedIn ? {} : { problem: "the service does not accept this sign-in; run `protoboard login` again" }) };
  } catch (e) {
    return { ...out, valid: false, problem: (e as Error).message };
  }
}

/**
 * ID tokens for the services the user is signed in to, among `urls` (the
 * project's libraries), refreshed as needed: what `connectLibraries` sends.
 * A sign-in that no longer works is left out and reported in `problems`.
 */
export async function accountTokensFor(urls: string[], options: { store?: CredentialStore; fetch?: typeof fetch } = {}): Promise<{ tokens: Map<string, string>; problems: string[] }> {
  const tokens = new Map<string, string>();
  const problems: string[] = [];
  let store: CredentialStore;
  try {
    store = options.store ?? new CredentialStore();
  } catch (e) {
    return { tokens, problems: [(e as Error).message] };
  }
  for (const url of new Set(urls.map(serviceKey))) {
    try {
      const t = await accountToken(url, { store, ...(options.fetch ? { fetch: options.fetch } : {}) });
      if (t) tokens.set(url, t);
    } catch (e) {
      problems.push(`${url}: ${(e as Error).message}`);
    }
  }
  return { tokens, problems };
}
