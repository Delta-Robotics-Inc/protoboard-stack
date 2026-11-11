/**
 * The update check's network sources (PB-1168), against stubs: only the two
 * allowed hosts, bodies read as streams and cut at a cap, OSV's batch and
 * details shapes, and the part fetch's streamed size cap (handoffs.md line
 * 44, wave 1 gate).
 */
import { describe, expect, it } from "vitest";
import { fetchPartModel, type Fetcher } from "../src/part-files-fetch.js";
import type { Project } from "../src/project.js";
import { assertAllowed, npmDistTags, osvDetails, osvQueryBatch, osvSeverity, readBodyCapped, type SourceContext, type UpdateFetcher } from "../src/update/sources.js";
import { stubFetcher, VULN_ID } from "./update-fixtures.js";

/** A stream of `chunks` chunks of `size` bytes that counts how many were pulled. */
function countingStream(chunks: number, size: number) {
  const seen = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (seen.pulled >= chunks) return controller.close();
      seen.pulled++;
      controller.enqueue(new Uint8Array(size));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
}

describe("readBodyCapped", () => {
  it("stops reading a stream at the cap and cancels it", async () => {
    const { stream, seen } = countingStream(1000, 1024);
    await expect(readBodyCapped({ body: stream, arrayBuffer: async () => new ArrayBuffer(0) }, 10 * 1024, "x")).rejects.toThrow(/over the 10240-byte limit/);
    expect(seen.pulled).toBeLessThan(20);
    expect(seen.cancelled).toBe(true);
  });

  it("refuses a declared content-length over the cap before reading", async () => {
    let read = false;
    await expect(readBodyCapped({ headers: { get: () => "999999" }, arrayBuffer: async () => ((read = true), new ArrayBuffer(0)) }, 1000)).rejects.toThrow(/999999 bytes/);
    expect(read).toBe(false);
  });

  it("reads a body under the cap, from a stream or a plain stub", async () => {
    expect((await readBodyCapped(new Response("hello"), 100)).toString()).toBe("hello");
    expect((await readBodyCapped({ arrayBuffer: async () => new TextEncoder().encode("hi").buffer as ArrayBuffer }, 100)).toString()).toBe("hi");
  });
});

describe("the sources", () => {
  const ctx = (f = stubFetcher()) => ({ ctx: { fetcher: f.fetcher, userAgent: "protoboard-update-check/test", log: { requests: 0, hosts: new Set<string>() } } satisfies SourceContext, calls: f.calls });

  it("talks only to registry.npmjs.org and api.osv.dev over https", () => {
    expect(() => assertAllowed("https://registry.npmjs.org/-/package/three/dist-tags")).not.toThrow();
    expect(() => assertAllowed("https://api.osv.dev/v1/querybatch")).not.toThrow();
    expect(() => assertAllowed("http://registry.npmjs.org/x")).toThrow(/only/);
    expect(() => assertAllowed("https://registry.npmjs.org.evil.example/x")).toThrow(/only/);
    expect(() => assertAllowed("https://example.com/")).toThrow(/only/);
  });

  it("never follows a redirect off the allowed hosts (wave 4 gate)", async () => {
    const seen: (string | undefined)[] = [];
    const fetcher: UpdateFetcher = async (_url, init) => {
      seen.push(init?.redirect);
      return new Response(JSON.stringify({ latest: "1.0.0" }), { status: 200 });
    };
    await npmDistTags({ fetcher, userAgent: "protoboard-update-check/test" }, ["three"]);
    expect(seen).toEqual(["error"]);
  });

  it("reads dist-tags; a package not on the registry is not-published, not an error", async () => {
    const { ctx: c, calls } = ctx();
    const tags = await npmDistTags(c, ["@protoboardai/core", "@protoboardai/ext-unknown"]);
    expect(tags[0]).toEqual({ name: "@protoboardai/core", tags: { latest: "0.2.3", beta: "0.3.0-beta.1" }, status: "ok" });
    expect(tags[1]).toEqual({ name: "@protoboardai/ext-unknown", status: "not-published" });
    expect(calls.urls[0]).toBe("https://registry.npmjs.org/-/package/@protoboardai%2fcore/dist-tags");
    expect(c.log.hosts).toEqual(new Set(["registry.npmjs.org"]));
  });

  it("sends OSV names and versions only, and reads the ids and the details", async () => {
    const { ctx: c, calls } = ctx();
    const hits = await osvQueryBatch(c, [
      { ecosystem: "npm", name: "lodash", version: "4.17.20" },
      { ecosystem: "npm", name: "three", version: "0.187.0" },
    ]);
    expect(hits).toEqual([{ query: { ecosystem: "npm", name: "lodash", version: "4.17.20" }, ids: [VULN_ID] }]);
    expect(JSON.parse(calls.bodies[0])).toEqual({ queries: [{ package: { ecosystem: "npm", name: "lodash" }, version: "4.17.20" }, { package: { ecosystem: "npm", name: "three" }, version: "0.187.0" }] });
    const d = await osvDetails(c, [VULN_ID]);
    expect(d.get(VULN_ID)).toMatchObject({ severity: "high", aliases: ["CVE-2021-23337"], fixed: { lodash: ["4.17.21"] }, summary: "Command Injection in lodash" });
  });

  it("ranks MAL- ids as malicious and reads GHSA severities", () => {
    expect(osvSeverity("MAL-2025-1", undefined)).toBe("malicious");
    expect(osvSeverity("GHSA-x", { database_specific: { severity: "MODERATE" } })).toBe("moderate");
    expect(osvSeverity("PYSEC-1", {})).toBe("unknown");
  });
});

describe("parts fetch reads vendor files with a streamed cap", () => {
  const project = { root: "unused", definitions: new Map([["part-b", {}]]) } as unknown as Project;

  it("stops a body with no content-length at the cap instead of buffering it whole", async () => {
    const { stream, seen } = countingStream(100_000, 64 * 1024);
    const fetcher: Fetcher = async () => ({ ok: true, status: 200, headers: { get: () => null }, body: stream, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" });
    const o = await fetchPartModel(project, "part-b", { type: "url", url: "https://example.com/a.step" }, { fetcher, maxBytes: 1024 * 1024 });
    expect(o.status).toBe("failed");
    expect(o.message).toMatch(/over the 1048576-byte limit/);
    expect(seen.pulled).toBeLessThanOrEqual(20); // 16 chunks reach the cap; the stream may have queued one or two ahead
    expect(seen.cancelled).toBe(true);
  });

  it("caps EasyEDA's component record the same way", async () => {
    const { stream } = countingStream(100_000, 64 * 1024);
    const fetcher: Fetcher = async () => ({ ok: true, status: 200, headers: { get: () => null }, body: stream, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" });
    const o = await fetchPartModel(project, "part-b", { type: "lcsc", id: "C393939" }, { fetcher, maxBytes: 512 * 1024 });
    expect(o.status).toBe("failed");
    expect(o.message).toMatch(/easyeda\.com\/api\/products\/C393939.*over the 524288-byte limit/);
  });
});
