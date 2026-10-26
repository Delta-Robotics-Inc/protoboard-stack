/**
 * The SOP skill set (PB-844, docs/guides/sop-format.md): every SKILL.md that
 * an extension in this repository ships follows the SOP format, names only
 * commands, operations, flags, inputs and scripts that exist, is declared in
 * its extension's manifest, and exports to an agent host. Every diagnostic
 * code the stack emits is in the diagnostic-codes reference the skills'
 * failure handling points at.
 *
 * The command table is the CLI's own `--help`, so a command added or renamed
 * in the CLI is seen here without a second list to keep in step.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CAPABILITIES, CAPABILITY_OPERATIONS, initProject } from "@protoboardai/core";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "../../..");
const CLI = join(REPO, "packages/cli/bin/protoboard.mjs");
const TMP = join(HERE, ".tmp-sop");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/**
 * Commands the spec defines that are being built in parallel; the SOPs may
 * name them before they land. Remove an entry when the command lands; from
 * then on its uses are checked like any other command's. (Stack v0.1 phase
 * 3's release, evals and firmware operations have all landed.)
 */
const PLANNED_COMMANDS = new Set<string>([]);

/** The SOP sections, in order (docs/guides/sop-format.md). */
const SECTIONS = ["Purpose", "Inputs", "Steps", "Decision points", "Outputs", "Verification", "Failure handling"];

// ---------------------------------------------------------------------------
// The CLI's command table, from its help

interface CommandTable {
  commands: Map<string, Set<string>>;
  flags: Set<string>;
  runtimes: Set<string>;
}

function commandTable(): CommandTable {
  const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  const help = r.stdout;
  const block = help.slice(help.indexOf("Commands"), help.indexOf("Options"));
  const commands = new Map<string, Set<string>>();
  let runtimes = new Set<string>();
  for (const line of block.split("\n")) {
    const m = /^ {4}([a-z][\w-]*)(?: ([a-z][\w-]*))?(.*)$/.exec(line);
    if (!m) continue;
    const subs = commands.get(m[1]) ?? new Set<string>();
    if (m[2]) subs.add(m[2]);
    commands.set(m[1], subs);
    if (m[1] === "tools" && m[2] === "install") runtimes = new Set(/<([\w|]+)>/.exec(m[3])?.[1].split("|") ?? []);
  }
  const flags = new Set([...help.matchAll(/--([a-z][a-z-]*)/g)].map((x) => x[1]));
  for (const f of ["help", "version"]) flags.add(f); // meow's own
  return { commands, flags, runtimes };
}

// ---------------------------------------------------------------------------
// Extensions in this repository: manifests, operations, skills

interface Manifest {
  id: string;
  skills?: { id: string; summary: string; path: string; package?: string; verifiedBy?: string }[];
  operations?: { id: string; inputs?: Record<string, unknown> }[];
  capabilities?: { id: string; operations: Record<string, unknown> }[];
}

const packages = readdirSync(join(REPO, "packages")).filter((d) => existsSync(join(REPO, "packages", d, "protoboard-extension.json")));
const manifests = new Map(packages.map((d) => [d, JSON.parse(readFileSync(join(REPO, "packages", d, "protoboard-extension.json"), "utf8")) as Manifest]));

/** Every skill any manifest declares, with the file it resolves to. */
const declared = [...manifests].flatMap(([dir, m]) =>
  (m.skills ?? []).map((s) => ({
    ...s,
    dir,
    extension: m.id,
    file: s.package ? join(REPO, "node_modules", s.package, s.path) : join(REPO, "packages", dir, s.path),
    ours: !s.package,
  })),
);
const skillIds = new Set(declared.map((s) => s.id));
const ours = declared.filter((s) => s.ours);

/** Operation id → declared input names (undefined: the operation declares none). */
const operations = new Map<string, Set<string> | undefined>();
for (const m of manifests.values()) for (const o of m.operations ?? []) operations.set(o.id, o.inputs ? new Set(Object.keys(o.inputs)) : undefined);

// the four of every capability, and those a provider declares beside them (circuit:lock)
const capabilityOps = new Set([...CAPABILITIES.flatMap((c) => CAPABILITY_OPERATIONS.map((o) => `${c}:${o}`)), ...[...manifests.values()].flatMap((m) => (m.capabilities ?? []).flatMap((c) => Object.keys(c.operations).map((o) => `${c.id}:${o}`)))]);

