/**
 * The stack the extension carries (PB-929): the archive format round trip,
 * unpacking once per build into the user's Protoboard folder, and the
 * terminal's command.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { STACK_MARKER, listStacks, stackCli, stackDir } from "@protoboardai/core/stack";
import { archivePathProblem, entriesOf, pack, unpack } from "../src/pbar.js";
import { StackReplaceRefused, carriedManifest, ensureCarried, ensureFromVsix, manifestProblem, installedExtensions, unpackStackFrom, unpackedCarried, writeHome, type CarriedManifest } from "../src/stackStore.js";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-carried-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const put = (file: string, content: string | Buffer, mode?: number) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
  if (mode) chmodSync(file, mode);
};

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** A zip as vsce writes a .vsix: deflated entries (the first one stored), sizes in the directory. */
function zip(files: Record<string, Buffer>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  Object.entries(files).forEach(([name, content], i) => {
    const method = i === 0 ? 0 : 8;
    const data = method ? deflateRawSync(content) : content;
    const n = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc32(content), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(content.length, 22);
    head.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(crc32(content), 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(content.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, n, data);
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  });
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBytes, end]);
}

/** A stand-in .vsix file made from a stand-in extension folder. */
function fakeVsix(ext: string, name: string, leaveOut: string[] = []): string {
  const files: Record<string, Buffer> = { "extension/package.json": Buffer.from("{}") };
  for (const f of ["stack.json", "stack.pbar.br", "native-test-x64.pbar.br"]) if (!leaveOut.includes(f)) files[`extension/dist/stack/${f}`] = readFileSync(join(ext, "dist/stack", f));
  const file = join(TMP, name);
  writeFileSync(file, zip(files));
  return file;
}

/** A stand-in .vsix folder: dist/stack with a small tree and one platform's native files. */
async function fakeExtension(name: string, version: string, cliSays = "v1") {
  const ext = join(TMP, name);
  const tree = join(TMP, `${name}-tree`);
  put(join(tree, "node_modules/@protoboardai/cli/bin/protoboard.mjs"), `console.log("${cliSays}");\n`);
  put(join(tree, "node_modules/@protoboardai/cli/package.json"), JSON.stringify({ name: "@protoboardai/cli", version }));
  put(join(tree, "node_modules/x/lib.js.map"), "left out");
  put(join(tree, "node_modules/.bin/protoboard"), "left out");
  put(join(tree, "node_modules/empty/file"), "");
  const native = join(TMP, `${name}-native`);
  put(join(native, "node_modules/@esbuild/test/bin/esbuild"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 255]), 0o755);
  const skip = (p: string) => p.endsWith(".map") || p === "node_modules/.bin";
  const main = await pack(entriesOf(tree, skip), join(ext, "dist/stack/stack.pbar.br"));
  const nat = await pack(entriesOf(native), join(ext, "dist/stack/native-test-x64.pbar.br"));
  const manifest: CarriedManifest = {
    schema: "protoboard.carried-stack/v1",
    version,
    uhd: "0.2.1",
    packages: { "@protoboardai/cli": version },
    platforms: ["test-x64"],
    digest: `digest-${cliSays}`,
    archives: {
      main: { file: "stack.pbar.br", files: main.files, unpacked: main.bytes, bytes: 1, sha256: sha(join(ext, "dist/stack/stack.pbar.br")) },
      native: { "test-x64": { file: "native-test-x64.pbar.br", files: nat.files, unpacked: nat.bytes, bytes: 1, sha256: sha(join(ext, "dist/stack/native-test-x64.pbar.br")) } },
    },
    build: { schema: "protoboard.build-info/v1", version, commit: "c".repeat(40), dirty: false, branch: "main", builtAt: "2026-10-23T00:00:00.000Z" },
  };
  put(join(ext, "dist/stack/stack.json"), JSON.stringify(manifest));
  return ext;
}

