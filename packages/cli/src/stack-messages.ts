/**
 * What `protoboard stack link` says beyond the link summary (F04).
 */
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";

/**
 * What `stack link` says of the packages package.json names that no stack copy
 * provides (F04): which the project's own files import, and which nothing
 * imports (leftovers, such as a tool's dependencies from before the project
 * was a Protoboard one). Never "npm install": AGENTS.md tells agents not to
 * run npm in a stack-linked project.
 */
export function notProvidedLines(root: string, names: string[]): string[] {
  if (!names.length) return [];
  // the TypeScript pin (catalog parts' sources are checked against it) and type packages are kept on purpose
  const tooling = names.filter((n) => n === "typescript" || n.startsWith("@types/"));
  const rest = names.filter((n) => !tooling.includes(n));
  const used = importedPackages(root, rest);
  const unused = rest.filter((n) => !used.has(n));
  return [
    ...(tooling.length ? [`kept in package.json for type checking, not linked: ${tooling.join(", ")}`] : []),
    ...(used.size ? [`not provided by the Protoboard stack, and imported by the project's files: ${[...used].sort().join(", ")}. Ask the person how the project should get them; do not run npm in a stack-linked project`] : []),
    ...(unused.length ? [`not provided by the Protoboard stack, and imported by none of the project's files: ${unused.join(", ")}. Probably leftovers: remove them from package.json`] : []),
  ];
}

/** Which of `names` a source file of the project imports or requires (node_modules, .protoboard, operations and release left out). */
export function importedPackages(root: string, names: string[]): Set<string> {
  const found = new Set<string>();
  const skip = new Set(["node_modules", ".protoboard", "operations", "release", ".git"]);
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.size === names.length) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name) && !e.name.startsWith(".")) walk(p);
      } else if (/\.(c|m)?(t|j)sx?$/.test(e.name)) {
        const text = readFileSync(p, "utf8");
        for (const n of names) if (!found.has(n) && new RegExp(`(from|import|require)\\s*\\(?\\s*["'\`]${n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(/[^"'\`]*)?["'\`]`).test(text)) found.add(n);
      }
    }
  };
  walk(root);
  return found;
}

