/**
 * Small ISO 10303-21 (STEP) helpers for the 3D outputs: read the DATA section
 * into entities, and drop named sub-shapes from a part's body file.
 *
 * UHD CAD bodies carry "body plus one named sub-shape per interface feature"
 * (UHD src/authoring/cad.ts, cad_step): thin marker solids, 0.25 mm thick,
 * on the faces an interface binds to (for an SMD part, its seating-plane pads,
 * extruded downwards into the board). They identify features for binding;
 * they are not part of the body. circuit-json-to-step and the GLB converter
 * both take every solid in the file, so the provider strips the feature
 * shapes before handing a part body to them.
 */

/** The DATA section as entity id → body (the text after `=`), in file order. */
export function stepEntities(text: string): Map<number, string> {
  const out = new Map<number, string>();
  const data = text.indexOf("DATA;");
  if (data < 0) return out;
  let chunk = "";
  let quoted = false;
  for (let i = data + 5; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted; // '' inside a string toggles twice
    if (ch !== ";" || quoted) {
      chunk += ch;
      continue;
    }
    const s = chunk.trim();
    chunk = "";
    if (s === "ENDSEC") break;
    const m = /^#(\d+)\s*=\s*([\s\S]*)$/.exec(s);
    if (m) out.set(Number(m[1]), m[2]);
  }
  return out;
}

const refs = (body: string) => [...body.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
const typeOf = (body: string) => /^\s*([A-Z0-9_]+)\s*\(/.exec(body)?.[1] ?? "";

/**
 * `body` without its reference to `id` when that reference is one element of
 * a list holding others (`(#1,#2)` → `(#2)`); undefined when the entity
 * cannot do without it (a direct parameter, or the only element of a list).
 */
function dropReference(body: string, id: number): string | undefined {
  let depth = 0;
  let quoted = false;
  let out = body;
  const re = new RegExp(`#${id}(?!\\d)`, "g");
  // positions of the reference, outside strings, with the depth of the parentheses around it
  const hits: { at: number; depth: number }[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "#") {
      re.lastIndex = i;
      const m = re.exec(body);
      if (m && m.index === i) hits.push({ at: i, depth });
    }
  }
  if (!hits.length) return body;
  if (typeOf(body) === "") return undefined; // a complex entity: never edited
  for (const h of hits.reverse()) {
    if (h.depth < 2) return undefined;
    const len = `#${id}`.length;
    const before = out.slice(0, h.at).replace(/\s+$/, "");
    const after = out.slice(h.at + len).replace(/^\s+/, "");
    if (before.endsWith("(") && after.startsWith(")")) return undefined;
    out = before.endsWith(",") ? before.slice(0, -1) + after : before + after.replace(/^,/, "");
  }
  return out;
}

/**
 * The STEP file without the solids of the products named in `names` (UHD
 * interface feature shapes). Entities that referred to a removed one lose that
 * list element, or go too when they cannot do without it. Returns the text
 * unchanged when nothing matches.
 */
export function withoutShapes(text: string, names: Iterable<string>): { text: string; removed: string[] } {
  const wanted = new Set(names);
  const e = stepEntities(text);
  const referrers = new Map<number, number[]>();
  for (const [id, body] of e) for (const r of refs(body)) referrers.set(r, [...(referrers.get(r) ?? []), id]);
  const using = (id: number, type: RegExp) => (referrers.get(id) ?? []).filter((r) => type.test(typeOf(e.get(r)!)));

  // the named products' definitions, and every definition assembled under them
  const usages = [...e].filter(([, b]) => typeOf(b) === "NEXT_ASSEMBLY_USAGE_OCCURRENCE").map(([, b]) => refs(b) as [number, number]);
  const named = new Map<string, number[][]>();
  for (const [id, body] of e) {
    const m = /^PRODUCT\('((?:[^']|'')*)'/.exec(body);
    if (!m || !wanted.has(m[1].replace(/''/g, "'"))) continue;
    const pdefs = using(id, /^PRODUCT_DEFINITION_FORMATION/).flatMap((f) => using(f, /^PRODUCT_DEFINITION$/));
    named.set(m[1], [...(named.get(m[1]) ?? []), pdefs]);
  }
  // a feature is a compound (an assembly of its pads); a body of the part that happens to share
  // its name (a USB-C receptacle's `shell` solid beside its `shell` stake feature) stays
  const assembly = (d: number) => usages.some(([p]) => p === d);
  const removed: string[] = [];
  const defs = new Set<number>();
  for (const [name, products] of named) {
    const compounds = products.filter((ds) => ds.some(assembly));
    for (const ds of products.length > 1 && compounds.length ? compounds : products) for (const d of ds) defs.add(d);
    removed.push(name);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [parent, child] of usages) {
      // a child also used outside the named products stays
      if (defs.has(parent) && !defs.has(child) && usages.every(([p, c]) => c !== child || defs.has(p))) defs.add(child), (grew = true);
    }
  }
  // their shape representations' items: the solids (placements stay)
  const doomed = new Set<number>();
  for (const d of defs) {
    const reps = using(d, /^PRODUCT_DEFINITION_SHAPE$/)
      .flatMap((s) => using(s, /^SHAPE_DEFINITION_REPRESENTATION$/))
      .map((sdr) => refs(e.get(sdr)!)[1]);
    for (const rep of reps) {
      const items = refs((e.get(rep) ?? "").replace(/,\s*#\d+\s*\)\s*$/, ")"));
      for (const item of items) if (typeOf(e.get(item) ?? "") !== "AXIS2_PLACEMENT_3D") doomed.add(item);
    }
  }
  if (!doomed.size) return { text, removed: [] };

  const bodies = new Map(e);
  const queue = [...doomed];
  while (queue.length) {
    const id = queue.pop()!;
    if (!bodies.delete(id)) continue;
    for (const r of referrers.get(id) ?? []) {
      const body = bodies.get(r);
      if (body === undefined) continue;
      const kept = dropReference(body, id);
      if (kept === undefined) queue.push(r);
      else bodies.set(r, kept);
    }
  }
  // then the removed solids' own geometry, wherever nothing kept still uses it
  const below = new Set<number>();
  const walk = [...doomed];
  while (walk.length) for (const r of refs(e.get(walk.pop()!) ?? "")) if (!below.has(r)) below.add(r), walk.push(r);
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of below) {
      if (bodies.has(id) && (referrers.get(id) ?? []).every((r) => !bodies.has(r))) {
        bodies.delete(id);
        changed = true;
      }
    }
  }
  const head = text.slice(0, text.indexOf("DATA;"));
  const data = [...bodies].map(([id, body]) => `#${id} = ${body};`).join("\n");
  return { text: `${head}DATA;\n${data}\nENDSEC;\nEND-ISO-10303-21;\n`, removed };
}

