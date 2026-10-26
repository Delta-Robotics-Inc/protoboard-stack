/**
 * What the product is, stated by the project (PB-935): `docs/product.json`,
 * schema `protoboard.product/v0`. A small structured statement the
 * documents read, so the Manufacturing Package and the datasheet can open
 * with a page a person can read before the component detail: what the
 * device is, its features, what the system does (functions) and what it
 * must meet (requirements), each with how it is shown.
 *
 *     {
 *       "schema": "protoboard.product/v0",
 *       "summary": "Two or three sentences: what it is and who it is for.",
 *       "features": ["What a user gets, one line each"],
 *       "functions": [{ "id": "F1", "text": "What the system does", "by": "the parts that do it" }],
 *       "requirements": [{ "id": "R1", "text": "What it must meet", "how": "how it is shown", "pass": "the criterion", "record": "what is written down" }]
 *     }
 *
 * Requirements may instead stay in the brief (`docs/brief.md`), in a table
 * whose rows carry an ID or that sits under a Requirements or Targets
 * heading (columns How, Pass and Record say how each is shown): the
 * documents read that table when product.json states none. Functions
 * likewise: the brief's table under a Functions heading (ID, the function,
 * and a Hardware or By column for what does it) is read when product.json
 * lists none, and its rows are functions, not requirements. Nothing else is
 * read from prose, and nothing is invented: what the project has not
 * stated is reported as missing (`release --check` warns), and the page
 * says so.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PRODUCT_FILE = "docs/product.json";
export const PRODUCT_SCHEMA = "protoboard.product/v0";
/** Where requirements are read when product.json states none. */
export const BRIEF_FILES = ["docs/brief.md", "docs/requirements.md"];

export interface ProductFunction {
  id?: string;
  text: string;
  /** The parts or modules that do it. */
  by?: string;
}

export interface ProductRequirement {
  id?: string;
  text: string;
  /** How it is shown on the built product: a check, a test, an inspection. */
  how?: string;
  /** The pass criterion. */
  pass?: string;
  /** What is written down. */
  record?: string;
}

export interface ProductFile {
  schema: typeof PRODUCT_SCHEMA;
  summary?: string;
  features?: string[];
  functions?: ProductFunction[];
  requirements?: ProductRequirement[];
}

export type ProductPart = "summary" | "features" | "functions" | "requirements";

export const PRODUCT_PART_TEXT: Record<ProductPart, { title: string; missing: string }> = {
  summary: { title: "What it is", missing: "The project has not stated what the device is." },
  features: { title: "Features", missing: "The project has not stated the device's features." },
  functions: { title: "What it does", missing: "The project has not stated the system's functions." },
  requirements: { title: "Requirements", missing: "The project has not stated its requirements." },
};

/** What the project states about its product, and what it has not. */
export interface ProductStatement {
  /** docs/product.json exists. */
  file: boolean;
  summary?: string;
  features: string[];
  functions: ProductFunction[];
  requirements: ProductRequirement[];
  /** The file the requirements were read from (product.json, or the brief's table). */
  requirementsFrom?: string;
  /** The file the functions were read from (product.json, or the brief's Functions table). */
  functionsFrom?: string;
  /** The parts not stated, in the page's order. */
  missing: ProductPart[];
  /** What is wrong with docs/product.json (it is then not used). */
  problems: string[];
}

const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

/** What is wrong with a product file, or nothing. Empty members are allowed: they mean "not stated yet". */
export function productProblems(x: unknown): string[] {
  const p = x as Partial<ProductFile> | null;
  if (!p || typeof p !== "object" || Array.isArray(p) || p.schema !== PRODUCT_SCHEMA) return [`not a ${PRODUCT_SCHEMA} file`];
  const out: string[] = [];
  if (p.summary !== undefined && typeof p.summary !== "string") out.push("summary must be text");
  if (p.features !== undefined && !(Array.isArray(p.features) && p.features.every((f) => typeof f === "string"))) out.push("features must be a list of text lines");
  const rows = (k: "functions" | "requirements") => {
    const list = p[k];
    if (list === undefined) return;
    if (!Array.isArray(list)) return void out.push(`${k} must be a list`);
    list.forEach((r, i) => {
      if (!r || typeof r !== "object" || !text((r as { text?: unknown }).text)) out.push(`${k}[${i}] needs text`);
      else for (const [key, v] of Object.entries(r)) if (v !== undefined && typeof v !== "string") out.push(`${k}[${i}].${key} must be text`);
    });
    const ids = list.map((r) => (r as { id?: string })?.id).filter(Boolean);
    const twice = ids.find((id, i) => ids.indexOf(id) !== i);
    if (twice) out.push(`${k}: the id ${twice} is used twice`);
  };
  rows("functions");
  rows("requirements");
  return out;
}

