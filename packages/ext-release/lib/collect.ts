/**
 * Each unit's manufacturing `files/`, collected from the capability providers'
 * standard outputs (tool-integrations.md §3, §8) — never from native files:
 *
 *   files/boards/<module>/       circuit: gerber/ (layers + drill), bom.csv, pnp.csv, board.step, board.glb
 *   files/mechanical/<module>/   cad: <module>.step and the process exports (.stl, .3mf, .dxf)
 *   files/harnesses/<module>/    cad on a cable: routed <module>.step and .glb, and cut-list.csv from the model
 *
 * A custom module's files go to every unit that builds it: a unit whose own
 * module it is, or one it is folded into.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { CapabilityBinding, Project } from "@protoboardai/core";
import { cutList, cutListCsv, isCable } from "./cutlist.ts";
import type { PackageFile, Unit } from "./types.ts";
import { unitBom } from "./bom.ts";
import { byCode, posix } from "./util.ts";

const listFiles = (abs: string, base = abs): string[] =>
  !existsSync(abs)
    ? []
    : readdirSync(abs)
        .sort(byCode)
        .flatMap((f) => (statSync(join(abs, f)).isDirectory() ? listFiles(join(abs, f), base) : [posix(relative(base, join(abs, f)))]));

/** What kind of folder a bound module's files go to. */
export function fileGroup(p: Project, b: CapabilityBinding): "boards" | "mechanical" | "harnesses" | "firmware" {
  if (b.capability === "circuit") return "boards";
  if (b.capability === "firmware") return "firmware";
  const def = p.definitions.get(b.module!)?.def;
  return def && def.kind === "harness" ? "harnesses" : "mechanical";
}

/**
 * Bound modules a unit builds: its own module and the modules folded into it. A purchased part researched in
 * the project (parts/local) may have its body drawn through a cad provider; it is bought, not built, so its
 * CAD is no fabrication file (it travels in the model bundle).
 */
export function unitModules(p: Project, unit: Unit): CapabilityBinding[] {
  const defs = new Set([unit.kind === "root" ? "" : unit.definition, ...unit.members.filter((m) => !m.unit).map((m) => m.definition)]);
  return p.capabilities
    .filter((b) => !b.problem && b.module && defs.has(b.module) && p.definitions.get(b.module)?.origin.tier !== "project-researched")
    .sort((a, b) => byCode(a.module!, b.module!));
}

/** Standard outputs → package files for one unit. Paths are package-relative. */
export function collectUnitFiles(p: Project, unit: Unit): PackageFile[] {
  const files: PackageFile[] = [];
  const add = (path: string, from: string | undefined, content: Buffer, role: string, description: string) =>
    files.push({ path: `${unit.folder}/files/${path}`, unit: unit.id, role, ...(from ? { from } : {}), content, description });
  for (const b of unitModules(p, unit)) {
    const m = b.module!;
    const group = fileGroup(p, b);
    const dir = `${group}/${m}`;
    const out = (rel: string) => `${b.out}/${rel}`;
    const read = (rel: string) => readFileSync(join(p.root, b.out, rel));
    const present = listFiles(join(p.root, b.out));
    if (group === "boards") {
      for (const f of present.filter((f) => f.startsWith("gerber/"))) add(`${dir}/${f}`, out(f), read(f), "fabrication", /\.(drl|xln)$/i.test(f) ? "Excellon drill" : "Gerber layer");
      for (const [f, role, what] of [
        ["bom.csv", "assembly", "board BOM (UHD instance keys)"],
        ["pnp.csv", "assembly", "pick-and-place"],
        ["board.step", "fabrication", "board body (STEP)"],
        ["board.glb", "model", "board body (GLB)"],
      ] as const)
        if (present.includes(f)) add(`${dir}/${f}`, out(f), read(f), role, what);
      continue;
    }
    // a firmware provider's configuration (a Zephyr board definition, a sdkconfig): its whole config/ tree and manifest
    if (group === "firmware") {
      for (const f of present.filter((f) => f.startsWith("config/") || f === "firmware.manifest.json")) add(`${dir}/${f.replace(/^config\//, "")}`, out(f), read(f), "firmware-config", f === "firmware.manifest.json" ? "firmware configuration manifest (cites the board)" : "firmware configuration");
      continue;
    }
    const renamed = (f: string) => (basename(f).startsWith("body.") ? `${m}${basename(f).slice(4)}` : basename(f));
    if (group === "mechanical") {
      for (const f of present.filter((f) => !f.includes("/") && /\.(step|stl|3mf|dxf)$/i.test(f)))
        add(`${dir}/${renamed(f)}`, out(f), read(f), "fabrication", /\.step$/i.test(f) ? "body (STEP)" : /\.dxf$/i.test(f) ? "cutting profile (DXF)" : "print file");
      continue;
    }
    for (const f of present.filter((f) => !f.includes("/") && /\.(step|glb)$/i.test(f))) add(`${dir}/${renamed(f)}`, out(f), read(f), /\.step$/i.test(f) ? "fabrication" : "model", `routed harness (${f.split(".").pop()!.toUpperCase()})`);
    const def = p.definitions.get(m)!.def;
    if (isCable(def) && cutList(def).length) add(`${dir}/cut-list.csv`, undefined, Buffer.from(cutListCsv(def)), "fabrication", "cut list (from the model)");
  }
  // a cable made by hand, with no cad provider: its cut list still comes from the model
  const bound = new Set(unitModules(p, unit).map((b) => b.module));
  // (the cables the work order makes or cuts: fabricated, or supplied longer than installed)
  const cables = [...new Set(unitBom(p, unit).filter((r) => r.kind === "cable").map((r) => r.definition))].sort(byCode);
  for (const id of cables) {
    const def = p.lookup(id);
    if (!def || bound.has(id) || !isCable(def)) continue;
    const rows = cutList(def);
    const made = unitBom(p, unit).some((r) => r.definition === id && r.action === "fabricate");
    const cut = rows[0]?.length_mm && rows[0].supplied_length_mm && rows[0].length_mm < rows[0].supplied_length_mm;
    if (!rows.length || !(made || cut)) continue;
    add(`harnesses/${id}/cut-list.csv`, undefined, Buffer.from(cutListCsv(def)), "fabrication", "cut list (from the model)");
  }
  return files;
}

