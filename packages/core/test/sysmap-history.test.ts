/**
 * The System Map's history (docs/specs/system-map.md, "Status and changes"):
 * on a git repository with two release tags and uncommitted work, which items
 * are released or new, the last release each changed in and the one line why
 * (a release-notes bullet when one names the item, else what the history
 * shows). Needs git; skipped without it.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSystemMap } from "../src/sysmap/build.js";
import { historyFingerprint, readHistory } from "../src/sysmap/history.js";
import type { SystemMap } from "../src/sysmap/model.js";
import { stackFiles, writeFiles } from "./sysmap-fixture.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const TMP = mkdtempSync(join(tmpdir(), "protoboard-sysmap-history-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

const ROOT = join(TMP, "repo");
let map: SystemMap;

describe.skipIf(!hasGit)("history", () => {
  beforeAll(async () => {
    const files = stackFiles();
    writeFiles(ROOT, files);
    writeFileSync(join(ROOT, ".gitignore"), "node_modules/\n");
    git(ROOT, "init", "-q");
    git(ROOT, "add", "-A");
    git(ROOT, "commit", "-q", "-m", "1.0.0");
    git(ROOT, "tag", "v1.0.0");
    // 1.1.0: board-verify's SKILL.md changes, the report operation's entry changes
    const verify = "packages/ext-a/skills/board-verify/SKILL.md";
    writeFileSync(join(ROOT, verify), readFileSync(join(ROOT, verify), "utf8") + "\nOne more step.\n");
    const mPath = join(ROOT, "packages/ext-a/protoboard-extension.json");
    writeFileSync(mPath, readFileSync(mPath, "utf8").replace("Write the board report", "Write the board report, with photos"));
    git(ROOT, "commit", "-q", "-am", "1.1.0");
    git(ROOT, "tag", "-a", "v1.1.0", "-m", "1.1.0");
    // since 1.1.0, not committed: a new MCP tool, a changed check case, a file under board-make's folder
    const tools = join(ROOT, "packages/cli/src/mcp/tools.ts");
    writeFileSync(
      tools,
      readFileSync(tools, "utf8").replace(
        "  ];\n}",
        `    tool({\n      name: "project_where",\n      title: "Where a thing is",\n      description: "Where.",\n      handler: async ({ dir }, ctx) => command(ctx, dir, cliArgs(["check"])),\n    }),\n  ];\n}`,
      ),
    );
    const index = join(ROOT, "packages/cli/src/index.ts");
    writeFileSync(index, readFileSync(index, "utf8").replace("      // docs/specs/foo.md\n", "      // docs/specs/foo.md\n      cache();\n"));
    writeFiles(ROOT, { "packages/ext-a/skills/board-make/references/codes.md": "# Codes\n" });
    map = await buildSystemMap(ROOT, { stack: "1.0.0" });
  });

  const item = (id: string) => map.items.find((i) => i.id === id)!;

  it("lists the release tags, oldest first, with their dates", () => {
    expect(map.releases.map((r) => [r.version, r.tag])).toEqual([
      ["1.0.0", "v1.0.0"],
      ["1.1.0", "v1.1.0"],
    ]);
    expect(map.releases.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
    expect(map.problems.map((p) => p.reason)).not.toContain("HISTORY_UNAVAILABLE");
    expect(map.history?.tags).toHaveLength(2);
  });

  it("marks an item that is not in the last release as wip, with no version yet", () => {
    expect(item("mcp:project_where")).toMatchObject({ status: "wip", version: null, versionFrom: "unreleased", changed: { in: "unreleased", from: "history", why: "New since v1.1.0, not released yet" } });
    expect(item("mcp:project_check").status).toBe("released");
  });

  it("finds the last release an item changed in, by its file, its folder or its entry", () => {
    expect(item("skill:board-verify").changed).toMatchObject({ in: "1.1.0", why: "SKILL.md changed", from: "history" });
    expect(item("skill:board-verify").changed?.date).toBe(map.releases[1].date);
    expect(item("op:@protoboardai/ext-a#report").changed).toMatchObject({ in: "1.1.0", why: "Its entry in protoboard-extension.json changed" });
    expect(item("skill:board-make").changed).toMatchObject({ in: "unreleased", why: "references/codes.md changed" });
    // the manifest changed in 1.1.0, but not this entry of it
    expect(item("check:@protoboardai/ext-a#boards").changed).toMatchObject({ in: "1.0.0", why: "In v1.0.0, the earliest release tag; unchanged since" });
  });

  it("takes the line from a release-notes bullet that names the item", () => {
    expect(item("cli:check").changed).toEqual({ in: "unreleased", why: "The check got faster", from: "release-notes" });
  });

  it("leaves outside items without history", () => {
    expect(item("skill:uhd-authoring")).toMatchObject({ status: "outside", changed: null });
  });

  it("gives the same fingerprint the cheap way", async () => {
    expect(await historyFingerprint(ROOT)).toEqual(map.history);
    const h = await readHistory(ROOT);
    expect("unavailable" in h).toBe(false);
  });

  it("says why there is no history in a repository without release tags", async () => {
    const bare = join(TMP, "untagged");
    writeFiles(bare, { "a.txt": "a\n" });
    git(bare, "init", "-q");
    git(bare, "add", "-A");
    git(bare, "commit", "-q", "-m", "x");
    const h = await readHistory(bare);
    expect(h).toEqual({ unavailable: "the repository has no release tags (v<major>.<minor>.<patch>)" });
  });
});
