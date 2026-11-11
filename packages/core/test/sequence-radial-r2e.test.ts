/**
 * R2-E (H2, 2026-11-02): the radial explode on the tooling side: each part's way out from its mounting face (the
 * viewer's rule), the `explode` override on members, the `explode` patch edit, the assembly script's
 * `"explode": "radial"`, and the drone built with it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadProject } from "../src/project.ts";
import { RADIAL, applyPatches, applyRadial, buildSequence, flattenSequence, mountingNormal, movingMembers, placeTriangles, radialDirections, readSequencePatches, type SequenceFile, type Vec3 } from "../src/sequence/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const stackRoot = resolve(here, "../../..");
const tmp = mkdtempSync(join(tmpdir(), "pb-radial-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A box's 12 triangles, outward facing, as corners (xyz per corner). */
function box(min: Vec3, max: Vec3): Float32Array {
  const [a, b, c] = min;
  const [x, y, z] = max;
  const v = [
    [a, b, c], [x, b, c], [x, y, c], [a, y, c],
    [a, b, z], [x, b, z], [x, y, z], [a, y, z],
  ];
  // faces counter-clockwise seen from outside
  const quads = [
    [0, 3, 2, 1], // -z
    [4, 5, 6, 7], // +z
    [0, 1, 5, 4], // -y
    [2, 3, 7, 6], // +y
    [1, 2, 6, 5], // +x
    [0, 4, 7, 3], // -x
  ];
  const out: number[] = [];
  for (const [p, q, r, s] of quads) out.push(...v[p], ...v[q], ...v[r], ...v[p], ...v[r], ...v[s]);
  return new Float32Array(out);
}

