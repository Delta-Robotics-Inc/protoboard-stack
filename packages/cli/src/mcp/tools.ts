/**
 * The Protoboard MCP server's tools (PB-930, docs/specs/agents-and-mcp.md
 * §2.3). Each is a thin, typed wrapper over a CLI command: it runs the CLI
 * as a child process and returns the JSON it printed, so the CLI's own
 * command layer (the sign-in gate included) decides what happens, and a
 * project's own CLI version is the one that works on it.
 *
 * The tools are a list of specifications. `cliTools()` is the only source
 * today; a bridge to a VS Code window would add a second one beside it
 * (§7), with handlers that talk to the window instead of the CLI.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z, type ZodRawShape } from "zod";
import { LIBRARY_SORTS, findProjectRoot, packageRoot } from "@protoboardai/core";

/** Whether a project's packages are installed: the framework resolves from it (its own node_modules, or a workspace's further up). */
const installedIn = (root: string) => !!packageRoot(root, "@protoboardai/core");
import { DESCRIPTION_LIMIT } from "./instructions.js";

/** What a tool hands back: data (sent as JSON text) and whether it is a failure. */
export interface ToolOutcome {
  data: unknown;
  isError?: boolean;
}

export interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** What a tool's handler works with. */
export interface ToolContext {
  /** The folder a tool works in: its `dir` argument resolved against the server's folder. */
  dir(given?: string): Promise<string>;
  /** Run the CLI in a folder: the project's own when it has one, else the one carrying the server. */
  cli(dir: string, args: string[], options?: { timeoutMs?: number }): Promise<CliRun>;
  /** Which CLI `cli` would run for a folder. */
  cliFor(dir: string): { entry: string; from: "project" | "server" };
  /** The server's own version and instructions. */
  version: string;
  about: string;
}

export interface ToolSpec<S extends ZodRawShape = ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** MCP tool annotations: what a client may tell the user before running it. */
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean };
  handler(args: z.objectOutputType<S, z.ZodTypeAny>, ctx: ToolContext): Promise<ToolOutcome>;
}

const tool = <S extends ZodRawShape>(spec: ToolSpec<S>): ToolSpec => spec as unknown as ToolSpec;

/** What every tool's description ends with, and why none is marked read-only. */
export const RUNS_PROJECT_CODE = "It runs the project's own code (protoboard.config.ts and its model files) to do so.";

const DIR = z.string().optional().describe("The project folder, absolute or relative to the folder the agent works in. Default: that folder. A client that gives the server no folder (a desktop app) starts it somewhere else: pass an absolute path then.");

const SIGN_IN = /protoboard login|not signed in|sign[- ]in (is )?(required|needed)|needs? (a|an|your)? ?(signed-in account|sign-in|account)|sign in (first|again|to )/i;
/** How the user signs in. The extension's route comes first: a user who has only the extension has no `protoboard` command outside a VS Code terminal. */
export const SIGN_IN_ACTION =
  'Ask the user to sign in, then call this tool again. In VS Code: the command "Protoboard: Sign In to Protoboard Cloud" (or the account on the page "Protoboard: Open Settings"). In a terminal: `protoboard login` where that command exists (a VS Code terminal, or a machine with the CLI installed), or `npx --no-install protoboard login` in a project whose packages are installed; `--device` gives a code in place of a browser. Do not sign in for them, and never write a sign-in to a file.';

/** The JSON a `--format json` command printed, or why there is none. */
export function readCliJson(r: CliRun): { ok: true; data: unknown } | { ok: false; message: string; code?: string } {
  let data: unknown;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    // commands that print lines of JSON (none of the tools' do) or nothing at all
    const detail = (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-6).join("\n").replace(/^protoboard: /, "");
    return { ok: false, message: detail || `the command printed nothing (exit ${r.code})` };
  }
  // a failed command prints {"error": …}; the sign-in gate adds its code (SIGN_IN_REQUIRED) and what it found
  const d = data as { error?: unknown; code?: unknown } | null;
  if (d && typeof d === "object" && !Array.isArray(d) && typeof d.error === "string" && (Object.keys(d).length === 1 || typeof d.code === "string")) {
    return { ok: false, message: d.error, ...(typeof d.code === "string" ? { code: d.code } : {}) };
  }
  return { ok: true, data };
}

