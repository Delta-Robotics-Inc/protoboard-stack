/**
 * Signing in to a Protoboard parts service (PB-911): `protoboard login`.
 *
 * - **Browser**: a loopback server on 127.0.0.1 waits for the downloads
 *   site's sign-in page (`account.signInUrl`), which signs the user in with
 *   Firebase Auth and posts the refresh token back to it, with the random
 *   `state` the CLI put in the page's URL. The CLI checks the token by
 *   refreshing it before keeping it.
 * - **Device** (agents, SSH, no browser): the service gives a short code; a
 *   person approves it on the `/device` page while signed in; the CLI polls,
 *   receives a Firebase custom token once and trades it for its own tokens.
 *
 * Either way the session goes to the credential store (account.ts), never a
 * project file.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { discoverLibrary } from "@protoboardai/cloud/client";
import { AccountError, CredentialStore, fetchProblem, refreshIdToken, serviceKey, sessionFrom, signInWithCustomToken, type AccountInfo, type Session } from "./account.js";
import { browserUrlProblem } from "./web-urls.js";

/** How the service signs users in, from its discovery document. Throws NO_SIGN_IN when it does not. */
export async function serviceAccount(service: string, options: { fetch?: typeof fetch } = {}): Promise<AccountInfo & { apiKey: string }> {
  // "fetch failed" alone says nothing: keep what failed (fetchProblem), and say it as an AccountError the CLI can explain
  const doFetch = options.fetch ?? fetch;
  let failed: unknown;
  const watched: typeof fetch = async (input, init) => {
    try {
      return await doFetch(input, init);
    } catch (e) {
      failed = { url: String(input instanceof Request ? input.url : input), error: e };
      throw e;
    }
  };
  let found: Awaited<ReturnType<typeof discoverLibrary>>;
  try {
    found = await discoverLibrary(serviceKey(service), { fetch: watched });
  } catch (e) {
    const f = failed as { url: string; error: unknown } | undefined;
    if (f) throw new AccountError("UNREACHABLE", `GET ${f.url}: ${fetchProblem(f.error)}`);
    throw e;
  }
  const account = (found.document as { account?: AccountInfo } | undefined)?.account;
  if (!account || account.provider !== "firebase" || !account.apiKey)
    throw new AccountError("NO_SIGN_IN", `${serviceKey(service)} does not sign users in (a local parts service: everything is open there, nothing to sign in to)`);
  return account as AccountInfo & { apiKey: string };
}

/**
 * The account page of a service's sign-in site (PB-1089): `account.accountUrl`,
 * else `/account` beside its sign-in page (a service from before the page
 * names none). Undefined when the service names no site, or the page is not
 * one a browser may be given (https, or http on this machine).
 */
export function accountPageUrl(info: Pick<AccountInfo, "accountUrl" | "signInUrl">): string | undefined {
  let url: string | undefined;
  try {
    url = info.accountUrl ?? (info.signInUrl ? new URL("/account", info.signInUrl).href : undefined);
  } catch {
    return undefined;
  }
  return url && !browserUrlProblem(url) ? url : undefined;
}

/** The account page of `service` (its discovery document); throws NO_SIGN_IN when it signs no one in, or names no page. */
export async function accountPage(service: string, options: { fetch?: typeof fetch } = {}): Promise<string> {
  const url = accountPageUrl(await serviceAccount(service, options));
  if (!url) throw new AccountError("NO_SIGN_IN", `${serviceKey(service)} names no account page`);
  return url;
}

export interface LoginOptions {
  store?: CredentialStore;
  fetch?: typeof fetch;
  /** Show a line to the person (where to go, what is happening). */
  log?: (line: string) => void;
  /** Give up after this long (default ten minutes). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------- browser

const PAGE = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
:root { color-scheme: light dark; --bg: #f7f7f8; --card: #ffffff; --fg: #1f2328; --muted: #59636e; --border: #d1d9e0; }
@media (prefers-color-scheme: dark) { :root { --bg: #151719; --card: #1d2023; --fg: #e6e8ea; --muted: #9aa4ad; --border: #30363d; } }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 15px/1.5 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
main { min-height: 100%; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
.card { max-width: 420px; width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 24px; box-shadow: 3px 3px 0 var(--border); }
h1 { font-size: 18px; margin: 0 0 8px; } p { margin: 0; color: var(--muted); }
</style></head><body><main><div class="card"><h1>${title}</h1><p>${body}</p></div></main></body></html>`;

/** Read a small urlencoded body. */
function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((ok, fail) => {
    let body = "";
    req.on("data", (d: Buffer) => {
      body += d;
      if (body.length > 64 * 1024) req.destroy(new Error("body too large"));
    });
    req.on("end", () => ok(new URLSearchParams(body)));
    req.on("error", fail);
  });
}

/**
 * Browser sign-in. `open` is called with the sign-in page's URL (the CLI
 * opens the default browser; tests post to the callback themselves).
 * Resolves with the saved session.
 */
