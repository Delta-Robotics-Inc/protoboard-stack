/**
 * Fault scenarios: run the system checks on deliberately broken variants of
 * the project's system and report whether each fault is caught.
 *
 *   npx tsx <this file> [src/scenarios.ts] [--json]
 *
 * The scenarios file exports `SCENARIOS`, each
 *   { id, label, description?, expect: string[], system?: ModuleDef, overrides?: ModuleDef[] }
 * where `system` defaults to the project root, `overrides` replace
 * definitions by id (e.g. a frame cut for the wrong stack, a board with a
 * pin on the wrong net; every board below the system is checked on its own
 * nets, as `protoboard check` does), and `expect`
 * lists the diagnostic codes the fault must raise at error or warning
 * severity (e.g. "UHD_LINK_STATE", "UHD_BUS_ADDRESS", "UHD_ASSEMBLY").
 * A scenario with `expect: []` (the nominal build) must raise no errors.
 * Boards below the root (definitions that declare nets) get the system rules
 * on their own nets too, as `protoboard check` runs them.
 * Exit 1 when a fault goes uncaught or the nominal build has errors.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assemble, checkSystem, type ModuleDef, type ModuleLookup } from "@deltarobotics/uhd";
import { boardModules, loadProject } from "@protoboardai/core";

interface Scenario {
  id: string;
  label: string;
  description?: string;
  expect: string[];
  system?: ModuleDef;
  overrides?: ModuleDef[];
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const file = resolve(args.find((a) => !a.startsWith("--")) ?? "src/scenarios.ts");
const p = await loadProject(process.cwd(), { checks: false, extensions: false });
if (!p.rootDef) throw new Error("the project has no root system");
const { SCENARIOS } = (await import(pathToFileURL(file).href)) as { SCENARIOS?: Scenario[] };
if (!SCENARIOS?.length) throw new Error(`${file} exports no SCENARIOS`);

// assembly is rooted at the first top-level instance with interface frames (as `protoboard check` does)
const structure = p.instances.find((i) => i.parent === "" && p.lookup(i.definition)?.interfaces.some((f) => f.geometry?.frame));

const results = SCENARIOS.map((s) => {
  const byId = new Map((s.overrides ?? []).map((d) => [d.id, d]));
  const lookup: ModuleLookup = (id) => byId.get(id) ?? p.lookup(id);
  const system = s.system ?? p.rootDef!;
  const found: { code: string; severity: string; message: string }[] = checkSystem(system, lookup).diagnostics.map((d) => ({
    code: `UHD_${d.rule.toUpperCase()}`,
    severity: d.severity,
    message: d.message,
  }));
  // the boards below the system, each checked on its own nets (as `protoboard check` does: the root covers the
  // tree for categories and passive overrides; a board is powered from outside it)
  for (const { def, path } of boardModules(system, lookup)) {
    for (const d of checkSystem(def, lookup).diagnostics) {
      if (d.rule === "unknown_category" || d.rule === "passive_override" || d.rule === "unpowered") continue;
      found.push({ code: `UHD_${d.rule.toUpperCase()}`, severity: d.severity, message: `${path}: ${d.message}` });
    }
  }
  if (structure) {
    for (const i of assemble(system, lookup, { root: [structure.path] }).issues) {
      found.push({ code: i.severity === "info" ? "UHD_UNPLACED" : "UHD_ASSEMBLY", severity: i.severity, message: `${i.subject}: ${i.message}` });
    }
  }
  const raised = found.filter((d) => d.severity !== "info");
  const missed = s.expect.filter((c) => !raised.some((d) => d.code === c));
  const errors = found.filter((d) => d.severity === "error");
  const ok = s.expect.length ? missed.length === 0 : errors.length === 0;
  return { id: s.id, label: s.label, expect: s.expect, ok, missed, raised: raised.map((d) => `${d.severity} ${d.code}: ${d.message}`) };
});

if (json) console.log(JSON.stringify(results, null, 2));
else {
  for (const r of results) {
    console.log(`${r.ok ? "caught " : "MISSED "} ${r.id.padEnd(22)} ${r.label}`);
    if (!r.ok && r.expect.length) console.log(`         expected ${r.missed.join(", ")}`);
    for (const line of r.raised.filter((l) => (r.expect.length ? r.expect.some((c) => l.includes(c)) : l.startsWith("error")))) console.log(`         ${line.slice(0, 180)}`);
  }
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
