/**
 * The text readers of the System Map (docs/specs/system-map.md, "Where items
 * are read from"): SKILL.md frontmatter and references, the stages of
 * build-a-project, the CLI's help text and command switch, the MCP tool
 * specs, the built-in view tabs, release notes and docs. Pure functions over
 * strings: no Node imports, nothing here touches a file.
 */

/** Line endings as \n. */
export const normalize = (text: string): string => text.replace(/\r\n?/g, "\n");

/**
 * One plain line from a summary: backticks dropped, cut at the first " — ",
 * ": " or "; " that leaves 24 to 150 characters, else at 150, first letter
 * capitalized.
 */
export function short(s: string | undefined): string {
  if (!s) return "";
  let t = s.replace(/`/g, "").replace(/\s+/g, " ").trim();
  for (const cut of [" — ", ": ", "; "]) {
    const i = t.indexOf(cut);
    if (i > 24 && i < 150) {
      t = t.slice(0, i);
      break;
    }
  }
  if (t.length > 150) t = t.slice(0, 147).replace(/[ ,(]+\S*$/, "") + "…";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** YAML frontmatter as flat string fields (single-line values and `>`/`|` blocks), and the body after it; null when the text has none. */
export function frontmatter(text: string): { fields: Record<string, string>; body: string } | null {
  const t = normalize(text);
  if (!t.startsWith("---\n")) return null;
  const end = t.indexOf("\n---", 4);
  if (end < 0) return null;
  const lines = t.slice(4, end).split("\n");
  const fields: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(value.startsWith(">") ? " " : "\n");
    } else if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    fields[m[1]] = value;
  }
  const after = t.indexOf("\n", end + 4);
  return { fields, body: after < 0 ? "" : t.slice(after + 1) };
}

/** Markdown split into its code (fenced blocks and inline spans) and its prose (everything else, code removed). */
export function splitCode(md: string): { code: string[]; prose: string } {
  const code: string[] = [];
  let prose = "";
  const lines = normalize(md).split("\n");
  let fence: string | null = null;
  let block: string[] = [];
  for (const line of lines) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) {
        code.push(block.join("\n"));
        block = [];
        fence = null;
      } else block.push(line);
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    prose += line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t, inner: string) => {
      code.push(inner);
      return " ";
    }) + "\n";
  }
  if (fence && block.length) code.push(block.join("\n"));
  return { code, prose };
}

/**
 * A markdown text line by line: each line's prose (inline code removed), its
 * code (inline spans; a fenced block's lines are code), and whether it is a
 * table row.
 */
export function mdLines(md: string): { prose: string; code: string[]; table: boolean }[] {
  const out: { prose: string; code: string[]; table: boolean }[] = [];
  let fence: string | null = null;
  for (const line of normalize(md).split("\n")) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      else out.push({ prose: "", code: [line], table: false });
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const code: string[] = [];
    const prose = line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t, inner: string) => {
      code.push(inner);
      return " ";
    });
    out.push({ prose, code, table: /^\s*\|/.test(line) });
  }
  return out;
}

/** The **bold** tokens of a text that look like ids (lower case, digits, dashes). */
export function boldIds(prose: string): string[] {
  const out: string[] = [];
  for (const m of prose.matchAll(/\*\*([a-z0-9][a-z0-9-]*)\*\*/g)) out.push(m[1]);
  return out;
}

/** Stack doc paths a text cites: docs/specs|guides|reference|releases/<name>.md. */
export function docPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\w/.-])((?:\.\.\/)*docs\/(?:specs|guides|reference|releases)\/[\w.-]+\.md)/g)) out.add(m[1].replace(/^(\.\.\/)+/, ""));
  return [...out];
}

/** `protoboard <command>` (or `npx protoboard`, `pb`) in a piece of code: the command words. */
export function cliMentions(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/(?:^|[\s(`"'$;|&])(?:npx\s+(?:@protoboardai\/cli\s+|protoboard\s+)|protoboard\s+)([a-z][a-z-]*)/g)) out.push(m[1]);
  return out;
}

/** `run <operation>` and `<capability>:<operation>` in a text (after a finding's prefix too: `ext:@scope/ext-x/firmware:check`). */
export function operationMentions(code: string): { plain: string[]; qualified: string[] } {
  const plain: string[] = [];
  const qualified: string[] = [];
  for (const m of code.matchAll(/\brun\s+([a-z][\w-]*(?::[a-z][\w-]*)?)/g)) (m[1].includes(":") ? qualified : plain).push(m[1]);
  for (const m of code.matchAll(/(?:^|[^\w:.-])([a-z]+:[a-z][\w-]*)(?![\w:/.-])/g)) qualified.push(m[1]);
  return { plain, qualified };
}

/** The first "# " heading of a markdown text. */
export function firstHeading(md: string): string | undefined {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(normalize(md));
  return m?.[1];
}

/** The first paragraph after the first heading (or of the text), as one line; a "Status: ..." paragraph is skipped. */
export function firstParagraph(md: string): string {
  const t = normalize(md);
  const lines = t.split("\n");
  let i = lines.findIndex((l) => /^#\s/.test(l));
  i = i < 0 ? 0 : i + 1;
  const paras: string[] = [];
  let cur: string[] = [];
  for (; i < lines.length && paras.length < 3; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l) || /^\s*(```|~~~|\||<)/.test(l)) {
      if (cur.length) paras.push(cur.join(" "));
      cur = [];
      if (/^#{1,6}\s/.test(l) && paras.length) break;
      continue;
    }
    if (!l.trim()) {
      if (cur.length) paras.push(cur.join(" "));
      cur = [];
      continue;
    }
    cur.push(l.trim());
  }
  if (cur.length) paras.push(cur.join(" "));
  return paras.find((p) => !/^status\s*:/i.test(p) && !/^[-*]\s/.test(p)) ?? paras[0] ?? "";
}

/** A spec's "Status: <word>" line, lower case. */
export function specStatus(md: string): string | undefined {
  const m = /^Status\s*:\s*\**([A-Za-z][\w -]*?)\**[.,;:]/m.exec(normalize(md).split("\n").slice(0, 12).join("\n"));
  return m?.[1].toLowerCase();
}

/**
 * The stages of build-a-project: its "### <n>. <title>" sections under
 * "## Steps", each with its text up to the next stage or "## " heading.
 */
export function buildStages(md: string): { n: number; title: string; text: string }[] {
  const lines = normalize(md).split("\n");
  const out: { n: number; title: string; text: string }[] = [];
  let inSteps = false;
  let cur: { n: number; title: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur) out.push({ n: cur.n, title: cur.title, text: cur.lines.join("\n") });
    cur = null;
  };
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      flush();
      inSteps = /^##\s+Steps\b/i.test(line);
      continue;
    }
    if (!inSteps) continue;
    const m = /^###\s+(\d+)\.\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      cur = { n: Number(m[1]), title: m[2], lines: [] };
      continue;
    }
    cur?.lines.push(line);
  }
  flush();
  return out;
}

/** Release notes: each "## <version>" or "## Unreleased" section's bullets ("- ...", with their continuation lines). */
export function releaseSections(md: string): { version: string; bullets: string[] }[] {
  const out: { version: string; bullets: string[] }[] = [];
  let cur: { version: string; bullets: string[] } | null = null;
  let bullet: string[] | null = null;
  const endBullet = () => {
    if (cur && bullet) cur.bullets.push(bullet.join(" ").replace(/\s+/g, " ").trim());
    bullet = null;
  };
  for (const line of normalize(md).split("\n")) {
    const h = /^##\s+(\S+)/.exec(line);
    if (h && !line.startsWith("###")) {
      endBullet();
      const v = /^v?(\d+\.\d+\.\d+)$/.exec(h[1]);
      cur = v ? { version: v[1], bullets: [] } : /^unreleased$/i.test(h[1]) ? { version: "unreleased", bullets: [] } : null;
      if (cur) out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^\s*[-*]\s+/.test(line)) {
      endBullet();
      bullet = [line.replace(/^\s*[-*]\s+/, "")];
    } else if (bullet && /^\s+\S/.test(line)) bullet.push(line.trim());
    else endBullet();
  }
  endBullet();
  return out;
}

/** The one line a release-notes bullet gives: its bold lead ("**Every build indexes the project.** ..."), else its first sentence. */
export function bulletLine(bullet: string): string {
  const b = /^\*\*(.+?)\*\*/.exec(bullet);
  const line = b ? b[1] : bullet.split(/(?<=[.!?])\s/)[0];
  return short(line.replace(/\*\*/g, "").replace(/[.:]$/, ""));
}

// ---------------------------------------------------------------------------
// TypeScript sources (read as text, by their formatting)
// ---------------------------------------------------------------------------

/**
 * The CLI's help text: the lines of the "Commands" section of the usage
 * string (a 4-space indent, then the form, then two or more spaces and the
 * description; deeper lines continue it), grouped by command word.
 */
export function cliHelp(src: string): Map<string, { forms: string[]; description: string }> {
  const lines = normalize(src).split("\n");
  const out = new Map<string, { forms: string[]; description: string }>();
  const start = lines.findIndex((l) => /^ {2}Commands\s*$/.test(l));
  if (start < 0) return out;
  const entries: { cmd: string; form: string; parts: string[] }[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^ {2}\S/.test(l) || /^\s*`/.test(l)) break;
    const m = /^ {4}([a-z][a-z-]*)((?: [^ ].*?)?)(?: {2,}(\S.*))?$/.exec(l);
    if (m) {
      entries.push({ cmd: m[1], form: (m[1] + m[2]).trim(), parts: m[3] ? [m[3]] : [] });
      continue;
    }
    if (entries.length && /^ {5,}\S/.test(l)) entries[entries.length - 1].parts.push(l.trim());
  }
  for (const e of entries) {
    const entry = out.get(e.cmd) ?? { forms: [], description: "" };
    entry.forms.push(e.form);
    out.set(e.cmd, entry);
  }
  // the bare form's description, else the command's first form's
  for (const [cmd, entry] of out) {
    const own = entries.filter((e) => e.cmd === cmd);
    const pick = own.find((e) => e.form === cmd) ?? own[0];
    entry.description = pick.parts.join(" ").replace(/\$\{[^}]*\}/g, "…").replace(/\s+/g, " ").trim();
  }
  return out;
}

