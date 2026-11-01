/**
 * A small zip writer and reader for `.uhdpkg` (PB-1195), with no dependency
 * beyond node:zlib. Stored (method 0) and deflated (method 8) entries only;
 * no zip64, no encryption, no multi-disk archives. The approach follows the
 * reader in `../stack-unpack.ts` (`zipEntries`), written here on its own so
 * the package code does not depend on the stack unpacker.
 *
 * The writer is deterministic: entries in the order given, every timestamp
 * the DOS epoch (1980-01-01 00:00), "made by" MS-DOS with no external
 * attributes (no Unix mode, so no exec bits and no symlinks), UTF-8 names.
 * The same entries give the same bytes (for the same zlib build: deflate
 * output is stable within one zlib version).
 *
 * The reader trusts nothing: every offset and size is bounds-checked, the
 * local header's name must equal the directory's, sizes and the CRC-32 are
 * checked after inflating, and inflation stops at the declared size.
 */
import * as zlib from "node:zlib";

/** One file to put in a zip. */
export interface ZipInput {
  name: string;
  data: Uint8Array;
  /** "deflate" (the default) falls back to "store" when deflating does not make the entry smaller. */
  method?: "store" | "deflate";
}

/** One entry of a zip's central directory, after the structural checks. */
export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  crc32: number;
  compressedSize: number;
  size: number;
  flags: number;
  /** Offset of the entry's data (after its local header). */
  dataOffset: number;
  /** The directory's external attributes (upper 16 bits: a Unix mode when made on Unix). */
  externalAttributes: number;
  /** The "version made by" host: 0 MS-DOS, 3 Unix, ... */
  madeBy: number;
}

export class ZipError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------

