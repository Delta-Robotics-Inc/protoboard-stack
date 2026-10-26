/**
 * What a KiCad schematic export (`kicad-cli sch export svg`, a locked board's
 * schematic.svg) says once it is read for its geometry: KiCad writes no nets
 * and no parts into the file, only strokes, with an invisible `<text>` beside
 * each piece of text. From those:
 *
 * - wires are the strokes in the wire colour (`data-pb-stroke="wire"`, svg.ts);
 *   wires that meet (end to end, or an end on another wire) are one network;
 * - a label (or a power symbol's name) is text whose anchor lies on a wire:
 *   it names that network, and networks with the same name are one net;
 * - a reference designator (R20, U5) is text in the field colour that looks
 *   like one; the next field text after it is its value; a symbol body (the
 *   part fill) belongs to the reference nearest it.
 *
 * The geometry functions are plain data (tested in Node); `indexKicadSchematic`
 * reads them from the drawing in the page.
 */

export type Pt = [number, number];
export interface Segment {
  a: Pt;
  b: Pt;
}
export interface Label {
  text: string;
  /** The text's anchor and the far end of its run (the label's own line). */
  at: Pt;
  end: Pt;
}

/** The segments of a path's `d` (absolute moves and lines: what KiCad writes). */
export function segmentsOf(d: string): Segment[] {
  const out: Segment[] = [];
  let last: Pt | undefined;
  let start: Pt | undefined;
  for (const m of d.matchAll(/([MLZmlz])|(-?[\d.]+(?:e-?\d+)?)[\s,]+(-?[\d.]+(?:e-?\d+)?)/g)) {
    if (m[1]) {
      const c = m[1].toUpperCase();
      if (c === "M") last = undefined;
      if (c === "Z" && last && start) out.push({ a: last, b: start });
      continue;
    }
    const p: Pt = [Number(m[2]), Number(m[3])];
    if (last) out.push({ a: last, b: p });
    else start = p;
    last = p;
  }
  return out;
}

/** Distance from a point to a segment. */
export function distance(p: Pt, s: Segment): number {
  const [ax, ay] = s.a;
  const dx = s.b[0] - ax;
  const dy = s.b[1] - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len)) : 0;
  return Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
}

/** A grid of segments by cell, for the near ones to a point. */
class Grid {
  private cells = new Map<string, number[]>();
  constructor(
    private segs: Segment[],
    private size = 5,
  ) {
    segs.forEach((s, i) => {
      const [x0, x1] = [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])];
      const [y0, y1] = [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])];
      for (let x = Math.floor(x0 / size); x <= Math.floor(x1 / size); x++)
        for (let y = Math.floor(y0 / size); y <= Math.floor(y1 / size); y++) {
          const k = `${x},${y}`;
          const c = this.cells.get(k);
          if (c) c.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }
  near(p: Pt, r: number): number[] {
    const out = new Set<number>();
    for (let x = Math.floor((p[0] - r) / this.size); x <= Math.floor((p[0] + r) / this.size); x++)
      for (let y = Math.floor((p[1] - r) / this.size); y <= Math.floor((p[1] + r) / this.size); y++) for (const i of this.cells.get(`${x},${y}`) ?? []) if (distance(p, this.segs[i]) <= r) out.add(i);
    return [...out];
  }
}

/**
 * The networks of a schematic's wires, each named by the labels on it: for
 * each segment, the net it is on (its name, or `~<n>` for a network no label
 * names), and for each label, its net.
 */