/** A failed command as a tool result: a sign-in the user has to do is a normal result an agent can act on. */
export function failure(message: string, dir: string, code?: string): ToolOutcome {
  if (code === "SIGN_IN_REQUIRED" || SIGN_IN.test(message)) return { data: { signInRequired: true, message, action: SIGN_IN_ACTION } };
  const root = findProjectRoot(dir);
  const hint = !root
    ? /no protoboard\.config\.ts|not a protoboard project|protoboard init/i.test(message)
      ? "This folder is not a Protoboard project. Call project_status; project_init creates one."
      : undefined
    : !installedIn(root)
      ? `The project's packages are not set up on this machine. Run \`protoboard stack link\` in ${root} (it links them to the Protoboard installed here; no npm), or open the folder in VS Code with the Protoboard extension, then call this tool again.`
      : undefined;
  return { data: { error: message, ...(hint ? { hint } : {}) }, isError: true };
}

/**
 * A command line for the CLI from a tool's arguments. What an agent gave can
 * never be read as an option of the CLI: an option's value is joined to its
 * name (`--library=<value>`) and may not start with a dash, and everything
 * that is not an option (search words, part ids, an instance path, a folder)
 * comes after `--`, where the CLI reads no options at all.
 */
export function cliArgs(command: string[], options: Record<string, string | number | undefined> = {}, positionals: string[] = []): string[] {
  const flags: string[] = [];
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined || value === "") continue;
    const text = String(value);
    if (typeof value === "string" && /^\s*-/.test(text)) throw new Error(`\`${name}\` cannot start with a dash ("${text.slice(0, 40)}"): it would be read as an option of the CLI, and a tool's arguments are values only`);
    if (/[\r\n\0]/.test(text)) throw new Error(`\`${name}\` cannot hold a line break`);
    flags.push(`--${name}=${text}`);
  }
  const words = positionals.filter((w) => w !== "");
  for (const w of words) if (/\0/.test(w)) throw new Error("an argument cannot hold a NUL character");
  return [...command, ...flags, "--format=json", "--", ...words];
}

/** Run one command and return its JSON, or its failure. `args` is a `cliArgs` line. `map` shapes the data. */
async function command(ctx: ToolContext, dir: string, args: string[], map: (data: unknown) => unknown = (d) => d): Promise<ToolOutcome> {
  const r = readCliJson(await ctx.cli(dir, args));
  return r.ok ? { data: map(r.data) } : failure(r.message, dir, r.code);
}

/**
 * The bill of materials as an agent reads it (PB-933's model): every line
 * with the offer chosen for it and its quote, without the list of every
 * other offer and quote (most of the text of a real project's bill), the
 * whole rate table (the rates used stay), fields that hold nothing, and
 * what a line repeats (its definition when that is its key, its group, its
 * single instance).
 */
export function compactBom(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const bom = data as { groups?: { lines?: Record<string, unknown>[] }[]; fx?: Record<string, unknown> };
  const held = (v: unknown): boolean => v !== null && v !== undefined && !(Array.isArray(v) && !v.length);
  const prune = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => held(v)));
  const line = ({ offers, quotes: _quotes, quote, group: _group, definition, instances, ...rest }: Record<string, unknown>) =>
    prune({
      ...rest,
      ...(definition !== rest.key ? { definition } : {}),
      ...(Array.isArray(instances) && instances.length > 1 ? { instances } : {}),
      ...(quote && typeof quote === "object" ? { quote: prune(quote as Record<string, unknown>) } : {}),
      offerCount: Array.isArray(offers) ? offers.length : 0,
    });
  const { rates: _rates, ...fx } = bom.fx ?? {};
  return {
    ...bom,
    ...(bom.fx ? { fx } : {}),
    ...(Array.isArray(bom.groups) ? { groups: bom.groups.map((g) => ({ ...g, ...(Array.isArray(g.lines) ? { lines: g.lines.map(line) } : {}) })) } : {}),
  };
}

const SEVERITY = ["error", "warning", "info"] as const;