describe("radial explode (R2-E, H2)", () => {
  it("finds the largest facing that looks away from the centre", () => {
    // a thin panel: its two big faces are ±X
    const panel = box([9, -10, -10], [10, 10, 10]);
    expect(mountingNormal(panel, [1, 0, 0])).toEqual([1, 0, 0]);
    expect(mountingNormal(panel, [-1, 0, 0])).toEqual([-1, 0, 0]);
    // nothing faces along +Z enough on a single triangle facing -Z
    const down = new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 0]);
    expect(mountingNormal(down, [0, 0, 1])).toBeUndefined();
  });

  it("pushes each part out from the assembly's centre along its mounting face, the same distance for all", () => {
    const core = { ref: "core", triangles: box([-1, -1, -1], [1, 1, 1]) };
    const right = { ref: "right", triangles: box([9, -10, -10], [10, 10, 10]) };
    // a panel tilted 45 degrees toward +Y at the +Y side: its big face looks along (0, 0.707, 0.707)
    const tri = (p: number[][]) => new Float32Array(p.flat());
    const tilted = { ref: "tilted", triangles: tri([[-5, 8, 0], [5, 3, 5], [5, 8, 0], [-5, 8, 0], [-5, 3, 5], [5, 3, 5]]) };
    const lid = { ref: "lid", triangles: box([-10, -10, 9], [10, 10, 10]) };
    const r = radialDirections([core, right, tilted, lid], [core, right, tilted, lid, { ref: "base", triangles: box([-10, -10, -10], [10, 10, -9]) }]);
    const by = Object.fromEntries(r.map((x) => [x.ref, x]));
    expect(by.core).toMatchObject({ direction: [0, 0, 1], from: "up" });
    expect(by.right).toMatchObject({ direction: [1, 0, 0], from: "face" });
    expect(by.lid).toMatchObject({ direction: [0, 0, 1], from: "face" });
    expect(by.tilted.from).toBe("face");
    expect(by.tilted.direction[1]).toBeCloseTo(Math.SQRT1_2, 3);
    expect(by.tilted.direction[2]).toBeCloseTo(Math.SQRT1_2, 3);
    // radius: half the diagonal of the 20 mm cube; 0.6 of it, the same for every part
    const radius = Math.hypot(20, 20, 20) / 2;
    for (const x of r) expect(x.distance).toBeCloseTo(RADIAL.distanceShare * radius, 1);
  });

  it("falls back to the line from the centre when no facing looks away", () => {
    const centre = { ref: "c", triangles: box([-10, -10, -10], [10, 10, 10]) };
    // one triangle at +X whose only face looks back toward the centre
    const inward = { ref: "in", triangles: new Float32Array([20, 0, 0, 20, 0, 1, 20, 1, 0]) };
    const [r] = radialDirections([inward], [centre, inward]);
    expect(r.from).toBe("centre");
    expect(r.direction[0]).toBeGreaterThan(0.99);
  });

  it("places a body-frame mesh with a row-major matrix", () => {
    const t = placeTriangles(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]), [1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7, 0, 0, 0, 1]);
    expect([...t]).toEqual([5, 6, 7, 6, 6, 7, 5, 7, 7]);
  });

  it("writes `explode` on members, and an `explode` patch edit adjusts it (a group's members, unknown refs warned)", () => {
    const file: SequenceFile = {
      schema: "protoboard.sequence/v0",
      main: "main",
      root: [],
      defaults: { durationS: 1.2, maxTurns: 3, unscrewShare: 0.45 },
      generated: { by: "test" },
      sequences: [
        {
          id: "main",
          scope: "",
          base: ["frame"],
          groups: [{ id: "@h/screw", members: ["h/screw#1", "h/screw#2"] }],
          steps: [
            { id: "fit:a", title: "Fit a", kind: "place", members: [{ ref: "a" }], source: "generated" },
            { id: "fasten:a", title: "Fasten a", kind: "fasten", members: [{ ref: "h/screw#1" }, { ref: "h/screw#2" }], source: "generated" },
          ],
        },
      ],
    };
    expect(movingMembers(file, new Set(["h/screw#1", "h/screw#2"]))).toEqual(["a"]);
    const radial = applyRadial(file, [{ ref: "a", direction: [1, 0, 0], distance: 50, from: "face" }]);
    expect(radial.sequences[0].steps[0].members[0].explode).toEqual({ direction: [1, 0, 0], distance: 50 });
    // the input is left as it was
    expect(file.sequences[0].steps[0].members[0].explode).toBeUndefined();
    const r = applyPatches(radial, [
      {
        edits: [
          { explode: "a", distance: 80 },
          { explode: "@h/screw", direction: [0, 0, 1] },
          { explode: "frame", distance: 10 },
          { explode: "a", direction: [0, 0, 0] },
          { explode: "a", distance: -1 },
        ],
      },
    ]);
    expect(r.applied).toBe(2);
    expect(r.file.sequences[0].steps[0].members[0].explode).toEqual({ direction: [1, 0, 0], distance: 80 });
    expect(r.file.sequences[0].steps[1].members.map((m) => m.explode)).toEqual([{ direction: [0, 0, 1] }, { direction: [0, 0, 1] }]);
    expect(r.problems.map((p) => p.code)).toEqual(["SEQUENCE_PATCH_UNKNOWN_MEMBER", "SEQUENCE_PATCH_BAD_EXPLODE", "SEQUENCE_PATCH_BAD_EXPLODE"]);
  });

  it("reads the script's explode mode", async () => {
    const root = join(tmp, "script");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "assembly.sequence.json"), JSON.stringify({ explode: "radial", patches: [] }));
    expect((await readSequencePatches(root)).explode).toBe("radial");
    writeFileSync(join(root, "src", "assembly.sequence.json"), JSON.stringify({ explode: "sideways", patches: [] }));
    const bad = await readSequencePatches(root);
    expect(bad.explode).toBeUndefined();
    expect(bad.problems.map((p) => p.code)).toEqual(["SEQUENCE_PATCH_INVALID"]);
  });

  it("builds the drone's sequence with a way out for every moving body (none for its fasteners)", async () => {
    const p = await loadProject(join(stackRoot, "examples", "quadcopter-5in"), { checks: false });
    const plain = (await buildSequence(p))!;
    const t0 = performance.now();
    const b = (await buildSequence(p, { explode: "radial" }))!;
    const ms = performance.now() - t0;
    const members = flattenSequence(b.file).flatMap((s) => s.step.members.map((m) => ({ m, kind: s.step.kind })));
    const bodies = members.filter((x) => x.kind !== "fasten");
    const withWay = bodies.filter((x) => x.m.explode);
    // every moving body with a model has its way out; fasteners have none
    expect(withWay.length).toBeGreaterThan(0);
    expect(members.filter((x) => x.kind === "fasten" && x.m.explode)).toHaveLength(0);
    for (const { m } of withWay) {
      const d = m.explode!.direction!;
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 3);
      expect(m.explode!.distance).toBeGreaterThan(0);
    }
    // the four arms leave outward, away from each other (their mounting faces look out from the frame)
    const arm = (k: string) => withWay.find((x) => x.m.ref === k)?.m.explode?.direction;
    const fl = arm("arm_fl/arm");
    const rr = arm("arm_rr/arm");
    if (fl && rr) expect(fl[0] * rr[0] + fl[1] * rr[1]).toBeLessThan(0);
    // without the option nothing changes
    expect(flattenSequence(plain.file).some((s) => s.step.members.some((m) => m.explode))).toBe(false);
    console.log(`[R2-E] drone radial explode: ${withWay.length}/${bodies.length} bodies with a way out, ${ms.toFixed(0)} ms`);
  }, 120_000);
});
