/**
 * One sign-in per machine, end to end: the real CLI, the real parts service
 * (a protoboard-cloud checkout, cloud-checkout.ts) with Firebase sign-in, and
 * the Firebase Auth emulator (firebase-tools: $FIREBASE, else `firebase` on
 * PATH). Nothing reaches Google or a hosted service: the accounts are the
 * emulator's, the credentials a scratch folder's 0600 file.
 *
 * - `protoboard login --device` in a project: the CLI shows a code, an
 *   emulator account approves it (what the /device page does), the CLI keeps
 *   the sign-in;
 * - `whoami --check` says the service accepts it, and `parts search` finds
 *   the library's part;
 * - a second project on the same machine uses that sign-in with no new login;
 * - the service's revocation check cannot run (the accounts project refuses
 *   the service's user lookup with PERMISSION_DENIED, as a service account
 *   without permission to read users gets): the CLI says the service
 *   can't check sign-ins right now, never to sign in again, and the sign-in
 *   is kept;
 * - `logout`: whoami is signed out, and `parts search` stops with exit 4 and
 *   the sign-in line.
 *
 * Without the checkout or firebase-tools the test is skipped and says why.
 * scripts/ci-stack.sh runs it when protoboard-cloud is beside the stack.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UhdModuleDef } from "@protoboardai/cloud/client";
import { ACCESS_EXIT_CODE, SIGN_IN_CHECK_UNAVAILABLE } from "@protoboardai/core";
import { Blobs, closedPort, draft, startCloud, type CloudService } from "../../core/test/cloud.js";
import { cloudCheckout } from "../../core/test/cloud-checkout.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
const PROJECT_ID = "demo-protoboard";

/** firebase-tools, or why the test cannot run. */
function firebaseTools(): string | undefined {
  const bin = process.env.FIREBASE || "firebase";
  return spawnSync(bin, ["--version"], { encoding: "utf8" }).status === 0 ? bin : undefined;
}
const FIREBASE = firebaseTools();
const SKIP = !cloudCheckout() ? "no protoboard-cloud checkout (PROTOBOARD_CLOUD_DIR)" : !FIREBASE ? "no firebase-tools (FIREBASE, or firebase on PATH)" : undefined;
if (SKIP) console.warn(`sign-in-emulator.test.ts skipped: ${SKIP}`);

const PART: UhdModuleDef = {
  id: "test-signin-regulator",
  name: "Sign-in test regulator",
  manufacturer: "Test",
  part_number: "REG-SI",
  interfaces: [{ id: "vin", name: "VIN", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["sink"] }] }],
};

// inside the repository, so the projects resolve the workspace's packages
let TMP = "";
let emulator: ChildProcess | undefined;
let emulatorHost = "";
let proxy: Server;
let proxyHost = "";
/** Whether the accounts project refuses the service's user lookups (the permission the revocation check needs). */
const accounts = { deny: false };
let svc: CloudService;
let svcPort = 0;
let dataDir = "";
let machine: Record<string, string> = {};

/** Start the Auth emulator on free ports, in its own folder (firebase.json, its logs). */
async function startEmulator(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "pb-auth-emulator-"));
  const [auth, hub, logging] = [await closedPort(), await closedPort(), await closedPort()];
  writeFileSync(join(dir, "firebase.json"), JSON.stringify({ emulators: { auth: { host: "127.0.0.1", port: auth }, hub: { host: "127.0.0.1", port: hub }, logging: { host: "127.0.0.1", port: logging }, ui: { enabled: false } } }));
  emulator = spawn(FIREBASE!, ["emulators:start", "--only", "auth", "--project", PROJECT_ID], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  let log = "";
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`the Auth emulator did not start:\n${log}`)), 90_000);
    const on = (b: Buffer) => {
      log += b.toString();
      if (/All emulators ready/.test(log)) {
        clearTimeout(timer);
        ok();
      }
    };
    emulator!.stdout!.on("data", on);
    emulator!.stderr!.on("data", on);
    emulator!.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`the Auth emulator exited (${code}):\n${log}`));
    });
  });
  return `127.0.0.1:${auth}`;
}

function stopEmulator() {
  if (!emulator || emulator.exitCode !== null) return;
  try {
    // the firebase CLI starts the emulator as a child: the whole group goes
    if (process.platform !== "win32") process.kill(-emulator.pid!, "SIGTERM");
    else emulator.kill();
  } catch {
    emulator.kill();
  }
}

