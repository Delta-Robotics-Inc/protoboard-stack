/**
 * The silkscreen for authored land patterns: tscircuit draws silkscreen
 * (outline and reference) only for its built-in footprint strings, so a board
 * whose parts all have authored land patterns would go to the fab with an
 * empty silkscreen. After each build this pass adds, for every component
 * with an authored land pattern:
 *
 *   - its reference designator (R12, U3: tscircuit/refdes.json, which the
 *     KiCad handoff keeps; the UHD instance path only for a component that
 *     has none), 0.8 mm high (the usual fab
 *     minimum), set beside its courtyard on the first side where it clears
 *     every pad, hole, courtyard, the board edge and the references already
 *     set; at 0.6 mm when none of the four sides has room; left off (and
 *     reported) when neither size fits;
 *   - a pin-1 mark (a Ø0.3 mm dot) beside the pin-1 pad, on the clear side
 *     farthest from the part's centre, for parts with a pin 1 and three or
 *     more pins.
 *
 * Nothing is drawn over a pad or a hole, so the fab need not clip silkscreen
 * from the solder-mask openings.
 */
import type { CircuitElement } from "./runtime.ts";
import type { NameMap } from "./source.ts";

type Box = [number, number, number, number]; // x0, y0, x1, y1

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const overlaps = (a: Box, b: Box, gap = 0) => a[0] < b[2] + gap && b[0] < a[2] + gap && a[1] < b[3] + gap && b[1] < a[3] + gap;

/** Axis-aligned box of a copper or hole element (rotated pads by their corners), grown by `grow`. */
function boxOf(e: CircuitElement, grow = 0): Box | undefined {
  if (typeof e.x !== "number" || typeof e.y !== "number") return undefined;
  let w = e.width ?? e.outer_width ?? e.outer_diameter ?? e.hole_diameter ?? (e.radius ?? 0) * 2;
  let h = e.height ?? e.outer_height ?? e.outer_diameter ?? e.hole_diameter ?? (e.radius ?? 0) * 2;
  const a = (((e.ccw_rotation as number) ?? 0) * Math.PI) / 180;
  if (a) [w, h] = [Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))];
  const m = (e.soldermask_margin ?? 0) + grow;
  return [e.x - w / 2 - m, e.y - h / 2 - m, e.x + w / 2 + m, e.y + h / 2 + m];
}

