/**
 * KiCad's S-expression files (.kicad_pcb, .kicad_sch, .kicad_mod, .kicad_sym,
 * the netlist), read and written without a KiCad dependency. A node is an
 * atom (a bare token: `smd`, `0.4`, `yes`), a quoted string, or a list. Quoted
 * strings stay quoted on output, so a file read and written back means the
 * same to KiCad.
 */

export interface Str {
  str: string;
}
export type Atom = string | Str;
export type Node = Atom | List;
export interface List {
  items: Node[];
}

export const isList = (n: Node | undefined): n is List => !!n && typeof n === "object" && "items" in n;
export const isStr = (n: Node | undefined): n is Str => !!n && typeof n === "object" && "str" in n;
export const str = (s: string): Str => ({ str: s });
export const list = (...items: Node[]): List => ({ items });

/** The text of an atom or string; undefined for a list. */
export const text = (n: Node | undefined): string | undefined => (n === undefined || isList(n) ? undefined : typeof n === "string" ? n : n.str);

/** A list's head token (`footprint` in `(footprint "R_0402" …)`). */
export const head = (n: Node | undefined): string | undefined => (isList(n) ? text(n.items[0]) : undefined);

/** Direct children that are lists with this head. */
export const children = (n: List, name: string): List[] => n.items.filter((c): c is List => isList(c) && head(c) === name);
export const child = (n: List, name: string): List | undefined => n.items.find((c): c is List => isList(c) && head(c) === name);
/** The first value of a child (`(layer "F.Cu")` → `F.Cu`). */
export const valueOf = (n: List, name: string): string | undefined => {
  const c = child(n, name);
  return c ? text(c.items[1]) : undefined;
};
/** A `(property "Name" "value" …)` child's value. */
export const propertyNode = (n: List, name: string): List | undefined => children(n, "property").find((p) => text(p.items[1]) === name);
export const property = (n: List, name: string): string | undefined => text(propertyNode(n, name)?.items[2]);

/** Every list below `n` (depth first, `n` included) with this head. */
export function findAll(n: List, name: string, out: List[] = []): List[] {
  if (head(n) === name) out.push(n);
  for (const c of n.items) if (isList(c)) findAll(c, name, out);
  return out;
}

export class ParseError extends Error {}

/** Parse one S-expression document (the first top-level list). */
export function parse(src: string): List {
  let i = 0;
  const n = src.length;
  const stack: List[] = [];
  let root: List | undefined;
  while (i < n) {
    const c = src[i];
    if (c === "(") {
      const l: List = { items: [] };
      if (stack.length) stack[stack.length - 1].items.push(l);
      else if (!root) root = l;
      else throw new ParseError(`more than one top-level list (at offset ${i})`);
      stack.push(l);
      i++;
    } else if (c === ")") {
      if (!stack.length) throw new ParseError(`unbalanced ")" at offset ${i}`);
      stack.pop();
      i++;
    } else if (c === '"') {
      let s = "";
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) {
          const e = src[i + 1];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
          i += 2;
        } else s += src[i++];
      }
      if (i >= n) throw new ParseError("unterminated string");
      i++;
      if (!stack.length) throw new ParseError("a string outside any list");
      stack[stack.length - 1].items.push({ str: s });
    } else if (c === " " || c === "\n" || c === "\t" || c === "\r") i++;
    else {
      const start = i;
      while (i < n && !" \n\t\r()\"".includes(src[i])) i++;
      if (!stack.length) throw new ParseError(`a token outside any list at offset ${start}`);
      stack[stack.length - 1].items.push(src.slice(start, i));
    }
  }
  if (stack.length) throw new ParseError(`${stack.length} list(s) not closed`);
  if (!root) throw new ParseError("no S-expression");
  return root;
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

/**
 * Write a node: a list whose items are all atoms stays on one line, others
 * put each list child on its own line, indented by tabs (KiCad's own layout).
 */
export function print(n: Node, depth = 0): string {
  if (!isList(n)) return typeof n === "string" ? n : quote(n.str);
  const flat = n.items.every((c) => !isList(c));
  if (flat) return `(${n.items.map((c) => print(c)).join(" ")})`;
  const pad = "\t".repeat(depth + 1);
  let out = "(";
  let first = true;
  for (const c of n.items) {
    if (isList(c)) out += `\n${pad}${print(c, depth + 1)}`;
    else out += (first ? "" : " ") + print(c);
    first = false;
  }
  return `${out}\n${"\t".repeat(depth)})`;
}

export const printDocument = (n: List) => print(n) + "\n";
