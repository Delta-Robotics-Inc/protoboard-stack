/**
 * The reference docs and transfer limits shipped inside @protoboardai/core (wave 2 gate): an installed
 * CLI has no `docs/` folder, so `packages/core/reference/` carries byte-identical copies, the package
 * publishes that folder, the limits loader reads it first, and AGENTS.md links to it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILT_IN_LIMITS, SHIPPED_REFERENCE_FILES, limitsFileCandidates, loadTransferLimits, shippedReferenceDir } from "../src/render-service/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CORE = join(HERE, "..");
const DOCS = join(CORE, "..", "..", "docs", "reference");
const SHIPPED = join(CORE, "reference");
const REFRESH = "re-copy it: for f in display.md viewer-bridge.md render-service.md view-tools.md transfer-limits.json; do cp docs/reference/$f packages/core/reference/$f; done (see packages/core/reference/README.md)";

describe("the reference shipped in the package", () => {
  it("is the folder the module resolves to, in the repo and (the same relative path) in an installed package", () => {
    expect(shippedReferenceDir()).toBe(SHIPPED);
  });
  for (const name of SHIPPED_REFERENCE_FILES) {
    it(`reference/${name} is byte-identical to docs/reference/${name}`, () => {
      expect(existsSync(join(SHIPPED, name)), `packages/core/reference/${name} is missing: ${REFRESH}`).toBe(true);
      const same = readFileSync(join(SHIPPED, name)).equals(readFileSync(join(DOCS, name)));
      expect(same, `packages/core/reference/${name} differs from docs/reference/${name}: ${REFRESH}`).toBe(true);
    });
  }
  it("is published (package.json files) and exported", () => {
    const pkg = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")) as { files: string[]; exports: Record<string, string> };
    expect(pkg.files).toContain("reference");
    expect(pkg.exports["./reference/*"]).toBe("./reference/*");
  });
  it("the limits loader reads the shipped copy first (after PROTOBOARD_TRANSFER_LIMITS), and it equals the built-in values", () => {
    const shipped = join(SHIPPED, "transfer-limits.json");
    expect(limitsFileCandidates({})[0]).toBe(shipped);
    expect(limitsFileCandidates({ PROTOBOARD_TRANSFER_LIMITS: "x.json" })[1]).toBe(shipped);
    expect(loadTransferLimits({ env: {} }).file).toBe(shipped);
    expect(JSON.parse(readFileSync(shipped, "utf8"))).toEqual(BUILT_IN_LIMITS);
  });
  it("the AGENTS.md template links to the shipped path, not to a repository path alone", () => {
    const common = readFileSync(join(CORE, "templates", "_agents", "common.md"), "utf8");
    expect(common).toContain("node_modules/@protoboardai/core/reference/display.md");
  });
});
