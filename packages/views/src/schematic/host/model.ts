/**
 * The page model (Node): every drawn record of a schematic with its markup from the schematic package's renderer
 * (`drawRecord`, the same code the exported images use) and the geometry a page needs to pick, select and drag it;
 * the circuit's parts and nets for the panels; and the derived data (score, gates, numbered defects, electrical
 * findings in plain language).
 */
import {
  circuitHash,
  drawRecord,
  geometryOf,
  labelBox,
  listDefects,
  netLabel,
  powerBoxes,
  recordsOfKind,
  RULES,
  signalClassOf,
  THEMES,
  cardTitleBoxes,
  type LBox,
  type SchematicDocument,
  type SchematicFinding,
  type SchematicRecord,
  type Score,
} from "@protoboardai/schematic";
import type { Box, PageDerived, PageItem, PageModel, PageNet, PagePart, XY } from "../types.js";

const DRAWN = new Set(["card", "symbol", "wire", "label", "power", "noconnect"]);
const bx = (b: LBox): Box => [round(b.x0), round(b.y0), round(b.x1), round(b.y1)];
const round = (v: number) => Math.round(v * 1000) / 1000;
const union = (bs: Box[]): Box => (bs.length ? bs.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]) : [0, 0, 0, 0]);

/** One drawn record as the page holds it; undefined for records that are not drawn (notes, frames, proposals). */
export function itemOf(doc: SchematicDocument, rec: SchematicRecord): PageItem | undefined {
  if (!DRAWN.has(rec.kind)) return undefined;
  const d = drawRecord(doc, rec);
  if (!d) return undefined;
  const base = { id: rec.id, rec: rec as PageItem["rec"], ...("pinned" in rec && rec.pinned ? { pinned: true } : {}) };
  switch (rec.kind) {
    case "card": {
      const t = cardTitleBoxes(rec);
      return { ...base, kind: "card", box: [rec.x, rec.y, rec.x + rec.w, rec.y + rec.h], svg: d.svg, tag: bx(t.tag) };
    }
    case "symbol": {
      const s = geometryOf(doc).symbols.get(rec.id)!;
      const fb = union([bx(s.ref), ...(s.value ? [bx(s.value)] : [])]);
      return {
        ...base,
        kind: "symbol",
        card: rec.card,
        box: bx(s.full),
        body: bx(s.body),
        svg: d.svg,
        ...(d.pinText ? { pinText: d.pinText } : {}),
        ...(d.transform ? { transform: d.transform } : {}),
        ...(d.fields ? { fields: d.fields } : {}),
        fieldBox: fb,
        pins: s.pins.map((p) => ({ key: p.key, keys: p.keys, part: p.part, pin: p.pin, at: p.at, dir: p.dir, ...(p.net ? { net: p.net } : {}), name: p.name, number: p.number, type: p.type })),
      };
    }
    case "wire": {
      const xs = rec.points.map((p) => p[0]);
      const ys = rec.points.map((p) => p[1]);
      return { ...base, kind: "wire", card: rec.card, net: rec.net, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], svg: d.svg };
    }
    case "label":
      return { ...base, kind: "label", card: rec.card, net: rec.net, box: bx(labelBox(rec, doc)), svg: d.svg };
    case "power": {
      const b = powerBoxes(rec, doc);
      return { ...base, kind: "power", card: rec.card, net: rec.net, box: union([bx(b.glyph), ...(b.text ? [bx(b.text)] : [])]), svg: d.svg };
    }
    case "noconnect": {
      const p = geometryOf(doc).pins.get(rec.pin);
      const at = p?.at ?? [0, 0];
      return { ...base, kind: "noconnect", box: [at[0] - 0.5, at[1] - 0.5, at[0] + 0.5, at[1] + 0.5], svg: d.svg };
    }
    default:
      return undefined;
  }
}

