/**
 * KiCad custom rule conditions (the `(condition "...")` of a `.kicad_dru` rule) into the board document's rule
 * conditions (contract section 5, `applies.when`). The expression language is KiCad's published one: `&&`, `||`, `!`,
 * parentheses, comparisons of object properties (`A.Type == 'Via'`, `A.NetName != B.NetName`,
 * `A.Position_X > 95.3mm`) and functions (`A.intersectsCourtyard('U1')`, `A.enclosedByArea('X')`).
 *
 * Only the terms the board document can evaluate are mapped; any other term throws `UnsupportedCondition` naming
 * it, and the importer reports the whole rule as not evaluated. Mapped terms:
 *
 * - `X.Type == '<Via|Track|Arc|Pad|Zone|Footprint>'`, `X.Pad_Type == '<SMD|Through-hole|NPTH...>'`
 * - `X.NetClass == 'c'`, `X.hasNetclass('c')`, `X.NetName == 'n'`, `A.NetName == B.NetName`
 * - `X.Layer == '<copper layer>'`, `X.Pad_Number == 'n'`, `X.Reference == 'r'`, `X.memberOfFootprint('r or lib:name')`
 * - `X.intersectsCourtyard('r')`, `X.enclosedByArea('name')`, `X.intersectsArea('name')`
 * - `X.Position_X|Position_Y|Start_X|Start_Y|End_X|End_Y <op> <length>` (KiCad's Y runs down; the board's up)
 *
 * and `!=` of any of them as a negation.
 */
import type { AnyLayer, CopperLayer, RuleCondition } from "@protoboardai/board";
import { parseLength } from "./rules.js";

export class UnsupportedCondition extends Error {}

