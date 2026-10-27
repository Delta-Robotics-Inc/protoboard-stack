/**
 * The cloud's sign-in (PB-928, as changed on 2026-10-21): each case the check
 * decides (docs/specs/distribution.md, "Sign-in for the cloud"). Only cloud
 * commands ask it; the services here are stand-ins and nothing reaches a real one.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_RECHECK_HOURS, AccessError, CredentialStore, OFFLINE_GRACE_DAYS, accessFile, checkAccess, requireAccess, type Session } from "../src/index.js";

const SERVICE = "https://parts.example";
const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-07T12:00:00.000Z");

/** A private config folder. */
function setup() {
  const env: NodeJS.ProcessEnv = { PROTOBOARD_CONFIG_DIR: mkdtempSync(join(tmpdir(), "pb-access-")), PROTOBOARD_CREDENTIAL_STORE: "file" };
  const store = new CredentialStore({ env });
  const signIn = (over: Partial<Session> = {}) =>
    store.put({ service: SERVICE, uid: "u1", email: "ada@example.com", refreshToken: "refresh-1", apiKey: "key", signedInAt: "2026-10-05T00:00:00.000Z", via: "browser", idToken: jwt({ user_id: "u1" }), idTokenExpiresAt: T0 + 400 * 24 * HOUR, ...over });
  return { env, store, signIn };
}

/** A stand-in service: what its discovery document and /v1/me say, and every request made to it. */
function service(answers: { account?: boolean; me?: unknown; down?: boolean; meStatus?: number }) {
  const requests: { url: string; authorization?: string; body?: string }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, ...(init?.headers ? { authorization: (init.headers as Record<string, string>).authorization } : {}), ...(init?.body ? { body: String(init.body) } : {}) });
    if (answers.down) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    if (url.endsWith("/.well-known/uhd-library")) return Response.json({ protocol: "uhd-library/v1", ...(answers.account === false ? {} : { account: { provider: "firebase" } }) });
    if (url.endsWith("/v1/me")) return Response.json(answers.me ?? { signedIn: false }, { status: answers.meStatus ?? 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetch: f, requests };
}

describe("no switch", () => {
  it("there is no way to require a sign-in for local work any more: the module exports no switch", async () => {
    const mod = (await import("../src/access.js")) as Record<string, unknown>;
    expect(mod.SIGN_IN_REQUIRED).toBeUndefined();
    expect(mod.signInRequired).toBeUndefined();
    expect(mod.SIGN_IN_ENV).toBeUndefined();
  });
});

