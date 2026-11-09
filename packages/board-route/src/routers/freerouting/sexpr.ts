/** A small reader and writer for Specctra's parenthesized format (DSN and SES files). */

export type SNode = string | SNode[];

/** Parse one or more expressions. Strings in double quotes keep their spaces; `(string_quote ")` is understood. */
export function parseSExpr(text: string): SNode[] {
  const out: SNode[] = [];
  const stack: SNode[][] = [out];
  let i = 0;
  let quote = '"';
  let lastAtom = "";
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === "(") {
      const list: SNode[] = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
      lastAtom = "";
    } else if (ch === ")") {
      if (stack.length === 1) throw new Error(`unbalanced ')' at offset ${i}`);
      stack.pop();
      i++;
      lastAtom = "";
    } else if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") i++;
    else if (lastAtom === "string_quote") {
      // the quote character itself, unquoted
      quote = ch;
      stack[stack.length - 1].push(ch);
      i++;
      lastAtom = "";
    } else if (ch === quote) {
      const end = text.indexOf(quote, i + 1);
      if (end < 0) throw new Error(`unterminated string at offset ${i}`);
      stack[stack.length - 1].push(text.slice(i + 1, end));
      i = end + 1;
      lastAtom = "";
    } else {
      let j = i;
      while (j < n && !" \t\r\n()".includes(text[j])) j++;
      const atom = text.slice(i, j);
      stack[stack.length - 1].push(atom);
      lastAtom = atom;
      i = j;
    }
  }
  if (stack.length !== 1) throw new Error("unbalanced '(': the file ends inside an expression");
  return out;
}

/** The first child list whose head is `name`. */
export function child(node: SNode | undefined, name: string): SNode[] | undefined {
  if (!Array.isArray(node)) return undefined;
  for (const c of node) if (Array.isArray(c) && c[0] === name) return c;
  return undefined;
}

/** Every child list whose head is `name`. */
export function children(node: SNode | undefined, name: string): SNode[][] {
  if (!Array.isArray(node)) return [];
  return node.filter((c): c is SNode[] => Array.isArray(c) && c[0] === name);
}

/** Quote a name for writing: always quoted; names with a quote character must be aliased by the caller. */
export function q(name: string): string {
  if (name.includes('"')) throw new Error(`a Specctra name cannot hold a double quote: ${name}`);
  return `"${name}"`;
}

/** A number in the file's unit (micrometers at resolution 10: one decimal). */
export function num(value: number, decimals = 1): string {
  const r = Number(value.toFixed(decimals));
  return Object.is(r, -0) ? "0" : String(r);
}
