/**
 * The update and vulnerability check (PB-1168) with the network stubbed:
 * classification, the state file, the once-a-day jittered schedule, the
 * opt-out (nothing sent), silent offline behaviour, and the acceptance case
 * (a known-vulnerable pinned package is named by its advisory id).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DAY_MS, dismissFinding, isDue, MAX_JITTER_MS, maybeRunUpdateCheck, nextDueAfter, openFindings, readState, runUpdateCheck, statePath, updateCheckEnabled, writeCliSwitch } from "../src/update/check.js";
import { MAL_ID, makeProject, stubFetcher, VULN_ID } from "./update-fixtures.js";

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const project = (o?: Parameters<typeof makeProject>[0]) => {
  const r = makeProject(o);
  made.push(r);
  return r;
};
/** A config folder of the test's own (the CLI switch lives there). */
const env = () => {
  const dir = mkdtempSync(join(tmpdir(), "pb-cfg-"));
  made.push(dir);
  return { PROTOBOARD_CONFIG_DIR: dir } as NodeJS.ProcessEnv;
};
const inventoryOptions = { noExec: true, home: tmpdir() };

describe("the update check", () => {
  it("names a vulnerable installed package by its advisory id, a newer Protoboard, and writes the state", async () => {
    const root = project();
    const { fetcher, calls } = stubFetcher();
    const now = new Date("2026-11-01T12:00:00Z");
    const r = await runUpdateCheck({ root, fetcher, env: env(), now, inventoryOptions, jitter: () => 0 });
    expect(r.status).toBe("vulnerable");
    const v = r.findings.find((f) => f.kind === "vulnerable")!;
    expect(v).toMatchObject({ name: "lodash", version: "4.17.20", severity: "high", fixed: ["4.17.21"], key: "vulnerable:npm:lodash" });
    expect(v.ids).toEqual([VULN_ID, "CVE-2021-23337"]);
    expect(v.message).toContain(VULN_ID);
    const u = r.findings.filter((f) => f.kind === "update-available");
    expect(u.map((f) => f.name).sort()).toEqual(["@protoboardai/cli", "@protoboardai/core", "@protoboardai/ext-parts"]);
    expect(u[0]).toMatchObject({ version: "0.2.2", latest: "0.2.3", severity: "info" });
    expect(u[0].fix).toContain("--ignore-scripts");
    // third-party "newer version" is never an end-user finding; the registry is asked about our packages only
    expect(calls.urls.filter((x) => x.includes("registry.npmjs.org")).every((x) => /@(protoboardai|deltarobotics)%2f/.test(x))).toBe(true);
    expect(r.network.hosts).toEqual(["api.osv.dev", "registry.npmjs.org"]);
    // only names and versions leave the machine
    expect(calls.bodies.join("")).not.toContain("secret-project-name");
    expect(calls.bodies.join("")).not.toContain(root.replace(/\\/g, "\\\\"));
    expect(calls.bodies.join("")).not.toContain("my-private-thing");
    // the state file
    const s = readState(root);
    expect(existsSync(statePath(root))).toBe(true);
    expect(s).toMatchObject({ lastSuccess: now.toISOString(), failures: 0, nextDue: new Date(now.getTime() + DAY_MS).toISOString() });
    expect(s.result?.status).toBe("vulnerable");
    expect(statePath(root).replace(/\\/g, "/")).toMatch(/\.protoboard\/local\/update-check\.json$/);
  });

  it("reports a deny-listed package as a critical lookalike and a MAL- id as malicious", async () => {
    const root = project({ lookalike: true });
    const { fetcher } = stubFetcher({ malicious: true });
    const r = await runUpdateCheck({ root, fetcher, env: env(), inventoryOptions });
    expect(r.findings.find((f) => f.kind === "lookalike")).toMatchObject({ name: "vaps-transform", severity: "critical" });
    const mal = r.findings.find((f) => f.ids?.includes(MAL_ID))!;
    expect(mal).toMatchObject({ name: "pillow", ecosystem: "PyPI", severity: "malicious", role: "runtime:cad" });
    expect(r.findings[0].severity).toMatch(/malicious|critical/); // worst first
  });

  it("sends nothing when it is turned off, and still reports local lookalikes", async () => {
    const root = project({ lookalike: true });
    const { fetcher, calls } = stubFetcher();
    for (const e of [{ PROTOBOARD_NO_UPDATE_CHECK: "1" }, { NO_UPDATE_NOTIFIER: "1" }, { PROTOBOARD_UPDATE_CHECK: "off" }]) {
      const r = await runUpdateCheck({ root, fetcher, env: { ...env(), ...e }, inventoryOptions });
      expect(r.network.requests).toBe(0);
      expect(r.counts.queried).toBe(0);
      expect(r.reason).toBeTruthy();
      expect(r.findings.map((f) => f.kind)).toEqual(["lookalike"]);
    }
    const r = await runUpdateCheck({ root, fetcher, env: env(), setting: false, inventoryOptions });
    expect(r.reason).toBe("protoboard.updates.check is off");
    const e = env();
    writeCliSwitch(false, e);
    expect(updateCheckEnabled({ env: e })).toEqual({ enabled: false, reason: "turned off with protoboard update off" });
    expect((await runUpdateCheck({ root, fetcher, env: e, inventoryOptions })).network.requests).toBe(0);
    expect(calls.urls).toEqual([]);
  });

  it("degrades silently with no network and retries sooner", async () => {
    const root = project();
    const { fetcher } = stubFetcher({ failAll: true });
    const now = new Date("2026-11-01T12:00:00Z");
    const r = await runUpdateCheck({ root, fetcher, env: env(), now, inventoryOptions });
    expect(r.status).toBe("offline");
    expect(r.sources).toMatchObject({ npm: "failed", osv: "failed" });
    const s = readState(root);
    expect(s.failures).toBe(1);
    expect(s.lastSuccess).toBeUndefined();
    expect(s.nextDue).toBe(new Date(now.getTime() + 60 * 60 * 1000).toISOString());
  });

  it("runs automatically at most once a day, with up to 6 h of jitter, and never in tests or CI", async () => {
    const now = new Date("2026-11-01T00:00:00Z");
    for (let i = 0; i < 50; i++) {
      const due = Date.parse(nextDueAfter(true, 0, now)) - now.getTime();
      expect(due).toBeGreaterThanOrEqual(DAY_MS);
      expect(due).toBeLessThanOrEqual(DAY_MS + MAX_JITTER_MS);
    }
    expect(nextDueAfter(false, 2, now)).toBe(new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString());
    expect(nextDueAfter(false, 3, now)).toBe(new Date(now.getTime() + DAY_MS).toISOString());
    expect(isDue({ schema: "protoboard.update-check/v0", failures: 0, dismissed: {} })).toBe(true);
    expect(isDue({ schema: "protoboard.update-check/v0", failures: 0, dismissed: {}, nextDue: "2026-11-02T00:00:00Z" }, now)).toBe(false);
    // automatic runs are off under a test runner and in CI
    expect(updateCheckEnabled({ env: { VITEST: "true" }, auto: true }).enabled).toBe(false);
    expect(updateCheckEnabled({ env: { CI: "true" }, auto: true }).enabled).toBe(false);
    expect(updateCheckEnabled({ env: { CI: "true" } }).enabled).toBe(true); // an explicit command still runs
    const root = project();
    const { fetcher, calls } = stubFetcher();
    expect(await maybeRunUpdateCheck(root, { fetcher, env: { ...env(), VITEST: "true" } })).toBeUndefined();
    expect(calls.urls).toEqual([]);
    const e = env();
    const first = await maybeRunUpdateCheck(root, { fetcher, env: e, now, inventoryOptions });
    expect(first?.status).toBe("vulnerable");
    const n = calls.urls.length;
    expect(await maybeRunUpdateCheck(root, { fetcher, env: e, now: new Date(now.getTime() + 60_000), inventoryOptions })).toBeUndefined();
    expect(calls.urls.length).toBe(n);
  });

  it("keeps a dismissal per finding and version", async () => {
    const root = project();
    const { fetcher } = stubFetcher();
    await runUpdateCheck({ root, fetcher, env: env(), inventoryOptions });
    const before = openFindings(readState(root));
    const update = before.find((f) => f.name === "@protoboardai/core")!;
    dismissFinding(root, update);
    expect(openFindings(readState(root)).some((f) => f.key === update.key)).toBe(false);
    // a newer release shows again
    await runUpdateCheck({ root, fetcher: stubFetcher({ latest: "0.2.4" }).fetcher, env: env(), inventoryOptions });
    expect(openFindings(readState(root)).some((f) => f.key === update.key)).toBe(true);
  });
});
