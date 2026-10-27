/**
 * `init`: scaffold a portable project (docs/specs/protoboard-project-structure.md),
 * empty or from a project template (`--template drone|wearable|iot`, PB-818).
 *
 * A template is a folder in this package's `templates/`: `template.json` (what
 * it is, the extensions it installs, the catalog parts its starting system
 * uses) and `files/`, copied into the project. Files ending in `.tmpl` have
 * `{{id}}`, `{{snake}}` (the id with underscores), `{{name}}` and `{{CONST}}` replaced and lose the suffix. Catalog
 * parts are not shipped with the template: they come from the parts service
 * like any other catalog part (`vendorTemplateParts`, which `protoboard init`
 * runs), so their files arrive with their terms and digests.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectLibraries } from "./libraries.js";
import type { AccountTokens } from "./library-client.js";
import { addParts, type AddResult } from "./parts.js";
import type { Project } from "./project.js";
import type { ProtoboardConfig } from "./types.js";
import { projectRelative } from "./paths.js";
import { stackRangeFor } from "./stack.js";

const constName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "SYSTEM";

/** This package's manifest: new projects depend on the stack version that created them. */
const CORE_PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string; dependencies?: Record<string, string>; protoboard?: { toolchain?: { uhd?: string; typescript?: string } } };
const STACK_RANGE = stackRangeFor(CORE_PKG.version);
/**
 * The UHD and TypeScript versions new projects pin exactly (PB-910): library
 * parts ship .uhd.ts source that declares the UHD range it needs (like a
 * peerDependency) and the TypeScript it is written for, and `check` holds
 * the project to them. The stack declares them in its package.json
 * (`protoboard.toolchain`).
 */
export const TOOLCHAIN = { uhd: CORE_PKG.protoboard?.toolchain?.uhd ?? "0.3.0", typescript: CORE_PKG.protoboard?.toolchain?.typescript ?? "7.0.2" };

/** The templates shipped with @protoboardai/core. */
export const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

/**
 * What every new project's AGENTS.md says, whatever it starts from (the three
 * templates' AGENTS.md.tmpl take it at `{{agents-common}}`, a project with no
 * template before its commands): the words (module, part, interface, link,
 * harness, board, DRC, and node, handle, edge for what people see), the
 * global install and how to run the command, looking at the project before
 * describing it, and the diagram's layout file.
 */
export const AGENTS_COMMON = readFileSync(join(TEMPLATES_DIR, "_agents", "common.md"), "utf8").trim() + "\n";

/** The markers around the shared guidance in AGENTS.md: what `init --refresh-guidance` rewrites (F03). */
export const GUIDANCE_BEGIN = "<!-- protoboard:guidance:begin (written by Protoboard; `protoboard init --refresh-guidance` brings it up to date: edit outside it) -->";
export const GUIDANCE_END = "<!-- protoboard:guidance:end -->";
/** The shared guidance as a new project's AGENTS.md carries it, between its markers. */
export const AGENTS_GUIDANCE = `${GUIDANCE_BEGIN}\n${AGENTS_COMMON}${GUIDANCE_END}\n`;

const SKILLS_BLOCK = "<!-- protoboard:skills:begin";

/**
 * AGENTS.md with its shared guidance replaced by this stack's (F03). Between
 * the markers when it has them; in a project from before the markers, the
 * run of sections the guidance names (`## Words` … `## Placing parts in the
 * 3D view`), wherever they are; with neither, the guidance goes in before the
 * commands (or the skills list, or at the end). Everything else is kept.
 */