describe("a service that signs users in", () => {
  it("refuses a machine nobody signed in on, with the command to run", async () => {
    const { env, store } = setup();
    const a = await checkAccess(SERVICE, { env, store, fetch: service({}).fetch, now: T0 });
    expect(a).toMatchObject({ allowed: false, reason: "signed-out" });
    expect(a).not.toHaveProperty("required");
    expect(a.message).toBe("The Protoboard library needs a Protoboard account: sign in with `protoboard login` (not signed in to https://parts.example).");
    await expect(requireAccess(SERVICE, { env, store, fetch: service({}).fetch, now: T0 })).rejects.toBeInstanceOf(AccessError);
    // a cloud command names what needed the account
    await expect(requireAccess(SERVICE, { env, store, fetch: service({}).fetch, now: T0, what: "Adding library parts" })).rejects.toThrow("Adding library parts needs a Protoboard account: sign in with `protoboard login` (not signed in to https://parts.example).");
  });

  it("allows an account the service accepts, and sends only the discovery request and /v1/me", async () => {
    const { env, store, signIn } = setup();
    signIn();
    const s = service({ me: { signedIn: true, allowed: true } });
    const a = await checkAccess(SERVICE, { env, store, fetch: s.fetch, now: T0 });
    expect(a).toMatchObject({ allowed: true, via: "account", email: "ada@example.com", verifiedAt: new Date(T0).toISOString() });
    // exactly two requests; the first carries no credentials, neither carries a body
    expect(s.requests.map((r) => r.url)).toEqual([`${SERVICE}/.well-known/uhd-library`, `${SERVICE}/v1/me`]);
    expect(s.requests[0].authorization).toBeUndefined();
    expect(s.requests[1].authorization).toMatch(/^Bearer /);
    expect(s.requests.every((r) => r.body === undefined)).toBe(true);
    // the record kept beside the credentials holds who and when, and no token
    const kept = readFileSync(accessFile(env), "utf8");
    expect(JSON.parse(kept)[SERVICE]).toEqual({ uid: "u1", email: "ada@example.com", verifiedAt: new Date(T0).toISOString() });
    expect(kept).not.toContain("refresh-1");
  });

  it("uses a recent answer without contacting anything, then asks again", async () => {
    const { env, store, signIn } = setup();
    signIn();
    const s = service({ me: { signedIn: true, allowed: true } });
    await checkAccess(SERVICE, { env, store, fetch: s.fetch, now: T0 });
    const quiet = service({ down: true });
    const soon = await checkAccess(SERVICE, { env, store, fetch: quiet.fetch, now: T0 + (ACCESS_RECHECK_HOURS - 1) * HOUR });
    expect(soon).toMatchObject({ allowed: true, via: "recent" });
    expect(quiet.requests).toEqual([]);
    const later = service({ me: { signedIn: true, allowed: true } });
    expect(await checkAccess(SERVICE, { env, store, fetch: later.fetch, now: T0 + (ACCESS_RECHECK_HOURS + 1) * HOUR })).toMatchObject({ via: "account" });
    expect(later.requests).toHaveLength(2);
    // `fresh` (whoami --check) asks even when the answer is recent
    const fresh = service({ me: { signedIn: true, allowed: true } });
    await checkAccess(SERVICE, { env, store, fetch: fresh.fetch, now: T0 + (ACCESS_RECHECK_HOURS + 2) * HOUR, fresh: true });
    expect(fresh.requests).toHaveLength(2);
  });

  it("offline: accepts the last confirmation for seven days, and no longer", async () => {
    const { env, store, signIn } = setup();
    signIn();
    await checkAccess(SERVICE, { env, store, fetch: service({ me: { signedIn: true, allowed: true } }).fetch, now: T0 });
    const down = service({ down: true }).fetch;
    expect(OFFLINE_GRACE_DAYS).toBe(7);
    const day6 = await checkAccess(SERVICE, { env, store, fetch: down, now: T0 + 6 * 24 * HOUR });
    expect(day6).toMatchObject({ allowed: true, via: "offline", offlineUntil: new Date(T0 + 7 * 24 * HOUR).toISOString() });
    const day8 = await checkAccess(SERVICE, { env, store, fetch: down, now: T0 + 8 * 24 * HOUR });
    expect(day8).toMatchObject({ allowed: false, reason: "unreachable" });
    expect(day8.message).toContain("cannot be reached");
    expect(day8.message).toContain("ENOTFOUND");
    // not a refusal: the cloud command goes on and says itself what it could not reach
    await expect(requireAccess(SERVICE, { env, store, fetch: down, now: T0 + 8 * 24 * HOUR })).resolves.toMatchObject({ allowed: false, reason: "unreachable" });
  });

  it("offline with no confirmation ever: refused, and it says the service cannot be reached", async () => {
    const { env, store, signIn } = setup();
    signIn();
    const a = await checkAccess(SERVICE, { env, store, fetch: service({ down: true }).fetch, now: T0 });
    expect(a).toMatchObject({ allowed: false, reason: "unreachable", email: "ada@example.com" });
  });

  it("a service error is 'could not ask', not a refusal", async () => {
    const { env, store, signIn } = setup();
    signIn();
    await checkAccess(SERVICE, { env, store, fetch: service({ me: { signedIn: true, allowed: true } }).fetch, now: T0 });
    const a = await checkAccess(SERVICE, { env, store, fetch: service({ meStatus: 503 }).fetch, now: T0 + 20 * HOUR });
    expect(a).toMatchObject({ allowed: true, via: "offline" });
  });

  it("refuses an account the invite list does not have, and forgets the earlier confirmation", async () => {
    const { env, store, signIn } = setup();
    signIn();
    await checkAccess(SERVICE, { env, store, fetch: service({ me: { signedIn: true, allowed: true } }).fetch, now: T0 });
    const a = await checkAccess(SERVICE, { env, store, fetch: service({ me: { signedIn: true, allowed: false, problem: "ada@example.com is not invited" } }).fetch, now: T0 + 13 * HOUR });
    expect(a).toMatchObject({ allowed: false, reason: "not-invited", email: "ada@example.com" });
    expect(a.message).toContain("not on its invite list");
    expect(a.message).toContain("ada@example.com is not invited");
    // removed from the list means out at once: going offline does not bring the old answer back
    expect(await checkAccess(SERVICE, { env, store, fetch: service({ down: true }).fetch, now: T0 + 14 * HOUR })).toMatchObject({ allowed: false, reason: "unreachable" });
  });

  it("an account whose e-mail is not verified is told to verify it, never to ask for an invitation", async () => {
    const { env, store, signIn } = setup();
    signIn();
    const me = { signedIn: true, allowed: false, reason: "email-unverified", problem: "ada@example.com is signed in, but the e-mail address is not verified yet" };
    const a = await checkAccess(SERVICE, { env, store, fetch: service({ me }).fetch, now: T0 });
    expect(a).toMatchObject({ allowed: false, reason: "email-unverified", email: "ada@example.com" });
    expect(a.message).toContain("needs a verified e-mail address");
    expect(a.message).not.toMatch(/invit/i);
  });

  it("refuses a sign-in the service no longer accepts", async () => {
    const { env, store, signIn } = setup();
    signIn();
    const a = await checkAccess(SERVICE, { env, store, fetch: service({ me: { signedIn: false } }).fetch, now: T0 });
    expect(a).toMatchObject({ allowed: false, reason: "sign-in-invalid" });
    expect(a.message).toContain("no longer works");
  });

  it("a confirmation counts only for the account it was given to", async () => {
    const { env, store, signIn } = setup();
    signIn();
    await checkAccess(SERVICE, { env, store, fetch: service({ me: { signedIn: true, allowed: true } }).fetch, now: T0 });
    signIn({ uid: "u2", email: "bob@example.com" });
    const other = service({ me: { signedIn: true, allowed: false } });
    const a = await checkAccess(SERVICE, { env, store, fetch: other.fetch, now: T0 + HOUR });
    expect(other.requests).toHaveLength(2);
    expect(a).toMatchObject({ allowed: false, reason: "not-invited", email: "bob@example.com" });
    // and signing out does not leave the door open
    store.delete(SERVICE);
    expect(await checkAccess(SERVICE, { env, store, fetch: service({}).fetch, now: T0 + HOUR })).toMatchObject({ allowed: false, reason: "signed-out" });
  });
});