/** Every drawn record, in drawing order (cards, wires, symbols, power symbols, labels, no-connect marks). */
export function itemsOf(doc: SchematicDocument): PageItem[] {
  const order = ["card", "wire", "symbol", "power", "label", "noconnect"] as const;
  const out: PageItem[] = [];
  for (const k of order) for (const r of recordsOfKind(doc, k)) {
    const it = itemOf(doc, r);
    if (it) out.push(it);
  }
  return out;
}

/** The sheet's bounds from the document (cards and symbols, with a margin). */
export function boundsOfDoc(doc: SchematicDocument): Box {
  const g = geometryOf(doc);
  const bs: Box[] = [...recordsOfKind(doc, "card").map((c) => [c.x, c.y, c.x + c.w, c.y + c.h] as Box), ...[...g.symbols.values()].map((s) => bx(s.full))];
  const b = union(bs);
  return [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3];
}

export const junctionsOfDoc = (doc: SchematicDocument): { at: XY; net: string }[] => geometryOf(doc).junctions.map((j) => ({ at: j.at, net: j.net }));

export function boundsOf(items: readonly PageItem[]): Box {
  const b = union(items.filter((i) => i.kind === "card" || i.kind === "symbol").map((i) => i.box));
  return [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3];
}

/** The circuit's parts for the panels, with each part's pins and the nets they are on. */
export function partsOf(doc: SchematicDocument): PagePart[] {
  const g = geometryOf(doc);
  const refs = new Map(recordsOfKind(doc, "symbol").map((s) => [s.part, s]));
  return doc.circuit.parts.map((p) => {
    const s = refs.get(p.path);
    const placed = s ? g.symbols.get(s.id) : undefined;
    const fam = placed?.resolved.family ?? "";
    return {
      path: p.path,
      ref: s?.ref ?? p.ref ?? p.path,
      name: p.name,
      part: p.part,
      class: p.class,
      ...(p.value ? { value: p.value } : {}),
      ...(p.mpn ? { mpn: p.mpn } : {}),
      ...(p.categories?.length ? { categories: p.categories } : {}),
      group: p.group,
      pins: p.pins.map((q) => {
        const net = doc.pinNets.get(`${p.path}:${q.id}`);
        const open = p.unconnected?.[q.id];
        return { id: q.id, number: q.number, name: q.name, type: q.type, ...(q.voltage ? { voltage: q.voltage } : {}), ...(q.functions ? { functions: q.functions } : {}), ...(q.capabilities?.length ? { capabilities: q.capabilities } : {}), ...(net ? { net } : {}), ...(open ? { open } : {}) };
      }),
      symbol: fam.startsWith("pack:") ? { source: "pack" as const, id: fam.slice(5), ...(placed?.resolved.variant ? { variant: placed.resolved.variant } : {}) } : { source: "generated" as const, id: fam || "box" },
    };
  });
}

export function netsOf(doc: SchematicDocument): PageNet[] {
  const cardsOf = new Map<string, Set<string>>();
  for (const r of doc.records.values()) if ((r.kind === "wire" || r.kind === "label" || r.kind === "power") && r.card) (cardsOf.get(r.net) ?? cardsOf.set(r.net, new Set()).get(r.net)!).add(r.card);
  return doc.circuit.nets.map((n) => ({ name: n.name, shown: netLabel(doc, n.name), kind: n.kind, cls: signalClassOf(doc, n.name), ...(n.voltage ? { voltage: n.voltage } : {}), pins: n.pins, cards: [...(cardsOf.get(n.name) ?? [])].sort() }));
}

