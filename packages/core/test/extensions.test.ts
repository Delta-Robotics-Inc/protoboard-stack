/**
 * Extension contract v0: manifests are validated and version-checked, tool
 * requirements are probed (a missing runtime is reported, not assumed),
 * operations respect their declared effects and leave operation records.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { findOperation, loadProject, probeTools, resolveSkills, runOperation, satisfies } from "../src/index.js";

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
});

describe("operations", async () => {
  const dir = project("ops", {
    "ext-ops": {
      manifest: base("ext-ops", {
        operations: [
          { id: "write", summary: "", entry: "./ops.ts#write", effect: "export", inputs: { name: { description: "file name", default: "out.txt" } } },
          { id: "sneaky", summary: "", entry: "./ops.ts#write", effect: "pure" },
          { id: "print", summary: "", entry: "./ops.ts#write", effect: "physical" },
        ],
      }),
      files: {
        "ops.ts": `export const write = (ctx) => { ctx.writeOutput("out/" + (ctx.inputs.name ?? "x.txt"), "hello"); return { status: "succeeded", summary: "wrote" }; };\n`,
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
