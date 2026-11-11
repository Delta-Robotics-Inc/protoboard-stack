/**
 * Issue and feature reporting through the agent (PB-1197): every redaction
 * rule, the draft under .protoboard/local/reports/, nothing sent without the
 * token, a draft changed after it was shown refused, the stub when
 * PROTOBOARD_REPORTS_URL is unset, https-or-loopback only, a real loopback
 * send, telemetry off leaves telemetry out, the bundle and log caps, files
 * that are never read.
 */
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appendTelemetry } from "@protoboardai/core/telemetry";
import { DESCRIPTION_LIMIT } from "../src/mcp/instructions.js";
import type { ToolContext, ToolSpec } from "../src/mcp/tools.js";
import {
  CONFIRM_NOTE,
  ID_RE,
  REPORT_SCHEMA,
  REPORTS_DIR,
  Redactor,
  buildReport,
  createDraft,
  isForbiddenFile,
  isSecretName,
  listDrafts,
  reportTools,
  reportsEndpoint,
  sendDraft,
  type ReportOptions,
} from "../src/mcp/report-tools.js";

const TMP = mkdtempSync(join(tmpdir(), "pb-report-tools-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
let n = 0;

/** A fresh project folder per test. */
function project(): string {
  const root = join(TMP, `p${++n}`);
  mkdirSync(join(root, ".protoboard", "local"), { recursive: true });
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "drone-test", dependencies: { "@protoboardai/core": "^0.2.0" } }));
  return root;
}

const CONFIG = join(TMP, "config");
const ENV_ON = { PROTOBOARD_CONFIG_DIR: CONFIG } as NodeJS.ProcessEnv;
const INV = () => ({ stack: "0.2.2", cli: "0.2.2", viewer: "0.2.1", node: "24.11.0", os: "win32", arch: "x64" });
const opts = (o: Partial<ReportOptions> = {}): ReportOptions => ({ env: ENV_ON, inventory: INV, redact: { home: ["C:\\Users\\alice", "/home/alice"], users: ["alice"] }, ...o });
const INPUT = { title: "Viewer goes blank on orbit", description: "The 3D view went blank after orbiting for a minute." };

const ctxFor = (root: string): ToolContext => ({
  dir: async (g) => g ?? root,
  cli: async () => ({ code: 0, stdout: "{}", stderr: "" }),
  cliFor: () => ({ entry: "x", from: "server" }),
  version: "0.0.0-test",
  about: "",
});
const call = async (tools: ToolSpec[], name: string, args: Record<string, unknown>, ctx: ToolContext) => {
  const t = tools.find((x) => x.name === name)!;
  return t.handler(args as never, ctx);
};

describe("redaction of the machine's name (wave 4 gate)", () => {
  it("replaces the host name as a whole word only", () => {
    const red = new Redactor({ home: [], users: [], hosts: ["KEVS-LAPTOP"], platform: "win32" });
    expect(red.text("built on kevs-laptop at noon; KEVS-LAPTOPS stays")).toBe("built on <host> at noon; KEVS-LAPTOPS stays");
    expect(red.counts["host-name"]).toBe(1);
  });
});

