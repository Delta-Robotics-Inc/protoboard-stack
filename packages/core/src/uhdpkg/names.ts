/**
 * Which entry names a `.uhdpkg` may hold (PB-1195). A name is a relative,
 * forward-slash path that is safe to create on Windows, macOS and Linux
 * alike, so a package that unpacks on one machine unpacks on every other.
 * Refused (each a reason string, so the report can say why):
 *
 * - empty, absolute (`/x`), a drive (`C:`, `C:\x`, `C:x`), a UNC or device
 *   prefix, a backslash anywhere, an empty, `.` or `..` segment, a trailing
 *   slash (a directory entry: packages carry files only);
 * - any of `< > : " | ? *`, a control character (U+0000 to U+001F, U+007F);
 * - a segment ending in a dot or a space;
 * - a segment whose name before its first dot is a Windows device name
 *   (CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9, and the superscript-digit
 *   forms), in any case, with or without an extension (`con.txt`);
 * - over the length caps (DEFAULT: 1024 bytes a name, 255 a segment).
 *
 * Duplicates are judged by `nameKey`: Unicode NFC, lower case, so names
 * that differ only in case or normalisation (the same file on Windows and
 * macOS) count as one.
 */

/** DEFAULT: the longest entry name, in UTF-8 bytes. */
export const MAX_NAME_BYTES = 1024;
/** DEFAULT: the longest path segment, in UTF-8 bytes (most file systems' limit). */
export const MAX_SEGMENT_BYTES = 255;

const DEVICE = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[<>:"|?*\u0000-\u001f\u007f]/;

/** Why a name may not be an entry, or undefined when it may. */
export function entryNameProblem(name: string, options: { maxNameBytes?: number } = {}): string | undefined {
  if (typeof name !== "string" || name === "") return "an empty name";
  const max = options.maxNameBytes ?? MAX_NAME_BYTES;
  if (Buffer.byteLength(name, "utf8") > max) return `longer than ${max} bytes`;
  if (name.includes("\\")) return "a backslash (paths use forward slashes)";
  if (name.startsWith("/")) return "an absolute path";
  if (/^[a-zA-Z]:/.test(name)) return "a drive letter";
  if (name.endsWith("/")) return "a directory entry (packages carry files only)";
  const segments = name.split("/");
  for (const s of segments) {
    if (s === "") return "an empty path segment";
    if (s === "." || s === "..") return `a "${s}" segment`;
    if (Buffer.byteLength(s, "utf8") > MAX_SEGMENT_BYTES) return `a segment longer than ${MAX_SEGMENT_BYTES} bytes`;
    const bad = BAD_CHARS.exec(s);
    if (bad) return bad[0].charCodeAt(0) < 0x20 || bad[0] === "\u007f" ? "a control character" : `the character ${bad[0]}`;
    if (/[. ]$/.test(s)) return "a segment ending in a dot or a space";
    if (DEVICE.test(s.split(".")[0].trimEnd())) return `a Windows device name (${s})`;
  }
  return undefined;
}

/** The key two names collide under: NFC, lower case. */
export const nameKey = (name: string): string => name.normalize("NFC").toLowerCase();

/**
 * Names that cannot all be files: the same key twice, or one name a folder
 * of another (`a` and `a/b`). Returns one message per clash.
 */
export function nameClashes(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const n of names) {
    const k = nameKey(n);
    const prev = seen.get(k);
    if (prev !== undefined) out.push(prev === n ? `${n} appears twice` : `${n} and ${prev} are the same file on a case-insensitive file system`);
    else seen.set(k, n);
  }
  const folders = new Map<string, string>();
  for (const n of names) {
    const parts = nameKey(n).split("/");
    for (let i = 1; i < parts.length; i++) folders.set(parts.slice(0, i).join("/"), n);
  }
  for (const n of names) {
    const by = folders.get(nameKey(n));
    if (by !== undefined) out.push(`${n} is a file, and ${by} needs it to be a folder`);
  }
  return out;
}

/**
 * Whether the directory's external attributes mark the entry as something
 * other than a plain file: a Unix symlink, directory, device or socket
 * (made on Unix, mode in the upper 16 bits), or the MS-DOS directory bit.
 */
export function attributesProblem(externalAttributes: number, madeBy: number): string | undefined {
  if (externalAttributes & 0x10) return "marked as a directory";
  if (madeBy === 3) {
    const mode = (externalAttributes >>> 16) & 0xffff;
    const type = mode & 0o170000;
    if (type === 0o120000) return "a symbolic link";
    if (type !== 0 && type !== 0o100000) return "not a plain file (a directory, device, pipe or socket)";
  }
  return undefined;
}
