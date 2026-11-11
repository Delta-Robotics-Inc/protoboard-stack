/**
 * Local telemetry (PB-1181): the record writer (day files, pruning by age and
 * size, the per-record cap), redaction (paths, URLs, quoted names, tokens,
 * unknown fields), the toggle's precedence, and the export bundle with its
 * consent line.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CONSENTS_FILE,
  MAX_LINE_BYTES,
  SALT_FILE,
  TELEMETRY_DIR,
  appendTelemetry,
  buildTelemetryBundle,
  bundleSha256,
  clearTelemetry,
  enrichViewerRecord,
  hashPath,
  hashStack,
  latestSessions,
  projectHash,
  pruneTelemetry,
  readConsents,
  readTelemetry,
  recordAllowed,
  recordConsent,
  redactText,
  sanitizeRecord,
  sendRequest,
  telemetryMode,
  telemetrySummary,
  type RenderSessionRecord,
} from "../src/telemetry.js";

const TMP = mkdtempSync(join(tmpdir(), "pb-telemetry-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const project = () => {
  const dir = join(TMP, `p${n++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

const session = (over: Partial<RenderSessionRecord> = {}): RenderSessionRecord => ({
  schema: "pb.render-session/v0",
  session: "11111111-2222-3333-4444-555555555555",
  start: "2026-11-01T10:00:00.000Z",
  end: "2026-11-01T10:05:00.000Z",
  durationMs: 300000,
  host: "vscode-webview",
  versions: { viewer: "0.2.1" },
  gpu: { backend: "webgl2", vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)", software: false },
  viewport: { w: 1440, h: 900, dpr: 1.5 },
  load: { glbs: 3, glbBytes: 18233411, fetchMs: 140, parseMs: 610, compileMs: 380, firstFrameMs: 1450 },
  scene: { calls: 388, triangles: 2310442, programs: 17, geometries: 260, textures: 12 },
  frameMs: { buckets: [8, 16.7, 33, 50, 100], counts: [10, 5210, 340, 22, 9, 3], p50: 11.2, p95: 24.9, frames: 5594 },
  longFrames: { count: 14, maxMs: 310 },
  memory: { method: "performance.memory", peakBytes: 512000000 },
  contextLost: { lost: 0, restored: 0 },
  errors: { count: 0, first: [] },
  exit: "closed",
  ...over,
});

describe("the record writer", () => {
  it("appends one sanitised line to today's file (UTC) and reads it back", () => {
    const root = project();
    const r = appendTelemetry(root, session(), { now: day("2026-11-01") });
    expect(r).toMatchObject({ written: true, pruned: [] });
    expect(r.file).toBe(join(root, TELEMETRY_DIR, "2026-11-01.jsonl"));
    expect(readFileSync(r.file!, "utf8").trim().split("\n")).toHaveLength(1);
    expect(readTelemetry(root)).toEqual([session()]);
    // the salt for path hashes sits beside the records and is made once
    const salt = readFileSync(join(root, TELEMETRY_DIR, SALT_FILE), "utf8").trim();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    appendTelemetry(root, session({ session: "another-session-id" }), { now: day("2026-11-01") });
    expect(readFileSync(join(root, TELEMETRY_DIR, SALT_FILE), "utf8").trim()).toBe(salt);
  });

  it("rotates by day: a record on a new day goes to a new file", () => {
    const root = project();
    appendTelemetry(root, session(), { now: day("2026-10-30") });
    appendTelemetry(root, session(), { now: day("2026-10-31") });
    appendTelemetry(root, session(), { now: day("2026-10-31") });
    const files = readdirSync(join(root, TELEMETRY_DIR)).filter((f) => f.endsWith(".jsonl")).sort();
    expect(files).toEqual(["2026-10-30.jsonl", "2026-10-31.jsonl"]);
    expect(readFileSync(join(root, TELEMETRY_DIR, "2026-10-31.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("prunes day files older than 30 days on write, and leaves other files alone", () => {
    const root = project();
    appendTelemetry(root, session(), { now: day("2026-09-15") });
    appendTelemetry(root, session(), { now: day("2026-10-02") });
    recordConsent(root, { at: "2026-09-15T00:00:00.000Z", bundleSha256: "ab", recordCount: 1, destination: "x", sent: false });
    const r = appendTelemetry(root, session(), { now: day("2026-11-01") });
    // 2026-10-02 is 30 days back: kept; 2026-09-15 is not
    expect(r.pruned).toEqual(["2026-09-15.jsonl"]);
    const left = readdirSync(join(root, TELEMETRY_DIR)).sort();
    expect(left).toEqual([CONSENTS_FILE, "2026-10-02.jsonl", "2026-11-01.jsonl", SALT_FILE].sort());
  });

  it("caps the folder by size: the oldest days go first, and a record that cannot fit is refused", () => {
    const root = project();
    const line = Buffer.byteLength(JSON.stringify(sanitizeRecord(session())) + "\n");
    for (const d of ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]) appendTelemetry(root, session(), { now: day(d), maxBytes: 100 * line });
    // room for three lines: writing a fourth day's line drops the two oldest days (it needs room for itself)
    const r = appendTelemetry(root, session(), { now: day("2026-11-01"), maxBytes: line * 3 + 10 });
    expect(r.written).toBe(true);
    expect(r.pruned).toEqual(["2026-10-28.jsonl", "2026-10-29.jsonl"]);
    // today's file is never pruned: once it alone fills the cap, further records are refused
    const full = appendTelemetry(root, session(), { now: day("2026-11-01"), maxBytes: line });
    expect(full).toMatchObject({ written: false, reason: "cap", pruned: ["2026-10-30.jsonl", "2026-10-31.jsonl"] });
    expect(readdirSync(join(root, TELEMETRY_DIR)).filter((f) => f.endsWith(".jsonl"))).toEqual(["2026-11-01.jsonl"]);
    expect(pruneTelemetry(root, { now: day("2026-11-01"), maxBytes: line })).toEqual([]);
  });

  it("refuses what is not a record and anything while off; long strings are cut, so a record stays under the 64 kB line cap", () => {
    const root = project();
    expect(appendTelemetry(root, { schema: "something/else" }, { now: day("2026-11-01") }).reason).toBe("refused");
    expect(appendTelemetry(root, "a string", { now: day("2026-11-01") }).reason).toBe("refused");
    expect(appendTelemetry(root, session(), { mode: "off" })).toMatchObject({ written: false, reason: "off" });
    // GPU strings are capped, so a large record needs many fields: none of ours gets there, but the check holds
    const huge = { ...session(), errors: { count: 1, first: [{ kind: "error", message: "word ".repeat(MAX_LINE_BYTES / 5) }] } };
    expect(appendTelemetry(root, huge, { now: day("2026-11-01") }).written).toBe(true);
    expect(readTelemetry(root)[0]).toMatchObject({ errors: { first: [{ message: expect.stringMatching(/^(word ){31}word…$/) }] } });
    expect(existsSync(join(root, TELEMETRY_DIR, "2026-11-01.jsonl"))).toBe(true);
  });

  it("never throws: an unwritable folder is a result, not an error", () => {
    const root = project();
    // a file where the folder should be
    mkdirSync(join(root, ".protoboard", "local"), { recursive: true });
    writeFileSync(join(root, TELEMETRY_DIR), "not a folder");
    expect(() => appendTelemetry(root, session())).not.toThrow();
    expect(appendTelemetry(root, session()).written).toBe(false);
  });

  it("keeps the last line of each session: the final one over earlier partials, a partial when nothing followed", () => {
    const root = project();
    const now = day("2026-11-01");
    appendTelemetry(root, session({ session: "sess-aaaaaa", partial: true, exit: "hidden" }), { now });
    appendTelemetry(root, session({ session: "sess-bbbbbb", partial: true, exit: "hidden" }), { now });
    appendTelemetry(root, session({ session: "sess-aaaaaa", exit: "closed", durationMs: 9 }), { now });
    appendTelemetry(root, session({ session: "sess-bbbbbb", partial: true, exit: "crash", durationMs: 7 }), { now });
    appendTelemetry(root, { schema: "pb.crash/v0", time: "2026-11-01T10:00:00.000Z", kind: "cli", versions: {}, error: { kind: "uncaughtException", message: "boom" } }, { now });
    const kept = latestSessions(readTelemetry(root));
    expect(kept.map((r) => (r.schema === "pb.render-session/v0" ? [r.session, r.exit, r.durationMs] : r.schema))).toEqual([
      ["sess-aaaaaa", "closed", 9],
      ["sess-bbbbbb", "crash", 7],
      "pb.crash/v0",
    ]);
    expect(telemetrySummary(root)).toMatchObject({ files: 1, sessions: 2, crashes: 1, oldest: "2026-11-01", newest: "2026-11-01" });
    expect(clearTelemetry(root)).toEqual(["2026-11-01.jsonl"]);
    expect(readTelemetry(root)).toEqual([]);
  });
});

describe("redaction", () => {
  it("replaces paths (hashed), URLs, e-mail addresses, quoted names and long tokens; caps the length", () => {
    const s = redactText(`cannot read C:\\Users\\Kev\\Desktop\\drone\\parts\\motor.glb from https://example.com/a?b=c for "Front Left Motor" (kev@example.com) /home/kev/proj/x.step token ghp_abcdefghijklmnopqrstuvwxyz0123456789`, 500, "salt");
    expect(s).not.toMatch(/Users|Kev|drone|motor\.glb|example\.com|Front Left|home\/kev|ghp_/);
    expect(s).toMatch(/^cannot read <path:[0-9a-f]{8}> from <url> for <str> \(<email>\) <path:[0-9a-f]{8}> token <secret>$/);
    expect(redactText("ab ".repeat(200)).length).toBe(160);
    // a path hashes the same however it is written, and differently with another salt
    expect(hashPath("C:\\Users\\Kev\\p", "s")).toBe(hashPath("c:/users/kev/p/", "s"));
    expect(hashPath("C:\\Users\\Kev\\p", "s")).not.toBe(hashPath("C:\\Users\\Kev\\p", "t"));
  });

  it("rebuilds a record from known fields only: unknown fields, source text and stacks do not survive", () => {
    const dirty = {
      ...session(),
      source: "export const SYS: ModuleDef = { ... }",
      path: "C:\\Users\\Kev\\project",
      gpu: { ...session().gpu, extra: "x" },
      errors: { count: 2, first: [{ kind: "error", name: "TypeError", message: "x is undefined in 'arm_fl/motor'", stack: "TypeError: x\n    at f (C:\\Users\\Kev\\a.js:1:2)", secret: "y" }] },
      project: "C:\\Users\\Kev\\project",
    };
    const clean = sanitizeRecord(dirty, "salt") as RenderSessionRecord;
    const text = JSON.stringify(clean);
    expect(text).not.toMatch(/ModuleDef|Users|Kev|arm_fl|secret|extra/);
    expect(clean).not.toHaveProperty("source");
    expect(clean).not.toHaveProperty("project");
    expect(clean.errors!.first[0]).toEqual({ kind: "error", name: "TypeError", message: "x is undefined in <str>", stackHash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    // a hash stays a hash; an unknown host or exit becomes "unknown"
    expect(sanitizeRecord({ ...session(), host: "evil", exit: "rm -rf" })).toMatchObject({ host: "unknown", exit: "unknown" });
    expect(sanitizeRecord({ ...session(), session: "../../etc" })).toBeUndefined();
  });

  it("hashes stacks without the folders, so the same crash on two machines groups together", () => {
    const a = "TypeError: x\n    at load (C:\\Users\\Kev\\stack\\node_modules\\three\\build\\three.module.js:10:5)\n    at main (C:\\Users\\Kev\\stack\\cli.js:3:1)";
    const b = "TypeError: x\n    at load (/home/someone/stack/node_modules/three/build/three.module.js:10:5)\n    at main (/home/someone/stack/cli.js:3:1)";
    expect(hashStack(a)).toBe(hashStack(b));
    expect(hashStack(a)).not.toBe(hashStack(a.replace("10:5", "11:5")));
  });
});

describe("the toggle", () => {
  const vs = (telemetryLevel: string | undefined, isTelemetryEnabled = telemetryLevel === "all") => ({ telemetryLevel, isTelemetryEnabled });
  const cases: [string, Parameters<typeof telemetryMode>[0], string][] = [
    ["nothing set: on", {}, "all"],
    ["PROTOBOARD_TELEMETRY=off", { env: { PROTOBOARD_TELEMETRY: "off" } }, "off"],
    ["PROTOBOARD_TELEMETRY=0", { env: { PROTOBOARD_TELEMETRY: "0" } }, "off"],
    ["PROTOBOARD_TELEMETRY=crash", { env: { PROTOBOARD_TELEMETRY: "crash" } }, "crash"],
    ["DO_NOT_TRACK=1", { env: { DO_NOT_TRACK: "1" } }, "off"],
    ["DO_NOT_TRACK=0 is not a request", { env: { DO_NOT_TRACK: "0" } }, "all"],
    ["the CLI's config off", { config: false }, "off"],
    ["the CLI's config on", { config: true }, "all"],
    ["VS Code all, setting on", { setting: true, vscode: vs("all") }, "all"],
    ["VS Code off (DEFAULT: stops local recording)", { setting: true, vscode: vs("off") }, "off"],
    ["VS Code crash: crash records only", { setting: true, vscode: vs("crash") }, "crash"],
    ["VS Code error: crash records only", { setting: true, vscode: vs("error") }, "crash"],
    ["VS Code all, setting off", { setting: false, vscode: vs("all") }, "off"],
    ["VS Code crash, setting off", { setting: false, vscode: vs("crash") }, "off"],
    ["isTelemetryEnabled false, no level known", { setting: true, vscode: { isTelemetryEnabled: false } }, "off"],
    ["VS Code all, but the environment says off", { env: { PROTOBOARD_TELEMETRY: "off" }, setting: true, vscode: vs("all") }, "off"],
    ["PROTOBOARD_TELEMETRY=on does not override VS Code off", { env: { PROTOBOARD_TELEMETRY: "on" }, setting: true, vscode: vs("off") }, "off"],
  ];
  for (const [name, input, mode] of cases) it(name, () => expect(telemetryMode(input).mode).toBe(mode));

  it("in crash mode keeps crash records and sessions that crashed, lost the context or had errors", () => {
    const crash = sanitizeRecord({ schema: "pb.crash/v0", time: "2026-11-01T10:00:00.000Z", kind: "cli", versions: {}, error: { kind: "uncaughtException" } })!;
    expect(recordAllowed(crash, "crash")).toBe(true);
    expect(recordAllowed(session(), "crash")).toBe(false);
    expect(recordAllowed(session({ errors: { count: 1, first: [] } }), "crash")).toBe(true);
    expect(recordAllowed(session({ exit: "contextLost" }), "crash")).toBe(true);
    const root = project();
    expect(appendTelemetry(root, session(), { mode: "crash" })).toMatchObject({ written: false, reason: "off" });
    expect(appendTelemetry(root, crash, { mode: "crash" }).written).toBe(true);
  });
});

describe("export and consent", () => {
  it("bundles the last line per session with the version inventory; nothing in it names a path", () => {
    const root = project();
    const now = day("2026-11-01");
    appendTelemetry(root, enrichViewerRecord(root, session({ partial: true, exit: "hidden" }), { host: "vscode-webview", versions: { stack: "0.2.2" } }), { now });
    appendTelemetry(root, enrichViewerRecord(root, session(), { host: "vscode-webview", versions: { stack: "0.2.2" } }), { now });
    const bundle = buildTelemetryBundle(root, { stack: "0.2.2", cli: "0.2.2", viewer: "0.2.1", node: "24.11.0", os: "win32", arch: "x64" }, { now });
    expect(bundle).toMatchObject({ schema: "pb.telemetry-bundle/v0", createdAt: now.toISOString(), counts: { sessions: 1, crashes: 0 }, range: { from: "2026-11-01T10:00:00.000Z", to: "2026-11-01T10:00:00.000Z" } });
    expect(bundle.project).toMatch(/^h:[0-9a-f]{16}$/);
    expect(bundle.project).toBe(projectHash(root));
    expect(bundle.records).toHaveLength(1);
    expect(bundle.records[0]).toMatchObject({ project: bundle.project, versions: { viewer: "0.2.1", stack: "0.2.2" }, exit: "closed" });
    const text = JSON.stringify(bundle);
    expect(text).not.toContain(root);
    expect(text).not.toContain(root.replace(/\\/g, "/"));
    expect(text).not.toContain(readFileSync(join(root, TELEMETRY_DIR, SALT_FILE), "utf8").trim());
    // the hash is over canonical JSON: key order does not change it
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(bundle).reverse())));
    expect(bundleSha256(reordered)).toBe(bundleSha256(bundle));
    expect(bundleSha256({ ...bundle, createdAt: "2026-11-02T00:00:00.000Z" })).not.toBe(bundleSha256(bundle));
  });

  it("describes the send request and records the consent; nothing is sent", () => {
    const root = project();
    appendTelemetry(root, session(), { now: day("2026-11-01") });
    const bundle = buildTelemetryBundle(root, { stack: "0.2.2" }, { now: day("2026-11-01") });
    const req = sendRequest(bundle, day("2026-11-01"));
    expect(req).toMatchObject({ method: "POST", url: "https://api.protoboard.ai/v1/reports", headers: { "content-type": "application/json", "x-protoboard-bundle-sha256": bundleSha256(bundle) }, body: { kind: "telemetry", bundleSha256: bundleSha256(bundle), consent: { recordCount: 1 }, bundle } });
    recordConsent(root, { at: "2026-11-01T12:00:00.000Z", bundleSha256: bundleSha256(bundle), recordCount: 1, destination: req.url, sent: false });
    expect(readConsents(root)).toEqual([{ schema: "pb.telemetry-consent/v0", at: "2026-11-01T12:00:00.000Z", bundleSha256: bundleSha256(bundle), recordCount: 1, destination: req.url, sent: false }]);
    // clearing the records keeps the consents
    clearTelemetry(root);
    expect(readConsents(root)).toHaveLength(1);
  });

  it("the writer, not the page, names the host and the project", () => {
    const root = project();
    const r = enrichViewerRecord(root, { ...session(), host: "dev-web", project: "h:0000000000000000" }, { host: "vscode-webview", versions: { stack: "0.2.2", extension: "0.2.2" } }) as RenderSessionRecord;
    expect(r.host).toBe("vscode-webview");
    expect(r.project).toBe(projectHash(root));
    expect(r.versions).toEqual({ viewer: "0.2.1", stack: "0.2.2", extension: "0.2.2" });
    // a crash record passes through as it came (the writer sanitises it)
    const crash = { schema: "pb.crash/v0" };
    expect(enrichViewerRecord(root, crash, { host: "dev-web" })).toBe(crash);
  });
});
