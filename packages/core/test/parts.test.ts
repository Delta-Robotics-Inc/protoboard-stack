/**
 * `protoboard parts search|add|update|publish` against the real parts service
 * (M2 exit criteria): a downloaded part and
 * its closure compose with local parts; its revision and digests are
 * recorded; tampered bytes fail; an updated catalog revision does not change
 * the project until asked; an offline copy loads without the network; a
 * missing service or revision is a clear error; a project-researched part is
 * published as a catalog revision.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UhdModuleDef } from "@protoboardai/cloud/client";
import {
  addParts,
  checkPartUpdates,
  connectCloud,
  loadProject,
  publishPart,
  readOrigins,
  resolvedProject,
  searchParts,
  sha256,
  uhdBundle,
  updatePart,
  vendorOffers,
  type CloudConnection,
} from "../src/index.js";
import { Blobs, closedPort, draft, startCloud, TOKEN, type CloudService } from "./cloud.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-parts");
const CLI = join(HERE, "../../cli/bin/protoboard.mjs");
/** The CLI in a fresh process; PROTOBOARD_CLOUD_* come only from `env`. */
const pb = (dir: string, args: string[], env: Record<string, string> = {}) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_CLOUD_")));
  const r = spawnSync(process.execPath, [CLI, ...args, "--cwd", dir], { encoding: "utf8", timeout: 120000, env: { ...clean, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const NOW = "2026-10-02T00:00:00.000Z";
let n = 0;
const tmpProject = (files: Record<string, string>) => {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};

const CONFIG = `import { defineConfig } from "@protoboardai/core";
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });
`;
const system = (...children: [string, string][]) =>
  `export const SYS = { id: "sys", name: "System", interfaces: [], children: [${children.map(([id, def]) => `{ id: "${id}", moduleDefId: "${def}" }`).join(", ")}] };\n`;

const power = { id: "vin", name: "VIN", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["sink"] }] };
const SCREW: UhdModuleDef = {
  id: "test-m3-screw",
  name: "M3 screw",
  manufacturer: "Test",
  part_number: "M3-8",
  interfaces: [power],
  artifacts: [{ id: "body", name: "Body", type: "3d_model", role: "body", format: "glb", filePath: "parts/test-m3-screw/body.glb" }],
};
const kit = (description: string): UhdModuleDef => ({
  id: "test-bracket-kit",
  name: "Bracket kit",
  description,
  manufacturer: "Test",
  part_number: "BK-1",
  interfaces: [power],
  children: [{ id: "screw", moduleDefId: "test-m3-screw" }],
  artifacts: [{ id: "body", name: "Body", type: "3d_model", role: "body", format: "glb", filePath: "parts/test-bracket-kit/body.glb" }],
});
const TAMPER: UhdModuleDef = {
  id: "test-tampered",
  name: "Tampered",
  interfaces: [power],
  artifacts: [{ id: "body", name: "Body", type: "3d_model", role: "body", format: "glb", filePath: "parts/test-tampered/body.glb" }],
};

let svc: CloudService;
let cloud: CloudConnection;

beforeAll(async () => {
  svc = await startCloud();
  cloud = connectCloud(undefined, { url: svc.url, env: {} });
  const blobs = new Blobs();
  const publish = (d: Parameters<typeof svc.client.publish>[0]) => svc.client.publish(d, blobs.source);
  await publish(draft(blobs, SCREW, { files: { "parts/test-m3-screw/body.glb": "screw body" }, evidence: { "parts/test-m3-screw/sources.json": '{"sources":[]}' } }));
  const kitFiles = { "parts/test-bracket-kit/body.glb": "bracket body" };
  const dep = [{ partId: "test-m3-screw", revision: 1 }];
  await publish(draft(blobs, kit("first"), { dependencies: dep, files: kitFiles }));
  await publish(draft(blobs, kit("second: corrected description"), { revision: 2, dependencies: dep, files: kitFiles }));
  // revision 3 says exactly what revision 2 says: renumbered only
  await publish(draft(blobs, kit("second: corrected description"), { revision: 3, dependencies: dep, files: kitFiles }));
  const t = await publish(draft(blobs, TAMPER, { files: { "parts/test-tampered/body.glb": "tampered body, original" } }));
  // corrupt the stored bytes behind the service's back (same length, different content)
  const sha = t.envelope.artifacts[0].sha256;
  writeFileSync(join(svc.dataDir, "blobs", "sha256", sha.slice(0, 2), sha), "tampered body, ORIGINAL");
});
afterAll(async () => {
  await svc?.stop();
  rmSync(TMP, { recursive: true, force: true });
});

describe("parts search", () => {
  it("finds catalog parts by words and facets", async () => {
    const r = await searchParts(cloud, { q: "bracket" });
    expect(r.parts.map((x) => [x.partId, x.recommendedRevision])).toEqual([["test-bracket-kit", 3]]);
    expect((await searchParts(cloud, { protocol: "power" })).total).toBe(3);
  });
});

describe("parts add", () => {
  it("vendors a revision with its closure and files, pinned by digest", async () => {
    const dir = tmpProject({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": system(["kit", "test-bracket-kit"]) });
    const r = await addParts(await loadProject(dir, { checks: false }), ["test-bracket-kit@1"], cloud, { now: NOW });
    // dependencies first
    expect(r.map((x) => [x.id, x.revision, x.status, x.requiredBy])).toEqual([
      ["test-m3-screw", 1, "added", "test-bracket-kit@1"],
      ["test-bracket-kit", 1, "added", undefined],
    ]);

    const env = await svc.client.getRevision("test-bracket-kit", 1);
    const origins = readOrigins(dir);
    const rec = origins.definitions["test-bracket-kit"];
    expect(rec).toMatchObject({
      file: "parts/catalog/test-bracket-kit.json",
      tier: "catalog",
      provider: "protoboard-cloud",
      service: svc.url,
      partId: "test-bracket-kit",
      revision: 1,
      digest: env.definitionDigest,
      envelopeDigest: env.digest,
      retrievedAt: NOW,
      artifactBase: { kind: "vendored", dir: "parts/catalog/test-bracket-kit" },
      dependencies: [{ partId: "test-m3-screw", revision: 1 }],
    });
    // the vendored bytes are the ones the envelope names, so check's digest pin holds
    expect(sha256(readFileSync(join(dir, rec.file)))).toBe(env.definitionDigest);
    const screw = origins.definitions["test-m3-screw"];
    // the library's folders down to the part's own are left out of the vendored paths (PB-1018)
    expect(screw.artifactBase).toEqual({ kind: "vendored", dir: "parts/catalog/test-m3-screw", strip: "parts/test-m3-screw/" });
    expect(Object.keys(screw.files!)).toEqual(["body.glb", "sources.json"]);
    for (const [path, digest] of Object.entries(screw.files!)) expect(sha256(readFileSync(join(dir, "parts/catalog/test-m3-screw", path)))).toBe(digest);
    expect(screw.evidence).toEqual([{ kind: "sources", path: "sources.json" }]);

    // it composes, and check/build/bundle resolve the artifacts from the vendored folder
    const p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(p.definitions.get("test-m3-screw")!.origin).toMatchObject({ kind: "catalog", tier: "catalog", revision: 1, service: svc.url });
    const body = p.artifacts.find((a) => a.definition === "test-m3-screw" && a.id === "body")!;
    expect(body).toMatchObject({ present: true, base: "parts/catalog/test-m3-screw", resolved: join(dir, "parts/catalog/test-m3-screw/body.glb") });
    expect(resolvedProject(p).artifacts.find((a) => a.definition === "test-m3-screw")!.resolved).toBe("parts/catalog/test-m3-screw/body.glb");
    expect((await uhdBundle(p)).artifactBases).toMatchObject({ "test-m3-screw": join(dir, "parts/catalog/test-m3-screw"), sys: dir });

    // re-adding changes nothing
    const again = await addParts(p, ["test-bracket-kit@1"], cloud, { now: "2026-10-03T00:00:00.000Z" });
    expect(again.map((x) => x.status)).toEqual(["unchanged", "unchanged"]);
    expect(readOrigins(dir).definitions["test-bracket-kit"].retrievedAt).toBe(NOW);
  });

  it("fails on tampered bytes and writes nothing", async () => {
    const dir = tmpProject({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": system() });
    const p = await loadProject(dir, { checks: false });
    await expect(addParts(p, ["test-tampered"], cloud)).rejects.toThrow(/test-tampered: downloaded data failed verification, so nothing was written: blob [0-9a-f]{64} downloaded as/);
    expect(existsSync(join(dir, "parts/catalog/test-tampered.json"))).toBe(false);
    expect(existsSync(join(dir, "parts/catalog/test-tampered"))).toBe(false);
    expect(readOrigins(dir).definitions).toEqual({});
    expect(readdirSync(join(dir, ".protoboard/cache"))).toEqual([]); // staging removed
  });

  it("reports a missing revision, a missing part and a missing service clearly", async () => {
    const dir = tmpProject({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": system() });
    const p = await loadProject(dir, { checks: false });
    await expect(addParts(p, ["test-m3-screw@9"], cloud)).rejects.toThrow(/^test-m3-screw@9: no such revision at http:\/\/127\.0\.0\.1:\d+/);
    await expect(addParts(p, ["no-such-part"], cloud)).rejects.toThrow(/^no-such-part: not in the catalog/);
    const down = connectCloud(undefined, { url: `http://127.0.0.1:${await closedPort()}`, env: {} });
    await expect(searchParts(down, {})).rejects.toThrow(/cannot reach the Protoboard Cloud parts service at http:\/\/127\.0\.0\.1:\d+ .*Loading, checking and building do not need the service/);
    await expect(addParts(p, ["test-m3-screw"], down)).rejects.toThrow(/cannot reach the Protoboard Cloud parts service/);
    await expect(checkPartUpdates(p, [], down)).resolves.toEqual([]); // nothing vendored: nothing to ask
    expect(readOrigins(dir).definitions).toEqual({});
  });
});

describe("parts update", () => {
  it("shows the recommended revision and re-pins only when asked", async () => {
    const dir = tmpProject({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": system(["kit", "test-bracket-kit"]) });
    await addParts(await loadProject(dir, { checks: false }), ["test-bracket-kit@1"], cloud, { now: NOW });
    const originsFile = join(dir, "parts/origins.json");
    const pinned = readFileSync(originsFile, "utf8");
    const p = await loadProject(dir, { checks: false });

    // adding the part again without a revision means the recommended one: a conflict, not an update
    const re = await addParts(p, ["test-bracket-kit"], cloud);
    expect(re.find((x) => x.id === "test-bracket-kit")).toMatchObject({ status: "conflict", revision: 3 });
    expect(re.find((x) => x.id === "test-bracket-kit")!.message).toMatch(/pinned at revision 1; this needs revision 3.*--to 3/);

    const report = await checkPartUpdates(p, [], cloud);
    expect(report.find((x) => x.id === "test-bracket-kit")).toMatchObject({ status: "update-available", pinned: 1, recommended: 3, contentChanged: true, changes: ["definition"] });
    expect(report.find((x) => x.id === "test-m3-screw")).toMatchObject({ status: "up-to-date", pinned: 1 });
    expect(readFileSync(originsFile, "utf8")).toBe(pinned); // nothing written

    const up = await updatePart(p, "test-bracket-kit", 2, cloud, { now: "2026-10-03T00:00:00.000Z" });
    expect(up.map((x) => [x.id, x.status])).toEqual([["test-m3-screw", "unchanged"], ["test-bracket-kit", "updated"]]);
    const rec = readOrigins(dir).definitions["test-bracket-kit"];
    expect(rec).toMatchObject({ revision: 2, previous: { provider: "protoboard-cloud", revision: 1, retrievedAt: NOW } });
    expect(JSON.parse(readFileSync(join(dir, rec.file), "utf8")).description).toBe("second: corrected description");

    // revision 3 only renumbers revision 2
    const after = await checkPartUpdates(p, ["test-bracket-kit"], cloud);
    expect(after[0]).toMatchObject({ status: "renumbered", pinned: 2, recommended: 3, contentChanged: false });
    expect((await loadProject(dir)).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("parts offers", () => {
  it("vendors the service's offers for catalog parts into parts/offers.json; local parts are skipped", async () => {
    const dir = tmpProject({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": system(["kit", "test-bracket-kit"]) });
    await addParts(await loadProject(dir, { checks: false }), ["test-bracket-kit@1"], cloud, { now: NOW });
    await svc.client.addOffer("test-m3-screw", { mpn: "M3X8-A2", supplier: "Fastener Shop", sku: "FS-M3-8", url: "https://fasteners.example/m3-8", unitPrice: 0.05, currency: "USD", minQuantity: 100, stock: 9000, observedAt: "2026-10-01T00:00:00Z", source: "https://fasteners.example/m3-8" });
    const r = await vendorOffers(await loadProject(dir, { checks: false }), ["test-m3-screw", "test-bracket-kit", "sys"], cloud, { now: NOW });
    expect(r).toEqual([
      { id: "test-m3-screw", offers: 1, status: "vendored" },
      { id: "test-bracket-kit", offers: 0, status: "vendored" },
      { id: "sys", offers: 0, status: "not-catalog" },
    ]);
    const file = JSON.parse(readFileSync(join(dir, "parts/offers.json"), "utf8"));
    expect(file).toMatchObject({ schema: "protoboard.offers/v0", service: svc.url, retrievedAt: NOW });
    expect(file.parts["test-m3-screw"]).toEqual([{ mpn: "M3X8-A2", supplier: "Fastener Shop", sku: "FS-M3-8", url: "https://fasteners.example/m3-8", unitPrice: 0.05, currency: "USD", minQuantity: 100, stock: 9000, observedAt: "2026-10-01T00:00:00Z" }]);
    // prices by source, and nothing about how the library fetched them (PB-936): the service keeps an offer's source and note
    expect(JSON.stringify(file)).not.toMatch(/"(source|note)"/);
    // the revision pins are untouched
    expect(readOrigins(dir).definitions["test-m3-screw"].revision).toBe(1);
  });
});

describe("offline", () => {
  it("loads, checks, builds and bundles a vendored project without the network", async () => {
    const dir = tmpProject({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": system(["kit", "test-bracket-kit"]) });
    await addParts(await loadProject(dir, { checks: false }), ["test-bracket-kit@1"], cloud, { now: NOW });
    const net = vi.fn(() => Promise.reject(new Error("offline")));
    const env = process.env.PROTOBOARD_CLOUD_URL;
    vi.stubGlobal("fetch", net);
    process.env.PROTOBOARD_CLOUD_URL = `http://127.0.0.1:${await closedPort()}`;
    try {
      const p = await loadProject(dir);
      expect(p.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
      resolvedProject(p);
      await uhdBundle(p);

      // vendored files are as immutable as the definition, and that is checked offline too
      const vendored = join(dir, "parts/catalog/test-m3-screw");
      writeFileSync(join(vendored, "body.glb"), "edited");
      unlinkSync(join(vendored, "sources.json"));
      const q = await loadProject(dir);
      expect(q.diagnostics.filter((d) => d.validator === "protoboard/catalog").map((d) => [d.code, d.severity])).toEqual([
        ["PB_VENDORED_FILE_MISMATCH", "error"],
        ["PB_VENDORED_FILE_MISSING", "warning"],
      ]);
      expect(net).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      if (env === undefined) delete process.env.PROTOBOARD_CLOUD_URL;
      else process.env.PROTOBOARD_CLOUD_URL = env;
    }
    // adding the same revision again restores them
    const r = await addParts(await loadProject(dir, { checks: false }), ["test-bracket-kit@1"], cloud);
    expect(r.map((x) => [x.id, x.status])).toEqual([["test-m3-screw", "restored"], ["test-bracket-kit", "unchanged"]]);
    expect((await loadProject(dir)).diagnostics.filter((d) => d.validator === "protoboard/catalog")).toEqual([]);
  });
});

describe("the CLI", () => {
  it("searches, adds and reports updates through the service, and checks offline", async () => {
    const dir = tmpProject({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": system(["kit", "test-bracket-kit"]) });
    const env = { PROTOBOARD_CLOUD_URL: svc.url };
    const search = pb(dir, ["parts", "search", "screw", "--format", "json"], env);
    expect(search.status).toBe(0);
    expect(JSON.parse(search.stdout)).toMatchObject({ service: svc.url, total: 1, parts: [{ partId: "test-m3-screw", recommendedRevision: 1 }] });

    const add = pb(dir, ["parts", "add", "test-bracket-kit@1"], env);
    expect(add.status).toBe(0);
    expect(add.stdout).toMatch(/^added +test-m3-screw@1 +\(for test-bracket-kit@1\) +2 file\(s\)\nadded +test-bracket-kit@1 +1 file\(s\)$/m);
    const update = pb(dir, ["parts", "update", "test-bracket-kit"], env);
    expect(update.stdout).toMatch(/^update-available +test-bracket-kit +pinned 1, recommended 3\n +pinned at 1; revision 3 is recommended and changes definition\./);
    expect(pb(dir, ["parts", "update", "test-bracket-kit", "--to", "nine"], env)).toMatchObject({ status: 2, stderr: expect.stringMatching(/--to takes a revision number or "recommended"/) });

    // no service: the parts command says so; check and build do not care
    const down = { PROTOBOARD_CLOUD_URL: `http://127.0.0.1:${await closedPort()}` };
    const failed = pb(dir, ["parts", "add", "test-m3-screw"], down);
    expect(failed.status).toBe(2);
    expect(failed.stderr).toMatch(/^protoboard: cannot reach the Protoboard Cloud parts service at http:\/\/127\.0\.0\.1:\d+/);
    expect(pb(dir, ["check", "--format", "json"], down).status).toBe(0);
    expect(pb(dir, ["build"], down).status).toBe(0);
  });
});

describe("parts publish", () => {
  const LOCAL = `import type { ModuleDef } from "@deltarobotics/uhd";
// Acme TOF-1 time-of-flight sensor (sources: parts/evidence/acme-tof-1/sources.json)
export const ACME_TOF_1: ModuleDef = {
  id: "acme-tof-1",
  name: "Acme TOF-1",
  manufacturer: "Acme",
  part_number: "TOF-1",
  interfaces: [{ id: "vin", name: "VIN", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["sink"] }] }],
  artifacts: [
    { id: "body", name: "Body", type: "3d_model", role: "body", format: "glb", filePath: "parts/local/acme-tof-1/body.glb" },
    { id: "vendor_step", name: "Vendor STEP", type: "3d_model", role: "source", format: "step", filePath: "parts/evidence/acme-tof-1/.research/vendor.step" },
  ],
};
`;
  const KIT = `export const ACME_KIT = { id: "acme-kit", name: "Acme kit", manufacturer: "Acme", part_number: "KIT-1", interfaces: [], children: [{ id: "screw", moduleDefId: "test-m3-screw" }] };\n`;
  const project = () =>
    tmpProject({
      "protoboard.config.ts": CONFIG,
      "src/sys.uhd.ts": system(["tof", "acme-tof-1"], ["kit", "acme-kit"]) + `export const BRACKET = { id: "custom-bracket", name: "Custom bracket", interfaces: [] };\n`,
      "parts/local/acme-tof-1.uhd.ts": LOCAL,
      "parts/local/acme-tof-1/body.glb": "tof body",
      "parts/local/acme-tof-1/thumbnail.png": "png",
      "parts/local/acme-kit.uhd.ts": KIT,
      "parts/evidence/acme-tof-1/sources.json": '{"sources":[{"id":"ds","url":"https://example.com/tof-1.pdf"}]}',
      "parts/evidence/acme-tof-1/verification.json": '{"partId":"acme-tof-1","audit":{"checked":12,"confirmed":12,"wrong":0}}',
      "parts/evidence/acme-tof-1/sourcing.json": '{"schema":"protoboard.sourcing/v0","offers":[]}',
      "parts/evidence/acme-tof-1/.research/notes.md": "working notes",
      "parts/evidence/acme-tof-1/terms.json": JSON.stringify({
        schema: "protoboard.library-terms/v1",
        files: {
          "parts/local/acme-tof-1/body.glb": { distribution: "redistributable", license: "LicenseRef-Acme-Project", summary: "our own model" },
          // written for other bytes: does not apply
          "parts/local/acme-tof-1/thumbnail.png": { distribution: "unknown", summary: "scraped photo", sha256: "0".repeat(64) },
        },
      }),
      "parts/evidence/acme-kit/sources.json": "{}",
      "parts/evidence/acme-kit/verification.json": "{}",
    });
  // a service on this machine gets the service token only when it is listed (PB-1048)
  const writer = () => connectCloud(undefined, { url: svc.url, env: { PROTOBOARD_CLOUD_TOKEN: TOKEN, PROTOBOARD_CLOUD_TOKEN_ORIGINS: svc.url } });

  it("publishes a parts/local part as a catalog revision, with its files and evidence", async () => {
    const dir = project();
    await addParts(await loadProject(dir, { checks: false }), ["test-m3-screw@1"], cloud);
    const p = await loadProject(dir);
    expect(p.definitions.get("acme-tof-1")!.origin.tier).toBe("project-researched");
    expect(p.definitions.get("custom-bracket")!.origin.tier).toBe("project-specific");

    await expect(publishPart(p, "parts/local/acme-tof-1.uhd.ts", cloud)).rejects.toThrow(/needs a publisher: sign in with `protoboard login` as one, or set the service's token in PROTOBOARD_CLOUD_TOKEN/);
    const dry = await publishPart(p, "parts/local/acme-tof-1.uhd.ts", cloud, { dryRun: true });
    expect(dry).toMatchObject({ status: "dry-run", revision: 1, derivedFrom: null });

    const r = await publishPart(p, "parts/local/acme-tof-1.uhd.ts", writer(), { now: NOW });
    expect(r).toMatchObject({ status: "published", revision: 1 });
    const env = await svc.client.getRevision("acme-tof-1", 1);
    // the schema of UHD's minor line, whatever patch the project has installed (PB-941)
    expect(env.uhdSchema).toMatch(/^\d+\.\d+\.0$/);
    expect(env.artifacts.map((a) => [a.path, a.role, a.terms?.distribution])).toEqual([
      ["parts/local/acme-tof-1/body.glb", "body", "redistributable"],
      ["parts/local/acme-tof-1/thumbnail.png", "thumbnail", undefined],
    ]);
    expect(env.artifacts[0].terms).toEqual({ distribution: "redistributable", license: "LicenseRef-Acme-Project", summary: "our own model" });
    // sourcing.json (supplier offers) and .research/ stay in the project; terms.json became each file's terms
    expect(env.evidence.map((e) => [e.kind, e.path])).toEqual([
      ["sources", "parts/evidence/acme-tof-1/sources.json"],
      ["verification", "parts/evidence/acme-tof-1/verification.json"],
    ]);
    expect(env.missingArtifacts).toEqual([{ path: "parts/evidence/acme-tof-1/.research/vendor.step", artifactId: "vendor_step", reason: expect.stringMatching(/^not distributed/) }]);
    expect(env.source).toMatchObject({ repository: expect.stringMatching(/^protoboard project /), path: "parts/local/acme-tof-1.uhd.ts" });
    expect(readOrigins(dir).published!["acme-tof-1"]).toEqual({ file: "parts/local/acme-tof-1.uhd.ts", service: svc.url, revision: 1, envelopeDigest: env.digest, definitionDigest: env.definitionDigest, publishedAt: NOW });

    // the same content again publishes nothing
    expect(await publishPart(p, "acme-tof-1", writer())).toMatchObject({ status: "unchanged", revision: 1 });

    // a part containing a catalog part pins it
    const kit = await publishPart(p, "parts/local/acme-kit.uhd.ts", writer());
    expect(kit).toMatchObject({ status: "published", revision: 1, dependencies: [{ partId: "test-m3-screw", revision: 1 }] });

    // only project-researched parts are published
    await expect(publishPart(p, "src/sys.uhd.ts", writer())).rejects.toThrow(/declares sys, custom-bracket; publish one part per file/);
    await expect(publishPart(p, "custom-bracket", writer())).rejects.toThrow(/custom-bracket is a project-specific part \(src\/sys.uhd.ts\); only project-researched parts in parts\/local\/ are published/);

    // adopting the catalog copy: drop the local source and add the revision
    rmSync(join(dir, "parts/local/acme-tof-1.uhd.ts"));
    const added = await addParts(await loadProject(dir, { checks: false }), ["acme-tof-1@1"], cloud);
    expect(added.map((x) => x.status)).toEqual(["added"]);
    const q = await loadProject(dir);
    expect(q.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(q.artifacts.find((a) => a.definition === "acme-tof-1" && a.id === "body")).toMatchObject({ present: true, base: "parts/catalog/acme-tof-1" });
    expect(q.diagnostics.find((d) => d.entity.id === "acme-tof-1#vendor_step")!.message).toMatch(/the catalog revision does not carry it: not distributed/);
  });

  it("refuses a part without verification evidence", async () => {
    const dir = project();
    rmSync(join(dir, "parts/evidence/acme-tof-1/verification.json"));
    const p = await loadProject(dir, { checks: false });
    await expect(publishPart(p, "parts/local/acme-tof-1.uhd.ts", writer())).rejects.toThrow(/parts\/evidence\/acme-tof-1\/ has no verification.json/);
  });
});
