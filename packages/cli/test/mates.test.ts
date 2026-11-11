/**
 * `protoboard mates list | suggest | validate` (PB-1185) on the drone example:
 * no declared mates, suggestions written to .protoboard/build/ (never source)
 * with provenance inferred, the ones a UHD link already makes counted as
 * covered, and the usage error.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matesCommand } from "../src/mates.ts";

const here = dirname(fileURLToPath(import.meta.url));
const drone = resolve(here, "../../../examples/quadcopter-5in");

function capture() {
  const seen: { data: unknown; text: string }[] = [];
  return { seen, out: (data: unknown, text: () => string) => seen.push({ data, text: text() }) };
}

describe("protoboard mates", () => {
  it("lists and validates: the drone declares no mates and has no problems", async () => {
    const c = capture();
    expect(await matesCommand(drone, ["list"], c.out)).toBe(0);
    expect((c.seen[0].data as { mates: unknown[] }).mates).toEqual([]);
    expect(c.seen[0].text).toMatch(/no mates declared/);
    expect(await matesCommand(drone, ["validate", "--json"], c.out)).toBe(0);
    expect(c.seen[1].data).toMatchObject({ ok: true, mates: 0, problems: [] });
  }, 120_000);

  it("suggests mates into .protoboard/build/mates-suggested.json, inferred, with the linked ones counted as covered", async () => {
    const c = capture();
    expect(await matesCommand(drone, ["suggest"], c.out)).toBe(0);
    const data = c.seen[0].data as { path: string; counts: { suggestions: number; covered: number; bodies: number }; suggestions: { provenance: string; confidence: number; evidence: unknown[]; a: { instance: string }; b: { instance: string } }[] };
    expect(data.path.replace(/\\/g, "/")).toMatch(/examples\/quadcopter-5in\/\.protoboard\/build\/mates-suggested\.json$/);
    expect(existsSync(data.path)).toBe(true);
    const file = JSON.parse(readFileSync(data.path, "utf8"));
    expect(file.schema).toBe("protoboard.mates-suggested/v0");
    expect(data.counts.bodies).toBeGreaterThan(10);
    // every motor's bolt pattern and every prop on its shaft is a link already: covered, not suggested again
    expect(data.counts.covered).toBeGreaterThanOrEqual(8);
    for (const s of data.suggestions) {
      expect(s.provenance).toBe("inferred");
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.evidence.length).toBeGreaterThan(0);
    }
    // the battery strapped on the top plate is placed by a display hint: a new suggestion
    expect(data.suggestions.some((s) => [s.a.instance, s.b.instance].sort().join("~") === "battery~top_plate")).toBe(true);
    expect(c.seen[0].text).toMatch(/written: .*mates-suggested\.json/);
  }, 120_000);

  it("says how to call it", async () => {
    await expect(matesCommand(drone, ["bogus"], capture().out)).rejects.toThrow(/usage: protoboard mates/);
    await expect(matesCommand(join(here, "..", "..", "..", ".."), ["list"], capture().out)).rejects.toThrow(/not in a Protoboard project/);
  });
});
