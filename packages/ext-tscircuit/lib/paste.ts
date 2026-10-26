/**
 * The stencil, written from the land patterns rather than left to tscircuit.
 *
 * tscircuit gives every SMD pad a paste aperture of 70 % of the pad in each
 * direction (49 % of its area), none at all to a pill-shaped pad, and one on
 * both sides of every plated hole. None of that is what a manufacturer's
 * land pattern asks for. After each build, every component with an authored
 * land pattern gets exactly the apertures of its paste plan (source.ts
 * `pastePlan`): placed with the component (rotation, and mirrored in X on the
 * bottom side), on the component's own side. Built-in footprint strings keep
 * tscircuit's apertures.
 */
import type { CircuitElement } from "./runtime.ts";
import type { NameMap } from "./source.ts";

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Pad centre of a copper element, or undefined. */
const at = (e: CircuitElement): [number, number] | undefined => (typeof e.x === "number" && typeof e.y === "number" ? [e.x, e.y] : undefined);

export function applyPaste(cj: CircuitElement[], map: NameMap): { circuitJson: CircuitElement[]; components: number; apertures: number; problems: string[] } {
  const problems: string[] = [];
  const nameOf = new Map(cj.filter((e) => e.type === "source_component").map((s) => [s.source_component_id, s.name as string]));
  const drop = new Set<CircuitElement>();
  const add: CircuitElement[] = [];
  let components = 0;
  let n = 0;
  for (const pc of cj.filter((e) => e.type === "pcb_component")) {
    const plan = map.components[nameOf.get(pc.source_component_id) ?? ""]?.paste;
    if (!plan) continue;
    const copper = cj.filter((e) => (e.type === "pcb_smtpad" || e.type === "pcb_plated_hole") && e.pcb_component_id === pc.pcb_component_id);
    const anchor = copper.find((e) => (e.port_hints ?? []).includes(plan.anchor.hint));
    const a = anchor && at(anchor);
    if (!a) {
      problems.push(`${map.components[nameOf.get(pc.source_component_id)!].instance}: no pad ${plan.anchor.hint} to place the stencil by; tscircuit's apertures kept`);
      continue;
    }
    const bottom = pc.layer === "bottom";
    const deg = ((((pc.rotation as number) ?? 0) % 360) + 360) % 360;
    const t = (deg * Math.PI) / 180;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const place = (x: number, y: number): [number, number] => {
      const fx = bottom ? -x : x;
      return [fx * c - y * s, fx * s + y * c];
    };
    const [ax, ay] = place(plan.anchor.x, plan.anchor.y);
    const origin: [number, number] = [a[0] - ax, a[1] - ay];
    // this component's apertures: tied to its pads, or (plated holes) at a hole's centre with no component id
    const holes = copper.filter((e) => e.type === "pcb_plated_hole").map(at).filter(Boolean) as [number, number][];
    for (const p of cj) {
      if (p.type !== "pcb_solder_paste") continue;
      if (p.pcb_component_id === pc.pcb_component_id || (!p.pcb_component_id && holes.some(([hx, hy]) => Math.abs(hx - p.x) < 1e-4 && Math.abs(hy - p.y) < 1e-4))) drop.add(p);
    }
    const quarter = Math.abs(deg % 90) < 1e-6 || Math.abs((deg % 90) - 90) < 1e-6;
    const turned = quarter && Math.round(deg / 90) % 2 === 1;
    for (const ap of plan.apertures) {
      const [dx, dy] = place(ap.x, ap.y);
      const base = { type: "pcb_solder_paste", pcb_solder_paste_id: `pcb_solder_paste_land_${pc.pcb_component_id}_${n++}`, layer: bottom ? "bottom" : "top", pcb_component_id: pc.pcb_component_id, x: r4(origin[0] + dx), y: r4(origin[1] + dy) };
      if (!quarter) {
        add.push({ ...base, shape: "rotated_rect", width: ap.w, height: ap.h, ccw_rotation: bottom ? -deg : deg });
        continue;
      }
      const [w, h] = turned ? [ap.h, ap.w] : [ap.w, ap.h];
      add.push(ap.pill ? { ...base, shape: "pill", width: w, height: h, radius: Math.min(w, h) / 2 } : { ...base, shape: "rect", width: w, height: h });
    }
    components++;
  }
  return { circuitJson: [...cj.filter((e) => !drop.has(e)), ...add], components, apertures: add.length, problems };
}
