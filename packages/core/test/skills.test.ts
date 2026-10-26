/**
 * M4 exit criteria for skills (PB-798): skills installed through npm packages
 * are discovered in a fresh project, exposed to one agent host (Claude Code
 * project skills) and discoverable by another host or a headless harness from
 * the CLI's JSON and plain project files (AGENTS.md).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { initProject, loadProject, resolveSkills } from "../src/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(HERE, "../../cli/bin/protoboard.mjs");
const TMP = join(HERE, ".tmp-skills");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const EXTENSIONS = ["@protoboardai/ext-hardware", "@protoboardai/ext-parts", "@protoboardai/ext-docs", "@protoboardai/ext-drone", "@protoboardai/ext-frame-cad", "@protoboardai/ext-release"];
const EXPECTED = [
  // UHD's schema-authoring reference, shipped by @deltarobotics/uhd and declared by ext-parts
  "uhd-authoring",
  // ext-parts (PB-801: moved out of UHD)
  "uhd-part-research", "uhd-part-author", "uhd-part-verify",
  // ext-docs (PB-801: moved out of UHD)
  "uhd-tech-docs", "uhd-tech-docs-verify",
  // ext-hardware (build-a-project: the top-level SOP, PB-844)
  "build-a-project", "system-compose", "system-review", "harness-author", "harness-verify", "test-and-measure",
  // ext-drone
  "firmware-config", "firmware-verify",
  // ext-frame-cad
  "frame-cad", "frame-cad-verify",
  // ext-release (PB-839)
  "release",
];

/** A project made by `init`, with the installed extensions listed (as a user does after `npm install`). */
function freshProject(): string {
  const dir = join(TMP, "fresh");
  rmSync(dir, { recursive: true, force: true });
  initProject(dir, { name: "Fresh Rig" });
  const cfg = join(dir, "protoboard.config.ts");
  const text = readFileSync(cfg, "utf8");
  // a blank project lists ext-hardware (PB-1018)
  expect(text).toContain('extensions: ["@protoboardai/ext-hardware"],');
  writeFileSync(cfg, text.replace('extensions: ["@protoboardai/ext-hardware"],', `extensions: ${JSON.stringify(EXTENSIONS)},`));
  return dir;
}

const pb = (dir: string, args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args, "--format", "json", "--cwd", dir], { encoding: "utf8" });
  return { status: r.status, json: JSON.parse(r.stdout) };
};

const frontmatter = (file: string) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"));
  return Object.fromEntries((m?.[1] ?? "").split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
};

describe("skills in a fresh project", async () => {
  const dir = freshProject();
  const p = await loadProject(dir);
  const skills = resolveSkills(p, p.extensions);

  it("discovers every skill from the installed extensions, each with its SKILL.md", () => {
    expect(p.extensions.map((e) => e.manifest.id)).toEqual(EXTENSIONS);
    expect(skills.map((s) => s.id).sort()).toEqual([...EXPECTED].sort());
    expect(skills.filter((s) => !s.file)).toEqual([]);
  });

  it("every SKILL.md has host frontmatter (name = id, a description) and companions exist", () => {
    for (const s of skills) {
      const fm = frontmatter(s.file!);
      expect(fm.name, s.id).toBe(s.id);
      expect(fm.description?.length, s.id).toBeGreaterThan(80);
      if (s.verifiedBy) expect(EXPECTED).toContain(s.verifiedBy);
    }
    expect(Object.fromEntries(skills.filter((s) => s.verifiedBy).map((s) => [s.id, s.verifiedBy]))).toMatchObject({
      "system-compose": "system-review",
      "harness-author": "harness-verify",
      "firmware-config": "firmware-verify",
      "frame-cad": "frame-cad-verify",
      "uhd-part-author": "uhd-part-verify",
      "uhd-tech-docs": "uhd-tech-docs-verify",
    });
  });

  it("the release skill runs the command, in the SOP format", () => {
    const release = skills.find((s) => s.id === "release")!;
    expect(release.extension).toBe("@protoboardai/ext-release");
    const text = readFileSync(release.file!, "utf8");
    expect(text).toMatch(/npx protoboard release --check/);
    for (const h of ["Purpose", "Inputs", "Steps", "Decision points", "Outputs", "Verification", "Failure handling"]) expect(text).toContain(`## ${h}`);
  });

  it("headless harness / second host: the CLI JSON lists them with absolute SKILL.md paths", () => {
    const { status, json } = pb(dir, ["skills"]);
    expect(status).toBe(0);
    expect(json.map((s: { id: string }) => s.id).sort()).toEqual([...EXPECTED].sort());
    for (const s of json) expect(existsSync(s.file)).toBe(true);
    const doctor = pb(dir, ["doctor"]).json;
    expect(doctor.skills.every((s: { found: boolean }) => s.found)).toBe(true);
    expect(doctor.tools.map((t: { id: string }) => t.id)).toContain("python-build123d");
  });

  it("host adapter: skills export --host claude-code writes .claude/skills with references and scripts", () => {
    const { status, json } = pb(dir, ["skills", "export", "--host", "claude-code"]);
    expect(status).toBe(0);
    expect(json.skipped).toEqual([]);
    expect(json.written).toHaveLength(EXPECTED.length);
    const root = join(dir, ".claude/skills");
    expect(readdirSync(root).sort()).toEqual([...EXPECTED].sort());
    for (const id of EXPECTED) expect(frontmatter(join(root, id, "SKILL.md")).name).toBe(id);
    expect(existsSync(join(root, "system-compose/references/diagnostic-codes.md"))).toBe(true);
    expect(existsSync(join(root, "system-compose/scripts/scenarios.ts"))).toBe(true);
    expect(existsSync(join(root, "harness-author/scripts/stackup.ts"))).toBe(true);
    expect(existsSync(join(root, "firmware-config/references/betaflight-reference.md"))).toBe(true);
    expect(existsSync(join(root, "frame-cad-verify/scripts/dxf_report.py"))).toBe(true);
    expect(readFileSync(join(root, "frame-cad/.protoboard-source"), "utf8")).toMatch(/^@protoboardai\/ext-frame-cad/);
    // a skill shipped by another package keeps its origin: UHD's reference, declared by ext-parts
    expect(readFileSync(join(root, "uhd-authoring/.protoboard-source"), "utf8")).toMatch(/^@protoboardai\/ext-parts \(@deltarobotics\/uhd\)/);
    expect(existsSync(join(root, "uhd-authoring/references/vocabulary.md"))).toBe(true);
    expect(existsSync(join(root, "uhd-tech-docs/templates/test-data.schema.json"))).toBe(true);
  });

  it("plain project files: skills export --host agents-md indexes them in AGENTS.md", () => {
    pb(dir, ["skills", "export", "--host", "agents-md"]);
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    for (const id of EXPECTED) expect(agents).toContain(`**${id}**`);
    expect(agents).toContain("verify with **frame-cad-verify**");
  });
});
