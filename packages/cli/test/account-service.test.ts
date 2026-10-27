/**
 * Which service `protoboard login`, `logout` and `whoami` talk to, and what
 * they say when it does not answer.
 *
 * Outside a project they use the hosted Protoboard library (a new user signs
 * in before there is a project; localhost there gave a bare "fetch failed").
 * Inside a project they follow the project: its cloud.url, or localhost when
 * it sets none, as its `parts` commands do. --url and PROTOBOARD_CLOUD_URL
 * win everywhere. Nothing here reaches the hosted service: the commands that
 * would ask it are pointed at a port nothing listens on.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CLOUD_URL, HOSTED_CLOUD_URL, accountService, cloudUrlInConfigText, unloadedProjectService, unreachableService } from "@protoboardai/core";

const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-account-service-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A folder with no protoboard.config.ts in it or above it. */
const OUTSIDE = join(TMP, "no-project");
/** Projects: one whose config names a service, one whose config names none. */
const PROJECT = join(TMP, "project");
const BARE = join(TMP, "bare");
/** A project whose config throws when it is loaded. */
const BROKEN = join(TMP, "broken");
/** A project as `protoboard init` writes it, whose packages are not there: its config imports one. */
const UNINSTALLED = join(TMP, "uninstalled");
/** A URL on this machine that refuses connections: a port that was free a moment ago. */
let DEAD = "";

beforeAll(async () => {
  const port = await new Promise<number>((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
  DEAD = `http://127.0.0.1:${port}`;
  for (const d of [OUTSIDE, PROJECT, BARE, BROKEN, UNINSTALLED]) mkdirSync(d, { recursive: true });
  for (const d of [PROJECT, BARE, BROKEN, UNINSTALLED]) writeFileSync(join(d, "package.json"), `{ "name": "fixture", "private": true, "type": "module" }\n`);
  writeFileSync(
    join(UNINSTALLED, "protoboard.config.ts"),
    `import { defineConfig } from "@protoboardai/not-installed-here";\nexport default defineConfig({\n  name: "u",\n  // e.g. http://localhost:8787 for a parts service on this machine\n  cloud: { url: "${DEAD}" },\n});\n`,
  );
  writeFileSync(join(BROKEN, "protoboard.config.ts"), `throw new Error("no such thing");\nexport default {};\n`);
  writeFileSync(join(PROJECT, "protoboard.config.ts"), `export default { name: "p", root: { source: "src/p.uhd.ts", export: "P" }, sources: [], cloud: { url: "${DEAD}/" } };\n`);
  writeFileSync(join(BARE, "protoboard.config.ts"), `export default { name: "b", root: { source: "src/b.uhd.ts", export: "B" }, sources: [] };\n`);
});

function cli(cwd: string, args: string[], env: Record<string, string> = {}) {
  // the user's own sign-ins and PROTOBOARD_* settings stay out of it: a scratch credential file
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_")));
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...clean, PROTOBOARD_CONFIG_DIR: join(TMP, "config"), PROTOBOARD_CREDENTIAL_STORE: "file", ...env }, timeout: 60_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) as Record<string, unknown> };
}

describe("accountService: the service the account commands use", () => {
  it("is the hosted library when there is no project and no override", () => {
    expect(accountService(undefined, { env: {}, inProject: false })).toEqual({ url: HOSTED_CLOUD_URL, source: "default" });
  });

  it("follows the project inside one: its cloud.url, or localhost when it sets none (what its parts commands use)", () => {
    expect(accountService({ cloud: { url: "http://localhost:8795/" } } as never, { env: {}, inProject: true })).toEqual({ url: "http://localhost:8795", source: "project" });
    expect(accountService({} as never, { env: {}, inProject: true })).toEqual({ url: DEFAULT_CLOUD_URL, source: "project-default" });
    // a project whose config could not be loaded is still a project
    expect(accountService(undefined, { env: {}, inProject: true })).toEqual({ url: DEFAULT_CLOUD_URL, source: "project-default" });
  });

  it("--url, then PROTOBOARD_CLOUD_URL, win with or without a project", () => {
    const env = { PROTOBOARD_CLOUD_URL: "http://localhost:9000/" };
    for (const inProject of [false, true]) {
      const config = inProject ? ({ cloud: { url: "http://localhost:8795" } } as never) : undefined;
      expect(accountService(config, { env, inProject })).toEqual({ url: "http://localhost:9000", source: "environment" });
      expect(accountService(config, { url: "http://127.0.0.1:1234/", env, inProject })).toEqual({ url: "http://127.0.0.1:1234", source: "flag" });
    }
  });
});