export function cliTools(templates: string[]): ToolSpec[] {
  const specs: ToolSpec[] = [
    tool({
      name: "project_status",
      title: "Protoboard status",
      description:
        "Call this first. Says what Protoboard is (`about`), whether the folder is a Protoboard project, which versions are in use, whether the user is signed in to the parts library (the library needs it, searching included; work on the project does not), and in a project what `protoboard doctor` finds (extensions, tools, runtimes, skills); outside one, the templates a project can start from. `next` lists what to do. Reads only.",
      input: { dir: DIR },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async handler({ dir: given }, ctx) {
        const dir = await ctx.dir(given);
        const root = findProjectRoot(dir);
        const used = ctx.cliFor(dir);
        const who = readCliJson(await ctx.cli(dir, cliArgs(["whoami"])));
        const account = who.ok ? who.data : { error: who.message };
        // a project's own CLI from before 0.2.0 refuses every command signed out (it reports `access.required`): that comes first
        const access = who.ok ? (who.data as { access?: { required?: boolean; allowed?: boolean; message?: string } }).access : undefined;
        const olderGate = (!who.ok && who.code === "SIGN_IN_REQUIRED") || (access?.required === true && access.allowed === false);
        const signedIn = who.ok && (who.data as { signedIn?: boolean }).signedIn === true;
        const open = who.ok && (who.data as { needsAccount?: boolean }).needsAccount === false;
        const next: string[] = [];
        let project: unknown = null;
        let found: unknown;
        if (root) {
          const installed = installedIn(root);
          const doctor = installed ? readCliJson(await ctx.cli(root, cliArgs(["doctor"]))) : undefined;
          project = { root, installed, agentsFile: existsSync(join(root, "AGENTS.md")) ? join(root, "AGENTS.md") : null, ...(doctor ? (doctor.ok ? { doctor: doctor.data } : { doctorError: doctor.message }) : {}) };
          if (!installed) next.push(`Run \`protoboard stack link\` in ${root}: the project's packages are not set up on this machine, so nothing else works yet (it links them to the Protoboard installed here; never \`npm install\`).`);
          next.push("Read AGENTS.md in the project, then the build-a-project skill (skill_read with id build-a-project).", "Run project_check before changing anything, and after every change.");
        } else {
          const list = readCliJson(await ctx.cli(dir, cliArgs(["init", "--list"])));
          found = list.ok ? (list.data as { templates?: unknown }).templates : { error: list.message };
          next.push(
            `This folder is not a Protoboard project. Create one with project_init: \`dir\` is the folder to create ("." for this folder when it is empty), \`template\` one of ${templates.join(", ") || "(none installed)"} or left out for a blank project.`,
            "Then call project_status with the new folder as `dir`: the project uses the Protoboard installed on this machine, with nothing to install.",
          );
        }
        // a client with no workspace (a desktop app) starts servers in / or the home folder: that is not where the user works
        if (!given && !root && (dir === homedir() || dirname(dir) === dir)) {
          next.unshift(`No folder was given and this server was started in ${dir}, which is not a folder the user chose. Ask the user which folder to work in, and pass it as an absolute \`dir\` to every tool (project_init included; never ".").`);
        }
        // only the cloud needs an account (PB-928): said once, at the end, never as a blocker
        if (olderGate) next.unshift(`${access?.message ?? "This project's Protoboard needs a sign-in before anything else works."} ${SIGN_IN_ACTION}`);
        else if (!signedIn && !open) next.push(`The user is not signed in. Everything on the project works without an account (check, build, layout, the viewer, release). The Protoboard library needs one, browsing included: searching it (parts_search), adding library parts, update checks, prices and publishing. When a tool says so (signInRequired), ${SIGN_IN_ACTION.charAt(0).toLowerCase()}${SIGN_IN_ACTION.slice(1)}`);
        return { data: { about: ctx.about, protoboard: { version: ctx.version, cli: used.entry, cliFrom: used.from }, folder: dir, project, account, ...(found !== undefined ? { templates: found } : {}), next } };
      },
    }),
    tool({
      name: "project_init",
      title: "Create a Protoboard project",
      description:
        `Creates a Protoboard project (\`protoboard init\`). CHANGES FILES: writes the project's folder (protoboard.config.ts, package.json, AGENTS.md, CLAUDE.md, src/, parts/, docs/) and, for a template, downloads its catalog parts into parts/catalog (that part needs a sign-in; without one the project is still created and the result says which command adds them). Refuses a folder that already has a project. Templates: ${templates.join(", ") || "none installed"}; leave \`template\` out for a blank project. It uses the Protoboard installed on this machine (its packages are links to it) and exports the skills: there is nothing to install afterwards, and you never run \`npm install\`. A folder that holds only a CLAUDE.md (a workspace made it) is used, and its CLAUDE.md kept. Publishes nothing.`,
      input: {
        dir: z.string().describe('The folder to create the project in, absolute or relative to the folder the agent works in. "." is that folder itself.'),
        template: z.string().optional().describe(`A starting system: ${templates.join(", ") || "none installed"}. Left out: a blank project.`),
        name: z.string().optional().describe("The project's name. Default: the folder's name."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      async handler({ dir: target, template, name }, ctx) {
        const base = await ctx.dir();
        const where = resolve(base, target);
        const r = readCliJson(await ctx.cli(base, cliArgs(["init"], { template, name }, [where]), { timeoutMs: 300_000 }));
        if (!r.ok) return failure(r.message, base, r.code);
        const d = r.data as { stackMode?: string; stack?: { linked?: string[] }; stackError?: string; partsSkipped?: string; partsCommand?: string };
        const setUp = d.stack?.linked?.length
          ? []
          : d.stackMode === "project"
            ? [`This project installs its own packages (a project-local stack): ask the user before running \`npm install\` in ${where}.`]
            : [`Its packages were not linked${d.stackError ? ` (${d.stackError})` : ""}: run \`protoboard stack link\` in ${where}, or open it in VS Code with the Protoboard extension.`];
        // signed out, a template's library parts wait for a sign-in; the project itself is made and works
        const parts = d.partsSkipped ? [`The template's library parts were not added: ${d.partsSkipped} Work on the project meanwhile; once the user has signed in, call parts_add with them (\`${d.partsCommand}\`). ${SIGN_IN_ACTION}`] : [];
        return { data: { ...(r.data as object), next: [...setUp, ...parts, "Call project_status with that folder as `dir`, and read its AGENTS.md."] } };
      },
    }),
    tool({
      name: "project_check",
      title: "Check the project",
      description:
        "Resolves the project and runs every available validator (`protoboard check`). Returns the validators that ran or were skipped, the diagnostics at or above `severity` (default warning) with their code, message and source location, and the counts of all of them. `ok` is false when there are errors. Run it before and after every change. A passing check validates the model only; it does not establish physical readiness. Reads only.",
      input: { dir: DIR, severity: z.enum(SEVERITY).optional().describe("The lowest severity to return: error, warning (default) or info.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async handler({ dir: given, severity }, ctx) {
        const dir = await ctx.dir(given);
        const rank = SEVERITY.indexOf(severity ?? "warning");
        return command(ctx, dir, cliArgs(["check"]), (data) => {
          const d = data as { checks?: unknown; diagnostics?: { severity: (typeof SEVERITY)[number] }[] };
          const all = d.diagnostics ?? [];
          const counts = Object.fromEntries(SEVERITY.map((s) => [s, all.filter((x) => x.severity === s).length]));
          const shown = all.filter((x) => SEVERITY.indexOf(x.severity) <= rank);
          return { ok: !counts.error, counts, checks: d.checks, diagnostics: shown, ...(shown.length < all.length ? { notShown: `${all.length - shown.length} below ${severity ?? "warning"}; pass severity: "info" for all` } : {}) };
        });
      },
    }),
    tool({
      name: "project_inspect",
      title: "Inspect the system or an instance",
      description:
        "The system as it resolved (`protoboard inspect`): instances, definitions by tier (catalog, project-researched, project-specific), links, artifacts and what each validator found. With `instance` (a path such as board/mcu or arm_fl/motor): that instance's definition, origin and pinned revision, interfaces, children, links, artifacts and diagnostics. Reads only.",
      input: { dir: DIR, instance: z.string().optional().describe("An instance path, as the summary lists them. Left out: the whole system.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir, instance }, ctx) => command(ctx, await ctx.dir(dir), cliArgs(["inspect"], {}, instance ? [instance] : [])),
    }),
    tool({
      name: "project_build",
      title: "Build the project",
      description:
        "Writes the resolved project and the UHD bundle the viewer reads (`protoboard build`). CHANGES FILES: only derived data under .protoboard/build/ in the project, which is rebuilt from the sources every time and is not committed. Returns the files written and the diagnostic counts. Publishes nothing.",
      input: { dir: DIR },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir }, ctx) => command(ctx, await ctx.dir(dir), cliArgs(["build"])),
    }),
    tool({
      name: "project_layout",
      title: "Measure and tidy the diagram's layout",
      description:
        "The diagram's layout measured level by level, as the viewer draws it (`protoboard layout`): line crossings, overlapping cards, the longest row or column of cards (a strip), the aspect ratio, lines under cards, and what to fix. Run it before you call a build done, and fix what it reports. `mode: \"apply\"` lays the level(s) out afresh and `mode: \"tidy\"` keeps the saved arrangement and fixes it; either CHANGES FILES: it writes the diagram's layout to .protoboard/display.json (the one file under .protoboard/ an agent may write), and only for levels where the result reads clearly better and that already have a saved layout. `pin` keeps cards where they are. Look at the result in the viewer afterwards.",
      input: {
        dir: DIR,
        level: z.string().optional().describe("One level: the instance path of the module it shows (board, arm_fl). Left out: every level, the top included."),
        mode: z.enum(["report", "apply", "tidy"]).optional().describe("report (default) writes nothing; apply lays out afresh; tidy fixes the saved arrangement."),
        pin: z.array(z.string()).optional().describe("Cards (node ids on the level) that keep their places."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir, level, mode, pin }, ctx) =>
        command(ctx, await ctx.dir(dir), cliArgs(["layout", ...(mode === "apply" ? ["--apply"] : mode === "tidy" ? ["--tidy"] : [])], { pin: pin?.length ? pin.join(",") : undefined }, level ? [level] : [])),
    }),
    tool({
      name: "parts_search",
      title: "Search the part libraries",
      description:
        "Searches the project's part libraries (`protoboard parts search`), the Protoboard library first. Returns each part's id, recommended revision, manufacturer, part number, protocols, domains and the library it comes from; `nextCursor` gives the next page. Needs the user to be signed in, as everything in the Protoboard library does: without a sign-in the result is `signInRequired` and says what to ask the user. Reaches the libraries over the network; writes nothing.",
      input: {
        dir: DIR,
        query: z.string().optional().describe('Words to search for: a part number, a function ("buck-boost 3.3V"), a manufacturer.'),
        taxonomy: z.string().optional().describe("A category path of the library's taxonomy."),
        domain: z.string().optional(),
        protocol: z.string().optional().describe("A protocol the part speaks, such as i2c or spi."),
        tag: z.string().optional(),
        sort: z.enum(LIBRARY_SORTS as unknown as [string, ...string[]]).optional().describe("Order: relevance (the default), name, manufacturer or updated."),
        limit: z.number().int().min(1).max(50).optional().describe("Parts per page (default 20 here)."),
        cursor: z.string().optional().describe("The previous page's nextCursor."),
        library: z.string().optional().describe("Search only this library id."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      async handler({ dir, query, taxonomy, domain, protocol, tag, sort, limit, cursor, library }, ctx) {
        // the words are the query, whatever they look like: "-5V regulator" and "--help" are searches
        return command(ctx, await ctx.dir(dir), cliArgs(["parts", "search"], { taxonomy, domain, protocol, tag, sort, limit: limit ?? 20, cursor, library }, query ? query.split(/\s+/) : []));
      },
    }),
    tool({
      name: "parts_add",
      title: "Add library parts to the project",
      description:
        "Vendors library parts into the project (`protoboard parts add`). CHANGES FILES: writes each part's definition, its .uhd.ts source, its files and the parts it contains into parts/catalog, and pins the revision in parts/origins.json. It adds; it does not change the project's own sources. Needs the user to be signed in: without a sign-in the result says so and what to ask the user. Vendored parts are immutable: never edit parts/catalog afterwards. Orders and publishes nothing.",
      input: {
        dir: DIR,
        parts: z.array(z.string()).min(1).describe('Part ids from parts_search, each optionally pinned to a revision: "ti-tps63020dsjr" or "ti-tps63020dsjr@3". Default revision: the recommended one.'),
        library: z.string().optional().describe("Take them from this library id instead of the first that has them."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      async handler({ dir: given, parts, library }, ctx) {
        const dir = await ctx.dir(given);
        const r = await command(ctx, dir, cliArgs(["parts", "add"], { library }, parts));
        // a part the service refused for want of an account comes back as a result line, not as a failed command
        const lines = (r.data as { results?: { status?: string; message?: string }[] }).results;
        const blocked = lines?.find((x) => x.message && SIGN_IN.test(x.message));
        return blocked ? { data: { ...(r.data as object), signInRequired: true, action: SIGN_IN_ACTION } } : r;
      },
    }),
    tool({
      name: "parts_list",
      title: "List the project's parts",
      description:
        "The project's parts (`protoboard parts list`): library parts with their pinned revision (and `diverged` when their vendored files were edited), parts researched in the project (parts/local) and modules designed in it (src/). Offline unless `checkUpdates` asks the libraries which parts have a newer recommended revision. Reads only.",
      input: { dir: DIR, checkUpdates: z.boolean().optional().describe("Ask the libraries for updates (network).") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: async ({ dir, checkUpdates }, ctx) => command(ctx, await ctx.dir(dir), cliArgs(["parts", "list", ...(checkUpdates ? ["--check"] : [])])),
    }),
    tool({
      name: "skills_list",
      title: "List the installed skills",
      description:
        "The skills the project's extensions ship (`protoboard skills`): each one's id, a one-line summary, the extension it belongs to and its SKILL.md file. A skill is the procedure for one stage of the work (research a part, compose the system, lay out a board, write the release). Start with build-a-project. Reads only.",
      input: { dir: DIR },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir }, ctx) => command(ctx, await ctx.dir(dir), cliArgs(["skills"])),
    }),
    tool({
      name: "skill_read",
      title: "Read a skill",
      description: "The full text of one installed skill (its SKILL.md), by the id skills_list gives, such as build-a-project or uhd-part-research. Follow it for that stage of the work. Reads only.",
      input: { dir: DIR, id: z.string().describe("The skill's id, from skills_list.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async handler({ dir: given, id }, ctx) {
        const dir = await ctx.dir(given);
        const r = readCliJson(await ctx.cli(dir, cliArgs(["skills"])));
        if (!r.ok) return failure(r.message, dir, r.code);
        const skills = (Array.isArray(r.data) ? r.data : []) as { id: string; file: string | null; extension?: string; provider?: string; summary?: string }[];
        const same = skills.filter((s) => s.id === id);
        if (same.length > 1) return { data: { error: `the skill "${id}" is declared by ${same.length} extensions (${same.map((s) => (s.provider && s.provider !== s.extension ? `${s.extension} (${s.provider})` : s.extension)).join(", ")}): which one is meant cannot be told; \`protoboard doctor\` in the project reports it` }, isError: true };
        const skill = same[0];
        if (!skill) return { data: { error: `no skill "${id}" is installed in this project`, installed: skills.map((s) => s.id) }, isError: true };
        if (!skill.file) return { data: { error: `the skill "${id}" is declared by ${skill.extension} but its file was not found; \`protoboard doctor\` in the project says why (\`protoboard stack link\` links missing packages)` }, isError: true };
        // only a file the CLI itself named is read
        return { data: `# Skill ${skill.id} (${skill.extension}): ${skill.file}\n\n${readFileSync(skill.file, "utf8")}` };
      },
    }),
    tool({
      name: "bom",
      title: "Bill of materials",
      description:
        "The design's bill of materials in US dollars (`protoboard bom`, schema protoboard.bom/v0): lines grouped by top-level module, each with the offer chosen for it, what must be ordered (packs, minimum orders, price breaks) and its cost; the totals per unit and per order; counts of unpriced and stale lines. `units` is how many to build (default: the project's parts/bom.json). `release` reads a release's ordering list instead of the design. Each line says how many offers it has (`offerCount`); the offers themselves are listed by `protoboard bom offers <line>` in a shell. Offline: it fetches no prices. Reads only.",
      input: {
        dir: DIR,
        units: z.number().int().min(1).optional().describe("How many units to build. Default: the units in the project's parts/bom.json, else 1."),
        release: z.string().optional().describe("A release version, such as 0.1.0: that release's ordering list instead of the design."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir, units, release }, ctx) => command(ctx, await ctx.dir(dir), cliArgs(["bom"], { units, release }), compactBom),
    }),
    tool({
      name: "release_check",
      title: "Would a release be accepted?",
      description:
        "Runs a release's preconditions only (`protoboard release --check`): the check has no errors, no output is stale, the project has no uncommitted changes. Returns whether a release would be written and every reason it would be refused. Writes nothing: no package, no operation record. The release itself (`protoboard release`) is a shell command for the user to approve; this server has no tool that writes, publishes or uploads one.",
      input: { dir: DIR, version: z.string().optional().describe("The release version to check for. Default: the root module's version.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir, version }, ctx) => command(ctx, await ctx.dir(dir), cliArgs(["release", "--check"], { version })),
    }),
  ];
  // every tool runs the Protoboard CLI in the project, which evaluates the project's TypeScript (protoboard.config.ts, its
  // model files) and may be the project's own CLI from node_modules: none is read-only, so a client asks before it runs (PB-1048)
  for (const s of specs) if (!s.description.includes(RUNS_PROJECT_CODE)) s.description = `${s.description} ${RUNS_PROJECT_CODE}`;
  for (const s of specs) if (s.description.length > DESCRIPTION_LIMIT) throw new Error(`the description of ${s.name} is ${s.description.length} characters; clients cut it at ${DESCRIPTION_LIMIT}`);
  return specs;
}
