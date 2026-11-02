/**
 * Plain-language findings (wave R2, D3 and D7; walkthrough 2026-11-01 36:16 to 38:45 and 45:11).
 *
 * A finding keeps its raw `message` (the detail an agent or an engineer reads in the Inspector) and gains two
 * fields for people: `title` (at most TITLE_MAX characters, e.g. "I2C line has no pull-up") and `summary` (one
 * sentence of at most SUMMARY_MAX characters, with the human names of the parts, links and nets). Kevin: "the DRC
 * can flag something with a lot of technical information, but the agent interprets that; a title and a small
 * description". The `project_check` MCP tool returns all three, so an agent can rewrite a summary for a person.
 *
 * Where the words come from: docs/reference/diagnostic-codes.md, one row per code (and per variant of a code, e.g.
 * `UHD_LINK_STATE` incompatible), holds the title and a sentence template. The rows are copied into
 * `findings-text-table.ts` (a test keeps the two equal and rewrites the copy with `UPDATE_FINDINGS_TEXT=1`). A
 * template's `{name}` placeholders are filled from the finding: the generic `{subject}` (the human name of what the
 * finding names) and the per-code values the extractors below read from the message. `[[...]]` is an optional
 * segment, dropped when a placeholder inside it has no value. A code with no row gets a title from its code name
 * (words, not SCREAMING_SNAKE) and its message's first sentence as the summary.
 *
 * Pure: no IO, no Node API (the extension imports it, `@protoboardai/core/findings-text`). The names come from a
 * `FindingNames` (projectNames below builds one from a loaded project).
 */
import { PLAIN_TABLE } from "./findings-text-table.js";

/** DEFAULT (R2-D brief): a title is at most this many characters. */
export const TITLE_MAX = 60;
/** DEFAULT (R2-D brief): a summary is one sentence of at most this many characters. */
export const SUMMARY_MAX = 160;

/** One row of the table: the title and the sentence template. */
export interface PlainEntry {
  title: string;
  summary: string;
}

/** The plain fields a finding carries. */
export interface PlainText {
  title: string;
  summary: string;
}

/** The finding as this module reads it (core `ProjectDiagnostic`, a bundle diagnostic, a CLI JSON record). */
export interface PlainInput {
  code: string;
  message: string;
  severity?: string;
  entity?: { kind: string; id: string };
}