/**
 * The project's statement of its product: docs/product.json, with the
 * requirements from the brief's table when the file states none.
 */
export function readProduct(root: string): ProductStatement {
  const out: ProductStatement = { file: false, features: [], functions: [], requirements: [], missing: [], problems: [] };
  const f = join(root, PRODUCT_FILE);
  if (existsSync(f)) {
    out.file = true;
    try {
      const data = JSON.parse(readFileSync(f, "utf8")) as ProductFile;
      out.problems = productProblems(data);
      if (!out.problems.length) {
        const s = text(data.summary);
        if (s) out.summary = s;
        out.features = (data.features ?? []).map((x) => x.trim()).filter(Boolean);
        const row = <T extends { text: string }>(r: T): T => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v !== "" && v !== undefined)) as T;
        out.functions = (data.functions ?? []).map(row);
        if (out.functions.length) out.functionsFrom = PRODUCT_FILE;
        out.requirements = (data.requirements ?? []).map(row);
        if (out.requirements.length) out.requirementsFrom = PRODUCT_FILE;
      }
    } catch (e) {
      out.problems = [`not JSON: ${(e as Error).message}`];
    }
  }
  const brief = BRIEF_FILES.find((b) => existsSync(join(root, b)));
  const isFunction = (r: BriefRequirement) => /^(system )?functions?$/i.test(r.section);
  const rows = brief && (!out.functions.length || !out.requirements.length) ? briefRequirements(readFileSync(join(root, brief), "utf8")).filter((r) => r.from === "table") : [];
  if (!out.functions.length) {
    // the brief's Functions table: what the system does and what does it
    const fns = rows.filter(isFunction);
    if (fns.length) {
      out.functions = fns.map((r) => ({ ...(r.id ? { id: r.id } : {}), text: r.title, ...(r.by ? { by: r.by } : {}) }));
      out.functionsFrom = brief!;
    }
  }
  if (!out.requirements.length) {
    // the brief's tables only (rows with an ID, or under a requirements heading); a function is not a requirement too
    const functions = new Set(out.functions.map((x) => x.id).filter(Boolean));
    const reqs = rows.filter((r) => !isFunction(r) && !(r.id && functions.has(r.id)));
    if (reqs.length) {
      // only what the brief itself says about how each is shown; a method guessed from the wording is the test plan's, not the project's statement
      out.requirements = reqs.map((r) => ({ ...(r.id ? { id: r.id } : {}), text: r.text, ...(r.stated.how ? { how: r.how } : {}), ...(r.stated.pass ? { pass: r.pass } : {}), ...(r.stated.record ? { record: r.record } : {}) }));
      out.requirementsFrom = brief!;
    }
  }
  out.missing = (["summary", "features", "functions", "requirements"] as const).filter((k) => (k === "summary" ? !out.summary : !out[k].length));
  return out;
}

// ---------------------------------------------------------------------------
// Requirements in a brief (docs/brief.md)
// ---------------------------------------------------------------------------

export interface BriefRequirement {
  id?: string;
  title: string;
  text: string;
  how: string;
  pass: string;
  record: string;
  /** A table row, or a bullet of a requirements section. */
  from: "table" | "bullet";
  /** The heading it sits under. */
  section: string;
  /** What does it, when the table says (a Hardware, By or Parts column of a Functions table). */
  by?: string;
  /** Which of how, pass and record the brief itself states (a table's How, Pass and Record columns); the rest follow the wording. */
  stated: { how: boolean; pass: boolean; record: boolean };
}

