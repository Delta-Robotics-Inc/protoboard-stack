/**
 * The System Map of this repository (docs/specs/system-map.md): sane bounds
 * rather than exact counts, so the test holds while the stack grows. Every
 * item type the stack ships is present, ids are unique, every link has two
 * ends, the islands are all reported, and two builds give the same bytes.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSystemMap, serializeSystemMap } from "../src/sysmap/build.js";
import { DISCIPLINE_ORDER, ITEM_TYPE_ORDER, type SystemMap } from "../src/sysmap/model.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
let map: SystemMap;
let again: SystemMap;
beforeAll(async () => {
  map = await buildSystemMap(ROOT);
  again = await buildSystemMap(ROOT);
}, 120_000);

describe("the System Map of this repository", () => {
  it("is a monorepo map with every item type the stack ships", () => {
    expect(map.layout).toBe("monorepo");
    expect(map.counts.items).toBeGreaterThan(150);
    expect(map.counts.links).toBeGreaterThan(500);
    for (const t of ITEM_TYPE_ORDER) expect(map.counts.byType[t], t).toBeGreaterThan(0);
    expect(map.counts.byType.extension).toBeGreaterThanOrEqual(10);
    expect(map.counts.byType.skill).toBeGreaterThanOrEqual(25);
    expect(map.counts.byType["cli-command"]).toBeGreaterThanOrEqual(25);
  });

  it("has unique ids, links whose ends exist, and no self-links", () => {
    const ids = new Set(map.items.map((i) => i.id));
    expect(ids.size).toBe(map.items.length);
    for (const l of map.links) {
      expect(ids.has(l.from), l.from).toBe(true);
      expect(ids.has(l.to), l.to).toBe(true);
      expect(l.from).not.toBe(l.to);
    }
    const keys = map.links.map((l) => `${l.from} ${l.to} ${l.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reports every island, the empty ones included, and stages from build-a-project", () => {
    expect(map.islands.map((i) => i.id)).toEqual(DISCIPLINE_ORDER);
    for (const i of map.islands) expect(i.empty).toBe(i.items === 0);
    expect(map.stages.length).toBeGreaterThanOrEqual(10);
    expect(map.stages.every((s) => s.discipline !== null)).toBe(true);
    const hub = map.items.find((i) => i.id === "skill:build-a-project");
    expect(hub?.degree).toBeGreaterThan(20);
  });

  it("holds no absolute paths", () => {
    const text = serializeSystemMap(map);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]{1,2}(Users|home)/);
    expect(text).not.toMatch(/"\/(Users|home)\//);
    for (const i of map.items) expect(i.source.startsWith("/") || /^[A-Za-z]:/.test(i.source)).toBe(false);
  });

  it("is deterministic across two builds", () => {
    expect(serializeSystemMap(again)).toBe(serializeSystemMap(map));
  });
});
