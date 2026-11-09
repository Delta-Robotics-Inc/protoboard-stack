/**
 * A minimal ZIP reader (PKWARE APPNOTE): the end-of-central-directory record, the central directory, and each
 * entry's local header, with stored (0) and deflated (8) entries inflated through Node's zlib. EasyEDA Pro exports
 * are ordinary ZIP archives. ZIP64, encryption and multi-disk archives are refused with a plain error.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's local header. */
  offset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

/** Whether the bytes start like a ZIP archive (a local file header or an empty archive). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
}

export class ZipReader {
  private readonly view: DataView;
  readonly entries: ZipEntry[];

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.entries = this.readDirectory();
  }

  private readDirectory(): ZipEntry[] {
    const v = this.view;
    const n = this.bytes.length;
    // the EOCD record is at least 22 bytes and may be followed by a comment of up to 65535 bytes
    let eocd = -1;
    for (let i = n - 22; i >= Math.max(0, n - 22 - 0xffff); i--) {
      if (v.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError("not a ZIP archive: no end of central directory record");
    const disk = v.getUint16(eocd + 4, true);
    const count = v.getUint16(eocd + 10, true);
    const cdSize = v.getUint32(eocd + 12, true);
    const cdOffset = v.getUint32(eocd + 16, true);
    if (disk !== 0) throw new ZipError("multi-disk ZIP archives are not supported");
    if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipError("ZIP64 archives are not supported");
    const out: ZipEntry[] = [];
    const dec = new TextDecoder("utf-8");
    let p = cdOffset;
    for (let k = 0; k < count; k++) {
      if (p + 46 > n || v.getUint32(p, true) !== SIG_CEN) throw new ZipError(`corrupt ZIP central directory at entry ${k}`);
      const flags = v.getUint16(p + 8, true);
      const method = v.getUint16(p + 10, true);
      const compressedSize = v.getUint32(p + 20, true);
      const size = v.getUint32(p + 24, true);
      const nameLen = v.getUint16(p + 28, true);
      const extraLen = v.getUint16(p + 30, true);
      const commentLen = v.getUint16(p + 32, true);
      const offset = v.getUint32(p + 42, true);
      const name = dec.decode(this.bytes.subarray(p + 46, p + 46 + nameLen));
      if (flags & 1) throw new ZipError(`encrypted ZIP entry ${name} is not supported`);
      if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError("ZIP64 archives are not supported");
      out.push({ name, method, compressedSize, size, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /** The names of the file entries (folders left out). */
  names(): string[] {
    return this.entries.filter((e) => !e.name.endsWith("/")).map((e) => e.name);
  }

  has(name: string): boolean {
    return this.entries.some((e) => e.name === name);
  }

  /** An entry's uncompressed bytes. */
  read(name: string): Uint8Array {
    const e = this.entries.find((x) => x.name === name);
    if (!e) throw new ZipError(`no entry ${name} in the archive`);
    const v = this.view;
    if (v.getUint32(e.offset, true) !== SIG_LOC) throw new ZipError(`corrupt local header for ${name}`);
    const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
    const raw = this.bytes.subarray(start, start + e.compressedSize);
    if (e.method === 0) return raw;
    if (e.method === 8) {
      const outBytes = inflateRawSync(raw);
      if (outBytes.length !== e.size) throw new ZipError(`entry ${name} inflated to ${outBytes.length} bytes, expected ${e.size}`);
      return outBytes;
    }
    throw new ZipError(`entry ${name} uses compression method ${e.method}, which is not supported`);
  }

  /** An entry as UTF-8 text (a leading byte order mark removed). */
  text(name: string): string {
    const s = new TextDecoder("utf-8").decode(this.read(name));
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }
}

/**
 * A ZIP archive of the given files, stored or deflated (for tests and fixtures: synthetic samples are written with
 * it, so no binary fixture is committed).
 */
export function writeZip(files: Record<string, string | Uint8Array>, options: { deflate?: boolean } = {}): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const nameBytes = enc.encode(name);
    const method = options.deflate ? 8 : 0;
    const body = method === 8 ? deflate(data) : data;
    const crc = crc32(data);
    const loc = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, SIG_LOC, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    loc.set(nameBytes, 30);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, SIG_CEN, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    locals.push(loc, body);
    centrals.push(cen);
    offset += loc.length + body.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const deflate = (data: Uint8Array): Uint8Array => deflateRawSync(data);

let CRC_TABLE: Uint32Array | undefined;
function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
