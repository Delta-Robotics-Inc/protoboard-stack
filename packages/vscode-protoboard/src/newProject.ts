/**
 * Creating a project from VS Code (PB-931): the templates `protoboard init`
 * offers, where the project can go, and the command that makes it. No VS Code
 * API here.
 */
import { existsSync, readdirSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";

export interface TemplateChoice {
  /** `--template` value; empty for a project with nothing in it yet. */
  id: string;
  title: string;
  description: string;
}

/** No template: a blank project, a system with nothing in it yet. Always offered, first: it is the default. */
export const EMPTY_TEMPLATE: TemplateChoice = {
  id: "",
  title: "Blank project",
  description: "A system with nothing in it yet, the project's folders and its agent instructions.",
};

/** The templates the stack ships, for when the CLI cannot be asked (it is not installed yet). */
export const KNOWN_TEMPLATES: TemplateChoice[] = [
  { id: "drone", title: "Drone: multirotor flight stack", description: "A 6S flight stack to grow into a multirotor: flight controller, 4-in-1 ESC, pack and receiver." },
  { id: "iot", title: "IoT: Wi-Fi/BLE board on a LiPo cell", description: "A main board with an ESP32-C3 module, 3V3 buck-boost, charger and USB-C, on a 1000 mAh cell." },
  { id: "wearable", title: "Wearable: BLE board on a LiPo cell", description: "A main board with an nRF52840 module, a 3.0 V LDO, charger and USB-C, on a 200 mAh cell." },
];

/** `protoboard init --list --format json`, as choices (the empty project first). Anything else: the known ones. */
export function templateChoices(listJson?: string): TemplateChoice[] {
  let listed: TemplateChoice[] | undefined;
  try {
    const data = JSON.parse(listJson ?? "") as { templates?: { id?: unknown; title?: unknown; description?: unknown }[] };
    if (Array.isArray(data.templates)) {
      listed = data.templates
        .filter((t) => typeof t.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(t.id))
        .map((t) => ({ id: t.id as string, title: typeof t.title === "string" ? t.title : (t.id as string), description: typeof t.description === "string" ? t.description : "" }));
    }
  } catch {
    listed = undefined;
  }
  return [EMPTY_TEMPLATE, ...(listed?.length ? listed : KNOWN_TEMPLATES)];
}

/** The arguments of `protoboard init` for a folder, a template and, when it is not the folder's, a name. */
export function initArgs(dir: string, template?: string, json = true, name?: string): string[] {
  return ["init", dir, ...(template ? ["--template", template] : []), ...(name ? ["--name", name] : []), ...(json ? ["--format", "json"] : [])];
}

/** A project's folder name from its name: lower case, dashes. Empty when the name has no letter or digit. */
export function folderFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * What the window is told about its folder by itself, at most once (first
 * builds review, D2 and item 6): an empty folder is offered a new project,
 * and a Protoboard project that is not set up is offered Initialize. Any
 * other folder (someone's code, documents) gets nothing: Protoboard does not
 * nag where it was not asked.
 */
export type FolderNotice = { kind: "none" } | { kind: "empty"; folder: string } | { kind: "needs-setup"; root: string };

export function folderNotice(input: { folders: string[]; roots: string[]; needsSetup: (root: string) => boolean; empty?: (dir: string) => boolean; told: (key: string) => boolean }): FolderNotice {
  const unset = input.roots.find((r) => input.needsSetup(r));
  if (unset) return input.told(`setup:${unset}`) ? { kind: "none" } : { kind: "needs-setup", root: unset };
  if (input.roots.length) return { kind: "none" };
  const empty = input.empty ?? ((d: string) => existsSync(d) && canInitIn(d));
  const folder = input.folders.length === 1 && empty(input.folders[0]!) ? input.folders[0]! : undefined;
  return folder && !input.told(`empty:${folder}`) ? { kind: "empty", folder } : { kind: "none" };
}

/** The runtime a message of the CLI says is missing (`protoboard tools install cad`): what the extension offers as a button instead (item 28). */
export function toolsInstallHint(message: string): string | undefined {
  const m = /protoboard tools install (cad|circuit|all)\b/.exec(message);
  return m ? m[1] : undefined;
}

/**
 * npm refused by the registry (first builds review, item 26), as the
 * extension shows it: the cause, with the fix as buttons instead of commands
 * to type. `renew` is the command that gets a new one-hour pass for the
 * beta registry, which a button runs in a terminal; the sentence about the
 * set-up without npm goes, since that is a button too (Initialize).
 */
export function registryRefusal(message: string): { text: string; renew?: string } | undefined {
  if (!/refused by the registry|npm got 40[13] from/.test(message)) return undefined;
  const renew = /Get a new one with `([^`]+)`/.exec(message)?.[1];
  const text = message
    .replace(/ Get a new one with `[^`]+`, then run this again\./, renew ? " Renew Registry Pass gets a new one; then try again." : "")
    .replace(/ \(`npm config get @protoboardai:registry` shows which registry; its token may have run out\)/, " (its token may have run out)")
    .replace(/ Sign in to it again, then run this again\./, " Sign in to that registry again, then try again.")
    .replace(/ Or set the project up without npm and without a registry:.*$/s, "")
    .trim();
  return { text, ...(renew ? { renew } : {}) };
}

