/**
 * The cloud's sign-in (PB-928, as changed on 2026-10-21), with the real CLI.
 * The service is a stand-in on a loopback port; nothing reaches a real one,
 * and no account of anyone's is used.
 *
 * - local commands run signed out, ask the service nothing and never mention a sign-in;
 * - `init` signed out makes the project and leaves a template's library parts for later;
 * - cloud commands (gate.ts) stop signed out with one line and exit 4, and change nothing;
 * - browsing the library (search, its categories, the project's libraries) is a cloud
 *   command too: signed out there is no access to the library at all;
 * - a signed-in, invited account passes; an account off the invite list does not;
 * - a service that signs no one in is open; the service token (CI) passes;
 * - the check sends two requests and nothing about the project.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCESS_EXIT_CODE } from "@protoboardai/core";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
// inside the repository, so the project resolves the workspace's packages
const TMP = realpathSync(mkdtempSync(join(REPO, "packages/cli/test/.tmp-access-")));
const PROJECT = join(TMP, "project");
const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

/** The stand-in service: what it answers can be changed per test; every request is kept. */
const state = { account: true, me: { signedIn: true, allowed: true } as Record<string, unknown> };
const requests: { method: string; url: string; authorization?: string; body: string }[] = [];
let server: Server;
let SERVICE = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ method: req.method ?? "", url: req.url ?? "", ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), body });
      res.setHeader("content-type", "application/json");
      if (req.url === "/.well-known/uhd-library") return res.end(JSON.stringify({ protocol: "uhd-library/v1", id: "protoboard", api: "/v1", ...(state.account ? { account: { provider: "firebase", apiKey: "key" } } : {}) }));
      if (req.url === "/v1/me") return res.end(JSON.stringify(state.me));
      // an empty search, for a signed-in account only, as on the real service (PB-928)
      if (req.url?.startsWith("/v1/parts?")) {
        if (state.account && !req.headers.authorization) {
          res.statusCode = 401;
          return res.end(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "the Protoboard library needs a signed-in Protoboard account: run `protoboard login`" } }));
        }
        return res.end(JSON.stringify({ total: 0, parts: [], nextCursor: null }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  SERVICE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  mkdirSync(join(PROJECT, "src"), { recursive: true });
  writeFileSync(join(PROJECT, "protoboard.config.ts"), `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "gated", root: { source: "src/gated.uhd.ts", export: "GATED" }, sources: ["src/**/*.uhd.ts"], catalog: "parts/catalog", cloud: { url: "${SERVICE}" }, extensions: [] });\n`);
  writeFileSync(join(PROJECT, "src/gated.uhd.ts"), `import type { ModuleDef } from "@deltarobotics/uhd";\nexport const GATED: ModuleDef = { id: "gated", name: "Gated", kind: "module", interfaces: [], children: [], links: [] };\n`);
});
afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  rmSync(TMP, { recursive: true, force: true });
});

/** A machine: its own config folder (credentials, the access record) and Protoboard folder. */
function machine(name: string) {
  const config = join(TMP, name, "config");
  mkdirSync(config, { recursive: true });
  const env = { PROTOBOARD_CONFIG_DIR: config, PROTOBOARD_CREDENTIAL_STORE: "file", PROTOBOARD_HOME: join(TMP, name, "home") };
  const signIn = (uid = "u1", email = "ada@example.com") =>
    writeFileSync(
      join(config, "credentials.json"),
      JSON.stringify({ [SERVICE]: { service: SERVICE, uid, email, refreshToken: "refresh-secret", apiKey: "key", signedInAt: "2026-10-07T00:00:00.000Z", via: "browser", idToken: jwt({ user_id: uid }), idTokenExpiresAt: Date.now() + 50 * 60_000 } }),
      { mode: 0o600 },
    );
  return { env, config, signIn };
}

/** Run the CLI: no PROTOBOARD_* of this process reaches it. */
function pb(args: string[], env: Record<string, string>, cwd = PROJECT): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_") && k !== "npm_config_registry"));
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...clean, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", fail);
    p.on("close", (code) => ok({ code, stdout, stderr }));
  });
}

const SIGN_IN = /sign[ -]?in|protoboard login/i;
/** What each cloud command's refusal names (gate.ts). */
const CLOUD: [args: string[], what: string][] = [
  [["parts", "search", "esp32"], "Searching the Protoboard library"],
  [["parts", "taxonomy"], "Browsing the Protoboard library's categories"],
  [["libraries"], "Managing the project's libraries"],
  [["libraries", "list", "--check"], "Managing the project's libraries"],
  [["libraries", "add", "acme", "https://parts.acme.example"], "Managing the project's libraries"],
  [["parts", "add", "acme-widget"], "Adding library parts"],
  [["parts", "update"], "Updating library parts"],
  [["parts", "update", "acme-widget", "--to", "2"], "Updating library parts"],
  [["parts", "list", "--check"], "Checking library parts for updates"],
  [["parts", "offers"], "Fetching offers from the Protoboard library"],
  [["parts", "prices", "acme-widget"], "Prices from the Protoboard library"],
  [["parts", "publish", "acme-widget"], "Publishing a part"],
];

