/**
 * A Specctra DSN writer for a route job, written from the public Specctra format description (not through KiCad,
 * whose export turns every rule area into a full keep-out). Units: micrometers at resolution 10.
 *
 * - Every footprint is placed front side up at rotation 0 with its pins at their world offsets and its pad shapes in
 *   world orientation on their world layers, so no mirroring or rotation convention can move a pad.
 * - Nets in scope carry their pins; their existing copper is wiring, `fix` when locked and `protect` otherwise, so
 *   the router builds on it and never moves it. Copper of every other net, and copper without a net, becomes
 *   keep-outs on its layers, and the pins of other nets are left out of the network: those nets are obstacles,
 *   never routed.
 * - Keep-outs keep their layers and what they block: tracks and vias (`keepout`), tracks only (`wire_keepout`),
 *   vias only (`via_keepout`). Pour-only and footprint-only areas and policy (cost) areas are left out and listed.
 * - Rules: the board-wide plan values in `(rule ...)`, and one class per distinct net width and clearance.
 */
import { byCodeUnit, copperLayers, footprintToWorld, padsOf, recordsOfKind, rotatePoint, viaLayers, type BoardDocument, type FootprintRec, type Pad, type WorldPad } from "@protoboardai/board";
import { commonUnexpressed, netConstraint } from "../../constraints.js";
import { arcPoints, flattenContour, type P } from "../../geom.js";
import type { RouteJob } from "../../types.js";
import { num, q } from "./sexpr.js";

const UM = 1000;
const u = (nmValue: number) => num(nmValue / UM);

export interface DsnResult {
  text: string;
  /** Net name in the file to our net name (aliases for names a DSN string cannot hold). */
  nets: Map<string, string>;
  /** The via padstack name the router may use, and its sizes. */
  via: { name: string; outer: number; hole: number };
  unexpressed: string[];
}

/** A via padstack name that carries its sizes in nanometers and, for a partial via, its layers. */
export function viaPadstackName(outer: number, hole: number, layers?: readonly string[]): string {
  return `pbvia_${outer}_${hole}${layers ? `_${layers.join("_")}` : ""}`;
}

/** Sizes and layers from a name written by `viaPadstackName`. */
export function parseViaPadstackName(name: string): { outer: number; hole: number; layers?: string[] } | undefined {
  const m = /^pbvia_(\d+)_(\d+)((?:_[a-z0-9]+)*)$/.exec(name);
  if (!m) return undefined;
  const layers = m[3] ? m[3].slice(1).split("_") : undefined;
  return { outer: Number(m[1]), hole: Number(m[2]), ...(layers ? { layers } : {}) };
}

const safeName = (s: string) => /^[A-Za-z0-9_]+$/.test(s);

/** A pad's copper outline points relative to its world center (mirroring and rotation applied). */
function padOutline(fp: FootprintRec, wp: WorldPad): { kind: "circle"; d: number } | { kind: "rect"; minX: number; minY: number; maxX: number; maxY: number; approx: boolean } | { kind: "path"; w: number; a: P; b: P } | { kind: "poly"; points: P[] } {
  const p: Pad = wp.pad;
  if (p.shape === "circle") return { kind: "circle", d: p.type === "th" ? p.outer_diameter! : 2 * p.radius! };
  const toRel = (q: P): P => {
    const r = rotatePoint(q, p.rotation ?? 0);
    const w = footprintToWorld(fp, { x: p.x + r.x, y: p.y + r.y });
    return { x: Math.round(w.x - wp.x), y: Math.round(w.y - wp.y) };
  };
  if (p.shape === "polygon") return { kind: "poly", points: (p.points ?? []).map(toRel) };
  const w = p.type === "th" ? p.outer_width! : p.width!;
  const h = p.type === "th" ? p.outer_height! : p.height!;
  if (p.shape === "oval") {
    const along = w >= h;
    const half = (Math.max(w, h) - Math.min(w, h)) / 2;
    const a = toRel(along ? { x: -half, y: 0 } : { x: 0, y: -half });
    const b = toRel(along ? { x: half, y: 0 } : { x: 0, y: half });
    return { kind: "path", w: Math.min(w, h), a, b };
  }
  const corners = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map(toRel);
  const axis = corners.every((c, i) => {
    const d = corners[(i + 1) % 4];
    return c.x === d.x || c.y === d.y;
  });
  if (!axis) return { kind: "poly", points: corners };
  return { kind: "rect", minX: Math.min(...corners.map((c) => c.x)), minY: Math.min(...corners.map((c) => c.y)), maxX: Math.max(...corners.map((c) => c.x)), maxY: Math.max(...corners.map((c) => c.y)), approx: p.shape === "roundrect" };
}

