/**
 * The project's assembly as the sequence, the mates and the interference check
 * place it (PB-1183, PB-1185): the viewer's root (uhd-viewer `cad/scope.ts`):
 * the display file's `spatial.root` when it names one, else the system when
 * it has a body, else the top-level module with the most interface frames;
 * display placements fix what no mate places. Core only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assemble, type Assembly, type Mat4, type ModuleDef } from "@deltarobotics/uhd";
import type { Project } from "../project.js";

const hasBody = (def: ModuleDef) => (def.artifacts ?? []).some((a) => a.role === "body" && a.format === "glb");

/** The viewer's default root: the system when it has a body, else the top-level module with the most interface frames. */
export function defaultSequenceRoot(system: ModuleDef, lookup: (id: string) => ModuleDef | undefined): string[] {
  if (hasBody(system)) return [];
  let best: { id: string; frames: number } | undefined;
  for (const c of system.children ?? []) {
    const def = lookup(c.moduleDefId);
    if (!def || def.kind === "harness") continue;
    const frames = def.interfaces.filter((i) => i.geometry?.frame).length;
    if (frames && (!best || frames > best.frames)) best = { id: c.id, frames };
  }
  return best ? [best.id] : [];
}

interface DisplaySpatial {
  root?: string;
  placements?: Record<string, { matrix?: Mat4 }>;
}

export function readDisplaySpatial(p: Project): DisplaySpatial {
  const file = join(p.root, p.config.display ?? ".protoboard/display.json");
  try {
    return existsSync(file) ? ((JSON.parse(readFileSync(file, "utf8")) as { spatial?: DisplaySpatial }).spatial ?? {}) : {};
  } catch {
    return {}; // an unreadable display file only loses the hints, as in the project check
  }
}

/** assemble() from the viewer's root with the display file's fixed placements. Undefined without a root system. */
export function assembleProject(p: Project): { asm: Assembly; root: string[]; fixed: Record<string, Mat4> } | undefined {
  if (!p.rootDef) return undefined;
  const spatial = readDisplaySpatial(p);
  const root = spatial.root ? spatial.root.split("/") : defaultSequenceRoot(p.rootDef, p.lookup);
  const fixed = Object.fromEntries(Object.entries(spatial.placements ?? {}).filter(([, v]) => Array.isArray(v.matrix) && v.matrix.length === 16).map(([k, v]) => [k, v.matrix!]));
  return { asm: assemble(p.rootDef, p.lookup, { root, fixed }), root, fixed };
}