/** Human names of what findings name. Every member is optional: a missing one falls back to the ids, worded. */
export interface FindingNames {
  /** An instance path ("pcb/power/power_in/cs_12v") as a person reads it ("CS_12V INA226 board-input current"). */
  instance?(path: string): string | undefined;
  /** An interface `path:id` ("pcb:dc_jack") as its own name ("12 V DC jack"), without its holder. */
  iface?(ref: string): string | undefined;
  /** A link the check names by its entity id (a derived link `base~a~b`, a harness run `l1+l2~a~b`). */
  link?(id: string): string | undefined;
  /** A definition id as its name. */
  definition?(id: string): string | undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------

/** Abbreviations kept upper case in a title made from a code name. */
const ACRONYMS = new Set(["I2C", "SPI", "UART", "USB", "MPN", "LCSC", "BOM", "PCB", "CAD", "ESC", "STEP", "GLB", "STL", "DXF", "ID", "URL", "PDF", "LED", "DRC", "API"]);
/** Producer prefixes dropped from a code name to make a title (the codes reference's list). */
const PREFIX = /^(?:PB|UHD|HW|SRC|HARNESS|ENCLOSURE|CIRCUIT|FRAME_CAD|HARDWARE_CAD|DRONE|SEQUENCE|MATE|REL|FW)_/;

/** A title from a code name: "UHD_SUPPLY_BUDGET" -> "Supply budget". */
export function genericTitle(code: string): string {
  const words = code.replace(PREFIX, "").split("_").filter(Boolean);
  const text = words.map((w, i) => (ACRONYMS.has(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase())).join(" ");
  return clip(text || code, TITLE_MAX);
}

/** At most `max` characters, cut at a word with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.(-]+$/, "")}…`;
}

/** The first sentence of a message (outside brackets), as a fallback summary. */
export function firstSentence(message: string): string {
  const text = message.replace(/\s+/g, " ").trim();
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (depth === 0 && (c === "." || c === ";") && text[i + 1] === " " && /[A-Z(`]/.test(text[i + 2] ?? "")) return text.slice(0, i + 1);
  }
  return text;
}

/** A name without a trailing parenthetical: "Mainboard B1_4 (rev-a)" -> "Mainboard B1_4". */
export function shortName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  let s = name.trim();
  for (let i = 0; i < 3; i++) {
    const m = /^(.*\S)\s*\([^()]*\)$/.exec(s);
    if (!m) break;
    s = m[1];
  }
  return s.trim() || name.trim();
}

/** An id as words: "fan_unit_1" -> "fan unit 1", "psu" -> "PSU" (three letters or fewer read as an abbreviation). */
export function humanId(id: string): string {
  const last = id.split("/").pop() ?? id;
  if (/^[a-z]{2,3}$/.test(last)) return last.toUpperCase();
  return last.replace(/[_-]+/g, " ").trim() || id;
}

/** One end of a link, named for a person: the interface's name and the module that holds it. */
export interface LinkEnd {
  iface: string;
  holder: string;
}

/**
 * A link named for a person (D7, walkthrough 45:11, Kevin: "for a user it doesn't [make sense]; this is a user
 * interface, for humans; the code underneath is for the agent"). DEFAULT: a named link reads
 * `<link name> (<first holder>) to <second interface> (<second holder>)` ("12 V barrel plug (12 V 3 A wall adapter)
 * to 12 V DC jack (Mainboard B1_4)", the shape of Kevin's "12 V barrel plug (PSU) to DC jack (board)"); an unnamed one
 * `<interface> (<holder>) to <interface> (<holder>)`. The instance ids stay on hover or in a muted line.
 */
export function humanLinkName(link: { name?: string; a: LinkEnd; b: LinkEnd }): string {
  const first = link.name?.trim() ? link.name.trim() : link.a.iface;
  return `${first} (${link.a.holder}) to ${link.b.iface} (${link.b.holder})`;
}

// ---------------------------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------------------------

/** Split a markdown table row at its unescaped bars; `\|` inside a cell is a bar. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/**
 * The rows of the plain-words reference: `| \`CODE\` [variant] | Title | In one sentence |`. The key is the code, or
 * `CODE#variant` for a variant row. Rows of other tables (the placeholders table) are ignored.
 */
export function parsePlainTable(md: string): Record<string, PlainEntry> {
  const out: Record<string, PlainEntry> = {};
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const c = cells(line);
    if (c.length !== 3) continue;
    const m = /^`([A-Z][A-Z0-9_]*[A-Z0-9])`(?:\s+([a-z][a-z0-9-]*))?$/.exec(c[0]);
    if (!m || !c[1] || !c[2]) continue;
    const key = m[2] ? `${m[1]}#${m[2]}` : m[1];
    // a code listed twice (two sections) keeps its first row
    if (!(key in out)) out[key] = { title: c[1], summary: c[2] };
  }
  return out;
}

/**
 * Fill a template: `{name}` from `vars`, `[[...]]` kept only when every placeholder inside has a value. Undefined
 * when a placeholder outside an optional segment has none (the caller then falls back).
 */
export function fillTemplate(template: string, vars: Record<string, string | undefined>): string | undefined {
  const has = (k: string) => vars[k] !== undefined && vars[k] !== "";
  const optional = template.replace(/\[\[(.*?)\]\]/g, (_, inner: string) => ([...inner.matchAll(/\{(\w+)\}/g)].every((m) => has(m[1])) ? inner : ""));
  let missing = false;
  const filled = optional.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (!has(k)) missing = true;
    return vars[k] ?? "";
  });
  if (missing) return undefined;
  // a dropped segment can leave a double space or a space before punctuation
  return filled.replace(/\s{2,}/g, " ").replace(/\s+([,.;:)])/g, "$1").trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Values from a finding
// ---------------------------------------------------------------------------------------------------------------

type Vars = Record<string, string | undefined>;
interface Extracted {
  variant?: string;
  vars: Vars;
}

/** The board prefix the stack writes before a board's own finding: "pcb/power (clientx-mb-sec-power): ". */
function boardPrefix(message: string): { path?: string; rest: string } {
  const m = /^([a-z0-9_][\w/-]*) \(([\w.-]+)\): (.*)$/s.exec(message);
  return m ? { path: m[1], rest: m[3] } : { rest: message };
}

const join = (base: string | undefined, rel: string) => (base ? `${base}/${rel}` : rel);
/** A `path:iface` reference relative to a board, made absolute. */
const absRef = (base: string | undefined, ref: string) => (base && !ref.startsWith(`${base}/`) ? `${base}/${ref}` : ref);
const modOf = (ref: string) => (ref.includes(":") ? ref.slice(0, ref.lastIndexOf(":")) : ref).replace(/\/$/, "");
const idOf = (ref: string) => (ref.includes(":") ? ref.slice(ref.lastIndexOf(":") + 1) : ref);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** The person's name of an instance path, else its id in words. */
function inst(names: FindingNames, path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  if (path === "") return undefined;
  return shortName(names.instance?.(path)) ?? humanId(path);
}

/** An interface reference as "<interface> on <holder>": "12 V DC jack on Mainboard B1_4", "pin 4 on PS BMP580 ...". */
function ifaceOn(names: FindingNames, ref: string): string {
  const id = idOf(ref);
  const own = shortName(names.iface?.(ref)) ?? (/^pin_?(\w+)$/i.test(id) ? `pin ${id.replace(/^pin_?/i, "")}` : humanId(id));
  const holder = inst(names, modOf(ref));
  return holder ? `${own} on ${holder}` : own;
}

/** What a finding is about, named for a person. */
export function subjectOf(d: PlainInput, names: FindingNames = {}): string | undefined {
  const e = d.entity;
  if (!e || typeof e.id !== "string") return undefined;
  switch (e.kind) {
    case "instance":
      return inst(names, e.id) ?? (e.id === "" ? "the system" : undefined);
    case "definition":
      return shortName(names.definition?.(e.id)) ?? e.id;
    case "link":
      return names.link?.(e.id) ?? undefined;
    case "interface":
      return e.id.includes(":") ? ifaceOn(names, e.id) : (inst(names, e.id) ?? shortName(names.definition?.(e.id)) ?? e.id);
    case "artifact": {
      const [def, art] = e.id.split("#");
      return `the ${humanId(art ?? "file")} file of ${shortName(names.definition?.(def)) ?? def}`;
    }
    default:
      return e.id || undefined;
  }
}

/** Per code: the variant of its row and the values its template uses, read from the message (UHD and stack wording). */
const EXTRACT: Record<string, (d: PlainInput, names: FindingNames) => Extracted> = {
  UHD_BUS_PULLUP(d, names) {
    const { path, rest } = boardPrefix(d.message);
    const m = /net (\S+) carries I2C \(([^)]*)\)/.exec(rest);
    const net = m?.[1];
    const dev = m?.[2]?.split(" ↔ ")[0];
    const line = net && /scl/i.test(net) ? "clock line" : net && /sda/i.test(net) ? "data line" : "line";
    return { vars: { net, line, device: dev ? inst(names, join(path, modOf(dev))) : undefined, board: inst(names, path) } };
  },
  UHD_INTERFACE_REUSE(d, names) {
    const { path, rest } = boardPrefix(d.message);
    const m = /^(\S+) is linked (\d+) times \(.*\) but supports (\d+)\.?$/s.exec(rest);
    if (!m) return { vars: {} };
    return { vars: { iface: ifaceOn(names, absRef(path, m[1])), count: times(Number(m[2])), limit: plural(Number(m[3]), "connection") } };
  },
  UHD_LINK_STATE(d, names) {
    const { rest } = boardPrefix(d.message);
    const m = /^(.*?): (incompatible|partial|unconfigured)(?: — (.*))?$/s.exec(rest);
    const variant = m?.[2];
    const [a, b] = (m?.[1] ?? "").split(" ↔ ");
    const link = d.entity?.kind === "link" ? names.link?.(d.entity.id) : undefined;
    return { variant, vars: { a: b !== undefined ? shortName(a) : undefined, b: shortName(b), link, name: m?.[1] } };
  },
  UHD_UNPOWERED(d, names) {
    const { path, rest } = boardPrefix(d.message);
    const ref = d.entity?.kind === "interface" ? d.entity.id : undefined;
    const iface = ref ? ifaceOn(names, ref) : undefined;
    let m = /is unconnected on purpose: (.*?)\.?$/s.exec(rest);
    if (m) return { variant: "on-purpose", vars: { iface, reason: m[1] } };
    m = /is a net port feeding (.*?), but no supply reaches it(?: on net (\S+?))?\.?$/s.exec(rest);
    if (m) {
      const loads = m[1].split(", ").filter(Boolean);
      // the rail by the name the board gives it ("+5V_INT"), else its net id
      const named = /^\S+ \(([^()]+?)(?: \(net port\))?\) is a net port/.exec(rest)?.[1];
      const net = named ?? m[2] ?? (ref ? idOf(ref) : undefined);
      return { variant: "rail", vars: { net, loads: plural(loads.length, "part"), board: inst(names, path) } };
    }
    return { vars: { iface } };
  },
  UHD_SUPPLY_BUDGET(d, names) {
    const { path, rest } = boardPrefix(d.message);
    let m = /^(\S+?)(?: \(including [^)]*\))?: known loads need (\S+ W) of (\S+ W) \([^,]*, (\d+%)\)(?:; (\d+) load\(s\) state no draw)?/.exec(rest);
    if (m) return { variant: d.severity === "error" || d.severity === "warning" ? "over" : "budget", vars: { source: ifaceOn(names, absRef(path, m[1])), need: m[2], cap: m[3], pct: m[4], nodraw: m[5] ? plural(Number(m[5]), "load") : undefined } };
    m = /^(\S+?): branch of (\S+?)(?: via (\w+)(?: \(assumed\))?)?;/.exec(rest);
    if (m) return { variant: "branch", vars: { source: ifaceOn(names, absRef(path, m[1])), parent: ifaceOn(names, absRef(path, m[2])), via: m[3] } };
    m = /^(\S+?): no current rating on the source, so its (\d+) load/.exec(rest);
    if (m) return { variant: "no-rating", vars: { source: ifaceOn(names, absRef(path, m[1])), count: plural(Number(m[2]), "load") } };
    return { vars: {} };
  },
  UHD_NET(d, names) {
    const { path, rest } = boardPrefix(d.message);
    const board = inst(names, path);
    let m = /^net (\S+)(?: \([^)]*\))? joins only (\S+?); nothing else is on it/.exec(rest);
    if (m) return { variant: "single", vars: { net: m[1], pin: ifaceOn(names, absRef(path, m[2])), board } };
    m = /^net (\S+) is driven by (\d+) supplies/.exec(rest);
    if (m) return { variant: "fight", vars: { net: m[1], count: m[2], board } };
    m = /^net (\S+) joins ground .* to supply pins/.exec(rest);
    if (m) return { variant: "short", vars: { net: m[1], board } };
    m = /^(\S+) is on nets (.*?)(?: \(through a net port and an export\))?, which joins them/.exec(rest);
    if (m) return { variant: "joined", vars: { what: ifaceOn(names, absRef(path, m[1])), nets: m[2], board } };
    m = /^(\S+) \([^)]*\) has every terminal on net (\S+?):/.exec(rest);
    if (m) return { variant: "shorted-part", vars: { part: inst(names, join(path, m[1])), net: m[2] } };
    m = /^net (\S+) ties (\S+?)'s output/.exec(rest);
    if (m) return { variant: "loop", vars: { net: m[1], part: inst(names, join(path, m[2])) } };
    m = /is a strap \(([^)]*)\) but net (\S+) carries/.exec(rest);
    if (m) return { variant: "strap", vars: { net: m[2], fn: m[1], board } };
    m = /drives net (\S+) up to its supply .*\(([\d.]+) V\), but (\S+) .* is rated to ([\d.]+) V/.exec(rest);
    if (m) return { variant: "overdrive", vars: { net: m[1], level: `${m[2]} V`, part: inst(names, join(path, modOf(m[3]))), rated: `${m[4]} V` } };
    m = /^net (\S+) is (.*?), but (\S+) .*is (.*?)\.$/.exec(rest);
    if (m) return { variant: "range", vars: { net: m[1], design: m[2], what: ifaceOn(names, absRef(path, m[3])), other: m[4] } };
    return { vars: { board } };
  },
  UHD_PROPULSION_CURRENT(d) {
    let m = /^(\d+) motors can peak at (\S+ A) together, above the battery continuous rating (\S+ A) but within its burst rating(?: (\S+ A))?/.exec(d.message);
    if (m) return { variant: "pack-continuous", vars: { motors: m[1], peak: m[2], cont: m[3], burst: m[4] } };
    m = /^(\d+) motors can peak at (\S+ A) together, above the battery burst rating (\S+ A)/.exec(d.message);
    if (m) return { variant: "pack-burst", vars: { motors: m[1], peak: m[2], burst: m[3] } };
    m = /^(\d+) motors can peak at (\S+ A) together, within the battery continuous rating(?: (\S+ A))?/.exec(d.message);
    if (m) return { variant: "pack-ok", vars: { motors: m[1], peak: m[2], cont: m[3] } };
    m = /motor peak (\S+ A) exceeds the ESC channel (burst|continuous) rating (\S+ A)/.exec(d.message);
    if (m) return { variant: "esc", vars: { peak: m[1], kind: m[2], rating: m[3] } };
    return { vars: {} };
  },
  UHD_PROP_HANDEDNESS(d) {
    let m = /^(\d+) prop\(s\) match their motor's spin/.exec(d.message);
    if (m) return { variant: "ok", vars: { count: m[1] } };
    if (/no spin set for/.test(d.message)) return { variant: "unknown", vars: {} };
    m = /^(\S+): (\w+) prop on a motor spinning (\w+)/.exec(d.message);
    if (m) return { variant: "wrong", vars: { prop: m[2], motor: m[3] } };
    return { vars: {} };
  },
  UHD_FASTENER_TORQUE(d) {
    let m = /^(\d+) fastener joint\(s\) have a torque(?: \((\d+) assumed)?/.exec(d.message);
    if (m) return { variant: "summary", vars: { count: m[1], assumed: m[2] } };
    m = /^(.*?): no tightening torque/.exec(d.message);
    if (m) return { variant: "none", vars: { stack: m[1] } };
    m = /^(.*?): (\S+) torque .* cites no source/.exec(d.message);
    if (m) return { variant: "uncited", vars: { stack: m[1] } };
    return { vars: {} };
  },
  UHD_UNPLACED() {
    return { vars: {} };
  },
  PB_MODEL_MISSING(d) {
    const m = /placeholder box ([\d.]+ x [\d.]+ x [\d.]+ mm)/.exec(d.message);
    return { vars: { size: m?.[1] } };
  },
  PB_MODEL_SIZE_MISMATCH(d) {
    let m = /the 3D model is ([\d.]+) times the package body on its longest side/.exec(d.message);
    if (m) return { variant: "scale", vars: { ratio: m[1], pkg: /The package body is ([\d.]+ x [\d.]+ x [\d.]+ mm)/.exec(d.message)?.[1] } };
    m = /its (.*?) is ([\d.]+) times the package's \(([\d.]+ mm) against ([\d.]+ mm)\)/.exec(d.message);
    if (m) return { variant: "side", vars: { side: m[1], ratio: m[2], model: m[3], pkg: m[4] } };
    return { vars: {} };
  },
  PB_MODEL_ORIENTATION(d) {
    let m = /passes ([\d.]+ mm) through the board's (top|bottom) face/.exec(d.message);
    if (m) return { variant: "through", vars: { far: m[1], face: m[2] } };
    m = /sits ([\d.]+)% of its height (?:inside|under|above) the board/.exec(d.message);
    if (m) return { variant: "sunk", vars: { share: `${m[1]}%` } };
    return { vars: {} };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The plain fields
// ---------------------------------------------------------------------------------------------------------------

/** The table entry for a code and its variant (the variant's row, else the code's), or undefined. */
export function plainEntry(code: string, variant?: string, table: Record<string, PlainEntry> = PLAIN_TABLE): PlainEntry | undefined {
  return (variant ? table[`${code}#${variant}`] : undefined) ?? table[code];
}

/**
 * The plain title and summary of a finding. The code's row (its variant's when the message says which) is filled with
 * the human names; a code with no row, or a row whose values the message does not give, falls back to a title from
 * the code name and the message's first sentence.
 */
export function plainFinding(d: PlainInput, names: FindingNames = {}, table: Record<string, PlainEntry> = PLAIN_TABLE): PlainText {
  let ex: Extracted = { vars: {} };
  try {
    ex = EXTRACT[d.code]?.(d, names) ?? ex;
  } catch {
    // a message in a wording the extractor does not know: the row's own words or the fallback
  }
  const entry = plainEntry(d.code, ex.variant, table);
  const vars: Vars = { subject: subjectOf(d, names), ...ex.vars };
  const title = entry ? (fillTemplate(entry.title, vars) ?? genericTitle(d.code)) : genericTitle(d.code);
  let summary = entry ? fillTemplate(entry.summary, vars) : undefined;
  if (summary === undefined && entry && ex.variant) summary = fillTemplate(plainEntry(d.code, undefined, table)?.summary ?? "", vars);
  if (!summary) summary = firstSentence(d.message);
  // a sentence starts with a capital, whatever name it starts with
  summary = summary.charAt(0).toUpperCase() + summary.slice(1);
  return { title: clip(title, TITLE_MAX), summary: clip(summary, SUMMARY_MAX) };
}

/** Codes a list of findings uses that have no row in the table (the table's to-do list). */
export function codesWithoutText(codes: Iterable<string>, table: Record<string, PlainEntry> = PLAIN_TABLE): string[] {
  return [...new Set(codes)].filter((c) => !table[c] && !Object.keys(table).some((k) => k.startsWith(`${c}#`))).sort();
}

// ---------------------------------------------------------------------------------------------------------------
// Names from a loaded project
// ---------------------------------------------------------------------------------------------------------------

/** What projectNames reads of a project (core `Project`, structurally: no import of the loader). */
export interface NamedProject {
  rootDef?: { id: string };
  instances: { path: string; definition: string; name?: string; kind?: string }[];
  links: { id: string; owner: string; a: string; b: string; harness?: string }[];
  lookup: (id: string) => { id: string; name?: string; interfaces?: { id: string; name?: string }[]; exports?: { id: string; name?: string }[]; links?: { id: string; name?: string }[] } | undefined;
}

/** The names a project gives its instances, interfaces, links and definitions. */
export function projectNames(p: NamedProject): FindingNames {
  const byPath = new Map(p.instances.map((i) => [i.path, i]));
  const instance = (path: string) => {
    const i = byPath.get(path);
    return i ? (i.name ?? p.lookup(i.definition)?.name) : undefined;
  };
  const iface = (ref: string) => {
    const path = modOf(ref);
    const id = idOf(ref);
    const def = byPath.get(path) ? p.lookup(byPath.get(path)!.definition) : undefined;
    return def?.interfaces?.find((x) => x.id === id)?.name ?? def?.exports?.find((x) => x.id === id)?.name;
  };
  const end = (owner: string, ref: string): LinkEnd => {
    const abs = owner ? `${owner}/${ref}` : ref;
    const holder = shortName(instance(modOf(abs))) ?? humanId(modOf(abs));
    const id = idOf(abs);
    return { iface: shortName(iface(abs)) ?? humanId(id), holder };
  };
  const linkName = (l: NamedProject["links"][number]) => {
    const local = l.owner && l.id.startsWith(`${l.owner}:`) ? l.id.slice(l.owner.length + 1) : l.id;
    const ownerDef = l.owner ? p.lookup(byPath.get(l.owner)?.definition ?? "") : undefined;
    const declared = (l.owner ? ownerDef : p.instances.length ? p.lookup(rootDefinition(p) ?? "") : undefined)?.links?.find((x) => x.id === local)?.name;
    return humanLinkName({ name: declared, a: end(l.owner, l.a), b: end(l.owner, l.b) });
  };
  const link = (id: string) => {
    // a derived link `base~a~b`, a harness run `l1+l2~a~b`, a board's `path/base~...`: the first declared link it names
    const bases = id.split("~")[0].split("+");
    for (const base of bases) {
      const l = p.links.find((x) => {
        const local = x.owner && x.id.startsWith(`${x.owner}:`) ? x.id.slice(x.owner.length + 1) : x.id;
        return x.id === base || (x.owner ? `${x.owner}/${local}` : local) === base;
      });
      if (!l) continue;
      // a run through a harness: the harness is the human name of the run when the run names two links
      const run = bases.length > 1 ? bases.map((b) => p.links.find((x) => x.id === b)).filter(Boolean) : [];
      const cable = run.flatMap((x) => [x!.a, x!.b]).map(modOf).find((m) => byPath.get(m)?.kind === "harness");
      if (cable && run.length > 1) {
        const ends = run.flatMap((x) => [x!.a, x!.b]).filter((r) => modOf(r) !== cable);
        if (ends.length === 2) return `${shortName(instance(cable)) ?? humanId(cable)}: ${end("", ends[0]).holder} to ${end("", ends[1]).holder}`;
      }
      return linkName(l);
    }
    return undefined;
  };
  return { instance, iface, link, definition: (id) => p.lookup(id)?.name };
}

/** The root definition's id: the definition of the instance at "" when the project lists it. */
function rootDefinition(p: NamedProject): string | undefined {
  return p.rootDef?.id ?? p.instances.find((i) => i.path === "")?.definition;
}

/**
 * Give every finding of a project its plain `title` and `summary` (a finding that has them keeps them). Called at
 * the end of `loadProject` and before a bundle is written; additive fields, older readers ignore them.
 */
export function annotateFindings<T extends PlainInput & { title?: string; summary?: string }>(list: T[], names: FindingNames = {}): T[] {
  for (const d of list) {
    if (typeof d.title === "string" && typeof d.summary === "string") continue;
    const t = plainFinding(d, names);
    d.title ??= t.title;
    d.summary ??= t.summary;
  }
  return list;
}