function shapeText(s: ReturnType<typeof padOutline>, layer: string): string {
  switch (s.kind) {
    case "circle":
      return `(circle ${layer} ${u(s.d)})`;
    case "rect":
      return `(rect ${layer} ${u(s.minX)} ${u(s.minY)} ${u(s.maxX)} ${u(s.maxY)})`;
    case "path":
      return `(path ${layer} ${u(s.w)} ${u(s.a.x)} ${u(s.a.y)} ${u(s.b.x)} ${u(s.b.y)})`;
    case "poly":
      return `(polygon ${layer} 0 ${s.points.map((p) => `${u(p.x)} ${u(p.y)}`).join(" ")})`;
  }
}

/** A rectangle polygon around a straight copper piece (round ends become square ends). */
function pieceOutline(a: P, b: P, width: number): P[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const h = width / 2;
  const nx = -uy * h;
  const ny = ux * h;
  const a2 = { x: a.x - ux * h, y: a.y - uy * h };
  const b2 = { x: b.x + ux * h, y: b.y + uy * h };
  return [
    { x: a2.x + nx, y: a2.y + ny },
    { x: b2.x + nx, y: b2.y + ny },
    { x: b2.x - nx, y: b2.y - ny },
    { x: a2.x - nx, y: a2.y - ny },
  ];
}

const polyText = (layer: string, pts: readonly P[]) => `(polygon ${layer} 0 ${pts.map((p) => `${u(p.x)} ${u(p.y)}`).join(" ")})`;

