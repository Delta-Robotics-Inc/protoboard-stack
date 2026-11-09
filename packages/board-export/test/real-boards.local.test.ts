/**
 * Real boards, local only: the boards listed in the Git-ignored manifest of the PCB regression set
 * (packages/ext-tscircuit/test/fixtures/pcb-regression/local/manifest.json), imported with the KiCad importer, exported
 * as a JLCPCB package with the KiCad cross-check, and once as a CircuitHub package (IPC-2581 through kicad-cli). Boards
 * are printed under generic labels (board A, B, C by sorted id); no name, path or net is printed.
 *
 * Where the board's source project holds fab files produced for it before (a folder with Gerber and drill files and a
 * CPL beside them, under the project path the manifest's `source` names), the export is compared with them layer by
 * layer (flashes, draws, regions), hole by hole (count and sizes) and row by row (placement), and each difference is
 * printed for a person to explain. Skips cleanly when the manifest, the importer or a board file is missing.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { countObjects, exportFabPackage, readExcellon, readGerber, type ExportResult } from "../src/index.js";
import { parseCsvLine } from "../src/format.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const LOCAL = process.env.PB_PCB_REGRESSION_LOCAL ? resolve(process.env.PB_PCB_REGRESSION_LOCAL) : join(here, "..", "..", "ext-tscircuit", "test", "fixtures", "pcb-regression", "local");
const MANIFEST = join(LOCAL, "manifest.json");
const IMPORTER = join(here, "..", "..", "board-import", "src", "index.ts");

interface Entry {
  root: string;
  pcb: string;
  source?: string;
}
const boards: { label: string; pcb: string; source?: string }[] = [];
let skip: string | undefined;
if (!existsSync(MANIFEST)) skip = "no local manifest of real boards";
else if (!existsSync(IMPORTER)) skip = "the KiCad importer (packages/board-import) is not present";
else {
  const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as { boards?: Record<string, Entry> };
  Object.keys(m.boards ?? {})
    .sort()
    .forEach((id, i) => {
      const e = m.boards![id];
      const root = isAbsolute(e.root) ? e.root : join(LOCAL, e.root);
      const pcb = join(root, e.pcb);
      if (existsSync(pcb)) boards.push({ label: `board ${String.fromCharCode(65 + i)}`, pcb, ...(e.source ? { source: e.source } : {}) });
    });
  if (!boards.length) skip = "no board file of the manifest is present";
}

const tmp = mkdtempSync(join(tmpdir(), "pb-board-export-real-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A folder of earlier fab output under the project the manifest's `source` names: Gerbers, a drill file and a CPL nearby. */
function priorFabFolder(source: string | undefined): { gerbers: string; cpl?: string } | undefined {
  const m = source ? /^([A-Za-z]:\\[^(]*?|\/[^(]*?)\s*(\(|$)/.exec(source) : null;
  const base = m?.[1]?.trim();
  if (!base || !existsSync(base)) return undefined;
  const found: { gerbers: string; cpl?: string }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    if (entries.some((e) => /\.(gtl|gbr)$/i.test(e)) && entries.some((e) => /\.drl$/i.test(e)) && entries.some((e) => /F_Cu|\.gtl$/i.test(e))) {
      const parent = join(d, "..");
      const cpl = readdirSync(parent).find((e) => /^cpl.*\.csv$/i.test(e));
      found.push({ gerbers: d, ...(cpl ? { cpl: join(parent, cpl) } : {}) });
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      if (!/^(node_modules|\.git|\.history)$/.test(e) && statSync(p).isDirectory()) walk(p, depth + 1);
    }
  };
  walk(base, 0);
  // the newest by folder name (dated folders sort by date)
  return found.sort((a, b) => (a.gerbers < b.gerbers ? 1 : -1))[0];
}

const fmtC = (c: ReturnType<typeof countObjects> | undefined) => (c ? `${c.flashes}f ${c.draws + c.arcs}d ${c.regions}r` : "-");

describe.skipIf(!!skip)(`real boards (local only)${skip ? `: skipped, ${skip}` : ""}`, () => {
  for (const b of boards) {
    it(`${b.label}: exports, reads back, cross-checks, compares with earlier fab files`, async () => {
      const { importBoard } = await import("@protoboardai/board-import");
      const imp = await importBoard({ path: b.pcb });
      const out = join(tmp, b.label.replace(/\s/g, "-"));
      const t0 = performance.now();
      const r: ExportResult = await exportFabPackage(imp.document, "jlcpcb", { outDir: out, name: "board", fill: { fill: imp.fill }, kicad: { board: b.pcb }, png: false });
      const ms = Math.round(performance.now() - t0);
      const lines: string[] = [`${b.label}: ${r.preflight.verdict}, ${r.preflight.counts.pass} ok, ${r.preflight.counts.warn} warn, ${r.preflight.counts.fail} fail, ${ms} ms`];
      const status = (id: string) => r.preflight.items.find((i) => i.id === id)?.status;
      for (const i of r.preflight.items) if (i.status === "fail" || i.status === "warn") lines.push(`  ${i.status}: ${i.id}`);
      // the read-back checks of what was written never fail on a board that imports
      for (const id of ["gerber.parse", "gerber.copper", "nets.attributes", "drill.readback", "drill.registration", "netlist.ipc356", "placement.rows", "bom.designators"]) expect(status(id), `${b.label} ${id}`).toBe("pass");
      if (r.preflight.items.some((i) => i.id === "gerber.fill")) expect(status("gerber.fill"), `${b.label} gerber.fill`).toBe("pass");
      // KiCad cross-check: copper layers carry the same objects as kicad-cli's export of the same board
      if (r.crossCheck?.ok) {
        for (const row of r.crossCheck.rows) if (row.ours && row.note) lines.push(`  kicad differs on ${row.fileFunction}: ours ${fmtC(row.ours)}, kicad ${fmtC(row.kicad)}`);
        const copperDiff = r.crossCheck.rows.filter((x) => x.fileFunction.startsWith("Copper") && x.note);
        lines.push(`  kicad cross-check: ${copperDiff.length} copper layers differ; drill ${r.crossCheck.drill?.ours.holes} / ${r.crossCheck.drill?.kicad.holes} holes`);
      } else lines.push(`  kicad cross-check: ${r.crossCheck?.message ?? "not run"}`);
      // earlier fab files, when the project holds them
      const prior = priorFabFolder(b.source);
      const priorCopper = prior ? readdirSync(prior.gerbers).filter((f) => /(_Cu\.|\.gtl$|\.gbl$|\.g\d+$)/i.test(f)).length : 0;
      const ourCopper = (r.layers ?? []).filter((l) => l.fileFunction.startsWith("Copper")).length;
      if (prior && priorCopper !== ourCopper) lines.push(`  earlier fab files found under the project are for another board or revision (${priorCopper} copper layers, this board has ${ourCopper}): not compared`);
      else if (prior) {
        lines.push("  earlier fab files found: compared layer by layer");
        const theirs = new Map<string, ReturnType<typeof countObjects>>();
        for (const f of readdirSync(prior.gerbers)) {
          if (!/\.(g[a-z0-9]{1,3}|gbr)$/i.test(f) || /drl_map|job/i.test(f)) continue;
          const g = readGerber(readFileSync(join(prior.gerbers, f), "utf8"));
          const ff = (g.fileAttrs[".FileFunction"] ?? []).join(",");
          if (ff) theirs.set(ff, countObjects(g));
        }
        for (const l of r.layers ?? []) {
          const t = theirs.get(l.fileFunction);
          const o = { flashes: l.flashes, draws: l.draws, arcs: l.arcs, regions: l.regions, clear: l.clear };
          if (!t || t.flashes !== o.flashes || t.draws + t.arcs !== o.draws + o.arcs || t.regions !== o.regions) lines.push(`    ${l.fileFunction}: ours ${fmtC(o)}, earlier ${fmtC(t)}`);
        }
        const holes = readdirSync(prior.gerbers)
          .filter((f) => /\.drl$/i.test(f))
          .map((f) => readExcellon(readFileSync(join(prior.gerbers, f), "utf8")));
        const n = holes.reduce((s, h) => s + h.holes.length, 0);
        const sizes = [...new Set(holes.flatMap((h) => [...h.tools.values()].map((t) => t.d)))].sort((x, y) => x - y);
        const ours = r.preflight.items.find((i) => i.id === "drill.readback")!.counts!;
        lines.push(`    holes: ours ${ours.holes}, earlier ${n}; earlier sizes ${sizes.map((d) => d / 1e6).join(", ")} mm`);
        if (prior.cpl) {
          const rows = readFileSync(prior.cpl, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).slice(1).map(parseCsvLine);
          const ourRows = readFileSync(join(out, "assembly", "board-cpl-jlcpcb.csv"), "utf8").trim().split("\n").slice(1).map(parseCsvLine);
          const mine = new Map(ourRows.map((x) => [x[0], x]));
          // earlier rows are in KiCad's page frame as its position file writes it (Y up); ours in the centered frame: add the import offset
          let moved = 0;
          let rotated = 0;
          let side = 0;
          for (const t of rows) {
            const o = mine.get(t[0]);
            if (!o) continue;
            const kx = Number(t[1].replace("mm", ""));
            const ky = Number(t[2].replace("mm", ""));
            const ox = Number(o[1].replace("mm", "")) + imp.offset.x / 1e6;
            const oy = Number(o[2].replace("mm", "")) + imp.offset.y / 1e6;
            if (Math.abs(kx - ox) > 0.001 || Math.abs(ky - oy) > 0.001) moved++;
            if (((Number(t[4]) - Number(o[4])) % 360 + 360) % 360 > 0.01) rotated++;
            if (t[3] !== o[3]) side++;
          }
          const onlyTheirs = rows.filter((t) => !mine.has(t[0])).length;
          const onlyOurs = ourRows.filter((o) => !rows.some((t) => t[0] === o[0])).length;
          lines.push(`    placement rows: ours ${ourRows.length}, earlier ${rows.length}; only earlier ${onlyTheirs}, only ours ${onlyOurs}; moved ${moved}, rotation differs ${rotated}, side differs ${side}`);
        }
      } else lines.push("  no earlier fab files found for this board");
      console.log(lines.join("\n"));
    }, 300_000);
  }

  it("CircuitHub package: IPC-2581 through kicad-cli for an unedited imported board", async () => {
    const b = boards[0];
    const { importBoard } = await import("@protoboardai/board-import");
    const imp = await importBoard({ path: b.pcb });
    const r = await exportFabPackage(imp.document, "circuithub", { outDir: join(tmp, "circuithub"), name: "board", fill: { fill: imp.fill }, kicad: { board: b.pcb }, png: false, outputs: { crossCheck: false } });
    const item = r.preflight.items.find((i) => i.id === "kicad.ipc2581")!;
    console.log(`${b.label} circuithub: ${r.preflight.verdict}; ${item.status}: ${item.title}`);
    if (item.status === "pass") expect(r.files.some((f) => f.path.endsWith(".ipc2581.xml"))).toBe(true);
    else expect(item.title).toContain("needs KiCad");
  }, 300_000);
});
