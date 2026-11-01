/**
 * `.uhdpkg` (PB-1195): the envelope plus its files, zipped. Round trip,
 * deterministic bytes, and every refusal the reader owes: zip-slip and
 * Windows-unsafe names, duplicates (case-insensitive), sha256 and size
 * mismatches, missing and extra files, unknown required names, the caps,
 * a zip bomb, a truncated archive, and a failed read leaving nothing behind.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { sealDraft, stableStringify, type PartRevisionDraft } from "@protoboardai/cloud/client";
import {
  MANIFEST_NAME,
  UHDPKG_SCHEMA,
  buildPackage,
  crc32,
  crc32Table,
  entryNameProblem,
  inputFromFolder,
  inputFromProjectPart,
  inspectPackage,
  readPackage,
  verifyPackageFile,
  writePackage,
  writeZip,
  type PackageInput,
} from "../src/uhdpkg/index.js";

const TMP = mkdtempSync(join(tmpdir(), "uhdpkg-test-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
const fresh = (name: string) => mkdtempSync(join(TMP, `${name}-`));
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

const GLB = Buffer.from("glTF fake body bytes ".repeat(200));
const STEP = Buffer.from("ISO-10303-21; fake step ".repeat(300));
const LICENSE = Buffer.from("MIT License\n");
const EVIDENCE = Buffer.from(JSON.stringify({ sources: ["https://example.com/datasheet.pdf"] }));

/** A small valid envelope with three artifacts and one evidence file. */
function sample(): PackageInput {
  const definition = {
    id: "demo-part",
    name: "Demo part",
    interfaces: [],
    artifacts: [
      { id: "body", role: "body", filePath: "parts/local/demo-part/out/body.glb", type: "3d_model" },
      { id: "source", role: "source", filePath: "parts/local/demo-part/body.step", type: "3d_model" },
    ],
  };
  const draft: PartRevisionDraft = sealDraft({
    schema: "uhd.part-revision/v1",
    uhdSchema: "0.3.0",
    partId: "demo-part",
    revision: 1,
    definition,
    dependencies: [],
    artifacts: [
      { path: "parts/local/demo-part/LICENSE", sha256: sha(LICENSE), size: LICENSE.length, mediaType: "text/plain", role: "license", terms: { distribution: "redistributable", license: "MIT" } },
      { path: "parts/local/demo-part/body.step", sha256: sha(STEP), size: STEP.length, mediaType: "model/step", role: "source", artifactId: "source", terms: { distribution: "internal" } },
      { path: "parts/local/demo-part/out/body.glb", sha256: sha(GLB), size: GLB.length, mediaType: "model/gltf-binary", role: "body", artifactId: "body" },
    ],
    missingArtifacts: [],
    evidence: [{ kind: "sources", path: "parts/evidence/demo-part/sources.json", sha256: sha(EVIDENCE), size: EVIDENCE.length, mediaType: "application/json" }],
    derivedFrom: null,
  });
  return {
    envelope: draft,
    files: new Map<string, Uint8Array>([
      ["parts/local/demo-part/LICENSE", LICENSE],
      ["parts/local/demo-part/body.step", STEP],
      ["parts/local/demo-part/out/body.glb", GLB],
      ["parts/evidence/demo-part/sources.json", EVIDENCE],
    ]),
  };
}

/** The manifest of a sample package, for hand-made archives. */
const sampleManifest = (over: Record<string, unknown> = {}) => Buffer.from(stableStringify({ ...JSON.parse(stableStringify(buildPackage(sample()).manifest)), ...over }));
const sampleFiles = () => [...sample().files.entries()].map(([name, data]) => ({ name, data: data as Uint8Array }));
const codes = (zip: Buffer, caps = {}) => inspectPackage(zip, { caps }).problems.map((p) => p.code);