type Tok = { t: "id"; v: string } | { t: "str"; v: string } | { t: "num"; v: string } | { t: "op"; v: string };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const j = s.indexOf(c, i + 1);
      if (j < 0) throw new UnsupportedCondition(`unterminated string in ${s}`);
      out.push({ t: "str", v: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (["&&", "||", "==", "!=", "<=", ">="].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("()!<>,".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    const num = /^-?\d+(?:\.\d+)?(?:e-?\d+)?\s*(?:mm|mil|mils|in|um|nm)?/i.exec(s.slice(i));
    if (num && /[\d-]/.test(c)) {
      out.push({ t: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    throw new UnsupportedCondition(`cannot read "${s.slice(i, i + 12)}"`);
  }
  return out;
}

type Node =
  | { k: "and"; a: Node[] }
  | { k: "or"; a: Node[] }
  | { k: "not"; a: Node }
  | { k: "cmp"; op: string; l: Operand; r: Operand; text: string }
  | { k: "call"; obj: "A" | "B"; fn: string; args: string[]; text: string };
type Operand = { prop: string; obj: "A" | "B" } | { str: string } | { num: string };

function parse(s: string): Node {
  const toks = tokenize(s);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v !== undefined && t.v !== v)) throw new UnsupportedCondition(`expected ${v ?? "a term"} in ${s}`);
    p++;
    return t;
  };
  const operand = (): Operand => {
    const t = eat();
    if (t.t === "str") return { str: t.v };
    if (t.t === "num") return { num: t.v };
    if (t.t === "id") {
      const m = /^([AB])\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(t.v);
      if (m) return { prop: m[2], obj: m[1] as "A" | "B" };
    }
    throw new UnsupportedCondition(`term "${t.v}" not mapped`);
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new UnsupportedCondition(`incomplete condition ${s}`);
    if (t.t === "op" && t.v === "(") {
      eat("(");
      const n = or();
      eat(")");
      return n;
    }
    if (t.t === "op" && t.v === "!") {
      eat("!");
      return { k: "not", a: primary() };
    }
    const start = p;
    // a function call: A.fn('arg', ...)
    if (t.t === "id" && toks[p + 1]?.v === "(") {
      const m = /^([AB])\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(t.v);
      if (!m) throw new UnsupportedCondition(`function "${t.v}" not mapped`);
      eat();
      eat("(");
      const args: string[] = [];
      while (peek() && peek().v !== ")") {
        const a = eat();
        if (a.t !== "str" && a.t !== "num") throw new UnsupportedCondition(`argument "${a.v}" of ${t.v} not mapped`);
        args.push(a.v);
        if (peek()?.v === ",") eat(",");
      }
      eat(")");
      return { k: "call", obj: m[1] as "A" | "B", fn: m[2], args, text: toks.slice(start, p).map((x) => (x.t === "str" ? `'${x.v}'` : x.v)).join("") };
    }
    const l = operand();
    const op = peek();
    if (!op || op.t !== "op" || !["==", "!=", "<", ">", "<=", ">="].includes(op.v)) {
      // a bare property used as a boolean
      throw new UnsupportedCondition(`term "${"prop" in l ? `${l.obj}.${l.prop}` : JSON.stringify(l)}" not mapped`);
    }
    eat();
    const r = operand();
    return { k: "cmp", op: op.v, l, r, text: toks.slice(start, p).map((x) => (x.t === "str" ? `'${x.v}'` : x.v)).join(" ") };
  };
  const and = (): Node => {
    const a = [primary()];
    while (peek()?.v === "&&") {
      eat();
      a.push(primary());
    }
    return a.length === 1 ? a[0] : { k: "and", a };
  };
  const or = (): Node => {
    const a = [and()];
    while (peek()?.v === "||") {
      eat();
      a.push(and());
    }
    return a.length === 1 ? a[0] : { k: "or", a };
  };
  const n = or();
  if (p !== toks.length) throw new UnsupportedCondition(`unexpected "${toks[p].v}" in ${s}`);
  return n;
}

export interface ConditionContext {
  /** KiCad net class name to ours. */
  className: (kicad: string) => string;
  /** A KiCad copper layer name to ours (undefined when not a copper layer of the board). */
  copperOf: (kicadLayer: string) => CopperLayer | undefined;
}

const TYPES: Record<string, "via" | "track" | "pad" | "zone" | "footprint"> = { via: "via", track: "track", arc: "track", pad: "pad", zone: "zone", footprint: "footprint" };
const PAD_TYPES: Record<string, "smd" | "th" | "np"> = { smd: "smd", "through-hole": "th", "npth, mechanical": "np", npth: "np" };
const COORDS: Record<string, { coord: "x" | "y"; of: "at" | "start" | "end" }> = {
  position_x: { coord: "x", of: "at" },
  position_y: { coord: "y", of: "at" },
  start_x: { coord: "x", of: "start" },
  start_y: { coord: "y", of: "start" },
  end_x: { coord: "x", of: "end" },
  end_y: { coord: "y", of: "end" },
};
const FLIP: Record<string, string> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=", "==": "==", "!=": "!=" };

/** A KiCad condition expression as a rule condition (board frame before recentering: x = mm * 1e6, y = -mm * 1e6). */
export function kicadCondition(expr: string, ctx: ConditionContext): RuleCondition {
  return convert(parse(expr), ctx);
}

function convert(n: Node, ctx: ConditionContext): RuleCondition {
  if (n.k === "and" || n.k === "or") return n.k === "and" ? { all: n.a.map((x) => convert(x, ctx)) } : { any: n.a.map((x) => convert(x, ctx)) };
  if (n.k === "not") return { not: convert(n.a, ctx) };
  if (n.k === "call") {
    const side = n.obj;
    const arg = n.args[0];
    if (n.args.length !== 1) throw new UnsupportedCondition(`${n.text} not mapped`);
    switch (n.fn.toLowerCase()) {
      case "hasnetclass":
        return { side, class: [ctx.className(arg)] };
      case "intersectscourtyard":
        return { side, courtyard: [arg] };
      case "enclosedbyarea":
        return { side, area: [arg] };
      case "intersectsarea":
        return { side, area: [arg], touch: true };
      case "memberoffootprint":
        return { side, footprint: [arg] };
      default:
        throw new UnsupportedCondition(`${n.text} not mapped`);
    }
  }
  // comparisons: a property against a literal, or A.NetName against B.NetName
  let { l, r, op } = n;
  if (!("prop" in l) && "prop" in r) {
    [l, r] = [r, l];
    op = FLIP[op];
  }
  if (!("prop" in l)) throw new UnsupportedCondition(`${n.text} not mapped`);
  const neg = (c: RuleCondition): RuleCondition => (op === "!=" ? { not: c } : c);
  const prop = l.prop.toLowerCase();
  const side = l.obj;
  if ("prop" in r) {
    if (prop === "netname" && r.prop.toLowerCase() === "netname" && l.obj !== r.obj && (op === "==" || op === "!=")) return neg({ same_net: true });
    throw new UnsupportedCondition(`${n.text} not mapped`);
  }
  if (op === "==" || op === "!=") {
    if (!("str" in r)) throw new UnsupportedCondition(`${n.text} not mapped`);
    const v = r.str;
    switch (prop) {
      case "type": {
        const k = TYPES[v.toLowerCase()];
        if (!k) throw new UnsupportedCondition(`${n.text} not mapped (object type ${v})`);
        return neg({ side, kind: [k] });
      }
      case "pad_type": {
        const k = PAD_TYPES[v.toLowerCase()];
        if (!k) throw new UnsupportedCondition(`${n.text} not mapped (pad type ${v})`);
        return neg({ side, pad_type: [k] });
      }
      case "netclass":
        return neg({ side, class: [ctx.className(v)] });
      case "netname":
        return neg({ side, net: [v] });
      case "layer": {
        const layer = ctx.copperOf(v);
        if (!layer) throw new UnsupportedCondition(`${n.text} not mapped (not a copper layer of this board)`);
        return neg({ side, layer: [layer as AnyLayer] });
      }
      case "pad_number":
        return neg({ side, pad: [v] });
      case "reference":
        return neg({ side, footprint: [v] });
      default:
        throw new UnsupportedCondition(`${n.text} not mapped`);
    }
  }
  const c = COORDS[prop];
  if (!c) throw new UnsupportedCondition(`${n.text} not mapped`);
  const len = "num" in r ? parseLength(r.num) : "str" in r ? parseLength(r.str) : undefined;
  if (len === undefined) throw new UnsupportedCondition(`${n.text} not mapped (not a length)`);
  // KiCad's Y runs down: y_kicad > v is y_board < -v
  let o = op;
  let v = len;
  if (c.coord === "y") {
    o = FLIP[op];
    v = -len;
  }
  // integer nanometers: >= v is > v - 1, <= v is < v + 1
  if (o === ">") return { side, coord: c.coord, of: c.of, gt: v };
  if (o === ">=") return { side, coord: c.coord, of: c.of, gt: v - 1 };
  if (o === "<") return { side, coord: c.coord, of: c.of, lt: v };
  if (o === "<=") return { side, coord: c.coord, of: c.of, lt: v + 1 };
  throw new UnsupportedCondition(`${n.text} not mapped`);
}

/** Move every coordinate of a condition by (-dx, -dy) (recentering). */
export function shiftCondition(c: RuleCondition, dx: number, dy: number): RuleCondition {
  if ("all" in c) return { all: c.all.map((x) => shiftCondition(x, dx, dy)) };
  if ("any" in c) return { any: c.any.map((x) => shiftCondition(x, dx, dy)) };
  if ("not" in c) return { not: shiftCondition(c.not, dx, dy) };
  if ("coord" in c) {
    const d = c.coord === "x" ? dx : dy;
    return { ...c, ...(c.gt !== undefined ? { gt: c.gt - d } : {}), ...(c.lt !== undefined ? { lt: c.lt - d } : {}) };
  }
  return c;
}
