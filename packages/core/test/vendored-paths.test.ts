/**
 * Paths a project records and where its vendored parts live (PB-1018):
 * every recorded path is written with forward slashes on every system and
 * read with either; a catalog revision's files go to a short folder without
 * the library's own folders, so a project nested in a company workspace stays
 * well inside Windows' path limit; projects in the earlier layout still load,
 * and `parts migrate` moves them.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UhdModuleDef } from "@protoboardai/cloud/client";
import { addParts, connectCloud, loadProject, migrateParts, partsToMigrate, projectRelative, readOrigins, recordedPath, storedPath, stripPrefixFor, vendoredDirName, VENDORED_DIR_MAX, type CloudConnection } from "../src/index.js";
import { moduleDigest } from "../src/capabilities.js";
import { Blobs, cloudRepo, draft, startCloud, type CloudService } from "./cloud.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-vendored-paths");

const ID = "rev-41-1625-ultraplanetary-long-reach-mounting-bracket";
const DIR = `library/parts/${ID}`;
const PART: UhdModuleDef = {
  id: ID,
  name: "Long-reach bracket",
  manufacturer: "REV",
  part_number: "REV-41-1625",
  interfaces: [{ id: "mount", name: "Mount", domain: "mechanical", exposed: true, protocols: [] }],
  artifacts: [
    { id: "cad_step", name: "body", type: "3d_model", role: "body", format: "step", filePath: `${DIR}/artifacts/cad/${ID}.step` },
    { id: "cad_manifest", name: "manifest", type: "cad", format: "json", filePath: `${DIR}/artifacts/cad/${ID}.manifest.json` },
    { id: "cad_source", name: "generator", type: "cad", role: "source", format: "py", filePath: "library/cad/py/parts.py" },
  ],
} as UhdModuleDef;

let svc: CloudService;
let cloud: CloudConnection;

beforeAll(async () => {
  svc = await startCloud();
  cloud = connectCloud(undefined, { url: svc.url, env: {} });
  const blobs = new Blobs();
  await svc.client.publish(
    draft(blobs, PART, {
      files: { [`${DIR}/artifacts/cad/${ID}.step`]: "ISO-10303-21;", [`${DIR}/artifacts/cad/${ID}.manifest.json`]: "{}", "library/cad/py/parts.py": "# generator" },
      evidence: { [`${DIR}/sources.json`]: "{}", [`${DIR}/verification.json`]: "{}" },
    }),
    blobs.source,
  );
});
afterAll(async () => {
  await svc?.stop();
  rmSync(TMP, { recursive: true, force: true });
});

function project(name: string): string {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const files: Record<string, string> = {
    "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, libraries: [{ id: "protoboard", url: ${JSON.stringify(svc.url)} }] });\n`,
    "src/sys.uhd.ts": `export const SYS = { id: "sys", name: "System", interfaces: [], children: [{ id: "bracket", moduleDefId: ${JSON.stringify(ID)} }] };\n`,
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const filesUnder = (top: string, base = top): string[] =>
  readdirSync(top).flatMap((n) => (statSync(join(top, n)).isDirectory() ? filesUnder(join(top, n), base) : [join(top, n).slice(base.length + 1).split(/[\\/]/).join("/")]));
const catalogProblems = (p: Awaited<ReturnType<typeof loadProject>>) => p.diagnostics.filter((d) => d.validator === "protoboard/catalog" || d.validator === "protoboard/artifacts").filter((d) => d.severity !== "info");

describe("recorded paths", () => {
  it("are written with forward slashes whatever the system's separator", () => {
    expect(projectRelative("C:\\Users\\k\\proj", "C:\\Users\\k\\proj\\parts\\catalog\\a.json", win32)).toBe("parts/catalog/a.json");
    expect(projectRelative("/home/k/proj", "/home/k/proj/parts/catalog/a.json", posix)).toBe("parts/catalog/a.json");
    expect(recordedPath("parts\\catalog\\x\\a.step")).toBe("parts/catalog/x/a.step");
  });
});

describe("the vendored layout", () => {
  it("keeps the folder name short and leaves the library's folders out of the paths", () => {
    expect(vendoredDirName("short-id")).toBe("short-id");
    const name = vendoredDirName(ID);
    expect(name.length).toBeLessThanOrEqual(VENDORED_DIR_MAX);
    expect(name.startsWith("rev-41-1625")).toBe(true);
    expect(vendoredDirName(ID, new Set([name]))).not.toBe(name);
    expect(stripPrefixFor(ID, [`${DIR}/artifacts/cad/a.step`, "library/cad/py/parts.py"])).toBe(`${DIR}/`);
    // two files that would get one path keep theirs
    expect(stripPrefixFor(ID, [`${DIR}/a.step`, "a.step"])).toBeUndefined();
  });

  it("vendors into the short layout; the part loads with its files found and the board's digest is the pinned definition's", async () => {
    const dir = project("add");
    await addParts(await loadProject(dir, { checks: false }), [`${ID}@1`], cloud, { now: "2026-10-17T00:00:00.000Z" });
    const rec = readOrigins(dir).definitions[ID];
    expect(rec.artifactBase).toEqual({ kind: "vendored", dir: `parts/catalog/${vendoredDirName(ID)}`, strip: `${DIR}/` });
    expect(Object.keys(rec.files!).sort()).toEqual([`artifacts/cad/${ID}.manifest.json`, `artifacts/cad/${ID}.step`, "library/cad/py/parts.py", "sources.json", "verification.json"]);
    expect(rec.evidence!.map((e) => e.path).sort()).toEqual(["sources.json", "verification.json"]);
    for (const f of Object.keys(rec.files!)) expect(existsSync(join(dir, rec.artifactBase!.kind === "vendored" ? rec.artifactBase!.dir : "", f)), f).toBe(true);
    const p = await loadProject(dir);
    expect(catalogProblems(p)).toEqual([]);
    expect(p.diagnostics.find((d) => d.code === "PB_CATALOG_LAYOUT_EARLIER")).toBeUndefined();
    expect(p.artifacts.filter((a) => a.definition === ID && a.filePath).every((a) => a.present === true)).toBe(true);
    // the board's fingerprint is taken over the definition as the library pinned it
    const pinned = JSON.parse(readFileSync(join(dir, rec.file), "utf8"));
    expect(moduleDigest(p.definitions.get(ID)!.def, p.lookup)).toBe(moduleDigest(pinned, () => undefined));
  });

  it("stays under 200 characters for every vendored file of the dev catalog's longest part, nested at projects/<group>/<yyyy-mm-dd-slug>/protoboard/", () => {
    const root = join(cloudRepo(), "library", "parts");
    if (!existsSync(root)) return;
    // a 28-character slug is the hub's limit
    const prefix = `projects/contracts/2026-10-15-${"s".repeat(28)}/protoboard/`;
    const earlier = (id: string, f: string) => `${prefix}parts/catalog/${id}/library/parts/${id}/${f}`;
    let longest = { id: "", length: 0 };
    const parts = readdirSync(root).filter((id) => statSync(join(root, id)).isDirectory());
    for (const id of parts)
      for (const f of filesUnder(join(root, id))) if (earlier(id, f).length > longest.length) longest = { id, length: earlier(id, f).length };
    expect(longest.length).toBeGreaterThan(200);
    for (const id of [longest.id, ...parts]) {
      const files = filesUnder(join(root, id)).map((f) => `library/parts/${id}/${f}`);
      const strip = stripPrefixFor(id, files);
      for (const f of [...files, `${id}.uhd.ts`]) {
        const path = `${prefix}parts/catalog/${vendoredDirName(id)}/${storedPath(f, strip)}`;
        expect(path.length, path).toBeLessThan(200);
      }
      expect(`${prefix}parts/catalog/${id}.json`.length).toBeLessThan(200);
    }
  });

  it("reads a project vendored on Windows (backslashes in parts/origins.json), and the next parts command writes forward slashes", async () => {
    const dir = project("windows");
    await addParts(await loadProject(dir, { checks: false }), [`${ID}@1`], cloud);
    const file = join(dir, "parts", "origins.json");
    const o = JSON.parse(readFileSync(file, "utf8"));
    const rec = o.definitions[ID];
    rec.file = rec.file.replaceAll("/", "\\");
    rec.artifactBase.dir = rec.artifactBase.dir.replaceAll("/", "\\");
    rec.files = Object.fromEntries(Object.entries(rec.files).map(([k, v]) => [k.replaceAll("/", "\\"), v]));
    rec.evidence = rec.evidence.map((e: { path: string }) => ({ ...e, path: e.path.replaceAll("/", "\\") }));
    writeFileSync(file, JSON.stringify(o, null, 2) + "\n");
    expect(readFileSync(file, "utf8")).toContain("\\\\");
    const p = await loadProject(dir);
    expect(catalogProblems(p)).toEqual([]);
    migrateParts(p);
    expect(readFileSync(file, "utf8")).not.toContain("\\\\");
  });

  it("loads a project in the earlier layout as it is, and parts migrate moves it with every pin and the board's digest kept", async () => {
    const dir = project("earlier");
    await addParts(await loadProject(dir, { checks: false }), [`${ID}@1`], cloud);
    // put it back the way stack 0.1.6 laid it out: parts/catalog/<id>/<the library's paths>
    const file = join(dir, "parts", "origins.json");
    const o = JSON.parse(readFileSync(file, "utf8"));
    const rec = o.definitions[ID];
    const short = join(dir, rec.artifactBase.dir);
    const old = join(dir, "parts", "catalog", ID);
    for (const k of Object.keys(rec.files)) {
      const named = k.startsWith("library/") ? k : `${DIR}/${k}`;
      mkdirSync(join(old, named, ".."), { recursive: true });
      renameSync(join(short, k), join(old, named));
    }
    rmSync(short, { recursive: true, force: true });
    rec.artifactBase = { kind: "vendored", dir: `parts/catalog/${ID}` };
    rec.files = Object.fromEntries(Object.entries(rec.files).map(([k, v]) => [k.startsWith("library/") ? k : `${DIR}/${k}`, v]));
    rec.evidence = rec.evidence.map((e: { path: string }) => ({ ...e, path: `${DIR}/${e.path}` }));
    writeFileSync(file, JSON.stringify(o, null, 2) + "\n");

    const before = await loadProject(dir);
    expect(catalogProblems(before)).toEqual([]);
    expect(before.diagnostics.find((d) => d.code === "PB_CATALOG_LAYOUT_EARLIER")?.severity).toBe("info");
    expect(partsToMigrate(dir)).toEqual([ID]);
    const digest = moduleDigest(before.rootDef!, before.lookup);

    const r = migrateParts(before);
    expect(r).toMatchObject([{ id: ID, status: "moved", from: `parts/catalog/${ID}`, to: `parts/catalog/${vendoredDirName(ID)}`, files: 5 }]);
    // what moved, said with the nested path the earlier layout repeated: never the same path on both sides (F05)
    expect(r[0].fromFiles).toBe(`parts/catalog/${ID}/${DIR}`);
    expect(r[0].fromFiles).not.toBe(r[0].to);
    expect(existsSync(old)).toBe(false);
    const after = await loadProject(dir);
    expect(catalogProblems(after)).toEqual([]);
    expect(after.diagnostics.find((d) => d.code === "PB_CATALOG_LAYOUT_EARLIER")).toBeUndefined();
    expect(after.artifacts.filter((a) => a.definition === ID && a.filePath).every((a) => a.present === true)).toBe(true);
    expect(moduleDigest(after.rootDef!, after.lookup)).toBe(digest);
    expect(partsToMigrate(dir)).toEqual([]);
    // a second run moves nothing
    expect(migrateParts(after)).toMatchObject([{ id: ID, status: "current" }]);
  });
});
