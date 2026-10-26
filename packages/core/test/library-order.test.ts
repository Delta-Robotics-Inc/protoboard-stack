/**
 * The order of a library search as the views read it (beta test 1, F14):
 * `sort` goes to the libraries that say they sort (capability `x-sort` in
 * the discovery document) and their order is kept; one that does not is
 * merged by part id as before, for the views to order locally. `sorts` and
 * `sorted` tell a view which is the case. The same against the real parts
 * service, and the CLI: library-sort.test.ts.
 */
import { describe, expect, it } from "vitest";
import { LIBRARY_SORTS, compareHits, isLibrarySort, librarySorts, localSorts, searchLibraries, type LibrarySort, type SearchableLibrary } from "../src/library-client.js";

type Part = { partId: string; name: string; manufacturer?: string; relevance?: number };
const summary = (p: Part) => ({ ...p, categories: [], tags: [], protocols: [], domains: [], latestRevision: 1 });

/** A library whose search returns `parts` in the order given, recording the queries it was asked. */
function lib(id: string, parts: Part[], sorts?: readonly LibrarySort[]): SearchableLibrary & { asked: Record<string, unknown>[] } {
  const asked: Record<string, unknown>[] = [];
  return {
    id,
    url: `https://${id}.test`,
    asked,
    ...(sorts ? { sorts: async () => sorts } : {}),
    client: {
      search: async (q: Record<string, unknown> = {}) => {
        asked.push(q);
        return { total: parts.length, parts: parts.map(summary), nextCursor: null };
      },
      getTaxonomy: async () => ({ taxonomy: null, nodes: [], total: 0, unknown: [] }) as never,
    } as never,
  };
}

describe("searching with an order", () => {
  it("sends `sort` to a library that sorts, and keeps its order", async () => {
    const a = lib("a", [{ partId: "z", name: "Zeta", relevance: 80 }, { partId: "b", name: "Beta", relevance: 20 }], LIBRARY_SORTS);
    const r = await searchLibraries([a], { sort: "relevance", limit: 30 });
    expect(a.asked[0]).toMatchObject({ sort: "relevance", limit: 30 });
    expect(r.sorted).toBe("relevance");
    expect(r.sorts).toEqual(["relevance", "name", "manufacturer", "updated"]);
    // the library's order, not the part ids'
    expect(r.parts.map((p) => p.partId)).toEqual(["z", "b"]);
  });

  it("a library that does not say it sorts is merged by part id, and says so", async () => {
    const plain = lib("plain", [{ partId: "z", name: "Zeta" }, { partId: "b", name: "Beta" }]);
    const r = await searchLibraries([plain], { sort: "name" });
    expect(plain.asked[0]).not.toHaveProperty("sort"); // not sent: a library that does not declare the parameter might refuse it
    expect(r.sorted).toBeUndefined();
    expect(r.sorts).toEqual([]);
    expect(r.parts.map((p) => p.partId)).toEqual(["b", "z"]);
    // without an order asked for, a library that sorts answers in its own (its relevance), and that is kept
    const noSort = await searchLibraries([lib("a", [{ partId: "z", name: "Zeta" }, { partId: "b", name: "Beta" }], LIBRARY_SORTS)], {});
    expect(noSort.sorted).toBeUndefined();
    expect(noSort.sorts).toEqual([...LIBRARY_SORTS]);
    expect(noSort.parts.map((p) => p.partId)).toEqual(["z", "b"]);
  });

  it("only an order every library sorts by is theirs: one library that cannot makes it local", async () => {
    const a = lib("a", [{ partId: "z", name: "Zeta" }], LIBRARY_SORTS);
    const b = lib("b", [{ partId: "b", name: "Beta" }], ["name"]);
    expect((await searchLibraries([a, b], { sort: "updated" })).sorted).toBeUndefined();
    expect((await searchLibraries([a, b], { sort: "updated" })).sorts).toEqual(["name"]);
    expect((await searchLibraries([a, lib("c", [])], { sort: "name" })).sorts).toEqual([]);
  });

  it("merges several sorted libraries by name or manufacturer; a ranking is each library's own", async () => {
    const a = lib("a", [{ partId: "a1", name: "Alpha" }, { partId: "a2", name: "Mid" }, { partId: "a3", name: "Zulu" }], LIBRARY_SORTS);
    const b = lib("b", [{ partId: "b1", name: "Beta" }, { partId: "b2", name: "Yak" }], LIBRARY_SORTS);
    expect((await searchLibraries([a, b], { sort: "name" })).parts.map((p) => p.name)).toEqual(["Alpha", "Beta", "Mid", "Yak", "Zulu"]);
    const ra = lib("a", [{ partId: "a1", name: "A", relevance: 90 }, { partId: "a2", name: "B", relevance: 10 }], LIBRARY_SORTS);
    const rb = lib("b", [{ partId: "b1", name: "C", relevance: 50 }, { partId: "b2", name: "D", relevance: 0 }], LIBRARY_SORTS);
    // relevance is a library's own measure and a summary has no date: each library's page in its order, the libraries one after another
    expect((await searchLibraries([ra, rb], { sort: "relevance" })).parts.map((p) => p.partId)).toEqual(["a1", "a2", "b1", "b2"]);
    expect((await searchLibraries([a, b], { sort: "updated" })).parts.map((p) => p.partId)).toEqual(["a1", "a2", "a3", "b1", "b2"]);
  });
});

