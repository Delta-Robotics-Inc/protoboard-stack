/**
 * Reading (unpacking) a `.uhdpkg` (PB-1195) into a folder. Everything
 * `verify` checks is checked; files are written only once their bytes match
 * the envelope, into a temporary folder beside the target that is renamed
 * into place when the whole package passed. A package that fails leaves
 * nothing behind.
 *
 * Containment (zip-slip): every name has already passed the name rules
 * (names.ts: no absolute paths, drives, backslashes, `..`, device names),
 * and each file's resolved path is checked again to lie inside the real
 * path of the temporary folder, as is each folder created for it. Files are
 * created with "wx" (never through an existing file or link) and mode 0o644:
 * nothing unpacked is executable, and nothing unpacked is ever run, imported
 * or evaluated.
 */
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { MANIFEST_NAME, capsWith, type UhdpkgCaps } from "./manifest.js";
import { UhdpkgError } from "./write.js";
import { inspectPackage, type PackageReport } from "./verify.js";

export interface ReadResult {
  report: PackageReport;
  /** The folder written, when the package passed. */
  target?: string;
  /** Files written (the manifest included). */
  written: number;
}

/** Check a package file without writing anything. */
export function verifyPackageFile(file: string, options: { caps?: Partial<UhdpkgCaps> } = {}): PackageReport {
  const caps = capsWith(options.caps);
  const size = statSync(file).size;
  // the archive's size is judged before it is read
  if (size > caps.maxArchiveBytes)
    return { ok: false, archiveBytes: size, totalBytes: 0, entries: [], problems: [{ code: "CAP_ARCHIVE", message: `the archive is ${size} bytes, over the cap of ${caps.maxArchiveBytes}` }], warnings: [] };
  return inspectPackage(readFileSync(file), { caps });
}

function writeInside(root: string, rel: string, bytes: Uint8Array): void {
  const abs = resolve(root, ...rel.split("/"));
  if (!abs.startsWith(root + sep)) throw new UhdpkgError("PATH_ESCAPE", `${rel} resolves outside the target folder`);
  const parent = dirname(abs);
  mkdirSync(parent, { recursive: true, mode: 0o755 });
  const realParent = realpathSync(parent);
  if (realParent !== root && !realParent.startsWith(root + sep)) throw new UhdpkgError("PATH_ESCAPE", `${rel}: its folder resolves outside the target folder`);
  const fd = openSync(abs, "wx", 0o644);
  try {
    let at = 0;
    while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
  } finally {
    closeSync(fd);
  }
}

/**
 * Unpack `file` into `target`, which must not exist yet or be an empty
 * folder (DEFAULT: a package never writes over files). The folder gets
 * `uhdpkg.json` and every file at its envelope path (so `write` can pack
 * it again, byte for byte).
 */
export function readPackage(file: string, target: string, options: { caps?: Partial<UhdpkgCaps> } = {}): ReadResult {
  const caps = capsWith(options.caps);
  const dest = resolve(target);
  if (existsSync(dest) && (!statSync(dest).isDirectory() || readdirSync(dest).length > 0)) throw new UhdpkgError("TARGET_EXISTS", `${target} exists and is not an empty folder; a package is unpacked into a new folder`);
  const size = statSync(file).size;
  if (size > caps.maxArchiveBytes) return { report: verifyPackageFile(file, options), written: 0 };
  const zip = readFileSync(file);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = realpathSync(mkdtempSync(join(dirname(dest), ".uhdpkg-")));
  let written = 0;
  let manifest: Buffer | undefined;
  let report: PackageReport;
  try {
    report = inspectPackage(zip, {
      caps,
      onManifest: (bytes) => (manifest = bytes),
      onFile: (f, bytes) => {
        writeInside(tmp, f.path, bytes);
        written++;
      },
    });
    if (!report.ok) {
      rmSync(tmp, { recursive: true, force: true });
      return { report, written: 0 };
    }
    writeInside(tmp, MANIFEST_NAME, manifest!);
    written++;
    // an empty target folder goes (rmdir refuses a folder that filled up meanwhile)
    if (existsSync(dest)) rmdirSync(dest);
    if (existsSync(dest)) throw new UhdpkgError("TARGET_EXISTS", `${target} appeared while unpacking`);
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return { report, target: dest, written };
}