export function wireNets(segs: Segment[], labels: Label[], tolerance = 0.05, reach = 0.6): { segmentNet: string[]; labelNet: (string | undefined)[] } {
  const parent = segs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    const [x, y] = [find(a), find(b)];
    if (x !== y) parent[x] = y;
  };
  const grid = new Grid(segs);
  // an end of a wire on another wire (end to end, or a T) joins them
  segs.forEach((s, i) => {
    for (const p of [s.a, s.b]) for (const j of grid.near(p, tolerance)) if (j !== i) join(i, j);
  });
  // a label on a wire names its network (the anchor, or the end of its run, on the wire)
  const named = new Map<number, string>();
  const labelRoot = labels.map((l) => {
    const hits = [...grid.near(l.at, reach), ...grid.near(l.end, reach)];
    if (!hits.length) return undefined;
    const r = find(hits[0]);
    if (!named.has(r)) named.set(r, l.text);
    return r;
  });
  // networks with the same name are one net
  const byName = new Map<string, number>();
  for (const [r, name] of named) {
    const other = byName.get(name);
    if (other === undefined) byName.set(name, r);
    else join(r, other);
  }
  const nameOf = new Map<number, string>();
  for (const [r, name] of named) nameOf.set(find(r), name);
  const netOf = (i: number) => {
    const r = find(i);
    return nameOf.get(r) ?? `~${r}`;
  };
  return { segmentNet: segs.map((_, i) => netOf(i)), labelNet: labelRoot.map((r) => (r === undefined ? undefined : netOf(r))) };
}

/** A reference designator as KiCad writes one (R20, U5, BT1, SW1, D23); not a power symbol's `#PWR01`. */
export const isReference = (t: string) => /^[A-Z]{1,4}\d{1,4}[A-Z]?$/.test(t);

export interface SchematicPart {
  ref: string;
  value?: string;
  at: Pt;
  /** The elements that draw it (its reference, its value, its body), lit when it is picked. */
  els: Element[];
  /** Its body's box (drawing units), when it has one. */
  box?: [number, number, number, number];
}

export interface SchematicIndex {
  /** Each net's elements (wires, labels), by the net's key (its name, or `~<n>` for an unnamed one). */
  nets: Map<string, Element[]>;
  /** The net of an element the pointer can be over. */
  netOf: Map<Element, string>;
  parts: SchematicPart[];
  /** The net nearest a drawing point within `reach` (a wire, or a label's run): strokes are too thin to hit with a pointer. */
  netAt(p: Pt, reach: number): string | undefined;
}

/** The text an invisible `<text>` stands for, and the group of strokes KiCad drew for it (its next sibling). */
const drawnText = (t: Element): Element[] => {
  const next = t.nextElementSibling;
  return next?.matches("g.stroked-text") ? [t, next] : [t];
};

