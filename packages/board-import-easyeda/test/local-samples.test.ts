/**
 * Local only: imports every EasyEDA Pro export found on this machine and checks internal consistency. Real designs
 * are confidential: they are never copied or named here. They are found through
 *   - the Git-ignored PCB regression folder (packages/ext-tscircuit/test/fixtures/pcb-regression/local/), and
 *   - PB_EASYEDA_SAMPLES: paths separated by the platform's path delimiter, or the path of a text file listing one
 *     path per line.
 * Without any, the suite is skipped. Results (generic labels, counts, times) go to test/.tmp/local-results.json,
 * which Git ignores.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copperLayers, documentsEqual, loadBoardDir, padsOf, recordsOfKind, writeBoardDir, writeNetlist, type FootprintRec } from "@protoboardai/board";
import { importEasyEdaPro, listEasyEdaPcbs, type Handling } from "../src/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REGRESSION = join(HERE, "..", "..", "ext-tscircuit", "test", "fixtures", "pcb-regression", "local");

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.epro2?$/i.test(e)) out.push(p);
  }
}

function samplePaths(): string[] {
  const out: string[] = [];
  walk(REGRESSION, out);
  const env = process.env.PB_EASYEDA_SAMPLES;
  if (env) {
    if (existsSync(env) && statSync(env).isFile() && !/\.epro2?$/i.test(env))
      out.push(
        ...readFileSync(env, "utf8")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else out.push(...env.split(delimiter).filter(Boolean));
  }
  // one per content
  const seen = new Set<string>();
  return out.filter((p) => {
    if (!existsSync(p)) return false;
    const h = createHash("sha1").update(readFileSync(p)).digest("hex");
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });
}

const SAMPLES = samplePaths();

interface Row {
  label: string;
  format: number;
  ms: number;
  counts: Record<string, number>;
  nets: number;
  missingPins: number;
  padHits: number;
  padHitsSameNet: number;
  report: { dropped: number; approximated: number };
}

describe.skipIf(!SAMPLES.length)("local EasyEDA Pro exports", () => {
  const rows: Row[] = [];
  const types: Record<string, { count: number; handling: Handling; files: number }> = {};

  SAMPLES.forEach((path, si) => {
    const bytes = readFileSync(path);
    // PCB documents with content (an unused PCB holds only its META record)
    const pcbs = listEasyEdaPcbs(bytes).filter((p) => p.records > 1);
    pcbs.forEach((pcb, pi) => {
      const label = `sample ${si + 1} pcb ${pi + 1}`;
      it(`${label} imports and is consistent`, () => {
        const t0 = performance.now();
        const r = importEasyEdaPro(bytes, { pcb: pcb.uuid });
        const ms = performance.now() - t0;
        const doc = r.document;
        const counts: Record<string, number> = {};
        for (const rec of doc.records.values()) counts[rec.kind] = (counts[rec.kind] ?? 0) + 1;
        for (const [t, e] of Object.entries(r.recordTypes)) {
          const x = (types[t] ??= { count: 0, handling: e.handling, files: 0 });
          x.count += e.count;
          x.files++;
        }
        const copper = copperLayers(doc);
        expect(copper.length).toBeGreaterThanOrEqual(1);
        // the outline is a closed contour (first point not repeated, non-zero area)
        const o = doc.records.get("outline");
        expect(o?.kind).toBe("outline");
        if (o?.kind === "outline") {
          const f = o.outline[0];
          const l = o.outline[o.outline.length - 1];
          expect(f.x === l.x && f.y === l.y).toBe(false);
          let a = 0;
          o.outline.forEach((p, i) => {
            const q = o.outline[(i + 1) % o.outline.length];
            a += p.x * q.y - q.x * p.y;
          });
          expect(a).toBeGreaterThan(0);
        }
        // non-zero content where the source has it
        if ((r.recordTypes.COMPONENT?.count ?? 0) > 0) expect(counts.footprint ?? 0).toBeGreaterThan(0);
        if ((r.recordTypes.LINE?.count ?? 0) > 0) expect((counts.track ?? 0) + (counts.graphic ?? 0)).toBeGreaterThan(0);
        // every net named by copper, zones and pads exists in the netlist; every copper layer exists
        const names = new Set(r.netlist.nets.map((n) => n.name));
        for (const n of doc.padNets.values()) expect(names.has(n)).toBe(true);
        for (const rec of doc.records.values()) {
          if ((rec.kind === "track" || rec.kind === "via" || rec.kind === "zone") && rec.net) expect(names.has(rec.net), rec.id).toBe(true);
          if (rec.kind === "track") expect(copper.includes(rec.layer), rec.id).toBe(true);
          if (rec.kind === "via") expect(copper.includes(rec.from_layer) && copper.includes(rec.to_layer)).toBe(true);
          if (rec.kind === "zone" || rec.kind === "keepout") for (const l of rec.layers) expect(copper.includes(l), rec.id).toBe(true);
        }
        // netlist pins that found no pad: never more than the report counts as unresolved
        let missingPins = 0;
        for (const n of doc.nets.values()) missingPins += n.missing.length;
        const unresolved = Number(r.report.map((x) => /^(\d+) pad net assignments: name a pad/.exec(x.message)?.[1]).find(Boolean) ?? 0);
        expect(missingPins).toBeLessThanOrEqual(unresolved);
        // copper ends on pad centers belong to the same net (checks the footprint transform, top and bottom)
        const centers = new Map<string, string | undefined>();
        for (const fp of recordsOfKind(doc, "footprint") as FootprintRec[]) for (const p of padsOf(fp, copper)) centers.set(`${Math.round(p.x / 1000)},${Math.round(p.y / 1000)}`, doc.padNets.get(p.id));
        let padHits = 0;
        let padHitsSameNet = 0;
        for (const t of recordsOfKind(doc, "track"))
          for (const e of [t.start, t.end]) {
            const k = `${Math.round(e.x / 1000)},${Math.round(e.y / 1000)}`;
            // pads the source gives no net (no PAD_NET entry) say nothing about the transform
            if (centers.get(k) === undefined) continue;
            padHits++;
            if (centers.get(k) === t.net) padHitsSameNet++;
          }
        if (padHits >= 10) expect(padHitsSameNet / padHits).toBeGreaterThan(0.9);
        // save and reload through the core's file format
        const dir = mkdtempSync(join(tmpdir(), "pb-easyeda-local-"));
        writeBoardDir(dir, doc);
        writeNetlist(dir, r.netlist);
        expect(documentsEqual(loadBoardDir(dir).doc, doc)).toBe(true);
        rows.push({
          label,
          format: r.format,
          ms: Math.round(ms),
          counts,
          nets: r.netlist.nets.length,
          missingPins,
          padHits,
          padHitsSameNet,
          report: { dropped: r.report.filter((x) => x.level === "dropped").length, approximated: r.report.filter((x) => x.level === "approximated").length },
        });
      });
    });
  });

  it("writes the summary", () => {
    const byHandling = (h: Handling) => Object.entries(types).filter(([, e]) => e.handling === h);
    const sum = (l: [string, { count: number }][]) => l.reduce((s, [, e]) => s + e.count, 0);
    const coverage = {
      recordTypes: Object.keys(types).length,
      mapped: byHandling("mapped").map(([t]) => t),
      ignored: byHandling("ignored").map(([t]) => t),
      dropped: byHandling("dropped").map(([t, e]) => `${t} (${e.count})`),
      records: { mapped: sum(byHandling("mapped")), ignored: sum(byHandling("ignored")), dropped: sum(byHandling("dropped")) },
    };
    const out = join(HERE, ".tmp");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "local-results.json"), JSON.stringify({ samples: SAMPLES.length, rows, coverage, types }, null, 1));
    console.log(rows.map((r) => `${r.label} fmt${r.format} ${r.ms} ms ${JSON.stringify(r.counts)} nets ${r.nets} missing ${r.missingPins} pad-ends ${r.padHitsSameNet}/${r.padHits}`).join("\n"));
    console.log(JSON.stringify(coverage));
    expect(rows.length).toBeGreaterThan(0);
  });
});
