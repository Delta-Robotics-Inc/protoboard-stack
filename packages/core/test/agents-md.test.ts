/**
 * What a new project's AGENTS.md tells an agent, whatever the project starts
 * from: the words, the global install, the layout file, and
 * the extensions a template lists.
 *
 * The text depends on behaviour the shell track builds; each dependency is
 * marked so the integrator can check it:
 *
 * r5-shell: `protoboard init` sets a project up on the machine's (global) stack, with no npm step.
 * r5-shell: `protoboard init --stack project` is the project-local install (`--stack global` is the default; `--local` is the parts service on this machine).
 * r5-shell: `protoboard agents setup` works as a plain command (no `npx --no-install`).
 * r5-shell: without the command on PATH, `~/.protoboard/bin/protoboard` (`%USERPROFILE%\.protoboard\bin\protoboard.cmd`) runs the same CLI.
 * r5-shell: a project on the global stack resolves `node_modules/@deltarobotics/uhd/docs` and `.claude/skills/` as a linked project does today.
 * PB-1018: a project with no template lists ext-hardware; every project gets a CLAUDE.md that imports AGENTS.md.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { AGENTS_COMMON, AGENTS_GUIDANCE, CLAUDE_MD, GUIDANCE_BEGIN, GUIDANCE_END, initProject, listTemplates, refreshGuidance, withCurrentGuidance } from "../src/init.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
const TMP = join(HERE, ".tmp-agents-md");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const agentsOf = (template: string | undefined) => {
  const dir = join(TMP, template ?? "plain");
  rmSync(dir, { recursive: true, force: true });
  initProject(dir, { ...(template ? { template } : {}), name: "Field Rig" });
  return readFileSync(join(dir, "AGENTS.md"), "utf8");
};

describe("AGENTS.md of a new project", () => {
  for (const template of ["drone", "iot", "wearable", undefined]) {
    describe(template ?? "no template", () => {
      const text = agentsOf(template);

      it("carries the shared sections whole, with nothing left to fill in", () => {
        expect(text).toContain(AGENTS_COMMON);
        expect(text).not.toMatch(/\{\{[\w-]+\}\}/);
        // before the commands, so the words are read first
        expect(text.indexOf("## Words")).toBeGreaterThan(0);
        expect(text.indexOf("## Words")).toBeLessThan(text.indexOf("## Commands"));
      });

      it("has the glossary: the model's words and the words for what people see (item 33)", () => {
        const words = text.slice(text.indexOf("## Words"), text.indexOf("## Protoboard on this machine"));
        for (const w of ["Module", "Part", "Board", "Interface", "Link", "Harness", "DRC"]) expect(words, w).toContain(`| **${w}** |`);
        expect(words).toMatch(/\*\*DRC\*\* \| Design rule check: the rules `protoboard check` runs/);
        for (const seen of ["**node**", "**handle**", "**edge**", '"dot"', '"line"', "tidy the diagram"]) expect(words, seen).toContain(seen);
        expect(words).toMatch(/top-level module is the whole product; its source lives under `src\/`/);
      });

      it("says the install is global by default and a local one is asked for (D3)", () => {
        expect(text).toMatch(/installed once per machine \(globally\) by default/);
        expect(text).toMatch(/Never tell the person to run `npm install` \(or any npm command\) in a\s+project/);
        expect(text).toMatch(/`protoboard init --stack project`\)[\s\S]{0,120}Ask the person before doing it/);
        expect(text).toMatch(/Never run a bare\s+`npx protoboard`/);
        expect(text).toContain("`npx @protoboardai/cli …`");
      });

      it("lets the agent write the diagram's layout, and nothing else under .protoboard/ (item 3)", () => {
        expect(text).toMatch(/`\.protoboard\/display\.json`\. \*\*You may write this file\*\*/);
        expect(text).toMatch(/Everything else under `\.protoboard\/` is generated/);
        expect(text).not.toMatch(/Never edit[^.]*`\.protoboard\/`/);
      });

      it("names skills and says how to read them, never by a path on this machine (PB-1018)", () => {
        expect(text).toMatch(/`protoboard skills read build-a-project`/);
        expect(text).toMatch(/## Skills[\s\S]*`protoboard skills read <name>`[\s\S]*`skill_read`[\s\S]*`\.claude\/skills\/<name>\/SKILL\.md`/);
        expect(text).not.toMatch(/\.claude\/skills\/[a-z-]+\/SKILL\.md/);
        expect(text).not.toMatch(/\.protoboard[\\/]stack/);
      });

      it("has one install story: extensions are added with protoboard extensions add, never npm (PB-1018)", () => {
        expect(text).toMatch(/`protoboard extensions add <name>`/);
        expect(text).not.toMatch(/npm install @protoboardai/);
        expect(text).not.toMatch(/npm run skills:export/);
      });

      it("says how it stands to a workspace it sits in, which MCP server is its own, and the PCB fallback rules (PB-1018)", () => {
        expect(text).toMatch(/## When this project sits inside a larger workspace[\s\S]*govern the hardware work here[\s\S]*governs the process around it/);
        expect(text).toMatch(/never assumes this folder is the root of a git repository/);
        expect(text).toMatch(/named \*\*protoboard-stack\*\*/);
        expect(text).toMatch(/## Circuit boards \(PCB\)[\s\S]*Do not run `tsci` on a Protoboard board[\s\S]*KiStack[\s\S]*Tell the person plainly[\s\S]*friction[\s\S]*Record it[\s\S]*UHD model authoritative/);
      });

      it("says parts are placed in 3D in display.json, with the format (PB-1018)", () => {
        expect(text).toMatch(/## Placing parts in the 3D view[\s\S]*`spatial`[\s\S]*"placements"[\s\S]*row by row[\s\S]*millimetres/);
        expect(text).not.toMatch(/spatial\.placements` for the 3D view\): leave/);
      });

      it("says to look at the project before describing it (item 34)", () => {
        expect(text).toMatch(/## Look before you describe[\s\S]*`protoboard inspect`[\s\S]*Do not answer from memory/);
      });
    });
  }

  for (const template of ["drone", "iot", "wearable"]) {
    it(`${template}: writes its commands as \`protoboard …\` and never sends anyone to npm`, () => {
      const text = agentsOf(template);
      const own = text.replace(AGENTS_COMMON, "");
      expect(own).not.toMatch(/npx|npm install|npm run/);
      expect(own).toMatch(/- `protoboard check`/);
      expect(own).toMatch(/\(`protoboard-stack`, registered by\s+`protoboard agents setup` or the Protoboard settings page in VS Code\)/);
      // D9: the top-level module is under src/
      expect(own).toMatch(/`src\/system\.uhd\.ts` — the top-level module \(the root system\)[\s\S]{0,80}It lives under `src\/`/);
      expect(own).toMatch(/everything is generated except `\.protoboard\/display\.json`/);
    });
  }
});

describe("CLAUDE.md and the blank project (PB-1018)", () => {
  it("init writes a CLAUDE.md that imports AGENTS.md and nothing else", () => {
    for (const template of ["drone", undefined]) {
      const dir = join(TMP, `claude-${template ?? "plain"}`);
      rmSync(dir, { recursive: true, force: true });
      const r = initProject(dir, { ...(template ? { template } : {}) });
      expect(r.files).toContain("CLAUDE.md");
      expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    }
  });

  it("init into a folder that holds a CLAUDE.md keeps it, and says when it does not import AGENTS.md", () => {
    const dir = join(TMP, "workspace", "protoboard");
    rmSync(join(TMP, "workspace"), { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const own = "# The engagement's hardware\n\nRead ../worklog.md first.\n\n@AGENTS.md\n";
    writeFileSync(join(dir, "CLAUDE.md"), own);
    const r = initProject(dir, { name: "Rig" });
    expect(r.kept).toEqual(["CLAUDE.md"]);
    expect(r.files).not.toContain("CLAUDE.md");
    expect(r.notes).toBeUndefined();
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(own);
    // one that does not import it is kept too, with a note
    const other = join(TMP, "workspace", "other");
    mkdirSync(other);
    writeFileSync(join(other, "CLAUDE.md"), "# hand-written\n");
    expect(initProject(other).notes?.[0]).toMatch(/does not import AGENTS\.md/);
    // anything else in the folder is refused, as before
    const busy = join(TMP, "workspace", "busy");
    mkdirSync(busy);
    writeFileSync(join(busy, "CLAUDE.md"), "@AGENTS.md\n");
    writeFileSync(join(busy, "notes.md"), "x");
    expect(() => initProject(busy)).toThrow(/not empty \(notes\.md\)/);
  });

  it("a blank project lists @protoboardai/ext-hardware in package.json and its config", () => {
    const dir = join(TMP, "blank-ext");
    rmSync(dir, { recursive: true, force: true });
    initProject(dir);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies["@protoboardai/ext-hardware"]).toMatch(/^\^/);
    expect(readFileSync(join(dir, "protoboard.config.ts"), "utf8")).toContain('extensions: ["@protoboardai/ext-hardware"],');
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toMatch(/^release\/$/m);
    // a board's KiCad preview is not committed (F28); a locked board's kicad/ is
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toMatch(/^src\/boards\/\*\/tscircuit\/kicad\/$/m);
  });
});

describe("the extensions a template lists (item 37)", () => {
  const extOf = (pkg: { dependencies?: Record<string, string> }) => Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@protoboardai/ext-")).sort();

  it("every template lists what its reference project installs, and the sourcing extension", () => {
    for (const t of listTemplates()) {
      const reference = extOf(JSON.parse(readFileSync(join(REPO, t.derivedFrom, "package.json"), "utf8")));
      const listed = [...t.extensions, ...(t.dependencies ?? [])].sort();
      // the reference projects predate build-a-project's sourcing stage and do not list ext-sourcing; a new project
      // must, or the six sourcing skills that stage names (part-search … sourcing-verify) are not in the project
      expect(reference, t.derivedFrom).not.toContain("@protoboardai/ext-sourcing");
      expect(listed, `template ${t.id}`).toEqual([...reference, "@protoboardai/ext-sourcing"].sort());
      expect(t.extensions, `template ${t.id}`).toContain("@protoboardai/ext-sourcing");
    }
  });

  it("the project init writes depends on them and lists them in its config", () => {
    for (const t of listTemplates()) {
      const dir = join(TMP, `ext-${t.id}`);
      rmSync(dir, { recursive: true, force: true });
      initProject(dir, { template: t.id });
      expect(extOf(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")))).toEqual([...t.extensions, ...(t.dependencies ?? [])].sort());
      const config = readFileSync(join(dir, "protoboard.config.ts"), "utf8");
      const inConfig = [...config.slice(config.indexOf("extensions: [")).matchAll(/"(@protoboardai\/ext-[a-z-]+)"/g)].map((m) => m[1]);
      expect(inConfig).toEqual(t.extensions);
    }
  });

  it("every skill the build-a-project SOP names for sourcing is one the sourcing extension ships", () => {
    const manifest = JSON.parse(readFileSync(join(REPO, "packages/ext-sourcing/protoboard-extension.json"), "utf8")) as { skills: { id: string }[] };
    const sop = readFileSync(join(REPO, "packages/ext-hardware/skills/build-a-project/SKILL.md"), "utf8");
    for (const s of manifest.skills) expect(sop, s.id).toContain(`**${s.id}**`);
  });
});

describe("refreshing an existing project's guidance (F03, PB-1028)", () => {
  const dir = (name: string, files: Record<string, string>) => {
    const d = join(TMP, `refresh-${name}`);
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
    for (const [rel, content] of Object.entries(files)) writeFileSync(join(d, rel), content);
    return d;
  };
  const SKILLS = "<!-- protoboard:skills:begin (generated by `protoboard skills export`) -->\n## Skills (the project's extensions)\n\n- one\n<!-- protoboard:skills:end -->\n";

  it("a new project's AGENTS.md carries the guidance between its markers, and a refresh leaves it as it is", () => {
    const d = join(TMP, "refresh-new");
    rmSync(d, { recursive: true, force: true });
    initProject(d, { name: "Rig" });
    const text = readFileSync(join(d, "AGENTS.md"), "utf8");
    expect(text).toContain(AGENTS_GUIDANCE);
    expect(refreshGuidance(d)).toMatchObject({ agents: "unchanged", claude: "kept", notes: [] });
    expect(readFileSync(join(d, "AGENTS.md"), "utf8")).toBe(text);
  });

  it("replaces an earlier stack's guidance between the markers, keeping the project's own sections and the skills list", () => {
    const old = `# Rig\n\nOur notes.\n\n${GUIDANCE_BEGIN}\n## Words\n\nold words\n${GUIDANCE_END}\n\n## Our rules\n\nKeep the cap round.\n\n${SKILLS}`;
    const d = dir("markers", { "AGENTS.md": old, "CLAUDE.md": "@AGENTS.md\n" });
    expect(refreshGuidance(d)).toMatchObject({ agents: "replaced", claude: "kept", notes: [] });
    const text = readFileSync(join(d, "AGENTS.md"), "utf8");
    expect(text).toContain(AGENTS_GUIDANCE);
    expect(text).not.toContain("old words");
    expect(text.startsWith("# Rig\n\nOur notes.\n\n")).toBe(true);
    expect(text).toContain("## Our rules\n\nKeep the cap round.");
    expect(text.endsWith(SKILLS)).toBe(true);
  });

  it("finds 0.1.7's guidance without markers by its sections (a field board's), and adds CLAUDE.md", () => {
    const old = `# Field board\n\nIntro.\n\n## Words\n\nold\n\n## Protoboard on this machine\n\nold\n\n## Circuit boards (PCB)\n\nold PCB rules\n\n## Placing parts in the 3D view\n\nold\n\n## Commands (headless)\n\n- protoboard check\n\n${SKILLS}`;
    const d = dir("field-board", { "AGENTS.md": old });
    expect(refreshGuidance(d)).toMatchObject({ agents: "replaced", claude: "written" });
    const text = readFileSync(join(d, "AGENTS.md"), "utf8");
    expect(text).toContain(AGENTS_GUIDANCE);
    expect(text).not.toContain("old PCB rules");
    expect(text.indexOf(GUIDANCE_END)).toBeLessThan(text.indexOf("## Commands (headless)"));
    expect(text).toContain("Intro.");
    expect(readFileSync(join(d, "CLAUDE.md"), "utf8")).toBe(CLAUDE_MD);
    expect(refreshGuidance(d).agents).toBe("unchanged");
  });

  it("adds the guidance before the commands of a project that never had it (the examples), and reports lines that send agents to npm", () => {
    const old = "# Bench\n\nThis project lists no extension yet: npm install @protoboardai/ext-hardware.\n\n## Commands\n\n- `npx protoboard check`\n";
    const d = dir("none", { "AGENTS.md": old, "CLAUDE.md": "# our own\n" });
    const r = refreshGuidance(d);
    expect(r).toMatchObject({ agents: "inserted", claude: "kept" });
    const text = readFileSync(join(d, "AGENTS.md"), "utf8");
    expect(text.indexOf(GUIDANCE_BEGIN)).toBeLessThan(text.indexOf("## Commands"));
    expect(r.notes).toEqual([
      expect.stringMatching(/^AGENTS\.md line 3 tells agents to npm install a Protoboard package/),
      expect.stringMatching(/^AGENTS\.md line 3 says the project lists no extension/),
      expect.stringMatching(/^CLAUDE\.md does not import AGENTS\.md/),
    ]);
    expect(withCurrentGuidance(text).how).toBe("unchanged");
  });
});
