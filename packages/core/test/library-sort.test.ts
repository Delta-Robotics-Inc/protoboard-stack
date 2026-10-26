/**
 * The order of a search, relevance, prices by source and the owners' view
 * of usage, through core's library client (PB-936). The libraries are the
 * real parts service; a library that does not sort is a stand-in client.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PartSummary, PublicOffer, SearchQuery, UhdModuleDef } from "@protoboardai/cloud/client";
import { LIBRARY_SORTS, connectLibrary, isLibrarySort, partPrices, pricesBySource, searchLibraries, type SearchableLibrary } from "../src/library-client.js";
import { libraryUsage } from "../src/parts.js";
import { Blobs, TOKEN, draft, startLibrary, type CloudService } from "./cloud.js";

const power = { id: "vin", name: "VIN", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["sink"] }] };
const part = (id: string, name: string, extra: Partial<UhdModuleDef> = {}): UhdModuleDef => ({ id, name, interfaces: [power], ...extra });

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-library-sort");
const CLI = join(HERE, "../../cli/bin/protoboard.mjs");
/** The CLI in a fresh process, in a small project, with only the environment given. */
const pb = (args: string[], env: Record<string, string> = {}) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_")));
    const child = spawn(process.execPath, [CLI, ...args, "--cwd", TMP], { env: { ...clean, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
    child.once("error", reject);
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
/** Publishes land a moment apart, so "newest first" has one answer. */
const tick = () => new Promise((r) => setTimeout(r, 5));

let main: CloudService;
let other: CloudService;
const lib = (svc: CloudService, id: string, env: NodeJS.ProcessEnv = {}) => connectLibrary({ id, url: svc.url }, { env });
const ids = (parts: { partId: string; library: string }[]) => parts.map((p) => `${p.library}/${p.partId}`);

beforeAll(async () => {
  main = await startLibrary();
  other = await startLibrary();
  const blobs = new Blobs();
  await main.client.publish(draft(blobs, part("dev-board", "Zed Dev Board", { manufacturer: "Zed" })), blobs.source);
  await tick();
  await main.client.publish(draft(blobs, part("air-sensor", "Air Sensor", { manufacturer: "Acme" })), blobs.source);
  await tick();
  await main.client.publish(draft(blobs, part("m3-screw", "M3 screw")), blobs.source);
  await other.client.publish(draft(blobs, part("clip", "Clip", { manufacturer: "Beta" })), blobs.source);
  await tick();
  await other.client.publish(draft(blobs, part("widget", "Widget", { manufacturer: "Acme" })), blobs.source);
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, "src"), { recursive: true });
  writeFileSync(join(TMP, "protoboard.config.ts"), `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
  writeFileSync(join(TMP, "src/sys.uhd.ts"), `export const SYS = { id: "sys", name: "System", interfaces: [] };\n`);
  await main.client.setSeeds({ "dev-board": { seed: 100, reason: "boards: start here" }, "m3-screw": { seed: 20, reason: "hardware: common" } });
});
afterAll(async () => {
  await main?.stop();
  await other?.stop();
  rmSync(TMP, { recursive: true, force: true });
});

describe("search order across libraries", () => {
  it("knows the four orders", () => {
    expect([...LIBRARY_SORTS]).toEqual(["relevance", "name", "manufacturer", "updated"]);
    expect(isLibrarySort("updated")).toBe(true);
    expect(isLibrarySort("price")).toBe(false);
  });

  it("without sort, a library that ranks answers by relevance, and each hit carries the value", async () => {
    const r = await searchLibraries(lib(main, "protoboard"));
    expect(ids(r.parts)).toEqual(["protoboard/dev-board", "protoboard/m3-screw", "protoboard/air-sensor"]);
    expect(r.parts.map((p) => p.relevance)).toEqual([100, 20, 0]);
    expect(r.sort).toBeUndefined();
    expect(r.libraries[0]).not.toHaveProperty("sorted");
  });

  it("passes sort to the libraries that declare it, and merges their pages by it", async () => {
    const libs = [lib(main, "protoboard"), lib(other, "other")];
    const byName = await searchLibraries(libs, { sort: "name" });
    expect(byName.sort).toBe("name");
    expect(byName.libraries.map((l) => [l.id, l.sorted])).toEqual([["protoboard", true], ["other", true]]);
    expect(ids(byName.parts)).toEqual(["protoboard/air-sensor", "other/clip", "protoboard/m3-screw", "other/widget", "protoboard/dev-board"]);
    // by manufacturer: Acme (two libraries), Beta, Zed, then the part without one
    expect(ids((await searchLibraries(libs, { sort: "manufacturer" })).parts)).toEqual(["protoboard/air-sensor", "other/widget", "other/clip", "protoboard/dev-board", "protoboard/m3-screw"]);
    // relevance and updated are each library's own ranking: its page in its order, the libraries one after another
    expect(ids((await searchLibraries(libs, { sort: "relevance" })).parts)).toEqual(["protoboard/dev-board", "protoboard/m3-screw", "protoboard/air-sensor", "other/clip", "other/widget"]);
    expect(ids((await searchLibraries(libs, { sort: "updated" })).parts)).toEqual(["protoboard/m3-screw", "protoboard/air-sensor", "protoboard/dev-board", "other/widget", "other/clip"]);
    await expect(searchLibraries(libs, { sort: "price" as never })).rejects.toThrow(/sort is one of relevance, name, manufacturer, updated; not "price"/);
  });

  it("pages a sorted search with one cursor: every part once, in order", async () => {
    const libs = [lib(main, "protoboard")];
    const seen: string[] = [];
    let cursor: string | null | undefined;
    do {
      const r = await searchLibraries(libs, { sort: "name", limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...r.parts.map((p) => p.partId));
      cursor = r.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["air-sensor", "m3-screw", "dev-board"]);
  });

  it("does not send sort to a library that does not declare it: its own order, and the result says so", async () => {
    const queries: SearchQuery[] = [];
    const summary = (partId: string, name: string): PartSummary => ({ partId, name, categories: [], tags: [], protocols: [], domains: [], latestRevision: 1 });
    // a uhd-library/v1 library without the x-sort extension: by part id, and it would refuse a parameter it does not know
    const plain: SearchableLibrary = {
      id: "plain",
      url: "http://plain.test",
      client: {
        search: async (q = {}) => {
          queries.push(q);
          if ("sort" in q) throw new Error("this library was sent sort");
          return { total: 2, parts: [summary("a-part", "Zulu"), summary("b-part", "Alpha")], nextCursor: null };
        },
        getTaxonomy: async () => {
          throw new Error("not asked");
        },
        sorts: async () => ({ values: [] }),
      },
    };
    const r = await searchLibraries([plain, lib(main, "protoboard")], { sort: "updated" });
    expect(queries).toEqual([{}]);
    expect(r.libraries.map((l) => [l.id, l.sorted])).toEqual([["plain", false], ["protoboard", true]]);
    expect(ids(r.parts)).toEqual(["plain/a-part", "plain/b-part", "protoboard/m3-screw", "protoboard/air-sensor", "protoboard/dev-board"]);
    // a client from before sorting (no `sorts`) is treated the same; with no library that ranks, the merge is by part id as it always was
    const old: SearchableLibrary = { ...plain, id: "old", client: { search: plain.client.search, getTaxonomy: plain.client.getTaxonomy } };
    const two = await searchLibraries([{ ...old, id: "second" }, old], { sort: "name" });
    expect(two.libraries.map((l) => l.sorted)).toEqual([false, false]);
    expect(ids(two.parts)).toEqual(["second/b-part", "old/b-part", "second/a-part", "old/a-part"]);
    expect(ids((await searchLibraries([{ ...old, id: "second" }, old])).parts)).toEqual(["second/a-part", "old/a-part", "second/b-part", "old/b-part"]);
  });
});

describe("prices by source", () => {
  const offer = (o: Partial<PublicOffer> & Pick<PublicOffer, "supplier" | "observedAt">): PublicOffer => ({ partId: "air-sensor", mpn: "AS-1", ...o });

  it("groups a part's offers by supplier, the newest observation of each listing, the cheapest current source first", () => {
    const r = pricesBySource("air-sensor", [
      offer({ id: 1, supplier: "Mouser", sku: "M-1", unitPrice: 2.4, currency: "USD", observedAt: "2026-09-01T00:00:00Z", authorized: true }),
      offer({ id: 2, supplier: "Mouser", sku: "M-1", unitPrice: 2.1, currency: "USD", priceBreaks: [{ quantity: 1, unitPrice: 2.1 }, { quantity: 100, unitPrice: 1.7 }], stock: 40, observedAt: "2026-10-01T00:00:00Z", authorized: true }),
      offer({ id: 3, supplier: "DigiKey", sku: "D-9", unitPrice: 1.9, currency: "USD", packaging: "Cut Tape", minQuantity: 1, observedAt: "2026-10-02T00:00:00Z", url: "https://digikey.example/D-9" }),
      offer({ id: 4, supplier: "Old Shop", unitPrice: 0.5, currency: "USD", observedAt: "2024-01-01T00:00:00Z", stale: true }),
      offer({ id: 5, supplier: "Amazon", observedAt: "2026-10-03T00:00:00Z", url: "https://amazon.example/x" }),
    ]);
    expect(r.offers).toBe(5);
    expect(r.sources.map((s) => [s.supplier, s.from?.unitPrice, s.offers.length])).toEqual([
      ["DigiKey", 1.9, 1],
      ["Mouser", 2.1, 1],
      ["Amazon", undefined, 1],
      ["Old Shop", undefined, 1],
    ]);
    expect(r.sources[1]).toMatchObject({ supplier: "Mouser", authorized: true, observedAt: "2026-10-01T00:00:00Z", from: { unitPrice: 2.1, currency: "USD" } });
    expect(r.sources[1].offers[0]).toEqual({ mpn: "AS-1", sku: "M-1", unitPrice: 2.1, currency: "USD", priceBreaks: [{ quantity: 1, unitPrice: 2.1 }, { quantity: 100, unitPrice: 1.7 }], stock: 40, observedAt: "2026-10-01T00:00:00Z", authorized: true });
  });

  it("reads them from the library: the result of pricing, with nothing about how it was fetched", async () => {
    await main.client.addOffer("air-sensor", { mpn: "AS-1", supplier: "DigiKey", sku: "D-9", url: "https://digikey.example/D-9", unitPrice: 1.9, currency: "USD", stock: 12, minQuantity: 1, packaging: "Cut Tape", observedAt: "2026-10-02T00:00:00Z", source: "public API read (no login): https://digikey.example/api/search", note: "read through the product search API" });
    const r = await partPrices(lib(main, "protoboard"), "air-sensor");
    expect(r).toEqual({
      partId: "air-sensor",
      offers: 1,
      sources: [{ supplier: "DigiKey", from: { unitPrice: 1.9, currency: "USD" }, observedAt: "2026-10-02T00:00:00Z", offers: [{ mpn: "AS-1", sku: "D-9", url: "https://digikey.example/D-9", unitPrice: 1.9, currency: "USD", stock: 12, minQuantity: 1, packaging: "Cut Tape", observedAt: "2026-10-02T00:00:00Z" }] }],
    });
    expect(JSON.stringify(r)).not.toMatch(/source"|note|API read|search API/);
    expect((await partPrices(lib(main, "protoboard"), "air-sensor", { mpn: "other" })).sources).toEqual([]);
    await expect(partPrices(lib(main, "protoboard"), "no-such-part")).rejects.toThrow(/no-such-part: not in the catalog/);
  });

  it("says why there are none instead of failing: signed out, or a library without prices", async () => {
    const refusing = { id: "protoboard", url: "https://parts.test", client: { listOffers: async () => { throw new (await import("@protoboardai/cloud/client")).CloudError(401, "AUTH_REQUIRED", "pricing needs a signed-in Protoboard account: run `protoboard login` (browsing the library stays open)"); } } };
    const r = await partPrices(refusing, "air-sensor");
    expect(r.sources).toEqual([]);
    expect(r.unavailable).toMatchObject({ code: "AUTH_REQUIRED", message: expect.stringMatching(/Sign in first: `protoboard login`/) });
    const none = { id: "acme", url: "https://acme.test", client: { listOffers: async () => { throw new (await import("@protoboardai/cloud/client")).CloudError(404, "NOT_FOUND", "no route GET /v1/parts/x/offers"); } } };
    expect((await partPrices(none, "x")).unavailable).toEqual({ code: "NO_PRICES", message: "library acme has no price service" });
  });
});

describe("the owners' view of usage", () => {
  it("is refused to anyone but a publisher, with what to do", async () => {
    await expect(libraryUsage(lib(main, "protoboard"))).rejects.toThrow(/the usage of http:\/\/127\.0\.0\.1:\d+ is for the library's publishers \(AUTH_REQUIRED: .*\)\. Sign in with a publisher account \(`protoboard login`\) or set PROTOBOARD_CLOUD_TOKEN\./);
    await expect(libraryUsage(lib(main, "protoboard", { PROTOBOARD_CLOUD_TOKEN: "wrong" }))).rejects.toThrow(/for the library's publishers/);
  });

  it("gives a publisher the most downloaded parts over a period, as counts", async () => {
    // a service on this machine gets the service token only when it is listed (PB-1048)
    const publisher = lib(main, "protoboard", { PROTOBOARD_CLOUD_TOKEN: TOKEN, PROTOBOARD_CLOUD_TOKEN_ORIGINS: main.url });
    // downloads by nobody in particular (this service signs nobody in): downloads, no adds
    const anyone = lib(main, "protoboard");
    await anyone.client.getRevision("dev-board", 1);
    await anyone.client.getRevision("dev-board", 1);
    await anyone.client.getRevision("m3-screw", 1);
    const r = await libraryUsage(publisher, { days: 7 });
    expect(r.days).toBe(7);
    expect(r.totals).toEqual({ downloads: 3, adds: 0, parts: 2 });
    expect(r.parts.map((p) => [p.partId, p.name, p.downloads, p.adds, p.seed, p.relevance])).toEqual([
      ["dev-board", "Zed Dev Board", 2, 0, 100, 100],
      ["m3-screw", "M3 screw", 1, 0, 20, 20],
    ]);
    expect((await libraryUsage(publisher, { days: 7, limit: 1 })).parts).toHaveLength(1);
  });
});

describe("the CLI", () => {
  const env = () => ({ PROTOBOARD_CLOUD_URL: main.url });

  it("parts search --sort orders the results; --format json carries each part's relevance", async () => {
    const byName = await pb(["parts", "search", "--sort", "name", "--format", "json"], env());
    expect(byName.stderr).toBe("");
    const r = JSON.parse(byName.stdout);
    expect(r.sort).toBe("name");
    expect(r.parts.map((p: { partId: string; relevance: number }) => [p.partId, p.relevance])).toEqual([["air-sensor", 0], ["m3-screw", 20], ["dev-board", 100]]);
    expect(r.libraries[0].sorted).toBe(true);
    const plain = JSON.parse((await pb(["parts", "search", "--format", "json"], env())).stdout);
    expect(plain.parts.map((p: { partId: string }) => p.partId)).toEqual(["dev-board", "m3-screw", "air-sensor"]);
    expect(plain).not.toHaveProperty("sort");
    const paged = await pb(["parts", "search", "--sort", "updated", "--limit", "2"], env());
    expect(paged.stdout).toMatch(/^3 part\(s\) at .* \(showing 2\)\n.*m3-screw@1.*\n.*air-sensor@1.*\n  more: --cursor \S+ --sort updated\n$/);
    expect(await pb(["parts", "search", "--sort", "price"], env())).toMatchObject({ status: 2, stderr: expect.stringMatching(/--sort takes relevance, name, manufacturer, updated; not "price"/) });
  });

  it("parts prices shows a part's prices by source", async () => {
    const r = await pb(["parts", "prices", "air-sensor"], env());
    expect(r.stdout).toMatch(/^air-sensor: 1 source\(s\), 1 offer\(s\) at .*\n  DigiKey  from USD 1\.9\n    AS-1  sku D-9  1\+ USD 1\.9  12 in stock  Cut Tape  min 1  observed 2026-10-02\n      https:\/\/digikey\.example\/D-9\n$/);
    expect(r.stdout).not.toMatch(/API read|search API/);
    expect(JSON.parse((await pb(["parts", "prices", "air-sensor", "--format", "json"], env())).stdout).sources[0].supplier).toBe("DigiKey");
  });

  it("parts usage is the publishers'; the help users read does not list it", async () => {
    expect(await pb(["parts", "usage"], env())).toMatchObject({ status: 2, stderr: expect.stringMatching(/is for the library's publishers/) });
    const r = await pb(["parts", "usage", "--days", "7"], { ...env(), PROTOBOARD_CLOUD_TOKEN: TOKEN, PROTOBOARD_CLOUD_TOKEN_ORIGINS: main.url });
    expect(r.stderr).toBe("");
    expect(r.stdout).toMatch(/\(7 day\(s\)\): 0 add\(s\) of 2 part\(s\), 3 download\(s\)\n  part +adds  downloads  as dependency  seed  relevance\n  dev-board +0 +2 +0 +100 +100\n  m3-screw +0 +1 +0 +20 +20\n/);
    expect(r.stdout).toMatch(/Counts only: the library does not keep who\./);
    const help = await pb(["--help"], env());
    expect(help.stdout).toMatch(/parts prices <id>/);
    expect(help.stdout).not.toMatch(/parts usage/);
  });
});