/**
 * A STEP assembly moved along Z by `dz` (mm): the placement of each top-level
 * occurrence in the root product's shape representation is shifted (a new
 * point for each, so nothing shared moves twice). The root is the product
 * definition no assembly usage names as a component. KiCad writes its board
 * this way, the board body and every footprint's model placed in the root
 * (`pcb export step`), with z = 0 on the board's bottom face; the stack's
 * board frame has z = 0 on the mid-plane (layout.ts), so a locked board's
 * board.step is moved down by half its thickness. Unchanged (`moved: 0`) when
 * the file has no such root.
 */
export function shiftStepAssembly(text: string, dz: number): { text: string; moved: number } {
  const ents = stepEntities(text);
  const related = new Set<number>();
  const base = new Set<number>();
  for (const body of ents.values()) {
    const n = /^NEXT_ASSEMBLY_USAGE_OCCURRENCE\(.*,#(\d+),#(\d+),[^,]*\)$/s.exec(body.trim());
    if (n) related.add(Number(n[2]));
    const t = /^ITEM_DEFINED_TRANSFORMATION\('[^']*','[^']*',#(\d+),#(\d+)\)$/.exec(body.trim());
    if (t) base.add(Number(t[1]));
  }
  const root = [...ents].find(([id, b]) => typeOf(b) === "PRODUCT_DEFINITION" && !related.has(id))?.[0];
  const pds = [...ents].find(([, b]) => typeOf(b) === "PRODUCT_DEFINITION_SHAPE" && refs(b).at(-1) === root)?.[0];
  const sdr = [...ents.values()].find((b) => typeOf(b) === "SHAPE_DEFINITION_REPRESENTATION" && refs(b)[0] === pds);
  const rep = sdr ? ents.get(refs(sdr)[1]) : undefined;
  if (root === undefined || !rep) return { text, moved: 0 };
  const items = /^[A-Z_]+\(\s*'[^']*'\s*,\s*\(([^)]*)\)/s.exec(rep.trim())?.[1] ?? "";
  let next = Math.max(0, ...ents.keys()) + 1;
  const added: string[] = [];
  const rewrite = new Map<number, string>();
  for (const id of refs(items)) {
    const axis = ents.get(id);
    if (base.has(id) || !axis || typeOf(axis) !== "AXIS2_PLACEMENT_3D") continue;
    const m = /^AXIS2_PLACEMENT_3D\(('[^']*'),#(\d+),(.*)\)$/s.exec(axis.trim());
    const p = m ? /^CARTESIAN_POINT\(('[^']*'),\(([^)]*)\)\)$/.exec(ents.get(Number(m[2]))?.trim() ?? "") : null;
    if (!m || !p) continue;
    const xyz = p[2].split(",").map(Number);
    if (xyz.length !== 3 || xyz.some((v) => !Number.isFinite(v))) continue;
    const real = (v: number) => {
      const s = (Math.round(v * 1e6) / 1e6 || 0).toString();
      return s.includes(".") || s.includes("e") ? s.replace("e", "E") : `${s}.`;
    };
    added.push(`#${next} = CARTESIAN_POINT(${p[1]},(${[xyz[0], xyz[1], xyz[2] + dz].map(real).join(",")}));`);
    rewrite.set(id, `AXIS2_PLACEMENT_3D(${m[1]},#${next++},${m[3]})`);
  }
  if (!rewrite.size) return { text, moved: 0 };
  const out = text.replace(/^#(\d+)\s*=\s*AXIS2_PLACEMENT_3D\([^;]*\);/gm, (line, id) => (rewrite.has(Number(id)) ? `#${id} = ${rewrite.get(Number(id))};` : line));
  const data = out.indexOf("DATA;");
  const end = out.indexOf("ENDSEC;", data);
  return { text: out.slice(0, end) + added.join("\n") + "\n" + out.slice(end), moved: rewrite.size };
}
