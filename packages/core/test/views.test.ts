/**
 * `contributes.views` in extension manifests (docs/specs/viewer-stack.md):
 * extensions declare the views the shells offer, with which modules each
 * applies to; malformed declarations are refused with the reason.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { isViewId, loadProject, resolveViews, validateContributes, type ExtensionManifest } from "../src/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-views");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const manifest = (id: string, contributes?: unknown): ExtensionManifest =>
  ({ schema: "protoboard.extension/v0", id, version: "0.1.0", compatibility: { protoboard: "^0.2.0" }, ...(contributes !== undefined ? { contributes } : {}) }) as ExtensionManifest;

function project(name: string, extensions: Record<string, ExtensionManifest>) {
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
  write("package.json", JSON.stringify({ name, type: "module" }));
  for (const [pkg, m] of Object.entries(extensions)) {
    write(`node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, version: "0.1.0", type: "module" }));
    write(`node_modules/${pkg}/protoboard-extension.json`, JSON.stringify(m));
  }
  return dir;
}

const schematic = { id: "schematic", title: "Schematic", icon: "circuit-board", appliesTo: { files: ["schematic.svg"] }, entry: "./views/schematic.js#SchematicView", order: 20 };

describe("contributes.views", () => {
  it("accepts a well-formed view and none at all", () => {
    expect(validateContributes(manifest("ext-a"))).toEqual([]);
    expect(validateContributes(manifest("ext-a", { views: [schematic, { id: "ext-a.bom", title: "BOM", icon: "list", appliesTo: { root: true, files: ["bom.csv"], descendants: true } }] }))).toEqual([]);
  });

  it("shares one id rule with the shells' registry (a digit may lead, as in the built-in 3d)", () => {
    for (const id of ["3d", "schematic", "ext-a.pcb-2d", "ext-a.3d"]) expect(isViewId(id), id).toBe(true);
    for (const id of ["Bad", "-x", "a..b", "a.b.c", "", "a_b"]) expect(isViewId(id), id).toBe(false);
    expect(validateContributes(manifest("ext-a", { views: [{ id: "3d-print", title: "Print", icon: "printer" }] }))).toEqual([]);
  });

  it("names what is wrong with a view", () => {
    const problems = validateContributes(
      manifest("ext-a", {
        views: [
          { id: "Bad Id", title: "x", icon: "x" },
          { id: "pcb", title: "", icon: "CircuitBoard", entry: "views/pcb.js" },
          { id: "pcb", title: "PCB", icon: "layers", appliesTo: { files: ["out/pcb.svg"], descendants: "yes", kinds: ["board"] } },
        ],
        panels: [],
      }),
    );
    expect(problems).toEqual([
      "contributes has unknown section panels",
      'every view needs an id like "schematic" or "ext-a.schematic" (lowercase, dashes)',
      "view pcb needs a title",
      "view pcb needs an icon: a Lucide icon name in kebab-case",
      'view pcb: entry must be a relative module path, like "./views/pcb.js#View"',
      "duplicate view pcb",
      "view pcb: appliesTo has unknown condition kinds (known: root, files, descendants, categories)",
      "view pcb: appliesTo.descendants must be true or false",
      'view pcb: appliesTo.files must be file names (no folders), like "schematic.svg"',
    ]);
    expect(validateContributes(manifest("ext-a", { views: {} }))).toEqual(["contributes.views must be an array"]);
  });

  it("refuses an extension whose views are malformed, and loads the others' views", async () => {
    const dir = project("views", {
      "ext-ok": manifest("ext-ok", { views: [schematic] }),
      "ext-bad": manifest("ext-bad", { views: [{ id: "x" }] }),
    });
    const p = await loadProject(dir);
    expect(p.extensions.map((e) => e.manifest.id)).toEqual(["ext-ok"]);
    expect(p.diagnostics.find((d) => d.code === "PB_EXTENSION_MANIFEST_INVALID")?.message).toBe("ext-bad: view x needs a title");
    const { views, diagnostics } = resolveViews(p.extensions);
    expect(diagnostics).toEqual([]);
    expect(views).toEqual([{ ...schematic, extension: "ext-ok", package: "ext-ok" }]);
  });

  it("keeps the first of two views with one id", async () => {
    const dir = project("dupes", { "ext-a": manifest("ext-a", { views: [schematic] }), "ext-b": manifest("ext-b", { views: [{ ...schematic, title: "Other" }] }) });
    const p = await loadProject(dir);
    const { views, diagnostics } = resolveViews(p.extensions);
    expect(views.map((v) => [v.id, v.extension])).toEqual([["schematic", "ext-a"]]);
    expect(diagnostics.map((d) => d.code)).toEqual(["PB_EXTENSION_VIEW_DUPLICATE"]);
  });
});
