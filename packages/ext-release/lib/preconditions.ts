/**
 * What must hold before a release is written (release-package-and-evals.md §1):
 * `protoboard check` reports no errors, and nothing generated is stale against
 * its sources. Staleness is decided from evidence, never assumed:
 *
 *   - providers' checks: any finding whose code ends in `_STALE` (warning or
 *     error), and a provider check that was skipped (its result is unknown);
 *   - every bound module has been exported, and its out/ is exactly what the
 *     latest export record lists (same files, same digests), made from the
 *     current config and, when the record has it, the current module;
 *   - every file an operation record wrote is still the bytes it wrote
 *     (latest record per file; files since deleted are not checked here;
 *     earlier packages under release/ are not inputs, so not checked);
 *   - the source tree: a git work tree with uncommitted changes outside
 *     release/ and operations/ is refused unless `allowDirty` (recorded).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { listOperationRecords, moduleDigest, type CapabilityBinding, type OperationRecord, type Project } from "@protoboardai/core";
import { posix, sha256 } from "./util.ts";
import type { SectionDiagnostic } from "./types.ts";

export interface Freshness {
  /** `<capability>:<module>` (exportKey) → its latest succeeded export record. */
  exports: Map<string, { file: string; record: OperationRecord }>;
  /** Project file → the latest record that wrote it. */
  writers: Map<string, { file: string; record: OperationRecord }>;
  diagnostics: SectionDiagnostic[];
}

const listFiles = (abs: string, base = abs): string[] =>
  !existsSync(abs) ? [] : readdirSync(abs).flatMap((f) => (statSync(join(abs, f)).isDirectory() ? listFiles(join(abs, f), base) : [posix(relative(base, join(abs, f)))]));

/** Records, newest last, with the outputs each one wrote. */
export function freshness(p: Project): Freshness {
  const diagnostics: SectionDiagnostic[] = [];
  const stale = (message: string) => diagnostics.push({ code: "REL_STALE", severity: "error", message });
  const records = listOperationRecords(p).filter((r) => r.record.status === "succeeded");
  const writers = new Map<string, { file: string; record: OperationRecord }>();
  for (const r of records) for (const o of r.record.outputs) writers.set(o.path, r);

  // ---- every recorded output is still the bytes its latest writer wrote
  // (not the release's own packages: a release replaces its folder, and nothing reads them back)
  for (const [path, r] of writers) {
    if (r.record.operation === "release" && path.startsWith("release/")) continue;
    const abs = join(p.root, path);
    if (!existsSync(abs)) continue;
    const out = r.record.outputs.find((o) => o.path === path)!;
    if (sha256(readFileSync(abs)) !== out.digest) stale(`${path} was changed after ${r.record.operation} wrote it (${r.file}); re-run the operation instead of editing generated files`);
  }

  // ---- every bound module: exported, by the current config and module, and out/ untouched.
  // Two capabilities may share a module's out/ (a board's circuit and firmware exports): its
  // files are then checked against the latest export of each capability together.
  const exports = new Map<string, { file: string; record: OperationRecord }>();
  const byOut = new Map<string, { b: CapabilityBinding; rec: { file: string; record: OperationRecord } }[]>();
  for (const b of p.capabilities) {
    if (b.problem || !b.module) continue;
    const rerun = `protoboard run ${b.capability}:export --module ${b.module}`;
    const rec = [...records].reverse().find((r) => r.record.operation === `${b.capability}:export` && r.record.capability?.module === b.module);
    if (!rec) {
      stale(`${b.module} has no recorded ${b.capability}:export (${b.out}/ cannot be traced to a run); run \`${rerun}\``);
      continue;
    }
    exports.set(exportKey(b), rec);
    byOut.set(b.out, [...(byOut.get(b.out) ?? []), { b, rec }]);
    const cap = rec.record.capability!;
    if (cap.config !== b.config || cap.configDigest !== b.configDigest) stale(`${b.module}: ${b.config} changed since the last export (${rec.file}); run \`${rerun}\``);
    if (cap.provider !== providerId(p, b)) stale(`${b.module}: the last export was made by ${cap.provider}, the config now names ${b.provider}; run \`${rerun}\``);
    const def = p.definitions.get(b.module)?.def;
    if (cap.moduleDigest && def && cap.moduleDigest !== moduleDigest(def, p.lookup)) stale(`${b.module} changed since its last export (${rec.file}); run \`protoboard run ${b.capability}:generate --module ${b.module}\` and export`);
  }
  for (const [out, rs] of byOut) {
    const recorded = new Map(rs.flatMap(({ rec }) => rec.record.outputs.filter((o) => o.path.startsWith(out + "/")).map((o) => [o.path, rec] as const)));
    const present = listFiles(join(p.root, out)).map((f) => `${out}/${f}`);
    const names = rs.map(({ b, rec }) => `${b.capability}: ${rec.file}`).join("; ");
    const reruns = rs.map(({ b }) => `\`protoboard run ${b.capability}:export --module ${b.module}\``).join(" or ");
    for (const f of present.filter((f) => !recorded.has(f))) stale(`${f} is not from the last export of ${rs[0].b.module} (${names}); remove it or run ${reruns}`);
    for (const [f, rec] of [...recorded].filter(([f]) => !present.includes(f))) stale(`${f} from the last export of ${rs[0].b.module} is missing (${rec.file}); run ${reruns}`);
  }
  return { exports, writers, diagnostics };
}

