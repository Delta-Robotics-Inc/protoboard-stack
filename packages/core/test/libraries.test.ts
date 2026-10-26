/**
 * Several part libraries (docs/specs/vscode-extension.md § 4.2), with two
 * uhd-library/v1 libraries served in this process: the Protoboard library
 * and "acme", whose reads need a token. Search merges results with their
 * library; a part comes from the first library that has it unless named or
 * pinned; origins record the library; tokens come only from the
 * environment; `protoboard libraries` edits protoboard.config.ts.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UhdModuleDef } from "@protoboardai/cloud/client";
import {
  addParts,
  checkPartUpdates,
  configuredLibraries,
  connectLibraries,
  libraryProblems,
  loadConfig,
  loadProject,
  readOrigins,
  readsNeed,
  searchLibraries,
  updatePart,
  withLibraryAdded,
  withLibraryMoved,
  withLibraryRemoved,
  writeLibraries,
  type ProtoboardConfig,
} from "../src/index.js";
import { Blobs, closedPort, draft, startLibrary, type CloudService } from "./cloud.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-libraries");
const CLI = join(HERE, "../../cli/bin/protoboard.mjs");
const PROTOBOARD_ACME_TOKEN = "acme-read-token-7f3a";

/** The CLI in a fresh process (asynchronously: the libraries it talks to are served by this one). */
const pb = (dir: string, args: string[], env: Record<string, string> = {}) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_CLOUD_") && k !== "PROTOBOARD_ACME_TOKEN"));
    const child = spawn(process.execPath, [CLI, ...args, "--cwd", dir], { env: { ...clean, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
    child.once("error", reject);
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
let n = 0;
const tmpProject = (files: Record<string, string>) => {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};
const config = (libraries?: string) => `import { defineConfig } from "@protoboardai/core";
export default defineConfig({
  // a comment with { braces } and "libraries: [] in a string"
  root: { source: "src/sys.uhd.ts", export: "SYS" },${libraries ? `\n  libraries: ${libraries},` : ""}
});
`;
const SYS = `export const SYS = { id: "sys", name: "System", interfaces: [] };\n`;

const power = { id: "vin", name: "VIN", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["sink"] }] };
const part = (id: string, extra: Partial<UhdModuleDef> = {}): UhdModuleDef => ({ id, name: id, manufacturer: "Test", interfaces: [power], ...extra });
const withBody = (id: string, extra: Partial<UhdModuleDef> = {}) => part(id, { artifacts: [{ id: "body", name: "Body", type: "3d_model", role: "body", format: "glb", filePath: `parts/${id}/body.glb` }], ...extra });

let pbLib: CloudService;
let acme: CloudService;
/** The two libraries in config order, as `parts` commands see them. */
const both = (env: NodeJS.ProcessEnv = { PROTOBOARD_ACME_TOKEN }, order: "pb-first" | "acme-first" = "pb-first") => {
  const libs = [
    { id: "protoboard", url: pbLib.url },
    { id: "acme", url: acme.url, authEnv: "PROTOBOARD_ACME_TOKEN" },
  ];
  return connectLibraries({ root: { source: "", export: "" }, libraries: order === "pb-first" ? libs : libs.reverse() }, { env });
};

beforeAll(async () => {
  pbLib = await startLibrary();
  acme = await startLibrary({ readToken: PROTOBOARD_ACME_TOKEN });
  const blobs = new Blobs();
  const sensor = (by: string) => withBody("shared-sensor", { description: `sensor from ${by}`, categories: ["sensor.motion"] });
  // the same screw, byte for byte, in both libraries
  const screw = draft(blobs, withBody("test-screw"), { files: { "parts/test-screw/body.glb": "screw" } });
  await pbLib.client.publish(draft(blobs, sensor("protoboard"), { files: { "parts/shared-sensor/body.glb": "pb sensor" } }), blobs.source);
  await pbLib.client.publish(screw, blobs.source);
  await pbLib.client.publish(draft(blobs, part("only-protoboard")), blobs.source);
  await acme.client.publish(draft(blobs, sensor("acme"), { files: { "parts/shared-sensor/body.glb": "acme sensor" } }), blobs.source);
  await acme.client.publish(screw, blobs.source);
  await acme.client.publish(draft(blobs, part("acme-nut")), blobs.source);
  await acme.client.publish(draft(blobs, part("acme-bracket", { children: [{ id: "nut", moduleDefId: "acme-nut" }] }), { dependencies: [{ partId: "acme-nut", revision: 1 }] }), blobs.source);
});
afterAll(async () => {
  await pbLib?.stop();
  await acme?.stop();
  rmSync(TMP, { recursive: true, force: true });
});

describe("libraries --check: what a library's reads need", () => {
  it("open, a Protoboard account for a library that names a sign-in, else a token (PB-1047)", () => {
    expect(readsNeed({ auth: "none" })).toBe("reads open");
    expect(readsNeed({ auth: "bearer", signIn: true })).toBe("needs a Protoboard account");
    expect(readsNeed({ auth: "bearer" })).toBe("reads need a token");
  });
});

describe("configured libraries", () => {
  it("default to the Protoboard library at the configured cloud URL", () => {
    const base: ProtoboardConfig = { root: { source: "", export: "" } };
    expect(configuredLibraries(base, { env: {} })).toEqual([{ id: "protoboard", url: "http://localhost:8787", declared: false }]);
    expect(configuredLibraries({ ...base, cloud: { url: "http://cloud.test/" } }, { env: {} })[0].url).toBe("http://cloud.test");
    expect(configuredLibraries(base, { env: { PROTOBOARD_CLOUD_URL: "http://env.test" }, url: "http://flag.test" })[0].url).toBe("http://flag.test");
    // declared: in order; "protoboard" without a url still follows the cloud URL
    expect(configuredLibraries({ ...base, cloud: { url: "http://cloud.test" }, libraries: [{ id: "acme", url: "https://acme.test/parts/" }, { id: "protoboard" }] }, { env: {} })).toEqual([
      { id: "acme", url: "https://acme.test/parts", declared: true },
      { id: "protoboard", url: "http://cloud.test", declared: true },
    ]);
  });

  it("refuse ids, URLs and auth settings that could not work or would hold a credential", () => {
    expect(libraryProblems([{ id: "acme" }])).toEqual(['libraries[0] (acme) needs a url; only "protoboard" defaults to the configured cloud URL']);
    expect(libraryProblems([{ id: "Acme Parts", url: "https://a.test" }])[0]).toMatch(/id must be lower-case/);
    expect(libraryProblems([{ id: "a", url: "https://a.test" }, { id: "a", url: "https://b.test" }])).toEqual(['libraries[1].id "a" is listed twice']);
    expect(libraryProblems([{ id: "a", url: "https://user:secret@a.test" }])[0]).toMatch(/must not carry credentials/);
    expect(libraryProblems([{ id: "a", url: "ftp://a.test" }])[0]).toMatch(/is not http\(s\)/);
    expect(libraryProblems([{ id: "a", url: "https://a.test", authEnv: "ghp_abc123secret" }])[0]).toMatch(/must name an environment variable/);
    expect(libraryProblems([{ id: "a", url: "https://a.test", token: "x" }])).toEqual(["libraries[0].token is not a library setting (id, url, authEnv)"]);
    expect(() => configuredLibraries({ root: { source: "", export: "" }, libraries: [{ id: "a" }] })).toThrow(/protoboard.config.ts: libraries\[0\] \(a\) needs a url/);
  });

  it("the quadcopter keeps the Protoboard library alone, and its pins read as that library's", async () => {
    const quad = join(HERE, "../../../examples/quadcopter-5in");
    expect(configuredLibraries(await loadConfig(quad), { env: {} })).toEqual([{ id: "protoboard", url: "http://localhost:8787", declared: false }]);
    const p = await loadProject(quad, { checks: false, extensions: false });
    expect(p.definitions.get("meps-neon-2207-v2-1950kv")!.origin).toMatchObject({ provider: "protoboard-cloud", library: "protoboard" });
  });
});

describe("parts search across libraries", () => {
  it("merges results, each with its library, in each library's own order; a shadowed id says who provides it", async () => {
    const r = await searchLibraries(both(), {});
    // both libraries rank (x-sort): each one's page as it gave it, the libraries in their configured order (test/library-sort.test.ts)
    expect(r.parts.map((x) => [x.partId, x.library, x.shadowedBy])).toEqual([
      ["only-protoboard", "protoboard", undefined],
      ["shared-sensor", "protoboard", undefined],
      ["test-screw", "protoboard", undefined],
      ["acme-bracket", "acme", undefined],
      ["acme-nut", "acme", undefined],
      ["shared-sensor", "acme", "protoboard"],
      ["test-screw", "acme", "protoboard"],
    ]);
    expect(r.total).toBe(7);
    expect(r.libraries).toEqual([
      { id: "protoboard", url: pbLib.url, total: 3, returned: 3, nextCursor: null },
      { id: "acme", url: acme.url, total: 4, returned: 4, nextCursor: null },
    ]);
    // the protocol's filters pass through
    expect((await searchLibraries(both(), { taxonomy: "sensor" })).parts.map((x) => x.library)).toEqual(["protoboard", "acme"]);
  });

  it("pages through every library with one cursor, and sums the facets", async () => {
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const r = await searchLibraries(both(), { limit: 2, facets: pages === 0, ...(cursor ? { cursor } : {}) });
      if (pages === 0) {
        expect(r.total).toBe(7);
        expect(r.facets?.domain).toBeDefined();
        expect(Object.values(r.facets!.taxonomy).length).toBeGreaterThan(0);
        expect(r.facets!.taxonomy["sensor.motion"]).toBe(2); // one in each library
      }
      seen.push(...r.parts.map((x) => `${x.library}/${x.partId}`));
      cursor = r.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(2); // acme has 4 (two pages of 2), the Protoboard library 3 (two pages)
    expect(seen.sort()).toEqual(
      ["acme/acme-bracket", "acme/acme-nut", "acme/shared-sensor", "acme/test-screw", "protoboard/only-protoboard", "protoboard/shared-sensor", "protoboard/test-screw"].sort(),
    );
    await expect(searchLibraries(both(), { cursor: "nonsense" })).rejects.toThrow(/not a cursor of `parts search`/);
  });

  it("personal libraries (PROTOBOARD_USER_LIBRARIES) come after the project's; an id the project has stays the project's", () => {
    const env = { PROTOBOARD_USER_LIBRARIES: JSON.stringify([{ id: "mine", url: `${acme.url}/`, authEnv: "PROTOBOARD_ACME_TOKEN" }, { id: "protoboard", url: "https://elsewhere.test" }]) };
    const libs = configuredLibraries({ root: { source: "", export: "" } }, { env: { ...env, PROTOBOARD_CLOUD_URL: pbLib.url } });
    expect(libs).toEqual([
      { id: "protoboard", url: pbLib.url, declared: false },
      { id: "mine", url: acme.url, authEnv: "PROTOBOARD_ACME_TOKEN", declared: false, personal: true },
    ]);
    expect(configuredLibraries({ root: { source: "", export: "" } }, { env, personal: false }).map((l) => l.id)).toEqual(["protoboard"]);
    expect(() => configuredLibraries(undefined, { env: { PROTOBOARD_USER_LIBRARIES: '[{"id":"x","url":"https://me:pw@x.test"}]' } })).toThrow(/PROTOBOARD_USER_LIBRARIES: .*must not carry credentials/);
    expect(() => configuredLibraries(undefined, { env: { PROTOBOARD_USER_LIBRARIES: "{" } })).toThrow(/is not JSON/);
  });

  it("a library that fails is reported; the others still answer", async () => {
    const noToken = await searchLibraries(both({}), { q: "sensor" });
    expect(noToken.parts.map((x) => x.library)).toEqual(["protoboard"]);
    expect(noToken.libraries[1]).toMatchObject({ id: "acme", error: expect.stringMatching(/library acme at http:\/\/127\.0\.0\.1:\d+ refused access \(AUTH_REQUIRED: .*\)\. Its token comes from \$PROTOBOARD_ACME_TOKEN, which is not set\./) });
    const wrong = await searchLibraries(both({ PROTOBOARD_ACME_TOKEN: "wrong" }), { q: "sensor" });
    expect(wrong.libraries[1].error).toMatch(/which is set but was not accepted/);
    const down = connectLibraries({ root: { source: "", export: "" }, libraries: [{ id: "gone", url: `http://127.0.0.1:${await closedPort()}` }] }, { env: {} });
    await expect(searchLibraries(down, {})).rejects.toThrow(/^cannot reach library gone at http:\/\/127\.0\.0\.1:\d+ \(fetch failed\)/);
  });
});

describe("parts add from several libraries", () => {
  const project = () => tmpProject({ "protoboard.config.ts": config(), "src/sys.uhd.ts": SYS });

  it("takes the first library that has the id, records the library, and vendors closures from it", async () => {
    const dir = project();
    const r = await addParts(await loadProject(dir, { checks: false }), ["shared-sensor", "acme-bracket"], both());
    expect(r.map((x) => [x.id, x.library, x.status])).toEqual([
      ["shared-sensor", "protoboard", "added"],
      ["acme-nut", "acme", "added"],
      ["acme-bracket", "acme", "added"],
    ]);
    const origins = readOrigins(dir).definitions;
    expect(origins["shared-sensor"]).toMatchObject({ provider: "protoboard-cloud", library: "protoboard", service: pbLib.url });
    expect(origins["acme-bracket"]).toMatchObject({ provider: "uhd-library", library: "acme", service: acme.url, dependencies: [{ partId: "acme-nut", revision: 1 }] });
    expect(JSON.parse(readFileSync(join(dir, "parts/catalog/shared-sensor.json"), "utf8")).description).toBe("sensor from protoboard");
    // the token is used, never written
    expect(readFileSync(join(dir, "parts/origins.json"), "utf8")).not.toContain(PROTOBOARD_ACME_TOKEN);
    const p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(p.definitions.get("acme-nut")!.origin).toMatchObject({ library: "acme", service: acme.url });
  });

  it("--library names the library; a pin keeps it; another library's different content is a conflict", async () => {
    const dir = project();
    expect((await addParts(await loadProject(dir, { checks: false }), ["shared-sensor"], both(), { library: "acme" })).map((x) => [x.library, x.status])).toEqual([["acme", "added"]]);
    expect(JSON.parse(readFileSync(join(dir, "parts/catalog/shared-sensor.json"), "utf8")).description).toBe("sensor from acme");
    // pinned to acme: a bare add asks acme, though protoboard comes first
    expect((await addParts(await loadProject(dir, { checks: false }), ["shared-sensor"], both())).map((x) => [x.library, x.status])).toEqual([["acme", "unchanged"]]);
    // asking protoboard for it now conflicts with the pin, and writes nothing
    const pinned = readFileSync(join(dir, "parts/origins.json"), "utf8");
    const c = await addParts(await loadProject(dir, { checks: false }), ["shared-sensor"], both(), { library: "protoboard" });
    expect(c[0]).toMatchObject({ status: "conflict", library: "protoboard" });
    expect(c[0].message).toMatch(/pinned to library acme \(revision 1\); library protoboard has different content under this id.*--library protoboard/);
    expect(readFileSync(join(dir, "parts/origins.json"), "utf8")).toBe(pinned);
    // identical content from another library is the same part
    await addParts(await loadProject(dir, { checks: false }), ["test-screw"], both(), { library: "acme" });
    expect((await addParts(await loadProject(dir, { checks: false }), ["test-screw"], both(), { library: "protoboard" }))[0].status).toBe("unchanged");
    // moving a pin to another library is deliberate
    const moved = await updatePart(await loadProject(dir, { checks: false }), "shared-sensor", 1, both(), { library: "protoboard" });
    expect(moved.map((x) => [x.library, x.status, x.message])).toEqual([["protoboard", "updated", "acme 1 → protoboard 1"]]);
    expect(readOrigins(dir).definitions["shared-sensor"]).toMatchObject({ library: "protoboard", previous: { library: "acme", revision: 1 } });
    // updates are asked of the library each part is pinned to
    const report = await checkPartUpdates(await loadProject(dir, { checks: false }), [], both());
    expect(report.map((x) => [x.id, x.library, x.status])).toEqual([
      ["shared-sensor", "protoboard", "up-to-date"],
      ["test-screw", "acme", "up-to-date"],
    ]);
  });

  it("follows the configured order, and says when a part is in no library or its library is gone", async () => {
    const dir = project();
    const p = await loadProject(dir, { checks: false });
    expect((await addParts(p, ["shared-sensor"], both({ PROTOBOARD_ACME_TOKEN }, "acme-first")))[0].library).toBe("acme");
    await expect(addParts(p, ["nowhere"], both())).rejects.toThrow(/^nowhere: not in any library \(protoboard at .*, acme at .*; `protoboard parts search` lists what they have\)/);
    await expect(addParts(p, ["shared-sensor"], both(), { library: "nope" })).rejects.toThrow(/no library "nope" in protoboard.config.ts \(configured: protoboard, acme/);
    const onlyPb = connectLibraries({ root: { source: "", export: "" }, libraries: [{ id: "protoboard", url: pbLib.url }] }, { env: {} });
    await expect(addParts(await loadProject(dir, { checks: false }), ["shared-sensor"], onlyPb)).rejects.toThrow(/shared-sensor is pinned to library "acme" \(http:.*\), which protoboard.config.ts does not list; add it back/);
    expect((await checkPartUpdates(await loadProject(dir, { checks: false }), [], onlyPb))[0]).toMatchObject({ id: "shared-sensor", status: "library-missing", library: "acme" });
    // an earlier library that cannot be reached is an error, not skipped: it might hold this id
    const gone = connectLibraries({ root: { source: "", export: "" }, libraries: [{ id: "gone", url: `http://127.0.0.1:${await closedPort()}` }, { id: "protoboard", url: pbLib.url }] }, { env: {} });
    await expect(addParts(await loadProject(project(), { checks: false }), ["only-protoboard"], gone)).rejects.toThrow(/^cannot reach library gone/);
  });
});

describe("protoboard.config.ts libraries", () => {
  it("are added, moved and removed in the config file, comments and other members kept", async () => {
    const dir = tmpProject({ "protoboard.config.ts": config(), "src/sys.uhd.ts": SYS });
    const before = readFileSync(join(dir, "protoboard.config.ts"), "utf8");
    await writeLibraries(dir, withLibraryAdded([{ id: "protoboard" }], { id: "acme", url: "https://acme.test", authEnv: "PROTOBOARD_ACME_TOKEN" }));
    const after = readFileSync(join(dir, "protoboard.config.ts"), "utf8");
    expect(after.startsWith(before.slice(0, before.lastIndexOf("}")).trimEnd())).toBe(true);
    expect(after).toContain(`  libraries: [\n    { id: "protoboard" },\n    { id: "acme", url: "https://acme.test", authEnv: "PROTOBOARD_ACME_TOKEN" },\n  ],\n});`);
    expect((await loadConfig(dir)).root).toEqual({ source: "src/sys.uhd.ts", export: "SYS" });
    // an existing member is replaced in place
    await writeLibraries(dir, withLibraryMoved([{ id: "protoboard" }, { id: "acme", url: "https://acme.test", authEnv: "PROTOBOARD_ACME_TOKEN" }], "acme", "first"));
    const moved = readFileSync(join(dir, "protoboard.config.ts"), "utf8");
    expect(moved.match(/^\s+libraries:/gm)).toHaveLength(1);
    expect(moved.indexOf('id: "acme"')).toBeLessThan(moved.indexOf('id: "protoboard"'));
    expect(() => withLibraryRemoved([{ id: "protoboard" }], "protoboard")).toThrow(/the only library/);
    expect(() => withLibraryAdded([{ id: "protoboard" }], { id: "protoboard", url: "http://x.test" })).toThrow(/already configured/);
    expect(() => withLibraryMoved([{ id: "a", url: "http://a" }], "a", "sideways")).toThrow(/move to a position/);
  });

  it("a libraries member that is not an array literal is left for a person", async () => {
    const dir = tmpProject({ "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nconst LIBS = [{ id: "protoboard" }];\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, libraries: LIBS });\n`, "src/sys.uhd.ts": SYS });
    await expect(writeLibraries(dir, [{ id: "protoboard" }, { id: "acme", url: "https://acme.test" }])).rejects.toThrow(/is not an array literal; edit it by hand/);
  });
});

describe("the CLI", () => {
  it("manages libraries, searches them merged and adds from the right one", async () => {
    const dir = tmpProject({ "protoboard.config.ts": config(), "src/sys.uhd.ts": SYS });
    const env = { PROTOBOARD_CLOUD_URL: pbLib.url };
    const list = await pb(dir, ["libraries", "--format", "json"], env);
    expect(JSON.parse(list.stdout).libraries).toEqual([{ id: "protoboard", url: pbLib.url, declared: false, position: 1, pinned: [] }]);
    expect(JSON.parse(list.stdout).origins).toBe("parts/origins.json");
    const personal = JSON.parse((await pb(dir, ["libraries", "--format", "json"], { ...env, PROTOBOARD_USER_LIBRARIES: JSON.stringify([{ id: "mine", url: acme.url }]) })).stdout).libraries;
    expect(personal.map((l: { id: string; personal?: boolean; position: number }) => [l.id, l.personal ?? false, l.position])).toEqual([["protoboard", false, 1], ["mine", true, 2]]);
    // a personal library is not the config's to remove or move: the CLI says where it comes from
    for (const args of [["remove", "mine"], ["move", "mine", "first"]])
      expect(await pb(dir, ["libraries", ...args], { ...env, PROTOBOARD_USER_LIBRARIES: JSON.stringify([{ id: "mine", url: acme.url }]) })).toMatchObject({
        status: 2,
        stderr: expect.stringMatching(/"mine" is one of your personal libraries: it comes from PROTOBOARD_USER_LIBRARIES .*not from protoboard\.config\.ts/),
      });

    expect(await pb(dir, ["libraries", "add", "acme", acme.url, "--auth-env", "PROTOBOARD_ACME_TOKEN"], env)).toMatchObject({ status: 0, stdout: expect.stringMatching(/^added library acme\n 1\. protoboard .*\n 2\. acme .*\n +token from \$PROTOBOARD_ACME_TOKEN \(not set\)/) });
    const file = readFileSync(join(dir, "protoboard.config.ts"), "utf8");
    expect(file).toContain('{ id: "acme", url: "' + acme.url + '", authEnv: "PROTOBOARD_ACME_TOKEN" }');
    expect(file).not.toContain(PROTOBOARD_ACME_TOKEN);
    // refused: a token where a variable name goes, credentials in a URL, a second library with a taken id
    expect(await pb(dir, ["libraries", "add", "x", "https://x.test", "--auth-env", PROTOBOARD_ACME_TOKEN], env)).toMatchObject({ status: 2, stderr: expect.stringMatching(/must name an environment variable/) });
    expect(await pb(dir, ["libraries", "add", "y", "https://me:pw@y.test"], env)).toMatchObject({ status: 2, stderr: expect.stringMatching(/must not carry credentials/) });
    expect(await pb(dir, ["libraries", "add", acme.url], env)).toMatchObject({ status: 2, stderr: expect.stringMatching(/a library "protoboard" is already configured/) }); // its discovery document suggests "protoboard"
    expect(readFileSync(join(dir, "protoboard.config.ts"), "utf8")).toBe(file);

    const check = JSON.parse((await pb(dir, ["libraries", "--check", "--format", "json"], env)).stdout).libraries;
    expect(check.map((l: { discovery: { protocol?: string } }) => l.discovery.protocol)).toEqual(["uhd-library/v1", "uhd-library/v1"]);

    const search = JSON.parse((await pb(dir, ["parts", "search", "sensor", "--format", "json"], { ...env, PROTOBOARD_ACME_TOKEN })).stdout);
    expect(search.parts.map((x: { library: string; shadowedBy?: string }) => [x.library, x.shadowedBy ?? null])).toEqual([["protoboard", null], ["acme", "protoboard"]]);
    const text = (await pb(dir, ["parts", "search", "sensor"], { ...env, PROTOBOARD_ACME_TOKEN })).stdout;
    expect(text).toMatch(/^2 part\(s\) in 2 libraries: protoboard 1, acme 1\n  protoboard  shared-sensor@1 .*\n  acme        shared-sensor@1 .*\(protoboard provides this id first\)$/m);
    expect(JSON.parse((await pb(dir, ["parts", "search", "--library", "acme", "--format", "json"], { ...env, PROTOBOARD_ACME_TOKEN })).stdout).libraries.map((l: { id: string }) => l.id)).toEqual(["acme"]);

    expect((await pb(dir, ["libraries", "move", "acme", "first"], env)).status).toBe(0);
    const add = await pb(dir, ["parts", "add", "shared-sensor", "acme-bracket"], { ...env, PROTOBOARD_ACME_TOKEN });
    expect(add.status).toBe(0);
    expect(add.stdout).toMatch(/^added +shared-sensor@1 +from acme/m);
    expect(readOrigins(dir).definitions["shared-sensor"].library).toBe("acme");
    expect(readFileSync(join(dir, "parts/origins.json"), "utf8")).not.toContain(PROTOBOARD_ACME_TOKEN);

    const removed = await pb(dir, ["libraries", "remove", "acme"], env);
    expect(removed.stdout).toMatch(/^removed library acme; 3 part\(s\) vendored from it stay vendored \(acme-bracket, acme-nut, shared-sensor\)/);
    expect(await pb(dir, ["libraries", "remove", "protoboard"], env)).toMatchObject({ status: 2, stderr: expect.stringMatching(/the only library/) });
    expect((await pb(dir, ["check"], env)).status).toBe(0); // vendored parts load without their library
  });
});