/**
 * Between the service and the emulator: everything passes, except, while
 * `accounts.deny`, the Admin SDK's user lookup (`/v1/projects/<id>/accounts:lookup`,
 * what `verifyIdToken(token, true)` calls), which gets the answer Identity
 * Toolkit gives a service account without `firebaseauth.users.get`.
 */
async function startProxy(): Promise<string> {
  proxy = createServer((req, res) => {
    if (accounts.deny && /\/projects\/[^/]+\/accounts:lookup/.test(req.url ?? "")) {
      res.writeHead(403, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { code: 403, message: "PERMISSION_DENIED: The caller does not have permission", status: "PERMISSION_DENIED" } }));
    }
    const [host, port] = emulatorHost.split(":");
    const up = request({ host, port: Number(port), method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  await new Promise<void>((ok) => proxy.listen(0, "127.0.0.1", ok));
  return `127.0.0.1:${(proxy.address() as { port: number }).port}`;
}

/** The parts service with Firebase sign-in against the emulator (through the proxy), on the same port and data each time. */
const startService = () =>
  startCloud({
    port: svcPort,
    dataDir,
    env: {
      PB_CLOUD_AUTH: "firebase",
      PB_CLOUD_FIREBASE_PROJECT: PROJECT_ID,
      PB_CLOUD_FIREBASE_API_KEY: "fake-api-key",
      PB_CLOUD_SITE_URL: "http://127.0.0.1:9",
      FIREBASE_AUTH_EMULATOR_HOST: proxyHost,
    },
  });

/** A project on this machine: its config names the test service. */
function project(name: string): string {
  const dir = join(TMP, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "protoboard.config.ts"), `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "${name}", root: { source: "src/main.uhd.ts", export: "MAIN" }, sources: ["src/**/*.uhd.ts"], catalog: "parts/catalog", cloud: { url: "${svc.url}" }, extensions: [] });\n`);
  writeFileSync(join(dir, "src/main.uhd.ts"), `import type { ModuleDef } from "@deltarobotics/uhd";\nexport const MAIN: ModuleDef = { id: "main", name: "Main", kind: "module", interfaces: [], children: [], links: [] };\n`);
  return dir;
}

/** Run the CLI on this machine: no PROTOBOARD_* of this process reaches it. `onLine` sees stdout as it comes. */
function pb(args: string[], cwd: string, onLine?: (line: string) => void): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_") && k !== "npm_config_registry" && k !== "FIREBASE_AUTH_EMULATOR_HOST"));
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...clean, ...machine }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let pending = "";
    p.stdout.on("data", (d) => {
      stdout += d;
      pending += d;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const l of lines) onLine?.(l);
    });
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", fail);
    p.on("close", (code) => ok({ code, stdout, stderr }));
  });
}

