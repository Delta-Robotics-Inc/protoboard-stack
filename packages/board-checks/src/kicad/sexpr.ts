/**
 * A small S-expression reader for KiCad board files (the published `.kicad_pcb` format), enough to read each
 * footprint's reference and position. The cross-check uses it to find the transform between KiCad's
 * coordinates (millimeters, +Y down, page origin) and the board document's (nanometers, +Y up, centered) when the
 * importer does not state it.
 */

export type SExpr = string | SExpr[];

/** Parse S-expression text into nested arrays of atoms (quoted strings are unquoted). */
export function parseSExpr(text: string): SExpr[] {
  const root: SExpr[] = [];
  const stack: SExpr[][] = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === "(") {
      const list: SExpr[] = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
    } else if (ch === ")") {
      if (stack.length > 1) stack.pop();
      i++;
    } else if (ch === '"') {
      let j = i + 1;
      let s = "";
      while (j < n && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < n) {
          const e = text[j + 1];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e;
          j += 2;
        } else s += text[j++];
      }
      stack[stack.length - 1].push(s);
      i = j + 1;
    } else if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") i++;
    else {
      let j = i;
      while (j < n && !" \n\r\t()".includes(text[j])) j++;
      stack[stack.length - 1].push(text.slice(i, j));
      i = j;
    }
  }
  return root;
}

const head = (e: SExpr): string | undefined => (Array.isArray(e) && typeof e[0] === "string" ? e[0] : undefined);
const child = (e: SExpr[], name: string): SExpr[] | undefined => e.find((c) => head(c) === name) as SExpr[] | undefined;

export interface KicadFootprintPlacement {
  ref: string;
  /** Millimeters, KiCad's frame (+Y down). */
  x: number;
  y: number;
  rotation: number;
  layer?: string;
}

/** The reference and position of every footprint in a `.kicad_pcb` text (KiCad 6 and later, and KiCad 5's `module`). */
export function readKicadPlacements(text: string): KicadFootprintPlacement[] {
  const top = parseSExpr(text).find((e) => head(e) === "kicad_pcb") as SExpr[] | undefined;
  if (!top) return [];
  const out: KicadFootprintPlacement[] = [];
  for (const e of top) {
    const h = head(e);
    if (h !== "footprint" && h !== "module") continue;
    const fp = e as SExpr[];
    const atNode = child(fp, "at");
    if (!atNode) continue;
    let ref: string | undefined;
    for (const c of fp) {
      if (head(c) === "property" && (c as SExpr[])[1] === "Reference") ref = String((c as SExpr[])[2]);
      if (head(c) === "fp_text" && (c as SExpr[])[1] === "reference") ref = String((c as SExpr[])[2]);
    }
    if (!ref) continue;
    const layerNode = child(fp, "layer");
    out.push({ ref, x: Number(atNode[1]), y: Number(atNode[2]), rotation: Number(atNode[3] ?? 0), ...(layerNode ? { layer: String(layerNode[1]) } : {}) });
  }
  return out;
}
