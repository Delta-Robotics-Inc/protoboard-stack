/**
 * Signing in by link: one flow for a terminal on this machine, a terminal
 * over SSH, an editor and an agent.
 *
 *   1. A secret (the verifier) is made here and never leaves this process.
 *      The service is asked for a sign-in request with the verifier's digest
 *      and answers with the page to open.
 *   2. A person opens the page on any machine and signs in. The page is given
 *      a short code for this request.
 *   3. The page hands the code to the listener on this machine when it can
 *      reach it; otherwise it shows the code and the person types it here.
 *   4. The code and the verifier are traded for the session.
 *
 * So the same link works wherever the browser is, and a link someone else
 * sends cannot sign them in as you: its code is useless without the verifier
 * of the process that asked for it.
 *
 * A service from before this flow answers 404 to the request: the caller
 * gets `LINK_UNSUPPORTED` and uses the older sign-in (account-login.ts).
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { AccountError, CredentialStore, configDir, fetchProblem, serviceKey, sessionFrom, signInWithCustomToken, type AccountInfo, type Session } from "./account.js";
import { serviceAccount } from "./account-login.js";
import { browserUrlProblem } from "./web-urls.js";

/** What became of a code given to `submitCode`. */
export type CodeResult =
  | { status: "signed-in"; session: Session }
  /** The code is not this request's; `attemptsLeft` more may be tried. */
  | { status: "mismatch"; attemptsLeft: number }
  /** Nobody has signed in on the page yet, so there is no code to match. */
  | { status: "pending" }
  /** The request ran out of time, was used, or took too many wrong codes: start again. */
  | { status: "expired" };

export interface LinkLogin {
  /** The page to open, on this machine or any other. */
  url: string;
  requestId: string;
  /** Seconds the link and its code are good for. */
  expiresIn: number;
  /** A code the person typed. Never throws for a wrong or expired code. */
  submitCode(code: string): Promise<CodeResult>;
  /** The session, once the page's hand-off or a typed code signs in. Rejects when the request expires or is cancelled. */
  done: Promise<Session>;
  cancel(): void;
}

export interface LinkLoginOptions {
  store?: CredentialStore;
  fetch?: typeof fetch;
  /** What the sign-in page says it continues in. */
  client?: "vscode" | "terminal";
  /** Listen on this machine for the page's hand-off (default true). An agent's two-step sign-in has no listener. */
  listen?: boolean;
  /** Give up after this long; by default when the service says the request expires. */
  timeoutMs?: number;
  signal?: AbortSignal;
  platform?: NodeJS.Platform;
}

const digest = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

type ApiAnswer = { ok: boolean; status: number; body: Record<string, unknown> & { error?: { code?: string; message?: string; attemptsLeft?: number } } };

async function post(doFetch: typeof fetch, url: string, body: unknown): Promise<ApiAnswer> {
  let res: Response;
  try {
    res = await doFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    throw new AccountError("UNREACHABLE", `POST ${url}: ${fetchProblem(e)}`);
  }
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as ApiAnswer["body"] };
}

/** Trade a code and the verifier for the session, and keep it. */
async function exchange(service: string, info: AccountInfo & { apiKey: string }, requestId: string, verifier: string, code: string, options: { store?: CredentialStore; fetch?: typeof fetch; active?: () => boolean }): Promise<CodeResult> {
  const doFetch = options.fetch ?? fetch;
  // whatever was pasted is a wrong code at worst: the service takes 40 characters
  const r = await post(doFetch, `${serviceKey(service)}/v1/auth/signin/${encodeURIComponent(requestId)}/token`, { verifier, code: code.trim().slice(0, 40) });
  if (r.ok && typeof r.body.customToken === "string") {
    const t = await signInWithCustomToken(info, r.body.customToken, options.fetch);
    // cancelled or timed out while this was on its way: the person was told nothing completed, so nothing is kept
    if (options.active && !options.active()) return { status: "expired" };
    const session = sessionFrom(service, info, t, "link");
    const store = options.store ?? new CredentialStore();
    store.put(session);
    store.changed();
    return { status: "signed-in", session };
  }
  switch (r.body.error?.code) {
    case "CODE_MISMATCH":
      return { status: "mismatch", attemptsLeft: Number(r.body.error.attemptsLeft ?? 0) };
    case "AUTHORIZATION_PENDING":
      return { status: "pending" };
    case "EXPIRED_TOKEN":
      return { status: "expired" };
    case "RATE_LIMITED":
      throw new AccountError("SIGN_IN_FAILED", r.body.error.message ?? "too many attempts; wait a moment and try again");
    default:
      throw new AccountError("SIGN_IN_FAILED", `the sign-in failed: ${r.body.error?.message ?? `the service answered ${r.status}`}`);
  }
}

