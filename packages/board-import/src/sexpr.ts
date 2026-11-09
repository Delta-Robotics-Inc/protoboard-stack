/**
 * A small S-expression reader for KiCad files (`.kicad_pcb`, `.kicad_dru`). Lists are arrays whose first item is
 * the head; atoms are strings (quoted or not: KiCad's grammar does not depend on the difference here). Each list
 * carries the line it starts on, for import reports. `#` starts a comment to the end of the line outside strings
 * (the `.kicad_dru` grammar; board files have none).
 */

export type SNode = string | SList;
export interface SList extends Array<SNode> {
  line?: number;
}

export class SexprError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`);
    this.name = "SexprError";
  }
}

/** Parse the text into its top-level lists (a board file has one: `(kicad_pcb ...)`). */
export function parseSexprAll(src: string, options: { comments?: boolean } = {}): SList[] {
  const n = src.length;
  const top: SList[] = [];
  const stack: SList[] = [];
  let line = 1;
  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 10) {
      line++;
      i++;
    } else if (c === 40) {
      const list: SList = [];
      list.line = line;
      if (stack.length) stack[stack.length - 1].push(list);
      else top.push(list);
      stack.push(list);
      i++;
    } else if (c === 41) {
      if (!stack.length) throw new SexprError(line, "unbalanced ')'");
      stack.pop();
      i++;
    } else if (c === 34) {
      let j = i + 1;
      let s = "";
      let start = j;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (d === 92) {
          s += src.slice(start, j);
          const e = src[j + 1];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : (e ?? "");
          j += 2;
          start = j;
          continue;
        }
        if (d === 34) break;
        if (d === 10) line++;
        j++;
      }
      if (j >= n) throw new SexprError(line, "unterminated string");
      s += src.slice(start, j);
      if (!stack.length) throw new SexprError(line, "a string outside any list");
      stack[stack.length - 1].push(s);
      i = j + 1;
    } else if (c === 35 && options.comments) {
      while (i < n && src.charCodeAt(i) !== 10) i++;
    } else if (c <= 32) {
      i++;
    } else {
      let j = i;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (d <= 32 || d === 40 || d === 41) break;
        j++;
      }
      if (!stack.length) throw new SexprError(line, "an atom outside any list");
      stack[stack.length - 1].push(src.slice(i, j));
      i = j;
    }
  }
  if (stack.length) throw new SexprError(line, `${stack.length} list(s) not closed at the end of the file`);
  return top;
}

/** Parse a file that holds one top-level list. */
export function parseSexpr(src: string): SList {
  const all = parseSexprAll(src);
  if (all.length !== 1) throw new SexprError(1, `expected one top-level list, found ${all.length}`);
  return all[0];
}

export const isList = (n: SNode | undefined): n is SList => Array.isArray(n);
export const head = (n: SNode | undefined): string | undefined => (isList(n) && typeof n[0] === "string" ? n[0] : undefined);
/** The child lists of `l` with this head. */
export const kids = (l: SList, name: string): SList[] => l.filter((x): x is SList => isList(x) && x[0] === name);
/** The first child list of `l` with this head. */
export const kid = (l: SList | undefined, name: string): SList | undefined => l?.find((x): x is SList => isList(x) && x[0] === name);
/** An atom as a string (a list gives undefined). */
export const str = (n: SNode | undefined): string | undefined => (typeof n === "string" ? n : undefined);
/** The first atom of a child list: `(layer "F.Cu")` gives `F.Cu`. */
export const val = (l: SList | undefined, name: string): string | undefined => str(kid(l, name)?.[1]);
/** A number atom (NaN when absent or not a number). */
export const num = (n: SNode | undefined): number => (typeof n === "string" ? Number(n) : Number.NaN);
/** The first atom of a child list as a number. */
export const numOf = (l: SList | undefined, name: string): number | undefined => {
  const v = num(kid(l, name)?.[1]);
  return Number.isFinite(v) ? v : undefined;
};
/** `(x y)` of a child list such as `(at 1 2 90)`: [x, y]. */
export const xyOf = (l: SList | undefined): [number, number] | undefined => {
  if (!l) return undefined;
  const x = num(l[1]);
  const y = num(l[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
};
/**
 * A yes/no flag in any of KiCad's spellings: `(locked yes)`, `(locked)`, or a bare atom `locked` among the items
 * (KiCad 7). `(locked no)` is false.
 */
export function flag(l: SList, name: string): boolean {
  for (const x of l) {
    if (x === name) return true;
    if (isList(x) && x[0] === name) {
      const v = x[1];
      return v === undefined || v === "yes" || v === "true";
    }
  }
  return false;
}
/** The atoms of a child list after its head: `(layers "F.Cu" "B.Cu")` gives both names. */
export const atomsOf = (l: SList | undefined, name: string): string[] => (kid(l, name)?.slice(1).filter((x): x is string => typeof x === "string") ?? []);
