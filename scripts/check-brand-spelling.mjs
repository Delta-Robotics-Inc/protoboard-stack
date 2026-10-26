#!/usr/bin/env node
/**
 * Brand spelling guard (PB-913): the product is "Protoboard", with a
 * lowercase b. This fails on "ProtoBoard" (and "protoBoard") in any file git
 * tracks, as it is in the working tree, binary files aside.
 *
 *   node scripts/check-brand-spelling.mjs [--root <repo>] [--allowlist <file>] [--json]
 *
 * The allowlist (default `<root>/scripts/brand-spelling-allowlist.json` when
 * it exists) lists the occurrences kept on purpose, each with its reason:
 *
 *   { "entries": [ { "path": "library/terms.json", "contains": "LicenseRef-ProtoBoard-Library", "reason": "..." } ] }
 *
 * `path` is a repository path, or a pattern with `*` (one path segment) and
 * `**` (any number of segments); `contains`, when given, must be on the same
 * line, so a new occurrence elsewhere in an allowlisted file still fails.
 * The allowlist file itself is not checked.
 * The same script checks any repository of the stack with --root.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OLD_SPELLING = /[Pp]rotoBoard/;

/** A path pattern with `*` and `**` as a RegExp over repository paths. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Every occurrence of the old spelling under `root` that the allowlist does not keep. */
export const findOldSpelling = (root, allowlist = { entries: [] }, allowlistPath) => findPattern(root, OLD_SPELLING, allowlist, allowlistPath);

/**
 * Every line matching `pattern` in a text file git tracks under `root` that
 * the allowlist does not keep (`found`), and the allowlist entries that keep
 * nothing (`unused`). Shared with scripts/check-npm-scope.mjs.
 */
export function findPattern(root, pattern, allowlist = { entries: [] }, allowlistPath) {
  const entries = (allowlist.entries ?? []).map((e) => ({ ...e, re: globToRegExp(e.path) }));
  const used = new Set();
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
  const found = [];
  for (const path of files) {
    const abs = join(root, path);
    if (allowlistPath && resolve(abs) === resolve(allowlistPath)) continue; // it quotes what it keeps
    let buf;
    try {
      if (!statSync(abs).isFile()) continue;
      buf = readFileSync(abs);
    } catch {
      continue; // deleted in the working tree, or a submodule
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    const text = buf.toString("utf8");
    if (!pattern.test(text)) continue;
    text.split("\n").forEach((line, i) => {
      if (!pattern.test(line)) return;
      const keep = entries.findIndex((e) => e.re.test(path) && (e.contains === undefined || line.includes(e.contains)));
      if (keep >= 0) used.add(keep);
      else found.push({ path, line: i + 1, text: line.trim().slice(0, 200) });
    });
  }
  const unused = entries.filter((_, i) => !used.has(i)).map(({ re, ...e }) => e);
  return { found, unused };
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(arg("--root") ?? join(here, ".."));
  const listPath = arg("--allowlist") ?? join(root, "scripts", "brand-spelling-allowlist.json");
  const allowlist = existsSync(listPath) ? JSON.parse(readFileSync(listPath, "utf8")) : { entries: [] };
  const { found, unused } = findOldSpelling(root, allowlist, listPath);
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ root, found, unused }, null, 2) + "\n");
  } else {
    for (const f of found) process.stderr.write(`${f.path}:${f.line}: "ProtoBoard" is spelled "Protoboard" (lowercase b): ${f.text}\n`);
    for (const e of unused) process.stderr.write(`allowlist entry no longer matches anything, remove it: ${e.path}${e.contains ? ` (${e.contains})` : ""}\n`);
    if (found.length === 0 && unused.length === 0) process.stdout.write(`brand spelling: no "ProtoBoard" in ${root} (${(allowlist.entries ?? []).length} kept on purpose)\n`);
  }
  return found.length === 0 && unused.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