describe("signed out: local work", () => {
  it("every local command runs, asks the service nothing and never mentions a sign-in", async () => {
    const m = machine("local");
    requests.length = 0;
    for (const args of [["check"], ["build"], ["inspect"], ["artifacts"], ["bom"], ["parts", "list"], ["parts", "migrate"], ["layout"], ["capabilities"], ["operations"], ["tools"], ["skills"], ["release", "--check"], ["views", "check", "--no-render"]]) {
      const r = await pb(args, m.env);
      expect(r.code, `${args.join(" ")}: ${r.stderr}`).not.toBe(4);
      expect(`${r.stdout}${r.stderr}`, args.join(" ")).not.toMatch(SIGN_IN);
    }
    // check and build pass on this project
    expect((await pb(["check"], m.env)).code).toBe(0);
    expect((await pb(["build"], m.env)).code).toBe(0);
    expect(existsSync(join(PROJECT, ".protoboard/build/resolved.json"))).toBe(true);
    // a command that is not a cloud command fails for its own reason, not for a sign-in
    const unknown = await pb(["run", "x"], m.env);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).not.toMatch(SIGN_IN);
    expect(requests).toEqual([]);
    rmSync(join(PROJECT, ".protoboard"), { recursive: true, force: true });
  }, 240_000);

  it("init makes a blank project with no account and no request", async () => {
    const m = machine("init-blank");
    requests.length = 0;
    const r = await pb(["init", join(TMP, "blank"), "--url", SERVICE], m.env, TMP);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(TMP, "blank/protoboard.config.ts"))).toBe(true);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(SIGN_IN);
    expect(requests).toEqual([]);
    expect((await pb(["init", "--list"], m.env, TMP)).code).toBe(0);
  }, 120_000);

  it("init from a template makes the project and leaves its library parts for after a sign-in", async () => {
    const m = machine("init-template");
    const r = await pb(["init", join(TMP, "drone"), "--template", "drone", "--url", SERVICE, "--format", "json"], m.env, TMP);
    expect(r.code, r.stderr).toBe(0);
    const d = JSON.parse(r.stdout) as { partsSkipped?: string; partsCommand?: string; catalogParts: string[] };
    expect(d.catalogParts.length).toBeGreaterThan(0);
    expect(d.partsSkipped).toBe(`The starting system's ${d.catalogParts.length} library part(s) needs a Protoboard account: sign in with \`protoboard login\` (not signed in to ${SERVICE}).`);
    expect(d.partsCommand).toBe(`protoboard parts add ${d.catalogParts.join(" ")}`);
    expect(existsSync(join(TMP, "drone/protoboard.config.ts"))).toBe(true);
    // nothing was asked of the library but whether it signs anyone in
    expect(requests.filter((x) => x.url.startsWith("/v1/parts"))).toEqual([]);
    // what it tells a person to run later is never a bare `npx protoboard` (an unrelated public npm package)
    const text = await pb(["init", join(TMP, "drone-text"), "--template", "drone", "--url", SERVICE], m.env, TMP);
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toMatch(/after signing in, run in the project:\n {2}(protoboard|npx @protoboardai\/cli) parts add /);
    expect(text.stdout).not.toMatch(/npx protoboard\b/);
  }, 120_000);
});

describe("signed out: the cloud", () => {
  it("each cloud command stops with one line naming what needs the account, exit 4, and changes nothing", async () => {
    const m = machine("signed-out");
    requests.length = 0;
    expect(ACCESS_EXIT_CODE).toBe(4);
    for (const [args, what] of CLOUD) {
      const r = await pb(args, m.env);
      expect(r.code, args.join(" ")).toBe(4);
      expect(r.stdout, args.join(" ")).toBe("");
      expect(r.stderr, args.join(" ")).toBe(`protoboard: ${what} needs a Protoboard account: sign in with \`protoboard login\` (not signed in to ${SERVICE}).\n`);
    }
    expect(existsSync(join(PROJECT, ".protoboard"))).toBe(false);
    expect(existsSync(join(PROJECT, "parts"))).toBe(false);
    // `libraries add` signed out did not write the library into the configuration
    expect(readFileSync(join(PROJECT, "protoboard.config.ts"), "utf8")).not.toContain("parts.acme.example");
    // only the discovery document was read: no part, revision, offer or publish request
    expect(requests.filter((x) => !["/.well-known/uhd-library", "/v1/me"].includes(x.url))).toEqual([]);
  }, 180_000);

  it("--format json carries the reason for a program to read", async () => {
    const m = machine("signed-out-json");
    const r = await pb(["parts", "add", "acme-widget", "--format", "json"], m.env);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout)).toMatchObject({ code: "SIGN_IN_REQUIRED", access: { allowed: false, reason: "signed-out", service: SERVICE } });
  });

  it("whoami, doctor and --help say what needs the account, and that local work does not", async () => {
    const m = machine("account-commands");
    const help = await pb(["--help"], m.env);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Local work needs no account");
    expect(help.stdout).not.toContain("for now (temporary)");
    const who = await pb(["whoami", "--format", "json"], m.env);
    expect(who.code).toBe(1);
    expect(JSON.parse(who.stdout)).toMatchObject({ signedIn: false, access: { allowed: false, reason: "signed-out" } });
    expect((await pb(["whoami"], m.env)).stdout).toBe(`Not signed in to ${SERVICE}. Local work (check, build, the viewer) needs no account; the Protoboard library (searching it, adding parts, prices and publishing) does: sign in with \`protoboard login\`.\n`);
    const doctor = await pb(["doctor"], m.env);
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).toContain(`Account (the Protoboard library)\n  – not signed in to ${SERVICE}: local work needs no account`);
    const outside = await pb(["doctor"], m.env, TMP);
    expect(outside.code).toBe(0);
    expect(outside.stdout).toContain("No project here (no protoboard.config.ts in");
    // login is open: it gets as far as asking this stand-in for a device code (which it does not issue)
    const login = await pb(["login", "--device"], m.env);
    expect(login.code).not.toBe(4);
  }, 120_000);
});

