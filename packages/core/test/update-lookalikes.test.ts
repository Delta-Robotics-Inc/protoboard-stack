/**
 * The lookalike deny list (PB-1168): the shipped data loads, every seeded
 * name is denied, the generic rule catches near names of our real
 * dependencies, and the real dependency set raises nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPackageName, checkRepoOwner, defaultLookalikesPath, editDistance, loadLookalikes, parseLookalikes, scanNames } from "../src/update/lookalikes.js";

const list = loadLookalikes();

describe("the lookalike list", () => {
  it("is shipped as data with a source comment on every entry", () => {
    expect(defaultLookalikesPath().replace(/\\/g, "/")).toMatch(/packages\/core\/reference\/lookalikes\.json$/);
    expect(list.deny.length).toBeGreaterThanOrEqual(7);
    for (const e of list.deny) expect(e.comment).toMatch(/Source|source/);
    expect(() => parseLookalikes({ schema: "nope" })).toThrow(/not a protoboard\.lookalikes\/v0/);
    expect(() => parseLookalikes({ schema: "protoboard.lookalikes/v0", deny: [{ name: "x", kind: "deny" }] })).toThrow(/comment citing its source/);
  });

  it("denies every name the renderer research note names (section 4.1 item 6)", () => {
    for (const name of ["vaps-transform", "cbim-three-mesh-bvh", "@wendraw/three-bvh-csg", "@sunbox/occt-import-js", "@ohos-ports/gltf-transform-cli", "@bitruvius/meshopt", "@3dverse/livelink-camera-controls"]) {
      expect(checkPackageName(name, "npm", list).verdict, name).toBe("deny");
    }
    expect(checkPackageName("vaps-transform", "npm", list).resembles).toBe("@gltf-transform/cli");
    expect(checkPackageName("@tx-code/occt-js", "npm", list).verdict).toBe("watch");
  });

  it("flags names close to our real dependencies (edit distance, scope swap, js suffix, wrapper prefix)", () => {
    const suspect = (n: string, eco: "npm" | "PyPI" = "npm") => checkPackageName(n, eco, list);
    expect(suspect("thre").verdict).toBe("suspect"); // distance 1 from a short name
    expect(suspect("thr").verdict).toBe("ok"); // distance 2 from a 5-letter name: allowed only 1
    expect(suspect("three-mesh-bhv").verdict).toBe("suspect");
    expect(suspect("meshoptimiser").verdict).toBe("suspect");
    expect(suspect("@gltf-transforn/core").verdict).toBe("suspect");
    expect(suspect("@evil/occt-import-js").verdict).toBe("suspect"); // a rescoped unscoped name
    expect(suspect("occt-import").verdict).toBe("suspect"); // -js dropped
    expect(suspect("evil-three-mesh-bvh").verdict).toBe("suspect"); // wrapper prefix
    expect(suspect("@protoboard-ai/core").verdict).toBe("suspect");
    expect(suspect("@protoboardia/cli").verdict).toBe("suspect");
    expect(suspect("protoboardai-cli").verdict).toBe("suspect");
    expect(suspect("@deltarobotic/uhd").verdict).toBe("suspect");
    expect(suspect("build124d", "PyPI").verdict).toBe("suspect");
    // ours and the real ones are fine
    for (const n of ["three", "three-mesh-bvh", "@gltf-transform/core", "@protoboardai/ext-parts", "@deltarobotics/uhd-viewer", "three-stdlib", "@tscircuit/core", "@floating-ui/core", "react"]) expect(suspect(n).verdict, n).toBe("ok");
    expect(suspect("Build123D", "PyPI").verdict).toBe("ok");
  });

  it("raises nothing on the stack's real dependency set (no false positives)", () => {
    const lock = join(defaultLookalikesPath(), "..", "..", "..", "..", "node_modules", ".package-lock.json");
    let names: string[] = [];
    try {
      const l = JSON.parse(readFileSync(lock, "utf8")) as { packages: Record<string, unknown> };
      names = Object.keys(l.packages).filter((k) => k.includes("node_modules/")).map((k) => k.slice(k.lastIndexOf("node_modules/") + 13));
    } catch {
      return; // no install here
    }
    expect(names.length).toBeGreaterThan(50);
    expect(scanNames(names.map((name) => ({ name, ecosystem: "npm" as const })), list)).toEqual([]);
  });

  it("pins a repository's owner", () => {
    expect(checkRepoOwner("morluto/rea", list)?.ok).toBe(true);
    expect(checkRepoOwner("m0rluto/rea", list)).toMatchObject({ ok: false, expected: "morluto/rea" });
    expect(checkRepoOwner("someone/unrelated", list)).toBeUndefined();
  });

  it("measures edit distance with an early exit", () => {
    expect(editDistance("three", "thre")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("abcdefgh", "zzzzzzzz", 2)).toBe(3);
  });
});