describe("uhdpkg: write and read", () => {
  it("round trip: write, verify, read gives the envelope's files byte for byte", () => {
    const dir = fresh("rt");
    const file = join(dir, "demo-part-r1.uhdpkg");
    const built = writePackage(file, sample());
    expect(built.entries.map((e) => e.path)).toEqual([
      "parts/evidence/demo-part/sources.json",
      "parts/local/demo-part/LICENSE",
      "parts/local/demo-part/body.step",
      "parts/local/demo-part/out/body.glb",
    ]);
    const report = verifyPackageFile(file);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.partId).toBe("demo-part");
    expect(report.entries[0]).toMatchObject({ path: MANIFEST_NAME, kind: "manifest" });
    expect(report.entries.find((e) => e.path.endsWith("LICENSE"))).toMatchObject({ status: "ok", role: "license", terms: { distribution: "redistributable", license: "MIT" } });
    const out = join(dir, "unpacked");
    const r = readPackage(file, out);
    expect(r.report.ok).toBe(true);
    expect(r.written).toBe(5);
    for (const [path, bytes] of sample().files) expect(readFileSync(join(out, ...path.split("/")))).toEqual(Buffer.from(bytes));
    const manifest = JSON.parse(readFileSync(join(out, MANIFEST_NAME), "utf8"));
    expect(manifest.schema).toBe(UHDPKG_SCHEMA);
    expect(manifest.required).toEqual(["envelope"]);
    // the envelope exactly as given: no field added or dropped
    expect(manifest.envelope).toEqual(JSON.parse(JSON.stringify(sample().envelope)));
    if (process.platform !== "win32") expect(statSync(join(out, "parts", "local", "demo-part", "LICENSE")).mode & 0o111).toBe(0);
  });

  it("is deterministic: two writes, and a read then write, give the same bytes", () => {
    const a = buildPackage(sample()).zip;
    const b = buildPackage(sample()).zip;
    expect(a.equals(b)).toBe(true);
    const dir = fresh("det");
    writeFileSync(join(dir, "a.uhdpkg"), a);
    readPackage(join(dir, "a.uhdpkg"), join(dir, "u"));
    const again = buildPackage(inputFromFolder(join(dir, "u"))).zip;
    expect(again.equals(a)).toBe(true);
    // the zip's timestamps are the DOS epoch: date 0x0021, time 0
    expect(a.readUInt16LE(10)).toBe(0);
    expect(a.readUInt16LE(12)).toBe(0x21);
  });

  it("deflates what shrinks and stores what does not; --stored stores all", () => {
    const deflated = inspectPackage(buildPackage(sample()).zip);
    expect(deflated.entries.find((e) => e.path.endsWith("body.step"))!.method).toBe("deflated");
    const stored = inspectPackage(buildPackage({ ...sample(), method: "store" }).zip);
    expect(stored.ok).toBe(true);
    expect(stored.entries.every((e) => e.path === MANIFEST_NAME || e.method === "stored")).toBe(true);
  });

  it("carries derived files under derived/<sha256>/ and checks them; an unknown key is refused at write", () => {
    const input = sample();
    const body = sha(GLB);
    const frames = Buffer.from(JSON.stringify({ frames: [] }));
    const zip = buildPackage({ ...input, derived: [{ key: body, name: "vendor-frames.json", source: frames, mediaType: "application/json" }] }).zip;
    const r = inspectPackage(zip);
    expect(r.ok).toBe(true);
    expect(r.entries.find((e) => e.kind === "derived")).toMatchObject({ path: `derived/${body}/vendor-frames.json`, status: "ok" });
    expect(() => buildPackage({ ...input, derived: [{ key: "0".repeat(64), name: "x.json", source: frames }] })).toThrow(/sha256 of no file/);
  });

  it("CRC-32: zlib's and the table's agree", () => {
    for (const b of [Buffer.alloc(0), Buffer.from("123456789"), STEP]) expect(crc32(b)).toBe(crc32Table(b));
    expect(crc32Table(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("uhdpkg: names", () => {
  const refused = ["../x", "/abs", "C:\\x", "C:x", "a\\..\\b", "con.txt", "a/CON", "Lpt1.log", "aux", "name:with", "q\"x", "a<b", "a|b", "a?b", "a*b", "ctl\u0001x", "trail.", "trail ", "a/./b", "a//b", "dir/", ""];
  for (const n of refused) it(`refuses ${JSON.stringify(n)} as an entry name`, () => expect(entryNameProblem(n)).toBeDefined());
  it("accepts ordinary paths", () => {
    for (const n of ["parts/local/x/body.glb", "library/parts/a-b_c.d/artifacts/cad/x.step", "derived/abc/frames.json", "console.txt", "com10.txt"]) expect(entryNameProblem(n)).toBeUndefined();
  });

  for (const name of ["../x", "/abs", "C:\\x", "a\\..\\b", "con.txt", "a:b"]) {
    it(`an archive with ${JSON.stringify(name)} is refused before anything is written`, () => {
      const zip = writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, ...sampleFiles(), { name, data: Buffer.from("x") }]);
      expect(codes(zip)).toContain("ENTRY_NAME");
      const dir = fresh("slip");
      writeFileSync(join(dir, "p.uhdpkg"), zip);
      const r = readPackage(join(dir, "p.uhdpkg"), join(dir, "out"));
      expect(r.report.ok).toBe(false);
      expect(existsSync(join(dir, "out"))).toBe(false);
      expect(existsSync(join(dir, "x"))).toBe(false);
      // no temporary folder left behind
      expect(readdirSync(dir)).toEqual(["p.uhdpkg"]);
    });
  }

  it("refuses an envelope path that is unsafe, at write and at read", () => {
    const input = sample();
    const env = JSON.parse(JSON.stringify(input.envelope));
    env.artifacts[0].path = "../escape.txt";
    expect(() => buildPackage({ ...input, envelope: env })).toThrow(/cannot be packaged/);
    const zip = writeZip([{ name: MANIFEST_NAME, data: sampleManifest({ envelope: env }) }, ...sampleFiles()]);
    expect(codes(zip)).toContain("ENVELOPE_PATH");
  });

  it("refuses an entry marked as a symbolic link", () => {
    const zip = writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, ...sampleFiles(), { name: "link", data: Buffer.from("/etc/passwd") }]);
    // patch the last directory entry: made by Unix, mode 0120777 (a symlink)
    const at = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt16LE((3 << 8) | 20, at + 4);
    zip.writeUInt32LE((0o120777 << 16) >>> 0, at + 38);
    expect(inspectPackage(zip).problems.find((p) => p.code === "ENTRY_NAME")!.message).toMatch(/symbolic link/);
  });

  it("refuses names that are the same file on a case-insensitive file system, and a file that is also a folder", () => {
    const dup = writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, { name: "A.txt", data: Buffer.from("1") }, { name: "a.txt", data: Buffer.from("2") }]);
    expect(codes(dup)).toContain("ENTRY_DUPLICATE");
    const nfc = writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, { name: "caf\u00e9.txt", data: Buffer.from("1") }, { name: "cafe\u0301.txt", data: Buffer.from("2") }]);
    expect(codes(nfc)).toContain("ENTRY_DUPLICATE");
    const nest = writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, { name: "a", data: Buffer.from("1") }, { name: "A/b", data: Buffer.from("2") }]);
    expect(codes(nest)).toContain("ENTRY_DUPLICATE");
  });
});