/** Every SKILL.md on disk under packages/<ext>/skills/. */
const onDisk = packages.flatMap((d) => {
  const root = join(REPO, "packages", d, "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && f.name === "SKILL.md")
    .map((f) => join(f.parentPath, f.name));
});

// ---------------------------------------------------------------------------
// Reading a SKILL.md

const frontmatter = (text: string) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return Object.fromEntries((m?.[1] ?? "").split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
};

/** `## ` headings outside code fences, with the text under each. */
function sections(text: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (!fence && line.startsWith("## ")) out.push({ title: line.slice(3).trim(), body: "" });
    else if (out.length) out[out.length - 1].body += `${line}\n`;
  }
  return out;
}

/**
 * The protoboard command lines a skill names: every `protoboard …` in a code
 * block or an inline code span (up to a comment, pipe, `;`, `&` or `)`),
 * and inline spans that start with `run <operation>`.
 */
function commandsIn(text: string): string[] {
  const found: string[] = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    const spans = fence ? [line] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const span of spans) {
      for (const m of span.matchAll(/(?:^|[\s(;&|=])(?:npx\s+)?protoboard\s+([a-z][^#`|;&)]*)/g)) found.push(m[1].trim());
      if (!fence) {
        const run = /^run ([a-z][\w:-]*.*)$/.exec(span);
        if (run) found.push(`run ${run[1]}`);
      }
    }
  }
  return found;
}

const placeholder = (t: string | undefined) => !t || /[<…]|\.\.\./.test(t);

/** Problems with one command line against the command table; [] when it exists as written. */
function commandProblems(cmd: string, table: CommandTable): string[] {
  const tokens = cmd.replace(/[[\]]/g, " ").split(/\s+/).filter(Boolean);
  const [c, sub, third] = tokens;
  if (placeholder(c)) return [];
  if (PLANNED_COMMANDS.has(c)) return [];
  if (!table.commands.has(c)) return [`no command "${c}"`];
  const problems: string[] = [];
  const subs = table.commands.get(c)!;
  if (["parts", "skills", "tools"].includes(c) && sub && !sub.startsWith("-") && !placeholder(sub) && !subs.has(sub)) problems.push(`no "${c} ${sub}"`);
  if (c === "tools" && sub === "install" && third && !third.startsWith("-") && !placeholder(third) && !table.runtimes.has(third)) problems.push(`no runtime "${third}"`);
  let inputs: Set<string> | undefined;
  if (c === "run" && !placeholder(sub)) {
    if (sub.includes(":")) {
      if (!capabilityOps.has(sub)) problems.push(`no capability operation "${sub}"`);
    } else if (!operations.has(sub)) problems.push(`no operation "${sub}"`);
    else inputs = operations.get(sub);
  }
  tokens.forEach((t, i) => {
    if (!t.startsWith("--")) return;
    const flag = t.slice(2).split("=")[0];
    if (!table.flags.has(flag)) problems.push(`no flag --${flag}`);
    if (flag === "input" && inputs && !placeholder(tokens[i + 1])) {
      const key = tokens[i + 1]?.split("=")[0];
      if (key && !inputs.has(key)) problems.push(`operation ${sub} has no input "${key}"`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------

describe("the SOP skill set", () => {
  const table = commandTable();

  it("reads the command table from the CLI's help", () => {
    for (const c of ["init", "inspect", "check", "build", "dev", "parts", "doctor", "tools", "skills", "run", "capabilities", "operations"]) expect(table.commands.has(c), c).toBe(true);
    expect([...table.commands.get("parts")!].sort()).toEqual(["add", "list", "migrate", "offers", "prices", "publish", "search", "taxonomy", "update"]);
    expect(table.commands.get("skills")!.has("export")).toBe(true);
    expect(table.runtimes).toEqual(new Set(["cad", "circuit", "all"]));
    for (const f of ["format", "module", "input", "to", "dry-run", "host", "severity"]) expect(table.flags.has(f), f).toBe(true);
    // the checker itself
    expect(commandProblems("run cad:generate --module frame", table)).toEqual([]);
    expect(commandProblems("run part-verify --input part=x", table)).toEqual([]);
    expect(commandProblems("run part-verify --input nope=x", table)).toEqual(['operation part-verify has no input "nope"']);
    expect(commandProblems("frobnicate", table)).toEqual(['no command "frobnicate"']);
    expect(commandProblems("check --bogus", table)).toEqual(["no flag --bogus"]);
    expect(commandsIn("run `npx protoboard run frame-cad --input module=a` and `run harness-cad`\n```bash\nnpx protoboard check   # x | y\n```")).toEqual([
      "run frame-cad --input module=a",
      "run harness-cad",
      "check",
    ]);
  });

  it("planned commands are still missing from the CLI (remove them from PLANNED_COMMANDS once they land)", () => {
    for (const c of PLANNED_COMMANDS) expect(table.commands.has(c), `protoboard ${c} now exists: drop it from PLANNED_COMMANDS and reconcile the SOPs with it`).toBe(false);
  });

  it("every SKILL.md in an extension is declared in its manifest, and every declared skill exists", () => {
    expect(ours.map((s) => s.file).sort()).toEqual([...onDisk].sort());
    for (const s of declared) expect(existsSync(s.file), `${s.extension}: ${s.id}`).toBe(true);
    for (const s of declared) if (s.verifiedBy) expect(skillIds.has(s.verifiedBy), `${s.id} verifiedBy ${s.verifiedBy}`).toBe(true);
    expect(new Set(declared.map((s) => s.id)).size).toBe(declared.length);
  });

  it("every extension with skills ships them in its npm package", () => {
    for (const dir of new Set(ours.map((s) => s.dir))) {
      const pkg = JSON.parse(readFileSync(join(REPO, "packages", dir, "package.json"), "utf8")) as { files?: string[] };
      if (pkg.files) expect(pkg.files, dir).toContain("skills");
    }
  });

  it("the build-a-project SOP is in the general hardware pack, and every board has a circuit SOP", () => {
    expect(ours.find((s) => s.id === "build-a-project")?.extension).toBe("@protoboardai/ext-hardware");
    expect(manifests.get("ext-hardware")!.skills![0].id).toBe("build-a-project");
    expect(ours.find((s) => s.id === "circuit-board")?.extension).toBe("@protoboardai/ext-tscircuit");
  });

  for (const s of ours) {
    describe(s.id, () => {
      const text = readFileSync(s.file, "utf8");
      const secs = sections(text);

      it("has host frontmatter: name = id = folder, a description", () => {
        const fm = frontmatter(text);
        expect(fm.name).toBe(s.id);
        expect(basename(dirname(s.file))).toBe(s.id);
        expect(fm.description?.length).toBeGreaterThan(80);
      });

      it("has the SOP sections in order, other sections only after them", () => {
        const titles = secs.map((x) => x.title);
        expect(titles.slice(0, SECTIONS.length)).toEqual(SECTIONS);
        for (const sec of secs) expect(sec.body.trim().length, `${s.id} § ${sec.title} is empty`).toBeGreaterThan(0);
        const get = (t: string) => secs.find((x) => x.title === t)!.body;
        expect(get("Purpose"), "Purpose says when to use it").toMatch(/\bwhen\b|\buse (it|this)\b/i);
        expect(get("Steps"), "Steps are numbered").toMatch(/^### 1\. /m);
        expect(get("Failure handling"), "Failure handling has a code/symptom → action table").toMatch(/^\|.*\|.*\|/m);
      });

      it("names only commands, operations, flags and inputs that exist", () => {
        const bad = commandsIn(text).flatMap((c) => commandProblems(c, table).map((p) => `\`protoboard ${c}\`: ${p}`));
        expect(bad).toEqual([]);
      });

      it("names only scripts, references and skills that exist", () => {
        const here = dirname(s.file);
        for (const [, pkg, rel] of text.matchAll(/node_modules\/@protoboardai\/([\w-]+)\/([\w./-]+\.(?:ts|py|mjs|json|md))/g)) expect(existsSync(join(REPO, "packages", pkg, rel)), `${pkg}/${rel}`).toBe(true);
        for (const [, rel] of text.matchAll(/\]\(((?:references|templates|scripts)\/[^)#]+)/g)) expect(existsSync(join(here, rel)), rel).toBe(true);
        for (const [, id, rest] of text.matchAll(/\]\(\.\.\/([a-z][\w-]*)\/([^)#]+)/g)) {
          const target = declared.find((d) => d.id === id);
          expect(target, `link to skill ${id}`).toBeDefined();
          expect(existsSync(join(dirname(target!.file), rest)), `../${id}/${rest}`).toBe(true);
        }
        for (const [, id] of text.matchAll(/\*\*([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\*\*/g)) expect(skillIds.has(id), `names **${id}**`).toBe(true);
      });
    });
  }
});

describe("diagnostic codes", () => {
  const PREFIX = "(?:PB|HW|FRAME_CAD|HARDWARE_CAD|HARNESS|ENCLOSURE|CIRCUIT|SRC|UHD)_[A-Z0-9_]+";
  const reference = readFileSync(join(REPO, "packages/ext-hardware/skills/system-compose/references/diagnostic-codes.md"), "utf8");
  const documented = new Set([...reference.matchAll(new RegExp(`\`(${PREFIX})\``, "g"))].map((m) => m[1]));

  /** Codes the stack emits as diagnostics: quoted literals in extension and core sources (not environment variables, not command errors). */
  const emitted = new Set<string>();
  for (const dir of ["packages/core/src", "packages/cli/src", ...packages.flatMap((d) => ["lib", "ops", "checks", "py"].map((x) => `packages/${d}/${x}`))]) {
    const root = join(REPO, dir);
    if (!existsSync(root)) continue;
    for (const f of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!f.isFile() || !/\.(ts|py)$/.test(f.name)) continue;
      const src = readFileSync(join(f.parentPath, f.name), "utf8");
      for (const [, code] of src.matchAll(new RegExp(`(?<!Error\\()["'\`](${PREFIX})["'\`]`, "g"))) if (!/_DEBUG$/.test(code)) emitted.add(code);
    }
  }

  it("every code the stack emits is in the diagnostic-codes reference", () => {
    expect(emitted.size).toBeGreaterThan(100);
    expect([...emitted].filter((c) => !documented.has(c)).sort()).toEqual([]);
  });

  it("every code a skill names is emitted or documented (no typos)", () => {
    const bad: string[] = [];
    for (const s of ours) {
      const text = readFileSync(s.file, "utf8");
      for (const [, code] of text.matchAll(new RegExp(`\`(${PREFIX})\``, "g"))) if (!emitted.has(code) && !documented.has(code) && !code.endsWith("_")) bad.push(`${s.id}: ${code}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("discovery and export with every extension installed", async () => {
  const dir = join(TMP, "all");
  rmSync(dir, { recursive: true, force: true });
  initProject(dir, { name: "All Skills" });
  const cfg = join(dir, "protoboard.config.ts");
  const all = [...manifests.values()].map((m) => m.id);
  writeFileSync(cfg, readFileSync(cfg, "utf8").replace('extensions: ["@protoboardai/ext-hardware"],', `extensions: ${JSON.stringify(all)},`));
  const pb = (args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args, "--format", "json", "--cwd", dir], { encoding: "utf8" });
    return { status: r.status, json: JSON.parse(r.stdout) };
  };

  it("protoboard skills lists every declared skill, build-a-project among them, each with its file", () => {
    const { status, json } = pb(["skills"]);
    expect(status).toBe(0);
    expect(json.map((s: { id: string }) => s.id).sort()).toEqual([...skillIds].sort());
    for (const s of json) expect(s.file, s.id).toBeTruthy();
  });

  it("skills export --host claude-code writes every skill as .claude/skills/<id>/SKILL.md", () => {
    const { status, json } = pb(["skills", "export", "--host", "claude-code"]);
    expect(status).toBe(0);
    expect(json.skipped).toEqual([]);
    const root = join(dir, ".claude/skills");
    expect(readdirSync(root).sort()).toEqual([...skillIds].sort());
    for (const id of skillIds) expect(frontmatter(readFileSync(join(root, id, "SKILL.md"), "utf8")).name, id).toBe(id);
    // cross-skill links resolve once exported side by side
    for (const id of skillIds) {
      const text = readFileSync(join(root, id, "SKILL.md"), "utf8");
      for (const [, other, rest] of text.matchAll(/\]\(\.\.\/([a-z][\w-]*)\/([^)#]+)/g)) expect(existsSync(join(root, other, rest)), `${id} → ../${other}/${rest}`).toBe(true);
    }
  });

  it("skills export --host agents-md indexes every skill", () => {
    pb(["skills", "export", "--host", "agents-md"]);
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    for (const id of skillIds) expect(agents, id).toContain(`**${id}**`);
  });
});
