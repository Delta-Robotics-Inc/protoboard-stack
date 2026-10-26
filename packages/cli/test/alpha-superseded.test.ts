/**
 * Alpha-superseded guard (product owners' decision, 2026-10-08): what is
 * delivered to users or their agents does not present the older web app
 * ("the alpha") as part of how anything is built. scripts/check-alpha-superseded.mjs
 * reads the delivered material only (its DELIVERED list) and fails on the
 * alpha's name, sites, board files, part format and MCP tools outside
 * scripts/alpha-superseded-allowlist.json (the not-the-web-app warning, and
 * the same words meaning something else).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "scripts/check-alpha-superseded.mjs");
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

describe("alpha superseded", () => {
  it("nothing delivered presents the alpha as part of the process, apart from the allowlist", () => {
    const r = run(["--root", ROOT, "--json"]);
    const { found, unused, empty, files } = JSON.parse(r.stdout);
    expect(found, "give the stack's way (UHD parts, `protoboard parts …`, `protoboard check`, the skills), or add the occurrence to scripts/alpha-superseded-allowlist.json with its reason").toEqual([]);
    expect(unused, "allowlist entries that match nothing").toEqual([]);
    expect(empty, "delivered patterns that match no file").toEqual([]);
    expect(files).toBeGreaterThan(300);
    expect(r.status).toBe(0);
  });

  it("reads the delivered material and nothing else", () => {
    const listed = run(["--root", ROOT, "--list"]).stdout.trim().split("\n").map((l) => l.replace(/^\w+\s+/, ""));
    for (const p of ["packages/core/templates/iot/files/AGENTS.md.tmpl", "packages/cli/src/mcp/instructions.ts", "packages/cli/src/index.ts", "packages/vscode-protoboard/package.json", "packages/vscode-protoboard/README.md", "docs/guides/installation.md", "docs/reference/cli.md"]) expect(listed, p).toContain(p);
    expect(listed.some((p) => /^packages\/ext-[^/]+\/skills\/[^/]+\/SKILL\.md$/.test(p))).toBe(true);
    expect(listed.filter((p) => /^(docs\/specs|docs\/releases|docs\/evals|examples|scripts)\//.test(p) || /\/test\//.test(p))).toEqual([]);
  });

  const scratch = mkdtempSync(join(tmpdir(), "pb-alpha-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("fails on each way of pointing at the alpha, not on comments or on what is not delivered, keeps an allowlisted line, and flags a stale entry", () => {
    execFileSync("git", ["init", "-q", scratch]);
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    };
    write(
      "packages/core/templates/iot/files/AGENTS.md",
      [
        "# Agents", // 1
        "Open the board at https://alpha.protoboard.xyz/board and place parts.", // 2: the site (and the word)
        "Write the part as ProtoPart JSON.", // 3
        "Call search_library, then place_part.", // 4
        "Save it as board.protoboard and commit.", // 5
        "Generated files are in .protoboard/ and the stack is in ~/.protoboard; `.protoboard` is never edited.", // 6: the stack's folders
        "This is not the alpha web app.", // 7: allowlisted below
        "The guide is at docs.protoboard.xyz.", // 8
        "Call project_status, then parts_search.", // 9: the stack's own tools
        "",
      ].join("\n"),
    );
    write(
      "packages/cli/src/index.ts",
      [
        "// styled after the alpha's board; see alpha.protoboard.xyz", // 1: a comment
        "/* ProtoPart was the source of these names */ const alpha = Math.PI / 4;", // 2: a comment, and an angle
        'const help = `ui [file.protoboard]  ${on ? `the "alpha" board` : ""}`;', // 3: a board file in a string
        "const dir = join(root, \".protoboard\"); const kept = pkg.protoboard; // the alpha's", // 4: the folder, a manifest key, a comment
        'const msg = "Sign in with your alpha account"; // nested template above did not swallow this line', // 5
        "const page = <a href=\"https://alpha.protoboard.xyz\">Open</a>;", // 6: a URL is not a comment
        "const renderer = new WebGLRenderer({ alpha: true });", // 7: a colour's channel
        "",
      ].join("\n"),
    );
    write("packages/ext-demo/py/gen.py", ["alpha = 3  # the alpha's angle", 'print("see the ProtoPart record")', ""].join("\n"));
    write("docs/specs/history.md", "The palette comes from the alpha app (next-alpha); parts were ProtoPart JSON.\n");
    write("protocols/pcb/a.md", "Use search_library on the alpha board.\n");
    write("packages/cli/test/x.test.ts", 'expect(text).toMatch(/NOT the Protoboard alpha web app/);\n');
    write("scripts/alpha-superseded-allowlist.json", JSON.stringify({ entries: [{ path: "packages/core/templates/**", contains: "This is not the alpha web app.", reason: "the warning" }, { path: "gone/**", reason: "stale" }] }));
    execFileSync("git", ["-C", scratch, "add", "-A"]);
    const r = run(["--root", scratch, "--json"]);
    expect(r.status).toBe(1);
    const { found, unused } = JSON.parse(r.stdout);
    expect(found.map((f: { path: string; line: number; rule: string }) => `${f.path}:${f.line} ${f.rule}`).sort()).toEqual(
      [
        "packages/cli/src/index.ts:3 board-file",
        "packages/cli/src/index.ts:5 alpha",
        "packages/cli/src/index.ts:6 alpha-site",
        "packages/core/templates/iot/files/AGENTS.md:2 alpha",
        "packages/core/templates/iot/files/AGENTS.md:3 protopart",
        "packages/core/templates/iot/files/AGENTS.md:4 alpha-mcp-tool",
        "packages/core/templates/iot/files/AGENTS.md:5 board-file",
        "packages/core/templates/iot/files/AGENTS.md:8 alpha-site",
        "packages/ext-demo/py/gen.py:2 protopart",
      ].sort(),
    );
    expect(unused.map((e: { path: string }) => e.path)).toEqual(["gone/**"]);
  });
});