describe("the archive", () => {
  it("round-trips a tree: contents, empty files, binary files and the executable bit", async () => {
    const from = join(TMP, "rt-from");
    put(join(from, "a/b/text.txt"), "hello\n");
    put(join(from, "a/empty"), "");
    const big = Buffer.alloc(300_000, 7);
    big[12345] = 9;
    put(join(from, "big.bin"), big);
    put(join(from, "bin/tool"), "#!/bin/sh\n", 0o755);
    const archive = join(TMP, "rt.pbar.br");
    expect(await pack(entriesOf(from), archive)).toEqual({ files: 4, bytes: 6 + 300_000 + 10 });
    const to = join(TMP, "rt-to");
    const seen: number[] = [];
    expect(await unpack(archive, to, (n) => seen.push(n))).toEqual({ files: 4, bytes: 300_016 });
    expect(readFileSync(join(to, "a/b/text.txt"), "utf8")).toBe("hello\n");
    expect(statSync(join(to, "a/empty")).size).toBe(0);
    expect(readFileSync(join(to, "big.bin")).equals(big)).toBe(true);
    if (process.platform !== "win32") expect(statSync(join(to, "bin/tool")).mode & 0o111).toBe(0o111);
    expect(seen.at(-1)).toBe(300_016);
  });

  it("refuses a file that is not an archive, one that ends early, and a path that leaves the folder", async () => {
    put(join(TMP, "junk.br"), "not brotli at all");
    await expect(unpack(join(TMP, "junk.br"), join(TMP, "junk-out"))).rejects.toThrow();
    const from = join(TMP, "cut-from");
    put(join(from, "f"), Buffer.alloc(50_000, 1));
    await pack(entriesOf(from), join(TMP, "cut.pbar.br"));
    const whole = readFileSync(join(TMP, "cut.pbar.br"));
    writeFileSync(join(TMP, "cut-short.pbar.br"), whole.subarray(0, Math.floor(whole.length / 2)));
    await expect(unpack(join(TMP, "cut-short.pbar.br"), join(TMP, "cut-out"))).rejects.toThrow();
    await pack([{ path: "../escaped", file: join(from, "f") }], join(TMP, "evil.pbar.br"));
    await expect(unpack(join(TMP, "evil.pbar.br"), join(TMP, "evil-out"))).rejects.toThrow(/outside its folder/);
    expect(existsSync(join(TMP, "escaped"))).toBe(false);
  });

  it("refuses a backslash, colon, NUL, absolute path or `.` segment, and a folder that is a link out, writing nothing outside (PB-1048)", async () => {
    const from = join(TMP, "hostile-from");
    put(join(from, "f"), "x");
    for (const [i, path] of ["..\\escaped", "C:/escaped", "c:escaped", "a:stream", "a\0b", "/abs/escaped", "./a", "a/./b", "a//b", ""].entries()) {
      expect(archivePathProblem(path), path).toBeDefined();
      await pack([{ path: "ok", file: join(from, "f") }, { path, file: join(from, "f") }], join(TMP, `hostile-${i}.pbar.br`));
      await expect(unpack(join(TMP, `hostile-${i}.pbar.br`), join(TMP, `hostile-out-${i}`)), JSON.stringify(path)).rejects.toThrow(/outside its folder/);
    }
    expect(archivePathProblem("node_modules/@protoboardai/cli/bin/protoboard.mjs")).toBeUndefined();
    expect(existsSync(join(TMP, "escaped"))).toBe(false);
    expect(existsSync("/abs/escaped")).toBe(false);
    // a folder inside the destination that is a link out is not written through
    const out = join(TMP, "linked-out");
    mkdirSync(join(TMP, "link-target"), { recursive: true });
    mkdirSync(out, { recursive: true });
    symlinkSync(join(TMP, "link-target"), join(out, "a"));
    await pack([{ path: "a/planted", file: join(from, "f") }], join(TMP, "through-link.pbar.br"));
    await expect(unpack(join(TMP, "through-link.pbar.br"), out)).rejects.toThrow(/outside its folder/);
    expect(existsSync(join(TMP, "link-target", "planted"))).toBe(false);
    // only permission bits are kept (no setuid from an archive)
    if (process.platform !== "win32") {
      put(join(from, "suid"), "x", 0o4755);
      await pack([{ path: "suid", file: join(from, "suid") }], join(TMP, "suid.pbar.br"));
      await unpack(join(TMP, "suid.pbar.br"), join(TMP, "suid-out"));
      expect(statSync(join(TMP, "suid-out", "suid")).mode & 0o7777).toBe(0o755);
    }
  });
});