/** A CLI message with its "run this command" sentence taken out, for where the extension offers the action as a button. */
export function withoutRunHint(message: string): string {
  return message
    .replace(/[;,]?\s*(?:re-)?run `protoboard tools install [^`]*`/gi, "")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * What `protoboard init` accepts in a folder it makes a project in (KEPT_ON_INIT
 * in @protoboardai/core): a workspace's CLAUDE.md and what file managers and
 * git leave. A test keeps the two lists equal.
 */
export const INIT_LEFTOVERS: ReadonlySet<string> = new Set(["CLAUDE.md", ".gitkeep", ".DS_Store", "Thumbs.db", "desktop.ini"]);

/** `init` writes only into a folder that is new, empty, or holds only what init accepts (a .gitkeep, a CLAUDE.md). */
export function canInitIn(dir: string, list: (d: string) => string[] = (d) => readdirSync(d), exists: (d: string) => boolean = existsSync): boolean {
  if (!exists(dir)) return true;
  try {
    return list(dir).every((f) => INIT_LEFTOVERS.has(f));
  } catch {
    return false;
  }
}

/** Why a name cannot be a new project folder inside `parent`; undefined when it can. */
export function folderNameProblem(name: string, parent: string, canInit: (dir: string) => boolean = canInitIn): string | undefined {
  const n = name.trim();
  if (!n) return "Give the folder a name.";
  // one folder, portable: no separators, nothing Windows refuses, no leading dot or trailing dot or space
  if (/[\\/:*?"<>|]/.test(n) || n === "." || n === ".." || /^[.\s]|[.\s]$/.test(name)) return "A folder name without / \\ : * ? \" < > |, not starting with a dot.";
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) return `"${n}" is a name Windows reserves.`;
  if (!canInit(join(parent, n))) return `${n} exists and is not empty.`;
  return undefined;
}

/** `dir` is inside one of `folders` (or is one of them): the folder that holds it. Paths compare as the platform's file system does. */
export function folderHolding(dir: string, folders: string[], platform: NodeJS.Platform = process.platform): string | undefined {
  const fold = (p: string) => (platform === "win32" || platform === "darwin" ? p.toLowerCase() : p);
  const d = fold(resolve(dir));
  return folders.find((f) => {
    const rel = relative(fold(resolve(f)), d);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

/** Whether a command is on PATH (`protoboard`, or `protoboard.cmd` on Windows). */
export function onPath(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): boolean {
  const win = platform === "win32";
  const names = win ? [`${name}.cmd`, `${name}.exe`, `${name}.ps1`, name] : [name];
  const sep = win ? ";" : platform === process.platform ? delimiter : ":";
  for (const dir of (env.PATH ?? env.Path ?? "").split(sep).filter(Boolean)) {
    for (const n of names) if (exists(win ? `${dir.replace(/[\\/]+$/, "")}\\${n}` : `${dir.replace(/\/+$/, "")}/${n}`)) return true;
  }
  return false;
}

/**
 * The command a terminal runs when no CLI is installed anywhere the extension
 * can find: npm fetches the CLI of this extension's version and runs its
 * `init`. A terminal has the shell's PATH (a VS Code started from the macOS
 * Dock does not), so `npx` is found there. Quoted for a POSIX shell or PowerShell.
 */
export function npxInitCommand(version: string, dir: string, template?: string, platform: NodeJS.Platform = process.platform): string {
  return npxCommand(version, initArgs(dir, template, false), platform);
}

/** Any CLI command through npm, by the packages' scoped name and this extension's version (never the unscoped name, which is someone else's on the public registry). */
export function npxCommand(version: string, args: string[], platform: NodeJS.Platform = process.platform): string {
  const parts = ["npx", "--yes", `@protoboardai/cli@${version}`, ...args];
  if (platform === "win32") return parts.map((p) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, "''")}'`)).join(" ");
  return parts.map((p) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(" ");
}

