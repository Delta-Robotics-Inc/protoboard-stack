/**
 * `protoboard init` points a new project at the hosted Protoboard library
 * (PB-915): its config's cloud.url is HOSTED_CLOUD_URL, unless --url,
 * PROTOBOARD_CLOUD_URL or --local (this machine's parts service) say
 * otherwise.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_CLOUD_URL, HOSTED_CLOUD_URL } from "@protoboardai/core";

const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), "pb-init-cloud-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function init(name: string, args: string[], env: Record<string, string> = {}): string {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_") && k !== "npm_config_registry"));
  const r = spawnSync(process.execPath, [CLI, "init", join(TMP, name), "--no-parts", ...args], { encoding: "utf8", env: { ...clean, ...env }, timeout: 60_000 });
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(join(TMP, name, "protoboard.config.ts"), "utf8");
}

describe("protoboard init: the project's library", () => {
  it("is the hosted one by default, a Cloud Run deterministic URL in protoboard-cloud", () => {
    expect(HOSTED_CLOUD_URL).toMatch(/^https:\/\/protoboard-parts-\d+\.us-central1\.run\.app$/);
    expect(init("hosted", [])).toContain(`cloud: { url: "${HOSTED_CLOUD_URL}" },`);
    expect(init("hosted-drone", ["--template", "drone"])).toContain(`cloud: { url: "${HOSTED_CLOUD_URL}" },`);
  });

  it("--local is this machine's parts service", () => {
    expect(init("local", ["--local"])).toContain(`cloud: { url: "${DEFAULT_CLOUD_URL}" },`);
  });

  it("--url and PROTOBOARD_CLOUD_URL win", () => {
    expect(init("flag", ["--url", "http://127.0.0.1:8795/", "--local"])).toContain('cloud: { url: "http://127.0.0.1:8795" },');
    expect(init("env", ["--template", "iot"], { PROTOBOARD_CLOUD_URL: "http://localhost:9000" })).toContain('cloud: { url: "http://localhost:9000" },');
  });
});
