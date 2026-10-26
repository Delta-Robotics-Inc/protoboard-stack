/**
 * Which modules have a drawing to show, where they are in the system, and
 * the drawing file's URL. Found by standard-output file name, never by tool.
 */
import type { ArtifactDef, ModuleDef, UhdBundle } from "@deltarobotics/uhd";
import { definition, fileName } from "../applies.js";
import type { HostAdapter } from "../types.js";

export const SCHEMATIC_FILES = ["schematic.svg"] as const;
export const PCB_FILES = { top: "pcb-top.svg", bottom: "pcb-bottom.svg" } as const;
/** The circuit provider's routed board (Circuit JSON): the PCB view draws it when a board has it. */
export const ROUTED_FILE = "circuit.json";

/** A module with drawings, at its instance path. */
export interface BoardAt {
  def: ModuleDef;
  /** Instance path from the root ("" is the root). */
  path: string;
  /** Its name where it is used (the child ref's name), else the definition's. */
  label: string;
}

const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

/**
 * The module and every module below it that has one of `files`, each
 * definition once (the first place it is used), in the order a reader meets
 * them: the module itself, then depth first.
 */
export function boardsWith(module: ModuleDef, bundle: UhdBundle, path: string, files: readonly string[]): BoardAt[] {
  const out: BoardAt[] = [];
  const seen = new Set<string>();
  const has = (d: ModuleDef) => (d.artifacts ?? []).some((a) => files.includes(fileName(a)));
  const walk = (d: ModuleDef, at: string, label: string) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    if (has(d)) out.push({ def: d, path: at, label });
    for (const c of d.children ?? []) {
      const child = definition(bundle, c.moduleDefId);
      if (child) walk(child, join(at, c.id), c.name ?? child.name);
    }
  };
  walk(module, path, module.name);
  return out;
}

/** A module's artifact by file name. */
export const artifactNamed = (def: ModuleDef, name: string): ArtifactDef | undefined => (def.artifacts ?? []).find((a) => fileName(a) === name);

/** Where to fetch an artifact: the host's URL for it, else its own `url`. */
export function artifactHref(host: HostAdapter, def: ModuleDef, a: ArtifactDef | undefined): string | undefined {
  if (!a) return undefined;
  if (a.filePath) {
    const u = host.artifactUrl?.(def.id, a.filePath);
    if (u) return u;
  }
  return a.url && /^https?:\/\//.test(a.url) ? a.url : undefined;
}

/** The circuit tool's source for a board (an artifact in the `source` role that is not CAD). */
export const circuitSource = (def: ModuleDef): ArtifactDef | undefined =>
  (def.artifacts ?? []).find((a) => a.role === "source" && !/^(py|kcl|build123d)$/i.test(a.format ?? "") && !/\.json$/i.test(a.filePath ?? ""));

/**
 * A board's KiCad project when KiCad is its layout of record (a locked board:
 * `circuit:lock`, ext-tscircuit). Its exported drawings (schematic.svg,
 * pcb-top.svg, pcb-bottom.svg) are then the board as it is, and the circuit
 * provider's routed result (circuit.json) is the build it was locked from.
 */
export const kicadLayout = (def: ModuleDef): ArtifactDef | undefined => (def.artifacts ?? []).find((a) => a.role === "source" && (a.format === "kicad" || /\.kicad_(pro|pcb|sch)$/i.test(a.filePath ?? "")));

/** The definition of the instance at `path` below `def` (`charger/pwr_rt1`), walking the children. */
export function instanceAt(bundle: UhdBundle, def: ModuleDef, path: string): { id: string; moduleDefId: string; name?: string } | undefined {
  let d: ModuleDef | undefined = def;
  let ref: { id: string; moduleDefId: string; name?: string } | undefined;
  for (const seg of path.split("/").filter(Boolean)) {
    ref = d?.children?.find((c) => c.id === seg);
    if (!ref) return undefined;
    d = definition(bundle, ref.moduleDefId);
  }
  return ref;
}