/**
 * Requirements from a brief in Markdown: rows of tables whose first column
 * is an ID (F1, R2, …), rows of a "Targets"/"Requirements" table, and the
 * bullet items of the brief's top level and its requirement sections. A
 * table's How, Pass and Record columns, when it has them, say how each row
 * is shown; otherwise the method follows the wording: a number with a unit
 * is measured, a part or a process is inspected, anything else is
 * demonstrated.
 */
export function briefRequirements(md: string): BriefRequirement[] {
  const out: BriefRequirement[] = [];
  let section = "";
  let level = 0;
  const lines = md.split(/\r?\n/);
  const REQ = /target|requirement|function|acceptance|constraint/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      level = h[1].length;
      section = h[2].trim();
      continue;
    }
    if (/^\|/.test(line) && /^\|[\s:-]+\|/.test(lines[i + 1] ?? "")) {
      const cells = (l: string) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line).map((c) => c.toLowerCase());
      const idCol = head[0] === "id" ? 0 : -1;
      const reqSection = REQ.test(section);
      // a table may say how each requirement is shown: columns How (or Method, Verification), Pass (or
      // Acceptance, Criterion) and Record; they replace the method guessed from the wording
      const col = (re: RegExp) => head.findIndex((h, k) => k > (idCol === 0 ? 1 : 0) && re.test(h));
      const howCol = col(/^(how|method|verification|verified by|test)$/);
      const passCol = col(/^(pass|acceptance|criterion|pass criterion)$/);
      const recordCol = col(/^record$/);
      const byCol = col(/^(hardware|by|done by|parts?|modules?|implemented by)$/);
      const own = new Set([howCol, passCol, recordCol].filter((k) => k >= 0));
      i += 2;
      for (; i < lines.length && /^\|/.test(lines[i]); i++) {
        if (idCol < 0 && !reqSection) continue;
        const c = cells(lines[i]);
        const id = idCol === 0 ? c[0] : undefined;
        const title = idCol === 0 ? c[1] : c[0];
        const value = c
          .slice(idCol === 0 ? 2 : 1, idCol === 0 ? undefined : 2)
          .filter((_, k) => !own.has(k + (idCol === 0 ? 2 : 1)))
          .join(" · ");
        const r = method({ id, title: strip(title), text: strip(value ? `${title}: ${value}` : title), from: "table", section });
        if (howCol >= 0 && c[howCol]) (r.how = strip(c[howCol])), (r.stated.how = true);
        if (passCol >= 0 && c[passCol]) (r.pass = strip(c[passCol])), (r.stated.pass = true);
        if (recordCol >= 0 && c[recordCol]) (r.record = strip(c[recordCol])), (r.stated.record = true);
        if (byCol >= 0 && c[byCol]) r.by = strip(c[byCol]);
        out.push(r);
      }
      i--;
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    // bullets of the brief's own top level (under its title) and of requirement sections
    if (li && (level <= 1 || REQ.test(section))) {
      let text = li[1];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) text += " " + lines[++i].trim();
      out.push(method({ title: strip(text).split(/[.;:]/)[0].slice(0, 60), text: strip(text), from: "bullet", section }));
    }
  }
  return out;
}

const strip = (s: string) => s.replace(/\*\*|`|\[([^\]]*)\]\([^)]*\)/g, (_m, t) => t ?? "").replace(/\s+/g, " ").trim();

function method(r: { id?: string; title: string; text: string; from: "table" | "bullet"; section: string }): BriefRequirement {
  const measured = /\d\s*(mm|g|kg|v|a|ma|mah|w|h|s|ms|days?|°c|%|kv|hz|khz|mhz|ghz|db|n)\b/i.test(r.text) || /[≥≤<>]/.test(r.text);
  const inspected = /\b(fabricat|assembl|made|printed|cut|part|purchased|frame|case|board|module|connector|strap)\w*/i.test(r.text);
  return {
    ...r,
    how: measured ? "Measure, with the instrument the value calls for" : inspected ? "Inspect the built unit against the requirement" : "Demonstrate on the built product",
    pass: measured ? "the measured value meets the requirement as stated" : "the requirement is met as stated",
    record: measured ? "measured value, instrument, conditions" : "pass or fail, with a note or photo",
    stated: { how: false, pass: false, record: false },
  };
}
