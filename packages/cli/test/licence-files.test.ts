/**
 * Licence files guard (2026-10-21): Protoboard Stack is Apache-2.0, and every
 * package it ships carries LICENSE and NOTICE (scripts/check-licence-files.mjs).
 * protoboard-cloud (2026-10-23) is checked per package: its client is
 * Apache-2.0, its service root is under other terms and ships nothing.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkPackageLicences } from "../../../scripts/check-licence-files.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "scripts/check-licence-files.mjs");

describe("licence files", () => {
  it("the repository and every package it ships are Apache-2.0 with LICENSE and NOTICE", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--root", ROOT, "--json"], { encoding: "utf8" });
    expect(JSON.parse(r.stdout).problems).toEqual([]);
    expect(r.status).toBe(0);
  });
});

describe("licence files of one package in a repository that is not open source as a whole (--package)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "pb-licence-package-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const repo = (name: string, root: object, client: object, files: string[] = ["LICENSE", "NOTICE"]) => {
    const dir = join(scratch, name);
    mkdirSync(join(dir, "client"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(root));
    writeFileSync(join(dir, "client", "package.json"), JSON.stringify(client));
    for (const f of files) {
      if (f === "LICENSE") copyFileSync(join(ROOT, "LICENSE"), join(dir, "client", "LICENSE"));
      else writeFileSync(join(dir, "client", f), "Protoboard cloud client\n");
    }
    return dir;
  };
  const service = { name: "@protoboardai/cloud-service", private: true, license: "UNLICENSED" };
  const client = { name: "@protoboardai/cloud", license: "Apache-2.0", files: ["src/client.ts", "LICENSE", "NOTICE"] };

  it("passes an Apache-2.0 client beside a private, unlicensed service", () => {
    expect(checkPackageLicences(repo("ok", service, client), ["client"])).toEqual([]);
    const r = spawnSync(process.execPath, [SCRIPT, "--root", join(scratch, "ok"), "--package", "client"], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("fails a client without NOTICE, not Apache-2.0, or not listing its licence files", () => {
    const dir = repo("bad", service, { name: "@protoboardai/cloud", license: "UNLICENSED", files: ["src/client.ts"] }, ["LICENSE"]);
    expect(checkPackageLicences(dir, ["client"]).map((p) => `${p.path}: ${p.problem}`)).toEqual([
      'client/package.json: "license" is "UNLICENSED", not "Apache-2.0"',
      'client/package.json: "files" does not list LICENSE',
      "client/NOTICE: missing: @protoboardai/cloud must ship it",
      'client/package.json: "files" does not list NOTICE',
    ]);
  });

  it("fails a root under other terms that could be published", () => {
    const dir = repo("root", { name: "@protoboardai/cloud-service", license: "UNLICENSED", files: ["src"] }, client);
    expect(checkPackageLicences(dir, ["client"]).map((p) => p.problem)).toEqual([
      '@protoboardai/cloud-service is not Apache-2.0, so it must be "private": true',
      '@protoboardai/cloud-service is not Apache-2.0, so it must not ship anything (a "files" list)',
    ]);
  });
});