describe("redaction rules", () => {
  const ROOT = "C:\\Users\\alice\\work\\drone";
  const r = () => new Redactor({ root: ROOT, home: ["C:\\Users\\alice", "/home/alice"], users: ["alice"], platform: "win32" });
  const CASES: [string, string, string, string][] = [
    // rule, input, a value that must be gone, what it becomes
    ["project-path", `failed to read ${ROOT}\\src\\frame.ts`, "C:\\Users\\alice\\work\\drone", "<project>\\src\\frame.ts"],
    ["project-path", `json "C:\\\\Users\\\\alice\\\\work\\\\drone\\\\out"`, "alice", "<project>"],
    ["home-path", "cache at C:\\Users\\alice\\.protoboard-dev\\stack", "C:\\Users\\alice", "<home>\\.protoboard-dev"],
    ["home-path", "other user C:\\Users\\bob\\x and /Users/carol/y and /home/dave/z", "bob", "<home>"],
    ["user-name", "signed in as alice today", "alice", "<user>"],
    ["private-key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----", "MIIEow", "<private-key>"],
    ["jwt", "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpM", "SflKxwRJSMeKKF2QT4fwpM", "<jwt>"],
    ["auth-header", "Authorization: Bearer abc.def-123456789", "abc.def-123456789", "<secret>"],
    ["auth-header", "x-protoboard-render-token: q1w2e3r4t5y6u7i8o9p0", "q1w2e3r4t5y6u7i8o9p0", "<secret>"],
    ["bearer", "sent with bearer zzzzzzzzzzzz1234", "zzzzzzzzzzzz1234", "bearer <secret>"],
    ["aws-key", "AKIAIOSFODNN7EXAMPLE in env", "AKIAIOSFODNN7EXAMPLE", "<aws-key>"],
    ["github-token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789 and github_pat_11ABCDEFG0123456789_abcdefghij", "ghp_abcdef", "<github-token>"],
    ["github-token", "gho_ABCDEFGHIJKLMNOPQRSTUVWX", "gho_ABCDEF", "<github-token>"],
    ["npm-token", "//registry.npmjs.org/:_authToken npm_abcdefghijklmnopqrstuvwxyz0123", "npm_abcdef", "<npm-token>"],
    ["slack-token", "xoxb-123456789012-abcdefghijkl", "xoxb-1234", "<slack-token>"],
    ["stripe-key", "sk_live_51Habcdefgh and sk_test_51Habcdefgh and rk_live_51Habcdefgh", "51Habcdefgh", "<stripe-key>"],
    ["sk-key", "OPENAI sk-proj-abcdefghijklmnopqrstuvwx", "abcdefghijklmnopqrstuvwx", "<secret>"],
    ["secret-assignment", "url?token=abc123def&x=1 password=hunter2 apiKey: s3cr3t", "hunter2", "password=<secret>"],
    ["secret-assignment", '{"client_secret":"zz9","sessionToken":"tt7"}', "zz9", '"client_secret":"<secret>"'],
    ["long-secret", "the signing secret is 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "9f86d081884c7d659a2feaa0c55ad015", "<secret>"],
    ["email", "contact kevin.fehr@example.com please", "kevin.fehr@example.com", "<email>"],
    ["ipv4", "from 192.168.1.20 and 10.0.0.5", "192.168.1.20", "<ip>"],
    // wave 4 gate: URL-encoded and WSL home paths, doubly escaped paths, credentials inside a URL
    ["home-path", "opened file:///C%3A%5CUsers%5Cbob%5Cproj%5Cx.step", "bob", "<home>"],
    ["home-path", "wsl sees /mnt/c/Users/bob/proj", "bob", "<home>"],
    ["project-path", `twice escaped "C:\\\\\\\\Users\\\\\\\\alice\\\\\\\\work\\\\\\\\drone\\\\\\\\out"`, "alice", "<project>"],
    ["url-credentials", "fetch https://bob:pa55word@example.com/x failed", "pa55word", "https://<credentials>@example.com"],
  ];
  for (const [rule, input, gone, becomes] of CASES) {
    it(`${rule}: ${input.slice(0, 40).replace(/\n/g, " ")}`, () => {
      const red = r();
      const out = red.text(input);
      expect(out).not.toContain(gone);
      expect(out).toContain(becomes);
      expect(red.counts[rule]).toBeGreaterThanOrEqual(1);
      // counts only, never the values
      for (const v of Object.values(red.counts)) expect(typeof v).toBe("number");
    });
  }

  it("keeps what is not personal: loopback, versions, package scopes, ordinary words, short hashes", () => {
    const red = r();
    const text = "http://127.0.0.1:6300/ three@0.187.0 @protoboardai/core Chrome 156.0.8078.79 monkey=banana keys=3 bundle de195482ca62 session=abc";
    expect(red.text(text)).toBe(text);
    expect(red.counts).toEqual({});
  });

  it("a long hex run away from any secret word stays (a content hash)", () => {
    const red = r();
    const t = "content 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(red.text(t)).toBe(t);
  });

  it("secret-named fields are replaced whole when values are walked", () => {
    const red = r();
    const v = red.value({ camera: { fov: 32 }, bridge: { key: "kkkkkkkkkkkkkkkkk" }, apiKey: "zzz", nested: [{ password: "p" }], owner: "alice" }) as Record<string, unknown>;
    expect(JSON.stringify(v)).not.toMatch(/kkkk|zzz|"p"|alice/);
    expect(red.counts["secret-field"]).toBe(3);
    expect(v.camera).toEqual({ fov: 32 });
  });

  it("secret names by word, not by substring", () => {
    for (const s of ["token", "apiKey", "api_key", "client-secret", "sessionToken", "x.password", "AUTH", "bridgeKey"]) expect(isSecretName(s), s).toBe(true);
    for (const s of ["monkey", "keys", "session", "tokenizer", "author", "snapshot"]) expect(isSecretName(s), s).toBe(false);
  });
});

describe("drafts", () => {
  it("writes the draft under .protoboard/local/reports/ with the exact bytes it returns, and sends nothing", async () => {
    const root = project();
    const fetchSpy = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    const tools = reportTools({ ...opts(), fetch: fetchSpy });
    const res = await call(tools, "report_issue", { ...INPUT, steps: ["open the drone", "orbit"], expected: "a model", actual: "blank" }, ctxFor(root));
    const d = res.data as Record<string, unknown>;
    expect(d.status).toBe("draft");
    expect(d.requiresUserConfirmation).toBe(true);
    expect(d.next).toBe(CONFIRM_NOTE);
    expect(String(d.id)).toMatch(ID_RE);
    expect(d.relativeFile).toBe(`.protoboard/local/reports/${d.id}.json`);
    const file = join(root, REPORTS_DIR, `${d.id}.json`);
    expect(readFileSync(file, "utf8")).toBe(d.bundle);
    expect(Buffer.byteLength(String(d.bundle))).toBe(d.bytes);
    const bundle = JSON.parse(String(d.bundle));
    expect(bundle.schema).toBe(REPORT_SCHEMA);
    expect(bundle.kind).toBe("issue");
    expect(bundle.steps).toEqual(["open the drone", "orbit"]);
    expect(bundle.project).toEqual({ name: "drone-test", stack: "^0.2.0", stackFrom: "declared" });
    expect(bundle.environment).toMatchObject({ cli: "0.2.2", server: "0.0.0-test", node: "24.11.0", os: "win32", arch: "x64" });
    expect(JSON.stringify(bundle.environment)).not.toMatch(/host/i);
    expect(bundle.logs.files).toEqual([]);
    expect(bundle.logs.note).toMatch(/CLI writes no log/);
    expect(bundle.viewState).toBe("not requested");
    expect(bundle.snapshot).toBe("not requested");
    // the meta keeps a hash of the token, never the token
    const meta = readFileSync(join(root, REPORTS_DIR, `${d.id}.draft.json`), "utf8");
    expect(meta).not.toContain(String(d.confirmToken));
    expect(JSON.parse(meta)).toMatchObject({ state: "draft", sha256: d.sha256 });
    // file names safe on Windows
    for (const f of readdirSync(join(root, REPORTS_DIR))) expect(f).not.toMatch(/[<>:"/\\|?*]|[. ]$/);
  });

  it("request_feature builds a feature bundle without logs or telemetry unless asked", async () => {
    const root = project();
    writeFileSync(join(root, ".protoboard", "local", "render-service.log"), "line\n");
    const res = await call(reportTools(opts()), "request_feature", { title: "Export STEP per module", description: "One STEP per module.", useCase: "sending a bracket to a shop" }, ctxFor(root));
    const b = JSON.parse(String((res.data as { bundle: string }).bundle));
    expect(b.kind).toBe("feature");
    expect(b.useCase).toBe("sending a bracket to a shop");
    expect(b.logs).toBe("not requested");
    expect(b.telemetry).toBe("not requested");
    expect(b.steps).toBeUndefined();
  });

  it("redacts the user's text, logs and view state, and records counts in the bundle", () => {
    const root = project();
    const local = join(root, ".protoboard", "local");
    writeFileSync(join(local, "render-service.log"), [`render service for ${root} at http://127.0.0.1:51067/`, "user alice from 192.168.0.4 token=abcdef123456", "ok"].join("\n") + "\n");
    writeFileSync(join(local, "viewer-state.json"), JSON.stringify({ schema: "protoboard.viewer-state/v0", viewState: "uhd-viewer.view-state/v1", scope: "", scopes: { "": { camera: { fov: 32 }, selection: { body: "stack/fc" }, note: "mail alice@example.org" } } }));
    mkdirSync(join(local, "snapshots"));
    writeFileSync(join(local, "snapshots", "root__3d.png"), Buffer.alloc(100));
    const built = buildReport(root, "issue", { title: "crash for alice", description: `see ${root}\\src and C:\\Users\\alice\\x`, include: { viewState: true, snapshot: true } }, opts());
    const text = built.text;
    expect(text).not.toContain(root);
    expect(text).not.toMatch(/alice|192\.168|abcdef123456/);
    const b = JSON.parse(text);
    expect(b.logs.files[0].text).toContain("<project>");
    expect(b.logs.files[0].text).toContain("127.0.0.1:51067");
    expect(b.viewState.scopes[""].camera).toEqual({ fov: 32 });
    expect(b.snapshot).toMatchObject({ path: "<project>/.protoboard/local/snapshots/root__3d.png", bytes: 100 });
    expect(b.redactions["project-path"]).toBeGreaterThanOrEqual(2);
    expect(b.redactions["user-name"]).toBeGreaterThanOrEqual(1);
    expect(b.redactions.email).toBe(1);
    expect(b.redactions.ipv4).toBe(1);
    expect(b.redactions["secret-assignment"]).toBe(1);
  });

  it("never reads .env, keys, dev.json or the render service record", () => {
    const root = project();
    const local = join(root, ".protoboard", "local");
    writeFileSync(join(root, ".env"), "PROTOBOARD_CLOUD_TOKEN=leak-env-value\n");
    writeFileSync(join(root, "server.pem"), "leak-pem-value");
    writeFileSync(join(local, "dev.json"), JSON.stringify({ bridge: { key: "leak-bridge-key" }, session: "leak-session" }));
    writeFileSync(join(local, "render-service.json"), JSON.stringify({ token: "leak-render-token" }));
    const text = buildReport(root, "issue", { ...INPUT, include: { viewState: true, snapshot: true } }, opts()).text;
    expect(text).not.toMatch(/leak-/);
    for (const f of [".env", ".env.local", "a/b/server.pem", "id_ed25519", ".protoboard/local/dev.json", ".protoboard/local/render-service.json", "credentials.dpapi.json", ".npmrc"]) expect(isForbiddenFile(f), f).toBe(true);
    for (const f of ["render-service.log", "viewer-state.json", "package.json"]) expect(isForbiddenFile(f), f).toBe(false);
  });

  it("keeps each log to its last 200 lines and 64 kB", () => {
    const root = project();
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    writeFileSync(join(root, ".protoboard", "local", "render-service.log"), lines.join("\n") + "\n");
    const f = JSON.parse(buildReport(root, "issue", INPUT, opts()).text).logs.files[0];
    expect(f.lines).toBe(200);
    expect(f.truncated).toBe(true);
    expect(f.text.split("\n")[0]).toBe("line 300");
    const big = project();
    writeFileSync(join(big, ".protoboard", "local", "render-service.log"), Array.from({ length: 150 }, () => "x".repeat(1000)).join("\n"));
    const g = JSON.parse(buildReport(big, "issue", INPUT, opts()).text).logs.files[0];
    expect(g.bytes).toBeLessThanOrEqual(64 * 1024);
    expect(g.lines).toBeLessThan(150);
  });
});

describe("telemetry", () => {
  const crash = (i: number) => ({ schema: "pb.crash/v0", time: new Date(Date.now() - i * 60_000).toISOString(), kind: "cli", component: "build", versions: { cli: "0.2.2" }, error: { kind: "uncaughtException", name: "TypeError", message: `boom ${i}` } });

  it("is included when the setting allows it", () => {
    const root = project();
    appendTelemetry(root, crash(1), { mode: "all" });
    const b = JSON.parse(buildReport(root, "issue", INPUT, opts()).text);
    expect(b.telemetry.mode).toBe("all");
    expect(b.telemetry.records).toHaveLength(1);
    expect(b.telemetry.counts.crashes).toBe(1);
  });

  it("telemetry off (PROTOBOARD_TELEMETRY=off) leaves it out and says so", () => {
    const root = project();
    appendTelemetry(root, crash(1), { mode: "all" });
    const b = JSON.parse(buildReport(root, "issue", INPUT, opts({ env: { ...ENV_ON, PROTOBOARD_TELEMETRY: "off" } })).text);
    expect(String(b.telemetry)).toMatch(/^telemetry off: not included/);
    expect(JSON.stringify(b)).not.toContain("boom");
  });

  it("the CLI's own switch off also leaves it out", () => {
    const root = project();
    appendTelemetry(root, crash(1), { mode: "all" });
    const cfg = join(TMP, `cfg${++n}`);
    mkdirSync(cfg);
    writeFileSync(join(cfg, "telemetry.json"), JSON.stringify({ local: false }));
    const b = JSON.parse(buildReport(root, "issue", INPUT, opts({ env: { PROTOBOARD_CONFIG_DIR: cfg } })).text);
    expect(String(b.telemetry)).toMatch(/^telemetry off: not included/);
  });
});

describe("the bundle cap", () => {
  it("drops the oldest telemetry records first to fit, and says so", () => {
    const root = project();
    for (let i = 0; i < 40; i++) appendTelemetry(root, { schema: "pb.crash/v0", time: new Date(Date.now() - (40 - i) * 60_000).toISOString(), kind: "cli", versions: {}, error: { kind: "uncaughtException", message: `m${i} ${"y".repeat(100)}` } }, { mode: "all" });
    const full = buildReport(root, "issue", INPUT, opts()).text.length;
    const built = buildReport(root, "issue", INPUT, opts({ limits: { bundleBytes: full - 2000 } }));
    const b = JSON.parse(built.text);
    expect(Buffer.byteLength(built.text)).toBeLessThanOrEqual(full - 2000);
    expect(b.telemetry.dropped).toBeGreaterThan(0);
    expect(b.trimmed[0]).toMatch(/oldest record/);
    // the newest records stay
    expect(JSON.stringify(b.telemetry.records)).toContain("m39");
  });

  it("refuses a report that cannot fit even without telemetry, logs and view state", async () => {
    const root = project();
    expect(() => buildReport(root, "issue", INPUT, opts({ limits: { bundleBytes: 300 } }))).toThrow(/over the 300-byte cap/);
  });

  it("the default cap is 512 kB", () => {
    const root = project();
    const tools = reportTools(opts());
    expect(tools).toHaveLength(4);
    expect(() => buildReport(root, "issue", { ...INPUT, description: "z".repeat(8000) }, opts())).not.toThrow();
  });
});

describe("sending", () => {
  it("nothing is sent without the right token; the stub says not-sent while PROTOBOARD_REPORTS_URL is unset", async () => {
    const root = project();
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;
    const d = createDraft(root, "issue", INPUT, opts());
    const wrong = await sendDraft(root, d.id, "not-the-token", { ...opts(), fetch: f });
    expect(wrong.status).toBe("refused");
    expect(wrong.reason).toMatch(/confirm token/);
    const stub = await sendDraft(root, d.id, d.confirmToken, { ...opts(), fetch: f });
    expect(stub.status).toBe("not-sent");
    expect(stub.reason).toBe("the reporting service is not deployed yet (stub)");
    expect(stub.request).toMatchObject({ method: "POST", bodyBytes: d.bytes, bodySha256: d.sha256 });
    expect((stub.request as { headers: Record<string, string> }).headers["idempotency-key"]).toBe(d.id);
    expect(calls).toBe(0);
    // the draft is kept
    expect(listDrafts(root)).toMatchObject([{ id: d.id, state: "draft", lastAttempt: { status: "not-sent" } }]);
  });

  it("a draft changed after it was shown is refused, even with its recorded hash edited too", async () => {
    const root = project();
    const d = createDraft(root, "issue", INPUT, opts());
    const f = (async () => new Response("{}", { status: 201 })) as unknown as typeof fetch;
    writeFileSync(d.file, d.text.replace("blank", "fine"));
    const r1 = await sendDraft(root, d.id, d.confirmToken, { ...opts({ env: { ...ENV_ON, PROTOBOARD_REPORTS_URL: "https://reports.example" } }), fetch: f });
    expect(r1.status).toBe("refused");
    expect(r1.reason).toMatch(/changed after it was shown/);
    // edit the recorded sha256 to match: the token still binds the bytes shown
    const meta = JSON.parse(readFileSync(d.draftFile, "utf8"));
    meta.sha256 = (await import("node:crypto")).createHash("sha256").update(readFileSync(d.file)).digest("hex");
    writeFileSync(d.draftFile, JSON.stringify(meta));
    const r2 = await sendDraft(root, d.id, d.confirmToken, { ...opts({ env: { ...ENV_ON, PROTOBOARD_REPORTS_URL: "https://reports.example" } }), fetch: f });
    expect(r2.status).toBe("refused");
  });

  it("refuses plain http except to loopback, and URLs with credentials", () => {
    expect(reportsEndpoint("https://api.protoboard.ai")).toEqual({ url: "https://api.protoboard.ai/v1/reports" });
    expect(reportsEndpoint("https://api.protoboard.ai/base/")).toEqual({ url: "https://api.protoboard.ai/base/v1/reports" });
    expect(reportsEndpoint("http://127.0.0.1:6301")).toEqual({ url: "http://127.0.0.1:6301/v1/reports" });
    expect(reportsEndpoint("http://localhost:6301")).toHaveProperty("url");
    expect(reportsEndpoint("http://reports.example.com")).toHaveProperty("error");
    expect(reportsEndpoint("http://10.0.0.2")).toHaveProperty("error");
    expect(reportsEndpoint("https://u:p@example.com")).toHaveProperty("error");
    expect(reportsEndpoint("ftp://example.com")).toHaveProperty("error");
  });

  it("refuses ids that are not draft ids (no path tricks)", async () => {
    const root = project();
    await expect(sendDraft(root, "../../etc/passwd", "x".repeat(10), opts())).rejects.toThrow(/not a report id/);
  });

  it("sends the draft's exact bytes to a loopback service once, with the id as the idempotency key", async () => {
    const root = project();
    const d = createDraft(root, "issue", INPUT, opts());
    const got: { headers: Record<string, string | string[] | undefined>; body: string; url?: string }[] = [];
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        got.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8"), url: req.url });
        res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ id: "rep_1", identifier: "PB-9999", url: "https://linear.app/x/PB-9999" }));
      });
    });
    let port = 0;
    for (const p of [6331, 6332, 6333, 6334, 6335, 6336]) {
      const ok = await new Promise<boolean>((done) => {
        server.once("error", () => done(false));
        server.listen(p, "127.0.0.1", () => done(true));
      });
      if (ok) {
        port = p;
        break;
      }
    }
    expect(port).toBeGreaterThan(0);
    try {
      const o = { ...opts({ env: { ...ENV_ON, PROTOBOARD_REPORTS_URL: `http://127.0.0.1:${port}` } }), version: "9.9.9" };
      const r = await sendDraft(root, d.id, d.confirmToken, o);
      expect(r.status).toBe("sent");
      expect(r.receipt).toEqual({ id: "rep_1", identifier: "PB-9999", url: "https://linear.app/x/PB-9999" });
      expect(got).toHaveLength(1);
      expect(got[0].url).toBe("/v1/reports");
      expect(got[0].body).toBe(d.text);
      expect(got[0].headers["idempotency-key"]).toBe(d.id);
      expect(got[0].headers["x-protoboard-report-sha256"]).toBe(d.sha256);
      expect(got[0].headers.authorization).toBeUndefined();
      const again = await sendDraft(root, d.id, d.confirmToken, o);
      expect(again.status).toBe("already-sent");
      expect(got).toHaveLength(1);
      expect(listDrafts(root)[0]).toMatchObject({ state: "sent", receipt: { identifier: "PB-9999" } });
    } finally {
      await new Promise((done) => server.close(done));
    }
  });

  it("maps 400, 413 and 429 to rejected, too-large and rate-limited and keeps the draft", async () => {
    const root = project();
    const env = { ...ENV_ON, PROTOBOARD_REPORTS_URL: "https://reports.example" };
    for (const [code, status] of [[400, "rejected"], [413, "too-large"], [429, "rate-limited"]] as const) {
      const d = createDraft(root, "issue", INPUT, opts());
      const f = (async () => new Response(JSON.stringify({ error: `nope ${code}` }), { status: code, headers: { "retry-after": "60" } })) as unknown as typeof fetch;
      const r = await sendDraft(root, d.id, d.confirmToken, { ...opts({ env }), fetch: f });
      expect(r.status).toBe(status);
      expect(r.httpStatus).toBe(code);
      expect(r.reason).toBe(`nope ${code}`);
      if (code === 429) expect(r.retryAfter).toBe("60");
    }
    expect(listDrafts(root).every((x) => x.state === "draft")).toBe(true);
  });

  it("a network failure says not-confirmed and that resending is safe", async () => {
    const root = project();
    const d = createDraft(root, "issue", INPUT, opts());
    const f = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await sendDraft(root, d.id, d.confirmToken, { ...opts({ env: { ...ENV_ON, PROTOBOARD_REPORTS_URL: "https://reports.example" } }), fetch: f });
    expect(r.status).toBe("not-confirmed");
    expect(r.reason).toMatch(/idempotency key/);
  });

  it("limits sends per project per hour on this machine", async () => {
    const root = project();
    const env = { ...ENV_ON, PROTOBOARD_REPORTS_URL: "https://reports.example" };
    const f = (async () => new Response(JSON.stringify({ id: "x" }), { status: 201 })) as unknown as typeof fetch;
    const o = { ...opts({ env, limits: { sendsPerHour: 2 } }), fetch: f };
    for (let i = 0; i < 2; i++) {
      const d = createDraft(root, "issue", INPUT, o);
      expect((await sendDraft(root, d.id, d.confirmToken, o)).status).toBe("sent");
    }
    const d = createDraft(root, "issue", INPUT, o);
    expect((await sendDraft(root, d.id, d.confirmToken, o)).status).toBe("rate-limited");
  });
});

