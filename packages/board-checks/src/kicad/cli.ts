/**
 * Finding `kicad-cli` without a hardcoded personal path: `PROTOBOARD_KICAD_CLI` when set, then every folder on
 * PATH, then the standard install folders (Windows: `Program Files\KiCad\<version>\bin`, newest version first;
 * macOS: the KiCad app bundle; Linux: `/usr/bin`, `/usr/local/bin`). KiCad is an external program the user
 * installs; this package never ships or downloads it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface KicadCli {
  path: string;
  version: string;
  /** Where it was found. */
  from: "env" | "path" | "install-folder";
}

function exe(name: string): string[] {
  return process.platform === "win32" ? [`${name}.exe`, name] : [name];
}

function versionOf(path: string): string | undefined {
  try {
    const r = spawnSync(path, ["version"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    if (r.status !== 0) return undefined;
    const v = (r.stdout || "").trim().split(/\r?\n/).pop()?.trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}

/** Numeric-aware descending order of version folder names ("10.0" before "9.0"). */
const byVersionDesc = (a: string, b: string): number => b.localeCompare(a, "en", { numeric: true });

/** The candidate paths, in search order. */
export function kicadCliCandidates(env: NodeJS.ProcessEnv = process.env): { path: string; from: KicadCli["from"] }[] {
  const out: { path: string; from: KicadCli["from"] }[] = [];
  if (env.PROTOBOARD_KICAD_CLI) out.push({ path: env.PROTOBOARD_KICAD_CLI, from: "env" });
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) for (const n of exe("kicad-cli")) out.push({ path: join(dir, n), from: "path" });
  if (process.platform === "win32") {
    for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432].filter((x): x is string => !!x)) {
      const base = join(root, "KiCad");
      if (!existsSync(base)) continue;
      let versions: string[] = [];
      try {
        versions = readdirSync(base).sort(byVersionDesc);
      } catch {
        versions = [];
      }
      for (const v of versions) out.push({ path: join(base, v, "bin", "kicad-cli.exe"), from: "install-folder" });
    }
  } else if (process.platform === "darwin") {
    out.push({ path: "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli", from: "install-folder" });
  } else {
    out.push({ path: "/usr/bin/kicad-cli", from: "install-folder" }, { path: "/usr/local/bin/kicad-cli", from: "install-folder" });
  }
  return out;
}

let found: KicadCli | null | undefined;

/** The first working kicad-cli, or undefined (cached for the process; `refresh` searches again). */
export function findKicadCli(options: { env?: NodeJS.ProcessEnv; refresh?: boolean } = {}): KicadCli | undefined {
  if (found !== undefined && !options.refresh && !options.env) return found ?? undefined;
  const seen = new Set<string>();
  let result: KicadCli | undefined;
  for (const c of kicadCliCandidates(options.env)) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    if (!existsSync(c.path)) continue;
    const version = versionOf(c.path);
    if (version) {
      result = { path: c.path, version, from: c.from };
      break;
    }
  }
  if (!options.env) found = result ?? null;
  return result;
}
