/**
 * The import provider end to end (PB-1143's verification): a module
 * declared with an existing STEP or STL gets body.step, body.glb and a
 * manifest from one provider with no hand-written script, and the model
 * table lists it as imported. Runs on the CAD Python (skips without one).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importPartFile, loadProject, modelTable, runCapabilityOperation } from "@protoboardai/core";
import { cadPython } from "../../core/test/cad-python.ts";
import { boxStep } from "../../ext-tscircuit/lib/models.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/import-cad");
const PY = cadPython();

/** A binary STL of a w x d x h box (mm), corner at the origin. */
function boxStl([w, d, h]: [number, number, number]): Buffer {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  const tris = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const b = Buffer.alloc(84 + 50 * tris.length);
  b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    // the facet normal (OCCT tells a binary STL from an ASCII one by its bytes: a file of small whole
    // numbers and no normals looks like text to it)
    const [a, bb, c] = t.map((k) => v[k]);
    const u = bb.map((x, m) => x - a[m]);
    const w2 = c.map((x, m) => x - a[m]);
    const nrm = [u[1] * w2[2] - u[2] * w2[1], u[2] * w2[0] - u[0] * w2[2], u[0] * w2[1] - u[1] * w2[0]];
    const len = Math.hypot(...nrm) || 1;
    nrm.forEach((x, m) => b.writeFloatLE(x / len, 84 + 50 * i + 4 * m));
    t.forEach((k, j) => v[k].forEach((x, m) => b.writeFloatLE(x, 84 + 50 * i + 12 + 12 * j + 4 * m)));
  });
  return b;
}

const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";
export const PLATE: ModuleDef = { id: "plate", name: "Plate", kind: "module", interfaces: [] };
export const FOOT: ModuleDef = { id: "foot", name: "Foot", kind: "module", interfaces: [] };
export const SYS: ModuleDef = { id: "sys", name: "Sys", kind: "module", interfaces: [], children: [{ id: "plate", moduleDefId: "plate" }, { id: "foot", moduleDefId: "foot" }] };
`;

describe.skipIf(!PY)("parts import: an existing CAD file as a module's body, no script", () => {
  const dir = join(TMP, "p");
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.PROTOBOARD_PYTHON;
    process.env.PROTOBOARD_PYTHON = PY;
    rmSync(dir, { recursive: true, force: true });
    for (const [rel, content] of Object.entries({
      "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`,
      "src/sys.uhd.ts": SYS,
      "src/modules/plate/plate.uhd.ts": `export {};\n`,
      "cad/plate.step": boxStep("plate", [40, 20, 3]),
      "cad/foot.stl": boxStl([10, 10, 5]),
    })) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.PROTOBOARD_PYTHON;
    else process.env.PROTOBOARD_PYTHON = saved;
    rmSync(TMP, { recursive: true, force: true });
  });

  it("STEP and STL: generate and export write body.step, body.glb and a manifest; the model table says imported", { timeout: 240_000 }, async () => {
    for (const [file, id] of [["cad/plate.step", "plate"], ["cad/foot.stl", "foot"]]) {
      const p = await loadProject(dir, { checks: false });
      const r = importPartFile(p, file, id);
      expect(r.config).toBe("src/cad.config.ts");
      // both modules live in src/sys.uhd.ts: give each its own folder for the binding
      rmSync(join(dir, "src/cad.config.ts"));
      const own = join(dir, "src/modules", id);
      mkdirSync(own, { recursive: true });
      writeFileSync(join(own, "cad.config.ts"), `import { defineCapabilityConfig } from "@protoboardai/core";\nexport default defineCapabilityConfig({ provider: "@protoboardai/ext-parts", module: "${id}", constraints: { import: "../../../${file}", sha256: "${r.entry.sha256}", units: "mm" } });\n`);
      const p2 = await loadProject(dir, { checks: false, fresh: true });
      const gen = await runCapabilityOperation(p2, "cad", "generate", id, {}, {});
      expect(gen.status, gen.summary).toBe("succeeded");
      const exp = await runCapabilityOperation(p2, "cad", "export", id, {}, {});
      expect(exp.status, exp.summary).toBe("succeeded");
      for (const f of ["body.step", "body.glb", "body.manifest.json"]) expect(existsSync(join(own, "out", f))).toBe(true);
      const m = JSON.parse(readFileSync(join(own, "out/body.manifest.json"), "utf8"));
      expect(m.source).toMatchObject({ provenance: "imported", sha256: r.entry.sha256.slice(7) });
      expect(m.bbox_mm.size).toEqual(id === "plate" ? [40, 20, 3] : [10, 10, 5]);
    }
    const p = await loadProject(dir, { fresh: true });
    expect(p.diagnostics.filter((d) => /^PART_CAD_/.test(d.code) && d.severity !== "info")).toEqual([]);
    const t = modelTable(p);
    for (const id of ["plate", "foot"]) {
      const e = t.instances.find((x) => x.instance === id)!;
      expect(e).toMatchObject({ source: "provider", tier: "design", provenance: { method: "imported" }, placeholder: false, file: `src/modules/${id}/out/body.glb` });
    }
    // the file changes: check says so
    writeFileSync(join(dir, "cad/foot.stl"), boxStl([11, 10, 5]));
    const p3 = await loadProject(dir, { fresh: true });
    expect(p3.diagnostics.some((d) => d.code === "PART_CAD_IMPORT_CHANGED")).toBe(true);
  });
});
