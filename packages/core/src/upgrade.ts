/**
 * `protoboard upgrade`: move a project made by an earlier stack line (0.1.x)
 * to this one. This file is the package.json part: every `@protoboardai/*`
 * range becomes `^<this stack's version>`, and the toolchain the stack pins
 * exactly (`@deltarobotics/uhd`, `typescript`, `TOOLCHAIN`) follows, as
 * `init` writes them. The CLI then re-links the project's packages, refreshes
 * its agent guidance (`init --refresh-guidance`) and runs `parts migrate`.
 *
 * Only plain versions and ranges are rewritten. A `file:`, `link:`, git, URL,
 * tag or workspace spec is the project's own choice and is left as it is
 * (listed under `kept`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLCHAIN } from "./init.js";

const CORE_PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

/** The range a project of this stack asks for: what `init` writes. */
export const STACK_RANGE = `^${CORE_PKG.version}`;

const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
type Field = (typeof FIELDS)[number];

export interface UpgradeChange {
  field: Field;
  name: string;
  from: string;
  to: string;
}

export interface UpgradePlan {
  root: string;
  /** The stack range the project asked for before (`@protoboardai/cli`, else core). */
  from?: string;
  to: string;
  changes: UpgradeChange[];
  /** Stack packages whose spec is not a plain version or range: left as they are. */
  kept: { field: Field; name: string; spec: string }[];
}

/** A plain version or range (`^0.1.7`, `0.2.1`, `~1.2`, `>=0.1.0`), as opposed to a path, URL, tag or workspace spec. */
const plain = (spec: string) => /^\s*(\^|~|>=|=)?\s*v?\d+(\.(\d+|x|\*))?(\.(\d+|x|\*))?(-[0-9A-Za-z.-]+)?\s*$/.test(spec);

/** What `upgrade` would change in the project's package.json; writes nothing. */
export function planUpgrade(root: string): UpgradePlan {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Partial<Record<Field, Record<string, string>>>;
  const changes: UpgradeChange[] = [];
  const kept: UpgradePlan["kept"] = [];
  const wanted = (name: string): string | undefined => {
    if (name.startsWith("@protoboardai/")) return STACK_RANGE;
    if (name === "@deltarobotics/uhd") return TOOLCHAIN.uhd;
    if (name === "typescript") return TOOLCHAIN.typescript;
    return undefined;
  };
  for (const field of FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      const to = wanted(name);
      if (!to) continue;
      // a project's own TypeScript range is its choice; only the exact pin init wrote follows the stack
      if (name === "typescript" && !/^\d+\.\d+\.\d+$/.test(spec.trim())) continue;
      if (!plain(spec)) {
        if (name !== "typescript") kept.push({ field, name, spec });
        continue;
      }
      if (spec.trim() !== to) changes.push({ field, name, from: spec, to });
    }
  }
  const deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  const from = deps["@protoboardai/cli"] ?? deps["@protoboardai/core"];
  return { root, ...(from ? { from } : {}), to: STACK_RANGE, changes, kept };
}

/** Write a plan's changes into package.json, keeping the file's key order and two-space indent. */
export function applyUpgrade(plan: UpgradePlan): void {
  if (!plan.changes.length) return;
  const file = join(plan.root, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8")) as Partial<Record<Field, Record<string, string>>>;
  for (const c of plan.changes) (pkg[c.field] ??= {})[c.name] = c.to;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
}