describe("uhdpkg: content checks", () => {
  it("a file whose bytes differ from the envelope's sha256 is refused", () => {
    const files = sampleFiles().map((f) => (f.name.endsWith("body.glb") ? { ...f, data: Buffer.from(GLB).fill(0x41, 0, 4) } : f));
    const r = inspectPackage(writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, ...files]));
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.code)).toEqual(["ENTRY_SHA256"]);
    expect(r.entries.find((e) => e.path.endsWith("body.glb"))!.status).toBe("bad");
  });

  it("a file whose size differs is refused", () => {
    const files = sampleFiles().map((f) => (f.name.endsWith("LICENSE") ? { ...f, data: Buffer.from("MIT License\n\n") } : f));
    expect(codes(writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, ...files]))).toEqual(["ENTRY_SIZE"]);
  });

  it("a file the envelope lists but the archive lacks is refused", () => {
    const files = sampleFiles().filter((f) => !f.name.endsWith("LICENSE"));
    expect(codes(writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, ...files]))).toEqual(["ENTRY_MISSING"]);
  });

  it("a file the envelope does not list is refused", () => {
    expect(codes(writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, ...sampleFiles(), { name: "extra.txt", data: Buffer.from("x") }]))).toEqual(["ENTRY_UNEXPECTED"]);
  });

  it("an unknown name in required is an error; an unknown top-level member is only a warning", () => {
    const req = inspectPackage(writeZip([{ name: MANIFEST_NAME, data: sampleManifest({ required: ["envelope", "zstd-entries"] }) }, ...sampleFiles()]));
    expect(req.ok).toBe(false);
    expect(req.problems.map((p) => p.code)).toContain("REQUIRED_UNKNOWN");
    const extra = inspectPackage(writeZip([{ name: MANIFEST_NAME, data: sampleManifest({ futureThing: { a: 1 } }) }, ...sampleFiles()]));
    expect(extra.ok).toBe(true);
    expect(extra.warnings.map((w) => w.code)).toContain("MANIFEST_MEMBER_UNKNOWN");
  });

  it("an envelope edited after sealing fails its digest", () => {
    const env = JSON.parse(JSON.stringify(sample().envelope));
    env.artifacts[0].role = "attachment";
    expect(codes(writeZip([{ name: MANIFEST_NAME, data: sampleManifest({ envelope: env }) }, ...sampleFiles()]))).toContain("DIGEST_MISMATCH");
  });

  it("the manifest must come first, and be a protoboard.uhdpkg/v0 one", () => {
    expect(codes(writeZip([...sampleFiles(), { name: MANIFEST_NAME, data: sampleManifest() }]))).toContain("MANIFEST_MISSING");
    expect(codes(writeZip([{ name: MANIFEST_NAME, data: sampleManifest({ schema: "protoboard.uhdpkg/v9" }) }, ...sampleFiles()]))).toContain("MANIFEST_SCHEMA");
    expect(codes(writeZip([{ name: MANIFEST_NAME, data: Buffer.from("{not json") }]))).toContain("MANIFEST_INVALID");
  });

  it("a local header that names another file than the directory is refused", () => {
    const zip = writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, ...sampleFiles()]);
    // the first local header's name: uhdpkg.json -> uhdpkg.jsoN
    zip.write("N", 30 + MANIFEST_NAME.length - 1, "latin1");
    expect(codes(zip)).toContain("ZIP_NAME_MISMATCH");
  });
});

