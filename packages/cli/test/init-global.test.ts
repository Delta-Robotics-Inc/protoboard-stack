/**
 * Global by default (first builds review, D3 and items 1 and 35): a project
 * made by `protoboard init` uses the Protoboard installed for the user. Its
 * packages are links to the copy in the user's folder, and `check` works
 * with no `npm install` in the project. `--stack project` leaves the packages
 * to the project's own npm install, as before.
 *
 * The user's copy here is a stand-in whose packages lead to this
 * repository's own (so the linked project really loads), in a scratch
 * PROTOBOARD_HOME: the user's ~/.protoboard is never read or written.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { STACK_MARKER, stackDir, type StackMarker } from "@protoboardai/core";
import { entriesOf, pack } from "@protoboardai/core/pbar";

const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-init-global-")));
const HOME = join(TMP, "protoboard-home");
const VERSION = (JSON.parse(readFileSync(join(REPO, "packages/core/package.json"), "utf8")) as { version: string }).version;
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

beforeAll(() => {
  const dir = stackDir(HOME, VERSION);
  const packages: Record<string, string> = {};
  for (const scope of ["@protoboardai", "@deltarobotics"]) {
    mkdirSync(join(dir, "node_modules", scope), { recursive: true });
    for (const name of readdirSync(join(REPO, "node_modules", scope))) {
      symlinkSync(realpathSync(join(REPO, "node_modules", scope, name)), join(dir, "node_modules", scope, name), "dir");
      packages[`${scope}/${name}`] = VERSION;
    }
  }
  const marker: StackMarker = { schema: "protoboard.stack/v1", version: VERSION, source: "registry", packages, installedAt: "2026-10-11T00:00:00.000Z" };
  writeFileSync(join(dir, STACK_MARKER), JSON.stringify(marker));
});

function pb(args: string[], cwd = TMP, home = HOME, env: Record<string, string> = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PROTOBOARD_") && k !== "npm_config_registry"));
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...clean, PROTOBOARD_HOME: home, ...env }, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) as Record<string, any> };
}

describe("protoboard init --stack global", () => {
  it("links the new project to the user's copy, with no npm install, and the project checks", () => {
    const root = join(TMP, "global-one");
    const r = pb(["init", root, "--stack", "global", "--no-parts", "--format", "json"]);
    expect(r.status, r.stderr).toBe(0);
    const out = r.json();
    expect(out.stackMode).toBe("global");
    expect(out.stackError).toBeUndefined();
    expect(out.stack.stack).toBe(stackDir(HOME, VERSION));
    expect(out.stack.linked).toEqual(expect.arrayContaining(["@protoboardai/core", "@protoboardai/cli", "@deltarobotics/uhd"]));
    // links, not copies: nothing was installed into the project
    for (const name of out.stack.linked as string[]) expect(lstatSync(join(root, "node_modules", ...name.split("/"))).isSymbolicLink(), name).toBe(true);
    expect(existsSync(join(root, "node_modules", ".bin", "protoboard"))).toBe(true);
    expect(existsSync(join(root, "package-lock.json"))).toBe(false);
    // how to open it (item 35)
    expect(out.open).toMatchObject({ command: "code", args: ["--new-window", root] });
    expect(out.open.note).toContain("trust");

    const check = pb(["check", "--format", "json"], root);
    expect(check.status, check.stderr + check.stdout).toBe(0);
    expect(check.json().diagnostics.filter((d: { severity: string }) => d.severity === "error")).toEqual([]);
  });

  it("says so in its last lines: no npm install, the next commands, and how to open it in a new window", () => {
    const root = join(TMP, "global-two");
    const r = pb(["init", root, "--stack", "global", "--no-parts"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("No npm install is needed.");
    expect(r.stdout).toContain("then `protoboard check` and `protoboard build`.");
    expect(r.stdout).not.toContain("&& npm install");
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines.at(-2)).toBe(`Open it in VS Code, in a new window: code --new-window ${root}`);
    expect(lines.at(-1)).toContain("VS Code asks whether you trust the authors of the folder");
  });

  it("a project whose links are gone gets them back with `protoboard stack link`, from the same copy", () => {
    const root = join(TMP, "global-one");
    rmSync(join(root, "node_modules"), { recursive: true, force: true });
    const r = pb(["stack", "link", "--format", "json"], root);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json()).toMatchObject({ stack: stackDir(HOME, VERSION), version: VERSION });
    expect(lstatSync(join(root, "node_modules", "@protoboardai", "core")).isSymbolicLink()).toBe(true);
  });

  it("without a copy that fits, `stack link` says where one comes from", () => {
    const root = join(TMP, "no-copy");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "no-copy", dependencies: { "@protoboardai/core": "^9.0.0" } }));
    const r = pb(["stack", "link"], root);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("no Protoboard stack on this machine fits this project");
    expect(r.stderr).toContain("protoboard stack install");
    expect(r.stderr).toContain("Initialize");
  });
});

/** A stand-in stack copy of another version: package folders and the CLI entry only. */
function otherCopy(home: string, version: string) {
  const dir = stackDir(home, version);
  const names = ["@protoboardai/core", "@protoboardai/cli", "@deltarobotics/uhd"];
  for (const n of names) {
    mkdirSync(join(dir, "node_modules", n), { recursive: true });
    writeFileSync(join(dir, "node_modules", n, "package.json"), JSON.stringify({ name: n, version }));
  }
  mkdirSync(join(dir, "node_modules/@protoboardai/cli/bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules/@protoboardai/cli/bin/protoboard.mjs"), "");
  const marker: StackMarker = { schema: "protoboard.stack/v1", version, source: "vsix", packages: Object.fromEntries(names.map((n) => [n, version])), installedAt: "2026-10-21T00:00:00.000Z" };
  writeFileSync(join(dir, STACK_MARKER), JSON.stringify(marker));
  return dir;
}