describe("unreachableService: the URL tried, why that one, and how to use another", () => {
  const what = "GET https://example.test/.well-known/uhd-library: fetch failed: ENOTFOUND";

  it("names the hosted default and both overrides", () => {
    expect(unreachableService(HOSTED_CLOUD_URL, what, "default")).toBe(
      [
        `Cannot reach ${HOSTED_CLOUD_URL} (${what}).`,
        "  That is the hosted Protoboard library: the default when there is no project here, no --url and no PROTOBOARD_CLOUD_URL.",
        "  Check your connection. For another service, pass --url <url> or set PROTOBOARD_CLOUD_URL (http://localhost:8787 for a parts service on this machine); inside a project, its cloud.url is used.",
      ].join("\n"),
    );
  });

  it("says which of flag, environment and project gave the URL", () => {
    expect(unreachableService("http://x", what, "flag")).toContain("That URL is the one given with --url.");
    expect(unreachableService("http://x", what, "environment")).toContain("That URL comes from the PROTOBOARD_CLOUD_URL environment variable.");
    expect(unreachableService("http://x", what, "project", "/work/p/protoboard.config.ts")).toContain("That URL is cloud.url in /work/p/protoboard.config.ts: the service this project takes its parts from.");
    expect(unreachableService("http://localhost:8787", what, "project-default", "/work/p/protoboard.config.ts")).toContain("/work/p/protoboard.config.ts sets no cloud.url, so this is the default for a project without one: a parts service on this machine.");
    expect(unreachableService("http://x", what, "project-file", "/work/p/protoboard.config.ts")).toContain("cloud.url as written in /work/p/protoboard.config.ts");
    expect(unreachableService("http://x", what, "saved", "/work/p/protoboard.config.ts")).toContain("the service this machine is signed in to");
    for (const source of ["flag", "environment", "project", "project-default", "default", "project-file", "saved"] as const) {
      const m = unreachableService("http://x", what, source);
      expect(m, source).toContain(`Cannot reach http://x (${what}).`);
      expect(m, source).toContain("--url");
      expect(m.split("\n"), source).toHaveLength(3);
    }
  });
});

