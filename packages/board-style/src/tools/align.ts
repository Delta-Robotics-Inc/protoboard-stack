/**
 * Part alignment, only when the user asks: snap parts to `placement.grid` and, with `placement.rowAlign`, line up the
 * parts of a group that sit in a row. Before routing only (`placement.beforeRoutingOnly`): a part with copper attached
 * is left where it is unless the call says `afterRouting`. A move that would lengthen a critical net's ratsnest (net
 * classes or name patterns in `placement.critical`) by more than `placement.maxLengthIncrease` is reported and not
 * made. Moves are `footprint.move` with attached copper following; undo or revert the change set `style:alignParts`
 * to take them back.
 */
import { netClassOf, padsOf, recordsOfKind, type BoardDocument, type FootprintRec, type OpCall } from "@protoboardai/board";
import { STYLE_HOST, styleProvenance, type Skipped, type StyleChangeSet } from "../changeset.js";
import { nm } from "../geom.js";
import { tok, tokNum, type ResolvedStyle } from "../resolve.js";
import { groupsOf } from "./common.js";

export interface AlignOptions {
  /** Footprint ids to align (default: every footprint of `group`, else every footprint). */
  ids?: string[];
  group?: string;
  /** Move parts that already have copper attached (the user said so). */
  afterRouting?: boolean;
  /** Make moves even when they lengthen a critical net past the limit. */
  force?: boolean;
}

export interface AlignMove {
  id: string;
  ref: string;
  dx: number;
  dy: number;
}

const glob = (p: string) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

/** Ratsnest length of a net: a minimum spanning tree over its pads' centers (nm). */
function mstLength(points: [number, number][]): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Infinity);
  best[0] = 0;
  let total = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = true;
    total += best[u];
    for (let i = 0; i < n; i++) if (!inTree[i]) best[i] = Math.min(best[i], Math.hypot(points[i][0] - points[u][0], points[i][1] - points[u][1]));
  }
  return total;
}

export function alignParts(doc: BoardDocument, style: ResolvedStyle, o: AlignOptions = {}): StyleChangeSet {
  const grid = nm(tokNum(style, "placement.grid"));
  const rowAlign = tok<boolean>(style, "placement.rowAlign");
  const beforeOnly = tok<boolean>(style, "placement.beforeRoutingOnly");
  const critical = tok<string[]>(style, "placement.critical");
  const limit = nm(tokNum(style, "placement.maxLengthIncrease"));
  const all = recordsOfKind(doc, "footprint");
  let parts: FootprintRec[];
  if (o.ids) parts = all.filter((f) => o.ids!.includes(f.id));
  else if (o.group) parts = groupsOf(doc, tokNum(style, "frame.groupDepth")).find((g) => g.key === o.group)?.members ?? [];
  else parts = all;
  const skipped: Skipped[] = [];
  const tracks = recordsOfKind(doc, "track");
  const vias = recordsOfKind(doc, "via");
  const routed = (fp: FootprintRec) =>
    padsOf(fp).some((p) => tracks.some((t) => [t.start, t.end].some((e) => e.x >= p.box.minX && e.x <= p.box.maxX && e.y >= p.box.minY && e.y <= p.box.maxY)) || vias.some((v) => v.x >= p.box.minX && v.x <= p.box.maxX && v.y >= p.box.minY && v.y <= p.box.maxY));
  const movable = parts.filter((f) => {
    if (f.locked) {
      skipped.push({ what: f.ref, reason: "locked", objects: [f.id] });
      return false;
    }
    if (beforeOnly && !o.afterRouting && routed(f)) {
      skipped.push({ what: f.ref, reason: "copper is attached: alignment runs before routing unless the call says afterRouting", objects: [f.id] });
      return false;
    }
    return true;
  });
  // targets: rows (the median of y within 0.5 mm, per group), then the grid
  const target = new Map<string, [number, number]>();
  for (const f of movable) target.set(f.id, [f.x, f.y]);
  if (rowAlign) {
    const groups = groupsOf(doc, tokNum(style, "frame.groupDepth"));
    for (const g of groups) {
      const ms = g.members.filter((m) => target.has(m.id)).sort((a, b) => a.y - b.y);
      let i = 0;
      while (i < ms.length) {
        let j = i;
        while (j + 1 < ms.length && ms[j + 1].y - ms[i].y <= 500_000) j++;
        if (j > i) {
          const ys = ms.slice(i, j + 1).map((m) => m.y).sort((a, b) => a - b);
          const med = ys[Math.floor(ys.length / 2)];
          for (const m of ms.slice(i, j + 1)) target.set(m.id, [target.get(m.id)![0], med]);
        }
        i = j + 1;
      }
    }
  }
  for (const [id, [x, y]] of target) target.set(id, [Math.round(x / grid) * grid, Math.round(y / grid) * grid]);
  // the guard: critical nets' ratsnest length, moving one part at a time
  const critNets = [...doc.nets.keys()].filter((n) => critical.some((c) => c === netClassOf(doc, n) || glob(c).test(n)));
  const pos = new Map(all.map((f) => [f.id, [f.x, f.y] as [number, number]]));
  const padPoints = (net: string): [number, number][] => {
    const info = doc.nets.get(net);
    const out: [number, number][] = [];
    for (const f of all) {
      const [x, y] = pos.get(f.id)!;
      for (const p of padsOf({ ...f, x, y })) if (info?.pads.includes(p.id)) out.push([p.x, p.y]);
    }
    return out;
  };
  const moves: AlignMove[] = [];
  const lengthened: { ref: string; net: string; increase: number }[] = [];
  for (const f of movable) {
    const [tx, ty] = target.get(f.id)!;
    const dx = tx - f.x;
    const dy = ty - f.y;
    if (!dx && !dy) continue;
    const nets = critNets.filter((n) => padsOf(f).some((p) => doc.nets.get(n)?.pads.includes(p.id)));
    const before = nets.map((n) => mstLength(padPoints(n)));
    pos.set(f.id, [tx, ty]);
    const worse = nets.map((n, i) => ({ net: n, inc: mstLength(padPoints(n)) - before[i] })).filter((x) => x.inc > limit);
    if (worse.length && !o.force) {
      pos.set(f.id, [f.x, f.y]);
      for (const w of worse) lengthened.push({ ref: f.ref, net: w.net, increase: Math.round(w.inc) });
      skipped.push({ what: f.ref, reason: `the move would lengthen ${worse.map((w) => `${w.net} by ${(w.inc / 1e6).toFixed(2)} mm`).join(", ")} (limit ${tokNum(style, "placement.maxLengthIncrease")} mm)`, objects: [f.id] });
      continue;
    }
    moves.push({ id: f.id, ref: f.ref, dx, dy });
  }
  const ops: OpCall[] = moves.map((m) => ({ op: "footprint.move", ids: [m.id], dx: m.dx, dy: m.dy, tracks: "attached" }));
  return {
    tool: "alignParts",
    title: `Align ${moves.length} parts to the ${tokNum(style, "placement.grid")} mm grid`,
    label: "align parts to the grid",
    ops,
    hostOps: [],
    provenance: styleProvenance("alignParts"),
    report: { added: 0, edited: moves.length, removed: 0, unchanged: movable.length - moves.length, keptHandEdits: [], skipped, notes: [`moves are taken back by undoing or reverting change set style:alignParts (actor ${STYLE_HOST.id} when applied by the style host)`], moves, lengthened },
    empty: !ops.length,
  };
}
