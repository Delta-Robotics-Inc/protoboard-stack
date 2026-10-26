import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot, type ExtensionCheck, type Project, type ProjectDiagnostic } from "@protoboardai/core";

/** Where a definition's sources.json / verification.json live: project parts/evidence, or next to its package origin. */
function evidenceDir(p: Project, id: string): string[] {
  const rec = p.definitions.get(id)!;
  const dirs = [join(p.root, "parts", "evidence", id)];
  if (rec.origin.kind === "catalog" && rec.origin.package) {
    // library parts keep their evidence at library/parts/<id> in the providing package
    const pkg = packageRoot(p.root, rec.origin.package);
    if (pkg) dirs.push(join(pkg, "library", "parts", id));
  }
  return dirs;
}

/** An evidence file of one kind: project parts/evidence first, then what the catalog revision vendored, then the package. */
function evidenceFile(p: Project, id: string, name: string, kind: string): string | undefined {
  const [project, ...packages] = evidenceDir(p, id).map((d) => join(d, name));
  const vendored = (p.definitions.get(id)!.origin.evidence ?? []).filter((e) => e.kind === kind).map((e) => join(p.root, e.file));
  return [project, ...vendored, ...packages].find(existsSync);
}

/**
 * Purchased parts (have a manufacturer part number, not custom, not included
 * with another part) must cite sources and have a recorded verification.
 */
export const evidence: ExtensionCheck = (p) => {
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  const used = new Set(p.instances.map((i) => i.definition));
  for (const id of [...used].sort()) {
    const def = p.lookup(id);
    if (!def || def.children?.length || def.kind === "harness") continue;
    if (/\(custom\)/i.test(def.manufacturer ?? "") || !def.manufacturer) continue;
    const included = def.traits?.some((t) => t.type === "usage_note" && t.params?.included_with);
    const sourcesFile = evidenceFile(p, id, "sources.json", "sources");
    const verFile = evidenceFile(p, id, "verification.json", "verification");
    const supplierCited = def.traits?.some((t) => t.type === "usage_note" && typeof t.params?.source === "string");
    const source = p.definitions.get(id)!.origin.source;
    if (!sourcesFile && !supplierCited && !included) {
      out.push({ code: "HW_NO_SOURCES", severity: "warning", entity: { kind: "definition", id }, message: `${id} cites no sources (no sources.json in parts/evidence or vendored with its catalog revision, no supplier listing)`, source });
      continue;
    }
    if (!verFile) {
      out.push({ code: "HW_NOT_VERIFIED", severity: "info", entity: { kind: "definition", id }, message: `${id} has sources but no recorded verification (run the uhd-part-verify skill)`, source });
      continue;
    }
    const v = JSON.parse(readFileSync(verFile, "utf8"));
    // PB-862: the record says whether an agent that did not author the part ran the audit
    if (v.audit && v.audit.independent === false) {
      out.push({ code: "HW_VERIFICATION_SELF_AUDIT", severity: "info", entity: { kind: "definition", id }, message: `${id}: verified by a self-audit only (the authoring agent checked its own part); an independent audit is still owed`, source });
    }
    if (v.audit && v.audit.wrong > 0) {
      // a wrong fact is resolved when the verification records the repair that fixed it
      out.push(
        v.repairs
          ? { code: "HW_VERIFICATION_REPAIRED", severity: "info", entity: { kind: "definition", id }, message: `${id}: audit found ${v.audit.wrong} wrong fact(s); repairs recorded (${String(v.repairs).slice(0, 80)})`, source }
          : { code: "HW_VERIFICATION_WRONG", severity: "error", entity: { kind: "definition", id }, message: `${id}: verification found ${v.audit.wrong} wrong fact(s) with no recorded repair`, source },
      );
    }
  }
  return out;
};
