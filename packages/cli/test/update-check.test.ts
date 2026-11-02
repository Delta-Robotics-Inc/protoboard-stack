/**
 * `protoboard update check|status|on|off` (PB-1168) with the network
 * stubbed, and the after-command notice and background start that W4-D
 * wires into index.ts.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readState } from "../../core/src/update/check.js";
import { makeProject, stubFetcher, VULN_ID } from "../../core/test/update-fixtures.js";
import { afterCommand, exitCodeFor, updateCommand } from "../src/update-check.js";

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const project = (o?: Parameters<typeof makeProject>[0]) => {
  const r = makeProject(o);
  made.push(r);
  return r;
};
const env = () => {
  const dir = mkdtempSync(join(tmpdir(), "pb-cfg-"));
  made.push(dir);
  return { PROTOBOARD_CONFIG_DIR: dir } as NodeJS.ProcessEnv;
};
const capture = () => {
  const got: { data?: unknown; text?: string } = {};
  return { got, out: (d: unknown, t: () => string) => ((got.data = d), (got.text = t())) };
};

describe("protoboard update check", () => {
  it("checks, exits 1 on a vulnerability, names the advisory, then shows the day's result again without --force", async () => {
    const root = project();
    const e = env();
    const { fetcher, calls } = stubFetcher();
    const now = new Date("2026-11-01T12:00:00Z");
    const c1 = capture();
    expect(await updateCommand(root, ["check"], c1.out, { env: e, fetcher, now, force: true, background: false })).toBe(1);
    const r = c1.got.data as { status: string; findings: { kind: string; ids?: string[] }[] };
    expect(r.status).toBe("vulnerable");
    expect(r.findings.find((f) => f.kind === "vulnerable")?.ids).toContain(VULN_ID);
    expect(c1.got.text).toContain(VULN_ID);
    expect(c1.got.text).toContain("nothing was installed or changed");
    const n = calls.urls.length;
    // within the day: the cached result, no network
    const c2 = capture();
    expect(await updateCommand(root, ["check"], c2.out, { env: e, fetcher, now: new Date(now.getTime() + 60_000), background: false })).toBe(1);
    expect((c2.got.data as { cached: boolean }).cached).toBe(true);
    expect(calls.urls.length).toBe(n);
    expect(c2.got.text).toMatch(/--force to check now/);
    // --force checks again
    await updateCommand(root, ["check"], capture().out, { env: e, fetcher, now: new Date(now.getTime() + 120_000), force: true, background: false });
    expect(calls.urls.length).toBeGreaterThan(n);
  });

  it("exits 0 when only an update is available", async () => {
    const root = project();
    const { fetcher } = stubFetcher();
    const c = capture();
    // drop the vulnerable package from the answer: a newer Protoboard only
    const onlyUpdates: typeof fetcher = async (url, init) => (url.includes("querybatch") ? new Response(JSON.stringify({ results: [] })) : fetcher(url, init));
    expect(await updateCommand(root, ["check"], c.out, { env: env(), fetcher: onlyUpdates, force: true, background: false })).toBe(0);
    expect((c.got.data as { status: string }).status).toBe("update-available");
    expect(exitCodeFor(c.got.data as never)).toBe(0);
  });

  it("off sends nothing, even with --force; on turns it back on; status says which", async () => {
    const root = project();
    const e = env();
    const { fetcher, calls } = stubFetcher();
    const off = capture();
    await updateCommand(root, ["off"], off.out, { env: e });
    expect(off.got.data).toMatchObject({ enabled: false });
    const c = capture();
    await updateCommand(root, ["check"], c.out, { env: e, fetcher, force: true, background: false });
    expect(calls.urls).toEqual([]);
    expect(c.got.text).toMatch(/update check is off .*nothing was sent/);
    const s = capture();
    await updateCommand(root, ["status"], s.out, { env: e });
    expect(s.got.data).toMatchObject({ enabled: false, project: true });
    await updateCommand(root, ["on"], capture().out, { env: e });
    const s2 = capture();
    await updateCommand(root, ["status"], s2.out, { env: e });
    expect(s2.got.data).toMatchObject({ enabled: true });
    await expect(updateCommand(root, ["bogus"], capture().out, { env: e })).rejects.toThrow(/usage: protoboard update/);
  });
});

describe("after a CLI command", () => {
  it("prints each open finding once on stderr and starts the background check only when due and allowed", async () => {
    const root = project();
    const e = env();
    const { fetcher } = stubFetcher();
    const now = new Date("2026-11-01T12:00:00Z");
    await updateCommand(root, ["check"], capture().out, { env: e, fetcher, now, force: true, background: false });
    let written = "";
    const stderr = { write: (s: string) => ((written += s), true) } as unknown as NodeJS.WritableStream;
    const spawned: string[] = [];
    afterCommand(root, "build", { env: e, stderr, spawnCheck: (r) => spawned.push(r), now: new Date(now.getTime() + 1000) });
    expect(written).toContain(`advisory ${VULN_ID}`);
    expect(written).toMatch(/Protoboard: @protoboardai\/core 0\.2\.3 is available/);
    expect(spawned).toEqual([]); // not due
    expect(Object.keys(readState(root).shown ?? {}).length).toBeGreaterThan(0);
    written = "";
    // wave R3 gate: a fixed clock (the real one passed the check's due time on 2026-11-02 and started a check here)
    afterCommand(root, "build", { env: e, stderr, spawnCheck: (r) => spawned.push(r), now: new Date(now.getTime() + 2000) });
    expect(written).toBe(""); // printed once per finding and version
    // due, and allowed: starts one; never under a test runner or in CI, never after update/inventory/mcp
    afterCommand(root, "build", { env: e, stderr, spawnCheck: (r) => spawned.push(r), now: new Date(now.getTime() + 31 * 60 * 60 * 1000) });
    expect(spawned).toEqual([root]);
    afterCommand(root, "build", { env: { ...e, VITEST: "true" }, stderr, spawnCheck: (r) => spawned.push(r), now: new Date(now.getTime() + 31 * 60 * 60 * 1000) });
    afterCommand(root, "mcp", { env: e, stderr, spawnCheck: (r) => spawned.push(r), now: new Date(now.getTime() + 31 * 60 * 60 * 1000) });
    expect(spawned).toEqual([root]);
    // turned off: quiet, no notice from the stored result either (wave 4 gate)
    const before = readState(root);
    writeFileSync(join(root, ".protoboard", "local", "update-check.json"), JSON.stringify({ ...before, shown: {} }));
    written = "";
    afterCommand(root, "build", { env: { ...e, PROTOBOARD_NO_UPDATE_CHECK: "1" }, stderr, spawnCheck: (r) => spawned.push(r) });
    expect(written).toBe("");
  });
});