export function withCurrentGuidance(text: string): { text: string; how: "replaced" | "inserted" | "unchanged" } {
  const done = (next: string, how: "replaced" | "inserted") => ({ text: next, how: next === text ? ("unchanged" as const) : how });
  const b = text.indexOf("<!-- protoboard:guidance:begin");
  const e = text.indexOf(GUIDANCE_END);
  if (b >= 0 && e > b) return done(text.slice(0, b) + AGENTS_GUIDANCE + text.slice(e + GUIDANCE_END.length).replace(/^\n/, ""), "replaced");
  const headings = new Set([...AGENTS_COMMON.split("\n").filter((l) => l.startsWith("## ")), ...EARLIER_HEADINGS].map((l) => l.trim()));
  const lines = text.split("\n");
  const shared = (l: string) => l.startsWith("## ") && headings.has(l.trim());
  const start = lines.findIndex(shared);
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !(lines[end].startsWith("## ") && !shared(lines[end])) && !lines[end].startsWith(SKILLS_BLOCK)) end++;
    return done([...lines.slice(0, start), ...AGENTS_GUIDANCE.split("\n").slice(0, -1), "", ...lines.slice(end)].join("\n"), "replaced");
  }
  const at = [lines.findIndex((l) => /^## Commands\b/.test(l)), lines.findIndex((l) => l.startsWith(SKILLS_BLOCK))].find((i) => i >= 0);
  if (at === undefined) return done(`${text.replace(/\n*$/, "\n")}\n${AGENTS_GUIDANCE}`, "inserted");
  return done([...lines.slice(0, at), ...AGENTS_GUIDANCE.split("\n").slice(0, -1), "", ...lines.slice(at)].join("\n"), "inserted");
}

/** Headings the shared guidance had in earlier stacks (0.1.6, 0.1.7), so a refresh finds it there too. */
const EARLIER_HEADINGS = ["## Words", "## Protoboard on this machine", "## Skills", "## Protoboard's MCP server", "## When this project sits inside a larger workspace", "## Circuit boards (PCB)", "## Look before you describe", "## The diagram's layout", "## Placing parts in the 3D view"];

/** Lines outside the shared guidance that send agents to npm, as AGENTS.md of 0.1.6 and earlier said (F03). */
const STALE_LINES: [RegExp, string][] = [
  [/npm install @protoboardai\/|npm i @protoboardai\//, "tells agents to npm install a Protoboard package; extensions are added with `protoboard extensions add <name>`"],
  [/npm run skills:export/, "names `npm run skills:export`; it is `protoboard skills export --host all`"],
  [/lists no extension yet/, "says the project lists no extension; `protoboard.config.ts` says which it lists"],
];

export interface GuidanceRefresh {
  root: string;
  /** AGENTS.md: its shared guidance replaced, added, already current, or the file written new. */
  agents: "replaced" | "inserted" | "unchanged" | "written";
  /** CLAUDE.md: written (it was missing), or kept as it was. */
  claude: "written" | "kept";
  /** What to look at by hand: lines outside the guidance that contradict it, a CLAUDE.md that does not import AGENTS.md. */
  notes: string[];
}

/**
 * Bring an existing project's agent guidance to this stack's (F03, PB-1028):
 * the shared sections of AGENTS.md (withCurrentGuidance), a CLAUDE.md that
 * imports it when there is none. The project's own sections are kept; lines
 * in them that send agents to npm are reported, not rewritten. The skills
 * list at the end of AGENTS.md is `protoboard skills export`'s.
 */
export function refreshGuidance(root: string, name = basename(root)): GuidanceRefresh {
  const notes: string[] = [];
  const file = join(root, "AGENTS.md");
  let agents: GuidanceRefresh["agents"];
  let text: string;
  if (!existsSync(file)) {
    text = `# ${name}\n\nA Protoboard hardware project. The system is described in UHD\n(\`@deltarobotics/uhd\`); read the **build-a-project** skill first\n(\`protoboard skills read build-a-project\`).\n\n${AGENTS_GUIDANCE}`;
    agents = "written";
  } else {
    const r = withCurrentGuidance(readFileSync(file, "utf8"));
    text = r.text;
    agents = r.how;
  }
  if (agents !== "unchanged") writeFileSync(file, text);
  const lines = text.split("\n");
  const b = lines.findIndex((l) => l.startsWith("<!-- protoboard:guidance:begin"));
  const e = lines.findIndex((l) => l.startsWith(GUIDANCE_END));
  lines.forEach((l, i) => {
    if (i >= b && i <= e) return;
    for (const [re, what] of STALE_LINES) if (re.test(l)) notes.push(`AGENTS.md line ${i + 1} ${what}: edit or remove it`);
  });
  const claudeFile = join(root, "CLAUDE.md");
  let claude: GuidanceRefresh["claude"] = "kept";
  if (!existsSync(claudeFile)) {
    writeFileSync(claudeFile, CLAUDE_MD);
    claude = "written";
  } else if (!/^@AGENTS\.md\s*$/m.test(readFileSync(claudeFile, "utf8"))) notes.push("CLAUDE.md does not import AGENTS.md: add a line `@AGENTS.md` to it, or Claude Code will not read this project's guidance");
  return { root, agents, claude, notes };
}

export interface ProjectTemplate {
  /** `--template` value. */
  id: string;
  title: string;
  description: string;
  /** The reference project it is derived from (in the stack repository). */
  derivedFrom: string;
  /** Extension packages the project installs and lists in protoboard.config.ts. */
  extensions: string[];
  /** Other stack packages the template's sources import (installed, not listed as extensions). */
  dependencies?: string[];
  /** Catalog parts of the starting system, pinned (`<id>@<revision>`), vendored from the parts service. */
  catalogParts: string[];
  /** Extra package.json scripts. */
  scripts?: Record<string, string>;
  /**
   * package.json `overrides` the project needs so an extension's dependencies
   * resolve as they do in the stack's workspace. ext-tscircuit pins
   * circuit-json, which @tscircuit/checks and @tscircuit/core take as a peer:
   * without the override a fresh install can hoist an older circuit-json from
   * other tscircuit packages, and the board DRC does not run. It also points
   * @tscircuit/pcb-trace-linter (which @tscircuit/capacity-autorouter names as
   * a GitHub dependency, so npm would fetch it over git+ssh) at the same
   * commit's HTTPS tarball, so an install needs no GitHub SSH key.
   */
  overrides?: Record<string, string>;
  /**
   * npm settings the project's `.npmrc` carries, as the stack's workspace sets
   * them. ext-tscircuit needs `legacy-peer-deps=true`: tscircuit packages import
   * circuit-json without declaring it (it must sit at the project's top level),
   * and with peers installed npm places it out of their reach or refuses
   * circuit-json's own TypeScript 5 peer.
   */
  npmrc?: Record<string, string>;
}

export function listTemplates(): ProjectTemplate[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .filter((d) => existsSync(join(TEMPLATES_DIR, d, "template.json")))
    .sort()
    .map((d) => loadTemplate(d));
}

export function loadTemplate(id: string): ProjectTemplate {
  const file = join(TEMPLATES_DIR, id, "template.json");
  if (!/^[a-z0-9-]+$/.test(id) || !existsSync(file)) {
    const known = listTemplates().map((t) => t.id);
    throw new Error(`no project template "${id}" (templates: ${known.join(", ") || "none installed"})`);
  }
  return { ...JSON.parse(readFileSync(file, "utf8")), id } as ProjectTemplate;
}

/** Every file under dir, relative to it. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p, base) : [projectRelative(base, p)];
    });
}

export interface InitResult {
  root: string;
  files: string[];
  /** Files that were in the folder and were kept as they were (a CLAUDE.md a workspace wrote first). */
  kept?: string[];
  /** What to know about a kept file (a CLAUDE.md that does not import AGENTS.md). */
  notes?: string[];
  template?: ProjectTemplate;
  /** Catalog parts the starting system needs (vendor them with `vendorTemplateParts`). */
  catalogParts: string[];
}

/** The `cloud` entry of a new project's config: where its catalog parts and sign-in come from. */
function cloudEntry(url: string): string {
  return `  // the Protoboard library (\`protoboard parts …\`, \`protoboard login\`); PROTOBOARD_CLOUD_URL or --url
  // overrides it, e.g. http://localhost:8787 for a parts service on this machine
  cloud: { url: ${JSON.stringify(url.replace(/\/+$/, ""))} },
`;
}

/**
 * Scaffold a project. `cloudUrl`, when given, is written as the project's
 * `cloud.url` (`protoboard init` passes the hosted library, PB-915);
 * without it the project uses the default (PROTOBOARD_CLOUD_URL, then
 * localhost).
 */
/**
 * What a project's `npm install` runs last (its `postinstall`): the skills of
 * the extensions it lists go to `.claude/skills/` and into AGENTS.md. `init`
 * cannot do it: the skills are read from the installed extension packages,
 * which are not there until `npm install` (and the CLI does not carry the
 * extensions itself). `--on-install` prints one line and never fails;
 * `|| exit 0` covers a CLI that is not installed (`--omit=dev`) or is older.
 */
export const SKILLS_EXPORT_SCRIPT = "protoboard skills export --host all";
export const SKILLS_POSTINSTALL_SCRIPT = `${SKILLS_EXPORT_SCRIPT} --on-install || exit 0`;

/**
 * What a new project's CLAUDE.md holds: Claude Code reads CLAUDE.md and not
 * AGENTS.md, so it imports AGENTS.md and says nothing of its own (PB-1018).
 */
export const CLAUDE_MD = "@AGENTS.md\n";

/** The extension a blank project lists: the order of work (build-a-project) and the system skills. */
export const BLANK_EXTENSIONS = ["@protoboardai/ext-hardware"];

/**
 * Files a folder may already hold for `init` to make a project in it, kept as
 * they are: a CLAUDE.md a workspace wrote when it made the folder (a company
 * workspace's `projects/<group>/<project>/protoboard/`), and what file
 * managers and git leave.
 */
export const KEPT_ON_INIT: ReadonlySet<string> = new Set(["CLAUDE.md", ".gitkeep", ".DS_Store", "Thumbs.db", "desktop.ini"]);

/**
 * `skills: false` (`protoboard init --no-skills`) leaves the `postinstall`
 * out: nothing is exported until `npm run skills:export`.
 */
export function initProject(dir: string, options: { name?: string; uhd?: string; template?: string; cloudUrl?: string; skills?: boolean } = {}): InitResult {
  const template = options.template ? loadTemplate(options.template) : undefined;
  const root = resolve(dir);
  const present = existsSync(root) ? readdirSync(root) : [];
  const others = present.filter((f) => !KEPT_ON_INIT.has(f));
  if (others.length) throw new Error(`${root} is not empty (${others.slice(0, 5).join(", ")}${others.length > 5 ? ", …" : ""}); a project is made in an empty folder, or one that holds only a CLAUDE.md`);
  const kept = present.filter((f) => f === "CLAUDE.md");
  const name = options.name ?? basename(root);
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const C = constName(name);
  const extensions = template?.extensions ?? BLANK_EXTENSIONS;
  const files: Record<string, string> = {
    "package.json": JSON.stringify(
      {
        name: id,
        private: true,
        type: "module",
        scripts: {
          check: "protoboard check",
          build: "protoboard build",
          inspect: "protoboard inspect",
          ...(template ? { doctor: "protoboard doctor", typecheck: "tsc --noEmit -p ." } : {}),
          "skills:export": SKILLS_EXPORT_SCRIPT,
          ...(options.skills === false ? {} : { postinstall: SKILLS_POSTINSTALL_SCRIPT }),
          ...(template?.scripts ?? {}),
        },
        dependencies: {
          "@deltarobotics/uhd": options.uhd ?? TOOLCHAIN.uhd,
          "@protoboardai/core": STACK_RANGE,
          ...Object.fromEntries([...extensions, ...(template?.dependencies ?? [])].map((e) => [e, STACK_RANGE])),
        },
        devDependencies: {
          "@protoboardai/cli": STACK_RANGE,
          // the TypeScript the project's sources and vendored part sources are checked with (pinned, PB-910);
          // `npm run typecheck` runs it against the stack's types
          ...(template ? { "@types/node": "^26.1.2" } : {}),
          typescript: TOOLCHAIN.typescript,
        },
        ...(template?.overrides ? { overrides: template.overrides } : {}),
      },
      null,
      2,
    ) + "\n",
    "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "${id}",
  // the root system and every local definition (exported ModuleDefs): parts designed
  // here in src/, purchased parts researched here in parts/local/ (evidence in parts/evidence/<id>/)
  root: { source: "src/${id}.uhd.ts", export: "${C}" },
  sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
  // catalog parts from the Protoboard Cloud parts service (\`protoboard parts add\`);
  // provenance and digests in parts/origins.json
  catalog: "parts/catalog",
${options.cloudUrl ? cloudEntry(options.cloudUrl) : ""}  // extension packages (\`protoboard extensions add <name>\` adds one);
  // \`protoboard doctor\` reports their tools, \`protoboard skills\` their skills
  extensions: ${JSON.stringify(extensions)},
});
`,
    [`src/${id}.uhd.ts`]: `import type { ModuleDef } from "@deltarobotics/uhd";

/** Root system: add children (module instances) and links between their interfaces. */
export const ${C}: ModuleDef = {
  id: "${id}",
  name: "${name}",
  kind: "module",
  interfaces: [],
  children: [],
  links: [],
};
`,
    "parts/origins.json": JSON.stringify({ schema: "protoboard.origins/v0", definitions: {} }, null, 2) + "\n",
    "parts/catalog/.gitkeep": "",
    "parts/local/.gitkeep": "",
    "parts/evidence/.gitkeep": "",
    "docs/brief.md": `# ${name}: brief\n\nRequirements and acceptance targets. Cite sources for every number.\n`,
    // what the product is, for the documents' first page (PB-935): empty until the project states it; `release --check` says what is missing
    "docs/product.json": JSON.stringify({ schema: "protoboard.product/v0", summary: "", features: [], functions: [], requirements: [] }, null, 2) + "\n",
    "docs/decisions.md": `# Decisions\n\nOne entry per engineering decision: context, options, choice, evidence.\n`,
    ".gitignore": `node_modules/\n.protoboard/cache/\n.protoboard/local/\n.protoboard/build/\n.protoboard/tools/\n.protoboard/evals/\n# research working files: downloads, parsed text, notes\nparts/evidence/*/.research/\n# skills copied from the project's extensions (protoboard skills export)\n.claude/skills/\n# an agent's configuration as it was before protoboard agents setup --scope project changed it\n*.protoboard-backup\n# the Manufacturing Package (protoboard release): rebuilt from the committed project\nrelease/\n# a board's KiCad preview (circuit:kicad), rewritten each time; a locked board's kicad/ is committed\nsrc/boards/*/tscircuit/kicad/\n`,
    "CLAUDE.md": CLAUDE_MD,
    "AGENTS.md": `# ${name}

A Protoboard hardware project. The system is described in UHD
(\`@deltarobotics/uhd\`): modules, interfaces, links, harnesses, artifacts.

**Agents, start here.** Read this file, then the **build-a-project** skill
(\`protoboard skills read build-a-project\`; Skills, below): it gives the
order of work from \`docs/brief.md\` to a release and names the skill for
each stage. This project lists one extension, \`@protoboardai/ext-hardware\`
(the order of work and the system skills); \`protoboard extensions add
<name>\` adds another, such as \`ext-tscircuit\` for a circuit board or
\`ext-enclosure-cad\` for an enclosure. Its skills are listed at the end of
this file. Before changing anything, and before describing the project to
anyone, run \`protoboard doctor\`, \`protoboard check\` and \`protoboard
inspect\`. The UHD reference is in \`node_modules/@deltarobotics/uhd/docs\`,
and how to write UHD is the **uhd-authoring** skill,
\`node_modules/@deltarobotics/uhd/skills/uhd-authoring/SKILL.md\`.

With Protoboard's MCP server connected (\`protoboard-stack\`, registered by
\`protoboard agents setup\` or the Protoboard settings page in VS Code), the
commands below are also tools: call \`project_status\` first. The tools and
the commands do the same thing.

${AGENTS_GUIDANCE}
## Commands (headless; add \`--format json\` for machine output)

- \`protoboard inspect [instance]\` — system, definitions, origins, artifacts, diagnostics
- \`protoboard check\` — resolve and run every available validator; nonzero exit on errors
- \`protoboard build\` — write \`.protoboard/build/resolved.json\` (derived data)
- \`protoboard parts search <words>\` — search the Protoboard Cloud parts catalog
- \`protoboard parts add <id>[@rev]\` — vendor a catalog revision, its closure and files into \`parts/catalog\`
- \`protoboard parts update [id]\` — what the catalog recommends now; \`--to <rev>\` re-pins deliberately
- \`protoboard parts publish parts/local/<id>.uhd.ts\` — promote a researched part to the catalog (needs \`PROTOBOARD_CLOUD_TOKEN\`)
- \`protoboard doctor\` — extensions, external tools (present or missing), runtimes, skills
- \`protoboard tools install <cad|circuit|all>\` — install the tool runtimes the extensions declare into \`.protoboard/tools/\`
- \`protoboard skills\` — installed skills; \`protoboard skills read <name>\` prints one; \`protoboard skills export --host all\` copies them to \`.claude/skills/\` and lists them in this file
- \`protoboard extensions add <name>\` — add an extension (listed, linked from this machine's Protoboard, its skills exported)
- \`protoboard run <operation>\` — extension operations (recorded under \`operations/\`)

## Conventions

- Parts come from three tiers: the cloud catalog (\`parts/catalog\`, vendored by
  \`parts add\`, pinned in \`parts/origins.json\`), purchased parts researched in this
  project (\`parts/local/<id>.uhd.ts\`, evidence in \`parts/evidence/<id>/\`), and
  modules designed here (\`src/\`). Cite sources; mark assumptions.
- Catalog definitions and their files in \`parts/catalog\` are immutable (digest-pinned;
  \`check\` verifies them offline). Derive a local variant with its own id instead of
  editing one. Updates are deliberate (\`parts update <id> --to <rev>\`).
- The parts service is needed only by \`parts search|add|update|publish\` (URL from
  \`PROTOBOARD_CLOUD_URL\`, then \`cloud.url\` in protoboard.config.ts, default
  http://localhost:8787). Sign in with \`protoboard login\`; never put a token in a file.
- Decisions go in \`docs/decisions.md\`; the brief in \`docs/brief.md\`. What the product
  is goes in \`docs/product.json\` (summary, features, functions, requirements with how
  each is shown): the Manufacturing Package and the datasheet open with it.
- A passing \`check\` validates the model only; it does not establish physical readiness.
`,
  };
  if (template) {
    // the template's own files replace the generic ones (config, root system, AGENTS.md, brief)
    delete files["protoboard.config.ts"];
    delete files[`src/${id}.uhd.ts`];
    delete files["AGENTS.md"];
    delete files["docs/brief.md"];
    {
      // editor and `tsc` support for the project's own TypeScript (protoboard itself runs it through tsx)
      files["tsconfig.json"] = JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022"],
            types: ["node"],
            module: "NodeNext",
            moduleResolution: "NodeNext",
            resolveJsonModule: true,
            strict: true,
            noEmit: true,
            allowImportingTsExtensions: true,
            skipLibCheck: true,
            isolatedModules: true,
            verbatimModuleSyntax: true,
          },
          include: ["src", "parts/local", "protoboard.config.ts"],
        },
        null,
        2,
      ) + "\n";
    }
  }
  if (template?.npmrc && Object.keys(template.npmrc).length) {
    files[".npmrc"] =
      "# npm settings of the Protoboard Stack's workspace that this project's extensions need (packages/ext-tscircuit/README.md)\n" +
      Object.entries(template.npmrc).map(([k, v]) => `${k}=${v}\n`).join("");
  }
  // a CLAUDE.md the folder already holds is the workspace's: kept as it is
  const notes: string[] = [];
  if (kept.includes("CLAUDE.md")) {
    delete files["CLAUDE.md"];
    if (!/^@AGENTS\.md\s*$/m.test(readFileSync(join(root, "CLAUDE.md"), "utf8")))
      notes.push("CLAUDE.md was kept as it was, and it does not import AGENTS.md: add a line `@AGENTS.md` to it, or Claude Code will not read this project's guidance.");
  }
  const out: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
    out.push(rel);
  }
  if (template) {
    const src = join(TEMPLATES_DIR, template.id, "files");
    const fill = (text: string) => text.replace(/^[ \t]*\{\{cloud\}\}\n/m, options.cloudUrl ? cloudEntry(options.cloudUrl) : "").replaceAll("{{agents-common}}\n", AGENTS_GUIDANCE).replaceAll("{{id}}", id).replaceAll("{{snake}}", id.replace(/-/g, "_")).replaceAll("{{name}}", name).replaceAll("{{CONST}}", C);
    for (const rel of walk(src)) {
      const from = join(src, rel);
      const to = rel.endsWith(".tmpl") ? rel.slice(0, -".tmpl".length) : rel;
      mkdirSync(dirname(join(root, to)), { recursive: true });
      if (rel.endsWith(".tmpl")) writeFileSync(join(root, to), fill(readFileSync(from, "utf8")));
      else cpSync(from, join(root, to));
      if (!out.includes(to)) out.push(to);
    }
  }
  return { root, files: out, ...(kept.length ? { kept } : {}), ...(notes.length ? { notes } : {}), ...(template ? { template } : {}), catalogParts: template?.catalogParts ?? [] };
}

/**
 * Vendor a template's catalog parts into a project that was just created,
 * before its packages are installed: the project's config cannot be loaded
 * yet (it imports @protoboardai/core), and a new project has no local
 * definitions that could collide with catalog ids, so this uses the
 * default library at `url` (or PROTOBOARD_CLOUD_URL, then
 * http://localhost:8787) and the default catalog folder.
 */
export async function vendorTemplateParts(root: string, refs: string[], options: { url?: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: string; accountTokens?: AccountTokens } = {}): Promise<{ service: string; results: AddResult[] }> {
  const config: ProtoboardConfig = { root: { source: "", export: "" }, catalog: "parts/catalog" };
  const libs = connectLibraries(config, { ...(options.url ? { url: options.url } : {}), ...(options.env ? { env: options.env } : {}), ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.accountTokens ? { accountTokens: options.accountTokens } : {}) });
  const project = { root, name: basename(root), config, definitions: new Map(), diagnostics: [] } as unknown as Project;
  const results = await addParts(project, refs, libs, options.now ? { now: options.now } : {});
  return { service: libs[0].url, results };
}