/**
 * The arguments of the `protoboard parts add …` that `init` prints when a
 * template's catalog parts could not be fetched, to run again later. Only
 * that command, and only part references (`id` or `id@revision`): anything
 * else gives undefined.
 */
export function partsAddArgs(command: string | undefined): string[] | undefined {
  const words = (command ?? "").trim().split(/\s+/);
  if (words[0] !== "protoboard" || words[1] !== "parts" || words[2] !== "add") return undefined;
  const refs = words.slice(3);
  if (!refs.length || !refs.every((r) => /^[a-z0-9][a-z0-9._-]*(@[a-z0-9._-]+)?$/i.test(r))) return undefined;
  return ["parts", "add", ...refs];
}

/**
 * What to tell someone whose template parts were not fetched. The way out is
 * a button (Sign In, Fetch Parts), not a command to type (item 28).
 */
export function partsNotFetchedMessage(why: string, command: string | undefined): string {
  const can = !!partsAddArgs(command);
  const kind = partsFailure(why);
  // the advice follows the error (B7): a sign-in only when the service asked for one
  const next =
    kind === "sign-in"
      ? can
        ? "Sign in, then choose Fetch Parts."
        : "Sign in; the parts can then be added from the Protoboard Library view."
      : kind === "unreachable"
        ? can
          ? "Check the connection to the Protoboard library, then choose Fetch Parts."
          : "Once the Protoboard library can be reached, the parts can be added from the Protoboard Library view."
        : kind === "revision"
          ? `The library does not have the revision${can && (partsAddArgs(command)?.length ?? 0) > 3 ? "s" : ""} the template pins. ${can ? "Choose Fetch Parts to try again, or add" : "Add"} the parts from the Protoboard Library view.`
          : can
            ? "Choose Fetch Parts to try again; the Protoboard log has the details."
            : "The parts can be added from the Protoboard Library view; the Protoboard log has the details.";
  return `Protoboard: the project was created, but its catalog parts were not fetched: ${why.replace(/\s+$/, "")} The viewer shows them as placeholders until they are. ${next}`;
}

/** What kind of failure a parts fetch reported (B7), for the advice and the buttons. */
export function partsFailure(why: string): "sign-in" | "unreachable" | "revision" | "other" {
  if (/no such revision|REVISION_NOT_FOUND/i.test(why)) return "revision";
  if (/cannot reach|not reached|unreachable|fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed out|offline/i.test(why)) return "unreachable";
  if (/sign(ed)? ?in|log ?in|AUTH_REQUIRED|FORBIDDEN|ACCOUNT_NOT_ALLOWED|refused access|not invited|\b401\b|\b403\b/i.test(why)) return "sign-in";
  return "other";
}

/** Whether this VS Code is older than `minor` of 1.x ("1.106.3" is older than 107). */
export function vscodeBefore(version: string, minor: number): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  return Number(m[1]) < 1 || (Number(m[1]) === 1 && Number(m[2]) < minor);
}