export async function loginWithBrowser(service: string, open: (url: string) => void, options: LoginOptions = {}): Promise<Session> {
  const info = await serviceAccount(service, options);
  if (!info.signInUrl) throw new AccountError("NO_SIGN_IN", `${serviceKey(service)} names no sign-in page; use \`protoboard login --device\``);
  // the page receives the sign-in and posts its token back: https only, or http on this machine (PB-1048)
  const unsafe = browserUrlProblem(info.signInUrl);
  if (unsafe) throw new AccountError("NO_SIGN_IN", `${serviceKey(service)} names a sign-in page that is not opened: ${unsafe}. Use \`protoboard login --device\`, or a service whose sign-in page is https`);
  const store = options.store ?? new CredentialStore();
  const state = randomBytes(24).toString("base64url");
  let finish!: (s: Session) => void;
  let fail!: (e: Error) => void;
  const done = new Promise<Session>((ok, ko) => {
    finish = ok;
    fail = ko;
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, title: string, body: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
      res.end(PAGE(title, body));
    };
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") return reply(404, "Not here", "This address only receives the Protoboard sign-in.");
    if (req.method !== "POST") return reply(405, "Not here", "Return to the sign-in page.");
    try {
      const form = await readForm(req);
      if (form.get("state") !== state) return reply(400, "Sign-in not recognised", "This sign-in was not started by the terminal waiting here. Start again with <code>protoboard login</code>.");
      if (form.get("error")) {
        reply(200, "Sign-in cancelled", "Nothing was saved. You can close this tab.");
        return fail(new AccountError("SIGN_IN_FAILED", `sign-in cancelled in the browser (${form.get("error")})`));
      }
      const refreshToken = form.get("refreshToken");
      if (!refreshToken) return reply(400, "Sign-in incomplete", "The page sent no token. Start again with <code>protoboard login</code>.");
      // a refresh proves the token is this project's and gives the user's id
      const t = await refreshIdToken(info, refreshToken, options.fetch);
      const session = sessionFrom(service, info, t, "browser");
      store.put(session);
      store.changed();
      reply(200, "Signed in to Protoboard", `${session.email ? `As ${session.email}. ` : ""}You can close this tab and return to the terminal.`);
      finish(session);
    } catch (e) {
      reply(500, "Sign-in failed", "Return to the terminal for details.");
      fail(e as Error);
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const page = new URL(info.signInUrl);
  page.searchParams.set("callback", `http://127.0.0.1:${port}/callback`);
  page.searchParams.set("state", state);
  page.searchParams.set("service", serviceKey(service));
  options.log?.(`Opening ${page.origin}${page.pathname} to sign in. If no browser opens, visit:\n  ${page.href}`);
  open(page.href);

  const timeout = setTimeout(() => fail(new AccountError("SIGN_IN_FAILED", "no sign-in arrived in time; run `protoboard login` again (or `--device`)")), options.timeoutMs ?? 10 * 60_000);
  const abort = () => fail(new AccountError("SIGN_IN_FAILED", "sign-in cancelled"));
  options.signal?.addEventListener("abort", abort);
  try {
    return await done;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    server.close();
    server.closeAllConnections?.();
  }
}

// ---------------------------------------------------------------- device

export interface DevicePrompt {
  userCode: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  expiresIn: number;
}

/**
 * Device sign-in. `prompt` is told the code and the page (print it, or
 * hand it to the person through an agent). Polls until approved, declined
 * or expired; resolves with the saved session.
 */
export async function loginWithDevice(service: string, prompt: (p: DevicePrompt) => void, options: LoginOptions & { client?: string; sleep?: (ms: number) => Promise<void> } = {}): Promise<Session> {
  const info = await serviceAccount(service, options);
  const store = options.store ?? new CredentialStore();
  const doFetch = options.fetch ?? fetch;
  const api = `${serviceKey(service)}/v1/auth/device`;
  const post = async (url: string, body: unknown) => {
    const res = await doFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: string; message?: string } } };
  };
  const start = await post(api, { client: options.client ?? "protoboard CLI" });
  if (!start.ok) throw new AccountError("NO_SIGN_IN", `${serviceKey(service)} refused device sign-in: ${start.body.error?.message ?? "unknown error"}`);
  const g = start.body as unknown as { deviceCode: string; userCode: string; verificationUri?: string; verificationUriComplete?: string; expiresIn: number; interval: number };
  prompt({ userCode: g.userCode, ...(g.verificationUri ? { verificationUri: g.verificationUri } : {}), ...(g.verificationUriComplete ? { verificationUriComplete: g.verificationUriComplete } : {}), expiresIn: g.expiresIn });
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let interval = Math.max(1, Number(g.interval ?? 5)) * 1000;
  const until = Date.now() + Math.min(g.expiresIn * 1000, options.timeoutMs ?? Infinity);
  while (Date.now() < until) {
    if (options.signal?.aborted) throw new AccountError("SIGN_IN_FAILED", "sign-in cancelled");
    await sleep(interval);
    const r = await post(`${api}/token`, { deviceCode: g.deviceCode });
    if (r.ok && typeof r.body.customToken === "string") {
      const t = await signInWithCustomToken(info, r.body.customToken, options.fetch);
      const session = sessionFrom(service, info, t, "device");
      store.put(session);
      store.changed();
      return session;
    }
    switch (r.body.error?.code) {
      case "AUTHORIZATION_PENDING":
        continue;
      case "SLOW_DOWN":
        interval += 5000;
        continue;
      case "ACCESS_DENIED":
        throw new AccountError("SIGN_IN_FAILED", "the sign-in was declined on the approval page");
      case "EXPIRED_TOKEN":
        throw new AccountError("SIGN_IN_FAILED", "the code expired before it was approved; run `protoboard login --device` again");
      default:
        throw new AccountError("SIGN_IN_FAILED", `device sign-in failed: ${r.body.error?.message ?? "unknown error"}`);
    }
  }
  throw new AccountError("SIGN_IN_FAILED", "the code expired before it was approved; run `protoboard login --device` again");
}

/** Forget the sign-in for a service. True when there was one. */
export function logout(service: string, options: { store?: CredentialStore } = {}): boolean {
  const store = options.store ?? new CredentialStore();
  const had = store.delete(service);
  store.changed();
  return had;
}
