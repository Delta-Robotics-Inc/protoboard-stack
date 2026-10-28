/**
 * The tests never reach the hosted Protoboard library. A project that sets no
 * cloud.url uses it by default, so a test that forgets to name its own service
 * (a fixture service, a closed port) would otherwise send real requests to it.
 *
 * Loaded into every test worker (vitest.config.ts, setupFiles) and, through
 * NODE_OPTIONS, into every Node process a test starts (the CLI). A request to
 * the hosted library's origin fails as a service that does not answer fails
 * (what a test saw when the default was a service on this machine that was
 * not running), and is written to PB_TEST_HOSTED_LOG, which the run lists at
 * its end (scripts/test/no-hosted-service-teardown.mjs). A test that resolves
 * the hosted URL on purpose (doctor's and whoami's account check, signed out)
 * is answered the same way.
 */
import { appendFileSync, readFileSync } from "node:fs";

const source = readFileSync(new URL("../../packages/core/src/web-urls.ts", import.meta.url), "utf8");
const hosted = /export const HOSTED_CLOUD_URL = "([^"]+)"/.exec(source)?.[1];
if (!hosted) throw new Error("no-hosted-service: HOSTED_CLOUD_URL not found in packages/core/src/web-urls.ts");
const origin = new URL(hosted).origin;

const original = globalThis.fetch;
if (original && !original.__noHostedService) {
  const guarded = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    let target;
    try {
      target = new URL(url).origin;
    } catch {
      target = undefined;
    }
    if (target === origin) {
      const log = process.env.PB_TEST_HOSTED_LOG;
      if (log) appendFileSync(log, `${url}  (pid ${process.pid}, ${process.argv.slice(1).join(" ")}; cwd ${process.cwd()})\n`);
      throw new TypeError("fetch failed", { cause: new Error(`a test reached the hosted Protoboard library (${url}): name a service with cloud.url, PROTOBOARD_CLOUD_URL or --url`) });
    }
    return original(input, init);
  };
  guarded.__noHostedService = true;
  globalThis.fetch = guarded;
}
