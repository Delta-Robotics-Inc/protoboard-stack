/**
 * npm settings the stack tells people to use (PB-944). `always-auth` left npm
 * in version 7; npm 11 warns about the line on every command and says the
 * next major version will stop on it. Tokens for a scoped registry are sent
 * without it (checked against an authenticated registry with npm 10 and 11).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SKIP = new Set(["node_modules", "dist", "public", ".git", ".scratch", "storage", "captures"]);
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n) || n.startsWith(".tmp")) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(md|ts|mjs|sh|json|yaml|html|tmpl)$/.test(n) ? [p] : [];
  });

describe("npm settings", () => {
  it("nothing sets always-auth: not the docs' .npmrc blocks, not what init writes, not the registry scripts", () => {
    const files = ["docs", "registry", "scripts", "packages/cli/src", "packages/core/src", "packages/core/templates"].flatMap((d) => walk(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(50);
    const setting = files.filter((f) => /always-auth\s*=/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(setting).toEqual([]);
  });
});