describe("the orders", () => {
  it("compare the way a sorting library orders: by name, by manufacturer (none last), by relevance, ties on the part id", () => {
    const parts = [
      { partId: "c", name: "beta", manufacturer: "Zed" },
      { partId: "a", name: "Beta", manufacturer: "acme" },
      { partId: "b", name: "alpha" },
    ];
    expect([...parts].sort(compareHits("name")!).map((p) => p.partId)).toEqual(["b", "a", "c"]);
    expect([...parts].sort(compareHits("manufacturer")!).map((p) => p.partId)).toEqual(["a", "c", "b"]);
    expect([{ partId: "x", name: "X", relevance: 1 }, { partId: "y", name: "Y", relevance: 5 }, { partId: "w", name: "W" }].sort(compareHits("relevance")!).map((p) => p.partId)).toEqual(["y", "x", "w"]);
    expect(compareHits("updated")).toBeUndefined();
  });

  it("can be made locally by name and manufacturer always, by relevance only when the parts carry one, never by date", () => {
    expect(localSorts([{}, {}])).toEqual(["name", "manufacturer"]);
    expect(localSorts([{ relevance: 0 }])).toEqual(["relevance", "name", "manufacturer"]);
    expect(isLibrarySort("updated")).toBe(true);
    expect(isLibrarySort("price")).toBe(false);
  });
});

describe("what a library sorts by, from its discovery document", () => {
  const discovery = (extra: object) => async () => new Response(JSON.stringify({ protocol: "uhd-library/v1", name: "L", id: "l", version: "1", api: "/v1", capabilities: ["facets"], ...extra }), { status: 200, headers: { "content-type": "application/json" } });
  it("the values it lists with capability x-sort; none without the capability or when it cannot be reached", async () => {
    expect(await librarySorts("https://l.test", { fetch: discovery({ capabilities: ["facets", "x-sort"], sort: { values: ["relevance", "name", "manufacturer", "updated"], default: "relevance" } }) as never })).toEqual(["relevance", "name", "manufacturer", "updated"]);
    expect(await librarySorts("https://l.test", { fetch: discovery({ capabilities: ["x-sort"], sort: { values: ["name", "price"] } }) as never })).toEqual(["name"]);
    // the capability without a list: the four orders of the parameter
    expect(await librarySorts("https://l.test", { fetch: discovery({ capabilities: ["x-sort"] }) as never })).toEqual([...LIBRARY_SORTS]);
    expect(await librarySorts("https://l.test", { fetch: discovery({}) as never })).toEqual([]);
    expect(await librarySorts("https://l.test", { fetch: discovery({ sort: { values: ["name"] } }) as never })).toEqual([]);
    expect(await librarySorts("https://l.test", { fetch: (async () => { throw new Error("offline"); }) as never })).toEqual([]);
    expect(await librarySorts("https://l.test", { fetch: (async () => new Response("no", { status: 404 })) as never })).toEqual([]);
  });
});
