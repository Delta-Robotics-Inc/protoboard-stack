/**
 * Real boards, local only: the boards listed in the Git-ignored manifest of the PCB regression set, imported with
 * the KiCad importer (packages/board-import) when it is present, checked here, and cross-checked against KiCad's
 * DRC when kicad-cli is installed. Boards are printed under generic labels (board A, B, C) in manifest order
 * sorted by id; no board's name, path or net names are printed. Skips with a message when the manifest, the
 * importer or a board file is missing. Measures and prints; it does not fail on a count difference (each
 * difference is listed so it can be explained).
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { copperLayers, type BoardDocument } from "@protoboardai/board";
import { crossCheckWithKicad, findKicadCli, formatCrossCheck, runBoardChecks, type CrossCheckResult } from "../src/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const LOCAL = process.env.PB_PCB_REGRESSION_LOCAL ? resolve(process.env.PB_PCB_REGRESSION_LOCAL) : join(here, "..", "..", "ext-tscircuit", "test", "fixtures", "pcb-regression", "local");
const MANIFEST = join(LOCAL, "manifest.json");
const IMPORTER = join(here, "..", "..", "board-import", "src", "index.ts");

interface Entry {
  root: string;
  pcb: string;
}
const boards: { label: string; root: string; pcb: string }[] = [];
let skip: string | undefined;
if (!existsSync(MANIFEST)) skip = "no local manifest of real boards (packages/ext-tscircuit/test/fixtures/pcb-regression/local/manifest.json)";
else if (!existsSync(IMPORTER)) skip = "the KiCad importer (packages/board-import) is not present";
else {
  const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as { boards?: Record<string, Entry> };
  const ids = Object.keys(m.boards ?? {}).sort();
  ids.forEach((id, i) => {
    const e = m.boards![id];
    const root = isAbsolute(e.root) ? e.root : join(LOCAL, e.root);
    boards.push({ label: `board ${String.fromCharCode(65 + i)}`, root, pcb: join(root, e.pcb) });
  });
  if (!boards.length) skip = "the local manifest lists no boards";
}
if (skip) console.log(`real-board checks skipped: ${skip}`);

describe.skipIf(!!skip)("real boards (local only)", () => {
  for (const b of boards) {
    it(`${b.label}: our counts beside KiCad's`, { timeout: 900_000 }, async () => {
      if (!existsSync(b.pcb)) {
        console.log(`${b.label}: skipped, its board file is missing`);
        return;
      }
      const { importBoard } = (await import(pathToFileURL(IMPORTER).href)) as {
        importBoard: (s: { path: string }) => Promise<{ document: BoardDocument; fill: { fills: unknown[] }; offset: { x: number; y: number }; ms: number; rulesNotEvaluated?: { name: string; reason: string }[]; sharedSourceIds?: string[][] }>;
      };
      const imp = await importBoard({ path: b.pcb });
      const t0 = performance.now();
      const res = runBoardChecks(imp.document, { fills: imp.fill as never });
      const oursMs = performance.now() - t0;
      const recs = [...imp.document.records.values()];
      const count = (k: string) => recs.filter((r) => r.kind === k).length;
      const lines = [
        `${b.label}: ${copperLayers(imp.document).length} copper layers, ${count("footprint")} footprints, ${count("track")} tracks, ${count("via")} vias, ${count("zone")} zones, ${imp.fill.fills.length} filled zone layers, ${count("rule")} rules`,
        `  ours: ${res.summary.line}; import ${imp.ms.toFixed(0)} ms, checks ${oursMs.toFixed(0)} ms (model ${res.summary.timing!.stages.model} ms, pairs ${res.summary.timing!.stages.pairs} ms, connectivity ${res.summary.timing!.stages.connectivity} ms)`,
        `  ours by check: ${Object.entries(res.summary.byCheck).map(([k, v]) => `${k} ${v.errors}E/${v.warnings}W`).join(", ")}`,
        ...res.summary.caveats.map((c) => `  caveat: ${c.replace(/net [^\s,:]+/g, "a net")}`),
      ];
      let cross: CrossCheckResult | undefined;
      if (findKicadCli()) {
        cross = crossCheckWithKicad(res, { pcbPath: b.pcb, root: b.root, doc: imp.document, transform: { tx: -imp.offset.x, ty: -imp.offset.y }, notEvaluated: imp.rulesNotEvaluated ?? [], sharedIds: imp.sharedSourceIds ?? [] });
        if (cross.ran) {
          lines.push(`  KiCad DRC ${cross.kicad.durationMs} ms`);
          lines.push(...formatCrossCheck(cross).split("\n").slice(1).map((l) => `  ${l}`));
          const ties = cross.matched.filter((m) => m.tie).length;
          if (ties) lines.push(`  unconnected matched as equal-length alternatives: ${ties}`);
          const byNet = cross.unconnectedByNet;
          if (byNet.length) lines.push(`  nets whose unconnected counts differ: ${byNet.length} (ours ${byNet.reduce((s, n) => s + n.ours, 0)}, KiCad ${byNet.reduce((s, n) => s + n.kicad, 0)} on those nets)`);
          for (const d of cross.differences.filter((d) => !d.startsWith("net ") && !d.includes("Protoboard does not check this"))) lines.push(`  difference: ${d}`);
          // every remaining comparable difference by location (KiCad's frame, mm), without net names
          const k = (x: number, y: number) => `(${((x + imp.offset.x) / 1e6).toFixed(3)}, ${(-(y + imp.offset.y) / 1e6).toFixed(3)}) mm`;
          for (const f of cross.oursOnly) lines.push(`  ours only: ${f.severity} ${f.check} at ${k(f.location.x, f.location.y)}${f.location.layer ? ` on ${f.location.layer}` : ""}, ${f.objects.length} object(s), measured ${f.measured ?? "-"} nm, limit ${f.required ?? "-"} nm`);
          for (const e of cross.kicadOnly) lines.push(`  KiCad only: ${e.severity} ${e.type} at ${(e.kicadPoints ?? []).map((p) => `(${p.x}, ${p.y})`).join(" ")} mm${e.reports > 1 ? `, ${e.reports} reports` : ""}`);
        } else lines.push(`  KiCad cross-check not run: ${cross.reason}`);
      } else lines.push("  KiCad cross-check not run: kicad-cli is not installed");
      console.log(lines.join("\n"));
      expect(res.inputHash).toMatch(/^sha256:/);
    });
  }
});
