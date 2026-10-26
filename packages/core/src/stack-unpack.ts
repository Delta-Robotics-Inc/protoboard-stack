/**
 * The stack the extension carries (PB-929, docs/specs/distribution.md): what
 * is in the .vsix (dist/stack/, built by vscode-protoboard's
 * scripts/build-stack.ts), and unpacking it once per version into the user's
 * Protoboard folder, where projects link to it and terminals find its
 * `protoboard` command. The extension unpacks it when it starts; the CLI's
 * `protoboard stack unpack` does the same from an installed extension's
 * folder or a .vsix (PB-1024), and `protoboard stack` finds installed
 * extensions whose stack is not unpacked yet.
 *
 *   <home>/stack/<version>/        the unpacked tree (core's stack.ts describes it)
 *   <home>/bin/protoboard          the command for terminals
 *   <home>/runtime                 the path of VS Code's own runtime, for machines without Node.js
 *
 * No VS Code API here: the unit tests run it directly.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { BuildStamp } from "./build-info.js";
import { STACK_MARKER, compareVersions, readStack, stackCli, stackDir, writeCommands, type Stack, type StackMarker } from "./stack.js";
import { unpack } from "./pbar.js";
import { ensurePrivateDir } from "./private-dir.js";

interface Archive {
  file: string;
  files: number;
  /** Bytes it unpacks to. */
  unpacked: number;
  /** Bytes in the .vsix. */
  bytes: number;
  sha256: string;
}

/** dist/stack/stack.json. */
export interface CarriedManifest {
  schema: "protoboard.carried-stack/v1";
  version: string;
  uhd: string;
  packages: Record<string, string>;
  /** `linux-x64`, `darwin-arm64`, …: the platforms whose native modules are carried. */
  platforms: string[];
  digest: string;
  archives: { main: Archive; native: Record<string, Archive> };
  /** What the build was made from (build-info.ts), stamped by scripts/build-stack.ts; absent in older builds. */
  build?: BuildStamp;
}

/** A strict semantic version (semver.org 2.0.0): the stack's folder is named after it, so nothing else may stand there. */
export const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** An archive's file name in dist/stack: a plain name, never a path. */
const ARCHIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Why a stack.json is not one to unpack, or undefined (PB-1048): its version
 * names the folder it goes to (`<home>/stack/<version>`) and its archives
 * name files beside it, so a version that is not strict semver or an archive
 * that is not a plain file name is refused.
 */
export function manifestProblem(m: unknown): string | undefined {
  const x = m as Partial<CarriedManifest> | undefined;
  if (x?.schema !== "protoboard.carried-stack/v1") return "it is not a protoboard.carried-stack/v1 stack.json";
  if (typeof x.version !== "string" || x.version.length > 64 || !STRICT_SEMVER.test(x.version)) return `its version ${JSON.stringify(x.version)} is not a semantic version`;
  if (typeof x.digest !== "string" || !x.digest) return "it has no digest";
  const archives = [x.archives?.main, ...Object.values(x.archives?.native ?? {})];
  for (const a of archives) if (!a || typeof a.file !== "string" || !ARCHIVE_NAME.test(a.file) || typeof a.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(a.sha256)) return "it names an archive that is not a plain file with a SHA-256";
  return undefined;
}

/** The stack this build of the extension carries; undefined for a development build made without `npm run build:stack`, or a stack.json that `manifestProblem` refuses. */
export function carriedManifest(extensionPath: string): CarriedManifest | undefined {
  try {
    const m = JSON.parse(readFileSync(join(extensionPath, "dist", "stack", "stack.json"), "utf8")) as CarriedManifest;
    return manifestProblem(m) ? undefined : m;
  } catch {
    return undefined;
  }
}

/** Thrown when a copy of the same version from another build is in the way and replacing it was not agreed to. */
export class StackReplaceRefused extends Error {
  readonly code = "PB_STACK_REPLACE_REFUSED";
  constructor(
    readonly version: string,
    readonly dir: string,
    readonly existing: string | undefined,
    readonly incoming: string,
  ) {
    super(`${dir} already holds the Protoboard stack ${version} from another build (digest ${existing?.slice(0, 12) ?? "unknown"}…, this one ${incoming.slice(0, 12)}…). Projects linked to it would run the new build's code: replace it only if you trust where this file came from (protoboard stack unpack --replace)`);
  }
}