describe("a stack.json names its folder, so it is checked first (PB-1048)", () => {
  it("refuses a version that is not strict semver and an archive that is not a plain file name", async () => {
    const ext = await fakeExtension("ext-semver", "0.1.3");
    const good = JSON.parse(readFileSync(join(ext, "dist/stack/stack.json"), "utf8")) as CarriedManifest;
    expect(manifestProblem(good)).toBeUndefined();
    for (const v of ["1.2.3-rc.1", "0.2.0-preview", "1.0.0+build.5", "0.2.1-dev.7.g1a2b3c4", "0.2.1-dev.0.g0123456"]) expect(manifestProblem({ ...good, version: v }), v).toBeUndefined();
    for (const v of ["../../evil", "0.1.3/../../x", "1.2", "01.2.3", "1.2.3-", "1.2.3 ", "v1.2.3", "1.2.3\\x", "", 3]) expect(manifestProblem({ ...good, version: v as string }), String(v)).toMatch(/not a semantic version/);
    for (const file of ["../stack.pbar.br", "/etc/passwd", "a/b.br", "..", ".hidden"]) expect(manifestProblem({ ...good, archives: { ...good.archives, main: { ...good.archives.main, file } } }), file).toMatch(/plain file/);
    // a .vsix whose stack.json names an escaping version is refused before anything is written
    put(join(ext, "dist/stack/stack.json"), JSON.stringify({ ...good, version: "../../escaped" }));
    expect(carriedManifest(ext)).toBeUndefined();
    const home = join(TMP, "home-semver");
    await expect(ensureFromVsix(fakeVsix(ext, "evil-version.vsix"), home, { platform: "test-x64" })).rejects.toThrow(/stack\.json is not one this extension reads \(its version "\.\.\/\.\.\/escaped" is not a semantic version\)/);
    expect(existsSync(join(TMP, "escaped"))).toBe(false);
    expect(existsSync(home)).toBe(false);
  });

  it("replaces a copy of the same version from another build only when that is agreed to", async () => {
    const home = join(TMP, "home-replace");
    await ensureCarried(await fakeExtension("ext-r1", "0.1.5", "first"), home, { platform: "test-x64" });
    const other = fakeVsix(await fakeExtension("ext-r2", "0.1.5", "other"), "other-0.1.5.vsix");
    const refused = ensureFromVsix(other, home, { platform: "test-x64" });
    await expect(refused).rejects.toBeInstanceOf(StackReplaceRefused);
    await expect(ensureFromVsix(other, home, { platform: "test-x64" })).rejects.toThrow(/already holds the Protoboard stack 0\.1\.5 from another build/);
    const asked: string[] = [];
    await expect(ensureFromVsix(other, home, { platform: "test-x64", replace: (existing, incoming) => (asked.push(`${existing.marker.digest} -> ${incoming.digest}`), false) })).rejects.toBeInstanceOf(StackReplaceRefused);
    expect(asked).toEqual(["digest-first -> digest-other"]);
    expect(readFileSync(stackCli(stackDir(home, "0.1.5")), "utf8")).toContain("first");
    const r = await ensureFromVsix(other, home, { platform: "test-x64", replace: async () => true });
    expect(r.unpacked).toBe(true);
    expect(readFileSync(stackCli(r.stack.dir), "utf8")).toContain("other");
    // the same build again is not a replacement: nothing is asked
    expect((await ensureFromVsix(other, home, { platform: "test-x64" })).unpacked).toBe(false);
  });
});

