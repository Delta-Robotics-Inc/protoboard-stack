/**
 * Where tokens and the browser may be sent (PB-1048): no token over plain
 * http to another machine, the service token to the hosted service (or the
 * origins listed) only, `authEnv` only PROTOBOARD_<NAME>_TOKEN, and only
 * https pages (http on this machine) to the system's browser.
 */
import { describe, expect, it } from "vitest";
import { HOSTED_CLOUD_URL, browserUrlProblem, cloudTokenAllowed, connectLibrary, isAuthEnvName, isLoopbackHost, libraryProblems, tokenTransportProblem } from "../src/index.js";

/** A fetch that answers the discovery document and records the Authorization header of every call. */
function recording() {
  const seen: { url: string; auth?: string }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization") ?? undefined;
    seen.push({ url: String(url), ...(auth ? { auth } : {}) });
    if (String(url).endsWith("/.well-known/uhd-library")) return Response.json({ protocol: "uhd-library/v1", api: "/v1" });
    return Response.json([]);
  }) as typeof fetch;
  return { f, seen };
}

describe("where a token may go", () => {
  it("loopback hosts are this machine; nothing else is", () => {
    for (const h of ["localhost", "127.0.0.1", "127.8.9.10", "[::1]", "::1", "api.localhost"]) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ["10.0.0.1", "192.168.1.2", "localhost.evil.example", "127.0.0.1.nip.io", "example.com", "0.0.0.0"]) expect(isLoopbackHost(h), h).toBe(false);
  });

  it("never over plain http to another machine", () => {
    expect(tokenTransportProblem("https://parts.acme.example")).toBeUndefined();
    expect(tokenTransportProblem("http://127.0.0.1:8787")).toBeUndefined();
    expect(tokenTransportProblem("http://localhost:8787/v1")).toBeUndefined();
    expect(tokenTransportProblem("http://parts.acme.example")).toMatch(/not https/);
    expect(tokenTransportProblem("http://192.168.1.5:8787")).toMatch(/not https/);
  });

  it("PROTOBOARD_CLOUD_TOKEN: the hosted service's origin, or those PROTOBOARD_CLOUD_TOKEN_ORIGINS lists", () => {
    expect(cloudTokenAllowed(HOSTED_CLOUD_URL, {})).toBe(true);
    expect(cloudTokenAllowed(`${HOSTED_CLOUD_URL}/v1`, {})).toBe(true);
    expect(cloudTokenAllowed("https://attacker.example", {})).toBe(false);
    expect(cloudTokenAllowed("http://127.0.0.1:8787", {})).toBe(false);
    const env = { PROTOBOARD_CLOUD_TOKEN_ORIGINS: "https://staging.example, http://127.0.0.1:8787" };
    expect(cloudTokenAllowed("https://staging.example/v1", env)).toBe(true);
    expect(cloudTokenAllowed("http://127.0.0.1:8787", env)).toBe(true);
    expect(cloudTokenAllowed("http://127.0.0.1:9999", env)).toBe(false);
    // listing an http origin on another machine does not let the token go there in the clear
    expect(cloudTokenAllowed("http://staging.example", { PROTOBOARD_CLOUD_TOKEN_ORIGINS: "http://staging.example" })).toBe(false);
  });

  it("a project's cloud.url elsewhere gets no service token, and http elsewhere gets no token at all", async () => {
    const env = { PROTOBOARD_CLOUD_TOKEN: "service-secret", PROTOBOARD_ACME_TOKEN: "acme-secret" };
    const elsewhere = recording();
    const c = connectLibrary({ id: "protoboard", url: "https://attacker.example" }, { env, fetch: elsewhere.f });
    expect(c.canPublish).toBe(false);
    await c.client.listKits().catch(() => {});
    expect(elsewhere.seen.filter((s) => s.auth)).toEqual([]);
    const hosted = recording();
    const h = connectLibrary({ id: "protoboard", url: HOSTED_CLOUD_URL }, { env, fetch: hosted.f });
    expect(h.canPublish).toBe(true);
    await h.client.listKits().catch(() => {});
    expect(hosted.seen.filter((s) => s.auth).map((s) => s.auth)).toContain("Bearer service-secret");
    // a library over plain http to another machine: neither its authEnv token nor a sign-in is sent
    const plain = recording();
    const p = connectLibrary({ id: "acme", url: "http://parts.acme.example", authEnv: "PROTOBOARD_ACME_TOKEN" }, { env, fetch: plain.f, accountTokens: new Map([["http://parts.acme.example", "id-token"]]) });
    await p.client.listKits().catch(() => {});
    expect(plain.seen.filter((s) => s.auth)).toEqual([]);
    expect(p.signedIn).toBeUndefined();
    // the same over https gets its token
    const secure = recording();
    await connectLibrary({ id: "acme", url: "https://parts.acme.example", authEnv: "PROTOBOARD_ACME_TOKEN" }, { env, fetch: secure.f }).client.listKits().catch(() => {});
    expect(secure.seen.filter((s) => s.auth).map((s) => s.auth)).toContain("Bearer acme-secret");
  });

  it("authEnv names PROTOBOARD_<NAME>_TOKEN only, never the service token or another variable", async () => {
    for (const n of ["PROTOBOARD_ACME_TOKEN", "PROTOBOARD_MY_PARTS_TOKEN"]) expect(isAuthEnvName(n), n).toBe(true);
    for (const n of ["HOME", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "PROTOBOARD_CLOUD_TOKEN", "PROTOBOARD_TOKEN", "PROTOBOARD_ACME", "protoboard_acme_token", "PROTOBOARD_ACME_TOKEN_X"]) expect(isAuthEnvName(n), n).toBe(false);
    expect(libraryProblems([{ id: "a", url: "https://a.test", authEnv: "GITHUB_TOKEN" }])[0]).toMatch(/must be named PROTOBOARD_<NAME>_TOKEN.*got GITHUB_TOKEN/);
    expect(libraryProblems([{ id: "a", url: "https://a.test", authEnv: "PROTOBOARD_CLOUD_TOKEN" }])[0]).toMatch(/not PROTOBOARD_CLOUD_TOKEN/);
    expect(libraryProblems([{ id: "a", url: "https://a.test", authEnv: "PROTOBOARD_A_TOKEN" }])).toEqual([]);
    // a list that slipped past the check still sends nothing from such a variable
    const r = recording();
    await connectLibrary({ id: "a", url: "https://a.test", authEnv: "GITHUB_TOKEN" }, { env: { GITHUB_TOKEN: "ghp_secret" }, fetch: r.f }).client.listKits().catch(() => {});
    expect(r.seen.filter((s) => s.auth)).toEqual([]);
  });
});

describe("what the system's browser is given", () => {
  it("https pages, and http ones on this machine; nothing else", () => {
    expect(browserUrlProblem("https://protoboard.example/login?x=1&y=2")).toBeUndefined();
    expect(browserUrlProblem("http://127.0.0.1:5173/")).toBeUndefined();
    for (const u of ["http://login.example/", "file:///etc/passwd", "javascript:alert(1)", "vscode://x/y", "ms-settings:", "smb://host/share", "not a url"]) expect(browserUrlProblem(u), u).toMatch(/not opened|not a URL/);
  });
});