describe("the other ways in", () => {
  it("a service that signs no one in is open, as whoami reports it; the answer is kept for offline", async () => {
    const { env, store } = setup();
    const a = await checkAccess("http://localhost:8787/", { env, store, fetch: service({ account: false }).fetch, now: T0 });
    expect(a).toMatchObject({ allowed: true, via: "open-service", service: "http://localhost:8787" });
    expect(await checkAccess("http://localhost:8787", { env, store, fetch: service({ down: true }).fetch, now: T0 + 3 * 24 * HOUR })).toMatchObject({ allowed: true, via: "open-service" });
    // a local service that never answered tells us nothing
    expect(await checkAccess("http://localhost:9", { env, store, fetch: service({ down: true }).fetch, now: T0 })).toMatchObject({ allowed: false, reason: "unreachable" });
  });

  it("CI: the service token stands for an account, and the check sends it nowhere", async () => {
    const { env, store } = setup();
    const s = service({});
    const a = await checkAccess(SERVICE, { env: { ...env, PROTOBOARD_CLOUD_TOKEN: "ci-token" }, store, fetch: s.fetch, now: T0 });
    expect(a).toMatchObject({ allowed: true, via: "service-token" });
    expect(s.requests).toEqual([]);
    expect(existsSync(accessFile(env))).toBe(false);
  });
});