/** Ask the service for a sign-in request. Throws LINK_UNSUPPORTED when the service has no such sign-in. */
async function request(service: string, info: AccountInfo, verifier: string, port: number | undefined, options: LinkLoginOptions): Promise<{ requestId: string; url: string; expiresIn: number }> {
  const doFetch = options.fetch ?? fetch;
  const r = await post(doFetch, `${serviceKey(service)}/v1/auth/signin`, { challenge: digest(verifier), client: options.client ?? "terminal", platform: options.platform ?? process.platform, ...(port ? { port } : {}) });
  if (r.status === 404 || r.status === 405) throw new AccountError("LINK_UNSUPPORTED", `${serviceKey(service)} has no sign-in by link (an older service)`);
  if (!r.ok || typeof r.body.requestId !== "string" || typeof r.body.signInUrl !== "string") throw new AccountError(r.status === 429 ? "SIGN_IN_FAILED" : "NO_SIGN_IN", `${serviceKey(service)} refused the sign-in: ${r.body.error?.message ?? `it answered ${r.status}`}`);
  // the page is opened in a browser: https only, or http on this machine
  const unsafe = browserUrlProblem(r.body.signInUrl);
  if (unsafe) throw new AccountError("NO_SIGN_IN", `${serviceKey(service)} names a sign-in page that is not opened: ${unsafe}`);
  // the page must be the one the service's discovery document names: a link to anywhere else is not shown
  if (info.signInUrl && new URL(r.body.signInUrl).origin !== new URL(info.signInUrl).origin) throw new AccountError("NO_SIGN_IN", `${serviceKey(service)} answered with a sign-in page on another site than the one it names`);
  return { requestId: r.body.requestId, url: r.body.signInUrl, expiresIn: Number(r.body.expiresIn ?? 600) };
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok, fail) => {
    let body = "";
    req.on("data", (d: Buffer) => {
      body += d;
      if (body.length > 16 * 1024) req.destroy(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        const v: unknown = JSON.parse(body || "{}");
        ok(v && typeof v === "object" ? (v as Record<string, unknown>) : {});
      } catch {
        ok({});
      }
    });
    req.on("error", fail);
  });
}

/**
 * Start a sign-in by link. The caller shows `url` (and opens it where there
 * is a browser), passes any typed code to `submitCode`, and waits for `done`.
 */