describe("unpacking the carried stack", () => {
  it("unpacks once per build into <home>/stack/<version>, with progress, and marks it", async () => {
    const ext = await fakeExtension("ext-a", "0.1.3");
    const home = join(TMP, "home-a");
    expect(carriedManifest(ext)?.version).toBe("0.1.3");
    const said: string[] = [];
    const first = await ensureCarried(ext, home, { platform: "test-x64", onProgress: (f, what) => said.push(`${f.toFixed(1)} ${what}`), now: "2026-10-07T00:00:00.000Z" });
    expect(first.unpacked).toBe(true);
    expect(first.stack.dir).toBe(stackDir(home, "0.1.3"));
    expect(JSON.parse(readFileSync(join(first.stack.dir, STACK_MARKER), "utf8"))).toMatchObject({ version: "0.1.3", source: "vsix", digest: "digest-v1", platform: "test-x64", installedAt: "2026-10-07T00:00:00.000Z" });
    // the build stamp stack.json carries stays with the copy: doctor names the commit it was built from
    expect(first.stack.marker.build).toMatchObject({ commit: "c".repeat(40), dirty: false, branch: "main" });
    expect(existsSync(stackCli(first.stack.dir))).toBe(true);
    expect(existsSync(join(first.stack.dir, "node_modules/@esbuild/test/bin/esbuild"))).toBe(true);
    // what was left out of the archive is not there
    expect(existsSync(join(first.stack.dir, "node_modules/x/lib.js.map"))).toBe(false);
    expect(existsSync(join(first.stack.dir, "node_modules/.bin"))).toBe(false);
    expect(said[0]).toBe("0.0 Checking the Protoboard stack 0.1.3");
    expect(said.at(-1)).toBe(`1.0 The Protoboard stack 0.1.3 is in ${first.stack.dir}`);
    // nothing half-done is left beside it
    expect(listStacks(home).map((s) => s.marker.version)).toEqual(["0.1.3"]);
    // the second time there is nothing to do
    expect((await ensureCarried(ext, home, { platform: "test-x64" })).unpacked).toBe(false);
  });

  it("replaces the copy when the same version was rebuilt, and keeps other versions", async () => {
    const home = join(TMP, "home-b");
    await ensureCarried(await fakeExtension("ext-b1", "0.1.3", "v1"), home, { platform: "test-x64" });
    await ensureCarried(await fakeExtension("ext-b0", "0.1.2", "old"), home, { platform: "test-x64" });
    const rebuilt = await fakeExtension("ext-b2", "0.1.3", "v2");
    expect(unpackedCarried(home, carriedManifest(rebuilt)!, "test-x64")).toBeUndefined();
    const again = await ensureCarried(rebuilt, home, { platform: "test-x64", replace: true });
    expect(again.unpacked).toBe(true);
    expect(readFileSync(stackCli(again.stack.dir), "utf8")).toContain("v2");
    // a project created with the older version keeps its copy
    expect(listStacks(home).map((s) => s.marker.version)).toEqual(["0.1.3", "0.1.2"]);
  });

  it("a dev build's stack (0.2.1-dev.…) unpacks beside the release's and never replaces it (PB-1062)", async () => {
    const home = join(TMP, "home-dev");
    const release = await ensureCarried(await fakeExtension("ext-rel", "0.2.0", "release"), home, { platform: "test-x64", replace: true });
    const dev = await ensureCarried(await fakeExtension("ext-dev", "0.2.1-dev.7.g1a2b3c4", "dev"), home, { platform: "test-x64", replace: true });
    expect(dev.stack.dir).toBe(join(home, "stack", "0.2.1-dev.7.g1a2b3c4"));
    expect(readFileSync(stackCli(release.stack.dir), "utf8")).toContain("release");
    expect(listStacks(home).map((s) => s.marker.version)).toEqual(["0.2.1-dev.7.g1a2b3c4", "0.2.0"]);
  });

  it("says so on a platform it carries no native modules for, and in a build that carries nothing", async () => {
    const ext = await fakeExtension("ext-c", "0.1.3");
    await expect(ensureCarried(ext, join(TMP, "home-c"), { platform: "sunos-x64" })).rejects.toThrow(/carries its stack for test-x64, not for sunos-x64.*comes from npm instead/);
    expect(existsSync(join(TMP, "home-c", "stack", "0.1.3"))).toBe(false);
    expect(carriedManifest(join(TMP, "no-such-extension"))).toBeUndefined();
    await expect(ensureCarried(join(TMP, "no-such-extension"), join(TMP, "home-c"))).rejects.toThrow(/carries no stack \(a development build\)/);
  });
});

describe("what is unpacked is what was built", () => {
  it("refuses an archive whose SHA-256 is not the one stack.json names, before anything is unpacked", async () => {
    const ext = await fakeExtension("ext-d", "0.1.3");
    const archive = join(ext, "dist/stack/native-test-x64.pbar.br");
    const bytes = readFileSync(archive);
    bytes[bytes.length - 3] ^= 0xff;
    writeFileSync(archive, bytes);
    const home = join(TMP, "home-d");
    await expect(ensureCarried(ext, home, { platform: "test-x64" })).rejects.toThrow(/native-test-x64\.pbar\.br is not the one this extension was built with.*Install the Protoboard extension again/);
    expect(listStacks(home)).toEqual([]);
    expect(existsSync(stackDir(home, "0.1.3"))).toBe(false);
  });
});

