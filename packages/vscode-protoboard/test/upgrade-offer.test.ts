/**
 * A project made by an earlier Protoboard line (0.1 opened with the 0.2
 * extension): Initialize cannot link it to the carried stack, and updating it
 * is what sets it up. Its failure offered a .vsix or a registry only, so the
 * Inspector's Initialize was a dead end (UI QA, final launch pass).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ext = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/extension.ts"), "utf8");

describe("Initialize on a project of an earlier line", () => {
  const setup = ext.slice(ext.indexOf("async setupProject(given?: string)"), ext.indexOf("this.cliSaid.delete(root);", ext.indexOf("async setupProject(given?: string)")));
  it("offers Update Project to Protoboard <line> when no stack fits", () => {
    expect(setup).toMatch(/const line = this\.earlierLine\(cli\);/);
    expect(setup).toMatch(/const update = `Update Project to Protoboard \$\{line\}`;/);
    expect(setup).toMatch(/if \(a === update\) await vscode\.commands\.executeCommand\("protoboard\.project\.upgrade", root\);/);
  });
  it("uses the same rule as the notice on opening it", () => {
    const notices = ext.slice(ext.indexOf("private stackNotices(root: string, cli: CliCommand)"));
    expect(notices).toMatch(/const line = this\.earlierLine\(cli\);/);
    expect(ext).toMatch(/private earlierLine\(cli: CliCommand\): string \| undefined \{[\s\S]{0,400}compareVersions\(asked, manifest\.version\) < 0\) return manifest\.version\.split\("\."\)\.slice\(0, 2\)\.join\("\."\)/);
  });
});
