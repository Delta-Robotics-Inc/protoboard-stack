/**
 * The Library view's model (PB-857) and its libraries (PB-858), without VS
 * Code: the category drill-down, result rows with what the project uses,
 * the preview of a revision, the personal libraries setting, the CLI's
 * arguments, merged search over stand-in libraries with one cursor, and the
 * pages' Content-Security-Policy.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { PartRevisionEnvelope, PartSummary, SearchQuery, SearchResult, TaxonomyResult, TaxonomyTreeNode } from "@protoboardai/cloud/client";
import { decodeLibrariesCursor, libraryTaxonomy, searchLibraries, type MergedTaxonomyNode, type SearchableLibrary } from "@protoboardai/core/library-client";
import { addArgs, cliEnv, personalSetting, readUsage, updateArgs } from "../src/libraryData.js";
import { bodyGlb, documents, drillDown, facetOptions, interfaceRows, itemModel, keyFacts, parseLibraryQuery, previewModel } from "../src/libraryModel.js";

const TMP = mkdtempSync(join(tmpdir(), "pb-library-test-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const node = (path: string, count: number, children: TaxonomyTreeNode[] = [], name?: string): TaxonomyTreeNode => ({ id: path.split(".").pop()!, path, name: name ?? path, source: "uhd", count, children });

const TREE: MergedTaxonomyNode[] = [
  node("actuator", 5, [node("actuator.motor", 4, [node("actuator.motor.brushless", 3, [], "Brushless"), node("actuator.motor.stepper", 0, [], "Stepper")], "Motors"), node("actuator.haptic", 1, [], "Haptics")], "Actuators"),
  node("sensor", 2, [node("sensor.motion", 2, [], "Motion")], "Sensors"),
  node("power", 0, [], "Power"),
];

describe("the category drill-down", () => {
  it("at the top: every root with parts, and All categories", () => {
    const d = drillDown(TREE, "");
    expect(d.crumbs).toEqual([{ path: "", name: "All categories" }]);
    expect(d.all).toEqual({ path: "", name: "All categories", count: 7 });
    expect(d.rows.map((r) => [r.path, r.count, r.more])).toEqual([
      ["actuator", 5, true],
      ["sensor", 2, true],
    ]);
    expect(drillDown(TREE, "", { total: 9 }).all.count).toBe(9);
  });

  it("one level at a time, with a breadcrumb and All in …", () => {
    const d = drillDown(TREE, "actuator.motor");
    expect(d.crumbs.map((c) => c.name)).toEqual(["All categories", "Actuators", "Motors"]);
    expect(d.all).toEqual({ path: "actuator.motor", name: "Motors", count: 4 });
    expect(d.rows.map((r) => [r.name, r.count, r.more])).toEqual([["Brushless", 3, false]]); // empty Stepper left out
    expect(d.level).toEqual(d.all);
  });

  it("a category with nothing below it stays listed among its siblings (PB-934)", () => {
    const leaf = drillDown(TREE, "actuator.motor.brushless");
    expect(leaf.crumbs.map((c) => c.name)).toEqual(["All categories", "Actuators", "Motors", "Brushless"]);
    // the results are the leaf's; the list stays on its parent's level, the leaf one of its rows
    expect(leaf.all).toEqual({ path: "actuator.motor.brushless", name: "Brushless", count: 3 });
    expect(leaf.level).toEqual({ path: "actuator.motor", name: "Motors", count: 4 });
    expect(leaf.rows.map((r) => r.path)).toEqual(["actuator.motor.brushless"]);
    // the top level's rows are the roots, each saying whether it drills in
    expect(drillDown(TREE, "").level).toEqual({ path: "", name: "All categories", count: 7 });
  });

  it("a path no taxonomy lists, and facet paths the taxonomy lacks", () => {
    const d = drillDown(TREE, "x-acme.widgets", { facets: { "x-acme.widgets": 2, "x-acme.widgets.blue": 1 } });
    expect(d.unknown).toBe(true);
    expect(d.crumbs.map((c) => c.name)).toEqual(["All categories", "X-acme", "Widgets"]);
    expect(d.all.count).toBe(2);
    expect(d.rows).toEqual([{ path: "x-acme.widgets.blue", name: "Blue", count: 1, more: false }]);
    // at the top, a library's own root shows next to the standard ones
    expect(drillDown(TREE, "", { facets: { "x-acme": 2, "x-acme.widgets": 2 } }).rows.map((r) => r.path)).toEqual(["actuator", "sensor", "x-acme"]);
  });

  it("the query is read defensively", () => {
    expect(parseLibraryQuery({ text: "motor", category: 3, domain: "electrical" })).toEqual({ text: "motor", category: "", domain: "electrical", protocol: "", sort: "relevance" });
    // an order the libraries do not take is not kept
    expect(parseLibraryQuery({ sort: "manufacturer" }).sort).toBe("manufacturer");
    expect(parseLibraryQuery({ sort: "price" }).sort).toBe("relevance");
  });
});

const hit = (partId: string, library: string, extra: Partial<PartSummary> = {}) => ({
  partId,
  name: partId.toUpperCase(),
  manufacturer: "Acme",
  partNumber: `MPN-${partId}`,
  categories: ["sensor.motion"],
  tags: [],
  protocols: ["i2c"],
  domains: ["electrical"],
  latestRevision: 3,
  recommendedRevision: 2,
  library,
  ...extra,
});

describe("result rows", () => {
  const usage = new Map([
    ["imu", { revision: 1, library: "protoboard", tier: "catalog", file: "parts/catalog/imu.json" }],
    ["baro", { revision: 2, library: "protoboard" }],
    ["gps", { revision: 1, library: "acme" }],
  ]);
  it("say whether the project uses the part, at which revision, and when a newer one exists", () => {
    expect(itemModel(hit("imu", "protoboard"), usage)).toMatchObject({ key: "protoboard/imu", revision: 2, latest: 3, mpn: "MPN-imu", used: { revision: 1, library: "protoboard", elsewhere: false }, update: 2 });
    expect(itemModel(hit("baro", "protoboard"), usage)).toMatchObject({ used: { revision: 2 } });
    expect(itemModel(hit("baro", "protoboard"), usage).update).toBeUndefined();
    // the project has it from another library: no update offered from this one
    const other = itemModel(hit("gps", "protoboard"), usage);
    expect(other.used).toMatchObject({ elsewhere: true, library: "acme" });
    expect(other.update).toBeUndefined();
    expect(itemModel(hit("new", "protoboard", { recommendedRevision: undefined, deprecated: { reason: "x", at: "" } }), usage)).toMatchObject({ revision: 3, deprecated: true });
    expect(itemModel(hit("new", "protoboard"), usage).used).toBeUndefined();
  });

  it("facet options: the most common first, the chosen one kept", () => {
    expect(facetOptions({ i2c: 3, spi: 5, uart: 0 })).toEqual([
      { value: "spi", count: 5 },
      { value: "i2c", count: 3 },
    ]);
    expect(facetOptions({ i2c: 3 }, "can")[0]).toEqual({ value: "can", count: 0 });
  });
});

const ENVELOPE = {
  schema: "uhd.part-revision/v1",
  partId: "imu",
  revision: 2,
  uhdSchema: "0.2.0",
  digest: "sha256:x",
  definitionDigest: "sha256:y",
  createdAt: "2026-10-01T00:00:00Z",
  publisher: "protoboard",
  derivedFrom: null,
  source: {},
  dependencies: [{ partId: "screw", revision: 1 }],
  evidence: [{ kind: "sources", title: "Sources" }],
  missingArtifacts: [],
  artifacts: [
    { artifactId: "if_glb", role: "interface", mediaType: "model/gltf-binary", path: "cad/if.glb", sha256: "a".repeat(64), size: 10 },
    { artifactId: "body_glb", role: "body", mediaType: "model/gltf-binary", path: "cad/body.glb", sha256: "b".repeat(64), size: 20 },
  ],
  definition: {
    id: "imu",
    name: "IMU board",
    version: "1.2",
    description: "Six axes",
    domains: [
      { domain: "mechanical", dimensions_mm: { length: 20, width: 15, height: 3 }, metadata: { mounting_method: "through_hole" } },
      { domain: "electrical", metadata: { supply_voltage_V: [1.8, 3.6], package_type: "LGA-14", pin_count: 14 } },
      { domain: "thermal", operating_temperature_C: [-40, 85] },
    ],
    interfaces: [
      { id: "vin", name: "VIN", domain: "electrical", protocols: [{ type: "power", roles: ["sink"] }] },
      { id: "i2c", name: "I2C", domain: "electrical", protocols: [{ type: "i2c", roles: ["target"] }] },
    ],
    artifacts: [
      { id: "ds", name: "IMU datasheet", type: "datasheet", url: "https://example.test/imu.pdf" },
      { id: "page", name: "Product page", type: "documentation", url: "https://example.test/imu" },
      { id: "local", name: "Local file", type: "documentation", filePath: "x.pdf" },
      { id: "js", name: "Bad", type: "documentation", url: "javascript:alert(1)" },
    ],
  },
} as unknown as PartRevisionEnvelope;

describe("the preview", () => {
  const part = hit("imu", "protoboard", { recommendedRevision: 2, latestRevision: 3 }) as PartSummary;
  const revisions = [1, 2, 3].map((revision) => ({ partId: "imu", revision, digest: "", definitionDigest: "", uhdSchema: "0.2.0", createdAt: "2026-10-01T00:00:00Z", publisher: "protoboard", ...(revision === 3 ? { deprecated: { reason: "wrong pinout", at: "" } } : {}) }));
  const lib = { id: "protoboard", url: "http://127.0.0.1:8791" };

  it("key facts, interfaces, documents and the body GLB from the revision", () => {
    expect(keyFacts(ENVELOPE.definition as never)).toEqual([
      { label: "Size", value: "20 × 15 × 3 mm" },
      { label: "Supply", value: "1.8 to 3.6 V" },
      { label: "Package", value: "LGA-14" },
      { label: "Pins", value: "14" },
      { label: "Mounting", value: "through hole" },
      { label: "Operating temperature", value: "-40 to 85 °C" },
      { label: "Definition version", value: "1.2" },
    ]);
    expect(interfaceRows(ENVELOPE.definition as never).rows.map((r) => [r.name, r.protocols])).toEqual([
      ["VIN", "power (sink)"],
      ["I2C", "i2c (target)"],
    ]);
    // only http(s) links; the datasheet apart
    expect(documents(ENVELOPE.definition as never)).toEqual({ datasheet: { label: "IMU datasheet", url: "https://example.test/imu.pdf" }, links: [{ label: "Product page", url: "https://example.test/imu" }] });
    expect(bodyGlb(ENVELOPE)).toEqual({ sha256: "b".repeat(64), size: 20, path: "cad/body.glb" });
  });

  it("many pins fold by protocol", () => {
    const pins = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, domain: "electrical", protocols: [{ type: i < 15 ? "digital" : "power" }] }));
    const r = interfaceRows({ interfaces: pins });
    expect(r.count).toBe(20);
    expect(r.rows.map((x) => [x.name, x.count])).toEqual([
      ["15 interfaces", 15],
      ["5 interfaces", 5],
    ]);
  });

  it("the main action follows what the project pins", () => {
    const action = (usage?: { revision?: number; library?: string }, revision = 2) => previewModel({ part, revisions, envelope: { ...ENVELOPE, revision } as PartRevisionEnvelope, library: lib, ...(usage ? { usage } : {}) }).action;
    expect(action()).toEqual({ kind: "add", revision: 2 });
    expect(action({ revision: 1, library: "protoboard" })).toEqual({ kind: "update", revision: 2 });
    expect(action({ revision: 2, library: "protoboard" })).toEqual({ kind: "pinned", revision: 2 });
    expect(action({ revision: 2, library: "protoboard" }, 1)).toEqual({ kind: "switch", revision: 1 });
    expect(action({ revision: 1, library: "acme" })).toEqual({ kind: "elsewhere", revision: 2 });
    const m = previewModel({ part, revisions, envelope: ENVELOPE, library: lib, usage: { revision: 1, library: "protoboard" }, categoryName: (p) => (p === "sensor.motion" ? "Motion" : undefined) });
    expect(m.revisions.map((r) => [r.revision, r.recommended, r.current, r.pinned, r.deprecated ?? null])).toEqual([
      [3, false, false, false, "wrong pinout"],
      [2, true, true, false, null],
      [1, false, false, true, null],
    ]);
    expect(m.categories).toEqual([{ path: "sensor.motion", name: "Motion" }]);
    // revisions are written "v1" in every view (beta test 1, D2)
    expect(m.dependencies).toEqual(["screw v1"]);
    expect(m.name).toBe("IMU board");
  });
});

describe("libraries", () => {
  it("personal libraries from the setting: valid ones kept, the others explained, never a credential", () => {
    const r = personalSetting([
      { id: "mine", url: "https://parts.me.test/", authEnv: "PROTOBOARD_MY_TOKEN" },
      { id: "Bad Id", url: "https://x.test" },
      { id: "creds", url: "https://u:p@x.test" },
      { id: "tok", url: "https://x.test", authEnv: "sk-live-123" },
      { id: "nourl" },
      { id: "mine", url: "https://again.test" },
    ]);
    expect(r.libraries).toEqual([{ id: "mine", url: "https://parts.me.test", authEnv: "PROTOBOARD_MY_TOKEN" }]);
    expect(r.problems).toHaveLength(5);
    expect(r.problems.join("\n")).toMatch(/must not carry credentials/);
    expect(r.problems.join("\n")).toMatch(/must name an environment variable/);
    expect(r.problems.join("\n")).toMatch(/nourl.*needs a url/);
    expect(r.problems.join("\n")).toMatch(/"mine"\) is listed twice/);
    expect(personalSetting(undefined)).toEqual({ libraries: [], problems: [] });
    expect(personalSetting("x").problems).toHaveLength(1);
  });

  it("reach the CLI as PROTOBOARD_USER_LIBRARIES (names of variables only)", () => {
    const env = cliEnv([{ id: "mine", url: "https://parts.me.test", authEnv: "PROTOBOARD_MY_TOKEN" }], { PATH: "/bin", PROTOBOARD_USER_LIBRARIES: "stale" });
    expect(JSON.parse(env.PROTOBOARD_USER_LIBRARIES!)).toEqual([{ id: "mine", url: "https://parts.me.test", authEnv: "PROTOBOARD_MY_TOKEN" }]);
    expect(env.PATH).toBe("/bin");
    expect(cliEnv([], { PROTOBOARD_USER_LIBRARIES: "stale" }).PROTOBOARD_USER_LIBRARIES).toBeUndefined();
  });

  it("the Library's actions are the CLI's commands", () => {
    expect(addArgs("imu", 2, "acme")).toEqual(["parts", "add", "imu@2", "--library", "acme", "--format", "json"]);
    expect(updateArgs("imu", 3, "protoboard")).toEqual(["parts", "update", "imu", "--to", "3", "--library", "protoboard", "--format", "json"]);
  });

  it("what the project uses comes from origins.json", () => {
    const root = join(TMP, "p");
    mkdirSync(join(root, "parts"), { recursive: true });
    writeFileSync(
      join(root, "parts", "origins.json"),
      JSON.stringify({
        schema: "protoboard.origins/v0",
        definitions: {
          imu: { revision: 2, provider: "protoboard-cloud", tier: "catalog", file: "parts/catalog/imu.json" },
          nut: { revision: 1, library: "acme", provider: "uhd-library" },
          led: { tier: "project-researched", provider: "local" },
        },
      }),
    );
    const u = readUsage(root, "parts/origins.json");
    expect(u.get("imu")).toEqual({ revision: 2, library: "protoboard", tier: "catalog", file: "parts/catalog/imu.json" });
    expect(u.get("nut")).toEqual({ revision: 1, library: "acme" });
    expect(u.get("led")).toEqual({ tier: "project-researched" });
    expect(readUsage(join(TMP, "none"), "parts/origins.json").size).toBe(0);
  });
});

/** A stand-in library: `n` parts named <prefix>-<i>, paged by an index cursor. */
function standIn(id: string, n: number, prefix = id): SearchableLibrary & { calls: SearchQuery[] } {
  const calls: SearchQuery[] = [];
  const parts = Array.from({ length: n }, (_, i) => hit(`${prefix}-${String(i).padStart(2, "0")}`, id) as PartSummary);
  return {
    id,
    url: `http://${id}.test`,
    calls,
    client: {
      search: async (q: SearchQuery = {}): Promise<SearchResult> => {
        calls.push(q);
        const from = q.cursor ? Number(q.cursor) : 0;
        const limit = q.limit ?? 50;
        const page = parts.slice(from, from + limit);
        return { total: n, parts: page, nextCursor: from + limit < n ? String(from + limit) : null, ...(q.facets ? { facets: { taxonomy: { sensor: n }, domain: { electrical: n }, protocol: { i2c: n }, tag: {}, categories: {} } } : {}) };
      },
      getTaxonomy: async (): Promise<TaxonomyResult> => ({
        taxonomy: { id: "uhd", version: "1.0.0", extensions: [], setAt: "" },
        total: n,
        uncategorised: 0,
        nodes: [node("sensor", n, [node("sensor.motion", n, [], "Motion")], "Sensors")],
        unknown: [],
      }),
    },
  };
}