describe("the stack from another .vsix (resolution step 3 without npm or a registry)", () => {
  it("adds that version's copy beside the carried one, once", async () => {
    const home = join(TMP, "home-e");
    await ensureCarried(await fakeExtension("ext-e3", "0.1.3", "new"), home, { platform: "test-x64" });
    const vsix = fakeVsix(await fakeExtension("ext-e2", "0.1.2", "older"), "protoboard-0.1.2.vsix");
    const said: string[] = [];
    const r = await ensureFromVsix(vsix, home, { platform: "test-x64", exceptVersion: "0.1.3", onProgress: (_f, what) => said.push(what) });
    expect(r).toMatchObject({ unpacked: true, manifest: { version: "0.1.2" } });
    expect(r.stack.dir).toBe(stackDir(home, "0.1.2"));
    expect(readFileSync(stackCli(r.stack.dir), "utf8")).toContain("older");
    expect(existsSync(join(r.stack.dir, "node_modules/@esbuild/test/bin/esbuild"))).toBe(true);
    expect(JSON.parse(readFileSync(join(r.stack.dir, STACK_MARKER), "utf8"))).toMatchObject({ version: "0.1.2", source: "vsix" });
    expect(said[0]).toBe("Checking the Protoboard stack 0.1.2");
    expect(listStacks(home).map((s) => s.marker.version)).toEqual(["0.1.3", "0.1.2"]);
    expect((await ensureFromVsix(vsix, home, { platform: "test-x64" })).unpacked).toBe(false);
  });

  it("says what is wrong with the file: the carried version itself, no stack inside, a missing archive, not a .vsix", async () => {
    const home = join(TMP, "home-f");
    const ext = await fakeExtension("ext-f", "0.1.3");
    await expect(ensureFromVsix(fakeVsix(ext, "same.vsix"), home, { platform: "test-x64", exceptVersion: "0.1.3" })).rejects.toThrow(/the one this extension carries itself/);
    await expect(ensureFromVsix(fakeVsix(ext, "small.vsix", ["stack.json"]), home, { platform: "test-x64" })).rejects.toThrow(/small\.vsix carries no Protoboard stack/);
    await expect(ensureFromVsix(fakeVsix(ext, "cut.vsix", ["stack.pbar.br"]), home, { platform: "test-x64" })).rejects.toThrow(/cut\.vsix is incomplete: stack\.pbar\.br is missing/);
    put(join(TMP, "text.vsix"), "this is not a zip file, only some text that is long enough");
    await expect(ensureFromVsix(join(TMP, "text.vsix"), home, { platform: "test-x64" })).rejects.toThrow(/text\.vsix: not a \.vsix file/);
    expect(listStacks(home)).toEqual([]);
  });
});

