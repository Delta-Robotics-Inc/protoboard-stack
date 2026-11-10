/**
 * The example project the extension carries: the 5-inch quadcopter of
 * `examples/quadcopter-5in`, copied into the build as
 * `dist/examples/quadcopter-5in` (esbuild.mjs) and into a folder of the
 * user's when they open it. Nothing here needs an account or a network: the
 * example holds its own parts, so it can be looked at signed out.
 *
 * No VS Code API here (start.ts asks where it goes and opens it).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

export const EXAMPLE = {
  id: "quadcopter-5in",
  title: "5-inch 6S quadcopter",
  text: "System diagram, 3D assembly and checks. Copied to a folder you choose.",
} as const;

/** Where the build puts the example, inside the extension. */
export const exampleSource = (extensionPath: string): string => join(extensionPath, "dist", "examples", EXAMPLE.id);

/** Whether this build carries the example (a build made with `--no-example` does not). */
export const hasExample = (extensionPath: string): boolean => existsSync(join(exampleSource(extensionPath), "protoboard.config.ts"));

/**
 * What of a project folder is never copied: what a build, an install or a
 * tool wrote there (the example's own `.gitignore` names the same), so a copy
 * is the committed project and nothing else.
 */
export function exampleSkips(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  const name = parts.at(-1)!;
  if (parts.includes("node_modules") || parts.includes("__pycache__")) return true;
  if (name.endsWith(".log")) return true;
  if (parts[0] === "build" || parts[0] === "release") return true;
  if (parts[0] === ".protoboard" && ["build", "cache", "local", "tools", "evals"].includes(parts[1] ?? "")) return true;
  if (parts[0] === ".claude" && parts[1] === "skills") return true;
  if (parts[0] === "parts" && parts[1] === "evidence" && parts[3] === ".research") return true;
  return false;
}

/**
 * A folder for the copy inside `parent`: the example's name, or that name
 * with the first free number when it is taken (`quadcopter-5in-2`). Never an
 * existing folder: a copy does not write into someone's files.
 */
export function exampleTarget(parent: string, exists: (p: string) => boolean = existsSync): string {
  const first = join(parent, EXAMPLE.id);
  if (!exists(first)) return first;
  for (let n = 2; ; n++) {
    const next = join(parent, `${EXAMPLE.id}-${n}`);
    if (!exists(next)) return next;
  }
}

export interface CopyResult {
  dir: string;
  files: number;
  bytes: number;
}

/** Copy a project folder (the carried example) to a folder that does not exist yet. */
export function copyExample(source: string, target: string): CopyResult {
  if (!existsSync(join(source, "protoboard.config.ts"))) throw new Error(`there is no example project at ${source}: this build of the extension does not carry one`);
  if (existsSync(target)) throw new Error(`${target} exists already: the example is copied into a new folder`);
  mkdirSync(target, { recursive: true });
  let files = 0;
  let bytes = 0;
  cpSync(source, target, {
    recursive: true,
    // links are not followed out of the example
    dereference: false,
    filter: (from) => {
      const rel = relative(source, from);
      if (!rel) return true;
      if (exampleSkips(rel)) return false;
      const st = statSync(from);
      if (st.isFile()) {
        files++;
        bytes += st.size;
      }
      return true;
    },
  });
  return { dir: target, files, bytes };
}

export interface PreviewPart {
  name: string;
  /** Who makes it, short. */
  maker: string;
  /** Its first category, as a word. */
  category: string;
  /** That category's top level, as a word (the preview's filters). */
  top: string;
}

const short = (maker: string) => maker.replace(/\s*\(.*\)\s*$/, "").trim();
/** Categories that are abbreviations keep their capitals. */
const ABBREVIATIONS = new Set(["gnss", "gps", "imu", "led", "rc", "rf", "usb", "pcb"]);
const word = (category: string) => {
  const leaf = category.split(/[/.]/).filter(Boolean).at(-1) ?? category;
  const s = leaf.replace(/[-_]+/g, " ").trim();
  if (ABBREVIATIONS.has(s.toLowerCase())) return s.toUpperCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

/**
 * The parts the example itself holds, as rows for the Library's preview
 * before a sign-in: their names, makers and categories, read from the
 * example's own files. They are the example's, shipped with it; nothing of
 * the hosted library is carried.
 */
export function exampleParts(source: string, limit = 9): PreviewPart[] {
  const dir = join(source, "parts", "catalog");
  if (!existsSync(dir)) return [];
  const rows: PreviewPart[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".json")) continue;
    try {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as { name?: unknown; manufacturer?: unknown; categories?: unknown };
      if (typeof d.name !== "string" || !d.name) continue;
      const cat = Array.isArray(d.categories) && typeof d.categories[0] === "string" ? d.categories[0] : "";
      rows.push({ name: d.name, maker: typeof d.manufacturer === "string" ? short(d.manufacturer) : "", category: word(cat), top: word(cat.split(".")[0] ?? "") });
    } catch {
      // a file that does not parse is not a row
    }
  }
  // one of each category first, so the preview shows the library's range, then the rest in order
  const seen = new Set<string>();
  const first = rows.filter((r) => (seen.has(r.category) ? false : (seen.add(r.category), true)));
  const rest = rows.filter((r) => !first.includes(r));
  return [...first, ...rest].slice(0, limit);
}

/** The folder's name as a title for messages. */
export const exampleName = (dir: string) => basename(dir.split(sep).join("/"));
