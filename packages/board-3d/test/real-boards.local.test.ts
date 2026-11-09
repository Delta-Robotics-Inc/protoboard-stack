/**
 * Real boards, local only: the boards in the Git-ignored manifest of the PCB regression set, imported with the KiCad
 * importer (packages/board-import), exported in 3D here, and compared with `kicad-cli pcb export step` when KiCad is
 * installed. Boards are printed under generic labels (board A, B, C: manifest ids sorted); no board's name, path or
 * part names are printed. Skips with a message when the manifest, the importer or a board file is missing.
 *
 * For each board: every tier with parametric bodies (counts, timings, every file read back), then with the models the
 * board's footprints name (KiCad STEP models, tessellated and placed into the STEP through the CAD runtime, fused per
 * part), then KiCad's own default STEP export read by OCCT. It measures and prints; it fails only on broken invariants
 * (a body count that is not one per bodied part, a file that does not read back, a body inside the board).
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { BoardDocument } from "@protoboardai/board";
import { buildBoard3d, bodyCount, composeStepModels, exportBoard3d, findCadPython, loadModels, runCadPython, validateFile, writeStep, TIERS, type OcctInspect } from "../src/index.js";
import { kicadModels, kicadResolver } from "./kicad-models.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const LOCAL = process.env.PB_PCB_REGRESSION_LOCAL ? resolve(process.env.PB_PCB_REGRESSION_LOCAL) : join(here, "..", "..", "ext-tscircuit", "test", "fixtures", "pcb-regression", "local");
const MANIFEST = join(LOCAL, "manifest.json");
const IMPORTER = join(here, "..", "..", "board-import", "src", "index.ts");
const KICAD = join(here, "..", "..", "board-checks", "src", "kicad", "cli.ts");

const boards: { label: string; root: string; pcb: string }[] = [];
let skip: string | undefined;
if (!existsSync(MANIFEST)) skip = "no local manifest of real boards";
else if (!existsSync(IMPORTER)) skip = "the KiCad importer (packages/board-import) is not present";
else {
  const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as { boards?: Record<string, { root: string; pcb: string }> };
  Object.keys(m.boards ?? {})
    .sort()
    .forEach((id, i) => {
      const e = m.boards![id];
      const root = isAbsolute(e.root) ? e.root : join(LOCAL, e.root);
      boards.push({ label: `board ${String.fromCharCode(65 + i)}`, root, pcb: join(root, e.pcb) });
    });
  if (!boards.length) skip = "the local manifest lists no boards";
}
if (skip) console.log(`board-3d real boards skipped: ${skip}`);

const python = findCadPython(here);
const size = (b: [number[], number[]] | undefined | null) => (b ? [0, 1, 2].map((i) => (b[1][i] - b[0][i]).toFixed(2)).join(" x ") : "?");

describe.skipIf(!!skip)("real boards (local only)", () => {
  for (const b of boards) {
    it(`${b.label}: tiers, models and KiCad's export`, { timeout: 1_800_000 }, async () => {
      if (!existsSync(b.pcb)) {
        console.log(`${b.label}: skipped, its board file is missing`);
        return;
      }
      const { importBoard } = (await import(pathToFileURL(IMPORTER).href)) as { importBoard: (s: { path: string }) => Promise<{ document: BoardDocument }> };
      const doc = (await importBoard({ path: b.pcb })).document;
      const lines: string[] = [];
      const out = mkdtempSync(join(tmpdir(), "board-3d-real-"));
      try {
        // parametric bodies, every tier
        buildBoard3d(doc);
        for (const tier of TIERS) {
          const r = await exportBoard3d(doc, { outDir: out, baseName: `x-${tier}`, tier, images: tier === "full", validate: true });
          const parts = r.components.withBody;
          if (tier === "full" || tier === "mechanical") expect(r.bodies).toBe(parts + 1);
          for (const v of r.validation) for (const c of v.checks) expect(c.ok, `${b.label} ${tier} ${v.format} ${c.name}: ${c.detail}`).toBe(true);
          expect(r.intersections, `${b.label} ${tier}: bodies inside the board`).toEqual([]);
          const warn = r.findings.filter((f) => f.severity !== "info");
          lines.push(`  ${tier.padEnd(10)} bodies ${String(r.bodies).padStart(4)} (parts with a body ${parts} of ${r.components.total}; ${Object.entries(r.components.bySource).map(([k, v]) => `${k} ${v}`).join(", ")}); scene ${r.timing.sceneMs} ms, scene + 4 formats ${r.timing.exportMs} ms (STEP ${r.timing.stepMs}); findings ${warn.length} warnings/errors`);
        }
        // supplied models (KiCad STEP), placed and fused per part through the CAD runtime
        if (python) {
          const refs = kicadModels(b.pcb);
          const t0 = performance.now();
          const loaded = await loadModels(doc, kicadResolver(b.pcb, refs), { python });
          const tLoad = performance.now() - t0;
          if (loaded.models.size) {
            const s = buildBoard3d(doc, { models: loaded.models });
            const st: Record<string, number> = {};
            for (const c of s.components) if (c.body.source === "model") st[c.seating.status] = (st[c.seating.status] ?? 0) + 1;
            const base = join(out, "models-base.step");
            const { writeFileSync } = await import("node:fs");
            writeFileSync(base, writeStep(s, { timestamp: "2026-11-09T00:00:00" }).text);
            const t1 = performance.now();
            const comp = await composeStepModels(python, s, loaded, base, join(out, "models.step"));
            const tComp = performance.now() - t1;
            const supplied = comp.parts.reduce((a, p) => a + (p.suppliedSolids ?? 0), 0);
            const merged = comp.parts.reduce((a, p) => a + (p.solids ?? 0), 0);
            const notOne = comp.parts.filter((p) => (p.solids ?? 1) > 1).length;
            const insp = await runCadPython<OcctInspect>(python, ["inspect", join(out, "models.step"), "--intersect"]);
            const others = bodyCount(s) - 1 - comp.parts.filter((p) => p.ok).length;
            expect(insp.solids).toBe(1 + merged + others);
            expect(insp.invalid).toBe(0);
            lines.push(`  models     ${loaded.models.size} of ${refs.length} references loaded (${loaded.report.filter((r) => !r.ok).length} failed) in ${(tLoad / 1000).toFixed(1)} s; seating ${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(", ")}; seat fixes ${s.components.filter((c) => c.seating.fixedMm !== undefined).length}`);
            lines.push(`  models     STEP: ${supplied} solids as supplied, ${merged} after fusing per part (${notOne} parts stay several solids), ${insp.solids} solids in the file with the board, box ${size(insp.bbox)} mm, ${insp.invalid} invalid, overlap with the board ${insp.intersections?.length ?? "?"}; placed in ${(tComp / 1000).toFixed(1)} s`);
          } else lines.push(`  models     none of ${refs.length} model references could be loaded`);
        } else lines.push("  models     skipped: no CAD runtime (set PROTOBOARD_PYTHON)");
        // KiCad's own STEP export of the same board, for comparison
        const cli = existsSync(KICAD) ? ((await import(pathToFileURL(KICAD).href)) as { findKicadCli: () => { path: string; version: string } | undefined }).findKicadCli() : undefined;
        const ours = buildBoard3d(doc);
        const ob: [number[], number[]] = [ours.board.bounds.min.slice(), ours.board.bounds.max.slice()];
        for (const c of ours.components) {
          if (!c.bounds) continue;
          for (let i = 0; i < 3; i++) {
            ob[0][i] = Math.min(ob[0][i], c.bounds.min[i]);
            ob[1][i] = Math.max(ob[1][i], c.bounds.max[i]);
          }
        }
        lines.push(`  ours       full tier box ${size(ob)} mm; board ${size([ours.board.bounds.min, ours.board.bounds.max])} mm`);
        if (cli && python) {
          const copy = mkdtempSync(join(tmpdir(), "board-3d-kicad-"));
          try {
            cpSync(b.root, copy, { recursive: true });
            const pcb = join(copy, relative(b.root, b.pcb));
            const step = join(copy, `${basename(pcb)}.step`);
            const t = performance.now();
            const r = spawnSync(cli.path, ["pcb", "export", "step", "--force", "-o", step, pcb], { encoding: "utf8", timeout: 600_000 });
            const ms = performance.now() - t;
            if (r.status === 0 && existsSync(step)) {
              const k = await runCadPython<OcctInspect>(python, ["inspect", step]);
              lines.push(`  KiCad ${cli.version.split(/\s/)[0].padEnd(5)} default STEP: ${k.solids} solids, ${k.components.length} top-level products, box ${size(k.bbox)} mm, in ${(ms / 1000).toFixed(1)} s`);
            } else lines.push(`  KiCad      export failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-1)[0]}`);
          } finally {
            rmSync(copy, { recursive: true, force: true });
          }
        } else lines.push(`  KiCad      comparison skipped (${cli ? "" : "no kicad-cli"}${!cli && !python ? ", " : ""}${python ? "" : "no CAD runtime"})`);
        // also validate the parametric full STEP through OCCT when the runtime is here
        if (python) {
          const f = join(out, "x-full.step");
          const v = await validateFile(ours, "step", f, readFileSync(f), { python, intersect: true });
          for (const c of v.checks) expect(c.ok, `${b.label} OCCT ${c.name}: ${c.detail}`).toBe(true);
        }
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
      console.log(`${b.label}:\n${lines.join("\n")}`);
    });
  }
});