/** An emulator account, signed in: what a person signing in on the /device page has. */
async function emulatorAccount(email: string): Promise<string> {
  const res = await fetch(`http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "correct horse battery", returnSecureToken: true }) });
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`the emulator made no account: ${JSON.stringify(body)}`);
  return body.idToken;
}

const SIGN_IN_AGAIN = /sign in again|no longer works|protoboard login/i;

describe.skipIf(!!SKIP)("one sign-in per machine, against the Auth emulator", () => {
  beforeAll(async () => {
    TMP = realpathSync(mkdtempSync(join(REPO, "packages/cli/test/.tmp-signin-")));
    // the machine: its own config folder (credentials in a 0600 file, never a keyring) and Protoboard folder
    machine = { PROTOBOARD_CONFIG_DIR: join(TMP, "machine", "config"), PROTOBOARD_CREDENTIAL_STORE: "file", PROTOBOARD_HOME: join(TMP, "machine", "home"), HOME: join(TMP, "machine", "user") };
    for (const d of Object.values(machine).filter((v) => v.startsWith(TMP))) mkdirSync(d, { recursive: true });
    emulatorHost = await startEmulator();
    proxyHost = await startProxy();
    svcPort = await closedPort();
    dataDir = mkdtempSync(join(tmpdir(), "pb-parts-signin-"));
    svc = await startService();
    const blobs = new Blobs();
    await svc.client.publish(draft(blobs, PART), blobs.source);
  }, 180_000);

  afterAll(async () => {
    await svc?.stop();
    if (proxy) await new Promise((ok) => proxy.close(ok));
    stopEmulator();
    if (TMP) rmSync(TMP, { recursive: true, force: true });
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("signs in once, and every project and later check uses that sign-in until logout", async () => {
    const first = project("first");
    // signed out: the library stops with the sign-in line
    const out = await pb(["parts", "search", "regulator"], first);
    expect(out.code).toBe(ACCESS_EXIT_CODE);
    expect(out.stderr).toMatch(/protoboard login/);

    // login --device: the CLI shows a code; an emulator account approves it, as the /device page does
    const idToken = await emulatorAccount("ada@example.com");
    let approved: Promise<Response> | undefined;
    const login = await pb(["login", "--device", "--format", "json"], first, (line) => {
      if (approved || !line.startsWith("{")) return;
      const prompt = JSON.parse(line) as { userCode?: string };
      if (!prompt.userCode) return;
      approved = fetch(`${svc.url}/v1/auth/device/approve`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` }, body: JSON.stringify({ userCode: prompt.userCode }) });
    });
    expect(login.code, login.stderr).toBe(0);
    expect((await approved!).status).toBe(200);

    // whoami --check: the service accepts it
    const who = await pb(["whoami", "--check", "--format", "json"], first);
    expect(who.code, who.stderr).toBe(0);
    expect(JSON.parse(who.stdout)).toMatchObject({ signedIn: true, valid: true, email: "ada@example.com", via: "device", access: { allowed: true } });

    // parts search finds the library's part
    const found = await pb(["parts", "search", "regulator", "--format", "json"], first);
    expect(found.code, found.stderr).toBe(0);
    expect(found.stdout).toContain(PART.id);

    // a second project on this machine: the same sign-in, no login
    const second = project("second");
    const again = await pb(["whoami", "--check", "--format", "json"], second);
    expect(again.code, again.stderr).toBe(0);
    expect(JSON.parse(again.stdout)).toMatchObject({ signedIn: true, valid: true, email: "ada@example.com" });
    const there = await pb(["parts", "search", "regulator", "--format", "json"], second);
    expect(there.code, there.stderr).toBe(0);
    expect(there.stdout).toContain(PART.id);

    // the service cannot check sign-ins (its account may not read users): it is restarted, so no passed check is
    // remembered, with the accounts project refusing its lookups
    await svc.stop();
    accounts.deny = true;
    svc = await startService();
    try {
      const unchecked = await pb(["whoami", "--check", "--format", "json"], second);
      const w = JSON.parse(unchecked.stdout) as { signedIn: boolean; checkUnavailable?: boolean; problem?: string; access: { allowed: boolean; reason?: string; message?: string } };
      expect(w).toMatchObject({ signedIn: true, checkUnavailable: true, access: { allowed: false, reason: "check-unavailable" } });
      expect(w.access.message).toBe(SIGN_IN_CHECK_UNAVAILABLE);
      expect(`${w.problem} ${w.access.message}`).not.toMatch(SIGN_IN_AGAIN);
      // a library command says the same, and never to sign in again
      const refused = await pb(["parts", "search", "regulator"], second);
      expect(refused.code).not.toBe(0);
      expect(refused.stderr).toContain(SIGN_IN_CHECK_UNAVAILABLE);
      expect(refused.stderr).not.toMatch(SIGN_IN_AGAIN);
      // the sign-in is kept
      expect(JSON.parse((await pb(["whoami", "--format", "json"], second)).stdout)).toMatchObject({ signedIn: true, email: "ada@example.com" });
    } finally {
      // the permission granted: the same sign-in works again, with no login
      await svc.stop();
      accounts.deny = false;
      svc = await startService();
    }
    const back = await pb(["parts", "search", "regulator", "--format", "json"], second);
    expect(back.code, back.stderr).toBe(0);
    expect(back.stdout).toContain(PART.id);

    // logout: signed out everywhere on this machine
    expect((await pb(["logout"], first)).code).toBe(0);
    const gone = await pb(["whoami", "--format", "json"], second);
    expect(JSON.parse(gone.stdout)).toMatchObject({ signedIn: false });
    const stopped = await pb(["parts", "search", "regulator"], second);
    expect(stopped.code).toBe(ACCESS_EXIT_CODE);
    expect(stopped.stderr).toMatch(/protoboard login/);
  }, 300_000);
});