/** The carried stack's unpacked copy, when it is there and is this build's (same digest, this platform). */
export function unpackedCarried(home: string, manifest: CarriedManifest, platform = `${process.platform}-${process.arch}`): Stack | undefined {
  const s = readStack(stackDir(home, manifest.version));
  return s && s.marker.source === "vsix" && s.marker.digest === manifest.digest && s.marker.platform === platform ? s : undefined;
}

/**
 * An archive is the one the build wrote (stack.json names its SHA-256): a
 * .vsix that was cut short or changed on the way is refused before anything
 * of it is unpacked.
 */
async function verifyArchive(file: string, expected: string): Promise<void> {
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  } catch (e) {
    throw new Error(`the stack archive ${basename(file)} cannot be read (${(e as Error).message}): install the Protoboard extension again`);
  }
  const got = hash.digest("hex");
  if (got !== expected) throw new Error(`the stack archive ${basename(file)} is not the one this extension was built with (its SHA-256 is ${got.slice(0, 12)}…, stack.json says ${expected.slice(0, 12)}…): the .vsix is damaged or was changed. Install the Protoboard extension again from where you got it`);
}

export interface UnpackOptions {
  platform?: string;
  /**
   * Whether a complete copy of the same version from another build (another
   * digest) may be replaced (PB-1048): true, or asked through the function.
   * Unset or false refuses with StackReplaceRefused. A copy of the same build
   * (for another platform) or an incomplete one is always replaced.
   */
  replace?: boolean | ((existing: Stack, incoming: CarriedManifest) => boolean | Promise<boolean>);
  /** 0..1, and what is being done. */
  onProgress?: (fraction: number, what: string) => void;
  now?: string;
}

/**
 * Unpack the carried stack into `<home>/stack/<version>` unless it is there
 * already. It is written beside its final place and moved in when complete,
 * so a window that is closed halfway leaves nothing that looks installed, and
 * two windows doing it at once both end with one good copy.
 */
export async function ensureCarried(extensionPath: string, home: string, options: UnpackOptions = {}): Promise<{ stack: Stack; unpacked: boolean }> {
  const manifest = carriedManifest(extensionPath);
  if (!manifest) throw new Error("this build of the Protoboard extension carries no stack (a development build): a project uses its own installed packages or a Protoboard installed for your user, or set protoboard.cliPath");
  const platform = options.platform ?? `${process.platform}-${process.arch}`;
  const have = unpackedCarried(home, manifest, platform);
  if (have) return { stack: have, unpacked: false };
  const native = manifest.archives.native[platform];
  if (!native) {
    throw new Error(
      `the Protoboard extension carries its stack for ${manifest.platforms.join(", ")}, not for ${platform}. On this machine Protoboard comes from npm instead: it needs Node.js 22 or later and access to a registry that has the packages (Protoboard: Install the Stack Version the Project Pins)`,
    );
  }
  const dir = stackDir(home, manifest.version);
  const existing = readStack(dir);
  if (existing && existing.marker.digest !== manifest.digest) {
    const agreed = typeof options.replace === "function" ? await options.replace(existing, manifest) : options.replace === true;
    if (!agreed) throw new StackReplaceRefused(manifest.version, dir, existing.marker.digest, manifest.digest);
  }
  const tmp = `${dir}.unpacking-${process.pid}`;
  ensurePrivateDir(home);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const total = manifest.archives.main.unpacked + native.unpacked;
  const say = options.onProgress ?? (() => {});
  try {
    say(0, `Checking the Protoboard stack ${manifest.version}`);
    await verifyArchive(join(extensionPath, "dist", "stack", manifest.archives.main.file), manifest.archives.main.sha256);
    await verifyArchive(join(extensionPath, "dist", "stack", native.file), native.sha256);
    say(0, `Unpacking the Protoboard stack ${manifest.version}`);
    await unpack(join(extensionPath, "dist", "stack", manifest.archives.main.file), tmp, (n) => say(n / total, `Unpacking the Protoboard stack ${manifest.version}`));
    await unpack(join(extensionPath, "dist", "stack", native.file), tmp, (n) => say((manifest.archives.main.unpacked + n) / total, `Unpacking the native modules for ${platform}`));
    const marker: StackMarker = { schema: "protoboard.stack/v1", version: manifest.version, source: "vsix", packages: manifest.packages, digest: manifest.digest, platform, ...(manifest.build ? { build: manifest.build } : {}), installedAt: options.now ?? new Date().toISOString() };
    writeFileSync(join(tmp, STACK_MARKER), JSON.stringify(marker, null, 2) + "\n");
    // an older build of the same version (a rebuilt .vsix) steps aside; projects linked to this path follow
    let old: string | undefined;
    if (existsSync(dir)) {
      old = `${dir}.replaced-${process.pid}`;
      renameSync(dir, old);
    }
    try {
      renameSync(tmp, dir);
    } catch (e) {
      // another window finished first: its copy is the same build
      const theirs = unpackedCarried(home, manifest, platform);
      if (!theirs) throw e;
    }
    if (old) rmSync(old, { recursive: true, force: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const stack = unpackedCarried(home, manifest, platform);
  if (!stack) throw new Error(`the Protoboard stack was unpacked to ${dir}, but it is not complete there (is the disk full?)`);
  say(1, `The Protoboard stack ${manifest.version} is in ${dir}`);
  return { stack, unpacked: true };
}

/** One file of a zip (a .vsix is one). Stored and deflated entries only; no zip64, which a .vsix of this size never is. */
function zipEntries(zip: Buffer): Map<string, () => Buffer> {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a .vsix file (no zip directory)");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error("this .vsix is a zip64 file, which is not read here");
  const out = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("the .vsix file is damaged (its zip directory)");
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    out.set(name, () => {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`the .vsix file is damaged (${name})`);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + packed);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`the .vsix file packs ${name} in a way that is not read here (method ${method})`);
    });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return out;
}