/** Key of `Freshness.exports`: one export per capability of a module. */
export const exportKey = (b: Pick<CapabilityBinding, "capability" | "module">) => `${b.capability}:${b.module}`;

const providerId = (p: Project, b: CapabilityBinding) => p.extensions.find((e) => e.package === b.provider)?.manifest.id ?? b.provider;

/** Git state of the project: commit and whether design inputs have uncommitted changes. */
export function gitState(root: string, ignore: string[]): { commit: string; date: string; dirty: string[] } | undefined {
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    if (git("rev-parse", "--is-inside-work-tree").trim() !== "true") return undefined;
    // a project inside an ignored folder of another repository is not under version control
    try {
      git("check-ignore", "-q", "protoboard.config.ts");
      return undefined;
    } catch {
      // not ignored
    }
    const commit = git("rev-parse", "HEAD").trim();
    const date = git("log", "-1", "--format=%cI", "HEAD").trim();
    const top = git("rev-parse", "--show-toplevel").trim();
    const prefix = posix(relative(top, root));
    const dirty = git("status", "--porcelain", "--untracked-files=all", "--", ".")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop()!)
      .map((f) => (prefix ? posix(relative(prefix, f)) : f))
      .filter((f) => !ignore.some((i) => f === i || f.startsWith(i + "/")));
    return { commit, date, dirty };
  } catch {
    return undefined;
  }
}

/**
 * Everything that stops a release, as errors; plus the check summary
 * findings worth keeping (warnings), which the manifest records.
 */
export function preconditions(p: Project, fresh: Freshness): SectionDiagnostic[] {
  const out: SectionDiagnostic[] = [];
  const errors = p.diagnostics.filter((d) => d.severity === "error");
  if (errors.length)
    out.push({
      code: "REL_CHECK_ERRORS",
      severity: "error",
      message: `protoboard check reports ${errors.length} error(s); fix them first: ${errors
        .slice(0, 5)
        .map((d) => `${d.code} ${d.message}`)
        .join(" · ")}${errors.length > 5 ? " · …" : ""}`,
    });
  // stale standard outputs are the freshness check's own findings below, with the same evidence (the records)
  for (const d of p.diagnostics.filter((d) => /_STALE$/.test(d.code) && d.severity !== "info" && d.code !== "PB_OUTPUT_STALE")) out.push({ code: "REL_STALE", severity: "error", message: `${d.code} (${d.validator}): ${d.message}` });
  for (const c of p.checks.filter((c) => c.status === "skipped" && /\/(circuit|cad):check$/.test(c.validator)))
    out.push({ code: "REL_FRESHNESS_UNKNOWN", severity: "error", message: `${c.validator}${c.subject ? ` [${c.subject}]` : ""} was skipped (${c.reason}); without it the module's outputs cannot be shown to be current` });
  for (const d of p.diagnostics.filter((d) => d.code === "PB_OUTPUT_NOT_EXPORTED")) out.push({ code: "REL_NOT_EXPORTED", severity: "error", message: d.message });
  out.push(...fresh.diagnostics);
  return out;
}
