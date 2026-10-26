/**
 * Definition source of catalog parts (PB-910; UHD library protocol § 4.6):
 * libraries ship each part's `.uhd.ts` and the library modules it imports,
 * the way an npm package ships its code. `parts add` vendors them beside
 * the definition JSON (`parts/catalog/<id>/<id>.uhd.ts`, helpers beside it);
 * loading evaluates them, confined (never in this process); `check`
 * reports a source that no longer evaluates to the pinned definition digest
 * (an edited vendored part) and requirement ranges the project's UHD or
 * TypeScript do not meet.
 *
 * The definition JSON stays the pinned contract: what the project builds
 * with is the same definition either way, and `--compiled` vendors only it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { lintSource, minVersion, satisfiesRange, type SourceProblem } from "@deltarobotics/uhd/library";
import { evaluateSourceConfined } from "@deltarobotics/uhd/library/confined";
import type { ModuleDef } from "@deltarobotics/uhd";
import { packageRoot, sha256 } from "./load.js";
import type { ProjectDiagnostic, SourceLocation } from "./types.js";
import { projectRelative } from "./paths.js";

/** The definition source vendored with a catalog revision, as parts/origins.json records it. */
export interface VendoredSource {
  /** The module the definition is evaluated from, under the artifact base (`<id>.uhd.ts`). */
  entry: string;
  /** Its export holding the definition. */
  export: string;
  /** What the source needs, as the library declared it: version ranges. */
  requires: { uhd: string; typescript: string };
  /** Every file of the closure: path under the artifact base → sha256 when vendored. */
  files: Record<string, string>;
}

/** The lint of § 4.6.2 over source about to be vendored. */
export const lintVendoredSource = (files: { path: string; text: string }[], entry: string): SourceProblem[] => lintSource(files, entry);

const VALIDATOR = "protoboard/catalog";
const UHD_PACKAGE = "@deltarobotics/uhd";

/**
 * Older UHD minor lines whose definitions a UHD line reads unchanged, from UHD's own changelog: 0.3.0
 * only widened the schema ("Definitions written for 0.2.x are valid 0.3.0 definitions unchanged"; the
 * one break is to TypeScript that reads `export.from.child`, which declarative library source does not).
 * A part's source declares the line it was written for (`^0.2.0`), as an npm range would; semver
 * keeps a 0.x range to one minor line, so without this every catalog part would refuse UHD 0.3.0.
 */
const uhdReadsLines: Record<string, string[]> = { "0.3": ["0.2"] };

const minorLine = (v: string) => v.split(".").slice(0, 2).join(".");

/**
 * Whether the installed UHD runs a part's source that declares `range`: it satisfies the range, or the
 * range is written for an older minor line the installed line reads unchanged (`uhdReadsLines`).
 */
export function uhdRunsSource(installed: string, range: string): boolean {
  if (satisfiesRange(installed, range)) return true;
  const low = minVersion(range);
  return !!low && (uhdReadsLines[minorLine(installed)] ?? []).includes(minorLine(low));
}

/** The definition file form: sorted keys, two-space indent, final newline (build.ts `stableStringify`; kept here so loading does not import the build). */
const definitionFile = (value: unknown): string => {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
              .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(norm(value), null, 2) + "\n";
};

/** The version of an installed package for the project, or of its declaration in package.json. */
function projectVersion(root: string, pkg: string): { version: string; from: "installed" | "declared" } | undefined {
  const dir = packageRoot(root, pkg);
  if (dir && existsSync(join(dir, "package.json"))) {
    const v = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string }).version;
    if (v) return { version: v, from: "installed" };
  }
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const declared = manifest.dependencies?.[pkg] ?? manifest.devDependencies?.[pkg] ?? manifest.peerDependencies?.[pkg];
    const v = declared ? minVersion(declared) : undefined;
    return v ? { version: v, from: "declared" } : undefined;
  } catch {
    return undefined;
  }
}

/** The UHD and TypeScript a project builds with: installed, or else declared in its package.json. */
export function projectToolchain(root: string): { uhd?: { version: string; from: "installed" | "declared" }; typescript?: { version: string; from: "installed" | "declared" } } {
  const uhd = projectVersion(root, "@deltarobotics/uhd");
  const typescript = projectVersion(root, "typescript");
  return { ...(uhd ? { uhd } : {}), ...(typescript ? { typescript } : {}) };
}

