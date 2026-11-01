/**
 * Opt-in live smoke for the update check (PB-1168): skipped unless
 * PROTOBOARD_LIVE_UPDATE_CHECK=1. It reaches registry.npmjs.org and
 * api.osv.dev only (the allowlist refuses anything else), with the drone
 * example's real inventory, and writes no state (writeState: false).
 *
 *   PROTOBOARD_LIVE_UPDATE_CHECK=1 npx vitest run packages/core/test/update-live.test.ts
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runUpdateCheck } from "../src/update/check.js";

const LIVE = process.env.PROTOBOARD_LIVE_UPDATE_CHECK === "1";
const DRONE = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "examples", "quadcopter-5in");

describe.skipIf(!LIVE)("the update check, live", () => {
  it("asks npm and OSV about the drone example's packages", async () => {
    const r = await runUpdateCheck({ root: DRONE, force: true, writeState: false, env: { ...process.env, VITEST: undefined, CI: undefined }, inventoryOptions: { noExec: true } });
    expect(r.network.hosts.every((h) => h === "registry.npmjs.org" || h === "api.osv.dev")).toBe(true);
    expect(r.counts.queried).toBeGreaterThan(10);
    expect(r.sources.osv).toBe("ok");
    console.log(JSON.stringify({ status: r.status, counts: r.counts, sources: r.sources, ms: r.durationMs, requests: r.network.requests, findings: r.findings.map((f) => `${f.kind} ${f.name} ${f.version ?? ""} ${f.ids?.join(",") ?? f.latest ?? ""}`), errors: r.errors }, null, 2));
  }, 60_000);
});
