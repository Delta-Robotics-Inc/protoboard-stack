/**
 * A structural devicetree check for the generated files, used when `dtc` is
 * not available (and by `check` always): after the C preprocessor would have
 * run, a devicetree source is nodes and properties. This checks what a
 * generator can get wrong: balanced nodes, every property and node closed
 * with `;`, values that are cells, strings, byte strings or references,
 * labels defined once, and every `&label` defined in the files or by the SoC.
 * Macros inside cells (`NRF_PSEL(…)`, `GPIO_ACTIVE_LOW`) are not expanded.
 */
export interface DtsProblem {
  file: string;
  line: number;
  message: string;
}

interface Token {
  t: string;
  line: number;
}

function tokenize(text: string, file: string, problems: DtsProblem[]): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  const s = text;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\n") {
      line++;
      i++;
    } else if (/\s/.test(ch)) i++;
    else if (s.startsWith("/*", i)) {
      const end = s.indexOf("*/", i + 2);
      if (end < 0) {
        problems.push({ file, line, message: "unterminated /* comment" });
        break;
      }
      line += s.slice(i, end).split("\n").length - 1;
      i = end + 2;
    } else if (s.startsWith("//", i) || (ch === "#" && /^#(include|define|undef|if|ifdef|ifndef|endif|else)\b/.test(s.slice(i)))) {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"' && s[j] !== "\n") j += s[j] === "\\" ? 2 : 1;
      if (s[j] !== '"') problems.push({ file, line, message: "unterminated string" });
      tokens.push({ t: s.slice(i, j + 1), line });
      i = j + 1;
    } else if (ch === "<" || ch === "[") {
      const close = ch === "<" ? ">" : "]";
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") depth--;
        else if (s[j] === close && depth === 0) break;
        else if (s[j] === "\n") line++;
      }
      if (j >= s.length) problems.push({ file, line, message: `unterminated ${ch}…${close}` });
      tokens.push({ t: s.slice(i, j + 1), line });
      i = j + 1;
    } else if ("{};=,".includes(ch)) {
      tokens.push({ t: ch, line });
      i++;
    } else {
      // a comma between word characters belongs to the name (zephyr,code; nordic,nrf-twim)
      let j = i;
      while (j < s.length && (!/[\s{};=,"<[]/.test(s[j]) || (s[j] === "," && j > i && /[\w#-]/.test(s[j + 1] ?? "")))) j++;
      if (j === i) j++;
      tokens.push({ t: s.slice(i, j), line });
      i = j;
    }
  }
  return tokens;
}

const NAME = /^[A-Za-z0-9,._+#?@-]+$/;
const LABEL = /^[A-Za-z_][A-Za-z0-9_]*:$/;
const REF = /^&[A-Za-z_][A-Za-z0-9_]*$/;

/** Check devicetree sources (name → text). `known` are labels the included SoC devicetree defines. */
export function checkDts(files: Record<string, string>, known: string[] = []): DtsProblem[] {
  const problems: DtsProblem[] = [];
  const labels = new Map<string, string>();
  const refs: { label: string; file: string; line: number }[] = [];
  for (const [file, text] of Object.entries(files)) {
    const tokens = tokenize(text, file, problems);
    let depth = 0;
    let i = 0;
    const at = (k: number) => tokens[k]?.t;
    const err = (k: number, message: string) => problems.push({ file, line: tokens[Math.min(k, tokens.length - 1)]?.line ?? 1, message });
    while (i < tokens.length) {
      // "/dts-v1/;"
      if (at(i) === "/dts-v1/" && at(i + 1) === ";") {
        i += 2;
        continue;
      }
      if (at(i) === "}") {
        if (at(i + 1) !== ";") err(i, "node not closed with };");
        depth--;
        if (depth < 0) {
          err(i, "} without an open node");
          depth = 0;
        }
        i += 2;
        continue;
      }
      // labels before a node
      while (LABEL.test(at(i) ?? "")) {
        const l = at(i)!.slice(0, -1);
        if (labels.has(l)) err(i, `label ${l} is defined twice (first in ${labels.get(l)})`);
        labels.set(l, file);
        i++;
      }
      const name = at(i);
      if (name === undefined) break;
      if (at(i + 1) === "{") {
        if (REF.test(name)) {
          if (depth !== 0) err(i, `${name} { … } is only allowed at the top level`);
          refs.push({ label: name.slice(1), file, line: tokens[i].line });
        } else if (name !== "/" && !NAME.test(name)) err(i, `bad node name ${name}`);
        depth++;
        i += 2;
        continue;
      }
      if (depth === 0) {
        err(i, `unexpected ${name} outside a node`);
        i++;
        continue;
      }
      if (!NAME.test(name)) err(i, `bad property name ${name}`);
      if (at(i + 1) === ";") {
        i += 2;
        continue;
      }
      if (at(i + 1) !== "=") {
        err(i, `property ${name} needs = or ;`);
        i++;
        continue;
      }
      // value list: cells, strings, byte strings, references, separated by commas
      let j = i + 2;
      for (;;) {
        const v = at(j);
        if (v === undefined) {
          err(j, `property ${name} is not closed with ;`);
          break;
        }
        if (/^<.*>$/s.test(v)) for (const m of v.matchAll(/&([A-Za-z_][A-Za-z0-9_]*)/g)) refs.push({ label: m[1], file, line: tokens[j].line });
        else if (REF.test(v)) refs.push({ label: v.slice(1), file, line: tokens[j].line });
        else if (!/^".*"$/s.test(v) && !/^\[.*\]$/s.test(v)) err(j, `property ${name}: ${v} is not a cell list, string, byte string or reference`);
        j++;
        if (at(j) === ",") {
          j++;
          continue;
        }
        if (at(j) !== ";") err(j, `property ${name} is not closed with ;`);
        break;
      }
      i = j + 1;
    }
    if (depth !== 0) problems.push({ file, line: tokens[tokens.length - 1]?.line ?? 1, message: `${depth} node(s) not closed` });
  }
  const knownSet = new Set([...known, ...labels.keys()]);
  for (const r of refs) if (!knownSet.has(r.label)) problems.push({ file: r.file, line: r.line, message: `&${r.label} is not defined by these files or the SoC devicetree` });
  return problems;
}
