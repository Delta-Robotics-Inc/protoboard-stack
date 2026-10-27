/**
 * Protoboard Cloud sign-in on this machine (PB-911): where sessions are
 * kept, token refresh, and both login flows against stand-in services. The
 * real flows on the Firebase emulators are tested with the hosted service.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialStore, accountPage, accountPageUrl, DPAPI_PROTECT, DPAPI_UNPROTECT, accountStatus, accountToken, accountTokensFor, connectLibraries, explainCloudError, fetchProblem, loginWithBrowser, loginWithDevice, logout, type Runner, type Session } from "../src/index.js";
import { CloudError } from "@protoboardai/cloud/client";

const fileStore = () => new CredentialStore({ env: { PROTOBOARD_CONFIG_DIR: mkdtempSync(join(tmpdir(), "pb-account-")), PROTOBOARD_CREDENTIAL_STORE: "file" } });
/** A JWT-shaped token with these claims (unsigned: the CLI only reads its own tokens' claims). */
const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const SERVICE = "https://parts.example";
const session = (over: Partial<Session> = {}): Session => ({ service: SERVICE, uid: "u1", email: "ada@example.com", refreshToken: "refresh-1", apiKey: "key", signedInAt: "2026-10-05T00:00:00.000Z", via: "browser", ...over });

