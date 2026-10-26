/**
 * The typecheck step of part verification (PB-862): `tsc --noEmit` over the
 * root's tsconfig.json, so a part that only runs under tsx (which strips
 * types without checking them) cannot pass with type errors. Diagnostics in
 * the part's own files (its definition and anything under its folders) are
 * errors; diagnostics elsewhere are summed into one warning, since they are
 * not this part's to fix.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PartFiles } from "./layout.ts";

export interface TypecheckFinding {
  level: "error" | "warning";
  message: string;
}

/** The tsc of the root's own TypeScript, else the one ext-parts resolves. */
export function findTsc(root: string): string | undefined {
  const local = join(root, "node_modules", "typescript", "bin", "tsc");
  if (existsSync(local)) return local;
  for (const from of [join(root, "package.json"), import.meta.url]) {
    try {
      const pkg = createRequire(from).resolve("typescript/package.json");
      const bin = join(dirname(pkg), "bin", "tsc");
      if (existsSync(bin)) return bin;
    } catch {
      // not resolvable from here
    }
  }
  return undefined;
}

const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** Parse tsc's plain diagnostics (`file(line,col): error TSnnnn: message`). */
export function parseDiagnostics(out: string): { file: string; line: number; code: string; message: string }[] {
  return out
    .split(/\r?\n/)
    .map((l) => DIAGNOSTIC.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ file: m[1].split("\\").join("/"), line: Number(m[2]), code: m[4], message: m[5] }));
}

/** Whether a root-relative path is one of the part's own files. */
export function ownsFile(f: PartFiles, path: string): boolean {
  const p = path.replace(/^\.\//, "");
  return p === f.definition || [f.evidence, f.artifacts].some((d) => p.startsWith(`${d}/`)) || p === `library/cad/py/catalog/${f.id}.py`;
}

export function typecheckPart(f: PartFiles, opts: { tsc?: string } = {}): TypecheckFinding[] {
  if (!existsSync(join(f.root, "tsconfig.json"))) return [{ level: "warning", message: "no tsconfig.json at the root: the typecheck was skipped" }];
  const tsc = opts.tsc ?? findTsc(f.root);
  if (!tsc) return [{ level: "warning", message: "TypeScript (tsc) is not installed: the typecheck was skipped" }];
  const r = spawnSync(process.execPath, [tsc, "--noEmit", "-p", ".", "--pretty", "false"], { cwd: f.root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return [{ level: "warning", message: `tsc did not run: ${r.error.message}` }];
  const diags = parseDiagnostics(`${r.stdout}\n${r.stderr}`);
  if (r.status !== 0 && diags.length === 0) return [{ level: "warning", message: `tsc exited ${r.status} without diagnostics: ${(r.stderr || r.stdout).trim().slice(0, 300)}` }];
  const own = diags.filter((d) => ownsFile(f, d.file));
  const other = diags.length - own.length;
  return [
    ...own.map((d): TypecheckFinding => ({ level: "error", message: `${d.file}:${d.line} ${d.code} ${d.message}` })),
    ...(other ? [{ level: "warning" as const, message: `${other} type error(s) in other files of the root (not this part's): run the root's typecheck` }] : []),
  ];
}
