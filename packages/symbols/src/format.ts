/**
 * The one canonical text form of a symbol file, so a file's bytes depend only on its content: keys in a fixed
 * order, two-space indents, each pin and each body element on one line, a newline at the end. The checker fails a
 * file whose text differs from formatSymbol(JSON.parse(text)).
 */
import type { SymbolDef } from "./types.ts";

const TOP = [
  "schema",
  "id",
  "name",
  "category",
  "refdes",
  "convention",
  "origin",
  "frame",
  "pins",
  "body",
  "variants",
  "fields",
  "icon",
  "tags",
  "match",
  "license",
  "provenance",
  "notes",
];
const PIN = ["id", "name", "number", "pads", "at", "dir", "type", "names", "group"];
const ELEMENT = ["el", "d", "x1", "y1", "x2", "y2", "points", "cx", "cy", "r", "x", "y", "width", "height", "rx", "ry", "text", "anchor", "size", "role", "pin"];
const VARIANT = ["name", "convention", "frame", "pins", "body", "generator"];
const ORDERS: Record<string, string[]> = {
  "": TOP,
  frame: ["w", "h"],
  pin: PIN,
  element: ELEMENT,
  variant: VARIANT,
  field: ["at", "anchor"],
  fields: ["refdes", "value"],
  icon: ["from", "omitRoles"],
  match: ["keywords", "pinNames"],
  provenance: ["author", "date", "basis", "review"],
  generator: ["name", "args"],
};

/** Keys in the canonical order for their kind; unknown keys after, alphabetically. */
function ordered(obj: Record<string, unknown>, kind: string): [string, unknown][] {
  const order = ORDERS[kind] ?? [];
  const known = order.filter((k) => k in obj && obj[k] !== undefined);
  const rest = Object.keys(obj)
    .filter((k) => !order.includes(k) && obj[k] !== undefined)
    .sort();
  return [...known, ...rest].map((k) => [k, obj[k]]);
}

/** The kind of an object found under `key` in a parent of kind `parent` (drives key order). */
function kindOf(key: string, parent: string): string {
  if (key === "pins") return "pin";
  if (key === "body") return "element";
  if (parent === "variants") return "variant";
  if (parent === "fields") return "field";
  if (["frame", "fields", "icon", "match", "provenance", "generator"].includes(key)) return key;
  if (key === "variants") return "variants";
  return "other";
}

/** Compact one-line JSON with a space after colons and commas: `{ "el": "path", "d": "M2 12h3" }`. */
function inline(v: unknown, kind: string): string {
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => inline(x, kind)).join(", ")}]` : "[]";
  if (v && typeof v === "object") {
    const entries = ordered(v as Record<string, unknown>, kind);
    return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x, kindOf(k, kind))}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(v);
}

/** Pins and body elements are always one line each; other values are one line when short. */
function block(v: unknown, kind: string, indent: string, forceInlineItems: boolean): string {
  const inner = indent + "  ";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    if (forceInlineItems) return `[\n${v.map((x) => inner + inline(x, kind)).join(",\n")}\n${indent}]`;
    const one = inline(v, kind);
    if (indent.length + one.length <= 110) return one;
    return `[\n${v.map((x) => inner + block(x, kind, inner, false)).join(",\n")}\n${indent}]`;
  }
  if (v && typeof v === "object") {
    const entries = ordered(v as Record<string, unknown>, kind);
    if (!entries.length) return "{}";
    const one = inline(v, kind);
    if (kind !== "" && kind !== "variants" && kind !== "variant" && indent.length + one.length <= 110) return one;
    return `{\n${entries
      .map(([k, x]) => {
        const childKind = kindOf(k, kind);
        const force = k === "pins" || k === "body";
        return `${inner}${JSON.stringify(k)}: ${block(x, childKind, inner, force)}`;
      })
      .join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(v);
}

/** The canonical text of a symbol file. */
export function formatSymbol(def: SymbolDef | Record<string, unknown>): string {
  return block(def, "", "", false) + "\n";
}
