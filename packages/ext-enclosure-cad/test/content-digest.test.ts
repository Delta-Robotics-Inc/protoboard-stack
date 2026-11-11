/**
 * The digest an enclosure job records for each body it holds ignores the ids
 * the export writes into glTF extras (PB-1173): adding them to a board.glb
 * changes no geometry, so it must not make the enclosure around it stale.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glbContentDigest, sha256File } from "../lib/job.ts";

/** A GLB the way the exports write one: compact JSON chunk padded with spaces, then a BIN chunk. */
function glb(json: unknown, bin = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])): Buffer {
  const text = Buffer.from(JSON.stringify(json), "utf8");
  const chunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + chunk.length + 8 + bin.length, 8);
  head.writeUInt32LE(chunk.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, chunk, binHead, bin]);
}

describe("glbContentDigest", () => {
  const dir = mkdtempSync(join(tmpdir(), "pb-enc-digest-"));
  const plain = { asset: { version: "2.0" }, nodes: [{ name: "board" }, { name: "U1", extras: { lcsc: "C1" } }], scenes: [{ nodes: [0, 1] }] };
  const withIds = { asset: { version: "2.0" }, nodes: [{ name: "board", extras: { protoboard: { partInstanceId: "" } } }, { name: "U1", extras: { lcsc: "C1", protoboard: { partInstanceId: "u1" } } }], scenes: [{ nodes: [0, 1] }] };
  const a = join(dir, "a.glb");
  const b = join(dir, "b.glb");
  writeFileSync(a, glb(plain));
  writeFileSync(b, glb(withIds));

  it("is the file's sha256 for a GLB without ids (jobs recorded before them still match)", () => {
    expect(glbContentDigest(a)).toBe(sha256File(a));
  });

  it("is the same for the same geometry with ids in extras, and other extras are kept", () => {
    expect(sha256File(b)).not.toBe(sha256File(a));
    expect(glbContentDigest(b)).toBe(sha256File(a));
  });

  it("changes when the geometry does", () => {
    const c = join(dir, "c.glb");
    writeFileSync(c, glb(withIds, Buffer.from([1, 2, 3, 4, 5, 6, 7, 9])));
    expect(glbContentDigest(c)).not.toBe(glbContentDigest(b));
    rmSync(dir, { recursive: true, force: true });
  });
});