/**
 * The stack another .vsix of the Protoboard extension carries, unpacked into
 * `<home>/stack/<version>` without installing that extension (resolution
 * step 3 for a machine with no npm and no registry: a project that pins an
 * older stack gets it from the .vsix of that version). The archives are
 * checked and unpacked exactly as this extension's own are.
 */
export async function ensureFromVsix(vsix: string, home: string, options: UnpackOptions & { /** The version this extension carries itself: its copy is never replaced from another file. */ exceptVersion?: string } = {}): Promise<{ stack: Stack; unpacked: boolean; manifest: CarriedManifest }> {
  let entries: Map<string, () => Buffer>;
  try {
    entries = zipEntries(readFileSync(vsix));
  } catch (e) {
    throw new Error(`${basename(vsix)}: ${(e as Error).message}`);
  }
  const inside = "extension/dist/stack/";
  const read = entries.get(`${inside}stack.json`);
  if (!read) throw new Error(`${basename(vsix)} carries no Protoboard stack (it is not a Protoboard extension, or it is the small build without the stack)`);
  const tmp = mkdtempSync(join(tmpdir(), "protoboard-vsix-"));
  try {
    const to = join(tmp, "dist", "stack");
    mkdirSync(to, { recursive: true });
    writeFileSync(join(to, "stack.json"), read());
    const manifest = carriedManifest(tmp);
    if (!manifest) {
      let why = "it cannot be read";
      try {
        why = manifestProblem(JSON.parse(read().toString("utf8"))) ?? why;
      } catch {}
      throw new Error(`${basename(vsix)}: its stack.json is not one this extension reads (${why})`);
    }
    if (manifest.version === options.exceptVersion) throw new Error(`${basename(vsix)} carries the stack ${manifest.version}, which is the one this extension carries itself: there is nothing to add`);
    const platform = options.platform ?? `${process.platform}-${process.arch}`;
    for (const a of [manifest.archives.main, manifest.archives.native[platform]]) {
      if (!a) continue; // ensureCarried says which platforms it has
      if (!ARCHIVE_NAME.test(a.file) || a.file !== basename(a.file)) throw new Error(`${basename(vsix)}: its stack.json names a file outside its folder`);
      const file = entries.get(inside + a.file);
      if (!file) throw new Error(`${basename(vsix)} is incomplete: ${a.file} is missing`);
      writeFileSync(join(to, a.file), file());
    }
    return { ...(await ensureCarried(tmp, home, options)), manifest };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * What terminals and projects' own commands need outside the copy itself:
 * `<home>/runtime` (the executable to run as Node when the machine has no
 * Node.js 22: VS Code's, or in a remote window the server's node) and
 * `<home>/bin/protoboard`. Written at every activation: VS Code's path
 * changes when it updates (a snap revision, a server build).
 */
export function writeHome(home: string, options: { runtime: string; version: string; platform?: NodeJS.Platform }): { bin: string; commands: string[] } {
  ensurePrivateDir(home);
  writeFileSync(join(home, "runtime"), `${options.runtime}\n`);
  const bin = join(home, "bin");
  const commands = writeCommands(bin, { kind: "home", cli: stackCli(stackDir(home, options.version)), home, ...(options.platform ? { platform: options.platform } : {}) });
  return { bin, commands };
}

// ---------------------------------------------------------------- installed extensions (PB-1024)

/** The extension's folder name: `<publisher>.<name>-<version>`, with a platform after it for a platform build. */
const EXTENSION_FOLDER = /^deltarobotics\.vscode-protoboard-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(?:-(?:linux|darwin|win32|alpine|web)-[a-z0-9]+)?$/;

/** Where editors keep their extensions, under the user's home folder: VS Code, Insiders, VSCodium, Cursor, Windsurf, and a remote window's server. */
export const EDITOR_EXTENSION_DIRS = [".vscode/extensions", ".vscode-insiders/extensions", ".vscode-oss/extensions", ".cursor/extensions", ".windsurf/extensions", ".vscode-server/extensions", ".cursor-server/extensions", ".windsurf-server/extensions"];

export interface InstalledExtension {
  /** The extension's folder (what `protoboard stack unpack` takes). */
  dir: string;
  /** The extension's version. */
  version: string;
  /** The stack it carries; undefined for a build without one. */
  carried?: CarriedManifest;
  /** Its carried stack is in `<home>/stack/<version>` (this build, this platform). */
  unpacked: boolean;
}

/**
 * The Protoboard extensions installed in this user's editors, newest first.
 * `extensionDirs` replaces the editors' usual folders (`VSCODE_EXTENSIONS`
 * names one more, as VS Code's own `--extensions-dir` does).
 */
export function installedExtensions(stackHomeDir: string, options: { userHome?: string; extensionDirs?: string[]; env?: NodeJS.ProcessEnv; platform?: string } = {}): InstalledExtension[] {
  const userHome = options.userHome ?? homedir();
  const env = options.env ?? process.env;
  const roots = options.extensionDirs ?? [...EDITOR_EXTENSION_DIRS.map((d) => join(userHome, d)), ...(env.VSCODE_EXTENSIONS ? [env.VSCODE_EXTENSIONS] : [])];
  const out: InstalledExtension[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const m = EXTENSION_FOLDER.exec(name);
      const dir = join(root, name);
      if (!m || seen.has(dir) || !existsSync(join(dir, "package.json"))) continue;
      seen.add(dir);
      const carried = carriedManifest(dir);
      out.push({ dir, version: m[1]!, ...(carried ? { carried } : {}), unpacked: carried ? !!unpackedCarried(stackHomeDir, carried, options.platform) : false });
    }
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Unpack the stack an installed extension's folder or a .vsix carries into
 * `<home>/stack/<version>` (`protoboard stack unpack`): the archives are
 * checked against the digests the build recorded and unpacked as the
 * extension itself does. A copy of that build already there is kept.
 */
export async function unpackStackFrom(path: string, home: string, options: UnpackOptions = {}): Promise<{ stack: Stack; unpacked: boolean; version: string; from: "vsix" | "extension" }> {
  if (/\.vsix$/i.test(path)) {
    if (!existsSync(path)) throw new Error(`there is no file ${path}`);
    const r = await ensureFromVsix(path, home, options);
    return { stack: r.stack, unpacked: r.unpacked, version: r.manifest.version, from: "vsix" };
  }
  if (!existsSync(join(path, "package.json"))) throw new Error(`${path} is neither a .vsix file nor an installed extension's folder (it has no package.json)`);
  const manifest = carriedManifest(path);
  if (!manifest) throw new Error(`${path} carries no Protoboard stack (it is not the Protoboard extension, or a development build without its stack)`);
  const r = await ensureCarried(path, home, options);
  return { ...r, version: manifest.version, from: "extension" };
}