export function modelOf(doc: SchematicDocument, at: { epoch: string; seq: number }, extra: { firstOpen?: boolean } = {}): PageModel {
  const T = THEMES.dark;
  const items = itemsOf(doc);
  const head = doc.records.get("schematic");
  const hash = head?.kind === "schematic" ? head.source.hash : "";
  return {
    epoch: at.epoch,
    seq: at.seq,
    theme: "dark",
    bounds: boundsOf(items),
    items,
    junctions: junctionsOfDoc(doc),
    colors: { ...T.wire },
    highlight: T.highlight,
    ghost: { before: T.ghost.before, after: T.ghost.after },
    severity: { ...T.severity },
    parts: partsOf(doc),
    nets: netsOf(doc),
    name: head?.kind === "schematic" ? head.name : doc.circuit.board,
    board: doc.circuit.board,
    ...(hash && hash !== circuitHash(doc.circuit) ? { stale: true } : {}),
    ...(extra.firstOpen ? { firstOpen: true } : {}),
  };
}

/** References and pin names for ids, so findings read in a person's words. */
export function plain(doc: SchematicDocument, text: string): string {
  const refOf = (path: string) => (doc.records.get(`sym:${path}`) as { ref?: string } | undefined)?.ref ?? doc.parts.get(path)?.ref ?? path;
  return text
    .replace(/\bpin:([A-Za-z0-9_.\-/+~]+):([A-Za-z0-9_.\-+~]+)/g, (_m, part: string, pin: string) => {
      const q = doc.parts.get(part)?.pins.find((x) => x.id === pin);
      return q ? `${refOf(part)} pin ${q.number} ${q.name}` : `${refOf(part)} ${pin}`;
    })
    .replace(/\bsym:([A-Za-z0-9_.\-/+~]+)/g, (_m, part: string) => refOf(part))
    .replace(/\bcard:([A-Za-z0-9_.\-/+~]+)/g, (m: string) => {
      const c = doc.records.get(m);
      return c?.kind === "card" ? c.title : m;
    })
    .replace(/\b(wire|lbl|pwr):[A-Za-z0-9_.\-/+~:]+/g, (m: string) => {
      const r = doc.records.get(m) as { net?: string } | undefined;
      const what = m.startsWith("wire") ? "a wire" : m.startsWith("lbl") ? "a label" : "a power symbol";
      return r?.net ? `${what} of ${netLabel(doc, r.net)}` : what;
    })
    // a bare part path ("sensor/c_dec") reads as its reference
    .replace(/(?<![\w:/.-])[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?![\w/:-])/g, (m: string) => (doc.parts.has(m) ? refOf(m) : m));
}

/** The score, the gates, the numbered defects and the findings, for the page. */
export function derivedOf(doc: SchematicDocument, score: Score, findings: SchematicFinding[], seq: number, ms: number): PageDerived {
  const list = listDefects(doc, { score, includeInfo: true });
  const titleOf = new Map(RULES.map((r) => [r.id, r.title]));
  const cards = new Map(recordsOfKind(doc, "card").map((c) => [c.id, c.title]));
  return {
    seq,
    score: score.score,
    presentable: score.presentable,
    gates: score.gates,
    rules: score.rules.map((r) => ({ id: r.id, title: r.title, severity: r.severity, count: r.count, opportunities: r.opportunities })),
    gateRules: score.rules.filter((r) => r.severity === "gate").map((r) => ({ id: r.id, title: r.title, count: r.count })),
    // numbered as the score numbers them (the sheet's markers and the agent's scene use the same numbers)
    defects: [...list.defects]
      .sort((a, b) => a.n - b.n)
      .map((d) => ({ n: d.n, id: d.id, rule: d.rule, title: titleOf.get(d.rule) ?? d.rule, severity: d.severity, ...(d.card ? { card: d.card, cardTitle: cards.get(d.card) ?? d.card } : {}), at: d.at, objects: d.objects, message: plain(doc, d.message), points: d.points })),
    findings: findings.map((f) => ({ id: f.id, check: f.check, severity: f.severity, objects: f.objects, ...(f.location ? { at: [f.location.x, f.location.y] as XY, ...(f.location.card ? { card: f.location.card } : {}) } : {}), ...(f.path ? { path: f.path } : {}), message: f.message })),
    cards: score.cards,
    ms,
  };
}
