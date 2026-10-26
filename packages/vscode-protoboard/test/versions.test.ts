/**
 * One version number (PB-944): the VS Code extension and the stack share it.
 * The build reads the stack's from packages/core/package.json and refuses a
 * different number in this package.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aboutLine, STACK_VERSION } from "../src/versions.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = (p: string) => readFileSync(join(HERE, "..", p), "utf8");

describe("the extension's version is the stack's", () => {
  it("the extension's package.json and its lockfile carry the version of packages/core", () => {
    const stack = JSON.parse(read("../core/package.json")).version;
    expect(stack).toMatch(/^\d+\.\d+\.\d+/);
    // an extension-only fix bumps the whole stack: bump them together (CONTRIBUTING.md, "Versions")
    expect(JSON.parse(read("package.json")).version).toBe(stack);
    const lock = JSON.parse(read("package-lock.json"));
    expect([lock.version, lock.packages[""].version]).toEqual([stack, stack]);
  });

  it("one line names the version, and says so when a build was made from another stack", () => {
    expect(aboutLine("0.1.3", "0.1.3")).toBe("Protoboard for VS Code 0.1.3");
    expect(aboutLine("0.1.3", undefined)).toBe(aboutLine("0.1.3", "0.1.3"));
    expect(aboutLine("0.1.3", "0.1.4")).toBe("Protoboard for VS Code 0.1.3 (stack 0.1.4: mismatched build, please report it)");
    // unbundled (as here) nothing defines the constant
    expect(STACK_VERSION).toBeUndefined();
  });

  it("the build takes the stack version from packages/core/package.json and stops on a different one; the command is contributed", () => {
    const build = read("esbuild.mjs");
    expect(build).toMatch(/join\(here, "\.\.", "core", "package\.json"\)/);
    expect(build).toContain("__PB_STACK_VERSION__: JSON.stringify(stackVersion)");
    expect(build).toMatch(/ownVersion !== stackVersion/);
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.contributes.commands.some((c: { command: string }) => c.command === "protoboard.about")).toBe(true);
    expect(read("src/extension.ts")).toContain('cmd("protoboard.about"');
  });
});
