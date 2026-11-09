/**
 * Layout stages 3 to 6 for one card, in card-local coordinates (contract section 7).
 *
 *   clusters  each anchor (largest first) with what hangs on its pins is laid out on its own, in its own frame:
 *             every pin with something to hang is a lane leaving the pin along its lead. Shunts (decoupling,
 *             pull-ups, pull-downs, an LED or a button to ground, a probe) stand on or hang from the lane, series
 *             parts sit in line and the lane continues past them (a power path continues through a fuse or a
 *             ferrite to the next rail), and the lane ends in a port label (a net leaving the card) or a power
 *             symbol (a rail). Lanes on one side get columns so a part standing over a neighbor's row is placed
 *             beyond that neighbor's end. Supply pins on top of a large part rise to rail rows, one row per rail,
 *             stacked, with their capacitors in a bank beside the part; ground pins at the bottom drop to ground
 *             rows. Ports with no anchor pin start their own cluster (an LED chain, a button with its pull-up).
 *   patterns  clusters drawn alike are recognized: a chain (identical parts linked output to input, an addressable
 *             LED string, a shift register cascade) is drawn in order in rows of equal pitch, every member the same
 *             way round; repeated channels (identical clusters on a shared bus or rail) are drawn as an aligned
 *             array. The rest are packed in columns by signal flow (connectors first, drivers before what they
 *             drive), the column height chosen for a readable aspect.
 *   settle    what no pattern placed is pulled toward the pins it connects to (strong springs on signals, weak on
 *             rails) and pushed off everything placed, then snapped to the grid at the nearest free spot.
 *   connect   rails become power symbols, one per wired cluster; a net whose pins in the card are two or more is
 *             wired; a net leaving the card has one port label; a net whose wire would bend more than the limit,
 *             or cannot be routed, is labeled at each pin instead.
 *   route     route.ts, per card.
 *
 * Pinned and kept symbols (`fixed`) never move: they are placed first where they are, and the clusters of a fixed
 * anchor are built where the anchor is; the other clusters are packed clear of them.
 */
import { byCodeUnit } from "@protoboardai/board";
import { pinKey, splitPinKey, type CircuitPart } from "../circuit.ts";
import type { SchematicDocument } from "../document.ts";
import { boxesOverlap, inflateBox, labelBox, placeSymbol, powerBoxes, unionBoxes, type PlacedPin, type PlacedSymbol } from "../geometry.ts";
import type { LabelRecT, PowerRecT, SymbolRecT } from "../schema.ts";
import { resolveSymbol, type LBox } from "../symbols.ts";
import { dirVec, opposite, type Dir, type Rotation, type XY } from "../units.ts";
import { natural, type Classification } from "./classify.ts";
import { Grid, routeNet, type Terminal } from "./route.ts";

export interface LabelSpec {
  net: string;
  at: XY;
  side: Dir;
  scope: "local" | "port";
}
export interface PowerSpec {
  net: string;
  at: XY;
  dir: "up" | "down";
  style: "rail" | "ground";
}
export interface CardResult {
  card: string;
  symbols: SymbolRecT[];
  wires: { net: string; points: XY[] }[];
  labels: LabelSpec[];
  powers: PowerSpec[];
  noconnects: string[];
  /** content box, local coordinates */
  box: LBox;
  /** nets labeled at each pin because their wire failed or bent too much */
  fallbacks: string[];
  /** the patterns recognized in the card: `chain:<n>`, `array:<n>`, `bank:<rails>` */
  patterns: string[];
}

type SymPin = PlacedSymbol["pins"][number];
type Term = Terminal & { pin?: string; cl: number };

interface Job {
  key: string;
  net: string;
  terms: Term[];
  kind: "signal" | "rail";
}

const SHUNT_PITCH = 5;
/** Clusters are built far apart, then packed: cluster k starts at x = k * FAR. */
const FAR = 100_000;
/** Space between packed clusters, for the wires between them. */
const CLUSTER_GAP = 4;
/** Fixed (pinned) items do not move with any cluster. */
const FIXED = -1;

/** A spatial index of boxes: does a box overlap anything placed? */
class BoxIndex {
  private cells = new Map<string, number[]>();
  readonly all: { id: string; box: LBox; cl: number }[] = [];
  private static C = 4;
  private keys(b: LBox): string[] {
    const C = BoxIndex.C;
    const out: string[] = [];
    for (let x = Math.floor(b.x0 / C); x <= Math.floor(b.x1 / C); x++) for (let y = Math.floor(b.y0 / C); y <= Math.floor(b.y1 / C); y++) out.push(`${x},${y}`);
    return out;
  }
  add(id: string, box: LBox, cl: number): void {
    const i = this.all.length;
    this.all.push({ id, box, cl });
    for (const k of this.keys(box)) {
      const l = this.cells.get(k);
      if (l) l.push(i);
      else this.cells.set(k, [i]);
    }
  }
  hits(b: LBox, tol = 0): number {
    let n = 0;
    const seen = new Set<number>();
    for (const k of this.keys(b))
      for (const i of this.cells.get(k) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (boxesOverlap(b, this.all[i].box, tol)) n++;
      }
    return n;
  }
  any(b: LBox, tol = 0): boolean {
    for (const k of this.keys(b)) for (const i of this.cells.get(k) ?? []) if (boxesOverlap(b, this.all[i].box, tol)) return true;
    return false;
  }
}