describe("the CLI's stack unpack and the extensions it finds (PB-1024)", () => {
  it("finds the installed extensions in the editors' folders, newest first, and says whose stack is unpacked", async () => {
    const userHome = join(TMP, "user-home");
    const home = join(userHome, ".protoboard");
    const v6 = await fakeExtension("found-016", "0.1.6", "f6");
    const v7 = await fakeExtension("found-017", "0.1.7", "f7");
    // as editors install them: <publisher>.<name>-<version>[-<platform>], with a package.json
    const at = (editorDir: string, name: string, ext: string) => {
      const dir = join(userHome, editorDir, name);
      mkdirSync(join(dir, "dist"), { recursive: true });
      writeFileSync(join(dir, "package.json"), "{}");
      put(join(dir, "dist/stack/stack.json"), readFileSync(join(ext, "dist/stack/stack.json")));
      for (const f of ["stack.pbar.br", "native-test-x64.pbar.br"]) put(join(dir, "dist/stack", f), readFileSync(join(ext, "dist/stack", f)));
      return dir;
    };
    const code = at(".vscode/extensions", "deltarobotics.vscode-protoboard-0.1.6", v6);
    const cursor = at(".cursor/extensions", "deltarobotics.vscode-protoboard-0.1.7-linux-x64", v7);
    mkdirSync(join(userHome, ".vscode/extensions/someone.other-1.0.0"), { recursive: true });
    const found = installedExtensions(home, { userHome, env: {}, platform: "test-x64" });
    expect(found.map((e) => [e.dir, e.version, e.carried?.version, e.unpacked])).toEqual([
      [cursor, "0.1.7", "0.1.7", false],
      [code, "0.1.6", "0.1.6", false],
    ]);
    // unpacked from its folder, as the extension would: then it says so
    const r = await unpackStackFrom(cursor, home, { platform: "test-x64" });
    expect(r).toMatchObject({ version: "0.1.7", unpacked: true, from: "extension" });
    expect(readFileSync(stackCli(r.stack.dir), "utf8")).toContain("f7");
    expect(installedExtensions(home, { userHome, env: {}, platform: "test-x64" }).map((e) => e.unpacked)).toEqual([true, false]);
    // once is enough
    expect((await unpackStackFrom(cursor, home, { platform: "test-x64" })).unpacked).toBe(false);
  });

  it("unpacks from a .vsix too, and says what a path that is neither is", async () => {
    const home = join(TMP, "unpack-from-vsix");
    const ext = await fakeExtension("from-vsix-018", "0.1.8", "f8");
    const vsix = fakeVsix(ext, "vscode-protoboard-0.1.8.vsix");
    expect(await unpackStackFrom(vsix, home, { platform: "test-x64" })).toMatchObject({ version: "0.1.8", unpacked: true, from: "vsix" });
    await expect(unpackStackFrom(join(TMP, "nothing.vsix"), home)).rejects.toThrow(/there is no file/);
    mkdirSync(join(TMP, "plain-folder"), { recursive: true });
    await expect(unpackStackFrom(join(TMP, "plain-folder"), home)).rejects.toThrow(/neither a \.vsix file nor an installed extension's folder/);
    writeFileSync(join(TMP, "plain-folder", "package.json"), "{}");
    await expect(unpackStackFrom(join(TMP, "plain-folder"), home)).rejects.toThrow(/carries no Protoboard stack/);
  });

  it("refuses a damaged archive in an extension's folder, before unpacking anything", async () => {
    const home = join(TMP, "unpack-damaged");
    const ext = await fakeExtension("damaged-019", "0.1.9", "f9");
    writeFileSync(join(ext, "package.json"), "{}");
    writeFileSync(join(ext, "dist/stack/stack.pbar.br"), "changed");
    await expect(unpackStackFrom(ext, home, { platform: "test-x64" })).rejects.toThrow(/is not the one this extension was built with/);
    expect(existsSync(stackDir(home, "0.1.9"))).toBe(false);
  });
});

describe("the terminal's command", () => {
  it.skipIf(process.platform === "win32")("is written to <home>/bin with the runtime's path beside it, and runs the carried CLI", async () => {
    const ext = await fakeExtension("ext-d", "0.1.3", "carried-cli-ran");
    const home = join(TMP, "home-d");
    await ensureCarried(ext, home, { platform: "test-x64" });
    const w = writeHome(home, { runtime: process.execPath, version: "0.1.3" });
    expect(w.bin).toBe(join(home, "bin"));
    expect(readFileSync(join(home, "runtime"), "utf8")).toBe(`${process.execPath}\n`);
    const r = spawnSync(join(w.bin, "protoboard"), [], { encoding: "utf8", cwd: TMP });
    expect(r.stdout.trim()).toBe("carried-cli-ran");
    // in a folder whose project has its own command, that one runs
    const project = join(TMP, "with-own");
    put(join(project, "node_modules/.bin/protoboard"), "#!/bin/sh\necho own-command-ran\n", 0o755);
    mkdirSync(join(project, "src"), { recursive: true });
    // a folder with a node_modules/.bin/protoboard is not a project without its protoboard.config.ts (PB-1048)
    expect(spawnSync(join(w.bin, "pb"), [], { encoding: "utf8", cwd: join(project, "src") }).stdout.trim()).toBe("carried-cli-ran");
    put(join(project, "protoboard.config.ts"), "export default {};\n");
    expect(spawnSync(join(w.bin, "pb"), [], { encoding: "utf8", cwd: join(project, "src") }).stdout.trim()).toBe("own-command-ran");
  });
});
