/**
 * vitest's globalSetup for no-hosted-service.mjs: after the run, list the
 * requests to the hosted Protoboard library that were blocked (from
 * PB_TEST_HOSTED_LOG). They failed as a service that does not answer fails,
 * so a test that needs a library names its own (cloud.url,
 * PROTOBOARD_CLOUD_URL or --url) and a fixture service.
 */
import { existsSync, readFileSync } from "node:fs";

export default function setup() {
  return function teardown() {
    const log = process.env.PB_TEST_HOSTED_LOG;
    const blocked = log && existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
    if (blocked.length) process.stderr.write(`\nno-hosted-service: ${blocked.length} request(s) to the hosted Protoboard library were blocked (answered as a service that does not answer):\n${blocked.map((l) => `  ${l}`).join("\n")}\n`);
  };
}
