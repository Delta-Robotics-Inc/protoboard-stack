/**
 * TEST FIXTURE. What the fake circuit providers read from a UHD board module:
 * its components (children) and nets (links between them), and the drift
 * check both run against their native designs. Placement is a naive grid.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import type { ProjectDiagnostic } from "@protoboardai/core";

export interface Placed {
  instance: string;
  definition: string;
  x: number;
  y: number;
  rotation: number;
  side: "top" | "bottom";
}

export interface Net {
  id: string;
  link: string;
  pins: string[];
}

export interface Size {
  w: number;
  h: number;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && v > 0 ? v : fallback);

/** Components on a 10 mm grid, the board sized by the constraints (or to fit). */
export function place(def: ModuleDef, constraints: Record<string, unknown>): { size: Size; components: Placed[] } {
  const children = def.children ?? [];
  const components = children.map((c, i) => ({ instance: c.id, definition: c.moduleDefId, x: 6 + 10 * (i % 3), y: 6 + 10 * Math.floor(i / 3), rotation: 0, side: "top" as const }));
  const size = { w: num(constraints.width_mm, 12 + 10 * Math.min(3, children.length)), h: num(constraints.height_mm, 12 + 10 * Math.ceil(children.length / 3)) };
  return { size, components };
}

/** One net per UHD link: `<child>:<interface>`, or `:<interface>` for the board's own. */
export function netsOf(def: ModuleDef): Net[] {
  const pin = (e: { interfaceId: string } & ({ child: string } | { self: true })) => `${"child" in e ? e.child : ""}:${e.interfaceId}`;
  return (def.links ?? []).map((l) => ({ id: `N_${l.id}`, link: l.id, pins: [pin(l.a), pin(l.b)] }));
}

/** Mounting holes 3 mm in from each corner. */
export const holes = (s: Size) => [
  { x: 3, y: 3 },
  { x: s.w - 3, y: 3 },
  { x: s.w - 3, y: s.h - 3 },
  { x: 3, y: s.h - 3 },
];

/** The native design against the module: components and nets added or removed since generate. */
export function drift(def: ModuleDef, components: string[], links: string[], code: string, source: string): Omit<ProjectDiagnostic, "validator">[] {
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  const entity = { kind: "definition" as const, id: def.id };
  const want = (def.children ?? []).map((c) => c.id);
  const wantLinks = (def.links ?? []).map((l) => l.id);
  for (const c of want.filter((c) => !components.includes(c))) out.push({ code, severity: "error", entity, message: `${c} is in the model but not in the design; regenerate`, source: { file: source } });
  for (const c of components.filter((c) => !want.includes(c))) out.push({ code, severity: "error", entity, message: `${c} is in the design but no longer in the model; regenerate`, source: { file: source } });
  for (const l of wantLinks.filter((l) => !links.includes(l))) out.push({ code, severity: "error", entity, message: `link ${l} has no net in the design; regenerate`, source: { file: source } });
  return out;
}