describe("uhdpkg: caps and damage", () => {
  const good = () => buildPackage(sample()).zip;
  it("per-entry, total, entry-count, archive and manifest caps refuse at read, and the writer obeys them too", () => {
    expect(codes(good(), { maxEntryBytes: 1000 })).toContain("CAP_ENTRY");
    expect(codes(good(), { maxTotalBytes: 5000 })).toContain("CAP_TOTAL");
    expect(codes(good(), { maxEntries: 3 })).toContain("CAP_ENTRIES");
    expect(codes(good(), { maxArchiveBytes: 100 })).toContain("CAP_ARCHIVE");
    expect(codes(good(), { maxManifestBytes: 100 })).toContain("CAP_MANIFEST");
    expect(() => buildPackage({ ...sample(), caps: { maxEntryBytes: 1000 } })).toThrow(/per-entry cap/);
    expect(() => buildPackage({ ...sample(), caps: { maxTotalBytes: 5000 } })).toThrow(/cap for a package/);
  });

  it("a zip bomb (an entry that expands past the ratio cap) is refused before it is inflated", () => {
    const bomb = writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, { name: "zeros.bin", data: Buffer.alloc(8 * 1024 * 1024) }]);
    const r = inspectPackage(bomb);
    expect(r.problems.map((p) => p.code)).toContain("CAP_RATIO");
    expect(r.entries.find((e) => e.path === "zeros.bin")!.status).toBe("unread");
  });

  it("a directory that understates an entry's size cannot make the reader inflate past it", () => {
    const zip = writeZip([{ name: MANIFEST_NAME, data: sampleManifest() }, ...sampleFiles()]);
    // the manifest's declared size, local and central, cut to 10 bytes
    zip.writeUInt32LE(10, 22);
    const at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(10, at + 24);
    expect(codes(zip)).toContain("ZIP_SIZE");
  });

  it("a truncated archive is refused, wherever it is cut, without throwing", () => {
    const zip = good();
    for (const keep of [0, 10, 21, 100, Math.floor(zip.length / 2), zip.length - 30, zip.length - 1]) {
      const r = inspectPackage(zip.subarray(0, keep));
      expect(r.ok, `cut at ${keep}`).toBe(false);
    }
    expect(codes(zip.subarray(0, zip.length - 1))[0]).toMatch(/ZIP_TRUNCATED|ZIP_TRAILING/);
  });

  it("flipped data bytes fail the CRC (or the inflate)", () => {
    const zip = good();
    const r = inspectPackage(zip);
    const step = r.entries.find((e) => e.path.endsWith("body.step"))!;
    // somewhere in the step entry's packed data
    const at = zip.indexOf(Buffer.from("parts/local/demo-part/body.step")) + "parts/local/demo-part/body.step".length + 5;
    zip[at] ^= 0xff;
    const after = codes(zip);
    expect(after.some((c) => /ZIP_CRC|ZIP_DAMAGED|ZIP_SIZE|ENTRY_SHA256/.test(c)), after.join(",")).toBe(true);
    expect(step.method).toBe("deflated");
  });

  it("read refuses a target folder that already holds files, and writes nothing", () => {
    const dir = fresh("tgt");
    writeFileSync(join(dir, "p.uhdpkg"), good());
    mkdirSync(join(dir, "out"));
    writeFileSync(join(dir, "out", "keep.txt"), "mine");
    expect(() => readPackage(join(dir, "p.uhdpkg"), join(dir, "out"))).toThrow(/not an empty folder/);
    expect(readdirSync(join(dir, "out"))).toEqual(["keep.txt"]);
    // an empty folder is fine
    mkdirSync(join(dir, "empty"));
    expect(readPackage(join(dir, "p.uhdpkg"), join(dir, "empty")).report.ok).toBe(true);
  });
});