/**
 * The project's exact UHD pin against the UHD it runs with (PB-941). A
 * project pins `@deltarobotics/uhd` exactly in package.json (`protoboard
 * init` writes the pin), and everything here evaluates with the installed
 * copy, so when the two differ the project is not running what it pins: a
 * warning that says which version ran and what to do. Within one minor line
 * (0.2.0 and 0.2.1) definitions and vendored parts work under either, so it
 * is only a warning; whether the installed UHD suits each vendored part is
 * `requirementDiagnostics`, an error. A range (`^0.2.0`) is not a pin and
 * says nothing here.
 */
export function uhdPinDiagnostics(root: string): ProjectDiagnostic[] {
  let pinned: string | undefined;
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    pinned = manifest.dependencies?.[UHD_PACKAGE] ?? manifest.devDependencies?.[UHD_PACKAGE];
  } catch {
    return [];
  }
  if (!pinned || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pinned)) return [];
  const installed = projectVersion(root, UHD_PACKAGE);
  if (!installed || installed.from !== "installed" || installed.version === pinned) return [];
  const line = (v: string) => v.split(".").slice(0, 2).join(".");
  const same = line(installed.version) === line(pinned);
  return [
    {
      code: "PB_UHD_PIN",
      severity: "warning",
      entity: { kind: "project", id: "package.json" },
      message:
        `package.json pins ${UHD_PACKAGE} ${pinned}, and ${installed.version} is installed: this ran with ${installed.version}. ` +
        `Run \`npm install\` to get the pinned version, or move the pin to ${installed.version}` +
        (same ? ` (the same ${line(pinned)} line: parts and definitions written for one work with the other)` : ` (another minor line: UHD's schema may differ, and each vendored part's range is checked against ${installed.version})`),
      source: { file: "package.json" },
      validator: VALIDATOR,
    },
  ];
}

/**
 * Whether the project's UHD and TypeScript meet a part's declared ranges.
 * UHD outside the range is an error (the source is written against another
 * API; the definition it evaluates to may differ); TypeScript outside it, or
 * not pinned at all, a warning.
 */
export function requirementDiagnostics(id: string, src: VendoredSource, toolchain: ReturnType<typeof projectToolchain>, at: SourceLocation): ProjectDiagnostic[] {
  const out: ProjectDiagnostic[] = [];
  const entity = { kind: "definition" as const, id };
  const { uhd, typescript } = toolchain;
  if (!uhd) out.push({ code: "PB_SOURCE_UHD_UNKNOWN", severity: "error", entity, message: `${id}'s source needs @deltarobotics/uhd ${src.requires.uhd}; the project neither installs nor declares UHD`, source: at, validator: VALIDATOR });
  else if (!uhdRunsSource(uhd.version, src.requires.uhd))
    out.push({
      code: "PB_SOURCE_UHD_RANGE",
      severity: "error",
      entity,
      message: `${id}'s source needs @deltarobotics/uhd ${src.requires.uhd}; the project ${uhd.from === "installed" ? "has" : "declares"} ${uhd.version}. Use a UHD in that range, update the part to a revision written for yours, or vendor it compiled (\`protoboard parts add ${id} --compiled\`)`,
      source: at,
      validator: VALIDATOR,
    });
  if (!typescript)
    out.push({ code: "PB_SOURCE_TS_UNPINNED", severity: "warning", entity, message: `${id}'s source is written for TypeScript ${src.requires.typescript}; the project does not pin TypeScript (add it to devDependencies)`, source: at, validator: VALIDATOR });
  else if (!satisfiesRange(typescript.version, src.requires.typescript))
    out.push({ code: "PB_SOURCE_TS_RANGE", severity: "warning", entity, message: `${id}'s source is written for TypeScript ${src.requires.typescript}; the project ${typescript.from === "installed" ? "has" : "declares"} ${typescript.version}`, source: at, validator: VALIDATOR });
  return out;
}

/** A closure to evaluate: its files (paths under the artifact base) and what to take from it. */
export interface SourceClosure {
  key: string;
  files: { path: string; text: string }[];
  entry: string;
  export: string;
}

export type SourceEvaluation = { def: ModuleDef; digest: string } | { error: string };

