/**
 * The source step of part verification (PB-910): a library part ships its
 * TypeScript to projects (UHD library protocol § 4.6), so its file and every
 * library module it imports must pass UHD's lint for library source: static
 * imports of `@deltarobotics/uhd` and the closure only; no file system,
 * network, process, timers, eval or dynamic import. The library's build and
 * seed refuse to publish source that fails; this reports it while authoring.
 *
 * Library layout only: a project-researched part (`parts/local/`) is not
 * shipped as library source.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { lintSource, sourceImports } from "@deltarobotics/uhd/library";
import type { PartFiles } from "./layout.ts";

export interface SourceFinding {
  level: "error" | "warning";
  message: string;
}

/** The library file a relative specifier names, as TypeScript resolves it. */
function resolveOnDisk(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = /\.(m|c)?js$/.test(base) ? [base.replace(/\.(m|c)?js$/, (_, m: string | undefined) => `.${m ?? ""}ts`)] : /\.(m|c)?ts$/.test(base) ? [base] : [`${base}.ts`, join(base, "index.ts")];
  return candidates.find((c) => existsSync(c));
}

/** Lint the part's source closure: its file and the library modules it imports, paths relative to `library/`. */
export function lintPartSource(f: PartFiles): SourceFinding[] {
  if (f.layout !== "library") return [];
  const base = join(f.root, "library");
  const files = new Map<string, string>();
  const outside: string[] = [];
  const visit = (abs: string) => {
    const rel = relative(base, abs).split("\\").join("/");
    if (rel.startsWith("..")) return void outside.push(relative(f.root, abs));
    if (files.has(rel)) return;
    const text = readFileSync(abs, "utf8");
    files.set(rel, text);
    let imports: ReturnType<typeof sourceImports> = [];
    try {
      imports = sourceImports(text);
    } catch {
      return; // the lint reports the syntax
    }
    for (const i of imports) {
      if (!i.specifier.startsWith(".")) continue;
      const target = resolveOnDisk(abs, i.specifier);
      if (target) visit(target);
    }
  };
  visit(join(f.root, f.definition));
  const entry = relative(base, join(f.root, f.definition)).split("\\").join("/");
  return [
    ...outside.map((p) => ({ level: "error" as const, message: `imports ${p}, outside library/: library source imports only @deltarobotics/uhd and library modules` })),
    ...lintSource([...files].map(([path, text]) => ({ path, text })), entry).map((p) => ({
      level: "error" as const,
      message: `${p.path ? `library/${p.path}${p.line ? `:${p.line}` : ""} ` : ""}${p.code}: ${p.message} (projects vendor this source: keep it declarative)`,
    })),
  ];
}