function oldProject(name: string, range: string) {
  const root = join(TMP, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, dependencies: { "@protoboardai/core": range, "@deltarobotics/uhd": "0.2.1" }, devDependencies: { "@protoboardai/cli": range } }));
  return root;
}

describe("stack versions (PB-1024)", () => {
  const home = join(TMP, "home-older");
  beforeAll(() => otherCopy(home, "0.0.1"));

  it("`stack link` says when it links another version than the CLI's, and why", () => {
    const root = oldProject("older", "^0.0.1");
    const r = pb(["stack", "link", "--format", "json"], root, home);
    expect(r.status, r.stderr).toBe(0);
    const j = r.json();
    expect(j).toMatchObject({ version: "0.0.1", preferred: VERSION });
    expect(j.fallback).toBe(`the stack ${VERSION} (this CLI's) is not in ${join(home, "stack")}; linked 0.0.1 instead`);
    expect(r.stderr).toContain("linked 0.0.1 instead");
  });

  it("every command warns when the CLI and the linked stack are different versions, and `protoboard stack` says it", () => {
    const root = join(TMP, "older");
    const check = pb(["check", "--format", "json"], root, home);
    expect(check.stderr).toContain(`protoboard: warning: this CLI is ${VERSION}, and the project's packages are links to the Protoboard stack 0.0.1`);
    const status = pb(["stack", "--format", "json"], root, home);
    expect(status.status, status.stderr).toBe(0);
    expect(status.json().project.mismatch).toContain("links to the Protoboard stack 0.0.1");
    expect(pb(["stack"], root, home).stdout).toContain(`Warning: this CLI is ${VERSION}`);
  });

  it("without a copy that fits, `stack link` names each copy and why it does not fit, and `stack unpack`", () => {
    const root = oldProject("too-new", "^5.0.0");
    const r = pb(["stack", "link"], root, home);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("0.0.1: package.json asks for ^5.0.0");
    expect(r.stderr).toContain("protoboard stack unpack");
  });

  it("`stack unpack` unpacks an installed extension's stack, links the project it fits, and `stack` reports what is not unpacked", async () => {
    const userHome = join(TMP, "unpack-user");
    const pbHome = join(userHome, ".protoboard");
    const ext = join(userHome, ".vscode/extensions/deltarobotics.vscode-protoboard-0.0.3");
    const tree = join(TMP, "unpack-tree");
    for (const n of ["@protoboardai/core", "@protoboardai/cli", "@deltarobotics/uhd"]) {
      mkdirSync(join(tree, "node_modules", n), { recursive: true });
      writeFileSync(join(tree, "node_modules", n, "package.json"), JSON.stringify({ name: n, version: "0.0.3" }));
    }
    mkdirSync(join(tree, "node_modules/@protoboardai/cli/bin"), { recursive: true });
    writeFileSync(join(tree, "node_modules/@protoboardai/cli/bin/protoboard.mjs"), "");
    const native = join(TMP, "unpack-native");
    mkdirSync(join(native, "node_modules/@esbuild/x"), { recursive: true });
    writeFileSync(join(native, "node_modules/@esbuild/x/bin"), "x");
    mkdirSync(join(ext, "dist/stack"), { recursive: true });
    writeFileSync(join(ext, "package.json"), "{}");
    const platform = `${process.platform}-${process.arch}`;
    const main = await pack(entriesOf(tree), join(ext, "dist/stack/stack.pbar.br"));
    const nat = await pack(entriesOf(native), join(ext, "dist/stack/native.pbar.br"));
    const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
    writeFileSync(
      join(ext, "dist/stack/stack.json"),
      JSON.stringify({
        schema: "protoboard.carried-stack/v1",
        version: "0.0.3",
        uhd: "0.2.1",
        packages: {},
        platforms: [platform],
        digest: "d3",
        archives: { main: { file: "stack.pbar.br", files: main.files, unpacked: main.bytes, bytes: 1, sha256: sha(join(ext, "dist/stack/stack.pbar.br")) }, native: { [platform]: { file: "native.pbar.br", files: nat.files, unpacked: nat.bytes, bytes: 1, sha256: sha(join(ext, "dist/stack/native.pbar.br")) } } },
      }),
    );
    const env = { HOME: userHome, USERPROFILE: userHome };
    const root = oldProject("unpack-project", "^0.0.3");
    const before = pb(["stack", "--format", "json"], root, pbHome, env).json();
    expect(before.extensions).toEqual([{ dir: ext, version: "0.0.3", carries: "0.0.3", unpacked: false }]);
    expect(pb(["stack"], root, pbHome, env).stdout).toContain(`its stack 0.0.3 is not unpacked yet. \`protoboard stack unpack ${ext}\``);
    // no path: the installed extension is found
    const r = pb(["stack", "unpack", "--format", "json"], root, pbHome, env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json()).toMatchObject({ version: "0.0.3", unpacked: true, from: ext, stack: stackDir(pbHome, "0.0.3"), link: { version: "0.0.3" } });
    expect(lstatSync(join(root, "node_modules/@protoboardai/core")).isSymbolicLink()).toBe(true);
    expect(pb(["stack", "--format", "json"], root, pbHome, env).json().extensions[0].unpacked).toBe(true);
    // the same through `stack install --from-vsix <folder>`: there already
    const again = pb(["stack", "install", "--from-vsix", ext, "--format", "json"], root, pbHome, env);
    expect(again.status, again.stderr).toBe(0);
    expect(again.json()).toMatchObject({ unpacked: false });
    // another build of 0.0.3 (another digest) replaces that copy only with --replace (PB-1048)
    const manifest = JSON.parse(readFileSync(join(ext, "dist/stack/stack.json"), "utf8"));
    writeFileSync(join(ext, "dist/stack/stack.json"), JSON.stringify({ ...manifest, digest: "d3-rebuilt" }));
    const refused = pb(["stack", "unpack", ext], root, pbHome, env);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/already holds the Protoboard stack 0\.0\.3 from another build.*--replace/);
    expect(JSON.parse(readFileSync(join(stackDir(pbHome, "0.0.3"), "protoboard-stack.json"), "utf8")).digest).toBe("d3");
    const replaced = pb(["stack", "unpack", ext, "--replace", "--format", "json"], root, pbHome, env);
    expect(replaced.status, replaced.stderr).toBe(0);
    expect(replaced.json()).toMatchObject({ unpacked: true });
    expect(JSON.parse(readFileSync(join(stackDir(pbHome, "0.0.3"), "protoboard-stack.json"), "utf8")).digest).toBe("d3-rebuilt");
  });
});