/** The DSN text for a job. */
export function jobToDsn(job: Pick<RouteJob, "doc" | "nets" | "layers" | "constraints" | "region">, host = { name: "Protoboard", version: "0" }): DsnResult {
  const doc: BoardDocument = job.doc;
  const stack = copperLayers(doc);
  const c = job.constraints;
  const unexpressed: string[] = [];
  const lines: string[] = [];
  const inScope = new Set(job.nets.map((n) => n.net));

  // net names in the file
  const fileName = new Map<string, string>();
  const nets = new Map<string, string>();
  let alias = 0;
  for (const n of [...inScope].sort(byCodeUnit)) {
    const name = /["\\\u0000-\u001f\u007f]/.test(n) ? `pb_net_${alias++}` : n;
    fileName.set(n, name);
    nets.set(name, n);
  }

  const via = { name: viaPadstackName(c.via.outer.plan, c.via.hole.plan), outer: c.via.outer.plan, hole: c.via.hole.plan };
  const viaStacks = new Map<string, string[]>([[via.name, stack]]);

  lines.push(`(pcb ${q("protoboard-route.dsn")}`);
  lines.push(`  (parser (string_quote ") (space_in_quoted_tokens on) (host_cad ${q(host.name)}) (host_version ${q(host.version)}))`);
  lines.push("  (resolution um 10)");
  lines.push("  (unit um)");
  lines.push("  (structure");
  const excluded = stack.filter((l) => !job.layers.includes(l));
  stack.forEach((l, i) => lines.push(`    (layer ${l} (type ${excluded.includes(l) ? "power" : "signal"}) (property (index ${i})))`));
  if (excluded.length) unexpressed.push(`layers outside the scope (${excluded.join(", ")}) are written as power layers so the router does not route on them; checked after`);
  const outline = doc.records.get("outline");
  if (outline?.kind === "outline") {
    const f = flattenContour(outline.outline);
    if (f.approximated) unexpressed.push("the board outline's arcs are straight steps of at most 5 degrees in the router input");
    const pts = [...f.points, f.points[0]];
    lines.push(`    (boundary (path pcb 0 ${pts.map((p) => `${u(p.x)} ${u(p.y)}`).join(" ")}))`);
  }
  lines.push(`    (via ${q(via.name)})`);
  const clr = c.defaults.clearance.plan;
  lines.push(`    (rule (width ${u(c.defaults.width.plan)}) (clearance ${u(clr)}) (clearance ${u(clr)} (type default_smd)) (clearance ${u(clr)} (type smd_smd)))`);
  lines.push("    (control (via_at_smd off))");
  // keep-outs: typed, per layer
  for (const k of c.keepouts) {
    if (k.tier !== "no_go") continue;
    const kind = k.blocks.tracks && k.blocks.vias ? "keepout" : k.blocks.tracks ? "wire_keepout" : k.blocks.vias ? "via_keepout" : undefined;
    if (!kind) {
      unexpressed.push(`keep-out ${k.id} blocks only ${Object.entries(k.blocks).filter(([, v]) => v).map(([b]) => b).join(", ") || "nothing"}: no routing effect, left out`);
      continue;
    }
    const f = flattenContour(k.outline);
    if (f.approximated) unexpressed.push(`keep-out ${k.id}: arcs are straight steps in the router input`);
    for (const l of k.layers) if (stack.includes(l)) lines.push(`    (${kind} ${q(k.id)} ${polyText(l, f.points)})`);
  }
  for (const cut of recordsOfKind(doc, "cutout")) {
    const f = flattenContour(cut.outline);
    for (const l of stack) lines.push(`    (keepout ${q(cut.id)} ${polyText(l, f.points)})`);
  }
  // copper that is not in scope: keep-outs on its layers
  let foreignCopper = 0;
  for (const t of recordsOfKind(doc, "track")) {
    if (t.net && inScope.has(t.net)) continue;
    foreignCopper++;
    const pts = t.sweep === undefined ? [t.start, t.end] : arcPoints(t.start, t.end, t.sweep);
    for (let i = 0; i + 1 < pts.length; i++) lines.push(`    (keepout ${q(t.id)} ${polyText(t.layer, pieceOutline(pts[i], pts[i + 1], t.width))})`);
  }
  for (const v of recordsOfKind(doc, "via")) {
    if (v.net && inScope.has(v.net)) continue;
    foreignCopper++;
    for (const l of viaLayers(doc, v.from_layer, v.to_layer)) lines.push(`    (keepout ${q(v.id)} (circle ${l} ${u(v.outer_diameter)} ${u(v.x)} ${u(v.y)}))`);
  }
  // plain holes: keep-outs on every layer
  const fps = recordsOfKind(doc, "footprint");
  for (const fp of fps)
    for (const wp of padsOf(fp, stack))
      if (wp.pad.type === "np") for (const l of stack) lines.push(`    (keepout ${q(wp.id)} (circle ${l} ${u(wp.pad.hole_diameter!)} ${u(wp.x)} ${u(wp.y)}))`);
  if (foreignCopper) unexpressed.push(`${foreignCopper} track(s) and via(s) of nets outside the scope are keep-outs (square ends) in the router input`);
  lines.push("  )");

  // placement and library
  const placement: string[] = [];
  const images: string[] = [];
  const padstacks = new Map<string, string>();
  const pinRef = new Map<string, string>();
  const usedRefs = new Map<string, number>();
  let roundrects = 0;
  for (const fp of fps) {
    const n = (usedRefs.get(fp.ref) ?? 0) + 1;
    usedRefs.set(fp.ref, n);
    const ref = n === 1 ? fp.ref : `${fp.ref}_${n}`;
    const img = `img_${ref}`;
    placement.push(`    (component ${q(img)} (place ${ref} ${u(fp.x)} ${u(fp.y)} front 0))`);
    const pins: string[] = [];
    padsOf(fp, stack).forEach((wp, i) => {
      if (wp.pad.type === "np") return;
      const shape = padOutline(fp, wp);
      if (shape.kind === "rect" && shape.approx) roundrects++;
      const layers = wp.pad.type === "smd" ? wp.layers : stack;
      const body = layers.map((l) => `(shape ${shapeText(shape, l)})`).join(" ");
      const key = `${body}`;
      let name = padstacks.get(key);
      if (!name) {
        name = `pbpad_${padstacks.size}`;
        padstacks.set(key, name);
      }
      const pin = safeName(wp.key) ? wp.key : `p${i}`;
      pins.push(`      (pin ${name} ${pin} ${u(wp.x - fp.x)} ${u(wp.y - fp.y)})`);
      pinRef.set(wp.id, `${ref}-${pin}`);
    });
    images.push(`    (image ${q(img)}`, ...pins, "    )");
  }
  if (roundrects) unexpressed.push(`${roundrects} rounded rectangle pad(s) are sharp rectangles in the router input`);
  lines.push("  (placement", ...placement, "  )");
  lines.push("  (library", ...images);
  for (const [body, name] of padstacks) lines.push(`    (padstack ${name} ${body} (attach off))`);
  for (const v of recordsOfKind(doc, "via")) {
    if (!(v.net && inScope.has(v.net))) continue;
    const ls = viaLayers(doc, v.from_layer, v.to_layer);
    const name = viaPadstackName(v.outer_diameter, v.hole_diameter, ls.length === stack.length ? undefined : ls);
    viaStacks.set(name, ls);
  }
  for (const [name, ls] of viaStacks) {
    const parsed = parseViaPadstackName(name)!;
    lines.push(`    (padstack ${q(name)} ${ls.map((l) => `(shape (circle ${l} ${u(parsed.outer)}))`).join(" ")} (attach off))`);
  }
  lines.push("  )");

  // network: nets in scope with their pins, then classes by width and clearance
  lines.push("  (network");
  for (const n of [...inScope].sort(byCodeUnit)) {
    const pads = doc.nets.get(n)?.pads ?? [];
    const refs = pads.map((p) => pinRef.get(p)).filter((x): x is string => !!x);
    lines.push(`    (net ${q(fileName.get(n)!)} (pins ${refs.join(" ")}))`);
  }
  const groups = new Map<string, string[]>();
  for (const n of [...inScope].sort(byCodeUnit)) {
    const nc = netConstraint(c, n);
    const key = `${nc.width.plan}:${nc.clearance.plan}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  [...groups.entries()].forEach(([key, members], i) => {
    const [w, cl] = key.split(":").map(Number);
    lines.push(`    (class pbc_${i} ${members.map((m) => q(fileName.get(m)!)).join(" ")} (circuit (use_via ${q(via.name)})) (rule (width ${u(w)}) (clearance ${u(cl)})))`);
  });
  lines.push("  )");

  // wiring: existing copper of nets in scope
  lines.push("  (wiring");
  for (const t of recordsOfKind(doc, "track")) {
    if (!(t.net && inScope.has(t.net))) continue;
    const pts = t.sweep === undefined ? [t.start, t.end] : arcPoints(t.start, t.end, t.sweep);
    lines.push(`    (wire (path ${t.layer} ${u(t.width)} ${pts.map((p) => `${u(p.x)} ${u(p.y)}`).join(" ")}) (net ${q(fileName.get(t.net)!)}) (type ${t.locked ? "fix" : "protect"}))`);
  }
  for (const v of recordsOfKind(doc, "via")) {
    if (!(v.net && inScope.has(v.net))) continue;
    const ls = viaLayers(doc, v.from_layer, v.to_layer);
    const name = viaPadstackName(v.outer_diameter, v.hole_diameter, ls.length === stack.length ? undefined : ls);
    lines.push(`    (via ${q(name)} ${u(v.x)} ${u(v.y)} (net ${q(fileName.get(v.net)!)}) (type ${v.locked ? "fix" : "protect"}))`);
  }
  lines.push("  )");
  lines.push(")");

  // what Freerouting cannot take from this job
  unexpressed.push(...commonUnexpressed(c).filter((x) => !unexpressed.includes(x)));
  if (job.region) unexpressed.push("region: Freerouting cannot bound new copper to a region; copper outside it is checked after");
  unexpressed.push(`edge clearance ${num(c.edgeClearance.plan / 1e6, 3)} mm: passed as a router setting; checked after`);
  unexpressed.push("track width: Freerouting plans each class at its width and never drops to the floor locally");
  for (const r of c.noGoRules.filter((r) => r.check !== "via_in_pad")) unexpressed.push(`no-go rule ${r.id} (${r.check}): not in the router input; checked after`);
  return { text: lines.join("\n") + "\n", nets, via, unexpressed };
}