let table: Uint32Array | undefined;
function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (IEEE) by table: the fallback, and the reference the tests compare zlib.crc32 with. */
export function crc32Table(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC-32 (IEEE): zlib.crc32 where Node has it (22.2+), else the table. */
export function crc32(data: Uint8Array): number {
  const native = (zlib as unknown as { crc32?: (d: Uint8Array) => number }).crc32;
  if (typeof native === "function") return native(data) >>> 0;
  return crc32Table(data);
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/** DOS time 00:00:00 and date 1980-01-01: fixed so two writes are byte-identical. DEFAULT. */
const DOS_TIME = 0x0000;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Bit 11: names are UTF-8. */
const FLAG_UTF8 = 0x0800;
const VERSION_NEEDED = 20;
/** Made by MS-DOS (host 0), spec 2.0: no Unix mode in the external attributes. */
const VERSION_MADE_BY = 20;
const MAX_U32 = 0xffffffff;
const MAX_U16 = 0xffff;

/** A zip of the entries, in the order given. Throws past the zip (non-64) limits. */
export function writeZip(entries: readonly ZipInput[]): Buffer {
  if (entries.length >= MAX_U16) throw new ZipError("ZIP_TOO_MANY", `a zip without zip64 holds at most ${MAX_U16 - 1} entries`);
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    if (name.length > MAX_U16) throw new ZipError("ZIP_NAME", `${e.name}: name too long`);
    const data = Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    const crc = crc32(data);
    let method = 0;
    let packed: Buffer = data;
    if ((e.method ?? "deflate") === "deflate" && data.length > 0) {
      // DEFAULT: zlib's default level (6); deflated only when it saves bytes
      const d = zlib.deflateRawSync(data);
      if (d.length < data.length) {
        method = 8;
        packed = d;
      }
    }
    if (data.length >= MAX_U32 || packed.length >= MAX_U32 || offset >= MAX_U32) throw new ZipError("ZIP_TOO_LARGE", `${e.name}: past the 4 GB zip limit (zip64 is not written)`);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(VERSION_MADE_BY, 4);
    dir.writeUInt16LE(VERSION_NEEDED, 6);
    dir.writeUInt16LE(FLAG_UTF8, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    // extra 30, comment 32, disk 34, internal attributes 36, external attributes 38: all zero
    dir.writeUInt32LE(offset, 42);
    chunks.push(local, name, packed);
    central.push(dir, name);
    offset += local.length + name.length + packed.length;
  }
  const dirBytes = central.reduce((n, b) => n + b.length, 0);
  if (offset + dirBytes >= MAX_U32) throw new ZipError("ZIP_TOO_LARGE", "past the 4 GB zip limit (zip64 is not written)");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * The central directory, checked for structure: one disk, no zip64, every
 * header inside the archive, the local header agreeing with the directory,
 * no encryption, stored or deflated. Sizes, CRCs and names are the caller's
 * (and `readEntry`'s) to judge. `maxEntries` is checked before the directory
 * is walked.
 */
export function readZipDirectory(zip: Buffer, options: { maxEntries?: number } = {}): ZipEntry[] {
  if (zip.length < 22) throw new ZipError("ZIP_TRUNCATED", "not a zip (too short for its end record)");
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - MAX_U16); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError("ZIP_TRUNCATED", "not a zip, or a truncated one (no end-of-directory record)");
  const disk = zip.readUInt16LE(end + 4);
  const dirDisk = zip.readUInt16LE(end + 6);
  const onDisk = zip.readUInt16LE(end + 8);
  const count = zip.readUInt16LE(end + 10);
  const dirSize = zip.readUInt32LE(end + 12);
  const dirAt = zip.readUInt32LE(end + 16);
  const commentLength = zip.readUInt16LE(end + 20);
  if (count === MAX_U16 || dirAt === MAX_U32 || dirSize === MAX_U32) throw new ZipError("ZIP64", "a zip64 archive, which is not read here");
  if (disk !== 0 || dirDisk !== 0 || onDisk !== count) throw new ZipError("ZIP_MULTIDISK", "a multi-disk archive, which is not read here");
  if (end + 22 + commentLength !== zip.length) throw new ZipError("ZIP_TRAILING", "bytes after the zip's end record (a damaged or appended archive)");
  if (options.maxEntries !== undefined && count > options.maxEntries) throw new ZipError("CAP_ENTRIES", `${count} entries, more than the cap of ${options.maxEntries}`);
  if (dirAt + dirSize > end) throw new ZipError("ZIP_TRUNCATED", "the zip directory lies outside the archive (truncated?)");
  const out: ZipEntry[] = [];
  let at = dirAt;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== 0x02014b50) throw new ZipError("ZIP_DAMAGED", "the zip directory is damaged");
    const madeBy = zip.readUInt16LE(at + 4) >> 8;
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const startDisk = zip.readUInt16LE(at + 34);
    const externalAttributes = zip.readUInt32LE(at + 38);
    const local = zip.readUInt32LE(at + 42);
    if (at + 46 + nameLength > end) throw new ZipError("ZIP_DAMAGED", "the zip directory is damaged (a name runs past it)");
    const rawName = zip.subarray(at + 46, at + 46 + nameLength);
    const name = rawName.toString("utf8");
    if (!(flags & FLAG_UTF8) && rawName.some((b) => b > 0x7f)) throw new ZipError("ZIP_NAME_ENCODING", "an entry name is not marked UTF-8 and is not ASCII");
    if (Buffer.from(name, "utf8").compare(rawName) !== 0) throw new ZipError("ZIP_NAME_ENCODING", "an entry name is not valid UTF-8");
    if (compressedSize === MAX_U32 || size === MAX_U32 || local === MAX_U32) throw new ZipError("ZIP64", `${name}: zip64 sizes, which are not read here`);
    if (startDisk !== 0) throw new ZipError("ZIP_MULTIDISK", `${name}: on another disk`);
    if (flags & 0x0001 || flags & 0x0040) throw new ZipError("ZIP_ENCRYPTED", `${name} is encrypted`);
    if (method !== 0 && method !== 8) throw new ZipError("ZIP_METHOD", `${name} is packed with method ${method}; only stored and deflated entries are read`);
    if (method === 0 && compressedSize !== size) throw new ZipError("ZIP_DAMAGED", `${name}: a stored entry whose sizes differ`);
    if (local + 30 > dirAt || zip.readUInt32LE(local) !== 0x04034b50) throw new ZipError("ZIP_DAMAGED", `${name}: its local header is missing or damaged`);
    const localNameLength = zip.readUInt16LE(local + 26);
    const localExtra = zip.readUInt16LE(local + 28);
    const localMethod = zip.readUInt16LE(local + 8);
    const localName = zip.subarray(local + 30, local + 30 + localNameLength);
    if (localName.compare(rawName) !== 0) throw new ZipError("ZIP_NAME_MISMATCH", `${name}: the local header names a different file`);
    if (localMethod !== method) throw new ZipError("ZIP_DAMAGED", `${name}: the local header and the directory disagree on the method`);
    const dataOffset = local + 30 + localNameLength + localExtra;
    if (dataOffset + compressedSize > dirAt) throw new ZipError("ZIP_TRUNCATED", `${name}: its data runs past the archive (truncated?)`);
    out.push({ name, method, crc32: crc, compressedSize, size, flags, dataOffset, externalAttributes, madeBy });
    at += 46 + nameLength + extraLength + commentLen;
  }
  return out;
}

/**
 * An entry's bytes: inflated no further than its declared size, then its
 * size and CRC-32 checked.
 */
export function readEntry(zip: Buffer, e: ZipEntry): Buffer {
  const packed = zip.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
  let data: Buffer;
  if (e.method === 0) data = packed;
  else {
    try {
      // maxOutputLength: a lying directory cannot make this allocate past the declared size (+1 to see an overrun)
      data = zlib.inflateRawSync(packed, { maxOutputLength: Math.max(1, e.size + 1) });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ERR_BUFFER_TOO_LARGE" || /larger than|maxOutputLength/i.test((err as Error).message)) throw new ZipError("ZIP_SIZE", `${e.name} inflates past its declared size`);
      throw new ZipError("ZIP_DAMAGED", `${e.name} does not inflate (${(err as Error).message})`);
    }
  }
  if (data.length !== e.size) throw new ZipError("ZIP_SIZE", `${e.name}: ${data.length} bytes, not the declared ${e.size}`);
  if (crc32(data) !== e.crc32) throw new ZipError("ZIP_CRC", `${e.name}: CRC-32 does not match (damaged)`);
  return data;
}
