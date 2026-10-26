/**
 * Which web addresses a secret or a browser may be sent to (PB-1048).
 *
 * - A token (a library's, a signed-in user's, the service token) never goes
 *   over plain http to a host that is not this machine: anyone on the path
 *   could read it.
 * - `PROTOBOARD_CLOUD_TOKEN`, the service's own token (CI), goes to the
 *   hosted Protoboard service's origin only, or to the origins listed in
 *   `PROTOBOARD_CLOUD_TOKEN_ORIGINS` (comma-separated, e.g. a staging service
 *   or `http://127.0.0.1:8787` for one on this machine). A project's
 *   cloud.url cannot send it elsewhere.
 * - A library's `authEnv` names a variable `PROTOBOARD_<NAME>_TOKEN`, never
 *   the service token, so a project cannot name any other variable of the
 *   user's environment as the token to send to its URL.
 * - A page handed to the system's browser (the sign-in page) is https, or
 *   http on this machine.
 */
/**
 * The hosted Protoboard library: the parts service's public URL.
 * `protoboard init` writes it into a new project's `cloud.url` (`--local`
 * writes DEFAULT_CLOUD_URL instead; `--url` and PROTOBOARD_CLOUD_URL win
 * over both).
 */
export const HOSTED_CLOUD_URL = "https://protoboard-parts-628357308644.us-central1.run.app";

/** Lists the origins besides the hosted service that may receive PROTOBOARD_CLOUD_TOKEN. */
export const CLOUD_TOKEN_ORIGINS_ENV = "PROTOBOARD_CLOUD_TOKEN_ORIGINS";

/** What `authEnv` may name: `PROTOBOARD_<NAME>_TOKEN`, not the service token. */
export const AUTH_ENV_NAME = /^PROTOBOARD_[A-Z0-9_]+_TOKEN$/;
export const isAuthEnvName = (name: unknown): name is string => typeof name === "string" && AUTH_ENV_NAME.test(name) && name !== "PROTOBOARD_CLOUD_TOKEN";

/** This machine by name: localhost, 127.0.0.0/8, ::1. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127(?:\.\d{1,3}){3}$/.test(h);
}

const parse = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

/** Why a token may not be sent to `url`, or undefined when it may: https, or http to this machine. */
export function tokenTransportProblem(url: string): string | undefined {
  const u = parse(url);
  if (!u) return `${url} is not a URL`;
  if (u.protocol === "https:") return undefined;
  if (u.protocol === "http:" && isLoopbackHost(u.hostname)) return undefined;
  return `${u.origin} is not https, so no token is sent to it (http is for a service on this machine only)`;
}

/** The origins PROTOBOARD_CLOUD_TOKEN may go to: the hosted service's, and those PROTOBOARD_CLOUD_TOKEN_ORIGINS lists. */
export function cloudTokenOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const listed = (env[CLOUD_TOKEN_ORIGINS_ENV] ?? "").split(",").map((s) => parse(s.trim())?.origin).filter((o): o is string => !!o && o !== "null");
  return [...new Set([new URL(HOSTED_CLOUD_URL).origin, ...listed])];
}

/** Whether PROTOBOARD_CLOUD_TOKEN may be sent to `url`. */
export function cloudTokenAllowed(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const u = parse(url);
  return !!u && !tokenTransportProblem(url) && cloudTokenOrigins(env).includes(u.origin);
}

/** Why a page may not be handed to the system's browser, or undefined: it must be https, or http on this machine. */
export function browserUrlProblem(url: string): string | undefined {
  const u = parse(url);
  if (!u) return `${JSON.stringify(url)} is not a URL`;
  if (u.protocol === "https:" || (u.protocol === "http:" && isLoopbackHost(u.hostname))) return undefined;
  return `${u.protocol === "http:" ? u.origin : JSON.stringify(url)} is not an https page (http is accepted for this machine only), so it is not opened`;
}
