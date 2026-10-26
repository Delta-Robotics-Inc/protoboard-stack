/**
 * A new project gets its extensions' skills without a second command.
 *
 * `protoboard init` cannot export them: `skills export` reads the skills
 * from the installed extension packages, which are not there until the
 * project's `npm install` (and the CLI package does not carry the
 * extensions). So init writes a `postinstall` script, and `npm install`
 * ends with the export: `.claude/skills/<id>/` and a list in AGENTS.md.
 * Here the projects are made inside this repository, whose node_modules
 * hold the extensions, and the test runs the script npm would run.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKILLS_EXPORT_SCRIPT, SKILLS_POSTINSTALL_SCRIPT, exportSkills, loadTemplate } from "@protoboardai/core";

const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const TMP = fileURLToPath(new URL("./.tmp-init-skills", import.meta.url));
beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const run = (cwd: string, args: string[]) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_") && k !== "npm_config_registry"));
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env, timeout: 120_000 });
};
function init(name: string, args: string[]) {
  const r = run(TMP, ["init", name, "--no-parts", ...args]);
  expect(r.status, r.stderr).toBe(0);
  const root = join(TMP, name);
  return { root, stdout: r.stdout, pkg: JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> } };
}
/** What npm runs at the end of `npm install`: the project's postinstall, with `protoboard` as this CLI. */
function postinstall(root: string, script: string) {
  expect(script).toBe(SKILLS_POSTINSTALL_SCRIPT);
  const [command, fallback] = script.split(" || ");
  expect(fallback).toBe("exit 0");
  expect(command.startsWith("protoboard ")).toBe(true);
  return run(root, command.split(" ").slice(1));
}
/** Every file under a folder with its digest: the state an export leaves. */
const state = (root: string): Record<string, string> => {
  const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])) : []);
  return Object.fromEntries([...walk(join(root, ".claude")), join(root, "AGENTS.md")].sort().map((f) => [f.slice(root.length + 1), createHash("sha256").update(readFileSync(f)).digest("hex")]));
};

