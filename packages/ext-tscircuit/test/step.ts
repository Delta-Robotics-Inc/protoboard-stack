/**
 * Enough of an ISO 10303-21 reader to measure where a STEP assembly puts its
 * bodies: each MAPPED_ITEM's solids, through its REPRESENTATION_MAP and its
 * target placement, as a world bounding box of their vertices. Written for the
 * tests, apart from the provider's own STEP handling, so it checks that code
 * rather than repeating it.
 */
type V3 = [number, number, number];

export function entities(text: string): Map<number, string> {
  const out = new Map<number, string>();
  const body = text.slice(text.indexOf("DATA;") + 5, text.lastIndexOf("ENDSEC;"));
  // split on ';' outside quoted strings
  for (const raw of body.match(/(?:[^;']|'(?:[^']|'')*')+/g) ?? []) {
    const m = /^\s*#(\d+)\s*=\s*([\s\S]*?)\s*$/.exec(raw);
    if (m) out.set(Number(m[1]), m[2].replace(/\s+/g, ""));
  }
  return out;
}

const refsOf = (body: string) => [...body.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
const numbers = (body: string) => body.slice(body.lastIndexOf("(") + 1, body.indexOf(")")).split(",").map(Number) as V3;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

interface Frame {
  o: V3;
  x: V3;
  y: V3;
  z: V3;
}

function placement(e: Map<number, string>, id: number): Frame {
  const [p, axis, ref] = refsOf(e.get(id)!);
  const z = unit(numbers(e.get(axis)!));
  const r = numbers(e.get(ref)!);
  const x = unit(sub(r, z.map((v) => v * dot(r, z)) as V3));
  return { o: numbers(e.get(p)!), x, y: cross(z, x), z };
}

/** Every vertex reachable from `roots`. */
function vertices(e: Map<number, string>, roots: number[]): V3[] {
  const seen = new Set<number>();
  const out: V3[] = [];
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const body = e.get(id) ?? "";
    if (body.startsWith("VERTEX_POINT(")) out.push(numbers(e.get(refsOf(body)[0])!));
    else if (!/^(\(?GEOMETRIC_REPRESENTATION_CONTEXT|\(GEOMETRIC|\(LENGTH_UNIT|\(NAMED_UNIT)/.test(body)) stack.push(...refsOf(body));
  }
  return out;
}

export interface Box {
  min: V3;
  max: V3;
  centre: V3;
  size: V3;
}

const boxOf = (pts: V3[]): Box => {
  const min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))) as V3;
  const max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))) as V3;
  return { min, max, centre: [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as V3, size: [0, 1, 2].map((k) => max[k] - min[k]) as V3 };
};

/** World bounding box of each mapped item, by its name, plus `PCB` for the board solid. */
export function stepBodies(text: string): Map<string, Box> {
  const e = entities(text);
  const out = new Map<string, Box>();
  for (const [id, body] of e) {
    const pcb = /^MANIFOLD_SOLID_BREP\('PCB'/.test(body);
    if (pcb) out.set("PCB", boxOf(vertices(e, [id])));
    const m = /^MAPPED_ITEM\('((?:[^']|'')*)',#(\d+),#(\d+)\)$/.exec(body);
    if (!m) continue;
    const [origin, rep] = refsOf(e.get(Number(m[2]))!);
    const solids = refsOf(e.get(rep)!.replace(/,#\d+\)$/, ")"));
    const from = placement(e, origin);
    const to = placement(e, Number(m[3]));
    const world = vertices(e, solids).map((p) => {
      const d = sub(p, from.o);
      const l = [dot(d, from.x), dot(d, from.y), dot(d, from.z)];
      return [0, 1, 2].map((k) => to.o[k] + l[0] * to.x[k] + l[1] * to.y[k] + l[2] * to.z[k]) as V3;
    });
    out.set(m[1].replace(/''/g, "'"), boxOf(world));
  }
  return out;
}