describe("credential store", () => {
  it("keeps sessions in a file only the user can read, outside any project", () => {
    const store = fileStore();
    expect(store.backend).toBe("file");
    store.put(session());
    expect(statSync(store.file).mode & 0o777).toBe(0o600);
    expect(statSync(join(store.file, "..")).mode & 0o777).toBe(0o700);
    expect(store.get(`${SERVICE}/`)?.email).toBe("ada@example.com");
    expect(store.get(`${SERVICE}/v1`)?.uid).toBe("u1");
    expect(JSON.parse(readFileSync(store.file, "utf8"))[SERVICE].refreshToken).toBe("refresh-1");
    expect(logout(SERVICE, { store })).toBe(true);
    expect(store.get(SERVICE)).toBeUndefined();
    expect(logout(SERVICE, { store })).toBe(false);
  });

  it("uses the Secret Service through secret-tool on Linux, the secret on stdin", () => {
    const calls: { args: string[]; input?: string }[] = [];
    const saved = new Map<string, string>();
    const runner: Runner = (command, args, input) => {
      expect(command).toBe("secret-tool");
      calls.push({ args, ...(input ? { input } : {}) });
      const account = args[args.indexOf("account") + 1];
      if (args[0] === "store") saved.set(account, input!);
      if (args[0] === "clear") saved.delete(account);
      if (args[0] === "lookup") return saved.has(account) ? { status: 0, stdout: saved.get(account)! } : { status: 1, stdout: "" };
      return { status: 0, stdout: "" };
    };
    const store = new CredentialStore({ env: {}, platform: "linux", runner });
    expect(store.backend).toBe("keychain");
    store.put(session());
    const put = calls.find((c) => c.args[0] === "store")!;
    expect(put.args).toEqual(["store", `--label=Protoboard Cloud (${SERVICE})`, "service", "protoboard-cloud", "account", SERVICE]);
    // the secret never appears in the arguments
    expect(JSON.stringify(put.args)).not.toContain("refresh-1");
    expect(JSON.parse(put.input!).refreshToken).toBe("refresh-1");
    expect(store.get(SERVICE)?.uid).toBe("u1");
    expect(store.delete(SERVICE)).toBe(true);
    expect(store.get(SERVICE)).toBeUndefined();
  });

  it("on macOS keeps the sign-in in the 0600 file, never passing a secret to `security`, and moves an earlier keychain sign-in into it (PB-1048)", () => {
    const keychain = new Map<string, string>([[SERVICE, JSON.stringify(session({ email: "earlier@example.com" }))]]);
    const calls: string[][] = [];
    const runner: Runner = (command, args, input) => {
      calls.push([command, ...args]);
      expect(command).toBe("security");
      expect(input).toBeUndefined();
      expect(args[0]).not.toBe("add-generic-password");
      const a = args[args.indexOf("-a") + 1];
      if (args[0] === "find-generic-password") return keychain.has(a) ? { status: 0, stdout: keychain.get(a)! + "\n" } : { status: 44, stdout: "" };
      if (args[0] === "delete-generic-password") return { status: keychain.delete(a) ? 0 : 44, stdout: "" };
      return { status: 0, stdout: "" };
    };
    const dir = mkdtempSync(join(tmpdir(), "pb-account-mac-"));
    const store = new CredentialStore({ env: { PROTOBOARD_CONFIG_DIR: dir }, platform: "darwin", runner });
    expect(store.backend).toBe("file");
    expect(store.describe()).toBe(`${join(dir, "credentials.json")} (readable by you only)`);
    // the earlier keychain sign-in is read once, moved into the file and removed from the keychain
    expect(store.get(SERVICE)?.email).toBe("earlier@example.com");
    expect(keychain.size).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8"))[SERVICE].email).toBe("earlier@example.com");
    if (process.platform !== "win32") expect(statSync(join(dir, "credentials.json")).mode & 0o777).toBe(0o600);
    store.put(session({ refreshToken: "refresh-new" }));
    expect(store.get(SERVICE)?.refreshToken).toBe("refresh-new");
    // no secret was ever an argument
    expect(calls.flat().some((a) => a.includes("refresh"))).toBe(false);
    expect(() => new CredentialStore({ env: { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "keychain" }, platform: "darwin", runner })).toThrow(/not used on macOS.*only as an argument/);
  });

  it("on Windows keeps the sign-in in LocalAppData, encrypted with DPAPI through PowerShell, the secret on stdin (PB-1048)", () => {
    // a stand-in for DPAPI: "encrypts" by reversing the hex of the text, so the file never holds the secret in the clear
    const calls: { args: string[]; input?: string }[] = [];
    const runner: Runner = (command, args, input) => {
      expect(command).toBe("powershell.exe");
      calls.push({ args, ...(input !== undefined ? { input } : {}) });
      const script = args.at(-1)!;
      if (script === DPAPI_PROTECT) return { status: 0, stdout: Buffer.from(input!.trim()).toString("hex").split("").reverse().join("") + "\r\n" };
      if (script === DPAPI_UNPROTECT) return { status: 0, stdout: Buffer.from(input!.trim().split("").reverse().join(""), "hex").toString() + "\r\n" };
      return { status: 1, stdout: "" };
    };
    const local = mkdtempSync(join(tmpdir(), "pb-local-"));
    const roaming = mkdtempSync(join(tmpdir(), "pb-roaming-"));
    const env = { LOCALAPPDATA: local, APPDATA: roaming };
    // a sign-in an earlier version kept in the plain roaming file is moved
    mkdirSync(join(roaming, "protoboard"));
    writeFileSync(join(roaming, "protoboard", "credentials.json"), JSON.stringify({ [SERVICE]: session({ email: "earlier@example.com" }) }));
    const store = new CredentialStore({ env, platform: "win32", runner });
    expect(store.backend).toBe("dpapi");
    expect(store.dpapiFile).toBe(join(local, "protoboard", "credentials.dpapi.json"));
    expect(store.describe()).toContain("encrypted for your Windows account");
    expect(store.get(SERVICE)?.email).toBe("earlier@example.com");
    expect(existsSync(join(roaming, "protoboard", "credentials.json"))).toBe(false);
    store.put(session({ refreshToken: "refresh-secret" }));
    const kept = readFileSync(store.dpapiFile, "utf8");
    expect(kept).not.toContain("refresh-secret");
    expect(kept).not.toContain(Buffer.from("refresh-secret").toString("base64").slice(0, 12));
    expect(JSON.parse(kept)[SERVICE].dpapi).toMatch(/^[0-9a-f]+$/);
    expect(new CredentialStore({ env, platform: "win32", runner }).get(SERVICE)?.refreshToken).toBe("refresh-secret");
    expect(store.services()).toEqual([SERVICE]);
    // the secret is never in PowerShell's arguments, only on stdin
    for (const c of calls) expect(c.args.join(" ")).not.toMatch(/refresh|ada@|earlier@/);
    expect(calls.every((c) => c.args.slice(0, 4).join(" ") === "-NoProfile -NonInteractive -ExecutionPolicy Bypass")).toBe(true);
    expect(store.delete(SERVICE)).toBe(true);
    expect(store.get(SERVICE)).toBeUndefined();
    // without PowerShell, saving says what to do
    const broken = new CredentialStore({ env: { LOCALAPPDATA: mkdtempSync(join(tmpdir(), "pb-local-")) }, platform: "win32", runner: () => ({ status: null, stdout: "", error: new Error("spawn powershell.exe ENOENT") }) });
    expect(() => broken.put(session())).toThrow(/DPAPI.*PROTOBOARD_CREDENTIAL_STORE=file/);
    expect(new CredentialStore({ env: { ...env, PROTOBOARD_CREDENTIAL_STORE: "file" }, platform: "win32", runner }).backend).toBe("file");
    expect(() => new CredentialStore({ env: { PROTOBOARD_CREDENTIAL_STORE: "dpapi" }, platform: "linux", runner })).toThrow(/dpapi is for Windows/);
  });

  it("makes the config folder 0700, also when it was there with a looser mode (PB-1048)", () => {
    if (process.platform === "win32") return;
    const dir = join(mkdtempSync(join(tmpdir(), "pb-account-dir-")), "protoboard");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    const store = new CredentialStore({ env: { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" } });
    store.put(session());
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    chmodSync(dir, 0o775);
    store.changed();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("falls back to the file when no credential store answers, and says so when one was required", () => {
    const none: Runner = () => ({ status: null, stdout: "", error: new Error("spawn secret-tool ENOENT") });
    const dir = mkdtempSync(join(tmpdir(), "pb-account-"));
    expect(new CredentialStore({ env: { PROTOBOARD_CONFIG_DIR: dir }, platform: "linux", runner: none }).backend).toBe("file");
    expect(() => new CredentialStore({ env: { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "keychain" }, platform: "linux", runner: none })).toThrow(/no credential store answers/);
  });
});

describe("tokens", () => {
  const refreshing = (seen: string[]): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push(String(url));
      const form = new URLSearchParams(String(init?.body));
      if (form.get("refresh_token") === "revoked") return new Response(JSON.stringify({ error: { message: "TOKEN_EXPIRED" } }), { status: 400 });
      return new Response(JSON.stringify({ id_token: jwt({ user_id: "u1", email: "ada@example.com" }), refresh_token: "refresh-2", expires_in: "3600", user_id: "u1" }));
    }) as typeof fetch;

  it("reuses a fresh ID token, refreshes one about to expire, and saves the refreshed one", async () => {
    const store = fileStore();
    const seen: string[] = [];
    const now = Date.parse("2026-10-05T12:00:00Z");
    store.put(session({ idToken: "cached", idTokenExpiresAt: now + 30 * 60_000 }));
    expect(await accountToken(SERVICE, { store, fetch: refreshing(seen), now })).toBe("cached");
    expect(seen).toEqual([]);
    store.put(session({ idToken: "old", idTokenExpiresAt: now + 60_000 }));
    const t = await accountToken(SERVICE, { store, fetch: refreshing(seen), now });
    expect(t).not.toBe("old");
    expect(seen).toEqual(["https://securetoken.googleapis.com/v1/token?key=key"]);
    expect(store.get(SERVICE)).toMatchObject({ idToken: t, refreshToken: "refresh-2", idTokenExpiresAt: now + 3_600_000 });
  });

  it("goes to the Auth emulator when the sign-in came from one", async () => {
    const store = fileStore();
    const seen: string[] = [];
    store.put(session({ emulator: "http://127.0.0.1:9309" }));
    await accountToken(SERVICE, { store, fetch: refreshing(seen) });
    expect(seen).toEqual(["http://127.0.0.1:9309/securetoken.googleapis.com/v1/token?key=key"]);
  });

  it("leaves out a sign-in that stopped working, and says why", async () => {
    const store = fileStore();
    store.put(session({ refreshToken: "revoked" }));
    store.put(session({ service: "https://other.example" }));
    const r = await accountTokensFor([SERVICE, "https://other.example/", "https://nobody.example"], { store, fetch: refreshing([]) });
    expect([...r.tokens.keys()]).toEqual(["https://other.example"]);
    expect(r.problems).toEqual([expect.stringMatching(/^https:\/\/parts\.example: the sign-in is no longer valid \(TOKEN_EXPIRED\): run `protoboard login` again/)]);
  });

  it("sends the signed-in user's token to that service only, and as the Protoboard library's publish token", () => {
    const tokens = new Map([[SERVICE, "id-token"]]);
    const libs = connectLibraries({ root: { source: "", export: "" }, libraries: [{ id: "protoboard", url: SERVICE }, { id: "acme", url: "https://acme.example" }] } as never, { env: {}, accountTokens: tokens });
    expect(libs.map((l) => [l.id, l.signedIn ?? false, l.canPublish])).toEqual([
      ["protoboard", true, true],
      ["acme", false, false],
    ]);
  });

  it("explains a refusal that asks for an account", () => {
    const e = new CloudError(401, "AUTH_REQUIRED", "downloading a full revision needs a signed-in Protoboard account: run `protoboard login` (browsing the library stays open)");
    expect(explainCloudError(e, { id: "protoboard", url: SERVICE }, "acme-motor").message).toMatch(/Sign in first: `protoboard login`/);
    expect(explainCloudError(e, { id: "protoboard", url: SERVICE, signedIn: true }, "acme-motor").message).toMatch(/You are signed in, but the service did not accept the sign-in/);
  });

  it("explains a refusal of an account that is not invited (PB-915), and whoami --check says so", async () => {
    const msg = "stranger@example.com is signed in, but this Protoboard service is limited to invited accounts: ask the Protoboard team to invite it, or sign in with an invited account (`protoboard login`). Browsing the library stays open.";
    const e = new CloudError(403, "ACCOUNT_NOT_ALLOWED", msg);
    const m = explainCloudError(e, { id: "protoboard", url: SERVICE, signedIn: true }, "acme-motor").message;
    expect(m).toBe(`acme-motor: the catalog at ${SERVICE} refused access: ${msg}`);
    const store = fileStore();
    const now = Date.now();
    store.put(session({ idToken: "cached", idTokenExpiresAt: now + 30 * 60_000 }));
    const me: typeof fetch = (async (url: string) =>
      String(url).endsWith("/v1/me") ? Response.json({ signedIn: true, uid: "u1", publisher: false, allowed: false, reason: "not-listed", problem: msg }) : Response.json({ account: { provider: "firebase" } })) as typeof fetch;
    expect(await accountStatus(SERVICE, { store, fetch: me, check: true })).toMatchObject({ signedIn: true, valid: false, allowed: false, problem: msg });
    const invited: typeof fetch = (async (url: string) => (String(url).endsWith("/v1/me") ? Response.json({ signedIn: true, uid: "u1", publisher: false, allowed: true }) : Response.json({ account: { provider: "firebase" } }))) as typeof fetch;
    expect(await accountStatus(SERVICE, { store, fetch: invited, check: true })).toMatchObject({ valid: true, allowed: true });
    expect((await accountStatus(SERVICE, { store, fetch: invited, check: true })).distribution).toBeUndefined();
    // an open sign-up reads the redistributable library, the team all of it: whoami --check says which
    for (const distribution of ["redistributable", "all"] as const) {
      const open: typeof fetch = (async (url: string) => (String(url).endsWith("/v1/me") ? Response.json({ signedIn: true, uid: "u1", publisher: false, allowed: true, distribution }) : Response.json({ account: { provider: "firebase" } }))) as typeof fetch;
      expect(await accountStatus(SERVICE, { store, fetch: open, check: true })).toMatchObject({ valid: true, allowed: true, distribution });
    }
  });
});

describe("login", () => {
  const discovery = { protocol: "uhd-library/v1", api: "/v1", account: { provider: "firebase", apiKey: "key", projectId: "demo", signInUrl: "https://dl.example/login", deviceUrl: "https://dl.example/device", required: ["revisions"] } };
  const idToken = jwt({ user_id: "u9", email: "grace@example.com" });
  let polls = 0;
  const service: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/.well-known/uhd-library") || u.endsWith("/v1")) return Response.json(discovery);
    if (u.startsWith("https://securetoken.googleapis.com/")) return Response.json({ id_token: idToken, refresh_token: "r9", expires_in: "3600", user_id: "u9" });
    if (u.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken")) {
      expect(JSON.parse(String(init?.body))).toEqual({ token: "custom-u9", returnSecureToken: true });
      return Response.json({ idToken, refreshToken: "r9", expiresIn: "3600" });
    }
    if (u.endsWith("/v1/auth/device")) return Response.json({ deviceCode: "dc", userCode: "BCDF-GHJK", verificationUri: "https://dl.example/device", verificationUriComplete: "https://dl.example/device?code=BCDF-GHJK", expiresIn: 600, interval: 5 });
    if (u.endsWith("/v1/auth/device/token")) return ++polls < 3 ? Response.json({ error: { code: polls === 1 ? "AUTHORIZATION_PENDING" : "SLOW_DOWN" } }, { status: 400 }) : Response.json({ customToken: "custom-u9" });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  afterEach(() => {
    polls = 0;
  });

  it("device: shows the code, polls (slowing down when told), keeps the session", async () => {
    const store = fileStore();
    const slept: number[] = [];
    let shown: unknown;
    const s = await loginWithDevice(SERVICE, (p) => (shown = p), { store, fetch: service, sleep: async (ms) => void slept.push(ms) });
    expect(shown).toEqual({ userCode: "BCDF-GHJK", verificationUri: "https://dl.example/device", verificationUriComplete: "https://dl.example/device?code=BCDF-GHJK", expiresIn: 600 });
    expect(slept).toEqual([5000, 5000, 10000]);
    expect(s).toMatchObject({ uid: "u9", email: "grace@example.com", via: "device", refreshToken: "r9" });
    expect(store.get(SERVICE)?.email).toBe("grace@example.com");
    expect(await accountStatus(SERVICE, { store })).toMatchObject({ signedIn: true, email: "grace@example.com", via: "device" });
  });

  it("browser: opens the sign-in page with a loopback callback and a state, accepts only that state", async () => {
    const store = fileStore();
    let page: URL | undefined;
    const done = loginWithBrowser(SERVICE, (url) => (page = new URL(url)), { store, fetch: service });
    await new Promise((r) => setTimeout(r, 50));
    expect(page!.origin + page!.pathname).toBe("https://dl.example/login");
    const callback = page!.searchParams.get("callback")!;
    expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(page!.searchParams.get("service")).toBe(SERVICE);
    const post = (fields: Record<string, string>) => fetch(callback, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
    expect((await post({ state: "forged", refreshToken: "x" })).status).toBe(400);
    expect((await fetch(callback)).status).toBe(405);
    const ok = await post({ state: page!.searchParams.get("state")!, refreshToken: "from-browser" });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Signed in to Protoboard");
    const s = await done;
    expect(s).toMatchObject({ uid: "u9", email: "grace@example.com", via: "browser", refreshToken: "r9" });
  });

  it("never sends a sign-in's token over plain http to another machine (PB-1048)", async () => {
    const store = fileStore();
    store.put(session({ service: "http://parts.example", idToken: "id", idTokenExpiresAt: Date.now() + 3_600_000 }));
    await expect(accountToken("http://parts.example", { store })).rejects.toThrow(/not https, so no token is sent/);
    store.put(session({ service: "http://127.0.0.1:8787", idToken: "id-local", idTokenExpiresAt: Date.now() + 3_600_000 }));
    expect(await accountToken("http://127.0.0.1:8787", { store })).toBe("id-local");
  });

  it("says when a service does not sign users in", async () => {
    const local: typeof fetch = (async () => Response.json({ protocol: "uhd-library/v1", api: "/v1" })) as typeof fetch;
    await expect(loginWithDevice("http://127.0.0.1:8787", () => {}, { store: fileStore(), fetch: local })).rejects.toMatchObject({ code: "NO_SIGN_IN" });
    // whoami --check: nothing to sign in to, rather than "not signed in"
    expect(await accountStatus("http://127.0.0.1:8787", { store: fileStore(), fetch: local, check: true })).toMatchObject({ signedIn: false, needsAccount: false });
    const hosted: typeof fetch = (async (url: string) => (String(url).endsWith("/.well-known/uhd-library") ? Response.json({ account: { provider: "firebase" } }) : new Response("", { status: 404 }))) as typeof fetch;
    expect(await accountStatus(SERVICE, { store: fileStore(), fetch: hosted, check: true })).toMatchObject({ signedIn: false, needsAccount: true });
    // without --check, no network
    expect((await accountStatus(SERVICE, { store: fileStore() })).needsAccount).toBeUndefined();
  });

  it("says when a service does not answer: the request and the reason behind fetch failed", async () => {
    // what Node's fetch throws: a TypeError "fetch failed" whose cause carries the reason
    const down: typeof fetch = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { code: "ECONNREFUSED" }) });
    }) as typeof fetch;
    const what = `GET ${SERVICE}/.well-known/uhd-library: fetch failed: ECONNREFUSED`;
    for (const login of [loginWithDevice(SERVICE, () => {}, { store: fileStore(), fetch: down }), loginWithBrowser(SERVICE, () => {}, { store: fileStore(), fetch: down })]) await expect(login).rejects.toMatchObject({ name: "AccountError", code: "UNREACHABLE", message: what });
    expect(await accountStatus(SERVICE, { store: fileStore(), fetch: down, check: true })).toMatchObject({ signedIn: false, unreachable: what });
    // a sign-in kept here is still reported; whether the service accepts it is not known
    const store = fileStore();
    store.put(session({ idToken: jwt({ exp: 4102444800 }), idTokenExpiresAt: Date.now() + 3_600_000 }));
    expect(await accountStatus(SERVICE, { store, fetch: down, check: true })).toMatchObject({ signedIn: true, email: "ada@example.com", valid: false, unreachable: what, problem: `the service could not be reached (${what})` });
    expect(store.get(SERVICE)?.email).toBe("ada@example.com");
    expect(fetchProblem(new Error("fetch failed"))).toBe("fetch failed");
    expect(fetchProblem(Object.assign(new Error("fetch failed"), { cause: new Error("unable to verify the first certificate") }))).toBe("fetch failed: unable to verify the first certificate");
    expect(fetchProblem(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe("no answer in time");
  });
});

describe("the account page (PB-1089)", () => {
  it("is the service's accountUrl, else /account beside its sign-in page", () => {
    expect(accountPageUrl({ accountUrl: "https://dl.example/account", signInUrl: "https://dl.example/login" })).toBe("https://dl.example/account");
    expect(accountPageUrl({ signInUrl: "https://dl.example/login?x=1" })).toBe("https://dl.example/account");
    expect(accountPageUrl({ signInUrl: "http://127.0.0.1:5050/login" })).toBe("http://127.0.0.1:5050/account");
    expect(accountPageUrl({})).toBeUndefined();
  });

  it("is never a page a browser may not be given", () => {
    expect(accountPageUrl({ accountUrl: "http://evil.example/account" })).toBeUndefined();
    expect(accountPageUrl({ accountUrl: "file:///etc/passwd" })).toBeUndefined();
  });

  it("is read from the service's discovery document; a service that signs no one in has none", async () => {
    const discovery = (account: unknown) => (async () => Response.json({ protocol: "uhd-library/v1", api: "/v1", ...(account ? { account } : {}) })) as unknown as typeof fetch;
    expect(await accountPage("https://parts.example", { fetch: discovery({ provider: "firebase", apiKey: "k", signInUrl: "https://dl.example/login" }) })).toBe("https://dl.example/account");
    await expect(accountPage("https://parts.example", { fetch: discovery(undefined) })).rejects.toThrow(/does not sign users in/);
  });
});

describe("the account page (PB-1089)", () => {
  it("is the service's accountUrl, else /account beside its sign-in page; never a page a browser may not be given", () => {
    expect(accountPageUrl({ accountUrl: "https://site.example/account", signInUrl: "https://other.example/login" })).toBe("https://site.example/account");
    expect(accountPageUrl({ signInUrl: "https://site.example/login?x=1" })).toBe("https://site.example/account");
    expect(accountPageUrl({ signInUrl: "http://127.0.0.1:5050/login" })).toBe("http://127.0.0.1:5050/account");
    expect(accountPageUrl({ accountUrl: "http://evil.example/account" })).toBeUndefined();
    expect(accountPageUrl({ accountUrl: "file:///etc/passwd" })).toBeUndefined();
    expect(accountPageUrl({})).toBeUndefined();
  });

  it("is read from the discovery document; a service that signs no one in has none", async () => {
    const withAccount = (async () => Response.json({ protocol: "uhd-library/v1", api: "/v1", account: { provider: "firebase", apiKey: "k", signInUrl: "https://dl.example/login" } })) as unknown as typeof fetch;
    expect(await accountPage("https://parts.example", { fetch: withAccount })).toBe("https://dl.example/account");
    const open = (async () => Response.json({ protocol: "uhd-library/v1", api: "/v1" })) as unknown as typeof fetch;
    await expect(accountPage("https://parts.example", { fetch: open })).rejects.toMatchObject({ code: "NO_SIGN_IN" });
  });
});