export async function startLinkLogin(service: string, options: LinkLoginOptions = {}): Promise<LinkLogin> {
  const info = await serviceAccount(service, options);
  const verifier = randomBytes(32).toString("base64url");
  let finish!: (s: Session) => void;
  let fail!: (e: Error) => void;
  const done = new Promise<Session>((ok, ko) => {
    finish = ok;
    fail = ko;
  });
  // nobody may be waiting on `done` yet when it is rejected (cancelled before the caller awaits it)
  done.catch(() => undefined);
  let over = false;
  let requestId = "";
  const submit = async (code: string): Promise<CodeResult> => {
    if (over) return { status: "expired" };
    const r = await exchange(service, info, requestId, verifier, code, { ...options, active: () => !over });
    if (r.status === "signed-in") end(() => finish(r.session));
    else if (r.status === "expired") end(() => fail(new AccountError("SIGN_IN_EXPIRED", "the sign-in expired or was used; start again")));
    return r;
  };

  // the page's hand-off: it posts the code here from the browser on this machine
  let server: Server | undefined;
  let port: number | undefined;
  const site = info.signInUrl ? new URL(info.signInUrl).origin : undefined;
  if (options.listen !== false && site) {
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const origin = req.headers.origin;
      const cors: Record<string, string> = origin === site ? { "access-control-allow-origin": site, vary: "Origin" } : {};
      const reply = (status: number, body: unknown, extra: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...cors, ...extra });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/handoff") return reply(404, { ok: false });
      // only the sign-in site's pages may call (a browser sends Origin on every cross-origin request)
      if (origin !== site) return reply(403, { ok: false });
      if (req.method === "OPTIONS")
        // the preflight, with the answer browsers want before a public page may reach this machine
        return reply(204, undefined, { "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-allow-private-network": "true", "access-control-max-age": "600" });
      if (req.method !== "POST") return reply(405, { ok: false });
      try {
        const body = await readJson(req);
        if (body.request !== requestId || typeof body.code !== "string") return reply(400, { ok: false });
        const r = await submit(body.code);
        return reply(r.status === "signed-in" ? 200 : 400, r.status === "signed-in" ? { ok: true, ...(r.session.email ? { email: r.session.email } : {}) } : { ok: false, status: r.status });
      } catch {
        return reply(500, { ok: false });
      }
    });
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
    port = (server.address() as AddressInfo).port;
  }
  const close = () => {
    // no new connections; the answer to the page's hand-off (which is what ended this) is still on its way
    // out, so the connections are dropped a moment later
    const s = server;
    s?.close();
    if (s) setTimeout(() => s.closeAllConnections?.(), 250).unref();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => end(() => fail(new AccountError("SIGN_IN_FAILED", "sign-in cancelled")));
  function end(settle: () => void) {
    if (over) return;
    over = true;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    close();
    settle();
  }

  let asked: Awaited<ReturnType<typeof request>>;
  try {
    asked = await request(service, info, verifier, port, options);
  } catch (e) {
    close();
    throw e;
  }
  requestId = asked.requestId;
  timer = setTimeout(() => end(() => fail(new AccountError("SIGN_IN_EXPIRED", "the sign-in link expired before anyone signed in; start again"))), options.timeoutMs ?? asked.expiresIn * 1000);
  timer.unref?.();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort);
  return { url: asked.url, requestId, expiresIn: asked.expiresIn, submitCode: submit, done, cancel: abort };
}

// ---------------------------------------------------------------- two steps (agents and scripts)

interface Pending {
  service: string;
  requestId: string;
  verifier: string;
  url: string;
  expiresAt: number;
}

/** Where a started sign-in waits for its code: beside the credentials, readable by this user only. */
export const pendingSignInFile = (env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) => join(configDir(env, platform), "sign-in-pending.json");

/**
 * The first of two steps: ask for a link and keep what the second step
 * needs. Nothing waits; `finishLinkLogin` completes it with the code the
 * page shows.
 */
export async function beginLinkLogin(service: string, options: LinkLoginOptions & { env?: NodeJS.ProcessEnv } = {}): Promise<{ url: string; expiresIn: number }> {
  const info = await serviceAccount(service, options);
  const verifier = randomBytes(32).toString("base64url");
  const asked = await request(service, info, verifier, undefined, options);
  const file = pendingSignInFile(options.env, options.platform);
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  const pending: Pending = { service: serviceKey(service), requestId: asked.requestId, verifier, url: asked.url, expiresAt: Date.now() + asked.expiresIn * 1000 };
  writeFileSync(file, JSON.stringify(pending), { mode: 0o600 });
  if ((options.platform ?? process.platform) !== "win32") chmodSync(file, 0o600);
  return { url: asked.url, expiresIn: asked.expiresIn };
}

/** The second step: the code the page showed. Throws NOT_STARTED when no sign-in was begun for this service. */
export async function finishLinkLogin(service: string, code: string, options: { store?: CredentialStore; fetch?: typeof fetch; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): Promise<CodeResult> {
  const file = pendingSignInFile(options.env, options.platform);
  let pending: Pending | undefined;
  try {
    pending = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Pending) : undefined;
  } catch {
    pending = undefined;
  }
  if (!pending || pending.service !== serviceKey(service)) throw new AccountError("NOT_STARTED", "no sign-in is waiting for a code here; start one with `protoboard login --start`");
  if (pending.expiresAt <= Date.now()) {
    rmSync(file, { force: true });
    return { status: "expired" };
  }
  const info = await serviceAccount(service, options);
  const r = await exchange(service, info, pending.requestId, pending.verifier, code, options);
  if (r.status === "signed-in" || r.status === "expired") rmSync(file, { force: true });
  return r;
}