describe("a blank project's extension, extensions add, skills read and what doctor says of the project's files (PB-1018)", () => {
  const root = join(TMP, "blank-ext");
  beforeAll(() => {
    const r = pb(["init", root, "--stack", "global", "--no-parts", "--format", "json"]);
    expect(r.status, r.stderr).toBe(0);
  });

  it("a blank project lists ext-hardware, links it, has its skills listed by name in AGENTS.md, and a CLAUDE.md", () => {
    expect(lstatSync(join(root, "node_modules", "@protoboardai", "ext-hardware")).isSymbolicLink()).toBe(true);
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("**build-a-project** (@protoboardai/ext-hardware)");
    // the list names skills and how to read them; no path into the user's copy, which is one machine's
    expect(agents).not.toContain(HOME);
    expect(agents).not.toMatch(/\(`[^`]*SKILL\.md`\)/);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(existsSync(join(root, ".claude", "skills", "build-a-project", "SKILL.md"))).toBe(true);
  });

  it("skills read prints a skill by name, and a file of it", () => {
    const r = pb(["skills", "read", "build-a-project", "--format", "json"], root);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json()).toMatchObject({ id: "build-a-project", extension: "@protoboardai/ext-hardware", file: "SKILL.md" });
    expect(r.json().text).toMatch(/^---\nname: build-a-project/);
    const missing = pb(["skills", "read", "no-such-skill"], root);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/no skill "no-such-skill"/);
    expect(pb(["skills", "read", "build-a-project", "../../package.json"], root).stderr).toMatch(/is not a file of the skill/);
  });

  it("extensions add lists an extension in package.json and the config, links it from the user's copy and exports its skills", () => {
    const r = pb(["extensions", "add", "docs", "--format", "json"], root);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json().added).toEqual([expect.objectContaining({ package: "@protoboardai/ext-docs", packageJson: "added", config: "added" })]);
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies["@protoboardai/ext-docs"]).toBe(`^${VERSION}`);
    expect(readFileSync(join(root, "protoboard.config.ts"), "utf8")).toContain('extensions: ["@protoboardai/ext-hardware", "@protoboardai/ext-docs"]');
    expect(lstatSync(join(root, "node_modules", "@protoboardai", "ext-docs")).isSymbolicLink()).toBe(true);
    // a second time changes nothing
    expect(pb(["extensions", "add", "@protoboardai/ext-docs", "--format", "json"], root).json().added).toEqual([expect.objectContaining({ packageJson: "present", config: "present" })]);
    // one the user's copy does not have changes nothing, and says what it has
    const before = readFileSync(join(root, "package.json"), "utf8");
    const none = pb(["extensions", "add", "ext-nothing"], root);
    expect(none.status).not.toBe(0);
    expect(none.stderr).toMatch(/@protoboardai\/ext-nothing is not in the Protoboard installed for your user.*nothing was changed/);
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(before);
    const check = pb(["check", "--format", "json"], root);
    expect(check.status, check.stderr + check.stdout).toBe(0);
  });

  it("doctor says when AGENTS.md lists skills by one machine's paths, and when Claude Code would not read it", () => {
    const agents = join(root, "AGENTS.md");
    const now = readFileSync(agents, "utf8");
    // what 0.1.6's export wrote, as found in a project moved from another folder
    writeFileSync(agents, now.replace(/- \*\*build-a-project\*\* \(@protoboardai\/ext-hardware\) — /, "- **build-a-project** — the order of work (`../../../../.protoboard/stack/0.1.6/node_modules/@protoboardai/ext-hardware/skills/build-a-project/SKILL.md`) "));
    rmSync(join(root, "CLAUDE.md"));
    const r = pb(["doctor", "--format", "json"], root);
    expect(r.json().guidance.map((g: { id: string }) => g.id).sort()).toEqual(["agents-skill-paths", "claude-md"]);
    expect(pb(["doctor"], root).stdout).toMatch(/AGENTS\.md lists its skills by paths on one machine[\s\S]*`protoboard skills export --host agents-md`/);
    // the export rewrites the list, and doctor is satisfied
    expect(pb(["skills", "export", "--host", "agents-md"], root).status).toBe(0);
    writeFileSync(join(root, "CLAUDE.md"), "@AGENTS.md\n");
    expect(pb(["doctor", "--format", "json"], root).json().guidance).toEqual([]);
  });

  it("doctor says when AGENTS.md's guidance is an earlier stack's, and init --refresh-guidance brings it up to date (F03)", () => {
    const agents = join(root, "AGENTS.md");
    const now = readFileSync(agents, "utf8");
    // as 0.1.6 wrote it: no shared guidance, no CLAUDE.md
    writeFileSync(agents, now.replace(/<!-- protoboard:guidance:begin[\s\S]*<!-- protoboard:guidance:end -->\n\n/, ""));
    rmSync(join(root, "CLAUDE.md"));
    expect(pb(["doctor", "--format", "json"], root).json().guidance.map((g: { id: string }) => g.id).sort()).toEqual(["agents-guidance", "claude-md"]);
    const r = pb(["init", "--refresh-guidance", "--format", "json"], root);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json()).toMatchObject({ agents: "inserted", claude: "written", notes: [] });
    expect(readFileSync(agents, "utf8")).toBe(now);
    expect(pb(["doctor", "--format", "json"], root).json().guidance).toEqual([]);
  });
});

describe("protoboard init --stack project, and from the stack's repository", () => {
  it("--stack project leaves the packages to the project's npm install", () => {
    const root = join(TMP, "project-one");
    const r = pb(["init", root, "--stack", "project", "--no-parts", "--format", "json"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json()).toMatchObject({ stackMode: "project", skills: "postinstall" });
    expect(r.json().stack).toBeUndefined();
    expect(existsSync(join(root, "node_modules"))).toBe(false);
  });

  it("this repository's own CLI installs with npm unless asked (its tests and examples do), and says why", () => {
    const root = join(TMP, "repo-default");
    const r = pb(["init", root, "--no-parts"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("&& npm install, then `npx @protoboardai/cli check`");
    // never a bare `npx protoboard`: npm would fetch an unrelated public package of that name
    expect(r.stdout).not.toMatch(/npx protoboard\b/);
    expect(r.stdout).toContain("this CLI runs from the stack's repository");
    expect(r.stdout).toContain("Open it in VS Code, in a new window: code --new-window");
    expect(existsSync(join(root, "node_modules"))).toBe(false);
  });

  it("--registry is the registry route as it was: an .npmrc and npm install", () => {
    const root = join(TMP, "registry-route");
    const r = pb(["init", root, "--registry", "http://127.0.0.1:4873/", "--no-parts", "--format", "json"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json().stackMode).toBe("project");
    expect(readFileSync(join(root, ".npmrc"), "utf8")).toContain("@protoboardai:registry=http://127.0.0.1:4873/");
  });

  it("refuses a --stack it does not know", () => {
    const r = pb(["init", join(TMP, "never"), "--stack", "nowhere"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--stack takes global");
    expect(existsSync(join(TMP, "never"))).toBe(false);
  });
});
