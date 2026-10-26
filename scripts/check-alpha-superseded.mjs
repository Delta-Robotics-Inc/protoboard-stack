#!/usr/bin/env node
/**
 * Alpha-superseded guard (product owners' decision, 2026-10-08): the older
 * Protoboard web app ("the alpha": alpha.protoboard.xyz, its browser board,
 * its own MCP tools, its `*.protoboard` board files and ProtoPart JSON) is
 * not part of how anything is built with the stack. What is DELIVERED to
 * users or their agents must not present it as a step, a tool, a place to go
 * or a format to use, and must not send anyone to it.
 *
 *   node scripts/check-alpha-superseded.mjs [--root <repo>] [--allowlist <file>] [--json] [--list]
 *
 * It reads only the delivered material, named in one place (DELIVERED below):
 * what `protoboard init` writes, the skills, the MCP server's text, the CLI's
 * and the extension's messages, the downloads site, the documents handed to
 * users. It does NOT read docs/specs, release notes, eval records, tests,
 * protocols/ or code comments: developers may know where a design or a rule
 * came from. In source files only the code is read, with comments blanked
 * out, so a string, a JSX text or an identifier counts and a comment does not.
 *
 * The allowlist (default `<root>/scripts/alpha-superseded-allowlist.json`)
 * names each occurrence kept on purpose, with its reason: the warning that
 * Protoboard is not the alpha web app, and uses of the same words that mean
 * something else (the manufacturer Alpha & Omega, an angle named alpha, a
 * colour's alpha channel). Its entries are those of the brand-spelling guard
 * (`path` with `*` and `**`, optional `contains` on the same line, `reason`);
 * an entry that keeps nothing fails. `--list` prints the delivered files.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRegExp } from "./check-brand-spelling.mjs";

/**
 * The delivered material, as path patterns (`*` one segment, `**` any number).
 * `read: "text"` reads the whole file (it is delivered as it is);
 * `read: "code"` reads a source file without its comments (its strings and
 * markup reach users; its comments are for developers).
 */
export const DELIVERED = [
  // what `protoboard init` writes into a new project (AGENTS.md, docs, sources); init.ts itself is under core/src below
  { path: "packages/core/templates/**", read: "text" },
  // the skills the extensions ship, and what `protoboard skills export` copies into a project
  { path: "packages/ext-*/skills/**", read: "text" },
  // the eval cases the extensions ship (`protoboard evals`): each case's task is what an agent under test is told
  { path: "packages/ext-*/evals/**", read: "text" },
  // each extension's manifest: the descriptions `protoboard capabilities`, `doctor` and the extension show
  { path: "packages/ext-*/protoboard-extension.json", read: "text" },
  // the README of every package (npm packs it whatever `files` says; the extension's is its page in VS Code)
  { path: "packages/*/README.md", read: "text" },
  // the CLI: help, messages, the MCP server's instructions, tool descriptions and prompts, the dev server's page
  { path: "packages/cli/bin/**", read: "code" },
  { path: "packages/cli/src/**", read: "code" },
  // core: messages, diagnostics, what init and the agents' set-up write
  { path: "packages/core/src/**", read: "code" },
  // the extensions' operations, checks and generators: their messages and what they write into documents
  { path: "packages/ext-*/lib/**", read: "code" },
  { path: "packages/ext-*/ops/**", read: "code" },
  { path: "packages/ext-*/checks/**", read: "code" },
  { path: "packages/ext-*/scripts/**", read: "code" },
  { path: "packages/ext-*/py/**", read: "code" },
  // the views and the web viewer: every label a person reads
  { path: "packages/views/src/**", read: "code" },
  { path: "packages/web-viewer/src/**", read: "code" },
  // the VS Code extension: manifest (commands, settings, walkthrough), walkthrough pages, themes, source and pages
  { path: "packages/vscode-protoboard/package.json", read: "text" },
  { path: "packages/vscode-protoboard/media/walkthrough/**", read: "text" },
  { path: "packages/vscode-protoboard/themes/**", read: "text" },
  { path: "packages/vscode-protoboard/src/**", read: "code" },
  { path: "packages/vscode-protoboard/webview/**", read: "code" },
  // the documents handed to users and testers
  { path: "docs/quickstart.md", read: "text" },
  { path: "docs/reference/**", read: "text" },
  { path: "docs/guides/installation.md", read: "text" },
];