/**
 * The cases of the top-level `switch (command)` of the CLI's entry point,
 * found by indentation: every `case "<name>":` one level inside it, with the
 * text of its block (fall-through cases share the block). null when there is
 * no such switch.
 */
export function cliCases(src: string): Map<string, string> | null {
  const lines = normalize(src).split("\n");
  const at = lines.findIndex((l) => /^\s*switch \(command\) \{\s*$/.test(l));
  if (at < 0) return null;
  const indent = /^\s*/.exec(lines[at])![0];
  const caseRe = new RegExp(`^${indent}  (?:case "([a-z][a-z-]*)":|default:)`);
  const out = new Map<string, string>();
  let pending: string[] = [];
  let block: string[] = [];
  const flush = () => {
    if (pending.length) for (const name of pending) out.set(name, block.join("\n"));
    pending = [];
    block = [];
  };
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l === `${indent}}`) break;
    const m = caseRe.exec(l);
    if (m) {
      // a case right after another with no code between falls through to the same block
      if (block.some((b) => b.trim() && !/^\s*(case "[^"]*":|default:)\s*\{?\s*$/.test(b))) flush();
      if (m[1]) pending.push(m[1]);
      block.push(l);
      continue;
    }
    block.push(l);
  }
  flush();
  return out;
}

/** String literals following `description:` in a block ("..." and `...` pieces joined by +), as one line. */
function descriptionOf(block: string): string | undefined {
  const at = block.search(/\bdescription:\s*/);
  if (at < 0) return undefined;
  let rest = block.slice(at).replace(/^description:\s*/, "");
  const pieces: string[] = [];
  for (;;) {
    const m = /^("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*')\s*(\+\s*)?/.exec(rest);
    if (!m) break;
    pieces.push(m[1].slice(1, -1).replace(/\\(.)/g, "$1"));
    rest = rest.slice(m[0].length);
    if (!m[2]) break;
  }
  return pieces.length ? pieces.join("").replace(/\$\{[^}]*\}/g, "").replace(/\s+/g, " ").trim() : undefined;
}

/**
 * The MCP tool specs of tools.ts: each `name: "<snake_case>"` at the tools'
 * indentation, with its title, description, the text of its spec, and the
 * CLI commands its handler runs (`cliArgs(["<command>", ...`).
 */
export function mcpTools(src: string): { name: string; title: string; description: string; block: string; commands: string[] }[] {
  const lines = normalize(src).split("\n");
  const starts: number[] = [];
  let indent: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s+)name: "([a-z][a-z0-9_]*)",\s*$/.exec(lines[i]);
    if (!m || !/^\s*title: /.test(lines[i + 1] ?? "")) continue;
    if (indent === null) indent = m[1];
    if (m[1] === indent) starts.push(i);
  }
  return starts.map((s, k) => {
    const block = lines.slice(s, k + 1 < starts.length ? starts[k + 1] : lines.length).join("\n");
    const name = /name: "([a-z][a-z0-9_]*)"/.exec(block)![1];
    const title = /title: "((?:[^"\\]|\\.)*)"/.exec(block)?.[1] ?? name;
    const commands = [...new Set([...block.matchAll(/cliArgs\(\s*\[\s*"([a-z][a-z-]*)"/g)].map((m) => m[1]))];
    return { name, title, description: descriptionOf(block) ?? "", block, commands };
  });
}

/** The built-in view tabs (`export const BUILTIN_TABS ... = [ { id, title, description, ... }, ... ]`). null when there is no such array. */
export function builtinTabs(src: string): { id: string; title: string; description: string; block: string }[] | null {
  const t = normalize(src);
  const at = t.search(/export const BUILTIN_TABS\b[^=]*=\s*\[/);
  if (at < 0) return null;
  const end = t.indexOf("\n];", at);
  const body = t.slice(at, end < 0 ? t.length : end);
  const out: { id: string; title: string; description: string; block: string }[] = [];
  const blocks = body.split(/\n {2}\{\s*\n/).slice(1);
  for (const block of blocks) {
    const id = /\bid: "([^"]+)"/.exec(block)?.[1];
    if (!id) continue;
    out.push({ id, title: /\btitle: "([^"]+)"/.exec(block)?.[1] ?? id, description: descriptionOf(block) ?? "", block });
  }
  return out;
}

/** Static and dynamic import specifiers of a source text. */
export function importsOf(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]);
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s+["']([^"']+)["']/gm)) out.add(m[1]);
  return [...out];
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** "v0.3.0" or "0.3.0" as [0, 3, 0]; null for anything else. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return a < b ? -1 : a > b ? 1 : 0;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
