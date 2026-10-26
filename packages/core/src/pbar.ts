/**
 * The archive the .vsix carries the stack in (PB-929): a folder tree as one
 * Brotli stream, written by scripts/build-stack.ts and unpacked by the
 * extension (stackStore.ts). Node has Brotli built in, so neither side needs
 * a dependency, and it packs the stack's 18,000 small files to about a tenth.
 *
 * Inside the Brotli stream:
 *
 *   "PBAR1\n"
 *   then for each file: a 4-byte big-endian length, that many bytes of JSON
 *   ({ p: path with "/", m: mode, s: size }), then `s` bytes of content
 *   then a 4-byte zero.
 *
 * Files only: folders come from the paths, and there are no links (npm's
 * node_modules/.bin is left out when the archive is made). No VS Code API.
 */
import { createReadStream, createWriteStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { isInside, isInsideReal } from "./paths.js";
import { once } from "node:events";
import { constants, createBrotliCompress, createBrotliDecompress } from "node:zlib";

const MAGIC = Buffer.from("PBAR1\n");

export interface PackEntry {
  /** Path inside the archive, with "/". */
  path: string;
  /** The file to read. */
  file: string;
}

/** Every file below `dir` as archive entries (paths relative to `dir`, sorted), skipping what `skip` says. */
export function entriesOf(dir: string, skip: (path: string) => boolean = () => false, prefix = ""): PackEntry[] {
  const out: PackEntry[] = [];
  const walk = (at: string, rel: string) => {
    for (const d of readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = rel ? `${rel}/${d.name}` : d.name;
      if (skip(path)) continue;
      if (d.isDirectory()) walk(join(at, d.name), path);
      else if (d.isFile()) out.push({ path: prefix + path, file: join(at, d.name) });
    }
  };
  walk(dir, "");
  return out;
}

/** Write an archive. Returns its file count and the bytes it unpacks to. */
export async function pack(entries: PackEntry[], archive: string, options: { quality?: number } = {}): Promise<{ files: number; bytes: number }> {
  mkdirSync(dirname(archive), { recursive: true });
  const brotli = createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: options.quality ?? 9, [constants.BROTLI_PARAM_LGWIN]: 24 } });
  const file = createWriteStream(archive);
  brotli.pipe(file);
  const write = async (b: Buffer) => {
    if (!brotli.write(b)) await once(brotli, "drain");
  };
  let bytes = 0;
  await write(MAGIC);
  for (const e of entries) {
    const st = statSync(e.file);
    const content = readFileSync(e.file);
    const header = Buffer.from(JSON.stringify({ p: e.path, m: st.mode & 0o777, s: content.length }));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(header.length);
    await write(len);
    await write(header);
    await write(content);
    bytes += content.length;
  }
  await write(Buffer.alloc(4));
  brotli.end();
  await once(file, "finish");
  return { files: entries.length, bytes };
}

/**
 * Why an archive path may not be written, or undefined when it may (PB-1048):
 * a relative path with "/" between non-empty segments, none of them `.` or
 * `..`, and no backslash, colon (a drive, an NTFS stream) or NUL anywhere.
 */
export function archivePathProblem(path: unknown): string | undefined {
  if (typeof path !== "string" || path === "") return "an empty name";
  if (/[\\:\0]/.test(path)) return "a backslash, colon or NUL in a name";
  if (path.startsWith("/")) return "an absolute path";
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return "a `.`, `..` or empty segment";
  return undefined;
}

/**
 * Unpack an archive into `dest`. `onBytes` is told how many bytes have been
 * written so far (for a progress bar). A path that would leave `dest` stops
 * the unpacking (`archivePathProblem`, then the resolved path, links
 * followed, must lie inside `dest`): an archive can come from a .vsix someone
 * sent, and this keeps a damaged or hostile one harmless. Modes keep only
 * their permission bits.
 */
export async function unpack(archive: string, dest: string, onBytes: (written: number) => void = () => {}): Promise<{ files: number; bytes: number }> {
  const input = createReadStream(archive).pipe(createBrotliDecompress());
  let buf: Buffer = Buffer.alloc(0);
  let magic = false;
  let current: { path: string; mode: number; left: number; chunks: Buffer[] } | undefined;
  let files = 0;
  let bytes = 0;
  let done = false;
  const made = new Set<string>();
  const root = resolve(dest);
  const finish = (c: NonNullable<typeof current>) => {
    const to = resolve(root, ...c.path.split("/"));
    if (!isInside(root, to) || to === root) throw new Error(`the stack archive names a file outside its folder (${c.path})`);
    const dir = dirname(to);
    if (!made.has(dir)) {
      mkdirSync(dir, { recursive: true });
      if (!isInsideReal(root, dir)) throw new Error(`the stack archive names a file outside its folder (${c.path})`);
      made.add(dir);
    }
    writeFileSync(to, c.chunks.length === 1 ? c.chunks[0] : Buffer.concat(c.chunks), { mode: c.mode & 0o777 || 0o644, flag: "wx" });
    files++;
  };
  for await (const chunk of input as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (done) break;
      if (!magic) {
        if (buf.length < MAGIC.length) break;
        if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not a Protoboard stack archive");
        buf = buf.subarray(MAGIC.length);
        magic = true;
      }
      if (current) {
        if (current.left > 0) {
          if (!buf.length) break;
          const take = buf.subarray(0, Math.min(current.left, buf.length));
          current.chunks.push(take);
          current.left -= take.length;
          bytes += take.length;
          buf = buf.subarray(take.length);
        }
        if (current.left > 0) break;
        finish(current);
        current = undefined;
        continue;
      }
      if (buf.length < 4) break;
      const len = buf.readUInt32BE(0);
      if (len === 0) {
        done = true;
        break;
      }
      if (len > 65536) throw new Error("the stack archive is damaged (a header is too long)");
      if (buf.length < 4 + len) break;
      const h = JSON.parse(buf.subarray(4, 4 + len).toString("utf8")) as { p: string; m: number; s: number };
      const bad = archivePathProblem(h?.p);
      if (bad) throw new Error(`the stack archive names a file outside its folder (${bad}: ${JSON.stringify(h?.p)})`);
      if (!Number.isSafeInteger(h.s) || h.s < 0 || !Number.isInteger(h.m)) throw new Error("the stack archive is damaged (a header is not one it writes)");
      buf = buf.subarray(4 + len);
      current = { path: h.p, mode: h.m, left: h.s, chunks: [] };
    }
    onBytes(bytes);
  }
  if (!done) throw new Error("the stack archive ends early (a damaged or partly downloaded .vsix: install the extension again)");
  return { files, bytes };
}

/** `a/b` on every platform, for archive paths. */
export const archivePath = (p: string) => p.split(sep).join("/");