describe("protoboard whoami, logout and login: the service", () => {
  it("outside a project it is the hosted library, not localhost", () => {
    expect(cli(OUTSIDE, ["whoami", "--format", "json"]).json()).toMatchObject({ service: HOSTED_CLOUD_URL, signedIn: false });
    expect(cli(OUTSIDE, ["whoami"]).stdout).toContain(`Not signed in to ${HOSTED_CLOUD_URL}`);
    expect(cli(OUTSIDE, ["logout", "--format", "json"]).json()).toEqual({ service: HOSTED_CLOUD_URL, signedOut: false });
  });

  it("outside a project, --url and PROTOBOARD_CLOUD_URL still choose it", () => {
    expect(cli(OUTSIDE, ["whoami", "--format", "json", "--url", "http://localhost:8787/"]).json()).toMatchObject({ service: "http://localhost:8787" });
    expect(cli(OUTSIDE, ["whoami", "--format", "json"], { PROTOBOARD_CLOUD_URL: "http://localhost:9000" }).json()).toMatchObject({ service: "http://localhost:9000" });
    expect(cli(OUTSIDE, ["whoami", "--format", "json", "--url", "http://localhost:8787"], { PROTOBOARD_CLOUD_URL: "http://localhost:9000" }).json()).toMatchObject({ service: "http://localhost:8787" });
  });

  it("inside a project it is the project's cloud.url, and localhost for a project that sets none", () => {
    expect(cli(PROJECT, ["whoami", "--format", "json"]).json()).toMatchObject({ service: DEAD });
    expect(cli(BARE, ["whoami", "--format", "json"]).json()).toMatchObject({ service: DEFAULT_CLOUD_URL });
    expect(cli(PROJECT, ["whoami", "--format", "json"], { PROTOBOARD_CLOUD_URL: "http://localhost:9000" }).json()).toMatchObject({ service: "http://localhost:9000" });
  });

  it("a project whose config does not load never sends the sign-in to localhost: it is the user's service, and said so", () => {
    // first builds review, item 23: a project without its packages asked localhost:8787, and a signed-in person was shown as signed out
    const r = cli(BROKEN, ["whoami", "--format", "json"]);
    expect(r.json()).toMatchObject({ service: HOSTED_CLOUD_URL, signedIn: false });
    expect(r.stderr).toContain(`${join(BROKEN, "protoboard.config.ts")} could not be loaded (no such thing), so its cloud.url is not known: using the hosted Protoboard library, ${HOSTED_CLOUD_URL}`);
    // an override needs nothing from the config: no remark
    expect(cli(BROKEN, ["whoami", "--url", "http://localhost:9000"]).stderr).toBe("");
    expect(cli(BROKEN, ["whoami", "--format", "json"], { PROTOBOARD_CLOUD_URL: "http://localhost:9000" }).json()).toMatchObject({ service: "http://localhost:9000" });
  });

  it("a project without its packages: the cloud.url written in its config is read from the text", () => {
    // what `protoboard init` writes, in a folder with no node_modules above it: the import cannot be resolved
    const r = cli(UNINSTALLED, ["whoami", "--format", "json"]);
    expect(r.json()).toMatchObject({ service: DEAD, signedIn: false });
    expect(r.stderr).toContain("could not be loaded");
    expect(r.stderr).toContain(`its cloud.url was read from the file as text, ${DEAD}`);
    expect(cli(UNINSTALLED, ["logout", "--format", "json"]).json()).toEqual({ service: DEAD, signedOut: false });
  });

  it("a project that cannot say its service uses the one this machine is signed in to", () => {
    const config = join(TMP, "config-signed-in");
    mkdirSync(config, { recursive: true });
    const session = { service: "https://parts.example", uid: "u1", email: "ada@example.com", apiKey: "k", refreshToken: "r", signedInAt: "2026-10-01T00:00:00.000Z", via: "browser" };
    writeFileSync(join(config, "credentials.json"), JSON.stringify({ "https://parts.example": session }));
    const r = cli(BROKEN, ["whoami", "--format", "json"], { PROTOBOARD_CONFIG_DIR: config });
    expect(r.json()).toMatchObject({ service: "https://parts.example", signedIn: true, email: "ada@example.com" });
    expect(r.stderr).toContain("using the service this machine is signed in to, https://parts.example");
  });

  it("the sign-in check of a cloud command asks the same service, not localhost", () => {
    // DEAD does not answer: not a refusal (the command goes on and fails for its own reason), and never localhost
    const r = cli(UNINSTALLED, ["parts", "add", "acme-widget", "--format", "json"]);
    expect(r.status).not.toBe(4);
    expect(r.stdout + r.stderr).not.toContain("localhost:8787");
    // a local command asks nothing at all
    const local = cli(UNINSTALLED, ["check", "--format", "json"]);
    expect(local.status).not.toBe(4);
    expect(local.stdout + local.stderr).not.toMatch(/protoboard login/);
  });
});

