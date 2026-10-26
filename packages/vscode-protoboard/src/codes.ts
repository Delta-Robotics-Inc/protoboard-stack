/**
 * What a diagnostic code means and what to do about it, from the installed
 * extensions' own references: the Markdown tables whose first column is
 * `Code` (ext-hardware's `diagnostic-codes.md`, the providers' READMEs, a
 * skill's code table). No VS Code API here.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface CodeEntry {
  code: string;
  /** `PB_EXTENSION_*`: every code with this prefix. */
  prefix: boolean;
  severity?: string;
  means?: string;
  todo?: string;
  /** Absolute file and 1-based line of the table row. */
  file: string;
  line: number;
}

export interface CodeReference {
  exact: Map<string, CodeEntry>;
  prefixes: CodeEntry[];
  files: string[];
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/**
 * The code tables of one Markdown file. A row's first cell names one or more
 * codes in backticks; `_SHORT` after `CIRCUIT_NET_OPEN` is `CIRCUIT_NET_SHORT`
 * (the last word replaced); `PB_EXTENSION_*` covers a prefix. The "means"
 * column is the one headed Means, When or Finding; "Do" is what to do.
 */
export function parseCodeTables(markdown: string, file: string): CodeEntry[] {
  const lines = markdown.split(/\r?\n/);
  const out: CodeEntry[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) continue;
    const head = cells(lines[i]).map((h) => h.toLowerCase());
    if (head[0] !== "code") continue;
    const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
    const sev = col("severity");
    const means = col("means", "when", "finding", "meaning");
    const todo = col("do", "fix", "what to do");
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const row = cells(lines[j]);
      let previous: string | undefined;
      for (const [, token] of row[0].matchAll(/`([A-Z_][A-Z0-9_]*\*?)`/g)) {
        let code = token;
        if (code.startsWith("_") && previous) code = previous.replace(/_[A-Z0-9]+$/, "") + code;
        previous = code.replace(/\*$/, "");
        out.push({
          code: code.replace(/\*$/, ""),
          prefix: code.endsWith("*"),
          severity: sev >= 0 ? row[sev] : undefined,
          means: means >= 0 ? row[means] : undefined,
          todo: todo >= 0 ? row[todo] : undefined,
          file,
          line: j + 1,
        });
      }
      i = j;
    }
  }
  return out;
}

/** Markdown files of an installed package that may hold code tables: its README and its skills' documents. */
export function referenceFiles(pkgDir: string, maxDepth = 4): string[] {
  const files: string[] = [];
  const readme = join(pkgDir, "README.md");
  if (existsSync(readme)) files.push(readme);
  const visit = (dir: string, depth: number) => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (depth < maxDepth && e !== "node_modules" && !e.startsWith(".")) visit(p, depth + 1);
      } else if (e.endsWith(".md")) files.push(p);
    }
  };
  visit(join(pkgDir, "skills"), 1);
  return files;
}

/** The installed `@protoboardai/*` packages a project sees: the nearest `node_modules` wins for each name, as Node resolves them. */
export function installedPackages(root: string): string[] {
  const seen = new Map<string, string>();
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const scope = join(dir, "node_modules", "@protoboardai");
    let names: string[] = [];
    try {
      names = readdirSync(scope);
    } catch {
      names = [];
    }
    for (const n of names.sort()) if (!seen.has(n)) seen.set(n, join(scope, n));
    if (dirname(dir) === dir) break;
  }
  return [...seen.values()];
}

/** Every code table the project's installed packages carry. The first entry for a code wins, the diagnostic-codes references before other tables. */
export function loadCodeReference(root: string, packages: string[] = installedPackages(root)): CodeReference {
  const ref: CodeReference = { exact: new Map(), prefixes: [], files: [] };
  // the diagnostic-codes references first: a skill's failure table (an SOP's) only fills codes they lack
  const all = packages.flatMap((pkg) => referenceFiles(pkg));
  const isReference = (f: string) => basename(f) === "diagnostic-codes.md";
  for (const file of [...all.filter(isReference), ...all.filter((f) => !isReference(f))]) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!/^\s*\|\s*Code\s*\|/m.test(text)) continue;
    ref.files.push(file);
    for (const e of parseCodeTables(text, file)) {
      if (e.prefix) ref.prefixes.push(e);
      else if (!ref.exact.has(e.code)) ref.exact.set(e.code, e);
    }
  }
  return ref;
}

/** The entry for a code: exact, else the longest prefix entry. */
export function lookupCode(ref: CodeReference | undefined, code: string): CodeEntry | undefined {
  if (!ref) return undefined;
  return ref.exact.get(code) ?? ref.prefixes.filter((p) => code.startsWith(p.code)).sort((a, b) => b.code.length - a.code.length)[0];
}