describe("search over several libraries", () => {
  it("one cursor pages every library until each is done; facets and taxonomy counts add up", async () => {
    const a = standIn("a", 5);
    const b = standIn("b", 2, "a"); // the same ids as a's first two
    const first = await searchLibraries([a, b], { limit: 2, facets: true });
    expect(first.total).toBe(7);
    expect(first.facets?.domain).toEqual({ electrical: 7 });
    expect(first.parts.map((x) => `${x.library}/${x.partId}${x.shadowedBy ? `<${x.shadowedBy}` : ""}`)).toEqual(["a/a-00", "b/a-00<a", "a/a-01", "b/a-01<a"]);
    expect(decodeLibrariesCursor(first.nextCursor!)).toEqual({ a: "2" });
    const second = await searchLibraries([a, b], { limit: 2, cursor: first.nextCursor });
    expect(b.calls).toHaveLength(1); // b is done: not asked again
    expect(second.parts.map((x) => x.partId)).toEqual(["a-02", "a-03"]);
    const third = await searchLibraries([a, b], { limit: 2, cursor: second.nextCursor });
    expect(third.parts.map((x) => x.partId)).toEqual(["a-04"]);
    expect(third.nextCursor).toBeNull();
    const tax = await libraryTaxonomy([a, b]);
    expect(tax.nodes[0]).toMatchObject({ path: "sensor", count: 7, children: [{ path: "sensor.motion", count: 7, name: "Motion" }] });
    expect(tax.libraries.map((l) => l.taxonomy?.version)).toEqual(["1.0.0", "1.0.0"]);
  });
});
