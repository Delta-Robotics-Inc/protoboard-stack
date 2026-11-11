/**
 * Sign-in by link (account-link.ts) against a stand-in service that keeps
 * requests as the real one does: the page's hand-off to the listener on this
 * machine, the code typed instead, wrong and expired codes, the two-step
 * form an agent uses, and a service from before this sign-in.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync , writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AccountError, CredentialStore, beginLinkLogin, finishLinkLogin, pendingSignInFile, startLinkLogin } from "../src/index.js";

const SERVICE = "https://parts.example";
const SITE = "https://account.example";
const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const idToken = jwt({ user_id: "u9", email: "grace@example.com" });
const fileStore = (dir = mkdtempSync(join(tmpdir(), "pb-link-"))) => new CredentialStore({ env: { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" } });

interface Kept {
  challenge: string;
  client: string;
  port?: number;
  code?: string;
  attempts: number;
  expired?: boolean;
}

/** A parts service with sign-in by link, and Firebase's token trade. `approve` is what the sign-in page does. */
function standIn(options: { signInUrl?: string; unsupported?: boolean } = {}) {
  const requests = new Map<string, Kept>();
  const calls: { url: string; body?: unknown }[] = [];
  let n = 0;
  const doFetch: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url: u, ...(body ? { body } : {}) });
    if (u.endsWith("/.well-known/uhd-library") || u.endsWith("/v1")) return Response.json({ protocol: "uhd-library/v1", api: "/v1", account: { provider: "firebase", apiKey: "key", projectId: "demo", signInUrl: options.signInUrl ?? `${SITE}/login`, deviceUrl: `${SITE}/device` } });
    if (u.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken")) return Response.json({ idToken, refreshToken: "r9", expiresIn: "3600" });
    if (u === `${SERVICE}/v1/auth/signin`) {
      if (options.unsupported) return new Response("not found", { status: 404 });
      const id = `request${String(++n).padStart(5, "0")}`;
      requests.set(id, { challenge: String(body!.challenge), client: String(body!.client), ...(typeof body!.port === "number" ? { port: body!.port } : {}), attempts: 0 });
      return Response.json({ requestId: id, signInUrl: `${SITE}/login?r=${id}`, expiresIn: 600 });
    }
    const m = /\/v1\/auth\/signin\/([^/]+)\/token$/.exec(u);
    if (m) {
      const r = requests.get(m[1]!);
      const fail = (code: string, extra: Record<string, unknown> = {}) => Response.json({ error: { code, message: code, ...extra } }, { status: 400 });
      if (!r || r.expired) return fail("EXPIRED_TOKEN");
      if (createHash("sha256").update(String(body!.verifier)).digest("base64url") !== r.challenge) return fail("EXPIRED_TOKEN");
      if (!r.code) return fail("AUTHORIZATION_PENDING");
      if (String(body!.code).toUpperCase().replace(/[^A-Z]/g, "") !== r.code.replace("-", "")) {
        r.attempts++;
        if (r.attempts >= 5) {
          requests.delete(m[1]!);
          return fail("EXPIRED_TOKEN");
        }
        return fail("CODE_MISMATCH", { attemptsLeft: 5 - r.attempts });
      }
      requests.delete(m[1]!);
      return Response.json({ customToken: "custom-u9" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return {
    fetch: doFetch,
    calls,
    requests,
    /** The page: a signed-in person approves the request, and is given its code and the client's port. */
    approve(id: string, code = "BDFG-HJKL") {
      const r = requests.get(id)!;
      r.code = code;
      return { code, port: r.port };
    },
  };
}

/** The page's hand-off, as a browser on the sign-in site sends it. */
const handOff = (port: number, body: unknown, origin = SITE) => fetch(`http://127.0.0.1:${port}/handoff`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

describe("sign-in by link", () => {
  it("asks for a request with the verifier's digest, never the verifier, and names the page on the service's own site", async () => {
    const s = standIn();
    const login = await startLinkLogin(SERVICE, { store: fileStore(), fetch: s.fetch, client: "vscode", platform: "linux" });
    try {
      expect(login.url).toBe(`${SITE}/login?r=${login.requestId}`);
      expect(login.expiresIn).toBe(600);
      const asked = s.calls.find((c) => c.url === `${SERVICE}/v1/auth/signin`)!.body as Record<string, unknown>;
      expect(asked).toMatchObject({ client: "vscode", platform: "linux" });
      expect(asked.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(typeof asked.port).toBe("number");
      expect(JSON.stringify(asked)).not.toContain("verifier");
    } finally {
      login.cancel();
      await login.done.catch(() => undefined);
    }
  });

  it("the page's hand-off on this machine signs in with nothing typed, and only the sign-in site may call", async () => {
    const s = standIn();
    const store = fileStore();
    const login = await startLinkLogin(SERVICE, { store, fetch: s.fetch });
    const { code, port } = s.approve(login.requestId);
    // another site's page, or a request with no Origin, is refused before anything is tried
    expect((await handOff(port!, { request: login.requestId, code }, "https://evil.example")).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/handoff`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: login.requestId, code }) })).status).toBe(403);
    // the preflight a browser sends before a public page may reach this machine
    const pre = await fetch(`http://127.0.0.1:${port}/handoff`, { method: "OPTIONS", headers: { origin: SITE, "access-control-request-method": "POST", "access-control-request-private-network": "true" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(pre.headers.get("access-control-allow-private-network")).toBe("true");
    // another request's id is not this one's
    expect((await handOff(port!, { request: "request99999", code })).status).toBe(400);
    const ok = await handOff(port!, { request: login.requestId, code });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(await ok.json()).toEqual({ ok: true, email: "grace@example.com" });
    const session = await login.done;
    expect(session).toMatchObject({ uid: "u9", email: "grace@example.com", via: "link", refreshToken: "r9" });
    expect(store.get(SERVICE)?.email).toBe("grace@example.com");
    // the listener is gone once signed in
    await new Promise((r) => setTimeout(r, 300));
    await expect(handOff(port!, { request: login.requestId, code })).rejects.toThrow();
  });

  it("a typed code signs in when the page could not reach this machine; a wrong one says so and may be corrected", async () => {
    const s = standIn();
    const store = fileStore();
    const login = await startLinkLogin(SERVICE, { store, fetch: s.fetch });
    expect(await login.submitCode("BDFG-HJKL")).toEqual({ status: "pending" });
    s.approve(login.requestId, "BDFG-HJKL");
    expect(await login.submitCode("LKJH-GFDB")).toEqual({ status: "mismatch", attemptsLeft: 4 });
    const r = await login.submitCode(" bdfg hjkl ");
    expect(r.status).toBe("signed-in");
    expect((await login.done).email).toBe("grace@example.com");
    expect(store.get(SERVICE)?.via).toBe("link");
  });

  it("asks for the token again when the request did not get through, and gives up as unreachable after three tries", async () => {
    const s = standIn();
    const store = fileStore();
    let drop = 1;
    const flaky: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (/\/token$/.test(String(url)) && drop-- > 0) throw new TypeError("fetch failed");
      return s.fetch(url, init);
    }) as typeof fetch;
    const login = await startLinkLogin(SERVICE, { store, fetch: flaky });
    s.approve(login.requestId, "BDFG-HJKL");
    expect((await login.submitCode("BDFG-HJKL")).status).toBe("signed-in");
    expect(store.get(SERVICE)?.via).toBe("link");

    // the answer began and was cut short while it was read: asked again, as one that never arrived
    let cut = 1;
    const short: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const res = await s.fetch(url, init);
      if (/\/token$/.test(String(url)) && res.ok && cut > 0) {
        cut--;
        s.requests.set(String(url).split("/").at(-2)!, kept!);
        return new Response('{"customToken":"cus', { status: 200, headers: { "content-type": "application/json" } });
      }
      return res;
    }) as typeof fetch;
    const half = await startLinkLogin(SERVICE, { store: fileStore(), fetch: short });
    s.approve(half.requestId, "BDFG-HJKL");
    const kept = { ...s.requests.get(half.requestId)! };
    expect((await half.submitCode("BDFG-HJKL")).status).toBe("signed-in");
    expect(cut).toBe(0);

    drop = 99;
    const lost = await startLinkLogin(SERVICE, { store: fileStore(), fetch: flaky });
    s.approve(lost.requestId, "BDFG-HJKL");
    const before = s.calls.length;
    await expect(lost.submitCode("BDFG-HJKL")).rejects.toMatchObject({ code: "UNREACHABLE" });
    expect(99 - drop).toBe(3);
    expect(s.calls.length).toBe(before);
    lost.cancel();
    await lost.done.catch(() => undefined);
  });

  it("too many wrong codes, or a request that ran out of time, ends the sign-in as expired", async () => {
    const s = standIn();
    const login = await startLinkLogin(SERVICE, { store: fileStore(), fetch: s.fetch });
    s.approve(login.requestId);
    for (let i = 0; i < 4; i++) expect((await login.submitCode("LKJH-GFDB")).status).toBe("mismatch");
    expect(await login.submitCode("LKJH-GFDB")).toEqual({ status: "expired" });
    await expect(login.done).rejects.toMatchObject({ code: "SIGN_IN_EXPIRED" });
    expect(await login.submitCode("BDFG-HJKL")).toEqual({ status: "expired" });

    const short = await startLinkLogin(SERVICE, { store: fileStore(), fetch: s.fetch, timeoutMs: 20 });
    await expect(short.done).rejects.toMatchObject({ code: "SIGN_IN_EXPIRED" });
  });

  it("is cancelled without leaving a listener behind", async () => {
    const s = standIn();
    const login = await startLinkLogin(SERVICE, { store: fileStore(), fetch: s.fetch });
    const { port } = s.approve(login.requestId);
    login.cancel();
    await expect(login.done).rejects.toMatchObject({ code: "SIGN_IN_FAILED" });
    await new Promise((r) => setTimeout(r, 300));
    await expect(handOff(port!, { request: login.requestId, code: "BDFG-HJKL" })).rejects.toThrow();
  });

  it("a service from before this sign-in answers LINK_UNSUPPORTED, so the caller uses the older one", async () => {
    const s = standIn({ unsupported: true });
    await expect(startLinkLogin(SERVICE, { store: fileStore(), fetch: s.fetch })).rejects.toMatchObject({ code: "LINK_UNSUPPORTED" });
    await expect(beginLinkLogin(SERVICE, { fetch: s.fetch, env: { PROTOBOARD_CONFIG_DIR: mkdtempSync(join(tmpdir(), "pb-link-")) } })).rejects.toMatchObject({ code: "LINK_UNSUPPORTED" });
  });

  it("does not show a sign-in page on another site than the service's own, or one a browser may not be given", async () => {
    const elsewhere = standIn();
    const answer = elsewhere.fetch;
    const moved: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const res = await answer(url, init);
      if (String(url) !== `${SERVICE}/v1/auth/signin`) return res;
      const body = (await res.json()) as Record<string, unknown>;
      return Response.json({ ...body, signInUrl: `https://phish.example/login?r=${String(body.requestId)}` });
    }) as typeof fetch;
    await expect(startLinkLogin(SERVICE, { store: fileStore(), fetch: moved })).rejects.toMatchObject({ code: "NO_SIGN_IN" });
  });
});

