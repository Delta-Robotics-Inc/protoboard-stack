/**
 * `protoboard stack link` on packages no stack copy provides (as on a large field project): it
 * says which the project's files import and which are leftovers, and never
 * tells anyone to run npm install.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { importedPackages, notProvidedLines } from "../src/stack-messages.js";

const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-stack-messages");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function project(files: Record<string, string>) {
  rmSync(TMP, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(TMP, rel, ".."), { recursive: true });
    writeFileSync(join(TMP, rel), content);
  }
  return TMP;
}

describe("stack link: packages the stack does not provide", () => {
  const root = () =>
    project({
      "src/boards/b/check.ts": 'import { thing } from "@tscircuit/circuit-json-util/dist";\nconst x = require("spicey");\n',
      "scripts/a.mjs": "import 'zod';\n",
      "node_modules/leftover/index.js": 'import "@tscircuit/math-utils";\n',
      "operations/x.ts": 'import "@tscircuit/math-utils";\n',
    });

  it("finds the ones the project's own files import, by name or a path inside them", () => {
    expect([...importedPackages(root(), ["@tscircuit/circuit-json-util", "spicey", "zod", "@tscircuit/math-utils", "typescript"])].sort()).toEqual(["@tscircuit/circuit-json-util", "spicey", "zod"]);
  });

  it("says which are imported and which are leftovers, and never says npm install", () => {
    const lines = notProvidedLines(root(), ["@tscircuit/circuit-json-util", "@tscircuit/math-utils", "typescript"]);
    expect(lines).toHaveLength(3);
    // the TypeScript pin is not a leftover
    expect(lines[0]).toBe("kept in package.json for type checking, not linked: typescript");
    expect(lines[1]).toMatch(/imported by the project's files: @tscircuit\/circuit-json-util\. Ask the person/);
    expect(lines[2]).toMatch(/imported by none of the project's files: @tscircuit\/math-utils\. Probably leftovers: remove them from package\.json/);
    expect(lines.join("\n")).not.toMatch(/npm install/);
    expect(notProvidedLines(root(), [])).toEqual([]);
  });
});
