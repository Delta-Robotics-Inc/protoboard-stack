/**
 * Extension contract v0: manifests are validated and version-checked, tool
 * requirements are probed (a missing runtime is reported, not assumed),
 * operations respect their declared effects and leave operation records.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { exportSkills, findOperation, loadProject, probeTools, readSkill, resolveSkills, runOperation, satisfies } from "../src/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-ext");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function project(name: string, extensions: Record<string, { manifest: unknown; files?: Record<string, string> }>) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write(
    "protoboard.config.ts",
    `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, extensions: ${JSON.stringify(Object.keys(extensions))} });\n`,
  );
  write("src/sys.uhd.ts", `export const SYS = { id: "sys", interfaces: [] };\n`);
  write("package.json", JSON.stringify({ name: name, type: "module" }));
  for (const [pkg, e] of Object.entries(extensions)) {
    write(`node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, version: "0.1.0", type: "module" }));
    write(`node_modules/${pkg}/protoboard-extension.json`, JSON.stringify(e.manifest));
    for (const [rel, content] of Object.entries(e.files ?? {})) write(`node_modules/${pkg}/${rel}`, content);
  }
  return dir;
}

const base = (id: string, extra: object = {}) => ({ schema: "protoboard.extension/v0", id, version: "0.1.0", compatibility: { protoboard: "^0.2.0" }, ...extra });

describe("extension manifests", () => {
  it("semver ranges", () => {
    expect(satisfies("0.1.4", "^0.1.0")).toBe(true);
    expect(satisfies("0.2.0", "^0.1.0")).toBe(false);
    expect(satisfies("1.3.0", "^1.2.0")).toBe(true);
    expect(satisfies("0.2.0", ">=0.2.0")).toBe(true);
  });

  it("reports missing, invalid and incompatible extensions clearly", async () => {
    const dir = project("bad", {
      "ext-new": { manifest: base("ext-new", { compatibility: { protoboard: "^2.0.0" } }) },
      "ext-broken": { manifest: { id: "ext-broken" } },
    });
    const p = await loadProject(dir);
    const codes = p.diagnostics.filter((d) => d.validator === "protoboard/extensions").map((d) => d.code);
    expect(codes).toEqual(["PB_EXTENSION_INCOMPATIBLE", "PB_EXTENSION_MANIFEST_INVALID"]);
    expect(p.extensions).toHaveLength(0);
  });

  it("detects a missing tool runtime instead of assuming it", async () => {
    const dir = project("tools", {
      "ext-cad": {
        manifest: base("ext-cad", {
          tools: [
            { id: "present", purpose: "node", probe: ["node", "--version"] },
            { id: "absent", purpose: "a CAD runtime", probe: ["definitely-not-installed-cad-runtime"], install: "pip install it" },
          ],
        }),
      },
    });
    const p = await loadProject(dir);
    const status = Object.fromEntries(probeTools(p.extensions).map((t) => [t.id, t.available]));
    expect(status).toEqual({ present: true, absent: false });
  });

  it("resolves skills, including ones shipped by another package", async () => {
    const dir = project("skills", {
      "ext-s": { manifest: base("ext-s", { skills: [{ id: "a", summary: "A", path: "skills/a/SKILL.md" }, { id: "b", summary: "B", path: "skills/b/SKILL.md", package: "other-pkg" }] }), files: { "skills/a/SKILL.md": "# A" } },
    });
    const skills = resolveSkills(await loadProject(dir), (await loadProject(dir)).extensions);
    expect(skills.map((s) => [s.id, !!s.file])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("refuses the same skill id from two extensions: the loader names both, read and export never pick one", async () => {
    const skill = (who: string) => ({ manifest: base(who, { skills: [{ id: "part-search", summary: `${who}'s search`, path: "skills/part-search/SKILL.md" }, { id: `${who}-own`, summary: "own", path: "skills/own/SKILL.md" }] }), files: { "skills/part-search/SKILL.md": `# ${who}'s part-search\n`, "skills/own/SKILL.md": `# ${who}'s own\n` } });
    const dir = project("same-skill", { "ext-alpha": skill("ext-alpha"), "ext-beta": skill("ext-beta") });
    // what an export made while only ext-alpha was installed left behind (the folder with its .protoboard-source)
    const earlier = join(dir, ".claude", "skills", "part-search");
    mkdirSync(earlier, { recursive: true });
    writeFileSync(join(earlier, "SKILL.md"), "# ext-alpha's part-search\n");
    writeFileSync(join(earlier, ".protoboard-source"), "ext-alpha (ext-alpha)\nnode_modules/ext-alpha/skills/part-search/SKILL.md\n");
    const p = await loadProject(dir);
    // the loader reports it once, naming both extensions; both stay loaded
    const found = p.diagnostics.filter((d) => d.code === "PB_EXTENSION_SKILL_DUPLICATE");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", validator: "protoboard/extensions" });
    expect(found[0].message).toContain("part-search");
    expect(found[0].message).toContain("ext-alpha");
    expect(found[0].message).toContain("ext-beta");
    expect(p.extensions.map((e) => e.manifest.id)).toEqual(["ext-alpha", "ext-beta"]);

    // reading the bare id is refused, naming both; the other skills still read
    const skills = resolveSkills(p, p.extensions);
    expect(() => readSkill(skills, "part-search")).toThrow(/declared by 2 extensions \(ext-alpha, ext-beta\)/);
    expect(readSkill(skills, "ext-beta-own").text).toBe("# ext-beta's own\n");

    // the export writes neither (one would overwrite the other), removes the copy the earlier export made, and says so
    const claude = exportSkills(p, skills, "claude-code");
    expect(claude.duplicates).toEqual(["part-search"]);
    expect(existsSync(join(dir, ".claude", "skills", "part-search"))).toBe(false);
    expect(readdirSync(join(dir, ".claude", "skills")).sort()).toEqual(["ext-alpha-own", "ext-beta-own"]);
    exportSkills(p, skills, "agents-md");
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agents.match(/\*\*part-search\*\* \(ext-(alpha|beta)\)[^\n]*cannot be read/g)).toHaveLength(2);

    // one copy's files missing (the postinstall exports only the found ones): still a duplicate by its declaration
    rmSync(join(dir, "node_modules", "ext-beta", "skills", "part-search"), { recursive: true, force: true });
    const declared = resolveSkills(p, p.extensions);
    const present = declared.filter((s) => s.file);
    expect(present.filter((s) => s.id === "part-search")).toHaveLength(1);
    expect(exportSkills(p, present, "claude-code", declared).duplicates).toEqual(["part-search"]);
    expect(existsSync(join(dir, ".claude", "skills", "part-search"))).toBe(false);
  });

  it("a package listed twice in the config is one owner of its skills, not a duplicate", async () => {
    const dir = project("listed-twice", { "ext-once": { manifest: base("ext-once", { skills: [{ id: "part-search", summary: "s", path: "skills/ps/SKILL.md" }] }), files: { "skills/ps/SKILL.md": "# once\n" } } });
    const cfg = join(dir, "protoboard.config.ts");
    writeFileSync(cfg, readFileSync(cfg, "utf8").replace('["ext-once"]', '["ext-once","ext-once"]'));
    const p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.code === "PB_EXTENSION_SKILL_DUPLICATE")).toEqual([]);
    const skills = resolveSkills(p, p.extensions);
    expect(readSkill(skills, "part-search").text).toBe("# once\n");
    expect(exportSkills(p, skills, "claude-code").duplicates).toEqual([]);
  });

  it("counts two packages with the same manifest id as two owners of a skill", async () => {
    const same = (pkg: string) => ({ manifest: base("ext-same", { skills: [{ id: "part-search", summary: pkg, path: "skills/ps/SKILL.md" }] }), files: { "skills/ps/SKILL.md": `# ${pkg}\n` } });
    const dir = project("same-manifest-id", { "pkg-one": same("pkg-one"), "pkg-two": same("pkg-two") });
    const p = await loadProject(dir);
    expect(p.diagnostics.filter((d) => d.code === "PB_EXTENSION_SKILL_DUPLICATE")).toHaveLength(1);
    const skills = resolveSkills(p, p.extensions);
    expect(() => readSkill(skills, "part-search")).toThrow(/ext-same \(pkg-one\), ext-same \(pkg-two\)/);
    expect(exportSkills(p, skills, "claude-code").duplicates).toEqual(["part-search"]);
    expect(existsSync(join(dir, ".claude", "skills", "part-search"))).toBe(false);
  });
});

describe("operations", async () => {
  const dir = project("ops", {
    "ext-ops": {
      manifest: base("ext-ops", {
        operations: [
          { id: "write", summary: "", entry: "./ops.ts#write", effect: "export", inputs: { name: { description: "file name", default: "out.txt" } } },
          { id: "sneaky", summary: "", entry: "./ops.ts#write", effect: "pure" },
          { id: "print", summary: "", entry: "./ops.ts#write", effect: "physical" },
          { id: "findings", summary: "", entry: "./ops.ts#findings", effect: "pure" },
          { id: "crash", summary: "", entry: "./ops.ts#crash", effect: "pure" },
        ],
      }),
      files: {
        "ops.ts":
          `export const write = (ctx) => { ctx.writeOutput("out/" + (ctx.inputs.name ?? "x.txt"), "hello"); return { status: "succeeded", summary: "wrote" }; };\n` +
          `export const findings = (ctx) => { ctx.log("ERROR   no CAD body artifact"); ctx.log("WARNING no mechanical interfaces"); return { status: "failed", summary: "p: 1 error(s), 1 warning(s)" }; };\n` +
          `const deep = (x) => x.missing.replace("a", "b");\nexport const crash = () => deep({});\n`,
      },
    },
  });
  const p = await loadProject(dir);
  const op = (id: string) => findOperation(p.extensions, id)!;

  it("runs an export and records it with the project digest and output digests", async () => {
    const rec = await runOperation(p, op("write").ext, op("write").op, {});
    expect(rec).toMatchObject({ status: "succeeded", inputs: { name: "out.txt" }, outputs: [{ path: "out/out.txt", bytes: 5 }] });
    expect(rec.projectDigest).toMatch(/^sha256:/);
    const recs = readdirSync(join(dir, "operations"));
    expect(recs).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, "operations", recs[0]), "utf8")).operation).toBe("write");
  });

  it("a pure operation cannot write files", async () => {
    const rec = await runOperation(p, op("sneaky").ext, op("sneaky").op, {});
    expect(rec.status).toBe("failed");
    expect(rec.summary).toMatch(/declared pure/);
  });

  it("physical effects need explicit authorization and are refused otherwise", async () => {
    const rec = await runOperation(p, op("print").ext, op("print").op, {});
    expect(rec.status).toBe("refused");
    expect(existsSync(join(dir, "out/out.txt")) ? readFileSync(join(dir, "out/out.txt"), "utf8") : "").toBe("hello"); // only from the export run
  });

  it("keeps what the operation logged: part-verify's findings reach the record, not only its counts", async () => {
    const rec = await runOperation(p, op("findings").ext, op("findings").op, {});
    expect(rec.status).toBe("failed");
    expect(rec.log).toEqual(["ERROR   no CAD body artifact", "WARNING no mechanical interfaces"]);
  });

  it("an operation that throws keeps the error's stack in its log, so the failure can be placed", async () => {
    const rec = await runOperation(p, op("crash").ext, op("crash").op, {});
    expect(rec.status).toBe("failed");
    expect(rec.summary).toMatch(/Cannot read properties of undefined \(reading 'replace'\)/);
    expect(rec.log![0]).toMatch(/^TypeError: /);
    expect(rec.log!.slice(1).some((l) => /at deep .*ops\.ts/.test(l))).toBe(true);
  });

  it("a run that logged nothing has no log", async () => {
    const rec = await runOperation(p, op("write").ext, op("write").op, { name: "quiet.txt" });
    expect(rec.log).toBeUndefined();
  });

  it("rejects unknown inputs", async () => {
    const rec = await runOperation(p, op("write").ext, op("write").op, { nmae: "typo" });
    expect(rec.status).toBe("refused");
    expect(rec.summary).toMatch(/unknown input\(s\) nmae/);
  });
});

describe("quadcopter extensions", () => {
  it("loads the seven extensions, runs the evidence check, exposes the UHD and extension skills", async () => {
    const p = await loadProject(join(HERE, "../../../examples/quadcopter-5in"));
    expect(p.extensions.map((e) => e.manifest.id)).toEqual(["@protoboardai/ext-hardware", "@protoboardai/ext-parts", "@protoboardai/ext-docs", "@protoboardai/ext-drone", "@protoboardai/ext-frame-cad", "@protoboardai/ext-harness-cad", "@protoboardai/ext-release"]);
    expect(p.checks.find((c) => c.validator === "ext:@protoboardai/ext-hardware/evidence")?.status).toBe("ran");
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(resolveSkills(p, p.extensions).filter((s) => s.file)).toHaveLength(18); // 17 + build-a-project (PB-844)
  });
});