/** TypeScript to JavaScript as tsx turns it (esbuild, types erased): what the confined evaluation imports. */
let transpiler: ((text: string, path: string) => string) | undefined;
function transpile(text: string, path: string): string {
  if (!transpiler) {
    const fromTsx = createRequire(createRequire(import.meta.url).resolve("tsx/package.json"));
    const { transformSync } = fromTsx("esbuild") as { transformSync: (code: string, options: Record<string, unknown>) => { code: string } };
    transpiler = (t, p) => transformSync(t, { loader: "ts", format: "esm", target: "es2022", sourcefile: p }).code;
  }
  return transpiler(text, path);
}

/**
 * The definitions vendored sources evaluate to (UHD library protocol
 * § 4.6.3). Library source is not the project's own code, so it is never
 * imported into this process: UHD's confined evaluator runs it in a child
 * Node process that reads only the closure and the project's
 * `@deltarobotics/uhd`, writes nothing, starts nothing, cannot generate
 * code from strings and sees none of this environment (no credentials).
 * Each export comes back as JSON; its definition file form (sorted keys,
 * the bytes the definition file holds) is the definition and its SHA-256
 * the digest. Closures in one call share the child; one that hangs or exits
 * fails alone.
 */
export async function evaluateSources(root: string, closures: SourceClosure[]): Promise<Map<string, SourceEvaluation>> {
  const out = new Map<string, SourceEvaluation>();
  if (!closures.length) return out;
  const uhd = packageRoot(root, "@deltarobotics/uhd");
  if (!uhd) {
    for (const c of closures) out.set(c.key, { error: "@deltarobotics/uhd is not installed for the project" });
    return out;
  }
  const results = await evaluateSourceConfined(closures, { transpile, uhdPackageDir: uhd });
  for (const r of results) {
    if ("error" in r) {
      out.set(r.key, { error: r.error });
      continue;
    }
    const bytes = definitionFile(r.definition);
    out.set(r.key, { def: JSON.parse(bytes) as ModuleDef, digest: sha256(bytes) });
  }
  return out;
}

/** A vendored source's files as they are on disk under `dir` (absolute), for `evaluateSources`. */
export function vendoredClosure(key: string, dir: string, src: VendoredSource): SourceClosure {
  return { key, files: Object.keys(src.files).map((path) => ({ path, text: readFileSync(join(dir, ...path.split("/")), "utf8") })), entry: src.entry, export: src.export };
}

/** The evaluation of one vendored source on disk. */
export async function evaluateVendoredSource(root: string, dir: string, src: VendoredSource): Promise<SourceEvaluation> {
  return (await evaluateSources(root, [vendoredClosure("source", dir, src)])).get("source")!;
}

/**
 * Source files that no longer hash to what was vendored (edited), and
 * missing ones, project-relative; `state` is a digest of the files as they
 * are now (what `cachedEvaluations` keys evaluations by).
 */
export function editedSourceFiles(root: string, dir: string, src: VendoredSource): { missing: string[]; edited: string[]; state: string } {
  const missing: string[] = [];
  const edited: string[] = [];
  const now: string[] = [];
  for (const [path, digest] of Object.entries(src.files)) {
    const file = join(root, dir, ...path.split("/"));
    if (!existsSync(file)) {
      missing.push(projectRelative(root, file));
      now.push(`${path} -`);
      continue;
    }
    const current = sha256(readFileSync(file));
    now.push(`${path} ${current}`);
    if (current !== digest) edited.push(projectRelative(root, file));
  }
  return { missing, edited, state: sha256(`${dir}\n${now.join("\n")}`) };
}

/**
 * Evaluations of the project's vendored sources, by the state of every
 * vendored source file (`editedSourceFiles`): a long-running process (the
 * VS Code extension, `protoboard dev`) evaluates again only when a vendored
 * file changed, and sees the edit on the next load. A few states are kept:
 * the current one and the ones just before it.
 */
const evaluations = new Map<string, Promise<Map<string, SourceEvaluation>>>();
export function cachedEvaluations(state: string, evaluate: () => Promise<Map<string, SourceEvaluation>>): Promise<Map<string, SourceEvaluation>> {
  let e = evaluations.get(state);
  if (!e) {
    e = evaluate();
    evaluations.set(state, e);
    e.catch(() => evaluations.delete(state));
    if (evaluations.size > 8) evaluations.delete(evaluations.keys().next().value!);
  }
  return e;
}
