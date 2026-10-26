/**
 * `protoboard upgrade`'s package.json step (PB-1051): a 0.1.x project's
 * @protoboardai/* ranges become this stack's, the toolchain pins follow,
 * anything that is not a plain version or range is left alone.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FRAMEWORK_VERSION, STACK_RANGE, TOOLCHAIN, applyUpgrade, planUpgrade } from "../src/index.js";

const tmp = mkdtempSync(join(tmpdir(), "pb-upgrade-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const project = (name: string, pkg: object) => {
  const dir = join(tmp, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  return dir;
};

describe("planUpgrade and applyUpgrade", () => {
  it("is this stack's range, as init writes it", () => {
    expect(STACK_RANGE).toBe(`^${FRAMEWORK_VERSION}`);
  });

  it("moves a 0.1.7 project's ranges and toolchain pins, and keeps everything else", () => {
    const dir = project("old", {
      name: "old",
      scripts: { check: "protoboard check" },
      dependencies: { "@deltarobotics/uhd": "0.2.1", "@protoboardai/core": "^0.1.7", "@protoboardai/ext-hardware": "^0.1.0", "left-pad": "^1.3.0" },
      devDependencies: { "@protoboardai/cli": "^0.1.7", typescript: "7.0.2", "@protoboardai/ext-local": "file:../ext-local" },
    });
    const plan = planUpgrade(dir);
    expect(plan.from).toBe("^0.1.7");
    expect(plan.to).toBe(STACK_RANGE);
    expect(plan.changes.map((c) => c.name).sort()).toEqual(["@deltarobotics/uhd", "@protoboardai/cli", "@protoboardai/core", "@protoboardai/ext-hardware", ...(TOOLCHAIN.typescript === "7.0.2" ? [] : ["typescript"])].sort());
    expect(plan.kept).toEqual([{ field: "devDependencies", name: "@protoboardai/ext-local", spec: "file:../ext-local" }]);
    applyUpgrade(plan);
    const after = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(after.dependencies).toEqual({ "@deltarobotics/uhd": TOOLCHAIN.uhd, "@protoboardai/core": STACK_RANGE, "@protoboardai/ext-hardware": STACK_RANGE, "left-pad": "^1.3.0" });
    expect(after.devDependencies["@protoboardai/cli"]).toBe(STACK_RANGE);
    expect(after.devDependencies["@protoboardai/ext-local"]).toBe("file:../ext-local");
    expect(after.scripts).toEqual({ check: "protoboard check" });
    // a second run has nothing to do
    expect(planUpgrade(dir).changes).toEqual([]);
  });

  it("leaves a project's own TypeScript range alone", () => {
    const dir = project("ts", { devDependencies: { "@protoboardai/cli": STACK_RANGE, typescript: "^6.0.0" } });
    expect(planUpgrade(dir).changes).toEqual([]);
  });
});
