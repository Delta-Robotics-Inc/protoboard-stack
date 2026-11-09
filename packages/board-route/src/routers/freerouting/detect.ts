/**
 * Finding an installed Freerouting without a personal path: a setting, the PROTOBOARD_FREEROUTING environment
 * variable, the PATH, then the places its installers use. Freerouting is GPL-3.0: Protoboard never bundles it and
 * only runs it as a separate program.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/** Path helpers of the platform being searched (tests pass another platform than the host's). */
const pathFor = (platform: NodeJS.Platform) => (platform === "win32" ? win32 : posix);

export interface FreeroutingInstall {
  /** `exe`: a native launcher; `jar`: the executable jar run with Java. */
  kind: "exe" | "jar";
  path: string;
  /** The Java to run a jar with. */
  java?: string;
  /** From the launcher's configuration or the jar's name; `unknown` until a run prints it. */
  version: string;
  source: "setting" | "environment" | "path" | "install location";
}

export type FreeroutingDetection = { ok: true; install: FreeroutingInstall } | { ok: false; reason: string; howToInstall: string; tried: string[] };

export const FREEROUTING_ENV = "PROTOBOARD_FREEROUTING";

export const HOW_TO_INSTALL =
  "Install Freerouting from https://github.com/freerouting/freerouting/releases (Windows .msi, macOS .dmg, Linux .deb, or the executable .jar with Java 21 or newer), " +
  `then set ${FREEROUTING_ENV} to the freerouting program or .jar if it is not on the PATH or in its default install folder. ` +
  "Freerouting is GPL-3.0: Protoboard does not bundle it and only runs it as a separate program on this machine.";

export interface DetectOptions {
  /** A path from the user's settings (program or .jar). */
  setting?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
  readText?: (p: string) => string | undefined;
}

const exeNames = (platform: NodeJS.Platform) => (platform === "win32" ? ["freerouting.exe", "freerouting.bat", "freerouting.cmd"] : ["freerouting"]);

/** The places Freerouting's installers put it, for this platform. */
export function installLocations(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const { join } = pathFor(platform);
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  if (platform === "win32") {
    const out: string[] = [];
    for (const base of [env.LOCALAPPDATA, env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs"), env.ProgramFiles, env["ProgramFiles(x86)"]]) if (base) out.push(join(base, "freerouting", "freerouting.exe"), join(base, "Freerouting", "freerouting.exe"));
    return out;
  }
  if (platform === "darwin") return ["/Applications/freerouting.app/Contents/MacOS/freerouting", join(home, "Applications", "freerouting.app", "Contents", "MacOS", "freerouting")];
  return ["/opt/freerouting/bin/freerouting", "/usr/bin/freerouting", "/usr/local/bin/freerouting", join(home, ".local", "bin", "freerouting")];
}

/** Java for a jar: JAVA_HOME, then the PATH. */
function findJava(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (p: string) => boolean): string | undefined {
  const { join, delimiter } = pathFor(platform);
  const name = platform === "win32" ? "java.exe" : "java";
  if (env.JAVA_HOME && exists(join(env.JAVA_HOME, "bin", name))) return join(env.JAVA_HOME, "bin", name);
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) if (dir && exists(join(dir, name))) return join(dir, name);
  return undefined;
}

/** The version a launcher's configuration names (jpackage writes `-Djpackage.app-version=`), or a jar's file name. */
export function versionOf(path: string, readText: (p: string) => string | undefined, platform: NodeJS.Platform = process.platform): string {
  const { basename, dirname, join } = pathFor(platform);
  if (/\.jar$/i.test(path)) return /(\d+\.\d+\.\d+)/.exec(basename(path))?.[1] ?? "unknown";
  for (const cfg of [join(dirname(path), "app", "freerouting.cfg"), join(dirname(path), "..", "app", "freerouting.cfg"), join(dirname(path), "..", "lib", "app", "freerouting.cfg")]) {
    const text = readText(cfg);
    const m = text && /app-version=([\w.-]+)/.exec(text);
    if (m) return m[1];
  }
  return "unknown";
}

export function detectFreerouting(options: DetectOptions = {}): FreeroutingDetection {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const readText =
    options.readText ??
    ((p: string) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    });
  const { join, delimiter } = pathFor(platform);
  const tried: string[] = [];
  const accept = (path: string, source: FreeroutingInstall["source"]): FreeroutingDetection | undefined => {
    tried.push(path);
    if (!exists(path)) return undefined;
    if (/\.jar$/i.test(path)) {
      const java = findJava(env, platform, exists);
      if (!java) return { ok: false, reason: `found ${path}, but no Java to run it (set JAVA_HOME or put java on the PATH)`, howToInstall: HOW_TO_INSTALL, tried };
      return { ok: true, install: { kind: "jar", path, java, version: versionOf(path, readText, platform), source } };
    }
    return { ok: true, install: { kind: "exe", path, version: versionOf(path, readText, platform), source } };
  };
  for (const [value, source] of [
    [options.setting, "setting"],
    [env[FREEROUTING_ENV], "environment"],
  ] as const) {
    if (!value) continue;
    const r = accept(value, source);
    if (r) return r;
    return { ok: false, reason: `the ${source === "setting" ? "Freerouting setting" : FREEROUTING_ENV} names ${value}, which does not exist`, howToInstall: HOW_TO_INSTALL, tried };
  }
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter))
    for (const name of exeNames(platform)) {
      if (!dir) continue;
      const r = accept(join(dir, name), "path");
      if (r) return r;
    }
  for (const p of installLocations(env, platform)) {
    const r = accept(p, "install location");
    if (r) return r;
  }
  return { ok: false, reason: "Freerouting is not installed (not set, not on the PATH, not in its default install folders)", howToInstall: HOW_TO_INSTALL, tried };
}