describe("protoboard init: the skills arrive with npm install", () => {
  for (const template of ["drone", "wearable", "iot"]) {
    it(`${template}: postinstall exports every listed extension's skills, and a second run changes nothing`, () => {
      const p = init(`p-${template}`, ["--template", template]);
      expect(p.pkg.scripts["skills:export"]).toBe(SKILLS_EXPORT_SCRIPT);
      expect(p.stdout).toContain(`Skills: \`npm install\` exports the skills of the project's ${loadTemplate(template).extensions.length} extensions to .claude/skills/ and lists them in AGENTS.md`);
      // init itself exports nothing: the packages are not installed yet
      expect(existsSync(join(p.root, ".claude"))).toBe(false);
      const before = readFileSync(join(p.root, "AGENTS.md"), "utf8");
      expect(before).not.toContain("protoboard:skills:begin");
      // the opening tells an agent what to do first
      const opening = before.split("\n## ")[0];
      for (const said of ["**Agents, start here.**", "**build-a-project** skill", "`protoboard skills read build-a-project`", "`protoboard doctor`", "`protoboard check`", "node_modules/@deltarobotics/uhd/docs", "node_modules/@deltarobotics/uhd/skills/uhd-authoring/SKILL.md"]) expect(opening, said).toContain(said);
      expect(readFileSync(join(p.root, ".gitignore"), "utf8")).toContain("\n.claude/skills/\n");

      const first = postinstall(p.root, p.pkg.scripts.postinstall);
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toMatch(/^protoboard: \d+ skills of the installed extensions are in \.claude\/skills\/ and listed in AGENTS\.md \(npm run skills:export does it again\)\n$/);
      const listed = JSON.parse(run(p.root, ["skills", "--format", "json"]).stdout) as { id: string; file: string | null }[];
      expect(listed.length).toBeGreaterThan(5);
      expect(listed.every((s) => s.file)).toBe(true);
      const agents = readFileSync(join(p.root, "AGENTS.md"), "utf8");
      expect(agents.startsWith(before.trimEnd())).toBe(true);
      for (const s of listed) {
        expect(existsSync(join(p.root, ".claude/skills", s.id, "SKILL.md")), s.id).toBe(true);
        expect(agents, s.id).toMatch(new RegExp(`- \\*\\*${s.id}\\*\\* \\([^)]+\\) — `));
      }
      // the list names skills; it points at no file (a path into one machine's Protoboard install breaks elsewhere)
      expect(agents.slice(agents.indexOf("protoboard:skills:begin"))).not.toMatch(/SKILL\.md`\)/);
      expect(listed.map((s) => s.id)).toContain("build-a-project");
      expect(readdirSync(join(p.root, ".claude/skills")).sort()).toEqual(listed.map((s) => s.id).sort());

      const after = state(p.root);
      expect(postinstall(p.root, p.pkg.scripts.postinstall).status).toBe(0);
      expect(state(p.root)).toEqual(after);
      // the script for refreshing by hand writes the same
      const again = run(p.root, SKILLS_EXPORT_SCRIPT.split(" ").slice(1));
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toContain(`${listed.length + 1} written`);
      expect(state(p.root)).toEqual(after);
    });
  }

  it("a plain project has the same scripts and lists ext-hardware: its postinstall exports build-a-project and the system skills (PB-1018)", () => {
    const p = init("p-plain", []);
    expect(p.pkg.scripts["skills:export"]).toBe(SKILLS_EXPORT_SCRIPT);
    expect(p.stdout).toContain("Skills: `npm install` exports the skills of the project's extension (@protoboardai/ext-hardware)");
    const opening = readFileSync(join(p.root, "AGENTS.md"), "utf8").split("\n## ")[0];
    for (const said of ["**Agents, start here.**", "**build-a-project** skill", "`protoboard skills read build-a-project`", "@protoboardai/ext-hardware", "`protoboard extensions add", "`protoboard doctor`", "`protoboard check`", "node_modules/@deltarobotics/uhd/docs", "node_modules/@deltarobotics/uhd/skills/uhd-authoring/SKILL.md"]) expect(opening, said).toContain(said);
    // one install story: nothing in it sends anyone to npm
    expect(opening).not.toMatch(/npm install|npm run/);
    expect(readFileSync(join(p.root, ".gitignore"), "utf8")).toContain("\n.claude/skills/\n");
    const r = postinstall(p.root, p.pkg.scripts.postinstall);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(p.root, ".claude", "skills", "build-a-project", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(p.root, "AGENTS.md"), "utf8")).toContain("**build-a-project** (@protoboardai/ext-hardware)");
  });

  it("--no-skills leaves the postinstall out and says how to export by hand", () => {
    const p = init("p-no-skills", ["--template", "drone", "--no-skills"]);
    expect(p.pkg.scripts.postinstall).toBeUndefined();
    expect(p.pkg.scripts["skills:export"]).toBe(SKILLS_EXPORT_SCRIPT);
    expect(p.stdout).toContain("Skills: not exported at install (--no-skills); `npm run skills:export` after `npm install`");
    const plain = init("p-plain-no-skills", ["--no-skills"]);
    expect(plain.pkg.scripts.postinstall).toBeUndefined();
  });

  it("the postinstall never fails an install: a project that does not load gets one line and exit 0", () => {
    const root = join(TMP, "broken");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), `{ "name": "broken", "private": true, "type": "module" }\n`);
    writeFileSync(join(root, "protoboard.config.ts"), `throw new Error("no such thing");\nexport default {};\n`);
    const r = postinstall(root, SKILLS_POSTINSTALL_SCRIPT);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^protoboard: the extensions' skills were not exported \(.*\); run `npm run skills:export` in the project\n$/);
    expect(existsSync(join(root, ".claude"))).toBe(false);
    // by hand, the same failure is an error
    expect(run(root, SKILLS_EXPORT_SCRIPT.split(" ").slice(1)).status).toBe(2);
  });

  it("the UHD package ships what AGENTS.md points at", () => {
    const uhd = join(REPO, "node_modules/@deltarobotics/uhd");
    expect(existsSync(join(uhd, "skills/uhd-authoring/SKILL.md"))).toBe(true);
    expect(readdirSync(join(uhd, "docs")).some((f) => f.endsWith(".md"))).toBe(true);
    const files = (JSON.parse(readFileSync(join(uhd, "package.json"), "utf8")) as { files: string[] }).files;
    expect(files).toEqual(expect.arrayContaining(["skills", "docs/**/*.md"]));
  });
});

describe("skills export --host agents-md: the list in AGENTS.md", () => {
  it("replaces its own section when the skills change, and leaves the rest of the file alone", () => {
    const root = join(TMP, "agents-md");
    mkdirSync(root, { recursive: true });
    const skill = (id: string) => ({ id, extension: "@protoboardai/ext-x", summary: `does ${id}`, file: join(root, "node_modules/x", id, "SKILL.md") });
    const project = { root } as Parameters<typeof exportSkills>[0];
    writeFileSync(join(root, "AGENTS.md"), "# Rig\n\nNotes.\n");
    exportSkills(project, [skill("one")] as never, "agents-md");
    const first = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(first).toContain("- **one** (@protoboardai/ext-x) — does one");
    // named, never pointed at by a path on this machine (PB-1018)
    expect(first).not.toContain("node_modules/x");
    writeFileSync(join(root, "AGENTS.md"), `${first}\n## After\n\nKept.\n`);
    exportSkills(project, [skill("one"), skill("two")] as never, "agents-md");
    const second = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(second).toContain("- **two** (@protoboardai/ext-x) — does two");
    expect(second.match(/protoboard:skills:begin/g)).toHaveLength(1);
    expect(second.startsWith("# Rig\n\nNotes.\n")).toBe(true);
    expect(second.endsWith("\n## After\n\nKept.\n")).toBe(true);
  });
});