/** A card's members laid out and wired in local coordinates. */
export function layoutCard(doc: SchematicDocument, cls: Classification, card: string, members: string[], opts: { refs: Map<string, string>; fixed: Map<string, SymbolRecT>; bendLimit: number }): CardResult {
  const syms = new Map<string, SymbolRecT>();
  const symCl = new Map<string, number>();
  const placed = new Map<string, PlacedSymbol>();
  let items = new BoxIndex();
  const labels: (LabelSpec & { cl: number })[] = [];
  const powers: (PowerSpec & { cl: number })[] = [];
  const fixedWires: { net: string; points: XY[]; cl: number }[] = [];
  const ncs = new Set<string>();
  const jobs = new Map<string, Job>();
  const patterns: string[] = [];
  /** pin keys that end in their own power symbol or label (no job) */
  const direct = new Set<string>();
  const memberSet = new Set(members);
  const isRailNet = (n: string | undefined) => !!n && (cls.nets.get(n)?.cls === "ground" || cls.nets.get(n)?.cls === "rail");
  const isGroundNet = (n: string | undefined) => !!n && cls.nets.get(n)?.cls === "ground";
  const crosses = (n: string) => (cls.nets.get(n)?.cards.length ?? 0) > 1;
  /** the cluster being built */
  let cur = 0;
  /** where the cluster being built starts */
  let base: XY = [0, 0];

  const mkRec = (path: string, x: number, y: number, rotation: Rotation): SymbolRecT => {
    const fixed = opts.fixed.get(path);
    if (fixed) return fixed;
    return { kind: "symbol", id: `sym:${path}`, part: path, ref: opts.refs.get(path)!, card, x, y, rotation, provenance: { by: "layout" }, ...(hideUnused(doc, path) ? { hide_unused: true as const } : {}) };
  };
  const geom = (rec: SymbolRecT) => placeSymbol(doc, rec)!;
  const boxesOf = (g: PlacedSymbol): LBox[] => [inflateBox(g.body, 0.2), g.ref, ...(g.value ? [g.value] : [])];
  const free = (bs: LBox[], pad = 0.25) => !bs.some((b) => items.any(inflateBox(b, pad), 0));
  const clOf = (path: string) => (opts.fixed.has(path) ? FIXED : cur);
  const commit = (path: string, rec: SymbolRecT) => {
    syms.set(path, rec);
    symCl.set(path, clOf(path));
    const g = geom(rec);
    placed.set(path, g);
    for (const b of boxesOf(g)) items.add(rec.id, b, clOf(path));
    return g;
  };
  const addLabel = (l: LabelSpec) => {
    labels.push({ ...l, cl: cur });
    items.add(`lbl:${l.net}`, labelBox({ net: l.net, x: l.at[0], y: l.at[1], side: l.side, scope: l.scope }, doc), cur);
  };
  const addPower = (p: PowerSpec) => {
    powers.push({ ...p, cl: cur });
    const b = powerBoxes({ net: p.net, x: p.at[0], y: p.at[1], dir: p.dir, style: p.style }, doc);
    items.add(`pwr:${p.net}`, b.glyph, cur);
    if (b.text) items.add(`pwr:${p.net}:t`, b.text, cur);
  };
  const addFixedWire = (net: string, points: XY[]) => {
    fixedWires.push({ net, points, cl: cur });
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      items.add(`wire:${net}`, { x0: Math.min(a[0], b[0]) - 0.3, y0: Math.min(a[1], b[1]) - 0.3, x1: Math.max(a[0], b[0]) + 0.3, y1: Math.max(a[1], b[1]) + 0.3 }, cur);
    }
  };
  const job = (k: string, net: string, kind: Job["kind"]) => {
    let j = jobs.get(k);
    if (!j) jobs.set(k, (j = { key: k, net, terms: [], kind }));
    return j;
  };
  const term = (t: Terminal & { pin?: string }): Term => ({ ...t, cl: cur });
  const keyOf = (p: SymPin) => p.keys[0] ?? p.key;
  const netOfPin = (p: SymPin) => p.net;
  const powerPinRight = (p: SymPin, rail: string) => (isGroundNet(rail) ? p.dir === "down" : p.dir === "up");
  const railStyle = (net: string): Pick<PowerSpec, "dir" | "style"> => (isGroundNet(net) ? { dir: "down", style: "ground" } : { dir: "up", style: "rail" });

  /** A rail pin of a placed part with no cluster: a symbol on the pin when it points the rail's way, else on a two-unit stub. */
  const directPower = (p: SymPin) => {
    const net = netOfPin(p)!;
    const st = railStyle(net);
    if (powerPinRight(p, net)) {
      addPower({ net, at: p.at, ...st });
      for (const k of p.keys) direct.add(k);
      return;
    }
    const v = dirVec(p.dir);
    let at: XY = [p.at[0] + 2 * v[0], p.at[1] + 2 * v[1]];
    for (let k = 2; k < 8; k++) {
      at = [p.at[0] + k * v[0], p.at[1] + k * v[1]];
      const b = powerBoxes({ net, x: at[0], y: at[1], ...st }, doc);
      if (free([b.glyph, ...(b.text ? [b.text] : [])], 0.1)) break;
    }
    addPower({ net, at, ...st });
    const j = job(`${net}#${keyOf(p)}`, net, "rail");
    j.terms.push(term({ at: p.at, exit: p.dir, pin: keyOf(p) }), term({ at, exit: st.dir === "down" ? "up" : "down" }));
  };

  // a two-terminal part's rotation so that `pinId` (a part pin) points `want`
  const orient = (part: CircuitPart, pinId: string, want: Dir): { rot: Rotation; spinAt: XY } => {
    for (const rot of [0, 90, 180, 270] as Rotation[]) {
      const g = geom({ kind: "symbol", id: `sym:${part.path}`, part: part.path, ref: "?", card, x: 0, y: 0, rotation: rot, provenance: { by: "layout" } });
      const p = g.pins.find((x) => x.keys.includes(pinKey(part.path, pinId)));
      if (p && p.dir === want) return { rot, spinAt: p.at };
    }
    return { rot: 0, spinAt: [0, 0] };
  };
  /** Place a two-terminal part so its pin `pinId` lands at `at` pointing `want`; shift along `step` until free. */
  const placeTwo = (path: string, pinId: string, at: XY, want: Dir, step: XY): PlacedSymbol => {
    const fixed = opts.fixed.get(path);
    if (fixed) return commit(path, fixed);
    const part = doc.parts.get(path)!;
    const { rot, spinAt } = orient(part, pinId, want);
    let [x, y] = [at[0] - spinAt[0], at[1] - spinAt[1]];
    // the power symbol a shunt's far pin will carry counts as part of it
    const farPower = (g: PlacedSymbol): LBox[] => {
      const far = g.pins.find((p) => !p.keys.includes(pinKey(path, pinId)));
      if (!far?.net || !isRailNet(far.net) || !powerPinRight(far, far.net)) return [];
      const b = powerBoxes({ net: far.net, x: far.at[0], y: far.at[1], ...railStyle(far.net) }, doc);
      return [b.glyph, ...(b.text ? [b.text] : [])];
    };
    for (let k = 0; k < 40; k++) {
      const rec = mkRec(path, x, y, rot);
      const g = geom(rec);
      if (free([...boxesOf(g), ...farPower(g)])) return commit(path, rec);
      x += step[0];
      y += step[1];
    }
    return commit(path, mkRec(path, at[0] - spinAt[0], at[1] - spinAt[1], rot));
  };

  /** satellites a lane has taken (placed or about to be): no other lane takes them */
  const claimed = new Set<string>();
  const unplacedSats = () => members.filter((m) => !placed.has(m) && !claimed.has(m) && !cls.parts.get(m)!.anchor);
  /** satellites with a pin on `net` (not the excluded part), with the pin they touch it with */
  const satsOn = (net: string, exclude: Set<string>) => {
    const out: { path: string; pin: string; other?: { pin: string; net?: string } }[] = [];
    for (const m of unplacedSats()) {
      if (exclude.has(m)) continue;
      const part = doc.parts.get(m)!;
      const on = part.pins.find((p) => doc.pinNets.get(pinKey(m, p.id)) === net);
      if (!on) continue;
      const other = part.pins.find((p) => p.id !== on.id && doc.pinNets.get(pinKey(m, p.id)) !== net);
      out.push({ path: m, pin: on.id, ...(other ? { other: { pin: other.id, net: doc.pinNets.get(pinKey(m, other.id)) } } : {}) });
    }
    return out;
  };

  interface Elem {
    path: string;
    pin: string;
    kind: "up" | "down" | "inline";
    other?: { pin: string; net?: string };
  }
  interface Lane {
    start: XY;
    s: 1 | -1;
    row: number;
    net: string;
    rail: boolean;
    keys: string[];
    elems: Elem[];
    u: number;
    d: number;
    terminal: "label" | "power" | "none";
    /** the anchor pin, for a lane from a pin */
    pin?: SymPin;
    virtual?: boolean;
    extent?: number;
  }

  /** What hangs on a lane, in order: shunts, then a series part and what hangs past it. */
  const laneContent = (net: string, rail: boolean, servedKeys: string[]): Elem[] => {
    const elems: Elem[] = [];
    const taken = new Set<string>();
    let cur = net;
    let onRail = rail;
    let lastDef: string | undefined;
    for (let hop = 0; hop < 6; hop++) {
      // where the net fans out to several parts, a part like the one just taken is a sibling channel's, not this lane's
      const fanOut = (cls.nets.get(cur)?.pinsIn.get(card)?.length ?? 0) > 2;
      const sats = satsOn(cur, taken);
      const shunts = sats.filter((s) => {
        const info = cls.parts.get(s.path)!;
        if (info.role === "probe") return true;
        // on a rail: its decoupling capacitors, and protection from the rail to ground (a TVS, a bleeder)
        if (onRail) return (info.role === "decoupling" && (hop > 0 || servedKeys.includes(info.serves ?? ""))) || (info.role === "rail_shunt" && isGroundNet(s.other?.net) && (hop > 0 || !servedKeys.length || servedKeys.some((k) => doc.parts.get(splitPinKey(k).part)!.class === "connector")));
        return !!s.other && isRailNet(s.other.net);
      });
      for (const s of shunts.sort((a, b) => natural(opts.refs.get(a.path) ?? a.path, opts.refs.get(b.path) ?? b.path) || byCodeUnit(a.path, b.path))) {
        taken.add(s.path);
        const towardGround = isGroundNet(s.other?.net);
        elems.push({ path: s.path, pin: s.pin, kind: s.other ? (towardGround ? "down" : "up") : "up", ...(s.other ? { other: s.other } : {}) });
      }
      // a power path continues in line through a fuse, a ferrite or a diode to the next rail (not back to ground)
      const series = sats
        .filter((s) => {
          if (taken.has(s.path) || !s.other?.net) return false;
          const role = cls.parts.get(s.path)!.role;
          if (fanOut && lastDef && doc.parts.get(s.path)!.part === lastDef) return false;
          return onRail ? role === "power_series" && !isGroundNet(s.other.net) && hop === 0 : !isRailNet(s.other.net) && role === "series";
        })
        .sort((a, b) => byCodeUnit(a.path, b.path))[0];
      if (!series) break;
      taken.add(series.path);
      lastDef = doc.parts.get(series.path)!.part;
      elems.push({ path: series.path, pin: series.pin, kind: "inline", other: series.other });
      cur = series.other!.net!;
      onRail = isRailNet(cur);
    }
    for (const e of elems) claimed.add(e.path);
    return elems;
  };
  const spanOf = (l: Lane) => {
    let u = 0.8;
    let d = 0.8;
    for (const e of l.elems) {
      if (e.kind === "up") u = Math.max(u, 7);
      else if (e.kind === "down") d = Math.max(d, isGroundNet(e.other?.net) ? 7.8 : 7);
      else {
        u = Math.max(u, 1.9);
        d = Math.max(d, 1.9);
      }
    }
    if (l.terminal === "power") {
      if (isGroundNet(l.net)) d = Math.max(d, 3.6);
      else u = Math.max(u, 3);
    }
    l.u = u;
    l.d = d;
  };
  const laneJob = (l: Lane, net: string) => (isRailNet(net) ? job(`${net}#lane:${l.keys[0] ?? `${cur}:${l.start.join(",")}`}`, net, "rail") : job(net, net, "signal"));

  /** Place a lane's elements and its terminal, starting at `from` along the row. */
  const placeLane = (l: Lane, from: number) => {
    const s = l.s;
    let cursor = from;
    let lastPinX = l.start[0];
    const row = l.row;
    let curNet = l.net;
    let railNamed = false;
    for (const e of l.elems) {
      // an element whose pin is not on the row's net (a lane merged from a mate pin) is left for the settle pass
      if (doc.pinNets.get(pinKey(e.path, e.pin)) !== curNet) {
        claimed.delete(e.path);
        continue;
      }
      if (e.kind === "inline") {
        if (isRailNet(curNet) && !railNamed) {
          // a power path names the rail it leaves before the series part
          addPower({ net: curNet, at: [cursor, row], ...railStyle(curNet) });
          laneJob(l, curNet).terms.push(term({ at: [cursor, row], exit: isGroundNet(curNet) ? "up" : "down" }));
          cursor += s * 2;
          railNamed = true;
        }
        const g = placeTwo(e.path, e.pin, [cursor, row], s > 0 ? "left" : "right", [s, 0]);
        const near = g.pins.find((p) => p.keys.includes(pinKey(e.path, e.pin)))!;
        const far = g.pins.find((p) => p !== near)!;
        laneJob(l, curNet).terms.push(term({ at: near.at, exit: near.dir, pin: keyOf(near) }));
        curNet = e.other!.net!;
        laneJob(l, curNet).terms.push(term({ at: far.at, exit: far.dir, pin: keyOf(far) }));
        lastPinX = far.at[0];
        cursor = far.at[0] + s * 2;
      } else {
        const want: Dir = e.kind === "up" ? "down" : "up";
        const g = placeTwo(e.path, e.pin, [cursor, row], want, [s, 0]);
        const near = g.pins.find((p) => p.keys.includes(pinKey(e.path, e.pin)))!;
        const far = g.pins.find((p) => p !== near);
        laneJob(l, curNet).terms.push(term({ at: near.at, exit: near.dir, pin: keyOf(near) }));
        if (far?.net && isRailNet(far.net)) directPower(far);
        lastPinX = near.at[0];
        cursor = near.at[0] + s * SHUNT_PITCH;
      }
    }
    const endX = l.elems.length ? lastPinX + s * 2 : l.terminal === "power" ? l.start[0] + s * 2 : l.start[0];
    let ext = s > 0 ? Math.max(endX, lastPinX) : Math.min(endX, lastPinX);
    if (l.terminal === "label") {
      let at: XY = [endX, row];
      const side: Dir = s > 0 ? "right" : "left";
      for (let k = 0; k < 30; k++) {
        const b = labelBox({ net: curNet, x: at[0], y: at[1], side, scope: "port" }, doc);
        if (free([b], 0.1) || (k === 0 && !l.elems.length)) break;
        at = [at[0] + s, row];
      }
      const net = curNet;
      addLabel({ net, at, side, scope: crosses(net) ? "port" : "local" });
      if (at[0] !== l.start[0] || l.elems.length) laneJob(l, net).terms.push(term({ at, exit: opposite(side) }));
      else for (const k of l.keys) direct.add(k);
      const lb = labelBox({ net, x: at[0], y: at[1], side, scope: "port" }, doc);
      ext = s > 0 ? lb.x1 : lb.x0;
    } else if (l.terminal === "power" || (isRailNet(curNet) && curNet !== l.net)) {
      // a lane ends at its rail; a power path ends at the rail it reaches; the symbol goes out until it is clear
      let at: XY = [endX, row];
      for (let k = 0; k < 30; k++) {
        const b = powerBoxes({ net: curNet, x: at[0], y: at[1], ...railStyle(curNet) }, doc);
        const stub: LBox = { x0: Math.min(l.start[0], at[0]) + 0.5, y0: row - 0.2, x1: Math.max(l.start[0], at[0]) - 0.5, y1: row + 0.2 };
        if (free([b.glyph, ...(b.text ? [b.text] : []), ...(l.elems.length ? [] : [stub])], 0.1)) break;
        at = [at[0] + s, row];
      }
      addPower({ net: curNet, at, ...railStyle(curNet) });
      laneJob(l, curNet).terms.push(term({ at, exit: isGroundNet(curNet) ? "up" : "down" }));
      ext = at[0] + s * 1.5;
    }
    l.extent = ext;
    // lane pins join the lane's job
    if (l.pin && !(l.terminal === "label" && !l.elems.length && endX === l.start[0])) {
      const j = laneJob(l, l.net);
      const k = l.keys[0];
      if (!j.terms.some((t) => t.pin === k)) j.terms.unshift(term({ at: l.pin.at, exit: l.pin.dir, pin: k }));
    }
  };

  // ---------------------------------------------------------------- anchors and their lanes
  const anchors = members.filter((m) => cls.parts.get(m)!.anchor).sort((a, b) => cls.parts.get(b)!.symbolPins - cls.parts.get(a)!.symbolPins || byCodeUnit(a, b));
  /** anchors whose fields are chosen once their lanes are placed */
  const fieldless: string[] = [];
  const commitBody = (path: string, rec: SymbolRecT) => {
    syms.set(path, rec);
    symCl.set(path, clOf(path));
    const g = geom(rec);
    placed.set(path, g);
    items.add(rec.id, inflateBox(g.body, 0.2), clOf(path));
    if (!rec.fields) fieldless.push(path);
    else {
      items.add(rec.id, g.ref, clOf(path));
      if (g.value) items.add(rec.id, g.value, clOf(path));
    }
    return g;
  };
  /** Place one shunt with its lane pin at `at`, pushed outward along the row until free. */
  const placeShunt = (l: Lane, e: Elem, at: XY): XY => {
    const want: Dir = e.kind === "up" ? "down" : "up";
    const g = placeTwo(e.path, e.pin, at, want, [l.s, 0]);
    const near = g.pins.find((p) => p.keys.includes(pinKey(e.path, e.pin)))!;
    const far = g.pins.find((p) => p !== near);
    // the job of the net the shunt's own pin is on (a mate lane can carry another rail's shunts)
    laneJob(l, doc.pinNets.get(pinKey(e.path, e.pin)) ?? l.net).terms.push(term({ at: near.at, exit: near.dir, pin: keyOf(near) }));
    if (far?.net && isRailNet(far.net)) directPower(far);
    return near.at;
  };

  /**
   * Supply pins on top of a part (and ground pins at its bottom) of more than one, or with capacitors: one rail row
   * per rail, stacked away from the body (the narrowest row nearest), each with its power symbol at the row's
   * outer end; each pin rises (or drops) straight to its row; the capacitors of a row hang from it in a bank past
   * the part's last top pin, every row's bank in the same columns.
   */
  const railBanks = (g: PlacedSymbol): Set<string> => {
    const done = new Set<string>();
    for (const top of [true, false]) {
      const pins = g.pins.filter((p) => p.net && isRailNet(p.net) && p.dir === (top ? "up" : "down"));
      if (!pins.length) continue;
      const caps = new Map<string, Elem[]>();
      for (const p of pins) {
        const all = top ? laneContent(p.net!, true, p.keys) : [];
        const cut = all.findIndex((e) => e.kind === "inline");
        caps.set(p.keys[0], cut < 0 ? all : all.slice(0, cut));
        if (cut >= 0) for (const e of all.slice(cut)) claimed.delete(e.path);
      }
      const anyCaps = [...caps.values()].some((c) => c.length);
      if (pins.length < 2 && !anyCaps) continue;
      const nets = [...new Set(pins.map((p) => p.net!))];
      const span = (n: string) => {
        const xs = pins.filter((p) => p.net === n).map((p) => p.at[0]);
        return Math.max(...xs) - Math.min(...xs);
      };
      nets.sort((a, b) => span(a) - span(b) || byCodeUnit(a, b));
      const xs = pins.map((p) => p.at[0]);
      const xa = Math.min(...xs);
      const xb = Math.max(...xs);
      const y0 = pins[0].at[1];
      const sgn = top ? -1 : 1;
      let level = y0;
      let first = true;
      for (const net of nets) {
        const mine = pins.filter((p) => p.net === net);
        const bank = mine.flatMap((p) => caps.get(p.keys[0])!);
        level += sgn * (bank.length ? (first ? 7 : 9) : first ? 3 : 4);
        const first0 = first;
        first = false;
        const row = level;
        const st = railStyle(net);
        const symX = xa - 3;
        // stubs and the row as drawn wires (their geometry is fixed by the pattern)
        let end = Math.max(...mine.map((p) => p.at[0]));
        const lane: Lane = { start: [symX, row], s: 1, row, net, rail: true, keys: mine.map((p) => p.keys[0]), elems: bank, u: 0, d: 0, terminal: "none" };
        // the stubs first, so the capacitors' fields keep clear of them
        for (const p of mine) {
          addFixedWire(net, [p.at, [p.at[0], row]]);
          for (const k of p.keys) direct.add(k);
        }
        // the bank: the first capacitor right of the last top pin, the second left of the first (both beside the
        // pins), the rest further right
        let right = xb + 3;
        let left = xa - 3;
        let start = Math.min(...mine.map((p) => p.at[0]));
        const capPins: XY[] = [];
        bank.forEach((e, i) => {
          const toLeft = i === 1 && first0;
          const g2 = placeTwo(e.path, e.pin, [toLeft ? left : right, row], "up", [toLeft ? -1 : 1, 0]);
          const near = g2.pins.find((p) => p.keys.includes(pinKey(e.path, e.pin)))!;
          const far = g2.pins.find((p) => p !== near);
          if (far?.net && isRailNet(far.net)) directPower(far);
          for (const k of near.keys) direct.add(k);
          capPins.push(near.at);
          if (toLeft) left = near.at[0] - SHUNT_PITCH;
          else right = near.at[0] + SHUNT_PITCH;
          end = Math.max(end, near.at[0]);
          start = Math.min(start, near.at[0]);
        });
        void lane;
        const sx = Math.min(symX, start - 3);
        addPower({ net, at: [sx, row], ...st });
        addFixedWire(net, [
          [sx, row],
          [end, row],
        ]);
        for (const c of capPins) if (c[1] !== row) addFixedWire(net, [c, [c[0], row]]);
        done.add(net);
      }
      for (const p of pins) for (const k of p.keys) direct.add(k);
      patterns.push(`bank:${top ? "top" : "bottom"}:${nets.length}`);
    }
    return done;
  };

  /** One anchor and what hangs on its pins, around the anchor placed at `at`. */
  const buildCluster = (a: string, at: XY) => {
    const g = commitBody(a, mkRec(a, at[0], at[1], 0));
    railBanks(g);
    const crystals = crystalPairs(g);
    const lanes: Lane[] = [];
    for (const p of g.pins) {
      const net = netOfPin(p);
      const part = g.part;
      if (!net) {
        const marked = p.keys.some((k) => {
          const pin = part.pins.find((x) => pinKey(part.path, x.id) === k);
          return pin?.type === "nc" || !!part.unconnected?.[splitPinKey(k).pin];
        });
        if (marked) for (const k of p.keys) ncs.add(k);
        continue;
      }
      if (p.keys.every((k) => direct.has(k))) continue;
      const rail = isRailNet(net);
      if (p.dir === "up" || p.dir === "down") {
        if (rail) {
          directPower(p);
          continue;
        }
        // a signal on a top or bottom pin: a label along the lead
        if (crosses(net)) {
          addLabel({ net, at: p.at, side: p.dir, scope: "port" });
          for (const k of p.keys) direct.add(k);
        }
        continue;
      }
      const s: 1 | -1 = p.dir === "right" ? 1 : -1;
      if (rail) {
        // a rail pin next to another of the same rail on this side joins its lane
        const mate = lanes.find((l) => l.rail && l.net === net && l.s === s && Math.abs(l.row - p.at[1]) <= 2);
        if (mate) {
          mate.keys.push(...p.keys);
          // only the mate's own rail's shunts join it; a power path from this pin is left for later lanes
          const more = laneContent(net, true, p.keys);
          const cut = more.findIndex((e) => e.kind === "inline");
          if (cut >= 0) for (const e of more.slice(cut)) claimed.delete(e.path);
          mate.elems.push(...(cut >= 0 ? more.slice(0, cut) : more));
          laneJob(mate, net).terms.push(term({ at: p.at, exit: p.dir, pin: p.keys[0] }));
          continue;
        }
        lanes.push({ start: p.at, s, row: p.at[1], net, rail: true, keys: [...p.keys], elems: laneContent(net, true, p.keys), u: 0, d: 0, terminal: "power", pin: p });
        continue;
      }
      const elems = laneContent(net, false, p.keys);
      lanes.push({ start: p.at, s, row: p.at[1], net, rail: false, keys: [...p.keys], elems, u: 0, d: 0, terminal: "none", pin: p });
    }
    // a lane's terminal follows the last net of its chain
    for (const l of lanes) {
      if (l.rail) continue;
      const last = [...l.elems].reverse().find((e) => e.kind === "inline");
      l.terminal = crosses(last?.other?.net ?? l.net) ? "label" : "none";
    }
    for (const l of lanes) spanOf(l);
    for (const s of [-1, 1] as const) {
      const side = lanes.filter((l) => l.s === s);
      const plain = side.filter((l) => !l.elems.length);
      const rich = side.filter((l) => l.elems.length && l.elems.every((e) => e.kind !== "inline"));
      const chained = side.filter((l) => l.elems.some((e) => e.kind === "inline"));
      // plain lanes: a label on the pin first, then the power symbols on stubs long enough to clear them
      for (const l of plain.filter((x) => x.terminal !== "power")) placeLane(l, l.start[0]);
      for (const l of plain.filter((x) => x.terminal === "power")) placeLane(l, l.start[0]);
      // shunt lanes: each shunt its own column; a shunt that would stand over a neighbor's row goes to a bank above
      // (or below) the neighbors with a drop wire; the lanes' labels line up past the last column
      if (rich.length) {
        const pinX = s > 0 ? Math.max(...rich.map((l) => l.start[0])) : Math.min(...rich.map((l) => l.start[0]));
        let cursor = pinX + s * (s > 0 ? 2 : SHUNT_PITCH);
        let last = cursor;
        const beyond = (x: number) => (s > 0 ? Math.max(cursor, Math.ceil(x) + 2) : Math.min(cursor, Math.floor(x) - SHUNT_PITCH));
        const placedAt = new Map<Lane, number>();
        const reaches = (o: Lane) => o.terminal !== "none" || !placedAt.has(o) || (s > 0 ? placedAt.get(o)! > cursor : placedAt.get(o)! < cursor);
        for (const kind of ["up", "down"] as const) {
          const order = [...rich].sort((a, b) => (kind === "up" ? a.row - b.row : b.row - a.row));
          for (const l of order)
            for (const e of l.elems.filter((x) => x.kind === kind)) {
              const inSpan = (r: number) => (kind === "up" ? r >= l.row - 7 && r < l.row : r > l.row && r <= l.row + 7.8);
              for (const o of plain) if (inSpan(o.row) && o.extent !== undefined) cursor = beyond(o.extent);
              const covered = rich.filter((o) => o !== l && inSpan(o.row) && reaches(o)).map((o) => o.row);
              const y = covered.length ? (kind === "up" ? Math.min(...covered) - 1 : Math.max(...covered) + 1) : l.row;
              const at = placeShunt(l, e, [cursor, y]);
              placedAt.set(l, at[0]);
              last = at[0];
              cursor = at[0] + s * SHUNT_PITCH;
            }
        }
        const X = last + s * 2;
        for (const l of rich) {
          if (l.pin) {
            const j = laneJob(l, l.net);
            if (!j.terms.some((t) => t.pin === l.keys[0])) j.terms.unshift(term({ at: l.pin.at, exit: l.pin.dir, pin: l.keys[0] }));
          }
          if (l.terminal === "label") {
            const side: Dir = s > 0 ? "right" : "left";
            addLabel({ net: l.net, at: [X, l.row], side, scope: "port" });
            laneJob(l, l.net).terms.push(term({ at: [X, l.row], exit: opposite(side) }));
          } else if (l.terminal === "power") {
            addPower({ net: l.net, at: [X, l.row], ...railStyle(l.net) });
            laneJob(l, l.net).terms.push(term({ at: [X, l.row], exit: isGroundNet(l.net) ? "up" : "down" }));
          }
          l.extent = X;
        }
      }
      // chains with series parts: beyond everything they cover
      for (const l of chained) {
        let from = l.start[0] + s * 2;
        for (const o of [...plain, ...rich]) if (o.row > l.row - l.u && o.row < l.row + l.d && o.extent !== undefined) from = s > 0 ? Math.max(from, Math.ceil(o.extent) + 3) : Math.min(from, Math.floor(o.extent) - 3);
        placeLane(l, from);
      }
    }
    for (const x of crystals) placeCrystal(g, x);
    chooseFields();
  };

  /**
   * Crystals between two pins of this part on one side (XIN and XOUT): the crystal and its load capacitors are
   * taken before the lanes, so those pins' lanes stay plain; `placeCrystal` then lays them out together.
   */
  const crystalPairs = (g: PlacedSymbol) => {
    const out: { y: string; a: SymPin; b: SymPin; caps: { path: string; pin: string; net: string }[] }[] = [];
    for (const m of unplacedSats()) {
      const part = doc.parts.get(m)!;
      if (part.class !== "crystal" || part.pins.length !== 2) continue;
      const nets = part.pins.map((p) => doc.pinNets.get(pinKey(m, p.id)));
      const pa = g.pins.find((p) => p.net && p.net === nets[0] && (p.dir === "left" || p.dir === "right"));
      const pb = g.pins.find((p) => p.net && p.net === nets[1] && p.dir === pa?.dir);
      if (!pa || !pb) continue;
      const caps: { path: string; pin: string; net: string }[] = [];
      for (const net of [pa.net!, pb.net!])
        for (const s of satsOn(net, new Set([m]))) if (doc.parts.get(s.path)!.class === "capacitor" && isGroundNet(s.other?.net)) caps.push({ path: s.path, pin: s.pin, net });
      claimed.add(m);
      for (const c of caps) claimed.add(c.path);
      out.push({ y: m, a: pa, b: pb, caps });
    }
    return out;
  };
  /**
   * The crystal lies across, below its two pins, out from the part: the lower pin's net to the crystal's near end,
   * the upper pin's net to its far end (so the two wires never cross), each load capacitor hanging from its end to
   * ground. The first free spot, nearest first.
   */
  const placeCrystal = (g: PlacedSymbol, x: { y: string; a: SymPin; b: SymPin; caps: { path: string; pin: string; net: string }[] }) => {
    const [upper, lower] = x.a.at[1] < x.b.at[1] ? [x.a, x.b] : [x.b, x.a];
    const s = upper.dir === "right" ? 1 : -1;
    const part = doc.parts.get(x.y)!;
    const pinOn = (net: string) => part.pins.find((p) => doc.pinNets.get(pinKey(x.y, p.id)) === net)!.id;
    const nearPin = pinOn(lower.net!);
    const { rot, spinAt } = orient(part, nearPin, s > 0 ? "left" : "right");
    for (let r = 0; r < 40; r++) {
      for (let dy = 0; dy <= r; dy++) {
        const dx = r - dy;
        const at: XY = [lower.at[0] + s * (4 + dx), lower.at[1] + 3 + dy];
        const rec = mkRec(x.y, at[0] - spinAt[0], at[1] - spinAt[1], rot);
        const gy = geom(rec);
        const ends = new Map(gy.pins.map((p) => [p.net!, p.at] as const));
        // each load capacitor beside its end of the crystal (the near end's toward the part, the far end's outward),
        // as close as its fields allow
        const taken: LBox[] = [...boxesOf(gy)];
        const capRecs = x.caps.map((c) => {
          const o = orient(doc.parts.get(c.path)!, c.pin, "up");
          const e = ends.get(c.net)!;
          const dir = c.net === lower.net ? -s : s;
          let rec = mkRec(c.path, e[0] + 2 * dir - o.spinAt[0], e[1] - o.spinAt[1], o.rot);
          for (let k = 2; k <= 8; k++) {
            rec = mkRec(c.path, e[0] + k * dir - o.spinAt[0], e[1] - o.spinAt[1], o.rot);
            if (!boxesOf(geom(rec)).some((b) => taken.some((t) => boxesOverlap(inflateBox(b, 0.25), t, 0)))) break;
          }
          taken.push(...boxesOf(geom(rec)));
          return { c, rec };
        });
        const boxes = [...boxesOf(gy), ...capRecs.flatMap((k) => boxesOf(geom(k.rec))), inflateBox({ x0: Math.min(at[0], upper.at[0]), y0: upper.at[1] + 0.5, x1: Math.max(at[0], upper.at[0]), y1: at[1] - 1.2 }, 0)];
        const gnd = capRecs.flatMap((k) => {
          const far = geom(k.rec).pins.find((p) => !p.keys.includes(pinKey(k.c.path, k.c.pin)));
          if (!far?.net || !isRailNet(far.net)) return [];
          const b = powerBoxes({ net: far.net, x: far.at[0], y: far.at[1], ...railStyle(far.net) }, doc);
          return [b.glyph, ...(b.text ? [b.text] : [])];
        });
        if (!free([...boxes, ...gnd])) continue;
        const cg = commit(x.y, rec);
        for (const p of cg.pins) job(p.net!, p.net!, "signal").terms.push(term({ at: p.at, exit: p.dir, pin: keyOf(p) }));
        for (const k of capRecs) {
          const kg = commit(k.c.path, k.rec);
          const near = kg.pins.find((p) => p.keys.includes(pinKey(k.c.path, k.c.pin)))!;
          const far = kg.pins.find((p) => p !== near);
          job(k.c.net, k.c.net, "signal").terms.push(term({ at: near.at, exit: near.dir, pin: keyOf(near) }));
          if (far?.net && isRailNet(far.net)) directPower(far);
        }
        patterns.push("crystal");
        return;
      }
    }
    for (const k of [x.y, ...x.caps.map((c) => c.path)]) claimed.delete(k);
  };

  // fields of the anchors: the first free spot above or below the body, beside any stub
  const chooseFields = () => {
    for (const path of fieldless) {
      const rec = syms.get(path)!;
      const g0 = geom(rec);
      const b = g0.body;
      const stubs = g0.pins.filter((p) => p.dir === "up" || p.dir === "down");
      const rowsAbove = [Math.floor(b.y0) - 3, Math.floor(b.y0) - 6, Math.floor(b.y0) - 9];
      const rowsBelow = [Math.ceil(b.y1) + 1, Math.ceil(b.y1) + 4];
      const xs: [number, "left" | "right"][] = [
        [Math.floor(b.x0), "left"],
        [Math.ceil(b.x1), "right"],
      ];
      for (const p of stubs) xs.push([p.at[0] + 2, "left"], [p.at[0] - 2, "right"]);
      const cands: { dx: number; dy: number; anchor: "left" | "right" }[] = [];
      for (const ys of [[rowsAbove[0]], [rowsBelow[0]], [rowsAbove[1], rowsBelow[1], rowsAbove[2]]]) for (const y of ys) for (const [x, anchor] of xs) cands.push({ dx: x - rec.x, dy: y - rec.y + (y < b.y0 ? 1 : 0), anchor });
      // beside the body, in the clear corner (large parts with stubs above and below)
      cands.push({ dx: Math.ceil(b.x1) + 1 - rec.x, dy: Math.floor(b.y0) + 1 - rec.y, anchor: "left" }, { dx: Math.floor(b.x0) - 1 - rec.x, dy: Math.floor(b.y0) + 1 - rec.y, anchor: "right" });
      let best: SymbolRecT = rec;
      let bestHit = Infinity;
      for (const c of cands) {
        const r2: SymbolRecT = { ...rec, fields: c };
        const g2 = geom(r2);
        const bs = [g2.ref, ...(g2.value ? [g2.value] : [])];
        const hit = bs.reduce((n, x) => n + items.hits(inflateBox(x, 0.3), 0), 0);
        if (hit < bestHit) {
          bestHit = hit;
          best = r2;
        }
        if (!hit) break;
      }
      syms.set(path, best);
      const g = geom(best);
      placed.set(path, g);
      items.add(best.id, g.ref, symCl.get(path)!);
      if (g.value) items.add(best.id, g.value, symCl.get(path)!);
    }
    fieldless.length = 0;
  };

  // ---------------------------------------------------------------- build the clusters
  interface Cluster {
    idx: number;
    anchor?: string;
    /** anchored where a fixed anchor is: not packed */
    fixed: boolean;
  }
  const clusters: Cluster[] = [];
  // pinned and kept symbols first, where they are
  cur = FIXED;
  for (const [path, rec] of [...opts.fixed].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    if (!memberSet.has(path) || cls.parts.get(path)!.anchor) continue;
    if (!placed.has(path)) commit(path, rec);
  }
  for (const a of anchors) {
    const fixed = opts.fixed.get(a);
    // with pinned content in the card, the main anchor is built where it was (the card's origin), among what stays
    const home = !fixed && a === anchors[0] && opts.fixed.size > 0;
    cur = clusters.length;
    base = fixed || home ? [0, 0] : [cur * FAR + FAR, 0];
    clusters.push({ idx: cur, anchor: a, fixed: !!fixed || home });
    buildCluster(a, fixed ? [fixed.x, fixed.y] : base);
  }
  // ports with no anchor pin: each a lane from its own label, in its own cluster
  const portNets = [...new Set(unplacedSats().flatMap((m) => doc.parts.get(m)!.pins.map((p) => doc.pinNets.get(pinKey(m, p.id))).filter((n): n is string => !!n && !isRailNet(n) && crosses(n))))].sort(byCodeUnit);
  for (const net of portNets) {
    const elems = laneContent(net, false, []);
    if (!elems.length) continue;
    cur = clusters.length;
    base = [cur * FAR + FAR, 0];
    clusters.push({ idx: cur, fixed: false });
    const lane: Lane = { start: base, s: 1, row: 0, net, rail: false, keys: [], elems, u: 0, d: 0, terminal: "none", virtual: true };
    spanOf(lane);
    addLabel({ net, at: base, side: "left", scope: "port" });
    job(net, net, "signal").terms.push(term({ at: base, exit: "right" }));
    placeLane(lane, base[0] + 2);
  }

  // ---------------------------------------------------------------- patterns and packing
  const boxOfCluster = new Map<number, LBox>();
  for (const it of items.all) {
    if (it.cl < 0) continue;
    const b = boxOfCluster.get(it.cl);
    boxOfCluster.set(it.cl, b ? unionBoxes([b, it.box]) : it.box);
  }
  for (const w of fixedWires) if (w.cl >= 0) boxOfCluster.set(w.cl, unionBoxes([boxOfCluster.get(w.cl)!, ...w.points.map(([x, y]) => ({ x0: x, y0: y, x1: x, y1: y }))]));
  const offsets = arrangeClusters();
  const shiftOf = (cl: number): XY => (cl < 0 ? [0, 0] : (offsets.get(cl) ?? [0, 0]));
  const mv = (p: XY, cl: number): XY => {
    const d = shiftOf(cl);
    return [p[0] + d[0], p[1] + d[1]];
  };
  // translate everything to its packed place
  for (const [path, rec] of syms) {
    const d = shiftOf(symCl.get(path)!);
    if (d[0] || d[1]) syms.set(path, { ...rec, x: rec.x + d[0], y: rec.y + d[1] });
    placed.set(path, geom(syms.get(path)!));
  }
  for (const l of labels) l.at = mv(l.at, l.cl);
  for (const p of powers) p.at = mv(p.at, p.cl);
  for (const w of fixedWires) w.points = w.points.map((p) => mv(p, w.cl));
  for (const j of jobs.values()) for (const t of j.terms) t.at = mv(t.at, t.cl);
  const moved = new BoxIndex();
  for (const it of items.all) {
    const d = shiftOf(it.cl);
    moved.add(it.id, { x0: it.box.x0 + d[0], y0: it.box.y0 + d[1], x1: it.box.x1 + d[0], y1: it.box.y1 + d[1] }, FIXED);
  }
  items = moved;
  cur = FIXED;

  /**
   * Place the clusters: fixed ones stay; chains and repeated channels become aligned blocks; blocks and single
   * clusters are packed in columns in signal-flow order. Returns each cluster's translation.
   */
  function arrangeClusters(): Map<number, XY> {
    const out = new Map<number, XY>();
    const loose = clusters.filter((c) => !c.fixed && boxOfCluster.has(c.idx));
    if (!loose.length) return out;
    const partsOf = new Map<number, string[]>();
    for (const [p, c] of symCl) if (c >= 0) partsOf.set(c, [...(partsOf.get(c) ?? []), p]);
    const clusterOfPart = new Map<string, number>();
    for (const [c, ps] of partsOf) for (const p of ps) clusterOfPart.set(p, c);
    const size = (c: number) => {
      const b = boxOfCluster.get(c)!;
      return { w: b.x1 - b.x0, h: b.y1 - b.y0 };
    };
    // a geometric signature: the anchor's definition and every member's class, rotation and offset from the anchor
    const sig = (c: Cluster): string | undefined => {
      if (!c.anchor) return undefined;
      const a = syms.get(c.anchor)!;
      const list = (partsOf.get(c.idx) ?? []).map((p) => {
        const r = syms.get(p)!;
        return `${doc.parts.get(p)!.class}@${r.rotation}:${r.x - a.x},${r.y - a.y}`;
      });
      return `${doc.parts.get(c.anchor)!.part}|${list.sort().join(";")}`;
    };
    const sigs = new Map(loose.map((c) => [c.idx, sig(c)]));
    // links between clusters: a signal net whose pins in this card lie in exactly two clusters
    const linkNets = new Map<string, number[]>();
    for (const [name, n] of cls.nets) {
      if (n.cls === "ground" || n.cls === "rail") continue;
      const pins = n.pinsIn.get(card) ?? [];
      const cs = [...new Set(pins.map((k) => clusterOfPart.get(splitPinKey(k).part)).filter((x): x is number => x !== undefined))];
      if (cs.length >= 2) linkNets.set(name, cs);
    }
    const pinType = (k: string) => {
      const { part, pin } = splitPinKey(k);
      const p = doc.parts.get(part)!.pins.find((x) => x.id === pin)!;
      return { type: p.type, name: p.name };
    };
    const isOutPin = (k: string) => {
      const t = pinType(k);
      return t.type === "output" || /(^|[^A-Z])(D?OUT|DO|SDO|MISO|QH'?|Q7S|CO|TXD?)\d*$/i.test(t.name);
    };
    const isInPin = (k: string) => {
      const t = pinType(k);
      return t.type === "input" || /(^|[^A-Z])(D?IN|DI|SDI|MOSI|SER|DS|CI|RXD?)\d*$/i.test(t.name);
    };
    // ---- chains: identical clusters linked output to input
    const units: { members: number[]; w: number; h: number; pos: Map<number, XY>; key: string }[] = [];
    const used = new Set<number>();
    // chains link clusters of one anchor definition (the head and tail may carry extra parts); arrays need the
    // same drawing exactly
    const bySig = new Map<string, number[]>();
    for (const c of loose) {
      const s = sigs.get(c.idx);
      if (s) bySig.set(s.slice(0, s.indexOf("|")), [...(bySig.get(s.slice(0, s.indexOf("|"))) ?? []), c.idx]);
    }
    const anchorRef = (c: number) => opts.refs.get(clusters[c].anchor!) ?? clusters[c].anchor!;
    for (const [, group] of [...bySig].sort((a, b) => byCodeUnit(a[0], b[0]))) {
      if (group.length < 2) continue;
      const inGroup = new Set(group);
      const next = new Map<number, number>();
      const prev = new Map<number, number>();
      for (const [name, cs] of linkNets) {
        if (cs.length !== 2 || !cs.every((c) => inGroup.has(c))) continue;
        const pins = (cls.nets.get(name)!.pinsIn.get(card) ?? []).filter((k) => clusters[clusterOfPart.get(splitPinKey(k).part)!]?.anchor === splitPinKey(k).part || true);
        const outC = pins.filter(isOutPin).map((k) => clusterOfPart.get(splitPinKey(k).part)!);
        const inC = pins.filter(isInPin).map((k) => clusterOfPart.get(splitPinKey(k).part)!);
        let [a, b] = cs;
        if (outC.length === 1 && inC.length === 1 && outC[0] !== inC[0]) [a, b] = [outC[0], inC[0]];
        else if (natural(anchorRef(b), anchorRef(a)) < 0) [a, b] = [b, a];
        if (next.has(a) || prev.has(b)) continue;
        next.set(a, b);
        prev.set(b, a);
      }
      const chains: number[][] = [];
      for (const c of group.sort((x, y) => natural(anchorRef(x), anchorRef(y)))) {
        if (prev.has(c)) continue;
        const chain = [c];
        const seen = new Set([c]);
        while (next.has(chain[chain.length - 1]) && !seen.has(next.get(chain[chain.length - 1])!)) {
          const n = next.get(chain[chain.length - 1])!;
          chain.push(n);
          seen.add(n);
        }
        if (chain.length >= 2) chains.push(chain);
      }
      for (const chain of chains) {
        for (const c of chain) used.add(c);
        units.push({ ...grid(chain), key: `chain:${chain.length}` });
        patterns.push(`chain:${chain.length}`);
      }
      // ---- repeated channels: the rest of the group drawn exactly alike, as an aligned array
      const same = new Map<string, number[]>();
      for (const c of group.filter((x) => !used.has(x)).sort((x, y) => natural(anchorRef(x), anchorRef(y)))) same.set(sigs.get(c)!, [...(same.get(sigs.get(c)!) ?? []), c]);
      for (const [, rest] of [...same].sort((a, b) => byCodeUnit(a[0], b[0]))) {
        if (rest.length < 3) continue;
        for (const c of rest) used.add(c);
        units.push({ ...grid(rest), key: `array:${rest.length}` });
        patterns.push(`array:${rest.length}`);
      }
    }
    /** Members of one shape in rows of equal pitch (left to right, rows down), every member the same way round. */
    function grid(list: number[]) {
      // whole-unit pitches, so every member lands at the same offset in its cell
      const w = Math.ceil(Math.max(...list.map((c) => size(c).w)));
      const h = Math.ceil(Math.max(...list.map((c) => size(c).h)));
      const n = list.length;
      // columns for a block about twice as wide as tall, at most 8 per row
      let cols = 1;
      let bestCost = Infinity;
      for (let k = 1; k <= Math.min(8, n); k++) {
        const rows = Math.ceil(n / k);
        const aspect = (k * (w + CLUSTER_GAP)) / (rows * (h + CLUSTER_GAP));
        const cost = Math.abs(Math.log(aspect / 2)) + ((rows * k - n) / k) * 0.8;
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          cols = k;
        }
      }
      const pos = new Map<number, XY>();
      list.forEach((c, i) => {
        const b = boxOfCluster.get(c)!;
        const a = clusters[c].anchor ? syms.get(clusters[c].anchor!)! : undefined;
        // align on the anchor's origin (identical clusters line up exactly)
        const ref: XY = a ? [a.x - Math.floor(b.x0), a.y - Math.floor(b.y0)] : [0, 0];
        const refMax: XY = [Math.max(...list.map((x) => (clusters[x].anchor ? syms.get(clusters[x].anchor!)!.x - Math.floor(boxOfCluster.get(x)!.x0) : 0))), Math.max(...list.map((x) => (clusters[x].anchor ? syms.get(clusters[x].anchor!)!.y - Math.floor(boxOfCluster.get(x)!.y0) : 0)))];
        pos.set(c, [(i % cols) * (w + CLUSTER_GAP) + refMax[0] - ref[0], Math.floor(i / cols) * (h + CLUSTER_GAP + 1) + refMax[1] - ref[1]]);
      });
      const W = Math.max(...list.map((c) => pos.get(c)![0] + size(c).w));
      const H = Math.max(...list.map((c) => pos.get(c)![1] + size(c).h));
      return { members: list, w: W, h: H, pos };
    }
    for (const c of loose) if (!used.has(c.idx)) units.push({ members: [c.idx], ...size(c.idx), pos: new Map([[c.idx, [0, 0] as XY]]), key: `one:${c.idx}` });

    // ---- flow order: connectors first, then the longest path from the unit that drives each net
    const unitOf = new Map<number, number>();
    units.forEach((u, i) => u.members.forEach((c) => unitOf.set(c, i)));
    const edges = new Map<number, Set<number>>();
    for (const [name] of linkNets) {
      const pins = cls.nets.get(name)!.pinsIn.get(card) ?? [];
      const outs = pins.filter((k) => isOutPin(k) || pinType(k).type === "power_out");
      const drivers = new Set((outs.length ? outs : pins.filter((k) => doc.parts.get(splitPinKey(k).part)!.class === "connector")).map((k) => unitOf.get(clusterOfPart.get(splitPinKey(k).part)!)!));
      const all = new Set(pins.map((k) => unitOf.get(clusterOfPart.get(splitPinKey(k).part)!)!));
      for (const d of drivers) for (const t of all) if (d !== undefined && t !== undefined && d !== t) edges.set(d, new Set([...(edges.get(d) ?? []), t]));
    }
    const isConn = (u: number) => units[u].members.some((c) => clusters[c].anchor && doc.parts.get(clusters[c].anchor!)!.class === "connector");
    const rank = units.map(() => 0);
    for (let it = 0; it < units.length; it++) {
      let changed = false;
      for (const [a, bs] of edges)
        for (const b of bs) {
          if (edges.get(b)?.has(a) && !isConn(a)) continue;
          if (rank[a] + 1 > rank[b] && rank[a] + 1 < units.length) {
            rank[b] = rank[a] + 1;
            changed = true;
          }
        }
      if (!changed) break;
    }
    const order = units.map((_, i) => i).sort((a, b) => rank[a] - rank[b] || (isConn(b) ? 1 : 0) - (isConn(a) ? 1 : 0) || units[b].h * units[b].w - units[a].h * units[a].w || byCodeUnit(units[a].key, units[b].key));
    // ---- column packing: the column height that gives the most readable aspect
    const fixedBox = (() => {
      const bs = items.all.filter((x) => x.cl === FIXED || clusters[x.cl]?.fixed).map((x) => x.box);
      return bs.length ? unionBoxes(bs) : undefined;
    })();
    const total = order.reduce((s, u) => s + (units[u].w + CLUSTER_GAP) * (units[u].h + CLUSTER_GAP), 0);
    const tallest = Math.max(...order.map((u) => units[u].h));
    const cands = new Set<number>([tallest]);
    for (const f of [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5]) cands.add(Math.max(tallest, Math.round(Math.sqrt(total / 1.5) * f)));
    let best: { pos: Map<number, XY>; cost: number } | undefined;
    for (const H of [...cands].sort((a, b) => a - b)) {
      const pos = new Map<number, XY>();
      let x = 0;
      let y = 0;
      let colW = 0;
      let maxY = 0;
      let lastRank = -1;
      for (const u of order) {
        const U = units[u];
        // a new column when this one is full, or when the flow steps on and the column is already well filled
        if (y > 0 && (y + U.h > H || (rank[u] !== lastRank && y > 0.6 * H))) {
          x += colW + CLUSTER_GAP;
          y = 0;
          colW = 0;
        }
        pos.set(u, [x, y]);
        y += U.h + CLUSTER_GAP;
        colW = Math.max(colW, U.w);
        maxY = Math.max(maxY, y - CLUSTER_GAP);
        lastRank = rank[u];
      }
      const W = x + colW;
      const aspect = W / Math.max(1, maxY);
      const cost = W * maxY * (1 + 0.6 * Math.abs(Math.log(aspect / 1.4)));
      if (!best || cost < best.cost - 1e-9) best = { pos, cost };
    }
    // fixed content stays: when the main anchor moves, it lands where it was (the card's origin) and the rest packs
    // around it; when it is fixed, packed units go to the right of the fixed content
    let ox = 0;
    let oy = 0;
    const main = loose.find((c) => c.anchor === anchors[0]);
    if (fixedBox && main) {
      const u = unitOf.get(main.idx)!;
      const [ux, uy] = best!.pos.get(u)!;
      const [cx, cy] = units[u].pos.get(main.idx)!;
      const b = boxOfCluster.get(main.idx)!;
      const a = syms.get(main.anchor!)!;
      ox = -(ux + cx + (a.x - b.x0));
      oy = -(uy + cy + (a.y - b.y0));
    } else if (fixedBox) {
      ox = Math.ceil(fixedBox.x1) + CLUSTER_GAP;
      oy = Math.floor(fixedBox.y0);
    }
    for (const u of order) {
      const [ux, uy] = best!.pos.get(u)!;
      for (const c of units[u].members) {
        const [cx, cy] = units[u].pos.get(c)!;
        const b = boxOfCluster.get(c)!;
        out.set(c, [Math.round(ox + ux) + Math.round(cx) - Math.floor(b.x0), Math.round(oy + uy) + Math.round(cy) - Math.floor(b.y0)]);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- settle: what no pattern placed
  const rest = members.filter((m) => !placed.has(m)).sort(byCodeUnit);
  if (rest.length) settle(rest);

  function settle(paths: string[]) {
    const pos = new Map<string, XY>();
    const all = items.all.map((i) => i.box);
    const bb = all.length ? unionBoxes(all) : { x0: 0, y0: 0, x1: 0, y1: 0 };
    paths.forEach((m, i) => pos.set(m, [bb.x1 + 6, bb.y0 + i * 6]));
    const pinTargets = (m: string): { at: XY; w: number }[] => {
      const part = doc.parts.get(m)!;
      const out: { at: XY; w: number }[] = [];
      for (const p of part.pins) {
        const net = doc.pinNets.get(pinKey(m, p.id));
        if (!net || isRailNet(net)) continue;
        for (const k of doc.nets.get(net)!.pins) {
          const other = splitPinKey(k).part;
          if (other === m || !memberSet.has(other)) continue;
          const g = placed.get(other);
          if (g) {
            const pp = g.pins.find((x) => x.keys.includes(k));
            if (pp) out.push({ at: pp.at, w: 1 });
          } else if (pos.has(other)) out.push({ at: pos.get(other)!, w: 0.5 });
        }
      }
      return out;
    };
    for (let it = 0; it < 80; it++) {
      const step = 0.3 * (1 - it / 80) + 0.02;
      for (const m of paths) {
        const [x, y] = pos.get(m)!;
        let fx = 0;
        let fy = 0;
        for (const t of pinTargets(m)) {
          fx += t.w * (t.at[0] - x);
          fy += t.w * (t.at[1] - y);
        }
        for (const it2 of items.all) {
          const cx = (it2.box.x0 + it2.box.x1) / 2;
          const cy = (it2.box.y0 + it2.box.y1) / 2;
          const dx = x - cx;
          const dy = y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < 49 && d2 > 1e-6) {
            fx += (6 * dx) / d2;
            fy += (6 * dy) / d2;
          }
        }
        pos.set(m, [x + step * fx, y + step * fy]);
      }
    }
    for (const m of paths) {
      const [tx, ty] = pos.get(m)!;
      const part = doc.parts.get(m)!;
      // two-terminal parts on a rail face it
      let rot: Rotation = 0;
      if (part.pins.length === 2) {
        const railPin = part.pins.find((p) => isRailNet(doc.pinNets.get(pinKey(m, p.id))));
        if (railPin) rot = orient(part, railPin.id, isGroundNet(doc.pinNets.get(pinKey(m, railPin.id))) ? "down" : "up").rot;
      }
      const fixed = opts.fixed.get(m);
      if (fixed) {
        commit(m, fixed);
        continue;
      }
      let best: SymbolRecT | undefined;
      outer: for (let r = 0; r < 40; r++) {
        for (let dx = -r; dx <= r; dx++)
          for (const dy of r === 0 ? [0] : Math.abs(dx) === r ? range(-r, r) : [-r, r]) {
            const rec = mkRec(m, Math.round(tx) + dx, Math.round(ty) + dy, rot);
            if (free([...boxesOf(geom(rec)), inflateBox(geom(rec).full, 0.5)])) {
              best = rec;
              break outer;
            }
          }
      }
      commit(m, best ?? mkRec(m, Math.round(tx), Math.round(ty), rot));
    }
  }

  // ---------------------------------------------------------------- connect: every pin of every placed part
  const jobOfPinKey = new Set<string>();
  for (const j of jobs.values()) for (const t of j.terms) if (t.pin) jobOfPinKey.add(t.pin);
  for (const [path, g] of placed) {
    for (const p of g.pins) {
      const net = netOfPin(p);
      if (!net) {
        const part = g.part;
        const marked = p.keys.some((k) => part.pins.find((x) => pinKey(path, x.id) === k)?.type === "nc" || !!part.unconnected?.[splitPinKey(k).pin]);
        if (marked) for (const k of p.keys) ncs.add(k);
        continue;
      }
      const k = keyOf(p);
      if (direct.has(k) || jobOfPinKey.has(k)) continue;
      if (isRailNet(net)) {
        directPower(p);
        continue;
      }
      job(net, net, "signal").terms.push(term({ at: p.at, exit: p.dir, pin: k }));
      jobOfPinKey.add(k);
    }
  }
  // a signal job that leaves the card and has no label yet: label it at its first pin
  for (const j of jobs.values()) {
    if (j.kind !== "signal" || !crosses(j.net)) continue;
    if (labels.some((l) => l.net === j.net)) continue;
    const t = j.terms.find((x) => x.pin);
    if (!t) continue;
    if (j.terms.length === 1) {
      addLabel({ net: j.net, at: t.at, side: t.exit ?? "right", scope: "port" });
      j.terms = [];
      direct.add(t.pin!);
    } else {
      const v = dirVec(t.exit ?? "right");
      const at: XY = [t.at[0] + 2 * v[0], t.at[1] + 2 * v[1]];
      addLabel({ net: j.net, at, side: t.exit ?? "right", scope: "port" });
      j.terms.push(term({ at, exit: opposite(t.exit ?? "right") }));
    }
  }
  // a net leaving the card names itself once in it: when several clusters each labeled it, every pin of it in the
  // card is wired and one label stays, at a lane's end when there is one, else on a short stub from the first pin
  // (rule C08: no label islands inside a card; a label on a pin would block the pin's own wire)
  const labeledPorts = new Set(labels.filter((l) => l.scope === "port").map((l) => l.net));
  for (const net of [...labeledPorts].sort(byCodeUnit)) {
    const mine = labels.filter((l) => l.net === net);
    const same = (a: XY, b: XY) => a[0] === b[0] && a[1] === b[1];
    const existing = jobs.get(net);
    const laneEnd0 = existing ? mine.find((l) => existing.terms.some((t) => !t.pin && same(t.at, l.at))) : undefined;
    // one label and nothing else wired: fine; a wired piece without the label: join them
    if (mine.length < 2 && (laneEnd0 || !existing?.terms.some((t) => t.pin))) continue;
    const j = job(net, net, "signal");
    const laneEnd = laneEnd0;
    for (const l of mine) {
      if (l === laneEnd) continue;
      labels.splice(labels.indexOf(l), 1);
      if (j.terms.some((t) => !t.pin && same(t.at, l.at))) {
        j.terms = j.terms.filter((t) => t.pin || !same(t.at, l.at));
        continue;
      }
      for (const g of placed.values())
        for (const p of g.pins) {
          if (p.net !== net || !same(p.at, l.at)) continue;
          for (const k of p.keys) direct.delete(k);
          if (!j.terms.some((t) => t.pin === keyOf(p))) j.terms.push(term({ at: p.at, exit: p.dir, pin: keyOf(p) }));
        }
    }
    if (!laneEnd) {
      const t = j.terms.find((x) => x.pin);
      if (!t) continue;
      const side = t.exit ?? "right";
      const v = dirVec(side);
      let at: XY = [t.at[0] + 2 * v[0], t.at[1] + 2 * v[1]];
      for (let k = 2; k < 12; k++) {
        at = [t.at[0] + k * v[0], t.at[1] + k * v[1]];
        if (free([labelBox({ net, x: at[0], y: at[1], side, scope: "port" }, doc)], 0.1)) break;
      }
      addLabel({ net, at, side, scope: "port" });
      j.terms.push(term({ at, exit: opposite(side) }));
    }
  }

  // ---------------------------------------------------------------- route
  const contentBoxes = [...items.all.map((i) => i.box), ...fixedWires.flatMap((w) => w.points.map(([x, y]) => ({ x0: x, y0: y, x1: x, y1: y })))];
  const content = unionBoxes(contentBoxes);
  const grid = new Grid(inflateBox(content, 4));
  for (const g of placed.values()) {
    grid.wallBox(g.body, 0);
    grid.wallBox(g.ref, 0.1);
    if (g.value) grid.wallBox(g.value, 0.1);
  }
  for (const l of labels) grid.wallBox(labelBox({ net: l.net, x: l.at[0], y: l.at[1], side: l.side, scope: l.scope }, doc), 0.1);
  for (const p of powers) {
    const b = powerBoxes({ net: p.net, x: p.at[0], y: p.at[1], dir: p.dir, style: p.style }, doc);
    grid.wallBox(b.glyph, 0.1);
    if (b.text) grid.wallBox(b.text, 0.1);
  }
  // every pin owned: by its job, or by itself
  const jobOfPin = new Map<string, string>();
  for (const j of jobs.values()) for (const t of j.terms) if (t.pin) jobOfPin.set(t.pin, j.key);
  const fixedNetKey = (net: string) => `fixed:${net}`;
  for (const w of fixedWires) {
    grid.addWire(fixedNetKey(w.net), w.points);
    for (const p of w.points) grid.own(p, fixedNetKey(w.net));
  }
  for (const g of placed.values()) for (const p of g.pins) if (!fixedWires.some((w) => w.net === p.net && w.points.some((q) => q[0] === p.at[0] && q[1] === p.at[1]))) grid.own(p.at, jobOfPin.get(keyOf(p)) ?? `pin:${keyOf(p)}`);
  const termKey = (at: XY) => `${at[0]},${at[1]}`;
  const jobAt = new Map<string, string>();
  for (const j of jobs.values()) for (const t of j.terms) if (!t.pin) jobAt.set(termKey(t.at), j.key);
  for (const l of labels) grid.own(l.at, jobAt.get(termKey(l.at)) ?? `lbl:${l.net}`);
  for (const p of powers) if (!fixedWires.some((w) => w.net === p.net && w.points.some((q) => q[0] === p.at[0] && q[1] === p.at[1]))) grid.own(p.at, jobAt.get(termKey(p.at)) ?? `pwr:${p.net}`);

  const wires: { net: string; points: XY[] }[] = fixedWires.map((w) => ({ net: w.net, points: w.points }));
  const fallbacks: string[] = [];
  const ordered = [...jobs.values()].filter((j) => j.terms.length >= 2).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "rail" ? -1 : 1) || a.terms.length - b.terms.length || byCodeUnit(a.key, b.key));
  for (const j of ordered) {
    const r = routeNet(grid, j.key, j.terms);
    const tooBent = r.maxBends > opts.bendLimit;
    if (!r.failed.length && !tooBent) {
      for (const p of r.paths) wires.push({ net: j.net, points: p });
      continue;
    }
    grid.removeNet(j.key);
    fallbacks.push(j.net);
    // label each pin instead (a rail: a symbol on each pin)
    for (const t of j.terms) {
      if (!t.pin) {
        // drop the lane's own terminal
        const li = labels.findIndex((l) => l.at[0] === t.at[0] && l.at[1] === t.at[1] && l.net === j.net);
        if (li >= 0) labels.splice(li, 1);
        const pi = powers.findIndex((p) => p.at[0] === t.at[0] && p.at[1] === t.at[1] && p.net === j.net);
        if (pi >= 0) powers.splice(pi, 1);
        continue;
      }
      if (j.kind === "rail") powers.push({ net: j.net, at: t.at, ...railStyle(j.net), cl: FIXED });
      else labels.push({ net: j.net, at: t.at, side: t.exit ?? "right", scope: crosses(j.net) ? "port" : "local", cl: FIXED });
    }
  }

  // ---------------------------------------------------------------- tidy: power symbols and labels that landed on something
  // move out along their own direction on a stub of their net, to the first spot where they touch nothing and the
  // stub crosses nothing (a symbol on a pin that points its way, a fallback label on a pin, a lane's label)
  repairText();
  function repairText() {
    type Item = { kind: "label"; l: (typeof labels)[number] } | { kind: "power"; p: (typeof powers)[number] };
    const boxesOfItem = (it: Item): LBox[] => {
      if (it.kind === "label") return [labelBox({ net: it.l.net, x: it.l.at[0], y: it.l.at[1], side: it.l.side, scope: it.l.scope }, doc)];
      const b = powerBoxes({ net: it.p.net, x: it.p.at[0], y: it.p.at[1], dir: it.p.dir, style: it.p.style }, doc);
      return [b.glyph, ...(b.text ? [b.text] : [])];
    };
    const netOf = (it: Item) => (it.kind === "label" ? it.l.net : it.p.net);
    const solid: LBox[] = [];
    for (const g of placed.values()) solid.push(inflateBox(g.body, 0.05), g.ref, ...(g.value ? [g.value] : []));
    const allItems: Item[] = [...powers.map((p) => ({ kind: "power", p }) as Item), ...labels.map((l) => ({ kind: "label", l }) as Item)];
    const cache = new Map<Item, LBox[]>(allItems.map((it) => [it, boxesOfItem(it)]));
    const segList = wires.flatMap((w) => w.points.slice(1).map((b, i) => ({ net: w.net, a: w.points[i], b })));
    const segs = () => segList;
    const pinPts = [...placed.values()].flatMap((g) => g.pins.map((p) => ({ at: p.at, net: p.net })));
    const hitsBox = (b: LBox, self: Item, net: string) => {
      if (solid.some((x) => boxesOverlap(b, x, 0.1))) return true;
      for (const o of allItems) if (o !== self && cache.get(o)!.some((x) => boxesOverlap(b, x, 0.1))) return true;
      for (const sg of segs()) {
        const x0 = Math.min(sg.a[0], sg.b[0]);
        const x1 = Math.max(sg.a[0], sg.b[0]);
        const y0 = Math.min(sg.a[1], sg.b[1]);
        const y1 = Math.max(sg.a[1], sg.b[1]);
        if (x0 < b.x1 - 0.12 && x1 > b.x0 + 0.12 && y0 < b.y1 - 0.12 && y1 > b.y0 + 0.12 && (sg.net !== net || self.kind === "label")) return true;
      }
      return false;
    };
    const stubOk = (a: XY, b: XY, net: string, self: Item) => {
      const box: LBox = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
      const through = (x: LBox) => box.x0 < x.x1 - 0.05 && box.x1 > x.x0 + 0.05 && box.y0 < x.y1 - 0.05 && box.y1 > x.y0 + 0.05;
      const thin = inflateBox(box, 0.02);
      if (solid.some((x) => through(inflateBox(x, 0)) || boxesOverlap(thin, x, 0))) return false;
      for (const o of allItems) if (o !== self && cache.get(o)!.some((x) => boxesOverlap(thin, x, 0))) return false;
      // no other net's wire or pin on the stub, and the stub's far end on nothing
      for (const sg of segs()) {
        if (sg.net === net) continue;
        const sb: LBox = { x0: Math.min(sg.a[0], sg.b[0]), y0: Math.min(sg.a[1], sg.b[1]), x1: Math.max(sg.a[0], sg.b[0]), y1: Math.max(sg.a[1], sg.b[1]) };
        if (sb.x0 <= box.x1 && sb.x1 >= box.x0 && sb.y0 <= box.y1 && sb.y1 >= box.y0) return false;
      }
      for (const q of pinPts) if (q.net !== net && q.at[0] >= box.x0 && q.at[0] <= box.x1 && q.at[1] >= box.y0 && q.at[1] <= box.y1) return false;
      return true;
    };
    for (const it of allItems) {
      const net = netOf(it);
      if (!cache.get(it)!.some((b) => hitsBox(b, it, net))) continue;
      const at = it.kind === "label" ? it.l.at : it.p.at;
      const d: Dir = it.kind === "label" ? it.l.side : it.p.dir;
      const v = dirVec(d);
      for (let k = 1; k <= 12; k++) {
        const to: XY = [at[0] + k * v[0], at[1] + k * v[1]];
        const moved: Item = it.kind === "label" ? { kind: "label", l: { ...it.l, at: to } } : { kind: "power", p: { ...it.p, at: to } };
        if (boxesOfItem(moved).some((b) => hitsBox(b, it, net)) || !stubOk(at, to, net, it)) continue;
        wires.push({ net, points: [at, to] });
        segList.push({ net, a: at, b: to });
        if (it.kind === "label") it.l.at = to;
        else it.p.at = to;
        cache.set(it, boxesOfItem(it));
        break;
      }
    }
  }

  const symbols = [...syms.values()].sort((a, b) => byCodeUnit(a.id, b.id));
  const box = unionBoxes([
    ...[...placed.values()].flatMap((g) => [g.full, g.ref, ...(g.value ? [g.value] : [])]),
    ...labels.map((l) => labelBox({ net: l.net, x: l.at[0], y: l.at[1], side: l.side, scope: l.scope }, doc)),
    ...powers.flatMap((p) => {
      const b = powerBoxes({ net: p.net, x: p.at[0], y: p.at[1], dir: p.dir, style: p.style }, doc);
      return [b.glyph, ...(b.text ? [b.text] : [])];
    }),
    ...wires.flatMap((w) => w.points.map(([x, y]) => ({ x0: x, y0: y, x1: x, y1: y }))),
  ]);
  const strip = <T extends { cl: number }>(x: T): Omit<T, "cl"> => {
    const { cl: _cl, ...rest } = x;
    void _cl;
    return rest;
  };
  return { card, symbols, wires, labels: labels.map(strip), powers: powers.map(strip), noconnects: [...ncs].sort(byCodeUnit), box, fallbacks, patterns: [...new Set(patterns)].sort(byCodeUnit) };
}

/**
 * Whether the layout folds a part's unused pins (`hide_unused`): a generated symbol (not a pack symbol) with pins
 * on no net that UHD does not mark as left open.
 */
export function hideUnused(doc: SchematicDocument, path: string): boolean {
  const part = doc.parts.get(path);
  if (!part || resolveSymbol(part).family.startsWith("pack:")) return false;
  return part.pins.some((p) => p.type !== "nc" && !part.unconnected?.[p.id] && !doc.pinNets.has(pinKey(path, p.id)));
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export type { LabelRecT, PowerRecT, PlacedPin };
