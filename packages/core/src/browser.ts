/**
 * Finding a Chromium-family browser (PB-943). The datasheet, the assembly
 * guide and the package documents are HTML pages; a headless browser lays
 * them out, draws their figures and prints them to PDF (ext-docs,
 * ext-release). This is the one place that knows where browsers are: the
 * `chrome` tool's probe (`protoboard:browser`, tools.ts) and the renderer
 * (ext-docs' lib/render/cdp.ts) both ask it.
 *
 * Order: the `CHROME` variable (it wins, whatever it names), then
 * `CHROME_PATH` and `PUPPETEER_EXECUTABLE_PATH`, then Google Chrome,
 * Chromium, Microsoft Edge and Brave where each platform installs them, by
 * name on PATH and by full path.
 *
 * This file imports only Node built-ins and uses only erasable TypeScript,
 * so Node runs it as it is (scripts/macos-probe.mjs).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute } from "node:path";

export interface BrowserLookup {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (path: string) => boolean;
}

export interface FoundBrowser {
  /** What to run: a full path, or what `CHROME` names. */
  path: string;
  /** `Google Chrome`, `Chromium`, `Microsoft Edge`, `Brave`, or the variable's name for one given by the environment. */
  name: string;
  /** Where it came from: a variable's name, `PATH`, or `installed`. */
  from: string;
}

/** What the browser is for, in one sentence (the `chrome` tool's purpose and the message when none is found). */
export const BROWSER_PURPOSE = "The datasheet, the assembly guide and the package documents are rendered to PDF with a headless Chromium-family browser (Google Chrome, Chromium, Microsoft Edge or Brave).";

const VARIABLES = ["CHROME", "CHROME_PATH", "PUPPETEER_EXECUTABLE_PATH"];

/** Command names, in order of preference. */
const NAMES: [string, string][] = [
  ["google-chrome", "Google Chrome"],
  ["google-chrome-stable", "Google Chrome"],
  ["chrome", "Google Chrome"],
  ["chromium", "Chromium"],
  ["chromium-browser", "Chromium"],
  ["microsoft-edge", "Microsoft Edge"],
  ["microsoft-edge-stable", "Microsoft Edge"],
  ["msedge", "Microsoft Edge"],
  ["brave-browser", "Brave"],
  ["brave", "Brave"],
];

/** Every place a browser is looked for on a platform, in order (full paths; names on PATH come first, see `findBrowser`). */
export function browserPaths(look: BrowserLookup = {}): [string, string][] {
  const env = look.env ?? process.env;
  const platform = look.platform ?? process.platform;
  const home = look.home ?? homedir();
  if (platform === "darwin") {
    const apps: [string, string, string][] = [
      ["Google Chrome.app", "Google Chrome", "Google Chrome"],
      ["Chromium.app", "Chromium", "Chromium"],
      ["Microsoft Edge.app", "Microsoft Edge", "Microsoft Edge"],
      ["Brave Browser.app", "Brave Browser", "Brave"],
      ["Google Chrome for Testing.app", "Google Chrome for Testing", "Google Chrome"],
      ["Google Chrome Beta.app", "Google Chrome Beta", "Google Chrome"],
      ["Google Chrome Canary.app", "Google Chrome Canary", "Google Chrome"],
    ];
    // a browser installed for one user sits in their own Applications folder
    return ["/Applications", `${home}/Applications`].flatMap((dir) => apps.map(([app, bin, name]): [string, string] => [`${dir}/${app}/Contents/MacOS/${bin}`, name]));
  }
  if (platform === "win32") {
    const roots = [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", env.LOCALAPPDATA ?? `${home}\\AppData\\Local`];
    const apps: [string, string][] = [
      ["Google\\Chrome\\Application\\chrome.exe", "Google Chrome"],
      ["Chromium\\Application\\chrome.exe", "Chromium"],
      ["Microsoft\\Edge\\Application\\msedge.exe", "Microsoft Edge"],
      ["BraveSoftware\\Brave-Browser\\Application\\brave.exe", "Brave"],
    ];
    return apps.flatMap(([rel, name]) => roots.map((root): [string, string] => [`${root}\\${rel}`, name]));
  }
  return [
    ["/usr/bin/google-chrome", "Google Chrome"],
    ["/usr/bin/google-chrome-stable", "Google Chrome"],
    ["/opt/google/chrome/chrome", "Google Chrome"],
    ["/usr/bin/chromium", "Chromium"],
    ["/usr/bin/chromium-browser", "Chromium"],
    ["/snap/bin/chromium", "Chromium"],
    ["/usr/bin/microsoft-edge", "Microsoft Edge"],
    ["/usr/bin/microsoft-edge-stable", "Microsoft Edge"],
    ["/opt/microsoft/msedge/msedge", "Microsoft Edge"],
    ["/usr/bin/brave-browser", "Brave"],
    ["/snap/bin/brave", "Brave"],
  ];
}

/**
 * The browser to use, or undefined when none is found. A variable that is
 * set is returned as it is, found or not: the user chose it, and running it
 * says what is wrong with it better than a silent fallback would.
 */
export function findBrowser(look: BrowserLookup = {}): FoundBrowser | undefined {
  const env = look.env ?? process.env;
  const platform = look.platform ?? process.platform;
  const exists = look.exists ?? existsSync;
  const win = platform === "win32";
  const dirs = (env.PATH ?? env.Path ?? "").split(look.platform ? (win ? ";" : ":") : delimiter).filter(Boolean);
  const onPath = (name: string): string | undefined => {
    for (const dir of dirs) {
      for (const file of win ? [`${name}.exe`, `${name}.cmd`] : [name]) {
        const full = `${dir}${win ? "\\" : "/"}${file}`;
        if (exists(full)) return full;
      }
    }
    return undefined;
  };
  for (const name of VARIABLES) {
    const value = env[name]?.trim();
    if (!value) continue;
    // a bare command name is looked up on PATH; anything else is taken as given
    const bare = !/[\\/]/.test(value) && !isAbsolute(value);
    return { path: bare ? (onPath(value) ?? value) : value, name, from: name };
  }
  for (const [command, name] of NAMES) {
    const full = onPath(command);
    if (full) return { path: full, name, from: "PATH" };
  }
  for (const [path, name] of browserPaths(look)) if (exists(path)) return { path, name, from: "installed" };
  return undefined;
}

/** What to say when no browser is found: why one is needed, where it was looked for, and how to point at one. */
export function noBrowserMessage(platform: NodeJS.Platform = process.platform): string {
  const where =
    platform === "darwin"
      ? "in /Applications and ~/Applications, and on PATH"
      : platform === "win32"
        ? "under Program Files and the user's AppData\\Local, and on Path"
        : "on PATH (google-chrome, chromium, microsoft-edge, brave-browser) and in /usr/bin, /opt and /snap/bin";
  const example =
    platform === "darwin"
      ? 'export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'
      : platform === "win32"
        ? '$env:CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'
        : "export CHROME=/usr/bin/chromium";
  return `no browser found. ${BROWSER_PURPOSE} None was found ${where}. Install one of them, or set CHROME to a browser's executable: ${example}`;
}
