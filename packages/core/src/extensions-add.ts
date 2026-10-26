/**
 * `protoboard extensions add <name>` (PB-1018): list an extension in a
 * project's package.json and protoboard.config.ts. The CLI then links it from
 * the Protoboard installed for the user (no npm) and exports its skills. An
 * agent never runs `npm install` to add one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE, importTs } from "./load.js";
import { findConfigObject } from "./libraries.js";
import type { ProtoboardConfig } from "./types.js";

/** The package an extension name means: `tscircuit`, `ext-tscircuit` and `@protoboardai/ext-tscircuit` are one. */
export function extensionPackage(name: string): string {
  const n = name.trim();
  if (n.startsWith("@") || n.includes("/")) return n;
  return `@protoboardai/${n.startsWith("ext-") ? n : `ext-${n}`}`;
}

export interface AddExtensionResult {
  package: string;
  /** The range written into package.json (the project's stack range). */
  range: string;
  /** What changed: package.json's dependency, the config's `extensions` entry. */
  packageJson: "added" | "present";
  config: "added" | "present";
}

/** The stack range a project's packages ask for: `@protoboardai/core`'s, else the CLI's. */
function stackRange(deps: Record<string, string>, fallback: string): string {
  return deps["@protoboardai/core"] ?? deps["@protoboardai/cli"] ?? fallback;
}

/**
 * Add the extension to package.json (`dependencies`, at the project's stack
 * range) and to `extensions` in protoboard.config.ts. The config is edited as
 * text, read back, and restored when it does not read back with the entry.
 */
export async function addExtension(root: string, name: string, options: { fallbackRange: string }): Promise<AddExtensionResult> {
  const pkg = extensionPackage(name);
  const pkgFile = join(root, "package.json");
  const pkgText = readFileSync(pkgFile, "utf8");
  const json = JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...(json.devDependencies ?? {}), ...(json.dependencies ?? {}) };
  const range = deps[pkg] ?? stackRange(deps, options.fallbackRange);
  let packageJson: AddExtensionResult["packageJson"] = "present";
  if (!json.dependencies?.[pkg] && !json.devDependencies?.[pkg]) {
    json.dependencies = Object.fromEntries(Object.entries({ ...(json.dependencies ?? {}), [pkg]: range }).sort(([a], [b]) => a.localeCompare(b)));
    packageJson = "added";
  }

  const file = join(root, CONFIG_FILE);
  const before = readFileSync(file, "utf8");
  const loaded = (await importTs<{ default?: ProtoboardConfig }>(file, { fresh: true })).default;
  const listed = loaded?.extensions ?? [];
  let config: AddExtensionResult["config"] = "present";
  let after = before;
  if (!listed.includes(pkg)) {
    const found = findConfigObject(before, "extensions");
    if (!found) throw new Error(`cannot find the config object in ${CONFIG_FILE} (expected \`export default defineConfig({ … })\`); add "${pkg}" to \`extensions\` by hand`);
    if (found.librariesNotArray) throw new Error(`\`extensions\` in ${CONFIG_FILE} is not an array literal; add "${pkg}" to it by hand`);
    const list = [...listed, pkg];
    const rendered = `extensions: [${list.map((x) => JSON.stringify(x)).join(", ")}]`;
    if (found.libraries) after = before.slice(0, found.libraries.key) + rendered + before.slice(found.libraries.value.end);
    else {
      let end = found.object.end;
      while (end > 0 && /\s/.test(before[end - 1])) end--;
      const comma = before[end - 1] === "," || before[end - 1] === "{" ? "" : ",";
      after = before.slice(0, end) + comma + `\n${found.indent}${rendered},\n` + before.slice(found.object.end);
    }
    writeFileSync(file, after);
    try {
      const back = (await importTs<{ default?: ProtoboardConfig }>(file, { fresh: true })).default?.extensions ?? [];
      if (JSON.stringify(back) !== JSON.stringify(list)) throw new Error(`it reads back as ${JSON.stringify(back)}`);
    } catch (e) {
      writeFileSync(file, before);
      throw new Error(`could not update ${CONFIG_FILE}, left unchanged: ${(e as Error).message}`);
    }
    config = "added";
  }
  if (packageJson === "added") writeFileSync(pkgFile, JSON.stringify(json, null, 2) + "\n");
  return { package: pkg, range, packageJson, config };
}
