/**
 * `protoboard package write|read|verify` (PB-1195) through the function the
 * CLI registers (`packageCommand`): a folder with envelope.json packed,
 * verified and unpacked; a damaged package fails verify with exit 1; the
 * JSON output; usage errors. Per-run temporary folders only.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sealDraft } from "@protoboardai/cloud/client";
import { PACKAGE_USAGE, packageCommand } from "../src/package.js";

const TMP = mkdtempSync(join(tmpdir(), "uhdpkg-cli-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A folder holding envelope.json and its one file, as a library serves a revision. */
function envelopeFolder(): string {
  const dir = mkdtempSync(join(TMP, "src-"));
  const body = Buffer.from("glb bytes ".repeat(500));
  const envelope = sealDraft({
    schema: "uhd.part-revision/v1",
    uhdSchema: "0.3.0",
    partId: "cli-part",
    revision: 2,
    definition: { id: "cli-part", name: "CLI part", interfaces: [], artifacts: [{ id: "body", role: "body", filePath: "cad/body.glb" }] },
    dependencies: [],
    artifacts: [{ path: "cad/body.glb", sha256: sha(body), size: body.length, mediaType: "model/gltf-binary", role: "body", artifactId: "body", terms: { distribution: "redistributable", license: "CC-BY-4.0" } }],
    missingArtifacts: [],
    evidence: [],
    derivedFrom: { partId: "cli-part", revision: 1 },
  });
  mkdirSync(join(dir, "cad"));
  writeFileSync(join(dir, "cad", "body.glb"), body);
  writeFileSync(join(dir, "envelope.json"), JSON.stringify(envelope, null, 2));
  return dir;
}

function capture(json = false) {
  const lines: string[] = [];
  const data: unknown[] = [];
  return { out: (d: unknown, text: () => string) => (data.push(d), lines.push(json ? JSON.stringify(d) : text())), lines, data };
}

describe("protoboard package", () => {
  it("write (from an envelope folder), verify and read", async () => {
    const src = envelopeFolder();
    const work = mkdtempSync(join(TMP, "w-"));
    const w = capture();
    expect(await packageCommand(work, ["write", src, "--out", "cli-part.uhdpkg"], w.out)).toBe(0);
    expect(w.lines[0]).toMatch(/^wrote .*cli-part\.uhdpkg: cli-part@2, 1 file\(s\)/);
    const file = join(work, "cli-part.uhdpkg");
    expect(existsSync(file)).toBe(true);

    const v = capture();
    expect(await packageCommand(work, ["verify", "cli-part.uhdpkg"], v.out)).toBe(0);
    expect(v.lines[0]).toMatch(/verify cli-part\.uhdpkg: OK {2}cli-part@2/);
    expect(v.lines[0]).toMatch(/artifact .* sha256 OK {2}cad\/body\.glb {2}\[body\] {2}terms redistributable CC-BY-4\.0/);

    const r = capture();
    expect(await packageCommand(work, ["read", "cli-part.uhdpkg", "unpacked"], r.out)).toBe(0);
    expect(readFileSync(join(work, "unpacked", "cad", "body.glb"))).toEqual(readFileSync(join(src, "cad", "body.glb")));
    expect(existsSync(join(work, "unpacked", "uhdpkg.json"))).toBe(true);

    // the unpacked folder packs again to the same bytes
    expect(await packageCommand(work, ["write", "unpacked", "--out", "again.uhdpkg"], capture().out)).toBe(0);
    expect(readFileSync(join(work, "again.uhdpkg")).equals(readFileSync(file))).toBe(true);
  });

  it("the default output name is <part>-r<revision>.uhdpkg in the working folder; --created-at stamps the manifest", async () => {
    const src = envelopeFolder();
    const work = mkdtempSync(join(TMP, "d-"));
    expect(await packageCommand(work, ["write", src, "--created-at", "2026-11-01T00:00:00Z"], capture().out)).toBe(0);
    expect(existsSync(join(work, "cli-part-r2.uhdpkg"))).toBe(true);
    const v = capture(true);
    await packageCommand(work, ["verify", "cli-part-r2.uhdpkg"], v.out);
    expect((v.data[0] as { manifest: { createdAt: string } }).manifest.createdAt).toBe("2026-11-01T00:00:00Z");
  });

  it("verify fails with exit 1 on a damaged package, and read writes nothing", async () => {
    const src = envelopeFolder();
    const work = mkdtempSync(join(TMP, "bad-"));
    await packageCommand(work, ["write", src, "--out", "p.uhdpkg", "--stored"], capture().out);
    const bytes = readFileSync(join(work, "p.uhdpkg"));
    const at = bytes.indexOf(Buffer.from("glb bytes"));
    bytes[at] = 0x47; // "g" -> "G": same size, other bytes
    writeFileSync(join(work, "p.uhdpkg"), bytes);
    const v = capture(true);
    expect(await packageCommand(work, ["verify", "p.uhdpkg"], v.out)).toBe(1);
    const report = v.data[0] as { ok: boolean; problems: { code: string }[] };
    expect(report.ok).toBe(false);
    expect(report.problems.map((p) => p.code)).toEqual(expect.arrayContaining([expect.stringMatching(/ZIP_CRC|ENTRY_SHA256/)]));
    expect(await packageCommand(work, ["read", "p.uhdpkg", "out"], capture().out)).toBe(1);
    expect(existsSync(join(work, "out"))).toBe(false);
  });

  it("--exclude is for project parts; flags also come from the CLI's parsed flags", async () => {
    const src = envelopeFolder();
    await expect(packageCommand(TMP, ["write", src], capture().out, { exclude: ["cad/body.glb"] })).rejects.toThrow(/project part/);
    const work = mkdtempSync(join(TMP, "f-"));
    expect(await packageCommand(work, ["write", src], capture().out, { out: "flagged.uhdpkg" })).toBe(0);
    expect(existsSync(join(work, "flagged.uhdpkg"))).toBe(true);
  });

  it("refuses an output name Windows cannot hold", async () => {
    const src = envelopeFolder();
    const w = capture();
    expect(await packageCommand(TMP, ["write", src, "--out", 'bad"name.uhdpkg'], w.out)).toBe(1);
    expect(w.lines[0]).toMatch(/OUTPUT_NAME/);
  });

  it("usage errors", async () => {
    await expect(packageCommand(TMP, [], capture().out)).rejects.toThrow(PACKAGE_USAGE);
    await expect(packageCommand(TMP, ["read", "only-one.uhdpkg"], capture().out)).rejects.toThrow(PACKAGE_USAGE);
    await expect(packageCommand(TMP, ["write", "no-such-part"], capture().out)).rejects.toThrow(/not a Protoboard project|not a part/);
  });
});