describe("cloudUrlInConfigText and unloadedProjectService", () => {
  it("reads the URL init writes, and not the one in the comment above it", () => {
    const text = `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({\n  name: "p",\n  // the Protoboard library; PROTOBOARD_CLOUD_URL or --url\n  // overrides it, e.g. http://localhost:8787 for a parts service on this machine\n  cloud: { url: "https://parts.example/" },\n});\n`;
    expect(cloudUrlInConfigText(text)).toBe("https://parts.example");
    expect(cloudUrlInConfigText(`export default { cloud: {\n    url: 'http://localhost:8795',\n  } };`)).toBe("http://localhost:8795");
  });

  it("gives nothing for a file that names none, or computes it", () => {
    expect(cloudUrlInConfigText(`export default { name: "p" };`)).toBeUndefined();
    expect(cloudUrlInConfigText("export default { cloud: { url: process.env.X } };")).toBeUndefined();
    expect(cloudUrlInConfigText("export default { cloud: { url: `${base}/v1` } };")).toBeUndefined();
    expect(cloudUrlInConfigText(`// cloud: { url: "http://commented.example" }\nexport default {};`)).toBeUndefined();
  });

  it("orders: --url, the environment, the file's text, a saved sign-in (the hosted one first), the hosted library", () => {
    const text = `export default { cloud: { url: "https://file.example" } };`;
    expect(unloadedProjectService(text, { url: "http://flag.example/", env: { PROTOBOARD_CLOUD_URL: "http://env.example" }, saved: ["https://saved.example"] })).toEqual({ url: "http://flag.example", source: "flag" });
    expect(unloadedProjectService(text, { env: { PROTOBOARD_CLOUD_URL: "http://env.example" }, saved: ["https://saved.example"] })).toEqual({ url: "http://env.example", source: "environment" });
    expect(unloadedProjectService(text, { env: {}, saved: ["https://saved.example"] })).toEqual({ url: "https://file.example", source: "project-file" });
    expect(unloadedProjectService("export default {};", { env: {}, saved: ["https://saved.example", HOSTED_CLOUD_URL] })).toEqual({ url: HOSTED_CLOUD_URL, source: "saved" });
    expect(unloadedProjectService(undefined, { env: {}, saved: ["https://saved.example"] })).toEqual({ url: "https://saved.example", source: "saved" });
    expect(unloadedProjectService(undefined, { env: {} })).toEqual({ url: HOSTED_CLOUD_URL, source: "default" });
    // never the development default
    expect(unloadedProjectService("export default {};", { env: {} }).url).not.toBe(DEFAULT_CLOUD_URL);
  });
});