/** Point in polygon (even-odd). */
function inside([x, y]: [number, number], poly: { x: number; y: number }[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export function addSilkscreen(cj: CircuitElement[], map: NameMap, designators: Record<string, string> = {}): { circuitJson: CircuitElement[]; references: number; marks: number; omitted: string[] } {
  const board = cj.find((e) => e.type === "pcb_board");
  const outline: { x: number; y: number }[] | undefined = board?.outline;
  const onBoard = (b: Box, margin = 0.2) => {
    if (!outline) return true;
    const pts: [number, number][] = [[b[0] - margin, b[1] - margin], [b[2] + margin, b[1] - margin], [b[2] + margin, b[3] + margin], [b[0] - margin, b[3] + margin], [(b[0] + b[2]) / 2, b[1] - margin], [(b[0] + b[2]) / 2, b[3] + margin], [b[0] - margin, (b[1] + b[3]) / 2], [b[2] + margin, (b[1] + b[3]) / 2]];
    return pts.every((p) => inside(p, outline));
  };
  const nameOf = new Map(cj.filter((e) => e.type === "source_component").map((s) => [s.source_component_id, s.name as string]));
  // what silkscreen must not touch, per side: every pad and hole (mask openings) and every courtyard
  const side = (layer: string) => (e: CircuitElement) => e.layer === layer || (Array.isArray(e.layers) && e.layers.includes(layer)) || e.type === "pcb_hole" || e.type === "pcb_plated_hole";
  const copper = (layer: string) => cj.filter((e) => ["pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_via"].includes(e.type)).filter(side(layer)).map((e) => boxOf(e, 0.1)).filter(Boolean) as Box[];
  const courtyards = (layer: string) =>
    cj
      .filter((e) => e.type === "pcb_courtyard_rect" && e.layer === layer)
      .map((e) => {
        const a = ((e.ccw_rotation ?? 0) * Math.PI) / 180;
        const w = Math.abs(e.width * Math.cos(a)) + Math.abs(e.height * Math.sin(a));
        const h = Math.abs(e.width * Math.sin(a)) + Math.abs(e.height * Math.cos(a));
        return { id: e.pcb_component_id as string, box: [e.center.x - w / 2, e.center.y - h / 2, e.center.x + w / 2, e.center.y + h / 2] as Box };
      });
  const obstacles = { top: copper("top"), bottom: copper("bottom") };
  const yards = { top: courtyards("top"), bottom: courtyards("bottom") };
  const placed: Record<string, Box[]> = { top: [], bottom: [] };
  const add: CircuitElement[] = [];
  const omitted: string[] = [];
  let references = 0;
  let marks = 0;
  let n = 0;

  for (const pc of cj.filter((e) => e.type === "pcb_component")) {
    const m = map.components[nameOf.get(pc.source_component_id) ?? ""];
    if (!m?.paste) continue; // built-in footprint strings: tscircuit's own silkscreen
    const layer: "top" | "bottom" = pc.layer === "bottom" ? "bottom" : "top";
    const own = yards[layer].find((y) => y.id === pc.pcb_component_id)?.box;
    if (!own) continue;

    // the reference: beside the courtyard, on the first place that is clear (each side's middle, then its ends)
    let set = false;
    for (const size of [0.8, 0.6]) {
      const w = (designators[m.instance] ?? m.instance).length * size * 0.75 + 0.15;
      const h = size + 0.15;
      const [cx, cy] = [(own[0] + own[2]) / 2, (own[1] + own[3]) / 2];
      const [hw, hh] = [(own[2] - own[0]) / 2, (own[3] - own[1]) / 2];
      const along = (half: number, len: number) => [0, -(half - len / 2), half - len / 2].filter((d, i) => i === 0 || half > len / 2);
      const spots: [number, number][] = [
        ...along(hw, w).map((d) => [cx + d, own[3] + h / 2 + 0.05] as [number, number]),
        ...along(hw, w).map((d) => [cx + d, own[1] - h / 2 - 0.05] as [number, number]),
        ...along(hh, h).map((d) => [own[2] + w / 2 + 0.05, cy + d] as [number, number]),
        ...along(hh, h).map((d) => [own[0] - w / 2 - 0.05, cy + d] as [number, number]),
      ];
      for (const [x, y] of spots) {
        const b: Box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
        if (!onBoard(b)) continue;
        if (obstacles[layer].some((o) => overlaps(b, o))) continue;
        if (yards[layer].some((c) => c.id !== pc.pcb_component_id && overlaps(b, c.box))) continue;
        if (placed[layer].some((p) => overlaps(b, p, 0.1))) continue;
        placed[layer].push(b);
        add.push({ type: "pcb_silkscreen_text", pcb_silkscreen_text_id: `pcb_silkscreen_text_ref_${n++}`, pcb_component_id: pc.pcb_component_id, layer, text: designators[m.instance] ?? m.instance, font: "tscircuit2024", font_size: size, anchor_alignment: "center", anchor_position: { x: r4(x), y: r4(y) }, ccw_rotation: 0 });
        references++;
        set = true;
        break;
      }
      if (set) break;
    }
    if (!set) omitted.push(m.instance);

    // the pin-1 mark: beside the pin-1 pad, on the side away from the part's centre
    const own_pads = cj.filter((e) => (e.type === "pcb_smtpad" || e.type === "pcb_plated_hole") && e.pcb_component_id === pc.pcb_component_id);
    const pin1 = own_pads.find((e) => (e.port_hints ?? []).includes("pin1"));
    const pins = new Set(own_pads.flatMap((e) => (e.port_hints ?? []).filter((h: string) => /^pin\d+$/.test(h))));
    if (pin1 && pins.size >= 3) {
      const [mx, my] = [own_pads.reduce((a, e) => a + e.x, 0) / own_pads.length, own_pads.reduce((a, e) => a + e.y, 0) / own_pads.length];
      const pb = boxOf(pin1)!;
      const [px, py] = [(pb[0] + pb[2]) / 2, (pb[1] + pb[3]) / 2];
      const [hx, hy] = [(pb[2] - pb[0]) / 2 + 0.35, (pb[3] - pb[1]) / 2 + 0.35];
      const spots: [number, number][] = [];
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (dx || dy) spots.push([px + dx * hx, py + dy * hy]);
      spots.sort((a, b) => Math.hypot(b[0] - mx, b[1] - my) - Math.hypot(a[0] - mx, a[1] - my));
      for (const [x, y] of spots) {
        const dot: Box = [x - 0.15, y - 0.15, x + 0.15, y + 0.15];
        if (obstacles[layer].some((o) => overlaps(dot, o)) || !onBoard(dot, 0) || placed[layer].some((p) => overlaps(dot, p))) continue;
        add.push({ type: "pcb_silkscreen_circle", pcb_silkscreen_circle_id: `pcb_silkscreen_circle_pin1_${n++}`, pcb_component_id: pc.pcb_component_id, layer, center: { x: r4(x), y: r4(y) }, radius: 0.15, stroke_width: 0.15 });
        placed[layer].push(dot);
        marks++;
        break;
      }
    }
  }
  return { circuitJson: [...cj, ...add], references, marks, omitted };
}