/** The alpha's MCP tools whose names the stack does not use for anything of its own. */
const ALPHA_MCP_TOOLS = [
  "add_interface_instance", "add_review_comment", "add_template_artifact", "add_to_group", "allocate_resource_to_interface_function",
  "auto_allocate_harness_resources", "auto_allocate_resource", "auto_arrange_parts", "auto_link_functions", "auto_link_interfaces",
  "auto_route_harnesses", "batch_link_functions", "check_compatibility", "check_project_part_updates", "connect_board", "create_annotation",
  "create_blank_part", "create_group", "create_harness", "deallocate_resource", "delete_element", "duplicate_elements", "export_board",
  "find_empty_space", "get_board_identity_summary", "get_board_snapshot", "get_board_summary", "get_bom_export_options", "get_bom_item_details",
  "get_bom_items", "get_bridge_diagnostics", "get_call_status", "get_capacity_status", "get_harness_details", "get_layout_issues",
  "get_parts_list", "get_project_cost_estimate", "get_template_json", "import_board", "inspect_part", "link_functions", "link_interfaces",
  "list_boards", "list_elements", "list_interface_functions", "list_interface_instances", "list_part_resources", "list_review_comments",
  "move_group", "move_harness_handle", "move_part", "open_board", "place_part", "preview_function_links", "refresh_bom_prices",
  "remove_from_group", "remove_harness_link", "remove_interface_instance", "rename_harness", "rename_part", "resize_group", "review_board",
  "search_library", "set_active_bom_supplier", "set_template_icon", "submit_app_feedback", "submit_part_fix", "submit_part_request",
  "swap_template", "switch_mode", "update_board_identity", "update_template_json", "upsert_bom_supplier_record",
];