describe("protoboard login and whoami --check: a service that does not answer", () => {
  it("login says the URL, that --url gave it, and what to do; not a bare fetch failed", () => {
    for (const args of [["login", "--device"], ["login"]]) {
      const r = cli(OUTSIDE, [...args, "--url", DEAD]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`protoboard: Cannot reach ${DEAD} (GET ${DEAD}/.well-known/uhd-library: fetch failed: ECONNREFUSED).`);
      expect(r.stderr).toContain("That URL is the one given with --url.");
      expect(r.stderr).toContain("leave --url out to use the default");
    }
  });

  it("login says when the environment or the project gave the URL", () => {
    const env = cli(OUTSIDE, ["login", "--device"], { PROTOBOARD_CLOUD_URL: DEAD });
    expect(env.stderr).toContain(`Cannot reach ${DEAD} (`);
    expect(env.stderr).toContain("That URL comes from the PROTOBOARD_CLOUD_URL environment variable.");
    const project = cli(PROJECT, ["login", "--device"]);
    expect(project.status).toBe(2);
    expect(project.stderr).toContain(`Cannot reach ${DEAD} (`);
    expect(project.stderr).toContain(`That URL is cloud.url in ${join(PROJECT, "protoboard.config.ts")}: the service this project takes its parts from.`);
    expect(project.stderr).toContain("pass --url <url> or set PROTOBOARD_CLOUD_URL");
    // as JSON, the same message is the error
    expect(JSON.parse(cli(PROJECT, ["login", "--device", "--format", "json"]).stdout).error).toContain(`Cannot reach ${DEAD} (`);
  });

  it("whoami --check reports it (exit 1) instead of saying only that no one is signed in", () => {
    const r = cli(PROJECT, ["whoami", "--check"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`Cannot reach ${DEAD} (GET ${DEAD}/.well-known/uhd-library: fetch failed: ECONNREFUSED).`);
    expect(r.stdout).toContain("That URL is cloud.url in ");
    expect(r.stdout).toContain("No sign-in is kept here for it.");
    const j = cli(OUTSIDE, ["whoami", "--check", "--format", "json", "--url", DEAD]);
    expect(j.status).toBe(1);
    expect(j.json()).toMatchObject({ service: DEAD, signedIn: false, source: "flag", unreachable: `GET ${DEAD}/.well-known/uhd-library: fetch failed: ECONNREFUSED` });
    expect(String(j.json().message)).toContain("That URL is the one given with --url.");
    // without --check nothing is asked, so nothing can fail
    expect(cli(PROJECT, ["whoami"]).stdout).toContain(`Not signed in to ${DEAD}`);
  });
});

describe("protoboard login --device: what it tells the service about this machine", () => {
  it("the platform only, never the machine's name (PB-1047)", async () => {
    const { createServer: httpServer } = await import("node:http");
    const { spawn } = await import("node:child_process");
    const { hostname } = await import("node:os");
    const bodies: string[] = [];
    const server = httpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = req.url ?? "";
        if (url === "/.well-known/uhd-library" || url === "/v1") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ protocol: "uhd-library/v1", name: "t", version: "1", api: "/v1", envelopeSchemas: [], uhdSchema: {}, taxonomy: null, capabilities: [], auth: { read: "bearer" }, account: { required: [], provider: "firebase", apiKey: "key", projectId: "demo" } }));
        } else if (url === "/v1/auth/device" && req.method === "POST") {
          bodies.push(body);
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { code: "NOPE", message: "not in this test" } }));
        } else {
          res.statusCode = 404;
          res.end();
        }
      });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_")));
      await new Promise<void>((ok) => {
        const child = spawn(process.execPath, [CLI, "login", "--device", "--url", url], { cwd: OUTSIDE, env: { ...clean, PROTOBOARD_CONFIG_DIR: join(TMP, "config-device"), PROTOBOARD_CREDENTIAL_STORE: "file" }, stdio: "ignore" });
        child.on("exit", () => ok());
      });
    } finally {
      server.close();
    }
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!)).toEqual({ client: `protoboard CLI (${process.platform})` });
    if (hostname()) expect(bodies[0]).not.toContain(hostname());
  });
});

describe("protoboard account (PB-1089): the account page", () => {
  /** The CLI run without blocking this process, so a service in it can answer. */
  const cliAsync = (args: string[], env: Record<string, string> = {}) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((ok) => {
      const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_")));
      const child = spawn(process.execPath, [CLI, ...args], { cwd: OUTSIDE, env: { ...clean, PROTOBOARD_CONFIG_DIR: join(TMP, "config"), PROTOBOARD_CREDENTIAL_STORE: "file", ...env } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (status) => ok({ status, stdout, stderr }));
    });

  it("prints the page the service's discovery names (or /account beside its sign-in page)", async () => {
    const account: Record<string, unknown> = { provider: "firebase", apiKey: "k", signInUrl: "https://site.example/login" };
    const server = createHttpServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ protocol: "uhd-library/v1", api: "/v1", account })));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const derived = await cliAsync(["account", "--url", url, "--json"]);
      expect(derived.status, derived.stderr).toBe(0);
      expect(JSON.parse(derived.stdout)).toEqual({ service: url, url: "https://site.example/account", opened: false });
      account.accountUrl = "https://site.example/me";
      const named = await cliAsync(["account", "--url", url, "--json"]);
      expect(JSON.parse(named.stdout)).toMatchObject({ url: "https://site.example/me" });
    } finally {
      server.close();
    }
  });

  it("says when the service cannot be reached", () => {
    const r = cli(OUTSIDE, ["account", "--url", DEAD]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(DEAD);
  });
});