/** Read a KiCad schematic drawing in the page for its nets and parts. */
export function indexKicadSchematic(root: SVGSVGElement): SchematicIndex {
  // the wires
  const wirePaths = [...root.querySelectorAll('[data-pb-stroke="wire"] path, path[data-pb-stroke="wire"], [data-pb-stroke="wire"] polyline, polyline[data-pb-stroke="wire"]')].filter((e) => !e.closest(".stroked-text"));
  const segs: Segment[] = [];
  const segEl: Element[] = [];
  for (const p of wirePaths) {
    const d = p.getAttribute("d") ?? (p.getAttribute("points") ? `M ${p.getAttribute("points")}` : "");
    for (const s of segmentsOf(d)) {
      segs.push(s);
      segEl.push(p);
    }
  }
  // the symbols' bodies (the part fill): a pin's name is inside one, a reference never is
  const bodies: { el: Element; box: [number, number, number, number] }[] = [];
  for (const b of root.querySelectorAll('[data-pb-fill="body"]')) {
    try {
      const r = (b as SVGGraphicsElement).getBBox();
      if (r.width && r.height) bodies.push({ el: b, box: [r.x, r.y, r.width, r.height] });
    } catch {
      /* not drawn */
    }
  }
  const inBody = (x: number, y: number) => bodies.some(({ box: q }) => x > q[0] && x < q[0] + q[2] && y > q[1] && y < q[1] + q[3]);
  // the texts: labels (lower-case names on a wire), references and values (the field colour)
  const texts = [...root.querySelectorAll("text")];
  const labels: Label[] = [];
  const labelEls: Element[][] = [];
  const parts: SchematicPart[] = [];
  let lastPart: SchematicPart | undefined;
  for (const t of texts) {
    const text = t.textContent?.trim() ?? "";
    if (!text) continue;
    const x = parseFloat(t.getAttribute("x") ?? "");
    const y = parseFloat(t.getAttribute("y") ?? "");
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const field = t.closest('[data-pb-stroke="label"]');
    if (field && isReference(text) && !inBody(x, y)) {
      lastPart = { ref: text, at: [x, y], els: drawnText(t) };
      parts.push(lastPart);
      continue;
    }
    if (field && lastPart && !lastPart.value && !/^\d+$/.test(text)) {
      lastPart.value = text;
      lastPart.els.push(...drawnText(t));
      lastPart = undefined;
      continue;
    }
    lastPart = undefined;
    if (/^\d+$/.test(text)) continue;
    // a rotated label runs along its own axis: its far end is where the rotation takes the run's end
    const len = parseFloat(t.getAttribute("textLength") ?? "0") || 0;
    const rotated = /rotate\(\s*-?90/.test(t.closest("g[transform]")?.getAttribute("transform") ?? "");
    const anchor = t.getAttribute("text-anchor");
    const dir = anchor === "end" ? -1 : 1;
    const end: Pt = rotated ? [x, y - dir * len] : [x + dir * len, y];
    labels.push({ text, at: [x, y], end });
    labelEls.push(drawnText(t));
  }
  const { segmentNet, labelNet } = wireNets(segs, labels);
  const grid = new Grid(segs);
  const nets = new Map<string, Element[]>();
  const netOf = new Map<Element, string>();
  const add = (net: string, els: Element[]) => {
    const list = nets.get(net) ?? [];
    for (const e of els) {
      if (!netOf.has(e)) list.push(e);
      netOf.set(e, net);
    }
    nets.set(net, list);
  };
  segmentNet.forEach((net, i) => add(net, [segEl[i]]));
  labelNet.forEach((net, i) => net && add(net, labelEls[i]));

  // a body belongs to the reference nearest it
  for (const { el: b, box } of bodies) {
    let best: SchematicPart | undefined;
    let bestD = Infinity;
    for (const p of parts) {
      const dx = Math.max(box[0] - p.at[0], 0, p.at[0] - (box[0] + box[2]));
      const dy = Math.max(box[1] - p.at[1], 0, p.at[1] - (box[1] + box[3]));
      const d = Math.hypot(dx, dy);
      if (d < bestD) [best, bestD] = [p, d];
    }
    if (best && bestD < 8 && !best.box) {
      best.box = box;
      best.els.push(b);
    }
  }
  const netAt = (p: Pt, reach: number): string | undefined => {
    let best: string | undefined;
    let bestD = reach;
    for (const i of grid.near(p, reach)) {
      const d = distance(p, segs[i]);
      if (d <= bestD) [best, bestD] = [segmentNet[i], d];
    }
    labels.forEach((l, i) => {
      const net = labelNet[i];
      if (!net) return;
      const d = distance(p, { a: l.at, b: l.end });
      if (d <= bestD) [best, bestD] = [net, d];
    });
    return best;
  };
  return { nets, netOf, parts, netAt };
}

/** The part at a drawing point: the one whose body holds it, else the reference nearest it within `reach`. */
export function partAt(parts: SchematicPart[], p: Pt, reach = 4): SchematicPart | undefined {
  const inside = parts.filter((q) => q.box && p[0] >= q.box[0] && p[0] <= q.box[0] + q.box[2] && p[1] >= q.box[1] && p[1] <= q.box[1] + q.box[3]);
  if (inside.length) return inside.sort((a, b) => a.box![2] * a.box![3] - b.box![2] * b.box![3])[0];
  let best: SchematicPart | undefined;
  let bestD = reach;
  for (const q of parts) {
    const d = Math.hypot(q.at[0] - p[0], q.at[1] - p[1]);
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best;
}
