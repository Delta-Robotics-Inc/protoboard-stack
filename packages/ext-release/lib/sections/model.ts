/**
 * Model queries the baseline sections share: a unit's definition, mass,
 * links (the joining operations inside one build) and boundary interfaces.
 */
import { existsSync, readFileSync } from "node:fs";
import { jointTorques, systemMass, type ModuleDef, type SystemMass } from "@deltarobotics/uhd";
import type { Project } from "@protoboardai/core";
import type { Unit } from "../types.ts";
import { num } from "../util.ts";

export const unitDef = (p: Project, u: Unit) => p.lookup(u.definition)!;

/** Volume of a module's generated CAD body, from the geometry manifest its artifacts reference (volume_mm3). */
export function cadVolume(p: Project) {
  return (def: ModuleDef): number | undefined => {
    for (const a of def.artifacts ?? []) {
      if (a.format !== "json" || !a.provenance?.generatedFrom) continue;
      const r = p.artifacts.find((x) => x.definition === def.id && x.id === a.id);
      if (r?.present !== true || !r.resolved || !existsSync(r.resolved)) continue;
      try {
        const v = (JSON.parse(readFileSync(r.resolved, "utf8")) as { volume_mm3?: unknown }).volume_mm3;
        if (typeof v === "number") return v;
      } catch {
        // not a manifest
      }
    }
    return undefined;
  };
}

/** Mass of one build of the unit (sub-units included): stated weights, else CAD volume × density; missing instances listed. */
export function unitMass(p: Project, u: Unit): SystemMass {
  return systemMass(unitDef(p, u), p.lookup, cadVolume(p));
}

export const grams = (g: number) => (g >= 1000 ? `${num(g / 1000, 3)} kg` : `${num(g, 1)} g`);

export interface UnitLink {
  /** Link id, prefixed with the declaring member's path inside the unit. */
  id: string;
  name: string;
  a: string;
  b: string;
  /** Unit-relative path of the harness that carries it, and its definition. */
  harness?: { path: string; def: ModuleDef };
  mate: boolean;
  torques: string[];
}

/** The links made while building one unit: declared by its module and by every member folded into it. */
export function unitLinks(p: Project, u: Unit): UnitLink[] {
  const out: UnitLink[] = [];
  const declarers: { path: string; def: ModuleDef }[] = [{ path: "", def: unitDef(p, u) }, ...u.members.filter((m) => !m.unit).map((m) => ({ path: m.path, def: p.lookup(m.definition)! }))];
  for (const { path, def } of declarers) {
    if (def.kind === "harness") continue; // a harness's own conductors are made with the harness
    for (const l of def.links ?? []) {
      const end = (e: (typeof l)["a"]) => {
        const child = "child" in e ? e.child : "";
        const at = [path, child].filter(Boolean).join("/");
        const m = u.members.find((x) => x.path === at);
        return `${m?.name ?? (at || def.name)}${e.interfaceId ? ` · ${e.interfaceId}` : ""}`;
      };
      const hp = l.harness ? [path, l.harness].filter(Boolean).join("/") : undefined;
      const hm = hp ? u.members.find((x) => x.path === hp) : undefined;
      const hdef = hm ? p.lookup(hm.definition) : undefined;
      out.push({
        id: [path, l.id].filter(Boolean).join("/"),
        name: l.name ?? l.id,
        a: end(l.a),
        b: end(l.b),
        ...(hp && hdef ? { harness: { path: hp, def: hdef } } : {}),
        mate: !!l.mate || !!hdef?.fastenerStack?.length,
        torques: hdef ? jointTorques(hdef, p.lookup).map((t) => `${t.part?.name ?? t.child}: ${num(t.torque.torqueNm, 2)} N·m${t.basis === "assumption" ? " (assumed)" : ""}`) : [],
      });
    }
  }
  return out;
}