/** What a line may not say, each with the message printed for it. `read` limits a rule to one way of reading. */
export const RULES = [
  { id: "alpha", read: "text", re: /\balpha\b/i, say: 'names "the alpha": the older web app is not part of the process' },
  // in code a lowercase `alpha` is a variable (an angle, a colour's channel): there, the word as the product's name
  { id: "alpha", read: "code", re: /\bAlpha\b|\bALPHA_[A-Z]|next-alpha|\b(?:[Tt]he|[Pp]rotoboard|[Yy]our|[Aa]n)\s+alpha\b|\balpha['’]s\b|\balpha\s+(?:app|web|board|account|e-?mail|mcp|MCP|server|site|version|user)/, say: 'names "the alpha": the older web app is not part of the process' },
  { id: "alpha-site", re: /\b(?:alpha|docs)\.protoboard\.xyz\b/i, say: "sends the reader to the alpha's site or its documentation" },
  { id: "web-app", re: /browser board|protoboard(?: alpha)? web app/i, say: "speaks of the web app or its browser board: only the not-the-web-app warning does" },
  { id: "board-file", re: /\*\.protoboard(?![\w/-])|\.protoboard\s+(?:board\s+)?files?\b/i, say: "the alpha's board file type (*.protoboard) is not read or written by the stack" },
  { id: "board-file", read: "text", re: /\w\.protoboard(?![\w/.-])/, say: "the alpha's board file type (*.protoboard) is not read or written by the stack" },
  { id: "board-file", read: "code", re: /\w\.protoboard["'`\]]/, say: "the alpha's board file type (*.protoboard) is not read or written by the stack" },
  { id: "protopart", re: /proto-?part/i, say: "ProtoPart is the alpha's part format: parts are UHD definitions (.uhd.ts, `protoboard parts …`)" },
  { id: "alpha-mcp-tool", re: new RegExp(`\\b(?:${ALPHA_MCP_TOOLS.join("|")})\\b`), say: "names an MCP tool of the alpha: the stack's tools are project_*, parts_*, skills_list, skill_read, bom, release_check" },
];

const CODE = /\.(?:[cm]?[jt]sx?|py)$/;

/**
 * A source file with its comments replaced by spaces (line numbers kept):
 * `//` and `/* *\/` for JavaScript and TypeScript, `#` for Python. Strings are
 * kept whole, template literals with the code inside their `${…}` (nested
 * ones too); `://` is not a comment (a URL in JSX text). A regular expression
 * literal holding a quote or `/*` can mislead it: then more is read, or less,
 * until that string or comment ends; the tests pin what matters.
 */
export function withoutComments(text, path) {
  const python = path.endsWith(".py");
  const n = text.length;
  const blank = (s) => s.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  // what encloses the position: "`" inside a template literal's text, a number for the brace depth of code inside `${…}`
  const stack = [];
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    const top = stack[stack.length - 1];
    if (top === "`") {
      if (c === "\\") {
        out += text.slice(i, i + 2);
        i += 2;
      } else if (c === "`") {
        stack.pop();
        out += c;
        i++;
      } else if (c === "$" && d === "{") {
        stack.push(0);
        out += "${";
        i += 2;
      } else {
        out += c;
        i++;
      }
    } else if (python && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const end = text.indexOf(text.slice(i, i + 3), i + 3);
      const stop = end < 0 ? n : end + 3;
      out += text.slice(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      // a string: to its closing quote, or the line's end
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      const stop = Math.min(n, text[j] === c ? j + 1 : j);
      out += text.slice(i, stop);
      i = stop;
    } else if (!python && c === "`") {
      stack.push("`");
      out += c;
      i++;
    } else if (python ? c === "#" : c === "/" && d === "/" && text[i - 1] !== ":" && text[i - 1] !== "\\") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (!python && c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
    } else {
      if (typeof top === "number") {
        if (c === "{") stack[stack.length - 1] = top + 1;
        else if (c === "}") {
          if (top === 0) stack.pop();
          else stack[stack.length - 1] = top - 1;
        }
      }
      out += c;
      i++;
    }
  }
  return out;
}

/** The delivered files git tracks under `root`, each with how it is read. */
export function deliveredFiles(root, delivered = DELIVERED) {
  const patterns = delivered.map((d) => ({ ...d, re: globToRegExp(d.path) }));
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
  const out = [];
  for (const path of files) {
    const d = patterns.find((p) => p.re.test(path));
    if (!d) continue;
    if (/(^|\/)(test|tests|__tests__)\//.test(path)) continue; // never packed, never shown
    out.push({ path, read: d.read === "code" && CODE.test(path) ? "code" : "text", pattern: d.path });
  }
  return out;
}

/**
 * Every line of the delivered material that a rule forbids and the allowlist
 * does not keep (`found`), the allowlist entries that keep nothing
 * (`unused`), and the delivered patterns that match no file (`empty`).
 */
export function findAlpha(root, allowlist = { entries: [] }, delivered = DELIVERED) {
  const entries = (allowlist.entries ?? []).map((e) => ({ ...e, re: globToRegExp(e.path) }));
  const used = new Set();
  const found = [];
  const files = deliveredFiles(root, delivered);
  for (const { path, read } of files) {
    const abs = join(root, path);
    let buf;
    try {
      if (!statSync(abs).isFile()) continue;
      buf = readFileSync(abs);
    } catch {
      continue; // deleted in the working tree
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    const raw = buf.toString("utf8");
    const rawLines = raw.split("\n");
    const lines = read === "code" ? withoutComments(raw, path).split("\n") : rawLines;
    lines.forEach((line, i) => {
      const rule = RULES.find((r) => (!r.read || r.read === read) && r.re.test(line));
      if (!rule) return;
      const keep = entries.findIndex((e) => e.re.test(path) && (e.contains === undefined || rawLines[i].includes(e.contains)));
      if (keep >= 0) used.add(keep);
      else found.push({ path, line: i + 1, rule: rule.id, say: rule.say, text: rawLines[i].trim().slice(0, 200) });
    });
  }
  const unused = entries.filter((_, i) => !used.has(i)).map(({ re, ...e }) => e);
  const empty = delivered.filter((d) => !files.some((f) => f.pattern === d.path)).map((d) => d.path);
  return { found, unused, empty, files: files.length };
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(arg("--root") ?? join(here, ".."));
  if (argv.includes("--list")) {
    for (const f of deliveredFiles(root)) process.stdout.write(`${f.read}  ${f.path}\n`);
    return 0;
  }
  const listPath = arg("--allowlist") ?? join(root, "scripts", "alpha-superseded-allowlist.json");
  const allowlist = existsSync(listPath) ? JSON.parse(readFileSync(listPath, "utf8")) : { entries: [] };
  const { found, unused, empty, files } = findAlpha(root, allowlist);
  const ok = found.length === 0 && unused.length === 0 && empty.length === 0;
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ root, files, found, unused, empty }, null, 2) + "\n");
  } else {
    for (const f of found) process.stderr.write(`${f.path}:${f.line}: ${f.say}: ${f.text}\n`);
    for (const e of unused) process.stderr.write(`allowlist entry no longer matches anything, remove it: ${e.path}${e.contains ? ` (${e.contains})` : ""}\n`);
    for (const p of empty) process.stderr.write(`delivered pattern matches no file, correct it in scripts/check-alpha-superseded.mjs: ${p}\n`);
    if (ok) process.stdout.write(`alpha superseded: nothing delivered presents the alpha as part of the process in ${root} (${files} delivered files read, ${(allowlist.entries ?? []).length} occurrences kept on purpose)\n`);
  }
  return ok ? 0 : 1;
}

// exitCode, not exit(): exit() can cut a piped listing short before it is written
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