describe("uhdpkg: from a project (the drone example; nothing is written into it)", () => {
  const DRONE = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "examples", "quadcopter-5in");
  const canLoad = existsSync(join(DRONE, "node_modules", "@deltarobotics", "uhd"));

  it.skipIf(!canLoad)(
    "a project part packages as `parts publish` would send it, and a catalog part as rebuilt from what was vendored",
    async () => {
      const local = await inputFromProjectPart(DRONE, "iso-4762-m3x8");
      expect(local.kind).toBe("local-part");
      const a = buildPackage(local);
      const ra = inspectPackage(a.zip);
      expect(ra.problems).toEqual([]);
      expect(ra.envelopeSchema).toBe("protoboard.part-revision/v1");
      const catalog = await inputFromProjectPart(DRONE, "iso-10511-m3-nyloc-nut");
      expect(catalog.kind).toBe("catalog-vendored");
      const b = buildPackage(catalog);
      const rb = inspectPackage(b.zip);
      expect(rb.problems).toEqual([]);
      expect(rb.entries.length).toBeGreaterThan(1);
      // deterministic from a project too
      expect(buildPackage(await inputFromProjectPart(DRONE, "iso-10511-m3-nyloc-nut")).zip.equals(b.zip)).toBe(true);
    },
    180_000,
  );
});
