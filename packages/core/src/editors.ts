/**
 * The editors a project's extensions contribute (`contributes.editors`,
 * docs/specs/viewer-stack.md), and which one opens a file. The manifests are
 * checked when the extensions load (validateContributes); this resolves
 * their paths and matches files. `protoboard editors` prints the result, and
 * the shells open a file in the first enabled extension's editor that claims
 * it, in protoboard.config.ts order.
 */
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { EditorDecl, LoadedExtension } from "./extensions.js";
import { loadExtensions } from "./extensions.js";
import { importTs, loadConfig } from "./load.js";
import type { EditorHostEntry } from "./editor-protocol.js";
import type { ProjectDiagnostic } from "./types.js";

/** An editor with the extension it comes from and its files as absolute paths. */
export interface ResolvedEditor extends EditorDecl {
  extension: string;
  /** The npm package (what protoboard.config.ts names, and what `protoboard editors host` takes). */
  package: string;
  /** The package's folder. */
  packageRoot: string;
  /** Absolute paths of the page's files, and whether each is there (a bundle that was not built is not). */
  resolved: {
    script: string;
    style?: string;
    host?: { module: string; export: string };
    missing: string[];
  };
}

/**
 * A file pattern as a regular expression: `*` any characters but `/`, `**`
 * any folders, `?` one character, `{a,b}` either. Patterns are matched case
 * sensitively, as VS Code's `filenamePattern`.
 */
export function filePatternRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      // `**/` is zero or more folders; a trailing `**` anything
      if (pattern[i + 2] === "/") {
        out += "(?:[^/]*/)*";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end < 0) out += "\\{";
      else {
        out += `(?:${pattern
          .slice(i + 1, end)
          .split(",")
          .map((alt) => alt.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
          .join("|")})`;
        i = end;
      }
    } else out += c.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** Whether an editor's patterns claim a project-relative path (forward slashes): a pattern without a slash is matched against the name. */
export function claims(editor: Pick<EditorDecl, "files">, relPath: string): boolean {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  return editor.files.some((p) => filePatternRegExp(p).test(p.includes("/") ? relPath : name));
}

/** The editors of the loaded extensions, in load order (protoboard.config.ts's), with their files resolved. */
export function resolveEditors(extensions: LoadedExtension[]): { editors: ResolvedEditor[]; diagnostics: ProjectDiagnostic[] } {
  const editors: ResolvedEditor[] = [];
  const diagnostics: ProjectDiagnostic[] = [];
  for (const e of extensions) {
    for (const d of e.manifest.contributes?.editors ?? []) {
      const [file, name] = d.host ? d.host.split("#") : [];
      const script = join(e.root, d.webview.script);
      const style = d.webview.style ? join(e.root, d.webview.style) : undefined;
      const host = file ? { module: join(e.root, file), export: name || "default" } : undefined;
      const missing = [script, ...(style ? [style] : []), ...(host ? [host.module] : [])].filter((f) => !existsSync(f));
      // two extensions claiming one pattern: the first (in protoboard.config.ts's order) opens those files
      for (const other of editors.filter((x) => x.package !== (e.package ?? e.manifest.id))) {
        const shared = d.files.filter((f) => other.files.includes(f));
        if (shared.length) {
          diagnostics.push({
            code: "PB_EXTENSION_EDITOR_SHARED",
            severity: "warning",
            entity: { kind: "project", id: e.package ?? e.manifest.id },
            message: `${e.manifest.id}: editor ${d.id} claims ${shared.join(", ")}, which ${other.extension}'s editor ${other.id} claims first; those files open in ${other.extension}'s`,
            source: { file: "protoboard.config.ts" },
            validator: "protoboard/extensions",
          });
        }
      }
      editors.push({
        ...d,
        extension: e.manifest.id,
        package: e.package ?? e.manifest.id,
        packageRoot: e.root,
        resolved: { script, ...(style ? { style } : {}), ...(host ? { host } : {}), missing },
      });
    }
  }
  return { editors, diagnostics };
}

/** A path relative to a folder with forward slashes, or undefined when it is outside. */
export function relativeInside(root: string, file: string): string | undefined {
  const rel = relative(resolve(root), resolve(file));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || /^[a-zA-Z]:/.test(rel) || rel.startsWith(sep)) return undefined;
  return rel.split(sep).join("/");
}

/** The editor that opens a file of the project: the first that claims it. */
export function editorFor(editors: ResolvedEditor[], root: string, file: string): ResolvedEditor | undefined {
  const rel = relativeInside(root, file);
  return rel === undefined ? undefined : editors.find((e) => claims(e, rel));
}

/**
 * The extensions protoboard.config.ts lists, loaded and checked, without
 * loading the project's model: what the editors need, and quick. Runs the
 * project's config, so only where the project's code may run.
 */
export async function loadProjectExtensions(root: string): Promise<{ extensions: LoadedExtension[]; diagnostics: ProjectDiagnostic[] }> {
  const config = await loadConfig(root);
  return loadExtensions({ root, config });
}

/** An editor's host entry, imported as operations are (TypeScript runs as it is). */
export async function loadEditorHost(editor: ResolvedEditor): Promise<EditorHostEntry> {
  const host = editor.resolved.host;
  if (!host) throw new Error(`${editor.extension}'s editor ${editor.id} declares no host`);
  const mod = (await importTs(host.module)) as Record<string, unknown>;
  const entry = mod[host.export];
  if (typeof entry !== "function") throw new Error(`${editor.extension}: ${editor.host} is not a function export`);
  return entry as EditorHostEntry;
}