describe("signed in", () => {
  it("an invited account passes the gate; the check sends two requests and nothing about the project", async () => {
    const m = machine("invited");
    m.signIn();
    state.me = { signedIn: true, allowed: true };
    requests.length = 0;
    const r = await pb(["parts", "add", "acme-widget"], m.env);
    // past the gate, the stand-in has no such part: the command's own error, not a sign-in
    expect(r.code, r.stderr).not.toBe(4);
    expect(requests.slice(0, 2).map((x) => `${x.method} ${x.url}`)).toEqual(["GET /.well-known/uhd-library", "GET /v1/me"]);
    expect(requests[0].authorization).toBeUndefined();
    const gate = JSON.stringify(requests.slice(0, 2));
    for (const secretOrProject of ["refresh-secret", "gated", PROJECT]) expect(gate).not.toContain(secretOrProject);
    // the next cloud command asks nothing of /v1/me: the answer is recent
    requests.length = 0;
    await pb(["parts", "prices", "acme-widget"], m.env);
    expect(requests.map((x) => x.url)).not.toContain("/v1/me");
    expect(JSON.parse(readFileSync(join(m.config, "access.json"), "utf8"))[SERVICE]).toMatchObject({ uid: "u1", email: "ada@example.com" });
    // searching, signed in: the account's token goes with it, as the service needs (PB-928)
    requests.length = 0;
    const search = await pb(["parts", "search", "esp32"], m.env);
    expect(search.code, search.stderr).toBe(0);
    expect(search.stdout).toContain("0 part(s)");
    expect(requests.find((x) => x.url.startsWith("/v1/parts?"))?.authorization).toMatch(/^Bearer e30\./);
    rmSync(join(PROJECT, "parts"), { recursive: true, force: true });
  });

  it("an account the invite list refuses is told so", async () => {
    const m = machine("not-invited");
    m.signIn("u9", "eve@elsewhere.example");
    state.me = { signedIn: true, allowed: false, problem: "eve@elsewhere.example is not invited to this service" };
    const r = await pb(["parts", "add", "acme-widget"], m.env);
    const local = await pb(["check"], m.env);
    state.me = { signedIn: true, allowed: true };
    expect(r.code).toBe(4);
    expect(r.stderr).toBe(`protoboard: Adding library parts needs an invited account: eve@elsewhere.example is signed in to ${SERVICE} but is not on its invite list (eve@elsewhere.example is not invited to this service). Ask for an invitation, or sign in with \`protoboard login\` with an invited account. Local work (check, build, the viewer) needs no account.\n`);
    // local work is not the invite list's business
    expect(local.code, local.stderr).toBe(0);
    rmSync(join(PROJECT, ".protoboard"), { recursive: true, force: true });
  });

  it("a service that cannot be reached is not a refusal: the command says what it could not reach", async () => {
    const m = machine("offline");
    const r = await pb(["parts", "add", "acme-widget", "--url", "http://127.0.0.1:9"], m.env);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cannot reach");
    expect(r.stderr).not.toContain("needs a Protoboard account");
  });
});

describe("without an account", () => {
  it("a service that signs no one in is open", async () => {
    const m = machine("open-service");
    state.account = false;
    const r = await pb(["parts", "add", "acme-widget"], m.env);
    const who = await pb(["whoami"], m.env);
    const search = await pb(["parts", "search", "esp32"], m.env);
    state.account = true;
    expect(r.code, r.stderr).not.toBe(4);
    expect(search.code, search.stderr).toBe(0);
    expect(who.code).toBe(0);
    expect(who.stdout).toBe(`${SERVICE} signs no one in: everything there is open, with no account (a parts service without sign-in).\n`);
  });

  it("CI: PROTOBOARD_CLOUD_TOKEN passes, and the check asks nothing", async () => {
    const m = machine("ci");
    requests.length = 0;
    const r = await pb(["parts", "add", "acme-widget"], { ...m.env, PROTOBOARD_CLOUD_TOKEN: "service-token" });
    expect(r.code, r.stderr).not.toBe(4);
    expect(requests.map((x) => x.url)).not.toContain("/v1/me");
    rmSync(join(PROJECT, "parts"), { recursive: true, force: true });
  });
});