describe("sign-in in two steps (an agent, a script)", () => {
  it("--start keeps what --code needs in a file only the user can read, and --code finishes", async () => {
    const s = standIn();
    const dir = mkdtempSync(join(tmpdir(), "pb-link-"));
    const env = { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" };
    const store = fileStore(dir);
    const begun = await beginLinkLogin(SERVICE, { fetch: s.fetch, env });
    expect(begun.url).toMatch(/^https:\/\/account\.example\/login\?r=request\d+$/);
    const file = pendingSignInFile(env);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // no listener: an agent's machine is not where the browser is
    expect((s.calls.find((c) => c.url === `${SERVICE}/v1/auth/signin`)!.body as Record<string, unknown>).port).toBeUndefined();
    const id = (JSON.parse(readFileSync(file, "utf8")) as Record<string, { requestId: string }>)[SERVICE]!.requestId;
    expect(await finishLinkLogin(SERVICE, "BDFG-HJKL", { store, fetch: s.fetch, env })).toEqual({ status: "pending" });
    s.approve(id, "BDFG-HJKL");
    expect((await finishLinkLogin(SERVICE, "ZZZZ-ZZZZ", { store, fetch: s.fetch, env })).status).toBe("mismatch");
    expect(existsSync(file)).toBe(true);
    const done = await finishLinkLogin(SERVICE, "bdfghjkl", { store, fetch: s.fetch, env });
    expect(done.status).toBe("signed-in");
    expect(store.get(SERVICE)?.email).toBe("grace@example.com");
    expect(existsSync(file)).toBe(false);
  });

  it("--code with nothing started, or for another service, says to start one", async () => {
    const s = standIn();
    const dir = mkdtempSync(join(tmpdir(), "pb-link-"));
    const env = { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" };
    await expect(finishLinkLogin(SERVICE, "BDFG-HJKL", { fetch: s.fetch, env })).rejects.toBeInstanceOf(AccountError);
    await beginLinkLogin(SERVICE, { fetch: s.fetch, env });
    await expect(finishLinkLogin("https://other.example", "BDFG-HJKL", { fetch: s.fetch, env })).rejects.toMatchObject({ code: "NOT_STARTED" });
  });

  it("a sign-in started for another service does not replace this one's; a second start for the same service does", async () => {
    const OTHER = "https://other.example";
    const s = standIn();
    // the same stand-in answers for both services
    const both: typeof fetch = ((url: string | URL | Request, init?: RequestInit) => s.fetch(String(url).replace(OTHER, SERVICE), init)) as typeof fetch;
    const dir = mkdtempSync(join(tmpdir(), "pb-link-"));
    const env = { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" };
    const store = fileStore(dir);
    const file = pendingSignInFile(env);
    const pending = () => JSON.parse(readFileSync(file, "utf8")) as Record<string, { requestId: string; service: string }>;
    await beginLinkLogin(SERVICE, { fetch: s.fetch, env });
    const first = pending()[SERVICE]!.requestId;
    await beginLinkLogin(`${OTHER}/v1/`, { fetch: both, env });
    expect(Object.keys(pending()).sort()).toEqual([OTHER, SERVICE].sort());
    expect(pending()[SERVICE]!.requestId).toBe(first);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // the first command's follow-up still works, and leaves the other service's waiting
    s.approve(first, "BDFG-HJKL");
    expect((await finishLinkLogin(SERVICE, "BDFG-HJKL", { store, fetch: s.fetch, env })).status).toBe("signed-in");
    expect(Object.keys(pending())).toEqual([OTHER]);
    // the same service started twice: the newest link is the one that waits
    await beginLinkLogin(OTHER, { fetch: both, env });
    const second = pending()[OTHER]!.requestId;
    await beginLinkLogin(OTHER, { fetch: both, env });
    expect(pending()[OTHER]!.requestId).not.toBe(second);
    s.approve(pending()[OTHER]!.requestId, "BDFG-HJKL");
    expect((await finishLinkLogin(OTHER, "BDFG-HJKL", { store, fetch: both, env })).status).toBe("signed-in");
    expect(existsSync(file)).toBe(false);
  });

  it("a file that is not what --start writes is nothing started", async () => {
    const s = standIn();
    const dir = mkdtempSync(join(tmpdir(), "pb-link-"));
    const env = { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" };
    for (const text of ["not json", "[]", JSON.stringify({ [SERVICE]: { service: "https://elsewhere.example", requestId: "r", verifier: "v", expiresAt: Date.now() + 60_000 } }), JSON.stringify({ [SERVICE]: null })]) {
      writeFileSync(pendingSignInFile(env), text);
      await expect(finishLinkLogin(SERVICE, "BDFG-HJKL", { fetch: s.fetch, env }), text).rejects.toMatchObject({ code: "NOT_STARTED" });
    }
  });
});

describe("a sign-in that cannot be saved (PB-1226)", () => {
  /** A store whose save fails, as Windows' did when its helper could not load a module. */
  const failing = (dir = mkdtempSync(join(tmpdir(), "pb-link-"))) => {
    const store = fileStore(dir);
    store.put = () => {
      throw new Error("could not encrypt the sign-in with Windows' DPAPI (PowerShell): the module could not be loaded");
    };
    return store;
  };

  it("--code fails with the reason, never as signed in, and the started sign-in still waits", async () => {
    const s = standIn();
    const dir = mkdtempSync(join(tmpdir(), "pb-link-"));
    const env = { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" };
    await beginLinkLogin(SERVICE, { fetch: s.fetch, env });
    const file = pendingSignInFile(env);
    const id = (JSON.parse(readFileSync(file, "utf8")) as Record<string, { requestId: string }>)[SERVICE]!.requestId;
    s.approve(id, "BDFG-HJKL");
    const failed = await finishLinkLogin(SERVICE, "BDFG-HJKL", { store: failing(dir), fetch: s.fetch, env }).then(
      (r) => r,
      (e: unknown) => e,
    );
    expect(failed).toBeInstanceOf(AccountError);
    expect(failed).toMatchObject({ code: "NOT_SAVED", message: "the sign-in could not be saved, so you are not signed in: could not encrypt the sign-in with Windows' DPAPI (PowerShell): the module could not be loaded" });
    expect(fileStore(dir).get(SERVICE)).toBeUndefined();
    // the token was asked for once: a failing store is not tried again
    expect(s.calls.filter((c) => c.url.endsWith("/token"))).toHaveLength(1);
    // what --code needs is still there, for the same code once the reason is put right
    expect((JSON.parse(readFileSync(file, "utf8")) as Record<string, { requestId: string }>)[SERVICE]!.requestId).toBe(id);
  });

  it("a waiting sign-in ends with the reason, for a typed code and for the page's hand-off", async () => {
    const s = standIn();
    const typed = await startLinkLogin(SERVICE, { store: failing(), fetch: s.fetch });
    s.approve(typed.requestId, "BDFG-HJKL");
    await expect(typed.submitCode("BDFG-HJKL")).rejects.toMatchObject({ code: "NOT_SAVED" });
    await expect(typed.done).rejects.toMatchObject({ code: "NOT_SAVED" });
    // the page hands the code over: nobody is at submitCode, and whoever waits on `done` is told at once
    const handed = await startLinkLogin(SERVICE, { store: failing(), fetch: s.fetch });
    const { code, port } = s.approve(handed.requestId, "BDFG-HJKL");
    const answer = await handOff(port!, { request: handed.requestId, code });
    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual({ ok: false });
    await expect(handed.done).rejects.toMatchObject({ code: "NOT_SAVED", message: expect.stringContaining("could not be saved") });
  });
});
