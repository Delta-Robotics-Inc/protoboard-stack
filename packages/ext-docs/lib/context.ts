/**
 * Build the document context for a project's system: model, assembly,
 * checks, wiring (including sub-assemblies), scenarios, BOM, test data and
 * the resolver.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ModuleDef } from "@deltarobotics/uhd";
import { checkSystem } from "@deltarobotics/uhd";
import { isNet, wiringChecklist, type WiringStep } from "@deltarobotics/uhd";
import { boardModules, type Project } from "@protoboardai/core";
import { buildBom, type BomRow } from "./bom.ts";
import { buildScene, loadSystem, type LoadedSystem } from "./model.ts";
import { loadTestData } from "./testdata.ts";
import { DERIVED } from "./derived.ts";
import { instanceMap, makeResolver, type DocContext } from "./values.ts";

export interface BuiltContext extends DocContext {
  testErrors: string[];
  /** The documents' BOM file as committed (`docs/<system-id>-bom.json`): what the documents publish. */
  generatedBom?: BomRow[];
  /** buildBom() from the live model, to detect a stale BOM file. */
  liveBom: BomRow[];
}

/** Project-relative path of the BOM file the documents publish. */
export const bomFile = (sys: LoadedSystem) => `${sys.docsDir}/${sys.system.id}-bom.json`;

/**
 * Wiring for the system and every sub-assembly that declares links (ids
 * prefixed with the instance path). A circuit board (a module with Net
 * interfaces) is not descended into: its links are its copper, made by the
 * fab, not wired at the bench.
 */
export function fullWiring(system: ModuleDef, lookup: (id: string) => ModuleDef | undefined): WiringStep[] {
  const out: WiringStep[] = [...wiringChecklist(system, lookup)];
  const visit = (d: ModuleDef, prefix: string[]) => {
    for (const c of d.children ?? []) {
      const def = lookup(c.moduleDefId);
      if (!def || def.kind === "harness") continue;
      const path = [...prefix, c.id];
      // a circuit board (a module with Net interfaces, or drawn whole by a body of its own): its links are
      // copper, made by the fab, not wired at the bench
      if (def.interfaces.some(isNet) || (def.artifacts?.some((a) => a.role === "body" && a.format === "glb") && def.children?.length)) continue;
      if (def.links?.length) {
        for (const s of wiringChecklist(def, lookup)) {
          if (s.domain === "mechanical") continue;
          const p = path.join("/");
          out.push({
            ...s,
            linkId: `${p}/${s.linkId}`,
            a: `${p}/${s.a}`,
            b: `${p}/${s.b}`,
            harness: s.harness ? `${p}/${s.harness}` : undefined,
            connections: s.connections.map((c2) => ({ ...c2, from: `${p}/${c2.from}`, to: `${p}/${c2.to}` })),
          });
        }
      }
      visit(def, path);
    }
  };
  visit(system, []);
  return out;
}

/**
 * checkSystem on each circuit board below a system (a definition with Net
 * interfaces), once per definition at its first instance: the root's check
 * does not descend into a board's nets, so a fault on a board's copper is only
 * seen by checking the board itself. Filtered as `protoboard check` does: the
 * root's check covers the tree for unknown categories and passive overrides,
 * and a board is powered from outside it (through its exports), so "unpowered"
 * is not a finding on the board alone.
 */
export function boardChecks(system: ModuleDef, lookup: (id: string) => ModuleDef | undefined) {
  return boardModules(system, lookup as Parameters<typeof boardModules>[1]).map((b) => ({
    path: b.path,
    id: b.def.id,
    diagnostics: checkSystem(b.def, lookup).diagnostics.filter((x) => !["unknown_category", "passive_override", "unpowered"].includes(x.rule)),
  }));
}

/** checkSystem on a system plus each circuit board below it (`boardChecks`), board findings prefixed with the board's path. */
export function checkWithBoards(system: ModuleDef, lookup: (id: string) => ModuleDef | undefined) {
  const root = checkSystem(system, lookup);
  const extra = boardChecks(system, lookup).flatMap(({ path: at, diagnostics }) =>
    diagnostics.map((x) => ({ ...x, id: `${at}/${x.id}`, message: `${at}: ${x.message}`, refs: x.refs.map((r) => (r.startsWith("link:") ? `link:${at}/${r.slice(5)}` : `${at}/${r}`)) })),
  );
  return { ...root, diagnostics: [...root.diagnostics, ...extra] };
}

export async function buildContext(p: Project): Promise<BuiltContext> {
  const sys = await loadSystem(p);
  const scene = buildScene(sys);
  // the system's own check; its boards' findings are in `boards` (the datasheet's rail table reads both)
  const checks = checkSystem(sys.system, sys.lookup);
  const wiring = fullWiring(sys.system, sys.lookup);
  // each scenario's system and its boards (a board's own nets are checked on the board module, as protoboard check does)
  const scenarioChecks = sys.scenarios.map((s) => ({ id: s.id, label: s.label, description: s.description, diagnostics: checkWithBoards(s.system, s.lookup).diagnostics }));
  const boards = boardChecks(sys.system, sys.lookup);
  const { tests, errors } = loadTestData(sys.absDocs, sys.docsDir);
  const genPath = join(sys.root, bomFile(sys));
  const generatedBom = existsSync(genPath) ? (JSON.parse(readFileSync(genPath, "utf8")) as BomRow[]) : undefined;
  const liveBom = buildBom(sys.system, sys.lookup, sys.evidenceDirs);
  const partial = {
    sys,
    scene,
    bom: generatedBom ?? liveBom,
    checks,
    wiring,
    scenarioChecks,
    boards,
    tests,
    derived: { ...DERIVED },
    instances: instanceMap(sys.system, sys.lookup),
    testErrors: errors,
    generatedBom,
    liveBom,
  };
  makeResolver(partial as any);
  return partial as unknown as BuiltContext;
}
