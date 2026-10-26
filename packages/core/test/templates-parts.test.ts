/**
 * The release note on templates and part revisions (PB-944,
 * scripts/templates-parts.mjs): a template may pin older revisions than the
 * library recommends; the note says which, and never fails a release.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOSTED_CLOUD_URL, listTemplates } from "../src/index.js";
import { comparePin, compareTemplates, hostedLibraryUrl, report, templatePins } from "../../../scripts/templates-parts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "scripts/templates-parts.mjs");
const run = (args: string[], env: NodeJS.ProcessEnv = {}) => promisify(execFile)(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, PROTOBOARD_CLOUD_URL: "", ...env } });

const rev = (revision: number, definitionDigest: string, deprecated?: { reason: string }) => ({ revision, definitionDigest, ...(deprecated ? { deprecated } : {}) });
const answer = (recommendedRevision: number | undefined, revisions: ReturnType<typeof rev>[]) => ({ part: { latestRevision: Math.max(...revisions.map((r) => r.revision)), ...(recommendedRevision !== undefined ? { recommendedRevision } : {}) }, revisions });

describe("templates:parts", () => {
  it("reads the pins the templates ship, and the hosted library's URL from core", () => {
    const pins = templatePins();
    expect(pins.map((t) => t.template)).toEqual(listTemplates().map((t) => t.id));
    for (const t of listTemplates()) expect(pins.find((p) => p.template === t.id)!.pins.map((p) => `${p.partId}@${p.revision}`)).toEqual(t.catalogParts);
    expect(hostedLibraryUrl()).toBe(HOSTED_CLOUD_URL);
  });

  it("says current, behind (and whether the definition changed), ahead, deprecated and missing", () => {
    const pin = { partId: "p", revision: 3 };
    expect(comparePin(pin, answer(3, [rev(3, "a")]))).toMatchObject({ status: "current", recommended: 3 });
    expect(comparePin(pin, answer(4, [rev(3, "a"), rev(4, "b")]))).toMatchObject({ status: "behind", recommended: 4, definition: "changed" });
    expect(comparePin(pin, answer(4, [rev(3, "a"), rev(4, "a")]))).toMatchObject({ status: "behind", definition: "same" });
    expect(comparePin(pin, answer(4, [rev(3, "a", { reason: "wrong pad pitch" }), rev(4, "b")])).note).toContain("v3 is deprecated: wrong pad pitch");
    expect(comparePin(pin, answer(2, [rev(2, "a"), rev(3, "b")]))).toMatchObject({ status: "ahead" });
    expect(comparePin(pin, answer(undefined, [rev(3, "a")]))).toMatchObject({ status: "deprecated" });
    expect(comparePin(pin, answer(4, [rev(4, "b")]))).toMatchObject({ status: "missing" });
    expect(comparePin(pin, undefined)).toMatchObject({ status: "missing" });
  });

  it("the note lists only what is behind, in revisions written v<n>", async () => {
    const library = (async (url: string | URL | Request) => {
      const id = String(url).split("/").pop()!;
      if (id === "gone") return new Response("{}", { status: 404 });
      return Response.json(id === "old" ? answer(4, [rev(3, "a"), rev(4, "b")]) : answer(3, [rev(3, "a")]));
    }) as typeof fetch;
    const result = await compareTemplates("http://library.test/", [{ template: "iot", pins: [{ partId: "old", revision: 3 }, { partId: "fine", revision: 3 }] }], { fetch: library });
    const text = report("http://library.test", result);
    expect(text).toContain("1 template(s), 2 pinned part(s), against http://library.test");
    expect(text).toMatch(/iot\s+old\s+v3\s+v4\s+behind\s+the definition changed/);
    expect(text).not.toMatch(/\bfine\b/);
    expect(text).toContain("behind: iot 1 of 2");
    expect(report("http://library.test", result, { all: true })).toMatch(/iot\s+fine\s+v3\s+v3\s+current/);
    const none = await compareTemplates("http://library.test", [{ template: "iot", pins: [{ partId: "fine", revision: 3 }] }], { fetch: library });
    expect(report("http://library.test", none)).toContain("every template pins the revisions the library recommends");
  });

  describe("as a command", () => {
    let server: Server;
    let url = "";
    let asked: { path: string; authorization?: string }[] = [];
    beforeAll(async () => {
      // a stand-in library: every part recommends revision 4, whose definition differs from revision 3's
      server = createServer((req, res) => {
        asked.push({ path: req.url ?? "", authorization: req.headers.authorization });
        const body = req.url?.startsWith("/v1/parts/") ? answer(4, [rev(3, "a"), rev(4, "b")]) : undefined;
        res.writeHead(body ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(body ?? {}));
      });
      await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise((ok) => server.close(ok)));

    it("asks only the open part endpoint, without a sign-in, and exits 0 with what is behind", async () => {
      asked = [];
      const r = await run(["--url", url, "--format", "json"]);
      const out = JSON.parse(r.stdout);
      expect(out.skipped).toBe(false);
      const parts = out.templates.flatMap((t: { parts: { status: string }[] }) => t.parts);
      expect(parts.length).toBeGreaterThan(0);
      expect(parts.every((p: { status: string }) => p.status === "behind")).toBe(true);
      expect(asked.every((a) => /^\/v1\/parts\/[a-z0-9-]+$/.test(a.path) && a.authorization === undefined)).toBe(true);
    });

    it("a library that cannot be reached is one line and still exit 0", async () => {
      const closed = createServer();
      await new Promise<void>((ok) => closed.listen(0, "127.0.0.1", ok));
      const dead = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
      await new Promise((ok) => closed.close(ok));
      const r = await run(["--url", dead]);
      expect(r.stdout.trim().split("\n")).toHaveLength(1);
      expect(r.stdout).toContain(`templates:parts: skipped, the library at ${dead} could not be asked (ECONNREFUSED)`);
      // PROTOBOARD_CLOUD_URL is the default before the hosted library
      expect((await run([], { PROTOBOARD_CLOUD_URL: dead })).stdout).toContain(`the library at ${dead}`);
    });

    it("runs the same when the checkout is reached through a symlink (a linked repos folder, /tmp on macOS)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "pb-templates-parts-"));
      try {
        // the scripts folder under another name: argv[1] is then not the real path of the file
        symlinkSync(join(ROOT, "scripts"), join(dir, "linked"), "dir");
        const r = await promisify(execFile)(process.execPath, [join(dir, "linked", "templates-parts.mjs"), "--url", "http://127.0.0.1:1"], { encoding: "utf8" });
        expect(r.stdout).toContain("templates:parts: skipped, the library at http://127.0.0.1:1 could not be asked");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
