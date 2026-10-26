/**
 * The generated reference documents stay in step with the code (PB-809):
 * docs/reference/cli.md is the CLI's own `--help`, and
 * docs/reference/extensions.md is every extension manifest, skill and eval
 * case in this repository. A command, flag, operation, check, tool, skill or
 * case that changes without `node scripts/reference-docs.mjs` fails here.
 *
 * The hand-written docs are held to the same CLI: every `protoboard <command>`
 * the quickstart, the reference set, the release notes and the beta checklist
 * name must be a command (and every `--flag` a flag) of that help.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REFERENCE_FILES, REPO, helpEntries, helpText } from "../../../scripts/reference-docs.mjs";

const files = REFERENCE_FILES;

describe("generated reference documents", () => {
  for (const [rel, make] of Object.entries(files)) {
    it(`${rel} is up to date (node scripts/reference-docs.mjs)`, () => {
      const file = join(REPO, rel);
      expect(existsSync(file), `${rel} is missing: run node scripts/reference-docs.mjs`).toBe(true);
      expect(readFileSync(file, "utf8"), `${rel} is out of date: run node scripts/reference-docs.mjs`).toBe(make());
    });
  }

  it("the help parses into commands and options, every entry with a description", () => {
    const help = helpText();
    const commands = helpEntries(help, "Commands", "Options");
    const options = helpEntries(help, "Options");
    expect(commands.length).toBeGreaterThan(20);
    expect(options.length).toBeGreaterThan(20);
    for (const e of [...commands, ...options]) {
      expect(e.description, `help entry "${e.signature}" has no description (a signature too long for its column needs the description on the next line)`).not.toBe("");
      // a signature with a space-separated description run into it (one space instead of the column)
      expect(e.signature, `help entry "${e.signature}" runs into its description`).not.toMatch(/ [A-Z][a-z]+ /);
    }
  });
});

/** Hand-written docs whose commands must exist. */
const DOCS = [
  "docs/quickstart.md",
  "docs/reference/README.md",
  "docs/reference/configuration.md",
  "docs/reference/display.md",
  "docs/reference/manufacturing-package.md",
  "docs/reference/library-protocol.md",
  "docs/releases/stack-v0.1.md",
  "docs/releases/stack-v0.2.md",
  "docs/guides/local-registry.md",
];

describe("hand-written docs name only real commands", () => {
  const help = helpText();
  const commands = helpEntries(help, "Commands", "Options").map((c) => c.signature.split(/\s+/));
  const tops = new Set(commands.map((c) => c[0]));
  const subs = new Map<string, Set<string>>();
  for (const c of commands) if (c[1] && /^[a-z][\w-]*$/.test(c[1])) subs.set(c[0], (subs.get(c[0]) ?? new Set()).add(c[1]));
  const flags = new Set([...help.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]).concat(["help", "version"]));

  for (const rel of DOCS) {
    it(rel, () => {
      const text = readFileSync(join(REPO, rel), "utf8");
      const problems: string[] = [];
      // `protoboard <cmd> [<sub>] ...` in code: npx protoboard, protoboard, pb
      for (const m of text.matchAll(/(?:^|[\s`(])(?:npx )?protoboard ((?:[a-z][\w:-]*)(?: [a-z][\w-]*)?)([^\n`]*)/gm)) {
        const [cmd, sub] = m[1].split(" ");
        if (cmd.includes(":")) continue; // run <capability>:<op>
        if (!tops.has(cmd)) {
          problems.push(`unknown command "protoboard ${cmd}"`);
          continue;
        }
        if (sub && subs.has(cmd) && !subs.get(cmd)!.has(sub) && /^(add|remove|move|install|export|search|taxonomy|update|offers|publish)$/.test(sub)) problems.push(`unknown subcommand "protoboard ${cmd} ${sub}"`);
        for (const f of `${m[1]}${m[2]}`.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) {
          if (!flags.has(f[1])) problems.push(`unknown flag --${f[1]} in "protoboard ${m[1]}${m[2]}"`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
