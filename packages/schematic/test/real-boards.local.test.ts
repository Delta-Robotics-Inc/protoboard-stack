/**
 * Real boards, local only: the UHD projects listed in the Git-ignored file `uhd-projects.json` beside the PCB
 * regression set's local manifest (or the file named by PB_SCHEMATIC_PROJECTS). Each project's boards are laid out,
 * scored and timed, and printed under generic labels (board A, B, C in the file's order of labels); no project's
 * name, path, part or net is printed. Skips with a message when the file or a project is missing. It asserts only
 * what holds for any circuit (the layout is deterministic, within its time budget, and draws no accidental merge);
 * the scores are measured and printed, not asserted.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { boardOptions, loadProject } from "@protoboardai/core";
import { circuitFromUhd } from "../src/uhd.ts";
import { createSchematic, layoutSchematic, recordsOfKind, schematicsEqual, scoreSchematic, withChanges, type SchematicCircuit } from "../src/index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const FILE = process.env.PB_SCHEMATIC_PROJECTS ? resolve(process.env.PB_SCHEMATIC_PROJECTS) : join(here, "..", "..", "ext-tscircuit", "test", "fixtures", "pcb-regression", "local", "uhd-projects.json");

let skip: string | undefined;
let projects: [string, string][] = [];
if (!existsSync(FILE)) skip = "no local list of UHD projects (uhd-projects.json beside the PCB regression set's local manifest)";
else {
  projects = Object.entries((JSON.parse(readFileSync(FILE, "utf8")) as { projects?: Record<string, string> }).projects ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!projects.length) skip = "the local list names no projects";
}
if (skip) console.log(`real-board schematic layout skipped: ${skip}`);

describe.skipIf(!!skip)("real boards, schematic layout (local only)", () => {
  for (const [label, dir] of projects) {
    it(`board ${label}: lays out deterministically within its time budget`, { timeout: 300_000 }, async () => {
      if (!existsSync(dir)) {
        console.log(`board ${label}: skipped, its project is missing`);
        return;
      }
      const p = await loadProject(dir);
      const boards = [...p.definitions.values()].map((d) => d.def).filter((d) => d && (d.kind === "board" || (d.traits ?? []).some((t: { type: string }) => t.type === "design_envelope")));
      for (const def of boards) {
        const c = circuitFromUhd(def, p.lookup, boardOptions(p)) as SchematicCircuit;
        const doc0 = createSchematic([], c);
        const t0 = performance.now();
        const r = layoutSchematic(doc0);
        const ms = performance.now() - t0;
        const doc = withChanges(doc0, r.puts, r.removes);
        const again = layoutSchematic(doc0);
        expect(schematicsEqual(doc, withChanges(doc0, again.puts, again.removes))).toBe(true);
        const s = scoreSchematic(doc);
        const rules = s.rules.filter((x) => x.count).map((x) => `${x.id} ${x.count}/${x.opportunities}`).join(", ");
        const patterns = [...new Set(r.patterns.map((x) => x.pattern.replace(/:\d+$/, "")))].sort().join(", ");
        console.log(`board ${label}: ${c.parts.length} parts, ${c.nets.length} nets, ${recordsOfKind(doc, "card").length} cards; layout ${ms.toFixed(0)} ms; score ${s.score}, gates open ${s.gates.open} [${s.gates.rules.join(" ")}]; patterns ${patterns || "none"}\n  ${rules}`);
        expect(ms).toBeLessThan(2000 * Math.max(1, c.parts.length / 150));
        expect(s.rules.find((x) => x.id === "C06")!.count).toBe(0);
      }
    });
  }
});