describe("the tools", () => {
  it("names, annotations and descriptions", () => {
    const tools = reportTools();
    expect(tools.map((t) => t.name)).toEqual(["report_issue", "request_feature", "report_send", "report_list"]);
    for (const t of tools) expect(t.description.length, t.name).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    const send = tools.find((t) => t.name === "report_send")!;
    expect(send.annotations).toMatchObject({ openWorldHint: true, destructiveHint: false });
    expect(send.description).toMatch(/said yes in chat/);
    for (const name of ["report_issue", "request_feature"]) {
      const t = tools.find((x) => x.name === name)!;
      expect(t.annotations.openWorldHint).toBe(false);
      expect(t.description).toMatch(/sends nothing/);
    }
    expect(tools.find((t) => t.name === "report_list")!.annotations.readOnlyHint).toBe(true);
  });

  it("report_send through the tool returns not-sent and the draft stays; report_list shows it", async () => {
    const root = project();
    const tools = reportTools(opts());
    const ctx = ctxFor(root);
    const d = (await call(tools, "report_issue", INPUT, ctx)).data as { id: string; confirmation: string };
    const s = await call(tools, "report_send", { id: d.id, confirmation: d.confirmation }, ctx);
    expect((s.data as { status: string }).status).toBe("not-sent");
    expect(s.isError).toBeUndefined();
    const l = (await call(tools, "report_list", {}, ctx)).data as { reports: { id: string; state: string }[] };
    expect(l.reports).toMatchObject([{ id: d.id, state: "draft" }]);
  });

  it("outside a project it refuses", async () => {
    const dir = join(TMP, `np${++n}`);
    mkdirSync(dir);
    await expect(call(reportTools(opts()), "report_issue", INPUT, ctxFor(dir))).rejects.toThrow(/not a Protoboard project/);
  });

  it("a redirected reports folder (measurement) leaves the project untouched", () => {
    const root = project();
    const out = join(TMP, `out${++n}`);
    const d = createDraft(root, "issue", INPUT, opts({ reportsDir: () => out }));
    expect(d.file.startsWith(out)).toBe(true);
    expect(() => readdirSync(join(root, REPORTS_DIR))).toThrow();
    appendFileSync(d.file, ""); // still writable, same bytes
    expect(readFileSync(d.file, "utf8")).toBe(d.text);
  });
});
